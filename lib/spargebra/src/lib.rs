#![cfg_attr(doc, doc = include_str!("../README.md"))]
#![doc(test(attr(deny(warnings))))]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc(html_favicon_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]
#![doc(html_logo_url = "https://raw.githubusercontent.com/oxigraph/oxigraph/main/logo.svg")]

pub mod algebra;
mod algebra_builder;
mod ast;
mod error;
mod lexer;
mod parser;
pub mod query;
pub mod term;
pub mod update;
mod version;
pub mod vocab;

use crate::algebra_builder::AlgebraBuilder;
pub use crate::error::{SparqlSyntaxError, TextPosition};
use crate::lexer::lex_sparql;
use crate::parser::{parse_sparql_query, parse_sparql_update};
use oxiri::{Iri, IriParseError};
use oxrdf::{NamedNode, OxString};
pub use query::Query;
use std::collections::{HashMap, HashSet};
pub use update::Update;
pub use version::{ParsedQuery, ParsedUpdate, SparqlVersion};
use version::{declared_version, validate_version_support, validate_version_syntax};

/// A SPARQL parser
///
/// ```
/// use spargebra::SparqlParser;
///
/// let query_str = "SELECT ?s ?p ?o WHERE { ?s ?p ?o . }";
/// let query = SparqlParser::new().parse_query(query_str)?;
/// assert_eq!(query.to_string(), query_str);
/// # Ok::<_, spargebra::SparqlSyntaxError>(())
/// ```
#[must_use]
#[derive(Clone, Default)]
pub struct SparqlParser {
    base_iri: Option<Iri<OxString>>,
    prefixes: HashMap<OxString, Iri<OxString>>,
    custom_aggregate_functions: HashSet<NamedNode>,
    version: Option<SparqlVersion>,
}

impl SparqlParser {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    /// Provides an IRI that could be used to resolve the operation relative IRIs.
    ///
    /// ```
    /// use spargebra::SparqlParser;
    ///
    /// let query = SparqlParser::new().with_base_iri("http://example.com/")?.parse_query("SELECT * WHERE { <s> <p> <o> }")?;
    /// assert_eq!(query.to_string(), "BASE <http://example.com/>\nSELECT * WHERE { <http://example.com/s> <http://example.com/p> <http://example.com/o> . }");
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_base_iri(mut self, base_iri: &str) -> Result<Self, IriParseError> {
        self.base_iri = Some(Iri::parse(OxString::new_owned(base_iri))?);
        Ok(self)
    }

    /// Set a default IRI prefix used during parsing.
    ///
    /// ```
    /// use spargebra::SparqlParser;
    ///
    /// let query = SparqlParser::new()
    ///     .with_prefix("ex", "http://example.com/")?
    ///     .parse_query("SELECT * WHERE { ex:s ex:p ex:o }")?;
    /// assert_eq!(
    ///     query.to_string(),
    ///     "SELECT * WHERE { <http://example.com/s> <http://example.com/p> <http://example.com/o> . }"
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_prefix(
        mut self,
        prefix_name: &str,
        prefix_iri: &str,
    ) -> Result<Self, IriParseError> {
        self.prefixes.insert(
            OxString::new_owned(prefix_name),
            Iri::parse(OxString::new_owned(prefix_iri))?,
        );
        Ok(self)
    }

    /// Adds a new function to be parsed as a custom aggregate function and not as a regular custom function.
    ///
    /// ```
    /// use oxrdf::NamedNode;
    /// use spargebra::SparqlParser;
    ///
    /// SparqlParser::new()
    ///     .with_custom_aggregate_function(NamedNode::new("http://example.com/concat")?)
    ///     .parse_query(
    ///         "PREFIX ex: <http://example.com/> SELECT (ex:concat(?o) AS ?concat) WHERE { ex:s ex:p ex:o }",
    ///     )?;
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_custom_aggregate_function(mut self, name: impl Into<NamedNode>) -> Self {
        self.custom_aggregate_functions.insert(name.into());
        self
    }

