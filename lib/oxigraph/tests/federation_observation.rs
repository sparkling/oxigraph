//! Independent oracle for the bounded, opt-in HTTP `SERVICE` observation report.
//!
//! Every case here drives the public boundary only: an `HttpServiceObservation`
//! handle attached to a `SparqlEvaluator`, executed against the hermetic loopback
//! fixtures already used by `sparql_service_http.rs`. Observed counts are always
//! reconciled against two independent witnesses: the requests the test endpoint
//! actually served, and the same literal query executed with the report detached.
//!
//! The report is a measurement boundary, not a planner: no case here asserts an
//! optimization, an elapsed-time win, an endpoint choice, or a catalog claim.
//!
//! The report's public type names are frozen by the task contract, but the
//! snapshot's accessor names are not. Every read of a snapshot therefore goes
//! through the clearly delimited helper block below, each entry marked
//! `TODO(root-bind)`, so the root can bind final accessor names without touching
//! a single assertion.
//!
//! Two completion-criteria legs are deliberately out of this crate's reach and
//! are covered by the root's admitted command list instead:
//!   * the statistics/text-index/spatial-index handler rebinding preserving the
//!     same retained client field, which is a source-inspection plus
//!     `cargo check --features http-client,statistics,text-index,spatial-index --lib`
//!     obligation (those features pull in RocksDB and are not enabled for this
//!     test target);
//!   * the `cfg`-disabled build, covered by `cargo check --no-default-features --lib`.

#![cfg(all(test, feature = "http-client", not(target_family = "wasm")))]
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "this integration-test crate directly exposes executable conformance cases"
)]

#[path = "sparql_service_http/support.rs"]
mod support;

use oxigraph::model::{Literal, NamedNode, OxString, Term, Variable};
use oxigraph::sparql::{
    CancellationToken, DefaultServiceHandler, EgressErrorKind, EgressPolicy, HttpServiceObservation,
    HttpServiceFailure, HttpServiceInvocationState, HttpServiceObservationConfigurationError,
    HttpServiceObservationSnapshot, QueryEvaluationError, QueryResults, QuerySolution,
    QuerySolutionIter, SparqlEvaluator,
};
use oxigraph::store::Store;
use oxiri::Iri;
use spargebra::algebra::QueryExpression;
use std::convert::Infallible;
use std::error::Error;
use std::io;
use std::net::{IpAddr, Ipv4Addr, TcpListener};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
use support::{ObservedRequest, ResponseSpec, TestEndpoint};

// ---------------------------------------------------------------------------
// TODO(root-bind): snapshot accessor bindings.
//
// Everything between this banner and the closing banner is the only code in this
// file that names a snapshot accessor. The assertions below never touch the
// report type directly. Rebinding a renamed accessor is a one-line edit here.
// ---------------------------------------------------------------------------

/// Terminal and non-terminal record states, mirrored locally so assertions do
/// not depend on the report enum's spelling.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RecordState {
    Completed,
    Failed,
    Abandoned,
    InProgress,
}

/// Fixed-size totals read out of one snapshot, compared as a unit whenever a
/// test needs "these counters did not move".
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Totals {
    attempts: u64,
    dispatches: u64,
    decoded_bytes: u64,
    rows: u64,
    completed: u64,
    failed: u64,
    abandoned: u64,
    in_progress: u64,
}

/// TODO(root-bind): total logical attempts, one per entry into the built-in handler.
fn attempts(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.attempts()
}

/// TODO(root-bind): total admitted HTTP-client dispatches.
fn dispatches(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.dispatches()
}

/// TODO(root-bind): total bytes handed to the results-parser input wrapper.
fn decoded_bytes(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.decoded_bytes()
}

/// TODO(root-bind): total solution items produced by the remote results parser.
fn rows(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.rows()
}

/// TODO(root-bind): attempts that observed EOF without failure.
fn completed(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.completed()
}

/// TODO(root-bind): attempts terminated by a setup, transport or parser failure.
fn failed(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.failed()
}

/// TODO(root-bind): attempts whose partially consumed stream was dropped.
fn abandoned(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.abandoned()
}

/// TODO(root-bind): attempts whose result stream is still alive.
fn in_progress(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.in_progress()
}

/// TODO(root-bind): number of retained invocation records.
fn retained_records(snapshot: &HttpServiceObservationSnapshot) -> usize {
    snapshot.records().len()
}

/// TODO(root-bind): attempts dropped by the retention cap.
fn omitted_records(snapshot: &HttpServiceObservationSnapshot) -> u64 {
    snapshot.omitted_records()
}

/// TODO(root-bind): retained record state.
fn record_state(
    snapshot: &HttpServiceObservationSnapshot,
    index: usize,
) -> Option<RecordState> {
    Some(match snapshot.records().get(index)?.state() {
        HttpServiceInvocationState::Completed => RecordState::Completed,
        HttpServiceInvocationState::Failed => RecordState::Failed,
        HttpServiceInvocationState::Abandoned => RecordState::Abandoned,
        HttpServiceInvocationState::InProgress => RecordState::InProgress,
        // The report enum is non-exhaustive; a state this oracle does not know
        // must fail the assertion that reads it rather than be guessed.
        _ => return None,
    })
}

/// TODO(root-bind): retained record numeric invocation ID.
fn record_id(snapshot: &HttpServiceObservationSnapshot, index: usize) -> Option<u64> {
    Some(snapshot.records().get(index)?.id())
}

/// TODO(root-bind): retained record execution profile.
fn record_profile(snapshot: &HttpServiceObservationSnapshot, index: usize) -> Option<String> {
    Some(snapshot.records().get(index)?.profile().as_str().to_owned())
}

/// TODO(root-bind): retained record HTTP-client dispatches.
fn record_dispatches(snapshot: &HttpServiceObservationSnapshot, index: usize) -> Option<u64> {
    Some(snapshot.records().get(index)?.dispatches())
}

/// TODO(root-bind): retained record decoded bytes.
fn record_decoded_bytes(snapshot: &HttpServiceObservationSnapshot, index: usize) -> Option<u64> {
    Some(snapshot.records().get(index)?.decoded_bytes())
}

