//! API to access an on-disk [RDF dataset](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-dataset).
//!
//! The entry point of the module is the [`Store`] struct.
//!
//! Usage example:
//! ```
//! use oxigraph::model::*;
//! use oxigraph::sparql::{QueryResults, SparqlEvaluator};
//! use oxigraph::store::Store;
//!
//! let store = Store::new()?;
//!
//! // insertion
//! let ex = NamedNode::new("http://example.com")?;
//! let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), GraphName::DefaultGraph);
//! store.insert(quad.clone())?;
//!
//! // quad filter
//! let results: Result<Vec<Quad>, _> = store.quads_for_pattern(None, None, None, None).collect();
//! assert_eq!(vec![quad], results?);
//!
//! // SPARQL query
//! if let QueryResults::Solutions(mut solutions) = SparqlEvaluator::new()
//!     .parse_query("SELECT ?s WHERE { ?s ?p ?o }")?
//!     .on_store(&store)
//!     .execute()?
//! {
//!     assert_eq!(
//!         solutions.next().unwrap()?.get("s"),
//!         Some(&ex.clone().into())
//!     );
//! };
//! # Result::<_, Box<dyn std::error::Error>>::Ok(())
//! ```
mod change_codec;
mod contributors;
pub(crate) mod evaluation_metrics;
mod namespace;
pub(crate) mod outbox;
pub(crate) mod policy_metrics;
mod readiness;
pub(crate) mod receipt;
pub(crate) mod retention;
mod semantic_change;
#[cfg(feature = "shacl")]
mod shacl_gate;
pub(crate) mod shacl_receipt;
pub(crate) mod transaction_metrics;
mod transactional;

// Native on-disk package APIs are separate from backend-neutral governance.
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
mod backup;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
mod derived;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
mod derived_generation;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
mod restore;
#[cfg(all(not(target_family = "wasm"), feature = "spatial-index"))]
mod spatial_index;
#[cfg(all(not(target_family = "wasm"), feature = "statistics"))]
mod statistics;
#[cfg(all(not(target_family = "wasm"), feature = "text-index"))]
mod text_index;
#[cfg(all(not(target_family = "wasm"), feature = "spatial-index"))]
pub use spatial_index::{
    SpatialError, SpatialIndexProvider, SpatialLimits, SpatialQuery, SpatialResults,
};
#[cfg(all(not(target_family = "wasm"), feature = "statistics"))]
pub use statistics::{
    FrequencyBounds, FrequentValue, GraphPredicateStatistics, StatisticsError, StatisticsLimits,
    StatisticsProvider, StatisticsSnapshot,
};

pub use crate::storage::TransactionStartControl;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
pub use backup::{
    BackupArtifact, BackupCheckpoint, BackupContents, BackupContribution, BackupError, BackupFile,
    BackupObservation, BackupOptions, BackupReceipt,
};
pub use contributors::{
    ContributorCheckpoint, ContributorConsistency, ContributorDeclaration, ContributorError,
    ContributorHealth, ContributorIdentity, ContributorInventory, ContributorInventoryEntry,
    ContributorObservation, ContributorRegistry,
};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
pub use derived::{
    DerivedCommit, DerivedDelta, DerivedError, DerivedLimits, DerivedScan, DerivedSnapshot,
};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
pub use derived_generation::{
    DerivedFiles, DerivedGeneration, DerivedGenerationError, DerivedGenerationLimits, DerivedIndex,
    DerivedMonitor, DerivedProvider, DerivedRestore, DerivedState, DerivedView, DerivedWriter,
};
pub use evaluation_metrics::{
    EvaluationDurationHistogram, EvaluationMetrics, EvaluationOperation, EvaluationOutcome,
};
pub use namespace::{
    Namespace, NamespacePrefix, NamespacePrefixParseError, WritableNamespaceRegistry,
};
pub use outbox::{OutboxBatch, OutboxCoverage, OutboxCursor, OutboxReadError, OutboxRecord};
pub use policy_metrics::{PolicyDenialPurpose, PolicyMetrics};
pub use readiness::{
    CircuitState, OperationalMetric, OperationalSnapshot, ProbeCoverage, ReadinessDisposition,
    ReadinessPolicy, ReadinessReason,
};
pub use receipt::{
    CommitId, CommitReceipt, CommitReceiptOutcome, GovernedTransaction, StoreIdentity,
};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
pub use restore::{
    RecoveryBaseline, RestoreContributor, RestoreError, RestoreOptions, RestorePrimary,
    RestoreReceipt,
};
pub use retention::{
    ExpiredCommitReceipt, GovernanceError, GovernanceHealth, GovernanceTime, OutboxLease,
    OutboxLeaseToken, OutboxMaintenance, OutboxRetentionPolicy,
};
pub use semantic_change::{
    ChangeTrackingError, ChangeTrackingTransaction, SemanticChange, SemanticChangeSet,
};
#[cfg(feature = "shacl")]
pub use shacl_gate::{
    ShaclCommitError, ShaclCommitPolicy, ShaclCommitReport, ShaclGateError, ShaclGraphScope,
    ShaclGraphValidation, ShaclShapesSource, ShaclStartError, ShaclTransaction,
    ShaclTransactionControl,
};
pub use shacl_receipt::{
    ShaclCommitReceipt, ShaclDisposition, ShaclPolicyDescriptor, ShaclReceiptOutcome,
    ShaclValidationEvidence,
};
#[cfg(all(not(target_family = "wasm"), feature = "text-index"))]
pub use text_index::{
    TextError, TextIndexProvider, TextLimits, TextMatch, TextQuery, TextQueryMode, TextResults,
};
pub use transaction_metrics::{
    TransactionDurationHistogram, TransactionMetrics, TransactionObservation,
};
pub use transactional::{TransactionalDataset, WritableDataset};

/// Isolation provided between concurrent writers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WriterIsolation {
    Unsupported,
    Serialized,
}

/// Behavior when concurrent transactions conflict.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConflictBehavior {
    Unsupported,
    PreventedByWriterSerialization,
    DetectedAndRejected,
}

/// Cancellation guarantees provided by a transaction implementation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CancellationGuarantee {
    Unsupported,
    BeforeCommitAttempt,
}

/// Rollback guarantees provided by a transaction implementation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RollbackGuarantee {
    Unsupported,
    ExplicitOrDropBeforeCommit,
}

/// Support for looking up an indeterminate transaction outcome.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutcomeLookup {
    Unsupported,
    DurableByTransactionKey,
}

/// Effective guarantees provided by a transactional dataset.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransactionCapabilities {
    atomic_publication: bool,
    read_your_writes: bool,
    writer_isolation: WriterIsolation,
    conflict_behavior: ConflictBehavior,
    cancellation: CancellationGuarantee,
    rollback: RollbackGuarantee,
    outcome_lookup: OutcomeLookup,
}

impl TransactionCapabilities {
    pub const fn none() -> Self {
        Self {
            atomic_publication: false,
            read_your_writes: false,
            writer_isolation: WriterIsolation::Unsupported,
            conflict_behavior: ConflictBehavior::Unsupported,
            cancellation: CancellationGuarantee::Unsupported,
            rollback: RollbackGuarantee::Unsupported,
            outcome_lookup: OutcomeLookup::Unsupported,
        }
    }

    pub const fn atomic_publication(&self) -> bool {
        self.atomic_publication
    }

    pub const fn read_your_writes(&self) -> bool {
        self.read_your_writes
    }

    pub const fn writer_isolation(&self) -> WriterIsolation {
        self.writer_isolation
    }

    pub const fn conflict_behavior(&self) -> ConflictBehavior {
        self.conflict_behavior
    }

    pub const fn cancellation(&self) -> CancellationGuarantee {
        self.cancellation
    }

    pub const fn rollback(&self) -> RollbackGuarantee {
        self.rollback
    }

    pub const fn outcome_lookup(&self) -> OutcomeLookup {
        self.outcome_lookup
    }

    #[must_use]
    pub const fn with_atomic_publication(mut self) -> Self {
        self.atomic_publication = true;
        self
    }

    #[must_use]
    pub const fn with_read_your_writes(mut self) -> Self {
        self.read_your_writes = true;
        self
    }

    #[must_use]
    pub const fn with_writer_isolation(mut self, value: WriterIsolation) -> Self {
        self.writer_isolation = value;
        self
    }

    #[must_use]
    pub const fn with_conflict_behavior(mut self, value: ConflictBehavior) -> Self {
        self.conflict_behavior = value;
        self
    }

    #[must_use]
    pub const fn with_cancellation(mut self, value: CancellationGuarantee) -> Self {
        self.cancellation = value;
        self
    }

    #[must_use]
    pub const fn with_rollback(mut self, value: RollbackGuarantee) -> Self {
        self.rollback = value;
        self
    }

    #[must_use]
    pub const fn with_outcome_lookup(mut self, value: OutcomeLookup) -> Self {
        self.outcome_lookup = value;
        self
    }

    pub fn unmet_requirements(
        &self,
        requirements: &TransactionRequirements,
    ) -> Vec<UnmetTransactionRequirement> {
        let mut unmet = Vec::new();
        if requirements.atomic_publication && !self.atomic_publication {
            unmet.push(UnmetTransactionRequirement::AtomicPublication);
        }
        if requirements.read_your_writes && !self.read_your_writes {
            unmet.push(UnmetTransactionRequirement::ReadYourWrites);
        }
        if requirements.writer_isolation != WriterIsolation::Unsupported
            && requirements.writer_isolation != self.writer_isolation
        {
            unmet.push(UnmetTransactionRequirement::WriterIsolation);
        }
        if requirements.conflict_behavior != ConflictBehavior::Unsupported
            && requirements.conflict_behavior != self.conflict_behavior
        {
            unmet.push(UnmetTransactionRequirement::ConflictBehavior);
        }
        if requirements.cancellation != CancellationGuarantee::Unsupported
            && requirements.cancellation != self.cancellation
        {
            unmet.push(UnmetTransactionRequirement::Cancellation);
        }
        if requirements.rollback != RollbackGuarantee::Unsupported
            && requirements.rollback != self.rollback
        {
            unmet.push(UnmetTransactionRequirement::Rollback);
        }
        if requirements.outcome_lookup != OutcomeLookup::Unsupported
            && requirements.outcome_lookup != self.outcome_lookup
        {
            unmet.push(UnmetTransactionRequirement::OutcomeLookup);
        }
        unmet
    }
}

/// Minimum guarantees required when starting a transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransactionRequirements {
    atomic_publication: bool,
    read_your_writes: bool,
    writer_isolation: WriterIsolation,
    conflict_behavior: ConflictBehavior,
    cancellation: CancellationGuarantee,
    rollback: RollbackGuarantee,
    outcome_lookup: OutcomeLookup,
}

impl TransactionRequirements {
    pub const fn legacy() -> Self {
        Self {
            atomic_publication: true,
            read_your_writes: true,
            writer_isolation: WriterIsolation::Unsupported,
            conflict_behavior: ConflictBehavior::Unsupported,
            cancellation: CancellationGuarantee::Unsupported,
            rollback: RollbackGuarantee::ExplicitOrDropBeforeCommit,
            outcome_lookup: OutcomeLookup::Unsupported,
        }
    }

    #[must_use]
    pub const fn requiring_writer_isolation(mut self, value: WriterIsolation) -> Self {
        self.writer_isolation = value;
        self
    }

    #[must_use]
    pub const fn requiring_conflict_behavior(mut self, value: ConflictBehavior) -> Self {
        self.conflict_behavior = value;
        self
    }

    #[must_use]
    pub const fn requiring_cancellation(mut self, value: CancellationGuarantee) -> Self {
        self.cancellation = value;
        self
    }

    #[must_use]
    pub const fn requiring_outcome_lookup(mut self, value: OutcomeLookup) -> Self {
        self.outcome_lookup = value;
        self
    }
}

/// Request used to negotiate a transaction before opening it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransactionRequest {
    requirements: TransactionRequirements,
}

impl TransactionRequest {
    pub const fn new(requirements: TransactionRequirements) -> Self {
        Self { requirements }
    }

    pub const fn requirements(&self) -> &TransactionRequirements {
        &self.requirements
    }
}

impl Default for TransactionRequest {
    fn default() -> Self {
        Self::new(TransactionRequirements::legacy())
    }
}

/// A capability dimension that was not satisfied.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnmetTransactionRequirement {
    AtomicPublication,
    ReadYourWrites,
    WriterIsolation,
    ConflictBehavior,
    Cancellation,
    Rollback,
    OutcomeLookup,
}

