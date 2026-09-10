//! ADR-0027: process-local admission, deadlines and opt-in request/result bytes.
//! Optional inner-join, sort-buffer and distinct-buffer row budgets are
//! cooperative, not hard process isolation.
//!
//! Profiles are explicit and immutable per admission attempt. File-backed
//! controllers may atomically reload after an authorized local/operator decision.
//! Without optional priority scheduling, eligible requests are FIFO, skipping
//! a saturated class so it cannot block another class. Data-pool priority
//! levels remain bounded and FIFO within each level; operator capacity is a
//! separate FIFO pool.
//!
//! Admission telemetry ([`metrics`]) is process-local and observational only:
//! every returned `acquire` result is counted exactly once, queue waits are the
//! measured from enqueue to the terminal scheduling observation, and reading a
//! snapshot never mutates admission.
use crate::access::{ListenerKind, RequestContext};
use oxhttp::model::header::{CACHE_CONTROL, RETRY_AFTER};
use oxhttp::model::{Body, Extensions, Response, StatusCode};
use oxigraph::sparql::{
    AggregateDistinctBudget, CancellationToken, DistinctBufferBudget, GroupBufferBudget,
    InnerJoinBuildBudget, PathBufferBudget, SortBufferBudget,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};
use std::fmt;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

mod metrics;
mod resource_metrics;
pub use metrics::{AdmissionDisposition, AdmissionMetrics, AdmissionPool, QueueWaitHistogram};
pub use resource_metrics::{ResourceOperator, ResourceUsageMetrics};

const MAX_PROFILE_BYTES: u64 = 64 * 1024;
// Cooperative queue-token observation, not an end-to-end cancellation claim.
const CANCELLATION_POLL: Duration = Duration::from_millis(10);

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClassLimits {
    pub max_active: usize,
    pub max_queued: usize,
}

/// Optional data-pool caps for one authenticated principal. The absent form
/// deliberately preserves the original global/class-only policy.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PrincipalLimits {
    max_active: usize,
    max_queued: usize,
}

/// Optional bounded data-pool scheduling policy. It is deliberately separate
/// from `ClassLimits`: class capacity and class priority are independent
/// controls, and omitting this object preserves the original FIFO scheduler.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PriorityScheduling {
    max_bypass: u32,
    class_priorities: BTreeMap<String, u8>,
}

/// Transfer-decoded entity bytes before and after content decompression.
/// Both fields are explicit. Zero permits only an empty body. These are not
/// HTTP framing, total process memory, or RDF parser/evaluator work limits.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestBodyBudget {
    max_encoded_bytes: u64,
    max_decoded_bytes: u64,
}

impl From<RequestBodyBudget> for oxhttp::RequestBodyLimits {
    fn from(value: RequestBodyBudget) -> Self {
        Self {
            max_encoded_bytes: value.max_encoded_bytes,
            max_decoded_bytes: value.max_decoded_bytes,
        }
    }
}

/// No capacity defaults: the operator supplies every limit. This version only
/// promises admission limits, optional cooperative request deadlines and entity
/// byte/inner-join build-row/sort-buffer/distinct-buffer/group-buffer row limits,
/// not general per-principal fairness.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkloadPolicy {
    format: String,
    policy_id: String,
    version: u64,
    max_active: usize,
    max_queued: usize,
    operator_max_active: usize,
    operator_max_queued: usize,
    queue_timeout_ms: u64,
    #[serde(default)]
    request_timeout_ms: Option<u64>,
    #[serde(default)]
    request_body_limits: Option<RequestBodyBudget>,
    #[serde(default)]
    max_result_bytes: Option<u64>,
    #[serde(default)]
    max_inner_join_build_rows: Option<u64>,
    #[serde(default)]
    max_sort_buffer_rows: Option<u64>,
    #[serde(default)]
    max_distinct_buffer_rows: Option<u64>,
    #[serde(default)]
    max_group_buffer_rows: Option<u64>,
    #[serde(default)]
    max_aggregate_distinct_rows: Option<u64>,
    #[serde(default)]
    max_path_buffer_rows: Option<u64>,
    retry_after_seconds: u32,
    #[serde(default)]
    principal: Option<PrincipalLimits>,
    #[serde(default)]
    priority_scheduling: Option<PriorityScheduling>,
    classes: BTreeMap<String, ClassLimits>,
}

impl WorkloadPolicy {
    /// Bounded JSON read and validation; call before opening a store/listener.
    pub fn load(path: &Path) -> Result<Self, WorkloadError> {
        let path_metadata = std::fs::metadata(path).map_err(|_| WorkloadError::InvalidPolicy)?;
        if !path_metadata.is_file() || path_metadata.len() > MAX_PROFILE_BYTES {
            return Err(WorkloadError::InvalidPolicy);
        }
        let file = std::fs::File::open(path).map_err(|_| WorkloadError::InvalidPolicy)?;
        let opened_metadata = file.metadata().map_err(|_| WorkloadError::InvalidPolicy)?;
        if !opened_metadata.is_file() || opened_metadata.len() > MAX_PROFILE_BYTES {
            return Err(WorkloadError::InvalidPolicy);
        }
        let mut bytes = Vec::new();
        file.take(MAX_PROFILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| WorkloadError::InvalidPolicy)?;
        Self::from_json(&bytes)
    }

