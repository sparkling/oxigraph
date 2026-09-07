#![cfg(feature = "shacl")]
#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "public staged SHACL commit contract assertions"
)]

use oxigraph::model::{Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, vocab};
use oxigraph::shacl::{GraphSnapshot, LimitKind, ValidationError, ValidationOptions};
use oxigraph::store::{
    CommitReceiptOutcome, Namespace, NamespacePrefix, OutcomeAwareWritableDataset,
    ShaclCommitError, ShaclCommitPolicy, ShaclCommitReceipt, ShaclDisposition, ShaclGateError,
    ShaclGraphScope, ShaclReceiptOutcome, ShaclShapesSource, ShaclValidationEvidence, Store,
    TransactionKey, TransactionRequest, WritableDataset, WritableNamespaceRegistry,
};
use std::error::Error;
use std::num::NonZeroUsize;
use std::time::Duration;

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;
fn node(value: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:{value}"))
}
fn sh(value: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("http://www.w3.org/ns/shacl#{value}"))
}
fn key(value: u8) -> TransactionKey {
    TransactionKey::new([value; 16])
}
fn quad(value: &str, graph: GraphName) -> Quad {
    Quad::new(
        node("s"),
        node("p"),
        Literal::new_simple_literal(value.to_owned()),
        graph,
    )
}
fn shape_quads(min: u64, max: u64, graph: GraphName) -> Vec<Quad> {
    vec![
        Quad::new(
            node("shape"),
            vocab::rdf::TYPE,
            sh("PropertyShape"),
            graph.clone(),
        ),
        Quad::new(node("shape"), sh("targetNode"), node("s"), graph.clone()),
        Quad::new(node("shape"), sh("path"), node("p"), graph.clone()),
        Quad::new(
            node("shape"),
            sh("minCount"),
            Literal::from(min),
            graph.clone(),
        ),
        Quad::new(node("shape"), sh("maxCount"), Literal::from(max), graph),
    ]
}
fn policy(min: u64, max: u64, scopes: Vec<ShaclGraphScope>) -> ShaclCommitPolicy {
    let dataset: Dataset = shape_quads(min, max, GraphName::DefaultGraph)
        .into_iter()
        .collect();
    ShaclCommitPolicy::new(
        scopes,
        ShaclShapesSource::External(Box::new(GraphSnapshot::default_graph(dataset))),
    )
}
fn scope(graph_name: GraphName, required: bool) -> ShaclGraphScope {
    ShaclGraphScope {
        graph_name,
        required,
    }
}
fn default_policy(min: u64, max: u64) -> ShaclCommitPolicy {
    policy(min, max, vec![scope(GraphName::DefaultGraph, true)])
}
fn each_backend(exercise: impl Fn(&Store) -> TestResult) -> TestResult {
    exercise(&Store::new()?)?;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    {
        let directory = tempfile::tempdir()?;
        exercise(&Store::open(directory.path())?)?;
    }
    Ok(())
}
fn no_receipt(store: &Store, id: u8) -> TestResult {
    assert!(!matches!(
        store.lookup_commit_receipt(&key(id))?,
        CommitReceiptOutcome::Committed(_)
    ));
    Ok(())
}

#[test]
fn policy_receipts_bind_both_trait_paths_and_distinguish_plain_commits() -> TestResult {
    each_backend(|store| {
        let policy = policy(
            0,
            2,
            vec![
                scope(GraphName::DefaultGraph, true),
                scope(node("absent").into(), false),
            ],
        );
        let descriptor = policy.descriptor()?;
        let tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), policy)?
            .into_transaction();
        let report = tx.commit()?;
        assert_eq!(report.validation.policy(), &descriptor);
        assert_eq!(
            report.validation.final_graph_presence(),
            &[Some(true), Some(false)]
        );
        assert_eq!(report.validation.validated_graphs(), 2);
        assert_eq!(report.validation.disposition(), ShaclDisposition::Accepted);
        let ShaclReceiptOutcome::Validated(receipt) = store.lookup_shacl_receipt(&key(1))? else {
            return Err("missing validation receipt".into());
        };
        assert_eq!(receipt.commit_receipt(), &report.receipt);
        assert_eq!(receipt.validation(), &report.validation);
        assert_eq!(
            ShaclCommitReceipt::from_bytes(&receipt.to_bytes())?,
            *receipt
        );
        assert!(
            !receipt
                .to_bytes()
                .windows(b"urn:absent".len())
                .any(|part| part == b"urn:absent")
        );
        for id in 2..=3 {
            let tx = store
                .start_shacl_transaction(
                    TransactionRequest::default(),
                    key(id),
                    default_policy(0, 2),
                )?
                .into_transaction();
            if id == 2 {
                WritableDataset::commit(tx)?;
            } else {
                OutcomeAwareWritableDataset::commit_with_outcome(tx)?;
            }
            assert!(matches!(
                store.lookup_shacl_receipt(&key(id))?,
                ShaclReceiptOutcome::Validated(_)
            ));
        }
        let plain = store
            .start_governed_transaction(TransactionRequest::default(), key(4))?
            .into_transaction()
            .commit()?;
        assert_eq!(
            store.lookup_shacl_receipt(&key(4))?,
            ShaclReceiptOutcome::Unavailable(CommitReceiptOutcome::Committed(plain))
        );
        Ok(())
    })
}

