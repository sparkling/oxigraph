//! Exact-build-bound sealing for restartable inactive upgrades.
//!
//! This outer workspace wraps, but does not change, recovery-v1. It establishes
//! content identity and continuity for one statically embedded Linux executable.
//! A synchronized RUNNING intent is required while the nested journal is still
//! exactly initial, so a previously completed standalone recovery cannot be
//! imported as this build's work. After that intent, exclusive control by the
//! caller remains a precondition: the unsigned records do not defend against an
//! actor that deliberately fabricates or substitutes every matching record.
//! This is not activation, publication, or production qualification.
use super::resume::verify_recovery_leased;
use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
#[cfg(target_os = "linux")]
use std::ffi::CStr;
use std::fs::File;
#[cfg(target_os = "linux")]
use std::fs::Metadata;
use std::path::Path;
use std::time::Instant;

const PREFLIGHT_FILE: &str = "oxigraph-upgrade.preflight";
const PROGRESS_FILE: &str = "oxigraph-upgrade.progress";
const RECEIPT_FILE: &str = "oxigraph-upgrade.complete";
const RECEIPT_PENDING: &str = "oxigraph-upgrade.pending";
const WORKSPACE_LOCK: &str = "oxigraph-upgrade.lock";
const RECOVERY_DIRECTORY: &str = "recovery";
const PREFLIGHT_MAGIC: &[u8] = b"oxigraph.build-bound-upgrade.preflight.v1\0";
const PROGRESS_MAGIC: &[u8] = b"oxigraph.build-bound-upgrade.progress.v1\0";
const RECEIPT_MAGIC: &[u8] = b"oxigraph.build-bound-upgrade.receipt.v1\0";
const PROFILE: &str = "linux-static-vendored-rocksdb-v1";
const OUTPUT_SCOPE: &str =
    "storage-version,column-families,namespaces;governance,outbox,receipts=absent";
const INITIAL: u8 = 0;
const RUNNING: u8 = 1;
const COMPLETED: u8 = 2;
const MAX_EXECUTABLE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_PATH_BYTES: usize = 4096;
const MAX_PROGRESS_BYTES: usize = 4096;

/// Options for the exact-build-bound offline upgrade.
///
/// The persisted profile binds every recovery content limit and max_attempts.
/// A timeout/cancellation control may be replaced on resume because it controls
/// one call rather than persisted content. This profile is available only on
/// Linux when this Oxigraph implementation is in the running executable and
/// RocksDB is the reviewed vendored static build.
#[derive(Clone, Default)]
pub struct UpgradeOptions {
    pub recovery: UpgradeRecoveryOptions,
}

/// A complete, independently verifiable observation of an inactive upgrade.
///
/// The receipt binds the exact running executable bytes, the declared RDF and
/// vendored RocksDB profile, exact legacy backup receipt and source ancestry,
/// the validated recovery journal, transformed content identity and logical
/// counts. The transformed fingerprint transitively binds its strict native
/// output inventory. For the legacy profile, governed metadata, outbox records
/// and commit receipts are absent; output validation covers storage version,
/// required column families, namespaces, RDF data and named-graph topology.
///
/// This receipt does not activate the output or authenticate whoever produced
/// the records. Operator-controlled paths are an exclusive-control precondition,
/// and checksums establish procedural content continuity rather than authorship.
/// A post-RUNNING actor able to fabricate all matching files is outside this
/// unsigned, exclusively controlled path contract.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeReceipt {
    directory: PathBuf,
    preflight: Preflight,
    preflight_sha256: [u8; 32],
    progress_sha256: [u8; 32],
    recovery_journal_len: u64,
    recovery_journal_sha256: [u8; 32],
    transformed_fingerprint: [u8; 32],
    logical: [u8; 32],
    counts: [u64; 3],
    output_file_count: u64,
}

