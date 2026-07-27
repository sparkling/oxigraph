use crate::{
    OWL2_RL_RDF_PROFILE,
    full_rules::{DATALOG_RULE_IDS, OWL2_RL_RDF_RULES, SPECIALIZED_RULE_IDS},
    vocabulary::{BUILT_IN_ANNOTATION_PROPERTIES, CLASS, NOTHING, THING},
};
use oxdatalog::{EvaluationError, EvaluationOptions, LimitKind, rdf::RdfEvaluationError};
use oxrdf::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term, vocab::rdf};
use std::collections::{HashMap, HashSet};
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

mod classes;
mod consistency;
mod control;
mod datalog;
mod datatypes;
mod equality;
mod lists;
mod properties;
mod schema;
mod semantic_witnesses;
mod semantics;

pub use self::datatypes::{OWL2_RL_DATATYPES, Owl2RlDatatypeMode};

/// Bounded execution and datatype policy for the complete rule inventory.
#[derive(Clone, Debug)]
pub struct Owl2RlRdfOptions {
    /// Resource ceilings, cancellation, and timeout controls for evaluation.
    pub evaluation: EvaluationOptions,
    /// Maximum number of RDF collection cells traversed for one list.
    pub max_list_length: usize,
    /// Policy for literals whose datatype is outside the OWL 2 RL map.
    pub datatype_mode: Owl2RlDatatypeMode,
}

impl Default for Owl2RlRdfOptions {
    fn default() -> Self {
        Self {
            evaluation: EvaluationOptions::default(),
            max_list_length: 10_000,
            datatype_mode: Owl2RlDatatypeMode::Strict,
        }
    }
}

/// A malformed RDF encoding needed by an OWL 2 RL/RDF rule.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum Owl2RlRdfInputError {
    /// A required RDF collection is cyclic, branching, or incomplete.
    #[error("RDF list {head} in graph {graph_name} is cyclic, branching, or incomplete")]
    MalformedList {
        /// Head term of the malformed collection.
        head: Term,
        /// Dataset graph containing the collection.
        graph_name: GraphName,
    },
    /// A required RDF collection exceeds the configured traversal bound.
    #[error("RDF list {head} exceeds the configured length limit of {limit}")]
    ListLength {
        /// Head term of the overlong collection.
        head: Term,
        /// Configured maximum collection length.
        limit: usize,
    },
    /// Strict datatype mode encountered a literal outside the supported map.
    #[error("literal datatype {datatype} is outside the OWL 2 RL datatype map")]
    UnsupportedDatatype {
        /// Unsupported datatype IRI.
        datatype: NamedNode,
    },
}

/// Failure while validating or evaluating the OWL 2 RL/RDF rule set.
#[derive(Debug, thiserror::Error)]
pub enum Owl2RlRdfError {
    /// The input falls outside a configured bounded-processing policy.
    #[error(transparent)]
    Input(#[from] Owl2RlRdfInputError),
    /// A resource limit or RDF Datalog adaptation step failed.
    #[error(transparent)]
    Evaluation(#[from] RdfEvaluationError),
}

/// One first-derivation record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Owl2RlDerivation {
    rule_id: &'static str,
    premises: Box<[Quad]>,
    execution_path: Owl2RlExecutionPath,
}

impl Owl2RlDerivation {
    /// Returns the OWL 2 RL/RDF rule that first derived the quad.
    pub const fn rule_id(&self) -> &'static str {
        self.rule_id
    }

    /// Returns the input or previously derived quads used by that first derivation.
    pub fn premises(&self) -> &[Quad] {
        &self.premises
    }

    /// The executor that established this first derivation.
    pub const fn execution_path(&self) -> Owl2RlExecutionPath {
        self.execution_path
    }
}

/// Execution boundary used by an OWL 2 RL/RDF rule.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Owl2RlExecutionPath {
    /// A positive fixed-arity rule evaluated by [`oxdatalog`].
    Datalog,
    /// A bounded operator for RDF lists, datatypes, keys, or inconsistency.
    Specialized,
}

/// A concrete derivation of the OWL rule conclusion `false`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Owl2RlContradiction {
    rule_id: &'static str,
    evidence: Box<[Quad]>,
}

