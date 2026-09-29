//! Public-API tests for the bounded lease registry over real memory and disk
//! stores. No sleeps: writer probes use bounded admission timeouts and worker
//! threads are scoped.

use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::store::{
    Namespace, NamespacePrefix, OutcomeAwareTransactionalDataset, OwnedTransaction,
    OwnedTransactionalDataset, Store, TransactionKey, TransactionNonCommitReason,
    TransactionOutcome, TransactionRequest, TransactionStartControl,
};
use oxigraph_cli::lease::registry::{
    ActiveOperation, CapacityScope, CommitReport, PendingCommit, Registry, RegistryError,
    RegistryLimits, StartFailure,
};
use oxigraph_cli::lease::{
    CancelCause, CommitKey, CommitResult, ExternalOutcome, Generation, LeaseBinding, LeaseError,
    LeaseId, LeaseLimits, LeasePhase, LimitsSpec, LogicalTime, OperationEnd, Outcome, RestartClass,
    RollbackReason,
};
use std::error::Error;
use std::num::{NonZeroU64, NonZeroUsize};
use std::thread;
use std::time::Duration;

type TestError = Box<dyn Error + Send + Sync>;
type TestResult = Result<(), TestError>;

const TIMEOUT: Duration = Duration::from_secs(1);
const PROBE: Duration = Duration::from_millis(50);
const ROLLED_BACK: TransactionOutcome =
    TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack);

#[derive(Debug, PartialEq)]
enum Refusal {
    InvalidLimits,
    Capacity(CapacityScope),
    TimedOut,
    Lease(LeaseError),
    Unknown,
    OperationLimit,
    Finished,
    Other,
}

fn refusal<T>(result: Result<T, RegistryError>) -> Option<Refusal> {
    Some(match result.err()? {
        RegistryError::InvalidLimits => Refusal::InvalidLimits,
        RegistryError::Capacity(scope) => Refusal::Capacity(scope),
        RegistryError::Start(StartFailure::TimedOut) => Refusal::TimedOut,
        RegistryError::Lease(error) => Refusal::Lease(error),
        RegistryError::Unknown => Refusal::Unknown,
        RegistryError::OperationLimit => Refusal::OperationLimit,
        RegistryError::Finished => Refusal::Finished,
        _ => Refusal::Other,
    })
}

fn lease(error: LeaseError) -> Option<Refusal> {
    Some(Refusal::Lease(error))
}

fn capacity(scope: CapacityScope) -> Option<Refusal> {
    Some(Refusal::Capacity(scope))
}

fn all_are(found: &[Option<Refusal>], expected: &Option<Refusal>) -> bool {
    found.iter().all(|item| item == expected)
}

fn t(time: u64) -> LogicalTime {
    LogicalTime(time)
}

fn ck(byte: u8) -> CommitKey {
    CommitKey::new([byte; 16])
}

fn key(byte: u8) -> TransactionKey {
    TransactionKey::new([byte; 16])
}

fn node(label: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:lease-registry:{label}"))
}

fn quad(label: &str) -> Quad {
    Quad::new(node(label), node("p"), node("o"), GraphName::DefaultGraph)
}

fn named_quad(label: &str, graph: &str) -> Quad {
    Quad::new(node(label), node("p"), node("o"), node(graph))
}

fn binding(principal: &str, tenant: &str, repository: &str) -> LeaseBinding {
    LeaseBinding::new(principal, tenant, repository).expect("valid binding")
}

fn owner() -> LeaseBinding {
    binding("alice", "acme", "repo-1")
}

fn budget(value: usize) -> NonZeroUsize {
    NonZeroUsize::new(value).expect("nonzero budget")
}

fn defaults() -> RegistryLimits {
    let spec = LimitsSpec {
        idle: 10,
        absolute: 100,
        max_extension: 20,
        cancel_grace: 5,
        commit_wait: 7,
        retention: 50,
    };
    RegistryLimits {
        lease: LeaseLimits::new(spec).expect("valid lease limits"),
        max_entries: 16,
        max_global: 8,
        max_per_repository: 8,
        max_per_principal: 8,
        max_operations_per_lease: 100,
        max_start_timeout: TIMEOUT,
        max_maintenance_work: 64,
    }
}

fn registry() -> Registry {
    Registry::new(defaults()).expect("valid registry limits")
}

