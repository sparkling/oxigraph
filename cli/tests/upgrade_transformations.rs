#![cfg(unix)]
#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI inactive upgrade journeys"
)]

use anyhow::{Result, ensure};
use oxigraph::store::{
    LegacyBackupOptions, PreparedUpgrade, StorageError, Store, TransformedUpgrade,
    UpgradeTransformOptions,
};
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

fn hex(bytes: [u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn backup_legacy(source: &Path, backup: &Path) -> Result<String> {
    let output = successful(
        oxigraph()
            .args(["backup-legacy", "--location"])
            .arg(source)
            .arg("--destination")
            .arg(backup),
    )?;
    Ok(String::from_utf8(output.stdout)?)
}

fn prepare(source: &Path, backup: &Path, work: &Path) -> Result<String> {
    let output = successful(
        oxigraph()
            .args(["prepare-upgrade", "--source"])
            .arg(source)
            .arg("--backup")
            .arg(backup)
            .arg("--destination")
            .arg(work),
    )?;
    Ok(String::from_utf8(output.stdout)?)
}

fn verify_preparation(work: &Path) -> Result<String> {
    let output = successful(
        oxigraph()
            .args(["verify-upgrade-preparation", "--location"])
            .arg(work),
    )?;
    Ok(String::from_utf8(output.stdout)?)
}

fn transform(source: &Path, backup: &Path, work: &Path) -> Result<String> {
    let output = successful(
        oxigraph()
            .args(["transform-upgrade", "--source"])
            .arg(source)
            .arg("--backup")
            .arg(backup)
            .arg("--location")
            .arg(work),
    )?;
    Ok(String::from_utf8(output.stdout)?)
}

fn verify_transformation(source: &Path, backup: &Path, work: &Path) -> Result<String> {
    let output = successful(
        oxigraph()
            .args(["verify-upgrade-transformation", "--source"])
            .arg(source)
            .arg("--backup")
            .arg(backup)
            .arg("--location")
            .arg(work),
    )?;
    Ok(String::from_utf8(output.stdout)?)
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

fn assert_inactive(output: &str) -> Result<()> {
    ensure!(output.contains("active=false"));
    ensure!(output.contains("upgrade_authorized=false"));
    Ok(())
}

fn full_journey(version: u64, expected_quads: u64) -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let backup = directory.path().join("backup");
    let work = directory.path().join("work");
    fixture(version, &source)?;
    let source_before = inventory(&source)?;

    backup_legacy(&source, &backup)?;
    let backup_before = inventory(&backup)?;
    ensure!(source_before == inventory(&source)?);

    let created = prepare(&source, &backup, &work)?;
    let prepared = PreparedUpgrade::verify(&work, &LegacyBackupOptions::default())?;
    ensure!(created.contains("upgrade_preparation_complete=true"));
    ensure!(!created.contains("upgrade_preparation_verified=true"));
    ensure!(created.contains("stage=prepared"));
    ensure!(created.contains(&format!("storage_version={version}")));
    ensure!(created.contains(&format!("files={}", prepared.legacy_backup().files().len())));
    ensure!(created.contains(&format!(
        "legacy_backup_fingerprint={}",
        hex(prepared.legacy_backup().fingerprint())
    )));
    ensure!(created.contains("external_ancestry=exact"));
    assert_inactive(&created)?;
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);

    let work_before_verification = inventory(&work)?;
    let verified = verify_preparation(&work)?;
    ensure!(verified.contains("upgrade_preparation_verified=true"));
    ensure!(!verified.contains("upgrade_preparation_complete=true"));
    ensure!(verified.contains("stage=prepared"));
    ensure!(verified.contains("external_ancestry=not-checked"));
    ensure!(verified.contains(&format!(
        "legacy_backup_fingerprint={}",
        hex(prepared.legacy_backup().fingerprint())
    )));
    assert_inactive(&verified)?;
    ensure!(work_before_verification == inventory(&work)?);
    assert_guarded(&work.join(PreparedUpgrade::store_directory()));

    let transformed_output = transform(&source, &backup, &work)?;
    let transformed =
        TransformedUpgrade::verify(&source, &backup, &work, &UpgradeTransformOptions::default())?;
    ensure!(transformed_output.contains("upgrade_transformation_complete=true"));
    ensure!(!transformed_output.contains("upgrade_transformation_verified=true"));
    ensure!(transformed_output.contains("stage=transformed"));
    ensure!(transformed_output.contains(&format!("files={}", transformed.files().len())));
    ensure!(transformed_output.contains(&format!(
        "transformed_fingerprint={}",
        hex(transformed.fingerprint())
    )));
    ensure!(transformed_output.contains(&format!(
        "logical_fingerprint={}",
        hex(transformed.logical_fingerprint())
    )));
    ensure!(transformed_output.contains(&format!("quads={expected_quads}")));
    ensure!(
        transformed_output.contains(&format!("named_graphs={}", transformed.named_graph_count()))
    );
    ensure!(transformed_output.contains(&format!("namespaces={}", transformed.namespace_count())));
    ensure!(transformed_output.contains("external_ancestry=exact"));
    assert_inactive(&transformed_output)?;
    ensure!(
        PreparedUpgrade::verify(&work, &LegacyBackupOptions::default()).is_err(),
        "the pre-transformation receipt must not verify transformed bytes"
    );
    assert_guarded(&work.join(PreparedUpgrade::store_directory()));

    let work_before_verification = inventory(&work)?;
    let verified = verify_transformation(&source, &backup, &work)?;
    ensure!(verified.contains("upgrade_transformation_verified=true"));
    ensure!(!verified.contains("upgrade_transformation_complete=true"));
    ensure!(verified.contains(&format!(
        "transformed_fingerprint={}",
        hex(transformed.fingerprint())
    )));
    ensure!(verified.contains(&format!(
        "logical_fingerprint={}",
        hex(transformed.logical_fingerprint())
    )));
    ensure!(verified.contains(&format!("quads={expected_quads}")));
    ensure!(verified.contains("external_ancestry=exact"));
    assert_inactive(&verified)?;
    ensure!(work_before_verification == inventory(&work)?);
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);
    Ok(())
}

