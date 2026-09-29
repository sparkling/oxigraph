use super::{
    KeyedTransaction, NegotiatedTransaction, NegotiatedTransactionalDataset, StorageError, Store,
    TransactionKey, TransactionRequest, TransactionStartControl, TransactionStartError,
};
use crate::model::{NamedNode, NamedOrBlankNode, Quad, Term};
use crate::storage::StorageTransactionStartError;
use std::error::Error;

/// A transaction-scoped RDF dataset that supports reads and writes.
///
/// This is the persistence-plane counterpart to
/// [`spareval::QueryableDataset`]. Implementations may use any physical
/// storage, but they must provide one coherent transactional view: reads made
/// through [`quads_for_pattern`](Self::quads_for_pattern) and
/// [`named_graphs`](Self::named_graphs) observe mutations already made by this
/// transaction.
///
/// Mutations are isolated from other readers until [`commit`](Self::commit)
/// succeeds. Dropping a transaction without committing must have the same
/// effect as [`rollback`](Self::rollback).
pub trait WritableDataset: Sized {
    /// Error returned by the persistence implementation.
    type Error: Error + Send + Sync + 'static;

    /// Iterator over matching quads in the transaction's current view.
    type Quads<'a>: Iterator<Item = Result<Quad, Self::Error>> + 'a
    where
        Self: 'a;

    /// Iterator over named graphs in the transaction's current view.
    ///
    /// Empty named graphs must be included.
    type NamedGraphs<'a>: Iterator<Item = Result<NamedOrBlankNode, Self::Error>> + 'a
    where
        Self: 'a;

    /// Retrieves quads matching a pattern.
    ///
    /// `graph_name` uses the same three-state convention as
    /// [`spareval::QueryableDataset`]: `Some(None)` selects the default graph,
    /// `Some(Some(graph_name))` selects one named graph, and `None` selects all
    /// named graphs but not the default graph.
    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a>;

    /// Returns all named graphs, including empty named graphs.
    fn named_graphs(&self) -> Self::NamedGraphs<'_>;

    /// Returns whether a named graph exists, including an empty graph.
    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error>;

    /// Inserts a quad into the transaction.
    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error>;

    /// Removes a quad from the transaction.
    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error>;

    /// Creates a named graph if it does not already exist.
    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error>;

    /// Removes every quad from a graph while retaining named-graph presence.
    ///
    /// The default graph always exists. Clearing a missing named graph is a
    /// no-op; protocol layers may perform an existence check when they need a
    /// different error policy.
    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error>;

    /// Clears every named graph while retaining their graph names.
    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error>;

    /// Clears the default graph and every named graph while retaining named
    /// graph presence.
    fn clear_all_graphs(&mut self) -> Result<(), Self::Error>;

    /// Removes a named graph and all of its quads.
    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error>;

    /// Removes all named graphs and their quads while leaving the default
    /// graph unchanged.
    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error>;

    /// Removes all quads and all named-graph topology.
    fn clear(&mut self) -> Result<(), Self::Error>;

    /// Atomically publishes every mutation made by this transaction.
    fn commit(self) -> Result<(), Self::Error>;

    /// Discards every mutation made by this transaction.
    fn rollback(self) -> Result<(), Self::Error>;
}

/// An RDF dataset capable of opening backend-neutral write transactions.
///
/// The returned transaction must satisfy the atomicity, isolation,
/// read-your-writes, graph-topology, and rollback guarantees documented by
/// [`WritableDataset`].
pub trait TransactionalDataset {
    /// Error returned while opening or operating on a transaction.
    type Error: Error + Send + Sync + 'static;

    /// A write transaction borrowing this dataset.
    type Transaction<'a>: WritableDataset<Error = Self::Error>
    where
        Self: 'a;

    /// Opens a new read/write transaction.
    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error>;
}

