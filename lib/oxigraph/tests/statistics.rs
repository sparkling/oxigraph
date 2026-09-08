#![cfg(all(unix, feature = "statistics"))]
use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::store::{
    BackupError, DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider,
    DerivedSnapshot, StatisticsError, StatisticsProvider, StatisticsSnapshot, Store,
    TransactionKey, TransactionRequest, TransactionStartControl, WritableDataset,
};
use std::collections::BTreeMap;
use std::num::NonZeroUsize;
use std::time::Duration;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
use oxigraph::sparql::{
    CancellationToken, CardinalityFeedbackNode, EstimateBasis, QueryEvaluationError, QueryResults,
    SparqlEvaluator, StatisticsAvailability,
};
fn leaves(node: &CardinalityFeedbackNode) -> Vec<&CardinalityFeedbackNode> {
    if node.operator == "QuadPattern" {
        vec![node]
    } else {
        node.children.iter().flat_map(leaves).collect()
    }
}
fn consume(result: QueryResults<'_>) -> Result<usize> {
    Ok(match result {
        QueryResults::Solutions(rows) => rows.collect::<std::result::Result<Vec<_>, _>>()?.len(),
        QueryResults::Graph(rows) => rows.collect::<std::result::Result<Vec<_>, _>>()?.len(),
        QueryResults::Boolean(value) => usize::from(value),
    })
}
fn solution_bag(
    result: QueryResults<'_>,
) -> Result<std::collections::HashMap<Vec<(String, Term)>, usize>> {
    let QueryResults::Solutions(rows) = result else {
        panic!("solutions")
    };
    let mut output = std::collections::HashMap::new();
    for row in rows {
        let mut row: Vec<_> = row?
            .iter()
            .map(|(v, t)| (v.as_str().to_owned(), t.clone()))
            .collect();
        row.sort_by(|a, b| a.0.cmp(&b.0));
        *output.entry(row).or_insert(0) += 1;
    }
    Ok(output)
}

#[test]
fn statistics_queries_preserve_solution_bags_across_operators_and_fallbacks() -> Result {
    let fixture = Fixture::new(
        (0..12)
            .map(|i| quad(&format!("s{i}"), "p", "red", GraphName::DefaultGraph))
            .chain((0..4).map(|i| quad(&format!("s{i}"), "q", "blue", GraphName::DefaultGraph))),
    )?;
    let missing = DerivedIndex::create(
        fixture.dir.path().join("no-stats"),
        fixture.provider.identity(),
    )?;
    for query in [
        "SELECT ?s ?o ?v WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "SELECT ?o WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "SELECT ?s ?v WHERE { ?s <urn:p> ?o OPTIONAL { ?s <urn:q> ?v } }",
        "SELECT ?s WHERE { ?s <urn:p> ?o MINUS { ?s <urn:q> ?v } }",
        "SELECT ?s WHERE { { ?s <urn:p> ?o } UNION { ?s <urn:q> ?v } }",
        "SELECT (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v FILTER(?v = 'blue') }",
        "SELECT ?s WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v } ORDER BY ?s LIMIT 2",
        "SELECT ?s WHERE { ?s <urn:p> ?o FILTER EXISTS { ?s <urn:q> ?v } }",
    ] {
        let expected = solution_bag(
            SparqlEvaluator::new()
                .without_optimizations()
                .parse_query(query)?
                .on_store(&fixture.store)
                .execute()?,
        )?;
        for index in [&fixture.index, &missing] {
            let result = SparqlEvaluator::new()
                .parse_query(query)?
                .on_statistics(
                    capture(&fixture.store)?,
                    index,
                    &fixture.provider,
                    fixture.limits.clone(),
                )?
                .execute()?;
            assert_eq!(solution_bag(result)?, expected, "{query}");
        }
    }
    Ok(())
}

