//! Atomic commit receipts. The on-disk encoding is independent of physical RDF indexes.

use super::{
    ChangeTrackingError, ChangeTrackingTransaction, CorruptionError, KeyedTransaction, Namespace,
    NamespacePrefix, NegotiatedTransaction, SemanticChangeSet, StorageError, Store,
    TransactionCommitError, TransactionKey, TransactionNonCommitReason, TransactionRequest,
    TransactionRollbackError, TransactionStartControl, TransactionStartError, WritableDataset,
    WritableNamespaceRegistry,
};
use crate::model::{NamedNode, NamedOrBlankNode, Quad, Term};
use crate::storage::StorageTransactionStartError;
use sha2::{Digest, Sha256};

/// Identity of a store lineage. Backups preserve it; independently created stores do not share it.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct StoreIdentity([u8; 16]);

impl StoreIdentity {
    pub(crate) const fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }
    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
    pub(crate) fn new() -> Self {
        Self(rand::random())
    }
}

/// Opaque commit identity, not a timestamp or ordering API.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct CommitId([u8; 32]);

impl CommitId {
    pub(crate) const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// A checksummed acknowledgement bound to one governed transaction's captured effects.
///
/// Receipts contain no RDF payloads. RocksDB persists them atomically with the
/// primary commit; memory stores provide process-local receipts only. This is
/// not itself a feed or evidence of power-loss testing. V2 receipts locate their
/// records in [`Store::read_outbox`]; legacy writes are not covered.
/// Checksums detect accidental corruption; they are not authentication signatures.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitReceipt {
    schema_version: u8,
    store_identity: StoreIdentity,
    commit_id: CommitId,
    transaction_key: TransactionKey,
    sequence: u64,
    effect_count: u64,
    effects_checksum: [u8; 32],
    outbox_header: Option<u64>,
}

