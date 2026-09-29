//! Opt-in Linux catalog create/reconcile/open. No server or destructive lifecycle API.
//!
//! Root is private to one trusted OS owner. This is not a defense against another
//! arbitrary same-uid filesystem writer. Directory device/inode and validated
//! format bind materialization; they are not a governed store UUID or backup.
//! Runtime readiness is never persisted. Catalog generations and process-local
//! lifecycle-model generations are deliberately separate.
mod codec;
mod fs;

use crate::lease::LogicalTime;
use crate::repository::{
    OpenMode, Repository, RepositoryId, RepositoryLimits, RepositorySnapshot, ValidationOutcome,
};
pub use codec::Phase;
use codec::{Catalog, Entry, Materialized};
use oxigraph::model::Quad;
use oxigraph::store::{StorageError, Store, StoreVersionStatus};
use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::fmt;
use std::path::{Path, PathBuf};

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
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryRecord {
    pub id: RepositoryId,
    pub phase: Phase,
    pub changed_at: u64,
}

pub struct RepositoryManager {
    root: fs::Root,
    catalog: RefCell<Catalog>,
    active: RefCell<BTreeSet<String>>,
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

impl RepositoryManager {
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
            active: RefCell::new(BTreeSet::new()),
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
    pub fn orphan_inventory(&self) -> Result<Vec<PathBuf>, CatalogError> {
        self.usable()?;
        let catalog = self.catalog.borrow();
        let known: BTreeSet<_> = catalog
            .entries
            .iter()
            .flat_map(|e| {
                [
                    self.root.path.join("repos").join(&e.uuid),
                    self.root.path.join("staging").join(&e.uuid),
                ]
            })
            .chain(["catalog", "manager.lock", "repos", "staging"].map(|p| self.root.path.join(p)))
            .collect();
        Ok(self
            .root
            .scan(catalog.limits)?
            .into_iter()
            .filter(|p| !known.contains(p))
            .collect())
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

    pub fn reconcile(&self) -> Result<(), CatalogError> {
        self.usable()?;
        if !self.active.borrow().is_empty() {
            return Err(CatalogError::Conflict);
        }
        let entries = self.catalog.borrow().entries.clone();
        for (index, entry) in entries.iter().enumerate() {
            if matches!(entry.phase, Phase::Failed | Phase::Closed) {
                continue;
            }
            let mut next = self.catalog.borrow().clone();
            let staging = self.root.path.join("staging").join(&entry.uuid);
            let published = self.root.path.join("repos").join(&entry.uuid);
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
        if self.active.borrow().contains(&entry.uuid) {
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
        self.root.guard_open_store(&path, catalog.limits.store_files)?;
        model
            .complete_open(
                &opening,
                ValidationOutcome::Passed,
                LogicalTime(catalog.generation),
            )
            .map_err(|_| CatalogError::NotReady)?;
        self.active.borrow_mut().insert(entry.uuid.clone());
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
}

/// Keeps manager lock and counted slot alive. No cloneable raw Store escapes.
/// This bounded embedded seam exposes RDF insert/read only, not a server route.
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
        self.store
            .as_ref()
            .ok_or(CatalogError::NotReady)?
            .contains(quad)
            .map_err(|_| CatalogError::Storage)
    }
    pub fn insert(&self, quad: Quad) -> Result<(), CatalogError> {
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
