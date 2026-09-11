//! Read side of the primary schema envelope in the existing oxversion key.
//!
//! Envelope v1 is: eight-byte OXSCHEMA magic, u8 envelope version, big-endian
//! u64 logical version, 16 UUID bytes, u8 RDF ceiling (11 or 12), u16 encoding
//! profile, seven u16 codec ceilings, u8 family count, then u8-length-prefixed
//! ASCII family names, followed by 32 SHA-256 bytes. The checksum covers the
//! domain below followed by every preceding byte, including magic and version.
//! No padding, extensions or trailing bytes are allowed. Maximum size is 512.
//!
//! Encoding profile 1 names the existing binary_encoder/numeric_encoder layout;
//! RDF 1.2 term forms are permitted only by the separate RDF ceiling. This
//! descriptor is an immutable write ceiling, never observed data usage.
//! Codec ceilings describe permitted records, not a claim that records exist:
//! namespace 1 (rocksdb NAMESPACE_SCHEMA_V1), transaction outcome 2 (governed
//! outcomes and retention tombstones), receipt 2 (receipt.rs), governance 3
//! (retention.rs), outbox record 1 (outbox.rs), derived generation container 1
//! (derived_generation.rs), semantic changes 1 (change_codec.rs).
//! Provider-specific text/spatial/statistics schemas are intentionally absent.
//!
//! This bounded v1 grammar only describes that exact inventory/profile. A new
//! profile needs a separately reviewed format contract. Decoding grants no
//! compatibility, upgrade, recovery or activation authority and has no writer.
use sha2::{Digest, Sha256};
use std::fmt;

const MAGIC: &[u8; 8] = b"OXSCHEMA";
const DOMAIN: &[u8] = b"oxigraph.schema-envelope.v1\0";
const MAX_BYTES: usize = 512;
const FAMILIES: [&str; 12] = [
    "default", "dosp", "dpos", "dspo", "gosp", "gpos", "graphs", "gspo", "id2str", "ospg", "posg",
    "spog",
];
const CODEC_CEILINGS: [u16; 7] = [1, 2, 2, 3, 1, 1, 1];

/// Persisted RFC 4122 version-4 schema identity, distinct from governed lineage.
/// Inspection never generates an identity or substitutes a RocksDB identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SchemaUuid([u8; 16]);

impl SchemaUuid {
    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}

impl fmt::Display for SchemaUuid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, byte) in self.0.iter().enumerate() {
            if matches!(index, 4 | 6 | 8 | 10) {
                f.write_str("-")?;
            }
            write!(f, "{byte:02x}")?;
        }
        Ok(())
    }
}

/// Immutable permitted RDF write profile; not a scan of stored RDF terms.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum SchemaRdfProfile {
    Rdf11,
    Rdf12,
}

impl SchemaRdfProfile {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Rdf11 => "rdf-11",
            Self::Rdf12 => "rdf-12",
        }
    }
}

/// Parsed primary metadata descriptor, without a logical-validity claim.
/// All fields originate in checksummed bytes. No setter or writer is provided.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoreSchemaEnvelope {
    envelope_version: u8,
    logical_version: u64,
    schema_uuid: SchemaUuid,
    rdf_profile: SchemaRdfProfile,
    encoding_profile: u16,
    codec_ceilings: [u16; 7],
    required_column_families: Vec<String>,
}

impl StoreSchemaEnvelope {
    pub const fn envelope_version(&self) -> u8 {
        self.envelope_version
    }

    pub const fn logical_version(&self) -> u64 {
        self.logical_version
    }

    pub const fn schema_uuid(&self) -> &SchemaUuid {
        &self.schema_uuid
    }

    pub const fn rdf_write_profile(&self) -> SchemaRdfProfile {
        self.rdf_profile
    }

    /// Profile 1 denotes the existing binary and numeric term/index encoding.
    pub const fn encoding_profile(&self) -> u16 {
        self.encoding_profile
    }

