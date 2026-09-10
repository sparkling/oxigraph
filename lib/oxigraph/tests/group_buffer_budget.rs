#![cfg(test)]
use oxigraph::model::{Literal, NamedNode, Term};
use oxigraph::sparql::{
    AggregateDistinctBudget, GroupBufferBudget, InnerJoinBuildBudget, QueryResource,
    QueryResourcePhase, QueryResults, SortBufferBudget, SparqlEvaluator, UpdateEvaluationError,
};
use oxigraph::store::{Store, TransactionKey, TransactionRequest};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

// Each GROUP BY subselect retains two groups from three input tuples.
const UPDATE: &str = "INSERT DATA { <urn:start> <urn:p> <urn:o> };
    INSERT { ?s <urn:first> <urn:o> } WHERE {
        { SELECT ?s (COUNT(*) AS ?n) WHERE { VALUES ?s { <urn:b> <urn:a> <urn:b> } } GROUP BY ?s } };
    INSERT { ?s <urn:second> <urn:o> } WHERE {
        { SELECT ?s (COUNT(*) AS ?n) WHERE { VALUES ?s { <urn:b> <urn:a> <urn:b> } } GROUP BY ?s } };
    INSERT DATA { <urn:end> <urn:p> <urn:o> }";

const AGGREGATE_DISTINCT_UPDATE: &str = "INSERT DATA { <urn:start> <urn:p> <urn:o> };
    INSERT { <urn:first> <urn:p> ?n } WHERE {
        { SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES ?x { 1 1 2 } } } };
    INSERT { <urn:second> <urn:p> ?n } WHERE {
        { SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES ?x { 1 1 2 } } } };
    INSERT DATA { <urn:end> <urn:p> <urn:o> }";

#[test]
fn all_owned_update_bindings_share_aggregate_distinct_budget_and_roll_back() {
    for binding in 0..6 {
        for limit in [3, 4] {
            let store = Store::new().unwrap();
            let budget = AggregateDistinctBudget::new(limit);
            let prepared = SparqlEvaluator::new()
                .without_optimizations()
                .with_aggregate_distinct_budget(budget.clone())
                .parse_update(AGGREGATE_DISTINCT_UPDATE)
                .unwrap();
            let result = match binding {
                0 => prepared.on_store(&store).execute(),
                1 => prepared.on_dataset(&store).execute(),
                2 => prepared
                    .on_dataset(&store)
                    .execute_with_changes()
                    .map(|_| ()),
                3 => prepared
                    .on_dataset_with_request(&store, TransactionRequest::default())
                    .execute(),
                4 => prepared
                    .on_dataset_with_request(&store, TransactionRequest::default())
                    .execute_with_changes()
                    .map(|_| ()),
                _ => prepared
                    .on_dataset_with_key(
                        &store,
                        TransactionRequest::default(),
                        TransactionKey::new([2; 16]),
                    )
                    .execute_with_changes()
                    .map(|_| ()),
            };
            if limit == 3 {
                assert!(matches!(
                    result,
                    Err(UpdateEvaluationError::ResourceLimitExceeded {
                        resource: QueryResource::AggregateDistinctRows,
                        phase: QueryResourcePhase::AggregateDistinct,
                        limit: 3,
                    })
                ));
                assert!(store.is_empty().unwrap());
                assert!(matches!(
                    SparqlEvaluator::new()
                        .with_aggregate_distinct_budget(budget.clone())
                        .parse_update("INSERT DATA { <urn:late> <urn:p> <urn:o> }")
                        .unwrap()
                        .on_store(&store)
                        .execute(),
                    Err(UpdateEvaluationError::ResourceLimitExceeded {
                        resource: QueryResource::AggregateDistinctRows,
                        ..
                    })
                ));
            } else {
                result.unwrap();
                assert_eq!(store.len().unwrap(), 4);
                budget.check().unwrap();
            }
            assert_eq!(budget.charged_rows(), limit);
        }
    }
}

#[test]
fn callback_triggered_aggregate_distinct_failure_is_caught_before_owned_commit() {
    let store = Store::new().unwrap();
    let budget = AggregateDistinctBudget::new(0);
    let called = Arc::new(AtomicBool::new(false));
    let result = SparqlEvaluator::new()
        .with_aggregate_distinct_budget(budget.clone())
        .with_custom_function(NamedNode::new_unchecked("urn:trigger"), {
            let budget = budget.clone();
            let called = Arc::clone(&called);
            move |_| {
                called.store(true, Ordering::SeqCst);
                let child_store = Store::new().unwrap();
                if let Ok(QueryResults::Solutions(mut rows)) = SparqlEvaluator::new()
                    .with_aggregate_distinct_budget(budget.clone())
                    .parse_query(
                        "SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { VALUES ?x { 1 } }",
                    )
                    .unwrap()
                    .on_store(&child_store)
                    .execute()
                {
                    drop(rows.next());
                }
                Some(Term::Literal(Literal::from(1)))
            }
        })
        .parse_update(
            "INSERT DATA { <urn:before> <urn:p> <urn:o> }; INSERT { <urn:s> <urn:p> ?o } WHERE { BIND(<urn:trigger>() AS ?o) }",
        )
        .unwrap()
        .on_store(&store)
        .execute();
    assert!(called.load(Ordering::SeqCst));
    assert!(matches!(
        result,
        Err(UpdateEvaluationError::ResourceLimitExceeded {
            resource: QueryResource::AggregateDistinctRows,
            phase: QueryResourcePhase::AggregateDistinct,
            limit: 0,
        })
    ));
    assert!(store.is_empty().unwrap());
}

