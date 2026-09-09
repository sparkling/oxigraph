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
    AggregateFunctionAccumulator, DistinctBufferBudget, GroupBufferBudget, InnerJoinBuildBudget,
    QueryEvaluationError, QueryEvaluator, QueryResource, QueryResourcePhase, QueryResults,
    SortBufferBudget,
};
use spargebra::SparqlParser;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

const GROUPED: &str = "SELECT ?x (COUNT(*) AS ?n) WHERE { VALUES ?x { 1 1 2 3 } } GROUP BY ?x";

fn plain(optimized: bool) -> QueryEvaluator {
    if optimized {
        QueryEvaluator::new()
    } else {
        QueryEvaluator::new().without_optimizations()
    }
}

fn resource_error(error: QueryEvaluationError, limit: u64) {
    common::resource_error(
        error,
        QueryResource::GroupBufferRows,
        QueryResourcePhase::GroupBuffer,
        limit,
    );
}

#[expect(
    clippy::panic_in_result_fn,
    clippy::unwrap_in_result,
    reason = "fixture parsing and result shape are independent assertions"
)]
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
    let mut result = rows
        .map(|row| {
            row.map(|row| {
                (0..variables)
                    .map(|i| {
                        row.get(i).map(|term| match term {
                            Term::Literal(literal) => literal.value().to_owned(),
                            other => other.to_string(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    result.sort();
    Ok(result)
}

#[test]
fn keyed_zero_exact_plus_one_and_repeated_keys() {
    for optimized in [false, true] {
        let baseline = values(&plain(optimized), GROUPED).unwrap();
        assert_eq!(
            baseline,
            [
                vec![Some("1".into()), Some("2".into())],
                vec![Some("2".into()), Some("1".into())],
                vec![Some("3".into()), Some("1".into())]
            ]
        );
        for limit in [0, 2, 3, 4, u64::MAX] {
            let budget = GroupBufferBudget::new(limit);
            let evaluator = plain(optimized).with_group_buffer_budget(budget.clone());
            let result = values(&evaluator, GROUPED);
            assert_eq!(budget.charged_rows(), limit.min(3));
            if limit < 3 {
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
fn key_positions_unbound_values_aggregates_and_having_are_preserved() {
    let query = "SELECT ?x ?y (COUNT(*) AS ?n) (SUM(?v) AS ?sum) WHERE {
        VALUES (?x ?y ?v) { (UNDEF 1 2) (UNDEF 1 3) (1 UNDEF 4) (1 UNDEF 5) (1 1 7) }
    } GROUP BY ?x ?y HAVING(COUNT(*) > 1)";
    let expected = vec![
        vec![None, Some("1".into()), Some("2".into()), Some("5".into())],
        vec![Some("1".into()), None, Some("2".into()), Some("9".into())],
    ];
    for optimized in [false, true] {
        assert_eq!(values(&plain(optimized), query).unwrap(), expected);
        let budget = GroupBufferBudget::new(3);
        assert_eq!(
            values(
                &plain(optimized).with_group_buffer_budget(budget.clone()),
                query
            )
            .unwrap(),
            expected
        );
        // HAVING removes a result, not the group retained during accumulation.
        assert_eq!(budget.charged_rows(), 3);
        resource_error(
            consume(
                &plain(optimized).with_group_buffer_budget(GroupBufferBudget::new(2)),
                query,
            )
            .unwrap_err(),
            2,
        );
    }
}

#[test]
fn global_group_exists_even_on_empty_input_but_empty_keyed_input_does_not() {
    for optimized in [false, true] {
        // Runtime-empty input keeps the physical global grouping operator.
        for body in ["?s ?p ?x", "VALUES ?x { 1 2 }"] {
            let query = format!("SELECT (COUNT(*) AS ?n) WHERE {{ {body} }}");
            for limit in [0, 1] {
                let budget = GroupBufferBudget::new(limit);
                let result = values(
                    &plain(optimized).with_group_buffer_budget(budget.clone()),
                    &query,
                );
                if limit == 0 {
                    resource_error(result.unwrap_err(), 0);
                } else {
                    assert_eq!(result.unwrap(), values(&plain(optimized), &query).unwrap());
                    budget.check().unwrap();
                }
                assert_eq!(budget.charged_rows(), limit);
            }
        }
        let zero = GroupBufferBudget::new(0);
        let evaluator = plain(optimized).with_group_buffer_budget(zero.clone());
        assert_eq!(
            consume(
                &evaluator,
                "SELECT ?x (COUNT(*) AS ?n) WHERE { VALUES ?x {} } GROUP BY ?x"
            )
            .unwrap(),
            0
        );
        assert_eq!(
            consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { 1 2 } }").unwrap(),
            2
        );
        assert_eq!(zero.charged_rows(), 0);
        zero.check().unwrap();
    }
}

#[test]
fn nested_prepared_and_cloned_evaluators_share_one_sticky_counter() {
    let nested = "SELECT (SUM(?n) AS ?total) WHERE { { SELECT ?x (COUNT(*) AS ?n) WHERE { VALUES ?x { 1 1 2 } } GROUP BY ?x } }";
    for optimized in [false, true] {
        let budget = GroupBufferBudget::new(3);
        let evaluator = plain(optimized).with_group_buffer_budget(budget.clone());
        assert_eq!(
            values(&evaluator, nested).unwrap(),
            [vec![Some("3".into())]]
        );
        assert_eq!(budget.charged_rows(), 3);
        resource_error(consume(&evaluator.clone(), nested).unwrap_err(), 3);
        assert!(evaluator.group_buffer_budget().unwrap().check().is_err());
    }
    let budget = GroupBufferBudget::new(7);
    let evaluator = QueryEvaluator::new().with_group_buffer_budget(budget.clone());
    let query = SparqlParser::new().parse_query(GROUPED).unwrap();
    let prepared = evaluator.prepare(&query);
    let dataset = Dataset::new();
    for _ in 0..2 {
        let QueryResults::Solutions(rows) = prepared.clone().execute(&dataset).unwrap() else {
            panic!("solutions expected");
        };
        assert_eq!(rows.collect::<Result<Vec<_>, _>>().unwrap().len(), 3);
    }
    assert_eq!(budget.charged_rows(), 6);
    resource_error(consume(&evaluator, GROUPED).unwrap_err(), 7);
    assert_eq!(budget.charged_rows(), 7);
}

#[test]
fn statically_eliminated_group_does_not_charge_or_change_unconfigured_results() {
    let query = "SELECT (COUNT(*) AS ?n) WHERE { VALUES ?x {} }";
    for optimized in [false, true] {
        let budget = GroupBufferBudget::new(u64::from(!optimized));
        let baseline = values(&plain(optimized), query).unwrap();
        assert_eq!(
            values(
                &plain(optimized).with_group_buffer_budget(budget.clone()),
                query
            )
            .unwrap(),
            baseline
        );
        // Preserve the existing optimizer's removal of the entire empty plan.
        // The unoptimized physical global group still counts once.
        assert_eq!(budget.charged_rows(), u64::from(!optimized));
        budget.check().unwrap();
    }
}

#[test]
fn group_budget_is_independent_of_join_sort_and_distinct() {
    let join = InnerJoinBuildBudget::new(0);
    let sort = SortBufferBudget::new(0);
    let distinct = DistinctBufferBudget::new(0);
    let group = GroupBufferBudget::new(2);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(join.clone())
        .with_sort_buffer_budget(sort.clone())
        .with_distinct_buffer_budget(distinct.clone())
        .with_group_buffer_budget(group.clone());
    resource_error(consume(&evaluator, GROUPED).unwrap_err(), 2);
    join.check().unwrap();
    sort.check().unwrap();
    distinct.check().unwrap();
    assert_eq!(
        (
            join.charged_rows(),
            sort.charged_rows(),
            distinct.charged_rows()
        ),
        (0, 0, 0)
    );
    let zero = GroupBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_group_buffer_budget(zero.clone());
    assert_eq!(
        consume(
            &evaluator,
            "SELECT DISTINCT ?x WHERE { VALUES ?x { 1 1 2 } VALUES ?y { 3 } } ORDER BY ?x"
        )
        .unwrap(),
        2
    );
    assert_eq!(zero.charged_rows(), 0);
    zero.check().unwrap();
}

struct CountingAccumulator {
    count: usize,
    accumulated: Arc<AtomicUsize>,
}
impl AggregateFunctionAccumulator for CountingAccumulator {
    fn accumulate(&mut self, _: Term) {
        self.count += 1;
        self.accumulated.fetch_add(1, Ordering::SeqCst);
    }
    fn finish(&mut self) -> Option<Term> {
        Some(Literal::from(self.count as u64).into())
    }
}

#[test]
fn denied_group_creates_no_accumulator_and_stops_reading_child() {
    for optimized in [false, true] {
        for global in [false, true] {
            for limit in [0, 1, 3] {
                let reads = Arc::new(AtomicUsize::new(0));
                let factories = Arc::new(AtomicUsize::new(0));
                let accumulated = Arc::new(AtomicUsize::new(0));
                let budget = GroupBufferBudget::new(limit);
                let evaluator = plain(optimized)
                    .with_group_buffer_budget(budget.clone())
                    .with_custom_function(NamedNode::new_unchecked("urn:tick"), {
                        let reads = Arc::clone(&reads);
                        move |args| {
                            reads.fetch_add(1, Ordering::SeqCst);
                            args.first().cloned()
                        }
                    })
                    .with_custom_aggregate_function(NamedNode::new_unchecked("urn:probe"), {
                        let factories = Arc::clone(&factories);
                        let accumulated = Arc::clone(&accumulated);
                        move || {
                            factories.fetch_add(1, Ordering::SeqCst);
                            Box::new(CountingAccumulator {
                                count: 0,
                                accumulated: Arc::clone(&accumulated),
                            })
                        }
                    });
                let query = if global {
                    "SELECT (<urn:probe>(?v) AS ?n) WHERE { VALUES ?x { 1 1 2 3 } BIND(<urn:tick>(?x) AS ?v) }"
                } else {
                    "SELECT ?x (<urn:probe>(?v) AS ?n) WHERE { VALUES ?x { 1 1 2 3 } BIND(<urn:tick>(?x) AS ?v) } GROUP BY ?x"
                };
                let parsed = SparqlParser::new()
                    .with_custom_aggregate_function(NamedNode::new_unchecked("urn:probe"))
                    .parse_query(query)
                    .unwrap();
                let dataset = Dataset::new();
                let result = evaluator
                    .prepare(&parsed)
                    .execute(&dataset)
                    .and_then(|result| {
                        let QueryResults::Solutions(rows) = result else {
                            panic!("solutions expected");
                        };
                        rows.collect::<Result<Vec<_>, _>>()
                    });
                let (expected_reads, expected_factories, expected_accumulated) =
                    match (global, limit) {
                        (true, 0) => (0, 0, 0),
                        (true, _) => (4, 1, 4),
                        (false, 0) => (1, 0, 0),
                        (false, 1) => (3, 1, 2),
                        (false, _) => (4, 3, 4),
                    };
                if limit < if global { 1 } else { 3 } {
                    resource_error(result.unwrap_err(), limit);
                } else {
                    result.unwrap();
                }
                assert_eq!(
                    (
                        reads.load(Ordering::SeqCst),
                        factories.load(Ordering::SeqCst),
                        accumulated.load(Ordering::SeqCst)
                    ),
                    (expected_reads, expected_factories, expected_accumulated),
                    "optimized={optimized}, global={global}, limit={limit}"
                );
                assert_eq!(budget.charged_rows(), expected_factories as u64);
            }
        }
    }
}

#[test]
fn ask_exists_union_and_outer_aggregate_cannot_mask_exhausted_groups() {
    for optimized in [false, true] {
        for query in [
            format!("ASK {{ {{ {GROUPED} }} }}"),
            format!("SELECT (EXISTS {{ {{ {GROUPED} }} }} AS ?ok) WHERE {{}}"),
            format!("SELECT ?x WHERE {{ {{ {GROUPED} }} UNION {{ VALUES ?x {{ 9 }} }} }}"),
            format!("SELECT (COUNT(*) AS ?total) WHERE {{ {{ {GROUPED} }} }}"),
            format!("SELECT ?x WHERE {{ {{ {GROUPED} }} }} LIMIT 1"),
        ] {
            let budget = GroupBufferBudget::new(1);
            resource_error(
                consume(
                    &plain(optimized).with_group_buffer_budget(budget.clone()),
                    &query,
                )
                .unwrap_err(),
                1,
            );
            assert!(budget.check().is_err());
        }
    }
}

#[test]
fn service_silent_and_lazy_eof_cannot_swallow_shared_failure() {
    for lazy in [false, true] {
        let budget = GroupBufferBudget::new(0);
        let exhaust_budget = budget.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let evaluator = QueryEvaluator::new()
            .with_group_buffer_budget(budget.clone())
            .with_service_handler(
                NamedNode::new_unchecked("urn:service"),
                SwallowingService {
                    exhaust: Arc::new(move || {
                        resource_error(
                            consume(
                                &QueryEvaluator::new()
                                    .with_group_buffer_budget(exhaust_budget.clone()),
                                GROUPED,
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
