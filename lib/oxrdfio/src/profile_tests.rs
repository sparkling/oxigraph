#![expect(clippy::panic_in_result_fn)]

#[cfg(feature = "rdf-12")]
use crate::RdfSerializerConfigError;
use crate::{RdfFormat, RdfParser, RdfSerializer};
#[cfg(feature = "rdf-12")]
use oxrdf::{BaseDirection, RdfVersion, Term};
use oxrdf::{Literal, NamedNode, Triple};
use std::error::Error;
#[cfg(feature = "rdf-12")]
use std::io;

#[test]
fn ntriples_media_type_identity_is_preserved() {
    assert_eq!(
        RdfFormat::from_media_type("application/n-triples"),
        Some(RdfFormat::NTriples)
    );
    assert_eq!(
        RdfFormat::from_media_type("text/plain"),
        Some(RdfFormat::NTriplesTextPlain)
    );
    assert_eq!(RdfFormat::from_media_type("application/plain"), None);
    assert_eq!(
        RdfFormat::from_extension("txt"),
        Some(RdfFormat::NTriplesTextPlain)
    );
    assert_eq!(RdfFormat::NTriplesTextPlain.media_type(), "text/plain");
    assert_eq!(RdfFormat::NTriplesTextPlain.file_extension(), "txt");
    assert_eq!(
        RdfParser::from_format(RdfFormat::NTriplesTextPlain).format(),
        RdfFormat::NTriplesTextPlain
    );
    assert_eq!(
        RdfSerializer::from_format(RdfFormat::NTriplesTextPlain).format(),
        RdfFormat::NTriplesTextPlain
    );
}

#[test]
fn generic_text_plain_serialization_is_ascii_safe() -> Result<(), Box<dyn Error>> {
    let triple = Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        Literal::new_simple_literal("caf\u{e9}"),
    );
    let mut serializer =
        RdfSerializer::from_format(RdfFormat::NTriplesTextPlain).for_writer(Vec::new());
    serializer.serialize_triple(&triple)?;
    assert_eq!(
        serializer.finish()?,
        b"<http://example.com/s> <http://example.com/p> \"caf\\u00E9\" .\n"
    );
    Ok(())
}

#[test]
fn generic_text_plain_parser_enforces_ascii_transport() -> Result<(), Box<dyn Error>> {
    let escaped = b"<http://example.com/s> <http://example.com/p> \"caf\\u00E9\" .\n";
    let parsed = RdfParser::from_format(RdfFormat::NTriplesTextPlain)
        .for_reader(escaped.as_slice())
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(parsed.len(), 1);

    let raw = "<http://example.com/s> <http://example.com/p> \"caf\u{e9}\" .\n";
    let result = RdfParser::from_format(RdfFormat::NTriplesTextPlain)
        .for_slice(raw)
        .collect::<Result<Vec<_>, _>>();
    let Err(_) = result else {
        return Err("raw non-ASCII text/plain input was accepted".into());
    };
    Ok(())
}

#[test]
#[cfg(feature = "rdf-12")]
fn generic_rdf_version_configuration_is_explicit() -> Result<(), Box<dyn Error>> {
    let mut turtle = RdfSerializer::from_format(RdfFormat::Turtle)
        .with_rdf_version(RdfVersion::V1_2)?
        .for_writer(Vec::new());
    turtle.serialize_triple(&Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
    ))?;
    assert!(turtle.finish()?.starts_with(b"VERSION \"1.2\"\n"));

    let mut ntriples = RdfSerializer::from_format(RdfFormat::NTriples)
        .with_rdf_version(RdfVersion::V1_2Basic)?
        .for_writer(Vec::new());
    ntriples.serialize_triple(&Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
    ))?;
    assert!(ntriples.finish()?.starts_with(b"VERSION \"1.2-basic\"\n"));

    let Err(error) =
        RdfSerializer::from_format(RdfFormat::RdfXml).with_rdf_version(RdfVersion::V1_2)
    else {
        return Err("RDF/XML unexpectedly accepted an inline version configuration".into());
    };
    assert!(matches!(
        error,
        RdfSerializerConfigError::UnsupportedRdfVersion {
            format: RdfFormat::RdfXml
        }
    ));
    Ok(())
}

#[test]
#[cfg(feature = "rdf-12")]
fn media_type_version_is_retained_emitted_and_enforced() -> Result<(), Box<dyn Error>> {
    let serializer =
        RdfSerializer::from_media_type("application/n-triples; version=\"1.2-basic\"")?;
    assert_eq!(serializer.rdf_version(), Some(RdfVersion::V1_2Basic));
    assert_eq!(
        serializer.for_writer(Vec::new()).finish()?,
        b"VERSION \"1.2-basic\"\n"
    );

    let directional = Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        Literal::new_directional_language_tagged_literal("hello", "en", BaseDirection::Ltr)?,
    );
    let mut rdf_xml =
        RdfSerializer::from_media_type("application/rdf+xml; version=1.1")?.for_writer(Vec::new());
    let Err(error) = rdf_xml.serialize_triple(&directional) else {
        return Err("RDF 1.1 media contract accepted a directional literal".into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);

    let quoted = Triple::new(
        NamedNode::new_unchecked("http://example.com/quoted-s"),
        NamedNode::new_unchecked("http://example.com/quoted-p"),
        NamedNode::new_unchecked("http://example.com/quoted-o"),
    );
    let triple_term = Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        Term::Triple(Box::new(quoted)),
    );
    let mut rdf_xml = RdfSerializer::from_media_type("application/rdf+xml; version=\"1.2-basic\"")?
        .for_writer(Vec::new());
    let Err(error) = rdf_xml.serialize_triple(&triple_term) else {
        return Err("RDF 1.2 Basic media contract accepted a triple term".into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    Ok(())
}

#[test]
#[cfg(feature = "rdf-12")]
fn media_type_version_takes_precedence_over_inline_version() -> Result<(), Box<dyn Error>> {
    let inline_rdf11 = concat!(
        "VERSION \"1.1\"\n",
        "<http://example.com/s> <http://example.com/p> \"hello\"@en--ltr .\n",
    );
    let accepted = RdfParser::from_media_type("application/n-triples; version=1.2")?
        .for_slice(inline_rdf11)
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(accepted.len(), 1);

    let inline_rdf12 = concat!(
        "VERSION \"1.2\"\n",
        "<http://example.com/s> <http://example.com/p> \"hello\"@en--ltr .\n",
    );
    let rejected = RdfParser::from_media_type("application/n-triples; version=1.1")?
        .for_slice(inline_rdf12)
        .collect::<Result<Vec<_>, _>>();
    let Err(_) = rejected else {
        return Err("media-type RDF 1.1 did not override inline RDF 1.2".into());
    };
    Ok(())
}