#[test]
fn validation_evidence_expires_with_primary_receipt_not_primary_data() -> TestResult {
    use oxigraph::store::{GovernanceTime, OutboxRetentionPolicy};
    use std::num::{NonZeroU16, NonZeroU64};
    each_backend(|store| {
        store.configure_outbox_retention(
            OutboxRetentionPolicy::new(NonZeroU64::new(20).ok_or("zero")?, NonZeroU16::MIN)?,
            GovernanceTime::from_unix_millis(1),
        )?;
        let mut tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), default_policy(0, 2))?
            .into_transaction();
        tx.insert(quad("retained", GraphName::DefaultGraph))?;
        let receipt = tx.commit()?.receipt;
        let cursor = receipt.outbox_end_cursor().ok_or("missing cursor")?;
        let result = store.maintain_outbox(
            &cursor,
            NonZeroUsize::MIN,
            GovernanceTime::from_unix_millis(2),
        )?;
        assert_eq!(result.expired_receipt_sequence(), Some(1));
        assert!(matches!(
            store.lookup_shacl_receipt(&key(1))?,
            ShaclReceiptOutcome::Unavailable(CommitReceiptOutcome::Expired(_))
        ));
        assert!(store.contains(&quad("retained", GraphName::DefaultGraph))?);
        assert!(
            store
                .start_shacl_transaction(
                    TransactionRequest::default(),
                    key(1),
                    default_policy(0, 2)
                )
                .is_err()
        );
        store.maintain_outbox(
            &cursor,
            NonZeroUsize::new(10).ok_or("zero")?,
            GovernanceTime::from_unix_millis(3),
        )?;
        assert!(
            store
                .read_outbox(None, NonZeroUsize::MIN)?
                .records()
                .is_empty()
        );
        Ok(())
    })
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn validation_receipt_survives_compaction_backup_and_read_only_reopen() -> TestResult {
    let directory = tempfile::tempdir()?;
    let backup_root = tempfile::tempdir()?;
    let backup = backup_root.path().join("backup");
    let expected;
    {
        let store = Store::open(directory.path())?;
        let mut tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), default_policy(0, 2))?
            .into_transaction();
        tx.insert(quad("durable", GraphName::DefaultGraph))?;
        tx.commit()?;
        expected = store.lookup_shacl_receipt(&key(1))?;
        store.optimize()?;
        store.backup(&backup)?;
    }
    for path in [directory.path(), backup.as_path()] {
        let store = Store::open_read_only(path)?;
        assert_eq!(store.lookup_shacl_receipt(&key(1))?, expected);
        assert!(store.contains(&quad("durable", GraphName::DefaultGraph))?);
        assert_eq!(
            store
                .read_outbox(None, NonZeroUsize::new(10).ok_or("zero")?)?
                .records()
                .len(),
            2
        );
    }
    Ok(())
}

