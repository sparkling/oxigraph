#![expect(clippy::panic_in_result_fn)]

use super::*;
use oxhttp::model::header::CONTENT_TYPE;
use oxhttp::model::{Body, Method, Request, Response, StatusCode};
#[cfg(feature = "rdf-12")]
use oxigraph::model::RdfVersion;
use oxigraph::model::{GraphName, NamedOrBlankNode, Quad, Term};
#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
use oxigraph::sparql::EgressPolicy;
use oxigraph::store::Store;
use std::collections::BTreeSet;
use std::error::Error;
use std::io;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const BASIC_FEDERATED_QUERY_IRI: &str =
    "http://www.w3.org/ns/sparql-service-description#BasicFederatedQuery";
const INPUT_FORMAT_IRI: &str = "http://www.w3.org/ns/sparql-service-description#inputFormat";
const REMOTE_GRAPH_BODY: &[u8] = b"<urn:remote:s> <urn:remote:p> <urn:remote:o> .\n";
const SERVICE_RESULTS_BODY: &[u8] = br#"{"head":{"vars":["s","p","o"]},"results":{"bindings":[]}}"#;

fn graph(kind: EndpointKind, entailment: QueryEntailment) -> Vec<Triple> {
    let evaluator = SparqlEvaluator::new();
    graph_with_evaluator(&evaluator, kind, false, entailment)
}

fn graph_with_evaluator(
    evaluator: &SparqlEvaluator,
    kind: EndpointKind,
    union_default_graph: bool,
    entailment: QueryEntailment,
) -> Vec<Triple> {
    generate_service_description_graph(
        RdfFormat::Turtle,
        kind,
        union_default_graph,
        entailment,
        "http://example.test/sparql".into(),
        evaluator,
    )
}

fn root(graph: &[Triple]) -> Result<NamedOrBlankNode, Box<dyn Error>> {
    graph
        .iter()
        .find(|triple| {
            triple.predicate == rdf::TYPE && triple.object == Term::NamedNode(sd::SERVICE)
        })
        .map(|triple| triple.subject.clone())
        .ok_or_else(|| io::Error::other("service description root is missing").into())
}

fn has_object(
    graph: &[Triple],
    subject: &NamedOrBlankNode,
    predicate: &NamedNode,
    object: &NamedNode,
) -> bool {
    graph.iter().any(|triple| {
        triple.subject == *subject
            && triple.predicate == *predicate
            && triple.object == Term::NamedNode(object.clone())
    })
}

fn object_iris(graph: &[Triple], predicate: &NamedNode) -> BTreeSet<String> {
    graph
        .iter()
        .filter(|triple| triple.predicate == *predicate)
        .filter_map(|triple| match &triple.object {
            Term::NamedNode(node) => Some(node.as_str().to_owned()),
            _ => None,
        })
        .collect()
}

fn input_formats(graph: &[Triple]) -> BTreeSet<String> {
    object_iris(graph, &NamedNode::new_unchecked(INPUT_FORMAT_IRI))
}

fn supported_input_formats() -> BTreeSet<String> {
    supported_rdf_formats()
        .into_iter()
        .map(|format| format.iri().to_owned())
        .collect()
}

fn remote_claims(evaluator: &SparqlEvaluator) -> (bool, BTreeSet<String>) {
    let query = graph_with_evaluator(
        evaluator,
        EndpointKind {
            query: true,
            update: false,
        },
        false,
        QueryEntailment::Simple,
    );
    let update = graph_with_evaluator(
        evaluator,
        EndpointKind {
            query: false,
            update: true,
        },
        false,
        QueryEntailment::Simple,
    );
    (
        object_iris(&query, &sd::FEATURE).contains(BASIC_FEDERATED_QUERY_IRI),
        input_formats(&update),
    )
}

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
fn policy_with(origin_ip: Ipv4Addr, allowed_ip: Ipv4Addr) -> EgressPolicy {
    EgressPolicy::deny_all()
        .allow_origin(&format!("http://{origin_ip}:8080"))
        .expect("the literal-IP test origin is valid")
        .allow_ip(IpAddr::V4(allowed_ip))
}

struct LoopbackHttpProbe {
    iri: String,
    stop: Sender<()>,
    handle: Option<JoinHandle<io::Result<usize>>>,
}

