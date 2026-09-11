#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "this is a focused native CLI activation test"
)]

use anyhow::{Result, ensure};
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{Store, WritableDataset};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn supported() -> bool {
    cfg!(all(target_os = "linux", not(feature = "rocksdb-pkg-config")))
}

fn oxigraph() -> Command {
    Command::new(env!("CARGO_BIN_EXE_oxigraph"))
}

fn successful(command: &mut Command) -> Result<Output> {
    let output = command.output()?;
    ensure!(
        output.status.success(),
        "command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output)
}

fn refused(command: &mut Command) -> Result<Output> {
    let output = command.output()?;
    ensure!(!output.status.success(), "command unexpectedly succeeded");
    ensure!(
        output.stdout.is_empty(),
        "failed command emitted a success observation"
    );
    Ok(output)
}

fn copy_directory(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn fixture(version: u64, destination: &Path) -> Result<()> {
    copy_directory(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../lib/oxigraph/tests")
            .join(if version == 0 {
                "rocksdb_bc_data"
            } else {
                "rocksdb_bc_rdf_star_data"
            }),
        destination,
    )
}

fn inventory(root: &Path) -> Result<BTreeMap<PathBuf, [u8; 32]>> {
    fn walk(
        root: &Path,
        directory: &Path,
        output: &mut BTreeMap<PathBuf, [u8; 32]>,
    ) -> Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                walk(root, &entry.path(), output)?;
            } else {
                output.insert(
                    entry.path().strip_prefix(root)?.to_owned(),
                    Sha256::digest(fs::read(entry.path())?).into(),
                );
            }
        }
        Ok(())
    }

    let mut output = BTreeMap::new();
    walk(root, root, &mut output)?;
    Ok(output)
}

fn add_limits(command: &mut Command, max_attempts: &str) {
    command.args([
        "--max-files",
        "99999",
        "--max-bytes",
        "1073741824",
        "--timeout-ms",
        "600000",
        "--max-entries",
        "2000000",
        "--max-projection-bytes",
        "536870912",
        "--max-attempts",
        max_attempts,
    ]);
}

fn backup(source: &Path, destination: &Path) -> Result<()> {
    successful(
        oxigraph()
            .args(["backup-legacy", "--location"])
            .arg(source)
            .arg("--destination")
            .arg(destination),
    )?;
    Ok(())
}

fn upgrade(source: &Path, backup: &Path, workspace: &Path) -> Result<String> {
    let mut command = oxigraph();
    command
        .arg("upgrade")
        .arg("--source")
        .arg(source)
        .arg("--backup")
        .arg(backup)
        .arg("--destination")
        .arg(workspace);
    add_limits(&mut command, "16");
    Ok(String::from_utf8(successful(&mut command)?.stdout)?)
}

fn activation_command(
    source: &Path,
    backup: &Path,
    workspace: &Path,
    target: &Path,
) -> Command {
    let mut command = oxigraph();
    command
        .arg("activate-upgrade")
        .arg("--source")
        .arg(source)
        .arg("--backup")
        .arg(backup)
        .arg("--location")
        .arg(workspace)
        .arg("--destination")
        .arg(target);
    command
}

fn activation_journey(version: u64, expected_quads: usize) -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("workspace");
    let target = root.path().join("target");
    fixture(version, &source)?;
    backup(&source, &backup_path)?;
    let before = [inventory(&source)?, inventory(&backup_path)?];
    let sealed = upgrade(&source, &backup_path, &workspace)?;
    let receipt_fingerprint = sealed
        .split_ascii_whitespace()
        .find_map(|field| field.strip_prefix("receipt_fingerprint="))
        .ok_or_else(|| anyhow::anyhow!("sealed output lacks receipt fingerprint"))?;
    let workspace_before = inventory(&workspace)?;

    let mut command = activation_command(&source, &backup_path, &workspace, &target);
    add_limits(&mut command, "16");
    let output = String::from_utf8(successful(&mut command)?.stdout)?;
    ensure!(output.contains("upgrade_activated=true stage=activated"));
    ensure!(output.contains(&format!(
        "upgrade_receipt_fingerprint={receipt_fingerprint}"
    )));
    ensure!(output.contains("active=true"));
    ensure!(!output.contains("upgrade_authorized="));

    let store = Store::open(&target)?;
    ensure!(store.len()? == expected_quads);
    let node = NamedNode::new("urn:cli-activation:writable")?;
    let quad = Quad::new(
        node.clone(),
        node.clone(),
        node,
        GraphName::DefaultGraph,
    );
    let mut transaction = store.start_transaction()?;
    transaction.insert(quad.clone());
    transaction.rollback()?;
    ensure!(!store.contains(&quad)?);
    store.insert(quad.clone())?;
    drop(store);
    ensure!(Store::open(&target)?.contains(&quad)?);

    ensure!(inventory(&source)? == before[0]);
    ensure!(inventory(&backup_path)? == before[1]);
    ensure!(inventory(&workspace)? == workspace_before);
    Ok(())
}

#[test]
fn native_cli_activates_v0_and_rdf12_v1() -> Result<()> {
    activation_journey(0, 16)?;
    #[cfg(feature = "rdf-12")]
    activation_journey(1, 8)?;
    Ok(())
}

#[test]
fn native_cli_existing_target_refusal_preserves_target_and_inputs() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("workspace");
    let target = root.path().join("existing-target");
    fixture(0, &source)?;
    backup(&source, &backup_path)?;
    upgrade(&source, &backup_path, &workspace)?;
    fs::create_dir_all(&target)?;
    fs::write(target.join("sentinel"), b"retain")?;
    let before = [
        inventory(&source)?,
        inventory(&backup_path)?,
        inventory(&workspace)?,
        inventory(&target)?,
    ];

    let mut command = activation_command(&source, &backup_path, &workspace, &target);
    add_limits(&mut command, "16");
    refused(&mut command)?;

    ensure!(inventory(&source)? == before[0]);
    ensure!(inventory(&backup_path)? == before[1]);
    ensure!(inventory(&workspace)? == before[2]);
    ensure!(inventory(&target)? == before[3]);
    ensure!(fs::read(target.join("sentinel"))? == b"retain");
    Ok(())
}

#[test]
fn native_cli_activation_bounds_are_clap_refusals() -> Result<()> {
    for flag in [
        "--max-files",
        "--max-bytes",
        "--timeout-ms",
        "--max-entries",
        "--max-projection-bytes",
        "--max-attempts",
    ] {
        let mut command = activation_command(
            Path::new("source"),
            Path::new("backup"),
            Path::new("workspace"),
            Path::new("target"),
        );
        command
            .arg(flag)
            .arg(if flag == "--max-attempts" { "65" } else { "0" });
        ensure!(refused(&mut command)?.status.code() == Some(2));
    }
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn no_default_cli_activates_v0_and_refuses_v1_construction() -> Result<()> {
    activation_journey(0, 16)?;
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("workspace");
    let activation_target = root.path().join("never-created-target");
    fixture(1, &source)?;
    let source_before = inventory(&source)?;
    backup(&source, &backup_path)?;
    let backup_before = inventory(&backup_path)?;

    let mut command = oxigraph();
    command
        .arg("upgrade")
        .arg("--source")
        .arg(&source)
        .arg("--backup")
        .arg(&backup_path)
        .arg("--destination")
        .arg(&workspace);
    refused(&mut command)?;

    ensure!(!activation_target.exists());
    ensure!(inventory(&source)? == source_before);
    ensure!(inventory(&backup_path)? == backup_before);
    Ok(())
}