impl CommitReceipt {
    pub const fn schema_version(&self) -> u8 {
        self.schema_version
    }
    pub const fn store_identity(&self) -> &StoreIdentity {
        &self.store_identity
    }
    pub const fn commit_id(&self) -> &CommitId {
        &self.commit_id
    }
    pub const fn transaction_key(&self) -> &TransactionKey {
        &self.transaction_key
    }
    /// Store-scoped order among governed receipts only, not all primary writes or a feed cursor.
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }
    pub const fn effect_count(&self) -> u64 {
        self.effect_count
    }
    pub const fn effects_checksum(&self) -> &[u8; 32] {
        &self.effects_checksum
    }
    pub fn verifies_changes(&self, changes: &SemanticChangeSet) -> bool {
        self.effect_count == changes.len() as u64 && self.effects_checksum == changes.checksum()
    }

    /// Header position for a native outbox commit; absent on legacy v1 receipts.
    pub fn outbox_header_cursor(&self) -> Option<super::OutboxCursor> {
        self.outbox_header
            .map(|position| super::OutboxCursor::new(self.store_identity.clone(), position))
    }

    /// Last record in this commit (the header itself for a no-op).
    pub fn outbox_end_cursor(&self) -> Option<super::OutboxCursor> {
        self.outbox_header
            .and_then(|position| position.checked_add(self.effect_count))
            .map(|position| super::OutboxCursor::new(self.store_identity.clone(), position))
    }

    pub(crate) fn with_outbox_header(mut self, position: u64) -> Self {
        self.schema_version = 2;
        self.outbox_header = Some(position);
        self.commit_id = self.derived_commit_id();
        self
    }

    fn derived_commit_id(&self) -> CommitId {
        let mut hasher = Sha256::new();
        hasher.update(if self.outbox_header.is_some() {
            b"oxigraph.commit-id.v2\0"
        } else {
            b"oxigraph.commit-id.v1\0"
        });
        hasher.update(self.store_identity.as_bytes());
        hasher.update(self.sequence.to_be_bytes());
        hasher.update(self.transaction_key.as_bytes());
        hasher.update(self.effect_count.to_be_bytes());
        hasher.update(self.effects_checksum);
        if let Some(position) = self.outbox_header {
            hasher.update(position.to_be_bytes());
        }
        CommitId(hasher.finalize().into())
    }

    pub(crate) fn new(
        store_identity: StoreIdentity,
        sequence: u64,
        transaction_key: TransactionKey,
        changes: &SemanticChangeSet,
    ) -> Self {
        let effect_count = changes.len() as u64;
        let effects_checksum = changes.checksum();
        let mut hasher = Sha256::new();
        hasher.update(b"oxigraph.commit-id.v1\0");
        hasher.update(store_identity.as_bytes());
        hasher.update(sequence.to_be_bytes());
        hasher.update(transaction_key.as_bytes());
        hasher.update(effect_count.to_be_bytes());
        hasher.update(effects_checksum);
        Self {
            schema_version: 1,
            store_identity,
            commit_id: CommitId(hasher.finalize().into()),
            transaction_key,
            sequence,
            effect_count,
            effects_checksum,
            outbox_header: None,
        }
    }

    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(153);
        bytes.push(self.schema_version);
        bytes.extend_from_slice(self.store_identity.as_bytes());
        bytes.extend_from_slice(self.commit_id.as_bytes());
        bytes.extend_from_slice(self.transaction_key.as_bytes());
        bytes.extend_from_slice(&self.sequence.to_be_bytes());
        bytes.extend_from_slice(&self.effect_count.to_be_bytes());
        bytes.extend_from_slice(&self.effects_checksum);
        if let Some(position) = self.outbox_header {
            bytes.extend_from_slice(&position.to_be_bytes());
        }
        let domain = if self.outbox_header.is_some() {
            b"oxigraph.receipt.v2\0"
        } else {
            b"oxigraph.receipt.v1\0"
        };
        let digest = envelope_checksum(domain, &bytes);
        bytes.extend_from_slice(&digest);
        bytes
    }

    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, StorageError> {
        let (length, domain) = match bytes.first() {
            Some(1) if bytes.len() == 145 => (113, b"oxigraph.receipt.v1\0"),
            Some(2) if bytes.len() == 153 => (121, b"oxigraph.receipt.v2\0"),
            _ => {
                return Err(
                    CorruptionError::msg("invalid commit receipt version or length").into(),
                );
            }
        };
        if bytes[length..] != envelope_checksum(domain, &bytes[..length]) {
            return Err(
                CorruptionError::msg("invalid commit receipt version, length or checksum").into(),
            );
        }
        let (fields, tail) = bytes.split_at(113);
        let fields: [u8; 113] = receipt_field(fields)?;
        let sequence = u64::from_be_bytes(receipt_field(&fields[65..73])?);
        if sequence == 0 {
            return Err(CorruptionError::msg("invalid zero receipt sequence").into());
        }
        let receipt = Self {
            schema_version: fields[0],
            store_identity: StoreIdentity(receipt_field(&fields[1..17])?),
            commit_id: CommitId(receipt_field(&fields[17..49])?),
            transaction_key: TransactionKey::new(receipt_field(&fields[49..65])?),
            sequence,
            effect_count: u64::from_be_bytes(receipt_field(&fields[73..81])?),
            effects_checksum: receipt_field(&fields[81..113])?,
            outbox_header: if fields[0] == 2 {
                Some(u64::from_be_bytes(receipt_field(&tail[..8])?))
            } else {
                None
            },
        };
        if receipt.outbox_header.is_some_and(|position| {
            position == 0 || position.checked_add(receipt.effect_count).is_none()
        }) {
            return Err(CorruptionError::msg("invalid receipt outbox range").into());
        }
        if receipt.commit_id != receipt.derived_commit_id() {
            return Err(
                CorruptionError::msg("receipt commit identity does not match its fields").into(),
            );
        }
        Ok(receipt)
    }
}

/// Lookup never replays a transaction. An unseen key is indeterminate, not proven absent.
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum CommitReceiptOutcome {
    Committed(CommitReceipt),
    /// An explicitly ungoverned legacy keyed transaction committed without a receipt.
    CommittedWithoutReceipt,
    ProvenAbsent(TransactionNonCommitReason),
    Indeterminate,
}

