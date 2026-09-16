use super::*;
use crate::model::{GraphName, NamedNode, Quad};
use crate::store::{
    BackupContribution, BackupOptions, CommitReceipt, ContributorCheckpoint,
    ContributorConsistency, ContributorDeclaration, ContributorHealth, ContributorIdentity,
    ContributorObservation, ContributorRegistry, GovernanceTime, Namespace, NamespacePrefix,
    OutboxRetentionPolicy, TransactionKey, TransactionRequest, WritableDataset,
};
use std::collections::BTreeMap;
use std::num::{NonZeroU16, NonZeroU32, NonZeroU64, NonZeroUsize};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn quad() -> Quad {
    let node = NamedNode::new_unchecked("urn:schema-upgrade");
    Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph)
}
fn commit(store: &Store, id: u8, value: Option<Quad>) -> TestResult<CommitReceipt> {
    let mut transaction = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([id; 16]))?
        .into_transaction();
    if let Some(value) = value {
        transaction.insert(value)?;
    }
    Ok(transaction.commit()?)
}
fn fixture(root: &Path) -> TestResult<(PathBuf, PathBuf)> {
    let source = root.join("source");
    let package = root.join("backup");
    let store = Store::open(&source)?;
    store.configure_outbox_retention(
        OutboxRetentionPolicy::new(NonZeroU64::new(128).unwrap(), NonZeroU16::new(4).unwrap())?,
        GovernanceTime::from_unix_millis(1),
    )?;
    let first = commit(&store, 1, Some(quad()))?;
    let second = commit(&store, 2, None)?;
    store.maintain_outbox(
        &second.outbox_end_cursor().unwrap(),
        NonZeroUsize::MIN,
        GovernanceTime::from_unix_millis(2),
    )?;
    assert!(first.outbox_end_cursor().is_some());
    store.insert_named_graph(NamedNode::new_unchecked("urn:empty"))?;
    store.set_namespace(Namespace::new(
        NamespacePrefix::new("ex".to_owned())?,
        NamedNode::new_unchecked("urn:example:"),
    ))?;
    store.backup_with_receipt(&package, &BackupOptions::default())?;
    drop(store);
    Ok((source, package))
}
fn bytes(root: &Path) -> TestResult<BTreeMap<PathBuf, Vec<u8>>> {
    fn visit(root: &Path, path: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) -> TestResult {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                visit(root, &entry.path(), out)?;
            } else {
                assert!(entry.file_type()?.is_file());
                out.insert(
                    entry.path().strip_prefix(root)?.to_owned(),
                    fs::read(entry.path())?,
                );
            }
        }
        Ok(())
    }
    let mut out = BTreeMap::new();
    visit(root, root, &mut out)?;
    Ok(out)
}

#[test]
fn schema_upgrade_preserves_governance_retention_namespaces_and_topology() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    assert!(!package.join("store/LOCK").exists());
    for profile in [SchemaRdfProfile::Rdf11, SchemaRdfProfile::Rdf12] {
        let options = SchemaUpgradeOptions::new(profile);
        let workspace = root.path().join(profile.as_str());
        let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
        assert!(initial.receipt().is_none());
        assert_eq!(fs::read_dir(workspace.join("attempts"))?.count(), 0);
        let uuid = *initial.schema_uuid();
        let completed = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
        let receipt = completed.receipt().unwrap();
        assert_eq!(receipt.schema_uuid(), &uuid);
        assert_eq!(receipt.envelope().rdf_write_profile(), profile);
        assert_eq!(receipt.contributor_scope(), "byte-preserved-not-reconciled");
        assert!(receipt.primary_records() > 12);
        assert_eq!(
            SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?,
            *receipt
        );
        let before_output = bytes(&workspace)?;
        let output = receipt.store_directory();
        assert_eq!(Store::inspect(&output)?.storage_version(), Some(3));
        assert!(matches!(
            Store::open(&output),
            Err(crate::storage::StorageError::UpgradeIncomplete)
        ));
        assert!(matches!(
            Store::open_read_only(&output),
            Err(crate::storage::StorageError::UpgradeIncomplete)
        ));
        assert_eq!(bytes(&workspace)?, before_output);
        assert_eq!(
            Store::resume_schema_upgrade(&source, &package, &workspace, &options)?.receipt(),
            Some(receipt)
        );
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
    }
    Ok(())
}

#[test]
fn schema_upgrade_every_interruption_retains_uuid_and_prior_attempt_bytes() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    for stop in 0..10 {
        let workspace = root.path().join(format!("fault-{stop}"));
        let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
        let error = resume_inner(&source, &package, &workspace, &options, |phase| {
            if phase == stop {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        });
        assert!(error.is_err(), "fault {stop} was not reached");
        let attempts_before = bytes(&workspace.join("attempts"))?;
        let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
        assert_eq!(state.schema_uuid(), initial.schema_uuid());
        assert!(state.receipt().is_some());
        let attempts_after = bytes(&workspace.join("attempts"))?;
        for (path, data) in attempts_before {
            assert_eq!(attempts_after.get(&path), Some(&data));
        }
        SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
    }
    Ok(())
}