impl LoopbackHttpProbe {
    fn spawn(path: &str, content_type: &'static str, body: &'static [u8]) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let iri = format!("http://{}{}", listener.local_addr()?, path);
        let (stop, stop_receiver) = mpsc::channel();
        let handle =
            thread::spawn(move || serve_http_or_stop(listener, &stop_receiver, content_type, body));
        Ok(Self {
            iri,
            stop,
            handle: Some(handle),
        })
    }

    fn iri(&self) -> &str {
        &self.iri
    }

    fn finish(mut self) -> io::Result<usize> {
        if self.stop.send(()).is_err() {
            // The responder has already completed after observing a connection.
        }
        self.join()
    }

    fn join(&mut self) -> io::Result<usize> {
        self.handle
            .take()
            .ok_or_else(|| io::Error::other("loopback probe was already joined"))?
            .join()
            .map_err(|_| io::Error::other("loopback probe thread panicked"))?
    }
}

impl Drop for LoopbackHttpProbe {
    fn drop(&mut self) {
        if self.stop.send(()).is_err() {
            // The responder has already completed after observing a connection.
        }
        if self.handle.is_some() {
            drop(self.join());
        }
    }
}

fn serve_http_or_stop(
    listener: TcpListener,
    stop: &Receiver<()>,
    content_type: &str,
    body: &[u8],
) -> io::Result<usize> {
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                serve_http_response(&mut stream, content_type, body)?;
                return Ok(1);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(error),
        }
        match stop.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => return Ok(0),
            Err(TryRecvError::Empty) => thread::yield_now(),
        }
    }
}

fn serve_http_response(stream: &mut TcpStream, content_type: &str, body: &[u8]) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut request = Vec::new();
    while !request.windows(4).any(|part| part == b"\r\n\r\n") {
        let mut buffer = [0; 1024];
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "loopback request ended before its headers",
            ));
        }
        request.extend_from_slice(&buffer[..read]);
        if request.len() > 64 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "loopback request headers are too large",
            ));
        }
    }
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)?;
    stream.flush()?;
    stream.shutdown(Shutdown::Write)
}

fn service_request(
    store: &Store,
    evaluator: &SparqlEvaluator,
    service_iri: &str,
) -> Result<Response<Body>, crate::HttpError> {
    let query = format!("ASK WHERE {{ SERVICE <{service_iri}> {{ ?s ?p ?o }} }}");
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("http://localhost/query")
        .header(CONTENT_TYPE, "application/sparql-query")
        .header("Accept", "application/sparql-results+json")
        .body(Body::from(query))
        .expect("the test SERVICE request is valid");
    crate::handle_request(
        &mut request,
        store,
        evaluator,
        false,
        false,
        QueryEntailment::Simple,
        None,
    )
}

fn load_request(
    store: &Store,
    evaluator: &SparqlEvaluator,
    source_iri: &str,
    loaded_graph: &NamedNode,
) -> Result<Response<Body>, crate::HttpError> {
    let update = format!(
        concat!(
            "INSERT DATA {{ <urn:local:s> <urn:local:p> <urn:local:o> }}; ",
            "LOAD <{}> INTO GRAPH {}"
        ),
        source_iri, loaded_graph
    );
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("http://localhost/update")
        .header(CONTENT_TYPE, "application/sparql-update")
        .body(Body::from(update))
        .expect("the test LOAD request is valid");
    crate::handle_request(
        &mut request,
        store,
        evaluator,
        false,
        false,
        QueryEntailment::Simple,
        None,
    )
}

fn response_body(
    result: Result<Response<Body>, crate::HttpError>,
    expected_status: StatusCode,
) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut response = result.map_err(|(status, message)| {
        io::Error::other(format!(
            "expected HTTP {expected_status}, got HTTP {status}: {message}"
        ))
    })?;
    assert_eq!(response.status(), expected_status);
    let mut body = Vec::new();
    response.body_mut().read_to_end(&mut body)?;
    Ok(body)
}

fn assert_exact_error(result: Result<Response<Body>, crate::HttpError>, expected_message: &str) {
    match result {
        Err((status, message)) => {
            assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
            assert_eq!(message, expected_message);
        }
        Ok(response) => panic!(
            "expected HTTP {} with {expected_message:?}, got HTTP {}",
            StatusCode::INTERNAL_SERVER_ERROR,
            response.status()
        ),
    }
}