impl UpgradeReceipt {
    pub const fn manifest_name() -> &'static str {
        RECEIPT_FILE
    }
    pub const fn preflight_name() -> &'static str {
        PREFLIGHT_FILE
    }
    pub const fn progress_name() -> &'static str {
        PROGRESS_FILE
    }
    pub const fn recovery_directory() -> &'static str {
        RECOVERY_DIRECTORY
    }
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    #[expect(
        clippy::unused_self,
        reason = "the profile is an invariant of every receipt in this format"
    )]
    pub const fn profile(&self) -> &'static str {
        PROFILE
    }
    #[expect(
        clippy::unused_self,
        reason = "the metadata scope is an invariant of every receipt in this format"
    )]
    pub const fn output_metadata_scope(&self) -> &'static str {
        OUTPUT_SCOPE
    }
    pub const fn executable_len(&self) -> u64 {
        self.preflight.build.executable_len
    }
    pub const fn executable_sha256(&self) -> [u8; 32] {
        self.preflight.build.executable_sha256
    }
    pub const fn rdf12(&self) -> bool {
        self.preflight.build.rdf12
    }
    pub fn rocksdb_build_kind(&self) -> &str {
        &self.preflight.build.rocksdb_build_kind
    }
    pub fn rocksdb_version(&self) -> &str {
        &self.preflight.build.rocksdb_version
    }
    pub fn rocksdb_source_revision(&self) -> &str {
        &self.preflight.build.rocksdb_source_revision
    }
    pub fn legacy_backup(&self) -> &LegacyBackupReceipt {
        &self.preflight.legacy
    }
    pub const fn preflight_sha256(&self) -> [u8; 32] {
        self.preflight_sha256
    }
    pub const fn progress_sha256(&self) -> [u8; 32] {
        self.progress_sha256
    }
    pub const fn recovery_journal_len(&self) -> u64 {
        self.recovery_journal_len
    }
    pub const fn recovery_journal_sha256(&self) -> [u8; 32] {
        self.recovery_journal_sha256
    }
    pub const fn transformed_fingerprint(&self) -> [u8; 32] {
        self.transformed_fingerprint
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
    pub const fn output_file_count(&self) -> u64 {
        self.output_file_count
    }
    #[expect(
        clippy::unused_self,
        reason = "every sealed receipt observes an inactive output"
    )]
    pub const fn active(&self) -> bool {
        false
    }
    #[expect(
        clippy::unused_self,
        reason = "no receipt in this format grants activation authority"
    )]
    pub const fn upgrade_authorized(&self) -> bool {
        false
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        envelope_checksum(RECEIPT_MAGIC, &self.encode())
    }

    /// Independently verifies the exact build, persisted profile, ancestry,
    /// outer chain, unchanged recovery-v1 chain and guarded transformed output.
    ///
    /// Verification is read-only and retains source, backup, checkpoint, final
    /// output and outer workspace leases until every receipt byte is rechecked.
    pub fn verify(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &UpgradeOptions,
    ) -> Result<Self, BackupError> {
        verify_upgrade(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            directory.as_ref(),
            options,
        )
    }

    fn encode(&self) -> Vec<u8> {
        let mut out = RECEIPT_MAGIC.to_vec();
        blob(&mut out, &self.preflight.encode());
        out.extend_from_slice(&self.preflight_sha256);
        out.extend_from_slice(&self.progress_sha256);
        out.extend_from_slice(&self.recovery_journal_len.to_be_bytes());
        out.extend_from_slice(&self.recovery_journal_sha256);
        out.extend_from_slice(&self.transformed_fingerprint);
        out.extend_from_slice(&self.logical);
        for count in self.counts {
            out.extend_from_slice(&count.to_be_bytes());
        }
        out.extend_from_slice(&self.output_file_count.to_be_bytes());
        let checksum = envelope_checksum(RECEIPT_MAGIC, &out);
        out.extend_from_slice(&checksum);
        out
    }

    fn decode(bytes: &[u8]) -> Result<Self, BackupError> {
        let body = checked_body(bytes, RECEIPT_MAGIC)?;
        let mut input = Decode(&body[RECEIPT_MAGIC.len()..]);
        let preflight = Preflight::decode(input.blob(MAX_MANIFEST)?)?;
        let result = Self {
            directory: PathBuf::new(),
            preflight,
            preflight_sha256: input.hash()?,
            progress_sha256: input.hash()?,
            recovery_journal_len: input.u64()?,
            recovery_journal_sha256: input.hash()?,
            transformed_fingerprint: input.hash()?,
            logical: input.hash()?,
            counts: [input.u64()?, input.u64()?, input.u64()?],
            output_file_count: input.u64()?,
        };
        if !input.0.is_empty()
            || result.transformed_fingerprint == [0; 32]
            || result.output_file_count == 0
            || result.encode() != bytes
        {
            return Err(BackupError::InvalidManifest);
        }
        Ok(result)
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "separate exact-build-bound upgrade API"
)]
impl Store {
    /// Creates a fresh outer workspace and its durable exact-build preflight,
    /// then starts unchanged nested recovery-v1 and binds its initial journal.
    ///
    /// The returned recovery observation names `<destination>/recovery`. Pass
    /// the original outer `destination`, not that nested path, to
    /// [`Store::resume_upgrade`] or [`Store::verify_upgrade`]. Timeout and
    /// cancellation controls are cooperative bounds for this call only.
    pub fn start_upgrade(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        destination: impl AsRef<Path>,
        options: &UpgradeOptions,
    ) -> Result<UpgradeRecovery, BackupError> {
        start_upgrade_inner(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            destination.as_ref(),
            options,
            |_| Ok(()),
        )
    }

    /// Resumes unchanged nested recovery-v1 under the persisted exact build and
    /// content profile, then independently verifies it under retained leases
    /// before publishing the complete-last outer receipt.
    pub fn resume_upgrade(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &UpgradeOptions,
    ) -> Result<UpgradeReceipt, BackupError> {
        resume_upgrade_inner(
            source.as_ref(),
            completed_legacy_backup.as_ref(),
            directory.as_ref(),
            options,
            |_| Ok(()),
        )
    }

    /// Runs start and resume for a fresh inactive destination.
    pub fn upgrade(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        destination: impl AsRef<Path>,
        options: &UpgradeOptions,
    ) -> Result<UpgradeReceipt, BackupError> {
        let source = source.as_ref();
        let package = completed_legacy_backup.as_ref();
        let destination = destination.as_ref();
        Self::start_upgrade(source, package, destination, options)?;
        Self::resume_upgrade(source, package, destination, options)
    }

    /// Independently verifies a sealed inactive upgrade.
    pub fn verify_upgrade(
        source: impl AsRef<Path>,
        completed_legacy_backup: impl AsRef<Path>,
        directory: impl AsRef<Path>,
        options: &UpgradeOptions,
    ) -> Result<UpgradeReceipt, BackupError> {
        UpgradeReceipt::verify(source, completed_legacy_backup, directory, options)
    }
}

#[expect(
    clippy::struct_field_names,
    reason = "the explicit max prefixes distinguish persisted limits from observations"
)]
#[derive(Clone, Debug, Eq, PartialEq)]
struct ContentProfile {
    max_files: u64,
    max_bytes: u64,
    max_entries: u64,
    max_projection_bytes: u64,
    max_attempts: u64,
}

impl ContentProfile {
    fn new(options: &UpgradeOptions) -> Result<Self, BackupError> {
        if options.recovery.max_attempts.get() > 64
            || options.recovery.transform.backup.max_files.get() > 100_000
        {
            return Err(BackupError::Limit);
        }
        Ok(Self {
            max_files: options.recovery.transform.backup.max_files.get() as u64,
            max_bytes: options.recovery.transform.backup.max_bytes.get(),
            max_entries: options.recovery.transform.max_entries.get() as u64,
            max_projection_bytes: options.recovery.transform.max_projection_bytes.get(),
            max_attempts: options.recovery.max_attempts.get() as u64,
        })
    }

