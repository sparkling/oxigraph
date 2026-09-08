#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
#![expect(
    clippy::create_dir,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "native backup contract assertions"
)]
use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
use oxigraph::store::{
    BackupArtifact, BackupContribution, BackupError, BackupOptions, BackupReceipt, CommitReceipt,
    ContributorCheckpoint, ContributorConsistency, ContributorDeclaration, ContributorError,
    ContributorHealth, ContributorIdentity, ContributorObservation, ContributorRegistry,
    GovernanceTime, Namespace, NamespacePrefix, OutboxRetentionPolicy, Store, TransactionKey,
    TransactionRequest, TransactionStartControl, WritableDataset,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::num::{NonZeroU16, NonZeroU32, NonZeroU64, NonZeroUsize};
use std::sync::{Arc, Barrier};
use std::time::Duration;
type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn quad(n: u8) -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        Literal::from(i64::from(n)),
        GraphName::DefaultGraph,
    )
}
fn commit(store: &Store, n: u8) -> TestResult<CommitReceipt> {
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([n; 16]))?
        .into_transaction();
    tx.insert(quad(n))?;
    Ok(tx.commit()?)
}
fn verify(path: &std::path::Path) -> TestResult<BackupReceipt> {
    Ok(BackupReceipt::verify(
        path,
        &TransactionStartControl::new(),
    )?)
}

#[test]
fn ordinary_and_empty_stores_preserve_explicit_absence_without_source_mutation() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    for n in 0..2 {
        if n == 1 {
            source.insert(quad(1))?;
        }
        let destination = directory.path().join(format!("backup{n}"));
        let receipt = source.backup_with_receipt(&destination, &BackupOptions::default())?;
        assert_eq!(verify(&destination)?, receipt);
        assert_eq!(receipt.checkpoint().store_identity(), None);
        assert_eq!(receipt.checkpoint().governance_schema(), None);
        assert_eq!(receipt.checkpoint().latest_receipt(), None);
        assert_eq!(receipt.checkpoint().outbox_high_water(), None);
        assert_eq!(receipt.contents().quads(), n);
        assert_eq!(
            receipt.source_start().rocksdb_sequence(),
            receipt.source_end().rocksdb_sequence()
        );
        assert_eq!(
            receipt.checkpoint().rocksdb_sequence(),
            receipt.source_end().rocksdb_sequence()
        );
        for _ in 0..2 {
            let target = Store::open_read_only(destination.join("store"))?;
            target.validate()?;
            assert_eq!(target.len()? as u64, n);
            let nested = directory
                .path()
                .join(format!("nested{n}-{}", rand::random::<u64>()));
            let second = target.backup_with_receipt(&nested, &BackupOptions::default())?;
            assert_eq!(
                verify(&nested)?,
                second,
                "read-only source receipt: {second:?}"
            );
            assert_eq!(
                second.checkpoint().database_id(),
                receipt.checkpoint().database_id()
            );
            assert_eq!(second.contents(), receipt.contents());
        }
    }
    let health = source.governance_health(GovernanceTime::now()?, NonZeroUsize::MIN)?;
    assert!(health.store_identity().is_none());
    Ok(())
}

#[test]
fn receipt_binds_governed_and_plain_writes_topology_namespaces_and_survives_source_removal()
-> TestResult {
    let directory = tempfile::tempdir()?;
    let source_path = directory.path().join("source");
    let source = Store::open(&source_path)?;
    let last = commit(&source, 1)?;
    source.insert(quad(2))?;
    source.insert_named_graph(NamedNode::new("urn:empty")?)?;
    source.set_namespace(Namespace::new(
        NamespacePrefix::new("ex")?,
        NamedNode::new("urn:example:")?,
    ))?;
    let destination = directory.path().join("backup");
    let receipt = source.backup_with_receipt(&destination, &BackupOptions::default())?;
    assert_eq!(receipt.checkpoint().latest_receipt(), Some(&last));
    assert_eq!(
        receipt.checkpoint().outbox_high_water(),
        last.outbox_end_cursor().as_ref()
    );
    assert_eq!(receipt.checkpoint().governed_sequence(), Some(1));
    assert_eq!(receipt.contents().quads(), 2);
    assert_eq!(receipt.contents().named_graphs(), 1);
    assert_eq!(receipt.contents().namespaces(), 1);
    drop(source);
    fs::remove_dir_all(&source_path)?;
    assert_eq!(verify(&destination)?, receipt);
    let restored = Store::open_read_only(destination.join("store"))?;
    restored.validate()?;
    assert!(restored.contains(&quad(2))?);
    assert_eq!(
        restored.lookup_commit_receipt(last.transaction_key())?,
        oxigraph::store::CommitReceiptOutcome::Committed(last)
    );
    let second =
        restored.backup_with_receipt(directory.path().join("again"), &BackupOptions::default())?;
    assert_eq!(second.checkpoint(), receipt.checkpoint());
    assert_eq!(second.contents(), receipt.contents());
    Ok(())
}

