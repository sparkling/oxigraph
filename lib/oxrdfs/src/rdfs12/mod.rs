use crate::{
    RDFS_12_FINITE_PROFILE, RDFS_12_IMPLEMENTED_PATTERNS,
    rdfs12_axioms::{
        insert_container_axioms, insert_container_property_axioms, insert_static_axioms,
        is_container_membership_property,
    },
};
mod datatypes;
mod patterns;
mod terms;
#[cfg(test)]
mod tests;

pub use self::datatypes::{Rdfs12Consistency, Rdfs12Inconsistency};
use self::datatypes::{mandatory_datatypes, normalized_recognized_datatypes};
use self::terms::{reject_reserved_witness_labels, terms_in_quad};
use oxdatalog::{EvaluationError, EvaluationOptions, LimitKind, rdf::RdfEvaluationError};
use oxrdf::{
    Dataset, GraphName, NamedNode, Quad, Term,
    vocab::{rdf, rdfs},
};
use std::collections::{HashMap, HashSet};
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

/// Controls finite RDFS 1.2 active-vocabulary materialization.
#[derive(Clone, Debug)]
pub struct Rdfs12Options {
    /// Resource ceilings, cancellation, and timeout controls for evaluation.
    pub evaluation: EvaluationOptions,
    /// Datatype IRIs requested for datatype map `D`.
    ///
    /// The three mandatory RDF 1.2 datatypes are restored at evaluation time.
    /// Supported additions are `rdf:XMLLiteral`, boolean and numeric XSD types.
    pub recognized_datatypes: Vec<NamedNode>,
    /// Largest `rdf:_n` axiom generated even when it is not present in input.
    pub container_membership_limit: usize,
}

impl Default for Rdfs12Options {
    fn default() -> Self {
        Self {
            evaluation: EvaluationOptions::default(),
            recognized_datatypes: mandatory_datatypes().to_vec(),
            container_membership_limit: 16,
        }
    }
}

impl Rdfs12Options {
    /// Replaces the requested datatype map `D` for this run.
    ///
    /// Mandatory types are retained; unsupported additions fail evaluation.
    #[must_use]
    pub fn with_recognized_datatypes(
        mut self,
        datatypes: impl IntoIterator<Item = NamedNode>,
    ) -> Self {
        self.recognized_datatypes = mandatory_datatypes().to_vec();
        for datatype in datatypes {
            if !self.recognized_datatypes.contains(&datatype) {
                self.recognized_datatypes.push(datatype);
            }
        }
        self
    }
}

/// One first-derivation record in the finite closure.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rdfs12Derivation {
    rule_id: &'static str,
    premises: Box<[Quad]>,
}

impl Rdfs12Derivation {
    /// Returns the RDF 1.2 Semantics pattern that first derived the quad.
    pub const fn rule_id(&self) -> &'static str {
        self.rule_id
    }
    /// Returns the input or previously derived quads used by that first derivation.
    pub fn premises(&self) -> &[Quad] {
        &self.premises
    }
}

/// Failure while computing the bounded closure.
#[derive(Debug, thiserror::Error)]
pub enum Rdfs12Error {
    /// An input blank node could alias a deterministic existential witness.
    #[error(
        "blank node label {label} uses the reserved {prefix} reasoning-witness prefix; evaluation refused"
    )]
    ReservedWitnessLabel {
        /// The colliding blank-node label.
        label: String,
        /// The reserved deterministic-witness prefix.
        prefix: &'static str,
    },
    /// A requested datatype has no fixed lexical-to-value mapping here.
    #[error(
        "cannot recognize datatype {datatype}: its lexical-to-value mapping is not implemented"
    )]
    UnsupportedRecognizedDatatype {
        /// The requested datatype IRI.
        datatype: NamedNode,
    },
    /// The bounded evaluator rejected a resource limit or RDF adaptation step.
    #[error(transparent)]
    Evaluation(#[from] RdfEvaluationError),
}

/// Finite legal-RDF closure over the active vocabulary.
#[derive(Clone, Debug)]
pub struct Rdfs12Closure {
    base: Dataset,
    inference: Dataset,
    entailed: Dataset,
    derivations: HashMap<Quad, Rdfs12Derivation>,
    iterations: usize,
    peak_estimated_memory_bytes: usize,
    generalized_consequences_omitted: usize,
    consistency: Rdfs12Consistency,
}

