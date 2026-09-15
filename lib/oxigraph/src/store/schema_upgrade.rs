//! Explicit marker-only v2-to-v3 construction. No ordinary admission or activation.
//! Child of the legacy receipt module solely to reuse its build and lease helpers;
//! none of its historical encodings or validators are changed.
use super::*;
use crate::storage::SchemaUpgradeSnapshot;
use crate::store::{BackupReceipt, SchemaRdfProfile, SchemaUuid, StoreSchemaEnvelope};

const PLAN: &str = "oxigraph-schema-upgrade.preflight";
const JOURNAL: &str = "oxigraph-schema-upgrade.journal";
const COMPLETE: &str = "oxigraph-schema-upgrade.complete";
const PENDING: &str = "oxigraph-schema-upgrade.pending";
const PLAN_MAGIC: &[u8] = b"oxigraph.schema-upgrade.preflight.v1\0";
const JOURNAL_MAGIC: &[u8] = b"oxigraph.schema-upgrade.journal.v1\0";
const RECEIPT_MAGIC: &[u8] = b"oxigraph.schema-upgrade.receipt.v1\0";
const SCOPE: &[u8] =
    b"all-primary-cf-key-values-except-oxversion;contributors=byte-preserved-not-reconciled";
const INTENT: u8 = 1;
const VALIDATED: u8 = 2;
const SEALED: u8 = 3;
const FAILED: u8 = 4;

/// Mandatory immutable write ceiling and finite construction limits.
/// There is deliberately no Default: the operator must choose the RDF ceiling.
/// Native reads, primary validation and filesystem syncs are cooperatively,
/// not preemptively, cancellable. Limits do not bound RocksDB memory usage.
#[derive(Clone)]
pub struct SchemaUpgradeOptions {
    rdf_write_profile: SchemaRdfProfile,
    pub limits: UpgradeRecoveryOptions,
}

impl SchemaUpgradeOptions {
    pub fn new(rdf_write_profile: SchemaRdfProfile) -> Self {
        Self {
            rdf_write_profile,
            limits: UpgradeRecoveryOptions::default(),
        }
    }
    pub const fn rdf_write_profile(&self) -> SchemaRdfProfile {
        self.rdf_write_profile
    }
    fn backup(&self) -> &LegacyBackupOptions {
        &self.limits.transform.backup
    }
    fn build_options(&self) -> UpgradeOptions {
        UpgradeOptions {
            recovery: self.limits.clone(),
        }
    }
    fn check(&self, started: Instant) -> Result<(), BackupError> {
        check_options(self.backup(), started)?;
        if self.limits.max_attempts.get() > 64 {
            return Err(BackupError::Limit);
        }
        Ok(())
    }
}

/// Verified durable preflight or a sealed inactive result.
/// A partial attempt is never represented as a usable store.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SchemaUpgradeState {
    directory: PathBuf,
    envelope: StoreSchemaEnvelope,
    receipt: Option<SchemaUpgradeReceipt>,
}

impl SchemaUpgradeState {
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub const fn schema_uuid(&self) -> &SchemaUuid {
        self.envelope.schema_uuid()
    }
    pub const fn envelope(&self) -> &StoreSchemaEnvelope {
        &self.envelope
    }
    pub const fn receipt(&self) -> Option<&SchemaUpgradeReceipt> {
        self.receipt.as_ref()
    }
}

/// Exact-build-bound preservation evidence for an inactive version-3 copy.
/// The receipt does not authorize admission, activation, restoration of external
/// contributors, older-binary rollback, or publication. Checksums bind content,
/// not authorship. All paths must remain offline and exclusively controlled.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SchemaUpgradeReceipt {
    directory: PathBuf,
    envelope: StoreSchemaEnvelope,
    attempt: u64,
    backup: [u8; 32],
    projection: [u8; 32],
    records: u64,
    bytes: u64,
    fingerprint: [u8; 32],
}

