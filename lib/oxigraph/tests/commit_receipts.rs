#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public atomic receipt contract"
)]

use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, Quad, Term};
use oxigraph::store::{
    CommitReceipt, CommitReceiptOutcome, Namespace, NamespacePrefix,
    OutcomeAwareTransactionalDataset, OutcomeAwareWritableDataset, OutcomeLookup,
    SemanticChangeSet, Store, TransactionKey, TransactionNonCommitReason, TransactionOutcome,
    TransactionRequest, TransactionRequirements, TransactionStartControl, TransactionStartError,
    WritableDataset, WritableNamespaceRegistry,
};
use std::error::Error;

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

fn key(byte: u8) -> TransactionKey {
    TransactionKey::new([byte; 16])
}
fn node(name: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:{name}"))
}
fn quad(name: &str) -> Quad {
    Quad::new(node(name), node("p"), node("o"), GraphName::DefaultGraph)
}

fn exercise(store: &Store) -> TestResult {
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Indeterminate
    );
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    assert_eq!(tx.transaction_key(), &key(1));
    tx.insert(quad("committed"))?;
    tx.insert(quad("committed"))?;
    tx.insert_named_graph(node("empty").into())?;
    tx.clear_graph(Some(&node("empty").into()))?;
    let ns = Namespace::new(NamespacePrefix::new("ex")?, node("namespace"));
    tx.set_namespace(ns.clone())?;
    let changes = tx.changes()?;
    assert_eq!(changes.len(), 4);
    assert!(!store.contains(&quad("committed"))?);
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Indeterminate
    );
    let receipt = tx.commit()?;
    // New governed commits bind the outbox range; v1 decoding remains covered
    // by the unchanged receipt-format compatibility fixture.
    assert_eq!(receipt.schema_version(), 2);
    assert_eq!(receipt.transaction_key(), &key(1));
    assert_eq!(receipt.sequence(), 1);
    assert!(receipt.verifies_changes(&changes));
    assert!(!receipt.verifies_changes(&SemanticChangeSet::default()));
    assert!(store.contains(&quad("committed"))?);
    assert!(store.contains_named_graph(&node("empty").into())?);
    assert_eq!(store.namespace(ns.prefix())?, Some(ns));
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Committed(receipt.clone())
    );
    assert_eq!(
        store.lookup_transaction_outcome(&key(1))?,
        TransactionOutcome::Committed
    );

    for id in [2, 3] {
        let mut tx = store
            .start_governed_transaction(TransactionRequest::default(), key(id))?
            .into_transaction();
        tx.clear()?;
        tx.clear_namespaces()?;
        if id == 2 {
            tx.rollback()?;
        } else {
            drop(tx);
        }
        assert_eq!(
            store.lookup_commit_receipt(&key(id))?,
            CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
        );
        assert!(store.contains(&quad("committed"))?);
        assert!(store.namespace(&NamespacePrefix::new("ex")?)?.is_some());
    }
    let empty = store
        .start_governed_transaction(TransactionRequest::default(), key(4))?
        .into_transaction()
        .commit()?;
    assert_eq!(empty.sequence(), 2);
    assert_eq!(empty.effect_count(), 0);
    assert_eq!(empty.store_identity(), receipt.store_identity());
    assert_ne!(empty.commit_id(), receipt.commit_id());
    assert!(empty.verifies_changes(&SemanticChangeSet::default()));

    // Both generic write interfaces must retain governance even if they discard the receipt.
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(5))?
        .into_transaction();
    tx.insert(quad("generic"))?;
    WritableDataset::commit(tx)?;
    let tx = store
        .start_governed_transaction(TransactionRequest::default(), key(6))?
        .into_transaction();
    OutcomeAwareWritableDataset::commit_with_outcome(tx)?;
    for id in [5, 6] {
        assert!(matches!(
            store.lookup_commit_receipt(&key(id))?,
            CommitReceiptOutcome::Committed(_)
        ));
    }

    // Caller keys cannot be reused by switching API, including a rolled-back reservation.
    for id in [1, 2, 3, 4, 5, 6] {
        assert!(
            store
                .start_transaction_with_key(TransactionRequest::default(), key(id))
                .is_err()
        );
        assert!(
            store
                .start_governed_transaction(TransactionRequest::default(), key(id))
                .is_err()
        );
    }
    let legacy = store
        .start_transaction_with_key(TransactionRequest::default(), key(7))?
        .into_transaction();
    OutcomeAwareWritableDataset::commit_with_outcome(legacy)?;
    assert_eq!(
        store.lookup_commit_receipt(&key(7))?,
        CommitReceiptOutcome::CommittedWithoutReceipt
    );
    assert!(
        store
            .start_governed_transaction(TransactionRequest::default(), key(7))
            .is_err()
    );
    Ok(())
}

