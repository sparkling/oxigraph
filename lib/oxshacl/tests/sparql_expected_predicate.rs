#![cfg(feature = "sparql")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise expected-predicate rules through public APIs"
)]

use oxrdf::{
    BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term,
};
#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxshacl::{
    GraphSnapshot, LimitKind, ProfileId, ProfileSet, RuleError, RuleExecution, SparqlRuleSet,
    ValidationError, ValidationOptions, execute_sparql_rules,
};
use std::time::Duration;

const EX: &str = "http://example.com/";
const RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const SH: &str = "http://www.w3.org/ns/shacl#";
const SHNEX: &str = "http://www.w3.org/ns/shacl-node-expr#";
const SPARQL: &str = "http://www.w3.org/ns/sparql#";

fn iri(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn ex(local: &str) -> NamedNode {
    iri(&format!("{EX}{local}"))
}

fn rdf(local: &str) -> NamedNode {
    iri(&format!("{RDF}{local}"))
}

fn sh(local: &str) -> NamedNode {
    iri(&format!("{SH}{local}"))
}

fn shnex(local: &str) -> NamedNode {
    iri(&format!("{SHNEX}{local}"))
}

fn sparql(local: &str) -> NamedNode {
    iri(&format!("{SPARQL}{local}"))
}

fn blank(local: &str) -> BlankNode {
    BlankNode::new_unchecked(local.to_owned())
}

fn term(local: &str) -> Term {
    Term::NamedNode(ex(local))
}

fn insert(
    dataset: &mut Dataset,
    subject: impl Into<NamedOrBlankNode>,
    predicate: NamedNode,
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
        ProfileId::NodeExpressions12Subset20260108,
        ProfileId::SparqlExtensions12Subset20260130,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap()
}

fn list(dataset: &mut Dataset, local: &str, members: impl IntoIterator<Item = Term>) -> Term {
    let members = members.into_iter().collect::<Vec<_>>();
    if members.is_empty() {
        return Term::NamedNode(rdf("nil"));
    }
    let nodes = (0..members.len())
        .map(|index| blank(&format!("{local}-{index}")))
        .collect::<Vec<_>>();
    for (index, member) in members.into_iter().enumerate() {
        insert(dataset, nodes[index].clone(), rdf("first"), member);
        insert(
            dataset,
            nodes[index].clone(),
            rdf("rest"),
            if index + 1 == nodes.len() {
                Term::NamedNode(rdf("nil"))
            } else {
                Term::BlankNode(nodes[index + 1].clone())
            },
        );
    }
    Term::BlankNode(nodes[0].clone())
}

fn node_shape(shapes: &mut Dataset, local: &str) -> NamedNode {
    let shape = ex(local);
    insert(shapes, shape.clone(), rdf("type"), sh("NodeShape"));
    shape
}

fn property_shape(shapes: &mut Dataset, local: &str, predicate: &str) -> NamedNode {
    let shape = ex(local);
    insert(shapes, shape.clone(), rdf("type"), sh("PropertyShape"));
    insert(shapes, shape.clone(), sh("path"), ex(predicate));
    shape
}

fn target_node(shapes: &mut Dataset, shape: NamedNode, focus: &str) {
    insert(shapes, shape, sh("targetNode"), ex(focus));
}

fn attach_property(shapes: &mut Dataset, parent: NamedNode, property: NamedNode) {
    insert(shapes, parent, sh("property"), property);
}

fn set_layer(shapes: &mut Dataset, rule: NamedNode, layer: i64) {
    insert(shapes, rule, sh("layer"), Literal::from(layer));
}

fn add_rule(
    shapes: &mut Dataset,
    local: &str,
    owner: Option<NamedNode>,
    expected: &[&str],
    construct: &str,
) -> NamedNode {
    let rule = ex(local);
    insert(shapes, rule.clone(), rdf("type"), sh("SPARQLRule"));
    insert(
        shapes,
        rule.clone(),
        sh("construct"),
        Literal::from(construct.to_owned()),
    );
    for predicate in expected {
        insert(
            shapes,
            rule.clone(),
            sh("expectedPredicate"),
            ex(predicate),
        );
    }
    if let Some(owner) = owner {
        insert(shapes, owner, sh("rule"), rule.clone());
    }
    rule
}

fn compile(shapes: Dataset) -> Result<SparqlRuleSet, RuleError> {
    SparqlRuleSet::compile(
        &GraphSnapshot::default_graph(shapes),
        profiles(),
        &ValidationOptions::default(),
    )
}

fn execute(
    shapes: Dataset,
    data: Dataset,
    options: &ValidationOptions,
) -> Result<RuleExecution, RuleError> {
    let rules = compile(shapes)?;
    execute_sparql_rules(&rules, &GraphSnapshot::default_graph(data), options)
}

fn dataset(triples: impl IntoIterator<Item = (NamedNode, NamedNode, Term)>) -> Dataset {
    triples
        .into_iter()
        .map(|(subject, predicate, object)| {
            Quad::new(subject, predicate, object, GraphName::DefaultGraph)
        })
        .collect()
}

fn assert_execution(execution: &RuleExecution, base: &Dataset, inference: &Dataset) {
    let mut entailed = base.clone();
    entailed.extend(inference.iter());
    assert_eq!(execution.base().dataset(), base, "base graph changed");
    assert_eq!(
        execution.inference().dataset(),
        inference,
        "unexpected complete inference graph"
    );
    assert_eq!(
        execution.entailed().dataset(),
        &entailed,
        "unexpected complete entailed graph"
    );
}

fn flag_query(predicate: &str, object: &str, where_clause: &str) -> String {
    format!(
        "CONSTRUCT {{ ?s <{EX}{predicate}> <{EX}{object}> }} WHERE {{ {where_clause} }}"
    )
}

fn expected_area_rule(shapes: &mut Dataset, local: &str, layer: i64) -> NamedNode {
    let rule = add_rule(
        shapes,
        local,
        None,
        &["area"],
        &flag_query(
            "isSmall",
            "yes",
            &format!("?s <{EX}area> ?area . FILTER(?area < 100)"),
        ),
    );
    set_layer(shapes, rule.clone(), layer);
    rule
}

#[test]
fn expected_area_supports_default_computed_and_large_rectangles() {
    let mut shapes = Dataset::new();
    let rectangle = node_shape(&mut shapes, "RectangleShape");
    insert(
        &mut shapes,
        rectangle.clone(),
        sh("targetClass"),
        ex("Rectangle"),
    );
    let area = property_shape(&mut shapes, "AreaShape", "area");
    attach_property(&mut shapes, rectangle, area.clone());
    insert(&mut shapes, area.clone(), sh("defaultValue"), Literal::from(1));

    let width = blank("width-expression");
    let height = blank("height-expression");
    insert(
        &mut shapes,
        width.clone(),
        shnex("pathValues"),
        ex("width"),
    );
    insert(
        &mut shapes,
        height.clone(),
        shnex("pathValues"),
        ex("height"),
    );
    let arguments = list(
        &mut shapes,
        "multiply-arguments",
        [
            Term::BlankNode(width),
            Term::BlankNode(height),
        ],
    );
    let multiplication = blank("multiplication");
    insert(
        &mut shapes,
        multiplication.clone(),
        sparql("multiply"),
        arguments,
    );
    insert(
        &mut shapes,
        area,
        sh("values"),
        multiplication,
    );
    expected_area_rule(&mut shapes, "SmallRule", 0);

    let base = dataset([
        (ex("Incomplete"), rdf("type"), term("Rectangle")),
        (ex("Small"), rdf("type"), term("Rectangle")),
        (ex("Small"), ex("width"), Literal::from(4).into()),
        (ex("Small"), ex("height"), Literal::from(5).into()),
        (ex("Large"), rdf("type"), term("Rectangle")),
        (ex("Large"), ex("width"), Literal::from(11).into()),
        (ex("Large"), ex("height"), Literal::from(10).into()),
    ]);
    let inference = dataset([
        (ex("Incomplete"), ex("isSmall"), term("yes")),
        (ex("Small"), ex("isSmall"), term("yes")),
    ]);

    let execution = execute(
        shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);
}

#[test]
fn asserted_and_expression_values_union_without_using_the_default() {
    let mut shapes = Dataset::new();
    let property = property_shape(&mut shapes, "AreaShape", "area");
    target_node(&mut shapes, property.clone(), "focus");
    insert(
        &mut shapes,
        property.clone(),
        sh("values"),
        Literal::from(20),
    );
    insert(
        &mut shapes,
        property,
        sh("defaultValue"),
        Literal::from(1),
    );
    add_rule(
        &mut shapes,
        "ObserveArea",
        None,
        &["area"],
        &format!(
            "CONSTRUCT {{ <{EX}focus> <{EX}observed> ?area }} \
             WHERE {{ <{EX}focus> <{EX}area> ?area }}"
        ),
    );

    let base = dataset([(ex("focus"), ex("area"), Literal::from(150).into())]);
    let inference = dataset([
        (ex("focus"), ex("observed"), Literal::from(20).into()),
        (ex("focus"), ex("observed"), Literal::from(150).into()),
    ]);
    let execution = execute(
        shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);

    let mut empty_expression_shapes = Dataset::new();
    let property = property_shape(
        &mut empty_expression_shapes,
        "EmptyExpressionArea",
        "area",
    );
    target_node(
        &mut empty_expression_shapes,
        property.clone(),
        "focus",
    );
    insert(
        &mut empty_expression_shapes,
        property.clone(),
        sh("values"),
        blank("empty-expression"),
    );
    insert(
        &mut empty_expression_shapes,
        property,
        sh("defaultValue"),
        Literal::from(1),
    );
    add_rule(
        &mut empty_expression_shapes,
        "ObserveAssertedArea",
        None,
        &["area"],
        &format!(
            "CONSTRUCT {{ <{EX}focus> <{EX}observed> ?area }} \
             WHERE {{ <{EX}focus> <{EX}area> ?area }}"
        ),
    );
    let base = dataset([(ex("focus"), ex("area"), Literal::from(150).into())]);
    let inference = dataset([(
        ex("focus"),
        ex("observed"),
        Literal::from(150).into(),
    )]);
    let execution = execute(
        empty_expression_shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);
}

#[test]
fn direct_parent_nested_and_global_focus_contexts_are_distinct() {
    let mut shapes = Dataset::new();

    let direct = property_shape(&mut shapes, "DirectArea", "area");
    target_node(&mut shapes, direct.clone(), "direct");
    insert(&mut shapes, direct, sh("defaultValue"), Literal::from(1));

    let parent = node_shape(&mut shapes, "Parent");
    target_node(&mut shapes, parent.clone(), "parent");
    let parent_area = property_shape(&mut shapes, "ParentArea", "area");
    insert(
        &mut shapes,
        parent_area.clone(),
        sh("defaultValue"),
        Literal::from(2),
    );
    attach_property(&mut shapes, parent, parent_area);

    let root = node_shape(&mut shapes, "Root");
    target_node(&mut shapes, root.clone(), "root");
    let part = property_shape(&mut shapes, "Part", "part");
    let nested_area = property_shape(&mut shapes, "NestedArea", "area");
    insert(
        &mut shapes,
        nested_area.clone(),
        sh("defaultValue"),
        Literal::from(3),
    );
    attach_property(&mut shapes, part.clone(), nested_area);
    attach_property(&mut shapes, root, part);

    let unrelated = property_shape(&mut shapes, "Unrelated", "otherArea");
    target_node(&mut shapes, unrelated.clone(), "unrelated");
    let bad_focuses = list(
        &mut shapes,
        "bad-focuses",
        [term("first"), term("second")],
    );
    let bad_expression = blank("bad-expression");
    insert(
        &mut shapes,
        bad_expression.clone(),
        shnex("pathValues"),
        ex("missing"),
    );
    insert(
        &mut shapes,
        bad_expression.clone(),
        shnex("focusNode"),
        bad_focuses,
    );
    insert(&mut shapes, unrelated, sh("values"), bad_expression);

    add_rule(
        &mut shapes,
        "GlobalObserver",
        None,
        &["area"],
        &format!(
            "CONSTRUCT {{ ?s <{EX}observed> ?area }} \
             WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );

    let base = dataset([(ex("root"), ex("part"), term("nested"))]);
    let inference = dataset([
        (ex("direct"), ex("observed"), Literal::from(1).into()),
        (ex("parent"), ex("observed"), Literal::from(2).into()),
        (ex("nested"), ex("observed"), Literal::from(3).into()),
    ]);
    let execution = execute(
        shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);
}

#[test]
fn deactivation_blocks_inherited_work_but_not_a_childs_direct_target() {
    let mut shapes = Dataset::new();

    let parent = node_shape(&mut shapes, "DeactivatedParent");
    target_node(&mut shapes, parent.clone(), "inherited");
    insert(
        &mut shapes,
        parent.clone(),
        sh("deactivated"),
        Literal::from(true),
    );
    let child = property_shape(&mut shapes, "ReachableChild", "area");
    target_node(&mut shapes, child.clone(), "direct");
    insert(
        &mut shapes,
        child.clone(),
        sh("defaultValue"),
        Literal::from(4),
    );
    attach_property(&mut shapes, parent, child);

    let deactivated = property_shape(&mut shapes, "DeactivatedArea", "area");
    target_node(&mut shapes, deactivated.clone(), "disabled");
    insert(
        &mut shapes,
        deactivated.clone(),
        sh("deactivated"),
        Literal::from(true),
    );
    insert(
        &mut shapes,
        deactivated,
        sh("defaultValue"),
        Literal::from(5),
    );

    let danger = property_shape(&mut shapes, "Danger", "danger");
    target_node(&mut shapes, danger.clone(), "danger-focus");
    let bad_focuses = list(
        &mut shapes,
        "inactive-bad-focuses",
        [term("first"), term("second")],
    );
    let bad_expression = blank("inactive-bad-expression");
    insert(
        &mut shapes,
        bad_expression.clone(),
        shnex("pathValues"),
        ex("missing"),
    );
    insert(
        &mut shapes,
        bad_expression.clone(),
        shnex("focusNode"),
        bad_focuses,
    );
    insert(&mut shapes, danger, sh("values"), bad_expression);

    add_rule(
        &mut shapes,
        "ActiveAreaObserver",
        None,
        &["area"],
        &format!(
            "CONSTRUCT {{ ?s <{EX}observed> ?area }} \
             WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );
    let inactive = add_rule(
        &mut shapes,
        "InactiveDangerObserver",
        None,
        &["danger"],
        "CONSTRUCT { <http://example.com/unexpected> <http://example.com/value> true } WHERE { }",
    );
    insert(
        &mut shapes,
        inactive,
        sh("deactivated"),
        Literal::from(true),
    );

    let base = Dataset::new();
    let inference = dataset([(
        ex("direct"),
        ex("observed"),
        Literal::from(4).into(),
    )]);
    let execution = execute(
        shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);
}

#[test]
fn rule_origin_preserves_overlap_while_derived_only_facts_expire() {
    let mut shapes = Dataset::new();
    for focus in ["retained", "expired"] {
        let property = property_shape(
            &mut shapes,
            &format!("{focus}Area"),
            "area",
        );
        target_node(&mut shapes, property.clone(), focus);
        insert(
            &mut shapes,
            property,
            sh("defaultValue"),
            Literal::from(1),
        );
    }

    let retain_shape = node_shape(&mut shapes, "RetainShape");
    target_node(&mut shapes, retain_shape.clone(), "retained");
    let retain = add_rule(
        &mut shapes,
        "RetainDerivedArea",
        Some(retain_shape),
        &["area"],
        &format!(
            "CONSTRUCT {{ $this <{EX}area> ?area }} \
             WHERE {{ $this <{EX}area> ?area }}"
        ),
    );
    set_layer(&mut shapes, retain, 0);

    let later = add_rule(
        &mut shapes,
        "LaterObserver",
        None,
        &[],
        &format!(
            "CONSTRUCT {{ ?s <{EX}survived> <{EX}yes> }} \
             WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );
    set_layer(&mut shapes, later, 1);

    let base = Dataset::new();
    let inference = dataset([
        (ex("retained"), ex("area"), Literal::from(1).into()),
        (ex("retained"), ex("survived"), term("yes")),
    ]);
    let execution = execute(
        shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);
}

#[test]
fn lower_layers_affect_preparation_but_same_layer_rules_do_not_reprepare() {
    let mut shapes = Dataset::new();
    for focus in ["lower", "same"] {
        let property = property_shape(
            &mut shapes,
            &format!("{focus}Derived"),
            "derived",
        );
        target_node(&mut shapes, property.clone(), focus);
        let expression = blank(&format!("{focus}-trigger-expression"));
        insert(
            &mut shapes,
            expression.clone(),
            shnex("pathValues"),
            ex("trigger"),
        );
        insert(&mut shapes, property, sh("values"), expression);
    }

    let lower = add_rule(
        &mut shapes,
        "LowerTrigger",
        None,
        &[],
        &format!(
            "CONSTRUCT {{ <{EX}lower> <{EX}trigger> <{EX}value> }} WHERE {{ }}"
        ),
    );
    set_layer(&mut shapes, lower, -1);

    let same = add_rule(
        &mut shapes,
        "SameLayerTrigger",
        None,
        &[],
        &format!(
            "CONSTRUCT {{ <{EX}same> <{EX}trigger> <{EX}value> }} WHERE {{ }}"
        ),
    );
    set_layer(&mut shapes, same, 0);

    let observer = add_rule(
        &mut shapes,
        "DerivedObserver",
        None,
        &["derived", "derived"],
        &format!(
            "CONSTRUCT {{ ?s <{EX}observed> <{EX}yes> }} \
             WHERE {{ ?s <{EX}derived> <{EX}value> }}"
        ),
    );
    set_layer(&mut shapes, observer, 0);

    let base = Dataset::new();
    let inference = dataset([
        (ex("lower"), ex("trigger"), term("value")),
        (ex("same"), ex("trigger"), term("value")),
        (ex("lower"), ex("observed"), term("yes")),
    ]);
    let mut options = ValidationOptions::default();
    options.limits.max_derived_triples = 4;
    let execution = execute(shapes, base.clone(), &options).unwrap();
    assert_execution(&execution, &base, &inference);
}

#[test]
fn repeated_same_layer_expectations_prepare_once() {
    let mut shapes = Dataset::new();
    let property = property_shape(&mut shapes, "RepeatedArea", "area");
    target_node(&mut shapes, property.clone(), "focus");
    insert(
        &mut shapes,
        property,
        sh("defaultValue"),
        Literal::from(1),
    );
    for (rule, predicate) in [("FirstObserver", "first"), ("SecondObserver", "second")] {
        add_rule(
            &mut shapes,
            rule,
            None,
            &["area"],
            &format!(
                "CONSTRUCT {{ <{EX}focus> <{EX}{predicate}> <{EX}yes> }} \
                 WHERE {{ <{EX}focus> <{EX}area> ?area }}"
            ),
        );
    }

    let mut options = ValidationOptions::default();
    // One preparation plus two productive and two confirming rule focuses.
    options.limits.max_focus_nodes = 5;
    options.limits.max_derived_triples = 3;
    let inference = dataset([
        (ex("focus"), ex("first"), term("yes")),
        (ex("focus"), ex("second"), term("yes")),
    ]);
    let execution = execute(shapes, Dataset::new(), &options).unwrap();
    assert_execution(&execution, &Dataset::new(), &inference);
}

#[test]
fn base_facts_remain_base_when_a_rule_repeats_them() {
    let mut shapes = Dataset::new();
    let property = property_shape(&mut shapes, "Area", "area");
    target_node(&mut shapes, property, "focus");
    add_rule(
        &mut shapes,
        "RepeatBase",
        None,
        &["area"],
        &format!(
            "CONSTRUCT {{ ?s <{EX}area> ?area }} \
             WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );
    let base = dataset([(ex("focus"), ex("area"), Literal::from(9).into())]);
    let execution = execute(
        shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &Dataset::new());
}

#[test]
fn invalid_subjects_are_skipped_after_evaluation_and_descendants_still_run() {
    let mut shapes = Dataset::new();
    let mixed = property_shape(&mut shapes, "MixedArea", "area");
    target_node(&mut shapes, mixed.clone(), "valid");
    insert(
        &mut shapes,
        mixed.clone(),
        sh("targetNode"),
        Literal::from("literal-focus"),
    );
    insert(
        &mut shapes,
        mixed,
        sh("defaultValue"),
        Literal::from(1),
    );

    let empty = property_shape(&mut shapes, "EmptyLiteralArea", "area");
    insert(
        &mut shapes,
        empty.clone(),
        sh("targetNode"),
        Literal::from("empty-literal-focus"),
    );
    insert(
        &mut shapes,
        empty,
        sh("values"),
        blank("empty-literal-expression"),
    );

    let root = property_shape(&mut shapes, "LiteralBridgeRoot", "child");
    target_node(&mut shapes, root.clone(), "root");
    let bridge = property_shape(&mut shapes, "LiteralBridge", "bridge");
    insert(&mut shapes, bridge.clone(), sh("values"), ex("legal"));
    let descendant = property_shape(&mut shapes, "LegalDescendant", "area");
    insert(
        &mut shapes,
        descendant.clone(),
        sh("defaultValue"),
        Literal::from(2),
    );
    attach_property(&mut shapes, bridge.clone(), descendant);
    attach_property(&mut shapes, root, bridge);

    add_rule(
        &mut shapes,
        "ObserveLegalArea",
        None,
        &["area", "bridge"],
        &format!(
            "CONSTRUCT {{ ?s <{EX}observed> ?area }} \
             WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );
    let base = dataset([(
        ex("root"),
        ex("child"),
        Literal::from("middle").into(),
    )]);
    let inference = dataset([
        (ex("valid"), ex("observed"), Literal::from(1).into()),
        (ex("legal"), ex("observed"), Literal::from(2).into()),
    ]);
    let execution = execute(
        shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);

    let mut failing = Dataset::new();
    let property = property_shape(&mut failing, "FailingLiteralArea", "area");
    insert(
        &mut failing,
        property.clone(),
        sh("targetNode"),
        Literal::from("literal-focus"),
    );
    let focuses = list(
        &mut failing,
        "literal-error-focuses",
        [term("first"), term("second")],
    );
    let expression = blank("literal-error-expression");
    insert(
        &mut failing,
        expression.clone(),
        shnex("pathValues"),
        ex("missing"),
    );
    insert(
        &mut failing,
        expression.clone(),
        shnex("focusNode"),
        focuses,
    );
    insert(&mut failing, property, sh("values"), expression);
    add_rule(
        &mut failing,
        "FailingLiteralRequirement",
        None,
        &["area"],
        "CONSTRUCT { } WHERE { }",
    );
    let result = execute(
        failing,
        Dataset::new(),
        &ValidationOptions::default(),
    );
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::IllFormed(reason)))
                if reason.contains("more than one focus node")
        ),
        "literal focus swallowed a value-expression error: {result:?}"
    );
}

#[test]
fn invalid_requirements_expression_errors_cancellation_and_deadlines_fail_closed() {
    let mut invalid = Dataset::new();
    let rule = add_rule(
        &mut invalid,
        "InvalidExpectedPredicate",
        None,
        &[],
        "CONSTRUCT { } WHERE { }",
    );
    insert(
        &mut invalid,
        rule,
        sh("expectedPredicate"),
        Literal::from("not-an-iri"),
    );
    let error = compile(invalid).unwrap_err();
    assert!(
        error.to_string().contains("expectedPredicate")
            && error.to_string().contains("IRI"),
        "unexpected non-IRI expectedPredicate error: {error}"
    );

    let mut failing = Dataset::new();
    let property = property_shape(&mut failing, "FailingArea", "area");
    target_node(&mut failing, property.clone(), "focus");
    let focuses = list(
        &mut failing,
        "error-focuses",
        [term("first"), term("second")],
    );
    let expression = blank("error-expression");
    insert(
        &mut failing,
        expression.clone(),
        shnex("pathValues"),
        ex("missing"),
    );
    insert(
        &mut failing,
        expression.clone(),
        shnex("focusNode"),
        focuses,
    );
    insert(&mut failing, property, sh("values"), expression);
    add_rule(
        &mut failing,
        "RequiresArea",
        None,
        &["area"],
        "CONSTRUCT { } WHERE { }",
    );
    let result = execute(
        failing.clone(),
        Dataset::new(),
        &ValidationOptions::default(),
    );
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::IllFormed(reason)))
                if reason.contains("more than one focus node")
        ),
        "unexpected expression result: {result:?}"
    );

    let cancelled = ValidationOptions::default();
    cancelled.cancellation_token.cancel();
    let result = execute(failing.clone(), Dataset::new(), &cancelled);
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::Cancelled))
        ),
        "unexpected cancellation result: {result:?}"
    );

    let mut expired = ValidationOptions::default();
    expired.limits.timeout = Some(Duration::ZERO);
    let result = execute(failing, Dataset::new(), &expired);
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::LimitExceeded {
                kind: LimitKind::Time,
                limit: 0,
            }))
        ),
        "unexpected zero-deadline result: {result:?}"
    );
}