fn registry_with(edit: impl FnOnce(&mut RegistryLimits)) -> Registry {
    let mut limits = defaults();
    edit(&mut limits);
    Registry::new(limits).expect("valid registry limits")
}

fn writer_free(store: &Store) -> bool {
    let probe = TransactionStartControl::new().with_timeout(PROBE);
    let req = TransactionRequest::default();
    match store.start_owned_transaction_with_control(req, probe) {
        Ok(started) => started.into_transaction().rollback().is_ok(),
        Err(_) => false,
    }
}

fn hold_writer(store: &Store) -> Result<OwnedTransaction, TestError> {
    Ok(store.start_owned_transaction()?)
}

fn lookup(store: &Store, byte: u8) -> Result<TransactionOutcome, TestError> {
    Ok(store.lookup_transaction_outcome(&key(byte))?)
}

fn external(outcome: TransactionOutcome) -> ExternalOutcome {
    match outcome {
        TransactionOutcome::Committed => ExternalOutcome::Committed,
        TransactionOutcome::ProvenAbsent(_) => ExternalOutcome::ProvenAbsent,
        _ => ExternalOutcome::Indeterminate,
    }
}

fn durable(store: &Store, commit_key: CommitKey) -> Result<ExternalOutcome, TestError> {
    let key = TransactionKey::new(*commit_key.as_bytes());
    Ok(external(store.lookup_transaction_outcome(&key)?))
}

fn unwinds(work: impl FnOnce()) -> bool {
    let guarded = std::panic::AssertUnwindSafe(work);
    std::panic::catch_unwind(guarded).is_err()
}

fn quiet(registry: &Registry) {
    let snapshot = registry.snapshot();
    assert_eq!((snapshot.reserved, snapshot.pending_begins), (0, 0));
    assert_eq!((snapshot.repositories, snapshot.principals), (0, 0));
}

fn open(registry: &Registry, store: &Store, byte: u8) -> Result<LeaseId, RegistryError> {
    registry.begin(store, &owner(), ck(byte), t(0), TIMEOUT)
}

fn stage(registry: &Registry, id: LeaseId, time: u64, label: &str) -> TestResult {
    let mut operation = registry.begin_operation(&owner(), id, t(time))?;
    operation.insert(quad(label))?;
    operation.finish(t(time))?;
    Ok(())
}

fn commit(registry: &Registry, id: LeaseId, time: u64) -> Result<CommitReport, RegistryError> {
    let pending = registry.prepare_commit(&owner(), id, t(time))?;
    pending.execute(t(time))
}

fn staged_isolation_and_read_your_writes(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    assert_eq!(registry.snapshot().reserved, 1);
    assert!(!writer_free(store));
    stage(&registry, id, 1, "a")?;
    let mut operation = registry.begin_operation(&owner, id, t(2))?;
    assert!(operation.contains(&quad("a"))?);
    operation.insert(quad("b"))?;
    assert_eq!(operation.len()?, 2);
    assert!(!store.contains(&quad("a"))?);
    operation.finish(t(3))?;
    drop(operation);
    assert!(store.is_empty()?);
    let report = commit(&registry, id, 4)?;
    assert_eq!(report.native, CommitResult::Committed);
    assert_eq!(report.outcome, Outcome::Committed);
    assert!(report.recorded);
    let outcome = registry.outcome(&owner, id, t(5))?;
    assert_eq!(outcome, Some(Outcome::Committed));
    assert!(store.contains(&quad("a"))?);
    assert!(store.contains(&quad("b"))?);
    assert_eq!(lookup(store, 1)?, TransactionOutcome::Committed);
    assert!(writer_free(store));
    quiet(&registry);
    let replays = [
        refusal(registry.begin_operation(&owner, id, t(6))),
        refusal(registry.prepare_commit(&owner, id, t(6))),
        refusal(registry.rollback(&owner, id, t(6))),
    ];
    assert!(all_are(&replays, &lease(LeaseError::AlreadyTerminal)));
    Ok(())
}