    pub fn from_json(bytes: &[u8]) -> Result<Self, WorkloadError> {
        if bytes.len() as u64 > MAX_PROFILE_BYTES {
            return Err(WorkloadError::InvalidPolicy);
        }
        let policy: Self =
            serde_json::from_slice(bytes).map_err(|_| WorkloadError::InvalidPolicy)?;
        policy.validate()?;
        Ok(policy)
    }

    fn validate(&self) -> Result<(), WorkloadError> {
        let name = |value: &str| {
            !value.is_empty()
                && value.len() <= 32
                && value
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
        };
        if self.format != "oxigraph-admission-v1"
            || !name(&self.policy_id)
            || self.version == 0
            || self.max_active == 0
            || self.operator_max_active == 0
            || self
                .max_active
                .checked_add(self.operator_max_active)
                .is_none()
            || self
                .max_queued
                .checked_add(self.operator_max_queued)
                .is_none()
            || self
                .max_active
                .checked_add(self.max_queued)
                .and_then(|n| n.checked_add(1))
                .is_none()
            || self
                .operator_max_active
                .checked_add(self.operator_max_queued)
                .and_then(|n| n.checked_add(1))
                .is_none()
            || self.queue_timeout_ms == 0
            || self.request_timeout_ms.is_some_and(|timeout| {
                timeout == 0
                    || Instant::now()
                        .checked_add(Duration::from_millis(timeout))
                        .is_none()
            })
            || Instant::now()
                .checked_add(Duration::from_millis(self.queue_timeout_ms))
                .is_none()
            || !(1..=300).contains(&self.retry_after_seconds)
            || self.principal.as_ref().is_some_and(|limits| {
                limits.max_active == 0
                    || limits.max_active > self.max_active
                    || limits.max_queued > self.max_queued
            })
            || self.classes.is_empty()
            || self.classes.len() > 16
            || !self.classes.contains_key("default")
            || self.classes.iter().any(|(class, limits)| {
                !name(class)
                    || limits.max_active == 0
                    || limits.max_active > self.max_active
                    || limits.max_queued > self.max_queued
            })
            || self.priority_scheduling.as_ref().is_some_and(|priority| {
                priority.class_priorities.len() != self.classes.len()
                    || priority
                        .class_priorities
                        .iter()
                        .any(|(class, value)| *value > 3 || !self.classes.contains_key(class))
            })
        {
            return Err(WorkloadError::InvalidPolicy);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdmissionScope {
    Global,
    Class,
    Principal,
    Operator,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkloadError {
    InvalidPolicy,
    UnknownClass,
    MissingAccessContext,
    Unavailable,
    Overloaded(AdmissionScope),
    AdmissionTimedOut,
    RequestTimedOut,
    Cancelled,
}

impl fmt::Display for WorkloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidPolicy => "invalid admission policy",
            Self::UnknownClass => "unconfigured workload class",
            Self::MissingAccessContext => "missing trusted access context",
            Self::Unavailable => "admission unavailable",
            Self::Overloaded(_) => "workload overloaded",
            Self::AdmissionTimedOut => "admission timed out",
            Self::RequestTimedOut => "request deadline elapsed",
            Self::Cancelled => "admission cancelled",
        })
    }
}
impl std::error::Error for WorkloadError {}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AdmissionSnapshot {
    pub active: usize,
    pub queued: usize,
    pub operator_active: usize,
    pub operator_queued: usize,
}

struct State {
    policy: Arc<WorkloadPolicy>,
    active: usize,
    operator_active: usize,
    classes: BTreeMap<String, usize>,
    principals: BTreeMap<PrincipalKey, PrincipalOccupancy>,
    queue: VecDeque<Entry>,
    next_id: u64,
}
impl State {
    fn new(policy: Arc<WorkloadPolicy>) -> Self {
        Self {
            policy,
            active: 0,
            operator_active: 0,
            classes: BTreeMap::new(),
            principals: BTreeMap::new(),
            queue: VecDeque::new(),
            next_id: 0,
        }
    }
}
struct Entry {
    id: u64,
    class: String,
    operator: bool,
    principal: Option<PrincipalKey>,
    deadline: Instant,
    cancellation: CancellationToken,
    policy: Arc<WorkloadPolicy>,
    // Immutable per-attempt scheduling snapshot. Operator entries always use
    // zeroes and remain FIFO regardless of a data-pool policy reload.
    priority: u8,
    bypass_limit: u32,
    bypasses: u32,
}

/// Opaque, fixed-width scheduling identity. It is derived only from the
/// trusted access context and never rendered, logged or exported.
#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
struct PrincipalKey([u8; 32]);

impl PrincipalKey {
    const ANONYMOUS: Self = Self([0; 32]);

    fn from_context(context: &RequestContext) -> Self {
        Self::from_principal(context.principal())
    }

    fn from_principal(principal: &crate::access::RequestPrincipal) -> Self {
        let Some(subject) = principal.subject() else {
            return Self::ANONYMOUS;
        };
        let mut hash = Sha256::new();
        hash.update(b"oxigraph-workload-authenticated-principal-v1");
        hash.update([principal.method() as u8]);
        hash.update(subject.as_bytes());
        Self(hash.finalize().into())
    }
}

#[derive(Default)]
struct PrincipalOccupancy {
    active: usize,
    queued: usize,
}
struct Inner {
    // Immutable startup envelope. Live policy values are in `State::policy`.
    policy: WorkloadPolicy,
    source: Option<PathBuf>,
    state: Mutex<State>,
    changed: Condvar,
    // Fixed-size telemetry only. Locked after `state` when both are needed and
    // never held across scheduling, storage or transport work.
    metrics: Mutex<AdmissionMetrics>,
    resource_metrics: Mutex<ResourceUsageMetrics>,
}

