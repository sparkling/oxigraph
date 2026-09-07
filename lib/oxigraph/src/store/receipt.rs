//! Atomic commit receipts. The on-disk encoding is independent of physical RDF indexes.

use super::{
    ChangeTrackingError, ChangeTrackingTransaction, CorruptionError, KeyedTransaction, Namespace,
    NamespacePrefix, NegotiatedTransaction, SemanticChange, SemanticChangeSet, StorageError, Store,
    TransactionCommitError, TransactionKey, TransactionNonCommitReason, TransactionRequest,
    TransactionRollbackError, TransactionStartControl, TransactionStartError, WritableDataset,
    WritableNamespaceRegistry,
};
use crate::model::{GraphNameRef, NamedNode, NamedOrBlankNode, Quad, Term, TermRef};
use crate::storage::StorageTransactionStartError;
use sha2::{Digest, Sha256};

/// Identity of a store lineage. Backups preserve it; independently created stores do not share it.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct StoreIdentity([u8; 16]);

impl StoreIdentity {
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
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// A checksummed acknowledgement bound to one governed transaction's captured effects.
///
/// Receipts contain no RDF payloads. RocksDB persists them atomically with the
/// primary commit; memory stores provide process-local receipts only. This is
/// not an outbox or evidence of power-loss testing. Legacy writes are not covered.
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
        }
    }

    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(145);
        bytes.push(self.schema_version);
        bytes.extend_from_slice(self.store_identity.as_bytes());
        bytes.extend_from_slice(self.commit_id.as_bytes());
        bytes.extend_from_slice(self.transaction_key.as_bytes());
        bytes.extend_from_slice(&self.sequence.to_be_bytes());
        bytes.extend_from_slice(&self.effect_count.to_be_bytes());
        bytes.extend_from_slice(&self.effects_checksum);
        let digest = envelope_checksum(b"oxigraph.receipt.v1\0", &bytes);
        bytes.extend_from_slice(&digest);
        bytes
    }

    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, StorageError> {
        let bytes: &[u8; 145] = bytes
            .try_into()
            .map_err(|_| CorruptionError::msg("invalid commit receipt length"))?;
        if bytes[0] != 1
            || bytes[113..] != envelope_checksum(b"oxigraph.receipt.v1\0", &bytes[..113])
        {
            return Err(
                CorruptionError::msg("invalid commit receipt version, length or checksum").into(),
            );
        }
        let sequence = u64::from_be_bytes(receipt_field(&bytes[65..73])?);
        if sequence == 0 {
            return Err(CorruptionError::msg("invalid zero receipt sequence").into());
        }
        let receipt = Self {
            schema_version: bytes[0],
            store_identity: StoreIdentity(receipt_field(&bytes[1..17])?),
            commit_id: CommitId(receipt_field(&bytes[17..49])?),
            transaction_key: TransactionKey::new(receipt_field(&bytes[49..65])?),
            sequence,
            effect_count: u64::from_be_bytes(receipt_field(&bytes[73..81])?),
            effects_checksum: receipt_field(&bytes[81..113])?,
        };
        let mut hasher = Sha256::new();
        hasher.update(b"oxigraph.commit-id.v1\0");
        hasher.update(receipt.store_identity.as_bytes());
        hasher.update(receipt.sequence.to_be_bytes());
        hasher.update(receipt.transaction_key.as_bytes());
        hasher.update(receipt.effect_count.to_be_bytes());
        hasher.update(receipt.effects_checksum);
        let expected: [u8; 32] = hasher.finalize().into();
        if receipt.commit_id.as_bytes() != &expected {
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
}

impl Default for GovernanceState {
    fn default() -> Self {
        Self {
            store_identity: StoreIdentity::new(),
            sequence: 0,
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
        let mut bytes = Vec::with_capacity(57);
        bytes.push(1);
        bytes.extend_from_slice(self.store_identity.as_bytes());
        bytes.extend_from_slice(&self.sequence.to_be_bytes());
        let digest = envelope_checksum(b"oxigraph.governance.v1\0", &bytes);
        bytes.extend_from_slice(&digest);
        bytes
    }

    #[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
    pub fn decode(bytes: &[u8]) -> Result<Self, StorageError> {
        let bytes: &[u8; 57] = bytes
            .try_into()
            .map_err(|_| CorruptionError::msg("invalid governance state length"))?;
        if bytes[0] != 1
            || bytes[25..] != envelope_checksum(b"oxigraph.governance.v1\0", &bytes[..25])
        {
            return Err(CorruptionError::msg(
                "invalid governance state version, length or checksum",
            )
            .into());
        }
        let sequence = u64::from_be_bytes(receipt_field(&bytes[17..25])?);
        if sequence == 0 {
            return Err(CorruptionError::msg("invalid zero governance high-water mark").into());
        }
        Ok(Self {
            store_identity: StoreIdentity(receipt_field(&bytes[1..17])?),
            sequence,
        })
    }
}

#[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
fn receipt_field<const N: usize>(bytes: &[u8]) -> Result<[u8; N], StorageError> {
    bytes
        .try_into()
        .map_err(|_| CorruptionError::msg("invalid receipt field length").into())
}

#[cfg(any(test, all(not(target_family = "wasm"), feature = "rocksdb")))]
fn envelope_checksum(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

pub(super) fn change_checksum(changes: &SemanticChangeSet) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"oxigraph.semantic-changes.v1\0");
    hasher.update((changes.len() as u64).to_be_bytes());
    for change in changes.as_slice() {
        let tag = match change {
            SemanticChange::QuadAdded(_) => 0,
            SemanticChange::QuadRemoved(_) => 1,
            SemanticChange::NamedGraphCreated(_) => 2,
            SemanticChange::GraphCleared(_) => 3,
            SemanticChange::NamedGraphDropped(_) => 4,
            SemanticChange::AllNamedGraphsCleared => 5,
            SemanticChange::AllGraphsCleared => 6,
            SemanticChange::AllNamedGraphsDropped => 7,
            SemanticChange::DatasetCleared => 8,
            SemanticChange::NamespaceChanged { .. } => 9,
            SemanticChange::NamespacesCleared => 10,
        };
        hasher.update([tag]);
        match change {
            SemanticChange::QuadAdded(quad) | SemanticChange::QuadRemoved(quad) => {
                hash_term(&mut hasher, quad.subject.as_ref().into());
                hash_term(&mut hasher, quad.predicate.as_ref().into());
                hash_term(&mut hasher, quad.object.as_ref());
                hash_graph(&mut hasher, quad.graph_name.as_ref());
            }
            SemanticChange::NamedGraphCreated(graph) | SemanticChange::NamedGraphDropped(graph) => {
                hash_term(&mut hasher, graph.as_ref().into())
            }
            SemanticChange::GraphCleared(graph) => hash_graph(&mut hasher, graph.as_ref()),
            SemanticChange::NamespaceChanged {
                prefix,
                before,
                after,
            } => {
                hash_field(&mut hasher, prefix.as_str());
                for iri in [before, after] {
                    hasher.update([u8::from(iri.is_some())]);
                    if let Some(iri) = iri {
                        hash_field(&mut hasher, iri.as_str());
                    }
                }
            }
            _ => (),
        }
    }
    hasher.finalize().into()
}

fn hash_field(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value.as_bytes());
}

