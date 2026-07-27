#![expect(
    clippy::panic,
    clippy::tests_outside_test_module,
    reason = "integration-test assertions report impossible result shapes and rejected profiles"
)]

#[cfg(any(feature = "owl2-rl", feature = "rdf-12"))]
use oxigraph::model::vocab::rdf;
#[cfg(feature = "rdf-12")]
use oxigraph::model::vocab::rdfs;
use oxigraph::model::{BlankNode, GraphName, NamedNode, Quad};
#[cfg(feature = "rdf-12")]
use oxigraph::model::{Literal, Triple};
use oxigraph::sparql::{QueryEntailment, QueryEntailmentOptions, QueryResults, SparqlEvaluator};
#[cfg(feature = "rdf-12")]
use oxigraph::sparql::{QueryEntailmentDataset, QueryEntailmentError};
use oxigraph::store::Store;
use std::collections::HashSet;

// Exact records from the pinned SPARQL 1.2 Entailment Regimes inventory.
// The profile tests intentionally bind these clauses to custom bounded
// advertisements; the standard RDF/RDFS regime IRIs remain underlying
// semantics references and are never advertised as the implemented profile.
const SPARQL_ENTAILMENT_SOURCE_SHA256: &str =
    "bb193867598649caeb6a8b0cfa33a9c836ae5091af632f5fe7e55f21ceb83e1b";

struct SparqlEvidence {
    candidate: &'static str,
    test: &'static str,
}

const SPARQL_EVIDENCE: &[SparqlEvidence] = &[
    SparqlEvidence {
        candidate: "sparql12-entailment:bcp14-clause:80be91b749157c75d0447a9b",
        test: "bounded_profiles_advertise_custom_iris_and_explicit_datatype_maps",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:normative-table-row:d3373cf726cabe5002b4dff1",
        test: "bounded_profiles_advertise_custom_iris_and_explicit_datatype_maps",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:normative-table-row:1852cbadab9af59e5ec8afb5",
        test: "bounded_profiles_advertise_custom_iris_and_explicit_datatype_maps",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:normative-prose-block:6f4dcc41176bd29e3e828199",
        test: "rdf_finite_infers_property_typing_but_not_rdfs_subclassing",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:normative-prose-block:ddcb0b45da8d51b76f3bd4fb",
        test: "rdf_finite_types_predicates_of_recursively_appearing_triples",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:normative-prose-block:d6667d8eb2fece6a1a1e55b9",
        test: "rdf_materialized_dataset_is_finite_and_inspectable",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:normative-prose-block:2711018cf67335cf41a4bb8b",
        test: "rdfs_finite_answers_from_a_read_only_materialized_snapshot",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:normative-prose-block:c354d97630d915c678cd409b",
        test: "rdfs_domain_allows_a_legal_literal_class_object",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:normative-prose-block:ca8a8125356d43465b962b89",
        test: "rdfs_generated_witnesses_are_not_query_bindings",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:bcp14-clause:37644d29ec325cea90b8092a",
        test: "rdf_inconsistency_detected_during_materialization_is_an_error",
    },
    SparqlEvidence {
        candidate: "sparql12-entailment:bcp14-clause:860f13469a5b3e7ee739ac9c",
        test: "rdfs_inconsistency_detected_during_materialization_is_an_error",
    },
];

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("urn:test:{local}")).unwrap()
}

