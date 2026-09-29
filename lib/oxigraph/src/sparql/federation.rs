//! Bounded, opt-in observations of the built-in HTTP `SERVICE` consumer.
use crate::http::{EgressBody, EgressErrorKind};
use crate::model::NamedNode;
use spareval::{QueryEvaluationError, QuerySolution};
use std::error::Error;
use std::fmt;
use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

mod catalog;

use self::catalog::{CatalogCounters, EndpointSlot};
pub use self::catalog::{
    HttpServiceActualCounters, HttpServiceCatalog, HttpServiceCatalogError,
    HttpServiceCatalogSnapshot, HttpServiceEndpointDeclaration, HttpServiceEndpointObservation,
};

/// The largest number of invocation records one report may retain.
const MAXIMUM_RETAINED_ATTEMPTS: usize = 1024;

/// The invocation has not yet been attributed to a catalog view.
const TARGET_UNATTRIBUTED: u32 = u32::MAX;

/// The invocation targets an endpoint the catalog does not list.
const TARGET_UNCATALOGED: u32 = u32::MAX - 1;

/// The fixed execution profile of the built-in `SERVICE` consumer.
///
/// The built-in handler issues one unplanned SPARQL Protocol request per
/// logical invocation, against the endpoint the query already fixed. This is
/// not a source-selection, endpoint-catalog, or bound-join claim: no estimate,
/// batching fallback, or endpoint choice is reported.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum HttpServiceExecutionProfile {
    /// One remote request per explicit `SERVICE` invocation.
    UnplannedHttpV1,
}

impl HttpServiceExecutionProfile {
    /// The stable profile name.
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UnplannedHttpV1 => "unplanned-http-v1",
        }
    }
}

impl fmt::Display for HttpServiceExecutionProfile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The logical state of one built-in `SERVICE` invocation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum HttpServiceInvocationState {
    /// The invocation is still observable: its result stream is alive.
    InProgress,
    /// The remote result iterator reached EOF without a failure.
    Completed,
    /// The invocation failed once, with a fixed typed category.
    Failed,
    /// The invocation was dropped before completion or an observed failure.
    Abandoned,
}

/// The fixed failure category of a [`Failed`](HttpServiceInvocationState::Failed)
/// invocation.
///
/// These are typed classes only. No error text, destination, query text, or
/// payload is retained.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum HttpServiceFailure {
    /// The request-wide cancellation token was observed at the handler
    /// boundary. It is fatal even for `SERVICE SILENT`.
    Cancelled,
    /// The request-wide deadline was observed at the handler boundary. It is
    /// fatal even for `SERVICE SILENT`.
    TimedOut,
    /// The governed egress boundary reported this bounded category. A remote
    /// [`Timeout`](EgressErrorKind::Timeout) here keeps its existing
    /// `SERVICE SILENT` eligibility.
    Egress(EgressErrorKind),
    /// The response media type was unsupported, the results stream was not a
    /// solutions stream, or the remote results parser failed.
    ResultStream,
}

/// One retained built-in `SERVICE` invocation.
///
/// Every field is a fixed-size number, a fixed class, or a duration. No
/// endpoint IRI, endpoint hash, query text, variable, RDF term, credential,
/// HTTP or error text, or user identifier is retained here or in `Debug`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HttpServiceInvocationRecord {
    id: u64,
    profile: HttpServiceExecutionProfile,
    state: HttpServiceInvocationState,
    failure: Option<HttpServiceFailure>,
    dispatches: u64,
    decoded_bytes: u64,
    rows: u64,
    elapsed: Duration,
}

impl HttpServiceInvocationRecord {
    /// The report-local invocation number, increasing in handler-entry order.
    ///
    /// It exists so a local test can reconcile records with the requests an
    /// endpoint fixture observed. It is not an endpoint identity, a
    /// source-selection choice, or a catalog key.
    #[inline]
    pub const fn id(&self) -> u64 {
        self.id
    }

    /// The fixed execution profile of this invocation.
    #[inline]
    pub const fn profile(&self) -> HttpServiceExecutionProfile {
        self.profile
    }

    /// The logical state. Only [`InProgress`](HttpServiceInvocationState::InProgress)
    /// can still change.
    #[inline]
    pub const fn state(&self) -> HttpServiceInvocationState {
        self.state
    }

    /// The typed failure category, present exactly when the state is
    /// [`Failed`](HttpServiceInvocationState::Failed).
    #[inline]
    pub const fn failure(&self) -> Option<HttpServiceFailure> {
        self.failure
    }

