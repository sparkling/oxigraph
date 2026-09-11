use super::*;
use crate::store::{
    SchemaRdfProfile, Store, StoreFormatInfo, StoreSchemaEnvelope, StoreVersionStatus,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

// Independent wire fixture: no production encoder or descriptor constants.
// Offsets: version 8, logical 9, UUID 17, RDF 33, encoding 34,
// seven codec ceilings 36, inventory count 50, names 51.
fn body(rdf: u8, logical: u64) -> Vec<u8> {
    let mut bytes = b"OXSCHEMA".to_vec();
    bytes.push(1);
    bytes.extend_from_slice(&logical.to_be_bytes());
    bytes.extend_from_slice(&[
        0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x4d, 0xef, 0x80, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc,
        0xde,
    ]);
    bytes.push(rdf);
    bytes.extend_from_slice(&[
        0, 1, // existing term/index encoding
        0, 1, // namespaces
        0, 2, // transaction outcomes, including governed outcomes
        0, 2, // receipts
        0, 3, // governance including retention
        0, 1, // outbox records
        0, 1, // derived generation container, not provider schema
        0, 1,  // semantic changes
        12, // exact column-family count
    ]);
    bytes.extend_from_slice(
        b"\x07default\x04dosp\x04dpos\x04dspo\x04gosp\x04gpos\x06graphs\x04gspo\x06id2str\x04ospg\x04posg\x04spog",
    );
    bytes
}

fn seal(mut body: Vec<u8>) -> Vec<u8> {
    let mut hash = Sha256::new();
    hash.update(b"oxigraph.schema-envelope.v1\0");
    hash.update(&body);
    body.extend_from_slice(&hash.finalize());
    body
}

fn info(marker: Option<&[u8]>) -> StoreFormatInfo {
    StoreFormatInfo::new(marker, 2, Vec::new(), Vec::new())
}

#[test]
fn schema_envelope_decodes_exact_independent_profiles() {
    for (rdf, profile) in [(11, SchemaRdfProfile::Rdf11), (12, SchemaRdfProfile::Rdf12)] {
        for logical in [3, 4, u64::MAX] {
            let marker = seal(body(rdf, logical));
            let info = info(Some(&marker));
            assert_eq!(info.storage_version(), Some(logical));
            assert_eq!(info.version_status(), StoreVersionStatus::Newer);
            assert_eq!(info.current_storage_version(), 2);
            assert_eq!(info.version_marker_bytes(), Some(marker.len()));
            let envelope = info.schema_envelope().unwrap();
            assert_eq!(envelope.envelope_version(), 1);
            assert_eq!(envelope.logical_version(), logical);
            assert_eq!(envelope.rdf_write_profile(), profile);
            assert_eq!(
                envelope.rdf_write_profile().as_str(),
                if rdf == 11 { "rdf-11" } else { "rdf-12" }
            );
            assert_eq!(
                envelope.schema_uuid().to_string(),
                "12345678-9abc-4def-8012-3456789abcde"
            );
            assert_eq!(envelope.schema_uuid().as_bytes(), &marker[17..33]);
            assert_eq!(envelope.encoding_profile(), 1);
            assert_eq!(envelope.namespace_schema(), 1);
            assert_eq!(envelope.transaction_outcome_schema(), 2);
            assert_eq!(envelope.commit_receipt_schema(), 2);
            assert_eq!(envelope.governance_schema(), 3);
            assert_eq!(envelope.outbox_record_schema(), 1);
            assert_eq!(envelope.derived_generation_schema(), 1);
            assert_eq!(envelope.semantic_change_schema(), 1);
            assert_eq!(
                envelope.required_column_families(),
                [
                    "default", "dosp", "dpos", "dspo", "gosp", "gpos", "graphs", "gspo", "id2str",
                    "ospg", "posg", "spog"
                ]
            );
        }
    }
}

#[test]
fn schema_envelope_legacy_markers_are_not_reinterpreted() {
    assert_eq!(info(None).version_status(), StoreVersionStatus::Missing);
    for version in [0_u64, 1, 2, 3, u64::MAX, u64::from_be_bytes(*b"OXSCHEMA")] {
        let marker = version.to_be_bytes();
        let info = info(Some(&marker));
        assert_eq!(info.storage_version(), Some(version));
        assert!(info.schema_envelope().is_none());
        assert_eq!(
            info.version_status(),
            match version {
                0 | 1 => StoreVersionStatus::Older,
                2 => StoreVersionStatus::Current,
                _ => StoreVersionStatus::Newer,
            }
        );
    }
}

fn malformed(bytes: &[u8]) {
    assert!(StoreSchemaEnvelope::decode(bytes).is_none());
    // Every eight-byte value remains a legacy marker, including a truncated magic.
    if bytes.len() != 8 {
        let info = info(Some(bytes));
        assert_eq!(info.version_status(), StoreVersionStatus::Malformed);
        assert_eq!(info.storage_version(), None);
        assert!(info.schema_envelope().is_none());
    }
}

#[test]
fn schema_envelope_rejects_truncation_checksum_and_noncanonical_fields() {
    let valid = seal(body(11, 3));
    for length in 0..valid.len() {
        malformed(&valid[..length]);
    }
    for index in 0..valid.len() {
        let mut bytes = valid.clone();
        bytes[index] ^= 1;
        malformed(&bytes);
    }
    let mut trailing = valid.clone();
    trailing.push(0);
    malformed(&trailing);
    malformed(&vec![0; 513]);

    // Reseal each mutation so structural rejection is independent of checksum.
    for (offset, value) in [
        (0, b'Y'),
        (8, 0),
        (8, 2), // magic and envelope version
        (23, 0),
        (23, 0x5d), // UUID version
        (25, 0),
        (25, 0xc0), // RFC 4122 variant
        (33, 0),
        (33, 13), // RDF profile
        (34, 1),
        (35, 0),
        (35, 2), // encoding profile
        (50, 0),
        (50, 11),
        (50, 13),
        (50, 255), // count
        (51, 0),
        (51, 33),
        (51, 255), // name length
        (52, 0),
        (52, 0xff),
        (52, b'D'), // noncanonical names
    ] {
        let mut bytes = body(11, 3);
        bytes[offset] = value;
        malformed(&seal(bytes));
    }
    for logical in [0, 1, 2] {
        malformed(&seal(body(11, logical)));
    }
    for offset in (36..50).step_by(2) {
        for value in [0_u16, u16::MAX] {
            let mut bytes = body(11, 3);
            bytes[offset..offset + 2].copy_from_slice(&value.to_be_bytes());
            malformed(&seal(bytes));
        }
    }
    let mut nil_uuid = body(11, 3);
    nil_uuid[17..33].fill(0);
    malformed(&seal(nil_uuid));
    let mut duplicate = body(11, 3);
    duplicate[65..69].copy_from_slice(b"dosp");
    malformed(&seal(duplicate));
    let mut unsorted = body(11, 3);
    unsorted[60..64].copy_from_slice(b"dpos");
    unsorted[65..69].copy_from_slice(b"dosp");
    malformed(&seal(unsorted));
    let mut trailing_body = body(11, 3);
    trailing_body.push(0);
    malformed(&seal(trailing_body));
    let mut missing_name = body(11, 3);
    missing_name.truncate(missing_name.len() - 5);
    malformed(&seal(missing_name));

    let mut wrong_domain = body(11, 3);
    let mut hash = Sha256::new();
    hash.update(b"oxigraph.other-envelope.v1\0");
    hash.update(&wrong_domain);
    wrong_domain.extend_from_slice(&hash.finalize());
    malformed(&wrong_domain);
}

fn files(path: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    fn visit(root: &Path, path: &Path, result: &mut BTreeMap<PathBuf, Vec<u8>>) -> Result {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                visit(root, &entry.path(), result)?;
            } else {
                assert!(entry.file_type()?.is_file());
                result.insert(
                    entry.path().strip_prefix(root)?.to_owned(),
                    std::fs::read(entry.path())?,
                );
            }
        }
        Ok(())
    }
    let mut result = BTreeMap::new();
    visit(path, path, &mut result)?;
    Ok(result)
}

