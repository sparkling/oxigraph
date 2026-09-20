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
fn rule_processor_absence_preserves_default_processing() {
    let mut dataset = Dataset::new();
    add_global_rule(
        &mut dataset,
        "default-processor",
        Literal::from("CONSTRUCT { <urn:s> <urn:p> <urn:o> } WHERE { }"),
    );

    assert_eq!(compile(dataset).unwrap().len(), 1);
}

#[test]
fn rule_processor_declarations_fail_closed() {
    let query = Literal::from("CONSTRUCT { <urn:s> <urn:p> <urn:o> } WHERE { }");

    let mut iri_processor = Dataset::new();
    let rule = add_global_rule(&mut iri_processor, "iri-processor", query.clone());
    insert(
        &mut iri_processor,
        rule,
        NamedNode::new_unchecked(SH_RULE_PROCESSOR),
        named("unknown-processor"),
    );
    assert!(
        compile(iri_processor)
            .unwrap_err()
            .to_string()
            .contains("sh:ruleProcessor")
    );

    let mut string_processor = Dataset::new();
    let rule = add_global_rule(&mut string_processor, "string-processor", query.clone());
    insert(
        &mut string_processor,
        rule,
        NamedNode::new_unchecked(SH_RULE_PROCESSOR),
        Literal::from("SRL 1.2"),
    );
    assert!(
        compile(string_processor)
            .unwrap_err()
            .to_string()
            .contains("sh:ruleProcessor")
    );

    let mut rule_set_processor = Dataset::new();
    let rule = add_global_rule(&mut rule_set_processor, "rule-set-member", query);
    let rule_set = named("rule-set");
    insert(
        &mut rule_set_processor,
        rule_set.clone(),
        NamedNode::new_unchecked(RDF_TYPE),
        NamedNode::new_unchecked("http://www.w3.org/ns/shacl#RuleSet"),
    );
    insert(
        &mut rule_set_processor,
        rule_set.clone(),
        NamedNode::new_unchecked("http://www.w3.org/ns/shacl#hasRule"),
        rule,
    );
    insert(
        &mut rule_set_processor,
        rule_set,
        NamedNode::new_unchecked(SH_RULE_PROCESSOR),
        named("unknown-rule-set-processor"),
    );
    assert!(
        compile(rule_set_processor)
            .unwrap_err()
            .to_string()
            .contains("sh:ruleProcessor")
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

const SH_LAYER_TEST: &str = "http://www.w3.org/ns/shacl#layer";
const SH_TARGET_NODE_TEST: &str = "http://www.w3.org/ns/shacl#targetNode";

fn numeric_literal(value: &str, datatype: &str) -> Literal {
    Literal::new_typed_literal(value.to_owned(), NamedNode::new_unchecked(datatype.to_owned()))
}

fn set_numeric(
    dataset: &mut Dataset,
    subject: ShapeId,
    predicate: &str,
    value: &str,
    datatype: &str,
) {
    insert(
        dataset,
        subject,
        NamedNode::new_unchecked(predicate.to_owned()),
        numeric_literal(value, datatype),
    );
}

fn set_layer(dataset: &mut Dataset, rule: ShapeId, value: &str, datatype: &str) {
    set_numeric(dataset, rule, SH_LAYER_TEST, value, datatype);
}

fn set_order(dataset: &mut Dataset, subject: ShapeId, value: &str, datatype: &str) {
    set_numeric(dataset, subject, SH_ORDER, value, datatype);
}

fn add_shape_rule(
    dataset: &mut Dataset,
    shape_local: &str,
    focus_local: &str,
    rule_local: &str,
    construct: Literal,
) -> (ShapeId, ShapeId) {
    let shape = ShapeId::from(named(shape_local));
    let focus = named(focus_local);
    let rule = add_global_rule(dataset, rule_local, construct);
    insert(
        dataset,
        shape.clone(),
        NamedNode::new_unchecked(SH_TARGET_NODE_TEST),
        focus,
    );
    insert(
        dataset,
        shape.clone(),
        NamedNode::new_unchecked(SH_RULE),
        rule.clone(),
    );
    (shape, rule)
}

fn execute(
    dataset: Dataset,
    options: &ValidationOptions,
) -> Result<crate::rules::RuleExecution, RuleError> {
    let snapshot = GraphSnapshot::default_graph(dataset);
    let rules = SparqlRuleSet::compile(&snapshot, profiles(), options)?;
    execute_sparql_rules(&rules, &snapshot, options)
}

fn has_iri_triple(graph: &GraphSnapshot, subject: &str, predicate: &str, object: &str) -> bool {
    graph.dataset().contains(&Quad::new(
        named(subject),
        named(predicate),
        named(object),
        GraphName::DefaultGraph,
    ))
}

#[test]
fn rule_layer_accepts_integer_decimal_and_default_zero() {
    let mut dataset = Dataset::new();
    add_global_rule(
        &mut dataset,
        "default-layer-rule",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:marker> <urn:test:yes> } WHERE { }",
        ),
    );
    let zero_rule = add_global_rule(
        &mut dataset,
        "integer-zero-rule",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:flag> <urn:test:yes> } \
             WHERE { FILTER NOT EXISTS { <urn:test:subject> <urn:test:marker> <urn:test:yes> } }",
        ),
    );
    set_layer(&mut dataset, zero_rule, "0", XSD_INTEGER);
    let decimal_rule = add_global_rule(
        &mut dataset,
        "decimal-layer-rule",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:decimal> <urn:test:accepted> } WHERE { }",
        ),
    );
    set_layer(&mut dataset, decimal_rule, "0.5", XSD_DECIMAL);

    let execution = execute(dataset, &ValidationOptions::default()).unwrap();
    assert!(has_iri_triple(
        execution.inference(),
        "subject",
        "marker",
        "yes"
    ));
    assert!(has_iri_triple(
        execution.inference(),
        "subject",
        "flag",
        "yes"
    ));
    assert!(has_iri_triple(
        execution.inference(),
        "subject",
        "decimal",
        "accepted"
    ));
}

