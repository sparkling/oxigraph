#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public keyed transaction-outcome contract"
)]

use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{
    OutcomeAwareTransactionalDataset, OutcomeAwareWritableDataset, OutcomeLookup, Store,
    TransactionKey, TransactionNonCommitReason, TransactionOutcome, TransactionRequest,
    TransactionRequirements, TransactionStartError, WritableDataset,
};
use std::error::Error;

fn key(byte: u8) -> TransactionKey {
    TransactionKey::new([byte; 16])
}

fn quad(label: &str) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:oxigraph:g14a:subject:{label}")),
        NamedNode::new_unchecked("urn:oxigraph:g14a:predicate"),
        NamedNode::new_unchecked("urn:oxigraph:g14a:object"),
        GraphName::DefaultGraph,
    )
}

#[test]
fn transaction_key_and_terminal_outcomes_have_a_stable_public_shape() {
    let expected = [0xA5; 16];
    let transaction_key = TransactionKey::new(expected);
    assert_eq!(transaction_key.as_bytes(), &expected);
    assert_eq!(transaction_key.clone().into_bytes(), expected);

    assert_eq!(TransactionOutcome::Committed, TransactionOutcome::Committed);
    assert_eq!(
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack),
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert_eq!(
        format!("{:?}", TransactionNonCommitReason::Rejected),
        "Rejected"
    );
    assert_eq!(
        format!("{:?}", TransactionNonCommitReason::Conflicted),
        "Conflicted"
    );
    assert_eq!(
        format!("{:?}", TransactionNonCommitReason::Cancelled),
        "Cancelled"
    );
    assert_eq!(
        format!("{:?}", TransactionOutcome::Indeterminate),
        "Indeterminate"
    );
}

#[test]
fn memory_uses_the_terminal_state_oracle_without_claiming_durability() -> Result<(), Box<dyn Error>>
{
    let store = Store::new()?;
    assert_eq!(
        store.transaction_capabilities().outcome_lookup(),
        OutcomeLookup::Unsupported
    );

    let committed_key = key(0x11);
    let committed_quad = quad("memory-committed");
    let mut transaction = store
        .start_transaction_with_key(TransactionRequest::default(), committed_key.clone())?
        .into_transaction();
    transaction.insert(committed_quad.clone());
    OutcomeAwareWritableDataset::commit_with_outcome(transaction)?;
    assert_eq!(
        store.lookup_transaction_outcome(&committed_key)?,
        TransactionOutcome::Committed
    );
    assert!(store.contains(&committed_quad)?);

    let rolled_back_key = key(0x12);
    let rolled_back_quad = quad("memory-rolled-back");
    let mut transaction = store
        .start_transaction_with_key(TransactionRequest::default(), rolled_back_key.clone())?
        .into_transaction();
    transaction.insert(rolled_back_quad.clone());
    OutcomeAwareWritableDataset::rollback_with_outcome(transaction)?;
    assert_eq!(
        store.lookup_transaction_outcome(&rolled_back_key)?,
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert!(!store.contains(&rolled_back_quad)?);

    let dropped_key = key(0x13);
    let dropped_quad = quad("memory-dropped");
    let mut transaction = store
        .start_transaction_with_key(TransactionRequest::default(), dropped_key.clone())?
        .into_transaction();
    transaction.insert(dropped_quad.clone());
    drop(transaction);
    assert_eq!(
        store.lookup_transaction_outcome(&dropped_key)?,
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert!(!store.contains(&dropped_quad)?);

    assert_eq!(
        store.lookup_transaction_outcome(&key(0x14))?,
        TransactionOutcome::Indeterminate
    );
    Ok(())
}

#[test]
fn a_durable_requirement_is_rejected_before_memory_reserves_the_key() -> Result<(), Box<dyn Error>>
{
    let store = Store::new()?;
    let transaction_key = key(0x21);
    let request = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
    );
    let outcome = store.start_transaction_with_key(request, transaction_key.clone());
    let error = outcome
        .err()
        .ok_or("memory silently accepted durable outcome lookup")?;
    let TransactionStartError::RequirementsNotMet { .. } = error else {
        return Err("memory returned an unexpected transaction start error".into());
    };
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Indeterminate
    );
    Ok(())
}