#[test]
fn query_statistics_and_evaluation_retain_one_snapshot() -> Result {
    let fixture =
        Fixture::new((0..3).map(|i| quad(&format!("s{i}"), "p", "red", GraphName::DefaultGraph)))?;
    let bound = SparqlEvaluator::new()
        .parse_query("SELECT * WHERE { ?s <urn:p> ?o }")?
        .on_statistics(
            capture(&fixture.store)?,
            &fixture.index,
            &fixture.provider,
            fixture.limits.clone(),
        )?
        .compute_statistics();
    assert_eq!(
        bound.context().availability,
        StatisticsAvailability::Current
    );
    let checkpoint = bound.context().source.clone();
    fixture
        .store
        .insert(quad("new", "p", "red", GraphName::DefaultGraph))?;
    let (result, explanation) = bound.explain()?;
    assert_eq!(consume(result?)?, 3);
    let feedback = explanation.cardinality_feedback();
    let leaf = leaves(&feedback.root)[0];
    assert_eq!(leaf.estimated_rows, Some(3));
    assert_eq!(leaf.observed_rows, Some(3));
    assert_eq!(leaf.estimate_basis, Some(EstimateBasis::Statistics));
    assert!(leaf.cardinality_complete);
    assert_eq!(leaf.q_error, Some(1.));
    let text = format!("{feedback:?}");
    assert!(!text.contains("urn:") && !text.contains("red"));
    let newer = SparqlEvaluator::new()
        .parse_query("SELECT * WHERE { ?s <urn:p> ?o }")?
        .on_statistics(
            capture(&fixture.store)?,
            &fixture.index,
            &fixture.provider,
            fixture.limits.clone(),
        )?
        .compute_statistics();
    assert_ne!(newer.context().source, checkpoint);
    assert_eq!(newer.context().availability, StatisticsAvailability::Stale);
    let (result, explanation) = newer.explain()?;
    assert_eq!(consume(result?)?, 4);
    assert_eq!(
        leaves(&explanation.cardinality_feedback().root)[0].estimate_basis,
        Some(EstimateBasis::Heuristic)
    );
    Ok(())
}

#[test]
fn query_statistics_change_basic_join_costs_not_results() -> Result {
    let fixture = Fixture::new(
        (0..100)
            .map(|i| quad(&format!("s{i}"), "common", "red", GraphName::DefaultGraph))
            .chain([quad("s0", "rare", "blue", GraphName::DefaultGraph)]),
    )?;
    let query = "SELECT ?s WHERE { ?s <urn:common> ?o . ?s <urn:rare> ?v }";
    for _ in 0..2 {
        let (result, explanation) = SparqlEvaluator::new()
            .parse_query(query)?
            .on_statistics(
                capture(&fixture.store)?,
                &fixture.index,
                &fixture.provider,
                fixture.limits.clone(),
            )?
            .compute_statistics()
            .explain()?;
        assert_eq!(consume(result?)?, 1);
        let feedback = explanation.cardinality_feedback();
        let leaf = leaves(&feedback.root);
        assert_eq!(leaf[0].estimated_rows, Some(1));
        assert_eq!(leaf[0].estimate_basis, Some(EstimateBasis::Statistics));
        assert!(leaf.iter().any(|l| l.estimated_rows == Some(100)));
        // Correlated probes are observations, not complete unbound cardinalities.
        for leaf in leaf {
            if leaf.bound_invocations > 0 {
                assert_eq!(leaf.q_error, None);
            }
        }
    }
    assert_eq!(
        consume(
            SparqlEvaluator::new()
                .parse_query(query)?
                .on_store(&fixture.store)
                .execute()?
        )?,
        1
    );
    let (result, explanation) = SparqlEvaluator::new()
        .without_optimizations()
        .parse_query(query)?
        .on_statistics(
            capture(&fixture.store)?,
            &fixture.index,
            &fixture.provider,
            fixture.limits.clone(),
        )?
        .compute_statistics()
        .explain()?;
    assert_eq!(consume(result?)?, 1);
    assert!(
        leaves(&explanation.cardinality_feedback().root)
            .iter()
            .all(|l| l.estimate_basis == Some(EstimateBasis::Heuristic))
    );
    Ok(())
}

