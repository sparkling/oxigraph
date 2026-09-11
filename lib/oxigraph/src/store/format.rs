//! Read-only physical format observations; not upgrade or compatibility approval.
use super::{StorageError, Store, StoreIdentity, StoreSchemaEnvelope};
use crate::storage::Storage;
use std::path::Path;

/// Classification of the `oxversion` marker, not of the store's contents.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum StoreVersionStatus {
    /// No marker exists. Inspection never stamps a missing marker.
    Missing,
    /// The marker is neither a legacy integer nor a valid supported envelope.
    Malformed,
    /// The marker predates this binary's current storage version.
    Older,
    /// The marker equals this binary's current storage version.
    /// This does not establish logical validity or RDF-feature compatibility.
    Current,
    /// The marker is newer than this binary's current storage version.
    Newer,
}

/// Physical metadata observed without opening a writable store or migrating it.
///
/// Legacy markers have no schema envelope. A parsed envelope describes an
/// immutable write profile, not observed RDF usage or governed lineage.
/// This is not a validation, backup, upgrade,
/// readiness, or compatibility receipt. In particular a current version marker
/// may coexist with a missing column family or invalid logical data.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoreFormatInfo {
    storage_version: Option<u64>,
    schema_envelope: Option<StoreSchemaEnvelope>,
    current_storage_version: u64,
    version_marker_bytes: Option<usize>,
    column_families: Vec<String>,
    missing_column_families: Vec<String>,
    unexpected_column_families: Vec<String>,
}

impl StoreFormatInfo {
    pub(crate) fn new(
        marker: Option<&[u8]>,
        current_storage_version: u64,
        mut column_families: Vec<String>,
        mut required: Vec<&str>,
    ) -> Self {
        column_families.sort_unstable();
        required.sort_unstable();
        let schema_envelope = marker.and_then(StoreSchemaEnvelope::decode);
        let storage_version = marker
            .and_then(|value| value.try_into().ok())
            .map(u64::from_be_bytes)
            .or_else(|| {
                schema_envelope
                    .as_ref()
                    .map(StoreSchemaEnvelope::logical_version)
            });
        Self {
            storage_version,
            schema_envelope,
            current_storage_version,
            version_marker_bytes: marker.map(<[u8]>::len),
            missing_column_families: required
                .iter()
                .filter(|name| !column_families.iter().any(|actual| actual == **name))
                .map(|name| (*name).to_owned())
                .collect(),
            unexpected_column_families: column_families
                .iter()
                .filter(|name| required.binary_search(&name.as_str()).is_err())
                .cloned()
                .collect(),
            column_families,
        }
    }

    pub fn version_status(&self) -> StoreVersionStatus {
        match self.storage_version {
            None if self.version_marker_bytes.is_none() => StoreVersionStatus::Missing,
            None => StoreVersionStatus::Malformed,
            Some(version) if version < self.current_storage_version => StoreVersionStatus::Older,
            Some(version) if version > self.current_storage_version => StoreVersionStatus::Newer,
            Some(_) => StoreVersionStatus::Current,
        }
    }

    /// Parsed envelope, absent for legacy, missing or malformed markers.
    /// This does not validate stored contents against the declared profile.
    pub const fn schema_envelope(&self) -> Option<&StoreSchemaEnvelope> {
        self.schema_envelope.as_ref()
    }

    /// Parsed logical marker value, absent for a missing or malformed marker.
    pub const fn storage_version(&self) -> Option<u64> {
        self.storage_version
    }
    /// Storage marker version used by newly created stores in this binary.
    pub const fn current_storage_version(&self) -> u64 {
        self.current_storage_version
    }
    /// Marker byte length without disclosing its contents.
    pub const fn version_marker_bytes(&self) -> Option<usize> {
        self.version_marker_bytes
    }
    /// Actual column-family names from RocksDB's manifest, sorted by name.
    pub fn column_families(&self) -> &[String] {
        &self.column_families
    }
    /// Column families required by this binary but absent from the manifest.
    pub fn missing_column_families(&self) -> &[String] {
        &self.missing_column_families
    }
    /// Manifest column families not part of this binary's required inventory.
    pub fn unexpected_column_families(&self) -> &[String] {
        &self.unexpected_column_families
    }
}

