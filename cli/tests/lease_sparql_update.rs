//! Public-API tests for prepared SPARQL updates over a leased staged
//! transaction, on real memory and disk stores. No sleeps; time is injected.
//! Network probes bind 127.0.0.1 only, and every loopback server thread is
//! joined after a bounded wake-up.

use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::sparql::{
    CancellationToken, PreparedSparqlUpdate, QueryResource, QueryResults, SortBufferBudget,
    SparqlEvaluator, UpdateEvaluationError,
};
use oxigraph::store::{
    OwnedTransactionalDataset, Store, TransactionRequest, TransactionStartControl,
};
use oxigraph_cli::lease::registry::{ActiveOperation, Registry, RegistryError, RegistryLimits};
use oxigraph_cli::lease::{
    CommitKey, LeaseBinding, LeaseError, LeaseId, LeaseLimits, LeasePhase, LimitsSpec, LogicalTime,
    Outcome, RollbackReason,
};
use std::error::Error;
use std::io::{self, ErrorKind};
use std::net::{Ipv4Addr, TcpListener};
use std::time::Duration;

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
use egress::{load_denied, service_denied};

type TestError = Box<dyn Error + Send + Sync>;
type TestResult = Result<(), TestError>;

const TIMEOUT: Duration = Duration::from_secs(1);
const PROBE: Duration = Duration::from_millis(50);
const COPY: &str = "INSERT { ?s <urn:lu:copy> ?o } WHERE { \
                    { SELECT ?s ?o WHERE { ?s <urn:lu:p> ?o } ORDER BY ?s LIMIT 10 } }";

#[derive(Debug, PartialEq)]
enum Refusal {
    Unknown,
    Finished,
    Lease(LeaseError),
    Other,
}

fn refusal<T>(result: Result<T, RegistryError>) -> Option<Refusal> {
    Some(match result.err()? {
        RegistryError::Unknown => Refusal::Unknown,
        RegistryError::Finished => Refusal::Finished,
        RegistryError::Lease(error) => Refusal::Lease(error),
        _ => Refusal::Other,
    })
}

fn update_error<T>(result: Result<T, RegistryError>) -> Option<UpdateEvaluationError> {
    match result {
        Err(RegistryError::Update(error)) => Some(error),
        _ => None,
    }
}

fn t(time: u64) -> LogicalTime {
    LogicalTime(time)
}

fn ck(byte: u8) -> CommitKey {
    CommitKey::new([byte; 16])
}

fn n(label: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:lu:{label}"))
}

fn quad(subject: &str, predicate: &str, object: &str) -> Quad {
    Quad::new(n(subject), n(predicate), n(object), GraphName::DefaultGraph)
}

fn owner() -> LeaseBinding {
    LeaseBinding::new("alice", "acme", "repo-1").expect("valid binding")
}

fn registry() -> Registry {
    let spec = LimitsSpec {
        idle: 10,
        absolute: 100,
        max_extension: 20,
        cancel_grace: 5,
        commit_wait: 7,
        retention: 50,
    };
    Registry::new(RegistryLimits {
        lease: LeaseLimits::new(spec).expect("valid lease limits"),
        max_entries: 16,
        max_global: 8,
        max_per_repository: 8,
        max_per_principal: 8,
        max_operations_per_lease: 100,
        max_start_timeout: TIMEOUT,
        max_maintenance_work: 64,
    })
    .expect("valid registry limits")
}

fn open(registry: &Registry, store: &Store, byte: u8) -> Result<LeaseId, RegistryError> {
    registry.begin(store, &owner(), ck(byte), t(0), TIMEOUT)
}

fn commit(registry: &Registry, id: LeaseId, time: u64) -> TestResult {
    let pending = registry.prepare_commit(&owner(), id, t(time))?;
    let report = pending.execute(t(time))?;
    assert!(report.recorded);
    assert_eq!(report.outcome, Outcome::Committed);
    Ok(())
}

fn writer_free(store: &Store) -> bool {
    let probe = TransactionStartControl::new().with_timeout(PROBE);
    let request = TransactionRequest::default();
    match store.start_owned_transaction_with_control(request, probe) {
        Ok(started) => started.into_transaction().rollback().is_ok(),
        Err(_) => false,
    }
}

fn evaluator() -> SparqlEvaluator {
    SparqlEvaluator::new().with_deny_all_egress_policy()
}

fn prepared(text: &str) -> PreparedSparqlUpdate {
    evaluator().parse_update(text).expect("valid update")
}

