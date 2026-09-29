//! Bounded in-process registry of leased native transactions (ADR-0030).
//!
//! The caller passes an already-authorized [`LeaseBinding`] and an explicit
//! transaction key on every call. Lease identifiers are non-secret counters,
//! never remote credentials. There is no token, thread, clock or background
//! reaper: maintenance is an explicit bounded call. The registry lock is never
//! held across a native call and no user code runs under it. Native handles are
//! owned safely and never lent out: a running operation forwards only staged
//! reads, mutations and prepared queries (whose results borrow the operation),
//! so no caller can extract, replace or commit the leased handle outside the
//! registry. Each entry retains a clone of the [`Store`] it
//! began on, so outcome lookup never consults another store. A leaked guard
//! keeps its entry charged until the process ends.

use super::{
    Call, CommitAttempt, CommitKey, CommitResult, ExternalOutcome, Generation, Lease, LeaseBinding,
    LeaseError, LeaseId, LeaseLimits, LeasePhase, LeaseSnapshot, LogicalTime, OperationEnd,
    OperationHandle, Outcome, Renewal, RestartRecord, RollbackReason,
};
use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{PreparedSparqlQuery, QueryEvaluationError, QueryResults};
use oxigraph::store::{
    GraphNameIter, KeyedTransaction, Namespace, NamespaceIter, NamespacePrefix,
    OutcomeAwareTransactionalDataset, QuadIter, StorageError, Store, TransactionCommitError,
    TransactionKey, TransactionOutcome, TransactionRequest, TransactionRollbackError,
    TransactionStartControl, TransactionStartError,
};
use std::collections::BTreeMap;
use std::fmt;
use std::mem;
use std::num::{NonZeroU64, NonZeroUsize};
use std::ops::Bound;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

type Key = (String, String);

fn repository_key(binding: &LeaseBinding) -> Key {
    (binding.tenant().to_owned(), binding.repository().to_owned())
}

fn principal_key(binding: &LeaseBinding) -> Key {
    (binding.tenant().to_owned(), binding.principal().to_owned())
}

fn call(binding: &LeaseBinding, at: LogicalTime) -> Call<'_> {
    Call { binding, at }
}

/// Finite limits. Every value must be nonzero.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RegistryLimits {
    pub lease: LeaseLimits,
    /// Active plus terminal entries, including begins in flight.
    pub max_entries: usize,
    /// Entries whose native writer handle is held or still being released.
    pub max_global: usize,
    pub max_per_repository: usize,
    pub max_per_principal: usize,
    pub max_operations_per_lease: u64,
    pub max_start_timeout: Duration,
    /// Upper bound on entries examined by one maintenance call.
    pub max_maintenance_work: usize,
}

impl RegistryLimits {
    fn is_valid(&self) -> bool {
        self.max_entries > 0
            && self.max_global > 0
            && self.max_per_repository > 0
            && self.max_per_principal > 0
            && self.max_operations_per_lease > 0
            && !self.max_start_timeout.is_zero()
            && self.max_maintenance_work > 0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapacityScope {
    Entries,
    Global,
    Repository,
    Principal,
}

#[derive(Debug)]
pub enum StartFailure {
    Requirements,
    Cancelled,
    TimedOut,
    Backend(StorageError),
}

#[derive(Debug)]
pub enum RegistryError {
    InvalidLimits,
    Capacity(CapacityScope),
    /// Unknown id and any binding mismatch are indistinguishable.
    Unknown,
    Lease(LeaseError),
    OperationLimit,
    Start(StartFailure),
    Lookup(StorageError),
    /// A staged read or mutation of the running operation failed.
    Storage(StorageError),
    /// A prepared query failed to open. The operation and lease are unchanged;
    /// no rollback or commit is implied.
    Query(QueryEvaluationError),
    Finished,
    CounterExhausted,
    Internal,
}

impl fmt::Display for RegistryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidLimits => f.write_str("invalid registry limits"),
            Self::Capacity(scope) => write!(f, "registry capacity exhausted: {scope:?}"),
            Self::Unknown => f.write_str("unknown lease"),
            Self::Lease(error) => write!(f, "{error}"),
            Self::OperationLimit => f.write_str("lease operation limit reached"),
            Self::Start(failure) => write!(f, "transaction start failed: {failure:?}"),
            Self::Lookup(error) => write!(f, "outcome lookup failed: {error}"),
            Self::Storage(error) => write!(f, "staged operation failed: {error}"),
            Self::Query(error) => write!(f, "staged query failed: {error}"),
            Self::Finished => f.write_str("operation already finished"),
            Self::CounterExhausted => f.write_str("lease id counter exhausted"),
            Self::Internal => f.write_str("registry invariant violated"),
        }
    }
}