#[test]
fn query_statistics_respect_from_merge_union_and_named_selection() -> Result {
    let g1 = NamedNode::new("urn:g1")?;
    let g2 = NamedNode::new("urn:g2")?;
    let fixture = Fixture::new([
        quad("same", "p", "red", g1.clone().into()),
        quad("one", "p", "red", g1.into()),
        quad("same", "p", "red", g2.clone().into()),
        quad("two", "p", "red", g2.into()),
        quad("default", "p", "red", GraphName::DefaultGraph),
    ])?;
    for (query, rows, basis) in [
        (
            "SELECT * WHERE { ?s <urn:p> ?o }",
            1,
            EstimateBasis::Statistics,
        ),
        (
            "SELECT * FROM <urn:g1> WHERE { ?s <urn:p> ?o }",
            2,
            EstimateBasis::Statistics,
        ),
        (
            "SELECT * FROM <urn:g1> FROM <urn:g2> WHERE { ?s <urn:p> ?o }",
            3,
            EstimateBasis::Heuristic,
        ),
        (
            "SELECT * FROM NAMED <urn:g1> WHERE { GRAPH <urn:g1> { ?s <urn:p> ?o } }",
            2,
            EstimateBasis::Statistics,
        ),
        (
            "SELECT * FROM NAMED <urn:g2> WHERE { GRAPH <urn:g1> { ?s <urn:p> ?o } }",
            0,
            EstimateBasis::Statistics,
        ),
        (
            "SELECT * WHERE { GRAPH ?g { ?s <urn:p> ?o } }",
            4,
            EstimateBasis::Heuristic,
        ),
        (
            "SELECT * FROM NAMED <urn:g1> WHERE { ?s <urn:p> ?o }",
            0,
            EstimateBasis::Statistics,
        ),
        (
            "SELECT * WHERE { ?s <urn:p> ?s }",
            0,
            EstimateBasis::Heuristic,
        ),
    ] {
        let (result, explanation) = SparqlEvaluator::new()
            .parse_query(query)?
            .on_statistics(
                capture(&fixture.store)?,
                &fixture.index,
                &fixture.provider,
                fixture.limits.clone(),
            )?
            .compute_statistics()
            .explain()?;
        assert_eq!(consume(result?)?, rows, "{query}");
        let feedback = explanation.cardinality_feedback();
        let leaf = leaves(&feedback.root)[0];
        assert_eq!(leaf.estimate_basis, Some(basis), "{query}");
        if basis == EstimateBasis::Statistics {
            assert_eq!(leaf.estimated_rows, Some(rows as u64), "{query}");
        }
    }
    let mut query = SparqlEvaluator::new().parse_query("SELECT * WHERE { ?s <urn:p> ?o }")?;
    query.dataset_mut().set_default_graph_as_union();
    let (result, explanation) = query
        .on_statistics(
            capture(&fixture.store)?,
            &fixture.index,
            &fixture.provider,
            fixture.limits.clone(),
        )?
        .compute_statistics()
        .explain()?;
    assert_eq!(consume(result?)?, 3);
    assert_eq!(
        leaves(&explanation.cardinality_feedback().root)[0].estimate_basis,
        Some(EstimateBasis::Heuristic)
    );
    Ok(())
}

