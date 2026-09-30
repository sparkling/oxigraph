//! Opt-in recovery-backed tombstone for the embedded catalog (Linux). No purge,
//! restore, HTTP or admin activation.
//!
//! Order: preflight (no mutation) -> lazy `backups/` and `trash/` -> durable
//! `TombstoneIntent` -> real `Store::backup_with_receipt` into a manager-named package
//! -> `BackupReceipt::verify`, bound/profile checks and an exact content comparison of
//! the source with the package store -> durable `TombstoneBackedUp` carrying the exact
//! receipt fingerprint -> same-device no-replace rename into trash -> sync of `repos/`,
//! `trash/` and the root -> trash evidence check -> durable `Tombstoned`. A directory is
//! never moved without a verified matching package, and `Tombstoned` is never minted
//! from directory presence.
//!
//! Source binding: the recorded physical database ID and RocksDB sequence are package
//! receipt facts only. The store exposes no public accessor for a live source's values,
//! so they are not compared with the source. Instead every quad, named graph and
//! namespace of the guarded source is compared in native order with the package store
//! opened read-only, bounded by the verified receipt counts and the recorded backup
//! timeout, before any backed-up record, move or seal. The package is walked and
//! verified again afterwards. Restart and explicit verification repeat the comparison,
//! so an offline source change with equal counts is refused, not moved or sealed.
//!
//! Guard order: directory identity, ownership, mode, regular-file and link checks run
//! before any native open of a source or trash directory; the package tree is walked
//! before its manifest is verified or its store is opened.
//!
//! Source hard links: a native checkpoint hard-links immutable SST files, so backed-up
//! source files legitimately have extra links. The strict single-link guard is not
//! weakened: every extra link must resolve to the same device and inode under a
//! manager-owned `backups/<uuid>-*/<subdir>/<same name>`; unexplained links are refused.
//!
//! Capacity: every attempt reserves two `backups/` plus `trash/` entries (its package
//! and the trash directory) against `scan_entries`; retained debris counts toward it.
//!
//! Move: Linux `renameat2(RENAME_NOREPLACE)`, so a target appearing after the existence
//! check is refused atomically. A filesystem without that flag refuses the move; there
//! is no plain-rename fallback.
//!
//! Recovery: restart re-derives a `TombstoneBackedUp` entry from disk. Once the recorded
//! package and exactly one of source and trash verify, a remaining source is moved;
//! either way `repos/`, `trash/` and the root are synced before `Tombstoned` is
//! persisted, so a seal never outruns an unsynced rename left by a crash. Every refusal
//! before the catalog write (a refused or failed move, a failed sync, a refused trash
//! check or a catalog write refused before it started) writes nothing and leaves the
//! entry non-ready for the next restart without poisoning, so one repository never
//! blocks reopening the root. Only an attempted `Tombstoned` write that fails poisons,
//! because that rename might already be durable.
//!
//! Contributors: the manager owns the `Store` and always backs up with
//! `BackupOptions::default()` (empty registry, no contributions); it offers no
//! contributor registration. That ownership, not `check_profile`, is what prevents
//! contributor omission; `check_profile` is a defensive invariant that cannot fire for
//! manager-created packages. Any definite refusal after `TombstoneIntent` (including
//! that check) retains the intent and package debris. There is no abandon or
//! return-to-`Quiescing` path: only `retry_tombstone`, which repeats a deterministic
//! refusal, so such a refusal is a dead end short of operator intervention.
//!
//! Logical time: the first attempt takes caller time (a `Quiescing` entry persists no
//! earlier logical time). A retry requires `now` at or after the persisted intent time,
//! so the retention deadline never shrinks.
//!
//! Free-space checks are observations, not reservations against other writers.
//! Caller-injected hooks and process exits model crash phases, not power loss.
use super::codec::{BackupBinding, Entry, Materialized, TombstoneRecord, format_fingerprint};
use super::fs as catalog_fs;
use super::{BackupFailure, CatalogError, FaultPoint, Phase, QuiesceReceipt, RepositoryManager};
use crate::lease::LogicalTime;
use crate::repository::RepositoryId;
use oxigraph::store::{
    BackupOptions, BackupReceipt, StorageError, Store, StoreVersionStatus, TransactionStartControl,
};
use sha2::{Digest, Sha256};
use std::ffi::CString;
use std::fmt;
use std::num::{NonZeroU64, NonZeroUsize};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_FILES: usize = 100_000;
const MAX_TIMEOUT_MS: u128 = 86_400_000;
/// Bound on one package root: `store`, `contributors` and a pending/complete manifest.
const PACKAGE_ENTRIES: usize = 8;
/// Linux `RENAME_NOREPLACE` from `include/uapi/linux/fs.h`.
const RENAME_NOREPLACE: libc::c_long = 1;