/// TODO(root-bind): retained record parsed rows.
fn record_rows(snapshot: &HttpServiceObservationSnapshot, index: usize) -> Option<u64> {
    Some(snapshot.records().get(index)?.rows())
}

/// TODO(root-bind): whether a failed record was classified as a policy denial.
fn record_failure_is_policy_denial(
    snapshot: &HttpServiceObservationSnapshot,
    index: usize,
) -> Option<bool> {
    Some(matches!(
        snapshot.records().get(index)?.failure(),
        Some(HttpServiceFailure::Egress(EgressErrorKind::PolicyDenied))
    ))
}

/// TODO(root-bind): whether a failed record was classified as a remote timeout.
fn record_failure_is_timeout(
    snapshot: &HttpServiceObservationSnapshot,
    index: usize,
) -> Option<bool> {
    Some(matches!(
        snapshot.records().get(index)?.failure(),
        Some(HttpServiceFailure::Egress(EgressErrorKind::Timeout))
    ))
}

/// TODO(root-bind): the report handle's own `Debug` rendering.
fn observation_debug(observation: &HttpServiceObservation) -> String {
    format!("{observation:?}")
}

/// TODO(root-bind): a snapshot's `Debug` rendering.
fn snapshot_debug(snapshot: &HttpServiceObservationSnapshot) -> String {
    format!("{snapshot:?}")
}

// ---------------------------------------------------------------------------
// End of TODO(root-bind) block. No assertion below names a snapshot accessor.
// ---------------------------------------------------------------------------

/// Reads all fixed-size totals out of one snapshot.
fn totals(snapshot: &HttpServiceObservationSnapshot) -> Totals {
    Totals {
        attempts: attempts(snapshot),
        dispatches: dispatches(snapshot),
        decoded_bytes: decoded_bytes(snapshot),
        rows: rows(snapshot),
        completed: completed(snapshot),
        failed: failed(snapshot),
        abandoned: abandoned(snapshot),
        in_progress: in_progress(snapshot),
    }
}

static LOOPBACK_TEST_LOCK: Mutex<()> = Mutex::new(());

const JSON_MEDIA_TYPE: &str = "application/sparql-results+json";
const XML_MEDIA_TYPE: &str = "application/sparql-results+xml";

const JSON_ONE_ROW: &str =
    r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"alpha"}}]}}"#;

const JSON_TWO_ROWS: &str = r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"alpha"}},{"remote":{"type":"literal","value":"beta"}}]}}"#;

const JSON_THREE_ROWS: &str = r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"alpha"}},{"remote":{"type":"literal","value":"beta"}},{"remote":{"type":"literal","value":"gamma"}}]}}"#;

const XML_ONE_ROW: &str = r#"<?xml version="1.0"?>
<sparql xmlns="http://www.w3.org/2005/sparql-results#">
  <head><variable name="remote"/></head>
  <results><result><binding name="remote"><literal>alpha</literal></binding></result></results>
</sparql>"#;

const JSON_SAME_LABEL_BNODE: &str =
    r#"{"head":{"vars":["node"]},"results":{"bindings":[{"node":{"type":"bnode","value":"same-label"}}]}}"#;

/// One complete solution followed by a syntactically truncated one. The fixture
/// still sends a well-formed HTTP response, so the failure is a results-parser
/// failure observed after one row has already been produced.
const JSON_TRUNCATED_AFTER_FIRST_ROW: &str = r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"alpha"}},{"remote":{"type":"lit"#;

const SECRET_TOKEN: &str = "s3cr3t-oracle-token";
const SECRET_PAYLOAD: &str = "s3cr3t-oracle-payload";
const JSON_SECRET_PAYLOAD: &str =
    r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"s3cr3t-oracle-payload"}}]}}"#;

fn loopback_test_lock() -> MutexGuard<'static, ()> {
    LOOPBACK_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn byte_len(body: &str) -> u64 {
    u64::try_from(body.len()).unwrap_or(u64::MAX)
}

fn evaluator_with(observation: &HttpServiceObservation) -> SparqlEvaluator {
    SparqlEvaluator::new().with_http_service_observation(observation.clone())
}

/// Executes a `SELECT`, keeping the evaluation error typed so SILENT eligibility
/// and fatal disposition can be asserted directly.
fn evaluate(
    evaluator: SparqlEvaluator,
    query: &str,
    store: &Store,
) -> Result<Result<Vec<QuerySolution>, QueryEvaluationError>, Box<dyn Error>> {
    let bound = evaluator.parse_query(query)?.on_store(store);
    Ok(match bound.execute() {
        Ok(QueryResults::Solutions(solutions)) => solutions.collect::<Result<Vec<_>, _>>(),
        Ok(_) => {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "expected SELECT results").into());
        }
        Err(error) => Err(error),
    })
}

fn select(evaluator: SparqlEvaluator, query: &str) -> Result<Vec<QuerySolution>, Box<dyn Error>> {
    let store = Store::new()?;
    Ok(evaluate(evaluator, query, &store)??)
}

fn column(solutions: &[QuerySolution], variable: &str) -> Vec<Option<Term>> {
    solutions
        .iter()
        .map(|solution| solution.get(variable).cloned())
        .collect()
}

fn origin(iri: &str) -> String {
    let authority_end = iri["http://".len()..]
        .find('/')
        .map_or(iri.len(), |offset| offset + "http://".len());
    iri[..authority_end].to_owned()
}

fn allowed_policy(iri: &str) -> Result<EgressPolicy, Box<dyn Error>> {
    Ok(EgressPolicy::deny_all()
        .allow_origin(&origin(iri))?
        .allow_ip(IpAddr::V4(Ipv4Addr::LOCALHOST))
        .with_timeout(Duration::from_secs(2))
        .with_encoded_response_limit(64 * 1024)
        .with_decoded_response_limit(64 * 1024))
}

