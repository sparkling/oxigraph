#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
use oxigraph::store::{
    LegacyBackupOptions, LegacyBackupReceipt, PreparedUpgrade, StorageError, Store,
    TransactionStartControl, TransformedUpgrade, UpgradeTransformOptions,
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
        fs::copy(entry.path(), destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn inventory(path: &Path) -> Result<BTreeMap<PathBuf, [u8; 32]>> {
    fs::read_dir(path)?
        .map(|entry| {
            let entry = entry?;
            Ok((
                entry.file_name().into(),
                Sha256::digest(fs::read(entry.path())?).into(),
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

fn prepared(
    version: u64,
) -> Result<(
    tempfile::TempDir,
    PathBuf,
    PathBuf,
    PathBuf,
    BTreeMap<PathBuf, [u8; 32]>,
)> {
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("source");
    let backup = dir.path().join("backup");
    let output = dir.path().join("prepared");
    fixture(version, &source)?;
    let before = inventory(&source)?;
    Store::backup_legacy(&source, &backup, &LegacyBackupOptions::default())?;
    Store::prepare_upgrade(&source, &backup, &output, &LegacyBackupOptions::default())?;
    Ok((dir, source, backup, output, before))
}

#[test]
fn upgrade_v0_transforms_and_preserves_all_inputs() -> Result {
    let (_dir, source, backup, output, before) = prepared(0)?;
    let transformed = Store::transform_prepared_upgrade(
        &source,
        &backup,
        &output,
        &UpgradeTransformOptions::default(),
    )?;
    assert_eq!(transformed.directory(), output.canonicalize()?);
    assert_eq!(transformed.quad_count(), 16);
    assert_eq!(transformed.named_graph_count(), 1);
    assert_eq!(transformed.namespace_count(), 0);
    assert!(!transformed.files().is_empty());
    assert_eq!(
        TransformedUpgrade::verify(
            &source,
            &backup,
            &output,
            &UpgradeTransformOptions::default()
        )?,
        transformed
    );
    assert_eq!(inventory(&source)?, before);
    assert_eq!(inventory(&backup.join("store"))?, before);
    assert_guarded(&output.join(PreparedUpgrade::store_directory()));
    assert_eq!(
        Store::inspect(output.join(PreparedUpgrade::store_directory()))?.storage_version(),
        Some(2)
    );
    Ok(())
}

#[test]
fn upgrade_v1_requires_rdf12_or_transforms_without_input_mutation() -> Result {
    let (_dir, source, backup, output, before) = prepared(1)?;
    let options = UpgradeTransformOptions::default();
    #[cfg(not(feature = "rdf-12"))]
    let prepared_before = inventory(&output.join("store"))?;
    let result = Store::transform_prepared_upgrade(&source, &backup, &output, &options);
    #[cfg(feature = "rdf-12")]
    {
        let transformed = result?;
        assert_eq!(transformed.quad_count(), 8);
        assert_eq!(transformed.named_graph_count(), 1);
        assert_eq!(
            TransformedUpgrade::verify(&source, &backup, &output, &options)?,
            transformed
        );
    }
    #[cfg(not(feature = "rdf-12"))]
    {
        assert!(result.is_err());
        assert_eq!(inventory(&output.join("store"))?, prepared_before);
        PreparedUpgrade::verify(&output, &options.backup)?;
    }
    assert_eq!(inventory(&source)?, before);
    assert_eq!(inventory(&backup.join("store"))?, before);
    assert_guarded(&output.join(PreparedUpgrade::store_directory()));
    Ok(())
}

#[test]
fn upgrade_transformation_rejects_bounds_cancellation_and_tampering() -> Result {
    let (_dir, source, backup, output, before) = prepared(0)?;
    let cancelled = UpgradeTransformOptions::default();
    cancelled.backup.control.cancel();
    assert!(Store::transform_prepared_upgrade(&source, &backup, &output, &cancelled).is_err());
    for options in [
        UpgradeTransformOptions {
            max_entries: NonZeroUsize::MIN,
            ..UpgradeTransformOptions::default()
        },
        UpgradeTransformOptions {
            max_projection_bytes: NonZeroU64::MIN,
            ..UpgradeTransformOptions::default()
        },
    ] {
        assert!(Store::transform_prepared_upgrade(&source, &backup, &output, &options).is_err());
    }
    assert_eq!(inventory(&source)?, before);
    assert_eq!(inventory(&backup.join("store"))?, before);
    let transformed = Store::transform_prepared_upgrade(
        &source,
        &backup,
        &output,
        &UpgradeTransformOptions::default(),
    )?;
    for mutation in [
        output.join(TransformedUpgrade::journal_name()),
        output.join(TransformedUpgrade::manifest_name()),
        output.join("store/IDENTITY"),
    ] {
        let before = fs::read(&mutation)?;
        fs::write(&mutation, b"changed")?;
        assert!(
            TransformedUpgrade::verify(
                &source,
                &backup,
                &output,
                &UpgradeTransformOptions::default()
            )
            .is_err()
        );
        fs::write(&mutation, before)?;
    }
    assert!(!transformed.fingerprint().is_empty());
    Ok(())
}

#[test]
fn upgrade_transformed_guard_survives_move_and_legacy_inputs_stay_verifiable() -> Result {
    let (dir, source, backup, output, before) = prepared(0)?;
    Store::transform_prepared_upgrade(
        &source,
        &backup,
        &output,
        &UpgradeTransformOptions::default(),
    )?;
    let store = output.join(PreparedUpgrade::store_directory());
    let moved = dir.path().join("moved");
    fs::rename(&store, &moved)?;
    assert_guarded(&moved);
    assert!(
        TransformedUpgrade::verify(
            &source,
            &backup,
            &output,
            &UpgradeTransformOptions::default()
        )
        .is_err()
    );
    LegacyBackupReceipt::verify_ancestry(&source, &backup, &TransactionStartControl::new())?;
    assert_eq!(inventory(&source)?, before);
    Ok(())
}
