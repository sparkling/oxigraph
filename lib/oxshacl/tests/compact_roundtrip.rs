#![cfg(feature = "w3c-tests")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests close the public SHACL-C to RDF boundary"
)]

use oxrdf::{Dataset, GraphName};
use oxshacl::{
    ProfileSet, ShaclcError, ShaclcLimits, ShaclcParser, ShapesGraph, ValidationOptions,
    parse_shaclc,
};
use oxttl::{NTriplesParser, NTriplesSerializer};
use std::error::Error;

fn ntriples_round_trip(
    graph: &oxshacl::GraphSnapshot,
) -> Result<(Vec<u8>, Dataset), Box<dyn Error>> {
    let mut serializer = NTriplesSerializer::new().for_writer(Vec::new());
    for triple in graph.triples() {
        serializer.serialize_triple(&triple)?;
    }
    let bytes = serializer.finish()?;
    let round_trip = NTriplesParser::new()
        .for_slice(&bytes)
        .map(|triple| triple.map(|triple| triple.in_graph(GraphName::DefaultGraph)))
        .collect::<Result<Dataset, _>>()?;
    Ok((bytes, round_trip))
}

#[test]
fn compact_mapping_survives_a_real_rdf_serialization_round_trip() -> Result<(), Box<dyn Error>> {
    let graph = parse_shaclc(
        r#"PREFIX ex: <http://example.test/ns#>
           shape ex:Person -> ex:PersonClass {
             ex:name xsd:string [1..2] .
             ex:friend @ex:Friend .
             ex:status in=[ex:Active "paused"@en true 42] .
             (ex:parent|^ex:child)+ IRI .
           }
           shape ex:Friend {}"#,
        Some("http://example.test/shapes"),
    )?;
    let (serialized, parsed) = ntriples_round_trip(&graph)?;

    if serialized.is_empty() {
        return Err("N-Triples serialization was empty".into());
    }
    if graph.dataset().len() != parsed.len() {
        return Err("N-Triples round trip changed the triple count".into());
    }
    if !graph.dataset().is_isomorphic_to(&parsed)? {
        return Err("N-Triples round trip changed the mapped RDF graph".into());
    }
    ShapesGraph::compile_checked(
        &oxshacl::GraphSnapshot::default_graph(parsed),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )?;
    Ok(())
}

#[test]
fn compact_negative_cases_report_stable_source_locations() {
    let cases = [
        ("shape <urn:s> {\n  <urn:p> [1..] .\n}", 2),
        ("shape <urn:s> {\n  (<urn:p>|) .\n}", 2),
        ("shape <urn:s> {\n  <urn:p> hasValue=\"unterminated\n}", 2),
        ("shape <urn:s> {\n  <urn:p> in=[1, 2] .\n}", 2),
        ("shape <urn:s> {\n  <urn:p> @ .\n}", 2),
    ];
    for (source, expected_line) in cases {
        let error = parse_shaclc(source, Some("urn:test:base")).unwrap_err();
        assert!(
            matches!(
                error,
                ShaclcError::Syntax { line, column, .. }
                    if line == expected_line && column > 0
            ),
            "{source:?}: {error}"
        );
    }
}

#[test]
fn every_compact_parser_budget_fails_closed() {
    let source = "shape <urn:s> -> <urn:Class> { <urn:p> in=[1 2] . }";
    let cases = [
        (
            "source bytes",
            ShaclcLimits {
                max_source_bytes: 1,
                ..ShaclcLimits::default()
            },
        ),
        (
            "tokens",
            ShaclcLimits {
                max_tokens: 1,
                ..ShaclcLimits::default()
            },
        ),
        (
            "nesting depth",
            ShaclcLimits {
                max_nesting_depth: 0,
                ..ShaclcLimits::default()
            },
        ),
        (
            "shapes",
            ShaclcLimits {
                max_shapes: 0,
                ..ShaclcLimits::default()
            },
        ),
        (
            "list items",
            ShaclcLimits {
                max_list_items: 0,
                ..ShaclcLimits::default()
            },
        ),
        (
            "mapped triples",
            ShaclcLimits {
                max_triples: 0,
                ..ShaclcLimits::default()
            },
        ),
    ];
    for (kind, limits) in cases {
        assert!(matches!(
            ShaclcParser::new()
                .with_base_iri("urn:test:base")
                .unwrap()
                .with_limits(limits)
                .parse(source),
            Err(ShaclcError::LimitExceeded { kind: actual, .. }) if actual == kind
        ));
    }
}