impl std::error::Error for RegistryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Lease(error) => Some(error),
            Self::Lookup(error)
            | Self::Storage(error)
            | Self::Start(StartFailure::Backend(error)) => Some(error),
            Self::Query(error) => Some(error),
            _ => None,
        }
    }
}

impl From<StorageError> for RegistryError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

#[derive(Debug)]
pub struct FinishReport {
    pub end: OperationEnd,
    /// Native rollback-marker failure. The model outcome is not changed by it.
    pub ledger_marker: Option<StorageError>,
}

#[derive(Debug)]
pub struct RollbackReport {
    pub outcome: Outcome,
    pub ledger_marker: Option<StorageError>,
}

/// `native` is what the single native commit returned. `outcome` is what the
/// model holds afterwards; `recorded` is false when the report was late and
/// the model had already become indeterminate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CommitReport {
    pub native: CommitResult,
    pub outcome: Outcome,
    pub recorded: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MaintenanceReport {
    pub scanned: usize,
    pub released: usize,
    pub removed: usize,
    pub skipped: usize,
    pub marker_errors: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RegistrySnapshot {
    pub entries: usize,
    pub reserved: usize,
    pub pending_begins: usize,
    pub repositories: usize,
    pub principals: usize,
}

enum Slot {
    Held(KeyedTransaction<'static>),
    Away,
    Empty,
}

struct Entry {
    lease: Lease,
    key: CommitKey,
    /// The store this lease began on. Outcome lookup never uses another one.
    store: Store,
    slot: Slot,
    charged: bool,
    repository: Key,
    principal: Key,
}

#[derive(Default)]
struct Counts {
    global: usize,
    pending: usize,
    repositories: BTreeMap<Key, usize>,
    principals: BTreeMap<Key, usize>,
}

fn decrement(map: &mut BTreeMap<Key, usize>, key: &Key) {
    let remove = match map.get_mut(key) {
        Some(count) => {
            *count = count.saturating_sub(1);
            *count == 0
        }
        None => false,
    };
    if remove {
        map.remove(key);
    }
}

impl Counts {
    fn release(&mut self, repository: &Key, principal: &Key) {
        self.global = self.global.saturating_sub(1);
        decrement(&mut self.repositories, repository);
        decrement(&mut self.principals, principal);
    }
}

struct Inner {
    entries: BTreeMap<u64, Entry>,
    counts: Counts,
    next_id: u64,
    cursor: u64,
}

impl Inner {
    /// Marks the native handle as gone and gives back its capacity charge.
    fn uncharge(&mut self, id: u64) {
        let Self {
            entries, counts, ..
        } = self;
        if let Some(entry) = entries.get_mut(&id) {
            entry.slot = Slot::Empty;
            if entry.charged {
                entry.charged = false;
                counts.release(&entry.repository, &entry.principal);
            }
        }
    }
}

struct Reaped {
    id: u64,
    tx: KeyedTransaction<'static>,
    rollback: bool,
}

/// Takes a held native handle out of a terminal entry. Its capacity stays
/// charged until the caller has released the handle natively.
fn take_reap(id: u64, entry: &mut Entry) -> Option<Reaped> {
    let rollback = match entry.lease.snapshot().phase {
        LeasePhase::Terminal {
            outcome: Outcome::RolledBack(reason),
            ..
        } => reason != RollbackReason::Dropped,
        LeasePhase::Terminal { .. } => false,
        LeasePhase::Expired { attempted } => !attempted,
        LeasePhase::Idle
        | LeasePhase::Operating
        | LeasePhase::Cancelling { .. }
        | LeasePhase::CommitAttempted { .. } => return None,
    };
    match mem::replace(&mut entry.slot, Slot::Away) {
        Slot::Held(tx) => Some(Reaped { id, tx, rollback }),
        other => {
            entry.slot = other;
            None
        }
    }
}

fn rollback_marker(tx: KeyedTransaction<'static>) -> Option<StorageError> {
    match tx.rollback() {
        Ok(()) => None,
        Err(TransactionRollbackError::Failed(error)) => Some(error),
    }
}

fn lookup<'a>(
    inner: &'a mut Inner,
    binding: &LeaseBinding,
    id: LeaseId,
) -> Result<&'a mut Entry, RegistryError> {
    let entry = inner
        .entries
        .get_mut(&id.get())
        .ok_or(RegistryError::Unknown)?;
    if entry.lease.binding() != binding {
        return Err(RegistryError::Unknown);
    }
    Ok(entry)
}

fn start_failure(error: TransactionStartError<StorageError>) -> RegistryError {
    RegistryError::Start(match error {
        TransactionStartError::RequirementsNotMet { .. } => StartFailure::Requirements,
        TransactionStartError::Cancelled => StartFailure::Cancelled,
        TransactionStartError::TimedOut => StartFailure::TimedOut,
        TransactionStartError::Backend(error) => StartFailure::Backend(error),
    })
}

