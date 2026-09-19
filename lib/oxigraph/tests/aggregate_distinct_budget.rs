#![cfg(test)]
#![expect(
    clippy::panic,
    reason = "a wrong result variant fails the integration fixture"
)]

use oxigraph::sparql::{
    AggregateDistinctBudget, DistinctBufferBudget, QueryEvaluationError, QueryResource,
    QueryResourcePhase, QueryResults, SparqlEvaluator,
};
use oxigraph::store::Store;

// Four distinct objects behind one subject, so an aggregate DISTINCT retains
// four keys while a plain solution-level DISTINCT would retain only one row.
const FIXTURE: &str = "INSERT DATA {
    <urn:s> <urn:p> 1 .
    <urn:s> <urn:p> 2 .
    <urn:s> <urn:p> 3 .
    <urn:s> <urn:p> 4
}";

fn loaded_store() -> Store {
    let store = Store::new().unwrap();
    SparqlEvaluator::new()
        .parse_update(FIXTURE)
        .unwrap()
        .on_store(&store)
        .execute()
        .unwrap();
    store
}

fn count_distinct(
    store: &Store,
    evaluator: SparqlEvaluator,
) -> Result<Vec<String>, QueryEvaluationError> {
    let QueryResults::Solutions(rows) = evaluator
        .parse_query("SELECT (COUNT(DISTINCT ?o) AS ?c) WHERE { ?s <urn:p> ?o }")
        .unwrap()
        .on_store(store)
        .execute()?
    else {
        panic!("solutions expected");
    };
    rows.map(|row| row.map(|row| row.get("c").unwrap().to_string()))
        .collect()
}

#[test]
fn aggregate_distinct_budget_trips_on_a_wide_count_distinct() {
    let store = loaded_store();
    let budget = AggregateDistinctBudget::new(3);
    let result = count_distinct(
        &store,
        SparqlEvaluator::new().with_aggregate_distinct_budget(budget.clone()),
    );
    assert!(
        matches!(
            result,
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::AggregateDistinctRows,
                phase: QueryResourcePhase::AggregateDistinct,
                limit: 3,
            })
        ),
        "{result:?}"
    );
    // The budget stops at its own limit rather than over-charging.
    assert_eq!(budget.charged_rows(), 3);
}

#[test]
fn aggregate_distinct_budget_above_the_key_count_returns_the_full_aggregate() {
    let store = loaded_store();
    let baseline = count_distinct(&store, SparqlEvaluator::new()).unwrap();
    assert_eq!(
        baseline,
        ["\"4\"^^<http://www.w3.org/2001/XMLSchema#integer>"]
    );
    let budget = AggregateDistinctBudget::new(4);
    assert_eq!(
        count_distinct(
            &store,
            SparqlEvaluator::new().with_aggregate_distinct_budget(budget.clone())
        )
        .unwrap(),
        baseline
    );
    assert_eq!(budget.charged_rows(), 4);
    budget.check().unwrap();
}

#[test]
fn aggregate_distinct_budget_of_zero_rejects_before_any_key_is_retained() {
    let store = loaded_store();
    let budget = AggregateDistinctBudget::new(0);
    assert!(matches!(
        count_distinct(
            &store,
            SparqlEvaluator::new().with_aggregate_distinct_budget(budget.clone())
        ),
        Err(QueryEvaluationError::ResourceLimitExceeded {
            resource: QueryResource::AggregateDistinctRows,
            ..
        })
    ));
    assert_eq!(budget.charged_rows(), 0);
}

#[test]
fn aggregate_distinct_and_solution_distinct_budgets_charge_independently() {
    let store = loaded_store();
    // A solution-level DISTINCT budget of 1 admits the single aggregate row, so
    // only the aggregate counter can reject this query.
    let aggregate = AggregateDistinctBudget::new(2);
    let solutions = DistinctBufferBudget::new(1);
    assert!(matches!(
        count_distinct(
            &store,
            SparqlEvaluator::new()
                .with_aggregate_distinct_budget(aggregate.clone())
                .with_distinct_buffer_budget(solutions.clone())
        ),
        Err(QueryEvaluationError::ResourceLimitExceeded {
            resource: QueryResource::AggregateDistinctRows,
            ..
        })
    ));
    assert_eq!(aggregate.charged_rows(), 2);
    // The aggregate keys never touched the solution-level counter.
    assert_eq!(solutions.charged_rows(), 0);
    solutions.check().unwrap();
}

#[test]
fn a_tripped_aggregate_distinct_budget_stays_failed_for_later_queries() {
    let store = loaded_store();
    let budget = AggregateDistinctBudget::new(1);
    assert!(
        count_distinct(
            &store,
            SparqlEvaluator::new().with_aggregate_distinct_budget(budget.clone())
        )
        .is_err()
    );
    // The latch is shared through the clone, so even a query that needs no
    // aggregate at all fails closed rather than silently succeeding.
    assert!(matches!(
        SparqlEvaluator::new()
            .with_aggregate_distinct_budget(budget)
            .parse_query("ASK {}")
            .unwrap()
            .on_store(&store)
            .execute(),
        Err(QueryEvaluationError::ResourceLimitExceeded {
            resource: QueryResource::AggregateDistinctRows,
            ..
        })
    ));
}
