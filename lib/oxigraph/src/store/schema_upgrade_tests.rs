#[path = "schema_upgrade_validated_fsync_tests.rs"]
mod validated_fsync;

#[path = "schema_upgrade_abandoned_fsync_tests.rs"]
mod abandoned_fsync;

#[path = "schema_upgrade_journal_fsync_tests.rs"]
mod journal_fsync;

#[path = "schema_upgrade_publication_fsync_tests.rs"]
mod publication_fsync;

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
/// Starts and seals one workspace, returning its receipt.
fn sealed(
    source: &Path,
    package: &Path,
    workspace: &Path,
    options: &SchemaUpgradeOptions,
) -> TestResult<SchemaUpgradeReceipt> {
    Store::start_schema_upgrade(source, package, workspace, options)?;
    let state = Store::resume_schema_upgrade(source, package, workspace, options)?;
    Ok(state
        .receipt()
        .ok_or("the workspace was not sealed")?
        .clone())
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

#[test]
fn schema_upgrade_activation_publishes_a_source_preserving_copy() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root.path().join("workspace");
    let receipt = sealed(&source, &package, &workspace, &options)?;
    let attempt_store = bytes(&receipt.store_directory())?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let before_workspace = bytes(&workspace)?;
    let target = root.path().join("activated");
    let activation =
        Store::activate_schema_upgrade(&source, &package, &workspace, &target, &options)?;
    assert!(activation.active());
    assert!(activation.directory().ends_with("activated"));
    assert_eq!(activation.schema_upgrade_receipt(), &receipt);
    assert_eq!(activation.schema_uuid(), receipt.schema_uuid());
    assert_eq!(
        activation.primary_fingerprint(),
        receipt.primary_fingerprint()
    );
    assert_eq!(activation.primary_records(), receipt.primary_records());
    assert_eq!(activation.primary_bytes(), receipt.primary_bytes());
    // Source, backup and the whole retained workspace are untouched.
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    assert_eq!(bytes(&workspace)?, before_workspace);
    // Exactly the winning attempt's store files, byte for byte, minus the guard.
    assert!(!target.join(UPGRADE_GUARD).exists());
    let published = bytes(&target)?;
    let expected: Vec<_> = attempt_store
        .keys()
        .filter(|path| path.as_path() != Path::new(UPGRADE_GUARD))
        .collect();
    assert_eq!(published.keys().collect::<Vec<_>>(), expected);
    for (path, data) in &published {
        assert_eq!(attempt_store.get(path), Some(data));
        assert_eq!(path.components().count(), 1);
    }
    // LATEST_STORAGE_VERSION is still 2: this build correctly refuses to treat
    // a published version-3 target as its own current, ordinarily-usable
    // schema. Activation stages a source-preserving copy for a future
    // version-3-aware binary; it does not itself promote version 3 to
    // current, and must not silently bypass the same typed refusal every
    // other newer-than-supported store gets. The primary fingerprint/record/
    // byte equality asserted above -- independently re-derived by activation
    // itself via `compare(&inputs.source, &opened, ...)` before the guard was
    // ever removed -- is the proof of exact content identity (namespaces,
    // retention metadata and every other primary key-value the receipt scope
    // covers); ordinary open is not required, and is not the mechanism, for
    // that proof.
    assert_eq!(Store::inspect(&target)?.storage_version(), Some(3));
    assert!(matches!(
        Store::open(&target),
        Err(crate::storage::StorageError::SchemaTooNew {
            found: 3,
            supported: 2
        })
    ));
    assert!(matches!(
        Store::open_read_only(&target),
        Err(crate::storage::StorageError::SchemaTooNew {
            found: 3,
            supported: 2
        })
    ));
    // The receipt still verifies and the workspace is still byte-identical.
    SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
    assert_eq!(bytes(&workspace)?, before_workspace);
    Ok(())
}

#[test]
fn schema_upgrade_activation_rejects_existing_overlapping_and_symlinked_targets() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root.path().join("workspace");
    let receipt = sealed(&source, &package, &workspace, &options)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let before_workspace = bytes(&workspace)?;
    let existing = root.path().join("existing");
    fs::create_dir(&existing)?;
    let symlink = root.path().join("symlink");
    std::os::unix::fs::symlink(&existing, &symlink)?;
    for rejected in [
        existing.clone(),
        symlink.clone(),
        source.join("nested"),
        package.join("nested"),
        workspace.join("nested"),
        receipt.store_directory().join("nested"),
        root.path().join("missing-parent").join("target"),
    ] {
        assert!(
            Store::activate_schema_upgrade(&source, &package, &workspace, &rejected, &options)
                .is_err(),
            "{} was accepted as an activation target",
            rejected.display()
        );
        assert!(!rejected.join(UPGRADE_GUARD).exists());
    }
    assert!(fs::read_dir(&existing)?.next().is_none());
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    assert_eq!(bytes(&workspace)?, before_workspace);
    Ok(())
}

#[test]
fn schema_upgrade_activation_rejects_unsealed_and_tampered_workspaces() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    // Stop right after the attempt is recorded VALIDATED but before it is SEALED.
    let unsealed = root.path().join("unsealed");
    Store::start_schema_upgrade(&source, &package, &unsealed, &options)?;
    assert!(
        resume_inner(&source, &package, &unsealed, &options, |phase| {
            if phase == 6 {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        })
        .is_err()
    );
    let before = bytes(&unsealed)?;
    let target = root.path().join("unsealed-target");
    assert!(
        Store::activate_schema_upgrade(&source, &package, &unsealed, &target, &options).is_err()
    );
    assert!(!target.exists());
    assert_eq!(bytes(&unsealed)?, before);
    for damaged in [PLAN, JOURNAL, COMPLETE] {
        let workspace = root.path().join(format!("tampered-{damaged}"));
        sealed(&source, &package, &workspace, &options)?;
        let path = workspace.join(damaged);
        let mut content = fs::read(&path)?;
        let last = content.len() - 1;
        content[last] ^= 1;
        fs::write(path, content)?;
        let before = bytes(&workspace)?;
        let target = root.path().join(format!("target-{damaged}"));
        assert!(
            Store::activate_schema_upgrade(&source, &package, &workspace, &target, &options)
                .is_err()
        );
        assert!(!target.exists());
        assert_eq!(bytes(&workspace)?, before);
    }
    Ok(())
}

#[test]
fn schema_upgrade_activation_faults_never_leave_a_usable_target() -> TestResult {
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root.path().join("workspace");
    sealed(&source, &package, &workspace, &options)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let before_workspace = bytes(&workspace)?;
    for stop in 0..5 {
        let target = root.path().join(format!("fault-{stop}"));
        let error = activate_inner(&source, &package, &workspace, &target, &options, |phase| {
            if phase == stop {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        });
        assert!(error.is_err(), "fault {stop} was not reached");
        // Before the guard-removal barrier the target is empty or guarded, and
        // never openable as a store.
        if target.join(UPGRADE_GUARD).exists() {
            assert!(Store::open(&target).is_err());
        } else {
            assert!(fs::read_dir(&target)?.next().is_none());
        }
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
        assert_eq!(bytes(&workspace)?, before_workspace);
    }
    // A fresh target still activates ordinarily afterwards. LATEST_STORAGE_VERSION
    // is still 2, so this build correctly refuses to open its own version-3
    // publication rather than silently treating it as current.
    let target = root.path().join("final");
    Store::activate_schema_upgrade(&source, &package, &workspace, &target, &options)?;
    assert!(!target.join(UPGRADE_GUARD).exists());
    assert!(matches!(
        Store::open(&target),
        Err(crate::storage::StorageError::SchemaTooNew {
            found: 3,
            supported: 2
        })
    ));
    assert_eq!(bytes(&workspace)?, before_workspace);
    Ok(())
}

/// The libtest filter of one helper `#[test]`, which never names the crate.
fn helper(name: &str) -> String {
    let module = module_path!();
    let path = module.split_once("::").map_or(module, |(_, rest)| rest);
    format!("{path}::{name}")
}
/// Re-invokes this same test binary at one helper, which exits 73 at `stop`.
fn crash(name: &str, paths: &[(&str, &Path)], stop: u8) -> TestResult<std::process::ExitStatus> {
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command.arg("--exact").arg(helper(name));
    command.env("OXIGRAPH_SCHEMA_UPGRADE_TEST_EXIT_AT", stop.to_string());
    for (variable, path) in paths {
        command.env(variable, path);
    }
    Ok(command.status()?)
}
/// Reads one path that the parent test passed to a re-invoked helper.
fn variable(name: &str) -> TestResult<PathBuf> {
    let Some(value) = std::env::var_os(name) else {
        return Err("the parent test passed no such path".into());
    };
    Ok(value.into())
}

#[test]
fn schema_upgrade_resume_child_exit_mid_copy_retains_a_resumable_attempt() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root.path().join("resume-crash");
    let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    // A real process killed mid-copy: no destructor runs, and the source lease,
    // every open descriptor and every unflushed buffer are released only by the
    // kernel rather than by an ordinary `?` unwind.
    let paths = [
        ("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE", source.as_path()),
        ("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE", package.as_path()),
        (
            "OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE",
            workspace.as_path(),
        ),
    ];
    let status = crash("schema_upgrade_resume_process_helper", &paths, 2)?;
    assert_eq!(status.code(), Some(73), "the child did not stop mid-copy");
    // An ordinary, fresh, in-process resume still completes the same upgrade.
    let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
    assert_eq!(state.schema_uuid(), initial.schema_uuid());
    assert!(state.receipt().is_some());
    SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    Ok(())
}

/// `resume_inner` has ten fault phases (0..=9), already covered exhaustively
/// but only synthetically by `schema_upgrade_every_interruption_retains_uuid_
/// and_prior_attempt_bytes`, and only once by a real process kill (mid-copy,
/// phase 2, above). This test adds real-process-kill coverage for the
/// remaining, most consequential boundary: `fault(8)` fires after `PENDING`
/// is written and synced but strictly before `fs::rename(PENDING, COMPLETE)`;
/// `fault(9)` fires strictly after that rename has already returned, mapped
/// through `indeterminate()` -- the same asymmetric completion-rename
/// boundary already proven with a real kill for the legacy path's
/// `prepare_inner`/`transform_inner` (see `upgrade.rs`'s and
/// `upgrade_transform.rs`'s own equivalent tests), now extended to the
/// v2-to-v3 draft's own `resume_inner`.
#[test]
fn schema_upgrade_resume_child_exits_before_and_after_the_completion_rename() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    for stop in [8_u8, 9] {
        let workspace = root.path().join(format!("resume-completion-crash-{stop}"));
        let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
        let paths = [
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE", source.as_path()),
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE", package.as_path()),
            (
                "OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE",
                workspace.as_path(),
            ),
        ];
        let status = crash("schema_upgrade_resume_process_helper", &paths, stop)?;
        assert_eq!(status.code(), Some(73), "the child did not reach {stop}");
        // stop=8: killed after PENDING is written and synced but before the
        // atomic rename to COMPLETE -- a fresh, in-process resume completes
        // the same upgrade from that durable point, exactly as the existing
        // synthetic every-interruption test already proves for this phase.
        // stop=9: killed immediately after the rename -- the marker is
        // already visible in the directory even though the final directory
        // fsync never ran, so a fresh resume still succeeds and reaches the
        // same UUID and receipt, not a different or degraded outcome.
        let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
        assert_eq!(state.schema_uuid(), initial.schema_uuid());
        assert!(state.receipt().is_some());
        SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
    }
    Ok(())
}