#[test]
fn schema_upgrade_cancellation_and_attempt_limit_do_not_repair_partial_work() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let workspace = root.path().join("cancel");
    let mut options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    options.limits.max_attempts = NonZeroUsize::MIN;
    Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let cancel = options.backup().control.clone();
    assert!(
        resume_inner(&source, &package, &workspace, &options, |phase| {
            if phase == 3 {
                cancel.cancel();
            }
            Ok(())
        })
        .is_err()
    );
    let before = bytes(&workspace)?;
    options.limits.transform.backup.control = crate::store::TransactionStartControl::new();
    assert!(matches!(
        Store::resume_schema_upgrade(&source, &package, &workspace, &options),
        Err(BackupError::Limit)
    ));
    assert_eq!(bytes(&workspace)?, before);
    Ok(())
}

#[test]
fn schema_upgrade_torn_journal_and_profile_drift_fail_without_writes() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root.path().join("torn");
    Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let different = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf12);
    let before = bytes(&workspace)?;
    assert!(Store::resume_schema_upgrade(&source, &package, &workspace, &different).is_err());
    assert_eq!(bytes(&workspace)?, before);
    fs::write(workspace.join(JOURNAL), [0, 0, 0])?;
    let before = bytes(&workspace)?;
    assert!(Store::resume_schema_upgrade(&source, &package, &workspace, &options).is_err());
    assert_eq!(bytes(&workspace)?, before);
    Ok(())
}

#[test]
fn schema_upgrade_sealed_tampering_is_not_repaired() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    for target in [PLAN, JOURNAL, COMPLETE] {
        let workspace = root.path().join(target);
        Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
        Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
        let path = workspace.join(target);
        let mut damaged = fs::read(&path)?;
        let last = damaged.len() - 1;
        damaged[last] ^= 1;
        fs::write(path, damaged)?;
        let before = bytes(&workspace)?;
        assert!(SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options).is_err());
        assert!(Store::resume_schema_upgrade(&source, &package, &workspace, &options).is_err());
        assert_eq!(bytes(&workspace)?, before);
    }
    let workspace = root.path().join("output");
    Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
    fs::write(
        state.receipt().unwrap().store_directory().join("foreign"),
        b"unexpected",
    )?;
    let before = bytes(&workspace)?;
    assert!(SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options).is_err());
    assert_eq!(bytes(&workspace)?, before);
    Ok(())
}

#[test]
fn schema_upgrade_rejects_preflight_built_by_a_different_binary() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let control = root.path().join("same-build");
    Store::start_schema_upgrade(&source, &package, &control, &options)?;
    assert!(
        Store::resume_schema_upgrade(&source, &package, &control, &options)?
            .receipt()
            .is_some()
    );
    SchemaUpgradeReceipt::verify(&source, &package, &control, &options)?;
    let workspace = root.path().join("changed-build");
    Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let plan = workspace.join(PLAN);
    let mut stored = fs::read(&plan)?;
    let mut binding = Vec::new();
    BuildBinding::capture(&options.build_options(), std::time::Instant::now())?
        .encode(&mut binding);
    let offsets = stored
        .windows(binding.len())
        .enumerate()
        .filter(|(_, window)| *window == binding.as_slice())
        .map(|(offset, _)| offset)
        .collect::<Vec<_>>();
    assert_eq!(
        offsets.len(),
        1,
        "the running build identity must be embedded exactly once in the preflight"
    );
    let last = offsets[0] + binding.len() - 1;
    stored[last] ^= 1;
    fs::write(&plan, &stored)?;
    let before = bytes(&workspace)?;
    assert!(Store::resume_schema_upgrade(&source, &package, &workspace, &options).is_err());
    assert_eq!(bytes(&workspace)?, before);
    Ok(())
}

#[test]
fn schema_upgrade_rejects_changed_source_and_overlapping_paths() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    assert!(
        Store::start_schema_upgrade(&source, &package, source.join("nested"), &options).is_err()
    );
    assert!(!source.join("nested").exists());
    let workspace = root.path().join("changed-source");
    Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let store = Store::open(&source)?;
    store.insert(Quad::new(
        NamedNode::new_unchecked("urn:changed"),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:o"),
        GraphName::DefaultGraph,
    ))?;
    drop(store);
    let before = bytes(&workspace)?;
    assert!(Store::resume_schema_upgrade(&source, &package, &workspace, &options).is_err());
    assert_eq!(bytes(&workspace)?, before);
    Ok(())
}

