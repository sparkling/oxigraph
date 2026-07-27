use oxigraph::io::{RdfFormat, RdfSerializer};
use oxigraph::model::{Quad, RdfVersion, Term, Triple};
use std::io;

/// The concrete syntax and RDF language version selected for an HTTP response.
///
/// Keeping both values together prevents a response from advertising RDF 1.2
/// while using the RDF 1.1 serializer defaults.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RdfResponseFormat {
    format: RdfFormat,
    version: RdfVersion,
}

impl RdfResponseFormat {
    pub(crate) const fn new(format: RdfFormat, version: RdfVersion) -> Self {
        Self { format, version }
    }

    pub(crate) const fn rdf11(format: RdfFormat) -> Self {
        Self::new(format, RdfVersion::V1_1)
    }

    pub(crate) const fn format(self) -> RdfFormat {
        self.format
    }

    pub(crate) const fn version(self) -> RdfVersion {
        self.version
    }

    pub(crate) fn supports_rdf12(format: RdfFormat) -> bool {
        matches!(
            format,
            RdfFormat::NTriples | RdfFormat::NQuads | RdfFormat::Turtle | RdfFormat::TriG
        )
    }

    pub(crate) fn serializer(self) -> io::Result<RdfSerializer> {
        let serializer = RdfSerializer::from_format(self.format);
        if Self::supports_rdf12(self.format) {
            serializer
                .with_rdf_version(self.version)
                .map_err(io::Error::other)
        } else if self.version == RdfVersion::V1_1 {
            Ok(serializer)
        } else {
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{} cannot advertise the selected RDF version", self.format),
            ))
        }
    }

    pub(crate) fn media_type(self) -> &'static str {
        match (self.format, self.version) {
            (RdfFormat::NTriples, RdfVersion::V1_2Basic) => {
                "application/n-triples; version=1.2-basic"
            }
            (RdfFormat::NQuads, RdfVersion::V1_2Basic) => "application/n-quads; version=1.2-basic",
            (RdfFormat::Turtle, RdfVersion::V1_2Basic) => "text/turtle; version=1.2-basic",
            (RdfFormat::TriG, RdfVersion::V1_2Basic) => "application/trig; version=1.2-basic",
            (RdfFormat::NTriples, RdfVersion::V1_2) => "application/n-triples; version=1.2",
            (RdfFormat::NQuads, RdfVersion::V1_2) => "application/n-quads; version=1.2",
            (RdfFormat::Turtle, RdfVersion::V1_2) => "text/turtle; version=1.2",
            (RdfFormat::TriG, RdfVersion::V1_2) => "application/trig; version=1.2",
            _ => self.format.media_type(),
        }
    }

    pub(crate) fn ensure_triple(self, triple: &Triple) -> io::Result<()> {
        ensure_term_version(self.version, &triple.object)
    }

    pub(crate) fn ensure_quad(self, quad: &Quad) -> io::Result<()> {
        self.ensure_triple(quad.as_triple())
    }

    pub(crate) fn etag_profile(self) -> &'static str {
        match self.version {
            RdfVersion::V1_1 => "11",
            RdfVersion::V1_2Basic => "12b",
            RdfVersion::V1_2 => "12",
            _ => "other",
        }
    }
}

#[cfg(feature = "rdf-12")]
fn ensure_term_version(version: RdfVersion, term: &Term) -> io::Result<()> {
    match term {
        Term::Literal(literal)
            if literal.direction().is_some()
                && !version.supports_directional_language_strings() =>
        {
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "directional language-tagged strings require RDF 1.2",
            ))
        }
        Term::Triple(_) if !version.supports_triple_terms() => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "triple terms require the full RDF 1.2 profile",
        )),
        Term::Triple(triple) => ensure_term_version(version, &triple.object),
        Term::NamedNode(_) | Term::BlankNode(_) | Term::Literal(_) => Ok(()),
    }
}

#[cfg(not(feature = "rdf-12"))]
#[expect(
    clippy::unnecessary_wraps,
    reason = "keeps feature-independent response control flow"
)]
fn ensure_term_version(_version: RdfVersion, _term: &Term) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "rdf-12")]
    use oxigraph::model::{Literal, NamedNode};

    #[test]
    fn rdf11_is_the_unversioned_default_contract() {
        let selected = RdfResponseFormat::rdf11(RdfFormat::Turtle);
        assert_eq!(selected.media_type(), "text/turtle");
        assert_eq!(selected.version(), RdfVersion::V1_1);
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    #[expect(clippy::panic_in_result_fn)]
    fn rdf12_turtle_is_explicit_and_rdf11_rejects_triple_terms() -> io::Result<()> {
        let embedded = Triple::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            NamedNode::new_unchecked("urn:o"),
        );
        let triple = Triple::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            embedded,
        );

        let Err(_) = RdfResponseFormat::rdf11(RdfFormat::NTriples).ensure_triple(&triple) else {
            return Err(io::Error::other(
                "RDF 1.1 response accepted an RDF 1.2 triple term",
            ));
        };
        let selected = RdfResponseFormat::new(RdfFormat::Turtle, RdfVersion::V1_2);
        selected.ensure_triple(&triple)?;
        let mut serializer = selected.serializer()?.for_writer(Vec::new());
        serializer.serialize_triple(&triple)?;
        let body = serializer.finish()?;
        assert_eq!(selected.media_type(), "text/turtle; version=1.2");
        assert!(body.starts_with(b"VERSION \"1.2\"\n"));
        Ok(())
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn rdf11_rejects_directional_literals() -> io::Result<()> {
        let triple = Triple::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            Literal::new_directional_language_tagged_literal_unchecked(
                "text",
                "en",
                oxigraph::model::BaseDirection::Ltr,
            ),
        );
        let Err(_) = RdfResponseFormat::rdf11(RdfFormat::NQuads).ensure_triple(&triple) else {
            return Err(io::Error::other(
                "RDF 1.1 response accepted a directional literal",
            ));
        };
        Ok(())
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    #[expect(clippy::panic_in_result_fn)]
    fn rdf12_basic_allows_direction_but_rejects_triple_terms() -> io::Result<()> {
        let directional = Triple::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            Literal::new_directional_language_tagged_literal_unchecked(
                "text",
                "en",
                oxigraph::model::BaseDirection::Ltr,
            ),
        );
        let selected = RdfResponseFormat::new(RdfFormat::NTriples, RdfVersion::V1_2Basic);
        selected.ensure_triple(&directional)?;
        let mut serializer = selected.serializer()?.for_writer(Vec::new());
        serializer.serialize_triple(&directional)?;
        assert!(serializer.finish()?.starts_with(b"VERSION \"1.2-basic\"\n"));
        assert_eq!(
            selected.media_type(),
            "application/n-triples; version=1.2-basic"
        );
        assert_eq!(selected.etag_profile(), "12b");

        let triple_term = Triple::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            Triple::new(
                NamedNode::new_unchecked("urn:quoted-s"),
                NamedNode::new_unchecked("urn:quoted-p"),
                NamedNode::new_unchecked("urn:quoted-o"),
            ),
        );
        let Err(error) = selected.ensure_triple(&triple_term) else {
            return Err(io::Error::other(
                "RDF 1.2 Basic response accepted a triple term",
            ));
        };
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        Ok(())
    }
}
