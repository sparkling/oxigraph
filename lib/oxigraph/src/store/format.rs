//! Read-only physical format observations; not upgrade or compatibility approval.
use super::{StorageError, Store};
use crate::storage::Storage;
use std::path::Path;

/// Classification of the legacy `oxversion` marker, not of the store's contents.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum StoreVersionStatus {
    /// No marker exists. Inspection never stamps a missing marker.
    Missing,
    /// The marker is not an eight-byte big-endian integer.
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
/// These legacy fields do not record an RDF feature profile, a governed store
/// identity, or an upgrade journal. This is not a validation, backup, upgrade,
/// readiness, or compatibility receipt. In particular a current version marker
/// may coexist with a missing column family or invalid logical data.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoreFormatInfo {
    storage_version: Option<u64>,
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
        Self {
            storage_version: marker
                .and_then(|value| value.try_into().ok())
                .map(u64::from_be_bytes),
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

    /// Parsed marker value, absent for a missing or malformed marker.
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
}
