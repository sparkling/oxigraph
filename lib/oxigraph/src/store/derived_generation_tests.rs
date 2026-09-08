//! Independent toy provider used only to exercise the native lifecycle.
#![expect(
    clippy::panic_in_result_fn,
    reason = "assertions in isolated native fixtures"
)]
use super::*;
use crate::model::{GraphName, Literal, NamedNode, Quad};
use crate::store::{
    BackupOptions, ContributorConsistency, ContributorDeclaration, ContributorHealth,
    ContributorRegistry, Namespace, NamespacePrefix, RestoreOptions, SemanticChange, StorageError,
    Store, TransactionKey, TransactionRequest, TransactionStartControl, WritableDataset,
    WritableNamespaceRegistry,
};
type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;
fn id() -> ContributorIdentity {
    ContributorIdentity::new([24; 16], NonZeroU32::MIN)
}
fn quad(n: i64) -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        Literal::from(n),
        GraphName::DefaultGraph,
    )
}
fn commit(store: &Store, n: u8) -> TestResult {
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([n; 16]))?
        .into_transaction();
    tx.insert(quad(i64::from(n)))?;
    tx.commit()?;
    Ok(())
}
fn capture(store: &Store) -> Result<DerivedSnapshot, DerivedError> {
    store.derived_snapshot(&TransactionStartControl::new())
}
fn storage(error: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> DerivedGenerationError {
    DerivedError::Storage(StorageError::Other(error.into())).into()
}
fn scan(
    source: &DerivedSnapshot,
    limits: &DerivedLimits,
) -> Result<Vec<SemanticChange>, DerivedGenerationError> {
    let mut values = Vec::new();
    source.scan(limits, |value| {
        values.push(value.clone());
        Ok(())
    })?;
    Ok(values)
}
fn encode(values: &[SemanticChange]) -> Result<Vec<u8>, DerivedGenerationError> {
    let mut encoded = values
        .iter()
        .map(super::super::change_codec::encode)
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    encoded.sort();
    let mut bytes = Vec::new();
    for value in encoded {
        blob(&mut bytes, &value);
    }
    Ok(bytes)
}
fn decode(files: &DerivedFiles) -> Result<Vec<SemanticChange>, DerivedGenerationError> {
    let mut bytes = Vec::new();
    files
        .read("records")?
        .take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(DerivedGenerationError::Limit);
    }
    let mut input = Input(&bytes);
    let mut values = Vec::new();
    while !input.0.is_empty() {
        values.push(
            super::super::change_codec::decode(input.blob(64 * 1024 * 1024)?).map_err(storage)?,
        );
    }
    Ok(values)
}
fn apply(store: &Store, changes: &[SemanticChange]) -> Result<(), StorageError> {
    let mut tx = store.start_transaction()?;
    for change in changes {
        match change {
            SemanticChange::QuadAdded(q) => WritableDataset::insert(&mut tx, q.clone())?,
            SemanticChange::QuadRemoved(q) => WritableDataset::remove(&mut tx, q)?,
            SemanticChange::NamedGraphCreated(g) => {
                WritableDataset::insert_named_graph(&mut tx, g.clone())?
            }
            SemanticChange::NamedGraphDropped(g) => tx.remove_named_graph(g)?,
            SemanticChange::GraphCleared(g) => {
                let name = match g {
                    GraphName::DefaultGraph => None,
                    GraphName::NamedNode(n) => Some(n.clone().into()),
                    GraphName::BlankNode(n) => Some(n.clone().into()),
                };
                WritableDataset::clear_graph(&mut tx, name.as_ref())?;
            }
            SemanticChange::AllNamedGraphsCleared => tx.clear_all_named_graphs()?,
            SemanticChange::AllGraphsCleared => tx.clear_all_graphs()?,
            SemanticChange::AllNamedGraphsDropped => tx.remove_all_named_graphs()?,
            SemanticChange::DatasetCleared => tx.clear()?,
            SemanticChange::NamespaceChanged { prefix, after, .. } => match after {
                Some(iri) => tx.set_namespace(Namespace::new(prefix.clone(), iri.clone()))?,
                None => tx.remove_namespace(prefix)?,
            },
            SemanticChange::NamespacesCleared => tx.clear_namespaces()?,
        }
    }
    tx.commit()
}
fn contents(store: &Store) -> Result<Vec<SemanticChange>, StorageError> {
    let mut records = Vec::new();
    for graph in store.named_graphs() {
        records.push(SemanticChange::NamedGraphCreated(graph?));
    }
    for quad in store {
        records.push(SemanticChange::QuadAdded(quad?));
    }
    for namespace in store.namespaces() {
        let ns = namespace?;
        records.push(SemanticChange::NamespaceChanged {
            prefix: ns.prefix().clone(),
            before: None,
            after: Some(ns.iri().clone()),
        });
    }
    Ok(records)
}
struct Toy;
#[test]
fn resource_failures_and_cancellation_during_provider_leave_no_completed_candidate() -> TestResult {
    struct Mode(u8);
    impl DerivedProvider for Mode {
        fn identity(&self) -> ContributorIdentity {
            id()
        }
        fn rebuild(
            &self,
            source: &DerivedSnapshot,
            out: &mut DerivedWriter<'_>,
            limits: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            Toy.rebuild(source, out, limits)?;
            match self.0 {
                0 => out.write_file("extra", &b"x"[..])?,
                1 => out.write_file("records", &b"x"[..])?,
                2 => limits.control.cancel(),
                _ => (),
            };
            Ok(())
        }
        fn reconcile(
            &self,
            source: &DerivedSnapshot,
            files: &DerivedFiles,
            limits: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            Toy.reconcile(source, files, limits)
        }
    }
    for mode in 0..5 {
        let dir = tempfile::tempdir()?;
        let db = Store::open(dir.path().join("db"))?;
        commit(&db, 1)?;
        commit(&db, 2)?;
        let source = capture(&db)?;
        let mut index = DerivedIndex::create(dir.path().join("index"), id())?;
        let mut limits = DerivedGenerationLimits::default();
        match mode {
            0 => limits.max_files = NonZeroUsize::MIN,
            3 => limits.max_stored_bytes = NonZeroU64::MIN,
            4 => limits.input.max_records = NonZeroU64::MIN,
            _ => (),
        };
        assert!(index.rebuild(&source, &Mode(mode), &limits).is_err());
        assert!(matches!(
            index.active(&DerivedGenerationLimits::default()),
            Err(DerivedGenerationError::Unavailable)
        ));
        for entry in fs::read_dir(dir.path().join("index/generations"))? {
            assert!(!entry?.path().join(COMPLETE).exists());
        }
    }
    Ok(())
}

