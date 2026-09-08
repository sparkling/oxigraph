//! `cargo run --locked -p oxigraph --features statistics --example statistics`
#[cfg(unix)]
fn leaf(
    node: &oxigraph::sparql::CardinalityFeedbackNode,
) -> Option<&oxigraph::sparql::CardinalityFeedbackNode> {
    if node.operator == "QuadPattern" {
        Some(node)
    } else {
        node.children.iter().find_map(leaf)
    }
}
#[cfg(unix)]
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
    use oxigraph::sparql::{BoundedJoinPlanning, QueryResults, SparqlEvaluator};
    use oxigraph::store::{
        DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider,
        StatisticsProvider, Store, TransactionKey, TransactionRequest, TransactionStartControl,
        WritableDataset,
    };
    use std::io::Write;
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path().join("db"))?;
    let predicate = NamedNode::new("urn:label")?;
    let quad = |name| {
        Quad::new(
            NamedNode::new_unchecked(name),
            predicate.clone(),
            Literal::from("red"),
            GraphName::DefaultGraph,
        )
    };
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    tx.insert(quad("urn:a"))?;
    tx.insert(quad("urn:b"))?;
    tx.commit()?;
    let provider = StatisticsProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(directory.path().join("stats"), provider.identity())?;
    let source = store.derived_snapshot(&TransactionStartControl::new())?;
    let generation = index.rebuild(&source, &provider, &limits)?;
    index.activate(&generation, &source, &provider, &limits)?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    tx.insert(quad("urn:aborted"))?;
    tx.rollback()?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([3; 16]))?
        .into_transaction();
    tx.insert(quad("urn:c"))?;
    tx.commit()?;
    drop(source);
    let source = store.derived_snapshot(&TransactionStartControl::new())?;
    let not_fresh = matches!(
        index.strict(&source, &limits),
        Err(DerivedGenerationError::NotFresh)
    );
    let generation = index.catch_up(&source, &provider, &limits)?;
    index.activate(&generation, &source, &provider, &limits)?;
    drop(source);
    drop(index);
    drop(store);
    let store = Store::open(directory.path().join("db"))?;
    let index = DerivedIndex::open(directory.path().join("stats"), provider.identity())?;
    let source = store.derived_snapshot(&TransactionStartControl::new())?;
    let stats = provider.read(&index.strict(&source, &limits)?, &limits.input)?;
    let group = stats
        .scope(&GraphName::DefaultGraph, &predicate)
        .ok_or("missing scope")?;
    let frequency = group.object_frequency(&Literal::from("red").into())?;
    if !not_fresh
        || stats.count_quads(None, None) != 3
        || !frequency.is_exact()
        || frequency.lower != 3
    {
        return Err("unexpected statistics".into());
    }
    writeln!(
        std::io::stdout().lock(),
        "reopened_quads=3 rollback_absent=true prior_not_fresh={not_fresh} red_frequency={}..{}",
        frequency.lower,
        frequency.upper
    )?;
    let (rows, explanation) = SparqlEvaluator::new()
        .with_bounded_join_planning(BoundedJoinPlanning::default())
        .parse_query("SELECT ?s WHERE { ?s <urn:label> ?label . ?s <urn:label> ?other }")?
        .on_statistics(source, &index, &provider, limits)?
        .compute_statistics()
        .explain()?;
    let QueryResults::Solutions(rows) = rows? else {
        return Err("expected solutions".into());
    };
    let actual = rows.collect::<Result<Vec<_>, _>>()?.len();
    let feedback = explanation.cardinality_feedback();
    let leaf = leaf(&feedback.root).ok_or("missing scan feedback")?;
    if actual != 3 || leaf.estimated_rows != Some(3) || leaf.q_error != Some(1.) {
        return Err("unexpected query feedback".into());
    }
    writeln!(
        std::io::stdout().lock(),
        "query_rows={actual} estimated_rows=3 q_error=1 complete=true"
    )?;
    let planning = explanation.join_planning();
    if planning.dp_components != 1 {
        return Err("expected bounded join search".into());
    }
    writeln!(
        std::io::stdout().lock(),
        "cost_model={} dp_components={} dp_states={} dp_candidates={}",
        BoundedJoinPlanning::COST_MODEL,
        planning.dp_components,
        planning.dp_states,
        planning.dp_candidates
    )?;
    Ok(())
}
#[cfg(not(unix))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("requires Unix native RocksDB".into())
}
