use super::{
    EvaluationError, LimitKind,
    control::{ExecutionGuard, RuntimeMemory},
};
use crate::{
    Atom, BlankNodeGenerator, Fact, PatternTerm, RelationId, RuleId, ValidatedProgram, Value,
    Variable,
};
use oxrdf::{BlankNode, Term};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::mem::size_of;

pub(super) type TermId = u32;
pub(super) type Tuple = Vec<TermId>;
pub(super) type FactKey = (RelationId, Tuple);

#[derive(Debug)]
pub(super) struct Interner {
    values: Vec<Value>,
    ids: HashMap<Value, TermId>,
    generated: HashMap<String, TermId>,
    estimated_bytes: usize,
}

impl Interner {
    pub(super) fn new(
        program: &ValidatedProgram,
        facts: &[Fact],
        guard: &mut ExecutionGuard<'_>,
        memory: &mut RuntimeMemory,
    ) -> Result<Self, EvaluationError> {
        let mut values = Vec::new();
        let mut values_bytes = size_of::<Vec<Value>>();
        for fact in facts {
            for value in fact.values() {
                push_value(value.clone(), &mut values, &mut values_bytes, guard, memory)?;
            }
        }
        for rule in program.rules() {
            for atom in std::iter::once(rule.head())
                .chain(rule.body())
                .chain(rule.negative_body())
            {
                for term in atom.terms() {
                    if let PatternTerm::Constant(value) = term {
                        push_value(value.clone(), &mut values, &mut values_bytes, guard, memory)?;
                    }
                }
            }
        }
        guard.check()?;
        values.sort_unstable_by_key(Value::sort_key);
        guard.check()?;
        values.dedup();
        if values.len() > TermId::MAX as usize {
            return Err(EvaluationError::LimitExceeded {
                kind: LimitKind::Terms,
                limit: TermId::MAX as usize,
            });
        }
        values_bytes = estimate_values(&values);
        let ids_bytes = values
            .iter()
            .map(estimate_id_entry)
            .fold(size_of::<HashMap<Value, TermId>>(), usize::saturating_add);
        memory.interner = values_bytes
            .saturating_add(ids_bytes)
            .saturating_add(size_of::<HashMap<String, TermId>>());
        guard.observe(memory)?;
        let mut ids = HashMap::with_capacity(values.len());
        for (id, value) in (0_u32..).zip(values.iter().cloned()) {
            guard.check()?;
            ids.insert(value, id);
        }
        Ok(Self {
            values,
            ids,
            generated: HashMap::new(),
            estimated_bytes: memory.interner,
        })
    }

    pub(super) fn id(&self, value: &Value) -> TermId {
        self.ids[value]
    }

    pub(super) fn encode_fact(&self, fact: &Fact) -> FactKey {
        (
            fact.relation().clone(),
            fact.values().iter().map(|value| self.id(value)).collect(),
        )
    }

    pub(super) fn decode_fact(&self, (relation, tuple): &FactKey) -> Fact {
        Fact::new(
            relation.clone(),
            tuple
                .iter()
                .map(|id| self.values[*id as usize].clone())
                .collect::<Vec<_>>(),
        )
    }

    pub(super) fn estimated_bytes(&self) -> usize {
        self.estimated_bytes
    }

    pub(super) fn generate_blank_node(
        &mut self,
        rule: &RuleId,
        generator: &BlankNodeGenerator,
        binding: &BTreeMap<Variable, TermId>,
        guard: &mut ExecutionGuard<'_>,
        memory: &mut RuntimeMemory,
    ) -> Result<TermId, EvaluationError> {
        let key = self.generation_key(rule, generator, binding);
        if let Some(id) = self.generated.get(&key) {
            return Ok(*id);
        }
        let id =
            TermId::try_from(self.values.len()).map_err(|_| EvaluationError::LimitExceeded {
                kind: LimitKind::Terms,
                limit: TermId::MAX as usize,
            })?;
        let digest = hex::encode(Sha256::digest(key.as_bytes()));
        let base = format!("oxdatalog-{digest}");
        let mut value = None;
        for suffix in 0..=self.ids.len() {
            guard.check()?;
            let label = if suffix == 0 {
                base.clone()
            } else {
                format!("{base}-{suffix}")
            };
            let candidate = Value::Term(Term::BlankNode(BlankNode::new_unchecked(label)));
            if !self.ids.contains_key(&candidate) {
                value = Some(candidate);
                break;
            }
        }
        let Some(value) = value else {
            return Err(EvaluationError::GeneratedBlankNodeSpaceExhausted);
        };
        let actual = value.estimated_bytes();
        if actual > guard.options().limits.max_term_bytes {
            return Err(EvaluationError::GeneratedTermLimit {
                actual,
                limit: guard.options().limits.max_term_bytes,
            });
        }
        let projected = self
            .estimated_bytes
            .saturating_add(estimate_value_slot(&value))
            .saturating_add(estimate_id_entry(&value))
            .saturating_add(key.len())
            .saturating_add(64);
        memory.interner = projected;
        guard.observe(memory)?;
        self.values.push(value.clone());
        self.ids.insert(value, id);
        self.generated.insert(key, id);
        self.estimated_bytes = projected;
        Ok(id)
    }

