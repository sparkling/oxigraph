//! Checkpoint packages and completion-last, content-bound backup receipts (ADR-0022).
use super::receipt::envelope_checksum;
use super::{
    CommitReceipt, ContributorError, ContributorIdentity, ContributorObservation,
    ContributorRegistry, GovernanceError, GovernanceTime, OutboxCursor, SemanticChange,
    StorageError, Store, StoreIdentity, TransactionStartControl,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::num::{NonZeroU64, NonZeroUsize};
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

const MANIFEST: &str = "oxigraph-backup.complete";
const PENDING: &str = "oxigraph-backup.pending";
const MAGIC: &[u8] = b"oxigraph.backup.v1\0";
pub(super) const MAX_MANIFEST: usize = 64 * 1024 * 1024;
const MAX_FILES: usize = 100_000;
const MAX_CONTRIBUTORS: usize = 128;

/// A provider-frozen file descriptor. Bytes are copied, never hard-linked, and
/// must match the declared size/SHA-256. The provider owns correspondence with
/// its applied checkpoint; checksums do not independently prove index semantics.
#[derive(Clone, Debug)]
pub struct BackupArtifact {
    name: String,
    source: PathBuf,
    size: u64,
    sha256: [u8; 32],
}
impl BackupArtifact {
    pub fn new(
        name: String,
        source: PathBuf,
        size: u64,
        sha256: [u8; 32],
    ) -> Result<Self, BackupError> {
        check_name(&name)?;
        if name == "_state" {
            return Err(BackupError::InvalidPath);
        }
        Ok(Self {
            name,
            source,
            size,
            sha256,
        })
    }
}

/// One frozen contributor observation and the expected files representing that
/// applied state. The descriptor checksum binds both before copying starts.
#[derive(Clone, Debug)]
pub struct BackupContribution {
    observation: ContributorObservation,
    artifacts: Vec<BackupArtifact>,
    // Additional admission guard for exact-primary derived generations. The
    // generation manifest in artifacts binds this identity in the file format.
    primary_checkpoint: Option<BackupCheckpoint>,
    primary_input: Option<([u8; 32], u64, u64)>,
}
impl BackupContribution {
    pub fn new(
        observation: ContributorObservation,
        mut artifacts: Vec<BackupArtifact>,
    ) -> Result<Self, BackupError> {
        if artifacts.len() > MAX_FILES {
            return Err(BackupError::Limit);
        }
        artifacts.sort_unstable_by(|a, b| a.name.cmp(&b.name));
        if artifacts
            .windows(2)
            .any(|pair| matches!(pair, [a,b] if a.name == b.name))
        {
            return Err(BackupError::InvalidPath);
        }
        Ok(Self {
            observation,
            artifacts,
            primary_checkpoint: None,
            primary_input: None,
        })
    }
    pub(super) fn at_primary(
        mut self,
        checkpoint: BackupCheckpoint,
        input: ([u8; 32], u64, u64),
    ) -> Self {
        self.primary_checkpoint = Some(checkpoint);
        self.primary_input = Some(input);
        self
    }
    pub fn observation(&self) -> &ContributorObservation {
        &self.observation
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut bytes = Vec::new();
        encode_contribution(&mut bytes, self);
        envelope_checksum(b"oxigraph.backup.contribution.v1\0", &bytes)
    }
}

/// Backup operates in an exclusively owned fresh destination. Concurrent native
/// source writes/compaction through a read-write Store are supported; ordinary
/// read-only handles retain their no-concurrent-writer contract. Concurrent
/// destination replacement is not supported. Cancellation is cooperative
/// between native calls and 64 KiB file chunks.
#[derive(Clone)]
pub struct BackupOptions {
    pub contributors: ContributorRegistry,
    pub contributions: Vec<BackupContribution>,
    pub control: TransactionStartControl,
    pub max_files: NonZeroUsize,
    pub max_bytes: NonZeroU64,
}
impl Default for BackupOptions {
    fn default() -> Self {
        Self {
            contributors: ContributorRegistry::default(),
            contributions: Vec::new(),
            control: TransactionStartControl::new(),
            max_files: NonZeroUsize::new(MAX_FILES).unwrap_or(NonZeroUsize::MIN),
            max_bytes: NonZeroU64::MAX,
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum BackupError {
    #[error("backup requires an on-disk store")]
    Unsupported,
    #[error(
        "receipt-bearing backup requires Unix directory synchronization; plain backup remains available"
    )]
    UnsupportedPlatform,
    #[error("backup path is not a fresh, contained regular-file package outside the source")]
    InvalidPath,
    #[error("backup file, byte, contributor, or manifest limit exceeded")]
    Limit,
    #[error("backup was cancelled before completion publication")]
    Cancelled,
    #[error("backup deadline elapsed before completion publication")]
    TimedOut,
    #[error("backup manifest or file inventory failed verification")]
    InvalidManifest,
    #[error("backup file contents changed or differ from their frozen descriptor")]
    FileMismatch,
    #[error(
        "completion was published but directory synchronization failed; verify this package before retrying: {0}"
    )]
    CompletionIndeterminate(io::Error),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Governance(#[from] GovernanceError),
    #[error(transparent)]
    Contributor(#[from] ContributorError),
}

/// Contextual source observation, not the checkpoint's consistency identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackupObservation {
    time: GovernanceTime,
    rocksdb_sequence: u64,
}
impl BackupObservation {
    pub const fn time(&self) -> GovernanceTime {
        self.time
    }
    pub const fn rocksdb_sequence(&self) -> u64 {
        self.rocksdb_sequence
    }
}

/// Identity read from the completed checkpoint. Physical database ID is bounded
/// opaque RocksDB data, never synthesized into a governed StoreIdentity.
/// Governance/commit/outbox are explicitly absent before those capabilities exist.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackupCheckpoint {
    database_id: Vec<u8>,
    storage_version: u64,
    rocksdb_sequence: u64,
    governance_schema: Option<u8>,
    store_identity: Option<StoreIdentity>,
    governed_sequence: Option<u64>,
    latest_receipt: Option<CommitReceipt>,
    outbox_high_water: Option<OutboxCursor>,
    outbox_after_receipt_sequence: Option<u64>,
    retained_after: Option<OutboxCursor>,
}
impl BackupCheckpoint {
    pub(super) fn encoded(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        self.encode(&mut bytes);
        bytes
    }

    pub(super) fn from_encoded(bytes: &[u8]) -> Result<Self, BackupError> {
        let mut input = Decoder(bytes);
        let checkpoint = Self::decode(&mut input)?;
        checkpoint.validate()?;
        if !input.0.is_empty() || checkpoint.encoded() != bytes {
            return Err(BackupError::InvalidManifest);
        }
        Ok(checkpoint)
    }

