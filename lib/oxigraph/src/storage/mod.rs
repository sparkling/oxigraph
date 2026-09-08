use crate::model::{GraphName, NamedOrBlankNode, Quad};
pub use crate::storage::error::{CorruptionError, LoaderError, SerializerError, StorageError};
use crate::storage::memory::{
    MemoryDecodingGraphIterator, MemoryStorage, MemoryStorageBulkLoader, MemoryStorageReader,
    MemoryStorageTransaction, QuadIterator,
};
use crate::storage::numeric_encoder::{EncodedQuad, EncodedTerm, StrHash, StrLookup};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use crate::storage::rocksdb::{
    RocksDbChainedDecodingQuadIterator, RocksDbDecodingGraphIterator, RocksDbStorage,
    RocksDbStorageBulkLoader, RocksDbStorageKeyedReadableTransaction, RocksDbStorageOptions,
    RocksDbStorageReadableTransaction, RocksDbStorageReader, RocksDbStorageTransaction,
};
use crate::store::TransactionObservation;
use crate::store::evaluation_metrics::{EvaluationMetricsState, EvaluationObservation};
use crate::store::transaction_metrics::{TransactionMetricsState, TransactionObservationGuard};
use crate::store::{
    CommitReceipt, CommitReceiptOutcome, Namespace, NamespacePrefix, SemanticChangeSet,
    TransactionCommitError,
};
use oxstr::OxString;
use rustc_hash::{FxBuildHasher, FxHashSet};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
#[cfg(not(target_family = "wasm"))]
use std::{io, thread};

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
mod binary_encoder;
mod error;
mod memory;
pub mod numeric_encoder;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
mod rocksdb;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
mod rocksdb_wrapper;
pub mod small_string;

pub const DEFAULT_BULK_LOAD_BATCH_SIZE: usize = 1_000_000;

const TRANSACTION_START_CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Controls how long transaction admission may wait and allows that wait to be cancelled.
///
/// Clones share cancellation state. The timeout is measured independently from the start of
/// each transaction attempt that receives this control.
#[derive(Clone, Default)]
pub struct TransactionStartControl {
    cancellation: spareval::CancellationToken,
    timeout: Option<Duration>,
}

impl TransactionStartControl {
    /// Creates an unbounded, active transaction-start control.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the maximum time allowed for transaction admission.
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Uses an existing SPARQL cancellation token for transaction admission.
    ///
    /// This lets one token govern both queued writer admission and the work performed after the
    /// transaction starts. Calling [`Self::cancel`] or cancelling the supplied token is observed
    /// by every clone of this control.
    #[must_use]
    pub fn with_cancellation_token(
        mut self,
        cancellation_token: spareval::CancellationToken,
    ) -> Self {
        self.cancellation = cancellation_token;
        self
    }

    /// Cancels transaction admission for this control and all of its clones.
    pub fn cancel(&self) {
        self.cancellation.cancel();
    }

    /// Returns whether transaction admission has been cancelled.
    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    /// Returns the configured transaction-admission timeout, if any.
    pub const fn timeout(&self) -> Option<Duration> {
        self.timeout
    }

    pub(crate) fn check(&self, started_at: Instant) -> Result<(), TransactionStartControlError> {
        if self.is_cancelled() {
            return Err(TransactionStartControlError::Cancelled);
        }
        if self
            .timeout
            .is_some_and(|timeout| started_at.elapsed() >= timeout)
        {
            return Err(TransactionStartControlError::TimedOut);
        }
        Ok(())
    }

    pub(crate) fn next_wait(
        &self,
        started_at: Instant,
    ) -> Result<Duration, TransactionStartControlError> {
        self.check(started_at)?;
        Ok(self
            .timeout
            .map_or(TRANSACTION_START_CANCELLATION_POLL_INTERVAL, |timeout| {
                TRANSACTION_START_CANCELLATION_POLL_INTERVAL
                    .min(timeout.saturating_sub(started_at.elapsed()))
            }))
    }
}

impl std::fmt::Debug for TransactionStartControl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TransactionStartControl")
            .field("cancelled", &self.is_cancelled())
            .field("timeout", &self.timeout)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TransactionStartControlError {
    Cancelled,
    TimedOut,
}

pub(crate) enum StorageTransactionStartError {
    Cancelled,
    TimedOut,
    Backend(StorageError),
}

#[expect(
    dead_code,
    reason = "reserved terminal reasons keep storage-to-public outcome mapping exhaustive"
)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StorageTransactionOutcome {
    Committed,
    Rejected,
    Conflicted,
    Cancelled,
    RolledBack,
    Indeterminate,
}

