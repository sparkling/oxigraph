#![warn(missing_docs)]

use self::control::Control;
#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
use crate::model::BlankNode;
use crate::model::vocab::rdf;
#[cfg(feature = "rdfs")]
use crate::model::vocab::rdfs;
use crate::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use crate::sparql::{CancellationToken, QueryEvaluationError};
use crate::store::{SnapshotItem, StorageError};
#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
use std::collections::HashSet;
use std::fmt;
use std::num::NonZeroUsize;
use std::time::Duration;

mod control;
mod dataset;
pub use dataset::QueryEntailmentDataset;

/// Query-time semantic profile.
///
/// `Simple` is standard SPARQL simple entailment. The other variants are
/// deliberately named bounded materialization profiles: they expose only
/// sound, legal-RDF consequences produced by the configured finite engines
/// and do not claim complete SPARQL entailment-regime evaluation. In
/// particular, generated existential witnesses are not exposed as query
/// bindings. Prepared queries construct `FROM`/`FROM NAMED` datasets before
/// materialization: merged default-graph sources share consequences, while
/// named graphs remain graph-local.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
#[non_exhaustive]
pub enum QueryEntailment {
    /// Standard SPARQL simple entailment with no materialized consequences.
    #[default]
    Simple,
    /// Finite RDF 1.2 active-vocabulary consequences.
    Rdf12Finite,
    /// Fifteen-pattern finite RDFS 1.2 active-vocabulary consequences.
    Rdfs12Finite,
    /// The bounded OWL 2 RL/RDF rule profile.
    Owl2RlRdfBounded,
}

impl QueryEntailment {
    /// Returns the Oxigraph identifier for the bounded profile.
    ///
    /// Simple entailment has no separate bounded-profile identifier.
    pub const fn profile_iri(self) -> Option<&'static str> {
        match self {
            Self::Simple => None,
            Self::Rdf12Finite => {
                Some("https://oxigraph.org/ns/entailment-profile/rdf-1.2-finite-active-vocabulary")
            }
            Self::Rdfs12Finite => {
                Some("https://oxigraph.org/ns/entailment-profile/rdfs-1.2-finite-active-vocabulary")
            }
            Self::Owl2RlRdfBounded => {
                Some("https://oxigraph.org/ns/entailment-profile/owl2-rl-rdf-bounded")
            }
        }
    }

    /// IRI advertised as the active service-description regime.
    ///
    /// Bounded profiles use Oxigraph IRIs so the W3C regime IRIs are not
    /// accidentally presented as full conformance claims.
    pub const fn regime_iri(self) -> &'static str {
        match self {
            Self::Simple => "http://www.w3.org/ns/entailment/Simple",
            Self::Rdf12Finite => "https://oxigraph.org/ns/entailment/RDF12FiniteActiveVocabulary",
            Self::Rdfs12Finite => "https://oxigraph.org/ns/entailment/RDFS12FiniteActiveVocabulary",
            Self::Owl2RlRdfBounded => "https://oxigraph.org/ns/entailment/OWL2RLRDFBounded",
        }
    }

    /// Standard semantic relation underlying a bounded profile.
    pub const fn underlying_regime_iri(self) -> &'static str {
        match self {
            Self::Simple => "http://www.w3.org/ns/entailment/Simple",
            Self::Rdf12Finite => "http://www.w3.org/ns/entailment/RDF",
            Self::Rdfs12Finite => "http://www.w3.org/ns/entailment/RDFS",
            Self::Owl2RlRdfBounded => "http://www.w3.org/ns/entailment/OWL-RDF-Based",
        }
    }

    /// Returns the identifier for the datatype policy used by the profile.
    pub const fn datatype_policy_iri(self) -> Option<&'static str> {
        match self {
            Self::Simple => None,
            Self::Rdf12Finite | Self::Rdfs12Finite => {
                Some("https://oxigraph.org/ns/entailment/datatype-map/rdf-required")
            }
            Self::Owl2RlRdfBounded => {
                Some("https://oxigraph.org/ns/entailment/datatype-map/owl2-rl-strict")
            }
        }
    }

    /// Returns the finite datatype map recognized by this profile.
    pub fn recognized_datatypes(self) -> Vec<NamedNode> {
        match self {
            Self::Simple => Vec::new(),
            Self::Rdf12Finite | Self::Rdfs12Finite => rdf_required_datatypes(),
            Self::Owl2RlRdfBounded => {
                #[cfg(feature = "owl2-rl")]
                {
                    let mut datatypes = crate::owl2_rl::OWL2_RL_DATATYPES.to_vec();
                    datatypes.extend(rdf_required_datatypes());
                    datatypes.sort();
                    datatypes.dedup();
                    datatypes
                }
                #[cfg(not(feature = "owl2-rl"))]
                {
                    Vec::new()
                }
            }
        }
    }

    /// Reports whether the current feature set can execute this profile.
    pub const fn is_supported(self) -> bool {
        match self {
            Self::Simple => true,
            Self::Rdf12Finite => cfg!(feature = "rdf-12"),
            Self::Rdfs12Finite => cfg!(all(feature = "rdf-12", feature = "rdfs")),
            Self::Owl2RlRdfBounded => cfg!(feature = "owl2-rl"),
        }
    }

    /// Fails before query execution if this profile is unavailable.
    pub fn ensure_supported(self) -> Result<(), QueryEntailmentError> {
        if self.is_supported() {
            Ok(())
        } else {
            Err(QueryEntailmentError::UnsupportedProfile {
                profile: self,
                required_features: match self {
                    Self::Simple => "",
                    Self::Rdf12Finite => "rdf-12",
                    Self::Rdfs12Finite => "rdf-12,rdfs",
                    Self::Owl2RlRdfBounded => "owl2-rl",
                },
            })
        }
    }
}

