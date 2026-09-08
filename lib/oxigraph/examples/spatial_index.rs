//! `cargo run --locked -p oxigraph --features spatial-index --example spatial_index`
#[cfg(unix)]
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
    use oxigraph::store::{
        DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider,
        SpatialIndexProvider, SpatialQuery, Store, TransactionKey, TransactionRequest,
        TransactionStartControl, WritableDataset,
    };
    use std::io::Write;
    let directory = tempfile::tempdir()?;
    let db = Store::open(directory.path().join("db"))?;
    let wkt = NamedNode::new("http://www.opengis.net/ont/geosparql#wktLiteral")?;
    let predicate = NamedNode::new("urn:geometry")?;
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    for (name, shape) in [("near", "POINT(1 2)"), ("far", "POINT(80 40)")] {
        tx.insert(Quad::new(
            NamedNode::new(format!("urn:{name}"))?,
            predicate.clone(),
            Literal::new_typed_literal(shape, wkt.clone()),
            GraphName::DefaultGraph,
        ))?;
    }
    tx.commit()?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let source = db.derived_snapshot(&TransactionStartControl::new())?;
    let root = directory.path().join("spatial");
    let mut index = DerivedIndex::create(&root, provider.identity())?;
    let generation = index.rebuild(&source, &provider, &limits)?;
    index.activate(&generation, &source, &provider, &limits)?;
    drop(index);
    let mut index = DerivedIndex::open(root, provider.identity())?;
    let query = SpatialQuery::new(
        Literal::new_typed_literal("POLYGON((0 0,4 0,4 4,0 4,0 0))", wkt.clone()),
        NamedNode::new("http://www.opengis.net/def/function/geosparql/sfWithin")?,
    );
    let first = provider.query(&index.strict(&source, &limits)?, &query, &limits.input)?;
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    tx.insert(Quad::new(
        NamedNode::new("urn:added")?,
        predicate,
        Literal::new_typed_literal("POINT(2 2)", wkt),
        GraphName::DefaultGraph,
    ))?;
    tx.commit()?;
    let newer = db.derived_snapshot(&TransactionStartControl::new())?;
    let not_fresh = matches!(
        index.strict(&newer, &limits),
        Err(DerivedGenerationError::NotFresh)
    );
    let generation = index.catch_up(&newer, &provider, &limits)?;
    index.activate(&generation, &newer, &provider, &limits)?;
    let caught_up = provider.query(&index.strict(&newer, &limits)?, &query, &limits.input)?;
    if first.total_matches != 1
        || first.candidates != 1
        || !not_fresh
        || caught_up.total_matches != 2
    {
        return Err("unexpected spatial query result".into());
    }
    writeln!(
        std::io::stdout().lock(),
        "reopened_matches={} candidates={} strict_not_fresh={not_fresh} caught_up_matches={}",
        first.total_matches,
        first.candidates,
        caught_up.total_matches
    )?;
    Ok(())
}
#[cfg(not(unix))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("this example requires Unix native RocksDB support".into())
}