#[test]
fn rule_layer_rejects_malformed_non_numeric_and_multiple_values() {
    let query = Literal::from("CONSTRUCT { <urn:test:s> <urn:test:p> <urn:test:o> } WHERE { }");

    let mut non_numeric = Dataset::new();
    let rule = add_global_rule(&mut non_numeric, "non-numeric-layer", query.clone());
    insert(
        &mut non_numeric,
        rule,
        NamedNode::new_unchecked(SH_LAYER_TEST),
        Literal::from("1"),
    );
    assert!(
        compile(non_numeric)
            .unwrap_err()
            .to_string()
            .contains("sh:layer")
    );

    let mut malformed = Dataset::new();
    let rule = add_global_rule(&mut malformed, "malformed-layer", query.clone());
    set_layer(&mut malformed, rule, "not-a-decimal", XSD_DECIMAL);
    assert!(
        compile(malformed)
            .unwrap_err()
            .to_string()
            .contains("sh:layer")
    );

    let mut multiple = Dataset::new();
    let rule = add_global_rule(&mut multiple, "multiple-layers", query);
    set_layer(&mut multiple, rule.clone(), "0", XSD_INTEGER);
    set_layer(&mut multiple, rule, "1.0", XSD_DECIMAL);
    assert!(matches!(
        compile(multiple).unwrap_err(),
        RuleError::IllFormed(message)
            if message.contains(SH_LAYER_TEST) && message.contains("at most one")
    ));
}

