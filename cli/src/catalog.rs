//! Opt-in Linux catalog create/reconcile/open/quiesce/tombstone/restore. No server or purge API.
//!
//! Root is private to one trusted OS owner. This is not a defense against another
//! arbitrary same-uid filesystem writer. Directory device/inode and validated
//! format bind materialization; they are not a governed store UUID or backup.
//! Runtime readiness and handle fences are never persisted. Catalog generations and
//! process-local lifecycle-model generations are deliberately separate.
//!
//! Quiesce: `begin_quiesce` durably records `Quiescing` (generation-checked on the
//! entry's own generation), rejects new opens and fences live handles through manager
//! state before any `Store` access. `complete_quiesce` reaches `Closed` only when no
//! manager-owned handle exists, proved by the actual handle drop, and re-verifies
//! materialization. This embedded seam exposes no query, lease or raw `Store`, so it
//! makes no server query/lease cancellation claim. Receipts are minted only here.
//!
//! Tombstone (Linux): an explicit, opt-in, recovery-backed move into manager-owned
//! trash, journaled by the `TombstoneIntent`, `TombstoneBackedUp` and `Tombstoned`
//! phases. It needs the exact current `QuiesceReceipt`, no live handle, explicit finite
//! backup bounds and injected logical time. A real `Store::backup_with_receipt`
//! package is verified with `BackupReceipt::verify`, and its quads, named graphs and
//! namespaces are compared record by record with the guarded source; the move happens
//! only after its exact fingerprint is durably recorded. No purge or server
//! activation.
//!
//! Restore (Linux): `restore_tombstoned` re-creates a repository from its OWN
//! tombstone recovery package under a NEW manager-generated UUID and a caller-supplied
//! fresh `RepositoryId`. The caller gives generations, the exact backup fingerprint
//! and injected time, never a path or raw backup URI. The package is verified (tree
//! walk, `BackupReceipt::verify`, recorded binding), restored with
//! `Store::restore_backup` into `staging/<uuid>.restore`, moved and synced, its
//! copied store re-verified, compared record by record with the package and its
//! CURRENT checkpoint and outbox checked against the completion receipt, and only
//! then published `Closed`. Restart re-proves a `Validated` restore the same way,
//! staged or already published, and re-syncs both publication parents before
//! `Closed`. The entry carries provenance to the exact tombstone backup receipt. The
//! source entry, trash, package and retention are never changed and the package is
//! not consumed. Failed or incomplete candidates stay nonready and inventoried;
//! nothing is adopted or deleted.
//!
//! Identity semantics: ADR-0022 restore preserves the physical DB ID and governed
//! `StoreIdentity` of the package. A new manager UUID is therefore NOT a new store
//! identity. Restoring the same tombstone twice yields two catalog entries with
//! distinct UUIDs and an equal `StoreIdentity`; this is not a fork. No rekey or fork
//! primitive is claimed. No purge, HTTP/admin activation.
mod codec;
mod fs;
#[cfg(target_os = "linux")]
mod restore;
#[cfg(target_os = "linux")]
mod tombstone;

use crate::lease::LogicalTime;
use crate::repository::{
    OpenMode, Repository, RepositoryId, RepositoryLimits, RepositorySnapshot, ValidationOutcome,
};
pub use codec::Phase;
use codec::{Catalog, Entry, Materialized};
use oxigraph::model::Quad;
use oxigraph::store::{BackupError, StorageError, Store, StoreVersionStatus};
#[cfg(target_os = "linux")]
pub use restore::{RestoreInfo, RestoreRequest};
use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
pub use tombstone::{TombstoneInfo, TombstoneLimits, TombstoneReceipt};

/// Explicit operator ceilings; no production defaults inferred from this slice.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ManagerLimits {
    pub repositories: usize,
    pub catalog_bytes: usize,
    pub scan_entries: usize,
    pub open_handles: usize,
    /// Verification scan ceiling, not a RocksDB disk/file-growth reservation.
    /// Growth beyond this ceiling refuses subsequent admission without deleting data.
    pub store_files: usize,
    pub model_retention: u64,
    pub model_max_generation: u64,
}

