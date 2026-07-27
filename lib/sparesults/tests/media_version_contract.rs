#![expect(clippy::panic_in_result_fn, clippy::tests_outside_test_module)]

use oxrdf::RdfVersion;
#[cfg(feature = "sparql-12")]
use oxrdf::{BaseDirection, Literal, NamedNode, Term, Triple, Variable};
use sparesults::{
    QueryResultsCharset, QueryResultsFormat, QueryResultsMediaType,
    QueryResultsMediaTypeParseError, QueryResultsParser, QueryResultsSerializer,
    QueryResultsSerializerConfigError, ReaderQueryResultsParserOutput,
    SliceQueryResultsParserOutput,
};
use std::error::Error;
#[cfg(feature = "sparql-12")]
use std::iter::once;
const JSON_DIRECTIONAL: &str = r#"{"head":{"vars":["value"],"version":"1.2"},"results":{"bindings":[{"value":{"type":"literal","value":"hello","xml:lang":"en","its:dir":"rtl"}}]}}"#;
#[cfg(feature = "sparql-12")]
const JSON_DIRECTIONAL_RESULTS_FIRST: &str = r#"{"results":{"bindings":[{"value":{"type":"literal","value":"hello","xml:lang":"en","its:dir":"rtl"}}]},"head":{"vars":["value"],"version":"1.1"}}"#;
#[cfg(any(feature = "sparql-12", feature = "async-tokio"))]
const XML_DIRECTIONAL: &str = r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#" xmlns:its="http://www.w3.org/2005/11/its" version="1.1"><head><variable name="value"/></head><results><result><binding name="value"><literal xml:lang="en" its:dir="rtl">hello</literal></binding></result></results></sparql>"#;
const JSON_NON_ASCII: &str = concat!(
    r#"{"head":{"vars":["value"]},"results":{"bindings":[{"value":{"type":"literal","value":"caf"#,
    "\u{e9}",
    r#""}}]}}"#,
);
const JSON_ASCII_ESCAPE: &str = r#"{"head":{"vars":["value"]},"results":{"bindings":[{"value":{"type":"literal","value":"caf\u00e9"}}]}}"#;
const XML_NON_ASCII: &str = concat!(
    r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value"><literal>caf"#,
    "\u{e9}",
    r#"</literal></binding></result></results></sparql>"#,
);
const XML_ASCII_ESCAPE: &str = r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value"><literal>caf&#xE9;</literal></binding></result></results></sparql>"#;
#[test]
fn media_type_parameters_are_quote_aware_and_case_insensitive() -> Result<(), Box<dyn Error>> {
    let descriptor = QueryResultsMediaType::parse(concat!(
        "Application/SPARQL-Results+JSON;",
        " VERSION=\"1.2-basic\";",
        " CHARSET=\"UTF-8\";",
        " extension=\"quoted;value\"",
    ))?;
    assert_eq!(descriptor.format(), QueryResultsFormat::Json);
    assert_eq!(descriptor.version(), Some(RdfVersion::V1_2Basic));
    assert_eq!(descriptor.charset(), Some(QueryResultsCharset::Utf8));

    let descriptor = QueryResultsMediaType::parse("application/sparql-results+xml; charset=ASCII")?;
    assert_eq!(descriptor.format(), QueryResultsFormat::Xml);
    assert_eq!(descriptor.charset(), Some(QueryResultsCharset::UsAscii));

    let parser = QueryResultsParser::from_media_type(concat!(
        "application/sparql-results+json;",
        " VeRsIoN=\"1.2\";",
        " ChArSeT=\"ascii\"",
    ))?;
    assert_eq!(parser.rdf_version(), Some(RdfVersion::V1_2));
    assert_eq!(parser.charset(), Some(QueryResultsCharset::UsAscii));

    let descriptor = QueryResultsMediaType::parse("text/csv; header=present; charset=utf-8")?;
    assert_eq!(descriptor.format(), QueryResultsFormat::Csv);
    assert_eq!(descriptor.charset(), Some(QueryResultsCharset::Utf8));
    let descriptor = QueryResultsMediaType::parse("text/tab-separated-values")?;
    assert_eq!(descriptor.charset(), Some(QueryResultsCharset::UsAscii));
    Ok(())
}

