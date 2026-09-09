use oxrdf::{Dataset, NamedNode};
use spareval::{
    InnerJoinBuildBudget, QueryEvaluationError, QueryEvaluator, QueryResource, QueryResourcePhase,
    QueryResults,
};
use spargebra::SparqlParser;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn resource_error(error: QueryEvaluationError, limit: u64) {
    assert!(
        matches!(error, QueryEvaluationError::ResourceLimitExceeded {
        resource: QueryResource::InnerJoinBuildRows,
        phase: QueryResourcePhase::JoinBuild,
        limit: actual,
    } if actual == limit)
    );
}

fn consume(evaluator: &QueryEvaluator, query: &str) -> Result<usize, QueryEvaluationError> {
    let parsed = SparqlParser::new().parse_query(query).unwrap();
    match evaluator.prepare(&parsed).execute(&Dataset::new())? {
        QueryResults::Solutions(mut rows) => rows.try_fold(0, |count, row| row.map(|_| count + 1)),
        QueryResults::Boolean(value) => Ok(usize::from(value)),
        QueryResults::Graph(mut rows) => rows.try_fold(0, |count, row| row.map(|_| count + 1)),
    }
}

#[test]
fn empty_probe_does_not_hide_failure_or_consume_the_remaining_build() {
    let values = (0..64).map(|n| n.to_string()).collect::<Vec<_>>().join(" ");
    // The custom function is an independent observation of consumed build rows.
    for probe in ["?s <urn:missing> ?o", "?s <urn:missing> ?x"] {
        let query = format!(
            "SELECT * WHERE {{
            {{ SELECT ?x WHERE {{ VALUES ?value {{ {values} }} BIND(<urn:count>(?value) AS ?x) }} }}
            {probe}
        }}"
        );
        for limit in [8, 64] {
            let calls = Arc::new(AtomicUsize::new(0));
            let counter = Arc::clone(&calls);
            let budget = InnerJoinBuildBudget::new(limit);
            let evaluator = QueryEvaluator::new()
                .without_optimizations()
                .with_inner_join_build_budget(budget.clone())
                .with_custom_function(NamedNode::new_unchecked("urn:count"), move |args| {
                    counter.fetch_add(1, Ordering::SeqCst);
                    args.first().cloned()
                });
            let result = consume(&evaluator, &query);
            if limit == 8 {
                resource_error(result.unwrap_err(), limit);
                assert_eq!(calls.load(Ordering::SeqCst), 9);
                assert!(budget.check().is_err());
            } else {
                assert_eq!(result.unwrap(), 0);
                assert_eq!(calls.load(Ordering::SeqCst), 64);
                budget.check().unwrap();
            }
            assert_eq!(budget.charged_rows(), limit);
        }
    }
}

#[test]
fn duplicates_nested_builds_and_evaluator_clones_are_cumulative() {
    let query = "SELECT * WHERE { VALUES ?x { 1 1 } VALUES ?y { 2 } VALUES ?z { 3 } }";
    let baseline = consume(&QueryEvaluator::new().without_optimizations(), query).unwrap();
    assert_eq!(baseline, 2);
    let budget = InnerJoinBuildBudget::new(4);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(budget.clone());
    assert_eq!(consume(&evaluator, query).unwrap(), baseline);
    assert_eq!(budget.charged_rows(), 4);
    budget.check().unwrap();
    resource_error(consume(&evaluator.clone(), query).unwrap_err(), 4);
    assert_eq!(budget.charged_rows(), 4);
}

#[test]
fn optimized_keyed_hash_join_preserves_results_and_exact_limit() {
    // DISTINCT subqueries cannot become a lateral quad-pattern probe.
    let query = "SELECT ?x WHERE {
        { SELECT DISTINCT ?x WHERE { VALUES ?x { 1 2 } } }
        { SELECT DISTINCT ?x WHERE { VALUES ?x { 1 2 } } }
    }";
    let baseline = consume(&QueryEvaluator::new(), query).unwrap();
    assert_eq!(baseline, 2);
    for limit in [1, 2] {
        let budget = InnerJoinBuildBudget::new(limit);
        let evaluator = QueryEvaluator::new().with_inner_join_build_budget(budget.clone());
        if limit == 1 {
            resource_error(consume(&evaluator, query).unwrap_err(), limit);
        } else {
            assert_eq!(consume(&evaluator, query).unwrap(), baseline);
            budget.check().unwrap();
        }
        assert_eq!(budget.charged_rows(), limit);
    }
}

