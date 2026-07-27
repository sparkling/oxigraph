#[cfg(test)]
mod tests {

    use sparesults::{
        QueryResultsFormat, QueryResultsParser, ReaderQueryResultsParserOutput,
        SliceQueryResultsParserOutput,
    };

    const DEPLOYED_2007_XSD: &str = include_str!("fixtures/sparql-results-xml-deployed-2007.xsd");
    const PUBLISHED_2024_XSD: &str = include_str!("fixtures/sparql12-results-xml-wd-20241227.xsd");
    const EDITOR_2026_XSD: &str = include_str!("fixtures/sparql12-results-xml-editor-fc4b1bc.xsd");

    const DEPLOYED_2007_SHA256: &str =
        "efd767c579f4068ae501ba195e08a5367465ad5f419de32c6d34e80a90d9b3f8";
    const PUBLISHED_2024_SHA256: &str =
        "0d5a581590ceb91a32ad12ddb5deb4eb1a41a04bbb4e02fe4632108386671ee6";
    const EDITOR_2026_SHA256: &str =
        "10f3d174bdad88d2f2d2bf1d2459955f5cbaefe022b32b96f81bc217653c2c6b";
    const EDITOR_REVISION: &str = "fc4b1bc153d38e72e11208236052aa9cedd0cce9";
    const EDITOR_XSD_BLOB: &str = "f07694ff9cdbc93dd6f75e2f29e0aaac0a81dbdb";

    fn parses_slice_fully(input: &str) -> bool {
        let Ok(output) = QueryResultsParser::from_format(QueryResultsFormat::Xml).for_slice(input)
        else {
            return false;
        };
        match output {
            SliceQueryResultsParserOutput::Boolean(_) => true,
            SliceQueryResultsParserOutput::Solutions(mut solutions) => {
                solutions.all(|solution| solution.is_ok())
            }
        }
    }

    fn parses_reader_fully(input: &str) -> bool {
        let Ok(output) =
            QueryResultsParser::from_format(QueryResultsFormat::Xml).for_reader(input.as_bytes())
        else {
            return false;
        };
        match output {
            ReaderQueryResultsParserOutput::Boolean(_) => true,
            ReaderQueryResultsParserOutput::Solutions(mut solutions) => {
                solutions.all(|solution| solution.is_ok())
            }
        }
    }

