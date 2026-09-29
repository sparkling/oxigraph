//! Hermetic executable slice of the SPARQL 1.2 Federated Query boundary.
//!
//! The pinned 23 April 2026 Working Draft defines a successful `SERVICE` as a
//! SPARQL Protocol execution of `SELECT * WHERE Q`. A failed invocation is an
//! error, except that `SILENT` yields one empty solution mapping. Section 4's
//! variable-endpoint algorithm is informative, so its tests record supported
//! behavior without turning it into a normative conformance claim. Network
//! authorization and endpoint discovery remain deployment policy, not behavior
//! defined by this crate.

#![cfg(all(test, feature = "http-client", not(target_family = "wasm")))]
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "this integration-test crate directly exposes executable conformance cases"
)]

#[path = "sparql_service_http/support.rs"]
mod support;
#[path = "sparql_service_http/variable_service.rs"]
mod variable_service;

use oxigraph::model::{Literal, NamedNode};
#[cfg(feature = "rdf-12")]
use oxigraph::model::{Term, Triple};
use oxigraph::sparql::{
    HttpServiceFailure, HttpServiceObservation, QueryEvaluationError, QueryResults,
    SparqlEvaluator, SparqlVersion,
};
use oxigraph::store::Store;
use std::error::Error;
use std::io;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use support::{ObservedRequest, ResponseSpec, TestEndpoint};

static LOOPBACK_TEST_LOCK: Mutex<()> = Mutex::new(());

const JSON_LITERAL: &str = r#"{
  "head": {"vars": ["remote"]},
  "results": {"bindings": [
    {"remote": {"type": "literal", "value": "remote"}}
  ]}
}"#;

const JSON_BOOLEAN: &str = r#"{"head": {}, "boolean": true}"#;

const XML_LITERAL: &str = r#"<?xml version="1.0"?>
<sparql xmlns="http://www.w3.org/2005/sparql-results#">
  <head><variable name="remote"/></head>
  <results><result><binding name="remote"><literal>xml</literal></binding></result></results>
</sparql>"#;

#[cfg(feature = "rdf-12")]
const JSON_TRIPLE: &str = r#"{
  "head": {"vars": ["remote"], "version": "1.2"},
  "results": {"bindings": [{
    "remote": {"type": "triple", "value": {
      "subject": {"type": "uri", "value": "urn:triple:s"},
      "predicate": {"type": "uri", "value": "urn:triple:p"},
      "object": {"type": "literal", "value": "object"}
    }}
  }]}
}"#;

#[cfg(feature = "rdf-12")]
const XML_TRIPLE: &str = r#"<?xml version="1.0"?>
<sparql xmlns="http://www.w3.org/2005/sparql-results#">
  <head><variable name="remote"/></head>
  <results><result><binding name="remote"><triple>
    <subject><uri>urn:triple:s</uri></subject>
    <predicate><uri>urn:triple:p</uri></predicate>
    <object><literal>object</literal></object>
  </triple></binding></result></results>
</sparql>"#;

#[cfg(feature = "rdf-12")]
const JSON_TRIPLE_INLINE_11: &str = r#"{
  "head": {"vars": ["remote"], "version": "1.1"},
  "results": {"bindings": [{
    "remote": {"type": "triple", "value": {
      "subject": {"type": "uri", "value": "urn:triple:s"},
      "predicate": {"type": "uri", "value": "urn:triple:p"},
      "object": {"type": "literal", "value": "object"}
    }}
  }]}
}"#;

const JSON_NON_ASCII: &str = concat!(
    r#"{
  "head": {"vars": ["remote"]},
  "results": {"bindings": [
    {"remote": {"type": "literal", "value": "caf"#,
    "\u{e9}",
    r#""}}
  ]}
}"#
);

const JSON_BNODE: &str = r#"{
  "head": {"vars": ["node"]},
  "results": {"bindings": [
    {"node": {"type": "bnode", "value": "same-label"}}
  ]}
}"#;