impl SchemaUpgradeReceipt {
    pub const fn manifest_name() -> &'static str {
        COMPLETE
    }
    pub const fn journal_name() -> &'static str {
        JOURNAL
    }
    pub const fn preflight_name() -> &'static str {
        PLAN
    }
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub fn store_directory(&self) -> PathBuf {
        attempt_path(&self.directory, self.attempt).join("store")
    }
    pub const fn envelope(&self) -> &StoreSchemaEnvelope {
        &self.envelope
    }
    pub const fn schema_uuid(&self) -> &SchemaUuid {
        self.envelope.schema_uuid()
    }
    pub const fn backup_fingerprint(&self) -> [u8; 32] {
        self.backup
    }
    pub const fn primary_fingerprint(&self) -> [u8; 32] {
        self.projection
    }
    pub const fn primary_records(&self) -> u64 {
        self.records
    }
    pub const fn primary_bytes(&self) -> u64 {
        self.bytes
    }
    pub const fn fingerprint(&self) -> [u8; 32] {
        self.fingerprint
    }
    pub const fn contributor_scope(&self) -> &'static str {
        "byte-preserved-not-reconciled"
    }

    /// Independently verifies inputs, build, complete journal, every completed
    /// output inventory, envelope and full primary equality under retained leases.
    /// Does not create locks in the source/package or repair incomplete records.
    pub fn verify(
        source: impl AsRef<Path>,
        completed_backup: impl AsRef<Path>,
        workspace: impl AsRef<Path>,
        options: &SchemaUpgradeOptions,
    ) -> Result<Self, BackupError> {
        let started = Instant::now();
        let source = stable_directory(source.as_ref())?;
        let package = stable_directory(completed_backup.as_ref())?;
        let directory = stable_directory(workspace.as_ref())?;
        disjoint(&source, &package, &directory)?;
        let _lease = WorkspaceLease::acquire(&directory)?;
        let inputs = Inputs::open(&source, &package, options, started)?;
        let verified = verify_workspace(&directory, &source, &package, &inputs, options, started)?;
        if verified.records.last().map(|record| record.kind) != Some(SEALED) {
            return Err(BackupError::InvalidManifest);
        }
        let receipt = make_receipt(&directory, &inputs, &verified)?;
        if read(&directory.join(COMPLETE), MAX_MANIFEST)? != receipt_bytes(&verified) {
            return Err(BackupError::InvalidManifest);
        }
        if directory.join(PENDING).try_exists()? {
            return Err(BackupError::InvalidManifest);
        }
        inputs.recheck(&source, &package, options, started)?;
        Ok(receipt)
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "separate inactive schema upgrade"
)]
impl Store {
    /// Persists an immutable UUID/profile/build-bound preflight before copying.
    /// Source must have its existing regular LOCK. The completed backup remains
    /// immutable, including its normal absence of a native LOCK. Receipt-file
    /// flock coordinates these APIs only; it cannot exclude unrelated writers.
    /// Source, package and workspace must be offline, disjoint, symlink-free and
    /// exclusively owned throughout. Interrupted work is retained, never deleted.
    pub fn start_schema_upgrade(
        source: impl AsRef<Path>,
        completed_backup: impl AsRef<Path>,
        workspace: impl AsRef<Path>,
        options: &SchemaUpgradeOptions,
    ) -> Result<SchemaUpgradeState, BackupError> {
        start_inner(
            source.as_ref(),
            completed_backup.as_ref(),
            workspace.as_ref(),
            options,
        )
    }

    /// Revalidates the durable preflight, then builds a fresh guarded attempt or
    /// finishes sealing an already validated attempt. A partial attempt is never
    /// rewritten. Torn journal/pending records fail closed. Control may change on
    /// resume; persisted content limits, build and RDF ceiling may not.
    pub fn resume_schema_upgrade(
        source: impl AsRef<Path>,
        completed_backup: impl AsRef<Path>,
        workspace: impl AsRef<Path>,
        options: &SchemaUpgradeOptions,
    ) -> Result<SchemaUpgradeState, BackupError> {
        resume_inner(
            source.as_ref(),
            completed_backup.as_ref(),
            workspace.as_ref(),
            options,
            |_| Ok(()),
        )
    }
}

// File locking never writes the backup receipt or introduces a native LOCK.
// Closing inherited descriptors does not explicitly unlock a parent's flock.
struct PackageLease {
    _file: File,
}
impl PackageLease {
    fn acquire(path: &Path) -> Result<Self, BackupError> {
        let file = open_regular(path)?;
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;
            #[expect(unsafe_code, reason = "flock receives an owned live file descriptor")]
            // SAFETY: the descriptor belongs to file and is retained by the lease.
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
                return Err(BackupError::InvalidPath);
            }
            Ok(Self { _file: file })
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = file;
            Err(BackupError::UnsupportedPlatform)
        }
    }
}

struct Inputs {
    source: SchemaUpgradeSnapshot,
    backup: SchemaUpgradeSnapshot,
    _package_lease: PackageLease,
    receipt: BackupReceipt,
    source_files: Vec<BackupFile>,
    projection: ([u8; 32], u64, u64),
}