#[cfg(all(test, not(target_family = "wasm"), feature = "rocksdb"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TransactionOutcomeFaultPoint {
    StagingBefore,
    StagingAfter,
    CommitAttemptedBefore,
    CommitAttemptedAfter,
    FinalBatchBefore,
    FinalBatchAfter,
    RolledBackBefore,
    RolledBackAfter,
    GovernanceBatchBefore,
    GovernanceBatchAfter,
}

impl From<TransactionStartControlError> for StorageTransactionStartError {
    fn from(error: TransactionStartControlError) -> Self {
        match error {
            TransactionStartControlError::Cancelled => Self::Cancelled,
            TransactionStartControlError::TimedOut => Self::TimedOut,
        }
    }
}

impl From<StorageError> for StorageTransactionStartError {
    fn from(error: StorageError) -> Self {
        Self::Backend(error)
    }
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct StorageOptions {
    max_open_files: Option<i32>,
    fd_reserve: Option<u32>,
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
impl StorageOptions {
    pub(crate) fn new(max_open_files: Option<i32>, fd_reserve: Option<u32>) -> Self {
        Self {
            max_open_files,
            fd_reserve,
        }
    }
}

/// Low level storage primitives
#[derive(Clone)]
pub struct Storage {
    kind: StorageKind,
    transaction_metrics: Arc<TransactionMetricsState>,
    evaluation_metrics: Arc<EvaluationMetricsState>,
}

#[derive(Clone)]
enum StorageKind {
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb(RocksDbStorage),
    Memory(MemoryStorage),
}

impl Storage {
    pub(crate) fn evaluation_metrics(&self) -> crate::store::EvaluationMetrics {
        self.evaluation_metrics.snapshot()
    }

    pub(crate) fn start_evaluation_observation(
        &self,
        operation: crate::store::EvaluationOperation,
    ) -> EvaluationObservation {
        self.evaluation_metrics.start(operation)
    }

    pub(crate) fn transaction_metrics(&self) -> crate::store::TransactionMetrics {
        self.transaction_metrics.snapshot()
    }

    #[cfg(all(test, not(target_family = "wasm"), feature = "rocksdb"))]
    pub(crate) fn corrupt_readiness_fixture(&self, field: u8) -> Result<(), StorageError> {
        match &self.kind {
            StorageKind::RocksDb(storage) => storage.corrupt_readiness_fixture(field),
            StorageKind::Memory(_) => Err(StorageError::Other(
                "fixture requires an isolated RocksDB store".into(),
            )),
        }
    }
    #[expect(clippy::unnecessary_wraps)]
    pub fn new() -> Result<Self, StorageError> {
        Ok(Self {
            kind: StorageKind::Memory(MemoryStorage::new()),
            transaction_metrics: Arc::default(),
            evaluation_metrics: Arc::default(),
        })
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        Ok(Self {
            kind: StorageKind::RocksDb(RocksDbStorage::open(path)?),
            transaction_metrics: Arc::default(),
            evaluation_metrics: Arc::default(),
        })
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn open_with_options(path: &Path, options: StorageOptions) -> Result<Self, StorageError> {
        Ok(Self {
            kind: StorageKind::RocksDb(RocksDbStorage::open_with_options(
                path,
                RocksDbStorageOptions {
                    max_open_files: options.max_open_files,
                    fd_reserve: options.fd_reserve,
                },
            )?),
            transaction_metrics: Arc::default(),
            evaluation_metrics: Arc::default(),
        })
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn open_read_only(path: &Path) -> Result<Self, StorageError> {
        Ok(Self {
            kind: StorageKind::RocksDb(RocksDbStorage::open_read_only(path)?),
            transaction_metrics: Arc::default(),
            evaluation_metrics: Arc::default(),
        })
    }

    pub fn snapshot(&self) -> StorageReader<'static> {
        StorageReader {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageKind::RocksDb(storage) => StorageReaderKind::RocksDb(storage.snapshot()),
                StorageKind::Memory(storage) => StorageReaderKind::Memory(storage.snapshot()),
            },
        }
    }

    #[cfg_attr(
        not(all(not(target_family = "wasm"), feature = "rocksdb")),
        expect(clippy::unnecessary_wraps)
    )]
    pub fn start_transaction(&self) -> Result<StorageTransaction<'_>, StorageError> {
        Ok(StorageTransaction {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageKind::RocksDb(storage) => {
                    StorageTransactionKind::RocksDb(storage.start_transaction()?)
                }
                StorageKind::Memory(storage) => {
                    StorageTransactionKind::Memory(storage.start_transaction())
                }
            },
            observation: self.transaction_metrics.start(),
        })
    }

    #[cfg_attr(
        not(all(not(target_family = "wasm"), feature = "rocksdb")),
        expect(clippy::unnecessary_wraps)
    )]
    pub fn start_readable_transaction(
        &self,
    ) -> Result<StorageReadableTransaction<'_>, StorageError> {
        Ok(StorageReadableTransaction {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageKind::RocksDb(storage) => {
                    StorageReadableTransactionKind::RocksDb(storage.start_readable_transaction()?)
                }
                StorageKind::Memory(storage) => {
                    StorageReadableTransactionKind::Memory(storage.start_transaction())
                }
            },
            observation: self.transaction_metrics.start(),
        })
    }

    pub(crate) fn start_readable_transaction_with_control(
        &self,
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<StorageReadableTransaction<'_>, StorageTransactionStartError> {
        Ok(StorageReadableTransaction {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageKind::RocksDb(storage) => StorageReadableTransactionKind::RocksDb(
                    storage.start_readable_transaction_with_control(control, started_at)?,
                ),
                StorageKind::Memory(storage) => StorageReadableTransactionKind::Memory(
                    storage.start_transaction_with_control(control, started_at)?,
                ),
            },
            observation: self.transaction_metrics.start(),
        })
    }

    pub(crate) const fn supports_durable_transaction_outcomes(&self) -> bool {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(_) => true,
            StorageKind::Memory(_) => false,
        }
    }

    pub(crate) fn start_keyed_readable_transaction_with_control(
        &self,
        transaction_key: &[u8; 16],
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<StorageKeyedReadableTransaction<'_>, StorageTransactionStartError> {
        Ok(StorageKeyedReadableTransaction {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageKind::RocksDb(storage) => StorageKeyedReadableTransactionKind::RocksDb(
                    storage.start_keyed_readable_transaction_with_control(
                        transaction_key,
                        control,
                        started_at,
                    )?,
                ),
                StorageKind::Memory(storage) => StorageKeyedReadableTransactionKind::Memory(
                    storage.start_keyed_readable_transaction_with_control(
                        transaction_key,
                        control,
                        started_at,
                    )?,
                ),
            },
            observation: self.transaction_metrics.start(),
        })
    }

    pub(crate) fn lookup_transaction_outcome(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<StorageTransactionOutcome, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.lookup_transaction_outcome(transaction_key),
            StorageKind::Memory(storage) => storage.lookup_transaction_outcome(transaction_key),
        }
    }

    pub(crate) fn start_governed_transaction_with_control(
        &self,
        transaction_key: &[u8; 16],
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<StorageKeyedReadableTransaction<'_>, StorageTransactionStartError> {
        Ok(StorageKeyedReadableTransaction {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageKind::RocksDb(storage) => StorageKeyedReadableTransactionKind::RocksDb(
                    storage.start_governed_transaction_with_control(
                        transaction_key,
                        control,
                        started_at,
                    )?,
                ),
                StorageKind::Memory(storage) => StorageKeyedReadableTransactionKind::Memory(
                    storage.start_governed_transaction_with_control(
                        transaction_key,
                        control,
                        started_at,
                    )?,
                ),
            },
            observation: self.transaction_metrics.start(),
        })
    }

    pub(crate) fn lookup_commit_receipt(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<CommitReceiptOutcome, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.lookup_commit_receipt(transaction_key),
            StorageKind::Memory(storage) => storage.lookup_commit_receipt(transaction_key),
        }
    }

    pub(crate) fn lookup_shacl_receipt(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<crate::store::ShaclReceiptOutcome, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.lookup_shacl_receipt(transaction_key),
            StorageKind::Memory(storage) => storage.lookup_shacl_receipt(transaction_key),
        }
    }

    pub(crate) fn govern_outbox(
        &self,
        action: crate::store::retention::Action<'_>,
        now: crate::store::GovernanceTime,
    ) -> Result<crate::store::retention::ActionResult, crate::store::GovernanceError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.govern_outbox(action, now),
            StorageKind::Memory(storage) => storage.govern_outbox(action, now),
        }
    }

    pub(crate) fn governance_health(
        &self,
        now: crate::store::GovernanceTime,
        limit: std::num::NonZeroUsize,
    ) -> Result<crate::store::GovernanceHealth, crate::store::GovernanceError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.governance_health(now, limit),
            StorageKind::Memory(storage) => storage.governance_health(now, limit),
        }
    }

    pub(crate) fn read_outbox(
        &self,
        after: Option<&crate::store::OutboxCursor>,
        limit: std::num::NonZeroUsize,
    ) -> Result<crate::store::OutboxBatch, crate::store::OutboxReadError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.read_outbox(after, limit),
            StorageKind::Memory(storage) => storage.read_outbox(after, limit),
        }
    }

    #[cfg(all(test, not(target_family = "wasm"), feature = "rocksdb"))]
    pub(crate) fn arm_transaction_outcome_fault(
        &self,
        point: TransactionOutcomeFaultPoint,
    ) -> Result<(), StorageError> {
        match &self.kind {
            StorageKind::RocksDb(storage) => storage.arm_transaction_outcome_fault(point),
            StorageKind::Memory(_) => Err(StorageError::Other(
                "transaction-outcome fault control requires a RocksDB store".into(),
            )),
        }
    }

    #[cfg(all(test, not(target_family = "wasm"), feature = "rocksdb"))]
    pub(crate) fn transaction_outcome_fault_events(
        &self,
    ) -> Result<Vec<TransactionOutcomeFaultPoint>, StorageError> {
        match &self.kind {
            StorageKind::RocksDb(storage) => storage.transaction_outcome_fault_events(),
            StorageKind::Memory(_) => Err(StorageError::Other(
                "transaction-outcome fault control requires a RocksDB store".into(),
            )),
        }
    }

    #[cfg(all(test, not(target_family = "wasm"), feature = "rocksdb"))]
    pub(crate) fn write_raw_transaction_outcome_record(
        &self,
        transaction_key: &[u8; 16],
        record: &[u8],
    ) -> Result<(), StorageError> {
        match &self.kind {
            StorageKind::RocksDb(storage) => {
                storage.write_raw_transaction_outcome_record(transaction_key, record)
            }
            StorageKind::Memory(_) => Err(StorageError::Other(
                "raw transaction-outcome records require a RocksDB store".into(),
            )),
        }
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn flush(&self) -> Result<(), StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.flush(),
            StorageKind::Memory(_) => Ok(()),
        }
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn compact(&self) -> Result<(), StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.compact(),
            StorageKind::Memory(_) => Ok(()),
        }
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    pub fn backup(&self, target_directory: &Path) -> Result<(), StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => storage.backup(target_directory),
            StorageKind::Memory(_) => Err(StorageError::Other(
                "It is not possible to backup an in-memory database".into(),
            )),
        }
    }

    pub fn bulk_loader(&self) -> StorageBulkLoader<'_> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKind::RocksDb(storage) => StorageBulkLoader {
                kind: StorageBulkLoaderKind::RocksDb(storage.bulk_loader()),
            },
            StorageKind::Memory(storage) => StorageBulkLoader {
                kind: StorageBulkLoaderKind::Memory(storage.bulk_loader()),
            },
        }
    }
}