use crate::io::{RdfParseError, RdfParser, RdfSerializer};
use crate::model::*;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use crate::storage::StorageOptions;
#[cfg(not(target_family = "wasm"))]
use crate::storage::map_thread_result;
use crate::storage::numeric_encoder::{Decoder, EncodedQuad, EncodedTerm};
pub use crate::storage::{CorruptionError, LoaderError, SerializerError, StorageError};
use crate::storage::{
    DEFAULT_BULK_LOAD_BATCH_SIZE, DecodingGraphIterator, DecodingQuadIterator, Storage,
    StorageBulkLoader, StorageKeyedReadableTransaction, StorageReadableTransaction, StorageReader,
    StorageTransactionOutcome, StorageTransactionStartError,
};
#[cfg(not(target_family = "wasm"))]
use std::cmp::max;
use std::fmt;
#[cfg(not(target_family = "wasm"))]
use std::fs::File;
use std::io::{Read, Write};
use std::mem::swap;
#[cfg(not(target_family = "wasm"))]
use std::num::NonZero;
#[cfg(not(target_family = "wasm"))]
use std::path::Path;
use std::sync::Arc;
#[cfg(not(target_family = "wasm"))]
use std::sync::mpsc;
#[cfg(not(target_family = "wasm"))]
use std::thread;
#[cfg(not(target_family = "wasm"))]
use std::thread::available_parallelism;

/// Stable identifier used to resolve an indeterminate commit outcome.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct TransactionKey([u8; 16]);

impl TransactionKey {
    pub const fn new(value: [u8; 16]) -> Self {
        Self(value)
    }

    /// Returns the stable byte representation of this transaction key.
    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    /// Consumes this transaction key and returns its stable byte representation.
    pub const fn into_bytes(self) -> [u8; 16] {
        self.0
    }
}

/// Proven reason why a transaction did not publish its effects.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransactionNonCommitReason {
    Rejected,
    Conflicted,
    Cancelled,
    RolledBack,
}

/// Terminal state resolved for a caller-supplied transaction key.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransactionOutcome {
    Committed,
    ProvenAbsent(TransactionNonCommitReason),
    Indeterminate,
}

/// Failure while negotiating or opening a transaction.
#[derive(Debug)]
pub enum TransactionStartError<E> {
    RequirementsNotMet {
        unmet: Vec<UnmetTransactionRequirement>,
        effective: TransactionCapabilities,
    },
    Cancelled,
    TimedOut,
    Backend(E),
}

impl<E: fmt::Display> fmt::Display for TransactionStartError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RequirementsNotMet { .. } => f.write_str("transaction requirements are not met"),
            Self::Cancelled => f.write_str("transaction start was cancelled"),
            Self::TimedOut => f.write_str("transaction start timed out"),
            Self::Backend(error) => write!(f, "failed to open transaction: {error}"),
        }
    }
}

impl<E: std::error::Error + 'static> std::error::Error for TransactionStartError<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Backend(error) => Some(error),
            Self::RequirementsNotMet { .. } | Self::Cancelled | Self::TimedOut => None,
        }
    }
}

/// Typed result of a failed commit attempt.
#[derive(Debug)]
pub enum TransactionCommitError<E> {
    Rejected(E),
    Conflicted,
    Cancelled,
    Indeterminate {
        transaction_key: TransactionKey,
        source: E,
    },
}

impl<E: fmt::Display> fmt::Display for TransactionCommitError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rejected(error) => write!(f, "transaction was rejected: {error}"),
            Self::Conflicted => f.write_str("transaction conflicted"),
            Self::Cancelled => f.write_str("transaction was cancelled"),
            Self::Indeterminate { source, .. } => {
                write!(f, "transaction outcome is indeterminate: {source}")
            }
        }
    }
}

impl<E: std::error::Error + 'static> std::error::Error for TransactionCommitError<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Rejected(error) | Self::Indeterminate { source: error, .. } => Some(error),
            Self::Conflicted | Self::Cancelled => None,
        }
    }
}

/// Typed result of a failed rollback attempt.
#[derive(Debug)]
pub enum TransactionRollbackError<E> {
    Failed(E),
}

impl<E: fmt::Display> fmt::Display for TransactionRollbackError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Failed(error) => write!(f, "transaction rollback failed: {error}"),
        }
    }
}

impl<E: std::error::Error + 'static> std::error::Error for TransactionRollbackError<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Failed(error) => Some(error),
        }
    }
}

/// Extension for backends that can prove terminal transaction outcomes.
pub trait OutcomeAwareWritableDataset: WritableDataset {
    fn commit_with_outcome(self) -> Result<(), TransactionCommitError<Self::Error>>;

    fn rollback_with_outcome(self) -> Result<(), TransactionRollbackError<Self::Error>>;
}

/// Extension for transactional datasets that accept caller-supplied transaction keys.
///
/// The keyed transaction type is distinct from the legacy transaction type so existing callers
/// are not required to manufacture recovery keys. Implementations must reserve the key only after
/// capability negotiation succeeds and must never replay effects to resolve an outcome.
pub trait OutcomeAwareTransactionalDataset: NegotiatedTransactionalDataset {
    /// A keyed write transaction borrowing this dataset.
    type KeyedTransaction<'a>: OutcomeAwareWritableDataset<Error = Self::Error>
    where
        Self: 'a;

    /// Negotiates and opens a transaction identified by `transaction_key`.
    fn start_transaction_with_key(
        &self,
        request: TransactionRequest,
        transaction_key: TransactionKey,
    ) -> Result<NegotiatedTransaction<Self::KeyedTransaction<'_>>, TransactionStartError<Self::Error>>
    {
        self.start_transaction_with_key_and_control(
            request,
            transaction_key,
            TransactionStartControl::new(),
        )
    }

    /// Negotiates and opens a keyed transaction with bounded, cancellable admission.
    fn start_transaction_with_key_and_control(
        &self,
        request: TransactionRequest,
        transaction_key: TransactionKey,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<Self::KeyedTransaction<'_>>, TransactionStartError<Self::Error>>;

    /// Resolves the last provable state of `transaction_key` without replaying its effects.
    fn lookup_transaction_outcome(
        &self,
        transaction_key: &TransactionKey,
    ) -> Result<TransactionOutcome, Self::Error>;
}

/// A transaction paired with the exact profile negotiated before it was opened.
pub struct NegotiatedTransaction<T> {
    transaction: T,
    effective: TransactionCapabilities,
}

impl<T> NegotiatedTransaction<T> {
    /// Creates a transaction paired with the capabilities negotiated for it.
    ///
    /// This constructor is intended for custom
    /// [`NegotiatedTransactionalDataset`] implementations. The supplied
    /// capabilities must be the effective profile used while admitting this
    /// exact transaction.
    pub const fn new(transaction: T, effective: TransactionCapabilities) -> Self {
        Self {
            transaction,
            effective,
        }
    }

    pub const fn effective_capabilities(&self) -> &TransactionCapabilities {
        &self.effective
    }

    pub fn into_transaction(self) -> T {
        self.transaction
    }
}

/// A transactional dataset supporting explicit capability negotiation.
pub trait NegotiatedTransactionalDataset: TransactionalDataset {
    fn transaction_capabilities(&self) -> TransactionCapabilities;

    fn start_transaction_with(
        &self,
        request: TransactionRequest,
    ) -> Result<NegotiatedTransaction<Self::Transaction<'_>>, TransactionStartError<Self::Error>>
    {
        let effective = self.transaction_capabilities();
        let unmet = effective.unmet_requirements(request.requirements());
        if !unmet.is_empty() {
            return Err(TransactionStartError::RequirementsNotMet { unmet, effective });
        }
        let transaction = TransactionalDataset::start_transaction(self)
            .map_err(TransactionStartError::Backend)?;
        Ok(NegotiatedTransaction {
            transaction,
            effective,
        })
    }

    /// Negotiates and opens a transaction with bounded, cancellable admission.
    ///
    /// Implementations with a blocking admission queue should override this method so that the
    /// control remains observable while queued. The default implementation checks the control
    /// before and after the backend start call and rolls back by drop if the latter check fails.
    fn start_transaction_with_control(
        &self,
        request: TransactionRequest,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<Self::Transaction<'_>>, TransactionStartError<Self::Error>>
    {
        let started_at = std::time::Instant::now();
        let effective = self.transaction_capabilities();
        let unmet = effective.unmet_requirements(request.requirements());
        if !unmet.is_empty() {
            return Err(TransactionStartError::RequirementsNotMet { unmet, effective });
        }
        control.check(started_at).map_err(|error| match error {
            crate::storage::TransactionStartControlError::Cancelled => {
                TransactionStartError::Cancelled
            }
            crate::storage::TransactionStartControlError::TimedOut => {
                TransactionStartError::TimedOut
            }
        })?;
        let transaction = TransactionalDataset::start_transaction(self)
            .map_err(TransactionStartError::Backend)?;
        control.check(started_at).map_err(|error| match error {
            crate::storage::TransactionStartControlError::Cancelled => {
                TransactionStartError::Cancelled
            }
            crate::storage::TransactionStartControlError::TimedOut => {
                TransactionStartError::TimedOut
            }
        })?;
        Ok(NegotiatedTransaction {
            transaction,
            effective,
        })
    }
}

/// An on-disk [RDF dataset](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-dataset).
/// Allows querying and updating it using SPARQL.
/// It is based on the [RocksDB](https://rocksdb.org/) key-value store.
///
/// This store ensures the "repeatable read" isolation level: the store only exposes changes that have
/// been "committed" (i.e., no partial writes), and the exposed state does not change for the complete duration
/// of a read operation (e.g., a SPARQL query) or a read/write operation (e.g., a SPARQL update).
///
/// Usage example:
/// ```
/// use oxigraph::model::*;
/// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
/// use oxigraph::store::Store;
///
/// let store = Store::new()?;
///
/// // insertion
/// let ex = NamedNode::new("http://example.com")?;
/// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), GraphName::DefaultGraph);
/// store.insert(quad.clone())?;
///
/// // quad filter
/// let results: Result<Vec<Quad>, _> = store.quads_for_pattern(None, None, None, None).collect();
/// assert_eq!(vec![quad], results?);
///
/// // SPARQL query
/// if let QueryResults::Solutions(mut solutions) = SparqlEvaluator::new()
///     .parse_query("SELECT ?s WHERE { ?s ?p ?o }")?
///     .on_store(&store)
///     .execute()?
/// {
///     assert_eq!(solutions.next().unwrap()?.get("s"), Some(&ex.into()));
/// };
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[derive(Clone)]
pub struct Store {
    storage: Storage,
    transaction_capabilities: TransactionCapabilities,
}

/// Options used when opening an on-disk [`Store`].
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[derive(Clone, Debug, Default)]
pub struct StoreOptions {
    max_open_files: Option<StoreMaxOpenFiles>,
    fd_reserve: Option<u32>,
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StoreMaxOpenFiles {
    Limited(u32),
    Unlimited,
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
impl StoreOptions {
    /// Sets the maximum number of files that RocksDB keeps open.
    ///
    /// If the value is greater than [`i32::MAX`], it is clamped to [`i32::MAX`].
    #[must_use]
    pub fn with_max_open_files(mut self, max_open_files: u32) -> Self {
        self.max_open_files = Some(StoreMaxOpenFiles::Limited(max_open_files));
        self
    }

    /// Configures RocksDB to keep files opened (equivalent to RocksDB `max_open_files = -1`).
    #[must_use]
    pub fn with_unlimited_max_open_files(mut self) -> Self {
        self.max_open_files = Some(StoreMaxOpenFiles::Unlimited);
        self
    }

    /// Sets the number of file descriptors reserved for non-RocksDB usage when deriving
    /// `max_open_files` from the process file descriptor limit.
    ///
    /// The default reserve is `48` to preserve the historical behavior.
    #[must_use]
    pub fn with_fd_reserve(mut self, fd_reserve: u32) -> Self {
        self.fd_reserve = Some(fd_reserve);
        self
    }
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
impl From<StoreOptions> for StorageOptions {
    fn from(value: StoreOptions) -> Self {
        Self::new(
            value
                .max_open_files
                .map(|max_open_files| match max_open_files {
                    StoreMaxOpenFiles::Limited(value) => value.try_into().unwrap_or(i32::MAX),
                    StoreMaxOpenFiles::Unlimited => -1,
                }),
            value.fd_reserve,
        )
    }
}

#[expect(
    clippy::same_name_method,
    clippy::multiple_inherent_impl,
    reason = "transaction traits mirror the Store API; the additive governance API has its own focused module"
)]
impl Store {
    /// Copies bounded policy-denial and SHACL commit-gate observations without storage I/O.
    pub fn policy_metrics(&self) -> PolicyMetrics {
        self.storage.policy_metrics_state().snapshot()
    }

