#![cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "native derived input fixtures"
)]
use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
use oxigraph::store::{
    BackupError, CommitReceipt, ContributorCheckpoint, DerivedCommit, DerivedError, DerivedLimits,
    DerivedSnapshot, GovernanceTime, Namespace, NamespacePrefix, OutboxReadError,
    OutboxRetentionPolicy, SemanticChange, StorageError, Store, TransactionKey, TransactionRequest,
    TransactionStartControl, WritableDataset, WritableNamespaceRegistry,
};
use std::num::{NonZeroU16, NonZeroU64, NonZeroUsize};
use std::time::Duration;
type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

fn quad(n: i64, graph: GraphName) -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        Literal::from(n),
        graph,
    )
}
fn commit(store: &Store, n: u8) -> Result<CommitReceipt, Box<dyn std::error::Error + Send + Sync>> {
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([n; 16]))?
        .into_transaction();
    tx.insert(quad(i64::from(n), GraphName::DefaultGraph))?;
    Ok(tx.commit()?)
}
fn capture(store: &Store) -> Result<DerivedSnapshot, DerivedError> {
    store.derived_snapshot(&TransactionStartControl::new())
}
fn collect(snapshot: &DerivedSnapshot) -> Result<Vec<SemanticChange>, DerivedError> {
    let mut records = Vec::new();
    snapshot.scan(&DerivedLimits::default(), |record| {
        records.push(record.clone());
        Ok(())
    })?;
    Ok(records)
}
fn apply(store: &Store, changes: &[SemanticChange]) -> Result<(), StorageError> {
    let mut tx = store.start_transaction()?;
    for change in changes {
        match change {
            SemanticChange::QuadAdded(quad) => WritableDataset::insert(&mut tx, quad.clone())?,
            SemanticChange::QuadRemoved(quad) => WritableDataset::remove(&mut tx, quad)?,
            SemanticChange::NamedGraphCreated(graph) => {
                WritableDataset::insert_named_graph(&mut tx, graph.clone())?
            }
            SemanticChange::GraphCleared(graph) => {
                let graph = match graph {
                    GraphName::DefaultGraph => None,
                    GraphName::NamedNode(node) => Some(node.clone().into()),
                    GraphName::BlankNode(node) => Some(node.clone().into()),
                };
                WritableDataset::clear_graph(&mut tx, graph.as_ref())?;
            }
            SemanticChange::NamedGraphDropped(graph) => tx.remove_named_graph(graph)?,
            SemanticChange::AllNamedGraphsCleared => tx.clear_all_named_graphs()?,
            SemanticChange::AllGraphsCleared => tx.clear_all_graphs()?,
            SemanticChange::AllNamedGraphsDropped => tx.remove_all_named_graphs()?,
            SemanticChange::DatasetCleared => tx.clear()?,
            SemanticChange::NamespaceChanged { prefix, after, .. } => match after {
                Some(iri) => tx.set_namespace(Namespace::new(prefix.clone(), iri.clone()))?,
                None => tx.remove_namespace(prefix)?,
            },
            SemanticChange::NamespacesCleared => tx.clear_namespaces()?,
            _ => {
                return Err(StorageError::Other(
                    "unsupported fake-provider input".into(),
                ));
            }
        }
    }
    tx.commit()
}
fn assert_same(left: &Store, right: &Store) -> TestResult {
    assert_eq!(left.len()?, right.len()?, "quad count");
    for quad in left {
        assert!(right.contains(&quad?)?, "missing primary quad");
    }
    let a = left
        .named_graphs()
        .collect::<Result<std::collections::HashSet<_>, _>>()?;
    let b = right
        .named_graphs()
        .collect::<Result<std::collections::HashSet<_>, _>>()?;
    assert_eq!(a, b, "named graph topology");
    assert_eq!(
        left.namespaces().collect::<Result<Vec<_>, _>>()?,
        right.namespaces().collect::<Result<Vec<_>, _>>()?,
        "namespace registry"
    );
    Ok(())
}

