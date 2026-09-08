//! Immutable provider generations and activation (ADR-0024).
#![expect(
    clippy::filetype_is_file,
    reason = "reject every non-regular payload, including symlinks and devices"
)]
use super::backup::{check, check_directory, open_regular, sync_directory};
use super::receipt::envelope_checksum;
use super::{
    BackupArtifact, BackupCheckpoint, BackupError, ContributorIdentity, DerivedDelta, DerivedError,
    DerivedLimits, DerivedSnapshot,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::num::{NonZeroU32, NonZeroU64, NonZeroUsize};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};
use std::time::Instant;

const IDENTITY: &str = "index.identity";
const ACTIVE: &str = "ACTIVE";
const ACTIVE_PENDING: &str = "ACTIVE.pending";
const ACTIVE_MAGIC: &[u8] = b"oxigraph.derived.active.v1\0";
const IDENTITY_MAGIC: &[u8] = b"oxigraph.derived.identity.v1\0";

/// Last in-process build/activation outcome. Reopen derives availability and
/// freshness from durable active state; it never resumes an interrupted build.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DerivedState {
    Unavailable,
    Building,
    Ready,
    Lagging,
    Failed,
    Corrupt,
}
#[derive(Clone)]
pub struct DerivedMonitor(Arc<AtomicU8>);
impl DerivedMonitor {
    pub fn state(&self) -> DerivedState {
        match self.0.load(Ordering::Acquire) {
            1 => DerivedState::Building,
            2 => DerivedState::Ready,
            3 => DerivedState::Lagging,
            4 => DerivedState::Failed,
            5 => DerivedState::Corrupt,
            _ => DerivedState::Unavailable,
        }
    }
    fn set(&self, state: DerivedState) {
        self.0.store(
            match state {
                DerivedState::Unavailable => 0,
                DerivedState::Building => 1,
                DerivedState::Ready => 2,
                DerivedState::Lagging => 3,
                DerivedState::Failed => 4,
                DerivedState::Corrupt => 5,
            },
            Ordering::Release,
        );
    }
}

