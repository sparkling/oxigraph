//! Bounded SHACL outcome evidence; decoding never requires the SHACL processor.
use super::receipt::{envelope_checksum, receipt_field};
use super::{CommitReceipt, CommitReceiptOutcome, CorruptionError, StorageError};
use std::time::Duration;

pub(crate) const MAX_SCOPES: usize = 128;
pub(crate) const MAX_SEVERITIES: usize = 32;
pub(crate) const MAX_EVIDENCE_BYTES: usize = 8192;
pub(crate) const VALIDATED_OUTCOME: &[u8] = &[2, 5];
#[derive(Clone, Copy)]
pub(crate) struct ValidationCommitContext<'a> {
    pub evidence: &'a ShaclValidationEvidence,
    pub before_attempt: &'a dyn Fn() -> Result<(), StorageError>,
}
#[derive(Debug, thiserror::Error)]
#[error("validation failed before commit attempt: {source}; rollback failure: {rollback:?}")]
pub(crate) struct ValidationPreAttemptError {
    #[source]
    pub source: StorageError,
    pub rollback: Option<StorageError>,
}
const PROFILE_IDS: [&str; 5] = [
    "shacl-1.2-core-2026-07-23-subset-v1",
    "shacl-1.2-node-expressions-2026-01-08-subset-v1",
    "shacl-1.2-sparql-extensions-2026-01-30-subset-v1",
    "shacl-1.2-rules-2026-07-27-subset-v1",
    "shacl-1.2-compact-syntax-2025-10-30-subset-v1",
];

/// A validation observation, not the native transaction's terminal outcome.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ShaclDisposition {
    Accepted = 1,
    Nonconforming = 2,
    Cancelled = 3,
    TimedOut = 4,
    LimitExceeded = 5,
    ProcessorError = 6,
    StorageError = 7,
    PolicyError = 8,
    ShapesChanged = 9,
    MissingGraph = 10,
}

/// A canonical policy descriptor without RDF payloads. Graph selectors and
/// severity IRIs are domain-separated hashes; original terms remain with the
/// caller. Compare the original policy using `ShaclCommitPolicy::descriptor`.
#[derive(Clone, Debug, Eq, PartialEq)]
#[expect(
    clippy::field_scoped_visibility_modifiers,
    reason = "gate constructs this descriptor; external callers only receive immutable fields"
)]
pub struct ShaclPolicyDescriptor {
    pub(super) profiles: u8,
    /// Ordered selector identities and final-state presence requirements.
    pub(super) scopes: Vec<([u8; 32], bool)>,
    /// 0 external, 1 immutable stored, 2 mutable stored.
    pub(super) shapes_source: u8,
    pub(super) shapes_graph: [u8; 32],
    pub(super) severities: Vec<[u8; 32]>,
    pub(super) flags: u8,
    pub(super) limits: [u64; 16],
    pub(super) timeout: Duration,
}

