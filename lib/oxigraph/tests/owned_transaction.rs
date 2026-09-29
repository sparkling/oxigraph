#![cfg(not(target_family = "wasm"))]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public owned transaction contract"
)]

use oxigraph::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{QueryResults, SparqlEvaluator, UpdateEvaluationError};
use oxigraph::store::{
    CancellationGuarantee, ConflictBehavior, Namespace, NamespacePrefix, NegotiatedTransaction,
    NegotiatedTransactionalDataset, OwnedTransaction, OwnedTransactionalDataset, RollbackGuarantee,
    Store, TransactionCapabilities, TransactionObservation, TransactionRequest,
    TransactionRequirements, TransactionStartControl, TransactionStartError, TransactionalDataset,
    UnmetTransactionRequirement, WritableDataset, WritableNamespaceRegistry, WriterIsolation,
};
use std::cell::RefCell;
use std::cell::RefMut;
use std::convert::Infallible;
use std::error::Error;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

type TestError = Box<dyn Error + Send + Sync>;
type TestResult = Result<(), TestError>;

const BOUND: Duration = Duration::from_secs(5);

fn node(label: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:owned:{label}"))
}

fn iri(label: &str) -> String {
    format!("<urn:owned:{label}>")
}

fn quad(label: &str) -> Quad {
    Quad::new(node(label), node("p"), node("o"), GraphName::DefaultGraph)
}

fn named_quad(label: &str, graph: &str) -> Quad {
    Quad::new(node(label), node("p"), node("o"), node(graph))
}

fn select_values(
    tx: &OwnedTransaction,
    query: &str,
    variable: &str,
) -> Result<Vec<String>, TestError> {
    let QueryResults::Solutions(solutions) = SparqlEvaluator::new()
        .parse_query(query)?
        .on_transaction(tx.as_transaction())
        .execute()?
    else {
        return Err("expected solutions".into());
    };
    let mut values = Vec::new();
    for solution in solutions {
        let solution = solution?;
        values.push(
            solution
                .get(variable)
                .map(ToString::to_string)
                .ok_or("unbound variable")?,
        );
    }
    values.sort();
    Ok(values)
}

fn prefixes(tx: &OwnedTransaction) -> Result<Vec<String>, TestError> {
    let mut values = Vec::new();
    for namespace in tx.as_transaction().namespaces() {
        values.push(namespace?.prefix().as_str().to_owned());
    }
    Ok(values)
}

fn namespace(prefix: &str) -> Result<Namespace, TestError> {
    Ok(Namespace::new(
        NamespacePrefix::new(prefix.to_owned())?,
        NamedNode::new(format!("http://example.com/{prefix}/"))?,
    ))
}

fn bounded<T: Send + 'static>(
    store: &Store,
    work: impl FnOnce(Store) -> T + Send + 'static,
) -> Result<T, TestError> {
    let store = store.clone();
    let (sender, receiver) = mpsc::channel();
    let handle = thread::spawn(move || {
        let _delivered = sender.send(work(store));
    });
    let value = receiver.recv_timeout(BOUND)?;
    handle.join().map_err(|_| "bounded thread panicked")?;
    Ok(value)
}

#[derive(Debug, Eq, PartialEq)]
enum Start {
    Started,
    Requirements,
    Cancelled,
    TimedOut,
    Backend,
}

fn start_kind(
    store: &Store,
    request: TransactionRequest,
    control: TransactionStartControl,
) -> Start {
    match store.start_owned_transaction_with_control(request, control) {
        Ok(_) => Start::Started,
        Err(TransactionStartError::RequirementsNotMet { .. }) => Start::Requirements,
        Err(TransactionStartError::Cancelled) => Start::Cancelled,
        Err(TransactionStartError::TimedOut) => Start::TimedOut,
        Err(TransactionStartError::Backend(_)) => Start::Backend,
    }
}

fn owned_outlives_store(store: Store) -> TestResult {
    let staged = quad("staged");
    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().insert(staged.clone());
    drop(store);
    assert!(tx.as_transaction().contains(&staged)?);
    assert_eq!(tx.as_transaction().len()?, 1);
    tx.commit()?;
    Ok(())
}