impl Rdfs12Closure {
    /// Returns the unchanged input dataset.
    pub fn base(&self) -> &Dataset {
        &self.base
    }
    /// Returns only legal RDF quads derived by the finite profile.
    pub fn inference(&self) -> &Dataset {
        &self.inference
    }
    /// Returns the materialized union of base and inference datasets.
    pub fn entailed(&self) -> &Dataset {
        &self.entailed
    }
    /// Returns the first recorded derivation for `quad`, if it was inferred.
    pub fn derivation(&self, quad: &Quad) -> Option<&Rdfs12Derivation> {
        self.derivations.get(quad)
    }
    /// Returns the datatype-map satisfiability result.
    pub const fn consistency(&self) -> &Rdfs12Consistency {
        &self.consistency
    }
    /// Returns whether the input has an interpretation under the configured datatype map.
    pub const fn is_consistent(&self) -> bool {
        matches!(self.consistency, Rdfs12Consistency::Consistent)
    }
    /// Builds deterministic evidence for this closure.
    pub fn receipt(&self) -> Rdfs12Receipt {
        let mut lines = self
            .inference
            .iter()
            .map(|quad| quad.to_string())
            .collect::<Vec<_>>();
        lines.sort();
        Rdfs12Receipt {
            profile: RDFS_12_FINITE_PROFILE,
            implemented_patterns: RDFS_12_IMPLEMENTED_PATTERNS,
            base_quads: self.base.len(),
            derived_quads: self.inference.len(),
            iterations: self.iterations,
            peak_estimated_memory_bytes: self.peak_estimated_memory_bytes,
            generalized_consequences_omitted: self.generalized_consequences_omitted,
            inconsistent: !self.is_consistent(),
            canonical_inference_nquads: if lines.is_empty() {
                String::new()
            } else {
                format!("{}\n", lines.join("\n"))
            },
        }
    }
}

/// Deterministic evidence for a finite RDFS 1.2 closure.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rdfs12Receipt {
    /// Exact finite-profile identifier for this feature build.
    pub profile: &'static str,
    /// Number of applicable RDF/RDFS entailment patterns.
    pub implemented_patterns: usize,
    /// Number of quads in the unchanged input dataset.
    pub base_quads: usize,
    /// Number of legal inference-only quads.
    pub derived_quads: usize,
    /// Number of outer fixpoint iterations.
    pub iterations: usize,
    /// Peak deterministic memory estimate observed by the runtime.
    pub peak_estimated_memory_bytes: usize,
    /// Number of generalized consequences counted but not emitted as legal RDF.
    pub generalized_consequences_omitted: usize,
    /// Whether datatype reasoning found at least one inconsistency.
    pub inconsistent: bool,
    /// Sorted inference-only N-Quads, including a final newline when non-empty.
    pub canonical_inference_nquads: String,
}

impl Rdfs12Receipt {
    /// Renders a stable line-oriented representation suitable for hashing.
    pub fn canonical_text(&self) -> String {
        format!(
            "profile={}\nimplemented-patterns={}\nbase-quads={}\nderived-quads={}\n\
             iterations={}\npeak-estimated-memory-bytes={}\n\
             generalized-consequences-omitted={}\ninconsistent={}\n---\n{}",
            self.profile,
            self.implemented_patterns,
            self.base_quads,
            self.derived_quads,
            self.iterations,
            self.peak_estimated_memory_bytes,
            self.generalized_consequences_omitted,
            self.inconsistent,
            self.canonical_inference_nquads
        )
    }
}

/// Bounded implementation of the applicable RDF 1.2 RDFS entailment patterns.
///
/// All fifteen patterns are available with `rdf-12`. An RDF 1.2 Basic build
/// has fourteen applicable patterns because its terms cannot represent the
/// `rdfs14` triple-term antecedent.
#[derive(Clone, Copy, Debug, Default)]
pub struct Rdfs12Finite;

impl Rdfs12Finite {
    /// Returns the feature-sensitive finite-profile identifier.
    pub const fn profile_id() -> &'static str {
        RDFS_12_FINITE_PROFILE
    }
    #[expect(
        clippy::unused_self,
        reason = "the unit profile value intentionally provides a uniform evaluator API"
    )]
    /// Computes the bounded finite closure for `base`.
    ///
    /// The input is never mutated. Evaluation fails before returning a partial
    /// result when an input boundary or configured resource ceiling is crossed.
    pub fn evaluate(
        self,
        base: &Dataset,
        options: &Rdfs12Options,
    ) -> Result<Rdfs12Closure, Rdfs12Error> {
        Runtime::new(base, options)?.run()
    }
}

