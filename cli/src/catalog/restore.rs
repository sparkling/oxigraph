//! Opt-in recovery-package restore for the embedded catalog (Linux). No purge,
//! HTTP or admin activation.
//!
//! `restore_tombstoned` re-creates a repository from the verified recovery package of
//! its own `Tombstoned` entry under a NEW manager-generated UUID and a caller-supplied
//! fresh external `RepositoryId`. The caller gives the source ID, the source entry
//! generation, the exact tombstone backup fingerprint, the catalog generation and
//! injected logical time. It never gives a physical path or raw backup URI.
//!
//! Order: preflight (no mutation) -> durable `Reserved` entry carrying restore
//! provenance (source, exact backup binding, bounds, attempt) -> `Store::restore_backup`
//! into the per-attempt root `staging/<uuid>.restore-<attempt>` -> same-device rename of
//! its `store/` to `staging/<uuid>` and syncs of `staging/`, the attempt root and the
//! manager root -> owner-only permissions -> candidate proof (`prove_candidate`):
//! manager verification (`verified`), the completion receipt, the re-verified exact
//! package, a record-by-record content comparison and the CURRENT primary checkpoint,
//! outbox and inventory against that receipt -> durable `Validated` -> publish to
//! `repos/<uuid>` -> durable `Closed`. `Closed` is never minted from directory
//! presence or from the historical completion record alone.
//!
//! Attempts: `RestoreRecord::attempt` is the catalog generation that wrote the current
//! attempt and names its root. The primitive never resumes a partial restore and never
//! overwrites, renames or deletes an attempt root. An incomplete attempt (no completion
//! marker, a pending marker only, or a foreign file or symlink at the path) is retained
//! as inventoried debris and the entry stays `Reserved` and retryable; `retry_restore`
//! then allocates a new attempt path. Every attempt root consumes one scan slot and its
//! disk until the operator removes it, so repeated retries end in a pre-write `Limit`
//! refusal.
//!
//! Reconciliation is idempotent from disk and shared by the live path,
//! `retry_restore` and restart. `Failed` is persisted only for definite evidence:
//! corruption, unsafe or unexplained staged/published paths, an unsupported profile,
//! package, content or current-primary mismatch, an invalid or missing completion
//! receipt, a changed materialization identity, or a changed source binding. A
//! missing `store/` or `contributors/` inside an existing package whose completion
//! marker is present is definite package corruption. Debris is kept untouched and
//! never adopted or deleted. Transient or resource refusals (I/O, permissions,
//! limits, cancellation, timeouts, a missing package or completion marker, injected
//! hooks) change nothing and do not poison. A failed catalog write poisons, as
//! everywhere else.
//!
//! `Validated` restart: the source binding, recorded evidence (directory identity
//! before any native open), completion receipt, exact package, content and current
//! primary are proved again for whichever of `staging/<uuid>` and `repos/<uuid>`
//! exists; a staged candidate is then renamed, and in both cases `repos/` and
//! `staging/` are synced again before `Closed`. A `Reserved` entry advanced on restart
//! to `Validated` is published through the same non-poisoning seam, never through the
//! live publication path. No logical time is injected on restart: it completes a
//! restore already admitted inside its retention window.
//!
//! Untouched: the source entry (generation, retention deadline, backup binding), its
//! trash directory and its package. A restore does not consume the package and may be
//! repeated under other IDs.
//!
//! Identity semantics: ADR-0022 restore preserves the physical DB ID and governed
//! `StoreIdentity`. The new manager UUID names a distinct catalog entry and directory;
//! it is NOT a changed store identity. Two restores of one tombstone have equal
//! `StoreIdentity`. This is not a fork, and no rekey primitive is claimed.
//!
//! Known limits: the retained completed attempt root holds `contributors/`,
//! `oxigraph-backup.source` and `oxigraph-restore.complete`, with no `store/`, and
//! consumes one scan slot per restored repository. Content and state equality rest on
//! `restore_backup`'s reconciliation, the manager's comparison and
//! `RestoreReceipt::verify_current_primary` (contributor-free profile only), not a
//! hostile concurrent-filesystem defense. Hook errors and `process::exit` model crash
//! phases, not power loss. The final move uses a plain same-device rename after an
//! existence check.
use super::codec::{BackupBinding, Catalog, Entry, Materialized, RestoreRecord};
use super::{
    BackupFailure, CatalogError, FaultPoint, ManagerLimits, Phase, RepositoryManager,
    RepositoryRecord, fs as catalog_fs,
};
use crate::lease::LogicalTime;
use crate::repository::RepositoryId;
use oxigraph::store::{
    BackupError, BackupReceipt, GovernanceError, OutboxReadError, RestoreError, RestoreOptions,
    RestoreReceipt, StorageError, Store, TransactionStartControl,
};
use sha2::{Digest, Sha256};
use std::ffi::CString;
use std::num::{NonZeroU64, NonZeroUsize};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Bound on the package tree walk depth: package root, then `store`/`contributors`.
const MAX_DEPTH: u8 = 2;

/// Request to restore one tombstoned repository under a fresh ID and UUID.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RestoreRequest {
    /// External ID of the `Tombstoned` source entry.
    pub source: RepositoryId,
    /// The source entry's own generation (`RepositoryRecord::changed_at`).
    pub source_generation: u64,
    /// Exact fingerprint of the source's tombstone backup receipt.
    pub backup_fingerprint: [u8; 32],
    /// Validated fresh external ID for the new entry.
    pub new_id: RepositoryId,
    /// Catalog generation compare-and-swap.
    pub catalog_generation: u64,
    /// Injected logical time; must be in `[intent_time, deadline)` of the tombstone.
    pub now: LogicalTime,
}

/// Read-only provenance of a restored entry. Never exposes a UUID or physical path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RestoreInfo {
    source: RepositoryId,
    source_generation: u64,
    backup_fingerprint: [u8; 32],
    intent_time: u64,
}

impl RestoreInfo {
    pub fn source(&self) -> &RepositoryId {
        &self.source
    }
    pub fn source_generation(&self) -> u64 {
        self.source_generation
    }
    pub fn backup_fingerprint(&self) -> [u8; 32] {
        self.backup_fingerprint
    }
    pub fn intent_time(&self) -> u64 {
        self.intent_time
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    hex(&digest)
}

fn parse_hex32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut out = [0_u8; 32];
    for (slot, chunk) in out.iter_mut().zip(value.as_bytes().chunks(2)) {
        *slot = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
    }
    Some(out)
}