#[test]
fn unknown_schema_foreign_source_and_mutated_generation_observation_reject() -> TestResult {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let foreign = Store::open(dir.path().join("foreign"))?;
    commit(&db, 1)?;
    let source = capture(&db)?;
    let foreign = capture(&foreign)?;
    let root = dir.path().join("index");
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(&root, id())?;
    let generation = index.rebuild(&source, &Toy, &limits)?;
    index.activate(&generation, &source, &Toy, &limits)?;
    assert!(matches!(
        index.state(&foreign, &limits),
        Err(DerivedGenerationError::Identity)
    ));
    assert!(matches!(
        DerivedGeneration::open(
            generation.directory(),
            ContributorIdentity::new([25; 16], NonZeroU32::MIN),
            &limits
        ),
        Err(DerivedGenerationError::Identity)
    ));
    let bytes = fs::read(generation.directory().join(COMPLETE))?;
    for end in [0, 1, 16, bytes.len() - 1] {
        assert!(
            DerivedGeneration::decode(&bytes[..end], generation.directory().to_owned()).is_err()
        );
    }
    fs::write(generation.directory().join("records"), b"bad")?;
    assert!(generation.observation(&source, &limits).is_err());
    assert!(generation.backup_contribution(&limits).is_err());
    Ok(())
}
#[test]
fn generation_crash_child() -> TestResult {
    let Some(directory) = std::env::var_os("OXIGRAPH_DERIVED_CRASH_DIR") else {
        return Ok(());
    };
    let directory = PathBuf::from(directory);
    let phase = std::env::var("OXIGRAPH_DERIVED_CRASH_PHASE")?.parse::<u8>()?;
    let db = Store::open(directory.join("db"))?;
    let source = capture(&db)?;
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::open(directory.join("index"), id())?;
    if phase == 3 {
        struct Interrupted;
        impl DerivedProvider for Interrupted {
            fn identity(&self) -> ContributorIdentity {
                id()
            }
            fn rebuild(
                &self,
                source: &DerivedSnapshot,
                out: &mut DerivedWriter<'_>,
                limits: &DerivedLimits,
            ) -> Result<(), DerivedGenerationError> {
                Toy.rebuild(source, out, limits)?;
                std::process::exit(77);
            }
            fn reconcile(
                &self,
                _: &DerivedSnapshot,
                _: &DerivedFiles,
                _: &DerivedLimits,
            ) -> Result<(), DerivedGenerationError> {
                Err(DerivedGenerationError::Corrupt)
            }
        }
        index.rebuild(&source, &Interrupted, &limits)?;
    } else {
        let candidate = index.catch_up(&source, &Toy, &limits)?;
        index.activate_inner(&candidate, &source, &Toy, &limits, |at| {
            if at == phase {
                std::process::exit(77);
            }
            Ok(())
        })?;
    }
    Err("child did not reach its abrupt termination phase".into())
}
#[test]
fn abrupt_process_exit_releases_lock_and_preserves_published_boundary() -> TestResult {
    for phase in 0..4 {
        let dir = tempfile::tempdir()?;
        let db = Store::open(dir.path().join("db"))?;
        commit(&db, 1)?;
        let limits = DerivedGenerationLimits::default();
        let root = dir.path().join("index");
        let mut index = DerivedIndex::create(&root, id())?;
        let source = capture(&db)?;
        let first = index.rebuild(&source, &Toy, &limits)?;
        index.activate(&first, &source, &Toy, &limits)?;
        commit(&db, 2)?;
        drop(source);
        drop(index);
        drop(db);
        let result = std::process::Command::new(std::env::current_exe()?)
            .args([
                "--exact",
                "store::derived_generation::tests::generation_crash_child",
                "--nocapture",
            ])
            .env("OXIGRAPH_DERIVED_CRASH_DIR", dir.path())
            .env("OXIGRAPH_DERIVED_CRASH_PHASE", phase.to_string())
            .output()?;
        assert_eq!(
            result.status.code(),
            Some(77),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let db = Store::open(dir.path().join("db"))?;
        let source = capture(&db)?;
        let reopened = DerivedIndex::open(&root, id())?;
        if phase == 2 {
            reopened.strict(&source, &limits)?;
            assert_ne!(reopened.active(&limits)?.fingerprint(), first.fingerprint());
        } else {
            assert_eq!(reopened.active(&limits)?.fingerprint(), first.fingerprint());
        }
        assert_eq!(reopened.recovered_pending_activation(), phase == 1);
    }
    Ok(())
}
#[test]
fn copied_sibling_divergence_cannot_masquerade_as_same_primary() -> TestResult {
    let dir = tempfile::tempdir()?;
    let a = Store::open(dir.path().join("a"))?;
    commit(&a, 1)?;
    a.backup(dir.path().join("b"))?;
    let b = Store::open(dir.path().join("b"))?;
    a.insert(quad(10))?;
    b.insert(quad(20))?;
    let source = capture(&a)?;
    let sibling = capture(&b)?;
    assert_eq!(
        source.checkpoint(),
        sibling.checkpoint(),
        "fixture must demonstrate indistinguishable physical tokens"
    );
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("index"), id())?;
    let generation = index.rebuild(&source, &Toy, &limits)?;
    index.activate(&generation, &source, &Toy, &limits)?;
    assert!(matches!(
        index.strict(&sibling, &limits),
        Err(DerivedGenerationError::NotFresh)
    ));
    let options = BackupOptions {
        contributors: registry()?,
        contributions: vec![generation.backup_contribution(&limits)?],
        ..BackupOptions::default()
    };
    assert!(
        b.backup_with_receipt(dir.path().join("wrong-backup"), &options)
            .is_err()
    );
    Ok(())
}
impl DerivedProvider for Toy {
    fn identity(&self) -> ContributorIdentity {
        id()
    }
    fn rebuild(
        &self,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        output.write_file("records", encode(&scan(source, limits)?)?.as_slice())
    }
    fn apply(
        &self,
        previous: &DerivedFiles,
        delta: &DerivedDelta,
        _source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        _limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let memory = Store::new().map_err(storage)?;
        apply(&memory, &decode(previous)?).map_err(storage)?;
        for commit in delta.commits() {
            apply(&memory, commit.changes()).map_err(storage)?;
        }
        output.write_file(
            "records",
            encode(&contents(&memory).map_err(storage)?)?.as_slice(),
        )
    }
    fn reconcile(
        &self,
        source: &DerivedSnapshot,
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        if encode(&scan(source, limits)?)? != encode(&decode(files)?)? {
            return Err(DerivedGenerationError::Reconciliation(
                "toy RDF/topology/namespace mismatch".into(),
            ));
        }
        Ok(())
    }
}
fn registry() -> Result<ContributorRegistry, crate::store::ContributorError> {
    ContributorRegistry::new(vec![ContributorDeclaration::new(
        id(),
        true,
        ContributorConsistency::Strict,
        false,
    )])
}