struct Runtime<'a> {
    base: Dataset,
    all: Dataset,
    options: &'a Rdfs12Options,
    recognized_datatypes: Vec<NamedNode>,
    started: Instant,
    derivations: HashMap<Quad, Rdfs12Derivation>,
    iterations: usize,
    intermediate_rows: usize,
    peak_memory: usize,
    generalized_omitted: HashSet<GeneralizedQuad>,
}

impl<'a> Runtime<'a> {
    fn new(base: &Dataset, options: &'a Rdfs12Options) -> Result<Self, Rdfs12Error> {
        let mut runtime = Self {
            base: Dataset::new(),
            all: Dataset::new(),
            options,
            recognized_datatypes: Vec::new(),
            started: Instant::now(),
            derivations: HashMap::new(),
            iterations: 0,
            intermediate_rows: 0,
            peak_memory: 0,
            generalized_omitted: HashSet::new(),
        };
        runtime.check()?;
        reject_reserved_witness_labels(base, || runtime.check())?;
        runtime.recognized_datatypes =
            normalized_recognized_datatypes(&options.recognized_datatypes, || runtime.check())?;
        runtime.base = runtime.copy_dataset(base)?;
        runtime.all = runtime.copy_dataset(base)?;
        runtime.observe_memory()?;
        Ok(runtime)
    }
    /// Checks raw candidates before callers filter them, including empty input.
    fn collect<T>(&self, items: impl IntoIterator<Item = T>) -> Result<Vec<T>, Rdfs12Error> {
        self.check()?;
        let mut result = Vec::new();
        for item in items {
            self.check()?;
            result.push(item);
        }
        self.check()?;
        Ok(result)
    }
    fn copy_dataset(&self, source: &Dataset) -> Result<Dataset, Rdfs12Error> {
        self.check()?;
        let mut result = Dataset::new();
        for quad in source {
            self.check()?;
            result.insert(quad);
        }
        for graph in source.named_graphs() {
            self.check()?;
            result.insert_named_graph(graph);
        }
        self.check()?;
        Ok(result)
    }
    fn run(mut self) -> Result<Rdfs12Closure, Rdfs12Error> {
        self.seed()?;
        loop {
            self.check()?;
            if self.iterations >= self.options.evaluation.limits.max_iterations {
                return Err(limit(
                    LimitKind::Iterations,
                    self.options.evaluation.limits.max_iterations,
                ));
            }
            self.iterations += 1;
            let before = self.all.len();
            self.apply_patterns()?;
            if self.all.len() == before {
                break;
            }
        }
        let inference = self.inference()?;
        let consistency = self.detect_datatype_inconsistency()?;
        self.check()?;
        Ok(Rdfs12Closure {
            base: self.base,
            inference,
            entailed: self.all,
            derivations: self.derivations,
            iterations: self.iterations,
            peak_estimated_memory_bytes: self.peak_memory,
            generalized_consequences_omitted: self.generalized_omitted.len(),
            consistency,
        })
    }
    fn inference(&self) -> Result<Dataset, Rdfs12Error> {
        self.check()?;
        let mut inference = Dataset::new();
        for quad in &self.all {
            self.check()?;
            if !self.base.contains(&quad) {
                inference.insert(quad);
            }
        }
        self.check()?;
        Ok(inference)
    }
    fn seed(&mut self) -> Result<(), Rdfs12Error> {
        self.check()?;
        let mut graphs = HashSet::new();
        for quad in &self.all {
            self.check()?;
            graphs.insert(quad.graph_name);
        }
        for graph in self.all.named_graphs() {
            self.check()?;
            graphs.insert(GraphName::from(graph));
        }
        graphs.insert(GraphName::DefaultGraph);
        let mut active_containers = HashMap::<GraphName, HashSet<NamedNode>>::new();
        for quad in &self.base {
            self.check()?;
            for term in terms_in_quad(&quad) {
                self.check()?;
                if let Term::NamedNode(node) = term
                    && is_container_membership_property(&node)
                {
                    active_containers
                        .entry(quad.graph_name.clone())
                        .or_default()
                        .insert(node);
                }
            }
        }
        for graph in graphs {
            self.check()?;
            let mut axioms = Dataset::new();
            insert_static_axioms(&mut axioms, &graph);
            insert_container_axioms(
                &mut axioms,
                &graph,
                self.options.container_membership_limit,
                || self.check(),
            )?;
            if let Some(properties) = active_containers.get(&graph) {
                for property in properties {
                    self.check()?;
                    insert_container_property_axioms(&mut axioms, &graph, property);
                }
            }
            for quad in &axioms {
                self.insert(quad, "rdfs-axiom", &[])?;
            }
            for index in 0..self.recognized_datatypes.len() {
                self.check()?;
                let datatype = self.recognized_datatypes[index].clone();
                self.insert(
                    Quad::new(datatype.clone(), rdf::TYPE, rdfs::DATATYPE, graph.clone()),
                    "rdfs1",
                    &[],
                )?;
                let witness = Self::witness("rdfD1a", &graph, datatype.as_str());
                self.insert(
                    Quad::new(witness, rdf::TYPE, datatype, graph.clone()),
                    "rdfD1a",
                    &[],
                )?;
            }
            let witness = Self::witness("rdfs14a", &graph, "universal");
            self.insert(
                Quad::new(witness, rdf::TYPE, rdfs::PROPOSITION, graph),
                "rdfs14a",
                &[],
            )?;
        }
        self.check()
    }
    fn insert(
        &mut self,
        quad: Quad,
        rule_id: &'static str,
        premises: &[Quad],
    ) -> Result<(), Rdfs12Error> {
        self.check()?;
        if self.all.contains(&quad) {
            return Ok(());
        }
        if self.all.len() >= self.options.evaluation.limits.max_facts {
            return Err(limit(
                LimitKind::Facts,
                self.options.evaluation.limits.max_facts,
            ));
        }
        self.all.insert(quad.clone());
        if self.options.evaluation.track_provenance {
            self.derivations.insert(
                quad,
                Rdfs12Derivation {
                    rule_id,
                    premises: premises.to_vec().into_boxed_slice(),
                },
            );
        }
        self.observe_memory()
    }
    fn touch(&mut self) -> Result<(), Rdfs12Error> {
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
    fn observe_memory(&mut self) -> Result<(), Rdfs12Error> {
        self.check()?;
        let mut facts = 0;
        for quad in &self.all {
            self.check()?;
            facts += 160_usize.saturating_add(quad.to_string().len());
        }
        let mut generalized = 0;
        for quad in &self.generalized_omitted {
            self.check()?;
            generalized += 160_usize.saturating_add(quad.estimated_len());
        }
        let estimate = facts
            .saturating_add(self.derivations.len().saturating_mul(192))
            .saturating_add(generalized);
        self.check()?;
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
    fn check(&self) -> Result<(), Rdfs12Error> {
        if self.options.evaluation.cancellation_token.is_cancelled() {
            return Err(eval(EvaluationError::Cancelled));
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
    fn omit_generalized(
        &mut self,
        subject: Term,
        predicate: Term,
        object: Term,
        graph_name: GraphName,
    ) -> Result<(), Rdfs12Error> {
        self.check()?;
        if self.generalized_omitted.insert(GeneralizedQuad {
            subject,
            predicate,
            object,
            graph_name,
        }) {
            self.observe_memory()?;
        }
        Ok(())
    }
}

fn subject_term(quad: &Quad) -> Term {
    Term::from(quad.subject.clone())
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct GeneralizedQuad {
    subject: Term,
    predicate: Term,
    object: Term,
    graph_name: GraphName,
}

impl GeneralizedQuad {
    fn estimated_len(&self) -> usize {
        self.subject
            .to_string()
            .len()
            .saturating_add(self.predicate.to_string().len())
            .saturating_add(self.object.to_string().len())
            .saturating_add(self.graph_name.to_string().len())
    }
}

fn limit(kind: LimitKind, limit: usize) -> Rdfs12Error {
    eval(EvaluationError::LimitExceeded { kind, limit })
}

fn eval(error: EvaluationError) -> Rdfs12Error {
    RdfEvaluationError::Evaluation(error).into()
}