fn package_name(uuid: &str, attempt: u64) -> String {
    format!("{uuid}-{attempt}")
}

fn control(timeout_ms: u64) -> TransactionStartControl {
    TransactionStartControl::new().with_timeout(Duration::from_millis(timeout_ms))
}

fn free_bytes(path: &Path) -> Result<u64, CatalogError> {
    let c_path = CString::new(path.as_os_str().as_bytes()).map_err(|_| CatalogError::UnsafePath)?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: c_path is a valid NUL-terminated path and stat is a valid out pointer.
    #[expect(unsafe_code)]
    let code = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
    if code != 0 {
        return Err(CatalogError::Io);
    }
    // SAFETY: statvfs returned success, so it fully initialized the structure.
    #[expect(unsafe_code)]
    let stat = unsafe { stat.assume_init() };
    let available = u64::try_from(stat.f_bavail).map_err(|_| CatalogError::Limit)?;
    let block = u64::try_from(stat.f_frsize).map_err(|_| CatalogError::Limit)?;
    available.checked_mul(block).ok_or(CatalogError::Limit)
}

/// Record-by-record equality of two native-order streams, bounded by `expected`
/// (at most one extra record is read) and by `deadline`.
fn lockstep<T: PartialEq>(
    mut left: impl Iterator<Item = Result<T, StorageError>>,
    mut right: impl Iterator<Item = Result<T, StorageError>>,
    expected: u64,
    deadline: Instant,
) -> Result<(), CatalogError> {
    let mismatch = CatalogError::Backup(BackupFailure::FileMismatch);
    let mut count = 0_u64;
    loop {
        if Instant::now() >= deadline {
            return Err(CatalogError::Backup(BackupFailure::TimedOut));
        }
        match (left.next().transpose()?, right.next().transpose()?) {
            (None, None) => break,
            (Some(a), Some(b)) if a == b => {
                count = count.checked_add(1).ok_or(CatalogError::Limit)?;
                if count > expected {
                    return Err(mismatch);
                }
            }
            _ => return Err(mismatch),
        }
    }
    if count == expected {
        Ok(())
    } else {
        Err(mismatch)
    }
}

/// Exact bounded comparison of the restored store with the verified package store:
/// quads, named graphs (including empty ones) and namespaces, each equal in native
/// order and each count equal to the recorded binding.
fn content_matches(
    staged: &Path,
    package: &Path,
    binding: &BackupBinding,
    timeout_ms: u64,
) -> Result<(), CatalogError> {
    let deadline = Instant::now()
        .checked_add(Duration::from_millis(timeout_ms))
        .ok_or(CatalogError::Limit)?;
    let restored = Store::open_read_only(staged).map_err(CatalogError::from)?;
    let packaged = Store::open_read_only(package.join(BackupReceipt::store_directory()))
        .map_err(CatalogError::from)?;
    lockstep(restored.iter(), packaged.iter(), binding.quads, deadline)?;
    lockstep(
        restored.named_graphs(),
        packaged.named_graphs(),
        binding.named_graphs,
        deadline,
    )?;
    lockstep(
        restored.namespaces(),
        packaged.namespaces(),
        binding.namespaces,
        deadline,
    )
}

/// Defensive invariant only: manager packages always use the empty contributor
/// registry, and restore's default registry rejects any contributor profile.
fn check_profile(receipt: &BackupReceipt) -> Result<(), CatalogError> {
    if !receipt.contributions().is_empty()
        || receipt.contributor_inventory() != [1_u8, 0, 0].as_slice()
        || receipt
            .files()
            .iter()
            .any(|file| file.path().starts_with("contributors/"))
        || receipt.checkpoint().storage_version() != 2
    {
        return Err(CatalogError::UnsupportedProfile);
    }
    Ok(())
}

fn bind(receipt: &BackupReceipt) -> Result<BackupBinding, CatalogError> {
    let checkpoint = receipt.checkpoint();
    let contents = receipt.contents();
    let bytes = receipt
        .files()
        .iter()
        .try_fold(0_u64, |total, file| total.checked_add(file.size()))
        .ok_or(CatalogError::Limit)?;
    Ok(BackupBinding {
        fingerprint: hex(&receipt.fingerprint()),
        database_id: sha256_hex(checkpoint.database_id()),
        sequence: checkpoint.rocksdb_sequence(),
        quads: contents.quads(),
        named_graphs: contents.named_graphs(),
        namespaces: contents.namespaces(),
        files: u64::try_from(receipt.files().len()).map_err(|_| CatalogError::Limit)?,
        bytes,
    })
}

fn map_restore(error: RestoreError) -> CatalogError {
    match error {
        RestoreError::Backup(BackupError::Storage(inner))
        | RestoreError::Backup(BackupError::Governance(GovernanceError::Storage(inner)))
        | RestoreError::Backup(BackupError::Governance(GovernanceError::Cursor(
            OutboxReadError::Storage(inner),
        ))) => CatalogError::from(inner),
        RestoreError::Backup(inner) => CatalogError::Backup(BackupFailure::from(&inner)),
        RestoreError::Storage(inner) => CatalogError::from(inner),
        RestoreError::Io(_) => CatalogError::Io,
        RestoreError::Limit => CatalogError::Limit,
        RestoreError::BackupMismatch | RestoreError::StateMismatch => {
            CatalogError::Backup(BackupFailure::FileMismatch)
        }
        RestoreError::CompletionIndeterminate(_) => {
            CatalogError::Backup(BackupFailure::CompletionIndeterminate)
        }
        _ => CatalogError::Storage,
    }
}

/// Current-primary verification refusals. A contradicting checkpoint, outbox, content
/// or inventory is definite, as is outbox corruption, a symlinked or non-directory
/// store path and a contributor-observing receipt. Timeouts, cancellation, I/O and
/// non-corruption storage errors stay transient.
fn map_current(error: RestoreError) -> CatalogError {
    match error {
        RestoreError::MissingReconciler => CatalogError::UnsupportedProfile,
        RestoreError::Backup(BackupError::InvalidPath) => CatalogError::UnsafePath,
        RestoreError::Outbox(OutboxReadError::Storage(inner)) => CatalogError::from(inner),
        error => map_restore(error),
    }
}

