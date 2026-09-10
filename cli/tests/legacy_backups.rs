#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI legacy backup package journey"
)]
use anyhow::{Result, ensure};
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{
    BackupOptions, BackupReceipt, LegacyBackupReceipt, Store, TransactionStartControl,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn copy_directory(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let destination = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&entry.path(), &destination)?;
        } else {
            fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

fn fixture(version: u64, destination: &Path) -> Result<()> {
    let name = match version {
        0 => "rocksdb_bc_data",
        1 => "rocksdb_bc_rdf_star_data",
        _ => unreachable!(),
    };
    copy_directory(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../lib/oxigraph/tests")
            .join(name),
        destination,
    )
}

fn inventory(root: &Path) -> Result<BTreeMap<PathBuf, [u8; 32]>> {
    fn visit(root: &Path, directory: &Path, files: &mut BTreeMap<PathBuf, [u8; 32]>) -> Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                visit(root, &path, files)?;
            } else {
                files.insert(
                    path.strip_prefix(root)?.to_owned(),
                    Sha256::digest(fs::read(path)?).into(),
                );
            }
        }
        Ok(())
    }
    let mut files = BTreeMap::new();
    visit(root, root, &mut files)?;
    Ok(files)
}

fn fingerprint(receipt: &LegacyBackupReceipt) -> String {
    receipt
        .fingerprint()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[test]
fn cli_legacy_commands_describe_offline_required_paths() -> Result<()> {
    for (command, flags) in [
        ("backup-legacy", ["--location", "--destination"]),
        ("verify-legacy-backup", ["--location", "--source"]),
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .args([command, "--help"])
            .output()?;
        ensure!(output.status.success());
        let output = String::from_utf8(output.stdout)?;
        for flag in flags {
            ensure!(output.contains(flag), "missing {flag} from {command} help");
        }
        ensure!(output.contains("offline"));
    }
    Ok(())
}

#[test]
fn cli_legacy_backup_preserves_v0_and_v1_and_checks_ancestry() -> Result<()> {
    for version in [0, 1] {
        let directory = assert_fs::TempDir::new()?;
        let source = directory.path().join("source");
        let package = directory.path().join("package");
        let changed = directory.path().join("changed");
        fixture(version, &source)?;
        let source_before = inventory(&source)?;

        let created = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .args(["backup-legacy", "--location"])
            .arg(&source)
            .arg("--destination")
            .arg(&package)
            .output()?;
        ensure!(
            created.status.success(),
            "legacy backup failed: {}",
            String::from_utf8_lossy(&created.stderr)
        );
        let receipt = LegacyBackupReceipt::verify(&package, &TransactionStartControl::new())?;
        let expected_fingerprint = fingerprint(&receipt);
        let created = String::from_utf8(created.stdout)?;
        ensure!(created.contains("legacy_backup_complete=true"));
        ensure!(created.contains(&format!("storage_version={version}")));
        ensure!(created.contains(&format!("files={}", receipt.files().len())));
        ensure!(created.contains(&format!("fingerprint={expected_fingerprint}")));
        ensure!(created.contains("upgrade_authorized=false"));
        ensure!(package.join(LegacyBackupReceipt::manifest_name()).is_file());
        ensure!(source_before == inventory(&source)?);
        ensure!(source_before == inventory(&package.join("store"))?);
        let package_before = inventory(&package)?;

        let verified = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .args(["verify-legacy-backup", "--location"])
            .arg(&package)
            .output()?;
        ensure!(verified.status.success());
        let verified = String::from_utf8(verified.stdout)?;
        ensure!(verified.contains("legacy_backup_verified=true"));
        ensure!(verified.contains(&format!("fingerprint={expected_fingerprint}")));
        ensure!(verified.contains("ancestry=not-checked"));
        ensure!(package_before == inventory(&package)?);

        let exact = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .args(["verify-legacy-backup", "--location"])
            .arg(&package)
            .arg("--source")
            .arg(&source)
            .output()?;
        ensure!(exact.status.success());
        let exact = String::from_utf8(exact.stdout)?;
        ensure!(exact.contains(&format!("fingerprint={expected_fingerprint}")));
        ensure!(exact.contains("ancestry=exact"));
        ensure!(package_before == inventory(&package)?);

        copy_directory(&source, &changed)?;
        fs::write(changed.join("LOG"), b"changed native log bytes")?;
        let mismatch = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .args(["verify-legacy-backup", "--location"])
            .arg(&package)
            .arg("--source")
            .arg(&changed)
            .output()?;
        ensure!(!mismatch.status.success());

        fs::write(package.join("store/IDENTITY"), b"corrupt package")?;
        let corrupt = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .args(["verify-legacy-backup", "--location"])
            .arg(&package)
            .output()?;
        ensure!(!corrupt.status.success());
        ensure!(source_before == inventory(&source)?);
    }
    Ok(())
}

#[test]
fn cli_legacy_and_current_receipts_are_not_interchangeable() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let legacy_source = directory.path().join("legacy-source");
    let legacy_package = directory.path().join("legacy-package");
    fixture(0, &legacy_source)?;
    let legacy = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
        .args(["backup-legacy", "--location"])
        .arg(&legacy_source)
        .arg("--destination")
        .arg(&legacy_package)
        .output()?;
    ensure!(legacy.status.success());
    let current_verify = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
        .args(["verify-backup", "--location"])
        .arg(&legacy_package)
        .output()?;
    ensure!(!current_verify.status.success());

    let current_source = directory.path().join("current-source");
    let current_package = directory.path().join("current-package");
    let store = Store::open(&current_source)?;
    let node = NamedNode::new("urn:legacy-backup-cross-use")?;
    store.insert(Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph))?;
    drop(store);
    Store::open_read_only(&current_source)?
        .backup_with_receipt(&current_package, &BackupOptions::default())?;
    let legacy_verify = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
        .args(["verify-legacy-backup", "--location"])
        .arg(&current_package)
        .output()?;
    ensure!(!legacy_verify.status.success());
    ensure!(BackupReceipt::verify(&current_package, &TransactionStartControl::new()).is_ok());
    Ok(())
}
