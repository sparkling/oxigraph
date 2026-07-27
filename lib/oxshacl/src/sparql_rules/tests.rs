use super::*;
use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad};

const EX: &str = "urn:test:";

fn named(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{EX}{local}"))
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

fn profiles() -> ProfileSet {
    ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::SparqlExtensions12Subset20260130,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap()
}

fn add_global_rule(dataset: &mut Dataset, local: &str, construct: Literal) -> ShapeId {
    let rule = ShapeId::from(named(local));
    insert(
        dataset,
        rule.clone(),
        NamedNode::new_unchecked(RDF_TYPE),
        NamedNode::new_unchecked(SPARQL_RULE),
    );
    insert(
        dataset,
        rule.clone(),
        NamedNode::new_unchecked(SH_CONSTRUCT),
        construct,
    );
    rule
}

fn compile(dataset: Dataset) -> Result<SparqlRuleSet, RuleError> {
    SparqlRuleSet::compile(
        &GraphSnapshot::default_graph(dataset),
        profiles(),
        &ValidationOptions::default(),
    )
}

#[test]
fn rule_syntax_fails_closed_for_types_nodes_and_datatypes() {
    let query = Literal::from("CONSTRUCT { <urn:s> <urn:p> <urn:o> } WHERE { }");

    let mut missing_type = Dataset::new();
    let shape = named("shape");
    let rule = named("missing-type");
    insert(
        &mut missing_type,
        shape,
        NamedNode::new_unchecked(SH_RULE),
        rule.clone(),
    );
    insert(
        &mut missing_type,
        rule,
        NamedNode::new_unchecked(SH_CONSTRUCT),
        query.clone(),
    );
    assert!(
        compile(missing_type)
            .unwrap_err()
            .to_string()
            .contains("rdf:type")
    );

    let mut blank_subject = Dataset::new();
    let rule = add_global_rule(&mut blank_subject, "blank-subject-rule", query.clone());
    insert(
        &mut blank_subject,
        BlankNode::new_unchecked("shape"),
        NamedNode::new_unchecked(SH_RULE),
        rule,
    );
    assert!(
        compile(blank_subject)
            .unwrap_err()
            .to_string()
            .contains("subjects of sh:rule")
    );

    let mut wrong_construct = Dataset::new();
    add_global_rule(
        &mut wrong_construct,
        "wrong-construct",
        Literal::new_language_tagged_literal_unchecked("CONSTRUCT { } WHERE { }", "en"),
    );
    assert!(
        compile(wrong_construct)
            .unwrap_err()
            .to_string()
            .contains("xsd:string")
    );

    let mut wrong_order = Dataset::new();
    let rule = add_global_rule(&mut wrong_order, "wrong-order", query.clone());
    insert(
        &mut wrong_order,
        rule,
        NamedNode::new_unchecked(SH_ORDER),
        Literal::from("1"),
    );
    assert!(
        compile(wrong_order)
            .unwrap_err()
            .to_string()
            .contains("sh:order")
    );

    let mut wrong_deactivated = Dataset::new();
    let rule = add_global_rule(&mut wrong_deactivated, "wrong-deactivated", query);
    insert(
        &mut wrong_deactivated,
        rule,
        NamedNode::new_unchecked(SH_DEACTIVATED),
        Literal::from("true"),
    );
    assert!(
        compile(wrong_deactivated)
            .unwrap_err()
            .to_string()
            .contains("sh:deactivated")
    );
}

#[test]
fn rules_graph_identifiers_and_global_conditions_fail_closed() {
    let query = Literal::from("CONSTRUCT { <urn:s> <urn:p> <urn:o> } WHERE { }");
    let mut blank_rules_graph = Dataset::new();
    add_global_rule(&mut blank_rules_graph, "rule", query.clone());
    insert(
        &mut blank_rules_graph,
        BlankNode::new_unchecked("rules-graph"),
        NamedNode::new_unchecked(RDF_TYPE),
        NamedNode::new_unchecked(RULES_GRAPH),
    );
    assert!(
        compile(blank_rules_graph)
            .unwrap_err()
            .to_string()
            .contains("RulesGraph subjects must be IRIs")
    );

    let mut global_condition = Dataset::new();
    let rule = add_global_rule(&mut global_condition, "global", query);
    let condition = named("condition");
    insert(
        &mut global_condition,
        rule,
        NamedNode::new_unchecked(SH_CONDITION),
        condition.clone(),
    );
    insert(
        &mut global_condition,
        condition,
        NamedNode::new_unchecked(RDF_TYPE),
        NamedNode::new_unchecked("http://www.w3.org/ns/shacl#NodeShape"),
    );
    assert!(
        compile(global_condition)
            .unwrap_err()
            .to_string()
            .contains("global rule has no focus node")
    );
}

fn chain_rules(second_order: i64) -> (SparqlRuleSet, GraphSnapshot) {
    let mut dataset = Dataset::new();
    insert(&mut dataset, named("seed"), named("input"), named("value"));
    let first = add_global_rule(
        &mut dataset,
        "first",
        Literal::from(
            "CONSTRUCT { <urn:test:seed> <urn:test:first> ?value } \
             WHERE { <urn:test:seed> <urn:test:input> ?value }",
        ),
    );
    insert(
        &mut dataset,
        first,
        NamedNode::new_unchecked(SH_ORDER),
        Literal::from(0),
    );
    let second = add_global_rule(
        &mut dataset,
        "second",
        Literal::from(
            "CONSTRUCT { <urn:test:seed> <urn:test:second> ?value } \
             WHERE { <urn:test:seed> <urn:test:first> ?value }",
        ),
    );
    insert(
        &mut dataset,
        second,
        NamedNode::new_unchecked(SH_ORDER),
        Literal::from(second_order),
    );
    let snapshot = GraphSnapshot::default_graph(dataset);
    let rules =
        SparqlRuleSet::compile(&snapshot, profiles(), &ValidationOptions::default()).unwrap();
    (rules, snapshot)
}

#[test]
fn same_order_inferences_are_batched_but_later_orders_are_visible() {
    let options = ValidationOptions::default();
    let (same_order, base) = chain_rules(0);
    let same_order = execute_sparql_rules(&same_order, &base, &options).unwrap();
    assert_eq!(same_order.iterations(), 3);

    let (later_order, base) = chain_rules(1);
    let later_order = execute_sparql_rules(&later_order, &base, &options).unwrap();
    assert_eq!(later_order.iterations(), 2);
}

#[test]
fn shape_rule_this_binding_reaches_filter_only_patterns() {
    let mut dataset = Dataset::new();
    let shape = named("shape");
    let focus = named("focus");
    let rule = named("shape-rule");
    insert(
        &mut dataset,
        shape.clone(),
        NamedNode::new_unchecked("http://www.w3.org/ns/shacl#targetNode"),
        focus.clone(),
    );
    insert(
        &mut dataset,
        shape,
        NamedNode::new_unchecked(SH_RULE),
        rule.clone(),
    );
    insert(
        &mut dataset,
        rule.clone(),
        NamedNode::new_unchecked(RDF_TYPE),
        NamedNode::new_unchecked(SPARQL_RULE),
    );
    insert(
        &mut dataset,
        rule,
        NamedNode::new_unchecked(SH_CONSTRUCT),
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:derived> true } \
             WHERE { FILTER($this = <urn:test:focus>) }",
        ),
    );
    let snapshot = GraphSnapshot::default_graph(dataset);
    let options = ValidationOptions::default();
    let rules = SparqlRuleSet::compile(&snapshot, profiles(), &options).unwrap();
    let execution = execute_sparql_rules(&rules, &snapshot, &options).unwrap();
    assert!(execution.inference().triples().any(|triple| {
        triple.subject == focus
            && triple.predicate == named("derived")
            && triple.object == Literal::from(true)
    }));
}
