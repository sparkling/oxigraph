//! Public differential and fault oracle for catalog-attributed HTTP `SERVICE`
//! observations.
//!
//! Every case drives the public boundary only, against the hermetic loopback
//! fixtures of `sparql_service_http.rs`. Results and the requests an endpoint
//! actually served are compared between an unobserved run, an observation
//! without a catalog, and an observation with a catalog. The catalog only
//! attributes actual counters: nothing here asserts endpoint selection,
//! batching, health, freshness or any performance claim.

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
    CancellationToken, DefaultServiceHandler, HttpServiceActualCounters, HttpServiceCatalog,
    HttpServiceCatalogSnapshot, HttpServiceEndpointDeclaration, HttpServiceObservation,
    QueryEvaluationError, QueryResults, QuerySolution, QuerySolutionIter, SparqlEvaluator,
};
use oxigraph::store::Store;
use oxiri::Iri;
use spargebra::algebra::QueryExpression;
use std::convert::Infallible;
use std::error::Error;
use std::io;
use std::net::{Ipv4Addr, TcpListener};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
use support::{ObservedRequest, ResponseSpec, TestEndpoint};

static LOOPBACK_TEST_LOCK: Mutex<()> = Mutex::new(());

const JSON_MEDIA_TYPE: &str = "application/sparql-results+json";

const JSON_ONE_ROW: &str = r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"alpha"}}]}}"#;

const JSON_TWO_ROWS: &str = r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"alpha"}},{"remote":{"type":"literal","value":"beta"}}]}}"#;

const JSON_THREE_ROWS: &str = r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"alpha"}},{"remote":{"type":"literal","value":"beta"}},{"remote":{"type":"literal","value":"gamma"}}]}}"#;

const JSON_SAME_LABEL_BNODE: &str = r#"{"head":{"vars":["node"]},"results":{"bindings":[{"node":{"type":"bnode","value":"same-label"}}]}}"#;

const JSON_TRUNCATED_AFTER_FIRST_ROW: &str = r#"{"head":{"vars":["remote"]},"results":{"bindings":[{"remote":{"type":"literal","value":"alpha"}},{"remote":{"type":"lit"#;

const SECRET: &str = "s3cr3t-catalog-token";

type Outcome = Result<Vec<QuerySolution>, QueryEvaluationError>;

/// attempts, dispatches, decoded bytes, rows, completed, failed, abandoned.
type Counts = (u64, u64, u64, u64, u64, u64, u64);

fn loopback_test_lock() -> MutexGuard<'static, ()> {
    LOOPBACK_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn byte_len(body: &str) -> u64 {
    u64::try_from(body.len()).unwrap_or(u64::MAX)
}

fn counts(actual: &HttpServiceActualCounters) -> Counts {
    (
        actual.attempts(),
        actual.dispatches(),
        actual.decoded_bytes(),
        actual.rows(),
        actual.completed(),
        actual.failed(),
        actual.abandoned(),
    )
}

const ZERO: Counts = (0, 0, 0, 0, 0, 0, 0);

fn evaluator_with(observation: &HttpServiceObservation) -> SparqlEvaluator {
    SparqlEvaluator::new().with_http_service_observation(observation.clone())
}

fn catalog_of(endpoints: &[&str]) -> Result<HttpServiceCatalog, Box<dyn Error>> {
    let mut declarations = Vec::new();
    for endpoint in endpoints {
        declarations.push(HttpServiceEndpointDeclaration::new(NamedNode::new(
            (*endpoint).to_owned(),
        )?));
    }
    Ok(HttpServiceCatalog::new(declarations)?)
}

fn catalog_snapshot(
    observation: &HttpServiceObservation,
) -> Result<HttpServiceCatalogSnapshot, Box<dyn Error>> {
    observation.snapshot().catalog().cloned().ok_or_else(|| {
        Box::<dyn Error>::from(io::Error::other("the observation has no catalog view"))
    })
}