#[test]
fn durable_rebuild_delta_restart_and_strict_snapshot_binding() -> TestResult {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    commit(&db, 1)?;
    let root = dir.path().join("index");
    let mut index = DerivedIndex::create(&root, id())?;
    let limits = DerivedGenerationLimits::default();
    let source = capture(&db)?;
    assert_eq!(index.state(&source, &limits)?, DerivedState::Unavailable);
    assert!(matches!(
        DerivedIndex::open(&root, id()),
        Err(DerivedGenerationError::Busy)
    ));
    let first = index.rebuild(&source, &Toy, &limits)?;
    assert!(matches!(
        index.active(&limits),
        Err(DerivedGenerationError::Unavailable)
    ));
    index.activate(&first, &source, &Toy, &limits)?;
    assert_eq!(index.state(&source, &limits)?, DerivedState::Ready);
    assert!(!index.strict(&source, &limits)?.is_eventual());
    commit(&db, 2)?;
    let newer = capture(&db)?;
    assert!(matches!(
        index.strict(&newer, &limits),
        Err(DerivedGenerationError::NotFresh)
    ));
    assert!(index.eventual(&newer, &limits)?.is_eventual());
    assert_eq!(
        first.observation(&newer, &limits)?.health(),
        ContributorHealth::Rebuilding
    );
    let second = index.catch_up(&newer, &Toy, &limits)?;
    assert_eq!(second.base_fingerprint(), Some(&first.fingerprint()));
    index.activate(&second, &newer, &Toy, &limits)?;
    drop(index);
    let index = DerivedIndex::open(root, id())?;
    assert_eq!(
        index.strict(&newer, &limits)?.generation().fingerprint(),
        second.fingerprint()
    );
    assert!(matches!(
        index.strict(&source, &limits),
        Err(DerivedGenerationError::NotFresh)
    ));
    assert!(first.directory().is_dir());
    Ok(())
}