/// The SPARQL Protocol request shape, captured so an observed run can be
/// compared byte for byte against an unobserved one.
fn request_shape(request: &ObservedRequest) -> (String, String, String, Option<String>, Option<String>) {
    (
        request.method().to_owned(),
        request.target().to_owned(),
        request.body().to_owned(),
        request.header("content-type").map(ToOwned::to_owned),
        request.header("accept").map(ToOwned::to_owned),
    )
}

fn assert_service_post(request: &ObservedRequest) {
    assert_eq!(
        request.method(),
        "POST",
        "SERVICE must keep using a SPARQL Protocol POST while observed"
    );
    assert_eq!(
        request.target(),
        "/sparql",
        "SERVICE must keep targeting the endpoint IRI path while observed"
    );
}

/// A bound loopback socket that must never receive a connection.
struct Probe {
    listener: TcpListener,
    iri: String,
}

impl Probe {
    fn new() -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let iri = format!("http://{}/sparql", listener.local_addr()?);
        Ok(Self { listener, iri })
    }

    fn iri(&self) -> &str {
        &self.iri
    }

    fn assert_no_connection(&self) -> Result<(), Box<dyn Error>> {
        thread::sleep(Duration::from_millis(20));
        match self.listener.accept() {
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(()),
            Ok(_) => Err(io::Error::other("a denied endpoint received a connection").into()),
            Err(error) => Err(error.into()),
        }
    }
}

/// A registered default handler that answers without any HTTP egress.
struct EmptySolutionsHandler;

impl DefaultServiceHandler for EmptySolutionsHandler {
    type Error = Infallible;

    fn handle(
        &self,
        _service_name: &NamedNode,
        _expression: &QueryExpression,
        _base_iri: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let variables: Arc<[Variable]> = Arc::from([]);
        Ok(QuerySolutionIter::new(variables, []))
    }
}

// ---------------------------------------------------------------------------
// 1. JSON and XML success.
// ---------------------------------------------------------------------------

#[test]
fn json_success_is_one_completed_attempt_with_exact_parser_input_bytes()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(8)?;
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_TWO_ROWS)])?;
    let query = format!(
        r#"SELECT ?local ?remote WHERE {{
             VALUES ?local {{ "local" }}
             SERVICE <{}> {{ ?s <urn:test:p> ?remote }}
           }} ORDER BY ?remote"#,
        endpoint.iri()
    );
    let observed = select(evaluator_with(&observation), &query)?;
    let requests = endpoint.finish()?;

    let plain_endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_TWO_ROWS)])?;
    let plain_query = query.replace(endpoint_host(&query)?.as_str(), plain_endpoint.iri());
    let plain = select(SparqlEvaluator::new(), &plain_query)?;
    let plain_requests = plain_endpoint.finish()?;

    assert_eq!(
        column(&observed, "remote"),
        column(&plain, "remote"),
        "attaching a report changed the SERVICE result bag"
    );
    assert_eq!(observed.len(), 2, "both remote solutions must join locally");
    assert_eq!(
        observed[0].get("local"),
        Some(&Literal::from("local").into()),
        "the incoming mapping must survive the join"
    );
    assert_eq!(requests.len(), 1, "one SERVICE invocation is one request");
    assert_eq!(
        plain_requests.len(),
        1,
        "the unobserved control must issue the same single request"
    );
    assert_service_post(&requests[0]);
    assert_eq!(
        request_shape(&requests[0]),
        request_shape(&plain_requests[0]),
        "the report changed the SPARQL Protocol request shape"
    );

    let snapshot = observation.snapshot();
    assert_eq!(
        totals(&snapshot),
        Totals {
            attempts: 1,
            dispatches: 1,
            decoded_bytes: byte_len(JSON_TWO_ROWS),
            rows: 2,
            completed: 1,
            failed: 0,
            abandoned: 0,
            in_progress: 0,
        },
        "a fully consumed JSON success must report exactly one completed attempt"
    );
    assert_eq!(retained_records(&snapshot), 1, "one attempt retains one record");
    assert_eq!(
        record_state(&snapshot, 0),
        Some(RecordState::Completed),
        "an exhausted remote stream is Completed"
    );
    assert_eq!(
        record_profile(&snapshot, 0).as_deref(),
        Some("unplanned-http-v1"),
        "the execution profile is fixed"
    );
    assert_eq!(record_dispatches(&snapshot, 0), Some(1), "one admitted dispatch");
    assert_eq!(
        record_decoded_bytes(&snapshot, 0),
        Some(byte_len(JSON_TWO_ROWS)),
        "decoded bytes must equal the parser input actually delivered"
    );
    assert_eq!(record_rows(&snapshot, 0), Some(2), "two parsed solutions");
    Ok(())
}

/// Recovers the endpoint IRI embedded in a formatted query so the control run
/// can be built from the same literal query text.
fn endpoint_host(query: &str) -> Result<String, Box<dyn Error>> {
    let start = query
        .find("http://")
        .ok_or_else(|| io::Error::other("no endpoint IRI in the query"))?;
    let end = query[start..]
        .find('>')
        .ok_or_else(|| io::Error::other("unterminated endpoint IRI in the query"))?;
    Ok(query[start..start + end].to_owned())
}

#[test]
fn xml_success_is_one_completed_attempt_with_exact_parser_input_bytes()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(8)?;
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(XML_MEDIA_TYPE, XML_ONE_ROW)])?;
    let observed = select(
        evaluator_with(&observation),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            endpoint.iri()
        ),
    )?;
    let requests = endpoint.finish()?;

    let plain_endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(XML_MEDIA_TYPE, XML_ONE_ROW)])?;
    let plain = select(
        SparqlEvaluator::new(),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            plain_endpoint.iri()
        ),
    )?;
    plain_endpoint.finish()?;

    assert_eq!(
        column(&observed, "remote"),
        column(&plain, "remote"),
        "attaching a report changed the XML SERVICE results"
    );
    assert_eq!(
        observed[0].get("remote"),
        Some(&Literal::from("alpha").into()),
        "the XML solution must be parsed unchanged"
    );
    assert_eq!(requests.len(), 1, "one SERVICE invocation is one request");

    let snapshot = observation.snapshot();
    assert_eq!(
        totals(&snapshot),
        Totals {
            attempts: 1,
            dispatches: 1,
            decoded_bytes: byte_len(XML_ONE_ROW),
            rows: 1,
            completed: 1,
            failed: 0,
            abandoned: 0,
            in_progress: 0,
        },
        "a fully consumed XML success must report exactly one completed attempt"
    );
    assert_eq!(
        record_state(&snapshot, 0),
        Some(RecordState::Completed),
        "an exhausted XML stream is Completed"
    );
    Ok(())
}

