use super::*;
use std::ffi::OsStr;
use std::process::{Command, Stdio};
use std::time::Duration;

const VAR_SOURCE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_FSYNC_TEST_SOURCE";
const VAR_PACKAGE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_FSYNC_TEST_PACKAGE";
const VAR_WORKSPACE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_FSYNC_TEST_WORKSPACE";
const VAR_RDF12: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_FSYNC_TEST_RDF12";
const VAR_MODE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_FSYNC_TEST_MODE";

/// Runs one bounded child with private capture files and a cleared environment.
fn run_child(
    shim: &Path,
    exact: &Path,
    ordinal: &str,
    vars: &[(&str, &OsStr)],
    private: &Path,
    label: &str,
) -> TestResult {
    use std::io::Read as _;
    const TIMEOUT: Duration = Duration::from_secs(300);
    const CAPTURE_LIMIT: u64 = 1 << 20;
    let stdout_path = private.join(format!("validated-fsync-{label}.stdout"));
    let stderr_path = private.join(format!("validated-fsync-{label}.stderr"));
    let captured = |path: &Path| -> TestResult<String> {
        let mut data = Vec::new();
        File::open(path)?
            .take(CAPTURE_LIMIT)
            .read_to_end(&mut data)?;
        Ok(String::from_utf8_lossy(&data).into_owned())
    };
    let mut command = Command::new(std::env::current_exe()?);
    command.arg("--exact").arg(helper(
        "validated_fsync::resume_validated_journal_fsync_process_helper",
    ));
    command.env_clear();
    command.current_dir(private);
    command.env("TMPDIR", private);
    command.env("LD_PRELOAD", shim);
    command.env("FSYNC_SHIM_EXACT_PATH", exact);
    command.env("FSYNC_SHIM_FAIL_ON_MATCH", ordinal);
    if let Some(value) = std::env::var_os("LD_LIBRARY_PATH") {
        command.env("LD_LIBRARY_PATH", value);
    }
    for (variable, value) in vars {
        command.env(variable, value);
    }
    command.stdin(Stdio::null());
    command.stdout(File::create(&stdout_path)?);
    command.stderr(File::create(&stderr_path)?);
    let mut child = command.spawn()?;
    let deadline = Instant::now() + TIMEOUT;
    let waited = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Ok(None) => break Err(io::Error::new(io::ErrorKind::TimedOut, "deadline passed")),
            Err(error) => break Err(error),
        }
    };
    let status = match waited {
        Ok(status) => status,
        Err(error) => {
            // Always attempt both cleanup operations before reporting a wait failure.
            let killed = child.kill();
            let reaped = child.wait();
            return Err(format!(
                "{label}: child helper did not exit within {TIMEOUT:?} ({error}); kill \
                 {killed:?}, reap {reaped:?}, stdout {}, stderr {}",
                captured(&stdout_path)?,
                captured(&stderr_path)?
            )
            .into());
        }
    };
    let stdout = captured(&stdout_path)?;
    assert!(
        status.success(),
        "{label}: child helper failed: status {status:?}, stdout {stdout}, stderr {}",
        captured(&stderr_path)?
    );
    assert!(
        stdout.contains("running 1 test"),
        "{label}: the --exact filter did not match exactly one test: {stdout}"
    );
    Ok(())
}

fn names(path: &Path) -> TestResult<Vec<String>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(path)? {
        out.push(entry?.file_name().to_string_lossy().into_owned());
    }
    out.sort();
    Ok(out)
}

fn workspace_names(extra: Option<&str>) -> Vec<String> {
    let mut out = vec![
        JOURNAL.to_owned(),
        PLAN.to_owned(),
        WORKSPACE_LOCK.to_owned(),
        "attempts".to_owned(),
    ];
    out.extend(extra.map(str::to_owned));
    out.sort();
    out
}

/// Includes empty directories, which the shared file-byte snapshot omits.
fn snapshot(root: &Path) -> TestResult<(BTreeMap<PathBuf, Vec<u8>>, Vec<PathBuf>)> {
    fn visit(root: &Path, path: &Path, directories: &mut Vec<PathBuf>) -> TestResult {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() {
                directories.push(entry.path().strip_prefix(root)?.to_owned());
                visit(root, &entry.path(), directories)?;
            } else {
                assert!(
                    kind.is_file(),
                    "unexpected workspace entry: {:?}",
                    entry.path()
                );
            }
        }
        Ok(())
    }
    let files = bytes(root)?;
    let mut directories = Vec::new();
    visit(root, root, &mut directories)?;
    directories.sort();
    Ok((files, directories))
}