/// One controller must be shared by both data and operator listeners.
#[derive(Clone)]
pub struct AdmissionController(Arc<Inner>);

impl AdmissionController {
    /// Startup binding. A later access-policy reload introducing an unknown
    /// class is denied per request; it never acquires default-class capacity.
    pub fn validate_access(
        &self,
        access: &crate::access::AccessController,
    ) -> Result<(), WorkloadError> {
        access
            .with_workload_classes(|classes| {
                let state = self.lock()?;
                if classes
                    .iter()
                    .any(|class| !state.policy.classes.contains_key(class))
                {
                    Err(WorkloadError::UnknownClass)
                } else {
                    Ok(())
                }
            })
            .map_err(|_| WorkloadError::Unavailable)?
    }

    /// Include one additional connection to return overload without a body.
    /// Idle/pre-header connections remain a separate transport-level limit.
    pub fn connection_limit(&self, listener: ListenerKind) -> usize {
        if listener == ListenerKind::Operator {
            self.0.policy.operator_max_active + self.0.policy.operator_max_queued + 1
        } else {
            self.0.policy.max_active + self.0.policy.max_queued + 1
        }
    }

    pub fn new(policy: WorkloadPolicy) -> Result<Self, WorkloadError> {
        Self::new_with_source(policy, None)
    }

    fn new_with_source(
        policy: WorkloadPolicy,
        source: Option<PathBuf>,
    ) -> Result<Self, WorkloadError> {
        policy.validate()?;
        let current = Arc::new(policy.clone());
        Ok(Self(Arc::new(Inner {
            policy,
            source,
            state: Mutex::new(State::new(current)),
            changed: Condvar::new(),
            metrics: Mutex::new(AdmissionMetrics::default()),
            resource_metrics: Mutex::new(ResourceUsageMetrics::default()),
        })))
    }

    pub fn from_file(path: &Path) -> Result<Self, WorkloadError> {
        Self::new_with_source(WorkloadPolicy::load(path)?, Some(path.to_owned()))
    }

    /// Atomically installs the configured file's next policy snapshot.
    ///
    /// This method does not authenticate its caller. Invoke it only from an
    /// authorized local/operator control path. The file is bounded, read and
    /// validated before the scheduler mutex is acquired. The access-policy read
    /// guard is then held before the workload lock, so the candidate covers one
    /// coherent set of currently declared workload classes at the swap point.
    /// In-memory controllers have no reload source and fail closed.
    pub fn reload(&self, access: &crate::access::AccessController) -> Result<u64, WorkloadError> {
        self.reload_inner(access, None)
    }

    /// Like [`Self::reload`], but tied to an admitted request's cancellation.
    /// Cancellation is checked before file access and again at the final locked
    /// swap checkpoint, so a request that expires while preparing or waiting for
    /// either policy lock cannot replace the last-good snapshot.
    pub fn reload_with_cancellation(
        &self,
        access: &crate::access::AccessController,
        cancellation: &CancellationToken,
    ) -> Result<u64, WorkloadError> {
        self.reload_inner(access, Some(cancellation))
    }

    fn reload_inner(
        &self,
        access: &crate::access::AccessController,
        cancellation: Option<&CancellationToken>,
    ) -> Result<u64, WorkloadError> {
        if let Some(cancellation) = cancellation {
            check_cancellation(cancellation)?;
        }
        let path = self.0.source.as_ref().ok_or(WorkloadError::InvalidPolicy)?;
        let candidate = Arc::new(WorkloadPolicy::load(path)?);
        self.apply_candidate(access, candidate, cancellation)
    }

    fn apply_candidate(
        &self,
        access: &crate::access::AccessController,
        candidate: Arc<WorkloadPolicy>,
        cancellation: Option<&CancellationToken>,
    ) -> Result<u64, WorkloadError> {
        let data_ceiling = candidate
            .max_active
            .checked_add(candidate.max_queued)
            .and_then(|value| value.checked_add(1))
            .ok_or(WorkloadError::InvalidPolicy)?;
        let operator_ceiling = candidate
            .operator_max_active
            .checked_add(candidate.operator_max_queued)
            .and_then(|value| value.checked_add(1))
            .ok_or(WorkloadError::InvalidPolicy)?;
        if data_ceiling > self.connection_limit(ListenerKind::Data)
            || operator_ceiling > self.connection_limit(ListenerKind::Operator)
        {
            return Err(WorkloadError::InvalidPolicy);
        }
        access
            .with_workload_classes(|classes| {
                let mut state = self.lock()?;
                if candidate.policy_id != state.policy.policy_id
                    || candidate.version <= state.policy.version
                    || classes
                        .iter()
                        .any(|class| !candidate.classes.contains_key(class))
                {
                    return Err(
                        if classes
                            .iter()
                            .any(|class| !candidate.classes.contains_key(class))
                        {
                            WorkloadError::UnknownClass
                        } else {
                            WorkloadError::InvalidPolicy
                        },
                    );
                }
                if let Some(cancellation) = cancellation {
                    check_cancellation(cancellation)?;
                }
                let version = candidate.version;
                state.policy = Arc::clone(&candidate);
                // Only active ownership is retained here. Removed classes with
                // no active lease need no permanent map entry; queued entries
                // retain their own immutable policy and class snapshots.
                state.classes.retain(|_, active| *active != 0);
                self.0.changed.notify_all();
                Ok(version)
            })
            .map_err(|_| WorkloadError::Unavailable)?
    }

