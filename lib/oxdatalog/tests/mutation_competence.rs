#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests keep assertions close to their named mutation boundary"
)]

use oxdatalog::{
    Atom, Engine, EvaluationError, EvaluationLimits, EvaluationOptions, Fact, LimitKind,
    PatternTerm, Program, RelationId, Rule, RuleId, ValidationError, ValidationLimits, Value,
    validate,
};
use oxrdf::{NamedNode, Term};
use std::time::Duration;

fn relation(name: &str) -> RelationId {
    RelationId::new(name).unwrap()
}

fn rule_id(name: &str) -> RuleId {
    RuleId::new(name).unwrap()
}

fn variable(name: &str) -> PatternTerm {
    PatternTerm::variable(name).unwrap()
}

fn atom(relation: &RelationId, names: &[&str]) -> Atom {
    Atom::new(
        relation.clone(),
        names.iter().map(|name| variable(name)).collect::<Vec<_>>(),
    )
}

fn value(name: &str) -> Value {
    Term::from(NamedNode::new(format!("urn:test:{name}")).unwrap()).into()
}

fn fact(relation: &RelationId, names: &[&str]) -> Fact {
    Fact::new(
        relation.clone(),
        names.iter().map(|name| value(name)).collect::<Vec<_>>(),
    )
}

fn direct_program() -> (Program, RelationId, RelationId) {
    let input = relation("input");
    let output = relation("output");
    (
        Program::new(vec![Rule::new(
            rule_id("direct"),
            atom(&output, &["x"]),
            vec![atom(&input, &["x"])],
        )]),
        input,
        output,
    )
}

fn ancestor_program() -> (Program, RelationId, RelationId) {
    let edge = relation("edge");
    let ancestor = relation("ancestor");
    (
        Program::new(vec![
            Rule::new(
                rule_id("ancestor-direct"),
                atom(&ancestor, &["x", "y"]),
                vec![atom(&edge, &["x", "y"])],
            ),
            Rule::new(
                rule_id("ancestor-transitive"),
                atom(&ancestor, &["x", "z"]),
                vec![atom(&ancestor, &["x", "y"]), atom(&edge, &["y", "z"])],
            ),
        ]),
        edge,
        ancestor,
    )
}

#[test]
fn reports_exact_fixpoint_metrics() {
    let (program, edge, _ancestor) = ancestor_program();
    let result = Engine::default()
        .evaluate(
            &program,
            [
                fact(&edge, &["a", "b"]),
                fact(&edge, &["b", "c"]),
                fact(&edge, &["c", "d"]),
            ],
            &EvaluationOptions::default(),
        )
        .unwrap();

    assert_eq!(result.iterations(), 4);
    assert!(result.elapsed() > Duration::ZERO);
    assert!(result.estimated_memory_bytes() > 1);
}

#[test]
fn evaluates_ground_seed_rules() {
    let seed = relation("seed");
    let program = Program::new(vec![Rule::new(
        rule_id("seed-rule"),
        Atom::new(
            seed.clone(),
            vec![PatternTerm::constant(Value::DefaultGraph)],
        ),
        Vec::new(),
    )]);
    let expected = Fact::new(seed, vec![Value::DefaultGraph]);
    let result = Engine::default()
        .evaluate(&program, [], &EvaluationOptions::default())
        .unwrap();

    assert_eq!(result.derived_facts(), [expected]);
}

#[test]
fn a_constant_pattern_does_not_match_a_different_term() {
    let input = relation("input");
    let output = relation("output");
    let wanted = value("wanted");
    let program = Program::new(vec![Rule::new(
        rule_id("constant-filter"),
        Atom::new(output, vec![PatternTerm::constant(Value::DefaultGraph)]),
        vec![Atom::new(
            input.clone(),
            vec![PatternTerm::constant(wanted)],
        )],
    )]);
    let result = Engine::default()
        .evaluate(
            &program,
            [Fact::new(input, vec![value("other")])],
            &EvaluationOptions::default(),
        )
        .unwrap();

    assert!(result.derived_facts().is_empty());
}