#[test]
fn rejected_commits_return_bounded_executable_failure_evidence() -> TestResult {
    each_backend(|store| {
        for (id, expected) in [
            (1, ShaclDisposition::Cancelled),
            (2, ShaclDisposition::TimedOut),
            (3, ShaclDisposition::LimitExceeded),
            (4, ShaclDisposition::Nonconforming),
        ] {
            let mut options = ValidationOptions::default();
            if id == 2 {
                options.limits.timeout = Some(Duration::from_millis(100));
            }
            if id == 3 {
                options.limits.max_data_quads = 0;
            }
            let policy =
                default_policy(0, if id == 4 { 0 } else { 2 }).with_validation_options(options);
            let control = policy.control();
            let descriptor = policy.descriptor()?;
            let mut tx = store
                .start_shacl_transaction(TransactionRequest::default(), key(id), policy)?
                .into_transaction();
            tx.insert(quad("secret-payload", GraphName::DefaultGraph))?;
            tx.set_namespace(Namespace::new(NamespacePrefix::new("ex")?, node("ns")))?;
            if id == 1 {
                control.cancel();
            }
            if id == 2 {
                std::thread::sleep(Duration::from_millis(110));
            }
            let error = tx.commit().err().ok_or("must reject")?;
            let evidence = error.validation_evidence();
            assert_eq!(evidence.disposition(), expected);
            assert_eq!(evidence.policy(), &descriptor);
            assert_eq!(
                &ShaclValidationEvidence::from_bytes(&evidence.to_bytes())?,
                evidence
            );
            assert!(evidence.to_bytes().len() <= 8192);
            assert!(
                !evidence
                    .to_bytes()
                    .windows(14)
                    .any(|part| part == b"secret-payload")
            );
            assert!(matches!(
                error,
                ShaclCommitError::Rejected { rollback: None, .. }
            ));
            assert!(matches!(
                store.lookup_shacl_receipt(&key(id))?,
                ShaclReceiptOutcome::Unavailable(CommitReceiptOutcome::ProvenAbsent(_))
            ));
            assert!(store.is_empty()?);
            assert!(store.namespace(&NamespacePrefix::new("ex")?)?.is_none());
            assert!(
                store
                    .read_outbox(None, NonZeroUsize::MIN)?
                    .records()
                    .is_empty()
            );
        }
        Ok(())
    })
}

#[test]
fn invalid_mutable_shapes_and_missing_topology_are_observed_without_commit() -> TestResult {
    each_backend(|store| {
        let graph = GraphName::NamedNode(node("shapes"));
        for quad in shape_quads(0, 2, graph.clone()) {
            store.insert(quad)?;
        }
        for (id, mutable) in [(1, true), (2, false)] {
            let policy = ShaclCommitPolicy::new(
                vec![scope(GraphName::DefaultGraph, true)],
                ShaclShapesSource::Stored {
                    graph_name: graph.clone(),
                    mutable,
                },
            );
            let mut tx = store
                .start_shacl_transaction(TransactionRequest::default(), key(id), policy)?
                .into_transaction();
            tx.insert(Quad::new(
                node("shape"),
                sh("maxCount"),
                Literal::new_simple_literal("not-an-integer"),
                graph.clone(),
            ))?;
            let error = tx.commit().err().ok_or("invalid shapes must reject")?;
            let evidence = error.validation_evidence();
            assert_eq!(
                evidence.disposition(),
                if mutable {
                    ShaclDisposition::ProcessorError
                } else {
                    ShaclDisposition::ShapesChanged
                }
            );
            assert_ne!(
                evidence.shapes_at_commit(),
                Some(evidence.shapes_at_begin())
            );
            assert_eq!(
                &ShaclValidationEvidence::from_bytes(&evidence.to_bytes())?,
                evidence
            );
            assert!(matches!(
                store.lookup_shacl_receipt(&key(id))?,
                ShaclReceiptOutcome::Unavailable(CommitReceiptOutcome::ProvenAbsent(_))
            ));
        }
        let tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                key(3),
                policy(0, 1, vec![scope(node("missing").into(), true)]),
            )?
            .into_transaction();
        let error = tx.commit().err().ok_or("required graph absent")?;
        assert_eq!(
            error.validation_evidence().disposition(),
            ShaclDisposition::MissingGraph
        );
        assert_eq!(
            error.validation_evidence().final_graph_presence(),
            &[Some(false)]
        );
        assert_eq!(error.validation_evidence().validated_graphs(), 0);
        assert!(
            store
                .read_outbox(None, NonZeroUsize::MIN)?
                .records()
                .is_empty()
        );
        Ok(())
    })
}