/// Internal high-water record, atomically published with each governed receipt.
#[derive(Clone)]
pub(crate) struct GovernanceState {
    pub store_identity: StoreIdentity,
    pub sequence: u64,
    pub outbox: Option<super::outbox::OutboxState>,
}

impl Default for GovernanceState {
    fn default() -> Self {
        Self {
            store_identity: StoreIdentity::new(),
            sequence: 0,
            outbox: None,
        }
    }
}

impl GovernanceState {
    pub fn next_receipt(
        &self,
        transaction_key: &[u8; 16],
        changes: &SemanticChangeSet,
    ) -> Result<CommitReceipt, StorageError> {
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or_else(|| CorruptionError::msg("governed receipt sequence exhausted"))?;
        Ok(CommitReceipt::new(
            self.store_identity.clone(),
            sequence,
            TransactionKey::new(*transaction_key),
            changes,
        ))
    }

    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(73);
        bytes.push(if self.outbox.is_some() { 2 } else { 1 });
        bytes.extend_from_slice(self.store_identity.as_bytes());
        bytes.extend_from_slice(&self.sequence.to_be_bytes());
        if let Some(outbox) = &self.outbox {
            bytes.extend_from_slice(&outbox.high_water.to_be_bytes());
            bytes.extend_from_slice(&outbox.after_receipt_sequence.to_be_bytes());
        }
        let domain = if self.outbox.is_some() {
            b"oxigraph.governance.v2\0"
        } else {
            b"oxigraph.governance.v1\0"
        };
        let digest = envelope_checksum(domain, &bytes);
        bytes.extend_from_slice(&digest);
        bytes
    }

    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub fn decode(bytes: &[u8]) -> Result<Self, StorageError> {
        let (length, domain) = match bytes.first() {
            Some(1) if bytes.len() == 57 => (25, b"oxigraph.governance.v1\0"),
            Some(2) if bytes.len() == 73 => (41, b"oxigraph.governance.v2\0"),
            _ => {
                return Err(
                    CorruptionError::msg("invalid governance state version or length").into(),
                );
            }
        };
        if bytes[length..] != envelope_checksum(domain, &bytes[..length]) {
            return Err(CorruptionError::msg(
                "invalid governance state version, length or checksum",
            )
            .into());
        }
        let (fields, tail) = bytes.split_at(25);
        let fields: [u8; 25] = receipt_field(fields)?;
        let sequence = u64::from_be_bytes(receipt_field(&fields[17..25])?);
        if sequence == 0 {
            return Err(CorruptionError::msg("invalid zero governance high-water mark").into());
        }
        let outbox = if fields[0] == 2 {
            let outbox_fields: [u8; 16] = receipt_field(&tail[..16])?;
            let high_water = u64::from_be_bytes(receipt_field(&outbox_fields[..8])?);
            let after_receipt_sequence = u64::from_be_bytes(receipt_field(&outbox_fields[8..])?);
            if high_water == 0
                || after_receipt_sequence >= sequence
                || high_water < sequence - after_receipt_sequence
            {
                return Err(
                    CorruptionError::msg("invalid outbox high-water or coverage origin").into(),
                );
            }
            Some(super::outbox::OutboxState {
                high_water,
                after_receipt_sequence,
            })
        } else {
            None
        };
        Ok(Self {
            store_identity: StoreIdentity(receipt_field(&fields[1..17])?),
            sequence,
            outbox,
        })
    }
}

pub(super) fn receipt_field<const N: usize>(bytes: &[u8]) -> Result<[u8; N], StorageError> {
    bytes
        .try_into()
        .map_err(|_| CorruptionError::msg("invalid receipt field length").into())
}