    fn generation_key(
        &self,
        rule: &RuleId,
        generator: &BlankNodeGenerator,
        binding: &BTreeMap<Variable, TermId>,
    ) -> String {
        let mut key = format!(
            "{}:{}|{}:{}",
            rule.as_str().len(),
            rule,
            generator.as_str().len(),
            generator
        );
        for (variable, id) in binding {
            let value = self.values[*id as usize].sort_key();
            key.push('|');
            key.push_str(&variable.as_str().len().to_string());
            key.push(':');
            key.push_str(variable.as_str());
            key.push('=');
            key.push_str(&value.len().to_string());
            key.push(':');
            key.push_str(&value);
        }
        key
    }
}

fn push_value(
    value: Value,
    values: &mut Vec<Value>,
    values_bytes: &mut usize,
    guard: &mut ExecutionGuard<'_>,
    memory: &mut RuntimeMemory,
) -> Result<(), EvaluationError> {
    let projected = values_bytes.saturating_add(estimate_value_slot(&value));
    memory.interner = projected;
    guard.observe(memory)?;
    values.push(value);
    *values_bytes = projected;
    Ok(())
}

fn estimate_values(values: &[Value]) -> usize {
    values
        .iter()
        .map(estimate_value_slot)
        .fold(size_of::<Vec<Value>>(), usize::saturating_add)
}

fn estimate_value_slot(value: &Value) -> usize {
    size_of::<Value>()
        .saturating_add(value.estimated_bytes())
        .saturating_add(16)
}

fn estimate_id_entry(value: &Value) -> usize {
    estimate_value_slot(value)
        .saturating_add(size_of::<TermId>())
        .saturating_add(48)
}

#[derive(Clone, Debug, Default)]
pub(super) struct RelationData {
    tuples: BTreeSet<Tuple>,
    indexes: Vec<BTreeMap<TermId, BTreeSet<Tuple>>>,
}

impl RelationData {
    fn new(arity: usize) -> Self {
        Self {
            tuples: BTreeSet::new(),
            indexes: std::iter::repeat_with(BTreeMap::new).take(arity).collect(),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.tuples.is_empty()
    }

    fn insert(&mut self, tuple: Tuple) -> bool {
        if self.tuples.contains(&tuple) {
            return false;
        }
        for (position, value) in tuple.iter().enumerate() {
            self.indexes[position]
                .entry(*value)
                .or_default()
                .insert(tuple.clone());
        }
        self.tuples.insert(tuple);
        true
    }

    pub(super) fn matching<'a>(
        &'a self,
        atom: &Atom,
        binding: &BTreeMap<Variable, TermId>,
        interner: &Interner,
    ) -> impl Iterator<Item = &'a Tuple> + use<'a> {
        let constraints = atom
            .terms()
            .iter()
            .enumerate()
            .filter_map(|(position, term)| {
                let value = match term {
                    PatternTerm::Constant(value) => Some(interner.id(value)),
                    PatternTerm::Variable(variable) => binding.get(variable).copied(),
                    PatternTerm::GeneratedBlankNode(_) => None,
                }?;
                Some((position, value))
            })
            .collect::<Vec<_>>();
        let selected = constraints
            .iter()
            .min_by_key(|(position, value)| {
                self.indexes[*position].get(value).map_or(0, BTreeSet::len)
            })
            .and_then(|(position, value)| self.indexes[*position].get(value));
        selected
            .unwrap_or(&self.tuples)
            .iter()
            .filter(move |tuple| {
                constraints
                    .iter()
                    .all(|(position, value)| tuple[*position] == *value)
            })
    }