#[test]
fn media_type_rejects_duplicate_or_incompatible_parameters() -> Result<(), Box<dyn Error>> {
    assert!(matches!(
        QueryResultsMediaType::parse("application/sparql-results+json; version=1.1; VERSION=1.2"),
        Err(QueryResultsMediaTypeParseError::DuplicateParameter(
            "version"
        ))
    ));
    assert!(matches!(
        QueryResultsMediaType::parse(
            "application/sparql-results+xml; charset=utf-8; CHARSET=ascii"
        ),
        Err(QueryResultsMediaTypeParseError::DuplicateParameter(
            "charset"
        ))
    ));
    assert!(matches!(
        QueryResultsMediaType::parse("application/sparql-results+json; charset=utf-16"),
        Err(QueryResultsMediaTypeParseError::UnsupportedCharset(_))
    ));
    assert!(matches!(
        QueryResultsMediaType::parse("application/sparql-results+xml; version=2"),
        Err(QueryResultsMediaTypeParseError::UnsupportedVersion(_))
    ));
    let xml = QueryResultsMediaType::parse("application/sparql-results+xml; version=1.2")?;
    assert_eq!(xml.format(), QueryResultsFormat::Xml);
    assert_eq!(xml.version(), Some(RdfVersion::V1_2));
    assert!(matches!(
        QueryResultsMediaType::parse("text/csv; version=1.2"),
        Err(
            QueryResultsMediaTypeParseError::VersionNotSupportedForFormat {
                format: QueryResultsFormat::Csv
            }
        )
    ));
    assert!(matches!(
        QueryResultsMediaType::parse("text/csv; header=absent"),
        Err(QueryResultsMediaTypeParseError::UnsupportedCsvHeader(value))
            if value == "absent"
    ));
    assert!(matches!(
        QueryResultsMediaType::parse("text/csv; header=present; HEADER=present"),
        Err(QueryResultsMediaTypeParseError::DuplicateParameter(
            "header"
        ))
    ));
    assert!(matches!(
        QueryResultsMediaType::parse("application/sparql-results+json; note=\"unterminated"),
        Err(QueryResultsMediaTypeParseError::Malformed)
    ));
    Ok(())
}

fn parses_slice_fully(media_type: &str, input: &str) -> bool {
    let Ok(parser) = QueryResultsParser::from_media_type(media_type) else {
        return false;
    };
    let Ok(output) = parser.for_slice(input) else {
        return false;
    };
    match output {
        SliceQueryResultsParserOutput::Boolean(_) => true,
        SliceQueryResultsParserOutput::Solutions(mut solutions) => {
            solutions.all(|solution| solution.is_ok())
        }
    }
}

fn parses_reader_fully(media_type: &str, input: &str) -> bool {
    let Ok(parser) = QueryResultsParser::from_media_type(media_type) else {
        return false;
    };
    let Ok(output) = parser.for_reader(input.as_bytes()) else {
        return false;
    };
    match output {
        ReaderQueryResultsParserOutput::Boolean(_) => true,
        ReaderQueryResultsParserOutput::Solutions(mut solutions) => {
            solutions.all(|solution| solution.is_ok())
        }
    }
}

