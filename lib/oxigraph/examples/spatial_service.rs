//! `cargo run --locked -p oxigraph --features spatial-index --example spatial_service`
#[cfg(unix)]
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
    use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    use oxigraph::store::{
        DerivedGenerationLimits, DerivedIndex, DerivedProvider, SpatialIndexProvider, Store,
        TransactionKey, TransactionRequest, TransactionStartControl, WritableDataset,
    };
    use std::io::Write;
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path().join("db"))?;
    let geometry = |name: &str, shape: &str| {
        Quad::new(
            NamedNode::new_unchecked(format!("urn:{name}")),
            NamedNode::new_unchecked("urn:geometry"),
            Literal::new_typed_literal(
                shape.to_owned(),
                NamedNode::new_unchecked("http://www.opengis.net/ont/geosparql#wktLiteral"),
            ),
            GraphName::DefaultGraph,
        )
    };
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    tx.insert(geometry("near", "POINT(1 2)"))?;
    tx.insert(geometry("far", "POINT(80 40)"))?;
    tx.commit()?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    tx.insert(geometry("aborted", "POINT(2 2)"))?;
    tx.rollback()?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let source = store.derived_snapshot(&TransactionStartControl::new())?;
    let mut index = DerivedIndex::create(directory.path().join("spatial"), provider.identity())?;
    let generation = index.rebuild(&source, &provider, &limits)?;
    index.activate(&generation, &source, &provider, &limits)?;
    drop(source);
    drop(index);
    drop(store);
    let store = Store::open(directory.path().join("db"))?;
    let index = DerivedIndex::open(directory.path().join("spatial"), provider.identity())?;
    let query = r#"
        PREFIX spatial: <urn:oxigraph:spatial:>
        PREFIX geo: <http://www.opengis.net/ont/geosparql#>
        PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
        SELECT ?s WHERE {
            SERVICE spatial:search:v1 {
                ?geometry spatial:geometry "POLYGON((0 0,4 0,4 4,0 4,0 0))"^^geo:wktLiteral;
                    spatial:relation geof:sfWithin; spatial:matched ?ok
            }
            ?s <urn:geometry> ?geometry
            FILTER(?ok)
        }
    "#;
    let result = SparqlEvaluator::new()
        .parse_query(query)?
        .on_spatial_index(
            store.derived_snapshot(&TransactionStartControl::new())?,
            &index,
            provider,
            limits,
        )
        .execute()?;
    let strict = result.context.applied.as_ref() == Some(&result.context.source);
    let QueryResults::Solutions(rows) = result.results else {
        return Err("SELECT expected".into());
    };
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    if !strict || rows.len() != 1 || rows[0].get("s") != Some(&NamedNode::new("urn:near")?.into()) {
        return Err("unexpected spatial SPARQL result".into());
    }
    writeln!(
        std::io::stdout().lock(),
        "reopened_spatial_join_rows={} rollback_absent=true strict={strict} subject={}",
        rows.len(),
        rows[0].get("s").ok_or("missing subject")?
    )?;
    Ok(())
}
#[cfg(not(unix))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("this example requires Unix native RocksDB support".into())
}