#[test]
fn the_legacy_unkeyed_transaction_path_remains_source_compatible() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let expected = quad("legacy");
    let mut transaction = store.start_transaction()?;
    transaction.insert(expected.clone());
    transaction.commit()?;
    assert!(store.contains(&expected)?);

    let transaction = store.start_transaction()?;
    WritableDataset::rollback(transaction)?;
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_commit_and_non_commit_outcomes_survive_reopen() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let committed_key = key(0x31);
    let rolled_back_key = key(0x32);
    let dropped_key = key(0x33);
    let committed_quad = quad("rocksdb-committed");
    let rolled_back_quad = quad("rocksdb-rolled-back");
    let dropped_quad = quad("rocksdb-dropped");

    {
        let store = Store::open(directory.path())?;
        assert_eq!(
            store.transaction_capabilities().outcome_lookup(),
            OutcomeLookup::DurableByTransactionKey
        );

        let durable_request = TransactionRequest::new(
            TransactionRequirements::legacy()
                .requiring_outcome_lookup(OutcomeLookup::DurableByTransactionKey),
        );
        let mut transaction = store
            .start_transaction_with_key(durable_request, committed_key.clone())?
            .into_transaction();
        transaction.insert(committed_quad.clone());
        OutcomeAwareWritableDataset::commit_with_outcome(transaction)?;

        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), rolled_back_key.clone())?
            .into_transaction();
        transaction.insert(rolled_back_quad.clone());
        OutcomeAwareWritableDataset::rollback_with_outcome(transaction)?;

        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), dropped_key.clone())?
            .into_transaction();
        transaction.insert(dropped_quad.clone());
        drop(transaction);
    }

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&committed_key)?,
        TransactionOutcome::Committed
    );
    assert_eq!(
        store.lookup_transaction_outcome(&rolled_back_key)?,
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert_eq!(
        store.lookup_transaction_outcome(&dropped_key)?,
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert_eq!(
        store.lookup_transaction_outcome(&key(0x34))?,
        TransactionOutcome::Indeterminate
    );
    assert!(store.contains(&committed_quad)?);
    assert!(!store.contains(&rolled_back_quad)?);
    assert!(!store.contains(&dropped_quad)?);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn a_terminal_transaction_key_cannot_publish_a_second_effect() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    let transaction_key = key(0x41);
    let first = quad("first-effect");
    let second = quad("second-effect");

    let mut transaction = store
        .start_transaction_with_key(TransactionRequest::default(), transaction_key.clone())?
        .into_transaction();
    transaction.insert(first.clone());
    OutcomeAwareWritableDataset::commit_with_outcome(transaction)?;

    let reused =
        store.start_transaction_with_key(TransactionRequest::default(), transaction_key.clone());
    assert!(reused.is_err(), "a terminal key entered a second attempt");
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Committed
    );
    assert!(store.contains(&first)?);
    assert!(!store.contains(&second)?);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn a_committed_outcome_is_resolved_after_the_acknowledging_process_is_lost()
-> Result<(), Box<dyn Error>> {
    const CHILD_DIRECTORY: &str = "OXIGRAPH_G14A_LOST_ACK_DIRECTORY";
    let transaction_key = key(0x51);
    let expected = quad("lost-ack");

    if let Some(directory) = std::env::var_os(CHILD_DIRECTORY) {
        let store = Store::open(directory)?;
        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), transaction_key)?
            .into_transaction();
        transaction.insert(expected);
        OutcomeAwareWritableDataset::commit_with_outcome(transaction)?;
        std::process::abort();
    }

    let directory = tempfile::tempdir()?;
    drop(Store::open(directory.path())?);
    let status = std::process::Command::new(std::env::current_exe()?)
        .arg("--exact")
        .arg("a_committed_outcome_is_resolved_after_the_acknowledging_process_is_lost")
        .arg("--nocapture")
        .env(CHILD_DIRECTORY, directory.path())
        .status()?;
    assert!(
        !status.success(),
        "the lost-ack child unexpectedly returned"
    );

    let store = Store::open(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Committed
    );
    assert!(store.contains(&expected)?);
    Ok(())
}
