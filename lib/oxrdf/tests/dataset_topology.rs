#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "integration-test assertions provide clearer topology regression failures"
)]

use oxrdf::dataset::CanonicalizationAlgorithm;
#[cfg(feature = "rdfc-10")]
use oxrdf::dataset::CanonicalizationHashAlgorithm;
use oxrdf::{
    BlankNode, Dataset, GraphName, GraphNameRef, NamedNode, NamedOrBlankNode, Quad, Triple,
};
use std::error::Error;

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("https://example.com/{local}")).unwrap()
}

fn triple() -> Triple {
    Triple::new(node("subject"), node("predicate"), node("object"))
}

#[test]
fn graph_mut_creates_empty_named_graph_and_last_quad_removal_preserves_it() {
    let graph_name = node("graph");
    let mut dataset = Dataset::new();

    assert!(!dataset.graph(&graph_name).is_present());
    {
        let mut graph = dataset.graph_mut(graph_name.clone());
        assert!(graph.is_present());
        assert!(graph.is_empty());
        assert!(graph.insert(triple()));
        assert!(graph.remove(&triple()));
    }

    assert!(dataset.is_empty());
    assert!(dataset.contains_named_graph(&graph_name));
    assert!(dataset.graph(&graph_name).is_present());
    assert_eq!(
        dataset.named_graphs().collect::<Vec<_>>(),
        [NamedOrBlankNode::from(graph_name)]
    );
}

#[test]
fn clear_graph_retains_presence_but_remove_named_graph_removes_topology() {
    let graph_name = node("graph");
    let quad = Quad::new(
        node("subject"),
        node("predicate"),
        node("object"),
        graph_name.clone(),
    );
    let mut dataset = Dataset::new();
    dataset.insert(quad);

    dataset.clear_graph(&graph_name);
    assert!(dataset.is_empty());
    assert!(dataset.contains_named_graph(&graph_name));

    assert!(dataset.remove_named_graph(&graph_name));
    assert!(!dataset.contains_named_graph(&graph_name));
    assert!(!dataset.graph(&graph_name).is_present());
    assert!(!dataset.remove_named_graph(&graph_name));
}

#[test]
fn graph_view_clear_retains_blank_named_graph() {
    let graph_name = BlankNode::new("graph").unwrap();
    let mut dataset = Dataset::new();
    {
        let mut graph = dataset.graph_mut(graph_name.clone());
        graph.insert(triple());
        graph.clear();
    }

    assert!(dataset.contains_named_graph(&graph_name));
    assert_eq!(
        dataset.named_graphs().collect::<Vec<_>>(),
        [NamedOrBlankNode::from(graph_name)]
    );
}

#[test]
fn clone_equality_and_clear_include_named_graph_topology() {
    let graph_name = node("empty");
    let mut with_empty_graph = Dataset::new();
    with_empty_graph.insert_named_graph(graph_name.clone());
    let clone = with_empty_graph.clone();

    assert_eq!(with_empty_graph, clone);
    assert_ne!(with_empty_graph, Dataset::new());

    with_empty_graph.clear();
    assert_eq!(with_empty_graph, Dataset::new());
    assert!(with_empty_graph.named_graphs().next().is_none());
    assert!(
        with_empty_graph
            .graph(GraphNameRef::DefaultGraph)
            .is_present()
    );
}

#[test]
fn empty_blank_named_graphs_participate_in_dataset_isomorphism() -> Result<(), Box<dyn Error>> {
    let mut left = Dataset::new();
    left.insert_named_graph(BlankNode::new("left-a")?);
    left.insert_named_graph(BlankNode::new("left-b")?);

    let mut right = Dataset::new();
    right.insert_named_graph(BlankNode::new("right-a")?);
    right.insert_named_graph(BlankNode::new("right-b")?);

    assert_ne!(left, right);
    assert!(left.is_isomorphic_to(&right)?);

    left.canonicalize(CanonicalizationAlgorithm::Unstable)?;
    right.canonicalize(CanonicalizationAlgorithm::Unstable)?;
    assert_eq!(left, right);
    assert_eq!(left.named_graphs().count(), 2);
    Ok(())
}

#[test]
fn empty_graph_role_affects_blank_node_isomorphism() -> Result<(), Box<dyn Error>> {
    let predicate = node("predicate");
    let first_object = node("first-object");
    let second_object = node("second-object");

    let left_empty = BlankNode::new("left-empty")?;
    let left_other = BlankNode::new("left-other")?;
    let mut left = Dataset::new();
    left.insert(Quad::new(
        left_empty.clone(),
        predicate.clone(),
        first_object.clone(),
        GraphName::DefaultGraph,
    ));
    left.insert(Quad::new(
        left_other,
        predicate.clone(),
        second_object.clone(),
        GraphName::DefaultGraph,
    ));
    left.insert_named_graph(left_empty);

    let right_empty = BlankNode::new("right-empty")?;
    let right_other = BlankNode::new("right-other")?;
    let mut right = Dataset::new();
    right.insert(Quad::new(
        right_other,
        predicate.clone(),
        first_object,
        GraphName::DefaultGraph,
    ));
    right.insert(Quad::new(
        right_empty.clone(),
        predicate,
        second_object,
        GraphName::DefaultGraph,
    ));
    right.insert_named_graph(right_empty);

    assert!(!left.is_isomorphic_to(&right)?);
    Ok(())
}

#[cfg(feature = "rdfc-10")]
#[test]
fn rdfc_canonicalization_retains_empty_blank_graph_topology() -> Result<(), Box<dyn Error>> {
    let mut left = Dataset::new();
    left.insert_named_graph(BlankNode::new("left")?);
    let mut right = Dataset::new();
    right.insert_named_graph(BlankNode::new("right")?);
    let algorithm = CanonicalizationAlgorithm::Rdfc10 {
        hash_algorithm: CanonicalizationHashAlgorithm::Sha256,
    };

    left.canonicalize(algorithm)?;
    right.canonicalize(algorithm)?;
    assert_eq!(left, right);
    assert_eq!(left.named_graphs().count(), 1);
    Ok(())
}