#[must_use]
pub struct StorageReader<'a> {
    kind: StorageReaderKind<'a>,
}

enum StorageReaderKind<'a> {
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb(RocksDbStorageReader<'a>),
    Memory(MemoryStorageReader<'a>),
}

#[cfg_attr(
    not(all(not(target_family = "wasm"), feature = "rocksdb")),
    expect(clippy::unnecessary_wraps)
)]
impl<'a> StorageReader<'a> {
    pub fn check_layout(&self) -> Result<(), StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.check_layout(),
            StorageReaderKind::Memory(_) => Ok(()),
        }
    }
    pub fn len(&self) -> Result<usize, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.len(),
            StorageReaderKind::Memory(reader) => Ok(reader.len()),
        }
    }

    pub fn is_empty(&self) -> Result<bool, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.is_empty(),
            StorageReaderKind::Memory(reader) => Ok(reader.is_empty()),
        }
    }

    pub fn contains(&self, quad: &EncodedQuad) -> Result<bool, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.contains(quad),
            StorageReaderKind::Memory(reader) => Ok(reader.contains(quad)),
        }
    }

    pub fn quads_for_pattern(
        &self,
        subject: Option<&EncodedTerm>,
        predicate: Option<&EncodedTerm>,
        object: Option<&EncodedTerm>,
        graph_name: Option<&EncodedTerm>,
    ) -> DecodingQuadIterator<'a> {
        DecodingQuadIterator {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageReaderKind::RocksDb(reader) => DecodingQuadIteratorKind::RocksDb(
                    reader.quads_for_pattern(subject, predicate, object, graph_name),
                ),
                StorageReaderKind::Memory(reader) => DecodingQuadIteratorKind::Memory(
                    reader.quads_for_pattern(subject, predicate, object, graph_name),
                ),
            },
        }
    }

    pub fn quads_for_pattern_in_union(
        &self,
        subject: Option<&EncodedTerm>,
        predicate: Option<&EncodedTerm>,
        object: Option<&EncodedTerm>,
        graph_names: Option<&[Option<EncodedTerm>]>,
    ) -> Box<dyn Iterator<Item = Result<EncodedQuad, StorageError>> + 'a> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => {
                Box::new(reader.quads_for_pattern_in_union(subject, predicate, object, graph_names))
            }
            StorageReaderKind::Memory(_) => {
                let iter: Box<dyn Iterator<Item = Result<_, _>> + 'a> =
                    if let Some(graph_names) = graph_names {
                        let iters = graph_names
                            .iter()
                            .map(|graph_name| {
                                self.quads_for_pattern(
                                    subject,
                                    predicate,
                                    object,
                                    Some(graph_name.as_ref().unwrap_or(&EncodedTerm::DefaultGraph)),
                                )
                            })
                            .collect::<Vec<_>>();
                        Box::new(iters.into_iter().flatten())
                    } else {
                        Box::new(self.quads_for_pattern(subject, predicate, object, None))
                    };
                Box::new(hash_deduplicate(iter.map(|quad| {
                    let mut quad = quad?;
                    quad.graph_name = EncodedTerm::DefaultGraph;
                    Ok(quad)
                })))
            }
        }
    }

    pub fn named_graphs(&self) -> DecodingGraphIterator<'a> {
        DecodingGraphIterator {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageReaderKind::RocksDb(reader) => {
                    DecodingGraphIteratorKind::RocksDb(reader.named_graphs())
                }
                StorageReaderKind::Memory(reader) => {
                    DecodingGraphIteratorKind::Memory(reader.named_graphs())
                }
            },
        }
    }

    pub fn contains_named_graph(&self, graph_name: &EncodedTerm) -> Result<bool, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.contains_named_graph(graph_name),
            StorageReaderKind::Memory(reader) => Ok(reader.contains_named_graph(graph_name)),
        }
    }

    pub fn namespaces(&self) -> Result<Vec<Namespace>, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.namespaces(),
            StorageReaderKind::Memory(reader) => reader.namespaces(),
        }
    }

    pub fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.namespace(prefix),
            StorageReaderKind::Memory(reader) => reader.namespace(prefix),
        }
    }

    pub fn contains_str(&self, key: &StrHash) -> Result<bool, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.contains_str(key),
            StorageReaderKind::Memory(reader) => Ok(reader.contains_str(key)),
        }
    }

    /// Validate that all the storage invariants held in the data
    pub fn validate(&self) -> Result<(), StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.validate(),
            StorageReaderKind::Memory(reader) => reader.validate(),
        }
    }
}