#[test]
fn delta_lifecycle_and_ungoverned_gap_require_exact_reconciliation() -> TestResult {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    commit(&db, 1)?;
    let mut index = DerivedIndex::create(dir.path().join("index"), id())?;
    let limits = DerivedGenerationLimits::default();
    let view = capture(&db)?;
    let first = index.rebuild(&view, &Toy, &limits)?;
    index.activate(&first, &view, &Toy, &limits)?;
    for mode in 0..11 {
        let mut tx = db
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([mode + 10; 16]),
            )?
            .into_transaction();
        let graph = NamedNode::new("urn:empty")?;
        match mode {
            0 => {
                tx.insert_named_graph(graph.into())?;
                tx.set_namespace(Namespace::new(
                    NamespacePrefix::new("ex")?,
                    NamedNode::new("urn:ex:")?,
                ))?;
            }
            1 => {
                tx.insert(quad(8))?;
                tx.remove(&quad(1))?;
            }
            2 => tx.clear_graph(None)?,
            3 => tx.clear_all_named_graphs()?,
            4 => tx.clear_all_graphs()?,
            5 => tx.remove_named_graph(&graph.into())?,
            6 => tx.remove_all_named_graphs()?,
            7 => tx.clear()?,
            8 => tx.remove_namespace(&NamespacePrefix::new("ex")?)?,
            9 => tx.clear_namespaces()?,
            _ => (),
        };
        tx.commit()?;
        let view = capture(&db)?;
        let candidate = index.catch_up(&view, &Toy, &limits)?;
        index.activate(&candidate, &view, &Toy, &limits)?;
    }
    let mut rolled = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([90; 16]))?
        .into_transaction();
    rolled.insert(quad(90))?;
    rolled.rollback()?;
    let old = index.active(&limits)?;
    db.insert(quad(99))?;
    commit(&db, 91)?;
    let view = capture(&db)?;
    assert!(matches!(
        index.catch_up(&view, &Toy, &limits),
        Err(DerivedGenerationError::Reconciliation(_))
    ));
    assert_eq!(index.active(&limits)?.fingerprint(), old.fingerprint());
    let rebuilt = index.rebuild(&view, &Toy, &limits)?;
    index.activate(&rebuilt, &view, &Toy, &limits)?;
    index.strict(&view, &limits)?;
    Ok(())
}

