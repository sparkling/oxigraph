#![cfg(not(target_family = "wasm"))]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public owned keyed transaction contract"
)]

use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::store::{
    CancellationGuarantee, ConflictBehavior, KeyedTransaction, Namespace, NamespacePrefix,
    NegotiatedTransaction, OutcomeAwareTransactionalDataset, OutcomeLookup, Store, TransactionKey,
    TransactionNonCommitReason, TransactionOutcome, TransactionRequest, TransactionRequirements,
    TransactionStartControl, TransactionStartError, UnmetTransactionRequirement,
};
use std::error::Error;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

type TestError = Box<dyn Error + Send + Sync>;
type TestResult = Result<(), TestError>;

const BOUND: Duration = Duration::from_secs(5);
const ROLLED_BACK: TransactionOutcome =
    TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Terminal {
    Commit,
    Rollback,
    Drop,
}

#[derive(Debug, Eq, PartialEq)]
enum Start {
    Started,
    Requirements,
    Cancelled,
    TimedOut,
    Backend,
}

fn key(byte: u8) -> TransactionKey {
    TransactionKey::new([byte; 16])
}

fn node(label: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:owned-keyed:{label}"))
}

fn quad(label: &str) -> Quad {
    Quad::new(node(label), node("p"), node("o"), GraphName::DefaultGraph)
}

fn named_quad(label: &str, graph: &str) -> Quad {
    Quad::new(node(label), node("p"), node("o"), node(graph))
}

fn namespace(prefix: &str) -> Result<Namespace, TestError> {
    Ok(Namespace::new(
        NamespacePrefix::new(prefix.to_owned())?,
        NamedNode::new(format!("http://example.com/{prefix}/"))?,
    ))
}

fn outcome(store: &Store, byte: u8) -> Result<TransactionOutcome, TestError> {
    Ok(store.lookup_transaction_outcome(&key(byte))?)
}

fn open(store: &Store, byte: u8) -> Result<KeyedTransaction<'static>, TestError> {
    Ok(store
        .start_owned_transaction_with_key(TransactionRequest::default(), key(byte))?
        .into_transaction())
}