#[test]
fn cli_upgrade_journeys_match_api_receipts_and_preserve_inputs() -> Result<()> {
    full_journey(0, 16)?;
    #[cfg(feature = "rdf-12")]
    full_journey(1, 8)?;
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn cli_v1_refuses_before_modifying_the_preparation_without_rdf12() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let backup = directory.path().join("backup");
    let work = directory.path().join("work");
    fixture(1, &source)?;
    let source_before = inventory(&source)?;
    backup_legacy(&source, &backup)?;
    let backup_before = inventory(&backup)?;
    prepare(&source, &backup, &work)?;
    let work_before = inventory(&work)?;

    failed(
        oxigraph()
            .args(["transform-upgrade", "--source"])
            .arg(&source)
            .arg("--backup")
            .arg(&backup)
            .arg("--location")
            .arg(&work),
    )?;
    ensure!(work_before == inventory(&work)?);
    PreparedUpgrade::verify(&work, &LegacyBackupOptions::default())?;
    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);
    assert_guarded(&work.join(PreparedUpgrade::store_directory()));
    Ok(())
}

#[test]
fn cli_verifiers_reject_tampering_and_changed_ancestry_without_success_output() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let changed_source = directory.path().join("changed-source");
    let backup = directory.path().join("backup");
    let work = directory.path().join("work");
    fixture(0, &source)?;
    backup_legacy(&source, &backup)?;
    prepare(&source, &backup, &work)?;

    for target in [
        work.join(PreparedUpgrade::manifest_name()),
        work.join(PreparedUpgrade::journal_name()),
        work.join(PreparedUpgrade::store_directory())
            .join("IDENTITY"),
    ] {
        let bytes = fs::read(&target)?;
        fs::write(&target, b"tampered preparation")?;
        let before = inventory(&work)?;
        failed(
            oxigraph()
                .args(["verify-upgrade-preparation", "--location"])
                .arg(&work),
        )?;
        ensure!(before == inventory(&work)?);
        fs::write(target, bytes)?;
    }
    PreparedUpgrade::verify(&work, &LegacyBackupOptions::default())?;
    transform(&source, &backup, &work)?;

    for target in [
        work.join(TransformedUpgrade::manifest_name()),
        work.join(TransformedUpgrade::journal_name()),
        work.join(PreparedUpgrade::store_directory())
            .join("IDENTITY"),
    ] {
        let bytes = fs::read(&target)?;
        fs::write(&target, b"tampered transformed output")?;
        let before = inventory(&work)?;
        failed(
            oxigraph()
                .args(["verify-upgrade-transformation", "--source"])
                .arg(&source)
                .arg("--backup")
                .arg(&backup)
                .arg("--location")
                .arg(&work),
        )?;
        ensure!(before == inventory(&work)?);
        fs::write(target, bytes)?;
    }

    copy_directory(&source, &changed_source)?;
    fs::write(changed_source.join("IDENTITY"), b"changed ancestry")?;
    let work_before = inventory(&work)?;
    failed(
        oxigraph()
            .args(["verify-upgrade-transformation", "--source"])
            .arg(&changed_source)
            .arg("--backup")
            .arg(&backup)
            .arg("--location")
            .arg(&work),
    )?;
    ensure!(work_before == inventory(&work)?);
    TransformedUpgrade::verify(&source, &backup, &work, &UpgradeTransformOptions::default())?;
    Ok(())
}

