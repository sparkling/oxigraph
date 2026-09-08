//! Fresh-directory restore and scoped recovery observations (ADR-0022).
use super::backup::{
    MAX_MANIFEST, check, check_directory, copy_artifact, fresh_destination, open_regular,
    provider_name, read_inventory, sync_directories, sync_directory,
};
use super::receipt::envelope_checksum;
use super::{
    BackupArtifact, BackupCheckpoint, BackupContents, BackupError, BackupReceipt,
    CommitReceiptOutcome, ContributorDeclaration, ContributorError, ContributorIdentity,
    ContributorObservation, ContributorRegistry, GovernanceError, GovernanceTime, OutboxCoverage,
    OutboxCursor, OutboxReadError, StorageError, Store, TransactionKey, TransactionStartControl,
};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::num::{NonZeroU64, NonZeroUsize};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

const SOURCE: &str = "oxigraph-backup.source";
const COMPLETE: &str = "oxigraph-restore.complete";
const PENDING: &str = "oxigraph-restore.pending";
const MAGIC: &[u8] = b"oxigraph.restore.v1\0";
const MAX_RECEIPT: u64 = 512;

/// An immutable, artifact-bound baseline for a local recovery drill. Limits apply
/// only to checkpoint age at the supplied reference and restoration through
/// validated, synchronized files (before recording the result). They are not
/// actual lost-change measurements or full-service availability objectives.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryBaseline {
    backup_fingerprint: [u8; 32],
    reference: GovernanceTime,
    max_checkpoint_age_ms: u64,
    max_restore_duration_ns: u64,
}
impl RecoveryBaseline {
    pub fn new(
        backup: &BackupReceipt,
        reference: GovernanceTime,
        max_checkpoint_age: Duration,
        max_restore_duration: Duration,
    ) -> Result<Self, RestoreError> {
        let value = Self {
            backup_fingerprint: backup.fingerprint(),
            reference,
            max_checkpoint_age_ms: max_checkpoint_age
                .as_millis()
                .try_into()
                .map_err(|_| RestoreError::Limit)?,
            max_restore_duration_ns: max_restore_duration
                .as_nanos()
                .try_into()
                .map_err(|_| RestoreError::Limit)?,
        };
        value.check_point(backup)?;
        Ok(value)
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        envelope_checksum(b"oxigraph.recovery.baseline.v1\0", &self.to_bytes())
    }
    pub const fn reference(&self) -> GovernanceTime {
        self.reference
    }
    pub fn max_checkpoint_age(&self) -> Duration {
        Duration::from_millis(self.max_checkpoint_age_ms)
    }
    pub fn max_restore_duration(&self) -> Duration {
        Duration::from_nanos(self.max_restore_duration_ns)
    }
    fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = self.backup_fingerprint.to_vec();
        bytes.extend_from_slice(&self.reference.as_unix_millis().to_be_bytes());
        bytes.extend_from_slice(&self.max_checkpoint_age_ms.to_be_bytes());
        bytes.extend_from_slice(&self.max_restore_duration_ns.to_be_bytes());
        bytes
    }
    fn check_point(&self, backup: &BackupReceipt) -> Result<(), RestoreError> {
        if self.backup_fingerprint != backup.fingerprint() {
            return Err(RestoreError::BackupMismatch);
        }
        let (_, age) = point_age(backup, self.reference)?;
        if age > self.max_checkpoint_age_ms {
            return Err(RestoreError::RecoveryPointTooOld {
                age_ms: age,
                maximum_ms: self.max_checkpoint_age_ms,
            });
        }
        Ok(())
    }
}

/// Trusted provider-specific semantic reconciliation. Implementations inspect
/// their copied files and return the observed source/applied/health state.
/// Expected observations are deliberately not supplied. The core independently
/// checks exact inventory equality and rehashes files after all callbacks.
/// Callbacks must be read-only, honor cancellation, and release every handle
/// before returning. File checksums cannot prove a callback's semantic honesty.
pub trait RestoreContributor: Send + Sync {
    fn identity(&self) -> ContributorIdentity;
    fn reconcile(
        &self,
        declaration: &ContributorDeclaration,
        directory: &Path,
        primary: &RestorePrimary<'_>,
        control: &TransactionStartControl,
    ) -> Result<ContributorObservation, StorageError>;
}

