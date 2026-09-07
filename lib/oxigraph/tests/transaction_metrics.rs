#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "public transaction telemetry assertions"
)]
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::sparql::SparqlEvaluator;
use oxigraph::store::{
    NegotiatedTransactionalDataset, OutcomeAwareTransactionalDataset, Store, TransactionKey,
    TransactionMetrics, TransactionObservation as Observation, TransactionRequest,
    TransactionStartControl, WritableDataset,
};
use std::error::Error;

type TestResult = Result<(), Box<dyn Error + Send + Sync>>;

fn quad(id: &str) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:private:{id}")),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:o"),
        GraphName::DefaultGraph,
    )
}

fn histogram_invariants(metrics: &TransactionMetrics) {
    for outcome in Observation::ALL {
        let histogram = metrics.duration(outcome);
        let buckets: Vec<_> = histogram.buckets().collect();
        assert_eq!(buckets.len(), 8);
        assert_eq!(buckets.last(), Some(&(None, metrics.count(outcome))));
        assert!(
            buckets
                .iter()
                .zip(buckets.iter().skip(1))
                .all(|(left, right)| left.1 <= right.1)
        );
    }
}

fn exercise(store: &Store) -> TestResult {
    assert_eq!(store.transaction_metrics(), TransactionMetrics::default());
    let cloned = store.clone();
    store.insert(quad("autocommit"))?;
    store.start_transaction()?.commit()?;
    store
        .start_transaction_with(TransactionRequest::default())?
        .into_transaction()
        .commit()?;
    store
        .start_transaction_with_key(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction()
        .commit()?;
    store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction()
        .commit()?;
    SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:private:update> <urn:p> <urn:o> }")?
        .on_store(store)
        .execute()?;

    WritableDataset::rollback(store.start_transaction()?)?;
    store
        .start_transaction_with_key(TransactionRequest::default(), TransactionKey::new([3; 16]))?
        .into_transaction()
        .rollback()?;
    store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([4; 16]))?
        .into_transaction()
        .rollback()?;
    drop(store.start_transaction()?);
    drop(
        store
            .start_transaction_with_key(
                TransactionRequest::default(),
                TransactionKey::new([5; 16]),
            )?
            .into_transaction(),
    );
    drop(
        store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([6; 16]),
            )?
            .into_transaction(),
    );

    let metrics = cloned.transaction_metrics();
    assert_eq!(metrics.count(Observation::Committed), 6);
    assert_eq!(metrics.count(Observation::RolledBack), 3);
    assert_eq!(metrics.count(Observation::Abandoned), 3);
    assert_eq!(
        Observation::ALL
            .into_iter()
            .map(|outcome| metrics.count(outcome))
            .sum::<u64>(),
        12
    );
    assert_eq!(metrics.rollback_failures(), 0);
    assert_eq!(metrics, store.transaction_metrics());
    histogram_invariants(&metrics);

    let control = TransactionStartControl::new();
    control.cancel();
    assert!(
        store
            .start_transaction_with_control(TransactionRequest::default(), control)
            .is_err()
    );
    assert!(
        store
            .start_transaction_with_key(TransactionRequest::default(), TransactionKey::new([1; 16]))
            .is_err()
    );
    assert_eq!(
        metrics,
        store.transaction_metrics(),
        "failed admission must not become a terminal observation"
    );
    let mut text = String::new();
    metrics.write_prometheus(&mut text)?;
    assert_eq!(
        text.lines().filter(|line| !line.starts_with('#')).count(),
        89
    );
    assert_eq!(
        text.lines()
            .filter(|line| line.starts_with("# TYPE"))
            .count(),
        3
    );
    assert!(text.contains("# TYPE oxigraph_transaction_duration_seconds histogram\n"));
    assert!(text.contains("oxigraph_transactions_total{outcome=\"committed\"} 6\n"));
    assert!(text.contains(
        "oxigraph_transaction_duration_seconds_bucket{outcome=\"committed\",le=\"+Inf\"} 6\n"
    ));
    assert!(
        !text.contains("private") && !text.contains("urn:") && !text.contains("transaction_key")
    );
    Ok(())
}

#[test]
fn memory_terminal_observations_are_once_and_clone_shared() -> TestResult {
    exercise(&Store::new()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_terminal_observations_reset_on_reopen_without_changing_data() -> TestResult {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    exercise(&store)?;
    drop(store);
    for store in [
        Store::open_read_only(directory.path())?,
        Store::open_read_only(directory.path())?,
    ] {
        assert_eq!(store.transaction_metrics(), TransactionMetrics::default());
        assert!(store.contains(&quad("autocommit"))?);
    }
    let store = Store::open(directory.path())?;
    assert_eq!(store.transaction_metrics(), TransactionMetrics::default());
    assert!(store.contains(&quad("autocommit"))?);
    store.insert(quad("reopened"))?;
    assert_eq!(store.transaction_metrics().count(Observation::Committed), 1);
    Ok(())
}

#[test]
fn concurrent_clones_and_snapshots_keep_cumulative_histograms_consistent() -> TestResult {
    let store = Store::new()?;
    std::thread::scope(|scope| {
        let mut workers = Vec::new();
        for worker in 0..8 {
            let cloned = store.clone();
            workers.push(scope.spawn(move || -> TestResult {
                for item in 0..32 {
                    cloned.insert(quad(&format!("{worker}-{item}")))?;
                    histogram_invariants(&cloned.transaction_metrics());
                }
                Ok(())
            }));
        }
        for worker in workers {
            worker
                .join()
                .map_err(|_| std::io::Error::other("transaction worker panicked"))??;
        }
        Ok::<_, Box<dyn Error + Send + Sync>>(())
    })?;
    assert_eq!(
        store.transaction_metrics().count(Observation::Committed),
        256
    );
    assert_eq!(store.len()?, 256);
    assert_eq!(
        Store::new()?.transaction_metrics(),
        TransactionMetrics::default()
    );
    Ok(())
}
