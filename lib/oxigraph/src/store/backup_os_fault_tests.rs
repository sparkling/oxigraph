//! Three injected OS faults at receipt publication (not a full crash matrix, not power loss; errno typing and visible state only).
#![expect(clippy::panic_in_result_fn, reason = "isolated OS fault fixtures")]
use super::*;
use crate::model::{GraphName, NamedNode, Quad};
use std::collections::HashSet;
use std::process::{Command, Stdio};
use std::time::Duration;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

const CHILD_LIMIT: Duration = Duration::from_secs(120);

const SHIM: &str = r#"
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static int fd_is(int fd, const char *want, char *target, size_t cap) {
    char link[64];
    ssize_t n;
    if (want == NULL || want[0] == '\0') return 0;
    if (snprintf(link, sizeof link, "/proc/self/fd/%d", fd) <= 0) return 0;
    n = readlink(link, target, cap - 1);
    if (n <= 0) return 0;
    target[n] = '\0';
    return strcmp(target, want) == 0;
}

static void note(const char *what, int err, const char *path) {
    const char *log = getenv("OXIGRAPH_FAULT_LOG");
    char line[4200];
    int n;
    int fd;
    if (log == NULL) return;
    n = snprintf(line, sizeof line, "%s errno=%d path=%s\n", what, err, path);
    if (n <= 0 || (size_t)n >= sizeof line) return;
    fd = open(log, O_WRONLY | O_APPEND);
    if (fd < 0) return;
    syscall(SYS_write, fd, line, (size_t)n);
    close(fd);
}

ssize_t write(int fd, const void *buf, size_t count) {
    char target[4096];
    int saved = errno;
    const char *want = getenv("OXIGRAPH_FAULT_WRITE_PATH");
    if (fd_is(fd, want, target, sizeof target)) {
        note("inject write", ENOSPC, target);
        errno = ENOSPC;
        return -1;
    }
    errno = saved;
    return (ssize_t)syscall(SYS_write, fd, buf, count);
}

int fsync(int fd) {
    char target[4096];
    int saved = errno;
    const char *want = getenv("OXIGRAPH_FAULT_FSYNC_PATH");
    const char *need = getenv("OXIGRAPH_FAULT_FSYNC_REQUIRE");
    if (fd_is(fd, want, target, sizeof target)) {
        if (need != NULL && need[0] != '\0' && access(need, F_OK) != 0) {
            note("skip fsync-require-manifest", 0, target);
            errno = saved;
            return (int)syscall(SYS_fsync, fd);
        }
        note("inject fsync", EIO, target);
        errno = EIO;
        return -1;
    }
    errno = saved;
    return (int)syscall(SYS_fsync, fd);
}
"#;

fn enabled() -> bool {
    option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") == Some("vendored")
}

/// The libtest filter of one helper `#[test]`, which never names the crate.
fn helper(name: &str) -> String {
    let module = module_path!();
    let path = module.split_once("::").map_or(module, |(_, rest)| rest);
    format!("{path}::{name}")
}

