use super::*;
use anyhow::{Context, Result, ensure};
use oxhttp::ListeningServer;
#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
use oxigraph::model::BlankNode;
use oxigraph::model::Quad;
use std::fmt::Write as _;
use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::{Mutex, MutexGuard, PoisonError};

const FORM_CONTENT_TYPE: &str = "application/x-www-form-urlencoded";
const QUERY_CONTENT_TYPE: &str = "application/sparql-query";
const UPDATE_CONTENT_TYPE: &str = "application/sparql-update";
const JSON_RESULTS: &str = "application/sparql-results+json";

#[test]
fn form_post_combines_disjoint_url_and_body_parameters() -> Result<()> {
    let _serial = protocol_wire_lock();
    let store = Store::new()?;
    let (address, _server) =
        spawn_server(&store, &SparqlEvaluator::new(), QueryEntailment::Simple)?;
    let query_body = form(&[("query", "ASK {}")]);
    let duplicate_query = ("query", "ASK {}");
    let response = send(
        address,
        "POST",
        &target("/query", &[duplicate_query]),
        Some(FORM_CONTENT_TYPE),
        Some(JSON_RESULTS),
        &query_body,
    )?;
    ensure!(
        response.status == 400,
        "a query set in both URL and body returned {}: {}",
        response.status,
        response.body_text()
    );
    for parameter in [
        ("default-graph-uri", "urn:default"),
        ("named-graph-uri", "urn:named"),
        ("version", "1.2"),
    ] {
        let response = send(
            address,
            "POST",
            &target("/query", &[parameter]),
            Some(FORM_CONTENT_TYPE),
            Some(JSON_RESULTS),
            &query_body,
        )?;
        ensure!(
            response.status == 200,
            "query form URI parameter {} returned {}: {}",
            parameter.0,
            response.status,
            response.body_text()
        );
    }

    let update_body = form(&[("update", "INSERT DATA {}")]);
    let duplicate_update = ("update", "INSERT DATA {}");
    let response = send(
        address,
        "POST",
        &target("/update", &[duplicate_update]),
        Some(FORM_CONTENT_TYPE),
        None,
        &update_body,
    )?;
    ensure!(
        response.status == 400,
        "an update set in both URL and body returned {}: {}",
        response.status,
        response.body_text()
    );
    for parameter in [
        ("using-graph-uri", "urn:default"),
        ("using-named-graph-uri", "urn:named"),
        ("version", "1.2"),
    ] {
        let response = send(
            address,
            "POST",
            &target("/update", &[parameter]),
            Some(FORM_CONTENT_TYPE),
            None,
            &update_body,
        )?;
        ensure!(
            response.status == 204,
            "update form URI parameter {} returned {}: {}",
            parameter.0,
            response.status,
            response.body_text()
        );
    }

    ensure!(
        send(
            address,
            "POST",
            "/query",
            Some(FORM_CONTENT_TYPE),
            Some(JSON_RESULTS),
            &form(&[("query", "ASK {}"), ("version", "1.1")]),
        )?
        .status
            == 200,
        "query form parameters in the body must remain valid"
    );
    ensure!(
        send(
            address,
            "POST",
            "/update",
            Some(FORM_CONTENT_TYPE),
            None,
            &form(&[("update", "INSERT DATA {}"), ("version", "1.1")]),
        )?
        .status
            == 204,
        "update form parameters in the body must remain valid"
    );
    Ok(())
}

#[test]
fn query_dataset_parameters_override_query_from() -> Result<()> {
    let _serial = protocol_wire_lock();
    let store = Store::new()?;
    store.insert(data_quad("urn:from-subject", "urn:from-graph"))?;
    store.insert(data_quad("urn:protocol-subject", "urn:protocol-graph"))?;
    let (address, _server) =
        spawn_server(&store, &SparqlEvaluator::new(), QueryEntailment::Simple)?;
    let query = concat!(
        "ASK FROM <urn:from-graph> WHERE {",
        " <urn:protocol-subject> <urn:p> <urn:o> .",
        " FILTER NOT EXISTS { <urn:from-subject> <urn:p> <urn:o> }",
        " }",
    );
    let response = send(
        address,
        "GET",
        &target(
            "/query",
            &[
                ("query", query),
                ("default-graph-uri", "urn:protocol-graph"),
            ],
        ),
        None,
        Some(JSON_RESULTS),
        "",
    )?;
    ensure!(
        response.status == 200,
        "dataset override query returned {}: {}",
        response.status,
        response.body_text()
    );
    ensure!(
        response.body_text().contains("\"boolean\":true"),
        "protocol dataset did not replace the query FROM dataset: {}",
        response.body_text()
    );
    Ok(())
}