fn composes_query_and_update(store: Store) -> TestResult {
    let mut tx = store.start_owned_transaction()?;
    SparqlEvaluator::new()
        .parse_update(&format!(
            "INSERT DATA {{ {} <urn:owned:p> {} }}",
            iri("a"),
            iri("b")
        ))?
        .on_transaction(tx.as_transaction_mut())
        .execute()?;
    assert_eq!(
        select_values(&tx, "SELECT ?s WHERE { ?s <urn:owned:p> ?o }", "s")?,
        vec![iri("a")]
    );
    SparqlEvaluator::new()
        .parse_update(
            "DELETE { ?s <urn:owned:p> ?o } INSERT { ?s <urn:owned:q> ?o } \
             WHERE { ?s <urn:owned:p> ?o }",
        )?
        .on_transaction(tx.as_transaction_mut())
        .execute()?;
    assert!(select_values(&tx, "SELECT ?s WHERE { ?s <urn:owned:p> ?o }", "s")?.is_empty());
    assert_eq!(
        select_values(&tx, "SELECT ?s WHERE { ?s <urn:owned:q> ?o }", "s")?,
        vec![iri("a")]
    );
    assert_eq!(store.len()?, 0);
    tx.commit()?;
    assert_eq!(store.len()?, 1);
    Ok(())
}

fn topology(store: Store) -> TestResult {
    let empty = NamedOrBlankNode::from(node("empty"));
    let filled = NamedOrBlankNode::from(node("filled"));
    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().insert_named_graph(empty.clone());
    assert!(tx.as_transaction().contains_named_graph(&empty)?);
    let graphs = tx
        .as_transaction()
        .named_graphs()
        .collect::<Result<Vec<_>, _>>()?;
    assert!(graphs.contains(&empty));
    tx.as_transaction_mut().insert(named_quad("x", "filled"));
    tx.as_transaction_mut()
        .clear_graph(&GraphName::from(node("filled")))?;
    assert!(tx.as_transaction().contains_named_graph(&filled)?);
    assert_eq!(tx.as_transaction().len()?, 0);
    tx.as_transaction_mut().remove_named_graph(&filled)?;
    assert!(!tx.as_transaction().contains_named_graph(&filled)?);
    assert!(!store.contains_named_graph(&empty)?);
    tx.commit()?;
    assert!(store.contains_named_graph(&empty)?);
    assert!(!store.contains_named_graph(&filled)?);
    Ok(())
}

fn staged_quads_and_trait_forwarding(store: Store) -> TestResult {
    let graph = NamedOrBlankNode::from(node("g"));
    let mut tx = store.start_owned_transaction()?;
    WritableDataset::insert(&mut tx, quad("d"))?;
    WritableDataset::insert(&mut tx, named_quad("n", "g"))?;
    assert_eq!(
        WritableDataset::quads_for_pattern(&tx, None, None, None, Some(None)).count(),
        1
    );
    assert_eq!(
        WritableDataset::quads_for_pattern(&tx, None, None, None, None).count(),
        1
    );
    assert_eq!(
        WritableDataset::quads_for_pattern(&tx, None, None, None, Some(Some(&graph))).count(),
        1
    );
    assert_eq!(tx.as_transaction().len()?, 2);
    WritableDataset::remove(&mut tx, &quad("d"))?;
    assert_eq!(
        WritableDataset::quads_for_pattern(&tx, None, None, None, Some(None)).count(),
        0
    );
    WritableDataset::clear_all_graphs(&mut tx)?;
    assert!(WritableDataset::contains_named_graph(&tx, &graph)?);
    assert_eq!(tx.as_transaction().len()?, 0);
    WritableDataset::remove_all_named_graphs(&mut tx)?;
    assert!(!WritableDataset::contains_named_graph(&tx, &graph)?);
    WritableDataset::rollback(tx)?;
    assert!(store.is_empty()?);
    Ok(())
}

