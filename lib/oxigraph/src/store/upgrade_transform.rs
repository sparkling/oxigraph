//! Explicit offline transformation, restart and exact-build sealing. No activation.
use super::*;
use crate::store::BackupFile;
use std::num::{NonZeroU64, NonZeroUsize};

const TRANSFORM_JOURNAL: &str = "oxigraph-upgrade-transform.journal";
const TRANSFORM_COMPLETE: &str = "oxigraph-upgrade-transformed.complete";
const TRANSFORM_PENDING: &str = "oxigraph-upgrade-transformed.pending";
const TRANSFORM_MAGIC: &[u8] = b"oxigraph.transformed-inactive.v1\0";

#[path = "upgrade_receipt.rs"]
mod receipt;
#[path = "upgrade_resume.rs"]
mod resume;
pub use receipt::{
    SchemaUpgradeActivation, SchemaUpgradeOptions, SchemaUpgradeReceipt, SchemaUpgradeState,
    UpgradeActivation, UpgradeOptions, UpgradeReceipt, UpgradeWorkspaceInspection,
    UpgradeWorkspaceState,
};
pub use resume::{UpgradeRecovery, UpgradeRecoveryOptions};

/// Cooperative limits for an offline explicit transformation.
/// Projection limits bound retained canonical entries and bytes per projection,
/// not native RocksDB memory, temporary term decoding, filesystem capacity or RSS.
/// Interruptions require a fresh preparation; they are not resumable.
#[derive(Clone)]
pub struct UpgradeTransformOptions {
    pub backup: LegacyBackupOptions,
    pub max_entries: NonZeroUsize,
    pub max_projection_bytes: NonZeroU64,
}
impl Default for UpgradeTransformOptions {
    fn default() -> Self {
        Self {
            backup: LegacyBackupOptions::default(),
            max_entries: NonZeroUsize::new(1_000_000).unwrap_or(NonZeroUsize::MIN),
            max_projection_bytes: NonZeroU64::new(256 * 1024 * 1024).unwrap_or(NonZeroU64::MIN),
        }
    }
}