/// One writer for an operator-owned index root. Unix advisory locking is on a
/// stable LOCK inode; it is released by the OS even after process termination.
/// Generations are immutable and never automatically deleted. This is not a
/// hostile concurrent-filesystem sandbox or a distributed/network-FS lock.
pub struct DerivedIndex {
    directory: PathBuf,
    identity: ContributorIdentity,
    _lock: fs::File,
    monitor: DerivedMonitor,
    discarded_pending: bool,
}
impl DerivedIndex {
    #[expect(
        clippy::create_dir,
        reason = "fresh index roots must reject existing data"
    )]
    pub fn create(
        directory: impl AsRef<Path>,
        identity: ContributorIdentity,
    ) -> Result<Self, DerivedGenerationError> {
        if !cfg!(unix) {
            return Err(BackupError::UnsupportedPlatform.into());
        }
        let directory = directory.as_ref();
        let parent = directory
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        check_directory(parent)?;
        fs::create_dir(directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
        }
        fs::create_dir(directory.join("generations"))?;
        write_new(&directory.join("LOCK"), &[])?;
        write_new(&directory.join(IDENTITY), &identity_bytes(identity))?;
        sync_directory(&directory.join("generations"))?;
        sync_directory(directory)?;
        sync_directory(parent)?;
        Self::open(directory, identity)
    }
    pub fn open(
        directory: impl AsRef<Path>,
        identity: ContributorIdentity,
    ) -> Result<Self, DerivedGenerationError> {
        if !cfg!(unix) {
            return Err(BackupError::UnsupportedPlatform.into());
        }
        let directory = directory.as_ref();
        check_directory(directory)?;
        if read_bounded(&directory.join(IDENTITY), 128)? != identity_bytes(identity) {
            return Err(DerivedGenerationError::Identity);
        }
        check_directory(&directory.join("generations"))?;
        let lock = open_regular(&directory.join("LOCK"))?;
        lock_file(&lock)?;
        // Only this fixed unpublished pointer is recoverable scratch. Never
        // remove an active pointer, candidate directory or provider payload.
        let discarded_pending = match fs::symlink_metadata(directory.join(ACTIVE_PENDING)) {
            Ok(meta) => {
                if !meta.is_file() || meta.len() > 128 {
                    return Err(DerivedGenerationError::Corrupt);
                }
                fs::remove_file(directory.join(ACTIVE_PENDING))?;
                sync_directory(directory)?;
                true
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            directory: directory.canonicalize()?,
            identity,
            _lock: lock,
            monitor: DerivedMonitor(Arc::new(AtomicU8::new(0))),
            discarded_pending,
        })
    }
    pub fn monitor(&self) -> DerivedMonitor {
        self.monitor.clone()
    }
    /// True only when this open discarded an unpublished ACTIVE.pending record.
    pub const fn recovered_pending_activation(&self) -> bool {
        self.discarded_pending
    }
    pub fn active(
        &self,
        limits: &DerivedGenerationLimits,
    ) -> Result<DerivedGeneration, DerivedGenerationError> {
        let path = self.directory.join(ACTIVE);
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(DerivedGenerationError::Unavailable);
            }
            Err(error) => return Err(error.into()),
            _ => (),
        }
        let (id, fingerprint) = read_active(&read_bounded(&path, 128)?)?;
        let generation = DerivedGeneration::open(
            self.directory.join("generations").join(hex(&id)),
            self.identity,
            limits,
        )?;
        if generation.id != id || generation.fingerprint() != fingerprint {
            return Err(DerivedGenerationError::Corrupt);
        }
        Ok(generation)
    }
    /// Strict consumers keep using `source`, not a newly opened Store view.
    /// Any physical difference is typed NotFresh; there is no receipt-only shortcut.
    pub fn strict<'a>(
        &self,
        source: &'a DerivedSnapshot,
        limits: &DerivedGenerationLimits,
    ) -> Result<DerivedView<'a>, DerivedGenerationError> {
        let started = Instant::now();
        check(&limits.input.control, started)?;
        let generation = self.active(limits)?;
        generation.check_snapshot(source, &limits.input)?;
        check(&limits.input.control, started)?;
        Ok(DerivedView {
            generation,
            source,
            eventual: false,
        })
    }
    /// Explicit stale view. The caller must expose its source/applied identity
    /// and cannot claim complete strict answers from its candidates.
    pub fn eventual<'a>(
        &self,
        source: &'a DerivedSnapshot,
        limits: &DerivedGenerationLimits,
    ) -> Result<DerivedView<'a>, DerivedGenerationError> {
        let generation = self.active(limits)?;
        same_lineage(&generation.source, source.checkpoint())?;
        Ok(DerivedView {
            generation,
            source,
            eventual: true,
        })
    }
    pub fn state(
        &self,
        source: &DerivedSnapshot,
        limits: &DerivedGenerationLimits,
    ) -> Result<DerivedState, DerivedGenerationError> {
        let started = Instant::now();
        check(&limits.input.control, started)?;
        if self.monitor.state() == DerivedState::Building {
            return Ok(DerivedState::Building);
        }
        let state = match self.active(limits) {
            Ok(generation) => {
                same_lineage(&generation.source, source.checkpoint())?;
                match generation.check_snapshot(source, &limits.input) {
                    Ok(()) => DerivedState::Ready,
                    Err(DerivedGenerationError::NotFresh) => DerivedState::Lagging,
                    Err(error) => return Err(error),
                }
            }
            Err(DerivedGenerationError::Unavailable) => DerivedState::Unavailable,
            Err(DerivedGenerationError::Corrupt | DerivedGenerationError::Identity) => {
                DerivedState::Corrupt
            }
            Err(error) => return Err(error),
        };
        self.monitor.set(state);
        check(&limits.input.control, started)?;
        Ok(state)
    }
    pub fn rebuild(
        &mut self,
        source: &DerivedSnapshot,
        provider: &dyn DerivedProvider,
        limits: &DerivedGenerationLimits,
    ) -> Result<DerivedGeneration, DerivedGenerationError> {
        self.build(source, provider, None, limits)
    }
    /// Copy a reconciled G2 restore contribution into a fresh inactive local
    /// generation. No hard links or in-place adoption; activation stays explicit.
    pub fn import_restored(
        &mut self,
        directory: impl AsRef<Path>,
        source: &DerivedSnapshot,
        provider: &dyn DerivedProvider,
        limits: &DerivedGenerationLimits,
    ) -> Result<DerivedGeneration, DerivedGenerationError> {
        struct Import<'a> {
            generation: &'a DerivedGeneration,
            provider: &'a dyn DerivedProvider,
        }
        impl DerivedProvider for Import<'_> {
            fn identity(&self) -> ContributorIdentity {
                self.provider.identity()
            }
            fn rebuild(
                &self,
                _: &DerivedSnapshot,
                output: &mut DerivedWriter<'_>,
                _: &DerivedLimits,
            ) -> Result<(), DerivedGenerationError> {
                for entry in &self.generation.files.entries {
                    output.write_file(&entry.name, self.generation.files.read(&entry.name)?)?;
                }
                Ok(())
            }
            fn reconcile(
                &self,
                source: &DerivedSnapshot,
                files: &DerivedFiles,
                limits: &DerivedLimits,
            ) -> Result<(), DerivedGenerationError> {
                self.provider.reconcile(source, files, limits)
            }
        }
        let generation =
            DerivedGeneration::open_inner(directory.as_ref(), self.identity, limits, true)?;
        generation.check_snapshot(source, &limits.input)?;
        self.rebuild(
            source,
            &Import {
                generation: &generation,
                provider,
            },
            limits,
        )
    }
    pub fn catch_up(
        &mut self,
        source: &DerivedSnapshot,
        provider: &dyn DerivedProvider,
        limits: &DerivedGenerationLimits,
    ) -> Result<DerivedGeneration, DerivedGenerationError> {
        let previous = self.active(limits)?;
        same_lineage(&previous.source, source.checkpoint())?;
        self.build(source, provider, Some(&previous), limits)
    }
    #[expect(
        clippy::create_dir,
        reason = "immutable candidates always use fresh directories"
    )]
    fn build(
        &mut self,
        source: &DerivedSnapshot,
        provider: &dyn DerivedProvider,
        previous: Option<&DerivedGeneration>,
        limits: &DerivedGenerationLimits,
    ) -> Result<DerivedGeneration, DerivedGenerationError> {
        self.monitor.set(DerivedState::Building);
        let result = (|| {
            let started = Instant::now();
            check(&limits.input.control, started)?;
            if provider.identity() != self.identity {
                return Err(DerivedGenerationError::Identity);
            }
            let mut stored = 0_u64;
            let mut count = 0_usize;
            for generation in fs::read_dir(self.directory.join("generations"))? {
                check(&limits.input.control, started)?;
                let generation = generation?;
                if !generation.file_type()?.is_dir() {
                    return Err(DerivedGenerationError::Corrupt);
                }
                count = count.checked_add(1).ok_or(DerivedGenerationError::Limit)?;
                if count >= limits.max_generations.get() {
                    return Err(DerivedGenerationError::Limit);
                }
                for (position, file) in fs::read_dir(generation.path())?.enumerate() {
                    if position >= 4098 {
                        return Err(DerivedGenerationError::Limit);
                    }
                    check(&limits.input.control, started)?;
                    let file = file?;
                    if !file.file_type()?.is_file() {
                        return Err(DerivedGenerationError::Corrupt);
                    }
                    stored = stored
                        .checked_add(file.metadata()?.len())
                        .filter(|bytes| *bytes <= limits.max_stored_bytes.get())
                        .ok_or(DerivedGenerationError::Limit)?;
                }
            }
            let available = limits
                .max_stored_bytes
                .get()
                .checked_sub(stored)
                .and_then(|bytes| bytes.checked_sub(MAX_MANIFEST))
                .and_then(NonZeroU64::new)
                .ok_or(DerivedGenerationError::Limit)?;
            let mut bounded = limits.clone();
            bounded.max_bytes = bounded.max_bytes.min(available);
            let id = rand::random::<[u8; 16]>();
            let directory = self.directory.join("generations").join(hex(&id));
            fs::create_dir(&directory)?;
            sync_directory(&self.directory.join("generations"))?;
            let mut writer = DerivedWriter {
                files: DerivedFiles {
                    directory,
                    entries: Vec::new(),
                },
                limits: &bounded,
                started,
                bytes: 0,
                failed: false,
            };
            if let Some(previous) = previous {
                let applied = previous
                    .source
                    .latest_receipt()
                    .cloned()
                    .map(super::ContributorCheckpoint::new)
                    .transpose()
                    .map_err(|_| DerivedGenerationError::Identity)?;
                let delta = source.delta(applied.as_ref(), &bounded.input)?;
                provider.apply(&previous.files, &delta, source, &mut writer, &bounded.input)?;
            } else {
                provider.rebuild(source, &mut writer, &bounded.input)?;
            }
            check(&limits.input.control, started)?;
            if writer.failed {
                return Err(DerivedGenerationError::WriterFailed);
            }
            writer
                .files
                .entries
                .sort_unstable_by(|a, b| a.name.cmp(&b.name));
            verify_files(&writer.files, &bounded, started, None, false)?;
            provider.reconcile(source, &writer.files, &bounded.input)?;
            check(&limits.input.control, started)?;
            verify_files(&writer.files, &bounded, started, None, false)?;
            let scan = source.scan(&bounded.input, |_| Ok(()))?;
            check(&limits.input.control, started)?;
            let generation = DerivedGeneration {
                id,
                identity: self.identity,
                source: source.checkpoint().clone(),
                base: previous.map(DerivedGeneration::fingerprint),
                input_records: scan.records(),
                input_bytes: scan.logical_bytes(),
                input_hash: *scan.sha256(),
                files: writer.files,
            };
            let bytes = generation.encode();
            if bytes.len() as u64 > MAX_MANIFEST {
                return Err(DerivedGenerationError::Limit);
            }
            write_new(&generation.files.directory.join(PENDING), &bytes)?;
            sync_directory(&generation.files.directory)?;
            check(&limits.input.control, started)?;
            fs::rename(
                generation.files.directory.join(PENDING),
                generation.files.directory.join(COMPLETE),
            )?;
            sync_directory(&generation.files.directory)?;
            Ok(generation)
        })();
        self.monitor.set(if result.is_ok() {
            DerivedState::Lagging
        } else {
            DerivedState::Failed
        });
        result
    }
    pub fn activate(
        &mut self,
        generation: &DerivedGeneration,
        source: &DerivedSnapshot,
        provider: &dyn DerivedProvider,
        limits: &DerivedGenerationLimits,
    ) -> Result<(), DerivedGenerationError> {
        self.activate_inner(generation, source, provider, limits, |_| Ok(()))
    }
    fn activate_inner(
        &mut self,
        generation: &DerivedGeneration,
        source: &DerivedSnapshot,
        provider: &dyn DerivedProvider,
        limits: &DerivedGenerationLimits,
        mut phase: impl FnMut(u8) -> io::Result<()>,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        check(&limits.input.control, started)?;
        if provider.identity() != self.identity || generation.identity != self.identity {
            return Err(DerivedGenerationError::Identity);
        }
        let expected = self.directory.join("generations").join(hex(&generation.id));
        if generation.files.directory.canonicalize()? != expected {
            return Err(DerivedGenerationError::Identity);
        }
        let checked = DerivedGeneration::open(&expected, self.identity, limits)?;
        if checked.fingerprint() != generation.fingerprint() {
            return Err(DerivedGenerationError::Corrupt);
        }
        checked.check_snapshot(source, &limits.input)?;
        provider.reconcile(source, &checked.files, &limits.input)?;
        check(&limits.input.control, started)?;
        verify_files(&checked.files, limits, started, Some(COMPLETE), false)?;
        if read_bounded(&expected.join(COMPLETE), MAX_MANIFEST)? != checked.encode() {
            return Err(DerivedGenerationError::Corrupt);
        }
        phase(0)?;
        write_new(
            &self.directory.join(ACTIVE_PENDING),
            &active_bytes(&checked),
        )?;
        sync_directory(&self.directory)?;
        phase(1)?;
        check(&limits.input.control, started)?;
        fs::rename(
            self.directory.join(ACTIVE_PENDING),
            self.directory.join(ACTIVE),
        )?;
        phase(2).map_err(DerivedGenerationError::ActivationIndeterminate)?;
        sync_directory(&self.directory).map_err(DerivedGenerationError::ActivationIndeterminate)?;
        self.monitor.set(DerivedState::Ready);
        Ok(())
    }
}

