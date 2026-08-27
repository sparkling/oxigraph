#![expect(
    clippy::expect_used,
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "negative-path integration tests use test names and expect_err as their diagnostics"
)]

#[path = "transaction_compatibility/fault_injecting_dataset.rs"]
mod fault_injecting_dataset;
#[path = "transaction_compatibility/store_backends.rs"]
mod store_backends;

use fault_injecting_dataset::{FaultInjectingDataset, FaultPlan, FaultReceipt};
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::sparql::SparqlEvaluator;
use oxigraph::store::{
    CancellationGuarantee, ConflictBehavior, NegotiatedTransactionalDataset,
    OutcomeAwareTransactionalDataset, OutcomeLookup, RollbackGuarantee, TransactionCommitError,
    TransactionKey, TransactionRequest, TransactionRequirements, TransactionRollbackError,
    TransactionStartControl, TransactionStartError, UnmetTransactionRequirement, WritableDataset,
    WriterIsolation,
};
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};
use store_backends::{StoreBackend, TestError};

const MUST_BLOCK_FOR: Duration = Duration::from_millis(100);
const EVENT_TIMEOUT: Duration = Duration::from_secs(5);
const CANCELLATION_BOUND: Duration = Duration::from_secs(1);

fn quad(label: impl std::fmt::Display) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:oxigraph:g17:subject:{label}")),
        NamedNode::new_unchecked("urn:oxigraph:g17:predicate"),
        NamedNode::new_unchecked("urn:oxigraph:g17:object"),
        GraphName::DefaultGraph,
    )
}

fn join(handle: thread::JoinHandle<Result<(), TestError>>) -> Result<(), TestError> {
    handle
        .join()
        .map_err(|_| io::Error::other("compatibility worker panicked"))??;
    Ok(())
}

