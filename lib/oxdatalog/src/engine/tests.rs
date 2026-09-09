use super::{
    Engine, EvaluationOptions, Interner,
    control::{ExecutionGuard, RuntimeMemory, estimate_fact},
    rules::bind,
    timed_out,
};
use crate::{
    Atom, Fact, PatternTerm, Program, RelationId, Rule, RuleId, ValidationLimits, Value, validate,
};
use oxrdf::{NamedNode, Term};
use std::collections::BTreeMap;
use std::time::Duration;
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

fn value(name: &str) -> Value {
    Term::from(NamedNode::new(format!("urn:test:{name}")).unwrap()).into()
}

#[test]
fn external_cancellation_is_latched_and_preserves_shared_explicit_cancel() {
    use super::CancellationToken;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let original = CancellationToken::new();
    let token = original
        .clone()
        .with_cancellation_check(move || observed.fetch_add(1, Ordering::Relaxed) == 2);
    assert!(!token.is_cancelled());
    assert!(!token.clone().is_cancelled());
    assert!(token.is_cancelled());
    assert!(original.is_cancelled());
    assert!(token.clone().is_cancelled());
    assert_eq!(calls.load(Ordering::Relaxed), 3);
}

#[test]
fn external_cancellation_stops_engine_mid_input_without_partial_result() {
    use super::{CancellationToken, EvaluationError};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let options = EvaluationOptions {
        cancellation_token: CancellationToken::new()
            .with_cancellation_check(move || observed.fetch_add(1, Ordering::Relaxed) == 50),
        ..EvaluationOptions::default()
    };
    let fact = Fact::new(RelationId::new("input").unwrap(), vec![value("seed")]);
    let result = Engine::default().evaluate(
        &Program::new(Vec::new()),
        std::iter::repeat_n(fact, 1_000),
        &options,
    );
    assert!(matches!(result, Err(EvaluationError::Cancelled)));
    assert_eq!(calls.load(Ordering::Relaxed), 51);
}

#[test]
fn bind_defensively_rejects_a_mismatched_constant() {
    let relation = RelationId::new("input").unwrap();
    let wanted = value("wanted");
    let other = value("other");
    let program = Program::new(vec![Rule::new(
        RuleId::new("intern-constant").unwrap(),
        Atom::new(
            RelationId::new("seed").unwrap(),
            vec![PatternTerm::constant(wanted.clone())],
        ),
        Vec::new(),
    )]);
    let validated = validate(&program, &ValidationLimits::default()).unwrap();
    let input_fact = Fact::new(relation.clone(), vec![other]);
    let options = EvaluationOptions::default();
    let mut guard = ExecutionGuard::new(&options, Instant::now());
    let mut memory = RuntimeMemory::default();
    let interner = Interner::new(
        &validated,
        std::slice::from_ref(&input_fact),
        &mut guard,
        &mut memory,
    )
    .unwrap();
    let (_, tuple) = interner.encode_fact(&input_fact);
    let atom = Atom::new(relation, vec![PatternTerm::constant(wanted)]);

    assert!(bind(&atom, &tuple, BTreeMap::new(), &interner).is_none());
}

#[test]
fn bind_accepts_an_exactly_matching_constant() {
    let relation = RelationId::new("input").unwrap();
    let wanted = value("wanted");
    let program = Program::new(vec![Rule::new(
        RuleId::new("intern-constant").unwrap(),
        Atom::new(
            RelationId::new("seed").unwrap(),
            vec![PatternTerm::constant(wanted.clone())],
        ),
        Vec::new(),
    )]);
    let validated = validate(&program, &ValidationLimits::default()).unwrap();
    let input_fact = Fact::new(relation.clone(), vec![wanted.clone()]);
    let options = EvaluationOptions::default();
    let mut guard = ExecutionGuard::new(&options, Instant::now());
    let mut memory = RuntimeMemory::default();
    let interner = Interner::new(
        &validated,
        std::slice::from_ref(&input_fact),
        &mut guard,
        &mut memory,
    )
    .unwrap();
    let (_, tuple) = interner.encode_fact(&input_fact);
    let atom = Atom::new(relation, vec![PatternTerm::constant(wanted)]);

    assert_eq!(
        bind(&atom, &tuple, BTreeMap::new(), &interner),
        Some(BTreeMap::new())
    );
}

#[test]
fn timeout_boundary_is_strict_and_deterministic() {
    let deadline = Duration::from_millis(10);

    assert!(timed_out(deadline, deadline));
    assert!(!timed_out(Duration::from_millis(9), deadline));
    assert!(timed_out(Duration::from_millis(11), deadline));
}

#[test]
fn duplicate_base_facts_do_not_duplicate_base_key_memory() {
    let fact = Fact::new(RelationId::new("zero-arity-input").unwrap(), Vec::new());
    let program = Program::new(Vec::new());
    let single = Engine::default()
        .evaluate(
            &program,
            std::iter::once(fact.clone()),
            &EvaluationOptions::default(),
        )
        .unwrap();
    let duplicate_count = 4;
    let repeated = Engine::default()
        .evaluate(
            &program,
            std::iter::repeat_n(fact.clone(), duplicate_count),
            &EvaluationOptions::default(),
        )
        .unwrap();

    assert_eq!(
        repeated
            .peak_estimated_working_set_bytes()
            .saturating_sub(single.peak_estimated_working_set_bytes()),
        (duplicate_count - 1) * estimate_fact(&fact)
    );
}