/// Explicit finite backup bounds. No defaults: every field must be chosen.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TombstoneLimits {
    /// Maximum package file count, 1..=100000.
    pub backup_files: usize,
    /// Maximum package payload bytes, 1..u64::MAX (exclusive).
    pub backup_bytes: u64,
    /// Backup, each verification and each content comparison timeout, 1 ms..=1 day.
    pub backup_timeout: Duration,
}

impl TombstoneLimits {
    fn timeout_ms(&self) -> Result<u64, CatalogError> {
        let ms = self.backup_timeout.as_millis();
        if self.backup_files == 0
            || self.backup_files > MAX_FILES
            || self.backup_bytes == 0
            || self.backup_bytes == u64::MAX
            || ms == 0
            || ms > MAX_TIMEOUT_MS
        {
            return Err(CatalogError::Limit);
        }
        u64::try_from(ms).map_err(|_| CatalogError::Limit)
    }
}

/// Proof that this manager durably applied `Tombstoned`. Not `Clone`; `Debug` omits
/// the internal UUID (which this type does not even hold).
#[derive(Eq, PartialEq)]
#[must_use]
pub struct TombstoneReceipt {
    id: RepositoryId,
    generation: u64,
    deadline: u64,
    fingerprint: [u8; 32],
}

impl fmt::Debug for TombstoneReceipt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TombstoneReceipt")
            .field("id", &self.id)
            .field("generation", &self.generation)
            .field("deadline", &self.deadline)
            .finish_non_exhaustive()
    }
}

impl TombstoneReceipt {
    pub fn id(&self) -> &RepositoryId {
        &self.id
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    /// Injected logical time plus the manager's retention.
    pub fn deadline(&self) -> u64 {
        self.deadline
    }
    pub fn backup_fingerprint(&self) -> [u8; 32] {
        self.fingerprint
    }
}

/// Read-only view of the tombstone journal record. Never exposes physical paths.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TombstoneInfo {
    phase: Phase,
    generation: u64,
    intent_time: u64,
    deadline: u64,
    backup_fingerprint: Option<[u8; 32]>,
}

