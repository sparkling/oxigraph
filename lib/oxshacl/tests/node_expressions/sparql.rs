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
