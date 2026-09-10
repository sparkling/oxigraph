#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "native restore contract fixtures"
)]
use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
use oxigraph::store::{
    BackupArtifact, BackupContribution, BackupOptions, BackupReceipt, CommitReceipt,
    CommitReceiptOutcome, ContributorCheckpoint, ContributorConsistency, ContributorDeclaration,
    ContributorHealth, ContributorIdentity, ContributorObservation, ContributorRegistry,
    GovernanceTime, Namespace, NamespacePrefix, OutboxRetentionPolicy, RecoveryBaseline,
    RestoreContributor, RestoreError, RestoreOptions, RestorePrimary, RestoreReceipt, StorageError,
    Store, TransactionKey, TransactionRequest, TransactionStartControl, WritableDataset,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::num::{NonZeroU16, NonZeroU32, NonZeroU64, NonZeroUsize};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

fn quad(n: u8) -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        Literal::from(i64::from(n)),
        GraphName::DefaultGraph,
    )
}
fn commit(store: &Store, n: u8) -> Result<CommitReceipt, Box<dyn std::error::Error + Send + Sync>> {
    let mut transaction = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([n; 16]))?
        .into_transaction();
    transaction.insert(quad(n))?;
    Ok(transaction.commit()?)
}

#[test]
fn fresh_restore_survives_source_removal_and_writable_query_rollback_restart() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source_path = directory.path().join("source");
    let source = Store::open(&source_path)?;
    let last = commit(&source, 1)?;
    source.insert(quad(2))?;
    source.insert_named_graph(NamedNode::new("urn:empty")?)?;
    let namespace = Namespace::new(NamespacePrefix::new("ex")?, NamedNode::new("urn:example:")?);
    source.set_namespace(namespace.clone())?;
    let package = directory.path().join("backup");
    let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
    drop(source);
    fs::remove_dir_all(&source_path)?;
    let target = directory.path().join("restore");
    let restored = Store::restore_backup(&package, &target, &RestoreOptions::default())?;
    assert_eq!(restored.backup(), &backup);
    assert_eq!(restored.validated_outbox_records(), 2);
    assert!(restored.baseline().is_none());
    assert_eq!(RestoreReceipt::read(&target)?, restored);
    assert_eq!(
        BackupReceipt::verify(&package, &TransactionStartControl::new())?,
        backup
    );
    assert!(!target.join(BackupReceipt::manifest_name()).exists());
    let store_path = target.join(RestoreReceipt::store_directory());
    {
        let store = Store::open(&store_path)?;
        store.validate()?;
        assert_eq!(store.len()?, 2);
        assert_eq!(
            store.namespaces().collect::<Result<Vec<_>, _>>()?,
            vec![namespace]
        );
        assert!(store.contains_named_graph(&NamedNode::new("urn:empty")?.into())?);
        assert_eq!(
            store.lookup_commit_receipt(last.transaction_key())?,
            CommitReceiptOutcome::Committed(last)
        );
        let mut transaction = store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([9; 16]),
            )?
            .into_transaction();
        transaction.insert(quad(9))?;
        transaction.rollback()?;
        assert!(!store.contains(&quad(9))?);
        commit(&store, 3)?;
    }
    let reopened = Store::open_read_only(store_path)?;
    assert_eq!(reopened.len()?, 3);
    assert!(reopened.contains(&quad(3))?);
    assert!(matches!(
        oxigraph::sparql::SparqlEvaluator::new()
            .parse_query("ASK { <urn:s> <urn:p> 3 }")?
            .on_store(&reopened)
            .execute()?,
        oxigraph::sparql::QueryResults::Boolean(true)
    ));
    // A completion record describes its historical validation, not later writes.
    assert_eq!(RestoreReceipt::read(&target)?, restored);
    assert_eq!(
        BackupReceipt::verify(&package, &TransactionStartControl::new())?,
        backup
    );
    Ok(())
}

#[test]
fn empty_plain_genesis_and_retained_stores_restore_without_inventing_history() -> TestResult {
    let directory = tempfile::tempdir()?;
    for mode in 0..4 {
        let source = Store::open(directory.path().join(format!("source{mode}")))?;
        if mode == 1 {
            source.insert(quad(1))?;
        }
        if mode >= 2 {
            source.configure_outbox_retention(
                OutboxRetentionPolicy::new(NonZeroU64::new(5000).ok_or("bound")?, NonZeroU16::MIN)?,
                GovernanceTime::from_unix_millis(1),
            )?;
        }
        if mode == 3 {
            let last = commit(&source, 1)?;
            source.maintain_outbox(
                &last.outbox_end_cursor().ok_or("outbox")?,
                NonZeroUsize::new(10).ok_or("bound")?,
                GovernanceTime::from_unix_millis(2),
            )?;
        }
        let package = directory.path().join(format!("backup{mode}"));
        let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
        let target = directory.path().join(format!("restore{mode}"));
        let restored = Store::restore_backup(&package, &target, &RestoreOptions::default())?;
        assert_eq!(restored.backup().checkpoint(), backup.checkpoint());
        assert_eq!(RestoreReceipt::read(&target)?, restored);
        let store = Store::open(target.join("store"))?;
        store.validate()?;
        assert_eq!(store.len()? as u64, backup.contents().quads());
    }
    Ok(())
}