fn start_kind(
    store: &Store,
    request: TransactionRequest,
    byte: u8,
    control: TransactionStartControl,
) -> Start {
    match store.start_owned_transaction_with_key_and_control(request, key(byte), control) {
        Ok(_) => Start::Started,
        Err(TransactionStartError::RequirementsNotMet { .. }) => Start::Requirements,
        Err(TransactionStartError::Cancelled) => Start::Cancelled,
        Err(TransactionStartError::TimedOut) => Start::TimedOut,
        Err(TransactionStartError::Backend(_)) => Start::Backend,
    }
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

fn stage(tx: &mut KeyedTransaction<'static>, observer: &Store) -> TestResult {
    let graph = NamedOrBlankNode::from(node("graph"));
    let empty = NamedOrBlankNode::from(node("empty"));
    let ns = namespace("ex")?;
    tx.insert(quad("default"));
    tx.insert(named_quad("named", "graph"));
    tx.insert_named_graph(empty.clone());
    tx.set_namespace(ns.clone())?;
    assert!(tx.contains(&quad("default"))?);
    assert_eq!(tx.len()?, 2);
    assert!(tx.contains_named_graph(&graph)?);
    assert!(tx.contains_named_graph(&empty)?);
    assert_eq!(tx.namespace(ns.prefix())?, Some(ns.clone()));
    assert_eq!(tx.namespaces().count(), 1);
    assert!(!observer.contains(&quad("default"))?);
    assert!(!observer.contains_named_graph(&graph)?);
    assert!(!observer.contains_named_graph(&empty)?);
    assert!(observer.namespace(ns.prefix())?.is_none());
    Ok(())
}

fn terminal_path(store: Store, byte: u8, terminal: Terminal) -> TestResult {
    let observer = store.clone();
    let mut tx = open(&store, byte)?;
    assert_eq!(tx.transaction_key(), &key(byte));
    stage(&mut tx, &observer)?;
    assert_eq!(outcome(&observer, byte)?, TransactionOutcome::Indeterminate);
    drop(store);
    let expected = match terminal {
        Terminal::Commit => {
            tx.commit()?;
            TransactionOutcome::Committed
        }
        Terminal::Rollback => {
            tx.rollback()?;
            ROLLED_BACK
        }
        Terminal::Drop => {
            drop(tx);
            ROLLED_BACK
        }
    };
    assert_eq!(outcome(&observer, byte)?, expected);

    let published = terminal == Terminal::Commit;
    let ns = namespace("ex")?;
    assert_eq!(observer.contains(&quad("default"))?, published);
    assert_eq!(observer.contains(&named_quad("named", "graph"))?, published);
    assert_eq!(
        observer.contains_named_graph(&node("graph").into())?,
        published
    );
    assert_eq!(
        observer.contains_named_graph(&node("empty").into())?,
        published
    );
    assert_eq!(observer.namespace(ns.prefix())?.is_some(), published);

    let reused = start_kind(
        &observer,
        TransactionRequest::default(),
        byte,
        TransactionStartControl::new(),
    );
    assert_eq!(reused, Start::Backend);
    assert!(
        observer
            .start_transaction_with_key(TransactionRequest::default(), key(byte))
            .is_err()
    );
    assert_eq!(outcome(&observer, byte)?, expected);
    assert_eq!(outcome(&observer, 0xEE)?, TransactionOutcome::Indeterminate);
    Ok(())
}

fn commit_path(store: Store) -> TestResult {
    terminal_path(store, 1, Terminal::Commit)
}

fn rollback_path(store: Store) -> TestResult {
    terminal_path(store, 2, Terminal::Rollback)
}

fn drop_path(store: Store) -> TestResult {
    terminal_path(store, 3, Terminal::Drop)
}

fn lookups_stay_bound_to_their_own_key(store: Store) -> TestResult {
    let mut committed = open(&store, 1)?;
    committed.insert(quad("one"));
    committed.commit()?;
    let mut rolled_back = open(&store, 2)?;
    rolled_back.insert(quad("two"));
    rolled_back.rollback()?;
    let mut dropped = open(&store, 3)?;
    dropped.insert(quad("three"));
    drop(dropped);

    assert_eq!(outcome(&store, 1)?, TransactionOutcome::Committed);
    assert_eq!(outcome(&store, 2)?, ROLLED_BACK);
    assert_eq!(outcome(&store, 3)?, ROLLED_BACK);
    assert_eq!(outcome(&store, 4)?, TransactionOutcome::Indeterminate);
    assert!(store.contains(&quad("one"))?);
    assert!(!store.contains(&quad("two"))?);
    assert!(!store.contains(&quad("three"))?);
    Ok(())
}

fn effective_profile_is_the_store_profile(store: Store) -> TestResult {
    let expected = store.transaction_capabilities();
    let started = store.start_owned_transaction_with_key(TransactionRequest::default(), key(30))?;
    assert_eq!(started.effective_capabilities(), &expected);
    started.into_transaction().rollback()?;

    let started = store.start_owned_transaction_with_key_and_control(
        TransactionRequest::default(),
        key(31),
        TransactionStartControl::new().with_timeout(BOUND),
    )?;
    assert_eq!(started.effective_capabilities(), &expected);
    started.into_transaction().rollback()?;
    assert_eq!(outcome(&store, 30)?, ROLLED_BACK);
    assert_eq!(outcome(&store, 31)?, ROLLED_BACK);
    Ok(())
}

fn requirements_rejected_before_admission_and_reservation(store: Store) -> TestResult {
    let holder = open(&store, 10)?;
    let unmet_request = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_conflict_behavior(ConflictBehavior::DetectedAndRejected)
            .requiring_cancellation(CancellationGuarantee::BeforeCommitAttempt),
    );
    let rejected = bounded(&store, move |store| {
        match store.start_owned_transaction_with_key_and_control(
            unmet_request,
            key(11),
            TransactionStartControl::new(),
        ) {
            Err(TransactionStartError::RequirementsNotMet { unmet, effective }) => {
                Some((unmet, effective))
            }
            _ => None,
        }
    })?;
    let (unmet, effective) = rejected.ok_or("unmet request was not rejected before admission")?;
    assert_eq!(
        unmet,
        vec![
            UnmetTransactionRequirement::ConflictBehavior,
            UnmetTransactionRequirement::Cancellation,
        ]
    );
    assert_eq!(effective, store.transaction_capabilities());
    assert_eq!(outcome(&store, 11)?, TransactionOutcome::Indeterminate);

    holder.rollback()?;
    assert_eq!(outcome(&store, 10)?, ROLLED_BACK);
    open(&store, 11)?.rollback()?;
    assert_eq!(outcome(&store, 11)?, ROLLED_BACK);
    Ok(())
}

