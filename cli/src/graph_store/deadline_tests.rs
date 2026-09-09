use super::*;
use anyhow::{Result, ensure};
use oxigraph::sparql::CancellationToken;
use oxigraph_cli::access::ListenerKind;
use oxigraph_cli::workload::{AdmissionController, WorkloadPolicy};
use std::time::Instant;

fn request(token: CancellationToken) -> Result<Request<Body>> {
    let controller = AdmissionController::new(WorkloadPolicy::from_json(
        br#"{
        "format":"oxigraph-admission-v1","policy_id":"test","version":1,
        "max_active":1,"max_queued":0,"operator_max_active":1,"operator_max_queued":0,
        "queue_timeout_ms":1000,"retry_after_seconds":1,
        "classes":{"default":{"max_active":1,"max_queued":0}}
    }"#,
    )?)?;
    let mut request = Request::builder()
        .uri("http://localhost/store")
        .body(Body::empty())?;
    request
        .extensions_mut()
        .insert(controller.acquire("default", ListenerKind::Data, token)?);
    Ok(request)
}

#[test]
fn final_precommit_checkpoint_rolls_back_data_and_empty_topology() -> Result<()> {
    let store = Store::new()?;
    let token = CancellationToken::new();
    let request = request(token.clone())?;
    let mut transaction =
        start_transaction(&store, &request).map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let graph = NamedNode::new("urn:empty")?;
    transaction.insert_named_graph(graph.clone());
    transaction.insert(Quad::new(
        NamedNode::new("urn:s")?,
        NamedNode::new("urn:p")?,
        NamedNode::new("urn:o")?,
        GraphName::DefaultGraph,
    ));
    token.cancel();
    ensure!(commit(transaction, &request).is_err());
    ensure!(store.is_empty()? && !store.contains_named_graph(&graph.into())?);
    Ok(())
}

#[test]
fn expiry_at_final_checkpoint_is_timeout_and_success_is_not_rewritten() -> Result<()> {
    let store = Store::new()?;
    let deadline = Instant::now() + std::time::Duration::from_millis(100);
    let request = request(CancellationToken::new().with_deadline(deadline))?;
    let mut transaction =
        start_transaction(&store, &request).map_err(|e| anyhow::anyhow!("{e:?}"))?;
    transaction.insert_named_graph(NamedNode::new("urn:empty")?);
    std::thread::sleep(deadline.saturating_duration_since(Instant::now()));
    ensure!(commit(transaction, &request).is_err_and(|e| e.0 == StatusCode::REQUEST_TIMEOUT));
    ensure!(!store.contains_named_graph(&NamedNode::new("urn:empty")?.into())?);
    let token = CancellationToken::new();
    let request = self::request(token.clone())?;
    let mut transaction =
        start_transaction(&store, &request).map_err(|e| anyhow::anyhow!("{e:?}"))?;
    transaction.insert_named_graph(NamedNode::new("urn:committed")?);
    let result = commit(transaction, &request);
    token.cancel();
    ensure!(
        result.is_ok() && store.contains_named_graph(&NamedNode::new("urn:committed")?.into())?
    );
    Ok(())
}

#[test]
fn checked_load_preserves_empty_graphs_and_document_blank_node_scope() -> Result<()> {
    let store = Store::new()?;
    let request = request(CancellationToken::new())?;
    let mut transaction =
        start_transaction(&store, &request).map_err(|e| anyhow::anyhow!("{e:?}"))?;
    for _ in 0..2 {
        load(
            &mut transaction,
            &request,
            RdfParser::from_format(RdfFormat::TriG),
            b"<urn:empty> {} _:a <urn:p> _:a .",
        )
        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
    }
    commit(transaction, &request).map_err(|e| anyhow::anyhow!("{e:?}"))?;
    ensure!(store.len()? == 2 && store.contains_named_graph(&NamedNode::new("urn:empty")?.into())?);
    Ok(())
}

#[test]
fn deadline_profile_rejects_only_uninstrumented_paths_before_work() -> Result<()> {
    let store = Store::new()?;
    let token =
        CancellationToken::new().with_deadline(Instant::now() + std::time::Duration::from_secs(2));
    let mut request = request(token)?;
    let result = crate::evaluate_sparql_query(
        &store,
        &oxigraph::sparql::SparqlEvaluator::new(),
        "ASK {}",
        None,
        false,
        Vec::new(),
        Vec::new(),
        &request,
        oxigraph::sparql::QueryEntailment::Rdfs12Finite,
        None,
    );
    ensure!(result.is_err_and(|error| error.0 == StatusCode::BAD_REQUEST));
    *request.uri_mut() = "http://localhost/store?default&no_transaction".parse()?;
    *request.method_mut() = Method::PUT;
    request
        .headers_mut()
        .insert(CONTENT_TYPE, "text/turtle".parse()?);
    ensure!(
        handle(&mut request, &store, false).is_err_and(|error| error.0 == StatusCode::BAD_REQUEST)
    );
    // The flag is irrelevant to GET, which must retain its regular behavior.
    *request.method_mut() = Method::GET;
    ensure!(handle(&mut request, &store, false).is_ok());
    ensure!(store.is_empty()?);
    Ok(())
}