#[test]
fn schema_envelope_disk_inspection_and_open_refusals_preserve_every_file() -> Result {
    let mut corrupt = seal(body(11, 3));
    corrupt[17] ^= 1;
    for (marker, expected) in [
        (seal(body(11, 3)), Some(3)),
        (seal(body(12, u64::MAX)), Some(u64::MAX)),
        (corrupt, None),
    ] {
        let directory = tempfile::tempdir()?;
        let db = Db::open_read_write(
            directory.path(),
            RocksDbStorage::column_families(),
            DbOptions::default(),
        )?;
        db.insert(&db.column_family(DEFAULT_CF)?, b"oxversion", &marker)?;
        db.insert(&db.column_family(DEFAULT_CF)?, b"fixture", b"preserve")?;
        db.flush()?;
        drop(db);
        // Include the existing native LOCK: no missing-lock creation is hidden.
        assert!(directory.path().join("LOCK").is_file());
        let before = files(directory.path())?;
        for _ in 0..2 {
            let info = Store::inspect(directory.path())?;
            assert_eq!(info.storage_version(), expected);
            assert_eq!(
                info.version_status(),
                if expected.is_some() {
                    StoreVersionStatus::Newer
                } else {
                    StoreVersionStatus::Malformed
                }
            );
            assert_eq!(info.schema_envelope().is_some(), expected.is_some());
            if let Some(envelope) = info.schema_envelope() {
                assert_eq!(envelope.required_column_families(), info.column_families());
            }
            assert_eq!(files(directory.path())?, before);
            let writable = Store::open(directory.path())
                .err()
                .ok_or("open admitted envelope")?;
            match (expected, writable) {
                (
                    Some(version),
                    StorageError::SchemaTooNew {
                        found,
                        supported: 2,
                    },
                ) => assert_eq!(found, version),
                (None, StorageError::SchemaUnknown) => (),
                (_, error) => panic!("unexpected writable-open error: {error}"),
            }
            assert_eq!(files(directory.path())?, before);
            let readonly = Store::open_read_only(directory.path())
                .err()
                .ok_or("read-only open admitted envelope")?;
            match (expected, readonly) {
                (
                    Some(version),
                    StorageError::SchemaTooNew {
                        found,
                        supported: 2,
                    },
                ) => assert_eq!(found, version),
                (None, StorageError::SchemaUnknown) => (),
                (_, error) => panic!("unexpected read-only-open error: {error}"),
            }
            assert_eq!(files(directory.path())?, before);
        }
    }
    Ok(())
}
