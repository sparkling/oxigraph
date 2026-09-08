#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "public evaluation telemetry assertions"
)]
use oxigraph::model::{Dataset, NamedNode, Variable};
use oxigraph::sparql::{
    CancellationToken, QueryEntailmentOptions, QueryEvaluationError, QueryResults, SparqlEvaluator,
};
use oxigraph::store::{
    EvaluationMetrics, EvaluationOperation as Operation, EvaluationOutcome as Outcome, Store,
    TransactionObservation,
};
use std::error::Error;

type TestResult = Result<(), Box<dyn Error + Send + Sync>>;

fn count(store: &Store, operation: Operation, outcome: Outcome) -> u64 {
    store.evaluation_metrics().count(operation, outcome)
}

#[test]
fn boolean_completion_and_parse_failures_are_distinct() -> TestResult {
    let store = Store::new()?;
    let cloned = store.clone();
    assert!(SparqlEvaluator::new().parse_query("not a query").is_err());
    assert_eq!(store.evaluation_metrics(), EvaluationMetrics::default());
    for query in ["ASK {}", "ASK { <urn:private:s> <urn:p> <urn:o> }"] {
        assert!(matches!(
            SparqlEvaluator::new()
                .parse_query(query)?
                .on_store(&store)
                .execute()?,
            QueryResults::Boolean(_)
        ));
    }
    assert_eq!(count(&cloned, Operation::Query, Outcome::Succeeded), 2);
    assert_eq!(count(&cloned, Operation::Update, Outcome::Succeeded), 0);
    Ok(())
}

#[test]
fn lazy_solution_success_requires_eof_and_drop_is_abandoned() -> TestResult {
    let store = Store::new()?;
    let query = SparqlEvaluator::new()
        .parse_query("SELECT ?x WHERE { VALUES ?x { <urn:private:value> } }")?;
    let QueryResults::Solutions(mut rows) = query.clone().on_store(&store).execute()? else {
        return Err("solutions expected".into());
    };
    assert_eq!(rows.variables(), &[Variable::new("x")?]);
    assert_eq!(store.evaluation_metrics(), EvaluationMetrics::default());
    assert_eq!(
        rows.next().transpose()?.unwrap()["x"],
        NamedNode::new("urn:private:value")?
    );
    assert_eq!(count(&store, Operation::Query, Outcome::Succeeded), 0);
    assert!(rows.next().is_none());
    assert!(rows.next().is_none());
    drop(rows);
    assert_eq!(count(&store, Operation::Query, Outcome::Succeeded), 1);
    let QueryResults::Solutions(mut rows) = query.clone().on_store(&store).execute()? else {
        return Err("solutions expected".into());
    };
    assert!(rows.next().transpose()?.is_some());
    drop(rows);
    drop(query.on_store(&store));
    assert_eq!(count(&store, Operation::Query, Outcome::Abandoned), 2);
    Ok(())
}

#[test]
fn graph_completion_explanation_and_substitution_are_preserved() -> TestResult {
    let store = Store::new()?;
    let query = SparqlEvaluator::new()
        .parse_query("CONSTRUCT { ?s <urn:p> <urn:o> } WHERE { VALUES ?s { <urn:s> } }")?;
    let QueryResults::Graph(mut triples) = query.clone().on_store(&store).execute()? else {
        return Err("graph expected".into());
    };
    assert!(triples.next().transpose()?.is_some());
    assert_eq!(count(&store, Operation::Query, Outcome::Succeeded), 0);
    assert!(triples.next().is_none());
    drop(triples);
    drop(query.on_store(&store).execute()?);
    assert_eq!(count(&store, Operation::Query, Outcome::Abandoned), 1);
    let (result, _explanation) = SparqlEvaluator::new()
        .parse_query("SELECT ?x WHERE {}")?
        .on_store(&store)
        .substitute_variable(Variable::new("x")?, NamedNode::new("urn:substitution")?)
        .explain();
    let QueryResults::Solutions(mut rows) = result? else {
        return Err("solutions expected".into());
    };
    assert_eq!(
        rows.next().transpose()?.unwrap()["x"],
        NamedNode::new("urn:substitution")?
    );
    assert!(rows.next().is_none());
    assert_eq!(count(&store, Operation::Query, Outcome::Succeeded), 2);
    Ok(())
}

