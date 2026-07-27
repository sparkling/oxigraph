use crate::{Fact, RuleId};
use std::collections::HashMap;
use std::mem::size_of;

/// The canonical retained derivation of one inferred fact.
///
/// Premises are sorted by [`Fact::canonical_key`]. When more than one
/// derivation is possible, the engine deterministically retains one.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Derivation {
    rule_id: RuleId,
    rule_source: Option<Box<str>>,
    premises: Box<[Fact]>,
    absent_premises: Box<[Fact]>,
}

impl Derivation {
    pub(crate) fn new_with_absence(
        rule_id: RuleId,
        rule_source: Option<&str>,
        mut premises: Vec<Fact>,
        mut absent_premises: Vec<Fact>,
    ) -> Self {
        premises.sort_by_key(Fact::canonical_key);
        absent_premises.sort_by_key(Fact::canonical_key);
        Self {
            rule_id,
            rule_source: rule_source.map(Into::into),
            premises: premises.into_boxed_slice(),
            absent_premises: absent_premises.into_boxed_slice(),
        }
    }

    /// Returns the identifier of the rule that produced the fact.
    pub fn rule_id(&self) -> &RuleId {
        &self.rule_id
    }

    /// Returns the rule's optional source annotation.
    pub fn rule_source(&self) -> Option<&str> {
        self.rule_source.as_deref()
    }

    /// Returns the sorted positive premises used by the derivation.
    pub fn premises(&self) -> &[Fact] {
        &self.premises
    }

    /// Ground facts whose absence was required by a stratified rule.
    pub fn absent_premises(&self) -> &[Fact] {
        &self.absent_premises
    }

    pub(crate) fn canonical_key(&self) -> String {
        let mut result = self.rule_id.as_str().to_owned();
        result.push('|');
        if let Some(source) = &self.rule_source {
            result.push_str(source);
        }
        for premise in &self.premises {
            result.push('|');
            result.push_str(&premise.canonical_key());
        }
        for premise in &self.absent_premises {
            result.push_str("|!");
            result.push_str(&premise.canonical_key());
        }
        result
    }

    pub(crate) fn estimated_bytes(&self) -> usize {
        size_of::<Self>()
            .saturating_add(self.rule_id.as_str().len())
            .saturating_add(self.rule_source.as_ref().map_or(0, |source| source.len()))
            .saturating_add(
                self.premises
                    .iter()
                    .map(estimate_fact)
                    .fold(0, usize::saturating_add),
            )
            .saturating_add(
                self.absent_premises
                    .iter()
                    .map(estimate_fact)
                    .fold(0, usize::saturating_add),
            )
    }
}

/// Deterministic provenance retained for inferred facts.
///
/// At most one canonical [`Derivation`] is stored per fact. The iterator's
/// order is unspecified; sort facts by [`Fact::canonical_key`] when a stable
/// presentation is required.
#[derive(Clone, Debug, Default)]
pub struct Provenance {
    derivations: HashMap<Fact, Derivation>,
    estimated_bytes: usize,
}

impl Provenance {
    /// Returns the retained derivation for `fact`, if one was recorded.
    pub fn derivation(&self, fact: &Fact) -> Option<&Derivation> {
        self.derivations.get(fact)
    }

    /// Returns the number of facts with retained provenance.
    pub fn len(&self) -> usize {
        self.derivations.len()
    }

    /// Returns `true` when no provenance was retained.
    pub fn is_empty(&self) -> bool {
        self.derivations.is_empty()
    }

    /// Iterates over inferred facts and their retained derivations.
    ///
    /// The iteration order is unspecified.
    pub fn iter(&self) -> impl Iterator<Item = (&Fact, &Derivation)> {
        self.derivations.iter()
    }

    pub(crate) fn estimated_bytes(&self) -> usize {
        self.estimated_bytes
    }