fn hash_deduplicate<T: Eq + std::hash::Hash + Clone, E>(
    iter: impl Iterator<Item = Result<T, E>>,
) -> impl Iterator<Item = Result<T, E>> {
    let mut already_seen = FxHashSet::with_capacity_and_hasher(iter.size_hint().0, FxBuildHasher);
    iter.filter(move |result| match result {
        Ok(value) => already_seen.insert(value.clone()),
        Err(_) => true,
    })
}

#[must_use]
pub struct DecodingQuadIterator<'a> {
    kind: DecodingQuadIteratorKind<'a>,
}

enum DecodingQuadIteratorKind<'a> {
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb(RocksDbChainedDecodingQuadIterator<'a>),
    Memory(QuadIterator<'a>),
}

impl Iterator for DecodingQuadIterator<'_> {
    type Item = Result<EncodedQuad, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            DecodingQuadIteratorKind::RocksDb(iter) => iter.next(),
            DecodingQuadIteratorKind::Memory(iter) => iter.next().map(Ok),
        }
    }
}

#[must_use]
pub struct DecodingGraphIterator<'a> {
    kind: DecodingGraphIteratorKind<'a>,
}

enum DecodingGraphIteratorKind<'a> {
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb(RocksDbDecodingGraphIterator<'a>),
    Memory(MemoryDecodingGraphIterator<'a>),
}

impl Iterator for DecodingGraphIterator<'_> {
    type Item = Result<EncodedTerm, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            DecodingGraphIteratorKind::RocksDb(iter) => iter.next(),
            DecodingGraphIteratorKind::Memory(iter) => iter.next().map(Ok),
        }
    }
}