fn hash_graph(hasher: &mut Sha256, graph: GraphNameRef<'_>) {
    match graph {
        GraphNameRef::DefaultGraph => hasher.update([0]),
        GraphNameRef::NamedNode(node) => hash_term(hasher, node.into()),
        GraphNameRef::BlankNode(node) => hash_term(hasher, node.into()),
    }
}

// Versioned logical components, never Display output or physical numeric indexes.
// A non-directional literal always emits direction 0, including without rdf-12.
fn hash_term(hasher: &mut Sha256, term: TermRef<'_>) {
    match term {
        TermRef::NamedNode(node) => {
            hasher.update([1]);
            hash_field(hasher, node.as_str());
        }
        TermRef::BlankNode(node) => {
            hasher.update([2]);
            hash_field(hasher, node.as_str());
        }
        TermRef::Literal(literal) => {
            hasher.update([3]);
            hash_field(hasher, literal.value());
            hash_field(hasher, literal.datatype().as_str());
            match literal.language() {
                None => hasher.update([0]),
                Some(language) => {
                    hasher.update([1]);
                    hash_field(hasher, language);
                }
            }
            #[cfg(feature = "rdf-12")]
            let direction = match literal.direction() {
                None => 0,
                Some(crate::model::BaseDirection::Ltr) => 1,
                Some(crate::model::BaseDirection::Rtl) => 2,
            };
            #[cfg(not(feature = "rdf-12"))]
            let direction = 0;
            hasher.update([direction]);
        }
        #[cfg(feature = "rdf-12")]
        TermRef::Triple(triple) => {
            hasher.update([4]);
            hash_term(hasher, triple.subject.as_ref().into());
            hash_term(hasher, triple.predicate.as_ref().into());
            hash_term(hasher, triple.object.as_ref());
        }
    }
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
