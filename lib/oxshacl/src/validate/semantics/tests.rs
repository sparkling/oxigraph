use crate::{GraphSnapshot, ProfileSet, ShapesGraph, ValidationOptions, Validator};
use oxrdf::{Dataset, GraphName, NamedNode, Quad, Term};

fn named(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

#[test]
fn subclass_hierarchy_can_include_the_shapes_graph() {
    let shape = named("http://example.com/shape");
    let child = named("http://example.com/Child");
    let parent = named("http://example.com/Parent");
    let item = named("http://example.com/item");
    let rdf_type = named("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    let mut shapes = Dataset::new();
    shapes.insert(Quad::new(
        shape.clone(),
        rdf_type.clone(),
        named("http://www.w3.org/ns/shacl#NodeShape"),
        GraphName::DefaultGraph,
    ));
    shapes.insert(Quad::new(
        shape.clone(),
        named("http://www.w3.org/ns/shacl#targetClass"),
        parent.clone(),
        GraphName::DefaultGraph,
    ));
    shapes.insert(Quad::new(
        child.clone(),
        named("http://www.w3.org/2000/01/rdf-schema#subClassOf"),
        parent,
        GraphName::DefaultGraph,
    ));
    let shapes = ShapesGraph::compile(
        &GraphSnapshot::default_graph(shapes),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap();
    let mut data = Dataset::new();
    data.insert(Quad::new(
        item.clone(),
        rdf_type,
        child,
        GraphName::DefaultGraph,
    ));
    let data = GraphSnapshot::default_graph(data);
    let disabled = Validator::new(&shapes, &ValidationOptions::default())
        .focus_nodes(&data, &shape.clone().into())
        .unwrap();
    assert!(disabled.is_empty());

    let options = ValidationOptions {
        sub_class_of_in_shapes_graph: true,
        ..ValidationOptions::default()
    };
    let enabled = Validator::new(&shapes, &options)
        .focus_nodes(&data, &shape.into())
        .unwrap();
    assert_eq!(enabled, vec![Term::from(item)]);
}