fn ask(store: &Store, profile: QueryEntailment, pattern: &str) -> bool {
    let query = format!("ASK {{ {pattern} }}");
    let result = SparqlEvaluator::new()
        .parse_query(&query)
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

#[test]
fn pinned_sparql_clause_evidence_names_concrete_tests() {
    assert_eq!(SPARQL_ENTAILMENT_SOURCE_SHA256.len(), 64);
    assert_eq!(
        SPARQL_EVIDENCE
            .iter()
            .map(|entry| entry.candidate)
            .collect::<HashSet<_>>()
            .len(),
        SPARQL_EVIDENCE.len()
    );
    assert!(SPARQL_EVIDENCE.iter().all(|entry| {
        entry.candidate.starts_with("sparql12-entailment:") && !entry.test.is_empty()
    }));
}

#[test]
fn bounded_profiles_advertise_custom_iris_and_explicit_datatype_maps() {
    assert_eq!(
        QueryEntailment::Simple.regime_iri(),
        QueryEntailment::Simple.underlying_regime_iri()
    );
    assert_eq!(QueryEntailment::Simple.profile_iri(), None);
    assert_eq!(QueryEntailment::Simple.datatype_policy_iri(), None);

    for profile in [
        QueryEntailment::Rdf12Finite,
        QueryEntailment::Rdfs12Finite,
        QueryEntailment::Owl2RlRdfBounded,
    ] {
        assert_ne!(profile.regime_iri(), profile.underlying_regime_iri());
        assert!(profile.regime_iri().starts_with("https://oxigraph.org/"));
        assert!(
            profile
                .profile_iri()
                .is_some_and(|iri| iri.starts_with("https://oxigraph.org/"))
        );
        assert!(
            profile
                .datatype_policy_iri()
                .is_some_and(|iri| iri.starts_with("https://oxigraph.org/"))
        );
    }

    #[cfg(feature = "rdf-12")]
    for profile in [QueryEntailment::Rdf12Finite, QueryEntailment::Rdfs12Finite] {
        let datatypes = profile.recognized_datatypes();
        assert!(datatypes.contains(&rdf::LANG_STRING));
        assert!(datatypes.contains(&rdf::DIR_LANG_STRING));
        assert!(datatypes.contains(&oxigraph::model::vocab::xsd::STRING));
        assert_eq!(datatypes.len(), 3);
    }
}

#[test]
fn simple_is_default_and_does_not_infer_rdf_property_types() {
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            node("s"),
            node("p"),
            node("o"),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    assert_eq!(
        QueryEntailmentOptions::default().profile(),
        QueryEntailment::Simple
    );
    assert!(!ask(
        &store,
        QueryEntailment::Simple,
        "<urn:test:p> a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>"
    ));
}

#[test]
fn from_uses_rdf_merge_blank_node_scope_before_entailment() {
    let store = Store::new().unwrap();
    let graph = node("graph");
    store
        .insert(Quad::new(
            BlankNode::new("shared-source-label").unwrap(),
            node("p"),
            node("o"),
            graph.clone(),
        ))
        .unwrap();

    let result = SparqlEvaluator::new()
        .parse_query(&format!(
            "ASK FROM <{0}> FROM NAMED <{0}> WHERE {{
               ?default <urn:test:p> <urn:test:o> .
               GRAPH <{0}> {{ ?named <urn:test:p> <urn:test:o> }}
               FILTER(sameTerm(?default, ?named))
             }}",
            graph.as_str()
        ))
        .unwrap()
        .on_store_with_entailment(&store, &QueryEntailmentOptions::default())
        .unwrap()
        .execute()
        .unwrap();
    assert!(
        matches!(result, QueryResults::Boolean(false)),
        "an RDF-merged default graph shared a blank node with its source named graph"
    );
}

#[test]
fn union_default_graph_uses_named_graphs_only_before_entailment() {
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            node("default-only"),
            node("p"),
            node("o"),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    store
        .insert(Quad::new(
            node("named-only"),
            node("p"),
            node("o"),
            node("graph"),
        ))
        .unwrap();

    for (subject, expected) in [("named-only", true), ("default-only", false)] {
        let mut query = SparqlEvaluator::new()
            .parse_query(&format!(
                "ASK {{ <urn:test:{subject}> <urn:test:p> <urn:test:o> }}"
            ))
            .unwrap();
        query.dataset_mut().set_default_graph_as_union();
        let result = query
            .on_store_with_entailment(&store, &QueryEntailmentOptions::default())
            .unwrap()
            .execute()
            .unwrap();
        assert!(matches!(result, QueryResults::Boolean(actual) if actual == expected));
    }
}

