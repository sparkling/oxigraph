#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise Core value-node semantics through public APIs"
)]

use oxrdf::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    Constraint, GraphSnapshot, LimitKind, NodeExpression, ProfileId, ProfileSet, PropertyPath,
    Shape, ShapesGraph, Target, ValidationError, ValidationOptions, Validator, validate,
};

const EX: &str = "http://example.com/";

fn ex(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{EX}{local}"))
}

fn term(local: &str) -> Term {
    Term::NamedNode(ex(local))
}

fn insert(
    dataset: &mut Dataset,
    subject: impl Into<NamedOrBlankNode>,
    predicate: NamedNode,
    object: impl Into<Term>,
) {
    dataset.insert(Quad::new(
        subject,
        predicate,
        object,
        GraphName::DefaultGraph,
    ));
}

fn snapshot(dataset: Dataset) -> GraphSnapshot {
    GraphSnapshot::default_graph(dataset)
}

fn profiles() -> ProfileSet {
    ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::NodeExpressions12Subset20260108,
    ])
    .unwrap()
}

fn property_shape(id: &str, predicate: &str) -> Shape {
    Shape::property(ex(id), PropertyPath::Predicate(ex(predicate)))
}

fn targeted_parent(property: &Shape, focus: &Term) -> Shape {
    let mut parent = Shape::node(ex("ParentShape"));
    parent.targets.push(Target::Node(focus.clone()));
    parent.constraints.push(Constraint::Property(property.id.clone()));
    parent
}

fn compile(shapes: impl IntoIterator<Item = Shape>) -> ShapesGraph {
    ShapesGraph::from_shapes(profiles(), shapes, &ValidationOptions::default()).unwrap()
}

fn validate_property(
    property: Shape,
    data: Dataset,
) -> Result<oxshacl::ValidationReport, ValidationError> {
    let focus = term("focus");
    let parent = targeted_parent(&property, &focus);
    let shapes = compile([parent, property]);
    validate(
        &shapes,
        &snapshot(data),
        &ValidationOptions::default(),
    )
}

fn failing_expression() -> NodeExpression {
    NodeExpression::PathValues {
        nodes: Box::new(NodeExpression::List(vec![
            NodeExpression::Constant(term("first")),
            NodeExpression::Constant(term("second")),
        ])),
        path: PropertyPath::Predicate(ex("unused")),
    }
}

#[test]
fn property_values_union_path_and_expression_results() {
    let mut property = property_shape("PropertyShape", "value");
    property.values = Some(NodeExpression::Constant(term("expression-value")));
    property
        .constraints
        .push(Constraint::HasValue(term("path-value")));
    property
        .constraints
        .push(Constraint::HasValue(term("expression-value")));
    let mut data = Dataset::new();
    insert(&mut data, ex("focus"), ex("value"), ex("path-value"));

    let report = validate_property(property, data).unwrap();
    assert!(report.conforms(), "union report: {report:?}");
    assert!(
        report.results().is_empty(),
        "union unexpectedly produced results: {report:?}"
    );
}

#[test]
fn duplicate_path_and_expression_terms_count_once() {
    let mut property = property_shape("PropertyShape", "value");
    property.values = Some(NodeExpression::Constant(term("shared")));
    property.constraints.push(Constraint::MaxCount(1));
    let mut data = Dataset::new();
    insert(&mut data, ex("focus"), ex("value"), ex("shared"));

    let report = validate_property(property, data).unwrap();
    assert!(report.conforms(), "duplicate term was counted twice: {report:?}");
}

#[test]
fn nonempty_union_suppresses_default_expression() {
    let mut path_value = property_shape("PathValue", "value");
    path_value.values = Some(NodeExpression::Empty);
    path_value.default_value = Some(failing_expression());
    path_value
        .constraints
        .push(Constraint::HasValue(term("path-value")));
    let mut data = Dataset::new();
    insert(&mut data, ex("focus"), ex("value"), ex("path-value"));
    let report = validate_property(path_value, data).unwrap();
    assert!(
        report.conforms(),
        "path value did not suppress the failing default: {report:?}"
    );

    let mut expression_value = property_shape("ExpressionValue", "value");
    expression_value.values = Some(NodeExpression::Constant(term("expression-value")));
    expression_value.default_value = Some(failing_expression());
    expression_value
        .constraints
        .push(Constraint::HasValue(term("expression-value")));
    let report = validate_property(expression_value, Dataset::new()).unwrap();
    assert!(
        report.conforms(),
        "expression value did not suppress the failing default: {report:?}"
    );
}

#[test]
fn empty_union_uses_default_value() {
    let mut property = property_shape("PropertyShape", "value");
    property.values = Some(NodeExpression::Empty);
    property.default_value = Some(NodeExpression::Constant(term("default")));
    property
        .constraints
        .push(Constraint::HasValue(term("default")));

    let report = validate_property(property, Dataset::new()).unwrap();
    assert!(
        report.conforms(),
        "default value was not used for an empty union: {report:?}"
    );
}

