#![cfg(test)]

#[expect(
    clippy::needless_pass_by_value,
    clippy::unwrap_in_result,
    reason = "shared test helpers assert fixture syntax and consume errors"
)]
mod common;

use common::{SwallowingService, consume};
use oxrdf::NamedNode;
use spareval::{
    ConditionalJoinBuildBudget, QueryEvaluationError, QueryEvaluator, QueryResource,
    QueryResourcePhase,
};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn resource_error(error: QueryEvaluationError, limit: u64) {
    common::resource_error(
        error,
        QueryResource::ConditionalJoinBuildRows,
        QueryResourcePhase::JoinBuild,
        limit,
    );
}

#[test]
fn optional_and_minus_hash_builds_charge_right_rows_before_insertion() {
    for query in [
        "SELECT * WHERE { VALUES ?x { 1 2 } OPTIONAL { VALUES ?y { 3 3 } } }",
        "SELECT * WHERE { VALUES ?x { 1 2 } MINUS { VALUES ?y { 3 3 } } }",
        "SELECT * WHERE { VALUES ?x { 1 2 } OPTIONAL { VALUES ?x { 1 2 } } }",
        "SELECT * WHERE { VALUES ?x { 1 2 } MINUS { VALUES ?x { 1 2 } } }",
    ] {
        let budget = ConditionalJoinBuildBudget::new(1);
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_conditional_join_build_budget(budget.clone());
        resource_error(consume(&evaluator, query).unwrap_err(), 1);
        assert_eq!(budget.charged_rows(), 1);
        assert!(budget.check().is_err());
    }
}

#[test]
fn exact_zero_and_absent_budget_preserve_conditional_results() {
    let query = "SELECT * WHERE { VALUES ?x { 1 } OPTIONAL { VALUES ?y { 2 } } }";
    assert_eq!(
        consume(&QueryEvaluator::new().without_optimizations(), query).unwrap(),
        1
    );
    let exact = ConditionalJoinBuildBudget::new(1);
    assert_eq!(
        consume(
            &QueryEvaluator::new()
                .without_optimizations()
                .with_conditional_join_build_budget(exact.clone()),
            query,
        )
        .unwrap(),
        1
    );
    assert_eq!(exact.charged_rows(), 1);
    resource_error(
        consume(
            &QueryEvaluator::new()
                .without_optimizations()
                .with_conditional_join_build_budget(ConditionalJoinBuildBudget::new(0)),
            query,
        )
        .unwrap_err(),
        0,
    );
}

#[test]
fn optimized_keyed_builds_and_nested_prepared_clones_share_the_handle() {
    // Check the actual keyed plan, not just the SPARQL variable names.
    for query in [
        "SELECT * WHERE { VALUES ?x { 1 2 } OPTIONAL { VALUES ?x { 1 2 } } }",
        "SELECT * WHERE { VALUES ?x { 1 2 } MINUS { VALUES ?x { 1 2 } } }",
    ] {
        let parsed = spargebra::SparqlParser::new().parse_query(query).unwrap();
        let (_, explanation) = QueryEvaluator::new()
            .prepare(&parsed)
            .explain(&oxrdf::Dataset::new());
        assert!(
            format!("{explanation:?}").contains("HashBuildRightProbeLeft, keys = ?x"),
            "{explanation:?}"
        );
        let budget = ConditionalJoinBuildBudget::new(1);
        resource_error(
            consume(
                &QueryEvaluator::new().with_conditional_join_build_budget(budget.clone()),
                query,
            )
            .unwrap_err(),
            1,
        );
        assert_eq!(budget.charged_rows(), 1);
    }
    let query = "SELECT * WHERE { VALUES ?x { 1 } OPTIONAL { VALUES ?y { 2 } OPTIONAL { VALUES ?z { 3 } } } }";
    let budget = ConditionalJoinBuildBudget::new(2);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_conditional_join_build_budget(budget.clone());
    assert_eq!(consume(&evaluator, query).unwrap(), 1);
    resource_error(consume(&evaluator.clone(), query).unwrap_err(), 2);
    assert_eq!(budget.charged_rows(), 2);
}

#[test]
fn exists_union_and_aggregate_cannot_mask_sticky_conditional_failure() {
    for query in [
        "ASK { { VALUES ?x { 1 } OPTIONAL { VALUES ?y { 2 3 } } } UNION { VALUES ?ok { 1 } } }",
        "ASK { FILTER EXISTS { VALUES ?x { 1 } OPTIONAL { VALUES ?y { 2 3 } } } }",
        "SELECT (COUNT(*) AS ?count) WHERE { VALUES ?x { 1 } OPTIONAL { VALUES ?y { 2 3 } } }",
    ] {
        resource_error(
            consume(
                &QueryEvaluator::new()
                    .without_optimizations()
                    .with_conditional_join_build_budget(ConditionalJoinBuildBudget::new(1)),
                query,
            )
            .unwrap_err(),
            1,
        );
    }
}