    fn encode(&self, out: &mut Vec<u8>) {
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

    fn decode(input: &mut Decode<'_>) -> Result<Self, BackupError> {
        let result = Self {
            max_files: input.u64()?,
            max_bytes: input.u64()?,
            max_entries: input.u64()?,
            max_projection_bytes: input.u64()?,
            max_attempts: input.u64()?,
        };
        if result.max_files == 0
            || result.max_files > 100_000
            || result.max_bytes == 0
            || result.max_entries == 0
            || result.max_projection_bytes == 0
            || result.max_attempts == 0
            || result.max_attempts > 64
        {
            return Err(BackupError::InvalidManifest);
        }
        Ok(result)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct BuildBinding {
    executable_len: u64,
    executable_sha256: [u8; 32],
    rdf12: bool,
    rocksdb_build_kind: String,
    rocksdb_version: String,
    rocksdb_source_revision: String,
}

impl BuildBinding {
    fn capture(options: &UpgradeOptions, started: Instant) -> Result<Self, BackupError> {
        check(&options.recovery.transform.backup.control, started)?;
        #[cfg(not(target_os = "linux"))]
        {
            let _ = options;
            return Err(BackupError::UnsupportedPlatform);
        }
        #[cfg(target_os = "linux")]
        {
            if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
                return Err(BackupError::UnsupportedPlatform);
            }
            let rocksdb_version =
                option_env!("OXIGRAPH_ROCKSDB_VERSION").ok_or(BackupError::UnsupportedPlatform)?;
            let rocksdb_source_revision = option_env!("OXIGRAPH_ROCKSDB_SOURCE_REVISION")
                .ok_or(BackupError::UnsupportedPlatform)?;
            let mut executable = File::open("/proc/self/exe")?;
            let before = executable.metadata()?;
            if !before.is_file() || before.len() == 0 || before.len() > MAX_EXECUTABLE_BYTES {
                return Err(BackupError::Limit);
            }
            verify_static_embedding(&before)?;
            let mut total = 0_u64;
            let mut digest = Sha256::new();
            let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
            loop {
                check(&options.recovery.transform.backup.control, started)?;
                let size = executable.read(&mut buffer)?;
                if size == 0 {
                    break;
                }
                total = total
                    .checked_add(size as u64)
                    .filter(|value| *value <= MAX_EXECUTABLE_BYTES)
                    .ok_or(BackupError::Limit)?;
                digest.update(&buffer[..size]);
            }
            let after = executable.metadata()?;
            if total != before.len() || !same_file(&before, &after) {
                return Err(BackupError::FileMismatch);
            }
            Ok(Self {
                executable_len: total,
                executable_sha256: digest.finalize().into(),
                rdf12: cfg!(feature = "rdf-12"),
                rocksdb_build_kind: "vendored".to_owned(),
                rocksdb_version: rocksdb_version.to_owned(),
                rocksdb_source_revision: rocksdb_source_revision.to_owned(),
            })
        }
    }

    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.executable_len.to_be_bytes());
        out.extend_from_slice(&self.executable_sha256);
        out.push(u8::from(self.rdf12));
        blob(out, self.rocksdb_build_kind.as_bytes());
        blob(out, self.rocksdb_version.as_bytes());
        blob(out, self.rocksdb_source_revision.as_bytes());
    }

    fn decode(input: &mut Decode<'_>) -> Result<Self, BackupError> {
        let executable_len = input.u64()?;
        let executable_sha256 = input.hash()?;
        let rdf12 = match input.take(1)? {
            [0] => false,
            [1] => true,
            _ => return Err(BackupError::InvalidManifest),
        };
        let rocksdb_build_kind = text(input, 32)?;
        let rocksdb_version = text(input, 64)?;
        let rocksdb_source_revision = text(input, 128)?;
        if executable_len == 0
            || executable_len > MAX_EXECUTABLE_BYTES
            || rocksdb_build_kind != "vendored"
            || rocksdb_version.is_empty()
            || rocksdb_source_revision.is_empty()
        {
            return Err(BackupError::InvalidManifest);
        }
        Ok(Self {
            executable_len,
            executable_sha256,
            rdf12,
            rocksdb_build_kind,
            rocksdb_version,
            rocksdb_source_revision,
        })
    }
}

#[cfg(target_os = "linux")]
#[inline(never)]
extern "C" fn upgrade_build_anchor() {
    std::hint::black_box(());
}

