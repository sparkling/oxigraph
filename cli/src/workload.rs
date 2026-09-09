//! ADR-0027: process-local admission, deadlines and opt-in request/result bytes.
//! Optional inner-join, sort-buffer and distinct-buffer row budgets are
//! cooperative, not hard process isolation.
//!
//! Profiles are explicit and immutable for this controller's lifetime. All
//! requests have one priority; eligible requests are FIFO, skipping a saturated
//! class so it cannot block another class. Operator capacity is a separate pool.
//!
//! Admission telemetry ([`metrics`]) is process-local and observational only:
//! every returned `acquire` result is counted exactly once, queue waits are the
//! measured from enqueue to the terminal scheduling observation, and reading a
//! snapshot never mutates admission.
use crate::access::{ListenerKind, RequestContext};
use oxhttp::model::header::{CACHE_CONTROL, RETRY_AFTER};
use oxhttp::model::{Body, Extensions, Response, StatusCode};
use oxigraph::sparql::{
    CancellationToken, DistinctBufferBudget, InnerJoinBuildBudget, SortBufferBudget,
};
use serde::Deserialize;
use std::collections::{BTreeMap, VecDeque};
use std::fmt;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

mod metrics;
pub use metrics::{AdmissionDisposition, AdmissionMetrics, AdmissionPool, QueueWaitHistogram};

const MAX_PROFILE_BYTES: u64 = 64 * 1024;
// Cooperative queue-token observation, not an end-to-end cancellation claim.
const CANCELLATION_POLL: Duration = Duration::from_millis(10);

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClassLimits {
    pub max_active: usize,
    pub max_queued: usize,
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
/// byte/inner-join build-row/sort-buffer/distinct-buffer row limits, not
/// per-principal fairness or live reload.
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
    retry_after_seconds: u32,
    classes: BTreeMap<String, ClassLimits>,
}