fn start_operation(
    entry: &mut Entry,
    at: Call<'_>,
    max_operations: u64,
) -> Result<(OperationHandle, KeyedTransaction<'static>), RegistryError> {
    let snapshot = entry.lease.observe(at).map_err(RegistryError::Lease)?;
    if snapshot.phase == LeasePhase::Idle && snapshot.operation_count >= max_operations {
        return Err(RegistryError::OperationLimit);
    }
    let handle = entry
        .lease
        .begin_operation(at)
        .map_err(RegistryError::Lease)?;
    match mem::replace(&mut entry.slot, Slot::Away) {
        Slot::Held(tx) => Ok((handle, tx)),
        other => {
            entry.slot = other;
            let _undone = entry.lease.finish_operation(at, &handle);
            Err(RegistryError::Internal)
        }
    }
}

fn start_commit(
    entry: &mut Entry,
    at: Call<'_>,
) -> Result<(CommitAttempt, KeyedTransaction<'static>), RegistryError> {
    let attempt = entry
        .lease
        .begin_commit(at, entry.key)
        .map_err(RegistryError::Lease)?;
    match mem::replace(&mut entry.slot, Slot::Away) {
        Slot::Held(tx) => Ok((attempt, tx)),
        other => {
            entry.slot = other;
            Err(RegistryError::Internal)
        }
    }
}

/// Capacity taken before writer acquisition. Dropping it releases every count
/// unless the entry was inserted, so failure and unwind cannot leak capacity.
struct Reservation<'r> {
    registry: &'r Registry,
    repository: Key,
    principal: Key,
    armed: bool,
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let mut inner = self.registry.lock();
        let counts = &mut inner.counts;
        counts.pending = counts.pending.saturating_sub(1);
        counts.release(&self.repository, &self.principal);
    }
}

/// Bounded registry of leases over native owned keyed transactions.
pub struct Registry {
    limits: RegistryLimits,
    inner: Mutex<Inner>,
}

impl Registry {
    /// A fresh registry holds no staged state.
    pub fn new(limits: RegistryLimits) -> Result<Self, RegistryError> {
        if !limits.is_valid() {
            return Err(RegistryError::InvalidLimits);
        }
        Ok(Self {
            limits,
            inner: Mutex::new(Inner {
                entries: BTreeMap::new(),
                counts: Counts::default(),
                next_id: 1,
                cursor: 0,
            }),
        })
    }

    /// Only bookkeeping runs under this lock, so a poisoned lock is recovered.
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn snapshot(&self) -> RegistrySnapshot {
        let inner = self.lock();
        RegistrySnapshot {
            entries: inner.entries.len(),
            reserved: inner.counts.global,
            pending_begins: inner.counts.pending,
            repositories: inner.counts.repositories.len(),
            principals: inner.counts.principals.len(),
        }
    }

    /// Checks and reserves capacity, builds the model lease so time overflow
    /// fails before any writer wait, then waits for the native writer for at
    /// most `start_timeout` (clamped to the registry maximum) without the lock.
    /// The entry retains a clone of `store` for its own outcome lookup.
    pub fn begin(
        &self,
        store: &Store,
        binding: &LeaseBinding,
        key: CommitKey,
        at: LogicalTime,
        start_timeout: Duration,
    ) -> Result<LeaseId, RegistryError> {
        let repository = repository_key(binding);
        let principal = principal_key(binding);
        let id = {
            let mut inner = self.lock();
            let limits = &self.limits;
            let entries = inner.entries.len() + inner.counts.pending;
            let global = inner.counts.global;
            let in_repository = inner.counts.repositories.get(&repository);
            let in_repository = in_repository.copied().unwrap_or(0);
            let of_principal = inner.counts.principals.get(&principal);
            let of_principal = of_principal.copied().unwrap_or(0);
            if entries >= limits.max_entries {
                return Err(RegistryError::Capacity(CapacityScope::Entries));
            }
            if global >= limits.max_global {
                return Err(RegistryError::Capacity(CapacityScope::Global));
            }
            if in_repository >= limits.max_per_repository {
                return Err(RegistryError::Capacity(CapacityScope::Repository));
            }
            if of_principal >= limits.max_per_principal {
                return Err(RegistryError::Capacity(CapacityScope::Principal));
            }
            let id = inner.next_id;
            let next = id.checked_add(1).ok_or(RegistryError::CounterExhausted)?;
            inner.next_id = next;
            let counts = &mut inner.counts;
            counts.global += 1;
            counts.pending += 1;
            *counts.repositories.entry(repository.clone()).or_insert(0) += 1;
            *counts.principals.entry(principal.clone()).or_insert(0) += 1;
            id
        };
        let mut reservation = Reservation {
            registry: self,
            repository: repository.clone(),
            principal: principal.clone(),
            armed: true,
        };
        let lease = Lease::begin(call(binding, at), LeaseId::new(id), self.limits.lease)
            .map_err(RegistryError::Lease)?;
        let timeout = start_timeout.min(self.limits.max_start_timeout);
        let control = TransactionStartControl::new().with_timeout(timeout);
        let started = store
            .start_owned_transaction_with_key_and_control(
                TransactionRequest::default(),
                TransactionKey::new(*key.as_bytes()),
                control,
            )
            .map_err(start_failure)?;
        let mut inner = self.lock();
        reservation.armed = false;
        let counts = &mut inner.counts;
        counts.pending = counts.pending.saturating_sub(1);
        inner.entries.insert(
            id,
            Entry {
                lease,
                key,
                store: store.clone(),
                slot: Slot::Held(started.into_transaction()),
                charged: true,
                repository,
                principal,
            },
        );
        Ok(LeaseId::new(id))
    }