#[test]
fn cli_prepare_and_transform_reject_changed_original_ancestry_without_mutation() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let changed_source = directory.path().join("changed-source");
    let backup = directory.path().join("backup");
    let rejected_work = directory.path().join("rejected-work");
    let work = directory.path().join("work");
    fixture(0, &source)?;
    backup_legacy(&source, &backup)?;
    copy_directory(&source, &changed_source)?;
    fs::write(
        changed_source.join("IDENTITY"),
        b"changed original ancestry",
    )?;

    let source_before = inventory(&source)?;
    let changed_before = inventory(&changed_source)?;
    let backup_before = inventory(&backup)?;
    failed(
        oxigraph()
            .args(["prepare-upgrade", "--source"])
            .arg(&changed_source)
            .arg("--backup")
            .arg(&backup)
            .arg("--destination")
            .arg(&rejected_work),
    )?;
    ensure!(!rejected_work.exists());
    ensure!(source_before == inventory(&source)?);
    ensure!(changed_before == inventory(&changed_source)?);
    ensure!(backup_before == inventory(&backup)?);

    prepare(&source, &backup, &work)?;
    let work_before = inventory(&work)?;
    failed(
        oxigraph()
            .args(["transform-upgrade", "--source"])
            .arg(&changed_source)
            .arg("--backup")
            .arg(&backup)
            .arg("--location")
            .arg(&work),
    )?;
    ensure!(source_before == inventory(&source)?);
    ensure!(changed_before == inventory(&changed_source)?);
    ensure!(backup_before == inventory(&backup)?);
    ensure!(work_before == inventory(&work)?);
    PreparedUpgrade::verify(&work, &LegacyBackupOptions::default())?;
    Ok(())
}

