//! Offline preparation for a later explicit legacy upgrade.
use super::backup::{
    MAX_MANIFEST, check, copy_artifact, fresh_destination, hash_file, open_regular, sync_directory,
};
use super::legacy_backup::{check_options, inventory, private_directory, stable_directory};
use super::receipt::envelope_checksum;
use super::{BackupArtifact, BackupError, LegacyBackupOptions, LegacyBackupReceipt, Store};
use crate::storage::LegacyStoreSnapshot;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[path = "upgrade_transform.rs"]
mod transform;
pub use transform::{
    SchemaUpgradeActivation, SchemaUpgradeOptions, SchemaUpgradeReceipt, SchemaUpgradeState,
    TransformedUpgrade, UpgradeActivation, UpgradeOptions, UpgradeReceipt, UpgradeRecovery,
    UpgradeRecoveryOptions, UpgradeTransformOptions, UpgradeWorkspaceInspection,
    UpgradeWorkspaceState,
};

pub(crate) const UPGRADE_GUARD: &str = ".oxigraph-upgrade-incomplete";
const JOURNAL: &str = "oxigraph-upgrade-preflight";
const COMPLETE: &str = "oxigraph-upgrade-prepared.complete";
const PENDING: &str = "oxigraph-upgrade-prepared.pending";
const GUARD: &[u8] = b"oxigraph upgrade preparation inactive\n";
const MAGIC: &[u8] = b"oxigraph.prepared-upgrade.v1\0";
const PREFLIGHT: &[u8] = b"oxigraph.upgrade-journal.v1\0Preflight\0target-version=2\0";

/// A verified, inactive physical copy prepared for a future explicit upgrade.
///
/// This is not an UpgradeReceipt: no transformation, logical validation, resume,
/// activation, or compatibility with older binaries is established. Keep the
/// workspace exclusively controlled and inactive. Ordinary opens by this binary
/// reject its store directory, even when the whole directory is moved.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedUpgrade {
    directory: PathBuf,
    receipt: LegacyBackupReceipt,
}

impl PreparedUpgrade {
    pub const fn guard_name() -> &'static str {
        UPGRADE_GUARD
    }
    pub const fn journal_name() -> &'static str {
        JOURNAL
    }
    pub const fn manifest_name() -> &'static str {
        COMPLETE
    }
    pub const fn store_directory() -> &'static str {
        "store"
    }
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub fn legacy_backup(&self) -> &LegacyBackupReceipt {
        &self.receipt
    }

    /// Independently checks completion of preparation, not completion of upgrade.
    ///
    /// The embedded legacy receipt, exact files, native metadata, Preflight
    /// journal and inactive guard must agree. Hashes establish content identity,
    /// not authorship. Stop all writers and keep directory paths unchanged.
    pub fn verify(
        directory: impl AsRef<Path>,
        options: &LegacyBackupOptions,
    ) -> Result<Self, BackupError> {
        Ok(Self::verify_leased(directory.as_ref(), options, Instant::now())?.0)
    }

    fn verify_leased(
        directory: &Path,
        options: &LegacyBackupOptions,
        started: Instant,
    ) -> Result<(Self, LegacyStoreSnapshot), BackupError> {
        check_options(options, started)?;
        let directory = stable_directory(directory)?;
        check_workspace(&directory)?;
        let receipt = decode(&read(&directory.join(COMPLETE), MAX_MANIFEST)?)?;
        if read(&directory.join(JOURNAL), 512)? != journal(&receipt) {
            return Err(BackupError::InvalidManifest);
        }
        let store = stable_directory(&directory.join("store"))?;
        let copy_lease = verify_copy(&store, &receipt, options, started)?;
        check(&options.control, started)?;
        Ok((Self { directory, receipt }, copy_lease))
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "separate offline preparation API"
)]
impl Store {
    /// Prepares a fresh, inactive copy from a completed legacy backup.
    ///
    /// Source and backup must be offline, disjoint, unchanged and exclusively
    /// controlled by the caller. Both existing native leases span copying and
    /// revalidation; neither input is migrated or modified. Bounds cover native
    /// file count and aggregate bytes; metadata is separately bounded.
    ///
    /// Partial workspaces are retained and cannot verify as prepared. A failure
    /// after the complete marker is indeterminate and requires independent
    /// verification. Preparation does not transform, resume, activate, or make
    /// claims about ordinary opens by older binaries unaware of the guard.
    pub fn prepare_upgrade(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        destination: impl AsRef<Path>,
        options: &LegacyBackupOptions,
    ) -> Result<PreparedUpgrade, BackupError> {
        prepare_inner(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            destination.as_ref(),
            options,
            |_| Ok(()),
        )
    }
}