/// Definite candidate evidence. Everything else (I/O, limits, cancellation, timeouts,
/// a missing package, non-corruption storage errors, injected hooks) is transient.
fn is_definite(error: CatalogError) -> bool {
    matches!(
        error,
        CatalogError::CorruptStore
            | CatalogError::UnsafePath
            | CatalogError::UnsupportedProfile
            | CatalogError::Backup(BackupFailure::FileMismatch | BackupFailure::InvalidManifest)
    )
}

/// The completion receipt of `root` for `fingerprint`, if complete. A missing path or a
/// non-directory (including a symlink, never followed) or an absent completion marker
/// is `Ok(None)`. A receipt for another backup, an invalid receipt or an unsafe path
/// are definite errors; I/O errors are transient. The receipt is historical: it never
/// proves the current database (see `RestoreReceipt::verify_current_primary`).
fn completed_receipt(
    root: &Path,
    fingerprint: &str,
) -> Result<Option<RestoreReceipt>, CatalogError> {
    match std::fs::symlink_metadata(root) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(CatalogError::Io),
    }
    if !catalog_fs::exists(&root.join(RestoreReceipt::manifest_name()))? {
        return Ok(None);
    }
    match RestoreReceipt::read(root) {
        Ok(receipt) if hex(&receipt.backup().fingerprint()) == fingerprint => Ok(Some(receipt)),
        Ok(_) => Err(CatalogError::Backup(BackupFailure::FileMismatch)),
        Err(RestoreError::Io(error) | RestoreError::Backup(BackupError::Io(error)))
            if error.kind() == std::io::ErrorKind::NotFound =>
        {
            // A completion marker exists, so missing receipt components are damaged evidence.
            Err(CatalogError::UnsafePath)
        }
        Err(RestoreError::Io(_) | RestoreError::Backup(BackupError::Io(_))) => {
            Err(CatalogError::Io)
        }
        Err(RestoreError::Backup(BackupError::InvalidPath)) => Err(CatalogError::UnsafePath),
        Err(_) => Err(CatalogError::Backup(BackupFailure::InvalidManifest)),
    }
}

/// Whether `root` holds a completion receipt for `fingerprint` (see `completed_receipt`).
fn restore_complete(root: &Path, fingerprint: &str) -> Result<bool, CatalogError> {
    completed_receipt(root, fingerprint).map(|receipt| receipt.is_some())
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "opt-in restore lifecycle kept beside its journal helpers"
)]
impl RepositoryManager {
    /// Restores a `Tombstoned` repository from its own verified recovery package as a
    /// distinct entry: fresh external ID, fresh manager UUID, preserved store identity.
    ///
    /// Every refusal before the intent write (stale catalog or source generation,
    /// unknown or non-tombstoned source, fingerprint mismatch, occupied ID, time
    /// outside the retention window, package verification, capacity, catalog size)
    /// writes nothing. After the intent the entry is `Reserved` with its first attempt
    /// root; an incomplete attempt is retained and the entry stays `Reserved` for
    /// `retry_restore`. Only definite evidence persists `Failed` (see the module docs).
    pub fn restore_tombstoned(
        &mut self,
        request: RestoreRequest,
    ) -> Result<RepositoryRecord, CatalogError> {
        self.usable()?;
        let catalog = self.catalog.borrow().clone();
        if catalog.generation != request.catalog_generation
            || catalog
                .entries
                .iter()
                .any(|entry| entry.id == request.new_id.as_str())
        {
            return Err(CatalogError::Conflict);
        }
        // Intent, validated and closed each consume one catalog generation.
        catalog
            .generation
            .checked_add(3)
            .ok_or(CatalogError::Limit)?;
        if catalog.entries.len() >= catalog.limits.repositories {
            return Err(CatalogError::Limit);
        }
        let source = catalog
            .entries
            .iter()
            .find(|entry| entry.id == request.source.as_str())
            .ok_or(CatalogError::NotFound)?;
        if source.phase != Phase::Tombstoned {
            return Err(CatalogError::NotReady);
        }
        if source.changed_at != request.source_generation {
            return Err(CatalogError::Conflict);
        }
        let tombstone = source
            .tombstone
            .as_ref()
            .ok_or(CatalogError::InvalidCatalog)?;
        let binding = tombstone
            .backup
            .as_ref()
            .ok_or(CatalogError::InvalidCatalog)?;
        if binding.fingerprint != hex(&request.backup_fingerprint) {
            return Err(CatalogError::Conflict);
        }
        self.check_source(source, request.now)?;
        self.reserve_restore(catalog.limits, binding.bytes)?;
        let uuid = super::new_uuid();
        if catalog.entries.iter().any(|entry| entry.uuid == uuid) {
            return Err(CatalogError::Conflict);
        }
        let restore = RestoreRecord {
            source_id: request.source.as_str().to_owned(),
            source_uuid: source.uuid.clone(),
            source_generation: source.changed_at,
            source_attempt: tombstone.attempt,
            // The intent write is the first attempt; `persist` assigns this generation.
            attempt: catalog
                .generation
                .checked_add(1)
                .ok_or(CatalogError::Limit)?,
            intent_time: request.now.0,
            backup_files: tombstone.backup_files,
            backup_bytes: tombstone.backup_bytes,
            backup_timeout_ms: tombstone.backup_timeout_ms,
            backup: binding.clone(),
        };
        Self::restore_trial(&catalog, &request.new_id, &uuid, &restore)?;
        (self.hook)(FaultPoint::BeforeRestoreIntent)?;
        let mut next = self.catalog.borrow().clone();
        let index = next.entries.len();
        next.entries.push(Entry {
            id: request.new_id.as_str().to_owned(),
            uuid,
            phase: Phase::Reserved,
            changed_at: next.generation,
            evidence: None,
            tombstone: None,
            restore: Some(restore),
        });
        self.persist(next, index)?;
        self.point(FaultPoint::AfterRestoreIntent)?;
        self.advance_restore(index, true)?;
        self.list()?
            .into_iter()
            .find(|record| record.id == request.new_id)
            .ok_or(CatalogError::NotFound)
    }

