#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise public boundedness contracts"
)]

use oxdatalog::{
    Atom, CancellationToken, Engine, EvaluationError, EvaluationLimits, EvaluationOptions, Fact,
    LimitKind, PatternTerm, Program, RelationId, Rule, RuleId, ValidationError, ValidationLimits,
    Value, validate,
};
use std::time::Duration;

fn relation(name: &str) -> RelationId {
    RelationId::new(name).unwrap()
}

fn atom(relation: &RelationId, variable: &str) -> Atom {
    Atom::new(
        relation.clone(),
        vec![PatternTerm::variable(variable).unwrap()],
    )
}

fn direct_program(source: &str) -> (Program, RelationId) {
    let input = relation("input");
    let output = relation("output");
    (
        Program::new(vec![
            Rule::new(
                RuleId::new("direct").unwrap(),
                atom(&output, "x"),
                vec![atom(&input, "x")],
            )
            .with_source(source),
        ]),
        input,
    )
}

#[test]
fn atom_limit_counts_the_head_and_is_inclusive() {
    let (program, _) = direct_program("source");
    let inclusive = ValidationLimits {
        max_atoms_per_rule: 2,
        ..ValidationLimits::default()
    };
    validate(&program, &inclusive).unwrap();

    let error = validate(
        &program,
        &ValidationLimits {
            max_atoms_per_rule: 1,
            ..ValidationLimits::default()
        },
    )
    .unwrap_err();
    assert!(matches!(
        error,
        ValidationError::AtomLimit {
            actual: 2,
            limit: 1,
            ..
        }
    ));
}

#[test]
fn evaluation_control_precedes_program_validation() {
    let input = relation("input");
    let output = relation("output");
    let invalid = Program::new(vec![Rule::new(
        RuleId::new("unsafe").unwrap(),
        atom(&output, "unbound"),
        vec![atom(&input, "bound")],
    )]);
    let error = Engine::default()
        .evaluate(
            &invalid,
            [],
            &EvaluationOptions {
                limits: EvaluationLimits {
                    timeout: Some(Duration::ZERO),
                    ..EvaluationLimits::default()
                },
                ..EvaluationOptions::default()
            },
        )
        .unwrap_err();
    assert!(matches!(
        error,
        EvaluationError::LimitExceeded {
            kind: LimitKind::Time,
            limit: 0,
        }
    ));

    let cancellation_token = CancellationToken::new();
    cancellation_token.cancel();
    let error = Engine::default()
        .evaluate(
            &invalid,
            [],
            &EvaluationOptions {
                cancellation_token,
                ..EvaluationOptions::default()
            },
        )
        .unwrap_err();
    assert!(matches!(error, EvaluationError::Cancelled));
}

#[test]
fn provenance_is_part_of_the_estimated_working_set() {
    let source = "a deliberately long provenance source ".repeat(64);
    let (program, input) = direct_program(&source);
    let facts = std::iter::repeat_with(|| Fact::new(input.clone(), vec![Value::DefaultGraph]))
        .take(32)
        .collect::<Vec<_>>();
    let without = Engine::default()
        .evaluate(&program, facts.clone(), &EvaluationOptions::default())
        .unwrap();
    let with = Engine::default()
        .evaluate(
            &program,
            facts.clone(),
            &EvaluationOptions {
                track_provenance: true,
                ..EvaluationOptions::default()
            },
        )
        .unwrap();
    assert!(with.peak_estimated_working_set_bytes() > without.peak_estimated_working_set_bytes());

    let error = Engine::default()
        .evaluate(
            &program,
            facts,
            &EvaluationOptions {
                limits: EvaluationLimits {
                    max_memory_bytes: without.peak_estimated_working_set_bytes(),
                    ..EvaluationLimits::default()
                },
                track_provenance: true,
                ..EvaluationOptions::default()
            },
        )
        .unwrap_err();
    assert!(matches!(
        error,
        EvaluationError::LimitExceeded {
            kind: LimitKind::Memory,
            ..
        }
    ));
}
