use super::*;
use crate::model::GraphSnapshot;
use oxrdf::{BlankNode, Dataset, GraphName, NamedOrBlankNode, Quad};

const EX: &str = "https://example.com/";
const XSD_BOOLEAN: &str = "http://www.w3.org/2001/XMLSchema#boolean";

fn named(value: impl Into<String>) -> NamedNode {
    let value: String = value.into();
    NamedNode::new_unchecked(value)
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

fn one_parameter(path: Option<Term>) -> (Dataset, ShapeId, ShapeId) {
    let component = ShapeId::from(named(format!("{EX}component")));
    let parameter = ShapeId::from(named(format!("{EX}parameter")));
    let mut dataset = Dataset::new();
    insert(
        &mut dataset,
        component.clone(),
        named(RDF_TYPE),
        named(COMPONENT),
    );
    insert(
        &mut dataset,
        component.clone(),
        named(sh("parameter")),
        parameter.clone(),
    );
    if let Some(path) = path {
        insert(&mut dataset, parameter.clone(), named(sh("path")), path);
    }
    (dataset, component, parameter)
}

fn parse_parameters(
    dataset: Dataset,
    component: &ShapeId,
) -> Result<Vec<Parameter>, ValidationError> {
    let graph = GraphSnapshot::default_graph(dataset);
    parameters(&RdfView::new(&graph), component)
}

#[test]
fn extracts_the_longest_eligible_ncname_suffix() {
    assert_eq!(
        parameter_name("https://example.com/ns#parameter").unwrap(),
        "parameter"
    );
    assert_eq!(
        parameter_name("https://example.com/ns?ignored=\u{e9}clair").unwrap(),
        "\u{e9}clair"
    );
    assert_eq!(parameter_name("urn:name").unwrap(), "ame");
    parameter_name("urn:a").unwrap_err();
    parameter_name("https://example.com/123").unwrap_err();
}

#[test]
fn constraint_components_and_parameter_paths_have_required_node_kinds_and_counts() {
    let blank_component = ShapeId::from(BlankNode::new_unchecked("component"));
    component_iri(&blank_component).unwrap_err();

    let (dataset, component, _) = one_parameter(None);
    parse_parameters(dataset, &component).unwrap_err();

    let (dataset, component, _) = one_parameter(Some(Literal::from("path").into()));
    parse_parameters(dataset, &component).unwrap_err();

    let (mut dataset, component, parameter) =
        one_parameter(Some(named(format!("{EX}first")).into()));
    insert(
        &mut dataset,
        parameter,
        named(sh("path")),
        named(format!("{EX}second")),
    );
    parse_parameters(dataset, &component).unwrap_err();

    let mut dataset = Dataset::new();
    let component = ShapeId::from(named(format!("{EX}component")));
    insert(
        &mut dataset,
        component.clone(),
        named(RDF_TYPE),
        named(COMPONENT),
    );
    insert(
        &mut dataset,
        component.clone(),
        named(sh("parameter")),
        Literal::from("not-a-node"),
    );
    parse_parameters(dataset, &component).unwrap_err();
}

#[test]
fn parameter_names_must_be_varnames_unique_and_not_reserved() {
    for reserved in ["this", "path", "PATH", "value"] {
        let (dataset, component, _) = one_parameter(Some(named(format!("{EX}{reserved}")).into()));
        let error = parse_parameters(dataset, &component).unwrap_err();
        assert!(error.to_string().contains("reserved"));
    }

    let (dataset, component, _) = one_parameter(Some(named(format!("{EX}has-dash")).into()));
    let error = parse_parameters(dataset, &component).unwrap_err();
    assert!(error.to_string().contains("VARNAME"));

    let (mut dataset, component, _) = one_parameter(Some(named("https://one.example/name").into()));
    let second = ShapeId::from(named(format!("{EX}second-parameter")));
    insert(
        &mut dataset,
        component.clone(),
        named(sh("parameter")),
        second.clone(),
    );
    insert(
        &mut dataset,
        second,
        named(sh("path")),
        named("https://two.example/name"),
    );
    let error = parse_parameters(dataset, &component).unwrap_err();
    assert!(error.to_string().contains("duplicate"));

    let (dataset, component, _) = one_parameter(Some(named(format!("{EX}\u{e9}clair")).into()));
    assert_eq!(
        parse_parameters(dataset, &component).unwrap()[0].variable,
        "\u{e9}clair"
    );
}

#[test]
fn optional_parameters_require_one_valid_boolean_and_one_mandatory_peer() {
    let (mut dataset, component, parameter) =
        one_parameter(Some(named(format!("{EX}code")).into()));
    insert(
        &mut dataset,
        parameter,
        named(sh("optional")),
        Literal::from("true"),
    );
    parse_parameters(dataset, &component).unwrap_err();

    let (mut dataset, component, parameter) =
        one_parameter(Some(named(format!("{EX}code")).into()));
    insert(
        &mut dataset,
        parameter,
        named(sh("optional")),
        Literal::new_typed_literal("maybe", named(XSD_BOOLEAN)),
    );
    parse_parameters(dataset, &component).unwrap_err();

    let (mut dataset, component, parameter) =
        one_parameter(Some(named(format!("{EX}code")).into()));
    insert(
        &mut dataset,
        parameter.clone(),
        named(sh("optional")),
        Literal::from(true),
    );
    insert(
        &mut dataset,
        parameter,
        named(sh("optional")),
        Literal::from(false),
    );
    parse_parameters(dataset, &component).unwrap_err();

    let (mut dataset, component, parameter) =
        one_parameter(Some(named(format!("{EX}code")).into()));
    insert(
        &mut dataset,
        parameter,
        named(sh("optional")),
        Literal::from(true),
    );
    parse_parameters(dataset, &component).unwrap_err();

    let (mut dataset, component, parameter) =
        one_parameter(Some(named(format!("{EX}code")).into()));
    insert(
        &mut dataset,
        parameter,
        named(sh("optional")),
        Literal::from(false),
    );
    let parsed = parse_parameters(dataset, &component).unwrap();
    assert!(!parsed[0].optional);
}

#[test]
fn constraints_activate_only_with_all_mandatory_parameter_values() {
    let (mut dataset, component, _) = one_parameter(Some(named(format!("{EX}required")).into()));
    let optional = ShapeId::from(named(format!("{EX}optional-parameter")));
    insert(
        &mut dataset,
        component.clone(),
        named(sh("parameter")),
        optional.clone(),
    );
    insert(
        &mut dataset,
        optional.clone(),
        named(sh("path")),
        named(format!("{EX}optional")),
    );
    insert(
        &mut dataset,
        optional,
        named(sh("optional")),
        Literal::from(true),
    );
    let owner = ShapeId::from(named(format!("{EX}owner")));
    let graph = GraphSnapshot::default_graph(dataset);
    let view = RdfView::new(&graph);
    let parsed = parameters(&view, &component).unwrap();
    assert!(parameter_bindings(&view, &owner, &parsed).is_none());

    let mut dataset = graph.isolated_default_dataset();
    insert(
        &mut dataset,
        owner.clone(),
        named(format!("{EX}required")),
        Literal::from("present"),
    );
    let graph = GraphSnapshot::default_graph(dataset);
    let view = RdfView::new(&graph);
    let parsed = parameters(&view, &component).unwrap();
    let bindings = parameter_bindings(&view, &owner, &parsed).unwrap();
    assert_eq!(bindings.len(), 2);
    assert!(
        bindings
            .iter()
            .any(|(name, values)| name == "optional" && values == &[None])
    );
}

#[test]
fn custom_messages_prefer_validator_then_component() {
    let (mut dataset, component, _) = one_parameter(Some(named(format!("{EX}required")).into()));
    let validator = ShapeId::from(named(format!("{EX}validator")));
    insert(
        &mut dataset,
        component.clone(),
        named(sh("message")),
        Literal::from("component"),
    );
    insert(
        &mut dataset,
        validator.clone(),
        named(sh("message")),
        Literal::from("validator"),
    );
    let graph = GraphSnapshot::default_graph(dataset);
    let view = RdfView::new(&graph);
    assert_eq!(
        validator_messages(&view, &validator, &component).unwrap()[0].value(),
        "validator"
    );

    let (mut dataset, component, _) = one_parameter(Some(named(format!("{EX}required")).into()));
    insert(
        &mut dataset,
        component.clone(),
        named(sh("message")),
        Literal::from("component"),
    );
    let graph = GraphSnapshot::default_graph(dataset);
    let view = RdfView::new(&graph);
    assert_eq!(
        validator_messages(&view, &validator, &component).unwrap()[0].value(),
        "component"
    );
}

fn component_syntax(dataset: Dataset, component: &ShapeId) -> Result<(), ValidationError> {
    let graph = GraphSnapshot::default_graph(dataset);
    let view = RdfView::new(&graph);
    let parameters = parameters(&view, component)?;
    validate_component_syntax(&view, component, &parameters)
}

#[test]
fn validator_properties_enforce_their_normative_query_roles() {
    for (property, class, query_property, query, expected) in [
        (
            "nodeValidator",
            ASK_VALIDATOR,
            "ask",
            "ASK { }",
            "SPARQL SELECT",
        ),
        (
            "propertyValidator",
            ASK_VALIDATOR,
            "ask",
            "ASK { }",
            "SPARQL SELECT",
        ),
        (
            "validator",
            SELECT_VALIDATOR,
            "select",
            "SELECT ?this WHERE { }",
            "SPARQL ASK",
        ),
    ] {
        let (mut dataset, component, _) =
            one_parameter(Some(named(format!("{EX}required")).into()));
        let validator = ShapeId::from(named(format!("{EX}{property}")));
        insert(
            &mut dataset,
            component.clone(),
            named(sh(property)),
            validator.clone(),
        );
        insert(
            &mut dataset,
            validator.clone(),
            named(RDF_TYPE),
            named(class),
        );
        insert(
            &mut dataset,
            validator,
            named(sh(query_property)),
            Literal::from(query),
        );
        let error = component_syntax(dataset, &component).unwrap_err();
        assert!(error.to_string().contains(expected), "{error}");
    }
}

#[test]
fn every_declared_validator_is_syntax_checked_even_when_not_selected() {
    let (mut dataset, component, _) = one_parameter(Some(named(format!("{EX}required")).into()));
    for (suffix, query) in [
        ("valid", Literal::from("SELECT ?this WHERE { }")),
        (
            "invalid",
            Literal::new_language_tagged_literal_unchecked("SELECT ?this WHERE { }", "en"),
        ),
    ] {
        let validator = ShapeId::from(named(format!("{EX}{suffix}")));
        insert(
            &mut dataset,
            component.clone(),
            named(sh("nodeValidator")),
            validator.clone(),
        );
        insert(
            &mut dataset,
            validator.clone(),
            named(RDF_TYPE),
            named(SELECT_VALIDATOR),
        );
        insert(&mut dataset, validator, named(sh("select")), query);
    }
    let error = component_syntax(dataset, &component).unwrap_err();
    assert!(error.to_string().contains("xsd:string"), "{error}");
}

#[test]
fn valid_specialized_select_and_generic_ask_validators_compile() {
    let (mut dataset, component, _) = one_parameter(Some(named(format!("{EX}required")).into()));
    for (suffix, property, class, query_property, query) in [
        (
            "select",
            "nodeValidator",
            SELECT_VALIDATOR,
            "select",
            "SELECT ?this WHERE { }",
        ),
        ("ask", "validator", ASK_VALIDATOR, "ask", "ASK { }"),
    ] {
        let validator = ShapeId::from(named(format!("{EX}{suffix}")));
        insert(
            &mut dataset,
            component.clone(),
            named(sh(property)),
            validator.clone(),
        );
        insert(
            &mut dataset,
            validator.clone(),
            named(RDF_TYPE),
            named(class),
        );
        insert(
            &mut dataset,
            validator,
            named(sh(query_property)),
            Literal::from(query),
        );
    }
    component_syntax(dataset, &component).unwrap();
}