pub(super) fn envelope_checksum(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

pub(super) fn change_checksum(changes: &SemanticChangeSet) -> [u8; 32] {
    super::change_codec::checksum(changes)
}

impl WritableDataset for GovernedTransaction<'_> {
    type Error = ChangeTrackingError<StorageError>;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Self::Error>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Self::Error>> + 'a>
    where
        Self: 'a;
    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        self.inner
            .quads_for_pattern(subject, predicate, object, graph_name)
    }
    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        self.inner.named_graphs()
    }
    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        self.inner.contains_named_graph(graph_name)
    }
    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.inner.insert(quad)
    }
    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.inner.remove(quad)
    }
    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.inner.insert_named_graph(graph_name)
    }
    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        self.inner.clear_graph(graph_name)
    }
    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_all_named_graphs()
    }
    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_all_graphs()
    }
    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.inner.remove_named_graph(graph_name)
    }
    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.remove_all_named_graphs()
    }
    fn clear(&mut self) -> Result<(), Self::Error> {
        self.inner.clear()
    }
    fn commit(self) -> Result<(), Self::Error> {
        GovernedTransaction::commit(self)
            .map(|_| ())
            .map_err(|error| match error {
                TransactionCommitError::Rejected(error) => error,
                outcome => ChangeTrackingError::Backend(StorageError::Other(Box::new(outcome))),
            })
    }
    fn rollback(self) -> Result<(), Self::Error> {
        self.inner.rollback()
    }
}

impl WritableNamespaceRegistry for GovernedTransaction<'_> {
    type Namespaces<'a>
        = Box<dyn Iterator<Item = Result<Namespace, Self::Error>> + 'a>
    where
        Self: 'a;
    fn namespaces(&self) -> Self::Namespaces<'_> {
        self.inner.namespaces()
    }
    fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, Self::Error> {
        self.inner.namespace(prefix)
    }
    fn set_namespace(&mut self, namespace: Namespace) -> Result<(), Self::Error> {
        self.inner.set_namespace(namespace)
    }
    fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), Self::Error> {
        self.inner.remove_namespace(prefix)
    }
    fn clear_namespaces(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_namespaces()
    }
}

impl super::OutcomeAwareWritableDataset for GovernedTransaction<'_> {
    fn commit_with_outcome(self) -> Result<(), TransactionCommitError<Self::Error>> {
        self.commit().map(|_| ())
    }
    fn rollback_with_outcome(self) -> Result<(), TransactionRollbackError<Self::Error>> {
        self.rollback()
    }
}

impl Store {
    /// Reads at most `max_records` records after the supplied cursor, or from the
    /// coverage origin for `None`. RocksDB records survive reopen and backup;
    /// memory records live only as long as that store. No retention or automatic
    /// acknowledgement is performed. This feed covers only governed commits.
    /// The bound is in records, not bytes; a single RDF term can be large.
    pub fn read_outbox(
        &self,
        after: Option<&super::OutboxCursor>,
        max_records: std::num::NonZeroUsize,
    ) -> Result<super::OutboxBatch, super::OutboxReadError> {
        self.storage.read_outbox(after, max_records)
    }

    /// Opens an opt-in governed transaction with internally captured effects.
    /// Require durable outcome lookup in `request` when process-local memory receipts are insufficient.
    ///
    /// ```
    /// use oxigraph::model::{GraphName, NamedNode, Quad};
    /// use oxigraph::store::{CommitReceiptOutcome, Store, TransactionKey, TransactionRequest, WritableDataset};
    ///
    /// let store = Store::new()?; // Use Store::open for durable RocksDB receipts.
    /// let key = TransactionKey::new([1; 16]); // Allocate a fresh application request key.
    /// let mut tx = store.start_governed_transaction(TransactionRequest::default(), key.clone())?
    ///     .into_transaction();
    /// let node = NamedNode::new("urn:example")?;
    /// tx.insert(Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph))?;
    /// let changes = tx.changes()?;
    /// let receipt = tx.commit()?;
    /// assert!(receipt.verifies_changes(&changes));
    /// assert_eq!(store.lookup_commit_receipt(&key)?, CommitReceiptOutcome::Committed(receipt));
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    pub fn start_governed_transaction(
        &self,
        request: TransactionRequest,
        transaction_key: TransactionKey,
    ) -> Result<NegotiatedTransaction<GovernedTransaction<'_>>, TransactionStartError<StorageError>>
    {
        self.start_governed_transaction_with_control(
            request,
            transaction_key,
            TransactionStartControl::new(),
        )
    }