/// Waits for an owned child up to `limit`; on expiry kills it, always reaps it
/// (even if the kill fails) and reports `TimedOut`.
fn wait_bounded(child: &mut std::process::Child, limit: Duration) -> io::Result<Option<i32>> {
    let deadline = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.code()),
            Ok(None) => {}
            Err(error) => {
                // Best-effort cleanup; the original wait error is reported.
                drop(child.kill());
                drop(child.wait());
                return Err(error);
            }
        }
        if Instant::now() >= deadline {
            let killed = child.kill();
            let reaped = child.wait();
            killed?;
            reaped?;
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "child exceeded its deadline and was killed",
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn scratch() -> TestResult<tempfile::TempDir> {
    let exe = std::env::current_exe()?;
    let parent = exe.parent().ok_or("test binary has no parent directory")?;
    Ok(tempfile::Builder::new()
        .prefix("oxigraph-os-fault-")
        .tempdir_in(parent)?)
}

#[expect(
    clippy::print_stderr,
    reason = "diagnostic for a host without a C compiler, opt-in test infrastructure only"
)]
fn compile_shim(directory: &Path) -> TestResult<Option<PathBuf>> {
    let source = directory.join("fault_shim.c");
    fs::write(&source, SHIM)?;
    let object = directory.join("fault_shim.so");
    let output = match Command::new("cc")
        .args(["-shared", "-fPIC", "-O2", "-o"])
        .arg(&object)
        .arg(&source)
        .stdin(Stdio::null())
        .output()
    {
        Ok(output) => output,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            eprintln!("skipping OS fault coverage: no `cc` on this host");
            return Ok(None);
        }
        Err(error) => return Err(error.into()),
    };
    if !output.status.success() {
        return Err(format!(
            "cc failed with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(Some(object))
}

struct Fixture {
    _directory: tempfile::TempDir,
    root: PathBuf,
    source: PathBuf,
    before: BackupCheckpoint,
    quads: HashSet<Quad>,
}

fn source_quads(source: &Path) -> Result<HashSet<Quad>, StorageError> {
    let store = Store::open_read_only(source)?;
    store.iter().collect()
}

fn make_fixture() -> TestResult<Fixture> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().canonicalize()?;
    let source = root.join("source");
    {
        let store = Store::open(&source)?;
        let node = NamedNode::new_unchecked("urn:backup:os-fault");
        store.insert(Quad::new(
            node.clone(),
            node.clone(),
            node,
            GraphName::DefaultGraph,
        ))?;
    }
    let before = Store::open_read_only(&source)?.backup_checkpoint()?.0;
    let quads = source_quads(&source)?;
    assert_eq!(quads.len(), 1, "fixture must hold exactly one quad");
    Ok(Fixture {
        _directory: directory,
        root,
        source,
        before,
        quads,
    })
}

fn assert_source_preserved(fixture: &Fixture) -> TestResult {
    let store = Store::open_read_only(&fixture.source)?;
    assert_eq!(
        store.backup_checkpoint()?.0,
        fixture.before,
        "source checkpoint changed"
    );
    assert_eq!(store.len()?, 1, "source length changed");
    drop(store);
    assert_eq!(
        source_quads(&fixture.source)?,
        fixture.quads,
        "source quads changed"
    );
    Ok(())
}

fn found_names(directory: &Path) -> io::Result<Vec<String>> {
    let mut found = Vec::new();
    for entry in fs::read_dir(directory)? {
        found.push(entry?.file_name().to_string_lossy().into_owned());
    }
    found.sort();
    Ok(found)
}

fn sorted(values: &[&str]) -> Vec<String> {
    let mut names: Vec<String> = values.iter().map(|value| (*value).to_owned()).collect();
    names.sort();
    names
}

fn read_if_exists(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn assert_same_path_retry_refused(fixture: &Fixture, destination: &Path) -> TestResult {
    let names_before = found_names(destination)?;
    let pending_before = read_if_exists(&destination.join(PENDING))?;
    let manifest_before = read_if_exists(&destination.join(MANIFEST))?;
    let store = Store::open(&fixture.source)?;
    let retry = store.backup_with_receipt(destination, &BackupOptions::default());
    assert!(
        matches!(retry, Err(BackupError::InvalidPath)),
        "same-path retry was not refused: {retry:?}"
    );
    drop(store);
    assert_eq!(
        found_names(destination)?,
        names_before,
        "retry mutated the destination listing"
    );
    assert_eq!(
        read_if_exists(&destination.join(PENDING))?,
        pending_before,
        "retry mutated the pending bytes"
    );
    assert_eq!(
        read_if_exists(&destination.join(MANIFEST))?,
        manifest_before,
        "retry mutated the manifest bytes"
    );
    Ok(())
}

fn assert_fresh_retry_succeeds(fixture: &Fixture, name: &str) -> TestResult {
    let destination = fixture.root.join(name);
    let store = Store::open(&fixture.source)?;
    let receipt = store.backup_with_receipt(&destination, &BackupOptions::default())?;
    drop(store);
    assert_eq!(
        BackupReceipt::verify(&destination, &TransactionStartControl::new())?,
        receipt,
        "fresh retry did not verify to its receipt"
    );
    assert_eq!(
        receipt.checkpoint(),
        &fixture.before,
        "fresh retry checkpoint differs from the source"
    );
    assert_eq!(receipt.contents().quads(), 1, "fresh retry lost the quad");
    Ok(())
}

struct Injection {
    case: &'static str,
    write: Option<PathBuf>,
    fsync: Option<PathBuf>,
    require: Option<PathBuf>,
}

struct Outcome {
    result: String,
    log: Vec<String>,
}

fn run_child(
    scratch: &Path,
    shim: &Path,
    fixture: &Fixture,
    destination: &Path,
    injection: &Injection,
) -> TestResult<Outcome> {
    let log = scratch.join("fault.log");
    let result = scratch.join("result");
    let stdout = scratch.join("child.stdout");
    let stderr = scratch.join("child.stderr");
    File::create(&log)?;
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("os_fault_backup_helper"))
        .env("LD_PRELOAD", shim)
        .env("OXIGRAPH_FAULT_LOG", &log)
        .env("OXIGRAPH_OS_FAULT_CASE", injection.case)
        .env("OXIGRAPH_OS_FAULT_SOURCE", &fixture.source)
        .env("OXIGRAPH_OS_FAULT_DESTINATION", destination)
        .env("OXIGRAPH_OS_FAULT_RESULT", &result)
        .stdin(Stdio::null())
        .stdout(File::create(&stdout)?)
        .stderr(File::create(&stderr)?);
    if let Some(path) = &injection.write {
        command.env("OXIGRAPH_FAULT_WRITE_PATH", path);
    }
    if let Some(path) = &injection.fsync {
        command.env("OXIGRAPH_FAULT_FSYNC_PATH", path);
    }
    if let Some(path) = &injection.require {
        command.env("OXIGRAPH_FAULT_FSYNC_REQUIRE", path);
    }
    let mut child = command.spawn()?;
    let code = wait_bounded(&mut child, CHILD_LIMIT)?;
    let stdout_text = String::from_utf8_lossy(&fs::read(&stdout)?).into_owned();
    let stderr_text = String::from_utf8_lossy(&fs::read(&stderr)?).into_owned();
    assert_eq!(
        code,
        Some(0),
        "child helper failed: stdout {stdout_text}, stderr {stderr_text}"
    );
    assert!(
        stdout_text.contains("running 1 test"),
        "the --exact filter did not select exactly one test: {stdout_text}"
    );
    assert!(
        stdout_text.contains("... ok"),
        "the selected helper did not report ok: {stdout_text}"
    );
    let result_line = fs::read_to_string(&result)?;
    let log_text = fs::read_to_string(&log)?;
    Ok(Outcome {
        result: result_line,
        log: log_text.lines().map(str::to_owned).collect(),
    })
}

fn required(name: &str) -> TestResult<PathBuf> {
    let Some(value) = std::env::var_os(name) else {
        return Err(format!("{name} was not passed by the parent test").into());
    };
    Ok(value.into())
}

#[test]
fn os_fault_backup_helper() -> TestResult {
    let Some(case) = std::env::var_os("OXIGRAPH_OS_FAULT_CASE") else {
        return Ok(()); // An ordinary run: only the parent tests re-invoke this.
    };
    let case = case.into_string().map_err(|_| "the case is not UTF-8")?;
    let source = required("OXIGRAPH_OS_FAULT_SOURCE")?;
    let destination = required("OXIGRAPH_OS_FAULT_DESTINATION")?;
    let result = required("OXIGRAPH_OS_FAULT_RESULT")?;
    let store = Store::open(&source)?;
    let outcome = store.backup_with_receipt(&destination, &BackupOptions::default());
    let line = match (case.as_str(), outcome) {
        ("pending_write", Err(BackupError::Io(error)))
            if error.raw_os_error() == Some(libc::ENOSPC)
                && error.kind() == io::ErrorKind::StorageFull =>
        {
            "Io ENOSPC"
        }
        ("pending_fsync", Err(BackupError::Io(error)))
            if error.raw_os_error() == Some(libc::EIO) =>
        {
            "Io EIO"
        }
        ("publication_dir_fsync", Err(BackupError::CompletionIndeterminate(error)))
            if error.raw_os_error() == Some(libc::EIO) =>
        {
            "CompletionIndeterminate EIO"
        }
        (other_case, other) => {
            return Err(format!("case {other_case}: unexpected outcome {other:?}").into());
        }
    };
    fs::write(result, line)?;
    Ok(())
}

#[test]
fn pending_manifest_write_enospc_leaves_empty_pending_and_no_receipt() -> TestResult {
    if !enabled() {
        return Ok(());
    }
    let scratch = scratch()?;
    let Some(shim) = compile_shim(scratch.path())? else {
        return Ok(());
    };
    let fixture = make_fixture()?;
    let destination = fixture.root.join("backup");
    let pending = destination.join(PENDING);
    let outcome = run_child(
        scratch.path(),
        &shim,
        &fixture,
        &destination,
        &Injection {
            case: "pending_write",
            write: Some(pending.clone()),
            fsync: None,
            require: None,
        },
    )?;
    assert_eq!(outcome.result, "Io ENOSPC", "wrong typed outcome");
    assert_eq!(
        outcome.log,
        [format!(
            "inject write errno={} path={}",
            libc::ENOSPC,
            pending.display()
        )],
        "the shim did not log exactly one pending write injection"
    );
    assert_eq!(
        found_names(&destination)?,
        sorted(&["contributors", PENDING, "store"]),
        "unexpected destination contents"
    );
    assert_eq!(
        fs::metadata(&pending)?.len(),
        0,
        "the failed write must leave an empty pending file"
    );
    assert!(
        !destination.join(MANIFEST).exists(),
        "a manifest was published"
    );
    assert!(
        BackupReceipt::verify(&destination, &TransactionStartControl::new()).is_err(),
        "the incomplete package verified"
    );
    assert_source_preserved(&fixture)?;
    assert_same_path_retry_refused(&fixture, &destination)?;
    assert_fresh_retry_succeeds(&fixture, "retry")?;
    assert!(
        BackupReceipt::verify(&destination, &TransactionStartControl::new()).is_err(),
        "the failed destination became verifiable"
    );
    Ok(())
}

#[test]
fn pending_file_fsync_eio_leaves_unpublished_pending_and_no_receipt() -> TestResult {
    if !enabled() {
        return Ok(());
    }
    let scratch = scratch()?;
    let Some(shim) = compile_shim(scratch.path())? else {
        return Ok(());
    };
    let fixture = make_fixture()?;
    let destination = fixture.root.join("backup");
    let pending = destination.join(PENDING);
    let outcome = run_child(
        scratch.path(),
        &shim,
        &fixture,
        &destination,
        &Injection {
            case: "pending_fsync",
            write: None,
            fsync: Some(pending.clone()),
            require: None,
        },
    )?;
    assert_eq!(outcome.result, "Io EIO", "wrong typed outcome");
    assert_eq!(
        outcome.log,
        [format!(
            "inject fsync errno={} path={}",
            libc::EIO,
            pending.display()
        )],
        "the shim did not log exactly one pending fsync injection"
    );
    assert_eq!(
        found_names(&destination)?,
        sorted(&["contributors", PENDING, "store"]),
        "unexpected destination contents"
    );
    assert!(
        !destination.join(MANIFEST).exists(),
        "a manifest was published"
    );
    assert!(
        BackupReceipt::verify(&destination, &TransactionStartControl::new()).is_err(),
        "the incomplete package verified"
    );
    let pending_bytes = fs::read(&pending)?;
    assert!(
        !pending_bytes.is_empty(),
        "the write must have reached the kernel before the failed sync"
    );
    let decoded = BackupReceipt::decode(&pending_bytes)?;
    assert_eq!(
        decoded.checkpoint(),
        &fixture.before,
        "pending checkpoint differs from the source"
    );
    assert_eq!(decoded.contents().quads(), 1, "pending lost the quad");
    assert_source_preserved(&fixture)?;
    assert_same_path_retry_refused(&fixture, &destination)?;
    assert_fresh_retry_succeeds(&fixture, "retry")?;
    assert!(
        BackupReceipt::verify(&destination, &TransactionStartControl::new()).is_err(),
        "the failed destination became verifiable"
    );
    Ok(())
}

#[test]
fn final_publication_directory_fsync_eio_is_typed_completion_indeterminate() -> TestResult {
    if !enabled() {
        return Ok(());
    }
    let scratch = scratch()?;
    let Some(shim) = compile_shim(scratch.path())? else {
        return Ok(());
    };
    let fixture = make_fixture()?;
    let destination = fixture.root.join("backup");
    let manifest = destination.join(MANIFEST);
    let outcome = run_child(
        scratch.path(),
        &shim,
        &fixture,
        &destination,
        &Injection {
            case: "publication_dir_fsync",
            write: None,
            fsync: Some(destination.clone()),
            require: Some(manifest.clone()),
        },
    )?;
    assert_eq!(
        outcome.result, "CompletionIndeterminate EIO",
        "an earlier or different failure was reported"
    );
    let inject = format!(
        "inject fsync errno={} path={}",
        libc::EIO,
        destination.display()
    );
    let skip = format!(
        "skip fsync-require-manifest errno=0 path={}",
        destination.display()
    );
    let (last, earlier) = outcome.log.split_last().ok_or("the shim logged nothing")?;
    assert_eq!(last, &inject, "the final log line is not the injection");
    assert!(
        !earlier.is_empty(),
        "the pre-publication directory sync was never observed and skipped"
    );
    assert!(
        earlier.iter().all(|line| *line == skip),
        "an injection happened before the manifest was visible: {earlier:?}"
    );
    assert_eq!(
        found_names(&destination)?,
        sorted(&["contributors", MANIFEST, "store"]),
        "unexpected destination contents"
    );
    let verified = BackupReceipt::verify(&destination, &TransactionStartControl::new())?;
    assert_eq!(
        verified.checkpoint(),
        &fixture.before,
        "published checkpoint differs from the source"
    );
    assert_eq!(
        verified.contents().quads(),
        1,
        "published receipt lost the quad"
    );
    assert_eq!(
        fs::read(&manifest)?,
        verified.encode(),
        "manifest bytes differ from the verified receipt"
    );
    assert_source_preserved(&fixture)?;
    assert_same_path_retry_refused(&fixture, &destination)?;
    assert_eq!(
        BackupReceipt::verify(&destination, &TransactionStartControl::new())?,
        verified,
        "the published package changed after the refused retry"
    );
    Ok(())
}

#[test]
fn file_local_wait_kills_and_reaps_a_sleeping_child() -> TestResult {
    use std::os::unix::process::ExitStatusExt;
    let mut child = Command::new(std::env::current_exe()?)
        .arg("--exact")
        .arg("store::backup::tests::receipt_backup_sleep_helper")
        .env("OXIGRAPH_RECEIPT_BACKUP_TEST_SLEEP", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .spawn()?;
    let started = Instant::now();
    let error = wait_bounded(&mut child, Duration::from_millis(200))
        .err()
        .ok_or("a sleeping child was reported as exited")?;
    assert_eq!(error.kind(), io::ErrorKind::TimedOut, "{error}");
    assert!(
        started.elapsed() < Duration::from_secs(30),
        "the bounded wait did not honor its short deadline"
    );
    let status = child
        .try_wait()?
        .ok_or("the timed-out child was not reaped")?;
    assert_eq!(
        status.signal(),
        Some(9),
        "the timed-out child was not killed"
    );
    Ok(())
}
