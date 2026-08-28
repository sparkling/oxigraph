use super::transactional::WritableDataset;
use crate::model::{NamedNode, OxString};
use std::fmt;

/// A validated Turtle/SPARQL namespace prefix.
///
/// The empty string denotes the default namespace. Non-empty prefixes follow
/// the exact `PN_PREFIX` grammar and are retained byte-for-byte without Unicode
/// normalization.
#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct NamespacePrefix(OxString);

impl NamespacePrefix {
    /// Creates a namespace prefix after validating the Turtle/SPARQL grammar.
    pub fn new(value: impl Into<OxString>) -> Result<Self, NamespacePrefixParseError> {
        let value = value.into();
        if is_valid_prefix_name(&value) {
            Ok(Self(value))
        } else {
            Err(NamespacePrefixParseError)
        }
    }

    /// Returns the exact namespace-prefix text.
    #[inline]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    /// Returns the exact namespace-prefix text as an owned string.
    #[inline]
    pub fn into_string(self) -> OxString {
        self.0
    }
}

impl AsRef<str> for NamespacePrefix {
    #[inline]
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for NamespacePrefix {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Error returned when a namespace prefix does not satisfy `PN_PREFIX`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("invalid Turtle/SPARQL namespace prefix")]
pub struct NamespacePrefixParseError;

/// One store-global namespace-prefix mapping.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Namespace {
    prefix: NamespacePrefix,
    iri: NamedNode,
}

impl Namespace {
    /// Creates a namespace mapping from already validated components.
    #[inline]
    pub const fn new(prefix: NamespacePrefix, iri: NamedNode) -> Self {
        Self { prefix, iri }
    }

    /// Returns the namespace prefix.
    #[inline]
    pub const fn prefix(&self) -> &NamespacePrefix {
        &self.prefix
    }

    /// Returns the namespace IRI.
    #[inline]
    pub const fn iri(&self) -> &NamedNode {
        &self.iri
    }

    /// Splits the mapping into its owned components.
    #[inline]
    pub fn into_parts(self) -> (NamespacePrefix, NamedNode) {
        (self.prefix, self.iri)
    }
}

/// Additive transaction capability for a store-global namespace registry.
///
/// Implementations participate in the same commit and rollback boundary as
/// the RDF operations provided by [`WritableDataset`].
pub trait WritableNamespaceRegistry: WritableDataset {
    /// Iterator over mappings in exact ascending prefix-byte order.
    type Namespaces<'a>: Iterator<Item = Result<Namespace, Self::Error>> + 'a
    where
        Self: 'a;

    /// Returns all mappings visible to this transaction.
    fn namespaces(&self) -> Self::Namespaces<'_>;

    /// Looks up the mapping for `prefix`.
    fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, Self::Error>;

    /// Creates or overwrites a mapping.
    fn set_namespace(&mut self, namespace: Namespace) -> Result<(), Self::Error>;

    /// Removes a mapping. Missing mappings are ignored.
    fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), Self::Error>;

    /// Removes all mappings. An empty registry is left unchanged.
    fn clear_namespaces(&mut self) -> Result<(), Self::Error>;
}

fn is_valid_prefix_name(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return true;
    };
    if !is_pn_chars_base(first) {
        return false;
    }
    let mut last = first;
    for character in characters {
        if character != '.' && !is_pn_chars(character) {
            return false;
        }
        last = character;
    }
    is_pn_chars(last)
}

fn is_pn_chars(character: char) -> bool {
    is_pn_chars_base(character)
        || character == '_'
        || character == '-'
        || character.is_ascii_digit()
        || character == '\u{B7}'
        || ('\u{0300}'..='\u{036F}').contains(&character)
        || ('\u{203F}'..='\u{2040}').contains(&character)
}

fn is_pn_chars_base(character: char) -> bool {
    character.is_ascii_alphabetic()
        || ('\u{00C0}'..='\u{00D6}').contains(&character)
        || ('\u{00D8}'..='\u{00F6}').contains(&character)
        || ('\u{00F8}'..='\u{02FF}').contains(&character)
        || ('\u{0370}'..='\u{037D}').contains(&character)
        || ('\u{037F}'..='\u{1FFF}').contains(&character)
        || ('\u{200C}'..='\u{200D}').contains(&character)
        || ('\u{2070}'..='\u{218F}').contains(&character)
        || ('\u{2C00}'..='\u{2FEF}').contains(&character)
        || ('\u{3001}'..='\u{D7FF}').contains(&character)
        || ('\u{F900}'..='\u{FDCF}').contains(&character)
        || ('\u{FDF0}'..='\u{FFFD}').contains(&character)
        || ('\u{10000}'..='\u{EFFFF}').contains(&character)
}
