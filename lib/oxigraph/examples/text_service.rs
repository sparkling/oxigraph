//! `cargo run --locked -p oxigraph --features text-index --example text_service`
#[cfg(unix)]
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
    use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    use oxigraph::store::{
        DerivedGenerationLimits, DerivedIndex, DerivedProvider, Store, TextIndexProvider,
        TransactionStartControl,
    };
    use std::io::Write;
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path().join("primary"))?;
    let quad = Quad::new(
        NamedNode::new("urn:example")?,
        NamedNode::new("urn:label")?,
        Literal::from("linked data search"),
        GraphName::DefaultGraph,
    );
    store.insert(quad.clone())?;
    let source = store.derived_snapshot(&TransactionStartControl::new())?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(directory.path().join("text"), provider.identity())?;
    let generation = index.rebuild(&source, &provider, &limits)?;
    index.activate(&generation, &source, &provider, &limits)?;
    let query = r#"
      PREFIX text: <urn:oxigraph:text:>
      SELECT ?s ?value ?score WHERE {
        SERVICE text:search:v1 { ?value text:query "linked search"; text:score ?score }
        ?s <urn:label> ?value
      }"#;
    let bound = SparqlEvaluator::new().parse_query(query)?.on_text_index(
        source,
        &index,
        provider.clone(),
        limits.clone(),
    );
    store.remove(&quad)?;
    let result = bound.execute()?;
    let QueryResults::Solutions(solutions) = result.results else {
        return Err("expected SELECT".into());
    };
    let solutions = solutions.collect::<Result<Vec<_>, _>>()?;
    if solutions.len() != 1 || solutions[0].get("s") != Some(&NamedNode::new("urn:example")?.into())
    {
        return Err("retained text/RDF snapshot join failed".into());
    }
    let query = r#"
      PREFIX text: <urn:oxigraph:text:>
      SELECT ?value WHERE {
        SERVICE text:search:v1 { ?value text:query "linked search"; text:consistency text:eventual }
      }"#;
    let result = SparqlEvaluator::new()
        .parse_query(query)?
        .on_eventual_text_index(
            store.derived_snapshot(&TransactionStartControl::new())?,
            &index,
            provider,
            limits,
        )
        .execute()?;
    let lag_reported = result.context.applied.as_ref() != Some(&result.context.source);
    let QueryResults::Solutions(solutions) = result.results else {
        return Err("expected SELECT".into());
    };
    let eventual_rows = solutions.collect::<Result<Vec<_>, _>>()?.len();
    if !lag_reported || eventual_rows != 0 {
        return Err("eventual deletion/lag reporting failed".into());
    }
    writeln!(
        std::io::stdout().lock(),
        "retained_snapshot_join=1 eventual_rows={eventual_rows} lag_reported={lag_reported}"
    )?;
    Ok(())
}
#[cfg(not(unix))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("this example requires Unix native RocksDB support".into())
}