#[cfg(target_os = "linux")]
fn verify_static_embedding(executable: &Metadata) -> Result<(), BackupError> {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;

    #[expect(
        unsafe_code,
        reason = "dladdr observes a live function address and writes a checked Dl_info"
    )]
    // SAFETY: dladdr only observes the address of a live non-inlined function.
    // The output is zero-initialized and dli_fname is read only after success.
    let info = unsafe {
        let mut info: libc::Dl_info = std::mem::zeroed();
        if libc::dladdr(
            (upgrade_build_anchor as *const ()).cast::<libc::c_void>(),
            &raw mut info,
        ) == 0
            || info.dli_fname.is_null()
            || info.dli_fbase.is_null()
        {
            return Err(BackupError::UnsupportedPlatform);
        }
        info
    };
    #[expect(
        unsafe_code,
        reason = "successful dladdr returned a checked nonnull loader-owned C string"
    )]
    // SAFETY: successful dladdr supplies a NUL-terminated filename pointer whose
    // storage remains owned by the dynamic loader for the process lifetime.
    let name = unsafe { CStr::from_ptr(info.dli_fname) };
    let path = Path::new(std::ffi::OsStr::from_bytes(name.to_bytes()));
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()?.join(path)
    };
    let loaded = open_regular(&path)?;
    let metadata = loaded.metadata()?;
    if metadata.dev() != executable.dev() || metadata.ino() != executable.ino() {
        return Err(BackupError::UnsupportedPlatform);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn same_file(before: &Metadata, after: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    before.dev() == after.dev()
        && before.ino() == after.ino()
        && before.len() == after.len()
        && before.mtime() == after.mtime()
        && before.mtime_nsec() == after.mtime_nsec()
        && before.ctime() == after.ctime()
        && before.ctime_nsec() == after.ctime_nsec()
        && before.mode() == after.mode()
        && before.uid() == after.uid()
        && before.gid() == after.gid()
        && before.nlink() == after.nlink()
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Preflight {
    build: BuildBinding,
    profile: ContentProfile,
    source: Vec<u8>,
    package: Vec<u8>,
    workspace: Vec<u8>,
    legacy: LegacyBackupReceipt,
}

impl Preflight {
    fn new(
        build: BuildBinding,
        profile: ContentProfile,
        source: &Path,
        package: &Path,
        workspace: &Path,
        legacy: LegacyBackupReceipt,
    ) -> Result<Self, BackupError> {
        Ok(Self {
            build,
            profile,
            source: path_bytes(source)?,
            package: path_bytes(package)?,
            workspace: path_bytes(workspace)?,
            legacy,
        })
    }

    fn encode(&self) -> Vec<u8> {
        let mut out = PREFLIGHT_MAGIC.to_vec();
        blob(&mut out, PROFILE.as_bytes());
        blob(&mut out, OUTPUT_SCOPE.as_bytes());
        self.build.encode(&mut out);
        self.profile.encode(&mut out);
        blob(&mut out, &self.source);
        blob(&mut out, &self.package);
        blob(&mut out, &self.workspace);
        blob(&mut out, &self.legacy.encode());
        let checksum = envelope_checksum(PREFLIGHT_MAGIC, &out);
        out.extend_from_slice(&checksum);
        out
    }

    fn decode(bytes: &[u8]) -> Result<Self, BackupError> {
        let body = checked_body(bytes, PREFLIGHT_MAGIC)?;
        let mut input = Decode(&body[PREFLIGHT_MAGIC.len()..]);
        if text(&mut input, 128)? != PROFILE || text(&mut input, 256)? != OUTPUT_SCOPE {
            return Err(BackupError::InvalidManifest);
        }
        let result = Self {
            build: BuildBinding::decode(&mut input)?,
            profile: ContentProfile::decode(&mut input)?,
            source: input.blob(MAX_PATH_BYTES)?.to_vec(),
            package: input.blob(MAX_PATH_BYTES)?.to_vec(),
            workspace: input.blob(MAX_PATH_BYTES)?.to_vec(),
            legacy: LegacyBackupReceipt::decode(input.blob(MAX_MANIFEST)?)?,
        };
        if !input.0.is_empty()
            || result.source.is_empty()
            || result.package.is_empty()
            || result.workspace.is_empty()
            || result.encode() != bytes
        {
            return Err(BackupError::InvalidManifest);
        }
        Ok(result)
    }

    fn fingerprint(&self) -> [u8; 32] {
        raw_sha256(&self.encode())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Progress {
    kind: u8,
    preflight: [u8; 32],
    recovery_journal_len: u64,
    recovery_journal_sha256: [u8; 32],
    previous: [u8; 32],
}

impl Progress {
    fn encode(&self) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.push(self.kind);
        payload.extend_from_slice(&self.preflight);
        payload.extend_from_slice(&self.recovery_journal_len.to_be_bytes());
        payload.extend_from_slice(&self.recovery_journal_sha256);
        payload.extend_from_slice(&self.previous);
        let mut out = PROGRESS_MAGIC.to_vec();
        out.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        out.extend_from_slice(&payload);
        out.extend_from_slice(&envelope_checksum(PROGRESS_MAGIC, &out));
        out
    }

    fn decode(bytes: &[u8]) -> Result<Self, BackupError> {
        let split = bytes
            .len()
            .checked_sub(32)
            .ok_or(BackupError::InvalidManifest)?;
        let (body, checksum) = bytes.split_at(split);
        if !body.starts_with(PROGRESS_MAGIC) || envelope_checksum(PROGRESS_MAGIC, body) != checksum
        {
            return Err(BackupError::InvalidManifest);
        }
        let mut input = Decode(&body[PROGRESS_MAGIC.len()..]);
        let size = usize::try_from(input.u64()?).map_err(|_| BackupError::Limit)?;
        if size != input.0.len() {
            return Err(BackupError::InvalidManifest);
        }
        let result = Self {
            kind: input.take(1)?[0],
            preflight: input.hash()?,
            recovery_journal_len: input.u64()?,
            recovery_journal_sha256: input.hash()?,
            previous: input.hash()?,
        };
        if !input.0.is_empty() || result.recovery_journal_len == 0 || result.encode() != bytes {
            return Err(BackupError::InvalidManifest);
        }
        Ok(result)
    }

    fn fingerprint(&self) -> [u8; 32] {
        raw_sha256(&self.encode())
    }
}

fn start_upgrade_inner(
    source: &Path,
    package: &Path,
    destination: &Path,
    options: &UpgradeOptions,
    mut fault: impl FnMut(u8) -> Result<(), BackupError>,
) -> Result<UpgradeRecovery, BackupError> {
    let started = Instant::now();
    let build = BuildBinding::capture(options, started)?;
    let profile = ContentProfile::new(options)?;
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let legacy = verify_legacy(&source, &package, options, started)?;
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
    let destination = stable_directory(&destination)?;
    let workspace_lease = WorkspaceLease::create(&destination)?;
    let preflight = Preflight::new(build, profile, &source, &package, &destination, legacy)?;
    let preflight_bytes = preflight.encode();
    if preflight_bytes.len() > MAX_MANIFEST {
        return Err(BackupError::Limit);
    }
    Preflight::decode(&preflight_bytes)?;
    write(&destination.join(PREFLIGHT_FILE), &preflight_bytes)?;
    sync_directory(&destination)?;
    sync_directory(destination.parent().ok_or(BackupError::InvalidPath)?)?;
    fault(0)?;
    let recovery = Store::start_upgrade_recovery(
        &source,
        &package,
        destination.join(RECOVERY_DIRECTORY),
        &options.recovery,
    )?;
    fault(1)?;
    let journal = recovery_journal(&destination, options, started)?;
    let initial = Progress {
        kind: INITIAL,
        preflight: preflight.fingerprint(),
        recovery_journal_len: journal.len() as u64,
        recovery_journal_sha256: raw_sha256(&journal),
        previous: [0; 32],
    };
    append_progress(&destination, &initial, true)?;
    sync_directory(&destination)?;
    fault(2)?;
    drop(workspace_lease);
    Ok(recovery)
}

fn resume_upgrade_inner(
    source: &Path,
    package: &Path,
    directory: &Path,
    options: &UpgradeOptions,
    mut fault: impl FnMut(u8) -> Result<(), BackupError>,
) -> Result<UpgradeReceipt, BackupError> {
    let started = Instant::now();
    let build = BuildBinding::capture(options, started)?;
    let profile = ContentProfile::new(options)?;
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let directory = stable_directory(directory)?;
    disjoint(&source, &package, &directory)?;
    let state = scan_outer(&directory, options, started)?;
    let workspace_lease = WorkspaceLease::acquire(&directory)?;
    if scan_outer(&directory, options, started)? != state {
        return Err(BackupError::FileMismatch);
    }
    if state.receipt {
        drop(workspace_lease);
        return verify_upgrade(&source, &package, &directory, options);
    }
    if state.pending {
        return Err(BackupError::InvalidManifest);
    }
    let legacy = verify_legacy(&source, &package, options, started)?;
    let expected_preflight = Preflight::new(build, profile, &source, &package, &directory, legacy)?;
    let preflight_bytes = read(&directory.join(PREFLIGHT_FILE), MAX_MANIFEST)?;
    let preflight = Preflight::decode(&preflight_bytes)?;
    if preflight != expected_preflight {
        return Err(BackupError::FileMismatch);
    }
    let mut progress = decode_progress(&read(&directory.join(PROGRESS_FILE), MAX_PROGRESS_BYTES)?)?;
    let before_resume = recovery_journal(&directory, options, started)?;
    validate_progress(&progress, &preflight, &before_resume)?;
    if progress.len() == 1 {
        let initial = progress.first().ok_or(BackupError::InvalidManifest)?;
        if initial.recovery_journal_len != before_resume.len() as u64 {
            return Err(BackupError::FileMismatch);
        }
        let running = Progress {
            kind: RUNNING,
            preflight: preflight.fingerprint(),
            recovery_journal_len: initial.recovery_journal_len,
            recovery_journal_sha256: initial.recovery_journal_sha256,
            previous: initial.fingerprint(),
        };
        verify_recovery_leased(
            &source,
            &package,
            &directory.join(RECOVERY_DIRECTORY),
            &options.recovery,
            started,
            |verified, journal| {
                if verified.completed()
                    || journal != before_resume
                    || journal.len() as u64 != initial.recovery_journal_len
                    || raw_sha256(journal) != initial.recovery_journal_sha256
                {
                    return Err(BackupError::FileMismatch);
                }
                append_progress(&directory, &running, false)?;
                sync_directory(&directory)?;
                Ok(())
            },
        )?;
        // The verifier releases every nested native lease before the mutating
        // recovery resume below, while the outer workspace lease remains held.
        progress.push(running);
    } else if progress.get(1).is_none_or(|record| record.kind != RUNNING) {
        return Err(BackupError::InvalidManifest);
    }
    let recovery = Store::resume_upgrade_recovery(
        &source,
        &package,
        directory.join(RECOVERY_DIRECTORY),
        &options.recovery,
    )?;
    if !recovery.completed() {
        return Err(BackupError::InvalidManifest);
    }
    fault(0)?;

    verify_recovery_leased(
        &source,
        &package,
        &directory.join(RECOVERY_DIRECTORY),
        &options.recovery,
        started,
        |verified, journal| {
            let transformed = verified.transformed().ok_or(BackupError::InvalidManifest)?;
            fault(1)?;
            let completed = Progress {
                kind: COMPLETED,
                preflight: preflight.fingerprint(),
                recovery_journal_len: journal.len() as u64,
                recovery_journal_sha256: raw_sha256(journal),
                previous: progress
                    .get(1)
                    .ok_or(BackupError::InvalidManifest)?
                    .fingerprint(),
            };
            if progress.len() == 2 {
                append_progress(&directory, &completed, false)?;
                sync_directory(&directory)?;
                progress.push(completed.clone());
            } else if progress.get(2) != Some(&completed) {
                return Err(BackupError::FileMismatch);
            }
            fault(2)?;
            let receipt = receipt_from_verified(
                &directory,
                preflight.clone(),
                &preflight_bytes,
                &progress,
                verified,
                journal,
                transformed,
            )?;
            let bytes = receipt.encode();
            if bytes.len() > MAX_MANIFEST {
                return Err(BackupError::Limit);
            }
            SelfCheck::receipt(&bytes)?;
            write(&directory.join(RECEIPT_PENDING), &bytes)?;
            sync_directory(&directory)?;
            fault(3)?;
            check(&options.recovery.transform.backup.control, started)?;
            fs::rename(
                directory.join(RECEIPT_PENDING),
                directory.join(RECEIPT_FILE),
            )?;
            fault(4).map_err(indeterminate)?;
            check(&options.recovery.transform.backup.control, started).map_err(indeterminate)?;
            sync_directory(&directory).map_err(BackupError::CompletionIndeterminate)?;
            sync_directory(directory.parent().ok_or(BackupError::InvalidPath)?)
                .map_err(BackupError::CompletionIndeterminate)?;
            fault(5).map_err(indeterminate)?;
            Ok(receipt)
        },
    )
}

fn verify_upgrade(
    source: &Path,
    package: &Path,
    directory: &Path,
    options: &UpgradeOptions,
) -> Result<UpgradeReceipt, BackupError> {
    let started = Instant::now();
    let build = BuildBinding::capture(options, started)?;
    let profile = ContentProfile::new(options)?;
    let source = stable_directory(source)?;
    let package = stable_directory(package)?;
    let directory = stable_directory(directory)?;
    disjoint(&source, &package, &directory)?;
    let state = scan_outer(&directory, options, started)?;
    if !state.receipt || state.pending {
        return Err(BackupError::InvalidManifest);
    }
    let workspace_lease = WorkspaceLease::acquire(&directory)?;
    if scan_outer(&directory, options, started)? != state {
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
    let preflight_bytes = read(&directory.join(PREFLIGHT_FILE), MAX_MANIFEST)?;
    let preflight = Preflight::decode(&preflight_bytes)?;
    if preflight != expected_preflight {
        return Err(BackupError::FileMismatch);
    }
    let progress_bytes = read(&directory.join(PROGRESS_FILE), MAX_PROGRESS_BYTES)?;
    let progress = decode_progress(&progress_bytes)?;
    let current_journal = recovery_journal(&directory, options, started)?;
    validate_progress(&progress, &preflight, &current_journal)?;
    if progress.len() != 3 || progress[2].kind != COMPLETED {
        return Err(BackupError::InvalidManifest);
    }
    let receipt_bytes = read(&directory.join(RECEIPT_FILE), MAX_MANIFEST)?;
    let mut stored = UpgradeReceipt::decode(&receipt_bytes)?;

    let result = verify_recovery_leased(
        &source,
        &package,
        &directory.join(RECOVERY_DIRECTORY),
        &options.recovery,
        started,
        |verified, journal| {
            let transformed = verified.transformed().ok_or(BackupError::InvalidManifest)?;
            let expected = receipt_from_verified(
                &directory,
                preflight.clone(),
                &preflight_bytes,
                &progress,
                verified,
                journal,
                transformed,
            )?;
            stored.directory.clone_from(&directory);
            if stored != expected || stored.encode() != receipt_bytes {
                return Err(BackupError::FileMismatch);
            }
            let after = BuildBinding::capture(options, started)?;
            if after != build
                || read(&directory.join(PREFLIGHT_FILE), MAX_MANIFEST)? != preflight_bytes
                || read(&directory.join(PROGRESS_FILE), MAX_PROGRESS_BYTES)? != progress_bytes
                || read(&directory.join(RECEIPT_FILE), MAX_MANIFEST)? != receipt_bytes
                || scan_outer(&directory, options, started)? != state
            {
                return Err(BackupError::FileMismatch);
            }
            Ok(stored.clone())
        },
    )?;
    drop(workspace_lease);
    Ok(result)
}

fn verify_legacy(
    source: &Path,
    package: &Path,
    options: &UpgradeOptions,
    started: Instant,
) -> Result<LegacyBackupReceipt, BackupError> {
    let (receipt, source_lease, package_lease) = LegacyBackupReceipt::verify_ancestry_leased(
        source,
        package,
        &options.recovery.transform.backup,
        started,
    )?;
    drop(package_lease);
    drop(source_lease);
    Ok(receipt)
}

fn receipt_from_verified(
    directory: &Path,
    preflight: Preflight,
    preflight_bytes: &[u8],
    progress: &[Progress],
    recovery: &UpgradeRecovery,
    journal: &[u8],
    transformed: &TransformedUpgrade,
) -> Result<UpgradeReceipt, BackupError> {
    let last = progress.last().ok_or(BackupError::InvalidManifest)?;
    if last.kind != COMPLETED
        || last.recovery_journal_len != journal.len() as u64
        || last.recovery_journal_sha256 != raw_sha256(journal)
        || transformed.logical_fingerprint() != recovery.logical_fingerprint()
        || transformed.quad_count() != recovery.quad_count()
        || transformed.named_graph_count() != recovery.named_graph_count()
        || transformed.namespace_count() != recovery.namespace_count()
    {
        return Err(BackupError::FileMismatch);
    }
    Ok(UpgradeReceipt {
        directory: directory.to_owned(),
        preflight,
        preflight_sha256: raw_sha256(preflight_bytes),
        progress_sha256: progress_fingerprint(progress),
        recovery_journal_len: journal.len() as u64,
        recovery_journal_sha256: raw_sha256(journal),
        transformed_fingerprint: transformed.fingerprint(),
        logical: recovery.logical_fingerprint(),
        counts: [
            recovery.quad_count(),
            recovery.named_graph_count(),
            recovery.namespace_count(),
        ],
        output_file_count: transformed.files().len() as u64,
    })
}

fn recovery_journal(
    directory: &Path,
    options: &UpgradeOptions,
    started: Instant,
) -> Result<Vec<u8>, BackupError> {
    check(&options.recovery.transform.backup.control, started)?;
    read(
        &directory
            .join(RECOVERY_DIRECTORY)
            .join(UpgradeRecovery::journal_name()),
        MAX_MANIFEST,
    )
}

fn validate_progress(
    records: &[Progress],
    preflight: &Preflight,
    journal: &[u8],
) -> Result<(), BackupError> {
    if records.is_empty() || records.len() > 3 {
        return Err(BackupError::InvalidManifest);
    }
    let preflight_hash = preflight.fingerprint();
    let mut previous = [0; 32];
    for (index, record) in records.iter().enumerate() {
        if record.preflight != preflight_hash
            || record.previous != previous
            || record.kind as usize != index
        {
            return Err(BackupError::InvalidManifest);
        }
        let length =
            usize::try_from(record.recovery_journal_len).map_err(|_| BackupError::Limit)?;
        let observed = journal.get(..length).ok_or(BackupError::FileMismatch)?;
        if raw_sha256(observed) != record.recovery_journal_sha256 {
            return Err(BackupError::FileMismatch);
        }
        if record.kind == RUNNING
            && (record.recovery_journal_len != records[0].recovery_journal_len
                || record.recovery_journal_sha256 != records[0].recovery_journal_sha256)
        {
            return Err(BackupError::InvalidManifest);
        }
        if record.kind == COMPLETED && length != journal.len() {
            return Err(BackupError::FileMismatch);
        }
        previous = record.fingerprint();
    }
    Ok(())
}

fn append_progress(directory: &Path, record: &Progress, create: bool) -> Result<(), BackupError> {
    let bytes = record.encode();
    let path = directory.join(PROGRESS_FILE);
    let current = if create {
        0
    } else {
        fs::metadata(&path)?.len()
    };
    current
        .checked_add(bytes.len() as u64)
        .filter(|value| *value <= MAX_PROGRESS_BYTES as u64)
        .ok_or(BackupError::Limit)?;
    let mut options = OpenOptions::new();
    options.write(true);
    if create {
        options.create_new(true);
    } else {
        options.append(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(BackupError::InvalidPath);
    }
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

fn decode_progress(bytes: &[u8]) -> Result<Vec<Progress>, BackupError> {
    if bytes.len() > MAX_PROGRESS_BYTES {
        return Err(BackupError::Limit);
    }
    let mut rest = bytes;
    let mut records = Vec::new();
    while !rest.is_empty() {
        if !rest.starts_with(PROGRESS_MAGIC) {
            return Err(BackupError::InvalidManifest);
        }
        let at = PROGRESS_MAGIC.len();
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
        records.push(Progress::decode(frame)?);
        if records.len() > 3 {
            return Err(BackupError::InvalidManifest);
        }
        rest = &rest[end..];
    }
    Ok(records)
}

fn progress_fingerprint(records: &[Progress]) -> [u8; 32] {
    let bytes: Vec<_> = records.iter().flat_map(Progress::encode).collect();
    raw_sha256(&bytes)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct OuterState {
    receipt: bool,
    pending: bool,
}

#[expect(
    clippy::filetype_is_file,
    reason = "the sealed inventory must reject symlinks and non-regular filesystem objects"
)]
fn scan_outer(
    directory: &Path,
    options: &UpgradeOptions,
    started: Instant,
) -> Result<OuterState, BackupError> {
    let mut names = BTreeSet::new();
    let mut receipt = false;
    let mut pending = false;
    for entry in fs::read_dir(directory)? {
        check(&options.recovery.transform.backup.control, started)?;
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| BackupError::InvalidPath)?;
        if !names.insert(name.clone()) {
            return Err(BackupError::InvalidPath);
        }
        match name.as_str() {
            RECOVERY_DIRECTORY if entry.file_type()?.is_dir() => {}
            WORKSPACE_LOCK if entry.file_type()?.is_file() && entry.metadata()?.len() == 0 => {}
            PREFLIGHT_FILE
                if entry.file_type()?.is_file()
                    && entry.metadata()?.len() <= MAX_MANIFEST as u64 => {}
            PROGRESS_FILE
                if entry.file_type()?.is_file()
                    && entry.metadata()?.len() <= MAX_PROGRESS_BYTES as u64 => {}
            RECEIPT_FILE
                if entry.file_type()?.is_file()
                    && entry.metadata()?.len() <= MAX_MANIFEST as u64 =>
            {
                receipt = true;
            }
            RECEIPT_PENDING
                if entry.file_type()?.is_file()
                    && entry.metadata()?.len() <= MAX_MANIFEST as u64 =>
            {
                pending = true;
            }
            _ => return Err(BackupError::InvalidPath),
        }
    }
    let required = BTreeSet::from([
        PREFLIGHT_FILE.to_owned(),
        PROGRESS_FILE.to_owned(),
        RECOVERY_DIRECTORY.to_owned(),
        WORKSPACE_LOCK.to_owned(),
    ]);
    if !required.is_subset(&names)
        || names.len() != required.len() + usize::from(receipt) + usize::from(pending)
        || (receipt && pending)
    {
        return Err(BackupError::InvalidManifest);
    }
    Ok(OuterState { receipt, pending })
}

// A fork inherits the same open file description. Only the process that
// acquired this guard may issue an explicit unlock; File drop still closes the
// current process's descriptor.
struct WorkspaceLease {
    file: File,
    owner_pid: u32,
}

impl WorkspaceLease {
    fn create(directory: &Path) -> Result<Self, BackupError> {
        Self::open(&directory.join(WORKSPACE_LOCK), true)
    }
    fn acquire(directory: &Path) -> Result<Self, BackupError> {
        Self::open(&directory.join(WORKSPACE_LOCK), false)
    }
    fn open(path: &Path, create: bool) -> Result<Self, BackupError> {
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (path, create);
            return Err(BackupError::UnsupportedPlatform);
        }
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
            let mut options = OpenOptions::new();
            options.read(true).write(true).mode(0o600);
            if create {
                options.create_new(true);
            } else {
                options.custom_flags(libc::O_NOFOLLOW);
            }
            let file = options.open(path)?;
            let metadata = file.metadata()?;
            if !metadata.is_file() || metadata.len() != 0 || metadata.nlink() != 1 {
                return Err(BackupError::InvalidPath);
            }
            #[expect(
                unsafe_code,
                reason = "flock receives a live owned file descriptor; no pointer dereference"
            )]
            // SAFETY: flock receives a live owned file descriptor and no pointer.
            let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            if result != 0 {
                return Err(BackupError::InvalidPath);
            }
            Ok(Self {
                file,
                owner_pid: std::process::id(),
            })
        }
    }
}