fn prepare_inner(
    source: &Path,
    package: &Path,
    destination: &Path,
    options: &LegacyBackupOptions,
    mut phase: impl FnMut(u8) -> Result<(), BackupError>,
) -> Result<PreparedUpgrade, BackupError> {
    let started = Instant::now();
    check_options(options, started)?;
    if !cfg!(unix) {
        return Err(BackupError::UnsupportedPlatform);
    }
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let (receipt, _source_lease, _package_lease) =
        LegacyBackupReceipt::verify_ancestry_leased(&source, &package, options, started)?;
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    stable_directory(parent)?;
    let destination = fresh_destination(destination, &source)?;
    if destination.starts_with(&package) || package.starts_with(&destination) {
        return Err(BackupError::InvalidPath);
    }
    let record = encode(&receipt);
    if record.len() > MAX_MANIFEST {
        return Err(BackupError::Limit);
    }
    decode(&record)?;
    private_directory(&destination)?;
    let store = destination.join("store");
    private_directory(&store)?;
    phase(0)?;
    write(&destination.join(JOURNAL), &journal(&receipt))?;
    write(&store.join(UPGRADE_GUARD), GUARD)?;
    // Persist guard and directory entries before any native file is copied.
    sync_directory(&store)?;
    sync_directory(&destination)?;
    sync_directory(destination.parent().ok_or(BackupError::InvalidPath)?)?;
    phase(1)?;
    check(&options.control, started)?;
    for file in receipt.files() {
        let artifact = BackupArtifact::new(
            file.path().to_owned(),
            package.join("store").join(file.path()),
            file.size(),
            *file.sha256(),
        )?;
        copy_artifact(
            &artifact,
            &store.join(file.path()),
            &options.control,
            started,
        )?;
        phase(2)?;
    }
    let _copy_lease = verify_copy(&store, &receipt, options, started)?;
    if inventory(&source, options, started)? != receipt.files()
        || inventory(&package.join("store"), options, started)? != receipt.files()
        || read(
            &package.join(LegacyBackupReceipt::manifest_name()),
            MAX_MANIFEST,
        )? != receipt.encode()
    {
        return Err(BackupError::FileMismatch);
    }
    write(&destination.join(PENDING), &record)?;
    sync_directory(&store)?;
    sync_directory(&destination)?;
    phase(3)?;
    check(&options.control, started)?;
    fs::rename(destination.join(PENDING), destination.join(COMPLETE))?;
    phase(4).map_err(indeterminate)?;
    check(&options.control, started).map_err(indeterminate)?;
    sync_directory(&destination).map_err(BackupError::CompletionIndeterminate)?;
    Ok(PreparedUpgrade {
        directory: destination,
        receipt,
    })
}

fn indeterminate(error: BackupError) -> BackupError {
    BackupError::CompletionIndeterminate(io::Error::other(error))
}

#[expect(
    clippy::filetype_is_file,
    reason = "the prepared inventory must reject symlinks and non-regular filesystem objects"
)]
fn check_workspace(directory: &Path) -> Result<(), BackupError> {
    let mut count = 0;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        count += 1;
        if count > 3 {
            return Err(BackupError::InvalidPath);
        }
        let name = entry.file_name();
        if !((name == "store" && entry.file_type()?.is_dir())
            || ((name == JOURNAL || name == COMPLETE) && entry.file_type()?.is_file()))
        {
            return Err(BackupError::InvalidPath);
        }
    }
    if count != 3 {
        return Err(BackupError::InvalidPath);
    }
    Ok(())
}

