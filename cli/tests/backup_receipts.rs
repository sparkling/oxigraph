#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI backup package journey"
)]
use anyhow::{Result, ensure};
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{BackupReceipt, Store, TransactionStartControl};
use std::process::Command;

#[test]
fn cli_receipt_backup_verifies_and_reports_corruption_without_changing_source() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let backup = directory.path().join("backup");
    let store = Store::open(&source)?;
    let node = NamedNode::new("urn:backup")?;
    store.insert(Quad::new(
        node.clone(),
        node.clone(),
        node,
        GraphName::DefaultGraph,
    ))?;
    drop(store);
    let created = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
        .args(["backup", "--with-receipt", "--location"])
        .arg(&source)
        .arg("--destination")
        .arg(&backup)
        .output()?;
    ensure!(
        created.status.success(),
        "backup failed: {}",
        String::from_utf8_lossy(&created.stderr)
    );
    ensure!(String::from_utf8(created.stdout)?.contains("backup_complete=true"));
    let receipt = BackupReceipt::verify(&backup, &TransactionStartControl::new())?;
    ensure!(receipt.contents().quads() == 1);
    let manifest_before = std::fs::read(backup.join(BackupReceipt::manifest_name()))?;
    for _ in 0..2 {
        let verified = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .args(["verify-backup", "--location"])
            .arg(&backup)
            .output()?;
        ensure!(
            verified.status.success(),
            "verification failed: {}",
            String::from_utf8_lossy(&verified.stderr)
        );
        ensure!(String::from_utf8(verified.stdout)?.contains("backup_verified=true"));
    }
    ensure!(manifest_before == std::fs::read(backup.join(BackupReceipt::manifest_name()))?);
    std::fs::write(backup.join("store/unexpected"), b"modified package")?;
    let invalid = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
        .args(["verify-backup", "--location"])
        .arg(&backup)
        .output()?;
    ensure!(!invalid.status.success());
    ensure!(Store::open_read_only(source)?.len()? == 1);
    Ok(())
}