    /// HTTP-client dispatches made after policy admission.
    ///
    /// Denial before send counts zero. The governed profile denies redirects,
    /// but a legacy unrestricted client may still follow them internally, so
    /// this is neither a network-request count nor total wire traffic.
    #[inline]
    pub const fn dispatches(&self) -> u64 {
        self.dispatches
    }

    /// Bytes the governed response body successfully delivered to the results
    /// parser.
    ///
    /// This includes parser read-ahead and syntax bytes. It excludes headers,
    /// compressed wire size, and bytes refused by the decoded-response limit.
    /// No encoded-byte count is derived from `Content-Length`.
    #[inline]
    pub const fn decoded_bytes(&self) -> u64 {
        self.decoded_bytes
    }

    /// Solutions the remote results parser produced, before local
    /// compatibility filtering.
    ///
    /// These are not final query rows, and may be nonzero for a failed
    /// `SERVICE SILENT` invocation whose results are discarded atomically.
    #[inline]
    pub const fn rows(&self) -> u64 {
        self.rows
    }

    /// Time from handler entry to the terminal state, or to this snapshot
    /// while the invocation is still in progress.
    #[inline]
    pub const fn elapsed(&self) -> Duration {
        self.elapsed
    }
}

/// A saturating total together with the flag recording that it saturated.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct Counter {
    value: u64,
    saturated: bool,
}

impl Counter {
    fn add(&mut self, amount: u64) {
        if let Some(value) = self.value.checked_add(amount) {
            self.value = value;
        } else {
            self.value = u64::MAX;
            self.saturated = true;
        }
    }
}

/// An internally consistent view of one [`HttpServiceObservation`].
///
/// Totals cover every logical invocation, including those whose record the cap
/// omitted. Each total saturates at `u64::MAX` and carries its own overflow
/// flag; the terminal-state totals are bounded by the attempt total and share
/// its flag. A snapshot is not atomic with the query results, with other
/// metrics, or with durable state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HttpServiceObservationSnapshot {
    profile: HttpServiceExecutionProfile,
    retained_attempt_limit: usize,
    attempts: Counter,
    dispatches: Counter,
    decoded_bytes: Counter,
    rows: Counter,
    completed: Counter,
    failed: Counter,
    abandoned: Counter,
    omitted_records: Counter,
    records: Vec<HttpServiceInvocationRecord>,
    catalog: Option<HttpServiceCatalogSnapshot>,
}

impl HttpServiceObservationSnapshot {
    /// The fixed execution profile every record in this report uses.
    #[inline]
    pub const fn profile(&self) -> HttpServiceExecutionProfile {
        self.profile
    }

    /// The record cap configured on the reporting handle.
    #[inline]
    pub const fn retained_attempt_limit(&self) -> usize {
        self.retained_attempt_limit
    }

    /// Logical attempts: entries into the built-in handler, including entries
    /// the egress policy denied before any network dispatch.
    ///
    /// Unsupported or unbound service names rejected earlier during evaluation
    /// never reach this handler and are outside this report.
    #[inline]
    pub const fn attempts(&self) -> u64 {
        self.attempts.value
    }

    /// Whether the attempt total, and therefore the terminal-state totals,
    /// saturated.
    #[inline]
    pub const fn attempts_saturated(&self) -> bool {
        self.attempts.saturated
    }

    /// HTTP-client dispatches made after policy admission. See
    /// [`HttpServiceInvocationRecord::dispatches`].
    #[inline]
    pub const fn dispatches(&self) -> u64 {
        self.dispatches.value
    }

    /// Whether the dispatch total saturated.
    #[inline]
    pub const fn dispatches_saturated(&self) -> bool {
        self.dispatches.saturated
    }

    /// Bytes delivered to the results parser. See
    /// [`HttpServiceInvocationRecord::decoded_bytes`].
    #[inline]
    pub const fn decoded_bytes(&self) -> u64 {
        self.decoded_bytes.value
    }

    /// Whether the decoded-byte total saturated.
    #[inline]
    pub const fn decoded_bytes_saturated(&self) -> bool {
        self.decoded_bytes.saturated
    }

    /// Remote parser solutions. See [`HttpServiceInvocationRecord::rows`].
    #[inline]
    pub const fn rows(&self) -> u64 {
        self.rows.value
    }

    /// Whether the row total saturated.
    #[inline]
    pub const fn rows_saturated(&self) -> bool {
        self.rows.saturated
    }

    /// Invocations whose remote result iterator reached EOF without a failure.
    #[inline]
    pub const fn completed(&self) -> u64 {
        self.completed.value
    }