#[test]
fn in_progress_is_visible_while_the_result_stream_is_alive() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(4)?;
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_THREE_ROWS)])?;
    let store = Store::new()?;
    let QueryResults::Solutions(mut solutions) = evaluator_with(&observation)
        .parse_query(&format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            endpoint.iri()
        ))?
        .on_store(&store)
        .execute()?
    else {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "expected SELECT results").into());
    };

    // spareval dispatches a SERVICE when the query is executed, before the first
    // solution is polled; that is existing evaluator behaviour this slice does
    // not change (verified against unmodified source). The report must still
    // show only work actually performed: the attempt is visible and still in
    // progress, and nothing has been parsed or completed yet.
    let before_first = observation.snapshot();
    assert!(
        attempts(&before_first) <= 1,
        "execution must not start more than the one SERVICE invocation"
    );
    assert_eq!(
        completed(&before_first),
        0,
        "no attempt may be Completed before its stream is consumed"
    );
    assert_eq!(
        in_progress(&before_first),
        attempts(&before_first),
        "any attempt started at execution must be visible as InProgress"
    );

    let first = solutions
        .next()
        .ok_or_else(|| io::Error::other("the remote stream produced no solution"))??;
    assert_eq!(
        first.get("remote"),
        Some(&Literal::from("alpha").into()),
        "the first remote solution must stream through unchanged"
    );

    let mid_stream = observation.snapshot();
    assert_eq!(attempts(&mid_stream), 1, "one entry into the built-in handler");
    assert_eq!(dispatches(&mid_stream), 1, "one admitted HTTP dispatch");
    assert_eq!(
        in_progress(&mid_stream),
        1,
        "a live remote result stream must be visible as InProgress"
    );
    assert_eq!(
        completed(&mid_stream),
        0,
        "an unexhausted stream must not be reported as Completed"
    );
    assert_eq!(
        record_state(&mid_stream, 0),
        Some(RecordState::InProgress),
        "the retained record must report InProgress while its stream is alive"
    );

    let remaining = solutions.collect::<Result<Vec<_>, _>>()?;
    assert_eq!(remaining.len(), 2, "the remaining solutions must still stream");
    endpoint.finish()?;

    let after = observation.snapshot();
    assert_eq!(
        totals(&after),
        Totals {
            attempts: 1,
            dispatches: 1,
            decoded_bytes: byte_len(JSON_THREE_ROWS),
            rows: 3,
            completed: 1,
            failed: 0,
            abandoned: 0,
            in_progress: 0,
        },
        "exhausting the stream must move the same attempt to Completed without recounting it"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 2. Variable endpoints, duplicate multiplicity, repeated blank-node labels.
// ---------------------------------------------------------------------------

#[test]
fn repeated_variable_endpoint_invocations_are_never_reused_or_deduplicated()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(8)?;
    let endpoint = TestEndpoint::spawn(vec![
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_SAME_LABEL_BNODE),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_SAME_LABEL_BNODE),
    ])?;
    let observed = select(
        evaluator_with(&observation),
        &format!(
            "SELECT ?call ?node WHERE {{
                 VALUES (?service ?call) {{ (<{0}> 1) (<{0}> 2) }}
                 SERVICE ?service {{ ?s ?p ?node }}
               }} ORDER BY ?call",
            endpoint.iri()
        ),
    )?;
    let requests = endpoint.finish()?;

    let plain_endpoint = TestEndpoint::spawn(vec![
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_SAME_LABEL_BNODE),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_SAME_LABEL_BNODE),
    ])?;
    let plain = select(
        SparqlEvaluator::new(),
        &format!(
            "SELECT ?call ?node WHERE {{
                 VALUES (?service ?call) {{ (<{0}> 1) (<{0}> 2) }}
                 SERVICE ?service {{ ?s ?p ?node }}
               }} ORDER BY ?call",
            plain_endpoint.iri()
        ),
    )?;
    let plain_requests = plain_endpoint.finish()?;

    assert_eq!(observed.len(), 2, "duplicate bindings must keep their multiplicity");
    assert_eq!(
        observed.len(),
        plain.len(),
        "attaching a report changed the result multiplicity"
    );
    let observed_nodes = column(&observed, "node");
    let plain_nodes = column(&plain, "node");
    assert!(
        observed_nodes.iter().all(Option::is_some),
        "both responses must contribute a blank node"
    );
    assert_ne!(
        observed_nodes[0], observed_nodes[1],
        "same-label blank nodes from two response documents must stay distinct"
    );
    assert_ne!(
        plain_nodes[0], plain_nodes[1],
        "the unobserved control must keep the same per-document blank-node scope"
    );
    assert_eq!(requests.len(), 2, "two invocations are two loopback requests");
    assert_eq!(
        plain_requests.len(),
        2,
        "the unobserved control must issue the same two requests"
    );
    requests.iter().for_each(assert_service_post);

    let snapshot = observation.snapshot();
    assert_eq!(
        totals(&snapshot),
        Totals {
            attempts: 2,
            dispatches: 2,
            decoded_bytes: 2 * byte_len(JSON_SAME_LABEL_BNODE),
            rows: 2,
            completed: 2,
            failed: 0,
            abandoned: 0,
            in_progress: 0,
        },
        "two invocations of the same endpoint must be counted twice, never reused"
    );
    assert_eq!(retained_records(&snapshot), 2, "each attempt retains its own record");
    assert_ne!(
        record_id(&snapshot, 0),
        record_id(&snapshot, 1),
        "invocation IDs must distinguish the two attempts"
    );
    assert_eq!(
        record_state(&snapshot, 1),
        Some(RecordState::Completed),
        "the second invocation must also be Completed"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 3. Policy denial before any network dispatch.
// ---------------------------------------------------------------------------

#[test]
fn policy_denial_before_send_is_one_failed_attempt_without_dispatch()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let probe = Probe::new()?;
    let store = Store::new()?;

    let observation = HttpServiceObservation::new(4)?;
    let ordinary = evaluate(
        evaluator_with(&observation).with_deny_all_egress_policy(),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            probe.iri()
        ),
        &store,
    )?;
    let plain_ordinary = evaluate(
        SparqlEvaluator::new().with_deny_all_egress_policy(),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            probe.iri()
        ),
        &store,
    )?;
    let Err(observed_error) = ordinary else {
        return Err(io::Error::other("a denied SERVICE returned solutions").into());
    };
    let Err(plain_error) = plain_ordinary else {
        return Err(io::Error::other("a denied unobserved SERVICE returned solutions").into());
    };
    assert!(
        matches!(observed_error, QueryEvaluationError::Service(_)),
        "a policy denial must stay an ordinary SERVICE error while observed"
    );
    assert!(
        matches!(plain_error, QueryEvaluationError::Service(_)),
        "the unobserved control must report the same error class"
    );

    let silent_observation = HttpServiceObservation::new(4)?;
    let silent = evaluate(
        evaluator_with(&silent_observation).with_deny_all_egress_policy(),
        &format!(
            r#"SELECT ?input ?remote WHERE {{
                 VALUES ?input {{ "kept" }}
                 SERVICE SILENT <{}> {{ ?s ?p ?remote }}
               }}"#,
            probe.iri()
        ),
        &store,
    )??;
    assert_eq!(silent.len(), 1, "SILENT must fall back to the incoming mapping");
    assert_eq!(
        silent[0].get("input"),
        Some(&Literal::from("kept").into()),
        "the incoming mapping must be preserved intact"
    );
    assert_eq!(
        silent[0].get("remote"),
        None,
        "a denied invocation must not bind remote variables"
    );
    probe.assert_no_connection()?;

    for (snapshot, label) in [
        (observation.snapshot(), "ordinary"),
        (silent_observation.snapshot(), "silent"),
    ] {
        assert_eq!(
            totals(&snapshot),
            Totals {
                attempts: 1,
                dispatches: 0,
                decoded_bytes: 0,
                rows: 0,
                completed: 0,
                failed: 1,
                abandoned: 0,
                in_progress: 0,
            },
            "a {label} denial before send is one failed attempt with no dispatch"
        );
        assert_eq!(
            record_state(&snapshot, 0),
            Some(RecordState::Failed),
            "a {label} denial must be retained as Failed"
        );
        assert_eq!(
            record_failure_is_policy_denial(&snapshot, 0),
            Some(true),
            "a {label} denial must keep its bounded egress category"
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 4. HTTP status failure and malformed/partial result streams.
// ---------------------------------------------------------------------------

#[test]
fn http_status_failure_is_reported_without_bytes_or_rows() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(4)?;
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::status("503 Service Unavailable", "down")])?;
    let store = Store::new()?;
    let result = evaluate(
        evaluator_with(&observation),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            endpoint.iri()
        ),
        &store,
    )?;
    let requests = endpoint.finish()?;
    assert_eq!(requests.len(), 1, "the failing status still consumed one request");

    let Err(error) = result else {
        return Err(io::Error::other("a 503 SERVICE response returned solutions").into());
    };
    assert!(
        matches!(error, QueryEvaluationError::Service(_)),
        "an HTTP status failure must stay an ordinary SERVICE error"
    );
    assert!(
        error.to_string().contains("503"),
        "the unchanged error text must still report the remote status"
    );

    let snapshot = observation.snapshot();
    assert_eq!(
        totals(&snapshot),
        Totals {
            attempts: 1,
            dispatches: 1,
            decoded_bytes: 0,
            rows: 0,
            completed: 0,
            failed: 1,
            abandoned: 0,
            in_progress: 0,
        },
        "a rejected status is one dispatched attempt that delivered no parser input"
    );
    assert_eq!(
        record_state(&snapshot, 0),
        Some(RecordState::Failed),
        "a rejected status is a failed invocation"
    );
    Ok(())
}