impl ShaclPolicyDescriptor {
    pub fn profiles(&self) -> impl Iterator<Item = &'static str> + '_ {
        PROFILE_IDS
            .into_iter()
            .enumerate()
            .filter_map(|(i, profile)| (self.profiles & (1 << i) != 0).then_some(profile))
    }
    pub fn graph_scopes(&self) -> &[([u8; 32], bool)] {
        &self.scopes
    }
    pub const fn shapes_source_kind(&self) -> u8 {
        self.shapes_source
    }
    pub const fn shapes_graph_identity(&self) -> &[u8; 32] {
        &self.shapes_graph
    }
    pub fn disallowed_severity_identities(&self) -> &[[u8; 32]] {
        &self.severities
    }
    pub const fn sub_class_of_in_shapes_graph(&self) -> bool {
        self.flags & 1 != 0
    }
    pub const fn report_shapes_graph_well_formed(&self) -> bool {
        self.flags & 2 != 0
    }
    /// Limits in v1 order: data quads, shape quads, shapes, constraints, focus
    /// nodes, results, path visits, list items, recursion depth, query bytes,
    /// query solutions, rule iterations, derived triples, estimated processor
    /// memory bytes, selected graphs, cumulative logical snapshot bytes.
    pub const fn limits(&self) -> &[u64; 16] {
        &self.limits
    }
    /// Cooperative duration from transaction begin, including admission/staging.
    pub const fn timeout(&self) -> Duration {
        self.timeout
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        envelope_checksum(b"oxigraph.shacl-policy.v1\0", &self.encode())
    }
    #[expect(
        clippy::cast_possible_truncation,
        reason = "private construction and decoding enforce 32 severities and 128 scopes"
    )]
    fn encode(&self) -> Vec<u8> {
        // Policy v1 implies ImplementedFeatureSet, no materialization, no
        // imports, no network, and independently evaluated selected graphs.
        let mut bytes = vec![1, self.profiles, self.shapes_source, self.flags];
        for value in self.limits {
            bytes.extend_from_slice(&value.to_be_bytes());
        }
        bytes.extend_from_slice(&self.timeout.as_secs().to_be_bytes());
        bytes.extend_from_slice(&self.timeout.subsec_nanos().to_be_bytes());
        bytes.extend_from_slice(&self.shapes_graph);
        bytes.push(self.severities.len() as u8); // checked before construction/decode
        for severity in &self.severities {
            bytes.extend_from_slice(severity);
        }
        bytes.extend_from_slice(&(self.scopes.len() as u16).to_be_bytes());
        for (graph, required) in &self.scopes {
            bytes.extend_from_slice(graph);
            bytes.push(u8::from(*required));
        }
        bytes
    }
    pub(super) fn validate(&self) -> Result<(), StorageError> {
        if self.profiles & 1 == 0
            || self.profiles & !31 != 0
            || self.shapes_source > 2
            || self.flags > 3
            || self.timeout.is_zero()
            || self.scopes.is_empty()
            || self.scopes.len() > MAX_SCOPES
            || self.scopes.len() as u64 > self.limits[14]
            || self.severities.is_empty()
            || self.severities.len() > MAX_SEVERITIES
            || self
                .severities
                .windows(2)
                .any(|pair| matches!(pair, [left, right] if left >= right))
        {
            return Err(bad("invalid SHACL policy descriptor"));
        }
        let unique = self
            .scopes
            .iter()
            .map(|(name, _)| name)
            .collect::<std::collections::HashSet<_>>();
        if unique.len() != self.scopes.len() {
            return Err(bad("duplicate SHACL graph selector"));
        }
        Ok(())
    }
    fn decode(cursor: &mut Cursor<'_>) -> Result<Self, StorageError> {
        if cursor.byte()? != 1 {
            return Err(bad("unknown SHACL policy version"));
        }
        let profiles = cursor.byte()?;
        let shapes_source = cursor.byte()?;
        let flags = cursor.byte()?;
        let mut limits = [0; 16];
        for value in &mut limits {
            *value = u64::from_be_bytes(cursor.field()?);
        }
        let seconds = u64::from_be_bytes(cursor.field()?);
        let nanos = u32::from_be_bytes(cursor.field()?);
        if nanos >= 1_000_000_000 {
            return Err(bad("noncanonical SHACL timeout"));
        }
        let timeout = Duration::new(seconds, nanos);
        let shapes_graph = cursor.field()?;
        let count = usize::from(cursor.byte()?);
        if count > MAX_SEVERITIES {
            return Err(bad("SHACL severity limit"));
        }
        let severities = std::iter::repeat_with(|| cursor.field())
            .take(count)
            .collect::<Result<_, _>>()?;
        let count = usize::from(u16::from_be_bytes(cursor.field()?));
        if count > MAX_SCOPES {
            return Err(bad("SHACL graph scope limit"));
        }
        let scopes = std::iter::repeat_with(|| Ok((cursor.field()?, cursor.boolean()?)))
            .take(count)
            .collect::<Result<_, StorageError>>()?;
        let descriptor = Self {
            profiles,
            scopes,
            shapes_source,
            shapes_graph,
            severities,
            flags,
            limits,
            timeout,
        };
        descriptor.validate()?;
        Ok(descriptor)
    }
}