fn update_mutations_named_graphs_and_namespaces(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let prefix = NamespacePrefix::new("ex".to_owned())?;
    let iri = NamedNode::new("http://example.com/ex/")?;
    let namespace = Namespace::new(prefix, iri);
    let graph = NamedOrBlankNode::from(node("g"));
    let empty = NamedOrBlankNode::from(node("empty"));
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(named_quad("x", "g"))?;
    operation.insert(quad("d"))?;
    operation.insert_named_graph(empty.clone())?;
    operation.set_namespace(namespace.clone())?;
    let quads = operation.quads_for_pattern(None, None, None, None)?;
    assert_eq!(quads.count(), 2);
    assert_eq!(operation.named_graphs()?.count(), 2);
    assert_eq!(operation.namespaces()?.count(), 1);
    operation.remove(&quad("d"))?;
    assert_eq!(operation.len()?, 1);
    operation.clear_graph(&GraphName::from(node("g")))?;
    assert_eq!(operation.len()?, 0);
    assert!(operation.contains_named_graph(&graph)?);
    let staged = operation.namespace(namespace.prefix())?;
    assert_eq!(staged, Some(namespace.clone()));
    assert!(store.namespace(namespace.prefix())?.is_none());
    assert!(!store.contains_named_graph(&empty)?);
    operation.finish(t(2))?;
    drop(operation);
    commit(&registry, id, 3)?;
    assert!(store.is_empty()?);
    assert!(store.contains_named_graph(&graph)?);
    assert!(store.contains_named_graph(&empty)?);
    let published = store.namespace(namespace.prefix())?;
    assert_eq!(published, Some(namespace));
    Ok(())
}

fn rollback_is_idempotent_then_terminal(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 2)?;
    stage(&registry, id, 1, "r")?;
    let explicit = Outcome::RolledBack(RollbackReason::Explicit);
    let first = registry.rollback(&owner, id, t(2))?;
    assert_eq!(first.outcome, explicit);
    assert!(first.ledger_marker.is_none());
    let second = registry.rollback(&owner, id, t(3))?;
    assert_eq!(second.outcome, explicit);
    assert!(second.ledger_marker.is_none());
    assert!(writer_free(store));
    assert!(store.is_empty()?);
    assert_eq!(lookup(store, 2)?, ROLLED_BACK);
    let errors = [
        refusal(registry.begin_operation(&owner, id, t(4))),
        refusal(registry.prepare_commit(&owner, id, t(4))),
    ];
    assert!(all_are(&errors, &lease(LeaseError::AlreadyTerminal)));
    quiet(&registry);
    Ok(())
}

fn writer_is_released_after_every_terminal_path(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    registry.rollback(&owner, id, t(1))?;
    assert!(writer_free(store));
    let id = open(&registry, store, 2)?;
    registry.drop_lease(&owner, id, t(1))?;
    assert!(writer_free(store));
    let id = open(&registry, store, 3)?;
    registry.request_cancel(&owner, id, t(1))?;
    assert!(writer_free(store));
    let id = open(&registry, store, 4)?;
    commit(&registry, id, 1)?;
    assert!(writer_free(store));
    open(&registry, store, 5)?;
    assert!(!writer_free(store));
    let report = registry.maintain(t(10), budget(8));
    assert_eq!(report.released, 1);
    assert!(writer_free(store));
    quiet(&registry);
    Ok(())
}

fn dropped_guard_and_unwind_leave_lease_terminal_not_busy(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let dropped = Some(Outcome::RolledBack(RollbackReason::Dropped));
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("dropped"))?;
    drop(operation);
    assert_eq!(registry.outcome(&owner, id, t(2))?, dropped);
    let error = refusal(registry.begin_operation(&owner, id, t(2)));
    assert_eq!(error, lease(LeaseError::AlreadyTerminal));
    assert!(writer_free(store));
    assert!(store.is_empty()?);
    quiet(&registry);

    let id = registry.begin(store, &owner, ck(2), t(3), TIMEOUT)?;
    assert!(unwinds(|| {
        let guard = registry.begin_operation(&owner, id, t(4));
        assert!(guard.is_err(), "injected unwind");
    }));
    assert_eq!(registry.outcome(&owner, id, t(5))?, dropped);
    let error = refusal(registry.begin_operation(&owner, id, t(5)));
    assert_eq!(error, lease(LeaseError::AlreadyTerminal));
    assert!(writer_free(store));
    quiet(&registry);
    Ok(())
}

