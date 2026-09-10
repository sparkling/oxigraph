#![cfg(test)]
#![expect(
    clippy::panic,
    reason = "unexpected fixture result variants fail the test"
)]

#[expect(
    clippy::needless_pass_by_value,
    clippy::unwrap_in_result,
    reason = "shared test helpers assert fixture syntax and consume errors"
)]
mod common;

use common::{SwallowingService, consume};
use oxrdf::{Dataset, Literal, NamedNode, Term};
use spareval::{
    AggregateDistinctBudget, AggregateFunctionAccumulator, QueryEvaluationError, QueryEvaluator,
    QueryResource, QueryResourcePhase, QueryResults,
};
use spargebra::SparqlParser;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

const THREE_SETS: &str = "SELECT (COUNT(DISTINCT *) AS ?all) (COUNT(DISTINCT ?x) AS ?count) (SUM(DISTINCT ?x) AS ?sum) WHERE { VALUES ?x { 1 1 2 } }";

fn plain(optimized: bool) -> QueryEvaluator {
    if optimized {
        QueryEvaluator::new()
    } else {
        QueryEvaluator::new().without_optimizations()
    }
}

fn values(
    evaluator: &QueryEvaluator,
    query: &str,
) -> Result<Vec<Vec<Option<String>>>, QueryEvaluationError> {
    let parsed = SparqlParser::new().parse_query(query).unwrap();
    let dataset = Dataset::new();
    let QueryResults::Solutions(rows) = evaluator.prepare(&parsed).execute(&dataset)? else {
        panic!("solutions expected");
    };
    let variables = rows.variables().len();
    rows.map(|row| {
        row.map(|row| {
            (0..variables)
                .map(|i| row.get(i).map(ToString::to_string))
                .collect()
        })
    })
    .collect()
}

fn resource_error(error: QueryEvaluationError, limit: u64) {
    common::resource_error(
        error,
        QueryResource::AggregateDistinctRows,
        QueryResourcePhase::AggregateDistinct,
        limit,
    );
}

#[test]
fn all_native_aggregate_distinct_wrappers_charge_once_per_retained_key() {
    for optimized in [false, true] {
        let baseline = values(&plain(optimized), THREE_SETS).unwrap();
        for limit in [0, 5, 6, 7] {
            let budget = AggregateDistinctBudget::new(limit);
            let evaluator = plain(optimized).with_aggregate_distinct_budget(budget.clone());
            let result = values(&evaluator, THREE_SETS);
            assert_eq!(budget.charged_rows(), limit.min(6));
            if limit < 6 {
                resource_error(result.unwrap_err(), limit);
                resource_error(consume(&evaluator, "ASK {}").unwrap_err(), limit);
            } else {
                assert_eq!(result.unwrap(), baseline);
                budget.check().unwrap();
            }
        }
    }
}

#[test]
fn unbound_and_expression_error_keep_existing_aggregate_semantics() {
    let query = "SELECT (COUNT(DISTINCT ?x) AS ?count) (SUM(DISTINCT ?x) AS ?sum) WHERE { VALUES ?x { UNDEF 1 1 2 } }";
    for optimized in [false, true] {
        let baseline = values(&plain(optimized), query).unwrap();
        let budget = AggregateDistinctBudget::new(4);
        assert_eq!(
            values(
                &plain(optimized).with_aggregate_distinct_budget(budget.clone()),
                query
            )
            .unwrap(),
            baseline
        );
        assert_eq!(budget.charged_rows(), 2);
        let errors = "SELECT (SUM(DISTINCT (1 / ?x)) AS ?sum) WHERE { VALUES ?x { 0 0 } }";
        let budget = AggregateDistinctBudget::new(0);
        assert_eq!(
            values(
                &plain(optimized).with_aggregate_distinct_budget(budget.clone()),
                errors
            )
            .unwrap(),
            [vec![None]]
        );
        assert_eq!(budget.charged_rows(), 0);
    }
}

#[test]
fn expression_count_group_concat_and_non_distinct_empty_aggregates_are_precise() {
    let distinct = "SELECT (COUNT(DISTINCT STR(?x)) AS ?count) (GROUP_CONCAT(DISTINCT STR(?x); separator=\",\") AS ?text) WHERE { VALUES ?x { 1 1 2 } }";
    let ordinary = "SELECT (COUNT(?x) AS ?count) (SAMPLE(DISTINCT ?x) AS ?sample) (GROUP_CONCAT(STR(?x)) AS ?text) WHERE { VALUES ?x { 1 1 2 } }";
    let empty = "SELECT (COUNT(DISTINCT ?x) AS ?count) (GROUP_CONCAT(DISTINCT STR(?x)) AS ?text) WHERE { VALUES ?x {} }";
    for optimized in [false, true] {
        let budget = AggregateDistinctBudget::new(4);
        assert_eq!(
            values(
                &plain(optimized).with_aggregate_distinct_budget(budget.clone()),
                distinct
            )
            .unwrap(),
            values(&plain(optimized), distinct).unwrap()
        );
        assert_eq!(budget.charged_rows(), 4);
        for query in [ordinary, empty] {
            let budget = AggregateDistinctBudget::new(0);
            assert_eq!(
                values(
                    &plain(optimized).with_aggregate_distinct_budget(budget.clone()),
                    query
                )
                .unwrap(),
                values(&plain(optimized), query).unwrap()
            );
            assert_eq!(budget.charged_rows(), 0);
            budget.check().unwrap();
        }
    }
}

