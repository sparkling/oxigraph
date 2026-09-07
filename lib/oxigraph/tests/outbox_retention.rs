#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "native retention contract assertions"
)]
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::OutcomeAwareTransactionalDataset;
use oxigraph::store::{
    CommitReceipt, CommitReceiptOutcome, GovernanceError, GovernanceTime, OutboxCursor,
    OutboxLeaseToken, OutboxReadError, OutboxRetentionPolicy, Store, TransactionKey,
    TransactionRequest, WritableDataset,
};
use std::num::{NonZeroU16, NonZeroU64, NonZeroUsize};
type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn time(value: u64) -> GovernanceTime {
    GovernanceTime::from_unix_millis(value)
}
fn key(id: u8) -> TransactionKey {
    TransactionKey::new([id; 16])
}
fn policy(cap: u64, leases: u16) -> TestResult<OutboxRetentionPolicy> {
    Ok(OutboxRetentionPolicy::new(
        NonZeroU64::new(cap).ok_or("zero cap")?,
        NonZeroU16::new(leases).ok_or("zero leases")?,
    )?)
}
fn quad(id: u8) -> Quad {
    let node = NamedNode::new_unchecked(format!("urn:{id}"));
    Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph)
}
fn commit(store: &Store, id: u8, quads: &[u8]) -> TestResult<CommitReceipt> {
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(id))?
        .into_transaction();
    for id in quads {
        tx.insert(quad(*id))?;
    }
    Ok(tx.commit()?)
}
fn end(receipt: &CommitReceipt) -> TestResult<OutboxCursor> {
    receipt
        .outbox_end_cursor()
        .ok_or_else(|| "no outbox cursor".into())
}
fn exercise(store: &Store) -> TestResult {
    store.configure_outbox_retention(policy(4, 2)?, time(10))?;
    let first = commit(store, 1, &[1, 2])?; // header and two events
    let second = commit(store, 2, &[])?; // header even for a no-op
    let high = end(&second)?;
    let lease = store.acquire_outbox_lease([1; 16], None, time(30), time(10))?;
    assert_eq!(
        OutboxLeaseToken::from_bytes(lease.token().to_bytes()),
        *lease.token()
    );
    let pinned = store.maintain_outbox(&high, NonZeroUsize::MIN, time(11))?;
    assert!(pinned.pinned_by_lease());
    assert_eq!(pinned.removed_records(), 0);
    let header = first.outbox_header_cursor().ok_or("missing header")?;
    store.checkpoint_outbox_lease(lease.token(), &header, time(30), time(12))?;
    assert!(
        store
            .maintain_outbox(&high, NonZeroUsize::MIN, time(12))?
            .pinned_by_lease()
    );
    store.checkpoint_outbox_lease(lease.token(), &end(&first)?, time(30), time(13))?;
    let pruned = store.maintain_outbox(&high, NonZeroUsize::MIN, time(13))?;
    assert_eq!(pruned.expired_receipt_sequence(), Some(1));
    assert_eq!(pruned.removed_records(), 1);
    assert_eq!(pruned.retained_after(), Some(&end(&first)?));
    assert!(matches!(
        store.read_outbox(Some(&header), NonZeroUsize::MIN),
        Err(OutboxReadError::CursorExpired { .. })
    ));
    let page = store.read_outbox(None, NonZeroUsize::MIN)?;
    assert_eq!(page.records().len(), 1);
    assert_eq!(page.next_cursor(), Some(&high));
    assert_eq!(page.retained_after(), Some(&end(&first)?));
    assert_eq!(
        store
            .read_outbox(Some(&end(&first)?), NonZeroUsize::MIN)?
            .records(),
        page.records()
    );
    let health = store.governance_health(time(13), NonZeroUsize::MIN)?;
    assert_eq!(health.physical_records(), 3);
    assert_eq!(health.retained_records(), 1);
    assert_eq!(health.live_leases(), 1);
    let rejected = commit(store, 3, &[3, 4]).unwrap_err(); // physical, not logical count
    assert!(
        rejected
            .to_string()
            .contains("physical outbox record capacity")
    );
    assert!(!store.contains(&quad(3))?);
    assert!(!store.contains(&quad(4))?);
    assert!(matches!(
        store.lookup_commit_receipt(&key(3))?,
        CommitReceiptOutcome::ProvenAbsent(_)
    ));
    match store.lookup_commit_receipt(&key(1))? {
        CommitReceiptOutcome::Expired(receipt) => {
            assert_eq!(receipt.sequence(), 1);
            assert_eq!(receipt.transaction_key(), &key(1));
        }
        other => return Err(format!("wrong expired outcome: {other:?}").into()),
    }
    assert!(
        store
            .start_governed_transaction(TransactionRequest::default(), key(1))
            .is_err()
    );
    assert!(
        store
            .start_transaction_with_key(TransactionRequest::default(), key(1))
            .is_err()
    );
    assert!(matches!(
        store.lookup_transaction_outcome(&key(1))?,
        oxigraph::store::TransactionOutcome::Committed
    ));
    for _ in 0..2 {
        assert_eq!(
            store
                .maintain_outbox(&high, NonZeroUsize::MIN, time(14))?
                .removed_records(),
            1
        );
    }
    assert_eq!(
        store
            .governance_health(time(14), NonZeroUsize::MIN)?
            .physical_records(),
        1
    );
    assert!(
        store
            .maintain_outbox(&high, NonZeroUsize::MIN, time(15))?
            .pinned_by_lease()
    );
    // Reads classify expiry, but do not persist it or advance retention.
    assert_eq!(
        store
            .governance_health(time(30), NonZeroUsize::MIN)?
            .expired_leases(),
        1
    );
    assert_eq!(
        store
            .governance_health(time(15), NonZeroUsize::MIN)?
            .live_leases(),
        1
    );
    let complete = store.maintain_outbox(&high, NonZeroUsize::MIN, time(30))?;
    assert_eq!(complete.expired_receipt_sequence(), Some(2));
    assert!(
        store
            .read_outbox(Some(&high), NonZeroUsize::MIN)?
            .records()
            .is_empty()
    );
    assert_eq!(
        store.read_outbox(None, NonZeroUsize::MIN)?.next_cursor(),
        Some(&high)
    );
    assert_eq!(
        store
            .governance_health(time(30), NonZeroUsize::MIN)?
            .physical_records(),
        0
    );
    assert!(matches!(
        store.maintain_outbox(&high, NonZeroUsize::MIN, time(29)),
        Err(GovernanceError::ClockRegressed)
    ));
    let replacement = store.acquire_outbox_lease([1; 16], None, time(50), time(31))?;
    assert_ne!(replacement.token(), lease.token());
    assert!(matches!(
        store.release_outbox_lease(lease.token(), time(31)),
        Err(GovernanceError::LeaseUnavailable)
    ));
    store.release_outbox_lease(replacement.token(), time(31))?;
    let next = commit(store, 4, &[5])?;
    assert_eq!(next.sequence(), 3);
    assert_eq!(
        store
            .read_outbox(Some(&high), NonZeroUsize::new(8).ok_or("zero limit")?)?
            .records()
            .len(),
        2
    );
    assert!(store.contains(&quad(1))?);
    assert!(store.contains(&quad(2))?);
    assert!(store.contains(&quad(5))?);
    Ok(())
}
#[test]
fn memory_retention_leases_expiry_and_backpressure() -> TestResult {
    exercise(&Store::new()?)
}
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_retention_leases_expiry_and_backpressure() -> TestResult {
    let dir = tempfile::tempdir()?;
    exercise(&Store::open(dir.path())?)
}