    /// Native release outside the lock, then the capacity charge is returned.
    fn release(&self, reaped: Reaped) -> Option<StorageError> {
        let Reaped { id, tx, rollback } = reaped;
        let marker = if rollback {
            rollback_marker(tx)
        } else {
            drop(tx);
            None
        };
        self.lock().uncharge(id);
        marker
    }

    /// One model call. Any terminal transition it causes releases the native
    /// handle outside the lock before returning.
    fn with_lease<T>(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        operation: impl FnOnce(&mut Lease) -> Result<T, LeaseError>,
    ) -> Result<(T, Option<StorageError>), RegistryError> {
        let (result, reaped) = {
            let mut inner = self.lock();
            let entry = lookup(&mut inner, binding, id)?;
            let result = operation(&mut entry.lease);
            let reaped = take_reap(id.get(), entry);
            (result, reaped)
        };
        let marker = reaped.and_then(|reaped| self.release(reaped));
        match result {
            Ok(value) => Ok((value, marker)),
            Err(error) => Err(RegistryError::Lease(error)),
        }
    }

    pub fn status(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<LeaseSnapshot, RegistryError> {
        let observe = |lease: &mut Lease| lease.observe(call(binding, at));
        let (snapshot, _) = self.with_lease(binding, id, observe)?;
        Ok(snapshot)
    }

    /// The terminal outcome, or `None` while the lease is still live.
    pub fn outcome(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<Option<Outcome>, RegistryError> {
        match self.status(binding, id, at)?.phase {
            LeasePhase::Terminal { outcome, .. } => Ok(Some(outcome)),
            LeasePhase::Expired { .. } => Err(RegistryError::Lease(LeaseError::Expired)),
            _ => Ok(None),
        }
    }

    pub fn renew(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
        expected: Generation,
        requested: NonZeroU64,
    ) -> Result<Renewal, RegistryError> {
        let renew = |lease: &mut Lease| lease.renew(call(binding, at), expected, requested);
        let (renewal, _) = self.with_lease(binding, id, renew)?;
        Ok(renewal)
    }

    pub fn request_cancel(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<LeasePhase, RegistryError> {
        let cancel = |lease: &mut Lease| lease.request_cancel(call(binding, at));
        let (phase, _) = self.with_lease(binding, id, cancel)?;
        Ok(phase)
    }

    /// Records a lost response. Never replays anything.
    pub fn response_lost(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<(), RegistryError> {
        let lost = |lease: &mut Lease| lease.response_lost(call(binding, at));
        self.with_lease(binding, id, lost)?;
        Ok(())
    }

    /// Explicit rollback: model first, then a typed native rollback.
    pub fn rollback(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<RollbackReport, RegistryError> {
        let rollback = |lease: &mut Lease| lease.rollback(call(binding, at));
        let (outcome, ledger_marker) = self.with_lease(binding, id, rollback)?;
        Ok(RollbackReport {
            outcome,
            ledger_marker,
        })
    }

    /// Drop-equivalent: model first, then the native handle is dropped.
    pub fn drop_lease(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<RollbackReport, RegistryError> {
        let dropped = |lease: &mut Lease| lease.dropped(call(binding, at));
        let (outcome, ledger_marker) = self.with_lease(binding, id, dropped)?;
        Ok(RollbackReport {
            outcome,
            ledger_marker,
        })
    }

    /// Resolves an indeterminate commit by the durable keyed lookup of the
    /// store this lease began on. No caller-supplied store is ever consulted.
    pub fn resolve(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<Outcome, RegistryError> {
        let snapshot = self.status(binding, id, at)?;
        let key = snapshot
            .commit_key
            .ok_or(RegistryError::Lease(LeaseError::NotIndeterminate))?;
        let store = {
            let mut inner = self.lock();
            lookup(&mut inner, binding, id)?.store.clone()
        };
        let key = TransactionKey::new(*key.as_bytes());
        let found = store
            .lookup_transaction_outcome(&key)
            .map_err(RegistryError::Lookup)?;
        let external = match found {
            TransactionOutcome::Committed => ExternalOutcome::Committed,
            TransactionOutcome::ProvenAbsent(_) => ExternalOutcome::ProvenAbsent,
            _ => ExternalOutcome::Indeterminate,
        };
        let resolve = |lease: &mut Lease| lease.resolve_indeterminate(call(binding, at), external);
        let (outcome, _) = self.with_lease(binding, id, resolve)?;
        Ok(outcome)
    }

    /// Starts the single active operation. A concurrent one gets typed `Busy`.
    pub fn begin_operation(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<ActiveOperation<'_>, RegistryError> {
        let maximum = self.limits.max_operations_per_lease;
        let (started, reaped) = {
            let mut inner = self.lock();
            let entry = lookup(&mut inner, binding, id)?;
            let started = start_operation(entry, call(binding, at), maximum);
            let reaped = take_reap(id.get(), entry);
            (started, reaped)
        };
        if let Some(reaped) = reaped {
            let _marker = self.release(reaped);
        }
        let (handle, tx) = started?;
        Ok(ActiveOperation {
            registry: self,
            id,
            binding: binding.clone(),
            handle: Some(handle),
            tx: Some(tx),
            done: false,
        })
    }

    /// Records the single commit attempt. The native commit runs at most once,
    /// in [`PendingCommit::execute`].
    pub fn prepare_commit(
        &self,
        binding: &LeaseBinding,
        id: LeaseId,
        at: LogicalTime,
    ) -> Result<PendingCommit<'_>, RegistryError> {
        let (started, reaped) = {
            let mut inner = self.lock();
            let entry = lookup(&mut inner, binding, id)?;
            let started = start_commit(entry, call(binding, at));
            let reaped = take_reap(id.get(), entry);
            (started, reaped)
        };
        if let Some(reaped) = reaped {
            let _marker = self.release(reaped);
        }
        let (attempt, tx) = started?;
        Ok(PendingCommit {
            registry: self,
            id,
            binding: binding.clone(),
            attempt,
            tx: Some(tx),
            done: false,
        })
    }

    /// Explicit bounded maintenance: settles due transitions, releases native
    /// handles of terminal leases, and removes expired tombstones. Examines at
    /// most `min(budget, max_maintenance_work)` entries, resuming after the
    /// entry where the previous call stopped.
    pub fn maintain(&self, at: LogicalTime, budget: NonZeroUsize) -> MaintenanceReport {
        let limit = budget.get().min(self.limits.max_maintenance_work);
        let mut report = MaintenanceReport::default();
        let mut reaped = Vec::new();
        {
            let mut guard = self.lock();
            let inner: &mut Inner = &mut guard;
            let cursor = inner.cursor;
            let range = (Bound::Excluded(cursor), Bound::Unbounded);
            let after = inner.entries.range(range);
            let before = inner.entries.range(..=cursor);
            let mut ids = Vec::new();
            for (id, _) in after.chain(before).take(limit) {
                ids.push(*id);
            }
            let mut expired = Vec::new();
            for id in &ids {
                let Some(entry) = inner.entries.get_mut(id) else {
                    continue;
                };
                report.scanned += 1;
                let binding = entry.lease.binding().clone();
                match entry.lease.observe(call(&binding, at)) {
                    Err(_) => report.skipped += 1,
                    Ok(snapshot) => {
                        if let Some(found) = take_reap(*id, entry) {
                            reaped.push(found);
                            report.released += 1;
                        } else if matches!(snapshot.phase, LeasePhase::Expired { .. })
                            && matches!(entry.slot, Slot::Empty)
                        {
                            expired.push(*id);
                        }
                    }
                }
            }
            if let Some(last) = ids.last() {
                inner.cursor = *last;
            }
            for id in expired {
                inner.entries.remove(&id);
                report.removed += 1;
            }
        }
        for found in reaped {
            if self.release(found).is_some() {
                report.marker_errors += 1;
            }
        }
        report
    }

    /// Consumes the registry at process shutdown. Every native handle and
    /// retained store clone is dropped and no staged state survives; only
    /// restart records remain.
    pub fn shutdown(self) -> Vec<RestartRecord> {
        let inner = self
            .inner
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner);
        inner
            .entries
            .into_values()
            .map(|entry| {
                let Entry { lease, slot, .. } = entry;
                drop(slot);
                lease.restart()
            })
            .collect()
    }
}

/// The one running operation of a lease. It owns the native handle while it
/// runs and never lends it out: it forwards only staged reads, mutations and
/// prepared queries, so the handle cannot be extracted, replaced or committed
/// outside the registry. Swapping two operations swaps them whole, each still
/// bound to its own lease. Dropping it without finishing never invents an
/// acknowledged cancellation: a running operation ends as a dropped rollback,
/// a cancelling one is left for the model to settle as overdue.
///
/// No accessor exposes the native transaction:
/// ```compile_fail,E0599
/// fn extract(operation: &mut oxigraph_cli::lease::registry::ActiveOperation<'_>) {
///     let _handle = operation.transaction();
/// }
/// ```
#[must_use]
pub struct ActiveOperation<'r> {
    registry: &'r Registry,
    id: LeaseId,
    binding: LeaseBinding,
    handle: Option<OperationHandle>,
    tx: Option<KeyedTransaction<'static>>,
    done: bool,
}

impl ActiveOperation<'_> {
    pub const fn lease_id(&self) -> LeaseId {
        self.id
    }

    fn staged(&self) -> Result<&KeyedTransaction<'static>, RegistryError> {
        self.tx.as_ref().ok_or(RegistryError::Finished)
    }

    fn staged_mut(&mut self) -> Result<&mut KeyedTransaction<'static>, RegistryError> {
        self.tx.as_mut().ok_or(RegistryError::Finished)
    }

    /// Evaluates an already prepared query over this operation's staged view,
    /// including its own writes. Results stream lazily and borrow the
    /// operation, so it cannot be mutated, finished or dropped while they are
    /// alive. The prepared evaluator keeps its cancellation, resource, `SERVICE`
    /// and egress policy. Failure changes no lease or transaction state and
    /// claims neither rollback nor commit; a lazily raised evaluation error is
    /// an item of the result stream. After `finish` this returns `Finished`.
    ///
    /// ```
    /// use oxigraph::model::{GraphName, NamedNode, Quad};
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    /// use oxigraph_cli::lease::registry::{Registry, RegistryLimits};
    /// use oxigraph_cli::lease::{CommitKey, LeaseBinding, LeaseLimits, LimitsSpec, LogicalTime};
    /// use std::time::Duration;
    ///
    /// let spec = LimitsSpec {
    ///     idle: 10,
    ///     absolute: 100,
    ///     max_extension: 20,
    ///     cancel_grace: 5,
    ///     commit_wait: 7,
    ///     retention: 50,
    /// };
    /// let limits = RegistryLimits {
    ///     lease: LeaseLimits::new(spec)?,
    ///     max_entries: 4,
    ///     max_global: 4,
    ///     max_per_repository: 4,
    ///     max_per_principal: 4,
    ///     max_operations_per_lease: 4,
    ///     max_start_timeout: Duration::from_secs(1),
    ///     max_maintenance_work: 4,
    /// };
    /// let store = Store::new()?;
    /// let registry = Registry::new(limits)?;
    /// let binding = LeaseBinding::new("alice", "acme", "repo")?;
    /// let id = registry.begin(
    ///     &store,
    ///     &binding,
    ///     CommitKey::new([1; 16]),
    ///     LogicalTime(0),
    ///     Duration::from_secs(1),
    /// )?;
    /// let mut operation = registry.begin_operation(&binding, id, LogicalTime(1))?;
    /// let ex = NamedNode::new("http://example.com")?;
    /// operation.insert(Quad::new(
    ///     ex.clone(),
    ///     ex.clone(),
    ///     ex,
    ///     GraphName::DefaultGraph,
    /// ))?;
    /// let prepared = SparqlEvaluator::new()
    ///     .with_deny_all_egress_policy()
    ///     .parse_query("SELECT ?s WHERE { ?s ?p ?o }")?;
    /// if let QueryResults::Solutions(solutions) = operation.query(prepared)? {
    ///     assert_eq!(solutions.count(), 1);
    /// }
    /// assert!(store.is_empty()?);
    /// operation.finish(LogicalTime(2))?;
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    ///
    /// Results borrow the operation, so it cannot finish while they are alive:
    /// ```compile_fail,E0502
    /// use oxigraph::sparql::SparqlEvaluator;
    /// use oxigraph::store::Store;
    /// use oxigraph_cli::lease::registry::{Registry, RegistryLimits};
    /// use oxigraph_cli::lease::{CommitKey, LeaseBinding, LeaseLimits, LimitsSpec, LogicalTime};
    /// use std::time::Duration;
    ///
    /// let spec = LimitsSpec {
    ///     idle: 10,
    ///     absolute: 100,
    ///     max_extension: 20,
    ///     cancel_grace: 5,
    ///     commit_wait: 7,
    ///     retention: 50,
    /// };
    /// let limits = RegistryLimits {
    ///     lease: LeaseLimits::new(spec)?,
    ///     max_entries: 4,
    ///     max_global: 4,
    ///     max_per_repository: 4,
    ///     max_per_principal: 4,
    ///     max_operations_per_lease: 4,
    ///     max_start_timeout: Duration::from_secs(1),
    ///     max_maintenance_work: 4,
    /// };
    /// let store = Store::new()?;
    /// let registry = Registry::new(limits)?;
    /// let binding = LeaseBinding::new("alice", "acme", "repo")?;
    /// let id = registry.begin(
    ///     &store,
    ///     &binding,
    ///     CommitKey::new([1; 16]),
    ///     LogicalTime(0),
    ///     Duration::from_secs(1),
    /// )?;
    /// let mut operation = registry.begin_operation(&binding, id, LogicalTime(1))?;
    /// let prepared = SparqlEvaluator::new().parse_query("SELECT * WHERE { ?s ?p ?o }")?;
    /// let results = operation.query(prepared)?;
    /// operation.finish(LogicalTime(2))?;
    /// drop(results);
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    pub fn query(&self, prepared: PreparedSparqlQuery) -> Result<QueryResults<'_>, RegistryError> {
        let tx = self.staged()?;
        prepared
            .on_writable_dataset(tx)
            .execute()
            .map_err(RegistryError::Query)
    }

