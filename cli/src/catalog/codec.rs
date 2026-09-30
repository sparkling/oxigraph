//! Catalog v1 codec. Format semantics for `Phase`:
//!
//! `Quiescing` and the tombstone phases (`TombstoneIntent`, `TombstoneBackedUp`,
//! `Tombstoned`) are additive phase strings in catalog v1: the header and `version`
//! are unchanged. A catalog holding none of them is byte-identical to before because
//! `Entry::tombstone` is omitted when absent. These phases require materialization
//! evidence like `Validated` and `Closed`; tombstone phases also require a bounded
//! `TombstoneRecord`. Phase decoding is closed and entries deny unknown fields, so
//! older binaries fail closed on a catalog holding any of them. Encoding stays
//! canonical (decode requires byte-equal re-encoding) and readiness is never derived
//! from phase alone.
//!
//! Restore provenance is the additive optional `Entry::restore` record. It adds no
//! phase: an in-flight restore is `Reserved` (no evidence) then `Validated`, then
//! `Closed`, each with the record. The record binds the exact source tombstone
//! backup receipt and stays with the entry for its whole life. Catalogs without it
//! are byte-identical to before, and older binaries fail closed on it.
use super::{CatalogError, ManagerLimits};
use crate::repository::RepositoryId;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub(super) fn checksum(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

// Explicit versioned, length-prefixed encoding; Debug is not a storage format.
pub(super) fn format_fingerprint(version: u64, marker_bytes: usize, families: &[String]) -> String {
    let mut bytes = b"oxigraph-catalog-format-v1\0".to_vec();
    bytes.extend(version.to_be_bytes());
    bytes.extend((marker_bytes as u64).to_be_bytes());
    let mut families = families.to_vec();
    families.sort_unstable();
    bytes.extend((families.len() as u64).to_be_bytes());
    for family in families {
        bytes.extend((family.len() as u64).to_be_bytes());
        bytes.extend(family.as_bytes());
    }
    checksum(&bytes)
}

#[cfg(test)]
mod tests {
    use super::format_fingerprint;

    #[test]
    fn format_fingerprint_has_stable_vector_and_unambiguous_fields() {
        assert_eq!(
            format_fingerprint(2, 8, &["bc".into(), "a".into()]),
            "4a6a55528ae18e3a1b513df57bd52d51b89ff0899ec40a326c65da132c79a4b9"
        );
        assert_ne!(
            format_fingerprint(2, 8, &["ab".into(), "c".into()]),
            format_fingerprint(2, 8, &["a".into(), "bc".into()])
        );
        assert_ne!(
            format_fingerprint(2, 8, &["a".into()]),
            format_fingerprint(3, 8, &["a".into()])
        );
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Catalog {
    pub version: u32,
    pub generation: u64,
    pub limits: ManagerLimits,
    pub entries: Vec<Entry>,
}

/// The per-entry phase is the bounded outstanding-operation journal.
/// `Quiescing` and the tombstone phases are additive v1 phases; see the module docs.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Phase {
    Reserved,
    Validated,
    Closed,
    Quiescing,
    TombstoneIntent,
    TombstoneBackedUp,
    Tombstoned,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Entry {
    pub id: String,
    pub uuid: String,
    pub phase: Phase,
    pub changed_at: u64,
    pub evidence: Option<Materialized>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tombstone: Option<TombstoneRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restore: Option<RestoreRecord>,
}

/// Manager-owned directory identity, not a governed StoreIdentity or DB UUID.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Materialized {
    pub device: u64,
    pub inode: u64,
    pub format: String,
}

/// Bounded tombstone journal record. `attempt` is the catalog generation that wrote
/// the intent and only names the package path; it is not time. `intent_time` and
/// `deadline` are injected logical time.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TombstoneRecord {
    pub attempt: u64,
    pub intent_time: u64,
    pub deadline: u64,
    pub backup_files: u64,
    pub backup_bytes: u64,
    pub backup_timeout_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup: Option<BackupBinding>,
}

/// Exact identity of the verified recovery package, from its own receipt.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BackupBinding {
    pub fingerprint: String,
    pub database_id: String,
    pub sequence: u64,
    pub quads: u64,
    pub named_graphs: u64,
    pub namespaces: u64,
    pub files: u64,
    pub bytes: u64,
}