/// Recognized RDF requirements observed by an explicit offline content inspection.
///
/// This report covers only the current-format live object-leading indexes and
/// the physically retained governed outbox records described by its accessors.
/// It is not a schema envelope or a complete compatibility/validity claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoreFeatureInspection {
    format: StoreFormatInfo,
    live_rdf_12_required: bool,
    retained_outbox_rdf_12_required: bool,
    retained_outbox_records: u64,
    retained_outbox_from: Option<u64>,
    retained_outbox_through: Option<u64>,
    outbox_coverage_after_receipt_sequence: Option<u64>,
    expired_outbox_history_unexamined: bool,
}

impl StoreFeatureInspection {
    pub(crate) fn new(
        format: StoreFormatInfo,
        live_rdf_12_required: bool,
        retained_outbox_rdf_12_required: bool,
        retained_outbox_records: u64,
        retained_outbox_from: Option<u64>,
        retained_outbox_through: Option<u64>,
        outbox_coverage_after_receipt_sequence: Option<u64>,
        expired_outbox_history_unexamined: bool,
    ) -> Self {
        Self {
            format,
            live_rdf_12_required,
            retained_outbox_rdf_12_required,
            retained_outbox_records,
            retained_outbox_from,
            retained_outbox_through,
            outbox_coverage_after_receipt_sequence,
            expired_outbox_history_unexamined,
        }
    }

    /// Returns the physical format information used to authorize this inspection.
    pub const fn format_info(&self) -> &StoreFormatInfo {
        &self.format
    }

    /// Returns whether a recognized RDF 1.2-only term occurs in live object indexes.
    pub const fn live_rdf_12_required(&self) -> bool {
        self.live_rdf_12_required
    }

    /// Returns whether a recognized RDF 1.2-only term occurs in retained outbox payloads.
    pub const fn retained_outbox_rdf_12_required(&self) -> bool {
        self.retained_outbox_rdf_12_required
    }

    /// Returns whether either inspected scope requires RDF 1.2.
    pub const fn rdf_12_required(&self) -> bool {
        self.live_rdf_12_required || self.retained_outbox_rdf_12_required
    }

    /// Returns whether this binary was built with RDF 1.2 support.
    pub const fn rdf_12_supported(&self) -> bool {
        cfg!(feature = "rdf-12")
    }

    /// Returns whether the inspected requirements exceed this binary's support.
    pub const fn rdf_12_unsupported(&self) -> bool {
        self.rdf_12_required() && !self.rdf_12_supported()
    }

    /// Returns the number of physically retained outbox records inspected.
    pub const fn retained_outbox_records(&self) -> u64 {
        self.retained_outbox_records
    }

    /// Returns the first inspected physical outbox position, if any.
    pub const fn retained_outbox_from(&self) -> Option<u64> {
        self.retained_outbox_from
    }

    /// Returns the last inspected physical outbox position, if any.
    pub const fn retained_outbox_through(&self) -> Option<u64> {
        self.retained_outbox_through
    }

    /// Returns the receipt sequence immediately before governed outbox coverage.
    pub const fn outbox_coverage_after_receipt_sequence(&self) -> Option<u64> {
        self.outbox_coverage_after_receipt_sequence
    }

    /// Returns whether physically expired outbox history was outside the inspection.
    pub const fn expired_outbox_history_unexamined(&self) -> bool {
        self.expired_outbox_history_unexamined
    }
}

/// Observation of whether an inactive-upgrade guard directory entry exists.
///
/// Absence means only that the marker entry was not present during inspection;
/// it is not upgrade readiness or journal-consistency evidence.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum UpgradeGuardInspectionStatus {
    /// A filesystem entry exists at the guard path.
    Present,
    /// No filesystem entry exists at the guard path.
    Absent,
}

/// Whether governed lineage state was eligible for and observed by inspection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum GovernanceStateInspectionStatus {
    /// A current-layout governance record was decoded and validated.
    Present,
    /// The exact current layout contains no governance record.
    Absent,
    /// The physical layout was not the exact current layout, so bytes were not interpreted.
    NotInspected,
}

