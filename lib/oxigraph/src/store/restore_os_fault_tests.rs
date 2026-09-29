#![expect(
    clippy::panic_in_result_fn,
    reason = "isolated real-OS restore fault fixtures"
)]

use super::*;
use crate::model::{GraphName, NamedNode, Quad};
use crate::store::BackupOptions;
use std::collections::HashSet;
use std::fs::File;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::ExitStatusExt;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

const CHILD_LIMIT: Duration = Duration::from_secs(120);
const PASS_LINE: &str = "pass dir complete=absent";

// Stateless and thread-safe: no mutable globals, env read per call, raw syscalls
// for the real operation. Faults only the exact restore publication paths.
const SHIM_SOURCE: &str = r##"
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#define CAP 4096
#define PENDING_SUFFIX "/oxigraph-restore.pending"
#define COMPLETE_SUFFIX "/oxigraph-restore.complete"

static const char PASS[] = "pass dir complete=absent\n";

static void note(const char *line, size_t length) {
    const char *log = getenv("OXIGRAPH_RESTORE_OS_FAULT_LOG");
    if (log == NULL) return;
    int fd = open(log, O_WRONLY | O_APPEND | O_CLOEXEC);
    if (fd < 0) return;
    (void)syscall(SYS_write, fd, line, length);
    close(fd);
}

static void note_fault(const char *what, int error, const char *tail) {
    char line[256];
    int n = snprintf(line, sizeof line, "inject %s errno=%d%s\n", what, error, tail);
    if (n > 0 && (size_t)n < sizeof line) note(line, (size_t)n);
}

static int fd_is(int fd, const char *root, const char *suffix) {
    char link[64];
    char path[CAP];
    char want[CAP];
    int n = snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
    if (n <= 0 || (size_t)n >= sizeof link) return 0;
    ssize_t length = readlink(link, path, sizeof path - 1);
    if (length <= 0) return 0;
    path[length] = '\0';
    n = snprintf(want, sizeof want, "%s%s", root, suffix);
    if (n <= 0 || (size_t)n >= sizeof want) return 0;
    return strcmp(path, want) == 0;
}

ssize_t write(int fd, const void *buf, size_t count) {
    int saved = errno;
    const char *mode = getenv("OXIGRAPH_RESTORE_OS_FAULT_MODE");
    const char *root = getenv("OXIGRAPH_RESTORE_OS_FAULT_ROOT");
    if (mode != NULL && root != NULL && strcmp(mode, "pending-write") == 0 &&
        fd_is(fd, root, PENDING_SUFFIX)) {
        note_fault("pending-write", ENOSPC, "");
        errno = ENOSPC;
        return -1;
    }
    errno = saved;
    return (ssize_t)syscall(SYS_write, fd, buf, count);
}

int fsync(int fd) {
    int saved = errno;
    const char *mode = getenv("OXIGRAPH_RESTORE_OS_FAULT_MODE");
    const char *root = getenv("OXIGRAPH_RESTORE_OS_FAULT_ROOT");
    if (mode != NULL && root != NULL) {
        if (strcmp(mode, "pending-fsync") == 0 && fd_is(fd, root, PENDING_SUFFIX)) {
            note_fault("pending-fsync", EIO, "");
            errno = EIO;
            return -1;
        }
        if (strcmp(mode, "final-dir-fsync") == 0 && fd_is(fd, root, "")) {
            char complete[CAP];
            int n = snprintf(complete, sizeof complete, "%s%s", root, COMPLETE_SUFFIX);
            if (n > 0 && (size_t)n < sizeof complete && access(complete, F_OK) == 0) {
                note_fault("final-dir-fsync", EIO, " complete=visible");
                errno = EIO;
                return -1;
            }
            note(PASS, sizeof PASS - 1);
        }
    }
    errno = saved;
    return (int)syscall(SYS_fsync, fd);
}
"##;

fn vendored() -> bool {
    option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") == Some("vendored")
}

/// The libtest filter of one helper `#[test]`, which never names the crate.
fn helper(name: &str) -> String {
    let module = module_path!();
    let path = module.split_once("::").map_or(module, |(_, rest)| rest);
    format!("{path}::{name}")
}

