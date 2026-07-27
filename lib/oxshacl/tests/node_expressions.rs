#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public node-expression boundary"
)]

use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    CompileError, ExpressionEnvironment, GraphSnapshot, ProfileId, ProfileSet, ShapesGraph,
    ValidationError, ValidationOptions, Validator, compile_node_expression, evaluate_expression,
    validate,
};

#[cfg(feature = "sparql")]
#[path = "node_expressions/sparql.rs"]
mod sparql;

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const SH: &str = "http://www.w3.org/ns/shacl#";
const SHNEX: &str = "http://www.w3.org/ns/shacl-node-expr#";

fn iri(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn sh(local: &str) -> NamedNode {
    iri(&format!("{SH}{local}"))
}

fn shnex(local: &str) -> NamedNode {
    iri(&format!("{SHNEX}{local}"))
}

fn blank(value: &str) -> BlankNode {
    BlankNode::new_unchecked(value.to_owned())
}

fn insert(
    dataset: &mut Dataset,
    subject: impl Into<NamedOrBlankNode>,
    predicate: impl Into<NamedNode>,
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

fn compile_shapes(graph: &GraphSnapshot) -> ShapesGraph {
    ShapesGraph::compile(graph, profiles(), &ValidationOptions::default()).unwrap()
}

fn empty_shapes() -> ShapesGraph {
    ShapesGraph::from_shapes(
        profiles(),
        std::iter::empty(),
        &ValidationOptions::default(),
    )
    .unwrap()
}

fn assert_ill_formed(dataset: Dataset, expression: BlankNode, expected: &str) {
    let error = compile_node_expression(
        &snapshot(dataset),
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(
        matches!(
            &error,
            CompileError::Validation(ValidationError::IllFormed(reason))
                if reason.contains(expected)
        ),
        "unexpected error: {error}"
    );
}

#[test]
fn focus_node_variable_comes_from_the_evaluation_context() {
    let expression = blank("expression");
    let mut source = Dataset::new();
    insert(
        &mut source,
        expression.clone(),
        shnex("var"),
        Literal::from("focusNode"),
    );
    let source = snapshot(source);
    let compiled = compile_node_expression(
        &source,
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap();
    let focus = Term::NamedNode(iri("http://example.com/focus"));

    assert_eq!(
        evaluate_expression(
            &compiled,
            &empty_shapes(),
            &snapshot(Dataset::new()),
            &focus,
            &ExpressionEnvironment::default(),
            &ValidationOptions::default(),
        )
        .unwrap(),
        vec![focus.clone()]
    );

    let mut environment = ExpressionEnvironment::default();
    environment.unbind("focusNode");
    assert_eq!(
        evaluate_expression(
            &compiled,
            &empty_shapes(),
            &snapshot(Dataset::new()),
            &focus,
            &environment,
            &ValidationOptions::default(),
        )
        .unwrap(),
        Vec::<Term>::new()
    );
}

#[test]
fn path_values_requires_at_most_one_explicit_focus_node() {
    let expression = blank("expression");
    let list = blank("list");
    let tail = blank("tail");
    let mut source = Dataset::new();
    insert(
        &mut source,
        expression.clone(),
        shnex("pathValues"),
        iri("http://example.com/value"),
    );
    insert(
        &mut source,
        expression.clone(),
        shnex("focusNode"),
        list.clone(),
    );
    insert(
        &mut source,
        list.clone(),
        iri(RDF_FIRST),
        iri("http://example.com/a"),
    );
    insert(&mut source, list, iri(RDF_REST), tail.clone());
    insert(
        &mut source,
        tail.clone(),
        iri(RDF_FIRST),
        iri("http://example.com/b"),
    );
    insert(&mut source, tail, iri(RDF_REST), iri(RDF_NIL));
    let source = snapshot(source);
    let compiled = compile_node_expression(
        &source,
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap();

    assert!(matches!(
        evaluate_expression(
            &compiled,
            &empty_shapes(),
            &snapshot(Dataset::new()),
            &Term::NamedNode(iri("http://example.com/unused")),
            &ExpressionEnvironment::default(),
            &ValidationOptions::default(),
        ),
        Err(ValidationError::IllFormed(reason))
            if reason.contains("path values") && reason.contains("one focus")
    ));
}

#[test]
fn conforms_to_shape_evaluates_both_list_parameter_arguments() {
    let expression = blank("expression");
    let arguments = blank("arguments");
    let tail = blank("tail");
    let node = blank("node");
    let shape = blank("shape-expression");
    let candidate = iri("http://example.com/CandidateShape");
    let focus = iri("http://example.com/focus");
    let shape_path = iri("http://example.com/shape");
    let mut source = Dataset::new();
    insert(
        &mut source,
        candidate.clone(),
        iri(RDF_TYPE),
        sh("NodeShape"),
    );
    insert(
        &mut source,
        expression.clone(),
        shnex("conformsToShape"),
        arguments.clone(),
    );
    insert(&mut source, arguments.clone(), iri(RDF_FIRST), node.clone());
    insert(&mut source, arguments, iri(RDF_REST), tail.clone());
    insert(&mut source, tail.clone(), iri(RDF_FIRST), shape.clone());
    insert(&mut source, tail, iri(RDF_REST), iri(RDF_NIL));
    insert(&mut source, node, shnex("var"), Literal::from("focusNode"));
    insert(&mut source, shape, shnex("pathValues"), shape_path.clone());
    let source = snapshot(source);
    let compiled = compile_node_expression(
        &source,
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap();
    let shapes = compile_shapes(&source);
    let mut data = Dataset::new();
    insert(&mut data, focus.clone(), shape_path, candidate);

    assert_eq!(
        evaluate_expression(
            &compiled,
            &shapes,
            &snapshot(data),
            &Term::NamedNode(focus),
            &ExpressionEnvironment::default(),
            &ValidationOptions::default(),
        )
        .unwrap(),
        vec![Term::Literal(Literal::from(true))]
    );
}

#[test]
fn blank_node_function_syntax_is_checked_at_compilation() {
    let expression = blank("expression");
    let mut wrong_var = Dataset::new();
    insert(
        &mut wrong_var,
        expression.clone(),
        shnex("var"),
        Literal::from(""),
    );
    assert_ill_formed(wrong_var, expression.clone(), "non-empty xsd:string");

    let mut missing_nodes = Dataset::new();
    insert(
        &mut missing_nodes,
        expression.clone(),
        shnex("limit"),
        Literal::from(1),
    );
    assert_ill_formed(missing_nodes, expression.clone(), "nodes");

    let mut extra_property = Dataset::new();
    insert(
        &mut extra_property,
        expression.clone(),
        shnex("count"),
        iri("http://example.com/value"),
    );
    insert(
        &mut extra_property,
        expression.clone(),
        iri("http://example.com/extra"),
        Literal::from(true),
    );
    assert_ill_formed(extra_property, expression.clone(), "unexpected property");

    let member = blank("member");
    let mut invalid_list = Dataset::new();
    insert(
        &mut invalid_list,
        expression.clone(),
        iri(RDF_FIRST),
        member,
    );
    insert(
        &mut invalid_list,
        expression.clone(),
        iri(RDF_REST),
        iri(RDF_NIL),
    );
    assert_ill_formed(invalid_list, expression.clone(), "list expression members");

    let mut invalid_if = Dataset::new();
    insert(
        &mut invalid_if,
        expression.clone(),
        shnex("if"),
        Literal::from(true),
    );
    assert_ill_formed(invalid_if, expression, "shnex:then or shnex:else");
}

#[test]
fn dynamic_target_uses_the_pinned_namespace_and_owning_shape_as_focus() {
    let shape = iri("http://example.com/Shape");
    let expression = blank("target-expression");
    let target = iri("http://example.com/target");
    let selected = iri("http://example.com/selected");
    let mut source = Dataset::new();
    insert(&mut source, shape.clone(), iri(RDF_TYPE), sh("NodeShape"));
    insert(
        &mut source,
        shape.clone(),
        sh("targetNode"),
        expression.clone(),
    );
    insert(
        &mut source,
        expression,
        shnex("pathValues"),
        selected.clone(),
    );
    let source = snapshot(source);
    let shapes = compile_shapes(&source);
    let mut data = Dataset::new();
    insert(&mut data, shape.clone(), selected, target.clone());

    assert_eq!(
        Validator::new(&shapes, &ValidationOptions::default())
            .focus_nodes(&snapshot(data), &shape.into())
            .unwrap(),
        vec![Term::NamedNode(target)]
    );
}

#[test]
fn expression_constraint_receives_focus_and_value_scope() {
    let shape = iri("http://example.com/Shape");
    let property_shape = iri("http://example.com/PropertyShape");
    let focus = iri("http://example.com/focus");
    let path = iri("http://example.com/value");
    let marker = iri("http://example.com/marker");
    let expression = blank("expression");
    let condition = blank("condition");
    let value_var = blank("value-var");
    let then_expression = blank("then");
    let mut source = Dataset::new();
    insert(&mut source, shape.clone(), iri(RDF_TYPE), sh("NodeShape"));
    insert(&mut source, shape.clone(), sh("targetNode"), focus.clone());
    insert(&mut source, shape, sh("property"), property_shape.clone());
    insert(
        &mut source,
        property_shape.clone(),
        sh("path"),
        path.clone(),
    );
    insert(
        &mut source,
        property_shape,
        sh("expression"),
        expression.clone(),
    );
    insert(
        &mut source,
        expression.clone(),
        shnex("if"),
        condition.clone(),
    );
    insert(
        &mut source,
        expression.clone(),
        shnex("then"),
        then_expression.clone(),
    );
    insert(&mut source, expression, shnex("else"), Literal::from(false));
    insert(&mut source, condition, shnex("exists"), value_var.clone());
    insert(&mut source, value_var, shnex("var"), Literal::from("value"));
    insert(
        &mut source,
        then_expression,
        shnex("exists"),
        blank("path-expression"),
    );
    insert(
        &mut source,
        blank("path-expression"),
        shnex("pathValues"),
        marker.clone(),
    );
    let source = snapshot(source);
    let shapes = compile_shapes(&source);
    let mut data = Dataset::new();
    insert(&mut data, focus.clone(), path, Literal::from("present"));
    insert(&mut data, focus, marker, Literal::from(true));

    assert!(
        validate(&shapes, &snapshot(data), &ValidationOptions::default())
            .unwrap()
            .conforms()
    );
}
