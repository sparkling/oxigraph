//! Bounded parsing of the SHACL 1.2 Compact Syntax (SHACL-C).

mod lexer;
mod model;
mod parser;
mod rdf;
#[cfg(test)]
mod tests;

use crate::GraphSnapshot;
use oxiri::Iri;

/// Resource limits applied while parsing and mapping a SHACL-C document.
#[derive(Clone, Debug)]
#[expect(
    clippy::struct_field_names,
    reason = "public limit fields use explicit max_* names consistently with ValidationLimits"
)]
pub struct ShaclcLimits {
    /// Maximum UTF-8 source size in bytes.
    pub max_source_bytes: usize,
    /// Maximum lexical tokens.
    pub max_tokens: usize,
    /// Maximum nested grammar depth.
    pub max_nesting_depth: usize,
    /// Maximum shape declarations.
    pub max_shapes: usize,
    /// Maximum aggregate items in RDF collection syntax.
    pub max_list_items: usize,
    /// Maximum triples emitted by the RDF mapping.
    pub max_triples: usize,
}

impl Default for ShaclcLimits {
    fn default() -> Self {
        Self {
            max_source_bytes: 16 * 1024 * 1024,
            max_tokens: 1_000_000,
            max_nesting_depth: 128,
            max_shapes: 100_000,
            max_list_items: 100_000,
            max_triples: 1_000_000,
        }
    }
}

/// Parser for the dated SHACL 1.2 Compact Syntax grammar.
#[derive(Clone, Debug, Default)]
pub struct ShaclcParser {
    base_iri: Option<String>,
    limits: ShaclcLimits,
}

impl ShaclcParser {
    /// Creates a parser with default limits and no external base IRI.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets and validates the external base IRI used for relative references.
    pub fn with_base_iri(mut self, base_iri: impl Into<String>) -> Result<Self, ShaclcError> {
        let base_iri = base_iri.into();
        Iri::parse(base_iri.clone())
            .map_err(|error| ShaclcError::Iri(format!("invalid base IRI: {error}")))?;
        self.base_iri = Some(base_iri);
        Ok(self)
    }

    #[must_use]
    /// Replaces the parser resource limits.
    pub fn with_limits(mut self, limits: ShaclcLimits) -> Self {
        self.limits = limits;
        self
    }

    /// Parses and maps one SHACL-C document to an owned default-graph snapshot.
    pub fn parse(&self, source: &str) -> Result<GraphSnapshot, ShaclcError> {
        if source.len() > self.limits.max_source_bytes {
            return Err(ShaclcError::LimitExceeded {
                kind: "source bytes",
                limit: self.limits.max_source_bytes,
            });
        }
        parser::parse(source, self.base_iri.clone(), &self.limits).map(GraphSnapshot::default_graph)
    }
}

/// Parses SHACL-C using the default limits and an optional external base IRI.
pub fn parse_shaclc(source: &str, base_iri: Option<&str>) -> Result<GraphSnapshot, ShaclcError> {
    let parser = match base_iri {
        Some(base_iri) => ShaclcParser::new().with_base_iri(base_iri)?,
        None => ShaclcParser::new(),
    };
    parser.parse(source)
}

/// Failure while parsing or mapping SHACL-C.
#[derive(Debug, thiserror::Error)]
pub enum ShaclcError {
    /// A token or grammar production is invalid.
    #[error("SHACL-C syntax error at line {line}, column {column}: {message}")]
    Syntax {
        /// One-based source line.
        line: usize,
        /// One-based source column.
        column: usize,
        /// Human-readable syntax diagnostic.
        message: String,
    },
    /// An IRI is invalid or cannot be resolved.
    #[error("SHACL-C IRI error: {0}")]
    Iri(String),
    /// A literal is invalid for the compact grammar or RDF mapping.
    #[error("SHACL-C literal error: {0}")]
    Literal(String),
    /// A configured parser or mapping limit was exceeded.
    #[error("SHACL-C {kind} limit exceeded ({limit})")]
    LimitExceeded {
        /// Category of the exhausted resource.
        kind: &'static str,
        /// Configured ceiling.
        limit: usize,
    },
    /// An `IMPORTS` declaration lacks a base IRI for resolution.
    #[error("SHACL-C imports require a base IRI")]
    ImportsWithoutBase,
}
