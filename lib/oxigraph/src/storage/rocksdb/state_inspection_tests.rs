use super::*;
use crate::store::{
    GovernanceStateInspectionStatus, Store, TransactionKey, TransactionRequest,
    UpgradeGuardInspectionStatus,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn tree(path: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    fn visit(root: &Path, path: &Path, result: &mut BTreeMap<PathBuf, Vec<u8>>) -> Result {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            let relative = entry_path.strip_prefix(root)?.to_owned();
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                let mut value = b"symlink\0".to_vec();
                value.extend_from_slice(
                    std::fs::read_link(&entry_path)?
                        .to_string_lossy()
                        .as_bytes(),
                );
                result.insert(relative, value);
            } else if file_type.is_dir() {
                result.insert(relative, b"directory\0".to_vec());
                visit(root, &entry_path, result)?;
            } else {
                assert!(file_type.is_file());
                result.insert(relative, std::fs::read(entry_path)?);
            }
        }
        Ok(())
    }

    let mut result = BTreeMap::new();
    visit(path, path, &mut result)?;
    Ok(result)
}

fn commit_governed(store: &Store, key: u8) -> Result<crate::store::CommitReceipt> {
    Ok(store
        .start_governed_transaction(
            TransactionRequest::default(),
            TransactionKey::new([key; 16]),
        )?
        .into_transaction()
        .commit()?)
}

fn replace_governance(path: &Path, bytes: &[u8]) -> Result {
    let db = Db::open_read_write(
        path,
        RocksDbStorage::column_families(),
        DbOptions::default(),
    )?;
    db.insert(&db.column_family(DEFAULT_CF)?, GOVERNANCE_STATE_KEY, bytes)?;
    db.flush()?;
    Ok(())
}

#[test]
fn current_governed_identity_and_sequence_survive_checkpoint_inspection() -> Result {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("source");
    let checkpoint = directory.path().join("checkpoint");
    let store = Store::open(&source)?;
    let receipt = commit_governed(&store, 1)?;
    store.backup(&checkpoint)?;
    drop(store);

    for path in [&source, &checkpoint] {
        let before = tree(path)?;
        for _ in 0..2 {
            let inspection = Store::inspect_state(path)?;
            assert_eq!(
                inspection.governance_status(),
                GovernanceStateInspectionStatus::Present
            );
            assert_eq!(
                inspection.upgrade_guard_status(),
                UpgradeGuardInspectionStatus::Absent
            );
            assert_eq!(
                inspection.lineage_identity(),
                Some(receipt.store_identity())
            );
            assert_eq!(inspection.receipt_sequence(), Some(receipt.sequence()));
            assert_eq!(tree(path)?, before);
        }
    }
    assert!(!checkpoint.join("LOCK").exists());
    Ok(())
}

#[test]
fn current_ungoverned_state_is_explicitly_absent_and_inspection_is_read_only() -> Result {
    let directory = tempfile::tempdir()?;
    drop(Store::open(directory.path())?);
    let before = tree(directory.path())?;
    for _ in 0..2 {
        let inspection = Store::inspect_state(directory.path())?;
        assert_eq!(
            inspection.governance_status(),
            GovernanceStateInspectionStatus::Absent
        );
        assert_eq!(inspection.lineage_identity(), None);
        assert_eq!(inspection.receipt_sequence(), None);
        assert_eq!(tree(directory.path())?, before);
    }
    Ok(())
}

#[test]
fn malformed_current_governance_version_length_and_checksum_are_corruption() -> Result {
    for damage in 0..3 {
        let directory = tempfile::tempdir()?;
        let store = Store::open(directory.path())?;
        commit_governed(&store, 1)?;
        drop(store);
        let db = Db::open_read_write(
            directory.path(),
            RocksDbStorage::column_families(),
            DbOptions::default(),
        )?;
        let default_cf = db.column_family(DEFAULT_CF)?;
        let mut bytes = db
            .get(&default_cf, GOVERNANCE_STATE_KEY)?
            .ok_or("missing governance state")?
            .to_vec();
        match damage {
            0 => bytes[0] = 9,
            1 => {
                bytes.pop();
            }
            2 => *bytes.last_mut().ok_or("empty governance state")? ^= 1,
            _ => unreachable!(),
        }
        db.insert(&default_cf, GOVERNANCE_STATE_KEY, &bytes)?;
        db.flush()?;
        drop(db);
        if damage == 0 {
            std::fs::write(
                directory.path().join(crate::store::upgrade::UPGRADE_GUARD),
                b"guard must not hide corrupt governance",
            )?;
        }
        let before = tree(directory.path())?;
        for _ in 0..2 {
            assert!(matches!(
                Store::inspect_state(directory.path()),
                Err(StorageError::Corruption(_))
            ));
            assert_eq!(tree(directory.path())?, before);
        }
    }
    Ok(())
}