impl Owl2RlContradiction {
    /// Returns the rule whose conclusion is `false`.
    pub const fn rule_id(&self) -> &'static str {
        self.rule_id
    }

    /// Returns the quads that witness the contradiction.
    pub fn evidence(&self) -> &[Quad] {
        &self.evidence
    }
}

/// Consistency result after rule closure.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Owl2RlConsistency {
    /// No OWL 2 RL/RDF contradiction was derived.
    Consistent,
    /// One or more rule conclusions of `false` were derived.
    Inconsistent(Box<[Owl2RlContradiction]>),
}

/// Generalized OWL rule fact that cannot be represented as a legal RDF quad.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Owl2RlGeneralizedTriple {
    /// Dataset graph in which the generalized fact holds.
    pub graph_name: GraphName,
    /// Generalized subject term.
    pub subject: Term,
    /// Generalized predicate term, which might not be an RDF IRI.
    pub predicate: Term,
    /// Generalized object term.
    pub object: Term,
}

/// Opaque closure produced by [`Owl2RlRdf`].
#[derive(Clone, Debug)]
pub struct Owl2RlRdfClosure {
    base: Dataset,
    inference: Dataset,
    entailed: Dataset,
    equality_facts: Box<[(GraphName, Term, Term)]>,
    generalized_facts: Box<[Owl2RlGeneralizedTriple]>,
    derivations: HashMap<Quad, Owl2RlDerivation>,
    consistency: Owl2RlConsistency,
    iterations: usize,
    peak_estimated_memory_bytes: usize,
    datalog_executions: usize,
    datalog_iterations: usize,
}

impl Owl2RlRdfClosure {
    /// Returns the unchanged input dataset.
    pub fn base(&self) -> &Dataset {
        &self.base
    }

    /// Returns only legal RDF quads derived by the rule engine.
    pub fn inference(&self) -> &Dataset {
        &self.inference
    }

    /// Returns the materialized union of base and legal RDF inference datasets.
    pub fn entailed(&self) -> &Dataset {
        &self.entailed
    }

    /// Returns the first recorded derivation for `quad`, if it was inferred.
    pub fn derivation(&self, quad: &Quad) -> Option<&Owl2RlDerivation> {
        self.derivations.get(quad)
    }

    /// Returns the rule-consistency result.
    pub fn consistency(&self) -> &Owl2RlConsistency {
        &self.consistency
    }

    /// Includes generalized equality facts whose left side is a literal.
    pub fn equality_facts(&self) -> &[(GraphName, Term, Term)] {
        &self.equality_facts
    }

    /// Returns generalized rule facts that cannot be emitted as legal RDF quads.
    pub fn generalized_facts(&self) -> &[Owl2RlGeneralizedTriple] {
        &self.generalized_facts
    }

    /// Builds deterministic evidence for this closure.
    pub fn receipt(&self) -> Owl2RlRdfReceipt {
        let mut lines = self
            .inference
            .iter()
            .map(|quad| quad.to_string())
            .collect::<Vec<_>>();
        lines.sort();
        Owl2RlRdfReceipt {
            profile: OWL2_RL_RDF_PROFILE,
            rule_count: OWL2_RL_RDF_RULES.len(),
            datalog_rule_count: DATALOG_RULE_IDS.len(),
            specialized_rule_count: SPECIALIZED_RULE_IDS.len(),
            base_quads: self.base.len(),
            derived_quads: self.inference.len(),
            generalized_equalities: self.equality_facts.len(),
            contradictions: match &self.consistency {
                Owl2RlConsistency::Consistent => 0,
                Owl2RlConsistency::Inconsistent(items) => items.len(),
            },
            iterations: self.iterations,
            datalog_executions: self.datalog_executions,
            datalog_iterations: self.datalog_iterations,
            peak_estimated_memory_bytes: self.peak_estimated_memory_bytes,
            canonical_inference_nquads: if lines.is_empty() {
                String::new()
            } else {
                format!("{}\n", lines.join("\n"))
            },
        }
    }
}

