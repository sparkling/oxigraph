#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public semantic-change contract"
)]

use oxigraph::model::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::store::{
    ChangeTrackingError, ChangeTrackingTransaction, Namespace, NamespacePrefix, SemanticChange,
    Store, TransactionalDataset, WritableDataset, WritableNamespaceRegistry,
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
}

struct TestTransaction<'a> {
    plane: &'a TestPlane,
    target: RefMut<'a, TestState>,
    staged: TestState,
}

impl TransactionalDataset for TestPlane {
    type Error = io::Error;
    type Transaction<'a> = TestTransaction<'a>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        let staged = self.state.borrow().clone();
        Ok(TestTransaction {
            plane: self,
            target: self.state.borrow_mut(),
            staged,
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
