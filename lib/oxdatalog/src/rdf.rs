//! RDF quad adapters and dataset-oriented Datalog evaluation.
//!
//! RDF quads are represented by the four-column relation identified by
//! [`QUAD_RELATION_IRI`]. The default graph uses a dedicated
//! [`Value::DefaultGraph`] sentinel, so it cannot collide with an RDF term.

use crate::{
    Atom, Engine, EvaluationError, EvaluationOptions, EvaluationResult, Fact, PatternTerm, Program,
    RelationId, Rule, Value,
};
use oxrdf::{Dataset, GraphName, NamedOrBlankNode, Quad, Term};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

/// The relation identifier used for generic four-column RDF quad facts.
pub const QUAD_RELATION_IRI: &str = "urn:oxigraph:relation:rdf-quad";
/// The profile identifier for positive recursive Datalog.
pub const D0_PROFILE: &str = "datalog-d0";
/// The profile identifier for stratified negation.
pub const D1_PROFILE: &str = "datalog-d1";
/// The profile identifier for run-once closed-dependency rules.
pub const D2_PROFILE: &str = "datalog-d2";

/// Returns the generic RDF quad relation identifier.
pub fn quad_relation() -> RelationId {
    RelationId::from_static(QUAD_RELATION_IRI)
}

/// Constructs an atom in the generic RDF quad relation.
///
/// The term order is subject, predicate, object, and graph name.
pub fn quad_atom(
    subject: PatternTerm,
    predicate: PatternTerm,
    object: PatternTerm,
    graph_name: PatternTerm,
) -> Atom {
    Atom::new(
        quad_relation(),
        vec![subject, predicate, object, graph_name],
    )
}

/// Converts an RDF quad into a ground generic-relation fact.
///
/// The RDF default graph is represented by [`Value::DefaultGraph`].
pub fn fact_from_quad(quad: Quad) -> Fact {
    Fact::new(
        quad_relation(),
        vec![
            Value::Term(quad.subject.into()),
            Value::Term(quad.predicate.into()),
            Value::Term(quad.object),
            match quad.graph_name {
                GraphName::NamedNode(node) => Value::Term(node.into()),
                GraphName::BlankNode(node) => Value::Term(node.into()),
                GraphName::DefaultGraph => Value::DefaultGraph,
            },
        ],
    )
}

/// An error converting between RDF quads and Datalog facts.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum RdfAdapterError {
    /// The fact does not use the generic RDF quad relation.
    #[error("expected relation {QUAD_RELATION_IRI}, found {0}")]
    Relation(RelationId),
    /// The fact does not have the required number of value positions.
    #[error("RDF quad facts must have arity four, found {0}")]
    Arity(usize),
    /// The subject position is not a named or blank node.
    #[error("RDF quad subject must be a named or blank node")]
    Subject,
    /// The predicate position is not a named node.
    #[error("RDF quad predicate must be a named node")]
    Predicate,
    /// The object position is not an RDF term.
    #[error("RDF quad object must be an RDF term")]
    Object,
    /// The graph-name position is not a named node, blank node, or default
    /// graph sentinel.
    #[error("RDF quad graph name must be a named node, blank node, or the default graph")]
    GraphName,
    /// Two RDF predicates map to the same internal specialized relation.
    #[error("RDF predicate relation collision for {relation}: {left} and {right}")]
    PredicateRelationCollision {
        /// The colliding internal relation identifier.
        relation: RelationId,
        /// One predicate mapped to the relation.
        left: oxrdf::NamedNode,
        /// The other predicate mapped to the relation.
        right: oxrdf::NamedNode,
    },
    /// A caller-defined relation collides with an internal specialized
    /// predicate relation.
    #[error("generated RDF predicate relation conflicts with program relation {0}")]
    ReservedPredicateRelation(RelationId),
}

