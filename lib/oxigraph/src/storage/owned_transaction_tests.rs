#![expect(
    clippy::panic_in_result_fn,
    reason = "lifetime tests assert observable outcomes inside fallible helpers"
)]

use super::*;
use crate::model::NamedNode;
use crate::store::{TransactionMetrics, TransactionNonCommitReason};
use std::any::Any;
use std::error::Error;
use std::thread;

type TestError = Box<dyn Error>;
type TestResult = Result<(), TestError>;

const BOUND: Duration = Duration::from_secs(10);
const SHORT: Duration = Duration::from_millis(50);
const TERMINALS: [Terminal; 3] = [Terminal::Commit, Terminal::Rollback, Terminal::Drop];

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
const BACKENDS: [Backend; 2] = [Backend::Memory, Backend::RocksDb];
#[cfg(not(all(not(target_family = "wasm"), feature = "rocksdb")))]
const BACKENDS: [Backend; 1] = [Backend::Memory];

#[derive(Clone, Copy)]
enum Backend {
    Memory,
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum Terminal {
    Commit,
    Rollback,
    Drop,
}

impl Terminal {
    const fn observation(self) -> TransactionObservation {
        match self {
            Self::Commit => TransactionObservation::Committed,
            Self::Rollback => TransactionObservation::RolledBack,
            Self::Drop => TransactionObservation::Abandoned,
        }
    }
}

#[derive(Clone, Copy)]
enum Flavor {
    Readable,
    Keyed,
    Governed,
}

// Memory keeps an observer clone. RocksDB keeps only its directory and reopens it.
struct Ctx {
    observer: Option<Storage>,
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    directory: Option<tempfile::TempDir>,
}

impl Backend {
    fn fixture(self) -> Result<(Storage, Ctx), TestError> {
        match self {
            Self::Memory => {
                let storage = Storage::new()?;
                let observer = Some(storage.clone());
                Ok((
                    storage,
                    Ctx {
                        observer,
                        #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                        directory: None,
                    },
                ))
            }
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            Self::RocksDb => {
                let directory = tempfile::tempdir()?;
                let storage = Storage::open(directory.path())?;
                Ok((
                    storage,
                    Ctx {
                        observer: None,
                        directory: Some(directory),
                    },
                ))
            }
        }
    }
}

impl Ctx {
    fn reopen(&self) -> Result<Storage, TestError> {
        if let Some(observer) = &self.observer {
            return Ok(observer.clone());
        }
        #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
        if let Some(directory) = &self.directory {
            return Ok(Storage::open(directory.path())?);
        }
        Err("fixture has no reopen path".into())
    }

    // `Some(true)` when a second RocksDB open is refused because a transaction owns the database.
    fn locked_by_transaction(&self) -> Option<bool> {
        if self.observer.is_some() {
            return None;
        }
        #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
        if let Some(directory) = &self.directory {
            return Some(Storage::open(directory.path()).is_err());
        }
        None
    }

