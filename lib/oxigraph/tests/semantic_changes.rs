#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public semantic-change contract"
)]

use oxigraph::model::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{CancellationToken, SparqlEvaluator, UpdateEvaluationError};
use oxigraph::store::{
    ChangeTrackingError, ChangeTrackingTransaction, Namespace, NamespacePrefix,
    NegotiatedTransaction, NegotiatedTransactionalDataset, OutcomeAwareTransactionalDataset,
    OutcomeAwareWritableDataset, RollbackGuarantee, SemanticChange, Store, TransactionCapabilities,
    TransactionCommitError, TransactionKey, TransactionNonCommitReason, TransactionOutcome,
    TransactionRequest, TransactionRequirements, TransactionRollbackError, TransactionStartControl,
    TransactionStartError, TransactionalDataset, WritableDataset, WritableNamespaceRegistry,
    WriterIsolation,
};
use std::cell::{Cell, RefCell, RefMut};
use std::collections::BTreeMap;
use std::error::Error;
use std::io;

type TestResult = Result<(), Box<dyn Error>>;

fn node(name: &str) -> NamedNode {
    NamedNode::new(format!("urn:{name}")).unwrap()
}

fn quad(name: &str, graph: GraphName) -> Quad {
    Quad::new(node(name), node("p"), node("o"), graph)
}

fn namespace(iri: &str) -> Namespace {
    Namespace::new(NamespacePrefix::new("ex").unwrap(), node(iri))
}

fn exercise<D: TransactionalDataset>(dataset: &D) -> TestResult
where
    for<'a> D::Transaction<'a>: WritableNamespaceRegistry,
{
    let old = quad("old", GraphName::DefaultGraph);
    let added = quad("added", GraphName::DefaultGraph);
    let graph: NamedOrBlankNode = BlankNode::new("empty")?.into();
    let mut initial = dataset.start_transaction()?;
    initial.insert(old.clone())?;
    initial.insert_named_graph(graph.clone())?;
    initial.set_namespace(namespace("first"))?;
    initial.commit()?;

    let mut tx = ChangeTrackingTransaction::new(dataset.start_transaction()?);
    tx.insert(old.clone())?; // Already present, not an addition.
    tx.remove(&added)?; // Absent, not a removal.
    tx.insert_named_graph(graph.clone())?;
    tx.remove_namespace(&NamespacePrefix::new("missing")?)?;
    tx.clear_graph(Some(&node("missing").into()))?;
    tx.remove_named_graph(&node("missing").into())?;
    tx.set_namespace(namespace("first"))?;
    assert!(tx.changes()?.is_empty());

    tx.insert(added.clone())?;
    tx.remove(&old)?;
    assert_eq!(
        tx.changes()?.as_slice(),
        &[
            SemanticChange::QuadAdded(added.clone()),
            SemanticChange::QuadRemoved(old.clone()),
        ]
    );
    tx.insert(old.clone())?;
    tx.remove(&added)?;
    assert!(tx.changes()?.is_empty());

    tx.set_namespace(namespace("second"))?;
    tx.insert(added.clone())?;
    tx.set_namespace(namespace("third"))?;
    assert_eq!(
        tx.changes()?.as_slice(),
        &[
            SemanticChange::NamespaceChanged {
                prefix: NamespacePrefix::new("ex")?,
                before: Some(node("first")),
                after: Some(node("third")),
            },
            SemanticChange::QuadAdded(added.clone()),
        ]
    );
    tx.set_namespace(namespace("first"))?;
    tx.remove(&added)?;
    assert!(tx.changes()?.is_empty());

    // Empty graph operations are observable even though there are no quads.
    tx.clear_graph(Some(&graph))?;
    tx.remove_named_graph(&graph)?;
    tx.insert_named_graph(graph.clone())?;
    let named = quad("new", graph.clone().into());
    tx.insert(named.clone())?;
    tx.clear_graph(Some(&graph))?;
    tx.insert(named.clone())?;
    assert_eq!(
        tx.changes()?.as_slice(),
        &[
            SemanticChange::GraphCleared(graph.clone().into()),
            SemanticChange::NamedGraphDropped(graph.clone()),
            SemanticChange::NamedGraphCreated(graph.clone()),
            SemanticChange::QuadAdded(named.clone()),
            SemanticChange::GraphCleared(graph.clone().into()),
            SemanticChange::QuadAdded(named.clone()),
        ]
    );
    let snapshot = tx.changes()?;
    assert_eq!(snapshot, tx.changes()?);
    tx.rollback()?;
    // The retained snapshot remains a pending observation, not a commit receipt.
    assert_eq!(snapshot.len(), 6);
    let read = dataset.start_transaction()?;
    assert!(read.contains_named_graph(&graph)?);
    assert!(
        read.quads_for_pattern(None, None, None, Some(Some(&graph)))
            .next()
            .is_none()
    );
    assert_eq!(
        read.namespace(&NamespacePrefix::new("ex")?)?,
        Some(namespace("first"))
    );
    read.rollback()?;

    // Inserting and removing the sole quad still creates an empty graph.
    let new_graph: NamedOrBlankNode = node("implicit").into();
    let named = quad("implicit", new_graph.clone().into());
    let mut tx = ChangeTrackingTransaction::new(dataset.start_transaction()?);
    tx.insert(named.clone())?;
    tx.remove(&named)?;
    assert_eq!(
        tx.changes()?.as_slice(),
        &[SemanticChange::NamedGraphCreated(new_graph.clone())]
    );
    tx.commit()?;
    let read = dataset.start_transaction()?;
    assert!(read.contains_named_graph(&new_graph)?);
    read.rollback()?;

    // Namespace and RDF clear have distinct effects and scopes.
    let mut tx = ChangeTrackingTransaction::new(dataset.start_transaction()?);
    tx.clear_namespaces()?;
    tx.clear_namespaces()?;
    tx.set_namespace(namespace("after-clear"))?;
    tx.clear()?;
    assert_eq!(
        tx.changes()?.as_slice(),
        &[
            SemanticChange::NamespacesCleared,
            SemanticChange::NamespaceChanged {
                prefix: NamespacePrefix::new("ex")?,
                before: None,
                after: Some(node("after-clear"))
            },
            SemanticChange::DatasetCleared,
        ]
    );
    assert_eq!(
        tx.namespace(&NamespacePrefix::new("ex")?)?,
        Some(namespace("after-clear"))
    );
    tx.commit()?;
    let read = dataset.start_transaction()?;
    assert!(read.named_graphs().next().is_none());
    assert!(
        read.quads_for_pattern(None, None, None, Some(None))
            .next()
            .is_none()
    );
    assert_eq!(
        read.namespace(&NamespacePrefix::new("ex")?)?,
        Some(namespace("after-clear"))
    );
    read.rollback()?;
    Ok(())
}

