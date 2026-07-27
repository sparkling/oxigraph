//! Bounded, store-neutral SHACL 1.2 validation and rule execution.
//!
//! The W3C SHACL 1.2 specifications are evolving Working Drafts. This crate
//! therefore exposes dated, feature-set profiles and rejects requests for
//! complete conformance. A successful receipt only attests to the exact
//! profile identifier it contains.
//!
//! SPARQL-backed validation, node expressions, and rules fail closed on
//! synchronous WebAssembly targets. The current synchronous SPARQL evaluator
//! cannot guarantee cooperative deadline or cancellation checks without a
//! native watchdog thread. Datalog-backed rules remain available and share the
//! caller's cancellation token directly.
#![doc(test(attr(deny(warnings))))]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc(html_favicon_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]
#![doc(html_logo_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]
#![warn(missing_docs)]

#[cfg(all(feature = "w3c-tests", not(feature = "sparql")))]
compile_error!("the `w3c-tests` feature requires the `sparql` feature");

mod compact;
mod compile;
mod constraint;
mod control;
mod datatype;
mod expression;
mod model;
mod path;
mod profile;
mod report;
mod rules;
#[cfg(feature = "sparql")]
mod sparql;
#[cfg(feature = "sparql")]
mod sparql_rules;
mod srl;
mod validate;

pub use crate::compact::{ShaclcError, ShaclcLimits, ShaclcParser, parse_shaclc};
pub use crate::compile::{
    CompileError, ShapesGraph, ShapesGraphImportResolver, compile_node_expression,
};
pub use crate::constraint::{Constraint, NodeKind, QualifiedValueShape};
pub use crate::control::{
    CancellationToken, LimitKind, ValidationError, ValidationLimits, ValidationOptions,
};
pub use crate::expression::{
    CustomNodeExpression, CustomNodeExpressionKind, ExpressionEnvironment, NodeExpression,
};
pub use crate::model::{GraphSnapshot, Shape, ShapeId, SnapshotSource, Target};
pub use crate::path::{PathError, PropertyPath};
pub use crate::profile::{
    ConformanceRequest, PINNED_SHACL_SOURCE_COMMIT, ProfileDescriptor, ProfileError, ProfileId,
    ProfileNegotiation, ProfileRejection, ProfileRequest, ProfileSet, ProfileVersion,
    SpecificationProfileId, negotiate_profiles, profile_catalog_json,
};
pub use crate::report::{CanonicalReport, ValidationReceipt, ValidationReport, ValidationResult};
pub use crate::rules::{
    RuleError, RuleExecution, RuleSet, RuleTerm, ShapeRule, TriplePattern, execute_rules,
};
#[cfg(feature = "sparql")]
pub use crate::sparql::SparqlConstraint;
#[cfg(feature = "sparql")]
pub use crate::sparql_rules::{SparqlRuleSet, execute_sparql_rules};
pub use crate::srl::{
    SrlAnnotation, SrlBinaryOperator, SrlBodyElement, SrlConstant, SrlError, SrlExecution,
    SrlExpression, SrlImportResolver, SrlItem, SrlNode, SrlPathElement, SrlPredicate, SrlProperty,
    SrlRule, SrlRuleSet, SrlStratification, SrlStratum, SrlTriple, SrlUnaryOperator,
    execute_srl_rules, execute_srl_rules_with_imports, query_srl_rules,
    query_srl_rules_with_imports,
};
pub use crate::validate::{Validator, evaluate_expression, validate};