#[test]
fn empty_left_still_consumes_conditional_build_only_to_the_budget_boundary() {
    let values = (0..64).map(|n| n.to_string()).collect::<Vec<_>>().join(" ");
    for conditional in ["OPTIONAL", "MINUS"] {
        let query = format!(
            "SELECT * WHERE {{ ?s <urn:missing> ?o {conditional} {{ VALUES ?value {{ {values} }} BIND(<urn:count>(?value) AS ?x) }} }}"
        );
        for limit in [8, 64] {
            let calls = Arc::new(AtomicUsize::new(0));
            let counter = Arc::clone(&calls);
            let budget = ConditionalJoinBuildBudget::new(limit);
            let evaluator = QueryEvaluator::new()
                .without_optimizations()
                .with_conditional_join_build_budget(budget.clone())
                .with_custom_function(NamedNode::new_unchecked("urn:count"), move |args| {
                    counter.fetch_add(1, Ordering::SeqCst);
                    args.first().cloned()
                });
            let result = consume(&evaluator, &query);
            if limit == 8 {
                resource_error(result.unwrap_err(), 8);
                assert_eq!(calls.load(Ordering::SeqCst), 9);
            } else {
                assert_eq!(result.unwrap(), 0);
                assert_eq!(calls.load(Ordering::SeqCst), 64);
            }
            assert_eq!(budget.charged_rows(), limit);
        }
    }
}

#[test]
fn prepared_query_clone_and_service_silent_observe_shared_conditional_failure() {
    let budget = ConditionalJoinBuildBudget::new(2);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_conditional_join_build_budget(budget.clone());
    let query = spargebra::SparqlParser::new()
        .parse_query("ASK { VALUES ?x { 1 } OPTIONAL { VALUES ?y { 2 3 } } }")
        .unwrap();
    let dataset = oxrdf::Dataset::new();
    let prepared = evaluator.prepare(&query);
    let cloned = prepared.clone();
    assert!(matches!(
        prepared.execute(&dataset).unwrap(),
        spareval::QueryResults::Boolean(true)
    ));
    assert_eq!(budget.charged_rows(), 2);
    resource_error(cloned.execute(&dataset).err().unwrap(), 2);
    resource_error(consume(&evaluator, "ASK {}").unwrap_err(), 2);

    for lazy in [false, true] {
        let budget = ConditionalJoinBuildBudget::new(1);
        let shared = budget.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let evaluator = QueryEvaluator::new()
            .with_conditional_join_build_budget(budget)
            .with_service_handler(
                NamedNode::new_unchecked("urn:service"),
                SwallowingService {
                    exhaust: Arc::new(move || {
                        resource_error(
                            consume(
                                &QueryEvaluator::new()
                                    .without_optimizations()
                                    .with_conditional_join_build_budget(shared.clone()),
                                "ASK { VALUES ?x { 1 } OPTIONAL { VALUES ?y { 2 3 } } }",
                            )
                            .unwrap_err(),
                            1,
                        );
                    }),
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

#[test]
fn zero_allows_runtime_empty_builds_and_independent_inner_join_work() {
    for query in [
        "SELECT * WHERE { VALUES ?x { 1 } OPTIONAL { ?s <urn:missing> ?o } }",
        "SELECT * WHERE { VALUES ?x { 1 } MINUS { ?s <urn:missing> ?x } }",
        "SELECT * WHERE { VALUES ?x { 1 } VALUES ?y { 2 } }",
    ] {
        let budget = ConditionalJoinBuildBudget::new(0);
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_conditional_join_build_budget(budget.clone());
        assert_eq!(consume(&evaluator, query).unwrap(), 1);
        assert_eq!(budget.charged_rows(), 0);
        budget.check().unwrap();
    }
}

#[test]
fn exact_conditional_budget_preserves_optimized_and_unoptimized_results() {
    for (query, expected) in [
        (
            "SELECT * WHERE { VALUES ?x { 1 2 } OPTIONAL { VALUES ?y { 3 3 } } }",
            4,
        ),
        (
            "SELECT * WHERE { VALUES ?x { 1 2 } OPTIONAL { VALUES ?x { 1 2 } } }",
            2,
        ),
        (
            "SELECT * WHERE { VALUES ?x { 1 2 } MINUS { VALUES ?x { 1 2 } } }",
            0,
        ),
    ] {
        for optimize in [false, true] {
            let evaluator = if optimize {
                QueryEvaluator::new()
            } else {
                QueryEvaluator::new().without_optimizations()
            };
            assert_eq!(consume(&evaluator, query).unwrap(), expected);
            let budget = ConditionalJoinBuildBudget::new(2);
            assert_eq!(
                consume(
                    &evaluator.with_conditional_join_build_budget(budget.clone()),
                    query
                )
                .unwrap(),
                expected
            );
            assert_eq!(budget.charged_rows(), 2);
            budget.check().unwrap();
        }
    }
}
