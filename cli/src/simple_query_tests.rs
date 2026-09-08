//! Native Simple query routing must retain the materialized path's dataset contract.
#![expect(
    clippy::panic_in_result_fn,
    clippy::unwrap_in_result,
    reason = "protocol assertions in focused tests"
)]
use super::*;
use anyhow::Result;
use assert_fs::TempDir;
use oxigraph::store::{EvaluationOperation, EvaluationOutcome};

const DATA: &str = concat!(
    "<urn:default> <urn:p> <urn:o> . ",
    "<urn:g1> { _:shared <urn:p> <urn:o> . <urn:ground> <urn:p> <urn:o> } ",
    "<urn:g2> { _:shared <urn:p> <urn:o> . <urn:ground> <urn:p> <urn:o> } ",
    "<urn:empty> {} _:empty {}",
);

fn load(store: &Store) -> Result<()> {
    store.load_from_slice(RdfParser::from_format(RdfFormat::TriG), DATA)?;
    Ok(())
}

fn response(
    store: &Store,
    evaluator: &SparqlEvaluator,
    query: &str,
    union: bool,
    defaults: &[&str],
    named: &[&str],
) -> Result<Response<Body>, HttpError> {
    let request = Request::builder()
        .uri("http://localhost/query")
        .header(
            ACCEPT,
            if query.starts_with("ASK") {
                "application/sparql-results+json"
            } else {
                "text/csv"
            },
        )
        .body(Body::empty())
        .unwrap();
    evaluate_sparql_query(
        store,
        evaluator,
        query,
        None,
        union,
        defaults.iter().map(|s| (*s).into()).collect(),
        named.iter().map(|s| (*s).into()).collect(),
        &request,
        QueryEntailment::Simple,
        None,
    )
}

fn body(mut response: Response<Body>) -> Result<String> {
    assert_eq!(response.status(), StatusCode::OK);
    Ok(io::read_to_string(response.body_mut())?)
}

fn assert_dataset_queries(store: &Store) -> Result<()> {
    let evaluator = sparql_evaluator();
    for (query, union, expected) in [
        (
            "SELECT (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?o }",
            false,
            "n\r\n1\r\n",
        ),
        (
            "SELECT (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?o }",
            true,
            "n\r\n2\r\n",
        ),
        ("ASK { <urn:default> <urn:p> <urn:o> }", true, "false"),
        (
            "SELECT (COUNT(*) AS ?n) FROM <urn:g1> FROM <urn:g2> WHERE { ?s <urn:p> ?o }",
            false,
            "n\r\n3\r\n",
        ),
        (
            "SELECT (COUNT(*) AS ?n) FROM <urn:g1> FROM <urn:g1> WHERE { ?s <urn:p> ?o }",
            false,
            "n\r\n2\r\n",
        ),
        (
            "ASK FROM <urn:g1> FROM NAMED <urn:g1> { ?s <urn:p> ?o . GRAPH <urn:g1> { ?s <urn:p> ?o } FILTER(isBlank(?s)) }",
            false,
            "false",
        ),
        (
            "SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g {} }",
            false,
            "n\r\n4\r\n",
        ),
        ("ASK { GRAPH <urn:empty> {} }", false, "true"),
        ("ASK { GRAPH <urn:missing> {} }", false, "false"),
        (
            "SELECT (COUNT(*) AS ?n) FROM NAMED <urn:empty> FROM NAMED <urn:missing> WHERE { GRAPH ?g {} }",
            false,
            "n\r\n2\r\n",
        ),
    ] {
        let result = response(store, &evaluator, query, union, &[], &[]).unwrap();
        let expected = if query.starts_with("ASK") {
            format!("{{\"head\":{{}},\"boolean\":{expected}}}")
        } else {
            expected.into()
        };
        assert_eq!(body(result)?, expected, "query={query}, union={union}");
    }
    // Protocol dataset parameters replace query FROM/FROM NAMED, including
    // explicit empty/missing graph slots. Repeated inputs do not add rows.
    let query = "SELECT (COUNT(*) AS ?n) FROM <urn:missing> WHERE { ?s <urn:p> ?o }";
    assert_eq!(
        body(
            response(
                store,
                &evaluator,
                query,
                false,
                &["urn:g1", "urn:g2", "urn:g1"],
                &[]
            )
            .unwrap()
        )?,
        "n\r\n3\r\n"
    );
    assert_eq!(
        body(
            response(
                store,
                &evaluator,
                "SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g {} }",
                false,
                &[],
                &["urn:empty", "urn:missing", "urn:empty"]
            )
            .unwrap()
        )?,
        "n\r\n2\r\n"
    );
    assert_eq!(
        response(store, &evaluator, "ASK {}", true, &["urn:g1"], &[])
            .unwrap_err()
            .0,
        StatusCode::BAD_REQUEST
    );
    Ok(())
}

