use super::{
    EvaluationError, LimitKind,
    control::{ExecutionGuard, RuntimeMemory, estimate_fact},
    storage::{FactKey, Interner, RelationStore, TermId, Tuple, fact_key_estimated_bytes},
};
use crate::{Atom, Derivation, PatternTerm, Provenance, Rule, Variable};
use std::collections::{BTreeMap, btree_map};
use std::mem::size_of;

struct Candidate {
    derivation: Derivation,
}

pub(super) struct CandidateSet {
    entries: BTreeMap<FactKey, Candidate>,
    estimated_bytes: usize,
}

impl CandidateSet {
    pub(super) fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
            estimated_bytes: size_of::<BTreeMap<FactKey, Candidate>>(),
        }
    }

    pub(super) fn estimated_bytes(&self) -> usize {
        self.estimated_bytes
    }

    fn insert(
        &mut self,
        key: FactKey,
        derivation: Derivation,
        guard: &mut ExecutionGuard<'_>,
        memory: &mut RuntimeMemory,
    ) -> Result<(), EvaluationError> {
        let candidate_count = self.entries.len();
        match self.entries.entry(key) {
            btree_map::Entry::Vacant(entry) => {
                if candidate_count >= guard.options().limits.max_facts {
                    return Err(EvaluationError::LimitExceeded {
                        kind: LimitKind::Facts,
                        limit: guard.options().limits.max_facts,
                    });
                }
                let projected = self
                    .estimated_bytes
                    .saturating_add(candidate_bytes(entry.key(), &derivation));
                memory.candidates = projected;
                guard.observe(memory)?;
                entry.insert(Candidate { derivation });
                self.estimated_bytes = projected;
            }
            btree_map::Entry::Occupied(mut entry) => {
                if derivation.canonical_key() < entry.get().derivation.canonical_key() {
                    let projected = self
                        .estimated_bytes
                        .saturating_sub(candidate_bytes(entry.key(), &entry.get().derivation))
                        .saturating_add(candidate_bytes(entry.key(), &derivation));
                    memory.candidates = projected;
                    guard.observe(memory)?;
                    entry.insert(Candidate { derivation });
                    self.estimated_bytes = projected;
                }
            }
        }
        Ok(())
    }

    pub(super) fn retain_new(
        &mut self,
        all: &RelationStore,
        guard: &mut ExecutionGuard<'_>,
        memory: &mut RuntimeMemory,
    ) -> Result<(), EvaluationError> {
        guard.check()?;
        self.entries.retain(|key, _| !all.contains_key(key));
        self.estimated_bytes = self
            .entries
            .iter()
            .map(|(key, candidate)| candidate_bytes(key, &candidate.derivation))
            .fold(
                size_of::<BTreeMap<FactKey, Candidate>>(),
                usize::saturating_add,
            );
        memory.candidates = self.estimated_bytes;
        guard.observe(memory)
    }
}

