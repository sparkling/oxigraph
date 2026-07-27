#[cfg(test)]
mod tests {
    use oxttl::n3::N3Parser;
    use oxttl::{NQuadsParser, NTriplesParser, TriGParser, TurtleParser};

    const LANG_STRING_BAD: &[u8] = include_bytes!(
        "../../../testsuite/rdf-tests/rdf/rdf12/rdf-n-triples/syntax/ntriples-langdir-bad-3.nt"
    );
    #[cfg(feature = "rdf-12")]
    const DIR_LANG_STRING_BAD: &[u8] = include_bytes!(
        "../../../testsuite/rdf-tests/rdf/rdf12/rdf-n-triples/syntax/ntriples-langdir-bad-5.nt"
    );
    const PREFIX: &str = "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n";
    const PREFIXED_LANG_STRING_BAD: &str =
        "<http://example/a> <http://example/b> \"Hello\"^^rdf:langString .\n";
    #[cfg(feature = "rdf-12")]
    const PREFIXED_DIR_LANG_STRING_BAD: &str =
        "<http://example/a> <http://example/b> \"Hello\"^^rdf:dirLangString .\n";

    fn summary<T, E>(results: impl IntoIterator<Item = Result<T, E>>) -> (usize, usize) {
        results
            .into_iter()
            .fold((0, 0), |(values, errors), result| {
                if result.is_ok() {
                    (values + 1, errors)
                } else {
                    (values, errors + 1)
                }
            })
    }

    fn assert_rejected(result: (usize, usize), parser: &str) {
        assert_eq!(result.0, 0, "{parser} emitted an invalid literal");
        assert!(result.1 > 0, "{parser} did not report a syntax error");
    }

    fn line_low_level(input: &[u8], lenient: bool, nquads: bool) -> (usize, usize) {
        if nquads {
            let parser = NQuadsParser::new();
            let mut parser = if lenient { parser.lenient() } else { parser }.low_level();
            let mut results = Vec::new();
            for chunk in input.chunks(1) {
                parser.extend_from_slice(chunk);
                while let Some(result) = parser.parse_next() {
                    results.push(result);
                }
            }
            parser.end();
            while let Some(result) = parser.parse_next() {
                results.push(result);
            }
            summary(results)
        } else {
            let parser = NTriplesParser::new();
            let mut parser = if lenient { parser.lenient() } else { parser }.low_level();
            let mut results = Vec::new();
            for chunk in input.chunks(1) {
                parser.extend_from_slice(chunk);
                while let Some(result) = parser.parse_next() {
                    results.push(result);
                }
            }
            parser.end();
            while let Some(result) = parser.parse_next() {
                results.push(result);
            }
            summary(results)
        }
    }

    fn assert_line_paths_reject(input: &[u8], lenient: bool) {
        let triples = NTriplesParser::new();
        let triples = if lenient { triples.lenient() } else { triples };
        assert_rejected(summary(triples.clone().for_slice(input)), "N-Triples slice");
        assert_rejected(summary(triples.for_reader(input)), "N-Triples reader");
        assert_rejected(line_low_level(input, lenient, false), "N-Triples low-level");

        let quads = NQuadsParser::new();
        let quads = if lenient { quads.lenient() } else { quads };
        assert_rejected(summary(quads.clone().for_slice(input)), "N-Quads slice");
        assert_rejected(summary(quads.for_reader(input)), "N-Quads reader");
        assert_rejected(line_low_level(input, lenient, true), "N-Quads low-level");
    }

    fn turtle_low_level(input: &[u8], lenient: bool) -> (usize, usize) {
        let parser = TurtleParser::new();
        let mut parser = if lenient { parser.lenient() } else { parser }.low_level();
        let mut results = Vec::new();
        for chunk in input.chunks(1) {
            parser.extend_from_slice(chunk);
            while let Some(result) = parser.parse_next() {
                results.push(result);
            }
        }
        parser.end();
        while let Some(result) = parser.parse_next() {
            results.push(result);
        }
        summary(results)
    }

    fn trig_low_level(input: &[u8], lenient: bool) -> (usize, usize) {
        let parser = TriGParser::new();
        let mut parser = if lenient { parser.lenient() } else { parser }.low_level();
        let mut results = Vec::new();
        for chunk in input.chunks(1) {
            parser.extend_from_slice(chunk);
            while let Some(result) = parser.parse_next() {
                results.push(result);
            }
        }
        parser.end();
        while let Some(result) = parser.parse_next() {
            results.push(result);
        }
        summary(results)
    }