/// A real process kill on `resume_inner`'s own `write_envelope` call --
/// `fault(3)` fires strictly before it, `fault(4)` strictly after -- the
/// one RocksDB-internal write path in this whole crash-matrix family:
/// `SchemaUpgradeSnapshot::write_envelope`'s `db.insert()`/`db.flush()`,
/// the same call this session's real-`ENOSPC` coverage
/// (`disk_exhaustion_on_the_resume_schema_envelope_write_preserves_every_
/// input`) already targets with an injected `Result::Err`. A real,
/// unwind-skipping process exit proves the crash-recovery path tolerates a
/// genuinely unclean RocksDB shutdown at this exact point instead, which
/// neither that test nor the existing synthetic coverage
/// (`schema_upgrade_every_interruption_retains_uuid_and_prior_attempt_
/// bytes`) can. Because the last record after either kill is still
/// `INTENT` -- `VALIDATED` is only appended at `fault(6)`, well after this
/// boundary -- a fresh resume abandons this attempt (a `FAILED` record for
/// it) and starts a new one from scratch, the same outcome shape
/// `schema_upgrade_resume_child_exit_mid_copy_retains_a_resumable_attempt`
/// already proves for `fault(2)`, extended here to the two phases either
/// side of the one RocksDB-internal write.
#[test]
fn schema_upgrade_resume_child_exits_before_and_after_the_schema_envelope_write() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    for stop in [3_u8, 4] {
        let workspace = root.path().join(format!("resume-envelope-crash-{stop}"));
        let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
        let paths = [
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE", source.as_path()),
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE", package.as_path()),
            (
                "OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE",
                workspace.as_path(),
            ),
        ];
        let status = crash("schema_upgrade_resume_process_helper", &paths, stop)?;
        assert_eq!(status.code(), Some(73), "the child did not reach {stop}");
        // Either kill leaves the last record as INTENT, so a fresh,
        // in-process resume abandons this attempt and starts a new one,
        // reaching the same upgrade outcome as an uninterrupted run -- not
        // a degraded or different result.
        let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
        assert_eq!(state.schema_uuid(), initial.schema_uuid());
        assert!(state.receipt().is_some());
        SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
    }
    Ok(())
}

/// Real process kills bracketing `resume_inner`'s two journal-append
/// calls: `fault(5)` fires strictly before the `VALIDATED` record is
/// appended, `fault(6)` strictly after it (and before the `if` that reads
/// that same in-memory record back to decide whether to append `SEALED`
/// next), and `fault(7)` strictly after the `SEALED` append. Every kill
/// point at `fault(0)` through `fault(4)` -- and, again, `fault(5)` here --
/// leaves the last journal record as `INTENT`, so a fresh resume always
/// abandons that attempt and starts over (this file's own real-kill
/// coverage of that shape is at phases 2, 3 and 4; 0 and 1 share the same
/// `INTENT`-last property but are not yet real-kill tested). `fault(6)`
/// and `fault(7)` are different: a fresh resume does NOT abandon the
/// attempt after either -- it reuses attempt 0's own already-validated (or
/// already-sealed) output directly, because the journal record a real,
/// unwind-skipping process death still left durably recorded is what
/// tells it there's nothing left to redo. Phases 8 and 9 (the completion-
/// rename boundary, already real-kill tested above) also produce a
/// non-abandoning resume, so `fault(6)`/`fault(7)` are not the only such
/// phases -- but no sibling test in this file, including that one, checks
/// FOR that non-abandonment directly; this is the first one that does.
/// This specifically checks for that distinction (no `0000000000000001`
/// directory after `fault(6)`/`fault(7)`, one always present after
/// `fault(5)`), not just the generic "a fresh resume still reaches the
/// same outcome" shape every other real-kill test in this file already
/// asserts.
#[test]
fn schema_upgrade_resume_child_exits_around_the_validated_and_sealed_appends() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    for stop in [5_u8, 6, 7] {
        let workspace = root.path().join(format!("resume-validate-crash-{stop}"));
        let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
        let attempts = workspace.join("attempts");
        let paths = [
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE", source.as_path()),
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE", package.as_path()),
            (
                "OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE",
                workspace.as_path(),
            ),
        ];
        let status = crash("schema_upgrade_resume_process_helper", &paths, stop)?;
        assert_eq!(status.code(), Some(73), "the child did not reach {stop}");
        let attempt_zero = attempts.join(format!("{:016}", 0_u64));
        let attempt_one = attempts.join(format!("{:016}", 1_u64));
        let before_attempt_zero = bytes(&attempt_zero)?;
        let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
        assert_eq!(state.schema_uuid(), initial.schema_uuid());
        assert!(state.receipt().is_some());
        // Attempt 0's own files are never touched by the fresh resume,
        // whether it is abandoned (stop=5) or reused (stop=6, stop=7).
        assert_eq!(bytes(&attempt_zero)?, before_attempt_zero);
        if stop == 5 {
            assert!(attempt_one.exists(), "a new attempt must have been started");
        } else {
            assert!(
                !attempt_one.exists(),
                "the same attempt must have been reused, not abandoned"
            );
        }
        SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
    }
    Ok(())
}

#[test]
fn schema_upgrade_activation_child_exits_before_and_after_guard_unlink() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root.path().join("workspace");
    sealed(&source, &package, &workspace, &options)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let before_workspace = bytes(&workspace)?;
    for phase in [4_u8, 5] {
        let target = root.path().join(format!("crash-{phase}"));
        let paths = [
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE", source.as_path()),
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE", package.as_path()),
            (
                "OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE",
                workspace.as_path(),
            ),
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_TARGET", target.as_path()),
        ];
        let name = "schema_upgrade_activation_process_helper";
        let status = crash(name, &paths, phase)?;
        assert_eq!(status.code(), Some(73), "the child did not reach {phase}");
        if phase == 4 {
            // Killed before the unlink: the guard outlives the dead process and
            // the target is still refused, exactly as for an in-process fault.
            assert!(target.join(UPGRADE_GUARD).exists());
            assert!(Store::open(&target).is_err());
        } else {
            // Killed immediately after the unlink: the publication is complete,
            // and this version-2 build still refuses it as newer than supported
            // rather than treating a version-3 target as its own current schema.
            assert!(!target.join(UPGRADE_GUARD).exists());
            assert_eq!(Store::inspect(&target)?.storage_version(), Some(3));
            assert!(matches!(
                Store::open(&target),
                Err(crate::storage::StorageError::SchemaTooNew {
                    found: 3,
                    supported: 2
                })
            ));
        }
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
        assert_eq!(bytes(&workspace)?, before_workspace);
    }
    Ok(())
}

/// Real process kills bracketing `activate_inner`'s copy loop and its own
/// leased, native `open` call. `fault(2)` fires per file inside the copy
/// loop, the same per-file boundary this crate's other copy-loop tests
/// already use; `fault(3)` fires once, strictly after the copy loop and
/// its own `tree()` check both complete, but strictly before
/// `SchemaUpgradeSnapshot::open`. That open's own inline comment
/// ("Repeated because native recovery on open may rewrite files") reads
/// as a possible-mutation warning, but the open itself is always
/// `Db::open_read_only_with_options` -- the comment describes a
/// defensive, fail-closed re-check, not a write this build's own open
/// path actually performs. Both kill points here precede that call
/// regardless, so neither exercises it either way; a real kill during or
/// immediately after the open is not a boundary this function's own
/// `fault` callback currently exposes a hook for (the next hook,
/// `fault(4)`, already fires only after both the open and its re-check
/// have completed, and already has real-kill coverage via
/// `schema_upgrade_activation_child_exits_before_and_after_guard_unlink`,
/// above). What `fault(2)`/`fault(3)` do prove is the simpler, still
/// load-bearing property that a real, unwind-skipping process death
/// during the copy-and-verify sequence leaves the target exactly as
/// refused as an in-process fault at the same point would, via the guard
/// this function writes at `fault(0)` and only unlinks at the very end.
#[test]
fn schema_upgrade_activation_child_exits_during_the_copy_loop_and_before_the_native_open()
-> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root.path().join("workspace");
    sealed(&source, &package, &workspace, &options)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let before_workspace = bytes(&workspace)?;
    for phase in [2_u8, 3] {
        let target = root.path().join(format!("crash-{phase}"));
        let paths = [
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE", source.as_path()),
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE", package.as_path()),
            (
                "OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE",
                workspace.as_path(),
            ),
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_TARGET", target.as_path()),
        ];
        let name = "schema_upgrade_activation_process_helper";
        let status = crash(name, &paths, phase)?;
        assert_eq!(status.code(), Some(73), "the child did not reach {phase}");
        // Killed mid-copy (phase 2) or immediately after the copy loop's
        // own verification but before the native open (phase 3): the
        // guard outlives the dead process either way, so the target is
        // refused exactly as an in-process fault at the same point would
        // be.
        assert!(target.join(UPGRADE_GUARD).exists());
        assert!(Store::open(&target).is_err());
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
        assert_eq!(bytes(&workspace)?, before_workspace);
    }
    Ok(())
}

#[test]
#[expect(
    clippy::exit,
    reason = "bounded child models an exact schema-upgrade crash point"
)]
fn schema_upgrade_resume_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE") else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE")?;
    let stop = std::env::var("OXIGRAPH_SCHEMA_UPGRADE_TEST_EXIT_AT")?.parse::<u8>()?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    resume_inner(&source, &package, &workspace, &options, |phase| {
        if phase == stop {
            std::process::exit(73);
        }
        Ok(())
    })?;
    Err("the child returned instead of exiting at its crash point".into())
}

#[test]
#[expect(
    clippy::exit,
    reason = "bounded child models an exact schema-upgrade crash point"
)]
fn schema_upgrade_activation_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE") else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE")?;
    let target = variable("OXIGRAPH_SCHEMA_UPGRADE_TEST_TARGET")?;
    let stop = std::env::var("OXIGRAPH_SCHEMA_UPGRADE_TEST_EXIT_AT")?.parse::<u8>()?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    activate_inner(&source, &package, &workspace, &target, &options, |phase| {
        if phase == stop {
            std::process::exit(73);
        }
        Ok(())
    })?;
    Err("the child returned instead of exiting at its crash point".into())
}

#[test]
fn schema_upgrade_start_child_exits_before_and_after_the_initial_plan_is_synced() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let (source, package) = fixture(root.path())?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    for phase in [0_u8, 1] {
        // A fresh destination per phase: start_inner requires a not-yet-existing
        // directory, so the phase-0 crash's half-built workspace cannot be
        // reused for phase 1's own start attempt.
        let workspace = root.path().join(format!("start-crash-{phase}"));
        let paths = [
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE", source.as_path()),
            ("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE", package.as_path()),
            (
                "OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE",
                workspace.as_path(),
            ),
        ];
        let status = crash("schema_upgrade_start_process_helper", &paths, phase)?;
        assert_eq!(status.code(), Some(73), "the child did not reach {phase}");
        if phase == 0 {
            // Killed before the plan/journal are written and synced: the
            // directory exists (lease acquired, attempts/ created) but resume
            // has no durable plan to verify against, so it fails closed rather
            // than treating an unwritten plan as an empty one. The half-built
            // workspace is also left untouched by the failed resume attempt,
            // matching this file's other crash tests' byte-identity checks.
            let before_workspace = bytes(&workspace)?;
            assert!(Store::resume_schema_upgrade(&source, &package, &workspace, &options).is_err());
            assert_eq!(bytes(&workspace)?, before_workspace);
        } else {
            // Killed immediately after the plan/journal are synced: an
            // ordinary, fresh, in-process resume still completes the same
            // upgrade from that durable plan.
            let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
            assert!(state.receipt().is_some());
            SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
        }
        assert_eq!(bytes(&source)?, before_source);
        assert_eq!(bytes(&package)?, before_package);
    }
    Ok(())
}

