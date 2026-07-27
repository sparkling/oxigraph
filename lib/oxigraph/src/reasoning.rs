//! Snapshot-based semantic evaluation and explicit Datalog materialization.
#![warn(missing_docs)]

use crate::model::Dataset;
#[cfg(any(feature = "datalog", feature = "shacl"))]
use crate::model::GraphName;
#[cfg(feature = "datalog")]
use crate::model::{NamedOrBlankNode, Quad};
#[cfg(feature = "datalog")]
use crate::store::Transaction;
use crate::store::{StorageError, Store};
#[cfg(feature = "datalog")]
use oxdatalog::rdf::{RdfClosure, RdfEvaluationError};
#[cfg(feature = "datalog")]
use oxdatalog::{EvaluationOptions, Program, Rule};

fn store_snapshot(store: &Store) -> Result<Dataset, StorageError> {
    store.snapshot_contents().map(|(dataset, _)| dataset)
}

#[cfg(feature = "datalog")]
fn transaction_snapshot(transaction: &Transaction<'_>) -> Result<Dataset, StorageError> {
    let mut dataset = transaction.iter().collect::<Result<Dataset, _>>()?;
    for graph_name in transaction.named_graphs() {
        dataset.insert_named_graph(graph_name?);
    }
    Ok(dataset)
}

/// Failure while evaluating or materializing a Datalog program over a Store.
#[cfg(feature = "datalog")]
#[derive(Debug, thiserror::Error)]
pub enum StoreReasoningError {
    /// The Store snapshot, transaction, or commit failed.
    #[error(transparent)]
    Storage(#[from] StorageError),
    /// Datalog validation or evaluation failed.
    #[error(transparent)]
    Evaluation(#[from] RdfEvaluationError),
    /// A run-once D2 program cannot be replayed as incremental graph inserts.
    #[error(
        "Datalog D2 run-once programs require an owned-graph replacement policy and cannot be incrementally materialized"
    )]
    D2MaterializationRequiresOwnedGraph,
}

/// Evidence from one explicit Datalog materialization transaction.
#[cfg(feature = "datalog")]
#[derive(Clone, Debug)]
pub struct MaterializationReceipt {
    target_graph: NamedOrBlankNode,
    inferred_quads: usize,
    inserted_quads: usize,
}

#[cfg(feature = "datalog")]
impl MaterializationReceipt {
    /// Returns the named graph that received the inferred quads.
    pub fn target_graph(&self) -> &NamedOrBlankNode {
        &self.target_graph
    }

    /// Returns the number of distinct inferred quads considered for insertion.
    pub fn inferred_quads(&self) -> usize {
        self.inferred_quads
    }

    /// Returns the number of inferred quads that were not already present.
    pub fn inserted_quads(&self) -> usize {
        self.inserted_quads
    }

    /// Serializes the receipt in a deterministic, line-oriented form.
    pub fn canonical_text(&self) -> String {
        format!(
            "target-graph={}\ninferred-quads={}\ninserted-quads={}\n",
            self.target_graph, self.inferred_quads, self.inserted_quads
        )
    }
}

/// Evaluates a Datalog program against one repeatable-read Store snapshot.
///
/// The returned closure owns its base snapshot and a separate inference graph.
/// This function never writes to the Store.
#[cfg(feature = "datalog")]
pub fn evaluate_store(
    store: &Store,
    program: &Program,
    options: &EvaluationOptions,
) -> Result<RdfClosure, StoreReasoningError> {
    Ok(oxdatalog::rdf::evaluate(
        program,
        &store_snapshot(store)?,
        options,
    )?)
}

/// Atomically materializes Datalog D0/D1 inferred triples into a named graph.
///
/// Inferred graph names are replaced by `target_graph`; callers cannot mutate
/// the default or source graphs accidentally. Evaluation reads from the same
/// repeatable-read transaction used for the write batch. This is one-shot
/// materialization, not serializable truth maintenance. D2 fails closed
/// because evaluation-scoped generated blank nodes cannot be replayed safely
/// through incremental insertion.
#[cfg(feature = "datalog")]
pub fn materialize_to_graph(
    store: &Store,
    program: &Program,
    target_graph: NamedOrBlankNode,
    options: &EvaluationOptions,
) -> Result<MaterializationReceipt, StoreReasoningError> {
    if program.rules().iter().any(Rule::is_run_once) {
        return Err(StoreReasoningError::D2MaterializationRequiresOwnedGraph);
    }
    let mut transaction = store.start_transaction()?;
    let snapshot = transaction_snapshot(&transaction)?;
    let closure = oxdatalog::rdf::evaluate(program, &snapshot, options)?;
    let mut quads = Dataset::new();
    for quad in closure.inference() {
        quads.insert(Quad::new(
            quad.subject,
            quad.predicate,
            quad.object,
            GraphName::from(target_graph.clone()),
        ));
    }
    let inferred_quads = quads.len();
    transaction.insert_named_graph(target_graph.clone());
    let mut inserted_quads = 0;
    for quad in &quads {
        if !transaction.contains(&quad)? {
            inserted_quads += 1;
        }
        transaction.insert(quad);
    }
    transaction.commit()?;
    Ok(MaterializationReceipt {
        target_graph,
        inferred_quads,
        inserted_quads,
    })
}