impl fmt::Display for QueryEntailment {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Simple => "simple",
            Self::Rdf12Finite => "rdf-1.2-finite",
            Self::Rdfs12Finite => "rdfs-1.2-finite",
            Self::Owl2RlRdfBounded => "owl2-rl-rdf-bounded",
        })
    }
}

#[derive(Clone, Default)]
/// Options controlling bounded query-time entailment materialization.
pub struct QueryEntailmentOptions {
    profile: QueryEntailment,
    timeout: Option<Duration>,
    cancellation_token: Option<CancellationToken>,
    limits: Limits,
}

impl fmt::Debug for QueryEntailmentOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("QueryEntailmentOptions")
            .field("profile", &self.profile)
            .field("timeout", &self.timeout)
            .field("has_cancellation_token", &self.cancellation_token.is_some())
            .field("max_materialized_quads", &self.limits.quads)
            .field("max_estimated_materialization_bytes", &self.limits.bytes)
            .finish()
    }
}

impl QueryEntailmentOptions {
    /// Creates options for the selected profile with no time limit.
    pub const fn new(profile: QueryEntailment) -> Self {
        Self {
            profile,
            timeout: None,
            cancellation_token: None,
            limits: Limits {
                quads: None,
                bytes: None,
            },
        }
    }

    /// Returns the selected entailment profile.
    pub const fn profile(&self) -> QueryEntailment {
        self.profile
    }

    #[must_use]
    /// Sets the cooperative time budget, starting before snapshot copying and
    /// shared by dataset construction and inference. Once materialization
    /// succeeds, only explicit cancellation tokens and their deadlines remain.
    pub const fn with_timeout(mut self, timeout: Option<Duration>) -> Self {
        self.timeout = timeout;
        self
    }

    /// Shares caller cancellation and its absolute deadline with materialization.
    /// Prepared queries also observe their evaluator's token automatically.
    #[must_use]
    pub fn with_cancellation_token(mut self, token: CancellationToken) -> Self {
        self.cancellation_token = Some(token);
        self
    }

