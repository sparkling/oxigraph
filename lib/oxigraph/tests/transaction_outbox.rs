#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "public governed outbox contract assertions"
)]

use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, Quad};
use oxigraph::store::{
    CommitReceipt, CommitReceiptOutcome, Namespace, NamespacePrefix, OutboxCursor, OutboxReadError,
    OutboxRecord, SemanticChange, Store, TransactionKey, TransactionRequest, WritableDataset,
    WritableNamespaceRegistry,
};
use std::collections::HashSet;
use std::error::Error;
use std::num::NonZeroUsize;

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
fn key(id: u8) -> TransactionKey {
    TransactionKey::new([id; 16])
}
fn node(value: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:{value}"))
}
fn quad(value: &str) -> Quad {
    Quad::new(
        node(value),
        node("p"),
        Literal::new_simple_literal("value"),
        GraphName::DefaultGraph,
    )
}
fn commit(store: &Store, id: u8) -> TestResult<CommitReceipt> {
    Ok(store
        .start_governed_transaction(TransactionRequest::default(), key(id))?
        .into_transaction()
        .commit()?)
}
fn all(store: &Store) -> TestResult<Vec<OutboxRecord>> {
    let mut cursor = None;
    let mut result = Vec::new();
    loop {
        let batch = store.read_outbox(cursor.as_ref(), NonZeroUsize::MIN)?;
        assert!(batch.records().len() <= 1);
        if batch.records().is_empty() {
            break;
        }
        cursor = batch.next_cursor().cloned();
        result.extend_from_slice(batch.records());
    }
    Ok(result)
}

fn exercise(store: &Store) -> TestResult {
    let empty = store.read_outbox(None, NonZeroUsize::MIN)?;
    assert!(empty.records().is_empty());
    assert!(empty.coverage().is_none());
    // Legacy writes never pretend to be governed feed events.
    store.insert(quad("legacy"))?;
    assert!(all(store)?.is_empty());
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(quad("added"))?;
    let graph: oxigraph::model::NamedOrBlankNode = BlankNode::new("graph")?.into();
    tx.insert_named_graph(graph.clone())?;
    tx.clear_graph(Some(&graph))?;
    tx.set_namespace(Namespace::new(
        NamespacePrefix::new("\u{e9}x")?,
        node("namespace"),
    ))?;
    let changes = tx.changes()?;
    assert!(all(store)?.is_empty());
    let receipt = tx.commit()?;
    let page = store.read_outbox(None, NonZeroUsize::new(100).ok_or("zero page size")?)?;
    assert_eq!(page.records().len(), changes.len() + 1);
    assert_eq!(
        page.coverage()
            .ok_or("missing coverage")?
            .after_receipt_sequence(),
        0
    );
    assert_eq!(page.high_water(), receipt.outbox_end_cursor().as_ref());
    assert_eq!(
        page.records()[0],
        OutboxRecord::Commit {
            cursor: receipt
                .outbox_header_cursor()
                .ok_or("missing header cursor")?,
            receipt: receipt.clone()
        }
    );
    let records = all(store)?;
    assert_eq!(records, page.records());
    assert_eq!(all(store)?, records); // Retries replay; no hidden acknowledgement.
    let mut dedup = HashSet::new();
    let mut observed = Vec::new();
    for record in records.iter().chain(&records) {
        let bytes = record.cursor().to_bytes();
        assert_eq!(&OutboxCursor::from_bytes(&bytes)?, record.cursor());
        if let OutboxRecord::Event {
            commit_id,
            event_index,
            event_count,
            change,
            ..
        } = record
        {
            assert_eq!(commit_id, receipt.commit_id());
            assert_eq!(*event_count, changes.len() as u64);
            if dedup.insert((commit_id.clone(), *event_index)) {
                observed.push(change.clone());
            }
        }
    }
    assert_eq!(observed, changes.as_slice());
    let no_op = commit(store, 2)?;
    let next = store.read_outbox(receipt.outbox_end_cursor().as_ref(), NonZeroUsize::MIN)?;
    assert_eq!(
        next.records(),
        &[OutboxRecord::Commit {
            cursor: no_op.outbox_header_cursor().ok_or("missing cursor")?,
            receipt: no_op.clone()
        }]
    );
    assert_eq!(no_op.outbox_header_cursor(), no_op.outbox_end_cursor());
    assert!(
        store
            .read_outbox(next.next_cursor(), NonZeroUsize::MIN)?
            .records()
            .is_empty()
    );
    for id in [3, 4] {
        let mut tx = store
            .start_governed_transaction(TransactionRequest::default(), key(id))?
            .into_transaction();
        tx.clear()?;
        tx.clear_namespaces()?;
        if id == 3 {
            tx.rollback()?;
        } else {
            drop(tx);
        }
    }
    assert_eq!(all(store)?.len(), records.len() + 1);
    assert!(
        store
            .start_governed_transaction(TransactionRequest::default(), key(1))
            .is_err()
    );
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Committed(receipt)
    );
    assert_eq!(all(store)?.len(), records.len() + 1);
    Ok(())
}