/// Borrowed primary facts and native receipt lookup, without handing an adapter
/// a clonable database handle that could survive the restore handoff.
pub struct RestorePrimary<'a> {
    store: &'a Store,
    checkpoint: &'a BackupCheckpoint,
    contents: &'a BackupContents,
}
impl RestorePrimary<'_> {
    pub const fn checkpoint(&self) -> &BackupCheckpoint {
        self.checkpoint
    }
    pub const fn contents(&self) -> &BackupContents {
        self.contents
    }
    pub fn lookup_commit_receipt(
        &self,
        key: &TransactionKey,
    ) -> Result<CommitReceiptOutcome, StorageError> {
        self.store.lookup_commit_receipt(key)
    }
}

#[derive(Clone)]
pub struct RestoreOptions {
    /// Must exactly equal the backup's canonical declarations, including absences.
    pub contributors: ContributorRegistry,
    /// Exactly one adapter for each present provider; none for absent fallbacks.
    pub reconcilers: Vec<Arc<dyn RestoreContributor>>,
    pub control: TransactionStartControl,
    pub expected_backup_fingerprint: Option<[u8; 32]>,
    /// No implicit production baseline or recovery objectives.
    pub baseline: Option<RecoveryBaseline>,
    pub max_files: NonZeroUsize,
    pub max_bytes: NonZeroU64,
}
impl Default for RestoreOptions {
    fn default() -> Self {
        Self {
            contributors: ContributorRegistry::default(),
            reconcilers: Vec::new(),
            control: TransactionStartControl::new(),
            expected_backup_fingerprint: None,
            baseline: None,
            max_files: NonZeroUsize::new(100_000).unwrap_or(NonZeroUsize::MIN),
            max_bytes: NonZeroU64::MAX,
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum RestoreError {
    #[error(transparent)]
    Backup(#[from] BackupError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Governance(#[from] GovernanceError),
    #[error(transparent)]
    Outbox(#[from] OutboxReadError),
    #[error(transparent)]
    Contributor(#[from] ContributorError),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("backup differs from the expected artifact or frozen baseline")]
    BackupMismatch,
    #[error("restore contributor declarations differ from the backup inventory")]
    ContributorPolicyMismatch,
    #[error("restore requires a reconciliation adapter for each present contributor")]
    MissingReconciler,
    #[error("provider {identity:?} reconciliation failed: {source}")]
    Reconciliation {
        identity: ContributorIdentity,
        source: StorageError,
    },
    #[error(
        "restored checkpoint, content, outbox or contributor inventory differs from the backup"
    )]
    StateMismatch,
    #[error("restore file, byte, adapter or time representation limit exceeded")]
    Limit,
    #[error("recovery reference precedes the checkpoint observation interval")]
    InvalidReference,
    #[error("checkpoint age upper bound {age_ms}ms exceeds baseline {maximum_ms}ms")]
    RecoveryPointTooOld { age_ms: u64, maximum_ms: u64 },
    #[error(
        "restore-to-validation duration exceeds the explicit baseline; no completion marker published"
    )]
    RestoreDurationExceeded { observation: Box<RestoreReceipt> },
    #[error("restore receipt is incomplete, malformed or inconsistent")]
    InvalidReceipt,
    #[error("restore completion was published but final synchronization failed: {0}")]
    CompletionIndeterminate(io::Error),
}

/// Point-in-time validated restore, not evidence about later writes or serving.
/// The usable database is in `directory/store`, not the package root.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RestoreReceipt {
    backup: BackupReceipt,
    started: GovernanceTime,
    validated: GovernanceTime,
    duration_ns: u64,
    reference: GovernanceTime,
    outbox_records: u64,
    baseline: Option<RecoveryBaseline>,
}
impl RestoreReceipt {
    pub const fn backup(&self) -> &BackupReceipt {
        &self.backup
    }
    pub const fn started(&self) -> GovernanceTime {
        self.started
    }
    pub const fn validated(&self) -> GovernanceTime {
        self.validated
    }
    /// Excludes writing this observation's completion marker, not copying/syncing data.
    pub fn restore_duration(&self) -> Duration {
        Duration::from_nanos(self.duration_ns)
    }
    pub const fn reference(&self) -> GovernanceTime {
        self.reference
    }
    /// Inclusive checkpoint-age bounds; not measured lost transactions.
    pub fn checkpoint_age_range(&self) -> (Duration, Duration) {
        let (low, high) = point_age(&self.backup, self.reference).unwrap_or((0, 0));
        (Duration::from_millis(low), Duration::from_millis(high))
    }
    pub const fn validated_outbox_records(&self) -> u64 {
        self.outbox_records
    }
    pub const fn baseline(&self) -> Option<&RecoveryBaseline> {
        self.baseline.as_ref()
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

    /// Reads and checks the original completion record. It does NOT revalidate
    /// a database which may subsequently have been opened writable or changed.
    pub fn read(directory: impl AsRef<Path>) -> Result<Self, RestoreError> {
        let directory = directory.as_ref();
        check_directory(directory)?;
        if fs::symlink_metadata(directory.join(BackupReceipt::manifest_name())).is_ok()
            || fs::symlink_metadata(directory.join(PENDING)).is_ok()
        {
            return Err(RestoreError::InvalidReceipt);
        }
        let backup =
            BackupReceipt::decode(&read_bounded(&directory.join(SOURCE), MAX_MANIFEST as u64)?)?;
        Self::decode(
            &read_bounded(&directory.join(COMPLETE), MAX_RECEIPT)?,
            backup,
        )
    }
    fn encode(&self) -> Vec<u8> {
        let mut bytes = MAGIC.to_vec();
        bytes.extend_from_slice(&self.backup.fingerprint());
        for value in [
            self.started.as_unix_millis(),
            self.validated.as_unix_millis(),
            self.duration_ns,
            self.reference.as_unix_millis(),
            self.outbox_records,
        ] {
            bytes.extend_from_slice(&value.to_be_bytes());
        }
        bytes.push(u8::from(self.baseline.is_some()));
        if let Some(baseline) = &self.baseline {
            bytes.extend_from_slice(&baseline.to_bytes());
        }
        bytes.extend_from_slice(&envelope_checksum(MAGIC, &bytes));
        bytes
    }
    fn decode(bytes: &[u8], backup: BackupReceipt) -> Result<Self, RestoreError> {
        let (body, checksum) = bytes
            .split_at_checked(
                bytes
                    .len()
                    .checked_sub(32)
                    .ok_or(RestoreError::InvalidReceipt)?,
            )
            .ok_or(RestoreError::InvalidReceipt)?;
        if envelope_checksum(MAGIC, body).as_slice() != checksum {
            return Err(RestoreError::InvalidReceipt);
        }
        let mut input = body
            .strip_prefix(MAGIC)
            .ok_or(RestoreError::InvalidReceipt)?;
        if take::<32>(&mut input)? != backup.fingerprint() {
            return Err(RestoreError::BackupMismatch);
        }
        let started = GovernanceTime::from_unix_millis(u64::from_be_bytes(take(&mut input)?));
        let validated = GovernanceTime::from_unix_millis(u64::from_be_bytes(take(&mut input)?));
        let duration_ns = u64::from_be_bytes(take(&mut input)?);
        let reference = GovernanceTime::from_unix_millis(u64::from_be_bytes(take(&mut input)?));
        let outbox_records = u64::from_be_bytes(take(&mut input)?);
        let baseline = match take::<1>(&mut input)? {
            [0] => None,
            [1] => Some(RecoveryBaseline {
                backup_fingerprint: take(&mut input)?,
                reference: GovernanceTime::from_unix_millis(u64::from_be_bytes(take(&mut input)?)),
                max_checkpoint_age_ms: u64::from_be_bytes(take(&mut input)?),
                max_restore_duration_ns: u64::from_be_bytes(take(&mut input)?),
            }),
            _ => return Err(RestoreError::InvalidReceipt),
        };
        let receipt = Self {
            backup,
            started,
            validated,
            duration_ns,
            reference,
            outbox_records,
            baseline,
        };
        receipt.validate()?;
        if !input.is_empty() || receipt.encode() != bytes {
            return Err(RestoreError::InvalidReceipt);
        }
        Ok(receipt)
    }
    fn validate(&self) -> Result<(), RestoreError> {
        point_age(&self.backup, self.reference)?;
        if self.started > self.validated {
            return Err(GovernanceError::ClockRegressed.into());
        }
        let checkpoint = self.backup.checkpoint();
        let count = checkpoint
            .outbox_high_water()
            .map_or(0, OutboxCursor::position)
            - checkpoint
                .retained_after()
                .map_or(0, OutboxCursor::position);
        if self.outbox_records != count {
            return Err(RestoreError::StateMismatch);
        }
        if let Some(baseline) = &self.baseline {
            baseline.check_point(&self.backup)?;
            if self.reference != baseline.reference
                || self.duration_ns > baseline.max_restore_duration_ns
            {
                return Err(RestoreError::InvalidReceipt);
            }
        }
        Ok(())
    }
}

#[expect(clippy::multiple_inherent_impl, reason = "additive native restore API")]
impl Store {
    /// Restore a receipt-bearing package into a fresh, exclusively owned root.
    /// Returns only after storage/outbox/contributors reconcile and a completion
    /// record is synchronized. Use `Store::open(root.join("store"))` afterward.
    /// The immutable source is never opened as a database or modified. Failures
    /// retain the incomplete target; this method never overwrites or resumes it.
    pub fn restore_backup(
        backup: impl AsRef<Path>,
        destination: impl AsRef<Path>,
        options: &RestoreOptions,
    ) -> Result<RestoreReceipt, RestoreError> {
        restore_inner(backup.as_ref(), destination.as_ref(), options, |_| Ok(()))
    }
}

#[expect(
    clippy::create_dir,
    reason = "fresh restore directories must reject existing paths"
)]
fn restore_inner(
    source: &Path,
    destination: &Path,
    options: &RestoreOptions,
    mut phase: impl FnMut(u8) -> Result<(), RestoreError>,
) -> Result<RestoreReceipt, RestoreError> {
    let clock = Instant::now();
    check(&options.control, clock)?;
    if !cfg!(unix) {
        return Err(BackupError::UnsupportedPlatform.into());
    }
    let started = GovernanceTime::now()?;
    let backup = BackupReceipt::verify(source, &options.control)?;
    check(&options.control, clock)?;
    if options
        .expected_backup_fingerprint
        .is_some_and(|fingerprint| fingerprint != backup.fingerprint())
    {
        return Err(RestoreError::BackupMismatch);
    }
    if options.reconcilers.len() > 128 || backup.files().len() > options.max_files.get() {
        return Err(RestoreError::Limit);
    }
    let mut total = 0_u64;
    for file in backup.files() {
        total = total
            .checked_add(file.size())
            .filter(|size| *size <= options.max_bytes.get())
            .ok_or(RestoreError::Limit)?;
    }
    let reference = options
        .baseline
        .as_ref()
        .map_or(started, RecoveryBaseline::reference);
    point_age(&backup, reference)?;
    if let Some(baseline) = &options.baseline {
        baseline.check_point(&backup)?;
    }
    let (registry, expected) = read_inventory(backup.contributor_inventory())?;
    if registry.declarations() != options.contributors.declarations() {
        return Err(RestoreError::ContributorPolicyMismatch);
    }
    let mut adapters = BTreeMap::new();
    for adapter in &options.reconcilers {
        let id = adapter.identity();
        if adapters.insert(id, adapter).is_some() {
            return Err(ContributorError::Duplicate.into());
        }
        if !expected.iter().any(|value| value.identity() == id) {
            return Err(ContributorError::Unknown.into());
        }
    }
    if adapters.len() != expected.len() {
        return Err(RestoreError::MissingReconciler);
    }
    check_directory(source)?;
    let source = source.canonicalize()?;
    let destination = fresh_destination(destination, &source)?;
    phase(0)?;
    fs::create_dir(&destination)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o700))?;
    }
    fs::create_dir(destination.join("store"))?;
    fs::create_dir(destination.join("contributors"))?;
    for (identity, _) in backup.contributions() {
        fs::create_dir(
            destination
                .join("contributors")
                .join(provider_name(*identity)),
        )?;
    }
    phase(1)?;
    for file in backup.files() {
        check(&options.control, clock)?;
        copy_artifact(
            &BackupArtifact::new(
                "copy".into(),
                source.join(file.path()),
                file.size(),
                *file.sha256(),
            )?,
            &destination.join(file.path()),
            &options.control,
            clock,
        )?;
    }
    write_new(
        &destination.join(BackupReceipt::manifest_name()),
        &backup.encode(),
    )?;
    phase(2)?;
    if BackupReceipt::verify(&destination, &options.control)? != backup {
        return Err(RestoreError::BackupMismatch);
    }
    check(&options.control, clock)?;
    let primary = Store::open_read_only(destination.join("store"))?;
    phase(3)?;
    primary.validate()?;
    check(&options.control, clock)?;
    let (checkpoint, health) = primary.backup_checkpoint()?;
    if &checkpoint != backup.checkpoint()
        || &primary.backup_contents(&options.control, clock)? != backup.contents()
    {
        return Err(RestoreError::StateMismatch);
    }
    let mut after = None;
    let mut outbox_records = 0_u64;
    loop {
        check(&options.control, clock)?;
        let batch = primary.read_outbox(
            after.as_ref(),
            NonZeroUsize::new(256).unwrap_or(NonZeroUsize::MIN),
        )?;
        if batch.high_water() != checkpoint.outbox_high_water()
            || batch.latest_receipt() != checkpoint.latest_receipt()
            || batch.retained_after() != checkpoint.retained_after()
            || batch.coverage().map(OutboxCoverage::after_receipt_sequence)
                != checkpoint.outbox_after_receipt_sequence()
        {
            return Err(RestoreError::StateMismatch);
        }
        outbox_records = outbox_records
            .checked_add(batch.records().len() as u64)
            .ok_or(RestoreError::Limit)?;
        if batch.next_cursor() == batch.high_water() {
            break;
        }
        if batch.records().is_empty() || batch.next_cursor() == after.as_ref() {
            return Err(RestoreError::StateMismatch);
        }
        after = batch.next_cursor().cloned();
    }
    let mut observed = Vec::with_capacity(expected.len());
    for observation in &expected {
        check(&options.control, clock)?;
        let id = observation.identity();
        let declaration = registry
            .declarations()
            .iter()
            .find(|value| value.identity() == id)
            .ok_or(ContributorError::Unknown)?;
        let adapter = adapters.get(&id).ok_or(RestoreError::MissingReconciler)?;
        let view = RestorePrimary {
            store: &primary,
            checkpoint: &checkpoint,
            contents: backup.contents(),
        };
        let value = adapter
            .reconcile(
                declaration,
                &destination.join("contributors").join(provider_name(id)),
                &view,
                &options.control,
            )
            .map_err(|source| RestoreError::Reconciliation {
                identity: id,
                source,
            })?;
        if value.identity() != id {
            return Err(ContributorError::Unknown.into());
        }
        observed.push(value);
    }
    let inventory = registry.evaluate(&primary, &health, &observed, || {
        check(&options.control, clock).is_ok()
    })?;
    if inventory.to_bytes() != backup.contributor_inventory() {
        return Err(RestoreError::StateMismatch);
    }
    drop(primary);
    phase(4)?;
    if BackupReceipt::verify(&destination, &options.control)? != backup {
        return Err(RestoreError::BackupMismatch);
    }
    fs::rename(
        destination.join(BackupReceipt::manifest_name()),
        destination.join(SOURCE),
    )?;
    sync_directories(&destination)?;
    phase(5)?;
    check(&options.control, clock)?;
    let receipt = RestoreReceipt {
        backup,
        started,
        validated: GovernanceTime::now()?,
        duration_ns: clock
            .elapsed()
            .as_nanos()
            .try_into()
            .map_err(|_| RestoreError::Limit)?,
        reference,
        outbox_records,
        baseline: options.baseline.clone(),
    };
    if receipt
        .baseline
        .as_ref()
        .is_some_and(|baseline| receipt.duration_ns > baseline.max_restore_duration_ns)
    {
        return Err(RestoreError::RestoreDurationExceeded {
            observation: Box::new(receipt),
        });
    }
    receipt.validate()?;
    write_new(&destination.join(PENDING), &receipt.encode())?;
    sync_directory(&destination)?;
    phase(6)?;
    check(&options.control, clock)?;
    fs::rename(destination.join(PENDING), destination.join(COMPLETE))?;
    phase(7).map_err(|error| RestoreError::CompletionIndeterminate(io::Error::other(error)))?;
    sync_directory(&destination).map_err(RestoreError::CompletionIndeterminate)?;
    Ok(receipt)
}