impl Drop for WorkspaceLease {
    fn drop(&mut self) {
        #[cfg(target_os = "linux")]
        if self.owner_pid == std::process::id() {
            use std::os::fd::AsRawFd;
            #[expect(
                unsafe_code,
                reason = "flock receives a live owned descriptor; no pointer dereference"
            )]
            // SAFETY: the File is still owned/live. A forked child's copied
            // guard must not unlock the original process's workspace.
            let _: libc::c_int = unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
        }
        // File drop closes this process's descriptor even if explicit unlock fails.
    }
}

fn checked_body<'a>(bytes: &'a [u8], magic: &[u8]) -> Result<&'a [u8], BackupError> {
    if bytes.len() > MAX_MANIFEST {
        return Err(BackupError::Limit);
    }
    let split = bytes
        .len()
        .checked_sub(32)
        .ok_or(BackupError::InvalidManifest)?;
    let (body, checksum) = bytes.split_at(split);
    if !body.starts_with(magic) || envelope_checksum(magic, body) != checksum {
        return Err(BackupError::InvalidManifest);
    }
    Ok(body)
}

fn raw_sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn text(input: &mut Decode<'_>, max: usize) -> Result<String, BackupError> {
    std::str::from_utf8(input.blob(max)?)
        .map(str::to_owned)
        .map_err(|_| BackupError::InvalidManifest)
}

