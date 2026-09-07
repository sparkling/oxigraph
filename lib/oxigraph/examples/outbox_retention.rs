//! `cargo run --locked -p oxigraph --example outbox_retention`
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{
    GovernanceTime, OutboxRetentionPolicy, Store, TransactionKey, TransactionRequest,
    WritableDataset,
};
use std::io::Write;
use std::num::{NonZeroU16, NonZeroU64, NonZeroUsize};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    let now = GovernanceTime::now()?;
    store.configure_outbox_retention(
        OutboxRetentionPolicy::new(NonZeroU64::new(100).ok_or("zero cap")?, NonZeroU16::MIN)?,
        now,
    )?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    let node = NamedNode::new("urn:retention-example")?;
    let quad = Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph);
    tx.insert(quad.clone())?;
    let receipt = tx.commit()?;
    let high = receipt.outbox_end_cursor().ok_or("missing outbox range")?;
    let lease = store.acquire_outbox_lease(
        [1; 16],
        None,
        GovernanceTime::from_unix_millis(
            now.as_unix_millis()
                .checked_add(60_000)
                .ok_or("clock overflow")?,
        ),
        now,
    )?;
    let pinned = store.maintain_outbox(&high, NonZeroUsize::MIN, now)?;
    store.release_outbox_lease(lease.token(), now)?;
    let expired = store.maintain_outbox(&high, NonZeroUsize::MIN, now)?;
    let cleaned = store.maintain_outbox(&high, NonZeroUsize::MIN, now)?;
    writeln!(
        std::io::stdout().lock(),
        "lease_pinned={} expired_sequence={} cleanup_records={} primary_retained={} physical_records={}",
        pinned.pinned_by_lease(),
        expired
            .expired_receipt_sequence()
            .ok_or("receipt did not expire")?,
        expired.removed_records() + cleaned.removed_records(),
        store.contains(&quad)?,
        store
            .governance_health(now, NonZeroUsize::MIN)?
            .physical_records()
    )?;
    Ok(())
}