fn ask(operation: &ActiveOperation<'_>, query: &str) -> Result<bool, TestError> {
    match operation.query(evaluator().parse_query(query)?)? {
        QueryResults::Boolean(value) => Ok(value),
        _ => Err("expected a boolean result".into()),
    }
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

/// Without a compiled HTTP client there is nothing to deny: this checks only
/// that the failure is a typed update error, never a policy decision.
#[cfg(not(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
)))]
fn load_denied(error: &RegistryError) -> TestResult {
    typed_update_failure(error)
}

#[cfg(not(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
)))]
fn service_denied(error: &RegistryError) -> TestResult {
    typed_update_failure(error)
}

#[cfg(not(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
)))]
fn typed_update_failure(error: &RegistryError) -> TestResult {
    match error {
        RegistryError::Update(_) => Ok(()),
        other => Err(format!("expected a typed update error, got {other}").into()),
    }
}

fn updates_queries_and_topology_compose_in_one_lease(store: &Store) -> TestResult {
    let registry = registry();
    let graph = NamedOrBlankNode::from(n("g"));
    let empty = NamedOrBlankNode::from(n("e"));
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner(), id, t(1))?;
    operation.update(prepared(
        "INSERT DATA { <urn:lu:a> <urn:lu:p> 1 . GRAPH <urn:lu:g> { <urn:lu:a> <urn:lu:p> 2 } }; \
         CREATE GRAPH <urn:lu:e>",
    ))?;
    assert!(ask(&operation, "ASK { <urn:lu:a> <urn:lu:p> 1 }")?);
    assert!(operation.contains_named_graph(&empty)?);
    operation.update(prepared(
        "DELETE { ?s <urn:lu:p> ?o } INSERT { ?s <urn:lu:q> ?o } WHERE { ?s <urn:lu:p> ?o }",
    ))?;
    assert!(!ask(&operation, "ASK { <urn:lu:a> <urn:lu:p> 1 }")?);
    assert!(ask(&operation, "ASK { <urn:lu:a> <urn:lu:q> 1 }")?);
    operation.update(prepared("CLEAR GRAPH <urn:lu:g>"))?;
    assert!(operation.contains_named_graph(&graph)?);
    assert!(!ask(
        &operation,
        "ASK { GRAPH <urn:lu:g> { <urn:lu:a> <urn:lu:p> 2 } }"
    )?);
    operation.update(prepared("DROP GRAPH <urn:lu:g>"))?;
    assert!(!operation.contains_named_graph(&graph)?);
    assert!(store.is_empty()?);
    assert!(!store.contains_named_graph(&empty)?);
    operation.finish(t(2))?;
    drop(operation);
    commit(&registry, id, 3)?;
    assert!(store.contains(&Quad::new(
        n("a"),
        n("q"),
        oxigraph::model::Literal::from(1),
        GraphName::DefaultGraph,
    ))?);
    assert!(store.contains_named_graph(&empty)?);
    assert!(writer_free(store));
    Ok(())
}

fn using_and_using_named_scope_the_update_dataset(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.update(prepared(
        "INSERT DATA { <urn:lu:a> <urn:lu:p> <urn:lu:default> . \
         GRAPH <urn:lu:g> { <urn:lu:a> <urn:lu:p> <urn:lu:named> } \
         GRAPH <urn:lu:h> { <urn:lu:a> <urn:lu:p> <urn:lu:other> } }",
    ))?;
    operation.update(prepared(
        "INSERT { <urn:lu:r> <urn:lu:seen> ?o } USING <urn:lu:g> WHERE { ?s <urn:lu:p> ?o }",
    ))?;
    assert!(operation.contains(&quad("r", "seen", "named"))?);
    assert!(!operation.contains(&quad("r", "seen", "default"))?);
    assert!(!operation.contains(&quad("r", "seen", "other"))?);
    operation.update(prepared(
        "INSERT { <urn:lu:r> <urn:lu:in> ?g } USING NAMED <urn:lu:h> \
         WHERE { GRAPH ?g { ?s <urn:lu:p> ?o } }",
    ))?;
    assert!(operation.contains(&quad("r", "in", "h"))?);
    assert!(!operation.contains(&quad("r", "in", "g"))?);
    assert!(store.is_empty()?);
    operation.finish(t(2))?;
    drop(operation);
    commit(&registry, id, 3)?;
    assert!(store.contains(&quad("r", "seen", "named"))?);
    assert!(store.contains(&quad("r", "in", "h"))?);
    assert!(!store.contains(&quad("r", "in", "g"))?);
    assert!(writer_free(store));
    Ok(())
}