#[test]
fn repeated_update_dataset_parameters_define_the_using_dataset() -> Result<()> {
    let _serial = protocol_wire_lock();
    let store = Store::new()?;
    for (subject, graph) in [
        ("urn:default-one", "urn:default-graph-one"),
        ("urn:default-two", "urn:default-graph-two"),
        ("urn:named-one", "urn:named-graph-one"),
        ("urn:named-two", "urn:named-graph-two"),
    ] {
        store.insert(data_quad(subject, graph))?;
    }
    let (address, _server) =
        spawn_server(&store, &SparqlEvaluator::new(), QueryEntailment::Simple)?;
    let request_target = target(
        "/update",
        &[
            ("using-graph-uri", "urn:default-graph-one"),
            ("using-graph-uri", "urn:default-graph-two"),
            ("using-named-graph-uri", "urn:named-graph-one"),
            ("using-named-graph-uri", "urn:named-graph-two"),
        ],
    );
    let update = concat!(
        "INSERT { GRAPH <urn:out> { ?s <urn:copied-from> ?source } } WHERE {",
        " { ?s <urn:p> <urn:o> BIND(<urn:protocol-default> AS ?source) }",
        " UNION { GRAPH ?source { ?s <urn:p> <urn:o> } }",
        " }",
    );
    let response = send(
        address,
        "POST",
        &request_target,
        Some(UPDATE_CONTENT_TYPE),
        None,
        update,
    )?;
    ensure!(
        response.status == 204,
        "repeated update dataset parameters returned {}: {}",
        response.status,
        response.body_text()
    );
    for (subject, source) in [
        ("urn:default-one", "urn:protocol-default"),
        ("urn:default-two", "urn:protocol-default"),
        ("urn:named-one", "urn:named-graph-one"),
        ("urn:named-two", "urn:named-graph-two"),
    ] {
        ensure!(
            store.contains(&Quad::new(
                node(subject),
                node("urn:copied-from"),
                node(source),
                node("urn:out"),
            ))?,
            "protocol dataset omitted {subject} from {source}"
        );
    }
    Ok(())
}

#[test]
fn update_dataset_parameters_conflict_with_using_and_with() -> Result<()> {
    let _serial = protocol_wire_lock();
    let store = Store::new()?;
    let (address, _server) =
        spawn_server(&store, &SparqlEvaluator::new(), QueryEntailment::Simple)?;
    let request_target = target("/update", &[("using-graph-uri", "urn:protocol-graph")]);
    for update in [
        concat!(
            "INSERT { <urn:new> <urn:p> ?o } ",
            "USING <urn:update-graph> WHERE { ?s <urn:p> ?o }",
        ),
        concat!(
            "WITH <urn:update-graph> ",
            "DELETE { ?s <urn:p> ?o } WHERE { ?s <urn:p> ?o }",
        ),
    ] {
        let response = send(
            address,
            "POST",
            &request_target,
            Some(UPDATE_CONTENT_TYPE),
            None,
            update,
        )?;
        ensure!(
            response.status == 400,
            "protocol dataset conflict returned {}: {}",
            response.status,
            response.body_text()
        );
    }
    Ok(())
}