#[test]
fn silent_drops_partial_rows_atomically_while_the_report_counts_them()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(4)?;
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        JSON_MEDIA_TYPE,
        JSON_TRUNCATED_AFTER_FIRST_ROW,
    )])?;
    let store = Store::new()?;
    let silent = evaluate(
        evaluator_with(&observation),
        &format!(
            r#"SELECT ?input ?remote WHERE {{
                 VALUES ?input {{ "kept" }}
                 SERVICE SILENT <{}> {{ ?s ?p ?remote }}
               }}"#,
            endpoint.iri()
        ),
        &store,
    )??;
    endpoint.finish()?;

    assert_eq!(
        silent.len(),
        1,
        "a failed SILENT invocation yields exactly the incoming mapping"
    );
    assert_eq!(
        silent[0].get("input"),
        Some(&Literal::from("kept").into()),
        "the incoming mapping must survive the atomic drop"
    );
    assert_eq!(
        silent[0].get("remote"),
        None,
        "no partially parsed remote solution may leak into query results"
    );

    let snapshot = observation.snapshot();
    assert_eq!(attempts(&snapshot), 1, "one logical attempt");
    assert_eq!(dispatches(&snapshot), 1, "one admitted dispatch");
    assert_eq!(failed(&snapshot), 1, "a parser failure is a failed invocation");
    assert_eq!(completed(&snapshot), 0, "a parser failure is never Completed");
    assert_eq!(abandoned(&snapshot), 0, "a parser failure is never Abandoned");
    assert_eq!(
        rows(&snapshot),
        1,
        "the report must honestly count the solution parsed before the failure"
    );
    assert!(
        decoded_bytes(&snapshot) > 0
            && decoded_bytes(&snapshot) <= byte_len(JSON_TRUNCATED_AFTER_FIRST_ROW),
        "decoded bytes must be bounded by the bytes the fixture actually sent"
    );
    assert_eq!(
        record_state(&snapshot, 0),
        Some(RecordState::Failed),
        "the retained record must be Failed"
    );
    assert_eq!(
        record_rows(&snapshot, 0),
        Some(1),
        "the retained record must keep the pre-failure row count"
    );

    let after_drop = observation.snapshot();
    assert_eq!(
        totals(&after_drop),
        totals(&snapshot),
        "a failed invocation must stay Failed and must not be counted again"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 5. Remote timeout versus request-wide cancellation.
// ---------------------------------------------------------------------------

#[test]
fn remote_timeout_stays_silent_eligible_and_is_counted_once() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(4)?;
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::delayed(
        JSON_MEDIA_TYPE,
        JSON_ONE_ROW,
        Duration::from_millis(150),
    )])?;
    let store = Store::new()?;
    let silent = evaluate(
        evaluator_with(&observation).with_http_timeout(Duration::from_millis(20)),
        &format!(
            "SELECT ?input WHERE {{
                 VALUES ?input {{ 9 }}
                 SERVICE SILENT <{}> {{ ?s ?p ?o }}
               }}",
            endpoint.iri()
        ),
        &store,
    )??;
    endpoint.finish()?;

    assert_eq!(silent.len(), 1, "a remote timeout stays SILENT-eligible");
    assert_eq!(
        silent[0].get("input"),
        Some(&Literal::from(9).into()),
        "the incoming mapping must be preserved"
    );

    let immediate = observation.snapshot();
    assert_eq!(
        totals(&immediate),
        Totals {
            attempts: 1,
            dispatches: 1,
            decoded_bytes: 0,
            rows: 0,
            completed: 0,
            failed: 1,
            abandoned: 0,
            in_progress: 0,
        },
        "a remote timeout is one dispatched, failed invocation"
    );
    assert_eq!(
        record_failure_is_timeout(&immediate, 0),
        Some(true),
        "a remote timeout must keep its bounded timeout category"
    );

    drop(silent);
    let after_drop = observation.snapshot();
    assert_eq!(
        totals(&after_drop),
        totals(&immediate),
        "terminal counters must not move when the results are dropped"
    );
    Ok(())
}