    /// Invocations that failed. Each failure is counted exactly once.
    #[inline]
    pub const fn failed(&self) -> u64 {
        self.failed.value
    }

    /// Invocations dropped before completion or an observed failure.
    #[inline]
    pub const fn abandoned(&self) -> u64 {
        self.abandoned.value
    }

    /// Invocations that were still observable when this snapshot was taken.
    #[inline]
    pub const fn in_progress(&self) -> u64 {
        self.attempts
            .value
            .saturating_sub(self.completed.value)
            .saturating_sub(self.failed.value)
            .saturating_sub(self.abandoned.value)
    }

    /// Invocations whose record was not retained because the cap was full.
    ///
    /// Cap exhaustion keeps every aggregate total and never fails or changes
    /// the query.
    #[inline]
    pub const fn omitted_records(&self) -> u64 {
        self.omitted_records.value
    }

    /// Whether the omitted-record total saturated.
    #[inline]
    pub const fn omitted_records_saturated(&self) -> bool {
        self.omitted_records.saturated
    }

    /// The retained records, in handler-entry order.
    #[inline]
    pub fn records(&self) -> &[HttpServiceInvocationRecord] {
        &self.records
    }

    /// The per-endpoint catalog view, present only for a handle created with
    /// [`HttpServiceObservation::with_catalog`].
    #[inline]
    pub const fn catalog(&self) -> Option<&HttpServiceCatalogSnapshot> {
        self.catalog.as_ref()
    }
}

/// A redacted error returned for an unsupported observation configuration.
pub struct HttpServiceObservationConfigurationError {
    reason: &'static str,
}

impl HttpServiceObservationConfigurationError {
    const fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}

impl fmt::Debug for HttpServiceObservationConfigurationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpServiceObservationConfigurationError")
            .field("reason", &self.reason)
            .finish()
    }
}

impl fmt::Display for HttpServiceObservationConfigurationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid HTTP SERVICE observation: {}", self.reason)
    }
}

impl Error for HttpServiceObservationConfigurationError {}

/// A bounded, opt-in execution report for the built-in HTTP `SERVICE` handler.
///
/// The handle is cloneable and explicitly cumulative: evaluator clones,
/// prepared queries, and every execution the caller attaches it to add to the
/// same report. Create one handle per logical query when query-local
/// attribution is wanted. There is no automatic reset, no reset operation that
/// could erase observations while result streams are alive, and no report for
/// algebra that was never executed.
///
/// Only the built-in `SERVICE` consumer is reported. `LOAD` and nested-document
/// retrieval are never counted, an explicitly registered custom or named
/// handler keeps its precedence and stays outside this report, and attaching a
/// handle never enables a disabled default HTTP handler.
///
/// [`snapshot`](Self::snapshot) returns fixed-size totals plus at most the
/// configured number of invocation records. Allocation is bounded before
/// retention: once the cap is full, further invocations increment an
/// omitted-record counter while every aggregate total keeps working, and the
/// query is never failed or changed. Totals saturate at `u64::MAX` with an
/// accompanying overflow flag.
///
/// A handle created with [`with_catalog`](Self::with_catalog) additionally
/// attributes every invocation to one declared endpoint, or to one fixed
/// uncataloged aggregate, by exact IRI match. Attribution happens at handler
/// entry, before any request is built, and never affects egress, admission,
/// target, query, error or `SERVICE SILENT` behavior. Per-endpoint counters are
/// allocated once from the catalog and count every dispatch, byte, row and
/// terminal outcome even when the retention cap omits the record.
///
/// Observation performs no callback, network request, file write, or logging.
/// It never drains, retries, or polls results beyond what the caller consumes,
/// and never changes headers, blank-node labels, results, or error disposition.
/// No endpoint IRI, endpoint hash, query text, variable, RDF term, credential,
/// HTTP or error text, or user identifier is retained or shown by `Debug`.
/// Invocation IDs exist only for local reconciliation.
#[derive(Clone)]
pub struct HttpServiceObservation {
    state: Arc<ObservationState>,
}

struct ObservationState {
    retained_attempt_limit: usize,
    catalog: Option<HttpServiceCatalog>,
    data: Mutex<ObservationData>,
}

#[derive(Default)]
struct ObservationData {
    attempts: Counter,
    dispatches: Counter,
    decoded_bytes: Counter,
    rows: Counter,
    completed: Counter,
    failed: Counter,
    abandoned: Counter,
    omitted_records: Counter,
    records: Vec<RetainedInvocation>,
    next_id: u64,
    endpoints: Option<CatalogCounters>,
}

