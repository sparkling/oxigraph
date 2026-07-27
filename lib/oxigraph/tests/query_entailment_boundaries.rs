#![expect(
    clippy::panic,
    clippy::tests_outside_test_module,
    reason = "integration-test assertions report impossible result shapes and rejected profiles"
)]

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
use oxigraph::model::BlankNode;
use oxigraph::model::NamedNode;
#[cfg(any(
    feature = "owl2-rl",
    all(
        feature = "rocksdb",
        feature = "rdf-12",
        feature = "rdfs",
        not(target_family = "wasm")
    )
))]
use oxigraph::model::vocab::rdf;
#[cfg(all(
    feature = "rocksdb",
    feature = "rdf-12",
    feature = "rdfs",
    not(target_family = "wasm")
))]
use oxigraph::model::vocab::rdfs;
#[cfg(any(feature = "owl2-rl", all(feature = "rdf-12", feature = "rdfs")))]
use oxigraph::model::{GraphName, Quad};
#[cfg(any(
    not(feature = "rdf-12"),
    feature = "owl2-rl",
    all(feature = "rdf-12", feature = "rdfs")
))]
use oxigraph::sparql::QueryEntailment;
#[cfg(any(not(feature = "rdf-12"), all(feature = "rdf-12", feature = "rdfs")))]
use oxigraph::sparql::QueryEntailmentError;
use oxigraph::sparql::{QueryEntailmentOptions, QueryResults, SparqlEvaluator};
use oxigraph::store::Store;

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("urn:test:{local}")).unwrap()
}

#[cfg(any(
    feature = "owl2-rl",
    all(
        feature = "rocksdb",
        feature = "rdf-12",
        feature = "rdfs",
        not(target_family = "wasm")
    )
))]
fn ask(store: &Store, profile: QueryEntailment, pattern: &str) -> bool {
    let result = SparqlEvaluator::new()
        .parse_query(&format!("ASK {{ {pattern} }}"))
        .unwrap()
        .on_store_with_entailment(store, &QueryEntailmentOptions::new(profile))
        .unwrap()
        .execute()
        .unwrap();
    let QueryResults::Boolean(answer) = result else {
        panic!("ASK must return a boolean")
    };
    answer
}

#[cfg(all(
    feature = "rocksdb",
    feature = "rdf-12",
    feature = "rdfs",
    not(target_family = "wasm")
))]
#[test]
fn rdfs_finite_queries_a_store_opened_read_only() {
    let directory = tempfile::tempdir().unwrap();
    {
        let store = Store::open(directory.path()).unwrap();
        for quad in [
            Quad::new(
                node("Dog"),
                rdfs::SUB_CLASS_OF,
                node("Animal"),
                GraphName::DefaultGraph,
            ),
            Quad::new(
                node("fido"),
                rdf::TYPE,
                node("Dog"),
                GraphName::DefaultGraph,
            ),
        ] {
            store.insert(quad).unwrap();
        }
    }
    let store = Store::open_read_only(directory.path()).unwrap();
    assert!(ask(
        &store,
        QueryEntailment::Rdfs12Finite,
        "<urn:test:fido> a <urn:test:Animal>"
    ));
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn rdfs_generated_witnesses_are_not_query_bindings() {
    let store = Store::new().unwrap();
    let result = SparqlEvaluator::new()
        .parse_query(
            "SELECT ?w WHERE {
                ?w a <http://www.w3.org/2000/01/rdf-schema#Proposition>
            }",
        )
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
        )
        .unwrap()
        .execute()
        .unwrap();
    let QueryResults::Solutions(mut solutions) = result else {
        panic!("SELECT must return solutions")
    };
    assert!(solutions.next().is_none());
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn reserved_rdfs_witness_labels_fail_closed() {
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            BlankNode::new("oxrdfs0000000000000000").unwrap(),
            node("p"),
            node("o"),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    let Err(error) = SparqlEvaluator::new()
        .parse_query("ASK { ?s ?p ?o }")
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
        )
    else {
        panic!("reserved labels must be rejected");
    };
    assert!(matches!(
        error,
        QueryEntailmentError::ReservedWitnessLabel {
            prefix: "oxrdfs",
            ..
        }
    ));
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn unavailable_profiles_fail_before_query_execution() {
    let store = Store::new().unwrap();
    let Err(error) = SparqlEvaluator::new()
        .parse_query("ASK {}")
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdf12Finite),
        )
    else {
        panic!("an unavailable profile must be rejected");
    };
    assert!(matches!(
        error,
        QueryEntailmentError::UnsupportedProfile {
            profile: QueryEntailment::Rdf12Finite,
            required_features: "rdf-12"
        }
    ));
}

#[cfg(feature = "owl2-rl")]
#[test]
fn owl2_rl_bounded_answers_transitive_property_queries() {
    let store = Store::new().unwrap();
    let ancestor = node("ancestor");
    for quad in [
        Quad::new(
            ancestor.clone(),
            rdf::TYPE,
            NamedNode::new("http://www.w3.org/2002/07/owl#TransitiveProperty").unwrap(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            node("alice"),
            ancestor.clone(),
            node("bob"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            node("bob"),
            ancestor,
            node("carol"),
            GraphName::DefaultGraph,
        ),
    ] {
        store.insert(quad).unwrap();
    }
    assert!(ask(
        &store,
        QueryEntailment::Owl2RlRdfBounded,
        "<urn:test:alice> <urn:test:ancestor> <urn:test:carol>"
    ));
}

#[test]
fn owned_snapshot_preserves_empty_named_graph_topology() {
    let store = Store::new().unwrap();
    let graph = node("empty");
    store.insert_named_graph(graph.clone()).unwrap();
    let result = SparqlEvaluator::new()
        .parse_query("SELECT ?g WHERE { GRAPH ?g {} }")
        .unwrap()
        .on_store_with_entailment(&store, &QueryEntailmentOptions::default())
        .unwrap()
        .execute()
        .unwrap();
    let QueryResults::Solutions(mut solutions) = result else {
        panic!("SELECT must return solutions")
    };
    assert_eq!(
        solutions.next().unwrap().unwrap().get("g"),
        Some(&graph.into())
    );
    assert!(solutions.next().is_none());
}
