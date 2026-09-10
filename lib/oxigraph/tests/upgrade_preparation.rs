#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
use oxigraph::store::{
    BackupError, LegacyBackupOptions, LegacyBackupReceipt, PreparedUpgrade, StorageError, Store,
    TransactionStartControl,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::num::{NonZeroU64, NonZeroUsize};
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
        assert!(entry.file_type()?.is_file());
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

fn assert_inactive(path: &Path) {
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
fn both_legacy_versions_prepare_exact_inactive_copies_without_changing_inputs() -> Result {
    for version in [0, 1] {
        let dir = tempfile::tempdir()?;
        let source = dir.path().join("source");
        let package = dir.path().join("backup");
        let output = dir.path().join("prepared");
        fixture(version, &source)?;
        let before = inventory(&source)?;
        let options = LegacyBackupOptions::default();
        let receipt = Store::backup_legacy(&source, &package, &options)?;
        let package_marker = fs::read(package.join(LegacyBackupReceipt::manifest_name()))?;
        let prepared = Store::prepare_upgrade(&source, &package, &output, &options)?;
        assert_eq!(prepared.legacy_backup(), &receipt);
        assert_eq!(prepared.directory(), output.canonicalize()?);
        assert_eq!(PreparedUpgrade::verify(&output, &options)?, prepared);
        assert_eq!(inventory(&source)?, before);
        assert_eq!(inventory(&package.join("store"))?, before);
        assert_eq!(
            fs::read(package.join(LegacyBackupReceipt::manifest_name()))?,
            package_marker
        );
        let store = output.join(PreparedUpgrade::store_directory());
        let mut copy = inventory(&store)?;
        assert!(
            copy.remove(Path::new(PreparedUpgrade::guard_name()))
                .is_some()
        );
        assert_eq!(copy, before);
        assert_inactive(&store);
        assert!(LegacyBackupReceipt::verify(&output, &TransactionStartControl::new()).is_err());
        let moved = dir.path().join("moved-store");
        fs::rename(&store, &moved)?;
        assert_inactive(&moved);
        assert!(PreparedUpgrade::verify(&output, &options).is_err());
        assert_eq!(inventory(&source)?, before);
    }
    Ok(())
}

#[test]
fn preparation_verifier_rejects_changed_missing_extra_and_linked_components() -> Result {
    for mutation in 0..12 {
        let dir = tempfile::tempdir()?;
        let source = dir.path().join("source");
        let package = dir.path().join("backup");
        let output = dir.path().join("prepared");
        fixture(0, &source)?;
        let options = LegacyBackupOptions::default();
        Store::backup_legacy(&source, &package, &options)?;
        Store::prepare_upgrade(&source, &package, &output, &options)?;
        let store = output.join("store");
        match mutation {
            0 => fs::write(store.join("IDENTITY"), b"changed")?,
            1 => fs::remove_file(store.join("IDENTITY"))?,
            2 => fs::write(store.join("000099.log"), b"extra")?,
            3 => fs::remove_file(store.join(PreparedUpgrade::guard_name()))?,
            4 => fs::write(store.join(PreparedUpgrade::guard_name()), b"changed")?,
            5 => fs::write(output.join(PreparedUpgrade::journal_name()), b"changed")?,
            6 => fs::remove_file(output.join(PreparedUpgrade::journal_name()))?,
            7 => fs::write(output.join(PreparedUpgrade::manifest_name()), b"changed")?,
            8 => fs::remove_file(output.join(PreparedUpgrade::manifest_name()))?,
            9 => fs::write(output.join("unexpected"), b"extra")?,
            10 => {
                fs::remove_file(store.join("IDENTITY"))?;
                std::os::unix::fs::symlink(source.join("IDENTITY"), store.join("IDENTITY"))?;
            }
            _ => {
                let moved = dir.path().join("outside");
                fs::rename(&store, &moved)?;
                std::os::unix::fs::symlink(&moved, &store)?;
            }
        }
        assert!(
            PreparedUpgrade::verify(&output, &options).is_err(),
            "case {mutation}"
        );
        LegacyBackupReceipt::verify_ancestry(&source, &package, &TransactionStartControl::new())?;
    }
    Ok(())
}

#[test]
fn guard_refuses_current_layout_and_all_guard_types_without_creating_a_lock() -> Result {
    for kind in 0..4 {
        let dir = tempfile::tempdir()?;
        let store = dir.path().join("store");
        drop(Store::open(&store)?);
        fs::remove_file(store.join("LOCK"))?;
        let guard = store.join(PreparedUpgrade::guard_name());
        match kind {
            0 => fs::write(&guard, b"")?,
            1 => fs::write(&guard, b"invalid")?,
            2 => fs::create_dir(&guard)?,
            _ => std::os::unix::fs::symlink("missing-target", &guard)?,
        }
        assert_inactive(&store);
        assert!(!store.join("LOCK").exists());
    }
    assert_eq!(
        std::io::Error::from(StorageError::UpgradeIncomplete).kind(),
        std::io::ErrorKind::InvalidData
    );
    Ok(())
}

#[test]
fn preparation_rejects_overlap_reuse_limits_and_cancelled_controls() -> Result {
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("source");
    let package = dir.path().join("backup");
    let output = dir.path().join("prepared");
    fixture(0, &source)?;
    let options = LegacyBackupOptions::default();
    let receipt = Store::backup_legacy(&source, &package, &options)?;
    Store::prepare_upgrade(&source, &package, &output, &options)?;
    for bad in [
        &source,
        &package,
        &output,
        &source.join("nested"),
        &package.join("nested"),
    ] {
        assert!(Store::prepare_upgrade(&source, &package, bad, &options).is_err());
    }
    let alias = dir.path().join("linked-parent");
    std::os::unix::fs::symlink(dir.path(), &alias)?;
    assert!(Store::prepare_upgrade(&source, &package, alias.join("bad"), &options).is_err());
    let total: u64 = receipt.files().iter().map(|file| file.size()).sum();
    for limited in [
        LegacyBackupOptions {
            max_files: NonZeroUsize::MIN,
            ..options.clone()
        },
        LegacyBackupOptions {
            max_bytes: NonZeroU64::new(total - 1).unwrap(),
            ..options.clone()
        },
    ] {
        assert!(matches!(
            PreparedUpgrade::verify(&output, &limited),
            Err(BackupError::Limit)
        ));
        assert!(
            Store::prepare_upgrade(&source, &package, dir.path().join("limited"), &limited)
                .is_err()
        );
    }
    let cancelled = LegacyBackupOptions::default();
    cancelled.control.cancel();
    assert!(matches!(
        Store::prepare_upgrade(&source, &package, dir.path().join("cancelled"), &cancelled),
        Err(BackupError::Cancelled)
    ));
    LegacyBackupReceipt::verify_ancestry(&source, &package, &TransactionStartControl::new())?;
    Ok(())
}
