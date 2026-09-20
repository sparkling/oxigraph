use super::*;

#[test]
fn list_parameter_functions_accept_the_single_argument_form() {
    let expression = blank("expression");
    let mut source = Dataset::new();
    insert(
        &mut source,
        expression.clone(),
        iri("http://www.w3.org/ns/sparql#abs"),
        Literal::from(-42),
    );
    let source = snapshot(source);
    let compiled = compile_node_expression(
        &source,
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap();

    assert_eq!(
        evaluate_expression(
            &compiled,
            &empty_shapes(),
            &snapshot(Dataset::new()),
            &Term::NamedNode(iri("http://example.com/focus")),
            &ExpressionEnvironment::default(),
            &ValidationOptions::default(),
        )
        .unwrap(),
        vec![Term::Literal(Literal::from(42))]
    );
}

#[test]
fn select_expression_syntax_is_checked_before_evaluation() {
    let expression = blank("expression");

    let mut wrong_datatype = Dataset::new();
    insert(
        &mut wrong_datatype,
        expression.clone(),
        sh("select"),
        Literal::new_language_tagged_literal_unchecked("SELECT ?result WHERE { }", "en"),
    );
    assert_ill_formed(wrong_datatype, expression.clone(), "xsd:string");

    let mut multiple_projection = Dataset::new();
    insert(
        &mut multiple_projection,
        expression.clone(),
        sh("select"),
        Literal::from("SELECT ?first ?second WHERE { FILTER(false) }"),
    );
    assert_ill_formed(
        multiple_projection,
        expression.clone(),
        "exactly one variable",
    );

    let mut ambiguous = Dataset::new();
    insert(
        &mut ambiguous,
        expression.clone(),
        sh("select"),
        Literal::from("SELECT ?result WHERE { }"),
    );
    insert(
        &mut ambiguous,
        expression.clone(),
        sh("sparqlExpr"),
        Literal::from("true"),
    );
    assert_ill_formed(ambiguous, expression.clone(), "unexpected property");

    let mut duplicate_prefix_roots = Dataset::new();
    insert(
        &mut duplicate_prefix_roots,
        expression.clone(),
        sh("select"),
        Literal::from("SELECT ?result WHERE { }"),
    );
    insert(
        &mut duplicate_prefix_roots,
        expression.clone(),
        sh("prefixes"),
        iri("http://example.com/prefixes/one"),
    );
    insert(
        &mut duplicate_prefix_roots,
        expression.clone(),
        sh("prefixes"),
        iri("http://example.com/prefixes/two"),
    );
    assert_ill_formed(duplicate_prefix_roots, expression.clone(), "multiple");

    let mut valid = Dataset::new();
    insert(
        &mut valid,
        expression.clone(),
        sh("select"),
        Literal::from("SELECT ?result WHERE { BIND(42 AS ?result) }"),
    );
    compile_node_expression(
        &snapshot(valid),
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap();
}


fn expression_list(
    source: &mut Dataset,
    local: &str,
    members: impl IntoIterator<Item = Term>,
) -> BlankNode {
    let members = members.into_iter().collect::<Vec<_>>();
    assert!(!members.is_empty(), "test expression lists must not be empty");
    let nodes = (0..members.len())
        .map(|index| blank(&format!("{local}-{index}")))
        .collect::<Vec<_>>();
    for (index, member) in members.into_iter().enumerate() {
        insert(
            source,
            nodes[index].clone(),
            iri(RDF_FIRST),
            member,
        );
        insert(
            source,
            nodes[index].clone(),
            iri(RDF_REST),
            if index + 1 == nodes.len() {
                Term::NamedNode(iri(RDF_NIL))
            } else {
                Term::BlankNode(nodes[index + 1].clone())
            },
        );
    }
    nodes[0].clone()
}

fn sparql_call(
    source: &mut Dataset,
    id: &str,
    function: &str,
    arguments: impl IntoIterator<Item = Term>,
) -> BlankNode {
    let expression = blank(id);
    let arguments = expression_list(source, &format!("{id}-arguments"), arguments);
    insert(
        source,
        expression.clone(),
        iri(&format!("http://www.w3.org/ns/sparql#{function}")),
        arguments,
    );
    expression
}

fn compile_call(source: &GraphSnapshot, expression: BlankNode) -> oxshacl::NodeExpression {
    compile_node_expression(
        source,
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap()
}

fn evaluate_call(
    source: Dataset,
    expression: BlankNode,
    options: &ValidationOptions,
) -> Result<Vec<Term>, ValidationError> {
    let source = snapshot(source);
    let compiled = compile_call(&source, expression);
    evaluate_expression(
        &compiled,
        &empty_shapes(),
        &snapshot(Dataset::new()),
        &Term::NamedNode(iri("http://example.com/focus")),
        &ExpressionEnvironment::default(),
        options,
    )
}

fn evaluate_simple_call(
    function: &str,
    arguments: impl IntoIterator<Item = Term>,
    options: &ValidationOptions,
) -> Result<Vec<Term>, ValidationError> {
    let mut source = Dataset::new();
    let expression = sparql_call(&mut source, "expression", function, arguments);
    evaluate_call(source, expression, options)
}

fn assert_sparql_failure(result: &Result<Vec<Term>, ValidationError>) {
    assert!(
        matches!(result, Err(ValidationError::Sparql(_))),
        "expected SPARQL failure, got {result:?}"
    );
}

#[test]
fn strict_scalar_calls_lift_missing_operands_to_empty() {
    let options = ValidationOptions::default();
    assert_eq!(
        evaluate_simple_call(
            "multiply",
            [
                Term::BlankNode(blank("missing")),
                Term::Literal(Literal::from(7)),
            ],
            &options,
        )
        .unwrap(),
        Vec::<Term>::new()
    );
    assert_eq!(
        evaluate_simple_call(
            "multiply",
            [
                Term::BlankNode(blank("missing-left")),
                Term::BlankNode(blank("missing-right")),
            ],
            &options,
        )
        .unwrap(),
        Vec::<Term>::new()
    );
    assert_eq!(
        evaluate_simple_call(
            "multiply",
            [
                Term::Literal(Literal::from(6)),
                Term::Literal(Literal::from(7)),
            ],
            &options,
        )
        .unwrap(),
        vec![Term::Literal(Literal::from(42))]
    );
}

#[test]
fn all_bound_scalar_errors_and_compile_boundaries_remain_visible() {
    let options = ValidationOptions::default();
    assert_sparql_failure(&evaluate_simple_call(
        "multiply",
        [
            Term::Literal(Literal::from("not numeric")),
            Term::Literal(Literal::from(2)),
        ],
        &options,
    ));
    assert_sparql_failure(&evaluate_simple_call(
        "divide",
        [
            Term::Literal(Literal::from(1)),
            Term::Literal(Literal::from(0)),
        ],
        &options,
    ));
    assert_sparql_failure(&evaluate_simple_call(
        "divide",
        [
            Term::Literal(Literal::new_typed_literal(
                "1.0",
                iri("http://www.w3.org/2001/XMLSchema#decimal"),
            )),
            Term::Literal(Literal::new_typed_literal(
                "0.0",
                iri("http://www.w3.org/2001/XMLSchema#decimal"),
            )),
        ],
        &options,
    ));

    let expression = blank("wrong-arity");
    let mut wrong_arity = Dataset::new();
    insert(
        &mut wrong_arity,
        expression.clone(),
        iri("http://www.w3.org/ns/sparql#multiply"),
        blank("missing-arity-argument"),
    );
    assert_ill_formed(wrong_arity, expression, "requires two arguments");

    let iri_wrong_arity = oxshacl::NodeExpression::SparqlFunction {
        expression: "<http://www.w3.org/ns/sparql#multiply>(?__shacl_arg_0)".to_owned(),
        arguments: vec![oxshacl::NodeExpression::Empty],
    };
    assert_sparql_failure(
        &evaluate_expression(
            &iri_wrong_arity,
            &empty_shapes(),
            &snapshot(Dataset::new()),
            &Term::NamedNode(iri("http://example.com/focus")),
            &ExpressionEnvironment::default(),
            &options,
        ),
    );

    let expression = blank("invalid-syntax");
    let mut invalid_syntax = Dataset::new();
    insert(
        &mut invalid_syntax,
        expression.clone(),
        sh("sparqlExpr"),
        Literal::from("("),
    );
    let error = compile_node_expression(
        &snapshot(invalid_syntax),
        &Term::BlankNode(expression),
        &options,
    )
    .unwrap_err();
    assert!(
        matches!(&error, CompileError::Validation(ValidationError::Sparql(_))),
        "unexpected syntax error: {error}"
    );
}

#[test]
fn absence_aware_forms_recover_only_where_sparql_defines_it() {
    let options = ValidationOptions::default();
    assert_eq!(
        evaluate_simple_call(
            "bound",
            [Term::BlankNode(blank("missing"))],
            &options,
        )
        .unwrap(),
        vec![Term::Literal(Literal::from(false))]
    );
    assert_eq!(
        evaluate_simple_call(
            "bound",
            [Term::Literal(Literal::from(1))],
            &options,
        )
        .unwrap(),
        vec![Term::Literal(Literal::from(true))]
    );
    assert_eq!(
        evaluate_simple_call(
            "coalesce",
            [
                Term::BlankNode(blank("missing")),
                Term::Literal(Literal::from(7)),
            ],
            &options,
        )
        .unwrap(),
        vec![Term::Literal(Literal::from(7))]
    );
    assert_sparql_failure(&evaluate_simple_call(
        "coalesce",
        [
            Term::BlankNode(blank("missing-first")),
            Term::BlankNode(blank("missing-second")),
        ],
        &options,
    ));

    for (expression, expected) in [
        (
            "?__shacl_arg_0 IN (?__shacl_arg_1, ?__shacl_arg_2)",
            true,
        ),
        (
            "?__shacl_arg_0 NOT IN (?__shacl_arg_1, ?__shacl_arg_2)",
            false,
        ),
    ] {
        let membership = oxshacl::NodeExpression::SparqlFunction {
            expression: expression.to_owned(),
            arguments: vec![
                oxshacl::NodeExpression::Constant(Term::Literal(Literal::from(1))),
                oxshacl::NodeExpression::Empty,
                oxshacl::NodeExpression::Constant(Term::Literal(Literal::from(1))),
            ],
        };
        assert_eq!(
            evaluate_expression(
                &membership,
                &empty_shapes(),
                &snapshot(Dataset::new()),
                &Term::NamedNode(iri("http://example.com/focus")),
                &ExpressionEnvironment::default(),
                &options,
            )
            .unwrap(),
            vec![Term::Literal(Literal::from(expected))]
        );
    }

    for (condition, then_value, else_value, expected) in [
        (
            true,
            Term::Literal(Literal::from(11)),
            Term::BlankNode(blank("unused-else")),
            Term::Literal(Literal::from(11)),
        ),
        (
            false,
            Term::BlankNode(blank("unused-then")),
            Term::Literal(Literal::from(12)),
            Term::Literal(Literal::from(12)),
        ),
    ] {
        assert_eq!(
            evaluate_simple_call(
                "if",
                [
                    Term::Literal(Literal::from(condition)),
                    then_value,
                    else_value,
                ],
                &options,
            )
            .unwrap(),
            vec![expected]
        );
    }
    for (condition, then_value, else_value) in [
        (
            true,
            Term::BlankNode(blank("selected-then")),
            Term::Literal(Literal::from(13)),
        ),
        (
            false,
            Term::Literal(Literal::from(14)),
            Term::BlankNode(blank("selected-else")),
        ),
    ] {
        assert_sparql_failure(&evaluate_simple_call(
            "if",
            [
                Term::Literal(Literal::from(condition)),
                then_value,
                else_value,
            ],
            &options,
        ));
    }

    assert_eq!(
        evaluate_simple_call(
            "logical-and",
            [
                Term::Literal(Literal::from(false)),
                Term::BlankNode(blank("missing")),
            ],
            &options,
        )
        .unwrap(),
        vec![Term::Literal(Literal::from(false))]
    );
    assert_eq!(
        evaluate_simple_call(
            "logical-or",
            [
                Term::Literal(Literal::from(true)),
                Term::BlankNode(blank("missing")),
            ],
            &options,
        )
        .unwrap(),
        vec![Term::Literal(Literal::from(true))]
    );
}

#[test]
fn nested_argument_failures_cardinality_and_generic_select_remain_strict() {
    let options = ValidationOptions::default();

    for expression in [
        "(1 / 0)",
        "COALESCE(?__shacl_arg_0, (\"not numeric\" * 2))",
        "IF(BOUND(?__shacl_arg_0), 1, (\"not numeric\" * 2))",
    ] {
        let function = oxshacl::NodeExpression::SparqlFunction {
            expression: expression.to_owned(),
            arguments: vec![oxshacl::NodeExpression::Empty],
        };
        assert_sparql_failure(
            &evaluate_expression(
                &function,
                &empty_shapes(),
                &snapshot(Dataset::new()),
                &Term::NamedNode(iri("http://example.com/focus")),
                &ExpressionEnvironment::default(),
                &options,
            ),
        );
    }

    let mut nested_source = Dataset::new();
    let division = sparql_call(
        &mut nested_source,
        "division",
        "divide",
        [
            Term::Literal(Literal::from(1)),
            Term::Literal(Literal::from(0)),
        ],
    );
    let outer = sparql_call(
        &mut nested_source,
        "outer",
        "multiply",
        [
            Term::BlankNode(blank("missing")),
            Term::BlankNode(division),
        ],
    );
    assert_sparql_failure(&evaluate_call(nested_source, outer, &options));

    let mut branch_source = Dataset::new();
    let division = sparql_call(
        &mut branch_source,
        "unused-division",
        "divide",
        [
            Term::Literal(Literal::from(1)),
            Term::Literal(Literal::from(0)),
        ],
    );
    let conditional = sparql_call(
        &mut branch_source,
        "conditional",
        "if",
        [
            Term::Literal(Literal::from(true)),
            Term::Literal(Literal::from(1)),
            Term::BlankNode(division),
        ],
    );
    assert_sparql_failure(&evaluate_call(branch_source, conditional, &options));

    let mut cardinality_source = Dataset::new();
    let multiple = expression_list(
        &mut cardinality_source,
        "multiple",
        [
            Term::Literal(Literal::from(2)),
            Term::Literal(Literal::from(3)),
        ],
    );
    let product = sparql_call(
        &mut cardinality_source,
        "cardinality-product",
        "multiply",
        [
            Term::BlankNode(multiple),
            Term::Literal(Literal::from(4)),
        ],
    );
    let result = evaluate_call(cardinality_source, product, &options);
    assert!(
        matches!(&result, Err(ValidationError::IllFormed(reason)) if reason.contains("more than one")),
        "unexpected cardinality result: {result:?}"
    );

    let expression = blank("unbound-select");
    let mut select_source = Dataset::new();
    insert(
        &mut select_source,
        expression.clone(),
        sh("select"),
        Literal::from("SELECT ?result WHERE { }"),
    );
    let result = evaluate_call(select_source, expression, &options);
    assert!(
        matches!(&result, Err(ValidationError::IllFormed(reason)) if reason.contains("exactly one variable")),
        "generic SELECT row-shape handling changed: {result:?}"
    );
}

#[test]
fn empty_strict_calls_still_observe_query_and_operation_controls() {
    let arguments = || {
        [
            Term::BlankNode(blank("missing")),
            Term::Literal(Literal::from(2)),
        ]
    };

    let mut query_limited = ValidationOptions::default();
    query_limited.limits.max_query_bytes = 0;
    let result = evaluate_simple_call("multiply", arguments(), &query_limited);
    assert!(
        matches!(
            &result,
            Err(ValidationError::LimitExceeded {
                kind: oxshacl::LimitKind::QueryBytes,
                limit: 0,
            })
        ),
        "empty strict call bypassed the query-byte ceiling: {result:?}"
    );

    let cancelled = ValidationOptions::default();
    cancelled.cancellation_token.cancel();
    let result = evaluate_simple_call("multiply", arguments(), &cancelled);
    assert!(
        matches!(&result, Err(ValidationError::Cancelled)),
        "empty strict call bypassed cancellation: {result:?}"
    );

    let mut expired = ValidationOptions::default();
    expired.limits.timeout = Some(std::time::Duration::ZERO);
    let result = evaluate_simple_call("multiply", arguments(), &expired);
    assert!(
        matches!(
            &result,
            Err(ValidationError::LimitExceeded {
                kind: oxshacl::LimitKind::Time,
                limit: 0,
            })
        ),
        "empty strict call bypassed the deadline: {result:?}"
    );
}


#[test]
fn missing_operand_does_not_hide_a_nested_unsupported_function() {
    let expression = oxshacl::NodeExpression::SparqlFunction {
        expression: "<http://www.w3.org/ns/sparql#add>(?__shacl_arg_0, <urn:unsupported>())"
            .to_owned(),
        arguments: vec![oxshacl::NodeExpression::Empty],
    };
    let result = evaluate_expression(
        &expression,
        &empty_shapes(),
        &snapshot(Dataset::new()),
        &Term::NamedNode(iri("http://example.com/focus")),
        &ExpressionEnvironment::default(),
        &ValidationOptions::default(),
    );
    assert!(
        matches!(&result, Err(ValidationError::Sparql(_))),
        "missing operand hid the nested unsupported function: {result:?}"
    );
}