    fn assert_isolated(&self, data: &Data) -> TestResult {
        if let Some(observer) = &self.observer {
            let snapshot = observer.snapshot();
            assert!(
                snapshot.contains(&EncodedQuad::from(&data.baseline))?,
                "staged removal must stay isolated before terminal call"
            );
            assert!(
                !snapshot.contains(&EncodedQuad::from(&data.staged))?,
                "staged quad must stay isolated before terminal call"
            );
        }
        Ok(())
    }
}

struct Data {
    baseline: Quad,
    g_quad: Quad,
    r_quad: Quad,
    staged: Quad,
    g_name: GraphName,
    g: NamedOrBlankNode,
    r: NamedOrBlankNode,
    empty: NamedOrBlankNode,
    namespace: Namespace,
}

fn node(name: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:owned:{name}"))
}

impl Data {
    fn new() -> Result<Self, TestError> {
        let g = node("g");
        let r = node("r");
        Ok(Self {
            baseline: Quad::new(
                node("s"),
                node("p"),
                node("baseline"),
                GraphName::DefaultGraph,
            ),
            g_quad: Quad::new(node("s"), node("p"), node("in-g"), g.clone()),
            r_quad: Quad::new(node("s"), node("p"), node("in-r"), r.clone()),
            staged: Quad::new(
                node("s"),
                node("p"),
                node("staged"),
                GraphName::DefaultGraph,
            ),
            g_name: GraphName::from(g.clone()),
            g: NamedOrBlankNode::from(g),
            r: NamedOrBlankNode::from(r),
            empty: NamedOrBlankNode::from(node("empty")),
            namespace: Namespace::new(NamespacePrefix::new("owned")?, node("ns")),
        })
    }
}

macro_rules! stage {
    ($tx:expr, $d:expr) => {{
        $tx.insert($d.staged.clone());
        $tx.insert_named_graph($d.empty.clone());
        $tx.set_namespace($d.namespace.clone())?;
        $tx.remove(&$d.baseline);
        $tx.clear_graph(&$d.g_name)?;
        $tx.remove_named_graph(&$d.r)?;
    }};
}

macro_rules! check_staged_view {
    ($tx:expr, $d:expr) => {{
        let reader = $tx.reader();
        assert!(
            reader.contains(&EncodedQuad::from(&$d.staged))?,
            "staged quad must be visible"
        );
        assert!(
            !reader.contains(&EncodedQuad::from(&$d.baseline))?,
            "staged removal must be visible"
        );
        assert!(
            !reader.contains(&EncodedQuad::from(&$d.g_quad))?,
            "cleared graph content must be gone"
        );
        assert!(
            !reader.contains(&EncodedQuad::from(&$d.r_quad))?,
            "removed graph content must be gone"
        );
        assert!(
            reader.contains_named_graph(&EncodedTerm::from(&$d.g))?,
            "clear must keep graph membership"
        );
        assert!(
            reader.contains_named_graph(&EncodedTerm::from(&$d.empty))?,
            "staged empty graph must be visible"
        );
        assert!(
            !reader.contains_named_graph(&EncodedTerm::from(&$d.r))?,
            "removed graph membership must be gone"
        );
        assert_eq!(
            reader.namespaces()?,
            vec![$d.namespace.clone()],
            "staged namespace must be visible"
        );
        let g_term = EncodedTerm::from(&$d.g);
        assert_eq!(
            reader
                .quads_for_pattern(None, None, None, Some(&g_term))
                .count(),
            0,
            "cleared graph must be empty"
        );
    }};
}

fn assert_static<T: 'static>(_: &T) {}

fn control() -> TransactionStartControl {
    TransactionStartControl::new().with_timeout(BOUND)
}

fn start_error(error: StorageTransactionStartError) -> TestError {
    match error {
        StorageTransactionStartError::Cancelled => "transaction start was cancelled".into(),
        StorageTransactionStartError::TimedOut => "transaction start timed out".into(),
        StorageTransactionStartError::Backend(error) => error.into(),
    }
}

// These signatures compile only if the start methods no longer borrow the original storage.
fn start_readable(storage: &Storage) -> Result<StorageReadableTransaction<'static>, TestError> {
    storage
        .start_readable_transaction_with_control(&control(), Instant::now())
        .map_err(start_error)
}

fn start_keyed(
    storage: &Storage,
    key: &[u8; 16],
) -> Result<StorageKeyedReadableTransaction<'static>, TestError> {
    storage
        .start_keyed_readable_transaction_with_control(key, &control(), Instant::now())
        .map_err(start_error)
}

fn start_governed(
    storage: &Storage,
    key: &[u8; 16],
) -> Result<StorageKeyedReadableTransaction<'static>, TestError> {
    storage
        .start_governed_transaction_with_control(key, &control(), Instant::now())
        .map_err(start_error)
}

fn seed(storage: &Storage, data: &Data) -> TestResult {
    let mut transaction = storage.start_transaction()?;
    transaction.insert(data.baseline.clone());
    transaction.insert(data.g_quad.clone());
    transaction.insert(data.r_quad.clone());
    transaction.commit()?;
    Ok(())
}

