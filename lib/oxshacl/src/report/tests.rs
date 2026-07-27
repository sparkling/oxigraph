use super::*;

fn named(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

#[test]
fn blank_source_constraints_are_deep_copied() {
    let root = BlankNode::new_unchecked("source-root");
    let child = BlankNode::new_unchecked("source-child");
    let copied_predicate = named("http://example.com/copied");
    let leaf_predicate = named("http://example.com/leaf");
    let unrelated_predicate = named("http://example.com/unrelated");
    let mut source = Dataset::new();
    source.insert(Quad::new(
        root.clone(),
        copied_predicate.clone(),
        child.clone(),
        GraphName::DefaultGraph,
    ));
    source.insert(Quad::new(
        child,
        leaf_predicate.clone(),
        Literal::from("value"),
        GraphName::DefaultGraph,
    ));
    source.insert(Quad::new(
        named("http://example.com/other"),
        unrelated_predicate.clone(),
        Literal::from("excluded"),
        GraphName::DefaultGraph,
    ));
    let report = ValidationReport::new(
        ProfileSet::default(),
        vec![ValidationResult {
            focus_node: named("http://example.com/focus").into(),
            value: None,
            result_path: None,
            source_shape: named("http://example.com/shape").into(),
            source_constraint: Some(root.into()),
            source_constraint_component: sh("NodeByExpressionConstraintComponent"),
            severity: sh("Violation"),
            messages: Vec::new(),
            annotations: Vec::new(),
            details: Vec::new(),
        }],
        false,
        1,
        0,
        Duration::ZERO,
        GraphSnapshot::default_graph(source),
        vec![sh("Violation"), sh("Warning"), sh("Info")],
        None,
    );
    let canonical = report.canonical();
    let copied_roots = canonical
        .dataset()
        .iter()
        .filter(|quad| quad.predicate == sh("sourceConstraint"))
        .map(|quad| quad.object)
        .collect::<Vec<_>>();
    assert_eq!(copied_roots.len(), 1);
    assert!(matches!(
        &copied_roots[0],
        Term::BlankNode(node) if node.as_str() != "source-root"
    ));
    assert_eq!(
        canonical
            .dataset()
            .iter()
            .filter(|quad| quad.predicate == copied_predicate)
            .count(),
        1
    );
    assert_eq!(
        canonical
            .dataset()
            .iter()
            .filter(|quad| quad.predicate == leaf_predicate)
            .count(),
        1
    );
    assert!(
        canonical
            .dataset()
            .iter()
            .all(|quad| quad.predicate != unrelated_predicate)
    );
}
