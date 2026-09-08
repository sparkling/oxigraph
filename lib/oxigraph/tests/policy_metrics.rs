#![expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "public policy telemetry assertions"
)]
use oxigraph::store::{PolicyDenialPurpose, PolicyMetrics, Store};
use std::error::Error;
type TestResult = Result<(), Box<dyn Error + Send + Sync>>;

#[test]
fn fixed_export_is_available_without_policy_features() -> TestResult {
    let store = Store::new()?;
    let metrics = store.policy_metrics();
    assert_eq!(metrics, PolicyMetrics::default());
    let mut output = String::new();
    metrics.write_prometheus(&mut output)?;
    assert_eq!(
        output.lines().filter(|line| !line.starts_with('#')).count(),
        143
    );
    assert_eq!(
        output
            .lines()
            .filter(|line| line.starts_with("# TYPE"))
            .count(),
        4
    );
    for purpose in PolicyDenialPurpose::ALL {
        assert_eq!(metrics.denials(purpose), 0);
        assert_eq!(
            metrics.denial_duration(purpose).buckets().last(),
            Some((None, 0))
        );
    }
    for disposition in PolicyMetrics::VALIDATION_DISPOSITIONS {
        assert_eq!(metrics.validations(disposition), 0);
        assert_eq!(
            metrics.validation_duration(disposition).buckets().last(),
            Some((None, 0))
        );
    }
    Ok(())
}

#[cfg(feature = "http-client")]
mod remote {
    use super::*;
    use oxigraph::model::{Dataset, NamedNode, OxString, Variable};
    use oxigraph::sparql::{
        DefaultServiceHandler, EgressPolicy, QueryEntailmentOptions, QueryResults,
        QuerySolutionIter, SparqlEvaluator,
    };
    use oxigraph::store::{EvaluationOperation, EvaluationOutcome};
    use std::convert::Infallible;
    use std::sync::Arc;

    #[test]
    fn denied_and_silent_attempts_are_counted_before_outer_completion() -> TestResult {
        let store = Store::new()?;
        let evaluator = SparqlEvaluator::new().with_deny_all_egress_policy();
        for silent in [false, true] {
            let keyword = if silent { "SILENT" } else { "" };
            assert_eq!(evaluator.clone().parse_query(&format!("ASK {{ SERVICE {keyword} <http://example.invalid/private> {{ ?s ?p ?o }} }}"))?.on_store(&store).execute().is_ok(), silent);
            assert_eq!(
                evaluator
                    .clone()
                    .parse_update(&format!("LOAD {keyword} <http://example.invalid/private>"))?
                    .on_store(&store)
                    .execute()
                    .is_ok(),
                silent
            );
        }
        evaluator
            .parse_update(
                "LOAD SILENT <http://example.invalid/a>; LOAD SILENT <http://example.invalid/b>",
            )?
            .on_store(&store)
            .execute()?;
        let metrics = store.clone().policy_metrics();
        assert_eq!(metrics.denials(PolicyDenialPurpose::Service), 2);
        assert_eq!(metrics.denials(PolicyDenialPurpose::Load), 4);
        assert_eq!(metrics.denials(PolicyDenialPurpose::Document), 0);
        assert_eq!(
            store
                .evaluation_metrics()
                .count(EvaluationOperation::Update, EvaluationOutcome::Succeeded),
            2
        );
        assert_eq!(
            store
                .evaluation_metrics()
                .count(EvaluationOperation::Update, EvaluationOutcome::PolicyDenied),
            1
        );
        let mut text = String::new();
        metrics.write_prometheus(&mut text)?;
        assert!(!text.contains("private") && !text.contains("example.invalid"));
        assert!(text.contains(
            "oxigraph_egress_denial_duration_seconds_bucket{purpose=\"load\",le=\"+Inf\"} 4\n"
        ));
        Ok(())
    }