fn assert_single(
    before: &TransactionMetrics,
    after: &TransactionMetrics,
    expected: TransactionObservation,
) {
    for outcome in TransactionObservation::ALL {
        assert_eq!(
            after.count(outcome) - before.count(outcome),
            u64::from(outcome == expected),
            "unexpected {outcome:?} observation delta"
        );
    }
    assert_eq!(
        after.rollback_failures(),
        before.rollback_failures(),
        "terminal call must not add rollback failures"
    );
}

fn assert_state(storage: &Storage, data: &Data, committed: bool) -> TestResult {
    let reader = storage.snapshot();
    let has = |quad: &Quad| reader.contains(&EncodedQuad::from(quad));
    let has_graph =
        |graph: &NamedOrBlankNode| reader.contains_named_graph(&EncodedTerm::from(graph));
    assert_eq!(has(&data.staged)?, committed, "staged quad visibility");
    assert_eq!(has(&data.baseline)?, !committed, "baseline quad visibility");
    assert_eq!(
        has(&data.g_quad)?,
        !committed,
        "cleared graph quad visibility"
    );
    assert_eq!(
        has(&data.r_quad)?,
        !committed,
        "removed graph quad visibility"
    );
    assert!(has_graph(&data.g)?, "cleared graph must stay a member");
    assert_eq!(has_graph(&data.r)?, !committed, "removed graph membership");
    assert_eq!(has_graph(&data.empty)?, committed, "empty graph membership");
    let expected = if committed {
        vec![data.namespace.clone()]
    } else {
        Vec::new()
    };
    assert_eq!(reader.namespaces()?, expected, "namespace visibility");
    Ok(())
}

fn readable_case(backend: Backend, terminal: Terminal) -> TestResult {
    let data = Data::new()?;
    let (storage, ctx) = backend.fixture()?;
    seed(&storage, &data)?;
    let metrics = Arc::clone(&storage.transaction_metrics);
    let before = metrics.snapshot();
    let mut tx = start_readable(&storage)?;
    assert_static(&tx);
    drop(storage);
    assert!(
        ctx.locked_by_transaction().is_none_or(|locked| locked),
        "transaction alone must keep the database open"
    );
    stage!(tx, data);
    check_staged_view!(tx, data);
    ctx.assert_isolated(&data)?;
    match terminal {
        Terminal::Commit => tx.commit()?,
        Terminal::Rollback => tx.rollback(),
        Terminal::Drop => drop(tx),
    }
    assert_single(&before, &metrics.snapshot(), terminal.observation());
    let view = ctx.reopen()?;
    assert_state(&view, &data, terminal == Terminal::Commit)?;
    Ok(())
}

fn outcome_case(backend: Backend, governed: bool, terminal: Terminal) -> TestResult {
    let data = Data::new()?;
    let key = [0x71; 16];
    let (storage, ctx) = backend.fixture()?;
    seed(&storage, &data)?;
    let metrics = Arc::clone(&storage.transaction_metrics);
    let before = metrics.snapshot();
    let mut tx = if governed {
        start_governed(&storage, &key)?
    } else {
        start_keyed(&storage, &key)?
    };
    assert_static(&tx);
    drop(storage);
    assert!(
        ctx.locked_by_transaction().is_none_or(|locked| locked),
        "transaction alone must keep the database open"
    );
    stage!(tx, data);
    check_staged_view!(tx, data);
    ctx.assert_isolated(&data)?;
    let mut receipt = None;
    match (governed, terminal) {
        (false, Terminal::Commit) => tx.commit()?,
        (true, Terminal::Commit) => {
            receipt = Some(tx.commit_with_receipt(&SemanticChangeSet::default(), None)?);
        }
        (_, Terminal::Rollback) => tx.rollback()?,
        (_, Terminal::Drop) => drop(tx),
    }
    assert_single(&before, &metrics.snapshot(), terminal.observation());
    let view = ctx.reopen()?;
    let committed = terminal == Terminal::Commit;
    assert_state(&view, &data, committed)?;
    let expected = if committed {
        StorageTransactionOutcome::Committed
    } else {
        StorageTransactionOutcome::RolledBack
    };
    assert_eq!(
        view.lookup_transaction_outcome(&key)?,
        expected,
        "terminal outcome must resolve by key"
    );
    if governed {
        let expected = match receipt {
            Some(receipt) => CommitReceiptOutcome::Committed(receipt),
            None => CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack),
        };
        assert_eq!(
            view.lookup_commit_receipt(&key)?,
            expected,
            "governed terminal receipt outcome"
        );
    }
    let reuse = view
        .start_keyed_readable_transaction_with_control(&key, &control(), Instant::now())
        .err();
    assert!(
        matches!(reuse, Some(StorageTransactionStartError::Backend(_))),
        "terminal key must not be reserved again"
    );
    Ok(())
}