    fn base_estimated_bytes(arity: usize) -> usize {
        size_of::<Self>()
            .saturating_add(arity.saturating_mul(size_of::<BTreeMap<TermId, BTreeSet<Tuple>>>()))
    }

    fn tuple_estimated_bytes(arity: usize) -> usize {
        (arity + 1).saturating_mul(arity.saturating_mul(size_of::<TermId>()).saturating_add(48))
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct RelationStore {
    relations: BTreeMap<RelationId, RelationData>,
    estimated_bytes: usize,
}

impl RelationStore {
    pub(super) fn new(arities: &BTreeMap<RelationId, usize>) -> Self {
        let estimated_bytes = arities
            .iter()
            .map(|(relation, arity)| relation_estimated_bytes(relation, *arity))
            .fold(
                size_of::<BTreeMap<RelationId, RelationData>>(),
                usize::saturating_add,
            );
        Self {
            relations: arities
                .iter()
                .map(|(relation, arity)| (relation.clone(), RelationData::new(*arity)))
                .collect(),
            estimated_bytes,
        }
    }

    pub(super) fn relation(&self, relation: &RelationId) -> Option<&RelationData> {
        self.relations.get(relation)
    }

    pub(super) fn insert_key(&mut self, (relation, tuple): FactKey) -> bool {
        let arity = tuple.len();
        let relation_bytes = if self.relations.contains_key(&relation) {
            0
        } else {
            relation_estimated_bytes(&relation, arity)
        };
        let data = self
            .relations
            .entry(relation)
            .or_insert_with(|| RelationData::new(arity));
        if data.insert(tuple) {
            self.estimated_bytes = self
                .estimated_bytes
                .saturating_add(relation_bytes)
                .saturating_add(RelationData::tuple_estimated_bytes(arity));
            true
        } else {
            false
        }
    }

    pub(super) fn contains_key(&self, (relation, tuple): &FactKey) -> bool {
        self.relations
            .get(relation)
            .is_some_and(|data| data.tuples.contains(tuple))
    }

    pub(super) fn is_empty(&self) -> bool {
        self.relations.values().all(RelationData::is_empty)
    }

    pub(super) fn keys(&self) -> impl Iterator<Item = FactKey> + '_ {
        self.relations.iter().flat_map(|(relation, data)| {
            data.tuples
                .iter()
                .map(move |tuple| (relation.clone(), tuple.clone()))
        })
    }

    pub(super) fn keys_for_relation(
        &self,
        relation: &RelationId,
    ) -> impl Iterator<Item = FactKey> + '_ {
        let relation = relation.clone();
        self.relations
            .get(&relation)
            .into_iter()
            .flat_map(move |data| {
                let relation = relation.clone();
                data.tuples
                    .iter()
                    .map(move |tuple| (relation.clone(), tuple.clone()))
            })
    }

    pub(super) fn len(&self) -> usize {
        self.relations.values().map(|data| data.tuples.len()).sum()
    }

    pub(super) fn estimated_bytes(&self) -> usize {
        self.estimated_bytes
    }

    pub(super) fn projected_insert_bytes(&self, (relation, tuple): &FactKey) -> usize {
        if self
            .relations
            .get(relation)
            .is_some_and(|data| data.tuples.contains(tuple))
        {
            return self.estimated_bytes;
        }
        self.estimated_bytes
            .saturating_add(if self.relations.contains_key(relation) {
                0
            } else {
                relation_estimated_bytes(relation, tuple.len())
            })
            .saturating_add(RelationData::tuple_estimated_bytes(tuple.len()))
    }
}

pub(super) fn fact_key_estimated_bytes((relation, tuple): &FactKey) -> usize {
    relation
        .as_str()
        .len()
        .saturating_add(tuple.len().saturating_mul(size_of::<TermId>()))
        .saturating_add(64)
}

fn relation_estimated_bytes(relation: &RelationId, arity: usize) -> usize {
    relation
        .as_str()
        .len()
        .saturating_add(RelationData::base_estimated_bytes(arity))
        .saturating_add(48)
}

#[cfg(test)]
mod tests;