/// Real EIO on the second JOURNAL sync: INTENT passes, then append writes the
/// complete VALIDATED frame but fails before updating its in-memory records,
/// retaining the output lease or reaching fault(6). Both RDF profiles run a
/// failure case and an ordinal-3 control that cancels at fault(6), before SEALED.
/// Visible VALIDATED bytes permit shimless recovery using the same attempt.
/// Same-host syscall/page-cache evidence only; no power-loss or media claim.
#[test]
fn resume_validated_journal_fsync_failure_preserves_inputs_and_reuses_attempt() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_validated_journal_fsync")? else {
        return Ok(()); // Missing C compiler skips infrastructure, not proven fault coverage.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let backup = BackupReceipt::verify(&package, &crate::store::TransactionStartControl::new())?;
    assert!(
        backup.contents().quads() > 0,
        "fixture must contain primary data"
    );
    assert!(
        backup.files().iter().any(|file| file.size() > 0),
        "fixture must contain nonempty receipt files"
    );
    let check_inputs = |label: &str| -> TestResult {
        assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
        assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
        assert!(
            !package.join("store").join("LOCK").exists(),
            "{label}: package LOCK"
        );
        Ok(())
    };
    let first = format!("{:016}", 0_u64);
    let cases = [("fail", "2"), ("control", "3")];
    for profile in [SchemaRdfProfile::Rdf11, SchemaRdfProfile::Rdf12] {
        for (mode, ordinal) in cases {
            let rdf12 = profile == SchemaRdfProfile::Rdf12;
            let label = format!("{mode}-{}", if rdf12 { "rdf12" } else { "rdf11" });
            let options = SchemaUpgradeOptions::new(profile);
            let holder = tempfile::tempdir_in(&root_path)?;
            let workspace = holder.path().canonicalize()?.join("workspace");
            let private_dir = tempfile::tempdir_in(&root_path)?;
            let private = private_dir.path().canonicalize()?;
            let attempts = workspace.join("attempts");
            let attempt = attempt_path(&workspace, 0);
            let journal_path = workspace.join(JOURNAL);
            // Start only: pre-driving an INTENT-last workspace would abandon attempt 0.
            let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
            assert!(initial.receipt().is_none(), "{label}: initial receipt");
            assert_eq!(
                initial.directory(),
                workspace.as_path(),
                "{label}: directory"
            );
            assert_eq!(
                initial.envelope().rdf_write_profile(),
                profile,
                "{label}: profile"
            );
            let plan = fs::read(workspace.join(PLAN))?;
            assert!(
                plan.starts_with(PLAN_MAGIC) && plan.len() >= PLAN_MAGIC.len() + 32,
                "{label}: complete preflight"
            );
            let (body, trailer) = plan.split_at(plan.len() - 32);
            assert_eq!(
                trailer,
                envelope_checksum(PLAN_MAGIC, body).as_slice(),
                "{label}: preflight checksum"
            );
            assert!(
                fs::read(&journal_path)?.is_empty(),
                "{label}: initial JOURNAL"
            );
            assert!(names(&attempts)?.is_empty(), "{label}: initial attempts");
            assert!(!attempt.exists(), "{label}: initial attempt 0");
            assert!(
                !workspace.join(PENDING).exists(),
                "{label}: initial PENDING"
            );
            assert!(
                !workspace.join(COMPLETE).exists(),
                "{label}: initial COMPLETE"
            );
            assert_eq!(
                names(&workspace)?,
                workspace_names(None),
                "{label}: initial entries"
            );
            assert_eq!(
                fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(),
                0,
                "{label}: lock"
            );
            check_inputs(&label)?;
            let intent_frame = frame(
                &Record {
                    kind: INTENT,
                    attempt: 0,
                    files: Vec::new(),
                },
                &envelope_checksum(PLAN_MAGIC, &plan),
            );
            // No parent workspace lease survives into the child.
            drop(WorkspaceLease::acquire(&workspace)?);
            run_child(
                &shim,
                &journal_path,
                ordinal,
                &[
                    (VAR_SOURCE, source.as_os_str()),
                    (VAR_PACKAGE, package.as_os_str()),
                    (VAR_WORKSPACE, workspace.as_os_str()),
                    (VAR_RDF12, OsStr::new(if rdf12 { "1" } else { "0" })),
                    (VAR_MODE, OsStr::new(mode)),
                ],
                &private,
                &label,
            )?;
            check_inputs(&label)?;
            // The helper requires the exact caller result and full phase vector.
            // Independently derive the visible frame from the observed attempt inventory.
            assert!(attempt.is_dir(), "{label}: attempt 0");
            let inventory = tree(&attempt, &options, Instant::now())?;
            assert!(!inventory.is_empty(), "{label}: attempt inventory");
            assert!(
                inventory.iter().any(|file| file.size() > 0),
                "{label}: nonempty output"
            );
            assert_eq!(
                fs::read(attempt.join("store").join(UPGRADE_GUARD))?,
                GUARD,
                "{label}: complete guard"
            );
            let validated_frame = frame(
                &Record {
                    kind: VALIDATED,
                    attempt: 0,
                    files: inventory.clone(),
                },
                &envelope_checksum(JOURNAL_MAGIC, &intent_frame),
            );
            let mut expected_journal = intent_frame.clone();
            expected_journal.extend_from_slice(&validated_frame);
            let journal = fs::read(&journal_path)?;
            assert_eq!(
                journal, expected_journal,
                "{label}: complete VALIDATED frame"
            );
            let records = decode_records(&journal, &plan, &options)?;
            assert_eq!(
                records
                    .iter()
                    .map(|record| (record.kind, record.attempt))
                    .collect::<Vec<_>>(),
                vec![(INTENT, 0_u64), (VALIDATED, 0)],
                "{label}: visible journal chain"
            );
            assert!(records[0].files.is_empty(), "{label}: INTENT inventory");
            assert_eq!(records[1].files, inventory, "{label}: VALIDATED inventory");
            assert_eq!(
                fs::read(workspace.join(PLAN))?,
                plan,
                "{label}: plan changed"
            );
            assert_eq!(
                names(&workspace)?,
                workspace_names(None),
                "{label}: visible entries"
            );
            assert_eq!(
                names(&attempts)?,
                vec![first.clone()],
                "{label}: visible attempts"
            );
            assert!(!attempt_path(&workspace, 1).exists(), "{label}: attempt 1");
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            assert!(!workspace.join(COMPLETE).exists(), "{label}: COMPLETE");
            assert_eq!(
                fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(),
                0,
                "{label}: lock"
            );
            let visible = snapshot(&workspace)?;
            let attempt_bytes = bytes(&attempt)?;
            let unpublished = SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options);
            assert!(
                matches!(&unpublished, Err(BackupError::InvalidManifest)),
                "{label}: VALIDATED-only verify gave {unpublished:?}"
            );
            assert_eq!(
                snapshot(&workspace)?,
                visible,
                "{label}: verify changed workspace"
            );
            check_inputs(&label)?;
            let refused = Store::start_schema_upgrade(&source, &package, &workspace, &options);
            assert!(
                matches!(&refused, Err(BackupError::InvalidPath)),
                "{label}: same-path start gave {refused:?}"
            );
            assert_eq!(
                snapshot(&workspace)?,
                visible,
                "{label}: start changed workspace"
            );
            check_inputs(&label)?;
            // Chain from the last complete encoded VALIDATED frame, never the whole journal.
            let sealed_frame = frame(
                &Record {
                    kind: SEALED,
                    attempt: 0,
                    files: Vec::new(),
                },
                &envelope_checksum(JOURNAL_MAGIC, &validated_frame),
            );
            let mut final_journal = expected_journal.clone();
            final_journal.extend_from_slice(&sealed_frame);
            // Derive completion bytes independently of receipt_bytes and make_receipt.
            let mut expected_receipt = RECEIPT_MAGIC.to_vec();
            expected_receipt.extend_from_slice(&envelope_checksum(PLAN_MAGIC, &plan));
            expected_receipt.extend_from_slice(&envelope_checksum(JOURNAL_MAGIC, &final_journal));
            let checksum = envelope_checksum(RECEIPT_MAGIC, &expected_receipt);
            expected_receipt.extend_from_slice(&checksum);
            let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)
                .map_err(|error| format!("{label}: resume failed: {error:?}"))?;
            check_inputs(&label)?;
            let receipt = state.receipt().ok_or("resume did not seal the workspace")?;
            assert_eq!(
                state.schema_uuid(),
                initial.schema_uuid(),
                "{label}: state UUID"
            );
            assert_eq!(
                state.envelope(),
                initial.envelope(),
                "{label}: state envelope"
            );
            assert_eq!(
                receipt.schema_uuid(),
                initial.schema_uuid(),
                "{label}: receipt UUID"
            );
            assert_eq!(
                receipt.envelope().rdf_write_profile(),
                profile,
                "{label}: receipt profile"
            );
            assert_eq!(
                receipt.store_directory(),
                workspace
                    .join("attempts")
                    .join("0000000000000000")
                    .join("store"),
                "{label}: winning attempt"
            );
            assert_eq!(
                receipt.backup_fingerprint(),
                backup.fingerprint(),
                "{label}: backup"
            );
            assert_eq!(
                receipt.fingerprint(),
                envelope_checksum(RECEIPT_MAGIC, &expected_receipt),
                "{label}: receipt fingerprint"
            );
            assert_eq!(fs::read(workspace.join(PLAN))?, plan, "{label}: final PLAN");
            assert_eq!(
                fs::read(&journal_path)?,
                final_journal,
                "{label}: final JOURNAL"
            );
            assert_eq!(
                decode_records(&final_journal, &plan, &options)?
                    .iter()
                    .map(|record| (record.kind, record.attempt))
                    .collect::<Vec<_>>(),
                vec![(INTENT, 0_u64), (VALIDATED, 0), (SEALED, 0)],
                "{label}: recovery must not append FAILED or another INTENT"
            );
            assert_eq!(
                bytes(&attempt)?,
                attempt_bytes,
                "{label}: recovery changed attempt 0"
            );
            assert_eq!(
                names(&attempts)?,
                vec![first.clone()],
                "{label}: final attempts"
            );
            assert!(
                !attempt_path(&workspace, 1).exists(),
                "{label}: final attempt 1"
            );
            assert!(!workspace.join(PENDING).exists(), "{label}: final PENDING");
            assert_eq!(
                names(&workspace)?,
                workspace_names(Some(COMPLETE)),
                "{label}: final entries"
            );
            assert_eq!(
                fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(),
                0,
                "{label}: final lock"
            );
            let completed = snapshot(&workspace)?;
            let mut rest_after = completed.0.clone();
            assert_eq!(
                rest_after.remove(Path::new(COMPLETE)).as_deref(),
                Some(expected_receipt.as_slice()),
                "{label}: canonical COMPLETE"
            );
            assert_eq!(
                rest_after.remove(Path::new(JOURNAL)).as_deref(),
                Some(final_journal.as_slice()),
                "{label}: final JOURNAL snapshot"
            );
            let mut rest_before = visible.0.clone();
            assert_eq!(
                rest_before.remove(Path::new(JOURNAL)).as_deref(),
                Some(expected_journal.as_slice()),
                "{label}: visible JOURNAL snapshot"
            );
            assert_eq!(
                rest_after, rest_before,
                "{label}: recovery changed other file bytes"
            );
            assert_eq!(
                completed.1, visible.1,
                "{label}: recovery changed directories"
            );
            assert_eq!(
                &SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?,
                receipt,
                "{label}: independent receipt verification"
            );
            assert_eq!(
                snapshot(&workspace)?,
                completed,
                "{label}: final verify changed workspace"
            );
            check_inputs(&label)?;
        }
    }
    Ok(())
}