impl WorkloadPolicy {
    /// Bounded JSON read and validation; call before opening a store/listener.
    pub fn load(path: &Path) -> Result<Self, WorkloadError> {
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .and_then(|file| file.take(MAX_PROFILE_BYTES + 1).read_to_end(&mut bytes))
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
            || self.classes.is_empty()
            || self.classes.len() > 16
            || !self.classes.contains_key("default")
            || self.classes.iter().any(|(class, limits)| {
                !name(class)
                    || limits.max_active == 0
                    || limits.max_active > self.max_active
                    || limits.max_queued > self.max_queued
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

#[derive(Default)]
struct State {
    active: usize,
    operator_active: usize,
    classes: BTreeMap<String, usize>,
    queue: VecDeque<Entry>,
    next_id: u64,
}
struct Entry {
    id: u64,
    class: String,
    operator: bool,
    deadline: Instant,
    cancellation: CancellationToken,
}
struct Inner {
    policy: WorkloadPolicy,
    state: Mutex<State>,
    changed: Condvar,
    // Fixed-size telemetry only. Locked after `state` when both are needed and
    // never held across scheduling, storage or transport work.
    metrics: Mutex<AdmissionMetrics>,
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
        if access
            .workload_classes()
            .map_err(|_| WorkloadError::Unavailable)?
            .iter()
            .any(|class| !self.0.policy.classes.contains_key(class))
        {
            return Err(WorkloadError::UnknownClass);
        }
        Ok(())
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
        policy.validate()?;
        Ok(Self(Arc::new(Inner {
            policy,
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
            metrics: Mutex::new(AdmissionMetrics::default()),
        })))
    }

    pub fn from_file(path: &Path) -> Result<Self, WorkloadError> {
        Self::new(WorkloadPolicy::load(path)?)
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
    /// Caller-provided classes/listener kinds are trusted server inputs, never
    /// values copied directly from HTTP headers. No body/storage/egress access.
    pub fn acquire(
        &self,
        class: &str,
        listener: ListenerKind,
        cancellation: CancellationToken,
    ) -> Result<WorkloadLease, WorkloadError> {
        self.acquire_with_abort(class, listener, cancellation, None)
    }

    fn acquire_with_abort(
        &self,
        class: &str,
        listener: ListenerKind,
        cancellation: CancellationToken,
        abort: Option<&oxhttp::AdmissionAbort>,
    ) -> Result<WorkloadLease, WorkloadError> {
        let mut queue_wait = None;
        let result = self.try_acquire(class, listener, cancellation, abort, &mut queue_wait);
        self.record(listener, &result, queue_wait);
        result
    }

    /// `queue_wait` is set only when the request entered the queue: from its
    /// locked enqueue to the locked scheduling pass that decided its result.
    fn try_acquire(
        &self,
        class: &str,
        listener: ListenerKind,
        cancellation: CancellationToken,
        abort: Option<&oxhttp::AdmissionAbort>,
        queue_wait: &mut Option<Duration>,
    ) -> Result<WorkloadLease, WorkloadError> {
        let now = Instant::now();
        let cancellation = if let Some(timeout) = self.0.policy.request_timeout_ms {
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
        let mut state = self.lock()?;
        let entry = self.entry(&mut state, class, listener, cancellation, now)?;
        Self::purge(&mut state, Instant::now());
        if self.available(&state, &entry) && self.first_eligible(&state, entry.operator).is_none() {
            if abort.is_some_and(oxhttp::AdmissionAbort::is_aborted) {
                entry.cancellation.cancel();
            }
            return self.activate(&mut state, &entry);
        }
        self.check_queue_capacity(&state, &entry)?;
        let id = entry.id;
        let deadline = entry.deadline;
        let cancellation = entry.cancellation.clone();
        state.queue.push_back(entry);
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
            if self.first_eligible(&state, operator) == Some(id) {
                let index = state
                    .queue
                    .iter()
                    .position(|entry| entry.id == id)
                    .ok_or(WorkloadError::Unavailable)?;
                let entry = state
                    .queue
                    .remove(index)
                    .ok_or(WorkloadError::Unavailable)?;
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
        let result = context
            .get::<RequestContext>()
            .ok_or(WorkloadError::MissingAccessContext)
            .and_then(|access| {
                self.acquire_with_abort(
                    &access.grant().workload_class,
                    listener,
                    CancellationToken::new(),
                    abort,
                )
            });
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
                context.insert(oxhttp::RequestLifetime::new(lease.clone()));
                context.insert(lease);
                Ok(())
            }
            Err(error) => Err(Box::new(self.denial(error))),
        }
    }

    pub fn denial(&self, error: WorkloadError) -> Response<Body> {
        let class = error == WorkloadError::Overloaded(AdmissionScope::Class);
        let mut response = Response::builder()
            .status(if class {
                StatusCode::TOO_MANY_REQUESTS
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            })
            .header(CACHE_CONTROL, "no-store");
        if class {
            response = response.header(RETRY_AFTER, self.0.policy.retry_after_seconds);
        }
        response.body(Body::empty()).unwrap()
    }

    fn entry(
        &self,
        state: &mut State,
        class: &str,
        listener: ListenerKind,
        cancellation: CancellationToken,
        now: Instant,
    ) -> Result<Entry, WorkloadError> {
        if !self.0.policy.classes.contains_key(class) {
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
        Ok(Entry {
            id,
            class: class.into(),
            operator: listener == ListenerKind::Operator,
            deadline: now
                .checked_add(Duration::from_millis(self.0.policy.queue_timeout_ms))
                .ok_or(WorkloadError::InvalidPolicy)?,
            cancellation,
        })
    }

    fn available(&self, state: &State, entry: &Entry) -> bool {
        if entry.operator {
            state.operator_active < self.0.policy.operator_max_active
        } else {
            state.active < self.0.policy.max_active
                && state.classes.get(&entry.class).copied().unwrap_or(0)
                    < self.0.policy.classes[&entry.class].max_active
        }
    }

    fn first_eligible(&self, state: &State, operator: bool) -> Option<u64> {
        state
            .queue
            .iter()
            .find(|entry| entry.operator == operator && self.available(state, entry))
            .map(|entry| entry.id)
    }

    fn purge(state: &mut State, now: Instant) {
        state
            .queue
            .retain(|entry| now < entry.deadline && !entry.cancellation.is_cancelled());
    }

    fn check_queue_capacity(&self, state: &State, entry: &Entry) -> Result<(), WorkloadError> {
        let scope = if entry.operator {
            (state.queue.iter().filter(|e| e.operator).count() >= self.0.policy.operator_max_queued)
                .then_some(AdmissionScope::Operator)
        } else if state.queue.iter().filter(|e| !e.operator).count() >= self.0.policy.max_queued {
            Some(AdmissionScope::Global)
        } else if state
            .queue
            .iter()
            .filter(|e| !e.operator && e.class == entry.class)
            .count()
            >= self.0.policy.classes[&entry.class].max_queued
        {
            Some(AdmissionScope::Class)
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
        if entry.operator {
            state.operator_active += 1;
        } else {
            state.active += 1;
            *state.classes.entry(entry.class.clone()).or_default() += 1;
        }
        Ok(WorkloadLease(Arc::new(LeaseInner {
            controller: self.clone(),
            class: entry.class.clone(),
            operator: entry.operator,
            cancellation: entry.cancellation.clone(),
            inner_join_build_budget: self
                .0
                .policy
                .max_inner_join_build_rows
                .map(InnerJoinBuildBudget::new),
            sort_buffer_budget: self
                .0
                .policy
                .max_sort_buffer_rows
                .map(SortBufferBudget::new),
            distinct_buffer_budget: self
                .0
                .policy
                .max_distinct_buffer_rows
                .map(DistinctBufferBudget::new),
        })))
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
        state.queue.retain(|entry| entry.id != self.id);
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
    cancellation: CancellationToken,
    inner_join_build_budget: Option<InnerJoinBuildBudget>,
    sort_buffer_budget: Option<SortBufferBudget>,
    distinct_buffer_budget: Option<DistinctBufferBudget>,
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
    /// Serialized/emitted result bytes; excludes HTTP framing and host memory.
    pub fn result_byte_limit(&self) -> Option<oxhttp::ResponseBodyLimit> {
        self.0
            .controller
            .0
            .policy
            .max_result_bytes
            .map(oxhttp::ResponseBodyLimit)
    }
    /// Immutable request-body bounds for the trusted HTTP admission hook.
    pub fn request_body_limits(&self) -> Option<oxhttp::RequestBodyLimits> {
        self.0
            .controller
            .0
            .policy
            .request_body_limits
            .map(Into::into)
    }
    pub fn deadline(&self) -> Option<Instant> {
        self.0.cancellation.deadline()
    }

    /// A synchronous cooperative checkpoint, including the final precommit check.
    /// Returning after CommitAttempted cannot prove rollback of that attempt.
    pub fn check(&self) -> Result<(), WorkloadError> {
        match self.0.cancellation.cancellation_reason() {
            Some(oxigraph::sparql::CancellationReason::TimedOut) => {
                Err(WorkloadError::RequestTimedOut)
            }
            Some(oxigraph::sparql::CancellationReason::Cancelled) => Err(WorkloadError::Cancelled),
            None => Ok(()),
        }
    }
    pub fn policy_id(&self) -> &str {
        &self.0.controller.0.policy.policy_id
    }
    pub fn policy_version(&self) -> u64 {
        self.0.controller.0.policy.version
    }
    pub fn cancellation_token(&self) -> &CancellationToken {
        &self.0.cancellation
    }
}
impl Drop for LeaseInner {
    fn drop(&mut self) {
        let mut state = self
            .controller
            .0
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if self.operator {
            state.operator_active -= 1;
        } else {
            state.active -= 1;
            *state.classes.get_mut(&self.class).unwrap() -= 1;
        }
        self.controller.0.changed.notify_all();
    }
}

#[cfg(test)]
mod tests;
