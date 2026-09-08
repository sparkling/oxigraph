#![cfg(test)]
#![expect(
    clippy::panic_in_result_fn,
    reason = "integration assertions use fallible public constructors"
)]

use oxigraph::io::RdfFormat;
use oxigraph::model::graph::CanonicalizationAlgorithm;
use oxigraph::model::{BlankNode, Graph, NamedNode, Triple, Variable};
use oxigraph::sparql::{
    BoundedJoinCostModel, BoundedJoinPlanning, CancellationToken, CardinalityFeedbackNode,
    QueryEvaluationError, QueryResults, SparqlEvaluator,
};
use oxigraph::store::Store;
use std::fmt::Write;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn bag(results: QueryResults<'_>) -> Result<(usize, Graph)> {
    let QueryResults::Solutions(rows) = results else {
        return Err("expected SELECT results".into());
    };
    // FROM standardizes blank nodes apart on each evaluation. Encode each row
    // as a distinct node so graph isomorphism preserves duplicate solutions,
    // unbound variables and a consistent bijection of result blank nodes.
    let mut graph = Graph::new();
    let mut count = 0;
    for row in rows {
        let row_node = BlankNode::default();
        // An empty solution must not disappear from the encoding.
        graph.insert(Triple::new(
            row_node.clone(),
            NamedNode::new("urn:result:row")?,
            NamedNode::new("urn:result:Solution")?,
        ));
        for (variable, value) in row?.iter() {
            graph.insert(Triple::new(
                row_node.clone(),
                NamedNode::new(format!("urn:result:binding:{}", variable.as_str()))?,
                value.clone(),
            ));
        }
        count += 1;
    }
    graph.canonicalize(CanonicalizationAlgorithm::Unstable)?;
    Ok((count, graph))
}

#[test]
fn multiset_oracle_preserves_duplicates_empty_rows_and_blank_node_identity() -> Result {
    let store = Store::new()?;
    let evaluate = |query| {
        bag(SparqlEvaluator::new()
            .parse_query(query)?
            .on_store(&store)
            .execute()?)
    };
    let same = "SELECT ?x ?y { BIND(BNODE() AS ?x) BIND(?x AS ?y) }";
    assert_eq!(evaluate(same)?, evaluate(same)?);
    assert_ne!(
        evaluate(same)?,
        evaluate("SELECT ?x ?y { BIND(BNODE() AS ?x) BIND(BNODE() AS ?y) }")?
    );
    assert_ne!(
        evaluate("SELECT * { VALUES ?x { 1 1 } }")?,
        evaluate("SELECT * { VALUES ?x { 1 } }")?
    );
    assert_ne!(
        evaluate("SELECT * {}")?,
        evaluate("SELECT * { FILTER(false) }")?
    );
    assert_eq!(evaluate("SELECT * { {} UNION {} }")?.0, 2);
    Ok(())
}
fn store() -> Result<Store> {
    let store = Store::new()?;
    store.load_from_slice(
        RdfFormat::TriG,
        "
        @prefix : <urn:> .
        :a :p :x, :y ; :q :x . :b :p :x ; :q :y .
        :x :r :z . :y :r :z .
        :g1 { :a :p :x ; :q :x . _:b :p :x ; :q :x . }
        :g2 { :a :p :x ; :q :x . _:b :p :x ; :q :x . }
        :empty {}
    ",
    )?;
    Ok(store)
}

