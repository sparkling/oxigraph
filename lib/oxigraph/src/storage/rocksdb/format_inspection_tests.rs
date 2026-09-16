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

/// Physical file damage, not a marker/column-family classification: a
/// corrupted MANIFEST is refused by `inspect`/`open`/`open_read_only`
/// without leaving the source further mutated, for both a legacy and a
/// current declared version. This is RocksDB's own checksum validation,
/// not this crate's version-status logic, so it fires regardless of what
/// the store's `oxversion` marker claims -- confirmed empirically before
/// writing this test (not assumed): a standalone exploration flipped bytes
/// in a fresh store's MANIFEST and observed `StorageError::Corruption` from
/// all three calls for both a legacy (0) and current (2) marker, while a
/// truncated WAL alone left `inspect` unaffected and `open` still correctly
/// refusing the legacy layout with `UpgradeRequired` -- MANIFEST integrity,
/// not WAL integrity, is what preflight actually depends on.
#[test]
fn inspect_and_open_refuse_a_corrupted_manifest_without_source_changes() -> Result {
    for version in [0_u64, 2_u64] {
        let directory = tempfile::tempdir()?;
        let db = Db::open_read_write(
            directory.path(),
            RocksDbStorage::column_families(),
            DbOptions::default(),
        )?;
        let default = db.column_family(DEFAULT_CF)?;
        db.insert(&default, b"corruption-fixture", b"preserve")?;
        db.insert(&default, b"oxversion", &version.to_be_bytes())?;
        db.flush()?;
        drop(default);
        drop(db);

        let manifest = std::fs::read_dir(directory.path())?
            .filter_map(std::result::Result::ok)
            .find(|entry| entry.file_name().to_string_lossy().starts_with("MANIFEST-"))
            .ok_or("no MANIFEST file in a freshly written store")?
            .path();
        // Flip every byte from the midpoint to the end, not just a handful:
        // a short flip could in principle land entirely inside one record's
        // length-prefix bytes, which RocksDB's log reader can interpret as a
        // truncated tail (tolerated, not reported as corruption) rather than
        // a checksum failure. Flipping the whole second half guarantees the
        // corruption overlaps multiple records' checksummed payload bytes
        // regardless of exactly where record boundaries fall.
        let mut bytes = std::fs::read(&manifest)?;
        let middle = bytes.len() / 2;
        for byte in &mut bytes[middle..] {
            *byte ^= 0xFF;
        }
        std::fs::write(&manifest, &bytes)?;

        let before = tree(directory.path())?;
        assert!(
            matches!(
                Store::inspect(directory.path()),
                Err(StorageError::Corruption(_))
            ),
            "inspect should refuse a corrupted MANIFEST: version {version}"
        );
        assert!(
            matches!(
                Store::open(directory.path()),
                Err(StorageError::Corruption(_))
            ),
            "open should refuse a corrupted MANIFEST: version {version}"
        );
        assert!(
            matches!(
                Store::open_read_only(directory.path()),
                Err(StorageError::Corruption(_))
            ),
            "open_read_only should refuse a corrupted MANIFEST: version {version}"
        );
        assert_eq!(
            tree(directory.path())?,
            before,
            "a refused corrupted store must not be further mutated: version {version}"
        );
    }
    Ok(())
}