impl ManagerLimits {
    fn validate(self) -> Result<(), CatalogError> {
        if [
            self.repositories,
            self.catalog_bytes,
            self.scan_entries,
            self.open_handles,
            self.store_files,
        ]
        .contains(&0)
            || self.catalog_bytes == usize::MAX
            || self.model_retention == 0
            || self.model_max_generation < 4
            || self
                .repositories
                .checked_add(5)
                .is_none_or(|minimum| self.scan_entries < minimum)
        {
            return Err(CatalogError::Limit);
        }
        Ok(())
    }
    fn model(self) -> Result<RepositoryLimits, CatalogError> {
        RepositoryLimits::new(self.model_retention, self.model_max_generation)
            .map_err(|_| CatalogError::Limit)
    }
}

/// Copy mirror of the typed `BackupError` kinds so backup failures stay typed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BackupFailure {
    Unsupported,
    UnsupportedPlatform,
    InvalidPath,
    Limit,
    Cancelled,
    TimedOut,
    InvalidManifest,
    FileMismatch,
    CompletionIndeterminate,
    Io,
    Storage,
    Governance,
    Contributor,
    Other,
}

impl BackupFailure {
    /// Refusals that leave the source untouched and the outcome certain.
    #[cfg_attr(not(target_os = "linux"), expect(dead_code))]
    fn definite(self) -> bool {
        matches!(
            self,
            Self::InvalidPath
                | Self::Limit
                | Self::Cancelled
                | Self::TimedOut
                | Self::Unsupported
                | Self::UnsupportedPlatform
        )
    }
}

impl From<&BackupError> for BackupFailure {
    fn from(error: &BackupError) -> Self {
        match error {
            BackupError::Unsupported => Self::Unsupported,
            BackupError::UnsupportedPlatform => Self::UnsupportedPlatform,
            BackupError::InvalidPath => Self::InvalidPath,
            BackupError::Limit => Self::Limit,
            BackupError::Cancelled => Self::Cancelled,
            BackupError::TimedOut => Self::TimedOut,
            BackupError::InvalidManifest => Self::InvalidManifest,
            BackupError::FileMismatch => Self::FileMismatch,
            BackupError::CompletionIndeterminate(_) => Self::CompletionIndeterminate,
            BackupError::Io(_) => Self::Io,
            BackupError::Storage(_) => Self::Storage,
            BackupError::Governance(_) => Self::Governance,
            BackupError::Contributor(_) => Self::Contributor,
            _ => Self::Other,
        }
    }
}

/// Errors redact physical paths, IDs and underlying storage payloads.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogError {
    Unsupported,
    UnsafePath,
    Locked,
    InvalidCatalog,
    MissingCatalog,
    Limit,
    Conflict,
    NotFound,
    NotReady,
    Storage,
    CorruptStore,
    Io,
    Poisoned,
    Injected,
    /// Handle operation refused: its repository is quiescing.
    Quiescing,
    /// Completion refused: a manager-owned handle still exists.
    Busy,
    /// The checked retention deadline would overflow logical time.
    Retention,
    /// Injected logical time precedes the persisted intent time of this entry.
    TimeRegression,
    /// The recovery package would omit or depend on unsupported contributor inputs.
    UnsupportedProfile,
    /// Typed recovery backup or package verification failure.
    Backup(BackupFailure),
    /// Restore refused: injected logical time is at or after the tombstone deadline.
    RetentionExpired,
}
impl fmt::Display for CatalogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "repository catalog: {self:?}")
    }
}
impl std::error::Error for CatalogError {}
impl From<std::io::Error> for CatalogError {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}

impl From<StorageError> for CatalogError {
    fn from(error: StorageError) -> Self {
        match error {
            StorageError::Corruption(_) => Self::CorruptStore,
            StorageError::Io(_) => Self::Io,
            _ => Self::Storage,
        }
    }
}

impl From<BackupError> for CatalogError {
    fn from(error: BackupError) -> Self {
        Self::Backup(BackupFailure::from(&error))
    }
}