#[test]
fn cli_rejects_existing_overlapping_and_low_bound_paths_without_mutating_inputs() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let source = directory.path().join("source");
    let backup = directory.path().join("backup");
    let existing = directory.path().join("existing");
    let work = directory.path().join("work");
    fixture(0, &source)?;
    let source_before = inventory(&source)?;
    backup_legacy(&source, &backup)?;
    let backup_before = inventory(&backup)?;

    fs::create_dir(&existing)?;
    failed(
        oxigraph()
            .args(["prepare-upgrade", "--source"])
            .arg(&source)
            .arg("--backup")
            .arg(&backup)
            .arg("--destination")
            .arg(&existing),
    )?;
    failed(
        oxigraph()
            .args(["prepare-upgrade", "--source"])
            .arg(&source)
            .arg("--backup")
            .arg(&backup)
            .arg("--destination")
            .arg(source.join("nested-work")),
    )?;

    for (index, flag) in ["--max-files", "--max-bytes"].into_iter().enumerate() {
        let destination = directory
            .path()
            .join(format!("bounded-preparation-{index}"));
        failed(
            oxigraph()
                .args(["prepare-upgrade", "--source"])
                .arg(&source)
                .arg("--backup")
                .arg(&backup)
                .arg("--destination")
                .arg(&destination)
                .arg(flag)
                .arg("1"),
        )?;
        ensure!(!destination.exists());
    }

    prepare(&source, &backup, &work)?;
    for flag in ["--max-files", "--max-bytes"] {
        let before = inventory(&work)?;
        failed(
            oxigraph()
                .args(["verify-upgrade-preparation", "--location"])
                .arg(&work)
                .arg(flag)
                .arg("1"),
        )?;
        ensure!(before == inventory(&work)?);
    }

    for flag in [
        "--max-files",
        "--max-bytes",
        "--max-entries",
        "--max-projection-bytes",
    ] {
        let before = inventory(&work)?;
        failed(
            oxigraph()
                .args(["transform-upgrade", "--source"])
                .arg(&source)
                .arg("--backup")
                .arg(&backup)
                .arg("--location")
                .arg(&work)
                .arg(flag)
                .arg("1"),
        )?;
        ensure!(before == inventory(&work)?);
        PreparedUpgrade::verify(&work, &LegacyBackupOptions::default())?;
    }

    transform(&source, &backup, &work)?;
    for flag in [
        "--max-files",
        "--max-bytes",
        "--max-entries",
        "--max-projection-bytes",
    ] {
        let before = inventory(&work)?;
        failed(
            oxigraph()
                .args(["verify-upgrade-transformation", "--source"])
                .arg(&source)
                .arg("--backup")
                .arg(&backup)
                .arg("--location")
                .arg(&work)
                .arg(flag)
                .arg("1"),
        )?;
        ensure!(before == inventory(&work)?);
    }

    ensure!(source_before == inventory(&source)?);
    ensure!(backup_before == inventory(&backup)?);
    Ok(())
}

#[test]
fn cli_upgrade_help_and_argument_validation_cover_every_declared_path_and_bound() -> Result<()> {
    let cases: [(&str, &[&str], &[&str]); 4] = [
        (
            "prepare-upgrade",
            &["--source", "--backup", "--destination"],
            &["--max-files", "--max-bytes", "--timeout-ms"],
        ),
        (
            "verify-upgrade-preparation",
            &["--location"],
            &["--max-files", "--max-bytes", "--timeout-ms"],
        ),
        (
            "transform-upgrade",
            &["--source", "--backup", "--location"],
            &[
                "--max-files",
                "--max-bytes",
                "--timeout-ms",
                "--max-entries",
                "--max-projection-bytes",
            ],
        ),
        (
            "verify-upgrade-transformation",
            &["--source", "--backup", "--location"],
            &[
                "--max-files",
                "--max-bytes",
                "--timeout-ms",
                "--max-entries",
                "--max-projection-bytes",
            ],
        ),
    ];
    let overflow = "340282366920938463463374607431768211456";

    for (name, required, bounds) in cases {
        let help = successful(oxigraph().args([name, "--help"]))?;
        let help = String::from_utf8(help.stdout)?;
        for text in [
            "offline",
            "exclusively controlled",
            "API default",
            "resume",
            "activate",
            "UpgradeReceipt",
        ] {
            ensure!(help.contains(text), "missing {text:?} from {name} help");
        }
        if required.len() > 1 {
            ensure!(help.contains("disjoint"));
        }
        if name == "verify-upgrade-preparation" {
            ensure!(help.contains("external ancestry is not"));
        }
        for flag in required.iter().chain(bounds.iter()) {
            ensure!(help.contains(flag), "missing {flag} from {name} help");
        }

        for missing in required {
            let mut command = oxigraph();
            command.arg(name);
            for flag in required {
                if flag != missing {
                    command.arg(flag).arg("required-path");
                }
            }
            let output = failed(&mut command)?;
            ensure!(
                String::from_utf8_lossy(&output.stderr).contains(missing),
                "missing-path error for {name} did not identify {missing}"
            );
        }

        for flag in bounds {
            for invalid in ["0", overflow] {
                let mut command = oxigraph();
                command.arg(name);
                for required in required {
                    command.arg(required).arg("required-path");
                }
                command.arg(flag).arg(invalid);
                let output = failed(&mut command)?;
                ensure!(
                    String::from_utf8_lossy(&output.stderr).contains(flag),
                    "numeric error for {name} did not identify {flag}"
                );
            }
        }
    }
    Ok(())
}
