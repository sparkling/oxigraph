use oxilangtag::LanguageTag;
use oxiri::Iri;
use oxrdf::{
    BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, RdfVersion, Term, Triple,
};
use std::fmt::Write as _;
use std::io::{self, Write};

/// The media type contract used when parsing or serializing the N-Triples grammar.
#[derive(Default, Debug, Clone, Copy, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum NTriplesMediaType {
    /// An `application/n-triples` document encoded as UTF-8.
    #[default]
    ApplicationNTriples,
    /// An ASCII-safe `text/plain` representation using N-Triples grammar.
    ///
    /// Serializers emit characters outside US-ASCII using `\u` or `\U`
    /// escapes, and parsers reject an unescaped non-ASCII input byte.
    TextPlain,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum LineFormatMode {
    Versioned(RdfVersion),
    Canonical,
}

impl Default for LineFormatMode {
    fn default() -> Self {
        Self::Versioned(RdfVersion::V1_1)
    }
}

impl LineFormatMode {
    pub(crate) fn rdf_version(self) -> RdfVersion {
        match self {
            Self::Versioned(version) => version,
            Self::Canonical => RdfVersion::V1_2,
        }
    }

    pub(crate) fn preamble(self, media_type: NTriplesMediaType) -> io::Result<&'static [u8]> {
        match self {
            Self::Canonical => {
                if media_type == NTriplesMediaType::TextPlain {
                    return Err(invalid_input(
                        "Canonical N-Triples requires application/n-triples because text/plain requires non-ASCII characters to be escaped",
                    ));
                }
                Ok(b"")
            }
            Self::Versioned(version) => rdf_version_directive(version),
        }
    }
}

pub(crate) fn ensure_terse_triple_compatible(
    rdf_version: RdfVersion,
    triple: &Triple,
) -> io::Result<()> {
    ensure_terse_parts_compatible(
        rdf_version,
        &triple.subject,
        &triple.predicate,
        &triple.object,
        &GraphName::DefaultGraph,
    )
}

pub(crate) fn ensure_terse_quad_compatible(rdf_version: RdfVersion, quad: &Quad) -> io::Result<()> {
    ensure_terse_parts_compatible(
        rdf_version,
        &quad.subject,
        &quad.predicate,
        &quad.object,
        &quad.graph_name,
    )
}

pub(crate) fn ensure_terse_parts_compatible(
    rdf_version: RdfVersion,
    subject: &NamedOrBlankNode,
    predicate: &NamedNode,
    object: &Term,
    graph_name: &GraphName,
) -> io::Result<()> {
    ensure_supported_rdf_version(rdf_version)?;
    validate_named_or_blank_node(rdf_version, subject, "subject")?;
    validate_named_node(predicate, "predicate")?;
    ensure_terse_term_compatible(rdf_version, object)?;
    match graph_name {
        GraphName::NamedNode(node) => {
            ensure_terse_graph_name_compatible(rdf_version, &node.clone().into())
        }
        GraphName::BlankNode(node) => {
            ensure_terse_graph_name_compatible(rdf_version, &node.clone().into())
        }
        GraphName::DefaultGraph => Ok(()),
    }
}

pub(crate) fn ensure_terse_graph_name_compatible(
    rdf_version: RdfVersion,
    graph_name: &NamedOrBlankNode,
) -> io::Result<()> {
    ensure_supported_rdf_version(rdf_version)?;
    validate_named_or_blank_node(rdf_version, graph_name, "graph name")
}

fn ensure_terse_term_compatible(rdf_version: RdfVersion, term: &Term) -> io::Result<()> {
    if rdf_version == RdfVersion::V1_1 && uses_rdf_12(term) {
        return Err(invalid_input("RDF 1.2 terms require an RDF 1.2 serializer"));
    }
    if rdf_version == RdfVersion::V1_2Basic && uses_triple_terms(term) {
        return Err(invalid_input(
            "triple terms require the full RDF 1.2 profile",
        ));
    }
    match term {
        Term::NamedNode(node) => validate_named_node(node, "object"),
        Term::BlankNode(node) => validate_blank_node(rdf_version, node, "object"),
        Term::Literal(literal) => validate_literal(literal),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => ensure_terse_triple_compatible(rdf_version, triple),
    }
}

#[cfg(feature = "rdf-12")]
fn uses_rdf_12(term: &Term) -> bool {
    match term {
        Term::Literal(literal) => literal.direction().is_some(),
        Term::Triple(_) => true,
        Term::NamedNode(_) | Term::BlankNode(_) => false,
    }
}

#[cfg(not(feature = "rdf-12"))]
fn uses_rdf_12(_term: &Term) -> bool {
    false
}

#[cfg(feature = "rdf-12")]
fn uses_triple_terms(term: &Term) -> bool {
    matches!(term, Term::Triple(_))
}

