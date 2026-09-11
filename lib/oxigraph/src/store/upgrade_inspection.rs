//! Read-only verification of an existing exact-build-bound upgrade workspace.
use super::*;

/// Verified durable state of an exact-build-bound outer upgrade workspace.
///
/// These states describe existing evidence only. They do not authorize resume,
/// activation, routing, publication, or use of the transformed store.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum UpgradeWorkspaceState {
    /// The outer progress chain contains only its initial record.
    Initial,
    /// The outer progress chain records running intent.
    Running,
    /// Recovery completed and the complete outer record exists, but no receipt does.
    CompleteUnsealed,
    /// A complete receipt is present under its pending publication name.
    ReceiptPending,
    /// The complete receipt is present under its final publication name.
    Sealed,
}

impl UpgradeWorkspaceState {
    /// Returns the stable CLI label for this observation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Initial => "initial",
            Self::Running => "running",
            Self::CompleteUnsealed => "complete-unsealed",
            Self::ReceiptPending => "receipt-pending",
            Self::Sealed => "sealed",
        }
    }
}

/// A verified, non-mutating observation of an outer upgrade workspace.
///
/// Inspection binds the current executable and persisted profile, exact legacy
/// backup ancestry, outer progress chain, and nested recovery evidence. A
/// pending receipt is decoded and compared byte-for-byte with the receipt
/// derived from that evidence. This value is not an UpgradeReceipt and grants
/// no resume, activation, compatibility, or production authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeWorkspaceInspection {
    directory: PathBuf,
    state: UpgradeWorkspaceState,
    build: BuildBinding,
    legacy: LegacyBackupReceipt,
    logical: [u8; 32],
    counts: [u64; 3],
    transformed: Option<[u8; 32]>,
    receipt: Option<[u8; 32]>,
    recovery: Option<UpgradeRecovery>,
    sealed_receipt: Option<UpgradeReceipt>,
}

impl UpgradeWorkspaceInspection {
    /// Returns the canonical outer workspace path.
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Returns the verified durable outer-workspace state.
    pub const fn state(&self) -> UpgradeWorkspaceState {
        self.state
    }