#[test]
fn query_description_advertises_only_established_language_and_version() {
    let graph = graph(
        EndpointKind {
            query: true,
            update: false,
        },
        QueryEntailment::Simple,
    );
    assert_eq!(
        object_iris(&graph, &sd::SUPPORTED_LANGUAGE),
        BTreeSet::from([
            sd::SPARQL_10_QUERY.as_str().to_owned(),
            sd::SPARQL_11_QUERY.as_str().to_owned(),
        ])
    );
    assert_eq!(
        object_iris(&graph, &sd::SUPPORTED_VERSION),
        BTreeSet::from([sd::VERSION_11.as_str().to_owned()])
    );
}

#[test]
fn update_description_advertises_only_established_language_and_version() {
    let graph = graph(
        EndpointKind {
            query: false,
            update: true,
        },
        QueryEntailment::Simple,
    );
    assert_eq!(
        object_iris(&graph, &sd::SUPPORTED_LANGUAGE),
        BTreeSet::from([sd::SPARQL_11_UPDATE.as_str().to_owned()])
    );
    assert_eq!(
        object_iris(&graph, &sd::SUPPORTED_VERSION),
        BTreeSet::from([sd::VERSION_11.as_str().to_owned()])
    );
}

#[test]
fn result_format_iris_are_exact_for_each_endpoint_kind() {
    let query = graph(
        EndpointKind {
            query: true,
            update: false,
        },
        QueryEntailment::Simple,
    );
    let expected = [
        QueryResultsFormat::Json.iri(),
        QueryResultsFormat::Xml.iri(),
        QueryResultsFormat::Csv.iri(),
        QueryResultsFormat::Tsv.iri(),
        RdfFormat::NTriples.iri(),
        RdfFormat::NQuads.iri(),
        RdfFormat::Turtle.iri(),
        RdfFormat::TriG.iri(),
        RdfFormat::N3.iri(),
        RdfFormat::RdfXml.iri(),
        RdfFormat::JsonLd {
            profile: JsonLdProfileSet::empty(),
        }
        .iri(),
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    assert_eq!(object_iris(&query, &sd::RESULT_FORMAT), expected);

    let update = graph(
        EndpointKind {
            query: false,
            update: true,
        },
        QueryEntailment::Simple,
    );
    assert!(object_iris(&update, &sd::RESULT_FORMAT).is_empty());
}

#[test]
fn input_format_iris_match_the_rdf_load_surface() {
    let query = graph(
        EndpointKind {
            query: true,
            update: false,
        },
        QueryEntailment::Simple,
    );
    assert!(input_formats(&query).is_empty());
    let expected = if object_iris(&query, &sd::FEATURE).contains(BASIC_FEDERATED_QUERY_IRI) {
        supported_input_formats()
    } else {
        BTreeSet::new()
    };

    let update = graph(
        EndpointKind {
            query: false,
            update: true,
        },
        QueryEntailment::Simple,
    );
    assert_eq!(input_formats(&update), expected);
}

#[test]
fn advertised_features_are_an_exact_capability_set() {
    let query = graph(
        EndpointKind {
            query: true,
            update: false,
        },
        QueryEntailment::Simple,
    );
    let mut expected = BTreeSet::from([sd::EMPTY_GRAPHS.as_str().to_owned()]);
    let update = graph(
        EndpointKind {
            query: false,
            update: true,
        },
        QueryEntailment::Simple,
    );
    if !input_formats(&update).is_empty() {
        expected.insert(BASIC_FEDERATED_QUERY_IRI.to_owned());
    }
    assert_eq!(object_iris(&query, &sd::FEATURE), expected);

    let evaluator = SparqlEvaluator::new();
    let union = generate_service_description_graph(
        RdfFormat::Turtle,
        EndpointKind {
            query: true,
            update: true,
        },
        true,
        QueryEntailment::Simple,
        "http://example.test/sparql".into(),
        &evaluator,
    );
    expected.insert(sd::UNION_DEFAULT_GRAPH.as_str().to_owned());
    assert_eq!(object_iris(&union, &sd::FEATURE), expected);
}

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
#[test]
fn deny_all_policy_suppresses_remote_service_and_load_claims() {
    let evaluator = SparqlEvaluator::new().with_egress_policy(EgressPolicy::deny_all());
    assert_eq!(remote_claims(&evaluator), (false, BTreeSet::new()));
}

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
#[test]
fn mismatched_origin_and_ip_suppress_remote_service_and_load_claims() {
    let evaluator = SparqlEvaluator::new().with_egress_policy(policy_with(
        Ipv4Addr::new(127, 0, 0, 1),
        Ipv4Addr::new(127, 0, 0, 2),
    ));
    assert_eq!(remote_claims(&evaluator), (false, BTreeSet::new()));
}

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
#[test]
fn matching_origin_and_ip_enable_remote_service_and_load_claims() {
    let evaluator = SparqlEvaluator::new().with_egress_policy(policy_with(
        Ipv4Addr::new(127, 0, 0, 1),
        Ipv4Addr::new(127, 0, 0, 1),
    ));
    assert_eq!(remote_claims(&evaluator), (true, supported_input_formats()));
}

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
#[test]
fn disabled_default_http_service_handler_only_suppresses_federation_claim() {
    let evaluator = SparqlEvaluator::new()
        .with_egress_policy(policy_with(
            Ipv4Addr::new(127, 0, 0, 1),
            Ipv4Addr::new(127, 0, 0, 1),
        ))
        .without_default_http_service_handler();
    assert_eq!(
        remote_claims(&evaluator),
        (false, supported_input_formats())
    );
}

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
#[test]
fn server_profile_denies_remote_egress_by_default() {
    assert_eq!(
        remote_claims(&crate::sparql_evaluator()),
        (false, BTreeSet::new())
    );
}

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
#[test]
fn server_endpoints_use_the_shared_deny_all_evaluator() -> Result<(), Box<dyn Error>> {
    let main_source = include_str!("../main.rs");
    assert_eq!(
        main_source
            .matches("let mut evaluator = SparqlEvaluator::new();")
            .count(),
        2,
        "standalone query and update must each construct a permissive evaluator"
    );
    assert_eq!(
        main_source
            .matches("let mut evaluator = sparql_evaluator();")
            .count(),
        0,
        "standalone commands must not reuse the server's deny-all evaluator factory"
    );

    let service_probe = LoopbackHttpProbe::spawn(
        "/sparql",
        "application/sparql-results+json",
        SERVICE_RESULTS_BODY,
    )?;
    let load_probe =
        LoopbackHttpProbe::spawn("/blocked.nt", "application/n-triples", REMOTE_GRAPH_BODY)?;
    let loaded_graph = NamedNode::new_unchecked("urn:test:blocked-load");
    let store = Store::new()?;
    let evaluator = crate::sparql_evaluator();

    let mut query_description_request = Request::builder()
        .uri("http://localhost/query")
        .header("Accept", "application/n-triples")
        .body(Body::empty())?;
    let query_description = String::from_utf8(response_body(
        crate::handle_request(
            &mut query_description_request,
            &store,
            &evaluator,
            false,
            true,
            QueryEntailment::Simple,
            None,
        ),
        StatusCode::OK,
    )?)?;
    assert!(!query_description.contains(BASIC_FEDERATED_QUERY_IRI));
    assert!(query_description.contains(sd::UNION_DEFAULT_GRAPH.as_str()));

    let mut update_description_request = Request::builder()
        .uri("http://localhost/update")
        .header("Accept", "application/n-triples")
        .body(Body::empty())?;
    let update_description = String::from_utf8(response_body(
        crate::handle_request(
            &mut update_description_request,
            &store,
            &evaluator,
            false,
            true,
            QueryEntailment::Simple,
            None,
        ),
        StatusCode::OK,
    )?)?;
    assert!(!update_description.contains(INPUT_FORMAT_IRI));
    assert!(update_description.contains(sd::UNION_DEFAULT_GRAPH.as_str()));

    let service_result = service_request(&store, &evaluator, service_probe.iri());
    let load_result = load_request(&store, &evaluator, load_probe.iri(), &loaded_graph);
    assert_exact_error(service_result, "SERVICE egress request: policy denied");
    assert_exact_error(load_result, "LOAD egress request: policy denied");

    assert_eq!(
        (
            service_probe.finish()?,
            load_probe.finish()?,
            store.len()?,
            store.contains_named_graph(&loaded_graph.into())?,
        ),
        (0, 0, 0, false),
        "the server must deny SERVICE and LOAD before connecting and roll back the complete update"
    );
    Ok(())
}

#[cfg(not(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
)))]
#[test]
fn direct_default_load_claim_matches_compiled_remote_behavior() -> Result<(), Box<dyn Error>> {
    let evaluator = SparqlEvaluator::new();
    let (_, advertised_formats) = remote_claims(&evaluator);
    assert!(
        advertised_formats.is_empty() || advertised_formats == supported_input_formats(),
        "the default evaluator must advertise either the complete LOAD surface or none of it"
    );

    let probe = LoopbackHttpProbe::spawn("/direct.nt", "application/n-triples", REMOTE_GRAPH_BODY)?;
    let loaded_graph = NamedNode::new_unchecked("urn:test:direct-default-load");
    let store = Store::new()?;
    let result = load_request(&store, &evaluator, probe.iri(), &loaded_graph);
    let succeeded = match result {
        Ok(mut response) => {
            assert_eq!(response.status(), StatusCode::NO_CONTENT);
            io::copy(response.body_mut(), &mut io::sink())?;
            true
        }
        Err(_) => false,
    };
    let advertised = !advertised_formats.is_empty();
    assert_eq!(
        (
            succeeded,
            probe.finish()?,
            store.len()?,
            store.contains_named_graph(&loaded_graph.into())?,
        ),
        if advertised {
            (true, 1, 2, true)
        } else {
            (false, 0, 0, false)
        },
        "the advertised remote LOAD claim must match the dependency-unified evaluator's real loopback behavior"
    );
    Ok(())
}

