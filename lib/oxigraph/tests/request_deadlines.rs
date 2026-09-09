//! Additive native request-deadline regressions; not frozen qualification evidence.
#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "public timeout behavior fixtures"
)]
use oxigraph::model::{Literal, NamedNode, Term};
use oxigraph::sparql::{
    CancellationToken, QueryEvaluationError, SparqlEvaluator, UpdateEvaluationError,
};
use oxigraph::store::{
    NegotiatedTransactionalDataset, Store, TransactionRequest, TransactionStartControl,
    TransactionStartError,
};
use std::error::Error;
use std::time::{Duration, Instant};

#[test]
fn service_silent_cannot_hide_expiry_in_custom_handler_or_lazy_end() -> Result<(), Box<dyn Error>> {
    use oxigraph::sparql::{QuerySolutionIter, ServiceHandler};
    struct SlowService {
        deadline: Instant,
        lazy: bool,
    }
    impl ServiceHandler for SlowService {
        type Error = std::io::Error;
        fn handle(
            &self,
            _: &spargebra::algebra::QueryExpression,
            _: Option<&oxiri::Iri<oxigraph::model::OxString>>,
        ) -> Result<QuerySolutionIter<'static>, Self::Error> {
            let deadline = self.deadline;
            if self.lazy {
                Ok(QuerySolutionIter::new(
                    std::sync::Arc::from([]),
                    std::iter::from_fn(move || {
                        std::thread::sleep(
                            deadline.saturating_duration_since(Instant::now())
                                + Duration::from_millis(5),
                        );
                        None
                    }),
                ))
            } else {
                std::thread::sleep(
                    deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(5),
                );
                Err(std::io::Error::other("ordinary remote failure"))
            }
        }
    }
    let store = Store::new()?;
    for lazy in [false, true] {
        let deadline = Instant::now() + Duration::from_millis(100);
        let result = SparqlEvaluator::new()
            .with_cancellation_token(CancellationToken::new().with_deadline(deadline))
            .with_service_handler(NamedNode::new("urn:slow")?, SlowService { deadline, lazy })
            .parse_query("ASK { SERVICE SILENT <urn:slow> {} }")?
            .on_store(&store)
            .execute();
        assert!(
            matches!(result, Err(QueryEvaluationError::TimedOut)),
            "SERVICE SILENT hid request expiry"
        );
    }
    Ok(())
}

#[cfg(feature = "http-client")]
#[test]
fn load_silent_remote_timeout_is_silenced_but_request_deadline_rolls_back()
-> Result<(), Box<dyn Error>> {
    use oxigraph::sparql::EgressPolicy;
    use std::io::{Read, Write};
    use std::net::{IpAddr, Ipv4Addr, TcpListener};
    for request_deadline in [false, true] {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let origin = format!("http://{}", listener.local_addr()?);
        let store = Store::new()?;
        let deadline = Instant::now() + Duration::from_millis(300);
        let worker = std::thread::spawn(move || -> std::io::Result<()> {
            listener.set_nonblocking(true)?;
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(connection) => break connection,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        std::thread::yield_now()
                    }
                    Err(error) => return Err(error),
                }
            };
            stream.set_read_timeout(Some(Duration::from_secs(2)))?;
            let mut byte = [0];
            let mut head = Vec::new();
            while !head.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte)?;
                head.push(byte[0]);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: application/n-triples\r\ncontent-length: 1000\r\nconnection: close\r\n\r\n<urn:r> <urn:p> <urn:o> .\n")?;
            std::thread::sleep(
                deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(50),
            );
            Ok(())
        });
        let policy = EgressPolicy::deny_all()
            .allow_origin(&origin)?
            .allow_ip(IpAddr::V4(Ipv4Addr::LOCALHOST))
            .with_timeout(if request_deadline {
                Duration::from_secs(2)
            } else {
                Duration::from_millis(30)
            });
        let mut evaluator = SparqlEvaluator::new().with_egress_policy(policy);
        if request_deadline {
            evaluator =
                evaluator.with_cancellation_token(CancellationToken::new().with_deadline(deadline));
        }
        let result = evaluator.parse_update(&format!("CREATE GRAPH <urn:empty>; INSERT DATA {{ <urn:s> <urn:p> <urn:o> }}; LOAD SILENT <{origin}/data>"))?
            .on_store(&store).execute();
        worker.join().unwrap()?;
        if request_deadline {
            assert!(
                matches!(result, Err(UpdateEvaluationError::TimedOut)),
                "{result:?}"
            );
            assert!(
                store.is_empty()?
                    && !store.contains_named_graph(&NamedNode::new("urn:empty")?.into())?
            );
        } else {
            result?;
            assert_eq!(store.len()?, 1);
            assert!(store.contains_named_graph(&NamedNode::new("urn:empty")?.into())?);
        }
    }
    Ok(())
}