#[test]
fn first_returned_error_and_cancellation_are_counted_once() -> TestResult {
    let store = Store::new()?;
    let error = SparqlEvaluator::new()
        .parse_query("SELECT ?x WHERE {}")?
        .on_store(&store)
        .substitute_variable(
            Variable::new("missing")?,
            NamedNode::new("urn:private:error")?,
        )
        .execute();
    assert!(matches!(
        error,
        Err(QueryEvaluationError::NotExistingSubstitutedVariable(_))
    ));
    assert_eq!(count(&store, Operation::Query, Outcome::Failed), 1);
    SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:s> <urn:p> 1, 2, 3 }")?
        .on_store(&store)
        .execute()?;
    let token = CancellationToken::new();
    let query = SparqlEvaluator::new()
        .with_cancellation_token(token.clone())
        .parse_query("SELECT ?x WHERE { <urn:s> <urn:p> ?x }")?;
    let QueryResults::Solutions(mut rows) = query.on_store(&store).execute()? else {
        return Err("solutions expected".into());
    };
    assert!(rows.next().transpose()?.is_some());
    token.cancel();
    assert!(matches!(
        rows.next(),
        Some(Err(QueryEvaluationError::Cancelled))
    ));
    drop(rows);
    assert_eq!(count(&store, Operation::Query, Outcome::Cancelled), 1);
    assert_eq!(count(&store, Operation::Query, Outcome::Succeeded), 0);
    assert_eq!(count(&store, Operation::Query, Outcome::Abandoned), 0);
    assert!(matches!(
        SparqlEvaluator::new()
            .with_cancellation_token(token)
            .parse_query("ASK { ?s ?p ?o }")?
            .on_store(&store)
            .execute(),
        Err(QueryEvaluationError::Cancelled)
    ));
    assert_eq!(count(&store, Operation::Query, Outcome::Cancelled), 2);
    Ok(())
}

#[test]
fn generic_and_borrowed_bindings_are_not_attributed() -> TestResult {
    let store = Store::new()?;
    let query = SparqlEvaluator::new().parse_query("ASK {}")?;
    assert!(matches!(
        query
            .clone()
            .on_queryable_dataset(&Dataset::new())
            .execute()?,
        QueryResults::Boolean(true)
    ));
    let mut transaction = store.start_transaction()?;
    assert!(matches!(
        query.on_transaction(&transaction).execute()?,
        QueryResults::Boolean(true)
    ));
    SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:s> <urn:p> <urn:o> }")?
        .on_transaction(&mut transaction)
        .execute()?;
    transaction.commit()?;
    SparqlEvaluator::new()
        .parse_update("CLEAR DEFAULT")?
        .on_dataset(&store)
        .execute()?;
    assert_eq!(store.evaluation_metrics(), EvaluationMetrics::default());
    Ok(())
}

#[test]
fn explicit_entailment_binding_is_attributed() -> TestResult {
    let store = Store::new()?;
    assert!(matches!(
        SparqlEvaluator::new()
            .parse_query("ASK {}")?
            .on_store_with_entailment(&store, &QueryEntailmentOptions::default())?
            .execute()?,
        QueryResults::Boolean(true)
    ));
    assert_eq!(count(&store, Operation::Query, Outcome::Succeeded), 1);
    Ok(())
}

#[cfg(not(feature = "rdfs"))]
#[test]
fn failed_entailment_binding_is_observed_without_execution() -> TestResult {
    let store = Store::new()?;
    assert!(
        SparqlEvaluator::new()
            .parse_query("ASK {}")?
            .on_store_with_entailment(
                &store,
                &QueryEntailmentOptions::new(oxigraph::sparql::QueryEntailment::Rdfs12Finite)
            )
            .is_err()
    );
    assert_eq!(count(&store, Operation::Query, Outcome::Failed), 1);
    assert_eq!(count(&store, Operation::Query, Outcome::Abandoned), 0);
    Ok(())
}

#[cfg(feature = "http-client")]
#[test]
fn lazy_denial_finishes_only_on_first_returned_error() -> TestResult {
    let store = Store::new()?;
    let QueryResults::Solutions(mut rows) = SparqlEvaluator::new()
        .with_deny_all_egress_policy()
        .parse_query("SELECT * WHERE { SERVICE <http://example.invalid/private> { ?s ?p ?o } }")?
        .on_store(&store)
        .execute()?
    else {
        return Err("solutions expected".into());
    };
    assert_eq!(store.evaluation_metrics(), EvaluationMetrics::default());
    assert!(rows.next().unwrap().is_err());
    assert_eq!(count(&store, Operation::Query, Outcome::PolicyDenied), 1);
    drop(rows.next());
    drop(rows);
    assert_eq!(count(&store, Operation::Query, Outcome::PolicyDenied), 1);
    assert_eq!(count(&store, Operation::Query, Outcome::Abandoned), 0);
    assert_eq!(count(&store, Operation::Query, Outcome::Failed), 0);
    Ok(())
}

fn update_journey(store: &Store) -> TestResult {
    let update = SparqlEvaluator::new().parse_update("INSERT DATA { <urn:s> <urn:p> <urn:o> }")?;
    update.clone().on_store(store).execute()?;
    SparqlEvaluator::new()
        .parse_update("DELETE WHERE { ?s ?p ?o }")?
        .on_store(store)
        .execute()?;
    assert!(store.is_empty()?);
    assert_eq!(count(store, Operation::Update, Outcome::Succeeded), 2);
    let result = SparqlEvaluator::new().parse_update("INSERT DATA { <urn:private:rollback> <urn:p> <urn:o> }; CREATE GRAPH <urn:g>; CREATE GRAPH <urn:g>")?.on_store(store).execute();
    assert!(result.is_err());
    assert!(store.is_empty()?);
    assert!(!store.contains_named_graph(&NamedNode::new("urn:g")?.into())?);
    assert_eq!(count(store, Operation::Update, Outcome::Failed), 1);
    assert_eq!(
        store
            .transaction_metrics()
            .count(TransactionObservation::Abandoned),
        1
    );
    drop(update.on_store(store));
    assert_eq!(count(store, Operation::Update, Outcome::Abandoned), 1);
    let before = store.transaction_metrics();
    let token = CancellationToken::new();
    token.cancel();
    assert!(matches!(
        SparqlEvaluator::new()
            .with_cancellation_token(token)
            .parse_update("INSERT DATA { <urn:cancelled> <urn:p> <urn:o> }")?
            .on_store(store)
            .execute(),
        Err(oxigraph::sparql::UpdateEvaluationError::Cancelled)
    ));
    assert_eq!(count(store, Operation::Update, Outcome::Cancelled), 1);
    assert_eq!(store.transaction_metrics(), before);
    Ok(())
}