#[test]
fn malformed_and_option_errors_are_400_but_execution_failure_is_500() -> Result<()> {
    let _serial = protocol_wire_lock();
    let store = Store::new()?;
    let (address, _server) = spawn_server(
        &store,
        &evaluator_without_services(),
        QueryEntailment::Simple,
    )?;
    let malformed = send(
        address,
        "POST",
        "/query",
        Some(QUERY_CONTENT_TYPE),
        Some(JSON_RESULTS),
        "SELECT",
    )?;
    ensure!(
        malformed.status == 400,
        "malformed query returned {}: {}",
        malformed.status,
        malformed.body_text()
    );
    let invalid_dataset = send(
        address,
        "GET",
        &target(
            "/query",
            &[("query", "ASK {}"), ("default-graph-uri", "relative-graph")],
        ),
        None,
        Some(JSON_RESULTS),
        "",
    )?;
    ensure!(
        invalid_dataset.status == 400,
        "invalid dataset option returned {}: {}",
        invalid_dataset.status,
        invalid_dataset.body_text()
    );
    let execution_failure = send(
        address,
        "POST",
        "/query",
        Some(QUERY_CONTENT_TYPE),
        Some(JSON_RESULTS),
        "ASK { SERVICE <urn:unavailable> { ?s ?p ?o } }",
    )?;
    ensure!(
        execution_failure.status == 500,
        "execution failure returned {}: {}",
        execution_failure.status,
        execution_failure.body_text()
    );
    let update_failure = send(
        address,
        "POST",
        "/update",
        Some(UPDATE_CONTENT_TYPE),
        None,
        "LOAD <urn:unavailable>",
    )?;
    ensure!(
        update_failure.status == 500,
        "update execution failure returned {}: {}",
        update_failure.status,
        update_failure.body_text()
    );
    Ok(())
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn pre_execution_entailment_refusal_is_500() -> Result<()> {
    let _serial = protocol_wire_lock();
    let store = Store::new()?;
    store.insert(Quad::new(
        BlankNode::new("oxrdfs0000000000000000")?,
        node("urn:p"),
        node("urn:o"),
        GraphName::DefaultGraph,
    ))?;
    let (address, _server) = spawn_server(
        &store,
        &SparqlEvaluator::new(),
        QueryEntailment::Rdfs12Finite,
    )?;
    let response = send(
        address,
        "POST",
        "/query",
        Some(QUERY_CONTENT_TYPE),
        Some(JSON_RESULTS),
        "ASK {}",
    )?;
    ensure!(
        response.status == 500,
        "pre-execution refusal returned {}: {}",
        response.status,
        response.body_text()
    );
    ensure!(
        response.body_text().contains("Query request refused"),
        "pre-execution refusal was not identified: {}",
        response.body_text()
    );
    Ok(())
}

fn spawn_server(
    store: &Store,
    evaluator: &SparqlEvaluator,
    entailment: QueryEntailment,
) -> Result<(SocketAddr, ListeningServer)> {
    let mut remaining_bind_attempts = 32;
    loop {
        let _bind_guard = HTTP_TEST_BIND_LOCK
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let address = reserve_address()?;
        let server_store = store.clone();
        let server_evaluator = evaluator.clone();
        let server = Server::new(move |request| {
            let method = request.method().clone();
            finalize_response(
                &method,
                handle_request(
                    request,
                    &server_store,
                    &server_evaluator,
                    false,
                    false,
                    entailment,
                    None,
                )
                .unwrap_or_else(|(status, message)| error(status, message)),
            )
        })
        .with_global_timeout(Duration::from_secs(5))
        .bind(address)
        .spawn();
        match server {
            Ok(server) => return Ok((address, server)),
            Err(error) if error.kind() == ErrorKind::AddrInUse && remaining_bind_attempts > 1 => {
                remaining_bind_attempts -= 1;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn protocol_wire_lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

fn evaluator_without_services() -> SparqlEvaluator {
    #[cfg(any(
        feature = "native-tls",
        feature = "rustls-native",
        feature = "rustls-webpki"
    ))]
    {
        SparqlEvaluator::new().without_default_http_service_handler()
    }
    #[cfg(not(any(
        feature = "native-tls",
        feature = "rustls-native",
        feature = "rustls-webpki"
    )))]
    {
        SparqlEvaluator::new()
    }
}

fn data_quad(subject: &str, graph: &str) -> Quad {
    Quad::new(node(subject), node("urn:p"), node("urn:o"), node(graph))
}

fn node(value: &str) -> NamedNode {
    NamedNode::new_unchecked(OxString::new_owned(value))
}

fn form(pairs: &[(&str, &str)]) -> String {
    let mut serializer = form_urlencoded::Serializer::new(String::new());
    serializer.extend_pairs(pairs.iter().copied());
    serializer.finish()
}

fn target(path: &str, pairs: &[(&str, &str)]) -> String {
    format!("{path}?{}", form(pairs))
}

fn reserve_address() -> Result<SocketAddr> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let address = listener.local_addr()?;
    drop(listener);
    Ok(address)
}

fn send(
    address: SocketAddr,
    method: &str,
    target: &str,
    content_type: Option<&str>,
    accept: Option<&str>,
    body: &str,
) -> Result<RawResponse> {
    let mut request =
        format!("{method} {target} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n");
    if let Some(content_type) = content_type {
        write!(&mut request, "Content-Type: {content_type}\r\n")?;
    }
    if let Some(accept) = accept {
        write!(&mut request, "Accept: {accept}\r\n")?;
    }
    write!(&mut request, "Content-Length: {}\r\n\r\n{body}", body.len())?;

    let mut stream = connect(address)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(request.as_bytes())?;
    stream.shutdown(Shutdown::Write)?;
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    RawResponse::parse(&bytes)
}

fn connect(address: SocketAddr) -> Result<TcpStream> {
    let mut last_error = None;
    for _ in 0..50 {
        match TcpStream::connect_timeout(&address, Duration::from_millis(20)) {
            Ok(stream) => return Ok(stream),
            Err(error) => {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
    Err(last_error
        .context("HTTP server did not accept a connection")?
        .into())
}

struct RawResponse {
    status: u16,
    body: Vec<u8>,
}

impl RawResponse {
    fn parse(bytes: &[u8]) -> Result<Self> {
        let split = bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .context("HTTP response has no header terminator")?;
        let head = str::from_utf8(&bytes[..split])?;
        let status = head
            .lines()
            .next()
            .context("HTTP response has no status line")?
            .split_whitespace()
            .nth(1)
            .context("HTTP response has no status code")?
            .parse()?;
        Ok(Self {
            status,
            body: bytes[split + 4..].to_vec(),
        })
    }

    fn body_text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}
