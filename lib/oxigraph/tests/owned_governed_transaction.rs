#![cfg(not(target_family = "wasm"))]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public owned governed transaction contract"
)]

use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::store::{
    CommitReceipt, CommitReceiptOutcome, ConflictBehavior, GovernedTransaction, Namespace,
    NamespacePrefix, OutboxRecord, OutcomeAwareTransactionalDataset, OutcomeLookup, SemanticChange,
    Store, TransactionCapabilities, TransactionKey, TransactionNonCommitReason, TransactionRequest,
    TransactionRequirements, TransactionStartControl, TransactionStartError,
    UnmetTransactionRequirement, WritableDataset, WritableNamespaceRegistry, WriterIsolation,
};
use std::error::Error;
use std::num::NonZeroUsize;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

type TestError = Box<dyn Error + Send + Sync>;
type TestResult = Result<(), TestError>;

const BOUND: Duration = Duration::from_secs(5);

fn key(byte: u8) -> TransactionKey {
    TransactionKey::new([byte; 16])
}

fn node(label: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:owned-governed:{label}"))
}

fn quad(graph: GraphName) -> Quad {
    Quad::new(node("s"), node("p"), node("o"), graph)
}

fn namespace(prefix: &str) -> Result<Namespace, TestError> {
    Ok(Namespace::new(
        NamespacePrefix::new(prefix.to_owned())?,
        NamedNode::new(format!("http://example.com/{prefix}/"))?,
    ))
}

fn assert_static_send<T: Send + 'static>(_value: &T) {}

fn page_of(
    store: &Store,
    after: Option<&oxigraph::store::OutboxCursor>,
) -> Result<oxigraph::store::OutboxBatch, TestError> {
    Ok(store.read_outbox(after, NonZeroUsize::new(100).ok_or("zero page")?)?)
}

fn bounded<T: Send + 'static>(
    store: &Store,
    work: impl FnOnce(Store) -> T + Send + 'static,
) -> Result<T, TestError> {
    let store = store.clone();
    let (sender, receiver) = mpsc::channel();
    let handle = thread::spawn(move || {
        let _delivered = sender.send(work(store));
    });
    let value = receiver.recv_timeout(BOUND)?;
    handle.join().map_err(|_| "bounded thread panicked")?;
    Ok(value)
}

#[derive(Debug, PartialEq)]
enum Start {
    Started,
    Requirements(Vec<UnmetTransactionRequirement>, TransactionCapabilities),
    Cancelled,
    TimedOut,
    Backend,
}

fn governed_start(
    store: &Store,
    request: TransactionRequest,
    transaction_key: TransactionKey,
    control: TransactionStartControl,
) -> Start {
    match store.start_owned_governed_transaction_with_control(request, transaction_key, control) {
        Ok(_) => Start::Started,
        Err(TransactionStartError::RequirementsNotMet { unmet, effective }) => {
            Start::Requirements(unmet, effective)
        }
        Err(TransactionStartError::Cancelled) => Start::Cancelled,
        Err(TransactionStartError::TimedOut) => Start::TimedOut,
        Err(TransactionStartError::Backend(_)) => Start::Backend,
    }
}