fn point_age(
    backup: &BackupReceipt,
    reference: GovernanceTime,
) -> Result<(u64, u64), RestoreError> {
    let low = reference
        .as_unix_millis()
        .checked_sub(backup.source_end().time().as_unix_millis())
        .ok_or(RestoreError::InvalidReference)?;
    let high = reference
        .as_unix_millis()
        .checked_sub(backup.source_start().time().as_unix_millis())
        .ok_or(RestoreError::InvalidReference)?;
    Ok((low, high))
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), RestoreError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, RestoreError> {
    let mut bytes = Vec::new();
    open_regular(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(RestoreError::Limit);
    }
    Ok(bytes)
}
fn take<const N: usize>(bytes: &mut &[u8]) -> Result<[u8; N], RestoreError> {
    let (head, tail) = bytes
        .split_at_checked(N)
        .ok_or(RestoreError::InvalidReceipt)?;
    *bytes = tail;
    head.try_into().map_err(|_| RestoreError::InvalidReceipt)
}

#[cfg(all(test, unix))]
#[expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    reason = "isolated restore failure fixtures"
)]
mod tests {
    use super::*;
    use crate::model::{GraphName, NamedNode, Quad};
    use crate::store::BackupOptions;
    type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

    #[test]
    fn interruption_at_every_prepublication_phase_has_no_restore_completion() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let package = directory.path().join("backup");
        let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
        for stop in 0..7 {
            let target = directory.path().join(format!("phase{stop}"));
            let result = restore_inner(&package, &target, &RestoreOptions::default(), |phase| {
                if phase == stop {
                    Err(BackupError::Cancelled.into())
                } else {
                    Ok(())
                }
            });
            assert!(matches!(
                result,
                Err(RestoreError::Backup(BackupError::Cancelled))
            ));
            assert!(!target.join(COMPLETE).exists());
            RestoreReceipt::read(&target)
                .err()
                .ok_or("incomplete restore accepted")?;
            assert_eq!(
                BackupReceipt::verify(&package, &TransactionStartControl::new())?,
                backup
            );
        }
        Ok(())
    }

    #[test]
    fn postpublication_sync_failure_is_indeterminate_and_never_overwritten() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let package = directory.path().join("backup");
        source.backup_with_receipt(&package, &BackupOptions::default())?;
        let target = directory.path().join("restore");
        let result = restore_inner(&package, &target, &RestoreOptions::default(), |phase| {
            if phase == 7 {
                Err(io::Error::other("injected sync failure").into())
            } else {
                Ok(())
            }
        });
        assert!(matches!(
            result,
            Err(RestoreError::CompletionIndeterminate(_))
        ));
        let receipt = RestoreReceipt::read(&target)?;
        Store::restore_backup(&package, &target, &RestoreOptions::default())
            .err()
            .ok_or("existing restore overwritten")?;
        assert_eq!(RestoreReceipt::read(&target)?, receipt);
        Ok(())
    }

    #[test]
    fn copied_file_drift_is_rejected_before_open_and_after_reconciliation() -> TestResult {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let node = NamedNode::new_unchecked("urn:restore");
        source.insert(Quad::new(
            node.clone(),
            node.clone(),
            node,
            GraphName::DefaultGraph,
        ))?;
        let package = directory.path().join("backup");
        let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
        for stop in [2, 4] {
            let target = directory.path().join(format!("phase{stop}"));
            let mut opened = false;
            let result = restore_inner(&package, &target, &RestoreOptions::default(), |phase| {
                if phase == 3 {
                    opened = true;
                }
                if phase == stop {
                    fs::write(target.join("store/CURRENT"), b"changed")?;
                }
                Ok(())
            });
            result.err().ok_or("altered copy accepted")?;
            assert_eq!(opened, stop == 4);
            assert!(!target.join(COMPLETE).exists());
        }
        assert_eq!(
            BackupReceipt::verify(&package, &TransactionStartControl::new())?,
            backup
        );
        Ok(())
    }

    #[test]
    fn restore_receipt_rejects_corruption_truncation_and_recomputed_incoherent_fields() -> TestResult
    {
        let directory = tempfile::tempdir()?;
        let source = Store::open(directory.path().join("source"))?;
        let package = directory.path().join("backup");
        source.backup_with_receipt(&package, &BackupOptions::default())?;
        let target = directory.path().join("restore");
        let receipt = Store::restore_backup(&package, &target, &RestoreOptions::default())?;
        let bytes = receipt.encode();
        for length in [0, 1, bytes.len() - 1] {
            RestoreReceipt::decode(&bytes[..length], receipt.backup.clone())
                .err()
                .ok_or("truncation accepted")?;
        }
        for mode in 0..3 {
            let mut changed = receipt.clone();
            match mode {
                0 => changed.outbox_records = 1,
                1 => changed.reference = GovernanceTime::from_unix_millis(0),
                _ => changed.validated = GovernanceTime::from_unix_millis(0),
            }
            RestoreReceipt::decode(&changed.encode(), receipt.backup.clone())
                .err()
                .ok_or("incoherent receipt accepted")?;
        }
        fs::write(target.join(COMPLETE), b"bad")?;
        RestoreReceipt::read(target)
            .err()
            .ok_or("corrupt receipt accepted")?;
        Ok(())
    }
}