#[test]
fn query_feedback_does_not_certify_partial_or_substituted_cardinality() -> Result {
    let fixture =
        Fixture::new((0..3).map(|i| quad(&format!("s{i}"), "p", "red", GraphName::DefaultGraph)))?;
    let query = "SELECT * WHERE { ?s <urn:p> ?o }";
    let (result, explanation) = SparqlEvaluator::new()
        .parse_query(query)?
        .on_statistics(
            capture(&fixture.store)?,
            &fixture.index,
            &fixture.provider,
            fixture.limits.clone(),
        )?
        .compute_statistics()
        .explain()?;
    let QueryResults::Solutions(mut rows) = result? else {
        panic!("solutions")
    };
    rows.next().unwrap()?;
    assert!(!leaves(&explanation.cardinality_feedback().root)[0].cardinality_complete);
    drop(rows);
    let feedback = explanation.cardinality_feedback();
    let leaf = leaves(&feedback.root)[0];
    assert_eq!(leaf.observed_rows, Some(1));
    assert_eq!(leaf.abandoned_invocations, 1);
    assert_eq!(leaf.q_error, None);
    for query in [
        "ASK { ?s <urn:p> ?o }",
        "SELECT * WHERE { ?s <urn:p> ?o } LIMIT 1",
    ] {
        let (result, explanation) = SparqlEvaluator::new()
            .parse_query(query)?
            .on_statistics(
                capture(&fixture.store)?,
                &fixture.index,
                &fixture.provider,
                fixture.limits.clone(),
            )?
            .compute_statistics()
            .explain()?;
        assert_eq!(consume(result?)?, 1);
        assert_eq!(
            leaves(&explanation.cardinality_feedback().root)[0].q_error,
            None
        );
    }
    let (result, explanation) = SparqlEvaluator::new()
        .parse_query(query)?
        .substitute_variable(
            oxigraph::model::Variable::new("s")?,
            NamedNode::new("urn:s0")?,
        )
        .on_statistics(
            capture(&fixture.store)?,
            &fixture.index,
            &fixture.provider,
            fixture.limits.clone(),
        )?
        .compute_statistics()
        .explain()?;
    assert_eq!(consume(result?)?, 1);
    let feedback = explanation.cardinality_feedback();
    let leaf = leaves(&feedback.root)[0];
    assert_eq!(leaf.estimate_basis, Some(EstimateBasis::Heuristic));
    assert_eq!(leaf.q_error, None);
    assert_eq!(leaf.bound_invocations, 1);
    Ok(())
}

#[test]
fn query_statistics_missing_corrupt_and_cancelled_are_distinct() -> Result {
    let fixture = Fixture::new([quad("s", "p", "red", GraphName::DefaultGraph)])?;
    let missing = DerivedIndex::create(
        fixture.dir.path().join("missing"),
        fixture.provider.identity(),
    )?;
    let query = "SELECT * WHERE { ?s <urn:p> ?o }";
    let bound = SparqlEvaluator::new().parse_query(query)?.on_statistics(
        capture(&fixture.store)?,
        &missing,
        &fixture.provider,
        fixture.limits.clone(),
    )?;
    assert_eq!(
        bound.context().availability,
        StatisticsAvailability::Missing
    );
    assert_eq!(consume(bound.execute()?)?, 1);
    // Corrupt only this test's private temporary provider payload.
    let generation = fixture.index.active(&fixture.limits)?;
    std::fs::write(generation.directory().join("statistics.v1"), b"corrupt")?;
    let bound = SparqlEvaluator::new().parse_query(query)?.on_statistics(
        capture(&fixture.store)?,
        &fixture.index,
        &fixture.provider,
        fixture.limits.clone(),
    )?;
    assert_eq!(
        bound.context().availability,
        StatisticsAvailability::Rejected
    );
    assert_eq!(consume(bound.execute()?)?, 1);
    let token = CancellationToken::new();
    let bound = SparqlEvaluator::new()
        .with_cancellation_token(token.clone())
        .parse_query(query)?
        .on_statistics(
            capture(&fixture.store)?,
            &missing,
            &fixture.provider,
            fixture.limits.clone(),
        )?;
    token.cancel();
    assert!(matches!(
        bound.explain(),
        Err(QueryEvaluationError::Cancelled)
    ));
    Ok(())
}
fn quad(s: &str, p: &str, o: &str, graph: GraphName) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:{s}")),
        NamedNode::new_unchecked(format!("urn:{p}")),
        Literal::from(o),
        graph,
    )
}
fn capture(store: &Store) -> Result<DerivedSnapshot> {
    Ok(store.derived_snapshot(&TransactionStartControl::new())?)
}
struct Fixture {
    store: Store,
    index: DerivedIndex,
    provider: StatisticsProvider,
    limits: DerivedGenerationLimits,
    dir: tempfile::TempDir,
}
impl Fixture {
    fn new(quads: impl IntoIterator<Item = Quad>) -> Result<Self> {
        let dir = tempfile::tempdir()?;
        let store = Store::open(dir.path().join("db"))?;
        let mut tx = store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([1; 16]),
            )?
            .into_transaction();
        for quad in quads {
            tx.insert(quad)?;
        }
        tx.commit()?;
        let provider = StatisticsProvider::default();
        let limits = DerivedGenerationLimits::default();
        let mut index = DerivedIndex::create(dir.path().join("stats"), provider.identity())?;
        let source = capture(&store)?;
        let generation = index.rebuild(&source, &provider, &limits)?;
        index.activate(&generation, &source, &provider, &limits)?;
        Ok(Self {
            store,
            index,
            provider,
            limits,
            dir,
        })
    }
    fn read(&self) -> Result<StatisticsSnapshot> {
        Ok(self.provider.read(
            &self.index.strict(&capture(&self.store)?, &self.limits)?,
            &self.limits.input,
        )?)
    }
    fn catch_up(&mut self) -> Result {
        let source = capture(&self.store)?;
        let generation = self.index.catch_up(&source, &self.provider, &self.limits)?;
        self.index
            .activate(&generation, &source, &self.provider, &self.limits)?;
        Ok(())
    }
}

