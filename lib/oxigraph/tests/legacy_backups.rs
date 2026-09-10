#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
use oxigraph::store::{
    BackupError, BackupReceipt, LegacyBackupOptions, LegacyBackupReceipt, Store,
    TransactionStartControl,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::num::NonZeroU64;
use std::path::{Path, PathBuf};

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn copy_directory(source: &Path, destination: &Path) -> Result {
    fs::create_dir(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        assert!(entry.file_type()?.is_file());
        fs::copy(entry.path(), destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn fixture(version: u64, destination: &Path) -> Result {
    copy_directory(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join(if version == 0 {
                "rocksdb_bc_data"
            } else {
                "rocksdb_bc_rdf_star_data"
            }),
        destination,
    )
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

#[test]
fn physical_legacy_backups_preserve_both_layouts_and_verify_exact_ancestry() -> Result {
    for version in [0, 1] {
        let directory = tempfile::tempdir()?;
        let source = directory.path().join("source");
        let package = directory.path().join("package");
        fixture(version, &source)?;
        let before = inventory(&source)?;
        let control = TransactionStartControl::new();
        let receipt = Store::backup_legacy(&source, &package, &LegacyBackupOptions::default())?;
        assert_eq!(receipt.storage_version(), version);
        assert!(!receipt.database_id().is_empty());
        assert_eq!(inventory(&source)?, before);
        assert_eq!(inventory(&package.join("store"))?, before);
        assert_eq!(LegacyBackupReceipt::verify(&package, &control)?, receipt);
        assert_eq!(
            LegacyBackupReceipt::verify_ancestry(&source, &package, &control)?,
            receipt
        );
        assert!(BackupReceipt::verify(&package, &control).is_err());
        assert_eq!(inventory(&source)?, before);
        assert_eq!(inventory(&package.join("store"))?, before);
        fs::rename(&source, directory.path().join("source-offline"))?;
        assert_eq!(LegacyBackupReceipt::verify(&package, &control)?, receipt);
    }
    Ok(())
}

#[test]
fn legacy_backup_rejects_changed_missing_extra_and_linked_package_files() -> Result {
    for mutation in 0..5 {
        let directory = tempfile::tempdir()?;
        let source = directory.path().join("source");
        let package = directory.path().join("package");
        fixture(0, &source)?;
        Store::backup_legacy(&source, &package, &LegacyBackupOptions::default())?;
        let identity = package.join("store/IDENTITY");
        match mutation {
            0 => fs::write(&identity, b"different physical identity")?,
            1 => fs::remove_file(&identity)?,
            2 => fs::write(package.join("store/000099.log"), b"extra")?,
            3 => {
                fs::remove_file(&identity)?;
                std::os::unix::fs::symlink(source.join("IDENTITY"), &identity)?;
            }
            _ => fs::write(
                package.join(LegacyBackupReceipt::manifest_name()),
                b"incomplete",
            )?,
        }
        assert!(LegacyBackupReceipt::verify(&package, &TransactionStartControl::new()).is_err());
    }
    Ok(())
}

#[test]
fn legacy_backup_ancestry_rejects_another_or_changed_source() -> Result {
    let directory = tempfile::tempdir()?;
    let source = directory.path().join("source");
    let other = directory.path().join("other");
    let package = directory.path().join("package");
    fixture(0, &source)?;
    fixture(1, &other)?;
    Store::backup_legacy(&source, &package, &LegacyBackupOptions::default())?;
    let control = TransactionStartControl::new();
    assert!(LegacyBackupReceipt::verify_ancestry(&other, &package, &control).is_err());
    fs::write(source.join("000099.log"), b"later source")?;
    assert!(LegacyBackupReceipt::verify_ancestry(&source, &package, &control).is_err());
    LegacyBackupReceipt::verify(&package, &control)?;
    Ok(())
}

#[test]
fn legacy_backup_refuses_missing_locks_paths_and_limits_without_source_changes() -> Result {
    for case in 0..6 {
        let directory = tempfile::tempdir()?;
        let source = directory.path().join("source");
        let mut package = directory.path().join("package");
        fixture(0, &source)?;
        let mut options = LegacyBackupOptions::default();
        match case {
            0 => fs::remove_file(source.join("LOCK"))?,
            1 => {
                fs::remove_file(source.join("LOCK"))?;
                std::os::unix::fs::symlink(source.join("IDENTITY"), source.join("LOCK"))?;
            }
            2 => package = source.join("nested-backup"),
            3 => options.control.cancel(),
            4 => options.max_bytes = NonZeroU64::MIN,
            _ => fs::write(source.join("CURRENT"), b"../outside\n")?,
        }
        let before = inventory(&source)?;
        let result = Store::backup_legacy(&source, &package, &options);
        assert!(result.is_err(), "case {case}");
        if case == 3 {
            assert!(matches!(result, Err(BackupError::Cancelled)));
        }
        assert_eq!(inventory(&source)?, before);
        assert!(!package.join(LegacyBackupReceipt::manifest_name()).exists());
    }
    Ok(())
}