#[test]
fn one_native_snapshot_preserves_topology_namespaces_and_outbox_across_later_writes() -> TestResult
{
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path().join("db"))?;
    let first = commit(&store, 1)?;
    store.insert_named_graph(NamedNode::new("urn:empty")?)?;
    store.set_namespace(Namespace::new(
        NamespacePrefix::new("ex")?,
        NamedNode::new("urn:example:")?,
    ))?;
    let view = capture(&store)?;
    let before = collect(&view)?;
    let expected = Store::new()?;
    apply(&expected, &before)?;
    assert_same(&store, &expected)?;
    view.check_current(&store)?;
    commit(&store, 2)?;
    store.clear_namespaces()?;
    store.remove_named_graph(&NamedNode::new("urn:empty")?.into())?;
    assert_eq!(collect(&view)?, before);
    assert!(matches!(
        view.check_current(&store),
        Err(DerivedError::NotFresh)
    ));
    let delta = view.delta(None, &DerivedLimits::default())?;
    assert_eq!(delta.commits().len(), 1);
    assert_eq!(delta.commits()[0].receipt(), &first);
    assert_eq!(delta.checkpoint(), view.checkpoint());
    let mut rolled = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([3; 16]))?
        .into_transaction();
    rolled.insert(quad(3, GraphName::DefaultGraph))?;
    rolled.rollback()?;
    let newer = capture(&store)?;
    let delta = newer.delta(
        Some(&ContributorCheckpoint::new(first)?),
        &DerivedLimits::default(),
    )?;
    assert_eq!(delta.commits().len(), 1);
    assert_eq!(
        delta.commits()[0].receipt().transaction_key(),
        &TransactionKey::new([2; 16])
    );
    Ok(())
}

#[test]
fn fake_provider_rebuild_plus_complete_deltas_matches_primary_lifecycle() -> TestResult {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path().join("db"))?;
    let first = commit(&store, 1)?;
    let fake = Store::new()?;
    apply(&fake, &collect(&capture(&store)?)?)?;
    let graph = NamedNode::new("urn:g")?;
    for mode in 0..10 {
        let mut tx = store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([mode + 10; 16]),
            )?
            .into_transaction();
        match mode {
            0 => {
                tx.insert_named_graph(graph.clone().into())?;
                tx.insert(quad(2, graph.clone().into()))?;
            }
            1 => tx.remove(&quad(1, GraphName::DefaultGraph))?,
            2 => tx.clear_graph(Some(&graph.clone().into()))?,
            3 => {
                tx.remove_named_graph(&graph.clone().into())?;
                tx.insert_named_graph(NamedNode::new("urn:empty")?.into())?;
            }
            4 => tx.set_namespace(Namespace::new(
                NamespacePrefix::new("ex")?,
                NamedNode::new("urn:ex:")?,
            ))?,
            5 => tx.clear_all_named_graphs()?,
            6 => tx.clear_all_graphs()?,
            7 => tx.remove_all_named_graphs()?,
            8 => tx.clear_namespaces()?,
            _ => {
                tx.insert(quad(9, GraphName::DefaultGraph))?;
                tx.clear()?;
            }
        }
        tx.commit()?;
    }
    let final_view = capture(&store)?;
    let delta = final_view.delta(
        Some(&ContributorCheckpoint::new(first)?),
        &DerivedLimits::default(),
    )?;
    assert_eq!(delta.commits().len(), 10);
    for entry in delta.commits() {
        apply(&fake, entry.changes())?;
    }
    assert_same(&store, &fake)?;
    Ok(())
}

