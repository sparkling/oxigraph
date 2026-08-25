#![cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public RocksDB writer-gate contract"
)]

use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{
    NegotiatedTransactionalDataset, Store, TransactionRequest, TransactionStartControl,
    TransactionStartError, WritableDataset,
};
use std::error::Error;
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

type TestError = Box<dyn Error + Send + Sync>;

const MUST_BLOCK_FOR: Duration = Duration::from_millis(100);
const EVENT_TIMEOUT: Duration = Duration::from_secs(5);
const CANCELLATION_BOUND: Duration = Duration::from_secs(1);

fn quad(label: impl std::fmt::Display) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:oxigraph:writer-gate:subject:{label}")),
        NamedNode::new_unchecked("urn:oxigraph:writer-gate:predicate"),
        NamedNode::new_unchecked("urn:oxigraph:writer-gate:object"),
        GraphName::DefaultGraph,
    )
}

fn join(handle: thread::JoinHandle<Result<(), TestError>>) -> Result<(), TestError> {
    handle
        .join()
        .map_err(|_| io::Error::other("writer thread panicked"))??;
    Ok(())
}

#[test]
fn one_four_and_sixteen_writers_are_serialized_without_lost_commits() -> Result<(), TestError> {
    for writer_count in [1, 4, 16] {
        let directory = tempfile::tempdir()?;
        let store = Arc::new(Store::open(directory.path())?);
        let barrier = Arc::new(Barrier::new(writer_count + 1));
        let active = Arc::new(AtomicUsize::new(0));
        let maximum_active = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::with_capacity(writer_count);

        for writer in 0..writer_count {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            let active = Arc::clone(&active);
            let maximum_active = Arc::clone(&maximum_active);
            handles.push(thread::spawn(move || -> Result<(), TestError> {
                barrier.wait();
                let mut transaction = store.start_transaction()?;
                let now_active = active.fetch_add(1, Ordering::SeqCst) + 1;
                maximum_active.fetch_max(now_active, Ordering::SeqCst);
                transaction.insert(quad(writer));
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
        assert_eq!(store.len()?, writer_count);
        for writer in 0..writer_count {
            assert!(store.contains(&quad(writer))?);
        }
    }
    Ok(())
}

#[test]
fn readers_remain_live_and_do_not_see_staged_writes() -> Result<(), TestError> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(directory.path())?);
    let committed = quad("committed");
    let staged = quad("staged");
    store.insert(committed.clone())?;

    let mut writer = store.start_transaction()?;
    writer.insert(staged.clone());

    let reader_store = Arc::clone(&store);
    let reader_staged = staged.clone();
    let reader = thread::spawn(move || -> Result<(), TestError> {
        for _ in 0..128 {
            if !reader_store.contains(&committed)? {
                return Err(io::Error::other("reader lost committed data").into());
            }
            if reader_store.contains(&reader_staged)? {
                return Err(io::Error::other("reader observed staged data").into());
            }
        }
        Ok(())
    });

    join(reader)?;
    WritableDataset::rollback(writer)?;
    assert!(!store.contains(&staged)?);
    Ok(())
}

#[test]
fn drop_releases_the_writer_permit_without_publishing() -> Result<(), TestError> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(directory.path())?);
    let staged = quad("drop");
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
    drop(holder);
    events.recv_timeout(EVENT_TIMEOUT)?;
    join(waiter)?;
    assert!(!store.contains(&staged)?);
    Ok(())
}

#[test]
fn explicit_rollback_releases_the_writer_permit_without_publishing() -> Result<(), TestError> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(directory.path())?);
    let staged = quad("rollback");
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
    WritableDataset::rollback(holder)?;
    events.recv_timeout(EVENT_TIMEOUT)?;
    join(waiter)?;
    assert!(!store.contains(&staged)?);
    Ok(())
}

#[test]
fn queued_writer_start_can_be_cancelled_within_a_bounded_interval() -> Result<(), TestError> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(directory.path())?);
    let holder = store.start_transaction()?;
    let control = TransactionStartControl::new().with_timeout(EVENT_TIMEOUT);

    let waiter_store = Arc::clone(&store);
    let waiter_control = control.clone();
    let (finished, events) = mpsc::channel();
    let waiter = thread::spawn(move || -> Result<(), TestError> {
        let outcome = waiter_store
            .start_transaction_with_control(TransactionRequest::default(), waiter_control);
        let cancelled = matches!(outcome, Err(TransactionStartError::Cancelled));
        finished.send(cancelled)?;
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
    let transaction = store.start_transaction()?;
    WritableDataset::rollback(transaction)?;
    Ok(())
}
#[test]
fn zero_start_timeout_fails_before_opening_or_staging() -> Result<(), TestError> {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    let outcome = store.start_transaction_with_control(
        TransactionRequest::default(),
        TransactionStartControl::new().with_timeout(Duration::ZERO),
    );
    assert!(matches!(outcome, Err(TransactionStartError::TimedOut)));
    assert!(store.is_empty()?);
    Ok(())
}
