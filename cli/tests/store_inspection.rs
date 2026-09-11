#![expect(clippy::panic_in_result_fn)]

use assert_cmd::Command;
use oxigraph::model::{GraphName, NamedNode, Quad};
#[cfg(feature = "rdf-12")]
use oxigraph::model::Triple;
use oxigraph::store::{
    Namespace, NamespacePrefix, Store, TransactionKey, TransactionRequest,
};
#[cfg(feature = "rdf-12")]
use oxigraph::store::WritableDataset;
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

    let state_output = Command::cargo_bin("oxigraph")?
        .args(["inspect-state", "--location"])
        .arg(directory.path())
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let state_report: serde_json::Value = serde_json::from_slice(&state_output)?;
    assert_eq!(state_report["governance_state"], "absent");
    assert_eq!(state_report["lineage_identity"], serde_json::Value::Null);
    assert_eq!(state_report["receipt_sequence"], serde_json::Value::Null);
    assert!(!String::from_utf8(state_output)?.contains("urn:inspection:"));
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
fn feature_inspection_reports_bounded_scopes_without_terms_or_source_changes() -> Result {
    let directory = assert_fs::TempDir::new()?;
    let store = Store::open(directory.path())?;
    let node = NamedNode::new("urn:feature-inspection:secret")?;
    store.insert(Quad::new(
        node.clone(),
        node.clone(),
        node,
        GraphName::DefaultGraph,
    ))?;
    store.flush()?;
    drop(store);
    let before = tree(directory.path())?;

    let output = Command::cargo_bin("oxigraph")?
        .args(["inspect-features", "--location"])
        .arg(directory.path())
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let report: serde_json::Value = serde_json::from_slice(&output)?;
    assert_eq!(
        report["format"],
        "oxigraph.store-feature-inspection.v1"
    );
    assert_eq!(
        report["inspection"],
        "recognized-current-rdf-features"
    );
    assert_eq!(report["version_status"], "current");
    assert_eq!(report["required_features"], serde_json::json!([]));
    assert_eq!(
        report["scopes"]["live_primary_object_indexes"]["status"],
        "inspected"
    );
    assert_eq!(
        report["scopes"]["retained_governed_outbox"]["records"],
        0
    );
    assert_eq!(report["complete_compatibility"], "not-checked");
    assert_eq!(report["derived_state"], "unknown-unexamined");
    assert!(!String::from_utf8(output)?.contains("urn:feature-inspection:secret"));
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn feature_inspection_reports_retained_only_rdf_12_without_exposing_terms() -> Result {
    let directory = assert_fs::TempDir::new()?;
    let store = Store::open(directory.path())?;
    let subject = NamedNode::new("urn:cli-retained:secret-subject")?;
    let predicate = NamedNode::new("urn:cli-retained:predicate")?;
    let object = Triple::new(
        subject.clone(),
        predicate.clone(),
        NamedNode::new("urn:cli-retained:object")?,
    );
    let quad = Quad::new(
        subject,
        predicate,
        object,
        GraphName::DefaultGraph,
    );
    let mut insert = store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([31; 16]),
        )?
        .into_transaction();
    insert.insert(quad.clone())?;
    insert.commit()?;
    let mut remove = store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([32; 16]),
        )?
        .into_transaction();
    remove.remove(&quad)?;
    remove.commit()?;
    assert!(!store.contains(&quad)?);
    drop(store);
    let before = tree(directory.path())?;

    let output = Command::cargo_bin("oxigraph")?
        .args(["inspect-features", "--location"])
        .arg(directory.path())
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let report: serde_json::Value = serde_json::from_slice(&output)?;
    assert_eq!(report["required_features"], serde_json::json!(["rdf-12"]));
    assert_eq!(
        report["scopes"]["live_primary_object_indexes"]["rdf_12_required"],
        false
    );
    assert_eq!(
        report["scopes"]["retained_governed_outbox"]["rdf_12_required"],
        true
    );
    assert_eq!(
        report["history_before_governed_outbox_coverage"],
        "unknown-unexamined"
    );
    assert!(!String::from_utf8(output)?.contains("urn:cli-retained:"));
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}

