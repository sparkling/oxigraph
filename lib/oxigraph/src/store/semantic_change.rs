use super::{
    Namespace, NamespacePrefix, OutcomeAwareWritableDataset, TransactionCommitError,
    TransactionRollbackError, WritableDataset, WritableNamespaceRegistry,
};
use crate::model::{GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::error::Error;

/// One staged semantic effect, independent of physical storage indexes.
///
/// Clear/drop records summarize an operation without enumerating its removed
/// quads. Lifecycle records are ordering barriers, including operations on
/// existing empty graphs. These are not durable events or commit receipts.
#[derive(Clone, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum SemanticChange {
    QuadAdded(Quad),
    QuadRemoved(Quad),
    NamedGraphCreated(NamedOrBlankNode),
    GraphCleared(GraphName),
    NamedGraphDropped(NamedOrBlankNode),
    AllNamedGraphsCleared,
    AllGraphsCleared,
    AllNamedGraphsDropped,
    /// All RDF and named-graph topology were removed; namespaces are unchanged.
    DatasetCleared,
    NamespaceChanged {
        prefix: NamespacePrefix,
        before: Option<NamedNode>,
        after: Option<NamedNode>,
    },
    NamespacesCleared,
}

/// An immutable snapshot of normalized transaction effects, not a durable receipt.
///
/// Point effects cancel until a lifecycle boundary affects their graph or
/// namespace registry. Unrelated graph operations do not prevent cancellation.
/// Successful clear operations remain explicit even for an empty target; this
/// is not a globally minimal initial-to-final dataset diff.
/// Output preserves the first outstanding change's order; independent keys
/// are not sorted by hash order.
/// [`ChangeTrackingTransaction::changes`] returns pending effects, which may be
/// retained after rollback. SPARQL `execute_with_changes` returns effects only
/// after an acknowledged commit. The value itself carries no durable commit
/// identity, global order, or outcome attestation.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SemanticChangeSet {
    changes: Vec<SemanticChange>,
}

impl SemanticChangeSet {
    /// Returns the normalized effects in their retained operation order.
    pub fn as_slice(&self) -> &[SemanticChange] {
        &self.changes
    }

    /// Returns the number of point effects and lifecycle summaries.
    pub fn len(&self) -> usize {
        self.changes.len()
    }

    /// Returns whether capture has no outstanding effects or boundaries.
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }
}

/// A backend failure, or an attempt to reuse a failed tracking transaction.
#[derive(Debug, thiserror::Error)]
pub enum ChangeTrackingError<E: Error + 'static> {
    #[error("{0}")]
    Backend(#[source] E),
    #[error("a semantic-change mutation failed; roll back or drop the transaction")]
    Failed,
}

/// Opt-in semantic-change capture around an existing write transaction.
///
/// Only mutations made through this wrapper are captured. Wrap a fresh
/// transaction to capture its entire mutation history. Existing minimal write
/// traits, backends, autocommit, loaders, and transaction openers are unchanged.
/// Capture performs point reads to distinguish actual effects from no-op writes.
/// Memory grows with outstanding point effects and lifecycle boundaries, not
/// with the number of quads removed by a clear/drop operation. The backend may
/// still scan those quads to perform the operation itself.
///
/// Any failed mutation poisons capture: subsequent mutations, change snapshots,
/// and commit fail. Explicit rollback and drop remain available. A commit error
/// retains the underlying backend's ambiguity; this wrapper cannot resolve it.
/// There is no notification, durable feed, receipt, or commit-order guarantee.
///
/// ```
/// use oxigraph::model::{GraphName, NamedNode, Quad};
/// use oxigraph::store::{ChangeTrackingTransaction, SemanticChange, Store, WritableDataset};
///
/// let store = Store::new()?;
/// let node = NamedNode::new("urn:example")?;
/// let quad = Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph);
/// let mut transaction = ChangeTrackingTransaction::new(store.start_transaction()?);
/// transaction.insert(quad.clone())?;
/// assert_eq!(transaction.changes()?.as_slice(), &[SemanticChange::QuadAdded(quad)]);
/// transaction.commit()?;
/// # Ok::<_, Box<dyn std::error::Error>>(())
/// ```
#[must_use]
pub struct ChangeTrackingTransaction<T: WritableDataset> {
    inner: T,
    changes: ChangeSetBuilder,
    failed: bool,
}

impl<T: WritableDataset> ChangeTrackingTransaction<T> {
    /// Starts capture at the transaction's current view, without opening a new transaction.
    pub fn new(transaction: T) -> Self {
        Self {
            inner: transaction,
            changes: ChangeSetBuilder::default(),
            failed: false,
        }
    }

    /// Takes a snapshot of pending effects; it does not consume or commit them.
    pub fn changes(&self) -> Result<SemanticChangeSet, ChangeTrackingError<T::Error>> {
        self.ensure_active()?;
        Ok(self.changes.snapshot())
    }

    fn ensure_active(&self) -> Result<(), ChangeTrackingError<T::Error>> {
        if self.failed {
            Err(ChangeTrackingError::Failed)
        } else {
            Ok(())
        }
    }