#[test]
fn us_ascii_charset_is_enforced_on_input_octets() {
    for (media_type, raw_non_ascii, ascii_escape) in [
        (
            "application/sparql-results+json; charset=US-ASCII",
            JSON_NON_ASCII,
            JSON_ASCII_ESCAPE,
        ),
        (
            "application/sparql-results+xml; charset=US-ASCII",
            XML_NON_ASCII,
            XML_ASCII_ESCAPE,
        ),
    ] {
        assert!(!parses_slice_fully(media_type, raw_non_ascii));
        assert!(!parses_reader_fully(media_type, raw_non_ascii));
        assert!(parses_slice_fully(media_type, ascii_escape));
        assert!(parses_reader_fully(media_type, ascii_escape));
    }

    for (media_type, raw_non_ascii) in [
        (
            "application/sparql-results+json; charset=utf-8",
            JSON_NON_ASCII,
        ),
        (
            "application/sparql-results+xml; charset=utf-8",
            XML_NON_ASCII,
        ),
        (
            "text/tab-separated-values; charset=utf-8",
            "?value\n\"caf\u{e9}\"\n",
        ),
    ] {
        assert!(parses_slice_fully(media_type, raw_non_ascii));
        assert!(parses_reader_fully(media_type, raw_non_ascii));
    }
    assert!(!parses_slice_fully(
        "text/tab-separated-values; charset=us-ascii",
        "?value\n\"caf\u{e9}\"\n"
    ));
    assert!(!parses_reader_fully(
        "text/tab-separated-values; charset=us-ascii",
        "?value\n\"caf\u{e9}\"\n"
    ));
    assert!(!parses_slice_fully(
        "text/tab-separated-values",
        "?value\n\"caf\u{e9}\"\n"
    ));
    assert!(!parses_reader_fully(
        "text/tab-separated-values",
        "?value\n\"caf\u{e9}\"\n"
    ));
}

#[cfg(feature = "sparql-12")]
#[test]
fn external_media_version_overrides_inline_json_version() {
    for input in [JSON_DIRECTIONAL, JSON_DIRECTIONAL_RESULTS_FIRST] {
        assert!(parses_slice_fully(
            "application/sparql-results+json; version=1.2",
            input
        ));
        assert!(parses_reader_fully(
            "application/sparql-results+json; version=1.2",
            input
        ));
        assert!(!parses_slice_fully(
            "application/sparql-results+json; version=1.1",
            input
        ));
        assert!(!parses_reader_fully(
            "application/sparql-results+json; version=1.1",
            input
        ));
    }

    assert!(!parses_slice_fully(
        "application/sparql-results+xml",
        XML_DIRECTIONAL
    ));
    assert!(!parses_reader_fully(
        "application/sparql-results+xml",
        XML_DIRECTIONAL
    ));
    assert!(parses_slice_fully(
        "application/sparql-results+xml; version=1.2",
        XML_DIRECTIONAL
    ));
    assert!(parses_reader_fully(
        "application/sparql-results+xml; version=1.2",
        XML_DIRECTIONAL
    ));
    assert!(!parses_slice_fully(
        "application/sparql-results+xml; version=1.1",
        XML_DIRECTIONAL
    ));
    assert!(!parses_reader_fully(
        "application/sparql-results+xml; version=1.1",
        XML_DIRECTIONAL
    ));
}