#[test]
fn service_posts_select_and_joins_json_results() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json; charset=utf-8",
        JSON_LITERAL,
    )])?;
    let rows = select(
        SparqlEvaluator::new(),
        &format!(
            r#"SELECT ?local ?remote WHERE {{
                 VALUES ?local {{ "local" }}
                 SERVICE <{}> {{ ?s <urn:test:p> ?remote }}
               }}"#,
            endpoint.iri()
        ),
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("local"), Some(&Literal::from("local").into()));
    assert_eq!(rows[0].get("remote"), Some(&Literal::from("remote").into()));

    let requests = endpoint.finish()?;
    assert_eq!(requests.len(), 1);
    assert_service_request(&requests[0]);
    assert!(requests[0].body().contains("SELECT * WHERE"));
    assert!(requests[0].body().contains("<urn:test:p>"));
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn service_announces_the_effective_sparql_version() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();

    let legacy = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json",
        JSON_LITERAL,
    )])?;
    select(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_1),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            legacy.iri()
        ),
    )?;
    assert_service_request_with_version(&legacy.finish()?[0], SparqlVersion::V1_1);

    let basic = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json; version=1.2-basic",
        JSON_LITERAL,
    )])?;
    select(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2Basic),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            basic.iri()
        ),
    )?;
    assert_service_request_with_version(&basic.finish()?[0], SparqlVersion::V1_2Basic);

    let declared = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json; version=1.2",
        JSON_LITERAL,
    )])?;
    select(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_1),
        &format!(
            "VERSION \"1.2\" SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            declared.iri()
        ),
    )?;
    assert_service_request_with_version(&declared.finish()?[0], SparqlVersion::V1_2);
    Ok(())
}

#[test]
fn service_accepts_xml_results_with_media_parameters() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "Application/SPARQL-Results+XML ; charset=utf-8",
        XML_LITERAL,
    )])?;
    let rows = select(
        SparqlEvaluator::new(),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            endpoint.iri()
        ),
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("remote"), Some(&Literal::from("xml").into()));
    assert_service_request(&endpoint.finish()?[0]);
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn service_parses_sparql12_triple_term_results() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let json_endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json",
        JSON_TRIPLE,
    )])?;
    let rows = select(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
        &format!(
            "VERSION \"1.2\" SELECT ?remote WHERE {{
               SERVICE <{}> {{ ?s ?p ?remote }}
             }}",
            json_endpoint.iri()
        ),
    )?;
    let expected: Term = Triple::new(
        NamedNode::new("urn:triple:s")?,
        NamedNode::new("urn:triple:p")?,
        Literal::from("object"),
    )
    .into();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("remote"), Some(&expected));
    assert_service_request(&json_endpoint.finish()?[0]);

    let xml_endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+xml; version=1.2",
        XML_TRIPLE,
    )])?;
    let rows = select(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
        &format!(
            "VERSION \"1.2\" SELECT ?remote WHERE {{
               SERVICE <{}> {{ ?s ?p ?remote }}
             }}",
            xml_endpoint.iri()
        ),
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("remote"), Some(&expected));
    assert_service_request(&xml_endpoint.finish()?[0]);
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn service_content_type_version_overrides_inline_results_version() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();

    let evaluator_rejected = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json; version=1.2",
        JSON_TRIPLE,
    )])?;
    let result = select(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_1),
        &format!(
            "SELECT ?remote WHERE {{
               SERVICE <{}> {{ ?s ?p ?remote }}
             }}",
            evaluator_rejected.iri()
        ),
    );
    assert_service_request_with_version(&evaluator_rejected.finish()?[0], SparqlVersion::V1_1);
    assert!(
        result.is_err(),
        "a SPARQL 1.1 evaluator accepted a triple term from a 1.2 SERVICE response"
    );

    let rejected = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json; version=1.1",
        JSON_TRIPLE,
    )])?;
    let result = select(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
        &format!(
            "VERSION \"1.2\" SELECT ?remote WHERE {{
               SERVICE <{}> {{ ?s ?p ?remote }}
             }}",
            rejected.iri()
        ),
    );
    assert_service_request(&rejected.finish()?[0]);
    result.unwrap_err();

    let accepted = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json; version=1.2",
        JSON_TRIPLE_INLINE_11,
    )])?;
    let rows = select(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
        &format!(
            "VERSION \"1.2\" SELECT ?remote WHERE {{
               SERVICE <{}> {{ ?s ?p ?remote }}
             }}",
            accepted.iri()
        ),
    )?;
    assert_eq!(rows.len(), 1);
    assert!(rows[0].get("remote").is_some_and(Term::is_triple));
    assert_service_request(&accepted.finish()?[0]);
    Ok(())
}

#[test]
fn service_enforces_declared_ascii_result_charset() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json; charset=us-ascii",
        JSON_NON_ASCII,
    )])?;
    let result = select(
        SparqlEvaluator::new(),
        &format!(
            "SELECT ?remote WHERE {{ SERVICE <{}> {{ ?s ?p ?remote }} }}",
            endpoint.iri()
        ),
    );
    assert_service_request(&endpoint.finish()?[0]);
    result.unwrap_err();
    Ok(())
}

