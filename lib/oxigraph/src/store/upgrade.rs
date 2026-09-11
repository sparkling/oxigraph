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
    TransformedUpgrade, UpgradeActivation, UpgradeOptions, UpgradeReceipt, UpgradeRecovery,
    UpgradeRecoveryOptions, UpgradeTransformOptions,
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
}