#[test]
fn preparation_limits_are_cumulative_across_shapes_and_layers() {
    fn focus_shapes(focuses: &[&str]) -> Dataset {
        let mut shapes = Dataset::new();
        for focus in focuses {
            let property = property_shape(
                &mut shapes,
                &format!("{focus}Area"),
                "area",
            );
            target_node(&mut shapes, property.clone(), focus);
            insert(
                &mut shapes,
                property,
                sh("defaultValue"),
                Literal::from(1),
            );
        }
        add_rule(
            &mut shapes,
            "FocusBudget",
            None,
            &["area"],
            "CONSTRUCT { } WHERE { }",
        );
        shapes
    }

    fn path_shapes(predicates: &[&str]) -> Dataset {
        let mut shapes = Dataset::new();
        for predicate in predicates {
            let property = property_shape(
                &mut shapes,
                &format!("{predicate}Path"),
                predicate,
            );
            target_node(&mut shapes, property.clone(), "focus");
            insert(
                &mut shapes,
                property,
                sh("defaultValue"),
                Literal::from(1),
            );
        }
        add_rule(
            &mut shapes,
            "PathBudget",
            None,
            predicates,
            "CONSTRUCT { } WHERE { }",
        );
        shapes
    }

    fn layer_shapes(layers: &[(&str, &str, i64)]) -> Dataset {
        let mut shapes = Dataset::new();
        for (local, predicate, layer) in layers {
            let property = property_shape(&mut shapes, local, predicate);
            target_node(&mut shapes, property.clone(), "focus");
            insert(
                &mut shapes,
                property,
                sh("defaultValue"),
                Literal::from(layer + 1),
            );
            let rule = add_rule(
                &mut shapes,
                &format!("{local}Rule"),
                None,
                &[*predicate],
                "CONSTRUCT { } WHERE { }",
            );
            set_layer(&mut shapes, rule, *layer);
        }
        shapes
    }

    fn memory_shapes(expected: bool) -> Dataset {
        let mut shapes = Dataset::new();
        let property = property_shape(&mut shapes, "MemoryArea", "area");
        target_node(&mut shapes, property.clone(), "focus");
        insert(
            &mut shapes,
            property,
            sh("defaultValue"),
            Literal::from(1),
        );
        add_rule(
            &mut shapes,
            "MemoryBudget",
            None,
            if expected { &["area"] } else { &[] },
            "CONSTRUCT { } WHERE { }",
        );
        shapes
    }

    let mut focus_limit = ValidationOptions::default();
    focus_limit.limits.max_focus_nodes = 2;
    for focus in ["first", "second"] {
        let result = execute(focus_shapes(&[focus]), Dataset::new(), &focus_limit);
        assert!(
            result.is_ok(),
            "one focus preparation should fit the shared ceiling: {result:?}"
        );
    }
    let result = execute(
        focus_shapes(&["first", "second"]),
        Dataset::new(),
        &focus_limit,
    );
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::LimitExceeded {
                kind: LimitKind::FocusNodes,
                limit: 2,
            }))
        ),
        "only combined focus preparations should exceed the ceiling: {result:?}"
    );

    let data = dataset([
        (ex("focus"), ex("firstNoise"), term("firstValue")),
        (ex("other"), ex("secondNoise"), term("secondValue")),
    ]);
    let mut path_limit = ValidationOptions::default();
    // One preparation costs five visits without rdf-12 and nine with cleanup.
    // Two preparations cost ten and sixteen respectively, so nine separates both modes.
    path_limit.limits.max_path_visits = 9;
    for predicate in ["first", "second"] {
        let result = execute(
            path_shapes(&[predicate]),
            data.clone(),
            &path_limit,
        );
        assert!(
            result.is_ok(),
            "one qualifying path preparation should fit the ceiling: {result:?}"
        );
    }
    let result = execute(
        path_shapes(&["first", "second"]),
        data,
        &path_limit,
    );
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::LimitExceeded {
                kind: LimitKind::PathVisits,
                limit: 9,
            }))
        ),
        "only combined path preparations should exceed the ceiling: {result:?}"
    );

    let layers = [
        ("FirstDerived", "first", 0_i64),
        ("SecondDerived", "second", 1_i64),
    ];
    let mut derived_limit = ValidationOptions::default();
    derived_limit.limits.max_derived_triples = 1;
    for layer in layers {
        let result = execute(
            layer_shapes(&[layer]),
            Dataset::new(),
            &derived_limit,
        );
        assert!(
            result.is_ok(),
            "one layer preparation should fit the admission ceiling: {result:?}"
        );
    }
    let result = execute(
        layer_shapes(&layers),
        Dataset::new(),
        &derived_limit,
    );
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::LimitExceeded {
                kind: LimitKind::DerivedTriples,
                limit: 1,
            }))
        ),
        "repeated layers reset the derived admission ceiling: {result:?}"
    );

    let mut memory_limit = ValidationOptions::default();
    // Empty execution owns no estimated bytes; the first expected-predicate record costs 128.
    memory_limit.limits.max_estimated_memory_bytes = 0;
    let control = execute(
        memory_shapes(false),
        Dataset::new(),
        &memory_limit,
    );
    assert!(
        control.is_ok(),
        "the no-expectation control should fit the memory ceiling: {control:?}"
    );
    let result = execute(
        memory_shapes(true),
        Dataset::new(),
        &memory_limit,
    );
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::LimitExceeded {
                kind: LimitKind::EstimatedMemory,
                limit: 0,
            }))
        ),
        "only expected-predicate overlay work should exceed memory: {result:?}"
    );
}