#[test]
fn restore_reads_every_retained_outbox_page() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    let mut transaction = source
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    for n in 0..=255 {
        transaction.insert(quad(n))?;
    }
    transaction.commit()?;
    let package = directory.path().join("backup");
    source.backup_with_receipt(&package, &BackupOptions::default())?;
    let result = Store::restore_backup(
        package,
        directory.path().join("restore"),
        &RestoreOptions::default(),
    )?;
    assert_eq!(result.validated_outbox_records(), 257);
    Ok(())
}

struct FakeProvider {
    identity: ContributorIdentity,
    mode: u8,
}
impl RestoreContributor for FakeProvider {
    fn identity(&self) -> ContributorIdentity {
        self.identity
    }
    fn reconcile(
        &self,
        declaration: &ContributorDeclaration,
        directory: &Path,
        primary: &RestorePrimary<'_>,
        _control: &TransactionStartControl,
    ) -> Result<ContributorObservation, StorageError> {
        let path = directory.join("index");
        let mut bytes = fs::read(&path)?;
        if bytes.len() != 36 || &bytes[..4] != b"IDX1" || declaration.identity() != self.identity {
            return Err(StorageError::Other("invalid fake provider state".into()));
        }
        if self.mode == 1 {
            bytes[20..].fill(1);
        }
        let lookup = |bytes: &[u8]| -> Result<ContributorCheckpoint, StorageError> {
            let key = TransactionKey::new(
                bytes
                    .try_into()
                    .map_err(|_| StorageError::Other("bad key".into()))?,
            );
            match primary.lookup_commit_receipt(&key)? {
                CommitReceiptOutcome::Committed(value) => ContributorCheckpoint::new(value)
                    .map_err(|error| StorageError::Other(error.into())),
                _ => Err(StorageError::Other(
                    "missing fake provider checkpoint".into(),
                )),
            }
        };
        let source = lookup(&bytes[4..20])?;
        let applied = lookup(&bytes[20..36])?;
        if self.mode == 2 {
            fs::write(path, b"changed during reconciliation")?;
        }
        if self.mode == 3 {
            return Err(StorageError::Other("injected provider read failure".into()));
        }
        let identity = if self.mode == 4 {
            ContributorIdentity::new([9; 16], NonZeroU32::MIN)
        } else {
            self.identity
        };
        Ok(ContributorObservation::new(
            identity,
            Some(source),
            Some(applied),
            ContributorHealth::Healthy,
        ))
    }
}
fn contributed_backup(
    directory: &Path,
) -> Result<
    (std::path::PathBuf, ContributorRegistry, ContributorIdentity),
    Box<dyn std::error::Error + Send + Sync>,
> {
    let source = Store::open(directory.join("source"))?;
    commit(&source, 1)?;
    let latest = commit(&source, 2)?;
    let point = ContributorCheckpoint::new(latest)?;
    let id = ContributorIdentity::new([1; 16], NonZeroU32::MIN);
    let registry = ContributorRegistry::new(vec![ContributorDeclaration::new(
        id,
        true,
        ContributorConsistency::Strict,
        false,
    )])?;
    let bytes = [b"IDX1".as_slice(), &[2; 16], &[2; 16]].concat();
    let path = directory.join("provider");
    fs::write(&path, &bytes)?;
    let contribution = BackupContribution::new(
        ContributorObservation::new(
            id,
            Some(point.clone()),
            Some(point),
            ContributorHealth::Healthy,
        ),
        vec![BackupArtifact::new(
            "index".into(),
            path,
            bytes.len() as u64,
            Sha256::digest(&bytes).into(),
        )?],
    )?;
    let package = directory.join("backup");
    source.backup_with_receipt(
        &package,
        &BackupOptions {
            contributors: registry.clone(),
            contributions: vec![contribution],
            ..BackupOptions::default()
        },
    )?;
    Ok((package, registry, id))
}