#[test]
fn exact_physical_counts_empty_topology_and_rdf_merge_distinction() -> Result {
    let q = quad("s", "p", "value", NamedNode::new("urn:g1")?.into());
    let mut f = Fixture::new([
        q.clone(),
        q,
        quad("s", "p", "value", NamedNode::new("urn:g2")?.into()),
        quad("d", "q", "v", GraphName::DefaultGraph),
    ])?;
    let blank = BlankNode::new("empty")?;
    f.store.insert_named_graph(blank.clone())?;
    f.store.insert_named_graph(NamedNode::new("urn:empty")?)?;
    f.catch_up()?;
    let stats = f.read()?;
    assert_eq!(stats.count_quads(None, None), 3);
    assert_eq!(stats.count_quads(None, Some(&NamedNode::new("urn:p")?)), 2);
    assert_eq!(stats.count_quads(Some(&GraphName::DefaultGraph), None), 1);
    assert_eq!(stats.count_quads(Some(&blank.clone().into()), None), 0);
    assert_eq!(stats.graphs().count(), 5);
    assert!(stats.graphs().any(|g| *g == GraphName::from(blank.clone())));
    let result = SparqlEvaluator::new()
        .parse_query("SELECT ?s FROM <urn:g1> FROM <urn:g2> WHERE { ?s <urn:p> ?o }")?
        .on_store(&f.store)
        .execute()?;
    let QueryResults::Solutions(rows) = result else {
        panic!("SELECT")
    };
    assert_eq!(rows.collect::<std::result::Result<Vec<_>, _>>()?.len(), 1); // not physical sum 2
    let empty = Fixture::new([])?.read()?;
    assert_eq!(empty.count_quads(None, None), 0);
    assert_eq!(
        empty.graphs().collect::<Vec<_>>(),
        vec![&GraphName::DefaultGraph]
    );
    Ok(())
}

#[test]
fn bounded_frequency_summaries_enclose_independent_exact_counts() -> Result {
    let mut exact = BTreeMap::<String, u64>::new();
    let quads: Vec<_> = (0..800)
        .map(|i| {
            let value = if i % 3 == 0 {
                "hot".to_owned()
            } else {
                format!("value-{}", i % 107)
            };
            *exact.entry(value.clone()).or_default() += 1;
            quad(&format!("s{i}"), "p", &value, GraphName::DefaultGraph)
        })
        .collect();
    let f = Fixture::new(quads)?;
    let stats = f.read()?;
    let group = stats
        .scope(&GraphName::DefaultGraph, &NamedNode::new("urn:p")?)
        .ok_or("scope")?;
    assert_eq!(group.count(), 800);
    for (value, expected) in &exact {
        let bounds = group.object_frequency(&Literal::from(value.clone()).into())?;
        assert!(
            bounds.lower <= *expected && *expected <= bounds.upper,
            "{value}: {bounds:?} actual {expected}"
        );
    }
    let candidates = group.frequent_objects()?;
    assert!(candidates.len() <= 32);
    assert!(
        candidates
            .iter()
            .any(|c| c.value == Term::from(Literal::from("hot")))
    );
    for candidate in candidates {
        let Term::Literal(value) = candidate.value else {
            panic!("literal")
        };
        let expected = exact[value.value()];
        assert!(candidate.frequency.lower <= expected && expected <= candidate.frequency.upper);
    }
    for i in 0..800 {
        let bounds = group.subject_frequency(&NamedNode::new(format!("urn:s{i}"))?.into())?;
        assert!(bounds.lower <= 1 && bounds.upper >= 1);
    }
    let empty = group.object_frequency(&Literal::from("absent").into())?;
    assert_eq!(empty.lower, 0); // absent candidates are not automatically claimed absent
    Ok(())
}