#[test]
fn in_memory_updates_preserve_effects_and_cleanup() -> TestResult {
    update_journey(&Store::new()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn persistent_updates_reopen_and_read_only_admission() -> TestResult {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    update_journey(&store)?;
    SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:persisted> <urn:p> <urn:o> }")?
        .on_store(&store)
        .execute()?;
    store.flush()?;
    drop(store);
    let store = Store::open_read_only(directory.path())?;
    assert_eq!(store.len()?, 1);
    assert_eq!(store.evaluation_metrics(), EvaluationMetrics::default());
    assert!(
        SparqlEvaluator::new()
            .parse_update("CLEAR ALL")?
            .on_store(&store)
            .execute()
            .is_err()
    );
    assert_eq!(count(&store, Operation::Update, Outcome::Failed), 1);
    assert_eq!(
        store
            .transaction_metrics()
            .count(TransactionObservation::Abandoned),
        0
    );
    assert_eq!(store.len()?, 1);
    Ok(())
}

#[cfg(feature = "http-client")]
#[test]
fn denied_operations_and_silent_success_have_distinct_outcomes() -> TestResult {
    let store = Store::new()?;
    let evaluator = SparqlEvaluator::new().with_deny_all_egress_policy();
    for silent in [false, true] {
        let keyword = if silent { "SILENT" } else { "" };
        let result = evaluator
            .clone()
            .parse_update(&format!("LOAD {keyword} <http://example.invalid/private>"))?
            .on_store(&store)
            .execute();
        assert_eq!(result.is_ok(), silent);
        let result = evaluator
            .clone()
            .parse_query(&format!(
                "ASK {{ SERVICE {keyword} <http://example.invalid/private> {{ ?s ?p ?o }} }}"
            ))?
            .on_store(&store)
            .execute();
        assert_eq!(result.is_ok(), silent);
    }
    for operation in Operation::ALL {
        assert_eq!(count(&store, operation, Outcome::PolicyDenied), 1);
        assert_eq!(count(&store, operation, Outcome::Succeeded), 1);
        assert_eq!(count(&store, operation, Outcome::Failed), 0);
    }
    Ok(())
}

#[cfg(feature = "http-client")]
#[test]
fn expired_remote_deadline_is_not_a_policy_denial() -> TestResult {
    let store = Store::new()?;
    let evaluator = SparqlEvaluator::new()
        .with_deny_all_egress_policy()
        .with_http_timeout(std::time::Duration::ZERO);
    assert!(
        evaluator
            .clone()
            .parse_query("ASK { SERVICE <http://example.invalid/private> { ?s ?p ?o } }")?
            .on_store(&store)
            .execute()
            .is_err()
    );
    assert!(
        evaluator
            .parse_update("LOAD <http://example.invalid/private>")?
            .on_store(&store)
            .execute()
            .is_err()
    );
    for operation in Operation::ALL {
        assert_eq!(count(&store, operation, Outcome::TimedOut), 1);
        assert_eq!(count(&store, operation, Outcome::PolicyDenied), 0);
    }
    Ok(())
}

#[test]
fn prometheus_has_fixed_labels_consistent_histograms_and_no_request_data() -> TestResult {
    let store = Store::new()?;
    update_journey(&store)?;
    let metrics = store.evaluation_metrics();
    let mut output = String::new();
    metrics.write_prometheus(&mut output)?;
    assert_eq!(
        output.lines().filter(|line| !line.starts_with('#')).count(),
        154
    );
    assert_eq!(
        output
            .lines()
            .filter(|line| line.starts_with("# TYPE"))
            .count(),
        4
    );
    assert!(!output.contains("private") && !output.contains("urn:"));
    for operation in Operation::ALL {
        for outcome in Outcome::ALL {
            let histogram = metrics.duration(operation, outcome);
            let buckets: Vec<_> = histogram.buckets().collect();
            assert_eq!(buckets.len(), 8);
            assert_eq!(
                buckets.last(),
                Some(&(None, metrics.count(operation, outcome)))
            );
            assert!(
                buckets
                    .iter()
                    .zip(buckets.iter().skip(1))
                    .all(|(left, right)| left.1 <= right.1)
            );
        }
    }
    Ok(())
}