#[test]
fn schema_upgrade_preserves_external_contributor_bytes_without_reconciliation() -> TestResult {
    let root = tempfile::tempdir()?;
    let source = root.path().join("source");
    let package = root.path().join("backup");
    let store = Store::open(&source)?;
    let receipt = commit(&store, 10, Some(quad()))?;
    let point = ContributorCheckpoint::new(receipt)?;
    let identity = ContributorIdentity::new([7; 16], NonZeroU32::MIN);
    let registry = ContributorRegistry::new(vec![ContributorDeclaration::new(
        identity,
        true,
        ContributorConsistency::Strict,
        false,
    )])?;
    let data = b"immutable external contributor";
    let artifact = root.path().join("contributor.bin");
    fs::write(&artifact, data)?;
    let contribution = BackupContribution::new(
        ContributorObservation::new(
            identity,
            Some(point.clone()),
            Some(point),
            ContributorHealth::Healthy,
        ),
        vec![BackupArtifact::new(
            "index.bin".into(),
            artifact,
            data.len() as u64,
            Sha256::digest(data).into(),
        )?],
    )?;
    let backup = store.backup_with_receipt(
        &package,
        &BackupOptions {
            contributors: registry,
            contributions: vec![contribution],
            ..BackupOptions::default()
        },
    )?;
    drop(store);
    let workspace = root.path().join("workspace");
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
    let output = state.receipt().unwrap().store_directory();
    let attempt = output.parent().unwrap();
    for file in backup
        .files()
        .iter()
        .filter(|file| file.path().starts_with("contributors/"))
    {
        assert_eq!(
            fs::read(package.join(file.path()))?,
            fs::read(attempt.join(file.path()))?
        );
    }
    SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn schema_upgrade_rdf11_rejects_live_and_removed_retained_rdf12() -> TestResult {
    use crate::model::Triple;
    let root = tempfile::tempdir()?;
    for remove in [false, true] {
        let source = root.path().join(format!("source-{remove}"));
        let package = root.path().join(format!("backup-{remove}"));
        let store = Store::open(&source)?;
        let node = NamedNode::new_unchecked("urn:rdf12");
        let value = Quad::new(
            node.clone(),
            node.clone(),
            Triple::new(node.clone(), node.clone(), node),
            GraphName::DefaultGraph,
        );
        commit(&store, 20, Some(value.clone()))?;
        if remove {
            let mut transaction = store
                .start_governed_transaction(
                    TransactionRequest::default(),
                    TransactionKey::new([21; 16]),
                )?
                .into_transaction();
            transaction.remove(&value)?;
            transaction.commit()?;
        }
        store.backup_with_receipt(&package, &BackupOptions::default())?;
        drop(store);
        let before = bytes(&source)?;
        let rejected = root.path().join(format!("rejected-{remove}"));
        assert!(matches!(
            Store::start_schema_upgrade(
                &source,
                &package,
                &rejected,
                &SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11)
            ),
            Err(BackupError::Storage(
                crate::storage::StorageError::FeatureIncompatible { feature: "rdf-12" }
            ))
        ));
        assert!(!rejected.exists());
        assert_eq!(bytes(&source)?, before);
        let workspace = root.path().join(format!("allowed-{remove}"));
        let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf12);
        Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
        Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
        SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
    }
    Ok(())
}

#[test]
fn schema_upgrade_unknown_metadata_and_invalid_outcomes_are_rejected() -> TestResult {
    let root = tempfile::tempdir()?;
    for (index, key, value) in [
        (0, b"unknown-schema-metadata".to_vec(), vec![1]),
        (
            1,
            [b"\0oxigraph.transaction-outcome.v1\0".as_slice(), &[3; 16]].concat(),
            vec![1, 99],
        ),
    ] {
        let source = root.path().join(format!("source-{index}"));
        let package = root.path().join(format!("backup-{index}"));
        drop(Store::open(&source)?);
        SchemaUpgradeSnapshot::put_for_test(&source, &key, &value)?;
        let store = Store::open(&source)?;
        store.backup_with_receipt(&package, &BackupOptions::default())?;
        drop(store);
        let before = bytes(&source)?;
        let workspace = root.path().join(format!("rejected-{index}"));
        assert!(
            Store::start_schema_upgrade(
                &source,
                &package,
                &workspace,
                &SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11)
            )
            .is_err()
        );
        assert!(!workspace.exists());
        assert_eq!(bytes(&source)?, before);
    }
    Ok(())
}

#[test]
fn schema_upgrade_holds_source_lease_and_detects_primary_output_mutation() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root.path().join("lease");
    Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let state = resume_inner(&source, &package, &workspace, &options, |phase| {
        if phase == 3 {
            assert!(Store::open(&source).is_err());
            assert!(!package.join("store/LOCK").exists());
        }
        Ok(())
    })?;
    SchemaUpgradeSnapshot::put_for_test(
        &state.receipt().unwrap().store_directory(),
        b"unknown",
        b"changed",
    )?;
    let before = bytes(&workspace)?;
    assert!(SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options).is_err());
    assert_eq!(bytes(&workspace)?, before);
    Ok(())
}