#[test]
fn state_inspection_reports_guarded_governed_lineage_without_source_changes() -> Result {
    let directory = assert_fs::TempDir::new()?;
    let store = Store::open(directory.path())?;
    let receipt = store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([51; 16]),
        )?
        .into_transaction()
        .commit()?;
    drop(store);
    let before_absent = tree(directory.path())?;
    let absent_output = Command::cargo_bin("oxigraph")?
        .args(["inspect-state", "--location"])
        .arg(directory.path())
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let absent_report: serde_json::Value = serde_json::from_slice(&absent_output)?;
    assert_eq!(absent_report["upgrade_guard"], "absent");
    assert_eq!(
        absent_report["upgrade_guard_interpretation"],
        "marker-not-present"
    );
    assert_eq!(tree(directory.path())?, before_absent);

    std::fs::write(
        directory
            .path()
            .join(".oxigraph-upgrade-incomplete"),
        b"opaque guard fixture",
    )?;
    let expected_identity = receipt
        .store_identity()
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let before = tree(directory.path())?;

    for _ in 0..2 {
        let output = Command::cargo_bin("oxigraph")?
            .args(["inspect-state", "--location"])
            .arg(directory.path())
            .assert()
            .success()
            .get_output()
            .stdout
            .clone();
        let report: serde_json::Value = serde_json::from_slice(&output)?;
        assert_eq!(report["format"], "oxigraph.store-state-inspection.v1");
        assert_eq!(
            report["inspection"],
            "physical-metadata-and-current-governance-state"
        );
        assert_eq!(report["version_status"], "current");
        assert_eq!(report["upgrade_guard"], "present");
        assert_eq!(
            report["upgrade_guard_interpretation"],
            "incomplete-upgrade-marker-present"
        );
        assert_eq!(report["governance_state"], "present");
        assert_eq!(report["lineage_identity"], expected_identity);
        assert_eq!(report["lineage_identity_kind"], "opaque-128-bit-not-uuid");
        assert_eq!(report["receipt_sequence"], receipt.sequence());
        assert_eq!(report["full_logical_consistency"], "not-checked");
        assert_eq!(report["upgrade_readiness"], "not-determined");
        assert_eq!(report["schema_envelope"], "not-inspected");
        assert_eq!(tree(directory.path())?, before);
    }
    Ok(())
}

#[test]
fn state_inspection_failure_does_not_create_a_database() -> Result {
    let directory = assert_fs::TempDir::new()?;
    let missing = directory.path().join("missing");
    Command::cargo_bin("oxigraph")?
        .args(["inspect-state", "--location"])
        .arg(&missing)
        .assert()
        .failure();
    assert!(!missing.exists());
    assert_eq!(std::fs::read_dir(directory.path())?.count(), 0);
    Ok(())
}

#[test]
fn feature_inspection_failure_does_not_create_a_database() -> Result {
    let directory = assert_fs::TempDir::new()?;
    let missing = directory.path().join("missing");
    Command::cargo_bin("oxigraph")?
        .args(["inspect-features", "--location"])
        .arg(&missing)
        .assert()
        .failure();
    assert!(!missing.exists());
    assert_eq!(std::fs::read_dir(directory.path())?.count(), 0);
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

#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little"
))]
fn copy_legacy_fixture(path: &str) -> Result<assert_fs::TempDir> {
    let directory = assert_fs::TempDir::new()?;
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("CLI manifest directory has no workspace parent")?
        .join("lib")
        .join("oxigraph")
        .join("tests")
        .join(path);
    for entry in std::fs::read_dir(fixture)? {
        let entry = entry?;
        std::fs::copy(entry.path(), directory.path().join(entry.file_name()))?;
    }
    Ok(directory)
}

#[test]
#[cfg(all(
    target_os = "linux",
    target_pointer_width = "64",
    target_endian = "little"
))]
fn writable_cli_refuses_legacy_fixtures_without_mutating_them() -> Result {
    for fixture in ["rocksdb_bc_data", "rocksdb_bc_rdf_star_data"] {
        let directory = copy_legacy_fixture(fixture)?;
        let before = tree(directory.path())?;
        let output = Command::cargo_bin("oxigraph")?
            .args(["optimize", "--location"])
            .arg(directory.path())
            .assert()
            .failure()
            .get_output()
            .stderr
            .clone();
        assert!(String::from_utf8(output)?.contains("requires an explicit upgrade"));
        assert_eq!(tree(directory.path())?, before);
    }
    Ok(())
}

#[test]
fn writable_cli_refuses_an_unknown_directory_without_initializing_it() -> Result {
    let directory = assert_fs::TempDir::new()?;
    std::fs::write(directory.path().join("operator-data"), b"keep this file")?;
    let before = tree(directory.path())?;
    let output = Command::cargo_bin("oxigraph")?
        .args(["optimize", "--location"])
        .arg(directory.path())
        .assert()
        .failure()
        .get_output()
        .stderr
        .clone();
    assert!(String::from_utf8(output)?.contains("unknown storage schema"));
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}