    pub fn required_column_families(&self) -> &[String] {
        &self.required_column_families
    }

    pub const fn namespace_schema(&self) -> u16 {
        self.codec_ceilings[0]
    }

    pub const fn transaction_outcome_schema(&self) -> u16 {
        self.codec_ceilings[1]
    }

    pub const fn commit_receipt_schema(&self) -> u16 {
        self.codec_ceilings[2]
    }

    pub const fn governance_schema(&self) -> u16 {
        self.codec_ceilings[3]
    }

    pub const fn outbox_record_schema(&self) -> u16 {
        self.codec_ceilings[4]
    }

    /// Container version, independent of any external provider schema.
    pub const fn derived_generation_schema(&self) -> u16 {
        self.codec_ceilings[5]
    }

    pub const fn semantic_change_schema(&self) -> u16 {
        self.codec_ceilings[6]
    }

    /// Decodes only the bounded v1 envelope and its exact declared profile.
    ///
    /// Rejects inputs larger than 512 bytes, invalid checksums, noncanonical
    /// fields, unsupported envelope/encoding/codec profiles, and inventories
    /// other than the exact twelve-family layout. Legacy eight-byte integer
    /// markers are not envelopes and return None.
    ///
    /// Success is structural parsing only. It does not inspect stored records,
    /// establish compatibility, or authorize open, upgrade, recovery or
    /// activation. This function never generates identities or writes storage.
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        // Bound work and allocation before hashing or reading attacker lengths.
        if !(83..=MAX_BYTES).contains(&bytes.len()) {
            return None;
        }
        let (body, checksum) = bytes.split_at(bytes.len().checked_sub(32)?);
        let mut hash = Sha256::new();
        hash.update(DOMAIN);
        hash.update(body);
        if hash.finalize().as_slice() != checksum {
            return None;
        }
        let mut cursor = Cursor(body);
        if cursor.take(8)? != MAGIC || cursor.byte()? != 1 {
            return None;
        }
        let logical_version = u64::from_be_bytes(cursor.take(8)?.try_into().ok()?);
        if logical_version < 3 {
            return None;
        }
        let uuid: [u8; 16] = cursor.take(16)?.try_into().ok()?;
        if uuid[6] >> 4 != 4 || uuid[8] & 0xc0 != 0x80 {
            return None;
        }
        let rdf_profile = match cursor.byte()? {
            11 => SchemaRdfProfile::Rdf11,
            12 => SchemaRdfProfile::Rdf12,
            _ => return None,
        };
        let encoding_profile = cursor.u16()?;
        if encoding_profile != 1 {
            return None;
        }
        let mut codec_ceilings = [0; 7];
        for ceiling in &mut codec_ceilings {
            *ceiling = cursor.u16()?;
        }
        if codec_ceilings != CODEC_CEILINGS || usize::from(cursor.byte()?) != FAMILIES.len() {
            return None;
        }
        let mut required_column_families = Vec::with_capacity(FAMILIES.len());
        for expected in FAMILIES {
            let length = usize::from(cursor.byte()?);
            if !(1..=32).contains(&length) {
                return None;
            }
            let name = cursor.take(length)?;
            // Exact sorted inventory also rejects duplicates, invalid ASCII,
            // missing names, unknown names and alternate orderings.
            if name != expected.as_bytes() {
                return None;
            }
            required_column_families.push(expected.to_owned());
        }
        if !cursor.0.is_empty() {
            return None;
        }
        Some(Self {
            envelope_version: 1,
            logical_version,
            schema_uuid: SchemaUuid(uuid),
            rdf_profile,
            encoding_profile,
            codec_ceilings,
            required_column_families,
        })
    }
}

struct Cursor<'a>(&'a [u8]);

impl<'a> Cursor<'a> {
    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let value = self.0.get(..length)?;
        self.0 = self.0.get(length..)?;
        Some(value)
    }

    fn byte(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_be_bytes(self.take(2)?.try_into().ok()?))
    }
}