/// Restore provenance and journal record. Bounds and the backup binding are copied
/// from the source tombstone record; `source_attempt` names its package and, like
/// every tombstone intent, strictly precedes the sealed `source_generation`. The
/// source entry itself is never modified by a restore.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RestoreRecord {
    pub source_id: String,
    pub source_uuid: String,
    pub source_generation: u64,
    pub source_attempt: u64,
    pub attempt: u64,
    pub intent_time: u64,
    pub backup_files: u64,
    pub backup_bytes: u64,
    pub backup_timeout_ms: u64,
    pub backup: BackupBinding,
}

fn hex64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

impl TombstoneRecord {
    fn valid(&self, generation: u64, changed_at: u64, phase: Phase) -> bool {
        let binding = self.backup.as_ref().is_none_or(|b| {
            hex64(&b.fingerprint)
                && hex64(&b.database_id)
                && b.files >= 1
                && b.files <= self.backup_files
                && b.bytes <= self.backup_bytes
        });
        self.attempt >= 1
            && self.attempt <= changed_at
            && changed_at <= generation
            && (phase == Phase::TombstoneIntent) == (changed_at == self.attempt)
            && self.intent_time < self.deadline
            && (1..=100_000).contains(&self.backup_files)
            && self.backup_bytes >= 1
            && self.backup_bytes != u64::MAX
            && (1..=86_400_000).contains(&self.backup_timeout_ms)
            && binding
    }
}

impl RestoreRecord {
    fn valid(&self, entry: &Entry, generation: u64) -> bool {
        RepositoryId::parse(&self.source_id).is_ok()
            && self.source_id != entry.id
            && uuid_valid(&self.source_uuid)
            && self.source_uuid != entry.uuid
            && self.source_generation >= 1
            && self.source_generation < entry.changed_at
            && entry.changed_at <= generation
            && self.source_attempt >= 1
            && self.source_attempt < self.source_generation
            && self.attempt > self.source_generation
            && self.attempt <= entry.changed_at
            && (entry.phase == Phase::Reserved) == (entry.changed_at == self.attempt)
            && (1..=100_000).contains(&self.backup_files)
            && self.backup_bytes >= 1
            && self.backup_bytes != u64::MAX
            && (1..=86_400_000).contains(&self.backup_timeout_ms)
            && hex64(&self.backup.fingerprint)
            && hex64(&self.backup.database_id)
            && self.backup.files >= 1
            && self.backup.files <= self.backup_files
            && self.backup.bytes <= self.backup_bytes
    }
}

impl Entry {
    fn tombstone_valid(&self, generation: u64) -> bool {
        match (self.phase, &self.tombstone) {
            (Phase::TombstoneIntent, Some(t)) => {
                t.backup.is_none() && t.valid(generation, self.changed_at, self.phase)
            }
            (Phase::TombstoneBackedUp | Phase::Tombstoned, Some(t)) => {
                t.backup.is_some() && t.valid(generation, self.changed_at, self.phase)
            }
            (Phase::TombstoneIntent | Phase::TombstoneBackedUp | Phase::Tombstoned, None) => false,
            (_, tombstone) => tombstone.is_none(),
        }
    }

    fn restore_valid(&self, generation: u64) -> bool {
        self.restore
            .as_ref()
            .is_none_or(|record| record.valid(self, generation))
    }
}

pub(super) fn uuid_valid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
            }
        })
        && value.as_bytes()[14] == b'4'
        && matches!(value.as_bytes()[19], b'8' | b'9' | b'a' | b'b')
}