#[cfg(not(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
)))]
#[test]
#[ignore = "run only in the dependency-qualified Oxigraph HTTP/TLS compatibility profile"]
fn dependency_qualified_library_tls_is_enforced_without_cli_tls() -> Result<(), Box<dyn Error>> {
    let direct = SparqlEvaluator::new();
    assert_eq!(
        remote_claims(&direct),
        (true, supported_input_formats()),
        "dependency-qualified HTTP/TLS must remain visible to the direct evaluator"
    );

    let direct_service_probe = LoopbackHttpProbe::spawn(
        "/direct-service",
        "application/sparql-results+json",
        SERVICE_RESULTS_BODY,
    )?;
    let direct_load_probe = LoopbackHttpProbe::spawn(
        "/direct-load.nt",
        "application/n-triples",
        REMOTE_GRAPH_BODY,
    )?;
    let direct_graph = NamedNode::new_unchecked("urn:test:dependency-qualified-direct-load");
    let direct_store = Store::new()?;
    assert!(
        !response_body(
            service_request(&direct_store, &direct, direct_service_probe.iri()),
            StatusCode::OK,
        )?
        .is_empty()
    );
    assert!(
        response_body(
            load_request(
                &direct_store,
                &direct,
                direct_load_probe.iri(),
                &direct_graph,
            ),
            StatusCode::NO_CONTENT,
        )?
        .is_empty()
    );
    assert_eq!(
        (
            direct_service_probe.finish()?,
            direct_load_probe.finish()?,
            direct_store.len()?,
            direct_store.contains_named_graph(&direct_graph.into())?,
        ),
        (1, 1, 2, true),
        "the direct evaluator must execute dependency-qualified SERVICE and LOAD"
    );

    let server = crate::sparql_evaluator();
    assert_eq!(
        remote_claims(&server),
        (false, BTreeSet::new()),
        "the server factory must stay deny-all when CLI TLS cfg values are false"
    );
    let server_service_probe = LoopbackHttpProbe::spawn(
        "/server-service",
        "application/sparql-results+json",
        SERVICE_RESULTS_BODY,
    )?;
    let server_load_probe = LoopbackHttpProbe::spawn(
        "/server-load.nt",
        "application/n-triples",
        REMOTE_GRAPH_BODY,
    )?;
    let server_graph = NamedNode::new_unchecked("urn:test:dependency-qualified-server-load");
    let server_store = Store::new()?;
    assert_exact_error(
        service_request(&server_store, &server, server_service_probe.iri()),
        "SERVICE egress request: policy denied",
    );
    assert_exact_error(
        load_request(
            &server_store,
            &server,
            server_load_probe.iri(),
            &server_graph,
        ),
        "LOAD egress request: policy denied",
    );
    assert_eq!(
        (
            server_service_probe.finish()?,
            server_load_probe.finish()?,
            server_store.len()?,
            server_store.contains_named_graph(&server_graph.into())?,
        ),
        (0, 0, 0, false),
        "the server must deny before connect and roll back LOAD in the dependency-qualified profile"
    );
    Ok(())
}