/// Deterministic rule-execution evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Owl2RlRdfReceipt {
    /// Exact bounded OWL 2 RL/RDF profile identifier.
    pub profile: &'static str,
    /// Number of named rules in the complete public inventory.
    pub rule_count: usize,
    /// Number of named rule cores executed through Datalog.
    pub datalog_rule_count: usize,
    /// Number of named rules implemented by specialized bounded operators.
    pub specialized_rule_count: usize,
    /// Number of quads in the unchanged input dataset.
    pub base_quads: usize,
    /// Number of legal inference-only quads.
    pub derived_quads: usize,
    /// Number of generalized equality facts, including literal-left equalities.
    pub generalized_equalities: usize,
    /// Number of distinct recorded rule contradictions.
    pub contradictions: usize,
    /// Number of outer rule-family fixpoint iterations.
    pub iterations: usize,
    /// Number of executions of the compiled Datalog core.
    pub datalog_executions: usize,
    /// Sum of the inner Datalog fixpoint iterations.
    pub datalog_iterations: usize,
    /// Peak deterministic memory estimate observed by the runtime.
    pub peak_estimated_memory_bytes: usize,
    /// Sorted legal inference-only N-Quads, with a final newline when non-empty.
    pub canonical_inference_nquads: String,
}

impl Owl2RlRdfReceipt {
    /// Renders a stable line-oriented representation suitable for hashing.
    pub fn canonical_text(&self) -> String {
        format!(
            "profile={}\nrules={}\ndatalog-rules={}\nspecialized-rules={}\n\
             base-quads={}\nderived-quads={}\n\
             generalized-equalities={}\ncontradictions={}\niterations={}\n\
             datalog-executions={}\ndatalog-iterations={}\n\
             peak-estimated-memory-bytes={}\n---\n{}",
            self.profile,
            self.rule_count,
            self.datalog_rule_count,
            self.specialized_rule_count,
            self.base_quads,
            self.derived_quads,
            self.generalized_equalities,
            self.contradictions,
            self.iterations,
            self.datalog_executions,
            self.datalog_iterations,
            self.peak_estimated_memory_bytes,
            self.canonical_inference_nquads
        )
    }
}

/// Bounded OWL 2 RL/RDF rules engine.
#[derive(Clone, Copy, Debug, Default)]
pub struct Owl2RlRdf;

impl Owl2RlRdf {
    /// Returns the exact bounded profile identifier.
    pub const fn profile_id() -> &'static str {
        OWL2_RL_RDF_PROFILE
    }

    /// Returns metadata for all 78 named OWL 2 RL/RDF rules.
    pub const fn implemented_rules() -> &'static [crate::Owl2RlRule] {
        OWL2_RL_RDF_RULES
    }

    #[expect(
        clippy::unused_self,
        reason = "the unit profile value intentionally provides a uniform evaluator API"
    )]
    /// Computes the bounded OWL 2 RL/RDF closure for `base`.
    ///
    /// The input is never mutated. Evaluation fails before returning a partial
    /// result when input validation or a configured resource ceiling fails.
    pub fn evaluate(
        self,
        base: &Dataset,
        options: &Owl2RlRdfOptions,
    ) -> Result<Owl2RlRdfClosure, Owl2RlRdfError> {
        Runtime::new(base, options)?.run()
    }
}

pub(super) struct Runtime<'a> {
    base: Dataset,
    all: Dataset,
    equalities: HashSet<(GraphName, Term, Term)>,
    generalized: HashSet<Owl2RlGeneralizedTriple>,
    derivations: HashMap<Quad, Owl2RlDerivation>,
    contradictions: Vec<Owl2RlContradiction>,
    options: &'a Owl2RlRdfOptions,
    started: Instant,
    iterations: usize,
    intermediate_rows: usize,
    peak_memory: usize,
    datalog_program: oxdatalog::Program,
    datalog_executions: usize,
    datalog_iterations: usize,
}

