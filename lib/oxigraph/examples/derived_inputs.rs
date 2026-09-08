//! `cargo run --locked -p oxigraph --example derived_inputs`
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use oxigraph::model::{GraphName, NamedNode, Quad};
    use oxigraph::store::{
        ContributorCheckpoint, DerivedError, DerivedLimits, Store, TransactionKey,
        TransactionRequest, TransactionStartControl, WritableDataset,
    };
    use std::io::Write;
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path().join("primary"))?;
    let node = NamedNode::new("urn:derived-example")?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    tx.insert(Quad::new(
        node.clone(),
        node.clone(),
        node.clone(),
        GraphName::DefaultGraph,
    ))?;
    let first = tx.commit()?;
    let base = store.derived_snapshot(&TransactionStartControl::new())?;
    let scan = base.scan(&DerivedLimits::default(), |_| Ok(()))?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    tx.clear_graph(None)?;
    tx.commit()?;
    let target = store.derived_snapshot(&TransactionStartControl::new())?;
    let delta = target.delta(
        Some(&ContributorCheckpoint::new(first)?),
        &DerivedLimits::default(),
    )?;
    let invalidated = matches!(base.check_current(&store), Err(DerivedError::NotFresh));
    if !invalidated || scan.records() != 1 || delta.commits().len() != 1 {
        return Err("unexpected derived input result".into());
    }
    writeln!(
        std::io::stdout().lock(),
        "snapshot_records={} complete_delta_commits={} delta_records={} old_view_not_fresh={invalidated}",
        scan.records(),
        delta.commits().len(),
        delta.records()
    )?;
    Ok(())
}

#[cfg(not(all(not(target_family = "wasm"), feature = "rocksdb")))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("this example requires native RocksDB support".into())
}
