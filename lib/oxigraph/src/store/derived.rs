//! Provider-neutral inputs for rebuildable derived indexes (ADR-0024).
use super::backup::check;
use super::{
    BackupCheckpoint, BackupError, CommitReceipt, ContributorCheckpoint, OutboxCursor,
    OutboxReadError, OutboxRecord, SemanticChange, StorageError, Store, TransactionStartControl,
};
use crate::storage::StorageReader;
use crate::storage::numeric_encoder::Decoder;
use sha2::{Digest, Sha256};
use std::num::{NonZeroU64, NonZeroUsize};
use std::time::Instant;

/// Logical input ceilings, checked before handing each decoded record to a
/// provider. Native buffers and one decoded RDF record are outside these limits;
/// callbacks must bound their own allocations and honor the supplied control.
#[derive(Clone)]
pub struct DerivedLimits {
    pub max_records: NonZeroU64,
    pub max_bytes: NonZeroU64,
    pub control: TransactionStartControl,
}
impl Default for DerivedLimits {
    fn default() -> Self {
        Self {
            max_records: NonZeroU64::new(1_000_000).unwrap_or(NonZeroU64::MIN),
            max_bytes: NonZeroU64::new(64 * 1024 * 1024).unwrap_or(NonZeroU64::MIN),
            control: TransactionStartControl::new(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum DerivedError {
    #[error(transparent)]
    Backup(#[from] BackupError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Outbox(#[from] OutboxReadError),
    #[error("primary changed while capturing the index input snapshot; retry capture")]
    SourceBusy,
    #[error("derived input record or logical-byte ceiling exceeded")]
    Limit,
    #[error("derived input checkpoint or complete-commit binding is inconsistent")]
    InvalidCheckpoint,
    #[error("the derived snapshot differs from the current primary; rebuild or reconcile")]
    NotFresh,
}

/// One native primary snapshot: topology, RDF, namespaces and outbox reads all
/// use the same RocksDB snapshot. No primary writes are blocked during scanning.
/// Release promptly: a retained snapshot can delay native reclamation.
///
/// The full physical checkpoint, not just its governed receipt, is the strict
/// freshness token. The outbox does not cover ungoverned writes.
pub struct DerivedSnapshot {
    reader: StorageReader<'static>,
    checkpoint: BackupCheckpoint,
}

/// Successful complete scan of a source snapshot, not an index-semantic proof.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DerivedScan {
    checkpoint: BackupCheckpoint,
    records: u64,
    logical_bytes: u64,
    sha256: [u8; 32],
}
impl DerivedScan {
    pub const fn checkpoint(&self) -> &BackupCheckpoint {
        &self.checkpoint
    }
    pub const fn records(&self) -> u64 {
        self.records
    }
    pub const fn logical_bytes(&self) -> u64 {
        self.logical_bytes
    }
    /// Hash of the native ordered rebuild stream, not RDF canonicalization.
    pub const fn sha256(&self) -> &[u8; 32] {
        &self.sha256
    }
}

/// One fully checked governed commit, never a partial paginated commit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DerivedCommit {
    receipt: CommitReceipt,
    changes: Vec<SemanticChange>,
}
impl DerivedCommit {
    pub const fn receipt(&self) -> &CommitReceipt {
        &self.receipt
    }
    pub fn changes(&self) -> &[SemanticChange] {
        &self.changes
    }
}

/// A bounded overlay ending exactly at the captured snapshot's commit end.
/// It covers governed writes only; applying it is not proof of whole-primary
/// equivalence. The lifecycle must reconcile with the authoritative snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DerivedDelta {
    checkpoint: BackupCheckpoint,
    commits: Vec<DerivedCommit>,
    records: u64,
    logical_bytes: u64,
}
impl DerivedDelta {
    pub const fn checkpoint(&self) -> &BackupCheckpoint {
        &self.checkpoint
    }
    pub fn commits(&self) -> &[DerivedCommit] {
        &self.commits
    }
    pub const fn records(&self) -> u64 {
        self.records
    }
    pub const fn logical_bytes(&self) -> u64 {
        self.logical_bytes
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "additive derived-index input API"
)]
impl Store {
    /// Captures an exact native index input view. A bounded three-attempt
    /// sequence bracket detects concurrent writes during capture; scanning does
    /// not hold a writer permit. Memory-only stores do not support this native API.
    pub fn derived_snapshot(
        &self,
        control: &TransactionStartControl,
    ) -> Result<DerivedSnapshot, DerivedError> {
        let started = Instant::now();
        for _ in 0..3 {
            check(control, started)?;
            let before = self.backup_checkpoint()?.0;
            let reader = self.storage.snapshot();
            let after = self.backup_checkpoint()?.0;
            check(control, started)?;
            if before == after {
                return Ok(DerivedSnapshot {
                    reader,
                    checkpoint: before,
                });
            }
        }
        Err(DerivedError::SourceBusy)
    }
}

impl DerivedSnapshot {
    // Crate-private: do not make DerivedSnapshot Clone or let a restore
    // reconciler export the borrowed primary through a public reader API.
    #[cfg(any(feature = "text-index", feature = "spatial-index"))]
    pub(crate) fn index_query_reader(&self) -> StorageReader<'static> {
        self.reader.clone_for_index_query()
    }

    /// Checks an exact RDF quad in this retained primary snapshot, not in a
    /// newer Store view. Useful for derived-index candidate verification.
    pub fn contains(&self, quad: &crate::model::Quad) -> Result<bool, StorageError> {
        self.reader
            .contains(&crate::storage::numeric_encoder::EncodedQuad::from(quad))
    }

    pub const fn checkpoint(&self) -> &BackupCheckpoint {
        &self.checkpoint
    }

    /// A point-in-time strict check including ungoverned writes, not a lease
    /// preventing later writes. Consumers must query this snapshot or recheck.
    /// Physical-only maintenance may conservatively invalidate the token.
    pub fn check_current(&self, store: &Store) -> Result<(), DerivedError> {
        if self.checkpoint != store.backup_checkpoint()?.0 {
            return Err(DerivedError::NotFresh);
        }
        Ok(())
    }

    /// Streams an authoritative rebuild into an initially empty provider:
    /// named-graph declarations (including empty graphs), quads, then namespaces.
    /// No output receipt is returned if input, callback, limit or cancellation
    /// fails. The provider must discard its partial candidate on any error.
    pub fn scan(
        &self,
        limits: &DerivedLimits,
        mut visit: impl FnMut(&SemanticChange) -> Result<(), StorageError>,
    ) -> Result<DerivedScan, DerivedError> {
        let mut budget = InputBudget::new(limits);
        let mut hash = Sha256::new();
        hash.update(b"oxigraph.derived.scan.v1\0");
        budget.check()?;
        let mut emit = |change: SemanticChange| -> Result<(), DerivedError> {
            budget.change(&change)?;
            super::change_codec::emit(&change, &mut |bytes| hash.update(bytes));
            visit(&change)?;
            budget.check()?;
            Ok(())
        };
        for graph in self.reader.named_graphs() {
            emit(SemanticChange::NamedGraphCreated(
                self.reader.decode_named_or_blank_node(&graph?)?,
            ))?;
        }
        for quad in self.reader.quads_for_pattern(None, None, None, None) {
            emit(SemanticChange::QuadAdded(self.reader.decode_quad(&quad?)?))?;
        }
        // Preserve the exact typed input/callback error through the storage visitor.
        let mut failed = None;
        let namespaces = self.reader.visit_namespaces(&mut |namespace| {
            let result = emit(SemanticChange::NamespaceChanged {
                prefix: namespace.prefix().clone(),
                before: None,
                after: Some(namespace.iri().clone()),
            });
            if let Err(error) = result {
                failed = Some(error);
                return Err(StorageError::Other(
                    "derived namespace scan interrupted".into(),
                ));
            }
            Ok(())
        });
        if let Some(error) = failed {
            return Err(error);
        }
        namespaces?;
        budget.check()?;
        hash.update(budget.records.to_be_bytes());
        hash.update(budget.bytes.to_be_bytes());
        Ok(DerivedScan {
            checkpoint: self.checkpoint.clone(),
            records: budget.records,
            logical_bytes: budget.bytes,
            sha256: hash.finalize().into(),
        })
    }

    /// Reads a bounded complete-commit overlay from this same native snapshot.
    /// `None` means pre-outbox genesis and rejects a retention gap. Passing an
    /// applied checkpoint below retention also rejects; rebuild in that case.
    /// Later writes and retention cannot alter this already-captured view.
    pub fn delta(
        &self,
        applied: Option<&ContributorCheckpoint>,
        limits: &DerivedLimits,
    ) -> Result<DerivedDelta, DerivedError> {
        let mut budget = InputBudget::new(limits);
        budget.check()?;
        let floor = self
            .checkpoint
            .retained_after()
            .map_or(0, OutboxCursor::position);
        let high = self
            .checkpoint
            .outbox_high_water()
            .map_or(0, OutboxCursor::position);
        let mut after = applied.map(ContributorCheckpoint::cursor);
        let position = after.as_ref().map_or(0, OutboxCursor::position);
        if applied.is_some_and(|applied| {
            Some(applied.receipt().store_identity()) != self.checkpoint.store_identity()
        }) || position > high
        {
            return Err(DerivedError::InvalidCheckpoint);
        }
        if position < floor {
            return Err(OutboxReadError::CursorExpired {
                retained_after: self
                    .checkpoint
                    .retained_after()
                    .cloned()
                    .ok_or(DerivedError::InvalidCheckpoint)?,
            }
            .into());
        }
        if applied.is_none() {
            match self.checkpoint.outbox_after_receipt_sequence() {
                Some(0) => (),
                None if self.checkpoint.governed_sequence().unwrap_or(0) == 0 => (),
                _ => return Err(DerivedError::InvalidCheckpoint),
            }
        }
        if let Some(applied) = applied {
            // A receipt is a commit-end capability, not just a caller-chosen cursor.
            // Re-read its header in this snapshot unless it is the expired anchor.
            if position == floor && floor != 0 {
                if self.reader.retention_anchor()?.as_ref() != Some(applied.receipt()) {
                    return Err(DerivedError::InvalidCheckpoint);
                }
            } else {
                let header = applied
                    .receipt()
                    .outbox_header_cursor()
                    .ok_or(DerivedError::InvalidCheckpoint)?;
                let previous = (header.position() > 1).then(|| {
                    OutboxCursor::new(header.store_identity().clone(), header.position() - 1)
                });
                let page = self
                    .reader
                    .read_outbox(previous.as_ref(), NonZeroUsize::MIN)?;
                if !matches!(page.records().first(), Some(OutboxRecord::Commit { receipt, .. }) if receipt == applied.receipt())
                {
                    return Err(DerivedError::InvalidCheckpoint);
                }
            }
        }
        let mut commits = Vec::new();
        let mut pending: Option<DerivedCommit> = None;
        loop {
            budget.check()?;
            // A one-record page bounds decoded buffering independently of a
            // commit's size; accumulated overlay is checked before insertion.
            let page = self.reader.read_outbox(after.as_ref(), NonZeroUsize::MIN)?;
            if page.high_water() != self.checkpoint.outbox_high_water() {
                return Err(DerivedError::InvalidCheckpoint);
            }
            for record in page.records() {
                match record {
                    OutboxRecord::Commit { receipt, .. } => {
                        if pending.is_some() {
                            return Err(DerivedError::InvalidCheckpoint);
                        }
                        budget.record(receipt.encode().len() as u64)?;
                        pending = Some(DerivedCommit {
                            receipt: receipt.clone(),
                            changes: Vec::new(),
                        });
                    }
                    OutboxRecord::Event {
                        commit_id,
                        event_index,
                        change,
                        ..
                    } => {
                        let commit = pending.as_mut().ok_or(DerivedError::InvalidCheckpoint)?;
                        if commit_id != commit.receipt.commit_id()
                            || *event_index != commit.changes.len() as u64
                        {
                            return Err(DerivedError::InvalidCheckpoint);
                        }
                        budget.change(change)?;
                        commit.changes.push(change.clone());
                    }
                }
                if pending
                    .as_ref()
                    .is_some_and(|value| value.changes.len() as u64 == value.receipt.effect_count())
                {
                    let complete = pending.take().ok_or(DerivedError::InvalidCheckpoint)?;
                    let mut hash = Sha256::new();
                    hash.update(b"oxigraph.semantic-changes.v1\0");
                    hash.update(complete.receipt.effect_count().to_be_bytes());
                    for change in &complete.changes {
                        super::change_codec::emit(change, &mut |bytes| hash.update(bytes));
                    }
                    if <[u8; 32]>::from(hash.finalize()) != *complete.receipt.effects_checksum() {
                        return Err(DerivedError::InvalidCheckpoint);
                    }
                    commits.push(complete);
                }
            }
            if page.next_cursor() == page.high_water() {
                break;
            }
            if page.records().is_empty() || page.next_cursor() == after.as_ref() {
                return Err(DerivedError::InvalidCheckpoint);
            }
            after = page.next_cursor().cloned();
        }
        if pending.is_some() {
            return Err(DerivedError::InvalidCheckpoint);
        }
        budget.check()?;
        Ok(DerivedDelta {
            checkpoint: self.checkpoint.clone(),
            commits,
            records: budget.records,
            logical_bytes: budget.bytes,
        })
    }
}

struct InputBudget<'a> {
    limits: &'a DerivedLimits,
    started: Instant,
    records: u64,
    bytes: u64,
}
impl<'a> InputBudget<'a> {
    fn new(limits: &'a DerivedLimits) -> Self {
        Self {
            limits,
            started: Instant::now(),
            records: 0,
            bytes: 0,
        }
    }
    fn check(&self) -> Result<(), DerivedError> {
        check(&self.limits.control, self.started).map_err(Into::into)
    }
    fn record(&mut self, bytes: u64) -> Result<(), DerivedError> {
        self.check()?;
        self.records = self
            .records
            .checked_add(1)
            .filter(|count| *count <= self.limits.max_records.get())
            .ok_or(DerivedError::Limit)?;
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .filter(|count| *count <= self.limits.max_bytes.get())
            .ok_or(DerivedError::Limit)?;
        Ok(())
    }
    fn change(&mut self, change: &SemanticChange) -> Result<(), DerivedError> {
        let mut bytes = 0_u64;
        let mut overflow = false;
        super::change_codec::emit(
            change,
            &mut |part| match bytes.checked_add(part.len() as u64) {
                Some(value) => bytes = value,
                None => overflow = true,
            },
        );
        if overflow {
            return Err(DerivedError::Limit);
        }
        self.record(bytes)
    }
}