fn path_bytes(path: &Path) -> Result<Vec<u8>, BackupError> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::ffi::OsStrExt;
        let bytes = path.as_os_str().as_bytes();
        if bytes.is_empty() || bytes.len() > MAX_PATH_BYTES {
            return Err(BackupError::Limit);
        }
        Ok(bytes.to_vec())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        Err(BackupError::UnsupportedPlatform)
    }
}

struct SelfCheck;
impl SelfCheck {
    fn receipt(bytes: &[u8]) -> Result<(), BackupError> {
        let decoded = UpgradeReceipt::decode(bytes)?;
        if decoded.encode() == bytes {
            Ok(())
        } else {
            Err(BackupError::InvalidManifest)
        }
    }
}

fn indeterminate(error: BackupError) -> BackupError {
    BackupError::CompletionIndeterminate(io::Error::other(error))
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

    fn fixture(destination: &Path) -> Result {
        fs::create_dir(destination)?;
        for entry in
            fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/rocksdb_bc_data"))?
        {
            let entry = entry?;
            fs::copy(entry.path(), destination.join(entry.file_name()))?;
        }
        Ok(())
    }

    fn inventory(path: &Path) -> Result<BTreeMap<PathBuf, [u8; 32]>> {
        let mut out = BTreeMap::new();
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let relative: PathBuf = entry.file_name().into();
            if entry.file_type()?.is_dir() {
                for (child, hash) in inventory(&entry.path())? {
                    out.insert(relative.join(child), hash);
                }
            } else {
                out.insert(relative, Sha256::digest(fs::read(entry.path())?).into());
            }
        }
        Ok(out)
    }

    fn setup() -> Result<(tempfile::TempDir, PathBuf, PathBuf, PathBuf, UpgradeOptions)> {
        let root = tempfile::tempdir()?;
        let source = root.path().join("source");
        let backup = root.path().join("backup");
        let upgrade = root.path().join("upgrade");
        fixture(&source)?;
        let options = UpgradeOptions::default();
        Store::backup_legacy(&source, &backup, &options.recovery.transform.backup)?;
        Ok((root, source, backup, upgrade, options))
    }

    #[test]
    fn reencoded_build_and_profile_changes_are_semantic_mismatches() -> Result {
        if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
            return Ok(());
        }
        let (_root, source, backup, upgrade, options) = setup()?;
        Store::start_upgrade(&source, &backup, &upgrade, &options)?;
        let path = upgrade.join(PREFLIGHT_FILE);
        let mut preflight = Preflight::decode(&fs::read(&path)?)?;
        preflight.build.executable_sha256[0] ^= 1;
        fs::write(&path, preflight.encode())?;
        let before = inventory(&upgrade)?;
        assert!(Store::resume_upgrade(&source, &backup, &upgrade, &options).is_err());
        assert_eq!(inventory(&upgrade)?, before);

        let (_root, source, backup, upgrade, options) = setup()?;
        Store::start_upgrade(&source, &backup, &upgrade, &options)?;
        let path = upgrade.join(PREFLIGHT_FILE);
        let mut preflight = Preflight::decode(&fs::read(&path)?)?;
        preflight.profile.max_entries -= 1;
        fs::write(&path, preflight.encode())?;
        let before = inventory(&upgrade)?;
        assert!(Store::resume_upgrade(&source, &backup, &upgrade, &options).is_err());
        assert_eq!(inventory(&upgrade)?, before);
        Ok(())
    }

    #[test]
    fn pending_receipt_is_retained_and_never_overwritten() -> Result {
        if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
            return Ok(());
        }
        let (_root, source, backup, upgrade, options) = setup()?;
        Store::start_upgrade(&source, &backup, &upgrade, &options)?;
        let error = resume_upgrade_inner(&source, &backup, &upgrade, &options, |phase| {
            if phase == 3 {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        });
        assert!(matches!(error, Err(BackupError::Cancelled)));
        let pending = fs::read(upgrade.join(RECEIPT_PENDING))?;
        assert!(UpgradeReceipt::verify(&source, &backup, &upgrade, &options).is_err());
        assert!(Store::resume_upgrade(&source, &backup, &upgrade, &options).is_err());
        assert_eq!(fs::read(upgrade.join(RECEIPT_PENDING))?, pending);
        Ok(())
    }

    #[test]
    fn completed_progress_resumes_without_rewriting_recovery_evidence() -> Result {
        if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
            return Ok(());
        }
        let (_root, source, backup, upgrade, options) = setup()?;
        Store::start_upgrade(&source, &backup, &upgrade, &options)?;
        let result = resume_upgrade_inner(&source, &backup, &upgrade, &options, |phase| {
            if phase == 2 {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        });
        assert!(matches!(result, Err(BackupError::Cancelled)));
        assert!(!upgrade.join(RECEIPT_PENDING).exists());
        assert!(!upgrade.join(RECEIPT_FILE).exists());

        let recovery = upgrade.join(RECOVERY_DIRECTORY);
        let journal = recovery.join(UpgradeRecovery::journal_name());
        let checkpoint = recovery.join("attempts/0000000000000000/store");
        let recovery_before = inventory(&recovery)?;
        let journal_before = fs::read(&journal)?;
        let checkpoint_before = inventory(&checkpoint)?;
        let progress_before = fs::read(upgrade.join(PROGRESS_FILE))?;

        let receipt = Store::resume_upgrade(&source, &backup, &upgrade, &options)?;
        assert_eq!(
            UpgradeReceipt::verify(&source, &backup, &upgrade, &options)?,
            receipt
        );
        assert_eq!(inventory(&recovery)?, recovery_before);
        assert_eq!(fs::read(journal)?, journal_before);
        assert_eq!(inventory(&checkpoint)?, checkpoint_before);
        assert_eq!(fs::read(upgrade.join(PROGRESS_FILE))?, progress_before);
        Ok(())
    }

    #[test]
    fn preflight_and_post_rename_faults_leave_verifiable_evidence() -> Result {
        if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
            return Ok(());
        }
        let (_root, source, backup, upgrade, options) = setup()?;
        let result = start_upgrade_inner(&source, &backup, &upgrade, &options, |phase| {
            if phase == 0 {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        });
        assert!(matches!(result, Err(BackupError::Cancelled)));
        assert!(upgrade.join(PREFLIGHT_FILE).is_file());
        assert!(!upgrade.join(RECOVERY_DIRECTORY).exists());

        let (_root, source, backup, upgrade, options) = setup()?;
        Store::start_upgrade(&source, &backup, &upgrade, &options)?;
        let result = resume_upgrade_inner(&source, &backup, &upgrade, &options, |phase| {
            if phase == 4 {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        });
        assert!(matches!(
            result,
            Err(BackupError::CompletionIndeterminate(_))
        ));
        assert!(UpgradeReceipt::verify(&source, &backup, &upgrade, &options).is_ok());
        Ok(())
    }

    #[test]
    fn publication_callback_holds_every_native_and_outer_lease() -> Result {
        if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
            return Ok(());
        }
        let (_root, source, backup, upgrade, options) = setup()?;
        Store::start_upgrade(&source, &backup, &upgrade, &options)?;
        let result = resume_upgrade_inner(&source, &backup, &upgrade, &options, |phase| {
            if phase == 1 {
                assert!(WorkspaceLease::acquire(&upgrade).is_err());
                assert!(!LegacyStoreSnapshot::upgrade_lease_available(&source));
                assert!(!LegacyStoreSnapshot::upgrade_lease_available(
                    &backup.join("store")
                ));
                for entry in fs::read_dir(upgrade.join("recovery/attempts"))? {
                    let entry = entry?;
                    for store in [
                        entry.path().join("store"),
                        entry.path().join("output/store"),
                    ] {
                        if store.is_dir() {
                            assert!(!LegacyStoreSnapshot::upgrade_lease_available(&store));
                        }
                    }
                }
            }
            Ok(())
        })?;
        assert!(!result.active());
        Ok(())
    }
}