/// Bounded payload-free evidence. A returned rejection is diagnostic only;
/// Accepted is durable only when bound to a committed native receipt.
#[derive(Clone, Debug, Eq, PartialEq)]
#[expect(
    clippy::field_scoped_visibility_modifiers,
    reason = "gate records observations; external callers cannot alter evidence"
)]
pub struct ShaclValidationEvidence {
    pub(super) policy: ShaclPolicyDescriptor,
    pub(super) shapes_at_begin: [u8; 32],
    pub(super) shapes_at_commit: Option<[u8; 32]>,
    pub(super) topology: Vec<Option<bool>>,
    pub(super) validated_graphs: u16,
    pub(super) disposition: ShaclDisposition,
}

impl ShaclValidationEvidence {
    pub const fn policy(&self) -> &ShaclPolicyDescriptor {
        &self.policy
    }
    pub const fn shapes_at_begin(&self) -> &[u8; 32] {
        &self.shapes_at_begin
    }
    pub const fn shapes_at_commit(&self) -> Option<&[u8; 32]> {
        self.shapes_at_commit.as_ref()
    }
    /// Per selected graph: None unobserved, Some(false) absent, Some(true) present.
    pub fn final_graph_presence(&self) -> &[Option<bool>] {
        &self.topology
    }
    pub const fn validated_graphs(&self) -> u16 {
        self.validated_graphs
    }
    pub const fn disposition(&self) -> ShaclDisposition {
        self.disposition
    }
    /// Canonical, versioned, checksummed evidence, bounded to 8 KiB.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = vec![1, self.disposition as u8];
        bytes.extend_from_slice(&self.shapes_at_begin);
        bytes.push(u8::from(self.shapes_at_commit.is_some()));
        bytes.extend_from_slice(&self.shapes_at_commit.unwrap_or([0; 32]));
        bytes.extend_from_slice(&self.validated_graphs.to_be_bytes());
        bytes.extend_from_slice(&self.policy.encode());
        for present in &self.topology {
            bytes.push(match present {
                None => 0,
                Some(false) => 1,
                Some(true) => 2,
            });
        }
        bytes.extend_from_slice(&envelope_checksum(
            b"oxigraph.shacl-validation.v1\0",
            &bytes,
        ));
        bytes
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, StorageError> {
        if bytes.len() > MAX_EVIDENCE_BYTES || bytes.len() < 32 {
            return Err(bad("invalid SHACL evidence length"));
        }
        let (body, checksum) = bytes.split_at(bytes.len() - 32);
        if checksum != envelope_checksum(b"oxigraph.shacl-validation.v1\0", body) {
            return Err(bad("invalid SHACL evidence checksum"));
        }
        let mut cursor = Cursor(body);
        if cursor.byte()? != 1 {
            return Err(bad("unknown SHACL evidence version"));
        }
        let disposition = match cursor.byte()? {
            1 => ShaclDisposition::Accepted,
            2 => ShaclDisposition::Nonconforming,
            3 => ShaclDisposition::Cancelled,
            4 => ShaclDisposition::TimedOut,
            5 => ShaclDisposition::LimitExceeded,
            6 => ShaclDisposition::ProcessorError,
            7 => ShaclDisposition::StorageError,
            8 => ShaclDisposition::PolicyError,
            9 => ShaclDisposition::ShapesChanged,
            10 => ShaclDisposition::MissingGraph,
            _ => return Err(bad("unknown SHACL disposition")),
        };
        let shapes_at_begin = cursor.field()?;
        let present = cursor.boolean()?;
        let identity = cursor.field()?;
        if !present && identity != [0; 32] {
            return Err(bad("noncanonical missing SHACL shapes identity"));
        }
        let shapes_at_commit = present.then_some(identity);
        let validated_graphs = u16::from_be_bytes(cursor.field()?);
        let policy = ShaclPolicyDescriptor::decode(&mut cursor)?;
        let topology = std::iter::repeat_with(|| match cursor.byte()? {
            0 => Ok(None),
            1 => Ok(Some(false)),
            2 => Ok(Some(true)),
            _ => Err(bad("invalid SHACL topology flag")),
        })
        .take(policy.scopes.len())
        .collect::<Result<Vec<_>, _>>()?;
        if !cursor.0.is_empty()
            || usize::from(validated_graphs) > topology.len()
            || topology[..usize::from(validated_graphs)]
                .iter()
                .any(Option::is_none)
            || (disposition == ShaclDisposition::Accepted
                && (shapes_at_commit.is_none()
                    || (policy.shapes_source != 2 && shapes_at_commit != Some(shapes_at_begin))
                    || usize::from(validated_graphs) != topology.len()
                    || policy
                        .scopes
                        .iter()
                        .zip(&topology)
                        .any(|((_, required), present)| {
                            present.is_none() || (*required && *present != Some(true))
                        })))
        {
            return Err(bad("inconsistent SHACL validation evidence"));
        }
        Ok(Self {
            policy,
            shapes_at_begin,
            shapes_at_commit,
            topology,
            validated_graphs,
            disposition,
        })
    }
}

