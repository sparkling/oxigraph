//! Bounded RDFS rule profiles backed by Datalog.
//!
//! [`RdfsD0`] compiles eleven named patterns from the
//! [RDF 1.2 Semantics Candidate Recommendation][semantics] to
//! [`oxdatalog`]. The profile evaluates each dataset graph independently,
//! preserves RDF 1.2 triple terms in supported rule positions, and exposes a
//! queryable base-plus-inference view.
//!
//! [`Rdfs12Finite`] adds the complete fifteen-pattern rule inventory over a
//! finite active vocabulary when the `rdf-12` feature is enabled, bounded
//! container axioms, recognized-datatype consistency, and deterministic
//! existential witnesses. Without `rdf-12`, its explicitly basic profile has
//! fourteen applicable patterns because triple-term rule `rdfs14` cannot be
//! represented.
//!
//! Neither profile claims an unrestricted RDFS 1.2 entailment regime. RDFS has
//! infinite axiomatic families and generalized consequences that cannot all be
//! materialized as a finite legal-RDF dataset; the exact bounded profile and
//! limits therefore remain part of every result.
//!
//! [semantics]: https://www.w3.org/TR/2026/CR-rdf12-semantics-20260407/
#![warn(missing_docs)]
#![doc(test(attr(deny(warnings))))]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc(html_favicon_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]
#![doc(html_logo_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]

mod profile;
mod rdfs12;
mod rdfs12_axioms;
mod rules;

pub use crate::profile::{
    RdfsD0, RdfsD0Closure, RdfsD0ConformanceError, RdfsD0Error, RdfsD0InputError, RdfsD0Receipt,
};
pub use crate::rdfs12::{
    Rdfs12Closure, Rdfs12Consistency, Rdfs12Derivation, Rdfs12Error, Rdfs12Finite,
    Rdfs12Inconsistency, Rdfs12Options, Rdfs12Receipt,
};
pub use crate::rules::{IMPLEMENTED_RULES, OMITTED_PATTERNS, RdfsRule};

/// The exact profile identifier implemented by this crate.
pub const RDFS_D0_PROFILE: &str = "rdfs-d0";

/// A full-profile identifier exposed only for typed claim rejection.
pub const RDFS_12_ENTAILMENT_PROFILE: &str = "rdfs-1.2-entailment";

/// `rdfs-d0` does not materialize the RDF or RDFS axiomatic triples.
pub const INCLUDES_AXIOMATIC_TRIPLES: bool = false;

/// Finite, active-vocabulary RDFS 1.2 materialization profile.
///
/// RDFS has infinite axiomatic families and existential/generalized
/// consequences. This profile materializes all legal RDF consequences of the
/// fifteen published patterns over the active vocabulary, including a bounded
/// prefix of `rdf:_n` axioms and deterministic witnesses for `rdfs14`.
#[cfg(feature = "rdf-12")]
pub const RDFS_12_FINITE_PROFILE: &str = "rdfs-1.2-finite-active-vocabulary";

/// Finite profile for RDF 1.2 Basic inputs without triple terms.
#[cfg(not(feature = "rdf-12"))]
pub const RDFS_12_FINITE_PROFILE: &str = "rdfs-1.2-basic-finite-active-vocabulary";

/// Number of applicable RDFS entailment patterns in this build.
#[cfg(feature = "rdf-12")]
pub const RDFS_12_IMPLEMENTED_PATTERNS: usize = 15;

/// Number of applicable RDFS entailment patterns in an RDF 1.2 Basic build.
#[cfg(not(feature = "rdf-12"))]
pub const RDFS_12_IMPLEMENTED_PATTERNS: usize = 14;