    #[cfg(any(feature = "http-client", feature = "shacl"))]
    pub(crate) fn policy_metrics_state(&self) -> Arc<policy_metrics::PolicyMetricsState> {
        self.storage.policy_metrics_state()
    }

    /// Copies Store-bound query/update observations without acquiring a storage writer permit.
    pub fn evaluation_metrics(&self) -> EvaluationMetrics {
        self.storage.evaluation_metrics()
    }

    pub(crate) fn start_evaluation_observation(
        &self,
        operation: EvaluationOperation,
    ) -> evaluation_metrics::EvaluationObservation {
        self.storage.start_evaluation_observation(operation)
    }

    /// Copies the process-local transaction telemetry without reading storage or acquiring
    /// a writer permit. The bounded metrics lock is never held across storage work.
    pub fn transaction_metrics(&self) -> TransactionMetrics {
        self.storage.transaction_metrics()
    }

    /// New in-memory [`Store`] without RocksDB.
    pub fn new() -> Result<Self, StorageError> {
        let storage = Storage::new()?;
        Ok(Self {
            transaction_capabilities: read_write_transaction_capabilities(&storage),
            storage,
        })
    }

    /// Opens a read-write [`Store`] and creates it if it does not exist yet.
    ///
    /// Only one read-write [`Store`] can exist at the same time.
    /// If you want another [`Store`] handle in the same process, use [`Store::clone`].
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let storage = Storage::open(path.as_ref())?;
        Ok(Self {
            transaction_capabilities: read_write_transaction_capabilities(&storage),
            storage,
        })
    }

    /// Opens a read-write [`Store`] with explicit RocksDB options and creates it if it does not exist yet.
    ///
    /// Only one read-write [`Store`] can exist at the same time.
    /// If you want another [`Store`] handle in the same process, use [`Store::clone`].
    ///
    /// Lower `max_open_files` values reduce open file descriptor usage but might increase read I/O and cache misses.
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn open_with_options(
        path: impl AsRef<Path>,
        options: StoreOptions,
    ) -> Result<Self, StorageError> {
        let storage = Storage::open_with_options(path.as_ref(), options.into())?;
        Ok(Self {
            transaction_capabilities: read_write_transaction_capabilities(&storage),
            storage,
        })
    }

    /// Opens a read-only [`Store`] from disk.
    ///
    /// Multiple read-only [`Store`] instances may coexist.
    /// Opening a writer in the same or another process while an ordinary read-only instance is open
    /// causes undefined behavior for that read-only instance.
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn open_read_only(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        Ok(Self {
            storage: Storage::open_read_only(path.as_ref())?,
            transaction_capabilities: TransactionCapabilities::none(),
        })
    }

    /// Returns the effective transaction guarantees of this store instance.
    pub fn transaction_capabilities(&self) -> TransactionCapabilities {
        self.transaction_capabilities.clone()
    }

    /// Returns the store-global namespace mappings in exact prefix-byte order.
    pub fn namespaces(&self) -> NamespaceIter {
        NamespaceIter::from_result(self.storage.snapshot().namespaces())
    }

    /// Returns the namespace mapping associated with `prefix`.
    pub fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, StorageError> {
        self.storage.snapshot().namespace(prefix)
    }

    /// Creates or overwrites a store-global namespace mapping atomically.
    pub fn set_namespace(&self, namespace: Namespace) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_transaction()?;
        transaction.set_namespace(namespace)?;
        transaction.commit()
    }

    /// Removes a store-global namespace mapping atomically.
    pub fn remove_namespace(&self, prefix: &NamespacePrefix) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_transaction()?;
        transaction.remove_namespace(prefix)?;
        transaction.commit()
    }