fn evaluate(
    evaluator: SparqlEvaluator,
    query: &str,
    store: &Store,
) -> Result<Outcome, Box<dyn Error>> {
    let bound = evaluator.parse_query(query)?.on_store(store);
    Ok(match bound.execute() {
        Ok(QueryResults::Solutions(solutions)) => solutions.collect::<Result<Vec<_>, _>>(),
        Ok(_) => {
            return Err(
                io::Error::new(io::ErrorKind::InvalidData, "expected SELECT results").into(),
            );
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

fn request_shape(
    request: &ObservedRequest,
) -> (String, String, String, Option<String>, Option<String>) {
    (
        request.method().to_owned(),
        request.target().to_owned(),
        request.body().to_owned(),
        request.header("content-type").map(ToOwned::to_owned),
        request.header("accept").map(ToOwned::to_owned),
    )
}

/// The total attempts must equal the sum over all endpoint views.
fn assert_attribution_reconciles(
    observation: &HttpServiceObservation,
) -> Result<(), Box<dyn Error>> {
    let snapshot = observation.snapshot();
    let catalog = catalog_snapshot(observation)?;
    let attributed: u64 = catalog
        .endpoints()
        .iter()
        .map(|endpoint| endpoint.actual().attempts())
        .sum::<u64>()
        + catalog.uncataloged().attempts();
    assert_eq!(
        snapshot.attempts(),
        attributed,
        "every attempt must be attributed to exactly one endpoint view"
    );
    Ok(())
}

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
            Ok(_) => {
                Err(io::Error::other("an endpoint that must stay silent was contacted").into())
            }
            Err(error) => Err(error.into()),
        }
    }
}

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

/// Runs one SERVICE query against one fresh cataloged endpoint.
fn run_one(
    responses: Vec<ResponseSpec>,
    query: impl Fn(&str) -> String,
    configure: impl FnOnce(SparqlEvaluator) -> SparqlEvaluator,
) -> Result<(Outcome, HttpServiceCatalogSnapshot, usize), Box<dyn Error>> {
    let endpoint = TestEndpoint::spawn(responses)?;
    let observation = HttpServiceObservation::with_catalog(4, catalog_of(&[endpoint.iri()])?)?;
    let evaluator = configure(evaluator_with(&observation));
    let store = Store::new()?;
    let outcome = evaluate(evaluator, &query(endpoint.iri()), &store)?;
    let requests = endpoint.finish()?;
    Ok((outcome, catalog_snapshot(&observation)?, requests.len()))
}

fn plain_service_query(iri: &str) -> String {
    format!("SELECT ?remote WHERE {{ SERVICE <{iri}> {{ ?s ?p ?remote }} }}")
}

fn silent_service_query(iri: &str) -> String {
    format!(
        r#"SELECT ?input ?remote WHERE {{
             VALUES ?input {{ "kept" }}
             SERVICE SILENT <{iri}> {{ ?s ?p ?remote }}
           }}"#
    )
}

// ---------------------------------------------------------------------------
// Differential: unobserved, catalog-free observation, cataloged observation.
// ---------------------------------------------------------------------------

#[test]
fn catalog_attribution_preserves_results_and_requests_for_a_fixed_endpoint()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let query_for = |iri: &str| {
        format!(
            r#"SELECT ?local ?remote WHERE {{
                 VALUES ?local {{ "local" }}
                 SERVICE <{iri}> {{ ?s <urn:test:p> ?remote }}
               }} ORDER BY ?remote"#
        )
    };

    let plain_endpoint =
        TestEndpoint::spawn(vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_TWO_ROWS)])?;
    let plain = select(SparqlEvaluator::new(), &query_for(plain_endpoint.iri()))?;
    let plain_requests = plain_endpoint.finish()?;

    let f0 = HttpServiceObservation::new(4)?;
    let f0_endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_TWO_ROWS)])?;
    let f0_rows = select(evaluator_with(&f0), &query_for(f0_endpoint.iri()))?;
    let f0_requests = f0_endpoint.finish()?;

    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_TWO_ROWS)])?;
    let observation = HttpServiceObservation::with_catalog(4, catalog_of(&[endpoint.iri()])?)?;
    let rows = select(evaluator_with(&observation), &query_for(endpoint.iri()))?;
    let requests = endpoint.finish()?;

    for candidate in [&f0_rows, &rows] {
        assert_eq!(
            column(candidate, "remote"),
            column(&plain, "remote"),
            "observation changed the SERVICE result bag"
        );
        assert_eq!(column(candidate, "local"), column(&plain, "local"));
    }
    assert_eq!(rows.len(), 2);
    assert_eq!(plain_requests.len(), 1);
    assert_eq!(f0_requests.len(), 1);
    assert_eq!(requests.len(), 1);
    assert_eq!(
        request_shape(&f0_requests[0]),
        request_shape(&plain_requests[0])
    );
    assert_eq!(
        request_shape(&requests[0]),
        request_shape(&plain_requests[0]),
        "the catalog changed the SPARQL Protocol request"
    );

    assert!(f0.snapshot().catalog().is_none());
    let snapshot = observation.snapshot();
    let f0_snapshot = f0.snapshot();
    assert_eq!(snapshot.attempts(), f0_snapshot.attempts());
    assert_eq!(snapshot.dispatches(), f0_snapshot.dispatches());
    assert_eq!(snapshot.decoded_bytes(), f0_snapshot.decoded_bytes());
    assert_eq!(snapshot.rows(), f0_snapshot.rows());
    assert_eq!(snapshot.completed(), f0_snapshot.completed());

    let catalog = catalog_snapshot(&observation)?;
    assert_eq!(catalog.schema_version(), 1);
    assert_eq!(catalog.endpoints().len(), 1);
    assert_eq!(catalog.endpoints()[0].ordinal(), 0);
    assert_eq!(
        counts(catalog.endpoints()[0].actual()),
        (1, 1, byte_len(JSON_TWO_ROWS), 2, 1, 0, 0)
    );
    assert_eq!(counts(catalog.uncataloged()), ZERO);
    assert_attribution_reconciles(&observation)
}