/// A corrupted WAL, unlike a corrupted MANIFEST (previous test), does not
/// trip RocksDB's open-time validation: `inspect`/`open`/`open_read_only`
/// all still correctly classify a legacy layout and refuse it with
/// `UpgradeRequired`, not some other error, even though genuinely
/// unrecoverable data was lost. RocksDB does replay the WAL on every open,
/// including read-only opens (an earlier version of this doc comment
/// claimed otherwise; independent review caught that as a real factual
/// error, not just imprecise wording); a truncated tail is tolerated
/// rather than reported as `Corruption` because of the default
/// point-in-time recovery mode, not because replay is skipped.
///
/// The `oxversion` marker is flushed to an SST before the WAL is touched,
/// so truncating a WAL segment written *before* that flush proves nothing:
/// an earlier version of this test truncated exactly that segment and
/// passed for the wrong reason (independent review caught this too, and
/// confirmed it empirically: the flushed segment truncated to a non-empty
/// but already-superseded remainder, never exercising real WAL recovery
/// loss). To genuinely exercise WAL damage, this version inserts one more
/// record *after* the flush and drops the database without flushing
/// again, so that record exists only in the WAL; truncating then discards
/// real, otherwise-recoverable data, and the assertions below confirm the
/// legacy-marker refusal still fires correctly despite that loss.
#[test]
fn a_truncated_wal_does_not_mask_legacy_refusal_or_mutate_the_source() -> Result {
    let directory = tempfile::tempdir()?;
    // An exact legacy version-0 layout is missing GRAPHS_CF (added in a
    // later schema iteration): the full current column-family set with a
    // legacy marker is an inconsistent combination that this crate
    // classifies as SchemaUnknown, not UpgradeRequired -- confirmed
    // empirically after an initial version of this test used the full set
    // by mistake and got SchemaUnknown instead, matching this file's own
    // feature_inspection_only_classifies_exact_legacy_inventories_as_upgradeable
    // test, which already establishes the same (0, GRAPHS_CF omitted) shape.
    let definitions = RocksDbStorage::column_families()
        .into_iter()
        .filter(|definition| definition.name != GRAPHS_CF)
        .collect();
    let db = Db::open_read_write(directory.path(), definitions, DbOptions::default())?;
    let default = db.column_family(DEFAULT_CF)?;
    db.insert(&default, b"corruption-fixture", b"preserve")?;
    db.insert(&default, b"oxversion", &0_u64.to_be_bytes())?;
    db.flush()?;
    // Left unflushed on purpose: this key exists only in the WAL written
    // after the flush above, so truncating that WAL genuinely destroys
    // recoverable data rather than an already-superseded segment.
    db.insert(&default, b"unflushed-after-marker", b"wal-only")?;
    drop(default);
    drop(db);

    let mut truncated_any = false;
    for entry in std::fs::read_dir(directory.path())? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().ends_with(".log") {
            let path = entry.path();
            let bytes = std::fs::read(&path)?;
            assert!(
                !bytes.is_empty(),
                "expected a non-empty post-flush WAL segment at {}",
                path.display()
            );
            std::fs::write(&path, &bytes[..bytes.len() / 2])?;
            truncated_any = true;
        }
    }
    assert!(truncated_any, "no WAL file in a freshly written store");

    let before = tree(directory.path())?;
    let info = Store::inspect(directory.path())?;
    assert_eq!(info.version_status(), StoreVersionStatus::Older);
    assert_eq!(info.storage_version(), Some(0));
    assert!(matches!(
        Store::open(directory.path()),
        Err(StorageError::UpgradeRequired {
            found: 0,
            supported: 2
        })
    ));
    assert!(matches!(
        Store::open_read_only(directory.path()),
        Err(StorageError::UpgradeRequired {
            found: 0,
            supported: 2
        })
    ));
    assert_eq!(
        tree(directory.path())?,
        before,
        "a refused legacy store must not be further mutated by a truncated WAL"
    );
    Ok(())
}

/// A corrupted SST, the third physical-file case alongside the MANIFEST and
/// WAL tests above, completing the trio. Confirmed empirically before
/// writing this test (not assumed) that corruption placement matters here in
/// a way it did not for the MANIFEST: flipping arbitrary mid-file bytes in
/// an SST produced no error at all from `inspect`, `open`, `open_read_only`,
/// or even a full scan of every quad -- RocksDB's default block-level
/// checksum verification did not happen to cover the corrupted bytes for
/// that data. Flipping the last 60 bytes instead -- the table footer, which
/// always encodes a fixed magic number and is read and validated by every
/// table open regardless of which column family the caller explicitly
/// requests -- reliably produced `StorageError::Corruption` with a "Bad
/// table magic number" message from all three APIs, including `inspect`,
/// even though `inspect` opens with an empty explicit column-family list.
#[test]
fn inspect_and_open_refuse_a_corrupted_sst_footer_without_source_changes() -> Result {
    for version in [0_u64, 2_u64] {
        let directory = tempfile::tempdir()?;
        let definitions = if version == 0 {
            RocksDbStorage::column_families()
                .into_iter()
                .filter(|definition| definition.name != GRAPHS_CF)
                .collect()
        } else {
            RocksDbStorage::column_families()
        };
        let db = Db::open_read_write(directory.path(), definitions, DbOptions::default())?;
        let default = db.column_family(DEFAULT_CF)?;
        db.insert(&default, b"corruption-fixture", b"preserve")?;
        db.insert(&default, b"oxversion", &version.to_be_bytes())?;
        db.flush()?;
        drop(default);
        drop(db);

        let mut corrupted_any = false;
        for entry in std::fs::read_dir(directory.path())? {
            let entry = entry?;
            if entry.file_name().to_string_lossy().ends_with(".sst") {
                let path = entry.path();
                let mut bytes = std::fs::read(&path)?;
                let start = bytes.len().saturating_sub(60);
                for byte in &mut bytes[start..] {
                    *byte ^= 0xFF;
                }
                std::fs::write(&path, &bytes)?;
                corrupted_any = true;
            }
        }
        assert!(
            corrupted_any,
            "no SST file in a freshly flushed store: version {version}"
        );

        let before = tree(directory.path())?;
        assert!(
            matches!(
                Store::inspect(directory.path()),
                Err(StorageError::Corruption(_))
            ),
            "inspect should refuse a corrupted SST footer: version {version}"
        );
        assert!(
            matches!(
                Store::open(directory.path()),
                Err(StorageError::Corruption(_))
            ),
            "open should refuse a corrupted SST footer: version {version}"
        );
        assert!(
            matches!(
                Store::open_read_only(directory.path()),
                Err(StorageError::Corruption(_))
            ),
            "open_read_only should refuse a corrupted SST footer: version {version}"
        );
        assert_eq!(
            tree(directory.path())?,
            before,
            "a refused corrupted store must not be further mutated: version {version}"
        );
    }
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
#[ignore = "requires a separately built no-default-features oxigraph CLI in \
            target/debug; wired in CI's test_rdf_no_default_features job"]
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
