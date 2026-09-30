use super::*;
use std::ffi::OsStr;
use std::process::{Command, Stdio};
use std::time::Duration;

const VAR_SOURCE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PUBLICATION_FSYNC_TEST_SOURCE";
const VAR_PACKAGE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PUBLICATION_FSYNC_TEST_PACKAGE";
const VAR_WORKSPACE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PUBLICATION_FSYNC_TEST_WORKSPACE";
const VAR_RDF12: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PUBLICATION_FSYNC_TEST_RDF12";
const VAR_MODE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PUBLICATION_FSYNC_TEST_MODE";
const VAR_FILE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PUBLICATION_FSYNC_CONTROL_FILE";
const VAR_OTHER: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PUBLICATION_FSYNC_CONTROL_OTHER";
const VAR_CONTROL_MODE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PUBLICATION_FSYNC_CONTROL_MODE";

/// Runs one bounded child under the shim with a cleared, private environment.
fn run_child(
    shim: &Path,
    exact: &Path,
    ordinal: Option<&str>,
    name: &str,
    vars: &[(&str, &OsStr)],
    private: &Path,
    label: &str,
) -> TestResult {
    use std::io::Read as _;
    const TIMEOUT: Duration = Duration::from_secs(300);
    const CAPTURE_LIMIT: u64 = 1 << 20;
    let stdout_path = private.join(format!("{label}.stdout"));
    let stderr_path = private.join(format!("{label}.stderr"));
    let captured = |path: &Path| -> TestResult<String> {
        let mut data = Vec::new();
        fs::File::open(path)?
            .take(CAPTURE_LIMIT)
            .read_to_end(&mut data)?;
        Ok(String::from_utf8_lossy(&data).into_owned())
    };
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper(&format!("publication_fsync::{name}")));
    command.env_clear();
    command.current_dir(private);
    command.env("TMPDIR", private);
    command.env("LD_PRELOAD", shim);
    command.env("FSYNC_SHIM_EXACT_PATH", exact);
    if let Some(ordinal) = ordinal {
        command.env("FSYNC_SHIM_FAIL_ON_MATCH", ordinal);
    }
    if let Some(value) = std::env::var_os("LD_LIBRARY_PATH") {
        command.env("LD_LIBRARY_PATH", value);
    }
    for (variable, value) in vars {
        command.env(variable, value);
    }
    command.stdin(Stdio::null());
    command.stdout(fs::File::create(&stdout_path)?);
    command.stderr(fs::File::create(&stderr_path)?);
    let mut child = command.spawn()?;
    let deadline = std::time::Instant::now() + TIMEOUT;
    let waited = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if std::time::Instant::now() < deadline => {
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

/// Real `EIO` from `fsync` at each resume receipt-publication sync, on both RDF
/// profiles: PENDING file, workspace directory before the rename, and workspace
/// directory after it. The parent seals a verified workspace with the existing
/// fault callback; only the resume child sees the shim, so setup and copy syncs
/// never match. Ordinals on the workspace path pin each occurrence; the ordinal 3
/// control returning Ok proves there are exactly two workspace syncs.
///
/// A failed fsync keeps page-cache bytes: before the rename PENDING holds the full
/// receipt and COMPLETE is absent (raw Io); after it COMPLETE is visible and the
/// error is CompletionIndeterminate. Retry without the shim either reuses PENDING
/// (resume) or returns the identical receipt. No power-loss or on-media claim.
#[test]
fn resume_publication_fsync_failure_matrix_distinguishes_incomplete_from_indeterminate_and_restarts()
-> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_publication_fsync")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let first = format!("{:016}", 0_u64);
    // (case and helper mode, matching-call ordinal, exact path is PENDING, COMPLETE visible)
    let cases: [(&str, Option<&str>, bool, bool); 4] = [
        ("pending", None, true, false),
        ("dir-before", Some("1"), false, false),
        ("dir-after", Some("2"), false, true),
        ("control", Some("3"), false, true),
    ];
    for (name, ordinal, exact_pending, published) in cases {
        for rdf12 in [false, true] {
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
            // Parent prepares a verified SEALED workspace with no shim in its environment.
            let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
            let sealing = resume_inner(&source, &package, &workspace, &options, |phase| {
                if phase == 7 {
                    Err(BackupError::Cancelled)
                } else {
                    Ok(())
                }
            });
            assert!(
                matches!(&sealing, Err(BackupError::Cancelled)),
                "{label}: phase 7 was not reached: {sealing:?}"
            );
            let plan = fs::read(workspace.join(PLAN))?;
            let journal = fs::read(workspace.join(JOURNAL))?;
            let shape = |journal: &[u8]| -> TestResult<Vec<(u8, u64)>> {
                Ok(decode_records(journal, &plan, &options)?
                    .iter()
                    .map(|record| (record.kind, record.attempt))
                    .collect())
            };
            let sealed_shape = vec![(INTENT, 0_u64), (VALIDATED, 0), (SEALED, 0)];
            assert_eq!(shape(&journal)?, sealed_shape, "{label}: journal");
            assert!(!workspace.join(COMPLETE).exists(), "{label}: COMPLETE");
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            assert_eq!(names(&workspace)?, workspace_names(None), "{label}");
            assert_eq!(names(&attempts)?, vec![first.clone()], "{label}");
            assert_eq!(fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(), 0);
            // The parent holds no workspace lock when the child spawns.
            drop(WorkspaceLease::acquire(&workspace)?);
            let before_workspace = bytes(&workspace)?;
            let unpublished = SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options);
            assert!(
                matches!(&unpublished, Err(BackupError::Io(error))
                    if error.kind() == io::ErrorKind::NotFound),
                "{label}: sealed but unpublished verify gave {unpublished:?}"
            );
            assert_eq!(bytes(&workspace)?, before_workspace, "{label}");
            // Expected receipt bytes, derived independently of receipt_bytes.
            let mut expected = RECEIPT_MAGIC.to_vec();
            expected.extend_from_slice(&envelope_checksum(PLAN_MAGIC, &plan));
            expected.extend_from_slice(&envelope_checksum(JOURNAL_MAGIC, &journal));
            let trailer = envelope_checksum(RECEIPT_MAGIC, &expected);
            expected.extend_from_slice(&trailer);
            let exact = if exact_pending {
                workspace.join(PENDING)
            } else {
                workspace.clone()
            };
            run_child(
                &shim,
                &exact,
                ordinal,
                "resume_publication_fsync_process_helper",
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
            // The helper passed only on the exact expected error and phases, so
            // the intended occurrence was intercepted. Now the visible state.
            let (visible, absent) = if published {
                (COMPLETE, PENDING)
            } else {
                (PENDING, COMPLETE)
            };
            assert_eq!(
                names(&workspace)?,
                workspace_names(Some(visible)),
                "{label}: entries"
            );
            assert!(!workspace.join(absent).exists(), "{label}: {absent}");
            let mut after = bytes(&workspace)?;
            assert_eq!(
                after.remove(Path::new(visible)).as_deref(),
                Some(expected.as_slice()),
                "{label}: {visible} bytes"
            );
            assert_eq!(after, before_workspace, "{label}: workspace changed");
            assert_eq!(fs::read(workspace.join(JOURNAL))?, journal, "{label}");
            assert_eq!(names(&attempts)?, vec![first.clone()], "{label}");
            assert!(!attempt_path(&workspace, 1).exists(), "{label}: attempt 1");
            assert_eq!(fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(), 0);
            assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
            assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
            // Same-path retry contract.
            let current = bytes(&workspace)?;
            let refused = Store::start_schema_upgrade(&source, &package, &workspace, &options);
            assert!(
                matches!(refused, Err(BackupError::InvalidPath)),
                "{label}: same-path start gave {refused:?}"
            );
            assert_eq!(bytes(&workspace)?, current, "{label}");
            let verified_before = if published {
                Some(SchemaUpgradeReceipt::verify(
                    &source, &package, &workspace, &options,
                )?)
            } else {
                let failed = SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options);
                assert!(
                    matches!(&failed, Err(BackupError::Io(error))
                        if error.kind() == io::ErrorKind::NotFound),
                    "{label}: verify before resume gave {failed:?}"
                );
                None
            };
            assert_eq!(bytes(&workspace)?, current, "{label}");
            let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)
                .map_err(|error| format!("{label}: resume failed: {error:?}"))?;
            let receipt = state.receipt().ok_or("resume did not seal the workspace")?;
            if published {
                assert_eq!(bytes(&workspace)?, current, "{label}: resume rewrote");
                assert_eq!(verified_before.as_ref(), Some(receipt), "{label}");
            }
            assert_eq!(state.schema_uuid(), initial.schema_uuid(), "{label}: uuid");
            assert_eq!(receipt.schema_uuid(), initial.schema_uuid(), "{label}");
            assert_eq!(receipt.envelope().rdf_write_profile(), profile, "{label}");
            assert_eq!(
                receipt.store_directory(),
                attempt_path(&workspace, 0).join("store"),
                "{label}: winning attempt"
            );
            assert_eq!(
                receipt.fingerprint(),
                envelope_checksum(RECEIPT_MAGIC, &expected),
                "{label}: fingerprint"
            );
            assert_eq!(
                &SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?,
                receipt,
                "{label}"
            );
            let mut end = bytes(&workspace)?;
            assert_eq!(
                end.remove(Path::new(COMPLETE)).as_deref(),
                Some(expected.as_slice()),
                "{label}: final COMPLETE"
            );
            assert_eq!(end, before_workspace, "{label}: final workspace");
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            assert_eq!(fs::read(workspace.join(JOURNAL))?, journal, "{label}");
            assert_eq!(shape(&journal)?, sealed_shape, "{label}");
            assert!(!attempt_path(&workspace, 1).exists(), "{label}: attempt 1");
            assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
            assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
        }
    }
    Ok(())
}