#[test]
fn the_intermediate_row_limit_is_inclusive() {
    let (program, input, output) = direct_program();
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            max_intermediate_rows: 1,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let result = Engine::default()
        .evaluate(&program, [fact(&input, &["one"])], &options)
        .unwrap();

    assert_eq!(result.derived_facts(), [fact(&output, &["one"])]);
}

#[test]
fn duplicate_candidates_do_not_exceed_the_fact_limit() {
    let input = relation("input");
    let program = Program::new(vec![Rule::new(
        rule_id("self-copy"),
        atom(&input, &["x"]),
        vec![atom(&input, &["x"])],
    )]);
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            max_facts: 1,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let input_fact = fact(&input, &["one"]);
    let result = Engine::default()
        .evaluate(&program, [input_fact.clone()], &options)
        .unwrap();

    assert_eq!(result.facts(), [input_fact]);
    assert!(result.derived_facts().is_empty());
}

#[test]
fn the_fact_limit_is_inclusive() {
    let input = relation("input");
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            max_facts: 1,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let result = Engine::default()
        .evaluate(
            &Program::default(),
            [Fact::new(input, vec![Value::DefaultGraph])],
            &options,
        )
        .unwrap();

    assert_eq!(result.facts().len(), 1);
}

#[test]
fn the_input_term_limit_is_inclusive() {
    let input = relation("input");
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            max_term_bytes: 1,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let result = Engine::default()
        .evaluate(
            &Program::default(),
            [Fact::new(input, vec![Value::DefaultGraph])],
            &options,
        )
        .unwrap();

    assert_eq!(result.facts().len(), 1);
}

#[test]
fn the_memory_limit_is_inclusive() {
    let input = relation("input");
    let input_fact = Fact::new(input, vec![Value::DefaultGraph]);
    let baseline = Engine::default()
        .evaluate(
            &Program::default(),
            [input_fact.clone()],
            &EvaluationOptions::default(),
        )
        .unwrap();
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            max_memory_bytes: baseline.estimated_memory_bytes(),
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let result = Engine::default()
        .evaluate(&Program::default(), [input_fact], &options)
        .unwrap();

    assert_eq!(
        result.estimated_memory_bytes(),
        baseline.estimated_memory_bytes()
    );
}

#[test]
fn a_zero_timeout_fails_closed() {
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            timeout: Some(Duration::ZERO),
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let error = Engine::default()
        .evaluate(&Program::default(), [], &options)
        .unwrap_err();

    assert!(matches!(
        error,
        EvaluationError::LimitExceeded {
            kind: LimitKind::Time,
            limit: 0,
        }
    ));
}

#[test]
fn provenance_chooses_the_canonical_rule() {
    let input = relation("input");
    let output = relation("output");
    let program = Program::new(vec![
        Rule::new(
            rule_id("z-rule"),
            atom(&output, &["x"]),
            vec![atom(&input, &["x"])],
        ),
        Rule::new(
            rule_id("a-rule"),
            atom(&output, &["x"]),
            vec![atom(&input, &["x"])],
        ),
    ]);
    let options = EvaluationOptions {
        track_provenance: true,
        ..EvaluationOptions::default()
    };
    let output_fact = fact(&output, &["one"]);
    let result = Engine::default()
        .evaluate(&program, [fact(&input, &["one"])], &options)
        .unwrap();
    let derivation = result
        .provenance()
        .unwrap()
        .derivation(&output_fact)
        .unwrap();

    assert_eq!(derivation.rule_id().as_str(), "a-rule");
}

#[test]
fn provenance_keeps_the_first_derivation_when_keys_tie() {
    let input = relation("input");
    let output = relation("output");
    let program = Program::new(vec![
        Rule::new(
            rule_id("a|b"),
            atom(&output, &["x"]),
            vec![atom(&input, &["x"])],
        )
        .with_source("c"),
        Rule::new(
            rule_id("a"),
            atom(&output, &["x"]),
            vec![atom(&input, &["x"])],
        )
        .with_source("b|c"),
    ]);
    let options = EvaluationOptions {
        track_provenance: true,
        ..EvaluationOptions::default()
    };
    let output_fact = fact(&output, &["one"]);
    let result = Engine::default()
        .evaluate(&program, [fact(&input, &["one"])], &options)
        .unwrap();
    let derivation = result
        .provenance()
        .unwrap()
        .derivation(&output_fact)
        .unwrap();

    assert_eq!(derivation.rule_id().as_str(), "a");
    assert_eq!(derivation.rule_source(), Some("b|c"));
}

