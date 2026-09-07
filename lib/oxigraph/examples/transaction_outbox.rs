//! Run with `cargo run --locked -p oxigraph --example transaction_outbox`.
//! Uses a process-local store; use Store::open for durable RocksDB replay.
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{
    OutboxCursor, OutboxRecord, Store, TransactionKey, TransactionRequest, WritableDataset,
};
use std::io::{self, Write};
use std::num::NonZeroUsize;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut output = io::stdout().lock();
    let store = Store::new()?;
    let mut transaction = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    let node = NamedNode::new("urn:example")?;
    transaction.insert(Quad::new(
        node.clone(),
        node.clone(),
        node,
        GraphName::DefaultGraph,
    ))?;
    let receipt = transaction.commit()?;
    writeln!(
        output,
        "Committed sequence {} with {} effect(s)",
        receipt.sequence(),
        receipt.effect_count()
    )?;
    let mut checkpoint: Option<[u8; 57]> = None;
    loop {
        let cursor = checkpoint
            .as_ref()
            .map(|bytes| OutboxCursor::from_bytes(bytes))
            .transpose()?;
        let batch = store.read_outbox(cursor.as_ref(), NonZeroUsize::MIN)?;
        if batch.records().is_empty() {
            break;
        }
        for record in batch.records() {
            match record {
                OutboxRecord::Commit { receipt, .. } => {
                    writeln!(output, "Header: sequence {}", receipt.sequence())?;
                }
                OutboxRecord::Event {
                    event_index,
                    change,
                    ..
                } => {
                    // An external sink must deduplicate (commit_id, event_index)
                    // and apply effects durably before saving the checkpoint.
                    if let oxigraph::store::SemanticChange::QuadAdded(quad) = change {
                        writeln!(output, "Event {event_index}: added {quad}")?;
                    } else {
                        writeln!(output, "Event {event_index}: semantic operation")?;
                    }
                }
                _ => (),
            }
            checkpoint = Some(record.cursor().to_bytes());
        }
    }
    Ok(())
}