impl TombstoneInfo {
    pub fn phase(&self) -> Phase {
        self.phase
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn intent_time(&self) -> u64 {
        self.intent_time
    }
    pub fn deadline(&self) -> u64 {
        self.deadline
    }
    pub fn backup_fingerprint(&self) -> Option<[u8; 32]> {
        self.backup_fingerprint
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

fn control(record: &TombstoneRecord) -> TransactionStartControl {
    TransactionStartControl::new().with_timeout(Duration::from_millis(record.backup_timeout_ms))
}

fn count_children(dir: &Path, cap: usize) -> Result<usize, CatalogError> {
    let mut count = 0_usize;
    for item in std::fs::read_dir(dir)? {
        item?;
        count += 1;
        if count > cap {
            return Err(CatalogError::Limit);
        }
    }
    Ok(count)
}

/// Source/trash guard: the strict single-link rule, except that each extra link must
/// be the same device and inode under a manager-owned package directory.
fn guard_linked(
    root: &catalog_fs::Root,
    path: &Path,
    max: usize,
    holders: &[PathBuf],
) -> Result<(u64, u64), CatalogError> {
    let identity = root.directory(path)?;
    let owner = std::fs::symlink_metadata(&root.path)?.uid();
    for (count, item) in std::fs::read_dir(path)?.enumerate() {
        if count >= max {
            return Err(CatalogError::Limit);
        }
        let item = item?;
        let meta = std::fs::symlink_metadata(item.path())?;
        if !meta.is_file()
            || meta.uid() != owner
            || meta.dev() != identity.0
            || meta.mode() & 0o022 != 0
        {
            return Err(CatalogError::UnsafePath);
        }
        let name = item.file_name();
        let linked = holders
            .iter()
            .filter(|holder| {
                matches!(
                    std::fs::symlink_metadata(holder.join(&name)),
                    Ok(other) if other.is_file()
                        && other.dev() == meta.dev()
                        && other.ino() == meta.ino()
                )
            })
            .count();
        let expected = u64::try_from(linked)
            .ok()
            .and_then(|linked| linked.checked_add(1))
            .ok_or(CatalogError::Limit)?;
        if meta.nlink() != expected {
            return Err(CatalogError::UnsafePath);
        }
    }
    Ok(identity)
}

fn inventory(path: &Path, files: usize, bytes: u64) -> Result<u64, CatalogError> {
    let mut count = 0_usize;
    let mut total = 0_u64;
    for item in std::fs::read_dir(path)? {
        let item = item?;
        count += 1;
        total = total
            .checked_add(std::fs::symlink_metadata(item.path())?.len())
            .ok_or(CatalogError::Limit)?;
        if count > files || total > bytes {
            return Err(CatalogError::Limit);
        }
    }
    Ok(total)
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

/// Atomic rename that never replaces an existing target, including one appearing
/// after the caller's existence check. No fallback: unsupported filesystems refuse.
fn rename_noreplace(from: &Path, to: &Path) -> Result<(), CatalogError> {
    let from = CString::new(from.as_os_str().as_bytes()).map_err(|_| CatalogError::UnsafePath)?;
    let to = CString::new(to.as_os_str().as_bytes()).map_err(|_| CatalogError::UnsafePath)?;
    // SAFETY: both pointers are valid NUL-terminated strings owned for the whole call;
    // renameat2 only reads them and retains nothing.
    #[expect(unsafe_code)]
    let code = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::c_long::from(libc::AT_FDCWD),
            from.as_ptr(),
            libc::c_long::from(libc::AT_FDCWD),
            to.as_ptr(),
            RENAME_NOREPLACE,
        )
    };
    if code == 0 {
        return Ok(());
    }
    match std::io::Error::last_os_error().raw_os_error() {
        Some(libc::EEXIST | libc::ENOTEMPTY) => Err(CatalogError::UnsafePath),
        _ => Err(CatalogError::Io),
    }
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

/// Exact bounded source/package binding. `path` must already have passed the link
/// guard and `package` the tree walk and manifest verification. Every quad, named
/// graph and namespace must be equal in native order and each count must equal the
/// verified receipt; the recorded backup timeout bounds the whole comparison.
fn content_matches(
    path: &Path,
    package: &Path,
    receipt: &BackupReceipt,
    record: &TombstoneRecord,
) -> Result<(), CatalogError> {
    let deadline = Instant::now()
        .checked_add(Duration::from_millis(record.backup_timeout_ms))
        .ok_or(CatalogError::Limit)?;
    let source = Store::open_read_only(path).map_err(CatalogError::from)?;
    let packaged = Store::open_read_only(package.join(BackupReceipt::store_directory()))
        .map_err(CatalogError::from)?;
    let contents = receipt.contents();
    lockstep(source.iter(), packaged.iter(), contents.quads(), deadline)?;
    lockstep(
        source.named_graphs(),
        packaged.named_graphs(),
        contents.named_graphs(),
        deadline,
    )?;
    lockstep(
        source.namespaces(),
        packaged.namespaces(),
        contents.namespaces(),
        deadline,
    )
}

/// Defensive invariant only: manager packages always use `BackupOptions::default()`,
/// so this cannot fire for them. It is not proof that contributors are absent from a
/// deployment; the manager's ownership of the `Store` is.
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

#[expect(
    clippy::multiple_inherent_impl,
    reason = "opt-in tombstone lifecycle kept beside its journal helpers"
)]
impl RepositoryManager {
    /// Recovery-backed tombstone of one quiesced repository. Requires the exact current
    /// `QuiesceReceipt` (entry generation and internal UUID), no manager-owned handle,
    /// explicit finite bounds and injected logical time. The retention deadline is
    /// `now + model_retention` with checked arithmetic; the catalog generation is only
    /// compare-and-swap identity. Definite backup refusals leave `TombstoneIntent`
    /// unpoisoned with debris retained (see `retry_tombstone`); any uncertain outcome
    /// poisons the manager until reopen, where reconcile conservatively recovers.
    pub fn tombstone(
        &self,
        id: &RepositoryId,
        receipt: &QuiesceReceipt,
        now: LogicalTime,
        limits: &TombstoneLimits,
    ) -> Result<TombstoneReceipt, CatalogError> {
        self.usable()?;
        let (index, entry) = self.entry_of(id)?;
        if receipt.id != *id
            || receipt.uuid != entry.uuid
            || receipt.phase != Phase::Quiescing
            || entry.phase != Phase::Quiescing
            || entry.changed_at != receipt.generation
        {
            return Err(CatalogError::Conflict);
        }
        self.start_intent(index, now, limits)
    }

    /// Starts a fresh attempt (new package path, new deadline) for an entry left in
    /// `TombstoneIntent`. The bounds must equal the persisted ones, and `now` must not
    /// precede the persisted intent time (`TimeRegression`), so the retention deadline
    /// never shrinks. Earlier debris is retained and never adopted. A deterministic
    /// refusal repeats on every retry; there is no abandon path.
    pub fn retry_tombstone(
        &self,
        id: &RepositoryId,
        expected_generation: u64,
        now: LogicalTime,
        limits: &TombstoneLimits,
    ) -> Result<TombstoneReceipt, CatalogError> {
        self.usable()?;
        let (index, entry) = self.entry_of(id)?;
        if entry.changed_at != expected_generation {
            return Err(CatalogError::Conflict);
        }
        let record = match (&entry.phase, &entry.tombstone) {
            (Phase::TombstoneIntent, Some(record)) => record,
            _ => return Err(CatalogError::NotReady),
        };
        if now.0 < record.intent_time {
            return Err(CatalogError::TimeRegression);
        }
        if limits.timeout_ms()? != record.backup_timeout_ms
            || u64::try_from(limits.backup_files).ok() != Some(record.backup_files)
            || limits.backup_bytes != record.backup_bytes
        {
            return Err(CatalogError::Conflict);
        }
        self.start_intent(index, now, limits)
    }