    pub fn database_id(&self) -> &[u8] {
        &self.database_id
    }
    pub const fn storage_version(&self) -> u64 {
        self.storage_version
    }
    pub const fn rocksdb_sequence(&self) -> u64 {
        self.rocksdb_sequence
    }
    pub const fn governance_schema(&self) -> Option<u8> {
        self.governance_schema
    }
    pub const fn store_identity(&self) -> Option<&StoreIdentity> {
        self.store_identity.as_ref()
    }
    pub const fn governed_sequence(&self) -> Option<u64> {
        self.governed_sequence
    }
    pub const fn latest_receipt(&self) -> Option<&CommitReceipt> {
        self.latest_receipt.as_ref()
    }
    pub const fn outbox_high_water(&self) -> Option<&OutboxCursor> {
        self.outbox_high_water.as_ref()
    }
    /// Feed coverage starts after this governed sequence; legacy writes remain excluded.
    pub const fn outbox_after_receipt_sequence(&self) -> Option<u64> {
        self.outbox_after_receipt_sequence
    }
    pub const fn retained_after(&self) -> Option<&OutboxCursor> {
        self.retained_after.as_ref()
    }
}

/// Native-index-order content digest, not RDF canonicalization or an independent
/// conformance result. Includes quads, explicit empty graph topology and namespaces.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackupContents {
    quads: u64,
    named_graphs: u64,
    namespaces: u64,
    sha256: [u8; 32],
}
impl BackupContents {
    pub const fn quads(&self) -> u64 {
        self.quads
    }
    pub const fn named_graphs(&self) -> u64 {
        self.named_graphs
    }
    pub const fn namespaces(&self) -> u64 {
        self.namespaces
    }
    pub const fn sha256(&self) -> &[u8; 32] {
        &self.sha256
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackupFile {
    path: String,
    size: u64,
    sha256: [u8; 32],
}
impl BackupFile {
    pub fn path(&self) -> &str {
        &self.path
    }
    pub const fn size(&self) -> u64 {
        self.size
    }
    pub const fn sha256(&self) -> &[u8; 32] {
        &self.sha256
    }
}

/// A completed package's content identity, not a signature, restore drill,
/// application deployment, or permission for destructive migration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BackupReceipt {
    checkpoint: BackupCheckpoint,
    contents: BackupContents,
    source_start: BackupObservation,
    source_end: BackupObservation,
    contributor_inventory: Vec<u8>,
    contributions: Vec<(ContributorIdentity, [u8; 32])>,
    files: Vec<BackupFile>,
}
impl BackupReceipt {
    pub const fn checkpoint(&self) -> &BackupCheckpoint {
        &self.checkpoint
    }
    pub const fn contents(&self) -> &BackupContents {
        &self.contents
    }
    pub const fn source_start(&self) -> &BackupObservation {
        &self.source_start
    }
    pub const fn source_end(&self) -> &BackupObservation {
        &self.source_end
    }
    pub fn contributor_inventory(&self) -> &[u8] {
        &self.contributor_inventory
    }
    pub fn contributions(&self) -> &[(ContributorIdentity, [u8; 32])] {
        &self.contributions
    }
    pub fn files(&self) -> &[BackupFile] {
        &self.files
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        envelope_checksum(MAGIC, &self.encode())
    }
    pub const fn manifest_name() -> &'static str {
        MANIFEST
    }
    pub const fn store_directory() -> &'static str {
        "store"
    }

    /// Verifies completion, canonical manifest and every package file without
    /// opening RocksDB or altering the package. Do not serve the checkpoint in
    /// place: an ordinary writable open can invalidate its file hashes.
    pub fn verify(
        directory: impl AsRef<Path>,
        control: &TransactionStartControl,
    ) -> Result<Self, BackupError> {
        let started = Instant::now();
        check(control, started)?;
        let directory = directory.as_ref();
        check_directory(directory)?;
        let mut file = open_regular(&directory.join(MANIFEST))?;
        if file.metadata()?.len() > MAX_MANIFEST as u64 {
            return Err(BackupError::Limit);
        }
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(MAX_MANIFEST as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_MANIFEST {
            return Err(BackupError::Limit);
        }
        let receipt = Self::decode(&bytes)?;
        let files = scan_files(
            directory,
            true,
            control,
            started,
            MAX_FILES,
            u64::MAX,
            false,
        )?;
        if files != receipt.files {
            return Err(BackupError::FileMismatch);
        }
        for (identity, checksum) in &receipt.contributions {
            let state = directory
                .join("contributors")
                .join(provider_name(*identity))
                .join("_state");
            let mut bytes = Vec::new();
            open_regular(&state)?.take(33).read_to_end(&mut bytes)?;
            if bytes != checksum {
                return Err(BackupError::FileMismatch);
            }
        }
        check(control, started)?;
        Ok(receipt)
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "additive backup API kept separate from transaction governance"
)]
impl Store {
    /// Creates a new package containing `store/`, frozen contributor files and a
    /// completion-last manifest. Existing Store::backup keeps its plain-directory API.
    /// The caller exclusively owns the destination and provider descriptors.
    /// Failures before publication preserve an incomplete directory for diagnosis;
    /// a post-publication sync failure is explicitly indeterminate, never retried.
    pub fn backup_with_receipt(
        &self,
        directory: impl AsRef<Path>,
        options: &BackupOptions,
    ) -> Result<BackupReceipt, BackupError> {
        self.backup_with_receipt_inner(directory.as_ref(), options, |_| Ok(()))
    }

