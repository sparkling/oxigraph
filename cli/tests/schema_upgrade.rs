#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "this is a focused native CLI schema-upgrade test"
)]

use anyhow::{Result, ensure};
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{BackupOptions, Store, TransactionKey, TransactionRequest, WritableDataset};
use std::fs;
use std::path::Path;
use std::process::{Command, Output};
use tempfile::tempdir;

fn supported() -> bool {
    cfg!(all(
        target_os = "linux",
        not(feature = "rocksdb-pkg-config")
    ))
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

/// Build a minimal offline version-2 store and its completed backup package.
fn fixture(source: &Path, backup: &Path) -> Result<()> {
    let store = Store::open(source)?;
    let node = NamedNode::new_unchecked("urn:schema-upgrade-cli");
    let quad = Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph);
    let mut transaction = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    transaction.insert(quad)?;
    transaction.commit()?;
    store.backup_with_receipt(backup, &BackupOptions::default())?;
    drop(store);
    Ok(())
}

fn schema_command(subcommand: &str, source: &Path, backup: &Path, workspace: &Path) -> Command {
    let mut command = oxigraph();
    command
        .arg(subcommand)
        .arg("--source")
        .arg(source)
        .arg("--backup")
        .arg(backup)
        .arg("--workspace")
        .arg(workspace);
    command
}

fn seal(source: &Path, backup: &Path, workspace: &Path) -> Result<()> {
    successful(
        schema_command("start-schema-upgrade", source, backup, workspace)
            .args(["--rdf-profile", "rdf-11"]),
    )?;
    successful(
        schema_command("resume-schema-upgrade", source, backup, workspace)
            .args(["--rdf-profile", "rdf-11"]),
    )?;
    Ok(())
}

#[test]
fn schema_upgrade_start_then_resume_seals_and_reports_uuid() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(&source, &backup)?;

    successful(
        schema_command("start-schema-upgrade", &source, &backup, &workspace)
            .args(["--rdf-profile", "rdf-11"]),
    )?;
    let resumed = successful(
        schema_command("resume-schema-upgrade", &source, &backup, &workspace)
            .args(["--rdf-profile", "rdf-11"]),
    )?;
    let observation = String::from_utf8(resumed.stdout)?;
    ensure!(
        observation.contains("schema_upgrade_resumed=true"),
        "missing resumed observation: {observation}"
    );
    ensure!(
        observation.contains("schema_uuid="),
        "missing schema uuid: {observation}"
    );
    Ok(())
}

#[test]
fn schema_upgrade_verify_succeeds_on_sealed_workspace() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(&source, &backup)?;
    seal(&source, &backup, &workspace)?;

    let verified = successful(
        schema_command("verify-schema-upgrade", &source, &backup, &workspace)
            .args(["--rdf-profile", "rdf-11"]),
    )?;
    let observation = String::from_utf8(verified.stdout)?;
    ensure!(
        observation.contains("schema_upgrade_verified=true"),
        "missing verified observation: {observation}"
    );
    Ok(())
}

#[test]
fn schema_upgrade_activation_publishes_a_copy_this_binary_correctly_refuses_to_open() -> Result<()>
{
    if !supported() {
        return Ok(());
    }
    let root = tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let workspace = root.path().join("workspace");
    let target = root.path().join("target");
    fixture(&source, &backup)?;
    seal(&source, &backup, &workspace)?;

    let activated = successful(
        schema_command("activate-schema-upgrade", &source, &backup, &workspace)
            .arg("--target")
            .arg(&target)
            .args(["--rdf-profile", "rdf-11"]),
    )?;
    let observation = String::from_utf8(activated.stdout)?;
    ensure!(
        observation.contains("schema_upgrade_activated=true"),
        "missing activated observation: {observation}"
    );
    ensure!(
        observation.contains("current_schema=false"),
        "activation must not claim the published target is the current schema: {observation}"
    );

    // The published target is version 3. This binary's ordinary open path is
    // still version-2-current, so it must refuse with the typed error rather
    // than serve the copy.
    ensure!(
        Store::inspect(&target)?.storage_version() == Some(3),
        "the published target must carry storage version 3"
    );
    ensure!(
        matches!(
            Store::open(&target),
            Err(oxigraph::store::StorageError::SchemaTooNew {
                found: 3,
                supported: 2,
                ..
            })
        ),
        "ordinary open of the published target must refuse with SchemaTooNew"
    );
    Ok(())
}

#[test]
fn schema_upgrade_missing_rdf_profile_is_refused() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(&source, &backup)?;

    refused(&mut schema_command(
        "start-schema-upgrade",
        &source,
        &backup,
        &workspace,
    ))?;
    ensure!(
        !workspace.exists(),
        "a refused invocation must not create a workspace"
    );
    Ok(())
}

#[test]
fn schema_upgrade_activation_rejects_an_existing_target() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let workspace = root.path().join("workspace");
    let target = root.path().join("target");
    fixture(&source, &backup)?;
    seal(&source, &backup, &workspace)?;
    fs::create_dir(&target)?;

    refused(
        schema_command("activate-schema-upgrade", &source, &backup, &workspace)
            .arg("--target")
            .arg(&target)
            .args(["--rdf-profile", "rdf-11"]),
    )?;
    ensure!(
        fs::read_dir(&target)?.next().is_none(),
        "a refused activation must leave the pre-existing target untouched"
    );
    Ok(())
}
