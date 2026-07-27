#[cfg(test)]
mod tests {
    #![cfg_attr(not(feature = "rdf-12"), expect(clippy::expect_used))]

    #[cfg(not(feature = "rdf-12"))]
    #[test]
    fn direction_is_not_silently_downgraded() {
        use oxjsonld::JsonLdParser;

        let input = r#"{
      "@context": {"ex": "http://example.com/"},
      "@id": "ex:subject",
      "ex:label": {
        "@value": "hello",
        "@language": "en",
        "@direction": "ltr"
      }
    }"#;
        let quads = JsonLdParser::new()
            .for_slice(input)
            .collect::<Result<Vec<_>, _>>()
            .expect("valid JSON-LD");
        assert!(quads.is_empty());
    }

    #[test]
    fn reserved_typed_literals_without_language_components_are_not_emitted() {
        use oxjsonld::JsonLdParser;

        fn assert_reserved_datatype_is_not_emitted(datatype: &str) {
            let input = format!(
                r#"{{
                  "@context": {{"ex": "http://example.com/"}},
                  "@id": "ex:subject",
                  "ex:label": {{"@value": "hello", "@type": "{datatype}"}}
                }}"#
            );
            if let Ok(quads) = JsonLdParser::new()
                .for_slice(input.as_bytes())
                .collect::<Result<Vec<_>, _>>()
            {
                assert!(
                    quads.is_empty(),
                    "reserved datatype {datatype} produced an invalid RDF literal"
                );
            }
        }

        assert_reserved_datatype_is_not_emitted(
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
        );
        #[cfg(feature = "rdf-12")]
        assert_reserved_datatype_is_not_emitted(
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString",
        );
    }
}