/// Converts a generic RDF quad fact into an RDF quad.
///
/// The function checks the relation, arity, and RDF node-kind constraints for
/// all four positions.
pub fn quad_from_fact(fact: &Fact) -> Result<Quad, RdfAdapterError> {
    if fact.relation().as_str() != QUAD_RELATION_IRI {
        return Err(RdfAdapterError::Relation(fact.relation().clone()));
    }
    let [subject, predicate, object, graph_name] = fact.values() else {
        return Err(RdfAdapterError::Arity(fact.arity()));
    };
    let subject = match subject {
        Value::Term(Term::NamedNode(node)) => NamedOrBlankNode::NamedNode(node.clone()),
        Value::Term(Term::BlankNode(node)) => NamedOrBlankNode::BlankNode(node.clone()),
        _ => return Err(RdfAdapterError::Subject),
    };
    let predicate = match predicate {
        Value::Term(Term::NamedNode(node)) => node.clone(),
        _ => return Err(RdfAdapterError::Predicate),
    };
    let Value::Term(object) = object else {
        return Err(RdfAdapterError::Object);
    };
    let graph_name = match graph_name {
        Value::DefaultGraph => GraphName::DefaultGraph,
        Value::Term(Term::NamedNode(node)) => GraphName::NamedNode(node.clone()),
        Value::Term(Term::BlankNode(node)) => GraphName::BlankNode(node.clone()),
        Value::Term(_) => return Err(RdfAdapterError::GraphName),
    };
    Ok(Quad::new(subject, predicate, object.clone(), graph_name))
}

/// An error evaluating a Datalog program over an RDF dataset.
#[derive(Debug, thiserror::Error)]
pub enum RdfEvaluationError {
    /// Generic program validation or evaluation failed.
    #[error(transparent)]
    Evaluation(#[from] EvaluationError),
    /// Conversion between RDF quads and Datalog facts failed.
    #[error(transparent)]
    Adapter(#[from] RdfAdapterError),
}

/// The union of base and inferred RDF quads.
///
/// With the optional `spareval` feature, references to this type implement
/// `spareval::QueryableDataset`.
#[derive(Clone, Debug)]
pub struct EntailedDataset {
    union: Dataset,
}

impl EntailedDataset {
    /// Returns the union dataset.
    pub fn dataset(&self) -> &Dataset {
        &self.union
    }
}

#[cfg(feature = "spareval")]
impl<'a> spareval::QueryableDataset<'a> for &'a EntailedDataset {
    type InternalTerm = Term;
    type Error = std::convert::Infallible;

    fn internal_quads_for_pattern(
        &self,
        subject: Option<&Term>,
        predicate: Option<&Term>,
        object: Option<&Term>,
        graph_name: Option<Option<&Term>>,
    ) -> impl Iterator<Item = Result<spareval::InternalQuad<Term>, std::convert::Infallible>> + use<'a>
    {
        let dataset: &'a Dataset = &self.union;
        spareval::QueryableDataset::internal_quads_for_pattern(
            &dataset, subject, predicate, object, graph_name,
        )
    }

    fn internalize_term(&self, term: Term) -> Result<Term, std::convert::Infallible> {
        Ok(term)
    }

    fn externalize_term(&self, term: Term) -> Result<Term, std::convert::Infallible> {
        Ok(term)
    }
}

/// The RDF closure and generic evaluation details produced by [`evaluate`].
#[derive(Clone, Debug)]
pub struct RdfClosure {
    profile: &'static str,
    base: Dataset,
    inference: Dataset,
    entailed: EntailedDataset,
    evaluation: EvaluationResult,
}

/// A deterministic summary of an RDF closure evaluation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RdfReceipt {
    /// The selected Datalog profile identifier.
    pub profile: &'static str,
    /// The number of quads in the input dataset.
    pub base_quads: usize,
    /// The number of inferred quads not present in the input dataset.
    pub derived_quads: usize,
    /// The number of fixpoint iterations performed.
    pub iterations: usize,
    /// The deterministic peak working-set estimate in bytes.
    ///
    /// This value is an accounting estimate, not an allocator measurement.
    pub estimated_memory_bytes: usize,
    /// Inferred quads serialized as lexically sorted canonical N-Quads.
    pub canonical_inference_nquads: String,
}

impl RdfReceipt {
    /// Serializes the receipt as stable line-oriented text.
    pub fn canonical_text(&self) -> String {
        format!(
            "profile={}\nbase-quads={}\nderived-quads={}\niterations={}\nestimated-memory-bytes={}\n---\n{}",
            self.profile,
            self.base_quads,
            self.derived_quads,
            self.iterations,
            self.estimated_memory_bytes,
            self.canonical_inference_nquads
        )
    }
}