#[test]
fn values_expression_errors_are_not_treated_as_empty() {
    let mut property = property_shape("PropertyShape", "value");
    property.values = Some(failing_expression());
    property.default_value = Some(NodeExpression::Constant(term("default")));
    property
        .constraints
        .push(Constraint::HasValue(term("default")));

    let result = validate_property(property, Dataset::new());
    assert!(
        matches!(
            &result,
            Err(ValidationError::IllFormed(reason))
                if reason.contains("more than one focus node")
        ),
        "values expression error was not propagated: {result:?}"
    );
}

#[test]
fn ordinary_path_node_shape_and_deactivation_semantics_are_preserved() {
    let mut present = property_shape("PresentProperty", "present");
    present.constraints.push(Constraint::MinCount(1));
    let mut present_data = Dataset::new();
    insert(&mut present_data, ex("focus"), ex("present"), ex("value"));
    let present_report = validate_property(present, present_data).unwrap();
    assert!(
        present_report.conforms(),
        "ordinary nonempty path failed: {present_report:?}"
    );

    let mut absent = property_shape("AbsentProperty", "absent");
    absent.constraints.push(Constraint::MinCount(1));
    let absent_report = validate_property(absent, Dataset::new()).unwrap();
    assert!(
        !absent_report.conforms(),
        "ordinary empty path unexpectedly conformed: {absent_report:?}"
    );
    assert_eq!(
        absent_report.results().len(),
        1,
        "ordinary empty path should produce one min-count result"
    );

    let focus = term("focus");
    let mut node = Shape::node(ex("NodeShape"));
    node.targets.push(Target::Node(focus.clone()));
    node.constraints.push(Constraint::HasValue(focus));
    let node_report = validate(
        &compile([node]),
        &snapshot(Dataset::new()),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert!(
        node_report.conforms(),
        "node shape did not retain its focus value: {node_report:?}"
    );

    let mut deactivated = property_shape("DeactivatedProperty", "missing");
    deactivated.deactivated = true;
    deactivated.constraints.push(Constraint::MinCount(1));
    let deactivated_report = validate_property(deactivated, Dataset::new()).unwrap();
    assert!(
        deactivated_report.conforms(),
        "deactivated property shape was evaluated: {deactivated_report:?}"
    );
}

#[test]
fn value_selection_observes_cancellation_and_path_visit_limits() {
    let focus = term("focus");
    let mut property = property_shape("PropertyShape", "value");
    property.constraints.push(Constraint::MinCount(1));
    let shapes = compile([property.clone()]);

    let cancelled = ValidationOptions::default();
    cancelled.cancellation_token.cancel();
    let result = Validator::new(&shapes, &cancelled).conforms_node(
        &snapshot(Dataset::new()),
        &property.id,
        &focus,
    );
    assert!(
        matches!(&result, Err(ValidationError::Cancelled)),
        "cancelled value selection returned: {result:?}"
    );

    let mut data = Dataset::new();
    insert(&mut data, ex("focus"), ex("value"), ex("result"));
    let mut limited = ValidationOptions::default();
    limited.limits.max_path_visits = 0;
    let result =
        Validator::new(&shapes, &limited).conforms_node(&snapshot(data), &property.id, &focus);
    assert!(
        matches!(
            &result,
            Err(ValidationError::LimitExceeded {
                kind: LimitKind::PathVisits,
                limit: 0,
            })
        ),
        "zero path-visit limit returned: {result:?}"
    );
}

#[test]
fn path_and_values_expression_share_one_path_visit_budget() {
    let focus = term("focus");
    let mut property = property_shape("PropertyShape", "path-value");
    property.values = Some(NodeExpression::PathValues {
        nodes: Box::new(NodeExpression::Focus),
        path: PropertyPath::Predicate(ex("expression-value")),
    });
    property
        .constraints
        .push(Constraint::HasValue(term("from-path")));
    property
        .constraints
        .push(Constraint::HasValue(term("from-expression")));
    let shapes = compile([property.clone()]);
    let mut data = Dataset::new();
    insert(
        &mut data,
        ex("focus"),
        ex("path-value"),
        ex("from-path"),
    );
    insert(
        &mut data,
        ex("focus"),
        ex("expression-value"),
        ex("from-expression"),
    );
    let mut limited = ValidationOptions::default();
    limited.limits.max_path_visits = 3;

    let result =
        Validator::new(&shapes, &limited).conforms_node(&snapshot(data), &property.id, &focus);
    assert!(
        matches!(
            &result,
            Err(ValidationError::LimitExceeded {
                kind: LimitKind::PathVisits,
                limit: 3,
            })
        ),
        "path and sh:values did not consume one cumulative budget: {result:?}"
    );
}

#[test]
fn values_expression_observes_the_shared_recursion_depth_limit() {
    let focus = term("focus");
    let mut property = property_shape("PropertyShape", "value");
    property.values = Some(NodeExpression::List(vec![NodeExpression::Constant(
        term("value"),
    )]));
    property.constraints.push(Constraint::MinCount(1));
    let shapes = compile([property.clone()]);
    let mut limited = ValidationOptions::default();
    limited.limits.max_recursion_depth = 0;

    let result = Validator::new(&shapes, &limited).conforms_node(
        &snapshot(Dataset::new()),
        &property.id,
        &focus,
    );
    assert!(
        matches!(
            &result,
            Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: 0,
            })
        ),
        "zero recursion-depth limit returned: {result:?}"
    );
}