fn concurrent_operation_gets_typed_busy(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("busy"))?;
    let five = NonZeroU64::new(5).ok_or("zero")?;
    let generation = Generation::new(1);
    let seen = thread::scope(|scope| {
        let worker = scope.spawn(|| {
            let busy = refusal(registry.begin_operation(&owner, id, t(2)));
            let rollback = refusal(registry.rollback(&owner, id, t(2)));
            let renew = refusal(registry.renew(&owner, id, t(2), generation, five));
            [busy, rollback, renew]
        });
        worker.join()
    });
    let seen = seen.map_err(|_| "scoped worker panicked")?;
    assert!(all_are(&seen, &lease(LeaseError::Busy)));
    operation.finish(t(3))?;
    drop(operation);
    let mut again = registry.begin_operation(&owner, id, t(4))?;
    assert!(again.contains(&quad("busy"))?);
    again.finish(t(5))?;
    drop(again);
    registry.rollback(&owner, id, t(6))?;
    assert!(writer_free(store));
    quiet(&registry);
    Ok(())
}

fn failed_start_and_overflow_leave_no_reservation(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let holder = hold_writer(store)?;
    let started = registry.begin(store, &owner, ck(1), t(0), PROBE);
    assert_eq!(refusal(started), Some(Refusal::TimedOut));
    quiet(&registry);
    assert_eq!(registry.snapshot().entries, 0);
    let overflow = registry.begin(store, &owner, ck(1), t(u64::MAX), PROBE);
    assert_eq!(refusal(overflow), lease(LeaseError::TimeOverflow));
    quiet(&registry);
    holder.rollback()?;
    let id = open(&registry, store, 1)?;
    registry.rollback(&owner, id, t(1))?;
    assert!(writer_free(store));
    quiet(&registry);
    Ok(())
}

fn wrong_binding_is_indistinguishable_from_unknown(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let before = registry.status(&owner, id, t(1))?;
    let strangers = [
        binding("mallory", "acme", "repo-1"),
        binding("alice", "other", "repo-1"),
        binding("alice", "acme", "repo-2"),
    ];
    let five = NonZeroU64::new(5).ok_or("zero")?;
    let generation = Generation::new(1);
    let late = t(500);
    for stranger in &strangers {
        let found = [
            refusal(registry.status(stranger, id, late)),
            refusal(registry.outcome(stranger, id, late)),
            refusal(registry.renew(stranger, id, late, generation, five)),
            refusal(registry.request_cancel(stranger, id, late)),
            refusal(registry.response_lost(stranger, id, late)),
            refusal(registry.rollback(stranger, id, late)),
            refusal(registry.drop_lease(stranger, id, late)),
            refusal(registry.begin_operation(stranger, id, late)),
            refusal(registry.prepare_commit(stranger, id, late)),
            refusal(registry.resolve(stranger, id, late)),
        ];
        assert!(all_are(&found, &Some(Refusal::Unknown)));
    }
    let missing = registry.status(&owner, LeaseId::new(9999), t(1));
    assert_eq!(refusal(missing), Some(Refusal::Unknown));
    assert_eq!(registry.status(&owner, id, t(1))?, before);
    assert!(!writer_free(store));
    registry.rollback(&owner, id, t(2))?;
    assert!(writer_free(store));
    Ok(())
}

fn capacity_is_refused_before_writer_acquisition(store: &Store) -> TestResult {
    let owner = owner();

    let registry = registry_with(|limits| limits.max_global = 1);
    let id = registry.begin(store, &owner, ck(1), t(0), PROBE)?;
    let bob = binding("bob", "acme", "repo-2");
    let refused = registry.begin(store, &bob, ck(2), t(0), PROBE);
    assert_eq!(refusal(refused), capacity(CapacityScope::Global));
    registry.rollback(&owner, id, t(1))?;
    assert!(writer_free(store));
    quiet(&registry);

    let registry = registry_with(|limits| limits.max_per_repository = 1);
    let id = registry.begin(store, &owner, ck(3), t(0), PROBE)?;
    let bob = binding("bob", "acme", "repo-1");
    let refused = registry.begin(store, &bob, ck(4), t(0), PROBE);
    assert_eq!(refusal(refused), capacity(CapacityScope::Repository));
    registry.rollback(&owner, id, t(1))?;
    assert!(writer_free(store));

    let registry = registry_with(|limits| limits.max_per_principal = 1);
    let id = registry.begin(store, &owner, ck(5), t(0), PROBE)?;
    let alice = binding("alice", "acme", "repo-2");
    let refused = registry.begin(store, &alice, ck(6), t(0), PROBE);
    assert_eq!(refusal(refused), capacity(CapacityScope::Principal));
    registry.rollback(&owner, id, t(1))?;
    assert!(writer_free(store));

    let registry = registry_with(|limits| limits.max_entries = 1);
    let id = registry.begin(store, &owner, ck(7), t(0), PROBE)?;
    registry.rollback(&owner, id, t(1))?;
    let refused = registry.begin(store, &owner, ck(8), t(1), PROBE);
    assert_eq!(refusal(refused), capacity(CapacityScope::Entries));
    assert_eq!(registry.maintain(t(60), budget(8)).removed, 1);
    let id = registry.begin(store, &owner, ck(8), t(60), PROBE)?;
    registry.rollback(&owner, id, t(61))?;
    assert!(writer_free(store));
    Ok(())
}