impl ObservationData {
    fn actual(&mut self, endpoint: EndpointSlot) -> Option<&mut HttpServiceActualCounters> {
        self.endpoints.as_mut()?.counters_mut(endpoint)
    }
}

struct RetainedInvocation {
    record: HttpServiceInvocationRecord,
    started: Instant,
}

impl RetainedInvocation {
    fn snapshot(&self) -> HttpServiceInvocationRecord {
        let mut record = self.record;
        if record.state == HttpServiceInvocationState::InProgress {
            record.elapsed = self.started.elapsed();
        }
        record
    }
}

impl HttpServiceObservation {
    /// Creates an empty report retaining at most `retained_attempt_limit`
    /// invocation records.
    ///
    /// Any value in `0..=1024` is accepted; zero retains totals only.
    pub fn new(
        retained_attempt_limit: usize,
    ) -> Result<Self, HttpServiceObservationConfigurationError> {
        Self::build(retained_attempt_limit, None)
    }

    /// Creates an empty report that also attributes invocations to the
    /// endpoints of `catalog`.
    ///
    /// The record cap has the same range as [`new`](Self::new). The catalog is
    /// immutable and only attributes observations: it neither authorizes
    /// egress, selects an endpoint, nor changes any request.
    pub fn with_catalog(
        retained_attempt_limit: usize,
        catalog: HttpServiceCatalog,
    ) -> Result<Self, HttpServiceObservationConfigurationError> {
        Self::build(retained_attempt_limit, Some(catalog))
    }

    fn build(
        retained_attempt_limit: usize,
        catalog: Option<HttpServiceCatalog>,
    ) -> Result<Self, HttpServiceObservationConfigurationError> {
        if retained_attempt_limit > MAXIMUM_RETAINED_ATTEMPTS {
            return Err(HttpServiceObservationConfigurationError::new(
                "at most 1024 invocation records may be retained",
            ));
        }
        let endpoints = catalog
            .as_ref()
            .map(|catalog| CatalogCounters::new(catalog.endpoint_count()));
        Ok(Self {
            state: Arc::new(ObservationState {
                retained_attempt_limit,
                catalog,
                data: Mutex::new(ObservationData {
                    endpoints,
                    ..ObservationData::default()
                }),
            }),
        })
    }

    /// Returns the current totals and retained records.
    ///
    /// Work still in progress is reported as performed so far: an invocation
    /// whose result stream is alive is
    /// [`InProgress`](HttpServiceInvocationState::InProgress) and reports only
    /// the dispatches, bytes, and rows already observed.
    pub fn snapshot(&self) -> HttpServiceObservationSnapshot {
        let data = self.data();
        let catalog = self
            .state
            .catalog
            .as_ref()
            .zip(data.endpoints.as_ref())
            .map(|(catalog, counters)| catalog.snapshot(counters));
        HttpServiceObservationSnapshot {
            profile: HttpServiceExecutionProfile::UnplannedHttpV1,
            retained_attempt_limit: self.state.retained_attempt_limit,
            attempts: data.attempts,
            dispatches: data.dispatches,
            decoded_bytes: data.decoded_bytes,
            rows: data.rows,
            completed: data.completed,
            failed: data.failed,
            abandoned: data.abandoned,
            omitted_records: data.omitted_records,
            records: data
                .records
                .iter()
                .map(RetainedInvocation::snapshot)
                .collect(),
            catalog,
        }
    }

    /// Begins one logical invocation, retaining a record while the cap allows.
    pub(crate) fn begin_invocation(&self) -> Arc<HttpServiceInvocation> {
        let mut data = self.data();
        let id = data.next_id;
        data.next_id = id.saturating_add(1);
        data.attempts.add(1);
        // Retention allocates only below the cap; an omitted invocation still
        // reaches every aggregate total through its slot-less handle.
        let slot = if data.records.len() < self.state.retained_attempt_limit {
            data.records.push(RetainedInvocation {
                record: HttpServiceInvocationRecord {
                    id,
                    profile: HttpServiceExecutionProfile::UnplannedHttpV1,
                    state: HttpServiceInvocationState::InProgress,
                    failure: None,
                    dispatches: 0,
                    decoded_bytes: 0,
                    rows: 0,
                    elapsed: Duration::ZERO,
                },
                started: Instant::now(),
            });
            Some(data.records.len() - 1)
        } else {
            data.omitted_records.add(1);
            None
        };
        drop(data);
        Arc::new(HttpServiceInvocation {
            report: self.clone(),
            slot,
            target: AtomicU32::new(TARGET_UNATTRIBUTED),
            finished: AtomicBool::new(false),
        })
    }

