//! Catalog v1 codec. Format semantics for `Phase`:
//!
//! `Quiescing` is an additive phase string in catalog v1: the header, `version` and
//! every field are unchanged, so a catalog without a `Quiescing` entry is
//! byte-identical to before. A `Quiescing` entry requires materialization evidence
//! like `Validated` and `Closed`. Phase decoding is closed: any other string (unknown
//! or miscased) fails serde and returns `InvalidCatalog`, so older binaries also fail
//! closed on a catalog holding `Quiescing`. Encoding stays canonical (decode requires
//! byte-equal re-encoding) and readiness is never derived from phase alone.
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
/// `Quiescing` is an additive v1 phase; see the module documentation.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Phase {
    Reserved,
    Validated,
    Closed,
    Quiescing,
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
}

/// Manager-owned directory identity, not a governed StoreIdentity or DB UUID.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Materialized {
    pub device: u64,
    pub inode: u64,
    pub format: String,
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
                    Phase::Validated | Phase::Closed | Phase::Quiescing
                ) && entry.evidence.is_none())
                || (entry.phase == Phase::Reserved && entry.evidence.is_some())
                || entry.evidence.as_ref().is_some_and(|e| {
                    e.inode == 0
                        || e.format.len() != 64
                        || !e.format.bytes().all(|b| b.is_ascii_hexdigit())
                })
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
