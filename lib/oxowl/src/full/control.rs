#![expect(
    clippy::multiple_inherent_impl,
    reason = "the bounded runtime is split by rule family"
)]

use super::{
    Owl2RlContradiction, Owl2RlDerivation, Owl2RlExecutionPath, Owl2RlGeneralizedTriple,
    Owl2RlRdfError, Runtime, limit, term_resource,
};
use crate::vocabulary::SAME_AS;
use oxdatalog::{EvaluationError, LimitKind, rdf::RdfEvaluationError};
use oxrdf::{Dataset, GraphName, NamedNode, Quad, Term};
use std::collections::BTreeMap;

impl Runtime<'_> {
    pub(super) fn checked_collect<T>(
        &self,
        items: impl IntoIterator<Item = T>,
    ) -> Result<Vec<T>, Owl2RlRdfError> {
        self.check()?;
        let mut result = Vec::new();
        for item in items {
            self.check()?;
            result.push(item);
        }
        self.check()?;
        Ok(result)
    }

    pub(super) fn checked_find<T>(
        &self,
        items: impl IntoIterator<Item = T>,
        mut predicate: impl FnMut(&T) -> bool,
    ) -> Result<Option<T>, Owl2RlRdfError> {
        self.check()?;
        for item in items {
            self.check()?;
            if predicate(&item) {
                self.check()?;
                return Ok(Some(item));
            }
        }
        self.check()?;
        Ok(None)
    }

    pub(super) fn checked_any<T>(
        &self,
        items: impl IntoIterator<Item = T>,
        predicate: impl FnMut(&T) -> bool,
    ) -> Result<bool, Owl2RlRdfError> {
        Ok(self.checked_find(items, predicate)?.is_some())
    }

    // Equivalent stable key order to sort_by_key, with fallible checkpoints
    // between tree operations; no panic-based early exit from a comparator.
    pub(super) fn checked_sort_by_key<T, K: Ord>(
        &self,
        items: impl IntoIterator<Item = T>,
        mut key: impl FnMut(&T) -> K,
    ) -> Result<Vec<T>, Owl2RlRdfError> {
        self.check()?;
        let mut groups = BTreeMap::<K, Vec<T>>::new();
        for item in items {
            self.check()?;
            groups.entry(key(&item)).or_default().push(item);
        }
        let mut result = Vec::new();
        for group in groups.into_values() {
            for item in group {
                self.check()?;
                result.push(item);
            }
        }
        self.check()?;
        Ok(result)
    }

    pub(super) fn copy_dataset(&self, source: &Dataset) -> Result<Dataset, Owl2RlRdfError> {
        source.try_clone_with(|| self.check())
    }

    pub(super) fn insert(
        &mut self,
        quad: Quad,
        rule_id: &'static str,
        premises: &[Quad],
    ) -> Result<bool, Owl2RlRdfError> {
        self.insert_with_path(quad, rule_id, premises, Owl2RlExecutionPath::Specialized)
    }

    pub(super) fn insert_with_path(
        &mut self,
        quad: Quad,
        rule_id: &'static str,
        premises: &[Quad],
        execution_path: Owl2RlExecutionPath,
    ) -> Result<bool, Owl2RlRdfError> {
        self.check()?;
        if self.all.contains(&quad) {
            return Ok(false);
        }
        if self.all.len() >= self.options.evaluation.limits.max_facts {
            return Err(limit(
                LimitKind::Facts,
                self.options.evaluation.limits.max_facts,
            ));
        }
        self.all.insert(quad.clone());
        if self.options.evaluation.track_provenance {
            let premises = self
                .checked_collect(premises.iter().cloned())?
                .into_boxed_slice();
            self.derivations.insert(
                quad,
                Owl2RlDerivation {
                    rule_id,
                    premises,
                    execution_path,
                },
            );
        }
        self.observe_memory()?;
        Ok(true)
    }

    pub(super) fn add_equality(
        &mut self,
        graph: &GraphName,
        left: Term,
        right: Term,
        rule_id: &'static str,
        premises: &[Quad],
    ) -> Result<bool, Owl2RlRdfError> {
        self.check()?;
        let subject = term_resource(&left);
        let added = self
            .equalities
            .insert((graph.clone(), left.clone(), right.clone()));
        self.generalized.insert(Owl2RlGeneralizedTriple {
            graph_name: graph.clone(),
            subject: left,
            predicate: SAME_AS.into(),
            object: right.clone(),
        });
        if let Some(subject) = subject {
            self.insert(
                Quad::new(subject, SAME_AS, right, graph.clone()),
                rule_id,
                premises,
            )?;
        }
        self.observe_memory()?;
        Ok(added)
    }

    pub(super) fn is_equal(&self, graph: &GraphName, left: &Term, right: &Term) -> bool {
        left == right
            || self
                .equalities
                .contains(&(graph.clone(), left.clone(), right.clone()))
    }

    pub(super) fn add_generalized(
        &mut self,
        graph: &GraphName,
        subject: Term,
        predicate: NamedNode,
        object: Term,
    ) -> Result<bool, Owl2RlRdfError> {
        self.check()?;
        let added = self.generalized.insert(Owl2RlGeneralizedTriple {
            graph_name: graph.clone(),
            subject,
            predicate: predicate.into(),
            object,
        });
        self.observe_memory()?;
        Ok(added)
    }

    pub(super) fn touch(&mut self) -> Result<(), Owl2RlRdfError> {
        self.intermediate_rows = self.intermediate_rows.saturating_add(1);
        if self.intermediate_rows > self.options.evaluation.limits.max_intermediate_rows {
            Err(limit(
                LimitKind::IntermediateRows,
                self.options.evaluation.limits.max_intermediate_rows,
            ))
        } else {
            self.check()
        }
    }

    pub(super) fn check(&self) -> Result<(), Owl2RlRdfError> {
        if self.options.evaluation.cancellation_token.is_cancelled() {
            return Err(RdfEvaluationError::Evaluation(EvaluationError::Cancelled).into());
        }
        if let Some(timeout) = self.options.evaluation.limits.timeout
            && self.started.elapsed() >= timeout
        {
            return Err(limit(
                LimitKind::Time,
                timeout.as_millis().try_into().unwrap_or(usize::MAX),
            ));
        }
        Ok(())
    }

    pub(super) fn observe_memory(&mut self) -> Result<(), Owl2RlRdfError> {
        let estimate = self.runtime_memory_estimate()?;
        self.peak_memory = self.peak_memory.max(estimate);
        if estimate > self.options.evaluation.limits.max_memory_bytes {
            Err(limit(
                LimitKind::Memory,
                self.options.evaluation.limits.max_memory_bytes,
            ))
        } else {
            Ok(())
        }
    }

    pub(super) fn runtime_memory_estimate(&self) -> Result<usize, Owl2RlRdfError> {
        self.check()?;
        let mut facts = 0;
        for quad in &self.all {
            self.check()?;
            facts += 160_usize.saturating_add(quad.to_string().len());
        }
        self.check()?;
        Ok(facts
            .saturating_add(self.equalities.len().saturating_mul(192))
            .saturating_add(self.generalized.len().saturating_mul(192))
            .saturating_add(self.derivations.len().saturating_mul(192)))
    }

    pub(super) fn contradiction(
        &mut self,
        rule_id: &'static str,
        evidence: &[Quad],
    ) -> Result<(), Owl2RlRdfError> {
        if !self.checked_any(self.contradictions.iter(), |item| {
            item.rule_id == rule_id && item.evidence.as_ref() == evidence
        })? {
            let evidence = self
                .checked_collect(evidence.iter().cloned())?
                .into_boxed_slice();
            self.contradictions
                .push(Owl2RlContradiction { rule_id, evidence });
        }
        self.check()
    }
}
