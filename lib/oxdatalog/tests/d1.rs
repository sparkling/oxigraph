#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public stratified-negation contract"
)]

use oxdatalog::{
    Atom, Engine, EvaluationOptions, Fact, PatternTerm, Program, RelationId, Rule, RuleId,
    ValidationError, ValidationLimits, Value, validate,
};
use oxrdf::{Dataset, GraphName, NamedNode, Quad, Term};

fn relation(name: &str) -> RelationId {
    RelationId::new(format!("urn:test:relation:{name}")).unwrap()
}

fn atom(relation: &RelationId, variables: &[&str]) -> Atom {
    Atom::new(
        relation.clone(),
        variables
            .iter()
            .map(|variable| PatternTerm::variable(*variable).unwrap())
            .collect::<Vec<_>>(),
    )
}

fn fact(relation: &RelationId, values: &[&str]) -> Fact {
    Fact::new(
        relation.clone(),
        values
            .iter()
            .map(|value| {
                Value::Term(Term::NamedNode(
                    NamedNode::new(format!("urn:test:value:{value}")).unwrap(),
                ))
            })
            .collect::<Vec<_>>(),
    )
}

fn stratified_rule(id: &str, head: Atom, positive: Vec<Atom>, negative: Vec<Atom>) -> Rule {
    Rule::new_stratified(RuleId::new(id).unwrap(), head, positive, negative)
}

fn keys(facts: &[Fact]) -> Vec<String> {
    facts.iter().map(Fact::canonical_key).collect()
}

#[test]
fn safe_negation_derives_only_when_the_ground_fact_is_absent() {
    let person = relation("person");
    let banned = relation("banned");
    let eligible = relation("eligible");
    let program = Program::new(vec![stratified_rule(
        "eligible",
        atom(&eligible, &["person"]),
        vec![atom(&person, &["person"])],
        vec![atom(&banned, &["person"])],
    )]);

    let result = Engine::default()
        .evaluate(
            &program,
            [
                fact(&person, &["alice"]),
                fact(&person, &["bob"]),
                fact(&banned, &["bob"]),
            ],
            &EvaluationOptions::default(),
        )
        .unwrap();

    assert!(result.facts().contains(&fact(&eligible, &["alice"])));
    assert!(!result.facts().contains(&fact(&eligible, &["bob"])));
}

#[test]
fn validation_rejects_variables_bound_only_by_negation() {
    let person = relation("person");
    let banned = relation("banned");
    let eligible = relation("eligible");
    let program = Program::new(vec![stratified_rule(
        "unsafe",
        atom(&eligible, &["person"]),
        vec![atom(&person, &["person"])],
        vec![atom(&banned, &["other"])],
    )]);

    assert!(matches!(
        validate(&program, &ValidationLimits::default()),
        Err(ValidationError::UnsafeNegativeVariable { .. })
    ));
}

#[test]
fn validation_rejects_cycles_through_negation() {
    let seed = relation("seed");
    let left = relation("left");
    let right = relation("right");
    let program = Program::new(vec![
        stratified_rule(
            "left",
            atom(&left, &["x"]),
            vec![atom(&seed, &["x"])],
            vec![atom(&right, &["x"])],
        ),
        stratified_rule(
            "right",
            atom(&right, &["x"]),
            vec![atom(&seed, &["x"])],
            vec![atom(&left, &["x"])],
        ),
    ]);

    assert!(matches!(
        validate(&program, &ValidationLimits::default()),
        Err(ValidationError::UnstratifiableNegation { .. })
    ));
}

#[test]
fn validation_exposes_positive_and_negative_dependencies_and_strata() {
    let person = relation("person");
    let banned = relation("banned");
    let eligible = relation("eligible");
    let program = Program::new(vec![stratified_rule(
        "eligible",
        atom(&eligible, &["person"]),
        vec![atom(&person, &["person"])],
        vec![atom(&banned, &["person"])],
    )]);

    let validated = validate(&program, &ValidationLimits::default()).unwrap();

    assert_eq!(
        validated
            .dependencies()
            .dependencies(&eligible)
            .collect::<Vec<_>>(),
        vec![&person]
    );
    assert_eq!(
        validated
            .dependencies()
            .negative_dependencies(&eligible)
            .collect::<Vec<_>>(),
        vec![&banned]
    );
    assert_eq!(validated.stratum(&person), Some(0));
    assert_eq!(validated.stratum(&banned), Some(0));
    assert_eq!(validated.stratum(&eligible), Some(1));
    assert_eq!(validated.max_stratum(), 1);
}

#[test]
fn recursion_reaches_a_fixpoint_after_a_negated_lower_stratum() {
    let edge = relation("edge");
    let banned = relation("banned");
    let safe_edge = relation("safe-edge");
    let path = relation("path");
    let program = Program::new(vec![
        stratified_rule(
            "safe-edge",
            atom(&safe_edge, &["from", "to"]),
            vec![atom(&edge, &["from", "to"])],
            vec![atom(&banned, &["to"])],
        ),
        Rule::new(
            RuleId::new("path-direct").unwrap(),
            atom(&path, &["from", "to"]),
            vec![atom(&safe_edge, &["from", "to"])],
        ),
        Rule::new(
            RuleId::new("path-transitive").unwrap(),
            atom(&path, &["from", "to"]),
            vec![
                atom(&path, &["from", "middle"]),
                atom(&safe_edge, &["middle", "to"]),
            ],
        ),
    ]);

    let result = Engine::default()
        .evaluate(
            &program,
            [
                fact(&edge, &["a", "b"]),
                fact(&edge, &["b", "c"]),
                fact(&edge, &["c", "d"]),
                fact(&edge, &["b", "blocked"]),
                fact(&banned, &["blocked"]),
            ],
            &EvaluationOptions::default(),
        )
        .unwrap();

    assert!(result.facts().contains(&fact(&path, &["a", "d"])));
    assert!(!result.facts().contains(&fact(&path, &["a", "blocked"])));
}

