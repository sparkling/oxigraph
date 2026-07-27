#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "integration-test assertions provide clearer topology regression failures"
)]

use oxjsonld::JsonLdProfileSet;
use oxrdf::{BlankNode, Dataset, NamedNode};
use oxrdfio::{RdfFormat, RdfParser, RdfSerializer};
use std::error::Error;
use std::io;

fn json_ld() -> RdfFormat {
    RdfFormat::JsonLd {
        profile: JsonLdProfileSet::empty(),
    }
}

#[test]
fn generic_trig_io_round_trips_empty_named_graph_exactly() -> Result<(), Box<dyn Error>> {
    let input = b"<https://example.com/empty> {}\n";
    let dataset = RdfParser::from_format(RdfFormat::TriG)
        .for_slice(input)
        .collect_dataset()?;
    assert!(dataset.contains_named_graph(&NamedNode::new("https://example.com/empty")?));

    let mut serializer = RdfSerializer::from_format(RdfFormat::TriG).for_writer(Vec::new());
    serializer.serialize_dataset(&dataset)?;
    assert_eq!(serializer.finish()?, input);
    Ok(())
}

#[test]
fn generic_non_topology_format_fails_on_empty_named_graph() -> Result<(), Box<dyn Error>> {
    let mut dataset = Dataset::new();
    dataset.insert_named_graph(NamedNode::new("https://example.com/empty")?);

    let mut serializer = RdfSerializer::from_format(RdfFormat::NQuads).for_writer(Vec::new());
    let error = serializer.serialize_dataset(&dataset).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(error.to_string().contains("use TriG or JSON-LD"));
    assert!(serializer.finish()?.is_empty());
    Ok(())
}

#[test]
fn named_graph_restriction_applies_to_empty_trig_graphs() {
    let result = RdfParser::from_format(RdfFormat::TriG)
        .without_named_graphs()
        .for_slice(b"<https://example.com/empty> {}")
        .collect_dataset();
    result.unwrap_err();
}

#[test]
fn named_graph_restriction_applies_to_empty_json_ld_graphs() {
    let result = RdfParser::from_format(json_ld())
        .without_named_graphs()
        .for_slice(br#"{"@id":"https://example.com/empty","@graph":[]}"#)
        .collect_dataset();
    result.unwrap_err();
}

#[test]
fn blank_node_renaming_is_shared_by_quads_and_empty_graph_topology() -> Result<(), Box<dyn Error>> {
    let dataset = RdfParser::from_format(RdfFormat::TriG)
        .rename_blank_nodes()
        .for_slice(b"_:shared {}\n_:shared <https://example.com/p> <https://example.com/o> .")
        .collect_dataset()?;
    let graph_name = dataset.named_graphs().next().unwrap();
    let subject = dataset.iter().next().unwrap().subject;
    assert_eq!(graph_name, subject);
    assert_ne!(graph_name, BlankNode::new("shared")?);
    Ok(())
}

#[test]
fn streaming_parser_exposes_topology_after_quad_drain() -> Result<(), Box<dyn Error>> {
    let mut parser = RdfParser::from_format(RdfFormat::TriG).for_reader(
        b"
            <https://example.com/empty> {}
            <https://example.com/full> {
                <https://example.com/s> <https://example.com/p> <https://example.com/o>
            }
        "
        .as_slice(),
    );
    assert_eq!(1, parser.by_ref().collect::<Result<Vec<_>, _>>()?.len());
    assert_eq!(2, parser.named_graphs()?.len());
    Ok(())
}

#[test]
fn generic_empty_graph_streaming_event_supports_trig_and_json_ld() -> Result<(), Box<dyn Error>> {
    let empty = NamedNode::new("https://example.com/empty")?.into();

    let mut trig = RdfSerializer::from_format(RdfFormat::TriG).for_writer(Vec::new());
    trig.serialize_empty_graph(&empty)?;
    assert_eq!(
        b"<https://example.com/empty> {}\n",
        trig.finish()?.as_slice()
    );

    let mut json_serializer = RdfSerializer::from_format(json_ld()).for_writer(Vec::new());
    json_serializer.serialize_empty_graph(&empty)?;
    let dataset = RdfParser::from_format(json_ld())
        .for_slice(&json_serializer.finish()?)
        .collect_dataset()?;
    assert!(dataset.contains_named_graph(&empty));

    let mut nquads = RdfSerializer::from_format(RdfFormat::NQuads).for_writer(Vec::new());
    let error = nquads.serialize_empty_graph(&empty).unwrap_err();
    assert_eq!(io::ErrorKind::InvalidInput, error.kind());
    assert!(nquads.finish()?.is_empty());
    Ok(())
}

#[test]
fn generic_json_ld_io_round_trips_iri_and_blank_empty_graphs() -> Result<(), Box<dyn Error>> {
    let iri = NamedNode::new("https://example.com/empty")?;
    let blank = BlankNode::new("empty-blank")?;
    let mut dataset = Dataset::new();
    dataset.insert_named_graph(iri.clone());
    dataset.insert_named_graph(blank.clone());

    let mut serializer = RdfSerializer::from_format(json_ld()).for_writer(Vec::new());
    serializer.serialize_dataset(&dataset)?;
    let output = serializer.finish()?;
    let round_trip = RdfParser::from_format(json_ld())
        .for_slice(&output)
        .collect_dataset()?;
    assert!(round_trip.contains_named_graph(&iri));
    assert!(round_trip.contains_named_graph(&blank));
    assert_eq!(round_trip.named_graphs().count(), 2);
    Ok(())
}

#[test]
fn generic_json_ld_streaming_parser_exposes_topology_after_drain() -> Result<(), Box<dyn Error>> {
    let mut parser = RdfParser::from_format(json_ld()).for_reader(
        br#"[
            {"@id":"https://example.com/empty","@graph":[]},
            {"@id":"_:blank","@graph":[]}
        ]"#
        .as_slice(),
    );
    assert_eq!(parser.by_ref().collect::<Result<Vec<_>, _>>()?.len(), 0);
    assert_eq!(parser.named_graphs()?.len(), 2);
    Ok(())
}

#[cfg(feature = "async-tokio")]
#[tokio::test]
async fn generic_async_trig_io_preserves_empty_named_graph() -> Result<(), Box<dyn Error>> {
    let input = b"<https://example.com/empty> {}\n";
    let dataset = RdfParser::from_format(RdfFormat::TriG)
        .for_tokio_async_reader(input.as_slice())
        .collect_dataset()
        .await?;

    let mut serializer =
        RdfSerializer::from_format(RdfFormat::TriG).for_tokio_async_writer(Vec::new());
    serializer.serialize_dataset(&dataset).await?;
    assert_eq!(serializer.finish().await?, input);
    Ok(())
}

#[cfg(feature = "async-tokio")]
#[tokio::test]
async fn generic_async_json_ld_io_preserves_empty_named_graph() -> Result<(), Box<dyn Error>> {
    let input = br#"{"@id":"https://example.com/empty","@graph":[]}"#;
    let dataset = RdfParser::from_format(json_ld())
        .for_tokio_async_reader(input.as_slice())
        .collect_dataset()
        .await?;

    let mut serializer = RdfSerializer::from_format(json_ld()).for_tokio_async_writer(Vec::new());
    serializer.serialize_dataset(&dataset).await?;
    let output = serializer.finish().await?;
    let round_trip = RdfParser::from_format(json_ld())
        .for_tokio_async_reader(output.as_slice())
        .collect_dataset()
        .await?;
    assert!(round_trip.contains_named_graph(&NamedNode::new("https://example.com/empty")?));
    Ok(())
}