    /// Sets an opt-in logical quad ceiling for finite RDFS materialization.
    ///
    /// Only [`QueryEntailment::Rdfs12Finite`] enforces ceilings. Any other
    /// profile fails with [`QueryEntailmentError::UnsupportedLimits`] instead of
    /// ignoring them. `None`, the default, keeps the existing behaviour.
    ///
    /// The ceiling is checked before each wrapper-owned copy grows:
    ///
    /// - `snapshot`: quads plus named-graph declarations copied from the Store.
    ///   The Store copies its complete contents before `FROM`/`FROM NAMED`
    ///   selection. Each decoded record is admitted before the Store inserts
    ///   it into the owned snapshot, so the accumulated snapshot never exceeds
    ///   the ceiling; only the refused record has already been decoded;
    /// - `source`: quads of the effective query dataset;
    /// - `working`: source plus RDF and container-membership axioms, including
    ///   the axioms generated for empty named graphs;
    /// - inference: the engine fact ceiling is lowered to this value;
    /// - `visible`: base plus exposed inferred quads.
    ///
    /// Wrapper stages fail with [`QueryEntailmentError::LimitExceeded`]. Engine
    /// exhaustion keeps its original `QueryEntailmentError::Rdfs` error. The
    /// ceiling only tightens the engine's built-in fact bound; it never raises it.
    #[must_use]
    pub const fn with_max_materialized_quads(mut self, max: Option<NonZeroUsize>) -> Self {
        self.limits.quads = max;
        self
    }

    /// Sets an opt-in ceiling on the deterministic logical memory estimate of
    /// finite RDFS materialization.
    ///
    /// Each quad is charged 160 bytes plus its N-Quads display length, the
    /// estimate the RDFS engine itself uses, counted without formatting into a
    /// buffer. Store snapshot named-graph declarations are charged 160 bytes
    /// plus their display length, so empty graphs with huge names are bounded
    /// too. The Store snapshot admits each decoded quad and named-graph
    /// declaration before inserting it into the owned snapshot (`snapshot`),
    /// so an oversized snapshot is refused without being fully materialized.
    /// The source, working and visible datasets are each charged before this
    /// wrapper grows them, and the engine memory ceiling is lowered to this
    /// value.
    ///
    /// For one snapshot record, cancellation and deadlines are checked first,
    /// then the quad ceiling, then this ceiling.
    ///
    /// Only this logical estimate is bounded. The refused record has already
    /// been decoded; storage read buffers, decoder allocations, allocator
    /// overhead, indexes and process RSS are neither measured nor bounded.
    /// Stages are bounded individually, not in sum. Several copies coexist
    /// during materialization, so peak logical usage is a small multiple of the
    /// ceiling. Profile support and error reporting follow
    /// [`Self::with_max_materialized_quads`].
    #[must_use]
    pub const fn with_max_estimated_materialization_bytes(
        mut self,
        max: Option<NonZeroUsize>,
    ) -> Self {
        self.limits.bytes = max;
        self
    }

    /// Returns the configured quad ceiling, if any.
    pub const fn max_materialized_quads(&self) -> Option<NonZeroUsize> {
        self.limits.quads
    }

    /// Returns the configured logical memory-estimate ceiling, if any.
    pub const fn max_estimated_materialization_bytes(&self) -> Option<NonZeroUsize> {
        self.limits.bytes
    }

    /// Fails before query execution if the profile is unavailable or cannot
    /// enforce the configured ceilings.
    pub fn ensure_supported(&self) -> Result<(), QueryEntailmentError> {
        self.profile.ensure_supported()?;
        if self.limits.is_unbounded() || self.profile == QueryEntailment::Rdfs12Finite {
            Ok(())
        } else {
            Err(QueryEntailmentError::UnsupportedLimits {
                profile: self.profile,
            })
        }
    }
}