    #[expect(
        clippy::create_dir,
        reason = "fresh destination creation must reject existing paths"
    )]
    fn backup_with_receipt_inner(
        &self,
        directory: &Path,
        options: &BackupOptions,
        mut phase: impl FnMut(u8) -> Result<(), BackupError>,
    ) -> Result<BackupReceipt, BackupError> {
        let started = Instant::now();
        check(&options.control, started)?;
        if !cfg!(unix) {
            return Err(BackupError::UnsupportedPlatform);
        }
        if options.contributions.len() > MAX_CONTRIBUTORS || options.max_files.get() > MAX_FILES {
            return Err(BackupError::Limit);
        }
        let mut artifact_count = options.contributions.len();
        for contribution in &options.contributions {
            artifact_count = artifact_count
                .checked_add(contribution.artifacts.len())
                .filter(|count| *count <= options.max_files.get())
                .ok_or(BackupError::Limit)?;
        }
        let source = self
            .storage
            .backup_path()
            .ok_or(BackupError::Unsupported)?
            .canonicalize()?;
        let destination = fresh_destination(directory, &source)?;
        let source_start = self.backup_observation()?;
        fs::create_dir(&destination)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(0o700))?;
        }
        phase(0)?;
        check(&options.control, started)?;
        self.backup(destination.join("store"))?;
        phase(1)?;
        check(&options.control, started)?;
        let checkpoint_store = Store::open_read_only(destination.join("store"))?;
        let (checkpoint, health) = checkpoint_store.backup_checkpoint()?;
        if options.contributions.iter().any(|contribution| {
            contribution
                .primary_checkpoint
                .as_ref()
                .is_some_and(|expected| expected != &checkpoint)
        }) {
            return Err(ContributorError::SourceMismatch.into());
        }
        let observations: Vec<_> = options
            .contributions
            .iter()
            .map(|entry| entry.observation.clone())
            .collect();
        let inventory =
            options
                .contributors
                .evaluate(&checkpoint_store, &health, &observations, || {
                    check(&options.control, started).is_ok()
                })?;
        let contents = checkpoint_store.backup_contents(&options.control, started)?;
        let primary_input = options
            .contributions
            .iter()
            .find_map(|entry| entry.primary_input);
        if let Some(expected) = primary_input {
            if options
                .contributions
                .iter()
                .filter_map(|entry| entry.primary_input)
                .any(|input| input != expected)
            {
                return Err(ContributorError::SourceMismatch.into());
            }
            let (hash, records, bytes) = expected;
            let limits = super::DerivedLimits {
                max_records: NonZeroU64::new(records).unwrap_or(NonZeroU64::MIN),
                max_bytes: NonZeroU64::new(bytes).unwrap_or(NonZeroU64::MIN),
                control: options.control.clone(),
            };
            let scan = checkpoint_store
                .derived_snapshot(&options.control)
                .and_then(|snapshot| snapshot.scan(&limits, |_| Ok(())))
                .map_err(|error| StorageError::Other(Box::new(error)))?;
            if *scan.sha256() != hash || scan.records() != records || scan.logical_bytes() != bytes
            {
                return Err(ContributorError::SourceMismatch.into());
            }
            check(&options.control, started)?;
        }
        drop(checkpoint_store);
        let mut contributions = Vec::new();
        fs::create_dir(destination.join("contributors"))?;
        let mut ordered: Vec<_> = options.contributions.iter().collect();
        ordered.sort_unstable_by_key(|entry| entry.observation.identity());
        let mut copied = 0_u64;
        for contribution in ordered {
            check(&options.control, started)?;
            let identity = contribution.observation.identity();
            let target = destination
                .join("contributors")
                .join(provider_name(identity));
            fs::create_dir(&target)?;
            for artifact in &contribution.artifacts {
                copied = copied
                    .checked_add(artifact.size)
                    .filter(|size| *size <= options.max_bytes.get())
                    .ok_or(BackupError::Limit)?;
                copy_artifact(
                    artifact,
                    &target.join(&artifact.name),
                    &options.control,
                    started,
                )?;
            }
            let checksum = contribution.fingerprint();
            let mut state = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target.join("_state"))?;
            state.write_all(&checksum)?;
            state.sync_all()?;
            contributions.push((identity, checksum));
        }
        phase(2)?;
        let files = scan_files(
            &destination,
            false,
            &options.control,
            started,
            options.max_files.get(),
            options.max_bytes.get(),
            true,
        )?;
        let source_end = self.backup_observation()?;
        if source_end.time < source_start.time {
            return Err(GovernanceError::ClockRegressed.into());
        }
        let receipt = BackupReceipt {
            checkpoint,
            contents,
            source_start,
            source_end,
            contributor_inventory: inventory.to_bytes(),
            contributions,
            files,
        };
        let bytes = receipt.encode();
        if bytes.len() > MAX_MANIFEST {
            return Err(BackupError::Limit);
        }
        BackupReceipt::decode(&bytes)?;
        let mut pending = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination.join(PENDING))?;
        pending.write_all(&bytes)?;
        pending.sync_all()?;
        drop(pending);
        sync_directories(&destination)?;
        phase(3)?;
        check(&options.control, started)?;
        fs::rename(destination.join(PENDING), destination.join(MANIFEST))?;
        phase(4).map_err(|error| BackupError::CompletionIndeterminate(io::Error::other(error)))?;
        sync_directory(&destination).map_err(BackupError::CompletionIndeterminate)?;
        Ok(receipt)
    }

    fn backup_observation(&self) -> Result<BackupObservation, BackupError> {
        Ok(BackupObservation {
            time: GovernanceTime::now()?,
            rocksdb_sequence: self.storage.backup_identity()?.sequence,
        })
    }

    pub(super) fn backup_checkpoint(
        &self,
    ) -> Result<(BackupCheckpoint, super::GovernanceHealth), BackupError> {
        let native = self.storage.backup_identity()?;
        let health = self.governance_health(GovernanceTime::now()?, NonZeroUsize::MIN)?;
        let checkpoint = BackupCheckpoint {
            database_id: native.database_id,
            storage_version: native.storage_version,
            rocksdb_sequence: native.sequence,
            governance_schema: native.governance_schema,
            store_identity: native
                .governance
                .as_ref()
                .map(|state| state.store_identity.clone()),
            governed_sequence: native.governance.as_ref().map(|state| state.sequence),
            latest_receipt: health.latest_receipt().cloned(),
            outbox_high_water: health.high_water().cloned(),
            outbox_after_receipt_sequence: native
                .governance
                .as_ref()
                .and_then(|state| state.outbox.as_ref())
                .map(|state| state.after_receipt_sequence),
            retained_after: health.retained_after().cloned(),
        };
        checkpoint.validate()?;
        Ok((checkpoint, health))
    }

    pub(super) fn backup_contents(
        &self,
        control: &TransactionStartControl,
        started: Instant,
    ) -> Result<BackupContents, BackupError> {
        let mut hash = Sha256::new();
        hash.update(b"oxigraph.backup.contents.v1\0");
        let mut counts = [0_u64; 3];
        for quad in self {
            check(control, started)?;
            counts[0] = counts[0].checked_add(1).ok_or(BackupError::Limit)?;
            super::change_codec::emit(&SemanticChange::QuadAdded(quad?), &mut |part| {
                hash.update(part)
            });
        }
        for graph in self.named_graphs() {
            check(control, started)?;
            counts[1] = counts[1].checked_add(1).ok_or(BackupError::Limit)?;
            super::change_codec::emit(&SemanticChange::NamedGraphCreated(graph?), &mut |part| {
                hash.update(part)
            });
        }
        for namespace in self.namespaces() {
            check(control, started)?;
            counts[2] = counts[2].checked_add(1).ok_or(BackupError::Limit)?;
            let namespace = namespace?;
            super::change_codec::emit(
                &SemanticChange::NamespaceChanged {
                    prefix: namespace.prefix().clone(),
                    before: None,
                    after: Some(namespace.iri().clone()),
                },
                &mut |part| hash.update(part),
            );
        }
        for count in counts {
            hash.update(count.to_be_bytes());
        }
        Ok(BackupContents {
            quads: counts[0],
            named_graphs: counts[1],
            namespaces: counts[2],
            sha256: hash.finalize().into(),
        })
    }
}