    /// Removes every store-global namespace mapping atomically.
    pub fn clear_namespaces(&self) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_transaction()?;
        transaction.clear_namespaces()?;
        transaction.commit()
    }

    /// Retrieves quads with a filter on each quad component
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    ///
    /// // insertion
    /// let ex = NamedNode::new("http://example.com")?;
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), GraphName::DefaultGraph);
    /// store.insert(quad.clone())?;
    ///
    /// // quad filter by object
    /// let ex_term: Term = ex.clone().into();
    /// let results = store
    ///     .quads_for_pattern(None, None, Some(&ex_term), None)
    ///     .collect::<Result<Vec<_>, _>>()?;
    /// assert_eq!(vec![quad], results);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn quads_for_pattern(
        &self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<&GraphName>,
    ) -> QuadIter<'static> {
        let reader = self.storage.snapshot();
        QuadIter {
            iter: reader.quads_for_pattern(
                subject.map(EncodedTerm::from).as_ref(),
                predicate.map(EncodedTerm::from).as_ref(),
                object.map(EncodedTerm::from).as_ref(),
                graph_name.map(EncodedTerm::from).as_ref(),
            ),
            reader,
        }
    }

    /// Returns all the quads contained in the store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    ///
    /// // insertion
    /// let ex = NamedNode::new("http://example.com")?;
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), GraphName::DefaultGraph);
    /// store.insert(quad.clone())?;
    ///
    /// // quad filter by object
    /// let results = store.iter().collect::<Result<Vec<_>, _>>()?;
    /// assert_eq!(vec![quad], results);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn iter(&self) -> QuadIter<'static> {
        self.quads_for_pattern(None, None, None, None)
    }

    /// Copies quads and named-graph topology from one storage snapshot.
    ///
    /// This internal helper is used when an owned dataset must preserve a
    /// repeatable-read view, including empty named graphs, without opening a
    /// write-capable transaction. It therefore also works for stores opened
    /// with [`Store::open_read_only`].
    pub(crate) fn snapshot_contents(
        &self,
    ) -> Result<(Dataset, Vec<NamedOrBlankNode>), StorageError> {
        let reader = self.storage.snapshot();
        let mut dataset = reader
            .quads_for_pattern(None, None, None, None)
            .map(|quad| reader.decode_quad(&quad?))
            .collect::<Result<Dataset, _>>()?;
        let named_graphs = reader
            .named_graphs()
            .map(|graph_name| reader.decode_named_or_blank_node(&graph_name?))
            .collect::<Result<Vec<_>, _>>()?;
        for graph_name in &named_graphs {
            dataset.insert_named_graph(graph_name.clone());
        }
        Ok((dataset, named_graphs))
    }

    /// Checks if this store contains a given quad.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), ex);
    ///
    /// let store = Store::new()?;
    /// assert!(!store.contains(&quad)?);
    ///
    /// store.insert(quad.clone())?;
    /// assert!(store.contains(&quad)?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn contains(&self, quad: &Quad) -> Result<bool, StorageError> {
        let quad = EncodedQuad::from(quad);
        self.storage.snapshot().contains(&quad)
    }

    /// Returns the number of quads in the store.
    ///
    /// <div class="warning">This function executes a full scan.</div>
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let store = Store::new()?;
    /// store.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone()))?;
    /// store.insert(Quad::new(
    ///     ex.clone(),
    ///     ex.clone(),
    ///     ex,
    ///     GraphName::DefaultGraph,
    /// ))?;
    /// assert_eq!(2, store.len()?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn len(&self) -> Result<usize, StorageError> {
        self.storage.snapshot().len()
    }

    /// Returns if the store is empty.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    /// assert!(store.is_empty()?);
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// store.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex))?;
    /// assert!(!store.is_empty()?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn is_empty(&self) -> Result<bool, StorageError> {
        self.storage.snapshot().is_empty()
    }

    /// Start a transaction.
    ///
    /// Transactions ensure the "repeatable read" isolation level: the store only exposes changes that have
    /// been "committed" (i.e., no partial writes are done),
    /// and the exposed state does not change for the complete duration of a read operation
    /// (e.g., a SPARQL query) or a read/write operation (e.g., a SPARQL update).
    /// Transactional operations are also atomic.
    ///
    /// Note that the transaction keeps the complete set of changes into memory, do not use them to load
    /// tens of millions of triples.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    /// let a = NamedNode::new("http://example.com/a")?;
    /// let b = NamedNode::new("http://example.com/b")?;
    ///
    /// // Copy all triples about ex:a to triples about ex:b
    /// let mut transaction = store.start_transaction()?;
    /// let triples = transaction
    ///     .quads_for_pattern(Some(&a.clone().into()), None, None, None)
    ///     .collect::<Result<Vec<_>, _>>()?;
    /// for triple in triples {
    ///     transaction.insert(Quad::new(
    ///         b.clone(),
    ///         triple.predicate.clone(),
    ///         triple.object.clone(),
    ///         triple.graph_name.clone(),
    ///     ));
    /// }
    /// transaction.commit()?;
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn start_transaction(&self) -> Result<Transaction<'_>, StorageError> {
        Ok(Transaction {
            inner: self.storage.start_readable_transaction()?,
        })
    }

    /// Loads an RDF file under into the store.
    ///
    /// This function is atomic, quite slow and memory hungry. To get much better performances, you might want to use the [`bulk_loader`](Store::bulk_loader).
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::store::Store;
    /// use oxigraph::io::{RdfFormat, RdfParser};
    /// use oxigraph::model::*;
    ///
    /// let store = Store::new()?;
    ///
    /// // insert a dataset file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> <http://example.com/g> .";
    /// store.load_from_reader(RdfFormat::NQuads, file.as_bytes())?;
    ///
    /// // insert a graph file
    /// let file = "<> <> <> .";
    /// store.load_from_reader(
    ///     RdfParser::from_format(RdfFormat::Turtle)
    ///         .with_base_iri("http://example.com")?
    ///         .without_named_graphs() // No named graphs allowed in the input
    ///         .with_default_graph(NamedNode::new("http://example.com/g2")?), // we put the file default graph inside of a named graph
    ///     file.as_bytes()
    /// )?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g")?))?);
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g2")?))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn load_from_reader(
        &self,
        parser: impl Into<RdfParser>,
        reader: impl Read,
    ) -> Result<(), LoaderError> {
        let dataset = parser
            .into()
            .rename_blank_nodes()
            .for_reader(reader)
            .collect_dataset()?;
        let mut transaction = self.storage.start_transaction()?;
        for graph_name in dataset.named_graphs() {
            transaction.insert_named_graph(graph_name);
        }
        for quad in &dataset {
            transaction.insert(quad);
        }
        transaction.commit()?;
        Ok(())
    }

    /// Loads an RDF file under into the store.
    ///
    /// This function is atomic, quite slow and memory hungry. To get much better performances, you might want to use the [`bulk_loader`](Store::bulk_loader).
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::store::Store;
    /// use oxigraph::io::{RdfParser, RdfFormat};
    /// use oxigraph::model::*;
    ///
    /// let store = Store::new()?;
    ///
    /// // insert a dataset file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> <http://example.com/g> .";
    /// store.load_from_slice(RdfFormat::NQuads, file)?;
    ///
    /// // insert a graph file
    /// let file = "<> <> <> .";
    /// store.load_from_slice(
    ///     RdfParser::from_format(RdfFormat::Turtle)
    ///         .with_base_iri("http://example.com")?
    ///         .without_named_graphs() // No named graphs allowed in the input
    ///         .with_default_graph(NamedNode::new("http://example.com/g2")?), // we put the file default graph inside of a named graph
    ///     file
    /// )?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g")?))?);
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g2")?))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn load_from_slice(
        &self,
        parser: impl Into<RdfParser>,
        slice: &(impl AsRef<[u8]> + ?Sized),
    ) -> Result<(), LoaderError> {
        let dataset = parser
            .into()
            .rename_blank_nodes()
            .for_slice(slice.as_ref())
            .collect_dataset()
            .map_err(RdfParseError::Syntax)?;
        let mut transaction = self.storage.start_transaction()?;
        for graph_name in dataset.named_graphs() {
            transaction.insert_named_graph(graph_name);
        }
        for quad in &dataset {
            transaction.insert(quad);
        }
        transaction.commit()?;
        Ok(())
    }

    /// Adds a quad to this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex, GraphName::DefaultGraph);
    ///
    /// let store = Store::new()?;
    /// store.insert(quad.clone())?;
    ///
    /// assert!(store.contains(&quad)?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn insert(&self, quad: Quad) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_transaction()?;
        transaction.insert(quad);
        transaction.commit()?;
        Ok(())
    }

    /// Atomically adds a set of quads to this store.
    ///
    /// <div class="warning">
    ///
    /// This operation uses a memory heavy transaction internally, use the [`bulk_loader`](Store::bulk_loader) if you plan to add ten of millions of triples.</div>
    pub fn extend(&self, quads: impl IntoIterator<Item = Quad>) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_transaction()?;
        for quad in quads {
            transaction.insert(quad);
        }
        transaction.commit()?;
        Ok(())
    }

    /// Removes a quad from this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex, GraphName::DefaultGraph);
    ///
    /// let store = Store::new()?;
    /// store.insert(quad.clone())?;
    /// store.remove(&quad)?;
    ///
    /// assert!(!store.contains(&quad)?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn remove(&self, quad: &Quad) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_transaction()?;
        transaction.remove(quad);
        transaction.commit()?;
        Ok(())
    }

    /// Dumps the store into a file.
    ///
    /// ```
    /// use oxigraph::io::RdfFormat;
    /// use oxigraph::store::Store;
    ///
    /// let file =
    ///     "<http://example.com> <http://example.com> <http://example.com> <http://example.com> .\n";
    ///
    /// let store = Store::new()?;
    /// store.load_from_slice(RdfFormat::NQuads, file)?;
    ///
    /// let buffer = store.dump_to_writer(RdfFormat::NQuads, Vec::new())?;
    /// assert_eq!(file.as_bytes(), buffer.as_slice());
    /// # std::io::Result::Ok(())
    /// ```
    pub fn dump_to_writer<W: Write>(
        &self,
        serializer: impl Into<RdfSerializer>,
        writer: W,
    ) -> Result<W, SerializerError> {
        let serializer = serializer.into();
        if !serializer.format().supports_datasets() {
            return Err(SerializerError::DatasetFormatExpected(serializer.format()));
        }
        let reader = self.storage.snapshot();
        let mut empty_graphs = Vec::new();
        for graph_name in reader.named_graphs() {
            let graph_name = graph_name?;
            if reader
                .quads_for_pattern(None, None, None, Some(&graph_name))
                .next()
                .transpose()?
                .is_none()
            {
                empty_graphs.push(reader.decode_named_or_blank_node(&graph_name)?);
            }
        }
        if !empty_graphs.is_empty() && !serializer.format().supports_empty_named_graphs() {
            return Err(SerializerError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "the selected RDF format cannot represent empty named graphs",
            )));
        }
        let mut serializer = serializer.for_writer(writer);
        for quad in reader.quads_for_pattern(None, None, None, None) {
            serializer.serialize_quad(&reader.decode_quad(&quad?)?)?;
        }
        for graph_name in empty_graphs {
            serializer.serialize_empty_graph(&graph_name)?;
        }
        Ok(serializer.finish()?)
    }

    /// Dumps a store graph into a file.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::io::RdfFormat;
    /// use oxigraph::model::GraphName;
    /// use oxigraph::store::Store;
    ///
    /// let file = "<http://example.com> <http://example.com> <http://example.com> .\n";
    ///
    /// let store = Store::new()?;
    /// store.load_from_slice(RdfFormat::NTriples, file)?;
    ///
    /// let mut buffer = Vec::new();
    /// store.dump_graph_to_writer(&GraphName::DefaultGraph, RdfFormat::NTriples, &mut buffer)?;
    /// assert_eq!(file.as_bytes(), buffer.as_slice());
    /// # std::io::Result::Ok(())
    /// ```
    pub fn dump_graph_to_writer<W: Write>(
        &self,
        from_graph_name: &GraphName,
        serializer: impl Into<RdfSerializer>,
        writer: W,
    ) -> Result<W, SerializerError> {
        let mut serializer = serializer.into().for_writer(writer);
        for quad in self.quads_for_pattern(None, None, None, Some(from_graph_name)) {
            serializer.serialize_triple(quad?.as_triple())?;
        }
        Ok(serializer.finish()?)
    }

    /// Returns all the store named graphs.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let store = Store::new()?;
    /// store.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone()))?;
    /// store.insert(Quad::new(
    ///     ex.clone(),
    ///     ex.clone(),
    ///     ex.clone(),
    ///     GraphName::DefaultGraph,
    /// ))?;
    /// assert_eq!(
    ///     vec![NamedOrBlankNode::from(ex)],
    ///     store.named_graphs().collect::<Result<Vec<_>, _>>()?
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn named_graphs(&self) -> GraphNameIter<'static> {
        let reader = self.storage.snapshot();
        GraphNameIter {
            iter: reader.named_graphs(),
            reader,
        }
    }

    /// Checks if the store contains a given graph
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::{NamedNode, Quad};
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let store = Store::new()?;
    /// store.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone()))?;
    /// assert!(store.contains_named_graph(&ex.into())?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn contains_named_graph(
        &self,
        graph_name: &NamedOrBlankNode,
    ) -> Result<bool, StorageError> {
        let graph_name = EncodedTerm::from(graph_name);
        self.storage.snapshot().contains_named_graph(&graph_name)
    }

    /// Inserts a graph into this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::NamedNode;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let store = Store::new()?;
    /// store.insert_named_graph(ex.clone())?;
    ///
    /// assert_eq!(
    ///     store.named_graphs().collect::<Result<Vec<_>, _>>()?,
    ///     vec![ex]
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn insert_named_graph(
        &self,
        graph_name: impl Into<NamedOrBlankNode>,
    ) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_transaction()?;
        transaction.insert_named_graph(graph_name.into());
        transaction.commit()?;
        Ok(())
    }

    /// Clears a graph from this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::{NamedNode, Quad};
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone());
    /// let store = Store::new()?;
    /// store.insert(quad)?;
    /// assert_eq!(1, store.len()?);
    ///
    /// store.clear_graph(&ex.clone().into())?;
    /// assert!(store.is_empty()?);
    /// assert_eq!(1, store.named_graphs().count());
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn clear_graph(&self, graph_name: &GraphName) -> Result<(), StorageError> {
        if graph_name.is_default_graph() {
            let mut transaction = self.storage.start_transaction()?;
            transaction.clear_default_graph();
            transaction.commit()
        } else {
            let mut transaction = self.storage.start_readable_transaction()?;
            transaction.clear_graph(graph_name)?;
            transaction.commit()
        }
    }

    /// Removes a graph from this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::{NamedNode, Quad};
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone());
    /// let store = Store::new()?;
    /// store.insert(quad)?;
    /// assert_eq!(1, store.len()?);
    ///
    /// store.remove_named_graph(&ex.clone().into())?;
    /// assert!(store.is_empty()?);
    /// assert_eq!(0, store.named_graphs().count());
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn remove_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_readable_transaction()?;
        transaction.remove_named_graph(graph_name)?;
        transaction.commit()?;
        Ok(())
    }

    /// Clears the store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new("http://example.com")?;
    /// let store = Store::new()?;
    /// store.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone()))?;
    /// store.insert(Quad::new(
    ///     ex.clone(),
    ///     ex.clone(),
    ///     ex,
    ///     GraphName::DefaultGraph,
    /// ))?;
    /// assert_eq!(2, store.len()?);
    ///
    /// store.clear()?;
    /// assert!(store.is_empty()?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn clear(&self) -> Result<(), StorageError> {
        let mut transaction = self.storage.start_transaction()?;
        transaction.clear();
        transaction.commit()
    }

    /// Flushes all buffers and ensures that all writes are saved on disk.
    ///
    /// Flushes are automatically done using background threads but might lag a little bit.
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn flush(&self) -> Result<(), StorageError> {
        self.storage.flush()
    }

    /// Optimizes the database for future workload.
    ///
    /// Useful to call after a batch upload or another similar operation.
    ///
    /// <div class="warning">Can take hours on huge databases.</div>
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn optimize(&self) -> Result<(), StorageError> {
        self.storage.compact()
    }

    /// Creates database backup into the `target_directory`.
    ///
    /// After its creation, the backup is usable using [`Store::open`]
    /// like a regular Oxigraph database and operates independently from the original database.
    ///
    /// <div class="warning">
    ///
    /// Backups are only possible for on-disk databases created using [`Store::open`].</div>
    /// Temporary in-memory databases created using [`Store::new`] are not compatible with RocksDB backup system.
    ///
    /// <div class="warning">An error is raised if the `target_directory` already exists.</div>
    ///
    /// If the target directory is in the same file system as the current database,
    /// the database content will not be fully copied
    /// but hard links will be used to point to the original database immutable snapshots.
    /// This allows cheap regular backups.
    ///
    /// If you want to move your data to another RDF storage system, you should have a look at the [`Store::dump_to_writer`] function instead.
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn backup(&self, target_directory: impl AsRef<Path>) -> Result<(), StorageError> {
        self.storage.backup(target_directory.as_ref())
    }

    /// Creates a bulk loader allowing to load at a lot of data quickly into the store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::io::RdfFormat;
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    ///
    /// // quads file insertion
    /// let file =
    ///     "<http://example.com> <http://example.com> <http://example.com> <http://example.com> .";
    /// let mut loader = store.bulk_loader();
    /// loader.load_from_slice(RdfFormat::NQuads, file)?;
    /// loader.commit()?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), ex))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn bulk_loader(&self) -> BulkLoader<'_> {
        BulkLoader {
            storage: self.storage.bulk_loader(),
            num_threads: None,
            max_memory_size: None,
            on_parse_error: None,
        }
    }

    /// Validate that all the store invariants held in the data
    #[doc(hidden)]
    pub fn validate(&self) -> Result<(), StorageError> {
        self.storage.snapshot().validate()
    }

    pub(super) fn storage(&self) -> &Storage {
        &self.storage
    }
}

fn read_write_transaction_capabilities(storage: &Storage) -> TransactionCapabilities {
    let capabilities = TransactionCapabilities::none()
        .with_atomic_publication()
        .with_read_your_writes()
        .with_writer_isolation(WriterIsolation::Serialized)
        .with_conflict_behavior(ConflictBehavior::PreventedByWriterSerialization)
        .with_rollback(RollbackGuarantee::ExplicitOrDropBeforeCommit);
    if storage.supports_durable_transaction_outcomes() {
        capabilities.with_outcome_lookup(OutcomeLookup::DurableByTransactionKey)
    } else {
        capabilities
    }
}

impl fmt::Display for Store {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for t in self {
            writeln!(f, "{} .", t.map_err(|_| fmt::Error)?)?;
        }
        Ok(())
    }
}

impl IntoIterator for &Store {
    type IntoIter = QuadIter<'static>;
    type Item = Result<Quad, StorageError>;

    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

/// An object to do operations during a transaction.
///
/// See [`Store::start_transaction`] for a more detailed description.
#[must_use]
pub struct Transaction<'a> {
    inner: StorageReadableTransaction<'a>,
}

