#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI exact-build receipt integration"
)]

use anyhow::{Result, ensure};
use oxigraph::store::{StorageError, Store};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const MAX_FILES: &str = "99999";
const MAX_BYTES: &str = "1073741824";
const MAX_ENTRIES: &str = "2000000";
const MAX_PROJECTION_BYTES: &str = "536870912";

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
    ensure!(
        !output.status.success(),
        "command unexpectedly succeeded: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    ensure!(
        output.stdout.is_empty(),
        "failed command emitted a success observation: {}",
        String::from_utf8_lossy(&output.stdout)
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
    fn visit(root: &Path, directory: &Path, out: &mut BTreeMap<PathBuf, [u8; 32]>) -> Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path.strip_prefix(root)?.to_owned();
            if entry.file_type()?.is_dir() {
                out.insert(relative.clone(), Sha256::digest(b"directory").into());
                visit(root, &path, out)?;
            } else {
                out.insert(relative, Sha256::digest(fs::read(path)?).into());
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    visit(root, root, &mut out)?;
    Ok(out)
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

fn limits(command: &mut Command, attempts: usize) {
    command
        .arg("--max-files")
        .arg(MAX_FILES)
        .arg("--max-bytes")
        .arg(MAX_BYTES)
        .arg("--timeout-ms")
        .arg("600000")
        .arg("--max-entries")
        .arg(MAX_ENTRIES)
        .arg("--max-projection-bytes")
        .arg(MAX_PROJECTION_BYTES)
        .arg("--max-attempts")
        .arg(attempts.to_string());
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

fn assert_sealed(output: &str, observation: &str, workspace: &Path, quads: u64) -> Result<()> {
    ensure!(output.contains(observation));
    ensure!(output.contains("stage=sealed"));
    ensure!(output.contains(&format!("workspace={}", serde_json::to_string(workspace)?)));
    ensure!(output.contains("profile=linux-static-vendored-rocksdb-v1"));
    let executable = fs::read(env!("CARGO_BIN_EXE_oxigraph"))?;
    ensure!(output.contains(&format!("executable_len={}", executable.len())));
    ensure!(output.contains(&format!(
        "executable_sha256={}",
        hex(Sha256::digest(executable).into())
    )));
    ensure!(output.contains("receipt_fingerprint="));
    ensure!(output.contains("rocksdb_build_kind=vendored"));
    ensure!(output.contains(&format!("quads={quads}")));
    ensure!(output.contains("active=false"));
    ensure!(output.contains("upgrade_authorized=false"));
    Ok(())
}

fn output_field<'a>(output: &'a str, name: &str) -> Option<&'a str> {
    output.split_ascii_whitespace().find_map(|field| {
        let (field_name, value) = field.split_once('=')?;
        (field_name == name).then_some(value)
    })
}

fn hex(bytes: [u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(64);
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}

fn assert_guarded(path: &Path) -> Result<()> {
    ensure!(matches!(
        Store::open(path),
        Err(StorageError::UpgradeIncomplete)
    ));
    ensure!(matches!(
        Store::open_read_only(path),
        Err(StorageError::UpgradeIncomplete)
    ));
    Ok(())
}

fn assert_all_attempt_stores_guarded(workspace: &Path) -> Result<()> {
    let mut stores = 0;
    for entry in fs::read_dir(workspace.join("recovery/attempts"))? {
        let attempt = entry?.path();
        for store in [attempt.join("store"), attempt.join("output/store")] {
            if store.is_dir() {
                assert_guarded(&store)?;
                stores += 1;
            }
        }
    }
    ensure!(stores > 0, "upgrade workspace contains no guarded stores");
    Ok(())
}

fn supported() -> bool {
    cfg!(all(target_os = "linux", not(feature = "rocksdb-pkg-config")))
}

fn journey(version: u64, quads: u64) -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("outer workspace");
    fixture(version, &source)?;
    let source_before = inventory(&source)?;
    backup(&source, &backup_path)?;
    let backup_before = inventory(&backup_path)?;

    let mut start = upgrade_command("start-upgrade", &source, &backup_path, "--destination", &workspace);
    limits(&mut start, 16);
    let started = String::from_utf8(successful(&mut start)?.stdout)?;
    ensure!(started.contains("upgrade_started=true stage=incomplete"));
    ensure!(started.contains(&format!("workspace={}", serde_json::to_string(&workspace)?)));
    ensure!(started.contains("active=false upgrade_authorized=false"));
    let workspace_before_resume = inventory(&workspace)?;

    let mut resume = upgrade_command("resume-upgrade", &source, &backup_path, "--location", &workspace);
    limits(&mut resume, 16);
    let resumed = String::from_utf8(successful(&mut resume)?.stdout)?;
    assert_sealed(&resumed, "upgrade_resumed=true", &workspace, quads)?;

    let mut verify = upgrade_command("verify-upgrade", &source, &backup_path, "--location", &workspace);
    limits(&mut verify, 16);
    let verified = String::from_utf8(successful(&mut verify)?.stdout)?;
    assert_sealed(&verified, "upgrade_verified=true", &workspace, quads)?;
    ensure!(
        output_field(&resumed, "receipt_fingerprint")
            == output_field(&verified, "receipt_fingerprint")
    );
    assert_all_attempt_stores_guarded(&workspace)?;
    ensure!(workspace_before_resume != inventory(&workspace)?);
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup_path)?);

    let one_shot = root.path().join("one-shot");
    let mut upgrade = upgrade_command("upgrade", &source, &backup_path, "--destination", &one_shot);
    limits(&mut upgrade, 16);
    let output = String::from_utf8(successful(&mut upgrade)?.stdout)?;
    assert_sealed(&output, "upgrade_complete=true", &one_shot, quads)?;
    assert_all_attempt_stores_guarded(&one_shot)?;
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup_path)?);
    Ok(())
}

