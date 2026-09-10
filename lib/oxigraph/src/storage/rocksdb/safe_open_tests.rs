use super::*;
use crate::store::Store;
use std::collections::BTreeMap;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn files(path: &Path) -> Result<BTreeMap<PathBuf, (usize, [u8; 32])>> {
    use sha2::{Digest, Sha256};
    let mut result = BTreeMap::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        assert!(entry.file_type()?.is_file());
        let bytes = std::fs::read(entry.path())?;
        result.insert(
            entry.file_name().into(),
            (bytes.len(), Sha256::digest(bytes).into()),
        );
    }
    Ok(result)
}

fn fixture(path: &Path, marker: Option<&[u8]>, missing_graphs: bool) -> Result {
    let mut families = RocksDbStorage::column_families();
    if missing_graphs {
        families.retain(|family| family.name != GRAPHS_CF);
    }
    let db = Db::open_read_write(path, families, DbOptions::default())?;
    let default = db.column_family(DEFAULT_CF)?;
    db.insert(&default, b"safe-open-fixture", b"preserve")?;
    if let Some(marker) = marker {
        db.insert(&default, b"oxversion", marker)?;
    }
    db.flush()?;
    Ok(())
}

#[test]
fn safe_open_rejects_unknown_markers_without_source_changes() -> Result {
    for marker in [None, Some(vec![]), Some(vec![2])] {
        let directory = tempfile::tempdir()?;
        fixture(directory.path(), marker.as_deref(), false)?;
        let before = files(directory.path())?;
        for _ in 0..2 {
            assert!(matches!(
                Store::open(directory.path()),
                Err(StorageError::SchemaUnknown)
            ));
            assert!(matches!(
                Store::open_read_only(directory.path()),
                Err(StorageError::SchemaUnknown)
            ));
            assert_eq!(files(directory.path())?, before);
        }
    }
    Ok(())
}

#[test]
fn safe_open_rejects_newer_markers_without_source_changes() -> Result {
    let directory = tempfile::tempdir()?;
    fixture(directory.path(), Some(&u64::MAX.to_be_bytes()), false)?;
    let before = files(directory.path())?;
    for _ in 0..2 {
        assert!(matches!(
            Store::open(directory.path()),
            Err(StorageError::SchemaTooNew {
                found: u64::MAX,
                supported: 2
            })
        ));
        assert!(matches!(
            Store::open_read_only(directory.path()),
            Err(StorageError::SchemaTooNew {
                found: u64::MAX,
                supported: 2
            })
        ));
        assert_eq!(files(directory.path())?, before);
    }
    Ok(())
}

#[test]
fn safe_open_does_not_create_missing_current_column_families() -> Result {
    let directory = tempfile::tempdir()?;
    fixture(directory.path(), Some(&2_u64.to_be_bytes()), true)?;
    let before = files(directory.path())?;
    assert!(matches!(
        Store::open(directory.path()),
        Err(StorageError::SchemaUnknown)
    ));
    assert!(matches!(
        Store::open_read_only(directory.path()),
        Err(StorageError::SchemaUnknown)
    ));
    assert_eq!(files(directory.path())?, before);
    assert_eq!(
        Store::inspect(directory.path())?.missing_column_families(),
        [GRAPHS_CF]
    );
    Ok(())
}

#[test]
fn safe_open_does_not_initialize_an_unrecognized_directory() -> Result {
    let directory = tempfile::tempdir()?;
    std::fs::write(directory.path().join("operator-data"), b"preserve")?;
    let before = files(directory.path())?;
    assert!(matches!(
        Store::open(directory.path()),
        Err(StorageError::SchemaUnknown)
    ));
    assert_eq!(files(directory.path())?, before);
    Ok(())
}

#[test]
fn safe_open_preserves_fresh_write_rollback_and_restart() -> Result {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("store");
    let quad = Quad::new(
        NamedNode::new("urn:subject")?,
        NamedNode::new("urn:predicate")?,
        NamedNode::new("urn:object")?,
        GraphName::DefaultGraph,
    );
    let store = Store::open(&path)?;
    store.insert(quad.clone())?;
    let mut transaction = store.start_transaction()?;
    transaction.clear()?;
    drop(transaction); // Dropping an uncommitted transaction rolls it back.
    assert!(store.contains(&quad)?);
    assert!(Store::open(&path).is_err());
    assert!(
        Db::open_read_write_with_preflight(
            &path,
            RocksDbStorage::column_families(),
            DbOptions::default(),
            |_, _| panic!("preflight must not run while another writer owns the store"),
        )
        .is_err()
    );
    drop(store);
    let reopened = Store::open(&path)?;
    assert!(reopened.contains(&quad)?);
    reopened.validate()?;
    Ok(())
}

#[test]
fn safe_open_preserves_checkpoint_reopen() -> Result {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    source.insert_named_graph(NamedNode::new("urn:empty")?)?;
    let checkpoint = directory.path().join("checkpoint");
    source.backup(&checkpoint)?;
    assert!(!checkpoint.join("LOCK").exists());
    let reopened = Store::open(&checkpoint)?;
    assert!(reopened.contains_named_graph(&NamedNode::new("urn:empty")?.into())?);
    reopened.validate()?;
    Ok(())
}