#[test]
fn bounded_queries_preserve_multisets_and_scopes() -> Result {
    let store = store()?;
    for query in [
        "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v . ?o <urn:r> ?z }",
        "SELECT ?o { ?s <urn:p> ?o . ?s <urn:p> ?o }",
        "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v OPTIONAL { ?o <urn:r> ?z } }",
        "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v MINUS { ?s <urn:q> <urn:y> } }",
        "SELECT * { { ?s <urn:p> ?o . ?s <urn:q> ?v } UNION { ?o <urn:r> ?s } }",
        "SELECT (COUNT(*) AS ?n) { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "SELECT ?s { ?s <urn:p> ?o . ?s <urn:q> ?v FILTER(?o != ?v) } ORDER BY ?s LIMIT 2",
        "SELECT * { ?s <urn:p> ?o FILTER EXISTS { ?s <urn:q> ?v . ?v <urn:r> ?z } }",
        "SELECT * FROM <urn:g1> { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "SELECT * FROM <urn:g1> FROM <urn:g2> { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "SELECT * FROM NAMED <urn:g1> { GRAPH ?g { ?s <urn:p> ?o . ?s <urn:q> ?v } }",
        "SELECT * { GRAPH ?g { ?s <urn:p> ?o . ?s <urn:q> ?v FILTER(?g = <urn:g1>) } }",
        "SELECT * { GRAPH <urn:empty> { ?s <urn:p> ?o . ?s <urn:q> ?v } }",
        "SELECT * { ?s <urn:p> ?o . ?o <urn:r>* ?z }",
        "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v SERVICE SILENT <urn:unavailable> { ?a ?b ?c } }",
    ] {
        let expected = bag(SparqlEvaluator::new()
            .without_optimizations()
            .parse_query(query)?
            .on_store(&store)
            .execute()?)?;
        for options in [
            BoundedJoinPlanning::new(1).unwrap(),
            BoundedJoinPlanning::new(2).unwrap(),
            BoundedJoinPlanning::default(),
            BoundedJoinPlanning::new(1)
                .unwrap()
                .with_cost_model(BoundedJoinCostModel::ConditionalV2),
            BoundedJoinPlanning::new(2)
                .unwrap()
                .with_cost_model(BoundedJoinCostModel::ConditionalV2),
            BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::ConditionalV2),
            BoundedJoinPlanning::new(1)
                .unwrap()
                .with_cost_model(BoundedJoinCostModel::CorrelatedV3),
            BoundedJoinPlanning::new(2)
                .unwrap()
                .with_cost_model(BoundedJoinCostModel::CorrelatedV3),
            BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::CorrelatedV3),
            BoundedJoinPlanning::new(1)
                .unwrap()
                .with_cost_model(BoundedJoinCostModel::DomainAwareV4),
            BoundedJoinPlanning::new(2)
                .unwrap()
                .with_cost_model(BoundedJoinCostModel::DomainAwareV4),
            BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::DomainAwareV4),
        ] {
            let (results, explanation) = SparqlEvaluator::new()
                .with_bounded_join_planning(options)
                .parse_query(query)?
                .on_store(&store)
                .explain();
            assert_eq!(explanation.join_planning().bounded, Some(options));
            assert_eq!(bag(results?)?, expected, "{query}");
        }
    }
    Ok(())
}

#[test]
fn conditional_planning_avoids_broad_type_and_numeric_scans() -> Result {
    fn work(node: &CardinalityFeedbackNode) -> Result<(u64, u64)> {
        let mut result = if node.operator == "QuadPattern" {
            (
                node.observed_rows.ok_or("missing instrumented quad rows")?,
                node.bound_invocations,
            )
        } else {
            (0, 0)
        };
        for child in &node.children {
            let (rows, probes) = work(child)?;
            result.0 += rows;
            result.1 += probes;
        }
        Ok(result)
    }
    let store = Store::new()?;
    let mut data = String::from("@prefix : <urn:> .");
    for i in 0..100 {
        write!(data, ":s{i} a :Class ; :label \"item{i}\" ; :numeric 1 .")?;
    }
    data.push_str(":s0 :feature :a, :b . :s1 :feature :a .");
    store.load_from_slice(RdfFormat::Turtle, &data)?;
    let query = "SELECT * { ?s <urn:label> ?label . ?s a <urn:Class> . ?s <urn:feature> <urn:a> . ?s <urn:feature> <urn:b> . ?s <urn:numeric> ?n FILTER(?n > 0) }";
    let expected = bag(SparqlEvaluator::new()
        .without_optimizations()
        .parse_query(query)?
        .on_store(&store)
        .execute()?)?;
    assert_eq!(expected.0, 1);
    let mut observations = Vec::new();
    for model in [
        BoundedJoinCostModel::IndependentV1,
        BoundedJoinCostModel::ConditionalV2,
        BoundedJoinCostModel::CorrelatedV3,
        BoundedJoinCostModel::DomainAwareV4,
    ] {
        let (result, explanation) = SparqlEvaluator::new()
            .with_bounded_join_planning(BoundedJoinPlanning::default().with_cost_model(model))
            .parse_query(query)?
            .on_store(&store)
            .compute_statistics()
            .explain();
        assert_eq!(bag(result?)?, expected);
        assert_eq!(explanation.join_planning().dp_states, 31);
        observations.push(work(&explanation.cardinality_feedback().root)?);
    }
    assert_eq!(observations[0], (204, 103), "v1 compatibility");
    assert_eq!(
        observations[1],
        (7, 6),
        "v2 selective scan and bound probes"
    );
    assert!(
        observations[2].0 <= 7,
        "v3 retains selective scan: {:?}",
        observations[2]
    );
    Ok(())
}