fn idle_expiry_via_maintain_releases_writer_and_tombstone(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    assert!(!writer_free(store));
    let report = registry.maintain(t(10), budget(8));
    assert_eq!((report.scanned, report.released), (1, 1));
    assert_eq!((report.removed, report.skipped), (0, 0));
    assert_eq!(report.marker_errors, 0);
    assert!(writer_free(store));
    quiet(&registry);
    let expired = Some(Outcome::RolledBack(RollbackReason::Expired));
    assert_eq!(registry.outcome(&owner, id, t(10))?, expired);
    let report = registry.maintain(t(60), budget(8));
    assert_eq!(report.removed, 1);
    assert_eq!(registry.snapshot().entries, 0);
    let gone = registry.status(&owner, id, t(61));
    assert_eq!(refusal(gone), Some(Refusal::Unknown));
    Ok(())
}

fn renewal_extends_the_idle_deadline(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let twenty = NonZeroU64::new(20).ok_or("zero")?;
    let first = Generation::new(1);
    let renewal = registry.renew(&owner, id, t(1), first, twenty)?;
    assert_eq!(renewal.deadline, t(21));
    assert_eq!(renewal.generation, Generation::new(2));
    let stale = registry.renew(&owner, id, t(2), first, twenty);
    assert_eq!(refusal(stale), lease(LeaseError::StaleGeneration));
    let report = registry.maintain(t(10), budget(8));
    assert_eq!((report.scanned, report.released), (1, 0));
    assert!(!writer_free(store));
    let report = registry.maintain(t(21), budget(8));
    assert_eq!(report.released, 1);
    assert!(writer_free(store));
    Ok(())
}

fn operating_expiry_late_finish_is_overdue_not_rollback(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("late"))?;
    let late = refusal(operation.finish(t(15)));
    assert_eq!(late, lease(LeaseError::AlreadyTerminal));
    let overdue = Some(Outcome::CleanupOverdue(CancelCause::Expiry));
    assert_eq!(registry.outcome(&owner, id, t(16))?, overdue);
    assert!(writer_free(store));
    assert!(store.is_empty()?);
    quiet(&registry);
    let again = refusal(operation.finish(t(17)));
    assert_eq!(again, Some(Refusal::Finished));
    let closed = refusal(operation.insert(quad("after")));
    assert_eq!(closed, Some(Refusal::Finished));
    Ok(())
}

fn operating_expiry_acknowledged_in_grace_is_proven_rollback(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("grace"))?;
    let report = operation.finish(t(12))?;
    assert_eq!(report.end, OperationEnd::CancelledAcknowledged);
    assert!(report.ledger_marker.is_none());
    let expired = Some(Outcome::RolledBack(RollbackReason::Expired));
    assert_eq!(registry.outcome(&owner, id, t(13))?, expired);
    assert!(writer_free(store));
    assert!(store.is_empty()?);
    quiet(&registry);
    Ok(())
}

fn requested_cancel_acknowledged_is_proven_rollback(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("cancelled"))?;
    let phase = registry.request_cancel(&owner, id, t(2))?;
    let LeasePhase::Cancelling { cause, .. } = phase else {
        return Err("lease is not cancelling".into());
    };
    assert_eq!(cause, CancelCause::Requested);
    assert!(!writer_free(store));
    assert_eq!(registry.snapshot().reserved, 1);
    let report = operation.finish(t(3))?;
    assert_eq!(report.end, OperationEnd::CancelledAcknowledged);
    assert!(report.ledger_marker.is_none());
    let cancelled = Some(Outcome::RolledBack(RollbackReason::Cancelled));
    assert_eq!(registry.outcome(&owner, id, t(4))?, cancelled);
    assert!(writer_free(store));
    assert!(store.is_empty()?);
    assert_eq!(lookup(store, 1)?, ROLLED_BACK);
    quiet(&registry);
    Ok(())
}

