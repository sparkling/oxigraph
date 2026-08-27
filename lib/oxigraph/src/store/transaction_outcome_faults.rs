//! Evaluator for transaction-outcome storage-call fault safety.

use super::{
    OutcomeAwareTransactionalDataset, StorageError, Store, TransactionCommitError, TransactionKey,
    TransactionOutcome, TransactionRequest, TransactionStartError,
};
use crate::model::{GraphName, NamedNode, Quad};
use crate::storage::TransactionOutcomeFaultPoint;
use std::error::Error;

type TestResult = Result<(), Box<dyn Error>>;

fn key(byte: u8) -> TransactionKey {
    TransactionKey::new([byte; 16])
}

fn quad(label: &str) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:oxigraph:g14b:subject:{label}")),
        NamedNode::new_unchecked("urn:oxigraph:g14b:predicate"),
        NamedNode::new_unchecked("urn:oxigraph:g14b:object"),
        GraphName::DefaultGraph,
    )
}

fn expect_indeterminate_commit(
    result: Result<(), TransactionCommitError<StorageError>>,
    expected_key: &TransactionKey,
) -> StorageError {
    match result {
        Err(TransactionCommitError::Indeterminate {
            transaction_key,
            source,
        }) => {
            assert_eq!(&transaction_key, expected_key);
            source
        }
        other => panic!("faulted commit did not return a typed indeterminate result: {other:?}"),
    }
}

#[test]
fn malformed_ledger_records_are_corruption() -> TestResult {
    let directory = tempfile::tempdir()?;
    let transaction_key = key(0x01);
    {
        let store = Store::open(directory.path())?;
        store
            .storage()
            .write_raw_transaction_outcome_record(transaction_key.as_bytes(), b"malformed")?;
        assert!(matches!(
            store.lookup_transaction_outcome(&transaction_key),
            Err(StorageError::Corruption(_))
        ));
    }

    let store = Store::open_read_only(directory.path())?;
    assert!(matches!(
        store.lookup_transaction_outcome(&transaction_key),
        Err(StorageError::Corruption(_))
    ));
    Ok(())
}

#[test]
fn staging_pre_and_post_write_failures_remain_honest() -> TestResult {
    let directory = tempfile::tempdir()?;
    let pre_write_key = key(0x11);
    let post_write_key = key(0x12);
    {
        let store = Store::open(directory.path())?;
        store
            .storage()
            .arm_transaction_outcome_fault(TransactionOutcomeFaultPoint::StagingBefore)?;
        assert!(matches!(
            store.start_transaction_with_key(TransactionRequest::default(), pre_write_key.clone()),
            Err(TransactionStartError::Backend(_))
        ));
        assert_eq!(
            store.storage().transaction_outcome_fault_events()?,
            vec![TransactionOutcomeFaultPoint::StagingBefore]
        );
        assert_eq!(
            store.lookup_transaction_outcome(&pre_write_key)?,
            TransactionOutcome::Indeterminate
        );

        store
            .storage()
            .arm_transaction_outcome_fault(TransactionOutcomeFaultPoint::StagingAfter)?;
        assert!(matches!(
            store.start_transaction_with_key(TransactionRequest::default(), post_write_key.clone()),
            Err(TransactionStartError::Backend(_))
        ));
        assert_eq!(
            store.storage().transaction_outcome_fault_events()?,
            vec![
                TransactionOutcomeFaultPoint::StagingBefore,
                TransactionOutcomeFaultPoint::StagingAfter,
            ]
        );
        assert_eq!(
            store.lookup_transaction_outcome(&post_write_key)?,
            TransactionOutcome::Indeterminate
        );
    }

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&pre_write_key)?,
        TransactionOutcome::Indeterminate
    );
    assert_eq!(
        store.lookup_transaction_outcome(&post_write_key)?,
        TransactionOutcome::Indeterminate
    );
    Ok(())
}

#[test]
fn commit_attempted_prewrite_failure_cannot_be_rolled_back() -> TestResult {
    let directory = tempfile::tempdir()?;
    let transaction_key = key(0x21);
    let expected = quad("commit-attempted-before");
    {
        let store = Store::open(directory.path())?;
        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), transaction_key.clone())?
            .into_transaction();
        transaction.insert(expected.clone());
        store
            .storage()
            .arm_transaction_outcome_fault(TransactionOutcomeFaultPoint::CommitAttemptedBefore)?;
        let source = expect_indeterminate_commit(transaction.commit(), &transaction_key);
        assert!(source.to_string().contains("CommitAttemptedBefore"));
        assert_eq!(
            store.lookup_transaction_outcome(&transaction_key)?,
            TransactionOutcome::Indeterminate,
            "commit-attempted pre-write failure was falsely proven rolled back"
        );
        assert_eq!(
            store.storage().transaction_outcome_fault_events()?,
            vec![TransactionOutcomeFaultPoint::CommitAttemptedBefore]
        );
        assert!(!store.contains(&expected)?);
    }

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Indeterminate
    );
    assert!(!store.contains(&expected)?);
    Ok(())
}