#[test]
fn a_fixed_endpoint_never_targets_another_cataloged_endpoint() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint_a = TestEndpoint::spawn(vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW)])?;
    let probe_b = Probe::new()?;
    let observation =
        HttpServiceObservation::with_catalog(4, catalog_of(&[endpoint_a.iri(), probe_b.iri()])?)?;
    let rows = select(
        evaluator_with(&observation),
        &plain_service_query(endpoint_a.iri()),
    )?;
    let requests = endpoint_a.finish()?;
    assert_eq!(rows.len(), 1);
    assert_eq!(requests.len(), 1, "endpoint A must serve its own request");
    probe_b.assert_no_connection()?;

    let catalog = catalog_snapshot(&observation)?;
    assert_eq!(
        counts(catalog.endpoints()[0].actual()),
        (1, 1, byte_len(JSON_ONE_ROW), 1, 1, 0, 0)
    );
    assert_eq!(counts(catalog.endpoints()[1].actual()), ZERO);
    assert_eq!(counts(catalog.uncataloged()), ZERO);
    assert_attribution_reconciles(&observation)
}

struct AbcRun {
    rows: Vec<QuerySolution>,
    requests: [usize; 3],
}

fn run_abc(
    build: impl FnOnce(&[&str; 3]) -> Result<SparqlEvaluator, Box<dyn Error>>,
) -> Result<AbcRun, Box<dyn Error>> {
    let a = TestEndpoint::spawn(vec![
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_SAME_LABEL_BNODE),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_SAME_LABEL_BNODE),
    ])?;
    let b = TestEndpoint::spawn(vec![ResponseSpec::ok(
        JSON_MEDIA_TYPE,
        JSON_SAME_LABEL_BNODE,
    )])?;
    let c = TestEndpoint::spawn(vec![ResponseSpec::ok(
        JSON_MEDIA_TYPE,
        JSON_SAME_LABEL_BNODE,
    )])?;
    let iris = [a.iri(), b.iri(), c.iri()];
    let evaluator = build(&iris)?;
    let query = format!(
        "SELECT ?call ?node WHERE {{
             VALUES (?service ?call) {{ (<{0}> 1) (<{1}> 2) (<{0}> 3) (<{2}> 4) }}
             SERVICE ?service {{ ?s ?p ?node }}
           }} ORDER BY ?call",
        iris[0], iris[1], iris[2]
    );
    let rows = select(evaluator, &query)?;
    Ok(AbcRun {
        rows,
        requests: [a.finish()?.len(), b.finish()?.len(), c.finish()?.len()],
    })
}