/// A primary receipt and its atomically persisted SHACL evidence. This binds
/// exact bytes, not an authentication signature or independent semantic proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShaclCommitReceipt {
    receipt: CommitReceipt,
    validation: ShaclValidationEvidence,
}
impl ShaclCommitReceipt {
    pub const fn commit_receipt(&self) -> &CommitReceipt {
        &self.receipt
    }
    pub const fn validation(&self) -> &ShaclValidationEvidence {
        &self.validation
    }
    /// Portable checksummed encoding, including the primary receipt binding.
    pub fn to_bytes(&self) -> Vec<u8> {
        self.encode()
    }
    /// Decode without enabling or invoking the SHACL processor.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, StorageError> {
        Self::decode(bytes)
    }
    pub(crate) fn new(
        receipt: CommitReceipt,
        validation: ShaclValidationEvidence,
    ) -> Result<Self, StorageError> {
        if receipt.schema_version() != 2 || validation.disposition != ShaclDisposition::Accepted {
            return Err(bad(
                "SHACL terminal requires accepted validation and outbox receipt",
            ));
        }
        // Validate before entering CommitAttempted, including structural bounds.
        ShaclValidationEvidence::from_bytes(&validation.to_bytes())?;
        Ok(Self {
            receipt,
            validation,
        })
    }
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut bytes = VALIDATED_OUTCOME.to_vec();
        bytes.extend_from_slice(&self.receipt.encode());
        bytes.extend_from_slice(&self.validation.to_bytes());
        bytes.extend_from_slice(&envelope_checksum(b"oxigraph.shacl-commit.v1\0", &bytes));
        bytes
    }
    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, StorageError> {
        if bytes.len() < 187
            || bytes.len() > 187 + MAX_EVIDENCE_BYTES
            || !bytes.starts_with(VALIDATED_OUTCOME)
        {
            return Err(bad("invalid validated outcome length or tag"));
        }
        let (body, checksum) = bytes.split_at(bytes.len() - 32);
        if checksum != envelope_checksum(b"oxigraph.shacl-commit.v1\0", body) {
            return Err(bad("invalid SHACL/primary receipt binding"));
        }
        Self::new(
            CommitReceipt::decode(&body[2..155])?,
            ShaclValidationEvidence::from_bytes(&body[155..])?,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShaclReceiptOutcome {
    Validated(Box<ShaclCommitReceipt>),
    /// No retained validation evidence. This does not assert validation never
    /// occurred: pre-G2.4b transactions and expired receipts also take this path.
    Unavailable(CommitReceiptOutcome),
}

#[derive(Clone)]
pub(crate) enum GovernedReceipt {
    Plain(CommitReceipt),
    Validated(Box<ShaclCommitReceipt>),
}
impl GovernedReceipt {
    pub(crate) fn new(
        receipt: CommitReceipt,
        validation: Option<&ShaclValidationEvidence>,
    ) -> Result<Self, StorageError> {
        Ok(match validation {
            None => Self::Plain(receipt),
            Some(validation) => Self::Validated(Box::new(ShaclCommitReceipt::new(
                receipt,
                validation.clone(),
            )?)),
        })
    }
    pub(crate) fn receipt(&self) -> &CommitReceipt {
        match self {
            Self::Plain(receipt) => receipt,
            Self::Validated(receipt) => receipt.commit_receipt(),
        }
    }
    pub(crate) fn outcome(&self) -> ShaclReceiptOutcome {
        match self {
            Self::Plain(receipt) => {
                ShaclReceiptOutcome::Unavailable(CommitReceiptOutcome::Committed(receipt.clone()))
            }
            Self::Validated(receipt) => ShaclReceiptOutcome::Validated(receipt.clone()),
        }
    }
    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub(crate) fn encode(&self) -> Vec<u8> {
        match self {
            Self::Plain(receipt) => {
                let mut bytes = vec![2, 2];
                bytes.extend_from_slice(&receipt.encode());
                bytes
            }
            Self::Validated(receipt) => receipt.encode(),
        }
    }
    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, StorageError> {
        if bytes.starts_with(VALIDATED_OUTCOME) {
            return Ok(Self::Validated(Box::new(ShaclCommitReceipt::decode(
                bytes,
            )?)));
        }
        if !bytes.starts_with(&[2, 2]) {
            return Err(bad("invalid committed governed outcome"));
        }
        Ok(Self::Plain(CommitReceipt::decode(&bytes[2..])?))
    }
}

fn bad(message: &'static str) -> StorageError {
    CorruptionError::msg(message).into()
}
struct Cursor<'a>(&'a [u8]);
impl Cursor<'_> {
    fn field<const N: usize>(&mut self) -> Result<[u8; N], StorageError> {
        if self.0.len() < N {
            return Err(bad("truncated SHACL evidence"));
        }
        let (field, rest) = self.0.split_at(N);
        self.0 = rest;
        receipt_field(field)
    }
    fn byte(&mut self) -> Result<u8, StorageError> {
        Ok(self.field::<1>()?[0])
    }
    fn boolean(&mut self) -> Result<bool, StorageError> {
        match self.byte()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(bad("noncanonical SHACL boolean")),
        }
    }
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    reason = "literal codec contract assertions"
)]
mod tests {
    use super::*;
    use crate::store::{SemanticChangeSet, StoreIdentity, TransactionKey};

