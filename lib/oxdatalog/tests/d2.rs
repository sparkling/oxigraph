#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public run-once generation contract"
)]

use oxdatalog::{
    Atom, Engine, EvaluationError, EvaluationLimits, EvaluationOptions, Fact, PatternTerm, Program,
    RelationId, Rule, RuleId, ValidationError, ValidationLimits, Value, validate,
};
use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, Quad, Term};

fn relation(name: &str) -> RelationId {
    RelationId::new(format!("urn:test:relation:{name}")).unwrap()
}

fn variable(name: &str) -> PatternTerm {
    PatternTerm::variable(name).unwrap()
}

fn generated(name: &str) -> PatternTerm {
    PatternTerm::generated_blank_node(name).unwrap()
}

fn atom(relation: &RelationId, terms: Vec<PatternTerm>) -> Atom {
    Atom::new(relation.clone(), terms)
}

fn value(name: &str) -> Value {
    Value::Term(Term::NamedNode(
        NamedNode::new(format!("urn:test:value:{name}")).unwrap(),
    ))
}

fn fact(relation: &RelationId, values: Vec<Value>) -> Fact {
    Fact::new(relation.clone(), values)
}

fn generation_program() -> (Program, RelationId, RelationId) {
    let input = relation("input");
    let output = relation("output");
    (
        Program::new(vec![
            Rule::new(
                RuleId::new("allocate").unwrap(),
                atom(&output, vec![variable("focus"), generated("result")]),
                vec![atom(&input, vec![variable("focus")])],
            )
            .run_once(),
        ]),
        input,
        output,
    )
}