    #[cfg(all(feature = "async-tokio", feature = "sparql-12"))]
    async fn parses_async_fully(input: &str) -> bool {
        use sparesults::TokioAsyncReaderQueryResultsParserOutput;

        let Ok(output) = QueryResultsParser::from_format(QueryResultsFormat::Xml)
            .for_tokio_async_reader(input.as_bytes())
            .await
        else {
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

    fn assert_valid(input: &str) {
        assert!(parses_slice_fully(input), "slice parser rejected:\n{input}");
        assert!(
            parses_reader_fully(input),
            "reader parser rejected:\n{input}"
        );
    }

    fn assert_invalid(input: &str) {
        assert!(
            !parses_slice_fully(input),
            "slice parser accepted:\n{input}"
        );
        assert!(
            !parses_reader_fully(input),
            "reader parser accepted:\n{input}"
        );
    }

    fn solutions_document(version: Option<&str>, term: &str) -> String {
        let version = version.map_or_else(String::new, |value| format!(r#" version="{value}""#));
        format!(
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#" xmlns:its="http://www.w3.org/2005/11/its"{version}><head><variable name="value"/></head><results><result><binding name="value">{term}</binding></result></results></sparql>"#
        )
    }

    #[test]
    fn upstream_schema_artifacts_and_controlled_divergence_are_pinned() {
        // These exact, non-executable fixtures were fetched from W3C on 2026-07-27.
        // The byte lengths and provenance hashes make an upstream refresh explicit.
        assert_eq!(
            DEPLOYED_2007_XSD.len(),
            3661,
            "SHA-256 {DEPLOYED_2007_SHA256}"
        );
        assert_eq!(
            PUBLISHED_2024_XSD.len(),
            3834,
            "SHA-256 {PUBLISHED_2024_SHA256}"
        );
        assert_eq!(
            EDITOR_2026_XSD.len(),
            3834,
            "revision {EDITOR_REVISION}, blob {EDITOR_XSD_BLOB}, SHA-256 {EDITOR_2026_SHA256}"
        );

        // The schema URL cited by the SPARQL 1.1 Recommendation still declares
        // the obsolete 2007 namespace. This is tracked upstream as W3C issue #9.
        assert!(
            DEPLOYED_2007_XSD
                .contains(r#"targetNamespace="http://www.w3.org/2007/SPARQL/results#""#)
        );
        assert!(
            EDITOR_2026_XSD.contains(r#"targetNamespace="http://www.w3.org/2005/sparql-results#""#)
        );

        // Both SPARQL 1.2 schemas lag the prose: they have no version attribute,
        // triple-term elements, or ITS direction attribute. They also contain
        // stray browser-extension elements, so the XSD itself does not compile.
        for schema in [PUBLISHED_2024_XSD, EDITOR_2026_XSD] {
            assert!(!schema.contains(r#"<xs:attribute name="version""#));
            assert!(!schema.contains(r#"<xs:element name="triple""#));
            assert!(!schema.contains("its:dir"));
            assert!(schema.contains(r#"<div id="divScriptsUsed""#));
            assert!(schema.contains("moz-extension://"));
        }

        // Except for the generated $Id timestamp, the published 2024 and current
        // editor XSD bytes are identical. Parser conformance follows the current
        // editor prose for 1.2 terms and its inline version attribute. The
        // schemas still lag both additions and remain a separate evidence lane.
        let normalized_published = PUBLISHED_2024_XSD.replace(
            "$Id: result.xsd,v 1.1 2024/12/27 09:17:47 node Exp $",
            "$Id: result.xsd,v 1.1 2007/10/17 14:48:47 eric Exp $",
        );
        assert_eq!(normalized_published, EDITOR_2026_XSD);
    }

    #[test]
    fn xml_root_version_attribute_follows_current_editor_prose() {
        assert_valid(&solutions_document(
            None,
            "<literal>schema-compatible</literal>",
        ));
        for valid in [
            solutions_document(Some("1.1"), "<literal>value</literal>"),
            solutions_document(Some("1.2-basic"), "<literal>value</literal>"),
            solutions_document(Some("1.2"), "<literal>value</literal>"),
        ] {
            assert_valid(&valid);
        }
        for invalid in [
            solutions_document(Some("future"), "<literal>value</literal>"),
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#" xmlns:v="https://example.com/version" v:version="1.2"><head/><boolean>true</boolean></sparql>"#.to_owned(),
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#" version="1.1" version="1.2"><head/><boolean>true</boolean></sparql>"#.to_owned(),
        ] {
            assert_invalid(&invalid);
        }
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn current_xml_prose_terms_do_not_require_an_inline_version() {
        let directional = r#"<literal xml:lang="en" its:dir="rtl">directional</literal>"#;
        let triple = "<triple><subject><uri>https://example.com/s</uri></subject><predicate><uri>https://example.com/p</uri></predicate><object><literal>object</literal></object></triple>";

        assert_valid(&solutions_document(None, directional));
        assert_valid(&solutions_document(None, triple));
        assert_invalid(&solutions_document(Some("1.1"), directional));
        assert_valid(&solutions_document(Some("1.2-basic"), directional));
        assert_invalid(&solutions_document(Some("1.2-basic"), triple));
        assert_valid(&solutions_document(Some("1.2"), triple));
    }

    #[cfg(all(feature = "async-tokio", feature = "sparql-12"))]
    #[tokio::test]
    async fn async_xml_parser_accepts_current_rdf_12_terms_without_inline_version() {
        let directional = r#"<literal xml:lang="en" its:dir="rtl">directional</literal>"#;
        assert!(
            parses_async_fully(&solutions_document(None, directional)).await,
            "SPARQL 1.2 directional term should be accepted"
        );
    }

    #[cfg(not(feature = "sparql-12"))]
    #[test]
    fn rdf_12_terms_are_rejected_without_feature_support() {
        let directional = r#"<literal xml:lang="en" its:dir="rtl">directional</literal>"#;
        let triple = "<triple><subject><uri>https://example.com/s</uri></subject><predicate><uri>https://example.com/p</uri></predicate><object><literal>object</literal></object></triple>";

        assert_invalid(&solutions_document(None, directional));
        assert_invalid(&solutions_document(None, triple));
    }
}
