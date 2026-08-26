#![cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public RocksDB bulk writer-gate contract"
)]

use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{Store, WritableDataset};
use std::error::Error;
use std::io;
use std::sync::Arc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

type TestError = Box<dyn Error + Send + Sync>;

const EVENT_TIMEOUT: Duration = Duration::from_secs(5);
const MUST_BLOCK_FOR: Duration = Duration::from_secs(1);

fn quad(label: impl std::fmt::Display) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:oxigraph:bulk-writer-gate:subject:{label}")),
        NamedNode::new_unchecked("urn:oxigraph:bulk-writer-gate:predicate"),
        NamedNode::new_unchecked("urn:oxigraph:bulk-writer-gate:object"),
        GraphName::DefaultGraph,
    )
}

fn join(handle: thread::JoinHandle<Result<(), TestError>>) -> Result<(), TestError> {
    handle
        .join()
        .map_err(|_| io::Error::other("bulk writer thread panicked"))??;
    Ok(())
}

#[test]
fn rocksdb_bulk_sst_publication_waits_for_the_active_writer() -> Result<(), TestError> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(directory.path())?);

    let worker_store = Arc::clone(&store);
    let (ready, ready_events) = mpsc::channel();
    let (start_commit, commit_events) = mpsc::channel();
    let (published, publication_events) = mpsc::channel();
    let worker = thread::spawn(move || -> Result<(), TestError> {
        let mut loader = worker_store
            .bulk_loader()
            .with_num_threads(1)
            .with_max_memory_size_in_megabytes(1);
        loader.load_quads((0..1_001).map(|index| quad(format!("bulk-{index}"))))?;

        ready.send(())?;
        commit_events.recv()?;
        loader.commit()?;
        published.send(())?;
        Ok(())
    });

    ready_events.recv_timeout(EVENT_TIMEOUT)?;

    let staged = quad("active-writer");
    let mut holder = store.start_transaction()?;
    holder.insert(staged.clone());
    start_commit.send(())?;

    let publication_before_release = publication_events.recv_timeout(MUST_BLOCK_FOR);

    // Release and reap before asserting so the fixed implementation cannot deadlock on failure.
    WritableDataset::rollback(holder)?;
    let publication_after_release =
        matches!(&publication_before_release, Err(RecvTimeoutError::Timeout))
            .then(|| publication_events.recv_timeout(EVENT_TIMEOUT));
    join(worker)?;
    if let Some(result) = publication_after_release {
        result?;
    }

    assert!(
        matches!(publication_before_release, Err(RecvTimeoutError::Timeout)),
        "RocksDB bulk SST publication bypassed the serialized writer gate"
    );
    assert!(!store.contains(&staged)?);
    assert_eq!(store.len()?, 1_001);
    Ok(())
}