fn drop_and_explicit_rollback_discard(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.update(prepared("INSERT DATA { <urn:lu:a> <urn:lu:p> <urn:lu:b> }"))?;
    assert_eq!(operation.len()?, 1);
    drop(operation);
    let dropped = Some(Outcome::RolledBack(RollbackReason::Dropped));
    assert_eq!(registry.outcome(&owner, id, t(2))?, dropped);
    assert!(store.is_empty()?);
    assert!(writer_free(store));

    let id = open(&registry, store, 2)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.update(prepared("INSERT DATA { <urn:lu:a> <urn:lu:p> <urn:lu:b> }"))?;
    operation.finish(t(2))?;
    drop(operation);
    let report = registry.rollback(&owner, id, t(3))?;
    assert_eq!(
        report.outcome,
        Outcome::RolledBack(RollbackReason::Explicit)
    );
    assert!(store.is_empty()?);
    assert!(writer_free(store));
    Ok(())
}

fn cancel_and_budget_failures_are_typed_and_leave_the_operation_usable(
    store: &Store,
) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("a", "p", "b"))?;

    let token = CancellationToken::new();
    token.cancel();
    let cancelled = evaluator()
        .with_cancellation_token(token)
        .parse_update("INSERT DATA { <urn:lu:x> <urn:lu:p> <urn:lu:y> }")?;
    let result = operation.update(cancelled);
    let source = result.as_ref().err().and_then(Error::source).is_some();
    let error = update_error(result).ok_or("cancelled update was not typed")?;
    assert!(matches!(error, UpdateEvaluationError::Cancelled), "{error}");
    assert!(source);
    assert!(!operation.contains(&quad("x", "p", "y"))?);

    let limited = evaluator()
        .with_sort_buffer_budget(SortBufferBudget::new(0))
        .parse_update(COPY)?;
    let error = update_error(operation.update(limited)).ok_or("budget failure was not typed")?;
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
    assert!(!operation.contains(&quad("a", "copy", "b"))?);

    assert_eq!(
        registry.status(&owner, id, t(2))?.phase,
        LeasePhase::Operating
    );
    operation.update(prepared(COPY))?;
    assert!(operation.contains(&quad("a", "copy", "b"))?);
    assert!(store.is_empty()?);
    operation.finish(t(3))?;
    drop(operation);
    registry.rollback(&owner, id, t(4))?;
    assert!(writer_free(store));
    Ok(())
}

fn later_operation_error_retains_earlier_effects_until_abort(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    let result = operation.update(prepared(
        "INSERT DATA { <urn:lu:a> <urn:lu:p> <urn:lu:b> }; \
         CREATE GRAPH <urn:lu:g>; CREATE GRAPH <urn:lu:g>",
    ));
    let error = update_error(result).ok_or("duplicate CREATE GRAPH was not typed")?;
    assert!(
        matches!(error, UpdateEvaluationError::GraphAlreadyExists(_)),
        "{error}"
    );
    assert!(operation.contains(&quad("a", "p", "b"))?);
    assert!(operation.contains_named_graph(&NamedOrBlankNode::from(n("g")))?);
    assert_eq!(
        registry.status(&owner, id, t(2))?.phase,
        LeasePhase::Operating
    );
    assert!(store.is_empty()?);
    operation.finish(t(3))?;
    drop(operation);
    registry.rollback(&owner, id, t(4))?;
    assert!(store.is_empty()?);
    assert_eq!(store.named_graphs().count(), 0);
    assert!(writer_free(store));
    Ok(())
}

fn load_is_denied_without_network(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let probe = Probe::new()?;
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("kept", "p", "o"))?;
    let load = prepared(&format!("LOAD <{}>", probe.iri));
    let error = operation
        .update(load)
        .err()
        .ok_or("a policy-denied LOAD succeeded")?;
    load_denied(&error)?;
    probe.assert_untouched()?;
    assert_eq!(
        registry.status(&owner, id, t(2))?.phase,
        LeasePhase::Operating
    );
    assert_eq!(operation.len()?, 1);
    assert!(operation.contains(&quad("kept", "p", "o"))?);
    operation.finish(t(3))?;
    drop(operation);
    registry.rollback(&owner, id, t(4))?;
    assert!(store.is_empty()?);
    assert!(writer_free(store));
    Ok(())
}

fn service_in_update_where_is_denied_without_network(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let probe = Probe::new()?;
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("kept", "p", "o"))?;
    let text = format!(
        "DELETE {{ ?s ?p ?o }} INSERT {{ ?s <urn:lu:copy> ?o }} \
         WHERE {{ SERVICE <{}> {{ ?s ?p ?o }} }}",
        probe.iri
    );
    let error = operation
        .update(prepared(&text))
        .err()
        .ok_or("a policy-denied SERVICE succeeded")?;
    service_denied(&error)?;
    probe.assert_untouched()?;
    assert_eq!(
        registry.status(&owner, id, t(2))?.phase,
        LeasePhase::Operating
    );
    assert_eq!(operation.len()?, 1);
    assert!(operation.contains(&quad("kept", "p", "o"))?);
    assert!(!operation.contains(&quad("kept", "copy", "o"))?);
    operation.finish(t(3))?;
    drop(operation);
    registry.rollback(&owner, id, t(4))?;
    assert!(store.is_empty()?);
    assert!(writer_free(store));
    Ok(())
}