#[test]
fn variable_a_b_a_with_an_uncataloged_endpoint_keeps_multiplicity_and_scope()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let plain = run_abc(|_| Ok(SparqlEvaluator::new()))?;

    let mut kept = None;
    let cataloged = run_abc(|iris| {
        let observation =
            HttpServiceObservation::with_catalog(8, catalog_of(&[iris[0], iris[1]])?)?;
        kept = Some(observation.clone());
        Ok(evaluator_with(&observation))
    })?;
    let observation = kept.ok_or_else(|| io::Error::other("no observation was built"))?;

    for run in [&plain, &cataloged] {
        assert_eq!(
            run.rows.len(),
            4,
            "duplicate bindings keep their multiplicity"
        );
        assert_eq!(run.requests, [2, 1, 1], "one request per invocation");
        let nodes = column(&run.rows, "node");
        assert!(nodes.iter().all(Option::is_some));
        for (index, node) in nodes.iter().enumerate() {
            assert!(
                nodes[index + 1..].iter().all(|other| other != node),
                "same-label blank nodes from separate documents must stay distinct"
            );
        }
    }
    assert_eq!(
        column(&cataloged.rows, "call"),
        column(&plain.rows, "call"),
        "the catalog changed the result bag"
    );

    let catalog = catalog_snapshot(&observation)?;
    let one = byte_len(JSON_SAME_LABEL_BNODE);
    assert_eq!(
        counts(catalog.endpoints()[0].actual()),
        (2, 2, 2 * one, 2, 2, 0, 0)
    );
    assert_eq!(
        counts(catalog.endpoints()[1].actual()),
        (1, 1, one, 1, 1, 0, 0)
    );
    assert_eq!(
        counts(catalog.uncataloged()),
        (1, 1, one, 1, 1, 0, 0),
        "the endpoint absent from the catalog lands in the one fixed aggregate"
    );
    assert_eq!(observation.snapshot().attempts(), 4);
    assert_attribution_reconciles(&observation)
}

// ---------------------------------------------------------------------------
// Catalog declaration, privacy and limits.
// ---------------------------------------------------------------------------

fn indexed_declarations(
    count: usize,
) -> Result<Vec<HttpServiceEndpointDeclaration>, Box<dyn Error>> {
    let mut declarations = Vec::new();
    for index in 0..count {
        declarations.push(HttpServiceEndpointDeclaration::new(NamedNode::new(
            format!("http://127.0.0.1:9/e{index}"),
        )?));
    }
    Ok(declarations)
}

#[test]
fn catalog_limits_duplicates_credentials_and_exact_matching_are_enforced()
-> Result<(), Box<dyn Error>> {
    let full = HttpServiceCatalog::new(indexed_declarations(64)?)?;
    let observation = HttpServiceObservation::with_catalog(0, full)?;
    let catalog = catalog_snapshot(&observation)?;
    assert_eq!(catalog.endpoints().len(), 64);
    assert_eq!(catalog.endpoints()[63].ordinal(), 63);

    let too_many = HttpServiceCatalog::new(indexed_declarations(65)?);
    let Err(error) = too_many else {
        return Err(io::Error::other("65 endpoints were accepted").into());
    };
    assert!(!format!("{error} {error:?}").contains("://"));
    assert!(HttpServiceCatalog::new(Vec::new()).is_ok());

    let duplicated = vec![
        HttpServiceEndpointDeclaration::new(NamedNode::new(format!(
            "http://127.0.0.1:9/dup?token={SECRET}"
        ))?),
        HttpServiceEndpointDeclaration::new(NamedNode::new(format!(
            "http://127.0.0.1:9/dup?token={SECRET}"
        ))?),
    ];
    let Err(error) = HttpServiceCatalog::new(duplicated) else {
        return Err(io::Error::other("a duplicate endpoint was accepted").into());
    };
    let rendered = format!("{error} {error:?}");
    assert!(!rendered.contains(SECRET));
    assert!(!rendered.contains("127.0.0.1"));

    for credentialed in [
        format!("http://user:{SECRET}@127.0.0.1:9/sparql"),
        "http://user@127.0.0.1:9/sparql".to_owned(),
        "http://@127.0.0.1:9/sparql".to_owned(),
    ] {
        let declaration = HttpServiceEndpointDeclaration::new(NamedNode::new(credentialed)?);
        let Err(error) = HttpServiceCatalog::new(vec![declaration]) else {
            return Err(io::Error::other("a credential-bearing endpoint was accepted").into());
        };
        let rendered = format!("{error} {error:?}");
        assert!(!rendered.contains(SECRET));
        assert!(!rendered.contains("user"));
        assert!(!rendered.contains("127.0.0.1"));
    }

    // No normalization: textual variants are distinct declarations.
    let variants = HttpServiceCatalog::new(vec![
        HttpServiceEndpointDeclaration::new(NamedNode::new("http://EXAMPLE.test/a")?),
        HttpServiceEndpointDeclaration::new(NamedNode::new("http://example.test/a")?),
        HttpServiceEndpointDeclaration::new(NamedNode::new("http://example.test/a/")?),
    ]);
    assert!(variants.is_ok(), "exact-string variants must stay distinct");
    Ok(())
}