#[test]
fn provider_reconciliation_uses_copied_state_and_preserves_the_source() -> TestResult {
    let directory = tempfile::tempdir()?;
    let (package, registry, identity) = contributed_backup(directory.path())?;
    let original = BackupReceipt::verify(&package, &TransactionStartControl::new())?;
    let options = RestoreOptions {
        contributors: registry,
        reconcilers: vec![Arc::new(FakeProvider { identity, mode: 0 })],
        ..RestoreOptions::default()
    };
    let target = directory.path().join("restore");
    let restored = Store::restore_backup(&package, &target, &options)?;
    assert_eq!(
        restored.backup().contributor_inventory(),
        original.contributor_inventory()
    );
    assert_eq!(RestoreReceipt::read(&target)?, restored);
    let store = Store::open(target.join("store"))?;
    store.insert(quad(7))?;
    let provider_file = original
        .files()
        .iter()
        .find(|file| file.path().ends_with("/index"))
        .ok_or("index")?;
    fs::write(
        target.join(provider_file.path()),
        b"independent activated provider",
    )?;
    assert_eq!(
        BackupReceipt::verify(package, &TransactionStartControl::new())?,
        original
    );
    Ok(())
}

#[test]
fn provider_policy_duplicates_missing_stale_failures_and_mutations_reject() -> TestResult {
    let directory = tempfile::tempdir()?;
    let (package, registry, identity) = contributed_backup(directory.path())?;
    let original = BackupReceipt::verify(&package, &TransactionStartControl::new())?;
    for mode in 0..8 {
        let mut options = RestoreOptions {
            contributors: registry.clone(),
            reconcilers: vec![Arc::new(FakeProvider {
                identity,
                mode: mode.min(4),
            })],
            ..RestoreOptions::default()
        };
        match mode {
            0 => options.contributors = ContributorRegistry::default(),
            5 => options.reconcilers.clear(),
            6 => options
                .reconcilers
                .push(Arc::new(FakeProvider { identity, mode: 0 })),
            7 => {
                options.reconcilers = vec![Arc::new(FakeProvider {
                    identity: ContributorIdentity::new([8; 16], NonZeroU32::MIN),
                    mode: 0,
                })]
            }
            _ => {}
        }
        let target = directory.path().join(format!("restore{mode}"));
        Store::restore_backup(&package, &target, &options)
            .err()
            .ok_or("bad provider restore accepted")?;
        assert!(!target.join(RestoreReceipt::manifest_name()).exists());
        RestoreReceipt::read(&target)
            .err()
            .ok_or("incomplete restore read as complete")?;
        assert_eq!(
            BackupReceipt::verify(&package, &TransactionStartControl::new())?,
            original
        );
    }
    Ok(())
}

#[test]
fn absent_optional_fallback_needs_no_adapter_but_cannot_drop_its_declaration() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    let registry = ContributorRegistry::new(vec![ContributorDeclaration::new(
        ContributorIdentity::new([1; 16], NonZeroU32::MIN),
        false,
        ContributorConsistency::Eventual { max_lag_records: 5 },
        true,
    )])?;
    let package = directory.path().join("backup");
    source.backup_with_receipt(
        &package,
        &BackupOptions {
            contributors: registry.clone(),
            ..BackupOptions::default()
        },
    )?;
    Store::restore_backup(
        &package,
        directory.path().join("bad"),
        &RestoreOptions::default(),
    )
    .err()
    .ok_or("dropped declaration accepted")?;
    let target = directory.path().join("restore");
    Store::restore_backup(
        &package,
        &target,
        &RestoreOptions {
            contributors: registry,
            ..RestoreOptions::default()
        },
    )?;
    RestoreReceipt::read(target)?;
    Ok(())
}

#[test]
fn preflight_preserves_existing_data_and_rejects_corrupt_or_unbounded_packages() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    source.insert(quad(1))?;
    let package = directory.path().join("backup");
    let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
    let existing = directory.path().join("existing");
    fs::create_dir_all(&existing)?;
    fs::write(existing.join("valuable"), b"keep")?;
    for target in [existing.clone(), package.join("nested"), package.clone()] {
        Store::restore_backup(&package, target, &RestoreOptions::default())
            .err()
            .ok_or("invalid target accepted")?;
    }
    assert_eq!(fs::read(existing.join("valuable"))?, b"keep");
    for mode in 0..5 {
        let mut options = RestoreOptions::default();
        match mode {
            0 => options.expected_backup_fingerprint = Some([0; 32]),
            1 => options.max_files = NonZeroUsize::MIN,
            2 => options.max_bytes = NonZeroU64::MIN,
            3 => options.control.cancel(),
            _ => options.control = TransactionStartControl::new().with_timeout(Duration::ZERO),
        }
        let target = directory.path().join(format!("bad{mode}"));
        Store::restore_backup(&package, &target, &options)
            .err()
            .ok_or("bad preflight accepted")?;
        assert!(!target.exists());
    }
    let file = backup
        .files()
        .iter()
        .find(|file| file.path().ends_with("CURRENT"))
        .ok_or("CURRENT")?;
    let path = package.join(file.path());
    let bytes = fs::read(&path)?;
    for mode in 0..4 {
        match mode {
            0 => fs::write(&path, b"corrupt")?,
            1 => fs::remove_file(&path)?,
            2 => {
                fs::remove_file(&path)?;
                std::os::unix::fs::symlink(directory.path().join("source/CURRENT"), &path)?;
            }
            _ => fs::write(package.join("store/extra"), b"unexpected")?,
        }
        let target = directory.path().join(format!("corrupt{mode}"));
        Store::restore_backup(&package, &target, &RestoreOptions::default())
            .err()
            .ok_or("corrupt package accepted")?;
        assert!(!target.exists());
        if mode == 2 {
            fs::remove_file(&path)?;
        }
        fs::write(&path, &bytes)?;
    }
    Ok(())
}

