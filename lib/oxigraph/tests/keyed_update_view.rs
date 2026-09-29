#![cfg(not(target_family = "wasm"))]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the prepared-update seam contract"
)]

use oxigraph::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{
    CancellationToken, QueryResource, QueryResults, SortBufferBudget, SparqlEvaluator,
    UpdateEvaluationError,
};
use oxigraph::store::{
    GraphNameIter, KeyedTransaction, OutcomeAwareTransactionalDataset, StorageError, Store,
    TransactionKey, TransactionNonCommitReason, TransactionOutcome, TransactionRequest,
    WritableDataset,
};
use std::convert::Infallible;
use std::error::Error;
use std::io::{self, ErrorKind};
use std::net::{Ipv4Addr, TcpListener};

#[cfg(feature = "http-client")]
use egress::{load_denied, service_denied};

type TestError = Box<dyn Error + Send + Sync>;
type TestResult = Result<(), TestError>;

const ROLLED_BACK: TransactionOutcome =
    TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack);

fn n(label: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:ku:{label}"))
}

fn quad(subject: &str, predicate: &str, object: &str) -> Quad {
    Quad::new(n(subject), n(predicate), n(object), GraphName::DefaultGraph)
}

fn key(byte: u8) -> TransactionKey {
    TransactionKey::new([byte; 16])
}

fn open(store: &Store, byte: u8) -> Result<KeyedTransaction<'static>, TestError> {
    Ok(store
        .start_owned_transaction_with_key(TransactionRequest::default(), key(byte))?
        .into_transaction())
}

fn evaluator() -> SparqlEvaluator {
    SparqlEvaluator::new().with_deny_all_egress_policy()
}

fn update<D: WritableDataset>(dataset: &mut D, text: &str) -> Result<(), UpdateEvaluationError> {
    evaluator()
        .parse_update(text)?
        .execute_on_writable_dataset(dataset)
}

fn ask(keyed: &KeyedTransaction<'static>, query: &str) -> Result<bool, TestError> {
    match evaluator()
        .parse_query(query)?
        .on_writable_dataset(keyed)
        .execute()?
    {
        QueryResults::Boolean(value) => Ok(value),
        _ => Err("expected a boolean result".into()),
    }
}

fn insert_generically<D: WritableDataset>(dataset: &mut D) -> Result<(), UpdateEvaluationError> {
    update(dataset, "INSERT DATA { <urn:ku:g> <urn:ku:p> <urn:ku:o> }")
}

/// A nonblocking loopback listener that is never served: an accepted
/// connection proves that a denied request reached the network.
struct Probe {
    listener: TcpListener,
    iri: String,
}

impl Probe {
    fn new() -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let iri = format!("http://{}/data", listener.local_addr()?);
        Ok(Self { listener, iri })
    }

    fn assert_untouched(&self) -> TestResult {
        match self.listener.accept() {
            Err(error) if error.kind() == ErrorKind::WouldBlock => Ok(()),
            Ok(_) => Err("a denied request opened a loopback connection".into()),
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(not(feature = "http-client"))]
fn load_denied(error: &UpdateEvaluationError) -> TestResult {
    // Without `http-client` there is no transport to deny: this shows only
    // that LOAD fails before connecting, it is not a policy proof.
    assert!(
        error.to_string().contains("HTTP client is not available"),
        "{error}"
    );
    Ok(())
}

#[cfg(not(feature = "http-client"))]
fn service_denied(error: &UpdateEvaluationError) -> TestResult {
    // Without `http-client` no built-in SERVICE handler exists at all.
    assert!(
        matches!(error, UpdateEvaluationError::UnsupportedService(_)),
        "{error}"
    );
    Ok(())
}

/// Test-local write probe over a keyed transaction. It cancels the shared
/// token right after its Nth successful write, so the evaluator's next
/// per-mutation check fails in the middle of an operation. No production
/// hook and no timing is involved.
struct CancelAfterWrites {
    inner: KeyedTransaction<'static>,
    token: CancellationToken,
    cancel_after: usize,
    writes: usize,
}

impl CancelAfterWrites {
    fn new(
        inner: KeyedTransaction<'static>,
        token: CancellationToken,
        cancel_after: usize,
    ) -> Self {
        Self {
            inner,
            token,
            cancel_after,
            writes: 0,
        }
    }

    fn wrote(&mut self) {
        self.writes += 1;
        if self.writes == self.cancel_after {
            self.token.cancel();
        }
    }
}

impl WritableDataset for CancelAfterWrites {
    type Error = StorageError;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, StorageError>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = GraphNameIter<'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        WritableDataset::quads_for_pattern(&self.inner, subject, predicate, object, graph_name)
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        WritableDataset::named_graphs(&self.inner)
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        WritableDataset::contains_named_graph(&self.inner, graph_name)
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        WritableDataset::insert(&mut self.inner, quad)?;
        self.wrote();
        Ok(())
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        WritableDataset::remove(&mut self.inner, quad)?;
        self.wrote();
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        WritableDataset::insert_named_graph(&mut self.inner, graph_name)?;
        self.wrote();
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        WritableDataset::clear_graph(&mut self.inner, graph_name)?;
        self.wrote();
        Ok(())
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        WritableDataset::clear_all_named_graphs(&mut self.inner)?;
        self.wrote();
        Ok(())
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        WritableDataset::clear_all_graphs(&mut self.inner)?;
        self.wrote();
        Ok(())
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        WritableDataset::remove_named_graph(&mut self.inner, graph_name)?;
        self.wrote();
        Ok(())
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        WritableDataset::remove_all_named_graphs(&mut self.inner)?;
        self.wrote();
        Ok(())
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        WritableDataset::clear(&mut self.inner)?;
        self.wrote();
        Ok(())
    }

    fn commit(self) -> Result<(), Self::Error> {
        WritableDataset::commit(self.inner)
    }

    fn rollback(self) -> Result<(), Self::Error> {
        WritableDataset::rollback(self.inner)
    }
}