    /// Read-only journal view. No physical path is exposed.
    pub fn tombstone_info(&self, id: &RepositoryId) -> Result<TombstoneInfo, CatalogError> {
        self.usable()?;
        let (_, entry) = self.entry_of(id)?;
        let record = entry.tombstone.as_ref().ok_or(CatalogError::NotReady)?;
        Ok(TombstoneInfo {
            phase: entry.phase,
            generation: entry.changed_at,
            intent_time: record.intent_time,
            deadline: record.deadline,
            backup_fingerprint: record
                .backup
                .as_ref()
                .and_then(|binding| parse_hex32(&binding.fingerprint)),
        })
    }

    /// Explicit bounded re-verification: the source/trash directory guard first, then
    /// the recorded package (exact fingerprint, bindings, bounds, profile) and their
    /// record-by-record content equality. A `Tombstoned` entry with a recreated
    /// `repos/<uuid>`, or a `TombstoneBackedUp` entry with both a source and a trash
    /// entry (which restart cannot complete), is refused. Typed failures are returned;
    /// nothing is repaired or moved.
    pub fn verify_tombstone(&self, id: &RepositoryId) -> Result<TombstoneInfo, CatalogError> {
        self.usable()?;
        let (_, entry) = self.entry_of(id)?;
        let source = self.root.path.join("repos").join(&entry.uuid);
        let trash = self.root.path.join("trash").join(&entry.uuid);
        let path = match entry.phase {
            Phase::Tombstoned => {
                if catalog_fs::exists(&source)? {
                    return Err(CatalogError::UnsafePath);
                }
                trash
            }
            Phase::TombstoneBackedUp => {
                match (catalog_fs::exists(&source)?, catalog_fs::exists(&trash)?) {
                    (true, true) => return Err(CatalogError::UnsafePath),
                    (true, false) => source,
                    (false, _) => trash,
                }
            }
            _ => return Err(CatalogError::NotReady),
        };
        self.verify_all(&entry, &path)?;
        self.tombstone_info(id)
    }

    fn entry_of(&self, id: &RepositoryId) -> Result<(usize, Entry), CatalogError> {
        let catalog = self.catalog.borrow();
        let index = catalog
            .entries
            .iter()
            .position(|entry| entry.id == id.as_str())
            .ok_or(CatalogError::NotFound)?;
        Ok((index, catalog.entries[index].clone()))
    }

    fn package_path(&self, uuid: &str, attempt: u64) -> PathBuf {
        self.root
            .path
            .join("backups")
            .join(package_name(uuid, attempt))
    }

    fn start_intent(
        &self,
        index: usize,
        now: LogicalTime,
        limits: &TombstoneLimits,
    ) -> Result<TombstoneReceipt, CatalogError> {
        let timeout_ms = limits.timeout_ms()?;
        let (catalog_limits, generation, entry) = {
            let catalog = self.catalog.borrow();
            (
                catalog.limits,
                catalog.generation,
                catalog.entries[index].clone(),
            )
        };
        if self.active.borrow().contains_key(&entry.uuid) {
            return Err(CatalogError::Busy);
        }
        let deadline = now
            .0
            .checked_add(catalog_limits.model_retention)
            .ok_or(CatalogError::Retention)?;
        // Intent, backed-up and tombstoned each consume one catalog generation.
        generation.checked_add(3).ok_or(CatalogError::Limit)?;
        self.preflight(index, &entry, limits, timeout_ms)?;
        self.ensure_dirs()?;
        let record = TombstoneRecord {
            attempt: generation + 1,
            intent_time: now.0,
            deadline,
            backup_files: u64::try_from(limits.backup_files).map_err(|_| CatalogError::Limit)?,
            backup_bytes: limits.backup_bytes,
            backup_timeout_ms: timeout_ms,
            backup: None,
        };
        self.point(FaultPoint::BeforeTombstoneIntent)?;
        let mut next = self.catalog.borrow().clone();
        next.entries[index].phase = Phase::TombstoneIntent;
        next.entries[index].tombstone = Some(record);
        self.persist(next, index)?;
        self.point(FaultPoint::AfterTombstoneIntent)?;
        self.continue_tombstone(index)
    }