#[derive(Debug, thiserror::Error)]
/// Failure while preparing a query-time entailment dataset.
pub enum QueryEntailmentError {
    /// Cancellation or deadline expiry while preparing or reading the dataset.
    #[error(transparent)]
    Evaluation(#[from] QueryEvaluationError),
    /// Reading the Store snapshot failed.
    #[error(transparent)]
    Storage(#[from] StorageError),
    /// The selected profile is unavailable in the current feature set.
    #[error(
        "query entailment profile {profile} is unavailable; rebuild with feature(s) {required_features}"
    )]
    UnsupportedProfile {
        /// The requested bounded profile.
        profile: QueryEntailment,
        /// Comma-separated Cargo features required by the profile.
        required_features: &'static str,
    },
    /// Materialization ceilings were configured for a profile that does not
    /// enforce them; the request fails instead of ignoring them.
    #[error(
        "query entailment profile {profile} does not enforce materialization ceilings; only rdfs-1.2-finite does"
    )]
    UnsupportedLimits {
        /// The profile selected together with the ceilings.
        profile: QueryEntailment,
    },
    /// A configured materialization ceiling would have been exceeded by a
    /// wrapper-owned copy. Engine exhaustion keeps its own error.
    #[error(
        "query entailment {limit} ceiling {ceiling} exceeded while building the {stage} dataset"
    )]
    LimitExceeded {
        /// `"quad"` or `"estimated-byte"`.
        limit: &'static str,
        /// `"snapshot"`, `"source"`, `"working"` or `"visible"`.
        stage: &'static str,
        /// The configured ceiling.
        ceiling: usize,
    },
    /// An input blank node collides with the engine's reserved witness space.
    #[error(
        "blank node label {label} uses the reserved {prefix} reasoning-witness prefix; evaluation refused"
    )]
    ReservedWitnessLabel {
        /// The colliding blank-node label.
        label: String,
        /// The reserved engine-specific prefix.
        prefix: &'static str,
    },
    /// Finite RDF materialization found an inconsistent required literal.
    #[error("RDF bounded materialization found {reasons} inconsistency reason(s)")]
    RdfInconsistent {
        /// Number of independently observed inconsistency reasons.
        reasons: usize,
    },
    #[cfg(feature = "rdfs")]
    /// Finite RDFS materialization failed.
    #[error(transparent)]
    Rdfs(#[from] crate::rdfs::Rdfs12Error),
    #[cfg(feature = "rdfs")]
    /// Finite RDFS materialization completed with inconsistencies.
    #[error("RDFS bounded materialization found {reasons} inconsistency reason(s)")]
    RdfsInconsistent {
        /// Number of independently observed inconsistency reasons.
        reasons: usize,
    },
    #[cfg(feature = "owl2-rl")]
    /// OWL 2 RL/RDF materialization failed.
    #[error(transparent)]
    Owl2Rl(#[from] crate::owl2_rl::Owl2RlRdfError),
    #[cfg(feature = "owl2-rl")]
    /// OWL 2 RL/RDF materialization completed with contradictions.
    #[error("OWL 2 RL/RDF bounded materialization found {contradictions} contradiction(s)")]
    Owl2RlInconsistent {
        /// Number of independently observed contradictions.
        contradictions: usize,
    },
}

const QUAD_LIMIT: &str = "quad";
const BYTE_LIMIT: &str = "estimated-byte";
const SNAPSHOT_STAGE: &str = "snapshot";
const SOURCE_STAGE: &str = "source";
#[cfg(feature = "rdfs")]
const WORKING_STAGE: &str = "working";
#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
const VISIBLE_STAGE: &str = "visible";

/// Opt-in logical materialization ceilings; both unset by default.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct Limits {
    quads: Option<NonZeroUsize>,
    bytes: Option<NonZeroUsize>,
}

impl Limits {
    const fn is_unbounded(self) -> bool {
        self.quads.is_none() && self.bytes.is_none()
    }
}

/// Pre-insertion accounting for one wrapper-owned dataset copy. Unbounded
/// budgets insert exactly as the unbudgeted code did.
#[derive(Clone, Copy, Debug)]
struct Budget {
    limits: Limits,
    stage: &'static str,
    bytes: usize,
}

impl Budget {
    const fn new(limits: Limits, stage: &'static str) -> Self {
        Self {
            limits,
            stage,
            bytes: 0,
        }
    }

    /// Charges an already-owned dataset before anything is copied from it.
    #[cfg(feature = "rdfs")]
    fn starting_with(
        limits: Limits,
        stage: &'static str,
        dataset: &Dataset,
        control: &Control,
    ) -> Result<Self, QueryEntailmentError> {
        let mut budget = Self::new(limits, stage);
        budget.check_len(dataset.len())?;
        if limits.bytes.is_some() {
            for quad in dataset {
                control.check()?;
                budget.charge(&quad)?;
            }
        }
        Ok(budget)
    }

    /// Continues charging a superset of the accounted dataset under a new stage.
    #[cfg(feature = "rdfs")]
    const fn at_stage(self, stage: &'static str) -> Self {
        Self { stage, ..self }
    }

