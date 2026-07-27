use super::{
    EvaluationError, LimitKind,
    control::{ExecutionGuard, RuntimeMemory},
    rules::{CandidateSet, DeltaTarget, commit_candidates, evaluate_rule, evaluate_rule_once},
    storage::{Interner, RelationData, RelationStore},
};
use crate::{Provenance, ValidatedProgram};

/// Evaluates each stratum to a fixpoint before exposing its absence to a
/// higher stratum.
pub(super) fn evaluate_strata(
    program: &ValidatedProgram,
    interner: &mut Interner,
    all: &mut RelationStore,
    provenance: &mut Option<Provenance>,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<usize, EvaluationError> {
    let mut iterations = 0;
    for stratum in 0..=program.max_stratum() {
        guard.check()?;
        let mut delta = initial_delta(program, stratum, all, guard, memory)?;
        evaluate_nonrecursive_rules(
            program, stratum, interner, all, &mut delta, provenance, guard, memory,
        )?;

        while !delta.is_empty() {
            guard.check()?;
            if iterations >= guard.options().limits.max_iterations {
                return Err(EvaluationError::LimitExceeded {
                    kind: LimitKind::Iterations,
                    limit: guard.options().limits.max_iterations,
                });
            }
            iterations += 1;
            let mut candidates = CandidateSet::new();
            memory.candidates = candidates.estimated_bytes();
            guard.observe(memory)?;
            for rule in program
                .rules()
                .iter()
                .filter(|rule| program.stratum(rule.head().relation()) == Some(stratum))
            {
                for (delta_position, atom) in rule.body().iter().enumerate() {
                    if program.stratum(atom.relation()) != Some(stratum) {
                        continue;
                    }
                    if delta
                        .relation(atom.relation())
                        .is_none_or(RelationData::is_empty)
                    {
                        continue;
                    }
                    evaluate_rule(
                        rule,
                        delta_position,
                        all,
                        &delta,
                        interner,
                        &mut candidates,
                        guard,
                        memory,
                    )?;
                }
            }
            let mut next_delta = RelationStore::new(program.arities());
            memory.next_delta = next_delta.estimated_bytes();
            guard.observe(memory)?;
            candidates.retain_new(all, guard, memory)?;
            commit_candidates(
                candidates,
                all,
                &mut next_delta,
                DeltaTarget::Next,
                interner,
                provenance.as_mut(),
                guard,
                memory,
            )?;
            delta = next_delta;
            memory.delta = delta.estimated_bytes();
            memory.next_delta = 0;
            memory.all = all.estimated_bytes();
            guard.observe(memory)?;
        }
        memory.delta = 0;
        guard.observe(memory)?;
    }
    Ok(iterations)
}

fn initial_delta(
    program: &ValidatedProgram,
    stratum: usize,
    all: &RelationStore,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<RelationStore, EvaluationError> {
    let mut delta = RelationStore::new(program.arities());
    memory.delta = delta.estimated_bytes();
    guard.observe(memory)?;
    for relation in program
        .dependencies()
        .relations()
        .filter(|relation| program.stratum(relation) == Some(stratum))
    {
        for key in all.keys_for_relation(relation) {
            guard.check()?;
            memory.delta = delta.projected_insert_bytes(&key);
            guard.observe(memory)?;
            delta.insert_key(key);
        }
    }
    memory.delta = delta.estimated_bytes();
    guard.observe(memory)?;
    Ok(delta)
}

fn evaluate_nonrecursive_rules(
    program: &ValidatedProgram,
    stratum: usize,
    interner: &mut Interner,
    all: &mut RelationStore,
    delta: &mut RelationStore,
    provenance: &mut Option<Provenance>,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<(), EvaluationError> {
    let mut candidates = CandidateSet::new();
    memory.candidates = candidates.estimated_bytes();
    guard.observe(memory)?;
    for rule in program.rules().iter().filter(|rule| {
        program.stratum(rule.head().relation()) == Some(stratum)
            && rule
                .body()
                .iter()
                .all(|atom| program.stratum(atom.relation()) != Some(stratum))
    }) {
        evaluate_rule_once(rule, all, interner, &mut candidates, guard, memory)?;
    }
    candidates.retain_new(all, guard, memory)?;
    commit_candidates(
        candidates,
        all,
        delta,
        DeltaTarget::Current,
        interner,
        provenance.as_mut(),
        guard,
        memory,
    )?;
    memory.all = all.estimated_bytes();
    memory.delta = delta.estimated_bytes();
    guard.observe(memory)
}