impl<'a> Runtime<'a> {
    fn new(base: &Dataset, options: &'a Owl2RlRdfOptions) -> Result<Self, Owl2RlRdfError> {
        let mut runtime = Self {
            base: base.clone(),
            all: base.clone(),
            equalities: HashSet::new(),
            generalized: HashSet::new(),
            derivations: HashMap::new(),
            contradictions: Vec::new(),
            options,
            started: Instant::now(),
            iterations: 0,
            intermediate_rows: 0,
            peak_memory: 0,
            datalog_program: datalog::program(),
            datalog_executions: 0,
            datalog_iterations: 0,
        };
        runtime.validate_datatypes()?;
        runtime.observe_memory()?;
        Ok(runtime)
    }

    fn run(mut self) -> Result<Owl2RlRdfClosure, Owl2RlRdfError> {
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
            let before = (self.all.len(), self.equalities.len());
            self.apply_equality()?;
            self.apply_datalog_core()?;
            self.apply_properties()?;
            self.apply_classes()?;
            self.apply_schema()?;
            self.apply_datatypes()?;
            self.apply_rdf_based_semantics()?;
            if before == (self.all.len(), self.equalities.len()) {
                break;
            }
        }
        self.detect_contradictions()?;
        let mut inference = Dataset::new();
        for quad in &self.all {
            if !self.base.contains(&quad) {
                inference.insert(quad);
            }
        }
        let mut equality_facts = self.equalities.into_iter().collect::<Vec<_>>();
        equality_facts.sort_by_key(|(graph, left, right)| format!("{graph}|{left}|{right}"));
        let consistency = if self.contradictions.is_empty() {
            Owl2RlConsistency::Consistent
        } else {
            Owl2RlConsistency::Inconsistent(self.contradictions.into_boxed_slice())
        };
        let mut generalized_facts = self.generalized.into_iter().collect::<Vec<_>>();
        generalized_facts.sort_by_key(|fact| {
            format!(
                "{}|{}|{}|{}",
                fact.graph_name, fact.subject, fact.predicate, fact.object
            )
        });
        Ok(Owl2RlRdfClosure {
            base: self.base,
            inference,
            entailed: self.all,
            equality_facts: equality_facts.into_boxed_slice(),
            generalized_facts: generalized_facts.into_boxed_slice(),
            derivations: self.derivations,
            consistency,
            iterations: self.iterations,
            peak_estimated_memory_bytes: self.peak_memory,
            datalog_executions: self.datalog_executions,
            datalog_iterations: self.datalog_iterations,
        })
    }

    fn seed(&mut self) -> Result<(), Owl2RlRdfError> {
        let mut graphs = self
            .all
            .iter()
            .map(|quad| quad.graph_name.clone())
            .collect::<HashSet<_>>();
        graphs.extend(self.all.named_graphs().map(GraphName::from));
        graphs.insert(GraphName::DefaultGraph);
        for graph in graphs {
            for (subject, object, rule) in [
                (THING.clone(), CLASS.clone(), "cls-thing"),
                (NOTHING.clone(), CLASS.clone(), "cls-nothing1"),
            ] {
                self.insert(
                    Quad::new(subject, rdf::TYPE, object, graph.clone()),
                    rule,
                    &[],
                )?;
            }
            for property in BUILT_IN_ANNOTATION_PROPERTIES {
                self.insert(
                    Quad::new(
                        property.clone(),
                        rdf::TYPE,
                        crate::vocabulary::ANNOTATION_PROPERTY,
                        graph.clone(),
                    ),
                    "prp-ap",
                    &[],
                )?;
            }
            self.seed_datatypes(&graph)?;
        }
        Ok(())
    }
}

pub(super) fn term_resource(term: &Term) -> Option<NamedOrBlankNode> {
    match term {
        Term::NamedNode(node) => Some(node.clone().into()),
        Term::BlankNode(node) => Some(node.clone().into()),
        Term::Literal(_) => None,
        #[cfg(feature = "rdf-12")]
        Term::Triple(_) => None,
    }
}

pub(super) fn subject_term(quad: &Quad) -> Term {
    Term::from(quad.subject.clone())
}

pub(super) fn limit(kind: LimitKind, limit: usize) -> Owl2RlRdfError {
    eval(EvaluationError::LimitExceeded { kind, limit })
}

fn eval(error: EvaluationError) -> Owl2RlRdfError {
    RdfEvaluationError::Evaluation(error).into()
}
