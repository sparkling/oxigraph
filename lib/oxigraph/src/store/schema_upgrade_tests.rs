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
