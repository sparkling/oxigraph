#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "integration tests exercise the public JSON-LD topology API"
)]

use oxjsonld::{JsonLdParser, JsonLdSerializer};
use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad};
use std::error::Error;
use std::io;

const EMPTY_GRAPHS: &[u8] = br#"[
    {"@id":"https://example.com/empty","@graph":[]},
    {"@id":"_:blank","@graph":[]},
    {"@id":"https://example.com/empty","@graph":[]}
]"#;

fn iri_graph() -> NamedNode {
    NamedNode::new("https://example.com/empty").unwrap()
}

fn blank_graph() -> BlankNode {
    BlankNode::new("blank").unwrap()
}

#[test]
fn parser_discovers_and_deduplicates_empty_named_graphs() -> Result<(), Box<dyn Error>> {
    let mut parser = JsonLdParser::new().for_reader(EMPTY_GRAPHS);
    assert_eq!(parser.named_graphs().count(), 0);
    assert_eq!(parser.by_ref().collect::<Result<Vec<_>, _>>()?.len(), 0);
    assert_eq!(
        parser.named_graphs().cloned().collect::<Vec<_>>(),
        vec![
            NamedOrBlankNode::from(iri_graph()),
            NamedOrBlankNode::from(blank_graph()),
        ]
    );

    let dataset = JsonLdParser::new()
        .for_slice(EMPTY_GRAPHS)
        .collect_dataset()?;
    assert!(dataset.contains_named_graph(&iri_graph()));
    assert!(dataset.contains_named_graph(&blank_graph()));
    assert_eq!(dataset.named_graphs().count(), 2);
    assert!(dataset.is_empty());
    Ok(())
}

#[test]
fn serializer_round_trips_iri_and_blank_empty_graphs() -> Result<(), Box<dyn Error>> {
    let mut dataset = Dataset::new();
    dataset.insert_named_graph(iri_graph());
    dataset.insert_named_graph(blank_graph());

    let mut serializer = JsonLdSerializer::new().for_writer(Vec::new());
    serializer.serialize_dataset(&dataset)?;
    let output = serializer.finish()?;
    let round_trip = JsonLdParser::new().for_slice(&output).collect_dataset()?;
    assert!(round_trip.contains_named_graph(&iri_graph()));
    assert!(round_trip.contains_named_graph(&blank_graph()));
    assert_eq!(round_trip.named_graphs().count(), 2);
    assert!(round_trip.is_empty());
    Ok(())
}

#[test]
fn empty_graph_events_fail_closed_on_duplicates_and_late_quads() -> Result<(), Box<dyn Error>> {
    let graph = NamedOrBlankNode::from(iri_graph());
    let quad = Quad::new(
        NamedNode::new("https://example.com/s")?,
        NamedNode::new("https://example.com/p")?,
        NamedNode::new("https://example.com/o")?,
        GraphName::from(graph.clone()),
    );

    let mut empty_first = JsonLdSerializer::new().for_writer(Vec::new());
    empty_first.serialize_empty_graph(&graph)?;
    let duplicate = empty_first.serialize_empty_graph(&graph).unwrap_err();
    assert_eq!(duplicate.kind(), io::ErrorKind::InvalidInput);
    let late_quad = empty_first.serialize_quad(&quad).unwrap_err();
    assert_eq!(late_quad.kind(), io::ErrorKind::InvalidInput);
    let parsed = JsonLdParser::new()
        .for_slice(&empty_first.finish()?)
        .collect_dataset()?;
    assert!(parsed.contains_named_graph(&graph));
    assert!(parsed.is_empty());

    let mut quad_first = JsonLdSerializer::new().for_writer(Vec::new());
    quad_first.serialize_quad(&quad)?;
    let not_empty = quad_first.serialize_empty_graph(&graph).unwrap_err();
    assert_eq!(not_empty.kind(), io::ErrorKind::InvalidInput);
    assert_eq!(
        JsonLdParser::new()
            .for_slice(&quad_first.finish()?)
            .collect_dataset()?
            .len(),
        1
    );
    Ok(())
}

#[cfg(feature = "async-tokio")]
#[tokio::test]
async fn async_parser_and_serializer_round_trip_empty_graphs() -> Result<(), Box<dyn Error>> {
    let source = JsonLdParser::new()
        .for_tokio_async_reader(EMPTY_GRAPHS)
        .collect_dataset()
        .await?;
    let mut serializer = JsonLdSerializer::new().for_tokio_async_writer(Vec::new());
    serializer.serialize_dataset(&source).await?;
    let output = serializer.finish().await?;
    let round_trip = JsonLdParser::new()
        .for_tokio_async_reader(output.as_slice())
        .collect_dataset()
        .await?;
    assert!(round_trip.contains_named_graph(&iri_graph()));
    assert!(round_trip.contains_named_graph(&blank_graph()));
    assert_eq!(round_trip.named_graphs().count(), 2);
    Ok(())
}
