#![cfg(feature = "sparql")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public RDF compilation boundary"
)]

use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, Quad, Term};
use oxshacl::{GraphSnapshot, ProfileId, ProfileSet, ShapesGraph, ValidationOptions, validate};

fn named(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn sh(local: &str) -> NamedNode {
    named(&format!("http://www.w3.org/ns/shacl#{local}"))
}

#[test]
fn sparql_result_annotations_use_bindings_and_defaults() {
    let shape = named("http://example.com/shape");
    let focus = named("http://example.com/focus");
    let constraint = BlankNode::new_unchecked("constraint");
    let dynamic_annotation = BlankNode::new_unchecked("dynamic-annotation");
    let default_annotation = BlankNode::new_unchecked("default-annotation");
    let dynamic_property = named("http://example.com/note");
    let default_property = named("http://example.com/fallback");
    let mut graph = Dataset::new();
    for quad in [
        Quad::new(
            shape.clone(),
            named("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
            sh("NodeShape"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            shape.clone(),
            sh("targetNode"),
            focus.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            shape,
            sh("sparql"),
            constraint.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            constraint.clone(),
            sh("select"),
            Literal::from("SELECT ?this ?code WHERE { BIND(\"dynamic\" AS ?code) }"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            constraint.clone(),
            sh("resultAnnotation"),
            dynamic_annotation.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            constraint,
            sh("resultAnnotation"),
            default_annotation.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            dynamic_annotation.clone(),
            sh("annotationProperty"),
            dynamic_property.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            dynamic_annotation,
            sh("annotationVarName"),
            Literal::from("code"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            default_annotation.clone(),
            sh("annotationProperty"),
            default_property.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            default_annotation,
            sh("annotationValue"),
            Literal::from("default"),
            GraphName::DefaultGraph,
        ),
    ] {
        graph.insert(quad);
    }
    let options = ValidationOptions::default();
    let shapes = ShapesGraph::compile(
        &GraphSnapshot::default_graph(graph),
        ProfileSet::new([
            ProfileId::Core12Subset20260723,
            ProfileId::SparqlExtensions12Subset20260130,
        ])
        .unwrap(),
        &options,
    )
    .unwrap();
    let report = validate(
        &shapes,
        &GraphSnapshot::default_graph(Dataset::new()),
        &options,
    )
    .unwrap();
    assert!(!report.conforms());
    let result_graph = report.canonical();
    assert!(result_graph.dataset().iter().any(|quad| {
        quad.predicate == dynamic_property
            && matches!(&quad.object, Term::Literal(value) if value.value() == "dynamic")
    }));
    assert!(result_graph.dataset().iter().any(|quad| {
        quad.predicate == default_property
            && matches!(&quad.object, Term::Literal(value) if value.value() == "default")
    }));
}
