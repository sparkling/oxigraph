//! Bounded OWL 2 RL/RDF reasoning backed by Datalog.
//!
//! [`Owl2RlRdf`] implements the complete named
//! [OWL 2 RL/RDF rule inventory](https://www.w3.org/TR/2012/REC-owl2-profiles-20121211/#Reasoning_in_OWL_2_RL_and_RDF_Graphs_using_Rules).
//! Fixed-arity positive cores run in [`oxdatalog`]; bounded operators cover
//! equality, RDF lists, keys, datatypes, contradictions, and RDF-based
//! existential witnesses. [`Owl2RlPositiveSeed`] remains available as a
//! deliberately narrow compatibility profile.
#![warn(missing_docs)]
#![doc(test(attr(deny(warnings))))]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc(html_favicon_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]
#![doc(html_logo_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]

mod full;
mod full_rules;
mod profile;
mod receipt;
mod rules;
mod vocabulary;

pub use crate::full::{
    OWL2_RL_DATATYPES, Owl2RlConsistency, Owl2RlContradiction, Owl2RlDatatypeMode,
    Owl2RlDerivation, Owl2RlExecutionPath, Owl2RlGeneralizedTriple, Owl2RlRdf, Owl2RlRdfClosure,
    Owl2RlRdfError, Owl2RlRdfInputError, Owl2RlRdfOptions, Owl2RlRdfReceipt,
};
pub use crate::full_rules::{DATALOG_RULE_IDS, OWL2_RL_RDF_RULES, SPECIALIZED_RULE_IDS};
pub use crate::profile::{
    Owl2RlConformanceError, Owl2RlPositiveSeed, Owl2RlSeedClosure, Owl2RlSeedError,
    Owl2RlSeedInputError,
};
pub use crate::receipt::Owl2RlSeedReceipt;
pub use crate::rules::{IMPLEMENTED_RULES, Owl2RlRule};

/// Deliberately narrow compatibility profile retained for callers that need
/// only the original positive rule seed.
pub const OWL2_RL_RDF_POSITIVE_SEED_PROFILE: &str = "owl2-rl-rdf-positive-seed";

/// Backwards-compatible name for [`OWL2_RL_RDF_POSITIVE_SEED_PROFILE`].
pub const OWL2_RL_RDF_PREVIEW_PROFILE: &str = OWL2_RL_RDF_POSITIVE_SEED_PROFILE;

/// The bounded OWL 2 RL/RDF rule-engine profile implemented by [`Owl2RlRdf`].
pub const OWL2_RL_RDF_PROFILE: &str = "owl2-rl-rdf";