#[test]
fn request_cancellation_stays_fatal_and_completes_no_attempt() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let probe = Probe::new()?;
    let store = Store::new()?;
    for silent in [false, true] {
        let observation = HttpServiceObservation::new(4)?;
        let token = CancellationToken::new();
        token.cancel();
        let keyword = if silent { "SILENT " } else { "" };
        let result = evaluate(
            evaluator_with(&observation).with_cancellation_token(token),
            &format!(
                "SELECT ?input WHERE {{
                     VALUES ?input {{ 3 }}
                     SERVICE {keyword}<{}> {{ ?s ?p ?o }}
                   }}",
                probe.iri()
            ),
            &store,
        )?;
        let Err(error) = result else {
            return Err(io::Error::other("a cancelled query returned solutions").into());
        };
        assert!(
            matches!(error, QueryEvaluationError::Cancelled),
            "SILENT must never hide a request-wide cancellation"
        );

        let snapshot = observation.snapshot();
        assert_eq!(
            dispatches(&snapshot),
            0,
            "a cancelled request must never be dispatched"
        );
        assert_eq!(decoded_bytes(&snapshot), 0, "a cancelled request delivers no bytes");
        assert_eq!(rows(&snapshot), 0, "a cancelled request parses no rows");
        assert_eq!(completed(&snapshot), 0, "a cancelled request never completes");
        assert_eq!(
            in_progress(&snapshot),
            0,
            "a cancelled request leaves no live stream behind"
        );
        assert!(
            attempts(&snapshot) <= 1,
            "cancellation observed before the handler is entered creates at most one attempt"
        );
        assert_eq!(
            attempts(&snapshot),
            failed(&snapshot) + abandoned(&snapshot),
            "every counted attempt must reach exactly one terminal state"
        );

        let after_drop = observation.snapshot();
        assert_eq!(
            totals(&after_drop),
            totals(&snapshot),
            "terminal counters must not double when the cancelled evaluation is dropped"
        );
    }
    probe.assert_no_connection()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// 6. Early result drop and LIMIT-driven abandonment.
// ---------------------------------------------------------------------------