fn dropped_cancelling_guard_settles_overdue_not_rollback(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("abandoned"))?;
    registry.request_cancel(&owner, id, t(2))?;
    drop(operation);
    assert!(writer_free(store));
    assert!(store.is_empty()?);
    quiet(&registry);
    let phase = registry.status(&owner, id, t(3))?.phase;
    let LeasePhase::Cancelling { cause, .. } = phase else {
        return Err("dropped guard invented an acknowledgement".into());
    };
    assert_eq!(cause, CancelCause::Requested);
    let early = registry.outcome(&owner, id, t(6))?;
    assert_eq!(early, None);
    let overdue = Some(Outcome::CleanupOverdue(CancelCause::Requested));
    assert_eq!(registry.outcome(&owner, id, t(7))?, overdue);
    let rollback = refusal(registry.rollback(&owner, id, t(8)));
    assert_eq!(rollback, lease(LeaseError::AlreadyTerminal));
    let report = registry.maintain(t(8), budget(8));
    assert_eq!((report.released, report.marker_errors), (0, 0));
    Ok(())
}

fn maintenance_budget_bounds_scan_work(store: &Store) -> TestResult {
    let registry = registry_with(|limits| limits.max_maintenance_work = 2);
    let owner = owner();
    for byte in 1..=3 {
        let id = open(&registry, store, byte)?;
        registry.rollback(&owner, id, t(1))?;
    }
    assert_eq!(registry.snapshot().entries, 3);
    let clamped = registry.maintain(t(10), budget(100));
    assert_eq!((clamped.scanned, clamped.removed), (2, 0));
    for _ in 0..3 {
        let report = registry.maintain(t(60), NonZeroUsize::MIN);
        assert_eq!((report.scanned, report.removed), (1, 1));
    }
    let report = registry.maintain(t(60), NonZeroUsize::MIN);
    assert_eq!((report.scanned, report.removed), (0, 0));
    assert_eq!(registry.snapshot().entries, 0);
    Ok(())
}

fn operation_limit_is_enforced(store: &Store) -> TestResult {
    let registry = registry_with(|limits| limits.max_operations_per_lease = 2);
    let owner = owner();
    let id = open(&registry, store, 1)?;
    stage(&registry, id, 1, "one")?;
    stage(&registry, id, 2, "two")?;
    let third = refusal(registry.begin_operation(&owner, id, t(3)));
    assert_eq!(third, Some(Refusal::OperationLimit));
    let report = commit(&registry, id, 4)?;
    assert!(report.recorded);
    assert_eq!(store.len()?, 2);
    Ok(())
}

fn slow_commit_is_model_indeterminate_and_resolves_from_store(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    stage(&registry, id, 1, "slow")?;
    let pending = registry.prepare_commit(&owner, id, t(3))?;
    let report = pending.execute(t(10))?;
    assert_eq!(report.native, CommitResult::Committed);
    assert_eq!(report.outcome, Outcome::CommitIndeterminate);
    assert!(!report.recorded);
    let unknown = Some(Outcome::CommitIndeterminate);
    assert_eq!(registry.outcome(&owner, id, t(11))?, unknown);
    assert!(store.contains(&quad("slow"))?);
    assert_eq!(lookup(store, 1)?, TransactionOutcome::Committed);
    let resolved = registry.resolve(&owner, id, t(12))?;
    assert_eq!(resolved, Outcome::Committed);
    let again = registry.resolve(&owner, id, t(13))?;
    assert_eq!(again, Outcome::Committed);
    assert!(writer_free(store));
    quiet(&registry);
    Ok(())
}

fn response_loss_never_replays(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    stage(&registry, id, 1, "once")?;
    let pending = registry.prepare_commit(&owner, id, t(2))?;
    registry.response_lost(&owner, id, t(3))?;
    let snapshot = registry.status(&owner, id, t(3))?;
    assert!(snapshot.response_lost);
    let waiting = LeasePhase::CommitAttempted { decide_by: t(9) };
    assert_eq!(snapshot.phase, waiting);
    let retry = refusal(registry.prepare_commit(&owner, id, t(4)));
    assert_eq!(retry, lease(LeaseError::CommitAttempted));
    let report = pending.execute(t(5))?;
    assert!(report.recorded);
    assert_eq!(store.len()?, 1);
    let retry = refusal(registry.prepare_commit(&owner, id, t(6)));
    assert_eq!(retry, lease(LeaseError::AlreadyTerminal));
    assert_eq!(store.len()?, 1);
    Ok(())
}

