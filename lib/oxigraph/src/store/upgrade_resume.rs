//! Verified restartable construction of an inactive legacy upgrade.
use super::super::{COMPLETE, GUARD, JOURNAL, UPGRADE_GUARD, encode, journal};
use super::*;
use crate::storage::LegacyStoreSnapshot;
use std::collections::BTreeSet;

const RECOVERY_JOURNAL: &str = "oxigraph-upgrade-recovery.journal";
const RECOVERY_MAGIC: &[u8] = b"oxigraph.upgrade-recovery.v1\0";
const CHECKPOINT: u8 = 0;
const FINAL: u8 = 1;
const MAX_ATTEMPTS: usize = 64;

/// Finite cooperative limits for restartable inactive upgrade construction.
///
/// max_attempts includes the initial checkpoint, every failed/incomplete attempt,
/// both successful edge attempts, and the final-output attempt. The persisted RDF
/// feature and content/attempt limits must match on resume; a fresh control and
/// native StoreOptions may be supplied for the restarted call.
#[derive(Clone)]
pub struct UpgradeRecoveryOptions {
    pub transform: UpgradeTransformOptions,
    pub max_attempts: NonZeroUsize,
}

impl Default for UpgradeRecoveryOptions {
    fn default() -> Self {
        Self {
            transform: UpgradeTransformOptions::default(),
            max_attempts: NonZeroUsize::new(16).unwrap_or(NonZeroUsize::MIN),
        }
    }
}

/// A verified observation of restartable, inactive upgrade construction.
///
/// This is not an UpgradeReceipt or activation permission. completed() is true
/// only when a standard TransformedUpgrade representation has been durably
/// published. verify() independently rereads that representation and all inputs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeRecovery {
    directory: PathBuf,
    receipt: LegacyBackupReceipt,
    storage_version: u64,
    attempts: usize,
    logical: [u8; 32],
    counts: [u64; 3],
    transformed: Option<TransformedUpgrade>,
}