fn wrong_binding_busy_and_finished_are_refused(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let stranger = LeaseBinding::new("mallory", "acme", "repo-1")?;
    let refused = refusal(registry.begin_operation(&stranger, id, t(1)));
    assert_eq!(refused, Some(Refusal::Unknown));

    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    let busy = refusal(registry.begin_operation(&owner, id, t(2)));
    assert_eq!(busy, Some(Refusal::Lease(LeaseError::Busy)));
    operation.update(prepared("INSERT DATA { <urn:lu:a> <urn:lu:p> <urn:lu:b> }"))?;
    operation.finish(t(3))?;
    let finished = refusal(operation.update(prepared("CREATE GRAPH <urn:lu:g>")));
    assert_eq!(finished, Some(Refusal::Finished));
    drop(operation);
    let rolled_back = registry.rollback(&owner, id, t(4))?;
    assert_eq!(
        rolled_back.outcome,
        Outcome::RolledBack(RollbackReason::Explicit)
    );
    assert!(writer_free(store));
    assert!(store.is_empty()?);
    Ok(())
}

macro_rules! backends {
    ($memory:ident, $disk:ident; $($name:ident),* $(,)?) => {
        mod $memory {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    super::$name(&Store::new()?)
                }
            )*
        }

        mod $disk {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    let directory = tempfile::tempdir()?;
                    let store = Store::open(directory.path())?;
                    super::$name(&store)
                }
            )*
        }
    };
}

backends!(
    memory,
    disk;
    updates_queries_and_topology_compose_in_one_lease,
    using_and_using_named_scope_the_update_dataset,
    drop_and_explicit_rollback_discard,
    cancel_and_budget_failures_are_typed_and_leave_the_operation_usable,
    later_operation_error_retains_earlier_effects_until_abort,
    load_is_denied_without_network,
    service_in_update_where_is_denied_without_network,
    wrong_binding_busy_and_finished_are_refused,
);

/// Typed egress assertions and a bounded loopback allow-policy control. The
/// CLI TLS features are the ones that enable Oxigraph's `http-client`.
#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
mod egress {
    use super::*;
    use oxigraph::sparql::{EgressError, EgressErrorKind, EgressPolicy, EgressPurpose};
    use std::io::{Read, Write};
    use std::net::{IpAddr, Shutdown, SocketAddr, TcpStream};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread::{self, JoinHandle};

    const LOADED: &[u8] = b"<urn:lu:loaded> <urn:lu:p> <urn:lu:o> .\n";
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

    pub(super) fn load_denied(error: &RegistryError) -> TestResult {
        let RegistryError::Update(update) = error else {
            return Err(format!("expected a typed update error, got {error}").into());
        };
        assert!(matches!(update, UpdateEvaluationError::Service(_)));
        policy_denied(error, EgressPurpose::Load)
    }

    pub(super) fn service_denied(error: &RegistryError) -> TestResult {
        let RegistryError::Update(_) = error else {
            return Err(format!("expected a typed update error, got {error}").into());
        };
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

    fn load_is_allowed_by_an_explicit_loopback_policy(store: &Store) -> TestResult {
        let mut server = OneShotServer::spawn(LOADED)?;
        let policy = EgressPolicy::deny_all()
            .allow_origin(&server.origin())?
            .allow_ip(IpAddr::V4(Ipv4Addr::LOCALHOST))
            .with_timeout(IO_BOUND);
        let load = SparqlEvaluator::new()
            .with_egress_policy(policy)
            .parse_update(&format!("LOAD <{}>", server.iri()))?;
        let registry = registry();
        let owner = owner();
        let id = open(&registry, store, 1)?;
        let mut operation = registry.begin_operation(&owner, id, t(1))?;
        operation.update(load)?;
        assert!(server.finish()?, "allowed LOAD never connected");
        assert!(operation.contains(&quad("loaded", "p", "o"))?);
        assert_eq!(
            registry.status(&owner, id, t(2))?.phase,
            LeasePhase::Operating
        );
        assert!(store.is_empty()?);
        operation.finish(t(3))?;
        drop(operation);
        registry.rollback(&owner, id, t(4))?;
        assert!(store.is_empty()?);
        assert!(writer_free(store));
        Ok(())
    }

    backends!(
        memory,
        disk;
        load_is_allowed_by_an_explicit_loopback_policy,
    );
}