pub(super) fn check(
    control: &TransactionStartControl,
    started: Instant,
) -> Result<(), BackupError> {
    if control.is_cancelled() {
        return Err(BackupError::Cancelled);
    }
    if control
        .timeout()
        .is_some_and(|timeout| started.elapsed() >= timeout)
    {
        return Err(BackupError::TimedOut);
    }
    Ok(())
}
fn check_name(name: &str) -> Result<(), BackupError> {
    if name.is_empty()
        || name.len() > 240
        || name == "."
        || name == ".."
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err(BackupError::InvalidPath);
    }
    Ok(())
}
pub(super) fn fresh_destination(target: &Path, source: &Path) -> Result<PathBuf, BackupError> {
    if target
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(BackupError::InvalidPath);
    }
    let name = target.file_name().ok_or(BackupError::InvalidPath)?;
    let parent = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .canonicalize()?;
    let destination = parent.join(name);
    if destination.starts_with(source)
        || source.starts_with(&destination)
        || fs::symlink_metadata(&destination).is_ok()
    {
        return Err(BackupError::InvalidPath);
    }
    Ok(destination)
}
pub(super) fn check_directory(path: &Path) -> Result<(), BackupError> {
    if !fs::symlink_metadata(path)?.is_dir() {
        return Err(BackupError::InvalidPath);
    }
    Ok(())
}
pub(super) fn open_regular(path: &Path) -> Result<File, BackupError> {
    if !fs::symlink_metadata(path)?.is_file() {
        return Err(BackupError::InvalidPath);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(BackupError::InvalidPath);
    }
    Ok(file)
}
fn hash_file(
    path: &Path,
    control: &TransactionStartControl,
    started: Instant,
    limit: u64,
    sync: bool,
) -> Result<(u64, [u8; 32]), BackupError> {
    let mut file = open_regular(path)?;
    let expected = file.metadata()?.len();
    if expected > limit {
        return Err(BackupError::Limit);
    }
    let mut total = 0_u64;
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        check(control, started)?;
        let size = file.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        total = total
            .checked_add(size as u64)
            .filter(|size| *size <= limit)
            .ok_or(BackupError::Limit)?;
        hash.update(&buffer[..size]);
    }
    if total != expected || file.metadata()?.len() != expected {
        return Err(BackupError::FileMismatch);
    }
    if sync {
        file.sync_all()?;
    }
    Ok((total, hash.finalize().into()))
}
pub(super) fn copy_artifact(
    artifact: &BackupArtifact,
    destination: &Path,
    control: &TransactionStartControl,
    started: Instant,
) -> Result<(), BackupError> {
    let mut source = open_regular(&artifact.source)?;
    if source.metadata()?.len() != artifact.size {
        return Err(BackupError::FileMismatch);
    }
    let mut target = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let mut hash = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        check(control, started)?;
        let size = source.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        total = total
            .checked_add(size as u64)
            .filter(|size| *size <= artifact.size)
            .ok_or(BackupError::FileMismatch)?;
        hash.update(&buffer[..size]);
        target.write_all(&buffer[..size])?;
    }
    if total != artifact.size || <[u8; 32]>::from(hash.finalize()) != artifact.sha256 {
        return Err(BackupError::FileMismatch);
    }
    target.sync_all()?;
    Ok(())
}
pub(super) fn provider_name(identity: ContributorIdentity) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut name = String::with_capacity(41);
    for byte in identity.provider() {
        name.push(char::from(HEX[usize::from(byte >> 4)]));
        name.push(char::from(HEX[usize::from(byte & 15)]));
    }
    name.push('-');
    for byte in identity.schema().get().to_be_bytes() {
        name.push(char::from(HEX[usize::from(byte >> 4)]));
        name.push(char::from(HEX[usize::from(byte & 15)]));
    }
    name
}
#[expect(
    clippy::filetype_is_file,
    reason = "backup inventory deliberately admits only regular files"
)]
fn scan_files(
    root: &Path,
    completed: bool,
    control: &TransactionStartControl,
    started: Instant,
    max_files: usize,
    max_bytes: u64,
    sync: bool,
) -> Result<Vec<BackupFile>, BackupError> {
    check_directory(root)?;
    check_directory(&root.join("store"))?;
    check_directory(&root.join("contributors"))?;
    let mut pending = vec![PathBuf::new()];
    let mut files = Vec::new();
    let mut total = 0_u64;
    let mut provider_count = 0;
    while let Some(relative) = pending.pop() {
        for entry in fs::read_dir(root.join(&relative))? {
            check(control, started)?;
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| BackupError::InvalidPath)?;
            check_name(&name)?;
            let path = relative.join(&name);
            let kind = entry.file_type()?;
            if relative.as_os_str().is_empty() {
                if completed && name == MANIFEST && kind.is_file() {
                    continue;
                }
                if (name == "store" || name == "contributors") && kind.is_dir() {
                    pending.push(path);
                    continue;
                }
                return Err(BackupError::InvalidPath);
            }
            if kind.is_dir() {
                if relative != Path::new("contributors") {
                    return Err(BackupError::InvalidPath);
                }
                provider_count += 1;
                if provider_count > MAX_CONTRIBUTORS {
                    return Err(BackupError::Limit);
                }
                // Empty/unknown directories must not disappear from verification.
                open_regular(&root.join(&path).join("_state"))?;
                pending.push(path);
                continue;
            }
            if !kind.is_file() || relative == Path::new("contributors") {
                return Err(BackupError::InvalidPath);
            }
            if files.len() >= max_files {
                return Err(BackupError::Limit);
            }
            let (size, sha256) = hash_file(
                &root.join(&path),
                control,
                started,
                max_bytes.saturating_sub(total),
                sync,
            )?;
            total = total
                .checked_add(size)
                .filter(|value| *value <= max_bytes)
                .ok_or(BackupError::Limit)?;
            let path = path
                .components()
                .map(|part| part.as_os_str().to_str().ok_or(BackupError::InvalidPath))
                .collect::<Result<Vec<_>, _>>()?
                .join("/");
            files.push(BackupFile { path, size, sha256 });
        }
    }
    files.sort_unstable_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}
