#![expect(clippy::panic_in_result_fn)]

#[cfg(feature = "rdf-12")]
use crate::TurtleParser;
use crate::{
    NTriplesMediaType, NTriplesParser, NTriplesSerializer, TriGSerializer, TurtleSerializer,
};
#[cfg(feature = "rdf-12")]
use oxrdf::Quad;
use oxrdf::{BlankNode, NamedNode, RdfVersion, Triple};
use std::error::Error;
use std::io;

fn example_triple() -> Triple {
    Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
    )
}

#[test]
fn turtle_rdf_11_default_is_unchanged() -> Result<(), Box<dyn Error>> {
    let mut serializer = TurtleSerializer::new()
        .with_prefix("ex", "http://example.com/")?
        .for_writer(Vec::new());
    serializer.serialize_triple(&example_triple())?;
    assert_eq!(
        serializer.finish()?,
        b"@prefix ex: <http://example.com/> .\nex:s ex:p ex:o .\n"
    );
    Ok(())
}

#[test]
#[cfg(feature = "rdf-12")]
fn turtle_rdf_12_version_precedes_the_streaming_prelude() -> Result<(), Box<dyn Error>> {
    let mut serializer = TurtleSerializer::new()
        .with_rdf_version(RdfVersion::V1_2)
        .with_prefix("ex", "http://example.com/")?
        .low_level();
    let mut output = Vec::new();
    serializer.serialize_triple(&example_triple(), &mut output)?;
    serializer.finish(&mut output)?;
    assert_eq!(
        output,
        b"VERSION \"1.2\"\n@prefix ex: <http://example.com/> .\nex:s ex:p ex:o .\n"
    );
    #[cfg(feature = "rdf-12")]
    assert_eq!(
        TurtleParser::new()
            .for_slice(&output)
            .collect::<Result<Vec<_>, _>>()?,
        [example_triple()]
    );
    Ok(())
}

#[test]
#[cfg(feature = "rdf-12")]
fn trig_rdf_12_version_is_first() -> Result<(), Box<dyn Error>> {
    let mut serializer = TriGSerializer::new()
        .with_rdf_version(RdfVersion::V1_2)
        .with_prefix("ex", "http://example.com/")?
        .for_writer(Vec::new());
    serializer.serialize_quad(&Quad::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
        NamedNode::new_unchecked("http://example.com/g"),
    ))?;
    assert_eq!(
        serializer.finish()?,
        b"VERSION \"1.2\"\n@prefix ex: <http://example.com/> .\nex:g {\n\tex:s ex:p ex:o .\n}\n"
    );
    Ok(())
}

#[test]
#[cfg(feature = "rdf-12")]
fn empty_terse_documents_emit_the_configured_prelude_once() -> Result<(), Box<dyn Error>> {
    let mut turtle = TurtleSerializer::new()
        .with_rdf_version(RdfVersion::V1_2Basic)
        .with_prefix("ex", "http://example.com/")?
        .low_level();
    let mut output = Vec::new();
    turtle.finish(&mut output)?;
    turtle.finish(&mut output)?;
    assert_eq!(
        output,
        b"VERSION \"1.2-basic\"\n@prefix ex: <http://example.com/> .\n"
    );

    let trig = TriGSerializer::new()
        .with_rdf_version(RdfVersion::V1_2)
        .with_base_iri("http://example.com/")?
        .for_writer(Vec::new());
    assert_eq!(
        trig.finish()?,
        b"VERSION \"1.2\"\n@base <http://example.com/> .\n"
    );
    Ok(())
}

