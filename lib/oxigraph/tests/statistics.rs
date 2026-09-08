#![cfg(test)]
#![cfg(all(unix, feature = "statistics"))]
#![expect(
    clippy::panic_in_result_fn,
    reason = "integration assertions use fallible public constructors"
)]
use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::store::{
    BackupError, DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider,
    DerivedSnapshot, DistinctStatisticsLimits, StatisticsError, StatisticsProvider,
    StatisticsSnapshot, Store, TransactionKey, TransactionRequest, TransactionStartControl,
    WritableDataset,
};
use std::collections::BTreeMap;
use std::fmt::Write;
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::Duration;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
use oxigraph::sparql::{
    BoundedJoinCostModel, BoundedJoinPlanning, CancellationToken, CardinalityFeedbackNode,
    EstimateBasis, QueryEvaluationError, QueryResults, SparqlEvaluator, StatisticsAvailability,
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
        return Err("expected solutions".into());
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
fn bounded_planning_reduces_intermediate_rows_without_changing_solutions() -> Result {
    let fixture = Fixture::new(
        (0..10)
            .map(|i| quad(&format!("a{i}"), "pa", "shared", GraphName::DefaultGraph))
            .chain(
                (0..1000).map(|i| quad(&format!("x{i}"), "pb", "shared", GraphName::DefaultGraph)),
            )
            .chain([quad("x0", "pc", "shared", GraphName::DefaultGraph)])
            .chain((1..1000).map(|i| {
                quad(
                    &format!("other{i}"),
                    "pc",
                    "elsewhere",
                    GraphName::DefaultGraph,
                )
            })),
    )?;
    let query = "SELECT ?a ?x ?z WHERE { ?a <urn:pa> ?z . ?x <urn:pb> ?z . ?x <urn:pc> ?z }";
    let oracle = solution_bag(
        SparqlEvaluator::new()
            .without_optimizations()
            .parse_query(query)?
            .on_store(&fixture.store)
            .execute()?,
    )?;
    let mut scan_rows = Vec::new();
    for bounded in [false, true] {
        let evaluator = if bounded {
            SparqlEvaluator::new().with_bounded_join_planning(BoundedJoinPlanning::default())
        } else {
            SparqlEvaluator::new()
        };
        let (results, explanation) = evaluator
            .parse_query(query)?
            .on_statistics(
                capture(&fixture.store)?,
                &fixture.index,
                &fixture.provider,
                fixture.limits.clone(),
            )?
            .compute_statistics()
            .explain()?;
        assert_eq!(solution_bag(results?)?, oracle);
        assert_eq!(
            explanation.join_planning().dp_components,
            usize::from(bounded)
        );
        scan_rows.push(
            leaves(&explanation.cardinality_feedback().root)
                .iter()
                .map(|node| node.observed_rows.unwrap())
                .sum::<u64>(),
        );
    }
    assert!(
        scan_rows[1] < scan_rows[0],
        "bounded/greedy observed leaf rows: {scan_rows:?}"
    );
    Ok(())
}

#[test]
fn distinct_join_costing_avoids_an_unnecessary_hinted_scan() -> Result {
    let fixture = Fixture::new(
        (0..3000)
            .flat_map(|i| {
                [
                    quad(
                        &format!("s{i}"),
                        "p",
                        &format!("p{i}"),
                        GraphName::DefaultGraph,
                    ),
                    quad(
                        &format!("s{i}"),
                        "q",
                        &format!("q{i}"),
                        GraphName::DefaultGraph,
                    ),
                ]
            })
            .chain((0..1000).map(|i| quad(&format!("s{i}"), "r", "yes", GraphName::DefaultGraph))),
    )?;
    let source = capture(&fixture.store)?;
    let shared = Arc::new(fixture.provider.read_with_distinct_estimates(
        &fixture.index.strict(&source, &fixture.limits)?,
        &fixture.limits.input,
        &DistinctStatisticsLimits::default(),
    )?);
    let query = "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v . ?s <urn:r> 'yes' }";
    let expected = solution_bag(
        SparqlEvaluator::new()
            .without_optimizations()
            .parse_query(query)?
            .on_store(&fixture.store)
            .execute()?,
    )?;
    assert_eq!(expected.values().sum::<usize>(), 1000);
    let mut scans = Vec::new();
    for model in [
        BoundedJoinCostModel::CorrelatedV3,
        BoundedJoinCostModel::DomainAwareV4,
    ] {
        let (result, explanation) = SparqlEvaluator::new()
            .with_bounded_join_planning(BoundedJoinPlanning::default().with_cost_model(model))
            .parse_query(query)?
            .on_statistics_snapshot(
                capture(&fixture.store)?,
                Arc::clone(&shared),
                TransactionStartControl::new(),
            )?
            .compute_statistics()
            .explain()?;
        assert_eq!(solution_bag(result?)?, expected);
        scans.push(
            leaves(&explanation.cardinality_feedback().root)
                .iter()
                .map(|n| n.observed_rows.unwrap())
                .sum::<u64>(),
        );
    }
    assert_eq!(
        scans[1], 3000,
        "NDV-aware execution probes only selected subjects: {scans:?}"
    );
    assert_eq!(
        scans[0], 5000,
        "V3 compatibility must retain its full final scan"
    );
    Ok(())
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
    let shared = Arc::new(fixture.read_distinct()?);
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
        let planners = [
            None,
            Some(BoundedJoinPlanning::default()),
            Some(
                BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::ConditionalV2),
            ),
            Some(
                BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::CorrelatedV3),
            ),
            Some(
                BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::DomainAwareV4),
            ),
        ];
        for (index, options) in [&fixture.index, &missing]
            .into_iter()
            .flat_map(|index| planners.map(|options| (index, options)))
        {
            let evaluator = if let Some(options) = options {
                SparqlEvaluator::new().with_bounded_join_planning(options)
            } else {
                SparqlEvaluator::new()
            };
            let result = evaluator
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
        for options in planners {
            let evaluator = if let Some(options) = options {
                SparqlEvaluator::new().with_bounded_join_planning(options)
            } else {
                SparqlEvaluator::new()
            };
            let result = evaluator
                .parse_query(query)?
                .on_statistics_snapshot(
                    capture(&fixture.store)?,
                    Arc::clone(&shared),
                    TransactionStartControl::new(),
                )?
                .execute()?;
            assert_eq!(solution_bag(result)?, expected, "shared: {query}");
        }
    }
    Ok(())
}