pub(super) fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "durable backup directory sync is unsupported on this platform",
        ))
    }
}
pub(super) fn sync_directories(root: &Path) -> Result<(), BackupError> {
    for entry in fs::read_dir(root.join("contributors"))? {
        sync_directory(&entry?.path())?;
    }
    sync_directory(&root.join("contributors"))?;
    sync_directory(&root.join("store"))?;
    sync_directory(root)?;
    // Persist creation of the package itself before publishing completion.
    if let Some(parent) = root.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

fn blob(output: &mut Vec<u8>, value: &[u8]) {
    output.extend_from_slice(&(value.len() as u64).to_be_bytes());
    output.extend_from_slice(value);
}
fn optional(output: &mut Vec<u8>, value: Option<&[u8]>) {
    output.push(u8::from(value.is_some()));
    if let Some(value) = value {
        blob(output, value);
    }
}
fn encode_contribution(output: &mut Vec<u8>, contribution: &BackupContribution) {
    let observation = &contribution.observation;
    output.extend_from_slice(observation.identity().provider());
    output.extend_from_slice(&observation.identity().schema().get().to_be_bytes());
    optional(
        output,
        observation
            .source()
            .map(|value| value.receipt().encode())
            .as_deref(),
    );
    optional(
        output,
        observation
            .applied()
            .map(|value| value.receipt().encode())
            .as_deref(),
    );
    output.push(match observation.health() {
        super::ContributorHealth::Healthy => 0,
        super::ContributorHealth::Rebuilding => 1,
        super::ContributorHealth::Unavailable => 2,
        super::ContributorHealth::Failed => 3,
    });
    output.extend_from_slice(&(contribution.artifacts.len() as u64).to_be_bytes());
    for file in &contribution.artifacts {
        blob(output, file.name.as_bytes());
        output.extend_from_slice(&file.size.to_be_bytes());
        output.extend_from_slice(&file.sha256);
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "private manifest codec separated from public observation accessors"
)]
impl BackupCheckpoint {
    fn validate(&self) -> Result<(), BackupError> {
        if self.database_id.is_empty()
            || self.database_id.len() > 1024
            || self.storage_version != 2
            || self.governance_schema.is_some() != self.store_identity.is_some()
            || self.store_identity.is_some() != self.governed_sequence.is_some()
            || self
                .governance_schema
                .is_some_and(|schema| !(1..=3).contains(&schema))
            || (self.governed_sequence == Some(0) && self.governance_schema != Some(3))
        {
            return Err(BackupError::InvalidManifest);
        }
        if let Some(receipt) = &self.latest_receipt {
            if Some(receipt.store_identity()) != self.store_identity.as_ref()
                || Some(receipt.sequence()) != self.governed_sequence
                || receipt.outbox_end_cursor() != self.outbox_high_water
            {
                return Err(BackupError::InvalidManifest);
            }
        }
        if self.outbox_high_water.is_some() != self.latest_receipt.is_some()
            || self.outbox_high_water.is_some() != self.outbox_after_receipt_sequence.is_some()
            || (self.governance_schema == Some(2) && self.outbox_high_water.is_none())
            || (self.governance_schema == Some(1) && self.outbox_high_water.is_some())
            || self.outbox_after_receipt_sequence.is_some_and(|after| {
                self.governed_sequence.is_none_or(|sequence| {
                    after >= sequence
                        || self
                            .outbox_high_water
                            .as_ref()
                            .is_none_or(|cursor| cursor.position() < sequence - after)
                })
            })
            || self.retained_after.as_ref().is_some_and(|cursor| {
                Some(cursor.store_identity()) != self.store_identity.as_ref()
                    || self
                        .outbox_high_water
                        .as_ref()
                        .is_none_or(|high| cursor.position() > high.position())
            })
        {
            return Err(BackupError::InvalidManifest);
        }
        Ok(())
    }
    fn encode(&self, output: &mut Vec<u8>) {
        blob(output, &self.database_id);
        output.extend_from_slice(&self.storage_version.to_be_bytes());
        output.extend_from_slice(&self.rocksdb_sequence.to_be_bytes());
        output.push(self.governance_schema.unwrap_or(0));
        if let Some(identity) = &self.store_identity {
            output.extend_from_slice(identity.as_bytes());
            output.extend_from_slice(&self.governed_sequence.unwrap_or(0).to_be_bytes());
        }
        output.push(u8::from(self.outbox_after_receipt_sequence.is_some()));
        if let Some(after) = self.outbox_after_receipt_sequence {
            output.extend_from_slice(&after.to_be_bytes());
        }
        optional(
            output,
            self.latest_receipt
                .as_ref()
                .map(CommitReceipt::encode)
                .as_deref(),
        );
        optional(
            output,
            self.outbox_high_water
                .as_ref()
                .map(OutboxCursor::to_bytes)
                .as_ref()
                .map(<[u8; 57]>::as_slice),
        );
        optional(
            output,
            self.retained_after
                .as_ref()
                .map(OutboxCursor::to_bytes)
                .as_ref()
                .map(<[u8; 57]>::as_slice),
        );
    }
    fn decode(input: &mut Decoder<'_>) -> Result<Self, BackupError> {
        let database_id = input.blob(1024)?.to_vec();
        let storage_version = input.u64()?;
        let rocksdb_sequence = input.u64()?;
        let schema = input.byte()?;
        let governance_schema = (schema != 0).then_some(schema);
        let (store_identity, governed_sequence) = if schema == 0 {
            (None, None)
        } else {
            (
                Some(StoreIdentity::from_bytes(input.array()?)),
                Some(input.u64()?),
            )
        };
        let outbox_after_receipt_sequence = if input.boolean()? {
            Some(input.u64()?)
        } else {
            None
        };
        let latest_receipt = input
            .optional(153)?
            .map(CommitReceipt::decode)
            .transpose()?;
        let outbox_high_water = input
            .optional(57)?
            .map(OutboxCursor::from_bytes)
            .transpose()
            .map_err(|_| BackupError::InvalidManifest)?;
        let retained_after = input
            .optional(57)?
            .map(OutboxCursor::from_bytes)
            .transpose()
            .map_err(|_| BackupError::InvalidManifest)?;
        let value = Self {
            database_id,
            storage_version,
            rocksdb_sequence,
            governance_schema,
            store_identity,
            governed_sequence,
            latest_receipt,
            outbox_high_water,
            outbox_after_receipt_sequence,
            retained_after,
        };
        value.validate()?;
        Ok(value)
    }
}
#[expect(
    clippy::multiple_inherent_impl,
    reason = "private manifest codec separated from public verification API"
)]
impl BackupReceipt {
    pub(super) fn encode(&self) -> Vec<u8> {
        let mut output = MAGIC.to_vec();
        self.checkpoint.encode(&mut output);
        for value in [&self.source_start, &self.source_end] {
            output.extend_from_slice(&value.time.as_unix_millis().to_be_bytes());
            output.extend_from_slice(&value.rocksdb_sequence.to_be_bytes());
        }
        for value in [
            self.contents.quads,
            self.contents.named_graphs,
            self.contents.namespaces,
        ] {
            output.extend_from_slice(&value.to_be_bytes());
        }
        output.extend_from_slice(&self.contents.sha256);
        blob(&mut output, &self.contributor_inventory);
        output.extend_from_slice(&(self.contributions.len() as u64).to_be_bytes());
        for (identity, checksum) in &self.contributions {
            output.extend_from_slice(identity.provider());
            output.extend_from_slice(&identity.schema().get().to_be_bytes());
            output.extend_from_slice(checksum);
        }
        output.extend_from_slice(&(self.files.len() as u64).to_be_bytes());
        for file in &self.files {
            blob(&mut output, file.path.as_bytes());
            output.extend_from_slice(&file.size.to_be_bytes());
            output.extend_from_slice(&file.sha256);
        }
        let checksum = envelope_checksum(MAGIC, &output);
        output.extend_from_slice(&checksum);
        output
    }
    pub(super) fn decode(bytes: &[u8]) -> Result<Self, BackupError> {
        if bytes.len() < MAGIC.len() + 32 || bytes.len() > MAX_MANIFEST {
            return Err(BackupError::InvalidManifest);
        }
        let (body, checksum) = bytes.split_at(bytes.len() - 32);
        if !body.starts_with(MAGIC) || checksum != envelope_checksum(MAGIC, body) {
            return Err(BackupError::InvalidManifest);
        }
        let mut input = Decoder(&body[MAGIC.len()..]);
        let checkpoint = BackupCheckpoint::decode(&mut input)?;
        let source_start = BackupObservation {
            time: GovernanceTime::from_unix_millis(input.u64()?),
            rocksdb_sequence: input.u64()?,
        };
        let source_end = BackupObservation {
            time: GovernanceTime::from_unix_millis(input.u64()?),
            rocksdb_sequence: input.u64()?,
        };
        if source_start.time > source_end.time
            || source_start.rocksdb_sequence > checkpoint.rocksdb_sequence
            || checkpoint.rocksdb_sequence > source_end.rocksdb_sequence
        {
            return Err(BackupError::InvalidManifest);
        }
        let contents = BackupContents {
            quads: input.u64()?,
            named_graphs: input.u64()?,
            namespaces: input.u64()?,
            sha256: input.array()?,
        };
        let contributor_inventory = input.blob(1024 * 1024)?.to_vec();
        validate_inventory(&contributor_inventory, &checkpoint)?;
        let count = input.count(MAX_CONTRIBUTORS)?;
        let mut contributions = Vec::with_capacity(count);
        for _ in 0..count {
            let provider = input.array()?;
            let schema = std::num::NonZeroU32::new(u32::from_be_bytes(input.array()?))
                .ok_or(BackupError::InvalidManifest)?;
            contributions.push((ContributorIdentity::new(provider, schema), input.array()?));
        }
        if contributions
            .windows(2)
            .any(|pair| matches!(pair,[a,b] if a.0 >= b.0 || a.0.provider() == b.0.provider()))
        {
            return Err(BackupError::InvalidManifest);
        }
        let count = input.count(MAX_FILES)?;
        let mut files = Vec::with_capacity(count);
        let mut providers = BTreeSet::new();
        for _ in 0..count {
            let path = std::str::from_utf8(input.blob(1024)?)
                .map_err(|_| BackupError::InvalidManifest)?
                .to_owned();
            let parts: Vec<_> = path.split('/').collect();
            for part in &parts {
                check_name(part)?;
            }
            match parts.as_slice() {
                ["store", _] => {}
                ["contributors", provider, _] => {
                    providers.insert((*provider).to_owned());
                }
                _ => return Err(BackupError::InvalidManifest),
            }
            files.push(BackupFile {
                path,
                size: input.u64()?,
                sha256: input.array()?,
            });
        }
        if !input.0.is_empty()
            || files
                .windows(2)
                .any(|pair| matches!(pair,[a,b] if a.path >= b.path))
            || !files.iter().any(|file| file.path == "store/CURRENT")
            || providers
                != contributions
                    .iter()
                    .map(|(id, _)| provider_name(*id))
                    .collect()
        {
            return Err(BackupError::InvalidManifest);
        }
        let observed = inventory_observed_providers(&contributor_inventory)?;
        if observed != contributions.iter().map(|(id, _)| *id).collect::<Vec<_>>() {
            return Err(BackupError::InvalidManifest);
        }
        let receipt = Self {
            checkpoint,
            contents,
            source_start,
            source_end,
            contributor_inventory,
            contributions,
            files,
        };
        receipt.validate_contribution_bindings()?;
        if receipt.encode() != bytes {
            return Err(BackupError::InvalidManifest);
        }
        Ok(receipt)
    }