#[test]
#[expect(
    clippy::exit,
    reason = "bounded child models an exact schema-upgrade crash point"
)]
fn schema_upgrade_start_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_TEST_SOURCE") else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_TEST_WORKSPACE")?;
    let stop = std::env::var("OXIGRAPH_SCHEMA_UPGRADE_TEST_EXIT_AT")?.parse::<u8>()?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    start_inner(&source, &package, &workspace, &options, |phase| {
        if phase == stop {
            std::process::exit(73);
        }
        Ok(())
    })?;
    Err("the child returned instead of exiting at its crash point".into())
}

/// Compiles a `/proc/self/fd`-scoped `ENOSPC`-injection shim, or `None`
/// when no C compiler is available: this fault is opt-in test
/// infrastructure, never a dependency of the crate's own build. Once
/// `LD_PRELOAD`ed into a fresh process, the shim intercepts the `write`
/// libc symbol Rust's `write_all` calls, for descriptors whose resolved
/// path starts with `ENOSPC_SHIM_PREFIX`, injecting a real `ENOSPC` once
/// a single write exceeds the remaining `ENOSPC_SHIM_BUDGET_BYTES`;
/// every other descriptor, and every other process on the machine,
/// passes through to the real `dlsym`-resolved libc function unmodified.
/// A `pwrite` symbol is defined too, but positioned writes on Linux
/// resolve to `pwrite64`, which this shim does not intercept.
/// `/proc/self/fd` and `LD_PRELOAD`-honoring dynamic linking are both
/// Linux-specific: the caller must skip this on any other OS. Compiled
/// next to the test binary itself, not into a temporary directory, since
/// a `noexec` mount there would silently make `LD_PRELOAD` a no-op.
/// Identical to `legacy_backup.rs`'s, `upgrade.rs`'s and
/// `upgrade_transform.rs`'s already-reviewed `compile_enospc_shim` of the
/// same name; duplicated file-local rather than shared, matching this
/// session's own established convention of file-local crash-test
/// infrastructure. `name` distinguishes each caller's own `.c`/`.so`
/// filenames: this file has eight ENOSPC tests, all runnable concurrently
/// under libtest's default multithreading, and an unparameterized shared
/// filename already raced for real once this exact situation arose with
/// just two tests in another file (`legacy_backup.rs`) -- fixed there and
/// in two further files at the time, and applied here proactively too
/// once flagged by an independent review, rather than waiting for this
/// file's own higher-concurrency exposure to produce a flake first.
///
/// One opt-in addition, local to this file: when `FSYNC_SHIM_EXACT_PATH`
/// is set, `fsync` and `fdatasync` fail with a real `EIO` for descriptors
/// whose resolved path equals that value exactly (not a prefix). Unset,
/// empty, or too long for the shim's buffer, both pass straight through
/// without even resolving the path, so every `ENOSPC`-only caller behaves
/// as before. Optional `FSYNC_SHIM_FAIL_ON_MATCH` selects one positive
/// matching-call ordinal across fsync/fdatasync; its counter is atomic.
/// Without it every exact match still fails, preserving earlier tests.
#[expect(
    clippy::print_stderr,
    reason = "diagnostic for a CI host missing a C compiler, opt-in test infrastructure only"
)]
fn compile_enospc_shim(directory: &Path, name: &str) -> TestResult<Option<PathBuf>> {
    const SOURCE: &str = r#"
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static long budget = -1;
static char prefix[4096];
static int prefix_len = 0;
static int initialized = 0;

static void init_once(void) {
    if (initialized) return;
    const char *b = getenv("ENOSPC_SHIM_BUDGET_BYTES");
    const char *p = getenv("ENOSPC_SHIM_PREFIX");
    budget = b ? atol(b) : -1;
    if (p) {
        size_t n = strlen(p);
        if (n >= sizeof(prefix)) n = sizeof(prefix) - 1;
        memcpy(prefix, p, n);
        prefix[n] = '\0';
        prefix_len = (int)n;
    }
    initialized = 1;
}

static int fd_in_scope(int fd) {
    if (prefix_len == 0) return 0;
    char linkpath[64];
    char target[4096];
    int n = snprintf(linkpath, sizeof(linkpath), "/proc/self/fd/%d", fd);
    if (n <= 0 || (size_t)n >= sizeof(linkpath)) return 0;
    ssize_t len = readlink(linkpath, target, sizeof(target) - 1);
    if (len <= 0) return 0;
    target[len] = '\0';
    return strncmp(target, prefix, (size_t)prefix_len) == 0;
}

static int should_inject(int fd, size_t count) {
    init_once();
    if (budget < 0 || !fd_in_scope(fd)) return 0;
    if ((long)count > budget) return 1;
    budget -= (long)count;
    return 0;
}

typedef ssize_t (*write_fn)(int, const void *, size_t);
typedef ssize_t (*pwrite_fn)(int, const void *, size_t, off_t);

ssize_t write(int fd, const void *buf, size_t count) {
    static write_fn real = NULL;
    if (!real) real = (write_fn)dlsym(RTLD_NEXT, "write");
    if (should_inject(fd, count)) { errno = ENOSPC; return -1; }
    return real(fd, buf, count);
}

ssize_t pwrite(int fd, const void *buf, size_t count, off_t offset) {
    static pwrite_fn real = NULL;
    if (!real) real = (pwrite_fn)dlsym(RTLD_NEXT, "pwrite");
    if (should_inject(fd, count)) { errno = ENOSPC; return -1; }
    return real(fd, buf, count, offset);
}

/* Stateless per call: no globals, so concurrent syncing threads cannot race. */
static int fd_is_exact_fsync_path(int fd) {
    const char *p = getenv("FSYNC_SHIM_EXACT_PATH");
    char linkpath[64];
    char target[4096];
    if (!p || p[0] == '\0' || strlen(p) >= sizeof(target)) return 0;
    int n = snprintf(linkpath, sizeof(linkpath), "/proc/self/fd/%d", fd);
    if (n <= 0 || (size_t)n >= sizeof(linkpath)) return 0;
    ssize_t len = readlink(linkpath, target, sizeof(target) - 1);
    if (len <= 0) return 0;
    target[len] = '\0';
    return strcmp(target, p) == 0;
}

typedef int (*fsync_fn)(int);

static _Atomic unsigned long fsync_matches = 0;

static int inject_exact_fsync(int fd) {
    if (!fd_is_exact_fsync_path(fd)) return 0;
    const char *value = getenv("FSYNC_SHIM_FAIL_ON_MATCH");
    if (!value) return 1;
    unsigned long wanted = 0;
    if (!*value) return 0;
    for (const char *p = value; *p; ++p) {
        if (*p < '0' || *p > '9') return 0;
        unsigned long digit = (unsigned long)(*p - '0');
        if (wanted > (ULONG_MAX - digit) / 10) return 0;
        wanted = wanted * 10 + digit;
    }
    if (!wanted) return 0;
    unsigned long previous = atomic_load_explicit(&fsync_matches, memory_order_relaxed);
    for (;;) {
        if (previous == ULONG_MAX) return 0;
        if (atomic_compare_exchange_weak_explicit(&fsync_matches, &previous,
                previous + 1, memory_order_relaxed, memory_order_relaxed))
            return previous + 1 == wanted;
    }
}

int fsync(int fd) {
    if (inject_exact_fsync(fd)) { errno = EIO; return -1; }
    fsync_fn real = (fsync_fn)dlsym(RTLD_NEXT, "fsync");
    return real(fd);
}

int fdatasync(int fd) {
    if (inject_exact_fsync(fd)) { errno = EIO; return -1; }
    fsync_fn real = (fsync_fn)dlsym(RTLD_NEXT, "fdatasync");
    return real(fd);
}
"#;
    let source_path = directory.join(format!(
        "oxigraph_schema_upgrade_activate_enospc_shim_{name}.c"
    ));
    fs::write(&source_path, SOURCE)?;
    let shared_object = directory.join(format!(
        "oxigraph_schema_upgrade_activate_enospc_shim_{name}.so"
    ));
    let status = match std::process::Command::new("cc")
        .arg("-shared")
        .arg("-fPIC")
        .arg("-O2")
        .arg("-o")
        .arg(&shared_object)
        .arg(&source_path)
        .arg("-ldl")
        .status()
    {
        Ok(status) => status,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            eprintln!("skipping disk-exhaustion coverage: no `cc` on this host");
            return Ok(None);
        }
        Err(error) => return Err(error.into()),
    };
    if !status.success() {
        return Err(format!("cc exited with {status}").into());
    }
    Ok(Some(shared_object))
}

/// A real `ENOSPC`, not a synthetic phase callback or a real process kill,
/// injected on the first byte of the activation guard write -- strictly
/// between `fault(0)` (fires right after `private_directory(&target)`) and
/// `fault(1)` (fires only after the guard is written and both directories
/// synced). This is a genuinely different boundary from the two existing
/// `activate_inner` tests: `schema_upgrade_activation_faults_never_leave_a_
/// usable_target` only injects synthetic `Cancelled` errors at integer
/// phases, and `schema_upgrade_activation_child_exits_before_and_after_
/// guard_unlink` real-kills at phases 4/5 -- the guard *unlink* boundary at
/// the very end of activation, not the guard *write* at the very start.
/// Neither can prove what happens when the OS itself, not a callback or a
/// signal, refuses the very first byte this function ever writes.
#[test]
fn disk_exhaustion_on_the_activation_guard_write_preserves_every_input() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "activation_guard")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root_path.join("workspace");
    sealed(&source, &package, &workspace, &options)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let before_workspace = bytes(&workspace)?;
    let target = root_path.join("activate-enospc");
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_activate_enospc_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
    command.env("ENOSPC_SHIM_PREFIX", &target);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_ENOSPC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_ENOSPC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_ENOSPC_TEST_WORKSPACE",
        &workspace,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_ENOSPC_TEST_TARGET",
        &target,
    );
    let status = command.status()?;
    assert!(status.success(), "child helper failed: {status:?}");
    // Only activate_inner's own write(&target.join(UPGRADE_GUARD), ...) call
    // creates this file (create_new, before the write that then fails), so
    // its existence is positive evidence the child reached real activation
    // work, not just that it exited 0; its zero length pins the fault to
    // that first write specifically, matching the existing synthetic test's
    // own established invariant that a guard-bearing target is never
    // openable.
    assert!(
        target.join(UPGRADE_GUARD).exists(),
        "the child never reached activate_inner's guard write"
    );
    assert_eq!(fs::metadata(target.join(UPGRADE_GUARD))?.len(), 0);
    assert!(Store::open(&target).is_err());
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    assert_eq!(bytes(&workspace)?, before_workspace);
    Ok(())
}

#[test]
fn schema_upgrade_activate_enospc_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_ENOSPC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_ENOSPC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_ENOSPC_TEST_WORKSPACE")?;
    let target = variable("OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_ENOSPC_TEST_TARGET")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::activate_schema_upgrade(&source, &package, &workspace, &target, &options);
    match result {
        Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
        other => Err(format!("expected a StorageFull BackupError::Io, got {other:?}").into()),
    }
}