#[test]
fn every_planner_preserves_results_with_stale_or_corrupt_statistics() -> Result {
    for corrupt in [false, true] {
        let fixture = Fixture::new(
            (0..12)
                .map(|i| quad(&format!("s{i}"), "p", "red", GraphName::DefaultGraph))
                .chain((0..4).map(|i| quad(&format!("s{i}"), "q", "blue", GraphName::DefaultGraph)))
                .chain([
                    quad("named", "p", "red", NamedNode::new("urn:g")?.into()),
                    quad("named", "q", "blue", NamedNode::new("urn:g")?.into()),
                ]),
        )?;
        let shared = Arc::new(fixture.read_distinct()?);
        let generation = fixture.index.active(&fixture.limits)?;
        // The zero count for :new in the old generation must never suppress the
        // newly written join. A separate fixture tests corruption at a matching
        // checkpoint, using only its private temporary provider payload.
        if corrupt {
            std::fs::write(generation.directory().join("statistics.v1"), b"corrupt")?;
        } else {
            fixture.store.load_from_slice(
                oxigraph::io::RdfFormat::Turtle,
                "<urn:added> <urn:p> 'red'; <urn:q> 'blue'; <urn:new> 'yes' .",
            )?;
        }
        let queries = [
            "SELECT ?s ?o ?v { ?s <urn:p> ?o . ?s <urn:q> ?v }",
            "SELECT ?o { ?s <urn:p> ?o . ?s <urn:q> ?v }",
            "SELECT ?s ?v { ?s <urn:p> ?o OPTIONAL { ?s <urn:q> ?v } }",
            "SELECT ?s { ?s <urn:p> ?o MINUS { ?s <urn:q> ?v } }",
            "SELECT ?s { { ?s <urn:p> ?o } UNION { ?s <urn:q> ?v } }",
            "SELECT (COUNT(*) AS ?n) { ?s <urn:p> ?o . ?s <urn:q> ?v FILTER(?v = 'blue') }",
            "SELECT ?s { ?s <urn:p> ?o . ?s <urn:q> ?v } ORDER BY ?s LIMIT 2",
            "SELECT ?s { ?s <urn:p> ?o FILTER EXISTS { ?s <urn:q> ?v } }",
            "SELECT ?s { ?s <urn:p> ?o . ?s <urn:new> 'yes' }",
            "SELECT ?s FROM <urn:g> { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        ];
        // Expectations are evaluated on the current primary, never reconstructed
        // from statistics or merely compared by row count.
        let expected = queries
            .iter()
            .map(|query| {
                solution_bag(
                    SparqlEvaluator::new()
                        .without_optimizations()
                        .parse_query(query)?
                        .on_store(&fixture.store)
                        .execute()?,
                )
            })
            .collect::<Result<Vec<_>>>()?;
        assert_eq!(expected[8].values().sum::<usize>(), usize::from(!corrupt));
        for (query, expected) in queries.iter().zip(&expected) {
            for evaluator in [
                SparqlEvaluator::new(),
                SparqlEvaluator::new().without_optimizations(),
                SparqlEvaluator::new().with_bounded_join_planning(BoundedJoinPlanning::default()),
                SparqlEvaluator::new().with_bounded_join_planning(
                    BoundedJoinPlanning::default()
                        .with_cost_model(BoundedJoinCostModel::ConditionalV2),
                ),
                SparqlEvaluator::new().with_bounded_join_planning(
                    BoundedJoinPlanning::default()
                        .with_cost_model(BoundedJoinCostModel::CorrelatedV3),
                ),
                SparqlEvaluator::new().with_bounded_join_planning(
                    BoundedJoinPlanning::default()
                        .with_cost_model(BoundedJoinCostModel::DomainAwareV4),
                ),
            ] {
                // Owned observations are still valid for their exact source
                // despite later file corruption, but never for a newer source.
                let bound = evaluator
                    .clone()
                    .parse_query(query)?
                    .on_statistics_snapshot(
                        capture(&fixture.store)?,
                        Arc::clone(&shared),
                        TransactionStartControl::new(),
                    )?;
                assert_eq!(
                    bound.context().availability,
                    if corrupt {
                        StatisticsAvailability::Current
                    } else {
                        StatisticsAvailability::Stale
                    }
                );
                assert_eq!(bound.context().generation.is_some(), corrupt);
                assert_eq!(&solution_bag(bound.execute()?)?, expected, "shared {query}");
                let bound = evaluator.clone().parse_query(query)?.on_statistics(
                    capture(&fixture.store)?,
                    &fixture.index,
                    &fixture.provider,
                    fixture.limits.clone(),
                )?;
                assert_eq!(
                    bound.context().availability,
                    if corrupt {
                        StatisticsAvailability::Rejected
                    } else {
                        StatisticsAvailability::Stale
                    }
                );
                assert_eq!(bound.context().generation, None);
                assert_eq!(&solution_bag(bound.execute()?)?, expected, "fresh {query}");
            }
        }
    }
    Ok(())
}

#[test]
fn retained_statistics_produce_deterministic_dp_and_fallback_plans() -> Result {
    let fixture = Fixture::new((0..9).flat_map(|predicate| {
        (predicate..10).map(move |subject| {
            quad(
                &format!("s{subject}"),
                &format!("p{predicate}"),
                "value",
                GraphName::DefaultGraph,
            )
        })
    }))?;
    let shared = Arc::new(fixture.read_distinct()?);
    for leaf_count in [8, 9] {
        let mut patterns = String::new();
        for i in 0..leaf_count {
            write!(patterns, "?s <urn:p{i}> ?v{i} .")?;
        }
        let query = format!("SELECT * {{ {patterns} }}");
        let expected = solution_bag(
            SparqlEvaluator::new()
                .without_optimizations()
                .parse_query(&query)?
                .on_store(&fixture.store)
                .execute()?,
        )?;
        for model in [
            BoundedJoinCostModel::IndependentV1,
            BoundedJoinCostModel::ConditionalV2,
            BoundedJoinCostModel::CorrelatedV3,
            BoundedJoinCostModel::DomainAwareV4,
        ] {
            let mut first = None;
            for _ in 0..8 {
                let bound = SparqlEvaluator::new()
                    .with_bounded_join_planning(
                        BoundedJoinPlanning::default().with_cost_model(model),
                    )
                    .parse_query(&query)?
                    .on_statistics_snapshot(
                        capture(&fixture.store)?,
                        Arc::clone(&shared),
                        TransactionStartControl::new(),
                    )?;
                assert_eq!(
                    bound.context().availability,
                    StatisticsAvailability::Current
                );
                let (result, explanation) = bound.explain()?;
                assert_eq!(solution_bag(result?)?, expected);
                let report = explanation.join_planning();
                assert_eq!(report.dp_states, if leaf_count == 8 { 255 } else { 0 });
                assert_eq!(report.greedy_components, usize::from(leaf_count == 9));
                let mut serialized = Vec::new();
                explanation.write_in_json(&mut serialized)?;
                let mut json: serde_json::Value = serde_json::from_slice(&serialized)?;
                // Wall-clock planning duration is not part of plan identity.
                json.as_object_mut()
                    .ok_or("expected explanation object")?
                    .remove("planning duration in seconds");
                let actual = (json, report.clone());
                if let Some(first) = &first {
                    assert_eq!(&actual, first);
                } else {
                    first = Some(actual);
                }
            }
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
fn shared_statistics_require_exact_source_and_retain_owned_observations() -> Result {
    let f = Fixture::new([quad("a", "p", "red", GraphName::DefaultGraph)])?;
    let statistics = Arc::new(f.read()?);
    let old = capture(&f.store)?;
    // Explicit reuse reads no generation files after independent verification.
    let payload = f.index.active(&f.limits)?.directory().join("statistics.v1");
    std::fs::write(&payload, b"corrupt after verification")?;
    f.store
        .insert(quad("b", "p", "blue", GraphName::DefaultGraph))?;
    let query = "SELECT * { ?s <urn:p> ?o . ?s <urn:p> ?other }";
    let evaluator =
        SparqlEvaluator::new().with_bounded_join_planning(BoundedJoinPlanning::default());
    let bound = evaluator
        .clone()
        .parse_query(query)?
        .on_statistics_snapshot(old, Arc::clone(&statistics), TransactionStartControl::new())?
        .compute_statistics();
    assert_eq!(
        bound.context().availability,
        StatisticsAvailability::Current
    );
    assert_eq!(bound.context().generation, Some(*statistics.generation()));
    let (result, explanation) = bound.explain()?;
    assert_eq!(consume(result?)?, 1);
    assert!(
        leaves(&explanation.cardinality_feedback().root)
            .iter()
            .all(|leaf| leaf.estimate_basis == Some(EstimateBasis::Statistics))
    );
    let foreign = Fixture::new([quad("a", "p", "red", GraphName::DefaultGraph)])?;
    for store in [&f.store, &foreign.store] {
        let bound = evaluator
            .clone()
            .parse_query(query)?
            .on_statistics_snapshot(
                capture(store)?,
                Arc::clone(&statistics),
                TransactionStartControl::new(),
            )?
            .compute_statistics();
        assert_eq!(bound.context().availability, StatisticsAvailability::Stale);
        assert_eq!(bound.context().generation, None);
        let (result, explanation) = bound.explain()?;
        assert_eq!(
            solution_bag(result?)?,
            solution_bag(
                evaluator
                    .clone()
                    .without_optimizations()
                    .parse_query(query)?
                    .on_store(store)
                    .execute()?
            )?
        );
        assert!(
            leaves(&explanation.cardinality_feedback().root)
                .iter()
                .all(|leaf| leaf.estimate_basis == Some(EstimateBasis::Heuristic))
        );
    }
    assert_eq!(Arc::strong_count(&statistics), 1);
    Ok(())
}

#[test]
fn shared_statistics_reject_copied_siblings_and_reopened_stores() -> Result {
    for distinct in [false, true] {
        check_statistics_live_identity(distinct)?;
    }
    Ok(())
}

fn check_statistics_live_identity(distinct: bool) -> Result {
    let dir = tempfile::tempdir()?;
    let a = Store::open(dir.path().join("a"))?;
    a.insert(quad("base", "p", "base", GraphName::DefaultGraph))?;
    a.backup(dir.path().join("b"))?;
    let b = Store::open(dir.path().join("b"))?;
    a.insert(quad("x", "p", "a", GraphName::DefaultGraph))?;
    b.insert(quad("y", "p", "b", GraphName::DefaultGraph))?;
    let source = capture(&a)?;
    assert_eq!(
        source.checkpoint(),
        capture(&b)?.checkpoint(),
        "copied sibling fixture must share the entire physical checkpoint"
    );
    let limits = DerivedGenerationLimits::default();
    let provider = StatisticsProvider::default();
    let mut index = DerivedIndex::create(dir.path().join("stats"), provider.identity())?;
    let generation = index.rebuild(&source, &provider, &limits)?;
    index.activate(&generation, &source, &provider, &limits)?;
    let read = |source: &DerivedSnapshot| -> Result<_> {
        let view = index.strict(source, &limits)?;
        Ok(Arc::new(if distinct {
            provider.read_with_distinct_estimates(
                &view,
                &limits.input,
                &DistinctStatisticsLimits::default(),
            )?
        } else {
            provider.read(&view, &limits.input)?
        }))
    };
    let statistics = read(&source)?;
    let bind = |store: &Store| -> Result<_> {
        Ok(SparqlEvaluator::new()
            .parse_query("SELECT * { ?s <urn:p> ?o }")?
            .on_statistics_snapshot(
                capture(store)?,
                Arc::clone(&statistics),
                TransactionStartControl::new(),
            )?
            .compute_statistics())
    };
    // A Store clone is the same live instance, not another disk open.
    let cloned = a.clone();
    assert_eq!(
        bind(&cloned)?.context().availability,
        StatisticsAvailability::Current
    );
    let bound = bind(&b)?;
    assert_eq!(bound.context().availability, StatisticsAvailability::Stale);
    let (result, explanation) = bound.explain()?;
    assert_eq!(
        solution_bag(result?)?,
        solution_bag(
            SparqlEvaluator::new()
                .parse_query("SELECT * { ?s <urn:p> ?o }")?
                .on_store(&b)
                .execute()?
        )?
    );
    assert_eq!(
        leaves(&explanation.cardinality_feedback().root)[0].estimate_basis,
        Some(EstimateBasis::Heuristic)
    );
    drop(source);
    drop(cloned);
    drop(a);
    let reopened = Store::open(dir.path().join("a"))?;
    assert_eq!(statistics.source(), capture(&reopened)?.checkpoint());
    assert_eq!(
        bind(&reopened)?.context().availability,
        StatisticsAvailability::Stale
    );
    // Fresh independent verification after reopen creates a new admissible handle.
    let fresh = capture(&reopened)?;
    let verified = read(&fresh)?;
    assert_eq!(
        SparqlEvaluator::new()
            .parse_query("SELECT * { ?s <urn:p> ?o }")?
            .on_statistics_snapshot(fresh, verified, TransactionStartControl::new())?
            .context()
            .availability,
        StatisticsAvailability::Current
    );
    Ok(())
}

#[test]
fn shared_statistics_preserve_cancellation_before_binding_and_during_consumption() -> Result {
    let f = Fixture::new([quad("a", "p", "red", GraphName::DefaultGraph)])?;
    let statistics = Arc::new(f.read()?);
    let query = "SELECT * { ?s <urn:p> ?o }";
    let token = CancellationToken::new();
    token.cancel();
    assert!(matches!(
        SparqlEvaluator::new()
            .with_cancellation_token(token)
            .parse_query(query)?
            .on_statistics_snapshot(
                capture(&f.store)?,
                Arc::clone(&statistics),
                TransactionStartControl::new()
            ),
        Err(QueryEvaluationError::Cancelled)
    ));
    let token = CancellationToken::new();
    let bound = SparqlEvaluator::new()
        .with_cancellation_token(token.clone())
        .parse_query(query)?
        .on_statistics_snapshot(
            capture(&f.store)?,
            Arc::clone(&statistics),
            TransactionStartControl::new(),
        )?;
    let QueryResults::Solutions(mut rows) = bound.execute()? else {
        return Err("expected solutions".into());
    };
    token.cancel();
    assert!(matches!(
        rows.next(),
        Some(Err(QueryEvaluationError::Cancelled))
    ));
    assert!(matches!(
        SparqlEvaluator::new()
            .parse_query(query)?
            .on_statistics_snapshot(
                capture(&f.store)?,
                Arc::clone(&statistics),
                TransactionStartControl::new().with_timeout(Duration::ZERO)
            ),
        Err(QueryEvaluationError::Dataset(_))
    ));
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
        return Err("expected solutions".into());
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

#[test]
fn distinct_observations_are_optional_physical_owned_and_read_only() -> Result {
    let graphs = [
        GraphName::DefaultGraph,
        NamedNode::new("urn:g")?.into(),
        BlankNode::new("g")?.into(),
    ];
    let fixture = Fixture::new(graphs.iter().flat_map(|g| {
        (0..20).flat_map(move |i| {
            let q = quad(&format!("s{i}"), "p", &format!("v{}", i % 4), g.clone());
            [q.clone(), q]
        })
    }))?;
    let ordinary = fixture.read()?;
    assert_eq!(ordinary.distinct_estimation_profile(), None);
    let predicate = NamedNode::new("urn:p")?;
    assert_eq!(ordinary.distinct_values(&graphs[0], &predicate), None);
    let source = capture(&fixture.store)?;
    let view = fixture.index.strict(&source, &fixture.limits)?;
    let path = view.generation().directory().join("statistics.v1");
    let bytes = std::fs::read(&path)?;
    let ndv = fixture.provider.read_with_distinct_estimates(
        &view,
        &fixture.limits.input,
        &DistinctStatisticsLimits::default(),
    )?;
    assert!(
        ndv.distinct_estimation_profile()
            .unwrap()
            .contains("sha256-hll10-fixed48.v1")
    );
    assert_eq!(ndv.source(), ordinary.source());
    assert_eq!(ndv.generation(), ordinary.generation());
    assert_eq!(ndv.count_quads(None, None), 60);
    for graph in &graphs {
        assert_eq!(ndv.distinct_values(graph, &predicate), Some((20, 4)));
        assert_eq!(
            ndv.distinct_values(graph, &NamedNode::new("urn:missing")?),
            Some((0, 0))
        );
    }
    let larger = DistinctStatisticsLimits {
        max_bytes: NonZeroUsize::new(8 * 1024 * 1024).unwrap(),
    };
    let repeated =
        fixture
            .provider
            .read_with_distinct_estimates(&view, &fixture.limits.input, &larger)?;
    for graph in &graphs {
        assert_eq!(
            ndv.distinct_values(graph, &predicate),
            repeated.distinct_values(graph, &predicate)
        );
    }
    assert_eq!(std::fs::read(path)?, bytes);
    fixture
        .store
        .insert(quad("new", "p", "new", GraphName::DefaultGraph))?;
    assert_eq!(ndv.distinct_values(&graphs[0], &predicate), Some((20, 4)));
    let ndv = Arc::new(ndv);
    let bind = |source| -> Result<_> {
        Ok(SparqlEvaluator::new()
            .parse_query("SELECT * { ?s <urn:p> ?o }")?
            .on_statistics_snapshot(source, Arc::clone(&ndv), TransactionStartControl::new())?)
    };
    let retained = bind(source)?;
    assert_eq!(
        retained.distinct_estimation_profile(),
        ndv.distinct_estimation_profile()
    );
    assert_eq!(consume(retained.execute()?)?, 20);
    let stale = bind(capture(&fixture.store)?)?;
    assert_eq!(stale.context().availability, StatisticsAvailability::Stale);
    assert_eq!(stale.distinct_estimation_profile(), None);
    assert_eq!(consume(stale.execute()?)?, 21);
    Ok(())
}

#[test]
fn distinct_observations_obey_read_controls_and_independent_reconciliation() -> Result {
    let fixture = Fixture::new([quad("s", "p", "o", GraphName::DefaultGraph)])?;
    let source = capture(&fixture.store)?;
    let view = fixture.index.strict(&source, &fixture.limits)?;
    assert!(matches!(
        fixture.provider.read_with_distinct_estimates(
            &view,
            &fixture.limits.input,
            &DistinctStatisticsLimits {
                max_bytes: NonZeroUsize::MIN
            }
        ),
        Err(StatisticsError::Limit)
    ));
    for timeout in [false, true] {
        let mut limits = fixture.limits.input.clone();
        limits.control = if timeout {
            TransactionStartControl::new().with_timeout(Duration::ZERO)
        } else {
            let control = TransactionStartControl::new();
            control.cancel();
            control
        };
        let result = fixture.provider.read_with_distinct_estimates(
            &view,
            &limits,
            &DistinctStatisticsLimits::default(),
        );
        if timeout {
            assert!(matches!(
                result,
                Err(StatisticsError::Generation(DerivedGenerationError::Backup(
                    BackupError::TimedOut
                )))
            ));
        } else {
            assert!(matches!(
                result,
                Err(StatisticsError::Generation(DerivedGenerationError::Backup(
                    BackupError::Cancelled
                )))
            ));
        }
    }
    // Only a private temporary fixture is changed, never programme evidence.
    std::fs::write(
        view.generation().directory().join("statistics.v1"),
        b"corrupt",
    )?;
    assert!(matches!(
        fixture.provider.read_with_distinct_estimates(
            &view,
            &fixture.limits.input,
            &DistinctStatisticsLimits::default()
        ),
        Err(StatisticsError::Generation(DerivedGenerationError::Corrupt))
    ));
    assert_eq!(fixture.store.len()?, 1);
    Ok(())
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
    fn read_distinct(&self) -> Result<StatisticsSnapshot> {
        Ok(self.provider.read_with_distinct_estimates(
            &self.index.strict(&capture(&self.store)?, &self.limits)?,
            &self.limits.input,
            &DistinctStatisticsLimits::default(),
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
fn indexed_scope_lookup_preserves_physical_keys_and_wildcard_counts() -> Result {
    let graphs = [
        GraphName::DefaultGraph,
        NamedNode::new("urn:graph")?.into(),
        BlankNode::new("graph")?.into(),
    ];
    let predicates = (0..200)
        .map(|i| NamedNode::new(format!("urn:predicate:{i:04}")))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let fixture = Fixture::new(graphs.iter().flat_map(|graph| {
        predicates.iter().map(move |predicate| {
            Quad::new(
                NamedNode::new_unchecked("urn:s"),
                predicate.clone(),
                Literal::from("value"),
                graph.clone(),
            )
        })
    }))?;
    let statistics = fixture.read()?;
    for graph in graphs.iter().cloned().chain([
        NamedNode::new("urn:missing")?.into(),
        BlankNode::new("missing")?.into(),
        NamedNode::new(format!("urn:{}", "x".repeat(1024 * 1024)))?.into(),
    ]) {
        for predicate in predicates.iter().cloned().chain([
            NamedNode::new("urn:missing")?,
            NamedNode::new(format!("urn:{}", "x".repeat(1024 * 1024)))?,
        ]) {
            let expected = statistics
                .scopes()
                .find(|scope| scope.graph() == &graph && scope.predicate() == &predicate);
            assert_eq!(
                statistics.scope(&graph, &predicate).map(std::ptr::from_ref),
                expected.map(std::ptr::from_ref)
            );
            assert_eq!(
                statistics.count_quads(Some(&graph), Some(&predicate)),
                expected.map_or(0, oxigraph::store::GraphPredicateStatistics::count)
            );
        }
        assert_eq!(
            statistics.count_quads(Some(&graph), None),
            if graphs.contains(&graph) { 200 } else { 0 }
        );
    }
    for predicate in &predicates {
        assert_eq!(statistics.count_quads(None, Some(predicate)), 3);
    }
    assert_eq!(statistics.count_quads(None, None), 600);
    Ok(())
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
    assert!(stats.graphs().any(|g| g.as_ref() == blank.as_ref().into()));
    let result = SparqlEvaluator::new()
        .parse_query("SELECT ?s FROM <urn:g1> FROM <urn:g2> WHERE { ?s <urn:p> ?o }")?
        .on_store(&f.store)
        .execute()?;
    let QueryResults::Solutions(rows) = result else {
        return Err("expected SELECT results".into());
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
    assert!(candidates.iter().any(|c| c.value == Literal::from("hot")));
    for candidate in candidates {
        let Term::Literal(value) = candidate.value else {
            return Err("expected literal".into());
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
        assert_eq!(stats.count_quads(None, None), u64::from(step < 4));
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
