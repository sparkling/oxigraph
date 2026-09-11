#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI restartable inactive upgrade journeys"
)]

use anyhow::{Result, ensure};
use oxigraph::store::{
    StorageError, Store, UpgradeRecovery, UpgradeRecoveryOptions,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::num::{NonZeroU64, NonZeroUsize};
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

fn failed(command: &mut Command) -> Result<Output> {
    let output = command.output()?;
    ensure!(
        !output.status.success(),
        "command unexpectedly succeeded: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    ensure!(
        output.stdout.is_empty(),
        "failed command emitted success output: {}",
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

#[derive(Debug, Eq, PartialEq)]
struct Inventory {
    directories: BTreeSet<PathBuf>,
    files: BTreeMap<PathBuf, [u8; 32]>,
}

fn inventory(root: &Path) -> Result<Inventory> {
    fn visit(root: &Path, directory: &Path, inventory: &mut Inventory) -> Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path.strip_prefix(root)?.to_owned();
            if entry.file_type()?.is_dir() {
                inventory.directories.insert(relative);
                visit(root, &path, inventory)?;
            } else {
                inventory
                    .files
                    .insert(relative, Sha256::digest(fs::read(path)?).into());
            }
        }
        Ok(())
    }

    let mut inventory = Inventory {
        directories: BTreeSet::new(),
        files: BTreeMap::new(),
    };
    visit(root, root, &mut inventory)?;
    Ok(inventory)
}

fn recovery_command(
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

fn add_nondefault_limits(
    command: &mut Command,
    timeout_ms: u64,
    max_attempts: usize,
) {
    command
        .arg("--max-files")
        .arg(MAX_FILES)
        .arg("--max-bytes")
        .arg(MAX_BYTES)
        .arg("--timeout-ms")
        .arg(timeout_ms.to_string())
        .arg("--max-entries")
        .arg(MAX_ENTRIES)
        .arg("--max-projection-bytes")
        .arg(MAX_PROJECTION_BYTES)
        .arg("--max-attempts")
        .arg(max_attempts.to_string());
}

fn nonzero_usize(value: usize) -> NonZeroUsize {
    NonZeroUsize::new(value).unwrap_or(NonZeroUsize::MIN)
}

fn nonzero_u64(value: u64) -> NonZeroU64 {
    NonZeroU64::new(value).unwrap_or(NonZeroU64::MIN)
}

fn nondefault_options(max_attempts: usize) -> UpgradeRecoveryOptions {
    let mut options = UpgradeRecoveryOptions::default();
    options.transform.backup.max_files = nonzero_usize(99_999);
    options.transform.backup.max_bytes = nonzero_u64(1_073_741_824);
    options.transform.max_entries = nonzero_usize(2_000_000);
    options.transform.max_projection_bytes = nonzero_u64(536_870_912);
    options.max_attempts = nonzero_usize(max_attempts);
    options
}

fn hex(bytes: [u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn output_field<'a>(output: &'a str, name: &str) -> Option<&'a str> {
    output.split_ascii_whitespace().find_map(|field| {
        let (field_name, value) = field.split_once('=')?;
        (field_name == name).then_some(value)
    })
}

fn assert_field(output: &str, name: &str, expected: &str) -> Result<()> {
    ensure!(
        output_field(output, name) == Some(expected),
        "{name} mismatch in output: {output:?}"
    );
    Ok(())
}

fn assert_observation(
    output: &str,
    outcome: &str,
    value: &UpgradeRecovery,
) -> Result<()> {
    ensure!(
        output.lines().count() == 1,
        "expected one recovery observation: {output:?}"
    );
    assert_field(output, outcome, "true")?;
    assert_field(output, "stage", "recovery")?;
    assert_field(
        output,
        "recovery_state",
        if value.completed() {
            "completed"
        } else {
            "incomplete"
        },
    )?;
    assert_field(
        output,
        "storage_version",
        &value.storage_version().to_string(),
    )?;
    assert_field(output, "attempts", &value.attempt_count().to_string())?;
    assert_field(
        output,
        "legacy_backup_fingerprint",
        &hex(value.legacy_backup().fingerprint()),
    )?;
    let transformed_fingerprint = value
        .transformed()
        .map(|transformed| hex(transformed.fingerprint()))
        .unwrap_or_else(|| "not-published".to_owned());
    assert_field(
        output,
        "transformed_fingerprint",
        &transformed_fingerprint,
    )?;
    assert_field(
        output,
        "logical_fingerprint",
        &hex(value.logical_fingerprint()),
    )?;
    assert_field(output, "quads", &value.quad_count().to_string())?;
    assert_field(
        output,
        "named_graphs",
        &value.named_graph_count().to_string(),
    )?;
    assert_field(
        output,
        "namespaces",
        &value.namespace_count().to_string(),
    )?;
    assert_field(output, "external_ancestry", "exact")?;
    assert_field(output, "active", "false")?;
    assert_field(output, "upgrade_authorized", "false")
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

fn backup_legacy(source: &Path, backup: &Path) -> Result<()> {
    successful(
        oxigraph()
            .args(["backup-legacy", "--location"])
            .arg(source)
            .arg("--destination")
            .arg(backup),
    )?;
    Ok(())
}

fn assert_runtime_refusal(
    command: &mut Command,
    source: &Path,
    backup: &Path,
    recovery: &Path,
    source_before: &Inventory,
    backup_before: &Inventory,
) -> Result<()> {
    let recovery_before = inventory(recovery)?;
    failed(command)?;
    ensure!(recovery_before == inventory(recovery)?);
    ensure!(source_before == &inventory(source)?);
    ensure!(backup_before == &inventory(backup)?);
    Ok(())
}

fn full_journey(version: u64, expected_quads: u64, minimum_attempts: usize) -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let backup = directory.path().join("backup");
    let hard_limit_rejected = directory.path().join("hard-limit-rejected");
    let rejected = directory.path().join("rejected");
    let recovery = directory.path().join("recovery");
    fixture(version, &source)?;
    let source_before = inventory(&source)?;
    backup_legacy(&source, &backup)?;
    let backup_before = inventory(&backup)?;

    let mut excessive_files = recovery_command(
        "start-upgrade-recovery",
        &source,
        &backup,
        "--destination",
        &hard_limit_rejected,
    );
    excessive_files.arg("--max-files").arg("100001");
    let hard_limit_output = failed(&mut excessive_files)?;
    ensure!(
        hard_limit_output.status.code() == Some(1),
        "the hard file limit must be a runtime refusal, not a Clap parse error"
    );
    ensure!(!hard_limit_rejected.exists());
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);

    let mut insufficient = recovery_command(
        "start-upgrade-recovery",
        &source,
        &backup,
        "--destination",
        &rejected,
    );
    add_nondefault_limits(&mut insufficient, 600_000, minimum_attempts - 1);
    failed(&mut insufficient)?;
    ensure!(!rejected.exists());
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);

    let mut start = recovery_command(
        "start-upgrade-recovery",
        &source,
        &backup,
        "--destination",
        &recovery,
    );
    add_nondefault_limits(&mut start, 600_000, minimum_attempts);
    let started = String::from_utf8(successful(&mut start)?.stdout)?;

    let options = nondefault_options(minimum_attempts);
    let initial = UpgradeRecovery::verify(&source, &backup, &recovery, &options)?;
    ensure!(!initial.completed());
    ensure!(initial.storage_version() == version);
    ensure!(initial.attempt_count() == 1);
    ensure!(initial.quad_count() == expected_quads);
    assert_observation(&started, "upgrade_recovery_started", &initial)?;
    let initial_inventory = inventory(&recovery)?;
    assert_guarded(
        &recovery
            .join(UpgradeRecovery::attempts_directory())
            .join("0000000000000000")
            .join("store"),
    );

    let mut verify_initial = recovery_command(
        "verify-upgrade-recovery",
        &source,
        &backup,
        "--location",
        &recovery,
    );
    add_nondefault_limits(&mut verify_initial, 700_000, minimum_attempts);
    let verified_initial =
        String::from_utf8(successful(&mut verify_initial)?.stdout)?;
    let initial_after_cli =
        UpgradeRecovery::verify(&source, &backup, &recovery, &options)?;
    ensure!(initial == initial_after_cli);
    assert_observation(
        &verified_initial,
        "upgrade_recovery_verified",
        &initial_after_cli,
    )?;
    ensure!(initial_inventory == inventory(&recovery)?);

    let mut resume = recovery_command(
        "resume-upgrade-recovery",
        &source,
        &backup,
        "--location",
        &recovery,
    );
    add_nondefault_limits(&mut resume, 800_000, minimum_attempts);
    let resumed = String::from_utf8(successful(&mut resume)?.stdout)?;
    let completed =
        UpgradeRecovery::verify(&source, &backup, &recovery, &options)?;
    ensure!(completed.completed());
    ensure!(completed.storage_version() == 2);
    ensure!(completed.attempt_count() == minimum_attempts);
    ensure!(completed.quad_count() == expected_quads);
    assert_observation(&resumed, "upgrade_recovery_resumed", &completed)?;
    let transformed = completed
        .transformed()
        .ok_or_else(|| anyhow::anyhow!("completed recovery has no final output"))?;
    assert_guarded(&transformed.directory().join("store"));
    let completed_inventory = inventory(&recovery)?;

    let mut verify_completed = recovery_command(
        "verify-upgrade-recovery",
        &source,
        &backup,
        "--location",
        &recovery,
    );
    add_nondefault_limits(&mut verify_completed, 900_000, minimum_attempts);
    let verified_completed =
        String::from_utf8(successful(&mut verify_completed)?.stdout)?;
    let completed_after_cli =
        UpgradeRecovery::verify(&source, &backup, &recovery, &options)?;
    ensure!(completed == completed_after_cli);
    assert_observation(
        &verified_completed,
        "upgrade_recovery_verified",
        &completed_after_cli,
    )?;
    ensure!(completed_inventory == inventory(&recovery)?);

    let mut resume_completed = recovery_command(
        "resume-upgrade-recovery",
        &source,
        &backup,
        "--location",
        &recovery,
    );
    add_nondefault_limits(&mut resume_completed, 1_000_000, minimum_attempts);
    let resumed_completed =
        String::from_utf8(successful(&mut resume_completed)?.stdout)?;
    let completed_again =
        UpgradeRecovery::verify(&source, &backup, &recovery, &options)?;
    ensure!(completed == completed_again);
    assert_observation(
        &resumed_completed,
        "upgrade_recovery_resumed",
        &completed_again,
    )?;
    ensure!(completed_inventory == inventory(&recovery)?);
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);
    Ok(())
}

