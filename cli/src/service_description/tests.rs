#![expect(clippy::panic_in_result_fn)]

use super::*;
#[cfg(feature = "rdf-12")]
use oxigraph::model::RdfVersion;
use oxigraph::model::{GraphName, NamedOrBlankNode, Quad, Term};
use oxigraph::store::Store;
use std::collections::BTreeSet;
use std::error::Error;
use std::io;

fn graph(kind: EndpointKind, entailment: QueryEntailment) -> Vec<Triple> {
    let evaluator = SparqlEvaluator::new();
    generate_service_description_graph(
        RdfFormat::Turtle,
        kind,
        false,
        entailment,
        "http://example.test/sparql".into(),
        &evaluator,
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

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_query_description_advertises_supported_languages_and_versions()
-> Result<(), Box<dyn Error>> {
    let graph = graph(
        EndpointKind {
            query: true,
            update: false,
        },
        QueryEntailment::Simple,
    );
    let root = root(&graph)?;

    assert!(has_object(
        &graph,
        &root,
        &sd::SUPPORTED_LANGUAGE,
        &sd::SPARQL_11_QUERY
    ));
    assert!(has_object(
        &graph,
        &root,
        &sd::SUPPORTED_LANGUAGE,
        &sd::SPARQL_QUERY
    ));
    for version in [sd::VERSION_11, sd::VERSION_12_BASIC, sd::VERSION_12] {
        assert!(has_object(&graph, &root, &sd::SUPPORTED_VERSION, &version));
    }
    assert!(!has_object(
        &graph,
        &root,
        &sd::SUPPORTED_LANGUAGE,
        &sd::SPARQL_UPDATE
    ));
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_update_description_advertises_supported_languages_and_versions()
-> Result<(), Box<dyn Error>> {
    let graph = graph(
        EndpointKind {
            query: false,
            update: true,
        },
        QueryEntailment::Simple,
    );
    let root = root(&graph)?;

    assert!(has_object(
        &graph,
        &root,
        &sd::SUPPORTED_LANGUAGE,
        &sd::SPARQL_11_UPDATE
    ));
    assert!(has_object(
        &graph,
        &root,
        &sd::SUPPORTED_LANGUAGE,
        &sd::SPARQL_UPDATE
    ));
    for version in [sd::VERSION_11, sd::VERSION_12_BASIC, sd::VERSION_12] {
        assert!(has_object(&graph, &root, &sd::SUPPORTED_VERSION, &version));
    }
    assert!(!has_object(
        &graph,
        &root,
        &sd::SUPPORTED_LANGUAGE,
        &sd::SPARQL_QUERY
    ));
    Ok(())
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
    let input_format =
        NamedNode::new_unchecked("http://www.w3.org/ns/sparql-service-description#inputFormat");
    #[cfg(any(
        feature = "native-tls",
        feature = "rustls-native",
        feature = "rustls-webpki"
    ))]
    let expected = supported_rdf_formats()
        .into_iter()
        .map(|format| format.iri().to_owned())
        .collect();
    #[cfg(not(any(
        feature = "native-tls",
        feature = "rustls-native",
        feature = "rustls-webpki"
    )))]
    let expected = BTreeSet::new();
    let query = graph(
        EndpointKind {
            query: true,
            update: false,
        },
        QueryEntailment::Simple,
    );
    assert!(object_iris(&query, &input_format).is_empty());

    let update = graph(
        EndpointKind {
            query: false,
            update: true,
        },
        QueryEntailment::Simple,
    );
    assert_eq!(object_iris(&update, &input_format), expected);
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
    #[cfg(any(
        feature = "native-tls",
        feature = "rustls-native",
        feature = "rustls-webpki"
    ))]
    expected.insert(sd::BASIC_FEDERATED_QUERY.as_str().to_owned());
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

#[cfg(not(feature = "rdf-12"))]
#[test]
fn rdf11_build_does_not_advertise_rdf12_versions() {
    for triple in graph(
        EndpointKind {
            query: true,
            update: true,
        },
        QueryEntailment::Simple,
    ) {
        let Term::NamedNode(object) = triple.object else {
            continue;
        };
        assert!(!matches!(
            object.as_str(),
            "http://www.w3.org/ns/sparql#version-1.2-basic"
                | "http://www.w3.org/ns/sparql#version-1.2"
        ));
    }
}