#[test]
fn service_silent_suppresses_http_status_failure() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::status(
        "503 Service Unavailable",
        "down",
    )])?;
    let rows = select(
        SparqlEvaluator::new(),
        &format!(
            r#"SELECT ?input ?remote WHERE {{
                 VALUES ?input {{ "kept" }}
                 SERVICE SILENT <{}> {{ ?s ?p ?remote }}
               }}"#,
            endpoint.iri()
        ),
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("input"), Some(&Literal::from("kept").into()));
    assert_eq!(rows[0].get("remote"), None);
    assert_service_request(&endpoint.finish()?[0]);
    Ok(())
}

#[test]
fn service_without_silent_propagates_http_status_failure() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::status(
        "503 Service Unavailable",
        "down",
    )])?;
    let result = select(
        SparqlEvaluator::new(),
        &format!(
            "SELECT * WHERE {{ SERVICE <{}> {{ ?s ?p ?o }} }}",
            endpoint.iri()
        ),
    );
    let requests = endpoint.finish()?;
    assert_service_request(&requests[0]);
    let Err(error) = result else {
        return Err(io::Error::other("non-SILENT SERVICE accepted an HTTP failure").into());
    };
    assert!(error.to_string().contains("503"));
    Ok(())
}

#[test]
fn service_silent_suppresses_invalid_result_media_type() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok("text/html", "<html/>")])?;
    let rows = select(
        SparqlEvaluator::new(),
        &format!(
            "SELECT ?input WHERE {{
                 VALUES ?input {{ 7 }}
                 SERVICE SILENT <{}> {{ ?s ?p ?o }}
               }}",
            endpoint.iri()
        ),
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("input"), Some(&Literal::from(7).into()));
    assert_service_request(&endpoint.finish()?[0]);
    Ok(())
}

#[test]
fn service_timeout_is_a_silent_invocation_failure() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::delayed(
        "application/sparql-results+json",
        JSON_LITERAL,
        Duration::from_millis(150),
    )])?;
    let rows = select(
        SparqlEvaluator::new().with_http_timeout(Duration::from_millis(20)),
        &format!(
            "SELECT ?input WHERE {{
                 VALUES ?input {{ 9 }}
                 SERVICE SILENT <{}> {{ ?s ?p ?o }}
               }}",
            endpoint.iri()
        ),
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get("input"), Some(&Literal::from(9).into()));
    assert_service_request(&endpoint.finish()?[0]);
    Ok(())
}

#[test]
fn service_boolean_response_error_names_the_actual_endpoint() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();

    let observation = HttpServiceObservation::new(4)?;
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json",
        JSON_BOOLEAN,
    )])?;
    let iri = endpoint.iri().to_owned();
    let outcome = select_outcome(
        SparqlEvaluator::new().with_http_service_observation(observation.clone()),
        &format!("SELECT * WHERE {{ SERVICE <{iri}> {{ ?s ?p ?o }} }}"),
    )?;
    let requests = endpoint.finish()?;
    assert_eq!(requests.len(), 1, "one SERVICE invocation is one request");
    assert_service_request(&requests[0]);

    let Err(error) = outcome else {
        return Err(io::Error::other("non-SILENT SERVICE accepted a Boolean").into());
    };
    assert!(
        matches!(error, QueryEvaluationError::Service(_)),
        "a Boolean response must stay a typed SERVICE error, got {error:?}"
    );
    let message = error.to_string();
    assert!(
        message.contains("No valid SPARQL solutions returned by"),
        "unexpected error text: {message}"
    );
    assert!(
        message.contains(&iri),
        "the error must name the actual endpoint: {message}"
    );
    assert!(
        !message.contains("{service_name}"),
        "the error must not carry the literal placeholder: {message}"
    );
    assert_boolean_rejection_observed(&observation, &iri);

    let silent_observation = HttpServiceObservation::new(4)?;
    let silent_endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/sparql-results+json",
        JSON_BOOLEAN,
    )])?;
    let silent_iri = silent_endpoint.iri().to_owned();
    let silent = select_outcome(
        SparqlEvaluator::new().with_http_service_observation(silent_observation.clone()),
        &format!(
            r#"SELECT ?input ?remote WHERE {{
                 VALUES ?input {{ "kept" }}
                 SERVICE SILENT <{silent_iri}> {{ ?s ?p ?remote }}
               }}"#
        ),
    )??;
    let silent_requests = silent_endpoint.finish()?;
    assert_eq!(
        silent_requests.len(),
        1,
        "SILENT SERVICE still issues one request"
    );
    assert_service_request(&silent_requests[0]);
    assert_eq!(
        silent.len(),
        1,
        "SILENT must yield exactly the incoming empty mapping"
    );
    assert_eq!(silent[0].get("input"), Some(&Literal::from("kept").into()));
    assert_eq!(silent[0].get("remote"), None);
    assert_boolean_rejection_observed(&silent_observation, &silent_iri);
    Ok(())
}