#[test]
fn recovery_cli_journeys_match_api_and_preserve_every_inactive_input() -> Result<()> {
    full_journey(0, 16, 4)?;
    #[cfg(feature = "rdf-12")]
    full_journey(1, 8, 3)?;
    Ok(())
}

#[test]
fn recovery_cli_refuses_profile_journal_and_checkpoint_changes_without_mutation() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let backup = directory.path().join("backup");
    let recovery = directory.path().join("recovery");
    fixture(0, &source)?;
    let source_before = inventory(&source)?;
    backup_legacy(&source, &backup)?;
    let backup_before = inventory(&backup)?;

    successful(&mut recovery_command(
        "start-upgrade-recovery",
        &source,
        &backup,
        "--destination",
        &recovery,
    ))?;
    UpgradeRecovery::verify(
        &source,
        &backup,
        &recovery,
        &UpgradeRecoveryOptions::default(),
    )?;

    for name in ["verify-upgrade-recovery", "resume-upgrade-recovery"] {
        let mut mismatched =
            recovery_command(name, &source, &backup, "--location", &recovery);
        mismatched.arg("--max-attempts").arg("15");
        assert_runtime_refusal(
            &mut mismatched,
            &source,
            &backup,
            &recovery,
            &source_before,
            &backup_before,
        )?;
    }

    let journal_path = recovery.join(UpgradeRecovery::journal_name());
    let journal = fs::read(&journal_path)?;
    let mut truncated = journal.clone();
    ensure!(truncated.pop().is_some());
    fs::write(&journal_path, truncated)?;
    for name in ["verify-upgrade-recovery", "resume-upgrade-recovery"] {
        let mut command =
            recovery_command(name, &source, &backup, "--location", &recovery);
        assert_runtime_refusal(
            &mut command,
            &source,
            &backup,
            &recovery,
            &source_before,
            &backup_before,
        )?;
    }
    fs::write(&journal_path, journal)?;
    UpgradeRecovery::verify(
        &source,
        &backup,
        &recovery,
        &UpgradeRecoveryOptions::default(),
    )?;

    let identity = recovery
        .join(UpgradeRecovery::attempts_directory())
        .join("0000000000000000")
        .join("store")
        .join("IDENTITY");
    let identity_bytes = fs::read(&identity)?;
    fs::write(&identity, b"corrupted checkpoint")?;
    for name in ["verify-upgrade-recovery", "resume-upgrade-recovery"] {
        let mut command =
            recovery_command(name, &source, &backup, "--location", &recovery);
        assert_runtime_refusal(
            &mut command,
            &source,
            &backup,
            &recovery,
            &source_before,
            &backup_before,
        )?;
    }
    fs::write(identity, identity_bytes)?;
    UpgradeRecovery::verify(
        &source,
        &backup,
        &recovery,
        &UpgradeRecoveryOptions::default(),
    )?;
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);
    Ok(())
}