fn lease_errors(store: &Store) -> TestResult {
    assert!(matches!(
        store.acquire_outbox_lease([1; 16], None, time(20), time(10)),
        Err(GovernanceError::NotConfigured)
    ));
    store.configure_outbox_retention(policy(10, 1)?, time(10))?;
    assert!(matches!(
        store.acquire_outbox_lease([1; 16], None, time(10), time(10)),
        Err(GovernanceError::InvalidDeadline)
    ));
    let lease = store.acquire_outbox_lease([1; 16], None, time(20), time(10))?;
    assert!(matches!(
        store.acquire_outbox_lease([1; 16], None, time(20), time(10)),
        Err(GovernanceError::LeaseExists)
    ));
    assert!(matches!(
        store.acquire_outbox_lease([2; 16], None, time(20), time(10)),
        Err(GovernanceError::LeaseCapacity)
    ));
    let first = commit(store, 1, &[])?;
    let second = commit(store, 2, &[])?;
    store.checkpoint_outbox_lease(lease.token(), &end(&second)?, time(20), time(11))?;
    assert!(matches!(
        store.checkpoint_outbox_lease(lease.token(), &end(&first)?, time(20), time(11)),
        Err(GovernanceError::CheckpointRegressed)
    ));
    let other = Store::new()?;
    let foreign = commit(&other, 1, &[])?;
    assert!(matches!(
        store.checkpoint_outbox_lease(lease.token(), &end(&foreign)?, time(20), time(11)),
        Err(GovernanceError::Cursor(OutboxReadError::DifferentStore))
    ));
    assert!(matches!(
        store.governance_health(time(9), NonZeroUsize::MIN),
        Err(GovernanceError::ClockRegressed)
    ));
    assert!(matches!(
        store.release_outbox_lease(lease.token(), time(20)),
        Err(GovernanceError::LeaseUnavailable)
    ));
    Ok(())
}
#[test]
fn memory_rejects_invalid_lease_transitions() -> TestResult {
    lease_errors(&Store::new()?)
}
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_rejects_invalid_lease_transitions() -> TestResult {
    let dir = tempfile::tempdir()?;
    lease_errors(&Store::open(dir.path())?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_activation_does_not_guess_a_missing_lineage_from_historical_keys() -> TestResult {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction()
        .rollback()?;
    assert!(matches!(
        store.configure_outbox_retention(policy(10, 1)?, time(1)),
        Err(GovernanceError::LineageUnavailable)
    ));
    assert!(matches!(
        store.governance_health(time(1), NonZeroUsize::MIN),
        Err(GovernanceError::LineageUnavailable)
    ));
    // An explicit acknowledged commit establishes identity. Activation itself
    // never scans all old key reservations or fabricates a new history.
    commit(&store, 2, &[])?;
    store.configure_outbox_retention(policy(10, 1)?, time(1))?;
    assert_eq!(
        store
            .governance_health(time(1), NonZeroUsize::MIN)?
            .schema_version(),
        Some(3)
    );
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn pending_cleanup_survives_restart_compaction_and_backup() -> TestResult {
    let dir = tempfile::tempdir()?;
    let backup_root = tempfile::tempdir()?;
    let backup = backup_root.path().join("snapshot");
    let store = Store::open(dir.path())?;
    store.configure_outbox_retention(policy(20, 2)?, time(10))?;
    let first = commit(&store, 1, &[1, 2, 3])?;
    let lease = store.acquire_outbox_lease([1; 16], Some(&end(&first)?), time(30), time(10))?;
    let second = commit(&store, 2, &[])?;
    let high = end(&second)?;
    store.maintain_outbox(&high, NonZeroUsize::MIN, time(11))?;
    store.optimize()?;
    store.backup(&backup)?;
    let before = store.governance_health(time(11), NonZeroUsize::MIN)?;
    drop(store);
    let read_only = Store::open_read_only(dir.path())?;
    assert_eq!(
        read_only.governance_health(time(11), NonZeroUsize::MIN)?,
        before
    );
    read_only
        .maintain_outbox(&high, NonZeroUsize::MIN, time(12))
        .unwrap_err();
    drop(read_only);
    for path in [dir.path(), backup.as_path()] {
        let reopened = Store::open(path)?;
        assert_eq!(
            reopened.governance_health(time(11), NonZeroUsize::MIN)?,
            before
        );
        assert!(matches!(
            reopened.lookup_commit_receipt(&key(1))?,
            CommitReceiptOutcome::Expired(_)
        ));
        for _ in 0..3 {
            assert_eq!(
                reopened
                    .maintain_outbox(&high, NonZeroUsize::MIN, time(12))?
                    .removed_records(),
                1
            );
        }
        assert!(
            reopened
                .maintain_outbox(&high, NonZeroUsize::MIN, time(12))?
                .pinned_by_lease()
        );
        reopened.release_outbox_lease(lease.token(), time(12))?;
        assert_eq!(
            reopened
                .maintain_outbox(&high, NonZeroUsize::MIN, time(12))?
                .removed_records(),
            1
        );
        assert!(reopened.contains(&quad(3))?);
        assert_eq!(commit(&reopened, 3, &[])?.sequence(), 3);
    }
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
#[expect(
    clippy::exit,
    reason = "abrupt-exit fixture deliberately bypasses destructors"
)]
fn retention_child_exits_with_pending_cleanup() -> TestResult {
    let Some(path) = std::env::var_os("OXIGRAPH_RETENTION_EXIT_TEST_PATH") else {
        return Ok(());
    };
    let store = Store::open(path)?;
    store.configure_outbox_retention(policy(20, 1)?, time(10))?;
    let receipt = commit(&store, 1, &[1, 2, 3])?;
    store.maintain_outbox(&end(&receipt)?, NonZeroUsize::MIN, time(11))?;
    // Deliberately bypass destructors; this is process-exit recovery, not power loss.
    std::process::exit(23);
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn abrupt_exit_preserves_pending_cleanup_and_expired_key_truth() -> TestResult {
    let directory = tempfile::tempdir()?;
    let status = std::process::Command::new(std::env::current_exe()?)
        .args(["--exact", "retention_child_exits_with_pending_cleanup"])
        .env("OXIGRAPH_RETENTION_EXIT_TEST_PATH", directory.path())
        .status()?;
    assert_eq!(status.code(), Some(23));
    let store = Store::open(directory.path())?;
    let health = store.governance_health(time(11), NonZeroUsize::MIN)?;
    assert_eq!(health.schema_version(), Some(3));
    assert_eq!(health.physical_records(), 3);
    assert_eq!(health.retained_records(), 0);
    assert!(matches!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Expired(_)
    ));
    let high = health.high_water().ok_or("missing high-water")?;
    for _ in 0..3 {
        store.maintain_outbox(high, NonZeroUsize::MIN, time(12))?;
    }
    assert_eq!(
        store
            .governance_health(time(12), NonZeroUsize::MIN)?
            .physical_records(),
        0
    );
    assert!(store.contains(&quad(3))?);
    assert_eq!(commit(&store, 2, &[])?.sequence(), 2);
    Ok(())
}

fn serialized_maintenance(store: &Store) -> TestResult {
    store.configure_outbox_retention(policy(20, 1)?, time(10))?;
    let first = commit(store, 1, &[])?;
    let through = end(&first)?;
    let (staged_send, staged_recv) = std::sync::mpsc::channel();
    let (commit_send, commit_recv) = std::sync::mpsc::channel();
    std::thread::scope(|scope| -> TestResult {
        let writer = scope.spawn(move || -> TestResult {
            let mut tx = store
                .start_governed_transaction(TransactionRequest::default(), key(2))?
                .into_transaction();
            tx.insert(quad(2))?;
            staged_send.send(())?;
            commit_recv.recv()?;
            tx.commit()?;
            Ok(())
        });
        staged_recv.recv()?;
        let maintenance =
            scope.spawn(|| store.maintain_outbox(&through, NonZeroUsize::MIN, time(11)));
        commit_send.send(())?;
        writer.join().map_err(|_| "writer panic")??;
        assert_eq!(
            maintenance
                .join()
                .map_err(|_| "maintenance panic")??
                .removed_records(),
            1
        );
        Ok(())
    })?;
    assert!(store.contains(&quad(2))?);
    let page = store.read_outbox(Some(&through), NonZeroUsize::new(10).ok_or("zero limit")?)?;
    assert_eq!(page.records().len(), 2);
    assert_eq!(
        store
            .governance_health(time(11), NonZeroUsize::MIN)?
            .physical_records(),
        2
    );
    Ok(())
}
#[test]
fn memory_maintenance_serializes_with_primary_writer() -> TestResult {
    serialized_maintenance(&Store::new()?)
}
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_maintenance_serializes_with_primary_writer() -> TestResult {
    let directory = tempfile::tempdir()?;
    serialized_maintenance(&Store::open(directory.path())?)
}