impl StrLookup for StorageReader<'_> {
    fn get_str(&self, key: &StrHash) -> Result<Option<OxString>, StorageError> {
        match &self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReaderKind::RocksDb(reader) => reader.get_str(key),
            StorageReaderKind::Memory(reader) => reader.get_str(key),
        }
    }
}

#[must_use]
pub struct StorageTransaction<'a> {
    kind: StorageTransactionKind<'a>,
    observation: TransactionObservationGuard,
}

enum StorageTransactionKind<'a> {
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb(RocksDbStorageTransaction<'a>),
    Memory(MemoryStorageTransaction<'a>),
}

#[cfg_attr(
    not(all(not(target_family = "wasm"), feature = "rocksdb")),
    expect(clippy::unnecessary_wraps)
)]
impl StorageTransaction<'_> {
    pub fn insert(&mut self, quad: Quad) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => transaction.insert(quad),
            StorageTransactionKind::Memory(transaction) => {
                transaction.insert(quad);
            }
        }
    }

    pub fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => {
                transaction.insert_named_graph(graph_name)
            }
            StorageTransactionKind::Memory(transaction) => {
                transaction.insert_named_graph(graph_name);
            }
        }
    }

    pub fn set_namespace(&mut self, namespace: Namespace) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => {
                transaction.set_namespace(namespace);
                Ok(())
            }
            StorageTransactionKind::Memory(transaction) => transaction.set_namespace(namespace),
        }
    }

    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => {
                transaction.remove_namespace(prefix);
                Ok(())
            }
            StorageTransactionKind::Memory(transaction) => transaction.remove_namespace(prefix),
        }
    }

    pub fn clear_namespaces(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => {
                transaction.clear_namespaces();
                Ok(())
            }
            StorageTransactionKind::Memory(transaction) => transaction.clear_namespaces(),
        }
    }

    pub fn remove(&mut self, quad: &Quad) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => transaction.remove(quad),
            StorageTransactionKind::Memory(transaction) => transaction.remove(quad),
        }
    }

    pub fn clear_default_graph(&mut self) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => transaction.clear_default_graph(),
            StorageTransactionKind::Memory(transaction) => {
                transaction.clear_graph(&GraphName::DefaultGraph)
            }
        }
    }

    pub fn clear_all_named_graphs(&mut self) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => transaction.clear_all_named_graphs(),
            StorageTransactionKind::Memory(transaction) => transaction.clear_all_named_graphs(),
        }
    }

    pub fn clear_all_graphs(&mut self) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => transaction.clear_all_graphs(),
            StorageTransactionKind::Memory(transaction) => transaction.clear_all_graphs(),
        }
    }

    pub fn remove_all_named_graphs(&mut self) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => transaction.remove_all_named_graphs(),
            StorageTransactionKind::Memory(transaction) => transaction.remove_all_named_graphs(),
        }
    }

    pub fn clear(&mut self) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => transaction.clear(),
            StorageTransactionKind::Memory(transaction) => transaction.clear(),
        }
    }

    pub fn commit(mut self) -> Result<(), StorageError> {
        self.observation.before_commit();
        let result = match self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageTransactionKind::RocksDb(transaction) => transaction.commit(),
            StorageTransactionKind::Memory(transaction) => {
                transaction.commit();
                Ok(())
            }
        };
        self.observation.finish_commit(&result);
        result
    }
}