#[test]
fn grouped_nested_and_prepared_executions_share_one_sticky_handle() {
    let grouped = "SELECT ?g (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES (?g ?x) { (1 1) (1 1) (1 2) (2 1) (2 1) } } GROUP BY ?g";
    for optimized in [false, true] {
        let budget = AggregateDistinctBudget::new(2);
        let evaluator = plain(optimized).with_aggregate_distinct_budget(budget.clone());
        resource_error(values(&evaluator, grouped).unwrap_err(), 2);
        assert_eq!(budget.charged_rows(), 2);
        assert!(budget.check().is_err());
    }
    let nested = "SELECT (COUNT(DISTINCT ?n) AS ?total) WHERE { { SELECT ?g (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES (?g ?x) { (1 1) (1 1) (1 2) (2 1) } } GROUP BY ?g } }";
    for optimized in [false, true] {
        let budget = AggregateDistinctBudget::new(4);
        resource_error(
            values(
                &plain(optimized).with_aggregate_distinct_budget(budget.clone()),
                nested,
            )
            .unwrap_err(),
            4,
        );
        assert_eq!(budget.charged_rows(), 4);
    }
    let budget = AggregateDistinctBudget::new(4);
    let evaluator = QueryEvaluator::new().with_aggregate_distinct_budget(budget.clone());
    let query = SparqlParser::new()
        .parse_query("SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES ?x { 1 1 2 } }")
        .unwrap();
    let prepared = evaluator.prepare(&query);
    for _ in 0..2 {
        let dataset = Dataset::new();
        let QueryResults::Solutions(rows) = prepared.clone().execute(&dataset).unwrap() else {
            panic!("solutions expected")
        };
        assert_eq!(rows.collect::<Result<Vec<_>, _>>().unwrap().len(), 1);
    }
    assert_eq!(budget.charged_rows(), 4);
    resource_error(
        consume(
            &evaluator,
            "SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES ?x { 1 } }",
        )
        .unwrap_err(),
        4,
    );
}

struct ProbeAccumulator(Arc<AtomicUsize>);
impl AggregateFunctionAccumulator for ProbeAccumulator {
    fn accumulate(&mut self, _: Term) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn finish(&mut self) -> Option<Term> {
        Some(Literal::from(0).into())
    }
}

#[test]
fn denied_distinct_key_is_not_passed_to_custom_accumulator() {
    let accumulated = Arc::new(AtomicUsize::new(0));
    let budget = AggregateDistinctBudget::new(1);
    let evaluator = QueryEvaluator::new()
        .with_aggregate_distinct_budget(budget.clone())
        .with_custom_aggregate_function(NamedNode::new_unchecked("urn:probe"), {
            let accumulated = Arc::clone(&accumulated);
            move || Box::new(ProbeAccumulator(Arc::clone(&accumulated)))
        });
    let query = SparqlParser::new()
        .with_custom_aggregate_function(NamedNode::new_unchecked("urn:probe"))
        .parse_query("SELECT (<urn:probe>(DISTINCT ?x) AS ?n) WHERE { VALUES ?x { 1 2 } }")
        .unwrap();
    let dataset = Dataset::new();
    let result: Result<Vec<_>, _> =
        evaluator
            .prepare(&query)
            .execute(&dataset)
            .and_then(|result| {
                let QueryResults::Solutions(rows) = result else {
                    panic!("solutions expected")
                };
                rows.collect()
            });
    resource_error(result.unwrap_err(), 1);
    assert_eq!(budget.charged_rows(), 1);
    assert_eq!(accumulated.load(Ordering::SeqCst), 1);
}

#[test]
fn ask_exists_and_service_silent_cannot_mask_aggregate_distinct_failure() {
    let aggregate = "SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES ?x { 1 2 } }";
    for optimized in [false, true] {
        for query in [
            format!("ASK {{ {{ {aggregate} }} }}"),
            format!("SELECT (EXISTS {{ {{ {aggregate} }} }} AS ?ok) WHERE {{}}"),
        ] {
            let budget = AggregateDistinctBudget::new(1);
            resource_error(
                consume(
                    &plain(optimized).with_aggregate_distinct_budget(budget.clone()),
                    &query,
                )
                .unwrap_err(),
                1,
            );
            assert!(budget.check().is_err());
        }
    }
    for lazy in [false, true] {
        let budget = AggregateDistinctBudget::new(0);
        let exhaust_budget = budget.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let evaluator = QueryEvaluator::new()
            .with_aggregate_distinct_budget(budget.clone())
            .with_service_handler(
                NamedNode::new_unchecked("urn:service"),
                SwallowingService {
                    exhaust: Arc::new(move || {
                        resource_error(
                            consume(
                                &QueryEvaluator::new()
                                    .with_aggregate_distinct_budget(exhaust_budget.clone()),
                                "SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES ?x { 1 } }",
                            )
                            .unwrap_err(),
                            0,
                        );
                    }),
                    lazy,
                    calls: Arc::clone(&calls),
                },
            );
        resource_error(
            consume(
                &evaluator,
                "SELECT * WHERE { SERVICE SILENT <urn:service> {} }",
            )
            .unwrap_err(),
            0,
        );
        assert!(budget.check().is_err());
        assert!(calls.load(Ordering::SeqCst) <= 1);
    }
}