fn insert_delete_where_and_topology(store: Store) -> TestResult {
    let graph = NamedOrBlankNode::from(n("g"));
    let empty = NamedOrBlankNode::from(n("e"));
    let mut keyed = open(&store, 1)?;
    update(
        &mut keyed,
        "INSERT DATA { <urn:ku:a> <urn:ku:p> 1 . GRAPH <urn:ku:g> { <urn:ku:a> <urn:ku:p> 2 } }; \
         CREATE GRAPH <urn:ku:e>",
    )?;
    assert!(ask(&keyed, "ASK { <urn:ku:a> <urn:ku:p> 1 }")?);
    assert!(ask(
        &keyed,
        "ASK { GRAPH <urn:ku:g> { <urn:ku:a> <urn:ku:p> 2 } }"
    )?);
    assert!(keyed.contains_named_graph(&empty)?);
    update(
        &mut keyed,
        "DELETE { ?s <urn:ku:p> ?o } INSERT { ?s <urn:ku:q> ?o } WHERE { ?s <urn:ku:p> ?o }",
    )?;
    assert!(!ask(&keyed, "ASK { <urn:ku:a> <urn:ku:p> 1 }")?);
    assert!(ask(&keyed, "ASK { <urn:ku:a> <urn:ku:q> 1 }")?);
    assert!(ask(
        &keyed,
        "ASK { GRAPH <urn:ku:g> { <urn:ku:a> <urn:ku:p> 2 } }"
    )?);
    update(&mut keyed, "CLEAR GRAPH <urn:ku:g>")?;
    assert!(keyed.contains_named_graph(&graph)?);
    assert!(!ask(
        &keyed,
        "ASK { GRAPH <urn:ku:g> { <urn:ku:a> <urn:ku:p> 2 } }"
    )?);
    update(&mut keyed, "DROP GRAPH <urn:ku:g>; DROP GRAPH <urn:ku:e>")?;
    assert!(!keyed.contains_named_graph(&graph)?);
    assert!(!keyed.contains_named_graph(&empty)?);
    assert!(store.is_empty()?);
    keyed.commit()?;
    assert_eq!(store.len()?, 1);
    assert_eq!(
        store.lookup_transaction_outcome(&key(1))?,
        TransactionOutcome::Committed
    );
    Ok(())
}

