#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
use oxigraph::store::{
    PreparedUpgrade, StorageError, Store, UpgradeRecovery, UpgradeRecoveryOptions,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn fixture(version: u64, destination: &Path) -> Result {
    fs::create_dir(destination)?;
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(if version == 0 {
            "rocksdb_bc_data"
        } else {
            "rocksdb_bc_rdf_star_data"
        });
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        fs::copy(entry.path(), destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn inventory(path: &Path) -> Result<BTreeMap<PathBuf, (u64, [u8; 32])>> {
    fs::read_dir(path)?
        .map(|entry| {
            let entry = entry?;
            let bytes = fs::read(entry.path())?;
            Ok((
                entry.file_name().into(),
                (bytes.len() as u64, Sha256::digest(bytes).into()),
            ))
        })
        .collect()
}

fn assert_guarded(path: &Path) {
    assert!(matches!(
        Store::open(path),
        Err(StorageError::UpgradeIncomplete)
    ));
    assert!(matches!(
        Store::open_read_only(path),
        Err(StorageError::UpgradeIncomplete)
    ));
}

#[test]
fn v0_recovery_reaches_a_standard_verified_inactive_output() -> Result {
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("source");
    let backup = dir.path().join("backup");
    let recovery = dir.path().join("recovery");
    fixture(0, &source)?;
    let source_before = inventory(&source)?;
    let options = UpgradeRecoveryOptions::default();
    Store::backup_legacy(&source, &backup, &options.transform.backup)?;
    let backup_before = inventory(&backup.join("store"))?;
    let started = Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
    assert_eq!(started.storage_version(), 0);
    assert!(!started.completed());
    let initial = inventory(&recovery.join("attempts/0000000000000000/store"))?;
    let completed = Store::resume_upgrade_recovery(&source, &backup, &recovery, &options)?;
    assert!(completed.completed());
    assert_eq!(completed.storage_version(), 2);
    assert_eq!(completed.quad_count(), 16);
    assert_eq!(completed.named_graph_count(), 1);
    assert_eq!(completed.namespace_count(), 0);
    let verified = UpgradeRecovery::verify(&source, &backup, &recovery, &options)?;
    assert_eq!(verified, completed);
    assert_eq!(
        Store::resume_upgrade_recovery(&source, &backup, &recovery, &options)?,
        completed
    );
    assert_eq!(inventory(&source)?, source_before);
    assert_eq!(inventory(&backup.join("store"))?, backup_before);
    assert_eq!(
        inventory(&recovery.join("attempts/0000000000000000/store"))?,
        initial
    );
    for entry in fs::read_dir(recovery.join("attempts"))? {
        let entry = entry?;
        let store = entry.path().join("store");
        if store.is_dir() {
            assert_guarded(&store);
        }
        let output = entry.path().join("output/store");
        if output.is_dir() {
            assert_guarded(&output);
        }
    }
    assert!(
        completed
            .transformed()
            .is_some_and(|value| value.directory().ends_with("output"))
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn v1_rdf12_recovery_preserves_independent_logical_topology() -> Result {
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("source");
    let backup = dir.path().join("backup");
    let recovery = dir.path().join("recovery");
    fixture(1, &source)?;
    let options = UpgradeRecoveryOptions::default();
    Store::backup_legacy(&source, &backup, &options.transform.backup)?;
    Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
    let completed = Store::resume_upgrade_recovery(&source, &backup, &recovery, &options)?;
    assert_eq!(completed.quad_count(), 8);
    assert_eq!(completed.named_graph_count(), 1);
    assert_eq!(completed.namespace_count(), 0);
    assert!(completed.completed());
    assert_eq!(
        UpgradeRecovery::verify(&source, &backup, &recovery, &options)?,
        completed
    );
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn v1_default_feature_refuses_before_creating_recovery_state() -> Result {
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("source");
    let backup = dir.path().join("backup");
    let recovery = dir.path().join("recovery");
    fixture(1, &source)?;
    let before = inventory(&source)?;
    let options = UpgradeRecoveryOptions::default();
    Store::backup_legacy(&source, &backup, &options.transform.backup)?;
    assert!(Store::start_upgrade_recovery(&source, &backup, &recovery, &options).is_err());
    assert!(!recovery.exists());
    assert_eq!(inventory(&source)?, before);
    Ok(())
}

#[test]
fn recovery_refuses_checkpoint_tampering_option_changes_and_attempt_exhaustion() -> Result {
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("source");
    let backup = dir.path().join("backup");
    let recovery = dir.path().join("recovery");
    fixture(0, &source)?;
    let options = UpgradeRecoveryOptions::default();
    Store::backup_legacy(&source, &backup, &options.transform.backup)?;
    Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;

    let changed = UpgradeRecoveryOptions {
        max_attempts: NonZeroUsize::new(options.max_attempts.get() - 1).unwrap(),
        ..options.clone()
    };
    assert!(UpgradeRecovery::verify(&source, &backup, &recovery, &changed).is_err());

    let identity = recovery.join("attempts/0000000000000000/store/IDENTITY");
    let original = fs::read(&identity)?;
    fs::write(&identity, b"changed")?;
    assert!(UpgradeRecovery::verify(&source, &backup, &recovery, &options).is_err());
    fs::write(&identity, original)?;

    let limited = UpgradeRecoveryOptions {
        max_attempts: NonZeroUsize::new(2).unwrap(),
        ..UpgradeRecoveryOptions::default()
    };
    let another = dir.path().join("another");
    assert!(Store::start_upgrade_recovery(&source, &backup, &another, &limited).is_err());
    assert_guarded(&recovery.join("attempts/0000000000000000/store"));
    assert_eq!(
        PreparedUpgrade::guard_name(),
        ".oxigraph-upgrade-incomplete"
    );
    Ok(())
}
