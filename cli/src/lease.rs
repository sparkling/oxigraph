//! Deterministic lease state model for ADR-0030 leased remote transactions.
//!
//! Pure, safe and clock-free: every call injects a monotonic [`LogicalTime`].
//! The model is NOT authentication. It holds no token or secret; the caller
//! asserts an already-authorized [`LeaseBinding`] on every call and the model
//! only compares it with the immutable binding stored at begin. It cannot
//! create durable truth: an indeterminate commit is resolved only by an
//! externally supplied [`ExternalOutcome`]. All deadlines are exclusive.
#![forbid(unsafe_code)]

use std::fmt;
use std::num::NonZeroU64;
use std::sync::Arc;

pub mod registry;

/// Injected monotonic logical time. The model never reads a clock.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct LogicalTime(pub u64);

/// Opaque lease identifier. It grants no authority.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LeaseId(u64);

impl LeaseId {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// Lease generation, incremented only by a successful renewal.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Generation(u64);

impl Generation {
    /// Caller-asserted expected value for a compare-and-swap renewal.
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// Durable external idempotency key used for outcome lookup. Not a secret.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct CommitKey([u8; 16]);

impl CommitKey {
    pub const fn new(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }
    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}

/// Immutable principal/tenant/repository binding asserted by the caller.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaseBinding {
    principal: String,
    tenant: String,
    repository: String,
}

impl LeaseBinding {
    pub fn new(principal: &str, tenant: &str, repository: &str) -> Result<Self, LeaseError> {
        if [principal, tenant, repository]
            .iter()
            .all(|part| valid_part(part))
        {
            Ok(Self {
                principal: principal.into(),
                tenant: tenant.into(),
                repository: repository.into(),
            })
        } else {
            Err(LeaseError::InvalidBinding)
        }
    }
    pub fn principal(&self) -> &str {
        &self.principal
    }
    pub fn tenant(&self) -> &str {
        &self.tenant
    }
    pub fn repository(&self) -> &str {
        &self.repository
    }
}

fn valid_part(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-:@/".contains(&b))
}

/// Plain limit values before validation. All are logical-time units.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LimitsSpec {
    pub idle: u64,
    pub absolute: u64,
    pub max_extension: u64,
    pub cancel_grace: u64,
    pub commit_wait: u64,
    pub retention: u64,
}

/// Validated finite nonzero limits.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LeaseLimits {
    idle: NonZeroU64,
    absolute: NonZeroU64,
    max_extension: NonZeroU64,
    cancel_grace: NonZeroU64,
    commit_wait: NonZeroU64,
    retention: NonZeroU64,
}

impl LeaseLimits {
    pub fn new(spec: LimitsSpec) -> Result<Self, LeaseError> {
        let nonzero = |value: u64| NonZeroU64::new(value).ok_or(LeaseError::InvalidLimits);
        let limits = Self {
            idle: nonzero(spec.idle)?,
            absolute: nonzero(spec.absolute)?,
            max_extension: nonzero(spec.max_extension)?,
            cancel_grace: nonzero(spec.cancel_grace)?,
            commit_wait: nonzero(spec.commit_wait)?,
            retention: nonzero(spec.retention)?,
        };
        if limits.idle > limits.absolute || limits.max_extension > limits.absolute {
            Err(LeaseError::InvalidLimits)
        } else {
            Ok(limits)
        }
    }
    pub fn spec(&self) -> LimitsSpec {
        LimitsSpec {
            idle: self.idle.get(),
            absolute: self.absolute.get(),
            max_extension: self.max_extension.get(),
            cancel_grace: self.cancel_grace.get(),
            commit_wait: self.commit_wait.get(),
            retention: self.retention.get(),
        }
    }
}

