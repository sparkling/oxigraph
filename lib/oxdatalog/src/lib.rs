//! A bounded, storage-independent Datalog engine for RDF inference.
#![warn(missing_docs)]
#![doc(test(attr(deny(warnings))))]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc(html_favicon_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]
#![doc(html_logo_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]

mod engine;
mod ir;
mod provenance;
pub mod rdf;
mod validate;

pub use crate::engine::{
    CancellationToken, Engine, EvaluationError, EvaluationLimits, EvaluationOptions,
    EvaluationResult, LimitKind,
};
pub use crate::ir::{
    Atom, BlankNodeGenerator, Fact, IdentifierError, PatternTerm, Program, RelationId, Rule,
    RuleId, Value, Variable,
};
pub use crate::provenance::{Derivation, Provenance};
pub use crate::validate::{
    DependencyGraph, ValidatedProgram, ValidationError, ValidationLimits, validate,
};