    /// Continues a `Reserved` restore. `expected_generation` is the new entry's own
    /// generation. The source must still be the exact bound `Tombstoned` entry (a changed
    /// binding persists `Failed`) inside its retention window, `now` must not precede the
    /// persisted intent time, and the package is verified again (definite package
    /// evidence persists `Failed`; transient refusals write nothing).
    ///
    /// If the current attempt already staged a store, published a path or completed its
    /// root, the move and verification resume without a new restore. Otherwise the
    /// current root is absent, incomplete or foreign: a new attempt generation is
    /// persisted (after reserving scan slots and disk, refusing with `Limit` and no
    /// write) and restored into a fresh root. Earlier attempt roots are never read,
    /// renamed or deleted; each keeps one scan slot until operator removal. A
    /// `Validated` entry is settled only by `reconcile`.
    pub fn retry_restore(
        &mut self,
        id: &RepositoryId,
        expected_generation: u64,
        now: LogicalTime,
    ) -> Result<RepositoryRecord, CatalogError> {
        self.usable()?;
        let catalog = self.catalog.borrow().clone();
        let index = catalog
            .entries
            .iter()
            .position(|entry| entry.id == id.as_str())
            .ok_or(CatalogError::NotFound)?;
        let entry = &catalog.entries[index];
        if entry.changed_at != expected_generation {
            return Err(CatalogError::Conflict);
        }
        let (Phase::Reserved, Some(record)) = (entry.phase, entry.restore.as_ref()) else {
            return Err(CatalogError::NotReady);
        };
        if now.0 < record.intent_time {
            return Err(CatalogError::TimeRegression);
        }
        let source = self
            .bound_source(record)
            .map_err(|error| self.definite(index, error))?;
        self.check_source(&source, now)
            .map_err(|error| self.classify(index, error))?;
        // A new attempt, validated and closed each consume one catalog generation.
        catalog
            .generation
            .checked_add(3)
            .ok_or(CatalogError::Limit)?;
        let current = self.restore_root(&entry.uuid, record.attempt);
        let resumable = catalog_fs::exists(&self.root.path.join("staging").join(&entry.uuid))?
            || catalog_fs::exists(&self.root.path.join("repos").join(&entry.uuid))?
            || restore_complete(&current, &record.backup.fingerprint)
                .map_err(|error| self.classify(index, error))?;
        if !resumable {
            self.reserve_restore(catalog.limits, record.backup.bytes)?;
            let mut next = self.catalog.borrow().clone();
            let attempt = next.generation.checked_add(1).ok_or(CatalogError::Limit)?;
            next.entries[index]
                .restore
                .as_mut()
                .ok_or(CatalogError::InvalidCatalog)?
                .attempt = attempt;
            self.persist(next, index)?;
        }
        self.advance_restore(index, true)?;
        self.list()?
            .into_iter()
            .find(|record| record.id == *id)
            .ok_or(CatalogError::NotFound)
    }

    /// Read-only restore provenance. No UUID or physical path is exposed.
    pub fn restore_info(&self, id: &RepositoryId) -> Result<RestoreInfo, CatalogError> {
        self.usable()?;
        let catalog = self.catalog.borrow();
        let entry = catalog
            .entries
            .iter()
            .find(|entry| entry.id == id.as_str())
            .ok_or(CatalogError::NotFound)?;
        let record = entry.restore.as_ref().ok_or(CatalogError::NotReady)?;
        Ok(RestoreInfo {
            source: RepositoryId::parse(&record.source_id)
                .map_err(|_| CatalogError::InvalidCatalog)?,
            source_generation: record.source_generation,
            backup_fingerprint: parse_hex32(&record.backup.fingerprint)
                .ok_or(CatalogError::InvalidCatalog)?,
            intent_time: record.intent_time,
        })
    }

    /// The restore root this manager owns for `entry`: only its current attempt root,
    /// and only while that root holds a completion receipt for the exact recorded
    /// backup. Earlier attempts, incomplete current roots and foreign files or symlinks
    /// at any restore path yield `None` and are reported by the inventory, including
    /// for `Failed` entries. Errors are never turned into inventory errors. Cost: one
    /// bounded receipt read per restore-bearing entry.
    pub(super) fn known_restore_root(&self, entry: &Entry) -> Option<PathBuf> {
        let record = entry.restore.as_ref()?;
        let root = self.restore_root(&entry.uuid, record.attempt);
        let receipt = RestoreReceipt::read(&root).ok()?;
        (hex(&receipt.backup().fingerprint()) == record.backup.fingerprint).then_some(root)
    }

    /// Peak new scan entries: the attempt root, the staged store, the catalog temp.
    /// Free space must cover two catalogs and twice the package bytes. Read-only.
    fn reserve_restore(&self, limits: ManagerLimits, bytes: u64) -> Result<(), CatalogError> {
        self.root.reserve_scan(limits, 3)?;
        let reserve = u64::try_from(limits.catalog_bytes)
            .ok()
            .and_then(|size| size.checked_mul(2))
            .and_then(|size| size.checked_add(bytes.checked_mul(2)?))
            .ok_or(CatalogError::Limit)?;
        if free_bytes(&self.root.path)? < reserve {
            return Err(CatalogError::Limit);
        }
        Ok(())
    }

    /// Worst-case catalog size, so `catalog_bytes` cannot overflow after intent.
    fn restore_trial(
        catalog: &Catalog,
        id: &RepositoryId,
        uuid: &str,
        restore: &RestoreRecord,
    ) -> Result<(), CatalogError> {
        let mut trial = catalog.clone();
        trial.generation = u64::MAX;
        let mut record = restore.clone();
        record.intent_time = u64::MAX;
        // A Closed entry requires an attempt strictly before its own generation.
        record.attempt = u64::MAX - 1;
        trial.entries.push(Entry {
            id: id.as_str().to_owned(),
            uuid: uuid.to_owned(),
            phase: Phase::Closed,
            changed_at: u64::MAX,
            evidence: Some(Materialized {
                device: u64::MAX,
                inode: u64::MAX,
                format: "f".repeat(64),
            }),
            tombstone: None,
            restore: Some(record),
        });
        trial.encode().map(drop)
    }