/// One caller-asserted, already-authorized call context.
#[derive(Clone, Copy, Debug)]
pub struct Call<'a> {
    pub binding: &'a LeaseBinding,
    pub at: LogicalTime,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LeaseError {
    InvalidBinding,
    InvalidLimits,
    TimeOverflow,
    BindingMismatch,
    TimeRegression,
    Busy,
    CommitAttempted,
    StaleGeneration,
    StaleHandle,
    NoExtension,
    AlreadyTerminal,
    Expired,
    NotIndeterminate,
    ConflictingResolution,
    RestartContradiction,
    CounterExhausted,
}

impl fmt::Display for LeaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidBinding => "invalid lease binding",
            Self::InvalidLimits => "invalid lease limits",
            Self::TimeOverflow => "lease time overflow",
            Self::BindingMismatch => "lease binding mismatch",
            Self::TimeRegression => "logical time moved backward",
            Self::Busy => "lease has an active operation",
            Self::CommitAttempted => "commit already attempted",
            Self::StaleGeneration => "stale lease generation",
            Self::StaleHandle => "stale operation handle",
            Self::NoExtension => "renewal grants no extension",
            Self::AlreadyTerminal => "lease already terminal",
            Self::Expired => "terminal tombstone expired",
            Self::NotIndeterminate => "lease outcome is not indeterminate",
            Self::ConflictingResolution => "conflicting outcome resolution",
            Self::RestartContradiction => "restart lookup contradicts lease state",
            Self::CounterExhausted => "lease counter exhausted",
        })
    }
}

impl std::error::Error for LeaseError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CancelCause {
    Requested,
    Expiry,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RollbackReason {
    Explicit,
    Dropped,
    Expired,
    Cancelled,
}

/// Terminal outcome. `RolledBack` is proven non-commit; `CleanupOverdue` is
/// not committed but rollback is NOT proven.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    RolledBack(RollbackReason),
    CleanupOverdue(CancelCause),
    Committed,
    CommitProvenAbsent,
    CommitIndeterminate,
}

impl Outcome {
    pub const fn is_commit_attempt(self) -> bool {
        matches!(
            self,
            Self::Committed | Self::CommitProvenAbsent | Self::CommitIndeterminate
        )
    }
}

/// Result of a commit attempt as reported by the caller.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitResult {
    Committed,
    NotCommitted,
    Indeterminate,
}