impl Inputs {
    fn open(
        source: &Path,
        package: &Path,
        options: &SchemaUpgradeOptions,
        started: Instant,
    ) -> Result<Self, BackupError> {
        options.check(started)?;
        let package_lease = PackageLease::acquire(&package.join(BackupReceipt::manifest_name()))?;
        let receipt = BackupReceipt::decode(&read(
            &package.join(BackupReceipt::manifest_name()),
            MAX_MANIFEST,
        )?)?;
        if receipt.checkpoint().storage_version() != 2
            || receipt.files().len() > options.backup().max_files.get()
        {
            return Err(BackupError::InvalidManifest);
        }
        receipt.files().iter().try_fold(0_u64, |total, file| {
            total
                .checked_add(file.size())
                .filter(|total| *total <= options.backup().max_bytes.get())
                .ok_or(BackupError::Limit)
        })?;
        if BackupReceipt::verify(package, &options.backup().control)? != receipt {
            return Err(BackupError::FileMismatch);
        }
        let source_files = tree(source, options, started)?;
        if source_files
            .iter()
            .any(|file| file.path().contains('/') || !transformed_native_name(file.path()))
        {
            return Err(BackupError::InvalidPath);
        }
        let source_snapshot = SchemaUpgradeSnapshot::open(
            source,
            true,
            &2_u64.to_be_bytes(),
            &options.backup().store_options,
        )?;
        let backup_snapshot = SchemaUpgradeSnapshot::open(
            &package.join("store"),
            false,
            &2_u64.to_be_bytes(),
            &options.backup().store_options,
        )?;
        let projection = compare(&source_snapshot, &backup_snapshot, options, started)?;
        source_snapshot.validate_metadata(&options.backup().control, started)?;
        let features = Store::inspect_features_with_control(source, &options.backup().control)?;
        if options.rdf_write_profile == SchemaRdfProfile::Rdf11 && features.rdf_12_required() {
            return Err(
                crate::storage::StorageError::FeatureIncompatible { feature: "rdf-12" }.into(),
            );
        }
        // Existing validators run only on current v2 inputs, never on the v3 copy.
        let primary = Store::open_read_only(source)?;
        primary.validate()?;
        if primary.backup_checkpoint()?.0 != *receipt.checkpoint()
            || primary.backup_contents(&options.backup().control, started)? != *receipt.contents()
        {
            return Err(BackupError::FileMismatch);
        }
        drop(primary);
        let result = Self {
            source: source_snapshot,
            backup: backup_snapshot,
            _package_lease: package_lease,
            receipt,
            source_files,
            projection,
        };
        result.recheck(source, package, options, started)?;
        Ok(result)
    }
    fn recheck(
        &self,
        source: &Path,
        package: &Path,
        options: &SchemaUpgradeOptions,
        started: Instant,
    ) -> Result<(), BackupError> {
        if tree(source, options, started)? != self.source_files
            || BackupReceipt::verify(package, &options.backup().control)? != self.receipt
            || compare(&self.source, &self.backup, options, started)? != self.projection
        {
            return Err(BackupError::FileMismatch);
        }
        options.check(started)
    }
}

fn compare(
    a: &SchemaUpgradeSnapshot,
    b: &SchemaUpgradeSnapshot,
    options: &SchemaUpgradeOptions,
    started: Instant,
) -> Result<([u8; 32], u64, u64), BackupError> {
    options.check(started)?;
    Ok(a.compare(
        b,
        &options.backup().control,
        started,
        options.limits.transform.max_entries.get() as u64,
        options.limits.transform.max_projection_bytes.get(),
    )?)
}

fn encode_files(files: &[BackupFile]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&(files.len() as u64).to_be_bytes());
    for file in files {
        blob(&mut out, file.path().as_bytes());
        out.extend_from_slice(&file.size().to_be_bytes());
        out.extend_from_slice(file.sha256());
    }
    out
}