#[test]
fn resume_publication_fsync_process_helper() -> TestResult {
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
    // Only the shim's exact-path fsync yields EIO. A sealed workspace skips both
    // build blocks, so phases are empty before fault(8), [8, 9] after the rename.
    let passed = match (mode.as_str(), &result) {
        ("pending" | "dir-before", Err(BackupError::Io(error))) => {
            error.raw_os_error() == Some(libc::EIO) && phases.is_empty()
        }
        ("dir-after", Err(BackupError::CompletionIndeterminate(error))) => {
            error.raw_os_error() == Some(libc::EIO) && phases == [8, 9]
        }
        ("control", Ok(state)) => state.receipt().is_some() && phases == [8, 9],
        _ => false,
    };
    if passed {
        Ok(())
    } else {
        Err(format!("mode {mode}: unexpected result {result:?}, phases {phases:?}").into())
    }
}

/// Independent shim control: the ordinal counts only exact-path matches, shared
/// across fsync and fdatasync; absent, zero and invalid values keep the old or
/// never-inject behavior.
#[test]
fn resume_publication_fsync_shim_ordinal_control_counts_only_exact_matches() -> TestResult {
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_publication_fsync_control")?
    else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let exact = root_path.join("exact.bin");
    let other = root_path.join("other.bin");
    fs::write(&exact, b"exact")?;
    fs::write(&other, b"other")?;
    let cases: [(&str, Option<&str>, &str); 6] = [
        ("first", Some("1"), "first"),
        ("second", Some("2"), "second"),
        ("absent", None, "always"),
        ("zero", Some("0"), "none"),
        ("invalid", Some("abc"), "none"),
        ("empty", Some(""), "none"),
    ];
    for (label, ordinal, mode) in cases {
        let private_dir = tempfile::tempdir_in(&root_path)?;
        let private = private_dir.path().canonicalize()?;
        run_child(
            &shim,
            &exact,
            ordinal,
            "resume_publication_fsync_shim_control_helper",
            &[
                (VAR_FILE, exact.as_os_str()),
                (VAR_OTHER, other.as_os_str()),
                (VAR_CONTROL_MODE, OsStr::new(mode)),
            ],
            &private,
            label,
        )?;
    }
    Ok(())
}

#[test]
fn resume_publication_fsync_shim_control_helper() -> TestResult {
    let Some(exact) = std::env::var_os(VAR_FILE) else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let other = variable(VAR_OTHER)?;
    let mode = std::env::var(VAR_CONTROL_MODE)?;
    let eio = Some(libc::EIO);
    let expected: [Option<i32>; 3] = match mode.as_str() {
        "first" => [eio, None, None],
        "second" => [None, eio, None],
        "always" => [eio, eio, eio],
        "none" => [None; 3],
        other => return Err(format!("unexpected control mode {other:?}").into()),
    };
    let target = fs::File::open(&exact)?;
    let bystander = fs::File::open(other)?;
    let code = |result: io::Result<()>| result.err().map(|e| e.raw_os_error().unwrap_or(-1));
    let first = code(target.sync_all());
    // A non-matching path is never counted and never fails.
    bystander.sync_all()?;
    bystander.sync_data()?;
    let second = code(target.sync_data());
    let third = code(target.sync_all());
    let observed = [first, second, third];
    if observed == expected {
        Ok(())
    } else {
        Err(format!("mode {mode}: expected {expected:?}, observed {observed:?}").into())
    }
}