    fn mutate(
        &mut self,
        operation: impl FnOnce(&mut T, &mut ChangeSetBuilder) -> Result<(), T::Error>,
    ) -> Result<(), ChangeTrackingError<T::Error>> {
        self.ensure_active()?;
        operation(&mut self.inner, &mut self.changes).map_err(|error| {
            self.failed = true;
            ChangeTrackingError::Backend(error)
        })
    }
}

impl<T: WritableDataset> WritableDataset for ChangeTrackingTransaction<T> {
    type Error = ChangeTrackingError<T::Error>;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Self::Error>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Self::Error>> + 'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        Box::new(
            self.inner
                .quads_for_pattern(subject, predicate, object, graph_name)
                .map(|quad| quad.map_err(ChangeTrackingError::Backend)),
        )
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        Box::new(
            self.inner
                .named_graphs()
                .map(|graph| graph.map_err(ChangeTrackingError::Backend)),
        )
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        self.inner
            .contains_named_graph(graph_name)
            .map_err(ChangeTrackingError::Backend)
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            let graph = named_graph(&quad.graph_name);
            let new_graph = graph
                .as_ref()
                .map(|graph| inner.contains_named_graph(graph))
                .transpose()?
                .is_some_and(|exists| !exists);
            let exists = contains_quad(inner, &quad)?;
            inner.insert(quad.clone())?;
            if new_graph {
                if let Some(graph) = graph {
                    changes.barrier(SemanticChange::NamedGraphCreated(graph));
                }
            }
            if !exists {
                changes.quad(quad, true);
            }
            Ok(())
        })
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            let exists = contains_quad(inner, quad)?;
            inner.remove(quad)?;
            if exists {
                changes.quad(quad.clone(), false);
            }
            Ok(())
        })
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            let exists = inner.contains_named_graph(&graph_name)?;
            inner.insert_named_graph(graph_name.clone())?;
            if !exists {
                changes.barrier(SemanticChange::NamedGraphCreated(graph_name));
            }
            Ok(())
        })
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            let exists = match graph_name {
                Some(graph) => inner.contains_named_graph(graph)?,
                None => true,
            };
            inner.clear_graph(graph_name)?;
            if exists {
                changes.barrier(SemanticChange::GraphCleared(
                    graph_name.map_or(GraphName::DefaultGraph, |graph| graph.clone().into()),
                ));
            }
            Ok(())
        })
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            inner.clear_all_named_graphs()?;
            changes.barrier(SemanticChange::AllNamedGraphsCleared);
            Ok(())
        })
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            inner.clear_all_graphs()?;
            changes.barrier(SemanticChange::AllGraphsCleared);
            Ok(())
        })
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            let exists = inner.contains_named_graph(graph_name)?;
            inner.remove_named_graph(graph_name)?;
            if exists {
                changes.barrier(SemanticChange::NamedGraphDropped(graph_name.clone()));
            }
            Ok(())
        })
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            inner.remove_all_named_graphs()?;
            changes.barrier(SemanticChange::AllNamedGraphsDropped);
            Ok(())
        })
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            inner.clear()?;
            changes.barrier(SemanticChange::DatasetCleared);
            Ok(())
        })
    }

    fn commit(self) -> Result<(), Self::Error> {
        self.ensure_active()?;
        self.inner.commit().map_err(ChangeTrackingError::Backend)
    }

    fn rollback(self) -> Result<(), Self::Error> {
        self.inner.rollback().map_err(ChangeTrackingError::Backend)
    }
}

impl<T: OutcomeAwareWritableDataset> OutcomeAwareWritableDataset for ChangeTrackingTransaction<T> {
    fn commit_with_outcome(self) -> Result<(), TransactionCommitError<Self::Error>> {
        self.ensure_active()
            .map_err(TransactionCommitError::Rejected)?;
        self.inner
            .commit_with_outcome()
            .map_err(|error| match error {
                TransactionCommitError::Rejected(error) => {
                    TransactionCommitError::Rejected(ChangeTrackingError::Backend(error))
                }
                TransactionCommitError::Conflicted => TransactionCommitError::Conflicted,
                TransactionCommitError::Cancelled => TransactionCommitError::Cancelled,
                TransactionCommitError::Indeterminate {
                    transaction_key,
                    source,
                } => TransactionCommitError::Indeterminate {
                    transaction_key,
                    source: ChangeTrackingError::Backend(source),
                },
            })
    }

    fn rollback_with_outcome(self) -> Result<(), TransactionRollbackError<Self::Error>> {
        self.inner
            .rollback_with_outcome()
            .map_err(|error| match error {
                TransactionRollbackError::Failed(error) => {
                    TransactionRollbackError::Failed(ChangeTrackingError::Backend(error))
                }
            })
    }
}

impl<T: WritableNamespaceRegistry> WritableNamespaceRegistry for ChangeTrackingTransaction<T> {
    type Namespaces<'a>
        = Box<dyn Iterator<Item = Result<Namespace, Self::Error>> + 'a>
    where
        Self: 'a;