fn using_dataset_is_honoured(store: Store) -> TestResult {
    let mut keyed = open(&store, 2)?;
    update(
        &mut keyed,
        "INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:default> . \
         GRAPH <urn:ku:g> { <urn:ku:a> <urn:ku:p> <urn:ku:named> } \
         GRAPH <urn:ku:h> { <urn:ku:a> <urn:ku:p> <urn:ku:other> } }",
    )?;
    update(
        &mut keyed,
        "INSERT { <urn:ku:r> <urn:ku:seen> ?o } USING <urn:ku:g> WHERE { ?s <urn:ku:p> ?o }",
    )?;
    assert!(keyed.contains(&quad("r", "seen", "named"))?);
    assert!(!keyed.contains(&quad("r", "seen", "default"))?);
    assert!(!keyed.contains(&quad("r", "seen", "other"))?);
    update(
        &mut keyed,
        "INSERT { <urn:ku:r> <urn:ku:in> ?g } USING NAMED <urn:ku:h> \
         WHERE { GRAPH ?g { ?s <urn:ku:p> ?o } }",
    )?;
    assert!(keyed.contains(&quad("r", "in", "h"))?);
    assert!(!keyed.contains(&quad("r", "in", "g"))?);
    assert!(store.is_empty()?);
    keyed.rollback()?;
    Ok(())
}

fn sees_own_writes_and_store_stays_isolated(store: Store) -> TestResult {
    let mut keyed = open(&store, 3)?;
    update(
        &mut keyed,
        "INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:b> }",
    )?;
    assert!(ask(&keyed, "ASK { <urn:ku:a> <urn:ku:p> <urn:ku:b> }")?);
    update(
        &mut keyed,
        "INSERT { ?o <urn:ku:back> ?s } WHERE { ?s <urn:ku:p> ?o }",
    )?;
    assert!(ask(&keyed, "ASK { <urn:ku:b> <urn:ku:back> <urn:ku:a> }")?);
    assert!(store.is_empty()?);
    assert!(!store.contains(&quad("a", "p", "b"))?);
    keyed.commit()?;
    assert!(store.contains(&quad("a", "p", "b"))?);
    assert!(store.contains(&quad("b", "back", "a"))?);
    Ok(())
}

fn drop_and_rollback_discard(store: Store) -> TestResult {
    let mut keyed = open(&store, 4)?;
    update(
        &mut keyed,
        "INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:b> }",
    )?;
    drop(keyed);
    assert!(store.is_empty()?);
    assert_eq!(store.lookup_transaction_outcome(&key(4))?, ROLLED_BACK);

    let mut keyed = open(&store, 5)?;
    update(
        &mut keyed,
        "INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:b> }",
    )?;
    keyed.rollback()?;
    assert!(store.is_empty()?);
    assert_eq!(store.lookup_transaction_outcome(&key(5))?, ROLLED_BACK);
    open(&store, 6)?.rollback()?;
    Ok(())
}

fn pre_cancelled_update_mutates_nothing(store: Store) -> TestResult {
    let mut keyed = open(&store, 7)?;
    let token = CancellationToken::new();
    token.cancel();
    let error = evaluator()
        .with_cancellation_token(token)
        .parse_update("INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:b> }")?
        .execute_on_writable_dataset(&mut keyed)
        .err()
        .ok_or("cancelled update succeeded")?;
    assert!(matches!(error, UpdateEvaluationError::Cancelled), "{error}");
    assert_eq!(keyed.len()?, 0);
    update(
        &mut keyed,
        "INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:b> }",
    )?;
    assert_eq!(keyed.len()?, 1);
    keyed.rollback()?;
    Ok(())
}

fn sort_budget_failure_applies_no_mutation(store: Store) -> TestResult {
    let mut keyed = open(&store, 8)?;
    update(
        &mut keyed,
        "INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:b> }",
    )?;
    let error = evaluator()
        .with_sort_buffer_budget(SortBufferBudget::new(0))
        .parse_update(
            "INSERT { ?s <urn:ku:copy> ?o } WHERE { \
             { SELECT ?s ?o WHERE { ?s <urn:ku:p> ?o } ORDER BY ?s LIMIT 10 } }",
        )?
        .execute_on_writable_dataset(&mut keyed)
        .err()
        .ok_or("over-budget update succeeded")?;
    assert!(
        matches!(
            error,
            UpdateEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::SortBufferRows,
                ..
            }
        ),
        "{error}"
    );
    assert!(!ask(&keyed, "ASK { <urn:ku:a> <urn:ku:copy> <urn:ku:b> }")?);
    assert!(ask(&keyed, "ASK { <urn:ku:a> <urn:ku:p> <urn:ku:b> }")?);
    keyed.rollback()?;
    Ok(())
}