/// Binds candidate access to the same primary snapshot used for freshness.
pub struct DerivedView<'a> {
    generation: DerivedGeneration,
    source: &'a DerivedSnapshot,
    eventual: bool,
}
impl DerivedView<'_> {
    pub const fn generation(&self) -> &DerivedGeneration {
        &self.generation
    }
    pub const fn source(&self) -> &DerivedSnapshot {
        self.source
    }
    pub const fn is_eventual(&self) -> bool {
        self.eventual
    }
}
fn same_lineage(
    old: &BackupCheckpoint,
    current: &BackupCheckpoint,
) -> Result<(), DerivedGenerationError> {
    if old.database_id() != current.database_id()
        || old.store_identity() != current.store_identity()
        || old.storage_version() != current.storage_version()
        || old.rocksdb_sequence() > current.rocksdb_sequence()
    {
        return Err(DerivedGenerationError::Identity);
    }
    Ok(())
}
fn identity_bytes(identity: ContributorIdentity) -> Vec<u8> {
    let mut bytes = IDENTITY_MAGIC.to_vec();
    bytes.extend_from_slice(identity.provider());
    bytes.extend_from_slice(&identity.schema().get().to_be_bytes());
    bytes.extend_from_slice(&envelope_checksum(IDENTITY_MAGIC, &bytes));
    bytes
}
fn active_bytes(generation: &DerivedGeneration) -> Vec<u8> {
    let mut bytes = ACTIVE_MAGIC.to_vec();
    bytes.extend_from_slice(&generation.id);
    bytes.extend_from_slice(&generation.fingerprint());
    bytes.extend_from_slice(&envelope_checksum(ACTIVE_MAGIC, &bytes));
    bytes
}
fn read_active(bytes: &[u8]) -> Result<([u8; 16], [u8; 32]), DerivedGenerationError> {
    let body = bytes
        .strip_prefix(ACTIVE_MAGIC)
        .ok_or(DerivedGenerationError::Corrupt)?;
    if body.len() != 80
        || envelope_checksum(ACTIVE_MAGIC, &bytes[..bytes.len() - 32]).as_slice() != &body[48..]
    {
        return Err(DerivedGenerationError::Corrupt);
    }
    let (id, remainder) = body.split_at(16);
    let (fingerprint, _) = remainder.split_at(32);
    Ok((
        id.try_into().map_err(|_| DerivedGenerationError::Corrupt)?,
        fingerprint
            .try_into()
            .map_err(|_| DerivedGenerationError::Corrupt)?,
    ))
}
fn hex(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        value.push(char::from(CHARS[usize::from(b >> 4)]));
        value.push(char::from(CHARS[usize::from(b & 15)]));
    }
    value
}
fn lock_file(file: &fs::File) -> Result<(), DerivedGenerationError> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        #[expect(
            unsafe_code,
            reason = "flock receives a live owned file descriptor; no pointer dereference"
        )]
        // SAFETY: the descriptor remains owned/live for the lifetime of DerivedIndex.
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if result != 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::WouldBlock {
                return Err(DerivedGenerationError::Busy);
            }
            return Err(error.into());
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = file;
        Err(BackupError::UnsupportedPlatform.into())
    }
}