    #[test]
    fn prepared_clones_have_store_local_observers_and_generic_bindings_have_none() -> TestResult {
        let left = Store::new()?;
        let right = Store::new()?;
        let query = SparqlEvaluator::new()
            .with_deny_all_egress_policy()
            .parse_query(
                "SELECT * WHERE { SERVICE SILENT <http://example.invalid/private> { ?s ?p ?o } }",
            )?;
        let left_bound = query.clone().on_store(&left);
        let right_bound = query.clone().on_store(&right);
        assert_eq!(left.policy_metrics(), PolicyMetrics::default());
        assert_eq!(right.policy_metrics(), PolicyMetrics::default());
        let QueryResults::Solutions(left_rows) = left_bound.execute()? else {
            return Err("expected solutions".into());
        };
        assert_eq!(
            left.policy_metrics().denials(PolicyDenialPurpose::Service),
            1
        );
        assert_eq!(
            right.policy_metrics().denials(PolicyDenialPurpose::Service),
            0
        );
        let QueryResults::Solutions(right_rows) = right_bound.execute()? else {
            return Err("expected solutions".into());
        };
        assert_eq!(left_rows.collect::<Result<Vec<_>, _>>()?.len(), 1);
        assert_eq!(right_rows.collect::<Result<Vec<_>, _>>()?.len(), 1);
        let dataset = Dataset::new();
        let QueryResults::Solutions(rows) = query.on_queryable_dataset(&dataset).execute()? else {
            return Err("expected solutions".into());
        };
        assert_eq!(rows.collect::<Result<Vec<_>, _>>()?.len(), 1);
        let update = SparqlEvaluator::new()
            .with_deny_all_egress_policy()
            .parse_update("LOAD SILENT <http://example.invalid/private>")?;
        update.clone().on_dataset(&left).execute()?;
        let mut transaction = left.start_transaction()?;
        update.on_transaction(&mut transaction).execute()?;
        transaction.commit()?;
        assert_eq!(
            left.policy_metrics().denials(PolicyDenialPurpose::Service),
            1
        );
        assert_eq!(
            right.policy_metrics().denials(PolicyDenialPurpose::Service),
            1
        );
        assert_eq!(left.policy_metrics().denials(PolicyDenialPurpose::Load), 0);
        Ok(())
    }

    struct EmptyHandler;
    impl DefaultServiceHandler for EmptyHandler {
        type Error = Infallible;
        fn handle(
            &self,
            _: &NamedNode,
            _: &spargebra::algebra::QueryExpression,
            _: Option<&oxiri::Iri<OxString>>,
        ) -> Result<QuerySolutionIter<'static>, Self::Error> {
            let variables: Arc<[Variable]> = Arc::from([]);
            Ok(QuerySolutionIter::new(variables, []))
        }
    }
    #[test]
    fn store_rebinding_preserves_custom_handlers_and_attributes_update_service() -> TestResult {
        let store = Store::new()?;
        let evaluator = SparqlEvaluator::new().with_deny_all_egress_policy();
        assert!(matches!(
            evaluator
                .clone()
                .with_default_service_handler(EmptyHandler)
                .parse_query("ASK { SERVICE <http://example.invalid/private> { ?s ?p ?o } }")?
                .on_store(&store)
                .execute()?,
            QueryResults::Boolean(false)
        ));
        assert_eq!(store.policy_metrics(), PolicyMetrics::default());
        evaluator.clone().parse_update("INSERT { <urn:s> <urn:p> <urn:o> } WHERE { SERVICE SILENT <http://example.invalid/private> { ?s ?p ?o } }")?.on_store(&store).execute()?;
        assert_eq!(
            store.policy_metrics().denials(PolicyDenialPurpose::Service),
            1
        );
        assert_eq!(store.policy_metrics().denials(PolicyDenialPurpose::Load), 0);
        evaluator
            .parse_query("ASK { SERVICE SILENT <http://example.invalid/private> { ?s ?p ?o } }")?
            .on_store_with_entailment(&store, &QueryEntailmentOptions::default())?
            .execute()?;
        assert_eq!(
            store.policy_metrics().denials(PolicyDenialPurpose::Service),
            2
        );
        Ok(())
    }

    #[test]
    fn nested_document_denial_is_not_recounted_as_load_denial() -> TestResult {
        use std::io::{Read, Write};
        use std::net::{IpAddr, Ipv4Addr, TcpListener};
        use std::time::{Duration, Instant};
        let store = Store::new()?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let origin = format!("http://{}", listener.local_addr()?);
        listener.set_nonblocking(true)?;
        std::thread::scope(|scope| -> TestResult {
            let server = scope.spawn(move || -> TestResult {
                let deadline = Instant::now() + Duration::from_secs(3);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                        Err(error) => return Err(error.into()),
                    }
                };
                stream.set_read_timeout(Some(Duration::from_secs(2)))?;
                stream.set_write_timeout(Some(Duration::from_secs(2)))?;
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                    stream.read_exact(&mut byte)?;
                    request.push(byte[0]);
                }
                let body = r#"{"@context":"http://example.invalid/private-context","@id":"urn:s"}"#;
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/ld+json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())?;
                Ok(())
            });
            let policy = EgressPolicy::deny_all()
                .allow_origin(&origin)?
                .allow_ip(IpAddr::V4(Ipv4Addr::LOCALHOST));
            let result = SparqlEvaluator::new()
                .with_egress_policy(policy)
                .parse_update(&format!("LOAD <{origin}/data>"))?
                .on_store(&store)
                .execute();
            server.join().map_err(|_| "fixture thread failed")??;
            result.err().ok_or("nested context should be denied")?;
            assert!(store.is_empty()?);
            assert_eq!(
                store
                    .policy_metrics()
                    .denials(PolicyDenialPurpose::Document),
                1
            );
            assert_eq!(store.policy_metrics().denials(PolicyDenialPurpose::Load), 0);
            Ok(())
        })
    }
}