/// Content-bound observation of a transformed but still inactive workspace.
/// This is not a sealed UpgradeReceipt, activation permission, or production
/// qualification. Ordinary opens continue to refuse its nested store.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransformedUpgrade {
    directory: PathBuf,
    receipt: LegacyBackupReceipt,
    logical: [u8; 32],
    counts: [u64; 3],
    files: Vec<BackupFile>,
    journal: [u8; 32],
}
impl TransformedUpgrade {
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub const fn manifest_name() -> &'static str {
        TRANSFORM_COMPLETE
    }
    pub const fn journal_name() -> &'static str {
        TRANSFORM_JOURNAL
    }
    pub const fn quad_count(&self) -> u64 {
        self.counts[0]
    }
    pub const fn named_graph_count(&self) -> u64 {
        self.counts[1]
    }
    pub const fn namespace_count(&self) -> u64 {
        self.counts[2]
    }
    pub const fn logical_fingerprint(&self) -> [u8; 32] {
        self.logical
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        envelope_checksum(TRANSFORM_MAGIC, &self.encode())
    }
    pub fn files(&self) -> &[BackupFile] {
        &self.files
    }

    /// Independently rechecks ancestry, expected logical state and exact output.
    /// All paths must be offline, exclusively controlled and disjoint.
    pub fn verify(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &UpgradeTransformOptions,
    ) -> Result<Self, BackupError> {
        let started = Instant::now();
        let source = stable_directory(source.as_ref())?;
        let package = stable_directory(completed_legacy_backup.as_ref())?;
        let directory = stable_directory(directory.as_ref())?;
        disjoint(&source, &package, &directory)?;
        let (receipt, source_lease, package_lease) = LegacyBackupReceipt::verify_ancestry_leased(
            &source,
            &package,
            &options.backup,
            started,
        )?;
        let expected = source_lease
            .project_upgrade(options, started)
            .map_err(|error| {
                check(&options.backup.control, started)
                    .err()
                    .unwrap_or(BackupError::Storage(error))
            })?;
        let logical = expected.fingerprint();
        let counts = [
            expected.quad_count(),
            expected.graph_count(),
            expected.namespace_count(),
        ];
        let result = Self::verify_with_held_inputs(
            &source, &package, &directory, options, started, &receipt, logical, counts, Ok,
        )?;
        drop(package_lease);
        drop(source_lease);
        Ok(result)
    }

    /// Verifies a transformed output without reacquiring already-held inputs.
    ///
    /// The callback runs while the final native output lease is retained. Its
    /// caller owns the already-held source/package leases and projected identity.
    pub(super) fn verify_with_held_inputs<T>(
        source: &Path,
        package: &Path,
        directory: &Path,
        options: &UpgradeTransformOptions,
        started: Instant,
        receipt: &LegacyBackupReceipt,
        logical: [u8; 32],
        counts: [u64; 3],
        verified: impl FnOnce(Self) -> Result<T, BackupError>,
    ) -> Result<T, BackupError> {
        workspace(directory)?;
        let mut result = Self::decode(&read(&directory.join(TRANSFORM_COMPLETE), MAX_MANIFEST)?)?;
        directory.clone_into(&mut result.directory);
        if &result.receipt != receipt
            || result.logical != logical
            || result.counts != counts
            || &decode(&read(&directory.join(COMPLETE), MAX_MANIFEST)?)? != receipt
            || read(&directory.join(JOURNAL), 512)? != journal(receipt)
        {
            return Err(BackupError::FileMismatch);
        }
        let expected_journal = completed_journal(receipt, &logical);
        if read(&directory.join(TRANSFORM_JOURNAL), 4096)? != expected_journal
            || result.journal != envelope_checksum(TRANSFORM_MAGIC, &expected_journal)
        {
            return Err(BackupError::InvalidManifest);
        }
        let store = stable_directory(&directory.join("store"))?;
        if physical_files(&store, &options.backup, started, false)? != result.files {
            return Err(BackupError::FileMismatch);
        }
        let output_lease = LegacyStoreSnapshot::verify_transformed(
            &store, logical, options, started,
        )
        .map_err(|error| {
            check(&options.backup.control, started)
                .err()
                .unwrap_or(BackupError::Storage(error))
        })?;
        if physical_files(&store, &options.backup, started, false)? != result.files {
            return Err(BackupError::FileMismatch);
        }
        recheck_inputs(source, package, receipt, &options.backup, started)?;
        check(&options.backup.control, started)?;
        let answer = verified(result);
        drop(output_lease);
        answer
    }

    fn encode(&self) -> Vec<u8> {
        let mut out = TRANSFORM_MAGIC.to_vec();
        out.push(u8::from(cfg!(feature = "rdf-12")));
        blob(&mut out, &self.receipt.encode());
        out.extend_from_slice(&self.logical);
        for value in self.counts {
            out.extend_from_slice(&value.to_be_bytes());
        }
        out.extend_from_slice(&self.journal);
        out.extend_from_slice(&(self.files.len() as u64).to_be_bytes());
        for file in &self.files {
            blob(&mut out, file.path().as_bytes());
            out.extend_from_slice(&file.size().to_be_bytes());
            out.extend_from_slice(file.sha256());
        }
        let checksum = envelope_checksum(TRANSFORM_MAGIC, &out);
        out.extend_from_slice(&checksum);
        out
    }
    fn decode(bytes: &[u8]) -> Result<Self, BackupError> {
        if bytes.len() > MAX_MANIFEST {
            return Err(BackupError::Limit);
        }
        let split = bytes
            .len()
            .checked_sub(32)
            .ok_or(BackupError::InvalidManifest)?;
        let (body, checksum) = bytes.split_at(split);
        if !body.starts_with(TRANSFORM_MAGIC)
            || envelope_checksum(TRANSFORM_MAGIC, body) != checksum
        {
            return Err(BackupError::InvalidManifest);
        }
        let mut d = Decode(&body[TRANSFORM_MAGIC.len()..]);
        if d.take(1)? != [u8::from(cfg!(feature = "rdf-12"))] {
            return Err(BackupError::InvalidManifest);
        }
        let receipt = LegacyBackupReceipt::decode(d.blob(MAX_MANIFEST)?)?;
        let logical = d.hash()?;
        let counts = [d.u64()?, d.u64()?, d.u64()?];
        let journal = d.hash()?;
        let count = usize::try_from(d.u64()?).map_err(|_| BackupError::Limit)?;
        if count > 100_001 {
            return Err(BackupError::Limit);
        }
        let mut files: Vec<BackupFile> = Vec::new();
        for _ in 0..count {
            let name = std::str::from_utf8(d.blob(240)?)
                .map_err(|_| BackupError::InvalidManifest)?
                .to_owned();
            if (name != UPGRADE_GUARD && !transformed_native_name(&name))
                || files.last().is_some_and(|f| f.path() >= name.as_str())
            {
                return Err(BackupError::InvalidManifest);
            }
            files.push(BackupFile::new(name, d.u64()?, d.hash()?));
        }
        if !d.0.is_empty() {
            return Err(BackupError::InvalidManifest);
        }
        Ok(Self {
            directory: PathBuf::new(),
            receipt,
            logical,
            counts,
            files,
            journal,
        })
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "separate explicit offline upgrade API"
)]
impl Store {
    /// Transforms only a verified prepared copy; neither source nor backup changes.
    /// A durable append-only edge journal precedes native mutation. Failure retains
    /// the inactive workspace and requires a fresh preparation. A post-completion
    /// error is indeterminate; resolve it with TransformedUpgrade::verify.
    pub fn transform_prepared_upgrade(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        prepared_directory: impl AsRef<Path>,
        options: &UpgradeTransformOptions,
    ) -> Result<TransformedUpgrade, BackupError> {
        transform_inner(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            prepared_directory.as_ref(),
            options,
            |_| Ok(()),
        )
    }
}