#[test]
fn rule_layer_negative_fractional_order_overrides_rule_order() {
    let mut dataset = Dataset::new();
    let producer = add_global_rule(
        &mut dataset,
        "fractional-producer",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:marker> <urn:test:yes> } WHERE { }",
        ),
    );
    set_layer(&mut dataset, producer.clone(), "-1.5", XSD_DECIMAL);
    set_order(&mut dataset, producer, "100", XSD_INTEGER);
    let consumer = add_global_rule(
        &mut dataset,
        "negative-consumer",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:flag> <urn:test:yes> } \
             WHERE { FILTER NOT EXISTS { <urn:test:subject> <urn:test:marker> <urn:test:yes> } }",
        ),
    );
    set_layer(&mut dataset, consumer.clone(), "-1", XSD_INTEGER);
    set_order(&mut dataset, consumer, "-100", XSD_INTEGER);

    let execution = execute(dataset, &ValidationOptions::default()).unwrap();
    assert!(has_iri_triple(
        execution.inference(),
        "subject",
        "marker",
        "yes"
    ));
    assert!(!has_iri_triple(
        execution.inference(),
        "subject",
        "flag",
        "yes"
    ));
}

#[test]
fn rule_layer_same_order_global_and_shape_rules_share_snapshot() {
    let mut dataset = Dataset::new();
    add_global_rule(
        &mut dataset,
        "global-producer",
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:marker> <urn:test:yes> } WHERE { }",
        ),
    );
    add_shape_rule(
        &mut dataset,
        "consumer-shape",
        "focus",
        "shape-consumer",
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:flag> <urn:test:yes> } \
             WHERE { FILTER NOT EXISTS { <urn:test:focus> <urn:test:marker> <urn:test:yes> } }",
        ),
    );

    let execution = execute(dataset, &ValidationOptions::default()).unwrap();
    assert!(has_iri_triple(
        execution.inference(),
        "focus",
        "marker",
        "yes"
    ));
    assert!(has_iri_triple(
        execution.inference(),
        "focus",
        "flag",
        "yes"
    ));
}

#[test]
fn rule_layer_rule_order_is_uniform_across_shape_and_global_scopes() {
    let mut dataset = Dataset::new();
    let (_, producer) = add_shape_rule(
        &mut dataset,
        "producer-shape",
        "focus",
        "shape-producer",
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:marker> <urn:test:yes> } WHERE { }",
        ),
    );
    set_order(&mut dataset, producer, "-1", XSD_INTEGER);
    let consumer = add_global_rule(
        &mut dataset,
        "global-consumer",
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:flag> <urn:test:yes> } \
             WHERE { FILTER NOT EXISTS { <urn:test:focus> <urn:test:marker> <urn:test:yes> } }",
        ),
    );
    set_order(&mut dataset, consumer, "0", XSD_INTEGER);

    let execution = execute(dataset, &ValidationOptions::default()).unwrap();
    assert!(has_iri_triple(
        execution.inference(),
        "focus",
        "marker",
        "yes"
    ));
    assert!(!has_iri_triple(
        execution.inference(),
        "focus",
        "flag",
        "yes"
    ));
}