    /// The source entry exactly as bound by `record`: same UUID and ID, `Tombstoned` at
    /// the recorded generation, the recorded tombstone attempt (strictly before that
    /// generation), backup binding and bounds. Any difference is `Conflict`. Read-only.
    fn bound_source(&self, record: &RestoreRecord) -> Result<Entry, CatalogError> {
        if record.source_attempt == 0 || record.source_attempt >= record.source_generation {
            return Err(CatalogError::Conflict);
        }
        let catalog = self.catalog.borrow();
        let source = catalog
            .entries
            .iter()
            .find(|entry| entry.uuid == record.source_uuid)
            .ok_or(CatalogError::Conflict)?;
        let tombstone = source.tombstone.as_ref().ok_or(CatalogError::Conflict)?;
        if source.id != record.source_id
            || source.phase != Phase::Tombstoned
            || source.changed_at != record.source_generation
            || tombstone.attempt != record.source_attempt
            || tombstone.backup.as_ref() != Some(&record.backup)
            || tombstone.backup_files != record.backup_files
            || tombstone.backup_bytes != record.backup_bytes
            || tombstone.backup_timeout_ms != record.backup_timeout_ms
        {
            return Err(CatalogError::Conflict);
        }
        Ok(source.clone())
    }

    /// Source must be `Tombstoned`, inside `[intent_time, deadline)` and its recorded
    /// package must verify. Read-only.
    fn check_source(&self, source: &Entry, now: LogicalTime) -> Result<(), CatalogError> {
        let (Phase::Tombstoned, Some(record)) = (source.phase, source.tombstone.as_ref()) else {
            return Err(CatalogError::NotReady);
        };
        if now.0 < record.intent_time {
            return Err(CatalogError::TimeRegression);
        }
        if now.0 >= record.deadline {
            return Err(CatalogError::RetentionExpired);
        }
        self.verify_package(source).map(drop)
    }

    /// Guards `backups/` and the package directory (no symlink, owner, same device),
    /// walks the tree within the recorded bounds, verifies its manifest and requires
    /// the exact recorded binding and supported profile. Opens no store.
    ///
    /// A missing `backups/`, package or completion marker is transient. Once the
    /// completion marker is present (observed without following symlinks), a missing
    /// mandatory `store/` or `contributors/` directory is definite package corruption
    /// (`FileMismatch`); any other error from that existence check (permissions,
    /// arbitrary I/O) stays transient.
    fn verify_package(&self, source: &Entry) -> Result<(PathBuf, BackupReceipt), CatalogError> {
        let record = source
            .tombstone
            .as_ref()
            .ok_or(CatalogError::InvalidCatalog)?;
        let binding = record.backup.as_ref().ok_or(CatalogError::InvalidCatalog)?;
        let owner = std::fs::symlink_metadata(&self.root.path)?.uid();
        let backups = self.root.path.join("backups");
        if !catalog_fs::exists(&backups)? {
            return Err(CatalogError::Backup(BackupFailure::InvalidPath));
        }
        self.root.directory(&backups)?;
        let package = backups.join(package_name(&source.uuid, record.attempt));
        if !catalog_fs::exists(&package)? {
            return Err(CatalogError::Backup(BackupFailure::InvalidPath));
        }
        let meta = std::fs::symlink_metadata(&package)?;
        if !meta.is_dir() || meta.uid() != owner {
            return Err(CatalogError::UnsafePath);
        }
        if catalog_fs::exists(&package.join(BackupReceipt::manifest_name()))? {
            for name in [BackupReceipt::store_directory(), "contributors"] {
                if !catalog_fs::exists(&package.join(name))? {
                    // A completed package always holds both directories.
                    return Err(CatalogError::Backup(BackupFailure::FileMismatch));
                }
            }
        }
        let files = usize::try_from(record.backup_files).map_err(|_| CatalogError::Limit)?;
        self.walk_restore_package(&package, files, record.backup_bytes)?;
        let receipt = BackupReceipt::verify(&package, &control(record.backup_timeout_ms)).map_err(
            |error| match error {
                // This package exists and passed path guards; malformed layout is definite.
                BackupError::InvalidPath => CatalogError::UnsafePath,
                error => error.into(),
            },
        )?;
        if bind(&receipt)? != *binding {
            return Err(CatalogError::Backup(BackupFailure::FileMismatch));
        }
        check_profile(&receipt)?;
        Ok((package, receipt))
    }

    fn walk_restore_package(
        &self,
        package: &Path,
        files: usize,
        bytes: u64,
    ) -> Result<(), CatalogError> {
        let device = self.root.directory(&self.root.path)?.0;
        let manifest = BackupReceipt::manifest_name();
        let mut count = 0_usize;
        let mut visited = 0_usize;
        let mut total = 0_u64;
        let mut pending = vec![(package.to_path_buf(), 0_u8)];
        while let Some((dir, depth)) = pending.pop() {
            let meta = std::fs::symlink_metadata(&dir)?;
            if !meta.is_dir() || meta.dev() != device {
                return Err(CatalogError::UnsafePath);
            }
            for item in std::fs::read_dir(&dir)? {
                let item = item?;
                visited += 1;
                if visited > files.saturating_mul(2).saturating_add(16) {
                    return Err(CatalogError::Limit);
                }
                let path = item.path();
                let meta = std::fs::symlink_metadata(&path)?;
                if meta.dev() != device {
                    return Err(CatalogError::UnsafePath);
                }
                if meta.is_dir() {
                    if depth >= MAX_DEPTH {
                        return Err(CatalogError::UnsafePath);
                    }
                    pending.push((path, depth + 1));
                } else if meta.is_file() {
                    if depth == 0 && item.file_name() == manifest {
                        continue;
                    }
                    count += 1;
                    total = total.checked_add(meta.len()).ok_or(CatalogError::Limit)?;
                    if count > files || total > bytes {
                        return Err(CatalogError::Limit);
                    }
                } else {
                    return Err(CatalogError::UnsafePath);
                }
            }
        }
        Ok(())
    }

