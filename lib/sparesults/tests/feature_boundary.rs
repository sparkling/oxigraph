#[cfg(test)]
mod tests {
    #![expect(
        clippy::assertions_on_result_states,
        clippy::expect_used,
        clippy::panic
    )]

    use sparesults::{
        QueryResultsFormat, QueryResultsParser, ReaderQueryResultsParserOutput,
        SliceQueryResultsParserOutput,
    };

    fn parses_slice_fully(format: QueryResultsFormat, input: &str) -> bool {
        let Ok(output) = QueryResultsParser::from_format(format).for_slice(input) else {
            return false;
        };
        match output {
            SliceQueryResultsParserOutput::Boolean(_) => true,
            SliceQueryResultsParserOutput::Solutions(mut solutions) => {
                solutions.all(|solution| solution.is_ok())
            }
        }
    }

    fn parses_reader_fully(format: QueryResultsFormat, input: &str) -> bool {
        let Ok(output) = QueryResultsParser::from_format(format).for_reader(input.as_bytes())
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

    fn assert_valid(format: QueryResultsFormat, input: &str) {
        assert!(
            parses_slice_fully(format, input),
            "slice parser rejected:\n{input}"
        );
        assert!(
            parses_reader_fully(format, input),
            "reader parser rejected:\n{input}"
        );
    }

    fn assert_invalid(format: QueryResultsFormat, input: &str) {
        assert!(
            !parses_slice_fully(format, input),
            "slice parser accepted:\n{input}"
        );
        assert!(
            !parses_reader_fully(format, input),
            "reader parser accepted:\n{input}"
        );
    }

    #[test]
    fn reserved_language_datatypes_require_language_components() {
        for (format, input) in [
            (
                QueryResultsFormat::Json,
                r#"{"head":{"vars":["value"]},"results":{"bindings":[{"value":{"type":"literal","value":"hello","datatype":"http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"}}]}}"#,
            ),
            (
                QueryResultsFormat::Xml,
                r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value"><literal datatype="http://www.w3.org/1999/02/22-rdf-syntax-ns#langString">hello</literal></binding></result></results></sparql>"#,
            ),
        ] {
            assert_invalid(format, input);
        }

        #[cfg(feature = "sparql-12")]
        for (format, input) in [
            (
                QueryResultsFormat::Json,
                r#"{"head":{"vars":["value"],"version":"1.2"},"results":{"bindings":[{"value":{"type":"literal","value":"hello","datatype":"http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString"}}]}}"#,
            ),
            (
                QueryResultsFormat::Xml,
                r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value"><literal datatype="http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString">hello</literal></binding></result></results></sparql>"#,
            ),
        ] {
            assert_invalid(format, input);
        }
    }

    #[test]
    fn json_document_and_normative_object_matrix() {
        for valid in [
            r#"{"head":{},"boolean":true}"#,
            r#"{"extension":{"nested":[true,{"value":null}]},"head":{},"boolean":false}"#,
            r#"{"head":{"vars":[]},"results":{"bindings":[]},"extension":{"nested":[true,{"value":null}]}}"#,
            r#"{"results":{"bindings":[{"value":{"value":"ok","type":"literal"}}]},"head":{"vars":["value"],"link":["https://example.com/"],"version":"1.2"}}"#,
        ] {
            assert_valid(QueryResultsFormat::Json, valid);
        }

        for invalid in [
            r#"{"boolean":true}"#,
            r#"{"head":{}}"#,
            r#"{"head":{"vars":[]},"results":{"bindings":[]},"boolean":true}"#,
            r#"{"head":{},"head":{},"boolean":true}"#,
            r#"{"head":{},"boolean":true,"boolean":false}"#,
            r#"{"head":{"version":"1.1","version":"1.2"},"boolean":true}"#,
            r#"{"head":{"unknown":null},"boolean":true}"#,
            r#"{"head":{"vars":[]},"results":{"bindings":[],"unknown":null}}"#,
            r#"{"head":{"vars":[]},"results":{}}"#,
            r#"{"head":{"vars":[]},"results":{"bindings":[],"bindings":[]}}"#,
            r#"{"head":{"vars":[]},"results":{"bindings":{}}}"#,
            r#"{"head":{},"results":{"bindings":[]}}"#,
            r#"{"head":{"vars":[]},"boolean":true}"#,
            r#"{"head":{"version":"1.1"},"boolean":true,"extension":0}"#,
            r#"{"head":{"version":1.2},"boolean":true}"#,
            r#"{"head":{"version":"future"},"boolean":true}"#,
            r#"{"head":{},"boolean":true,"extension":0,"extension":1}"#,
            r#"{"head":{"vars":["value"]},"results":{"bindings":[{"value":{"type":"literal","value":"one"},"value":{"type":"literal","value":"two"}}]}}"#,
            r#"{"head":{"vars":["value"]},"results":{"bindings":[{"value":{"type":"literal","type":"uri","value":"one"}}]}}"#,
            r#"{"head":{"vars":["value"]},"results":{"bindings":[{"value":{"type":"uri","value":"https://example.com/","xml:lang":"en"}}]}}"#,
            r#"{"head":{},"boolean":true} false"#,
            r#"{"head":{"vars":["value"]},"results":{"bindings":[{"value":{"type":"literal","value":"unfinished"}}]"#,
        ] {
            assert_invalid(QueryResultsFormat::Json, invalid);
        }
    }

    #[test]
    fn xml_document_and_structural_matrix() {
        for valid in [
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean></sparql>"#,
            r#"<sr:sparql xmlns:sr="http://www.w3.org/2005/sparql-results#" xml:base="https://example.com/results/" xmlns:its="http://www.w3.org/2005/11/its" its:version="2.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.w3.org/2005/sparql-results# https://www.w3.org/2007/SPARQL/result.xsd"><sr:head><sr:link href="../metadata.ttl"/></sr:head><sr:boolean>false</sr:boolean></sr:sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value"><literal>ok</literal></binding></result></results></sparql>"#,
        ] {
            assert_valid(QueryResultsFormat::Xml, valid);
        }

        for invalid in [
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><results/><head/></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#" custom="value"><head/><boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head custom="value"/><boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><link href="metadata.ttl">content</link></head><boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><link/></head><boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><link href="https://example.com/" custom="value"/></head><boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><link href="http://[invalid"/></head><boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><link href="metadata.ttl"/><variable name="value"/></head><boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean custom="value">true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results custom="value"/></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result custom="value"/></results></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding><literal>value</literal></binding></result></results></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value" custom="value"><literal>value</literal></binding></result></results></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value"><uri custom="value">https://example.com/</uri></binding></result></results></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value"><literal custom="value">value</literal></binding></result></results></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/>text<boolean>true</boolean></sparql>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean></sparql> trailing"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean>"#,
            r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="value"/></head><results><result><binding name="value"><literal>unfinished</literal></binding></result>"#,
        ] {
            assert_invalid(QueryResultsFormat::Xml, invalid);
        }
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn json_version_labels_gate_rdf_12_terms() {
        let directional = |version: &str| {
            format!(
                r#"{{"head":{{"vars":["value"],"version":"{version}"}},"results":{{"bindings":[{{"value":{{"type":"literal","value":"hello","xml:lang":"en","its:dir":"rtl"}}}}]}}}}"#
            )
        };
        let triple = |version: &str| {
            format!(
                r#"{{"head":{{"vars":["value"],"version":"{version}"}},"results":{{"bindings":[{{"value":{{"type":"triple","value":{{"subject":{{"type":"uri","value":"https://example.com/s"}},"predicate":{{"type":"uri","value":"https://example.com/p"}},"object":{{"type":"literal","value":"o"}}}}}}}}]}}}}"#
            )
        };

        assert_valid(QueryResultsFormat::Json, &directional("1.2"));
        assert_valid(QueryResultsFormat::Json, &directional("1.2-basic"));
        assert_invalid(QueryResultsFormat::Json, &directional("1.1"));
        assert_valid(QueryResultsFormat::Json, &triple("1.2"));
        assert_invalid(QueryResultsFormat::Json, &triple("1.2-basic"));
        assert_invalid(QueryResultsFormat::Json, &triple("1.1"));
        assert_invalid(
            QueryResultsFormat::Json,
            r#"{"results":{"bindings":[{"value":{"type":"triple","value":{"subject":{"type":"uri","value":"https://example.com/s"},"predicate":{"type":"uri","value":"https://example.com/p"},"object":{"type":"literal","value":"o"}}}}]},"head":{"vars":["value"],"version":"1.2-basic"}}"#,
        );
        assert_invalid(
            QueryResultsFormat::Json,
            r#"{"head":{"vars":["value"],"version":"1.2"},"results":{"bindings":[{"value":{"type":"triple","value":{"subject":{"type":"uri","value":"https://example.com/s"},"subject":{"type":"uri","value":"https://example.com/other"},"predicate":{"type":"uri","value":"https://example.com/p"},"object":{"type":"literal","value":"o"}}}}]}}"#,
        );
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn xml_current_prose_lane_accepts_rdf_12_terms() {
        // The current W3C prose defines triple and direction results constructs that
        // are not yet represented by the older published XML Schema artifact.
        let input = r#"
            <sparql xmlns="http://www.w3.org/2005/sparql-results#"
                    xmlns:its="http://www.w3.org/2005/11/its">
              <head><variable name="value"/></head>
              <results><result><binding name="value"><triple>
                <subject><uri>https://example.com/s</uri></subject>
                <predicate><uri>https://example.com/p</uri></predicate>
                <object><literal xml:lang="en" its:dir="ltr">hello</literal></object>
              </triple></binding></result></results>
            </sparql>
        "#;
        assert_valid(QueryResultsFormat::Xml, input);
    }

    #[cfg(feature = "async-tokio")]
    async fn parses_async_fully(format: QueryResultsFormat, input: &str) -> bool {
        use sparesults::TokioAsyncReaderQueryResultsParserOutput;

        let Ok(output) = QueryResultsParser::from_format(format)
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

    #[cfg(feature = "async-tokio")]
    #[tokio::test]
    async fn async_readers_enforce_document_end() {
        for (format, valid, invalid) in [
            (
                QueryResultsFormat::Json,
                r#"{"head":{"vars":[]},"results":{"bindings":[]}}"#,
                r#"{"head":{"vars":[]},"results":{"bindings":[]} } false"#,
            ),
            (
                QueryResultsFormat::Xml,
                r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean></sparql>"#,
                r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean>"#,
            ),
        ] {
            assert!(parses_async_fully(format, valid).await);
            assert!(!parses_async_fully(format, invalid).await);
        }
    }

    #[cfg(not(feature = "sparql-12"))]
    #[test]
    fn xml_direction_is_not_silently_downgraded() {
        use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};

        let input = r#"
        <sparql xmlns="http://www.w3.org/2005/sparql-results#"
                xmlns:i="http://www.w3.org/2005/11/its">
          <head><variable name="value"/></head>
          <results><result><binding name="value">
            <literal xml:lang="en" i:dir="ltr">hello</literal>
          </binding></result></results>
        </sparql>
    "#;
        let output = QueryResultsParser::from_format(QueryResultsFormat::Xml)
            .for_slice(input)
            .expect("the document header is valid");
        let SliceQueryResultsParserOutput::Solutions(mut solutions) = output else {
            panic!("expected solutions");
        };
        assert!(solutions.next().expect("one solution").is_err());
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn xml_direction_uses_the_namespace_not_the_prefix() {
        use oxrdf::{BaseDirection, Term};
        use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};

        let input = r#"
        <sparql xmlns="http://www.w3.org/2005/sparql-results#"
                xmlns:i="http://www.w3.org/2005/11/its">
          <head><variable name="value"/></head>
          <results><result><binding name="value">
            <literal xml:lang="en" i:dir="rtl">hello</literal>
          </binding></result></results>
        </sparql>
    "#;
        let SliceQueryResultsParserOutput::Solutions(mut solutions) =
            QueryResultsParser::from_format(QueryResultsFormat::Xml)
                .for_slice(input)
                .expect("valid SPARQL XML results")
        else {
            panic!("expected solutions");
        };
        let solution = solutions
            .next()
            .expect("one solution")
            .expect("valid solution");
        let Some(Term::Literal(literal)) = solution.get("value") else {
            panic!("expected literal");
        };
        assert_eq!(literal.direction(), Some(BaseDirection::Rtl));
    }

    #[test]
    fn json_link_member_is_validated() {
        use sparesults::{QueryResultsFormat, QueryResultsParser};

        let invalid = r#"{"head":{"link":"http://example.com/"}, "boolean":true}"#;
        assert!(
            QueryResultsParser::from_format(QueryResultsFormat::Json)
                .for_slice(invalid)
                .is_err()
        );
    }

    #[test]
    fn xml_elements_require_the_results_namespace() {
        use sparesults::{QueryResultsFormat, QueryResultsParser};

        let invalid =
            r#"<sparql xmlns="http://example.com/wrong"><head/><boolean>true</boolean></sparql>"#;
        assert!(
            QueryResultsParser::from_format(QueryResultsFormat::Xml)
                .for_slice(invalid)
                .is_err()
        );
    }

    #[test]
    fn xml_literal_preserves_cdata_whitespace() {
        use oxrdf::Term;
        use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};

        let input = r#"
      <r:sparql xmlns:r="http://www.w3.org/2005/sparql-results#">
        <r:head><r:variable name="value"/></r:head>
        <r:results><r:result><r:binding name="value">
          <r:literal><![CDATA[  exact value  ]]></r:literal>
        </r:binding></r:result></r:results>
      </r:sparql>
    "#;
        let SliceQueryResultsParserOutput::Solutions(mut solutions) =
            QueryResultsParser::from_format(QueryResultsFormat::Xml)
                .for_slice(input)
                .expect("valid SPARQL XML results")
        else {
            panic!("expected solutions");
        };
        let solution = solutions
            .next()
            .expect("one solution")
            .expect("valid solution");
        let Some(Term::Literal(literal)) = solution.get("value") else {
            panic!("expected literal");
        };
        assert_eq!(literal.value(), "  exact value  ");
    }

    #[test]
    fn xml_rejects_duplicate_bindings() {
        use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};

        let input = r#"
      <sparql xmlns="http://www.w3.org/2005/sparql-results#">
        <head><variable name="value"/></head>
        <results><result>
          <binding name="value"><literal>first</literal></binding>
          <binding name="value"><literal>second</literal></binding>
        </result></results>
      </sparql>
    "#;
        let SliceQueryResultsParserOutput::Solutions(mut solutions) =
            QueryResultsParser::from_format(QueryResultsFormat::Xml)
                .for_slice(input)
                .expect("valid document header")
        else {
            panic!("expected solutions");
        };
        assert!(solutions.next().expect("one solution").is_err());
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn xml_triple_components_are_ordered() {
        use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};

        let input = r#"
      <sparql xmlns="http://www.w3.org/2005/sparql-results#">
        <head><variable name="value"/></head>
        <results><result><binding name="value"><triple>
          <predicate><uri>http://example.com/p</uri></predicate>
          <subject><uri>http://example.com/s</uri></subject>
          <object><uri>http://example.com/o</uri></object>
        </triple></binding></result></results>
      </sparql>
    "#;
        let SliceQueryResultsParserOutput::Solutions(mut solutions) =
            QueryResultsParser::from_format(QueryResultsFormat::Xml)
                .for_slice(input)
                .expect("valid document header")
        else {
            panic!("expected solutions");
        };
        assert!(solutions.next().expect("one solution").is_err());
    }

    #[test]
    fn blank_node_labels_are_scoped_to_each_results_document() {
        use oxrdf::{BlankNode, Term};
        use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};

        fn parse(format: QueryResultsFormat, input: &str) -> Vec<BlankNode> {
            let SliceQueryResultsParserOutput::Solutions(solutions) =
                QueryResultsParser::from_format(format)
                    .for_slice(input)
                    .expect("valid results document")
            else {
                panic!("expected solutions");
            };
            solutions
                .map(|solution| {
                    let solution = solution.expect("valid solution");
                    let Some(Term::BlankNode(node)) = solution.get("value") else {
                        panic!("expected a blank node");
                    };
                    node.clone()
                })
                .collect()
        }

        for (format, input) in [
            (
                QueryResultsFormat::Json,
                r#"{"head":{"vars":["value"]},"results":{"bindings":[
                    {"value":{"type":"bnode","value":"shared"}},
                    {"value":{"type":"bnode","value":"shared"}}
                ]}}"#,
            ),
            (
                QueryResultsFormat::Xml,
                r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#">
                    <head><variable name="value"/></head>
                    <results>
                      <result><binding name="value"><bnode>shared</bnode></binding></result>
                      <result><binding name="value"><bnode>shared</bnode></binding></result>
                    </results>
                </sparql>"#,
            ),
            (QueryResultsFormat::Tsv, "?value\n_:shared\n_:shared\n"),
        ] {
            let first_document = parse(format, input);
            let second_document = parse(format, input);
            assert_eq!(first_document[0], first_document[1]);
            assert_eq!(second_document[0], second_document[1]);
            assert_ne!(first_document[0], second_document[0]);
        }
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn blank_node_scope_is_preserved_inside_triple_terms() {
        use oxrdf::{NamedOrBlankNode, Term};
        use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};

        let input = r#"{
          "head":{"vars":["value"]},
          "results":{"bindings":[{
            "value":{"type":"triple","value":{
              "subject":{"type":"bnode","value":"shared"},
              "predicate":{"type":"uri","value":"http://example.com/p"},
              "object":{"type":"bnode","value":"shared"}
            }}
          }]}
        }"#;
        let SliceQueryResultsParserOutput::Solutions(mut solutions) =
            QueryResultsParser::from_format(QueryResultsFormat::Json)
                .for_slice(input)
                .expect("valid SPARQL 1.2 JSON results")
        else {
            panic!("expected solutions");
        };
        let solution = solutions
            .next()
            .expect("one solution")
            .expect("valid solution");
        let Some(Term::Triple(triple)) = solution.get("value") else {
            panic!("expected a triple term");
        };
        let NamedOrBlankNode::BlankNode(subject) = &triple.subject else {
            panic!("expected a blank-node subject");
        };
        let Term::BlankNode(object) = &triple.object else {
            panic!("expected a blank-node object");
        };
        assert_eq!(subject, object);
    }
}