/// Opt-in extension for datasets that can hand out a transaction owning its
/// storage lifetime.
///
/// The owned transaction does not borrow the dataset that opened it and may
/// outlive it. It is not clonable, and `commit` and `rollback` consume it.
/// Dropping it before commit rolls back. Readers borrow the transaction, so
/// a reader cannot outlive a terminal call. Unmet requirements are rejected
/// before writer admission, admission observes the supplied bounded and
/// cancellable control, and the exact effective capabilities are returned.
///
/// Errors during a caller-managed evaluation, such as a failed SPARQL Update
/// bound to the owned transaction, may leave staged state behind. The caller
/// must roll back or drop the transaction to discard it; no savepoint or
/// per-update atomicity is implied.
///
/// [`TransactionalDataset`] and [`WritableDataset`] are unchanged, so existing
/// implementations remain source compatible without implementing this trait.
pub trait OwnedTransactionalDataset: NegotiatedTransactionalDataset {
    /// A write transaction that owns its storage lifetime.
    type OwnedTransaction: WritableDataset<Error = Self::Error> + 'static;

    /// Negotiates and opens an owned transaction with bounded, cancellable
    /// admission.
    fn start_owned_transaction_with_control(
        &self,
        request: TransactionRequest,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<Self::OwnedTransaction>, TransactionStartError<Self::Error>>;

    /// Negotiates and opens an owned transaction with unbounded admission.
    fn start_owned_transaction_with(
        &self,
        request: TransactionRequest,
    ) -> Result<NegotiatedTransaction<Self::OwnedTransaction>, TransactionStartError<Self::Error>>
    {
        self.start_owned_transaction_with_control(request, TransactionStartControl::new())
    }
}

impl Store {
    /// Opens a caller-keyed transaction that owns its storage lifetime, with
    /// unbounded admission.
    ///
    /// See [`Store::start_owned_transaction_with_key_and_control`].
    pub fn start_owned_transaction_with_key(
        &self,
        request: TransactionRequest,
        transaction_key: TransactionKey,
    ) -> Result<NegotiatedTransaction<KeyedTransaction<'static>>, TransactionStartError<StorageError>>
    {
        self.start_owned_transaction_with_key_and_control(
            request,
            transaction_key,
            TransactionStartControl::new(),
        )
    }

    /// Negotiates and opens a caller-keyed transaction that owns its storage
    /// lifetime, with bounded, cancellable admission.
    ///
    /// The handle is `'static`, not clonable, and may outlive this [`Store`].
    /// Unmet requirements are rejected before writer admission and before the
    /// key is reserved. Use the inherent `commit` and `rollback` of
    /// [`KeyedTransaction`] for typed outcomes, and resolve the key on a clone
    /// or reopened store with
    /// [`OutcomeAwareTransactionalDataset::lookup_transaction_outcome`](super::OutcomeAwareTransactionalDataset::lookup_transaction_outcome).
    #[expect(
        clippy::needless_pass_by_value,
        reason = "owned request/control matches the existing keyed admission API"
    )]
    pub fn start_owned_transaction_with_key_and_control(
        &self,
        request: TransactionRequest,
        transaction_key: TransactionKey,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<KeyedTransaction<'static>>, TransactionStartError<StorageError>>
    {
        let started_at = std::time::Instant::now();
        let effective = self.transaction_capabilities();
        let unmet = effective.unmet_requirements(request.requirements());
        if !unmet.is_empty() {
            return Err(TransactionStartError::RequirementsNotMet { unmet, effective });
        }
        let inner = self
            .storage
            .start_keyed_readable_transaction_with_control(
                transaction_key.as_bytes(),
                &control,
                started_at,
            )
            .map_err(|error| match error {
                StorageTransactionStartError::Cancelled => TransactionStartError::Cancelled,
                StorageTransactionStartError::TimedOut => TransactionStartError::TimedOut,
                StorageTransactionStartError::Backend(error) => {
                    TransactionStartError::Backend(error)
                }
            })?;
        Ok(NegotiatedTransaction::new(
            KeyedTransaction {
                inner,
                transaction_key,
            },
            effective,
        ))
    }
}
