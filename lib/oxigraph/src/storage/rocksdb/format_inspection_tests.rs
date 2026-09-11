use super::*;
#[cfg(feature = "rdf-12")]
use crate::model::{GraphName, NamedNode, Quad, Triple};
use crate::store::{Store, StoreVersionStatus};
#[cfg(feature = "rdf-12")]
use crate::store::{TransactionKey, TransactionRequest, WritableDataset};
use std::collections::BTreeMap;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn tree(path: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    fn visit(root: &Path, path: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) -> Result {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                visit(root, &entry.path(), files)?;
            } else {
                assert!(entry.file_type()?.is_file());
                files.insert(
                    entry.path().strip_prefix(root)?.into(),
                    std::fs::read(entry.path())?,
                );
            }
        }
        Ok(())
    }
    let mut files = BTreeMap::new();
    visit(path, path, &mut files)?;
    Ok(files)
}

#[test]
fn inspect_classifies_markers_without_changing_any_source_file() -> Result {
    for (marker, status, value) in [
        (None, StoreVersionStatus::Missing, None),
        (Some(vec![]), StoreVersionStatus::Malformed, None),
        (Some(vec![2]), StoreVersionStatus::Malformed, None),
        (
            Some(0_u64.to_be_bytes().to_vec()),
            StoreVersionStatus::Older,
            Some(0),
        ),
        (
            Some(1_u64.to_be_bytes().to_vec()),
            StoreVersionStatus::Older,
            Some(1),
        ),
        (
            Some(2_u64.to_be_bytes().to_vec()),
            StoreVersionStatus::Current,
            Some(2),
        ),
        (
            Some(u64::MAX.to_be_bytes().to_vec()),
            StoreVersionStatus::Newer,
            Some(u64::MAX),
        ),
    ] {
        let directory = tempfile::tempdir()?;
        // Construct metadata directly: ordinary Store::open would stamp or
        // migrate these cases. Existing metadata bytes must remain untouched.
        let db = Db::open_read_write(
            directory.path(),
            RocksDbStorage::column_families(),
            DbOptions::default(),
        )?;
        let default = db.column_family(DEFAULT_CF)?;
        db.insert(&default, b"inspection-fixture", b"unchanged")?;
        if let Some(marker) = &marker {
            db.insert(&default, b"oxversion", marker)?;
        }
        db.flush()?;
        drop(default);
        drop(db);
        let before = tree(directory.path())?;
        for _ in 0..2 {
            let info = Store::inspect(directory.path())?;
            assert_eq!(info.version_status(), status);
            assert_eq!(info.storage_version(), value);
            assert_eq!(info.version_marker_bytes(), marker.as_ref().map(Vec::len));
            assert_eq!(info.current_storage_version(), 2);
            assert!(info.missing_column_families().is_empty());
            assert!(info.unexpected_column_families().is_empty());
            assert_eq!(info.column_families().len(), 12);
            assert_eq!(
                tree(directory.path())?,
                before,
                "inspection changed source: {status:?}"
            );
            if status == StoreVersionStatus::Current {
                let report = Store::inspect_features(directory.path())?;
                assert!(!report.rdf_12_required());
                assert_eq!(report.retained_outbox_records(), 0);
            } else {
                assert!(Store::inspect_features(directory.path()).is_err());
            }
            assert_eq!(
                tree(directory.path())?,
                before,
                "feature inspection changed source: {status:?}"
            );
        }
    }
    Ok(())
}

#[test]
fn feature_inspection_only_classifies_exact_legacy_inventories_as_upgradeable() -> Result {
    for (version, omitted, expected_upgrade) in [
        (0_u64, Some(GRAPHS_CF), true),
        (0_u64, None, false),
        (1_u64, Some(DOSP_CF), false),
    ] {
        let directory = tempfile::tempdir()?;
        let definitions = RocksDbStorage::column_families()
            .into_iter()
            .filter(|definition| Some(definition.name) != omitted)
            .collect();
        let db = Db::open_read_write(directory.path(), definitions, DbOptions::default())?;
        db.insert(
            &db.column_family(DEFAULT_CF)?,
            b"oxversion",
            &version.to_be_bytes(),
        )?;
        db.flush()?;
        drop(db);
        let before = tree(directory.path())?;
        let error = Store::inspect_features(directory.path())
            .expect_err("legacy content inspection must be refused");
        if expected_upgrade {
            assert!(matches!(
                error,
                StorageError::UpgradeRequired {
                    found: 0,
                    supported: 2
                }
            ));
        } else {
            assert!(matches!(error, StorageError::SchemaUnknown));
        }
        assert_eq!(tree(directory.path())?, before);
    }

    let directory = tempfile::tempdir()?;
    let mut definitions = RocksDbStorage::column_families();
    definitions.push(ColumnFamilyDefinition {
        name: "future_cf",
        use_iter: true,
        min_prefix_size: 0,
        unordered_writes: false,
    });
    let db = Db::open_read_write(directory.path(), definitions, DbOptions::default())?;
    db.insert(
        &db.column_family(DEFAULT_CF)?,
        b"oxversion",
        &1_u64.to_be_bytes(),
    )?;
    db.flush()?;
    drop(db);
    let before = tree(directory.path())?;
    assert!(matches!(
        Store::inspect_features(directory.path()),
        Err(StorageError::SchemaUnknown)
    ));
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}