fn dropped_pending_commit_never_claims_rollback(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    stage(&registry, id, 1, "never")?;
    let pending = registry.prepare_commit(&owner, id, t(2))?;
    drop(pending);
    assert!(writer_free(store));
    quiet(&registry);
    let snapshot = registry.status(&owner, id, t(3))?;
    let waiting = LeasePhase::CommitAttempted { decide_by: t(9) };
    assert_eq!(snapshot.phase, waiting);
    let rollback = refusal(registry.rollback(&owner, id, t(3)));
    assert_eq!(rollback, lease(LeaseError::CommitAttempted));
    let resolved = registry.resolve(&owner, id, t(10))?;
    assert_eq!(resolved, Outcome::CommitProvenAbsent);
    assert!(store.is_empty()?);
    Ok(())
}

fn foreign_store_key_cannot_resolve_lease(store: &Store, foreign: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    stage(&registry, id, 1, "home")?;
    drop(registry.prepare_commit(&owner, id, t(2))?);
    let req = TransactionRequest::default();
    let started = foreign.start_owned_transaction_with_key(req, key(1))?;
    let mut tx = started.into_transaction();
    tx.insert(quad("foreign"));
    tx.commit()?;
    assert_eq!(lookup(foreign, 1)?, TransactionOutcome::Committed);
    let resolved = registry.resolve(&owner, id, t(10))?;
    assert_eq!(resolved, Outcome::CommitProvenAbsent);
    assert!(!store.contains(&quad("home"))?);
    assert!(!store.contains(&quad("foreign"))?);
    assert!(foreign.contains(&quad("foreign"))?);
    Ok(())
}

fn swapped_operations_stay_bound_to_their_own_leases(home: &Store, away: &Store) -> TestResult {
    let owner = owner();
    let (left, right) = (registry(), registry());
    let left_id = open(&left, home, 1)?;
    let right_id = open(&right, away, 1)?;
    let mut first = left.begin_operation(&owner, left_id, t(1))?;
    let mut second = right.begin_operation(&owner, right_id, t(1))?;
    std::mem::swap(&mut first, &mut second);
    first.insert(quad("right"))?;
    second.insert(quad("left"))?;
    first.finish(t(2))?;
    second.finish(t(2))?;
    drop((first, second));
    commit(&left, left_id, 3)?;
    commit(&right, right_id, 3)?;
    assert!(home.contains(&quad("left"))?);
    assert!(!home.contains(&quad("right"))?);
    assert!(away.contains(&quad("right"))?);
    assert!(!away.contains(&quad("left"))?);
    assert!(writer_free(home) && writer_free(away));
    Ok(())
}

macro_rules! backends {
    ($($name:ident),* $(,)?) => {
        mod memory {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    super::$name(&Store::new()?)
                }
            )*
        }

        mod disk {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    let directory = tempfile::tempdir()?;
                    let store = Store::open(directory.path())?;
                    super::$name(&store)
                }
            )*
        }
    };
}

backends!(
    staged_isolation_and_read_your_writes,
    update_mutations_named_graphs_and_namespaces,
    rollback_is_idempotent_then_terminal,
    writer_is_released_after_every_terminal_path,
    dropped_guard_and_unwind_leave_lease_terminal_not_busy,
    concurrent_operation_gets_typed_busy,
    failed_start_and_overflow_leave_no_reservation,
    wrong_binding_is_indistinguishable_from_unknown,
    capacity_is_refused_before_writer_acquisition,
    idle_expiry_via_maintain_releases_writer_and_tombstone,
    renewal_extends_the_idle_deadline,
    operating_expiry_late_finish_is_overdue_not_rollback,
    operating_expiry_acknowledged_in_grace_is_proven_rollback,
    requested_cancel_acknowledged_is_proven_rollback,
    dropped_cancelling_guard_settles_overdue_not_rollback,
    maintenance_budget_bounds_scan_work,
    operation_limit_is_enforced,
    slow_commit_is_model_indeterminate_and_resolves_from_store,
    response_loss_never_replays,
    dropped_pending_commit_never_claims_rollback,
);