fn plan_bytes(
    source: &Path,
    package: &Path,
    directory: &Path,
    inputs: &Inputs,
    envelope: &StoreSchemaEnvelope,
    options: &SchemaUpgradeOptions,
    started: Instant,
) -> Result<Vec<u8>, BackupError> {
    let mut out = PLAN_MAGIC.to_vec();
    blob(&mut out, &envelope.encode());
    blob(&mut out, PROFILE.as_bytes());
    blob(&mut out, SCOPE);
    BuildBinding::capture(&options.build_options(), started)?.encode(&mut out);
    for path in [source, package, directory] {
        blob(&mut out, &path_bytes(path)?);
    }
    out.extend_from_slice(&inputs.receipt.fingerprint());
    // Preserve the original backup/contributor manifest byte-for-byte inside
    // the new plan; it remains the old format and is never rewritten as v3.
    blob(&mut out, &inputs.receipt.encode());
    out.extend_from_slice(&inputs.projection.0);
    out.extend_from_slice(&inputs.projection.1.to_be_bytes());
    out.extend_from_slice(&inputs.projection.2.to_be_bytes());
    out.extend_from_slice(&envelope_checksum(
        PLAN_MAGIC,
        &encode_files(&inputs.source_files),
    ));
    for value in [
        options.backup().max_files.get() as u64,
        options.backup().max_bytes.get(),
        options.limits.transform.max_entries.get() as u64,
        options.limits.transform.max_projection_bytes.get(),
        options.limits.max_attempts.get() as u64,
    ] {
        out.extend_from_slice(&value.to_be_bytes());
    }
    out.extend_from_slice(&envelope_checksum(PLAN_MAGIC, &out));
    if out.len() > MAX_MANIFEST {
        return Err(BackupError::Limit);
    }
    Ok(out)
}

fn start_inner(
    source: &Path,
    package: &Path,
    destination: &Path,
    options: &SchemaUpgradeOptions,
) -> Result<SchemaUpgradeState, BackupError> {
    let started = Instant::now();
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    stable_directory(parent)?;
    let directory = fresh_destination(destination, &source)?;
    disjoint(&source, &package, &directory)?;
    let inputs = Inputs::open(&source, &package, options, started)?;
    let envelope = StoreSchemaEnvelope::create_upgrade(options.rdf_write_profile);
    let plan = plan_bytes(
        &source, &package, &directory, &inputs, &envelope, options, started,
    )?;
    private_directory(&directory)?;
    let _lease = WorkspaceLease::create(&directory)?;
    private_directory(&directory.join("attempts"))?;
    write(&directory.join(PLAN), &plan)?;
    write(&directory.join(JOURNAL), &[])?;
    sync_directory(&directory.join("attempts"))?;
    sync_directory(&directory)?;
    sync_directory(directory.parent().ok_or(BackupError::InvalidPath)?)?;
    inputs.recheck(&source, &package, options, started)?;
    Ok(SchemaUpgradeState {
        directory,
        envelope,
        receipt: None,
    })
}

#[derive(Clone)]
struct Record {
    kind: u8,
    attempt: u64,
    files: Vec<BackupFile>,
}

fn frame(record: &Record, previous: &[u8; 32]) -> Vec<u8> {
    let mut body = JOURNAL_MAGIC.to_vec();
    body.extend_from_slice(previous);
    body.push(record.kind);
    body.extend_from_slice(&record.attempt.to_be_bytes());
    body.extend_from_slice(&encode_files(&record.files));
    body.extend_from_slice(&envelope_checksum(JOURNAL_MAGIC, &body));
    let mut out = Vec::new();
    blob(&mut out, &body);
    out
}

fn decode_records(
    bytes: &[u8],
    plan: &[u8],
    options: &SchemaUpgradeOptions,
) -> Result<Vec<Record>, BackupError> {
    let mut input = Decode(bytes);
    let mut previous = envelope_checksum(PLAN_MAGIC, plan);
    let mut records = Vec::new();
    let mut attempts = 0_u64;
    while !input.0.is_empty() {
        if records.len() >= options.limits.max_attempts.get().saturating_mul(2) + 2 {
            return Err(BackupError::Limit);
        }
        let body = input.blob(MAX_MANIFEST)?;
        let mut fields = Decode(body);
        if fields.take(JOURNAL_MAGIC.len())? != JOURNAL_MAGIC || fields.hash()? != previous {
            return Err(BackupError::InvalidManifest);
        }
        let kind = fields.take(1)?[0];
        let attempt = fields.u64()?;
        let count = usize::try_from(fields.u64()?).map_err(|_| BackupError::Limit)?;
        if count > options.backup().max_files.get() {
            return Err(BackupError::Limit);
        }
        let mut files = Vec::new();
        for _ in 0..count {
            let path = std::str::from_utf8(fields.blob(4096)?)
                .map_err(|_| BackupError::InvalidPath)?
                .to_owned();
            if path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
                || Path::new(&path).is_absolute()
                || files
                    .last()
                    .is_some_and(|last: &BackupFile| last.path() >= path.as_str())
            {
                return Err(BackupError::InvalidPath);
            }
            files.push(BackupFile::new(path, fields.u64()?, fields.hash()?));
        }
        fields.hash()?;
        if !fields.0.is_empty() {
            return Err(BackupError::InvalidManifest);
        }
        let record = Record {
            kind,
            attempt,
            files,
        };
        let encoded = frame(&record, &previous);
        let mut framed = Decode(&encoded);
        if framed.blob(MAX_MANIFEST)? != body {
            return Err(BackupError::InvalidManifest);
        }
        match kind {
            INTENT
                if record.files.is_empty()
                    && attempt == attempts
                    && records
                        .last()
                        .is_none_or(|last: &Record| last.kind == FAILED) =>
            {
                attempts += 1;
                if attempts > options.limits.max_attempts.get() as u64 {
                    return Err(BackupError::Limit);
                }
            }
            FAILED
                if record.files.is_empty()
                    && records
                        .last()
                        .is_some_and(|last| last.kind == INTENT && last.attempt == attempt) => {}
            VALIDATED
                if !record.files.is_empty()
                    && records
                        .last()
                        .is_some_and(|last| last.kind == INTENT && last.attempt == attempt) => {}
            SEALED
                if record.files.is_empty()
                    && records
                        .last()
                        .is_some_and(|last| last.kind == VALIDATED && last.attempt == attempt) => {}
            _ => return Err(BackupError::InvalidManifest),
        }
        previous = envelope_checksum(JOURNAL_MAGIC, &encoded);
        records.push(record);
    }
    Ok(records)
}