impl RdfClosure {
    /// Returns the selected Datalog profile identifier.
    ///
    /// Positive programs use [`D0_PROFILE`], programs with stratified negation
    /// use [`D1_PROFILE`], and programs containing a run-once rule use
    /// [`D2_PROFILE`].
    pub fn profile(&self) -> &'static str {
        self.profile
    }

    /// Returns the unchanged input dataset.
    pub fn base(&self) -> &Dataset {
        &self.base
    }

    /// Returns inferred RDF quads that were not in the input dataset.
    pub fn inference(&self) -> &Dataset {
        &self.inference
    }

    /// Returns the union of base and inferred quads.
    pub fn entailed(&self) -> &EntailedDataset {
        &self.entailed
    }

    /// Returns the underlying generic Datalog evaluation result.
    pub fn evaluation(&self) -> &EvaluationResult {
        &self.evaluation
    }

    /// Serializes inferred quads in lexically sorted canonical N-Quads form.
    ///
    /// Non-empty output is newline-terminated.
    pub fn canonical_inference_nquads(&self) -> String {
        let mut lines = self
            .inference
            .iter()
            .map(|quad| quad.to_string())
            .collect::<Vec<_>>();
        lines.sort();
        if lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines.join("\n"))
        }
    }

    /// Builds a deterministic summary of this closure.
    pub fn receipt(&self) -> RdfReceipt {
        RdfReceipt {
            profile: self.profile,
            base_quads: self.base.iter().count(),
            derived_quads: self.inference.iter().count(),
            iterations: self.evaluation.iterations(),
            estimated_memory_bytes: self.evaluation.estimated_memory_bytes(),
            canonical_inference_nquads: self.canonical_inference_nquads(),
        }
    }
}

/// Evaluates `program` over an RDF dataset and returns its materialized closure.
///
/// Evaluation is bounded by `options`. The input dataset is preserved in
/// [`RdfClosure::base`], inferred RDF quads are exposed separately, and
/// [`RdfClosure::entailed`] contains their set union. Programs whose quad atoms
/// all have fixed predicates may be compiled to predicate-specialized internal
/// relations; hash collisions are detected rather than silently conflated.
/// Derived facts outside the RDF adapter's relation space are omitted from the
/// RDF inference dataset but remain available from [`RdfClosure::evaluation`].
pub fn evaluate(
    program: &Program,
    base: &Dataset,
    options: &EvaluationOptions,
) -> Result<RdfClosure, RdfEvaluationError> {
    let prepared = PreparedRdfProgram::new(program, base)?;
    let evaluation = Engine::default().evaluate(
        &prepared.program,
        base.iter().map(|quad| prepared.fact_from_quad(quad)),
        options,
    )?;
    let mut inference = Dataset::new();
    for fact in evaluation.derived_facts() {
        if let Some(quad) = prepared.quad_from_fact(fact)? {
            inference.insert(quad);
        }
    }
    let base = base.clone();
    let mut union = base.clone();
    for quad in &inference {
        union.insert(quad);
    }
    Ok(RdfClosure {
        profile: program_profile(program),
        base,
        inference,
        entailed: EntailedDataset { union },
        evaluation,
    })
}

fn program_profile(program: &Program) -> &'static str {
    if program.rules().iter().any(Rule::is_run_once) {
        D2_PROFILE
    } else if program.rules().iter().any(|rule| !rule.is_positive()) {
        D1_PROFILE
    } else {
        D0_PROFILE
    }
}

struct PreparedRdfProgram {
    program: Program,
    predicates: BTreeMap<RelationId, oxrdf::NamedNode>,
    specialized: bool,
}

impl PreparedRdfProgram {
    fn new(program: &Program, base: &Dataset) -> Result<Self, RdfAdapterError> {
        let specialized = !program.rules().is_empty()
            && program.rules().iter().all(|rule| {
                std::iter::once(rule.head())
                    .chain(rule.body())
                    .chain(rule.negative_body())
                    .all(has_fixed_rdf_predicate)
            });
        if !specialized {
            return Ok(Self {
                program: program.clone(),
                predicates: BTreeMap::new(),
                specialized,
            });
        }
        let mut predicates = BTreeMap::new();
        let user_relations = program
            .rules()
            .iter()
            .flat_map(|rule| {
                std::iter::once(rule.head())
                    .chain(rule.body())
                    .chain(rule.negative_body())
            })
            .filter(|atom| atom.relation().as_str() != QUAD_RELATION_IRI)
            .map(|atom| atom.relation().clone())
            .collect::<std::collections::BTreeSet<_>>();
        let rules = program
            .rules()
            .iter()
            .map(|rule| compile_rule(rule, &mut predicates))
            .collect::<Result<Vec<_>, _>>()?;
        for quad in base {
            let relation = predicate_relation(quad.predicate.as_ref());
            register_predicate(&mut predicates, relation, &quad.predicate)?;
        }
        if let Some(relation) = predicates
            .keys()
            .find(|relation| user_relations.contains(*relation))
        {
            return Err(RdfAdapterError::ReservedPredicateRelation(relation.clone()));
        }
        Ok(Self {
            program: Program::new(rules),
            predicates,
            specialized,
        })
    }