#[test]
fn memory_ordered_replay_and_deduplication() -> TestResult {
    exercise(&Store::new()?)
}

#[test]
fn cursors_reject_corruption_and_other_store_lineages() -> TestResult {
    let store = Store::new()?;
    let receipt = commit(&store, 1)?;
    let cursor = receipt.outbox_header_cursor().ok_or("missing cursor")?;
    let other = Store::new()?;
    commit(&other, 1)?;
    assert!(matches!(
        other.read_outbox(Some(&cursor), NonZeroUsize::MIN),
        Err(OutboxReadError::DifferentStore)
    ));
    let bytes = cursor.to_bytes();
    for index in 0..bytes.len() {
        let mut corrupt = bytes;
        corrupt[index] ^= 1;
        assert!(matches!(
            OutboxCursor::from_bytes(&corrupt),
            Err(OutboxReadError::InvalidCursor)
        ));
    }
    for end in 0..bytes.len() {
        OutboxCursor::from_bytes(&bytes[..end]).unwrap_err();
    }
    Ok(())
}

#[test]
fn all_semantic_operation_kinds_replay_in_order() -> TestResult {
    let store = Store::new()?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(quad("one"))?;
    tx.clear_graph(None)?;
    tx.insert(quad("two"))?;
    tx.clear_all_named_graphs()?;
    tx.clear_all_graphs()?;
    tx.remove_all_named_graphs()?;
    tx.clear()?;
    tx.set_namespace(Namespace::new(NamespacePrefix::new("ex")?, node("old")))?;
    tx.clear_namespaces()?;
    let expected = tx.changes()?;
    tx.commit()?;
    let actual: Vec<_> = all(&store)?
        .into_iter()
        .filter_map(|record| match record {
            OutboxRecord::Event { change, .. } => Some(change),
            _ => None,
        })
        .collect();
    assert_eq!(actual, expected.as_slice());
    assert!(actual.contains(&SemanticChange::NamespacesCleared));
    assert!(actual.contains(&SemanticChange::DatasetCleared));
    Ok(())
}