#[test]
#[cfg(not(feature = "rdf-12"))]
fn rdf_12_serialization_requires_the_feature() -> Result<(), Box<dyn Error>> {
    let mut turtle = TurtleSerializer::new()
        .with_rdf_version(RdfVersion::V1_2)
        .low_level();
    let mut turtle_output = Vec::new();
    let Err(error) = turtle.serialize_triple(&example_triple(), &mut turtle_output) else {
        return Err("Turtle emitted RDF 1.2 without the rdf-12 feature".into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(turtle_output.is_empty());

    let mut trig = TriGSerializer::new()
        .with_rdf_version(RdfVersion::V1_2Basic)
        .low_level();
    let mut trig_output = Vec::new();
    let Err(error) = trig.finish(&mut trig_output) else {
        return Err("TriG emitted RDF 1.2 Basic without the rdf-12 feature".into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(trig_output.is_empty());
    Ok(())
}

#[test]
fn invalid_prefix_names_fail_before_writing() -> Result<(), Box<dyn Error>> {
    for prefix in [".bad", "bad.", "1bad", "bad:"] {
        let mut serializer = TurtleSerializer::new()
            .with_rdf_version(RdfVersion::V1_2)
            .with_prefix(prefix, "http://example.com/")?
            .low_level();
        let mut output = Vec::new();
        let Err(error) = serializer.serialize_triple(&example_triple(), &mut output) else {
            return Err(format!("invalid prefix '{prefix}' was accepted").into());
        };
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(output.is_empty());
    }

    let mut serializer = TurtleSerializer::new()
        .with_prefix("\u{e9}", "http://example.com/")?
        .for_writer(Vec::new());
    serializer.serialize_triple(&example_triple())?;
    assert!(
        serializer
            .finish()?
            .starts_with("@prefix \u{e9}:".as_bytes())
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn turtle_rdf_11_rejects_rdf_12_terms_before_writing() -> Result<(), Box<dyn Error>> {
    let quoted = example_triple();
    let containing = Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/says"),
        quoted,
    );
    let mut serializer = TurtleSerializer::new().low_level();
    let mut output = Vec::new();
    let Err(error) = serializer.serialize_triple(&containing, &mut output) else {
        return Err("RDF 1.2 triple term unexpectedly serialized as RDF 1.1".into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(output.is_empty());

    serializer.serialize_triple(&example_triple(), &mut output)?;
    serializer.finish(&mut output)?;
    assert!(!output.starts_with(b"VERSION"));

    let directional = Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/label"),
        oxrdf::Literal::new_directional_language_tagged_literal(
            "hello",
            "en",
            oxrdf::BaseDirection::Ltr,
        )?,
    );
    let mut rdf_11 = TurtleSerializer::new().low_level();
    let mut rejected_output = Vec::new();
    let Err(error) = rdf_11.serialize_triple(&directional, &mut rejected_output) else {
        return Err("directional literal unexpectedly serialized as RDF 1.1".into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(rejected_output.is_empty());

    let mut rdf_12 = TurtleSerializer::new()
        .with_rdf_version(RdfVersion::V1_2)
        .for_writer(Vec::new());
    rdf_12.serialize_triple(&directional)?;
    assert!(rdf_12.finish()?.starts_with(b"VERSION \"1.2\"\n"));
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn turtle_rdf_12_basic_accepts_direction_but_rejects_triple_terms() -> Result<(), Box<dyn Error>> {
    let directional = Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/label"),
        oxrdf::Literal::new_directional_language_tagged_literal(
            "hello",
            "en",
            oxrdf::BaseDirection::Ltr,
        )?,
    );
    let mut serializer = TurtleSerializer::new()
        .with_rdf_version(RdfVersion::V1_2Basic)
        .for_writer(Vec::new());
    serializer.serialize_triple(&directional)?;
    assert!(serializer.finish()?.starts_with(b"VERSION \"1.2-basic\"\n"));

    let triple_term = Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/says"),
        example_triple(),
    );
    let mut serializer = TurtleSerializer::new()
        .with_rdf_version(RdfVersion::V1_2Basic)
        .low_level();
    let mut output = Vec::new();
    let Err(error) = serializer.serialize_triple(&triple_term, &mut output) else {
        return Err("RDF 1.2 Basic unexpectedly accepted a triple term".into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(output.is_empty());
    Ok(())
}

#[test]
fn ntriples_text_plain_escapes_non_ascii() -> Result<(), Box<dyn Error>> {
    let triple = Triple::new(
        NamedNode::new_unchecked("http://example.com/caf\u{e9}"),
        NamedNode::new_unchecked("http://example.com/p"),
        oxrdf::Literal::new_simple_literal("caf\u{e9} \u{1f600}"),
    );
    let mut utf8 = NTriplesSerializer::new().for_writer(Vec::new());
    utf8.serialize_triple(&triple)?;
    assert_eq!(
        utf8.finish()?,
        "<http://example.com/caf\u{e9}> <http://example.com/p> \"caf\u{e9} \u{1f600}\" .\n"
            .as_bytes()
    );

    let mut ascii = NTriplesSerializer::new()
        .with_media_type(NTriplesMediaType::TextPlain)
        .for_writer(Vec::new());
    ascii.serialize_triple(&triple)?;
    let output = ascii.finish()?;
    assert!(output.is_ascii());
    assert_eq!(
        output,
        b"<http://example.com/caf\\u00E9> <http://example.com/p> \"caf\\u00E9 \\U0001F600\" .\n"
    );
    assert_eq!(
        NTriplesParser::new()
            .for_slice(&output)
            .collect::<Result<Vec<_>, _>>()?,
        [triple]
    );
    Ok(())
}

#[test]
fn ntriples_text_plain_rejects_unescapable_blank_node_ids() -> Result<(), Box<dyn Error>> {
    let triple = Triple::new(
        BlankNode::new_unchecked("\u{e9}"),
        NamedNode::new_unchecked("http://example.com/p"),
        NamedNode::new_unchecked("http://example.com/o"),
    );
    let mut serializer = NTriplesSerializer::new()
        .with_media_type(NTriplesMediaType::TextPlain)
        .low_level();
    let mut output = Vec::new();
    let Err(error) = serializer.serialize_triple(&triple, &mut output) else {
        return Err("non-ASCII blank node unexpectedly serialized".into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(output.is_empty());
    Ok(())
}

#[test]
fn ntriples_text_plain_parser_rejects_raw_non_ascii_everywhere() -> Result<(), Box<dyn Error>> {
    let raw_literal = "<http://example.com/s> <http://example.com/p> \"caf\u{e9}\" .\n";
    let raw_comment =
        "# caf\u{e9}\n<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n";
    for input in [raw_literal, raw_comment] {
        let result = NTriplesParser::new()
            .with_media_type(NTriplesMediaType::TextPlain)
            .for_slice(input)
            .collect::<Result<Vec<_>, _>>();
        assert!(result.is_err(), "raw non-ASCII input was accepted: {input}");
        let result = NTriplesParser::new()
            .with_media_type(NTriplesMediaType::TextPlain)
            .for_reader(input.as_bytes())
            .collect::<Result<Vec<_>, _>>();
        assert!(
            result.is_err(),
            "streaming raw non-ASCII input was accepted: {input}"
        );
    }

    let mut low_level = NTriplesParser::new()
        .with_media_type(NTriplesMediaType::TextPlain)
        .low_level();
    low_level.extend_from_slice(raw_literal.as_bytes());
    low_level.end();
    assert!(low_level.parse_next().is_some_and(|result| result.is_err()));

    let parallel = NTriplesParser::new()
        .with_media_type(NTriplesMediaType::TextPlain)
        .split_slice_for_parallel_parsing(raw_literal, 4)
        .into_iter()
        .flatten()
        .collect::<Result<Vec<_>, _>>();
    let Err(_) = parallel else {
        return Err("parallel raw non-ASCII input was accepted".into());
    };
    Ok(())
}

#[test]
fn ntriples_text_plain_parser_accepts_unicode_escapes() -> Result<(), Box<dyn Error>> {
    let input = b"<http://example.com/s> <http://example.com/p> \"caf\\u00E9\" .\n";
    let triples = NTriplesParser::new()
        .with_media_type(NTriplesMediaType::TextPlain)
        .for_reader(input.as_slice())
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(triples.len(), 1);
    assert_eq!(triples[0].object.to_string(), "\"caf\u{e9}\"");
    Ok(())
}

#[cfg(feature = "async-tokio")]
#[tokio::test]
async fn async_serializers_honor_version_and_media_type() -> Result<(), Box<dyn Error>> {
    #[cfg(feature = "rdf-12")]
    {
        let empty = TurtleSerializer::new()
            .with_rdf_version(RdfVersion::V1_2Basic)
            .for_tokio_async_writer(Vec::new());
        assert_eq!(empty.finish().await?, b"VERSION \"1.2-basic\"\n");

        let mut turtle = TurtleSerializer::new()
            .with_rdf_version(RdfVersion::V1_2)
            .for_tokio_async_writer(Vec::new());
        turtle.serialize_triple(&example_triple()).await?;
        assert!(turtle.finish().await?.starts_with(b"VERSION \"1.2\"\n"));
    }

    let triple = Triple::new(
        NamedNode::new_unchecked("http://example.com/s"),
        NamedNode::new_unchecked("http://example.com/p"),
        oxrdf::Literal::new_simple_literal("\u{e9}"),
    );
    let mut text = NTriplesSerializer::new()
        .with_media_type(NTriplesMediaType::TextPlain)
        .for_tokio_async_writer(Vec::new());
    text.serialize_triple(&triple).await?;
    assert_eq!(
        text.finish().await?,
        b"<http://example.com/s> <http://example.com/p> \"\\u00E9\" .\n"
    );

    let raw = "<http://example.com/s> <http://example.com/p> \"caf\u{e9}\" .\n";
    let mut parser = NTriplesParser::new()
        .with_media_type(NTriplesMediaType::TextPlain)
        .for_tokio_async_reader(raw.as_bytes());
    assert!(parser.next().await.is_some_and(|result| result.is_err()));
    Ok(())
}