#[test]
fn memory_receipts_bind_atomic_effects_and_shared_key_space() -> TestResult {
    exercise(&Store::new()?)
}

#[test]
fn memory_rejects_durability_before_reserving_governed_key() -> TestResult {
    let store = Store::new()?;
    let request = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
    );
    assert!(matches!(
        store.start_governed_transaction(request, key(1)),
        Err(TransactionStartError::RequirementsNotMet { .. })
    ));
    store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction()
        .rollback()?;
    Ok(())
}

#[test]
fn cancellation_rejects_governed_admission_without_reserving_key() -> TestResult {
    let store = Store::new()?;
    let token = oxigraph::sparql::CancellationToken::new();
    token.cancel();
    let control = TransactionStartControl::new().with_cancellation_token(token);
    assert!(matches!(
        store.start_governed_transaction_with_control(
            TransactionRequest::default(),
            key(1),
            control
        ),
        Err(TransactionStartError::Cancelled)
    ));
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Indeterminate
    );
    store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction()
        .rollback()?;
    Ok(())
}

fn changes_for(object: Term) -> TestResult<SemanticChangeSet> {
    let store = Store::new()?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(Quad::new(
        node("s"),
        node("p"),
        object,
        GraphName::DefaultGraph,
    ))?;
    Ok(tx.changes()?)
}

#[test]
fn checksum_preserves_rdf_identity_without_display_serialization() -> TestResult {
    // Independently framed v1 bytes, checked with a separate SHA-256 implementation.
    // This fixture must remain identical with and without rdf-12 enabled.
    assert_eq!(
        changes_for(Literal::new_simple_literal("text").into())?.checksum(),
        [
            93, 107, 243, 216, 161, 137, 100, 172, 91, 69, 209, 249, 164, 17, 172, 127, 154, 192,
            79, 151, 83, 114, 254, 20, 227, 207, 3, 113, 218, 175, 32, 212
        ]
    );
    let objects: Vec<Term> = vec![
        node("value").into(),
        BlankNode::new("value")?.into(),
        Literal::new_simple_literal("urn:value").into(),
        Literal::new_language_tagged_literal("urn:value", "en")?.into(),
        Literal::new_language_tagged_literal("urn:value", "fr")?.into(),
        Literal::new_typed_literal("urn:value", node("datatype")).into(),
        Literal::new_simple_literal("\"\\\n\0\u{e9}\u{65e5}\u{672c}\u{8a9e}").into(),
        Literal::new_simple_literal("\"\\\n\0e\u{301}\u{65e5}\u{672c}\u{8a9e}").into(),
    ];
    let mut checksums = std::collections::HashSet::new();
    for object in objects {
        let changes = changes_for(object.clone())?;
        assert_eq!(changes.checksum(), changes_for(object)?.checksum());
        assert!(checksums.insert(changes.checksum()));
    }
    Ok(())
}