/// A real `ENOSPC`, not a synthetic phase callback or a real process kill,
/// injected inside `activate_inner`'s copy loop -- strictly between
/// `fault(1)` and `fault(2)`, completing this function's own disk-exhaustion
/// coverage alongside `disk_exhaustion_on_the_activation_guard_write_
/// preserves_every_input` above, which covers the earlier guard-write
/// boundary (`fault(0)` to `fault(1)`). Reuses that test's own
/// `compile_enospc_shim` unmodified: both tests live in this same file, so
/// there is no second file-local copy to duplicate here, unlike the three
/// other files this session's LD_PRELOAD tests span.
///
/// The budget is deliberately set to exactly `GUARD.len()`, not zero: a
/// zero budget would fault on the guard write itself, a boundary already
/// covered above. Letting the guard write consume the whole budget (its
/// `write_all` call is `count == budget`, which `should_inject` does not
/// reject) and leaving zero remaining means the very next in-scope write --
/// the first non-empty file `copy_artifact` writes inside the loop -- fails
/// instead. A source file that happens to be empty never calls `write` at
/// all (`copy_artifact`'s own read/write loop breaks on a zero-byte read
/// before ever writing), so this pins the fault to the first *non-empty*
/// file in `expected`, not necessarily the very first file by iteration
/// order; `schema_upgrade_activation_faults_never_leave_a_usable_target`'s
/// own `stop == 2` case already establishes this fixture's copy loop
/// processes more than one file, so this is not an assumption unique to
/// this test.
#[test]
fn disk_exhaustion_during_the_activation_copy_loop_preserves_every_input() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "activation_copy")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let workspace = root_path.join("workspace");
    sealed(&source, &package, &workspace, &options)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let before_workspace = bytes(&workspace)?;
    let target = root_path.join("activate-copy-enospc");
    // The whole design rests on this budget being large enough to let the
    // guard write through but not zero: pin it explicitly rather than
    // leaving it an unstated premise of GUARD's own definition.
    assert!(!GUARD.is_empty());
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_activate_copy_enospc_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env("ENOSPC_SHIM_BUDGET_BYTES", GUARD.len().to_string());
    command.env("ENOSPC_SHIM_PREFIX", &target);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_COPY_ENOSPC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_COPY_ENOSPC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_COPY_ENOSPC_TEST_WORKSPACE",
        &workspace,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_COPY_ENOSPC_TEST_TARGET",
        &target,
    );
    let status = command.status()?;
    assert!(status.success(), "child helper failed: {status:?}");
    // The guard write's own budget was exactly consumed, not exceeded, so it
    // completed in full: this is genuine positive evidence the child passed
    // the earlier boundary and reached the copy loop specifically, not a
    // restatement of the guard-write test's own vacuous-pass guard.
    assert_eq!(
        fs::read(target.join(UPGRADE_GUARD))?,
        GUARD,
        "the guard write itself must have succeeded in full under this budget"
    );
    // At least one more entry exists beyond the guard: copy_artifact always
    // creates its destination via create_new before attempting to write it,
    // so even the failing file's own zero-byte stub is on disk.
    assert!(
        fs::read_dir(&target)?.count() >= 2,
        "the child never reached activate_inner's copy loop"
    );
    assert!(Store::open(&target).is_err());
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    assert_eq!(bytes(&workspace)?, before_workspace);
    Ok(())
}

#[test]
fn schema_upgrade_activate_copy_enospc_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_COPY_ENOSPC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_COPY_ENOSPC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_COPY_ENOSPC_TEST_WORKSPACE")?;
    let target = variable("OXIGRAPH_SCHEMA_UPGRADE_ACTIVATE_COPY_ENOSPC_TEST_TARGET")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::activate_schema_upgrade(&source, &package, &workspace, &target, &options);
    match result {
        Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
        other => Err(format!("expected a StorageFull BackupError::Io, got {other:?}").into()),
    }
}

/// A real `ENOSPC`, not a synthetic phase callback or a real process kill,
/// injected on the first byte of `start_inner`'s own plan write -- strictly
/// between `fault(0)` and `fault(1)`. This is the same boundary
/// `schema_upgrade_start_child_exits_before_and_after_the_initial_plan_is_
/// synced`'s `phase == 0` case already real-kills, but that test proves
/// only what a *process death* leaves behind (no `PLAN` file at all); this
/// proves what a real OS write failure leaves behind at the same boundary
/// (an empty `PLAN` file) -- a related but distinct on-disk state, both of
/// which `resume_schema_upgrade` must fail closed on rather than treat as
/// valid. The plan write is the same architectural shape as this crate's
/// very first disk-exhaustion test (`prepare_inner`'s journal write), for a
/// different function -- confirmed by direct reading before picking this
/// target, not assumed, since a structurally similar shape does not by
/// itself guarantee an identical error path (`transform_inner`'s journal
/// write turned out to surface as `BackupError::Storage(StorageError::Io(_))`
/// rather than the bare `BackupError::Io(_)` this test expects).
#[test]
fn disk_exhaustion_on_the_construction_plan_write_preserves_every_input() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "construction")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let workspace = root_path.join("construction-enospc");
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_construction_enospc_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
    command.env("ENOSPC_SHIM_PREFIX", &workspace);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_CONSTRUCTION_ENOSPC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_CONSTRUCTION_ENOSPC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_CONSTRUCTION_ENOSPC_TEST_WORKSPACE",
        &workspace,
    );
    let status = command.status()?;
    assert!(status.success(), "child helper failed: {status:?}");
    // Only start_inner's own write(&directory.join(PLAN), ...) call creates
    // this file (create_new, before the write that then fails), so its
    // existence is positive evidence the child reached real construction
    // work, not just that it exited 0; its zero length pins the fault to
    // that first write specifically.
    assert!(
        workspace.join(PLAN).exists(),
        "the child never reached start_inner's plan write"
    );
    assert_eq!(fs::metadata(workspace.join(PLAN))?.len(), 0);
    let before_workspace = bytes(&workspace)?;
    // Matches the existing real-kill test's own phase-0 invariant: a plan
    // that never finished writing fails closed on resume rather than being
    // treated as valid, whether it is entirely absent (the real-kill case)
    // or present but empty (this case).
    assert!(Store::resume_schema_upgrade(&source, &package, &workspace, &options).is_err());
    assert_eq!(bytes(&workspace)?, before_workspace);
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    Ok(())
}

#[test]
fn schema_upgrade_construction_enospc_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_CONSTRUCTION_ENOSPC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_CONSTRUCTION_ENOSPC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_CONSTRUCTION_ENOSPC_TEST_WORKSPACE")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::start_schema_upgrade(&source, &package, &workspace, &options);
    match result {
        Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
        other => Err(format!("expected a StorageFull BackupError::Io, got {other:?}").into()),
    }
}

/// A real `ENOSPC`, injected on the first byte of `resume_inner`'s own
/// attempt guard write -- strictly between `fault(0)` and `fault(1)`.
/// `resume_inner` has ten fault phases (0..=9); this is the first of them to
/// get real-OS-fault coverage, chosen only after directly auditing every
/// phase's own write shape rather than assuming the technique transfers
/// unchanged: the guard write here is `write(&path.join("store").join(
/// UPGRADE_GUARD), GUARD)?`, the exact same `UPGRADE_GUARD`/`GUARD`
/// constants and write shape already twice proven for `activate_inner` and
/// `activate_upgrade_inner`'s own guard writes.
///
/// The one genuinely new wrinkle `resume_inner` has that those two
/// functions do not: by the time `fault(0)` is reached, `append()` has
/// already durably written and fsynced an `INTENT` record to
/// `directory/JOURNAL` -- a real write, but strictly *before* `fault(0)`
/// and, critically, at the workspace root rather than inside the fresh
/// attempt directory `attempt_path` creates. Scoping `ENOSPC_SHIM_PREFIX`
/// to `workspace.join("attempts")` rather than the whole workspace excludes
/// that journal write from the fault's scope, so the guard write remains
/// the first in-scope write; the injection-point assertions below pin this
/// directly rather than leaving it as a claim from reading the code alone.
///
/// Because the `INTENT` record is already durable, this boundary is
/// architecturally closer to the existing real-process-kill mid-copy
/// recovery test than to `start_inner`'s own plan-write test: the fixture's
/// own exhaustive synthetic test
/// (`schema_upgrade_every_interruption_retains_uuid_and_prior_attempt_
/// bytes`) already proves a fresh resume recovers cleanly from a
/// synthetic-cancel at this exact phase, so a real OS fault here is
/// expected to recover the same way, not fail closed.
#[test]
fn disk_exhaustion_on_the_resume_guard_write_preserves_every_input() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_guard")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let workspace = root_path.join("resume-guard-enospc");
    let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let attempts = workspace.join("attempts");
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_resume_guard_enospc_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
    command.env("ENOSPC_SHIM_PREFIX", &attempts);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_GUARD_ENOSPC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_GUARD_ENOSPC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_GUARD_ENOSPC_TEST_WORKSPACE",
        &workspace,
    );
    let status = command.status()?;
    assert!(status.success(), "child helper failed: {status:?}");
    // The first (and, on a fresh workspace, only) attempt is always numbered
    // 0: only resume_inner's own guard write creates this file, so its
    // existence is positive evidence the child reached that write, and its
    // zero length pins the fault to that write's first byte specifically.
    let guard = attempts
        .join(format!("{:016}", 0_u64))
        .join("store")
        .join(UPGRADE_GUARD);
    assert!(
        guard.exists(),
        "the child never reached resume_inner's guard write"
    );
    assert_eq!(fs::metadata(&guard)?.len(), 0);
    let attempts_before = bytes(&attempts)?;
    // Matches schema_upgrade_every_interruption_retains_uuid_and_prior_
    // attempt_bytes's own phase-0 invariant: the durably-recorded INTENT
    // makes this attempt recoverable, not fatal, so a fresh in-process
    // resume completes the same upgrade rather than failing closed.
    let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
    assert_eq!(state.schema_uuid(), initial.schema_uuid());
    assert!(state.receipt().is_some());
    let attempts_after = bytes(&attempts)?;
    for (path, data) in attempts_before {
        assert_eq!(attempts_after.get(&path), Some(&data));
    }
    SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    Ok(())
}

#[test]
fn schema_upgrade_resume_guard_enospc_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_RESUME_GUARD_ENOSPC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_GUARD_ENOSPC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_GUARD_ENOSPC_TEST_WORKSPACE")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::resume_schema_upgrade(&source, &package, &workspace, &options);
    match result {
        Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
        other => Err(format!("expected a StorageFull BackupError::Io, got {other:?}").into()),
    }
}