#[test]
fn memory_transaction_effects() -> TestResult {
    exercise(&Store::new()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_transaction_effects_and_reopen() -> TestResult {
    let directory = tempfile::tempdir()?;
    {
        let store = Store::open(directory.path())?;
        exercise(&store)?;
    }
    let reopened = Store::open(directory.path())?;
    assert!(reopened.is_empty()?);
    assert_eq!(
        reopened.namespace(&NamespacePrefix::new("ex")?)?,
        Some(namespace("after-clear"))
    );
    Ok(())
}

#[test]
fn rewritten_plane_transaction_effects() -> TestResult {
    exercise(&TestPlane::default())
}

#[test]
fn drop_does_not_publish_pending_effects() -> TestResult {
    let store = Store::new()?;
    {
        let mut tx = ChangeTrackingTransaction::new(store.start_transaction()?);
        tx.insert(quad("dropped", GraphName::DefaultGraph))?;
        tx.set_namespace(namespace("dropped"))?;
        assert_eq!(tx.changes()?.len(), 2);
        assert!(store.is_empty()?);
        assert!(store.namespace(&NamespacePrefix::new("ex")?)?.is_none());
    }
    assert!(store.is_empty()?);
    assert!(store.namespace(&NamespacePrefix::new("ex")?)?.is_none());
    Ok(())
}

#[test]
fn ordered_operation_summaries_do_not_expand_graphs_or_quads() -> TestResult {
    let plane = TestPlane::default();
    let mut initial = plane.start_transaction()?;
    for i in 0..1000 {
        initial.insert(quad(&i.to_string(), node("large").into()))?;
    }
    initial.commit()?;
    plane.point_reads.set(0);
    let mut tx = ChangeTrackingTransaction::new(plane.start_transaction()?);
    // Retain each successful aggregate boundary, including an empty target.
    // This is intentionally not a minimal initial-to-final state diff.
    tx.clear_all_named_graphs()?;
    tx.clear_all_graphs()?;
    tx.remove_all_named_graphs()?;
    tx.clear()?;
    assert_eq!(
        tx.changes()?.as_slice(),
        &[
            SemanticChange::AllNamedGraphsCleared,
            SemanticChange::AllGraphsCleared,
            SemanticChange::AllNamedGraphsDropped,
            SemanticChange::DatasetCleared,
        ]
    );
    assert_eq!(plane.point_reads.get(), 0);
    tx.rollback()?;
    assert_eq!(plane.state.borrow().rdf.len(), 1000);
    Ok(())
}

#[test]
fn mutation_failure_rejects_snapshots_and_commit() -> TestResult {
    let plane = TestPlane::default();
    let mut tx = ChangeTrackingTransaction::new(plane.start_transaction()?);
    tx.insert(quad("first", GraphName::DefaultGraph))?;
    plane.fail_after_insert.set(true);
    let Err(failure) = tx.insert(quad("partial", GraphName::DefaultGraph)) else {
        return Err("injected mutation unexpectedly succeeded".into());
    };
    assert!(matches!(&failure, ChangeTrackingError::Backend(_)));
    assert!(
        failure
            .source()
            .and_then(|error| error.downcast_ref::<io::Error>())
            .is_some()
    );
    assert!(matches!(tx.changes(), Err(ChangeTrackingError::Failed)));
    assert!(matches!(tx.clear(), Err(ChangeTrackingError::Failed)));
    assert!(matches!(tx.commit(), Err(ChangeTrackingError::Failed)));
    assert!(plane.state.borrow().rdf.is_empty());
    assert_eq!(plane.commits.get(), 0);
    Ok(())
}

#[test]
fn failed_capture_can_still_roll_back() -> TestResult {
    let plane = TestPlane::default();
    let mut tx = ChangeTrackingTransaction::new(plane.start_transaction()?);
    plane.fail_after_insert.set(true);
    assert!(tx.insert(quad("partial", GraphName::DefaultGraph)).is_err());
    tx.rollback()?;
    assert!(plane.state.borrow().rdf.is_empty());
    Ok(())
}

#[test]
fn capture_read_error_cannot_turn_into_a_successful_noop_or_commit() -> TestResult {
    let plane = TestPlane::default();
    let mut tx = ChangeTrackingTransaction::new(plane.start_transaction()?);
    plane.fail_reads.set(true);
    assert!(matches!(
        tx.insert(quad("unreadable", GraphName::DefaultGraph)),
        Err(ChangeTrackingError::Backend(_))
    ));
    assert!(matches!(tx.changes(), Err(ChangeTrackingError::Failed)));
    assert!(matches!(tx.commit(), Err(ChangeTrackingError::Failed)));
    assert!(plane.state.borrow().rdf.is_empty());
    assert_eq!(plane.commits.get(), 0);
    Ok(())
}

#[test]
fn commit_error_is_not_relabelled_as_rollback() -> TestResult {
    let plane = TestPlane::default();
    let value = quad("committed", GraphName::DefaultGraph);
    let mut tx = ChangeTrackingTransaction::new(plane.start_transaction()?);
    tx.insert(value.clone())?;
    plane.fail_after_commit.set(true);
    assert!(matches!(tx.commit(), Err(ChangeTrackingError::Backend(_))));
    assert!(plane.state.borrow().rdf.contains(value.as_ref()));
    assert_eq!(plane.commits.get(), 1);
    Ok(())
}

#[test]
fn repeated_net_cancellation_does_not_leave_phantom_effects() -> TestResult {
    let store = Store::new()?;
    let mut tx = ChangeTrackingTransaction::new(store.start_transaction()?);
    let first = quad("first", GraphName::DefaultGraph);
    let second = quad("second", GraphName::DefaultGraph);
    for _ in 0..1000 {
        tx.insert(first.clone())?;
        tx.remove(&first)?;
        tx.set_namespace(namespace("temporary"))?;
        tx.remove_namespace(&NamespacePrefix::new("ex")?)?;
    }
    tx.insert(second.clone())?;
    tx.insert(first.clone())?;
    assert_eq!(
        tx.changes()?.as_slice(),
        &[
            SemanticChange::QuadAdded(second),
            SemanticChange::QuadAdded(first)
        ]
    );
    tx.rollback()?;
    Ok(())
}

#[test]
fn unrelated_graph_and_namespace_boundaries_do_not_prevent_cancellation() -> TestResult {
    let store = Store::new()?;
    let graph: NamedOrBlankNode = node("other").into();
    store.insert_named_graph(graph.clone())?;
    store.set_namespace(namespace("original"))?;
    let mut tx = ChangeTrackingTransaction::new(store.start_transaction()?);
    let value = quad("default", GraphName::DefaultGraph);
    tx.insert(value.clone())?;
    tx.set_namespace(namespace("temporary"))?;
    tx.clear_graph(Some(&graph))?;
    tx.remove(&value)?;
    tx.set_namespace(namespace("original"))?;
    assert_eq!(
        tx.changes()?.as_slice(),
        &[SemanticChange::GraphCleared(graph.into())]
    );
    tx.insert(value.clone())?;
    tx.clear_namespaces()?;
    tx.remove(&value)?;
    assert_eq!(tx.changes()?.len(), 2);
    tx.rollback()?;
    Ok(())
}

fn exercise_update<D: TransactionalDataset>(dataset: &D) -> TestResult {
    let changes = SparqlEvaluator::new()
        .parse_update(
            "INSERT DATA { <urn:temporary> <urn:p> <urn:o> };
         DELETE WHERE { <urn:temporary> ?p ?o };
         CREATE GRAPH <urn:g>; CLEAR GRAPH <urn:g>;
         INSERT DATA { GRAPH <urn:g> { <urn:kept> <urn:p> <urn:o> } };
         CREATE GRAPH <urn:empty>; DROP GRAPH <urn:empty>; CREATE GRAPH <urn:empty>",
        )?
        .on_dataset(dataset)
        .execute_with_changes()?;
    assert_eq!(
        changes.as_slice(),
        &[
            SemanticChange::NamedGraphCreated(node("g").into()),
            SemanticChange::GraphCleared(node("g").into()),
            SemanticChange::QuadAdded(quad("kept", node("g").into())),
            SemanticChange::NamedGraphCreated(node("empty").into()),
            SemanticChange::NamedGraphDropped(node("empty").into()),
            SemanticChange::NamedGraphCreated(node("empty").into()),
        ]
    );
    let read = dataset.start_transaction()?;
    assert!(
        read.quads_for_pattern(None, None, None, Some(None))
            .next()
            .is_none()
    );
    assert_eq!(
        read.quads_for_pattern(None, None, None, Some(Some(&node("g").into())))
            .collect::<Result<Vec<_>, _>>()?,
        vec![quad("kept", node("g").into())]
    );
    assert!(read.contains_named_graph(&node("empty").into())?);
    read.rollback()?;

    let failed = SparqlEvaluator::new()
        .parse_update(
            "INSERT DATA { <urn:rolled-back> <urn:p> <urn:o> };
         DROP GRAPH <urn:g>; CREATE GRAPH <urn:new>;
         CREATE GRAPH <urn:empty>",
        )?
        .on_dataset(dataset)
        .execute_with_changes();
    assert!(matches!(
        failed,
        Err(UpdateEvaluationError::GraphAlreadyExists(_))
    ));
    let read = dataset.start_transaction()?;
    assert!(
        read.quads_for_pattern(None, None, None, Some(None))
            .next()
            .is_none()
    );
    assert!(read.contains_named_graph(&node("g").into())?);
    assert!(!read.contains_named_graph(&node("new").into())?);
    read.rollback()?;
    Ok(())
}

#[test]
fn request_changes_cover_read_your_writes_lifecycle_and_atomic_rollback() -> TestResult {
    exercise_update(&Store::new()?)?;
    exercise_update(&TestPlane::default())
}

#[test]
fn negotiated_update_returns_only_committed_changes() -> TestResult {
    let plane = TestPlane::default();
    let changes = SparqlEvaluator::new()
        .parse_update("CREATE GRAPH <urn:g>")?
        .on_dataset_with_request(&plane, TransactionRequest::default())
        .execute_with_changes()?;
    assert_eq!(
        changes.as_slice(),
        &[SemanticChange::NamedGraphCreated(node("g").into())]
    );
    assert_eq!(plane.opens.get(), 1);
    assert_eq!(plane.commits.get(), 1);
    assert_eq!(plane.rollbacks.get(), 0);
    Ok(())
}

fn exercise_keyed_update(store: &Store) -> TestResult {
    let key = TransactionKey::new([0x71; 16]);
    let prepared = SparqlEvaluator::new()
        .parse_update("INSERT DATA { GRAPH <urn:keyed> { <urn:committed> <urn:p> <urn:o> } }")?;
    let changes = prepared
        .clone()
        .on_dataset_with_key(store, TransactionRequest::default(), key.clone())
        .execute_with_changes()?;
    assert_eq!(
        changes.as_slice(),
        &[
            SemanticChange::NamedGraphCreated(node("keyed").into()),
            SemanticChange::QuadAdded(quad("committed", node("keyed").into())),
        ]
    );
    assert_eq!(
        store.lookup_transaction_outcome(&key)?,
        TransactionOutcome::Committed
    );
    prepared
        .on_dataset_with_key(store, TransactionRequest::default(), key)
        .execute_with_changes()
        .unwrap_err();

    let key = TransactionKey::new([0x72; 16]);
    let failed = SparqlEvaluator::new()
        .parse_update(
            "DROP GRAPH <urn:keyed>; CREATE GRAPH <urn:duplicate>; CREATE GRAPH <urn:duplicate>",
        )?
        .on_dataset_with_key(store, TransactionRequest::default(), key.clone())
        .execute_with_changes();
    assert!(matches!(
        failed,
        Err(UpdateEvaluationError::GraphAlreadyExists(_))
    ));
    assert!(store.contains_named_graph(&node("keyed").into())?);
    assert!(!store.contains_named_graph(&node("duplicate").into())?);
    assert_eq!(
        store.lookup_transaction_outcome(&key)?,
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    Ok(())
}

#[test]
fn keyed_update_commits_once_and_records_failed_request_rollback() -> TestResult {
    exercise_keyed_update(&Store::new()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn request_changes_and_keyed_outcomes_survive_rocksdb_reopen() -> TestResult {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    exercise_update(&store)?;
    exercise_keyed_update(&store)?;
    drop(store);
    let store = Store::open(directory.path())?;
    assert!(store.contains(&quad("committed", node("keyed").into()))?);
    assert!(store.contains_named_graph(&node("empty").into())?);
    assert_eq!(
        store.lookup_transaction_outcome(&TransactionKey::new([0x71; 16]))?,
        TransactionOutcome::Committed
    );
    assert_eq!(
        store.lookup_transaction_outcome(&TransactionKey::new([0x72; 16]))?,
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    Ok(())
}

#[test]
fn cancelled_capture_never_opens_any_owned_binding() -> TestResult {
    let plane = TestPlane::default();
    let token = CancellationToken::new();
    token.cancel();
    let update = SparqlEvaluator::new()
        .with_cancellation_token(token)
        .parse_update("CREATE GRAPH <urn:cancelled>")?;
    assert!(matches!(
        update.clone().on_dataset(&plane).execute_with_changes(),
        Err(UpdateEvaluationError::Cancelled)
    ));
    assert!(matches!(
        update
            .clone()
            .on_dataset_with_request(&plane, TransactionRequest::default())
            .execute_with_changes(),
        Err(UpdateEvaluationError::Cancelled)
    ));
    assert!(matches!(
        update
            .on_dataset_with_key(
                &plane,
                TransactionRequest::default(),
                TransactionKey::new([1; 16])
            )
            .execute_with_changes(),
        Err(UpdateEvaluationError::Cancelled)
    ));
    assert_eq!(plane.opens.get(), 0);
    assert_eq!(plane.commits.get(), 0);
    assert_eq!(plane.rollbacks.get(), 0);
    assert_eq!(plane.outcome.get(), None);
    Ok(())
}

#[test]
fn cancellation_after_staging_rolls_back_every_owned_binding() -> TestResult {
    for binding in 0..3 {
        let token = CancellationToken::new();
        let plane = TestPlane {
            cancel_after_insert: Some(token.clone()),
            ..TestPlane::default()
        };
        let update = SparqlEvaluator::new()
            .with_cancellation_token(token)
            .parse_update("INSERT DATA { <urn:cancelled> <urn:p> <urn:o> }")?;
        let result = match binding {
            0 => update.on_dataset(&plane).execute_with_changes(),
            1 => update
                .on_dataset_with_request(&plane, TransactionRequest::default())
                .execute_with_changes(),
            _ => update
                .on_dataset_with_key(
                    &plane,
                    TransactionRequest::default(),
                    TransactionKey::new([2; 16]),
                )
                .execute_with_changes(),
        };
        assert!(matches!(result, Err(UpdateEvaluationError::Cancelled)));
        assert_eq!(plane.opens.get(), 1);
        assert_eq!(plane.commits.get(), 0);
        assert_eq!(plane.rollbacks.get(), 1);
        assert!(plane.state.borrow().rdf.is_empty());
    }
    Ok(())
}

#[test]
fn update_capture_preserves_mutation_and_rollback_failures() -> TestResult {
    let plane = TestPlane::default();
    plane.fail_after_insert.set(true);
    plane.fail_rollback.set(true);
    let failure = SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:partial> <urn:p> <urn:o> }")?
        .on_dataset(&plane)
        .execute_with_changes()
        .unwrap_err();
    assert!(failure.to_string().contains("injected after staging"));
    assert!(failure.to_string().contains("injected rollback failure"));
    assert_eq!(plane.commits.get(), 0);
    assert_eq!(plane.rollbacks.get(), 1);
    assert!(plane.state.borrow().rdf.is_empty());
    Ok(())
}

#[test]
fn update_commit_failure_returns_no_changes_and_never_rolls_back() -> TestResult {
    let plane = TestPlane::default();
    plane.fail_after_commit.set(true);
    let failure = SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:committed> <urn:p> <urn:o> }")?
        .on_dataset(&plane)
        .execute_with_changes()
        .unwrap_err();
    assert!(
        matches!(failure, UpdateEvaluationError::Dataset(error) if error.downcast_ref::<io::Error>().is_some())
    );
    assert_eq!(plane.commits.get(), 1);
    assert_eq!(plane.rollbacks.get(), 0);
    assert!(
        plane
            .state
            .borrow()
            .rdf
            .contains(quad("committed", GraphName::DefaultGraph).as_ref())
    );
    Ok(())
}

#[test]
fn keyed_commit_failure_retains_all_typed_outcomes_and_exact_indeterminate_key() -> TestResult {
    for outcome in 0..4 {
        let plane = TestPlane::default();
        plane.fail_after_commit.set(true);
        plane.commit_failure.set(outcome);
        let key = TransactionKey::new([0xA9; 16]);
        let failure = SparqlEvaluator::new()
            .parse_update("INSERT DATA { <urn:committed> <urn:p> <urn:o> }")?
            .on_dataset_with_key(&plane, TransactionRequest::default(), key.clone())
            .execute_with_changes()
            .unwrap_err();
        let typed = failure
            .source()
            .and_then(|error| {
                error.downcast_ref::<TransactionCommitError<ChangeTrackingError<io::Error>>>()
            })
            .unwrap();
        match (outcome, typed) {
            (
                0,
                TransactionCommitError::Indeterminate {
                    transaction_key,
                    source: ChangeTrackingError::Backend(source),
                },
            ) => {
                assert_eq!(transaction_key, &key);
                assert_eq!(source.to_string(), "injected lost commit response");
                assert_eq!(
                    plane.lookup_transaction_outcome(&key)?,
                    TransactionOutcome::Committed
                );
                assert_eq!(plane.commits.get(), 1);
            }
            (1, TransactionCommitError::Rejected(ChangeTrackingError::Backend(_)))
            | (2, TransactionCommitError::Conflicted)
            | (3, TransactionCommitError::Cancelled) => {
                assert_eq!(plane.commits.get(), 0);
                assert!(plane.state.borrow().rdf.is_empty());
            }
            _ => {
                return Err(
                    io::Error::other(format!("typed commit outcome changed: {typed:?}")).into(),
                );
            }
        }
        assert_eq!(plane.opens.get(), 1);
        assert_eq!(plane.rollbacks.get(), 0);
    }
    Ok(())
}

#[test]
fn poisoned_keyed_capture_does_not_attempt_commit() -> TestResult {
    let plane = TestPlane::default();
    plane.fail_after_insert.set(true);
    let mut transaction = ChangeTrackingTransaction::new(
        plane
            .start_transaction_with_key(
                TransactionRequest::default(),
                TransactionKey::new([3; 16]),
            )?
            .into_transaction(),
    );
    assert!(
        transaction
            .insert(quad("partial", GraphName::DefaultGraph))
            .is_err()
    );
    assert!(matches!(
        transaction.commit_with_outcome(),
        Err(TransactionCommitError::Rejected(
            ChangeTrackingError::Failed
        ))
    ));
    assert_eq!(plane.commits.get(), 0);
    assert!(plane.state.borrow().rdf.is_empty());
    Ok(())
}

#[test]
fn unsupported_capture_requirements_reject_before_opening() -> TestResult {
    let plane = TestPlane::default();
    let request = TransactionRequest::new(
        TransactionRequirements::legacy().requiring_writer_isolation(WriterIsolation::Serialized),
    );
    let update = SparqlEvaluator::new().parse_update("CREATE GRAPH <urn:unadmitted>")?;
    for failure in [
        update
            .clone()
            .on_dataset_with_request(&plane, request.clone())
            .execute_with_changes()
            .unwrap_err(),
        update
            .on_dataset_with_key(&plane, request, TransactionKey::new([4; 16]))
            .execute_with_changes()
            .unwrap_err(),
    ] {
        assert!(matches!(
            failure
                .source()
                .and_then(|error| error.downcast_ref::<TransactionStartError<io::Error>>()),
            Some(TransactionStartError::RequirementsNotMet { .. })
        ));
    }
    assert_eq!(plane.opens.get(), 0);
    Ok(())
}

#[test]
fn poisoned_keyed_capture_can_roll_back_and_preserves_rollback_failure() -> TestResult {
    let plane = TestPlane::default();
    plane.fail_after_insert.set(true);
    plane.fail_rollback.set(true);
    let mut transaction = ChangeTrackingTransaction::new(
        plane
            .start_transaction_with_key(
                TransactionRequest::default(),
                TransactionKey::new([5; 16]),
            )?
            .into_transaction(),
    );
    assert!(
        transaction
            .insert(quad("partial", GraphName::DefaultGraph))
            .is_err()
    );
    assert!(matches!(transaction.rollback_with_outcome(),
        Err(TransactionRollbackError::Failed(ChangeTrackingError::Backend(error)))
        if error.to_string() == "injected rollback failure"));
    let failure = SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:partial> <urn:p> <urn:o> }")?
        .on_dataset_with_key(
            &plane,
            TransactionRequest::default(),
            TransactionKey::new([6; 16]),
        )
        .execute_with_changes()
        .unwrap_err();
    assert!(failure.to_string().contains("injected after staging"));
    assert!(failure.to_string().contains("injected rollback failure"));
    assert_eq!(plane.commits.get(), 0);
    assert_eq!(plane.rollbacks.get(), 2);
    assert!(plane.state.borrow().rdf.is_empty());
    Ok(())
}

#[cfg(feature = "http-client")]
#[test]
fn tracked_load_retains_egress_denial_and_rolls_back() -> TestResult {
    use oxigraph::sparql::{EgressError, EgressErrorKind, EgressPolicy};
    for binding in 0..3 {
        let plane = TestPlane::default();
        let update = SparqlEvaluator::new()
            .with_egress_policy(EgressPolicy::deny_all())
            .parse_update("CREATE GRAPH <urn:rollback>; LOAD <http://127.0.0.1:1/denied>")?;
        let failure = match binding {
            0 => update.on_dataset(&plane).execute_with_changes(),
            1 => update
                .on_dataset_with_request(&plane, TransactionRequest::default())
                .execute_with_changes(),
            _ => update
                .on_dataset_with_key(
                    &plane,
                    TransactionRequest::default(),
                    TransactionKey::new([7; 16]),
                )
                .execute_with_changes(),
        }
        .unwrap_err();
        let mut cause: Option<&(dyn Error + 'static)> = Some(&failure);
        let mut denied = false;
        while let Some(error) = cause {
            if let Some(error) = error.downcast_ref::<EgressError>() {
                denied = error.kind() == EgressErrorKind::PolicyDenied;
            }
            cause = error.source();
        }
        assert!(denied);
        assert_eq!(plane.commits.get(), 0);
        assert_eq!(plane.rollbacks.get(), 1);
        assert_eq!(plane.state.borrow().rdf.named_graphs().count(), 0);

        // Preserve the existing LOAD SILENT policy semantics: denial still
        // prevents retrieval, but does not abort unrelated staged operations.
        let changes = SparqlEvaluator::new()
            .with_egress_policy(EgressPolicy::deny_all())
            .parse_update("CREATE GRAPH <urn:silent>; LOAD SILENT <http://127.0.0.1:1/denied>")?
            .on_dataset(&plane)
            .execute_with_changes()?;
        assert_eq!(
            changes.as_slice(),
            &[SemanticChange::NamedGraphCreated(node("silent").into())]
        );
        assert!(plane.state.borrow().rdf.is_empty());
    }
    Ok(())
}

// A separate Dataset-based persistence plane, not a built-in storage log.
// Its counters make accidental dataset expansion by capture observable.
#[derive(Clone, Default)]
struct TestState {
    rdf: Dataset,
    namespaces: BTreeMap<NamespacePrefix, NamedNode>,
}

#[derive(Default)]
struct TestPlane {
    state: RefCell<TestState>,
    fail_after_insert: Cell<bool>,
    fail_reads: Cell<bool>,
    fail_after_commit: Cell<bool>,
    point_reads: Cell<usize>,
    commits: Cell<usize>,
    opens: Cell<usize>,
    rollbacks: Cell<usize>,
    fail_rollback: Cell<bool>,
    cancel_after_insert: Option<CancellationToken>,
    outcome: Cell<Option<TransactionOutcome>>,
    commit_failure: Cell<u8>,
}

struct TestTransaction<'a> {
    plane: &'a TestPlane,
    target: RefMut<'a, TestState>,
    staged: TestState,
    key: Option<TransactionKey>,
}

impl TransactionalDataset for TestPlane {
    type Error = io::Error;
    type Transaction<'a> = TestTransaction<'a>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        self.opens.set(self.opens.get() + 1);
        let staged = self.state.borrow().clone();
        Ok(TestTransaction {
            plane: self,
            target: self.state.borrow_mut(),
            staged,
            key: None,
        })
    }
}

impl WritableDataset for TestTransaction<'_> {
    type Error = io::Error;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Self::Error>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Self::Error>> + 'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        self.plane.point_reads.set(self.plane.point_reads.get() + 1);
        if self.plane.fail_reads.get() {
            return Box::new(std::iter::once(Err(io::Error::other(
                "injected read failure",
            ))));
        }
        let (subject, predicate, object, graph) = (
            subject.cloned(),
            predicate.cloned(),
            object.cloned(),
            graph_name.map(Option::<&NamedOrBlankNode>::cloned),
        );
        Box::new(
            self.staged
                .rdf
                .iter()
                .filter(move |q| {
                    subject.as_ref().is_none_or(|s| s == &q.subject)
                        && predicate.as_ref().is_none_or(|p| p == &q.predicate)
                        && object.as_ref().is_none_or(|o| o == &q.object)
                        && match &graph {
                            Some(None) => q.graph_name.is_default_graph(),
                            Some(Some(g)) => q.graph_name == GraphName::from(g.clone()),
                            None => !q.graph_name.is_default_graph(),
                        }
                })
                .map(Ok),
        )
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        self.plane.point_reads.set(self.plane.point_reads.get() + 1);
        Box::new(self.staged.rdf.named_graphs().map(Ok))
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        Ok(self.staged.rdf.contains_named_graph(graph_name.as_ref()))
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.staged.rdf.insert(quad);
        if let Some(token) = &self.plane.cancel_after_insert {
            token.cancel();
        }
        if self.plane.fail_after_insert.get() {
            Err(io::Error::other("injected after staging"))
        } else {
            Ok(())
        }
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.staged.rdf.remove(quad.as_ref());
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.rdf.insert_named_graph(graph_name);
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        self.staged
            .rdf
            .clear_graph(&graph_name.map_or(GraphName::DefaultGraph, |g| g.clone().into()));
        Ok(())
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph in self.staged.rdf.named_graphs().collect::<Vec<_>>() {
            self.staged.rdf.clear_graph(&graph);
        }
        Ok(())
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.clear_graph(None)?;
        self.clear_all_named_graphs()
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.rdf.remove_named_graph(graph_name.as_ref());
        Ok(())
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph in self.staged.rdf.named_graphs().collect::<Vec<_>>() {
            self.staged.rdf.remove_named_graph(graph.as_ref());
        }
        Ok(())
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        self.staged.rdf.clear();
        Ok(())
    }

    fn commit(mut self) -> Result<(), Self::Error> {
        *self.target = self.staged;
        self.plane.commits.set(self.plane.commits.get() + 1);
        if self.plane.fail_after_commit.get() {
            Err(io::Error::other("injected lost commit response"))
        } else {
            Ok(())
        }
    }

    fn rollback(self) -> Result<(), Self::Error> {
        self.plane.rollbacks.set(self.plane.rollbacks.get() + 1);
        if self.plane.fail_rollback.get() {
            Err(io::Error::other("injected rollback failure"))
        } else {
            Ok(())
        }
    }
}