    fn exceeded(&self, limit: &'static str, ceiling: NonZeroUsize) -> QueryEntailmentError {
        QueryEntailmentError::LimitExceeded {
            limit,
            stage: self.stage,
            ceiling: ceiling.get(),
        }
    }

    fn check_len(&self, len: usize) -> Result<(), QueryEntailmentError> {
        match self.limits.quads {
            Some(max) if len > max.get() => Err(self.exceeded(QUAD_LIMIT, max)),
            _ => Ok(()),
        }
    }

    fn charge(&mut self, quad: &Quad) -> Result<(), QueryEntailmentError> {
        if self.limits.bytes.is_some() {
            self.charge_bytes(estimated_quad_bytes(quad))?;
        }
        Ok(())
    }

    fn charge_bytes(&mut self, bytes: usize) -> Result<(), QueryEntailmentError> {
        if let Some(max) = self.limits.bytes {
            let total = self.bytes.saturating_add(bytes);
            if total > max.get() {
                return Err(self.exceeded(BYTE_LIMIT, max));
            }
            self.bytes = total;
        }
        Ok(())
    }

    /// Inserts `quad` only if the grown dataset stays within both ceilings.
    fn insert(&mut self, target: &mut Dataset, quad: Quad) -> Result<(), QueryEntailmentError> {
        if !self.limits.is_unbounded() {
            if target.contains(&quad) {
                return Ok(());
            }
            self.check_len(target.len().saturating_add(1))?;
            self.charge(&quad)?;
        }
        target.insert(quad);
        Ok(())
    }
}

/// Admits each decoded Store snapshot record before the Store inserts it into
/// the owned snapshot. Quads and named-graph declarations both count against
/// the quad ceiling and are both charged estimated bytes; the count is checked
/// before the bytes of the same record. Store records are distinct, so the
/// admitted count equals the final snapshot count.
struct SnapshotAdmission {
    budget: Budget,
    records: usize,
}

impl SnapshotAdmission {
    const fn new(limits: Limits) -> Self {
        Self {
            budget: Budget::new(limits, SNAPSHOT_STAGE),
            records: 0,
        }
    }

    fn admit(&mut self, item: &SnapshotItem<'_>) -> Result<(), QueryEntailmentError> {
        let records = self.records.saturating_add(1);
        self.budget.check_len(records)?;
        if self.budget.limits.bytes.is_some() {
            self.budget.charge_bytes(match item {
                SnapshotItem::Quad(quad) => estimated_quad_bytes(quad),
                SnapshotItem::NamedGraph(graph) => estimated_named_graph_bytes(graph),
            })?;
        }
        self.records = records;
        Ok(())
    }
}

struct ByteCount(usize);

impl fmt::Write for ByteCount {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.0 = self.0.saturating_add(s.len());
        Ok(())
    }
}

/// 160 bytes plus the display length, counted without allocating the rendered
/// string.
fn estimated_display_bytes(value: &dyn fmt::Display) -> usize {
    let mut count = ByteCount(0);
    if fmt::write(&mut count, format_args!("{value}")).is_err() {
        return usize::MAX;
    }
    160_usize.saturating_add(count.0)
}

/// The finite RDFS engine's per-quad estimate: 160 bytes plus the N-Quads
/// display length.
fn estimated_quad_bytes(quad: &Quad) -> usize {
    estimated_display_bytes(quad)
}

/// A named-graph declaration costs 160 bytes plus its term display length.
fn estimated_named_graph_bytes(graph: &NamedOrBlankNode) -> usize {
    estimated_display_bytes(graph)
}

fn rdf_required_datatypes() -> Vec<NamedNode> {
    let datatypes = [rdf::LANG_STRING, crate::model::vocab::xsd::STRING];
    #[cfg(feature = "rdf-12")]
    {
        datatypes
            .into_iter()
            .chain([rdf::DIR_LANG_STRING])
            .collect()
    }
    #[cfg(not(feature = "rdf-12"))]
    {
        datatypes.into()
    }
}