#[test]
fn expired_deadlines_are_typed_before_query_update_or_writer_admission()
-> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let token = CancellationToken::new().with_deadline(Instant::now());
    assert!(matches!(
        SparqlEvaluator::new()
            .with_cancellation_token(token.clone())
            .parse_query("ASK {}")?
            .on_store(&store)
            .execute(),
        Err(QueryEvaluationError::TimedOut)
    ));
    assert!(matches!(
        SparqlEvaluator::new()
            .with_cancellation_token(token.clone())
            .parse_update("CREATE GRAPH <urn:empty>")?
            .on_store(&store)
            .execute(),
        Err(UpdateEvaluationError::TimedOut)
    ));
    assert!(matches!(
        store.start_transaction_with_control(
            TransactionRequest::default(),
            TransactionStartControl::new().with_cancellation_token(token)
        ),
        Err(TransactionStartError::TimedOut)
    ));
    assert!(!store.contains_named_graph(&NamedNode::new("urn:empty")?.into())?);
    Ok(())
}

#[test]
fn deadline_after_execute_is_fatal_on_select_and_construct_iteration() -> Result<(), Box<dyn Error>>
{
    use oxigraph::sparql::QueryResults;
    let store = Store::new()?;
    for query in [
        "SELECT ?x WHERE { VALUES ?x { 1 } }",
        "CONSTRUCT { <urn:s> <urn:p> <urn:o> } WHERE {}",
    ] {
        let deadline = Instant::now() + Duration::from_millis(100);
        let result = SparqlEvaluator::new()
            .with_cancellation_token(CancellationToken::new().with_deadline(deadline))
            .parse_query(query)?
            .on_store(&store)
            .execute()?;
        std::thread::sleep(deadline.saturating_duration_since(Instant::now()));
        let error = match result {
            QueryResults::Solutions(mut iter) => {
                iter.next().ok_or("missing deadline failure")?.err()
            }
            QueryResults::Graph(mut iter) => iter.next().ok_or("missing deadline failure")?.err(),
            QueryResults::Boolean(_) => return Err("unexpected boolean".into()),
        };
        assert!(matches!(error, Some(QueryEvaluationError::TimedOut)));
    }
    Ok(())
}

#[test]
fn deadline_during_owned_update_rolls_back_prior_data_and_empty_graphs()
-> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let deadline = Instant::now() + Duration::from_millis(500);
    let called = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let observed = std::sync::Arc::clone(&called);
    let result = SparqlEvaluator::new()
        .with_cancellation_token(CancellationToken::new().with_deadline(deadline))
        .with_custom_function(NamedNode::new("urn:pause")?, move |_| {
            observed.store(true, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(5));
            Some(Term::Literal(Literal::from(true)))
        })
        .parse_update("CREATE GRAPH <urn:empty>; INSERT DATA { <urn:s> <urn:p> <urn:o> }; INSERT { <urn:new> <urn:p> ?o } WHERE { BIND(<urn:pause>() AS ?o) }")?
        .on_store(&store).execute();
    assert!(
        called.load(std::sync::atomic::Ordering::SeqCst),
        "did not reach the staged-update phase"
    );
    assert!(
        matches!(result, Err(UpdateEvaluationError::TimedOut)),
        "{result:?}"
    );
    assert!(store.is_empty()?);
    assert!(!store.contains_named_graph(&NamedNode::new("urn:empty")?.into())?);
    SparqlEvaluator::new()
        .parse_update("INSERT DATA { <urn:usable> <urn:p> <urn:o> }")?
        .on_store(&store)
        .execute()?;
    assert_eq!(store.len()?, 1);
    Ok(())
}

#[cfg(feature = "rocksdb")]
#[test]
fn writer_wait_consumes_absolute_deadline_without_a_canceller_thread() -> Result<(), Box<dyn Error>>
{
    let store = Store::new()?;
    let held = store.start_transaction()?;
    let deadline = Instant::now() + Duration::from_millis(40);
    let result = store.start_transaction_with_control(
        TransactionRequest::default(),
        TransactionStartControl::new()
            .with_cancellation_token(CancellationToken::new().with_deadline(deadline)),
    );
    assert!(matches!(result, Err(TransactionStartError::TimedOut)));
    assert!(Instant::now() >= deadline);
    drop(held);
    drop(store.start_transaction()?);
    Ok(())
}
