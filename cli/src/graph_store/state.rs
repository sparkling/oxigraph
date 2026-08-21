use super::{State, Target};
use crate::{HttpError, internal_server_error};
use oxigraph::model::GraphName;
use oxigraph::store::{Store, Transaction};

pub(super) fn from_transaction(
    transaction: &Transaction<'_>,
    target: &Target,
) -> Result<State, HttpError> {
    let exists = match target {
        Target::Dataset | Target::DefaultGraph => true,
        Target::NamedGraph(graph) => transaction
            .contains_named_graph(&graph.clone().into())
            .map_err(internal_server_error)?,
    };
    let quads = match target {
        Target::Dataset => transaction.iter(),
        Target::DefaultGraph => {
            transaction.quads_for_pattern(None, None, None, Some(&GraphName::DefaultGraph))
        }
        Target::NamedGraph(graph) => {
            let graph_name = GraphName::from(graph.clone());
            transaction.quads_for_pattern(None, None, None, Some(&graph_name))
        }
    }
    .collect::<Result<Vec<_>, _>>()
    .map_err(internal_server_error)?;
    let named_graphs = if matches!(target, Target::Dataset) {
        transaction
            .named_graphs()
            .collect::<Result<Vec<_>, _>>()
            .map_err(internal_server_error)?
    } else {
        Vec::new()
    };
    Ok(State {
        exists,
        quads,
        named_graphs,
    })
}

pub(super) fn from_read_only_store(store: &Store, target: &Target) -> Result<State, HttpError> {
    // A disk-backed Store::open_read_only handle is an immutable RocksDB view, so
    // its targeted snapshots all observe the same state without a write transaction.
    let exists = match target {
        Target::Dataset | Target::DefaultGraph => true,
        Target::NamedGraph(graph) => store
            .contains_named_graph(&graph.clone().into())
            .map_err(internal_server_error)?,
    };
    let quads = match target {
        Target::Dataset => store.iter(),
        Target::DefaultGraph => {
            store.quads_for_pattern(None, None, None, Some(&GraphName::DefaultGraph))
        }
        Target::NamedGraph(graph) => {
            let graph_name = GraphName::from(graph.clone());
            store.quads_for_pattern(None, None, None, Some(&graph_name))
        }
    }
    .collect::<Result<Vec<_>, _>>()
    .map_err(internal_server_error)?;
    let named_graphs = if matches!(target, Target::Dataset) {
        store
            .named_graphs()
            .collect::<Result<Vec<_>, _>>()
            .map_err(internal_server_error)?
    } else {
        Vec::new()
    };
    Ok(State {
        exists,
        quads,
        named_graphs,
    })
}