fn rdf12_finite(
    base: &Dataset,
    named_graphs: &[GraphName],
    control: &Control,
) -> Result<Dataset, QueryEntailmentError> {
    let mut reasons = 0;
    for quad in base {
        control.check()?;
        reasons += usize::from(has_ill_typed_required_literal(&quad.object));
    }
    if reasons != 0 {
        return Err(QueryEntailmentError::RdfInconsistent { reasons });
    }
    let mut result = control.copy(base)?;
    for graph in std::iter::once(GraphName::DefaultGraph).chain(named_graphs.iter().cloned()) {
        control.check()?;
        insert_rdf_axioms(&mut result, &graph);
    }
    for quad in base {
        control.check()?;
        for predicate in predicates_in_quad(&quad) {
            result.insert(Quad::new(
                predicate,
                rdf::TYPE,
                rdf::PROPERTY,
                quad.graph_name.clone(),
            ));
        }
        for node in named_nodes_in_quad(&quad) {
            if is_container_membership_property(&node) {
                result.insert(Quad::new(
                    node,
                    rdf::TYPE,
                    rdf::PROPERTY,
                    quad.graph_name.clone(),
                ));
            }
        }
    }
    control.check()?;
    Ok(result)
}

#[cfg(feature = "rdfs")]
fn rdfs_working_dataset(
    base: &Dataset,
    named_graphs: &[GraphName],
    control: &Control,
    mut budget: Budget,
) -> Result<Dataset, QueryEntailmentError> {
    let mut result = control.copy(base)?;
    for graph in std::iter::once(GraphName::DefaultGraph).chain(named_graphs.iter().cloned()) {
        control.check()?;
        for axiom in rdf_axioms(&graph) {
            budget.insert(&mut result, axiom)?;
        }
    }
    for quad in base {
        control.check()?;
        for node in named_nodes_in_quad(&quad) {
            if is_container_membership_property(&node) {
                for (predicate, object) in [
                    (rdf::TYPE, rdfs::CONTAINER_MEMBERSHIP_PROPERTY),
                    (rdfs::DOMAIN, rdfs::RESOURCE),
                    (rdfs::RANGE, rdfs::RESOURCE),
                ] {
                    budget.insert(
                        &mut result,
                        Quad::new(node.clone(), predicate, object, quad.graph_name.clone()),
                    )?;
                }
            }
        }
    }
    control.check()?;
    Ok(result)
}

fn rdf_axioms(graph: &GraphName) -> Vec<Quad> {
    let mut axioms = [
        rdf::TYPE,
        rdf::SUBJECT,
        rdf::PREDICATE,
        rdf::OBJECT,
        rdf::FIRST,
        rdf::REST,
        rdf::VALUE,
    ]
    .into_iter()
    .map(|property| Quad::new(property, rdf::TYPE, rdf::PROPERTY, graph.clone()))
    .collect::<Vec<_>>();
    #[cfg(feature = "rdf-12")]
    axioms.push(Quad::new(
        rdf::REIFIES,
        rdf::TYPE,
        rdf::PROPERTY,
        graph.clone(),
    ));
    axioms.push(Quad::new(rdf::NIL, rdf::TYPE, rdf::LIST, graph.clone()));
    axioms
}

fn insert_rdf_axioms(dataset: &mut Dataset, graph: &GraphName) {
    for axiom in rdf_axioms(graph) {
        dataset.insert(axiom);
    }
}

#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
fn visible_dataset(
    base: &Dataset,
    closure: &Dataset,
    control: &Control,
    mut budget: Budget,
) -> Result<Dataset, QueryEntailmentError> {
    let base_blank_nodes = blank_nodes(base, control)?;
    let mut visible = control.copy(base)?;
    for quad in closure {
        control.check()?;
        if blank_nodes_in_quad(&quad)
            .iter()
            .all(|node| base_blank_nodes.contains(node))
        {
            budget.insert(&mut visible, quad)?;
        }
    }
    control.check()?;
    Ok(visible)
}

#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
fn reject_reserved_witnesses(
    dataset: &Dataset,
    prefix: &'static str,
    control: &Control,
) -> Result<(), QueryEntailmentError> {
    for node in blank_nodes(dataset, control)? {
        control.check()?;
        if node.as_str().starts_with(prefix) {
            return Err(QueryEntailmentError::ReservedWitnessLabel {
                label: node.as_str().to_owned(),
                prefix,
            });
        }
    }
    control.check()
}

