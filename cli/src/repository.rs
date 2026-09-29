//! Deterministic single-repository lifecycle model for ADR-0031 (gate 1).
//!
//! Pure, safe, clock-free and I/O-free: every call injects a [`LogicalTime`].
//! This is NOT a filesystem manager, catalog or registry. It creates no backup
//! and deletes nothing: restore and purge only record a caller-asserted
//! prerequisite that this model cannot verify. Nothing here authenticates a
//! caller. A repository ID names a catalog entry and is never a path.
//!
//! Every successful transition bumps the generation exactly once. Calls are
//! checked in a fixed order (time, generation or handle, retirement, state,
//! drain confirmation, generation exhaustion, time overflow). A rejected call
//! changes nothing, including the last-seen time, so unspent authority stays
//! usable. Tombstone expiry is judged at each call, never by a background timer.
#![forbid(unsafe_code)]

use crate::lease::LogicalTime;
use std::fmt;
use std::num::NonZeroU64;
use std::sync::Arc;

/// Case-sensitive identifier matching `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`.
/// It is a catalog key only and deliberately has no path conversion.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RepositoryId(String);

fn id_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
}

impl RepositoryId {
    pub fn parse(value: &str) -> Result<Self, RepositoryError> {
        let bytes = value.as_bytes();
        let first = bytes.first().is_some_and(u8::is_ascii_alphanumeric);
        if first && bytes.len() <= 64 && bytes.iter().copied().all(id_byte) {
            Ok(Self(value.to_owned()))
        } else {
            Err(RepositoryError::InvalidId)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Repository generation, bumped by every successful transition.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Generation(u64);

impl Generation {
    /// Caller-asserted expected value for a compare-and-swap.
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RepositoryState {
    Provisioning,
    Closed,
    Opening,
    ReadyReadWrite,
    ReadyReadOnly,
    Quiescing,
    Tombstoned,
    Deleting,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpenMode {
    ReadWrite,
    ReadOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkKind {
    Read,
    Write,
}

/// Result of the explicit validation that must complete creation or opening.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ValidationOutcome {
    Passed,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeletionOutcome {
    Deleted,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QuiesceTarget {
    Close,
    Tombstone,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkDrain {
    InFlight,
    Drained,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LeaseStatus {
    ActiveLeases,
    NoActiveLeases,
}

/// Caller-asserted drain evidence. The model cannot observe work or leases.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DrainConfirmation {
    work: WorkDrain,
    leases: LeaseStatus,
}

impl DrainConfirmation {
    pub const fn new(work: WorkDrain, leases: LeaseStatus) -> Self {
        Self { work, leases }
    }

    fn confirmed(self) -> bool {
        matches!(
            (self.work, self.leases),
            (WorkDrain::Drained, LeaseStatus::NoActiveLeases)
        )
    }
}

/// Caller-asserted, unverified claim that recovery material exists.
/// The model creates and checks no backup; it only rejects the all-zero value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecoveryAssertion([u8; 16]);

impl RecoveryAssertion {
    pub fn caller_asserted(reference: [u8; 16]) -> Result<Self, RepositoryError> {
        if reference == [0; 16] {
            Err(RepositoryError::InvalidAssertion)
        } else {
            Ok(Self(reference))
        }
    }

    pub const fn reference(&self) -> [u8; 16] {
        self.0
    }
}

/// Caller-asserted, unverified claim that a purge policy permits deletion.
/// The model performs no deletion; it only rejects the all-zero value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PurgeAssertion([u8; 16]);

impl PurgeAssertion {
    pub fn caller_asserted(reference: [u8; 16]) -> Result<Self, RepositoryError> {
        if reference == [0; 16] {
            Err(RepositoryError::InvalidAssertion)
        } else {
            Ok(Self(reference))
        }
    }

    pub const fn reference(&self) -> [u8; 16] {
        self.0
    }
}

/// Finite nonzero limits: tombstone retention and the last usable generation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RepositoryLimits {
    retention: NonZeroU64,
    max_generation: NonZeroU64,
}

impl RepositoryLimits {
    pub fn new(retention: u64, max_generation: u64) -> Result<Self, RepositoryError> {
        match (NonZeroU64::new(retention), NonZeroU64::new(max_generation)) {
            (Some(retention), Some(max_generation)) => Ok(Self {
                retention,
                max_generation,
            }),
            _ => Err(RepositoryError::InvalidLimits),
        }
    }

    pub const fn retention(&self) -> u64 {
        self.retention.get()
    }

    pub const fn max_generation(&self) -> u64 {
        self.max_generation.get()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RepositoryError {
    InvalidId,
    InvalidLimits,
    InvalidAssertion,
    TimeRegression,
    StaleGeneration,
    StaleHandle,
    Retired,
    InvalidState,
    NotDrained,
    RetentionActive,
    RetentionExpired,
    GenerationExhausted,
    TimeOverflow,
    NotReady,
    ReadOnly,
    Quiescing,
}

impl fmt::Display for RepositoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidId => "invalid repository ID",
            Self::InvalidLimits => "invalid repository limits",
            Self::InvalidAssertion => "invalid caller assertion",
            Self::TimeRegression => "logical time moved backward",
            Self::StaleGeneration => "stale repository generation",
            Self::StaleHandle => "stale transition handle",
            Self::Retired => "repository retired",
            Self::InvalidState => "transition invalid in this state",
            Self::NotDrained => "drain not confirmed",
            Self::RetentionActive => "tombstone retention still active",
            Self::RetentionExpired => "tombstone retention expired",
            Self::GenerationExhausted => "repository generation exhausted",
            Self::TimeOverflow => "logical time overflow",
            Self::NotReady => "repository not ready",
            Self::ReadOnly => "repository is read-only",
            Self::Quiescing => "repository is quiescing",
        })
    }
}

impl std::error::Error for RepositoryError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Retirement {
    Live,
    Retired,
}

/// Authority-free copy of repository state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositorySnapshot {
    pub state: RepositoryState,
    pub generation: Generation,
    pub last_seen: LogicalTime,
    pub pending_open: Option<OpenMode>,
    pub tombstone_deadline: Option<LogicalTime>,
    pub retirement: Retirement,
    pub recovery_reference: Option<[u8; 16]>,
    pub purge_reference: Option<[u8; 16]>,
}

/// Private identity of one repository instance. Handles keep it alive, so its
/// address is never reused while a handle exists.
#[derive(Debug)]
struct Instance;

/// Proof that a transition began on one instance at one generation. Not Clone.
/// Completion borrows it: a rejected call leaves it usable, while a successful
/// one advances the generation and makes any replay stale.
#[derive(Debug)]
#[must_use]
pub struct TransitionHandle {
    instance: Arc<Instance>,
    generation: Generation,
}

impl TransitionHandle {
    pub const fn generation(&self) -> Generation {
        self.generation
    }
}

/// The lifecycle state machine. Deliberately not Clone: a copy would duplicate
/// the authority to advance one repository.
#[derive(Debug)]
pub struct Repository {
    instance: Arc<Instance>,
    id: RepositoryId,
    limits: RepositoryLimits,
    generation: u64,
    last_seen: u64,
    state: RepositoryState,
    pending_open: Option<OpenMode>,
    tombstone_deadline: Option<u64>,
    retired: bool,
    recovery_reference: Option<[u8; 16]>,
    purge_reference: Option<[u8; 16]>,
}

impl Repository {
    /// Starts in `Provisioning`. Readiness needs an explicit validation result.
    pub fn provision(
        id: RepositoryId,
        limits: RepositoryLimits,
        at: LogicalTime,
    ) -> (Self, TransitionHandle) {
        let instance = Arc::new(Instance);
        let handle = TransitionHandle {
            instance: Arc::clone(&instance),
            generation: Generation(1),
        };
        let repository = Self {
            instance,
            id,
            limits,
            generation: 1,
            last_seen: at.0,
            state: RepositoryState::Provisioning,
            pending_open: None,
            tombstone_deadline: None,
            retired: false,
            recovery_reference: None,
            purge_reference: None,
        };
        (repository, handle)
    }

    pub const fn id(&self) -> &RepositoryId {
        &self.id
    }

    pub fn snapshot(&self) -> RepositorySnapshot {
        RepositorySnapshot {
            state: self.state,
            generation: Generation(self.generation),
            last_seen: LogicalTime(self.last_seen),
            pending_open: self.pending_open,
            tombstone_deadline: self.tombstone_deadline.map(LogicalTime),
            retirement: if self.retired {
                Retirement::Retired
            } else {
                Retirement::Live
            },
            recovery_reference: self.recovery_reference,
            purge_reference: self.purge_reference,
        }
    }

    fn gate_time(&self, at: LogicalTime) -> Result<(), RepositoryError> {
        if at.0 < self.last_seen {
            Err(RepositoryError::TimeRegression)
        } else {
            Ok(())
        }
    }

    fn gate_live(&self) -> Result<(), RepositoryError> {
        if self.retired {
            Err(RepositoryError::Retired)
        } else {
            Ok(())
        }
    }

    fn gate_cas(&self, expected: Generation, at: LogicalTime) -> Result<(), RepositoryError> {
        self.gate_time(at)?;
        if expected.0 != self.generation {
            return Err(RepositoryError::StaleGeneration);
        }
        self.gate_live()
    }

    fn gate_handle(
        &self,
        handle: &TransitionHandle,
        at: LogicalTime,
    ) -> Result<(), RepositoryError> {
        self.gate_time(at)?;
        let issued = Arc::ptr_eq(&handle.instance, &self.instance);
        if !issued || handle.generation.0 != self.generation {
            return Err(RepositoryError::StaleHandle);
        }
        self.gate_live()
    }

    fn next_generation(&self) -> Result<u64, RepositoryError> {
        match self.generation.checked_add(1) {
            Some(next) if next <= self.limits.max_generation.get() => Ok(next),
            _ => Err(RepositoryError::GenerationExhausted),
        }
    }

    /// Applies one accepted transition. State-tied fields are cleared here and
    /// set by the caller afterwards.
    fn commit(&mut self, at: LogicalTime, generation: u64, state: RepositoryState) {
        self.generation = generation;
        self.last_seen = at.0;
        self.state = state;
        self.pending_open = None;
        self.tombstone_deadline = None;
    }

    fn issue(&self) -> TransitionHandle {
        TransitionHandle {
            instance: Arc::clone(&self.instance),
            generation: Generation(self.generation),
        }
    }

    /// `Provisioning` -> `Closed` on a passed validation, else `Failed`.
    pub fn complete_provisioning(
        &mut self,
        handle: &TransitionHandle,
        outcome: ValidationOutcome,
        at: LogicalTime,
    ) -> Result<RepositoryState, RepositoryError> {
        use RepositoryState as S;
        self.gate_handle(handle, at)?;
        if self.state != S::Provisioning {
            return Err(RepositoryError::InvalidState);
        }
        let next = self.next_generation()?;
        let state = match outcome {
            ValidationOutcome::Passed => S::Closed,
            ValidationOutcome::Failed => S::Failed,
        };
        self.commit(at, next, state);
        Ok(state)
    }

    /// `Closed` -> `Opening`. Readiness needs `complete_open`.
    pub fn begin_open(
        &mut self,
        expected: Generation,
        mode: OpenMode,
        at: LogicalTime,
    ) -> Result<TransitionHandle, RepositoryError> {
        use RepositoryState as S;
        self.gate_cas(expected, at)?;
        if self.state != S::Closed {
            return Err(RepositoryError::InvalidState);
        }
        let next = self.next_generation()?;
        self.commit(at, next, S::Opening);
        self.pending_open = Some(mode);
        Ok(self.issue())
    }

    /// `Opening` -> ready in the requested mode on a passed validation, else `Failed`.
    pub fn complete_open(
        &mut self,
        handle: &TransitionHandle,
        outcome: ValidationOutcome,
        at: LogicalTime,
    ) -> Result<RepositoryState, RepositoryError> {
        use RepositoryState as S;
        self.gate_handle(handle, at)?;
        let mode = match (self.state, self.pending_open) {
            (S::Opening, Some(mode)) => mode,
            _ => return Err(RepositoryError::InvalidState),
        };
        let next = self.next_generation()?;
        let state = match (outcome, mode) {
            (ValidationOutcome::Failed, _) => S::Failed,
            (ValidationOutcome::Passed, OpenMode::ReadWrite) => S::ReadyReadWrite,
            (ValidationOutcome::Passed, OpenMode::ReadOnly) => S::ReadyReadOnly,
        };
        self.commit(at, next, state);
        Ok(state)
    }

    /// `Closed` or ready -> `Quiescing`; new work is rejected from here on.
    pub fn begin_quiesce(
        &mut self,
        expected: Generation,
        at: LogicalTime,
    ) -> Result<TransitionHandle, RepositoryError> {
        use RepositoryState as S;
        self.gate_cas(expected, at)?;
        if !matches!(self.state, S::Closed | S::ReadyReadWrite | S::ReadyReadOnly) {
            return Err(RepositoryError::InvalidState);
        }
        let next = self.next_generation()?;
        self.commit(at, next, S::Quiescing);
        Ok(self.issue())
    }

    /// `Quiescing` -> `Closed` or a recoverable `Tombstoned` with deadline
    /// `at + retention`. Needs explicit drain confirmation for both targets.
    pub fn complete_quiesce(
        &mut self,
        handle: &TransitionHandle,
        drain: DrainConfirmation,
        target: QuiesceTarget,
        at: LogicalTime,
    ) -> Result<RepositoryState, RepositoryError> {
        use RepositoryState as S;
        self.gate_handle(handle, at)?;
        if self.state != S::Quiescing {
            return Err(RepositoryError::InvalidState);
        }
        if !drain.confirmed() {
            return Err(RepositoryError::NotDrained);
        }
        let next = self.next_generation()?;
        match target {
            QuiesceTarget::Close => {
                self.commit(at, next, S::Closed);
                Ok(S::Closed)
            }
            QuiesceTarget::Tombstone => {
                let retention = self.limits.retention.get();
                let deadline = at.0.checked_add(retention);
                let deadline = deadline.ok_or(RepositoryError::TimeOverflow)?;
                self.commit(at, next, S::Tombstoned);
                self.tombstone_deadline = Some(deadline);
                Ok(S::Tombstoned)
            }
        }
    }

    /// `Tombstoned` -> `Closed` strictly before the deadline. The result is not
    /// ready: it must be opened and validated again.
    pub fn restore(
        &mut self,
        expected: Generation,
        assertion: RecoveryAssertion,
        at: LogicalTime,
    ) -> Result<RepositoryState, RepositoryError> {
        use RepositoryState as S;
        self.gate_cas(expected, at)?;
        let deadline = match (self.state, self.tombstone_deadline) {
            (S::Tombstoned, Some(deadline)) => deadline,
            _ => return Err(RepositoryError::InvalidState),
        };
        if at.0 >= deadline {
            return Err(RepositoryError::RetentionExpired);
        }
        let next = self.next_generation()?;
        self.commit(at, next, S::Closed);
        self.recovery_reference = Some(assertion.reference());
        Ok(S::Closed)
    }

    /// `Tombstoned` at or after the deadline, or `Failed`, -> `Deleting`.
    pub fn begin_purge(
        &mut self,
        expected: Generation,
        assertion: PurgeAssertion,
        at: LogicalTime,
    ) -> Result<TransitionHandle, RepositoryError> {
        use RepositoryState as S;
        self.gate_cas(expected, at)?;
        match (self.state, self.tombstone_deadline) {
            (S::Failed, _) => {}
            (S::Tombstoned, Some(deadline)) if at.0 < deadline => {
                return Err(RepositoryError::RetentionActive);
            }
            (S::Tombstoned, Some(_)) => {}
            _ => return Err(RepositoryError::InvalidState),
        }
        let next = self.next_generation()?;
        self.commit(at, next, S::Deleting);
        self.purge_reference = Some(assertion.reference());
        Ok(self.issue())
    }

    /// A reported deletion retires the repository in `Deleting`; a reported
    /// failure returns to `Failed`, from which a purge may be retried.
    pub fn complete_purge(
        &mut self,
        handle: &TransitionHandle,
        outcome: DeletionOutcome,
        at: LogicalTime,
    ) -> Result<RepositoryState, RepositoryError> {
        use RepositoryState as S;
        self.gate_handle(handle, at)?;
        if self.state != S::Deleting {
            return Err(RepositoryError::InvalidState);
        }
        let next = self.next_generation()?;
        match outcome {
            DeletionOutcome::Deleted => {
                self.commit(at, next, S::Deleting);
                self.retired = true;
            }
            DeletionOutcome::Failed => self.commit(at, next, S::Failed),
        }
        Ok(self.state)
    }

    /// Admits one unit of work. Only ready states accept work, and a read-only
    /// repository rejects writes. Success records the time, nothing else.
    pub fn admit(&mut self, at: LogicalTime, kind: WorkKind) -> Result<(), RepositoryError> {
        use RepositoryState as S;
        self.gate_time(at)?;
        self.gate_live()?;
        match (self.state, kind) {
            (S::ReadyReadWrite, _) | (S::ReadyReadOnly, WorkKind::Read) => {}
            (S::ReadyReadOnly, WorkKind::Write) => return Err(RepositoryError::ReadOnly),
            (S::Quiescing, _) => return Err(RepositoryError::Quiescing),
            _ => return Err(RepositoryError::NotReady),
        }
        self.last_seen = at.0;
        Ok(())
    }
}
