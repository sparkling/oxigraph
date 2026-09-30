use super::*;
use std::ffi::OsStr;
use std::process::{Command, Stdio};
use std::time::Duration;

const VAR_SOURCE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_JOURNAL_FSYNC_TEST_SOURCE";
const VAR_PACKAGE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_JOURNAL_FSYNC_TEST_PACKAGE";
const VAR_WORKSPACE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_JOURNAL_FSYNC_TEST_WORKSPACE";
const VAR_RDF12: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_JOURNAL_FSYNC_TEST_RDF12";
const VAR_MODE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_JOURNAL_FSYNC_TEST_MODE";

/// Runs one bounded child under the shim with a cleared, private environment.
fn run_child(
    shim: &Path,
    exact: &Path,
    ordinal: &str,
    name: &str,
    vars: &[(&str, &OsStr)],
    private: &Path,
    label: &str,
) -> TestResult {
    use std::io::Read as _;
    const TIMEOUT: Duration = Duration::from_secs(300);
    const CAPTURE_LIMIT: u64 = 1 << 20;
    let stdout_path = private.join(format!("journal-fsync-{label}.stdout"));
    let stderr_path = private.join(format!("journal-fsync-{label}.stderr"));
    let captured = |path: &Path| -> TestResult<String> {
        let mut data = Vec::new();
        File::open(path)?
            .take(CAPTURE_LIMIT)
            .read_to_end(&mut data)?;
        Ok(String::from_utf8_lossy(&data).into_owned())
    };
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper(&format!("journal_fsync::{name}")));
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
            // Never leave the child running or unreaped, whatever went wrong.
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