/// Deterministic crash and fault seams. The live restore path fires exactly its
/// original sequence; the three `*Restore*Recheck`/`*RestorePublish*` points fire only
/// while restart reconciliation settles a `Validated` restore entry.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FaultPoint {
    BeforeCatalogWrite,
    BeforeCatalogSync,
    BeforeCatalogRename,
    BeforeCatalogDirectorySync,
    AfterCatalogSync,
    AfterReservation,
    AfterStaging,
    AfterStoreFlush,
    AfterValidation,
    BeforePublish,
    AfterPublish,
    AfterClosed,
    BeforeVerification,
    BeforeStoreOpen,
    BeforeTombstoneIntent,
    AfterTombstoneIntent,
    BeforeBackup,
    AfterBackup,
    AfterBackupRecorded,
    BeforeMove,
    AfterMove,
    AfterMoveSynced,
    AfterTombstoned,
    BeforeRestoreIntent,
    AfterRestoreIntent,
    BeforeRestore,
    AfterRestore,
    BeforeRestoreMove,
    AfterRestoreMove,
    AfterRestoreMoveSynced,
    /// Restart only: before a `Validated` restore candidate is proved again.
    BeforeRestoreRecheck,
    /// Restart only: after the staged candidate was renamed, before the parent syncs.
    AfterRestorePublishRename,
    /// Restart only: after both publication parents synced, before `Closed`.
    AfterRestorePublishSynced,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryRecord {
    pub id: RepositoryId,
    pub phase: Phase,
    pub changed_at: u64,
}

/// Proof that this manager durably applied one quiesce transition.
///
/// `generation` is the entry's own generation (the catalog generation of its last
/// change). `catalog_generation` is the catalog generation observed at issue and is
/// informational only: an idempotent repeat may observe a later one. Only the manager
/// mints receipts, and none is `Clone`. A receipt also binds the entry's internal
/// random UUID, which is never exposed, including by `Debug`. Completion requires the
/// exact receipt of the current `Quiescing` entry generation and UUID, so a stale,
/// repeated, cross-repository or cross-root receipt cannot act even when its external
/// ID and deterministic generation collide.
#[derive(Eq, PartialEq)]
#[must_use]
pub struct QuiesceReceipt {
    id: RepositoryId,
    uuid: String,
    phase: Phase,
    generation: u64,
    catalog_generation: u64,
}

impl fmt::Debug for QuiesceReceipt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("QuiesceReceipt")
            .field("id", &self.id)
            .field("phase", &self.phase)
            .field("generation", &self.generation)
            .field("catalog_generation", &self.catalog_generation)
            .finish_non_exhaustive()
    }
}

