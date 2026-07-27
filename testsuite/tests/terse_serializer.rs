#![cfg(feature = "rdf-12")]

#[cfg(test)]
mod tests {
    use anyhow::{Context, Result, ensure};
    use oxigraph::io::{RdfFormat, RdfParser, RdfSerializer};
    use oxigraph::model::graph::CanonicalizationAlgorithm;
    use oxigraph::model::{Dataset, RdfVersion};
    use oxigraph_testsuite::files::{
        guess_rdf_format, load_dataset, read_file, read_file_to_string,
    };
    use oxigraph_testsuite::manifest::TestManifest;
    use oxttl::{NQuadsSerializer, NTriplesSerializer};

    const TURTLE_MANIFEST: &str =
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-turtle/eval/manifest.ttl";
    const TRIG_MANIFEST: &str =
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-trig/eval/manifest.ttl";
    const NTRIPLES_MANIFEST: &str =
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-triples/syntax/manifest.ttl";
    const NQUADS_MANIFEST: &str =
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-quads/syntax/manifest.ttl";
    const NTRIPLES_C14N_MANIFEST: &str =
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-triples/c14n/manifest.ttl";
    const NQUADS_C14N_MANIFEST: &str =
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-quads/c14n/manifest.ttl";
    const TURTLE_EVAL: &str = "http://www.w3.org/ns/rdftest#TestTurtleEval";
    const TRIG_EVAL: &str = "http://www.w3.org/ns/rdftest#TestTrigEval";
    const NTRIPLES_POSITIVE: &str = "http://www.w3.org/ns/rdftest#TestNTriplesPositiveSyntax";
    const NQUADS_POSITIVE: &str = "http://www.w3.org/ns/rdftest#TestNQuadsPositiveSyntax";
    const NTRIPLES_C14N: &str = "http://www.w3.org/ns/rdftest#TestNTriplesPositiveC14N";
    const NQUADS_C14N: &str = "http://www.w3.org/ns/rdftest#TestNQuadsPositiveC14N";

    #[test]
    fn rdf12_turtle_public_serializer_manifest_round_trip() -> Result<()> {
        run_manifest(TURTLE_MANIFEST, TURTLE_EVAL, RdfFormat::Turtle, 29)
    }

    #[test]
    fn rdf12_trig_public_serializer_manifest_round_trip() -> Result<()> {
        run_manifest(TRIG_MANIFEST, TRIG_EVAL, RdfFormat::TriG, 25)
    }

    #[test]
    fn rdf12_ntriples_public_serializer_manifest_round_trip() -> Result<()> {
        run_syntax_manifest(NTRIPLES_MANIFEST, NTRIPLES_POSITIVE, RdfFormat::NTriples, 7)
    }

    #[test]
    fn rdf12_nquads_public_serializer_manifest_round_trip() -> Result<()> {
        run_syntax_manifest(NQUADS_MANIFEST, NQUADS_POSITIVE, RdfFormat::NQuads, 7)
    }

    #[test]
    fn rdf12_ntriples_public_serializer_canonical_manifest() -> Result<()> {
        run_canonical_manifest(
            NTRIPLES_C14N_MANIFEST,
            NTRIPLES_C14N,
            RdfFormat::NTriples,
            41,
        )
    }

    #[test]
    fn rdf12_nquads_public_serializer_canonical_manifest() -> Result<()> {
        run_canonical_manifest(NQUADS_C14N_MANIFEST, NQUADS_C14N, RdfFormat::NQuads, 41)
    }

    fn run_manifest(
        manifest: &str,
        kind: &str,
        output_format: RdfFormat,
        expected_cases: usize,
    ) -> Result<()> {
        let mut evaluated = 0;
        for test in TestManifest::new([manifest]) {
            let test = test?;
            if !test
                .kinds
                .iter()
                .any(|candidate| candidate.as_str() == kind)
            {
                continue;
            }
            evaluated += 1;
            let id = test.id.as_str();
            let expected_url = test
                .result
                .as_deref()
                .with_context(|| format!("{id}: positive evaluation test has no result"))?;
            let expected =
                load_dataset(expected_url, guess_rdf_format(expected_url)?, false, false)
                    .with_context(|| format!("{id}: failed to load expected dataset"))?;
            serialize_reparse_and_compare(id, &expected, output_format)?;
        }
        ensure!(
            evaluated == expected_cases,
            "expected {expected_cases} {output_format} evaluation cases, evaluated {evaluated}"
        );
        Ok(())
    }