#[test]
fn limit_abandonment_adds_no_drain_and_releases_the_http_permit()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(4)?;
    let endpoint = TestEndpoint::spawn(vec![
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_THREE_ROWS),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
    ])?;
    let policy = allowed_policy(endpoint.iri())?.with_max_concurrent_requests(1)?;

    let limited = select(
        evaluator_with(&observation).with_egress_policy(policy.clone()),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }} LIMIT 1",
            endpoint.iri()
        ),
    )?;
    assert_eq!(limited.len(), 1, "LIMIT 1 must yield exactly one solution");

    let abandoned_snapshot = observation.snapshot();
    assert_eq!(attempts(&abandoned_snapshot), 1, "one logical attempt");
    assert_eq!(dispatches(&abandoned_snapshot), 1, "one admitted dispatch");
    assert_eq!(
        abandoned(&abandoned_snapshot),
        1,
        "dropping a partially consumed stream is Abandoned"
    );
    assert_eq!(
        completed(&abandoned_snapshot),
        0,
        "an unexhausted stream must never be reported as Completed"
    );
    assert_eq!(
        in_progress(&abandoned_snapshot),
        0,
        "the dropped stream must leave no InProgress record behind"
    );
    assert!(
        (1..=3).contains(&rows(&abandoned_snapshot)),
        "the report must not drain the remote stream for extra rows"
    );
    assert!(
        decoded_bytes(&abandoned_snapshot) <= byte_len(JSON_THREE_ROWS),
        "the report must not read past the response the fixture sent"
    );
    assert_eq!(
        record_state(&abandoned_snapshot, 0),
        Some(RecordState::Abandoned),
        "the retained record must be Abandoned"
    );

    // The shared single-request budget proves the body admission was released
    // on drop: a retained permit would fail this second query.
    let second = select(
        evaluator_with(&observation).with_egress_policy(policy),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            endpoint.iri()
        ),
    )?;
    let requests = endpoint.finish()?;
    assert_eq!(second.len(), 1, "the next permitted request must proceed");
    assert_eq!(requests.len(), 2, "exactly two requests reached the endpoint");

    let final_snapshot = observation.snapshot();
    assert_eq!(
        totals(&final_snapshot),
        Totals {
            attempts: 2,
            dispatches: 2,
            decoded_bytes: decoded_bytes(&abandoned_snapshot) + byte_len(JSON_ONE_ROW),
            rows: rows(&abandoned_snapshot) + 1,
            completed: 1,
            failed: 0,
            abandoned: 1,
            in_progress: 0,
        },
        "the abandoned attempt must not be recounted by the following attempt"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 7. Retention cap, cumulative clones, distinct handles.
// ---------------------------------------------------------------------------

#[test]
fn a_zero_cap_keeps_totals_and_counts_every_omission() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(0)?;
    let endpoint = TestEndpoint::spawn(vec![
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
    ])?;
    let query = format!(
        "SELECT ?call ?remote WHERE {{
             VALUES (?service ?call) {{ (<{0}> 1) (<{0}> 2) }}
             SERVICE ?service {{ ?s ?p ?remote }}
           }} ORDER BY ?call",
        endpoint.iri()
    );
    let solutions = select(evaluator_with(&observation), &query)?;
    let requests = endpoint.finish()?;
    assert_eq!(solutions.len(), 2, "a zero cap must never change query results");
    assert_eq!(requests.len(), 2, "a zero cap must never change the request count");

    let snapshot = observation.snapshot();
    assert_eq!(retained_records(&snapshot), 0, "a zero cap retains no record");
    assert_eq!(
        omitted_records(&snapshot),
        2,
        "every unretained invocation must be counted as omitted"
    );
    assert_eq!(
        totals(&snapshot),
        Totals {
            attempts: 2,
            dispatches: 2,
            decoded_bytes: 2 * byte_len(JSON_ONE_ROW),
            rows: 2,
            completed: 2,
            failed: 0,
            abandoned: 0,
            in_progress: 0,
        },
        "aggregate totals must survive a zero retention cap"
    );
    assert_eq!(
        record_state(&snapshot, 0),
        None,
        "no record may be readable under a zero cap"
    );
    Ok(())
}

#[test]
fn a_small_cap_clones_and_distinct_handles_stay_bounded_and_isolated()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let first = HttpServiceObservation::new(1)?;
    let second = HttpServiceObservation::new(8)?;
    let endpoint = TestEndpoint::spawn(vec![
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
    ])?;
    let query = format!(
        "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
        endpoint.iri()
    );

    // The clone shares one cumulative report with its origin.
    let clone = first.clone();
    select(evaluator_with(&first), &query)?;
    select(evaluator_with(&clone), &query)?;
    select(evaluator_with(&second), &query)?;
    let requests = endpoint.finish()?;
    assert_eq!(requests.len(), 3, "three invocations are three requests");

    let from_origin = first.snapshot();
    let from_clone = clone.snapshot();
    assert_eq!(
        totals(&from_origin),
        totals(&from_clone),
        "a cloned handle must observe the same cumulative report"
    );
    assert_eq!(
        attempts(&from_origin),
        2,
        "the shared handle must accumulate both of its invocations"
    );
    assert_eq!(retained_records(&from_origin), 1, "a cap of one retains one record");
    assert_eq!(
        omitted_records(&from_origin),
        1,
        "the record the cap dropped must be counted as omitted"
    );
    assert_eq!(
        completed(&from_origin),
        2,
        "record-cap exhaustion must not disturb aggregate counters"
    );

    let isolated = second.snapshot();
    assert_eq!(
        totals(&isolated),
        Totals {
            attempts: 1,
            dispatches: 1,
            decoded_bytes: byte_len(JSON_ONE_ROW),
            rows: 1,
            completed: 1,
            failed: 0,
            abandoned: 0,
            in_progress: 0,
        },
        "a distinct handle must see only its own invocation"
    );
    assert_eq!(
        omitted_records(&isolated),
        0,
        "an unexhausted cap must report no omission"
    );
    assert_eq!(retained_records(&isolated), 1, "the distinct handle retains its record");
    Ok(())
}