#[test]
fn noncurrent_or_unknown_layout_never_interprets_governance_bytes() -> Result {
    let cases = [
        (0_u64, Some(GRAPHS_CF), false),
        (1_u64, None, false),
        (1_u64, Some(DOSP_CF), false),
        (2_u64, Some(DOSP_CF), false),
        (2_u64, None, true),
    ];
    for (version, omitted, extra) in cases {
        let directory = tempfile::tempdir()?;
        let mut definitions: Vec<_> = RocksDbStorage::column_families()
            .into_iter()
            .filter(|definition| Some(definition.name) != omitted)
            .collect();
        if extra {
            definitions.push(ColumnFamilyDefinition {
                name: "future_cf",
                use_iter: true,
                min_prefix_size: 0,
                unordered_writes: false,
            });
        }
        let db = Db::open_read_write(directory.path(), definitions, DbOptions::default())?;
        let default_cf = db.column_family(DEFAULT_CF)?;
        db.insert(&default_cf, b"oxversion", &version.to_be_bytes())?;
        db.insert(&default_cf, GOVERNANCE_STATE_KEY, b"not-governance")?;
        db.flush()?;
        drop(db);
        let before = tree(directory.path())?;
        let inspection = Store::inspect_state(directory.path())?;
        assert_eq!(
            inspection.governance_status(),
            GovernanceStateInspectionStatus::NotInspected
        );
        assert_eq!(inspection.lineage_identity(), None);
        assert_eq!(inspection.receipt_sequence(), None);
        assert_eq!(tree(directory.path())?, before);
    }

    for marker in [
        None,
        Some(vec![2]),
        Some((LATEST_STORAGE_VERSION + 1).to_be_bytes().to_vec()),
    ] {
        let directory = tempfile::tempdir()?;
        let db = Db::open_read_write(
            directory.path(),
            RocksDbStorage::column_families(),
            DbOptions::default(),
        )?;
        let default_cf = db.column_family(DEFAULT_CF)?;
        if let Some(marker) = marker {
            db.insert(&default_cf, b"oxversion", &marker)?;
        }
        db.insert(&default_cf, GOVERNANCE_STATE_KEY, b"not-governance")?;
        db.flush()?;
        drop(db);
        let before = tree(directory.path())?;
        let inspection = Store::inspect_state(directory.path())?;
        assert_eq!(
            inspection.governance_status(),
            GovernanceStateInspectionStatus::NotInspected
        );
        assert_eq!(inspection.lineage_identity(), None);
        assert_eq!(inspection.receipt_sequence(), None);
        assert_eq!(tree(directory.path())?, before);
    }
    Ok(())
}

#[test]
fn regular_file_and_directory_guards_are_observed_without_blocking_inspection() -> Result {
    for directory_guard in [false, true] {
        let directory = tempfile::tempdir()?;
        drop(Store::open(directory.path())?);
        let guard = directory.path().join(crate::store::upgrade::UPGRADE_GUARD);
        if directory_guard {
            std::fs::create_dir(&guard)?;
        } else {
            std::fs::write(&guard, b"do not read this marker")?;
        }
        let before = tree(directory.path())?;
        let inspection = Store::inspect_state(directory.path())?;
        assert_eq!(
            inspection.upgrade_guard_status(),
            UpgradeGuardInspectionStatus::Present
        );
        assert_eq!(
            inspection.governance_status(),
            GovernanceStateInspectionStatus::Absent
        );
        assert_eq!(tree(directory.path())?, before);
    }
    Ok(())
}

#[cfg(unix)]
#[test]
fn dangling_symlink_guard_is_observed_without_following_it() -> Result {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir()?;
    drop(Store::open(directory.path())?);
    let missing_target = directory.path().join("missing-target");
    symlink(
        &missing_target,
        directory.path().join(crate::store::upgrade::UPGRADE_GUARD),
    )?;
    let before = tree(directory.path())?;
    let inspection = Store::inspect_state(directory.path())?;
    assert_eq!(
        inspection.upgrade_guard_status(),
        UpgradeGuardInspectionStatus::Present
    );
    assert_eq!(
        inspection.governance_status(),
        GovernanceStateInspectionStatus::Absent
    );
    assert!(!missing_target.exists());
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}

#[test]
fn missing_path_and_precancelled_inspection_do_not_create_storage() -> Result {
    let directory = tempfile::tempdir()?;
    let missing = directory.path().join("missing");
    assert!(Store::inspect_state(&missing).is_err());
    assert!(!missing.exists());

    let control = crate::store::TransactionStartControl::new();
    control.cancel();
    assert!(Store::inspect_state_with_control(&missing, &control).is_err());
    assert!(!missing.exists());
    assert_eq!(std::fs::read_dir(directory.path())?.count(), 0);
    Ok(())
}

#[test]
#[ignore = "requires a separately built oxigraph CLI in target/debug"]
fn malformed_governance_cli_failure_preserves_the_source() -> Result {
    use crate::model::{GraphName, NamedNode, Quad};
    use crate::store::WritableDataset;

    const SECRET_IRI: &str = "urn:state-inspection:must-not-leak";
    const PRIVATE_GOVERNANCE_BYTES: &[u8] = b"private-governance-bytes";

    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    let node = NamedNode::new(SECRET_IRI)?;
    store.insert(Quad::new(
        node.clone(),
        node.clone(),
        node,
        GraphName::DefaultGraph,
    ))?;
    commit_governed(&store, 1)?;
    drop(store);
    replace_governance(directory.path(), PRIVATE_GOVERNANCE_BYTES)?;
    let before = tree(directory.path())?;
    let executable = std::env::current_exe()?
        .parent()
        .and_then(Path::parent)
        .ok_or("test executable is not under target/debug/deps")?
        .join("oxigraph");
    let output = std::process::Command::new(executable)
        .args(["inspect-state", "--location"])
        .arg(directory.path())
        .output()?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8(output.stderr)?;
    assert!(stderr.contains("invalid governance state version or length"));
    assert!(!stderr.contains(SECRET_IRI));
    assert!(!stderr.contains("private-governance-bytes"));
    assert_eq!(tree(directory.path())?, before);
    Ok(())
}