#[test]
fn configured_retention_genesis_is_not_fabricated_as_a_commit() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    source.configure_outbox_retention(
        OutboxRetentionPolicy::new(NonZeroU64::new(100).ok_or("bound")?, NonZeroU16::MIN)?,
        GovernanceTime::now()?,
    )?;
    let destination = directory.path().join("backup");
    let receipt = source.backup_with_receipt(&destination, &BackupOptions::default())?;
    assert_eq!(receipt.checkpoint().governance_schema(), Some(3));
    assert!(receipt.checkpoint().store_identity().is_some());
    assert_eq!(receipt.checkpoint().governed_sequence(), Some(0));
    assert!(receipt.checkpoint().latest_receipt().is_none());
    assert_eq!(verify(&destination)?, receipt);
    Ok(())
}

fn contribution(
    source: &Store,
    path: &std::path::Path,
) -> TestResult<(ContributorRegistry, BackupContribution)> {
    let receipt = commit(source, 1)?;
    let point = ContributorCheckpoint::new(receipt)?;
    let id = ContributorIdentity::new([1; 16], NonZeroU32::MIN);
    let registry = ContributorRegistry::new(vec![ContributorDeclaration::new(
        id,
        true,
        ContributorConsistency::Strict,
        false,
    )])?;
    fs::write(path, b"frozen provider state")?;
    let artifact = BackupArtifact::new(
        "index.bin".into(),
        path.to_owned(),
        21,
        Sha256::digest(b"frozen provider state").into(),
    )?;
    let value = BackupContribution::new(
        ContributorObservation::new(
            id,
            Some(point.clone()),
            Some(point),
            ContributorHealth::Healthy,
        ),
        vec![artifact],
    )?;
    Ok((registry, value))
}

#[test]
fn frozen_contribution_is_bound_and_copied_not_linked() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    let artifact = directory.path().join("provider.bin");
    let (registry, contribution) = contribution(&source, &artifact)?;
    let checksum = contribution.fingerprint();
    let options = BackupOptions {
        contributors: registry,
        contributions: vec![contribution],
        ..BackupOptions::default()
    };
    let destination = directory.path().join("backup");
    let receipt = source.backup_with_receipt(&destination, &options)?;
    assert_eq!(receipt.contributions().len(), 1);
    assert_eq!(receipt.contributions()[0].1, checksum);
    fs::write(artifact, b"changed after backup")?;
    assert_eq!(verify(&destination)?, receipt);
    let file = receipt
        .files()
        .iter()
        .find(|file| file.path().ends_with("/index.bin"))
        .ok_or("provider file")?;
    assert_eq!(
        fs::read(destination.join(file.path()))?,
        b"frozen provider state"
    );
    Ok(())
}

#[test]
fn contributor_changes_and_missing_unknown_duplicate_or_stale_observations_do_not_complete()
-> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    let artifact = directory.path().join("provider.bin");
    let (registry, contribution) = contribution(&source, &artifact)?;
    let options = BackupOptions {
        contributors: registry.clone(),
        contributions: vec![contribution.clone()],
        ..BackupOptions::default()
    };
    fs::write(&artifact, b"modified provider now")?;
    let destination = directory.path().join("changed");
    assert!(matches!(
        source.backup_with_receipt(&destination, &options),
        Err(BackupError::FileMismatch)
    ));
    assert!(!destination.join(BackupReceipt::manifest_name()).exists());
    for (name, options) in [
        (
            "missing",
            BackupOptions {
                contributors: registry.clone(),
                ..BackupOptions::default()
            },
        ),
        (
            "unknown",
            BackupOptions {
                contributions: vec![contribution.clone()],
                ..BackupOptions::default()
            },
        ),
        (
            "duplicate",
            BackupOptions {
                contributors: registry,
                contributions: vec![contribution.clone(), contribution],
                ..BackupOptions::default()
            },
        ),
    ] {
        let destination = directory.path().join(name);
        assert!(matches!(
            source.backup_with_receipt(&destination, &options),
            Err(BackupError::Contributor(_))
        ));
        assert!(!destination.join(BackupReceipt::manifest_name()).exists());
    }
    commit(&source, 2)?;
    let destination = directory.path().join("stale");
    assert!(matches!(
        source.backup_with_receipt(&destination, &options),
        Err(BackupError::Contributor(ContributorError::SourceMismatch))
    ));
    assert!(!destination.join(BackupReceipt::manifest_name()).exists());
    Ok(())
}

#[test]
fn explicit_optional_fallback_has_inventory_but_no_invented_provider_files() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    let id = ContributorIdentity::new([1; 16], NonZeroU32::MIN);
    let options = BackupOptions {
        contributors: ContributorRegistry::new(vec![ContributorDeclaration::new(
            id,
            false,
            ContributorConsistency::Strict,
            true,
        )])?,
        ..BackupOptions::default()
    };
    let destination = directory.path().join("backup");
    let receipt = source.backup_with_receipt(&destination, &options)?;
    assert!(receipt.contributions().is_empty());
    assert!(receipt.contributor_inventory().len() > 3);
    assert_eq!(verify(&destination)?, receipt);
    Ok(())
}

