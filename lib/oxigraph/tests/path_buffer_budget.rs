#![cfg(test)]

use oxigraph::model::{Literal, NamedNode, Term};
use oxigraph::sparql::{
    PathBufferBudget, QueryResource, QueryResourcePhase, QueryResults, SparqlEvaluator,
    UpdateEvaluationError,
};
use oxigraph::store::{Store, TransactionKey, TransactionRequest};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

// Each zero-length closure retains the fixed seed in its worklist and set.
// The marker predicates are deliberately distinct from the traversed edge.
const UPDATE: &str = "INSERT DATA { <urn:start> <urn:marker> <urn:o> };
    INSERT { <urn:first> <urn:marker> ?o } WHERE { <urn:a> <urn:p>* ?o };
    INSERT { <urn:second> <urn:marker> ?o } WHERE { <urn:a> <urn:p>* ?o };
    INSERT DATA { <urn:end> <urn:marker> <urn:o> }";

#[test]
fn all_owned_update_bindings_share_path_budget_and_roll_back() {
    for binding in 0..6 {
        for limit in [3, 4] {
            let store = Store::new().unwrap();
            let budget = PathBufferBudget::new(limit);
            let prepared = SparqlEvaluator::new()
                .without_optimizations()
                .with_path_buffer_budget(budget.clone())
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
                        TransactionKey::new([3; 16]),
                    )
                    .execute_with_changes()
                    .map(|_| ()),
            };
            if limit == 3 {
                assert!(
                    matches!(
                        result,
                        Err(UpdateEvaluationError::ResourceLimitExceeded {
                            resource: QueryResource::PathBufferRows,
                            phase: QueryResourcePhase::PathBuffer,
                            limit: 3,
                        })
                    ),
                    "binding {binding}: {result:?}"
                );
                assert!(store.is_empty().unwrap());
                // A swallowed error cannot make a later constant write commit.
                assert!(matches!(
                    SparqlEvaluator::new()
                        .with_path_buffer_budget(budget.clone())
                        .parse_update("INSERT DATA { <urn:late> <urn:marker> <urn:o> }")
                        .unwrap()
                        .on_store(&store)
                        .execute(),
                    Err(UpdateEvaluationError::ResourceLimitExceeded {
                        resource: QueryResource::PathBufferRows,
                        ..
                    })
                ));
                assert!(store.is_empty().unwrap());
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
fn callback_triggered_path_failure_is_caught_before_owned_commit() {
    let store = Store::new().unwrap();
    let budget = PathBufferBudget::new(0);
    let called = Arc::new(AtomicBool::new(false));
    let result = SparqlEvaluator::new()
        .with_path_buffer_budget(budget.clone())
        .with_custom_function(NamedNode::new_unchecked("urn:trigger"), {
            let budget = budget.clone();
            let called = Arc::clone(&called);
            move |_| {
                called.store(true, Ordering::SeqCst);
                let child_store = Store::new().unwrap();
                if let Ok(QueryResults::Solutions(mut rows)) = SparqlEvaluator::new()
                    .with_path_buffer_budget(budget.clone())
                    .parse_query("SELECT ?o WHERE { <urn:a> <urn:p>* ?o }")
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
            "INSERT DATA { <urn:before> <urn:marker> <urn:o> };
             INSERT { <urn:s> <urn:marker> ?o } WHERE { BIND(<urn:trigger>() AS ?o) }",
        )
        .unwrap()
        .on_store(&store)
        .execute();
    assert!(called.load(Ordering::SeqCst));
    assert!(matches!(
        result,
        Err(UpdateEvaluationError::ResourceLimitExceeded {
            resource: QueryResource::PathBufferRows,
            phase: QueryResourcePhase::PathBuffer,
            limit: 0,
        })
    ));
    assert!(store.is_empty().unwrap());
}