#[test]
fn reports_and_errors_disclose_no_endpoint_query_or_credential() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW)])?;
    let secret_iri = format!("{}?token={SECRET}", endpoint.iri());
    let declaration = HttpServiceEndpointDeclaration::new(NamedNode::new(secret_iri.clone())?)
        .with_expected_rows(3);
    let catalog = HttpServiceCatalog::new(vec![declaration.clone()])?.with_caller_epoch(7);
    let observation = HttpServiceObservation::with_catalog(4, catalog.clone())?;
    let rows = select(
        evaluator_with(&observation),
        &format!(
            r#"SELECT ?remote WHERE {{ SERVICE <{secret_iri}> {{ ?s <urn:test:{SECRET}> ?remote }} }}"#
        ),
    )?;
    endpoint.finish()?;
    assert_eq!(rows.len(), 1);

    let snapshot = observation.snapshot();
    let rendered = format!("{declaration:?} {catalog:?} {observation:?} {snapshot:?}");
    for forbidden in [SECRET, "://", "127.0.0.1", "SELECT", "urn:test:"] {
        assert!(
            !rendered.contains(forbidden),
            "the report disclosed retained content: {forbidden}"
        );
    }
    assert_eq!(
        SparqlEvaluator::new().effective_capabilities(),
        evaluator_with(&observation).effective_capabilities(),
        "attaching a catalog must not change effective capabilities"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Retention, declared values and the terminal matrix.
// ---------------------------------------------------------------------------

#[test]
fn omitted_and_zero_retention_keep_endpoint_counters_and_declarations() -> Result<(), Box<dyn Error>>
{
    let _serial = loopback_test_lock();
    for limit in [0_usize, 1] {
        let endpoint = TestEndpoint::spawn(vec![
            ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
            ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
        ])?;
        let catalog = HttpServiceCatalog::new(vec![
            HttpServiceEndpointDeclaration::new(NamedNode::new(endpoint.iri().to_owned())?)
                .with_expected_rows(100)
                .with_expected_decoded_bytes(7000),
        ])?
        .with_caller_epoch(42);
        let observation = HttpServiceObservation::with_catalog(limit, catalog)?;
        let rows = select(
            evaluator_with(&observation),
            &format!(
                "SELECT ?call ?remote WHERE {{
                     VALUES (?service ?call) {{ (<{0}> 1) (<{0}> 2) }}
                     SERVICE ?service {{ ?s ?p ?remote }}
                   }} ORDER BY ?call",
                endpoint.iri()
            ),
        )?;
        assert_eq!(endpoint.finish()?.len(), 2);
        assert_eq!(rows.len(), 2);

        let snapshot = observation.snapshot();
        assert_eq!(snapshot.records().len(), limit);
        assert_eq!(snapshot.omitted_records(), 2 - u64::try_from(limit)?);
        let catalog = catalog_snapshot(&observation)?;
        let endpoint_view = &catalog.endpoints()[0];
        assert_eq!(
            counts(endpoint_view.actual()),
            (2, 2, 2 * byte_len(JSON_ONE_ROW), 2, 2, 0, 0),
            "a retention cap must not lose per-endpoint counts"
        );
        assert_eq!(endpoint_view.declared_expected_rows(), Some(100));
        assert_eq!(endpoint_view.declared_expected_decoded_bytes(), Some(7000));
        assert_eq!(catalog.caller_epoch(), Some(42));
        assert_eq!(catalog.schema_version(), 1);
    }
    Ok(())
}