#[test]
fn correlated_costs_do_not_scan_unrelated_reviewers() -> Result {
    fn unbound_rows(node: &CardinalityFeedbackNode) -> Result<u64> {
        let own = if node.operator == "QuadPattern" && node.bound_invocations == 0 {
            node.observed_rows.ok_or("missing quad observations")?
        } else {
            0
        };
        node.children
            .iter()
            .try_fold(own, |sum, child| Ok(sum + unbound_rows(child)?))
    }
    #[cfg(all(unix, feature = "statistics"))]
    let store_directory = tempfile::tempdir()?;
    #[cfg(all(unix, feature = "statistics"))]
    let store = Store::open(store_directory.path())?;
    #[cfg(not(all(unix, feature = "statistics")))]
    let store = Store::new()?;
    let mut data = String::from("@prefix : <urn:> .");
    for i in 0..1000 {
        let product = if i < 14 { "selected" } else { "other" };
        let language = if i < 6 || (i >= 14 && i % 2 == 0) {
            "en"
        } else {
            "de"
        };
        write!(
            data,
            ":review{i} :reviewFor :{product}; :title 'title{i}'; :text 'text{i}'@{language}; :date '2020-01-01'; :reviewer :person{} .",
            i % 50
        )?;
        if i % 2 == 0 {
            write!(data, ":review{i} :rating1 1; :rating3 3 .")?;
        }
    }
    for i in 0..50 {
        write!(data, ":person{i} :name 'person{i}' .")?;
    }
    store.load_from_slice(RdfFormat::Turtle, &data)?;
    // Q8's mandatory chain plus sparse OPTIONAL ratings, independent fixture.
    let query = "PREFIX : <urn:> SELECT ?title ?text ?date ?reviewer ?name ?r1 ?r2 ?r3 ?r4 {
      ?review :reviewFor :selected; :title ?title; :text ?text; :date ?date; :reviewer ?reviewer .
      FILTER(langMatches(lang(?text), 'en')) ?reviewer :name ?name .
      OPTIONAL { ?review :rating1 ?r1 } OPTIONAL { ?review :rating2 ?r2 }
      OPTIONAL { ?review :rating3 ?r3 } OPTIONAL { ?review :rating4 ?r4 }
    } ORDER BY DESC(?date) LIMIT 20";
    let expected = bag(SparqlEvaluator::new()
        .without_optimizations()
        .parse_query(query)?
        .on_store(&store)
        .execute()?)?;
    assert_eq!(expected.0, 6);
    for model in [
        BoundedJoinCostModel::ConditionalV2,
        BoundedJoinCostModel::CorrelatedV3,
        BoundedJoinCostModel::DomainAwareV4,
    ] {
        let evaluator = SparqlEvaluator::new()
            .with_bounded_join_planning(BoundedJoinPlanning::default().with_cost_model(model));
        let (result, explanation) = evaluator
            .clone()
            .parse_query(query)?
            .on_store(&store)
            .compute_statistics()
            .explain();
        assert_eq!(bag(result?)?, expected);
        let scans = unbound_rows(&explanation.cardinality_feedback().root)?;
        if model == BoundedJoinCostModel::ConditionalV2 {
            assert!(scans >= 1000, "v2 compatibility: {scans}");
        } else {
            assert_eq!(scans, 14, "only the selected review range is scanned");
        }
        #[cfg(all(unix, feature = "statistics"))]
        {
            use oxigraph::store::{
                DerivedGenerationLimits, DerivedIndex, DerivedProvider, StatisticsProvider,
                TransactionStartControl,
            };
            let directory = tempfile::tempdir()?;
            let provider = StatisticsProvider::default();
            let limits = DerivedGenerationLimits::default();
            let mut index =
                DerivedIndex::create(directory.path().join("statistics"), provider.identity())?;
            let source = store.derived_snapshot(&TransactionStartControl::new())?;
            let generation = index.rebuild(&source, &provider, &limits)?;
            index.activate(&generation, &source, &provider, &limits)?;
            let shared = std::sync::Arc::new(
                provider.read(&index.strict(&source, &limits)?, &limits.input)?,
            );
            let (result, explanation) = evaluator
                .parse_query(query)?
                .on_statistics_snapshot(source, shared, TransactionStartControl::new())?
                .compute_statistics()
                .explain()?;
            assert_eq!(bag(result?)?, expected);
            if model == BoundedJoinCostModel::CorrelatedV3 {
                assert_eq!(unbound_rows(&explanation.cardinality_feedback().root)?, 14);
            }
        }
    }
    Ok(())
}