#[cfg(feature = "shacl")]
mod validation {
    use super::*;
    use oxigraph::model::{Dataset, GraphName, Literal, NamedNode, Quad, vocab};
    use oxigraph::shacl::GraphSnapshot;
    use oxigraph::store::{
        OutcomeAwareWritableDataset, ShaclCommitPolicy, ShaclDisposition, ShaclGraphScope,
        ShaclShapesSource, TransactionKey, TransactionRequest, WritableDataset,
    };

    fn policy() -> ShaclCommitPolicy {
        let shape = NamedNode::new_unchecked("urn:private:shape");
        let sh = |name| NamedNode::new_unchecked(format!("http://www.w3.org/ns/shacl#{name}"));
        let dataset: Dataset = [
            Quad::new(
                shape.clone(),
                vocab::rdf::TYPE,
                sh("PropertyShape"),
                GraphName::DefaultGraph,
            ),
            Quad::new(
                shape.clone(),
                sh("targetNode"),
                NamedNode::new_unchecked("urn:s"),
                GraphName::DefaultGraph,
            ),
            Quad::new(
                shape.clone(),
                sh("path"),
                NamedNode::new_unchecked("urn:p"),
                GraphName::DefaultGraph,
            ),
            Quad::new(
                shape,
                sh("minCount"),
                Literal::from(1),
                GraphName::DefaultGraph,
            ),
        ]
        .into_iter()
        .collect();
        ShaclCommitPolicy::new(
            vec![ShaclGraphScope {
                graph_name: GraphName::DefaultGraph,
                required: true,
            }],
            ShaclShapesSource::External(Box::new(GraphSnapshot::default_graph(dataset))),
        )
    }
    fn exercise(store: &Store) -> TestResult {
        assert_eq!(store.policy_metrics(), PolicyMetrics::default());
        for id in 1..=3 {
            let mut tx = store
                .start_shacl_transaction(
                    TransactionRequest::default(),
                    TransactionKey::new([id; 16]),
                    policy(),
                )?
                .into_transaction();
            tx.insert(Quad::new(
                NamedNode::new_unchecked("urn:s"),
                NamedNode::new_unchecked("urn:p"),
                Literal::from(1),
                GraphName::DefaultGraph,
            ))?;
            match id {
                1 => {
                    tx.commit()?;
                }
                2 => WritableDataset::commit(tx)?,
                _ => OutcomeAwareWritableDataset::commit_with_outcome(tx)?,
            }
        }
        let mut tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                TransactionKey::new([4; 16]),
                policy(),
            )?
            .into_transaction();
        tx.clear()?;
        tx.commit()
            .err()
            .ok_or("nonconforming data should be rejected")?;
        assert_eq!(store.len()?, 1);
        let gate_policy = policy();
        let control = gate_policy.control();
        let tx = store
            .start_shacl_transaction(
                TransactionRequest::default(),
                TransactionKey::new([5; 16]),
                gate_policy,
            )?
            .into_transaction();
        control.cancel();
        tx.commit()
            .err()
            .ok_or("cancelled gate should be rejected")?;
        let before = store.policy_metrics();
        drop(store.start_shacl_transaction(
            TransactionRequest::default(),
            TransactionKey::new([6; 16]),
            policy(),
        )?);
        store
            .start_shacl_transaction(
                TransactionRequest::default(),
                TransactionKey::new([7; 16]),
                policy(),
            )?
            .into_transaction()
            .rollback()?;
        assert_eq!(store.policy_metrics(), before);
        assert_eq!(before.validations(ShaclDisposition::Accepted), 3);
        assert_eq!(before.validations(ShaclDisposition::Nonconforming), 1);
        assert_eq!(before.validations(ShaclDisposition::Cancelled), 1);
        let mut text = String::new();
        store.clone().policy_metrics().write_prometheus(&mut text)?;
        assert!(!text.contains("private") && !text.contains("urn:"));
        Ok(())
    }
    #[test]
    fn all_commit_paths_count_once_and_rollback_does_not_validate() -> TestResult {
        exercise(&Store::new()?)
    }
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn persistent_observations_reset_on_reopen() -> TestResult {
        let directory = tempfile::tempdir()?;
        let store = Store::open(directory.path())?;
        exercise(&store)?;
        store.flush()?;
        drop(store);
        let store = Store::open_read_only(directory.path())?;
        assert_eq!(store.policy_metrics(), PolicyMetrics::default());
        assert_eq!(store.len()?, 1);
        Ok(())
    }
}