    /// Staged quads matching a pattern, including this lease's own writes.
    pub fn quads_for_pattern(
        &self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph: Option<&GraphName>,
    ) -> Result<QuadIter<'_>, RegistryError> {
        let tx = self.staged()?;
        Ok(tx.quads_for_pattern(subject, predicate, object, graph))
    }

    pub fn contains(&self, quad: &Quad) -> Result<bool, RegistryError> {
        Ok(self.staged()?.contains(quad)?)
    }

    pub fn len(&self) -> Result<usize, RegistryError> {
        Ok(self.staged()?.len()?)
    }

    pub fn is_empty(&self) -> Result<bool, RegistryError> {
        Ok(self.staged()?.is_empty()?)
    }

    pub fn named_graphs(&self) -> Result<GraphNameIter<'_>, RegistryError> {
        Ok(self.staged()?.named_graphs())
    }

    pub fn contains_named_graph(&self, graph: &NamedOrBlankNode) -> Result<bool, RegistryError> {
        Ok(self.staged()?.contains_named_graph(graph)?)
    }

    pub fn namespaces(&self) -> Result<NamespaceIter, RegistryError> {
        Ok(self.staged()?.namespaces())
    }

    pub fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, RegistryError> {
        Ok(self.staged()?.namespace(prefix)?)
    }

    pub fn insert(&mut self, quad: Quad) -> Result<(), RegistryError> {
        self.staged_mut()?.insert(quad);
        Ok(())
    }

    pub fn extend(&mut self, quads: impl IntoIterator<Item = Quad>) -> Result<(), RegistryError> {
        self.staged_mut()?.extend(quads);
        Ok(())
    }

    pub fn remove(&mut self, quad: &Quad) -> Result<(), RegistryError> {
        self.staged_mut()?.remove(quad);
        Ok(())
    }

    pub fn insert_named_graph(&mut self, graph: NamedOrBlankNode) -> Result<(), RegistryError> {
        self.staged_mut()?.insert_named_graph(graph);
        Ok(())
    }

    pub fn clear_graph(&mut self, graph: &GraphName) -> Result<(), RegistryError> {
        Ok(self.staged_mut()?.clear_graph(graph)?)
    }

    pub fn remove_named_graph(&mut self, graph: &NamedOrBlankNode) -> Result<(), RegistryError> {
        Ok(self.staged_mut()?.remove_named_graph(graph)?)
    }

    pub fn clear(&mut self) -> Result<(), RegistryError> {
        Ok(self.staged_mut()?.clear()?)
    }

    pub fn set_namespace(&mut self, namespace: Namespace) -> Result<(), RegistryError> {
        Ok(self.staged_mut()?.set_namespace(namespace)?)
    }

    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), RegistryError> {
        Ok(self.staged_mut()?.remove_namespace(prefix)?)
    }

    pub fn clear_namespaces(&mut self) -> Result<(), RegistryError> {
        Ok(self.staged_mut()?.clear_namespaces()?)
    }

    /// Completes the operation or acknowledges cancellation. Rejections that
    /// change nothing (time regression, binding mismatch, stale handle) keep
    /// the operation usable for a retry.
    pub fn finish(&mut self, at: LogicalTime) -> Result<FinishReport, RegistryError> {
        if self.done {
            return Err(RegistryError::Finished);
        }
        let Some(handle) = self.handle.as_ref() else {
            return Err(RegistryError::Finished);
        };
        let now = call(&self.binding, at);
        let mut inner = self.registry.lock();
        let Some(entry) = inner.entries.get_mut(&self.id.get()) else {
            return Err(RegistryError::Unknown);
        };
        let result = entry.lease.finish_operation(now, handle);
        match result {
            Ok(OperationEnd::Completed) => {
                let Some(tx) = self.tx.take() else {
                    return Err(RegistryError::Internal);
                };
                entry.slot = Slot::Held(tx);
                self.done = true;
                self.handle = None;
                Ok(FinishReport {
                    end: OperationEnd::Completed,
                    ledger_marker: None,
                })
            }
            Ok(OperationEnd::CancelledAcknowledged) => {
                drop(inner);
                let ledger_marker = self.retire(true);
                Ok(FinishReport {
                    end: OperationEnd::CancelledAcknowledged,
                    ledger_marker,
                })
            }
            Err(error @ (LeaseError::AlreadyTerminal | LeaseError::Expired)) => {
                drop(inner);
                self.retire(false);
                Err(RegistryError::Lease(error))
            }
            Err(error) => Err(RegistryError::Lease(error)),
        }
    }

    /// Releases the native handle (typed rollback or plain drop) and returns
    /// its capacity charge only afterwards.
    fn retire(&mut self, rollback: bool) -> Option<StorageError> {
        let marker = match self.tx.take() {
            Some(tx) if rollback => rollback_marker(tx),
            Some(tx) => {
                drop(tx);
                None
            }
            None => None,
        };
        self.registry.lock().uncharge(self.id.get());
        self.handle = None;
        self.done = true;
        marker
    }
}