fn transform_inner(
    source: &Path,
    package: &Path,
    directory: &Path,
    options: &UpgradeTransformOptions,
    mut fault: impl FnMut(u8) -> Result<(), BackupError>,
) -> Result<TransformedUpgrade, BackupError> {
    let started = Instant::now();
    check_options(&options.backup, started)?;
    if !cfg!(unix) {
        return Err(BackupError::UnsupportedPlatform);
    }
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let directory = stable_directory(directory)?;
    disjoint(&source, &package, &directory)?;
    let (receipt, source_lease, _package_lease) =
        LegacyBackupReceipt::verify_ancestry_leased(&source, &package, &options.backup, started)?;
    let (prepared, copy_lease) =
        PreparedUpgrade::verify_leased(&directory, &options.backup, started)?;
    if prepared.receipt != receipt {
        return Err(BackupError::FileMismatch);
    }
    // Feature/profile/bounds refusals occur before journal creation or writable open.
    let expected = source_lease
        .project_upgrade(options, started)
        .map_err(|error| {
            check(&options.backup.control, started)
                .err()
                .unwrap_or(BackupError::Storage(error))
        })?;
    let logical = expected.fingerprint();
    fault(0)?;
    check(&options.backup.control, started)?;
    let mut frames = Vec::new();
    let mut last = None;
    let output_lease = copy_lease
        .transform_upgrade(&expected, options, started, |edge| {
            check(&options.backup.control, started).map_err(storage_error)?;
            if last != Some(edge) {
                let frame = journal_frame(edge, &receipt, &logical, &frames);
                let path = directory.join(TRANSFORM_JOURNAL);
                let mut file = if last.is_none() {
                    OpenOptions::new().write(true).create_new(true).open(&path)
                } else {
                    OpenOptions::new().append(true).open(&path)
                }?;
                file.write_all(&frame)?;
                file.sync_all()?;
                frames.extend_from_slice(&frame);
                sync_directory(&directory)?;
                last = Some(edge);
            }
            let phase = u8::try_from(edge)
                .ok()
                .and_then(|edge| edge.checked_add(1))
                .ok_or_else(|| storage_error(BackupError::Limit))?;
            fault(phase).map_err(storage_error)
        })
        .map_err(|error| {
            check(&options.backup.control, started)
                .err()
                .unwrap_or(BackupError::Storage(error))
        })?;
    fault(4)?;
    check(&options.backup.control, started)?;
    // Db is closed, but output_lease keeps the same exclusive native lock alive.
    let projection = output_lease.projection();
    if projection.fingerprint() != logical {
        return Err(BackupError::FileMismatch);
    }
    let store = directory.join("store");
    sync_directory(&store)?;
    let files = physical_files(&store, &options.backup, started, true)?;
    sync_directory(&store)?;
    recheck_inputs(&source, &package, &receipt, &options.backup, started)?;
    if frames != completed_journal(&receipt, &logical) {
        return Err(BackupError::InvalidManifest);
    }
    let result = TransformedUpgrade {
        directory: directory.clone(),
        receipt,
        logical,
        counts: [
            projection.quad_count(),
            projection.graph_count(),
            projection.namespace_count(),
        ],
        files,
        journal: envelope_checksum(TRANSFORM_MAGIC, &frames),
    };
    let bytes = result.encode();
    TransformedUpgrade::decode(&bytes)?;
    write(&directory.join(TRANSFORM_PENDING), &bytes)?;
    sync_directory(&directory)?;
    fault(5)?;
    check(&options.backup.control, started)?;
    fs::rename(
        directory.join(TRANSFORM_PENDING),
        directory.join(TRANSFORM_COMPLETE),
    )?;
    fault(6).map_err(indeterminate)?;
    check(&options.backup.control, started).map_err(indeterminate)?;
    sync_directory(&directory).map_err(BackupError::CompletionIndeterminate)?;
    Ok(result)
}

