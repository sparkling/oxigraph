use super::*;
use crate::control::ValidationOptions;
use oxrdf::{BlankNode, Dataset, NamedNode, Variable};

fn focus() -> Term {
    NamedNode::new_unchecked("urn:focus").into()
}

fn empty_graph() -> GraphSnapshot {
    GraphSnapshot::default_graph(Dataset::new())
}

fn evaluate(
    constraint: &SparqlConstraint,
    values: &[Term],
) -> Result<Vec<Violation>, ValidationError> {
    let options = ValidationOptions::default();
    let mut budget = Budget::new(&options)?;
    constraint.evaluate(&empty_graph(), &focus(), values, &mut budget)
}

#[test]
fn true_failure_binding_aborts_validation() {
    let constraint = SparqlConstraint::new("SELECT ?this (true AS ?failure) WHERE { }").unwrap();
    let focus = focus();
    let error = evaluate(&constraint, std::slice::from_ref(&focus)).unwrap_err();
    assert!(matches!(error, ValidationError::Sparql(_)));
}

#[test]
fn solution_bindings_interpolate_declared_messages() {
    let constraint = SparqlConstraint::new("SELECT ?this (\"Alice\" AS ?name) WHERE { }")
        .unwrap()
        .with_messages([Literal::from("Hello {?name}")]);
    let focus = focus();
    let violations = evaluate(&constraint, std::slice::from_ref(&focus)).unwrap();
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].messages[0].value(), "Hello Alice");
}