impl NegotiatedTransactionalDataset for TestPlane {
    fn transaction_capabilities(&self) -> TransactionCapabilities {
        TransactionCapabilities::none()
            .with_atomic_publication()
            .with_read_your_writes()
            .with_rollback(RollbackGuarantee::ExplicitOrDropBeforeCommit)
    }
}

impl OutcomeAwareTransactionalDataset for TestPlane {
    type KeyedTransaction<'a> = TestTransaction<'a>;

    fn start_transaction_with_key_and_control(
        &self,
        request: TransactionRequest,
        transaction_key: TransactionKey,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<Self::KeyedTransaction<'_>>, TransactionStartError<Self::Error>>
    {
        let admitted = self.start_transaction_with_control(request, control)?;
        let capabilities = admitted.effective_capabilities().clone();
        let mut transaction = admitted.into_transaction();
        transaction.key = Some(transaction_key);
        Ok(NegotiatedTransaction::new(transaction, capabilities))
    }

    // This fault fixture only models one keyed request per fresh plane.
    fn lookup_transaction_outcome(
        &self,
        _key: &TransactionKey,
    ) -> Result<TransactionOutcome, Self::Error> {
        Ok(self
            .outcome
            .get()
            .unwrap_or(TransactionOutcome::Indeterminate))
    }
}

impl OutcomeAwareWritableDataset for TestTransaction<'_> {
    fn commit_with_outcome(self) -> Result<(), TransactionCommitError<Self::Error>> {
        match self.plane.commit_failure.get() {
            1 => {
                return Err(TransactionCommitError::Rejected(io::Error::other(
                    "rejected",
                )));
            }
            2 => return Err(TransactionCommitError::Conflicted),
            3 => return Err(TransactionCommitError::Cancelled),
            _ => (),
        }
        let transaction_key = self.key.clone().unwrap();
        let plane = self.plane;
        let result = self.commit();
        plane.outcome.set(Some(TransactionOutcome::Committed));
        result.map_err(|source| TransactionCommitError::Indeterminate {
            transaction_key,
            source,
        })
    }