fn namespaces(store: Store) -> TestResult {
    let (a, b, empty) = (namespace("a")?, namespace("b")?, namespace("")?);
    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().set_namespace(b.clone())?;
    tx.as_transaction_mut().set_namespace(empty)?;
    WritableNamespaceRegistry::set_namespace(&mut tx, a.clone())?;
    assert_eq!(prefixes(&tx)?, vec!["", "a", "b"]);
    assert_eq!(
        WritableNamespaceRegistry::namespace(&tx, a.prefix())?,
        Some(a.clone())
    );
    assert!(store.namespace(a.prefix())?.is_none());
    assert_eq!(store.namespaces().count(), 0);
    WritableNamespaceRegistry::remove_namespace(&mut tx, a.prefix())?;
    assert_eq!(prefixes(&tx)?, vec!["", "b"]);
    tx.commit()?;
    assert_eq!(store.namespace(b.prefix())?, Some(b.clone()));
    assert!(store.namespace(a.prefix())?.is_none());

    let mut tx = store.start_owned_transaction()?;
    WritableNamespaceRegistry::clear_namespaces(&mut tx)?;
    assert!(prefixes(&tx)?.is_empty());
    assert_eq!(store.namespace(b.prefix())?, Some(b.clone()));
    tx.rollback()?;
    assert_eq!(store.namespace(b.prefix())?, Some(b));
    Ok(())
}

fn isolation(store: Store) -> TestResult {
    store.insert(quad("committed"))?;
    let staged = quad("staged");
    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().insert(staged.clone());
    let before = store.iter();
    assert!(!store.contains(&staged)?);
    assert_eq!(store.len()?, 1);
    assert_eq!(tx.as_transaction().len()?, 2);
    tx.commit()?;
    assert_eq!(
        before.collect::<Result<Vec<_>, _>>()?,
        vec![quad("committed")]
    );
    assert!(store.contains(&staged)?);
    assert_eq!(store.len()?, 2);
    Ok(())
}

fn rollback_paths(store: Store) -> TestResult {
    let rolled_back = quad("rolled");
    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().insert(rolled_back.clone());
    tx.rollback()?;
    assert!(!store.contains(&rolled_back)?);

    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().insert(rolled_back.clone());
    drop(tx);
    assert!(!store.contains(&rolled_back)?);

    let metrics = store.transaction_metrics();
    assert_eq!(metrics.count(TransactionObservation::RolledBack), 1);
    assert_eq!(metrics.count(TransactionObservation::Abandoned), 1);
    assert_eq!(metrics.count(TransactionObservation::Committed), 0);

    let kept = quad("kept");
    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().insert(kept.clone());
    tx.commit()?;
    assert!(store.contains(&kept)?);
    assert_eq!(
        store
            .transaction_metrics()
            .count(TransactionObservation::Committed),
        1
    );
    Ok(())
}

fn caller_managed_update_errors(store: Store) -> TestResult {
    let mut tx = store.start_owned_transaction()?;
    let error = SparqlEvaluator::new()
        .parse_update(&format!(
            "INSERT DATA {{ {} <urn:owned:p> <urn:owned:o> }}; \
             CREATE GRAPH <urn:owned:g>; CREATE GRAPH <urn:owned:g>",
            iri("a")
        ))?
        .on_transaction(tx.as_transaction_mut())
        .execute()
        .err()
        .ok_or("duplicate CREATE GRAPH succeeded")?;
    assert!(matches!(
        error,
        UpdateEvaluationError::GraphAlreadyExists(_)
    ));
    assert!(tx.as_transaction().contains(&quad("a"))?);
    assert!(
        tx.as_transaction()
            .contains_named_graph(&NamedOrBlankNode::from(node("g")))?
    );
    tx.rollback()?;
    assert!(store.is_empty()?);
    assert_eq!(store.named_graphs().count(), 0);
    Ok(())
}

fn bounded_admission(store: Store) -> TestResult {
    let mut holder = store.start_owned_transaction()?;
    holder.as_transaction_mut().insert(quad("held"));

    let timed_out = bounded(&store, |store| {
        start_kind(
            &store,
            TransactionRequest::default(),
            TransactionStartControl::new().with_timeout(Duration::from_millis(50)),
        )
    })?;
    assert_eq!(timed_out, Start::TimedOut);

    let control = TransactionStartControl::new();
    let (sender, receiver) = mpsc::channel();
    let waiter_store = store.clone();
    let waiter_control = control.clone();
    let waiter = thread::spawn(move || {
        let _delivered = sender.send(start_kind(
            &waiter_store,
            TransactionRequest::default(),
            waiter_control,
        ));
    });
    let still_queued = receiver.recv_timeout(Duration::from_millis(100));
    control.cancel();
    let cancelled = receiver.recv_timeout(Duration::from_secs(1))?;
    waiter.join().map_err(|_| "cancel waiter panicked")?;
    assert_eq!(still_queued, Err(RecvTimeoutError::Timeout));
    assert_eq!(cancelled, Start::Cancelled);

    drop(holder);
    assert!(store.is_empty()?);
    let started = bounded(&store, |store| {
        start_kind(
            &store,
            TransactionRequest::default(),
            TransactionStartControl::new().with_timeout(BOUND),
        )
    })?;
    assert_eq!(started, Start::Started);
    Ok(())
}