#[test]
fn every_terminal_outcome_is_counted_exactly_once_per_endpoint() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();

    let (outcome, catalog, requests) = run_one(
        vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_TWO_ROWS)],
        plain_service_query,
        |evaluator| evaluator,
    )?;
    assert_eq!(outcome.map(|rows| rows.len()).ok(), Some(2));
    assert_eq!(requests, 1);
    assert_eq!(
        counts(catalog.endpoints()[0].actual()),
        (1, 1, byte_len(JSON_TWO_ROWS), 2, 1, 0, 0)
    );

    let (outcome, catalog, _) = run_one(
        vec![ResponseSpec::status("503 Service Unavailable", "down")],
        plain_service_query,
        |evaluator| evaluator,
    )?;
    assert!(matches!(outcome, Err(QueryEvaluationError::Service(_))));
    assert_eq!(
        counts(catalog.endpoints()[0].actual()),
        (1, 1, 0, 0, 0, 1, 0)
    );

    let (outcome, catalog, _) = run_one(
        vec![ResponseSpec::ok(
            JSON_MEDIA_TYPE,
            JSON_TRUNCATED_AFTER_FIRST_ROW,
        )],
        plain_service_query,
        |evaluator| evaluator,
    )?;
    assert!(outcome.is_err(), "a truncated results stream must fail");
    let actual = catalog.endpoints()[0].actual();
    assert_eq!(
        (
            actual.attempts(),
            actual.dispatches(),
            actual.rows(),
            actual.completed(),
            actual.failed(),
            actual.abandoned()
        ),
        (1, 1, 1, 0, 1, 0)
    );

    let (outcome, catalog, _) = run_one(
        vec![ResponseSpec::ok(
            JSON_MEDIA_TYPE,
            JSON_TRUNCATED_AFTER_FIRST_ROW,
        )],
        silent_service_query,
        |evaluator| evaluator,
    )?;
    let rows = outcome.map_err(|error| io::Error::other(error.to_string()))?;
    assert_eq!(rows.len(), 1, "SILENT yields exactly the incoming mapping");
    assert_eq!(rows[0].get("input"), Some(&Literal::from("kept").into()));
    assert_eq!(rows[0].get("remote"), None);
    let actual = catalog.endpoints()[0].actual();
    assert_eq!(
        (actual.attempts(), actual.failed(), actual.completed()),
        (1, 1, 0)
    );

    let (outcome, catalog, _) = run_one(
        vec![ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_THREE_ROWS)],
        |iri| format!("SELECT ?remote WHERE {{ SERVICE <{iri}> {{ ?s ?p ?remote }} }} LIMIT 1"),
        |evaluator| evaluator,
    )?;
    assert_eq!(outcome.map(|rows| rows.len()).ok(), Some(1));
    let actual = catalog.endpoints()[0].actual();
    assert_eq!(
        (
            actual.attempts(),
            actual.completed(),
            actual.failed(),
            actual.abandoned(),
            actual.in_progress()
        ),
        (1, 0, 0, 1, 0),
        "an unexhausted stream is abandoned, never completed"
    );

    let (outcome, catalog, _) = run_one(
        vec![ResponseSpec::delayed(
            JSON_MEDIA_TYPE,
            JSON_ONE_ROW,
            Duration::from_millis(150),
        )],
        silent_service_query,
        |evaluator| evaluator.with_http_timeout(Duration::from_millis(20)),
    )?;
    assert_eq!(outcome.map(|rows| rows.len()).ok(), Some(1));
    assert_eq!(
        counts(catalog.endpoints()[0].actual()),
        (1, 1, 0, 0, 0, 1, 0)
    );
    Ok(())
}