#[test]
fn safe_open_unknown_checkpoint_adds_only_its_native_lock() -> Result {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("source");
    fixture(&source, Some(&u64::MAX.to_be_bytes()), false)?;
    let db = Db::open_read_only(&source, RocksDbStorage::column_families())?;
    let checkpoint = directory.path().join("checkpoint");
    db.backup(&checkpoint)?;
    let before = files(&checkpoint)?;
    assert!(!checkpoint.join("LOCK").exists());
    assert!(matches!(
        Store::open(&checkpoint),
        Err(StorageError::SchemaTooNew { .. })
    ));
    let mut after = files(&checkpoint)?;
    // An offline checkpoint has no native LOCK. Acquiring it must precede
    // inspection; it is retained even on refusal so concurrent openers cannot
    // lock two different inodes. No other file is created or changed.
    assert_eq!(std::fs::metadata(checkpoint.join("LOCK"))?.len(), 0);
    after.remove(Path::new("LOCK"));
    assert_eq!(after, before);
    Ok(())
}

#[test]
fn safe_open_releases_lease_after_preflight_and_native_open_failures() -> Result {
    let directory = tempfile::tempdir()?;
    drop(Store::open(directory.path())?);
    for native_failure in [false, true] {
        let mut families = RocksDbStorage::column_families();
        if native_failure {
            // A writable RocksDB open must specify every existing family.
            families.retain(|family| family.name != GRAPHS_CF);
        }
        assert!(
            Db::open_read_write_with_preflight(
                directory.path(),
                families,
                DbOptions::default(),
                |_, _| {
                    if native_failure {
                        Ok(())
                    } else {
                        Err(StorageError::SchemaUnknown)
                    }
                },
            )
            .is_err()
        );
        drop(Store::open(directory.path())?);
    }
    Ok(())
}

fn probe_native_writer(path: &Path, blocked: bool) -> Result {
    let status = std::process::Command::new(std::env::current_exe()?)
        .args([
            "--exact",
            "storage::rocksdb::safe_open_tests::safe_open_native_writer_child",
        ])
        .env("OXIGRAPH_SAFE_OPEN_PROBE_PATH", path)
        .env(
            "OXIGRAPH_SAFE_OPEN_PROBE_BLOCKED",
            if blocked { "1" } else { "0" },
        )
        .status()?;
    assert!(status.success(), "independent native writer probe failed");
    Ok(())
}

#[test]
fn safe_open_native_writer_child() -> Result {
    let Some(path) = std::env::var_os("OXIGRAPH_SAFE_OPEN_PROBE_PATH") else {
        return Ok(());
    };
    let blocked = std::env::var("OXIGRAPH_SAFE_OPEN_PROBE_BLOCKED")? == "1";
    // Bypass the new preflight deliberately: this must conflict with an
    // ordinary RocksDB writer, not merely another wrapper-local lease record.
    let result = Db::open_read_write(
        Path::new(&path),
        RocksDbStorage::column_families(),
        DbOptions::default(),
    );
    assert_eq!(result.is_err(), blocked);
    Ok(())
}

#[test]
fn safe_open_holds_native_lease_through_preflight_and_last_handle() -> Result {
    let directory = tempfile::tempdir()?;
    drop(Store::open(directory.path())?);
    let db = Db::open_read_write_with_preflight(
        directory.path(),
        RocksDbStorage::column_families(),
        DbOptions::default(),
        |path, fresh| {
            assert!(!fresh);
            probe_native_writer(path, true).map_err(|error| StorageError::Other(error))?;
            RocksDbStorage::preflight_existing(path, DbOptions::default())
        },
    )?;
    probe_native_writer(directory.path(), true)?;
    let clone = db.clone();
    drop(db);
    probe_native_writer(directory.path(), true)?;
    drop(clone);
    probe_native_writer(directory.path(), false)?;
    Ok(())
}

#[cfg(unix)]
#[test]
fn safe_open_does_not_follow_a_symlink_lock() -> Result {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("store");
    std::fs::create_dir(&path)?;
    let operator_file = directory.path().join("operator-file");
    std::fs::write(&operator_file, b"preserve")?;
    std::os::unix::fs::symlink(&operator_file, path.join("LOCK"))?;
    assert!(matches!(
        Store::open(&path),
        Err(StorageError::SchemaUnknown)
    ));
    assert_eq!(std::fs::read(operator_file)?, b"preserve");
    assert_eq!(std::fs::read_dir(path)?.count(), 1);
    Ok(())
}

#[cfg(unix)]
#[test]
fn safe_open_keeps_explicit_fd_options_during_preflight() -> Result {
    let status = std::process::Command::new("sh")
        .args([
            "-c",
            "ulimit -n 80 && exec \"$@\"",
            "oxigraph-preflight-fd-probe",
        ])
        .arg(std::env::current_exe()?)
        .args([
            "--exact",
            "storage::rocksdb::safe_open_tests::safe_open_fd_options_child",
        ])
        .env("OXIGRAPH_SAFE_OPEN_FD_PROBE", "1")
        .status()?;
    assert!(
        status.success(),
        "explicit-options reopen failed under a low descriptor limit"
    );
    Ok(())
}

#[cfg(unix)]
#[test]
fn safe_open_fd_options_child() -> Result {
    if std::env::var_os("OXIGRAPH_SAFE_OPEN_FD_PROBE").is_none() {
        return Ok(());
    }
    let directory = tempfile::tempdir()?;
    let options = crate::store::StoreOptions::default().with_max_open_files(16);
    let store = Store::open_with_options(directory.path(), options.clone())?;
    store.insert_named_graph(NamedNode::new("urn:empty")?)?;
    drop(store);
    let reopened = Store::open_with_options(directory.path(), options)?;
    assert!(reopened.contains_named_graph(&NamedNode::new("urn:empty")?.into())?);
    Ok(())
}