#[test]
fn provenance_records_the_ground_absence_assumption() {
    let person = relation("person");
    let banned = relation("banned");
    let eligible = relation("eligible");
    let derived = fact(&eligible, &["alice"]);
    let program = Program::new(vec![
        stratified_rule(
            "eligible",
            atom(&eligible, &["person"]),
            vec![atom(&person, &["person"])],
            vec![atom(&banned, &["person"])],
        )
        .with_source("eligible(X) :- person(X), not banned(X)."),
    ]);

    let result = Engine::default()
        .evaluate(
            &program,
            [fact(&person, &["alice"])],
            &EvaluationOptions {
                track_provenance: true,
                ..EvaluationOptions::default()
            },
        )
        .unwrap();
    let derivation = result.provenance().unwrap().derivation(&derived).unwrap();

    assert_eq!(derivation.rule_id().as_str(), "eligible");
    assert_eq!(derivation.absent_premises(), &[fact(&banned, &["alice"])]);
}

#[test]
fn stratified_results_are_deterministic_under_rule_and_input_reordering() {
    let item = relation("item");
    let hidden = relation("hidden");
    let visible = relation("visible");
    let first_rule = stratified_rule(
        "visible",
        atom(&visible, &["x"]),
        vec![atom(&item, &["x"])],
        vec![atom(&hidden, &["x"])],
    );
    let irrelevant_rule = Rule::new(
        RuleId::new("copy-hidden").unwrap(),
        atom(&hidden, &["x"]),
        vec![atom(&relation("suppressed"), &["x"])],
    );
    let inputs = vec![
        fact(&item, &["a"]),
        fact(&item, &["b"]),
        fact(&hidden, &["b"]),
    ];

    let left = Engine::default()
        .evaluate(
            &Program::new(vec![first_rule.clone(), irrelevant_rule.clone()]),
            inputs.clone(),
            &EvaluationOptions::default(),
        )
        .unwrap();
    let right = Engine::default()
        .evaluate(
            &Program::new(vec![irrelevant_rule, first_rule]),
            inputs.into_iter().rev(),
            &EvaluationOptions::default(),
        )
        .unwrap();

    assert_eq!(keys(left.facts()), keys(right.facts()));
    assert_eq!(keys(left.derived_facts()), keys(right.derived_facts()));
}

#[test]
fn rdf_adapter_reports_d1_and_preserves_ground_absence_semantics() {
    let source = NamedNode::new("urn:test:predicate:source").unwrap();
    let blocked = NamedNode::new("urn:test:predicate:blocked").unwrap();
    let visible = NamedNode::new("urn:test:predicate:visible").unwrap();
    let alice = NamedNode::new("urn:test:alice").unwrap();
    let bob = NamedNode::new("urn:test:bob").unwrap();
    let object = NamedNode::new("urn:test:object").unwrap();
    let program = Program::new(vec![Rule::new_stratified(
        RuleId::new("visible").unwrap(),
        oxdatalog::rdf::quad_atom(
            PatternTerm::variable("subject").unwrap(),
            PatternTerm::from(Term::NamedNode(visible.clone())),
            PatternTerm::variable("object").unwrap(),
            PatternTerm::variable("graph").unwrap(),
        ),
        vec![oxdatalog::rdf::quad_atom(
            PatternTerm::variable("subject").unwrap(),
            PatternTerm::from(Term::NamedNode(source.clone())),
            PatternTerm::variable("object").unwrap(),
            PatternTerm::variable("graph").unwrap(),
        )],
        vec![oxdatalog::rdf::quad_atom(
            PatternTerm::variable("subject").unwrap(),
            PatternTerm::from(Term::NamedNode(blocked.clone())),
            PatternTerm::variable("object").unwrap(),
            PatternTerm::variable("graph").unwrap(),
        )],
    )]);
    let mut base = Dataset::new();
    base.insert(Quad::new(
        alice.clone(),
        source.clone(),
        object.clone(),
        GraphName::DefaultGraph,
    ));
    base.insert(Quad::new(
        bob.clone(),
        source,
        object.clone(),
        GraphName::DefaultGraph,
    ));
    base.insert(Quad::new(
        bob.clone(),
        blocked,
        object.clone(),
        GraphName::DefaultGraph,
    ));

    let closure = oxdatalog::rdf::evaluate(&program, &base, &EvaluationOptions::default()).unwrap();

    assert_eq!(closure.profile(), oxdatalog::rdf::D1_PROFILE);
    assert!(closure.inference().contains(&Quad::new(
        alice,
        visible.clone(),
        object.clone(),
        GraphName::DefaultGraph,
    )));
    assert!(!closure.inference().contains(&Quad::new(
        bob,
        visible,
        object,
        GraphName::DefaultGraph,
    )));
}