/// Failure while evaluating finite RDFS 1.2 over a Store snapshot.
#[cfg(feature = "rdfs")]
#[derive(Debug, thiserror::Error)]
pub enum StoreRdfsError {
    /// Reading the Store snapshot failed.
    #[error(transparent)]
    Storage(#[from] StorageError),
    /// Finite RDFS evaluation failed.
    #[error(transparent)]
    Evaluation(#[from] oxrdfs::Rdfs12Error),
}

/// Evaluates the 15-pattern finite active-vocabulary RDFS 1.2 profile without
/// writing.
///
/// Oxigraph's `rdfs` feature enables `rdf-12`, so this Store adapter never
/// silently selects the separate 14-pattern RDF 1.2 Basic profile. Consumers
/// that need that Basic build can depend on `oxrdfs` directly without its
/// `rdf-12` feature.
#[cfg(feature = "rdfs")]
pub fn evaluate_store_rdfs12(
    store: &Store,
    options: &oxrdfs::Rdfs12Options,
) -> Result<oxrdfs::Rdfs12Closure, StoreRdfsError> {
    Ok(oxrdfs::Rdfs12Finite.evaluate(&store_snapshot(store)?, options)?)
}

/// Failure while evaluating OWL 2 RL/RDF over a Store snapshot.
#[cfg(feature = "owl2-rl")]
#[derive(Debug, thiserror::Error)]
pub enum StoreOwl2RlError {
    /// Reading the Store snapshot failed.
    #[error(transparent)]
    Storage(#[from] StorageError),
    /// OWL 2 RL/RDF evaluation failed.
    #[error(transparent)]
    Evaluation(#[from] oxowl::Owl2RlRdfError),
}

/// Evaluates the bounded OWL 2 RL/RDF engine without writing to the Store.
#[cfg(feature = "owl2-rl")]
pub fn evaluate_store_owl2_rl(
    store: &Store,
    options: &oxowl::Owl2RlRdfOptions,
) -> Result<oxowl::Owl2RlRdfClosure, StoreOwl2RlError> {
    Ok(oxowl::Owl2RlRdf.evaluate(&store_snapshot(store)?, options)?)
}

/// Failure while validating one Store graph with a compiled SHACL profile.
#[cfg(feature = "shacl")]
#[derive(Debug, thiserror::Error)]
pub enum StoreShaclError {
    /// Reading the Store snapshot failed.
    #[error(transparent)]
    Storage(#[from] StorageError),
    /// Compiling or evaluating the selected SHACL profile failed.
    #[error(transparent)]
    Validation(#[from] oxshacl::ValidationError),
}

/// Validates one graph from a stable Store snapshot without writing.
#[cfg(feature = "shacl")]
pub fn validate_store_graph(
    store: &Store,
    graph_name: GraphName,
    shapes: &oxshacl::ShapesGraph,
    options: &oxshacl::ValidationOptions,
) -> Result<oxshacl::ValidationReport, StoreShaclError> {
    let snapshot = oxshacl::GraphSnapshot::new(store_snapshot(store)?, graph_name);
    Ok(oxshacl::validate(shapes, &snapshot, options)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NamedNode;

    #[test]
    fn store_snapshot_preserves_empty_named_graph_topology() {
        let store = Store::new().unwrap();
        let graph = NamedNode::new("urn:test:empty-snapshot").unwrap();
        store.insert_named_graph(graph.clone()).unwrap();

        assert!(store_snapshot(&store).unwrap().contains_named_graph(&graph));
    }

    #[cfg(feature = "datalog")]
    #[test]
    fn transaction_snapshot_preserves_empty_named_graph_topology() {
        let store = Store::new().unwrap();
        let graph = NamedNode::new("urn:test:empty-transaction-snapshot").unwrap();
        let mut transaction = store.start_transaction().unwrap();
        transaction.insert_named_graph(graph.clone());

        assert!(
            transaction_snapshot(&transaction)
                .unwrap()
                .contains_named_graph(&graph)
        );
    }
}
