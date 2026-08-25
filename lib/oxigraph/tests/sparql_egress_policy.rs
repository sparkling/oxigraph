//! Hermetic qualification for the built-in SPARQL egress boundary.

#![cfg(all(
    test,
    feature = "http-client",
    feature = "rdf-12",
    not(target_family = "wasm")
))]
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "this integration test is the public G1.5 evaluator"
)]

use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::sparql::{
    CancellationToken, EgressError, EgressErrorKind, EgressPolicy, EgressPolicyConfigurationError,
    EgressPurpose, QueryEvaluationError, QueryResults, SparqlEvaluator, SparqlVersion,
    UpdateEvaluationError,
};
use oxigraph::store::Store;
use std::error::Error;
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const JSON_RESULT: &[u8] = br#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"ok"}}]}}"#;
const LOAD_DATA: &[u8] = b"<urn:load:s> <urn:load:p> <urn:load:o> .\n";
const GZIP_JSON_RESULT: &[u8] = &[
    31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 171, 86, 202, 72, 77, 76, 81, 178, 170, 86, 42, 75, 44, 42,
    86, 178, 138, 86, 42, 74, 205, 205, 47, 73, 85, 138, 173, 213, 1, 50, 139, 75, 115, 74, 138,
    65, 178, 73, 153, 121, 41, 153, 121, 233, 32, 21, 213, 48, 37, 64, 225, 146, 202, 2, 32, 173,
    148, 147, 89, 146, 90, 148, 152, 163, 164, 3, 52, 37, 167, 20, 36, 82, 49, 192, 64, 169, 182,
    54, 182, 182, 22, 0, 51, 143, 233, 137, 222, 0, 0, 0,
];

#[derive(Clone)]
struct Response {
    status: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    declared_length: Option<usize>,
    header_delay: Duration,
    body_pause: Option<(usize, Duration)>,
}

impl Response {
    fn ok(content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        let body = body.into();
        Self {
            status: "200 OK".into(),
            headers: vec![("Content-Type".into(), content_type.into())],
            declared_length: Some(body.len()),
            body,
            header_delay: Duration::ZERO,
            body_pause: None,
        }
    }

    fn with_status(mut self, status: &str) -> Self {
        self.status = status.into();
        self
    }

    fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    fn with_declared_length(mut self, length: usize) -> Self {
        self.declared_length = Some(length);
        self
    }

    fn with_header_delay(mut self, delay: Duration) -> Self {
        self.header_delay = delay;
        self
    }

    fn with_body_pause(mut self, at: usize, delay: Duration) -> Self {
        self.body_pause = Some((at, delay));
        self
    }
}

struct Endpoint {
    iri: String,
    accepted: Arc<AtomicUsize>,
    handle: JoinHandle<io::Result<()>>,
}

impl Endpoint {
    fn spawn(responses: impl FnOnce(&str) -> Vec<Response>) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let iri = format!("http://{}/resource", listener.local_addr()?);
        let responses = responses(&iri);
        let accepted = Arc::new(AtomicUsize::new(0));
        let accepted_for_thread = Arc::clone(&accepted);
        let handle = thread::spawn(move || serve(listener, responses, &accepted_for_thread));
        Ok(Self {
            iri,
            accepted,
            handle,
        })
    }

    fn iri(&self) -> &str {
        &self.iri
    }

    fn origin(&self) -> String {
        origin(&self.iri)
    }

    fn wait_for_accepts(&self, count: usize) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.accepted.load(Ordering::SeqCst) < count {
            assert!(
                Instant::now() < deadline,
                "endpoint did not accept request in time"
            );
            thread::sleep(Duration::from_millis(2));
        }
    }

    fn finish(self) -> io::Result<()> {
        self.handle
            .join()
            .map_err(|_| io::Error::other("endpoint thread panicked"))?
    }
}

struct Probe {
    listener: TcpListener,
    iri: String,
}

impl Probe {
    fn new() -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let iri = format!("http://{}/resource", listener.local_addr()?);
        Ok(Self { listener, iri })
    }

    fn assert_no_connection(&self) -> io::Result<()> {
        thread::sleep(Duration::from_millis(20));
        match self.listener.accept() {
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(()),
            Ok(_) => Err(io::Error::other(
                "policy-denied target received a connection",
            )),
            Err(error) => Err(error),
        }
    }
}