#[cfg(not(feature = "rdf-12"))]
fn uses_triple_terms(_term: &Term) -> bool {
    false
}

fn ensure_supported_rdf_version(rdf_version: RdfVersion) -> io::Result<()> {
    match rdf_version {
        RdfVersion::V1_1 | RdfVersion::V1_2Basic | RdfVersion::V1_2 => Ok(()),
        _ => Err(invalid_input("unsupported RDF version")),
    }
}

fn validate_named_or_blank_node(
    rdf_version: RdfVersion,
    node: &NamedOrBlankNode,
    context: &str,
) -> io::Result<()> {
    match node {
        NamedOrBlankNode::NamedNode(node) => validate_named_node(node, context),
        NamedOrBlankNode::BlankNode(node) => validate_blank_node(rdf_version, node, context),
    }
}

fn validate_named_node(node: &NamedNode, context: &str) -> io::Result<()> {
    Iri::parse(node.as_str()).map(|_| ()).map_err(|error| {
        invalid_input(format!(
            "the {context} IRI '{}' is invalid: {error}",
            node.as_str()
        ))
    })
}

fn validate_blank_node(rdf_version: RdfVersion, node: &BlankNode, context: &str) -> io::Result<()> {
    BlankNode::new(node.as_str().to_owned()).map_err(|error| {
        invalid_input(format!(
            "the {context} blank node identifier '{}' is invalid: {error}",
            node.as_str()
        ))
    })?;
    if rdf_version != RdfVersion::V1_1 && node.as_str().contains(':') {
        return Err(invalid_input(format!(
            "the {context} blank node identifier '{}' uses ':' which RDF 1.2 removed from PN_CHARS_U",
            node.as_str()
        )));
    }
    Ok(())
}

fn validate_literal(literal: &Literal) -> io::Result<()> {
    validate_named_node(literal.datatype(), "literal datatype")?;
    if let Some(language) = literal.language() {
        LanguageTag::parse(language).map_err(|error| {
            invalid_input(format!(
                "the literal language tag '{language}' is invalid: {error}"
            ))
        })?;
        if !language
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || !byte.is_ascii_alphabetic())
        {
            return Err(invalid_input(format!(
                "the literal language tag '{language}' is not lowercase"
            )));
        }
    }
    Ok(())
}

fn rdf_version_directive(rdf_version: RdfVersion) -> io::Result<&'static [u8]> {
    match rdf_version {
        RdfVersion::V1_1 => Ok(b""),
        #[cfg(feature = "rdf-12")]
        RdfVersion::V1_2Basic => Ok(b"VERSION \"1.2-basic\"\n"),
        #[cfg(feature = "rdf-12")]
        RdfVersion::V1_2 => Ok(b"VERSION \"1.2\"\n"),
        _ => Err(invalid_input(
            "the selected RDF version is not supported by this build",
        )),
    }
}

fn invalid_input(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

pub(crate) fn write_ntriples(
    triple: &Triple,
    media_type: NTriplesMediaType,
    mut writer: impl Write,
) -> io::Result<()> {
    match media_type {
        NTriplesMediaType::ApplicationNTriples => writeln!(writer, "{triple} ."),
        NTriplesMediaType::TextPlain => {
            ensure_ascii_blank_nodes(triple)?;
            let line = format!("{triple} .\n");
            let mut ascii = String::with_capacity(line.len());
            for character in line.chars() {
                if character.is_ascii() {
                    ascii.push(character);
                } else {
                    let value = u32::from(character);
                    if value <= 0xFFFF {
                        write!(ascii, "\\u{value:04X}").map_err(io::Error::other)?;
                    } else {
                        write!(ascii, "\\U{value:08X}").map_err(io::Error::other)?;
                    }
                }
            }
            writer.write_all(ascii.as_bytes())
        }
    }
}

fn ensure_ascii_blank_nodes(triple: &Triple) -> io::Result<()> {
    ensure_ascii_subject(&triple.subject)?;
    ensure_ascii_term(&triple.object)
}

fn ensure_ascii_subject(subject: &NamedOrBlankNode) -> io::Result<()> {
    if let NamedOrBlankNode::BlankNode(node) = subject {
        ensure_ascii_blank_node_id(node.as_str())?;
    }
    Ok(())
}

fn ensure_ascii_term(term: &Term) -> io::Result<()> {
    match term {
        Term::BlankNode(node) => ensure_ascii_blank_node_id(node.as_str()),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => ensure_ascii_blank_nodes(triple),
        Term::NamedNode(_) | Term::Literal(_) => Ok(()),
    }
}

fn ensure_ascii_blank_node_id(id: &str) -> io::Result<()> {
    if id.is_ascii() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "text/plain serialization cannot escape non-ASCII blank node identifiers",
        ))
    }
}