#[test]
fn union_default_graph_is_disclosed_for_query_and_update_evaluation() {
    let evaluator = SparqlEvaluator::new();
    for (kind, expected) in [
        (
            EndpointKind {
                query: true,
                update: false,
            },
            true,
        ),
        (
            EndpointKind {
                query: false,
                update: true,
            },
            true,
        ),
        (
            EndpointKind {
                query: true,
                update: true,
            },
            true,
        ),
    ] {
        let description = graph_with_evaluator(&evaluator, kind, true, QueryEntailment::Simple);
        assert_eq!(
            object_iris(&description, &sd::FEATURE).contains(sd::UNION_DEFAULT_GRAPH.as_str()),
            expected,
            "UnionDefaultGraph must describe query and update dataset evaluation"
        );
    }
    let disabled = graph_with_evaluator(
        &evaluator,
        EndpointKind {
            query: true,
            update: true,
        },
        false,
        QueryEntailment::Simple,
    );
    assert!(
        !object_iris(&disabled, &sd::FEATURE).contains(sd::UNION_DEFAULT_GRAPH.as_str()),
        "UnionDefaultGraph must be absent when union-default evaluation is disabled"
    );
}

#[test]
fn query_only_endpoint_does_not_disclose_update_or_load_support() {
    let evaluator = SparqlEvaluator::new();
    let description = graph_with_evaluator(
        &evaluator,
        EndpointKind {
            query: true,
            update: false,
        },
        true,
        QueryEntailment::Simple,
    );
    assert!(
        !object_iris(&description, &sd::SUPPORTED_LANGUAGE).contains(sd::SPARQL_11_UPDATE.as_str())
    );
    assert!(input_formats(&description).is_empty());
    assert!(object_iris(&description, &sd::FEATURE).contains(sd::UNION_DEFAULT_GRAPH.as_str()));
}