fn capability_rejection_before_admission(store: Store) -> TestResult {
    let holder = store.start_owned_transaction()?;
    let unmet_request = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_conflict_behavior(ConflictBehavior::DetectedAndRejected)
            .requiring_cancellation(CancellationGuarantee::BeforeCommitAttempt),
    );
    let rejected = bounded(&store, move |store| {
        match store
            .start_owned_transaction_with_control(unmet_request, TransactionStartControl::new())
        {
            Err(TransactionStartError::RequirementsNotMet { unmet, effective }) => {
                Some((unmet, effective))
            }
            _ => None,
        }
    })?;
    let (unmet, effective): (Vec<UnmetTransactionRequirement>, TransactionCapabilities) =
        rejected.ok_or("unmet request was not rejected before admission")?;
    assert_eq!(
        unmet,
        vec![
            UnmetTransactionRequirement::ConflictBehavior,
            UnmetTransactionRequirement::Cancellation,
        ]
    );
    assert_eq!(effective, store.transaction_capabilities());
    drop(holder);

    let started = store.start_owned_transaction_with(TransactionRequest::default())?;
    assert_eq!(
        started.effective_capabilities(),
        &store.transaction_capabilities()
    );
    started.into_transaction().rollback()?;
    Ok(())
}

fn cross_thread(store: Store) -> TestResult {
    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().insert(quad("moved"));
    let (sender, receiver) = mpsc::channel();
    let worker = thread::spawn(move || {
        let result = (|| -> Result<Vec<String>, TestError> {
            tx.as_transaction_mut().insert(quad("worker"));
            let values = select_values(&tx, "SELECT ?s WHERE { ?s <urn:owned:p> ?o }", "s")?;
            tx.commit()?;
            Ok(values)
        })();
        let _delivered = sender.send(result);
    });
    let values = receiver.recv_timeout(BOUND)??;
    worker.join().map_err(|_| "owned worker panicked")?;
    assert_eq!(values, vec![iri("moved"), iri("worker")]);
    assert_eq!(store.len()?, 2);
    Ok(())
}

fn negotiated_metrics(store: Store) -> TestResult {
    let committed = quad("negotiated-committed");
    let mut tx = store
        .start_owned_transaction_with(TransactionRequest::default())?
        .into_transaction();
    tx.as_transaction_mut().insert(committed.clone());
    tx.commit()?;

    let rolled_back = quad("negotiated-rolled-back");
    let mut tx = store
        .start_owned_transaction_with_control(
            TransactionRequest::default(),
            TransactionStartControl::new().with_timeout(BOUND),
        )?
        .into_transaction();
    tx.as_transaction_mut().insert(rolled_back.clone());
    tx.rollback()?;
    assert!(store.contains(&committed)?);
    assert!(!store.contains(&rolled_back)?);

    let holder = store
        .start_owned_transaction_with(TransactionRequest::default())?
        .into_transaction();
    let before = store.transaction_metrics();
    let unmet_request = TransactionRequest::new(
        TransactionRequirements::legacy()
            .requiring_conflict_behavior(ConflictBehavior::DetectedAndRejected),
    );
    let failures = bounded(&store, move |store| {
        let cancelled = TransactionStartControl::new();
        cancelled.cancel();
        [
            start_kind(&store, unmet_request, TransactionStartControl::new()),
            start_kind(
                &store,
                TransactionRequest::default(),
                TransactionStartControl::new().with_timeout(Duration::from_millis(50)),
            ),
            start_kind(&store, TransactionRequest::default(), cancelled),
        ]
    })?;
    assert_eq!(
        failures,
        [Start::Requirements, Start::TimedOut, Start::Cancelled]
    );
    assert_eq!(
        store.transaction_metrics(),
        before,
        "failed admission must not record an observation"
    );
    holder.rollback()?;

    let metrics = store.transaction_metrics();
    assert_eq!(metrics.count(TransactionObservation::Committed), 1);
    assert_eq!(metrics.count(TransactionObservation::RolledBack), 2);
    assert_eq!(
        TransactionObservation::ALL
            .into_iter()
            .map(|outcome| metrics.count(outcome))
            .sum::<u64>(),
        3
    );
    Ok(())
}

