#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI restore journey"
)]
use anyhow::{Result, ensure};
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{
    BackupOptions, BackupReceipt, RestoreReceipt, Store, TransactionStartControl,
};
use std::process::Command;

#[test]
fn cli_restore_and_scoped_drill_produce_writable_independent_stores() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = Store::open(directory.path().join("source"))?;
    let node = NamedNode::new("urn:restore")?;
    source.insert(Quad::new(
        node.clone(),
        node.clone(),
        node,
        GraphName::DefaultGraph,
    ))?;
    let package = directory.path().join("backup");
    let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
    for baseline in [false, true] {
        let target = directory
            .path()
            .join(if baseline { "drill" } else { "restore" });
        let mut command = Command::new(env!("CARGO_BIN_EXE_oxigraph"));
        command
            .arg("restore")
            .arg("--backup")
            .arg(&package)
            .arg("--destination")
            .arg(&target);
        if baseline {
            command.args([
                "--max-backup-age-ms",
                "60000",
                "--max-restore-time-ms",
                "60000",
            ]);
        }
        let result = command.output()?;
        ensure!(
            result.status.success(),
            "restore failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let output = String::from_utf8(result.stdout)?;
        ensure!(output.contains("restore_complete=true quads=1"));
        ensure!(output.contains(if baseline {
            "baseline=met"
        } else {
            "baseline=unconfigured"
        }));
        let receipt = RestoreReceipt::read(&target)?;
        ensure!(receipt.baseline().is_some() == baseline);
        let queried = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
            .arg("query")
            .arg("--location")
            .arg(target.join("store"))
            .args(["--query", "ASK { ?s ?p ?o }", "--results-format", "csv"])
            .output()?;
        ensure!(
            queried.status.success(),
            "query failed: {}",
            String::from_utf8_lossy(&queried.stderr)
        );
        ensure!(String::from_utf8(queried.stdout)?.trim() == "true");
        let store = Store::open(target.join("store"))?;
        ensure!(store.len()? == 1);
        store.clear()?;
        ensure!(BackupReceipt::verify(&package, &TransactionStartControl::new())? == backup);
    }
    let target = directory.path().join("failed-drill");
    let result = Command::new(env!("CARGO_BIN_EXE_oxigraph"))
        .arg("restore")
        .arg("--backup")
        .arg(&package)
        .arg("--destination")
        .arg(&target)
        .args(["--max-backup-age-ms", "60000", "--max-restore-time-ms", "0"])
        .output()?;
    ensure!(!result.status.success());
    ensure!(String::from_utf8_lossy(&result.stderr).contains("restore_complete=false"));
    ensure!(!target.join(RestoreReceipt::manifest_name()).exists());
    Ok(())
}