    fn fact_from_quad(&self, quad: Quad) -> Fact {
        if !self.specialized {
            return fact_from_quad(quad);
        }
        Fact::new(
            predicate_relation(quad.predicate.as_ref()),
            vec![
                Value::Term(quad.subject.into()),
                Value::Term(quad.object),
                match quad.graph_name {
                    GraphName::NamedNode(node) => Value::Term(node.into()),
                    GraphName::BlankNode(node) => Value::Term(node.into()),
                    GraphName::DefaultGraph => Value::DefaultGraph,
                },
            ],
        )
    }

    fn quad_from_fact(&self, fact: &Fact) -> Result<Option<Quad>, RdfAdapterError> {
        if !self.specialized {
            return if fact.relation().as_str() == QUAD_RELATION_IRI {
                quad_from_fact(fact).map(Some)
            } else {
                Ok(None)
            };
        }
        let Some(predicate) = self.predicates.get(fact.relation()) else {
            return Ok(None);
        };
        let [subject, object, graph] = fact.values() else {
            return Err(RdfAdapterError::Arity(fact.arity()));
        };
        let generic = Fact::new(
            quad_relation(),
            vec![
                subject.clone(),
                Value::Term(predicate.clone().into()),
                object.clone(),
                graph.clone(),
            ],
        );
        quad_from_fact(&generic).map(Some)
    }
}

fn has_fixed_rdf_predicate(atom: &Atom) -> bool {
    if atom.relation().as_str() != QUAD_RELATION_IRI {
        return true;
    }
    matches!(
        atom.terms(),
        [
            _,
            PatternTerm::Constant(Value::Term(Term::NamedNode(_))),
            _,
            _
        ]
    )
}

fn compile_rule(
    rule: &Rule,
    predicates: &mut BTreeMap<RelationId, oxrdf::NamedNode>,
) -> Result<Rule, RdfAdapterError> {
    let mut compiled = Rule::new_stratified(
        rule.id().clone(),
        compile_atom(rule.head(), predicates)?,
        rule.body()
            .iter()
            .map(|atom| compile_atom(atom, predicates))
            .collect::<Result<Vec<_>, _>>()?,
        rule.negative_body()
            .iter()
            .map(|atom| compile_atom(atom, predicates))
            .collect::<Result<Vec<_>, _>>()?,
    );
    if let Some(source) = rule.source() {
        compiled = compiled.with_source(source);
    }
    if rule.is_run_once() {
        compiled = compiled.run_once();
    }
    Ok(compiled)
}

fn compile_atom(
    atom: &Atom,
    predicates: &mut BTreeMap<RelationId, oxrdf::NamedNode>,
) -> Result<Atom, RdfAdapterError> {
    if atom.relation().as_str() != QUAD_RELATION_IRI {
        return Ok(atom.clone());
    }
    let [
        subject,
        PatternTerm::Constant(Value::Term(Term::NamedNode(predicate))),
        object,
        graph,
    ] = atom.terms()
    else {
        return Ok(atom.clone());
    };
    let relation = predicate_relation(predicate.as_ref());
    register_predicate(predicates, relation.clone(), predicate)?;
    Ok(Atom::new(
        relation,
        vec![subject.clone(), object.clone(), graph.clone()],
    ))
}

fn register_predicate(
    predicates: &mut BTreeMap<RelationId, oxrdf::NamedNode>,
    relation: RelationId,
    predicate: &oxrdf::NamedNode,
) -> Result<(), RdfAdapterError> {
    match predicates.entry(relation) {
        Entry::Vacant(entry) => {
            entry.insert(predicate.clone());
            Ok(())
        }
        Entry::Occupied(entry) if entry.get() == predicate => Ok(()),
        Entry::Occupied(entry) => Err(RdfAdapterError::PredicateRelationCollision {
            relation: entry.key().clone(),
            left: entry.get().clone(),
            right: predicate.clone(),
        }),
    }
}

fn predicate_relation(predicate: oxrdf::NamedNodeRef<'_>) -> RelationId {
    let digest = hex::encode(Sha256::digest(predicate.as_str().as_bytes()));
    RelationId::from_validated(format!("urn:oxigraph:relation:rdf-predicate:{digest}"))
}

#[cfg(test)]
mod tests;