    fn validate_contribution_bindings(&self) -> Result<(), BackupError> {
        for observation in read_inventory(&self.contributor_inventory)?.1 {
            let identity = observation.identity();
            let prefix = format!("contributors/{}/", provider_name(identity));
            let artifacts = self
                .files
                .iter()
                .filter_map(|file| {
                    file.path
                        .strip_prefix(&prefix)
                        .filter(|name| *name != "_state")
                        .map(|name| BackupArtifact {
                            name: name.to_owned(),
                            source: PathBuf::new(),
                            size: file.size,
                            sha256: file.sha256,
                        })
                })
                .collect();
            let checksum = BackupContribution::new(observation, artifacts)?.fingerprint();
            if !self.contributions.contains(&(identity, checksum)) {
                return Err(BackupError::InvalidManifest);
            }
            let marker = self
                .files
                .iter()
                .find(|file| file.path == format!("{prefix}_state"))
                .ok_or(BackupError::InvalidManifest)?;
            if marker.size != 32 || marker.sha256 != <[u8; 32]>::from(Sha256::digest(checksum)) {
                return Err(BackupError::InvalidManifest);
            }
        }
        Ok(())
    }
}
// Decode the existing canonical contributor format without changing its bytes.
// Native creation still uses ContributorRegistry::evaluate for storage lineage.
pub(super) fn read_inventory(
    bytes: &[u8],
) -> Result<(ContributorRegistry, Vec<ContributorObservation>), BackupError> {
    use super::{
        ContributorCheckpoint, ContributorConsistency, ContributorDeclaration, ContributorHealth,
    };
    let mut input = Decoder(bytes);
    if input.byte()? != 1 {
        return Err(BackupError::InvalidManifest);
    }
    let count = usize::from(u16::from_be_bytes(input.array()?));
    if count > MAX_CONTRIBUTORS {
        return Err(BackupError::Limit);
    }
    let mut declarations = Vec::with_capacity(count);
    let mut observations = Vec::with_capacity(count);
    for _ in 0..count {
        let provider = input.array()?;
        let schema = std::num::NonZeroU32::new(u32::from_be_bytes(input.array()?))
            .ok_or(BackupError::InvalidManifest)?;
        let identity = ContributorIdentity::new(provider, schema);
        let required = input.boolean()?;
        let fallback = input.boolean()?;
        let eventual = input.boolean()?;
        let lag = input.u64()?;
        if !eventual && lag != 0 {
            return Err(BackupError::InvalidManifest);
        }
        let consistency = if eventual {
            ContributorConsistency::Eventual {
                max_lag_records: lag,
            }
        } else {
            ContributorConsistency::Strict
        };
        declarations.push(ContributorDeclaration::new(
            identity,
            required,
            consistency,
            fallback,
        ));
        if input.boolean()? {
            let health = match input.byte()? {
                0 => ContributorHealth::Healthy,
                1 => ContributorHealth::Rebuilding,
                2 => ContributorHealth::Unavailable,
                3 => ContributorHealth::Failed,
                _ => return Err(BackupError::InvalidManifest),
            };
            let mut checkpoint = || -> Result<Option<ContributorCheckpoint>, BackupError> {
                if input.boolean()? {
                    Ok(Some(ContributorCheckpoint::new(CommitReceipt::decode(
                        input.take(153)?,
                    )?)?))
                } else {
                    Ok(None)
                }
            };
            let source = checkpoint()?;
            let applied = checkpoint()?;
            observations.push(ContributorObservation::new(
                identity, source, applied, health,
            ));
        } else if required || !fallback {
            return Err(BackupError::Contributor(ContributorError::MissingRequired));
        }
    }
    if !input.0.is_empty()
        || declarations
            .windows(2)
            .any(|pair| matches!(pair,[a,b] if a.identity() >= b.identity()))
    {
        return Err(BackupError::InvalidManifest);
    }
    Ok((ContributorRegistry::new(declarations)?, observations))
}
fn inventory_observed_providers(bytes: &[u8]) -> Result<Vec<ContributorIdentity>, BackupError> {
    Ok(read_inventory(bytes)?
        .1
        .iter()
        .map(ContributorObservation::identity)
        .collect())
}
fn validate_inventory(bytes: &[u8], checkpoint: &BackupCheckpoint) -> Result<(), BackupError> {
    let (registry, observations) = read_inventory(bytes)?;
    let high = checkpoint
        .outbox_high_water
        .as_ref()
        .map_or(0, OutboxCursor::position);
    let floor = checkpoint
        .retained_after
        .as_ref()
        .map_or(0, OutboxCursor::position);
    for observation in observations {
        let declaration = registry
            .declarations()
            .iter()
            .find(|entry| entry.identity() == observation.identity())
            .ok_or(BackupError::InvalidManifest)?;
        if observation
            .source()
            .map(super::ContributorCheckpoint::receipt)
            != checkpoint.latest_receipt.as_ref()
        {
            return Err(ContributorError::SourceMismatch.into());
        }
        let applied = observation
            .applied()
            .map_or(0, |value| value.cursor().position());
        if applied > high
            || applied < floor
            || observation.applied().is_some_and(|value| {
                Some(value.receipt().store_identity()) != checkpoint.store_identity.as_ref()
            })
        {
            return Err(ContributorError::CursorMismatch.into());
        }
        let lag = high - applied;
        let max_lag = match declaration.consistency() {
            super::ContributorConsistency::Strict => 0,
            super::ContributorConsistency::Eventual { max_lag_records } => max_lag_records,
        };
        if lag > max_lag || (declaration.required() && lag != 0) {
            return Err(ContributorError::LagExceeded.into());
        }
        if observation.health() != super::ContributorHealth::Healthy
            && (declaration.required() || !declaration.authoritative_fallback())
        {
            return Err(ContributorError::Unhealthy.into());
        }
    }
    Ok(())
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
    fn array<const N: usize>(&mut self) -> Result<[u8; N], BackupError> {
        self.take(N)?
            .try_into()
            .map_err(|_| BackupError::InvalidManifest)
    }
    fn byte(&mut self) -> Result<u8, BackupError> {
        Ok(self.array::<1>()?[0])
    }
    fn boolean(&mut self) -> Result<bool, BackupError> {
        match self.byte()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(BackupError::InvalidManifest),
        }
    }
    fn u64(&mut self) -> Result<u64, BackupError> {
        Ok(u64::from_be_bytes(self.array()?))
    }
    fn count(&mut self, max: usize) -> Result<usize, BackupError> {
        usize::try_from(self.u64()?)
            .ok()
            .filter(|value| *value <= max)
            .ok_or(BackupError::Limit)
    }
    fn blob(&mut self, max: usize) -> Result<&'a [u8], BackupError> {
        let size = self.count(max)?;
        self.take(size)
    }
    fn optional(&mut self, max: usize) -> Result<Option<&'a [u8]>, BackupError> {
        match self.byte()? {
            0 => Ok(None),
            1 => Ok(Some(self.blob(max)?)),
            _ => Err(BackupError::InvalidManifest),
        }
    }
}