    fn count_attempt(&self, endpoint: EndpointSlot) {
        let mut data = self.data();
        if let Some(actual) = data.actual(endpoint) {
            actual.record_attempt();
        }
    }

    fn count_dispatch(&self, slot: Option<usize>, endpoint: EndpointSlot) {
        let mut data = self.data();
        data.dispatches.add(1);
        if let Some(actual) = data.actual(endpoint) {
            actual.record_dispatch();
        }
        if let Some(retained) = slot.and_then(|slot| data.records.get_mut(slot)) {
            retained.record.dispatches = retained.record.dispatches.saturating_add(1);
        }
    }

    fn count_decoded(&self, slot: Option<usize>, endpoint: EndpointSlot, bytes: u64) {
        let mut data = self.data();
        data.decoded_bytes.add(bytes);
        if let Some(actual) = data.actual(endpoint) {
            actual.record_decoded(bytes);
        }
        if let Some(retained) = slot.and_then(|slot| data.records.get_mut(slot)) {
            retained.record.decoded_bytes = retained.record.decoded_bytes.saturating_add(bytes);
        }
    }

    fn count_row(&self, slot: Option<usize>, endpoint: EndpointSlot) {
        let mut data = self.data();
        data.rows.add(1);
        if let Some(actual) = data.actual(endpoint) {
            actual.record_row();
        }
        if let Some(retained) = slot.and_then(|slot| data.records.get_mut(slot)) {
            retained.record.rows = retained.record.rows.saturating_add(1);
        }
    }

    fn count_finish(
        &self,
        slot: Option<usize>,
        endpoint: EndpointSlot,
        state: HttpServiceInvocationState,
        failure: Option<HttpServiceFailure>,
    ) {
        let mut data = self.data();
        match state {
            HttpServiceInvocationState::Completed => data.completed.add(1),
            HttpServiceInvocationState::Failed => data.failed.add(1),
            HttpServiceInvocationState::Abandoned => data.abandoned.add(1),
            // Only a terminal outcome finishes an invocation.
            HttpServiceInvocationState::InProgress => return,
        }
        if let Some(actual) = data.actual(endpoint) {
            actual.record_terminal(state);
        }
        if let Some(retained) = slot.and_then(|slot| data.records.get_mut(slot)) {
            retained.record.state = state;
            retained.record.failure = failure;
            retained.record.elapsed = retained.started.elapsed();
        }
    }

    fn data(&self) -> MutexGuard<'_, ObservationData> {
        self.state
            .data
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

impl fmt::Debug for HttpServiceObservation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpServiceObservation")
            .field("retained_attempt_limit", &self.state.retained_attempt_limit)
            .field(
                "catalog_endpoints",
                &self
                    .state
                    .catalog
                    .as_ref()
                    .map(HttpServiceCatalog::endpoint_count),
            )
            .finish_non_exhaustive()
    }
}

/// One logical built-in `SERVICE` invocation.
///
/// The request client, the parser input wrapper, and the result iterator share
/// it. Its counters record every observation made for the invocation; only its
/// state is terminal, and exactly one terminal outcome is recorded.
pub(crate) struct HttpServiceInvocation {
    report: HttpServiceObservation,
    slot: Option<usize>,
    target: AtomicU32,
    finished: AtomicBool,
}