#[test]
fn oversized_commit_has_no_partial_overlay_and_noop_is_a_complete_commit() -> TestResult {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path().join("db"))?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    for n in 0..257 {
        tx.insert(quad(n, GraphName::DefaultGraph))?;
    }
    let large = tx.commit()?;
    let noop = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction()
        .commit()?;
    let view = capture(&store)?;
    let small = DerivedLimits {
        max_records: NonZeroU64::new(257).ok_or("limit")?,
        ..DerivedLimits::default()
    };
    assert!(matches!(view.delta(None, &small), Err(DerivedError::Limit)));
    let exact = DerivedLimits {
        max_records: NonZeroU64::new(259).ok_or("limit")?,
        ..DerivedLimits::default()
    };
    let delta = view.delta(None, &exact)?;
    assert_eq!(delta.records(), 259);
    assert_eq!(delta.commits().len(), 2);
    assert_eq!(delta.commits()[0].receipt(), &large);
    assert_eq!(delta.commits()[0].changes().len(), 257);
    assert_eq!(delta.commits()[1].receipt(), &noop);
    assert!(delta.commits()[1].changes().is_empty());
    let one_byte = DerivedLimits {
        max_bytes: NonZeroU64::MIN,
        ..DerivedLimits::default()
    };
    assert!(matches!(
        view.delta(None, &one_byte),
        Err(DerivedError::Limit)
    ));
    Ok(())
}

#[test]
fn scan_limits_callbacks_cancellation_and_namespace_streaming_fail_without_receipts() -> TestResult
{
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path().join("db"))?;
    for i in 0..20 {
        store.set_namespace(Namespace::new(
            NamespacePrefix::new(format!("p{i:02}"))?,
            NamedNode::new(format!("urn:n{i}"))?,
        ))?;
    }
    let view = capture(&store)?;
    let mut count = 0;
    let one = DerivedLimits {
        max_records: NonZeroU64::MIN,
        ..DerivedLimits::default()
    };
    assert!(matches!(
        view.scan(&one, |_| {
            count += 1;
            Ok(())
        }),
        Err(DerivedError::Limit)
    ));
    assert_eq!(count, 1);
    let tiny = DerivedLimits {
        max_bytes: NonZeroU64::MIN,
        ..DerivedLimits::default()
    };
    assert!(matches!(
        view.scan(&tiny, |_| Err(StorageError::Other(
            "oversize delivered".into()
        ))),
        Err(DerivedError::Limit)
    ));
    let error = view
        .scan(&DerivedLimits::default(), |_| {
            Err(StorageError::Other("fake failed".into()))
        })
        .err()
        .ok_or("callback accepted")?;
    assert!(error.to_string().contains("fake failed"));
    let cancelled = DerivedLimits::default();
    cancelled.control.cancel();
    assert!(matches!(
        view.scan(&cancelled, |_| Err(StorageError::Other(
            "cancelled callback".into()
        ))),
        Err(DerivedError::Backup(BackupError::Cancelled))
    ));
    assert!(matches!(
        view.delta(None, &cancelled),
        Err(DerivedError::Backup(BackupError::Cancelled))
    ));
    let timed = DerivedLimits {
        control: TransactionStartControl::new().with_timeout(Duration::ZERO),
        ..DerivedLimits::default()
    };
    assert!(matches!(
        view.scan(&timed, |_| Err(StorageError::Other(
            "timed callback".into()
        ))),
        Err(DerivedError::Backup(BackupError::TimedOut))
    ));
    assert!(matches!(
        store.derived_snapshot(&timed.control),
        Err(DerivedError::Backup(BackupError::TimedOut))
    ));
    let during = DerivedLimits::default();
    assert!(matches!(
        view.scan(&during, |_| {
            during.control.cancel();
            Ok(())
        }),
        Err(DerivedError::Backup(BackupError::Cancelled))
    ));
    let scan = view.scan(&DerivedLimits::default(), |_| Ok(()))?;
    assert_eq!(scan.records(), 20);
    assert!(scan.logical_bytes() > 20);
    assert_eq!(scan, view.scan(&DerivedLimits::default(), |_| Ok(()))?);
    Ok(())
}

