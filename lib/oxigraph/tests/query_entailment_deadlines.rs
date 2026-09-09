//! Native deadline behavior, independent of pinned semantic evidence.
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::sparql::{
    CancellationToken, QueryEntailment, QueryEntailmentDataset, QueryEntailmentError,
    QueryEntailmentOptions, QueryEvaluationError, SparqlEvaluator,
};
use oxigraph::store::Store;
use std::time::{Duration, Instant};

fn profiles() -> Vec<QueryEntailment> {
    let mut profiles = vec![QueryEntailment::Simple];
    if cfg!(feature = "rdf-12") {
        profiles.push(QueryEntailment::Rdf12Finite);
    }
    if cfg!(feature = "rdfs") {
        profiles.push(QueryEntailment::Rdfs12Finite);
    }
    if cfg!(feature = "owl2-rl") {
        profiles.push(QueryEntailment::Owl2RlRdfBounded);
    }
    profiles
}

#[test]
fn evaluator_deadline_applies_before_entailment_binding_in_every_feature_profile() {
    let store = Store::new().unwrap();
    for profile in profiles() {
        let result = SparqlEvaluator::new()
            .with_cancellation_token(CancellationToken::new().with_deadline(Instant::now()))
            .parse_query("ASK {}")
            .unwrap()
            .on_store_with_entailment(&store, &QueryEntailmentOptions::new(profile));
        assert!(matches!(
            result,
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::TimedOut
            ))
        ));
    }
}

#[test]
fn explicit_cancellation_and_options_timeout_remain_distinct() {
    let store = Store::new().unwrap();
    for profile in profiles() {
        let token = CancellationToken::new();
        token.cancel();
        let result = QueryEntailmentDataset::from_store(
            &store,
            &QueryEntailmentOptions::new(profile).with_cancellation_token(token),
        );
        assert!(matches!(
            result,
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::Cancelled
            ))
        ));
        let result = QueryEntailmentDataset::from_store(
            &store,
            &QueryEntailmentOptions::new(profile).with_timeout(Some(Duration::ZERO)),
        );
        assert!(matches!(
            result,
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::TimedOut
            ))
        ));
    }
}

#[test]
fn options_cannot_extend_the_enclosing_request_deadline() {
    let store = Store::new().unwrap();
    let result = SparqlEvaluator::new()
        .with_cancellation_token(CancellationToken::new().with_deadline(Instant::now()))
        .parse_query("ASK {}")
        .unwrap()
        .on_store_with_entailment(
            &store,
            &QueryEntailmentOptions::default()
                .with_timeout(Some(Duration::from_secs(60)))
                .with_cancellation_token(CancellationToken::new()),
        );
    assert!(matches!(
        result,
        Err(QueryEntailmentError::Evaluation(
            QueryEvaluationError::TimedOut
        ))
    ));
}

#[test]
fn cancellation_after_binding_stops_owned_materialized_iteration() {
    use spareval::QueryableDataset;
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            NamedNode::new("urn:s").unwrap(),
            NamedNode::new("urn:p").unwrap(),
            NamedNode::new("urn:o").unwrap(),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    let token = CancellationToken::new();
    let dataset = QueryEntailmentDataset::from_store(
        &store,
        &QueryEntailmentOptions::default().with_cancellation_token(token.clone()),
    )
    .unwrap();
    let mut rows = dataset.internal_quads_for_pattern(None, None, None, Some(None));
    token.cancel();
    assert!(matches!(
        rows.next(),
        Some(Err(QueryEntailmentError::Evaluation(
            QueryEvaluationError::Cancelled
        )))
    ));
    assert!(rows.next().is_none());
    assert_eq!(store.len().unwrap(), 1);
}

#[cfg(feature = "rdf-12")]
#[test]
fn finite_rdf_deadline_keeps_from_merge_and_empty_named_graph_semantics() {
    use oxigraph::model::vocab::rdf;
    use oxigraph::sparql::QueryResults;
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            NamedNode::new("urn:s").unwrap(),
            NamedNode::new("urn:p").unwrap(),
            NamedNode::new("urn:o").unwrap(),
            NamedNode::new("urn:source").unwrap(),
        ))
        .unwrap();
    store
        .insert_named_graph(NamedNode::new("urn:empty").unwrap())
        .unwrap();
    let token = CancellationToken::new().with_deadline(Instant::now() + Duration::from_secs(10));
    let result = SparqlEvaluator::new().with_cancellation_token(token)
        .parse_query(&format!("ASK FROM <urn:source> FROM NAMED <urn:empty> {{ <urn:p> <{}> <{}> . GRAPH <urn:empty> {{ }} }}", rdf::TYPE.as_str(), rdf::PROPERTY.as_str())).unwrap()
        .on_store_with_entailment(&store, &QueryEntailmentOptions::new(QueryEntailment::Rdf12Finite)).unwrap()
        .execute().unwrap();
    assert!(matches!(result, QueryResults::Boolean(true)));
    assert_eq!(store.len().unwrap(), 1);
}

