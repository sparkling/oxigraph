#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "operational-gate drill instrumentation"
)]

use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
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

/// Quads added on top of the freshly-activated store before the restore
/// leg's backup, so `restore_write_amplification` reflects a size class
/// larger than the two checked-in fixtures. Only the restore leg can be
/// scaled this way: it operates on an arbitrary current-format `Store`,
/// reachable through the public `insert`/`extend` API. The legacy leg
/// (backup-legacy/upgrade/cutover) cannot be scaled the same way, because
/// this codebase does not provide a legacy-format writer -- nothing
/// should intentionally produce new data in an obsolete physical layout
/// -- so `legacy_write_amplification` remains reported only against the
/// two checked-in fixtures' own size. 5,000 was chosen to plausibly
/// dilute RocksDB's fixed per-instance overhead (previously measured at
/// roughly 140-160 KiB across OPTIONS/MANIFEST/LOG/WAL) while keeping
/// the drill's wall-clock cost modest: all 5,000 quads are added in one
/// `extend` call (one transaction), not one transaction per quad.
const SYNTHETIC_QUAD_COUNT: u64 = 5_000;

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
/// `target`/`scaled`/`restore_target` are scanned while `activated`/
/// `scaled_store`/`restored_store` are still open, so a file `read_dir`
/// lists can legitimately be gone by the time it is stat'd: RocksDB may
/// delete an obsolete WAL/OPTIONS file in a background thread between the
/// two calls. A `NotFound` at either the file-type or metadata step is
/// therefore not a real error for this disk-usage proxy -- it contributes
/// zero bytes, since the file is gone by the time this measurement
/// completes either way. Every other I/O error still propagates.
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