#[expect(
    clippy::same_name_method,
    reason = "the transactional persistence trait deliberately mirrors the established Transaction API"
)]
impl<'a> Transaction<'a> {
    /// Retrieves quads with a filter on each quad component.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    /// let a = NamedNode::new("http://example.com/a")?;
    /// let b = NamedNode::new("http://example.com/b")?;
    ///
    /// // Copy all triples about ex:a to triples about ex:b
    /// let mut transaction = store.start_transaction()?;
    /// let triples = transaction
    ///     .quads_for_pattern(Some(&a.clone().into()), None, None, None)
    ///     .collect::<Result<Vec<_>, _>>()?;
    /// for triple in triples {
    ///     transaction.insert(Quad::new(
    ///         b.clone(),
    ///         triple.predicate.clone(),
    ///         triple.object.clone(),
    ///         triple.graph_name.clone(),
    ///     ));
    /// }
    /// transaction.commit()?;
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn quads_for_pattern(
        &self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<&GraphName>,
    ) -> QuadIter<'_> {
        let reader = self.inner.reader();
        QuadIter {
            iter: reader.quads_for_pattern(
                subject.map(EncodedTerm::from).as_ref(),
                predicate.map(EncodedTerm::from).as_ref(),
                object.map(EncodedTerm::from).as_ref(),
                graph_name.map(EncodedTerm::from).as_ref(),
            ),
            reader,
        }
    }

    /// Returns all the quads contained in the store.
    pub fn iter(&self) -> QuadIter<'_> {
        self.quads_for_pattern(None, None, None, None)
    }

    /// Checks if this store contains a given quad.
    pub fn contains(&self, quad: &Quad) -> Result<bool, StorageError> {
        let quad = EncodedQuad::from(quad);
        self.inner.reader().contains(&quad)
    }

    /// Returns the number of quads in the store.
    ///
    /// <div class="warning">this function executes a full scan.</div>
    pub fn len(&self) -> Result<usize, StorageError> {
        self.inner.reader().len()
    }

    /// Returns if the store is empty.
    pub fn is_empty(&self) -> Result<bool, StorageError> {
        self.inner.reader().is_empty()
    }

    /// Returns namespace mappings visible to this transaction.
    pub fn namespaces(&self) -> NamespaceIter {
        NamespaceIter::from_result(self.inner.reader().namespaces())
    }

    /// Returns the namespace mapping visible for `prefix`.
    pub fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, StorageError> {
        self.inner.reader().namespace(prefix)
    }

    /// Creates or overwrites a namespace mapping in this transaction.
    pub fn set_namespace(&mut self, namespace: Namespace) -> Result<(), StorageError> {
        self.inner.set_namespace(namespace)
    }

    /// Removes a namespace mapping in this transaction.
    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), StorageError> {
        self.inner.remove_namespace(prefix)
    }

    /// Removes all namespace mappings in this transaction.
    pub fn clear_namespaces(&mut self) -> Result<(), StorageError> {
        self.inner.clear_namespaces()
    }

    /// Loads an RDF file into the store.
    ///
    /// This function is atomic, quite slow and memory hungry. To get much better performances, you might want to use the [`bulk_loader`](Store::bulk_loader).
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::store::Store;
    /// use oxigraph::io::{RdfParser, RdfFormat};
    /// use oxigraph::model::*;
    ///
    /// let store = Store::new()?;
    ///
    /// // insert a dataset file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> <http://example.com/g> .";
    /// let mut transaction = store.start_transaction()?;
    /// transaction.load_from_reader(RdfFormat::NQuads, file.as_bytes())?;
    /// transaction.commit()?;
    ///
    /// // insert a graph file
    /// let file = "<> <> <> .";
    /// let mut transaction = store.start_transaction()?;
    /// transaction.load_from_reader(
    ///     RdfParser::from_format(RdfFormat::Turtle)
    ///         .with_base_iri("http://example.com")
    ///         .unwrap()
    ///         .without_named_graphs() // No named graphs allowed in the input
    ///         .with_default_graph(NamedNode::new("http://example.com/g2").unwrap()), // we put the file default graph inside of a named graph
    ///     file.as_bytes()
    /// )?;
    /// transaction.commit()?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g")?))?);
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g2")?))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn load_from_reader(
        &mut self,
        parser: impl Into<RdfParser>,
        reader: impl Read,
    ) -> Result<(), LoaderError> {
        let dataset = parser
            .into()
            .rename_blank_nodes()
            .for_reader(reader)
            .collect_dataset()?;
        for graph_name in dataset.named_graphs() {
            self.insert_named_graph(graph_name);
        }
        for quad in &dataset {
            self.insert(quad);
        }
        Ok(())
    }

    /// Loads an RDF file into the store.
    ///
    /// This function is atomic, quite slow and memory hungry. To get much better performances, you might want to use the [`bulk_loader`](Store::bulk_loader).
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::store::Store;
    /// use oxigraph::io::{RdfParser, RdfFormat};
    /// use oxigraph::model::*;
    ///
    /// let store = Store::new()?;
    ///
    /// // insert a dataset file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> <http://example.com/g> .";
    /// let mut transaction = store.start_transaction()?;
    /// transaction.load_from_reader(RdfFormat::NQuads, file.as_bytes())?;
    /// transaction.commit()?;
    ///
    /// // insert a graph file
    /// let file = "<> <> <> .";
    /// let mut transaction = store.start_transaction()?;
    /// transaction.load_from_slice(
    ///     RdfParser::from_format(RdfFormat::Turtle)
    ///         .with_base_iri("http://example.com")
    ///         .unwrap()
    ///         .without_named_graphs() // No named graphs allowed in the input
    ///         .with_default_graph(NamedNode::new("http://example.com/g2").unwrap()), // we put the file default graph inside of a named graph
    ///     file
    /// )?;
    /// transaction.commit()?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g")?))?);
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g2")?))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn load_from_slice(
        &mut self,
        parser: impl Into<RdfParser>,
        slice: &(impl AsRef<[u8]> + ?Sized),
    ) -> Result<(), LoaderError> {
        let dataset = parser
            .into()
            .rename_blank_nodes()
            .for_slice(slice)
            .collect_dataset()
            .map_err(RdfParseError::Syntax)?;
        for graph_name in dataset.named_graphs() {
            self.insert_named_graph(graph_name);
        }
        for quad in &dataset {
            self.insert(quad);
        }
        Ok(())
    }

    /// Adds a quad to this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new_unchecked("http://example.com");
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex, GraphName::DefaultGraph);
    ///
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// transaction.insert(quad.clone());
    /// transaction.commit()?;
    /// assert!(store.contains(&quad)?);
    /// # Result::<_,oxigraph::store::StorageError>::Ok(())
    /// ```
    pub fn insert(&mut self, quad: Quad) {
        self.inner.insert(quad)
    }

    /// Adds a set of quads to this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new_unchecked("http://example.com");
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex, GraphName::DefaultGraph);
    ///
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// transaction.extend([quad.clone()]);
    /// transaction.commit()?;
    /// assert!(store.contains(&quad)?);
    /// # Result::<_,oxigraph::store::StorageError>::Ok(())
    /// ```
    pub fn extend(&mut self, quads: impl IntoIterator<Item = Quad>) {
        for quad in quads {
            self.inner.insert(quad);
        }
    }

    /// Removes a quad from this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new_unchecked("http://example.com");
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex, GraphName::DefaultGraph);
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// transaction.insert(quad.clone());
    /// transaction.remove(&quad);
    /// transaction.commit()?;
    /// assert!(!store.contains(&quad)?);
    /// # Result::<_,oxigraph::store::StorageError>::Ok(())
    /// ```
    pub fn remove(&mut self, quad: &Quad) {
        self.inner.remove(quad)
    }

    /// Returns all the named graphs in the store.
    pub fn named_graphs(&self) -> GraphNameIter<'_> {
        let reader = self.inner.reader();
        GraphNameIter {
            iter: reader.named_graphs(),
            reader,
        }
    }

    /// Checks if the store contains a given graph.
    pub fn contains_named_graph(
        &self,
        graph_name: &NamedOrBlankNode,
    ) -> Result<bool, StorageError> {
        self.inner
            .reader()
            .contains_named_graph(&EncodedTerm::from(graph_name))
    }

    /// Inserts a graph into this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::NamedNode;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new_unchecked("http://example.com");
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// transaction.insert_named_graph(ex.clone());
    /// transaction.commit()?;
    /// assert_eq!(
    ///     store.named_graphs().collect::<Result<Vec<_>, _>>()?,
    ///     vec![ex]
    /// );
    /// # Result::<_,oxigraph::store::StorageError>::Ok(())
    /// ```
    pub fn insert_named_graph(&mut self, graph_name: impl Into<NamedOrBlankNode>) {
        self.inner.insert_named_graph(graph_name.into())
    }

    /// Clears a graph from this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::{NamedNode, Quad};
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new_unchecked("http://example.com");
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone());
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// transaction.insert(quad);
    /// transaction.clear_graph(&ex.clone().into())?;
    /// transaction.commit()?;
    /// assert!(store.is_empty()?);
    /// assert_eq!(1, store.named_graphs().count());
    /// # Result::<_,oxigraph::store::StorageError>::Ok(())
    /// ```
    pub fn clear_graph(&mut self, graph_name: &GraphName) -> Result<(), StorageError> {
        self.inner.clear_graph(graph_name)
    }

    /// Removes a graph from this store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::{NamedNode, Quad};
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new_unchecked("http://example.com");
    /// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone());
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// transaction.insert(quad);
    /// transaction.remove_named_graph(&ex.clone().into())?;
    /// transaction.commit()?;
    /// assert!(store.is_empty()?);
    /// assert_eq!(0, store.named_graphs().count());
    /// # Result::<_,oxigraph::store::StorageError>::Ok(())
    /// ```
    pub fn remove_named_graph(
        &mut self,
        graph_name: &NamedOrBlankNode,
    ) -> Result<(), StorageError> {
        self.inner.remove_named_graph(graph_name)
    }

    /// Clears the store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new_unchecked("http://example.com");
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// transaction.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex));
    /// transaction.clear()?;
    /// transaction.commit()?;
    /// assert!(store.is_empty()?);
    /// # Result::<_,oxigraph::store::StorageError>::Ok(())
    /// ```
    pub fn clear(&mut self) -> Result<(), StorageError> {
        self.inner.clear()
    }

    /// Commits the transaction, i.e., apply its modifications to the underlying store.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::store::Store;
    ///
    /// let ex = NamedNode::new_unchecked("http://example.com");
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// transaction.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone()));
    /// transaction.commit()?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), ex))?);
    /// # Result::<_,oxigraph::store::StorageError>::Ok(())
    /// ```
    pub fn commit(self) -> Result<(), StorageError> {
        self.inner.commit()
    }

    pub(super) fn inner(&self) -> &StorageReadableTransaction<'a> {
        &self.inner
    }
}

/// A caller-keyed transaction whose terminal outcome can be resolved without replay.
///
/// This type is returned only by [`OutcomeAwareTransactionalDataset`]. The legacy
/// [`Transaction`] API remains unkeyed and source-compatible.
#[must_use]
pub struct KeyedTransaction<'a> {
    inner: StorageKeyedReadableTransaction<'a>,
    transaction_key: TransactionKey,
}