fn plain_start_case(backend: Backend) -> TestResult {
    let data = Data::new()?;
    let (storage, ctx) = backend.fixture()?;
    seed(&storage, &data)?;
    let metrics = Arc::clone(&storage.transaction_metrics);
    let before = metrics.snapshot();
    let mut tx: StorageReadableTransaction<'static> = storage.start_readable_transaction()?;
    drop(storage);
    tx.insert(data.staged.clone());
    tx.commit()?;
    assert_single(
        &before,
        &metrics.snapshot(),
        TransactionObservation::Committed,
    );
    let view = ctx.reopen()?;
    assert!(
        view.snapshot().contains(&EncodedQuad::from(&data.staged))?,
        "plain readable start must commit after original storage drops"
    );
    Ok(())
}

fn metrics_owner_case(backend: Backend) -> TestResult {
    let (storage, mut ctx) = backend.fixture()?;
    ctx.observer = None;
    let weak = Arc::downgrade(&storage.transaction_metrics);
    let tx = start_readable(&storage)?;
    drop(storage);
    assert_eq!(
        weak.strong_count(),
        1,
        "observation guard must be the only remaining metrics owner"
    );
    tx.rollback();
    assert!(
        weak.upgrade().is_none(),
        "metrics state must be released with the terminal call"
    );
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    if ctx.directory.is_some() {
        drop(ctx.reopen()?);
    }
    Ok(())
}

fn admission_case(backend: Backend, flavor: Flavor) -> TestResult {
    let (storage, _ctx) = backend.fixture()?;
    let probe = storage.clone();
    let metrics = Arc::clone(&storage.transaction_metrics);
    let owned_key = [0x81; 16];
    let keyed_probe_key = [0x82; 16];
    let governed_probe_key = [0x83; 16];
    let owned: Box<dyn Any> = match flavor {
        Flavor::Readable => Box::new(start_readable(&storage)?),
        Flavor::Keyed => Box::new(start_keyed(&storage, &owned_key)?),
        Flavor::Governed => Box::new(start_governed(&storage, &owned_key)?),
    };
    drop(storage);
    let before = metrics.snapshot();
    let short = || TransactionStartControl::new().with_timeout(SHORT);
    let cancelled = || {
        let control = control();
        control.cancel();
        control
    };
    assert!(
        matches!(
            probe
                .start_readable_transaction_with_control(&short(), Instant::now())
                .err(),
            Some(StorageTransactionStartError::TimedOut)
        ),
        "readable admission must time out while the owned transaction lives"
    );
    assert!(
        matches!(
            probe
                .start_keyed_readable_transaction_with_control(
                    &keyed_probe_key,
                    &short(),
                    Instant::now()
                )
                .err(),
            Some(StorageTransactionStartError::TimedOut)
        ),
        "keyed admission must time out while the owned transaction lives"
    );
    assert!(
        matches!(
            probe
                .start_governed_transaction_with_control(
                    &governed_probe_key,
                    &short(),
                    Instant::now()
                )
                .err(),
            Some(StorageTransactionStartError::TimedOut)
        ),
        "governed admission must time out while the owned transaction lives"
    );
    assert!(
        matches!(
            probe
                .start_readable_transaction_with_control(&cancelled(), Instant::now())
                .err(),
            Some(StorageTransactionStartError::Cancelled)
        ),
        "cancelled readable admission must report cancellation"
    );
    assert!(
        matches!(
            probe
                .start_keyed_readable_transaction_with_control(
                    &keyed_probe_key,
                    &cancelled(),
                    Instant::now()
                )
                .err(),
            Some(StorageTransactionStartError::Cancelled)
        ),
        "cancelled keyed admission must report cancellation"
    );
    assert_eq!(
        probe.lookup_transaction_outcome(&keyed_probe_key)?,
        StorageTransactionOutcome::Indeterminate,
        "failed admission must not reserve its key"
    );
    assert_eq!(
        metrics.snapshot(),
        before,
        "failed admission must not change telemetry"
    );
    drop(owned);
    let readable = start_readable(&probe)?;
    readable.rollback();
    let keyed = start_keyed(&probe, &keyed_probe_key)?;
    keyed.rollback()?;
    assert_eq!(
        probe.lookup_transaction_outcome(&keyed_probe_key)?,
        StorageTransactionOutcome::RolledBack,
        "unreserved key must be usable after the owned transaction ends"
    );
    Ok(())
}

