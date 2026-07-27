#[cfg(test)]
#[expect(clippy::panic_in_result_fn)]
mod tests {
    #[cfg(feature = "rdf-12")]
    use oxrdf::BaseDirection;
    use oxrdf::{BlankNode, Literal, NamedNode, Quad, RdfVersion, Triple};
    use oxttl::NQuadsSerializer;
    use oxttl::{NTriplesMediaType, NTriplesSerializer, TriGSerializer, TurtleSerializer};
    use std::error::Error;
    use std::io;

    const NTRIPLES_SOURCE_SHA256: &str =
        "dbb3424b30712d570c041fd5802c8dbb6a2ac7a35e41617fe3b0f53d3529559b";
    const NQUADS_SOURCE_SHA256: &str =
        "5fee5da7170e98f4f5e3019dc9c4fc6d866478f8dd22e8004448162f8f33b3d6";

    // Pinned clauses exercised by this file. These IDs come from
    // target/w3c/normative-control/clause-inventory.json.
    const CANONICAL_CLAUSES: &[&str] = &[
        "rdf12-n-triples:bcp14-clause:03cd2ddfa8cc99da61794a23",
        "rdf12-n-triples:bcp14-clause:1603fa7ef2f1f8cb9322f4c6",
        "rdf12-n-triples:bcp14-clause:4fd91cade8847e1e95d0c4fb",
        "rdf12-n-triples:bcp14-clause:684ed827becd8ec1df995eb8",
        "rdf12-n-triples:bcp14-clause:7a423dda787826605f43335e",
        "rdf12-n-triples:bcp14-clause:dc210722d51a3f50499bfd03",
        "rdf12-n-triples:bcp14-clause:de0afda1510772c8e898d4ea",
        "rdf12-n-triples:bcp14-clause:de4c8feeb62ba7a8b3a71c47",
        "rdf12-n-triples:bcp14-clause:e779f6e1689706c96f1bc064",
        "rdf12-n-triples:bcp14-clause:f2c5172ac44142dd4901f6fa",
        "rdf12-n-quads:bcp14-clause:0a6e8f88c50570a0c2b3a4ca",
        "rdf12-n-quads:bcp14-clause:0f240c8dd30537ce05c32aef",
        "rdf12-n-quads:bcp14-clause:1cd5c45f4d53d51fd2acbd4f",
        "rdf12-n-quads:bcp14-clause:2c22dfe65451530133ce678f",
        "rdf12-n-quads:bcp14-clause:3061783f39eff8afa534c162",
        "rdf12-n-quads:bcp14-clause:4bcf495dda1fee5ddcc2db3d",
        "rdf12-n-quads:bcp14-clause:519c7453ae9a4ea7ae96bf8a",
        "rdf12-n-quads:bcp14-clause:b9fbe66c15cd62204d5ab99a",
        "rdf12-n-quads:bcp14-clause:daaed287d721b494b9ae86ad",
    ];

    fn node(value: &'static str) -> NamedNode {
        NamedNode::new_unchecked(value)
    }

    fn triple(object: impl Into<oxrdf::Term>) -> Triple {
        Triple::new(
            node("http://example.com/s"),
            node("http://example.com/p"),
            object,
        )
    }