impl fmt::Debug for ActiveOperation<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ActiveOperation")
            .field("id", &self.id)
            .field("done", &self.done)
            .finish_non_exhaustive()
    }
}

impl Drop for ActiveOperation<'_> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        drop(self.tx.take());
        let id = self.id.get();
        let mut inner = self.registry.lock();
        if let Some(entry) = inner.entries.get_mut(&id) {
            let last = entry.lease.snapshot().last_seen;
            let now = call(&self.binding, last);
            let phase = entry.lease.observe(now).map(|snapshot| snapshot.phase);
            if phase == Ok(LeasePhase::Operating) {
                if let Some(handle) = &self.handle {
                    let _end = entry.lease.finish_operation(now, handle);
                }
                let _outcome = entry.lease.dropped(now);
            }
        }
        inner.uncharge(id);
    }
}

/// The single recorded commit attempt. Executing consumes it and runs the
/// native commit exactly once. Dropping it unexecuted drops the native handle
/// and leaves the model with an attempted commit; it never claims rollback.
#[must_use]
pub struct PendingCommit<'r> {
    registry: &'r Registry,
    id: LeaseId,
    binding: LeaseBinding,
    attempt: CommitAttempt,
    tx: Option<KeyedTransaction<'static>>,
    done: bool,
}