fn thread_case(backend: Backend) -> TestResult {
    let data = Data::new()?;
    let (storage, ctx) = backend.fixture()?;
    seed(&storage, &data)?;
    let readable = start_readable(&storage)?;
    let staged = data.staged.clone();
    let worker = thread::spawn(move || {
        let mut tx = readable;
        tx.insert(staged);
        tx.commit().map_err(|error| error.to_string())
    });
    worker
        .join()
        .map_err(|_| TestError::from("readable worker panicked"))??;
    let key = [0x91; 16];
    let governed = start_governed(&storage, &key)?;
    drop(storage);
    let second = Quad::new(
        node("s"),
        node("p"),
        node("second"),
        GraphName::DefaultGraph,
    );
    let staged = second.clone();
    let worker = thread::spawn(move || {
        let mut tx = governed;
        tx.insert(staged);
        tx.commit_with_receipt(&SemanticChangeSet::default(), None)
            .map(|receipt| receipt.sequence())
            .map_err(|error| error.to_string())
    });
    let sequence = worker
        .join()
        .map_err(|_| TestError::from("governed worker panicked"))??;
    assert_eq!(sequence, 1, "first governed commit must get sequence 1");
    let view = ctx.reopen()?;
    let snapshot = view.snapshot();
    assert!(
        snapshot.contains(&EncodedQuad::from(&data.staged))?,
        "readable transaction must commit on another thread"
    );
    assert!(
        snapshot.contains(&EncodedQuad::from(&second))?,
        "governed transaction must commit on another thread"
    );
    Ok(())
}

#[test]
fn readable_transactions_own_storage_across_terminal_outcomes() -> TestResult {
    for backend in BACKENDS {
        for terminal in TERMINALS {
            readable_case(backend, terminal)?;
        }
    }
    Ok(())
}

#[test]
fn keyed_transactions_own_storage_across_terminal_outcomes() -> TestResult {
    for backend in BACKENDS {
        for terminal in TERMINALS {
            outcome_case(backend, false, terminal)?;
        }
    }
    Ok(())
}

#[test]
fn governed_transactions_own_storage_across_terminal_outcomes() -> TestResult {
    for backend in BACKENDS {
        for terminal in TERMINALS {
            outcome_case(backend, true, terminal)?;
        }
    }
    Ok(())
}

#[test]
fn plain_readable_start_outlives_original_storage() -> TestResult {
    for backend in BACKENDS {
        plain_start_case(backend)?;
    }
    Ok(())
}

#[test]
fn transaction_is_the_remaining_owner_of_shared_state() -> TestResult {
    for backend in BACKENDS {
        metrics_owner_case(backend)?;
    }
    Ok(())
}

#[test]
fn admission_control_is_unchanged_after_original_storage_drops() -> TestResult {
    for backend in BACKENDS {
        for flavor in [Flavor::Readable, Flavor::Keyed, Flavor::Governed] {
            admission_case(backend, flavor)?;
        }
    }
    Ok(())
}

#[test]
fn owned_transactions_move_to_another_thread() -> TestResult {
    for backend in BACKENDS {
        thread_case(backend)?;
    }
    Ok(())
}