#[test]
fn all_owned_native_update_bindings_share_the_budget_and_preserve_atomicity() {
    for binding in 0..6 {
        for limit in [3, 4] {
            let store = Store::new().unwrap();
            let budget = GroupBufferBudget::new(limit);
            // Zero join/sort budgets prove the GROUP BY subselects charge only
            // the group counter.
            let join = InnerJoinBuildBudget::new(0);
            let sort = SortBufferBudget::new(0);
            let prepared = SparqlEvaluator::new()
                .without_optimizations()
                .with_inner_join_build_budget(join.clone())
                .with_sort_buffer_budget(sort.clone())
                .with_group_buffer_budget(budget.clone())
                .parse_update(UPDATE)
                .unwrap();
            let result = match binding {
                0 => prepared.on_store(&store).execute(),
                1 => prepared.on_dataset(&store).execute(),
                2 => prepared
                    .on_dataset(&store)
                    .execute_with_changes()
                    .map(|_| ()),
                3 => prepared
                    .on_dataset_with_request(&store, TransactionRequest::default())
                    .execute(),
                4 => prepared
                    .on_dataset_with_request(&store, TransactionRequest::default())
                    .execute_with_changes()
                    .map(|_| ()),
                _ => prepared
                    .on_dataset_with_key(
                        &store,
                        TransactionRequest::default(),
                        TransactionKey::new([1; 16]),
                    )
                    .execute_with_changes()
                    .map(|_| ()),
            };
            if limit == 3 {
                assert!(
                    matches!(
                        result,
                        Err(UpdateEvaluationError::ResourceLimitExceeded {
                            resource: QueryResource::GroupBufferRows,
                            phase: QueryResourcePhase::GroupBuffer,
                            limit: 3,
                        })
                    ),
                    "binding {binding}: {result:?}"
                );
                assert!(store.is_empty().unwrap());
                if binding == 0 {
                    assert_eq!(
                        store.evaluation_metrics().count(
                            oxigraph::store::EvaluationOperation::Update,
                            oxigraph::store::EvaluationOutcome::Failed
                        ),
                        1
                    );
                }
                // The same exhausted evaluator cannot later commit constant writes.
                assert!(matches!(
                    SparqlEvaluator::new()
                        .with_group_buffer_budget(budget.clone())
                        .parse_update("INSERT DATA { <urn:late> <urn:p> <urn:o> }")
                        .unwrap()
                        .on_store(&store)
                        .execute(),
                    Err(UpdateEvaluationError::ResourceLimitExceeded {
                        resource: QueryResource::GroupBufferRows,
                        ..
                    })
                ));
                assert!(store.is_empty().unwrap());
            } else {
                result.unwrap();
                assert_eq!(store.len().unwrap(), 6);
                if binding == 0 {
                    assert_eq!(
                        store.evaluation_metrics().count(
                            oxigraph::store::EvaluationOperation::Update,
                            oxigraph::store::EvaluationOutcome::Succeeded
                        ),
                        1
                    );
                }
                budget.check().unwrap();
            }
            assert_eq!(budget.charged_rows(), limit);
            join.check().unwrap();
            sort.check().unwrap();
            assert_eq!(join.charged_rows(), 0);
            assert_eq!(sort.charged_rows(), 0);
        }
    }
}

#[test]
#[expect(
    clippy::panic,
    reason = "unexpected query result variant fails the fixture"
)]
fn store_group_values_and_sticky_result_kind_failures() {
    use oxigraph::sparql::{QueryEvaluationError, QueryResults};
    let store = Store::new().unwrap();
    SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:a> <urn:p> 1 . <urn:b> <urn:p> 1 . <urn:c> <urn:p> 2 }")
        .unwrap()
        .on_store(&store)
        .execute()
        .unwrap();
    for optimized in [false, true] {
        let budget = GroupBufferBudget::new(2);
        let plain = if optimized {
            SparqlEvaluator::new()
        } else {
            SparqlEvaluator::new().without_optimizations()
        };
        let evaluator = plain.clone().with_group_buffer_budget(budget.clone());
        let query = "SELECT ?v (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?v } GROUP BY ?v";
        let mut baseline = Vec::new();
        for evaluator in [plain, evaluator.clone()] {
            let QueryResults::Solutions(rows) = evaluator
                .parse_query(query)
                .unwrap()
                .on_store(&store)
                .execute()
                .unwrap()
            else {
                panic!("solutions expected");
            };
            let mut values = rows
                .map(|row| {
                    let row = row.unwrap();
                    [
                        row.get("v").unwrap().to_string(),
                        row.get("n").unwrap().to_string(),
                    ]
                })
                .collect::<Vec<_>>();
            values.sort();
            assert_eq!(values.len(), 2);
            if baseline.is_empty() {
                baseline = values;
            } else {
                assert_eq!(values, baseline);
            }
        }
        assert_eq!(budget.charged_rows(), 2);
        let QueryResults::Solutions(mut rows) = evaluator
            .clone()
            .parse_query(query)
            .unwrap()
            .on_store(&store)
            .execute()
            .unwrap()
        else {
            panic!("solutions expected");
        };
        assert!(matches!(
            rows.next().unwrap(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::GroupBufferRows,
                phase: QueryResourcePhase::GroupBuffer,
                limit: 2
            })
        ));
        assert!(rows.next().is_none());
        for query in ["ASK {}", "CONSTRUCT WHERE { ?s ?p ?o }"] {
            assert!(matches!(
                evaluator
                    .clone()
                    .parse_query(query)
                    .unwrap()
                    .on_store(&store)
                    .execute(),
                Err(QueryEvaluationError::ResourceLimitExceeded {
                    resource: QueryResource::GroupBufferRows,
                    ..
                })
            ));
        }
        assert_eq!(store.len().unwrap(), 3);
    }
}