#[expect(
    clippy::same_name_method,
    reason = "the keyed persistence trait deliberately mirrors the established Transaction API"
)]
impl KeyedTransaction<'_> {
    /// Returns the caller-supplied key identifying this transaction attempt.
    pub const fn transaction_key(&self) -> &TransactionKey {
        &self.transaction_key
    }

    /// Retrieves quads with a filter on each quad component.
    pub fn quads_for_pattern(
        &self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<&GraphName>,
    ) -> QuadIter<'_> {
        let reader = self.inner.reader();
        QuadIter {
            iter: reader.quads_for_pattern(
                subject.map(EncodedTerm::from).as_ref(),
                predicate.map(EncodedTerm::from).as_ref(),
                object.map(EncodedTerm::from).as_ref(),
                graph_name.map(EncodedTerm::from).as_ref(),
            ),
            reader,
        }
    }

    /// Returns all quads visible to this transaction.
    pub fn iter(&self) -> QuadIter<'_> {
        self.quads_for_pattern(None, None, None, None)
    }

    /// Returns whether this transaction contains `quad`.
    pub fn contains(&self, quad: &Quad) -> Result<bool, StorageError> {
        self.inner.reader().contains(&EncodedQuad::from(quad))
    }

    /// Returns the number of quads visible to this transaction.
    pub fn len(&self) -> Result<usize, StorageError> {
        self.inner.reader().len()
    }

    /// Returns whether this transaction contains no quads.
    pub fn is_empty(&self) -> Result<bool, StorageError> {
        self.inner.reader().is_empty()
    }

    /// Returns namespace mappings visible to this transaction.
    pub fn namespaces(&self) -> NamespaceIter {
        NamespaceIter::from_result(self.inner.reader().namespaces())
    }

    /// Returns the namespace mapping visible for `prefix`.
    pub fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, StorageError> {
        self.inner.reader().namespace(prefix)
    }

    /// Creates or overwrites a namespace mapping in this transaction.
    pub fn set_namespace(&mut self, namespace: Namespace) -> Result<(), StorageError> {
        self.inner.set_namespace(namespace)
    }

    /// Removes a namespace mapping in this transaction.
    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), StorageError> {
        self.inner.remove_namespace(prefix)
    }

    /// Removes all namespace mappings in this transaction.
    pub fn clear_namespaces(&mut self) -> Result<(), StorageError> {
        self.inner.clear_namespaces()
    }

    /// Loads an RDF document into this transaction.
    pub fn load_from_reader(
        &mut self,
        parser: impl Into<RdfParser>,
        reader: impl Read,
    ) -> Result<(), LoaderError> {
        let dataset = parser
            .into()
            .rename_blank_nodes()
            .for_reader(reader)
            .collect_dataset()?;
        for graph_name in dataset.named_graphs() {
            self.insert_named_graph(graph_name);
        }
        for quad in &dataset {
            self.insert(quad);
        }
        Ok(())
    }

    /// Loads an RDF document into this transaction.
    pub fn load_from_slice(
        &mut self,
        parser: impl Into<RdfParser>,
        slice: &(impl AsRef<[u8]> + ?Sized),
    ) -> Result<(), LoaderError> {
        let dataset = parser
            .into()
            .rename_blank_nodes()
            .for_slice(slice)
            .collect_dataset()
            .map_err(RdfParseError::Syntax)?;
        for graph_name in dataset.named_graphs() {
            self.insert_named_graph(graph_name);
        }
        for quad in &dataset {
            self.insert(quad);
        }
        Ok(())
    }

    /// Adds a quad to this transaction.
    pub fn insert(&mut self, quad: Quad) {
        self.inner.insert(quad);
    }

    /// Adds a set of quads to this transaction.
    pub fn extend(&mut self, quads: impl IntoIterator<Item = Quad>) {
        for quad in quads {
            self.inner.insert(quad);
        }
    }

    /// Removes a quad from this transaction.
    pub fn remove(&mut self, quad: &Quad) {
        self.inner.remove(quad);
    }

    /// Returns all named graphs visible to this transaction.
    pub fn named_graphs(&self) -> GraphNameIter<'_> {
        let reader = self.inner.reader();
        GraphNameIter {
            iter: reader.named_graphs(),
            reader,
        }
    }

    /// Returns whether this transaction contains `graph_name`.
    pub fn contains_named_graph(
        &self,
        graph_name: &NamedOrBlankNode,
    ) -> Result<bool, StorageError> {
        self.inner
            .reader()
            .contains_named_graph(&EncodedTerm::from(graph_name))
    }

    /// Creates a named graph if it does not already exist.
    pub fn insert_named_graph(&mut self, graph_name: impl Into<NamedOrBlankNode>) {
        self.inner.insert_named_graph(graph_name.into());
    }

    /// Clears a graph while retaining named-graph presence.
    pub fn clear_graph(&mut self, graph_name: &GraphName) -> Result<(), StorageError> {
        self.inner.clear_graph(graph_name)
    }

    /// Removes a named graph and its quads.
    pub fn remove_named_graph(
        &mut self,
        graph_name: &NamedOrBlankNode,
    ) -> Result<(), StorageError> {
        self.inner.remove_named_graph(graph_name)
    }

    /// Removes all quads and named-graph topology.
    pub fn clear(&mut self) -> Result<(), StorageError> {
        self.inner.clear()
    }

    /// Atomically publishes the RDF changes and committed outcome marker.
    pub fn commit(self) -> Result<(), TransactionCommitError<StorageError>> {
        OutcomeAwareWritableDataset::commit_with_outcome(self)
    }

    /// Discards the changes and records a proven rolled-back outcome.
    pub fn rollback(self) -> Result<(), TransactionRollbackError<StorageError>> {
        OutcomeAwareWritableDataset::rollback_with_outcome(self)
    }
}

impl TransactionalDataset for Store {
    type Error = StorageError;
    type Transaction<'a> = Transaction<'a>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        Store::start_transaction(self)
    }
}

impl NegotiatedTransactionalDataset for Store {
    fn transaction_capabilities(&self) -> TransactionCapabilities {
        Store::transaction_capabilities(self)
    }

    fn start_transaction_with_control(
        &self,
        request: TransactionRequest,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<Self::Transaction<'_>>, TransactionStartError<Self::Error>>
    {
        let started_at = std::time::Instant::now();
        let effective = self.transaction_capabilities();
        let unmet = effective.unmet_requirements(request.requirements());
        if !unmet.is_empty() {
            return Err(TransactionStartError::RequirementsNotMet { unmet, effective });
        }
        let inner = self
            .storage
            .start_readable_transaction_with_control(&control, started_at)
            .map_err(|error| match error {
                StorageTransactionStartError::Cancelled => TransactionStartError::Cancelled,
                StorageTransactionStartError::TimedOut => TransactionStartError::TimedOut,
                StorageTransactionStartError::Backend(error) => {
                    TransactionStartError::Backend(error)
                }
            })?;
        Ok(NegotiatedTransaction {
            transaction: Transaction { inner },
            effective,
        })
    }
}

impl OutcomeAwareTransactionalDataset for Store {
    type KeyedTransaction<'a> = KeyedTransaction<'a>;

    fn start_transaction_with_key_and_control(
        &self,
        request: TransactionRequest,
        transaction_key: TransactionKey,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<Self::KeyedTransaction<'_>>, TransactionStartError<Self::Error>>
    {
        let started_at = std::time::Instant::now();
        let effective = self.transaction_capabilities();
        let unmet = effective.unmet_requirements(request.requirements());
        if !unmet.is_empty() {
            return Err(TransactionStartError::RequirementsNotMet { unmet, effective });
        }
        let inner = self
            .storage
            .start_keyed_readable_transaction_with_control(
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
        Ok(NegotiatedTransaction {
            transaction: KeyedTransaction {
                inner,
                transaction_key,
            },
            effective,
        })
    }

    fn lookup_transaction_outcome(
        &self,
        transaction_key: &TransactionKey,
    ) -> Result<TransactionOutcome, Self::Error> {
        Ok(
            match self
                .storage
                .lookup_transaction_outcome(transaction_key.as_bytes())?
            {
                StorageTransactionOutcome::Committed => TransactionOutcome::Committed,
                StorageTransactionOutcome::Rejected => {
                    TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::Rejected)
                }
                StorageTransactionOutcome::Conflicted => {
                    TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::Conflicted)
                }
                StorageTransactionOutcome::Cancelled => {
                    TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::Cancelled)
                }
                StorageTransactionOutcome::RolledBack => {
                    TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
                }
                StorageTransactionOutcome::Indeterminate => TransactionOutcome::Indeterminate,
            },
        )
    }
}

impl WritableDataset for Transaction<'_> {
    type Error = StorageError;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, StorageError>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = GraphNameIter<'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        match graph_name {
            Some(None) => Box::new(Transaction::quads_for_pattern(
                self,
                subject,
                predicate,
                object,
                Some(&GraphName::DefaultGraph),
            )),
            Some(Some(graph_name)) => {
                let graph_name = GraphName::from(graph_name.clone());
                Box::new(Transaction::quads_for_pattern(
                    self,
                    subject,
                    predicate,
                    object,
                    Some(&graph_name),
                ))
            }
            None => Box::new(
                Transaction::quads_for_pattern(self, subject, predicate, object, None).filter(
                    |quad| match quad {
                        Ok(quad) => !quad.graph_name.is_default_graph(),
                        Err(_) => true,
                    },
                ),
            ),
        }
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        Transaction::named_graphs(self)
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        Transaction::contains_named_graph(self, graph_name)
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        Transaction::insert(self, quad);
        Ok(())
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        Transaction::remove(self, quad);
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        Transaction::insert_named_graph(self, graph_name);
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        let graph_name = graph_name.map_or(GraphName::DefaultGraph, |graph_name| {
            GraphName::from(graph_name.clone())
        });
        Transaction::clear_graph(self, &graph_name)
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_all_named_graphs()
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_all_graphs()
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        Transaction::remove_named_graph(self, graph_name)
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.remove_all_named_graphs()
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        Transaction::clear(self)
    }

    fn commit(self) -> Result<(), Self::Error> {
        Transaction::commit(self)
    }

    fn rollback(self) -> Result<(), Self::Error> {
        self.inner.rollback();
        Ok(())
    }
}

impl WritableDataset for KeyedTransaction<'_> {
    type Error = StorageError;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, StorageError>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = GraphNameIter<'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        match graph_name {
            Some(None) => Box::new(KeyedTransaction::quads_for_pattern(
                self,
                subject,
                predicate,
                object,
                Some(&GraphName::DefaultGraph),
            )),
            Some(Some(graph_name)) => {
                let graph_name = GraphName::from(graph_name.clone());
                Box::new(KeyedTransaction::quads_for_pattern(
                    self,
                    subject,
                    predicate,
                    object,
                    Some(&graph_name),
                ))
            }
            None => Box::new(
                KeyedTransaction::quads_for_pattern(self, subject, predicate, object, None).filter(
                    |quad| match quad {
                        Ok(quad) => !quad.graph_name.is_default_graph(),
                        Err(_) => true,
                    },
                ),
            ),
        }
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        KeyedTransaction::named_graphs(self)
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        KeyedTransaction::contains_named_graph(self, graph_name)
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        KeyedTransaction::insert(self, quad);
        Ok(())
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        KeyedTransaction::remove(self, quad);
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        KeyedTransaction::insert_named_graph(self, graph_name);
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        let graph_name = graph_name.map_or(GraphName::DefaultGraph, |graph_name| {
            GraphName::from(graph_name.clone())
        });
        KeyedTransaction::clear_graph(self, &graph_name)
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_all_named_graphs()
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_all_graphs()
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        KeyedTransaction::remove_named_graph(self, graph_name)
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.remove_all_named_graphs()
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        KeyedTransaction::clear(self)
    }

    fn commit(self) -> Result<(), Self::Error> {
        self.inner.commit()
    }

    fn rollback(self) -> Result<(), Self::Error> {
        self.inner.rollback()
    }
}

impl WritableNamespaceRegistry for Transaction<'_> {
    type Namespaces<'a>
        = NamespaceIter
    where
        Self: 'a;

    fn namespaces(&self) -> Self::Namespaces<'_> {
        Transaction::namespaces(self)
    }

    fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, Self::Error> {
        Transaction::namespace(self, prefix)
    }

    fn set_namespace(&mut self, namespace: Namespace) -> Result<(), Self::Error> {
        Transaction::set_namespace(self, namespace)
    }

    fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), Self::Error> {
        Transaction::remove_namespace(self, prefix)
    }

    fn clear_namespaces(&mut self) -> Result<(), Self::Error> {
        Transaction::clear_namespaces(self)
    }
}

impl WritableNamespaceRegistry for KeyedTransaction<'_> {
    type Namespaces<'a>
        = NamespaceIter
    where
        Self: 'a;

    fn namespaces(&self) -> Self::Namespaces<'_> {
        KeyedTransaction::namespaces(self)
    }

    fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, Self::Error> {
        KeyedTransaction::namespace(self, prefix)
    }

    fn set_namespace(&mut self, namespace: Namespace) -> Result<(), Self::Error> {
        KeyedTransaction::set_namespace(self, namespace)
    }

    fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), Self::Error> {
        KeyedTransaction::remove_namespace(self, prefix)
    }

    fn clear_namespaces(&mut self) -> Result<(), Self::Error> {
        KeyedTransaction::clear_namespaces(self)
    }
}

impl OutcomeAwareWritableDataset for KeyedTransaction<'_> {
    fn commit_with_outcome(self) -> Result<(), TransactionCommitError<Self::Error>> {
        let transaction_key = self.transaction_key;
        self.inner
            .commit()
            .map_err(|source| TransactionCommitError::Indeterminate {
                transaction_key,
                source,
            })
    }

    fn rollback_with_outcome(self) -> Result<(), TransactionRollbackError<Self::Error>> {
        self.inner
            .rollback()
            .map_err(TransactionRollbackError::Failed)
    }
}

impl<'a> IntoIterator for &'a Transaction<'_> {
    type Item = Result<Quad, StorageError>;
    type IntoIter = QuadIter<'a>;

    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'a> IntoIterator for &'a KeyedTransaction<'_> {
    type Item = Result<Quad, StorageError>;
    type IntoIter = QuadIter<'a>;

    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

/// An iterator returning the quads contained in a [`Store`].
#[must_use]
pub struct QuadIter<'a> {
    iter: DecodingQuadIterator<'a>,
    reader: StorageReader<'a>,
}

impl Iterator for QuadIter<'_> {
    type Item = Result<Quad, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        Some(match self.iter.next()? {
            Ok(quad) => self.reader.decode_quad(&quad),
            Err(error) => Err(error),
        })
    }
}

/// An iterator returning the graph names contained in a [`Store`].
#[must_use]
pub struct GraphNameIter<'a> {
    iter: DecodingGraphIterator<'a>,
    reader: StorageReader<'a>,
}

impl Iterator for GraphNameIter<'_> {
    type Item = Result<NamedOrBlankNode, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        Some(
            self.iter
                .next()?
                .and_then(|graph_name| self.reader.decode_named_or_blank_node(&graph_name)),
        )
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.iter.size_hint()
    }
}