impl HttpServiceInvocation {
    /// Attributes this invocation to a catalog endpoint, or to the uncataloged
    /// aggregate, exactly once. It is a no-op without a catalog and never
    /// affects the request.
    pub(crate) fn attribute(&self, endpoint: &NamedNode) {
        let Some(catalog) = &self.report.state.catalog else {
            return;
        };
        let target = catalog
            .ordinal_of(endpoint.as_str())
            .map_or(TARGET_UNCATALOGED, u32::from);
        if self
            .target
            .compare_exchange(
                TARGET_UNATTRIBUTED,
                target,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
        {
            self.report.count_attempt(self.endpoint_slot());
        }
    }

    fn endpoint_slot(&self) -> EndpointSlot {
        match self.target.load(Ordering::Acquire) {
            TARGET_UNATTRIBUTED | TARGET_UNCATALOGED => EndpointSlot::Uncataloged,
            ordinal => EndpointSlot::Endpoint(usize::try_from(ordinal).unwrap_or(usize::MAX)),
        }
    }

    /// Counts one HTTP-client dispatch made after policy admission.
    pub(crate) fn dispatch(&self) {
        self.report.count_dispatch(self.slot, self.endpoint_slot());
    }

    /// Counts bytes the governed body delivered to the results parser.
    pub(crate) fn decoded(&self, bytes: usize) {
        if bytes == 0 {
            return;
        }
        self.report.count_decoded(
            self.slot,
            self.endpoint_slot(),
            u64::try_from(bytes).unwrap_or(u64::MAX),
        );
    }

    /// Counts one solution produced by the remote results parser.
    pub(crate) fn row(&self) {
        self.report.count_row(self.slot, self.endpoint_slot());
    }

    /// Records the remote result iterator reaching EOF without a failure.
    pub(crate) fn complete(&self) {
        self.finish(HttpServiceInvocationState::Completed, None);
    }

    /// Records a typed failure. Every later outcome, including drop, keeps it.
    pub(crate) fn fail(&self, failure: HttpServiceFailure) {
        self.finish(HttpServiceInvocationState::Failed, Some(failure));
    }

    /// Records an invocation whose observers disappeared before an outcome.
    pub(crate) fn abandon(&self) {
        self.finish(HttpServiceInvocationState::Abandoned, None);
    }

    fn finish(&self, state: HttpServiceInvocationState, failure: Option<HttpServiceFailure>) {
        if self.finished.swap(true, Ordering::AcqRel) {
            return; // A terminal outcome is recorded exactly once.
        }
        self.report
            .count_finish(self.slot, self.endpoint_slot(), state, failure);
    }
}

impl Drop for HttpServiceInvocation {
    fn drop(&mut self) {
        // The last observer disappeared without a terminal outcome. An outer
        // cancellation may have dropped the iterator before this handler saw
        // an error, so do not invent knowledge of that outer terminal reason.
        self.abandon();
    }
}

/// Counts the bytes a governed response body delivers to the results parser.
pub(crate) struct ObservedBody {
    inner: EgressBody,
    invocation: Option<Arc<HttpServiceInvocation>>,
}

impl ObservedBody {
    pub(crate) fn new(inner: EgressBody, invocation: Option<Arc<HttpServiceInvocation>>) -> Self {
        Self { inner, invocation }
    }
}

impl Read for ObservedBody {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        // Only bytes the body successfully returned are counted: a refused or
        // failed read delivers nothing to the parser. The body still releases
        // itself and its admission permit on EOF, failure, and drop.
        let read = self.inner.read(buf)?;
        if let Some(invocation) = &self.invocation {
            invocation.decoded(read);
        }
        Ok(read)
    }
}

/// Counts remote solutions and guards the terminal state of an invocation.
pub(crate) struct ObservedSolutions<I> {
    inner: I,
    invocation: Option<Arc<HttpServiceInvocation>>,
}

impl<I> ObservedSolutions<I> {
    pub(crate) fn new(inner: I, invocation: Option<Arc<HttpServiceInvocation>>) -> Self {
        Self { inner, invocation }
    }
}