fn later_operation_error_keeps_earlier_effects_until_rollback(store: Store) -> TestResult {
    let mut keyed = open(&store, 9)?;
    let error = update(
        &mut keyed,
        "INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:b> }; \
         CREATE GRAPH <urn:ku:g>; CREATE GRAPH <urn:ku:g>",
    )
    .err()
    .ok_or("duplicate CREATE GRAPH succeeded")?;
    assert!(
        matches!(error, UpdateEvaluationError::GraphAlreadyExists(_)),
        "{error}"
    );
    assert!(keyed.contains(&quad("a", "p", "b"))?);
    assert!(keyed.contains_named_graph(&NamedOrBlankNode::from(n("g")))?);
    assert!(store.is_empty()?);
    keyed.rollback()?;
    assert!(store.is_empty()?);
    assert_eq!(store.named_graphs().count(), 0);
    assert_eq!(store.lookup_transaction_outcome(&key(9))?, ROLLED_BACK);
    Ok(())
}

fn cancelled_writes_leave_a_prefix_of_the_failing_operation(store: Store) -> TestResult {
    let token = CancellationToken::new();
    let mut staged = CancelAfterWrites::new(open(&store, 12)?, token.clone(), 2);
    let error = evaluator()
        .with_cancellation_token(token)
        .parse_update(
            "INSERT DATA { <urn:ku:e> <urn:ku:p> <urn:ku:o> }; \
             INSERT DATA { <urn:ku:a> <urn:ku:p> <urn:ku:o> . \
             <urn:ku:b> <urn:ku:p> <urn:ku:o> . <urn:ku:c> <urn:ku:p> <urn:ku:o> }",
        )?
        .execute_on_writable_dataset(&mut staged)
        .err()
        .ok_or("an update cancelled during its writes succeeded")?;
    assert!(matches!(error, UpdateEvaluationError::Cancelled), "{error}");
    assert_eq!(staged.writes, 2);
    let keyed = staged.inner;
    assert!(keyed.contains(&quad("e", "p", "o"))?, "earlier operation");
    assert!(keyed.contains(&quad("a", "p", "o"))?, "failing prefix");
    assert!(!keyed.contains(&quad("b", "p", "o"))?);
    assert!(!keyed.contains(&quad("c", "p", "o"))?);
    assert_eq!(keyed.len()?, 2);
    assert!(store.is_empty()?);
    keyed.rollback()?;
    assert!(store.is_empty()?);
    assert_eq!(store.lookup_transaction_outcome(&key(12))?, ROLLED_BACK);
    Ok(())
}

fn cancelled_writes_can_half_apply_one_delete_insert(store: Store) -> TestResult {
    let token = CancellationToken::new();
    let mut keyed = open(&store, 13)?;
    keyed.insert(quad("a", "p", "o"));
    let mut staged = CancelAfterWrites::new(keyed, token.clone(), 1);
    let error = evaluator()
        .with_cancellation_token(token)
        .parse_update(
            "DELETE { ?s <urn:ku:p> ?o } INSERT { ?s <urn:ku:q> ?o } WHERE { ?s <urn:ku:p> ?o }",
        )?
        .execute_on_writable_dataset(&mut staged)
        .err()
        .ok_or("an update cancelled during its writes succeeded")?;
    assert!(matches!(error, UpdateEvaluationError::Cancelled), "{error}");
    assert_eq!(staged.writes, 1);
    let keyed = staged.inner;
    // Before the update neither flag holds and after it both would: exactly
    // one staged mutation is a half-applied operation in either apply order.
    let deleted = !keyed.contains(&quad("a", "p", "o"))?;
    let inserted = keyed.contains(&quad("a", "q", "o"))?;
    assert_ne!(
        deleted, inserted,
        "exactly one mutation of the operation must remain staged"
    );
    assert!(store.is_empty()?);
    keyed.rollback()?;
    assert!(store.is_empty()?);
    assert_eq!(store.lookup_transaction_outcome(&key(13))?, ROLLED_BACK);
    Ok(())
}