#[test]
fn disabled_optimization_and_substitutions_bypass_bounded_search() -> Result {
    let store = store()?;
    let query = "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v }";
    for model in [
        BoundedJoinCostModel::IndependentV1,
        BoundedJoinCostModel::ConditionalV2,
        BoundedJoinCostModel::CorrelatedV3,
        BoundedJoinCostModel::DomainAwareV4,
    ] {
        let evaluator = SparqlEvaluator::new()
            .with_bounded_join_planning(BoundedJoinPlanning::default().with_cost_model(model));
        let (results, explanation) = evaluator
            .clone()
            .without_optimizations()
            .parse_query(query)?
            .on_store(&store)
            .explain();
        assert_eq!(explanation.join_planning().bounded, None);
        bag(results?)?;
        let (results, explanation) = evaluator
            .parse_query(query)?
            .substitute_variable(Variable::new("s")?, NamedNode::new("urn:a")?)
            .on_store(&store)
            .explain();
        assert_eq!(explanation.join_planning().bounded, None);
        assert_eq!(bag(results?)?.0, 2);
    }
    Ok(())
}

#[test]
fn all_query_forms_keep_results_and_cancellation() -> Result {
    let store = store()?;
    for model in [
        BoundedJoinCostModel::IndependentV1,
        BoundedJoinCostModel::ConditionalV2,
        BoundedJoinCostModel::CorrelatedV3,
        BoundedJoinCostModel::DomainAwareV4,
    ] {
        for query in [
            "ASK { ?s <urn:p> ?o . ?s <urn:q> ?v }",
            "CONSTRUCT { ?s <urn:out> ?o } WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v }",
            "DESCRIBE ?s WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        ] {
            let expected = SparqlEvaluator::new()
                .without_optimizations()
                .parse_query(query)?
                .on_store(&store)
                .execute()?;
            let evaluator = SparqlEvaluator::new()
                .with_bounded_join_planning(BoundedJoinPlanning::default().with_cost_model(model));
            let (actual, explanation) = evaluator
                .clone()
                .parse_query(query)?
                .on_store(&store)
                .explain();
            assert_eq!(explanation.join_planning().dp_components, 1, "{query}");
            match (expected, actual?) {
                (QueryResults::Boolean(a), QueryResults::Boolean(b)) => assert_eq!(a, b),
                (QueryResults::Graph(a), QueryResults::Graph(b)) => {
                    let mut a = a.collect::<std::result::Result<Graph, _>>()?;
                    let mut b = b.collect::<std::result::Result<Graph, _>>()?;
                    a.canonicalize(CanonicalizationAlgorithm::Unstable)?;
                    b.canonicalize(CanonicalizationAlgorithm::Unstable)?;
                    assert_eq!(a, b, "{query}");
                }
                _ => return Err("wrong result type".into()),
            }
            let token = CancellationToken::new();
            token.cancel();
            let result = evaluator
                .with_cancellation_token(token)
                .parse_query(query)?
                .on_store(&store)
                .execute();
            match result {
                Err(QueryEvaluationError::Cancelled) => (),
                Ok(QueryResults::Graph(mut rows)) => assert!(matches!(
                    rows.next(),
                    Some(Err(QueryEvaluationError::Cancelled))
                )),
                _ => return Err("cancelled query must not succeed".into()),
            }
        }
    }
    Ok(())
}

#[test]
#[cfg(feature = "rdf-12")]
fn bounded_planning_preserves_rdf12_patterns_and_version_errors() -> Result {
    use oxigraph::model::{GraphName, Quad};
    use oxigraph::sparql::SparqlVersion;
    let store = Store::new()?;
    let node = NamedNode::new("urn:node")?;
    store.insert(Quad::new(
        node.clone(),
        node.clone(),
        Triple::new(node.clone(), node.clone(), node.clone()),
        GraphName::DefaultGraph,
    ))?;
    for model in [
        BoundedJoinCostModel::IndependentV1,
        BoundedJoinCostModel::ConditionalV2,
        BoundedJoinCostModel::CorrelatedV3,
        BoundedJoinCostModel::DomainAwareV4,
    ] {
        let evaluator = SparqlEvaluator::new()
            .with_bounded_join_planning(BoundedJoinPlanning::default().with_cost_model(model));
        let query =
            "VERSION \"1.2\" SELECT * { ?s <urn:node> <<( ?a ?b ?c )>> . ?s <urn:node> ?o }";
        assert_eq!(
            bag(evaluator
                .clone()
                .parse_query(query)?
                .on_store(&store)
                .execute()?)?,
            bag(SparqlEvaluator::new()
                .without_optimizations()
                .parse_query(query)?
                .on_store(&store)
                .execute()?)?
        );
        assert!(matches!(
            evaluator
                .parse_query("VERSION \"1.1\" ASK { ?s ?p ?o . ?s ?p ?other }")?
                .on_store(&store)
                .execute(),
            Err(QueryEvaluationError::IncompatibleTerm {
                version: SparqlVersion::V1_1,
                ..
            })
        ));
    }
    Ok(())
}