fn admission_failures_leak_no_key_or_permit(store: Store) -> TestResult {
    let mut holder = open(&store, 20)?;
    holder.insert(quad("held"));

    let timed_out = bounded(&store, |store| {
        start_kind(
            &store,
            TransactionRequest::default(),
            21,
            TransactionStartControl::new().with_timeout(Duration::from_millis(50)),
        )
    })?;
    assert_eq!(timed_out, Start::TimedOut);

    let control = TransactionStartControl::new();
    let (sender, receiver) = mpsc::channel();
    let waiter_store = store.clone();
    let waiter_control = control.clone();
    let waiter = thread::spawn(move || {
        let _delivered = sender.send(start_kind(
            &waiter_store,
            TransactionRequest::default(),
            22,
            waiter_control,
        ));
    });
    let still_queued = receiver.recv_timeout(Duration::from_millis(100));
    control.cancel();
    let cancelled = receiver.recv_timeout(BOUND)?;
    waiter.join().map_err(|_| "cancel waiter panicked")?;
    assert_eq!(still_queued, Err(RecvTimeoutError::Timeout));
    assert_eq!(cancelled, Start::Cancelled);

    let pre_cancelled = TransactionStartControl::new();
    pre_cancelled.cancel();
    let pre_cancelled = bounded(&store, move |store| {
        start_kind(&store, TransactionRequest::default(), 23, pre_cancelled)
    })?;
    assert_eq!(pre_cancelled, Start::Cancelled);

    for byte in [21, 22, 23] {
        assert_eq!(outcome(&store, byte)?, TransactionOutcome::Indeterminate);
    }
    holder.rollback()?;
    assert_eq!(outcome(&store, 20)?, ROLLED_BACK);
    for byte in [21, 22, 23] {
        open(&store, byte)?.rollback()?;
        assert_eq!(outcome(&store, byte)?, ROLLED_BACK);
    }
    assert!(store.is_empty()?);
    Ok(())
}

fn moves_across_threads(store: Store) -> TestResult {
    let mut tx = open(&store, 70)?;
    tx.insert(quad("moved"));
    let (sender, receiver) = mpsc::channel();
    let worker = thread::spawn(move || {
        let result = (|| -> TestResult {
            tx.insert(quad("worker"));
            tx.commit()?;
            Ok(())
        })();
        let _delivered = sender.send(result);
    });
    receiver.recv_timeout(BOUND)??;
    worker.join().map_err(|_| "owned worker panicked")?;
    assert_eq!(outcome(&store, 70)?, TransactionOutcome::Committed);
    assert_eq!(store.len()?, 2);
    Ok(())
}

fn borrowed_keyed_path_still_works(store: Store) -> TestResult {
    let mut tx = store
        .start_transaction_with_key(TransactionRequest::default(), key(40))?
        .into_transaction();
    tx.insert(quad("borrowed"));
    tx.commit()?;
    assert_eq!(outcome(&store, 40)?, TransactionOutcome::Committed);
    assert!(store.contains(&quad("borrowed"))?);

    let mut tx = open(&store, 41)?;
    tx.insert(quad("owned"));
    tx.commit()?;
    assert_eq!(outcome(&store, 41)?, TransactionOutcome::Committed);
    assert_eq!(store.len()?, 2);

    let mut tx = store.start_transaction()?;
    tx.insert(quad("legacy"));
    tx.commit()?;
    assert_eq!(store.len()?, 3);
    Ok(())
}