    /// Returns the exact build-bound profile label.
    #[expect(
        clippy::unused_self,
        reason = "the profile is an invariant of every inspection in this format"
    )]
    pub const fn profile(&self) -> &'static str {
        PROFILE
    }

    /// Returns the length of the exact executable bound by the preflight.
    pub const fn executable_len(&self) -> u64 {
        self.build.executable_len
    }

    /// Returns the SHA-256 of the exact executable bound by the preflight.
    pub const fn executable_sha256(&self) -> [u8; 32] {
        self.build.executable_sha256
    }

    /// Returns the RDF feature bit bound by the preflight.
    pub const fn rdf12(&self) -> bool {
        self.build.rdf12
    }

    /// Returns the bound RocksDB build kind.
    pub fn rocksdb_build_kind(&self) -> &str {
        &self.build.rocksdb_build_kind
    }

    /// Returns the bound RocksDB version.
    pub fn rocksdb_version(&self) -> &str {
        &self.build.rocksdb_version
    }

    /// Returns the bound RocksDB source revision.
    pub fn rocksdb_source_revision(&self) -> &str {
        &self.build.rocksdb_source_revision
    }

    /// Returns the independently verified legacy backup receipt.
    pub const fn legacy_backup(&self) -> &LegacyBackupReceipt {
        &self.legacy
    }

    /// Returns the verified logical content fingerprint.
    pub const fn logical_fingerprint(&self) -> [u8; 32] {
        self.logical
    }

    /// Returns the verified quad count.
    pub const fn quad_count(&self) -> u64 {
        self.counts[0]
    }

    /// Returns the verified named-graph count.
    pub const fn named_graph_count(&self) -> u64 {
        self.counts[1]
    }

    /// Returns the verified namespace count.
    pub const fn namespace_count(&self) -> u64 {
        self.counts[2]
    }

    /// Returns the transformed-output fingerprint when recovery completed.
    pub const fn transformed_fingerprint(&self) -> Option<[u8; 32]> {
        self.transformed
    }

    /// Returns a receipt fingerprint only for an exactly verified pending or sealed receipt.
    pub const fn receipt_fingerprint(&self) -> Option<[u8; 32]> {
        self.receipt
    }

    /// Returns the nested recovery observation for an unsealed outer workspace.
    pub const fn recovery(&self) -> Option<&UpgradeRecovery> {
        self.recovery.as_ref()
    }

    /// Returns the receipt only when its complete-last publication name was verified.
    pub const fn sealed_receipt(&self) -> Option<&UpgradeReceipt> {
        self.sealed_receipt.as_ref()
    }

    /// Returns false because inspection never activates an output.
    #[expect(
        clippy::unused_self,
        reason = "inspection never constructs an active observation"
    )]
    pub const fn active(&self) -> bool {
        false
    }

    /// Returns false because inspection grants no upgrade authority.
    #[expect(
        clippy::unused_self,
        reason = "inspection never grants upgrade authority"
    )]
    pub const fn upgrade_authorized(&self) -> bool {
        false
    }

    fn from_recovery(
        directory: PathBuf,
        state: UpgradeWorkspaceState,
        build: BuildBinding,
        recovery: UpgradeRecovery,
        receipt: Option<[u8; 32]>,
    ) -> Self {
        let transformed = recovery.transformed().map(|value| value.fingerprint());
        Self {
            directory,
            state,
            build,
            legacy: recovery.legacy_backup().clone(),
            logical: recovery.logical_fingerprint(),
            counts: [
                recovery.quad_count(),
                recovery.named_graph_count(),
                recovery.namespace_count(),
            ],
            transformed,
            receipt,
            recovery: Some(recovery),
            sealed_receipt: None,
        }
    }

    fn sealed(receipt: UpgradeReceipt) -> Self {
        let fingerprint = receipt.fingerprint();
        Self {
            directory: receipt.directory().to_owned(),
            state: UpgradeWorkspaceState::Sealed,
            build: receipt.preflight.build.clone(),
            legacy: receipt.legacy_backup().clone(),
            logical: receipt.logical_fingerprint(),
            counts: [
                receipt.quad_count(),
                receipt.named_graph_count(),
                receipt.namespace_count(),
            ],
            transformed: Some(receipt.transformed_fingerprint()),
            receipt: Some(fingerprint),
            recovery: None,
            sealed_receipt: Some(receipt),
        }
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "separate read-only outer-upgrade inspection API"
)]
impl Store {
    /// Independently inspects an existing exact-build-bound upgrade workspace.
    ///
    /// Source, completed legacy backup and outer workspace must be offline,
    /// stable, exclusively controlled and pairwise disjoint. The exact running
    /// executable, persisted profile, ancestry, outer progress and complete
    /// nested recovery evidence are verified before an observation is returned.
    ///
    /// This operation never resumes, repairs, seals or activates work. A valid
    /// incomplete or pending state remains inactive and unauthorized.
    pub fn inspect_upgrade(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &UpgradeOptions,
    ) -> Result<UpgradeWorkspaceInspection, BackupError> {
        inspect_upgrade_inner(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            directory.as_ref(),
            options,
        )
    }
}