#[cfg(feature = "rdf-12")]
fn triple_term(subject: &str, predicate: &str, object: Term) -> Term {
    Term::Triple(Box::new(Triple::new(
        ex(subject),
        ex(predicate),
        object,
    )))
}

#[cfg(feature = "rdf-12")]
#[test]
fn triple_term_focus_is_skipped_without_losing_a_valid_sibling() {
    let mut shapes = Dataset::new();
    let parent = property_shape(&mut shapes, "TripleFocusParent", "child");
    target_node(&mut shapes, parent.clone(), "root");
    let area = property_shape(&mut shapes, "TripleFocusArea", "area");
    insert(
        &mut shapes,
        area.clone(),
        sh("defaultValue"),
        Literal::from(1),
    );
    attach_property(&mut shapes, parent, area);
    add_rule(
        &mut shapes,
        "ObserveTripleFocusArea",
        None,
        &["area"],
        &format!(
            "CONSTRUCT {{ ?s <{EX}observed> ?area }} \
             WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );

    let triple_focus = triple_term("embedded", "predicate", term("object"));
    let base = dataset([
        (ex("root"), ex("child"), triple_focus),
        (ex("root"), ex("child"), term("valid")),
    ]);
    let inference = dataset([(
        ex("valid"),
        ex("observed"),
        Literal::from(1).into(),
    )]);
    let execution = execute(
        shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);
}

#[cfg(feature = "rdf-12")]
#[test]
fn expired_reifier_metadata_is_cleaned_but_retained_metadata_survives() {
    let mut expired_shapes = Dataset::new();
    let property = property_shape(&mut expired_shapes, "ExpiredArea", "area");
    target_node(&mut expired_shapes, property.clone(), "focus");
    insert(
        &mut expired_shapes,
        property,
        sh("defaultValue"),
        Literal::from(1),
    );
    add_rule(
        &mut expired_shapes,
        "ExpiredReifier",
        None,
        &["area"],
        &format!(
            "PREFIX rdf: <{RDF}> \
             CONSTRUCT {{ \
               <{EX}reifier> rdf:reifies <<( ?s <{EX}area> ?area )>> . \
               <{EX}reifier> <{EX}note> <{EX}temporary> \
             }} WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );
    let execution = execute(
        expired_shapes,
        Dataset::new(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &Dataset::new(), &Dataset::new());

    let mut retained_shapes = Dataset::new();
    let property = property_shape(&mut retained_shapes, "RetainedArea", "area");
    target_node(&mut retained_shapes, property.clone(), "focus");
    insert(
        &mut retained_shapes,
        property,
        sh("defaultValue"),
        Literal::from(1),
    );
    add_rule(
        &mut retained_shapes,
        "RetainedReifier",
        None,
        &["area"],
        &format!(
            "PREFIX rdf: <{RDF}> \
             CONSTRUCT {{ \
               ?s <{EX}area> ?area . \
               <{EX}reifier> rdf:reifies <<( ?s <{EX}area> ?area )>> . \
               <{EX}reifier> <{EX}note> <{EX}persistent> \
             }} WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );
    let inference = dataset([
        (ex("focus"), ex("area"), Literal::from(1).into()),
        (
            ex("reifier"),
            rdf("reifies"),
            triple_term("focus", "area", Literal::from(1).into()),
        ),
        (ex("reifier"), ex("note"), term("persistent")),
    ]);
    let execution = execute(
        retained_shapes,
        Dataset::new(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &Dataset::new(), &inference);

    let mut base_shapes = Dataset::new();
    let property = property_shape(&mut base_shapes, "BaseArea", "area");
    target_node(&mut base_shapes, property, "focus");
    add_rule(
        &mut base_shapes,
        "ObserveBaseArea",
        None,
        &["area"],
        &format!(
            "CONSTRUCT {{ ?s <{EX}observed> <{EX}yes> }} \
             WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );
    let base = dataset([
        (ex("focus"), ex("area"), Literal::from(7).into()),
        (
            ex("base-reifier"),
            rdf("reifies"),
            triple_term("focus", "area", Literal::from(7).into()),
        ),
        (ex("base-reifier"), ex("note"), term("base")),
    ]);
    let inference = dataset([(ex("focus"), ex("observed"), term("yes"))]);
    let execution = execute(
        base_shapes,
        base.clone(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &base, &inference);
}

#[cfg(feature = "rdf-12")]
#[test]
fn earlier_inferred_reifier_metadata_survives_later_cleanup_and_repeat() {
    let mut shapes = Dataset::new();

    let durable = add_rule(
        &mut shapes,
        "DurableReifierMetadata",
        None,
        &[],
        &format!(
            "CONSTRUCT {{ <{EX}reifier> <{EX}note> <{EX}durable> }} WHERE {{ }}"
        ),
    );
    set_layer(&mut shapes, durable, 0);

    let property = property_shape(&mut shapes, "ExpiredLayerOneArea", "area");
    target_node(&mut shapes, property.clone(), "focus");
    insert(
        &mut shapes,
        property,
        sh("defaultValue"),
        Literal::from(1),
    );
    let temporary = add_rule(
        &mut shapes,
        "TemporaryLayerOneReifierMetadata",
        None,
        &["area"],
        &format!(
            "PREFIX rdf: <{RDF}> \
             CONSTRUCT {{ \
               <{EX}reifier> rdf:reifies <<( ?s <{EX}area> ?area )>> . \
               <{EX}reifier> <{EX}note> <{EX}durable> . \
               <{EX}reifier> <{EX}note> <{EX}temporary> \
             }} WHERE {{ ?s <{EX}area> ?area }}"
        ),
    );
    set_layer(&mut shapes, temporary, 1);

    let observer = add_rule(
        &mut shapes,
        "ObserveReifierCleanup",
        None,
        &[],
        &format!(
            "PREFIX rdf: <{RDF}> \
             CONSTRUCT {{ <{EX}audit> <{EX}observed> <{EX}clean> }} \
             WHERE {{ \
               <{EX}reifier> <{EX}note> <{EX}durable> . \
               FILTER NOT EXISTS {{ <{EX}reifier> <{EX}note> <{EX}temporary> }} \
               FILTER NOT EXISTS {{ <{EX}reifier> rdf:reifies ?statement }} \
             }}"
        ),
    );
    set_layer(&mut shapes, observer, 2);

    let inference = dataset([
        (ex("reifier"), ex("note"), term("durable")),
        (ex("audit"), ex("observed"), term("clean")),
    ]);
    let execution = execute(
        shapes,
        Dataset::new(),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_execution(&execution, &Dataset::new(), &inference);
}

#[cfg(feature = "rdf-12")]
#[test]
fn preexisting_reifier_association_survives_expired_triple_cleanup() {
    for (ownership, association_in_base, observation) in [
        ("Base", true, "base-clean"),
        ("EarlierLayer", false, "earlier-layer-clean"),
    ] {
        let mut shapes = Dataset::new();
        let reifier = format!("{ownership}Reifier");

        if !association_in_base {
            let seed = add_rule(
                &mut shapes,
                &format!("Seed{ownership}Association"),
                None,
                &[],
                &format!(
                    "PREFIX rdf: <{RDF}> \
                     CONSTRUCT {{ \
                       <{EX}{reifier}> rdf:reifies <<( <{EX}focus> <{EX}area> 1 )>> . \
                       <{EX}{reifier}> <{EX}note> <{EX}durable> \
                     }} WHERE {{ }}"
                ),
            );
            set_layer(&mut shapes, seed, 0);
        }

        let property = property_shape(
            &mut shapes,
            &format!("{ownership}ExpiredArea"),
            "area",
        );
        target_node(&mut shapes, property.clone(), "focus");
        insert(
            &mut shapes,
            property,
            sh("defaultValue"),
            Literal::from(1),
        );
        let temporary = add_rule(
            &mut shapes,
            &format!("Add{ownership}TemporaryMetadata"),
            None,
            &["area"],
            &format!(
                "CONSTRUCT {{ <{EX}{reifier}> <{EX}note> <{EX}temporary> }} \
                 WHERE {{ <{EX}focus> <{EX}area> 1 }}"
            ),
        );
        set_layer(&mut shapes, temporary, 1);

        let observer = add_rule(
            &mut shapes,
            &format!("Observe{ownership}AssociationCleanup"),
            None,
            &[],
            &format!(
                "PREFIX rdf: <{RDF}> \
                 CONSTRUCT {{ <{EX}audit> <{EX}observed> <{EX}{observation}> }} \
                 WHERE {{ \
                   <{EX}{reifier}> rdf:reifies <<( <{EX}focus> <{EX}area> 1 )>> . \
                   <{EX}{reifier}> <{EX}note> <{EX}durable> . \
                   FILTER NOT EXISTS {{ <{EX}{reifier}> <{EX}note> <{EX}temporary> }} \
                 }}"
            ),
        );
        set_layer(&mut shapes, observer, 2);

        let association = (
            ex(&reifier),
            rdf("reifies"),
            triple_term("focus", "area", Literal::from(1).into()),
        );
        let durable = (ex(&reifier), ex("note"), term("durable"));
        let base = if association_in_base {
            dataset([association.clone(), durable.clone()])
        } else {
            Dataset::new()
        };
        let mut inference = dataset([(ex("audit"), ex("observed"), term(observation))]);
        if !association_in_base {
            inference.extend([
                Quad::new(
                    association.0,
                    association.1,
                    association.2,
                    GraphName::DefaultGraph,
                ),
                Quad::new(
                    durable.0,
                    durable.1,
                    durable.2,
                    GraphName::DefaultGraph,
                ),
            ]);
        }
        let execution = execute(
            shapes,
            base.clone(),
            &ValidationOptions::default(),
        )
        .unwrap();
        assert_execution(&execution, &base, &inference);
    }
}

#[cfg(feature = "rdf-12")]
#[test]
fn shared_reifier_for_expired_and_retained_triples_fails_explicitly() {
    let mut shapes = Dataset::new();
    let property = property_shape(&mut shapes, "DerivedArea", "area");
    target_node(&mut shapes, property.clone(), "derived");
    insert(
        &mut shapes,
        property,
        sh("defaultValue"),
        Literal::from(1),
    );
    add_rule(
        &mut shapes,
        "SharedReifier",
        None,
        &["area"],
        &format!(
            "PREFIX rdf: <{RDF}> \
             CONSTRUCT {{ \
               <{EX}shared> rdf:reifies <<( <{EX}derived> <{EX}area> ?area )>> . \
               <{EX}shared> rdf:reifies <<( <{EX}base> <{EX}kept> <{EX}value> )>> \
             }} WHERE {{ <{EX}derived> <{EX}area> ?area }}"
        ),
    );
    let base = dataset([(ex("base"), ex("kept"), term("value"))]);
    let result = execute(shapes, base, &ValidationOptions::default());
    assert!(
        matches!(
            &result,
            Err(RuleError::Validation(ValidationError::UnsupportedFeature(
                reason
            ))) if reason.contains("reifier")
        ),
        "shared reifier did not fail explicitly: {result:?}"
    );
}