    fn lock(&self) -> Result<MutexGuard<'_, State>, WorkloadError> {
        self.0.state.lock().map_err(|_| WorkloadError::Unavailable)
    }

    /// Observe counters without exposing queries, principals or class labels.
    pub fn snapshot(&self) -> Result<AdmissionSnapshot, WorkloadError> {
        let state = self.lock()?;
        Ok(AdmissionSnapshot {
            active: state.active,
            queued: state.queue.iter().filter(|entry| !entry.operator).count(),
            operator_active: state.operator_active,
            operator_queued: state.queue.iter().filter(|entry| entry.operator).count(),
        })
    }

    /// One consistent telemetry view: counters and the instantaneous gauges are
    /// copied while both controller locks are held, so no admission, purge,
    /// dequeue or release can interleave. No scheduling work runs here. A
    /// poisoned lock fails closed instead of reporting zeros.
    pub fn metrics(&self) -> Result<AdmissionMetrics, WorkloadError> {
        let state = self.lock()?;
        let metrics = self
            .0
            .metrics
            .lock()
            .map_err(|_| WorkloadError::Unavailable)?
            .clone();
        let snapshot = AdmissionSnapshot {
            active: state.active,
            queued: state.queue.iter().filter(|entry| !entry.operator).count(),
            operator_active: state.operator_active,
            operator_queued: state.queue.iter().filter(|entry| entry.operator).count(),
        };
        drop(state);
        Ok(metrics.with_gauges(snapshot))
    }

    /// Fixed-size resource-handle observations copied without inspecting
    /// scheduler state. A snapshot is recorded only at the final lease drop;
    /// independently retained library budget clones may change afterwards.
    /// A poisoned telemetry lock fails closed instead of reporting zeros.
    pub fn resource_metrics(&self) -> Result<ResourceUsageMetrics, WorkloadError> {
        self.0
            .resource_metrics
            .lock()
            .map_err(|_| WorkloadError::Unavailable)
            .map(|metrics| metrics.clone())
    }

    /// The single terminal observation of one acquisition attempt. Called after
    /// the state lock is released; `denial` rendering and lease/ticket drops
    /// never record anything, so purge, late cancellation or unwind of the
    /// admitted work cannot produce a second count.
    fn record(
        &self,
        listener: ListenerKind,
        result: &Result<WorkloadLease, WorkloadError>,
        queue_wait: Option<Duration>,
    ) {
        self.0
            .metrics
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .record(
                listener.into(),
                AdmissionDisposition::of(result),
                queue_wait,
            );
    }

    /// Queue cancellation is checked at least every 10ms of scheduled execution.
    /// Embedders that use this public API share the anonymous principal cap;
    /// only [`Self::admit`] derives an authenticated key from a trusted access
    /// context. Caller-provided classes/listener kinds are trusted server inputs,
    /// never values copied directly from HTTP headers. No body/storage/egress access.
    pub fn acquire(
        &self,
        class: &str,
        listener: ListenerKind,
        cancellation: CancellationToken,
    ) -> Result<WorkloadLease, WorkloadError> {
        self.acquire_with_abort(class, listener, PrincipalKey::ANONYMOUS, cancellation, None)
    }

    fn acquire_with_abort(
        &self,
        class: &str,
        listener: ListenerKind,
        principal: PrincipalKey,
        cancellation: CancellationToken,
        abort: Option<&oxhttp::AdmissionAbort>,
    ) -> Result<WorkloadLease, WorkloadError> {
        self.acquire_with_abort_snapshot(class, listener, principal, cancellation, abort)
            .0
    }

    fn acquire_with_abort_snapshot(
        &self,
        class: &str,
        listener: ListenerKind,
        principal: PrincipalKey,
        cancellation: CancellationToken,
        abort: Option<&oxhttp::AdmissionAbort>,
    ) -> (
        Result<WorkloadLease, WorkloadError>,
        Option<Arc<WorkloadPolicy>>,
    ) {
        let mut queue_wait = None;
        let mut policy = None;
        let result = self.try_acquire(
            class,
            listener,
            principal,
            cancellation,
            abort,
            &mut queue_wait,
            &mut policy,
        );
        self.record(listener, &result, queue_wait);
        (result, policy)
    }

    /// `queue_wait` is set only when the request entered the queue: from its
    /// locked enqueue to the locked scheduling pass that decided its result.
    fn try_acquire(
        &self,
        class: &str,
        listener: ListenerKind,
        principal: PrincipalKey,
        cancellation: CancellationToken,
        abort: Option<&oxhttp::AdmissionAbort>,
        queue_wait: &mut Option<Duration>,
        attempt_policy: &mut Option<Arc<WorkloadPolicy>>,
    ) -> Result<WorkloadLease, WorkloadError> {
        let now = Instant::now();
        let mut state = self.lock()?;
        let policy = Arc::clone(&state.policy);
        *attempt_policy = Some(Arc::clone(&policy));
        let cancellation = if let Some(timeout) = policy.request_timeout_ms {
            cancellation.with_deadline(
                now.checked_add(Duration::from_millis(timeout))
                    .ok_or(WorkloadError::InvalidPolicy)?,
            )
        } else {
            cancellation
        };
        if abort.is_some_and(oxhttp::AdmissionAbort::is_aborted) {
            cancellation.cancel();
        }
        let entry = Self::entry(
            &mut state,
            class,
            listener,
            principal,
            cancellation,
            now,
            policy,
        )?;
        Self::purge(&mut state, Instant::now());
        if Self::available(&state, &entry) && Self::first_eligible(&state, entry.operator).is_none()
        {
            if abort.is_some_and(oxhttp::AdmissionAbort::is_aborted) {
                entry.cancellation.cancel();
            }
            return self.activate(&mut state, &entry);
        }
        Self::check_queue_capacity(&state, &entry)?;
        let id = entry.id;
        let deadline = entry.deadline;
        let cancellation = entry.cancellation.clone();
        Self::enqueue(&mut state, entry);
        let enqueued = Instant::now();
        *queue_wait = Some(Duration::ZERO);
        // Declare after the mutex guard, but release the guard before leaving:
        // ticket drop must never recursively lock the same mutex.
        drop(state);
        let ticket = QueueTicket {
            controller: self.clone(),
            id,
        };
        loop {
            if abort.is_some_and(oxhttp::AdmissionAbort::is_aborted) {
                cancellation.cancel();
            }
            let mut state = match self.lock() {
                Ok(state) => state,
                Err(error) => {
                    *queue_wait = Some(enqueued.elapsed());
                    return Err(error);
                }
            };
            let now = Instant::now();
            *queue_wait = Some(now.saturating_duration_since(enqueued));
            let failure = if let Some(reason) = cancellation.cancellation_reason() {
                Some(match reason {
                    oxigraph::sparql::CancellationReason::TimedOut => {
                        WorkloadError::RequestTimedOut
                    }
                    oxigraph::sparql::CancellationReason::Cancelled => WorkloadError::Cancelled,
                })
            } else if now >= deadline {
                Some(WorkloadError::AdmissionTimedOut)
            } else {
                None
            };
            Self::purge(&mut state, now);
            if let Some(error) = failure {
                drop(state);
                drop(ticket);
                return Err(error);
            }
            let operator = listener == ListenerKind::Operator;
            if Self::first_eligible(&state, operator) == Some(id) {
                let index = state
                    .queue
                    .iter()
                    .position(|entry| entry.id == id)
                    .ok_or(WorkloadError::Unavailable)?;
                let entry = state
                    .queue
                    .remove(index)
                    .ok_or(WorkloadError::Unavailable)?;
                Self::release_queued(&mut state.principals, &entry);
                if abort.is_some_and(oxhttp::AdmissionAbort::is_aborted) {
                    cancellation.cancel();
                }
                let lease = self.activate(&mut state, &entry);
                drop(state);
                drop(ticket);
                return lease;
            }
            let wait = deadline
                .saturating_duration_since(now)
                .min(CANCELLATION_POLL);
            if let Ok((guard, _)) = self.0.changed.wait_timeout(state, wait) {
                drop(guard);
            } else {
                *queue_wait = Some(enqueued.elapsed());
                return Err(WorkloadError::Unavailable);
            }
        }
    }

    /// Apply only after AccessController::admit. The transport retains the lease
    /// through response flushing, even if the handler clears request extensions.
    pub fn admit(
        &self,
        context: &mut Extensions,
        listener: ListenerKind,
    ) -> Result<(), Box<Response<Body>>> {
        self.admit_with_abort(context, listener, None)
    }

    /// Like [`Self::admit`], additionally observes transport errors while queued.
    /// Pass the unmodified OxHTTP admission head, after authenticating it. The
    /// probe is pre-body only; a graceful TCP half-close is not cancellation.
    pub fn admit_request(
        &self,
        head: &oxhttp::model::request::Builder,
        context: &mut Extensions,
        listener: ListenerKind,
    ) -> Result<(), Box<Response<Body>>> {
        self.admit_with_abort(
            context,
            listener,
            head.extensions_ref()
                .and_then(|extensions| extensions.get::<oxhttp::AdmissionAbort>()),
        )
    }

    fn admit_with_abort(
        &self,
        context: &mut Extensions,
        listener: ListenerKind,
        abort: Option<&oxhttp::AdmissionAbort>,
    ) -> Result<(), Box<Response<Body>>> {
        let (result, policy) = match context.get::<RequestContext>() {
            Some(access) => self.acquire_with_abort_snapshot(
                &access.grant().workload_class,
                listener,
                PrincipalKey::from_context(access),
                CancellationToken::new(),
                abort,
            ),
            None => (Err(WorkloadError::MissingAccessContext), None),
        };
        match result {
            Ok(lease) => {
                if let Some(limit) = lease.result_byte_limit() {
                    context.insert(limit);
                }
                if let Some(limits) = lease.request_body_limits() {
                    context.insert(limits);
                }
                if let Some(deadline) = lease.deadline() {
                    context.insert(oxhttp::RequestDeadline(deadline));
                }
                let cancellation = lease.cancellation_token().clone();
                context.insert(oxhttp::RequestTransportCancellation::new(move || {
                    cancellation.cancel();
                }));
                context.insert(oxhttp::RequestLifetime::new(lease.clone()));
                context.insert(lease);
                Ok(())
            }
            Err(error) => Err(Box::new(policy.map_or_else(
                || self.denial(error),
                |policy| Self::denial_with_policy(error, &policy),
            ))),
        }
    }

    pub fn denial(&self, error: WorkloadError) -> Response<Body> {
        let Ok(state) = self.lock() else {
            return Response::builder()
                .status(StatusCode::SERVICE_UNAVAILABLE)
                .header(CACHE_CONTROL, "no-store")
                .body(Body::empty())
                .unwrap();
        };
        Self::denial_with_policy(error, &state.policy)
    }

    fn denial_with_policy(error: WorkloadError, policy: &WorkloadPolicy) -> Response<Body> {
        let class = matches!(
            error,
            WorkloadError::Overloaded(AdmissionScope::Class | AdmissionScope::Principal)
        );
        let mut response = Response::builder()
            .status(if class {
                StatusCode::TOO_MANY_REQUESTS
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            })
            .header(CACHE_CONTROL, "no-store");
        if class {
            response = response.header(RETRY_AFTER, policy.retry_after_seconds);
        }
        response.body(Body::empty()).unwrap()
    }

    fn entry(
        state: &mut State,
        class: &str,
        listener: ListenerKind,
        principal: PrincipalKey,
        cancellation: CancellationToken,
        now: Instant,
        policy: Arc<WorkloadPolicy>,
    ) -> Result<Entry, WorkloadError> {
        if !policy.classes.contains_key(class) {
            return Err(WorkloadError::UnknownClass);
        }
        if let Some(reason) = cancellation.cancellation_reason() {
            return Err(match reason {
                oxigraph::sparql::CancellationReason::TimedOut => WorkloadError::RequestTimedOut,
                oxigraph::sparql::CancellationReason::Cancelled => WorkloadError::Cancelled,
            });
        }
        let id = state.next_id;
        state.next_id = id.checked_add(1).ok_or(WorkloadError::Unavailable)?;
        let (priority, bypass_limit) = if listener == ListenerKind::Data {
            policy
                .priority_scheduling
                .as_ref()
                .map(|scheduling| (scheduling.class_priorities[class], scheduling.max_bypass))
                .unwrap_or((0, 0))
        } else {
            (0, 0)
        };
        Ok(Entry {
            id,
            class: class.into(),
            operator: listener == ListenerKind::Operator,
            principal: (listener == ListenerKind::Data).then_some(principal),
            deadline: now
                .checked_add(Duration::from_millis(policy.queue_timeout_ms))
                .ok_or(WorkloadError::InvalidPolicy)?,
            cancellation,
            policy,
            priority,
            bypass_limit,
            bypasses: 0,
        })
    }

    fn available(state: &State, entry: &Entry) -> bool {
        if entry.operator {
            state.operator_active < entry.policy.operator_max_active
        } else {
            state.active < entry.policy.max_active
                && state.classes.get(&entry.class).copied().unwrap_or(0)
                    < entry.policy.classes[&entry.class].max_active
                && entry.policy.principal.as_ref().is_none_or(|limits| {
                    state
                        .principals
                        .get(&entry.principal.expect("data entry has principal"))
                        .map_or(0, |occupancy| occupancy.active)
                        < limits.max_active
                })
        }
    }

    fn first_eligible(state: &State, operator: bool) -> Option<u64> {
        if operator {
            return state
                .queue
                .iter()
                .find(|entry| entry.operator && Self::available(state, entry))
                .map(|entry| entry.id);
        }

        // This bounded, allocation-free scan stores the first eligible entry
        // of each priority and separately remembers whether any eligible
        // entry in that level has aged to its own immutable limit. The latter
        // intentionally protects the older head of the same level, preserving
        // FIFO while allowing a newly eligible head to inherit its level's
        // accumulated protection.
        let mut heads: [Option<u64>; 4] = [None; 4];
        let mut protected = [false; 4];
        for entry in &state.queue {
            if entry.operator || !Self::available(state, entry) {
                continue;
            }
            // The first eligible data entry is also the oldest eligible head
            // overall. If it is protected, no protected level can have an
            // older head, which preserves the legacy FIFO fast path when
            // scheduling is omitted (all entries have a zero limit).
            if heads.iter().all(Option::is_none) && entry.bypasses >= entry.bypass_limit {
                return Some(entry.id);
            }
            let level = usize::from(entry.priority);
            if heads[level].is_none() {
                heads[level] = Some(entry.id);
            }
            protected[level] |= entry.bypasses >= entry.bypass_limit;
        }
        let mut selected = None;
        for level in 0..4 {
            if protected[level] {
                if let Some(id) = heads[level] {
                    if selected.is_none_or(|oldest| id < oldest) {
                        selected = Some(id);
                    }
                }
            }
        }
        if selected.is_some() {
            return selected;
        }
        (0..4).rev().find_map(|level| heads[level])
    }

    fn purge(state: &mut State, now: Instant) {
        let State {
            queue, principals, ..
        } = state;
        queue.retain(|entry| {
            let retain = now < entry.deadline && !entry.cancellation.is_cancelled();
            if !retain {
                Self::release_queued(principals, entry);
            }
            retain
        });
    }

    fn check_queue_capacity(state: &State, entry: &Entry) -> Result<(), WorkloadError> {
        let scope = if entry.operator {
            (state.queue.iter().filter(|e| e.operator).count() >= entry.policy.operator_max_queued)
                .then_some(AdmissionScope::Operator)
        } else if state.queue.iter().filter(|e| !e.operator).count() >= entry.policy.max_queued {
            Some(AdmissionScope::Global)
        } else if state
            .queue
            .iter()
            .filter(|e| !e.operator && e.class == entry.class)
            .count()
            >= entry.policy.classes[&entry.class].max_queued
        {
            Some(AdmissionScope::Class)
        } else if entry.policy.principal.as_ref().is_some_and(|limits| {
            state
                .principals
                .get(&entry.principal.expect("data entry has principal"))
                .map_or(0, |occupancy| occupancy.queued)
                >= limits.max_queued
        }) {
            Some(AdmissionScope::Principal)
        } else {
            None
        };
        scope.map_or(Ok(()), |scope| Err(WorkloadError::Overloaded(scope)))
    }

    fn activate(&self, state: &mut State, entry: &Entry) -> Result<WorkloadLease, WorkloadError> {
        if let Some(reason) = entry.cancellation.cancellation_reason() {
            return Err(match reason {
                oxigraph::sparql::CancellationReason::TimedOut => WorkloadError::RequestTimedOut,
                oxigraph::sparql::CancellationReason::Cancelled => WorkloadError::Cancelled,
            });
        }
        if !entry.operator {
            Self::age_older_eligible(state, entry.id);
        }
        if entry.operator {
            state.operator_active += 1;
        } else {
            state.active += 1;
            *state.classes.entry(entry.class.clone()).or_default() += 1;
            state
                .principals
                .entry(entry.principal.expect("data entry has principal"))
                .or_default()
                .active += 1;
        }
        Ok(WorkloadLease(Arc::new(LeaseInner {
            controller: self.clone(),
            class: entry.class.clone(),
            operator: entry.operator,
            principal: entry.principal,
            cancellation: entry.cancellation.clone(),
            policy: Arc::clone(&entry.policy),
            inner_join_build_budget: entry
                .policy
                .max_inner_join_build_rows
                .map(InnerJoinBuildBudget::new),
            sort_buffer_budget: entry.policy.max_sort_buffer_rows.map(SortBufferBudget::new),
            distinct_buffer_budget: entry
                .policy
                .max_distinct_buffer_rows
                .map(DistinctBufferBudget::new),
            group_buffer_budget: entry
                .policy
                .max_group_buffer_rows
                .map(GroupBufferBudget::new),
            aggregate_distinct_budget: entry
                .policy
                .max_aggregate_distinct_rows
                .map(AggregateDistinctBudget::new),
            path_buffer_budget: entry.policy.max_path_buffer_rows.map(PathBufferBudget::new),
        })))
    }

    /// Record only successful newer data-pool admissions, after the selected
    /// entry has passed its final cancellation check and before occupancy is
    /// changed. Availability is therefore evaluated at the scheduling point.
    fn age_older_eligible(state: &mut State, admitted_id: u64) {
        for index in 0..state.queue.len() {
            let eligible = {
                let entry = &state.queue[index];
                !entry.operator
                    && entry.id < admitted_id
                    && entry.bypasses < entry.bypass_limit
                    && Self::available(state, entry)
            };
            if eligible {
                let entry = &mut state.queue[index];
                entry.bypasses = entry.bypasses.saturating_add(1).min(entry.bypass_limit);
            }
        }
    }

    fn enqueue(state: &mut State, entry: Entry) {
        if let Some(principal) = entry.principal {
            state.principals.entry(principal).or_default().queued += 1;
        }
        state.queue.push_back(entry);
    }

    fn release_queued(principals: &mut BTreeMap<PrincipalKey, PrincipalOccupancy>, entry: &Entry) {
        if let Some(principal) = entry.principal {
            let remove = if let Some(occupancy) = principals.get_mut(&principal) {
                occupancy.queued -= 1;
                occupancy.active == 0 && occupancy.queued == 0
            } else {
                false
            };
            if remove {
                principals.remove(&principal);
            }
        }
    }

    fn release_active(
        principals: &mut BTreeMap<PrincipalKey, PrincipalOccupancy>,
        principal: PrincipalKey,
    ) {
        let remove = {
            let occupancy = principals
                .get_mut(&principal)
                .expect("active principal occupancy exists");
            occupancy.active -= 1;
            occupancy.active == 0 && occupancy.queued == 0
        };
        if remove {
            principals.remove(&principal);
        }
    }
}