#[test]
fn full_view_insert_remove_and_namespace_are_atomic() -> TestResult {
    each_backend(|store| {
        let mut tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), default_policy(1, 1))?
            .into_transaction();
        tx.insert(quad("first", GraphName::DefaultGraph))?;
        let report = tx.commit()?;
        assert!(report.graphs[0].report.conforms());
        assert_eq!(report.shapes_at_begin, report.shapes_at_commit);
        let before = store.read_outbox(None, NonZeroUsize::new(100).ok_or("zero")?)?;
        let mut invalid = store
            .start_shacl_transaction(TransactionRequest::default(), key(2), default_policy(1, 1))?
            .into_transaction();
        invalid.insert(quad("second", GraphName::DefaultGraph))?;
        invalid.set_namespace(Namespace::new(NamespacePrefix::new("ex")?, node("ns")))?;
        assert!(matches!(
            invalid.commit(),
            Err(ShaclCommitError::Rejected {
                source: ShaclGateError::Nonconforming { .. },
                rollback: None,
                ..
            })
        ));
        no_receipt(store, 2)?;
        assert!(!store.contains(&quad("second", GraphName::DefaultGraph))?);
        assert!(store.namespace(&NamespacePrefix::new("ex")?)?.is_none());
        assert_eq!(
            store
                .read_outbox(None, NonZeroUsize::new(100).ok_or("zero")?)?
                .records(),
            before.records()
        );
        let mut deletion = store
            .start_shacl_transaction(TransactionRequest::default(), key(3), default_policy(1, 1))?
            .into_transaction();
        deletion.remove(&quad("first", GraphName::DefaultGraph))?;
        assert!(matches!(
            deletion.commit(),
            Err(ShaclCommitError::Rejected { .. })
        ));
        assert!(store.contains(&quad("first", GraphName::DefaultGraph))?);
        let mut replacement = store
            .start_shacl_transaction(TransactionRequest::default(), key(4), default_policy(1, 1))?
            .into_transaction();
        replacement.remove(&quad("first", GraphName::DefaultGraph))?;
        replacement.insert(quad("replacement", GraphName::DefaultGraph))?;
        replacement.commit()?;
        assert!(!store.contains(&quad("first", GraphName::DefaultGraph))?);
        assert!(store.contains(&quad("replacement", GraphName::DefaultGraph))?);
        Ok(())
    })
}

#[test]
fn trait_commit_paths_cannot_bypass_validation() -> TestResult {
    each_backend(|store| {
        let tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), default_policy(1, 1))?
            .into_transaction();
        assert!(WritableDataset::commit(tx).is_err());
        let tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(2), default_policy(1, 1))?
            .into_transaction();
        assert!(OutcomeAwareWritableDataset::commit_with_outcome(tx).is_err());
        no_receipt(store, 1)?;
        no_receipt(store, 2)?;
        assert!(
            store
                .read_outbox(None, NonZeroUsize::MIN)?
                .records()
                .is_empty()
        );
        Ok(())
    })
}

#[test]
fn graphs_are_independent_and_empty_is_not_absent() -> TestResult {
    each_backend(|store| {
        let a: NamedOrBlankNode = node("a").into();
        let b: NamedOrBlankNode = node("b").into();
        let a_graph = GraphName::NamedNode(node("a"));
        let b_graph = GraphName::NamedNode(node("b"));
        store.insert_named_graph(a.clone())?;
        store.insert_named_graph(b.clone())?;
        let scopes = vec![scope(a_graph.clone(), true), scope(b_graph.clone(), true)];
        let mut tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                key(1),
                policy(1, 1, scopes.clone()),
            )?
            .into_transaction();
        // A union would violate maxCount; two independently valid graphs must pass.
        tx.insert(quad("one", a_graph.clone()))?;
        tx.insert(quad("two", b_graph.clone()))?;
        assert_eq!(tx.commit()?.graphs.len(), 2);
        let mut tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                key(2),
                policy(1, 1, scopes.clone()),
            )?
            .into_transaction();
        tx.clear_graph(Some(&b))?;
        assert!(matches!(
            tx.commit(),
            Err(ShaclCommitError::Rejected { .. })
        )); // Must not skip the empty graph.
        let mut tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                key(3),
                policy(0, 1, scopes.clone()),
            )?
            .into_transaction();
        tx.clear_all_named_graphs()?;
        assert!(tx.commit()?.graphs.iter().all(|graph| graph.present));
        let mut tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(4), policy(0, 1, scopes))?
            .into_transaction();
        tx.remove_named_graph(&a)?;
        assert!(matches!(
            tx.commit(),
            Err(ShaclCommitError::Rejected {
                source: ShaclGateError::MissingGraph(_),
                rollback: None,
                ..
            })
        ));
        assert!(store.contains_named_graph(&a)?);
        let mut tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                key(5),
                policy(0, 1, vec![scope(a_graph, false)]),
            )?
            .into_transaction();
        tx.remove_named_graph(&a)?;
        assert!(!tx.commit()?.graphs[0].present);
        Ok(())
    })
}

