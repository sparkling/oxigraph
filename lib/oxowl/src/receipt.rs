use crate::{IMPLEMENTED_RULES, OWL2_RL_RDF_POSITIVE_SEED_PROFILE, Owl2RlSeedClosure};

/// Canonical evidence for one successful positive-seed evaluation.
///
/// This receipt deliberately carries the partial seed profile identifier. It
/// cannot be constructed as a full `owl2-rl-rdf` conformance receipt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Owl2RlSeedReceipt {
    profile: &'static str,
    implemented_rule_ids: Box<[&'static str]>,
    base_quads: usize,
    derived_quads: usize,
    iterations: usize,
    estimated_memory_bytes: usize,
    canonical_inference_nquads: String,
}

impl Owl2RlSeedReceipt {
    pub(crate) fn from_closure(closure: &Owl2RlSeedClosure) -> Self {
        Self {
            profile: OWL2_RL_RDF_POSITIVE_SEED_PROFILE,
            implemented_rule_ids: IMPLEMENTED_RULES.iter().map(|rule| rule.id()).collect(),
            base_quads: closure.base().iter().count(),
            derived_quads: closure.inference().iter().count(),
            iterations: closure.evaluation().iterations(),
            estimated_memory_bytes: closure.evaluation().estimated_memory_bytes(),
            canonical_inference_nquads: closure.canonical_inference_nquads(),
        }
    }

    /// The exact, deliberately partial profile represented by this receipt.
    pub const fn profile(&self) -> &'static str {
        self.profile
    }

    /// Stable W3C rule identifiers compiled by the seed.
    pub fn implemented_rule_ids(&self) -> impl ExactSizeIterator<Item = &'static str> {
        self.implemented_rule_ids.iter().copied()
    }

    /// Returns the number of quads in the unchanged input dataset.
    pub const fn base_quads(&self) -> usize {
        self.base_quads
    }

    /// Returns the number of inference-only quads.
    pub const fn derived_quads(&self) -> usize {
        self.derived_quads
    }

    /// Returns the number of evaluator fixpoint iterations.
    pub const fn iterations(&self) -> usize {
        self.iterations
    }

    /// Returns the evaluator-reported memory estimate in bytes.
    pub const fn estimated_memory_bytes(&self) -> usize {
        self.estimated_memory_bytes
    }

    /// Returns sorted inference-only N-Quads text.
    pub fn canonical_inference_nquads(&self) -> &str {
        &self.canonical_inference_nquads
    }

    /// Stable, line-oriented form suitable for hashing in native evidence.
    pub fn canonical_text(&self) -> String {
        let rule_ids = self.implemented_rule_ids().collect::<Vec<_>>().join(",");
        format!(
            "profile={}\nimplemented-rules={rule_ids}\nbase-quads={}\n\
             derived-quads={}\niterations={}\nestimated-memory-bytes={}\n---\n{}",
            self.profile(),
            self.base_quads,
            self.derived_quads,
            self.iterations,
            self.estimated_memory_bytes,
            self.canonical_inference_nquads
        )
    }
}