fn serve(
    listener: TcpListener,
    responses: Vec<Response>,
    accepted: &AtomicUsize,
) -> io::Result<()> {
    for response in responses {
        let (mut stream, _) = listener.accept()?;
        accepted.fetch_add(1, Ordering::SeqCst);
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        read_request(&mut stream)?;
        thread::sleep(response.header_delay);
        let mut head = format!("HTTP/1.1 {}\r\nConnection: close\r\n", response.status);
        if let Some(length) = response.declared_length {
            head.push_str(&format!("Content-Length: {length}\r\n"));
        }
        for (name, value) in response.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");
        write_disconnection_ok(&mut stream, head.as_bytes())?;
        if let Some((at, delay)) = response.body_pause {
            write_disconnection_ok(&mut stream, &response.body[..at])?;
            thread::sleep(delay);
            write_disconnection_ok(&mut stream, &response.body[at..])?;
        } else {
            write_disconnection_ok(&mut stream, &response.body)?;
        }
        drop(stream.shutdown(Shutdown::Write));
    }
    Ok(())
}

fn read_request(stream: &mut TcpStream) -> io::Result<()> {
    let mut bytes = Vec::new();
    let header_end = loop {
        if let Some(position) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break position;
        }
        let mut buffer = [0; 4096];
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "request ended",
            ));
        }
        bytes.extend_from_slice(&buffer[..read]);
    };
    let head = std::str::from_utf8(&bytes[..header_end])
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let content_length = head
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .map(|(_, value)| value.trim().parse::<usize>())
        .transpose()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        .unwrap_or_default();
    let required = header_end + 4 + content_length;
    while bytes.len() < required {
        let mut buffer = [0; 4096];
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "request body ended",
            ));
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    Ok(())
}