fn assert_boolean_rejection_observed(observation: &HttpServiceObservation, iri: &str) {
    let snapshot = observation.snapshot();
    assert_eq!(snapshot.attempts(), 1, "one logical attempt");
    assert_eq!(snapshot.dispatches(), 1, "one admitted dispatch");
    assert_eq!(snapshot.failed(), 1, "a Boolean response is one failure");
    assert_eq!(
        snapshot.completed(),
        0,
        "a Boolean response never completes"
    );
    assert_eq!(snapshot.abandoned(), 0, "a failure is not abandoned");
    assert_eq!(snapshot.in_progress(), 0, "no stream is left alive");
    assert_eq!(snapshot.rows(), 0, "a Boolean response parses no rows");
    assert_eq!(
        snapshot.records().len(),
        1,
        "one attempt retains one record"
    );
    assert_eq!(
        snapshot.records()[0].failure(),
        Some(HttpServiceFailure::ResultStream),
        "a Boolean response keeps the fixed result-stream category"
    );
    let rendered = format!("{observation:?} {snapshot:?}");
    assert!(
        !rendered.contains(iri),
        "telemetry must not retain the endpoint IRI"
    );
    assert!(
        !rendered.contains("127.0.0.1"),
        "telemetry must not retain the endpoint address"
    );
}

fn select(
    evaluator: SparqlEvaluator,
    query: &str,
) -> Result<Vec<oxigraph::sparql::QuerySolution>, Box<dyn Error>> {
    let store = Store::new()?;
    let QueryResults::Solutions(rows) = evaluator.parse_query(query)?.on_store(&store).execute()?
    else {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "expected SELECT results").into());
    };
    Ok(rows.collect::<Result<_, _>>()?)
}

fn select_outcome(
    evaluator: SparqlEvaluator,
    query: &str,
) -> Result<Result<Vec<oxigraph::sparql::QuerySolution>, QueryEvaluationError>, Box<dyn Error>> {
    let store = Store::new()?;
    let bound = evaluator.parse_query(query)?.on_store(&store);
    let outcome = match bound.execute() {
        Ok(QueryResults::Solutions(solutions)) => solutions.collect::<Result<Vec<_>, _>>(),
        Ok(_) => return Err(io::Error::other("expected SELECT results").into()),
        Err(error) => Err(error),
    };
    Ok(outcome)
}

fn loopback_test_lock() -> MutexGuard<'static, ()> {
    LOOPBACK_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn assert_service_request(request: &ObservedRequest) {
    assert_service_request_with_version(request, SparqlVersion::current());
}

fn assert_service_request_with_version(request: &ObservedRequest, version: SparqlVersion) {
    assert_eq!(
        request.method(),
        "POST",
        "SERVICE must use a SPARQL Protocol POST"
    );
    assert_eq!(
        request.target(),
        "/sparql",
        "SERVICE must target the endpoint IRI path"
    );
    let (content_type, accept) = match version {
        SparqlVersion::V1_1 => (
            "application/sparql-query",
            "application/sparql-results+json, application/sparql-results+xml",
        ),
        SparqlVersion::V1_2Basic => (
            "application/sparql-query; version=1.2-basic",
            "application/sparql-results+json; version=1.2-basic, application/sparql-results+xml; version=1.2-basic, application/sparql-results+json, application/sparql-results+xml",
        ),
        SparqlVersion::V1_2 => (
            "application/sparql-query; version=1.2",
            "application/sparql-results+json; version=1.2, application/sparql-results+xml; version=1.2, application/sparql-results+json, application/sparql-results+xml",
        ),
        _ => unreachable!("unsupported SPARQL version"),
    };
    assert_eq!(
        request.header("content-type"),
        Some(content_type),
        "SERVICE must send a direct SPARQL query body"
    );
    assert_eq!(
        request.header("accept"),
        Some(accept),
        "SERVICE must negotiate supported solution result media types"
    );
}