    fn n3_low_level(input: &[u8], lenient: bool) -> (usize, usize) {
        let parser = N3Parser::new();
        let mut parser = if lenient { parser.lenient() } else { parser }.low_level();
        let mut results = Vec::new();
        for chunk in input.chunks(1) {
            parser.extend_from_slice(chunk);
            while let Some(result) = parser.parse_next() {
                results.push(result);
            }
        }
        parser.end();
        while let Some(result) = parser.parse_next() {
            results.push(result);
        }
        summary(results)
    }

    fn assert_terse_paths_reject(input: &[u8], lenient: bool) {
        let turtle = TurtleParser::new();
        let turtle = if lenient { turtle.lenient() } else { turtle };
        assert_rejected(summary(turtle.clone().for_slice(input)), "Turtle slice");
        assert_rejected(summary(turtle.for_reader(input)), "Turtle reader");
        assert_rejected(turtle_low_level(input, lenient), "Turtle low-level");

        let trig = TriGParser::new();
        let trig = if lenient { trig.lenient() } else { trig };
        assert_rejected(summary(trig.clone().for_slice(input)), "TriG slice");
        assert_rejected(summary(trig.for_reader(input)), "TriG reader");
        assert_rejected(trig_low_level(input, lenient), "TriG low-level");

        let n3 = N3Parser::new();
        let n3 = if lenient { n3.lenient() } else { n3 };
        assert_rejected(summary(n3.clone().for_slice(input)), "N3 slice");
        assert_rejected(summary(n3.for_reader(input)), "N3 reader");
        assert_rejected(n3_low_level(input, lenient), "N3 low-level");
    }

    #[test]
    fn official_lang_string_negative_is_rejected_in_strict_and_lenient_modes() {
        for lenient in [false, true] {
            assert_line_paths_reject(LANG_STRING_BAD, lenient);
            assert_terse_paths_reject(LANG_STRING_BAD, lenient);
        }
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn official_dir_lang_string_negative_is_rejected_in_strict_and_lenient_modes() {
        for lenient in [false, true] {
            assert_line_paths_reject(DIR_LANG_STRING_BAD, lenient);
            assert_terse_paths_reject(DIR_LANG_STRING_BAD, lenient);
        }
    }

    #[test]
    fn prefixed_reserved_datatype_is_also_rejected() {
        let lang_string = format!("{PREFIX}{PREFIXED_LANG_STRING_BAD}");
        for lenient in [false, true] {
            assert_terse_paths_reject(lang_string.as_bytes(), lenient);
        }

        #[cfg(feature = "rdf-12")]
        {
            let dir_lang_string = format!("{PREFIX}{PREFIXED_DIR_LANG_STRING_BAD}");
            for lenient in [false, true] {
                assert_terse_paths_reject(dir_lang_string.as_bytes(), lenient);
            }
        }
    }

    #[cfg(feature = "async-tokio")]
    macro_rules! assert_async_rejected {
        ($parser:expr, $name:literal) => {{
            let mut parser = $parser;
            let mut errors = 0;
            while let Some(result) = parser.next().await {
                match result {
                    Ok(_) => panic!("{} emitted an invalid literal", $name),
                    Err(_) => errors += 1,
                }
            }
            assert!(errors > 0, "{} did not report a syntax error", $name);
        }};
    }

    #[cfg(feature = "async-tokio")]
    #[tokio::test]
    async fn asynchronous_paths_reject_reserved_datatypes() {
        for lenient in [false, true] {
            let triples = NTriplesParser::new();
            let triples = if lenient { triples.lenient() } else { triples };
            assert_async_rejected!(
                triples.for_tokio_async_reader(LANG_STRING_BAD),
                "N-Triples async"
            );

            let quads = NQuadsParser::new();
            let quads = if lenient { quads.lenient() } else { quads };
            assert_async_rejected!(
                quads.for_tokio_async_reader(LANG_STRING_BAD),
                "N-Quads async"
            );

            let turtle = TurtleParser::new();
            let turtle = if lenient { turtle.lenient() } else { turtle };
            assert_async_rejected!(
                turtle.for_tokio_async_reader(LANG_STRING_BAD),
                "Turtle async"
            );

            let trig = TriGParser::new();
            let trig = if lenient { trig.lenient() } else { trig };
            assert_async_rejected!(trig.for_tokio_async_reader(LANG_STRING_BAD), "TriG async");

            let n3 = N3Parser::new();
            let n3 = if lenient { n3.lenient() } else { n3 };
            assert_async_rejected!(n3.for_tokio_async_reader(LANG_STRING_BAD), "N3 async");
        }
    }
}
