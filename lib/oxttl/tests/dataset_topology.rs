#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "integration-test assertions provide clearer topology regression failures"
)]

use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxttl::{TriGParser, TriGSerializer};
use std::error::Error;
use std::io;

#[test]
fn exact_empty_named_graph_round_trip() -> Result<(), Box<dyn Error>> {
    let input = b"<https://example.com/empty> {}\n";
    let dataset = TriGParser::new().for_slice(input).collect_dataset()?;

    assert!(dataset.is_empty());
    assert!(dataset.contains_named_graph(&NamedNode::new("https://example.com/empty")?));

    let mut serializer = TriGSerializer::new().for_writer(Vec::new());
    serializer.serialize_dataset(&dataset)?;
    let output = serializer.finish()?;
    assert_eq!(output, input);
    assert_eq!(
        TriGParser::new().for_slice(&output).collect_dataset()?,
        dataset
    );
    Ok(())
}

#[test]
fn blank_empty_named_graph_round_trip() -> Result<(), Box<dyn Error>> {
    let input = b"GRAPH _:empty {}\n";
    let dataset = TriGParser::new()
        .for_reader(input.as_slice())
        .collect_dataset()?;

    assert!(dataset.contains_named_graph(&BlankNode::new("empty")?));
    let mut serializer = TriGSerializer::new().for_writer(Vec::new());
    serializer.serialize_dataset(&dataset)?;
    let output = serializer.finish()?;
    assert_eq!(output, b"_:empty {}\n");
    assert_eq!(
        TriGParser::new()
            .for_reader(output.as_slice())
            .collect_dataset()?,
        dataset
    );
    Ok(())
}

#[test]
fn streaming_quads_remain_unchanged_while_batch_collection_keeps_topology()
-> Result<(), Box<dyn Error>> {
    let input = b"
        <https://example.com/empty> {}
        <https://example.com/full> {
            <https://example.com/s> <https://example.com/p> <https://example.com/o> .
        }
    ";

    let quads = TriGParser::new()
        .for_slice(input)
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(quads.len(), 1);

    let dataset = TriGParser::new().for_slice(input).collect_dataset()?;
    assert_eq!(dataset.len(), 1);
    assert_eq!(dataset.named_graphs().count(), 2);
    Ok(())
}

#[test]
fn dataset_serialization_validates_empty_graph_names_before_writing() -> Result<(), Box<dyn Error>>
{
    let mut dataset = Dataset::new();
    dataset.insert_named_graph(NamedNode::new_unchecked("relative"));
    dataset.insert_named_graph(NamedOrBlankNode::from(NamedNode::new(
        "https://example.com/valid",
    )?));

    let mut serializer = TriGSerializer::new().for_writer(Vec::new());
    let error = serializer.serialize_dataset(&dataset).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    assert!(serializer.finish()?.is_empty());
    Ok(())
}

#[test]
fn empty_graph_streaming_event_does_not_corrupt_adjacent_quads() -> Result<(), Box<dyn Error>> {
    let graph = NamedNode::new("https://example.com/full")?;
    let empty = NamedNode::new("https://example.com/empty")?;
    let mut serializer = TriGSerializer::new().for_writer(Vec::new());
    serializer.serialize_quad(&Quad::new(
        NamedNode::new("https://example.com/s")?,
        NamedNode::new("https://example.com/p")?,
        NamedNode::new("https://example.com/o")?,
        graph.clone(),
    ))?;
    serializer.serialize_empty_graph(&empty.clone().into())?;
    serializer.serialize_quad(&Quad::new(
        NamedNode::new("https://example.com/default-s")?,
        NamedNode::new("https://example.com/p")?,
        NamedNode::new("https://example.com/o")?,
        GraphName::DefaultGraph,
    ))?;
    let output = serializer.finish()?;

    let dataset = TriGParser::new().for_slice(&output).collect_dataset()?;
    assert_eq!(dataset.len(), 2);
    assert!(dataset.contains_named_graph(&graph));
    assert!(dataset.contains_named_graph(&empty));
    assert_eq!(dataset.named_graphs().count(), 2);
    Ok(())
}

#[cfg(feature = "async-tokio")]
#[tokio::test]
async fn async_empty_named_graph_round_trip() -> Result<(), Box<dyn Error>> {
    let input = b"<https://example.com/empty> {}\n";
    let dataset = TriGParser::new()
        .for_tokio_async_reader(input.as_slice())
        .collect_dataset()
        .await?;

    let mut serializer = TriGSerializer::new().for_tokio_async_writer(Vec::new());
    serializer.serialize_dataset(&dataset).await?;
    assert_eq!(serializer.finish().await?, input);
    Ok(())
}