fn for_each_store_backend(
    mut run: impl FnMut(&'static str, &StoreBackend) -> Result<(), TestError>,
) -> Result<(), TestError> {
    let memory = StoreBackend::memory()?;
    run("memory", &memory)?;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    {
        let rocksdb = StoreBackend::rocksdb()?;
        run("rocksdb", &rocksdb)?;
    }
    Ok(())
}

fn assert_writers_are_serialized(backend: &StoreBackend) -> Result<(), TestError> {
    for writer_count in [1, 4, 16] {
        let store = Arc::clone(backend.store());
        let barrier = Arc::new(Barrier::new(writer_count + 1));
        let active = Arc::new(AtomicUsize::new(0));
        let maximum_active = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::with_capacity(writer_count);
        let run = format!("writers-{writer_count}");

        for writer in 0..writer_count {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            let active = Arc::clone(&active);
            let maximum_active = Arc::clone(&maximum_active);
            let expected = quad(format!("{run}-{writer}"));
            handles.push(thread::spawn(move || -> Result<(), TestError> {
                barrier.wait();
                let mut transaction = store.start_transaction()?;
                let now_active = active.fetch_add(1, Ordering::SeqCst) + 1;
                maximum_active.fetch_max(now_active, Ordering::SeqCst);
                transaction.insert(expected);
                thread::sleep(Duration::from_millis(5));
                active.fetch_sub(1, Ordering::SeqCst);
                transaction.commit()?;
                Ok(())
            }));
        }

        barrier.wait();
        for handle in handles {
            join(handle)?;
        }
        assert_eq!(
            maximum_active.load(Ordering::SeqCst),
            1,
            "{writer_count}-writer run admitted overlapping transactions"
        );
        for writer in 0..writer_count {
            assert!(store.contains(&quad(format!("{run}-{writer}")))?);
        }
    }
    Ok(())
}

fn assert_readers_remain_live(backend: &StoreBackend) -> Result<(), TestError> {
    let store = Arc::clone(backend.store());
    let committed = quad("reader-committed");
    let staged = quad("reader-staged");
    store.insert(committed.clone())?;

    let mut writer = store.start_transaction()?;
    writer.insert(staged.clone());

    let reader_store = Arc::clone(&store);
    let reader_staged = staged.clone();
    let (finished, events) = mpsc::channel();
    let reader = thread::spawn(move || -> Result<(), TestError> {
        let result = (|| -> Result<(), TestError> {
            for _ in 0..128 {
                if !reader_store.contains(&committed)? {
                    return Err(io::Error::other("reader lost committed data").into());
                }
                if reader_store.contains(&reader_staged)? {
                    return Err(io::Error::other("reader observed staged data").into());
                }
            }
            Ok(())
        })();
        finished.send(result.is_ok())?;
        result
    });

    let completed_cleanly = events.recv_timeout(EVENT_TIMEOUT)?;
    WritableDataset::rollback(writer)?;
    join(reader)?;
    assert!(completed_cleanly, "reader returned an error");
    assert!(!store.contains(&staged)?);
    Ok(())
}

fn assert_release_without_publication(
    backend: &StoreBackend,
    explicit_rollback: bool,
) -> Result<(), TestError> {
    let store = Arc::clone(backend.store());
    let staged = quad(if explicit_rollback {
        "rollback"
    } else {
        "drop"
    });
    let mut holder = store.start_transaction()?;
    holder.insert(staged.clone());

    let waiter_store = Arc::clone(&store);
    let (acquired, events) = mpsc::channel();
    let waiter = thread::spawn(move || -> Result<(), TestError> {
        let transaction = waiter_store.start_transaction()?;
        acquired.send(())?;
        WritableDataset::rollback(transaction)?;
        Ok(())
    });

    assert_eq!(
        events.recv_timeout(MUST_BLOCK_FOR),
        Err(RecvTimeoutError::Timeout)
    );
    if explicit_rollback {
        WritableDataset::rollback(holder)?;
    } else {
        drop(holder);
    }
    events.recv_timeout(EVENT_TIMEOUT)?;
    join(waiter)?;
    assert!(!store.contains(&staged)?);
    Ok(())
}

fn assert_queued_cancellation(backend: &StoreBackend) -> Result<(), TestError> {
    let store = Arc::clone(backend.store());
    let holder = store.start_transaction()?;
    let control = TransactionStartControl::new().with_timeout(EVENT_TIMEOUT);

    let waiter_store = Arc::clone(&store);
    let waiter_control = control.clone();
    let (finished, events) = mpsc::channel();
    let waiter = thread::spawn(move || -> Result<(), TestError> {
        let outcome = waiter_store
            .start_transaction_with_control(TransactionRequest::default(), waiter_control);
        finished.send(matches!(outcome, Err(TransactionStartError::Cancelled)))?;
        Ok(())
    });

    assert_eq!(
        events.recv_timeout(MUST_BLOCK_FOR),
        Err(RecvTimeoutError::Timeout)
    );
    let cancelled_at = Instant::now();
    control.cancel();
    assert!(
        events.recv_timeout(CANCELLATION_BOUND)?,
        "queued writer did not return the typed cancellation outcome"
    );
    assert!(cancelled_at.elapsed() <= CANCELLATION_BOUND);
    join(waiter)?;

    drop(holder);
    let probe = store.start_transaction()?;
    WritableDataset::rollback(probe)?;
    Ok(())
}

fn assert_durable_lookup_rejected_before_admission(
    backend: &StoreBackend,
) -> Result<(), TestError> {
    let store = Arc::clone(backend.store());
    let holder = store.start_transaction()?;
    let request = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
    );
    let outcome = store.start_transaction_with_control(
        request,
        TransactionStartControl::new().with_timeout(Duration::ZERO),
    );
    let Err(TransactionStartError::RequirementsNotMet { unmet, effective }) = outcome else {
        drop(holder);
        return Err(io::Error::other(
            "durable outcome lookup was not rejected before writer admission",
        )
        .into());
    };
    assert_eq!(unmet, vec![UnmetTransactionRequirement::OutcomeLookup]);
    assert_eq!(effective.outcome_lookup(), OutcomeLookup::Unsupported);
    drop(holder);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn assert_durable_lookup_reaches_keyed_admission(backend: &StoreBackend) -> Result<(), TestError> {
    let store = Arc::clone(backend.store());
    let holder = store.start_transaction()?;
    let request = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
    );
    let outcome = store.start_transaction_with_key_and_control(
        request,
        TransactionKey::new([0xA5; 16]),
        TransactionStartControl::new().with_timeout(Duration::ZERO),
    );
    assert!(
        matches!(outcome, Err(TransactionStartError::TimedOut)),
        "the durable keyed request did not reach the occupied writer gate"
    );
    drop(holder);
    Ok(())
}