fn commit_after_store_drop(store: Store, _durable: bool) -> TestResult {
    let probe = store.clone();
    let transaction_key = key(1);
    let started = store
        .start_owned_governed_transaction(TransactionRequest::default(), transaction_key.clone())?;
    assert_eq!(
        started.effective_capabilities(),
        &store.transaction_capabilities()
    );
    let mut tx = started.into_transaction();
    assert_static_send(&tx);
    assert_eq!(tx.transaction_key(), &transaction_key);

    let default_quad = quad(GraphName::DefaultGraph);
    let named_quad = quad(GraphName::from(node("g")));
    let graph = NamedOrBlankNode::from(node("g"));
    let empty = NamedOrBlankNode::from(node("empty"));
    let mapping = namespace("ex")?;
    tx.insert(default_quad.clone())?;
    tx.insert(named_quad.clone())?;
    tx.insert_named_graph(empty.clone())?;
    tx.set_namespace(mapping.clone())?;
    assert!(tx.contains_named_graph(&empty)?);
    assert_eq!(tx.namespace(mapping.prefix())?, Some(mapping.clone()));

    let changes = tx.changes()?;
    let expected = [
        SemanticChange::QuadAdded(default_quad.clone()),
        SemanticChange::NamedGraphCreated(graph.clone()),
        SemanticChange::QuadAdded(named_quad.clone()),
        SemanticChange::NamedGraphCreated(empty.clone()),
        SemanticChange::NamespaceChanged {
            prefix: mapping.prefix().clone(),
            before: None,
            after: Some(mapping.iri().clone()),
        },
    ];
    assert_eq!(changes.as_slice(), expected.as_slice());

    assert!(!probe.contains(&default_quad)?);
    assert!(!probe.contains_named_graph(&empty)?);
    assert_eq!(probe.namespaces().count(), 0);
    assert_eq!(
        probe.lookup_commit_receipt(&transaction_key)?,
        CommitReceiptOutcome::Indeterminate
    );

    drop(store);
    let receipt = tx.commit()?;
    assert_eq!(receipt.transaction_key(), &transaction_key);
    assert_eq!(receipt.sequence(), 1);
    assert_eq!(receipt.schema_version(), 2);
    assert!(receipt.verifies_changes(&changes));
    assert_eq!(
        probe.lookup_commit_receipt(&transaction_key)?,
        CommitReceiptOutcome::Committed(receipt.clone())
    );

    assert!(probe.contains(&default_quad)?);
    assert!(probe.contains(&named_quad)?);
    assert!(probe.contains_named_graph(&graph)?);
    assert!(probe.contains_named_graph(&empty)?);
    assert_eq!(probe.namespace(mapping.prefix())?, Some(mapping));

    let page = page_of(&probe, None)?;
    assert_eq!(page.records().len(), changes.len() + 1);
    let events: Vec<_> = page
        .records()
        .iter()
        .filter_map(|record| match record {
            OutboxRecord::Event { change, .. } => Some(change.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(events, changes.as_slice());
    assert_eq!(page.high_water(), receipt.outbox_end_cursor().as_ref());
    Ok(())
}

fn commit_on_another_thread(store: Store, _durable: bool) -> TestResult {
    let mut tx = store
        .start_owned_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(quad(GraphName::DefaultGraph))?;
    let (sender, receiver) = mpsc::channel();
    let worker = thread::spawn(move || {
        let result = (|| -> Result<CommitReceipt, TestError> {
            tx.insert(quad(GraphName::from(node("g"))))?;
            Ok(tx.commit()?)
        })();
        let _delivered = sender.send(result);
    });
    let receipt = receiver.recv_timeout(BOUND)??;
    worker.join().map_err(|_| "owned worker panicked")?;
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Committed(receipt)
    );
    assert_eq!(store.len()?, 2);
    Ok(())
}

fn effective_profile(store: Store, durable: bool) -> TestResult {
    let started = store.start_owned_governed_transaction(TransactionRequest::default(), key(1))?;
    let effective = started.effective_capabilities().clone();
    assert_eq!(effective, store.transaction_capabilities());
    assert_eq!(effective.writer_isolation(), WriterIsolation::Serialized);
    assert_eq!(
        effective.outcome_lookup() == OutcomeLookup::DurableByTransactionKey,
        durable
    );
    started.into_transaction().rollback()?;
    Ok(())
}

fn rollback_and_drop(store: Store, _durable: bool) -> TestResult {
    for (id, explicit) in [(1, true), (2, false)] {
        let mut tx = store
            .start_owned_governed_transaction(TransactionRequest::default(), key(id))?
            .into_transaction();
        tx.insert(quad(GraphName::from(node("g"))))?;
        tx.insert_named_graph(NamedOrBlankNode::from(node("empty")))?;
        tx.set_namespace(namespace("ex")?)?;
        assert!(!tx.changes()?.is_empty());
        if explicit {
            tx.rollback()?;
        } else {
            drop(tx);
        }
        assert_eq!(
            store.lookup_commit_receipt(&key(id))?,
            CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
        );
        assert!(store.is_empty()?);
        assert_eq!(store.named_graphs().count(), 0);
        assert_eq!(store.namespaces().count(), 0);
        assert!(
            store
                .start_owned_governed_transaction(TransactionRequest::default(), key(id))
                .is_err()
        );
    }
    let page = page_of(&store, None)?;
    assert!(page.records().is_empty());
    assert!(page.high_water().is_none());
    let next = store
        .start_owned_governed_transaction(TransactionRequest::default(), key(3))?
        .into_transaction()
        .commit()?;
    assert_eq!(next.sequence(), 1);
    Ok(())
}

fn unmet_requirement_before_reservation(store: Store, durable: bool) -> TestResult {
    let holder = store
        .start_owned_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    let effective = store.transaction_capabilities();

    let conflict = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_conflict_behavior(ConflictBehavior::DetectedAndRejected),
    );
    let outcome = bounded(&store, move |store| {
        governed_start(&store, conflict, key(2), TransactionStartControl::new())
    })?;
    assert_eq!(
        outcome,
        Start::Requirements(
            vec![UnmetTransactionRequirement::ConflictBehavior],
            effective.clone()
        )
    );
    assert_eq!(
        store.lookup_commit_receipt(&key(2))?,
        CommitReceiptOutcome::Indeterminate
    );

    if !durable {
        let request = TransactionRequest::new(
            TransactionRequirements::legacy()
                .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
        );
        let outcome = bounded(&store, move |store| {
            governed_start(&store, request, key(3), TransactionStartControl::new())
        })?;
        assert_eq!(
            outcome,
            Start::Requirements(vec![UnmetTransactionRequirement::OutcomeLookup], effective)
        );
        assert_eq!(
            store.lookup_commit_receipt(&key(3))?,
            CommitReceiptOutcome::Indeterminate
        );
    }

    holder.rollback()?;
    let receipt = store
        .start_owned_governed_transaction(TransactionRequest::default(), key(2))?
        .into_transaction()
        .commit()?;
    assert_eq!(receipt.sequence(), 1);
    Ok(())
}

fn timed_and_cancelled_admission(store: Store, _durable: bool) -> TestResult {
    let holder = store
        .start_owned_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    let before = store.transaction_metrics();

    let timed_out = bounded(&store, |store| {
        governed_start(
            &store,
            TransactionRequest::default(),
            key(2),
            TransactionStartControl::new().with_timeout(Duration::from_millis(50)),
        )
    })?;
    assert_eq!(timed_out, Start::TimedOut);

    let cancelled = bounded(&store, |store| {
        let control = TransactionStartControl::new();
        control.cancel();
        governed_start(&store, TransactionRequest::default(), key(3), control)
    })?;
    assert_eq!(cancelled, Start::Cancelled);

    let control = TransactionStartControl::new();
    let (sender, receiver) = mpsc::channel();
    let waiter_store = store.clone();
    let waiter_control = control.clone();
    let waiter = thread::spawn(move || {
        let _delivered = sender.send(governed_start(
            &waiter_store,
            TransactionRequest::default(),
            key(4),
            waiter_control,
        ));
    });
    let still_queued = receiver.recv_timeout(Duration::from_millis(100));
    control.cancel();
    let queued_result = receiver.recv_timeout(Duration::from_secs(1));
    waiter.join().map_err(|_| "queued waiter panicked")?;
    assert_eq!(still_queued, Err(RecvTimeoutError::Timeout));
    assert_eq!(queued_result, Ok(Start::Cancelled));

    assert_eq!(
        store.transaction_metrics(),
        before,
        "failed admission must not record an observation"
    );
    holder.rollback()?;

    for id in 2..=4 {
        assert_eq!(
            store.lookup_commit_receipt(&key(id))?,
            CommitReceiptOutcome::Indeterminate
        );
        store
            .start_owned_governed_transaction(TransactionRequest::default(), key(id))?
            .into_transaction()
            .rollback()?;
        assert_eq!(
            store.lookup_commit_receipt(&key(id))?,
            CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
        );
    }
    let receipt = store
        .start_owned_governed_transaction(TransactionRequest::default(), key(5))?
        .into_transaction()
        .commit()?;
    assert_eq!(receipt.sequence(), 1);
    Ok(())
}

fn duplicate_keys(store: Store, _durable: bool) -> TestResult {
    let mut tx = store
        .start_owned_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(quad(GraphName::DefaultGraph))?;
    let receipt = tx.commit()?;
    store
        .start_owned_governed_transaction(TransactionRequest::default(), key(2))?
        .into_transaction()
        .rollback()?;

    for id in [1, 2] {
        assert!(
            store
                .start_owned_governed_transaction(TransactionRequest::default(), key(id))
                .is_err()
        );
        assert!(
            store
                .start_governed_transaction(TransactionRequest::default(), key(id))
                .is_err()
        );
        assert!(
            store
                .start_transaction_with_key(TransactionRequest::default(), key(id))
                .is_err()
        );
    }
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Committed(receipt)
    );
    assert_eq!(
        store.lookup_commit_receipt(&key(2))?,
        CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert_eq!(store.len()?, 1);

    let legacy = store
        .start_transaction_with_key(TransactionRequest::default(), key(4))?
        .into_transaction();
    legacy.commit()?;
    assert_eq!(
        store.lookup_commit_receipt(&key(4))?,
        CommitReceiptOutcome::CommittedWithoutReceipt
    );
    assert!(
        store
            .start_owned_governed_transaction(TransactionRequest::default(), key(4))
            .is_err()
    );
    assert_eq!(
        store.lookup_commit_receipt(&key(9))?,
        CommitReceiptOutcome::Indeterminate
    );
    Ok(())
}

fn legacy_borrowed_governed_commit(store: Store, _durable: bool) -> TestResult {
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(quad(GraphName::DefaultGraph))?;
    let changes = tx.changes()?;
    let receipt = tx.commit()?;
    assert!(receipt.verifies_changes(&changes));
    assert_eq!(receipt.sequence(), 1);
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Committed(receipt)
    );
    Ok(())
}