/// A real `ENOSPC`, injected during `resume_inner`'s own copy loop -- strictly
/// between `fault(1)` and `fault(2)` -- using the same nonzero-budget
/// precision technique already proven for `activate_inner`'s and
/// `activate_upgrade_inner`'s own copy loops: a budget of exactly
/// `GUARD.len()` lets the preceding guard write through in full (`count ==
/// budget` does not satisfy the shim's `count > budget` injection test), then
/// leaves zero budget for the very next write, `copy_artifact`'s own first
/// file.
///
/// Unlike those two functions' copy-loop tests, which scope the fault to a
/// dedicated, single-purpose activation target directory, `resume_inner` has
/// no such separate destination at this stage: the guard write and every
/// copied file land under the same `workspace/attempts/<n>/` tree the guard-
/// write test already scoped `ENOSPC_SHIM_PREFIX` to. That prefix is reused
/// unchanged here. Because `inputs.receipt.files()` is not guaranteed to
/// order its entries so the first copy always lands under `store/`
/// specifically (some receipts also carry non-`store/` contributor files,
/// per `verify_output`'s own external/expected split), the vacuous-pass
/// guard below recursively snapshots the whole attempt directory with this
/// file's existing `bytes()` helper rather than assuming a fixed physical
/// layout the way the activation-style tests' flat `read_dir` count can.
///
/// As with the already-accepted activation-style copy-loop test, this pins
/// the fault to the first *non-empty* file `copy_artifact` writes, not
/// necessarily the very first file by iteration order: a file that happens
/// to be empty never calls `write` at all, so `fault(2)` for it is reached
/// without spending any budget, and the injection lands on whichever file
/// is first to actually attempt a nonzero write. The assertions below do
/// not depend on which specific file that is.
#[test]
fn disk_exhaustion_during_the_resume_copy_loop_preserves_every_input() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_copy")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let workspace = root_path.join("resume-copy-enospc");
    let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let attempts = workspace.join("attempts");
    // The whole design rests on this budget being large enough to let the
    // guard write through but not zero: pin it explicitly rather than
    // leaving it an unstated premise of GUARD's own definition.
    assert!(!GUARD.is_empty());
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_resume_copy_enospc_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env("ENOSPC_SHIM_BUDGET_BYTES", GUARD.len().to_string());
    command.env("ENOSPC_SHIM_PREFIX", &attempts);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_COPY_ENOSPC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_COPY_ENOSPC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_COPY_ENOSPC_TEST_WORKSPACE",
        &workspace,
    );
    let status = command.status()?;
    assert!(status.success(), "child helper failed: {status:?}");
    let attempt = attempts.join(format!("{:016}", 0_u64));
    // The guard write's own budget was exactly consumed, not exceeded, so it
    // completed in full: this is genuine positive evidence the child passed
    // the earlier boundary and reached the copy loop specifically, not a
    // restatement of the guard-write test's own vacuous-pass guard.
    assert_eq!(
        fs::read(attempt.join("store").join(UPGRADE_GUARD))?,
        GUARD,
        "the guard write itself must have succeeded in full under this budget"
    );
    // copy_artifact always creates its destination via create_new before
    // attempting to write it, so even the failing file's own zero-byte stub
    // is on disk somewhere under the attempt tree, regardless of whether it
    // landed under store/ or elsewhere.
    let files = bytes(&attempt)?;
    assert!(
        files.len() >= 2,
        "the child never reached resume_inner's copy loop"
    );
    // Every non-guard entry mirrors a real receipt file in the package,
    // pinning the stub to a genuine copy_artifact destination rather than
    // assuming any second attempt-local write must be one.
    let guard_path = Path::new("store").join(UPGRADE_GUARD);
    for path in files.keys() {
        if *path != guard_path {
            assert!(
                package.join(path).is_file(),
                "{path:?} is not a receipt file the copy loop could have created"
            );
        }
    }
    let attempts_before = bytes(&attempts)?;
    // Matches schema_upgrade_every_interruption_retains_uuid_and_prior_
    // attempt_bytes's own phase-1 invariant and the real-kill mid-copy
    // test's own recovery assertion: a fresh in-process resume completes
    // the same upgrade rather than failing closed.
    let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
    assert_eq!(state.schema_uuid(), initial.schema_uuid());
    assert!(state.receipt().is_some());
    let attempts_after = bytes(&attempts)?;
    for (path, data) in attempts_before {
        assert_eq!(attempts_after.get(&path), Some(&data));
    }
    SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    Ok(())
}

#[test]
fn schema_upgrade_resume_copy_enospc_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_RESUME_COPY_ENOSPC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_COPY_ENOSPC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_COPY_ENOSPC_TEST_WORKSPACE")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::resume_schema_upgrade(&source, &package, &workspace, &options);
    match result {
        Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
        other => Err(format!("expected a StorageFull BackupError::Io, got {other:?}").into()),
    }
}

/// A real `ENOSPC`, injected on `resume_inner`'s own `VALIDATED`-record
/// journal append -- strictly between `fault(5)` and `fault(6)` -- using a
/// genuinely new prefix-scoping variant: `ENOSPC_SHIM_PREFIX` names the
/// `JOURNAL` *file* itself, not a directory. `start_inner` creates this
/// file, empty, in the parent process before any child is ever spawned;
/// `append()` is the only function that ever *writes bytes* to it inside a
/// scoped child. The guard write, the copy loop, and `SchemaUpgradeSnapshot
/// ::open`/`write_envelope` all write under the completely disjoint
/// `directory/attempts/<n>/` tree, so none of them can ever match this
/// prefix, regardless of how much RocksDB-internal write volume they
/// involve. This sidesteps the problem that made a directory-scoped
/// approach to this same boundary intractable: scoping to the specific
/// file, rather than trying to account for every byte every intervening
/// RocksDB call writes, removes the need to know that volume at all.
///
/// On a fresh, never-before-resumed workspace, exactly one journal write
/// precedes this one: the `INTENT` record, appended strictly before
/// `fault(0)`. Its exact encoded length is computed here by calling
/// `frame()` directly -- the same private function `append()` itself
/// calls, accessible from this test module the same way `resume_inner`,
/// `attempt_path` and every other private helper already are -- rather
/// than guessing or hardcoding a byte count, matching this file's own
/// `GUARD.len()` discipline. A budget equal to that exact length lets the
/// `INTENT` append through in full (`count == budget`, which the shim's
/// `count > budget` check does not reject) and leaves zero budget for the
/// very next write to this file, the `VALIDATED` append.
///
/// Because the prefix cannot match any other write, a `StorageFull`
/// failure here can only mean the entire happy path up to `fault(5)` --
/// guard write, copy loop, RocksDB open/compare, `write_envelope` --
/// already succeeded: there is no other way to reach a second write to
/// this specific file. The journal's own exact bytes after the failed
/// attempt (precisely the `INTENT` frame, no more) are therefore both the
/// vacuous-pass guard and the injection-point pin in one assertion.
#[test]
fn disk_exhaustion_on_the_resume_validated_journal_write_preserves_every_input() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_validated")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let workspace = root_path.join("resume-validated-enospc");
    let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let journal = workspace.join(JOURNAL);
    let plan = fs::read(workspace.join(PLAN))?;
    let intent_frame = frame(
        &Record {
            kind: INTENT,
            attempt: 0,
            files: Vec::new(),
        },
        &envelope_checksum(PLAN_MAGIC, &plan),
    );
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command.arg("--exact").arg(helper(
        "schema_upgrade_resume_validated_enospc_process_helper",
    ));
    command.env("LD_PRELOAD", shim);
    command.env("ENOSPC_SHIM_BUDGET_BYTES", intent_frame.len().to_string());
    command.env("ENOSPC_SHIM_PREFIX", &journal);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_ENOSPC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_ENOSPC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_ENOSPC_TEST_WORKSPACE",
        &workspace,
    );
    let status = command.status()?;
    assert!(status.success(), "child helper failed: {status:?}");
    // Only the INTENT frame survives: a corrupted helper name (the child
    // never running resume_inner at all) leaves JOURNAL at the empty bytes
    // start_inner itself wrote, not this exact nonzero frame, so this is
    // also the vacuous-pass guard, not only the injection-point pin.
    assert_eq!(
        fs::read(&journal)?,
        intent_frame,
        "the journal must show exactly the INTENT record and nothing more"
    );
    let attempts_before = bytes(&workspace.join("attempts"))?;
    // Matches schema_upgrade_every_interruption_retains_uuid_and_prior_
    // attempt_bytes's own phase-5 invariant: a fresh in-process resume
    // completes the same upgrade rather than failing closed.
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
    Ok(())
}

#[test]
fn schema_upgrade_resume_validated_enospc_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) =
        std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_ENOSPC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_ENOSPC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_VALIDATED_ENOSPC_TEST_WORKSPACE")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::resume_schema_upgrade(&source, &package, &workspace, &options);
    match result {
        Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
        other => Err(format!("expected a StorageFull BackupError::Io, got {other:?}").into()),
    }
}

/// A real `ENOSPC`, injected on `resume_inner`'s own `SEALED`-record journal
/// append -- strictly between `fault(6)` and `fault(7)` -- reusing the
/// `VALIDATED`-append test's own `JOURNAL`-file prefix-scoping technique,
/// but with a genuinely different setup: this boundary is only reachable
/// when the journal *already* ends in a `VALIDATED` record, which
/// `resume_inner`'s own second top-level `if` block appends the `SEALED`
/// record for immediately, with no other write in between. Getting there
/// first, synthetically, via a direct `resume_inner(..., |phase| if phase
/// == 6 { Err(BackupError::Cancelled) } else { Ok(()) })` call -- the exact
/// technique `schema_upgrade_every_interruption_retains_uuid_and_prior_
/// attempt_bytes` already uses for every phase -- durably appends `INTENT`
/// and `VALIDATED` in this *parent* process, before any child is ever
/// spawned. The child's own first (and only) write to `JOURNAL` is then the
/// `SEALED` append itself, so budget `0` faults it on the first byte, the
/// same technique as the very first disk-exhaustion tests this session
/// wrote, not the nonzero-budget precision this file's other tests need.
///
/// This boundary has no filesystem artifact analogous to the guard file or
/// a copied file to serve as a vacuous-pass guard: nothing new is written
/// to disk between reaching this point and the `SEALED` append itself, so
/// the journal's own bytes are identical whether the child genuinely
/// attempted and failed the `SEALED` append or never ran at all (a
/// corrupted helper name still leaves the journal at the two frames this
/// test's own setup already wrote). Libtest's outer harness always prints
/// its own `running N test(s)` summary line regardless of output
/// capturing, so this test captures the child's stdout instead of only its
/// exit status and asserts that line reports one test, not zero -- the one
/// case in this file where a filesystem check is unavailable and inspecting
/// the harness's own unsuppressed summary output is the correct substitute.
#[test]
fn disk_exhaustion_on_the_resume_sealed_journal_write_preserves_every_input() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_sealed")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let workspace = root_path.join("resume-sealed-enospc");
    let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let error = resume_inner(&source, &package, &workspace, &options, |phase| {
        if phase == 6 {
            Err(BackupError::Cancelled)
        } else {
            Ok(())
        }
    });
    // Not just `is_err()`: any other failure before fault(6) (e.g. a real,
    // unrelated bug) would ALSO leave the journal short of VALIDATED, and
    // the child's fresh INTENT append would then satisfy every remaining
    // assertion below while silently testing the wrong boundary entirely.
    // Pinning the exact synthetic error rules that out.
    assert!(
        matches!(&error, Err(BackupError::Cancelled)),
        "phase 6 was not reached: {error:?}"
    );
    let journal = workspace.join(JOURNAL);
    let journal_before_child = fs::read(&journal)?;
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_resume_sealed_enospc_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env("ENOSPC_SHIM_BUDGET_BYTES", "0");
    command.env("ENOSPC_SHIM_PREFIX", &journal);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_SEALED_ENOSPC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_SEALED_ENOSPC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_SEALED_ENOSPC_TEST_WORKSPACE",
        &workspace,
    );
    let output = command.output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    assert!(
        output.status.success(),
        "child helper failed: status {:?}, stdout {stdout}, stderr {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        stdout.contains("running 1 test"),
        "the --exact filter did not match exactly one test: {stdout}"
    );
    // Budget 0 means the SEALED append cannot have written any byte at all:
    // the journal must be exactly what this test's own setup already wrote.
    assert_eq!(
        fs::read(&journal)?,
        journal_before_child,
        "the journal must still show only INTENT and VALIDATED"
    );
    let attempts_before = bytes(&workspace.join("attempts"))?;
    // Matches schema_upgrade_every_interruption_retains_uuid_and_prior_
    // attempt_bytes's own phase-6 invariant: a fresh in-process resume
    // completes the same upgrade rather than failing closed.
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
    Ok(())
}

#[test]
fn schema_upgrade_resume_sealed_enospc_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_RESUME_SEALED_ENOSPC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_SEALED_ENOSPC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_SEALED_ENOSPC_TEST_WORKSPACE")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::resume_schema_upgrade(&source, &package, &workspace, &options);
    match result {
        Err(BackupError::Io(error)) if error.kind() == io::ErrorKind::StorageFull => Ok(()),
        other => Err(format!("expected a StorageFull BackupError::Io, got {other:?}").into()),
    }
}

