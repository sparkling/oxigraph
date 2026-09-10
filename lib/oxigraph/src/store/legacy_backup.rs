//! Offline physical copies of legacy layouts. No setup, migration or upgrade admission.
use super::backup::{
    MAX_MANIFEST, check, copy_artifact, fresh_destination, hash_file, open_regular, sync_directory,
};
use super::receipt::envelope_checksum;
use super::{
    BackupArtifact, BackupError, BackupFile, Store, StoreOptions, TransactionStartControl,
};
use crate::storage::LegacyStoreSnapshot;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::num::{NonZeroU64, NonZeroUsize};
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

const MAGIC: &[u8] = b"oxigraph.legacy-physical-backup.v1\0";
const COMPLETE: &str = "oxigraph-legacy-backup.complete";
const PENDING: &str = "oxigraph-legacy-backup.pending";
const MAX_FILES: usize = 100_000;

/// Bounds for an offline, flat, physical version-0/1 backup.
///
/// All writers must be stopped. Source and destination directories must remain
/// exclusively controlled by the caller. An existing regular native `LOCK` is
/// required: unlike ordinary open, this API never creates a lock in the source.
/// Copies are byte-bounded and cancellable between 64 KiB chunks. Native metadata
/// reads are not interruptible. No logical or RDF-feature compatibility is claimed.
#[derive(Clone)]
pub struct LegacyBackupOptions {
    pub control: TransactionStartControl,
    pub max_files: NonZeroUsize,
    pub max_bytes: NonZeroU64,
    pub store_options: StoreOptions,
}

impl Default for LegacyBackupOptions {
    fn default() -> Self {
        Self {
            control: TransactionStartControl::new(),
            max_files: NonZeroUsize::new(MAX_FILES).unwrap_or(NonZeroUsize::MIN),
            max_bytes: NonZeroU64::MAX,
            store_options: StoreOptions::default(),
        }
    }
}

/// A completed legacy physical backup's content identity, not an upgrade permit.
///
/// This distinct format does not relax [`super::BackupReceipt`]'s current-schema
/// contract or invent governed identity, outbox, feature, or logical-state evidence.
/// Keep the package immutable and copy it to a separate destination before use.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyBackupReceipt {
    storage_version: u64,
    database_id: Vec<u8>,
    rocksdb_sequence: u64,
    column_families: Vec<String>,
    files: Vec<BackupFile>,
}