#[test]
fn native_generation_backup_restore_binds_full_physical_checkpoint() -> TestResult {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    commit(&db, 1)?;
    let mut index = DerivedIndex::create(dir.path().join("index"), id())?;
    let limits = DerivedGenerationLimits::default();
    let view = capture(&db)?;
    let generation = index.rebuild(&view, &Toy, &limits)?;
    index.activate(&generation, &view, &Toy, &limits)?;
    let options = BackupOptions {
        contributors: registry()?,
        contributions: vec![generation.backup_contribution(&limits)?],
        ..BackupOptions::default()
    };
    let backup = dir.path().join("backup");
    db.backup_with_receipt(&backup, &options)?;
    let restore = dir.path().join("restore");
    Store::restore_backup(
        &backup,
        &restore,
        &RestoreOptions {
            contributors: registry()?,
            reconcilers: vec![Arc::new(DerivedRestore::new(Arc::new(Toy), limits.clone()))],
            ..RestoreOptions::default()
        },
    )?;
    let restored = Store::open(restore.join("store"))?;
    assert!(restored.contains(&quad(1))?);
    let restored_view = capture(&restored)?;
    let contributor = restore
        .join("contributors")
        .join(super::super::backup::provider_name(id()));
    let mut recovered_index = DerivedIndex::create(dir.path().join("recovered-index"), id())?;
    let recovered = recovered_index.import_restored(contributor, &restored_view, &Toy, &limits)?;
    recovered_index.activate(&recovered, &restored_view, &Toy, &limits)?;
    recovered_index.strict(&restored_view, &limits)?;
    commit(&restored, 2)?;
    drop(restored_view);
    drop(restored);
    let restored = Store::open(restore.join("store"))?;
    assert!(restored.contains(&quad(2))?);
    db.insert(quad(99))?;
    assert_eq!(
        capture(&db)?.checkpoint().latest_receipt(),
        view.checkpoint().latest_receipt()
    );
    assert!(
        db.backup_with_receipt(dir.path().join("stale"), &options)
            .is_err()
    );
    assert!(!dir.path().join("stale/oxigraph-backup.complete").exists());
    Ok(())
}