#[test]
fn rule_layer_shape_order_never_overrides_rule_order_or_equal_order_visibility() {
    let mut conflicting = Dataset::new();
    let (producer_shape, producer) = add_shape_rule(
        &mut conflicting,
        "late-producer-shape",
        "focus",
        "early-rule",
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:marker> <urn:test:yes> } WHERE { }",
        ),
    );
    set_order(&mut conflicting, producer_shape, "100", XSD_INTEGER);
    set_order(&mut conflicting, producer, "-1", XSD_INTEGER);
    let (consumer_shape, consumer) = add_shape_rule(
        &mut conflicting,
        "early-consumer-shape",
        "focus",
        "late-rule",
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:flag> <urn:test:yes> } \
             WHERE { FILTER NOT EXISTS { <urn:test:focus> <urn:test:marker> <urn:test:yes> } }",
        ),
    );
    set_order(&mut conflicting, consumer_shape, "-100", XSD_INTEGER);
    set_order(&mut conflicting, consumer, "0", XSD_INTEGER);
    let execution = execute(conflicting, &ValidationOptions::default()).unwrap();
    assert!(!has_iri_triple(
        execution.inference(),
        "focus",
        "flag",
        "yes"
    ));

    let mut equal = Dataset::new();
    let (producer_shape, producer) = add_shape_rule(
        &mut equal,
        "first-shape",
        "focus",
        "equal-producer",
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:marker> <urn:test:yes> } WHERE { }",
        ),
    );
    set_order(&mut equal, producer_shape, "-100", XSD_INTEGER);
    set_order(&mut equal, producer, "0", XSD_INTEGER);
    let (consumer_shape, consumer) = add_shape_rule(
        &mut equal,
        "second-shape",
        "focus",
        "equal-consumer",
        Literal::from(
            "CONSTRUCT { <urn:test:focus> <urn:test:flag> <urn:test:yes> } \
             WHERE { FILTER NOT EXISTS { <urn:test:focus> <urn:test:marker> <urn:test:yes> } }",
        ),
    );
    set_order(&mut equal, consumer_shape, "100", XSD_INTEGER);
    set_order(&mut equal, consumer, "0", XSD_INTEGER);
    let execution = execute(equal, &ValidationOptions::default()).unwrap();
    assert!(has_iri_triple(
        execution.inference(),
        "focus",
        "flag",
        "yes"
    ));
}

#[test]
fn rule_layer_lower_layer_closes_before_upper_layer_and_does_not_reopen() {
    let mut dataset = Dataset::new();
    insert(&mut dataset, named("subject"), named("seed"), named("yes"));
    let first = add_global_rule(
        &mut dataset,
        "lower-first",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:step1> <urn:test:yes> } \
             WHERE { <urn:test:subject> <urn:test:seed> <urn:test:yes> }",
        ),
    );
    set_layer(&mut dataset, first, "0", XSD_INTEGER);
    let second = add_global_rule(
        &mut dataset,
        "lower-second",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:step2> <urn:test:yes> } \
             WHERE { <urn:test:subject> <urn:test:step1> <urn:test:yes> }",
        ),
    );
    set_layer(&mut dataset, second, "0", XSD_INTEGER);
    let completed_layer = add_global_rule(
        &mut dataset,
        "completed-lower-layer",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:reopened> <urn:test:yes> } \
             WHERE { <urn:test:subject> <urn:test:upper-trigger> <urn:test:yes> }",
        ),
    );
    set_layer(&mut dataset, completed_layer, "0", XSD_INTEGER);
    let absence = add_global_rule(
        &mut dataset,
        "upper-absence",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:flag> <urn:test:yes> } \
             WHERE { FILTER NOT EXISTS { <urn:test:subject> <urn:test:step2> <urn:test:yes> } }",
        ),
    );
    set_layer(&mut dataset, absence, "1", XSD_INTEGER);
    let trigger = add_global_rule(
        &mut dataset,
        "upper-trigger",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:upper-trigger> <urn:test:yes> } WHERE { }",
        ),
    );
    set_layer(&mut dataset, trigger, "1", XSD_INTEGER);

    let execution = execute(dataset, &ValidationOptions::default()).unwrap();
    assert!(has_iri_triple(
        execution.inference(),
        "subject",
        "step2",
        "yes"
    ));
    assert!(has_iri_triple(
        execution.inference(),
        "subject",
        "upper-trigger",
        "yes"
    ));
    assert!(!has_iri_triple(
        execution.inference(),
        "subject",
        "flag",
        "yes"
    ));
    assert!(!has_iri_triple(
        execution.inference(),
        "subject",
        "reopened",
        "yes"
    ));
}

fn two_productive_layers() -> Dataset {
    let mut dataset = Dataset::new();
    let lower = add_global_rule(
        &mut dataset,
        "limited-lower",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:lower> <urn:test:yes> } WHERE { }",
        ),
    );
    set_layer(&mut dataset, lower, "0", XSD_INTEGER);
    let upper = add_global_rule(
        &mut dataset,
        "limited-upper",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:upper> <urn:test:yes> } WHERE { }",
        ),
    );
    set_layer(&mut dataset, upper, "1", XSD_INTEGER);
    dataset
}