#[test]
fn modified_missing_extra_and_nonregular_files_reject_before_database_open() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    commit(&source, 1)?;
    for variant in 0..6 {
        let destination = directory.path().join(format!("backup{variant}"));
        let receipt = source.backup_with_receipt(&destination, &BackupOptions::default())?;
        match variant {
            0 => {
                fs::write(destination.join("store/CURRENT"), b"changed")?;
            }
            1 => {
                fs::remove_file(destination.join("store/CURRENT"))?;
            }
            2 => {
                fs::write(destination.join("store/unexpected"), b"extra")?;
            }
            3 => {
                fs::remove_file(destination.join("store/CURRENT"))?;
                std::os::unix::fs::symlink(
                    directory.path().join("source/CURRENT"),
                    destination.join("store/CURRENT"),
                )?;
            }
            4 => {
                let path = destination.join(BackupReceipt::manifest_name());
                let mut bytes = fs::read(&path)?;
                bytes[25] ^= 1;
                fs::write(path, bytes)?;
            }
            _ => {
                fs::create_dir(destination.join("store/nested"))?;
            }
        }
        assert!(
            BackupReceipt::verify(&destination, &TransactionStartControl::new()).is_err(),
            "variant {variant}"
        );
        assert!(receipt.contents().quads() > 0);
    }
    Ok(())
}

#[test]
fn existing_nested_alias_cancelled_and_limited_destinations_never_replace_data() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source_path = directory.path().join("source");
    let source = Store::open(&source_path)?;
    let existing = directory.path().join("existing");
    fs::create_dir(&existing)?;
    fs::write(existing.join("valuable"), b"keep")?;
    for path in [&existing, &source_path.join("backup")] {
        assert!(matches!(
            source.backup_with_receipt(path, &BackupOptions::default()),
            Err(BackupError::InvalidPath)
        ));
    }
    let alias = directory.path().join("alias");
    std::os::unix::fs::symlink(&source_path, &alias)?;
    assert!(matches!(
        source.backup_with_receipt(alias.join("backup"), &BackupOptions::default()),
        Err(BackupError::InvalidPath)
    ));
    let control = TransactionStartControl::new();
    control.cancel();
    let cancelled = directory.path().join("cancelled");
    assert!(matches!(
        source.backup_with_receipt(
            &cancelled,
            &BackupOptions {
                control,
                ..BackupOptions::default()
            }
        ),
        Err(BackupError::Cancelled)
    ));
    assert!(!cancelled.exists());
    let timed = directory.path().join("timed");
    assert!(matches!(
        source.backup_with_receipt(
            &timed,
            &BackupOptions {
                control: TransactionStartControl::new().with_timeout(Duration::ZERO),
                ..BackupOptions::default()
            }
        ),
        Err(BackupError::TimedOut)
    ));
    let limited = directory.path().join("limited");
    source
        .backup_with_receipt(
            &limited,
            &BackupOptions {
                max_bytes: NonZeroU64::MIN,
                ..BackupOptions::default()
            },
        )
        .err()
        .ok_or("limited backup unexpectedly completed")?;
    assert!(!limited.join(BackupReceipt::manifest_name()).exists());
    assert_eq!(fs::read(existing.join("valuable"))?, b"keep");
    assert!(matches!(
        Store::new()?
            .backup_with_receipt(directory.path().join("memory"), &BackupOptions::default()),
        Err(BackupError::Unsupported)
    ));
    Ok(())
}

#[test]
fn concurrent_writes_and_compaction_leave_one_self_consistent_checkpoint() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    commit(&source, 1)?;
    let barrier = Arc::new(Barrier::new(3));
    std::thread::scope(|scope| -> TestResult {
        let writer = source.clone();
        let writer_barrier = Arc::clone(&barrier);
        let writes = scope.spawn(move || -> TestResult {
            writer_barrier.wait();
            for n in 2..40 {
                commit(&writer, n)?;
            }
            Ok(())
        });
        let compactor = source.clone();
        let compact_barrier = Arc::clone(&barrier);
        let compact = scope.spawn(move || -> TestResult {
            compact_barrier.wait();
            compactor.optimize()?;
            Ok(())
        });
        barrier.wait();
        let destination = directory.path().join("backup");
        let receipt = source.backup_with_receipt(&destination, &BackupOptions::default())?;
        writes.join().map_err(|_| "writer panicked")??;
        compact.join().map_err(|_| "compactor panicked")??;
        assert_eq!(verify(&destination)?, receipt);
        let target = Store::open_read_only(destination.join("store"))?;
        target.validate()?;
        let last = target.governance_health(GovernanceTime::now()?, NonZeroUsize::MIN)?;
        assert_eq!(last.latest_receipt(), receipt.checkpoint().latest_receipt());
        assert_eq!(target.len()? as u64, receipt.contents().quads());
        assert!(
            receipt.source_start().rocksdb_sequence() <= receipt.checkpoint().rocksdb_sequence()
        );
        assert!(receipt.checkpoint().rocksdb_sequence() <= receipt.source_end().rocksdb_sequence());
        Ok(())
    })
}