/// A real `ENOSPC` injected on `resume_inner`'s own `write_envelope` call --
/// strictly between `fault(3)` and `fault(4)` -- the first entry point in
/// this crate's whole disk-exhaustion suite to target a write RocksDB's own
/// vendored C++ code makes, not a write this crate's own Rust code issues
/// directly. Resolved as tractable, not infeasible, by reading RocksDB's
/// real vendored source rather than assuming: `write_envelope`'s
/// `db.insert()` then `db.flush()` go through `PosixWritableFile::Append`
/// (`oxrocksdb-sys/rocksdb/env/io_posix.cc`), whose own body is a plain
/// `write(fd, ...)` loop -- the exact libc symbol this crate's shim already
/// intercepts -- since this crate configures no `direct_io`/`io_uring` for
/// ordinary writes, which would otherwise route through the unintercepted
/// `pwrite`-based `PositionedAppend` path instead.
///
/// `SchemaUpgradeSnapshot::open`'s own read-only inspection (`fault(2)` to
/// `fault(3)`) performs zero writes -- confirmed via `Db::open_read_only_
/// with_options`, RocksDB's own dedicated read-only entry point -- so it
/// never counts against any budget scoped under `store/`. This means the
/// only writes ever in scope for an `ENOSPC_SHIM_PREFIX` of `<attempt>/
/// store` before `write_envelope` itself are the guard write and the copy
/// loop's own files: `resume_inner`'s own "last record is INTENT" branch
/// means any fresh process invocation that reaches `write_envelope` must,
/// within that same process, first complete that entire sequence -- there
/// is no way to synthetically pre-drive the workspace past it in the
/// parent process, unlike every other boundary's own append-based
/// technique. The budget is therefore the sum of `GUARD.len()` and every
/// byte the copy loop will write, computed by summing `package/store`'s
/// own real bytes rather than guessing: whatever non-`store/` contributor
/// files a receipt might also carry (see the copy-loop test's own doc
/// comment above) are copied to targets outside this exact prefix and so
/// never count against it either way, so this sum is correct regardless
/// of whether any exist.
#[test]
fn disk_exhaustion_on_the_resume_schema_envelope_write_preserves_every_input() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_envelope")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let workspace = root_path.join("resume-envelope-enospc");
    let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
    let attempts = workspace.join("attempts");
    let attempt = attempts.join(format!("{:016}", 0_u64));
    let store = attempt.join("store");
    let copy_budget: u64 = bytes(&package.join("store"))?
        .values()
        .map(|value| value.len() as u64)
        .sum();
    let budget = GUARD.len() as u64 + copy_budget;
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command.arg("--exact").arg(helper(
        "schema_upgrade_resume_envelope_enospc_process_helper",
    ));
    command.env("LD_PRELOAD", shim);
    command.env("ENOSPC_SHIM_BUDGET_BYTES", budget.to_string());
    command.env("ENOSPC_SHIM_PREFIX", &store);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_ENVELOPE_ENOSPC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_ENVELOPE_ENOSPC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_ENVELOPE_ENOSPC_TEST_WORKSPACE",
        &workspace,
    );
    let status = command.status()?;
    assert!(status.success(), "child helper failed: {status:?}");
    // The guard write's and every copied file's own budget was exactly
    // consumed, not exceeded, so both completed in full: positive evidence
    // the child passed the guard and copy-loop boundaries and reached
    // SchemaUpgradeSnapshot::open/write_envelope specifically, not a
    // restatement of the guard-write or copy-loop tests' own vacuous-pass
    // guards. Whether write_envelope's own fault leaves a fresh zero-byte
    // file or appends nothing to an already-copied one, the copied total
    // excluding the guard is unaffected either way, so this holds exactly,
    // not approximately.
    assert_eq!(
        fs::metadata(store.join(UPGRADE_GUARD))?.len(),
        GUARD.len() as u64,
        "the guard write itself must have succeeded in full under this budget"
    );
    let copied = bytes(&store)?;
    let guard_path = PathBuf::from(UPGRADE_GUARD);
    let copied_total: u64 = copied
        .iter()
        .filter(|(path, _)| **path != guard_path)
        .map(|(_, data)| data.len() as u64)
        .sum();
    assert_eq!(
        copied_total, copy_budget,
        "the copy loop must have completed in full before SchemaUpgradeSnapshot::open ran"
    );
    let attempts_before = bytes(&attempts)?;
    // Matches schema_upgrade_every_interruption_retains_uuid_and_prior_
    // attempt_bytes's own invariant: a fresh in-process resume completes
    // the same upgrade rather than failing closed.
    let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
    assert_eq!(state.schema_uuid(), initial.schema_uuid());
    assert!(state.receipt().is_some());
    let attempts_after = bytes(&attempts)?;
    for (path, data) in attempts_before {
        assert_eq!(attempts_after.get(&path), Some(&data));
    }
    SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    Ok(())
}

#[test]
fn schema_upgrade_resume_envelope_enospc_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) =
        std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_RESUME_ENVELOPE_ENOSPC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_ENVELOPE_ENOSPC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_ENVELOPE_ENOSPC_TEST_WORKSPACE")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::resume_schema_upgrade(&source, &package, &workspace, &options);
    match result {
        // write_envelope's errors come from RocksDB (via SchemaUpgradeSnapshot,
        // a crate::storage type), wrapped through StorageError -- unlike every
        // other resume_inner boundary in this file, which faults this crate's
        // own plain write() helper and surfaces bare BackupError::Io instead.
        Err(BackupError::Storage(crate::storage::StorageError::Io(error)))
            if error.kind() == io::ErrorKind::StorageFull =>
        {
            Ok(())
        }
        other => Err(format!(
            "expected a StorageFull BackupError::Storage(StorageError::Io(_)), got {other:?}"
        )
        .into()),
    }
}

/// A real `EIO` from `fsync`, not a synthetic phase callback, a real process
/// kill or a write failure, injected on `start_inner`'s own `JOURNAL` file
/// sync -- strictly between `fault(0)` and `fault(1)`, after the complete
/// `PLAN` write and its own sync have succeeded, and before any of the three
/// directory syncs run. `FSYNC_SHIM_EXACT_PATH` names the `JOURNAL` file
/// itself, so every other `fsync`/`fdatasync` in the child (the `PLAN` sync,
/// the directory syncs, every RocksDB sync) passes through unmodified; no
/// `ENOSPC_SHIM_*` variable is passed, so every `write` passes through too.
/// The resulting state -- a complete `PLAN`, an empty `JOURNAL`, an empty
/// `attempts/` -- differs from both the phase-0 real kill (no `PLAN`) and
/// the plan-write `ENOSPC` (an empty `PLAN`).
///
/// The child is bounded: its stdin is null and its stdout/stderr go to files
/// in this test's own temporary root (outside source, package and
/// workspace), so no pipe can fill and block it. It is polled against a
/// fixed deadline and, if it has not exited by then, killed and reaped
/// before the test fails. Its captured output is read only after it has
/// been reaped, bounded per stream.
///
/// This models only a kernel reporting a writeback error for one file while
/// its page cache stays visible on the same machine. It makes no power-loss
/// or on-media durability claim, and it is one fsync point only, not a
/// closure of the crash matrix: the directory syncs, `append`'s `sync_all`,
/// `PENDING` and every activation sync still lack real fsync-error coverage.
#[test]
fn fsync_failure_on_the_start_journal_preserves_inputs_and_resumes() -> TestResult {
    use std::io::Read as _;
    const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
    const CAPTURE_LIMIT: u64 = 1 << 20;
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "start_journal_fsync")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let workspace = root_path.join("start-journal-fsync");
    let journal = workspace.join(JOURNAL);
    let stdout_path = root_path.join("start-journal-fsync.stdout");
    let stderr_path = root_path.join("start-journal-fsync.stderr");
    let captured = |path: &Path| -> TestResult<String> {
        let mut data = Vec::new();
        fs::File::open(path)?
            .take(CAPTURE_LIMIT)
            .read_to_end(&mut data)?;
        Ok(String::from_utf8_lossy(&data).into_owned())
    };
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_start_journal_fsync_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env_remove("ENOSPC_SHIM_BUDGET_BYTES");
    command.env_remove("ENOSPC_SHIM_PREFIX");
    command.env("FSYNC_SHIM_EXACT_PATH", &journal);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_START_JOURNAL_FSYNC_TEST_SOURCE",
        &source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_START_JOURNAL_FSYNC_TEST_PACKAGE",
        &package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_START_JOURNAL_FSYNC_TEST_WORKSPACE",
        &workspace,
    );
    command.stdin(std::process::Stdio::null());
    command.stdout(fs::File::create(&stdout_path)?);
    command.stderr(fs::File::create(&stderr_path)?);
    let mut child = command.spawn()?;
    let deadline = std::time::Instant::now() + TIMEOUT;
    let waited = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Ok(None) => break Err(io::Error::new(io::ErrorKind::TimedOut, "deadline passed")),
            Err(error) => break Err(error),
        }
    };
    let status = match waited {
        Ok(status) => status,
        Err(error) => {
            // Never leave the child running or unreaped, whatever went wrong.
            let killed = child.kill();
            let reaped = child.wait();
            return Err(format!(
                "child helper did not exit within {TIMEOUT:?} ({error}); kill {killed:?}, \
                 reap {reaped:?}, stdout {}, stderr {}",
                captured(&stdout_path)?,
                captured(&stderr_path)?
            )
            .into());
        }
    };
    let stdout = captured(&stdout_path)?;
    assert!(
        status.success(),
        "child helper failed: status {status:?}, stdout {stdout}, stderr {}",
        captured(&stderr_path)?
    );
    assert!(
        stdout.contains("running 1 test"),
        "the --exact filter did not match exactly one test: {stdout}"
    );
    // The helper only succeeds on the injected EIO, so the child reached the
    // JOURNAL sync. The complete PLAN and empty JOURNAL pin that point: after
    // the plan write, before any journal record or directory sync.
    let plan = fs::read(workspace.join(PLAN))?;
    assert!(
        plan.starts_with(PLAN_MAGIC),
        "the plan must have been written in full before the journal sync"
    );
    assert_eq!(
        fs::metadata(&journal)?.len(),
        0,
        "the journal must still be the empty file start_inner created"
    );
    assert_eq!(fs::read_dir(workspace.join("attempts"))?.count(), 0);
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    // Restart contract, refusal half: the workspace already exists, so a
    // second start is refused without touching it.
    let before_workspace = bytes(&workspace)?;
    assert!(Store::start_schema_upgrade(&source, &package, &workspace, &options).is_err());
    assert_eq!(bytes(&workspace)?, before_workspace);
    // Restart contract, resume half: the visible PLAN verifies and the empty
    // JOURNAL means a first INTENT, not an abandoned attempt.
    let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)?;
    assert!(state.receipt().is_some());
    assert_eq!(
        fs::read(workspace.join(PLAN))?,
        plan,
        "resume must reuse the existing plan, not rewrite it"
    );
    let attempts = workspace.join("attempts");
    assert!(attempts.join(format!("{:016}", 0_u64)).exists());
    assert!(
        !attempts.join(format!("{:016}", 1_u64)).exists(),
        "an empty journal must not cause an abandoned attempt"
    );
    SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?;
    assert_eq!(bytes(&source)?, before_source);
    assert_eq!(bytes(&package)?, before_package);
    Ok(())
}

#[test]
fn schema_upgrade_start_journal_fsync_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_START_JOURNAL_FSYNC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_START_JOURNAL_FSYNC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_START_JOURNAL_FSYNC_TEST_WORKSPACE")?;
    let options = SchemaUpgradeOptions::new(SchemaRdfProfile::Rdf11);
    let result = Store::start_schema_upgrade(&source, &package, &workspace, &options);
    match result {
        // Only the shim's exact-path fsync produces EIO on this path: a start
        // that never syncs JOURNAL, or fails anywhere else, cannot match.
        Err(BackupError::Io(error)) if error.raw_os_error() == Some(libc::EIO) => Ok(()),
        other => Err(format!("expected an EIO BackupError::Io, got {other:?}").into()),
    }
}