    /// Everything here is read-only: no directory, journal or source byte changes.
    /// An attempt adds two `backups/` plus `trash/` entries (package and trash
    /// directory), so both are reserved against `scan_entries`.
    fn preflight(
        &self,
        index: usize,
        entry: &Entry,
        limits: &TombstoneLimits,
        timeout_ms: u64,
    ) -> Result<(), CatalogError> {
        let catalog_limits = self.catalog.borrow().limits;
        let mut occupied = 0_usize;
        for name in ["backups", "trash"] {
            let dir = self.root.path.join(name);
            if catalog_fs::exists(&dir)? {
                self.root.directory(&dir)?;
                occupied = occupied
                    .checked_add(count_children(&dir, catalog_limits.scan_entries)?)
                    .ok_or(CatalogError::Limit)?;
            }
        }
        if occupied
            .checked_add(2)
            .is_none_or(|total| total > catalog_limits.scan_entries)
        {
            return Err(CatalogError::Limit);
        }
        if catalog_fs::exists(&self.root.path.join("trash").join(&entry.uuid))? {
            return Err(CatalogError::UnsafePath);
        }
        let source = self.root.path.join("repos").join(&entry.uuid);
        if !self.linked_matches(&source, entry)? {
            return Err(CatalogError::NotReady);
        }
        let bytes = inventory(&source, limits.backup_files, limits.backup_bytes)?;
        let reserve = u64::try_from(catalog_limits.catalog_bytes)
            .ok()
            .and_then(|size| size.checked_mul(2))
            .and_then(|size| size.checked_add(bytes.checked_mul(2)?))
            .ok_or(CatalogError::Limit)?;
        if free_bytes(&self.root.path)? < reserve {
            return Err(CatalogError::Limit);
        }
        self.trial(index, limits, timeout_ms)?;
        self.root.reserve_scan(catalog_limits, 3)
    }

    /// Worst-case catalog size, so `catalog_bytes` cannot overflow after the backup.
    fn trial(
        &self,
        index: usize,
        limits: &TombstoneLimits,
        timeout_ms: u64,
    ) -> Result<(), CatalogError> {
        let files = u64::try_from(limits.backup_files).map_err(|_| CatalogError::Limit)?;
        let mut catalog = self.catalog.borrow().clone();
        catalog.generation = u64::MAX;
        let entry = &mut catalog.entries[index];
        entry.changed_at = u64::MAX;
        entry.phase = Phase::Tombstoned;
        entry.tombstone = Some(TombstoneRecord {
            attempt: u64::MAX - 1,
            intent_time: u64::MAX - 1,
            deadline: u64::MAX,
            backup_files: files,
            backup_bytes: limits.backup_bytes,
            backup_timeout_ms: timeout_ms,
            backup: Some(BackupBinding {
                fingerprint: "f".repeat(64),
                database_id: "f".repeat(64),
                sequence: u64::MAX,
                quads: u64::MAX,
                named_graphs: u64::MAX,
                namespaces: u64::MAX,
                files,
                bytes: limits.backup_bytes,
            }),
        });
        catalog.encode().map(drop)
    }

    fn ensure_dirs(&self) -> Result<(), CatalogError> {
        let mut created = false;
        for name in ["backups", "trash"] {
            let dir = self.root.path.join(name);
            if !catalog_fs::exists(&dir)? {
                std::fs::DirBuilder::new().mode(0o700).create(&dir)?;
                created = true;
            }
            self.root.directory(&dir)?;
        }
        if created {
            std::fs::File::open(&self.root.path)?.sync_all()?;
        }
        Ok(())
    }

    /// Directories under manager-owned packages of this repository that may hold
    /// legitimate hard links to its source files (`store`, a checkpoint temp, ...).
    /// Top-level `backups/` entries are bounded by `scan_entries`, each package root by
    /// a fixed small bound.
    fn link_holders(&self, uuid: &str) -> Result<Vec<PathBuf>, CatalogError> {
        let dir = self.root.path.join("backups");
        if !catalog_fs::exists(&dir)? {
            return Ok(Vec::new());
        }
        self.root.directory(&dir)?;
        let cap = self.catalog.borrow().limits.scan_entries;
        let prefix = format!("{uuid}-");
        let mut holders = Vec::new();
        for (count, item) in std::fs::read_dir(&dir)?.enumerate() {
            if count >= cap {
                return Err(CatalogError::Limit);
            }
            let item = item?;
            if !item
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(&prefix))
                || !std::fs::symlink_metadata(item.path())?.is_dir()
            {
                continue;
            }
            for (entries, child) in std::fs::read_dir(item.path())?.enumerate() {
                if entries >= PACKAGE_ENTRIES {
                    return Err(CatalogError::Limit);
                }
                let child = child?;
                if std::fs::symlink_metadata(child.path())?.is_dir() {
                    holders.push(child.path());
                }
            }
        }
        Ok(holders)
    }