/// An iterator returning store-global namespace mappings in prefix-byte order.
#[must_use]
pub struct NamespaceIter {
    iter: std::vec::IntoIter<Result<Namespace, StorageError>>,
}

impl NamespaceIter {
    fn from_result(result: Result<Vec<Namespace>, StorageError>) -> Self {
        let values = match result {
            Ok(namespaces) => namespaces.into_iter().map(Ok).collect(),
            Err(error) => vec![Err(error)],
        };
        Self {
            iter: values.into_iter(),
        }
    }
}

impl Iterator for NamespaceIter {
    type Item = Result<Namespace, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        self.iter.next()
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.iter.size_hint()
    }
}

/// A bulk loader allowing to load a lot of data quickly into the store.
///
/// Memory usage is configurable using [`with_max_memory_size_in_megabytes`](Self::with_max_memory_size_in_megabytes)
/// and the number of used threads with [`with_num_threads`](Self::with_num_threads).
/// By default, the memory consumption target (excluding the system and RocksDB internal consumption)
/// is around 2GB per thread and 2 threads.
/// These targets are considered per loaded file.
///
/// Usage example a dataset:
/// ```
/// use oxigraph::io::RdfFormat;
/// use oxigraph::model::*;
/// use oxigraph::store::Store;
///
/// let store = Store::new()?;
///
/// // quads file insertion
/// let file =
///     "<http://example.com> <http://example.com> <http://example.com> <http://example.com> .";
/// let mut loader = store.bulk_loader();
/// loader.load_from_slice(RdfFormat::NQuads, file)?;
/// loader.commit()?;
///
/// // we inspect the store contents
/// let ex = NamedNode::new("http://example.com")?;
/// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), ex))?);
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
pub struct BulkLoader<'a> {
    storage: StorageBulkLoader<'a>,
    num_threads: Option<usize>,
    max_memory_size: Option<usize>,
    on_parse_error: Option<Arc<dyn Fn(RdfParseError) -> Result<(), RdfParseError> + Send + Sync>>,
}

impl BulkLoader<'_> {
    /// Sets the maximal number of background threads to be used by the bulk loader.
    ///
    /// The default value is the number of threads on the machine.
    pub fn with_num_threads(mut self, num_threads: usize) -> Self {
        self.num_threads = Some(num_threads);
        self
    }

    /// Sets a rough idea about the maximal amount of memory to be used by this operation.
    ///
    /// This number must be at least a few megabytes per thread.
    ///
    /// Memory used by RocksDB and the system is not taken into account in this limit.
    /// Note that depending on the system behavior, this amount might never be reached or be blown up
    /// (for example, if the data contains very long IRIs or literals).
    ///
    /// By default, a target 2GB per used thread is used.
    pub fn with_max_memory_size_in_megabytes(mut self, max_memory_size: usize) -> Self {
        self.max_memory_size = Some(max_memory_size);
        self
    }

    #[cfg(not(target_family = "wasm"))]
    fn target_num_threads(&self) -> usize {
        max(
            1,
            self.num_threads
                .unwrap_or_else(|| available_parallelism().map_or(1, NonZero::get)),
        )
    }

    #[cfg(target_family = "wasm")]
    #[expect(clippy::unused_self)]
    fn target_num_threads(&self) -> usize {
        1
    }

    fn target_batch_size(&self) -> usize {
        if let Some(max_memory_size) = self.max_memory_size {
            max_memory_size * 1000 / self.target_num_threads()
        } else {
            DEFAULT_BULK_LOAD_BATCH_SIZE
        }
    }

    /// Allow the bulk loader to save also data to the database during the bulk loading instead of only when [`commit`](Self::commit) is called.
    ///
    /// When used with the RocksDB storage, it allows the storage to compact the data while the loading continues.
    pub fn without_atomicity(mut self) -> Self {
        self.storage = self.storage.without_atomicity();
        self
    }

    /// Adds a `callback` evaluated from time to time with the number of loaded triples.
    pub fn on_progress(mut self, callback: impl Fn(u64) + Send + Sync + 'static) -> Self {
        self.storage = self.storage.on_progress(callback);
        self
    }

    /// Adds a `callback` catching all parse errors and choosing if the parsing should continue
    /// by returning `Ok` or fail by returning `Err`.
    ///
    /// By default, the parsing fails.
    pub fn on_parse_error(
        mut self,
        callback: impl Fn(RdfParseError) -> Result<(), RdfParseError> + Send + Sync + 'static,
    ) -> Self {
        self.on_parse_error = Some(Arc::new(callback));
        self
    }

    /// Loads a file using the bulk loader.
    ///
    /// This function is optimized for large dataset loading speed. For small files, [`Store::load_from_reader`] might be more convenient.
    ///
    /// See [the struct](Self) documentation for more details.
    ///
    /// To get better speed on valid datasets, consider enabling [`RdfParser::lenient`] option to skip some validations.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::store::Store;
    /// use oxigraph::io::{RdfParser, RdfFormat};
    /// use oxigraph::model::*;
    ///
    /// let store = Store::new()?;
    ///
    /// // insert a dataset file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> <http://example.com/g> .";
    /// let mut loader = store.bulk_loader();
    /// loader.load_from_reader(
    ///     RdfParser::from_format(RdfFormat::NQuads).lenient(), // we inject a custom parser with options
    ///     file.as_bytes()
    /// )?;
    /// loader.commit()?;
    ///
    /// // insert a graph file
    /// let file = "<> <> <> .";
    /// let mut loader = store.bulk_loader();
    /// loader.load_from_reader(
    ///     RdfParser::from_format(RdfFormat::Turtle)
    ///         .with_base_iri("http://example.com")?
    ///         .without_named_graphs() // No named graphs allowed in the input
    ///         .with_default_graph(NamedNode::new("http://example.com/g2")?), // we put the file default graph inside of a named graph
    ///     file.as_bytes()
    /// )?;
    /// loader.commit()?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g")?))?);
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g2")?))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn load_from_reader(
        &mut self,
        parser: impl Into<RdfParser>,
        reader: impl Read,
    ) -> Result<(), LoaderError> {
        let on_parse_error = self.on_parse_error.as_ref().map(Arc::clone);
        let mut parser = parser.into().rename_blank_nodes().for_reader(reader);
        self.load_ok_quads::<RdfParseError, LoaderError>(parser.by_ref().filter_map(
            |r| match r {
                Ok(q) => Some(Ok(q)),
                Err(e) => {
                    if let Some(callback) = &on_parse_error {
                        if let Err(e) = callback(e) {
                            Some(Err(e))
                        } else {
                            None
                        }
                    } else {
                        Some(Err(e))
                    }
                }
            },
        ))?;
        self.load_named_graphs(parser.named_graphs()?)?;
        Ok(())
    }

    /// Loads serialized RDF in a slice using the bulk loader.
    ///
    /// This function is optimized for large dataset loading speed. For small files, [`Store::load_from_reader`] might be more convenient.
    ///
    /// See [the struct](Self) documentation for more details.
    ///
    /// To get better speed on valid datasets, consider enabling [`RdfParser::lenient`] option to skip some validations.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::store::Store;
    /// use oxigraph::io::{RdfParser, RdfFormat};
    /// use oxigraph::model::*;
    ///
    /// let store = Store::new()?;
    ///
    /// // insert a dataset file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> <http://example.com/g> .";
    /// let mut loader = store.bulk_loader();
    /// loader.load_from_slice(
    ///     RdfParser::from_format(RdfFormat::NQuads).lenient(), // we inject a custom parser with options
    ///     file
    /// )?;
    /// loader.commit()?;
    ///
    /// // insert a graph file
    /// let file = "<> <> <> .";
    /// let mut loader = store.bulk_loader();
    /// loader.load_from_slice(
    ///     RdfParser::from_format(RdfFormat::Turtle)
    ///         .with_base_iri("http://example.com")?
    ///         .without_named_graphs() // No named graphs allowed in the input
    ///         .with_default_graph(NamedNode::new("http://example.com/g2")?), // we put the file default graph inside of a named graph
    ///     file
    /// )?;
    /// loader.commit()?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g")?))?);
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g2")?))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn load_from_slice(
        &mut self,
        parser: impl Into<RdfParser>,
        slice: &(impl AsRef<[u8]> + ?Sized),
    ) -> Result<(), LoaderError> {
        let on_parse_error = self.on_parse_error.as_ref().map(Arc::clone);
        let mut parser = parser.into().rename_blank_nodes().for_slice(slice);
        self.load_ok_quads::<RdfParseError, LoaderError>(parser.by_ref().filter_map(
            |r| match r {
                Ok(q) => Some(Ok(q)),
                Err(e) => {
                    if let Some(callback) = &on_parse_error {
                        if let Err(e) = callback(e.into()) {
                            Some(Err(e))
                        } else {
                            None
                        }
                    } else {
                        Some(Err(e.into()))
                    }
                }
            },
        ))?;
        self.load_named_graphs(parser.named_graphs().map_err(RdfParseError::Syntax)?)?;
        Ok(())
    }

    /// Loads RDF file using the bulk loader.
    ///
    /// If the input format is N-Triples or N-Quads, it will spawn multiple parallel threads to parse the file.
    ///
    /// This function is optimized for large dataset loading speed. For small files, [`Store::load_from_reader`] might be more convenient.
    ///
    /// See [the struct](Self) documentation for more details.
    ///
    /// To get better speed on valid datasets, consider enabling [`RdfParser::lenient`] option to skip some validations.
    ///
    /// Usage example:
    /// ```no_run
    /// use oxigraph::store::Store;
    /// use oxigraph::io::{RdfParser, RdfFormat};
    /// use oxigraph::model::*;
    ///
    /// let store = Store::new()?;
    ///
    /// // insert a dataset file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> <http://example.com/g> .";
    /// let mut loader = store.bulk_loader();
    /// loader.parallel_load_from_slice(
    ///     RdfParser::from_format(RdfFormat::NQuads).lenient(), // we inject a custom parser with options
    ///     file,
    /// )?;
    /// loader.commit()?;
    ///
    /// // insert a graph file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> .";
    /// let mut loader = store.bulk_loader();
    /// loader.parallel_load_from_slice(
    ///     RdfParser::from_format(RdfFormat::NTriples)
    ///         .with_base_iri("http://example.com")?
    ///         .without_named_graphs() // No named graphs allowed in the input
    ///         .with_default_graph(NamedNode::new("http://example.com/g2")?), // we put the file default graph inside of a named graph
    ///     file,
    /// )?;
    /// loader.commit()?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g")?))?);
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g2")?))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[cfg(not(target_family = "wasm"))]
    pub fn parallel_load_from_file(
        &mut self,
        parser: impl Into<RdfParser>,
        path: impl AsRef<Path>,
    ) -> Result<(), LoaderError> {
        let parser = parser.into();
        if parser.format().supports_empty_named_graphs() {
            return self.load_from_reader(parser, File::open(path).map_err(RdfParseError::from)?);
        }
        let target_num_threads = self.target_num_threads() / 2;
        if target_num_threads < 2 {
            return self.load_from_reader(parser, File::open(path).map_err(RdfParseError::from)?);
        }
        let target_batch_size = self.target_batch_size();
        let on_parse_error = self.on_parse_error.as_ref().map(Arc::clone);
        let parsers = parser
            .rename_blank_nodes()
            .split_file_for_parallel_parsing(path, target_num_threads)
            .map_err(RdfParseError::Io)?;
        thread::scope(|scope| {
            let (sender, receiver) = mpsc::sync_channel(1);
            let threads = parsers
                .into_iter()
                .map(|parser| {
                    let sender = sender.clone();
                    let on_parse_error = on_parse_error.clone();
                    scope.spawn(move || {
                        let mut batch = Vec::with_capacity(target_batch_size);
                        for result in parser {
                            match result {
                                Ok(quad) => {
                                    batch.push(quad);
                                    if batch.len() >= target_batch_size {
                                        let mut batch_to_save =
                                            Vec::with_capacity(target_batch_size);
                                        swap(&mut batch, &mut batch_to_save);
                                        if sender.send(batch_to_save).is_err() {
                                            return Ok(());
                                        }
                                    }
                                }
                                Err(e) => {
                                    if let Some(callback) = &on_parse_error {
                                        callback(e)?;
                                    } else {
                                        return Err(LoaderError::from(e));
                                    }
                                }
                            }
                        }
                        if !batch.is_empty() {
                            let _we_are_returning = sender.send(batch);
                        }
                        Ok(())
                    })
                })
                .collect::<Vec<_>>();
            drop(sender);
            while let Ok(batch) = receiver.recv() {
                self.storage.load_batch(batch, target_num_threads)?;
            }
            for thread in threads {
                map_thread_result(thread.join()).map_err(StorageError::from)??;
            }
            Ok(())
        })
    }

    /// Loads serialized RDF in a slice using the bulk loader.
    ///
    /// If the input format is N-Triples or N-Quads, it will spawn multiple parallel threads to parse the file.
    ///
    /// This function is optimized for large dataset loading speed. For small files, [`Store::load_from_reader`] might be more convenient.
    ///
    /// See [the struct](Self) documentation for more details.
    ///
    /// To get better speed on valid datasets, consider enabling [`RdfParser::lenient`] option to skip some validations.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::store::Store;
    /// use oxigraph::io::{RdfParser, RdfFormat};
    /// use oxigraph::model::*;
    ///
    /// let store = Store::new()?;
    ///
    /// // insert a dataset file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> <http://example.com/g> .";
    /// let mut loader = store.bulk_loader();
    /// loader.parallel_load_from_slice(
    ///     RdfParser::from_format(RdfFormat::NQuads).lenient(), // we inject a custom parser with options
    ///     file,
    /// )?;
    /// loader.commit()?;
    ///
    /// // insert a graph file
    /// let file = "<http://example.com> <http://example.com> <http://example.com> .";
    /// let mut loader = store.bulk_loader();
    /// loader.parallel_load_from_slice(
    ///     RdfParser::from_format(RdfFormat::NTriples)
    ///         .with_base_iri("http://example.com")?
    ///         .without_named_graphs() // No named graphs allowed in the input
    ///         .with_default_graph(NamedNode::new("http://example.com/g2")?), // we put the file default graph inside of a named graph
    ///     file
    /// )?;
    /// loader.commit()?;
    ///
    /// // we inspect the store contents
    /// let ex = NamedNode::new("http://example.com")?;
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g")?))?);
    /// assert!(store.contains(&Quad::new(ex.clone(), ex.clone(), ex.clone(), NamedNode::new("http://example.com/g2")?))?);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[cfg(not(target_family = "wasm"))]
    pub fn parallel_load_from_slice(
        &mut self,
        parser: impl Into<RdfParser>,
        slice: &(impl AsRef<[u8]> + ?Sized),
    ) -> Result<(), LoaderError> {
        let parser = parser.into();
        if parser.format().supports_empty_named_graphs() {
            return self.load_from_slice(parser, slice);
        }
        let target_num_threads = self.target_num_threads() / 2;
        if target_num_threads < 2 {
            return self.load_from_slice(parser, slice);
        }
        let target_batch_size = self.target_batch_size();
        let on_parse_error = self.on_parse_error.as_ref().map(Arc::clone);
        let parsers = parser
            .rename_blank_nodes()
            .split_slice_for_parallel_parsing(slice, target_num_threads);
        thread::scope(|scope| {
            let (sender, receiver) = mpsc::sync_channel(1);
            let threads = parsers
                .into_iter()
                .map(|parser| {
                    let sender = sender.clone();
                    let on_parse_error = on_parse_error.clone();
                    scope.spawn(move || {
                        let mut batch = Vec::with_capacity(target_batch_size);
                        for result in parser {
                            match result {
                                Ok(quad) => {
                                    batch.push(quad);
                                    if batch.len() >= target_batch_size {
                                        let mut batch_to_save =
                                            Vec::with_capacity(target_batch_size);
                                        swap(&mut batch, &mut batch_to_save);
                                        if sender.send(batch_to_save).is_err() {
                                            return Ok(());
                                        }
                                    }
                                }
                                Err(e) => {
                                    if let Some(callback) = &on_parse_error {
                                        callback(e.into())?;
                                    } else {
                                        return Err(LoaderError::from(RdfParseError::from(e)));
                                    }
                                }
                            }
                        }
                        if !batch.is_empty() {
                            let _we_are_returning = sender.send(batch);
                        }
                        Ok(())
                    })
                })
                .collect::<Vec<_>>();
            drop(sender);
            while let Ok(batch) = receiver.recv() {
                self.storage.load_batch(batch, target_num_threads)?;
            }
            for thread in threads {
                map_thread_result(thread.join()).map_err(StorageError::from)??;
            }
            Ok(())
        })
    }

    /// Adds a set of quads using the bulk loader.
    ///
    /// See [the struct](Self) documentation for more details.
    pub fn load_quads(
        &mut self,
        quads: impl IntoIterator<Item = Quad>,
    ) -> Result<(), StorageError> {
        self.load_ok_quads(quads.into_iter().map(Ok::<_, StorageError>))
    }

    fn load_named_graphs(
        &mut self,
        graph_names: Vec<NamedOrBlankNode>,
    ) -> Result<(), StorageError> {
        if !graph_names.is_empty() {
            let target_num_threads = self.target_num_threads();
            self.storage
                .load_named_graphs(graph_names, target_num_threads)?;
        }
        Ok(())
    }

    /// Adds a set of quads using the bulk loader while breaking in the middle of the process in case of error.
    ///
    /// See [the struct](Self) documentation for more details.
    pub fn load_ok_quads<EI, EO: From<StorageError> + From<EI>>(
        &mut self,
        quads: impl IntoIterator<Item = Result<Quad, EI>>,
    ) -> Result<(), EO> {
        let target_num_threads = self.target_num_threads();
        let target_batch_size = self.target_batch_size();
        let mut batch = Vec::with_capacity(target_batch_size);
        for quad in quads {
            batch.push(quad?);
            if batch.len() >= target_batch_size {
                let mut batch_to_save = Vec::with_capacity(target_batch_size);
                swap(&mut batch, &mut batch_to_save);
                self.storage.load_batch(batch_to_save, target_num_threads)?;
            }
        }
        if !batch.is_empty() {
            self.storage.load_batch(batch, target_num_threads)?;
        }
        Ok(())
    }

    /// Saves all the quads loaded using the bulk loader into the store.
    pub fn commit(self) -> Result<(), StorageError> {
        self.storage.commit()
    }
}