fn exercise_concurrent_receipts(store: &Store) -> TestResult {
    let receipts = std::thread::scope(|scope| {
        let handles: Vec<_> = (1..=4)
            .map(|id| {
                scope.spawn(move || -> TestResult<CommitReceipt> {
                    let mut tx = store
                        .start_governed_transaction(TransactionRequest::default(), key(id))?
                        .into_transaction();
                    tx.insert(quad(&format!("writer-{id}")))?;
                    Ok(tx.commit()?)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .map_err(|_| std::io::Error::other("governed writer panicked"))?
            })
            .collect::<TestResult<Vec<_>>>()
    })?;
    let mut sequences: Vec<_> = receipts.iter().map(CommitReceipt::sequence).collect();
    sequences.sort_unstable();
    assert_eq!(sequences, vec![1, 2, 3, 4]);
    for receipt in receipts {
        assert_eq!(
            store.lookup_commit_receipt(receipt.transaction_key())?,
            CommitReceiptOutcome::Committed(receipt)
        );
    }
    assert_eq!(store.len()?, 4);
    Ok(())
}

#[test]
fn concurrent_governed_writers_allocate_unique_sequences() -> TestResult {
    exercise_concurrent_receipts(&Store::new()?)?;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    {
        let directory = tempfile::tempdir()?;
        exercise_concurrent_receipts(&Store::open(directory.path())?)?;
    }
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn checksum_distinguishes_direction_and_triple_terms() -> TestResult {
    use oxigraph::model::{BaseDirection, Triple};
    let plain = changes_for(Literal::new_language_tagged_literal("text", "en")?.into())?;
    let ltr = changes_for(
        Literal::new_directional_language_tagged_literal("text", "en", BaseDirection::Ltr)?.into(),
    )?;
    let rtl = changes_for(
        Literal::new_directional_language_tagged_literal("text", "en", BaseDirection::Rtl)?.into(),
    )?;
    assert_ne!(plain.checksum(), ltr.checksum());
    assert_ne!(ltr.checksum(), rtl.checksum());
    let triple = Triple::new(node("s"), node("p"), node("o"));
    assert_ne!(
        changes_for(triple.clone().into())?.checksum(),
        changes_for(Literal::new_simple_literal(triple.to_string()).into())?.checksum()
    );
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_receipts_bind_atomic_effects_and_shared_key_space() -> TestResult {
    let directory = tempfile::tempdir()?;
    exercise(&Store::open(directory.path())?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_receipts_survive_read_only_reopen_and_backup() -> TestResult {
    let directory = tempfile::tempdir()?;
    let backup_parent = tempfile::tempdir()?;
    let backup_path = backup_parent.path().join("backup");
    let receipt;
    {
        let store = Store::open(directory.path())?;
        let request = TransactionRequest::new(
            TransactionRequirements::legacy()
                .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
        );
        let mut tx = store
            .start_governed_transaction(request, key(1))?
            .into_transaction();
        tx.insert(quad("durable"))?;
        receipt = tx.commit()?;
        store.backup(&backup_path)?;
    }
    for path in [directory.path(), backup_path.as_path()] {
        let store = Store::open_read_only(path)?;
        assert_eq!(
            store.lookup_commit_receipt(&key(1))?,
            CommitReceiptOutcome::Committed(receipt.clone())
        );
        assert!(store.contains(&quad("durable"))?);
        assert!(
            store
                .start_governed_transaction(TransactionRequest::default(), key(2))
                .is_err()
        );
    }
    let store = Store::open(directory.path())?;
    let next = store
        .start_governed_transaction(TransactionRequest::default(), key(2))?
        .into_transaction()
        .commit()?;
    assert_eq!(next.store_identity(), receipt.store_identity());
    assert_eq!(next.sequence(), receipt.sequence() + 1);
    let other_parent = tempfile::tempdir()?;
    let other = Store::open(other_parent.path())?;
    let other_receipt = other
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction()
        .commit()?;
    assert_ne!(other_receipt.store_identity(), receipt.store_identity());
    Ok(())
}