#[test]
fn recovery_cli_numeric_validation_is_clap_exit_two() -> Result<()> {
    let cases = [
        ("start-upgrade-recovery", "--destination"),
        ("resume-upgrade-recovery", "--location"),
        ("verify-upgrade-recovery", "--location"),
    ];
    let bounds = [
        "--max-files",
        "--max-bytes",
        "--timeout-ms",
        "--max-entries",
        "--max-projection-bytes",
        "--max-attempts",
    ];
    let overflow = "340282366920938463463374607431768211456";

    for (name, target_flag) in cases {
        for flag in bounds {
            let invalid_values: &[&str] = if flag == "--max-attempts" {
                &["0", "65", overflow]
            } else {
                &["0", overflow]
            };
            for &invalid in invalid_values {
                let mut command = recovery_command(
                    name,
                    Path::new("nonexistent-source"),
                    Path::new("nonexistent-backup"),
                    target_flag,
                    Path::new("nonexistent-workspace"),
                );
                command.arg(flag).arg(invalid);
                let output = failed(&mut command)?;
                ensure!(
                    output.status.code() == Some(2),
                    "{name} {flag}={invalid} was not rejected by Clap: {:?}",
                    output.status.code()
                );
                ensure!(
                    String::from_utf8_lossy(&output.stderr).contains(flag),
                    "{name} numeric error did not identify {flag}"
                );
            }
        }
    }
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn recovery_cli_refuses_rdf_star_before_creating_destination() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let backup = directory.path().join("backup");
    let recovery = directory.path().join("recovery");
    fixture(1, &source)?;
    let source_before = inventory(&source)?;
    backup_legacy(&source, &backup)?;
    let backup_before = inventory(&backup)?;

    failed(&mut recovery_command(
        "start-upgrade-recovery",
        &source,
        &backup,
        "--destination",
        &recovery,
    ))?;
    ensure!(!recovery.exists());
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);
    Ok(())
}