impl LegacyBackupReceipt {
    pub const fn storage_version(&self) -> u64 {
        self.storage_version
    }
    pub fn database_id(&self) -> &[u8] {
        &self.database_id
    }
    pub const fn rocksdb_sequence(&self) -> u64 {
        self.rocksdb_sequence
    }
    pub fn column_families(&self) -> &[String] {
        &self.column_families
    }
    /// Exact source-relative file names, lengths and SHA-256 hashes.
    pub fn files(&self) -> &[BackupFile] {
        &self.files
    }
    pub const fn manifest_name() -> &'static str {
        COMPLETE
    }
    pub const fn store_directory() -> &'static str {
        "store"
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        envelope_checksum(MAGIC, &self.encode())
    }

    /// Verifies completion, the exact file inventory and native physical metadata.
    /// This takes the package's existing native lock; it does not migrate or serve it.
    pub fn verify(
        directory: impl AsRef<Path>,
        control: &TransactionStartControl,
    ) -> Result<Self, BackupError> {
        Self::verify_with_options(
            directory,
            &LegacyBackupOptions {
                control: control.clone(),
                ..LegacyBackupOptions::default()
            },
        )
    }

    pub fn verify_with_options(
        directory: impl AsRef<Path>,
        options: &LegacyBackupOptions,
    ) -> Result<Self, BackupError> {
        Ok(Self::verify_inner(directory.as_ref(), options, Instant::now())?.0)
    }

    /// Also verifies that the exclusively leased source still has the exact copied
    /// bytes and physical identity. Equal identities alone do not prove ancestry.
    pub fn verify_ancestry(
        source: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        control: &TransactionStartControl,
    ) -> Result<Self, BackupError> {
        Self::verify_ancestry_with_options(
            source,
            directory,
            &LegacyBackupOptions {
                control: control.clone(),
                ..LegacyBackupOptions::default()
            },
        )
    }

    pub fn verify_ancestry_with_options(
        source: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &LegacyBackupOptions,
    ) -> Result<Self, BackupError> {
        let started = Instant::now();
        check(&options.control, started)?;
        let source = stable_directory(source.as_ref())?;
        let directory = stable_directory(directory.as_ref())?;
        if source.starts_with(&directory) || directory.starts_with(&source) {
            return Err(BackupError::InvalidPath);
        }
        let (receipt, _package_lease) = Self::verify_inner(&directory, options, started)?;
        check_native_files(&source)?;
        let snapshot = LegacyStoreSnapshot::open(&source, options.store_options.clone().into())?;
        receipt.check_metadata(&snapshot)?;
        if inventory(&source, options, started)? != receipt.files {
            return Err(BackupError::FileMismatch);
        }
        check(&options.control, started)?;
        Ok(receipt)
    }

    fn verify_inner(
        directory: &Path,
        options: &LegacyBackupOptions,
        started: Instant,
    ) -> Result<(Self, LegacyStoreSnapshot), BackupError> {
        check_options(options, started)?;
        let directory = stable_directory(directory)?;
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            let name = entry.file_name();
            if !((name == "store" && entry.file_type()?.is_dir())
                || (name == COMPLETE && entry.file_type()?.is_file()))
            {
                return Err(BackupError::InvalidPath);
            }
        }
        let mut bytes = Vec::new();
        let file = open_regular(&directory.join(COMPLETE))?;
        if file.metadata()?.len() > MAX_MANIFEST as u64 {
            return Err(BackupError::Limit);
        }
        file.take(MAX_MANIFEST as u64 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > MAX_MANIFEST {
            return Err(BackupError::Limit);
        }
        let receipt = Self::decode(&bytes)?;
        let store = stable_directory(&directory.join("store"))?;
        check_native_files(&store)?;
        let snapshot = LegacyStoreSnapshot::open(&store, options.store_options.clone().into())?;
        if inventory(&store, options, started)? != receipt.files {
            return Err(BackupError::FileMismatch);
        }
        receipt.check_metadata(&snapshot)?;
        check(&options.control, started)?;
        Ok((receipt, snapshot))
    }

    fn check_metadata(&self, snapshot: &LegacyStoreSnapshot) -> Result<(), BackupError> {
        if self.storage_version != snapshot.version
            || self.database_id != snapshot.database_id
            || self.rocksdb_sequence != snapshot.sequence
            || self.column_families != snapshot.column_families
        {
            return Err(BackupError::FileMismatch);
        }
        Ok(())
    }

    fn encode(&self) -> Vec<u8> {
        let mut bytes = MAGIC.to_vec();
        bytes.extend_from_slice(&self.storage_version.to_be_bytes());
        blob(&mut bytes, &self.database_id);
        bytes.extend_from_slice(&self.rocksdb_sequence.to_be_bytes());
        bytes.extend_from_slice(&(self.column_families.len() as u64).to_be_bytes());
        for name in &self.column_families {
            blob(&mut bytes, name.as_bytes());
        }
        bytes.extend_from_slice(&(self.files.len() as u64).to_be_bytes());
        for file in &self.files {
            blob(&mut bytes, file.path().as_bytes());
            bytes.extend_from_slice(&file.size().to_be_bytes());
            bytes.extend_from_slice(file.sha256());
        }
        let checksum = envelope_checksum(MAGIC, &bytes);
        bytes.extend_from_slice(&checksum);
        bytes
    }

    fn decode(bytes: &[u8]) -> Result<Self, BackupError> {
        let split = bytes
            .len()
            .checked_sub(32)
            .ok_or(BackupError::InvalidManifest)?;
        let (body, checksum) = bytes.split_at(split);
        if envelope_checksum(MAGIC, body) != checksum {
            return Err(BackupError::InvalidManifest);
        }
        let mut input = Decoder(body);
        if input.take(MAGIC.len())? != MAGIC {
            return Err(BackupError::InvalidManifest);
        }
        let storage_version = input.u64()?;
        if storage_version > 1 {
            return Err(BackupError::InvalidManifest);
        }
        let database_id = input.blob(1024)?.to_vec();
        if database_id.is_empty() {
            return Err(BackupError::InvalidManifest);
        }
        let rocksdb_sequence = input.u64()?;
        let count = input.count(12)?;
        let mut column_families = Vec::with_capacity(count);
        for _ in 0..count {
            column_families.push(
                std::str::from_utf8(input.blob(64)?)
                    .map_err(|_| BackupError::InvalidManifest)?
                    .to_owned(),
            );
        }
        if count != if storage_version == 0 { 11 } else { 12 }
            || column_families.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err(BackupError::InvalidManifest);
        }
        let count = input.count(MAX_FILES)?;
        let mut files = Vec::with_capacity(count);
        for _ in 0..count {
            let name = std::str::from_utf8(input.blob(240)?)
                .map_err(|_| BackupError::InvalidManifest)?
                .to_owned();
            if !native_name(&name) {
                return Err(BackupError::InvalidManifest);
            }
            let size = input.u64()?;
            let sha256 = input
                .take(32)?
                .try_into()
                .map_err(|_| BackupError::InvalidManifest)?;
            files.push(BackupFile::new(name, size, sha256));
        }
        if !input.0.is_empty()
            || files
                .windows(2)
                .any(|pair| pair[0].path() >= pair[1].path())
        {
            return Err(BackupError::InvalidManifest);
        }
        let receipt = Self {
            storage_version,
            database_id,
            rocksdb_sequence,
            column_families,
            files,
        };
        if receipt.encode() != bytes {
            return Err(BackupError::InvalidManifest);
        }
        Ok(receipt)
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "separate legacy physical-backup API"
)]
impl Store {
    /// Copies an offline legacy physical store into a fresh, disjoint package.
    ///
    /// Source bytes are never migrated or stamped. Version 0 without the graphs
    /// family and version 1 with the current family inventory are supported as
    /// physical layouts, not certified logical profiles. All source files are
    /// copied, never hard-linked. Failures retain an incomplete destination;
    /// post-publication synchronization failure is explicitly indeterminate.
    /// This does not authorize schema upgrades or replace current-schema backup.
    pub fn backup_legacy(
        source: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &LegacyBackupOptions,
    ) -> Result<LegacyBackupReceipt, BackupError> {
        backup_inner(source.as_ref(), directory.as_ref(), options, |_| Ok(()))
    }
}