#[must_use]
pub struct StorageReadableTransaction<'a> {
    kind: StorageReadableTransactionKind<'a>,
    observation: TransactionObservationGuard,
}

enum StorageReadableTransactionKind<'a> {
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb(RocksDbStorageReadableTransaction<'a>),
    Memory(MemoryStorageTransaction<'a>),
}

#[cfg_attr(
    not(all(not(target_family = "wasm"), feature = "rocksdb")),
    expect(clippy::unnecessary_wraps)
)]
impl StorageReadableTransaction<'_> {
    pub fn reader(&self) -> StorageReader<'_> {
        StorageReader {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageReadableTransactionKind::RocksDb(transaction) => {
                    StorageReaderKind::RocksDb(transaction.reader())
                }
                StorageReadableTransactionKind::Memory(transaction) => {
                    StorageReaderKind::Memory(transaction.reader())
                }
            },
        }
    }

    pub fn insert(&mut self, quad: Quad) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => transaction.insert(quad),
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.insert(quad);
            }
        }
    }

    pub fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => {
                transaction.insert_named_graph(graph_name)
            }
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.insert_named_graph(graph_name);
            }
        }
    }

    pub fn set_namespace(&mut self, namespace: Namespace) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => {
                transaction.set_namespace(namespace);
                Ok(())
            }
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.set_namespace(namespace)
            }
        }
    }

    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => {
                transaction.remove_namespace(prefix);
                Ok(())
            }
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.remove_namespace(prefix)
            }
        }
    }

    pub fn clear_namespaces(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => transaction.clear_namespaces(),
            StorageReadableTransactionKind::Memory(transaction) => transaction.clear_namespaces(),
        }
    }

    pub fn remove(&mut self, quad: &Quad) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => transaction.remove(quad),
            StorageReadableTransactionKind::Memory(transaction) => transaction.remove(quad),
        }
    }

    pub fn clear_graph(&mut self, graph_name: &GraphName) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => {
                transaction.clear_graph(graph_name)
            }
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.clear_graph(graph_name);
                Ok(())
            }
        }
    }

    pub fn clear_all_named_graphs(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => {
                transaction.clear_all_named_graphs()
            }
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.clear_all_named_graphs();
                Ok(())
            }
        }
    }

    pub fn clear_all_graphs(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => transaction.clear_all_graphs(),
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.clear_all_graphs();
                Ok(())
            }
        }
    }

    pub fn remove_named_graph(
        &mut self,
        graph_name: &NamedOrBlankNode,
    ) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => {
                transaction.remove_named_graph(graph_name)
            }
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.remove_named_graph(graph_name);
                Ok(())
            }
        }
    }

    pub fn remove_all_named_graphs(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => {
                transaction.remove_all_named_graphs()
            }
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.remove_all_named_graphs();
                Ok(())
            }
        }
    }

    pub fn clear(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => transaction.clear(),
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.clear();
                Ok(())
            }
        }
    }

    pub fn commit(mut self) -> Result<(), StorageError> {
        self.observation.before_commit();
        let result = match self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageReadableTransactionKind::RocksDb(transaction) => transaction.commit(),
            StorageReadableTransactionKind::Memory(transaction) => {
                transaction.commit();
                Ok(())
            }
        };
        self.observation.finish_commit(&result);
        result
    }

    pub fn rollback(mut self) {
        self.observation.before_rollback();
        drop(self.kind);
        self.observation
            .finish(TransactionObservation::RolledBack, false);
    }
}

