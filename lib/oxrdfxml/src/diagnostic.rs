use oxrdf::NamedNode;
use std::sync::Arc;

pub(crate) const RDF_NAMESPACE_IRI: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

pub(crate) type RdfXmlWarningHandler = Arc<dyn Fn(RdfXmlWarning) + Send + Sync>;

/// A non-fatal diagnostic reported while parsing RDF/XML.
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum RdfXmlWarning {
    /// A name in the RDF namespace is not part of the RDF/XML-defined vocabulary.
    ///
    /// RDF/XML requires such a name to behave like an ordinary RDF name, but
    /// recommends that processors warn when they encounter it.
    UndefinedRdfVocabularyName(NamedNode),
}

impl RdfXmlWarning {
    /// The IRI that caused the diagnostic.
    pub fn iri(&self) -> &NamedNode {
        match self {
            Self::UndefinedRdfVocabularyName(iri) => iri,
        }
    }
}

pub(crate) fn is_undefined_rdf_vocabulary_name(iri: &str) -> bool {
    let Some(local_name) = iri.strip_prefix(RDF_NAMESPACE_IRI) else {
        return false;
    };
    !is_defined_rdf_vocabulary_name(local_name)
}

fn is_defined_rdf_vocabulary_name(local_name: &str) -> bool {
    matches!(
        local_name,
        "RDF"
            | "Description"
            | "ID"
            | "about"
            | "annotation"
            | "annotationNodeID"
            | "datatype"
            | "li"
            | "nodeID"
            | "parseType"
            | "resource"
            | "version"
            | "Seq"
            | "Bag"
            | "Alt"
            | "Statement"
            | "Property"
            | "XMLLiteral"
            | "List"
            | "subject"
            | "predicate"
            | "object"
            | "type"
            | "value"
            | "first"
            | "rest"
            | "nil"
    ) || is_container_membership_property(local_name)
}

fn is_container_membership_property(local_name: &str) -> bool {
    let Some(digits) = local_name.strip_prefix('_') else {
        return false;
    };
    !digits.is_empty()
        && !digits.starts_with('0')
        && digits.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defined_vocabulary_and_container_membership_names_are_not_warnings() {
        for local_name in ["RDF", "type", "version", "_1", "_42"] {
            assert!(!is_undefined_rdf_vocabulary_name(&format!(
                "{RDF_NAMESPACE_IRI}{local_name}"
            )));
        }
        for local_name in ["unknown", "_0", "_01", "_"] {
            assert!(is_undefined_rdf_vocabulary_name(&format!(
                "{RDF_NAMESPACE_IRI}{local_name}"
            )));
        }
    }
}