#[test]
fn mutable_shapes_use_resulting_graph_and_immutable_shapes_are_pinned() -> TestResult {
    each_backend(|store| {
        let graph = GraphName::NamedNode(node("shapes"));
        for quad in shape_quads(0, 2, graph.clone()) {
            store.insert(quad)?;
        }
        let make_policy = |mutable| {
            ShaclCommitPolicy::new(
                vec![scope(GraphName::DefaultGraph, true)],
                ShaclShapesSource::Stored {
                    graph_name: graph.clone(),
                    mutable,
                },
            )
        };
        let old = Quad::new(
            node("shape"),
            sh("maxCount"),
            Literal::from(2_u64),
            graph.clone(),
        );
        let new = Quad::new(
            node("shape"),
            sh("maxCount"),
            Literal::from(1_u64),
            graph.clone(),
        );
        for (id, mutable) in [(1, true), (2, false)] {
            let mut tx = store
                .start_shacl_transaction(
                    TransactionRequest::default(),
                    key(id),
                    make_policy(mutable),
                )?
                .into_transaction();
            tx.remove(&old)?;
            tx.insert(new.clone())?;
            tx.insert(quad("one", GraphName::DefaultGraph))?;
            tx.insert(quad("two", GraphName::DefaultGraph))?;
            assert!(matches!(
                tx.commit(),
                Err(ShaclCommitError::Rejected { rollback: None, .. })
            ));
            assert!(store.contains(&old)?);
            no_receipt(store, id)?;
        }
        let mut tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(3), make_policy(true))?
            .into_transaction();
        tx.remove(&old)?;
        tx.insert(new)?;
        tx.insert(quad("one", GraphName::DefaultGraph))?;
        let report = tx.commit()?;
        assert_ne!(report.shapes_at_begin, report.shapes_at_commit);
        Ok(())
    })
}

#[test]
fn cancellation_deadline_and_cumulative_snapshot_bounds_reject() -> TestResult {
    each_backend(|store| {
        let cancelled_policy = default_policy(0, 2);
        let control = cancelled_policy.control();
        let mut tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), cancelled_policy)?
            .into_transaction();
        tx.insert(quad("one", GraphName::DefaultGraph))?;
        control.cancel();
        assert!(matches!(
            tx.commit(),
            Err(ShaclCommitError::Rejected {
                source: ShaclGateError::Validation(ValidationError::Cancelled),
                rollback: None,
                ..
            })
        ));
        let mut options = ValidationOptions::default();
        options.limits.timeout = Some(Duration::from_millis(100));
        let tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                key(2),
                default_policy(0, 2).with_validation_options(options),
            )?
            .into_transaction();
        std::thread::sleep(Duration::from_millis(110));
        assert!(matches!(
            tx.commit(),
            Err(ShaclCommitError::Rejected {
                source: ShaclGateError::Validation(ValidationError::LimitExceeded {
                    kind: LimitKind::Time,
                    ..
                }),
                rollback: None,
                ..
            })
        ));
        let mut options = ValidationOptions::default();
        options.limits.max_data_quads = 1;
        let scopes = vec![
            scope(GraphName::DefaultGraph, true),
            scope(GraphName::NamedNode(node("a")), true),
        ];
        let mut tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                key(3),
                policy(0, 2, scopes).with_validation_options(options),
            )?
            .into_transaction();
        tx.insert(quad("one", GraphName::DefaultGraph))?;
        tx.insert(quad("two", GraphName::NamedNode(node("a"))))?;
        assert!(matches!(
            tx.commit(),
            Err(ShaclCommitError::Rejected {
                source: ShaclGateError::Validation(ValidationError::LimitExceeded {
                    kind: LimitKind::DataQuads,
                    limit: 1
                }),
                rollback: None,
                ..
            })
        ));
        let mut tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                key(4),
                default_policy(0, 2).with_snapshot_limits(1, 4096),
            )?
            .into_transaction();
        tx.insert(quad(&"x".repeat(5000), GraphName::DefaultGraph))?;
        assert!(matches!(
            tx.commit(),
            Err(ShaclCommitError::Rejected {
                source: ShaclGateError::SnapshotBytes(4096),
                rollback: None,
                ..
            })
        ));
        for id in 1..=4 {
            no_receipt(store, id)?;
        }
        assert!(store.is_empty()?);
        assert!(
            store
                .read_outbox(None, NonZeroUsize::MIN)?
                .records()
                .is_empty()
        );
        Ok(())
    })
}

