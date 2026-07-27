#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration-test assertions provide clearer topology regression failures"
)]

use oxigraph::io::{JsonLdProfileSet, RdfFormat, RdfParser};
use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode};
use oxigraph::store::Store;

const EMPTY_GRAPH_IRI: &str = "http://example.com/empty";
const FULL_GRAPH_IRI: &str = "http://example.com/full";
const TRIG_DATASET: &str = "
    <http://example.com/empty> {}
    <http://example.com/full> {
        <http://example.com/s> <http://example.com/p> <http://example.com/o>
    }
";
const JSON_LD_DATASET: &str = r#"[
    {"@id":"http://example.com/empty","@graph":[]},
    {
        "@id":"http://example.com/full",
        "@graph":[{
            "@id":"http://example.com/s",
            "http://example.com/p":[{"@id":"http://example.com/o"}]
        }]
    }
]"#;

fn json_ld() -> RdfFormat {
    RdfFormat::JsonLd {
        profile: JsonLdProfileSet::empty(),
    }
}

fn empty_graph() -> NamedOrBlankNode {
    NamedNode::new_unchecked(EMPTY_GRAPH_IRI).into()
}

fn assert_loaded_topology(store: &Store) -> Result<(), Box<dyn std::error::Error>> {
    assert!(store.contains_named_graph(&empty_graph())?);
    assert!(store.contains_named_graph(&NamedNode::new_unchecked(FULL_GRAPH_IRI).into())?);
    assert_eq!(
        2,
        store.named_graphs().collect::<Result<Vec<_>, _>>()?.len()
    );
    assert_eq!(1, store.len()?);
    Ok(())
}

#[test]
fn store_reader_load_preserves_empty_named_graphs() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    store.load_from_reader(RdfFormat::TriG, TRIG_DATASET.as_bytes())?;
    assert_loaded_topology(&store)
}

#[test]
fn store_slice_load_preserves_empty_named_graphs() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    store.load_from_slice(RdfFormat::TriG, TRIG_DATASET)?;
    assert_loaded_topology(&store)
}

#[test]
fn json_ld_store_load_bulk_and_dump_preserve_topology() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    store.load_from_slice(json_ld(), JSON_LD_DATASET)?;
    assert_loaded_topology(&store)?;

    let bulk_store = Store::new()?;
    let mut loader = bulk_store.bulk_loader();
    loader.parallel_load_from_slice(
        RdfParser::from_format(json_ld()),
        JSON_LD_DATASET.as_bytes(),
    )?;
    loader.commit()?;
    assert_loaded_topology(&bulk_store)?;

    let output = store.dump_to_writer(json_ld(), Vec::new())?;
    let dataset = RdfParser::from_format(json_ld())
        .for_slice(&output)
        .collect_dataset()?;
    assert!(dataset.contains_named_graph(&empty_graph()));
    assert!(dataset.contains_named_graph(&NamedNode::new_unchecked(FULL_GRAPH_IRI)));
    assert_eq!(dataset.len(), 1);
    Ok(())
}

#[test]
fn transaction_load_is_parse_atomic_and_preserves_topology()
-> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    let mut transaction = store.start_transaction()?;
    transaction.load_from_slice(RdfFormat::TriG, TRIG_DATASET)?;
    assert!(transaction.contains_named_graph(&empty_graph())?);
    transaction.commit()?;
    assert_loaded_topology(&store)?;

    let mut transaction = store.start_transaction()?;
    let invalid = "
        <http://example.com/rejected> {
            <http://example.com/s> <http://example.com/p> <http://example.com/o>
        }
        INVALID
    ";
    transaction
        .load_from_reader(RdfFormat::TriG, invalid.as_bytes())
        .unwrap_err();
    assert!(
        !transaction.contains_named_graph(
            &NamedNode::new_unchecked("http://example.com/rejected").into()
        )?
    );
    assert_eq!(1, transaction.len()?);
    Ok(())
}

#[test]
fn bulk_reader_load_preserves_empty_named_graphs() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    let mut loader = store.bulk_loader();
    loader.load_from_reader(RdfFormat::TriG, TRIG_DATASET.as_bytes())?;
    loader.commit()?;
    assert_loaded_topology(&store)
}

#[test]
fn bulk_slice_load_preserves_empty_named_graphs_atomically()
-> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    let mut loader = store.bulk_loader();
    loader.load_from_slice(RdfFormat::TriG, TRIG_DATASET)?;
    loader.commit()?;
    assert_loaded_topology(&store)?;

    let rejected_store = Store::new()?;
    let mut loader = rejected_store.bulk_loader();
    loader
        .load_from_slice(RdfFormat::TriG, "<http://example.com/rejected> {} INVALID")
        .unwrap_err();
    drop(loader);
    assert!(
        !rejected_store.contains_named_graph(
            &NamedNode::new_unchecked("http://example.com/rejected").into()
        )?
    );
    Ok(())
}

#[cfg(feature = "rocksdb")]
#[test]
fn rocksdb_bulk_load_persists_empty_named_graphs() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    {
        let store = Store::open(directory.path())?;
        let mut loader = store.bulk_loader();
        loader.load_from_slice(RdfFormat::TriG, TRIG_DATASET)?;
        loader.commit()?;
        assert_loaded_topology(&store)?;
    }
    let reopened = Store::open(directory.path())?;
    assert_loaded_topology(&reopened)
}

#[test]
fn trig_dump_round_trips_empty_named_graph_topology() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    store.load_from_slice(RdfFormat::TriG, TRIG_DATASET)?;

    let output = store.dump_to_writer(RdfFormat::TriG, Vec::new())?;
    let dataset = RdfParser::from_format(RdfFormat::TriG)
        .for_slice(&output)
        .collect_dataset()?;
    assert!(dataset.contains_named_graph(&empty_graph()));
    assert!(dataset.contains_named_graph(&NamedNode::new_unchecked(FULL_GRAPH_IRI)));
    assert_eq!(1, dataset.len());

    let restored = Store::new()?;
    restored.load_from_slice(RdfFormat::TriG, &output)?;
    assert_loaded_topology(&restored)
}

#[test]
fn dump_fails_before_writing_when_format_cannot_represent_topology()
-> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    store.insert_named_graph(empty_graph())?;
    assert!(store.is_empty()?);

    let mut output = Vec::new();
    store
        .dump_to_writer(RdfFormat::NQuads, &mut output)
        .unwrap_err();
    assert!(output.is_empty());

    let trig = store.dump_to_writer(RdfFormat::TriG, Vec::new())?;
    let dataset = RdfParser::from_format(RdfFormat::TriG)
        .for_slice(&trig)
        .collect_dataset()?;
    assert!(dataset.contains_named_graph(&empty_graph()));
    assert_eq!(
        0,
        dataset
            .quads_for_graph_name(&GraphName::NamedNode(NamedNode::new_unchecked(
                EMPTY_GRAPH_IRI
            )))
            .count()
    );
    Ok(())
}