/// Runs one bounded `start_inner` fsync-matrix child under the shim, failing
/// unless it exited successfully after running exactly one test.
fn run_start_fsync_child(
    shim: &Path,
    exact: &Path,
    paths: [&Path; 3],
    rdf12: bool,
    logs: &Path,
    label: &str,
) -> TestResult {
    use std::io::Read as _;
    const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
    const CAPTURE_LIMIT: u64 = 1 << 20;
    let [source, package, workspace] = paths;
    let stdout_path = logs.join(format!("start-fsync-{label}.stdout"));
    let stderr_path = logs.join(format!("start-fsync-{label}.stderr"));
    let captured = |path: &Path| -> TestResult<String> {
        let mut data = Vec::new();
        fs::File::open(path)?
            .take(CAPTURE_LIMIT)
            .read_to_end(&mut data)?;
        Ok(String::from_utf8_lossy(&data).into_owned())
    };
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_start_fsync_matrix_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env_remove("ENOSPC_SHIM_BUDGET_BYTES");
    command.env_remove("ENOSPC_SHIM_PREFIX");
    command.env("FSYNC_SHIM_EXACT_PATH", exact);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_START_FSYNC_MATRIX_TEST_SOURCE",
        source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_START_FSYNC_MATRIX_TEST_PACKAGE",
        package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_START_FSYNC_MATRIX_TEST_WORKSPACE",
        workspace,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_START_FSYNC_MATRIX_TEST_RDF12",
        if rdf12 { "1" } else { "0" },
    );
    command.stdin(std::process::Stdio::null());
    command.stdout(fs::File::create(&stdout_path)?);
    command.stderr(fs::File::create(&stderr_path)?);
    let mut child = command.spawn()?;
    let deadline = std::time::Instant::now() + TIMEOUT;
    let waited = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Ok(None) => break Err(io::Error::new(io::ErrorKind::TimedOut, "deadline passed")),
            Err(error) => break Err(error),
        }
    };
    let status = match waited {
        Ok(status) => status,
        Err(error) => {
            // Never leave the child running or unreaped, whatever went wrong.
            let killed = child.kill();
            let reaped = child.wait();
            return Err(format!(
                "{label}: child helper did not exit within {TIMEOUT:?} ({error}); kill \
                 {killed:?}, reap {reaped:?}, stdout {}, stderr {}",
                captured(&stdout_path)?,
                captured(&stderr_path)?
            )
            .into());
        }
    };
    let stdout = captured(&stdout_path)?;
    assert!(
        status.success(),
        "{label}: child helper failed: status {status:?}, stdout {stdout}, stderr {}",
        captured(&stderr_path)?
    );
    assert!(
        stdout.contains("running 1 test"),
        "{label}: the --exact filter did not match exactly one test: {stdout}"
    );
    Ok(())
}

/// A real `EIO` from `fsync`, injected on exactly one of `start_inner`'s
/// ordered syncs per case: the `PLAN` file, then the `attempts/`, workspace
/// and parent directories, each for both RDF profiles. `FSYNC_SHIM_EXACT_PATH`
/// names that one path in a child-only destination, so setup and the
/// source/backup syncs pass. The helper succeeds only on a raw `EIO` with
/// `fault(0)` seen and `fault(1)` not, so an earlier or different failure
/// fails loudly. A failed fsync does not imply absent bytes: the `PLAN` case
/// leaves a complete visible `PLAN` and no `JOURNAL`; the directory cases
/// leave a complete `PLAN` and an empty `JOURNAL`. Directory-sync order is not
/// observable on disk, so each case is pinned by its exact path, once.
///
/// The restart contract is derived from the verify/resume code: nothing is
/// sealed, `verify` fails, a same-path start is refused with `InvalidPath`,
/// a missing `JOURNAL` fails closed on resume without repair, and an empty
/// `JOURNAL` resumes into a first attempt without abandoning one.
///
/// This models a kernel-reported writeback error with the page cache still
/// visible. It makes no power-loss or on-media claim and does not close the
/// resume/activation fsyncs or profile admission.
#[test]
fn fsync_failure_on_start_plan_and_directories_preserves_inputs_and_restarts() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "start_fsync_matrix")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    // (case, exact path components under the parent, whether JOURNAL exists)
    let cases: [(&str, &[&str], bool); 4] = [
        ("plan", &["workspace", PLAN], false),
        ("attempts", &["workspace", "attempts"], true),
        ("workspace", &["workspace"], true),
        ("parent", &[], true),
    ];
    for (name, components, journal_created) in cases {
        for rdf12 in [false, true] {
            let label = format!("{name}-{}", if rdf12 { "rdf12" } else { "rdf11" });
            let profile = if rdf12 {
                SchemaRdfProfile::Rdf12
            } else {
                SchemaRdfProfile::Rdf11
            };
            let options = SchemaUpgradeOptions::new(profile);
            let holder = tempfile::tempdir_in(&root_path)?;
            let parent = holder.path().canonicalize()?;
            let workspace = parent.join("workspace");
            let exact = components
                .iter()
                .fold(parent.clone(), |path, part| path.join(part));
            run_start_fsync_child(
                &shim,
                &exact,
                [&source, &package, &workspace],
                rdf12,
                &root_path,
                &label,
            )?;
            // The complete PLAN write is proven by its own trailing checksum,
            // derived from the plan encoding, not copied from a failure.
            let plan = fs::read(workspace.join(PLAN))?;
            assert!(
                plan.len() >= PLAN_MAGIC.len() + 32 && plan.starts_with(PLAN_MAGIC),
                "{label}: the plan is not a complete visible plan"
            );
            let (body, trailer) = plan.split_at(plan.len() - 32);
            assert_eq!(
                trailer,
                envelope_checksum(PLAN_MAGIC, body).as_slice(),
                "{label}: the plan checksum does not match its body"
            );
            let mut names = Vec::new();
            for entry in fs::read_dir(&workspace)? {
                names.push(entry?.file_name().to_string_lossy().into_owned());
            }
            names.sort();
            let mut expected = vec![
                PLAN.to_owned(),
                WORKSPACE_LOCK.to_owned(),
                "attempts".to_owned(),
            ];
            if journal_created {
                expected.push(JOURNAL.to_owned());
            }
            expected.sort();
            assert_eq!(names, expected, "{label}: unexpected workspace entries");
            assert_eq!(fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(), 0);
            assert!(!workspace.join(COMPLETE).exists(), "{label}: COMPLETE");
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            if journal_created {
                assert_eq!(fs::metadata(workspace.join(JOURNAL))?.len(), 0, "{label}");
            }
            let attempts = workspace.join("attempts");
            assert!(
                bytes(&attempts)?.is_empty() && fs::read_dir(&attempts)?.count() == 0,
                "{label}: attempts must still be empty"
            );
            assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
            assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
            let before_workspace = bytes(&workspace)?;
            // Restart contract: nothing is sealed and no receipt is accepted.
            let verified = SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options);
            assert!(verified.is_err(), "{label}: verify accepted {verified:?}");
            assert_eq!(bytes(&workspace)?, before_workspace, "{label}");
            // The workspace path exists, so a same-path start is refused.
            let refused = Store::start_schema_upgrade(&source, &package, &workspace, &options);
            assert!(
                matches!(refused, Err(BackupError::InvalidPath)),
                "{label}: same-path start gave {refused:?}"
            );
            assert_eq!(bytes(&workspace)?, before_workspace, "{label}");
            let resumed = Store::resume_schema_upgrade(&source, &package, &workspace, &options);
            if journal_created {
                let state =
                    resumed.map_err(|error| format!("{label}: resume failed: {error:?}"))?;
                let receipt = state.receipt().ok_or("resume did not seal the workspace")?;
                assert_eq!(receipt.envelope().rdf_write_profile(), profile, "{label}");
                assert_eq!(fs::read(workspace.join(PLAN))?, plan, "{label}: plan");
                assert!(
                    attempts.join(format!("{:016}", 0_u64)).exists(),
                    "{label}: no first attempt"
                );
                assert!(
                    !attempts.join(format!("{:016}", 1_u64)).exists(),
                    "{label}: an empty journal must not cause an abandoned attempt"
                );
                assert!(workspace.join(COMPLETE).exists(), "{label}: COMPLETE");
                assert_eq!(
                    &SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?,
                    receipt,
                    "{label}"
                );
            } else {
                // A missing JOURNAL fails closed and resume repairs nothing.
                assert!(
                    matches!(&resumed, Err(BackupError::Io(error))
                        if error.kind() == io::ErrorKind::NotFound),
                    "{label}: resume gave {resumed:?}"
                );
                assert_eq!(bytes(&workspace)?, before_workspace, "{label}");
                assert!(!workspace.join(JOURNAL).exists(), "{label}: JOURNAL");
                assert_eq!(fs::read_dir(&attempts)?.count(), 0, "{label}: attempts");
            }
            assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
            assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
        }
    }
    Ok(())
}

#[test]
fn schema_upgrade_start_fsync_matrix_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_START_FSYNC_MATRIX_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_START_FSYNC_MATRIX_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_START_FSYNC_MATRIX_TEST_WORKSPACE")?;
    let profile =
        match std::env::var("OXIGRAPH_SCHEMA_UPGRADE_START_FSYNC_MATRIX_TEST_RDF12")?.as_str() {
            "0" => SchemaRdfProfile::Rdf11,
            "1" => SchemaRdfProfile::Rdf12,
            other => return Err(format!("unexpected rdf12 flag {other:?}").into()),
        };
    let options = SchemaUpgradeOptions::new(profile);
    let mut phases = Vec::new();
    let result = start_inner(&source, &package, &workspace, &options, |phase| {
        phases.push(phase);
        Ok(())
    });
    match result {
        // Only the shim's exact-path fsync yields EIO, and phases == [0] pins
        // it between fault(0) and fault(1): a lease, setup or earlier sync
        // failure would show no phase, and a completed start would show both.
        Err(BackupError::Io(error)) if error.raw_os_error() == Some(libc::EIO) && phases == [0] => {
            Ok(())
        }
        other => {
            Err(format!("expected an EIO BackupError::Io, got {other:?}, phases {phases:?}").into())
        }
    }
}

