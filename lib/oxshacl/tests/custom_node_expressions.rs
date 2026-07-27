#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public custom-expression boundary"
)]

use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    CompileError, ExpressionEnvironment, GraphSnapshot, ProfileId, ProfileSet, ShapesGraph,
    ValidationError, ValidationOptions, Validator, compile_node_expression, evaluate_expression,
};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const SH: &str = "http://www.w3.org/ns/shacl#";
const SHNEX: &str = "http://www.w3.org/ns/shacl-node-expr#";
const EX: &str = "http://example.com/";

fn iri(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn ex(local: &str) -> NamedNode {
    iri(&format!("{EX}{local}"))
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

fn empty_shapes() -> ShapesGraph {
    ShapesGraph::from_shapes(
        profiles(),
        std::iter::empty(),
        &ValidationOptions::default(),
    )
    .unwrap()
}

fn declare_named(
    dataset: &mut Dataset,
    function: NamedNode,
    parameter: BlankNode,
    key: NamedNode,
    body: BlankNode,
) {
    insert(
        dataset,
        function.clone(),
        iri(RDF_TYPE),
        sh("NamedParameterExpressionFunction"),
    );
    insert(
        dataset,
        function.clone(),
        iri(RDFS_SUBCLASS),
        sh("NamedParameterExpression"),
    );
    insert(
        dataset,
        function.clone(),
        sh("parameter"),
        parameter.clone(),
    );
    insert(dataset, function, sh("bodyExpression"), body);
    insert(dataset, parameter.clone(), sh("path"), key);
    insert(dataset, parameter, sh("keyParameter"), Literal::from(true));
}

fn declare_list(dataset: &mut Dataset, function: NamedNode, body: BlankNode) {
    insert(
        dataset,
        function.clone(),
        iri(RDF_TYPE),
        sh("ListParameterExpressionFunction"),
    );
    insert(
        dataset,
        function.clone(),
        iri(RDFS_SUBCLASS),
        sh("ListParameterExpression"),
    );
    insert(dataset, function, sh("bodyExpression"), body);
}

fn list(dataset: &mut Dataset, id: &str, members: impl IntoIterator<Item = Term>) -> Term {
    let members = members.into_iter().collect::<Vec<_>>();
    if members.is_empty() {
        return Term::NamedNode(iri(RDF_NIL));
    }
    let nodes = (0..members.len())
        .map(|index| blank(&format!("{id}-{index}")))
        .collect::<Vec<_>>();
    for (index, member) in members.into_iter().enumerate() {
        insert(dataset, nodes[index].clone(), iri(RDF_FIRST), member);
        insert(
            dataset,
            nodes[index].clone(),
            iri(RDF_REST),
            if index + 1 == nodes.len() {
                Term::NamedNode(iri(RDF_NIL))
            } else {
                Term::BlankNode(nodes[index + 1].clone())
            },
        );
    }
    Term::BlankNode(nodes[0].clone())
}

fn compile(
    dataset: Dataset,
    expression: BlankNode,
) -> Result<oxshacl::NodeExpression, CompileError> {
    compile_node_expression(
        &snapshot(dataset),
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
}

fn assert_ill_formed(dataset: Dataset, expression: BlankNode, expected: &str) {
    let error = compile(dataset, expression).unwrap_err();
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
fn named_function_arguments_may_produce_multiple_outputs() {
    let function = ex("ValuesFunction");
    let key = ex("values");
    let body = blank("body");
    let call = blank("call");
    let argument = blank("argument");
    let mut source = Dataset::new();
    declare_named(
        &mut source,
        function,
        blank("parameter"),
        key.clone(),
        body.clone(),
    );
    insert(&mut source, body, shnex("arg"), key.clone());
    insert(&mut source, call.clone(), key, argument.clone());
    insert(&mut source, argument, shnex("pathValues"), ex("value"));
    let expression = compile(source, call).unwrap();
    let focus = ex("focus");
    let mut data = Dataset::new();
    insert(&mut data, focus.clone(), ex("value"), ex("one"));
    insert(&mut data, focus.clone(), ex("value"), ex("two"));

    let output = evaluate_expression(
        &expression,
        &empty_shapes(),
        &snapshot(data),
        &Term::NamedNode(focus),
        &ExpressionEnvironment::default(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_eq!(output.len(), 2);
    assert!(output.contains(&Term::NamedNode(ex("one"))));
    assert!(output.contains(&Term::NamedNode(ex("two"))));
}

#[test]
fn list_function_supports_list_singleton_and_empty_argument_forms() {
    for (case, arguments, expected) in [
        (
            "list",
            vec![
                Term::Literal(Literal::from(10)),
                Term::Literal(Literal::from(20)),
            ],
            Some(Term::Literal(Literal::from(20))),
        ),
        (
            "singleton",
            vec![Term::Literal(Literal::from(10))],
            Some(Term::Literal(Literal::from(10))),
        ),
        ("empty", Vec::new(), None),
    ] {
        let function = ex(&format!("Function-{case}"));
        let body = blank(&format!("body-{case}"));
        let call = blank(&format!("call-{case}"));
        let mut source = Dataset::new();
        declare_list(&mut source, function.clone(), body.clone());
        insert(
            &mut source,
            body,
            shnex("arg"),
            Literal::from(i64::from(case == "list")),
        );
        let object = if case == "singleton" {
            arguments[0].clone()
        } else {
            list(&mut source, case, arguments)
        };
        insert(&mut source, call.clone(), function, object);
        let expression = compile(source, call).unwrap();
        let output = evaluate_expression(
            &expression,
            &empty_shapes(),
            &snapshot(Dataset::new()),
            &Term::NamedNode(ex("focus")),
            &ExpressionEnvironment::default(),
            &ValidationOptions::default(),
        )
        .unwrap();
        assert_eq!(output, expected.into_iter().collect::<Vec<_>>(), "{case}");
    }
}

#[test]
fn list_function_enforces_argument_cardinality() {
    let function = ex("ListFunction");
    let body = blank("body");
    let call = blank("call");
    let argument = blank("argument");
    let mut source = Dataset::new();
    declare_list(&mut source, function.clone(), body.clone());
    insert(&mut source, body, shnex("arg"), Literal::from(0_i64));
    insert(
        &mut source,
        argument.clone(),
        shnex("pathValues"),
        ex("value"),
    );
    insert(&mut source, call.clone(), function, argument);
    let expression = compile(source, call).unwrap();
    let focus = ex("focus");
    let mut data = Dataset::new();
    insert(&mut data, focus.clone(), ex("value"), ex("one"));
    insert(&mut data, focus.clone(), ex("value"), ex("two"));

    let error = evaluate_expression(
        &expression,
        &empty_shapes(),
        &snapshot(data),
        &Term::NamedNode(focus),
        &ExpressionEnvironment::default(),
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(
        matches!(error, ValidationError::IllFormed(reason) if reason.contains("argument") && reason.contains("more than one"))
    );
}

#[test]
fn custom_target_node_is_dispatched_as_an_expression() {
    let function = ex("TargetFunction");
    let key = ex("target");
    let body = blank("target-body");
    let call = blank("target-call");
    let shape = ex("Shape");
    let mut source = Dataset::new();
    declare_named(
        &mut source,
        function,
        blank("target-parameter"),
        key.clone(),
        body.clone(),
    );
    insert(&mut source, body, shnex("arg"), key.clone());
    insert(&mut source, call.clone(), key, ex("focus"));
    insert(&mut source, shape.clone(), iri(RDF_TYPE), sh("NodeShape"));
    insert(&mut source, shape.clone(), sh("targetNode"), call);
    let shapes =
        ShapesGraph::compile(&snapshot(source), profiles(), &ValidationOptions::default()).unwrap();

    assert_eq!(
        Validator::new(&shapes, &ValidationOptions::default())
            .focus_nodes(&snapshot(Dataset::new()), &shape.into())
            .unwrap(),
        vec![Term::NamedNode(ex("focus"))]
    );
}

#[test]
fn declarations_and_call_shapes_fail_closed() {
    let function = ex("BrokenFunction");
    let key = ex("key");
    let body = blank("body");
    let call = blank("call");

    let mut missing_subclass = Dataset::new();
    insert(
        &mut missing_subclass,
        function.clone(),
        iri(RDF_TYPE),
        sh("NamedParameterExpressionFunction"),
    );
    insert(
        &mut missing_subclass,
        function.clone(),
        sh("parameter"),
        blank("parameter"),
    );
    insert(
        &mut missing_subclass,
        blank("parameter"),
        sh("path"),
        key.clone(),
    );
    insert(
        &mut missing_subclass,
        blank("parameter"),
        sh("keyParameter"),
        Literal::from(true),
    );
    insert(
        &mut missing_subclass,
        function.clone(),
        sh("bodyExpression"),
        body.clone(),
    );
    insert(
        &mut missing_subclass,
        body.clone(),
        shnex("arg"),
        key.clone(),
    );
    insert(
        &mut missing_subclass,
        call.clone(),
        key.clone(),
        ex("value"),
    );
    assert_ill_formed(missing_subclass, call.clone(), "not a SHACL subclass");

    let mut unexpected_call_property = Dataset::new();
    declare_named(
        &mut unexpected_call_property,
        function,
        blank("parameter"),
        key.clone(),
        body.clone(),
    );
    insert(
        &mut unexpected_call_property,
        body,
        shnex("arg"),
        key.clone(),
    );
    insert(
        &mut unexpected_call_property,
        call.clone(),
        key,
        ex("value"),
    );
    insert(
        &mut unexpected_call_property,
        call.clone(),
        ex("unexpected"),
        ex("value"),
    );
    assert_ill_formed(unexpected_call_property, call, "unexpected property");
}

#[test]
fn function_keys_are_globally_disjoint_and_reserved_keys_are_rejected() {
    let call = blank("call");
    let key = ex("shared");
    let mut duplicate = Dataset::new();
    for index in 0..2 {
        let body = blank(&format!("body-{index}"));
        declare_named(
            &mut duplicate,
            ex(&format!("Function-{index}")),
            blank(&format!("parameter-{index}")),
            key.clone(),
            body.clone(),
        );
        insert(&mut duplicate, body, shnex("arg"), key.clone());
    }
    insert(&mut duplicate, call.clone(), key, ex("value"));
    assert_ill_formed(duplicate, call.clone(), "not disjoint");

    let mut reserved = Dataset::new();
    let reserved_key = shnex("customKey");
    let body = blank("reserved-body");
    declare_named(
        &mut reserved,
        ex("ReservedFunction"),
        blank("reserved-parameter"),
        reserved_key.clone(),
        body.clone(),
    );
    insert(&mut reserved, body, shnex("arg"), reserved_key.clone());
    insert(&mut reserved, call.clone(), reserved_key, ex("value"));
    assert_ill_formed(reserved, call, "reserved key");
}

#[test]
fn arg_scope_and_recursive_function_bodies_are_rejected() {
    let outside = blank("outside");
    let mut source = Dataset::new();
    insert(&mut source, outside.clone(), shnex("arg"), ex("key"));
    assert_ill_formed(source, outside, "only well-formed inside");

    let function = ex("Recursive");
    let key = ex("key");
    let body = blank("recursive-body");
    let call = blank("recursive-call");
    let nested = blank("nested-call");
    let mut source = Dataset::new();
    declare_named(
        &mut source,
        function,
        blank("recursive-parameter"),
        key.clone(),
        body,
    );
    insert(
        &mut source,
        blank("recursive-body"),
        key.clone(),
        nested.clone(),
    );
    insert(&mut source, nested, shnex("arg"), key.clone());
    insert(&mut source, call.clone(), key, ex("value"));
    assert_ill_formed(source, call, "recursive custom");
}

#[test]
fn checked_compile_validates_unused_custom_function_bodies() {
    let body = blank("invalid-body");
    let mut source = Dataset::new();
    declare_named(
        &mut source,
        ex("UnusedFunction"),
        blank("unused-parameter"),
        ex("key"),
        body.clone(),
    );
    insert(&mut source, body, ex("unknownFunction"), ex("value"));

    let error =
        ShapesGraph::compile_checked(&snapshot(source), profiles(), &ValidationOptions::default())
            .unwrap_err();
    assert!(
        matches!(
            &error,
            CompileError::Validation(ValidationError::IllFormed(reason))
                if reason.contains("invalid sh:bodyExpression")
                    && reason.contains("unknown function")
        ),
        "unexpected error: {error}"
    );
}