#[test]
fn concurrent_publication_is_ordered_and_readers_never_see_partial_commits() -> TestResult {
    fn exercise(store: &Store) -> TestResult {
        std::thread::scope(|scope| -> TestResult {
            let mut writers = Vec::new();
            for id in 1..=8 {
                writers.push(scope.spawn(move || -> TestResult {
                    let mut tx = store
                        .start_governed_transaction(TransactionRequest::default(), key(id))?
                        .into_transaction();
                    tx.insert(quad(&format!("concurrent-{id}")))?;
                    tx.commit()?;
                    Ok(())
                }));
            }
            for _ in 0..32 {
                let page = store.read_outbox(None, NonZeroUsize::new(100).ok_or("zero")?)?;
                assert_eq!(page.records().len() % 2, 0);
                for pair in page.records().chunks_exact(2) {
                    assert_eq!(pair.len(), 2);
                    let (
                        OutboxRecord::Commit { receipt, .. },
                        OutboxRecord::Event {
                            change: SemanticChange::QuadAdded(quad),
                            commit_id,
                            ..
                        },
                    ) = (&pair[0], &pair[1])
                    else {
                        return Err("incomplete commit".into());
                    };
                    assert_eq!(receipt.commit_id(), commit_id);
                    assert!(store.contains(quad)?);
                    assert_eq!(
                        store.lookup_commit_receipt(receipt.transaction_key())?,
                        CommitReceiptOutcome::Committed(receipt.clone())
                    );
                }
            }
            for writer in writers {
                writer.join().map_err(|_| "writer panicked")??;
            }
            Ok(())
        })?;
        let records = all(store)?;
        assert_eq!(records.len(), 16);
        let sequences: Vec<_> = records
            .iter()
            .filter_map(|record| match record {
                OutboxRecord::Commit { receipt, .. } => Some(receipt.sequence()),
                _ => None,
            })
            .collect();
        assert_eq!(sequences, (1..=8).collect::<Vec<_>>());
        Ok(())
    }
    exercise(&Store::new()?)?;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    {
        let directory = tempfile::tempdir()?;
        exercise(&Store::open(directory.path())?)?;
    }
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_payloads_and_precommit_depth_rejection() -> TestResult {
    use oxigraph::model::{BaseDirection, Term, Triple};
    use oxigraph::store::{TransactionCommitError, TransactionNonCommitReason};
    let store = Store::new()?;
    let mut object: Term =
        Literal::new_directional_language_tagged_literal("text", "en", BaseDirection::Rtl)?.into();
    for _ in 0..32 {
        object = Triple::new(node("s"), node("p"), object).into();
    }
    let value = Quad::new(
        node("s"),
        node("p"),
        object.clone(),
        GraphName::DefaultGraph,
    );
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(value.clone())?;
    let receipt = tx.commit()?;
    assert!(
        matches!(&all(&store)?[1], OutboxRecord::Event { change: SemanticChange::QuadAdded(actual), .. } if actual == &value)
    );
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(2))?
        .into_transaction();
    tx.insert(Quad::new(
        node("s"),
        node("p"),
        Triple::new(node("s"), node("p"), object),
        GraphName::DefaultGraph,
    ))?;
    assert!(matches!(
        tx.commit(),
        Err(TransactionCommitError::Rejected(_))
    ));
    assert_eq!(
        store.lookup_commit_receipt(&key(2))?,
        CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert_eq!(all(&store)?.len(), 2);
    assert_eq!(commit(&store, 3)?.sequence(), receipt.sequence() + 1);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
#[expect(
    clippy::exit,
    reason = "child process deliberately skips all destructors to test recovery"
)]
fn rocksdb_child_exits_without_dropping_store() -> TestResult {
    let Some(path) = std::env::var_os("OXIGRAPH_OUTBOX_EXIT_TEST_PATH") else {
        return Ok(());
    };
    let store = Store::open(path)?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(quad("abrupt-exit"))?;
    if std::env::var("OXIGRAPH_OUTBOX_EXIT_TEST_COMMIT")?.as_str() == "yes" {
        tx.commit()?;
    }
    // Exit skips Rust destructors and RocksDB close. This is process-exit
    // recovery evidence, not an fsync/power-loss or arbitrary-window claim.
    std::process::exit(23);
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_recovers_primary_receipt_and_outbox_after_abrupt_process_exit() -> TestResult {
    for committed in [false, true] {
        let directory = tempfile::tempdir()?;
        let status = std::process::Command::new(std::env::current_exe()?)
            .args(["--exact", "rocksdb_child_exits_without_dropping_store"])
            .env("OXIGRAPH_OUTBOX_EXIT_TEST_PATH", directory.path())
            .env(
                "OXIGRAPH_OUTBOX_EXIT_TEST_COMMIT",
                if committed { "yes" } else { "no" },
            )
            .status()?;
        assert_eq!(status.code(), Some(23));
        let store = Store::open(directory.path())?;
        assert_eq!(store.contains(&quad("abrupt-exit"))?, committed);
        let records = all(&store)?;
        assert_eq!(records.len(), if committed { 2 } else { 0 });
        assert_eq!(
            matches!(
                store.lookup_commit_receipt(&key(1))?,
                CommitReceiptOutcome::Committed(_)
            ),
            committed
        );
        assert!(
            store
                .start_governed_transaction(TransactionRequest::default(), key(1))
                .is_err()
        );
        let next = commit(&store, 2)?;
        assert_eq!(next.sequence(), if committed { 2 } else { 1 });
        assert_eq!(all(&store)?.len(), records.len() + 1);
    }
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_replay_survives_reopen_read_only_and_backup() -> TestResult {
    let directory = tempfile::tempdir()?;
    let backup_root = tempfile::tempdir()?;
    let backup = backup_root.path().join("snapshot");
    let store = Store::open(directory.path())?;
    exercise(&store)?;
    let before = all(&store)?;
    store.backup(&backup)?;
    drop(store);
    let store = Store::open(directory.path())?;
    assert_eq!(all(&store)?, before);
    drop(store);
    let read_only = Store::open_read_only(directory.path())?;
    assert_eq!(all(&read_only)?, before);
    drop(read_only);
    let backed_up = Store::open(&backup)?;
    assert_eq!(all(&backed_up)?, before);
    let newer = Store::open(directory.path())?;
    let advanced = commit(&newer, 9)?
        .outbox_end_cursor()
        .ok_or("missing cursor")?;
    assert!(matches!(
        backed_up.read_outbox(Some(&advanced), NonZeroUsize::MIN),
        Err(OutboxReadError::CursorAhead)
    ));
    Ok(())
}