/// Runs one bounded `resume_inner` pre-copy fsync child under the shim, failing
/// unless it exited successfully after running exactly one test.
fn run_resume_precopy_fsync_child(
    shim: &Path,
    exact: &Path,
    paths: [&Path; 3],
    rdf12: bool,
    expect_fault0: bool,
    logs: &Path,
    label: &str,
) -> TestResult {
    use std::io::Read as _;
    const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
    const CAPTURE_LIMIT: u64 = 1 << 20;
    let [source, package, workspace] = paths;
    let stdout_path = logs.join(format!("resume-precopy-fsync-{label}.stdout"));
    let stderr_path = logs.join(format!("resume-precopy-fsync-{label}.stderr"));
    let captured = |path: &Path| -> TestResult<String> {
        let mut data = Vec::new();
        fs::File::open(path)?
            .take(CAPTURE_LIMIT)
            .read_to_end(&mut data)?;
        Ok(String::from_utf8_lossy(&data).into_owned())
    };
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--exact")
        .arg(helper("schema_upgrade_resume_precopy_fsync_process_helper"));
    command.env("LD_PRELOAD", shim);
    command.env_remove("ENOSPC_SHIM_BUDGET_BYTES");
    command.env_remove("ENOSPC_SHIM_PREFIX");
    command.env("FSYNC_SHIM_EXACT_PATH", exact);
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_SOURCE",
        source,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_PACKAGE",
        package,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_WORKSPACE",
        workspace,
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_RDF12",
        if rdf12 { "1" } else { "0" },
    );
    command.env(
        "OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_EXPECT_FAULT0",
        if expect_fault0 { "1" } else { "0" },
    );
    command.stdin(std::process::Stdio::null());
    command.stdout(fs::File::create(&stdout_path)?);
    command.stderr(fs::File::create(&stderr_path)?);
    let mut child = command.spawn()?;
    let deadline = std::time::Instant::now() + TIMEOUT;
    let waited = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Ok(None) => break Err(io::Error::new(io::ErrorKind::TimedOut, "deadline passed")),
            Err(error) => break Err(error),
        }
    };
    let status = match waited {
        Ok(status) => status,
        Err(error) => {
            // Never leave the child running or unreaped, whatever went wrong.
            let killed = child.kill();
            let reaped = child.wait();
            return Err(format!(
                "{label}: child helper did not exit within {TIMEOUT:?} ({error}); kill \
                 {killed:?}, reap {reaped:?}, stdout {}, stderr {}",
                captured(&stdout_path)?,
                captured(&stderr_path)?
            )
            .into());
        }
    };
    let stdout = captured(&stdout_path)?;
    assert!(
        status.success(),
        "{label}: child helper failed: status {status:?}, stdout {stdout}, stderr {}",
        captured(&stderr_path)?
    );
    assert!(
        stdout.contains("running 1 test"),
        "{label}: the --exact filter did not match exactly one test: {stdout}"
    );
    Ok(())
}

/// Real `EIO` from `fsync` on each pre-copy sync of `resume_inner`: JOURNAL (INTENT append), attempt guard, `store/`, attempt and `attempts/` directories, on both RDF profiles.
///
/// The parent starts the workspace with no shim; the shim env is set only on the resume child, and the helper passes only on raw EIO with the expected fault phases.
///
/// A failed fsync keeps page-cache bytes: JOURNAL holds the full INTENT frame in every case, and the four attempt-side cases leave a complete guard. Restart abandons the INTENT attempt (FAILED, then a new attempt) and seals with the same UUID.
///
/// Models a kernel writeback error only: no power-loss, on-media, activation or profile-admission claim.
#[test]
fn resume_precopy_fsync_failure_matrix_preserves_inputs_and_restarts() -> TestResult {
    if !cfg!(target_os = "linux") {
        return Ok(());
    }
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let shim_directory = std::env::current_exe()?
        .parent()
        .ok_or("test binary has no parent directory")?
        .to_owned();
    let Some(shim) = compile_enospc_shim(&shim_directory, "resume_precopy_fsync")? else {
        return Ok(()); // No C compiler available: this fault is opt-in infrastructure.
    };
    let root = tempfile::tempdir()?;
    let root_path = root.path().canonicalize()?;
    let (source, package) = fixture(&root_path)?;
    let before_source = bytes(&source)?;
    let before_package = bytes(&package)?;
    let first = format!("{:016}", 0_u64);
    let entry_names = |path: &Path| -> TestResult<Vec<String>> {
        let mut names = Vec::new();
        for entry in fs::read_dir(path)? {
            names.push(entry?.file_name().to_string_lossy().into_owned());
        }
        names.sort();
        Ok(names)
    };
    // (case, whether resume_inner reaches fault(0), i.e. the attempt directories exist)
    let cases: [(&str, bool); 5] = [
        ("journal", false),
        ("guard", true),
        ("store", true),
        ("attempt", true),
        ("attempts", true),
    ];
    for (name, fault0) in cases {
        for rdf12 in [false, true] {
            let label = format!("{name}-{}", if rdf12 { "rdf12" } else { "rdf11" });
            let profile = if rdf12 {
                SchemaRdfProfile::Rdf12
            } else {
                SchemaRdfProfile::Rdf11
            };
            let options = SchemaUpgradeOptions::new(profile);
            let holder = tempfile::tempdir_in(&root_path)?;
            let parent = holder.path().canonicalize()?;
            let workspace = parent.join("workspace");
            // Start runs here in the parent, with no fsync shim in its environment.
            let initial = Store::start_schema_upgrade(&source, &package, &workspace, &options)?;
            let plan_path = workspace.join(PLAN);
            let plan = fs::read(&plan_path)?;
            let journal = workspace.join(JOURNAL);
            let attempts = workspace.join("attempts");
            let attempt = attempt_path(&workspace, 0);
            assert!(plan.starts_with(PLAN_MAGIC), "{label}: plan");
            assert_eq!(fs::metadata(&journal)?.len(), 0, "{label}: journal");
            assert_eq!(fs::read_dir(&attempts)?.count(), 0, "{label}: attempts");
            assert!(!attempt.exists(), "{label}: attempt exists before resume");
            let exact = match name {
                "journal" => journal.clone(),
                "guard" => attempt.join("store").join(UPGRADE_GUARD),
                "store" => attempt.join("store"),
                "attempt" => attempt.clone(),
                _ => attempts.clone(),
            };
            let intent_frame = frame(
                &Record {
                    kind: INTENT,
                    attempt: 0,
                    files: Vec::new(),
                },
                &envelope_checksum(PLAN_MAGIC, &plan),
            );
            run_resume_precopy_fsync_child(
                &shim,
                &exact,
                [&source, &package, &workspace],
                rdf12,
                fault0,
                &root_path,
                &label,
            )?;
            // The helper only passes on raw EIO with the expected fault phases,
            // so the child failed at the intended exact path.
            assert!(exact.exists(), "{label}: the exact path was never created");
            assert_eq!(fs::read(&plan_path)?, plan, "{label}: plan changed");
            // fsync EIO keeps the page-cache bytes: the whole INTENT frame is visible.
            assert_eq!(fs::read(&journal)?, intent_frame, "{label}: journal");
            let mut expected = vec![
                JOURNAL.to_owned(),
                PLAN.to_owned(),
                WORKSPACE_LOCK.to_owned(),
                "attempts".to_owned(),
            ];
            expected.sort();
            assert_eq!(entry_names(&workspace)?, expected, "{label}: entries");
            assert_eq!(fs::metadata(workspace.join(WORKSPACE_LOCK))?.len(), 0);
            assert!(!workspace.join(COMPLETE).exists(), "{label}: COMPLETE");
            assert!(!workspace.join(PENDING).exists(), "{label}: PENDING");
            let attempts_before = bytes(&attempts)?;
            if fault0 {
                assert_eq!(entry_names(&attempts)?, vec![first.clone()], "{label}");
                assert_eq!(entry_names(&attempt)?, vec!["store".to_owned()], "{label}");
                assert_eq!(
                    entry_names(&attempt.join("store"))?,
                    vec![UPGRADE_GUARD.to_owned()],
                    "{label}"
                );
                assert_eq!(
                    fs::read(attempt.join("store").join(UPGRADE_GUARD))?,
                    GUARD,
                    "{label}: the guard must be complete"
                );
                assert_eq!(attempts_before.len(), 1, "{label}");
            } else {
                assert!(entry_names(&attempts)?.is_empty(), "{label}: attempts");
                assert!(attempts_before.is_empty(), "{label}");
            }
            assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
            assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
            let before_workspace = bytes(&workspace)?;
            // Nothing is sealed, so no receipt is accepted and nothing is repaired.
            let verified = SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options);
            assert!(verified.is_err(), "{label}: verify accepted {verified:?}");
            assert_eq!(bytes(&workspace)?, before_workspace, "{label}");
            let refused = Store::start_schema_upgrade(&source, &package, &workspace, &options);
            assert!(
                matches!(refused, Err(BackupError::InvalidPath)),
                "{label}: same-path start gave {refused:?}"
            );
            assert_eq!(bytes(&workspace)?, before_workspace, "{label}");
            // Restart: the last record is INTENT, so resume abandons it and builds attempt 1.
            let state = Store::resume_schema_upgrade(&source, &package, &workspace, &options)
                .map_err(|error| format!("{label}: resume failed: {error:?}"))?;
            assert_eq!(state.schema_uuid(), initial.schema_uuid(), "{label}: uuid");
            let receipt = state.receipt().ok_or("resume did not seal the workspace")?;
            assert_eq!(receipt.schema_uuid(), initial.schema_uuid(), "{label}");
            assert_eq!(receipt.envelope().rdf_write_profile(), profile, "{label}");
            assert_eq!(fs::read(&plan_path)?, plan, "{label}: plan rewritten");
            assert!(workspace.join(COMPLETE).exists(), "{label}: COMPLETE");
            let journal_after = fs::read(&journal)?;
            assert!(
                journal_after.starts_with(&intent_frame),
                "{label}: the journal must only grow"
            );
            let shape: Vec<(u8, u64)> = decode_records(&journal_after, &plan, &options)?
                .iter()
                .map(|record| (record.kind, record.attempt))
                .collect();
            assert_eq!(
                shape,
                vec![
                    (INTENT, 0),
                    (FAILED, 0),
                    (INTENT, 1),
                    (VALIDATED, 1),
                    (SEALED, 1)
                ],
                "{label}: journal records"
            );
            assert_eq!(attempt.exists(), fault0, "{label}: attempt 0");
            assert!(attempt_path(&workspace, 1).exists(), "{label}: attempt 1");
            assert!(!attempt_path(&workspace, 2).exists(), "{label}: attempt 2");
            assert_eq!(
                receipt.store_directory(),
                attempt_path(&workspace, 1).join("store"),
                "{label}: winning attempt"
            );
            let attempts_after = bytes(&attempts)?;
            for (path, data) in attempts_before {
                assert_eq!(attempts_after.get(&path), Some(&data), "{label}: {path:?}");
            }
            assert_eq!(
                &SchemaUpgradeReceipt::verify(&source, &package, &workspace, &options)?,
                receipt,
                "{label}"
            );
            assert_eq!(bytes(&source)?, before_source, "{label}: source changed");
            assert_eq!(bytes(&package)?, before_package, "{label}: package changed");
        }
    }
    Ok(())
}

#[test]
fn schema_upgrade_resume_precopy_fsync_process_helper() -> TestResult {
    if option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") != Some("vendored") {
        return Ok(());
    }
    let Some(source) = std::env::var_os("OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_SOURCE")
    else {
        return Ok(()); // An ordinary run: only the parent test re-invokes this.
    };
    let source = PathBuf::from(source);
    let package = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_PACKAGE")?;
    let workspace = variable("OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_WORKSPACE")?;
    let profile =
        match std::env::var("OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_RDF12")?.as_str() {
            "0" => SchemaRdfProfile::Rdf11,
            "1" => SchemaRdfProfile::Rdf12,
            other => return Err(format!("unexpected rdf12 flag {other:?}").into()),
        };
    let expected: &[u8] =
        match std::env::var("OXIGRAPH_SCHEMA_UPGRADE_RESUME_PRECOPY_FSYNC_TEST_EXPECT_FAULT0")?
            .as_str()
        {
            "0" => &[],
            "1" => &[0],
            other => return Err(format!("unexpected fault0 flag {other:?}").into()),
        };
    let options = SchemaUpgradeOptions::new(profile);
    let mut phases = Vec::new();
    let result = resume_inner(&source, &package, &workspace, &options, |phase| {
        phases.push(phase);
        Ok(())
    });
    match result {
        // Only the shim's exact-path fsync yields EIO; the phases pin it to the
        // INTENT append (none seen) or a pre-copy sync after fault(0) but before
        // fault(1).
        Err(BackupError::Io(error))
            if error.raw_os_error() == Some(libc::EIO) && phases.as_slice() == expected =>
        {
            Ok(())
        }
        other => {
            Err(format!("expected an EIO BackupError::Io, got {other:?}, phases {phases:?}").into())
        }
    }
}