fn storage_error(error: BackupError) -> crate::storage::StorageError {
    crate::storage::StorageError::Io(io::Error::other(error))
}
fn disjoint(a: &Path, b: &Path, c: &Path) -> Result<(), BackupError> {
    for (x, y) in [(a, b), (a, c), (b, c)] {
        if x.starts_with(y) || y.starts_with(x) {
            return Err(BackupError::InvalidPath);
        }
    }
    Ok(())
}
fn recheck_inputs(
    source: &Path,
    package: &Path,
    receipt: &LegacyBackupReceipt,
    options: &LegacyBackupOptions,
    started: Instant,
) -> Result<(), BackupError> {
    if inventory(source, options, started)? != receipt.files()
        || inventory(&package.join("store"), options, started)? != receipt.files()
        || read(
            &package.join(LegacyBackupReceipt::manifest_name()),
            MAX_MANIFEST,
        )? != receipt.encode()
    {
        return Err(BackupError::FileMismatch);
    }
    Ok(())
}
fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// Duplicates legacy_backup's native-name policy until physical inventories share
/// one internal helper. The preparation guard is admitted separately.
fn transformed_native_name(name: &str) -> bool {
    name.len() <= 240
        && (matches!(name, "CURRENT" | "LOCK" | "IDENTITY" | "LOG")
            || ["MANIFEST-", "OPTIONS-", "LOG.old."]
                .iter()
                .any(|prefix| name.strip_prefix(prefix).is_some_and(digits))
            || [".log", ".sst", ".ldb", ".blob", ".dbtmp"]
                .iter()
                .any(|suffix| name.strip_suffix(suffix).is_some_and(digits)))
}
#[expect(
    clippy::filetype_is_file,
    reason = "the transformed store must reject symlinks and non-regular filesystem objects"
)]
fn physical_files(
    path: &Path,
    options: &LegacyBackupOptions,
    started: Instant,
    sync: bool,
) -> Result<Vec<BackupFile>, BackupError> {
    if read(&path.join(UPGRADE_GUARD), GUARD.len())? != GUARD {
        return Err(BackupError::InvalidManifest);
    }
    let mut files = Vec::new();
    let mut total = 0_u64;
    let mut native_count = 0_usize;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            return Err(BackupError::InvalidPath);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if name != UPGRADE_GUARD {
            if !transformed_native_name(&name) {
                return Err(BackupError::InvalidPath);
            }
            native_count += 1;
            if native_count > options.max_files.get() {
                return Err(BackupError::Limit);
            }
        }
        let (size, hash) = hash_file(
            &entry.path(),
            &options.control,
            started,
            options.max_bytes.get().saturating_sub(total),
            sync,
        )?;
        total = total
            .checked_add(size)
            .filter(|v| *v <= options.max_bytes.get())
            .ok_or(BackupError::Limit)?;
        files.push(BackupFile::new(name, size, hash));
    }
    files.sort_unstable_by(|a, b| a.path().cmp(b.path()));
    let current = read(&path.join("CURRENT"), 127)?;
    let current = std::str::from_utf8(&current).map_err(|_| BackupError::InvalidManifest)?;
    let name = current
        .strip_suffix('\n')
        .ok_or(BackupError::InvalidManifest)?;
    let digits = name
        .strip_prefix("MANIFEST-")
        .ok_or(BackupError::InvalidManifest)?;
    if digits.is_empty()
        || !digits.bytes().all(|b| b.is_ascii_digit())
        || !files.iter().any(|f| f.path() == name)
        || !files.iter().any(|f| f.path() == "LOCK")
    {
        return Err(BackupError::InvalidManifest);
    }
    Ok(files)
}
#[expect(
    clippy::filetype_is_file,
    reason = "workspace manifests must be regular files and the store must be a directory"
)]
fn workspace(path: &Path) -> Result<(), BackupError> {
    let mut names = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if names.len() >= 5 {
            return Err(BackupError::InvalidPath);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if if name == "store" {
            !entry.file_type()?.is_dir()
        } else {
            !entry.file_type()?.is_file()
        } {
            return Err(BackupError::InvalidPath);
        }
        names.push(name);
    }
    names.sort_unstable();
    let mut expected = vec![
        "store",
        JOURNAL,
        COMPLETE,
        TRANSFORM_JOURNAL,
        TRANSFORM_COMPLETE,
    ];
    expected.sort_unstable();
    if names != expected {
        return Err(BackupError::InvalidManifest);
    }
    Ok(())
}
fn journal_frame(
    edge: u64,
    receipt: &LegacyBackupReceipt,
    logical: &[u8; 32],
    previous: &[u8],
) -> Vec<u8> {
    let mut out = b"oxigraph.upgrade-edge.v1\0".to_vec();
    out.extend_from_slice(&edge.to_be_bytes());
    out.extend_from_slice(&receipt.fingerprint());
    out.extend_from_slice(logical);
    out.extend_from_slice(&envelope_checksum(TRANSFORM_MAGIC, previous));
    let hash = envelope_checksum(TRANSFORM_MAGIC, &out);
    out.extend_from_slice(&hash);
    out
}
fn completed_journal(receipt: &LegacyBackupReceipt, logical: &[u8; 32]) -> Vec<u8> {
    let mut out = Vec::new();
    for edge in receipt.storage_version()..=2 {
        out.extend_from_slice(&journal_frame(edge, receipt, logical, &out));
    }
    out
}
fn blob(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
    out.extend_from_slice(bytes);
}
struct Decode<'a>(&'a [u8]);
impl<'a> Decode<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], BackupError> {
        if n > self.0.len() {
            return Err(BackupError::InvalidManifest);
        }
        let (value, rest) = self.0.split_at(n);
        self.0 = rest;
        Ok(value)
    }
    fn u64(&mut self) -> Result<u64, BackupError> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| BackupError::InvalidManifest)?,
        ))
    }
    fn hash(&mut self) -> Result<[u8; 32], BackupError> {
        self.take(32)?
            .try_into()
            .map_err(|_| BackupError::InvalidManifest)
    }
    fn blob(&mut self, max: usize) -> Result<&'a [u8], BackupError> {
        let n = usize::try_from(self.u64()?).map_err(|_| BackupError::Limit)?;
        if n > max {
            return Err(BackupError::Limit);
        }
        self.take(n)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
    fn fixture(path: &Path) -> Result {
        fs::create_dir(path)?;
        for entry in
            fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/rocksdb_bc_data"))?
        {
            let entry = entry?;
            fs::copy(entry.path(), path.join(entry.file_name()))?;
        }
        Ok(())
    }
    fn hashes(path: &Path) -> Result<BTreeMap<PathBuf, [u8; 32]>> {
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
    fn upgrade_fault_boundaries_preserve_inputs_and_keep_all_leases_until_return() -> Result {
        for stop in 0..=6 {
            let dir = tempfile::tempdir()?;
            let source = dir.path().join("source");
            let package = dir.path().join("backup");
            let prepared = dir.path().join("prepared");
            fixture(&source)?;
            let before = hashes(&source)?;
            let options = UpgradeTransformOptions::default();
            Store::backup_legacy(&source, &package, &options.backup)?;
            Store::prepare_upgrade(&source, &package, &prepared, &options.backup)?;
            let mut observed = false;
            let result = transform_inner(&source, &package, &prepared, &options, |phase| {
                for path in [&source, &package.join("store"), &prepared.join("store")] {
                    assert!(
                        !LegacyStoreSnapshot::upgrade_lease_available(path),
                        "native lease unexpectedly available at phase {phase} for {}",
                        path.display()
                    );
                }
                if phase == stop {
                    observed = true;
                    Err(BackupError::Cancelled)
                } else {
                    Ok(())
                }
            });
            assert!(observed, "phase {stop} was not exercised");
            assert!(result.is_err());
            assert_eq!(hashes(&source)?, before);
            assert_eq!(hashes(&package.join("store"))?, before);
            for path in [&source, &package.join("store"), &prepared.join("store")] {
                assert!(LegacyStoreSnapshot::upgrade_lease_available(path));
            }
            if stop == 6 {
                assert!(matches!(
                    result,
                    Err(BackupError::CompletionIndeterminate(_))
                ));
                TransformedUpgrade::verify(&source, &package, &prepared, &options)?;
            } else {
                assert!(!prepared.join(TRANSFORM_COMPLETE).exists());
                assert!(
                    TransformedUpgrade::verify(&source, &package, &prepared, &options).is_err()
                );
            }
            assert!(matches!(
                Store::open(prepared.join("store")),
                Err(crate::storage::StorageError::UpgradeIncomplete)
            ));
        }
        Ok(())
    }
    #[test]
    fn upgrade_cancellation_after_mutation_never_publishes_completion() -> Result {
        for stop in [1, 2, 3, 4, 5] {
            let dir = tempfile::tempdir()?;
            let source = dir.path().join("source");
            let package = dir.path().join("backup");
            let prepared = dir.path().join("prepared");
            fixture(&source)?;
            let before = hashes(&source)?;
            let options = UpgradeTransformOptions::default();
            Store::backup_legacy(&source, &package, &options.backup)?;
            Store::prepare_upgrade(&source, &package, &prepared, &options.backup)?;
            let control = options.backup.control.clone();
            assert!(matches!(
                transform_inner(&source, &package, &prepared, &options, |phase| {
                    if phase == stop {
                        control.cancel();
                    }
                    Ok(())
                }),
                Err(BackupError::Cancelled)
            ));
            assert!(!prepared.join(TRANSFORM_COMPLETE).exists());
            assert_eq!(hashes(&source)?, before);
            LegacyBackupReceipt::verify_ancestry(
                &source,
                &package,
                &crate::store::TransactionStartControl::new(),
            )?;
        }
        Ok(())
    }

    #[test]
    fn upgrade_deadline_covers_time_spent_between_projection_and_mutation() -> Result {
        let dir = tempfile::tempdir()?;
        let source = dir.path().join("source");
        let package = dir.path().join("backup");
        let prepared = dir.path().join("prepared");
        fixture(&source)?;
        let mut options = UpgradeTransformOptions::default();
        Store::backup_legacy(&source, &package, &options.backup)?;
        Store::prepare_upgrade(&source, &package, &prepared, &options.backup)?;
        options.backup.control = crate::store::TransactionStartControl::new()
            .with_timeout(std::time::Duration::from_secs(1));
        let result = transform_inner(&source, &package, &prepared, &options, |phase| {
            if phase == 1 {
                std::thread::sleep(std::time::Duration::from_millis(1100));
            }
            Ok(())
        });
        assert!(matches!(result, Err(BackupError::TimedOut)));
        assert!(!prepared.join(TRANSFORM_COMPLETE).exists());
        LegacyBackupReceipt::verify_ancestry(
            &source,
            &package,
            &crate::store::TransactionStartControl::new(),
        )?;
        Ok(())
    }

    fn physical_fixture(path: &Path) -> Result {
        fs::write(path.join(UPGRADE_GUARD), GUARD)?;
        fs::write(path.join("LOCK"), b"")?;
        fs::write(path.join("IDENTITY"), b"id")?;
        fs::write(path.join("CURRENT"), b"MANIFEST-1\n")?;
        fs::write(path.join("MANIFEST-1"), b"manifest")?;
        Ok(())
    }

    #[test]
    fn upgrade_physical_files_rejects_unknown_sidecars_and_counts_only_native_files() -> Result {
        let directory = tempfile::tempdir()?;
        physical_fixture(directory.path())?;
        fs::write(directory.path().join("unexpected"), b"sidecar")?;
        assert!(matches!(
            physical_files(
                directory.path(),
                &LegacyBackupOptions::default(),
                Instant::now(),
                false
            ),
            Err(BackupError::InvalidPath)
        ));
        fs::remove_file(directory.path().join("unexpected"))?;
        let options = LegacyBackupOptions {
            max_files: NonZeroUsize::new(4).unwrap(),
            ..LegacyBackupOptions::default()
        };
        assert_eq!(
            physical_files(directory.path(), &options, Instant::now(), false)?.len(),
            5
        );
        let options = LegacyBackupOptions {
            max_files: NonZeroUsize::new(3).unwrap(),
            ..LegacyBackupOptions::default()
        };
        assert!(matches!(
            physical_files(directory.path(), &options, Instant::now(), false),
            Err(BackupError::Limit)
        ));
        Ok(())
    }

    /// The libtest filter of one helper `#[test]`, which never names the crate.
    fn helper(name: &str) -> String {
        let module = module_path!();
        let path = module.split_once("::").map_or(module, |(_, rest)| rest);
        format!("{path}::{name}")
    }
    /// Re-invokes this same test binary at one helper, which exits 73 at `stop`.
    fn crash(name: &str, paths: &[(&str, &Path)], stop: u8) -> Result<std::process::ExitStatus> {
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command.arg("--exact").arg(helper(name));
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_TEST_EXIT_AT", stop.to_string());
        for (variable, path) in paths {
            command.env(variable, path);
        }
        Ok(command.status()?)
    }
    /// Reads one path that the parent test passed to a re-invoked helper.
    fn variable(name: &str) -> Result<PathBuf> {
        let Some(value) = std::env::var_os(name) else {
            return Err("the parent test passed no such path".into());
        };
        Ok(value.into())
    }

    #[test]
    fn transform_child_exits_before_and_after_the_completion_rename() -> Result {
        for stop in [5_u8, 6] {
            let dir = tempfile::tempdir()?;
            let source = dir.path().join("source");
            let package = dir.path().join("backup");
            let prepared = dir.path().join(format!("prepared-{stop}"));
            fixture(&source)?;
            let before_source = hashes(&source)?;
            let options = UpgradeTransformOptions::default();
            Store::backup_legacy(&source, &package, &options.backup)?;
            Store::prepare_upgrade(&source, &package, &prepared, &options.backup)?;
            let before_package = hashes(&package.join("store"))?;
            let paths = [
                ("OXIGRAPH_UPGRADE_TRANSFORM_TEST_SOURCE", source.as_path()),
                ("OXIGRAPH_UPGRADE_TRANSFORM_TEST_PACKAGE", package.as_path()),
                (
                    "OXIGRAPH_UPGRADE_TRANSFORM_TEST_PREPARED",
                    prepared.as_path(),
                ),
            ];
            let status = crash("transform_process_helper", &paths, stop)?;
            assert_eq!(status.code(), Some(73), "the child did not reach {stop}");
            // The child's exclusive native leases are released by the kernel on
            // process exit, whether or not any in-process destructor ran.
            for path in [&source, &package.join("store"), &prepared.join("store")] {
                assert!(LegacyStoreSnapshot::upgrade_lease_available(path));
            }
            if stop == 5 {
                // Killed after TRANSFORM_PENDING is written and synced but
                // before the atomic rename to TRANSFORM_COMPLETE: the same
                // refused, verify-failing outcome as an in-process fault at
                // the same phase, because the rename never happened.
                assert!(!prepared.join(TRANSFORM_COMPLETE).exists());
                assert!(
                    TransformedUpgrade::verify(&source, &package, &prepared, &options).is_err()
                );
            } else {
                // Killed immediately after the rename: the marker is already
                // visible in the directory even though the process died
                // before the final directory fsync could run, matching the
                // existing synthetic stop-6 case, but now proven against a
                // real kernel-level process death.
                assert!(prepared.join(TRANSFORM_COMPLETE).exists());
                TransformedUpgrade::verify(&source, &package, &prepared, &options)?;
            }
            // Transformation completing does not activate the workspace: an
            // ordinary open still refuses it, regardless of stop, exactly as
            // the existing synthetic test asserts unconditionally too.
            assert!(matches!(
                Store::open(prepared.join("store")),
                Err(crate::storage::StorageError::UpgradeIncomplete)
            ));
            assert_eq!(hashes(&source)?, before_source);
            assert_eq!(hashes(&package.join("store"))?, before_package);
        }
        Ok(())
    }

    #[test]
    #[expect(
        clippy::exit,
        reason = "bounded child models an exact transform crash point"
    )]
    fn transform_process_helper() -> Result {
        let Some(source) = std::env::var_os("OXIGRAPH_UPGRADE_TRANSFORM_TEST_SOURCE") else {
            return Ok(()); // An ordinary run: only the parent test re-invokes this.
        };
        let source = PathBuf::from(source);
        let package = variable("OXIGRAPH_UPGRADE_TRANSFORM_TEST_PACKAGE")?;
        let prepared = variable("OXIGRAPH_UPGRADE_TRANSFORM_TEST_PREPARED")?;
        let stop = std::env::var("OXIGRAPH_UPGRADE_TRANSFORM_TEST_EXIT_AT")?.parse::<u8>()?;
        let options = UpgradeTransformOptions::default();
        transform_inner(&source, &package, &prepared, &options, |phase| {
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
    /// Identical to `legacy_backup.rs`'s and `upgrade.rs`'s already-reviewed
    /// `compile_enospc_shim` of the same name; duplicated file-local rather
    /// than shared, matching this session's own established convention of
    /// file-local crash-test infrastructure. `name` distinguishes each
    /// caller's own `.c`/`.so` filenames: this file is about to gain a
    /// second ENOSPC test, both runnable concurrently under libtest's
    /// default multithreading, and an unparameterized shared filename
    /// raced for real the first time this exact situation arose
    /// (`legacy_backup.rs`'s own two tests) -- applied proactively here
    /// before adding the second test, not after observing a flake.
    #[expect(
        clippy::print_stderr,
        reason = "diagnostic for a CI host missing a C compiler, opt-in test infrastructure only"
    )]
    fn compile_enospc_shim(directory: &Path, name: &str) -> Result<Option<PathBuf>> {
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
        let source_path =
            directory.join(format!("oxigraph_upgrade_transform_enospc_shim_{name}.c"));
        fs::write(&source_path, SOURCE)?;
        let shared_object =
            directory.join(format!("oxigraph_upgrade_transform_enospc_shim_{name}.so"));
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
    /// first byte of the first transform-journal frame -- strictly between
    /// `fault(0)` (fires before `transform_upgrade` starts) and `fault(1)`
    /// (fires only after the first edge's frame is written and synced).
    /// Unlike `prepare_inner`'s and `backup_inner`'s injection points, this
    /// one sits inside the RDF mutation loop itself, not pre-copy setup:
    /// the fault fires while real quad-projection work is already
    /// in flight, not before it starts. Neither
    /// `upgrade_fault_boundaries_preserve_inputs_and_keep_all_leases_until_return`
    /// (integer-boundary only) nor
    /// `transform_child_exits_before_and_after_the_completion_rename`
    /// (targets the later TRANSFORM_PENDING-to-COMPLETE rename) can reach
    /// this moment.
    #[test]
    fn disk_exhaustion_on_the_first_transform_journal_frame_preserves_inputs() -> Result {
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
        let prepared = root.join("prepared");
        fixture(&source)?;
        let before_source = hashes(&source)?;
        let options = UpgradeTransformOptions::default();
        Store::backup_legacy(&source, &package, &options.backup)?;
        Store::prepare_upgrade(&source, &package, &prepared, &options.backup)?;
        let before_package = hashes(&package.join("store"))?;
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command
            .arg("--exact")
            .arg(helper("transform_prepared_upgrade_enospc_process_helper"));
        command.env("LD_PRELOAD", shim);
        command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
        command.env("ENOSPC_SHIM_PREFIX", &prepared);
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_SOURCE", &source);
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_PACKAGE", &package);
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_PREPARED", &prepared);
        let status = command.status()?;
        assert!(status.success(), "child helper failed: {status:?}");
        // The kernel releases the child's exclusive native leases on process
        // exit regardless of how it exited.
        for path in [&source, &package.join("store"), &prepared.join("store")] {
            assert!(LegacyStoreSnapshot::upgrade_lease_available(path));
        }
        // Only the mutation loop's own first-frame open creates this file
        // (create_new, before the write that then fails), so its existence
        // is positive evidence the child reached transform_inner's real
        // work, not just that it exited 0; its zero length pins the fault
        // to that first write specifically, not a later frame or the
        // completion rename.
        assert!(
            prepared.join(TRANSFORM_JOURNAL).exists(),
            "the child never reached transform_inner's mutation loop"
        );
        assert_eq!(fs::metadata(prepared.join(TRANSFORM_JOURNAL))?.len(), 0);
        assert!(!prepared.join(TRANSFORM_COMPLETE).exists());
        assert!(TransformedUpgrade::verify(&source, &package, &prepared, &options).is_err());
        assert!(matches!(
            Store::open(prepared.join("store")),
            Err(crate::storage::StorageError::UpgradeIncomplete)
        ));
        assert_eq!(hashes(&source)?, before_source);
        assert_eq!(hashes(&package.join("store"))?, before_package);
        Ok(())
    }

    /// A real `ENOSPC` injected on the first byte the final `TRANSFORM_
    /// PENDING` manifest write ever makes -- strictly after every journal
    /// frame and the entire native mutation loop have already succeeded,
    /// unlike the test above (which faults the very first frame). `TRANSFORM_
    /// PENDING` is a sibling of both `TRANSFORM_JOURNAL` and `store/` at
    /// `directory`'s own root, and its string does not share a prefix with
    /// either (`"...transform.journal"` vs `"...transformed.pending"`
    /// diverge immediately after `"transform"`), so scoping `ENOSPC_SHIM_
    /// PREFIX` to that exact file means neither the journal's own frame
    /// writes nor any of the mutation loop's native `store/` writes --
    /// whose aggregate volume this technique cannot otherwise account for
    /// -- can ever match the prefix, at any budget: the file-specific
    /// technique this crate has already used for `resume_inner`'s `JOURNAL`
    /// entry and for `backup_inner`'s and `prepare_inner`'s own `PENDING`
    /// writes, reused here for a third, structurally distinct function.
    /// Reuses `transform_prepared_upgrade_enospc_process_helper` unchanged;
    /// the specific error kind it demands (`StorageFull`, not
    /// `InvalidManifest`) is itself part of the proof that the journal's
    /// own internal `frames != completed_journal(...)` check already
    /// passed inside the child before this fault ever landed.
    #[test]
    fn disk_exhaustion_on_the_transform_manifest_write_preserves_every_input() -> Result {
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
        let prepared = root.join("prepared");
        fixture(&source)?;
        let before_source = hashes(&source)?;
        let options = UpgradeTransformOptions::default();
        Store::backup_legacy(&source, &package, &options.backup)?;
        Store::prepare_upgrade(&source, &package, &prepared, &options.backup)?;
        let before_package = hashes(&package.join("store"))?;
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command
            .arg("--exact")
            .arg(helper("transform_prepared_upgrade_enospc_process_helper"));
        command.env("LD_PRELOAD", shim);
        command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
        command.env("ENOSPC_SHIM_PREFIX", prepared.join(TRANSFORM_PENDING));
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_SOURCE", &source);
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_PACKAGE", &package);
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_PREPARED", &prepared);
        let status = command.status()?;
        assert!(status.success(), "child helper failed: {status:?}");
        for path in [&source, &package.join("store"), &prepared.join("store")] {
            assert!(LegacyStoreSnapshot::upgrade_lease_available(path));
        }
        // Neither the journal frame writes nor any native store/ write ever
        // matched this exact-file prefix, so both ran to completion
        // unconstrained: positive evidence the mutation loop actually
        // finished, not just that the child process happened to exit 0.
        assert!(
            prepared.join(TRANSFORM_JOURNAL).exists(),
            "the child never reached transform_inner's mutation loop"
        );
        assert!(fs::metadata(prepared.join(TRANSFORM_JOURNAL))?.len() > 0);
        assert!(prepared.join(TRANSFORM_PENDING).exists());
        assert_eq!(fs::metadata(prepared.join(TRANSFORM_PENDING))?.len(), 0);
        assert!(!prepared.join(TRANSFORM_COMPLETE).exists());
        assert!(TransformedUpgrade::verify(&source, &package, &prepared, &options).is_err());
        assert!(matches!(
            Store::open(prepared.join("store")),
            Err(crate::storage::StorageError::UpgradeIncomplete)
        ));
        assert_eq!(hashes(&source)?, before_source);
        assert_eq!(hashes(&package.join("store"))?, before_package);
        Ok(())
    }

    /// A real `ENOSPC` injected on the first byte the *second* journal
    /// frame ever writes -- a genuinely different code branch from the
    /// first frame's own already-tested boundary: `last.is_none()` is
    /// only true for the first frame, so every later frame opens via
    /// the append arm of the journal open, not the first frame's
    /// `create_new` arm, and reaching it exercises `completed_journal`'s
    /// own multi-frame accumulation (`journal_frame(edge, receipt,
    /// logical, &frames)`, folding in the previous frames' own
    /// checksum) rather than the single-frame case. Real fixtures
    /// produce more than one edge --
    /// `completed_journal` iterates `receipt.storage_version()..=2`, and
    /// this file's own `fixture` uses version-0 legacy data, giving edges
    /// `0, 1, 2` -- so this boundary is reachable, not hypothetical.
    /// `journal_frame`'s own output length does not depend on the
    /// *values* of `receipt`, `edge`, `logical`, or `previous`, only on
    /// their fixed byte widths (`receipt.fingerprint()` and
    /// `envelope_checksum` both return `[u8; 32]` unconditionally), so
    /// calling it here with the real `receipt` but a placeholder all-zero
    /// `logical` -- this test has no legitimate way to obtain the real
    /// projection fingerprint without duplicating `project_upgrade`'s own
    /// native machinery -- still yields the exact byte length the real
    /// first frame will have, matching this crate's own "never a magic
    /// number for a computable quantity" discipline without needing the
    /// real value.
    #[test]
    fn disk_exhaustion_on_the_second_transform_journal_frame_preserves_inputs() -> Result {
        if !cfg!(target_os = "linux") {
            return Ok(());
        }
        let shim_directory = std::env::current_exe()?
            .parent()
            .ok_or("test binary has no parent directory")?
            .to_owned();
        let Some(shim) = compile_enospc_shim(&shim_directory, "second_frame")? else {
            return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
        };
        let directory = tempfile::tempdir()?;
        let root = directory.path().canonicalize()?;
        let source = root.join("source");
        let package = root.join("backup");
        let prepared = root.join("prepared");
        fixture(&source)?;
        let before_source = hashes(&source)?;
        let options = UpgradeTransformOptions::default();
        let receipt = Store::backup_legacy(&source, &package, &options.backup)?;
        Store::prepare_upgrade(&source, &package, &prepared, &options.backup)?;
        let before_package = hashes(&package.join("store"))?;
        let first_frame_len =
            journal_frame(receipt.storage_version(), &receipt, &[0_u8; 32], &[]).len();
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command
            .arg("--exact")
            .arg(helper("transform_prepared_upgrade_enospc_process_helper"));
        command.env("LD_PRELOAD", shim);
        command.env("ENOSPC_SHIM_BUDGET_BYTES", first_frame_len.to_string());
        command.env("ENOSPC_SHIM_PREFIX", prepared.join(TRANSFORM_JOURNAL));
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_SOURCE", &source);
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_PACKAGE", &package);
        command.env("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_PREPARED", &prepared);
        let status = command.status()?;
        assert!(status.success(), "child helper failed: {status:?}");
        for path in [&source, &package.join("store"), &prepared.join("store")] {
            assert!(LegacyStoreSnapshot::upgrade_lease_available(path));
        }
        // The first frame's budget was exactly consumed, not exceeded, so
        // it completed in full: this is genuine positive evidence the
        // child passed the first-frame boundary and reached the second
        // frame specifically, not a restatement of the first-frame test's
        // own vacuous-pass guard. The file's length staying exactly at
        // that boundary (not growing at all) pins the fault to the second
        // frame's own first byte, not a partial write into it.
        assert_eq!(
            fs::metadata(prepared.join(TRANSFORM_JOURNAL))?.len(),
            first_frame_len as u64,
            "the first frame must have written in full and the second must not have grown the file at all"
        );
        assert!(!prepared.join(TRANSFORM_PENDING).exists());
        assert!(!prepared.join(TRANSFORM_COMPLETE).exists());
        assert!(TransformedUpgrade::verify(&source, &package, &prepared, &options).is_err());
        assert!(matches!(
            Store::open(prepared.join("store")),
            Err(crate::storage::StorageError::UpgradeIncomplete)
        ));
        assert_eq!(hashes(&source)?, before_source);
        assert_eq!(hashes(&package.join("store"))?, before_package);
        Ok(())
    }

    #[test]
    fn transform_prepared_upgrade_enospc_process_helper() -> Result {
        let Some(source) = std::env::var_os("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_SOURCE") else {
            return Ok(()); // An ordinary run: only the parent test re-invokes this.
        };
        let source = PathBuf::from(source);
        let package = variable("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_PACKAGE")?;
        let prepared = variable("OXIGRAPH_UPGRADE_TRANSFORM_ENOSPC_TEST_PREPARED")?;
        let result = Store::transform_prepared_upgrade(
            &source,
            &package,
            &prepared,
            &UpgradeTransformOptions::default(),
        );
        match result {
            // The native mutation loop's own writes wrap I/O errors through
            // StorageError (a fault on any journal frame lands here); the
            // final TRANSFORM_PENDING write instead goes through this
            // file's shared `write()` helper, which surfaces a bare
            // BackupError::Io directly. Both are genuine StorageFull
            // outcomes of this same function, just from different internal
            // error paths -- not two different failure classes to
            // disambiguate, so either is accepted here.
            Err(BackupError::Storage(crate::storage::StorageError::Io(error)))
                if error.kind() == io::ErrorKind::StorageFull =>
            {
                Ok(())
            }
            Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
            other => Err(format!(
                "expected a StorageFull BackupError::Storage(StorageError::Io(_)) or BackupError::Io(_), got {other:?}"
            )
            .into()),
        }
    }
}