#[test]
fn concurrent_individually_plausible_writers_cannot_both_commit() -> TestResult {
    each_backend(|store| {
        let mut first = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), default_policy(0, 1))?
            .into_transaction();
        first.insert(quad("one", GraphName::DefaultGraph))?;
        std::thread::scope(|scope| -> TestResult {
            let (attempted, received) = std::sync::mpsc::channel();
            let second = scope.spawn(move || -> TestResult {
                attempted.send(())?;
                let mut tx = store
                    .start_shacl_transaction(
                        TransactionRequest::default(),
                        key(2),
                        default_policy(0, 1),
                    )?
                    .into_transaction();
                tx.insert(quad("two", GraphName::DefaultGraph))?;
                assert!(matches!(
                    tx.commit(),
                    Err(ShaclCommitError::Rejected {
                        source: ShaclGateError::Nonconforming { .. },
                        rollback: None,
                        ..
                    })
                ));
                Ok(())
            });
            received.recv_timeout(Duration::from_secs(5))?;
            first.commit()?;
            second.join().map_err(|_| "writer panicked")??;
            Ok(())
        })?;
        assert_eq!(store.len()?, 1);
        no_receipt(store, 2)?;
        Ok(())
    })
}

#[test]
fn explicit_and_drop_rollback_publish_nothing() -> TestResult {
    each_backend(|store| {
        for id in 1..=2 {
            let mut tx = store
                .start_shacl_transaction(
                    TransactionRequest::default(),
                    key(id),
                    default_policy(0, 1),
                )?
                .into_transaction();
            tx.insert(quad("one", GraphName::DefaultGraph))?;
            if id == 1 {
                tx.rollback()?;
            } else {
                drop(tx);
            }
            no_receipt(store, id)?;
        }
        assert!(store.is_empty()?);
        assert!(
            store
                .read_outbox(None, NonZeroUsize::MIN)?
                .records()
                .is_empty()
        );
        Ok(())
    })
}

#[test]
fn full_clear_and_graph_removal_variants_validate_resulting_topology() -> TestResult {
    each_backend(|store| {
        let graph = GraphName::NamedNode(node("selected"));
        store.insert(quad("one", graph.clone()))?;
        for id in 1..=4 {
            let mut tx = store
                .start_shacl_transaction(
                    TransactionRequest::default(),
                    key(id),
                    policy(1, 1, vec![scope(graph.clone(), true)]),
                )?
                .into_transaction();
            match id {
                1 => tx.clear_all_graphs()?,
                2 => tx.remove_all_named_graphs()?,
                3 => tx.clear()?,
                _ => tx.clear_graph(Some(&node("selected").into()))?,
            }
            assert!(matches!(
                tx.commit(),
                Err(ShaclCommitError::Rejected { rollback: None, .. })
            ));
            no_receipt(store, id)?;
            assert!(store.contains(&quad("one", graph.clone()))?);
        }
        Ok(())
    })
}

