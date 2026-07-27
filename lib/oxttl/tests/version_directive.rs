#[cfg(test)]
mod tests {
    #[cfg(feature = "rdf-12")]
    use oxttl::NTriplesMediaType;
    use oxttl::{NQuadsParser, NTriplesParser};

    #[cfg(feature = "rdf-12")]
    const TRIPLE: &str = "<http://example/s> <http://example/p> <http://example/o> .\n";
    #[cfg(feature = "rdf-12")]
    const QUAD: &str =
        "<http://example/s> <http://example/p> <http://example/o> <http://example/g> .\n";

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

    fn triple_sync_summaries(input: &[u8]) -> [(usize, usize); 3] {
        [
            summary(NTriplesParser::new().for_slice(input)),
            summary(NTriplesParser::new().for_reader(input)),
            triple_low_level_summary(input),
        ]
    }

    fn quad_sync_summaries(input: &[u8]) -> [(usize, usize); 3] {
        [
            summary(NQuadsParser::new().for_slice(input)),
            summary(NQuadsParser::new().for_reader(input)),
            quad_low_level_summary(input),
        ]
    }

    fn triple_low_level_summary(input: &[u8]) -> (usize, usize) {
        let mut parser = NTriplesParser::new().low_level();
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

    fn quad_low_level_summary(input: &[u8]) -> (usize, usize) {
        let mut parser = NQuadsParser::new().low_level();
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

    #[cfg(feature = "rdf-12")]
    fn first_triple_error(input: &str) -> String {
        NTriplesParser::new()
            .for_slice(input)
            .find_map(|result| result.err().map(|error| error.to_string()))
            .unwrap_or_default()
    }

    #[cfg(feature = "rdf-12")]
    fn first_quad_error(input: &str) -> String {
        NQuadsParser::new()
            .for_slice(input)
            .find_map(|result| result.err().map(|error| error.to_string()))
            .unwrap_or_default()
    }

    fn assert_rejected_by_line_parsers(input: &str) {
        for (_, errors) in triple_sync_summaries(input.as_bytes()) {
            assert!(errors > 0, "N-Triples unexpectedly accepted {input:?}");
        }
        for (_, errors) in quad_sync_summaries(input.as_bytes()) {
            assert!(errors > 0, "N-Quads unexpectedly accepted {input:?}");
        }
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn exact_directive_is_accepted_across_synchronous_paths() {
        let triples = format!(
            "# declaration may follow comments and blank lines\n\nVERSION \"next\\u0020version\" # hint\n{TRIPLE}"
        );
        let quads = format!(
            "# declaration may follow comments and blank lines\n\nVERSION \"next\\u0020version\" # hint\n{QUAD}"
        );
        assert_eq!(triple_sync_summaries(triples.as_bytes()), [(1, 0); 3]);
        assert_eq!(quad_sync_summaries(quads.as_bytes()), [(1, 0); 3]);

        assert_eq!(triple_sync_summaries(b"VERSION \"1.2\""), [(0, 0); 3]);
        assert_eq!(quad_sync_summaries(b"VERSION \"1.2\""), [(0, 0); 3]);
    }

    #[cfg(not(feature = "rdf-12"))]
    #[test]
    fn rdf_11_build_rejects_the_rdf_12_directive() {
        assert_rejected_by_line_parsers("VERSION \"1.2\"\n");
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn keyword_is_case_sensitive_and_malformed_forms_fail_closed() {
        for input in [
            "version \"1.2\"\n",
            "Version \"1.2\"\n",
            "VERSiON \"1.2\"\n",
            "VERSION\n",
            "VERSION 1.2\n",
            "VERSION '1.2'\n",
            "VERSION \"\"\"1.2\"\"\"\n",
            "VERSION \"1.2\" .\n",
            "VERSION \"1.2\"@en\n",
            "VERSION \"1.2\"^^<http://example/type>\n",
            "VERSION \"1.2\" <http://example/s> <http://example/p> <http://example/o> .\n",
        ] {
            assert_rejected_by_line_parsers(input);
        }
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn duplicate_and_misplaced_directives_fail_closed_even_when_lenient() {
        let duplicate = "VERSION \"1.2\"\nVERSION \"1.2\"\n";
        let misplaced_triple = format!("{TRIPLE}VERSION \"1.2\"\n");
        let misplaced_quad = format!("{QUAD}VERSION \"1.2\"\n");

        assert!(first_triple_error(duplicate).contains("Only one VERSION"));
        assert!(first_quad_error(duplicate).contains("Only one VERSION"));
        assert!(first_triple_error(&misplaced_triple).contains("must precede"));
        assert!(first_quad_error(&misplaced_quad).contains("must precede"));

        assert!(
            NTriplesParser::new()
                .lenient()
                .for_slice(duplicate)
                .any(|result| result.is_err())
        );
        assert!(
            NQuadsParser::new()
                .lenient()
                .for_slice(duplicate)
                .any(|result| result.is_err())
        );
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn text_plain_transport_still_enforces_ascii() {
        let escaped = "VERSION \"1.\\u00E9\"\n";
        let raw = "VERSION \"1.\u{e9}\"\n";
        assert_eq!(
            summary(
                NTriplesParser::new()
                    .with_media_type(NTriplesMediaType::TextPlain)
                    .for_slice(escaped)
            ),
            (0, 0)
        );
        assert_eq!(
            summary(NTriplesParser::new().for_slice(raw)),
            (0, 0),
            "application/n-triples is UTF-8"
        );
        assert!(
            NTriplesParser::new()
                .with_media_type(NTriplesMediaType::TextPlain)
                .for_slice(raw)
                .any(|result| result.is_err())
        );
    }

    #[cfg(feature = "rdf-12")]
    fn large_document(version: &str, statement: &str, version_last: bool) -> (String, usize) {
        let statement_count = 800;
        let mut document = String::with_capacity(statement.len() * statement_count + version.len());
        if !version_last {
            document.push_str(version);
        }
        for _ in 0..statement_count {
            document.push_str(statement);
        }
        if version_last {
            document.push_str(version);
        }
        (document, statement_count)
    }

    #[cfg(feature = "rdf-12")]
    fn assert_parallel_contract<T, E>(
        parsers: Vec<impl IntoIterator<Item = Result<T, E>>>,
        expected_values: usize,
        expected_errors: usize,
    ) {
        assert!(parsers.len() > 1, "test document did not split");
        let (values, errors) = summary(parsers.into_iter().flatten());
        assert_eq!(
            (values, errors),
            (expected_values, expected_errors),
            "parallel parser outcomes diverged"
        );
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn parallel_slice_and_file_paths_only_allow_version_in_the_first_chunk() {
        let version = "VERSION \"1.2\"\n";
        for (statement, is_quad) in [(TRIPLE, false), (QUAD, true)] {
            let (valid, statement_count) = large_document(version, statement, false);
            let (misplaced, _) = large_document(version, statement, true);
            let valid_file = tempfile::NamedTempFile::new().unwrap();
            let misplaced_file = tempfile::NamedTempFile::new().unwrap();
            std::fs::write(valid_file.path(), &valid).unwrap();
            std::fs::write(misplaced_file.path(), &misplaced).unwrap();

            if is_quad {
                assert_parallel_contract(
                    NQuadsParser::new().split_slice_for_parallel_parsing(&valid, 2),
                    statement_count,
                    0,
                );
                assert_parallel_contract(
                    NQuadsParser::new().split_slice_for_parallel_parsing(&misplaced, 2),
                    statement_count,
                    1,
                );
                assert_parallel_contract(
                    NQuadsParser::new()
                        .split_file_for_parallel_parsing(valid_file.path(), 2)
                        .unwrap(),
                    statement_count,
                    0,
                );
                assert_parallel_contract(
                    NQuadsParser::new()
                        .split_file_for_parallel_parsing(misplaced_file.path(), 2)
                        .unwrap(),
                    statement_count,
                    1,
                );
            } else {
                assert_parallel_contract(
                    NTriplesParser::new().split_slice_for_parallel_parsing(&valid, 2),
                    statement_count,
                    0,
                );
                assert_parallel_contract(
                    NTriplesParser::new().split_slice_for_parallel_parsing(&misplaced, 2),
                    statement_count,
                    1,
                );
                assert_parallel_contract(
                    NTriplesParser::new()
                        .split_file_for_parallel_parsing(valid_file.path(), 2)
                        .unwrap(),
                    statement_count,
                    0,
                );
                assert_parallel_contract(
                    NTriplesParser::new()
                        .split_file_for_parallel_parsing(misplaced_file.path(), 2)
                        .unwrap(),
                    statement_count,
                    1,
                );
            }
        }
    }

    #[cfg(all(feature = "rdf-12", feature = "async-tokio"))]
    #[tokio::test]
    async fn async_paths_match_synchronous_paths() {
        let triples = format!("VERSION \"1.2\"\n{TRIPLE}");
        let quads = format!("VERSION \"1.2\"\n{QUAD}");
        let mut triple_parser = NTriplesParser::new().for_tokio_async_reader(triples.as_bytes());
        let mut quad_parser = NQuadsParser::new().for_tokio_async_reader(quads.as_bytes());

        assert!(
            matches!(triple_parser.next().await, Some(Ok(_))),
            "N-Triples async parser rejected the directive"
        );
        assert!(
            triple_parser.next().await.is_none(),
            "N-Triples async parser emitted extra outcomes"
        );
        assert!(
            matches!(quad_parser.next().await, Some(Ok(_))),
            "N-Quads async parser rejected the directive"
        );
        assert!(
            quad_parser.next().await.is_none(),
            "N-Quads async parser emitted extra outcomes"
        );

        let mut triple_parser =
            NTriplesParser::new().for_tokio_async_reader(b"VERSION \"1.2\" .\n".as_slice());
        let mut quad_parser =
            NQuadsParser::new().for_tokio_async_reader(b"VERSION \"1.2\" .\n".as_slice());
        assert!(
            matches!(triple_parser.next().await, Some(Err(_))),
            "N-Triples async parser accepted a malformed directive"
        );
        assert!(
            matches!(quad_parser.next().await, Some(Err(_))),
            "N-Quads async parser accepted a malformed directive"
        );
    }
}