fn backup_inner(
    source: &Path,
    directory: &Path,
    options: &LegacyBackupOptions,
    mut phase: impl FnMut(u8) -> Result<(), BackupError>,
) -> Result<LegacyBackupReceipt, BackupError> {
    let started = Instant::now();
    check_options(options, started)?;
    if !cfg!(unix) {
        return Err(BackupError::UnsupportedPlatform);
    }
    let source = stable_directory(source)?;
    check_native_files(&source)?;
    let snapshot = LegacyStoreSnapshot::open(&source, options.store_options.clone().into())?;
    let files = inventory(&source, options, started)?;
    let parent = directory
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    stable_directory(parent)?;
    let destination = fresh_destination(directory, &source)?;
    private_directory(&destination)?;
    phase(0)?;
    private_directory(&destination.join("store"))?;
    for file in &files {
        let artifact = BackupArtifact::new(
            file.path().to_owned(),
            source.join(file.path()),
            file.size(),
            *file.sha256(),
        )?;
        copy_artifact(
            &artifact,
            &destination.join("store").join(file.path()),
            &options.control,
            started,
        )?;
        phase(1)?;
    }
    let receipt = LegacyBackupReceipt {
        storage_version: snapshot.version,
        database_id: snapshot.database_id.clone(),
        rocksdb_sequence: snapshot.sequence,
        column_families: snapshot.column_families.clone(),
        files,
    };
    let copy = LegacyStoreSnapshot::open(
        &destination.join("store"),
        options.store_options.clone().into(),
    )?;
    receipt.check_metadata(&copy)?;
    if inventory(&source, options, started)? != receipt.files
        || inventory(&destination.join("store"), options, started)? != receipt.files
    {
        return Err(BackupError::FileMismatch);
    }
    phase(2)?;
    let bytes = receipt.encode();
    if bytes.len() > MAX_MANIFEST {
        return Err(BackupError::Limit);
    }
    LegacyBackupReceipt::decode(&bytes)?;
    let mut pending = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination.join(PENDING))?;
    pending.write_all(&bytes)?;
    pending.sync_all()?;
    drop(pending);
    sync_directory(&destination.join("store"))?;
    sync_directory(&destination)?;
    sync_directory(destination.parent().ok_or(BackupError::InvalidPath)?)?;
    phase(3)?;
    check(&options.control, started)?;
    fs::rename(destination.join(PENDING), destination.join(COMPLETE))?;
    phase(4).map_err(|error| BackupError::CompletionIndeterminate(io::Error::other(error)))?;
    sync_directory(&destination).map_err(BackupError::CompletionIndeterminate)?;
    Ok(receipt)
}