#[cfg(all(feature = "rdf-12", feature = "rdfs"))]
#[test]
fn finite_rdfs_deadline_keeps_from_merge_empty_graph_and_read_only_inference() {
    use oxigraph::model::vocab::rdfs;
    use oxigraph::sparql::QueryResults;
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            NamedNode::new("urn:s").unwrap(),
            NamedNode::new("urn:p").unwrap(),
            NamedNode::new("urn:o").unwrap(),
            NamedNode::new("urn:data").unwrap(),
        ))
        .unwrap();
    store
        .insert(Quad::new(
            NamedNode::new("urn:p").unwrap(),
            rdfs::DOMAIN,
            NamedNode::new("urn:Class").unwrap(),
            NamedNode::new("urn:schema").unwrap(),
        ))
        .unwrap();
    store
        .insert_named_graph(NamedNode::new("urn:empty").unwrap())
        .unwrap();
    let token = CancellationToken::new().with_deadline(Instant::now() + Duration::from_secs(10));
    let result = SparqlEvaluator::new().with_cancellation_token(token)
        .parse_query("ASK FROM <urn:data> FROM <urn:schema> FROM NAMED <urn:empty> { <urn:s> a <urn:Class> . GRAPH <urn:empty> {} }").unwrap()
        .on_store_with_entailment(&store, &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite)).unwrap()
        .execute().unwrap();
    assert!(matches!(result, QueryResults::Boolean(true)));
    assert_eq!(store.len().unwrap(), 2);
    assert!(
        !store
            .contains(&Quad::new(
                NamedNode::new("urn:s").unwrap(),
                oxigraph::model::vocab::rdf::TYPE,
                NamedNode::new("urn:Class").unwrap(),
                GraphName::DefaultGraph
            ))
            .unwrap()
    );
    assert!(
        store
            .contains_named_graph(&NamedNode::new("urn:empty").unwrap().into())
            .unwrap()
    );
}

#[cfg(feature = "owl2-rl")]
#[test]
fn bounded_owl_deadline_keeps_from_merge_empty_graph_and_read_only_inference() {
    use oxigraph::sparql::QueryResults;
    let store = Store::new().unwrap();
    store
        .insert(Quad::new(
            NamedNode::new("urn:s").unwrap(),
            NamedNode::new("urn:p").unwrap(),
            NamedNode::new("urn:o").unwrap(),
            NamedNode::new("urn:data").unwrap(),
        ))
        .unwrap();
    store
        .insert(Quad::new(
            NamedNode::new("urn:p").unwrap(),
            NamedNode::new("http://www.w3.org/2002/07/owl#inverseOf").unwrap(),
            NamedNode::new("urn:inverse").unwrap(),
            NamedNode::new("urn:schema").unwrap(),
        ))
        .unwrap();
    store
        .insert_named_graph(NamedNode::new("urn:empty").unwrap())
        .unwrap();
    let token = CancellationToken::new().with_deadline(Instant::now() + Duration::from_secs(10));
    let result = SparqlEvaluator::new().with_cancellation_token(token)
        .parse_query("ASK FROM <urn:data> FROM <urn:schema> FROM NAMED <urn:empty> { <urn:o> <urn:inverse> <urn:s> . GRAPH <urn:empty> {} }").unwrap()
        .on_store_with_entailment(&store, &QueryEntailmentOptions::new(QueryEntailment::Owl2RlRdfBounded)).unwrap()
        .execute().unwrap();
    assert!(matches!(result, QueryResults::Boolean(true)));
    assert_eq!(store.len().unwrap(), 2);
    assert!(
        !store
            .contains(&Quad::new(
                NamedNode::new("urn:o").unwrap(),
                NamedNode::new("urn:inverse").unwrap(),
                NamedNode::new("urn:s").unwrap(),
                GraphName::DefaultGraph,
            ))
            .unwrap()
    );
    assert!(
        store
            .contains_named_graph(&NamedNode::new("urn:empty").unwrap().into())
            .unwrap()
    );
}
