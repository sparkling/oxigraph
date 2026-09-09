use oxigraph::sparql::{
    InnerJoinBuildBudget, QueryResource, QueryResourcePhase, SortBufferBudget, SparqlEvaluator,
    UpdateEvaluationError,
};
use oxigraph::store::{Store, TransactionKey, TransactionRequest};

// Each ORDER BY subselect admits two rows; the update never materializes a join.
const UPDATE: &str = "INSERT DATA { <urn:start> <urn:p> <urn:o> };
    INSERT { ?s <urn:first> <urn:o> } WHERE {
        { SELECT ?s WHERE { VALUES ?s { <urn:b> <urn:a> } } ORDER BY ?s } };
    INSERT { ?s <urn:second> <urn:o> } WHERE {
        { SELECT ?s WHERE { VALUES ?s { <urn:b> <urn:a> } } ORDER BY ?s } };
    INSERT DATA { <urn:end> <urn:p> <urn:o> }";

#[test]
fn all_owned_native_update_bindings_share_the_budget_and_preserve_atomicity() {
    for binding in 0..6 {
        for limit in [3, 4] {
            let store = Store::new().unwrap();
            let budget = SortBufferBudget::new(limit);
            // A zero join budget proves the sorted VALUES never charge joins.
            let join = InnerJoinBuildBudget::new(0);
            let prepared = SparqlEvaluator::new()
                .without_optimizations()
                .with_inner_join_build_budget(join.clone())
                .with_sort_buffer_budget(budget.clone())
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
                            resource: QueryResource::SortBufferRows,
                            phase: QueryResourcePhase::SortBuffer,
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
                        .with_sort_buffer_budget(budget.clone())
                        .parse_update("INSERT DATA { <urn:late> <urn:p> <urn:o> }")
                        .unwrap()
                        .on_store(&store)
                        .execute(),
                    Err(UpdateEvaluationError::ResourceLimitExceeded {
                        resource: QueryResource::SortBufferRows,
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
            assert_eq!(join.charged_rows(), 0);
        }
    }
}

#[test]
fn store_queries_preserve_order_and_fail_typed_across_result_kinds() {
    let store = Store::new().unwrap();
    SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:a> <urn:p> 2 . <urn:b> <urn:p> 1 . <urn:c> <urn:p> 3 }")
        .unwrap()
        .on_store(&store)
        .execute()
        .unwrap();
    let query = "SELECT ?s WHERE { ?s <urn:p> ?v } ORDER BY DESC(?v)";
    let ordered = |evaluator: SparqlEvaluator| -> Result<Vec<String>, _> {
        let oxigraph::sparql::QueryResults::Solutions(rows) = evaluator
            .parse_query(query)
            .unwrap()
            .on_store(&store)
            .execute()?
        else {
            panic!("solutions expected");
        };
        rows.map(|row| row.map(|row| row.get("s").unwrap().to_string()))
            .collect()
    };
    let baseline = ordered(SparqlEvaluator::new()).unwrap();
    assert_eq!(baseline, ["<urn:c>", "<urn:a>", "<urn:b>"]);
    let budget = SortBufferBudget::new(3);
    assert_eq!(
        ordered(SparqlEvaluator::new().with_sort_buffer_budget(budget.clone())).unwrap(),
        baseline
    );
    assert_eq!(budget.charged_rows(), 3);
    let budget = SortBufferBudget::new(2);
    assert!(matches!(
        ordered(SparqlEvaluator::new().with_sort_buffer_budget(budget.clone())),
        Err(
            oxigraph::sparql::QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::SortBufferRows,
                phase: QueryResourcePhase::SortBuffer,
                limit: 2,
            }
        )
    ));
    // The shared latch also fails ASK and CONSTRUCT bound from clones.
    let evaluator = SparqlEvaluator::new().with_sort_buffer_budget(budget.clone());
    assert!(matches!(
        evaluator
            .clone()
            .parse_query("ASK {}")
            .unwrap()
            .on_store(&store)
            .execute(),
        Err(oxigraph::sparql::QueryEvaluationError::ResourceLimitExceeded { .. })
    ));
    assert!(matches!(
        evaluator
            .parse_query("CONSTRUCT WHERE { ?s ?p ?o }")
            .unwrap()
            .on_store(&store)
            .execute(),
        Err(oxigraph::sparql::QueryEvaluationError::ResourceLimitExceeded { .. })
    ));
    assert_eq!(budget.charged_rows(), 2);
}