    fn run_syntax_manifest(
        manifest: &str,
        kind: &str,
        output_format: RdfFormat,
        expected_cases: usize,
    ) -> Result<()> {
        let mut evaluated = 0;
        for test in TestManifest::new([manifest]) {
            let test = test?;
            if !test
                .kinds
                .iter()
                .any(|candidate| candidate.as_str() == kind)
            {
                continue;
            }
            evaluated += 1;
            let id = test.id.as_str();
            let action = test
                .action
                .as_deref()
                .with_context(|| format!("{id}: positive syntax test has no action"))?;
            let expected = load_dataset(action, guess_rdf_format(action)?, false, false)
                .with_context(|| format!("{id}: failed to load positive syntax input"))?;
            serialize_reparse_and_compare(id, &expected, output_format)?;
        }
        ensure!(
            evaluated == expected_cases,
            "expected {expected_cases} {output_format} positive syntax cases, evaluated {evaluated}"
        );
        Ok(())
    }

    fn run_canonical_manifest(
        manifest: &str,
        kind: &str,
        format: RdfFormat,
        expected_cases: usize,
    ) -> Result<()> {
        let mut evaluated = 0;
        for test in TestManifest::new([manifest]) {
            let test = test?;
            if !test
                .kinds
                .iter()
                .any(|candidate| candidate.as_str() == kind)
            {
                continue;
            }
            evaluated += 1;
            let id = test.id.as_str();
            let action = test
                .action
                .as_deref()
                .with_context(|| format!("{id}: canonicalization test has no action"))?;
            let expected_url = test
                .result
                .as_deref()
                .with_context(|| format!("{id}: canonicalization test has no result"))?;
            let expected = read_file_to_string(expected_url)?;

            let output = match format {
                RdfFormat::NTriples => {
                    let mut serializer =
                        NTriplesSerializer::new().canonical().for_writer(Vec::new());
                    for quad in RdfParser::from_format(format).for_reader(read_file(action)?) {
                        serializer.serialize_triple(quad?.as_triple())?;
                    }
                    serializer.finish()?
                }
                RdfFormat::NQuads => {
                    let mut serializer = NQuadsSerializer::new().canonical().for_writer(Vec::new());
                    for quad in RdfParser::from_format(format).for_reader(read_file(action)?) {
                        serializer.serialize_quad(&quad?)?;
                    }
                    serializer.finish()?
                }
                _ => unreachable!("canonical manifest helper only accepts N-Triples or N-Quads"),
            };
            ensure!(
                output == expected.as_bytes(),
                "{id}: public canonical {format} serializer output differs"
            );
        }
        ensure!(
            evaluated == expected_cases,
            "expected {expected_cases} canonical {format} cases, evaluated {evaluated}"
        );
        Ok(())
    }

    fn serialize_reparse_and_compare(
        id: &str,
        expected: &Dataset,
        output_format: RdfFormat,
    ) -> Result<()> {
        let serializer =
            RdfSerializer::from_format(output_format).with_rdf_version(RdfVersion::V1_2)?;
        let mut serializer = serializer.for_writer(Vec::new());
        for quad in expected {
            serializer
                .serialize_quad(&quad)
                .with_context(|| format!("{id}: failed to serialize {output_format}"))?;
        }
        let output = serializer.finish()?;

        let mut actual = Dataset::new();
        for quad in RdfParser::from_format(output_format).for_slice(&output) {
            actual.insert(quad.with_context(|| {
                format!("{id}: serialized {output_format} could not be reparsed")
            })?);
        }

        let mut expected = expected.clone();
        expected.canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)?;
        actual.canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)?;
        ensure!(
            actual == expected,
            "{id}: serialized {output_format} reparsed to a non-isomorphic dataset"
        );
        Ok(())
    }
}