impl<I: Iterator<Item = Result<QuerySolution, QueryEvaluationError>>> Iterator
    for ObservedSolutions<I>
{
    type Item = I::Item;

    fn next(&mut self) -> Option<Self::Item> {
        let item = self.inner.next();
        if let Some(invocation) = &self.invocation {
            match &item {
                Some(Ok(_)) => invocation.row(),
                // The handler's own error mapping already classified this.
                Some(Err(_)) => {}
                None => invocation.complete(),
            }
        }
        item
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<I> Drop for ObservedSolutions<I> {
    fn drop(&mut self) {
        // A partially consumed stream is abandoned even if the body was read
        // ahead. A finished invocation keeps its existing terminal outcome.
        if let Some(invocation) = &self.invocation {
            invocation.abandon();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(retained_attempt_limit: usize) -> HttpServiceObservation {
        HttpServiceObservation::new(retained_attempt_limit).unwrap()
    }

    fn catalog_report(retained_attempt_limit: usize) -> HttpServiceObservation {
        let catalog = HttpServiceCatalog::new(vec![
            HttpServiceEndpointDeclaration::new(NamedNode::new_unchecked("http://a.test/sparql"))
                .with_expected_rows(5),
            HttpServiceEndpointDeclaration::new(NamedNode::new_unchecked("http://b.test/sparql")),
        ])
        .unwrap();
        HttpServiceObservation::with_catalog(retained_attempt_limit, catalog).unwrap()
    }

    #[test]
    fn the_accepted_record_cap_range_is_zero_to_one_thousand_and_twenty_four() {
        assert_eq!(report(0).snapshot().retained_attempt_limit(), 0);
        assert_eq!(
            report(MAXIMUM_RETAINED_ATTEMPTS)
                .snapshot()
                .retained_attempt_limit(),
            MAXIMUM_RETAINED_ATTEMPTS
        );
        assert_eq!(
            HttpServiceObservation::new(MAXIMUM_RETAINED_ATTEMPTS + 1)
                .unwrap_err()
                .to_string(),
            "invalid HTTP SERVICE observation: at most 1024 invocation records may be retained"
        );
    }

    #[test]
    fn a_terminal_outcome_is_recorded_exactly_once() {
        let report = report(4);
        let invocation = report.begin_invocation();
        invocation.dispatch();
        invocation.decoded(7);
        invocation.row();
        invocation.complete();
        invocation.fail(HttpServiceFailure::ResultStream);
        invocation.abandon();
        drop(invocation);
        let snapshot = report.snapshot();
        assert_eq!(snapshot.attempts(), 1);
        assert_eq!(snapshot.completed(), 1);
        assert_eq!(snapshot.failed(), 0);
        assert_eq!(snapshot.abandoned(), 0);
        assert_eq!(snapshot.in_progress(), 0);
        assert_eq!(snapshot.dispatches(), 1);
        assert_eq!(snapshot.decoded_bytes(), 7);
        assert_eq!(snapshot.rows(), 1);
        assert_eq!(snapshot.records().len(), 1);
        assert_eq!(
            snapshot.records()[0].state(),
            HttpServiceInvocationState::Completed
        );
        assert_eq!(snapshot.records()[0].failure(), None);
        assert_eq!(
            snapshot.records()[0].profile(),
            HttpServiceExecutionProfile::UnplannedHttpV1
        );
        assert_eq!(
            snapshot.profile(),
            HttpServiceExecutionProfile::UnplannedHttpV1
        );
    }

    #[test]
    fn a_failure_stays_failed_after_drop() {
        let report = report(4);
        let invocation = report.begin_invocation();
        invocation.row();
        invocation.fail(HttpServiceFailure::Egress(EgressErrorKind::PolicyDenied));
        drop(invocation);
        let snapshot = report.snapshot();
        assert_eq!(snapshot.failed(), 1);
        assert_eq!(snapshot.abandoned(), 0);
        assert_eq!(snapshot.rows(), 1);
        assert_eq!(snapshot.dispatches(), 0);
        assert_eq!(
            snapshot.records()[0].failure(),
            Some(HttpServiceFailure::Egress(EgressErrorKind::PolicyDenied))
        );
    }

    #[test]
    fn a_dropped_invocation_without_an_outcome_is_abandoned() {
        let report = report(4);
        let invocation = report.begin_invocation();
        invocation.dispatch();
        let pending = report.snapshot();
        assert_eq!(pending.in_progress(), 1);
        assert_eq!(
            pending.records()[0].state(),
            HttpServiceInvocationState::InProgress
        );
        drop(invocation);
        let snapshot = report.snapshot();
        assert_eq!(snapshot.abandoned(), 1);
        assert_eq!(snapshot.in_progress(), 0);
        assert_eq!(
            snapshot.records()[0].state(),
            HttpServiceInvocationState::Abandoned
        );
    }

    #[test]
    fn exhausting_the_record_cap_keeps_aggregate_totals() {
        for (limit, omitted) in [(0_usize, 3_u64), (1, 2)] {
            let report = report(limit);
            for _ in 0..3 {
                let invocation = report.begin_invocation();
                invocation.dispatch();
                invocation.decoded(5);
                invocation.complete();
            }
            let snapshot = report.snapshot();
            assert_eq!(snapshot.retained_attempt_limit(), limit);
            assert_eq!(snapshot.records().len(), limit);
            assert_eq!(snapshot.attempts(), 3);
            assert_eq!(snapshot.completed(), 3);
            assert_eq!(snapshot.dispatches(), 3);
            assert_eq!(snapshot.decoded_bytes(), 15);
            assert_eq!(snapshot.omitted_records(), omitted);
        }
    }

    #[test]
    fn distinct_handles_do_not_share_observations() {
        let first = report(2);
        let second = report(2);
        first.begin_invocation().complete();
        assert_eq!(first.snapshot().attempts(), 1);
        assert_eq!(second.snapshot().attempts(), 0);
        assert!(second.snapshot().records().is_empty());
        // Clones are explicitly cumulative on the same report.
        let clone = first.clone();
        clone.begin_invocation().complete();
        assert_eq!(first.snapshot().attempts(), 2);
        assert_eq!(first.snapshot().records().len(), 2);
        assert_eq!(first.snapshot().records()[0].id(), 0);
        assert_eq!(first.snapshot().records()[1].id(), 1);
    }

    #[test]
    fn totals_saturate_with_an_overflow_flag() {
        let report = report(1);
        let invocation = report.begin_invocation();
        report.count_decoded(invocation.slot, EndpointSlot::Uncataloged, u64::MAX);
        report.count_decoded(invocation.slot, EndpointSlot::Uncataloged, u64::MAX);
        invocation.complete();
        let snapshot = report.snapshot();
        assert_eq!(snapshot.decoded_bytes(), u64::MAX);
        assert!(snapshot.decoded_bytes_saturated());
        assert_eq!(snapshot.records()[0].decoded_bytes(), u64::MAX);
        assert!(!snapshot.attempts_saturated());
        assert!(!snapshot.rows_saturated());
        assert!(!snapshot.dispatches_saturated());
        assert!(!snapshot.omitted_records_saturated());
    }

    #[test]
    fn rendered_state_carries_no_destination_or_payload() {
        let report = report(1);
        let invocation = report.begin_invocation();
        invocation.dispatch();
        invocation.fail(HttpServiceFailure::TimedOut);
        let rendered = format!("{report:?} {:?}", report.snapshot());
        assert!(!rendered.contains("://"));
        assert!(!rendered.contains("SELECT"));
        assert!(rendered.contains("TimedOut"));
        assert_eq!(
            HttpServiceExecutionProfile::UnplannedHttpV1.to_string(),
            "unplanned-http-v1"
        );
        assert_eq!(
            HttpServiceExecutionProfile::UnplannedHttpV1.as_str(),
            "unplanned-http-v1"
        );
    }

    #[test]
    fn per_endpoint_counters_ignore_the_retention_slot() {
        let report = catalog_report(0);
        let invocation = report.begin_invocation();
        invocation.attribute(&NamedNode::new_unchecked("http://b.test/sparql"));
        invocation.dispatch();
        invocation.decoded(7);
        invocation.row();
        invocation.complete();
        invocation.fail(HttpServiceFailure::ResultStream);
        invocation.abandon();
        drop(invocation);
        let snapshot = report.snapshot();
        assert_eq!(snapshot.omitted_records(), 1);
        assert!(snapshot.records().is_empty());
        let catalog = snapshot.catalog().unwrap();
        assert_eq!(catalog.schema_version(), 1);
        assert_eq!(catalog.endpoints().len(), 2);
        let first = &catalog.endpoints()[0];
        assert_eq!(first.ordinal(), 0);
        assert_eq!(first.declared_expected_rows(), Some(5));
        assert_eq!(first.actual().attempts(), 0);
        let second = &catalog.endpoints()[1];
        assert_eq!(second.ordinal(), 1);
        assert_eq!(second.declared_expected_rows(), None);
        let actual = second.actual();
        assert_eq!(actual.attempts(), 1);
        assert_eq!(actual.dispatches(), 1);
        assert_eq!(actual.decoded_bytes(), 7);
        assert_eq!(actual.rows(), 1);
        assert_eq!(actual.completed(), 1);
        assert_eq!(actual.failed(), 0);
        assert_eq!(actual.abandoned(), 0);
        assert_eq!(actual.in_progress(), 0);
        assert_eq!(catalog.uncataloged().attempts(), 0);
    }

    #[test]
    fn unlisted_endpoints_share_one_aggregate_and_attribution_is_once() {
        let report = catalog_report(4);
        let invocation = report.begin_invocation();
        invocation.attribute(&NamedNode::new_unchecked("http://c.test/sparql"));
        invocation.attribute(&NamedNode::new_unchecked("http://a.test/sparql"));
        invocation.dispatch();
        drop(invocation);
        let snapshot = report.snapshot();
        let catalog = snapshot.catalog().unwrap();
        assert_eq!(catalog.endpoints()[0].actual().attempts(), 0);
        assert_eq!(catalog.uncataloged().attempts(), 1);
        assert_eq!(catalog.uncataloged().dispatches(), 1);
        assert_eq!(catalog.uncataloged().abandoned(), 1);
    }

    #[test]
    fn without_a_catalog_no_endpoint_view_exists() {
        let report = report(4);
        let invocation = report.begin_invocation();
        invocation.attribute(&NamedNode::new_unchecked("http://a.test/sparql"));
        invocation.complete();
        assert!(report.snapshot().catalog().is_none());
        assert_eq!(report.snapshot().attempts(), 1);
    }
}