fn append(directory: &Path, record: Record, verified: &mut Verified) -> Result<(), BackupError> {
    let previous = if verified.journal.is_empty() {
        envelope_checksum(PLAN_MAGIC, &verified.plan)
    } else {
        let mut input = Decode(&verified.journal);
        let mut last = &[][..];
        while !input.0.is_empty() {
            let before = input.0;
            input.blob(MAX_MANIFEST)?;
            last = &before[..before.len() - input.0.len()];
        }
        envelope_checksum(JOURNAL_MAGIC, last)
    };
    let bytes = frame(&record, &previous);
    if verified
        .journal
        .len()
        .checked_add(bytes.len())
        .is_none_or(|size| size > MAX_MANIFEST)
    {
        return Err(BackupError::Limit);
    }
    let path = directory.join(JOURNAL);
    // open_regular has already verified type; O_NOFOLLOW also protects the write.
    let mut options = OpenOptions::new();
    options.append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    verified.journal.extend_from_slice(&bytes);
    verified.records.push(record);
    Ok(())
}

struct Verified {
    envelope: StoreSchemaEnvelope,
    plan: Vec<u8>,
    journal: Vec<u8>,
    records: Vec<Record>,
    // All completed output native leases span final input checks and sealing.
    _outputs: Vec<SchemaUpgradeSnapshot>,
}

fn verify_workspace(
    directory: &Path,
    source: &Path,
    package: &Path,
    inputs: &Inputs,
    options: &SchemaUpgradeOptions,
    started: Instant,
) -> Result<Verified, BackupError> {
    let plan = read(&directory.join(PLAN), MAX_MANIFEST)?;
    let mut fields = Decode(&plan);
    if fields.take(PLAN_MAGIC.len())? != PLAN_MAGIC {
        return Err(BackupError::InvalidManifest);
    }
    let envelope =
        StoreSchemaEnvelope::decode(fields.blob(512)?).ok_or(BackupError::InvalidManifest)?;
    if envelope.logical_version() != 3
        || envelope.rdf_write_profile() != options.rdf_write_profile
        || plan
            != plan_bytes(
                source, package, directory, inputs, &envelope, options, started,
            )?
    {
        return Err(BackupError::InvalidManifest);
    }
    let journal = read(&directory.join(JOURNAL), MAX_MANIFEST)?;
    let records = decode_records(&journal, &plan, options)?;
    scan_workspace(directory, &records, &inputs.receipt, options, started)?;
    let mut outputs = Vec::new();
    for record in records.iter().filter(|record| record.kind == VALIDATED) {
        let attempt = attempt_path(directory, record.attempt);
        if tree(&attempt, options, started)? != record.files {
            return Err(BackupError::FileMismatch);
        }
        let output = verify_output(&attempt, inputs, &envelope, options, started)?;
        if tree(&attempt, options, started)? != record.files {
            return Err(BackupError::FileMismatch);
        }
        outputs.push(output);
    }
    inputs.recheck(source, package, options, started)?;
    Ok(Verified {
        envelope,
        plan,
        journal,
        records,
        _outputs: outputs,
    })
}