impl Catalog {
    pub fn validate(&self) -> Result<(), CatalogError> {
        self.limits.validate()?;
        if self.version != 1
            || self.generation == 0
            || self.entries.len() > self.limits.repositories
        {
            return Err(CatalogError::InvalidCatalog);
        }
        let mut ids = BTreeSet::new();
        let mut uuids = BTreeSet::new();
        for entry in &self.entries {
            if RepositoryId::parse(&entry.id).is_err()
                || !uuid_valid(&entry.uuid)
                || !ids.insert(&entry.id)
                || !uuids.insert(&entry.uuid)
                || entry.changed_at == 0
                || entry.changed_at > self.generation
                || (matches!(
                    entry.phase,
                    Phase::Validated
                        | Phase::Closed
                        | Phase::Quiescing
                        | Phase::TombstoneIntent
                        | Phase::TombstoneBackedUp
                        | Phase::Tombstoned
                ) && entry.evidence.is_none())
                || (entry.phase == Phase::Reserved && entry.evidence.is_some())
                || entry.evidence.as_ref().is_some_and(|e| {
                    e.inode == 0
                        || e.format.len() != 64
                        || !e.format.bytes().all(|b| b.is_ascii_hexdigit())
                })
                || !entry.tombstone_valid(self.generation)
                || !entry.restore_valid(self.generation)
            {
                return Err(CatalogError::InvalidCatalog);
            }
        }
        Ok(())
    }

    pub fn encode(&self) -> Result<Vec<u8>, CatalogError> {
        self.validate()?;
        let body = serde_json::to_vec(self).map_err(|_| CatalogError::InvalidCatalog)?;
        let mut bytes = format!("oxigraph-catalog-v1\n{}\n", checksum(&body)).into_bytes();
        bytes.extend(body);
        if bytes.len() > self.limits.catalog_bytes {
            return Err(CatalogError::Limit);
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8], limits: ManagerLimits) -> Result<Self, CatalogError> {
        if bytes.len() > limits.catalog_bytes {
            return Err(CatalogError::Limit);
        }
        let mut parts = bytes.splitn(3, |b| *b == b'\n');
        if parts.next() != Some(b"oxigraph-catalog-v1".as_slice()) {
            return Err(CatalogError::InvalidCatalog);
        }
        let hash = parts.next().ok_or(CatalogError::InvalidCatalog)?;
        let body = parts.next().ok_or(CatalogError::InvalidCatalog)?;
        if checksum(body).as_bytes() != hash {
            return Err(CatalogError::InvalidCatalog);
        }
        let value: Self = serde_json::from_slice(body).map_err(|_| CatalogError::InvalidCatalog)?;
        if value.limits != limits || value.encode()? != bytes {
            return Err(CatalogError::InvalidCatalog);
        }
        Ok(value)
    }
}

#[cfg(test)]
mod quiescing_tests {
    use super::{Catalog, CatalogError, Entry, ManagerLimits, Materialized, Phase};

    fn limits() -> ManagerLimits {
        ManagerLimits {
            repositories: 4,
            catalog_bytes: 65536,
            scan_entries: 128,
            open_handles: 2,
            store_files: 128,
            model_retention: 1,
            model_max_generation: 100,
        }
    }

    fn catalog(evidence: bool) -> Catalog {
        Catalog {
            version: 1,
            generation: 2,
            limits: limits(),
            entries: vec![Entry {
                id: "a".into(),
                uuid: "12345678-1234-4123-8123-123456789012".into(),
                phase: Phase::Quiescing,
                changed_at: 2,
                evidence: evidence.then(|| Materialized {
                    device: 1,
                    inode: 1,
                    format: "0".repeat(64),
                }),
                tombstone: None,
                restore: None,
            }],
        }
    }