    pub(crate) fn projected_insert_bytes(&self, fact: &Fact, derivation: &Derivation) -> usize {
        let old = self
            .derivations
            .get(fact)
            .map_or(0, |old| provenance_entry_bytes(fact, old));
        self.estimated_bytes
            .saturating_sub(old)
            .saturating_add(provenance_entry_bytes(fact, derivation))
    }

    pub(crate) fn insert(&mut self, fact: Fact, derivation: Derivation) {
        self.estimated_bytes = self.projected_insert_bytes(&fact, &derivation);
        self.derivations.insert(fact, derivation);
    }
}

fn provenance_entry_bytes(fact: &Fact, derivation: &Derivation) -> usize {
    estimate_fact(fact)
        .saturating_add(derivation.estimated_bytes())
        .saturating_add(64)
}

fn estimate_fact(fact: &Fact) -> usize {
    64_usize
        .saturating_add(fact.relation().as_str().len())
        .saturating_add(
            fact.values()
                .iter()
                .map(|value| value.estimated_bytes().saturating_add(size_of_val(value)))
                .fold(0, usize::saturating_add),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RelationId, Value};
    use oxrdf::NamedNode;

    fn expected_fact_bytes(fact: &Fact) -> usize {
        64 + fact.relation().as_str().len()
            + fact
                .values()
                .iter()
                .map(|value| value.estimated_bytes() + size_of::<Value>())
                .sum::<usize>()
    }

    #[test]
    fn canonical_derivations_and_provenance_accounting_are_exact() {
        let premise = Fact::new(
            RelationId::new("premise").unwrap(),
            vec![Value::DefaultGraph],
        );
        let absent = Fact::new(
            RelationId::new("absent").unwrap(),
            vec![Value::Term(NamedNode::new_unchecked("urn:test:x").into())],
        );
        let derived = Fact::new(
            RelationId::new("derived").unwrap(),
            vec![Value::DefaultGraph],
        );
        let derivation = Derivation::new_with_absence(
            RuleId::new("rule").unwrap(),
            Some("source"),
            vec![premise.clone()],
            vec![absent.clone()],
        );

        assert_eq!(
            derivation.canonical_key(),
            format!(
                "rule|source|{}|!{}",
                premise.canonical_key(),
                absent.canonical_key()
            )
        );
        assert_eq!(estimate_fact(&derived), expected_fact_bytes(&derived));
        let expected_derivation_bytes = size_of::<Derivation>()
            + "rule".len()
            + "source".len()
            + expected_fact_bytes(&premise)
            + expected_fact_bytes(&absent);
        assert_eq!(derivation.estimated_bytes(), expected_derivation_bytes);
        let expected_entry = expected_fact_bytes(&derived) + expected_derivation_bytes + 64;
        assert_eq!(
            provenance_entry_bytes(&derived, &derivation),
            expected_entry
        );

        let mut provenance = Provenance::default();
        assert!(provenance.is_empty());
        assert_eq!(provenance.len(), 0);
        assert_eq!(provenance.iter().count(), 0);
        assert_eq!(provenance.estimated_bytes(), 0);
        assert_eq!(
            provenance.projected_insert_bytes(&derived, &derivation),
            expected_entry
        );

        provenance.insert(derived.clone(), derivation.clone());
        assert!(!provenance.is_empty());
        assert_eq!(provenance.len(), 1);
        assert_eq!(provenance.iter().count(), 1);
        assert_eq!(provenance.derivation(&derived), Some(&derivation));
        assert_eq!(provenance.estimated_bytes(), expected_entry);

        let replacement = Derivation::new_with_absence(
            RuleId::new("replacement").unwrap(),
            None,
            vec![premise],
            Vec::new(),
        );
        let replacement_entry = provenance_entry_bytes(&derived, &replacement);
        assert_eq!(
            provenance.projected_insert_bytes(&derived, &replacement),
            replacement_entry
        );
        provenance.insert(derived.clone(), replacement.clone());
        assert_eq!(provenance.derivation(&derived), Some(&replacement));
        assert_eq!(provenance.estimated_bytes(), replacement_entry);
    }
}
