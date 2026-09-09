#![warn(missing_docs)]

use self::control::Control;
#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
use crate::model::BlankNode;
use crate::model::vocab::rdf;
#[cfg(feature = "rdfs")]
use crate::model::vocab::rdfs;
use crate::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use crate::sparql::{CancellationToken, QueryEvaluationError};
use crate::store::StorageError;
#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
use std::collections::HashSet;
use std::fmt;
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
}

impl fmt::Debug for QueryEntailmentOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("QueryEntailmentOptions")
            .field("profile", &self.profile)
            .field("timeout", &self.timeout)
            .field("has_cancellation_token", &self.cancellation_token.is_some())
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
) -> Result<Dataset, QueryEntailmentError> {
    let mut result = control.copy(base)?;
    for graph in std::iter::once(GraphName::DefaultGraph).chain(named_graphs.iter().cloned()) {
        control.check()?;
        insert_rdf_axioms(&mut result, &graph);
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
                    result.insert(Quad::new(
                        node.clone(),
                        predicate,
                        object,
                        quad.graph_name.clone(),
                    ));
                }
            }
        }
    }
    control.check()?;
    Ok(result)
}

fn insert_rdf_axioms(dataset: &mut Dataset, graph: &GraphName) {
    for property in [
        rdf::TYPE,
        rdf::SUBJECT,
        rdf::PREDICATE,
        rdf::OBJECT,
        rdf::FIRST,
        rdf::REST,
        rdf::VALUE,
    ] {
        dataset.insert(Quad::new(property, rdf::TYPE, rdf::PROPERTY, graph.clone()));
    }
    #[cfg(feature = "rdf-12")]
    dataset.insert(Quad::new(
        rdf::REIFIES,
        rdf::TYPE,
        rdf::PROPERTY,
        graph.clone(),
    ));
    dataset.insert(Quad::new(rdf::NIL, rdf::TYPE, rdf::LIST, graph.clone()));
}

#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
fn visible_dataset(
    base: &Dataset,
    closure: &Dataset,
    control: &Control,
) -> Result<Dataset, QueryEntailmentError> {
    let base_blank_nodes = blank_nodes(base, control)?;
    let mut visible = control.copy(base)?;
    for quad in closure {
        control.check()?;
        if blank_nodes_in_quad(&quad)
            .iter()
            .all(|node| base_blank_nodes.contains(node))
        {
            visible.insert(quad);
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