    fn evidence() -> ShaclValidationEvidence {
        ShaclValidationEvidence {
            policy: ShaclPolicyDescriptor {
                profiles: 1,
                scopes: vec![([3; 32], true)],
                shapes_source: 2,
                shapes_graph: [4; 32],
                severities: vec![[5; 32]],
                flags: 0,
                limits: [128; 16],
                timeout: Duration::new(10, 123),
            },
            shapes_at_begin: [6; 32],
            shapes_at_commit: Some([7; 32]),
            topology: vec![Some(true)],
            validated_graphs: 1,
            disposition: ShaclDisposition::Accepted,
        }
    }
    fn primary() -> CommitReceipt {
        CommitReceipt::new(
            StoreIdentity::from_bytes([1; 16]),
            1,
            TransactionKey::new([2; 16]),
            &SemanticChangeSet::default(),
        )
        .with_outbox_header(1)
    }
    #[test]
    fn bounded_evidence_roundtrip_and_corruption_without_processor() {
        let sample = evidence();
        let bytes = sample.to_bytes();
        assert_eq!(bytes.len(), 346);
        // Literal version/disposition, begin identity and commit-presence tags.
        assert_eq!(&bytes[..2], &[1, 1]);
        assert_eq!(&bytes[2..34], &[6; 32]);
        assert_eq!(bytes[34], 1);
        assert_eq!(&bytes[67..73], &[0, 1, 1, 1, 2, 0]);
        assert_eq!(ShaclValidationEvidence::from_bytes(&bytes).unwrap(), sample);
        for length in 0..bytes.len() {
            assert!(ShaclValidationEvidence::from_bytes(&bytes[..length]).is_err());
        }
        for index in 0..bytes.len() {
            let mut corrupt = bytes.clone();
            corrupt[index] ^= 1;
            assert!(ShaclValidationEvidence::from_bytes(&corrupt).is_err());
        }
        let mut maximum = sample;
        maximum.policy.scopes = (0..128).map(|i| ([i; 32], false)).collect();
        maximum.policy.severities = (0..32).map(|i| [i; 32]).collect();
        maximum.topology = vec![Some(false); 128];
        maximum.validated_graphs = 128;
        assert!(maximum.to_bytes().len() <= MAX_EVIDENCE_BYTES);
        assert_eq!(
            ShaclValidationEvidence::from_bytes(&maximum.to_bytes()).unwrap(),
            maximum
        );
    }
    #[test]
    fn canonical_policy_and_accepted_invariants_reject_rechecksummed_invalid_values() {
        let sample = evidence();
        let mut variants = Vec::new();
        for source in [0, 1] {
            let mut invalid = sample.clone();
            invalid.policy.shapes_source = source;
            variants.push(invalid);
        }
        let mut invalid = sample.clone();
        invalid.policy.profiles = 0;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.policy.profiles = 33;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.policy.shapes_source = 3;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.policy.flags = 4;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.policy.timeout = Duration::ZERO;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.policy.severities.push([5; 32]);
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.policy.limits[14] = 0;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.shapes_at_commit = None;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.validated_graphs = 0;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.validated_graphs = 2;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.topology[0] = None;
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.topology[0] = Some(false);
        variants.push(invalid);
        let mut invalid = sample.clone();
        invalid.topology.push(Some(true));
        variants.push(invalid);
        for invalid in variants {
            assert!(ShaclValidationEvidence::from_bytes(&invalid.to_bytes()).is_err());
        }
        let mut bytes = sample.to_bytes();
        // Nanoseconds are a u32 at policy offset 4 + 16*8 + 8.
        bytes[209..213].copy_from_slice(&1_000_000_000_u32.to_be_bytes());
        let end = bytes.len() - 32;
        let checksum = envelope_checksum(b"oxigraph.shacl-validation.v1\0", &bytes[..end]);
        bytes[end..].copy_from_slice(&checksum);
        assert!(ShaclValidationEvidence::from_bytes(&bytes).is_err());
    }
    #[test]
    fn composite_binding_and_plain_compatibility() {
        let receipt = ShaclCommitReceipt::new(primary(), evidence()).unwrap();
        let bytes = receipt.to_bytes();
        assert_eq!(&bytes[..2], &[2, 5]);
        assert_eq!(ShaclCommitReceipt::from_bytes(&bytes).unwrap(), receipt);
        for index in 0..bytes.len() {
            let mut corrupt = bytes.clone();
            corrupt[index] ^= 1;
            assert!(ShaclCommitReceipt::from_bytes(&corrupt).is_err());
        }
        for length in 0..bytes.len() {
            assert!(ShaclCommitReceipt::from_bytes(&bytes[..length]).is_err());
        }
        let mut trailing = bytes;
        trailing.push(0);
        assert!(ShaclCommitReceipt::from_bytes(&trailing).is_err());
        for validation in [None, Some(evidence())] {
            let governed = GovernedReceipt::new(primary(), validation.as_ref()).unwrap();
            assert_eq!(
                GovernedReceipt::decode(&governed.encode())
                    .unwrap()
                    .outcome(),
                governed.outcome()
            );
        }
        let mut failure = evidence();
        failure.disposition = ShaclDisposition::Cancelled;
        assert!(ShaclCommitReceipt::new(primary(), failure).is_err());
    }
}