#[test]
fn exists_ask_union_and_aggregates_cannot_mask_exhaustion() {
    for query in [
        "ASK { { VALUES ?x { 1 2 } VALUES ?y { 3 } } UNION { VALUES ?ok { 1 } } }",
        "ASK { { SERVICE <urn:missing> { ?s ?p ?o } } UNION { VALUES ?x { 1 2 } VALUES ?y { 3 } } }",
        "ASK { FILTER EXISTS { VALUES ?x { 1 2 } VALUES ?y { 3 } } }",
        "ASK { FILTER NOT EXISTS { VALUES ?x { 1 2 } VALUES ?y { 3 } } }",
        "SELECT (EXISTS { VALUES ?x { 1 2 } VALUES ?y { 3 } } AS ?exists) WHERE {}",
        "SELECT (COUNT(*) AS ?count) WHERE { VALUES ?x { 1 2 } VALUES ?y { 3 } }",
        "CONSTRUCT { <urn:s> <urn:p> ?x } WHERE { VALUES ?x { 1 2 } VALUES ?y { 3 } }",
        "DESCRIBE ?x WHERE { VALUES ?x { <urn:a> <urn:b> } VALUES ?y { 3 } }",
    ] {
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_inner_join_build_budget(InnerJoinBuildBudget::new(1));
        resource_error(consume(&evaluator, query).unwrap_err(), 1);
    }
}

#[test]
fn zero_allows_work_without_materializing_an_inner_join() {
    let budget = InnerJoinBuildBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(budget.clone());
    assert_eq!(
        consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { 1 2 3 } }").unwrap(),
        3
    );
    budget.check().unwrap();
    resource_error(
        consume(
            &evaluator,
            "SELECT * WHERE { VALUES ?x { 1 } VALUES ?y { 2 } }",
        )
        .unwrap_err(),
        0,
    );
    resource_error(consume(&evaluator, "ASK {}").unwrap_err(), 0);
}

struct SwallowingService {
    budget: InnerJoinBuildBudget,
    lazy: bool,
    calls: Arc<AtomicUsize>,
}

#[test]
fn buffered_graph_results_observe_failure_from_a_shared_execution() {
    let dataset = Dataset::from_iter([
        oxrdf::Quad::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            NamedNode::new_unchecked("urn:a"),
            oxrdf::GraphName::DefaultGraph,
        ),
        oxrdf::Quad::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:q"),
            NamedNode::new_unchecked("urn:b"),
            oxrdf::GraphName::DefaultGraph,
        ),
    ]);
    for query in [
        "CONSTRUCT { <urn:s> <urn:p> <urn:a> . <urn:s> <urn:q> <urn:b> } WHERE {}",
        "DESCRIBE <urn:s> WHERE {}",
    ] {
        let budget = InnerJoinBuildBudget::new(1);
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_inner_join_build_budget(budget);
        let parsed = SparqlParser::new().parse_query(query).unwrap();
        let QueryResults::Graph(mut rows) = evaluator.prepare(&parsed).execute(&dataset).unwrap()
        else {
            panic!("graph expected");
        };
        rows.next().unwrap().unwrap();
        resource_error(
            consume(
                &evaluator.clone(),
                "ASK { VALUES ?x { 1 2 } VALUES ?y { 3 } }",
            )
            .unwrap_err(),
            1,
        );
        resource_error(rows.next().unwrap().unwrap_err(), 1);
        assert!(rows.next().is_none());
    }
}
impl spareval::ServiceHandler for SwallowingService {
    type Error = std::convert::Infallible;
    fn handle(
        &self,
        _: &spargebra::algebra::QueryExpression,
        _: Option<&oxiri::Iri<oxrdf::OxString>>,
    ) -> Result<spareval::QuerySolutionIter<'static>, Self::Error> {
        let budget = self.budget.clone();
        let exhaust = move || {
            let evaluator = QueryEvaluator::new()
                .without_optimizations()
                .with_inner_join_build_budget(budget.clone());
            resource_error(
                consume(
                    &evaluator,
                    "SELECT * WHERE { VALUES ?x { 1 2 } VALUES ?y { 3 } }",
                )
                .unwrap_err(),
                1,
            );
        };
        if self.lazy {
            let calls = Arc::clone(&self.calls);
            Ok(spareval::QuerySolutionIter::new(
                Arc::from([]),
                std::iter::from_fn(move || {
                    let call = calls.fetch_add(1, Ordering::SeqCst);
                    if call > 10 {
                        return None;
                    }
                    exhaust();
                    Some(Ok(spareval::QuerySolution::from((Arc::from([]), vec![]))))
                }),
            ))
        } else {
            exhaust();
            Ok(spareval::QuerySolutionIter::new(Arc::from([]), []))
        }
    }
}

#[test]
fn service_silent_cannot_hide_shared_exhaustion_at_dispatch_or_eof() {
    for lazy in [false, true] {
        let budget = InnerJoinBuildBudget::new(1);
        let calls = Arc::new(AtomicUsize::new(0));
        let evaluator = QueryEvaluator::new()
            .with_inner_join_build_budget(budget.clone())
            .with_service_handler(
                NamedNode::new_unchecked("urn:service"),
                SwallowingService {
                    budget,
                    lazy,
                    calls: Arc::clone(&calls),
                },
            );
        resource_error(
            consume(
                &evaluator,
                "ASK { SERVICE SILENT <urn:service> { ?s ?p ?o } }",
            )
            .unwrap_err(),
            1,
        );
        assert_eq!(calls.load(Ordering::SeqCst), usize::from(lazy));
    }
}