/// Real `EIO` from `fsync` on the JOURNAL `sync_all` inside the SEALED append,
/// on both RDF profiles. The parent stops a shimless resume at `fault(6)`, so
/// the journal ends in VALIDATED; the resumed child then skips construction,
/// writes the complete SEALED frame and syncs JOURNAL exactly once. Only after
/// that sync succeeds does `append` update its in-memory records and reach
/// `fault(7)`, which separates this point from the SEALED write-ENOSPC and the
/// phase-7 process-exit tests. Ordinal 1 on the exact JOURNAL path fails that
/// sync; the ordinal 2 control succeeds, proving there is only one such sync.
///
/// A failed fsync keeps page-cache bytes: JOURNAL visibly holds INTENT,
/// VALIDATED and the full SEALED frame, with no PENDING, COMPLETE or attempt 1.
/// A shimless resume reuses attempt 0 and publishes without another append.
/// Injected errno and same-host visibility only; no power-loss or media claim.
#[test]
fn resume_sealed_journal_fsync_failure_preserves_inputs_and_reuses_attempt() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_sealed_journal_fsync")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let first = format!("{:016}", 0_u64);
    // (case and helper mode, matching-call ordinal, whether the child publishes)
    let cases: [(&str, &str, bool); 2] = [("fail", "1", false), ("control", "2", true)];
    for rdf12 in [false, true] {
        for (name, ordinal, published) in cases {
            let label = format!("{name}-{}", if rdf12 { "rdf12" } else { "rdf11" });
            let profile = if rdf12 {
                SchemaRdfProfile::Rdf12
            } else {
                SchemaRdfProfile::Rdf11
            };
            let options = SchemaUpgradeOptions::new(profile);
            let holder = tempfile::tempdir_in(&root_path)?;
            let workspace = holder.path().canonicalize()?.join("workspace");
            let private_dir = tempfile::tempdir_in(&root_path)?;
            let private = private_dir.path().canonicalize()?;
            let attempts = workspace.join("attempts");
            let journal_path = workspace.join(JOURNAL);
            // Parent prepares a VALIDATED, unsealed workspace with no shim in its environment.
            let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
            let plan = fs::read(workspace.join(PLAN))?;
            let validating = resume_inner(&source, &package, &workspace, &options, |phase| {
                if phase == 6 {
                    Err(BackupError::Cancelled)
                } else {
                    Ok(())
                }
            });
            assert!(
                matches!(&validating, Err(BackupError::Cancelled)),
                "{label}: phase 6 was not reached: {validating:?}"
            );
            assert_eq!(
                fs::read(workspace.join(PLAN))?,
                plan,
                "{label}: plan changed"
            );
            let journal = fs::read(&journal_path)?;
            let shape = |journal: &[u8]| -> TestResult<Vec<(u8, u64)>> {
                Ok(decode_records(journal, &plan, &options)?
                    .iter()
                    .map(|record| (record.kind, record.attempt))
                    .collect())
            };
            assert_eq!(
                shape(&journal)?,
                vec![(INTENT, 0_u64), (VALIDATED, 0)],
                "{label}: journal before the child"
            );
            assert!(attempt_path(&workspace, 0).is_dir(), "{label}: attempt 0");
            assert!(!attempt_path(&workspace, 1).exists(), "{label}: attempt 1");
            assert_eq!(names(&attempts)?, vec![first.clone()], "{label}: attempts");
            assert!(!workspace.join(COMPLETE).exists(), "{label}: COMPLETE");
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            assert_eq!(
                names(&workspace)?,
                workspace_names(None),
                "{label}: entries"
            );
            assert_eq!(
                fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(),
                0,
                "{label}: lock file"
            );
            // The parent holds no workspace lock when the child spawns.
            drop(WorkspaceLease::acquire(&workspace)?);
            // The previous digest comes from the last complete encoded frame,
            // exactly as append derives it, not from the whole journal.
            let previous = {
                let mut input = Decode(&journal);
                let mut last: &[u8] = &[];
                let mut frames = 0_usize;
                while !input.0.is_empty() {
                    let rest = input.0;
                    input.blob(MAX_MANIFEST)?;
                    last = &rest[..rest.len() - input.0.len()];
                    frames += 1;
                }
                assert_eq!(frames, 2, "{label}: expected INTENT and VALIDATED frames");
                assert!(
                    !last.is_empty() && journal.ends_with(last),
                    "{label}: last frame"
                );
                envelope_checksum(JOURNAL_MAGIC, last)
            };
            let sealed_frame = frame(
                &Record {
                    kind: SEALED,
                    attempt: 0,
                    files: Vec::new(),
                },
                &previous,
            );
            let mut expected_journal = journal.clone();
            expected_journal.extend_from_slice(&sealed_frame);
            assert_eq!(
                shape(&expected_journal)?,
                vec![(INTENT, 0_u64), (VALIDATED, 0), (SEALED, 0)],
                "{label}: expected journal"
            );
            // Expected receipt bytes, derived independently of receipt_bytes.
            let mut expected_receipt = RECEIPT_MAGIC.to_vec();
            expected_receipt.extend_from_slice(&envelope_checksum(PLAN_MAGIC, &plan));
            expected_receipt
                .extend_from_slice(&envelope_checksum(JOURNAL_MAGIC, &expected_journal));
            let trailer = envelope_checksum(RECEIPT_MAGIC, &expected_receipt);
            expected_receipt.extend_from_slice(&trailer);
            let before_workspace = bytes(&workspace)?;
            run_child(
                &shim,
                &journal_path,
                ordinal,
                "resume_sealed_journal_fsync_process_helper",
                &[
                    (VAR_SOURCE, source.as_os_str()),
                    (VAR_PACKAGE, package.as_os_str()),
                    (VAR_WORKSPACE, workspace.as_os_str()),
                    (VAR_RDF12, OsStr::new(if rdf12 { "1" } else { "0" })),
                    (VAR_MODE, OsStr::new(name)),
                ],
                &private,
                &label,
            )?;
            // The helper passed only on the exact expected result and phases, so
            // the SEALED append's JOURNAL sync was intercepted. Now the visible state.
            assert_eq!(
                fs::read(&journal_path)?,
                expected_journal,
                "{label}: JOURNAL must hold the complete SEALED frame"
            );
            assert_eq!(
                fs::read(workspace.join(PLAN))?,
                plan,
                "{label}: plan changed"
            );
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            assert_eq!(
                names(&workspace)?,
                workspace_names(published.then_some(COMPLETE)),
                "{label}: entries"
            );
            assert_eq!(names(&attempts)?, vec![first.clone()], "{label}: attempts");
            assert!(!attempt_path(&workspace, 1).exists(), "{label}: attempt 1");
            assert_eq!(
                fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(),
                0,
                "{label}: lock file"
            );
            let mut failure_visible = bytes(&workspace)?;
            let complete = failure_visible.remove(Path::new(COMPLETE));
            if published {
                assert_eq!(
                    complete.as_deref(),
                    Some(expected_receipt.as_slice()),
                    "{label}: control COMPLETE"
                );
            } else {
                assert!(complete.is_none(), "{label}: COMPLETE after EIO");
            }
            let mut rest_after = failure_visible.clone();
            assert_eq!(
                rest_after.remove(Path::new(JOURNAL)).as_deref(),
                Some(expected_journal.as_slice()),
                "{label}: JOURNAL snapshot"
            );
            let mut rest_before = before_workspace.clone();
            rest_before.remove(Path::new(JOURNAL));
            assert_eq!(
                rest_after, rest_before,
                "{label}: only JOURNAL (and a published COMPLETE) may change"
            );
            assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
            assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
            assert!(
                !package.join("store").join("LOCK").exists(),
                "{label}: package LOCK"
            );
            // Same-path retry contract.
            let current = bytes(&workspace)?;
            let refused = Store::start_schema_upgrade(&source, &package, &workspace, &options);
            assert!(
                matches!(refused, Err(BackupError::InvalidPath)),
                "{label}: same-path start gave {refused:?}"
            );
            assert_eq!(bytes(&workspace)?, current, "{label}: start wrote");
            let verified_before = if published {
                Some(SchemaUpgradeReceipt::verify(
                    &source, &package, &workspace, &options,
                )?)
            } else {
                // The visible SEALED record validates, but COMPLETE is absent.
                let unpublished =
                    SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options);
                assert!(
                    matches!(&unpublished, Err(BackupError::Io(error))
                        if error.kind() == io::ErrorKind::NotFound),
                    "{label}: sealed but unpublished verify gave {unpublished:?}"
                );
                None
            };
            assert_eq!(bytes(&workspace)?, current, "{label}: verify wrote");
            let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)
                .map_err(|error| format!("{label}: resume failed: {error:?}"))?;
            let receipt = state.receipt().ok_or("resume did not seal the workspace")?;
            if published {
                assert_eq!(
                    bytes(&workspace)?,
                    current,
                    "{label}: resume rewrote a published workspace"
                );
                assert_eq!(verified_before.as_ref(), Some(receipt), "{label}: receipt");
            }
            assert_eq!(
                fs::read(&journal_path)?,
                expected_journal,
                "{label}: resume appended to JOURNAL"
            );
            let mut end = bytes(&workspace)?;
            assert_eq!(
                end.remove(Path::new(COMPLETE)).as_deref(),
                Some(expected_receipt.as_slice()),
                "{label}: final COMPLETE"
            );
            assert_eq!(end, failure_visible, "{label}: final workspace");
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            assert_eq!(
                names(&workspace)?,
                workspace_names(Some(COMPLETE)),
                "{label}: final entries"
            );
            assert_eq!(state.schema_uuid(), initial.schema_uuid(), "{label}: uuid");
            assert_eq!(
                receipt.schema_uuid(),
                initial.schema_uuid(),
                "{label}: receipt uuid"
            );
            assert_eq!(
                receipt.envelope().rdf_write_profile(),
                profile,
                "{label}: profile"
            );
            assert_eq!(
                receipt.store_directory(),
                attempt_path(&workspace, 0).join("store"),
                "{label}: winning attempt"
            );
            assert_eq!(
                receipt.fingerprint(),
                envelope_checksum(RECEIPT_MAGIC, &expected_receipt),
                "{label}: fingerprint"
            );
            let published_bytes = bytes(&workspace)?;
            assert_eq!(
                &SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?,
                receipt,
                "{label}: independent verify"
            );
            assert_eq!(
                bytes(&workspace)?,
                published_bytes,
                "{label}: final verify wrote"
            );
            assert!(!attempt_path(&workspace, 1).exists(), "{label}: attempt 1");
            assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
            assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
            assert!(
                !package.join("store").join("LOCK").exists(),
                "{label}: package LOCK"
            );
        }
    }
    Ok(())
}