macro_rules! backends {
    ($($name:ident),* $(,)?) => {
        mod memory {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    super::$name(Store::new()?)
                }
            )*
        }

        #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
        mod rocksdb {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    let directory = tempfile::tempdir()?;
                    super::$name(Store::open(directory.path())?)
                }
            )*
        }
    };
}

backends!(
    owned_outlives_store,
    composes_query_and_update,
    topology,
    staged_quads_and_trait_forwarding,
    namespaces,
    isolation,
    rollback_paths,
    caller_managed_update_errors,
    bounded_admission,
    capability_rejection_before_admission,
    cross_thread,
    negotiated_metrics,
);

#[test]
fn owned_transaction_is_send_sync_and_static() {
    fn check<T: Send + Sync + 'static>() {}
    check::<OwnedTransaction>();
    check::<Store>();
}

fn start_and_roll_back<D: OwnedTransactionalDataset>(dataset: &D) -> TestResult {
    let started = dataset.start_owned_transaction_with(TransactionRequest::default())?;
    started.into_transaction().rollback()?;
    Ok(())
}

#[test]
fn store_implements_the_generic_owned_extension() -> TestResult {
    start_and_roll_back(&Store::new()?)
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_handle_is_released_after_store_and_transaction_drop() -> TestResult {
    let directory = tempfile::tempdir()?;
    let staged = quad("durable");
    let store = Store::open(directory.path())?;
    let mut tx = store.start_owned_transaction()?;
    tx.as_transaction_mut().insert(staged.clone());
    drop(store);
    tx.commit()?;
    let reopened = Store::open(directory.path())?;
    assert!(reopened.contains(&staged)?);
    Ok(())
}

#[derive(Default)]
struct ReplacementBackend {
    dataset: RefCell<Dataset>,
}

/// Where a replacement transaction publishes its staged dataset on commit.
trait ReplacementTarget {
    fn publish(self, staged: Dataset);
}

impl ReplacementTarget for RefMut<'_, Dataset> {
    fn publish(mut self, staged: Dataset) {
        *self = staged;
    }
}

impl ReplacementTarget for Arc<Mutex<Dataset>> {
    fn publish(self, staged: Dataset) {
        *self.lock().unwrap_or_else(PoisonError::into_inner) = staged;
    }
}

struct ReplacementTransaction<T> {
    target: T,
    staged: Dataset,
}

impl TransactionalDataset for ReplacementBackend {
    type Error = Infallible;
    type Transaction<'a> = ReplacementTransaction<RefMut<'a, Dataset>>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        let staged = self.dataset.borrow().clone();
        Ok(ReplacementTransaction {
            target: self.dataset.borrow_mut(),
            staged,
        })
    }
}

impl<T: ReplacementTarget> WritableDataset for ReplacementTransaction<T> {
    type Error = Infallible;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Infallible>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Infallible>> + 'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        let subject = subject.cloned();
        let predicate = predicate.cloned();
        let object = object.cloned();
        let graph_name = graph_name.map(Option::<&NamedOrBlankNode>::cloned);
        Box::new(
            self.staged
                .iter()
                .filter(move |quad| {
                    subject.as_ref().is_none_or(|term| term == &quad.subject)
                        && predicate
                            .as_ref()
                            .is_none_or(|term| term == &quad.predicate)
                        && object.as_ref().is_none_or(|term| term == &quad.object)
                        && match &graph_name {
                            Some(None) => quad.graph_name.is_default_graph(),
                            Some(Some(graph_name)) => {
                                quad.graph_name == GraphName::from(graph_name.clone())
                            }
                            None => !quad.graph_name.is_default_graph(),
                        }
                })
                .map(Ok),
        )
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        Box::new(self.staged.named_graphs().map(Ok))
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        Ok(self.staged.contains_named_graph(graph_name.as_ref()))
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.staged.insert(quad);
        Ok(())
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.staged.remove(quad.as_ref());
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.insert_named_graph(graph_name);
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        let graph_name = graph_name.map_or(GraphName::DefaultGraph, |graph_name| {
            GraphName::from(graph_name.clone())
        });
        self.staged.clear_graph(&graph_name);
        Ok(())
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.clear_graph(&GraphName::from(graph_name));
        }
        Ok(())
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.staged.clear_graph(&GraphName::DefaultGraph);
        self.clear_all_named_graphs()
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.remove_named_graph(graph_name.as_ref());
        Ok(())
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.remove_named_graph(graph_name.as_ref());
        }
        Ok(())
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        self.staged.clear();
        Ok(())
    }

    fn commit(self) -> Result<(), Self::Error> {
        self.target.publish(self.staged);
        Ok(())
    }

    fn rollback(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

fn takes_base<D: TransactionalDataset>(dataset: &D) -> Result<(), Box<dyn Error>> {
    SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:owned:s> <urn:owned:p> <urn:owned:o> }")?
        .on_dataset(dataset)
        .execute()?;
    Ok(())
}