#[test]
fn frozen_local_baselines_report_measurements_and_reject_artifact_age_or_duration_drift()
-> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    let package = directory.path().join("backup");
    let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
    let reference =
        GovernanceTime::from_unix_millis(backup.source_end().time().as_unix_millis() + 1000);
    let baseline = RecoveryBaseline::new(
        &backup,
        reference,
        Duration::from_secs(3600),
        Duration::from_secs(60),
    )?;
    let target = directory.path().join("restore");
    let result = Store::restore_backup(
        &package,
        &target,
        &RestoreOptions {
            baseline: Some(baseline.clone()),
            ..RestoreOptions::default()
        },
    )?;
    assert_eq!(result.baseline(), Some(&baseline));
    assert_eq!(result.checkpoint_age_range().0, Duration::from_secs(1));
    assert!(result.restore_duration() > Duration::ZERO);
    assert_eq!(RestoreReceipt::read(target)?, result);
    assert!(matches!(
        RecoveryBaseline::new(&backup, reference, Duration::ZERO, Duration::from_secs(60)),
        Err(RestoreError::RecoveryPointTooOld { .. })
    ));
    assert!(matches!(
        RecoveryBaseline::new(
            &backup,
            GovernanceTime::from_unix_millis(0),
            Duration::MAX,
            Duration::from_secs(60)
        ),
        Err(RestoreError::Limit | RestoreError::InvalidReference)
    ));
    let tiny = RecoveryBaseline::new(
        &backup,
        reference,
        Duration::from_secs(3600),
        Duration::ZERO,
    )?;
    let target = directory.path().join("slow");
    match Store::restore_backup(
        &package,
        &target,
        &RestoreOptions {
            baseline: Some(tiny),
            ..RestoreOptions::default()
        },
    ) {
        Err(RestoreError::RestoreDurationExceeded { observation }) => {
            assert!(observation.restore_duration() > Duration::ZERO)
        }
        value => return Err(format!("unexpected zero duration result: {value:?}").into()),
    }
    assert!(!target.join(RestoreReceipt::manifest_name()).exists());
    let other = directory.path().join("other");
    source.insert(quad(1))?;
    source.backup_with_receipt(&other, &BackupOptions::default())?;
    assert!(matches!(
        Store::restore_backup(
            other,
            directory.path().join("mismatched"),
            &RestoreOptions {
                baseline: Some(baseline),
                ..RestoreOptions::default()
            }
        ),
        Err(RestoreError::BackupMismatch)
    ));
    Ok(())
}

#[test]
fn mismatched_backup_is_rejected_before_applying_another_artifacts_reference() -> TestResult {
    let directory = tempfile::tempdir()?;
    let source = Store::open(directory.path().join("source"))?;
    let original =
        source.backup_with_receipt(directory.path().join("original"), &BackupOptions::default())?;
    let reference = original.source_end().time();
    let baseline = RecoveryBaseline::new(
        &original,
        reference,
        Duration::from_secs(3600),
        Duration::from_secs(60),
    )?;
    // Make the new artifact later than this valid, original-artifact baseline.
    std::thread::sleep(Duration::from_millis(2));
    source.insert(quad(7))?;
    let other_path = directory.path().join("other");
    let other = source.backup_with_receipt(&other_path, &BackupOptions::default())?;
    assert!(other.source_start().time().as_unix_millis() > reference.as_unix_millis());
    let destination = directory.path().join("restore");
    let result = Store::restore_backup(
        &other_path,
        &destination,
        &RestoreOptions {
            baseline: Some(baseline),
            ..RestoreOptions::default()
        },
    );
    assert!(
        matches!(result, Err(RestoreError::BackupMismatch)),
        "wrong rejection: {result:?}"
    );
    assert!(!destination.exists());
    assert_eq!(
        BackupReceipt::verify(other_path, &TransactionStartControl::new())?,
        other
    );
    Ok(())
}