    fn rollback_with_outcome(self) -> Result<(), TransactionRollbackError<Self::Error>> {
        let plane = self.plane;
        self.rollback().map_err(TransactionRollbackError::Failed)?;
        plane.outcome.set(Some(TransactionOutcome::ProvenAbsent(
            TransactionNonCommitReason::RolledBack,
        )));
        Ok(())
    }
}

impl WritableNamespaceRegistry for TestTransaction<'_> {
    type Namespaces<'a>
        = Box<dyn Iterator<Item = Result<Namespace, Self::Error>> + 'a>
    where
        Self: 'a;
    fn namespaces(&self) -> Self::Namespaces<'_> {
        Box::new(
            self.staged
                .namespaces
                .iter()
                .map(|(prefix, iri)| Ok(Namespace::new(prefix.clone(), iri.clone()))),
        )
    }
    fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, Self::Error> {
        Ok(self
            .staged
            .namespaces
            .get(prefix)
            .map(|iri| Namespace::new(prefix.clone(), iri.clone())))
    }
    fn set_namespace(&mut self, namespace: Namespace) -> Result<(), Self::Error> {
        let (prefix, iri) = namespace.into_parts();
        self.staged.namespaces.insert(prefix, iri);
        Ok(())
    }
    fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), Self::Error> {
        self.staged.namespaces.remove(prefix);
        Ok(())
    }
    fn clear_namespaces(&mut self) -> Result<(), Self::Error> {
        self.staged.namespaces.clear();
        Ok(())
    }
}
