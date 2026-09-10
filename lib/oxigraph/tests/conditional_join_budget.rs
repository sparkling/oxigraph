#![cfg(test)]

use oxigraph::sparql::{
    ConditionalJoinBuildBudget, QueryResource, QueryResourcePhase, SparqlEvaluator,
    UpdateEvaluationError,
};
use oxigraph::store::{Store, TransactionKey, TransactionRequest};

#[test]
fn all_owned_native_update_bindings_share_conditional_budget_and_rollback() {
    const UPDATE: &str = "INSERT DATA { <urn:start> <urn:p> <urn:o> };
        INSERT { ?s <urn:first> ?o } WHERE { VALUES ?s { <urn:a> <urn:b> } OPTIONAL { VALUES ?o { <urn:o1> <urn:o2> } } };
        INSERT { ?s <urn:second> ?o } WHERE { VALUES ?s { <urn:a> <urn:b> } OPTIONAL { VALUES ?o { <urn:o1> <urn:o2> } } };
        INSERT DATA { <urn:end> <urn:p> <urn:o> }";
    for binding in 0..6 {
        for limit in [3, 4] {
            let store = Store::new().unwrap();
            let budget = ConditionalJoinBuildBudget::new(limit);
            let prepared = SparqlEvaluator::new()
                .without_optimizations()
                .with_conditional_join_build_budget(budget.clone())
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
                assert!(matches!(
                    result,
                    Err(UpdateEvaluationError::ResourceLimitExceeded {
                        resource: QueryResource::ConditionalJoinBuildRows,
                        phase: QueryResourcePhase::JoinBuild,
                        limit: 3,
                    })
                ));
                assert!(store.is_empty().unwrap());
                assert!(matches!(
                    SparqlEvaluator::new()
                        .with_conditional_join_build_budget(budget.clone())
                        .parse_update("INSERT DATA { <urn:late> <urn:p> <urn:o> }")
                        .unwrap()
                        .on_store(&store)
                        .execute(),
                    Err(UpdateEvaluationError::ResourceLimitExceeded { .. })
                ));
                assert!(store.is_empty().unwrap());
            } else {
                result.unwrap();
                assert_eq!(store.len().unwrap(), 10);
                budget.check().unwrap();
            }
            assert_eq!(budget.charged_rows(), limit);
        }
    }
}