#[test]
fn strict_lag_recompute_catch_up_rollback_and_reopen() -> Result {
    let kept = quad("kept", "p", "old", GraphName::DefaultGraph);
    let mut f = Fixture::new([kept.clone()])?;
    let old = capture(&f.store)?;
    let old_view = f.index.strict(&old, &f.limits)?;
    let mut tx = f
        .store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    tx.insert(quad("aborted", "p", "x", GraphName::DefaultGraph))?;
    tx.rollback()?;
    let mut tx = f
        .store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([3; 16]))?
        .into_transaction();
    tx.remove(&kept)?;
    tx.insert(quad("new", "p", "new", GraphName::DefaultGraph))?;
    tx.commit()?;
    f.store
        .insert(quad("unguarded", "p", "new", GraphName::DefaultGraph))?;
    assert_eq!(
        f.provider
            .read(&old_view, &f.limits.input)?
            .count_quads(None, None),
        1
    );
    let newer = capture(&f.store)?;
    assert!(matches!(
        f.index.strict(&newer, &f.limits),
        Err(DerivedGenerationError::NotFresh)
    ));
    assert!(matches!(
        f.provider
            .read(&f.index.eventual(&newer, &f.limits)?, &f.limits.input),
        Err(StatisticsError::Generation(
            DerivedGenerationError::NotFresh
        ))
    ));
    drop(old_view);
    drop(old);
    drop(newer);
    f.catch_up()?;
    let original = f.read()?;
    assert_eq!(original.count_quads(None, None), 2);
    let expected_payload =
        std::fs::read(f.index.active(&f.limits)?.directory().join("statistics.v1"))?;
    let source = capture(&f.store)?;
    let rebuilt = f.index.rebuild(&source, &f.provider, &f.limits)?;
    assert_eq!(
        std::fs::read(rebuilt.directory().join("statistics.v1"))?,
        expected_payload
    );
    drop(source);
    let Fixture {
        store,
        index,
        provider,
        limits,
        dir,
    } = f;
    drop(index);
    drop(store);
    let f = Fixture {
        store: Store::open(dir.path().join("db"))?,
        index: DerivedIndex::open(dir.path().join("stats"), provider.identity())?,
        provider,
        limits,
        dir,
    };
    let read = f.read()?;
    assert_eq!(read.count_quads(None, None), 2);
    let group = read
        .scope(&GraphName::DefaultGraph, &NamedNode::new("urn:p")?)
        .ok_or("scope")?;
    assert_eq!(
        group.object_frequency(&Literal::from("new").into())?.lower,
        2
    );
    assert_eq!(
        group.object_frequency(&Literal::from("old").into())?.upper,
        0
    );
    Ok(())
}

#[test]
fn graph_clear_drop_and_all_graph_barriers_preserve_topology() -> Result {
    let graph: NamedOrBlankNode = NamedNode::new("urn:g")?.into();
    let mut f = Fixture::new([
        quad("s", "p", "v", graph.clone().into()),
        quad("d", "p", "v", GraphName::DefaultGraph),
    ])?;
    for step in 2..=5 {
        let mut tx = f
            .store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([step; 16]),
            )?
            .into_transaction();
        match step {
            2 => tx.clear_graph(Some(&graph))?,
            3 => tx.remove_named_graph(&graph)?,
            4 => {
                tx.insert(quad("s", "p", "v", graph.clone().into()))?;
                tx.clear_all_graphs()?;
            }
            _ => tx.clear()?,
        }
        tx.commit()?;
        f.catch_up()?;
        let stats = f.read()?;
        assert_eq!(stats.count_quads(None, None), if step < 4 { 1 } else { 0 });
        assert_eq!(
            stats.graphs().any(|g| g == &GraphName::from(graph.clone())),
            step == 2 || step == 4
        );
        assert!(stats.graphs().any(|g| *g == GraphName::DefaultGraph));
    }
    Ok(())
}

