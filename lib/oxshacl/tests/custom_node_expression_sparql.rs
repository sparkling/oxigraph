#![cfg(feature = "sparql")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise normative custom/SPARQL composition"
)]

use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    ExpressionEnvironment, GraphSnapshot, ProfileId, ProfileSet, ShapesGraph, ValidationOptions,
    compile_node_expression, evaluate_expression,
};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const SH: &str = "http://www.w3.org/ns/shacl#";
const SHNEX: &str = "http://www.w3.org/ns/shacl-node-expr#";
const SPARQL: &str = "http://www.w3.org/ns/sparql#";

fn iri(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn term_iri(value: &str) -> Term {
    Term::NamedNode(iri(value))
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

fn list(dataset: &mut Dataset, prefix: &str, values: &[Term]) -> Term {
    if values.is_empty() {
        return term_iri(RDF_NIL);
    }
    let nodes = (0..values.len())
        .map(|index| BlankNode::new_unchecked(format!("{prefix}-{index}")))
        .collect::<Vec<_>>();
    for (index, value) in values.iter().enumerate() {
        insert(dataset, nodes[index].clone(), iri(RDF_FIRST), value.clone());
        insert(
            dataset,
            nodes[index].clone(),
            iri(RDF_REST),
            if index + 1 == nodes.len() {
                term_iri(RDF_NIL)
            } else {
                Term::BlankNode(nodes[index + 1].clone())
            },
        );
    }
    Term::BlankNode(nodes[0].clone())
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

fn evaluate(source: Dataset, call: BlankNode, data: Dataset, focus: NamedNode) -> Vec<Term> {
    let expression = compile_node_expression(
        &GraphSnapshot::default_graph(source),
        &Term::BlankNode(call),
        &ValidationOptions::default(),
    )
    .unwrap();
    evaluate_expression(
        &expression,
        &empty_shapes(),
        &GraphSnapshot::default_graph(data),
        &Term::NamedNode(focus),
        &ExpressionEnvironment::default(),
        &ValidationOptions::default(),
    )
    .unwrap()
}

#[test]
fn named_custom_body_passes_arbitrary_node_expressions_to_sparql_functions() {
    let function = iri("http://example.com/AverageExpression");
    let key = iri("http://example.com/average");
    let parameter = BlankNode::new_unchecked("average-parameter");
    let body = BlankNode::new_unchecked("divide");
    let sum = BlankNode::new_unchecked("sum");
    let count = BlankNode::new_unchecked("count");
    let sum_arg = BlankNode::new_unchecked("sum-arg");
    let count_arg = BlankNode::new_unchecked("count-arg");
    let call = BlankNode::new_unchecked("average-call");
    let input = BlankNode::new_unchecked("average-input");
    let mut source = Dataset::new();
    insert(
        &mut source,
        function.clone(),
        iri(RDF_TYPE),
        iri(&format!("{SH}NamedParameterExpressionFunction")),
    );
    insert(
        &mut source,
        function.clone(),
        iri(RDFS_SUBCLASS),
        iri(&format!("{SH}NamedParameterExpression")),
    );
    insert(
        &mut source,
        function.clone(),
        iri(&format!("{SH}parameter")),
        parameter.clone(),
    );
    insert(
        &mut source,
        function,
        iri(&format!("{SH}bodyExpression")),
        body.clone(),
    );
    insert(
        &mut source,
        parameter.clone(),
        iri(&format!("{SH}path")),
        key.clone(),
    );
    insert(
        &mut source,
        parameter,
        iri(&format!("{SH}keyParameter")),
        Literal::from(true),
    );
    insert(
        &mut source,
        sum_arg.clone(),
        iri(&format!("{SHNEX}arg")),
        key.clone(),
    );
    insert(
        &mut source,
        count_arg.clone(),
        iri(&format!("{SHNEX}arg")),
        key.clone(),
    );
    insert(
        &mut source,
        sum.clone(),
        iri(&format!("{SHNEX}sum")),
        sum_arg,
    );
    insert(
        &mut source,
        count.clone(),
        iri(&format!("{SHNEX}count")),
        count_arg,
    );
    let arguments = list(
        &mut source,
        "divide-list",
        &[Term::BlankNode(sum), Term::BlankNode(count)],
    );
    insert(
        &mut source,
        body,
        iri(&format!("{SPARQL}divide")),
        arguments,
    );
    insert(&mut source, call.clone(), key, input.clone());
    insert(
        &mut source,
        input,
        iri(&format!("{SHNEX}pathValues")),
        iri("http://example.com/value"),
    );
    let focus = iri("http://example.com/focus");
    let mut data = Dataset::new();
    insert(
        &mut data,
        focus.clone(),
        iri("http://example.com/value"),
        Literal::from(10),
    );
    insert(
        &mut data,
        focus.clone(),
        iri("http://example.com/value"),
        Literal::from(20),
    );

    let output = evaluate(source, call, data, focus);
    assert!(
        matches!(output.as_slice(), [Term::Literal(average)] if average.value() == "15"),
        "average function returned {output:?}"
    );
}

#[test]
fn list_custom_body_composes_arg_expressions_with_sparql_concat() {
    let function = iri("http://example.com/spacedConcat");
    let body = BlankNode::new_unchecked("concat");
    let arg0 = BlankNode::new_unchecked("arg-0");
    let arg1 = BlankNode::new_unchecked("arg-1");
    let call = BlankNode::new_unchecked("concat-call");
    let mut source = Dataset::new();
    insert(
        &mut source,
        function.clone(),
        iri(RDF_TYPE),
        iri(&format!("{SH}ListParameterExpressionFunction")),
    );
    insert(
        &mut source,
        function.clone(),
        iri(RDFS_SUBCLASS),
        iri(&format!("{SH}ListParameterExpression")),
    );
    insert(
        &mut source,
        function.clone(),
        iri(&format!("{SH}bodyExpression")),
        body.clone(),
    );
    insert(
        &mut source,
        arg0.clone(),
        iri(&format!("{SHNEX}arg")),
        Literal::from(0_i64),
    );
    insert(
        &mut source,
        arg1.clone(),
        iri(&format!("{SHNEX}arg")),
        Literal::from(1_i64),
    );
    let body_arguments = list(
        &mut source,
        "body-list",
        &[
            Term::BlankNode(arg0),
            Term::Literal(Literal::from(" ")),
            Term::BlankNode(arg1),
        ],
    );
    insert(
        &mut source,
        body,
        iri(&format!("{SPARQL}concat")),
        body_arguments,
    );
    let call_arguments = list(
        &mut source,
        "call-list",
        &[
            Term::Literal(Literal::from("Ada")),
            Term::Literal(Literal::from("Lovelace")),
        ],
    );
    insert(&mut source, call.clone(), function, call_arguments);

    assert_eq!(
        evaluate(
            source,
            call,
            Dataset::new(),
            iri("http://example.com/focus"),
        ),
        vec![Term::Literal(Literal::from("Ada Lovelace"))]
    );
}