fn write_disconnection_ok(stream: &mut TcpStream, bytes: &[u8]) -> io::Result<()> {
    match stream.write_all(bytes) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::BrokenPipe
                    | io::ErrorKind::ConnectionAborted
                    | io::ErrorKind::ConnectionReset
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn origin(iri: &str) -> String {
    let authority_end = iri["http://".len()..]
        .find('/')
        .map(|offset| offset + "http://".len())
        .unwrap_or(iri.len());
    iri[..authority_end].to_owned()
}

fn allowed_policy(origin: &str) -> EgressPolicy {
    EgressPolicy::deny_all()
        .allow_origin(origin)
        .expect("literal-IP origin should be valid")
        .allow_ip(IpAddr::V4(Ipv4Addr::LOCALHOST))
        .with_timeout(Duration::from_secs(1))
        .with_encoded_response_limit(64 * 1024)
        .with_decoded_response_limit(64 * 1024)
}

fn service(
    evaluator: SparqlEvaluator,
    iri: &str,
    silent: bool,
) -> Result<usize, QueryEvaluationError> {
    let silent = if silent { "SILENT " } else { "" };
    let query = format!("SELECT ?remote WHERE {{ SERVICE {silent}<{iri}> {{ ?s ?p ?remote }} }}");
    let store = Store::new().expect("memory store");
    let QueryResults::Solutions(rows) = evaluator
        .parse_query(&query)
        .expect("query syntax")
        .on_store(&store)
        .execute()?
    else {
        panic!("expected solutions")
    };
    Ok(rows.collect::<Result<Vec<_>, _>>()?.len())
}

fn load(
    evaluator: SparqlEvaluator,
    store: &Store,
    iri: &str,
    silent: bool,
) -> Result<(), UpdateEvaluationError> {
    let silent = if silent { "SILENT " } else { "" };
    evaluator
        .with_version(SparqlVersion::V1_2)
        .parse_update(&format!("LOAD {silent}<{iri}>"))
        .expect("update syntax")
        .on_store(store)
        .execute()
}

fn find_egress<'a>(error: &'a (dyn Error + 'static)) -> Option<&'a EgressError> {
    let mut current = Some(error);
    while let Some(error) = current {
        if let Some(error) = error.downcast_ref::<EgressError>() {
            return Some(error);
        }
        current = error.source();
    }
    None
}

fn assert_egress(error: &(dyn Error + 'static), kind: EgressErrorKind, purpose: EgressPurpose) {
    let error = find_egress(error).expect("typed egress error in source chain");
    assert_eq!(error.kind(), kind);
    assert_eq!(error.purpose(), purpose);
}

#[test]
fn deny_all_blocks_service_load_and_file_before_connect() -> Result<(), Box<dyn Error>> {
    let probe = Probe::new()?;
    let policy = EgressPolicy::deny_all();
    let query_error = service(
        SparqlEvaluator::new().with_egress_policy(policy.clone()),
        &probe.iri,
        false,
    )
    .unwrap_err();
    assert_egress(
        &query_error,
        EgressErrorKind::PolicyDenied,
        EgressPurpose::Service,
    );

    let store = Store::new()?;
    let load_error = load(
        SparqlEvaluator::new().with_egress_policy(policy.clone()),
        &store,
        &probe.iri,
        false,
    )
    .unwrap_err();
    assert_egress(
        &load_error,
        EgressErrorKind::PolicyDenied,
        EgressPurpose::Load,
    );
    let file_error = load(
        SparqlEvaluator::new().with_egress_policy(policy),
        &store,
        "file:///tmp/oxigraph-egress-denied.nt",
        false,
    )
    .unwrap_err();
    assert_egress(
        &file_error,
        EgressErrorKind::PolicyDenied,
        EgressPurpose::Load,
    );
    assert!(store.is_empty()?);
    probe.assert_no_connection()?;
    Ok(())
}

#[test]
fn service_and_load_share_the_same_conjunctive_policy() -> Result<(), Box<dyn Error>> {
    let endpoint = Endpoint::spawn(|_| {
        vec![
            Response::ok("application/sparql-results+json", JSON_RESULT),
            Response::ok("application/n-triples", LOAD_DATA),
        ]
    })?;
    let policy = allowed_policy(&endpoint.origin());
    assert_eq!(
        service(
            SparqlEvaluator::new().with_egress_policy(policy.clone()),
            endpoint.iri(),
            false,
        )?,
        1
    );
    let store = Store::new()?;
    load(
        SparqlEvaluator::new().with_egress_policy(policy),
        &store,
        endpoint.iri(),
        false,
    )?;
    assert!(store.contains(&Quad::new(
        NamedNode::new("urn:load:s")?,
        NamedNode::new("urn:load:p")?,
        NamedNode::new("urn:load:o")?,
        GraphName::DefaultGraph,
    ))?);
    endpoint.finish()?;
    Ok(())
}

#[test]
fn origin_and_ip_allowlists_are_both_required_and_hostnames_fail_closed()
-> Result<(), Box<dyn Error>> {
    let probe = Probe::new()?;
    let origin_only = EgressPolicy::deny_all()
        .allow_origin(&origin(&probe.iri))?
        .with_timeout(Duration::from_millis(50));
    let error = service(
        SparqlEvaluator::new().with_egress_policy(origin_only),
        &probe.iri,
        false,
    )
    .unwrap_err();
    assert_egress(
        &error,
        EgressErrorKind::PolicyDenied,
        EgressPurpose::Service,
    );

    let ip_only = EgressPolicy::deny_all()
        .allow_ip(IpAddr::V4(Ipv4Addr::LOCALHOST))
        .with_timeout(Duration::from_millis(50));
    let error = service(
        SparqlEvaluator::new().with_egress_policy(ip_only),
        &probe.iri,
        false,
    )
    .unwrap_err();
    assert_egress(
        &error,
        EgressErrorKind::PolicyDenied,
        EgressPurpose::Service,
    );

    let hostname = probe.iri.replace("127.0.0.1", "localhost");
    let result = EgressPolicy::deny_all().allow_origin(&origin(&hostname));
    let Err(_configuration): Result<EgressPolicy, EgressPolicyConfigurationError> = result else {
        panic!("hostname origin must be rejected without a resolver hook")
    };
    probe.assert_no_connection()?;
    Ok(())
}

#[test]
fn redirects_and_credentials_fail_closed_without_secret_disclosure() -> Result<(), Box<dyn Error>> {
    let target = Probe::new()?;
    let redirect = Endpoint::spawn(|_| {
        vec![
            Response::ok("text/plain", Vec::new())
                .with_status("302 Found")
                .with_header("Location", &target.iri),
        ]
    })?;
    let error = service(
        SparqlEvaluator::new().with_egress_policy(allowed_policy(&redirect.origin())),
        redirect.iri(),
        false,
    )
    .unwrap_err();
    assert_egress(
        &error,
        EgressErrorKind::PolicyDenied,
        EgressPurpose::Service,
    );
    redirect.finish()?;
    target.assert_no_connection()?;

    let credential_target = Probe::new()?;
    let credential_iri = credential_target
        .iri
        .replacen("http://", "http://user:secret@", 1);
    let error = service(
        SparqlEvaluator::new().with_egress_policy(allowed_policy(&origin(&credential_target.iri))),
        &credential_iri,
        false,
    )
    .unwrap_err();
    assert_egress(
        &error,
        EgressErrorKind::PolicyDenied,
        EgressPurpose::Service,
    );
    let rendered = format!("{error:?} {error}");
    assert!(!rendered.contains("secret"));
    assert!(!rendered.contains(&credential_target.iri));
    credential_target.assert_no_connection()?;
    Ok(())
}

#[test]
fn encoded_and_decoded_response_limits_are_independent() -> Result<(), Box<dyn Error>> {
    let encoded = Endpoint::spawn(|_| {
        vec![Response::ok(
            "application/sparql-results+json",
            vec![b'x'; 128],
        )]
    })?;
    let policy = allowed_policy(&encoded.origin())
        .with_encoded_response_limit(32)
        .with_decoded_response_limit(4096);
    let error = service(
        SparqlEvaluator::new().with_egress_policy(policy),
        encoded.iri(),
        false,
    )
    .unwrap_err();
    assert_egress(
        &error,
        EgressErrorKind::EncodedResponseTooLarge,
        EgressPurpose::Service,
    );
    encoded.finish()?;

    let decoded = Endpoint::spawn(|_| {
        vec![
            Response::ok("application/sparql-results+json", GZIP_JSON_RESULT)
                .with_header("Content-Encoding", "gzip"),
        ]
    })?;
    let policy = allowed_policy(&decoded.origin())
        .with_encoded_response_limit(4096)
        .with_decoded_response_limit(64);
    let error = service(
        SparqlEvaluator::new().with_egress_policy(policy),
        decoded.iri(),
        false,
    )
    .unwrap_err();
    assert_egress(
        &error,
        EgressErrorKind::DecodedResponseTooLarge,
        EgressPurpose::Service,
    );
    decoded.finish()?;
    Ok(())
}

#[test]
fn partial_connections_and_timeouts_are_typed_and_atomic() -> Result<(), Box<dyn Error>> {
    let partial = Endpoint::spawn(|_| {
        vec![
            Response::ok("application/n-triples", LOAD_DATA)
                .with_declared_length(LOAD_DATA.len() + 20),
        ]
    })?;
    let store = Store::new()?;
    let error = load(
        SparqlEvaluator::new().with_egress_policy(allowed_policy(&partial.origin())),
        &store,
        partial.iri(),
        false,
    )
    .unwrap_err();
    assert_egress(&error, EgressErrorKind::RemoteFailure, EgressPurpose::Load);
    assert!(store.is_empty()?);
    partial.finish()?;

    let delayed = Endpoint::spawn(|_| {
        vec![
            Response::ok("application/n-triples", LOAD_DATA)
                .with_header_delay(Duration::from_millis(150)),
        ]
    })?;
    let policy = allowed_policy(&delayed.origin()).with_timeout(Duration::from_millis(20));
    let error = load(
        SparqlEvaluator::new().with_egress_policy(policy),
        &store,
        delayed.iri(),
        false,
    )
    .unwrap_err();
    assert_egress(&error, EgressErrorKind::Timeout, EgressPurpose::Load);
    assert!(store.is_empty()?);
    delayed.finish()?;
    Ok(())
}

#[test]
fn service_cancellation_is_not_hidden_by_silent() -> Result<(), Box<dyn Error>> {
    let probe = Probe::new()?;
    for silent in [false, true] {
        let token = CancellationToken::new();
        token.cancel();
        let error = service(
            SparqlEvaluator::new()
                .with_cancellation_token(token)
                .with_egress_policy(allowed_policy(&origin(&probe.iri))),
            &probe.iri,
            silent,
        )
        .unwrap_err();
        assert!(matches!(error, QueryEvaluationError::Cancelled));
    }
    probe.assert_no_connection()?;
    Ok(())
}

#[test]
fn load_cancellation_is_not_hidden_by_silent_and_rolls_back() -> Result<(), Box<dyn Error>> {
    let probe = Probe::new()?;
    let token = CancellationToken::new();
    token.cancel();
    let store = Store::new()?;
    let error = load(
        SparqlEvaluator::new()
            .with_cancellation_token(token)
            .with_egress_policy(allowed_policy(&origin(&probe.iri))),
        &store,
        &probe.iri,
        true,
    )
    .unwrap_err();
    assert_egress(&error, EgressErrorKind::Cancelled, EgressPurpose::Load);
    assert!(store.is_empty()?);
    probe.assert_no_connection()?;
    Ok(())
}

#[test]
fn nested_json_ld_document_loading_cannot_bypass_policy() -> Result<(), Box<dyn Error>> {
    let context = Probe::new()?;
    let document = Endpoint::spawn(|_| {
        vec![Response::ok(
            "application/ld+json",
            format!(
                r#"{{"@context":"{}","@id":"urn:document","urn:p":{{"@id":"urn:o"}}}}"#,
                context.iri
            ),
        )]
    })?;
    let store = Store::new()?;
    let error = load(
        SparqlEvaluator::new().with_egress_policy(allowed_policy(&document.origin())),
        &store,
        document.iri(),
        false,
    )
    .unwrap_err();
    assert_egress(
        &error,
        EgressErrorKind::PolicyDenied,
        EgressPurpose::Document,
    );
    assert!(store.is_empty()?);
    document.finish()?;
    context.assert_no_connection()?;
    Ok(())
}

#[test]
fn connection_budget_is_shared_by_policy_clones_and_released() -> Result<(), Box<dyn Error>> {
    let endpoint = Endpoint::spawn(|_| {
        vec![
            Response::ok("application/sparql-results+json", JSON_RESULT)
                .with_header_delay(Duration::from_millis(150)),
            Response::ok("application/sparql-results+json", JSON_RESULT),
        ]
    })?;
    let policy = allowed_policy(&endpoint.origin()).with_max_concurrent_requests(1)?;
    let first_evaluator = SparqlEvaluator::new().with_egress_policy(policy.clone());
    let first_iri = endpoint.iri().to_owned();
    let first = thread::spawn(move || service(first_evaluator, &first_iri, false));
    endpoint.wait_for_accepts(1);

    let error = service(
        SparqlEvaluator::new().with_egress_policy(policy.clone()),
        endpoint.iri(),
        false,
    )
    .unwrap_err();
    assert_egress(
        &error,
        EgressErrorKind::ConnectionBudgetExceeded,
        EgressPurpose::Service,
    );
    assert_eq!(first.join().expect("first query thread")?, 1);
    assert_eq!(
        service(
            SparqlEvaluator::new().with_egress_policy(policy),
            endpoint.iri(),
            false,
        )?,
        1
    );
    endpoint.finish()?;
    Ok(())
}

#[test]
fn cancellation_while_reading_load_rolls_back_staged_update() -> Result<(), Box<dyn Error>> {
    let mut body = LOAD_DATA.to_vec();
    body.extend_from_slice(b"<urn:load:s2> <urn:load:p> <urn:load:o2> .\n");
    let endpoint = Endpoint::spawn(|_| {
        vec![
            Response::ok("application/n-triples", body)
                .with_body_pause(LOAD_DATA.len(), Duration::from_millis(150)),
        ]
    })?;
    let token = CancellationToken::new();
    let cancel = token.clone();
    let accepted = Arc::clone(&endpoint.accepted);
    let canceller = thread::spawn(move || {
        while accepted.load(Ordering::SeqCst) == 0 {
            thread::sleep(Duration::from_millis(2));
        }
        thread::sleep(Duration::from_millis(20));
        cancel.cancel();
    });
    let store = Store::new()?;
    let evaluator = SparqlEvaluator::new()
        .with_cancellation_token(token)
        .with_egress_policy(allowed_policy(&endpoint.origin()));
    let update = format!(
        "INSERT DATA {{ <urn:local:s> <urn:local:p> <urn:local:o> }}; LOAD <{}>",
        endpoint.iri()
    );
    let error = evaluator
        .with_version(SparqlVersion::V1_2)
        .parse_update(&update)?
        .on_store(&store)
        .execute()
        .unwrap_err();
    assert_egress(&error, EgressErrorKind::Cancelled, EgressPurpose::Load);
    assert!(store.is_empty()?);
    canceller.join().expect("canceller thread");
    endpoint.finish()?;
    Ok(())
}

#[test]
fn unsafe_policy_configuration_is_rejected_without_echoing_input() {
    let result = EgressPolicy::deny_all().allow_origin("http://user:secret@127.0.0.1");
    let Err(error): Result<EgressPolicy, EgressPolicyConfigurationError> = result else {
        panic!("credential-bearing origin was accepted")
    };
    let rendered = format!("{error:?} {error}");
    assert!(!rendered.contains("secret"));
    assert!(
        EgressPolicy::deny_all()
            .allow_origin("http://127.0.0.1/path")
            .is_err()
    );
    assert!(
        EgressPolicy::deny_all()
            .with_max_concurrent_requests(0)
            .is_err()
    );
}