impl PendingCommit<'_> {
    pub const fn lease_id(&self) -> LeaseId {
        self.id
    }

    /// Runs the native commit once, without the registry lock, then reports
    /// its result to the model. A late report is not recorded: the model has
    /// already become indeterminate and the native result is returned as is.
    pub fn execute(mut self, at: LogicalTime) -> Result<CommitReport, RegistryError> {
        let Some(tx) = self.tx.take() else {
            return Err(RegistryError::Finished);
        };
        let native = match tx.commit() {
            Ok(()) => CommitResult::Committed,
            Err(
                TransactionCommitError::Rejected(_)
                | TransactionCommitError::Conflicted
                | TransactionCommitError::Cancelled,
            ) => CommitResult::NotCommitted,
            Err(TransactionCommitError::Indeterminate { .. }) => CommitResult::Indeterminate,
        };
        let id = self.id.get();
        let mut inner = self.registry.lock();
        let Some(entry) = inner.entries.get_mut(&id) else {
            return Err(RegistryError::Unknown);
        };
        let last = entry.lease.snapshot().last_seen;
        let at = at.max(last);
        let result = entry
            .lease
            .finish_commit(call(&self.binding, at), &self.attempt, native);
        let (outcome, recorded) = match result {
            Ok(outcome) => (outcome, true),
            Err(_) => match entry.lease.snapshot().phase {
                LeasePhase::Terminal { outcome, .. } => (outcome, false),
                _ => (Outcome::CommitIndeterminate, false),
            },
        };
        inner.uncharge(id);
        drop(inner);
        self.done = true;
        Ok(CommitReport {
            native,
            outcome,
            recorded,
        })
    }
}

impl fmt::Debug for PendingCommit<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PendingCommit")
            .field("id", &self.id)
            .field("done", &self.done)
            .finish_non_exhaustive()
    }
}

impl Drop for PendingCommit<'_> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        drop(self.tx.take());
        self.registry.lock().uncharge(self.id.get());
    }
}