impl QuiesceReceipt {
    pub fn id(&self) -> &RepositoryId {
        &self.id
    }
    pub fn phase(&self) -> Phase {
        self.phase
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn catalog_generation(&self) -> u64 {
        self.catalog_generation
    }
}

pub struct RepositoryManager {
    root: fs::Root,
    catalog: RefCell<Catalog>,
    /// Counted slots by entry UUID; the flag is the runtime quiesce fence.
    active: RefCell<BTreeMap<String, bool>>,
    poisoned: Cell<bool>,
    hook: Box<dyn Fn(FaultPoint) -> Result<(), CatalogError>>,
}

fn new_uuid() -> String {
    let mut bytes: [u8; 16] = rand::random();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

#[cfg(not(target_os = "linux"))]
#[expect(clippy::multiple_inherent_impl, clippy::unused_self)]
impl RepositoryManager {
    fn reconcile_backed_up(&self, _index: usize) -> Result<(), CatalogError> {
        Err(CatalogError::Unsupported)
    }
    fn reconcile_restoring(&self, _index: usize) -> Result<(), CatalogError> {
        Err(CatalogError::Unsupported)
    }
    fn reconcile_restore_validated(&self, _index: usize) -> Result<(), CatalogError> {
        Err(CatalogError::Unsupported)
    }
    fn known_restore_root(&self, _entry: &Entry) -> Option<PathBuf> {
        None
    }
    fn tombstone_inventory(&self) -> Result<Vec<PathBuf>, CatalogError> {
        Ok(Vec::new())
    }
}

impl RepositoryManager {
    fn restore_root(&self, uuid: &str, attempt: u64) -> PathBuf {
        self.root
            .path
            .join("staging")
            .join(format!("{uuid}.restore-{attempt}"))
    }

    pub fn open(path: impl AsRef<Path>, limits: ManagerLimits) -> Result<Self, CatalogError> {
        Self::open_with_hook(path, limits, |_| Ok(()))
    }

    /// Fault injection is explicit in-process API, never an environment bypass.
    #[doc(hidden)]
    pub fn open_with_hook(
        path: impl AsRef<Path>,
        limits: ManagerLimits,
        hook: impl Fn(FaultPoint) -> Result<(), CatalogError> + 'static,
    ) -> Result<Self, CatalogError> {
        limits.validate()?;
        let root = fs::Root::open(path.as_ref())?;
        let scanned = root.scan(limits)?;
        let catalog = match root.read_catalog(limits.catalog_bytes)? {
            Some(bytes) => Catalog::decode(&bytes, limits)?,
            None => {
                root.allow_initial_catalog(&scanned)?;
                let catalog = Catalog {
                    version: 1,
                    generation: 1,
                    limits,
                    entries: Vec::new(),
                };
                root.reserve_scan(limits, 1)?;
                root.write_catalog(&catalog.encode()?, true, &hook)?;
                catalog
            }
        };
        let manager = Self {
            root,
            catalog: RefCell::new(catalog),
            active: RefCell::new(BTreeMap::new()),
            poisoned: Cell::new(false),
            hook: Box::new(hook),
        };
        manager.reconcile()?;
        Ok(manager)
    }

    fn usable(&self) -> Result<(), CatalogError> {
        if self.poisoned.get() {
            Err(CatalogError::Poisoned)
        } else {
            Ok(())
        }
    }

    fn point(&self, point: FaultPoint) -> Result<(), CatalogError> {
        let result = (self.hook)(point);
        if result.is_err() {
            self.poisoned.set(true);
        }
        result
    }

    fn persist(&self, mut catalog: Catalog, entry: usize) -> Result<(), CatalogError> {
        self.usable()?;
        self.root.reserve_scan(catalog.limits, 1)?;
        catalog.generation = self
            .catalog
            .borrow()
            .generation
            .checked_add(1)
            .ok_or(CatalogError::Limit)?;
        catalog.entries[entry].changed_at = catalog.generation;
        let bytes = catalog.encode()?;
        if let Err(error) = self.root.write_catalog(&bytes, false, &*self.hook) {
            // Rename might already be durable: force reopen instead of guessing.
            self.poisoned.set(true);
            return Err(error);
        }
        *self.catalog.borrow_mut() = catalog;
        Ok(())
    }

    fn verified(&self, path: &Path) -> Result<Materialized, CatalogError> {
        // Verification errors are repeatable refusals, not uncertain mutations.
        (self.hook)(FaultPoint::BeforeVerification)?;
        let (device, inode) = self
            .root
            .guard_store(path, self.catalog.borrow().limits.store_files)?;
        let format = Store::inspect(path).map_err(CatalogError::from)?;
        if format.version_status() != StoreVersionStatus::Current
            || !format.missing_column_families().is_empty()
            || !format.unexpected_column_families().is_empty()
        {
            return Err(CatalogError::Storage);
        }
        let store = Store::open_read_only(path).map_err(CatalogError::from)?;
        store.validate().map_err(CatalogError::from)?;
        // Format fingerprint is labeled structure evidence, not logical DB identity.
        let format = codec::format_fingerprint(
            format.storage_version().ok_or(CatalogError::Storage)?,
            format.version_marker_bytes().ok_or(CatalogError::Storage)?,
            format.column_families(),
        );
        Ok(Materialized {
            device,
            inode,
            format,
        })
    }

    pub fn catalog_generation(&self) -> u64 {
        self.catalog.borrow().generation
    }

    pub fn list(&self) -> Result<Vec<RepositoryRecord>, CatalogError> {
        self.usable()?;
        self.catalog
            .borrow()
            .entries
            .iter()
            .map(|entry| {
                Ok(RepositoryRecord {
                    id: RepositoryId::parse(&entry.id).map_err(|_| CatalogError::InvalidCatalog)?,
                    phase: entry.phase,
                    changed_at: entry.changed_at,
                })
            })
            .collect()
    }

    /// Bounded privileged inventory. Unknown entries remain untouched and nonready.
    /// Unrecorded recovery packages and unknown trash entries are reported too. A
    /// `Tombstoned` entry owns no source or staging path, so a recreated one is
    /// reported as unknown, never adopted. Only a current restore attempt with a
    /// matching completion receipt is hidden; incomplete and earlier attempts remain
    /// inventoried debris, never adopted or deleted.
    pub fn orphan_inventory(&self) -> Result<Vec<PathBuf>, CatalogError> {
        self.usable()?;
        let catalog = self.catalog.borrow();
        let mut known: BTreeSet<PathBuf> = [
            "catalog",
            "manager.lock",
            "repos",
            "staging",
            "backups",
            "trash",
        ]
        .into_iter()
        .map(|name| self.root.path.join(name))
        .collect();
        for entry in &catalog.entries {
            if entry.phase != Phase::Tombstoned {
                known.insert(self.root.path.join("repos").join(&entry.uuid));
                known.insert(self.root.path.join("staging").join(&entry.uuid));
            }
            if let Some(path) = self.known_restore_root(entry) {
                known.insert(path);
            }
        }
        let mut found: Vec<PathBuf> = self
            .root
            .scan(catalog.limits)?
            .into_iter()
            .filter(|p| !known.contains(p))
            .collect();
        found.extend(self.tombstone_inventory()?);
        Ok(found)
    }

    pub fn create(
        &mut self,
        id: RepositoryId,
        expected_catalog_generation: u64,
    ) -> Result<RepositoryRecord, CatalogError> {
        self.usable()?;
        let mut next = self.catalog.borrow().clone();
        if next.generation != expected_catalog_generation
            || next.entries.iter().any(|entry| entry.id == id.as_str())
        {
            return Err(CatalogError::Conflict);
        }
        if next.entries.len() >= next.limits.repositories {
            return Err(CatalogError::Limit);
        }
        // Reserve staging plus the next catalog temp before durable ID reservation.
        // Pending evidence consumes the same ceiling and is never auto-deleted.
        self.root.reserve_scan(next.limits, 2)?;
        let uuid = new_uuid();
        if next.entries.iter().any(|entry| entry.uuid == uuid) {
            return Err(CatalogError::Conflict);
        }
        let index = next.entries.len();
        next.entries.push(Entry {
            id: id.as_str().to_owned(),
            uuid: uuid.clone(),
            phase: Phase::Reserved,
            changed_at: next.generation,
            evidence: None,
            tombstone: None,
            restore: None,
        });
        self.persist(next, index)?;
        self.point(FaultPoint::AfterReservation)?;
        let result = self.materialize(index, &uuid);
        if result.is_err() && !self.poisoned.get() {
            if self.catalog.borrow().entries[index].phase == Phase::Reserved {
                let mut failed = self.catalog.borrow().clone();
                failed.entries[index].phase = Phase::Failed;
                self.persist(failed, index)?;
            } else {
                // Validated storage may already be published. Reopen reconciles it.
                self.poisoned.set(true);
            }
        }
        result?;
        self.list()?
            .into_iter()
            .find(|entry| entry.id == id)
            .ok_or(CatalogError::NotFound)
    }

    fn materialize(&self, index: usize, uuid: &str) -> Result<(), CatalogError> {
        let staging = self.root.create_staging(uuid)?;
        self.point(FaultPoint::AfterStaging)?;
        let store = Store::open(&staging).map_err(|_| CatalogError::Storage)?;
        store.validate().map_err(|_| CatalogError::Storage)?;
        store.flush().map_err(|_| CatalogError::Storage)?;
        drop(store);
        std::fs::File::open(&staging)?.sync_all()?;
        self.point(FaultPoint::AfterStoreFlush)?;
        let evidence = self.verified(&staging)?;
        let mut next = self.catalog.borrow().clone();
        next.entries[index].evidence = Some(evidence);
        next.entries[index].phase = Phase::Validated;
        self.persist(next, index)?;
        self.point(FaultPoint::AfterValidation)?;
        self.point(FaultPoint::BeforePublish)?;
        self.root.publish(uuid)?;
        self.point(FaultPoint::AfterPublish)?;
        let mut next = self.catalog.borrow().clone();
        next.entries[index].phase = Phase::Closed;
        self.persist(next, index)?;
        self.point(FaultPoint::AfterClosed)
    }

    /// Restart safety: a durable `Quiescing` entry stays `Quiescing` (never ready or
    /// closed by phase alone). The exclusive root lock plus an empty `active` map prove
    /// old handles are gone. Only definite evidence (retained staging debris or a
    /// proven materialization/identity mismatch) turns it `Failed`. Capacity,
    /// compatibility and transient I/O refusals keep it `Quiescing` without a write,
    /// so one repository never blocks reopening the root; `complete_quiesce`
    /// re-verifies. Tombstone phases are never guessed from directory presence:
    /// `TombstoneIntent` and `Tombstoned` are left untouched, and `TombstoneBackedUp`
    /// completes the move only after the exact recorded package, the guarded source (or
    /// trash) evidence and their record-by-record content equality verify; otherwise
    /// it is preserved unchanged and non-ready. A `Reserved` restore entry is advanced
    /// only from what is durably on disk (its restore root, marker and staged store);
    /// with nothing on disk it stays non-ready awaiting `retry_restore`, and definite
    /// debris turns it `Failed`. A `Validated` restore entry never uses the generic
    /// evidence-only path: its source binding, recorded evidence, completion receipt,
    /// exact package, content and CURRENT primary checkpoint/outbox are proved again,
    /// staged or already published, and both publication parents are synced before
    /// `Closed`; transient refusals leave it `Validated` and non-ready. A generic
    /// published `Validated` entry re-syncs both parents too. Nothing is initialized
    /// or deleted.
    pub fn reconcile(&self) -> Result<(), CatalogError> {
        self.usable()?;
        if !self.active.borrow().is_empty() {
            return Err(CatalogError::Conflict);
        }
        let entries = self.catalog.borrow().entries.clone();
        for (index, entry) in entries.iter().enumerate() {
            if matches!(
                entry.phase,
                Phase::Failed | Phase::Closed | Phase::TombstoneIntent | Phase::Tombstoned
            ) {
                continue;
            }
            if entry.phase == Phase::TombstoneBackedUp {
                self.reconcile_backed_up(index)?;
                continue;
            }
            if entry.phase == Phase::Reserved && entry.restore.is_some() {
                self.reconcile_restoring(index)?;
                continue;
            }
            if entry.phase == Phase::Validated && entry.restore.is_some() {
                self.reconcile_restore_validated(index)?;
                continue;
            }
            let staging = self.root.path.join("staging").join(&entry.uuid);
            let published = self.root.path.join("repos").join(&entry.uuid);
            if entry.phase == Phase::Quiescing {
                let definite = match fs::exists(&staging) {
                    Ok(true) => true,
                    Ok(false) => matches!(self.matches_evidence(&published, entry), Ok(false)),
                    Err(_) => false,
                };
                if definite {
                    let mut next = self.catalog.borrow().clone();
                    next.entries[index].phase = Phase::Failed;
                    self.persist(next, index)?;
                }
                continue;
            }
            let mut next = self.catalog.borrow().clone();
            let staged = fs::exists(&staging)?;
            let ready = fs::exists(&published)?;
            let valid = if entry.phase == Phase::Validated && staged != ready {
                self.matches_evidence(if staged { &staging } else { &published }, entry)?
            } else {
                false
            };
            if valid {
                if staged {
                    if let Err(error) = self.root.publish(&entry.uuid) {
                        self.poisoned.set(true);
                        return Err(error);
                    }
                } else {
                    // A crash may have followed the rename but preceded its syncs.
                    self.root.sync_publication()?;
                }
                next.entries[index].phase = Phase::Closed;
            } else {
                next.entries[index].phase = Phase::Failed;
            }
            self.persist(next, index)?;
        }
        Ok(())
    }

    pub fn open_repository(
        &self,
        id: &RepositoryId,
        mode: OpenMode,
    ) -> Result<RepositoryHandle<'_>, CatalogError> {
        self.usable()?;
        let catalog = self.catalog.borrow().clone();
        if self.active.borrow().len() >= catalog.limits.open_handles {
            return Err(CatalogError::Limit);
        }
        let index = catalog
            .entries
            .iter()
            .position(|entry| entry.id == id.as_str())
            .ok_or(CatalogError::NotFound)?;
        let entry = &catalog.entries[index];
        if entry.phase != Phase::Closed {
            return Err(CatalogError::NotReady);
        }
        if self.active.borrow().contains_key(&entry.uuid) {
            return Err(CatalogError::Conflict);
        }
        let path = self.root.path.join("repos").join(&entry.uuid);
        if !self.matches_evidence(&path, entry)? {
            let mut next = catalog.clone();
            next.entries[index].phase = Phase::Failed;
            self.persist(next, index)?;
            return Err(CatalogError::NotReady);
        }
        let (mut model, provision) = Repository::provision(
            id.clone(),
            catalog.limits.model()?,
            LogicalTime(catalog.generation),
        );
        model
            .complete_provisioning(
                &provision,
                ValidationOutcome::Passed,
                LogicalTime(catalog.generation),
            )
            .map_err(|_| CatalogError::NotReady)?;
        let opening = model
            .begin_open(
                model.snapshot().generation,
                mode,
                LogicalTime(catalog.generation),
            )
            .map_err(|_| CatalogError::NotReady)?;
        // Writable create-if-missing API is reached only after materialization evidence,
        // directory identity, format, read-only open and logical validation all pass.
        (self.hook)(FaultPoint::BeforeStoreOpen)?;
        let store = match mode {
            OpenMode::ReadOnly => Store::open_read_only(&path),
            OpenMode::ReadWrite => Store::open(&path),
        }
        .map_err(CatalogError::from)?;
        store.validate().map_err(CatalogError::from)?;
        // Writable open may rotate native metadata after the read-only preflight.
        // It must not return ready when that growth exceeds the scan ceiling.
        self.root
            .guard_open_store(&path, catalog.limits.store_files)?;
        model
            .complete_open(
                &opening,
                ValidationOutcome::Passed,
                LogicalTime(catalog.generation),
            )
            .map_err(|_| CatalogError::NotReady)?;
        self.active.borrow_mut().insert(entry.uuid.clone(), false);
        Ok(RepositoryHandle {
            store: Some(store),
            manager: self,
            uuid: entry.uuid.clone(),
            model,
            mode,
        })
    }

    fn matches_evidence(&self, path: &Path, entry: &Entry) -> Result<bool, CatalogError> {
        if !fs::exists(path)? {
            return Ok(false);
        }
        match self.root.directory(path) {
            Ok((device, inode))
                if entry
                    .evidence
                    .as_ref()
                    .is_some_and(|e| e.device != device || e.inode != inode) =>
            {
                return Ok(false);
            }
            Err(CatalogError::UnsafePath) => return Ok(false),
            Err(error) => return Err(error),
            Ok(_) => (),
        }
        match self.verified(path) {
            Ok(actual) => Ok(Some(&actual) == entry.evidence.as_ref()),
            Err(CatalogError::CorruptStore | CatalogError::UnsafePath) => Ok(false),
            // Capacity, compatibility and transient I/O do not disprove identity.
            Err(error) => Err(error),
        }
    }

    fn fence(&self, uuid: &str, fenced: bool) {
        if let Some(slot) = self.active.borrow_mut().get_mut(uuid) {
            *slot = fenced;
        }
    }

    fn admit(&self, uuid: &str) -> Result<(), CatalogError> {
        match self.active.borrow().get(uuid) {
            Some(false) => Ok(()),
            Some(true) => Err(CatalogError::Quiescing),
            None => Err(CatalogError::NotReady),
        }
    }

    fn receipt(&self, id: &RepositoryId, index: usize) -> QuiesceReceipt {
        let catalog = self.catalog.borrow();
        QuiesceReceipt {
            id: id.clone(),
            uuid: catalog.entries[index].uuid.clone(),
            phase: catalog.entries[index].phase,
            generation: catalog.entries[index].changed_at,
            catalog_generation: catalog.generation,
        }
    }

    /// Durably records `Quiescing` for a `Closed` or ready repository, rejecting new
    /// opens and fencing live handles before any `Store` access. `expected_generation`
    /// is the entry's own generation (`RepositoryRecord::changed_at`); a stale value is
    /// `Conflict`. Repeating it on an already `Quiescing` entry with its current
    /// generation is idempotent: no write, a receipt for the same entry generation. A
    /// pre-write refusal (generation or scan exhaustion) removes the fence; a failed
    /// write poisons the manager and keeps it, because the outcome is uncertain until
    /// reopen.
    pub fn begin_quiesce(
        &self,
        id: &RepositoryId,
        expected_generation: u64,
    ) -> Result<QuiesceReceipt, CatalogError> {
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
        if entry.phase == Phase::Quiescing {
            self.fence(&entry.uuid, true);
            return Ok(self.receipt(id, index));
        }
        if entry.phase != Phase::Closed {
            return Err(CatalogError::NotReady);
        }
        let uuid = entry.uuid.clone();
        let mut next = catalog;
        next.entries[index].phase = Phase::Quiescing;
        self.fence(&uuid, true);
        if let Err(error) = self.persist(next, index) {
            if !self.poisoned.get() {
                self.fence(&uuid, false);
            }
            return Err(error);
        }
        Ok(self.receipt(id, index))
    }

    /// Completes a durable quiesce to `Closed`. Refuses with `Busy` while any
    /// manager-owned handle exists; drain is proved by the actual handle drop, not by
    /// a caller assertion. Materialization is re-verified before `Closed` is persisted;
    /// a definite mismatch persists `Failed` and returns `NotReady`, while capacity,
    /// compatibility and transient refusals return their error without a write. The
    /// receipt must belong to this ID, this entry's internal UUID and its current
    /// `Quiescing` generation, so stale, repeated, cross-repository and cross-root
    /// receipts are `Conflict`.
    pub fn complete_quiesce(
        &self,
        id: &RepositoryId,
        receipt: &QuiesceReceipt,
    ) -> Result<QuiesceReceipt, CatalogError> {
        self.usable()?;
        let catalog = self.catalog.borrow().clone();
        let index = catalog
            .entries
            .iter()
            .position(|entry| entry.id == id.as_str())
            .ok_or(CatalogError::NotFound)?;
        let entry = &catalog.entries[index];
        if receipt.id != *id
            || receipt.uuid != entry.uuid
            || receipt.phase != Phase::Quiescing
            || entry.phase != Phase::Quiescing
            || entry.changed_at != receipt.generation
        {
            return Err(CatalogError::Conflict);
        }
        if self.active.borrow().contains_key(&entry.uuid) {
            return Err(CatalogError::Busy);
        }
        if catalog.generation.checked_add(1).is_none() {
            return Err(CatalogError::Limit);
        }
        let path = self.root.path.join("repos").join(&entry.uuid);
        let phase = if self.matches_evidence(&path, entry)? {
            Phase::Closed
        } else {
            Phase::Failed
        };
        let mut next = catalog.clone();
        next.entries[index].phase = phase;
        self.persist(next, index)?;
        if phase == Phase::Failed {
            return Err(CatalogError::NotReady);
        }
        Ok(self.receipt(id, index))
    }
}

/// Keeps manager lock and counted slot alive. No cloneable raw Store escapes.
/// This bounded embedded seam exposes RDF insert/read only, not a server route.
/// The manager fence is authoritative: `snapshot()` is the process-local model and is
/// not advanced by a quiesce.
pub struct RepositoryHandle<'a> {
    store: Option<Store>,
    manager: &'a RepositoryManager,
    uuid: String,
    model: Repository,
    mode: OpenMode,
}
impl RepositoryHandle<'_> {
    pub fn snapshot(&self) -> RepositorySnapshot {
        self.model.snapshot()
    }
    pub fn contains(&self, quad: &Quad) -> Result<bool, CatalogError> {
        self.manager.admit(&self.uuid)?;
        self.store
            .as_ref()
            .ok_or(CatalogError::NotReady)?
            .contains(quad)
            .map_err(|_| CatalogError::Storage)
    }
    pub fn insert(&self, quad: Quad) -> Result<(), CatalogError> {
        self.manager.admit(&self.uuid)?;
        if self.mode != OpenMode::ReadWrite {
            return Err(CatalogError::NotReady);
        }
        self.store
            .as_ref()
            .ok_or(CatalogError::NotReady)?
            .insert(quad)
            .map_err(|_| CatalogError::Storage)
    }
    pub fn flush(&self) -> Result<(), CatalogError> {
        self.manager.admit(&self.uuid)?;
        self.store
            .as_ref()
            .ok_or(CatalogError::NotReady)?
            .flush()
            .map_err(|_| CatalogError::Storage)
    }
}
impl Drop for RepositoryHandle<'_> {
    fn drop(&mut self) {
        drop(self.store.take());
        self.manager.active.borrow_mut().remove(&self.uuid);
    }
}