#[test]
fn retention_expiry_and_foreign_sources_reject_but_captured_feed_is_stable() -> TestResult {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path().join("db"))?;
    store.configure_outbox_retention(
        OutboxRetentionPolicy::new(NonZeroU64::new(100).ok_or("cap")?, NonZeroU16::MIN)?,
        GovernanceTime::from_unix_millis(1),
    )?;
    let first = commit(&store, 1)?;
    let second = commit(&store, 2)?;
    let third = commit(&store, 3)?;
    let old = capture(&store)?;
    store.maintain_outbox(
        &second.outbox_end_cursor().ok_or("cursor")?,
        NonZeroUsize::new(100).ok_or("limit")?,
        GovernanceTime::from_unix_millis(2),
    )?;
    store.maintain_outbox(
        &second.outbox_end_cursor().ok_or("cursor")?,
        NonZeroUsize::new(100).ok_or("limit")?,
        GovernanceTime::from_unix_millis(3),
    )?;
    let now = capture(&store)?;
    assert_eq!(
        now.checkpoint().retained_after(),
        second.outbox_end_cursor().as_ref()
    );
    assert_eq!(
        old.delta(None, &DerivedLimits::default())?.commits().len(),
        3
    );
    assert!(matches!(
        now.delta(None, &DerivedLimits::default()),
        Err(DerivedError::Outbox(OutboxReadError::CursorExpired { .. }))
    ));
    let expired = now.delta(
        Some(&ContributorCheckpoint::new(first)?),
        &DerivedLimits::default(),
    );
    assert!(
        matches!(
            expired,
            Err(DerivedError::Outbox(OutboxReadError::CursorExpired { .. }))
        ),
        "{expired:?}"
    );
    let from_anchor = now.delta(
        Some(&ContributorCheckpoint::new(second)?),
        &DerivedLimits::default(),
    )?;
    assert_eq!(from_anchor.commits().len(), 1);
    assert_eq!(from_anchor.commits()[0].receipt(), &third);
    let other = Store::open(dir.path().join("other"))?;
    let foreign = ContributorCheckpoint::new(commit(&other, 3)?)?;
    assert!(matches!(
        now.delta(Some(&foreign), &DerivedLimits::default()),
        Err(DerivedError::InvalidCheckpoint)
    ));
    assert!(matches!(
        now.check_current(&other),
        Err(DerivedError::NotFresh)
    ));
    Ok(())
}

#[test]
fn ungoverned_changes_cannot_be_hidden_by_a_later_governed_receipt() -> TestResult {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("db");
    let store = Store::open(&path)?;
    let first = commit(&store, 1)?;
    let before = capture(&store)?;
    store.insert(quad(99, GraphName::DefaultGraph))?;
    let after_unlogged = capture(&store)?;
    assert_eq!(
        before.checkpoint().latest_receipt(),
        after_unlogged.checkpoint().latest_receipt()
    );
    assert_ne!(
        before.checkpoint().rocksdb_sequence(),
        after_unlogged.checkpoint().rocksdb_sequence()
    );
    assert!(matches!(
        before.check_current(&store),
        Err(DerivedError::NotFresh)
    ));
    commit(&store, 2)?;
    let after = capture(&store)?;
    assert!(matches!(
        after_unlogged.check_current(&store),
        Err(DerivedError::NotFresh)
    ));
    let delta = after.delta(
        Some(&ContributorCheckpoint::new(first)?),
        &DerivedLimits::default(),
    )?;
    assert!(
        !delta
            .commits()
            .iter()
            .flat_map(DerivedCommit::changes)
            .any(|c| c == &SemanticChange::QuadAdded(quad(99, GraphName::DefaultGraph)))
    );
    assert!(collect(&after)?.contains(&SemanticChange::QuadAdded(quad(
        99,
        GraphName::DefaultGraph
    ))));
    // Receipt equality alone is deliberately never a whole-primary freshness gate.
    drop(before);
    drop(after_unlogged);
    drop(after);
    drop(store);
    let reopened = Store::open_read_only(path)?;
    let view = capture(&reopened)?;
    assert!(collect(&view)?.contains(&SemanticChange::QuadAdded(quad(
        99,
        GraphName::DefaultGraph
    ))));
    view.check_current(&reopened)?;
    assert!(capture(&Store::new()?).is_err());
    Ok(())
}