    #[test]
    fn quiescing_round_trips_in_v1_and_requires_evidence() {
        let with = catalog(true);
        let bytes = with.encode().unwrap();
        assert!(bytes.starts_with(b"oxigraph-catalog-v1\n"));
        assert!(String::from_utf8_lossy(&bytes).contains(r#""phase":"Quiescing""#));
        assert_eq!(Catalog::decode(&bytes, limits()).unwrap(), with);
        assert_eq!(
            catalog(false).encode().unwrap_err(),
            CatalogError::InvalidCatalog
        );
    }
}

#[cfg(test)]
mod tombstone_tests {
    use super::{
        BackupBinding, Catalog, CatalogError, Entry, ManagerLimits, Materialized, Phase,
        TombstoneRecord,
    };
    use serde::Deserialize;

    fn limits() -> ManagerLimits {
        ManagerLimits {
            repositories: 4,
            catalog_bytes: 65536,
            scan_entries: 128,
            open_handles: 2,
            store_files: 128,
            model_retention: 1,
            model_max_generation: 100,
        }
    }

    fn record(backup: bool, attempt: u64) -> TombstoneRecord {
        TombstoneRecord {
            attempt,
            intent_time: 10,
            deadline: 11,
            backup_files: 10,
            backup_bytes: 1000,
            backup_timeout_ms: 60_000,
            backup: backup.then(|| BackupBinding {
                fingerprint: "a".repeat(64),
                database_id: "b".repeat(64),
                sequence: 7,
                quads: 1,
                named_graphs: 0,
                namespaces: 0,
                files: 3,
                bytes: 100,
            }),
        }
    }

    fn catalog(phase: Phase, changed_at: u64, tombstone: Option<TombstoneRecord>) -> Catalog {
        Catalog {
            version: 1,
            generation: 5,
            limits: limits(),
            entries: vec![Entry {
                id: "a".into(),
                uuid: "12345678-1234-4123-8123-123456789012".into(),
                phase,
                changed_at,
                evidence: Some(Materialized {
                    device: 1,
                    inode: 1,
                    format: "0".repeat(64),
                }),
                tombstone,
                restore: None,
            }],
        }
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct OldEntry {
        #[allow(dead_code)]
        id: String,
        #[allow(dead_code)]
        uuid: String,
        #[allow(dead_code)]
        phase: OldPhase,
        #[allow(dead_code)]
        changed_at: u64,
        #[allow(dead_code)]
        evidence: Option<serde_json::Value>,
    }

    #[derive(Deserialize)]
    enum OldPhase {
        Reserved,
        Validated,
        Closed,
        Quiescing,
        Failed,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct OldCatalog {
        #[allow(dead_code)]
        version: u32,
        #[allow(dead_code)]
        generation: u64,
        #[allow(dead_code)]
        limits: serde_json::Value,
        #[allow(dead_code)]
        entries: Vec<OldEntry>,
    }

    fn body(bytes: &[u8]) -> &[u8] {
        let mut newlines = bytes.iter().enumerate().filter(|(_, b)| **b == b'\n');
        let second = newlines.nth(1).unwrap().0;
        &bytes[second + 1..]
    }

    #[test]
    fn old_shape_is_unchanged_and_new_shape_round_trips_canonically() {
        let old = catalog(Phase::Closed, 2, None);
        let bytes = old.encode().unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("tombstone"));
        assert!(serde_json::from_slice::<OldCatalog>(body(&bytes)).is_ok());
        let new = catalog(Phase::Tombstoned, 5, Some(record(true, 3)));
        let bytes = new.encode().unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains(r#""phase":"Tombstoned""#));
        assert_eq!(Catalog::decode(&bytes, limits()).unwrap(), new);
        let intent = catalog(Phase::TombstoneIntent, 3, Some(record(false, 3)));
        let bytes = intent.encode().unwrap();
        assert_eq!(Catalog::decode(&bytes, limits()).unwrap(), intent);
    }

    #[test]
    fn older_readers_refuse_tombstone_phases_and_fields() {
        for tombstoned in [
            catalog(Phase::Tombstoned, 5, Some(record(true, 3))),
            catalog(Phase::TombstoneIntent, 3, Some(record(false, 3))),
        ] {
            let bytes = tombstoned.encode().unwrap();
            assert!(serde_json::from_slice::<OldCatalog>(body(&bytes)).is_err());
        }
    }

    #[test]
    fn invalid_records_and_phase_field_mismatches_are_rejected() {
        let mut bad_hex = record(true, 3);
        bad_hex.backup.as_mut().unwrap().fingerprint = "zz".into();
        let mut zero_bound = record(true, 3);
        zero_bound.backup_bytes = 0;
        let mut no_deadline = record(true, 3);
        no_deadline.deadline = no_deadline.intent_time;
        for bad in [
            catalog(Phase::Tombstoned, 5, Some(bad_hex)),
            catalog(Phase::Tombstoned, 5, Some(zero_bound)),
            catalog(Phase::Tombstoned, 5, Some(no_deadline)),
            catalog(Phase::Tombstoned, 5, Some(record(false, 3))),
            catalog(Phase::TombstoneIntent, 3, Some(record(true, 3))),
            catalog(Phase::TombstoneIntent, 4, Some(record(false, 3))),
            catalog(Phase::Tombstoned, 3, Some(record(true, 3))),
            catalog(Phase::Tombstoned, 5, None),
            catalog(Phase::Closed, 5, Some(record(true, 3))),
        ] {
            assert_eq!(bad.encode().unwrap_err(), CatalogError::InvalidCatalog);
        }
    }
}

#[cfg(test)]
mod restore_tests {
    use super::{
        BackupBinding, Catalog, CatalogError, Entry, ManagerLimits, Materialized, Phase,
        RestoreRecord, checksum,
    };
    use serde::Deserialize;

    fn limits() -> ManagerLimits {
        ManagerLimits {
            repositories: 4,
            catalog_bytes: 65536,
            scan_entries: 128,
            open_handles: 2,
            store_files: 128,
            model_retention: 1,
            model_max_generation: 100,
        }
    }

    fn record() -> RestoreRecord {
        RestoreRecord {
            source_id: "src".into(),
            source_uuid: "87654321-1234-4123-8123-123456789012".into(),
            source_generation: 3,
            source_attempt: 2,
            attempt: 4,
            intent_time: 10,
            backup_files: 10,
            backup_bytes: 1000,
            backup_timeout_ms: 60_000,
            backup: BackupBinding {
                fingerprint: "a".repeat(64),
                database_id: "b".repeat(64),
                sequence: 7,
                quads: 1,
                named_graphs: 0,
                namespaces: 0,
                files: 3,
                bytes: 100,
            },
        }
    }

    fn catalog(phase: Phase, changed_at: u64, restore: Option<RestoreRecord>) -> Catalog {
        Catalog {
            version: 1,
            generation: 6,
            limits: limits(),
            entries: vec![Entry {
                id: "a".into(),
                uuid: "12345678-1234-4123-8123-123456789012".into(),
                phase,
                changed_at,
                evidence: (phase != Phase::Reserved).then(|| Materialized {
                    device: 1,
                    inode: 1,
                    format: "0".repeat(64),
                }),
                tombstone: None,
                restore,
            }],
        }
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct OldEntry {
        #[allow(dead_code)]
        id: String,
        #[allow(dead_code)]
        uuid: String,
        #[allow(dead_code)]
        phase: OldPhase,
        #[allow(dead_code)]
        changed_at: u64,
        #[allow(dead_code)]
        evidence: Option<serde_json::Value>,
    }

    #[derive(Deserialize)]
    enum OldPhase {
        Reserved,
        Validated,
        Closed,
        Quiescing,
        Failed,
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct OldCatalog {
        #[allow(dead_code)]
        version: u32,
        #[allow(dead_code)]
        generation: u64,
        #[allow(dead_code)]
        limits: serde_json::Value,
        #[allow(dead_code)]
        entries: Vec<OldEntry>,
    }

    fn body(bytes: &[u8]) -> &[u8] {
        let mut newlines = bytes.iter().enumerate().filter(|(_, b)| **b == b'\n');
        let second = newlines.nth(1).unwrap().0;
        &bytes[second + 1..]
    }

    fn framed(body: &str) -> Vec<u8> {
        let mut bytes =
            format!("oxigraph-catalog-v1\n{}\n", checksum(body.as_bytes())).into_bytes();
        bytes.extend_from_slice(body.as_bytes());
        bytes
    }

    #[test]
    fn restore_records_round_trip_canonically_and_old_shape_has_no_restore() {
        for value in [
            catalog(Phase::Closed, 5, Some(record())),
            catalog(Phase::Reserved, 4, Some(record())),
            catalog(Phase::Validated, 5, Some(record())),
        ] {
            let bytes = value.encode().unwrap();
            assert_eq!(Catalog::decode(&bytes, limits()).unwrap(), value);
        }
        let plain = catalog(Phase::Closed, 5, None).encode().unwrap();
        assert!(!String::from_utf8_lossy(&plain).contains("restore"));
        assert!(serde_json::from_slice::<OldCatalog>(body(&plain)).is_ok());
    }

    #[test]
    fn older_readers_refuse_restore_records() {
        let bytes = catalog(Phase::Closed, 5, Some(record())).encode().unwrap();
        assert!(serde_json::from_slice::<OldCatalog>(body(&bytes)).is_err());
    }

    #[test]
    fn invalid_restore_records_are_rejected() {
        let mut same_id = record();
        same_id.source_id = "a".into();
        let mut bad_hex = record();
        bad_hex.backup.fingerprint = "zz".into();
        let mut same_uuid = record();
        same_uuid.source_uuid = "12345678-1234-4123-8123-123456789012".into();
        let mut late_source = record();
        late_source.source_generation = 5;
        let mut zero_bound = record();
        zero_bound.backup_bytes = 0;
        let mut too_many_files = record();
        too_many_files.backup.files = 11;
        let mut zero_attempt = record();
        zero_attempt.source_attempt = 0;
        for attempt in [0, 3, 5, 6] {
            let mut invalid = record();
            invalid.attempt = attempt;
            assert_eq!(
                catalog(Phase::Closed, 5, Some(invalid))
                    .encode()
                    .unwrap_err(),
                CatalogError::InvalidCatalog
            );
        }
        assert_eq!(
            catalog(Phase::Reserved, 5, Some(record()))
                .encode()
                .unwrap_err(),
            CatalogError::InvalidCatalog
        );
        for bad in [
            same_id,
            bad_hex,
            same_uuid,
            late_source,
            zero_bound,
            too_many_files,
            zero_attempt,
        ] {
            assert_eq!(
                catalog(Phase::Closed, 5, Some(bad)).encode().unwrap_err(),
                CatalogError::InvalidCatalog
            );
        }
    }

    #[test]
    fn source_attempt_must_strictly_precede_source_generation_in_every_phase() {
        let phases = [
            (Phase::Reserved, 4),
            (Phase::Validated, 5),
            (Phase::Closed, 5),
        ];
        // Equal, future and overflow-sized source attempts are refused.
        for source_attempt in [3, 4, 5, u64::MAX - 1, u64::MAX] {
            for (phase, changed_at) in phases {
                let mut bad = record();
                bad.source_attempt = source_attempt;
                assert_eq!(
                    catalog(phase, changed_at, Some(bad)).encode().unwrap_err(),
                    CatalogError::InvalidCatalog,
                    "{source_attempt} {phase:?}"
                );
            }
        }
        for source_attempt in [1, 2] {
            for (phase, changed_at) in phases {
                let mut good = record();
                good.source_attempt = source_attempt;
                let value = catalog(phase, changed_at, Some(good));
                let bytes = value.encode().unwrap();
                assert_eq!(Catalog::decode(&bytes, limits()).unwrap(), value);
            }
        }
        // Decoded Closed records with a forged but checksummed source attempt fail too.
        let valid = catalog(Phase::Closed, 5, Some(record()));
        let bytes = valid.encode().unwrap();
        let text = std::str::from_utf8(body(&bytes)).unwrap();
        let original = r#""source_attempt":2,"#;
        assert_eq!(text.matches(original).count(), 1);
        assert_eq!(framed(text), bytes);
        assert_eq!(Catalog::decode(&framed(text), limits()).unwrap(), valid);
        for forged in [3, 4, u64::MAX] {
            let changed = text.replacen(original, &format!(r#""source_attempt":{forged},"#), 1);
            assert_ne!(changed, text);
            assert_eq!(
                Catalog::decode(&framed(&changed), limits()).unwrap_err(),
                CatalogError::InvalidCatalog,
                "{forged}"
            );
        }
    }
}