    #[expect(
        clippy::needless_pass_by_value,
        reason = "owned request/control matches the existing keyed admission API"
    )]
    pub fn start_governed_transaction_with_control(
        &self,
        request: TransactionRequest,
        transaction_key: TransactionKey,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<GovernedTransaction<'_>>, TransactionStartError<StorageError>>
    {
        let started_at = std::time::Instant::now();
        let effective = self.transaction_capabilities();
        let unmet = effective.unmet_requirements(request.requirements());
        if !unmet.is_empty() {
            return Err(TransactionStartError::RequirementsNotMet { unmet, effective });
        }
        let inner = self
            .storage
            .start_governed_transaction_with_control(
                transaction_key.as_bytes(),
                &control,
                started_at,
            )
            .map_err(|error| match error {
                StorageTransactionStartError::Cancelled => TransactionStartError::Cancelled,
                StorageTransactionStartError::TimedOut => TransactionStartError::TimedOut,
                StorageTransactionStartError::Backend(error) => {
                    TransactionStartError::Backend(error)
                }
            })?;
        Ok(NegotiatedTransaction::new(
            GovernedTransaction {
                inner: ChangeTrackingTransaction::new(KeyedTransaction {
                    inner,
                    transaction_key,
                }),
            },
            effective,
        ))
    }

    /// Retrieves a governed receipt or legacy/unknown outcome without executing any RDF operation.
    pub fn lookup_commit_receipt(
        &self,
        transaction_key: &TransactionKey,
    ) -> Result<CommitReceiptOutcome, StorageError> {
        self.storage
            .lookup_commit_receipt(transaction_key.as_bytes())
    }
}

/// An owned write transaction whose internally captured receipt shares the primary commit.
///
/// Dropping or explicitly rolling back publishes no receipt. There is no mutable
/// access to the underlying transaction and callers cannot provide fabricated effects.
/// Use the inherent [`Self::commit`] for the receipt and typed ambiguous outcomes.
/// Generic [`WritableDataset::commit`] still commits a receipt but discards the
/// return value and retains ambiguous errors through their source chain.
#[must_use]
pub struct GovernedTransaction<'a> {
    inner: ChangeTrackingTransaction<KeyedTransaction<'a>>,
}

#[expect(
    clippy::same_name_method,
    reason = "inherent receipt/outcome methods deliberately refine the minimal write trait"
)]
impl GovernedTransaction<'_> {
    pub fn transaction_key(&self) -> &TransactionKey {
        self.inner.inner().transaction_key()
    }
    /// Pending effects, not a commit receipt.
    pub fn changes(&self) -> Result<SemanticChangeSet, ChangeTrackingError<StorageError>> {
        self.inner.changes()
    }

    /// Publishes primary changes, receipt and keyed outcome atomically.
    pub fn commit(
        self,
    ) -> Result<CommitReceipt, TransactionCommitError<ChangeTrackingError<StorageError>>> {
        let (transaction, changes) = self
            .inner
            .into_parts()
            .map_err(TransactionCommitError::Rejected)?;
        transaction
            .inner
            .commit_with_receipt(&changes)
            .map_err(|error| match error {
                TransactionCommitError::Rejected(error) => {
                    TransactionCommitError::Rejected(ChangeTrackingError::Backend(error))
                }
                TransactionCommitError::Conflicted => TransactionCommitError::Conflicted,
                TransactionCommitError::Cancelled => TransactionCommitError::Cancelled,
                TransactionCommitError::Indeterminate {
                    transaction_key,
                    source,
                } => TransactionCommitError::Indeterminate {
                    transaction_key,
                    source: ChangeTrackingError::Backend(source),
                },
            })
    }

    pub fn rollback(
        self,
    ) -> Result<(), TransactionRollbackError<ChangeTrackingError<StorageError>>> {
        super::OutcomeAwareWritableDataset::rollback_with_outcome(self.inner)
    }
}