fn attempt_path(directory: &Path, attempt: u64) -> PathBuf {
    directory.join("attempts").join(format!("{attempt:016}"))
}

fn verify_output(
    attempt: &Path,
    inputs: &Inputs,
    envelope: &StoreSchemaEnvelope,
    options: &SchemaUpgradeOptions,
    started: Instant,
) -> Result<SchemaUpgradeSnapshot, BackupError> {
    if read(&attempt.join("store").join(UPGRADE_GUARD), GUARD.len())? != GUARD {
        return Err(BackupError::InvalidManifest);
    }
    let output = SchemaUpgradeSnapshot::open(
        &attempt.join("store"),
        true,
        &envelope.encode(),
        &options.backup().store_options,
    )?;
    if compare(&inputs.source, &output, options, started)? != inputs.projection {
        return Err(BackupError::FileMismatch);
    }
    let actual = tree(attempt, options, started)?;
    let external: Vec<_> = actual
        .iter()
        .filter(|file| !file.path().starts_with("store/"))
        .cloned()
        .collect();
    let expected: Vec<_> = inputs
        .receipt
        .files()
        .iter()
        .filter(|file| !file.path().starts_with("store/"))
        .cloned()
        .collect();
    if external != expected {
        return Err(BackupError::FileMismatch);
    }
    Ok(output)
}

fn resume_inner(
    source: &Path,
    package: &Path,
    directory: &Path,
    options: &SchemaUpgradeOptions,
    mut fault: impl FnMut(u8) -> Result<(), BackupError>,
) -> Result<SchemaUpgradeState, BackupError> {
    let started = Instant::now();
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let directory = stable_directory(directory)?;
    disjoint(&source, &package, &directory)?;
    let _lease = WorkspaceLease::acquire(&directory)?;
    let inputs = Inputs::open(&source, &package, options, started)?;
    let mut verified = verify_workspace(&directory, &source, &package, &inputs, options, started)?;
    if directory.join(COMPLETE).try_exists()? {
        let receipt = make_receipt(&directory, &inputs, &verified)?;
        if read(&directory.join(COMPLETE), MAX_MANIFEST)? != receipt_bytes(&verified)
            || directory.join(PENDING).try_exists()?
        {
            return Err(BackupError::InvalidManifest);
        }
        return Ok(SchemaUpgradeState {
            directory,
            envelope: verified.envelope.clone(),
            receipt: Some(receipt),
        });
    }
    if verified
        .records
        .last()
        .is_none_or(|record| matches!(record.kind, INTENT | FAILED))
    {
        let attempt = verified
            .records
            .iter()
            .filter(|record| record.kind == INTENT)
            .count() as u64;
        if attempt >= options.limits.max_attempts.get() as u64 {
            return Err(BackupError::Limit);
        }
        if let Some(previous) = verified
            .records
            .last()
            .filter(|record| record.kind == INTENT)
        {
            let abandoned = previous.attempt;
            append(
                &directory,
                Record {
                    kind: FAILED,
                    attempt: abandoned,
                    files: Vec::new(),
                },
                &mut verified,
            )?;
        }
        append(
            &directory,
            Record {
                kind: INTENT,
                attempt,
                files: Vec::new(),
            },
            &mut verified,
        )?;
        fault(0)?;
        let path = attempt_path(&directory, attempt);
        private_directory(&path)?;
        private_directory(&path.join("store"))?;
        write(&path.join("store").join(UPGRADE_GUARD), GUARD)?;
        sync_directory(&path.join("store"))?;
        sync_directory(&path)?;
        sync_directory(&directory.join("attempts"))?;
        fault(1)?;
        for file in inputs.receipt.files() {
            options.check(started)?;
            let target = path.join(file.path());
            create_parents(&path, target.parent().ok_or(BackupError::InvalidPath)?)?;
            // Receipt paths are package-relative; the artifact name must stay a
            // flat validated name. The copy binds source, target, size and hash.
            copy_artifact(
                &BackupArtifact::new(
                    file.path().replace('/', "_"),
                    package.join(file.path()),
                    file.size(),
                    *file.sha256(),
                )?,
                &target,
                &options.backup().control,
                started,
            )?;
            fault(2)?;
        }
        let copy = SchemaUpgradeSnapshot::open(
            &path.join("store"),
            false,
            &2_u64.to_be_bytes(),
            &options.backup().store_options,
        )?;
        if compare(&inputs.source, &copy, options, started)? != inputs.projection {
            return Err(BackupError::FileMismatch);
        }
        drop(copy);
        fault(3)?;
        options.check(started)?;
        SchemaUpgradeSnapshot::write_envelope(
            &path.join("store"),
            &verified.envelope,
            &options.backup().store_options,
        )?;
        fault(4)?;
        let output = verify_output(&path, &inputs, &verified.envelope, options, started)?;
        // Receipt paths are not limited to store/: create_parents may have made
        // directories at any depth under the attempt, such as a contributors
        // subtree, so every one of them is synced before the attempt root.
        sync_tree(&path)?;
        sync_directory(&path)?;
        let files = tree(&path, options, started)?;
        inputs.recheck(&source, &package, options, started)?;
        fault(5)?;
        append(
            &directory,
            Record {
                kind: VALIDATED,
                attempt,
                files,
            },
            &mut verified,
        )?;
        verified._outputs.push(output);
        fault(6)?;
    }
    if verified
        .records
        .last()
        .is_some_and(|record| record.kind == VALIDATED)
    {
        let attempt = verified
            .records
            .last()
            .ok_or(BackupError::InvalidManifest)?
            .attempt;
        append(
            &directory,
            Record {
                kind: SEALED,
                attempt,
                files: Vec::new(),
            },
            &mut verified,
        )?;
        fault(7)?;
    }
    let receipt = make_receipt(&directory, &inputs, &verified)?;
    let bytes = receipt_bytes(&verified);
    if directory.join(PENDING).try_exists()? {
        if read(&directory.join(PENDING), MAX_MANIFEST)? != bytes {
            return Err(BackupError::InvalidManifest);
        }
    } else {
        write(&directory.join(PENDING), &bytes)?;
    }
    sync_directory(&directory)?;
    fault(8)?;
    inputs.recheck(&source, &package, options, started)?;
    fs::rename(directory.join(PENDING), directory.join(COMPLETE))?;
    fault(9).map_err(indeterminate)?;
    sync_directory(&directory).map_err(BackupError::CompletionIndeterminate)?;
    Ok(SchemaUpgradeState {
        directory,
        envelope: verified.envelope.clone(),
        receipt: Some(receipt),
    })
}