#[test]
fn custom_backend_without_the_owned_extension_is_unchanged() -> Result<(), Box<dyn Error>> {
    let backend = ReplacementBackend::default();
    takes_base(&backend)?;
    assert_eq!(backend.dataset.borrow().len(), 1);
    Ok(())
}

/// A replacement backend whose transactions own their target, so it can opt
/// into the owned extension. Commit replaces the dataset wholesale and is
/// atomic, but concurrent writers are last-writer-wins: writer isolation is
/// deliberately not advertised.
#[derive(Default)]
struct OwnedReplacementBackend {
    dataset: Arc<Mutex<Dataset>>,
}

impl OwnedReplacementBackend {
    fn snapshot(&self) -> Dataset {
        self.dataset
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl TransactionalDataset for OwnedReplacementBackend {
    type Error = Infallible;
    type Transaction<'a> = ReplacementTransaction<Arc<Mutex<Dataset>>>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        Ok(ReplacementTransaction {
            target: Arc::clone(&self.dataset),
            staged: self.snapshot(),
        })
    }
}

impl NegotiatedTransactionalDataset for OwnedReplacementBackend {
    fn transaction_capabilities(&self) -> TransactionCapabilities {
        TransactionCapabilities::none()
            .with_atomic_publication()
            .with_read_your_writes()
            .with_rollback(RollbackGuarantee::ExplicitOrDropBeforeCommit)
    }
}

impl OwnedTransactionalDataset for OwnedReplacementBackend {
    type OwnedTransaction = ReplacementTransaction<Arc<Mutex<Dataset>>>;

    fn start_owned_transaction_with_control(
        &self,
        request: TransactionRequest,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<Self::OwnedTransaction>, TransactionStartError<Self::Error>>
    {
        self.start_transaction_with_control(request, control)
    }
}

#[test]
fn custom_backend_implements_the_owned_extension() -> TestResult {
    let backend = OwnedReplacementBackend::default();
    start_and_roll_back(&backend)?;
    assert!(backend.snapshot().is_empty());

    let serialized = TransactionRequest::new(
        TransactionRequirements::legacy().requiring_writer_isolation(WriterIsolation::Serialized),
    );
    let Err(TransactionStartError::RequirementsNotMet { unmet, .. }) =
        backend.start_owned_transaction_with(serialized)
    else {
        return Err("unmet writer isolation was not rejected".into());
    };
    assert_eq!(unmet, vec![UnmetTransactionRequirement::WriterIsolation]);

    let discarded = quad("discarded");
    let mut tx = backend
        .start_owned_transaction_with(TransactionRequest::default())?
        .into_transaction();
    WritableDataset::insert(&mut tx, discarded)?;
    WritableDataset::rollback(tx)?;
    assert!(backend.snapshot().is_empty());

    let published = quad("published");
    let started = backend.start_owned_transaction_with(TransactionRequest::default())?;
    assert_eq!(
        started.effective_capabilities(),
        &backend.transaction_capabilities()
    );
    let mut tx = started.into_transaction();
    WritableDataset::insert(&mut tx, published.clone())?;
    assert_eq!(
        WritableDataset::quads_for_pattern(&tx, None, None, None, Some(None)).count(),
        1
    );
    assert!(backend.snapshot().is_empty());
    let observer = Arc::clone(&backend.dataset);
    drop(backend);
    WritableDataset::commit(tx)?;
    assert!(
        observer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(published.as_ref())
    );
    Ok(())
}