macro_rules! backends {
    ($($name:ident),* $(,)?) => {
        mod memory {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    super::$name(Store::new()?)
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
                    super::$name(Store::open(directory.path())?)
                }
            )*
        }
    };
}

backends!(
    commit_path,
    rollback_path,
    drop_path,
    lookups_stay_bound_to_their_own_key,
    effective_profile_is_the_store_profile,
    requirements_rejected_before_admission_and_reservation,
    admission_failures_leak_no_key_or_permit,
    moves_across_threads,
    borrowed_keyed_path_still_works,
);

#[test]
fn keyed_handle_is_send_and_static() {
    fn check<T: Send + 'static>() {}
    check::<KeyedTransaction<'static>>();
    check::<NegotiatedTransaction<KeyedTransaction<'static>>>();
}

#[test]
fn memory_outcomes_are_process_local() -> TestResult {
    let store = Store::new()?;
    let expected = store.transaction_capabilities();
    assert_eq!(expected.outcome_lookup(), OutcomeLookup::Unsupported);
    let durable = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
    );
    let Err(TransactionStartError::RequirementsNotMet { unmet, effective }) =
        store.start_owned_transaction_with_key(durable, key(50))
    else {
        return Err("memory accepted a durable outcome requirement".into());
    };
    assert_eq!(unmet, vec![UnmetTransactionRequirement::OutcomeLookup]);
    assert_eq!(effective, expected);
    assert_eq!(outcome(&store, 50)?, TransactionOutcome::Indeterminate);

    let observer = store.clone();
    let mut tx = open(&store, 50)?;
    tx.insert(quad("local"));
    drop(store);
    tx.commit()?;
    assert_eq!(outcome(&observer, 50)?, TransactionOutcome::Committed);
    assert!(observer.contains(&quad("local"))?);

    let other = Store::new()?;
    assert_eq!(outcome(&other, 50)?, TransactionOutcome::Indeterminate);
    assert!(!other.contains(&quad("local"))?);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_outcomes_are_durable_across_orderly_reopen() -> TestResult {
    let directory = tempfile::tempdir()?;
    let ns = namespace("durable")?;
    let empty = NamedOrBlankNode::from(node("empty"));
    {
        let store = Store::open(directory.path())?;
        assert_eq!(
            store.transaction_capabilities().outcome_lookup(),
            OutcomeLookup::DurableByTransactionKey
        );
        let observer = store.clone();
        let durable = TransactionRequest::new(
            TransactionRequirements::legacy()
                .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
        );
        let started = store.start_owned_transaction_with_key(durable, key(60))?;
        assert_eq!(
            started.effective_capabilities().outcome_lookup(),
            OutcomeLookup::DurableByTransactionKey
        );
        let mut tx = started.into_transaction();
        drop(store);
        tx.insert(quad("durable"));
        tx.insert_named_graph(empty.clone());
        tx.set_namespace(ns.clone())?;
        tx.commit()?;

        let mut rolled_back = open(&observer, 61)?;
        rolled_back.insert(quad("rolled-back"));
        rolled_back.rollback()?;
        let mut dropped = open(&observer, 62)?;
        dropped.insert(quad("dropped"));
        drop(dropped);
    }

    let store = Store::open(directory.path())?;
    assert_eq!(outcome(&store, 60)?, TransactionOutcome::Committed);
    assert_eq!(outcome(&store, 61)?, ROLLED_BACK);
    assert_eq!(outcome(&store, 62)?, ROLLED_BACK);
    assert_eq!(outcome(&store, 63)?, TransactionOutcome::Indeterminate);
    assert!(store.contains(&quad("durable"))?);
    assert!(!store.contains(&quad("rolled-back"))?);
    assert!(!store.contains(&quad("dropped"))?);
    assert!(store.contains_named_graph(&empty)?);
    assert_eq!(store.namespace(ns.prefix())?, Some(ns));

    let reused = start_kind(
        &store,
        TransactionRequest::default(),
        60,
        TransactionStartControl::new(),
    );
    assert_eq!(reused, Start::Backend);
    open(&store, 63)?.commit()?;
    assert_eq!(outcome(&store, 63)?, TransactionOutcome::Committed);
    Ok(())
}