impl UpgradeRecovery {
    pub const fn journal_name() -> &'static str {
        RECOVERY_JOURNAL
    }

    pub const fn attempts_directory() -> &'static str {
        "attempts"
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn legacy_backup(&self) -> &LegacyBackupReceipt {
        &self.receipt
    }

    pub const fn storage_version(&self) -> u64 {
        self.storage_version
    }

    pub const fn attempt_count(&self) -> usize {
        self.attempts
    }

    pub const fn logical_fingerprint(&self) -> [u8; 32] {
        self.logical
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

    pub const fn completed(&self) -> bool {
        self.transformed.is_some()
    }

    pub const fn transformed(&self) -> Option<&TransformedUpgrade> {
        self.transformed.as_ref()
    }

    /// Independently verifies the complete record chain, every published
    /// checkpoint, exact external ancestry, and any completed standard output.
    pub fn verify(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &UpgradeRecoveryOptions,
    ) -> Result<Self, BackupError> {
        verify_recovery(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            directory.as_ref(),
            options,
            Instant::now(),
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Limits {
    rdf12: bool,
    max_files: u64,
    max_bytes: u64,
    max_entries: u64,
    max_projection_bytes: u64,
    max_attempts: u64,
}

impl Limits {
    fn new(options: &UpgradeRecoveryOptions, started: Instant) -> Result<Self, BackupError> {
        check_options(&options.transform.backup, started)?;
        if options.max_attempts.get() > MAX_ATTEMPTS {
            return Err(BackupError::Limit);
        }
        Ok(Self {
            rdf12: cfg!(feature = "rdf-12"),
            max_files: options.transform.backup.max_files.get() as u64,
            max_bytes: options.transform.backup.max_bytes.get(),
            max_entries: options.transform.max_entries.get() as u64,
            max_projection_bytes: options.transform.max_projection_bytes.get(),
            max_attempts: options.max_attempts.get() as u64,
        })
    }

    fn encode(&self, out: &mut Vec<u8>) {
        out.push(u8::from(self.rdf12));
        for value in [
            self.max_files,
            self.max_bytes,
            self.max_entries,
            self.max_projection_bytes,
            self.max_attempts,
        ] {
            out.extend_from_slice(&value.to_be_bytes());
        }
    }

    fn decode(d: &mut Decode<'_>) -> Result<Self, BackupError> {
        let rdf12 = match d.take(1)? {
            [0] => false,
            [1] => true,
            _ => return Err(BackupError::InvalidManifest),
        };
        Ok(Self {
            rdf12,
            max_files: d.u64()?,
            max_bytes: d.u64()?,
            max_entries: d.u64()?,
            max_projection_bytes: d.u64()?,
            max_attempts: d.u64()?,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Record {
    kind: u8,
    attempt: u64,
    from: u64,
    to: u64,
    receipt: [u8; 32],
    logical: [u8; 32],
    counts: [u64; 3],
    limits: Limits,
    files: Vec<BackupFile>,
    transformed: [u8; 32],
    previous: [u8; 32],
}

impl Record {
    fn encode(&self) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.push(self.kind);
        payload.extend_from_slice(&self.attempt.to_be_bytes());
        payload.extend_from_slice(&self.from.to_be_bytes());
        payload.extend_from_slice(&self.to.to_be_bytes());
        payload.extend_from_slice(&self.receipt);
        payload.extend_from_slice(&self.logical);
        for count in self.counts {
            payload.extend_from_slice(&count.to_be_bytes());
        }
        self.limits.encode(&mut payload);
        payload.extend_from_slice(&(self.files.len() as u64).to_be_bytes());
        for file in &self.files {
            blob(&mut payload, file.path().as_bytes());
            payload.extend_from_slice(&file.size().to_be_bytes());
            payload.extend_from_slice(file.sha256());
        }
        payload.extend_from_slice(&self.transformed);
        payload.extend_from_slice(&self.previous);
        let mut out = RECOVERY_MAGIC.to_vec();
        out.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        out.extend_from_slice(&payload);
        out.extend_from_slice(&envelope_checksum(RECOVERY_MAGIC, &out));
        out
    }

    fn decode(bytes: &[u8]) -> Result<Self, BackupError> {
        let split = bytes
            .len()
            .checked_sub(32)
            .ok_or(BackupError::InvalidManifest)?;
        let (body, checksum) = bytes.split_at(split);
        if !body.starts_with(RECOVERY_MAGIC) || envelope_checksum(RECOVERY_MAGIC, body) != checksum
        {
            return Err(BackupError::InvalidManifest);
        }
        let mut d = Decode(&body[RECOVERY_MAGIC.len()..]);
        let size = usize::try_from(d.u64()?).map_err(|_| BackupError::Limit)?;
        if size != d.0.len() {
            return Err(BackupError::InvalidManifest);
        }
        let kind = d.take(1)?[0];
        let attempt = d.u64()?;
        let from = d.u64()?;
        let to = d.u64()?;
        let receipt = d.hash()?;
        let logical = d.hash()?;
        let counts = [d.u64()?, d.u64()?, d.u64()?];
        let limits = Limits::decode(&mut d)?;
        let count = usize::try_from(d.u64()?).map_err(|_| BackupError::Limit)?;
        if count > 100_001 {
            return Err(BackupError::Limit);
        }
        let mut files: Vec<BackupFile> = Vec::with_capacity(count);
        for _ in 0..count {
            let name = std::str::from_utf8(d.blob(240)?)
                .map_err(|_| BackupError::InvalidManifest)?
                .to_owned();
            if (name != UPGRADE_GUARD && !transformed_native_name(&name))
                || files
                    .last()
                    .is_some_and(|file| file.path() >= name.as_str())
            {
                return Err(BackupError::InvalidManifest);
            }
            files.push(BackupFile::new(name, d.u64()?, d.hash()?));
        }
        let transformed = d.hash()?;
        let previous = d.hash()?;
        if !d.0.is_empty() {
            return Err(BackupError::InvalidManifest);
        }
        let result = Self {
            kind,
            attempt,
            from,
            to,
            receipt,
            logical,
            counts,
            limits,
            files,
            transformed,
            previous,
        };
        if result.encode() != bytes {
            return Err(BackupError::InvalidManifest);
        }
        Ok(result)
    }

    fn hash(&self) -> [u8; 32] {
        envelope_checksum(RECOVERY_MAGIC, &self.encode())
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "separate verified restartable upgrade API"
)]
impl Store {
    /// Starts a fresh recovery workspace by publishing a verified immutable copy
    /// of the exact completed legacy backup as checkpoint zero.
    pub fn start_upgrade_recovery(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        destination: impl AsRef<Path>,
        options: &UpgradeRecoveryOptions,
    ) -> Result<UpgradeRecovery, BackupError> {
        start_inner(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            destination.as_ref(),
            options,
            |_, _| Ok(()),
        )
    }

    /// Resumes only from the last fully verified checkpoint. Every new edge and
    /// final output uses a fresh attempt; incomplete attempts remain retained and
    /// non-authoritative. No source, backup, checkpoint, or active path is changed.
    pub fn resume_upgrade_recovery(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &UpgradeRecoveryOptions,
    ) -> Result<UpgradeRecovery, BackupError> {
        resume_inner(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            directory.as_ref(),
            options,
            |_, _| Ok(()),
        )
    }
}

fn start_inner(
    source: &Path,
    package: &Path,
    destination: &Path,
    options: &UpgradeRecoveryOptions,
    mut fault: impl FnMut(u8, u64) -> Result<(), BackupError>,
) -> Result<UpgradeRecovery, BackupError> {
    let started = Instant::now();
    let limits = Limits::new(options, started)?;
    check(&options.transform.backup.control, started)?;
    if !cfg!(unix) {
        return Err(BackupError::UnsupportedPlatform);
    }
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let (receipt, source_lease, _package_lease) = LegacyBackupReceipt::verify_ancestry_leased(
        &source,
        &package,
        &options.transform.backup,
        started,
    )?;
    let needed = usize::try_from(4_u64.saturating_sub(receipt.storage_version()))
        .map_err(|_| BackupError::Limit)?;
    if options.max_attempts.get() < needed {
        return Err(BackupError::Limit);
    }
    let expected = source_lease
        .project_upgrade(&options.transform, started)
        .map_err(|error| controlled_error(options, started, error))?;
    let counts = [
        expected.quad_count(),
        expected.graph_count(),
        expected.namespace_count(),
    ];
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    stable_directory(parent)?;
    let destination = fresh_destination(destination, &source)?;
    if destination.starts_with(&package) || package.starts_with(&destination) {
        return Err(BackupError::InvalidPath);
    }
    private_directory(&destination)?;
    let attempts = destination.join("attempts");
    private_directory(&attempts)?;
    let attempt = attempt_path(&destination, 0);
    private_directory(&attempt)?;
    let store = attempt.join("store");
    private_directory(&store)?;
    copy_checkpoint(
        &package.join("store"),
        &store,
        receipt.files(),
        options,
        started,
        receipt.storage_version(),
        &mut fault,
    )?;
    fault(3, receipt.storage_version())?;
    let files = physical_files(&store, &options.transform.backup, started, true)?;
    let _checkpoint_lease = LegacyStoreSnapshot::verify_upgrade_checkpoint(
        &store,
        receipt.storage_version(),
        &expected,
        &options.transform,
        started,
    )
    .map_err(|error| controlled_error(options, started, error))?;
    recheck_inputs(
        &source,
        &package,
        &receipt,
        &options.transform.backup,
        started,
    )?;
    let record = Record {
        kind: CHECKPOINT,
        attempt: 0,
        from: receipt.storage_version(),
        to: receipt.storage_version(),
        receipt: receipt.fingerprint(),
        logical: expected.fingerprint(),
        counts,
        limits,
        files,
        transformed: [0; 32],
        previous: [0; 32],
    };
    sync_directory(&store)?;
    sync_directory(&attempt)?;
    sync_directory(&attempts)?;
    sync_directory(&destination)?;
    let parent = destination.parent().ok_or(BackupError::InvalidPath)?;
    sync_directory(parent)?;
    fault(6, record.to)?;
    check(&options.transform.backup.control, started)?;
    append_record(&destination, &record, true).map_err(indeterminate)?;
    sync_directory(&destination).map_err(BackupError::CompletionIndeterminate)?;
    sync_directory(parent).map_err(BackupError::CompletionIndeterminate)?;
    fault(7, record.to).map_err(indeterminate)?;
    check(&options.transform.backup.control, started).map_err(indeterminate)?;
    Ok(observation(destination, receipt, vec![record], None, 1))
}

fn resume_inner(
    source: &Path,
    package: &Path,
    directory: &Path,
    options: &UpgradeRecoveryOptions,
    fault: impl FnMut(u8, u64) -> Result<(), BackupError>,
) -> Result<UpgradeRecovery, BackupError> {
    resume_inner_at(source, package, directory, options, Instant::now(), fault)
}

fn resume_inner_at(
    source: &Path,
    package: &Path,
    directory: &Path,
    options: &UpgradeRecoveryOptions,
    started: Instant,
    mut fault: impl FnMut(u8, u64) -> Result<(), BackupError>,
) -> Result<UpgradeRecovery, BackupError> {
    let limits = Limits::new(options, started)?;
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let directory = stable_directory(directory)?;
    disjoint(&source, &package, &directory)?;
    let attempts = scan_workspace(&directory, options, started)?;
    let mut records = decode_journal(
        &read(&directory.join(RECOVERY_JOURNAL), MAX_MANIFEST)?,
        options,
        started,
    )?;
    validate_chain(&records, &limits)?;
    if records.last().is_some_and(|record| record.kind == FINAL) {
        return verify_recovery(&source, &package, &directory, options, started);
    }

    let (receipt, source_lease, _package_lease) = LegacyBackupReceipt::verify_ancestry_leased(
        &source,
        &package,
        &options.transform.backup,
        started,
    )?;
    let expected = source_lease
        .project_upgrade(&options.transform, started)
        .map_err(|error| controlled_error(options, started, error))?;
    let counts = [
        expected.quad_count(),
        expected.graph_count(),
        expected.namespace_count(),
    ];
    validate_identity(&records, &receipt, expected.fingerprint(), counts, &limits)?;

    let mut checkpoint_leases = Vec::new();
    for record in &records {
        let store = checkpoint_store(&directory, record)?;
        if physical_files(&store, &options.transform.backup, started, false)? != record.files {
            return Err(BackupError::FileMismatch);
        }
        checkpoint_leases.push(
            LegacyStoreSnapshot::verify_upgrade_checkpoint(
                &store,
                record.to,
                &expected,
                &options.transform,
                started,
            )
            .map_err(|error| controlled_error(options, started, error))?,
        );
    }
    recheck_inputs(
        &source,
        &package,
        &receipt,
        &options.transform.backup,
        started,
    )?;

    let mut used: BTreeSet<u64> = attempts.into_iter().collect();
    let mut current = records.last().ok_or(BackupError::InvalidManifest)?.to;
    while current < 2 {
        check(&options.transform.backup.control, started)?;
        let attempt = next_attempt(&used, options)?;
        used.insert(attempt);
        let root = attempt_path(&directory, attempt);
        private_directory(&root)?;
        let store = root.join("store");
        private_directory(&store)?;
        let prior = records.last().ok_or(BackupError::InvalidManifest)?;
        copy_checkpoint(
            &checkpoint_store(&directory, prior)?,
            &store,
            &prior.files,
            options,
            started,
            current,
            &mut fault,
        )?;
        fault(3, current)?;
        let snapshot = LegacyStoreSnapshot::open(
            &store,
            options.transform.backup.store_options.clone().into(),
        )
        .map_err(BackupError::Storage)?;
        if snapshot.version != current {
            return Err(BackupError::FileMismatch);
        }
        let output_lease = snapshot
            .transform_upgrade_edge(
                current + 1,
                &expected,
                &options.transform,
                started,
                |edge| {
                    check(&options.transform.backup.control, started).map_err(storage_error)?;
                    fault(4, edge).map_err(storage_error)
                },
            )
            .map_err(|error| controlled_error(options, started, error))?;
        fault(5, current)?;
        let files = physical_files(&store, &options.transform.backup, started, true)?;
        if output_lease.projection() != &expected {
            return Err(BackupError::FileMismatch);
        }
        for record in &records {
            if physical_files(
                &checkpoint_store(&directory, record)?,
                &options.transform.backup,
                started,
                false,
            )? != record.files
            {
                return Err(BackupError::FileMismatch);
            }
        }
        recheck_inputs(
            &source,
            &package,
            &receipt,
            &options.transform.backup,
            started,
        )?;
        fault(6, current)?;
        let record = Record {
            kind: CHECKPOINT,
            attempt,
            from: current,
            to: current + 1,
            receipt: receipt.fingerprint(),
            logical: expected.fingerprint(),
            counts,
            limits: limits.clone(),
            files,
            transformed: [0; 32],
            previous: records.last().map(Record::hash).unwrap_or([0; 32]),
        };
        sync_directory(&store)?;
        sync_directory(&root)?;
        sync_directory(&directory.join("attempts"))?;
        sync_directory(&directory)?;
        check(&options.transform.backup.control, started)?;
        append_record(&directory, &record, false).map_err(indeterminate)?;
        sync_directory(&directory).map_err(BackupError::CompletionIndeterminate)?;
        fault(7, current).map_err(indeterminate)?;
        check(&options.transform.backup.control, started).map_err(indeterminate)?;
        current += 1;
        records.push(record);
        checkpoint_leases.push(output_lease);
    }

    let attempt = next_attempt(&used, options)?;
    let root = attempt_path(&directory, attempt);
    private_directory(&root)?;
    let output = root.join("output");
    private_directory(&output)?;
    private_directory(&output.join("store"))?;
    write(&output.join(JOURNAL), &journal(&receipt))?;
    write(&output.join(COMPLETE), &encode(&receipt))?;
    write(&output.join("store").join(UPGRADE_GUARD), GUARD)?;
    sync_directory(&output.join("store"))?;
    sync_directory(&output)?;
    sync_directory(&root)?;
    sync_directory(&directory.join("attempts"))?;
    sync_directory(&directory)?;
    fault(8, 2)?;
    check(&options.transform.backup.control, started)?;
    let last = records.last().ok_or(BackupError::InvalidManifest)?;
    copy_native_files(
        &checkpoint_store(&directory, last)?,
        &output.join("store"),
        &last.files,
        options,
        started,
        2,
        &mut fault,
    )?;
    let frames = completed_journal(&receipt, &expected.fingerprint());
    write(&output.join(TRANSFORM_JOURNAL), &frames)?;
    let files = physical_files(
        &output.join("store"),
        &options.transform.backup,
        started,
        true,
    )?;
    let output_lease = LegacyStoreSnapshot::verify_upgrade_checkpoint(
        &output.join("store"),
        2,
        &expected,
        &options.transform,
        started,
    )
    .map_err(|error| controlled_error(options, started, error))?;
    let transformed = TransformedUpgrade {
        directory: output.clone(),
        receipt: receipt.clone(),
        logical: expected.fingerprint(),
        counts,
        files,
        journal: envelope_checksum(TRANSFORM_MAGIC, &frames),
    };
    let bytes = transformed.encode();
    TransformedUpgrade::decode(&bytes)?;
    for record in &records {
        if physical_files(
            &checkpoint_store(&directory, record)?,
            &options.transform.backup,
            started,
            false,
        )? != record.files
        {
            return Err(BackupError::FileMismatch);
        }
    }
    recheck_inputs(
        &source,
        &package,
        &receipt,
        &options.transform.backup,
        started,
    )?;
    write(&output.join(TRANSFORM_PENDING), &bytes)?;
    sync_directory(&output)?;
    sync_directory(&root)?;
    sync_directory(&directory.join("attempts"))?;
    sync_directory(&directory)?;
    fault(9, 2)?;
    check(&options.transform.backup.control, started)?;
    fs::rename(
        output.join(TRANSFORM_PENDING),
        output.join(TRANSFORM_COMPLETE),
    )?;
    sync_directory(&output).map_err(BackupError::CompletionIndeterminate)?;
    sync_directory(&root).map_err(BackupError::CompletionIndeterminate)?;
    sync_directory(&directory.join("attempts")).map_err(BackupError::CompletionIndeterminate)?;
    sync_directory(&directory).map_err(BackupError::CompletionIndeterminate)?;
    fault(11, 2).map_err(indeterminate)?;
    check(&options.transform.backup.control, started).map_err(indeterminate)?;
    let final_record = Record {
        kind: FINAL,
        attempt,
        from: 2,
        to: 2,
        receipt: receipt.fingerprint(),
        logical: expected.fingerprint(),
        counts,
        limits,
        files: Vec::new(),
        transformed: transformed.fingerprint(),
        previous: records.last().map(Record::hash).unwrap_or([0; 32]),
    };
    fault(6, 2).map_err(indeterminate)?;
    check(&options.transform.backup.control, started).map_err(indeterminate)?;
    append_record(&directory, &final_record, false).map_err(indeterminate)?;
    sync_directory(&directory).map_err(BackupError::CompletionIndeterminate)?;
    fault(10, 2).map_err(indeterminate)?;
    check(&options.transform.backup.control, started).map_err(indeterminate)?;
    drop(output_lease);
    records.push(final_record);
    Ok(observation(
        directory,
        receipt,
        records,
        Some(transformed),
        used.len() + 1,
    ))
}

fn verify_recovery(
    source: &Path,
    package: &Path,
    directory: &Path,
    options: &UpgradeRecoveryOptions,
    started: Instant,
) -> Result<UpgradeRecovery, BackupError> {
    let limits = Limits::new(options, started)?;
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let directory = stable_directory(directory)?;
    disjoint(&source, &package, &directory)?;
    let attempts = scan_workspace(&directory, options, started)?;
    let records = decode_journal(
        &read(&directory.join(RECOVERY_JOURNAL), MAX_MANIFEST)?,
        options,
        started,
    )?;
    validate_chain(&records, &limits)?;
    let transformed = if let Some(record) = records.last().filter(|record| record.kind == FINAL) {
        let output = final_output(&directory, record)?;
        let verification_options = remaining_transform_options(options, started)?;
        let transformed =
            TransformedUpgrade::verify(&source, &package, &output, &verification_options)?;
        check(&options.transform.backup.control, started)?;
        if transformed.fingerprint() != record.transformed {
            return Err(BackupError::FileMismatch);
        }
        Some(transformed)
    } else {
        None
    };
    let (receipt, source_lease, _package_lease) = LegacyBackupReceipt::verify_ancestry_leased(
        &source,
        &package,
        &options.transform.backup,
        started,
    )?;
    let expected = source_lease
        .project_upgrade(&options.transform, started)
        .map_err(|error| controlled_error(options, started, error))?;
    let counts = [
        expected.quad_count(),
        expected.graph_count(),
        expected.namespace_count(),
    ];
    validate_identity(&records, &receipt, expected.fingerprint(), counts, &limits)?;
    let mut leases = Vec::new();
    for record in records.iter().filter(|record| record.kind == CHECKPOINT) {
        let store = checkpoint_store(&directory, record)?;
        if physical_files(&store, &options.transform.backup, started, false)? != record.files {
            return Err(BackupError::FileMismatch);
        }
        leases.push(
            LegacyStoreSnapshot::verify_upgrade_checkpoint(
                &store,
                record.to,
                &expected,
                &options.transform,
                started,
            )
            .map_err(|error| controlled_error(options, started, error))?,
        );
    }
    recheck_inputs(
        &source,
        &package,
        &receipt,
        &options.transform.backup,
        started,
    )?;
    check(&options.transform.backup.control, started)?;
    let result = observation(directory, receipt, records, transformed, attempts.len());
    drop(leases);
    Ok(result)
}

fn validate_identity(
    records: &[Record],
    receipt: &LegacyBackupReceipt,
    logical: [u8; 32],
    counts: [u64; 3],
    limits: &Limits,
) -> Result<(), BackupError> {
    if records.iter().any(|record| {
        record.receipt != receipt.fingerprint()
            || record.logical != logical
            || record.counts != counts
            || &record.limits != limits
    }) || records.first().map(|record| record.to) != Some(receipt.storage_version())
    {
        return Err(BackupError::FileMismatch);
    }
    Ok(())
}

fn validate_chain(records: &[Record], limits: &Limits) -> Result<(), BackupError> {
    if records.is_empty() || records.len() > limits.max_attempts as usize {
        return Err(BackupError::Limit);
    }
    let mut previous = [0; 32];
    let mut version = records[0].to;
    let mut attempt = None;
    for (index, record) in records.iter().enumerate() {
        if record.limits != *limits
            || record.attempt >= limits.max_attempts
            || attempt.is_some_and(|value| record.attempt <= value)
            || record.previous != previous
        {
            return Err(BackupError::InvalidManifest);
        }
        match record.kind {
            CHECKPOINT if index == 0 => {
                if record.from != record.to || record.attempt != 0 || record.files.is_empty() {
                    return Err(BackupError::InvalidManifest);
                }
            }
            CHECKPOINT => {
                if record.from != version
                    || record.to != version + 1
                    || record.to > 2
                    || record.files.is_empty()
                {
                    return Err(BackupError::InvalidManifest);
                }
                version = record.to;
            }
            FINAL => {
                if index + 1 != records.len()
                    || version != 2
                    || record.from != 2
                    || record.to != 2
                    || !record.files.is_empty()
                    || record.transformed == [0; 32]
                {
                    return Err(BackupError::InvalidManifest);
                }
            }
            _ => return Err(BackupError::InvalidManifest),
        }
        if record.kind == CHECKPOINT && record.transformed != [0; 32] {
            return Err(BackupError::InvalidManifest);
        }
        previous = record.hash();
        attempt = Some(record.attempt);
    }
    Ok(())
}

fn decode_journal(
    bytes: &[u8],
    options: &UpgradeRecoveryOptions,
    started: Instant,
) -> Result<Vec<Record>, BackupError> {
    if bytes.len() > MAX_MANIFEST {
        return Err(BackupError::Limit);
    }
    let mut rest = bytes;
    let mut records = Vec::new();
    while !rest.is_empty() {
        check(&options.transform.backup.control, started)?;
        if !rest.starts_with(RECOVERY_MAGIC) {
            return Err(BackupError::InvalidManifest);
        }
        let at = RECOVERY_MAGIC.len();
        let size = usize::try_from(u64::from_be_bytes(
            rest.get(at..at + 8)
                .ok_or(BackupError::InvalidManifest)?
                .try_into()
                .map_err(|_| BackupError::InvalidManifest)?,
        ))
        .map_err(|_| BackupError::Limit)?;
        let end = at
            .checked_add(8)
            .and_then(|value| value.checked_add(size))
            .and_then(|value| value.checked_add(32))
            .ok_or(BackupError::Limit)?;
        let frame = rest.get(..end).ok_or(BackupError::InvalidManifest)?;
        records.push(Record::decode(frame)?);
        if records.len() > MAX_ATTEMPTS {
            return Err(BackupError::Limit);
        }
        rest = &rest[end..];
    }
    Ok(records)
}

fn append_record(directory: &Path, record: &Record, create: bool) -> Result<(), BackupError> {
    let bytes = record.encode();
    let path = directory.join(RECOVERY_JOURNAL);
    let current = if create {
        0
    } else {
        fs::metadata(&path)?.len()
    };
    let Some(total) = current.checked_add(bytes.len() as u64) else {
        return Err(BackupError::Limit);
    };
    if total > MAX_MANIFEST as u64 {
        return Err(BackupError::Limit);
    }
    let mut options = OpenOptions::new();
    options.write(true);
    if create {
        options.create_new(true);
    } else {
        options.append(true);
    }
    let mut file = options.open(path)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

fn copy_checkpoint(
    source: &Path,
    destination: &Path,
    files: &[BackupFile],
    options: &UpgradeRecoveryOptions,
    started: Instant,
    edge: u64,
    fault: &mut impl FnMut(u8, u64) -> Result<(), BackupError>,
) -> Result<(), BackupError> {
    write(&destination.join(UPGRADE_GUARD), GUARD)?;
    sync_directory(destination)?;
    fault(0, edge)?;
    check(&options.transform.backup.control, started)?;
    fault(1, edge)?;
    copy_native_files(source, destination, files, options, started, edge, fault)
}

fn copy_native_files(
    source: &Path,
    destination: &Path,
    files: &[BackupFile],
    options: &UpgradeRecoveryOptions,
    started: Instant,
    edge: u64,
    fault: &mut impl FnMut(u8, u64) -> Result<(), BackupError>,
) -> Result<(), BackupError> {
    for file in files {
        if file.path() == UPGRADE_GUARD {
            continue;
        }
        let artifact = BackupArtifact::new(
            file.path().to_owned(),
            source.join(file.path()),
            file.size(),
            *file.sha256(),
        )?;
        copy_artifact(
            &artifact,
            &destination.join(file.path()),
            &options.transform.backup.control,
            started,
        )?;
        fault(2, edge)?;
    }
    sync_directory(destination)?;
    Ok(())
}

fn scan_workspace(
    directory: &Path,
    options: &UpgradeRecoveryOptions,
    started: Instant,
) -> Result<BTreeSet<u64>, BackupError> {
    let mut root = Vec::new();
    for entry in fs::read_dir(directory)? {
        check(&options.transform.backup.control, started)?;
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if name == "attempts" {
            if !entry.file_type()?.is_dir() {
                return Err(BackupError::InvalidPath);
            }
        } else if name == RECOVERY_JOURNAL {
            if !entry.file_type()?.is_file() || entry.metadata()?.len() > MAX_MANIFEST as u64 {
                return Err(BackupError::Limit);
            }
        } else {
            return Err(BackupError::InvalidPath);
        }
        root.push(name);
    }
    root.sort_unstable();
    if root != vec!["attempts".to_owned(), RECOVERY_JOURNAL.to_owned()] {
        return Err(BackupError::InvalidManifest);
    }
    let mut attempts = BTreeSet::new();
    for entry in fs::read_dir(directory.join("attempts"))? {
        check(&options.transform.backup.control, started)?;
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            return Err(BackupError::InvalidPath);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if name.len() != 16 || !digits(&name) {
            return Err(BackupError::InvalidPath);
        }
        let attempt = name.parse::<u64>().map_err(|_| BackupError::InvalidPath)?;
        if attempt >= options.max_attempts.get() as u64 || !attempts.insert(attempt) {
            return Err(BackupError::Limit);
        }
        scan_attempt(&entry.path(), options, started)?;
    }
    if attempts.is_empty() || attempts.len() > options.max_attempts.get() {
        return Err(BackupError::Limit);
    }
    Ok(attempts)
}

fn scan_attempt(
    path: &Path,
    options: &UpgradeRecoveryOptions,
    started: Instant,
) -> Result<(), BackupError> {
    let mut count = 0;
    for entry in fs::read_dir(path)? {
        check(&options.transform.backup.control, started)?;
        let entry = entry?;
        count += 1;
        if count > 1 || !entry.file_type()?.is_dir() {
            return Err(BackupError::InvalidPath);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if name == "store" {
            scan_partial_store(&entry.path(), options, started)?;
        } else if name == "output" {
            scan_partial_output(&entry.path(), options, started)?;
        } else {
            return Err(BackupError::InvalidPath);
        }
    }
    Ok(())
}

fn scan_partial_store(
    path: &Path,
    options: &UpgradeRecoveryOptions,
    started: Instant,
) -> Result<(), BackupError> {
    let mut count = 0;
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        check(&options.transform.backup.control, started)?;
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            return Err(BackupError::InvalidPath);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if name != UPGRADE_GUARD {
            if !transformed_native_name(&name) && !incomplete_staging_name(&name) {
                return Err(BackupError::InvalidPath);
            }
            count += 1;
            if count > options.transform.backup.max_files.get() {
                return Err(BackupError::Limit);
            }
        }
        total = total
            .checked_add(entry.metadata()?.len())
            .filter(|value| *value <= options.transform.backup.max_bytes.get())
            .ok_or(BackupError::Limit)?;
    }
    Ok(())
}

fn scan_partial_output(
    path: &Path,
    options: &UpgradeRecoveryOptions,
    started: Instant,
) -> Result<(), BackupError> {
    let mut count = 0;
    for entry in fs::read_dir(path)? {
        check(&options.transform.backup.control, started)?;
        let entry = entry?;
        count += 1;
        if count > 5 {
            return Err(BackupError::Limit);
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if name == "store" {
            if !entry.file_type()?.is_dir() {
                return Err(BackupError::InvalidPath);
            }
            scan_partial_store(&entry.path(), options, started)?;
        } else if [
            JOURNAL,
            COMPLETE,
            TRANSFORM_JOURNAL,
            TRANSFORM_COMPLETE,
            TRANSFORM_PENDING,
        ]
        .contains(&name.as_str())
        {
            if !entry.file_type()?.is_file() || entry.metadata()?.len() > MAX_MANIFEST as u64 {
                return Err(BackupError::Limit);
            }
        } else {
            return Err(BackupError::InvalidPath);
        }
    }
    Ok(())
}

fn incomplete_staging_name(name: &str) -> bool {
    let Some(digits) = name
        .strip_prefix("bulk-")
        .and_then(|value| value.strip_suffix(".sst"))
    else {
        return false;
    };
    !digits.is_empty()
        && digits.bytes().all(|byte| byte.is_ascii_digit())
        && digits.parse::<u128>().is_ok()
}

fn remaining_transform_options(
    options: &UpgradeRecoveryOptions,
    started: Instant,
) -> Result<UpgradeTransformOptions, BackupError> {
    check(&options.transform.backup.control, started)?;
    let mut result = options.transform.clone();
    if let Some(timeout) = options.transform.backup.control.timeout() {
        let remaining = timeout
            .checked_sub(started.elapsed())
            .ok_or(BackupError::TimedOut)?;
        result.backup.control = result.backup.control.clone().with_timeout(remaining);
    }
    Ok(result)
}

fn next_attempt(
    attempts: &BTreeSet<u64>,
    options: &UpgradeRecoveryOptions,
) -> Result<u64, BackupError> {
    if attempts.len() >= options.max_attempts.get() {
        return Err(BackupError::Limit);
    }
    let next = attempts
        .last()
        .copied()
        .and_then(|value| value.checked_add(1))
        .unwrap_or(0);
    if next >= options.max_attempts.get() as u64 {
        return Err(BackupError::Limit);
    }
    Ok(next)
}

fn attempt_path(directory: &Path, attempt: u64) -> PathBuf {
    directory.join("attempts").join(format!("{attempt:016}"))
}

fn checkpoint_store(directory: &Path, record: &Record) -> Result<PathBuf, BackupError> {
    if record.kind != CHECKPOINT {
        return Err(BackupError::InvalidManifest);
    }
    stable_directory(&attempt_path(directory, record.attempt).join("store"))
}

fn final_output(directory: &Path, record: &Record) -> Result<PathBuf, BackupError> {
    if record.kind != FINAL {
        return Err(BackupError::InvalidManifest);
    }
    stable_directory(&attempt_path(directory, record.attempt).join("output"))
}

fn controlled_error(
    options: &UpgradeRecoveryOptions,
    started: Instant,
    error: crate::storage::StorageError,
) -> BackupError {
    check(&options.transform.backup.control, started)
        .err()
        .unwrap_or(BackupError::Storage(error))
}

fn observation(
    directory: PathBuf,
    receipt: LegacyBackupReceipt,
    records: Vec<Record>,
    transformed: Option<TransformedUpgrade>,
    attempts: usize,
) -> UpgradeRecovery {
    let last_checkpoint = records
        .iter()
        .rev()
        .find(|record| record.kind == CHECKPOINT)
        .expect("validated recovery chain has a checkpoint");
    UpgradeRecovery {
        directory,
        receipt,
        storage_version: last_checkpoint.to,
        attempts,
        logical: last_checkpoint.logical,
        counts: last_checkpoint.counts,
        transformed,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::collections::{BTreeMap, BTreeSet};
    use std::process::Command;
    use std::time::Duration;

    type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

    fn fixture(version: u64, destination: &Path) -> Result {
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
            fs::copy(entry.path(), destination.join(entry.file_name()))?;
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

    fn setup(
        version: u64,
    ) -> Result<(
        tempfile::TempDir,
        PathBuf,
        PathBuf,
        PathBuf,
        UpgradeRecoveryOptions,
    )> {
        let dir = tempfile::tempdir()?;
        let source = dir.path().join("source");
        let backup = dir.path().join("backup");
        let recovery = dir.path().join("recovery");
        fixture(version, &source)?;
        let options = UpgradeRecoveryOptions::default();
        Store::backup_legacy(&source, &backup, &options.transform.backup)?;
        Ok((dir, source, backup, recovery, options))
    }

    fn spawn_cut(root: &Path, mode: &str, phase: u8, edge: u64, occurrence: usize) -> Result {
        let mut command = Command::new(std::env::current_exe()?);
        command
            .arg("--exact")
            .arg("store::upgrade::transform::resume::tests::upgrade_recovery_process_helper")
            .arg("--nocapture")
            .env("OXIGRAPH_RECOVERY_TEST_ROOT", root)
            .env("OXIGRAPH_RECOVERY_TEST_MODE", mode)
            .env("OXIGRAPH_RECOVERY_TEST_PHASE", phase.to_string())
            .env("OXIGRAPH_RECOVERY_TEST_EDGE", edge.to_string())
            .env("OXIGRAPH_RECOVERY_TEST_OCCURRENCE", occurrence.to_string());
        if phase == u8::MAX {
            command.env("OXIGRAPH_RECOVERY_TEST_EXIT_AT_NATIVE_SST", "1");
        }
        let status = command.status()?;
        assert_eq!(
            status.code(),
            Some(73),
            "cut {mode}/{phase}/{edge}/{occurrence}"
        );
        Ok(())
    }

    fn completed_hashes(
        recovery: &Path,
        options: &UpgradeRecoveryOptions,
    ) -> Result<BTreeMap<u64, BTreeMap<PathBuf, [u8; 32]>>> {
        let records = decode_journal(
            &fs::read(recovery.join(RECOVERY_JOURNAL))?,
            options,
            Instant::now(),
        )?;
        records
            .iter()
            .filter(|record| record.kind == CHECKPOINT)
            .map(|record| {
                Ok((
                    record.attempt,
                    hashes(&checkpoint_store(recovery, record)?)?,
                ))
            })
            .collect()
    }

    fn assert_guarded_attempts(recovery: &Path) -> Result {
        for entry in fs::read_dir(recovery.join("attempts"))? {
            let entry = entry?;
            for store in [
                entry.path().join("store"),
                entry.path().join("output/store"),
            ] {
                if store.is_dir() {
                    assert!(matches!(
                        Store::open(&store),
                        Err(crate::storage::StorageError::UpgradeIncomplete)
                    ));
                    assert!(matches!(
                        Store::open_read_only(&store),
                        Err(crate::storage::StorageError::UpgradeIncomplete)
                    ));
                }
            }
        }
        Ok(())
    }

    #[test]
    fn upgrade_recovery_process_helper() -> Result {
        let Some(root) = std::env::var_os("OXIGRAPH_RECOVERY_TEST_ROOT") else {
            return Ok(());
        };
        let root = PathBuf::from(root);
        let mode = std::env::var("OXIGRAPH_RECOVERY_TEST_MODE")?;
        let phase = std::env::var("OXIGRAPH_RECOVERY_TEST_PHASE")?.parse::<u8>()?;
        let edge = std::env::var("OXIGRAPH_RECOVERY_TEST_EDGE")?.parse::<u64>()?;
        let occurrence = std::env::var("OXIGRAPH_RECOVERY_TEST_OCCURRENCE")?.parse::<usize>()?;
        let mut seen = 0;
        let callback = |observed_phase, observed_edge| {
            if observed_phase == phase && observed_edge == edge {
                seen += 1;
                if seen == occurrence {
                    std::process::exit(73);
                }
            }
            Ok(())
        };
        let result = if mode == "start" {
            start_inner(
                &root.join("source"),
                &root.join("backup"),
                &root.join("recovery"),
                &UpgradeRecoveryOptions::default(),
                callback,
            )
        } else {
            resume_inner(
                &root.join("source"),
                &root.join("backup"),
                &root.join("recovery"),
                &UpgradeRecoveryOptions::default(),
                callback,
            )
        };
        drop(result);
        Err("child did not reach requested recovery boundary".into())
    }

    #[test]
    fn actual_process_cuts_cover_start_edges_checkpoints_and_final_publication() -> Result {
        for phase in [0, 2, 3, 6, 7] {
            let (dir, source, backup, recovery, options) = setup(0)?;
            let source_before = hashes(&source)?;
            let backup_before = hashes(&backup.join("store"))?;
            spawn_cut(dir.path(), "start", phase, 0, 1)?;
            assert_eq!(hashes(&source)?, source_before);
            assert_eq!(hashes(&backup.join("store"))?, backup_before);
            assert_guarded_attempts(&recovery)?;
            if phase == 7 {
                let checkpoint_before = completed_hashes(&recovery, &options)?;
                let verified = UpgradeRecovery::verify(&source, &backup, &recovery, &options)?;
                assert_eq!(verified.storage_version(), 0);
                assert!(!verified.completed());
                let mut edges = BTreeSet::new();
                let completed =
                    resume_inner(&source, &backup, &recovery, &options, |seen, edge| {
                        if seen == 4 {
                            edges.insert(edge);
                        }
                        Ok(())
                    })?;
                assert!(completed.completed());
                assert_eq!(edges, BTreeSet::from([0, 1]));
                let checkpoint_after = completed_hashes(&recovery, &options)?;
                for (attempt, before) in checkpoint_before {
                    assert_eq!(checkpoint_after.get(&attempt), Some(&before));
                }
            } else {
                assert!(UpgradeRecovery::verify(&source, &backup, &recovery, &options).is_err());
                assert!(
                    Store::resume_upgrade_recovery(&source, &backup, &recovery, &options).is_err()
                );
                let fresh = dir.path().join("fresh-recovery");
                Store::start_upgrade_recovery(&source, &backup, &fresh, &options)?;
                assert!(
                    Store::resume_upgrade_recovery(&source, &backup, &fresh, &options)?.completed()
                );
            }
            assert_eq!(hashes(&source)?, source_before);
            assert_eq!(hashes(&backup.join("store"))?, backup_before);
            assert_guarded_attempts(&recovery)?;
        }

        let cases = [
            (0, 0, 1),
            (2, 0, 1),
            (3, 0, 1),
            (u8::MAX, 0, 1),
            (6, 0, 1),
            (7, 0, 1),
            (0, 1, 1),
            (2, 1, 1),
            (3, 1, 1),
            (4, 1, 1),
            (6, 1, 1),
            (7, 1, 1),
            (8, 2, 1),
            (2, 2, 1),
            (9, 2, 1),
            (11, 2, 1),
            (6, 2, 1),
            (10, 2, 1),
        ];
        for (phase, edge, occurrence) in cases {
            let (dir, source, backup, recovery, options) = setup(0)?;
            let source_before = hashes(&source)?;
            let backup_before = hashes(&backup.join("store"))?;
            Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
            spawn_cut(dir.path(), "resume", phase, edge, occurrence)?;
            if phase == u8::MAX {
                let staging = fs::read_dir(recovery.join("attempts"))?
                    .filter_map(std::result::Result::ok)
                    .flat_map(|attempt| {
                        fs::read_dir(attempt.path().join("store"))
                            .into_iter()
                            .flatten()
                    })
                    .filter_map(std::result::Result::ok)
                    .filter_map(|entry| entry.file_name().into_string().ok())
                    .any(|name| incomplete_staging_name(&name));
                assert!(
                    staging,
                    "native SST cut did not retain its owned staging file"
                );
            }
            let completed_before = completed_hashes(&recovery, &options)?;
            let completed = if (phase, edge, occurrence) == (7, 0, 1) {
                let mut edges = BTreeSet::new();
                let completed =
                    resume_inner(&source, &backup, &recovery, &options, |seen, edge| {
                        if seen == 4 {
                            edges.insert(edge);
                        }
                        Ok(())
                    })?;
                assert_eq!(edges, BTreeSet::from([1]));
                completed
            } else {
                Store::resume_upgrade_recovery(&source, &backup, &recovery, &options)?
            };
            assert!(completed.completed());
            let completed_after = completed_hashes(&recovery, &options)?;
            for (attempt, before) in completed_before {
                assert_eq!(completed_after.get(&attempt), Some(&before));
            }
            assert_eq!(hashes(&source)?, source_before);
            assert_eq!(hashes(&backup.join("store"))?, backup_before);
            assert_guarded_attempts(&recovery)?;
            let mut completed_edges = BTreeSet::new();
            assert_eq!(
                resume_inner(&source, &backup, &recovery, &options, |seen, edge| {
                    if seen == 4 {
                        completed_edges.insert(edge);
                    }
                    Ok(())
                })?,
                completed
            );
            assert!(completed_edges.is_empty());
        }

        #[cfg(feature = "rdf-12")]
        for (phase, occurrence) in [(4, 4), (5, 1)] {
            let (dir, source, backup, recovery, options) = setup(1)?;
            let source_before = hashes(&source)?;
            let backup_before = hashes(&backup.join("store"))?;
            Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
            spawn_cut(dir.path(), "resume", phase, 1, occurrence)?;
            let completed_before = completed_hashes(&recovery, &options)?;
            assert_eq!(completed_before.len(), 1);
            let mut edges = BTreeSet::new();
            let completed = resume_inner(&source, &backup, &recovery, &options, |seen, edge| {
                if seen == 4 {
                    edges.insert(edge);
                }
                Ok(())
            })?;
            assert_eq!(edges, BTreeSet::from([1]));
            assert!(completed.completed());
            assert_eq!(completed.attempt_count(), 4);
            let completed_after = completed_hashes(&recovery, &options)?;
            for (attempt, before) in completed_before {
                assert_eq!(completed_after.get(&attempt), Some(&before));
            }
            assert_eq!(hashes(&source)?, source_before);
            assert_eq!(hashes(&backup.join("store"))?, backup_before);
            assert_guarded_attempts(&recovery)?;
        }
        Ok(())
    }

    #[test]
    fn cancellation_deadline_attempt_bounds_and_leases_fail_closed() -> Result {
        for target in [
            (0, 0),
            (3, 0),
            (4, 1),
            (6, 0),
            (7, 0),
            (8, 2),
            (9, 2),
            (11, 2),
            (6, 2),
            (10, 2),
        ] {
            let (_dir, source, backup, recovery, options) = setup(0)?;
            Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
            let control = options.transform.backup.control.clone();
            let result = resume_inner(&source, &backup, &recovery, &options, |phase, edge| {
                if (phase, edge) == target {
                    for path in [
                        &source,
                        &backup.join("store"),
                        &recovery.join("attempts/0000000000000000/store"),
                    ] {
                        assert!(!LegacyStoreSnapshot::upgrade_lease_available(path));
                    }
                    control.cancel();
                }
                Ok(())
            });
            if matches!(target, (7, 0) | (11, 2) | (6, 2) | (10, 2)) {
                assert!(matches!(
                    result,
                    Err(BackupError::CompletionIndeterminate(_))
                ));
            } else {
                assert!(matches!(result, Err(BackupError::Cancelled)));
            }
            for path in [
                &source,
                &backup.join("store"),
                &recovery.join("attempts/0000000000000000/store"),
            ] {
                assert!(LegacyStoreSnapshot::upgrade_lease_available(path));
            }
        }

        #[cfg(feature = "rdf-12")]
        {
            let (_dir, source, backup, recovery, mut options) = setup(1)?;
            let source_before = hashes(&source)?;
            let backup_before = hashes(&backup.join("store"))?;
            Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
            let checkpoint_before = completed_hashes(&recovery, &options)?;
            let control = options.transform.backup.control.clone();
            let mut occurrence = 0;
            let result = resume_inner(&source, &backup, &recovery, &options, |phase, edge| {
                if (phase, edge) == (4, 1) {
                    occurrence += 1;
                    if occurrence == 4 {
                        for path in [
                            &source,
                            &backup.join("store"),
                            &recovery.join("attempts/0000000000000000/store"),
                            &recovery.join("attempts/0000000000000001/store"),
                        ] {
                            assert!(!LegacyStoreSnapshot::upgrade_lease_available(path));
                        }
                        control.cancel();
                    }
                }
                Ok(())
            });
            assert_eq!(
                occurrence, 4,
                "fixture did not reach the in-transaction cut"
            );
            assert!(matches!(result, Err(BackupError::Cancelled)));
            options.transform.backup.control = crate::store::TransactionStartControl::new();
            assert_eq!(completed_hashes(&recovery, &options)?, checkpoint_before);
            assert_eq!(hashes(&source)?, source_before);
            assert_eq!(hashes(&backup.join("store"))?, backup_before);
            assert_guarded_attempts(&recovery)?;
            for path in [
                &source,
                &backup.join("store"),
                &recovery.join("attempts/0000000000000000/store"),
                &recovery.join("attempts/0000000000000001/store"),
            ] {
                assert!(LegacyStoreSnapshot::upgrade_lease_available(path));
            }
            let completed = Store::resume_upgrade_recovery(&source, &backup, &recovery, &options)?;
            assert!(completed.completed());
            assert_eq!(completed.attempt_count(), 4);
            let checkpoint_after = completed_hashes(&recovery, &options)?;
            for (attempt, before) in checkpoint_before {
                assert_eq!(checkpoint_after.get(&attempt), Some(&before));
            }
            assert_eq!(hashes(&source)?, source_before);
            assert_eq!(hashes(&backup.join("store"))?, backup_before);
            assert_guarded_attempts(&recovery)?;
        }

        let (_dir, source, backup, recovery, mut options) = setup(0)?;
        Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
        options.transform.backup.control =
            crate::store::TransactionStartControl::new().with_timeout(Duration::from_millis(20));
        let result = resume_inner(&source, &backup, &recovery, &options, |phase, _| {
            if phase == 0 {
                std::thread::sleep(Duration::from_millis(40));
            }
            Ok(())
        });
        assert!(matches!(result, Err(BackupError::TimedOut)));

        let (_dir, source, backup, recovery, mut options) = setup(0)?;
        Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
        Store::resume_upgrade_recovery(&source, &backup, &recovery, &options)?;
        options.transform.backup.control =
            crate::store::TransactionStartControl::new().with_timeout(Duration::from_secs(1));
        assert!(matches!(
            resume_inner_at(
                &source,
                &backup,
                &recovery,
                &options,
                Instant::now() - Duration::from_secs(2),
                |_, _| Ok(())
            ),
            Err(BackupError::TimedOut)
        ));

        let (_dir, source, backup, _recovery, mut limited) = setup(0)?;
        limited.max_attempts = NonZeroUsize::new(4).unwrap();
        let limited_recovery = source.parent().unwrap().join("limited-recovery");
        Store::start_upgrade_recovery(&source, &backup, &limited_recovery, &limited)?;
        for _ in 0..2 {
            assert!(matches!(
                resume_inner(&source, &backup, &limited_recovery, &limited, |phase, _| {
                    if phase == 2 {
                        Err(BackupError::Cancelled)
                    } else {
                        Ok(())
                    }
                }),
                Err(BackupError::Cancelled)
            ));
        }
        assert!(matches!(
            Store::resume_upgrade_recovery(&source, &backup, &limited_recovery, &limited),
            Err(BackupError::Limit)
        ));
        Ok(())
    }

    #[test]
    fn completed_chain_corruption_reordering_path_and_feature_changes_are_refused() -> Result {
        let (_dir, source, backup, recovery, options) = setup(0)?;
        Store::start_upgrade_recovery(&source, &backup, &recovery, &options)?;
        Store::resume_upgrade_recovery(&source, &backup, &recovery, &options)?;
        let journal = recovery.join(RECOVERY_JOURNAL);
        let original = fs::read(&journal)?;
        let records = decode_journal(&original, &options, Instant::now())?;

        let mut offsets = Vec::new();
        let mut at = 0;
        while at < original.len() {
            let size = usize::try_from(u64::from_be_bytes(
                original[at + RECOVERY_MAGIC.len()..at + RECOVERY_MAGIC.len() + 8].try_into()?,
            ))?;
            let end = at + RECOVERY_MAGIC.len() + 8 + size + 32;
            offsets.push((at, end));
            at = end;
        }
        let mut reordered = Vec::new();
        reordered.extend_from_slice(&original[offsets[0].0..offsets[0].1]);
        reordered.extend_from_slice(&original[offsets[2].0..offsets[2].1]);
        reordered.extend_from_slice(&original[offsets[1].0..offsets[1].1]);
        for changed in [
            {
                let mut value = original.clone();
                value.pop();
                value
            },
            {
                let mut value = original.clone();
                value[offsets[1].0 + RECOVERY_MAGIC.len() + 24] ^= 1;
                value
            },
            reordered,
        ] {
            fs::write(&journal, changed)?;
            assert!(UpgradeRecovery::verify(&source, &backup, &recovery, &options).is_err());
        }

        let mut feature_changed = records.clone();
        let mut previous = [0; 32];
        for record in &mut feature_changed {
            record.limits.rdf12 = !record.limits.rdf12;
            record.previous = previous;
            previous = record.hash();
        }
        fs::write(
            &journal,
            feature_changed
                .iter()
                .flat_map(Record::encode)
                .collect::<Vec<_>>(),
        )?;
        assert!(UpgradeRecovery::verify(&source, &backup, &recovery, &options).is_err());
        fs::write(&journal, &original)?;

        let checkpoint = checkpoint_store(&recovery, &records[1])?;
        let identity = checkpoint.join("IDENTITY");
        let bytes = fs::read(&identity)?;
        fs::write(&identity, b"tampered")?;
        assert!(UpgradeRecovery::verify(&source, &backup, &recovery, &options).is_err());
        fs::write(&identity, bytes)?;

        let moved = recovery
            .parent()
            .ok_or(BackupError::InvalidPath)?
            .join("moved-checkpoint");
        fs::rename(checkpoint.parent().ok_or(BackupError::InvalidPath)?, &moved)?;
        assert!(UpgradeRecovery::verify(&source, &backup, &recovery, &options).is_err());
        Ok(())
    }
}