fn receipt_bytes(verified: &Verified) -> Vec<u8> {
    let mut out = RECEIPT_MAGIC.to_vec();
    out.extend_from_slice(&envelope_checksum(PLAN_MAGIC, &verified.plan));
    out.extend_from_slice(&envelope_checksum(JOURNAL_MAGIC, &verified.journal));
    out.extend_from_slice(&envelope_checksum(RECEIPT_MAGIC, &out));
    out
}
fn make_receipt(
    directory: &Path,
    inputs: &Inputs,
    verified: &Verified,
) -> Result<SchemaUpgradeReceipt, BackupError> {
    let last = verified
        .records
        .last()
        .filter(|record| record.kind == SEALED)
        .ok_or(BackupError::InvalidManifest)?;
    Ok(SchemaUpgradeReceipt {
        directory: directory.to_owned(),
        envelope: verified.envelope.clone(),
        attempt: last.attempt,
        backup: inputs.receipt.fingerprint(),
        projection: inputs.projection.0,
        records: inputs.projection.1,
        bytes: inputs.projection.2,
        fingerprint: envelope_checksum(RECEIPT_MAGIC, &receipt_bytes(verified)),
    })
}

fn create_parents(root: &Path, path: &Path) -> Result<(), BackupError> {
    let mut current = root.to_owned();
    for component in path
        .strip_prefix(root)
        .map_err(|_| BackupError::InvalidPath)?
        .components()
    {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err(BackupError::InvalidPath);
        }
        current.push(component);
        if current.try_exists()? {
            stable_directory(&current)?;
        } else {
            private_directory(&current)?;
        }
    }
    Ok(())
}

/// Syncs every directory below root, deepest first. The caller syncs root itself.
fn sync_tree(root: &Path) -> Result<(), BackupError> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            sync_tree(&entry.path())?;
            sync_directory(&entry.path())?;
        }
    }
    Ok(())
}