#[test]
fn commit_attempted_postwrite_error_cannot_be_rolled_back() -> TestResult {
    let directory = tempfile::tempdir()?;
    let transaction_key = key(0x22);
    let expected = quad("commit-attempted-after");
    {
        let store = Store::open(directory.path())?;
        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), transaction_key.clone())?
            .into_transaction();
        transaction.insert(expected.clone());
        store
            .storage()
            .arm_transaction_outcome_fault(TransactionOutcomeFaultPoint::CommitAttemptedAfter)?;
        let source = expect_indeterminate_commit(transaction.commit(), &transaction_key);
        assert!(source.to_string().contains("CommitAttemptedAfter"));
        assert_eq!(
            store.lookup_transaction_outcome(&transaction_key)?,
            TransactionOutcome::Indeterminate,
            "commit-attempted post-write error was falsely proven rolled back"
        );
        assert_eq!(
            store.storage().transaction_outcome_fault_events()?,
            vec![
                TransactionOutcomeFaultPoint::CommitAttemptedBefore,
                TransactionOutcomeFaultPoint::CommitAttemptedAfter,
            ]
        );
        assert!(!store.contains(&expected)?);
    }

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Indeterminate
    );
    assert!(!store.contains(&expected)?);
    Ok(())
}

#[test]
fn final_batch_prewrite_failure_is_indeterminate_without_effect() -> TestResult {
    let directory = tempfile::tempdir()?;
    let transaction_key = key(0x31);
    let expected = quad("final-batch-before");
    {
        let store = Store::open(directory.path())?;
        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), transaction_key.clone())?
            .into_transaction();
        transaction.insert(expected.clone());
        store
            .storage()
            .arm_transaction_outcome_fault(TransactionOutcomeFaultPoint::FinalBatchBefore)?;
        let source = expect_indeterminate_commit(transaction.commit(), &transaction_key);
        assert!(source.to_string().contains("FinalBatchBefore"));
        assert_eq!(
            store.lookup_transaction_outcome(&transaction_key)?,
            TransactionOutcome::Indeterminate
        );
        assert!(!store.contains(&expected)?);
        assert_eq!(
            store.storage().transaction_outcome_fault_events()?,
            vec![
                TransactionOutcomeFaultPoint::CommitAttemptedBefore,
                TransactionOutcomeFaultPoint::CommitAttemptedAfter,
                TransactionOutcomeFaultPoint::FinalBatchBefore,
            ]
        );
    }

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Indeterminate
    );
    assert!(!store.contains(&expected)?);
    Ok(())
}

#[test]
fn final_batch_postwrite_error_resolves_committed_with_effect() -> TestResult {
    let directory = tempfile::tempdir()?;
    let transaction_key = key(0x32);
    let expected = quad("final-batch-after");
    {
        let store = Store::open(directory.path())?;
        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), transaction_key.clone())?
            .into_transaction();
        transaction.insert(expected.clone());
        store
            .storage()
            .arm_transaction_outcome_fault(TransactionOutcomeFaultPoint::FinalBatchAfter)?;
        let source = expect_indeterminate_commit(transaction.commit(), &transaction_key);
        assert!(source.to_string().contains("FinalBatchAfter"));
        assert_eq!(
            store.lookup_transaction_outcome(&transaction_key)?,
            TransactionOutcome::Committed
        );
        assert!(store.contains(&expected)?);
        assert_eq!(
            store.storage().transaction_outcome_fault_events()?,
            vec![
                TransactionOutcomeFaultPoint::CommitAttemptedBefore,
                TransactionOutcomeFaultPoint::CommitAttemptedAfter,
                TransactionOutcomeFaultPoint::FinalBatchBefore,
                TransactionOutcomeFaultPoint::FinalBatchAfter,
            ]
        );
    }

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Committed
    );
    assert!(store.contains(&expected)?);
    Ok(())
}

#[test]
fn drop_rollback_write_failure_never_proves_absence() -> TestResult {
    let directory = tempfile::tempdir()?;
    let transaction_key = key(0x41);
    let expected = quad("drop-rollback-before");
    {
        let store = Store::open(directory.path())?;
        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), transaction_key.clone())?
            .into_transaction();
        transaction.insert(expected.clone());
        store
            .storage()
            .arm_transaction_outcome_fault(TransactionOutcomeFaultPoint::RolledBackBefore)?;
        drop(transaction);
        assert_eq!(
            store.lookup_transaction_outcome(&transaction_key)?,
            TransactionOutcome::Indeterminate
        );
        assert!(!store.contains(&expected)?);
        assert_eq!(
            store.storage().transaction_outcome_fault_events()?,
            vec![TransactionOutcomeFaultPoint::RolledBackBefore]
        );
    }

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Indeterminate
    );
    assert!(!store.contains(&expected)?);
    Ok(())
}

#[test]
fn successful_commit_emits_one_attempt_and_one_atomic_final_batch() -> TestResult {
    let directory = tempfile::tempdir()?;
    let transaction_key = key(0x51);
    let expected = quad("success");
    {
        let store = Store::open(directory.path())?;
        let mut transaction = store
            .start_transaction_with_key(TransactionRequest::default(), transaction_key.clone())?
            .into_transaction();
        transaction.insert(expected.clone());
        transaction.commit()?;
        assert_eq!(
            store.lookup_transaction_outcome(&transaction_key)?,
            TransactionOutcome::Committed
        );
        assert!(store.contains(&expected)?);
        assert_eq!(
            store.storage().transaction_outcome_fault_events()?,
            vec![
                TransactionOutcomeFaultPoint::StagingBefore,
                TransactionOutcomeFaultPoint::StagingAfter,
                TransactionOutcomeFaultPoint::CommitAttemptedBefore,
                TransactionOutcomeFaultPoint::CommitAttemptedAfter,
                TransactionOutcomeFaultPoint::FinalBatchBefore,
                TransactionOutcomeFaultPoint::FinalBatchAfter,
            ]
        );
    }

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&transaction_key)?,
        TransactionOutcome::Committed
    );
    assert!(store.contains(&expected)?);
    Ok(())
}