fn load_is_denied_without_network(store: Store) -> TestResult {
    let probe = Probe::new()?;
    let mut keyed = open(&store, 10)?;
    keyed.insert(quad("kept", "p", "o"));
    let error = update(&mut keyed, &format!("LOAD <{}>", probe.iri))
        .err()
        .ok_or("a policy-denied LOAD succeeded")?;
    load_denied(&error)?;
    probe.assert_untouched()?;
    assert_eq!(keyed.len()?, 1);
    assert!(keyed.contains(&quad("kept", "p", "o"))?);
    assert!(store.is_empty()?);
    keyed.rollback()?;
    Ok(())
}

fn service_in_update_where_is_denied_without_network(store: Store) -> TestResult {
    let probe = Probe::new()?;
    let mut keyed = open(&store, 14)?;
    keyed.insert(quad("kept", "p", "o"));
    let text = format!(
        "DELETE {{ ?s ?p ?o }} INSERT {{ ?s <urn:ku:copy> ?o }} \
         WHERE {{ SERVICE <{}> {{ ?s ?p ?o }} }}",
        probe.iri
    );
    let error = update(&mut keyed, &text)
        .err()
        .ok_or("a policy-denied SERVICE succeeded")?;
    service_denied(&error)?;
    probe.assert_untouched()?;
    assert_eq!(keyed.len()?, 1);
    assert!(keyed.contains(&quad("kept", "p", "o"))?);
    assert!(!keyed.contains(&quad("kept", "copy", "o"))?);
    assert!(store.is_empty()?);
    keyed.rollback()?;
    Ok(())
}

fn owned_transaction_uses_the_generic_seam(store: Store) -> TestResult {
    let mut owned = store.start_owned_transaction()?;
    insert_generically(&mut owned)?;
    assert!(owned.as_transaction().contains(&quad("g", "p", "o"))?);
    assert!(store.is_empty()?);
    owned.commit()?;
    assert!(store.contains(&quad("g", "p", "o"))?);

    let mut keyed = open(&store, 11)?;
    insert_generically(&mut keyed)?;
    assert!(keyed.contains(&quad("g", "p", "o"))?);
    keyed.rollback()?;
    Ok(())
}

macro_rules! backends {
    ($memory:ident, $disk:ident; $($name:ident),* $(,)?) => {
        mod $memory {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    super::$name(Store::new()?)
                }
            )*
        }

        #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
        mod $disk {
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
    memory,
    disk;
    insert_delete_where_and_topology,
    using_dataset_is_honoured,
    sees_own_writes_and_store_stays_isolated,
    drop_and_rollback_discard,
    pre_cancelled_update_mutates_nothing,
    sort_budget_failure_applies_no_mutation,
    later_operation_error_keeps_earlier_effects_until_rollback,
    cancelled_writes_leave_a_prefix_of_the_failing_operation,
    cancelled_writes_can_half_apply_one_delete_insert,
    load_is_denied_without_network,
    service_in_update_where_is_denied_without_network,
    owned_transaction_uses_the_generic_seam,
);

/// Typed egress assertions and a bounded loopback allow-policy control.
#[cfg(feature = "http-client")]
mod egress {
    use super::*;
    use oxigraph::sparql::{EgressError, EgressErrorKind, EgressPolicy, EgressPurpose};
    use std::io::{Read, Write};
    use std::net::{IpAddr, Shutdown, SocketAddr, TcpStream};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    const LOADED: &[u8] = b"<urn:ku:loaded> <urn:ku:p> <urn:ku:o> .\n";
    const IO_BOUND: Duration = Duration::from_secs(2);

