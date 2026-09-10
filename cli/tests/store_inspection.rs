#![expect(clippy::panic_in_result_fn)]

use assert_cmd::Command;
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{Namespace, NamespacePrefix, Store};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

fn tree(path: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    let mut files = BTreeMap::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            for (relative, bytes) in tree(&entry.path())? {
                files.insert(PathBuf::from(entry.file_name()).join(relative), bytes);
            }
        } else {
            assert!(entry.file_type()?.is_file());
            files.insert(entry.file_name().into(), std::fs::read(entry.path())?);
        }
    }
    Ok(files)
}

#[test]
fn inspection_reports_metadata_without_changing_the_offline_store() -> Result {
    let directory = assert_fs::TempDir::new()?;
    let store = Store::open(directory.path())?;
    let subject = NamedNode::new("urn:inspection:subject")?;
    let quad = Quad::new(
        subject.clone(),
        subject.clone(),
        subject,
        GraphName::DefaultGraph,
    );
    let graph = NamedNode::new("urn:inspection:empty")?;
    store.insert(quad.clone())?;
    store.insert_named_graph(graph.clone())?;
    store.set_namespace(Namespace::new(
        NamespacePrefix::new("inspect")?,
        NamedNode::new("urn:inspection:")?,
    ))?;
    store.flush()?;
    drop(store);
    let before = tree(directory.path())?;
    let output = Command::cargo_bin("oxigraph")?
        .args(["inspect", "--location"])
        .arg(directory.path())
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let report: serde_json::Value = serde_json::from_slice(&output)?;
    assert_eq!(report["format"], "oxigraph.store-inspection.v1");
    assert_eq!(report["inspection"], "physical-metadata-only");
    assert_eq!(report["version_status"], "current");
    assert_eq!(report["storage_version"], 2);
    assert_eq!(report["version_marker_bytes"], 8);
    assert_eq!(report["missing_column_families"], serde_json::json!([]));
    assert_eq!(report["unexpected_column_families"], serde_json::json!([]));
    assert_eq!(
        report["column_families"]
            .as_array()
            .ok_or("inventory")?
            .len(),
        12
    );
    assert_eq!(report["logical_validity"], "not-checked");
    assert_eq!(report["rdf_feature_compatibility"], "unknown");
    assert_eq!(report["upgrade_state"], "not-checked");
    assert!(!String::from_utf8(output)?.contains("urn:inspection:"));
    assert_eq!(tree(directory.path())?, before);
    let reopened = Store::open_read_only(directory.path())?;
    assert!(reopened.contains(&quad)?);
    assert!(reopened.contains_named_graph(&graph.into())?);
    assert_eq!(
        reopened
            .namespaces()
            .collect::<std::result::Result<Vec<_>, _>>()?
            .len(),
        1
    );
    Ok(())
}

#[test]
fn inspection_failure_does_not_create_a_database() -> Result {
    let directory = assert_fs::TempDir::new()?;
    let missing = directory.path().join("missing");
    Command::cargo_bin("oxigraph")?
        .args(["inspect", "--location"])
        .arg(&missing)
        .assert()
        .failure();
    assert!(!missing.exists());
    assert_eq!(std::fs::read_dir(directory.path())?.count(), 0);
    Ok(())
}