#[test]
fn rule_layer_limits_are_cumulative_across_layers() {
    let mut derived = ValidationOptions::default();
    derived.limits.max_derived_triples = 1;
    assert!(
        execute(two_productive_layers(), &derived)
            .unwrap_err()
            .to_string()
            .contains("DerivedTriples limit of 1 exceeded")
    );

    let mut iterations = ValidationOptions::default();
    iterations.limits.max_rule_iterations = 3;
    assert!(
        execute(two_productive_layers(), &iterations)
            .unwrap_err()
            .to_string()
            .contains("RuleIterations limit of 3 exceeded")
    );
}

#[test]
fn rule_layer_integer_lexical_space_is_enforced() {
    let query = Literal::from("CONSTRUCT { <urn:test:s> <urn:test:p> <urn:test:o> } WHERE { }");

    for (local, lexical) in [
        ("fractional-integer-layer", "1.5"),
        ("decimal-shaped-integer-layer", "1.0"),
    ] {
        let mut dataset = Dataset::new();
        let rule = add_global_rule(&mut dataset, local, query.clone());
        set_layer(&mut dataset, rule, lexical, XSD_INTEGER);
        assert!(
            compile(dataset)
                .unwrap_err()
                .to_string()
                .contains("sh:layer")
        );
    }

    let mut valid = Dataset::new();
    let rule = add_global_rule(&mut valid, "signed-integer-layer", query);
    set_layer(&mut valid, rule, "+01", XSD_INTEGER);
    compile(valid).unwrap();
}

fn add_deactivated_layer_rule(dataset: &mut Dataset, local: &str, layer: &str) {
    let rule = add_global_rule(
        dataset,
        local,
        Literal::from(format!(
            "CONSTRUCT {{ <urn:test:{local}> <urn:test:inactive> <urn:test:yes> }} WHERE {{ }}"
        )),
    );
    set_layer(dataset, rule.clone(), layer, XSD_INTEGER);
    insert(
        dataset,
        rule,
        NamedNode::new_unchecked(SH_DEACTIVATED),
        Literal::from(true),
    );
}

#[test]
fn rule_layer_inactive_only_layers_consume_no_iteration_budget() {
    let mut dataset = Dataset::new();
    add_deactivated_layer_rule(&mut dataset, "inactive-lower", "-1");
    add_deactivated_layer_rule(&mut dataset, "inactive-default", "0");
    add_deactivated_layer_rule(&mut dataset, "inactive-upper", "1");
    let mut options = ValidationOptions::default();
    options.limits.max_rule_iterations = 0;

    let execution = execute(dataset, &options).unwrap();
    assert_eq!(execution.iterations(), 0);
    assert_eq!(execution.inference().triple_count(), 0);
}

#[test]
fn rule_layer_inactive_layers_around_an_active_layer_do_not_consume_iterations() {
    let mut dataset = Dataset::new();
    add_deactivated_layer_rule(&mut dataset, "inactive-before", "-1");
    let active = add_global_rule(
        &mut dataset,
        "active-middle",
        Literal::from(
            "CONSTRUCT { <urn:test:subject> <urn:test:active> <urn:test:yes> } WHERE { }",
        ),
    );
    set_layer(&mut dataset, active, "0", XSD_INTEGER);
    add_deactivated_layer_rule(&mut dataset, "inactive-after", "1");
    let mut options = ValidationOptions::default();
    options.limits.max_rule_iterations = 2;

    let execution = execute(dataset, &options).unwrap();
    assert_eq!(execution.iterations(), 2);
    assert!(has_iri_triple(
        execution.inference(),
        "subject",
        "active",
        "yes"
    ));
    assert_eq!(execution.inference().triple_count(), 1);
}
