//! `cargo run --locked -p oxigraph --features text-index --example text_index`
#[cfg(unix)]
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
    use oxigraph::store::{
        DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider, Store,
        TextIndexProvider, TextQuery, TransactionStartControl,
    };
    use std::io::Write;
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path().join("primary"))?;
    let node = NamedNode::new("urn:example")?;
    let old = Quad::new(
        node.clone(),
        node.clone(),
        Literal::from("linked data search"),
        GraphName::DefaultGraph,
    );
    store.insert(old.clone())?;
    let source = store.derived_snapshot(&TransactionStartControl::new())?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let root = directory.path().join("text");
    let mut index = DerivedIndex::create(&root, provider.identity())?;
    let generation = index.rebuild(&source, &provider, &limits)?;
    index.activate(&generation, &source, &provider, &limits)?;
    drop(index);
    let mut index = DerivedIndex::open(root, provider.identity())?;
    let query = TextQuery::new("linked search");
    let result = provider.query(&index.strict(&source, &limits)?, &query, &limits.input)?;
    store.remove(&old)?;
    store.insert(Quad::new(
        node.clone(),
        node,
        Literal::from("new linked data search"),
        GraphName::DefaultGraph,
    ))?;
    let newer = store.derived_snapshot(&TransactionStartControl::new())?;
    let not_fresh = matches!(
        index.strict(&newer, &limits),
        Err(DerivedGenerationError::NotFresh)
    );
    let eventual = provider.query(&index.eventual(&newer, &limits)?, &query, &limits.input)?;
    let generation = index.rebuild(&newer, &provider, &limits)?;
    index.activate(&generation, &newer, &provider, &limits)?;
    let rebuilt = provider.query(&index.strict(&newer, &limits)?, &query, &limits.input)?;
    if result.total_matches != 1
        || !not_fresh
        || eventual.total_matches != 0
        || rebuilt.total_matches != 1
    {
        return Err("unexpected text query result".into());
    }
    writeln!(
        std::io::stdout().lock(),
        "reopened_matches={} strict_not_fresh={not_fresh} eventual_matches={} rebuilt_matches={}",
        result.total_matches,
        eventual.total_matches,
        rebuilt.total_matches
    )?;
    Ok(())
}
#[cfg(not(unix))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("this example requires Unix native RocksDB support".into())
}