#[test]
fn provider_resource_limits_cancel_timeout_and_post_admission_corruption() -> Result {
    let f = Fixture::new([
        quad("s", "p", "v", GraphName::DefaultGraph),
        quad("s", "q", "v", NamedNode::new("urn:g")?.into()),
    ])?;
    for kind in 0..4 {
        let mut provider = f.provider.clone();
        match kind {
            0 => provider.limits.max_scopes = NonZeroUsize::MIN,
            1 => provider.limits.max_graphs = NonZeroUsize::MIN,
            2 => provider.limits.max_record_bytes = NonZeroUsize::new(16).unwrap(),
            _ => provider.limits.max_index_bytes = NonZeroUsize::new(1024).unwrap(),
        }
        let mut index = DerivedIndex::create(
            f.dir.path().join(format!("small-{kind}")),
            provider.identity(),
        )?;
        assert!(matches!(
            index.rebuild(&capture(&f.store)?, &provider, &f.limits),
            Err(DerivedGenerationError::Limit)
        ));
        assert!(matches!(
            index.active(&f.limits),
            Err(DerivedGenerationError::Unavailable)
        ));
    }
    let source = capture(&f.store)?;
    let view = f.index.strict(&source, &f.limits)?;
    let mut limits = f.limits.input.clone();
    limits.control = TransactionStartControl::new();
    limits.control.cancel();
    assert!(matches!(
        f.provider.read(&view, &limits),
        Err(StatisticsError::Generation(DerivedGenerationError::Backup(
            BackupError::Cancelled
        )))
    ));
    limits.control = TransactionStartControl::new().with_timeout(Duration::ZERO);
    assert!(matches!(
        f.provider.read(&view, &limits),
        Err(StatisticsError::Generation(DerivedGenerationError::Backup(
            BackupError::TimedOut
        )))
    ));
    std::fs::write(
        view.generation().directory().join("statistics.v1"),
        b"corrupt",
    )?;
    assert!(matches!(
        f.provider.read(&view, &f.limits.input),
        Err(StatisticsError::Generation(DerivedGenerationError::Corrupt))
    ));
    // Optional statistics failure does not change ordinary RDF reads.
    assert_eq!(f.store.len()?, 2);
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn term_identity_preserves_language_direction_datatype_and_nested_triples() -> Result {
    use oxigraph::model::{BaseDirection, Triple};
    let terms: Vec<Term> = vec![
        Literal::from("1").into(),
        Literal::from(1).into(),
        Literal::new_language_tagged_literal("red", "en")?.into(),
        Literal::new_directional_language_tagged_literal("red", "en", BaseDirection::Ltr)?.into(),
        Triple::new(
            NamedNode::new("urn:a")?,
            NamedNode::new("urn:p")?,
            Literal::from("red"),
        )
        .into(),
    ];
    let f = Fixture::new(terms.iter().enumerate().map(|(i, o)| {
        Quad::new(
            NamedNode::new_unchecked(format!("urn:s{i}")),
            NamedNode::new_unchecked("urn:p"),
            o.clone(),
            GraphName::DefaultGraph,
        )
    }))?;
    let read = f.read()?;
    let group = read
        .scope(&GraphName::DefaultGraph, &NamedNode::new("urn:p")?)
        .ok_or("scope")?;
    for term in terms {
        let bounds = group.object_frequency(&term)?;
        assert!(bounds.is_exact());
        assert_eq!(bounds.lower, 1);
    }
    Ok(())
}

#[test]
fn backup_restore_reconciles_statistics_before_import() -> Result {
    use oxigraph::store::{
        BackupOptions, ContributorConsistency, ContributorDeclaration, ContributorRegistry,
        DerivedRestore, RestoreOptions,
    };
    use std::sync::Arc;
    let f = Fixture::new([
        quad("a", "p", "red", GraphName::DefaultGraph),
        quad("b", "p", "red", GraphName::DefaultGraph),
    ])?;
    let registry = ContributorRegistry::new(vec![ContributorDeclaration::new(
        f.provider.identity(),
        true,
        ContributorConsistency::Strict,
        false,
    )])?;
    let backup = f.dir.path().join("backup");
    f.store.backup_with_receipt(
        &backup,
        &BackupOptions {
            contributors: registry.clone(),
            contributions: vec![f.index.active(&f.limits)?.backup_contribution(&f.limits)?],
            ..BackupOptions::default()
        },
    )?;
    let restore = f.dir.path().join("restore");
    Store::restore_backup(
        &backup,
        &restore,
        &RestoreOptions {
            contributors: registry,
            reconcilers: vec![Arc::new(DerivedRestore::new(
                Arc::new(f.provider.clone()),
                f.limits.clone(),
            ))],
            ..RestoreOptions::default()
        },
    )?;
    let restored = Store::open(restore.join("store"))?;
    let source = capture(&restored)?;
    let contribution = std::fs::read_dir(restore.join("contributors"))?
        .next()
        .ok_or("missing contributor")??
        .path();
    let mut imported = DerivedIndex::create(f.dir.path().join("imported"), f.provider.identity())?;
    let generation = imported.import_restored(contribution, &source, &f.provider, &f.limits)?;
    imported.activate(&generation, &source, &f.provider, &f.limits)?;
    let stats = f
        .provider
        .read(&imported.strict(&source, &f.limits)?, &f.limits.input)?;
    assert_eq!(stats.count_quads(None, None), 2);
    assert_eq!(
        stats
            .scope(&GraphName::DefaultGraph, &NamedNode::new("urn:p")?)
            .ok_or("scope")?
            .object_frequency(&Literal::from("red").into())?
            .lower,
        2
    );
    Ok(())
}

#[test]
fn independently_reconciles_semantically_wrong_but_checksummed_payload() -> Result {
    use oxigraph::store::{ContributorIdentity, DerivedFiles, DerivedLimits, DerivedWriter};
    struct Wrong {
        provider: StatisticsProvider,
        bytes: Vec<u8>,
    }
    impl DerivedProvider for Wrong {
        fn identity(&self) -> ContributorIdentity {
            self.provider.identity()
        }
        fn rebuild(
            &self,
            _: &DerivedSnapshot,
            output: &mut DerivedWriter<'_>,
            _: &DerivedLimits,
        ) -> std::result::Result<(), DerivedGenerationError> {
            output.write_file("statistics.v1", self.bytes.as_slice())
        }
        fn reconcile(
            &self,
            source: &DerivedSnapshot,
            files: &DerivedFiles,
            limits: &DerivedLimits,
        ) -> std::result::Result<(), DerivedGenerationError> {
            self.provider.reconcile(source, files, limits)
        }
    }
    let f = Fixture::new([quad("a", "p", "semantic-value", GraphName::DefaultGraph)])?;
    let mut bytes = std::fs::read(f.index.active(&f.limits)?.directory().join("statistics.v1"))?;
    let offset = bytes
        .windows(b"semantic-value".len())
        .position(|w| w == b"semantic-value")
        .ok_or("encoded candidate")?;
    bytes[offset] = b'X'; // still a valid RDF literal and structurally valid MG counts
    let wrong = Wrong {
        provider: f.provider.clone(),
        bytes,
    };
    let mut index = DerivedIndex::create(f.dir.path().join("wrong"), wrong.identity())?;
    assert!(matches!(
        index.rebuild(&capture(&f.store)?, &wrong, &f.limits),
        Err(DerivedGenerationError::Reconciliation(_))
    ));
    assert!(matches!(
        index.active(&f.limits),
        Err(DerivedGenerationError::Unavailable)
    ));
    Ok(())
}