    /// Walks the whole source chain to the typed egress error.
    fn policy_denied(error: &(dyn Error + 'static), purpose: EgressPurpose) -> TestResult {
        let mut link = Some(error);
        while let Some(current) = link {
            if let Some(egress) = current.downcast_ref::<EgressError>() {
                assert_eq!(egress.kind(), EgressErrorKind::PolicyDenied);
                assert_eq!(egress.purpose(), purpose);
                return Ok(());
            }
            link = current.source();
        }
        Err(format!("no typed egress error behind: {error}").into())
    }

    pub(super) fn load_denied(error: &UpdateEvaluationError) -> TestResult {
        assert!(matches!(error, UpdateEvaluationError::Service(_)));
        policy_denied(error, EgressPurpose::Load)
    }

    pub(super) fn service_denied(error: &UpdateEvaluationError) -> TestResult {
        policy_denied(error, EgressPurpose::Service)
    }

    /// One loopback HTTP response. If no client arrived, the blocked accept
    /// is woken by a local connection, so joining the thread is bounded.
    struct OneShotServer {
        address: SocketAddr,
        accepted: Arc<AtomicBool>,
        handle: Option<JoinHandle<io::Result<bool>>>,
    }

    impl OneShotServer {
        fn spawn(body: &'static [u8]) -> io::Result<Self> {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
            let address = listener.local_addr()?;
            let accepted = Arc::new(AtomicBool::new(false));
            let flag = Arc::clone(&accepted);
            let handle = thread::spawn(move || serve_one(&listener, &flag, body));
            Ok(Self {
                address,
                accepted,
                handle: Some(handle),
            })
        }

        fn origin(&self) -> String {
            format!("http://{}", self.address)
        }

        fn iri(&self) -> String {
            format!("http://{}/data.nt", self.address)
        }

        /// Returns whether a real GET request was answered.
        fn finish(&mut self) -> io::Result<bool> {
            let Some(handle) = self.handle.take() else {
                return Ok(false);
            };
            if !self.accepted.load(Ordering::SeqCst)
                && let Ok(wake) = TcpStream::connect_timeout(&self.address, IO_BOUND)
            {
                drop(wake);
            }
            handle
                .join()
                .map_err(|_| io::Error::other("loopback server panicked"))?
        }
    }

    impl Drop for OneShotServer {
        fn drop(&mut self) {
            drop(self.finish());
        }
    }

    fn serve_one(listener: &TcpListener, accepted: &AtomicBool, body: &[u8]) -> io::Result<bool> {
        let (mut stream, _) = listener.accept()?;
        accepted.store(true, Ordering::SeqCst);
        stream.set_read_timeout(Some(IO_BOUND))?;
        stream.set_write_timeout(Some(IO_BOUND))?;
        let mut request = Vec::new();
        let mut buffer = [0; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut buffer)?;
            if read == 0 {
                return Ok(false);
            }
            request.extend_from_slice(&buffer[..read]);
        }
        if !request.starts_with(b"GET ") {
            return Ok(false);
        }
        let head = format!(
            "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/n-triples\r\n\
             Content-Length: {}\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes())?;
        stream.write_all(body)?;
        drop(stream.shutdown(Shutdown::Write));
        Ok(true)
    }

    fn load_is_allowed_by_an_explicit_loopback_policy(store: Store) -> TestResult {
        let mut server = OneShotServer::spawn(LOADED)?;
        let policy = EgressPolicy::deny_all()
            .allow_origin(&server.origin())?
            .allow_ip(IpAddr::V4(Ipv4Addr::LOCALHOST))
            .with_timeout(IO_BOUND);
        let mut keyed = open(&store, 15)?;
        SparqlEvaluator::new()
            .with_egress_policy(policy)
            .parse_update(&format!("LOAD <{}>", server.iri()))?
            .execute_on_writable_dataset(&mut keyed)?;
        assert!(server.finish()?, "allowed LOAD never connected");
        assert!(keyed.contains(&quad("loaded", "p", "o"))?);
        assert!(store.is_empty()?);
        keyed.rollback()?;
        assert!(store.is_empty()?);
        Ok(())
    }

    backends!(
        memory,
        disk;
        load_is_allowed_by_an_explicit_loopback_policy,
    );
}

/// A test-local replacement backend: only the public trait, no Store internals.
#[derive(Default)]
struct Replacement {
    staged: Dataset,
}

impl WritableDataset for Replacement {
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
        Ok(())
    }

    fn rollback(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

#[test]
fn replacement_backend_runs_prepared_updates_through_the_public_seam() -> TestResult {
    let mut backend = Replacement::default();
    insert_generically(&mut backend)?;
    update(
        &mut backend,
        "CREATE GRAPH <urn:ku:e>; INSERT { ?s <urn:ku:q> ?o } WHERE { ?s <urn:ku:p> ?o }",
    )?;
    assert!(backend.staged.contains(quad("g", "q", "o").as_ref()));
    assert!(backend.staged.contains_named_graph(n("e").as_ref()));
    let error = update(&mut backend, "CREATE GRAPH <urn:ku:e>")
        .err()
        .ok_or("duplicate CREATE GRAPH succeeded")?;
    assert!(matches!(
        error,
        UpdateEvaluationError::GraphAlreadyExists(_)
    ));
    assert!(backend.staged.contains(quad("g", "p", "o").as_ref()));
    Ok(())
}
