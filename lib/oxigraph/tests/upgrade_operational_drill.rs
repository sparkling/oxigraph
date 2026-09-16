#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "operational-gate drill instrumentation"
)]

use oxigraph::store::{
    BackupFile, BackupOptions, LegacyBackupOptions, RestoreOptions, RestoreReceipt, Store,
    UpgradeOptions,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn supported() -> bool {
    cfg!(target_os = "linux") && option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") == Some("vendored")
}

fn fixture(version: u64, destination: &Path) -> TestResult {
    fs::create_dir_all(destination)?;
    let name = if version == 0 {
        "rocksdb_bc_data"
    } else {
        "rocksdb_bc_rdf_star_data"
    };
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(name);
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        fs::copy(entry.path(), destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn inventory(path: &Path) -> TestResult<BTreeMap<PathBuf, [u8; 32]>> {
    fn walk(root: &Path, directory: &Path, output: &mut BTreeMap<PathBuf, [u8; 32]>) -> TestResult {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                walk(root, &entry.path(), output)?;
            } else {
                output.insert(
                    entry.path().strip_prefix(root)?.to_owned(),
                    Sha256::digest(fs::read(entry.path())?).into(),
                );
            }
        }
        Ok(())
    }
    let mut output = BTreeMap::new();
    walk(path, path, &mut output)?;
    Ok(output)
}

/// Sums the bytes on disk under `path`.
///
/// `target`/`restore_target` are scanned while `activated`/`restored_store`
/// are still open, so a file `read_dir` lists can legitimately be gone by
/// the time it is stat'd: RocksDB may delete an obsolete WAL/OPTIONS file in
/// a background thread between the two calls. A `NotFound` at either the
/// file-type or metadata step is therefore not a real error for this
/// disk-usage proxy -- it contributes zero bytes, since the file is gone by
/// the time this measurement completes either way. Every other I/O error
/// still propagates.
fn directory_bytes(path: &Path) -> TestResult<u64> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let is_dir = match entry.file_type() {
            Ok(file_type) => file_type.is_dir(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if is_dir {
            total += directory_bytes(&entry.path())?;
        } else {
            match entry.metadata() {
                Ok(metadata) => total += metadata.len(),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(total)
}

/// The kernel-tracked peak resident set size of this process, in KiB, since
/// it started, or `None` if `/proc/self/status` could not be read or parsed.
/// This is a whole-process high-water mark, not a measurement isolated to
/// this one drill: `cargo test` runs every test in this binary (this file
/// has one ungated test plus one more gated behind the `rdf-12` feature) as
/// threads in one process, and libtest may run them concurrently.
/// Reading it after a drill therefore reports the peak RSS observed by that
/// point across whichever of this binary's tests have run so far, not this
/// drill's isolated contribution.
///
/// Best-effort and never fatal: this is pure instrumentation (no threshold
/// is asserted on it anywhere), so a read or parse failure here must never
/// fail the drill's own correctness assertions, whatever its cause.
fn peak_rss_kb() -> Option<u64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(value) = line.strip_prefix("VmHWM:") {
            return value.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

/// Runs the legacy-upgrade-then-operational-recovery journey once, measuring each
/// stage. The measurements are instrumentation only: no baseline exists yet, so
/// nothing here asserts a duration or a byte count.
fn drill(version: u64) -> TestResult {
    let root = tempfile::tempdir()?;
    let source = root.path().join("source");
    fixture(version, &source)?;
    let source_before = inventory(&source)?;

    let legacy_backup = root.path().join("legacy-backup");
    let started = Instant::now();
    let legacy_backup_receipt =
        Store::backup_legacy(&source, &legacy_backup, &LegacyBackupOptions::default())?;
    let backup_legacy_duration = started.elapsed();
    let legacy_logical_bytes: u64 = legacy_backup_receipt
        .files()
        .iter()
        .map(BackupFile::size)
        .sum();

    let workspace = root.path().join("workspace");
    let options = UpgradeOptions::default();
    let started = Instant::now();
    Store::upgrade(&source, &legacy_backup, &workspace, &options)?;
    let upgrade_duration = started.elapsed();

    let target = root.path().join("active");
    let started = Instant::now();
    let activation =
        Store::activate_upgrade(&source, &legacy_backup, &workspace, &target, &options)?;
    let cutover_duration = started.elapsed();
    assert!(activation.active());
    let activated = Store::open(&target)?;
    activated.validate()?;
    assert_eq!(activated.len()? as u64, activation.quad_count());

    // Rollback here means source preservation: the untouched legacy directory is
    // still byte-identical, so an operator can fall back to it.
    let started = Instant::now();
    let source_after = inventory(&source)?;
    assert_eq!(
        source_after, source_before,
        "the preserved source changed during the drill"
    );
    let rollback_duration = started.elapsed();

    let with_receipt_backup = root.path().join("with-receipt-backup");
    let started = Instant::now();
    let with_receipt_backup_receipt =
        activated.backup_with_receipt(&with_receipt_backup, &BackupOptions::default())?;
    let backup_with_receipt_duration = started.elapsed();
    let with_receipt_logical_bytes: u64 = with_receipt_backup_receipt
        .files()
        .iter()
        .map(BackupFile::size)
        .sum();

    let restore_target = root.path().join("restored");
    let restored = Store::restore_backup(
        &with_receipt_backup,
        &restore_target,
        &RestoreOptions::default(),
    )?;
    let restore_duration: Duration = restored.restore_duration();
    let restored_store = Store::open(restore_target.join(RestoreReceipt::store_directory()))?;
    restored_store.validate()?;
    assert_eq!(restored_store.len()? as u64, activation.quad_count());

    // Every directory the drill produced still exists, so these are
    // measured figures for this run rather than an estimate -- though see
    // directory_bytes's own doc comment: a file raced away by RocksDB's
    // background cleanup between listing and stat contributes zero, so the
    // true figures can be marginally higher than what is reported below.
    // Each directory is measured exactly once and reused in every total it
    // contributes to, so the disk-bytes figure and the amplification
    // ratios below can never disagree with each other over the same race.
    let source_bytes = directory_bytes(&source)?;
    let legacy_backup_bytes = directory_bytes(&legacy_backup)?;
    let workspace_bytes = directory_bytes(&workspace)?;
    let target_bytes = directory_bytes(&target)?;
    let with_receipt_backup_bytes = directory_bytes(&with_receipt_backup)?;
    let restore_target_bytes = directory_bytes(&restore_target)?;
    let total_disk_bytes = source_bytes
        + legacy_backup_bytes
        + workspace_bytes
        + target_bytes
        + with_receipt_backup_bytes
        + restore_target_bytes;

    // See peak_rss_kb's own doc comment: this is the whole test binary's
    // peak so far (best-effort, never fatal), not an isolated measurement
    // of this one drill.
    let peak_rss_kb = peak_rss_kb().map_or_else(|| "unknown".to_owned(), |kb| kb.to_string());

    // Write amplification: physical bytes this leg of the drill wrote to
    // disk, divided by the logical byte size the relevant backup receipt's
    // own file manifest declares (BackupFile::size, a manifest-recorded
    // length, not a filesystem stat). "Legacy" covers backup_legacy+
    // upgrade+cutover against the legacy backup's manifest; "restore"
    // covers the with-receipt backup+restore against that separate
    // backup's own manifest. Instrumentation only: no threshold is
    // asserted on either ratio.
    #[expect(
        clippy::cast_precision_loss,
        reason = "instrumentation ratio only, not an exact count; byte totals here are far below f64's exact-integer range"
    )]
    let legacy_write_amplification =
        (legacy_backup_bytes + workspace_bytes + target_bytes) as f64 / legacy_logical_bytes as f64;
    #[expect(
        clippy::cast_precision_loss,
        reason = "instrumentation ratio only, not an exact count; byte totals here are far below f64's exact-integer range"
    )]
    let restore_write_amplification = (with_receipt_backup_bytes + restore_target_bytes) as f64
        / with_receipt_logical_bytes as f64;

    eprintln!(
        "drill version={version} backup_legacy={backup_legacy_duration:?} upgrade={upgrade_duration:?} cutover={cutover_duration:?} rollback={rollback_duration:?} backup_with_receipt={backup_with_receipt_duration:?} restore={restore_duration:?} disk_bytes={total_disk_bytes} peak_rss_kb={peak_rss_kb} legacy_write_amplification={legacy_write_amplification:.2} restore_write_amplification={restore_write_amplification:.2}"
    );
    Ok(())
}

#[test]
fn legacy_upgrade_operational_drill_measures_stage_durations_and_disk_usage() -> TestResult {
    if !supported() {
        return Ok(());
    }
    drill(0)
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_legacy_upgrade_operational_drill_measures_stage_durations_and_disk_usage() -> TestResult {
    if !supported() {
        return Ok(());
    }
    drill(1)
}
