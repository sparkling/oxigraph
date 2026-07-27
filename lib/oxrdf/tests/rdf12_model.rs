#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public RDF abstract model"
)]

#[cfg(feature = "rdf-12")]
use oxrdf::{BaseDirection, GraphName, Literal, Term, Triple};
use oxrdf::{BlankNode, Dataset, NamedNode, Quad};
#[cfg(feature = "rdf-12")]
use std::str::FromStr;

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("https://example.com/{local}")).unwrap()
}

#[test]
fn iris_are_absolute_and_compared_without_normalization() {
    NamedNode::new("../relative").unwrap_err();
    assert_ne!(
        NamedNode::new("https://example.com/%41").unwrap(),
        NamedNode::new("https://example.com/A").unwrap()
    );
    assert_ne!(
        NamedNode::new("https://example.com/a").unwrap(),
        NamedNode::new("https://EXAMPLE.com/a").unwrap()
    );
}

#[test]
fn graphs_and_datasets_have_set_semantics_and_dataset_blank_node_scope() {
    let shared = BlankNode::new("shared").unwrap();
    let predicate = node("predicate");
    let object = node("object");
    let first = Quad::new(
        shared.clone(),
        predicate.clone(),
        object.clone(),
        node("graph-one"),
    );
    let second = Quad::new(shared, predicate, object, node("graph-two"));
    let mut dataset = Dataset::new();
    assert!(dataset.insert(first.clone()));
    assert!(!dataset.insert(first));
    assert!(dataset.insert(second));
    assert_eq!(dataset.len(), 2);
    let expected = BlankNode::new("shared").unwrap();
    assert!(dataset.iter().all(|quad| quad.subject == expected));
}

#[cfg(feature = "rdf-12")]
#[test]
fn directional_literal_text_is_lowercase_and_uppercase_direction_is_rejected() {
    let literal =
        Literal::new_directional_language_tagged_literal("value", "EN", BaseDirection::Ltr)
            .unwrap();
    assert_eq!(literal.language(), Some("en"));
    assert_eq!(literal.direction(), Some(BaseDirection::Ltr));
    assert_eq!(literal.to_string(), "\"value\"@en--ltr");
    Literal::from_str("\"value\"@en--LTR").unwrap_err();
}

#[cfg(feature = "rdf-12")]
#[test]
fn triple_terms_are_recursive_objects_but_not_legal_subjects() {
    let inner = Triple::new(node("subject"), node("predicate"), node("object"));
    let outer = Triple::new(node("outer"), node("contains"), inner.clone());
    assert_eq!(outer.object, Term::Triple(Box::new(inner.clone())));
    Triple::from_terms(inner, node("predicate"), node("object")).unwrap_err();

    let quad = Quad::new(
        node("subject"),
        node("predicate"),
        outer,
        GraphName::DefaultGraph,
    );
    assert!(matches!(quad.object, Term::Triple(_)));
}