macro_rules! backends {
    ($($name:ident),* $(,)?) => {
        mod memory {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    super::$name(Store::new()?, false)
                }
            )*
        }

        #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
        mod rocksdb {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    let directory = tempfile::tempdir()?;
                    super::$name(Store::open(directory.path())?, true)
                }
            )*
        }
    };
}

backends!(
    commit_after_store_drop,
    commit_on_another_thread,
    effective_profile,
    rollback_and_drop,
    unmet_requirement_before_reservation,
    timed_and_cancelled_admission,
    duplicate_keys,
    legacy_borrowed_governed_commit,
);

#[test]
fn owned_governed_handle_is_static_and_send() {
    fn check<T: Send + 'static>() {}
    check::<GovernedTransaction<'static>>();
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_handle_is_released_and_receipt_survives_reopen() -> TestResult {
    let directory = tempfile::tempdir()?;
    let staged = quad(GraphName::DefaultGraph);
    let store = Store::open(directory.path())?;
    let mut tx = store
        .start_owned_governed_transaction(TransactionRequest::default(), key(1))?
        .into_transaction();
    tx.insert(staged.clone())?;
    let changes = tx.changes()?;
    drop(store);
    let receipt = tx.commit()?;
    assert!(receipt.verifies_changes(&changes));

    let reopened = Store::open(directory.path())?;
    assert_eq!(
        reopened.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Committed(receipt)
    );
    assert!(reopened.contains(&staged)?);
    assert_eq!(page_of(&reopened, None)?.records().len(), changes.len() + 1);
    Ok(())
}