#[test]
fn retained_report_shapes_are_charged_to_cumulative_byte_limit() -> TestResult {
    let store = Store::new()?;
    let tx = store
        .start_shacl_transaction(
            TransactionRequest::default(),
            key(1),
            default_policy(0, 1).with_snapshot_limits(8, 4096),
        )?
        .into_transaction();
    tx.commit()?;
    let scopes = (0..8)
        .map(|i| scope(GraphName::NamedNode(node(&format!("graph{i}"))), false))
        .collect();
    let tx = store
        .start_shacl_transaction(
            TransactionRequest::default(),
            key(2),
            policy(0, 1, scopes).with_snapshot_limits(8, 4096),
        )?
        .into_transaction();
    assert!(matches!(
        tx.commit(),
        Err(ShaclCommitError::Rejected {
            source: ShaclGateError::SnapshotBytes(4096),
            rollback: None,
            ..
        })
    ));
    no_receipt(&store, 2)?;
    Ok(())
}

#[test]
fn cancellation_interrupts_waiting_for_writer_admission() -> TestResult {
    each_backend(|store| {
        let held = store
            .start_governed_transaction(TransactionRequest::default(), key(1))?
            .into_transaction();
        let policy = default_policy(0, 1);
        let control = policy.control();
        std::thread::scope(|scope| -> TestResult {
            let (send, receive) = std::sync::mpsc::channel();
            let worker = scope.spawn(move || -> TestResult {
                let result =
                    store.start_shacl_transaction(TransactionRequest::default(), key(2), policy);
                send.send(matches!(
                    result,
                    Err(oxigraph::store::ShaclStartError::Admission(
                        oxigraph::store::TransactionStartError::Cancelled
                    ) | oxigraph::store::ShaclStartError::Policy {
                        source: ShaclGateError::Validation(ValidationError::Cancelled),
                        rollback: None,
                        ..
                    })
                ))?;
                Ok(())
            });
            control.cancel();
            let cancelled = receive.recv_timeout(Duration::from_secs(5));
            // Release even if the assertion fails, so scoped-thread joining
            // cannot leave a failing test deadlocked behind our writer.
            held.rollback()?;
            assert!(cancelled?);
            worker.join().map_err(|_| "admission worker panicked")??;
            Ok(())
        })?;
        no_receipt(store, 2)?;
        Ok(())
    })
}

#[test]
fn external_identity_is_order_independent_and_imports_fail_closed() -> TestResult {
    let store = Store::new()?;
    let quads = shape_quads(0, 1, GraphName::DefaultGraph);
    let mut identities = Vec::new();
    for (id, quads) in [(1, quads.clone()), (2, quads.into_iter().rev().collect())] {
        let source = GraphSnapshot::default_graph(quads.into_iter().collect());
        let policy = ShaclCommitPolicy::new(
            vec![scope(GraphName::DefaultGraph, true)],
            ShaclShapesSource::External(Box::new(source)),
        );
        let tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(id), policy)?
            .into_transaction();
        identities.push(tx.commit()?.shapes_at_begin);
    }
    assert_eq!(identities[0], identities[1]);
    let mut imported = Dataset::new();
    imported.insert(Quad::new(
        node("shapes"),
        NamedNode::new("http://www.w3.org/2002/07/owl#imports")?,
        node("remote"),
        GraphName::DefaultGraph,
    ));
    let policy = ShaclCommitPolicy::new(
        vec![scope(GraphName::DefaultGraph, true)],
        ShaclShapesSource::External(Box::new(GraphSnapshot::default_graph(imported))),
    );
    assert!(
        store
            .start_shacl_transaction(TransactionRequest::default(), key(3), policy)
            .is_err()
    );
    no_receipt(&store, 3)?;
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn accepted_gate_survives_reopen_with_atomic_receipt_and_outbox() -> TestResult {
    let directory = tempfile::tempdir()?;
    let report = {
        let store = Store::open(directory.path())?;
        let mut tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), default_policy(1, 1))?
            .into_transaction();
        tx.insert(quad("one", GraphName::DefaultGraph))?;
        tx.commit()?
    };
    let store = Store::open(directory.path())?;
    assert!(store.contains(&quad("one", GraphName::DefaultGraph))?);
    assert_eq!(
        store.lookup_commit_receipt(&key(1))?,
        CommitReceiptOutcome::Committed(report.receipt.clone())
    );
    assert_eq!(
        store.read_outbox(None, NonZeroUsize::MIN)?.high_water(),
        report.receipt.outbox_end_cursor().as_ref()
    );
    Ok(())
}
