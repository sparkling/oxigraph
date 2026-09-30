//! Real `EIO` from the JOURNAL `sync_all` of the abandoned-attempt FAILED
//! append in `resume_inner`. The child filter derives from this module's own
//! path, so it does not depend on the name the parent wiring chooses.
use super::*;
use std::ffi::OsStr;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

const VAR_SOURCE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_ABANDONED_FSYNC_TEST_SOURCE";
const VAR_PACKAGE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_ABANDONED_FSYNC_TEST_PACKAGE";
const VAR_WORKSPACE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_ABANDONED_FSYNC_TEST_WORKSPACE";
const VAR_RDF12: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_ABANDONED_FSYNC_TEST_RDF12";
const VAR_MODE: &str = "OXIGRAPH_SCHEMA_UPGRADE_RESUME_ABANDONED_FSYNC_TEST_MODE";
const HELPER: &str = "resume_abandoned_failed_journal_fsync_process_helper";
/// Three attempts admit the control branch's winning attempt 2. The limit is
/// bound into PLAN, so parent, child and recovery all use it unchanged.
const MAX_ATTEMPTS: usize = 3;

/// The libtest filter of one helper in this module, which never names the crate.
fn filter(name: &str) -> String {
    let module = module_path!();
    let path = module.split_once("::").map_or(module, |(_, rest)| rest);
    format!("{path}::{name}")
}

fn bounded_options(profile: SchemaRdfProfile) -> TestResult<SchemaUpgradeOptions> {
    let mut options = SchemaUpgradeOptions::new(profile);
    options.limits.max_attempts = NonZeroUsize::new(MAX_ATTEMPTS).ok_or("zero attempt limit")?;
    Ok(options)
}

/// Sends SIGTERM, waits a bounded grace, sends SIGKILL only if the child is
/// still running, and always reaps it before returning a diagnostic.
fn terminate(child: &mut Child, grace: Duration, poll: Duration) -> String {
    let term = match libc::pid_t::try_from(child.id()) {
        Ok(pid) => {
            #[expect(
                unsafe_code,
                reason = "kill signals an owned child that is not yet reaped"
            )]
            // SAFETY: the child is unreaped, so its pid still names this child process.
            let result = unsafe { libc::kill(pid, libc::SIGTERM) };
            if result == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        }
        Err(error) => Err(io::Error::other(error)),
    };
    let deadline = Instant::now() + grace;
    let exited = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(Ok(status)),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(poll),
            Ok(None) => break None,
            Err(error) => break Some(Err(error)),
        }
    };
    match exited {
        Some(Ok(status)) => format!("SIGTERM {term:?}, reaped {status:?} within grace"),
        other => {
            let killed = child.kill();
            let reaped = child.wait();
            format!("SIGTERM {term:?}, grace {other:?}, SIGKILL {killed:?}, reap {reaped:?}")
        }
    }
}