fn check_options(options: &LegacyBackupOptions, started: Instant) -> Result<(), BackupError> {
    check(&options.control, started)?;
    if options.max_files.get() > MAX_FILES {
        return Err(BackupError::Limit);
    }
    Ok(())
}

fn stable_directory(path: &Path) -> Result<PathBuf, BackupError> {
    let absolute = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut observed = PathBuf::new();
    for part in absolute.components() {
        if matches!(part, Component::ParentDir) {
            return Err(BackupError::InvalidPath);
        }
        observed.push(part);
        if !fs::symlink_metadata(&observed)?.is_dir() {
            return Err(BackupError::InvalidPath);
        }
    }
    Ok(absolute.canonicalize()?)
}

fn private_directory(path: &Path) -> Result<(), BackupError> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    Ok(())
}

fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}
fn native_name(name: &str) -> bool {
    name.len() <= 240
        && (matches!(name, "CURRENT" | "LOCK" | "IDENTITY" | "LOG")
            || ["MANIFEST-", "OPTIONS-", "LOG.old."]
                .iter()
                .any(|prefix| name.strip_prefix(prefix).is_some_and(digits))
            || [".log", ".sst", ".ldb", ".blob", ".dbtmp"]
                .iter()
                .any(|suffix| name.strip_suffix(suffix).is_some_and(digits)))
}

fn check_native_files(path: &Path) -> Result<(), BackupError> {
    let mut count = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        count += 1;
        if count > MAX_FILES {
            return Err(BackupError::Limit);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if !entry.file_type()?.is_file() || !native_name(&name) {
            return Err(BackupError::InvalidPath);
        }
    }
    open_regular(&path.join("LOCK"))?;
    open_regular(&path.join("IDENTITY"))?;
    let mut current = String::new();
    open_regular(&path.join("CURRENT"))?
        .take(128)
        .read_to_string(&mut current)?;
    let manifest = current
        .strip_suffix('\n')
        .ok_or(BackupError::InvalidManifest)?;
    if !manifest.strip_prefix("MANIFEST-").is_some_and(digits) || current.len() >= 128 {
        return Err(BackupError::InvalidManifest);
    }
    open_regular(&path.join(manifest))?;
    Ok(())
}

fn inventory(
    path: &Path,
    options: &LegacyBackupOptions,
    started: Instant,
) -> Result<Vec<BackupFile>, BackupError> {
    check_native_files(path)?;
    let mut files = Vec::new();
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if files.len() >= options.max_files.get() {
            return Err(BackupError::Limit);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        let (size, hash) = hash_file(
            &entry.path(),
            &options.control,
            started,
            options.max_bytes.get().saturating_sub(total),
            false,
        )?;
        total = total
            .checked_add(size)
            .filter(|value| *value <= options.max_bytes.get())
            .ok_or(BackupError::Limit)?;
        files.push(BackupFile::new(name, size, hash));
    }
    files.sort_unstable_by(|a, b| a.path().cmp(b.path()));
    Ok(files)
}