fn top_level(directory: &Path) -> Result<Vec<String>, io::Error> {
    let mut names = Vec::new();
    for entry in fs::read_dir(directory)? {
        names.push(entry?.file_name().to_string_lossy().into_owned());
    }
    names.sort();
    Ok(names)
}

fn quads(directory: &Path) -> Result<HashSet<Quad>, StorageError> {
    let store = Store::open_read_only(directory)?;
    store.iter().collect()
}

fn bytes(root: &Path) -> TestResult<BTreeMap<PathBuf, Vec<u8>>> {
    fn visit(root: &Path, path: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) -> TestResult {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() {
                visit(root, &entry.path(), out)?;
            } else if kind.is_file() {
                out.insert(
                    entry.path().strip_prefix(root)?.to_owned(),
                    fs::read(entry.path())?,
                );
            } else {
                return Err(format!("unexpected entry {}", entry.path().display()).into());
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    visit(root, root, &mut out)?;
    Ok(out)
}

/// Narrows a fresh temporary directory to its owner. `tempfile` creates
/// directories with the umask-default mode, so this runs before any file is
/// written into it.
fn make_private(directory: &Path) -> TestResult {
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    assert_eq!(
        fs::metadata(directory)?.permissions().mode() & 0o077,
        0,
        "{} is not private",
        directory.display()
    );
    Ok(())
}

/// Waits up to `limit`; on expiry kills, always reaps, and reports `TimedOut`.
fn wait_bounded(child: &mut std::process::Child, limit: Duration) -> io::Result<ExitStatus> {
    let deadline = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(error) => {
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

/// Fails closed without a C compiler: a skipped fault would be vacuous.
fn compile_shim(directory: &Path) -> TestResult<PathBuf> {
    let source = directory.join("restore_os_fault_shim.c");
    let object = directory.join("restore_os_fault_shim.so");
    fs::write(&source, SHIM_SOURCE)?;
    let output = Command::new("cc")
        .arg("-shared")
        .arg("-fPIC")
        .arg("-O2")
        .arg("-o")
        .arg(&object)
        .arg(&source)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("cannot run C compiler `cc`: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "shim compilation failed: {} {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    let text = object.to_str().ok_or("shim path is not UTF-8")?;
    if text.contains([' ', ':']) {
        return Err("shim path is unusable in LD_PRELOAD".into());
    }
    Ok(object)
}

struct Fixture {
    source: PathBuf,
    package: PathBuf,
    expected: HashSet<Quad>,
    backup: BackupReceipt,
}

fn build_fixture(root: &Path) -> TestResult<Fixture> {
    let source_path = root.join("source");
    let package = root.join("backup");
    let node = NamedNode::new_unchecked("urn:restore:os-fault");
    let graph = NamedNode::new_unchecked("urn:restore:os-fault:graph");
    let (expected, backup) = {
        let source = Store::open(&source_path)?;
        source.insert(Quad::new(
            node.clone(),
            node.clone(),
            node.clone(),
            GraphName::DefaultGraph,
        ))?;
        source.insert(Quad::new(node.clone(), node, graph.clone(), graph))?;
        let expected = source
            .iter()
            .collect::<Result<HashSet<_>, StorageError>>()?;
        assert_eq!(expected.len(), 2, "fixture must be nonempty");
        let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
        (expected, backup)
    };
    Ok(Fixture {
        source: source_path,
        package,
        expected,
        backup,
    })
}

fn run_case(mode: &str) -> TestResult {
    if !vendored() {
        return Ok(());
    }
    let (inject, minimum_passes) = match mode {
        "pending-write" => (
            format!("inject pending-write errno={}", libc::ENOSPC),
            0_usize,
        ),
        "pending-fsync" => (format!("inject pending-fsync errno={}", libc::EIO), 0),
        "final-dir-fsync" => (
            format!(
                "inject final-dir-fsync errno={} complete=visible",
                libc::EIO
            ),
            2,
        ),
        other => return Err(format!("unknown fault mode {other}").into()),
    };
    let executable = std::env::current_exe()?;
    let executable_dir = executable
        .parent()
        .ok_or("test binary has no parent directory")?;
    // Next to the test binary, not in a possibly noexec temporary mount.
    let private = tempfile::Builder::new()
        .prefix("oxigraph-restore-os-fault-")
        .tempdir_in(executable_dir)?;
    let private_path = private.path().canonicalize()?;
    make_private(&private_path)?;
    let shim = compile_shim(&private_path)?;
    let directory = tempfile::tempdir()?;
    let root = directory.path().canonicalize()?;
    make_private(&root)?;
    let fixture = build_fixture(&root)?;
    let source_before = bytes(&fixture.source)?;
    let package_before = bytes(&fixture.package)?;
    let target = root.join(format!("restore-{mode}"));
    let log = private_path.join("injection.log");
    fs::write(&log, b"")?;
    let stdout_path = private_path.join("child.stdout");
    let stderr_path = private_path.join("child.stderr");
    let mut child = Command::new(&executable)
        .arg("--exact")
        .arg(helper("restore_os_fault_process_helper"))
        .arg("--nocapture")
        .env("LD_PRELOAD", &shim)
        .env("OXIGRAPH_RESTORE_OS_FAULT_MODE", mode)
        .env("OXIGRAPH_RESTORE_OS_FAULT_ROOT", &target)
        .env("OXIGRAPH_RESTORE_OS_FAULT_LOG", &log)
        .env("OXIGRAPH_RESTORE_OS_FAULT_PACKAGE", &fixture.package)
        .stdin(Stdio::null())
        .stdout(Stdio::from(File::create(&stdout_path)?))
        .stderr(Stdio::from(File::create(&stderr_path)?))
        .spawn()?;
    let status = wait_bounded(&mut child, CHILD_LIMIT)?;
    let stdout = String::from_utf8_lossy(&fs::read(&stdout_path)?).into_owned();
    let stderr = String::from_utf8_lossy(&fs::read(&stderr_path)?).into_owned();
    assert!(
        status.success(),
        "{mode}: child failed: {status:?} | stdout: {stdout} | stderr: {stderr}"
    );
    assert!(
        stdout.contains("running 1 test"),
        "{mode}: --exact did not select exactly one helper: {stdout}"
    );
    assert!(
        stdout.contains("1 passed"),
        "{mode}: helper did not pass: {stdout}"
    );

    let log_text = fs::read_to_string(&log)?;
    let lines: Vec<&str> = log_text.lines().collect();
    let injects = lines
        .iter()
        .filter(|line| line.starts_with("inject "))
        .count();
    assert_eq!(injects, 1, "{mode}: injection log {lines:?}");
    let (last, earlier) = lines.split_last().ok_or("the injection log is empty")?;
    assert_eq!(*last, inject.as_str(), "{mode}: injection log {lines:?}");
    assert!(
        earlier.iter().all(|line| *line == PASS_LINE),
        "{mode}: unexpected pass lines {lines:?}"
    );
    assert!(
        earlier.len() >= minimum_passes,
        "{mode}: earlier directory syncs were not observed {lines:?}"
    );

    let exists = |name: &str| fs::symlink_metadata(target.join(name)).is_ok();
    assert!(exists(SOURCE), "{mode}: source marker missing");
    assert!(
        !exists(BackupReceipt::manifest_name()),
        "{mode}: staged manifest remains"
    );
    let published = match mode {
        "pending-write" => {
            assert!(exists(PENDING), "{mode}: pending record missing");
            assert_eq!(
                fs::metadata(target.join(PENDING))?.len(),
                0,
                "{mode}: pending record has bytes"
            );
            assert!(!exists(COMPLETE), "{mode}: completion published");
            assert!(
                matches!(
                    RestoreReceipt::read(&target),
                    Err(RestoreError::InvalidReceipt)
                ),
                "{mode}: incomplete restore accepted"
            );
            None
        }
        "pending-fsync" => {
            assert!(exists(PENDING), "{mode}: pending record missing");
            let pending = fs::read(target.join(PENDING))?;
            assert!(!pending.is_empty(), "{mode}: pending record is empty");
            let decoded = RestoreReceipt::decode(&pending, fixture.backup.clone())?;
            assert_eq!(
                decoded.backup(),
                &fixture.backup,
                "{mode}: pending record binds another backup"
            );
            assert!(!exists(COMPLETE), "{mode}: completion published");
            assert!(
                matches!(
                    RestoreReceipt::read(&target),
                    Err(RestoreError::InvalidReceipt)
                ),
                "{mode}: unpublished record accepted"
            );
            None
        }
        _ => {
            assert!(exists(COMPLETE), "{mode}: completion not visible");
            assert!(!exists(PENDING), "{mode}: pending record remains");
            let receipt = RestoreReceipt::read(&target)?;
            assert_eq!(
                receipt.backup(),
                &fixture.backup,
                "{mode}: completion binds another backup"
            );
            Some(receipt)
        }
    };

    let listing = top_level(&target)?;
    let target_before = bytes(&target)?;
    let retry = Store::restore_backup(&fixture.package, &target, &RestoreOptions::default());
    assert!(
        matches!(retry, Err(RestoreError::Backup(BackupError::InvalidPath))),
        "{mode}: same-target retry was not refused: {retry:?}"
    );
    assert_eq!(
        top_level(&target)?,
        listing,
        "{mode}: retry changed the listing"
    );
    assert_eq!(
        bytes(&target)?,
        target_before,
        "{mode}: retry changed the target"
    );
    match &published {
        Some(receipt) => assert_eq!(
            &RestoreReceipt::read(&target)?,
            receipt,
            "{mode}: completion changed by retry"
        ),
        None => assert!(
            matches!(
                RestoreReceipt::read(&target),
                Err(RestoreError::InvalidReceipt)
            ),
            "{mode}: retry made the target readable"
        ),
    }

    assert_eq!(
        bytes(&fixture.package)?,
        package_before,
        "{mode}: package changed"
    );
    assert_eq!(
        BackupReceipt::verify(&fixture.package, &TransactionStartControl::new())?,
        fixture.backup,
        "{mode}: package no longer verifies"
    );
    assert_eq!(
        bytes(&fixture.source)?,
        source_before,
        "{mode}: source changed"
    );
    assert_eq!(
        quads(&fixture.source)?,
        fixture.expected,
        "{mode}: source quads changed"
    );
    if published.is_some() {
        assert_eq!(
            quads(&target.join("store"))?,
            fixture.expected,
            "{mode}: restored quads differ"
        );
    }
    Ok(())
}

#[test]
fn restore_pending_record_write_enospc_leaves_unpublished_empty_record() -> TestResult {
    run_case("pending-write")
}

#[test]
fn restore_pending_record_fsync_eio_leaves_valid_unpublished_record() -> TestResult {
    run_case("pending-fsync")
}

#[test]
fn restore_final_directory_fsync_eio_is_completion_indeterminate() -> TestResult {
    run_case("final-dir-fsync")
}

#[test]
fn bounded_child_wait_kills_and_reaps_a_sleeping_child() -> TestResult {
    let mut child = Command::new("sleep")
        .arg("60")
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

#[test]
fn restore_os_fault_process_helper() -> TestResult {
    if !vendored() {
        return Ok(());
    }
    let Some(package) = std::env::var_os("OXIGRAPH_RESTORE_OS_FAULT_PACKAGE") else {
        return Ok(()); // An ordinary run: only the parent tests re-invoke this.
    };
    let destination = std::env::var_os("OXIGRAPH_RESTORE_OS_FAULT_ROOT")
        .ok_or("the parent test passed no destination")?;
    let mode = std::env::var("OXIGRAPH_RESTORE_OS_FAULT_MODE")?;
    let result = Store::restore_backup(
        Path::new(&package),
        Path::new(&destination),
        &RestoreOptions::default(),
    );
    match (mode.as_str(), result) {
        ("pending-write", Err(RestoreError::Io(error)))
            if error.raw_os_error() == Some(libc::ENOSPC) =>
        {
            Ok(())
        }
        ("pending-fsync", Err(RestoreError::Io(error)))
            if error.raw_os_error() == Some(libc::EIO) =>
        {
            Ok(())
        }
        ("final-dir-fsync", Err(RestoreError::CompletionIndeterminate(error)))
            if error.raw_os_error() == Some(libc::EIO) =>
        {
            Ok(())
        }
        (mode, other) => Err(format!("mode {mode}: unexpected restore outcome {other:?}").into()),
    }
}