/// One kernel-tracked cumulative counter from this process's own
/// `/proc/self/io`, or `None` if the file could not be read, the named
/// field is missing, or it fails to parse.
///
/// Like `peak_rss_kb`, this is whole-process and shared by every test in
/// this binary; unlike a peak, each counter is monotonic, so a caller can
/// sample before and after one span to get that span's own delta. That
/// delta is contaminated by any other concurrently running thread's I/O
/// in the same window: besides this file's own sibling test (ungated, or
/// gated behind the `rdf-12` feature), RocksDB's shared, lazily-created,
/// per-`Env` background flush/compaction thread pool services every
/// `Store` this drill opens, and that pool's I/O lands in the same
/// process-wide counters regardless of `--test-threads=1`. Best-effort
/// and never fatal: pure instrumentation, no threshold asserted on either
/// counter anywhere.
fn proc_self_io_field(field: &str) -> Option<u64> {
    let io = fs::read_to_string("/proc/self/io").ok()?;
    for line in io.lines() {
        if let Some(value) = line.strip_prefix(field) {
            return value.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

/// Bytes this process has actually fetched from block storage (Linux's
/// `read_bytes:` in `/proc/self/io`). Every input this drill's own legs
/// read was itself written or copied by this same process moments
/// earlier (the legacy fixture is copied, then immediately backed up;
/// the scaled store is populated, then immediately backed up), so those
/// reads are ordinary Linux page-cache hits that never reach the block
/// layer -- this counter reports near zero for such a leg regardless of
/// how many logical bytes it actually read, and would be expected to
/// stay at zero throughout if the temporary directory were on `tmpfs`
/// (not strictly guaranteed even then: a page tmpfs has swapped out is
/// read back through the block layer on the next access). A low or zero
/// delta here is therefore evidence the working set stayed cache-
/// resident, not evidence the leg read little data; see
/// `logical_read_bytes` for the complementary, cache-inclusive figure
/// that does reflect a leg's actual read volume.
fn physical_read_bytes() -> Option<u64> {
    proc_self_io_field("read_bytes:")
}

/// Bytes this process has passed through `read`/`pread`-family and
/// `copy_file_range` calls (Linux's `rchar:` in `/proc/self/io`),
/// counting a page-cache hit exactly like a genuine disk read. Read this
/// alongside `physical_read_bytes`: a leg with a high `rchar` delta but a
/// near-zero `read_bytes` delta genuinely read that much logical data,
/// just not from the block device this run.
fn logical_read_bytes() -> Option<u64> {
    proc_self_io_field("rchar:")
}

/// A before/after `/proc/self/io` sample pair, divided by `denominator`, or
/// `"unknown"` if either sample is `None` (see `proc_self_io_field`'s own
/// doc comment for why a sample can be missing).
#[expect(
    clippy::cast_precision_loss,
    reason = "instrumentation ratio only, not an exact count; byte totals here are far below f64's exact-integer range"
)]
fn ratio(start: Option<u64>, end: Option<u64>, denominator: u64) -> String {
    match (start, end) {
        (Some(start), Some(end)) => {
            format!(
                "{:.2}",
                end.saturating_sub(start) as f64 / denominator as f64
            )
        }
        _ => "unknown".to_owned(),
    }
}

/// Runs the legacy-upgrade-then-operational-recovery journey once, measuring each
/// stage. The measurements are instrumentation only: no baseline exists yet, so
/// nothing here asserts a duration or a byte count.
///
/// The restore leg backs up and restores a second, larger synthetic size
/// class rather than the freshly-activated store directly: see
/// `SYNTHETIC_QUAD_COUNT`'s doc comment for why only this leg can be scaled.
fn drill(version: u64) -> TestResult {
    let root = tempfile::tempdir()?;
    let source = root.path().join("source");
    fixture(version, &source)?;
    let source_before = inventory(&source)?;

    let legacy_leg_physical_read_start = physical_read_bytes();
    let legacy_leg_logical_read_start = logical_read_bytes();
    let legacy_backup = root.path().join("legacy-backup");
    let started = Instant::now();
    let legacy_backup_receipt =
        Store::backup_legacy(&source, &legacy_backup, &LegacyBackupOptions::default())?;
    let backup_legacy_duration = started.elapsed();
    // Sub-legs, not a fourth counter: each of the three following samples
    // ends the previous call's own window and starts the next one's, so
    // the three windows' own byte deltas sum exactly to the whole leg's
    // delta (the samples telescope: nothing outside these three windows
    // touches `logical_read_bytes` between the leg's own start and end).
    // backup_legacy_logical_read_ratio + upgrade_logical_read_ratio +
    // cutover_logical_read_ratio therefore sums to the whole-leg
    // legacy_logical_read_ratio below up to each ratio's own independent
    // `{:.2}` display rounding, not for any other reason -- this
    // decomposes that figure's unexplained magnitude rather than adding
    // an unrelated measurement.
    let backup_legacy_logical_read_end = logical_read_bytes();
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
    let upgrade_logical_read_end = logical_read_bytes();

    let target = root.path().join("active");
    let started = Instant::now();
    let activation =
        Store::activate_upgrade(&source, &legacy_backup, &workspace, &target, &options)?;
    let cutover_duration = started.elapsed();
    let legacy_leg_physical_read_end = physical_read_bytes();
    let legacy_leg_logical_read_end = logical_read_bytes();
    assert!(activation.active());
    let activated = Store::open(&target)?;
    activated.validate()?;
    assert_eq!(activated.len()? as u64, activation.quad_count());

    // Rollback means an operator can fall back to the preserved legacy source
    // after cutover. Two things are verified, not just one: the source's
    // bytes are unchanged (inventory, a plain file-path/SHA-256 listing), and
    // it remains genuinely usable by legacy-aware tooling, not merely
    // untouched on disk -- Store::backup_legacy is the same operation an
    // operator falling back to an older, legacy-only binary would run.
    // Re-running it here and comparing the resulting receipt's fingerprint
    // (a hash over storage_version, database_id, rocksdb_sequence,
    // column_families and every file's name/length/SHA-256) against the
    // pre-drill backup's own fingerprint proves that operation still
    // succeeds and still reaches byte-for-byte the same result, after the
    // full upgrade+cutover+restore journey has run.
    let started = Instant::now();
    let source_after = inventory(&source)?;
    assert_eq!(
        source_after, source_before,
        "the preserved source changed during the drill"
    );
    let rollback_legacy_backup = root.path().join("rollback-legacy-backup");
    let rollback_legacy_backup_receipt = Store::backup_legacy(
        &source,
        &rollback_legacy_backup,
        &LegacyBackupOptions::default(),
    )?;
    assert_eq!(
        rollback_legacy_backup_receipt.fingerprint(),
        legacy_backup_receipt.fingerprint(),
        "the preserved source no longer backs up identically to an older binary"
    );
    let rollback_duration = started.elapsed();

    // See SYNTHETIC_QUAD_COUNT's doc comment: the restore leg backs up and
    // restores this larger synthetic store, a copy of `activated` plus
    // SYNTHETIC_QUAD_COUNT additional quads, instead of `activated` itself.
    let scaled = root.path().join("scaled");
    let scaled_store = Store::open(&scaled)?;
    let synthetic_quads = (0..SYNTHETIC_QUAD_COUNT).map(|index| {
        Quad::new(
            NamedNode::new_unchecked(format!(
                "http://example.com/upgrade-operational-drill/synthetic/{index}"
            )),
            NamedNode::new_unchecked(
                "http://example.com/upgrade-operational-drill/synthetic-predicate",
            ),
            Literal::new_simple_literal(format!(
                "synthetic operational-drill scale-out value {index}"
            )),
            GraphName::DefaultGraph,
        )
    });
    scaled_store.extend(
        activated
            .iter()
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .chain(synthetic_quads),
    )?;
    let scaled_quad_count = scaled_store.len()? as u64;
    assert_eq!(
        scaled_quad_count,
        activation.quad_count() + SYNTHETIC_QUAD_COUNT,
        "scaled store should hold exactly the activated quads plus the synthetic ones"
    );

    let restore_leg_physical_read_start = physical_read_bytes();
    let restore_leg_logical_read_start = logical_read_bytes();
    let with_receipt_backup = root.path().join("with-receipt-backup");
    let started = Instant::now();
    let with_receipt_backup_receipt =
        scaled_store.backup_with_receipt(&with_receipt_backup, &BackupOptions::default())?;
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
    let restore_leg_physical_read_end = physical_read_bytes();
    let restore_leg_logical_read_end = logical_read_bytes();
    let restored_store = Store::open(restore_target.join(RestoreReceipt::store_directory()))?;
    restored_store.validate()?;
    assert_eq!(restored_store.len()? as u64, scaled_quad_count);

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
    let scaled_bytes = directory_bytes(&scaled)?;
    let with_receipt_backup_bytes = directory_bytes(&with_receipt_backup)?;
    let restore_target_bytes = directory_bytes(&restore_target)?;
    let rollback_legacy_backup_bytes = directory_bytes(&rollback_legacy_backup)?;
    let total_disk_bytes = source_bytes
        + legacy_backup_bytes
        + workspace_bytes
        + target_bytes
        + scaled_bytes
        + with_receipt_backup_bytes
        + restore_target_bytes
        + rollback_legacy_backup_bytes;

    // See peak_rss_kb's own doc comment: this is the whole test binary's
    // peak so far (best-effort, never fatal), not an isolated measurement
    // of this one drill.
    let peak_rss_kb = peak_rss_kb().map_or_else(|| "unknown".to_owned(), |kb| kb.to_string());

    // Write amplification: physical bytes this leg of the drill wrote to
    // disk, divided by the logical byte size the relevant backup receipt's
    // own file manifest declares (BackupFile::size, a manifest-recorded
    // length, not a filesystem stat). "Legacy" covers backup_legacy+
    // upgrade+cutover against the legacy backup's manifest, sized to the
    // two checked-in fixtures. "Restore" covers the with-receipt backup+
    // restore against that separate backup's own manifest, sized to the
    // larger SYNTHETIC_QUAD_COUNT size class instead (see that constant's
    // doc comment). Instrumentation only: no threshold is asserted on
    // either ratio.
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

    // Read ratios: the same two legs and the same logical-byte denominators
    // as write amplification above, but on the read side. Two counters are
    // reported, not one, because they answer different questions and
    // neither alone is an honest "read amplification": `physical` (Linux's
    // `read_bytes`) is bytes actually fetched from the block device, but
    // every leg here reads data this same process wrote or copied moments
    // earlier, so ordinary page-cache locality keeps `physical` near zero
    // regardless of how much a leg logically read -- see
    // `physical_read_bytes`'s own doc comment. `logical` (Linux's `rchar`)
    // is bytes passed through read/pread/copy_file_range regardless of
    // cache hit or miss, so it reflects a leg's actual read volume even
    // when `physical` cannot. "unknown" only if a sample itself could not
    // be read (see `proc_self_io_field`'s own doc comment); a concurrently
    // running sibling test or RocksDB's own background threads doing I/O
    // in the same window is not detected and is not reported as
    // "unknown" -- it silently inflates the delta instead, per
    // `proc_self_io_field`'s own doc comment. Instrumentation only: no
    // threshold is asserted on any of these ratios.
    let legacy_physical_read_ratio = ratio(
        legacy_leg_physical_read_start,
        legacy_leg_physical_read_end,
        legacy_logical_bytes,
    );
    let legacy_logical_read_ratio = ratio(
        legacy_leg_logical_read_start,
        legacy_leg_logical_read_end,
        legacy_logical_bytes,
    );
    // Sub-leg decomposition of legacy_logical_read_ratio (see the sampling
    // comment above): which of backup_legacy/upgrade/cutover the legacy
    // leg's own large, fixture-dependent logical-read figure actually
    // comes from, not a new or different measurement.
    let backup_legacy_logical_read_ratio = ratio(
        legacy_leg_logical_read_start,
        backup_legacy_logical_read_end,
        legacy_logical_bytes,
    );
    let upgrade_logical_read_ratio = ratio(
        backup_legacy_logical_read_end,
        upgrade_logical_read_end,
        legacy_logical_bytes,
    );
    let cutover_logical_read_ratio = ratio(
        upgrade_logical_read_end,
        legacy_leg_logical_read_end,
        legacy_logical_bytes,
    );
    let restore_physical_read_ratio = ratio(
        restore_leg_physical_read_start,
        restore_leg_physical_read_end,
        with_receipt_logical_bytes,
    );
    let restore_logical_read_ratio = ratio(
        restore_leg_logical_read_start,
        restore_leg_logical_read_end,
        with_receipt_logical_bytes,
    );

    eprintln!(
        "drill version={version} backup_legacy={backup_legacy_duration:?} upgrade={upgrade_duration:?} cutover={cutover_duration:?} rollback={rollback_duration:?} backup_with_receipt={backup_with_receipt_duration:?} restore={restore_duration:?} disk_bytes={total_disk_bytes} peak_rss_kb={peak_rss_kb} legacy_write_amplification={legacy_write_amplification:.2} restore_write_amplification={restore_write_amplification:.2} legacy_physical_read_ratio={legacy_physical_read_ratio} legacy_logical_read_ratio={legacy_logical_read_ratio} backup_legacy_logical_read_ratio={backup_legacy_logical_read_ratio} upgrade_logical_read_ratio={upgrade_logical_read_ratio} cutover_logical_read_ratio={cutover_logical_read_ratio} restore_physical_read_ratio={restore_physical_read_ratio} restore_logical_read_ratio={restore_logical_read_ratio} restore_source_quads={scaled_quad_count}"
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