#[expect(
    clippy::filetype_is_file,
    reason = "the copied store must contain only regular files, never symlinks or devices"
)]
fn verify_copy(
    store: &Path,
    receipt: &LegacyBackupReceipt,
    options: &LegacyBackupOptions,
    started: Instant,
) -> Result<LegacyStoreSnapshot, BackupError> {
    check(&options.control, started)?;
    if receipt.files().len() > options.max_files.get() {
        return Err(BackupError::Limit);
    }
    let total = receipt.files().iter().try_fold(0_u64, |sum, file| {
        sum.checked_add(file.size())
            .filter(|v| *v <= options.max_bytes.get())
            .ok_or(BackupError::Limit)
    })?;
    let mut found = Vec::new();
    let mut guard_found = false;
    for entry in fs::read_dir(store)? {
        check(&options.control, started)?;
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if !entry.file_type()?.is_file() {
            return Err(BackupError::InvalidPath);
        }
        if name == UPGRADE_GUARD {
            guard_found = true;
        } else {
            if found.len() >= options.max_files.get() {
                return Err(BackupError::Limit);
            }
            found.push(name);
        }
    }
    found.sort_unstable();
    if !guard_found
        || found
            .iter()
            .map(String::as_str)
            .ne(receipt.files().iter().map(super::BackupFile::path))
    {
        return Err(BackupError::FileMismatch);
    }
    if read(&store.join(UPGRADE_GUARD), GUARD.len())? != GUARD {
        return Err(BackupError::InvalidManifest);
    }
    // Reject manifest traversal before handing the path to the native reader.
    let current = read(&store.join("CURRENT"), 127)?;
    let current = std::str::from_utf8(&current).map_err(|_| BackupError::InvalidManifest)?;
    let manifest = current
        .strip_suffix('\n')
        .ok_or(BackupError::InvalidManifest)?;
    let digits = manifest
        .strip_prefix("MANIFEST-")
        .ok_or(BackupError::InvalidManifest)?;
    if digits.is_empty()
        || !digits.bytes().all(|b| b.is_ascii_digit())
        || !found.iter().any(|name| name == manifest)
    {
        return Err(BackupError::InvalidManifest);
    }
    let snapshot = LegacyStoreSnapshot::open(store, options.store_options.clone().into())?;
    let mut remaining = total;
    for file in receipt.files() {
        let (size, hash) = hash_file(
            &store.join(file.path()),
            &options.control,
            started,
            remaining,
            false,
        )?;
        if size != file.size() || hash != *file.sha256() {
            return Err(BackupError::FileMismatch);
        }
        remaining = remaining.checked_sub(size).ok_or(BackupError::Limit)?;
    }
    receipt.check_metadata(&snapshot)?;
    check(&options.control, started)?;
    Ok(snapshot)
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), BackupError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn read(path: &Path, max: usize) -> Result<Vec<u8>, BackupError> {
    let mut bytes = Vec::new();
    let file = open_regular(path)?;
    if file.metadata()?.len() > max as u64 {
        return Err(BackupError::Limit);
    }
    file.take(max as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > max {
        Err(BackupError::Limit)
    } else {
        Ok(bytes)
    }
}

fn journal(receipt: &LegacyBackupReceipt) -> Vec<u8> {
    let mut bytes = PREFLIGHT.to_vec();
    bytes.extend_from_slice(&receipt.fingerprint());
    let checksum = envelope_checksum(PREFLIGHT, &bytes);
    bytes.extend_from_slice(&checksum);
    bytes
}

fn encode(receipt: &LegacyBackupReceipt) -> Vec<u8> {
    let encoded = receipt.encode();
    let mut out = MAGIC.to_vec();
    out.extend_from_slice(&(encoded.len() as u64).to_be_bytes());
    out.extend_from_slice(&encoded);
    out.extend_from_slice(&envelope_checksum(MAGIC, &journal(receipt)));
    out.extend_from_slice(&envelope_checksum(UPGRADE_GUARD.as_bytes(), GUARD));
    let checksum = envelope_checksum(MAGIC, &out);
    out.extend_from_slice(&checksum);
    out
}

fn decode(bytes: &[u8]) -> Result<LegacyBackupReceipt, BackupError> {
    if bytes.len() > MAX_MANIFEST {
        return Err(BackupError::Limit);
    }
    let split = bytes
        .len()
        .checked_sub(32)
        .ok_or(BackupError::InvalidManifest)?;
    let (body, checksum) = bytes.split_at(split);
    if !body.starts_with(MAGIC) || envelope_checksum(MAGIC, body) != checksum {
        return Err(BackupError::InvalidManifest);
    }
    let at = MAGIC.len();
    let size = usize::try_from(u64::from_be_bytes(
        body.get(at..at + 8)
            .ok_or(BackupError::InvalidManifest)?
            .try_into()
            .map_err(|_| BackupError::InvalidManifest)?,
    ))
    .map_err(|_| BackupError::Limit)?;
    let end = (at + 8).checked_add(size).ok_or(BackupError::Limit)?;
    let receipt =
        LegacyBackupReceipt::decode(body.get(at + 8..end).ok_or(BackupError::InvalidManifest)?)?;
    if encode(&receipt) != bytes {
        return Err(BackupError::InvalidManifest);
    }
    Ok(receipt)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::store::{StoreOptions, TransactionStartControl};
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;

    type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

    fn fixture(version: u64, destination: &Path) -> TestResult {
        fs::create_dir(destination)?;
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join(if version == 0 {
                "rocksdb_bc_data"
            } else {
                "rocksdb_bc_rdf_star_data"
            });
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            assert!(entry.file_type()?.is_file());
            fs::copy(entry.path(), destination.join(entry.file_name()))?;
        }
        Ok(())
    }

    fn hashes(path: &Path) -> TestResult<BTreeMap<PathBuf, [u8; 32]>> {
        fs::read_dir(path)?
            .map(|entry| {
                let entry = entry?;
                Ok((
                    entry.file_name().into(),
                    Sha256::digest(fs::read(entry.path())?).into(),
                ))
            })
            .collect()
    }

    #[test]
    fn failures_before_completion_preserve_both_inputs_and_refuse_preparation() -> TestResult {
        for version in [0, 1] {
            for stop in 0..4 {
                let dir = tempfile::tempdir()?;
                let source = dir.path().join("source");
                let package = dir.path().join("backup");
                let output = dir.path().join("prepared");
                fixture(version, &source)?;
                let before = hashes(&source)?;
                let options = LegacyBackupOptions::default();
                let receipt = Store::backup_legacy(&source, &package, &options)?;
                let result = prepare_inner(&source, &package, &output, &options, |phase| {
                    if phase == stop {
                        Err(BackupError::Cancelled)
                    } else {
                        Ok(())
                    }
                });
                assert!(matches!(result, Err(BackupError::Cancelled)));
                assert!(!output.join(COMPLETE).exists());
                assert!(PreparedUpgrade::verify(&output, &options).is_err());
                assert_eq!(hashes(&source)?, before);
                assert_eq!(hashes(&package.join("store"))?, before);
                assert_eq!(
                    LegacyBackupReceipt::verify_ancestry(
                        &source,
                        &package,
                        &TransactionStartControl::new(),
                    )?,
                    receipt
                );
                if stop >= 1 {
                    assert!(matches!(
                        Store::open(output.join("store")),
                        Err(crate::storage::StorageError::UpgradeIncomplete)
                    ));
                    assert!(matches!(
                        Store::open_read_only(output.join("store")),
                        Err(crate::storage::StorageError::UpgradeIncomplete)
                    ));
                }
            }
        }
        Ok(())
    }

    #[test]
    fn cancellation_during_copy_and_before_marker_is_not_completion() -> TestResult {
        for stop in [1, 2, 3] {
            let dir = tempfile::tempdir()?;
            let source = dir.path().join("source");
            let package = dir.path().join("backup");
            let output = dir.path().join("prepared");
            fixture(1, &source)?;
            let options = LegacyBackupOptions::default();
            Store::backup_legacy(&source, &package, &options)?;
            let cancellation = options.control.clone();
            let result = prepare_inner(&source, &package, &output, &options, |phase| {
                if phase == stop {
                    cancellation.cancel();
                }
                Ok(())
            });
            assert!(matches!(result, Err(BackupError::Cancelled)));
            assert!(!output.join(COMPLETE).exists());
            assert!(PreparedUpgrade::verify(&output, &LegacyBackupOptions::default()).is_err());
            LegacyBackupReceipt::verify_ancestry(
                &source,
                &package,
                &TransactionStartControl::new(),
            )?;
        }
        Ok(())
    }

    #[test]
    fn post_marker_failure_or_cancellation_is_indeterminate_and_verifiable() -> TestResult {
        for version in [0, 1] {
            for cancel in [false, true] {
                let dir = tempfile::tempdir()?;
                let source = dir.path().join("source");
                let package = dir.path().join("backup");
                let output = dir.path().join("prepared");
                fixture(version, &source)?;
                let options = LegacyBackupOptions::default();
                let receipt = Store::backup_legacy(&source, &package, &options)?;
                let cancellation = options.control.clone();
                let result = prepare_inner(&source, &package, &output, &options, |phase| {
                    if phase == 4 {
                        if cancel {
                            cancellation.cancel();
                        } else {
                            return Err(BackupError::Io(io::Error::other("injected sync failure")));
                        }
                    }
                    Ok(())
                });
                assert!(matches!(
                    result,
                    Err(BackupError::CompletionIndeterminate(_))
                ));
                assert_eq!(
                    PreparedUpgrade::verify(&output, &LegacyBackupOptions::default(),)?
                        .legacy_backup(),
                    &receipt
                );
            }
        }
        Ok(())
    }

    #[test]
    fn both_native_input_leases_span_all_phases_and_release_on_return() -> TestResult {
        for fail in [false, true] {
            let dir = tempfile::tempdir()?;
            let source = dir.path().join("source");
            let package = dir.path().join("backup");
            let output = dir.path().join("prepared");
            fixture(0, &source)?;
            let options = LegacyBackupOptions::default();
            Store::backup_legacy(&source, &package, &options)?;
            let mut observed = [false; 5];
            let result = prepare_inner(&source, &package, &output, &options, |phase| {
                observed[usize::from(phase)] = true;
                for path in [&source, &package.join("store")] {
                    assert!(
                        LegacyStoreSnapshot::open(path, StoreOptions::default().into()).is_err()
                    );
                }
                if fail && phase == 2 {
                    Err(BackupError::Cancelled)
                } else {
                    Ok(())
                }
            });
            if fail {
                assert!(matches!(result, Err(BackupError::Cancelled)));
            } else {
                result?;
                assert!(observed.into_iter().all(|value| value));
            }
            LegacyStoreSnapshot::open(&source, StoreOptions::default().into())?;
            LegacyStoreSnapshot::open(&package.join("store"), StoreOptions::default().into())?;
        }
        Ok(())
    }

    /// The libtest filter of one helper `#[test]`, which never names the crate.
    fn helper(name: &str) -> String {
        let module = module_path!();
        let path = module.split_once("::").map_or(module, |(_, rest)| rest);
        format!("{path}::{name}")
    }
    /// Re-invokes this same test binary at one helper, which exits 73 at `stop`.
    fn crash(
        name: &str,
        paths: &[(&str, &Path)],
        stop: u8,
    ) -> TestResult<std::process::ExitStatus> {
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command.arg("--exact").arg(helper(name));
        command.env("OXIGRAPH_UPGRADE_PREPARE_TEST_EXIT_AT", stop.to_string());
        for (variable, path) in paths {
            command.env(variable, path);
        }
        Ok(command.status()?)
    }
    /// Reads one path that the parent test passed to a re-invoked helper.
    fn variable(name: &str) -> TestResult<PathBuf> {
        let Some(value) = std::env::var_os(name) else {
            return Err("the parent test passed no such path".into());
        };
        Ok(value.into())
    }

    #[test]
    fn preparation_child_exits_before_and_after_the_completion_rename() -> TestResult {
        for stop in [3_u8, 4] {
            let dir = tempfile::tempdir()?;
            let source = dir.path().join("source");
            let package = dir.path().join("backup");
            let output = dir.path().join(format!("prepared-{stop}"));
            fixture(1, &source)?;
            let before_source = hashes(&source)?;
            let options = LegacyBackupOptions::default();
            let receipt = Store::backup_legacy(&source, &package, &options)?;
            let before_package = hashes(&package.join("store"))?;
            let paths = [
                ("OXIGRAPH_UPGRADE_PREPARE_TEST_SOURCE", source.as_path()),
                ("OXIGRAPH_UPGRADE_PREPARE_TEST_PACKAGE", package.as_path()),
                ("OXIGRAPH_UPGRADE_PREPARE_TEST_OUTPUT", output.as_path()),
            ];
            let status = crash("prepare_process_helper", &paths, stop)?;
            assert_eq!(status.code(), Some(73), "the child did not reach {stop}");
            if stop == 3 {
                // A real process killed after the PENDING marker is written and
                // synced but before the atomic rename to COMPLETE: no destructor
                // runs, yet the workspace is left exactly as refused,
                // unopenable and verify-failing as an in-process fault at the
                // same phase, because the rename that would have made it usable
                // never happened.
                assert!(!output.join(COMPLETE).exists());
                assert!(PreparedUpgrade::verify(&output, &options).is_err());
                assert!(matches!(
                    Store::open(output.join("store")),
                    Err(crate::storage::StorageError::UpgradeIncomplete)
                ));
                assert!(matches!(
                    Store::open_read_only(output.join("store")),
                    Err(crate::storage::StorageError::UpgradeIncomplete)
                ));
            } else {
                // Killed immediately after the rename: the marker is already
                // visible in the directory even though the process died
                // before the final directory fsync could run, so preparation
                // is complete and independently verifiable. This proves only
                // namespace visibility, not on-media durability across a
                // further power loss, which is exactly why the production
                // API still reports this window as indeterminate.
                assert!(output.join(COMPLETE).exists());
                assert_eq!(
                    PreparedUpgrade::verify(&output, &options)?.legacy_backup(),
                    &receipt
                );
            }
            assert_eq!(hashes(&source)?, before_source);
            assert_eq!(hashes(&package.join("store"))?, before_package);
        }
        Ok(())
    }

    /// Real process kills bracketing `prepare_inner`'s guard write and its
    /// copy loop: `phase(0)` fires once, strictly after `private_directory`
    /// creates an empty `store/` but strictly before the journal and guard
    /// are written; `phase(1)` fires once, strictly after both are written
    /// and all three directory syncs complete, but before the copy loop
    /// starts; `phase(2)` fires per file inside that loop, the same
    /// per-file boundary this crate's other copy-loop tests already use.
    ///
    /// `phase(0)`'s own outcome was verified directly rather than assumed
    /// to match its siblings: killed at that point, `store/` is a real but
    /// entirely empty directory -- no guard, no journal, nothing --
    /// because `reject_incomplete_upgrade` only refuses when the guard
    /// file is actually present (`symlink_metadata` on it), and an absent
    /// guard makes that check pass through as `Ok(())` regardless of
    /// whether the directory is empty, partially populated, or does not
    /// exist. `Store::open` on that guard-less empty directory therefore
    /// does NOT return `UpgradeIncomplete`; it succeeds and creates a
    /// fresh, valid, empty store there, via the same ordinary
    /// create-if-missing semantics `Store::open` uses for any other new,
    /// empty target -- there is nothing to distinguish this from a user
    /// legitimately opening a brand-new path, and this is not a defect.
    /// `phase(1)` and `phase(2)` are different: the guard already exists
    /// by then, so `Store::open` refuses exactly as an in-process fault at
    /// the same point already proves it does.
    #[test]
    fn preparation_child_exits_before_the_guard_write_and_during_the_copy_loop() -> TestResult {
        let dir = tempfile::tempdir()?;
        let source = dir.path().join("source");
        let package = dir.path().join("backup");
        fixture(1, &source)?;
        let before_source = hashes(&source)?;
        let options = LegacyBackupOptions::default();
        Store::backup_legacy(&source, &package, &options)?;
        let before_package = hashes(&package.join("store"))?;
        for stop in [0_u8, 1, 2] {
            let output = dir.path().join(format!("prepared-early-{stop}"));
            let paths = [
                ("OXIGRAPH_UPGRADE_PREPARE_TEST_SOURCE", source.as_path()),
                ("OXIGRAPH_UPGRADE_PREPARE_TEST_PACKAGE", package.as_path()),
                ("OXIGRAPH_UPGRADE_PREPARE_TEST_OUTPUT", output.as_path()),
            ];
            let status = crash("prepare_process_helper", &paths, stop)?;
            assert_eq!(status.code(), Some(73), "the child did not reach {stop}");
            assert!(PreparedUpgrade::verify(&output, &options).is_err());
            if stop == 0 {
                // No guard exists yet: Store::open legitimately creates a
                // fresh empty store here, the same as it would for any
                // other new, empty target -- not a refusal, and not a bug.
                assert!(Store::open(output.join("store")).is_ok());
            } else {
                assert!(matches!(
                    Store::open(output.join("store")),
                    Err(crate::storage::StorageError::UpgradeIncomplete)
                ));
                assert!(matches!(
                    Store::open_read_only(output.join("store")),
                    Err(crate::storage::StorageError::UpgradeIncomplete)
                ));
            }
            assert_eq!(hashes(&source)?, before_source);
            assert_eq!(hashes(&package.join("store"))?, before_package);
        }
        Ok(())
    }

    #[test]
    #[expect(
        clippy::exit,
        reason = "bounded child models an exact preparation crash point"
    )]
    fn prepare_process_helper() -> TestResult {
        let Some(source) = std::env::var_os("OXIGRAPH_UPGRADE_PREPARE_TEST_SOURCE") else {
            return Ok(()); // An ordinary run: only the parent test re-invokes this.
        };
        let source = PathBuf::from(source);
        let package = variable("OXIGRAPH_UPGRADE_PREPARE_TEST_PACKAGE")?;
        let output = variable("OXIGRAPH_UPGRADE_PREPARE_TEST_OUTPUT")?;
        let stop = std::env::var("OXIGRAPH_UPGRADE_PREPARE_TEST_EXIT_AT")?.parse::<u8>()?;
        let options = LegacyBackupOptions::default();
        prepare_inner(&source, &package, &output, &options, |phase| {
            if phase == stop {
                std::process::exit(73);
            }
            Ok(())
        })?;
        Err("the child returned instead of exiting at its crash point".into())
    }

    /// Compiles a `/proc/self/fd`-scoped `ENOSPC`-injection shim, or `None`
    /// when no C compiler is available: this fault is opt-in test
    /// infrastructure, never a dependency of the crate's own build. Once
    /// `LD_PRELOAD`ed into a fresh process, the shim intercepts the `write`
    /// libc symbol Rust's `write_all` calls, for descriptors whose resolved
    /// path starts with `ENOSPC_SHIM_PREFIX`, injecting a real `ENOSPC` once
    /// a single write exceeds the remaining `ENOSPC_SHIM_BUDGET_BYTES`;
    /// every other descriptor, and every other process on the machine,
    /// passes through to the real `dlsym`-resolved libc function unmodified.
    /// A `pwrite` symbol is defined too, but positioned writes on Linux
    /// resolve to `pwrite64`, which this shim does not intercept.
    /// `/proc/self/fd` and `LD_PRELOAD`-honoring dynamic linking are both
    /// Linux-specific: the caller must skip this on any other OS. Compiled
    /// next to the test binary itself, not into a temporary directory, since
    /// a `noexec` mount there would silently make `LD_PRELOAD` a no-op.
    /// Identical to `legacy_backup.rs`'s already-reviewed `compile_enospc_shim`
    /// of the same name; duplicated file-local rather than shared, matching
    /// this session's own established convention of file-local crash-test
    /// infrastructure. `name` distinguishes each caller's own `.c`/`.so`
    /// filenames: this file has two ENOSPC tests now, both of which can run
    /// concurrently under libtest's default multithreading. A shared,
    /// unparameterized filename raced for real the first time this exact
    /// situation arose in `legacy_backup.rs` (one test's `cc` invocation
    /// rewriting the `.so` while the other's freshly-spawned child had it
    /// mapped) -- fixed there first, then applied here proactively before
    /// it could flake, not after observing a failure in this file.
    #[expect(
        clippy::print_stderr,
        reason = "diagnostic for a CI host missing a C compiler, opt-in test infrastructure only"
    )]
    fn compile_enospc_shim(directory: &Path, name: &str) -> TestResult<Option<PathBuf>> {
        const SOURCE: &str = r#"
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static long budget = -1;
static char prefix[4096];
static int prefix_len = 0;
static int initialized = 0;

static void init_once(void) {
    if (initialized) return;
    const char *b = getenv("ENOSPC_SHIM_BUDGET_BYTES");
    const char *p = getenv("ENOSPC_SHIM_PREFIX");
    budget = b ? atol(b) : -1;
    if (p) {
        size_t n = strlen(p);
        if (n >= sizeof(prefix)) n = sizeof(prefix) - 1;
        memcpy(prefix, p, n);
        prefix[n] = '\0';
        prefix_len = (int)n;
    }
    initialized = 1;
}

static int fd_in_scope(int fd) {
    if (prefix_len == 0) return 0;
    char linkpath[64];
    char target[4096];
    int n = snprintf(linkpath, sizeof(linkpath), "/proc/self/fd/%d", fd);
    if (n <= 0 || (size_t)n >= sizeof(linkpath)) return 0;
    ssize_t len = readlink(linkpath, target, sizeof(target) - 1);
    if (len <= 0) return 0;
    target[len] = '\0';
    return strncmp(target, prefix, (size_t)prefix_len) == 0;
}

static int should_inject(int fd, size_t count) {
    init_once();
    if (budget < 0 || !fd_in_scope(fd)) return 0;
    if ((long)count > budget) return 1;
    budget -= (long)count;
    return 0;
}

typedef ssize_t (*write_fn)(int, const void *, size_t);
typedef ssize_t (*pwrite_fn)(int, const void *, size_t, off_t);

ssize_t write(int fd, const void *buf, size_t count) {
    static write_fn real = NULL;
    if (!real) real = (write_fn)dlsym(RTLD_NEXT, "write");
    if (should_inject(fd, count)) { errno = ENOSPC; return -1; }
    return real(fd, buf, count);
}

ssize_t pwrite(int fd, const void *buf, size_t count, off_t offset) {
    static pwrite_fn real = NULL;
    if (!real) real = (pwrite_fn)dlsym(RTLD_NEXT, "pwrite");
    if (should_inject(fd, count)) { errno = ENOSPC; return -1; }
    return real(fd, buf, count, offset);
}
"#;
        let source_path = directory.join(format!("oxigraph_upgrade_prepare_enospc_shim_{name}.c"));
        fs::write(&source_path, SOURCE)?;
        let shared_object =
            directory.join(format!("oxigraph_upgrade_prepare_enospc_shim_{name}.so"));
        let status = match std::process::Command::new("cc")
            .arg("-shared")
            .arg("-fPIC")
            .arg("-O2")
            .arg("-o")
            .arg(&shared_object)
            .arg(&source_path)
            .arg("-ldl")
            .status()
        {
            Ok(status) => status,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                eprintln!("skipping disk-exhaustion coverage: no `cc` on this host");
                return Ok(None);
            }
            Err(error) => return Err(error.into()),
        };
        if !status.success() {
            return Err(format!("cc exited with {status}").into());
        }
        Ok(Some(shared_object))
    }

    /// A real `ENOSPC`, not a synthetic phase callback, injected on the
    /// first byte `prepare_inner` ever writes: the journal metadata write,
    /// strictly between `phase(0)` and `phase(1)`. Neither
    /// `failures_before_completion_preserve_both_inputs_and_refuse_preparation`
    /// (which can only fail exactly at an integer phase boundary) nor
    /// `preparation_child_exits_before_and_after_the_completion_rename`
    /// (which targets the later PENDING-to-COMPLETE rename) can reach this
    /// moment. Mirrors `stop == 0`'s own established invariant set exactly:
    /// an empty, guard-less `store` directory does not itself prove
    /// `UpgradeIncomplete`, so this test does not assert that either,
    /// matching what the phase-callback test above already declines to
    /// assume for the same window.
    #[test]
    fn disk_exhaustion_before_the_journal_write_preserves_both_inputs() -> TestResult {
        if !cfg!(target_os = "linux") {
            return Ok(());
        }
        let shim_directory = std::env::current_exe()?
            .parent()
            .ok_or("test binary has no parent directory")?
            .to_owned();
        let Some(shim) = compile_enospc_shim(&shim_directory, "journal")? else {
            return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
        };
        let directory = tempfile::tempdir()?;
        let root = directory.path().canonicalize()?;
        let source = root.join("source");
        let package = root.join("backup");
        let output = root.join("prepared");
        fixture(1, &source)?;
        let before_source = hashes(&source)?;
        let options = LegacyBackupOptions::default();
        Store::backup_legacy(&source, &package, &options)?;
        let before_package = hashes(&package.join("store"))?;
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command
            .arg("--exact")
            .arg(helper("prepare_upgrade_enospc_process_helper"));
        command.env("LD_PRELOAD", shim);
        command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
        command.env("ENOSPC_SHIM_PREFIX", &output);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_SOURCE", &source);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_PACKAGE", &package);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_OUTPUT", &output);
        let status = command.status()?;
        assert!(status.success(), "child helper failed: {status:?}");
        // Only prepare_inner's pre-journal-write setup creates this
        // directory, and no failure path removes it: positive evidence the
        // child actually reached prepare_inner, not just that it exited 0.
        assert!(
            output.join("store").is_dir(),
            "the child never reached prepare_inner's setup"
        );
        // Pins the exact injection point, not just its consequence: the
        // journal file exists (its create succeeded) but is zero bytes (its
        // first write failed), and the guard write that would follow it
        // never ran. Without this, the assertions below would pass
        // identically for a fault landing on the guard write or inside the
        // copy loop instead, so the claimed "before the journal write"
        // failure site would be established only by code reading, not by
        // these post-conditions.
        assert_eq!(fs::metadata(output.join(JOURNAL))?.len(), 0);
        assert!(!output.join("store").join(UPGRADE_GUARD).exists());
        assert!(!output.join(COMPLETE).exists());
        assert!(PreparedUpgrade::verify(&output, &options).is_err());
        assert_eq!(hashes(&source)?, before_source);
        assert_eq!(hashes(&package.join("store"))?, before_package);
        LegacyBackupReceipt::verify_ancestry(&source, &package, &TransactionStartControl::new())?;
        Ok(())
    }

    /// A real `ENOSPC` injected on the first byte the copy loop writes to
    /// its first non-empty file -- strictly after both the journal and
    /// guard writes succeeded in full, unlike
    /// `disk_exhaustion_before_the_journal_write_preserves_both_inputs`
    /// (which faults before either setup write runs). A zero-byte receipt
    /// file sorted first would copy in full with no `write()` call at all,
    /// so "first byte the loop writes" and "first receipt file" are not
    /// the same claim; this fixture's own sort-first file is non-empty,
    /// making them coincide here, but the phrasing follows
    /// `schema_upgrade_tests.rs`'s own more precise convention rather than
    /// assume that coincidence generally. Reuses the same
    /// `prepare_upgrade_enospc_process_helper`: the injection point is
    /// entirely determined by this test's own budget/prefix choice, not by
    /// which helper is invoked. `copy_artifact` always creates its
    /// destination via `create_new` before attempting to write it, so a
    /// zero-byte stub for that file, not its absence, is the positive
    /// evidence this test actually reached the loop.
    #[test]
    fn disk_exhaustion_during_the_preparation_copy_loop_preserves_both_inputs() -> TestResult {
        if !cfg!(target_os = "linux") {
            return Ok(());
        }
        let shim_directory = std::env::current_exe()?
            .parent()
            .ok_or("test binary has no parent directory")?
            .to_owned();
        let Some(shim) = compile_enospc_shim(&shim_directory, "copy")? else {
            return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
        };
        let directory = tempfile::tempdir()?;
        let root = directory.path().canonicalize()?;
        let source = root.join("source");
        let package = root.join("backup");
        let output = root.join("prepared");
        fixture(1, &source)?;
        let before_source = hashes(&source)?;
        let options = LegacyBackupOptions::default();
        let receipt = Store::backup_legacy(&source, &package, &options)?;
        let before_package = hashes(&package.join("store"))?;
        let store = output.join("store");
        // The whole design rests on this budget being large enough to let
        // the guard write through but not zero: pin it explicitly rather
        // than leaving it an unstated premise of GUARD's own definition.
        assert!(!GUARD.is_empty());
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command
            .arg("--exact")
            .arg(helper("prepare_upgrade_enospc_process_helper"));
        command.env("LD_PRELOAD", shim);
        command.env("ENOSPC_SHIM_BUDGET_BYTES", GUARD.len().to_string());
        command.env("ENOSPC_SHIM_PREFIX", &store);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_SOURCE", &source);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_PACKAGE", &package);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_OUTPUT", &output);
        let status = command.status()?;
        assert!(status.success(), "child helper failed: {status:?}");
        // The guard write's own budget was exactly consumed, not exceeded,
        // so it completed in full: positive evidence the child passed both
        // earlier setup writes and reached the copy loop specifically, not
        // a restatement of the journal-write test's own vacuous-pass guard.
        assert_eq!(
            fs::read(store.join(UPGRADE_GUARD))?,
            GUARD,
            "the guard write itself must have succeeded in full under this budget"
        );
        assert_eq!(fs::read(output.join(JOURNAL))?, journal(&receipt));
        let guard_path = PathBuf::from(UPGRADE_GUARD);
        let stubs = hashes(&store)?;
        assert!(
            stubs.keys().any(|path| *path != guard_path),
            "the child never reached prepare_inner's copy loop"
        );
        for path in stubs.keys() {
            if *path != guard_path {
                assert_eq!(fs::metadata(store.join(path))?.len(), 0);
                assert!(
                    package.join("store").join(path).is_file(),
                    "{path:?} is not a receipt file the copy loop could have created"
                );
            }
        }
        assert!(!output.join(COMPLETE).exists());
        assert!(PreparedUpgrade::verify(&output, &options).is_err());
        assert_eq!(hashes(&source)?, before_source);
        assert_eq!(hashes(&package.join("store"))?, before_package);
        LegacyBackupReceipt::verify_ancestry(&source, &package, &TransactionStartControl::new())?;
        Ok(())
    }

    /// A real `ENOSPC` injected on the first byte the preparation manifest
    /// write ever makes -- strictly after the journal write, the guard
    /// write, and the entire copy loop have all already succeeded in
    /// full, unlike either test above (which fault the journal write
    /// itself, or the copy loop's own first write). `PENDING`
    /// (`destination.join(PENDING)`) is a sibling of `store/`, not nested
    /// under it, so scoping `ENOSPC_SHIM_PREFIX` to that exact file means
    /// none of the three earlier writes (the journal, the guard, or any
    /// copied file, all of which live under `destination` but never under
    /// this exact path) can ever match the prefix, at any budget. Reuses
    /// `prepare_upgrade_enospc_process_helper` unchanged.
    #[test]
    fn disk_exhaustion_on_the_preparation_manifest_write_preserves_the_completed_copy() -> TestResult
    {
        if !cfg!(target_os = "linux") {
            return Ok(());
        }
        let shim_directory = std::env::current_exe()?
            .parent()
            .ok_or("test binary has no parent directory")?
            .to_owned();
        let Some(shim) = compile_enospc_shim(&shim_directory, "pending")? else {
            return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
        };
        let directory = tempfile::tempdir()?;
        let root = directory.path().canonicalize()?;
        let source = root.join("source");
        let package = root.join("backup");
        let output = root.join("prepared");
        fixture(1, &source)?;
        let before_source = hashes(&source)?;
        let options = LegacyBackupOptions::default();
        let receipt = Store::backup_legacy(&source, &package, &options)?;
        let before_package = hashes(&package.join("store"))?;
        let store = output.join("store");
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command
            .arg("--exact")
            .arg(helper("prepare_upgrade_enospc_process_helper"));
        command.env("LD_PRELOAD", shim);
        command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
        command.env("ENOSPC_SHIM_PREFIX", output.join(PENDING));
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_SOURCE", &source);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_PACKAGE", &package);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_OUTPUT", &output);
        let status = command.status()?;
        assert!(status.success(), "child helper failed: {status:?}");
        // Neither the journal nor the guard write ever matched the
        // PENDING-file-specific prefix, so both are positive evidence the
        // fault landed strictly after both -- not a restatement of either
        // earlier test's own vacuous-pass guard.
        assert_eq!(fs::read(output.join(JOURNAL))?, journal(&receipt));
        assert_eq!(
            fs::read(store.join(UPGRADE_GUARD))?,
            GUARD,
            "the guard write itself must have succeeded in full under this budget"
        );
        // The copy loop's own writes never matched the prefix either, at
        // any budget: positive evidence every file copied in full, not
        // just that the child process happened to exit 0.
        let mut copied = hashes(&store)?;
        assert_eq!(
            copied.remove(&PathBuf::from(UPGRADE_GUARD)),
            Some(Sha256::digest(GUARD).into())
        );
        assert_eq!(
            copied,
            hashes(&package.join("store"))?,
            "the copy loop must have completed in full before the manifest write ran"
        );
        assert!(output.join(PENDING).exists());
        assert_eq!(fs::metadata(output.join(PENDING))?.len(), 0);
        assert!(!output.join(COMPLETE).exists());
        assert!(PreparedUpgrade::verify(&output, &options).is_err());
        assert_eq!(hashes(&source)?, before_source);
        assert_eq!(hashes(&package.join("store"))?, before_package);
        LegacyBackupReceipt::verify_ancestry(&source, &package, &TransactionStartControl::new())?;
        Ok(())
    }

    /// A real `ENOSPC` injected on the first byte the guard write itself
    /// ever makes -- unlike every test above, none of which lets this
    /// specific write fail: the first faults the journal write before the
    /// guard is ever attempted, the second and third let the guard
    /// write's own `GUARD.len()` bytes through in full (via an exact
    /// budget) or bypass it entirely (via a `PENDING`-file-specific
    /// prefix) so they can fault something later instead. `private_
    /// directory(&store)` runs before the journal write, so `store/`
    /// already exists when this fault lands; scoping `ENOSPC_SHIM_PREFIX`
    /// to that directory with budget zero means the guard write -- the
    /// first write `store/` ever receives -- is the one write in scope
    /// from the very first byte, and the journal write (not nested under
    /// `store/`) runs to completion unconstrained, exactly as in the
    /// `PENDING`-write test above.
    #[test]
    fn disk_exhaustion_on_the_preparation_guard_write_preserves_both_inputs() -> TestResult {
        if !cfg!(target_os = "linux") {
            return Ok(());
        }
        let shim_directory = std::env::current_exe()?
            .parent()
            .ok_or("test binary has no parent directory")?
            .to_owned();
        let Some(shim) = compile_enospc_shim(&shim_directory, "guard")? else {
            return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
        };
        let directory = tempfile::tempdir()?;
        let root = directory.path().canonicalize()?;
        let source = root.join("source");
        let package = root.join("backup");
        let output = root.join("prepared");
        fixture(1, &source)?;
        let before_source = hashes(&source)?;
        let options = LegacyBackupOptions::default();
        let receipt = Store::backup_legacy(&source, &package, &options)?;
        let before_package = hashes(&package.join("store"))?;
        let store = output.join("store");
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command
            .arg("--exact")
            .arg(helper("prepare_upgrade_enospc_process_helper"));
        command.env("LD_PRELOAD", shim);
        command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
        command.env("ENOSPC_SHIM_PREFIX", &store);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_SOURCE", &source);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_PACKAGE", &package);
        command.env("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_OUTPUT", &output);
        let status = command.status()?;
        assert!(status.success(), "child helper failed: {status:?}");
        // The journal write never matched the store/-scoped prefix, so it
        // was never subject to the budget at all: positive evidence it
        // ran to completion before the fault, not a restatement of the
        // guard-write success the other tests' own budgets engineer.
        assert_eq!(fs::read(output.join(JOURNAL))?, journal(&receipt));
        // create_new succeeds before write_all's first byte fails, so the
        // guard file exists but is empty -- and, since it is the only
        // write store/ ever received before the fault, it is the only
        // entry store/ contains: positive evidence the copy loop never
        // started, not just that the child process happened to exit 0.
        let contents = hashes(&store)?;
        assert_eq!(
            contents.keys().collect::<Vec<_>>(),
            vec![&PathBuf::from(UPGRADE_GUARD)],
            "the child must have reached the guard write and nothing beyond it"
        );
        assert_eq!(fs::metadata(store.join(UPGRADE_GUARD))?.len(), 0);
        assert!(!output.join(PENDING).exists());
        assert!(!output.join(COMPLETE).exists());
        assert!(PreparedUpgrade::verify(&output, &options).is_err());
        assert_eq!(hashes(&source)?, before_source);
        assert_eq!(hashes(&package.join("store"))?, before_package);
        LegacyBackupReceipt::verify_ancestry(&source, &package, &TransactionStartControl::new())?;
        Ok(())
    }

    #[test]
    fn prepare_upgrade_enospc_process_helper() -> TestResult {
        let Some(source) = std::env::var_os("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_SOURCE") else {
            return Ok(()); // An ordinary run: only the parent test re-invokes this.
        };
        let source = PathBuf::from(source);
        let package = variable("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_PACKAGE")?;
        let output = variable("OXIGRAPH_UPGRADE_PREPARE_ENOSPC_TEST_OUTPUT")?;
        let result =
            Store::prepare_upgrade(&source, &package, &output, &LegacyBackupOptions::default());
        match result {
            Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
            other => Err(format!("expected a StorageFull BackupError::Io, got {other:?}").into()),
        }
    }
}