    /// The link guard runs before `Store::inspect` or any native open of `path`.
    fn verified_linked(&self, path: &Path, uuid: &str) -> Result<Materialized, CatalogError> {
        (self.hook)(FaultPoint::BeforeVerification)?;
        let holders = self.link_holders(uuid)?;
        let max = self.catalog.borrow().limits.store_files;
        let (device, inode) = guard_linked(&self.root, path, max, &holders)?;
        let format = Store::inspect(path).map_err(CatalogError::from)?;
        if format.version_status() != StoreVersionStatus::Current
            || !format.missing_column_families().is_empty()
            || !format.unexpected_column_families().is_empty()
        {
            return Err(CatalogError::Storage);
        }
        let store = Store::open_read_only(path).map_err(CatalogError::from)?;
        store.validate().map_err(CatalogError::from)?;
        let format = format_fingerprint(
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

    /// Same contract as `matches_evidence`, but with the bound extra-link allowance.
    fn linked_matches(&self, path: &Path, entry: &Entry) -> Result<bool, CatalogError> {
        if !catalog_fs::exists(path)? {
            return Ok(false);
        }
        match self.verified_linked(path, &entry.uuid) {
            Ok(actual) => Ok(Some(&actual) == entry.evidence.as_ref()),
            Err(CatalogError::CorruptStore | CatalogError::UnsafePath) => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn walk_package(&self, package: &Path, files: usize, bytes: u64) -> Result<(), CatalogError> {
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
                    if depth >= 2 {
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

    fn continue_tombstone(&self, index: usize) -> Result<TombstoneReceipt, CatalogError> {
        self.point(FaultPoint::BeforeBackup)?;
        let entry = self.catalog.borrow().entries[index].clone();
        let record = entry
            .tombstone
            .clone()
            .ok_or(CatalogError::InvalidCatalog)?;
        let source = self.root.path.join("repos").join(&entry.uuid);
        let package = self.package_path(&entry.uuid, record.attempt);
        // Refusals before the source is touched leave TombstoneIntent, unpoisoned.
        if catalog_fs::exists(&package)? {
            return Err(CatalogError::Backup(BackupFailure::InvalidPath));
        }
        // Guard identity, ownership and links before the native open used for backup.
        if !self.linked_matches(&source, &entry)? {
            return Err(CatalogError::NotReady);
        }
        let files = usize::try_from(record.backup_files).map_err(|_| CatalogError::Limit)?;
        let mut options = BackupOptions::default();
        options.control = control(&record);
        options.max_files = NonZeroUsize::new(files).ok_or(CatalogError::Limit)?;
        options.max_bytes = NonZeroU64::new(record.backup_bytes).ok_or(CatalogError::Limit)?;
        let store = Store::open_read_only(&source).map_err(CatalogError::from)?;
        let made = store.backup_with_receipt(&package, &options);
        drop(store);
        let receipt = match made {
            Ok(receipt) => receipt,
            Err(error) => {
                let failure = BackupFailure::from(&error);
                if !failure.definite() {
                    self.poisoned.set(true);
                }
                return Err(CatalogError::Backup(failure));
            }
        };
        self.point(FaultPoint::AfterBackup)?;
        // The receipt comes only from the call above; the package is re-verified from
        // disk and must equal it, be bounded, contributor-free and equal the source.
        self.walk_package(&package, files, record.backup_bytes)?;
        let verified = BackupReceipt::verify(&package, &control(&record))?;
        if verified != receipt {
            return Err(CatalogError::Backup(BackupFailure::FileMismatch));
        }
        check_profile(&verified)?;
        content_matches(&source, &package, &verified, &record)?;
        // The read-only package open must not have changed any packaged byte.
        self.walk_package(&package, files, record.backup_bytes)?;
        if BackupReceipt::verify(&package, &control(&record))? != verified {
            return Err(CatalogError::Backup(BackupFailure::FileMismatch));
        }
        let binding = bind(&verified)?;
        let mut next = self.catalog.borrow().clone();
        next.entries[index].phase = Phase::TombstoneBackedUp;
        next.entries[index]
            .tombstone
            .as_mut()
            .ok_or(CatalogError::InvalidCatalog)?
            .backup = Some(binding);
        self.persist(next, index)?;
        self.point(FaultPoint::AfterBackupRecorded)?;
        self.point(FaultPoint::BeforeMove)?;
        self.move_source(&entry.uuid)?;
        self.seal(index)
    }

    /// Same-device no-replace rename into manager-owned trash, then its syncs.
    /// Any failure poisons: the outcome is uncertain until reopen.
    fn move_source(&self, uuid: &str) -> Result<(), CatalogError> {
        let result = self.try_move(uuid);
        if result.is_err() {
            self.poisoned.set(true);
        }
        result
    }

    /// Errors before `renameat2` returns are refusals: the source did not move. Errors
    /// after it leave the rename's durability unknown.
    fn try_move(&self, uuid: &str) -> Result<(), CatalogError> {
        let source = self.root.path.join("repos").join(uuid);
        let target = self.root.path.join("trash").join(uuid);
        self.root.directory(&source)?;
        self.root.directory(&self.root.path.join("trash"))?;
        if catalog_fs::exists(&target)? {
            return Err(CatalogError::UnsafePath);
        }
        rename_noreplace(&source, &target)?;
        (self.hook)(FaultPoint::AfterMove)?;
        self.sync_move()
    }

    /// Syncs both rename directories and the root before anything may depend on a move
    /// between `repos/` and `trash/`. The hook fires only after every sync returned.
    fn sync_move(&self) -> Result<(), CatalogError> {
        for name in ["repos", "trash"] {
            std::fs::File::open(self.root.path.join(name))?.sync_all()?;
        }
        std::fs::File::open(&self.root.path)?.sync_all()?;
        (self.hook)(FaultPoint::AfterMoveSynced)
    }

    /// The trash evidence must equal the recorded source. The rename preserves the
    /// inode, so the content comparison made before the move (or by restart
    /// verification of trash) still applies.
    fn trash_matches(&self, entry: &Entry) -> Result<(), CatalogError> {
        let trash = self.root.path.join("trash").join(&entry.uuid);
        if self.linked_matches(&trash, entry)? {
            Ok(())
        } else {
            Err(CatalogError::NotReady)
        }
    }

    /// Mints `Tombstoned` only after the trash evidence equals the recorded source.
    fn seal(&self, index: usize) -> Result<TombstoneReceipt, CatalogError> {
        let entry = self.catalog.borrow().entries[index].clone();
        if let Err(error) = self.trash_matches(&entry) {
            self.poisoned.set(true);
            return Err(error);
        }
        self.persist_sealed(index)?;
        let catalog = self.catalog.borrow();
        let entry = &catalog.entries[index];
        let record = entry
            .tombstone
            .as_ref()
            .ok_or(CatalogError::InvalidCatalog)?;
        let binding = record.backup.as_ref().ok_or(CatalogError::InvalidCatalog)?;
        Ok(TombstoneReceipt {
            id: RepositoryId::parse(&entry.id).map_err(|_| CatalogError::InvalidCatalog)?,
            generation: entry.changed_at,
            deadline: record.deadline,
            fingerprint: parse_hex32(&binding.fingerprint).ok_or(CatalogError::InvalidCatalog)?,
        })
    }

    /// Persists `Tombstoned`. A failed attempted write poisons (inside `persist`); a
    /// write refused before it started leaves the manager unpoisoned.
    fn persist_sealed(&self, index: usize) -> Result<(), CatalogError> {
        let mut next = self.catalog.borrow().clone();
        next.entries[index].phase = Phase::Tombstoned;
        self.persist(next, index)?;
        self.point(FaultPoint::AfterTombstoned)
    }

    /// Walks the recorded package tree, verifies its manifest and requires the exact
    /// recorded binding and supported profile. Opens no store.
    fn verify_binding(&self, entry: &Entry) -> Result<BackupReceipt, CatalogError> {
        let record = entry
            .tombstone
            .as_ref()
            .ok_or(CatalogError::InvalidCatalog)?;
        let binding = record.backup.as_ref().ok_or(CatalogError::InvalidCatalog)?;
        let package = self.package_path(&entry.uuid, record.attempt);
        let files = usize::try_from(record.backup_files).map_err(|_| CatalogError::Limit)?;
        self.walk_package(&package, files, record.backup_bytes)?;
        let receipt = BackupReceipt::verify(&package, &control(record))?;
        let actual = bind(&receipt)?;
        if actual != *binding {
            return Err(CatalogError::Backup(BackupFailure::FileMismatch));
        }
        check_profile(&receipt)?;
        Ok(receipt)
    }

    /// Guard first: no native open of `path` happens unless its directory identity,
    /// ownership, mode, regular files and links all pass. Then the package binding,
    /// the exact content comparison and a second package verification.
    fn verify_all(&self, entry: &Entry, path: &Path) -> Result<(), CatalogError> {
        if !self.linked_matches(path, entry)? {
            return Err(CatalogError::NotReady);
        }
        let receipt = self.verify_binding(entry)?;
        let record = entry
            .tombstone
            .as_ref()
            .ok_or(CatalogError::InvalidCatalog)?;
        let package = self.package_path(&entry.uuid, record.attempt);
        content_matches(path, &package, &receipt, record)?;
        if self.verify_binding(entry)? != receipt {
            return Err(CatalogError::Backup(BackupFailure::FileMismatch));
        }
        Ok(())
    }

    /// Restart completion of a recorded backup. Proceeds only when exactly one of source
    /// and trash exists and the guarded directory, the exact recorded package and their
    /// content equality all verify. A remaining source is moved; either way `repos/`,
    /// `trash/` and the root are synced before `Tombstoned` is persisted, because a crash
    /// may have happened between an earlier rename and its sync.
    ///
    /// Every failure before the catalog write is repository-local and leaves the entry
    /// unchanged, non-ready and unpoisoned: a refusal before the rename (nothing moved),
    /// a failure after it whose durability is unknown (such as a failed sync), a refused
    /// trash check, or a catalog write refused before it started. Nothing was persisted,
    /// so the in-memory catalog still equals the durable one and the next restart
    /// re-derives source and trash state and repeats the syncs. Only an attempted
    /// `Tombstoned` write that fails propagates, poisoned, since the rename may be
    /// durable while the catalog outcome is unknown.
    pub(super) fn reconcile_backed_up(&self, index: usize) -> Result<(), CatalogError> {
        let entry = self.catalog.borrow().entries[index].clone();
        let source = self.root.path.join("repos").join(&entry.uuid);
        let trash = self.root.path.join("trash").join(&entry.uuid);
        let (Ok(in_source), Ok(in_trash)) =
            (catalog_fs::exists(&source), catalog_fs::exists(&trash))
        else {
            return Ok(());
        };
        if in_source == in_trash {
            return Ok(());
        }
        let path = if in_source { &source } else { &trash };
        if self.verify_all(&entry, path).is_err() {
            return Ok(());
        }
        let settled = if in_source {
            (self.hook)(FaultPoint::BeforeMove).and_then(|()| self.try_move(&entry.uuid))
        } else {
            self.sync_move()
        };
        if settled.and_then(|()| self.trash_matches(&entry)).is_err() {
            return Ok(());
        }
        match self.persist_sealed(index) {
            Ok(()) => Ok(()),
            // A write refused before it started changed nothing.
            Err(_) if !self.poisoned.get() => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// Unrecorded packages and unknown trash entries (bounded), never adopted. A trash
    /// entry of a `TombstoneBackedUp` repository is owned only once its source has left
    /// `repos/`; while both exist the trash entry is reported.
    pub(super) fn tombstone_inventory(&self) -> Result<Vec<PathBuf>, CatalogError> {
        let (cap, packages, trash) = {
            let catalog = self.catalog.borrow();
            let mut packages = std::collections::BTreeSet::new();
            let mut trash = std::collections::BTreeSet::new();
            for entry in &catalog.entries {
                if let (Phase::TombstoneBackedUp | Phase::Tombstoned, Some(record)) =
                    (entry.phase, &entry.tombstone)
                {
                    packages.insert(self.package_path(&entry.uuid, record.attempt));
                    let source = self.root.path.join("repos").join(&entry.uuid);
                    if entry.phase == Phase::Tombstoned || !catalog_fs::exists(&source)? {
                        trash.insert(self.root.path.join("trash").join(&entry.uuid));
                    }
                }
            }
            (catalog.limits.scan_entries, packages, trash)
        };
        let mut found = Vec::new();
        for (name, known) in [("backups", &packages), ("trash", &trash)] {
            let dir = self.root.path.join(name);
            if !catalog_fs::exists(&dir)? {
                continue;
            }
            self.root.directory(&dir)?;
            for (count, item) in std::fs::read_dir(&dir)?.enumerate() {
                if count >= cap {
                    return Err(CatalogError::Limit);
                }
                let path = item?.path();
                if !known.contains(&path) {
                    found.push(path);
                }
            }
        }
        found.sort();
        Ok(found)
    }
}

#[cfg(test)]
mod tests {
    use super::check_profile;
    use crate::catalog::CatalogError;
    use oxigraph::store::{
        BackupArtifact, BackupContribution, BackupOptions, ContributorCheckpoint,
        ContributorConsistency, ContributorDeclaration, ContributorHealth, ContributorIdentity,
        ContributorObservation, ContributorRegistry, Store, TransactionKey, TransactionRequest,
    };
    use sha2::{Digest, Sha256};
    use std::num::NonZeroU32;

    /// Exercises the defensive invariant function only. The manager never creates a
    /// contributor package, so this is not evidence about manager behavior.
    #[test]
    fn contributor_profiles_are_refused_not_omitted() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let commit = source
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([1; 16]),
            )?
            .into_transaction()
            .commit()?;
        let identity = ContributorIdentity::new([1; 16], NonZeroU32::MIN);
        let point = ContributorCheckpoint::new(commit)?;
        let artifact = directory.path().join("index");
        std::fs::write(&artifact, b"index")?;
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
        let mut options = BackupOptions::default();
        options.contributors = ContributorRegistry::new(vec![ContributorDeclaration::new(
            identity,
            true,
            ContributorConsistency::Strict,
            false,
        )])?;
        options.contributions = vec![contribution];
        let with = source.backup_with_receipt(directory.path().join("with"), &options)?;
        assert_eq!(
            check_profile(&with).unwrap_err(),
            CatalogError::UnsupportedProfile
        );
        let without = source
            .backup_with_receipt(directory.path().join("without"), &BackupOptions::default())?;
        check_profile(&without).unwrap();
        Ok(())
    }
}