fn blob(output: &mut Vec<u8>, bytes: &[u8]) {
    output.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
    output.extend_from_slice(bytes);
}
struct Decoder<'a>(&'a [u8]);
impl<'a> Decoder<'a> {
    fn take(&mut self, size: usize) -> Result<&'a [u8], BackupError> {
        if size > self.0.len() {
            return Err(BackupError::InvalidManifest);
        }
        let (value, rest) = self.0.split_at(size);
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
    fn count(&mut self, max: usize) -> Result<usize, BackupError> {
        usize::try_from(self.u64()?)
            .ok()
            .filter(|n| *n <= max)
            .ok_or(BackupError::Limit)
    }
    fn blob(&mut self, max: usize) -> Result<&'a [u8], BackupError> {
        let count = self.count(max)?;
        self.take(count)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use sha2::Digest;
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};

    type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

    fn copy_fixture(version: u64, destination: &Path) -> TestResult {
        fs::create_dir(destination)?;
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join(if version == 0 {
                "rocksdb_bc_data"
            } else {
                "rocksdb_bc_rdf_star_data"
            });
        for entry in fs::read_dir(fixture)? {
            let entry = entry?;
            assert!(entry.file_type()?.is_file());
            fs::copy(entry.path(), destination.join(entry.file_name()))?;
        }
        Ok(())
    }

    fn source_inventory(path: &Path) -> TestResult<BTreeMap<PathBuf, (u64, [u8; 32])>> {
        fs::read_dir(path)?
            .map(|entry| {
                let entry = entry?;
                let bytes = fs::read(entry.path())?;
                Ok((
                    entry.file_name().into(),
                    (bytes.len() as u64, sha2::Sha256::digest(bytes).into()),
                ))
            })
            .collect()
    }

    fn options() -> LegacyBackupOptions {
        LegacyBackupOptions::default()
    }

    #[test]
    fn injected_phases_preserve_source_and_completion_boundary() -> TestResult {
        for version in [0, 1] {
            for stop in 0..4 {
                let directory = tempfile::tempdir()?;
                let source = directory.path().join("source");
                let destination = directory.path().join(format!("phase-{stop}"));
                copy_fixture(version, &source)?;
                let before = source_inventory(&source)?;
                let result = backup_inner(&source, &destination, &options(), |phase| {
                    if phase == stop {
                        Err(BackupError::Cancelled)
                    } else {
                        Ok(())
                    }
                });
                assert!(matches!(result, Err(BackupError::Cancelled)));
                assert_eq!(source_inventory(&source)?, before);
                assert!(!destination.join(COMPLETE).exists());
                assert!(LegacyBackupReceipt::verify(
                    &destination,
                    &TransactionStartControl::new()
                )
                .is_err());
            }
        }
        Ok(())
    }

    #[test]
    fn postcompletion_failure_is_indeterminate_but_independently_verifiable() -> TestResult {
        for version in [0, 1] {
            let directory = tempfile::tempdir()?;
            let source = directory.path().join("source");
            let destination = directory.path().join("package");
            copy_fixture(version, &source)?;
            let before = source_inventory(&source)?;
            let result = backup_inner(&source, &destination, &options(), |phase| {
                if phase == 4 {
                    Err(BackupError::Io(io::Error::other("injected post-completion failure")))
                } else {
                    Ok(())
                }
            });
            assert!(matches!(result, Err(BackupError::CompletionIndeterminate(_))));
            assert!(destination.join(COMPLETE).exists());
            LegacyBackupReceipt::verify(&destination, &TransactionStartControl::new())?;
            assert_eq!(source_inventory(&source)?, before);
        }
        Ok(())
    }

    #[test]
    fn cancellation_before_copy_completion_and_marker_never_completes() -> TestResult {
        for stop in [1, 3] {
            let directory = tempfile::tempdir()?;
            let source = directory.path().join("source");
            let destination = directory.path().join(format!("cancel-{stop}"));
            copy_fixture(0, &source)?;
            let before = source_inventory(&source)?;
            let options = options();
            let cancellation = options.control.clone();
            let result = backup_inner(&source, &destination, &options, |phase| {
                if phase == stop {
                    cancellation.cancel();
                }
                Ok(())
            });
            assert!(matches!(result, Err(BackupError::Cancelled)));
            assert_eq!(source_inventory(&source)?, before);
            assert!(!destination.join(COMPLETE).exists());
            assert!(LegacyBackupReceipt::verify(
                &destination,
                &TransactionStartControl::new()
            )
            .is_err());
        }
        Ok(())
    }

    #[test]
    fn native_lease_excludes_second_snapshot_and_releases_after_return() -> TestResult {
        for fail in [true, false] {
            let directory = tempfile::tempdir()?;
            let source = directory.path().join("source");
            let destination = directory.path().join(if fail { "failed" } else { "complete" });
            copy_fixture(1, &source)?;
            let result = backup_inner(&source, &destination, &options(), |phase| {
                if matches!(phase, 0 | 1) {
                    assert!(LegacyStoreSnapshot::open(
                        &source,
                        StoreOptions::default().into()
                    )
                    .is_err());
                }
                if fail && phase == 1 {
                    Err(BackupError::Cancelled)
                } else {
                    Ok(())
                }
            });
            if fail {
                assert!(matches!(result, Err(BackupError::Cancelled)));
            } else {
                result?;
            }
            LegacyStoreSnapshot::open(&source, StoreOptions::default().into())?;
        }
        Ok(())
    }
}
