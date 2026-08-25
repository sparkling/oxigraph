#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public transaction capability contract"
)]

use oxigraph::model::{NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::store::{
    CancellationGuarantee, ConflictBehavior, NegotiatedTransactionalDataset,
    OutcomeAwareWritableDataset, OutcomeLookup, RollbackGuarantee, Store, TransactionCapabilities,
    TransactionCommitError, TransactionKey, TransactionRequest, TransactionRequirements,
    TransactionRollbackError, TransactionStartError, TransactionalDataset,
    UnmetTransactionRequirement, WritableDataset, WriterIsolation,
};
use std::cell::Cell;
use std::error::Error;
use std::fmt;

#[derive(Debug)]
struct ProbeError(&'static str);

impl fmt::Display for ProbeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

impl Error for ProbeError {}

struct ProbeDataset {
    capabilities: TransactionCapabilities,
    opens: Cell<usize>,
}

impl ProbeDataset {
    fn new(capabilities: TransactionCapabilities) -> Self {
        Self {
            capabilities,
            opens: Cell::new(0),
        }
    }
}

struct ProbeTransaction;

impl TransactionalDataset for ProbeDataset {
    type Error = ProbeError;
    type Transaction<'a> = ProbeTransaction;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        self.opens.set(self.opens.get() + 1);
        Ok(ProbeTransaction)
    }
}

impl NegotiatedTransactionalDataset for ProbeDataset {
    fn transaction_capabilities(&self) -> TransactionCapabilities {
        self.capabilities.clone()
    }
}

impl WritableDataset for ProbeTransaction {
    type Error = ProbeError;
    type Quads<'a>
        = std::iter::Empty<Result<Quad, ProbeError>>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = std::iter::Empty<Result<NamedOrBlankNode, ProbeError>>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        _subject: Option<&NamedOrBlankNode>,
        _predicate: Option<&NamedNode>,
        _object: Option<&Term>,
        _graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        std::iter::empty()
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        std::iter::empty()
    }

    fn contains_named_graph(&self, _graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        Ok(false)
    }

    fn insert(&mut self, _quad: Quad) -> Result<(), Self::Error> {
        Ok(())
    }

    fn remove(&mut self, _quad: &Quad) -> Result<(), Self::Error> {
        Ok(())
    }

    fn insert_named_graph(&mut self, _graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        Ok(())
    }

    fn clear_graph(&mut self, _graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        Ok(())
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }

    fn remove_named_graph(&mut self, _graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        Ok(())
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }

    fn commit(self) -> Result<(), Self::Error> {
        Ok(())
    }

    fn rollback(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl OutcomeAwareWritableDataset for ProbeTransaction {
    fn commit_with_outcome(self) -> Result<(), TransactionCommitError<Self::Error>> {
        Ok(())
    }

    fn rollback_with_outcome(self) -> Result<(), TransactionRollbackError<Self::Error>> {
        Ok(())
    }
}

fn serialized_profile() -> TransactionCapabilities {
    TransactionCapabilities::none()
        .with_atomic_publication()
        .with_read_your_writes()
        .with_writer_isolation(WriterIsolation::Serialized)
        .with_conflict_behavior(ConflictBehavior::PreventedByWriterSerialization)
        .with_rollback(RollbackGuarantee::ExplicitOrDropBeforeCommit)
}

#[test]
fn default_request_preserves_the_legacy_minimum_and_returns_the_effective_profile()
-> Result<(), Box<dyn Error>> {
    let advertised = serialized_profile();
    let dataset = ProbeDataset::new(advertised.clone());
    let request = TransactionRequest::default();
    assert_eq!(request.requirements(), &TransactionRequirements::legacy());

    let started = dataset.start_transaction_with(request)?;
    assert_eq!(started.effective_capabilities(), &advertised);
    assert_eq!(
        started.effective_capabilities().writer_isolation(),
        WriterIsolation::Serialized
    );
    assert_eq!(dataset.opens.get(), 1);
    started.into_transaction().rollback()?;
    Ok(())
}

#[test]
fn unmet_dimensions_are_reported_before_a_backend_transaction_is_opened() {
    let advertised = serialized_profile();
    let dataset = ProbeDataset::new(advertised.clone());
    let requirements = TransactionRequirements::legacy()
        .requiring_conflict_behavior(ConflictBehavior::DetectedAndRejected)
        .requiring_cancellation(CancellationGuarantee::BeforeCommitAttempt);

    let Err(error) = dataset.start_transaction_with(TransactionRequest::new(requirements)) else {
        panic!("an unsupported minimum was silently weakened")
    };
    let TransactionStartError::RequirementsNotMet { unmet, effective } = error else {
        panic!("an unsupported minimum reached the backend")
    };
    assert_eq!(
        unmet,
        vec![
            UnmetTransactionRequirement::ConflictBehavior,
            UnmetTransactionRequirement::Cancellation,
        ]
    );
    assert_eq!(effective, advertised);
    assert_eq!(dataset.opens.get(), 0);
}

#[test]
fn serial_writer_prevention_does_not_claim_conflict_notification() {
    let capabilities = serialized_profile();
    assert_eq!(capabilities.writer_isolation(), WriterIsolation::Serialized);
    assert_eq!(
        capabilities.conflict_behavior(),
        ConflictBehavior::PreventedByWriterSerialization
    );
    assert_eq!(
        capabilities.unmet_requirements(
            &TransactionRequirements::legacy()
                .requiring_conflict_behavior(ConflictBehavior::DetectedAndRejected)
        ),
        vec![UnmetTransactionRequirement::ConflictBehavior]
    );
}

#[test]
fn memory_store_advertises_only_its_proven_effective_profile() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let capabilities = store.transaction_capabilities();
    assert_eq!(capabilities, serialized_profile());
    assert!(capabilities.atomic_publication());
    assert!(capabilities.read_your_writes());
    assert_eq!(
        capabilities.cancellation(),
        CancellationGuarantee::Unsupported
    );
    assert_eq!(capabilities.outcome_lookup(), OutcomeLookup::Unsupported);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_capabilities_are_derived_from_the_open_store_instance() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let read_write = Store::open(directory.path())?;
    assert_eq!(read_write.transaction_capabilities(), serialized_profile());
    drop(read_write);

    let read_only = Store::open_read_only(directory.path())?;
    assert_eq!(
        read_only.transaction_capabilities(),
        TransactionCapabilities::none()
    );
    let Err(TransactionStartError::RequirementsNotMet { unmet, effective }) =
        read_only.start_transaction_with(TransactionRequest::default())
    else {
        panic!("a read-only instance accepted a write request")
    };
    assert!(unmet.contains(&UnmetTransactionRequirement::AtomicPublication));
    assert!(unmet.contains(&UnmetTransactionRequirement::ReadYourWrites));
    assert!(unmet.contains(&UnmetTransactionRequirement::Rollback));
    assert_eq!(effective, TransactionCapabilities::none());
    Ok(())
}

#[test]
fn typed_commit_outcomes_separate_safe_non_commit_from_indeterminate_commit() {
    let rejected = TransactionCommitError::Rejected(ProbeError("write was not attempted"));
    assert_eq!(
        Error::source(&rejected).map(ToString::to_string),
        Some("write was not attempted".into())
    );

    let conflicted: TransactionCommitError<ProbeError> = TransactionCommitError::Conflicted;
    assert!(Error::source(&conflicted).is_none());

    let cancelled: TransactionCommitError<ProbeError> = TransactionCommitError::Cancelled;
    assert!(Error::source(&cancelled).is_none());

    let expected_key = TransactionKey::new([0xA5; 16]);
    let indeterminate = TransactionCommitError::Indeterminate {
        transaction_key: expected_key.clone(),
        source: ProbeError("commit acknowledgement was lost"),
    };
    let TransactionCommitError::Indeterminate {
        transaction_key,
        source,
    } = indeterminate
    else {
        unreachable!()
    };
    assert_eq!(transaction_key, expected_key);
    assert_eq!(source.to_string(), "commit acknowledgement was lost");
}

#[test]
fn typed_extensions_preserve_backend_error_sources() {
    let start = TransactionStartError::Backend(ProbeError("open failed"));
    assert_eq!(
        Error::source(&start).map(ToString::to_string),
        Some("open failed".into())
    );

    let rollback = TransactionRollbackError::Failed(ProbeError("rollback failed"));
    assert_eq!(
        Error::source(&rollback).map(ToString::to_string),
        Some("rollback failed".into())
    );

    OutcomeAwareWritableDataset::commit_with_outcome(ProbeTransaction)
        .expect("the typed extension remains independently implementable");
    OutcomeAwareWritableDataset::rollback_with_outcome(ProbeTransaction)
        .expect("the typed extension remains independently implementable");
}
