#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise custom list-function cardinality"
)]

use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    ExpressionEnvironment, GraphSnapshot, ProfileId, ProfileSet, ShapesGraph, ValidationError,
    ValidationOptions, compile_node_expression, evaluate_expression,
};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
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

fn empty_shapes() -> ShapesGraph {
    ShapesGraph::from_shapes(
        ProfileSet::new([
            ProfileId::Core12Subset20260723,
            ProfileId::NodeExpressions12Subset20260108,
        ])
        .unwrap(),
        std::iter::empty(),
        &ValidationOptions::default(),
    )
    .unwrap()
}

#[test]
fn custom_list_function_rejects_more_than_one_body_output() {
    let function = iri("http://example.com/Many");
    let body = BlankNode::new_unchecked("body");
    let call = BlankNode::new_unchecked("call");
    let mut source = Dataset::new();
    insert(
        &mut source,
        function.clone(),
        iri(RDF_TYPE),
        sh("ListParameterExpressionFunction"),
    );
    insert(
        &mut source,
        function.clone(),
        iri(RDFS_SUBCLASS),
        sh("ListParameterExpression"),
    );
    insert(
        &mut source,
        function.clone(),
        sh("bodyExpression"),
        body.clone(),
    );
    insert(
        &mut source,
        body,
        shnex("pathValues"),
        iri("http://example.com/value"),
    );
    insert(&mut source, call.clone(), function, Literal::from(1));
    let expression = compile_node_expression(
        &snapshot(source),
        &Term::BlankNode(call),
        &ValidationOptions::default(),
    )
    .unwrap();
    let focus = iri("http://example.com/focus");
    let mut data = Dataset::new();
    insert(
        &mut data,
        focus.clone(),
        iri("http://example.com/value"),
        Literal::from(1),
    );
    insert(
        &mut data,
        focus.clone(),
        iri("http://example.com/value"),
        Literal::from(2),
    );

    assert!(matches!(
        evaluate_expression(
            &expression,
            &empty_shapes(),
            &snapshot(data),
            &Term::NamedNode(focus),
            &ExpressionEnvironment::default(),
            &ValidationOptions::default(),
        ),
        Err(ValidationError::IllFormed(reason))
            if reason.contains("function") && reason.contains("more than one output")
    ));
}

#[test]
fn built_in_function_metadata_is_not_misclassified_as_a_custom_body() {
    let function = shnex("ConcatExpression");
    let parameter = iri("http://example.com/concat-parameter");
    let expression = BlankNode::new_unchecked("empty-expression");
    let mut source = Dataset::new();
    insert(
        &mut source,
        function.clone(),
        iri(RDF_TYPE),
        sh("NamedParameterExpressionFunction"),
    );
    insert(
        &mut source,
        function.clone(),
        iri(RDFS_SUBCLASS),
        sh("NamedParameterExpression"),
    );
    insert(&mut source, function, sh("parameter"), parameter.clone());
    insert(&mut source, parameter.clone(), sh("path"), shnex("concat"));
    insert(
        &mut source,
        parameter,
        sh("keyParameter"),
        Literal::from(true),
    );

    compile_node_expression(
        &snapshot(source),
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap();
}

#[test]
fn missing_named_argument_evaluates_to_the_empty_list() {
    let function = iri("http://example.com/OptionalArgument");
    let key = iri("http://example.com/key");
    let optional = iri("http://example.com/optional");
    let key_parameter = BlankNode::new_unchecked("key-parameter");
    let optional_parameter = BlankNode::new_unchecked("optional-parameter");
    let body = BlankNode::new_unchecked("optional-body");
    let call = BlankNode::new_unchecked("optional-call");
    let mut source = Dataset::new();
    insert(
        &mut source,
        function.clone(),
        iri(RDF_TYPE),
        sh("NamedParameterExpressionFunction"),
    );
    insert(
        &mut source,
        function.clone(),
        iri(RDFS_SUBCLASS),
        sh("NamedParameterExpression"),
    );
    for parameter in [&key_parameter, &optional_parameter] {
        insert(
            &mut source,
            function.clone(),
            sh("parameter"),
            parameter.clone(),
        );
    }
    insert(&mut source, function, sh("bodyExpression"), body.clone());
    insert(&mut source, key_parameter.clone(), sh("path"), key.clone());
    insert(
        &mut source,
        key_parameter,
        sh("keyParameter"),
        Literal::from(true),
    );
    insert(
        &mut source,
        optional_parameter,
        sh("path"),
        optional.clone(),
    );
    insert(&mut source, body, shnex("arg"), optional);
    insert(&mut source, call.clone(), key, Literal::from(1));
    let expression = compile_node_expression(
        &snapshot(source),
        &Term::BlankNode(call),
        &ValidationOptions::default(),
    )
    .unwrap();

    assert!(
        evaluate_expression(
            &expression,
            &empty_shapes(),
            &snapshot(Dataset::new()),
            &Term::NamedNode(iri("http://example.com/focus")),
            &ExpressionEnvironment::default(),
            &ValidationOptions::default(),
        )
        .unwrap()
        .is_empty()
    );
}
