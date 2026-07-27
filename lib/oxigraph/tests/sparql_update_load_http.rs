//! Hermetic executable slice of SPARQL 1.2 Update `LOAD`.

#![cfg(all(test, feature = "http-client", feature = "rdf-12"))]
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "this integration-test crate directly exposes executable conformance cases"
)]

#[expect(
    dead_code,
    reason = "the shared HTTP fixture exposes response modes used by its sibling test crate"
)]
#[path = "sparql_service_http/support.rs"]
mod support;

use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::sparql::{SparqlEvaluator, SparqlVersion};
use oxigraph::store::Store;
use std::error::Error;
use std::sync::{Mutex, MutexGuard};
use support::{ResponseSpec, TestEndpoint};

static LOOPBACK_TEST_LOCK: Mutex<()> = Mutex::new(());

const TRIG_DATASET: &str = "
    <urn:load:default-s> <urn:load:p> <urn:load:o> .
    GRAPH <urn:load:named> {
        <urn:load:named-s> <urn:load:p> <urn:load:o> .
    }
    GRAPH <urn:load:empty> {}
";
const PARTIAL_INVALID_NTRIPLES: &str = "
    <urn:load:first> <urn:load:p> <urn:load:o> .
    <urn:load:broken> <urn:load:p>
";
const TRIPLE_TERM_NTRIPLES: &str = "
    <urn:load:s> <urn:load:p> <<( <urn:load:ts> <urn:load:tp> <urn:load:to> )>> .
";

fn node(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn quad(subject: &str, object: &str, graph: GraphName) -> Quad {
    Quad::new(node(subject), node("urn:load:p"), node(object), graph)
}

fn execute(evaluator: SparqlEvaluator, store: &Store, update: &str) -> Result<(), Box<dyn Error>> {
    evaluator.parse_update(update)?.on_store(store).execute()?;
    Ok(())
}

fn graph_exists(store: &Store, graph: &str) -> Result<bool, Box<dyn Error>> {
    Ok(store.contains_named_graph(&NamedOrBlankNode::from(node(graph)))?)
}

fn loopback_test_lock() -> MutexGuard<'static, ()> {
    LOOPBACK_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[test]
fn load_without_into_merges_an_rdf_dataset_in_sparql12() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok("application/trig", TRIG_DATASET)])?;
    let store = Store::new()?;
    execute(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
        &store,
        &format!("LOAD <{}>", endpoint.iri()),
    )?;
    let requests = endpoint.finish()?;

    assert!(store.contains(&quad(
        "urn:load:default-s",
        "urn:load:o",
        GraphName::DefaultGraph,
    ))?);
    assert!(store.contains(&quad(
        "urn:load:named-s",
        "urn:load:o",
        node("urn:load:named").into(),
    ))?);
    assert!(graph_exists(&store, "urn:load:empty")?);
    assert_eq!(requests[0].method(), "GET");
    let accept = requests[0].header("accept").unwrap_or_default();
    assert!(accept.contains("application/n-quads"));
    assert!(accept.contains("application/trig"));
    Ok(())
}

#[test]
fn sparql11_load_without_into_rejects_named_graphs() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok("application/trig", TRIG_DATASET)])?;
    let store = Store::new()?;
    let result = execute(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_1),
        &store,
        &format!("LOAD <{}>", endpoint.iri()),
    );
    endpoint.finish()?;

    assert!(result.is_err());
    assert!(store.is_empty()?);
    assert!(!graph_exists(&store, "urn:load:named")?);
    Ok(())
}

#[test]
fn load_into_graph_rejects_named_input_without_partial_effect() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok("application/trig", TRIG_DATASET)])?;
    let store = Store::new()?;
    let existing = quad(
        "urn:load:existing",
        "urn:load:o",
        node("urn:load:destination").into(),
    );
    store.insert(existing.clone())?;
    let result = execute(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
        &store,
        &format!(
            "LOAD <{}> INTO GRAPH <urn:load:destination>",
            endpoint.iri()
        ),
    );
    endpoint.finish()?;

    assert!(result.is_err());
    assert!(store.contains(&existing)?);
    assert_eq!(store.len()?, 1);
    Ok(())
}

#[test]
fn load_into_graph_rejects_an_empty_named_block_without_partial_effect()
-> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
        "application/trig",
        "GRAPH <urn:load:empty> {}",
    )])?;
    let store = Store::new()?;
    let existing = quad(
        "urn:load:existing",
        "urn:load:o",
        node("urn:load:destination").into(),
    );
    store.insert(existing.clone())?;
    let result = execute(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
        &store,
        &format!(
            "LOAD <{}> INTO GRAPH <urn:load:destination>",
            endpoint.iri()
        ),
    );
    endpoint.finish()?;

    assert!(result.is_err());
    assert!(store.contains(&existing)?);
    assert_eq!(store.len()?, 1);
    assert!(!graph_exists(&store, "urn:load:empty")?);
    Ok(())
}

#[test]
fn malformed_load_is_atomic_with_and_without_silent() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    for silent in ["", "SILENT "] {
        let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
            "application/n-triples",
            PARTIAL_INVALID_NTRIPLES,
        )])?;
        let store = Store::new()?;
        let result = execute(
            SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
            &store,
            &format!("LOAD {silent}<{}>", endpoint.iri()),
        );
        endpoint.finish()?;

        assert_eq!(result.is_ok(), !silent.is_empty());
        assert!(store.is_empty()?);
    }
    Ok(())
}

#[test]
fn retrieval_failure_is_reported_unless_silent() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    for silent in ["", "SILENT "] {
        let endpoint = TestEndpoint::spawn(vec![ResponseSpec::status(
            "503 Service Unavailable",
            "unavailable",
        )])?;
        let store = Store::new()?;
        let result = execute(
            SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
            &store,
            &format!("LOAD {silent}<{}>", endpoint.iri()),
        );
        endpoint.finish()?;

        assert_eq!(result.is_ok(), !silent.is_empty());
        assert!(store.is_empty()?);
    }
    Ok(())
}

#[test]
fn successful_empty_load_into_graph_creates_the_destination() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok("text/turtle", "")])?;
    let store = Store::new()?;
    execute(
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2),
        &store,
        &format!(
            "LOAD <{}> INTO GRAPH <urn:load:destination>",
            endpoint.iri()
        ),
    )?;
    endpoint.finish()?;

    assert!(graph_exists(&store, "urn:load:destination")?);
    assert!(store.is_empty()?);
    Ok(())
}

#[test]
fn load_validates_retrieved_terms_before_mutation() -> Result<(), Box<dyn Error>> {
    let _serial = loopback_test_lock();
    for silent in ["", "SILENT "] {
        let endpoint = TestEndpoint::spawn(vec![ResponseSpec::ok(
            "application/n-triples; version=1.2",
            TRIPLE_TERM_NTRIPLES,
        )])?;
        let store = Store::new()?;
        let result = execute(
            SparqlEvaluator::new().with_version(SparqlVersion::V1_1),
            &store,
            &format!("LOAD {silent}<{}>", endpoint.iri()),
        );
        endpoint.finish()?;

        assert_eq!(result.is_ok(), !silent.is_empty());
        assert!(store.is_empty()?);
    }
    Ok(())
}