    /// Complete proof of one restored candidate before any readiness write, shared by
    /// the live path and `Validated` reconciliation. With `expected`, directory identity
    /// must equal the recorded evidence before any native open. Then `verified` (its only
    /// hook), the completion receipt of the current attempt, the exact package whose
    /// receipt must equal the one bound by that completion record, bounded
    /// record-by-record content, the CURRENT primary checkpoint, outbox and inventory
    /// against the receipt (the historical `RestoreReceipt::read` alone proves nothing
    /// about the current database) and a second package verification. Returns the
    /// materialization evidence, which must equal `expected` when given.
    fn prove_candidate(
        &self,
        source: &Entry,
        record: &RestoreRecord,
        restore_dir: &Path,
        store: &Path,
        expected: Option<&Materialized>,
    ) -> Result<Materialized, CatalogError> {
        if let Some(expected) = expected {
            let (device, inode) = self.root.directory(store)?;
            if device != expected.device || inode != expected.inode {
                return Err(CatalogError::UnsafePath);
            }
        }
        let evidence = self.verified(store)?;
        if expected.is_some_and(|expected| *expected != evidence) {
            return Err(CatalogError::UnsafePath);
        }
        let receipt = completed_receipt(restore_dir, &record.backup.fingerprint)?
            .ok_or(CatalogError::UnsafePath)?;
        let (package, first) = self.verify_package(source)?;
        if *receipt.backup() != first {
            return Err(CatalogError::Backup(BackupFailure::FileMismatch));
        }
        content_matches(store, &package, &record.backup, record.backup_timeout_ms)?;
        receipt
            .verify_current_primary(store, &control(record.backup_timeout_ms))
            .map_err(map_current)?;
        let (_, second) = self.verify_package(source)?;
        if first != second {
            return Err(CatalogError::Backup(BackupFailure::FileMismatch));
        }
        Ok(evidence)
    }

    /// Persists `Failed` for definite evidence, keeping every path untouched, and
    /// returns `error`. A failed write returns its own (poisoning) error instead.
    fn definite(&self, index: usize, error: CatalogError) -> CatalogError {
        let mut next = self.catalog.borrow().clone();
        next.entries[index].phase = Phase::Failed;
        match self.persist(next, index) {
            Ok(()) => error,
            Err(persist) => persist,
        }
    }

    /// Definite candidate failures persist `Failed`; transient or resource refusals
    /// are returned without any write.
    fn classify(&self, index: usize, error: CatalogError) -> CatalogError {
        if is_definite(error) {
            self.definite(index, error)
        } else {
            error
        }
    }

    fn sync_restore(&self, restore_dir: &Path) -> Result<(), CatalogError> {
        for dir in [
            self.root.path.join("staging"),
            restore_dir.to_path_buf(),
            self.root.path.clone(),
        ] {
            std::fs::File::open(dir)?.sync_all()?;
        }
        Ok(())
    }