#[test]
fn validation_exposes_arities_and_dependencies() {
    let input = relation("input");
    let derived = relation("derived");
    let seed = relation("seed");
    let program = Program::new(vec![
        Rule::new(
            rule_id("derive"),
            atom(&derived, &["x"]),
            vec![atom(&input, &["x", "y"])],
        ),
        Rule::new(
            rule_id("seed"),
            Atom::new(
                seed.clone(),
                vec![PatternTerm::constant(Value::DefaultGraph)],
            ),
            Vec::new(),
        ),
    ]);
    let validated = validate(&program, &ValidationLimits::default()).unwrap();
    let dependencies = validated
        .dependencies()
        .dependencies(&derived)
        .cloned()
        .collect::<Vec<_>>();
    let relations = validated
        .dependencies()
        .relations()
        .cloned()
        .collect::<Vec<_>>();

    assert_eq!(validated.arity(&input), Some(2));
    assert_eq!(dependencies, [input]);
    assert!(relations.contains(&derived));
    assert!(relations.contains(&seed));
}

#[test]
fn validation_reports_the_exact_maximum_stratum() {
    let domain = relation("domain");
    let first = relation("first");
    let second = relation("second");
    let program = Program::new(vec![
        Rule::new_stratified(
            rule_id("first-by-absence"),
            atom(&first, &["x"]),
            vec![atom(&domain, &["x"])],
            vec![atom(&domain, &["x"])],
        ),
        Rule::new_stratified(
            rule_id("second-by-absence"),
            atom(&second, &["x"]),
            vec![atom(&domain, &["x"])],
            vec![atom(&first, &["x"])],
        ),
    ]);
    let validated = validate(&program, &ValidationLimits::default()).unwrap();

    assert_eq!(validated.stratum(&domain), Some(0));
    assert_eq!(validated.stratum(&first), Some(1));
    assert_eq!(validated.stratum(&second), Some(2));
    assert_eq!(validated.max_stratum(), 2);
}

#[test]
fn validated_program_arities_reject_wrong_input_arity() {
    let (program, input, _output) = direct_program();
    let error = Engine::default()
        .evaluate(
            &program,
            [Fact::new(input.clone(), vec![value("one"), value("two")])],
            &EvaluationOptions::default(),
        )
        .unwrap_err();

    assert!(matches!(
        error,
        EvaluationError::InputArity {
            relation,
            expected: 1,
            actual: 2,
        } if relation == input
    ));
}

#[test]
fn validation_limits_are_inclusive_at_the_boundary() {
    let input = relation("i");
    let output = relation("o");
    let program = Program::new(vec![
        Rule::new(
            rule_id("r"),
            Atom::new(output, vec![PatternTerm::constant(Value::DefaultGraph)]),
            vec![Atom::new(
                input,
                vec![variable("x"), PatternTerm::constant(Value::DefaultGraph)],
            )],
        )
        .with_source("s"),
    ]);
    let limits = ValidationLimits {
        max_rules: 1,
        max_atoms_per_rule: 2,
        max_arity: 2,
        max_identifier_bytes: 1,
        max_source_bytes: 1,
        max_term_bytes: 1,
    };

    validate(&program, &limits).unwrap();
}

#[test]
fn an_identifier_over_the_limit_is_rejected() {
    let program = Program::new(vec![Rule::new(
        rule_id("too-long"),
        Atom::new(
            relation("o"),
            vec![PatternTerm::constant(Value::DefaultGraph)],
        ),
        Vec::new(),
    )]);
    let limits = ValidationLimits {
        max_identifier_bytes: 1,
        ..ValidationLimits::default()
    };
    let error = validate(&program, &limits).unwrap_err();

    assert!(matches!(
        error,
        ValidationError::IdentifierLimit {
            kind: "rule",
            actual: 8,
            limit: 1,
            ..
        }
    ));
}