#[test]
fn the_retention_cap_bounds_are_enforced_at_configuration_time() -> Result<(), Box<dyn Error>> {
    HttpServiceObservation::new(0)?;
    HttpServiceObservation::new(1024)?;
    let rejected: Result<HttpServiceObservation, HttpServiceObservationConfigurationError> =
        HttpServiceObservation::new(1025);
    let Err(error) = rejected else {
        return Err(io::Error::other("a cap above the documented maximum was accepted").into());
    };
    assert!(
        !format!("{error} {error:?}").is_empty(),
        "the configuration error must render without panicking"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 8. Store binding, prepared reuse, and non-HTTP handler paths.
// ---------------------------------------------------------------------------

#[test]
fn store_binding_and_evaluator_reuse_keep_one_cumulative_report()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(8)?;
    let endpoint = TestEndpoint::spawn(vec![
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
    ])?;
    let evaluator = evaluator_with(&observation);
    let query = format!(
        "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
        endpoint.iri()
    );

    // Two independent store bindings from one reused evaluator: the built-in
    // handler is reconstructed with the store's policy metrics each time.
    let first_store = Store::new()?;
    let second_store = Store::new()?;
    let first = evaluate(evaluator.clone(), &query, &first_store)??;
    let second = evaluate(evaluator, &query, &second_store)??;
    let requests = endpoint.finish()?;

    assert_eq!(first.len(), 1, "the first bound execution must return its solution");
    assert_eq!(second.len(), 1, "the second bound execution must return its solution");
    assert_eq!(requests.len(), 2, "each execution issues its own request");

    let snapshot = observation.snapshot();
    assert_eq!(
        totals(&snapshot),
        Totals {
            attempts: 2,
            dispatches: 2,
            decoded_bytes: 2 * byte_len(JSON_ONE_ROW),
            rows: 2,
            completed: 2,
            failed: 0,
            abandoned: 0,
            in_progress: 0,
        },
        "store binding must preserve the observer across reused evaluators"
    );
    assert_eq!(retained_records(&snapshot), 2, "both executions retain a record");
    assert_ne!(
        record_id(&snapshot, 0),
        record_id(&snapshot, 1),
        "each execution must get its own invocation ID"
    );
    Ok(())
}

#[test]
fn custom_and_disabled_service_handlers_produce_no_http_attempts()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let probe = Probe::new()?;
    let store = Store::new()?;

    let custom_observation = HttpServiceObservation::new(4)?;
    let custom = evaluate(
        evaluator_with(&custom_observation).with_default_service_handler(EmptySolutionsHandler),
        &format!(
            "SELECT ?input WHERE {{
                 VALUES ?input {{ 1 }}
                 SERVICE <{}> {{ ?s ?p ?o }}
               }}",
            probe.iri()
        ),
        &store,
    )??;
    assert!(
        custom.is_empty(),
        "an explicitly registered handler keeps precedence and returns no solution"
    );

    let disabled_observation = HttpServiceObservation::new(4)?;
    let disabled = evaluate(
        evaluator_with(&disabled_observation).without_default_http_service_handler(),
        &format!(
            "SELECT ?input WHERE {{
                 VALUES ?input {{ 1 }}
                 SERVICE SILENT <{}> {{ ?s ?p ?o }}
               }}",
            probe.iri()
        ),
        &store,
    )??;
    assert_eq!(
        disabled.len(),
        1,
        "an unsupported SERVICE stays SILENT-eligible with the built-in handler disabled"
    );
    assert_eq!(
        disabled[0].get("input"),
        Some(&Literal::from(1).into()),
        "the incoming mapping must be preserved"
    );
    probe.assert_no_connection()?;

    let empty = Totals {
        attempts: 0,
        dispatches: 0,
        decoded_bytes: 0,
        rows: 0,
        completed: 0,
        failed: 0,
        abandoned: 0,
        in_progress: 0,
    };
    assert_eq!(
        totals(&custom_observation.snapshot()),
        empty,
        "a custom default handler must produce no built-in HTTP attempt"
    );
    assert_eq!(
        totals(&disabled_observation.snapshot()),
        empty,
        "attaching a report must never re-enable a disabled HTTP handler"
    );
    assert_eq!(
        retained_records(&disabled_observation.snapshot()),
        0,
        "a disabled HTTP handler retains no record"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// 9. Non-disclosure, capability and header invariance.
// ---------------------------------------------------------------------------

#[test]
fn reports_disclose_no_secrets_and_change_no_capability_or_header()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let observation = HttpServiceObservation::new(8)?;
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        JSON_MEDIA_TYPE,
        JSON_SECRET_PAYLOAD,
    )])?;
    let endpoint_iri = endpoint.iri().to_owned();
    let secret_iri = format!("{}?token={SECRET_TOKEN}", endpoint.iri());
    let query = format!(
        r#"SELECT ?input ?remote WHERE {{
             VALUES ?input {{ "{SECRET_TOKEN}" }}
             SERVICE <{secret_iri}> {{ ?s <urn:test:{SECRET_TOKEN}> ?remote }}
           }}"#
    );
    let observed = select(evaluator_with(&observation), &query)?;
    let requests = endpoint.finish()?;

    let plain_endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        JSON_MEDIA_TYPE,
        JSON_SECRET_PAYLOAD,
    )])?;
    let plain_query = query.replace(&secret_iri, &format!("{}?token={SECRET_TOKEN}", plain_endpoint.iri()));
    let plain = select(SparqlEvaluator::new(), &plain_query)?;
    let plain_requests = plain_endpoint.finish()?;

    assert_eq!(observed.len(), 1, "the observed query must return its solution");
    assert_eq!(
        column(&observed, "remote"),
        column(&plain, "remote"),
        "the report changed the query results"
    );
    assert_eq!(
        request_shape(&requests[0]).0,
        request_shape(&plain_requests[0]).0,
        "the report changed the HTTP method"
    );
    assert_eq!(
        requests[0].header("content-type"),
        plain_requests[0].header("content-type"),
        "the report changed the request Content-Type"
    );
    assert_eq!(
        requests[0].header("accept"),
        plain_requests[0].header("accept"),
        "the report changed the negotiated Accept header"
    );
    assert_eq!(
        requests[0].body(),
        plain_requests[0].body(),
        "the report changed the SPARQL request body"
    );

    let snapshot = observation.snapshot();
    let rendered = format!(
        "{} {}",
        observation_debug(&observation),
        snapshot_debug(&snapshot)
    );
    for forbidden in [
        SECRET_TOKEN,
        SECRET_PAYLOAD,
        "urn:test:",
        "SELECT",
        "http://",
        endpoint_iri.as_str(),
    ] {
        assert!(
            !rendered.contains(forbidden),
            "the report disclosed retained content it must not keep: {forbidden}"
        );
    }
    assert_eq!(
        attempts(&snapshot),
        1,
        "the non-disclosure case must still have observed its invocation"
    );
    assert_eq!(
        record_profile(&snapshot, 0).as_deref(),
        Some("unplanned-http-v1"),
        "only the fixed profile identifier may be retained"
    );

    let baseline = SparqlEvaluator::new().effective_capabilities();
    let with_report = evaluator_with(&observation).effective_capabilities();
    assert_eq!(
        baseline, with_report,
        "attaching a report must not change the effective capability snapshot"
    );
    let denied = SparqlEvaluator::new().with_deny_all_egress_policy();
    assert_eq!(
        denied.effective_capabilities(),
        denied.with_http_service_observation(observation.clone()).effective_capabilities(),
        "attaching a report must not restore a denied capability"
    );
    Ok(())
}