#[must_use]
pub(crate) struct StorageKeyedReadableTransaction<'a> {
    kind: StorageKeyedReadableTransactionKind<'a>,
    observation: TransactionObservationGuard,
}

enum StorageKeyedReadableTransactionKind<'a> {
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb(RocksDbStorageKeyedReadableTransaction<'a>),
    Memory(MemoryStorageTransaction<'a>),
}

#[cfg_attr(
    not(all(not(target_family = "wasm"), feature = "rocksdb")),
    expect(clippy::unnecessary_wraps)
)]
impl StorageKeyedReadableTransaction<'_> {
    pub(crate) fn commit_with_receipt(
        mut self,
        changes: &SemanticChangeSet,
        validation: Option<crate::store::shacl_receipt::ValidationCommitContext<'_>>,
    ) -> Result<CommitReceipt, TransactionCommitError<StorageError>> {
        self.observation.before_commit();
        let result = match self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.commit_with_receipt(changes, validation)
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.commit_with_receipt(changes, validation)
            }
        };
        self.observation.finish_governed(&result);
        result
    }

    pub fn reader(&self) -> StorageReader<'_> {
        StorageReader {
            kind: match &self.kind {
                #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
                StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                    StorageReaderKind::RocksDb(transaction.reader())
                }
                StorageKeyedReadableTransactionKind::Memory(transaction) => {
                    StorageReaderKind::Memory(transaction.reader())
                }
            },
        }
    }

    pub fn insert(&mut self, quad: Quad) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => transaction.insert(quad),
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.insert(quad);
            }
        }
    }

    pub fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.insert_named_graph(graph_name)
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.insert_named_graph(graph_name);
            }
        }
    }

    pub fn set_namespace(&mut self, namespace: Namespace) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.set_namespace(namespace);
                Ok(())
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.set_namespace(namespace)
            }
        }
    }

    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.remove_namespace(prefix);
                Ok(())
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.remove_namespace(prefix)
            }
        }
    }

    pub fn clear_namespaces(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.clear_namespaces()
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.clear_namespaces()
            }
        }
    }

    pub fn remove(&mut self, quad: &Quad) {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => transaction.remove(quad),
            StorageKeyedReadableTransactionKind::Memory(transaction) => transaction.remove(quad),
        }
    }

    pub fn clear_graph(&mut self, graph_name: &GraphName) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.clear_graph(graph_name)
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.clear_graph(graph_name);
                Ok(())
            }
        }
    }

    pub fn clear_all_named_graphs(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.clear_all_named_graphs()
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.clear_all_named_graphs();
                Ok(())
            }
        }
    }

    pub fn clear_all_graphs(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.clear_all_graphs()
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.clear_all_graphs();
                Ok(())
            }
        }
    }

    pub fn remove_named_graph(
        &mut self,
        graph_name: &NamedOrBlankNode,
    ) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.remove_named_graph(graph_name)
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.remove_named_graph(graph_name);
                Ok(())
            }
        }
    }

    pub fn remove_all_named_graphs(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => {
                transaction.remove_all_named_graphs()
            }
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.remove_all_named_graphs();
                Ok(())
            }
        }
    }

    pub fn clear(&mut self) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => transaction.clear(),
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.clear();
                Ok(())
            }
        }
    }

    pub fn commit(mut self) -> Result<(), StorageError> {
        self.observation.before_commit();
        let result = match self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => transaction.commit(),
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.commit_with_outcome()
            }
        };
        self.observation.finish_commit(&result);
        result
    }

    pub fn rollback(mut self) -> Result<(), StorageError> {
        self.observation.before_rollback();
        let result = match self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageKeyedReadableTransactionKind::RocksDb(transaction) => transaction.rollback(),
            StorageKeyedReadableTransactionKind::Memory(transaction) => {
                transaction.rollback_with_outcome()
            }
        };
        self.observation.finish(
            if result.is_ok() {
                TransactionObservation::RolledBack
            } else {
                TransactionObservation::RollbackFailed
            },
            false,
        );
        result
    }
}