#[test]
fn direct_this_is_prebound_in_filter_only_queries() {
    let constraint =
        SparqlConstraint::new("SELECT ?this WHERE { FILTER(?this = <urn:focus>) }").unwrap();
    let focus = focus();
    assert_eq!(
        evaluate(&constraint, std::slice::from_ref(&focus))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn this_is_prebound_inside_exists_patterns() {
    let constraint = SparqlConstraint::new(
        "SELECT ?this WHERE { FILTER EXISTS { ?this <urn:predicate> <urn:object> } }",
    )
    .unwrap();
    let mut dataset = Dataset::new();
    dataset.insert(oxrdf::Quad::new(
        NamedNode::new_unchecked("urn:focus"),
        NamedNode::new_unchecked("urn:predicate"),
        NamedNode::new_unchecked("urn:object"),
        oxrdf::GraphName::DefaultGraph,
    ));
    let options = ValidationOptions::default();
    let mut budget = Budget::new(&options).unwrap();
    let focus = focus();
    let violations = constraint
        .evaluate(
            &GraphSnapshot::default_graph(dataset),
            &focus,
            std::slice::from_ref(&focus),
            &mut budget,
        )
        .unwrap();
    assert_eq!(violations.len(), 1);
}

#[test]
fn declared_severity_overrides_solution_severity() {
    let declared = NamedNode::new_unchecked("urn:declared-severity");
    let constraint =
        SparqlConstraint::new("SELECT ?this (<urn:solution-severity> AS ?severity) WHERE { }")
            .unwrap()
            .with_severity(declared.clone());
    let focus = focus();
    let violations = evaluate(&constraint, std::slice::from_ref(&focus)).unwrap();
    assert_eq!(violations[0].severity.as_ref(), Some(&declared));
}

#[test]
fn explicit_result_bindings_map_in_normative_precedence_order() {
    let source = NamedNode::new_unchecked("urn:source");
    let severity = NamedNode::new_unchecked("urn:severity");
    let constraint = SparqlConstraint::new(
        "SELECT ?this (<urn:value> AS ?value) (<urn:path> AS ?path) \
         (\"Hello {?name}\" AS ?message) (\"Alice\" AS ?name) WHERE { }",
    )
    .unwrap()
    .with_source(source.clone().into())
    .with_severity(severity.clone());
    let violations = evaluate(
        &constraint,
        &[NamedNode::new_unchecked("urn:fallback").into()],
    )
    .unwrap();
    let violation = &violations[0];
    assert_eq!(
        violation.value,
        Some(NamedNode::new_unchecked("urn:value").into())
    );
    assert_eq!(
        violation.path,
        Some(PropertyPath::Predicate(NamedNode::new_unchecked(
            "urn:path"
        )))
    );
    assert_eq!(violation.source_constraint, Some(source.into()));
    assert_eq!(violation.severity, Some(severity));
    assert_eq!(violation.messages[0].value(), "Hello Alice");
}

#[test]
fn result_fallbacks_ignore_ineligible_path_and_solution_severity() {
    let constraint = SparqlConstraint::new(
        "SELECT ?this (\"not-an-iri\" AS ?path) \
         (<urn:not-a-result-binding> AS ?severity) WHERE { }",
    )
    .unwrap();
    let fallback = Term::from(NamedNode::new_unchecked("urn:only-value-node"));
    let violations = evaluate(&constraint, std::slice::from_ref(&fallback)).unwrap();
    assert_eq!(violations[0].value.as_ref(), Some(&fallback));
    assert_eq!(violations[0].path, None);
    assert_eq!(violations[0].severity, None);
}

#[test]
fn completed_results_apply_property_shape_and_custom_component_fallbacks() {
    let component = NamedNode::new_unchecked("urn:custom-component");
    let constraint = SparqlConstraint::new_custom(
        "SELECT ?this WHERE { }".to_owned(),
        false,
        vec![("limit".to_owned(), Some(Literal::from(2).into()))],
        component.clone(),
        Vec::new(),
        Vec::new(),
    )
    .unwrap();
    let focus = focus();
    let value = Term::from(NamedNode::new_unchecked("urn:value"));
    let violation = evaluate(&constraint, std::slice::from_ref(&value))
        .unwrap()
        .pop()
        .unwrap();

    let path = PropertyPath::Predicate(NamedNode::new_unchecked("urn:property"));
    let severity = NamedNode::new_unchecked("urn:shape-severity");
    let mut shape = crate::Shape::property(NamedNode::new_unchecked("urn:shape"), path.clone());
    shape.severity.clone_from(&severity);
    shape.messages.push(Literal::from("shape fallback"));
    let result = crate::validate::ValidationContext::result(
        &shape,
        &focus,
        &crate::Constraint::Sparql(constraint),
        violation,
    );

    assert_eq!(result.focus_node, focus);
    assert_eq!(result.value, Some(value));
    assert_eq!(result.result_path, Some(path));
    assert_eq!(result.source_constraint, None);
    assert_eq!(result.source_constraint_component, component);
    assert_eq!(result.severity, severity);
    assert_eq!(result.messages[0].value(), "shape fallback");
}

#[test]
fn an_unbound_value_maps_only_when_the_value_node_is_unambiguous() {
    let constraint = SparqlConstraint::new("SELECT ?this WHERE { }").unwrap();
    let violations = evaluate(&constraint, &[]).unwrap();
    assert_eq!(violations[0].value, None);

    let values = [
        Term::from(NamedNode::new_unchecked("urn:first")),
        Term::from(NamedNode::new_unchecked("urn:second")),
    ];
    let error = evaluate(&constraint, &values).unwrap_err();
    assert!(matches!(error, ValidationError::Sparql(_)));
    assert!(error.to_string().contains("ambiguous"));
}

#[test]
fn a_result_requires_a_this_binding_and_a_literal_message() {
    let constraint = SparqlConstraint::new("SELECT ?this WHERE { }").unwrap();
    let solution = spareval::QuerySolution::from((
        vec![Variable::new_unchecked("value")],
        vec![Some(Literal::from("value").into())],
    ));
    let error = constraint
        .map_solution(&solution, &focus(), &[], None)
        .unwrap_err();
    assert!(error.to_string().contains("no binding"));

    let constraint =
        SparqlConstraint::new("SELECT ?this (<urn:message> AS ?message) WHERE { }").unwrap();
    let focus = focus();
    let error = evaluate(&constraint, std::slice::from_ref(&focus)).unwrap_err();
    assert!(matches!(error, ValidationError::IllFormed(_)));
}

#[test]
fn custom_select_messages_interpolate_result_and_parameter_bindings() {
    let constraint = SparqlConstraint::new_custom(
        "SELECT ?this (\"Alice\" AS ?name) \
         (\"Hello {?name}, limit {$limit}\" AS ?message) WHERE { }"
            .to_owned(),
        false,
        vec![("limit".to_owned(), Some(Literal::from(2).into()))],
        NamedNode::new_unchecked("urn:component"),
        Vec::new(),
        Vec::new(),
    )
    .unwrap();
    let focus = focus();
    let violations = evaluate(&constraint, std::slice::from_ref(&focus)).unwrap();
    assert_eq!(violations[0].messages[0].value(), "Hello Alice, limit 2");
}

#[test]
fn custom_ask_messages_interpolate_generated_solution_bindings() {
    let constraint = SparqlConstraint::new_custom(
        "ASK { FILTER(false) }".to_owned(),
        true,
        vec![("limit".to_owned(), Some(Literal::from(2).into()))],
        NamedNode::new_unchecked("urn:component"),
        vec![Literal::from(
            "focus {?this}; value {?value}; limit {$limit}",
        )],
        Vec::new(),
    )
    .unwrap();
    let value = Term::from(NamedNode::new_unchecked("urn:value"));
    let violations = evaluate(&constraint, std::slice::from_ref(&value)).unwrap();
    assert_eq!(
        violations[0].messages[0].value(),
        "focus urn:focus; value urn:value; limit 2"
    );
}

#[cfg(feature = "rdf-12")]
#[test]
fn message_interpolation_renders_triple_terms() {
    let triple = Term::from(oxrdf::Triple::new(
        NamedNode::new_unchecked("urn:subject"),
        NamedNode::new_unchecked("urn:predicate"),
        NamedNode::new_unchecked("urn:object"),
    ));
    let message = interpolate_message(
        &Literal::from("triple {?triple}"),
        &[("triple".to_owned(), Some(triple))],
    );
    assert!(message.value().contains("urn:subject"));
    assert!(message.value().contains("urn:predicate"));
    assert!(message.value().contains("urn:object"));
}

#[test]
fn custom_variables_are_prebound_in_filter_only_queries() {
    let ask = SparqlConstraint::new_custom(
        "ASK { FILTER($value = <urn:accepted>) }".to_owned(),
        true,
        vec![("limit".to_owned(), Some(Literal::from(2).into()))],
        NamedNode::new_unchecked("urn:component"),
        Vec::new(),
        Vec::new(),
    )
    .unwrap();
    assert!(
        evaluate(
            &ask,
            &[Term::from(NamedNode::new_unchecked("urn:accepted"))]
        )
        .unwrap()
        .is_empty()
    );
    assert_eq!(
        evaluate(
            &ask,
            &[Term::from(NamedNode::new_unchecked("urn:rejected"))]
        )
        .unwrap()
        .len(),
        1
    );

    let select = SparqlConstraint::new_custom(
        "SELECT ?this WHERE { FILTER($limit = 2) }".to_owned(),
        false,
        vec![("limit".to_owned(), Some(Literal::from(2).into()))],
        NamedNode::new_unchecked("urn:component"),
        Vec::new(),
        Vec::new(),
    )
    .unwrap();
    let focus = focus();
    assert_eq!(
        evaluate(&select, std::slice::from_ref(&focus))
            .unwrap()
            .len(),
        1
    );

    let blank = SparqlConstraint::new_custom(
        "SELECT ?this WHERE { FILTER(isBlank($marker)) }".to_owned(),
        false,
        vec![(
            "marker".to_owned(),
            Some(BlankNode::new_unchecked("marker").into()),
        )],
        NamedNode::new_unchecked("urn:component"),
        Vec::new(),
        Vec::new(),
    )
    .unwrap();
    assert_eq!(
        evaluate(&blank, std::slice::from_ref(&focus))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn custom_validators_obey_the_query_byte_limit() {
    let constraint = SparqlConstraint::new_custom(
        "ASK { FILTER(true) }".to_owned(),
        true,
        Vec::new(),
        NamedNode::new_unchecked("urn:component"),
        Vec::new(),
        Vec::new(),
    )
    .unwrap();
    let mut options = ValidationOptions::default();
    options.limits.max_query_bytes = 1;
    let mut budget = Budget::new(&options).unwrap();
    let value = Term::from(NamedNode::new_unchecked("urn:value"));
    let error = constraint
        .evaluate(
            &empty_graph(),
            &focus(),
            std::slice::from_ref(&value),
            &mut budget,
        )
        .unwrap_err();
    assert!(matches!(
        error,
        ValidationError::LimitExceeded {
            kind: LimitKind::QueryBytes,
            limit: 1
        }
    ));
}
