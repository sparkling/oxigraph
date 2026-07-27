#![expect(clippy::panic_in_result_fn)]

use super::writer::split_iri;
use super::*;
use crate::RdfXmlParser;
#[cfg(feature = "rdf-12")]
use oxrdf::BaseDirection;
use oxrdf::vocab::rdf;
use oxrdf::{BlankNode, Literal, NamedNode, Term, Triple};
use std::error::Error;
use std::io;

fn serialize(serializer: RdfXmlSerializer, triples: &[Triple]) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut writer = serializer.for_writer(Vec::new());
    for triple in triples {
        writer.serialize_triple(triple)?;
    }
    Ok(writer.finish()?)
}

fn parse(input: &[u8]) -> Result<Vec<Triple>, Box<dyn Error>> {
    Ok(RdfXmlParser::new()
        .for_slice(input)
        .collect::<Result<_, _>>()?)
}

#[test]
fn splits_iris_at_valid_xml_local_names() {
    assert_eq!(
        split_iri("http://schema.org/Person"),
        ("http://schema.org/", "Person")
    );
    assert_eq!(split_iri("http://schema.org/"), ("http://schema.org/", ""));
    assert_eq!(
        split_iri("http://schema.org#foo"),
        ("http://schema.org#", "foo")
    );
    assert_eq!(split_iri("urn:isbn:foo"), ("urn:isbn:", "foo"));
    assert_eq!(
        split_iri("http://example.com/1predicate"),
        ("http://example.com/1", "predicate")
    );
    assert_eq!(
        split_iri("http://example.com/%41name"),
        ("http://example.com/%41", "name")
    );
}

#[test]
fn fixed_prefixes_cannot_be_overridden() -> Result<(), Box<dyn Error>> {
    let output = RdfXmlSerializer::new()
        .with_prefix("rdf", "http://example.com/not-rdf")?
        .with_prefix("its", "http://example.com/not-its")?
        .with_prefix("xml", "http://example.com/not-xml")?
        .for_writer(Vec::new())
        .finish()?;
    assert_eq!(
        output,
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:its=\"http://www.w3.org/2005/11/its\">\n</rdf:RDF>"
    );
    Ok(())
}

#[test]
fn default_and_duplicate_namespace_bindings_round_trip() -> Result<(), Box<dyn Error>> {
    let triple = Triple::new(
        NamedNode::new("http://example.com/s")?,
        NamedNode::new("http://example.com/ns#p")?,
        NamedNode::new("http://example.com/o")?,
    );
    let output = serialize(
        RdfXmlSerializer::new()
            .with_prefix("", "http://example.com/ns#")?
            .with_prefix("ex", "http://example.com/ns#")?,
        std::slice::from_ref(&triple),
    )?;
    let text = String::from_utf8_lossy(&output);
    assert!(text.contains("xmlns=\"http://example.com/ns#\""));
    assert!(text.contains("xmlns:ex=\"http://example.com/ns#\""));
    assert!(text.contains("<p rdf:resource="));
    assert_eq!(parse(&output)?, [triple]);
    Ok(())
}

#[test]
fn percent_escaped_namespace_boundary_round_trips() -> Result<(), Box<dyn Error>> {
    let triple = Triple::new(
        NamedNode::new("http://example.com/s")?,
        NamedNode::new("http://example.com/%41name")?,
        NamedNode::new("http://example.com/o")?,
    );
    let output = serialize(RdfXmlSerializer::new(), std::slice::from_ref(&triple))?;
    assert!(
        String::from_utf8_lossy(&output)
            .contains("<name xmlns=\"http://example.com/%41\" rdf:resource=")
    );
    assert_eq!(parse(&output)?, [triple]);
    Ok(())
}

#[test]
fn blank_node_ids_are_injective_xml_nc_names() -> Result<(), Box<dyn Error>> {
    let first = BlankNode::new("0")?;
    let second = BlankNode::new("b30")?;
    let predicate = NamedNode::new("http://example.com/p")?;
    let triples = vec![
        Triple::new(first.clone(), predicate.clone(), second.clone()),
        Triple::new(second, predicate, first),
    ];
    let output = serialize(RdfXmlSerializer::new(), &triples)?;
    let text = String::from_utf8_lossy(&output);
    assert!(text.contains("rdf:nodeID=\"b30\""));
    assert!(text.contains("rdf:nodeID=\"b623330\""));

    let actual = parse(&output)?;
    assert_eq!(actual.len(), triples.len());
    assert_ne!(
        Term::from(actual[0].subject.clone()),
        actual[0].object.clone()
    );
    assert_eq!(
        Term::from(actual[0].subject.clone()),
        actual[1].object.clone()
    );
    assert_eq!(actual[0].object, Term::from(actual[1].subject.clone()));
    Ok(())
}