struct QueueTicket {
    controller: AdmissionController,
    id: u64,
}
impl Drop for QueueTicket {
    fn drop(&mut self) {
        // Poison stays fail-closed for new admissions; cleanup remains possible.
        let mut state = self
            .controller
            .0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(index) = state.queue.iter().position(|entry| entry.id == self.id) {
            let entry = state.queue.remove(index).expect("queued entry exists");
            AdmissionController::release_queued(&mut state.principals, &entry);
        }
        self.controller.0.changed.notify_all();
    }
}

/// Shared ownership: capacity is released exactly once, after the last holder.
/// Cancelling a running lease does NOT release its capacity while work is alive.
#[derive(Clone)]
pub struct WorkloadLease(Arc<LeaseInner>);
struct LeaseInner {
    controller: AdmissionController,
    class: String,
    operator: bool,
    principal: Option<PrincipalKey>,
    cancellation: CancellationToken,
    policy: Arc<WorkloadPolicy>,
    inner_join_build_budget: Option<InnerJoinBuildBudget>,
    sort_buffer_budget: Option<SortBufferBudget>,
    distinct_buffer_budget: Option<DistinctBufferBudget>,
    group_buffer_budget: Option<GroupBufferBudget>,
    aggregate_distinct_budget: Option<AggregateDistinctBudget>,
    path_buffer_budget: Option<PathBufferBudget>,
}
impl WorkloadLease {
    /// One cumulative handle created at admission, shared by every native
    /// query/update evaluator in this request. A getter never resets it.
    pub fn inner_join_build_budget(&self) -> Option<&InnerJoinBuildBudget> {
        self.0.inner_join_build_budget.as_ref()
    }
    /// One cumulative `ORDER BY` sort-buffer row handle created at admission,
    /// shared by every native query/update evaluator in this request.
    pub fn sort_buffer_budget(&self) -> Option<&SortBufferBudget> {
        self.0.sort_buffer_budget.as_ref()
    }
    /// One cumulative `DISTINCT` retained-row handle created at admission,
    /// shared by every native query/update evaluator in this request.
    pub fn distinct_buffer_budget(&self) -> Option<&DistinctBufferBudget> {
        self.0.distinct_buffer_budget.as_ref()
    }
    /// One cumulative accumulator-group handle created at admission, shared
    /// by every native query/update evaluator in this request.
    pub fn group_buffer_budget(&self) -> Option<&GroupBufferBudget> {
        self.0.group_buffer_budget.as_ref()
    }
    /// One cumulative aggregate-`DISTINCT` retained-key handle created at
    /// admission, shared by every native query/update evaluator in this request.
    pub fn aggregate_distinct_budget(&self) -> Option<&AggregateDistinctBudget> {
        self.0.aggregate_distinct_budget.as_ref()
    }
    /// One cumulative native path buffer-entry handle per admitted request.
    pub fn path_buffer_budget(&self) -> Option<&PathBufferBudget> {
        self.0.path_buffer_budget.as_ref()
    }
    /// Serialized/emitted result bytes; excludes HTTP framing and host memory.
    pub fn result_byte_limit(&self) -> Option<oxhttp::ResponseBodyLimit> {
        self.0
            .policy
            .max_result_bytes
            .map(oxhttp::ResponseBodyLimit)
    }
    /// Immutable request-body bounds for the trusted HTTP admission hook.
    pub fn request_body_limits(&self) -> Option<oxhttp::RequestBodyLimits> {
        self.0.policy.request_body_limits.map(Into::into)
    }
    pub fn deadline(&self) -> Option<Instant> {
        self.0.cancellation.deadline()
    }