    fn namespaces(&self) -> Self::Namespaces<'_> {
        Box::new(
            self.inner
                .namespaces()
                .map(|namespace| namespace.map_err(ChangeTrackingError::Backend)),
        )
    }

    fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, Self::Error> {
        self.inner
            .namespace(prefix)
            .map_err(ChangeTrackingError::Backend)
    }

    fn set_namespace(&mut self, namespace: Namespace) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            let before = inner
                .namespace(namespace.prefix())?
                .map(|value| value.into_parts().1);
            inner.set_namespace(namespace.clone())?;
            let (prefix, after) = namespace.into_parts();
            changes.namespace(prefix, before, Some(after));
            Ok(())
        })
    }

    fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            let before = inner.namespace(prefix)?.map(|value| value.into_parts().1);
            inner.remove_namespace(prefix)?;
            changes.namespace(prefix.clone(), before, None);
            Ok(())
        })
    }

    fn clear_namespaces(&mut self) -> Result<(), Self::Error> {
        self.mutate(|inner, changes| {
            let nonempty = inner.namespaces().next().transpose()?.is_some();
            inner.clear_namespaces()?;
            if nonempty {
                changes.barrier(SemanticChange::NamespacesCleared);
            }
            Ok(())
        })
    }
}

fn named_graph(graph: &GraphName) -> Option<NamedOrBlankNode> {
    match graph {
        GraphName::NamedNode(node) => Some(node.clone().into()),
        GraphName::BlankNode(node) => Some(node.clone().into()),
        GraphName::DefaultGraph => None,
    }
}

fn contains_quad<T: WritableDataset>(transaction: &T, quad: &Quad) -> Result<bool, T::Error> {
    transaction
        .quads_for_pattern(
            Some(&quad.subject),
            Some(&quad.predicate),
            Some(&quad.object),
            Some(named_graph(&quad.graph_name).as_ref()),
        )
        .next()
        .transpose()
        .map(|quad| quad.is_some())
}

#[derive(Eq, Hash, PartialEq)]
enum ChangeKey {
    Quad(Quad),
    Namespace(NamespacePrefix),
}

#[derive(Default)]
struct ChangeSetBuilder {
    sealed: Vec<(usize, SemanticChange)>,
    pending: HashMap<ChangeKey, (usize, SemanticChange)>,
    sequence: usize,
}

impl ChangeSetBuilder {
    fn quad(&mut self, quad: Quad, added: bool) {
        match self.pending.entry(ChangeKey::Quad(quad.clone())) {
            Entry::Occupied(entry) => {
                // Only actual changes reach this method, so a second effect
                // on the same quad necessarily reverses the first one.
                entry.remove();
            }
            Entry::Vacant(entry) => {
                entry.insert((
                    self.sequence,
                    if added {
                        SemanticChange::QuadAdded(quad)
                    } else {
                        SemanticChange::QuadRemoved(quad)
                    },
                ));
                self.sequence += 1;
            }
        }
    }

    fn namespace(
        &mut self,
        prefix: NamespacePrefix,
        before: Option<NamedNode>,
        after: Option<NamedNode>,
    ) {
        if before == after {
            return;
        }
        match self.pending.entry(ChangeKey::Namespace(prefix.clone())) {
            Entry::Occupied(mut entry) => {
                if let SemanticChange::NamespaceChanged {
                    before,
                    after: latest,
                    ..
                } = &mut entry.get_mut().1
                {
                    if before == &after {
                        entry.remove();
                    } else {
                        *latest = after;
                    }
                }
            }
            Entry::Vacant(entry) => {
                entry.insert((
                    self.sequence,
                    SemanticChange::NamespaceChanged {
                        prefix,
                        before,
                        after,
                    },
                ));
                self.sequence += 1;
            }
        }
    }

    fn barrier(&mut self, change: SemanticChange) {
        self.pending.retain(|key, value| {
            if change.affects(key) {
                self.sealed.push(value.clone());
                false
            } else {
                true
            }
        });
        self.sealed.push((self.sequence, change));
        self.sequence += 1;
    }

    fn snapshot(&self) -> SemanticChangeSet {
        let mut ordered: Vec<_> = self.sealed.iter().chain(self.pending.values()).collect();
        ordered.sort_unstable_by_key(|(index, _)| *index);
        SemanticChangeSet {
            changes: ordered
                .into_iter()
                .map(|(_, change)| change.clone())
                .collect(),
        }
    }
}

impl SemanticChange {
    fn affects(&self, key: &ChangeKey) -> bool {
        match (self, key) {
            (Self::NamespacesCleared, ChangeKey::Namespace(_))
            | (Self::AllGraphsCleared | Self::DatasetCleared, ChangeKey::Quad(_)) => true,
            (Self::GraphCleared(graph), ChangeKey::Quad(quad)) => graph == &quad.graph_name,
            (
                Self::NamedGraphCreated(graph) | Self::NamedGraphDropped(graph),
                ChangeKey::Quad(quad),
            ) => named_graph(&quad.graph_name).as_ref() == Some(graph),
            (Self::AllNamedGraphsCleared | Self::AllNamedGraphsDropped, ChangeKey::Quad(quad)) => {
                !quad.graph_name.is_default_graph()
            }
            _ => false,
        }
    }
}