    /// Selects the SPARQL version used to validate parsed operations.
    ///
    /// A `VERSION` declaration in the operation takes precedence, as required
    /// by SPARQL 1.2 Query §4.3. The configured value is the out-of-band
    /// fallback used when the operation has no declaration.
    #[inline]
    pub fn with_version(mut self, version: SparqlVersion) -> Self {
        self.version = Some(version);
        self
    }

    /// Parse the given query string using the already set options.
    ///
    /// ```
    /// use spargebra::SparqlParser;
    ///
    /// let query_str = "SELECT ?s ?p ?o WHERE { ?s ?p ?o . }";
    /// let query = SparqlParser::new().parse_query(query_str)?;
    /// assert_eq!(query.to_string(), query_str);
    /// # Ok::<_, spargebra::SparqlSyntaxError>(())
    /// ```
    pub fn parse_query(&self, query: &str) -> Result<Query, SparqlSyntaxError> {
        self.parse_query_with_metadata(query)
            .map(ParsedQuery::into_query)
    }

    /// Parses a query and retains its declared and effective SPARQL versions.
    ///
    /// The returned metadata records both the in-band declaration and the
    /// effective version selected according to SPARQL 1.2 Query §4.3.
    pub fn parse_query_with_metadata(&self, query: &str) -> Result<ParsedQuery, SparqlSyntaxError> {
        let tokens = lex_sparql(query);
        let ast = parse_sparql_query(&tokens, query.len())
            .map_err(|e| SparqlSyntaxError::from_chumsky(e, query))?;
        let declared_version = declared_version(ast.prologue.iter(), query)?;
        let effective_version = declared_version
            .or(self.version)
            .unwrap_or_else(SparqlVersion::current);
        validate_version_support(effective_version, query)?;
        validate_version_syntax(query, effective_version)?;
        let query = AlgebraBuilder::new(
            self.base_iri.clone(),
            self.prefixes.clone(),
            &self.custom_aggregate_functions,
        )
        .build_query(ast)
        .map_err(|e| SparqlSyntaxError::from_algebra_builder(e, query))?;
        Ok(ParsedQuery::new(query, declared_version, effective_version))
    }

    /// Parse the given update string using the already set options.
    ///
    /// ```
    /// use spargebra::SparqlParser;
    ///
    /// let update_str = "CLEAR ALL ;";
    /// let update = SparqlParser::new().parse_update(update_str)?;
    /// assert_eq!(update.to_string().trim(), update_str);
    /// # Ok::<_, spargebra::SparqlSyntaxError>(())
    /// ```
    pub fn parse_update(&self, update: &str) -> Result<Update, SparqlSyntaxError> {
        self.parse_update_with_metadata(update)
            .map(ParsedUpdate::into_update)
    }

    /// Parses an update and retains its declared and effective SPARQL versions.
    ///
    /// The returned metadata records both the in-band declaration and the
    /// effective version selected according to SPARQL 1.2 Query §4.3.
    pub fn parse_update_with_metadata(
        &self,
        update: &str,
    ) -> Result<ParsedUpdate, SparqlSyntaxError> {
        let tokens = lex_sparql(update);
        let ast = parse_sparql_update(&tokens, update.len())
            .map_err(|e| SparqlSyntaxError::from_chumsky(e, update))?;
        let declared_version = declared_version(
            ast.operations
                .iter()
                .flat_map(|(prologue, _)| prologue)
                .chain(ast.trailing_prologue.iter()),
            update,
        )?;
        let effective_version = declared_version
            .or(self.version)
            .unwrap_or_else(SparqlVersion::current);
        validate_version_support(effective_version, update)?;
        validate_version_syntax(update, effective_version)?;
        let update_value = AlgebraBuilder::new(
            self.base_iri.clone(),
            self.prefixes.clone(),
            &self.custom_aggregate_functions,
        )
        .build_update(ast)
        .map_err(|e| SparqlSyntaxError::from_algebra_builder(e, update))?;
        Ok(ParsedUpdate::new(
            update_value,
            declared_version,
            effective_version,
        ))
    }
}