#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
fn blank_nodes(
    dataset: &Dataset,
    control: &Control,
) -> Result<HashSet<BlankNode>, QueryEntailmentError> {
    let mut nodes = HashSet::new();
    for quad in dataset {
        control.check()?;
        nodes.extend(blank_nodes_in_quad(&quad));
    }
    for graph_name in dataset.named_graphs() {
        control.check()?;
        if let NamedOrBlankNode::BlankNode(node) = graph_name {
            nodes.insert(node);
        }
    }
    control.check()?;
    Ok(nodes)
}

#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
fn blank_nodes_in_quad(quad: &Quad) -> Vec<BlankNode> {
    let mut nodes = Vec::new();
    if let NamedOrBlankNode::BlankNode(node) = &quad.subject {
        nodes.push(node.clone());
    }
    collect_term_blank_nodes(&quad.object, &mut nodes);
    if let GraphName::BlankNode(node) = &quad.graph_name {
        nodes.push(node.clone());
    }
    nodes
}

#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
fn collect_term_blank_nodes(term: &Term, output: &mut Vec<BlankNode>) {
    match term {
        Term::BlankNode(node) => output.push(node.clone()),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => {
            if let NamedOrBlankNode::BlankNode(node) = &triple.subject {
                output.push(node.clone());
            }
            collect_term_blank_nodes(&triple.object, output);
        }
        Term::NamedNode(_) | Term::Literal(_) => {}
    }
}

fn named_nodes_in_quad(quad: &Quad) -> Vec<NamedNode> {
    let mut nodes = vec![quad.predicate.clone()];
    if let NamedOrBlankNode::NamedNode(node) = &quad.subject {
        nodes.push(node.clone());
    }
    collect_term_named_nodes(&quad.object, &mut nodes);
    nodes
}

fn collect_term_named_nodes(term: &Term, output: &mut Vec<NamedNode>) {
    match term {
        Term::NamedNode(node) => output.push(node.clone()),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => {
            if let NamedOrBlankNode::NamedNode(node) = &triple.subject {
                output.push(node.clone());
            }
            output.push(triple.predicate.clone());
            collect_term_named_nodes(&triple.object, output);
        }
        Term::BlankNode(_) | Term::Literal(_) => {}
    }
}

fn predicates_in_quad(quad: &Quad) -> Vec<NamedNode> {
    let mut predicates = vec![quad.predicate.clone()];
    collect_term_predicates(&quad.object, &mut predicates);
    predicates
}

#[cfg(feature = "rdf-12")]
fn collect_term_predicates(term: &Term, output: &mut Vec<NamedNode>) {
    if let Term::Triple(triple) = term {
        output.push(triple.predicate.clone());
        collect_term_predicates(&triple.object, output);
    }
}

#[cfg(not(feature = "rdf-12"))]
fn collect_term_predicates(_term: &Term, _output: &mut Vec<NamedNode>) {}

fn has_ill_typed_required_literal(term: &Term) -> bool {
    match term {
        Term::Literal(literal) if literal.datatype() == &crate::model::vocab::xsd::STRING => {
            !literal.value().chars().all(|character| {
                matches!(
                    u32::from(character),
                    0x1..=0xD7FF | 0xE000..=0xFFFD | 0x10000..=0x10_FFFF
                )
            })
        }
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => has_ill_typed_required_literal(&triple.object),
        Term::NamedNode(_) | Term::BlankNode(_) | Term::Literal(_) => false,
    }
}

fn is_container_membership_property(node: &NamedNode) -> bool {
    let Some(index) = node
        .as_str()
        .strip_prefix("http://www.w3.org/1999/02/22-rdf-syntax-ns#_")
    else {
        return false;
    };
    !index.is_empty() && !index.starts_with('0') && index.bytes().all(|byte| byte.is_ascii_digit())
}

fn term_graph_name(term: &Term) -> Option<GraphName> {
    match term {
        Term::NamedNode(node) => Some(node.clone().into()),
        Term::BlankNode(node) => Some(node.clone().into()),
        Term::Literal(_) => None,
        #[cfg(feature = "rdf-12")]
        Term::Triple(_) => None,
    }
}