pub(super) fn evaluate_rule(
    rule: &Rule,
    delta_position: usize,
    all: &RelationStore,
    delta: &RelationStore,
    interner: &mut Interner,
    candidates: &mut CandidateSet,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<(), EvaluationError> {
    evaluate_rule_join(
        rule,
        Some(delta_position),
        all,
        delta,
        interner,
        candidates,
        guard,
        memory,
    )
}

pub(super) fn evaluate_rule_once(
    rule: &Rule,
    all: &RelationStore,
    interner: &mut Interner,
    candidates: &mut CandidateSet,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<(), EvaluationError> {
    evaluate_rule_join(rule, None, all, all, interner, candidates, guard, memory)
}

fn evaluate_rule_join(
    rule: &Rule,
    delta_position: Option<usize>,
    all: &RelationStore,
    delta: &RelationStore,
    interner: &mut Interner,
    candidates: &mut CandidateSet,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<(), EvaluationError> {
    let mut states = vec![(BTreeMap::new(), Vec::new())];
    let mut states_bytes = estimate_states(&states);
    memory.join_states = states_bytes;
    guard.observe(memory)?;
    for (position, atom) in rule.body().iter().enumerate() {
        let store = if Some(position) == delta_position {
            delta
        } else {
            all
        };
        let Some(relation) = store.relation(atom.relation()) else {
            memory.join_states = 0;
            guard.observe(memory)?;
            return Ok(());
        };
        let mut next = Vec::new();
        let mut next_bytes = size_of::<Vec<JoinState>>();
        for (binding, premises) in states {
            guard.check()?;
            for tuple in relation.matching(atom, &binding, interner) {
                guard.check()?;
                if let Some(next_binding) = bind(atom, tuple, binding.clone(), interner) {
                    let mut next_premises = premises.clone();
                    next_premises.push((atom.relation().clone(), tuple.clone()));
                    let state_bytes = estimate_state(&next_binding, &next_premises);
                    let projected = next_bytes.saturating_add(state_bytes);
                    memory.join_states = states_bytes.saturating_add(projected);
                    guard.observe(memory)?;
                    next.push((next_binding, next_premises));
                    next_bytes = projected;
                    if next.len() > guard.options().limits.max_intermediate_rows {
                        return Err(EvaluationError::LimitExceeded {
                            kind: LimitKind::IntermediateRows,
                            limit: guard.options().limits.max_intermediate_rows,
                        });
                    }
                }
            }
        }
        states = next;
        states_bytes = next_bytes;
        memory.join_states = states_bytes;
        guard.observe(memory)?;
        if states.is_empty() {
            memory.join_states = 0;
            guard.observe(memory)?;
            return Ok(());
        }
    }
    for (binding, premises) in states {
        guard.check()?;
        let Some(absent_premises) = ground_absent_premises(rule, &binding, all, interner, guard)?
        else {
            continue;
        };
        if let Some(tuple) = instantiate_head(rule, &binding, interner, guard, memory)? {
            let mut decoded = Vec::with_capacity(premises.len());
            let mut decoded_bytes = size_of::<Vec<crate::Fact>>();
            for premise in &premises {
                guard.check()?;
                let fact = interner.decode_fact(premise);
                decoded_bytes = decoded_bytes.saturating_add(estimate_fact(&fact));
                memory.join_states = states_bytes.saturating_add(decoded_bytes);
                guard.observe(memory)?;
                decoded.push(fact);
            }
            guard.check()?;
            let derivation = Derivation::new_with_absence(
                rule.id().clone(),
                rule.source(),
                decoded,
                absent_premises,
            );
            guard.check()?;
            candidates.insert(
                (rule.head().relation().clone(), tuple),
                derivation,
                guard,
                memory,
            )?;
        }
    }
    memory.join_states = 0;
    guard.observe(memory)
}

fn ground_absent_premises(
    rule: &Rule,
    binding: &BTreeMap<Variable, TermId>,
    all: &RelationStore,
    interner: &Interner,
    guard: &ExecutionGuard<'_>,
) -> Result<Option<Vec<crate::Fact>>, EvaluationError> {
    let mut absent = Vec::with_capacity(rule.negative_body().len());
    for atom in rule.negative_body() {
        guard.check()?;
        let Some(tuple) = instantiate_ground(atom, binding, interner) else {
            // Safe-negation validation guarantees grounding. Treat a violated
            // invariant as a non-match rather than deriving from uncertainty.
            return Ok(None);
        };
        let key = (atom.relation().clone(), tuple);
        if all.contains_key(&key) {
            return Ok(None);
        }
        absent.push(interner.decode_fact(&key));
    }
    Ok(Some(absent))
}

#[derive(Clone, Copy)]
pub(super) enum DeltaTarget {
    Current,
    Next,
}

pub(super) fn commit_candidates(
    candidates: CandidateSet,
    all: &mut RelationStore,
    delta: &mut RelationStore,
    target: DeltaTarget,
    interner: &Interner,
    mut provenance: Option<&mut Provenance>,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<(), EvaluationError> {
    for (key, candidate) in candidates.entries {
        guard.check()?;
        if all.contains_key(&key) {
            continue;
        }
        if all.len() >= guard.options().limits.max_facts {
            return Err(EvaluationError::LimitExceeded {
                kind: LimitKind::Facts,
                limit: guard.options().limits.max_facts,
            });
        }
        memory.all = all.projected_insert_bytes(&key);
        let projected_delta = delta.projected_insert_bytes(&key);
        match target {
            DeltaTarget::Current => memory.delta = projected_delta,
            DeltaTarget::Next => memory.next_delta = projected_delta,
        }
        let decoded = provenance.as_ref().map(|_| interner.decode_fact(&key));
        if let (Some(provenance), Some(fact)) = (provenance.as_deref(), decoded.as_ref()) {
            memory.provenance = provenance.projected_insert_bytes(fact, &candidate.derivation);
        }
        guard.observe(memory)?;
        all.insert_key(key.clone());
        delta.insert_key(key);
        if let (Some(provenance), Some(fact)) = (provenance.as_deref_mut(), decoded) {
            provenance.insert(fact, candidate.derivation);
            memory.provenance = provenance.estimated_bytes();
        }
    }
    memory.candidates = 0;
    guard.observe(memory)
}

pub(super) fn bind(
    atom: &Atom,
    tuple: &Tuple,
    mut binding: BTreeMap<Variable, TermId>,
    interner: &Interner,
) -> Option<BTreeMap<Variable, TermId>> {
    for (pattern, value) in atom.terms().iter().zip(tuple) {
        match pattern {
            PatternTerm::Constant(constant) if interner.id(constant) != *value => return None,
            PatternTerm::Constant(_) => {}
            PatternTerm::Variable(variable) => {
                if let Some(bound) = binding.insert(variable.clone(), *value)
                    && bound != *value
                {
                    return None;
                }
            }
            PatternTerm::GeneratedBlankNode(_) => return None,
        }
    }
    Some(binding)
}

fn instantiate_ground(
    atom: &Atom,
    binding: &BTreeMap<Variable, TermId>,
    interner: &Interner,
) -> Option<Tuple> {
    atom.terms()
        .iter()
        .map(|term| match term {
            PatternTerm::Constant(value) => Some(interner.id(value)),
            PatternTerm::Variable(variable) => binding.get(variable).copied(),
            PatternTerm::GeneratedBlankNode(_) => None,
        })
        .collect()
}

fn instantiate_head(
    rule: &Rule,
    binding: &BTreeMap<Variable, TermId>,
    interner: &mut Interner,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<Option<Tuple>, EvaluationError> {
    rule.head()
        .terms()
        .iter()
        .map(|term| match term {
            PatternTerm::Constant(value) => Ok(Some(interner.id(value))),
            PatternTerm::Variable(variable) => Ok(binding.get(variable).copied()),
            PatternTerm::GeneratedBlankNode(generator) => interner
                .generate_blank_node(rule.id(), generator, binding, guard, memory)
                .map(Some),
        })
        .collect()
}

type JoinState = (BTreeMap<Variable, TermId>, Vec<FactKey>);

fn estimate_states(states: &[JoinState]) -> usize {
    states
        .iter()
        .map(|(binding, premises)| estimate_state(binding, premises))
        .fold(size_of::<Vec<JoinState>>(), usize::saturating_add)
}

fn estimate_state(binding: &BTreeMap<Variable, TermId>, premises: &[FactKey]) -> usize {
    binding
        .keys()
        .map(|variable| variable.as_str().len().saturating_add(64))
        .fold(
            size_of::<BTreeMap<Variable, TermId>>(),
            usize::saturating_add,
        )
        .saturating_add(
            premises
                .iter()
                .map(fact_key_estimated_bytes)
                .fold(size_of::<Vec<FactKey>>(), usize::saturating_add),
        )
}

fn candidate_bytes(key: &FactKey, derivation: &Derivation) -> usize {
    fact_key_estimated_bytes(key)
        .saturating_add(derivation.estimated_bytes())
        .saturating_add(64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Fact, RelationId, RuleId, Value};
    #[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
    use std::time::Instant;
    #[cfg(all(target_family = "wasm", target_os = "unknown"))]
    use web_time::Instant;

    fn fixture() -> (FactKey, Derivation) {
        let relation = RelationId::new("fixture").unwrap();
        let fact = Fact::new(relation.clone(), vec![Value::DefaultGraph]);
        (
            (relation, vec![0]),
            Derivation::new_with_absence(
                RuleId::new("fixture-rule").unwrap(),
                None,
                vec![fact],
                Vec::new(),
            ),
        )
    }

    #[test]
    fn memory_estimators_are_nontrivial() {
        let (key, derivation) = fixture();
        let variable = Variable::new("x").unwrap();
        let binding = BTreeMap::from([(variable, 0)]);
        let premises = vec![key.clone()];
        let states = vec![(binding.clone(), premises.clone())];
        let fact = Fact::new(key.0.clone(), vec![Value::DefaultGraph]);

        assert!(estimate_fact(&fact) > 1);
        assert!(CandidateSet::new().estimated_bytes() > 1);
        assert!(estimate_state(&binding, &premises) > 1);
        assert!(estimate_states(&states) > 1);
        assert!(candidate_bytes(&key, &derivation) > 1);
    }

    #[test]
    fn retain_new_removes_candidates_already_in_all() {
        let (key, derivation) = fixture();
        let mut candidates = CandidateSet::new();
        candidates.estimated_bytes = candidates
            .estimated_bytes
            .saturating_add(candidate_bytes(&key, &derivation));
        candidates
            .entries
            .insert(key.clone(), Candidate { derivation });
        let mut all = RelationStore::new(&BTreeMap::new());
        all.insert_key(key);
        let options = super::super::EvaluationOptions::default();
        let mut guard = ExecutionGuard::new(&options, Instant::now());
        let mut memory = RuntimeMemory {
            candidates: candidates.estimated_bytes,
            ..RuntimeMemory::default()
        };

        candidates
            .retain_new(&all, &mut guard, &mut memory)
            .unwrap();

        assert!(candidates.entries.is_empty());
        assert_eq!(memory.candidates, candidates.estimated_bytes);
    }
}