#[test]
fn native_simple_dataset_selection_memory_and_reopened_disk() -> Result<()> {
    let memory = Store::new()?;
    load(&memory)?;
    assert_dataset_queries(&memory)?;
    let directory = TempDir::new()?;
    let disk = Store::open(directory.path())?;
    load(&disk)?;
    drop(disk);
    assert_dataset_queries(&Store::open_read_only(directory.path())?)
}

#[test]
fn native_simple_http_stream_retains_snapshot_and_terminal_metrics() -> Result<()> {
    let store = Store::new()?;
    load(&store)?;
    let evaluator = sparql_evaluator();
    let result = response(
        &store,
        &evaluator,
        "SELECT ?s WHERE { ?s <urn:p> ?o }",
        false,
        &[],
        &[],
    )
    .unwrap();
    assert_eq!(
        store
            .evaluation_metrics()
            .count(EvaluationOperation::Query, EvaluationOutcome::Succeeded),
        0
    );
    store.clear()?;
    assert_eq!(body(result)?, "s\r\nurn:default\r\n");
    assert_eq!(
        store
            .evaluation_metrics()
            .count(EvaluationOperation::Query, EvaluationOutcome::Succeeded),
        1
    );
    let result = response(
        &store,
        &evaluator,
        "SELECT ?x WHERE { VALUES ?x { 1 2 } }",
        false,
        &[],
        &[],
    )
    .unwrap();
    drop(result);
    assert_eq!(
        store
            .evaluation_metrics()
            .count(EvaluationOperation::Query, EvaluationOutcome::Abandoned),
        1
    );
    Ok(())
}

#[test]
fn native_simple_http_honors_cancellation() -> Result<()> {
    let store = Store::new()?;
    load(&store)?;
    let token = CancellationToken::new();
    let evaluator = sparql_evaluator().with_cancellation_token(token.clone());
    let mut result = response(
        &store,
        &evaluator,
        "SELECT ?s WHERE { ?s <urn:p> ?o }",
        true,
        &[],
        &[],
    )
    .unwrap();
    token.cancel();
    // The existing streaming wrapper appends a diagnostic after headers have
    // been sent. It does not turn the body read into an io::Error.
    assert!(io::read_to_string(result.body_mut())?.contains("operation has been cancelled"));
    assert_eq!(
        store
            .evaluation_metrics()
            .count(EvaluationOperation::Query, EvaluationOutcome::Cancelled),
        1
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn native_simple_http_rejects_triple_terms_in_version_11() -> Result<()> {
    let store = Store::new()?;
    store.load_from_slice(
        RdfParser::from_format(RdfFormat::TriG),
        "<urn:g> { <urn:s> <urn:p> <<( <urn:s> <urn:p> <urn:o> )>> }",
    )?;
    let evaluator = sparql_evaluator();
    for (version, succeeds) in [("1.1", false), ("1.2", true)] {
        let query = format!("VERSION \"{version}\" SELECT ?o WHERE {{ ?s <urn:p> ?o }}");
        let result = response(&store, &evaluator, &query, true, &[], &[]);
        let text = body(result.unwrap())?;
        if succeeds {
            assert!(text.contains("urn:o"), "version {version}: {text}");
        } else {
            assert!(text.contains("not supported by SPARQL 1.1"), "{text}");
        }
    }
    assert_eq!(
        store
            .evaluation_metrics()
            .count(EvaluationOperation::Query, EvaluationOutcome::Failed),
        1
    );
    assert_eq!(
        store
            .evaluation_metrics()
            .count(EvaluationOperation::Query, EvaluationOutcome::Succeeded),
        1
    );
    Ok(())
}