    #[test]
    fn canonical_clause_map_is_pinned_and_unique() {
        for source in [NTRIPLES_SOURCE_SHA256, NQUADS_SOURCE_SHA256] {
            assert_eq!(source.len(), 64);
            assert!(source.bytes().all(|byte| byte.is_ascii_hexdigit()));
        }
        let mut clauses = CANONICAL_CLAUSES.to_vec();
        clauses.sort_unstable();
        clauses.dedup();
        assert_eq!(clauses.len(), CANONICAL_CLAUSES.len());
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn canonical_rdf12_terms_never_emit_version_directives() -> Result<(), Box<dyn Error>> {
        let directional =
            Literal::new_directional_language_tagged_literal("hello", "EN", BaseDirection::Ltr)?;
        let nested = triple(directional);
        let containing = triple(nested);

        let mut triples = NTriplesSerializer::new().canonical().for_writer(Vec::new());
        triples.serialize_triple(&containing)?;
        assert_eq!(
        triples.finish()?,
        b"<http://example.com/s> <http://example.com/p> <<( <http://example.com/s> <http://example.com/p> \"hello\"@en--ltr )>> .\n"
    );

        let quad = Quad::new(
            containing.subject,
            containing.predicate,
            containing.object,
            node("http://example.com/g"),
        );
        let mut quads = NQuadsSerializer::new().canonical().for_writer(Vec::new());
        quads.serialize_quad(&quad)?;
        let output = quads.finish()?;
        assert!(!output.starts_with(b"VERSION"));
        assert!(output.ends_with(b"<http://example.com/g> .\n"));
        Ok(())
    }

    #[test]
    fn canonical_literal_escaping_is_byte_exact() -> Result<(), Box<dyn Error>> {
        let value = "\0\u{8}\t\n\u{b}\u{c}\r\u{7f}\u{fffe}\u{ffff}\u{e9}";
        let mut serializer = NTriplesSerializer::new().canonical().for_writer(Vec::new());
        serializer.serialize_triple(&triple(Literal::new_simple_literal(value)))?;
        assert_eq!(
        serializer.finish()?,
        "<http://example.com/s> <http://example.com/p> \"\\u0000\\b\\t\\n\\u000B\\f\\r\\u007F\\uFFFE\\uFFFF\u{e9}\" .\n".as_bytes()
    );
        Ok(())
    }

    #[test]
    fn canonical_and_text_plain_contracts_fail_atomically() -> Result<(), Box<dyn Error>> {
        let mut serializer = NTriplesSerializer::new()
            .canonical()
            .with_media_type(NTriplesMediaType::TextPlain)
            .low_level();
        let mut output = Vec::new();
        let Err(error) =
            serializer.serialize_triple(&triple(Literal::new_simple_literal("ascii")), &mut output)
        else {
            return Err(io::Error::other("canonical text/plain mode was accepted").into());
        };
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(output.is_empty());
        assert!(serializer.finish(&mut output).is_err());
        assert!(output.is_empty());
        Ok(())
    }

    #[test]
    fn rdf12_blank_node_grammar_change_is_version_scoped() -> Result<(), Box<dyn Error>> {
        let value = Triple::new(
            BlankNode::new("legacy:label")?,
            node("http://example.com/p"),
            node("http://example.com/o"),
        );

        let mut rdf11 = NTriplesSerializer::new()
            .with_rdf_version(RdfVersion::V1_1)
            .for_writer(Vec::new());
        rdf11.serialize_triple(&value)?;
        let output = rdf11.finish()?;
        assert_eq!(
            output,
            b"_:legacy:label <http://example.com/p> <http://example.com/o> .\n"
        );

        let quad = Quad::new(
            value.subject.clone(),
            value.predicate.clone(),
            value.object.clone(),
            node("http://example.com/g"),
        );
        let mut nquads11 = NQuadsSerializer::new()
            .with_rdf_version(RdfVersion::V1_1)
            .for_writer(Vec::new());
        nquads11.serialize_quad(&quad)?;
        assert!(!nquads11.finish()?.is_empty());

        let mut turtle11 = TurtleSerializer::new()
            .with_rdf_version(RdfVersion::V1_1)
            .for_writer(Vec::new());
        turtle11.serialize_triple(&value)?;
        assert!(!turtle11.finish()?.is_empty());

        let mut trig11 = TriGSerializer::new()
            .with_rdf_version(RdfVersion::V1_1)
            .for_writer(Vec::new());
        trig11.serialize_quad(&quad)?;
        assert!(!trig11.finish()?.is_empty());

        for versioned in [
            NTriplesSerializer::new().canonical(),
            NTriplesSerializer::new().with_rdf_version(RdfVersion::V1_2),
        ] {
            let mut serializer = versioned.low_level();
            let mut output = Vec::new();
            let Err(error) = serializer.serialize_triple(&value, &mut output) else {
                return Err(io::Error::other(
                    "RDF 1.2 serializer accepted ':' in a blank-node label",
                )
                .into());
            };
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
            assert!(output.is_empty());
        }

        for versioned in [
            NQuadsSerializer::new().canonical(),
            NQuadsSerializer::new().with_rdf_version(RdfVersion::V1_2),
        ] {
            let mut serializer = versioned.low_level();
            let mut output = Vec::new();
            assert!(serializer.serialize_quad(&quad, &mut output).is_err());
            assert!(output.is_empty());
        }

        let mut turtle12 = TurtleSerializer::new()
            .with_rdf_version(RdfVersion::V1_2)
            .low_level();
        let mut output = Vec::new();
        assert!(turtle12.serialize_triple(&value, &mut output).is_err());
        assert!(output.is_empty());

        let mut trig12 = TriGSerializer::new()
            .with_rdf_version(RdfVersion::V1_2)
            .low_level();
        assert!(trig12.serialize_quad(&quad, &mut output).is_err());
        assert!(output.is_empty());
        Ok(())
    }

    #[test]
    fn unchecked_invalid_terms_are_rejected_before_output() {
        let invalid_iri = Triple::new(
            node("http://example.com/invalid IRI"),
            node("http://example.com/p"),
            node("http://example.com/o"),
        );
        let invalid_language = triple(Literal::new_language_tagged_literal_unchecked(
            "value",
            "not_a_tag",
        ));

        for value in [&invalid_iri, &invalid_language] {
            let mut ntriples = NTriplesSerializer::new().low_level();
            let mut output = Vec::new();
            assert!(ntriples.serialize_triple(value, &mut output).is_err());
            assert!(output.is_empty());

            let mut turtle = TurtleSerializer::new().low_level();
            assert!(turtle.serialize_triple(value, &mut output).is_err());
            assert!(output.is_empty());

            let quad = Quad::new(
                value.subject.clone(),
                value.predicate.clone(),
                value.object.clone(),
                node("http://example.com/g"),
            );
            let mut trig = TriGSerializer::new().low_level();
            assert!(trig.serialize_quad(&quad, &mut output).is_err());
            assert!(output.is_empty());
        }
    }
}