#[test]
fn unrepresentable_predicate_is_atomic_and_typed_node_falls_back() -> Result<(), Box<dyn Error>> {
    let subject = NamedNode::new("http://example.com/s")?;
    let mut writer = RdfXmlSerializer::new().for_writer(Vec::new());
    let Err(error) = writer.serialize_triple(&Triple::new(
        subject.clone(),
        NamedNode::new("http://example.com/123")?,
        NamedNode::new("http://example.com/o")?,
    )) else {
        return Err(io::Error::other("a numeric-only QName local part was accepted").into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);

    let typed = Triple::new(
        subject.clone(),
        rdf::TYPE,
        NamedNode::new("http://example.com/123")?,
    );
    let valid = Triple::new(
        subject,
        NamedNode::new("http://example.com/p")?,
        NamedNode::new("http://example.com/o")?,
    );
    writer.serialize_triple(&typed)?;
    writer.serialize_triple(&valid)?;
    let output = writer.finish()?;
    let text = String::from_utf8_lossy(&output);
    assert!(text.contains("<rdf:Description"));
    assert!(text.contains("<rdf:type rdf:resource=\"http://example.com/123\"/>"));
    assert_eq!(parse(&output)?, [typed, valid]);
    Ok(())
}

#[test]
fn reserved_and_prohibited_property_iris_fail_closed() -> Result<(), Box<dyn Error>> {
    let subject = NamedNode::new("http://example.com/s")?;
    let object = NamedNode::new("http://example.com/o")?;
    for predicate in [
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#annotation",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#annotationNodeID",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#version",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#aboutEach",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#bagID",
        "http://www.w3.org/2000/xmlns/property",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#extension/property",
    ] {
        let Err(error) = RdfXmlSerializer::new()
            .for_writer(Vec::new())
            .serialize_triple(&Triple::new(
                subject.clone(),
                NamedNode::new(predicate)?,
                object.clone(),
            ))
        else {
            return Err(io::Error::other(format!(
                "reserved property IRI was accepted: {predicate}"
            ))
            .into());
        };
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{predicate}");
    }
    Ok(())
}

#[test]
fn invalid_namespace_configuration_fails_before_writing() -> Result<(), Box<dyn Error>> {
    for (prefix, namespace) in [
        ("bad:name", "http://example.com/ns#"),
        ("1bad", "http://example.com/ns#"),
        ("xmlns", "http://example.com/ns#"),
        ("XmLextension", "http://example.com/ns#"),
        ("ex", "http://www.w3.org/XML/1998/namespace"),
        (
            "ex",
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#extension/",
        ),
    ] {
        let Err(error) = RdfXmlSerializer::new()
            .with_prefix(prefix, namespace)?
            .for_writer(Vec::new())
            .finish()
        else {
            return Err(io::Error::other(format!(
                "invalid namespace prefix was accepted: {prefix}"
            ))
            .into());
        };
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{prefix}");
    }
    Ok(())
}

#[test]
fn language_datatype_and_base_iri_round_trip() -> Result<(), Box<dyn Error>> {
    let subject = NamedNode::new("http://example.com/base/subject")?;
    let triples = vec![
        Triple::new(
            subject.clone(),
            NamedNode::new("http://example.com/ns#label")?,
            Literal::new_language_tagged_literal("bonjour", "fr")?,
        ),
        Triple::new(
            subject,
            NamedNode::new("http://example.com/ns#value")?,
            Literal::new_typed_literal(
                "value",
                NamedNode::new("http://example.com/base/datatype")?,
            ),
        ),
    ];
    let output = serialize(
        RdfXmlSerializer::new()
            .with_base_iri("http://example.com/base/")?
            .with_prefix("ex", "http://example.com/ns#")?,
        &triples,
    )?;
    let text = String::from_utf8_lossy(&output);
    assert!(text.contains("xml:base=\"http://example.com/base/\""));
    assert!(text.contains("rdf:about=\"subject\""));
    assert!(text.contains("xml:lang=\"fr\""));
    assert!(text.contains("rdf:datatype=\"datatype\""));
    assert_eq!(parse(&output)?, triples);
    Ok(())
}

#[test]
fn xml_10_literal_text_preserves_carriage_returns_and_rejects_forbidden_characters()
-> Result<(), Box<dyn Error>> {
    let subject = NamedNode::new("http://example.com/s")?;
    let predicate = NamedNode::new("http://example.com/ns#value")?;
    let preserved = Triple::new(
        subject.clone(),
        predicate.clone(),
        Literal::from("before\r<&>\"'after"),
    );
    let output = serialize(
        RdfXmlSerializer::new().with_prefix("ex", "http://example.com/ns#")?,
        std::slice::from_ref(&preserved),
    )?;
    let text = String::from_utf8(output.clone())?;
    assert!(text.contains("before&#13;&lt;&amp;&gt;&quot;&apos;after"));
    assert_eq!(parse(&output)?, std::slice::from_ref(&preserved));

    let invalid = Triple::new(
        subject.clone(),
        predicate.clone(),
        Literal::from("not XML \u{1}"),
    );
    let following = Triple::new(subject, predicate, Literal::from("still valid"));
    let mut writer = RdfXmlSerializer::new()
        .with_prefix("ex", "http://example.com/ns#")?
        .for_writer(Vec::new());
    writer.serialize_triple(&preserved)?;
    let Err(error) = writer.serialize_triple(&invalid) else {
        return Err(io::Error::other("XML 1.0-forbidden literal text must fail closed").into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    writer.serialize_triple(&following)?;
    assert_eq!(parse(&writer.finish()?)?, [preserved, following]);
    Ok(())
}

#[cfg(feature = "rdf-12")]
fn rdf_12_nested_graph() -> Result<Vec<Triple>, Box<dyn Error>> {
    let root = NamedNode::new("http://example.com/base/root")?;
    let inner = Triple::new(
        NamedNode::new("http://example.com/base/inner")?,
        NamedNode::new("http://third.example/ns#direction")?,
        Literal::new_directional_language_tagged_literal(
            "\u{645}\u{631}\u{62d}\u{628}\u{627}",
            "ar",
            BaseDirection::Rtl,
        )?,
    );
    let middle = Triple::new(
        NamedNode::new("http://example.com/base/middle")?,
        NamedNode::new("http://second.example/ns#nested")?,
        inner,
    );
    Ok(vec![
        Triple::new(
            root.clone(),
            NamedNode::new("http://first.example/ns#statement")?,
            middle,
        ),
        Triple::new(
            root,
            NamedNode::new("http://default.example/ns#plain")?,
            Literal::new_language_tagged_literal("plain", "ar")?,
        ),
    ])
}

#[cfg(feature = "rdf-12")]
#[test]
fn recursive_triple_terms_use_distinct_fallback_namespaces() -> Result<(), Box<dyn Error>> {
    let triples = rdf_12_nested_graph()?;
    let output = serialize(
        RdfXmlSerializer::new()
            .with_base_iri("http://example.com/base/")?
            .with_prefix("", "http://default.example/ns#")?,
        &triples,
    )?;
    let text = String::from_utf8_lossy(&output);
    assert!(text.contains("xmlns:oxprefix=\"http://first.example/ns#\""));
    assert!(text.contains("xmlns:oxprefix1=\"http://second.example/ns#\""));
    assert!(text.contains("xmlns:oxprefix2=\"http://third.example/ns#\""));
    assert!(text.contains("rdf:parseType=\"Triple\""));
    assert!(text.contains("xml:lang=\"ar\""));
    assert!(text.contains("its:dir=\"rtl\""));
    assert!(text.contains("<plain xml:lang=\"ar\">plain</plain>"));
    assert_eq!(parse(&output)?, triples);
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn invalid_recursive_predicate_does_not_mutate_open_subject() -> Result<(), Box<dyn Error>> {
    let subject = NamedNode::new("http://example.com/s")?;
    let first = Triple::new(
        subject.clone(),
        NamedNode::new("http://example.com/first")?,
        NamedNode::new("http://example.com/o1")?,
    );
    let invalid = Triple::new(
        subject.clone(),
        NamedNode::new("http://example.com/nested")?,
        Triple::new(
            NamedNode::new("http://example.com/inner")?,
            NamedNode::new("http://example.com/123")?,
            NamedNode::new("http://example.com/o")?,
        ),
    );
    let second = Triple::new(
        subject,
        NamedNode::new("http://example.com/second")?,
        NamedNode::new("http://example.com/o2")?,
    );

    let mut writer = RdfXmlSerializer::new().for_writer(Vec::new());
    writer.serialize_triple(&first)?;
    let Err(error) = writer.serialize_triple(&invalid) else {
        return Err(io::Error::other("an invalid recursive predicate was accepted").into());
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    writer.serialize_triple(&second)?;
    assert_eq!(parse(&writer.finish()?)?, [first, second]);
    Ok(())
}

#[test]
fn unchecked_invalid_terms_fail_before_mutating_output() -> Result<(), Box<dyn Error>> {
    let valid = Triple::new(
        NamedNode::new("http://example.com/s")?,
        NamedNode::new("http://example.com/p")?,
        Literal::from("valid"),
    );
    let invalid_iri = Triple::new(
        NamedNode::new_unchecked("http://example.com/invalid IRI"),
        NamedNode::new("http://example.com/p")?,
        Literal::from("invalid"),
    );
    let invalid_language = Triple::new(
        NamedNode::new("http://example.com/s")?,
        NamedNode::new("http://example.com/p")?,
        Literal::new_language_tagged_literal_unchecked("invalid", "not_a_tag"),
    );
    for invalid in [invalid_iri, invalid_language] {
        let mut serializer = RdfXmlSerializer::new().for_writer(Vec::new());
        let Err(error) = serializer.serialize_triple(&invalid) else {
            return Err(io::Error::other("an unchecked invalid RDF term was serialized").into());
        };
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        serializer.serialize_triple(&valid)?;
        assert_eq!(parse(&serializer.finish()?)?, std::slice::from_ref(&valid));
    }
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn asserted_and_annotated_triple_round_trips() -> Result<(), Box<dyn Error>> {
    let asserted = Triple::new(
        NamedNode::new("http://example.com/s")?,
        NamedNode::new("http://example.com/ns#label")?,
        Literal::new_language_tagged_literal("hello", "en")?,
    );
    let triples = vec![
        asserted.clone(),
        Triple::new(
            NamedNode::new("http://example.com/reifier")?,
            rdf::REIFIES,
            asserted,
        ),
    ];
    let output = serialize(
        RdfXmlSerializer::new().with_prefix("ex", "http://example.com/ns#")?,
        &triples,
    )?;
    let text = String::from_utf8_lossy(&output);
    assert!(text.contains("<rdf:reifies rdf:version=\"1.2\" rdf:parseType=\"Triple\">"));
    assert_eq!(parse(&output)?, triples);
    Ok(())
}

#[cfg(all(feature = "rdf-12", feature = "async-tokio"))]
#[tokio::test]
async fn sync_and_async_serializers_are_byte_identical() -> Result<(), Box<dyn Error>> {
    let triples = rdf_12_nested_graph()?;
    let serializer = RdfXmlSerializer::new()
        .with_base_iri("http://example.com/base/")?
        .with_prefix("", "http://default.example/ns#")?;
    let sync = serialize(serializer.clone(), &triples)?;

    let mut async_writer = serializer.for_tokio_async_writer(Vec::new());
    for triple in &triples {
        async_writer.serialize_triple(triple).await?;
    }
    let asynchronous = async_writer.finish().await?;
    assert_eq!(asynchronous, sync);
    assert_eq!(parse(&asynchronous)?, triples);

    let invalid = Triple::new(
        NamedNode::new("http://example.com/s")?,
        NamedNode::new("http://example.com/p")?,
        Triple::new(
            NamedNode::new("http://example.com/nested")?,
            NamedNode::new("http://example.com/123")?,
            NamedNode::new("http://example.com/o")?,
        ),
    );
    let sync_error = RdfXmlSerializer::new()
        .for_writer(Vec::new())
        .serialize_triple(&invalid)
        .err()
        .ok_or_else(|| io::Error::other("sync serializer accepted an invalid nested predicate"))?;
    let mut async_writer = RdfXmlSerializer::new().for_tokio_async_writer(Vec::new());
    let async_error = async_writer
        .serialize_triple(&invalid)
        .await
        .err()
        .ok_or_else(|| io::Error::other("async serializer accepted an invalid nested predicate"))?;
    assert_eq!(async_error.kind(), sync_error.kind());
    Ok(())
}