#[test]
fn configured_select_and_legacy_serializers_have_specified_wire_contracts()
-> Result<(), Box<dyn Error>> {
    let json = QueryResultsSerializer::from_format(QueryResultsFormat::Json)
        .with_rdf_version(RdfVersion::V1_2Basic)?
        .serialize_solutions_to_writer(Vec::new(), Vec::new())?
        .finish()?;
    assert_eq!(
        json,
        br#"{"head":{"version":"1.2-basic","vars":[]},"results":{"bindings":[]}}"#
    );
    let legacy_json = QueryResultsSerializer::from_format(QueryResultsFormat::Json)
        .serialize_boolean_to_writer(Vec::new(), true)?;
    assert_eq!(legacy_json, br#"{"head":{},"boolean":true}"#);
    let legacy_xml = QueryResultsSerializer::from_format(QueryResultsFormat::Xml)
        .serialize_boolean_to_writer(Vec::new(), false)?;
    assert_eq!(
        legacy_xml,
        br#"<?xml version="1.0"?><sparql xmlns="http://www.w3.org/2005/sparql-results#"><head></head><boolean>false</boolean></sparql>"#
    );
    let versioned_xml = QueryResultsSerializer::from_format(QueryResultsFormat::Xml)
        .with_rdf_version(RdfVersion::V1_2)?
        .serialize_boolean_to_writer(Vec::new(), false)?;
    assert_eq!(
        versioned_xml,
        br#"<?xml version="1.0"?><sparql xmlns="http://www.w3.org/2005/sparql-results#" version="1.2"><head></head><boolean>false</boolean></sparql>"#
    );
    assert!(matches!(
        QueryResultsSerializer::from_format(QueryResultsFormat::Csv)
            .with_rdf_version(RdfVersion::V1_2),
        Err(QueryResultsSerializerConfigError::UnsupportedFormat {
            format: QueryResultsFormat::Csv
        })
    ));
    assert!(matches!(
        QueryResultsSerializer::from_format(QueryResultsFormat::Tsv)
            .with_rdf_version(RdfVersion::V1_1),
        Err(QueryResultsSerializerConfigError::UnsupportedFormat {
            format: QueryResultsFormat::Tsv
        })
    ));
    Ok(())
}

#[cfg(feature = "sparql-12")]
fn nested_directional_triple() -> Result<Term, Box<dyn Error>> {
    Ok(Triple::new(
        NamedNode::new("https://example.com/s")?,
        NamedNode::new("https://example.com/p")?,
        Literal::new_directional_language_tagged_literal("hello", "en", BaseDirection::Rtl)?,
    )
    .into())
}

#[cfg(feature = "sparql-12")]
#[test]
fn serializer_validates_a_complete_row_before_writing_it() -> Result<(), Box<dyn Error>> {
    let variable = Variable::new("value")?;
    let directional: Term =
        Literal::new_directional_language_tagged_literal("hello", "en", BaseDirection::Rtl)?.into();
    let mut json = QueryResultsSerializer::from_format(QueryResultsFormat::Json)
        .with_rdf_version(RdfVersion::V1_1)?
        .serialize_solutions_to_writer(Vec::new(), vec![variable.clone()])?;
    assert!(json.serialize(once((&variable, &directional))).is_err());
    assert_eq!(
        json.finish()?,
        br#"{"head":{"version":"1.1","vars":["value"]},"results":{"bindings":[]}}"#
    );

    let triple = nested_directional_triple()?;
    let mut basic = QueryResultsSerializer::from_format(QueryResultsFormat::Json)
        .with_rdf_version(RdfVersion::V1_2Basic)?
        .serialize_solutions_to_writer(Vec::new(), vec![variable.clone()])?;
    assert!(basic.serialize(once((&variable, &triple))).is_err());
    assert_eq!(
        basic.finish()?,
        br#"{"head":{"version":"1.2-basic","vars":["value"]},"results":{"bindings":[]}}"#
    );

    let mut full = QueryResultsSerializer::from_format(QueryResultsFormat::Json)
        .with_rdf_version(RdfVersion::V1_2)?
        .serialize_solutions_to_writer(Vec::new(), vec![variable.clone()])?;
    full.serialize(once((&variable, &triple)))?;
    let output = String::from_utf8(full.finish()?)?;
    assert!(output.contains(r#""version":"1.2""#));
    assert!(output.contains(r#""type":"triple""#));
    assert!(output.contains(r#""its:dir":"rtl""#));
    Ok(())
}

#[cfg(feature = "async-tokio")]
async fn parses_async_fully(media_type: &str, input: &str) -> bool {
    use sparesults::TokioAsyncReaderQueryResultsParserOutput;

    let Ok(parser) = QueryResultsParser::from_media_type(media_type) else {
        return false;
    };
    let Ok(output) = parser.for_tokio_async_reader(input.as_bytes()).await else {
        return false;
    };
    match output {
        TokioAsyncReaderQueryResultsParserOutput::Boolean(_) => true,
        TokioAsyncReaderQueryResultsParserOutput::Solutions(mut solutions) => {
            while let Some(solution) = solutions.next().await {
                if solution.is_err() {
                    return false;
                }
            }
            true
        }
    }
}

#[cfg(all(feature = "async-tokio", feature = "sparql-12"))]
#[tokio::test]
async fn async_parser_and_serializer_enforce_external_versions() -> Result<(), Box<dyn Error>> {
    assert!(
        parses_async_fully(
            "application/sparql-results+json; version=1.2",
            JSON_DIRECTIONAL_RESULTS_FIRST
        )
        .await
    );
    assert!(
        !parses_async_fully(
            "application/sparql-results+json; version=1.1",
            JSON_DIRECTIONAL
        )
        .await
    );
    assert!(
        parses_async_fully(
            "application/sparql-results+xml; version=1.2",
            XML_DIRECTIONAL
        )
        .await
    );
    assert!(
        !parses_async_fully(
            "application/sparql-results+xml; version=1.1",
            XML_DIRECTIONAL
        )
        .await
    );

    let variable = Variable::new("value")?;
    let triple = nested_directional_triple()?;
    let mut serializer = QueryResultsSerializer::from_format(QueryResultsFormat::Json)
        .with_rdf_version(RdfVersion::V1_2Basic)?
        .serialize_solutions_to_tokio_async_write(Vec::new(), vec![variable.clone()])
        .await?;
    assert!(
        serializer
            .serialize(once((&variable, &triple)))
            .await
            .is_err()
    );
    let output = serializer.finish().await?;
    assert_eq!(
        output,
        br#"{"head":{"version":"1.2-basic","vars":["value"]},"results":{"bindings":[]}}"#
    );
    Ok(())
}

#[cfg(feature = "async-tokio")]
#[tokio::test]
async fn async_serializers_use_current_inline_version_surfaces() -> Result<(), Box<dyn Error>> {
    let json = QueryResultsSerializer::from_format(QueryResultsFormat::Json)
        .with_rdf_version(RdfVersion::V1_2)?
        .serialize_boolean_to_tokio_async_write(Vec::new(), true)
        .await?;
    assert_eq!(json, br#"{"head":{},"boolean":true}"#);
    let xml = QueryResultsSerializer::from_format(QueryResultsFormat::Xml)
        .with_rdf_version(RdfVersion::V1_1)?
        .serialize_boolean_to_tokio_async_write(Vec::new(), false)
        .await?;
    assert_eq!(
        xml,
        br#"<?xml version="1.0"?><sparql xmlns="http://www.w3.org/2005/sparql-results#" version="1.1"><head></head><boolean>false</boolean></sparql>"#
    );
    Ok(())
}

#[cfg(feature = "async-tokio")]
#[tokio::test]
async fn async_readers_enforce_us_ascii_octets() {
    for (media_type, raw_non_ascii, ascii_escape) in [
        (
            "application/sparql-results+json; charset=US-ASCII",
            JSON_NON_ASCII,
            JSON_ASCII_ESCAPE,
        ),
        (
            "application/sparql-results+xml; charset=US-ASCII",
            XML_NON_ASCII,
            XML_ASCII_ESCAPE,
        ),
    ] {
        assert!(!parses_async_fully(media_type, raw_non_ascii).await);
        assert!(parses_async_fully(media_type, ascii_escape).await);
    }
    assert!(
        !parses_async_fully(
            "text/tab-separated-values; charset=us-ascii",
            "?value\n\"caf\u{e9}\"\n"
        )
        .await
    );
}

#[cfg(not(feature = "sparql-12"))]
#[test]
fn external_version_does_not_enable_uncompiled_rdf_12_terms() {
    let xml_directional = r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#" xmlns:its="http://www.w3.org/2005/11/its"><head><variable name="value"/></head><results><result><binding name="value"><literal xml:lang="en" its:dir="rtl">hello</literal></binding></result></results></sparql>"#;
    for media_type in [
        "application/sparql-results+json; version=1.2",
        "application/sparql-results+xml; version=1.2",
    ] {
        let input = if media_type.contains("+json") {
            JSON_DIRECTIONAL
        } else {
            xml_directional
        };
        assert!(!parses_slice_fully(media_type, input));
        assert!(!parses_reader_fully(media_type, input));
    }
}

#[cfg(all(feature = "async-tokio", not(feature = "sparql-12")))]
#[tokio::test]
async fn async_external_version_does_not_enable_uncompiled_rdf_12_terms() {
    assert!(
        !parses_async_fully(
            "application/sparql-results+json; version=1.2",
            JSON_DIRECTIONAL
        )
        .await
    );
    assert!(
        !parses_async_fully(
            "application/sparql-results+xml; version=1.2",
            XML_DIRECTIONAL
        )
        .await
    );
}