const COMPLETE: &str = "generation.complete";
const PENDING: &str = "generation.pending";
const MAGIC: &[u8] = b"oxigraph.derived.generation.v1\0";
const MAX_MANIFEST: u64 = 1024 * 1024;

#[derive(Clone)]
pub struct DerivedGenerationLimits {
    pub input: DerivedLimits,
    pub max_files: NonZeroUsize,
    pub max_bytes: NonZeroU64,
    /// Includes incomplete and inactive generations, which are never deleted automatically.
    pub max_generations: NonZeroUsize,
    pub max_stored_bytes: NonZeroU64,
}
impl Default for DerivedGenerationLimits {
    fn default() -> Self {
        Self {
            input: DerivedLimits::default(),
            max_files: NonZeroUsize::new(256).unwrap_or(NonZeroUsize::MIN),
            max_bytes: NonZeroU64::new(256 * 1024 * 1024).unwrap_or(NonZeroU64::MIN),
            max_generations: NonZeroUsize::new(64).unwrap_or(NonZeroUsize::MIN),
            max_stored_bytes: NonZeroU64::new(4 * 1024 * 1024 * 1024).unwrap_or(NonZeroU64::MIN),
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum DerivedGenerationError {
    #[error(transparent)]
    Input(#[from] DerivedError),
    #[error(transparent)]
    Backup(#[from] BackupError),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("derived provider/schema or primary lineage mismatch")]
    Identity,
    #[error("derived generation manifest, inventory or checksum is corrupt")]
    Corrupt,
    #[error("derived generation resource ceiling exceeded")]
    Limit,
    #[error("derived payload writer failed; discard the candidate")]
    WriterFailed,
    #[error("provider requires a full rebuild")]
    RebuildRequired,
    #[error("provider rejected candidate equivalence to the authoritative snapshot: {0}")]
    Reconciliation(String),
    #[error("derived index is already owned by another writer")]
    Busy,
    #[error("derived index has no active generation")]
    Unavailable,
    #[error("derived generation does not match the required primary snapshot")]
    NotFresh,
    #[error(
        "activation was published but final synchronization failed; inspect the active pointer: {0}"
    )]
    ActivationIndeterminate(io::Error),
}

/// Trusted engine adapter. Reconciliation must independently compare candidate
/// semantics with the exact primary snapshot, including changes absent from the
/// governed outbox. A successful delta application alone is never sufficient.
/// Engines must bound their own working memory, honor cancellation, and release
/// handles before returning. Core bounds copied payloads and rehashes them.
pub trait DerivedProvider: Send + Sync {
    fn identity(&self) -> ContributorIdentity;
    fn rebuild(
        &self,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError>;
    fn apply(
        &self,
        _previous: &DerivedFiles,
        _delta: &DerivedDelta,
        _source: &DerivedSnapshot,
        _output: &mut DerivedWriter<'_>,
        _limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        Err(DerivedGenerationError::RebuildRequired)
    }
    fn reconcile(
        &self,
        source: &DerivedSnapshot,
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Entry {
    name: String,
    size: u64,
    hash: [u8; 32],
}

/// Read-only, checksummed provider payloads. This deliberately does not expose
/// expected reconciliation observations or a writable directory handle.
#[derive(Clone, Debug)]
pub struct DerivedFiles {
    directory: PathBuf,
    entries: Vec<Entry>,
}
impl DerivedFiles {
    /// Hydrate an immutable provider payload against this retained inventory.
    /// Checking the copied bytes closes the gap between view admission and a
    /// later query; an earlier successful generation open is not a file lease.
    #[cfg(feature = "text-index")]
    pub(super) fn read_verified(
        &self,
        name: &str,
        max_bytes: usize,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Vec<u8>, DerivedGenerationError> {
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.name == name)
            .ok_or(DerivedGenerationError::Corrupt)?;
        if entry.size > u64::try_from(max_bytes).map_err(|_| DerivedGenerationError::Limit)? {
            return Err(DerivedGenerationError::Limit);
        }
        let mut file = open_regular(&self.directory.join(name))?;
        if file.metadata()?.len() != entry.size {
            return Err(DerivedGenerationError::Corrupt);
        }
        let mut bytes = Vec::new();
        let mut buffer = vec![0; 64 * 1024];
        loop {
            check(&limits.control, started)?;
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            if bytes.len().checked_add(count).is_none_or(|size| {
                size > max_bytes || u64::try_from(size).map_or(true, |size| size > entry.size)
            }) {
                return Err(DerivedGenerationError::Corrupt);
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        if u64::try_from(bytes.len()).map_err(|_| DerivedGenerationError::Limit)? != entry.size
            || Sha256::digest(&bytes).as_slice() != entry.hash
        {
            return Err(DerivedGenerationError::Corrupt);
        }
        check(&limits.control, started)?;
        Ok(bytes)
    }

    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|entry| entry.name.as_str())
    }
    pub fn read(&self, name: &str) -> Result<impl Read + use<>, DerivedGenerationError> {
        if !self.entries.iter().any(|entry| entry.name == name) {
            return Err(DerivedGenerationError::Corrupt);
        }
        Ok(open_regular(&self.directory.join(name))?)
    }
}

/// Bounded append-only candidate output. No existing file can be overwritten;
/// any write failure poisons finalization even if an adapter swallows the error.
pub struct DerivedWriter<'a> {
    files: DerivedFiles,
    limits: &'a DerivedGenerationLimits,
    started: Instant,
    bytes: u64,
    failed: bool,
}
impl DerivedWriter<'_> {
    pub fn write_file(
        &mut self,
        name: &str,
        mut input: impl Read,
    ) -> Result<(), DerivedGenerationError> {
        if self.failed {
            return Err(DerivedGenerationError::WriterFailed);
        }
        let result = self.write_inner(name, &mut input);
        if result.is_err() {
            self.failed = true;
        }
        result
    }
    fn write_inner(
        &mut self,
        name: &str,
        input: &mut impl Read,
    ) -> Result<(), DerivedGenerationError> {
        valid_name(name)?;
        if self.files.entries.len() >= self.limits.max_files.get().min(4096) {
            return Err(DerivedGenerationError::Limit);
        }
        check(&self.limits.input.control, self.started)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.files.directory.join(name))?;
        let mut hash = Sha256::new();
        let mut size = 0_u64;
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            check(&self.limits.input.control, self.started)?;
            let count = input.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            self.bytes = self
                .bytes
                .checked_add(count as u64)
                .filter(|size| *size <= self.limits.max_bytes.get())
                .ok_or(DerivedGenerationError::Limit)?;
            size = size
                .checked_add(count as u64)
                .ok_or(DerivedGenerationError::Limit)?;
            hash.update(&buffer[..count]);
            output.write_all(&buffer[..count])?;
        }
        output.sync_all()?;
        self.files.entries.push(Entry {
            name: name.into(),
            size,
            hash: hash.finalize().into(),
        });
        Ok(())
    }
}

/// Immutable, semantically reconciled candidate. Checksums detect accidental
/// corruption, not a dishonest provider/operator who rewrites all bindings.
#[derive(Clone, Debug)]
pub struct DerivedGeneration {
    id: [u8; 16],
    identity: ContributorIdentity,
    source: BackupCheckpoint,
    base: Option<[u8; 32]>,
    input_records: u64,
    input_bytes: u64,
    input_hash: [u8; 32],
    files: DerivedFiles,
}
impl DerivedGeneration {
    fn check_snapshot(
        &self,
        source: &DerivedSnapshot,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        if self.source != *source.checkpoint() {
            return Err(DerivedGenerationError::NotFresh);
        }
        // Copied sibling stores retain physical/governed IDs and may reach the
        // same sequence with different ungoverned contents. Equality is not ancestry.
        let scan = source.scan(limits, |_| Ok(()))?;
        if scan.sha256() != &self.input_hash
            || scan.records() != self.input_records
            || scan.logical_bytes() != self.input_bytes
        {
            return Err(DerivedGenerationError::NotFresh);
        }
        Ok(())
    }
    /// Observe against a full primary token. Receipt equality alone never
    /// produces Healthy: ungoverned differences require rebuilding too.
    pub fn observation(
        &self,
        source: &DerivedSnapshot,
        limits: &DerivedGenerationLimits,
    ) -> Result<super::ContributorObservation, DerivedGenerationError> {
        let started = Instant::now();
        check(&limits.input.control, started)?;
        same_lineage(&self.source, source.checkpoint())?;
        let checked = Self::open(&self.files.directory, self.identity, limits)?;
        if checked.fingerprint() != self.fingerprint() {
            return Err(DerivedGenerationError::Corrupt);
        }
        let health = match self.check_snapshot(source, &limits.input) {
            Ok(()) => super::ContributorHealth::Healthy,
            Err(DerivedGenerationError::NotFresh) => super::ContributorHealth::Rebuilding,
            Err(error) => return Err(error),
        };
        let point = |checkpoint: &BackupCheckpoint| {
            checkpoint
                .latest_receipt()
                .cloned()
                .map(super::ContributorCheckpoint::new)
                .transpose()
                .map_err(|_| DerivedGenerationError::Identity)
        };
        check(&limits.input.control, started)?;
        Ok(super::ContributorObservation::new(
            self.identity,
            point(source.checkpoint())?,
            point(&self.source)?,
            health,
        ))
    }
    /// Freeze a verified generation for G2 backup. Admission checks its full
    /// checkpoint against the actual packaged database, not a later receipt.
    pub fn backup_contribution(
        &self,
        limits: &DerivedGenerationLimits,
    ) -> Result<super::BackupContribution, DerivedGenerationError> {
        let checked = Self::open(&self.files.directory, self.identity, limits)?;
        if checked.fingerprint() != self.fingerprint() {
            return Err(DerivedGenerationError::Corrupt);
        }
        let point = self
            .source
            .latest_receipt()
            .cloned()
            .map(super::ContributorCheckpoint::new)
            .transpose()
            .map_err(|_| DerivedGenerationError::Identity)?;
        let observation = super::ContributorObservation::new(
            self.identity,
            point.clone(),
            point,
            super::ContributorHealth::Healthy,
        );
        let mut artifacts = self
            .files
            .entries
            .iter()
            .map(|entry| {
                BackupArtifact::new(
                    entry.name.clone(),
                    self.files.directory.join(&entry.name),
                    entry.size,
                    entry.hash,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let bytes = self.encode();
        artifacts.push(BackupArtifact::new(
            COMPLETE.into(),
            self.files.directory.join(COMPLETE),
            bytes.len() as u64,
            Sha256::digest(&bytes).into(),
        )?);
        Ok(
            super::BackupContribution::new(observation, artifacts)?.at_primary(
                self.source.clone(),
                (self.input_hash, self.input_records, self.input_bytes),
            ),
        )
    }
    pub const fn identity(&self) -> ContributorIdentity {
        self.identity
    }
    pub const fn source(&self) -> &BackupCheckpoint {
        &self.source
    }
    pub const fn files(&self) -> &DerivedFiles {
        &self.files
    }
    pub const fn base_fingerprint(&self) -> Option<&[u8; 32]> {
        self.base.as_ref()
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        envelope_checksum(MAGIC, &self.encode())
    }
    pub fn directory(&self) -> &Path {
        &self.files.directory
    }
    pub const fn input_hash(&self) -> &[u8; 32] {
        &self.input_hash
    }

    /// Verifies a generation package without claiming it matches a current store.
    pub fn open(
        directory: impl AsRef<Path>,
        identity: ContributorIdentity,
        limits: &DerivedGenerationLimits,
    ) -> Result<Self, DerivedGenerationError> {
        Self::open_inner(directory.as_ref(), identity, limits, false)
    }
    fn open_inner(
        directory: &Path,
        identity: ContributorIdentity,
        limits: &DerivedGenerationLimits,
        contribution: bool,
    ) -> Result<Self, DerivedGenerationError> {
        let started = Instant::now();
        check(&limits.input.control, started)?;
        check_directory(directory)?;
        let bytes = read_bounded(&directory.join(COMPLETE), MAX_MANIFEST)?;
        let value = Self::decode(&bytes, directory.to_owned())?;
        if value.identity != identity {
            return Err(DerivedGenerationError::Identity);
        }
        verify_files(&value.files, limits, started, Some(COMPLETE), contribution)?;
        Ok(value)
    }
    #[expect(
        clippy::cast_possible_truncation,
        reason = "private inventory is bounded to 4096 entries before construction/decoding"
    )]
    fn encode(&self) -> Vec<u8> {
        let mut bytes = MAGIC.to_vec();
        bytes.extend_from_slice(&self.id);
        bytes.extend_from_slice(self.identity.provider());
        bytes.extend_from_slice(&self.identity.schema().get().to_be_bytes());
        blob(&mut bytes, &self.source.encoded());
        bytes.push(u8::from(self.base.is_some()));
        if let Some(base) = self.base {
            bytes.extend_from_slice(&base);
        }
        bytes.extend_from_slice(&self.input_records.to_be_bytes());
        bytes.extend_from_slice(&self.input_bytes.to_be_bytes());
        bytes.extend_from_slice(&self.input_hash);
        bytes.extend_from_slice(&(self.files.entries.len() as u32).to_be_bytes());
        for entry in &self.files.entries {
            blob(&mut bytes, entry.name.as_bytes());
            bytes.extend_from_slice(&entry.size.to_be_bytes());
            bytes.extend_from_slice(&entry.hash);
        }
        bytes.extend_from_slice(&envelope_checksum(MAGIC, &bytes));
        bytes
    }
    fn decode(bytes: &[u8], directory: PathBuf) -> Result<Self, DerivedGenerationError> {
        let split = bytes
            .len()
            .checked_sub(32)
            .ok_or(DerivedGenerationError::Corrupt)?;
        let (body, checksum) = bytes.split_at(split);
        if envelope_checksum(MAGIC, body).as_slice() != checksum {
            return Err(DerivedGenerationError::Corrupt);
        }
        let mut input = Input(
            body.strip_prefix(MAGIC)
                .ok_or(DerivedGenerationError::Corrupt)?,
        );
        let id = input.array()?;
        let provider = input.array()?;
        let schema = NonZeroU32::new(u32::from_be_bytes(input.array()?))
            .ok_or(DerivedGenerationError::Corrupt)?;
        let source = BackupCheckpoint::from_encoded(input.blob(4096)?)?;
        let base = match input.array()? {
            [0] => None,
            [1] => Some(input.array()?),
            _ => return Err(DerivedGenerationError::Corrupt),
        };
        let input_records = u64::from_be_bytes(input.array()?);
        let input_bytes = u64::from_be_bytes(input.array()?);
        let input_hash = input.array()?;
        let count = u32::from_be_bytes(input.array()?) as usize;
        if count > 4096 {
            return Err(DerivedGenerationError::Limit);
        }
        let mut entries = Vec::with_capacity(count);
        for _ in 0..count {
            let name = std::str::from_utf8(input.blob(240)?)
                .map_err(|_| DerivedGenerationError::Corrupt)?
                .to_owned();
            valid_name(&name)?;
            let size = u64::from_be_bytes(input.array()?);
            let hash = input.array()?;
            if entries.last().is_some_and(|last: &Entry| last.name >= name) {
                return Err(DerivedGenerationError::Corrupt);
            }
            entries.push(Entry { name, size, hash });
        }
        let value = Self {
            id,
            identity: ContributorIdentity::new(provider, schema),
            source,
            base,
            input_records,
            input_bytes,
            input_hash,
            files: DerivedFiles { directory, entries },
        };
        if !input.0.is_empty() || value.encode() != bytes {
            return Err(DerivedGenerationError::Corrupt);
        }
        Ok(value)
    }
}

/// G2 restore adapter: independently reconcile copied provider bytes against a
/// borrowed primary snapshot. All read-only database handles close on return.
pub struct DerivedRestore {
    provider: Arc<dyn DerivedProvider>,
    limits: DerivedGenerationLimits,
}
impl DerivedRestore {
    pub fn new(provider: Arc<dyn DerivedProvider>, limits: DerivedGenerationLimits) -> Self {
        Self { provider, limits }
    }
}
impl super::RestoreContributor for DerivedRestore {
    fn identity(&self) -> ContributorIdentity {
        self.provider.identity()
    }
    fn reconcile(
        &self,
        declaration: &super::ContributorDeclaration,
        directory: &Path,
        primary: &super::RestorePrimary<'_>,
        control: &super::TransactionStartControl,
    ) -> Result<super::ContributorObservation, super::StorageError> {
        let result = (|| {
            if declaration.identity() != self.provider.identity() {
                return Err(DerivedGenerationError::Identity);
            }
            let mut limits = self.limits.clone();
            limits.input.control = control.clone();
            let generation =
                DerivedGeneration::open_inner(directory, self.provider.identity(), &limits, true)?;
            if generation.source != *primary.checkpoint() {
                return Err(DerivedGenerationError::NotFresh);
            }
            primary.with_derived_snapshot(control, |snapshot| {
                if snapshot.checkpoint() != &generation.source {
                    return Err(DerivedGenerationError::NotFresh);
                }
                self.provider
                    .reconcile(snapshot, &generation.files, &limits.input)?;
                let scan = snapshot.scan(&limits.input, |_| Ok(()))?;
                if scan.records() != generation.input_records
                    || scan.logical_bytes() != generation.input_bytes
                    || scan.sha256() != &generation.input_hash
                {
                    return Err(DerivedGenerationError::Corrupt);
                }
                Ok(())
            })?;
            let checked =
                DerivedGeneration::open_inner(directory, self.provider.identity(), &limits, true)?;
            if checked.fingerprint() != generation.fingerprint() {
                return Err(DerivedGenerationError::Corrupt);
            }
            let point = generation
                .source
                .latest_receipt()
                .cloned()
                .map(super::ContributorCheckpoint::new)
                .transpose()
                .map_err(|_| DerivedGenerationError::Identity)?;
            Ok(super::ContributorObservation::new(
                generation.identity,
                point.clone(),
                point,
                super::ContributorHealth::Healthy,
            ))
        })();
        result.map_err(|error: DerivedGenerationError| super::StorageError::Other(Box::new(error)))
    }
}

fn valid_name(name: &str) -> Result<(), DerivedGenerationError> {
    if matches!(name, COMPLETE | PENDING) {
        return Err(DerivedGenerationError::Corrupt);
    }
    BackupArtifact::new(name.into(), PathBuf::new(), 0, [0; 32])?;
    Ok(())
}
fn verify_files(
    files: &DerivedFiles,
    limits: &DerivedGenerationLimits,
    started: Instant,
    manifest: Option<&str>,
    contribution: bool,
) -> Result<(), DerivedGenerationError> {
    if files.entries.len() > limits.max_files.get() {
        return Err(DerivedGenerationError::Limit);
    }
    let mut expected = files
        .entries
        .iter()
        .map(|entry| entry.name.clone())
        .collect::<BTreeSet<_>>();
    if let Some(manifest) = manifest {
        expected.insert(manifest.into());
    }
    if contribution {
        expected.insert("_state".into());
    }
    let mut seen = BTreeSet::new();
    for entry in fs::read_dir(&files.directory)? {
        check(&limits.input.control, started)?;
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| DerivedGenerationError::Corrupt)?;
        if !expected.contains(&name) || !entry.file_type()?.is_file() || !seen.insert(name) {
            return Err(DerivedGenerationError::Corrupt);
        }
    }
    if seen != expected {
        return Err(DerivedGenerationError::Corrupt);
    }
    let mut total = 0_u64;
    for entry in &files.entries {
        let mut file = open_regular(&files.directory.join(&entry.name))?;
        if file.metadata()?.len() != entry.size {
            return Err(DerivedGenerationError::Corrupt);
        }
        total = total
            .checked_add(entry.size)
            .filter(|size| *size <= limits.max_bytes.get())
            .ok_or(DerivedGenerationError::Limit)?;
        let mut hash = Sha256::new();
        let mut size = 0_u64;
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            check(&limits.input.control, started)?;
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            size = size
                .checked_add(n as u64)
                .filter(|size| *size <= entry.size)
                .ok_or(DerivedGenerationError::Corrupt)?;
            hash.update(&buffer[..n]);
        }
        if size != entry.size || <[u8; 32]>::from(hash.finalize()) != entry.hash {
            return Err(DerivedGenerationError::Corrupt);
        }
    }
    Ok(())
}
fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>, DerivedGenerationError> {
    let mut file = open_regular(path)?;
    if file.metadata()?.len() > max {
        return Err(DerivedGenerationError::Limit);
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(max + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max {
        return Err(DerivedGenerationError::Limit);
    }
    Ok(bytes)
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), DerivedGenerationError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
#[expect(
    clippy::cast_possible_truncation,
    reason = "private callers pass bounded checkpoint encodings or names at most 240 bytes"
)]
fn blob(bytes: &mut Vec<u8>, value: &[u8]) {
    bytes.extend_from_slice(&(value.len() as u32).to_be_bytes());
    bytes.extend_from_slice(value);
}
struct Input<'a>(&'a [u8]);
impl<'a> Input<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], DerivedGenerationError> {
        if n > self.0.len() {
            return Err(DerivedGenerationError::Corrupt);
        }
        let (value, rest) = self.0.split_at(n);
        self.0 = rest;
        Ok(value)
    }
    fn array<const N: usize>(&mut self) -> Result<[u8; N], DerivedGenerationError> {
        self.take(N)?
            .try_into()
            .map_err(|_| DerivedGenerationError::Corrupt)
    }
    fn blob(&mut self, max: usize) -> Result<&'a [u8], DerivedGenerationError> {
        let n = u32::from_be_bytes(self.array()?) as usize;
        if n > max {
            return Err(DerivedGenerationError::Limit);
        }
        self.take(n)
    }
}

#[cfg(all(test, unix))]
#[path = "derived_generation_tests.rs"]
mod tests;