    /// A synchronous cooperative checkpoint, including the final precommit check.
    /// Returning after CommitAttempted cannot prove rollback of that attempt.
    pub fn check(&self) -> Result<(), WorkloadError> {
        check_cancellation(&self.0.cancellation)
    }
    pub fn policy_id(&self) -> &str {
        &self.0.policy.policy_id
    }
    pub fn policy_version(&self) -> u64 {
        self.0.policy.version
    }
    pub fn cancellation_token(&self) -> &CancellationToken {
        &self.0.cancellation
    }
}

fn check_cancellation(cancellation: &CancellationToken) -> Result<(), WorkloadError> {
    match cancellation.cancellation_reason() {
        Some(oxigraph::sparql::CancellationReason::TimedOut) => Err(WorkloadError::RequestTimedOut),
        Some(oxigraph::sparql::CancellationReason::Cancelled) => Err(WorkloadError::Cancelled),
        None => Ok(()),
    }
}
impl Drop for LeaseInner {
    fn drop(&mut self) {
        // Keep state-before-metrics lock order. Observation failure must not
        // retain capacity: poisoned telemetry is recovered for this one final
        // bounded record while public snapshots fail closed.
        let mut state = self
            .controller
            .0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let pool = if self.operator {
            AdmissionPool::Operator
        } else {
            AdmissionPool::Data
        };
        if self.inner_join_build_budget.is_some()
            || self.sort_buffer_budget.is_some()
            || self.distinct_buffer_budget.is_some()
            || self.group_buffer_budget.is_some()
            || self.aggregate_distinct_budget.is_some()
            || self.path_buffer_budget.is_some()
        {
            let mut metrics = self
                .controller
                .0
                .resource_metrics
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(budget) = &self.inner_join_build_budget {
                metrics.record(
                    pool,
                    ResourceOperator::InnerJoinBuildRows,
                    budget.charged_rows(),
                    budget.check().is_err(),
                );
            }
            if let Some(budget) = &self.sort_buffer_budget {
                metrics.record(
                    pool,
                    ResourceOperator::SortBufferRows,
                    budget.charged_rows(),
                    budget.check().is_err(),
                );
            }
            if let Some(budget) = &self.distinct_buffer_budget {
                metrics.record(
                    pool,
                    ResourceOperator::DistinctBufferRows,
                    budget.charged_rows(),
                    budget.check().is_err(),
                );
            }
            if let Some(budget) = &self.group_buffer_budget {
                metrics.record(
                    pool,
                    ResourceOperator::GroupBufferRows,
                    budget.charged_rows(),
                    budget.check().is_err(),
                );
            }
            if let Some(budget) = &self.aggregate_distinct_budget {
                metrics.record(
                    pool,
                    ResourceOperator::AggregateDistinctRows,
                    budget.charged_rows(),
                    budget.check().is_err(),
                );
            }
            if let Some(budget) = &self.path_buffer_budget {
                metrics.record(
                    pool,
                    ResourceOperator::PathBufferRows,
                    budget.charged_rows(),
                    budget.check().is_err(),
                );
            }
        }
        if self.operator {
            state.operator_active -= 1;
        } else {
            state.active -= 1;
            let remove = {
                let active = state.classes.get_mut(&self.class).unwrap();
                *active -= 1;
                *active == 0
            };
            if remove {
                state.classes.remove(&self.class);
            }
            AdmissionController::release_active(
                &mut state.principals,
                self.principal.expect("data lease has principal"),
            );
        }
        self.controller.0.changed.notify_all();
    }
}

#[cfg(test)]
mod tests;
