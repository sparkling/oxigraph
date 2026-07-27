#![cfg(feature = "rdf-12")]

#[cfg(test)]
mod tests {
    use anyhow::{Context, Result, bail, ensure};
    use oxigraph::io::{RdfFormat, RdfParser, RdfSerializer};
    use oxigraph::model::graph::CanonicalizationAlgorithm;
    use oxigraph::model::{Dataset, Term};
    use oxigraph_testsuite::files::{guess_rdf_format, load_dataset};
    use oxigraph_testsuite::manifest::TestManifest;
    use std::collections::HashSet;
    use std::io;

    const RDF12_XML_EVAL_MANIFEST: &str =
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-xml/eval/manifest.ttl";
    const XML_EVAL_TEST: &str = "http://www.w3.org/ns/rdftest#TestXMLEval";
    const EXPECTED_POSITIVE_CASES: usize = 29;

    #[derive(Clone, Copy, Debug)]
    struct RdfXmlSerializationExclusion {
        test: &'static str,
        reason: RdfXmlSerializationExclusionReason,
    }

    #[derive(Clone, Copy, Debug)]
    #[expect(
        dead_code,
        reason = "the typed exclusion ledger is intentionally empty while all cases round-trip"
    )]
    enum RdfXmlSerializationExclusionReason {
        PredicateCannotBeXmlQName { predicate: &'static str },
        ReservedRdfSyntaxPredicate { predicate: &'static str },
        UnsupportedTripleTerm,
        UnsupportedDirectionalLiteral,
    }

    // Every entry must identify one manifest test and one mechanically checked
    // representation limit. An empty ledger means all current positive cases must
    // serialize and round-trip.
    const EXCLUSIONS: &[RdfXmlSerializationExclusion] = &[];

    #[test]
    fn rdf12_xml_public_serializer_manifest_round_trip() -> Result<()> {
        let mut evaluated = 0;
        let mut excluded = HashSet::new();
        for test in TestManifest::new([RDF12_XML_EVAL_MANIFEST]) {
            let test = test?;
            if !test.kinds.iter().any(|kind| kind.as_str() == XML_EVAL_TEST) {
                continue;
            }
            evaluated += 1;
            let id = test.id.as_str();
            let expected_url = test
                .result
                .as_deref()
                .with_context(|| format!("{id}: positive RDF/XML evaluation test has no result"))?;
            let expected =
                load_dataset(expected_url, guess_rdf_format(expected_url)?, false, false)
                    .with_context(|| format!("{id}: failed to load expected graph"))?;
            let exclusion = exclusion_for(id)?;

            match serialize_reparse_and_compare(&expected) {
                Ok(()) if exclusion.is_none() => {}
                Ok(()) => bail!("{id}: declared RDF/XML serializer exclusion now passes"),
                Err(error) => {
                    let Some(exclusion) = exclusion else {
                        return Err(error).with_context(|| {
                            format!("{id}: public RDF/XML serializer evidence failed")
                        });
                    };
                    ensure!(
                        exclusion.reason.applies_to(&expected),
                        "{id}: exclusion reason {:?} does not match the expected graph",
                        exclusion.reason
                    );
                    ensure!(
                        has_invalid_input_error(&error),
                        "{id}: excluded case failed for an unexpected reason: {error:#}"
                    );
                    ensure!(
                        excluded.insert(id.to_owned()),
                        "{id}: duplicate exclusion evaluation"
                    );
                }
            }
        }

        ensure!(
            evaluated == EXPECTED_POSITIVE_CASES,
            "expected {EXPECTED_POSITIVE_CASES} positive RDF 1.2 RDF/XML eval cases, evaluated {evaluated}"
        );
        ensure!(
            excluded.len() == EXCLUSIONS.len(),
            "expected {} typed exclusions to fail, observed {}",
            EXCLUSIONS.len(),
            excluded.len()
        );
        Ok(())
    }

    fn serialize_reparse_and_compare(expected: &Dataset) -> Result<()> {
        let mut serializer = RdfSerializer::from_format(RdfFormat::RdfXml).for_writer(Vec::new());
        for quad in expected {
            serializer.serialize_quad(&quad)?;
        }
        let output = serializer.finish()?;

        let mut actual = Dataset::new();
        for quad in RdfParser::from_format(RdfFormat::RdfXml).for_slice(&output) {
            actual.insert(quad?);
        }

        let mut expected = expected.clone();
        expected.canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)?;
        actual.canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)?;
        ensure!(
            actual == expected,
            "serialized RDF/XML reparsed to a non-isomorphic graph"
        );
        Ok(())
    }

    fn exclusion_for(test: &str) -> Result<Option<RdfXmlSerializationExclusion>> {
        let mut matches = EXCLUSIONS
            .iter()
            .copied()
            .filter(|entry| entry.test == test);
        let result = matches.next();
        ensure!(
            matches.next().is_none(),
            "{test}: duplicate typed RDF/XML serializer exclusions"
        );
        Ok(result)
    }

    impl RdfXmlSerializationExclusionReason {
        fn applies_to(self, dataset: &Dataset) -> bool {
            match self {
                Self::PredicateCannotBeXmlQName { predicate }
                | Self::ReservedRdfSyntaxPredicate { predicate } => dataset
                    .iter()
                    .any(|quad| quad.predicate.as_str() == predicate),
                Self::UnsupportedTripleTerm => dataset
                    .iter()
                    .any(|quad| contains_triple_term(&quad.object)),
                Self::UnsupportedDirectionalLiteral => dataset
                    .iter()
                    .any(|quad| contains_directional_literal(&quad.object)),
            }
        }
    }

    fn contains_triple_term(term: &Term) -> bool {
        match term {
            Term::Triple(_) => true,
            Term::NamedNode(_) | Term::BlankNode(_) | Term::Literal(_) => false,
        }
    }

    fn contains_directional_literal(term: &Term) -> bool {
        match term {
            Term::Literal(literal) => literal.direction().is_some(),
            Term::Triple(triple) => contains_directional_literal(&triple.object),
            Term::NamedNode(_) | Term::BlankNode(_) => false,
        }
    }

    fn has_invalid_input_error(error: &anyhow::Error) -> bool {
        error
            .chain()
            .filter_map(|source| source.downcast_ref::<io::Error>())
            .any(|error| error.kind() == io::ErrorKind::InvalidInput)
    }
}
