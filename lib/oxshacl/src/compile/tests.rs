use super::*;
use crate::{ConformanceRequest, ProfileError};
use oxrdf::{BlankNode, Dataset, GraphName, Quad};
#[cfg(feature = "sparql")]
use oxrdf::{NamedOrBlankNode, Term};

fn n(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

#[test]
fn rejects_recursive_shapes() {
    let id = n("http://example.com/s");
    let mut shape = Shape::node(id.clone());
    shape.constraints.push(Constraint::Node(id.clone().into()));
    let error = ShapesGraph::from_shapes(
        ProfileSet::default(),
        [shape],
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        CompileError::Validation(ValidationError::RecursiveShape(_))
    ));
}

#[test]
fn compiles_min_count_from_rdf() {
    let shape = n("http://example.com/s");
    let path = n("http://example.com/p");
    let mut dataset = Dataset::new();
    dataset.insert(Quad::new(
        shape.clone(),
        n(&sh("path")),
        path,
        GraphName::DefaultGraph,
    ));
    dataset.insert(Quad::new(
        shape,
        n(&sh("minCount")),
        Literal::from(1),
        GraphName::DefaultGraph,
    ));
    let graph = GraphSnapshot::default_graph(dataset);
    let compiled =
        ShapesGraph::compile(&graph, ProfileSet::default(), &ValidationOptions::default()).unwrap();
    assert_eq!(compiled.shapes().count(), 1);
    assert!(matches!(
        compiled.shapes().next().unwrap().constraints.as_slice(),
        [Constraint::MinCount(1)]
    ));
}

#[test]
fn rejects_cyclic_rdf_list() {
    let shape = n("http://example.com/s");
    let list = BlankNode::new_unchecked("list");
    let mut dataset = Dataset::new();
    dataset.insert(Quad::new(
        shape.clone(),
        n(&sh("in")),
        list.clone(),
        GraphName::DefaultGraph,
    ));
    dataset.insert(Quad::new(
        list.clone(),
        n(rdf::rdf("first")),
        n("http://example.com/v"),
        GraphName::DefaultGraph,
    ));
    dataset.insert(Quad::new(
        list.clone(),
        n(rdf::rdf("rest")),
        list,
        GraphName::DefaultGraph,
    ));
    let error = ShapesGraph::compile(
        &GraphSnapshot::default_graph(dataset),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(error.to_string().contains("cyclic SHACL list"));
}

#[test]
fn complete_claim_remains_unavailable() {
    assert_eq!(
        ConformanceRequest::CompleteCore12.verify(),
        Err(ProfileError::UnsupportedComplete("SHACL 1.2 Core"))
    );
}

#[test]
fn fails_closed_for_requested_entailment_regimes() {
    let mut dataset = Dataset::new();
    dataset.insert(Quad::new(
        n("http://example.com/graph"),
        n(&sh("entailment")),
        n("http://www.w3.org/ns/entailment/RDFS"),
        GraphName::DefaultGraph,
    ));
    let error = ShapesGraph::compile(
        &GraphSnapshot::default_graph(dataset),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        CompileError::Validation(ValidationError::UnsupportedFeature(_))
    ));
}

#[test]
fn rejects_non_iri_entailment_regime() {
    let mut dataset = Dataset::new();
    dataset.insert(Quad::new(
        n("http://example.com/graph"),
        n(&sh("entailment")),
        Literal::from("RDFS"),
        GraphName::DefaultGraph,
    ));
    let error = ShapesGraph::compile(
        &GraphSnapshot::default_graph(dataset),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        CompileError::Validation(ValidationError::IllFormed(_))
    ));
}

#[cfg(feature = "sparql")]
#[test]
fn custom_parameter_shapes_are_enforced() {
    let component = n("http://example.com/component");
    let parameter = n("http://example.com/parameter");
    let predicate = n("http://example.com/code");
    let validator = n("http://example.com/validator");
    let owner = n("http://example.com/shape");
    let mut dataset = Dataset::new();
    let triples: [(NamedOrBlankNode, NamedNode, Term); 9] = [
        (
            component.clone().into(),
            n(rdf::rdf("type")),
            n("http://www.w3.org/ns/shacl#ConstraintComponent").into(),
        ),
        (
            component.clone().into(),
            n(&sh("parameter")),
            parameter.clone().into(),
        ),
        (
            parameter.clone().into(),
            n(&sh("path")),
            predicate.clone().into(),
        ),
        (
            parameter.into(),
            n(&sh("datatype")),
            n("http://www.w3.org/2001/XMLSchema#string").into(),
        ),
        (
            component.into(),
            n(&sh("nodeValidator")),
            validator.clone().into(),
        ),
        (
            validator.clone().into(),
            n(rdf::rdf("type")),
            n("http://www.w3.org/ns/shacl#SPARQLSelectValidator").into(),
        ),
        (
            validator.into(),
            n(&sh("select")),
            Literal::from("SELECT ?this WHERE { FILTER(false) }").into(),
        ),
        (
            owner.clone().into(),
            n(rdf::rdf("type")),
            n("http://www.w3.org/ns/shacl#NodeShape").into(),
        ),
        (owner.into(), predicate, Literal::from(7).into()),
    ];
    for (subject, predicate, object) in triples {
        dataset.insert(Quad::new(
            subject,
            predicate,
            object,
            GraphName::DefaultGraph,
        ));
    }
    let profiles = ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::SparqlExtensions12Subset20260130,
    ])
    .unwrap();
    let error = ShapesGraph::compile(
        &GraphSnapshot::default_graph(dataset),
        profiles,
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("does not conform to parameter shape")
    );
}