#[test]
fn resume_sealed_journal_fsync_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os(VAR_SOURCE) else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable(VAR_PACKAGE)?;
    let workspace = variable(VAR_WORKSPACE)?;
    let profile = match std::env::var(VAR_RDF12)?.as_str() {
        "0" => SchemaRdfProfile::Rdf11,
        "1" => SchemaRdfProfile::Rdf12,
        other => return Err(format!("unexpected rdf12 flag {other:?}").into()),
    };
    let mode = std::env::var(VAR_MODE)?;
    let options = SchemaUpgradeOptions::new(profile);
    let mut phases = Vec::new();
    let result = resume_inner(&source, &package, &workspace, &options, |phase| {
        phases.push(phase);
        Ok(())
    });
    // Only the shim's exact-path fsync yields EIO. The workspace ends in
    // VALIDATED, so construction is skipped and the SEALED append runs first:
    // no phase before its sync, [7, 8, 9] when that sync and publication pass.
    let passed = match (mode.as_str(), &result) {
        ("fail", Err(BackupError::Io(error))) => {
            error.raw_os_error() == Some(libc::EIO) && phases.is_empty()
        }
        ("control", Ok(state)) => state.receipt().is_some() && phases == [7, 8, 9],
        _ => false,
    };
    if passed {
        Ok(())
    } else {
        Err(format!("mode {mode}: unexpected result {result:?}, phases {phases:?}").into())
    }
}