#[cfg(test)]
#[expect(
    clippy::panic_in_result_fn,
    clippy::missing_assert_message,
    reason = "receipt format and failure assertions"
)]
mod tests {
    use super::*;

    #[test]
    fn receipt_encoding_checks_every_byte_and_derived_identity() -> Result<(), StorageError> {
        let receipt = CommitReceipt::new(
            StoreIdentity([7; 16]),
            3,
            TransactionKey::new([8; 16]),
            &SemanticChangeSet::default(),
        );
        let encoded = receipt.encode();
        assert_eq!(encoded.len(), 145);
        assert_eq!(CommitReceipt::decode(&encoded)?, receipt);
        for index in 0..encoded.len() {
            let mut corrupt = encoded.clone();
            corrupt[index] ^= 1;
            assert!(CommitReceipt::decode(&corrupt).is_err(), "byte {index}");
        }
        for end in 0..encoded.len() {
            assert!(CommitReceipt::decode(&encoded[..end]).is_err());
        }
        let mut wrong_identity = encoded;
        wrong_identity[17] ^= 1;
        let checksum = envelope_checksum(b"oxigraph.receipt.v1\0", &wrong_identity[..113]);
        wrong_identity[113..].copy_from_slice(&checksum);
        assert!(CommitReceipt::decode(&wrong_identity).is_err());
        Ok(())
    }