#[test]
fn native_cli_seals_v0_and_v1_with_default_rdf12() -> Result<()> {
    journey(0, 16)?;
    #[cfg(feature = "rdf-12")]
    journey(1, 8)?;
    Ok(())
}

#[cfg(target_os = "linux")]
#[test]
fn start_upgrade_reports_canonical_outer_workspace_for_relative_input() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    fixture(0, &source)?;
    backup(&source, &backup_path)?;

    let expected = root.path().join("workspace");
    let mut command =
        upgrade_command("start-upgrade", &source, &backup_path, "--destination", Path::new("workspace"));
    command.current_dir(root.path());
    let output = String::from_utf8(successful(&mut command)?.stdout)?;
    ensure!(output.contains(&format!(
        "workspace={}",
        serde_json::to_string(&expected.canonicalize()?)?
    )));
    Ok(())
}

#[test]
fn sealed_cli_refusals_preserve_source_backup_and_outer_workspace() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(0, &source)?;
    backup(&source, &backup_path)?;
    successful(&mut upgrade_command("upgrade", &source, &backup_path, "--destination", &workspace))?;
    let source_before = inventory(&source)?;
    let backup_before = inventory(&backup_path)?;

    let mut profile = upgrade_command("verify-upgrade", &source, &backup_path, "--location", &workspace);
    limits(&mut profile, 15);
    let workspace_before = inventory(&workspace)?;
    refused(&mut profile)?;
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup_path)?);
    ensure!(workspace_before == inventory(&workspace)?);

    let nested_workspace = workspace.join("recovery");
    let mut nested_path =
        upgrade_command("verify-upgrade", &source, &backup_path, "--location", &nested_workspace);
    refused(&mut nested_path)?;
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup_path)?);
    ensure!(workspace_before == inventory(&workspace)?);

    let identity = source.join("IDENTITY");
    let original = fs::read(&identity)?;
    fs::write(&identity, b"changed ancestry")?;
    let changed_source = inventory(&source)?;
    let mut ancestry = upgrade_command("verify-upgrade", &source, &backup_path, "--location", &workspace);
    refused(&mut ancestry)?;
    ensure!(changed_source == inventory(&source)?);
    ensure!(backup_before == inventory(&backup_path)?);
    ensure!(workspace_before == inventory(&workspace)?);
    fs::write(identity, original)?;

    let initial = root.path().join("initial");
    successful(&mut upgrade_command("start-upgrade", &source, &backup_path, "--destination", &initial))?;
    let nested = initial.join("recovery/attempts/0000000000000000/store/IDENTITY");
    fs::write(nested, b"nested tampering")?;
    let initial_before = inventory(&initial)?;
    let mut nested_resume = upgrade_command("resume-upgrade", &source, &backup_path, "--location", &initial);
    refused(&mut nested_resume)?;
    ensure!(initial_before == inventory(&initial)?);
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup_path)?);
    Ok(())
}

#[test]
fn exact_cli_process_verifies_and_appended_copy_refuses() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(0, &source)?;
    backup(&source, &backup_path)?;
    successful(&mut upgrade_command("upgrade", &source, &backup_path, "--destination", &workspace))?;
    let source_before = inventory(&source)?;
    let backup_before = inventory(&backup_path)?;
    let workspace_before = inventory(&workspace)?;

    successful(&mut upgrade_command("verify-upgrade", &source, &backup_path, "--location", &workspace))?;

    #[cfg(target_os = "linux")]
    {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let copied = root.path().join("appended-executable");
        fs::copy(env!("CARGO_BIN_EXE_oxigraph"), &copied)?;
        let mut file = fs::OpenOptions::new().append(true).open(&copied)?;
        file.write_all(b"\0different exact executable bytes")?;
        file.sync_all()?;
        let mut permissions = file.metadata()?.permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&copied, permissions)?;
        drop(file);
        let mut command = Command::new(copied);
        command
            .arg("verify-upgrade")
            .arg("--source").arg(&source)
            .arg("--backup").arg(&backup_path)
            .arg("--location").arg(&workspace);
        refused(&mut command)?;
    }
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup_path)?);
    ensure!(workspace_before == inventory(&workspace)?);
    Ok(())
}

#[test]
fn upgrade_cli_numeric_bounds_are_clap_refusals() -> Result<()> {
    let cases = [
        ("start-upgrade", "--destination"),
        ("resume-upgrade", "--location"),
        ("upgrade", "--destination"),
        ("verify-upgrade", "--location"),
    ];
    for (name, target) in cases {
        for flag in [
            "--max-files", "--max-bytes", "--timeout-ms", "--max-entries",
            "--max-projection-bytes", "--max-attempts",
        ] {
            let mut command = upgrade_command(
                name, Path::new("source"), Path::new("backup"), target, Path::new("workspace"),
            );
            command.arg(flag).arg(if flag == "--max-attempts" { "65" } else { "0" });
            let output = refused(&mut command)?;
            ensure!(output.status.code() == Some(2));
            ensure!(String::from_utf8_lossy(&output.stderr).contains(flag));
        }
    }
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn no_default_cli_refuses_v1_without_success_observation() -> Result<()> {
    if !supported() {
        return Ok(());
    }
    let root = assert_fs::TempDir::new()?;
    let source = root.path().join("source");
    let backup_path = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(1, &source)?;
    let source_before = inventory(&source)?;
    backup(&source, &backup_path)?;
    let backup_before = inventory(&backup_path)?;
    refused(&mut upgrade_command("start-upgrade", &source, &backup_path, "--destination", &workspace))?;
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup_path)?);
    Ok(())
}