#[must_use]
pub struct StorageBulkLoader<'a> {
    kind: StorageBulkLoaderKind<'a>,
}

enum StorageBulkLoaderKind<'a> {
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    RocksDb(RocksDbStorageBulkLoader<'a>),
    Memory(MemoryStorageBulkLoader<'a>),
}

impl StorageBulkLoader<'_> {
    pub fn on_progress(self, callback: impl Fn(u64) + Send + Sync + 'static) -> Self {
        match self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageBulkLoaderKind::RocksDb(loader) => Self {
                kind: StorageBulkLoaderKind::RocksDb(loader.on_progress(callback)),
            },
            StorageBulkLoaderKind::Memory(loader) => Self {
                kind: StorageBulkLoaderKind::Memory(loader.on_progress(callback)),
            },
        }
    }

    pub fn without_atomicity(self) -> Self {
        match self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageBulkLoaderKind::RocksDb(loader) => Self {
                kind: StorageBulkLoaderKind::RocksDb(loader.without_atomicity()),
            },
            StorageBulkLoaderKind::Memory(loader) => Self {
                kind: StorageBulkLoaderKind::Memory(loader),
            },
        }
    }

    #[cfg_attr(
        any(target_family = "wasm", not(feature = "rocksdb")),
        expect(clippy::unnecessary_wraps, unused_variables)
    )]
    pub fn load_batch(
        &mut self,
        quads: Vec<Quad>,
        max_num_threads: usize,
    ) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageBulkLoaderKind::RocksDb(loader) => loader.load_batch(quads, max_num_threads),
            StorageBulkLoaderKind::Memory(loader) => {
                loader.load_batch(quads);
                Ok(())
            }
        }
    }

    #[cfg_attr(
        any(target_family = "wasm", not(feature = "rocksdb")),
        expect(clippy::unnecessary_wraps, unused_variables)
    )]
    pub fn load_named_graphs(
        &mut self,
        graph_names: Vec<NamedOrBlankNode>,
        max_num_threads: usize,
    ) -> Result<(), StorageError> {
        match &mut self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageBulkLoaderKind::RocksDb(loader) => {
                loader.load_named_graphs(graph_names, max_num_threads)
            }
            StorageBulkLoaderKind::Memory(loader) => {
                loader.load_named_graphs(graph_names);
                Ok(())
            }
        }
    }

    #[cfg_attr(
        any(target_family = "wasm", not(feature = "rocksdb")),
        expect(clippy::unnecessary_wraps)
    )]
    pub fn commit(self) -> Result<(), StorageError> {
        match self.kind {
            #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
            StorageBulkLoaderKind::RocksDb(loader) => loader.commit(),
            StorageBulkLoaderKind::Memory(loader) => {
                loader.commit();
                Ok(())
            }
        }
    }
}

#[cfg(not(target_family = "wasm"))]
pub fn map_thread_result<R>(result: thread::Result<R>) -> io::Result<R> {
    result.map_err(|e| {
        io::Error::other(if let Ok(e) = e.downcast::<&dyn std::fmt::Display>() {
            format!("A loader processed crashed with {e}")
        } else {
            "A loader processed crashed with and unknown error".into()
        })
    })
}