#[test]
fn memory_one_four_and_sixteen_writers_are_serialized_without_lost_commits() -> Result<(), TestError>
{
    assert_writers_are_serialized(&StoreBackend::memory()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_one_four_and_sixteen_writers_are_serialized_without_lost_commits()
-> Result<(), TestError> {
    assert_writers_are_serialized(&StoreBackend::rocksdb()?)
}

#[test]
fn memory_readers_remain_live_and_do_not_see_staged_writes() -> Result<(), TestError> {
    assert_readers_remain_live(&StoreBackend::memory()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_readers_remain_live_and_do_not_see_staged_writes() -> Result<(), TestError> {
    assert_readers_remain_live(&StoreBackend::rocksdb()?)
}

#[test]
fn memory_drop_releases_writer_without_publication() -> Result<(), TestError> {
    assert_release_without_publication(&StoreBackend::memory()?, false)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_drop_releases_writer_without_publication() -> Result<(), TestError> {
    assert_release_without_publication(&StoreBackend::rocksdb()?, false)
}

#[test]
fn memory_explicit_rollback_releases_writer_without_publication() -> Result<(), TestError> {
    assert_release_without_publication(&StoreBackend::memory()?, true)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_explicit_rollback_releases_writer_without_publication() -> Result<(), TestError> {
    assert_release_without_publication(&StoreBackend::rocksdb()?, true)
}

#[test]
fn memory_queued_writer_cancellation_is_bounded_and_leak_free() -> Result<(), TestError> {
    assert_queued_cancellation(&StoreBackend::memory()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_queued_writer_cancellation_is_bounded_and_leak_free() -> Result<(), TestError> {
    assert_queued_cancellation(&StoreBackend::rocksdb()?)
}

#[test]
fn memory_store_rejects_durable_outcome_lookup_before_writer_open() -> Result<(), TestError> {
    assert_durable_lookup_rejected_before_admission(&StoreBackend::memory()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_store_admits_durable_outcome_lookup_only_with_a_key() -> Result<(), TestError> {
    assert_durable_lookup_reaches_keyed_admission(&StoreBackend::rocksdb()?)
}

#[test]
fn injected_open_failure_does_not_construct_or_mutate_a_transaction() -> Result<(), TestError> {
    for_each_store_backend(|backend_name, backend| {
        let adapter =
            FaultInjectingDataset::new(backend.store().as_ref().clone(), FaultPlan::open_failure());
        let error = SparqlEvaluator::new()
            .parse_update(
                "INSERT DATA { <urn:oxigraph:g17:subject:open> <urn:oxigraph:g17:predicate> <urn:oxigraph:g17:object> }",
            )?
            .on_dataset(&adapter)
            .execute()
            .expect_err("injected open failure was accepted");
        assert!(
            error
                .to_string()
                .contains("injected transaction open failure"),
            "unexpected {backend_name} diagnostic: {error}"
        );
        assert_eq!(
            adapter.receipt(),
            FaultReceipt {
                open_attempts: 1,
                opens: 0,
                read_attempts: 0,
                mutation_attempts: 0,
                delegated_mutations: 0,
                commit_attempts: 0,
                delegated_commits: 0,
                rollback_attempts: 0,
                delegated_rollbacks: 0,
            },
            "unexpected {backend_name} fault receipt"
        );
        assert!(backend.store().is_empty()?);
        Ok(())
    })
}

#[test]
fn injected_read_iteration_failure_rolls_back_and_preserves_source() -> Result<(), TestError> {
    for_each_store_backend(|backend_name, backend| {
        let seed = quad("read-failure-seed");
        backend.store().insert(seed.clone())?;
        let adapter =
            FaultInjectingDataset::new(backend.store().as_ref().clone(), FaultPlan::read_failure());
        let error = SparqlEvaluator::new()
            .parse_update(
                "DELETE { ?s <urn:oxigraph:g17:predicate> ?o }
             INSERT { ?s <urn:oxigraph:g17:replacement> ?o }
             WHERE { ?s <urn:oxigraph:g17:predicate> ?o }",
            )?
            .on_dataset(&adapter)
            .execute()
            .expect_err("injected read failure was accepted");
        assert!(
            error
                .to_string()
                .contains("injected transaction read failure"),
            "unexpected {backend_name} diagnostic: {error}"
        );
        let receipt = adapter.receipt();
        assert_eq!(receipt.opens, 1);
        assert!(receipt.read_attempts >= 1);
        assert_eq!(receipt.rollback_attempts, 1);
        assert_eq!(receipt.delegated_rollbacks, 1);
        assert!(backend.store().contains(&seed)?);
        assert_eq!(backend.store().len()?, 1);
        Ok(())
    })
}

fn two_insert_update() -> &'static str {
    "INSERT DATA {
       <urn:oxigraph:g17:subject:first> <urn:oxigraph:g17:predicate> <urn:oxigraph:g17:object> .
       <urn:oxigraph:g17:subject:second> <urn:oxigraph:g17:predicate> <urn:oxigraph:g17:object>
     }"
}

#[test]
fn injected_second_mutation_failure_rolls_back_all_staged_state() -> Result<(), TestError> {
    for_each_store_backend(|backend_name, backend| {
        let adapter = FaultInjectingDataset::new(
            backend.store().as_ref().clone(),
            FaultPlan::mutation_failure(2),
        );
        let error = SparqlEvaluator::new()
            .parse_update(two_insert_update())?
            .on_dataset(&adapter)
            .execute()
            .expect_err("injected second mutation failure was accepted");
        assert!(
            error
                .to_string()
                .contains("injected transaction mutation failure"),
            "unexpected {backend_name} diagnostic: {error}"
        );
        let receipt = adapter.receipt();
        assert_eq!(receipt.mutation_attempts, 2);
        assert_eq!(receipt.delegated_mutations, 1);
        assert_eq!(receipt.rollback_attempts, 1);
        assert_eq!(receipt.delegated_rollbacks, 1);
        assert!(backend.store().is_empty()?);
        Ok(())
    })
}

#[test]
fn injected_rollback_failure_reports_both_failures_and_preserves_source() -> Result<(), TestError> {
    for_each_store_backend(|backend_name, backend| {
        let adapter = FaultInjectingDataset::new(
            backend.store().as_ref().clone(),
            FaultPlan::mutation_and_rollback_failure(2),
        );
        let error = SparqlEvaluator::new()
            .parse_update(two_insert_update())?
            .on_dataset(&adapter)
            .execute()
            .expect_err("combined mutation and rollback failure was accepted");
        let diagnostic = error.to_string();
        assert!(
            diagnostic.contains("injected transaction mutation failure"),
            "unexpected {backend_name} diagnostic: {diagnostic}"
        );
        assert!(
            diagnostic.contains("injected transaction rollback failure"),
            "unexpected {backend_name} diagnostic: {diagnostic}"
        );
        let receipt = adapter.receipt();
        assert_eq!(receipt.mutation_attempts, 2);
        assert_eq!(receipt.delegated_mutations, 1);
        assert_eq!(receipt.rollback_attempts, 1);
        assert_eq!(receipt.delegated_rollbacks, 0);
        assert!(backend.store().is_empty()?);
        Ok(())
    })
}

#[test]
fn injected_prepublication_commit_failure_preserves_source_without_rollback_claim()
-> Result<(), TestError> {
    for_each_store_backend(|backend_name, backend| {
        let adapter = FaultInjectingDataset::new(
            backend.store().as_ref().clone(),
            FaultPlan::prepublication_commit_failure(),
        );
        let error = SparqlEvaluator::new()
            .parse_update(
                "INSERT DATA { <urn:oxigraph:g17:subject:commit> <urn:oxigraph:g17:predicate> <urn:oxigraph:g17:object> }",
            )?
            .on_dataset(&adapter)
            .execute()
            .expect_err("injected prepublication commit failure was accepted");
        assert!(
            error
                .to_string()
                .contains("injected prepublication commit failure"),
            "unexpected {backend_name} diagnostic: {error}"
        );
        let receipt = adapter.receipt();
        assert_eq!(receipt.commit_attempts, 1);
        assert_eq!(receipt.delegated_commits, 0);
        assert_eq!(receipt.rollback_attempts, 0);
        assert!(backend.store().is_empty()?);
        Ok(())
    })
}

#[test]
fn external_fault_adapter_preserves_the_legacy_transaction_traits() -> Result<(), TestError> {
    for_each_store_backend(|_backend_name, backend| {
        let adapter =
            FaultInjectingDataset::new(backend.store().as_ref().clone(), FaultPlan::default());
        let expected = quad("adapter");
        SparqlEvaluator::new()
            .parse_update(
                "INSERT DATA { <urn:oxigraph:g17:subject:adapter> <urn:oxigraph:g17:predicate> <urn:oxigraph:g17:object> }",
            )?
            .on_dataset(&adapter)
            .execute()?;
        let receipt = adapter.receipt();
        assert_eq!(receipt.opens, 1);
        assert_eq!(receipt.mutation_attempts, 1);
        assert_eq!(receipt.delegated_mutations, 1);
        assert_eq!(receipt.commit_attempts, 1);
        assert_eq!(receipt.delegated_commits, 1);
        assert_eq!(receipt.rollback_attempts, 0);
        assert!(backend.store().contains(&expected)?);
        Ok(())
    })
}

#[test]
fn public_transaction_enums_preserve_the_g1_source_shape() {
    assert_eq!(format!("{:?}", WriterIsolation::Serialized), "Serialized");
    assert_eq!(
        format!("{:?}", ConflictBehavior::PreventedByWriterSerialization),
        "PreventedByWriterSerialization"
    );
    assert_eq!(
        format!("{:?}", CancellationGuarantee::BeforeCommitAttempt),
        "BeforeCommitAttempt"
    );
    assert_eq!(
        format!("{:?}", RollbackGuarantee::ExplicitOrDropBeforeCommit),
        "ExplicitOrDropBeforeCommit"
    );
    assert_eq!(
        format!("{:?}", OutcomeLookup::DurableByTransactionKey),
        "DurableByTransactionKey"
    );
    assert_eq!(
        format!("{:?}", UnmetTransactionRequirement::OutcomeLookup),
        "OutcomeLookup"
    );

    let start: TransactionStartError<io::Error> = TransactionStartError::TimedOut;
    assert_eq!(start.to_string(), "transaction start timed out");
    let commit: TransactionCommitError<io::Error> = TransactionCommitError::Conflicted;
    assert_eq!(commit.to_string(), "transaction conflicted");
    let rollback: TransactionRollbackError<io::Error> =
        TransactionRollbackError::Failed(io::Error::other("rollback probe"));
    assert_eq!(
        rollback.to_string(),
        "transaction rollback failed: rollback probe"
    );
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_without_atomicity_keeps_prior_ingestions_when_later_work_is_dropped()
-> Result<(), TestError> {
    let backend = StoreBackend::rocksdb()?;
    let mut loader = backend
        .store()
        .bulk_loader()
        .with_num_threads(1)
        .with_max_memory_size_in_megabytes(1)
        .without_atomicity();
    let committed = (0..1000).map(|index| quad(format!("non-atomic-{index}")));
    loader.load_quads(committed)?;
    let unpublished = quad("non-atomic-unpublished");
    loader.load_quads([unpublished.clone()])?;
    drop(loader);

    for index in 0..1000 {
        assert!(
            backend
                .store()
                .contains(&quad(format!("non-atomic-{index}")))?,
            "previously ingested batch lost quad {index}"
        );
    }
    assert!(
        !backend.store().contains(&unpublished)?,
        "dropped non-atomic loader published its final uncommitted batch"
    );
    Ok(())
}