    #[test]
    fn governance_encoding_rejects_corruption_zero_and_exhaustion() -> Result<(), StorageError> {
        let state = GovernanceState {
            store_identity: StoreIdentity([9; 16]),
            sequence: 1,
            outbox: None,
        };
        let encoded = state.encode();
        assert_eq!(GovernanceState::decode(&encoded)?.sequence, 1);
        for index in 0..encoded.len() {
            let mut corrupt = encoded.clone();
            corrupt[index] ^= 1;
            assert!(GovernanceState::decode(&corrupt).is_err(), "byte {index}");
        }
        for end in 0..encoded.len() {
            assert!(GovernanceState::decode(&encoded[..end]).is_err());
        }
        assert!(GovernanceState::decode(&GovernanceState::default().encode()).is_err());
        let exhausted = GovernanceState {
            sequence: u64::MAX,
            ..state
        };
        assert!(
            exhausted
                .next_receipt(&[1; 16], &SemanticChangeSet::default())
                .is_err()
        );
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn governed_commit_faults_resolve_after_reopen_without_replay()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::model::GraphName;
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        for point in [
            Fault::CommitAttemptedBefore,
            Fault::CommitAttemptedAfter,
            Fault::FinalBatchBefore,
            Fault::FinalBatchAfter,
        ] {
            let directory = tempfile::tempdir()?;
            let key = TransactionKey::new([1; 16]);
            let node = NamedNode::new_unchecked("urn:receipt");
            let quad = Quad::new(
                node.clone(),
                node.clone(),
                node.clone(),
                GraphName::DefaultGraph,
            );
            let ns = Namespace::new(NamespacePrefix::new("ex")?, node);
            let changes;
            {
                let store = Store::open(directory.path())?;
                let mut tx = store
                    .start_governed_transaction(TransactionRequest::default(), key.clone())?
                    .into_transaction();
                tx.insert(quad.clone())?;
                tx.set_namespace(ns.clone())?;
                changes = tx.changes()?;
                store.storage.arm_transaction_outcome_fault(point)?;
                assert!(
                    matches!(tx.commit(), Err(TransactionCommitError::Indeterminate { transaction_key, .. }) if transaction_key == key)
                );
                assert!(
                    store
                        .storage
                        .transaction_outcome_fault_events()?
                        .contains(&point)
                );
            }
            let store = Store::open(directory.path())?;
            let committed = point == Fault::FinalBatchAfter;
            assert_eq!(store.contains(&quad)?, committed);
            assert_eq!(store.namespace(ns.prefix())?.is_some(), committed);
            match store.lookup_commit_receipt(&key)? {
                CommitReceiptOutcome::Committed(receipt) => {
                    assert!(committed);
                    assert!(receipt.verifies_changes(&changes));
                    assert_eq!(receipt.sequence(), 1);
                }
                CommitReceiptOutcome::Indeterminate => assert!(!committed),
                other => panic!("unexpected outcome: {other:?}"),
            }
            let page = store.read_outbox(None, std::num::NonZeroUsize::new(100).unwrap())?;
            assert_eq!(
                page.records().len(),
                if committed { changes.len() + 1 } else { 0 }
            );
            assert_eq!(page.high_water().is_some(), committed);
            if committed {
                let replay: Vec<_> = page
                    .records()
                    .iter()
                    .filter_map(|record| match record {
                        super::super::OutboxRecord::Event { change, .. } => Some(change.clone()),
                        _ => None,
                    })
                    .collect();
                assert_eq!(replay, changes.as_slice());
            }
            assert!(
                store
                    .start_governed_transaction(TransactionRequest::default(), key)
                    .is_err()
            );
            // Failed final batches did not consume a receipt sequence.
            let next = store
                .start_governed_transaction(
                    TransactionRequest::default(),
                    TransactionKey::new([2; 16]),
                )?
                .into_transaction()
                .commit()?;
            assert_eq!(next.sequence(), if committed { 2 } else { 1 });
            let next_page = store.read_outbox(page.high_water(), std::num::NonZeroUsize::MIN)?;
            assert_eq!(next_page.records().len(), 1);
            assert_eq!(next_page.high_water(), next.outbox_end_cursor().as_ref());
        }
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn governed_reservation_and_rollback_faults_remain_conservative()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        for point in [
            Fault::StagingBefore,
            Fault::StagingAfter,
            Fault::RolledBackBefore,
            Fault::RolledBackAfter,
        ] {
            let directory = tempfile::tempdir()?;
            let key = TransactionKey::new([1; 16]);
            {
                let store = Store::open(directory.path())?;
                if matches!(point, Fault::StagingBefore | Fault::StagingAfter) {
                    store.storage.arm_transaction_outcome_fault(point)?;
                    assert!(
                        store
                            .start_governed_transaction(TransactionRequest::default(), key.clone())
                            .is_err()
                    );
                } else {
                    let mut tx = store
                        .start_governed_transaction(TransactionRequest::default(), key.clone())?
                        .into_transaction();
                    tx.set_namespace(Namespace::new(
                        NamespacePrefix::new("ex")?,
                        NamedNode::new_unchecked("urn:rollback"),
                    ))?;
                    store.storage.arm_transaction_outcome_fault(point)?;
                    assert!(tx.rollback().is_err());
                }
                assert!(
                    store
                        .storage
                        .transaction_outcome_fault_events()?
                        .contains(&point)
                );
            }
            let store = Store::open(directory.path())?;
            assert!(store.namespace(&NamespacePrefix::new("ex")?)?.is_none());
            let page = store.read_outbox(None, std::num::NonZeroUsize::MIN)?;
            assert!(page.records().is_empty());
            assert!(page.high_water().is_none());
            let outcome = store.lookup_commit_receipt(&key)?;
            // rollback_keyed may retry its staging tombstone from Drop; either
            // durable absence or unresolved reservation is safe, never a receipt.
            if matches!(point, Fault::StagingBefore | Fault::StagingAfter) {
                assert_eq!(outcome, CommitReceiptOutcome::Indeterminate);
            } else {
                assert!(matches!(
                    outcome,
                    CommitReceiptOutcome::ProvenAbsent(_) | CommitReceiptOutcome::Indeterminate
                ));
            }
            let retry = store.start_governed_transaction(TransactionRequest::default(), key);
            assert_eq!(retry.is_ok(), point == Fault::StagingBefore);
            drop(retry);
            assert_eq!(
                store
                    .start_governed_transaction(
                        TransactionRequest::default(),
                        TransactionKey::new([2; 16])
                    )?
                    .into_transaction()
                    .commit()?
                    .sequence(),
                1
            );
        }
        Ok(())
    }
}