fn output_blank_nodes(facts: &[Fact], output: &RelationId) -> Vec<BlankNode> {
    let mut nodes = facts
        .iter()
        .filter(|fact| fact.relation() == output)
        .filter_map(|fact| match &fact.values()[1] {
            Value::Term(Term::BlankNode(node)) => Some(node.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.as_str().cmp(right.as_str()));
    nodes
}

#[test]
fn generated_heads_require_run_once_rules() {
    let input = relation("input");
    let output = relation("output");
    let program = Program::new(vec![Rule::new(
        RuleId::new("unbounded").unwrap(),
        atom(&output, vec![variable("x"), generated("fresh")]),
        vec![atom(&input, vec![variable("x")])],
    )]);

    assert!(matches!(
        validate(&program, &ValidationLimits::default()),
        Err(ValidationError::GeneratedTermRequiresRunOnce { .. })
    ));
}

#[test]
fn generated_terms_are_rejected_outside_rule_heads() {
    let output = relation("output");
    let invalid_body = relation("invalid-body");
    let program = Program::new(vec![
        Rule::new(
            RuleId::new("invalid").unwrap(),
            atom(&output, vec![PatternTerm::constant(Value::DefaultGraph)]),
            vec![atom(&invalid_body, vec![generated("illegal")])],
        )
        .run_once(),
    ]);

    assert!(matches!(
        validate(&program, &ValidationLimits::default()),
        Err(ValidationError::GeneratedTermOutsideHead { .. })
    ));
}

#[test]
fn run_once_dependencies_are_closed_and_acyclic() {
    let (program, input, output) = generation_program();
    let validated = validate(&program, &ValidationLimits::default()).unwrap();

    assert_eq!(validated.stratum(&input), Some(0));
    assert_eq!(validated.stratum(&output), Some(1));
    assert_eq!(
        validated
            .dependencies()
            .closed_dependencies(&output)
            .collect::<Vec<_>>(),
        vec![&input]
    );
}

#[test]
fn cycles_through_run_once_dependencies_fail_before_evaluation() {
    let left = relation("left");
    let right = relation("right");
    let program = Program::new(vec![
        Rule::new(
            RuleId::new("left-once").unwrap(),
            atom(&left, vec![variable("x")]),
            vec![atom(&right, vec![variable("x")])],
        )
        .run_once(),
        Rule::new(
            RuleId::new("right").unwrap(),
            atom(&right, vec![variable("x")]),
            vec![atom(&left, vec![variable("x")])],
        ),
    ]);

    assert!(matches!(
        validate(&program, &ValidationLimits::default()),
        Err(ValidationError::UnstratifiableClosedDependency { .. })
    ));
}

#[test]
fn blank_node_allocation_is_per_binding_distinct_and_reproducible() {
    let (program, input, output) = generation_program();
    let left = Engine::default()
        .evaluate(
            &program,
            [
                fact(&input, vec![value("alice")]),
                fact(&input, vec![value("bob")]),
            ],
            &EvaluationOptions::default(),
        )
        .unwrap();
    let right = Engine::default()
        .evaluate(
            &program,
            [
                fact(&input, vec![value("bob")]),
                fact(&input, vec![value("alice")]),
            ],
            &EvaluationOptions::default(),
        )
        .unwrap();

    let left_nodes = output_blank_nodes(left.facts(), &output);
    assert_eq!(left_nodes.len(), 2);
    assert_ne!(left_nodes[0], left_nodes[1]);
    assert_eq!(left_nodes, output_blank_nodes(right.facts(), &output));
    assert_eq!(
        left.facts()
            .iter()
            .map(Fact::canonical_key)
            .collect::<Vec<_>>(),
        right
            .facts()
            .iter()
            .map(Fact::canonical_key)
            .collect::<Vec<_>>()
    );
}

#[test]
fn repeated_generator_slots_share_identity_and_named_generators_do_not() {
    let input = relation("input");
    let output = relation("output");
    let program = Program::new(vec![
        Rule::new(
            RuleId::new("allocate").unwrap(),
            atom(
                &output,
                vec![
                    variable("focus"),
                    generated("shared"),
                    generated("shared"),
                    generated("other"),
                ],
            ),
            vec![atom(&input, vec![variable("focus")])],
        )
        .run_once(),
    ]);
    let result = Engine::default()
        .evaluate(
            &program,
            [fact(&input, vec![value("alice")])],
            &EvaluationOptions::default(),
        )
        .unwrap();
    let derived = result
        .facts()
        .iter()
        .find(|fact| fact.relation() == &output)
        .unwrap();

    assert_eq!(derived.values()[1], derived.values()[2]);
    assert_ne!(derived.values()[1], derived.values()[3]);
}

#[test]
fn allocation_never_reuses_an_existing_blank_node_identifier() {
    let (program, input, output) = generation_program();
    let baseline = Engine::default()
        .evaluate(
            &program,
            [fact(&input, vec![value("alice")])],
            &EvaluationOptions::default(),
        )
        .unwrap();
    let occupied = output_blank_nodes(baseline.facts(), &output).remove(0);
    let collision = relation("unrelated");
    let rerun = Engine::default()
        .evaluate(
            &program,
            [
                fact(&input, vec![value("alice")]),
                fact(
                    &collision,
                    vec![Value::Term(Term::BlankNode(occupied.clone()))],
                ),
            ],
            &EvaluationOptions::default(),
        )
        .unwrap();

    assert_ne!(output_blank_nodes(rerun.facts(), &output), vec![occupied]);
}

#[test]
fn generated_terms_respect_the_term_budget() {
    let output = relation("output");
    let program = Program::new(vec![
        Rule::new(
            RuleId::new("allocate").unwrap(),
            atom(&output, vec![generated("result")]),
            Vec::new(),
        )
        .run_once(),
    ]);
    let error = Engine::default()
        .evaluate(
            &program,
            [],
            &EvaluationOptions {
                limits: EvaluationLimits {
                    max_term_bytes: 1,
                    ..EvaluationLimits::default()
                },
                ..EvaluationOptions::default()
            },
        )
        .unwrap_err();

    assert!(matches!(
        error,
        EvaluationError::GeneratedTermLimit {
            actual,
            limit: 1
        } if actual > 1
    ));
}

#[test]
fn generated_fact_provenance_is_reproducible() {
    let (program, input, output) = generation_program();
    let result = Engine::default()
        .evaluate(
            &program,
            [fact(&input, vec![value("alice")])],
            &EvaluationOptions {
                track_provenance: true,
                ..EvaluationOptions::default()
            },
        )
        .unwrap();
    let generated = result
        .derived_facts()
        .iter()
        .find(|fact| fact.relation() == &output)
        .unwrap();
    let derivation = result.provenance().unwrap().derivation(generated).unwrap();

    assert_eq!(derivation.rule_id().as_str(), "allocate");
    assert_eq!(derivation.premises(), &[fact(&input, vec![value("alice")])]);
}

#[test]
fn rdf_adapter_emits_generated_blank_nodes_in_a_separate_d2_graph() {
    let source = NamedNode::new("urn:test:predicate:source").unwrap();
    let generated_predicate = NamedNode::new("urn:test:predicate:generated").unwrap();
    let subject = NamedNode::new("urn:test:subject").unwrap();
    let object = NamedNode::new("urn:test:object").unwrap();
    let program = Program::new(vec![
        Rule::new(
            RuleId::new("allocate-rdf").unwrap(),
            oxdatalog::rdf::quad_atom(
                generated("result"),
                PatternTerm::from(Term::NamedNode(generated_predicate.clone())),
                variable("object"),
                variable("graph"),
            ),
            vec![oxdatalog::rdf::quad_atom(
                variable("subject"),
                PatternTerm::from(Term::NamedNode(source.clone())),
                variable("object"),
                variable("graph"),
            )],
        )
        .run_once(),
    ]);
    let base_quad = Quad::new(subject, source, object.clone(), GraphName::DefaultGraph);
    let mut base = Dataset::new();
    base.insert(base_quad.clone());

    let closure = oxdatalog::rdf::evaluate(&program, &base, &EvaluationOptions::default()).unwrap();
    let inferred = closure.inference().iter().collect::<Vec<_>>();

    assert_eq!(closure.profile(), oxdatalog::rdf::D2_PROFILE);
    assert_eq!(inferred.len(), 1);
    assert!(matches!(
        inferred[0].subject,
        oxrdf::NamedOrBlankNode::BlankNode(_)
    ));
    assert_eq!(inferred[0].predicate, generated_predicate.as_ref());
    assert_eq!(inferred[0].object, Term::NamedNode(object));
    assert!(closure.base().contains(&base_quad));
}