    /// `restore_backup` creates `store/` with default permissions; the catalog guards
    /// require an owner-only directory and no group/other write. Only regular,
    /// single-link, owned, same-device files are touched, bounded by `store_files`.
    fn normalize(&self, staged: &Path) -> Result<(), CatalogError> {
        let root = std::fs::symlink_metadata(&self.root.path)?;
        let (owner, device) = (root.uid(), root.dev());
        let max = self.catalog.borrow().limits.store_files;
        let meta = std::fs::symlink_metadata(staged)?;
        if !meta.is_dir() || meta.uid() != owner || meta.dev() != device {
            return Err(CatalogError::UnsafePath);
        }
        for (count, item) in std::fs::read_dir(staged)?.enumerate() {
            if count >= max {
                return Err(CatalogError::Limit);
            }
            let path = item?.path();
            let meta = std::fs::symlink_metadata(&path)?;
            if !meta.is_file() || meta.uid() != owner || meta.dev() != device || meta.nlink() != 1 {
                return Err(CatalogError::UnsafePath);
            }
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::set_permissions(staged, std::fs::Permissions::from_mode(0o700))?;
        std::fs::File::open(staged)?.sync_all()?;
        Ok(())
    }

    /// The single `Store::restore_backup` call of one attempt. A partial attempt root
    /// is retained and, unless its failure is definite, the entry stays `Reserved`.
    fn run_restore(
        &self,
        index: usize,
        record: &RestoreRecord,
        restore_dir: &Path,
    ) -> Result<(), CatalogError> {
        (self.hook)(FaultPoint::BeforeRestore)?;
        let files = usize::try_from(record.backup_files).map_err(|_| CatalogError::Limit)?;
        let mut options = RestoreOptions::default();
        options.control = control(record.backup_timeout_ms);
        options.max_files = NonZeroUsize::new(files).ok_or(CatalogError::Limit)?;
        options.max_bytes = NonZeroU64::new(record.backup_bytes).ok_or(CatalogError::Limit)?;
        options.expected_backup_fingerprint =
            Some(parse_hex32(&record.backup.fingerprint).ok_or(CatalogError::InvalidCatalog)?);
        let package = self
            .root
            .path
            .join("backups")
            .join(package_name(&record.source_uuid, record.source_attempt));
        if let Err(error) = Store::restore_backup(&package, restore_dir, &options) {
            if matches!(error, RestoreError::CompletionIndeterminate(_)) {
                // A published completion marker may or may not be durable.
                self.poisoned.set(true);
                return Err(map_restore(error));
            }
            if matches!(error, RestoreError::Backup(BackupError::InvalidPath))
                && catalog_fs::exists(restore_dir).unwrap_or(true)
            {
                // An occupant (or a race) at the attempt path: retained, never adopted,
                // no write. The next retry allocates a new attempt path.
                return Err(CatalogError::UnsafePath);
            }
            return Err(self.classify(index, map_restore(error)));
        }
        (self.hook)(FaultPoint::AfterRestore)
    }

    /// Idempotent advance of a `Reserved` restore entry from what is on disk. `live`
    /// permits the single `Store::restore_backup` call of the current attempt when
    /// neither its root nor the staged store exists.
    ///
    /// With R the current attempt root, S `staging/<uuid>` and P `repos/<uuid>`: a
    /// changed source binding or an existing P is definite. Without a completed R:
    /// nothing on disk stays `Reserved` (reconcile) or restores (live); S without R, or
    /// an incomplete R beside S, is definite; an incomplete or foreign R alone is
    /// retained with no write (reconcile `Ok`, live `UnsafePath`). A completed R moves
    /// its `store/` to S unless exactly S already holds it; both or neither is definite.
    /// S is then proved by `prove_candidate`, including its current primary, and
    /// `Validated` is persisted (a failed write poisons in either mode).
    ///
    /// Publication then differs by mode. Live publication keeps its hooks and poisons
    /// on a hook or publish failure. Restart (`live == false`) never takes that path:
    /// the durable `Validated` entry is settled by `reconcile_restore_validated`, which
    /// proves the candidate again and leaves a refused rename or parent sync local,
    /// non-ready and unpoisoned.
    ///
    /// Crash matrix: before the restore creates R, or mid-restore (no marker, pending
    /// only), the entry stays `Reserved` and a retry uses a new path; after the marker
    /// and before the move, reconcile moves; after the move and before its syncs,
    /// reconcile re-syncs and continues. After `Validated`, restart settles the entry
    /// with `reconcile_restore_validated`, which proves the candidate again. No crash
    /// point yields `Failed`.
    fn advance_restore(&self, index: usize, live: bool) -> Result<(), CatalogError> {
        let entry = self.catalog.borrow().entries[index].clone();
        let record = entry.restore.clone().ok_or(CatalogError::InvalidCatalog)?;
        let source = self
            .bound_source(&record)
            .map_err(|error| self.definite(index, error))?;
        let restore_dir = self.restore_root(&entry.uuid, record.attempt);
        let staged = self.root.path.join("staging").join(&entry.uuid);
        let published = self.root.path.join("repos").join(&entry.uuid);
        if catalog_fs::exists(&published)? {
            return Err(self.definite(index, CatalogError::UnsafePath));
        }
        let complete = restore_complete(&restore_dir, &record.backup.fingerprint)
            .map_err(|error| self.classify(index, error))?;
        let staged_exists = catalog_fs::exists(&staged)?;
        if !complete {
            match (catalog_fs::exists(&restore_dir)?, staged_exists) {
                (false, false) => {
                    if !live {
                        return Ok(());
                    }
                    self.run_restore(index, &record, &restore_dir)?;
                    if !restore_complete(&restore_dir, &record.backup.fingerprint)
                        .map_err(|error| self.classify(index, error))?
                    {
                        // Unexplained after a reported success: retained, no write.
                        return Err(CatalogError::UnsafePath);
                    }
                }
                // Incomplete attempt or foreign occupant: retained debris, no write.
                (true, false) => {
                    return if live {
                        Err(CatalogError::UnsafePath)
                    } else {
                        Ok(())
                    };
                }
                _ => return Err(self.definite(index, CatalogError::UnsafePath)),
            }
        }
        let store_in_root =
            catalog_fs::exists(&restore_dir.join(RestoreReceipt::store_directory()))?;
        match (store_in_root, staged_exists) {
            (true, false) => {
                (self.hook)(FaultPoint::BeforeRestoreMove)?;
                std::fs::rename(restore_dir.join(RestoreReceipt::store_directory()), &staged)?;
                (self.hook)(FaultPoint::AfterRestoreMove)?;
            }
            (false, true) => {}
            _ => return Err(self.definite(index, CatalogError::UnsafePath)),
        }
        // Repeated even when the move already happened: a crash may precede its syncs.
        self.sync_restore(&restore_dir)?;
        (self.hook)(FaultPoint::AfterRestoreMoveSynced)?;
        self.normalize(&staged)
            .map_err(|error| self.classify(index, error))?;
        let evidence = self
            .prove_candidate(&source, &record, &restore_dir, &staged, None)
            .map_err(|error| self.classify(index, error))?;
        let mut next = self.catalog.borrow().clone();
        next.entries[index].evidence = Some(evidence);
        next.entries[index].phase = Phase::Validated;
        self.persist(next, index)?;
        if !live {
            // Restart publication uses the restore-specific settle seam: a refused
            // rename or parent sync stays local, Validated and unpoisoned.
            return self.reconcile_restore_validated(index);
        }
        self.point(FaultPoint::AfterValidation)?;
        self.point(FaultPoint::BeforePublish)?;
        if let Err(error) = self.root.publish(&entry.uuid) {
            self.poisoned.set(true);
            return Err(error);
        }
        self.point(FaultPoint::AfterPublish)?;
        let mut next = self.catalog.borrow().clone();
        next.entries[index].phase = Phase::Closed;
        self.persist(next, index)?;
        self.point(FaultPoint::AfterClosed)
    }

    /// Restart completion of a `Reserved` restore. It never runs a restore: with
    /// nothing on disk, or an incomplete or foreign current attempt root, the entry
    /// stays `Reserved` and retryable with no write. A completed attempt resumes its
    /// move and verification; once `Validated` is durable, publication is settled by
    /// `reconcile_restore_validated`, never by the live publication path. Definite
    /// evidence persists `Failed`. Every other failure before a catalog write is
    /// repository-local and leaves the root openable. Only an attempted catalog write
    /// that fails propagates, poisoned.
    pub(super) fn reconcile_restoring(&self, index: usize) -> Result<(), CatalogError> {
        match self.advance_restore(index, false) {
            Ok(()) => Ok(()),
            Err(_) if !self.poisoned.get() => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// Restart completion of a `Validated` restore (see `settle_restore`). Definite
    /// evidence persists `Failed`. Transient or resource refusals, injected hooks and a
    /// failed rename or sync write nothing and do not poison: the entry stays
    /// `Validated` and non-ready, and the next `reconcile` re-derives it from disk. Only
    /// an attempted catalog write that fails propagates, poisoned.
    pub(super) fn reconcile_restore_validated(&self, index: usize) -> Result<(), CatalogError> {
        match self.settle_restore(index) {
            Ok(()) => Ok(()),
            Err(_) if !self.poisoned.get() => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// A `Validated` restore may be staged (crash before or during publish) or already
    /// published (crash after a rename that may or may not be durable). Exactly one of
    /// S and P must exist; both or neither is definite. The bound source and the
    /// candidate (`prove_candidate` against the recorded evidence) are proved again,
    /// because the store may have drifted or been substituted while the manager was
    /// down. A staged candidate is renamed; either way both publication parents are
    /// synced again before `Closed`, so readiness never outruns an unsynced rename.
    fn settle_restore(&self, index: usize) -> Result<(), CatalogError> {
        let entry = self.catalog.borrow().entries[index].clone();
        let record = entry.restore.clone().ok_or(CatalogError::InvalidCatalog)?;
        let expected = entry.evidence.clone().ok_or(CatalogError::InvalidCatalog)?;
        let source = self
            .bound_source(&record)
            .map_err(|error| self.definite(index, error))?;
        let restore_dir = self.restore_root(&entry.uuid, record.attempt);
        let staged = self.root.path.join("staging").join(&entry.uuid);
        let published = self.root.path.join("repos").join(&entry.uuid);
        let (store, staging) = match (
            catalog_fs::exists(&staged)?,
            catalog_fs::exists(&published)?,
        ) {
            (true, false) => (staged, true),
            (false, true) => (published, false),
            _ => return Err(self.definite(index, CatalogError::UnsafePath)),
        };
        (self.hook)(FaultPoint::BeforeRestoreRecheck)?;
        self.prove_candidate(&source, &record, &restore_dir, &store, Some(&expected))
            .map_err(|error| self.classify(index, error))?;
        if staging {
            self.root.rename_published(&entry.uuid)?;
            (self.hook)(FaultPoint::AfterRestorePublishRename)?;
        }
        // Repeated even when already published: a crash may precede the parent syncs.
        self.root.sync_publication()?;
        (self.hook)(FaultPoint::AfterRestorePublishSynced)?;
        let mut next = self.catalog.borrow().clone();
        next.entries[index].phase = Phase::Closed;
        self.persist(next, index)
    }
}

#[cfg(test)]
mod tests {
    use super::{is_definite, map_current, map_restore, restore_complete};
    use oxigraph::store::{BackupError, OutboxReadError, RestoreError, StorageError};
    use std::io;
    use std::os::unix::fs::symlink;

    #[test]
    fn restore_failures_are_transient_or_definite() {
        let io = || io::Error::other("injected");
        let cases = [
            ("io", RestoreError::Io(io()), false),
            ("limit", RestoreError::Limit, false),
            (
                "backup io",
                RestoreError::Backup(BackupError::Io(io())),
                false,
            ),
            (
                "backup limit",
                RestoreError::Backup(BackupError::Limit),
                false,
            ),
            (
                "backup cancelled",
                RestoreError::Backup(BackupError::Cancelled),
                false,
            ),
            (
                "backup timed out",
                RestoreError::Backup(BackupError::TimedOut),
                false,
            ),
            (
                "backup invalid path",
                RestoreError::Backup(BackupError::InvalidPath),
                false,
            ),
            (
                "storage io",
                RestoreError::Storage(StorageError::Io(io())),
                false,
            ),
            (
                "file mismatch",
                RestoreError::Backup(BackupError::FileMismatch),
                true,
            ),
            (
                "invalid manifest",
                RestoreError::Backup(BackupError::InvalidManifest),
                true,
            ),
            ("backup mismatch", RestoreError::BackupMismatch, true),
            ("state mismatch", RestoreError::StateMismatch, true),
        ];
        for (label, error, definite) in cases {
            assert_eq!(is_definite(map_restore(error)), definite, "{label}");
        }
    }

    #[test]
    fn current_primary_failures_are_transient_or_definite() {
        let io = || io::Error::other("injected");
        let cases = [
            ("state mismatch", RestoreError::StateMismatch, true),
            ("backup mismatch", RestoreError::BackupMismatch, true),
            ("contributor profile", RestoreError::MissingReconciler, true),
            (
                "unsafe store path",
                RestoreError::Backup(BackupError::InvalidPath),
                true,
            ),
            ("io", RestoreError::Io(io()), false),
            (
                "timed out",
                RestoreError::Backup(BackupError::TimedOut),
                false,
            ),
            (
                "cancelled",
                RestoreError::Backup(BackupError::Cancelled),
                false,
            ),
            (
                "outbox io",
                RestoreError::Outbox(OutboxReadError::Storage(StorageError::Io(io()))),
                false,
            ),
        ];
        for (label, error, definite) in cases {
            assert_eq!(is_definite(map_current(error)), definite, "{label}");
        }
    }

    #[test]
    fn nested_backup_storage_corruption_is_definite_but_io_is_transient() {
        use super::CatalogError;
        use oxigraph::store::{GovernanceError, Store};
        for wrapper in 0..3 {
            for corrupt in [false, true] {
                let inner = if corrupt {
                    let dir = tempfile::tempdir().unwrap();
                    let path = dir.path().join("store");
                    drop(Store::open(&path).unwrap());
                    std::fs::write(path.join("CURRENT"), b"invalid").unwrap();
                    let error = match Store::open(&path) {
                        Ok(_) => panic!("damaged CURRENT must reject store open"),
                        Err(error) => error,
                    };
                    assert!(matches!(error, StorageError::Corruption(_)));
                    error
                } else {
                    StorageError::Io(io::Error::other("injected"))
                };
                let backup = match wrapper {
                    0 => BackupError::Storage(inner),
                    1 => BackupError::Governance(GovernanceError::Storage(inner)),
                    _ => BackupError::Governance(GovernanceError::Cursor(
                        OutboxReadError::Storage(inner),
                    )),
                };
                let mapped = map_current(RestoreError::Backup(backup));
                assert_eq!(is_definite(mapped), corrupt, "wrapper {wrapper}");
                assert_eq!(
                    mapped,
                    if corrupt {
                        CatalogError::CorruptStore
                    } else {
                        CatalogError::Io
                    }
                );
            }
        }
    }

    #[test]
    fn incomplete_or_foreign_roots_are_not_complete_and_never_followed() {
        let dir = tempfile::tempdir().unwrap();
        let fingerprint = "0".repeat(64);
        let absent = dir.path().join("absent");
        assert!(!restore_complete(&absent, &fingerprint).unwrap(), "absent");
        let file = dir.path().join("file");
        std::fs::write(&file, b"occupied").unwrap();
        assert!(!restore_complete(&file, &fingerprint).unwrap(), "file");
        let target = dir.path().join("target");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("oxigraph-restore.complete"), b"x").unwrap();
        let link = dir.path().join("link");
        symlink(&target, &link).unwrap();
        assert!(!restore_complete(&link, &fingerprint).unwrap(), "symlink");
        let partial = dir.path().join("partial");
        std::fs::create_dir(&partial).unwrap();
        std::fs::write(partial.join("partial"), b"half").unwrap();
        assert!(
            !restore_complete(&partial, &fingerprint).unwrap(),
            "no marker"
        );
    }
}