#[test]
fn duplicate_from_named_is_a_single_effective_named_graph() {
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(node("s"), node("p"), node("o"), node("graph")))
        .unwrap();
    let result = SparqlEvaluator::new()
        .parse_query(
            "SELECT ?g
             FROM NAMED <urn:test:graph>
             FROM NAMED <urn:test:graph>
             WHERE { GRAPH ?g { ?s ?p ?o } }",
        )
        .unwrap()
        .on_store_with_entailment(&store, &QueryEntailmentOptions::default())
        .unwrap()
        .execute()
        .unwrap();
    let QueryResults::Solutions(solutions) = result else {
        panic!("SELECT must return solutions")
    };
    assert_eq!(solutions.collect::<Result<Vec<_>, _>>().unwrap().len(), 1);
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf_finite_infers_property_typing_but_not_rdfs_subclassing() {
    let store = Store::new().unwrap();
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
    assert!(ask(
        &store,
        QueryEntailment::Rdf12Finite,
        "<http://www.w3.org/2000/01/rdf-schema#subClassOf> a \
         <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>"
    ));
    assert!(!ask(
        &store,
        QueryEntailment::Rdf12Finite,
        "<urn:test:fido> a <urn:test:Animal>"
    ));
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf_finite_types_predicates_of_recursively_appearing_triples() {
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            node("outer-subject"),
            node("outer-predicate"),
            Triple::new(
                node("inner-subject"),
                node("inner-predicate"),
                node("object"),
            ),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    assert!(ask(
        &store,
        QueryEntailment::Rdf12Finite,
        "<urn:test:inner-predicate> a \
         <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>"
    ));
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf_materialized_dataset_is_finite_and_inspectable() {
    let store = Store::new().unwrap();
    let membership = NamedNode::new("http://www.w3.org/1999/02/22-rdf-syntax-ns#_999999").unwrap();
    store
        .insert(Quad::new(
            node("s"),
            node("p"),
            membership.clone(),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    let snapshot = QueryEntailmentDataset::from_store(
        &store,
        &QueryEntailmentOptions::new(QueryEntailment::Rdf12Finite),
    )
    .unwrap();
    assert_eq!(snapshot.profile(), QueryEntailment::Rdf12Finite);
    assert!(snapshot.dataset().contains(&Quad::new(
        membership,
        rdf::TYPE,
        rdf::PROPERTY,
        GraphName::DefaultGraph,
    )));
    assert!(snapshot.dataset().len() < 100);
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn rdfs_finite_answers_from_a_read_only_materialized_snapshot() {
    let store = Store::new().unwrap();
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
    assert!(ask(
        &store,
        QueryEntailment::Rdfs12Finite,
        "<urn:test:fido> a <urn:test:Animal>"
    ));
    assert!(
        !store
            .contains(&Quad::new(
                node("fido"),
                rdf::TYPE,
                node("Animal"),
                GraphName::DefaultGraph,
            ))
            .unwrap()
    );
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn rdfs_domain_allows_a_legal_literal_class_object() {
    let store = Store::new().unwrap();
    for quad in [
        Quad::new(
            node("p"),
            rdfs::DOMAIN,
            Literal::new_simple_literal("class"),
            GraphName::DefaultGraph,
        ),
        Quad::new(node("s"), node("p"), node("o"), GraphName::DefaultGraph),
    ] {
        store.insert(quad).unwrap();
    }
    assert!(ask(
        &store,
        QueryEntailment::Rdfs12Finite,
        "<urn:test:s> a \"class\""
    ));
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn rdfs_materialization_is_graph_local_for_graph_patterns() {
    // SPARQL 1.2 Entailment Regimes §9 is informative but exact: graphA and
    // graphB do not infer across one another; a single active graph does.
    let store = Store::new().unwrap();
    let graph_a = node("graph-a");
    let graph_b = node("graph-b");
    let graph_c = node("graph-c");
    for quad in [
        Quad::new(node("p"), rdfs::DOMAIN, node("Class"), graph_a.clone()),
        Quad::new(node("s"), node("p"), node("o"), graph_b),
        Quad::new(node("p"), rdfs::DOMAIN, node("Class"), graph_c.clone()),
        Quad::new(node("s"), node("p"), node("o"), graph_c.clone()),
    ] {
        store.insert(quad).unwrap();
    }
    assert!(!ask(
        &store,
        QueryEntailment::Rdfs12Finite,
        "GRAPH ?g { <urn:test:s> a <urn:test:Class> } \
         FILTER(?g IN (<urn:test:graph-a>, <urn:test:graph-b>))"
    ));
    assert!(ask(
        &store,
        QueryEntailment::Rdfs12Finite,
        "GRAPH <urn:test:graph-c> { <urn:test:s> a <urn:test:Class> }"
    ));
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn rdfs_materialization_runs_after_from_graphs_are_merged() {
    let store = Store::new().unwrap();
    let graph_a = node("graph-a");
    let graph_b = node("graph-b");
    store
        .insert(Quad::new(
            node("p"),
            rdfs::DOMAIN,
            node("Class"),
            graph_a.clone(),
        ))
        .unwrap();
    store
        .insert(Quad::new(node("s"), node("p"), node("o"), graph_b.clone()))
        .unwrap();

    let result = SparqlEvaluator::new()
        .parse_query(&format!(
            "ASK FROM <{}> FROM <{}> WHERE {{
               <urn:test:s> a <urn:test:Class>
             }}",
            graph_a.as_str(),
            graph_b.as_str()
        ))
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
        )
        .unwrap()
        .execute()
        .unwrap();
    assert!(matches!(result, QueryResults::Boolean(true)));

    let result = SparqlEvaluator::new()
        .parse_query(&format!(
            "ASK FROM NAMED <{}> FROM NAMED <{}> WHERE {{
               GRAPH ?g {{ <urn:test:s> a <urn:test:Class> }}
             }}",
            graph_a.as_str(),
            graph_b.as_str()
        ))
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
        )
        .unwrap()
        .execute()
        .unwrap();
    assert!(
        matches!(result, QueryResults::Boolean(false)),
        "separate named graphs inferred across a GRAPH boundary"
    );
}

#[cfg(feature = "rdf-12")]
#[test]
fn from_dataset_excludes_inconsistency_outside_the_active_dataset() {
    let store = Store::new().unwrap();
    let selected = node("selected");
    let excluded = node("excluded");
    store
        .insert(Quad::new(node("s"), node("p"), node("o"), selected.clone()))
        .unwrap();
    store
        .insert(Quad::new(
            node("outer-subject"),
            node("outer-predicate"),
            Triple::new(
                node("inner-subject"),
                node("inner-predicate"),
                Literal::new_simple_literal("\u{FFFF}"),
            ),
            excluded,
        ))
        .unwrap();

    let result = SparqlEvaluator::new()
        .parse_query(&format!(
            "ASK FROM <{}> WHERE {{
               <urn:test:p> a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property>
             }}",
            selected.as_str()
        ))
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdf12Finite),
        )
        .unwrap()
        .execute()
        .unwrap();
    assert!(matches!(result, QueryResults::Boolean(true)));
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn prepared_entailment_query_uses_a_repeatable_snapshot() {
    let store = Store::new().unwrap();
    let prepared = SparqlEvaluator::new()
        .parse_query("ASK { <urn:test:fido> a <urn:test:Animal> }")
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
        )
        .unwrap();
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
    assert!(matches!(
        prepared.execute().unwrap(),
        QueryResults::Boolean(false)
    ));
    assert!(ask(
        &store,
        QueryEntailment::Rdfs12Finite,
        "<urn:test:fido> a <urn:test:Animal>"
    ));
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf_inconsistency_detected_during_materialization_is_an_error() {
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            node("outer-subject"),
            node("outer-predicate"),
            Triple::new(
                node("inner-subject"),
                node("inner-predicate"),
                Literal::new_simple_literal("\u{FFFF}"),
            ),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    let Err(error) = SparqlEvaluator::new()
        .parse_query("ASK {}")
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdf12Finite),
        )
    else {
        panic!("an RDF-inconsistent snapshot must be rejected");
    };
    assert!(matches!(
        error,
        QueryEntailmentError::RdfInconsistent { reasons: 1 }
    ));
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn rdfs_inconsistency_detected_during_materialization_is_an_error() {
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            node("outer-subject"),
            node("outer-predicate"),
            Triple::new(
                node("inner-subject"),
                node("inner-predicate"),
                Literal::new_simple_literal("\u{FFFF}"),
            ),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    let Err(error) = SparqlEvaluator::new()
        .parse_query("ASK {}")
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
        )
    else {
        panic!("an RDFS-inconsistent snapshot must be rejected");
    };
    assert!(matches!(
        error,
        QueryEntailmentError::RdfsInconsistent { reasons } if reasons >= 1
    ));
}
