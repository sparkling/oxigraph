#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
#![expect(
    clippy::missing_assert_message,
    reason = "each focused integration-test name and assertion expression states its invariant"
)]
#![expect(
    clippy::panic_in_result_fn,
    reason = "test assertions report invariant failures while Result propagates setup errors"
)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "this file is itself a dedicated Cargo integration-test crate"
)]
use oxigraph::store::{
    BackupError, StorageError, Store, UpgradeOptions, UpgradeReceipt, UpgradeRecoveryOptions,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::process::Command;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn vendored_linux() -> bool {
    cfg!(target_os = "linux") && option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") == Some("vendored")
}

#[expect(
    clippy::filetype_is_file,
    reason = "immutable fixture inputs must be regular files, never symlinks or devices"
)]
fn fixture(version: u64, destination: &Path) -> Result {
    fs::create_dir_all(destination)?;
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(if version == 0 {
            "rocksdb_bc_data"
        } else {
            "rocksdb_bc_rdf_star_data"
        });
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            return Err("fixture entry is not a regular file".into());
        }
        fs::copy(entry.path(), destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn inventory(path: &Path) -> Result<BTreeMap<PathBuf, (u64, [u8; 32])>> {
    fn walk(root: &Path, relative: &Path, out: &mut BTreeMap<PathBuf, (u64, [u8; 32])>) -> Result {
        for entry in fs::read_dir(root.join(relative))? {
            let entry = entry?;
            let child = relative.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                walk(root, &child, out)?;
            } else {
                let bytes = fs::read(entry.path())?;
                out.insert(child, (bytes.len() as u64, Sha256::digest(bytes).into()));
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    walk(path, Path::new(""), &mut out)?;
    Ok(out)
}

fn setup(version: u64) -> Result<(tempfile::TempDir, PathBuf, PathBuf, PathBuf, UpgradeOptions)> {
    let root = tempfile::tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let upgrade = root.path().join("upgrade");
    fixture(version, &source)?;
    let options = UpgradeOptions::default();
    Store::backup_legacy(&source, &backup, &options.recovery.transform.backup)?;
    Ok((root, source, backup, upgrade, options))
}

fn sealed() -> Result<(
    tempfile::TempDir,
    PathBuf,
    PathBuf,
    PathBuf,
    UpgradeOptions,
    UpgradeReceipt,
)> {
    let (root, source, backup, upgrade, options) = setup(0)?;
    let receipt = Store::upgrade(&source, &backup, &upgrade, &options)?;
    Ok((root, source, backup, upgrade, options, receipt))
}

fn final_output_store(upgrade: &Path) -> Result<PathBuf> {
    for entry in fs::read_dir(upgrade.join("recovery/attempts"))? {
        let output = entry?.path().join("output/store");
        if output.is_dir() {
            return Ok(output);
        }
    }
    Err("missing final output".into())
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

fn assert_verify_refusal_unchanged(
    source: &Path,
    backup: &Path,
    upgrade: &Path,
    options: &UpgradeOptions,
) -> Result {
    let before = inventory(upgrade)?;
    UpgradeReceipt::verify(source, backup, upgrade, options).unwrap_err();
    assert_eq!(inventory(upgrade)?, before);
    Ok(())
}

#[test]
fn exact_profile_refuses_unsupported_platform_or_system_rocksdb() -> Result {
    if vendored_linux() {
        return Ok(());
    }
    let (_root, source, backup, upgrade, options) = setup(0)?;
    assert!(matches!(
        Store::start_upgrade(&source, &backup, &upgrade, &options),
        Err(BackupError::UnsupportedPlatform)
    ));
    assert!(!upgrade.exists());
    Ok(())
}

#[test]
fn v0_seals_exact_build_and_preserves_every_input() -> Result {
    if !vendored_linux() {
        return Ok(());
    }
    let (_root, source, backup, upgrade, options) = setup(0)?;
    let source_before = inventory(&source)?;
    let backup_before = inventory(&backup)?;
    let started = Store::start_upgrade(&source, &backup, &upgrade, &options)?;
    assert!(!started.completed());
    let checkpoint_before = inventory(&upgrade.join("recovery/attempts/0000000000000000/store"))?;
    assert!(!upgrade.join(UpgradeReceipt::manifest_name()).exists());

    let receipt = Store::resume_upgrade(&source, &backup, &upgrade, &options)?;
    assert_eq!(receipt.directory(), upgrade.canonicalize()?);
    assert_eq!(receipt.profile(), "linux-static-vendored-rocksdb-v1");
    assert_eq!(receipt.rocksdb_build_kind(), "vendored");
    assert!(!receipt.rocksdb_version().is_empty());
    assert!(!receipt.rocksdb_source_revision().is_empty());
    assert!(receipt.executable_len() > 0);
    assert_ne!(receipt.executable_sha256(), [0; 32]);
    assert_eq!(receipt.quad_count(), 16);
    assert_eq!(receipt.named_graph_count(), 1);
    assert_eq!(receipt.namespace_count(), 0);
    assert!(receipt.output_file_count() > 0);
    assert!(!receipt.active());
    assert!(!receipt.upgrade_authorized());
    assert_eq!(
        receipt.output_metadata_scope(),
        "storage-version,column-families,namespaces;governance,outbox,receipts=absent"
    );
    assert_eq!(
        UpgradeReceipt::verify(&source, &backup, &upgrade, &options)?,
        receipt
    );
    assert_eq!(
        Store::resume_upgrade(&source, &backup, &upgrade, &options)?,
        receipt
    );
    assert_eq!(inventory(&source)?, source_before);
    assert_eq!(inventory(&backup)?, backup_before);
    assert_eq!(
        inventory(&upgrade.join("recovery/attempts/0000000000000000/store"))?,
        checkpoint_before
    );
    for entry in fs::read_dir(upgrade.join("recovery/attempts"))? {
        let entry = entry?;
        for store in [
            entry.path().join("store"),
            entry.path().join("output/store"),
        ] {
            if store.is_dir() {
                assert_guarded(&store);
            }
        }
    }
    Ok(())
}

#[test]
fn v1_is_either_rdf12_sealed_or_refused_without_source_change() -> Result {
    if !vendored_linux() {
        return Ok(());
    }
    let (_root, source, backup, upgrade, options) = setup(1)?;
    let source_before = inventory(&source)?;
    let backup_before = inventory(&backup)?;
    let result = Store::start_upgrade(&source, &backup, &upgrade, &options);
    #[cfg(feature = "rdf-12")]
    {
        result?;
        let receipt = Store::resume_upgrade(&source, &backup, &upgrade, &options)?;
        assert_eq!(receipt.quad_count(), 8);
        assert_eq!(receipt.named_graph_count(), 1);
        assert_eq!(receipt.namespace_count(), 0);
        assert!(receipt.rdf12());
        assert_eq!(
            UpgradeReceipt::verify(&source, &backup, &upgrade, &options)?,
            receipt
        );
    }
    #[cfg(not(feature = "rdf-12"))]
    {
        result.unwrap_err();
        assert!(upgrade.join(UpgradeReceipt::preflight_name()).is_file());
        assert!(!upgrade.join(UpgradeReceipt::recovery_directory()).exists());
    }
    assert_eq!(inventory(&source)?, source_before);
    assert_eq!(inventory(&backup)?, backup_before);
    Ok(())
}

#[test]
fn changed_ancestry_profile_and_old_standalone_recovery_refuse_without_writes() -> Result {
    if !vendored_linux() {
        return Ok(());
    }
    let (_root, source, backup, upgrade, options, _receipt) = sealed()?;
    let changed = UpgradeOptions {
        recovery: UpgradeRecoveryOptions {
            max_attempts: NonZeroUsize::new(options.recovery.max_attempts.get() - 1)
                .ok_or("invalid test bound")?,
            ..options.recovery.clone()
        },
    };
    assert_verify_refusal_unchanged(&source, &backup, &upgrade, &changed)?;

    let identity = source.join("IDENTITY");
    let original = fs::read(&identity)?;
    fs::write(&identity, b"changed ancestry")?;
    assert_verify_refusal_unchanged(&source, &backup, &upgrade, &options)?;
    fs::write(&identity, original)?;

    let root = tempfile::tempdir()?;
    let old_source = root.path().join("source");
    let old_backup = root.path().join("backup");
    let old_recovery = root.path().join("old-recovery");
    fixture(0, &old_source)?;
    Store::backup_legacy(&old_source, &old_backup, &options.recovery.transform.backup)?;
    Store::start_upgrade_recovery(&old_source, &old_backup, &old_recovery, &options.recovery)?;
    Store::resume_upgrade_recovery(&old_source, &old_backup, &old_recovery, &options.recovery)?;
    let before = inventory(&old_recovery)?;
    UpgradeReceipt::verify(&old_source, &old_backup, &old_recovery, &options).unwrap_err();
    assert_eq!(inventory(&old_recovery)?, before);
    Ok(())
}

#[test]
fn initial_nested_tampering_refuses_resume_without_writing_any_path() -> Result {
    if !vendored_linux() {
        return Ok(());
    }
    for corrupt_checkpoint in [true, false] {
        let (_root, source, backup, upgrade, options) = setup(0)?;
        Store::start_upgrade(&source, &backup, &upgrade, &options)?;
        let recovery = upgrade.join(UpgradeReceipt::recovery_directory());
        if corrupt_checkpoint {
            fs::write(
                recovery.join("attempts/0000000000000000/store/IDENTITY"),
                b"tampered checkpoint identity",
            )?;
        } else {
            fs::write(recovery.join("unexpected"), b"unexpected nested file")?;
        }
        let source_before = inventory(&source)?;
        let backup_before = inventory(&backup)?;
        let upgrade_before = inventory(&upgrade)?;

        Store::resume_upgrade(&source, &backup, &upgrade, &options).unwrap_err();
        assert_eq!(inventory(&source)?, source_before);
        assert_eq!(inventory(&backup)?, backup_before);
        assert_eq!(inventory(&upgrade)?, upgrade_before);
    }
    Ok(())
}

#[test]
fn copied_completed_recovery_cannot_acquire_the_outer_build_identity() -> Result {
    if !vendored_linux() {
        return Ok(());
    }
    let (root, source, backup, upgrade, options) = setup(0)?;
    Store::start_upgrade(&source, &backup, &upgrade, &options)?;
    let initial_journal = fs::read(
        upgrade
            .join(UpgradeReceipt::recovery_directory())
            .join(oxigraph::store::UpgradeRecovery::journal_name()),
    )?;

    let old = root.path().join("standalone");
    Store::start_upgrade_recovery(&source, &backup, &old, &options.recovery)?;
    Store::resume_upgrade_recovery(&source, &backup, &old, &options.recovery)?;
    let old_journal = fs::read(old.join(oxigraph::store::UpgradeRecovery::journal_name()))?;
    assert!(old_journal.starts_with(&initial_journal));
    assert!(old_journal.len() > initial_journal.len());

    fs::remove_dir_all(upgrade.join(UpgradeReceipt::recovery_directory()))?;
    copy_tree(&old, &upgrade.join(UpgradeReceipt::recovery_directory()))?;
    let before = inventory(&upgrade)?;
    Store::resume_upgrade(&source, &backup, &upgrade, &options).unwrap_err();
    assert_eq!(inventory(&upgrade)?, before);
    assert!(!upgrade.join(UpgradeReceipt::manifest_name()).exists());
    Ok(())
}

#[test]
fn altered_outer_chain_journal_output_receipt_and_extra_files_refuse_read_only() -> Result {
    if !vendored_linux() {
        return Ok(());
    }
    let (_root, source, backup, upgrade, options, _receipt) = sealed()?;
    let output = final_output_store(&upgrade)?;
    let cases = [
        upgrade.join(UpgradeReceipt::preflight_name()),
        upgrade.join(UpgradeReceipt::progress_name()),
    ];
    for path in cases {
        let original = fs::read(&path)?;
        let mut changed = original.clone();
        let middle = changed.len() / 2;
        changed[middle] ^= 1;
        fs::write(&path, changed)?;
        assert_verify_refusal_unchanged(&source, &backup, &upgrade, &options)?;
        fs::write(path, original)?;
    }

    let journal = upgrade
        .join(UpgradeReceipt::recovery_directory())
        .join(oxigraph::store::UpgradeRecovery::journal_name());
    let checkpoint_identity = upgrade.join("recovery/attempts/0000000000000000/store/IDENTITY");
    let output_identity = output.join("IDENTITY");
    let receipt_path = upgrade.join(UpgradeReceipt::manifest_name());
    for path in [
        &journal,
        &checkpoint_identity,
        &output_identity,
        &receipt_path,
    ] {
        let original = fs::read(path)?;
        let mut changed = original.clone();
        let middle = changed.len() / 2;
        changed[middle] ^= 1;
        fs::write(path, changed)?;
        assert_verify_refusal_unchanged(&source, &backup, &upgrade, &options)?;
        fs::write(path, original)?;
    }

    let extra = upgrade.join("unexpected");
    fs::write(&extra, b"unexpected")?;
    assert_verify_refusal_unchanged(&source, &backup, &upgrade, &options)?;
    fs::remove_file(extra)?;

    #[cfg(target_family = "unix")]
    {
        std::os::unix::fs::symlink(UpgradeReceipt::manifest_name(), upgrade.join("symlink"))?;
        assert_verify_refusal_unchanged(&source, &backup, &upgrade, &options)?;
        fs::remove_file(upgrade.join("symlink"))?;
    }

    let receipt = fs::read(&receipt_path)?;
    fs::write(&receipt_path, &receipt[..receipt.len() - 1])?;
    assert_verify_refusal_unchanged(&source, &backup, &upgrade, &options)?;
    fs::write(&receipt_path, &receipt)?;

    fs::rename(&receipt_path, upgrade.join("oxigraph-upgrade.pending"))?;
    assert_verify_refusal_unchanged(&source, &backup, &upgrade, &options)?;
    fs::rename(upgrade.join("oxigraph-upgrade.pending"), &receipt_path)?;
    UpgradeReceipt::verify(&source, &backup, &upgrade, &options)?;
    Ok(())
}

#[test]
fn fresh_process_verifies_same_executable_and_rejects_appended_copy() -> Result {
    if !vendored_linux() {
        return Ok(());
    }
    let (root, source, backup, upgrade, _options, _receipt) = sealed()?;
    let executable = std::env::current_exe()?;
    let status = Command::new(&executable)
        .arg("--exact")
        .arg("fresh_process_upgrade_verify_helper")
        .arg("--nocapture")
        .env("OXIGRAPH_UPGRADE_VERIFY_SOURCE", &source)
        .env("OXIGRAPH_UPGRADE_VERIFY_BACKUP", &backup)
        .env("OXIGRAPH_UPGRADE_VERIFY_WORKSPACE", &upgrade)
        .env("OXIGRAPH_UPGRADE_VERIFY_EXPECTED", "ok")
        .status()?;
    assert_eq!(status.code(), Some(73));

    #[cfg(target_os = "linux")]
    {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        let copied = root.path().join("different-build");
        fs::copy(&executable, &copied)?;
        let mut file = fs::OpenOptions::new().append(true).open(&copied)?;
        file.write_all(b"\0different exact executable bytes")?;
        file.sync_all()?;
        let mut permissions = file.metadata()?.permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&copied, permissions)?;
        drop(file);
        let status = Command::new(&copied)
            .arg("--exact")
            .arg("fresh_process_upgrade_verify_helper")
            .arg("--nocapture")
            .env("OXIGRAPH_UPGRADE_VERIFY_SOURCE", &source)
            .env("OXIGRAPH_UPGRADE_VERIFY_BACKUP", &backup)
            .env("OXIGRAPH_UPGRADE_VERIFY_WORKSPACE", &upgrade)
            .env("OXIGRAPH_UPGRADE_VERIFY_EXPECTED", "refused")
            .status()?;
        assert_eq!(status.code(), Some(73));
    }
    Ok(())
}

#[test]
#[expect(
    clippy::exit,
    reason = "the child process communicates independent-verifier success by exit status"
)]
fn fresh_process_upgrade_verify_helper() -> Result {
    let Some(source) = std::env::var_os("OXIGRAPH_UPGRADE_VERIFY_SOURCE") else {
        return Ok(());
    };
    let backup =
        std::env::var_os("OXIGRAPH_UPGRADE_VERIFY_BACKUP").ok_or("missing child backup")?;
    let upgrade =
        std::env::var_os("OXIGRAPH_UPGRADE_VERIFY_WORKSPACE").ok_or("missing child workspace")?;
    let expected = std::env::var("OXIGRAPH_UPGRADE_VERIFY_EXPECTED")?;
    let verified = UpgradeReceipt::verify(source, backup, upgrade, &UpgradeOptions::default());
    if (expected == "ok" && verified.is_ok()) || (expected == "refused" && verified.is_err()) {
        std::process::exit(73);
    }
    std::process::exit(74);
}
