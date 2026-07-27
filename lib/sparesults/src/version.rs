use crate::error::QueryResultsSyntaxError;
use oxrdf::{RdfVersion, Term};
use std::io;

pub(crate) fn parse_results_version(value: &str) -> Result<RdfVersion, QueryResultsSyntaxError> {
    match value {
        "1.1" => Ok(RdfVersion::V1_1),
        "1.2-basic" => Ok(RdfVersion::V1_2Basic),
        "1.2" => Ok(RdfVersion::V1_2),
        _ => Err(QueryResultsSyntaxError::msg(format!(
            "Unsupported SPARQL results version '{value}'"
        ))),
    }
}

pub(crate) const fn results_version_label(version: RdfVersion) -> Option<&'static str> {
    match version {
        RdfVersion::V1_1 => Some("1.1"),
        RdfVersion::V1_2Basic => Some("1.2-basic"),
        RdfVersion::V1_2 => Some("1.2"),
        _ => None,
    }
}

pub(crate) fn validate_term_version(
    term: &Term,
    version: Option<RdfVersion>,
) -> Result<(), QueryResultsSyntaxError> {
    if let Some(message) = term_version_violation(term, version) {
        Err(QueryResultsSyntaxError::msg(message))
    } else {
        Ok(())
    }
}

pub(crate) fn ensure_term_version(term: &Term, version: Option<RdfVersion>) -> io::Result<()> {
    if let Some(message) = term_version_violation(term, version) {
        Err(io::Error::new(io::ErrorKind::InvalidInput, message))
    } else {
        Ok(())
    }
}

#[cfg(feature = "sparql-12")]
fn term_version_violation(term: &Term, version: Option<RdfVersion>) -> Option<&'static str> {
    let version = version?;
    match term {
        Term::Literal(literal)
            if literal.direction().is_some()
                && !version.supports_directional_language_strings() =>
        {
            Some(
                "Directional language-tagged strings are not compatible with the configured SPARQL results version",
            )
        }
        Term::Triple(_) if !version.supports_triple_terms() => {
            Some("Triple terms are not compatible with the configured SPARQL results version")
        }
        Term::Triple(triple) => term_version_violation(&triple.object, Some(version)),
        Term::NamedNode(_) | Term::BlankNode(_) | Term::Literal(_) => None,
    }
}

#[cfg(not(feature = "sparql-12"))]
fn term_version_violation(_term: &Term, _version: Option<RdfVersion>) -> Option<&'static str> {
    None
}
