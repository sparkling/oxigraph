//! cargo run --locked -p oxigraph --features shacl --example shacl_commit_gate
#![expect(
    clippy::print_stdout,
    reason = "runnable product journey prints its verified outcome"
)]
use oxigraph::model::{Dataset, GraphName, Literal, NamedNode, Quad, vocab};
use oxigraph::shacl::GraphSnapshot;
use oxigraph::store::{
    ShaclCommitError, ShaclCommitPolicy, ShaclGateError, ShaclGraphScope, ShaclReceiptOutcome,
    ShaclShapesSource, Store, TransactionKey, TransactionRequest, WritableDataset,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let subject = NamedNode::new("urn:subject")?;
    let predicate = NamedNode::new("urn:property")?;
    let shape = NamedNode::new("urn:shape")?;
    let sh = |name: &str| NamedNode::new(format!("http://www.w3.org/ns/shacl#{name}"));
    let dataset: Dataset = [
        Quad::new(
            shape.clone(),
            vocab::rdf::TYPE,
            sh("PropertyShape")?,
            GraphName::DefaultGraph,
        ),
        Quad::new(
            shape.clone(),
            sh("targetNode")?,
            subject.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            shape.clone(),
            sh("path")?,
            predicate.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            shape,
            sh("maxCount")?,
            Literal::from(1_u64),
            GraphName::DefaultGraph,
        ),
    ]
    .into_iter()
    .collect();
    let policy = ShaclCommitPolicy::new(
        vec![ShaclGraphScope {
            graph_name: GraphName::DefaultGraph,
            required: true,
        }],
        ShaclShapesSource::External(Box::new(GraphSnapshot::default_graph(dataset))),
    );
    let store = Store::new()?;
    let mut accepted = store
        .start_shacl_transaction(
            TransactionRequest::default(),
            TransactionKey::new([1; 16]),
            policy.clone(),
        )?
        .into_transaction();
    accepted.insert(Quad::new(
        subject.clone(),
        predicate.clone(),
        Literal::from(1_u64),
        GraphName::DefaultGraph,
    ))?;
    let report = accepted.commit()?;
    let ShaclReceiptOutcome::Validated(receipt) =
        store.lookup_shacl_receipt(report.receipt.transaction_key())?
    else {
        return Err("accepted transaction has no validation receipt".into());
    };
    if receipt.validation().policy() != &policy.descriptor()?
        || receipt.validation() != &report.validation
    {
        return Err("validation receipt does not match the selected policy".into());
    }
    let mut rejected = store
        .start_shacl_transaction(
            TransactionRequest::default(),
            TransactionKey::new([2; 16]),
            policy,
        )?
        .into_transaction();
    rejected.insert(Quad::new(
        subject,
        predicate,
        Literal::from(2_u64),
        GraphName::DefaultGraph,
    ))?;
    let invalid_rejected = matches!(
        rejected.commit(),
        Err(ShaclCommitError::Rejected {
            source: ShaclGateError::Nonconforming { .. },
            rollback: None,
            ..
        })
    );
    if !invalid_rejected || store.len()? != 1 {
        return Err("SHACL gate journey did not preserve exactly the valid write".into());
    }
    println!(
        "accepted_sequence={} policy_receipt_verified=true invalid_rejected={invalid_rejected} stored_quads={}",
        report.receipt.sequence(),
        store.len()?
    );
    Ok(())
}