/// Runs one bounded child under the shim with a cleared, private environment.
/// Captures are read only after the child has been reaped.
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
    const GRACE: Duration = Duration::from_secs(10);
    const POLL: Duration = Duration::from_millis(20);
    const CAPTURE_LIMIT: u64 = 1 << 20;
    let stdout_path = private.join(format!("abandoned-fsync-{label}.stdout"));
    let stderr_path = private.join(format!("abandoned-fsync-{label}.stderr"));
    let captured = |path: &Path| -> TestResult<String> {
        let mut data = Vec::new();
        File::open(path)?
            .take(CAPTURE_LIMIT)
            .read_to_end(&mut data)?;
        Ok(String::from_utf8_lossy(&data).into_owned())
    };
    let mut command = Command::new(std::env::current_exe()?);
    command.arg("--exact").arg(filter(HELPER));
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
            Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL),
            Ok(None) => break Err(io::Error::new(io::ErrorKind::TimedOut, "deadline passed")),
            Err(error) => break Err(error),
        }
    };
    let status = match waited {
        Ok(status) => status,
        Err(error) => {
            // Never leave the child running or unreaped, whatever went wrong.
            let cleanup = terminate(&mut child, GRACE, POLL);
            return Err(format!(
                "{label}: child helper did not exit within {TIMEOUT:?} ({error}); {cleanup}, \
                 stdout {}, stderr {}",
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
        stdout.contains("running 1 test") && stdout.contains("test result: ok. 1 passed;"),
        "{label}: the --exact filter did not run and pass exactly one test: {stdout}"
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

/// Decoded (kind, attempt, inventory length) of every journal record.
fn shape(
    journal: &[u8],
    plan: &[u8],
    options: &SchemaUpgradeOptions,
) -> TestResult<Vec<(u8, u64, usize)>> {
    Ok(decode_records(journal, plan, options)?
        .iter()
        .map(|record| (record.kind, record.attempt, record.files.len()))
        .collect())
}

/// The first record chains from the PLAN checksum.
fn first_frame(plan: &[u8]) -> Vec<u8> {
    frame(
        &Record {
            kind: INTENT,
            attempt: 0,
            files: Vec::new(),
        },
        &envelope_checksum(PLAN_MAGIC, plan),
    )
}

/// Later records chain from the complete preceding encoded frame, length prefix
/// included, never from the PLAN trailer or a whole multi-frame journal.
fn next_frame(kind: u8, attempt: u64, files: Vec<BackupFile>, preceding: &[u8]) -> Vec<u8> {
    frame(
        &Record {
            kind,
            attempt,
            files,
        },
        &envelope_checksum(JOURNAL_MAGIC, preceding),
    )
}

/// Walks complete frames exactly as `append` does: frame count and last frame.
fn last_frame(journal: &[u8]) -> TestResult<(usize, Vec<u8>)> {
    let mut input = Decode(journal);
    let mut last: &[u8] = &[];
    let mut frames = 0_usize;
    while !input.0.is_empty() {
        let rest = input.0;
        input.blob(MAX_MANIFEST)?;
        last = &rest[..rest.len() - input.0.len()];
        frames += 1;
    }
    Ok((frames, last.to_vec()))
}

/// Real `EIO` from `fsync` on the JOURNAL `sync_all` inside the FAILED append
/// that abandons attempt 0, on both RDF profiles. The parent starts shimlessly
/// and cancels resume at `fault(0)`: INTENT(0) is appended but its attempt
/// directory is never created. The child resume then appends FAILED(0) before
/// any new INTENT or callback; ordinal 1 on the exact JOURNAL path fails that
/// sync, after the complete frame is written and before the in-memory records
/// update. The ordinal-3 control cancels at `fault(0)`: FAILED(0) is match 1
/// and INTENT(1) match 2, so cancellation prevents construction and later
/// appends. Ordinal 2 would fault the new INTENT and is unsuitable as control.
///
/// A failed fsync keeps page-cache bytes. Shimless recovery from INTENT(0),
/// FAILED(0) builds attempt 1 without a duplicate FAILED(0); from the control's
/// INTENT(1) it abandons attempt 1 and wins with attempt 2. Injected errno,
/// same-host visibility and recovery only; no power-loss or on-media claim.
#[test]
fn resume_abandoned_failed_journal_fsync_failure_preserves_inputs_and_recovers() -> TestResult {
    if !cfg!(target_os = "linux") || option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored")
    {
        return Ok(()); // Skipped infrastructure supplies no fault evidence.
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_abandoned_failed_fsync")? else {
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
    let cases = [("fail", "1"), ("control", "3")];
    for profile in [SchemaRdfProfile::Rdf11, SchemaRdfProfile::Rdf12] {
        for (mode, ordinal) in cases {
            let control = mode == "control";
            let rdf12 = profile == SchemaRdfProfile::Rdf12;
            let label = format!("{mode}-{}", if rdf12 { "rdf12" } else { "rdf11" });
            let options = bounded_options(profile)?;
            let holder = tempfile::tempdir_in(&root_path)?;
            let workspace = holder.path().canonicalize()?.join("workspace");
            let private_dir = tempfile::tempdir_in(&root_path)?;
            let private = private_dir.path().canonicalize()?;
            let attempts = workspace.join("attempts");
            let journal_path = workspace.join(JOURNAL);
            let plan_path = workspace.join(PLAN);

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
            let plan = fs::read(&plan_path)?;
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
            check_inputs(&label)?;

            // Production appends INTENT(0) before fault(0) and creates the
            // attempt directory only afterwards.
            let mut phases = Vec::new();
            let abandoned = resume_inner(&source, &package, &workspace, &options, |phase| {
                phases.push(phase);
                if phase == 0 {
                    Err(BackupError::Cancelled)
                } else {
                    Ok(())
                }
            });
            assert!(
                matches!(&abandoned, Err(BackupError::Cancelled)),
                "{label}: phase 0 was not reached: {abandoned:?}"
            );
            assert_eq!(phases, [0], "{label}: preparation phases");
            let intent0 = first_frame(&plan);
            let prepared = fs::read(&journal_path)?;
            assert_eq!(prepared, intent0, "{label}: prepared JOURNAL");
            assert_eq!(
                shape(&prepared, &plan, &options)?,
                vec![(INTENT, 0_u64, 0_usize)],
                "{label}: prepared records"
            );
            assert_eq!(fs::read(&plan_path)?, plan, "{label}: plan changed");
            assert!(names(&attempts)?.is_empty(), "{label}: prepared attempts");
            assert!(
                !attempt_path(&workspace, 0).exists(),
                "{label}: prepared attempt 0"
            );
            assert!(
                !workspace.join(PENDING).exists(),
                "{label}: prepared PENDING"
            );
            assert!(
                !workspace.join(COMPLETE).exists(),
                "{label}: prepared COMPLETE"
            );
            assert_eq!(
                names(&workspace)?,
                workspace_names(None),
                "{label}: prepared entries"
            );
            assert_eq!(
                fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(),
                0,
                "{label}: prepared lock"
            );
            check_inputs(&label)?;
            // No parent workspace lease survives into the child.
            drop(WorkspaceLease::acquire(&workspace)?);

            let failed0 = next_frame(FAILED, 0, Vec::new(), &intent0);
            let intent1 = next_frame(INTENT, 1, Vec::new(), &failed0);
            let mut visible_journal = intent0.clone();
            visible_journal.extend_from_slice(&failed0);
            let mut visible_shape = vec![(INTENT, 0_u64, 0_usize), (FAILED, 0, 0)];
            if control {
                visible_journal.extend_from_slice(&intent1);
                visible_shape.push((INTENT, 1, 0));
            }
            assert_eq!(
                shape(&visible_journal, &plan, &options)?,
                visible_shape,
                "{label}: expected child-visible journal"
            );
            let before_child = snapshot(&workspace)?;
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
            // The helper passed only on the exact result and phase vector.
            let journal = fs::read(&journal_path)?;
            assert_eq!(journal, visible_journal, "{label}: child-visible JOURNAL");
            assert_eq!(
                shape(&journal, &plan, &options)?,
                visible_shape,
                "{label}: child-visible records"
            );
            let (frames, last) = last_frame(&journal)?;
            assert_eq!(frames, visible_shape.len(), "{label}: frame count");
            assert_eq!(
                last.as_slice(),
                if control {
                    intent1.as_slice()
                } else {
                    failed0.as_slice()
                },
                "{label}: last complete frame"
            );
            let visible = snapshot(&workspace)?;
            let mut rest_after = visible.0.clone();
            assert_eq!(
                rest_after.remove(Path::new(JOURNAL)).as_deref(),
                Some(visible_journal.as_slice()),
                "{label}: visible JOURNAL snapshot"
            );
            let mut rest_before = before_child.0.clone();
            assert_eq!(
                rest_before.remove(Path::new(JOURNAL)).as_deref(),
                Some(intent0.as_slice()),
                "{label}: prepared JOURNAL snapshot"
            );
            assert_eq!(rest_after, rest_before, "{label}: only JOURNAL may change");
            assert_eq!(
                visible.1, before_child.1,
                "{label}: child changed directories"
            );
            assert!(names(&attempts)?.is_empty(), "{label}: visible attempts");
            for attempt in 0..=3_u64 {
                assert!(
                    !attempt_path(&workspace, attempt).exists(),
                    "{label}: visible attempt {attempt}"
                );
            }
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            assert!(!workspace.join(COMPLETE).exists(), "{label}: COMPLETE");
            assert_eq!(
                names(&workspace)?,
                workspace_names(None),
                "{label}: visible entries"
            );
            assert_eq!(
                fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(),
                0,
                "{label}: visible lock"
            );

            let unpublished = SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options);
            assert!(
                matches!(&unpublished, Err(BackupError::InvalidManifest)),
                "{label}: unsealed verify gave {unpublished:?}"
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

            let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)
                .map_err(|error| format!("{label}: resume failed: {error:?}"))?;
            check_inputs(&label)?;
            let receipt = state
                .receipt()
                .ok_or("resume did not seal the workspace")?
                .clone();
            let winning: u64 = if control { 2 } else { 1 };
            let winning_name = format!("{winning:016}");
            let winning_path = attempt_path(&workspace, winning);
            assert_eq!(
                fs::read(winning_path.join("store").join(UPGRADE_GUARD))?,
                GUARD,
                "{label}: complete guard"
            );
            let inventory = tree(&winning_path, &options, Instant::now())?;
            assert!(!inventory.is_empty(), "{label}: winning inventory");
            assert!(
                inventory.iter().any(|file| file.size() > 0),
                "{label}: nonempty output"
            );
            // Each later frame chains from the complete preceding encoded frame.
            let mut later = Vec::new();
            if control {
                later.push((FAILED, 1_u64, Vec::new()));
                later.push((INTENT, 2, Vec::new()));
            } else {
                later.push((INTENT, 1_u64, Vec::new()));
            }
            later.push((VALIDATED, winning, inventory.clone()));
            later.push((SEALED, winning, Vec::new()));
            let mut final_journal = visible_journal.clone();
            let mut previous = last.clone();
            for (kind, attempt, files) in later {
                let encoded = next_frame(kind, attempt, files, &previous);
                final_journal.extend_from_slice(&encoded);
                previous = encoded;
            }
            let recovered = fs::read(&journal_path)?;
            assert!(
                recovered.starts_with(&visible_journal),
                "{label}: child-visible prefix"
            );
            assert_eq!(recovered, final_journal, "{label}: final JOURNAL");
            let records = decode_records(&recovered, &plan, &options)?;
            let expected_records = if control {
                vec![
                    (INTENT, 0_u64),
                    (FAILED, 0),
                    (INTENT, 1),
                    (FAILED, 1),
                    (INTENT, 2),
                    (VALIDATED, 2),
                    (SEALED, 2),
                ]
            } else {
                vec![
                    (INTENT, 0_u64),
                    (FAILED, 0),
                    (INTENT, 1),
                    (VALIDATED, 1),
                    (SEALED, 1),
                ]
            };
            assert_eq!(
                records
                    .iter()
                    .map(|record| (record.kind, record.attempt))
                    .collect::<Vec<_>>(),
                expected_records,
                "{label}: final records"
            );
            assert!(
                records
                    .iter()
                    .all(|record| (record.kind == VALIDATED) != record.files.is_empty()),
                "{label}: only VALIDATED carries an inventory"
            );
            assert!(
                records
                    .iter()
                    .filter(|record| record.kind == VALIDATED)
                    .all(|record| record.files == inventory),
                "{label}: VALIDATED inventory"
            );
            assert_eq!(
                records
                    .iter()
                    .filter(|record| record.kind == FAILED && record.attempt == 0)
                    .count(),
                1,
                "{label}: duplicate FAILED(0)"
            );
            // Canonical completion bytes, independent of receipt_bytes/make_receipt.
            let mut expected_receipt = RECEIPT_MAGIC.to_vec();
            expected_receipt.extend_from_slice(&envelope_checksum(PLAN_MAGIC, &plan));
            expected_receipt.extend_from_slice(&envelope_checksum(JOURNAL_MAGIC, &final_journal));
            let checksum = envelope_checksum(RECEIPT_MAGIC, &expected_receipt);
            expected_receipt.extend_from_slice(&checksum);
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
                state.directory(),
                workspace.as_path(),
                "{label}: state directory"
            );
            assert_eq!(
                receipt.directory(),
                workspace.as_path(),
                "{label}: receipt directory"
            );
            assert_eq!(
                receipt.schema_uuid(),
                initial.schema_uuid(),
                "{label}: receipt UUID"
            );
            assert_eq!(
                receipt.envelope(),
                initial.envelope(),
                "{label}: receipt envelope"
            );
            assert_eq!(
                receipt.envelope().rdf_write_profile(),
                profile,
                "{label}: receipt profile"
            );
            assert_eq!(
                receipt.store_directory(),
                winning_path.join("store"),
                "{label}: winning attempt"
            );
            assert_eq!(
                receipt.backup_fingerprint(),
                backup.fingerprint(),
                "{label}: backup fingerprint"
            );
            assert_eq!(
                receipt.fingerprint(),
                envelope_checksum(RECEIPT_MAGIC, &expected_receipt),
                "{label}: receipt fingerprint"
            );
            assert_eq!(fs::read(&plan_path)?, plan, "{label}: final PLAN");
            assert_eq!(
                names(&attempts)?,
                vec![winning_name.clone()],
                "{label}: final attempts"
            );
            for attempt in (0..=3_u64).filter(|attempt| *attempt != winning) {
                assert!(
                    !attempt_path(&workspace, attempt).exists(),
                    "{label}: final attempt {attempt}"
                );
            }
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
            let winning_relative = Path::new("attempts").join(&winning_name);
            let mut rest_completed: BTreeMap<PathBuf, Vec<u8>> = completed
                .0
                .iter()
                .filter(|(path, _)| !path.starts_with(&winning_relative))
                .map(|(path, data)| (path.clone(), data.clone()))
                .collect();
            assert_eq!(
                rest_completed.remove(Path::new(COMPLETE)).as_deref(),
                Some(expected_receipt.as_slice()),
                "{label}: canonical COMPLETE"
            );
            assert_eq!(
                rest_completed.remove(Path::new(JOURNAL)).as_deref(),
                Some(final_journal.as_slice()),
                "{label}: final JOURNAL snapshot"
            );
            assert_eq!(
                rest_completed, rest_after,
                "{label}: recovery changed other file bytes"
            );
            let directories: Vec<PathBuf> = completed
                .1
                .iter()
                .filter(|path| !path.starts_with(&winning_relative))
                .cloned()
                .collect();
            assert_eq!(
                directories, visible.1,
                "{label}: recovery changed other directories"
            );
            assert_eq!(
                SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?,
                receipt,
                "{label}: independent receipt verification"
            );
            assert_eq!(
                snapshot(&workspace)?,
                completed,
                "{label}: final verify changed workspace"
            );
            check_inputs(&label)?;
            let repeated = Store::resume_schema_upgrade(&source, &package, &workspace, &options)
                .map_err(|error| format!("{label}: completed resume failed: {error:?}"))?;
            assert_eq!(
                repeated.receipt(),
                Some(&receipt),
                "{label}: completed resume receipt"
            );
            assert_eq!(
                repeated.schema_uuid(),
                initial.schema_uuid(),
                "{label}: completed resume UUID"
            );
            assert_eq!(
                snapshot(&workspace)?,
                completed,
                "{label}: completed resume changed workspace"
            );
            check_inputs(&label)?;
        }
    }
    Ok(())
}

#[test]
fn resume_abandoned_failed_journal_fsync_process_helper() -> TestResult {
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
        if control { "3" } else { "1" },
        "unexpected matching-call ordinal"
    );
    let options = bounded_options(profile)?;
    let plan = fs::read(workspace.join(PLAN))?;
    assert_eq!(
        fs::read(workspace.join(JOURNAL))?,
        first_frame(&plan),
        "helper requires an INTENT(0)-only journal"
    );
    assert!(
        names(&workspace.join("attempts"))?.is_empty(),
        "helper requires no attempts"
    );
    let mut phases = Vec::new();
    let result = resume_inner(&source, &package, &workspace, &options, |phase| {
        phases.push(phase);
        if control && phase == 0 {
            Err(BackupError::Cancelled)
        } else {
            Ok(())
        }
    });
    // FAILED(0) is appended before INTENT(1) and before any callback: the
    // failure sees no phase; the control passes both syncs and stops at 0.
    let expected: &[u8] = if control { &[0] } else { &[] };
    assert_eq!(
        phases, expected,
        "mode {mode}: unexpected phases for result {result:?}"
    );
    match (control, &result) {
        (false, Err(BackupError::Io(error))) if error.raw_os_error() == Some(libc::EIO) => Ok(()),
        (true, Err(BackupError::Cancelled)) => Ok(()),
        _ => Err(format!("mode {mode}: unexpected result {result:?}, phases {phases:?}").into()),
    }
}