#[test]
fn inspect_reports_actual_incomplete_and_extra_column_families() -> Result {
    let directory = tempfile::tempdir()?;
    let db = Db::open_read_write(
        directory.path(),
        vec![ColumnFamilyDefinition {
            name: "future_cf",
            use_iter: true,
            min_prefix_size: 0,
            unordered_writes: false,
        }],
        DbOptions::default(),
    )?;
    db.insert(
        &db.column_family(DEFAULT_CF)?,
        b"oxversion",
        &2_u64.to_be_bytes(),
    )?;
    db.flush()?;
    drop(db);
    let before = tree(directory.path())?;
    let info = Store::inspect(directory.path())?;
    assert_eq!(info.column_families(), ["default", "future_cf"]);
    assert_eq!(info.unexpected_column_families(), ["future_cf"]);
    assert_eq!(info.missing_column_families().len(), 11);
    assert_eq!(info.version_status(), StoreVersionStatus::Current);
    assert!(Store::inspect_features(directory.path()).is_err());
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}

#[test]
fn inspect_does_not_create_a_missing_store() -> Result {
    let directory = tempfile::tempdir()?;
    let missing = directory.path().join("missing");
    assert!(Store::inspect(&missing).is_err());
    assert!(Store::inspect_features(&missing).is_err());
    assert!(!missing.exists());
    assert!(Store::inspect(directory.path()).is_err());
    assert_eq!(std::fs::read_dir(directory.path())?.count(), 0);
    Ok(())
}

#[test]
fn repeated_feature_inspection_does_not_create_a_native_lock() -> Result {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("source");
    let checkpoint = directory.path().join("checkpoint");
    let store = Store::open(&source)?;
    store.backup(&checkpoint)?;
    drop(store);
    assert!(!checkpoint.join("LOCK").exists());
    let before = tree(&checkpoint)?;
    for _ in 0..2 {
        let report = Store::inspect_features(&checkpoint)?;
        assert!(!report.rdf_12_required());
        assert_eq!(tree(&checkpoint)?, before);
        assert!(!checkpoint.join("LOCK").exists());
    }
    Ok(())
}

#[test]
fn cancelled_feature_inspection_preserves_the_source() -> Result {
    let directory = tempfile::tempdir()?;
    drop(Store::open(directory.path())?);
    let before = tree(directory.path())?;
    let control = crate::store::TransactionStartControl::new();
    control.cancel();
    assert!(Store::inspect_features_with_control(directory.path(), &control).is_err());
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
#[ignore = "requires a separately built no-default-features oxigraph CLI in target/debug"]
fn rdf_12_writer_retained_history_is_reported_unsupported_by_no_default_cli() -> Result {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("source");
    let checkpoint = directory.path().join("checkpoint");
    let store = Store::open(&source)?;
    let subject = NamedNode::new("urn:cross-feature:secret-subject")?;
    let predicate = NamedNode::new("urn:cross-feature:predicate")?;
    let quad = Quad::new(
        subject.clone(),
        predicate.clone(),
        Triple::new(
            subject,
            predicate,
            NamedNode::new("urn:cross-feature:object")?,
        ),
        GraphName::DefaultGraph,
    );
    let mut insert = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([41; 16]))?
        .into_transaction();
    insert.insert(quad.clone())?;
    insert.commit()?;
    let mut remove = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([42; 16]))?
        .into_transaction();
    remove.remove(&quad)?;
    remove.commit()?;
    assert!(!store.contains(&quad)?);
    store.backup(&checkpoint)?;
    drop(store);
    assert!(!checkpoint.join("LOCK").exists());
    let before = tree(&checkpoint)?;

    let executable = std::env::current_exe()?
        .parent()
        .and_then(Path::parent)
        .ok_or("test executable is not under target/debug/deps")?
        .join("oxigraph");
    let output = std::process::Command::new(executable)
        .args(["inspect-features", "--location"])
        .arg(&checkpoint)
        .output()?;
    assert!(
        output.status.success(),
        "no-default CLI failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(report["binary_supports_rdf_12"], false);
    assert_eq!(report["required_features"], serde_json::json!(["rdf-12"]));
    assert_eq!(
        report["unsupported_features"],
        serde_json::json!(["rdf-12"])
    );
    assert_eq!(
        report["scopes"]["live_primary_object_indexes"]["rdf_12_required"],
        false
    );
    assert_eq!(
        report["scopes"]["retained_governed_outbox"]["rdf_12_required"],
        true
    );
    assert!(!String::from_utf8(output.stdout)?.contains("urn:cross-feature:"));
    assert_eq!(tree(&checkpoint)?, before);
    assert!(!checkpoint.join("LOCK").exists());
    Ok(())
}

#[cfg(unix)]
#[test]
fn inspect_reads_a_nonwritable_offline_directory() -> Result {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir()?;
    drop(Store::open(directory.path())?);
    let before = tree(directory.path())?;
    let mut permissions = Vec::new();
    for entry in std::fs::read_dir(directory.path())? {
        let path = entry?.path();
        let metadata = std::fs::metadata(&path)?;
        permissions.push((path.clone(), metadata.permissions()));
        std::fs::set_permissions(
            path,
            std::fs::Permissions::from_mode(if metadata.is_dir() { 0o555 } else { 0o444 }),
        )?;
    }
    let root_permissions = std::fs::metadata(directory.path())?.permissions();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o555))?;
    let inspected = Store::inspect(directory.path());
    // Restore fixture permissions before any result assertion or cleanup.
    std::fs::set_permissions(directory.path(), root_permissions)?;
    for (path, permission) in permissions {
        std::fs::set_permissions(path, permission)?;
    }
    assert_eq!(inspected?.version_status(), StoreVersionStatus::Current);
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}