#[cfg(all(test, unix))]
#[expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    reason = "isolated backup fault fixtures"
)]
mod tests {
    use super::*;
    use crate::model::{GraphName, NamedNode, Quad};
    use crate::store::{TransactionKey, TransactionRequest};
    type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

    #[test]
    fn restore_reconciles_primary_fields_beyond_manifest_file_hashes() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let package = directory.path().join("backup");
        let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
        for mode in 0..4 {
            let mut changed = backup.clone();
            match mode {
                0 => changed.contents.quads += 1,
                1 => changed.contents.sha256 = [0; 32],
                2 => changed.checkpoint.database_id[0] ^= 1,
                _ => {
                    changed.checkpoint.rocksdb_sequence += 1;
                    changed.source_start.rocksdb_sequence += 1;
                    changed.source_end.rocksdb_sequence += 1;
                }
            }
            // Isolated, deliberately false metadata with a valid outer checksum.
            // Package verification does not itself claim to inspect primary state.
            fs::write(package.join(MANIFEST), changed.encode())?;
            BackupReceipt::verify(&package, &TransactionStartControl::new())?;
            let target = directory.path().join(format!("restore{mode}"));
            assert!(matches!(
                Store::restore_backup(&package, &target, &crate::store::RestoreOptions::default()),
                Err(crate::store::RestoreError::StateMismatch)
            ));
            assert!(
                !target
                    .join(crate::store::RestoreReceipt::manifest_name())
                    .exists()
            );
        }
        Ok(())
    }

    #[test]
    fn manifest_rejects_contribution_digest_drift_even_with_fresh_outer_checksum() -> TestResult {
        use crate::store::{
            ContributorCheckpoint, ContributorConsistency, ContributorDeclaration,
            ContributorHealth,
        };
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let commit = source
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([1; 16]),
            )?
            .into_transaction()
            .commit()?;
        let identity = ContributorIdentity::new([1; 16], std::num::NonZeroU32::MIN);
        let point = ContributorCheckpoint::new(commit)?;
        let artifact = directory.path().join("index");
        fs::write(&artifact, b"index")?;
        let contribution = BackupContribution::new(
            ContributorObservation::new(
                identity,
                Some(point.clone()),
                Some(point),
                ContributorHealth::Healthy,
            ),
            vec![BackupArtifact::new(
                "index".into(),
                artifact,
                5,
                Sha256::digest(b"index").into(),
            )?],
        )?;
        let options = BackupOptions {
            contributors: ContributorRegistry::new(vec![ContributorDeclaration::new(
                identity,
                true,
                ContributorConsistency::Strict,
                false,
            )])?,
            contributions: vec![contribution],
            ..BackupOptions::default()
        };
        let receipt = source.backup_with_receipt(directory.path().join("backup"), &options)?;
        for case in 0..4 {
            let mut altered = receipt.clone();
            let index = altered
                .files
                .iter()
                .position(|file| file.path.ends_with("/index"))
                .ok_or("index missing")?;
            match case {
                0 => altered.files[index].sha256 = [0; 32],
                1 => altered.files[index].size += 1,
                2 => altered.files[index].path.push_str("-renamed"),
                _ => {
                    // A matching replacement marker still cannot detach the frozen
                    // contribution identity from its observation and file set.
                    altered.contributions[0].1 = [0; 32];
                    let marker = altered
                        .files
                        .iter_mut()
                        .find(|file| file.path.ends_with("/_state"))
                        .ok_or("marker missing")?;
                    marker.sha256 = Sha256::digest([0; 32]).into();
                }
            }
            BackupReceipt::decode(&altered.encode())
                .err()
                .ok_or("detached contribution accepted")?;
        }
        Ok(())
    }

    #[test]
    fn closed_then_read_only_source_has_a_verifiable_checkpoint() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source_path = directory.path().join("source");
        let source = Store::open(&source_path)?;
        let node = NamedNode::new_unchecked("urn:backup");
        source.insert(Quad::new(
            node.clone(),
            node.clone(),
            node,
            GraphName::DefaultGraph,
        ))?;
        drop(source);
        let source = Store::open_read_only(&source_path)?;
        let before = source.backup_observation()?;
        source.backup(directory.path().join("raw"))?;
        let copy = Store::open_read_only(directory.path().join("raw"))?;
        assert_eq!(copy.len()?, 1);
        let (identity, _) = copy.backup_checkpoint()?;
        let after = source.backup_observation()?;
        assert!(
            before.rocksdb_sequence <= identity.rocksdb_sequence
                && identity.rocksdb_sequence <= after.rocksdb_sequence,
            "source before={before:?}, checkpoint={identity:?}, source after={after:?}"
        );
        let destination = directory.path().join("backup");
        let receipt = source.backup_with_receipt(&destination, &BackupOptions::default())?;
        assert_eq!(
            BackupReceipt::verify(&destination, &TransactionStartControl::new())?,
            receipt
        );
        Ok(())
    }

    #[test]
    fn postpublication_failure_is_indeterminate_and_verification_resolves_it() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let destination = directory.path().join("backup");
        let result =
            source.backup_with_receipt_inner(&destination, &BackupOptions::default(), |phase| {
                if phase == 4 {
                    Err(BackupError::Io(io::Error::other(
                        "injected directory-sync failure",
                    )))
                } else {
                    Ok(())
                }
            });
        assert!(matches!(
            result,
            Err(BackupError::CompletionIndeterminate(_))
        ));
        assert!(destination.join(MANIFEST).exists());
        BackupReceipt::verify(&destination, &TransactionStartControl::new())?;
        assert!(matches!(
            source.backup_with_receipt(&destination, &BackupOptions::default()),
            Err(BackupError::InvalidPath)
        ));
        Ok(())
    }

    #[test]
    fn interruption_at_each_prepublication_phase_never_mints_completion() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        for stop in 0..4 {
            let destination = directory.path().join(format!("phase{stop}"));
            let result = source.backup_with_receipt_inner(
                &destination,
                &BackupOptions::default(),
                |phase| {
                    if phase == stop {
                        Err(BackupError::Cancelled)
                    } else {
                        Ok(())
                    }
                },
            );
            assert!(matches!(result, Err(BackupError::Cancelled)));
            assert!(!destination.join(MANIFEST).exists());
            BackupReceipt::verify(&destination, &TransactionStartControl::new())
                .err()
                .ok_or("incomplete package verified")?;
        }
        Ok(())
    }

    #[test]
    fn source_advance_after_checkpoint_cannot_change_receipt_identity() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let first = source
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([1; 16]),
            )?
            .into_transaction()
            .commit()?;
        let destination = directory.path().join("backup");
        let receipt =
            source.backup_with_receipt_inner(&destination, &BackupOptions::default(), |phase| {
                if phase == 1 {
                    let node = NamedNode::new_unchecked("urn:after");
                    source.insert(Quad::new(
                        node.clone(),
                        node.clone(),
                        node,
                        GraphName::DefaultGraph,
                    ))?;
                }
                Ok(())
            })?;
        assert_eq!(receipt.checkpoint.latest_receipt, Some(first));
        assert_eq!(receipt.contents.quads, 0);
        assert!(receipt.source_end.rocksdb_sequence > receipt.checkpoint.rocksdb_sequence);
        assert_eq!(
            BackupReceipt::verify(&destination, &TransactionStartControl::new())?,
            receipt
        );
        Ok(())
    }

    #[test]
    fn manifest_decoder_rejects_noncanonical_paths_counts_and_inventories() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let receipt = source
            .backup_with_receipt(directory.path().join("backup"), &BackupOptions::default())?;
        for case in 0..6 {
            let mut altered = receipt.clone();
            match case {
                0 => altered.files[0].path = "store/../outside".into(),
                1 => altered.files.push(altered.files[0].clone()),
                2 => altered.contributor_inventory = vec![1, 0, 129],
                3 => altered.contributor_inventory.extend_from_slice(&[0]),
                4 => altered.checkpoint.governance_schema = Some(99),
                _ => altered.source_end.rocksdb_sequence = 0,
            }
            BackupReceipt::decode(&altered.encode())
                .err()
                .ok_or("invalid manifest accepted")?;
        }
        let bytes = receipt.encode();
        for length in [0, 1, MAGIC.len(), bytes.len() - 1] {
            BackupReceipt::decode(&bytes[..length])
                .err()
                .ok_or("truncation accepted")?;
        }
        Ok(())
    }
}