/// Explicit offline observation of the upgrade guard and governed lineage state.
///
/// Governance bytes are interpreted only for the exact current version and
/// complete known column-family inventory. A lineage identity is an opaque
/// 128-bit identity preserved by backups, not a UUID or a schema identifier.
/// This report does not establish full logical consistency, upgrade readiness,
/// journal completeness, RDF compatibility, or a schema envelope.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoreStateInspection {
    format: StoreFormatInfo,
    upgrade_guard_status: UpgradeGuardInspectionStatus,
    governance_status: GovernanceStateInspectionStatus,
    lineage_identity: Option<StoreIdentity>,
    receipt_sequence: Option<u64>,
}

impl StoreStateInspection {
    pub(crate) fn new(
        format: StoreFormatInfo,
        upgrade_guard_status: UpgradeGuardInspectionStatus,
        governance_status: GovernanceStateInspectionStatus,
        lineage_identity: Option<StoreIdentity>,
        receipt_sequence: Option<u64>,
    ) -> Self {
        Self {
            format,
            upgrade_guard_status,
            governance_status,
            lineage_identity,
            receipt_sequence,
        }
    }

    /// Returns the physical format observation that bounded governance decoding.
    pub const fn format_info(&self) -> &StoreFormatInfo {
        &self.format
    }

    /// Returns whether any filesystem entry was observed at the upgrade-guard path.
    pub const fn upgrade_guard_status(&self) -> UpgradeGuardInspectionStatus {
        self.upgrade_guard_status
    }

    /// Returns whether governance was present, absent, or intentionally not inspected.
    pub const fn governance_status(&self) -> GovernanceStateInspectionStatus {
        self.governance_status
    }

    /// Returns the exact existing opaque lineage identity when governance is present.
    pub const fn lineage_identity(&self) -> Option<&StoreIdentity> {
        self.lineage_identity.as_ref()
    }

    /// Returns the governed receipt high-water sequence when governance is present.
    pub const fn receipt_sequence(&self) -> Option<u64> {
        self.receipt_sequence
    }
}

impl Store {
    /// Inspects an existing, offline disk store without creating or migrating it.
    ///
    /// Stop all writers and keep the directory unchanged during inspection, as
    /// with [`Self::open_read_only`]. Only physical metadata is inspected; no
    /// RDF, namespaces, receipts, or derived indexes are validated. A successful
    /// return does not authorize open, upgrade, cutover, or publication.
    pub fn inspect(path: impl AsRef<Path>) -> Result<StoreFormatInfo, StorageError> {
        Storage::inspect(path.as_ref())
    }

    /// Explicitly inspects recognized live and retained-outbox RDF requirements.
    ///
    /// The store must have the exact current marker and column-family layout.
    /// This offline operation never calls ordinary open, setup, or migration.
    pub fn inspect_features(
        path: impl AsRef<Path>,
    ) -> Result<StoreFeatureInspection, StorageError> {
        Self::inspect_features_with_control(path, &super::TransactionStartControl::new())
    }

    /// Equivalent to the explicit feature inspection with cooperative cancellation.
    pub fn inspect_features_with_control(
        path: impl AsRef<Path>,
        control: &super::TransactionStartControl,
    ) -> Result<StoreFeatureInspection, StorageError> {
        Storage::inspect_features(path.as_ref(), control)
    }

    /// Explicitly observes the upgrade guard and existing governed lineage state.
    ///
    /// Physical metadata is inspected first. Governance bytes are decoded only
    /// for the exact current, complete layout; invalid current governance returns
    /// corruption rather than a partial report. No writable open, setup,
    /// migration, namespace or RDF decoding is performed.
    pub fn inspect_state(path: impl AsRef<Path>) -> Result<StoreStateInspection, StorageError> {
        Self::inspect_state_with_control(path, &super::TransactionStartControl::new())
    }

    /// Equivalent to state inspection with cooperative cancellation.
    pub fn inspect_state_with_control(
        path: impl AsRef<Path>,
        control: &super::TransactionStartControl,
    ) -> Result<StoreStateInspection, StorageError> {
        Storage::inspect_state(path.as_ref(), control)
    }
}