#[test]
fn resume_validated_journal_fsync_process_helper() -> TestResult {
    let Some(source) = std::env::var_os(VAR_SOURCE) else {
        return Ok(()); // Ordinary invocation stays inert.
    };
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Err("triggered helper requires vendored RocksDB".into());
    }
    let source = PathBuf::from(source);
    let package = variable(VAR_PACKAGE)?;
    let workspace = variable(VAR_WORKSPACE)?;
    let profile = match std::env::var(VAR_RDF12)?.as_str() {
        "0" => SchemaRdfProfile::Rdf11,
        "1" => SchemaRdfProfile::Rdf12,
        other => return Err(format!("unexpected rdf12 flag {other:?}").into()),
    };
    let mode = std::env::var(VAR_MODE)?;
    let control = match mode.as_str() {
        "fail" => false,
        "control" => true,
        other => return Err(format!("unexpected helper mode {other:?}").into()),
    };
    assert_eq!(
        variable("FSYNC_SHIM_EXACT_PATH")?,
        workspace.join(JOURNAL),
        "shim must target exactly JOURNAL"
    );
    assert_eq!(
        std::env::var("FSYNC_SHIM_FAIL_ON_MATCH")?,
        if control { "3" } else { "2" },
        "unexpected matching-call ordinal"
    );
    assert!(
        fs::read(workspace.join(JOURNAL))?.is_empty(),
        "helper requires empty JOURNAL"
    );
    assert!(
        names(&workspace.join("attempts"))?.is_empty(),
        "helper requires no attempts"
    );
    let options = SchemaUpgradeOptions::new(profile);
    let backup = BackupReceipt::verify(&package, &options.backup().control)?;
    assert!(!backup.files().is_empty(), "helper requires receipt files");
    let mut expected = vec![0_u8, 1];
    expected.extend(backup.files().iter().map(|_| 2_u8));
    expected.extend_from_slice(&[3, 4, 5]);
    if control {
        expected.push(6);
    }
    let mut phases = Vec::new();
    let result = resume_inner(&source, &package, &workspace, &options, |phase| {
        phases.push(phase);
        if control && phase == 6 {
            Err(BackupError::Cancelled)
        } else {
            Ok(())
        }
    });
    assert_eq!(
        phases, expected,
        "mode {mode}: unexpected phases for result {result:?}"
    );
    match (mode.as_str(), &result) {
        ("fail", Err(BackupError::Io(error))) if error.raw_os_error() == Some(libc::EIO) => Ok(()),
        ("control", Err(BackupError::Cancelled)) => Ok(()),
        _ => Err(format!("mode {mode}: unexpected result {result:?}, phases {phases:?}").into()),
    }
}
