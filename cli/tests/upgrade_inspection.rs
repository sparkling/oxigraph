#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI outer-upgrade inspection integration"
)]

use anyhow::{Result, ensure};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

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
    ensure!(!output.status.success());
    ensure!(output.stdout.is_empty());
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
    fn visit(
        root: &Path,
        directory: &Path,
        output: &mut BTreeMap<PathBuf, [u8; 32]>,
    ) -> Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path.strip_prefix(root)?.to_owned();
            if entry.file_type()?.is_dir() {
                output.insert(relative, Sha256::digest(b"directory").into());
                visit(root, &path, output)?;
            } else {
                output.insert(relative, Sha256::digest(fs::read(path)?).into());
            }
        }
        Ok(())
    }

    let mut output = BTreeMap::new();
    visit(root, root, &mut output)?;
    Ok(output)
}

fn supported() -> bool {
    cfg!(all(target_os = "linux", not(feature = "rocksdb-pkg-config")))
}

fn upgrade_command(
    name: &str,
    source: &Path,
    backup: &Path,
    target_flag: &str,
    target: &Path,
) -> Command {
    let mut command = oxigraph();
    command
        .arg(name)
        .arg("--source")
        .arg(source)
        .arg("--backup")
        .arg(backup)
        .arg(target_flag)
        .arg(target);
    command
}

fn inspect_command(source: &Path, backup: &Path, workspace: &Path) -> Command {
    upgrade_command(
        "inspect-upgrade",
        source,
        backup,
        "--location",
        workspace,
    )
}

fn backup(source: &Path, destination: &Path) -> Result<()> {
    successful(
        oxigraph()
            .arg("backup-legacy")
            .arg("--location")
            .arg(source)
            .arg("--destination")
            .arg(destination),
    )?;
    Ok(())
}

fn journey(version: u64) -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(version, &source)?;
    backup(&source, &backup_path)?;

    successful(&mut upgrade_command(
        "start-upgrade",
        &source,
        &backup_path,
        "--destination",
        &workspace,
    ))?;
    let source_before = inventory(&source)?;
    let backup_before = inventory(&backup_path)?;
    let initial_before = inventory(&workspace)?;
    let initial = String::from_utf8(
        successful(&mut inspect_command(&source, &backup_path, &workspace))?.stdout,
    )?;
    ensure!(initial.contains("upgrade_inspected=true stage=initial"));
    ensure!(initial.contains("recovery_state=incomplete"));
    ensure!(initial.contains("receipt_status=absent"));
    ensure!(initial.contains("active=false upgrade_authorized=false"));
    ensure!(inventory(&source)? == source_before);
    ensure!(inventory(&backup_path)? == backup_before);
    ensure!(inventory(&workspace)? == initial_before);

    successful(&mut upgrade_command(
        "resume-upgrade",
        &source,
        &backup_path,
        "--location",
        &workspace,
    ))?;
    let sealed_before = inventory(&workspace)?;
    let sealed = String::from_utf8(
        successful(&mut inspect_command(&source, &backup_path, &workspace))?.stdout,
    )?;
    ensure!(sealed.contains("upgrade_inspected=true stage=sealed"));
    ensure!(sealed.contains("recovery_state=completed"));
    ensure!(sealed.contains("receipt_status=sealed"));
    ensure!(sealed.contains("receipt_fingerprint="));
    ensure!(sealed.contains("active=false upgrade_authorized=false"));
    ensure!(inventory(&source)? == source_before);
    ensure!(inventory(&backup_path)? == backup_before);
    ensure!(inventory(&workspace)? == sealed_before);
    Ok(())
}

#[test]
fn exact_cli_inspects_initial_and_sealed_v0_workspace() -> Result<()> {
    journey(0)
}

#[cfg(feature = "rdf-12")]
#[test]
fn exact_cli_inspects_initial_and_sealed_rdf12_workspace() -> Result<()> {
    journey(1)
}

#[test]
fn cli_refuses_torn_progress_without_changing_inputs() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(0, &source)?;
    backup(&source, &backup_path)?;
    successful(&mut upgrade_command(
        "start-upgrade",
        &source,
        &backup_path,
        "--destination",
        &workspace,
    ))?;
    let progress = workspace.join("oxigraph-upgrade.progress");
    let mut bytes = fs::read(&progress)?;
    bytes.pop();
    fs::write(&progress, bytes)?;
    let source_before = inventory(&source)?;
    let backup_before = inventory(&backup_path)?;
    let workspace_before = inventory(&workspace)?;
    refused(&mut inspect_command(&source, &backup_path, &workspace))?;
    ensure!(inventory(&source)? == source_before);
    ensure!(inventory(&backup_path)? == backup_before);
    ensure!(inventory(&workspace)? == workspace_before);
    Ok(())
}