#[test]
fn cancellation_and_denial_of_a_cataloged_endpoint_never_dispatch() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let probe = Probe::new()?;
    let store = Store::new()?;

    for silent in [false, true] {
        let observation = HttpServiceObservation::with_catalog(4, catalog_of(&[probe.iri()])?)?;
        let token = CancellationToken::new();
        token.cancel();
        let keyword = if silent { "SILENT " } else { "" };
        let outcome = evaluate(
            evaluator_with(&observation).with_cancellation_token(token),
            &format!(
                "SELECT ?input WHERE {{ VALUES ?input {{ 3 }} SERVICE {keyword}<{}> {{ ?s ?p ?o }} }}",
                probe.iri()
            ),
            &store,
        )?;
        assert!(
            matches!(outcome, Err(QueryEvaluationError::Cancelled)),
            "SILENT must never hide cancellation"
        );
        let catalog = catalog_snapshot(&observation)?;
        let actual = catalog.endpoints()[0].actual();
        assert!(actual.attempts() <= 1);
        assert_eq!(
            (actual.dispatches(), actual.decoded_bytes(), actual.rows()),
            (0, 0, 0)
        );
        assert_eq!(actual.completed(), 0);
        assert_eq!(actual.in_progress(), 0);
        assert_eq!(
            actual.attempts(),
            actual.failed() + actual.abandoned(),
            "every attributed attempt reaches exactly one terminal state"
        );
        assert_attribution_reconciles(&observation)?;
    }

    let f0 = HttpServiceObservation::new(4)?;
    let f0_outcome = evaluate(
        evaluator_with(&f0).with_deny_all_egress_policy(),
        &plain_service_query(probe.iri()),
        &store,
    )?;
    let observation = HttpServiceObservation::with_catalog(4, catalog_of(&[probe.iri()])?)?;
    let denied = evaluate(
        evaluator_with(&observation).with_deny_all_egress_policy(),
        &plain_service_query(probe.iri()),
        &store,
    )?;
    assert!(matches!(f0_outcome, Err(QueryEvaluationError::Service(_))));
    assert!(
        matches!(denied, Err(QueryEvaluationError::Service(_))),
        "the catalog must not change the denial disposition"
    );
    let catalog = catalog_snapshot(&observation)?;
    assert_eq!(
        counts(catalog.endpoints()[0].actual()),
        (1, 0, 0, 0, 0, 1, 0)
    );

    let silent_observation = HttpServiceObservation::with_catalog(4, catalog_of(&[probe.iri()])?)?;
    let silent = evaluate(
        evaluator_with(&silent_observation).with_deny_all_egress_policy(),
        &silent_service_query(probe.iri()),
        &store,
    )??;
    assert_eq!(silent.len(), 1);
    assert_eq!(silent[0].get("input"), Some(&Literal::from("kept").into()));
    assert_eq!(
        counts(catalog_snapshot(&silent_observation)?.endpoints()[0].actual()),
        (1, 0, 0, 0, 0, 1, 0)
    );
    probe.assert_no_connection()
}

// ---------------------------------------------------------------------------
// Evaluator reuse and non-HTTP handler paths.
// ---------------------------------------------------------------------------

#[test]
fn one_evaluator_reused_across_stores_keeps_one_cumulative_endpoint_view()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
        ResponseSpec::ok(JSON_MEDIA_TYPE, JSON_ONE_ROW),
    ])?;
    let observation = HttpServiceObservation::with_catalog(8, catalog_of(&[endpoint.iri()])?)?;
    let evaluator = evaluator_with(&observation);
    let query = plain_service_query(endpoint.iri());
    let first_store = Store::new()?;
    let second_store = Store::new()?;
    let first = evaluate(evaluator.clone(), &query, &first_store)??;
    let second = evaluate(evaluator, &query, &second_store)??;
    assert_eq!(endpoint.finish()?.len(), 2);
    assert_eq!((first.len(), second.len()), (1, 1));

    let catalog = catalog_snapshot(&observation)?;
    assert_eq!(
        counts(catalog.endpoints()[0].actual()),
        (2, 2, 2 * byte_len(JSON_ONE_ROW), 2, 2, 0, 0)
    );
    assert_attribution_reconciles(&observation)
}

#[test]
fn custom_and_disabled_handlers_produce_no_catalog_counts() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let probe = Probe::new()?;
    let store = Store::new()?;

    let custom = HttpServiceObservation::with_catalog(4, catalog_of(&[probe.iri()])?)?;
    let rows = evaluate(
        evaluator_with(&custom).with_default_service_handler(EmptySolutionsHandler),
        &format!(
            "SELECT ?input WHERE {{ VALUES ?input {{ 1 }} SERVICE <{}> {{ ?s ?p ?o }} }}",
            probe.iri()
        ),
        &store,
    )??;
    assert!(rows.is_empty());

    let disabled = HttpServiceObservation::with_catalog(4, catalog_of(&[probe.iri()])?)?;
    let rows = evaluate(
        evaluator_with(&disabled).without_default_http_service_handler(),
        &silent_service_query(probe.iri()),
        &store,
    )??;
    assert_eq!(rows.len(), 1);
    probe.assert_no_connection()?;

    for observation in [&custom, &disabled] {
        let catalog = catalog_snapshot(observation)?;
        assert_eq!(counts(catalog.endpoints()[0].actual()), ZERO);
        assert_eq!(counts(catalog.uncataloged()), ZERO);
        assert_eq!(observation.snapshot().attempts(), 0);
    }
    Ok(())
}