/// Durable external lookup result. The model never invents one.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExternalOutcome {
    Committed,
    ProvenAbsent,
    Indeterminate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationEnd {
    Completed,
    CancelledAcknowledged,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LeasePhase {
    Idle,
    Operating,
    Cancelling {
        cleanup_deadline: LogicalTime,
        cause: CancelCause,
    },
    CommitAttempted {
        decide_by: LogicalTime,
    },
    Terminal {
        outcome: Outcome,
        at: LogicalTime,
    },
    Expired {
        attempted: bool,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Renewal {
    pub generation: Generation,
    pub deadline: LogicalTime,
    pub granted: u64,
}

/// Authority-free copy of lease state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaseSnapshot {
    pub id: LeaseId,
    pub generation: Generation,
    pub last_seen: LogicalTime,
    pub deadline: LogicalTime,
    pub absolute_deadline: LogicalTime,
    pub operation_count: u64,
    pub phase: LeasePhase,
    pub commit_key: Option<CommitKey>,
    pub commit_attempted: bool,
    pub response_lost: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Phase {
    Idle,
    Operating,
    Cancelling {
        cleanup_deadline: u64,
        cause: CancelCause,
    },
    CommitAttempted {
        decide_by: u64,
    },
    Terminal {
        outcome: Outcome,
        at: u64,
    },
    Expired {
        attempted: bool,
    },
}

impl Phase {
    fn view(self) -> LeasePhase {
        match self {
            Self::Idle => LeasePhase::Idle,
            Self::Operating => LeasePhase::Operating,
            Self::Cancelling {
                cleanup_deadline,
                cause,
            } => LeasePhase::Cancelling {
                cleanup_deadline: LogicalTime(cleanup_deadline),
                cause,
            },
            Self::CommitAttempted { decide_by } => LeasePhase::CommitAttempted {
                decide_by: LogicalTime(decide_by),
            },
            Self::Terminal { outcome, at } => LeasePhase::Terminal {
                outcome,
                at: LogicalTime(at),
            },
            Self::Expired { attempted } => LeasePhase::Expired { attempted },
        }
    }
}

/// Private identity of one lease instance. Every lease allocates its own;
/// handles keep it alive, so its address is never reused while they exist.
#[derive(Debug)]
struct Instance;

/// Proof that one operation began on one lease instance. Not Clone. Finishing
/// borrows it, so a call rejected before any transition can be retried; it
/// cannot complete an operation of another instance or generation, even one
/// with an equal [`LeaseId`], nor complete the same operation twice.
#[derive(Debug)]
#[must_use]
pub struct OperationHandle {
    instance: Arc<Instance>,
    id: LeaseId,
    generation: Generation,
    op_seq: u64,
}

impl OperationHandle {
    pub const fn lease_id(&self) -> LeaseId {
        self.id
    }
}

/// Proof that the single commit attempt began on one lease instance. Not Clone.
/// Finishing borrows it; the lease records at most one result.
#[derive(Debug)]
#[must_use]
pub struct CommitAttempt {
    instance: Arc<Instance>,
    id: LeaseId,
    generation: Generation,
}

impl CommitAttempt {
    pub const fn lease_id(&self) -> LeaseId {
        self.id
    }
}

/// The lease state machine. Deliberately not Clone: a copy would duplicate
/// the authority to advance one lease. Each instance has a private identity
/// that its handles must match, so an equal [`LeaseId`] grants nothing.
#[derive(Debug)]
pub struct Lease {
    instance: Arc<Instance>,
    id: LeaseId,
    binding: LeaseBinding,
    limits: LeaseLimits,
    generation: Generation,
    last_seen: u64,
    absolute_deadline: u64,
    deadline: u64,
    op_seq: u64,
    phase: Phase,
    commit_key: Option<CommitKey>,
    commit_attempted: bool,
    response_lost: bool,
}

impl Lease {
    /// Begins a lease. The whole chain absolute deadline, cleanup or commit
    /// wait, and tombstone retention is overflow-checked here, so no later
    /// transition can overflow.
    pub fn begin(call: Call<'_>, id: LeaseId, limits: LeaseLimits) -> Result<Self, LeaseError> {
        let at = call.at.0;
        let absolute_deadline = at
            .checked_add(limits.absolute.get())
            .ok_or(LeaseError::TimeOverflow)?;
        let tail = limits.cancel_grace.max(limits.commit_wait).get();
        absolute_deadline
            .checked_add(tail)
            .and_then(|value| value.checked_add(limits.retention.get()))
            .ok_or(LeaseError::TimeOverflow)?;
        let deadline = at
            .checked_add(limits.idle.get())
            .ok_or(LeaseError::TimeOverflow)?
            .min(absolute_deadline);
        Ok(Self {
            instance: Arc::new(Instance),
            id,
            binding: call.binding.clone(),
            limits,
            generation: Generation(1),
            last_seen: at,
            absolute_deadline,
            deadline,
            op_seq: 0,
            phase: Phase::Idle,
            commit_key: None,
            commit_attempted: false,
            response_lost: false,
        })
    }

    pub const fn id(&self) -> LeaseId {
        self.id
    }

    pub const fn binding(&self) -> &LeaseBinding {
        &self.binding
    }

    pub const fn limits(&self) -> &LeaseLimits {
        &self.limits
    }

    pub fn snapshot(&self) -> LeaseSnapshot {
        LeaseSnapshot {
            id: self.id,
            generation: self.generation,
            last_seen: LogicalTime(self.last_seen),
            deadline: LogicalTime(self.deadline),
            absolute_deadline: LogicalTime(self.absolute_deadline),
            operation_count: self.op_seq,
            phase: self.phase.view(),
            commit_key: self.commit_key,
            commit_attempted: self.commit_attempted,
            response_lost: self.response_lost,
        }
    }

    /// Binding, then time regression, then due transitions. The first two
    /// rejections change nothing.
    fn enter(&mut self, call: Call<'_>) -> Result<(), LeaseError> {
        if *call.binding != self.binding {
            return Err(LeaseError::BindingMismatch);
        }
        if call.at.0 < self.last_seen {
            return Err(LeaseError::TimeRegression);
        }
        self.last_seen = call.at.0;
        self.settle(call.at.0)
    }

    fn settle(&mut self, now: u64) -> Result<(), LeaseError> {
        loop {
            match self.phase {
                Phase::Idle if now >= self.deadline => {
                    self.phase = Phase::Terminal {
                        outcome: Outcome::RolledBack(RollbackReason::Expired),
                        at: self.deadline,
                    };
                }
                Phase::Operating if now >= self.deadline => {
                    let cleanup_deadline = self
                        .deadline
                        .checked_add(self.limits.cancel_grace.get())
                        .ok_or(LeaseError::TimeOverflow)?;
                    self.phase = Phase::Cancelling {
                        cleanup_deadline,
                        cause: CancelCause::Expiry,
                    };
                }
                Phase::Cancelling {
                    cleanup_deadline,
                    cause,
                } if now >= cleanup_deadline => {
                    self.phase = Phase::Terminal {
                        outcome: Outcome::CleanupOverdue(cause),
                        at: cleanup_deadline,
                    };
                }
                Phase::CommitAttempted { decide_by } if now >= decide_by => {
                    self.phase = Phase::Terminal {
                        outcome: Outcome::CommitIndeterminate,
                        at: decide_by,
                    };
                }
                Phase::Terminal { outcome, at } => {
                    let expires = at
                        .checked_add(self.limits.retention.get())
                        .ok_or(LeaseError::TimeOverflow)?;
                    if now < expires {
                        return Ok(());
                    }
                    self.phase = Phase::Expired {
                        attempted: outcome.is_commit_attempt(),
                    };
                }
                _ => return Ok(()),
            }
        }
    }

    fn blocked(&self) -> LeaseError {
        match self.phase {
            Phase::Idle | Phase::Operating | Phase::Cancelling { .. } => LeaseError::Busy,
            Phase::CommitAttempted { .. } => LeaseError::CommitAttempted,
            Phase::Terminal { .. } => LeaseError::AlreadyTerminal,
            Phase::Expired { .. } => LeaseError::Expired,
        }
    }

    fn require_idle(&self) -> Result<(), LeaseError> {
        if matches!(self.phase, Phase::Idle) {
            Ok(())
        } else {
            Err(self.blocked())
        }
    }

    /// True only for a handle issued by this very instance at this generation.
    fn issued(&self, instance: &Arc<Instance>, generation: Generation) -> bool {
        Arc::ptr_eq(instance, &self.instance) && generation == self.generation
    }

    /// Applies due transitions and returns the state. Never renews.
    pub fn observe(&mut self, call: Call<'_>) -> Result<LeaseSnapshot, LeaseError> {
        self.enter(call)?;
        Ok(self.snapshot())
    }

    /// Starts the single active operation. Never renews the lease.
    pub fn begin_operation(&mut self, call: Call<'_>) -> Result<OperationHandle, LeaseError> {
        self.enter(call)?;
        self.require_idle()?;
        let op_seq = self
            .op_seq
            .checked_add(1)
            .ok_or(LeaseError::CounterExhausted)?;
        self.op_seq = op_seq;
        self.phase = Phase::Operating;
        Ok(OperationHandle {
            instance: Arc::clone(&self.instance),
            id: self.id,
            generation: self.generation,
            op_seq,
        })
    }

    /// Completes an operation, or acknowledges cancellation before the
    /// cleanup deadline (proven rollback). The handle is only borrowed, so a
    /// rejected call leaves it usable for a retry. A replay cannot succeed:
    /// completion returns to idle, where the handle is stale, and a later
    /// operation advances the sequence; acknowledgement is terminal.
    pub fn finish_operation(
        &mut self,
        call: Call<'_>,
        handle: &OperationHandle,
    ) -> Result<OperationEnd, LeaseError> {
        self.enter(call)?;
        if !self.issued(&handle.instance, handle.generation) || handle.op_seq != self.op_seq {
            return Err(LeaseError::StaleHandle);
        }
        match self.phase {
            Phase::Operating => {
                self.phase = Phase::Idle;
                Ok(OperationEnd::Completed)
            }
            Phase::Cancelling { cause, .. } => {
                let reason = match cause {
                    CancelCause::Requested => RollbackReason::Cancelled,
                    CancelCause::Expiry => RollbackReason::Expired,
                };
                self.phase = Phase::Terminal {
                    outcome: Outcome::RolledBack(reason),
                    at: call.at.0,
                };
                Ok(OperationEnd::CancelledAcknowledged)
            }
            Phase::Terminal { .. } => Err(LeaseError::AlreadyTerminal),
            Phase::Expired { .. } => Err(LeaseError::Expired),
            Phase::Idle | Phase::CommitAttempted { .. } => Err(LeaseError::StaleHandle),
        }
    }

    /// Generation compare-and-swap. The grant is clamped to the maximum
    /// extension and the absolute deadline; a renewal gaining nothing is rejected.
    pub fn renew(
        &mut self,
        call: Call<'_>,
        expected: Generation,
        requested: NonZeroU64,
    ) -> Result<Renewal, LeaseError> {
        self.enter(call)?;
        self.require_idle()?;
        if expected != self.generation {
            return Err(LeaseError::StaleGeneration);
        }
        let granted = requested.min(self.limits.max_extension).get();
        let end = call.at.0.saturating_add(granted);
        let deadline = end.min(self.absolute_deadline);
        if deadline <= self.deadline {
            return Err(LeaseError::NoExtension);
        }
        let generation = Generation(
            self.generation
                .0
                .checked_add(1)
                .ok_or(LeaseError::CounterExhausted)?,
        );
        self.generation = generation;
        self.deadline = deadline;
        Ok(Renewal {
            generation,
            deadline: LogicalTime(deadline),
            granted: deadline - call.at.0,
        })
    }

    /// Idle rolls back at once. A running operation enters bounded cleanup;
    /// repeating the request does not extend the cleanup deadline.
    pub fn request_cancel(&mut self, call: Call<'_>) -> Result<LeasePhase, LeaseError> {
        self.enter(call)?;
        match self.phase {
            Phase::Idle => {
                self.phase = Phase::Terminal {
                    outcome: Outcome::RolledBack(RollbackReason::Cancelled),
                    at: call.at.0,
                };
            }
            Phase::Operating => {
                let cleanup_deadline = call
                    .at
                    .0
                    .checked_add(self.limits.cancel_grace.get())
                    .ok_or(LeaseError::TimeOverflow)?;
                self.phase = Phase::Cancelling {
                    cleanup_deadline,
                    cause: CancelCause::Requested,
                };
            }
            Phase::Cancelling { .. }
            | Phase::Terminal {
                outcome: Outcome::RolledBack(_),
                ..
            } => {}
            Phase::CommitAttempted { .. } | Phase::Terminal { .. } | Phase::Expired { .. } => {
                return Err(self.blocked());
            }
        }
        Ok(self.phase.view())
    }

    fn roll_back(&mut self, call: Call<'_>, why: RollbackReason) -> Result<Outcome, LeaseError> {
        self.enter(call)?;
        if let Phase::Terminal {
            outcome: outcome @ Outcome::RolledBack(_),
            ..
        } = self.phase
        {
            return Ok(outcome);
        }
        self.require_idle()?;
        let outcome = Outcome::RolledBack(why);
        self.phase = Phase::Terminal {
            outcome,
            at: call.at.0,
        };
        Ok(outcome)
    }

    /// Explicit rollback. Idempotent on a rolled-back lease. Rejected while an
    /// operation runs and after a commit attempt.
    pub fn rollback(&mut self, call: Call<'_>) -> Result<Outcome, LeaseError> {
        self.roll_back(call, RollbackReason::Explicit)
    }

    /// Drop-equivalent rollback of the owned transaction, same rules as rollback.
    pub fn dropped(&mut self, call: Call<'_>) -> Result<Outcome, LeaseError> {
        self.roll_back(call, RollbackReason::Dropped)
    }

    /// Records the one and only commit attempt under a durable external key.
    pub fn begin_commit(
        &mut self,
        call: Call<'_>,
        key: CommitKey,
    ) -> Result<CommitAttempt, LeaseError> {
        self.enter(call)?;
        self.require_idle()?;
        let decide_by = call
            .at
            .0
            .checked_add(self.limits.commit_wait.get())
            .ok_or(LeaseError::TimeOverflow)?;
        self.phase = Phase::CommitAttempted { decide_by };
        self.commit_key = Some(key);
        self.commit_attempted = true;
        Ok(CommitAttempt {
            instance: Arc::clone(&self.instance),
            id: self.id,
            generation: self.generation,
        })
    }

    /// Records the caller-reported commit result. After the wait elapses the
    /// outcome is already indeterminate; a late report is rejected. The
    /// attempt is only borrowed, so a rejected call may be retried; once a
    /// result is recorded the lease is terminal and a replay is rejected.
    pub fn finish_commit(
        &mut self,
        call: Call<'_>,
        attempt: &CommitAttempt,
        result: CommitResult,
    ) -> Result<Outcome, LeaseError> {
        self.enter(call)?;
        if !self.issued(&attempt.instance, attempt.generation) {
            return Err(LeaseError::StaleHandle);
        }
        match self.phase {
            Phase::CommitAttempted { .. } => {
                let outcome = match result {
                    CommitResult::Committed => Outcome::Committed,
                    CommitResult::NotCommitted => Outcome::CommitProvenAbsent,
                    CommitResult::Indeterminate => Outcome::CommitIndeterminate,
                };
                self.phase = Phase::Terminal {
                    outcome,
                    at: call.at.0,
                };
                Ok(outcome)
            }
            Phase::Terminal { .. } => Err(LeaseError::AlreadyTerminal),
            Phase::Expired { .. } => Err(LeaseError::Expired),
            Phase::Idle | Phase::Operating | Phase::Cancelling { .. } => {
                Err(LeaseError::StaleHandle)
            }
        }
    }

    /// Records that a response was lost. Flag only: never replays or changes state.
    pub fn response_lost(&mut self, call: Call<'_>) -> Result<(), LeaseError> {
        self.enter(call)?;
        self.response_lost = true;
        Ok(())
    }

    /// Applies an externally supplied durable lookup to an indeterminate
    /// commit. Idempotent; a conflicting definite resolution is rejected.
    pub fn resolve_indeterminate(
        &mut self,
        call: Call<'_>,
        external: ExternalOutcome,
    ) -> Result<Outcome, LeaseError> {
        self.enter(call)?;
        match self.phase {
            Phase::Terminal { outcome, at } => {
                let resolved = match (outcome, external) {
                    (Outcome::CommitIndeterminate, ExternalOutcome::Committed) => {
                        Outcome::Committed
                    }
                    (Outcome::CommitIndeterminate, ExternalOutcome::ProvenAbsent) => {
                        Outcome::CommitProvenAbsent
                    }
                    (Outcome::CommitIndeterminate, ExternalOutcome::Indeterminate) => {
                        Outcome::CommitIndeterminate
                    }
                    (
                        Outcome::Committed,
                        ExternalOutcome::Committed | ExternalOutcome::Indeterminate,
                    ) => Outcome::Committed,
                    (
                        Outcome::CommitProvenAbsent,
                        ExternalOutcome::ProvenAbsent | ExternalOutcome::Indeterminate,
                    ) => Outcome::CommitProvenAbsent,
                    (
                        Outcome::Committed | Outcome::CommitProvenAbsent,
                        ExternalOutcome::Committed | ExternalOutcome::ProvenAbsent,
                    ) => return Err(LeaseError::ConflictingResolution),
                    (Outcome::RolledBack(_) | Outcome::CleanupOverdue(_), _) => {
                        return Err(LeaseError::NotIndeterminate);
                    }
                };
                self.phase = Phase::Terminal {
                    outcome: resolved,
                    at,
                };
                Ok(resolved)
            }
            Phase::Expired { .. } => Err(LeaseError::Expired),
            Phase::Idle
            | Phase::Operating
            | Phase::Cancelling { .. }
            | Phase::CommitAttempted { .. } => Err(LeaseError::NotIndeterminate),
        }
    }

    /// Consumes the lease at process restart. Staged state never resumes.
    /// No time is applied: pending deadlines are not settled. Outstanding
    /// handles keep only this dead instance and cannot complete another lease.
    pub fn restart(self) -> RestartRecord {
        let attempted = match self.phase {
            Phase::Terminal { outcome, .. } => match outcome {
                Outcome::Committed => Some(ExternalOutcome::Committed),
                Outcome::CommitProvenAbsent => Some(ExternalOutcome::ProvenAbsent),
                Outcome::CommitIndeterminate => Some(ExternalOutcome::Indeterminate),
                Outcome::RolledBack(_) | Outcome::CleanupOverdue(_) => None,
            },
            Phase::CommitAttempted { .. } => Some(ExternalOutcome::Indeterminate),
            Phase::Expired { attempted } => attempted.then_some(ExternalOutcome::Indeterminate),
            Phase::Idle | Phase::Operating | Phase::Cancelling { .. } => None,
        };
        RestartRecord {
            id: self.id,
            commit_key: self.commit_key,
            attempted,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RestartClass {
    StagedDiscarded,
    Committed,
    CommitProvenAbsent,
    Indeterminate,
}

const fn class_of(outcome: ExternalOutcome) -> RestartClass {
    match outcome {
        ExternalOutcome::Committed => RestartClass::Committed,
        ExternalOutcome::ProvenAbsent => RestartClass::CommitProvenAbsent,
        ExternalOutcome::Indeterminate => RestartClass::Indeterminate,
    }
}

/// What survives a restart of one lease. Carries no authority to continue it.
/// `attempted` is the outcome known before restart, present only after a
/// commit attempt; an unresolved attempt is recorded as indeterminate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RestartRecord {
    id: LeaseId,
    commit_key: Option<CommitKey>,
    attempted: Option<ExternalOutcome>,
}

impl RestartRecord {
    pub const fn id(&self) -> LeaseId {
        self.id
    }

    /// Key to look up durably, present only if a commit was attempted.
    pub const fn commit_key(&self) -> Option<CommitKey> {
        self.commit_key
    }

    /// Classifies the lease after restart. Without a lookup an attempted
    /// commit is indeterminate, never rolled back. A lookup contradicting the
    /// recorded state is an error.
    pub fn classify(&self, lookup: Option<ExternalOutcome>) -> Result<RestartClass, LeaseError> {
        let known = match self.attempted {
            Some(known) => known,
            None if lookup.is_none() => return Ok(RestartClass::StagedDiscarded),
            None => return Err(LeaseError::RestartContradiction),
        };
        let resolved = match (known, lookup) {
            (_, None | Some(ExternalOutcome::Indeterminate)) => known,
            (ExternalOutcome::Indeterminate, Some(found)) => found,
            (_, Some(found)) if found == known => known,
            (_, Some(_)) => return Err(LeaseError::RestartContradiction),
        };
        Ok(class_of(resolved))
    }
}