#[test]
fn emitted_service_vocabulary_and_endpoint_shape_are_exact() -> Result<(), Box<dyn Error>> {
    let endpoint = "http://example.test/query";
    let evaluator = SparqlEvaluator::new();
    let graph = generate_service_description_graph(
        RdfFormat::NTriples,
        EndpointKind {
            query: true,
            update: false,
        },
        false,
        QueryEntailment::Simple,
        endpoint.into(),
        &evaluator,
    );
    let root = root(&graph)?;
    assert!(graph.iter().all(|triple| triple.subject == root));
    assert!(
        graph
            .iter()
            .all(|triple| matches!(triple.object, Term::NamedNode(_)))
    );
    assert_eq!(
        graph
            .iter()
            .map(ToString::to_string)
            .collect::<BTreeSet<_>>()
            .len(),
        graph.len(),
        "service descriptions must not repeat triples"
    );

    let endpoint_objects = object_iris(&graph, &sd::ENDPOINT);
    assert_eq!(endpoint_objects, BTreeSet::from([endpoint.to_owned()]));
    let service_types = object_iris(&graph, &rdf::TYPE);
    assert_eq!(
        service_types,
        BTreeSet::from([sd::SERVICE.as_str().to_owned()])
    );

    let expected_predicates = BTreeSet::from([
        rdf::TYPE.as_str().to_owned(),
        sd::DEFAULT_ENTAILMENT_REGIME.as_str().to_owned(),
        sd::ENDPOINT.as_str().to_owned(),
        sd::FEATURE.as_str().to_owned(),
        sd::RESULT_FORMAT.as_str().to_owned(),
        sd::SUPPORTED_LANGUAGE.as_str().to_owned(),
        sd::SUPPORTED_VERSION.as_str().to_owned(),
    ]);
    #[cfg(feature = "geosparql")]
    let expected_predicates = expected_predicates
        .into_iter()
        .chain([sd::EXTENSION_FUNCTION.as_str().to_owned()])
        .collect();
    assert_eq!(
        graph
            .iter()
            .map(|triple| triple.predicate.as_str().to_owned())
            .collect::<BTreeSet<_>>(),
        expected_predicates
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn serialized_description_uses_only_the_negotiated_rdf_version() {
    let kind = EndpointKind {
        query: true,
        update: false,
    };
    let evaluator = SparqlEvaluator::new();
    let rdf11 = generate_service_description(
        RdfResponseFormat::rdf11(RdfFormat::Turtle),
        kind,
        false,
        QueryEntailment::Simple,
        "http://example.test/query".into(),
        &evaluator,
    );
    assert!(!rdf11.starts_with(b"VERSION"));

    let rdf12 = generate_service_description(
        RdfResponseFormat::new(RdfFormat::Turtle, RdfVersion::V1_2),
        kind,
        false,
        QueryEntailment::Simple,
        "http://example.test/query".into(),
        &evaluator,
    );
    assert!(rdf12.starts_with(b"VERSION \"1.2\"\n"));
}

#[test]
fn empty_graph_feature_matches_store_remove_and_clear_behavior() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let graph_name = NamedNode::new_unchecked("urn:test:empty");
    let quad = Quad::new(
        NamedNode::new_unchecked("urn:test:s"),
        NamedNode::new_unchecked("urn:test:p"),
        NamedNode::new_unchecked("urn:test:o"),
        graph_name.clone(),
    );
    store.insert(quad.clone())?;
    store.remove(&quad)?;
    assert!(store.contains_named_graph(&graph_name.clone().into())?);

    store.insert(quad)?;
    store.clear_graph(&GraphName::from(graph_name.clone()))?;
    assert!(store.contains_named_graph(&graph_name.into())?);

    let description = graph(
        EndpointKind {
            query: true,
            update: true,
        },
        QueryEntailment::Simple,
    );
    assert!(has_object(
        &description,
        &root(&description)?,
        &sd::FEATURE,
        &sd::EMPTY_GRAPHS
    ));
    Ok(())
}

#[cfg(feature = "rdfs")]
#[test]
fn bounded_entailment_is_disclosed_only_on_query_endpoints() -> Result<(), Box<dyn Error>> {
    let profile = QueryEntailment::Rdfs12Finite;
    let query = graph(
        EndpointKind {
            query: true,
            update: false,
        },
        profile,
    );
    let query_root = root(&query)?;
    let Some(profile_iri) = profile.profile_iri() else {
        return Err("bounded entailment profile IRI is missing".into());
    };
    let Some(datatype_policy_iri) = profile.datatype_policy_iri() else {
        return Err("bounded entailment datatype policy IRI is missing".into());
    };
    for (predicate, object) in [
        (&sd::DEFAULT_ENTAILMENT_REGIME, profile.regime_iri()),
        (&sd::DEFAULT_SUPPORTED_ENTAILMENT_PROFILE, profile_iri),
        (
            &oxsd::UNDERLYING_ENTAILMENT_REGIME,
            profile.underlying_regime_iri(),
        ),
        (&oxsd::DATATYPE_MAP, datatype_policy_iri),
    ] {
        let object = NamedNode::new(object)?;
        assert!(has_object(&query, &query_root, predicate, &object));
    }
    assert_eq!(
        object_iris(&query, &oxsd::RECOGNIZED_DATATYPE),
        profile
            .recognized_datatypes()
            .into_iter()
            .map(|datatype| datatype.as_str().to_owned())
            .collect()
    );

    let update = graph(
        EndpointKind {
            query: false,
            update: true,
        },
        profile,
    );
    for predicate in [
        &sd::DEFAULT_ENTAILMENT_REGIME,
        &sd::DEFAULT_SUPPORTED_ENTAILMENT_PROFILE,
        &oxsd::UNDERLYING_ENTAILMENT_REGIME,
        &oxsd::DATATYPE_MAP,
        &oxsd::RECOGNIZED_DATATYPE,
    ] {
        assert!(object_iris(&update, predicate).is_empty());
    }
    Ok(())
}