fn tree(
    root: &Path,
    options: &SchemaUpgradeOptions,
    started: Instant,
) -> Result<Vec<BackupFile>, BackupError> {
    fn visit(
        root: &Path,
        directory: &Path,
        options: &SchemaUpgradeOptions,
        started: Instant,
        files: &mut Vec<BackupFile>,
        total: &mut u64,
        visited: &mut usize,
        depth: usize,
    ) -> Result<(), BackupError> {
        if depth > 8 {
            return Err(BackupError::Limit);
        }
        for entry in fs::read_dir(directory)? {
            options.check(started)?;
            let entry = entry?;
            *visited = visited
                .checked_add(1)
                .filter(|count| *count <= options.backup().max_files.get().saturating_mul(2))
                .ok_or(BackupError::Limit)?;
            let kind = entry.file_type()?;
            if kind.is_dir() {
                visit(
                    root,
                    &entry.path(),
                    options,
                    started,
                    files,
                    total,
                    visited,
                    depth + 1,
                )?;
            } else if kind.is_file() {
                if files.len() >= options.backup().max_files.get() {
                    return Err(BackupError::Limit);
                }
                let (size, hash) = hash_file(
                    &entry.path(),
                    &options.backup().control,
                    started,
                    options.backup().max_bytes.get().saturating_sub(*total),
                    false,
                )?;
                *total = total.checked_add(size).ok_or(BackupError::Limit)?;
                let path = entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|_| BackupError::InvalidPath)?
                    .to_str()
                    .ok_or(BackupError::InvalidPath)?
                    .to_owned();
                files.push(BackupFile::new(path, size, hash));
            } else {
                return Err(BackupError::InvalidPath);
            }
        }
        Ok(())
    }
    stable_directory(root)?;
    let mut files = Vec::new();
    visit(root, root, options, started, &mut files, &mut 0, &mut 0, 0)?;
    files.sort_unstable_by(|a, b| a.path().cmp(b.path()));
    Ok(files)
}

fn scan_workspace(
    directory: &Path,
    records: &[Record],
    backup: &BackupReceipt,
    options: &SchemaUpgradeOptions,
    started: Instant,
) -> Result<(), BackupError> {
    let mut names = BTreeSet::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        let kind = entry.file_type()?;
        match name.as_str() {
            "attempts" if kind.is_dir() => {}
            PLAN | JOURNAL | COMPLETE | PENDING if kind.is_file() => {}
            WORKSPACE_LOCK if kind.is_file() && entry.metadata()?.len() == 0 => {}
            _ => return Err(BackupError::InvalidPath),
        }
        names.insert(name);
    }
    if ![PLAN, JOURNAL, WORKSPACE_LOCK, "attempts"]
        .iter()
        .all(|name| names.contains(*name))
    {
        return Err(BackupError::InvalidManifest);
    }
    if (names.contains(COMPLETE) || names.contains(PENDING))
        && records.last().is_none_or(|record| record.kind != SEALED)
    {
        return Err(BackupError::InvalidManifest);
    }
    let intents: BTreeSet<_> = records
        .iter()
        .filter(|record| record.kind == INTENT)
        .map(|record| format!("{:016}", record.attempt))
        .collect();
    let mut count = 0;
    for entry in fs::read_dir(directory.join("attempts"))? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if !entry.file_type()?.is_dir() || !intents.contains(&name) {
            return Err(BackupError::InvalidPath);
        }
        count += 1;
        if count > options.limits.max_attempts.get() {
            return Err(BackupError::Limit);
        }
        check_attempt_directories(&entry.path(), backup)?;
        for file in tree(&entry.path(), options, started)? {
            let name = file.path();
            let allowed = name == format!("store/{UPGRADE_GUARD}")
                || name
                    .strip_prefix("store/")
                    .is_some_and(|name| !name.contains('/') && transformed_native_name(name))
                || backup
                    .files()
                    .iter()
                    .any(|expected| expected.path() == name && !name.starts_with("store/"));
            if !allowed {
                return Err(BackupError::InvalidPath);
            }
        }
    }
    Ok(())
}

fn check_attempt_directories(root: &Path, backup: &BackupReceipt) -> Result<(), BackupError> {
    let mut allowed = BTreeSet::from(["store".to_owned()]);
    for file in backup.files() {
        let mut parent = Path::new(file.path()).parent();
        while let Some(path) = parent.filter(|path| !path.as_os_str().is_empty()) {
            allowed.insert(path.to_str().ok_or(BackupError::InvalidPath)?.to_owned());
            parent = path.parent();
        }
    }
    fn visit(root: &Path, path: &Path, allowed: &BTreeSet<String>) -> Result<(), BackupError> {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let relative = entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|_| BackupError::InvalidPath)?
                    .to_str()
                    .ok_or(BackupError::InvalidPath)?
                    .to_owned();
                if !allowed.contains(&relative) {
                    return Err(BackupError::InvalidPath);
                }
                visit(root, &entry.path(), allowed)?;
            }
        }
        Ok(())
    }
    visit(root, root, &allowed)
}

#[cfg(all(test, target_os = "linux"))]
#[path = "schema_upgrade_tests.rs"]
mod tests;