#[cfg(all(test, not(target_family = "wasm"), feature = "rocksdb"))]
#[path = "store/transaction_outcome_faults.rs"]
mod transaction_outcome_faults;

#[cfg(test)]
#[expect(clippy::panic_in_result_fn)]
mod tests {
    use super::*;

    #[test]
    fn test_send_sync() {
        fn is_send_sync<T: Send + Sync>() {}

        is_send_sync::<Store>();
        is_send_sync::<Transaction<'_>>();
        is_send_sync::<BulkLoader<'_>>();
    }

    #[test]
    fn store() -> Result<(), StorageError> {
        use crate::model::*;

        let main_s = NamedOrBlankNode::from(BlankNode::default());
        let main_p = NamedNode::new_unchecked("http://example.com");
        let main_o = Term::from(Literal::from(1));
        let main_g = GraphName::from(BlankNode::default());

        let default_quad = Quad::new(
            main_s.clone(),
            main_p.clone(),
            main_o.clone(),
            GraphName::DefaultGraph,
        );
        let named_quad = Quad::new(
            main_s.clone(),
            main_p.clone(),
            main_o.clone(),
            main_g.clone(),
        );
        let mut default_quads = vec![
            Quad::new(
                main_s.clone(),
                main_p.clone(),
                Literal::from(0),
                GraphName::DefaultGraph,
            ),
            default_quad.clone(),
            Quad::new(
                main_s.clone(),
                main_p.clone(),
                Literal::from(200_000_000),
                GraphName::DefaultGraph,
            ),
        ];
        let all_quads = vec![
            named_quad.clone(),
            Quad::new(
                main_s.clone(),
                main_p.clone(),
                Literal::from(200_000_000),
                GraphName::DefaultGraph,
            ),
            default_quad.clone(),
            Quad::new(
                main_s.clone(),
                main_p.clone(),
                Literal::from(0),
                GraphName::DefaultGraph,
            ),
        ];

        let store = Store::new()?;
        for t in &default_quads {
            store.insert(t.clone())?;
            assert!(store.contains(t)?);
        }
        store.insert(default_quad.clone())?;

        store.remove(&default_quad)?;
        assert!(!store.contains(&default_quad)?);
        store.remove(&default_quad)?;
        store.insert(named_quad.clone())?;
        assert!(store.contains(&named_quad)?);
        store.insert(named_quad.clone())?;
        store.insert(default_quad.clone())?;
        store.insert(default_quad.clone())?;
        store.validate()?;

        assert_eq!(store.len()?, 4);
        assert_eq!(store.iter().collect::<Result<Vec<_>, _>>()?, all_quads);
        assert_eq!(
            store
                .quads_for_pattern(Some(&main_s), None, None, None)
                .collect::<Result<Vec<_>, _>>()?,
            all_quads
        );
        assert_eq!(
            store
                .quads_for_pattern(Some(&main_s), Some(&main_p), None, None)
                .collect::<Result<Vec<_>, _>>()?,
            all_quads
        );
        assert_eq!(
            store
                .quads_for_pattern(Some(&main_s), Some(&main_p), Some(&main_o), None)
                .collect::<Result<Vec<_>, _>>()?,
            vec![named_quad.clone(), default_quad.clone()]
        );
        assert_eq!(
            store
                .quads_for_pattern(
                    Some(&main_s),
                    Some(&main_p),
                    Some(&main_o),
                    Some(&GraphName::DefaultGraph)
                )
                .collect::<Result<Vec<_>, _>>()?,
            vec![default_quad.clone()]
        );
        assert_eq!(
            store
                .quads_for_pattern(Some(&main_s), Some(&main_p), Some(&main_o), Some(&main_g))
                .collect::<Result<Vec<_>, _>>()?,
            vec![named_quad.clone()]
        );
        default_quads.reverse();
        assert_eq!(
            store
                .quads_for_pattern(
                    Some(&main_s),
                    Some(&main_p),
                    None,
                    Some(&GraphName::DefaultGraph)
                )
                .collect::<Result<Vec<_>, _>>()?,
            default_quads
        );
        assert_eq!(
            store
                .quads_for_pattern(Some(&main_s), None, Some(&main_o), None)
                .collect::<Result<Vec<_>, _>>()?,
            vec![named_quad.clone(), default_quad.clone()]
        );
        assert_eq!(
            store
                .quads_for_pattern(
                    Some(&main_s),
                    None,
                    Some(&main_o),
                    Some(&GraphName::DefaultGraph)
                )
                .collect::<Result<Vec<_>, _>>()?,
            vec![default_quad.clone()]
        );
        assert_eq!(
            store
                .quads_for_pattern(Some(&main_s), None, Some(&main_o), Some(&main_g))
                .collect::<Result<Vec<_>, _>>()?,
            vec![named_quad.clone()]
        );
        assert_eq!(
            store
                .quads_for_pattern(Some(&main_s), None, None, Some(&GraphName::DefaultGraph))
                .collect::<Result<Vec<_>, _>>()?,
            default_quads
        );
        assert_eq!(
            store
                .quads_for_pattern(None, Some(&main_p), None, None)
                .collect::<Result<Vec<_>, _>>()?,
            all_quads
        );
        assert_eq!(
            store
                .quads_for_pattern(None, Some(&main_p), Some(&main_o), None)
                .collect::<Result<Vec<_>, _>>()?,
            vec![named_quad.clone(), default_quad.clone()]
        );
        assert_eq!(
            store
                .quads_for_pattern(None, None, Some(&main_o), None)
                .collect::<Result<Vec<_>, _>>()?,
            vec![named_quad.clone(), default_quad.clone()]
        );
        assert_eq!(
            store
                .quads_for_pattern(None, None, None, Some(&GraphName::DefaultGraph))
                .collect::<Result<Vec<_>, _>>()?,
            default_quads
        );
        assert_eq!(
            store
                .quads_for_pattern(
                    None,
                    Some(&main_p),
                    Some(&main_o),
                    Some(&GraphName::DefaultGraph)
                )
                .collect::<Result<Vec<_>, _>>()?,
            vec![default_quad]
        );
        assert_eq!(
            store
                .quads_for_pattern(None, Some(&main_p), Some(&main_o), Some(&main_g))
                .collect::<Result<Vec<_>, _>>()?,
            vec![named_quad]
        );

        Ok(())
    }
}