fn inspect_upgrade_inner(
    source: &Path,
    package: &Path,
    directory: &Path,
    options: &UpgradeOptions,
) -> Result<UpgradeWorkspaceInspection, BackupError> {
    let started = Instant::now();
    let build = BuildBinding::capture(options, started)?;
    let profile = ContentProfile::new(options)?;
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let directory = stable_directory(directory)?;
    disjoint(&source, &package, &directory)?;
    let outer = scan_outer(&directory, options, started)?;

    if outer.receipt {
        return verify_upgrade_leased(&source, &package, &directory, options, |receipt, _, _| {
            Ok(UpgradeWorkspaceInspection::sealed(receipt))
        });
    }

    let workspace_lease = WorkspaceLease::acquire(&directory)?;
    if scan_outer(&directory, options, started)? != outer {
        return Err(BackupError::FileMismatch);
    }
    let legacy = verify_legacy(&source, &package, options, started)?;
    let expected_preflight = Preflight::new(
        build.clone(),
        profile,
        &source,
        &package,
        &directory,
        legacy,
    )?;
    let preflight_path = directory.join(PREFLIGHT_FILE);
    let progress_path = directory.join(PROGRESS_FILE);
    let preflight_bytes = read(&preflight_path, MAX_MANIFEST)?;
    let preflight = Preflight::decode(&preflight_bytes)?;
    if preflight != expected_preflight {
        return Err(BackupError::FileMismatch);
    }
    let progress_bytes = read(&progress_path, MAX_PROGRESS_BYTES)?;
    let progress = decode_progress(&progress_bytes)?;
    let current_journal = recovery_journal(&directory, options, started)?;
    validate_progress(&progress, &preflight, &current_journal)?;
    let receipt_path = outer.pending.then(|| directory.join(RECEIPT_PENDING));
    let receipt_bytes = receipt_path
        .as_ref()
        .map(|path| read(path, MAX_MANIFEST))
        .transpose()?;

    let result = verify_recovery_leased(
        &source,
        &package,
        &directory.join(RECOVERY_DIRECTORY),
        &options.recovery,
        started,
        |recovery, journal| {
            if journal != current_journal {
                return Err(BackupError::FileMismatch);
            }
            let (state, receipt_fingerprint) =
                match (progress.len(), outer.pending, recovery.completed()) {
                    (1, false, false)
                        if progress[0].recovery_journal_len == journal.len() as u64 =>
                    {
                        (UpgradeWorkspaceState::Initial, None)
                    }
                    (2, false, _) => (UpgradeWorkspaceState::Running, None),
                    (3, false, true) => (UpgradeWorkspaceState::CompleteUnsealed, None),
                    (3, true, true) => {
                        let transformed =
                            recovery.transformed().ok_or(BackupError::InvalidManifest)?;
                        let expected = receipt_from_verified(
                            &directory,
                            preflight.clone(),
                            &preflight_bytes,
                            &progress,
                            recovery,
                            journal,
                            transformed,
                        )?;
                        let bytes = receipt_bytes
                            .as_deref()
                            .ok_or(BackupError::InvalidManifest)?;
                        (
                            UpgradeWorkspaceState::ReceiptPending,
                            Some(validate_receipt(bytes, &directory, &expected)?),
                        )
                    }
                    _ => return Err(BackupError::InvalidManifest),
                };

            check(&options.recovery.transform.backup.control, started)?;
            if BuildBinding::capture(options, started)? != build
                || read(&preflight_path, MAX_MANIFEST)? != preflight_bytes
                || read(&progress_path, MAX_PROGRESS_BYTES)? != progress_bytes
                || recovery_journal(&directory, options, started)? != journal
                || scan_outer(&directory, options, started)? != outer
            {
                return Err(BackupError::FileMismatch);
            }
            if let (Some(path), Some(bytes)) = (&receipt_path, &receipt_bytes)
                && read(path, MAX_MANIFEST)? != *bytes
            {
                return Err(BackupError::FileMismatch);
            }
            Ok(UpgradeWorkspaceInspection::from_recovery(
                directory.clone(),
                state,
                build.clone(),
                recovery.clone(),
                receipt_fingerprint,
            ))
        },
    );
    drop(workspace_lease);
    result
}

fn validate_receipt(
    bytes: &[u8],
    directory: &Path,
    expected: &UpgradeReceipt,
) -> Result<[u8; 32], BackupError> {
    let mut stored = UpgradeReceipt::decode(bytes)?;
    stored.directory = directory.to_owned();
    if &stored != expected || stored.encode() != bytes {
        return Err(BackupError::FileMismatch);
    }
    Ok(stored.fingerprint())
}