#[test]
fn memory_foreign_store_key_cannot_resolve_lease() -> TestResult {
    foreign_store_key_cannot_resolve_lease(&Store::new()?, &Store::new()?)
}

#[test]
fn disk_foreign_store_key_cannot_resolve_lease() -> TestResult {
    let (first, second) = (tempfile::tempdir()?, tempfile::tempdir()?);
    let home = Store::open(first.path())?;
    let away = Store::open(second.path())?;
    foreign_store_key_cannot_resolve_lease(&home, &away)
}

#[test]
fn memory_swapped_operations_stay_bound_to_their_own_leases() -> TestResult {
    swapped_operations_stay_bound_to_their_own_leases(&Store::new()?, &Store::new()?)
}

#[test]
fn disk_swapped_operations_stay_bound_to_their_own_leases() -> TestResult {
    let (first, second) = (tempfile::tempdir()?, tempfile::tempdir()?);
    let home = Store::open(first.path())?;
    let away = Store::open(second.path())?;
    swapped_operations_stay_bound_to_their_own_leases(&home, &away)
}

fn assert_send<T: Send>() {}

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn registry_types_are_thread_safe() {
    assert_send_sync::<Registry>();
    assert_send::<ActiveOperation<'static>>();
    assert_send::<PendingCommit<'static>>();
}

#[test]
fn invalid_limits_are_rejected() {
    let edits: [fn(&mut RegistryLimits); 7] = [
        |limits| limits.max_entries = 0,
        |limits| limits.max_global = 0,
        |limits| limits.max_per_repository = 0,
        |limits| limits.max_per_principal = 0,
        |limits| limits.max_operations_per_lease = 0,
        |limits| limits.max_start_timeout = Duration::ZERO,
        |limits| limits.max_maintenance_work = 0,
    ];
    for edit in edits {
        let mut limits = defaults();
        edit(&mut limits);
        let rejected = refusal(Registry::new(limits));
        assert_eq!(rejected, Some(Refusal::InvalidLimits));
    }
}

#[test]
fn disk_restart_keeps_outcomes_and_no_staged_state() -> TestResult {
    let directory = tempfile::tempdir()?;
    let owner = owner();
    let store = Store::open(directory.path())?;
    let registry = registry();
    let committed = open(&registry, &store, 1)?;
    stage(&registry, committed, 1, "kept")?;
    commit(&registry, committed, 2)?;
    let staged = registry.begin(&store, &owner, ck(2), t(3), TIMEOUT)?;
    stage(&registry, staged, 4, "gone")?;
    let records = registry.shutdown();
    drop(store);
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].id(), committed);
    assert_eq!(records[1].id(), staged);

    let reopened = Store::open(directory.path())?;
    let mut classes = Vec::new();
    for record in &records {
        let found = record.commit_key().map(|key| durable(&reopened, key));
        classes.push(record.classify(found.transpose()?)?);
    }
    let expected = vec![RestartClass::Committed, RestartClass::StagedDiscarded];
    assert_eq!(classes, expected);
    assert!(reopened.contains(&quad("kept"))?);
    assert!(!reopened.contains(&quad("gone"))?);
    let fresh = self::registry();
    let unknown = [
        refusal(fresh.status(&owner, committed, t(0))),
        refusal(fresh.status(&owner, staged, t(0))),
    ];
    assert!(all_are(&unknown, &Some(Refusal::Unknown)));
    assert!(writer_free(&reopened));
    Ok(())
}

#[test]
fn memory_outcomes_are_process_local() -> TestResult {
    let owner = owner();
    let store = Store::new()?;
    let registry = registry();
    let id = open(&registry, &store, 1)?;
    stage(&registry, id, 1, "local")?;
    commit(&registry, id, 2)?;
    let records = registry.shutdown();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].classify(None)?, RestartClass::Committed);
    let other = Store::new()?;
    assert_eq!(lookup(&other, 1)?, TransactionOutcome::Indeterminate);
    assert!(other.is_empty()?);
    let fresh = self::registry();
    let missing = refusal(fresh.status(&owner, id, t(0)));
    assert_eq!(missing, Some(Refusal::Unknown));
    Ok(())
}