#[test]
fn activation_interruption_preserves_old_or_publishes_exact_new_pointer() -> TestResult {
    for phase in 0..3 {
        let dir = tempfile::tempdir()?;
        let db = Store::open(dir.path().join("db"))?;
        commit(&db, 1)?;
        let root = dir.path().join("index");
        let limits = DerivedGenerationLimits::default();
        let mut index = DerivedIndex::create(&root, id())?;
        let view = capture(&db)?;
        let first = index.rebuild(&view, &Toy, &limits)?;
        index.activate(&first, &view, &Toy, &limits)?;
        commit(&db, 2)?;
        let view = capture(&db)?;
        let second = index.catch_up(&view, &Toy, &limits)?;
        let result = index.activate_inner(&second, &view, &Toy, &limits, |at| {
            if at == phase {
                Err(io::Error::other("injected interruption"))
            } else {
                Ok(())
            }
        });
        if phase == 2 {
            assert!(matches!(
                result,
                Err(DerivedGenerationError::ActivationIndeterminate(_))
            ));
        } else {
            assert!(result.is_err());
        }
        drop(index);
        let reopened = DerivedIndex::open(&root, id())?;
        assert_eq!(reopened.recovered_pending_activation(), phase == 1);
        assert_eq!(
            reopened.active(&limits)?.fingerprint(),
            if phase == 2 {
                second.fingerprint()
            } else {
                first.fingerprint()
            }
        );
    }
    Ok(())
}

#[test]
fn corrupt_payload_manifest_and_pointer_never_supply_strict_results() -> TestResult {
    for name in ["records", COMPLETE, ACTIVE] {
        let dir = tempfile::tempdir()?;
        let db = Store::open(dir.path().join("db"))?;
        commit(&db, 1)?;
        let root = dir.path().join("index");
        let limits = DerivedGenerationLimits::default();
        let mut index = DerivedIndex::create(&root, id())?;
        let view = capture(&db)?;
        let generation = index.rebuild(&view, &Toy, &limits)?;
        index.activate(&generation, &view, &Toy, &limits)?;
        let path = if name == ACTIVE {
            root.join(name)
        } else {
            generation.directory().join(name)
        };
        fs::write(path, b"broken isolated test data")?;
        assert!(index.strict(&view, &limits).is_err());
        assert!(index.activate(&generation, &view, &Toy, &limits).is_err() || name == ACTIVE);
    }
    Ok(())
}

#[test]
fn cancelled_limited_and_swallowed_writer_failures_cannot_publish() -> TestResult {
    struct Swallow;
    impl DerivedProvider for Swallow {
        fn identity(&self) -> ContributorIdentity {
            id()
        }
        fn rebuild(
            &self,
            _: &DerivedSnapshot,
            out: &mut DerivedWriter<'_>,
            _: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            drop(out.write_file("../invalid", &b"bad"[..]));
            Ok(())
        }
        fn reconcile(
            &self,
            _: &DerivedSnapshot,
            _: &DerivedFiles,
            _: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            Ok(())
        }
    }
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    commit(&db, 1)?;
    let view = capture(&db)?;
    let root = dir.path().join("index");
    let mut index = DerivedIndex::create(root, id())?;
    let limits = DerivedGenerationLimits::default();
    let first = index.rebuild(&view, &Toy, &limits)?;
    index.activate(&first, &view, &Toy, &limits)?;
    assert!(matches!(
        index.rebuild(&view, &Swallow, &limits),
        Err(DerivedGenerationError::WriterFailed)
    ));
    let small = DerivedGenerationLimits {
        max_bytes: NonZeroU64::MIN,
        ..limits.clone()
    };
    assert!(matches!(
        index.rebuild(&view, &Toy, &small),
        Err(DerivedGenerationError::Limit)
    ));
    let capped = DerivedGenerationLimits {
        max_generations: NonZeroUsize::MIN,
        ..limits.clone()
    };
    assert!(matches!(
        index.rebuild(&view, &Toy, &capped),
        Err(DerivedGenerationError::Limit)
    ));
    let cancelled = DerivedGenerationLimits::default();
    cancelled.input.control.cancel();
    assert!(index.rebuild(&view, &Toy, &cancelled).is_err());
    assert!(index.activate(&first, &view, &Toy, &cancelled).is_err());
    assert_eq!(index.active(&limits)?.fingerprint(), first.fingerprint());
    assert_eq!(index.monitor().state(), DerivedState::Failed);
    Ok(())
}
