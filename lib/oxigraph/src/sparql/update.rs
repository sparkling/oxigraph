#[cfg(feature = "http-client")]
use crate::http::{EgressError, EgressErrorKind, HttpClient, find_egress_error};
#[cfg(feature = "http-client")]
use crate::io::DocumentLoader;
#[cfg(feature = "http-client")]
use crate::io::RdfParser;
use crate::model::{
    Dataset as OxDataset, GraphName as OxGraphName, NamedOrBlankNode as OxNamedOrBlankNode,
    Quad as OxQuad, Term as OxTerm,
};
use crate::sparql::dataset::DatasetView;
use crate::sparql::error::UpdateEvaluationError;
use crate::storage::{Storage, StorageTransaction};
use crate::store::evaluation_metrics::EvaluationObservation;
use crate::store::{
    ChangeTrackingError, ChangeTrackingTransaction, EvaluationOperation,
    NegotiatedTransactionalDataset, OutcomeAwareTransactionalDataset, OutcomeAwareWritableDataset,
    SemanticChangeSet, Store, Transaction, TransactionCommitError, TransactionKey,
    TransactionRequest, TransactionStartControl, TransactionStartError, TransactionalDataset,
    WritableDataset,
};
use oxiri::Iri;
use oxstr::OxString;
use rustc_hash::FxHashMap;
use spareval::{
    CancellationToken, DeleteInsertQuad, InternalQuad, QueryDatasetSpecification, QueryEvaluator,
    QueryableDataset,
};
use spargebra::SparqlVersion;
use spargebra::algebra::GraphTarget;
use spargebra::term::{BlankNode, GraphName, GroundQuad, GroundTerm, NamedOrBlankNode, Quad, Term};
#[cfg(feature = "rdf-12")]
use spargebra::term::{GroundTriple, Triple};
use spargebra::update::{
    ClearOperation, CreateOperation, DeleteDataOperation, DeleteInsertOperation, DropOperation,
    GraphUpdateOperation, InsertDataOperation, LoadOperation, Update,
};

/// A prepared SPARQL update.
///
/// Usage example:
/// ```
/// use oxigraph::sparql::SparqlEvaluator;
/// use oxigraph::store::Store;
///
/// let prepared_update = SparqlEvaluator::new().parse_update(
///     "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
/// )?;
/// prepared_update.on_store(&Store::new()?).execute()?;
/// # Ok::<_, Box<dyn std::error::Error>>(())
/// ```
#[derive(Clone)]
#[must_use]
pub struct PreparedSparqlUpdate {
    evaluator: QueryEvaluator,
    update: Update,
    using_datasets: Vec<Option<QueryDatasetSpecification>>,
    cancellation_token: Option<CancellationToken>,
    #[cfg(feature = "http-client")]
    client: HttpClient,
    #[cfg(feature = "http-client")]
    service_client: Option<HttpClient>,
}

impl PreparedSparqlUpdate {
    /// The SPARQL semantic feature mode used during evaluation.
    #[inline]
    pub fn version(&self) -> SparqlVersion {
        self.evaluator.version()
    }

    pub(crate) fn new(
        evaluator: QueryEvaluator,
        update: Update,
        cancellation_token: Option<CancellationToken>,
        #[cfg(feature = "http-client")] client: HttpClient,
        #[cfg(feature = "http-client")] service_client: Option<HttpClient>,
    ) -> Self {
        let using_datasets = update
            .operations
            .iter()
            .map(|operation| {
                if let GraphUpdateOperation::DeleteInsert(operation) = operation {
                    Some(operation.using.clone().map(Into::into).unwrap_or_default())
                } else {
                    None
                }
            })
            .collect();
        Self {
            evaluator,
            update,
            using_datasets,
            cancellation_token,
            #[cfg(feature = "http-client")]
            client,
            #[cfg(feature = "http-client")]
            service_client,
        }
    }

    /// Returns [the query dataset specification](https://www.w3.org/TR/sparql11-query/#specifyingDataset) in [DELETE/INSERT operations](https://www.w3.org/TR/sparql11-update/#deleteInsert).
    #[inline]
    pub fn using_datasets(&self) -> impl Iterator<Item = &QueryDatasetSpecification> {
        self.using_datasets.iter().filter_map(Option::as_ref)
    }

    /// Returns [the query dataset specification](https://www.w3.org/TR/sparql11-query/#specifyingDataset) in [DELETE/INSERT operations](https://www.w3.org/TR/sparql11-update/#deleteInsert).
    #[inline]
    pub fn using_datasets_mut(&mut self) -> impl Iterator<Item = &mut QueryDatasetSpecification> {
        self.using_datasets.iter_mut().filter_map(Option::as_mut)
    }

    /// Bind the prepared update to the [`Store`] it should be evaluated on.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::sparql::SparqlEvaluator;
    /// use oxigraph::store::Store;
    ///
    /// let prepared_update = SparqlEvaluator::new().parse_update(
    ///     "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
    /// )?;
    /// prepared_update.on_store(&Store::new()?).execute()?;
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    #[cfg_attr(not(feature = "http-client"), expect(unused_mut))]
    pub fn on_store(mut self, store: &Store) -> BoundPreparedSparqlUpdate<'_, '_> {
        let observation = store.start_evaluation_observation(EvaluationOperation::Update);
        #[cfg(feature = "http-client")]
        {
            self.evaluator =
                super::bind_store_service(self.evaluator, self.service_client.take(), store);
            self.client = self
                .client
                .with_policy_metrics(store.policy_metrics_state());
        }
        let transaction = (|| {
            ensure_update_start_alive(
                &self.update,
                self.cancellation_token.as_ref(),
                #[cfg(feature = "http-client")]
                &self.client,
            )?;
            if let Some(cancellation_token) = &self.cancellation_token {
                store
                    .start_transaction_with_control(
                        TransactionRequest::default(),
                        TransactionStartControl::new()
                            .with_cancellation_token(cancellation_token.clone()),
                    )
                    .map(|transaction| {
                        UpdateTransaction::OwnedReadable(transaction.into_transaction())
                    })
                    .map_err(update_transaction_start_error)
            } else if update_requires_read(&self.update) {
                store
                    .start_transaction()
                    .map(UpdateTransaction::OwnedReadable)
                    .map_err(UpdateEvaluationError::from)
            } else {
                let storage = store.storage();
                storage
                    .start_transaction()
                    .map(|transaction| UpdateTransaction::Owned(transaction, storage))
                    .map_err(UpdateEvaluationError::from)
            }
        })();
        BoundPreparedSparqlUpdate {
            evaluator: self.evaluator,
            update: self.update,
            using_datasets: self.using_datasets,
            cancellation_token: self.cancellation_token,
            #[cfg(feature = "http-client")]
            client: self.client,
            transaction,
            observation: Some(observation),
        }
    }

    /// Binds this update to a backend-neutral [`TransactionalDataset`].
    ///
    /// The complete update request is evaluated in one transaction. A
    /// successful evaluation is committed atomically; any evaluation failure
    /// is rolled back before it is returned.
    ///
    /// ```
    /// use oxigraph::sparql::SparqlEvaluator;
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    /// SparqlEvaluator::new()
    ///     .parse_update(
    ///         "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
    ///     )?
    ///     .on_dataset(&store)
    ///     .execute()?;
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    pub fn on_dataset<D: TransactionalDataset>(
        self,
        dataset: &D,
    ) -> BoundTransactionalSparqlUpdate<'_, D> {
        BoundTransactionalSparqlUpdate {
            evaluator: self.evaluator,
            update: self.update,
            using_datasets: self.using_datasets,
            cancellation_token: self.cancellation_token,
            #[cfg(feature = "http-client")]
            client: self.client,
            dataset,
        }
    }

    /// Binds this update to a capability-negotiating transactional dataset.
    ///
    /// The request is checked before a transaction is opened. Admission uses
    /// this evaluator's cancellation token, and failures after admission are
    /// explicitly rolled back before they are returned.
    pub fn on_dataset_with_request<D: NegotiatedTransactionalDataset>(
        self,
        dataset: &D,
        request: TransactionRequest,
    ) -> BoundNegotiatedSparqlUpdate<'_, D> {
        BoundNegotiatedSparqlUpdate {
            evaluator: self.evaluator,
            update: self.update,
            using_datasets: self.using_datasets,
            cancellation_token: self.cancellation_token,
            #[cfg(feature = "http-client")]
            client: self.client,
            dataset,
            request,
        }
    }

    /// Binds this update to one caller-keyed, outcome-aware transaction.
    ///
    /// Admission uses this evaluator's cancellation token. Commit failures
    /// preserve their typed outcome and key in the error source chain; the
    /// request is never replayed to resolve an uncertain outcome.
    pub fn on_dataset_with_key<D: OutcomeAwareTransactionalDataset>(
        self,
        dataset: &D,
        request: TransactionRequest,
        key: TransactionKey,
    ) -> BoundKeyedSparqlUpdate<'_, D> {
        BoundKeyedSparqlUpdate {
            prepared: self,
            dataset,
            request,
            key,
        }
    }

    fn execute_with_changes_on<T: WritableDataset>(
        self,
        transaction: T,
        commit: impl FnOnce(ChangeTrackingTransaction<T>) -> Result<(), UpdateEvaluationError>,
        rollback: impl FnOnce(
            ChangeTrackingTransaction<T>,
        ) -> Result<(), Box<dyn std::error::Error + Send + Sync>>,
    ) -> Result<SemanticChangeSet, UpdateEvaluationError> {
        let mut transaction = ChangeTrackingTransaction::new(transaction);
        let result = (|| {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            ReadableUpdateEvaluator {
                transaction: &mut transaction,
                base_iri: self.update.base_iri.clone(),
                query_evaluator: self.evaluator,
                cancellation_token: self.cancellation_token.clone(),
                #[cfg(feature = "http-client")]
                client: self.client,
            }
            .eval_all(&self.update.operations, &self.using_datasets)
            .map_err(unwrap_tracking_error::<T::Error>)?;
            let changes = transaction.changes().map_err(tracking_error)?;
            ensure_update_alive(self.cancellation_token.as_ref())?;
            Ok(changes)
        })();
        match result {
            Ok(changes) => {
                commit(transaction)?;
                Ok(changes)
            }
            Err(update) => match rollback(transaction) {
                Ok(()) => Err(update),
                Err(rollback) => Err(UpdateEvaluationError::Unexpected(Box::new(
                    UpdateRollbackError { update, rollback },
                ))),
            },
        }
    }

    /// Bind the prepared update to the [`Transaction`] it should be evaluated on.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::sparql::SparqlEvaluator;
    /// use oxigraph::store::Store;
    ///
    /// let prepared_update = SparqlEvaluator::new().parse_update(
    ///     "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
    /// )?;
    /// let store = Store::new()?;
    /// let mut transaction = store.start_transaction()?;
    /// prepared_update.on_transaction(&mut transaction).execute()?;
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    pub fn on_transaction<'a, 'b: 'a>(
        self,
        transaction: &'a mut Transaction<'b>,
    ) -> BoundPreparedSparqlUpdate<'a, 'b> {
        let transaction = ensure_update_start_alive(
            &self.update,
            self.cancellation_token.as_ref(),
            #[cfg(feature = "http-client")]
            &self.client,
        )
        .map(|()| UpdateTransaction::BorrowedReadable(transaction));
        BoundPreparedSparqlUpdate {
            evaluator: self.evaluator,
            update: self.update,
            using_datasets: self.using_datasets,
            cancellation_token: self.cancellation_token,
            #[cfg(feature = "http-client")]
            client: self.client,
            transaction,
            observation: None,
        }
    }
}

/// A prepared SPARQL update bound to a backend-neutral transactional dataset.
#[must_use]
pub struct BoundTransactionalSparqlUpdate<'a, D: TransactionalDataset> {
    evaluator: QueryEvaluator,
    update: Update,
    using_datasets: Vec<Option<QueryDatasetSpecification>>,
    cancellation_token: Option<CancellationToken>,
    #[cfg(feature = "http-client")]
    client: HttpClient,
    dataset: &'a D,
}

impl<D: TransactionalDataset> BoundTransactionalSparqlUpdate<'_, D> {
    /// Atomically evaluates the whole request and returns normalized effects
    /// only after successful commit. The result is not a durable receipt/feed.
    /// Evaluation failure rolls back; a commit error is never retried.
    ///
    /// ```
    /// use oxigraph::sparql::SparqlEvaluator;
    /// use oxigraph::store::{SemanticChange, Store};
    /// let store = Store::new()?;
    /// let changes = SparqlEvaluator::new()
    ///     .parse_update("CREATE GRAPH <urn:example:graph>")?
    ///     .on_dataset(&store)
    ///     .execute_with_changes()?;
    /// assert!(matches!(changes.as_slice(), [SemanticChange::NamedGraphCreated(_)]));
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    pub fn execute_with_changes(self) -> Result<SemanticChangeSet, UpdateEvaluationError> {
        ensure_update_start_alive(
            &self.update,
            self.cancellation_token.as_ref(),
            #[cfg(feature = "http-client")]
            &self.client,
        )?;
        let transaction = self
            .dataset
            .start_transaction()
            .map_err(UpdateEvaluationError::dataset)?;
        PreparedSparqlUpdate {
            evaluator: self.evaluator,
            update: self.update,
            using_datasets: self.using_datasets,
            cancellation_token: self.cancellation_token,
            #[cfg(feature = "http-client")]
            client: self.client,
            #[cfg(feature = "http-client")]
            service_client: None,
        }
        .execute_with_changes_on(
            transaction,
            |transaction| transaction.commit().map_err(tracking_error),
            |transaction| transaction.rollback().map_err(Into::into),
        )
    }

    /// Evaluates and atomically commits the update.
    pub fn execute(self) -> Result<(), UpdateEvaluationError> {
        ensure_update_start_alive(
            &self.update,
            self.cancellation_token.as_ref(),
            #[cfg(feature = "http-client")]
            &self.client,
        )?;
        let mut transaction = self
            .dataset
            .start_transaction()
            .map_err(UpdateEvaluationError::dataset)?;
        let result = (|| {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            ReadableUpdateEvaluator {
                transaction: &mut transaction,
                base_iri: self.update.base_iri.clone(),
                query_evaluator: self.evaluator,
                cancellation_token: self.cancellation_token.clone(),
                #[cfg(feature = "http-client")]
                client: self.client,
            }
            .eval_all(&self.update.operations, &self.using_datasets)?;
            ensure_update_alive(self.cancellation_token.as_ref())
        })();
        match result {
            Ok(()) => transaction.commit().map_err(UpdateEvaluationError::dataset),
            Err(error) => match transaction.rollback() {
                Ok(()) => Err(error),
                Err(rollback) => Err(UpdateEvaluationError::Unexpected(Box::new(
                    UpdateRollbackError {
                        update: error,
                        rollback: Box::new(rollback),
                    },
                ))),
            },
        }
    }
}

/// A prepared SPARQL update bound to a capability-negotiating transactional
/// dataset.
#[must_use]
pub struct BoundNegotiatedSparqlUpdate<'a, D: NegotiatedTransactionalDataset> {
    evaluator: QueryEvaluator,
    update: Update,
    using_datasets: Vec<Option<QueryDatasetSpecification>>,
    cancellation_token: Option<CancellationToken>,
    #[cfg(feature = "http-client")]
    client: HttpClient,
    dataset: &'a D,
    request: TransactionRequest,
}

impl<D: NegotiatedTransactionalDataset> BoundNegotiatedSparqlUpdate<'_, D> {
    /// Negotiates one transaction and returns normalized effects only after
    /// successful commit, with the same rollback boundary as [`Self::execute`].
    /// The returned effects are not a durable receipt or ordered change feed.
    pub fn execute_with_changes(self) -> Result<SemanticChangeSet, UpdateEvaluationError> {
        ensure_update_start_alive(
            &self.update,
            self.cancellation_token.as_ref(),
            #[cfg(feature = "http-client")]
            &self.client,
        )?;
        let control = self
            .cancellation_token
            .as_ref()
            .map_or_else(TransactionStartControl::new, |token| {
                TransactionStartControl::new().with_cancellation_token(token.clone())
            });
        let transaction = self
            .dataset
            .start_transaction_with_control(self.request, control)
            .map_err(update_transaction_start_error)?
            .into_transaction();
        PreparedSparqlUpdate {
            evaluator: self.evaluator,
            update: self.update,
            using_datasets: self.using_datasets,
            cancellation_token: self.cancellation_token,
            #[cfg(feature = "http-client")]
            client: self.client,
            #[cfg(feature = "http-client")]
            service_client: None,
        }
        .execute_with_changes_on(
            transaction,
            |transaction| transaction.commit().map_err(tracking_error),
            |transaction| transaction.rollback().map_err(Into::into),
        )
    }

    /// Negotiates, evaluates, and atomically commits the update.
    pub fn execute(self) -> Result<(), UpdateEvaluationError> {
        ensure_update_start_alive(
            &self.update,
            self.cancellation_token.as_ref(),
            #[cfg(feature = "http-client")]
            &self.client,
        )?;
        let control = self
            .cancellation_token
            .as_ref()
            .map_or_else(TransactionStartControl::new, |token| {
                TransactionStartControl::new().with_cancellation_token(token.clone())
            });
        let mut transaction = self
            .dataset
            .start_transaction_with_control(self.request, control)
            .map_err(update_transaction_start_error)?
            .into_transaction();
        let result = (|| {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            ReadableUpdateEvaluator {
                transaction: &mut transaction,
                base_iri: self.update.base_iri.clone(),
                query_evaluator: self.evaluator,
                cancellation_token: self.cancellation_token.clone(),
                #[cfg(feature = "http-client")]
                client: self.client,
            }
            .eval_all(&self.update.operations, &self.using_datasets)?;
            ensure_update_alive(self.cancellation_token.as_ref())
        })();
        match result {
            Ok(()) => transaction.commit().map_err(UpdateEvaluationError::dataset),
            Err(error) => match transaction.rollback() {
                Ok(()) => Err(error),
                Err(rollback) => Err(UpdateEvaluationError::Unexpected(Box::new(
                    UpdateRollbackError {
                        update: error,
                        rollback: Box::new(rollback),
                    },
                ))),
            },
        }
    }
}

/// A whole SPARQL Update request bound to a caller-keyed transaction.
#[must_use]
pub struct BoundKeyedSparqlUpdate<'a, D: OutcomeAwareTransactionalDataset> {
    prepared: PreparedSparqlUpdate,
    dataset: &'a D,
    request: TransactionRequest,
    key: TransactionKey,
}

impl<D: OutcomeAwareTransactionalDataset> BoundKeyedSparqlUpdate<'_, D> {
    /// Returns normalized effects after an acknowledged keyed commit.
    ///
    /// Evaluation failure explicitly rolls back the owned transaction. Commit
    /// failure never triggers rollback or replay. The error source chain retains
    /// `TransactionCommitError<ChangeTrackingError<D::Error>>`, including the
    /// exact key on an indeterminate result. Use the dataset's outcome lookup
    /// to resolve that result; no changes or durable receipt are returned on error.
    pub fn execute_with_changes(self) -> Result<SemanticChangeSet, UpdateEvaluationError> {
        ensure_update_start_alive(
            &self.prepared.update,
            self.prepared.cancellation_token.as_ref(),
            #[cfg(feature = "http-client")]
            &self.prepared.client,
        )?;
        let control = self
            .prepared
            .cancellation_token
            .as_ref()
            .map_or_else(TransactionStartControl::new, |token| {
                TransactionStartControl::new().with_cancellation_token(token.clone())
            });
        let transaction = self
            .dataset
            .start_transaction_with_key_and_control(self.request, self.key, control)
            .map_err(update_transaction_start_error)?
            .into_transaction();
        self.prepared.execute_with_changes_on(
            transaction,
            |transaction| {
                transaction.commit_with_outcome().map_err(|error| {
                    UpdateEvaluationError::dataset(UpdateTransactionCommitError(error))
                })
            },
            |transaction| transaction.rollback_with_outcome().map_err(Into::into),
        )
    }
}

fn tracking_error<E: std::error::Error + Send + Sync + 'static>(
    error: ChangeTrackingError<E>,
) -> UpdateEvaluationError {
    match error {
        ChangeTrackingError::Backend(error) => UpdateEvaluationError::dataset(error),
        ChangeTrackingError::Failed => UpdateEvaluationError::dataset(error),
    }
}

fn unwrap_tracking_error<E: std::error::Error + Send + Sync + 'static>(
    error: UpdateEvaluationError,
) -> UpdateEvaluationError {
    match error {
        UpdateEvaluationError::Dataset(error) => match error.downcast::<ChangeTrackingError<E>>() {
            Ok(error) => tracking_error(*error),
            Err(error) => UpdateEvaluationError::Dataset(error),
        },
        other => other,
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct UpdateTransactionCommitError<E: std::error::Error + 'static>(
    #[source] TransactionCommitError<E>,
);

#[cfg(test)]
mod tracking_error_tests {
    use super::{tracking_error, unwrap_tracking_error};
    use crate::sparql::UpdateEvaluationError;
    use crate::store::{ChangeTrackingError, StorageError};
    use spareval::QueryEvaluationError;
    use std::io;

    #[test]
    fn capture_preserves_the_public_storage_error_variant() {
        let backend = || StorageError::from(io::Error::other("injected storage failure"));
        let direct = tracking_error(ChangeTrackingError::Backend(backend()));
        let mutation = unwrap_tracking_error::<StorageError>(UpdateEvaluationError::dataset(
            ChangeTrackingError::Backend(backend()),
        ));
        let query = unwrap_tracking_error::<StorageError>(UpdateEvaluationError::from(
            QueryEvaluationError::Dataset(Box::new(ChangeTrackingError::Backend(backend()))),
        ));
        for error in [direct, mutation, query] {
            assert!(
                matches!(error, UpdateEvaluationError::Storage(_)),
                "capture must not relabel a built-in storage failure: {error}"
            );
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("SPARQL update failed ({update}) and transaction rollback also failed ({rollback})")]
struct UpdateRollbackError {
    #[source]
    update: UpdateEvaluationError,
    rollback: Box<dyn std::error::Error + Send + Sync + 'static>,
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct UpdateTransactionStartError<E: std::error::Error + 'static>(
    #[source] TransactionStartError<E>,
);

/// A prepared SPARQL query bound to a storage, ready to be executed.
///
///
/// Usage example:
/// ```
/// use oxigraph::sparql::SparqlEvaluator;
/// use oxigraph::store::Store;
///
/// let store = Store::new()?;
/// let prepared_update = SparqlEvaluator::new()
///     .parse_update(
///         "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
///     )?
///     .on_store(&store);
/// prepared_update.execute()?;
/// # Ok::<_, Box<dyn std::error::Error>>(())
/// ```
#[must_use]
pub struct BoundPreparedSparqlUpdate<'a, 'b> {
    evaluator: QueryEvaluator,
    update: Update,
    using_datasets: Vec<Option<QueryDatasetSpecification>>,
    cancellation_token: Option<CancellationToken>,
    #[cfg(feature = "http-client")]
    client: HttpClient,
    transaction: Result<UpdateTransaction<'a, 'b>, UpdateEvaluationError>,
    observation: Option<EvaluationObservation>,
}

impl BoundPreparedSparqlUpdate<'_, '_> {
    /// Evaluate the update against the given store.
    pub fn execute(self) -> Result<(), UpdateEvaluationError> {
        let mut observation = self.observation;
        if let Some(observation) = &mut observation {
            observation.begin();
        }
        let result = (|| match self.transaction? {
            UpdateTransaction::OwnedReadable(mut transaction) => {
                ReadableUpdateEvaluator {
                    transaction: &mut transaction,
                    base_iri: self.update.base_iri.clone(),
                    query_evaluator: self.evaluator,
                    cancellation_token: self.cancellation_token.clone(),
                    #[cfg(feature = "http-client")]
                    client: self.client,
                }
                .eval_all(&self.update.operations, &self.using_datasets)?;
                ensure_update_alive(self.cancellation_token.as_ref())?;
                if let Some(observation) = &mut observation {
                    observation.before_commit();
                }
                transaction.commit()?;
                Ok(())
            }
            UpdateTransaction::BorrowedReadable(transaction) => ReadableUpdateEvaluator {
                transaction,
                base_iri: self.update.base_iri.clone(),
                query_evaluator: self.evaluator,
                cancellation_token: self.cancellation_token,
                #[cfg(feature = "http-client")]
                client: self.client,
            }
            .eval_all(&self.update.operations, &self.using_datasets),
            UpdateTransaction::Owned(mut transaction, storage) => {
                WriteOnlyUpdateEvaluator {
                    transaction: &mut transaction,
                    storage_for_initial_read: Some(storage),
                    base_iri: self.update.base_iri.clone(),
                    query_evaluator: self.evaluator,
                    cancellation_token: self.cancellation_token.clone(),
                    #[cfg(feature = "http-client")]
                    client: self.client,
                }
                .eval_all(&self.update.operations, &self.using_datasets)?;
                ensure_update_alive(self.cancellation_token.as_ref())?;
                if let Some(observation) = &mut observation {
                    observation.before_commit();
                }
                transaction.commit()?;
                Ok(())
            }
        })();
        if let Some(observation) = &mut observation {
            observation.finish_update(&result);
        }
        result
    }
}

enum UpdateTransaction<'a, 'b> {
    OwnedReadable(Transaction<'b>),
    BorrowedReadable(&'a mut Transaction<'b>),
    Owned(StorageTransaction<'b>, &'b Storage),
}

struct ReadableUpdateEvaluator<'a, D: WritableDataset> {
    transaction: &'a mut D,
    base_iri: Option<Iri<OxString>>,
    query_evaluator: QueryEvaluator,
    cancellation_token: Option<CancellationToken>,
    #[cfg(feature = "http-client")]
    client: HttpClient,
}

impl<D: WritableDataset> ReadableUpdateEvaluator<'_, D> {
    fn eval_all(
        &mut self,
        updates: &[GraphUpdateOperation],
        using_datasets: &[Option<QueryDatasetSpecification>],
    ) -> Result<(), UpdateEvaluationError> {
        validate_update_terms(
            &self.query_evaluator,
            updates,
            self.cancellation_token.as_ref(),
        )?;
        for (update, using_dataset) in updates.iter().zip(using_datasets) {
            #[cfg(feature = "http-client")]
            if matches!(update, GraphUpdateOperation::Load(_)) {
                self.client.ensure_alive().map_err(egress_update_error)?;
            }
            ensure_update_alive(self.cancellation_token.as_ref())?;
            self.eval(update, using_dataset)?;
        }
        #[cfg(feature = "http-client")]
        if updates
            .iter()
            .any(|update| matches!(update, GraphUpdateOperation::Load(_)))
        {
            self.client.ensure_alive().map_err(egress_update_error)?;
        }
        ensure_update_alive(self.cancellation_token.as_ref())?;
        Ok(())
    }

    fn eval(
        &mut self,
        update: &GraphUpdateOperation,
        using_dataset: &Option<QueryDatasetSpecification>,
    ) -> Result<(), UpdateEvaluationError> {
        match update {
            GraphUpdateOperation::InsertData(op) => self.eval_insert_data(op),
            GraphUpdateOperation::DeleteData(op) => self.eval_delete_data(op),
            GraphUpdateOperation::DeleteInsert(op) => self.eval_delete_insert(
                op,
                using_dataset
                    .as_ref()
                    .unwrap_or(&QueryDatasetSpecification::new()),
            ),
            GraphUpdateOperation::Load(op) => self.eval_load(op),
            GraphUpdateOperation::Clear(op) => self.eval_clear(op),
            GraphUpdateOperation::Create(op) => self.eval_create(op),
            GraphUpdateOperation::Drop(op) => self.eval_drop(op),
        }
    }

    fn eval_insert_data(
        &mut self,
        operation: &InsertDataOperation,
    ) -> Result<(), UpdateEvaluationError> {
        let mut bnodes = FxHashMap::default();
        for quad in &operation.data {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            let quad = convert_quad(quad, &mut bnodes);
            self.transaction
                .insert(quad)
                .map_err(UpdateEvaluationError::dataset)?;
        }
        Ok(())
    }

    fn eval_delete_data(
        &mut self,
        operation: &DeleteDataOperation,
    ) -> Result<(), UpdateEvaluationError> {
        for quad in &operation.data {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            let quad = convert_ground_quad(quad);
            self.transaction
                .remove(&quad)
                .map_err(UpdateEvaluationError::dataset)?;
        }
        Ok(())
    }

    fn eval_delete_insert(
        &mut self,
        operation: &DeleteInsertOperation,
        using: &QueryDatasetSpecification,
    ) -> Result<(), UpdateEvaluationError> {
        let mut prepared = self
            .query_evaluator
            .prepare_delete_insert(operation, self.base_iri.as_ref());
        *prepared.dataset_mut() = using.clone();
        let mutations = prepared
            .execute(WritableDatasetView::new(&*self.transaction))?
            .collect::<Result<Vec<_>, _>>()?;
        for mutation in mutations {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            match mutation {
                DeleteInsertQuad::Delete(quad) => self
                    .transaction
                    .remove(&quad)
                    .map_err(UpdateEvaluationError::dataset)?,
                DeleteInsertQuad::Insert(quad) => self
                    .transaction
                    .insert(quad)
                    .map_err(UpdateEvaluationError::dataset)?,
            }
        }
        Ok(())
    }

    fn eval_load(&mut self, operation: &LoadOperation) -> Result<(), UpdateEvaluationError> {
        let loaded = eval_load(
            operation,
            self.query_evaluator.version(),
            #[cfg(feature = "http-client")]
            &self.client,
        )
        .and_then(|loaded| {
            validate_loaded_terms(
                &self.query_evaluator,
                loaded,
                self.cancellation_token.as_ref(),
                #[cfg(feature = "http-client")]
                &self.client,
            )
        });
        match loaded {
            Ok(loaded) => {
                #[cfg(feature = "http-client")]
                self.client.ensure_alive().map_err(egress_update_error)?;
                if let Some(graph_name) = loaded.named_graph_to_create {
                    ensure_update_alive(self.cancellation_token.as_ref())?;
                    self.transaction
                        .insert_named_graph(graph_name.into())
                        .map_err(UpdateEvaluationError::dataset)?;
                }
                for graph_name in loaded.dataset.named_graphs() {
                    #[cfg(feature = "http-client")]
                    self.client.ensure_alive().map_err(egress_update_error)?;
                    ensure_update_alive(self.cancellation_token.as_ref())?;
                    self.transaction
                        .insert_named_graph(graph_name)
                        .map_err(UpdateEvaluationError::dataset)?;
                }
                for quad in &loaded.dataset {
                    #[cfg(feature = "http-client")]
                    self.client.ensure_alive().map_err(egress_update_error)?;
                    ensure_update_alive(self.cancellation_token.as_ref())?;
                    self.transaction
                        .insert(quad)
                        .map_err(UpdateEvaluationError::dataset)?;
                }
                Ok(())
            }
            Err(error) if operation.silent && can_silence_load_error(&error) => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn eval_create(&mut self, operation: &CreateOperation) -> Result<(), UpdateEvaluationError> {
        let graph_name = OxNamedOrBlankNode::from(operation.graph.clone());
        if self
            .transaction
            .contains_named_graph(&graph_name)
            .map_err(UpdateEvaluationError::dataset)?
        {
            if operation.silent {
                Ok(())
            } else {
                Err(UpdateEvaluationError::GraphAlreadyExists(
                    operation.graph.clone(),
                ))
            }
        } else {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            self.transaction
                .insert_named_graph(graph_name)
                .map_err(UpdateEvaluationError::dataset)?;
            Ok(())
        }
    }

    fn eval_clear(&mut self, operation: &ClearOperation) -> Result<(), UpdateEvaluationError> {
        match &operation.graph {
            GraphTarget::NamedNode(graph_name) => {
                let dataset_graph_name = OxNamedOrBlankNode::from(graph_name.clone());
                if self
                    .transaction
                    .contains_named_graph(&dataset_graph_name)
                    .map_err(UpdateEvaluationError::dataset)?
                {
                    ensure_update_alive(self.cancellation_token.as_ref())?;
                    self.transaction
                        .clear_graph(Some(&dataset_graph_name))
                        .map_err(UpdateEvaluationError::dataset)
                } else if operation.silent {
                    Ok(())
                } else {
                    Err(UpdateEvaluationError::GraphDoesNotExist(graph_name.clone()))
                }
            }
            GraphTarget::DefaultGraph => self
                .transaction
                .clear_graph(None)
                .map_err(UpdateEvaluationError::dataset),
            GraphTarget::NamedGraphs => self
                .transaction
                .clear_all_named_graphs()
                .map_err(UpdateEvaluationError::dataset),
            GraphTarget::AllGraphs => self
                .transaction
                .clear_all_graphs()
                .map_err(UpdateEvaluationError::dataset),
        }
    }

    fn eval_drop(&mut self, operation: &DropOperation) -> Result<(), UpdateEvaluationError> {
        match &operation.graph {
            GraphTarget::NamedNode(graph_name) => {
                let dataset_graph_name = OxNamedOrBlankNode::from(graph_name.clone());
                if self
                    .transaction
                    .contains_named_graph(&dataset_graph_name)
                    .map_err(UpdateEvaluationError::dataset)?
                {
                    ensure_update_alive(self.cancellation_token.as_ref())?;
                    self.transaction
                        .remove_named_graph(&dataset_graph_name)
                        .map_err(UpdateEvaluationError::dataset)?;
                    Ok(())
                } else if operation.silent {
                    Ok(())
                } else {
                    Err(UpdateEvaluationError::GraphDoesNotExist(graph_name.clone()))
                }
            }
            GraphTarget::DefaultGraph => self
                .transaction
                .clear_graph(None)
                .map_err(UpdateEvaluationError::dataset),
            GraphTarget::NamedGraphs => self
                .transaction
                .remove_all_named_graphs()
                .map_err(UpdateEvaluationError::dataset),
            GraphTarget::AllGraphs => self
                .transaction
                .clear()
                .map_err(UpdateEvaluationError::dataset),
        }
    }
}

struct WritableDatasetView<'a, D: WritableDataset> {
    dataset: &'a D,
}

impl<'a, D: WritableDataset> WritableDatasetView<'a, D> {
    fn new(dataset: &'a D) -> Self {
        Self { dataset }
    }
}

impl<'a, D: WritableDataset + 'a> QueryableDataset<'a> for WritableDatasetView<'a, D> {
    type InternalTerm = OxTerm;
    type Error = D::Error;

    fn internal_quads_for_pattern(
        &self,
        subject: Option<&OxTerm>,
        predicate: Option<&OxTerm>,
        object: Option<&OxTerm>,
        graph_name: Option<Option<&OxTerm>>,
    ) -> impl Iterator<Item = Result<InternalQuad<OxTerm>, Self::Error>> + use<'a, D> {
        let subject = match subject {
            Some(OxTerm::NamedNode(subject)) => {
                Some(OxNamedOrBlankNode::NamedNode(subject.clone()))
            }
            Some(OxTerm::BlankNode(subject)) => {
                Some(OxNamedOrBlankNode::BlankNode(subject.clone()))
            }
            Some(OxTerm::Literal(_)) => return empty_writable_dataset_quads(),
            #[cfg(feature = "rdf-12")]
            Some(OxTerm::Triple(_)) => return empty_writable_dataset_quads(),
            None => None,
        };
        let predicate = match predicate {
            Some(OxTerm::NamedNode(predicate)) => Some(predicate.clone()),
            Some(_) => return empty_writable_dataset_quads(),
            None => None,
        };
        let graph_name = match graph_name {
            Some(Some(OxTerm::NamedNode(graph_name))) => {
                Some(Some(OxNamedOrBlankNode::NamedNode(graph_name.clone())))
            }
            Some(Some(OxTerm::BlankNode(graph_name))) => {
                Some(Some(OxNamedOrBlankNode::BlankNode(graph_name.clone())))
            }
            Some(Some(_)) => return empty_writable_dataset_quads(),
            Some(None) => Some(None),
            None => None,
        };
        let graph_name = graph_name.as_ref().map(|graph_name| graph_name.as_ref());
        let quads: Box<dyn Iterator<Item = Result<InternalQuad<OxTerm>, Self::Error>> + 'a> =
            Box::new(
                self.dataset
                    .quads_for_pattern(subject.as_ref(), predicate.as_ref(), object, graph_name)
                    .map(|quad| {
                        let quad = quad?;
                        Ok(InternalQuad {
                            subject: quad.subject.into(),
                            predicate: quad.predicate.into(),
                            object: quad.object,
                            graph_name: match quad.graph_name {
                                OxGraphName::NamedNode(graph_name) => Some(graph_name.into()),
                                OxGraphName::BlankNode(graph_name) => Some(graph_name.into()),
                                OxGraphName::DefaultGraph => None,
                            },
                        })
                    }),
            );
        quads
    }

    fn internal_named_graphs(
        &self,
    ) -> impl Iterator<Item = Result<OxTerm, Self::Error>> + use<'a, D> {
        Box::new(
            self.dataset
                .named_graphs()
                .map(|graph_name| graph_name.map(Into::into)),
        )
    }

    fn contains_internal_graph_name(&self, graph_name: &OxTerm) -> Result<bool, Self::Error> {
        match graph_name {
            OxTerm::NamedNode(graph_name) => self
                .dataset
                .contains_named_graph(&OxNamedOrBlankNode::NamedNode(graph_name.clone())),
            OxTerm::BlankNode(graph_name) => self
                .dataset
                .contains_named_graph(&OxNamedOrBlankNode::BlankNode(graph_name.clone())),
            OxTerm::Literal(_) => Ok(false),
            #[cfg(feature = "rdf-12")]
            OxTerm::Triple(_) => Ok(false),
        }
    }

    fn internalize_term(&self, term: OxTerm) -> Result<OxTerm, Self::Error> {
        Ok(term)
    }

    fn externalize_term(&self, term: OxTerm) -> Result<OxTerm, Self::Error> {
        Ok(term)
    }
}

fn empty_writable_dataset_quads<'a, E: 'a>()
-> Box<dyn Iterator<Item = Result<InternalQuad<OxTerm>, E>> + 'a> {
    Box::new(std::iter::empty())
}

fn update_requires_read(update: &Update) -> bool {
    for (i, op) in update.operations.iter().enumerate() {
        match op {
            GraphUpdateOperation::InsertData(_)
            | GraphUpdateOperation::DeleteData(_)
            | GraphUpdateOperation::Create(CreateOperation { silent: true, .. })
            | GraphUpdateOperation::Clear(ClearOperation {
                graph: GraphTarget::DefaultGraph | GraphTarget::NamedGraphs | GraphTarget::AllGraphs,
                ..
            })
            | GraphUpdateOperation::Drop(DropOperation {
                graph: GraphTarget::DefaultGraph | GraphTarget::NamedGraphs | GraphTarget::AllGraphs,
                ..
            }) => (),
            GraphUpdateOperation::DeleteInsert(_) if i == 0 => (),
            _ => return true,
        }
    }
    false
}

struct WriteOnlyUpdateEvaluator<'a, 'b> {
    transaction: &'a mut StorageTransaction<'b>,
    storage_for_initial_read: Option<&'b Storage>,
    base_iri: Option<Iri<OxString>>,
    query_evaluator: QueryEvaluator,
    cancellation_token: Option<CancellationToken>,
    #[cfg(feature = "http-client")]
    client: HttpClient,
}

impl WriteOnlyUpdateEvaluator<'_, '_> {
    fn eval_all(
        &mut self,
        updates: &[GraphUpdateOperation],
        using_datasets: &[Option<QueryDatasetSpecification>],
    ) -> Result<(), UpdateEvaluationError> {
        validate_update_terms(
            &self.query_evaluator,
            updates,
            self.cancellation_token.as_ref(),
        )?;
        for (update, using_dataset) in updates.iter().zip(using_datasets) {
            #[cfg(feature = "http-client")]
            if matches!(update, GraphUpdateOperation::Load(_)) {
                self.client.ensure_alive().map_err(egress_update_error)?;
            }
            ensure_update_alive(self.cancellation_token.as_ref())?;
            self.eval(update, using_dataset)?;
            self.storage_for_initial_read.take(); // We unset the initial reader because we have likely mutated the store state.
        }
        #[cfg(feature = "http-client")]
        if updates
            .iter()
            .any(|update| matches!(update, GraphUpdateOperation::Load(_)))
        {
            self.client.ensure_alive().map_err(egress_update_error)?;
        }
        ensure_update_alive(self.cancellation_token.as_ref())?;
        Ok(())
    }

    fn eval(
        &mut self,
        update: &GraphUpdateOperation,
        using_dataset: &Option<QueryDatasetSpecification>,
    ) -> Result<(), UpdateEvaluationError> {
        match update {
            GraphUpdateOperation::InsertData(op) => self.eval_insert_data(op),
            GraphUpdateOperation::DeleteData(op) => self.eval_delete_data(op),
            GraphUpdateOperation::DeleteInsert(op) => self.eval_delete_insert(
                op,
                using_dataset
                    .as_ref()
                    .unwrap_or(&QueryDatasetSpecification::new()),
            ),
            GraphUpdateOperation::Load(op) => self.eval_load(op),
            GraphUpdateOperation::Clear(op) => self.eval_clear(op),
            GraphUpdateOperation::Create(op) => self.eval_create(op),
            GraphUpdateOperation::Drop(op) => self.eval_drop(op),
        }
    }

    fn eval_insert_data(
        &mut self,
        operation: &InsertDataOperation,
    ) -> Result<(), UpdateEvaluationError> {
        let mut bnodes = FxHashMap::default();
        for quad in &operation.data {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            let quad = convert_quad(quad, &mut bnodes);
            self.transaction.insert(quad);
        }
        Ok(())
    }

    fn eval_delete_data(
        &mut self,
        operation: &DeleteDataOperation,
    ) -> Result<(), UpdateEvaluationError> {
        for quad in &operation.data {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            let quad = convert_ground_quad(quad);
            self.transaction.remove(&quad);
        }
        Ok(())
    }

    fn eval_delete_insert(
        &mut self,
        operation: &DeleteInsertOperation,
        using: &QueryDatasetSpecification,
    ) -> Result<(), UpdateEvaluationError> {
        let Some(storage) = self.storage_for_initial_read.take() else {
            return Err(UpdateEvaluationError::Unexpected(
                "It is not possible to evaluate delete/insert operations on a write-only transaction after other update operations".into(),
            ));
        };
        let mut prepared = self
            .query_evaluator
            .prepare_delete_insert(operation, self.base_iri.as_ref());
        *prepared.dataset_mut() = using.clone();
        let mutations = prepared
            .execute(DatasetView::new(storage.snapshot()))?
            .collect::<Result<Vec<_>, _>>()?;
        for mutation in mutations {
            ensure_update_alive(self.cancellation_token.as_ref())?;
            match mutation {
                DeleteInsertQuad::Delete(quad) => self.transaction.remove(&quad),
                DeleteInsertQuad::Insert(quad) => self.transaction.insert(quad),
            }
        }
        Ok(())
    }

    fn eval_load(&mut self, operation: &LoadOperation) -> Result<(), UpdateEvaluationError> {
        let loaded = eval_load(
            operation,
            self.query_evaluator.version(),
            #[cfg(feature = "http-client")]
            &self.client,
        )
        .and_then(|loaded| {
            validate_loaded_terms(
                &self.query_evaluator,
                loaded,
                self.cancellation_token.as_ref(),
                #[cfg(feature = "http-client")]
                &self.client,
            )
        });
        match loaded {
            Ok(loaded) => {
                #[cfg(feature = "http-client")]
                self.client.ensure_alive().map_err(egress_update_error)?;
                if let Some(graph_name) = loaded.named_graph_to_create {
                    ensure_update_alive(self.cancellation_token.as_ref())?;
                    self.transaction.insert_named_graph(graph_name.into());
                }
                for graph_name in loaded.dataset.named_graphs() {
                    #[cfg(feature = "http-client")]
                    self.client.ensure_alive().map_err(egress_update_error)?;
                    ensure_update_alive(self.cancellation_token.as_ref())?;
                    self.transaction.insert_named_graph(graph_name);
                }
                for quad in &loaded.dataset {
                    #[cfg(feature = "http-client")]
                    self.client.ensure_alive().map_err(egress_update_error)?;
                    ensure_update_alive(self.cancellation_token.as_ref())?;
                    self.transaction.insert(quad);
                }
                Ok(())
            }
            Err(error) if operation.silent && can_silence_load_error(&error) => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn eval_create(&mut self, operation: &CreateOperation) -> Result<(), UpdateEvaluationError> {
        if !operation.silent {
            return Err(UpdateEvaluationError::Unexpected(
                "Not possible to create a named graph using a write-only transaction when SILENT option is not set".into(),
            ));
        }
        self.transaction
            .insert_named_graph(operation.graph.clone().into());
        Ok(())
    }

    fn eval_clear(&mut self, operation: &ClearOperation) -> Result<(), UpdateEvaluationError> {
        match &operation.graph {
            GraphTarget::NamedNode(_) => Err(UpdateEvaluationError::Unexpected(
                "Not possible to clear a named graph using a write-only transaction".into(),
            )),
            GraphTarget::DefaultGraph => {
                self.transaction.clear_default_graph();
                Ok(())
            }
            GraphTarget::NamedGraphs => {
                self.transaction.clear_all_named_graphs();
                Ok(())
            }
            GraphTarget::AllGraphs => {
                self.transaction.clear_all_graphs();
                Ok(())
            }
        }
    }

    fn eval_drop(&mut self, operation: &DropOperation) -> Result<(), UpdateEvaluationError> {
        match &operation.graph {
            GraphTarget::NamedNode(_) => Err(UpdateEvaluationError::Unexpected(
                "Not possible to drop a named graph using a write-only transaction".into(),
            )),
            GraphTarget::DefaultGraph => {
                self.transaction.clear_default_graph();
                Ok(())
            }
            GraphTarget::NamedGraphs => {
                self.transaction.remove_all_named_graphs();
                Ok(())
            }
            GraphTarget::AllGraphs => {
                self.transaction.clear();
                Ok(())
            }
        }
    }
}

fn validate_update_terms(
    evaluator: &QueryEvaluator,
    updates: &[GraphUpdateOperation],
    cancellation_token: Option<&CancellationToken>,
) -> Result<(), UpdateEvaluationError> {
    for update in updates {
        ensure_update_alive(cancellation_token)?;
        match update {
            GraphUpdateOperation::InsertData(operation) => {
                for quad in &operation.data {
                    ensure_update_alive(cancellation_token)?;
                    evaluator.ensure_term_compatible(&quad.object)?;
                }
            }
            GraphUpdateOperation::DeleteData(operation) => {
                for quad in &operation.data {
                    ensure_update_alive(cancellation_token)?;
                    evaluator.ensure_term_compatible(&quad.object.clone().into())?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

struct LoadedUpdate {
    dataset: OxDataset,
    named_graph_to_create: Option<spargebra::term::NamedNode>,
}

fn validate_loaded_terms(
    evaluator: &QueryEvaluator,
    loaded: LoadedUpdate,
    cancellation_token: Option<&CancellationToken>,
    #[cfg(feature = "http-client")] client: &HttpClient,
) -> Result<LoadedUpdate, UpdateEvaluationError> {
    for quad in &loaded.dataset {
        #[cfg(feature = "http-client")]
        client.ensure_alive().map_err(egress_update_error)?;
        ensure_update_alive(cancellation_token)?;
        evaluator.ensure_term_compatible(&quad.object)?;
    }
    Ok(loaded)
}

fn ensure_update_start_alive(
    _update: &Update,
    cancellation_token: Option<&CancellationToken>,
    #[cfg(feature = "http-client")] client: &HttpClient,
) -> Result<(), UpdateEvaluationError> {
    #[cfg(feature = "http-client")]
    if _update
        .operations
        .iter()
        .any(|operation| matches!(operation, GraphUpdateOperation::Load(_)))
    {
        client.ensure_alive().map_err(egress_update_error)?;
    }
    ensure_update_alive(cancellation_token)
}

fn ensure_update_alive(
    cancellation_token: Option<&CancellationToken>,
) -> Result<(), UpdateEvaluationError> {
    if cancellation_token.is_some_and(CancellationToken::is_cancelled) {
        Err(UpdateEvaluationError::Cancelled)
    } else {
        Ok(())
    }
}

fn update_transaction_start_error<E>(start_error: TransactionStartError<E>) -> UpdateEvaluationError
where
    E: std::error::Error + Send + Sync + 'static,
{
    match start_error {
        TransactionStartError::Cancelled => UpdateEvaluationError::Cancelled,
        TransactionStartError::Backend(error) => UpdateEvaluationError::dataset(error),
        error @ (TransactionStartError::RequirementsNotMet { .. }
        | TransactionStartError::TimedOut) => {
            UpdateEvaluationError::Unexpected(Box::new(UpdateTransactionStartError(error)))
        }
    }
}

#[cfg(feature = "http-client")]
fn egress_update_error(error: EgressError) -> UpdateEvaluationError {
    UpdateEvaluationError::Service(Box::new(error))
}

fn can_silence_load_error(
    #[cfg_attr(
        not(feature = "http-client"),
        expect(
            unused_variables,
            reason = "egress errors only exist with the HTTP client"
        )
    )]
    error: &UpdateEvaluationError,
) -> bool {
    #[cfg(feature = "http-client")]
    if find_egress_error(error).is_some_and(|error| error.kind() == EgressErrorKind::Cancelled) {
        return false;
    }
    true
}

#[cfg(feature = "http-client")]
fn eval_load(
    operation: &LoadOperation,
    version: SparqlVersion,
    client: &HttpClient,
) -> Result<LoadedUpdate, UpdateEvaluationError> {
    let client = client.for_operation();
    client.clear_recorded_error();
    client.ensure_alive().map_err(egress_update_error)?;
    let (content_type, body) = client
        .get(
            operation.source.as_str(),
            "application/n-triples, text/turtle, application/rdf+xml, application/n-quads, application/trig, application/ld+json",
        )
        .map_err(egress_update_error)?;
    client.ensure_alive().map_err(egress_update_error)?;
    let parser = RdfParser::from_media_type(&content_type)
        .map_err(|_| UpdateEvaluationError::UnsupportedContentType(content_type.clone()))?;
    let parser = parser
        .rename_blank_nodes()
        .with_base_iri(operation.source.as_str())
        .map_err(|e| {
            UpdateEvaluationError::Unexpected(
                format!("Invalid URL: {}: {e}", operation.source).into(),
            )
        })?;
    let (parser, named_graph_to_create) = match &operation.destination {
        GraphName::NamedNode(graph_name) => (
            parser
                .without_named_graphs()
                .with_default_graph(graph_name.clone()),
            Some(graph_name.clone()),
        ),
        GraphName::DefaultGraph if version == SparqlVersion::V1_1 => (
            parser
                .without_named_graphs()
                .with_default_graph(OxGraphName::DefaultGraph),
            None,
        ),
        GraphName::DefaultGraph => (parser, None),
    };
    let loader = DocumentLoader::new().with_http_client(client.clone());
    let parser = parser.for_reader(body).with_document_loader(loader);
    let dataset = match parser.collect_dataset() {
        Ok(dataset) => dataset,
        Err(error) => {
            if let Some(error) = client.take_recorded_error() {
                return Err(egress_update_error(error));
            }
            return Err(error.into());
        }
    };
    client.ensure_alive().map_err(egress_update_error)?;
    Ok(LoadedUpdate {
        dataset,
        named_graph_to_create,
    })
}

#[cfg(not(feature = "http-client"))]
fn eval_load(
    _operation: &LoadOperation,
    _version: SparqlVersion,
) -> Result<LoadedUpdate, UpdateEvaluationError> {
    Err(UpdateEvaluationError::Unexpected(
        "HTTP client is not available. Enable the feature 'http-client'".into(),
    ))
}

fn convert_quad(quad: &Quad, bnodes: &mut FxHashMap<BlankNode, BlankNode>) -> OxQuad {
    OxQuad {
        subject: match &quad.subject {
            NamedOrBlankNode::NamedNode(subject) => subject.clone().into(),
            NamedOrBlankNode::BlankNode(subject) => convert_blank_node(subject, bnodes).into(),
        },
        predicate: quad.predicate.clone(),
        object: match &quad.object {
            Term::NamedNode(object) => object.clone().into(),
            Term::BlankNode(object) => convert_blank_node(object, bnodes).into(),
            Term::Literal(object) => object.clone().into(),
            #[cfg(feature = "rdf-12")]
            Term::Triple(subject) => convert_triple(subject, bnodes).into(),
        },
        graph_name: match &quad.graph_name {
            GraphName::NamedNode(graph_name) => graph_name.clone().into(),
            GraphName::DefaultGraph => OxGraphName::DefaultGraph,
        },
    }
}

#[cfg(feature = "rdf-12")]
fn convert_triple(triple: &Triple, bnodes: &mut FxHashMap<BlankNode, BlankNode>) -> Triple {
    Triple {
        subject: match &triple.subject {
            NamedOrBlankNode::NamedNode(subject) => subject.clone().into(),
            NamedOrBlankNode::BlankNode(subject) => convert_blank_node(subject, bnodes).into(),
        },
        predicate: triple.predicate.clone(),
        object: match &triple.object {
            Term::NamedNode(object) => object.clone().into(),
            Term::BlankNode(object) => convert_blank_node(object, bnodes).into(),
            Term::Literal(object) => object.clone().into(),
            #[cfg(feature = "rdf-12")]
            Term::Triple(subject) => convert_triple(subject, bnodes).into(),
        },
    }
}

fn convert_blank_node(node: &BlankNode, bnodes: &mut FxHashMap<BlankNode, BlankNode>) -> BlankNode {
    bnodes.entry(node.clone()).or_default().clone()
}

fn convert_ground_quad(quad: &GroundQuad) -> OxQuad {
    OxQuad {
        subject: quad.subject.clone().into(),
        predicate: quad.predicate.clone(),
        object: match &quad.object {
            GroundTerm::NamedNode(object) => object.clone().into(),
            GroundTerm::Literal(object) => object.clone().into(),
            #[cfg(feature = "rdf-12")]
            GroundTerm::Triple(subject) => convert_ground_triple(subject).into(),
        },
        graph_name: match &quad.graph_name {
            GraphName::NamedNode(graph_name) => graph_name.clone().into(),
            GraphName::DefaultGraph => OxGraphName::DefaultGraph,
        },
    }
}

#[cfg(feature = "rdf-12")]
fn convert_ground_triple(triple: &GroundTriple) -> Triple {
    Triple {
        subject: triple.subject.clone().into(),
        predicate: triple.predicate.clone(),
        object: match &triple.object {
            GroundTerm::NamedNode(object) => object.clone().into(),
            GroundTerm::Literal(object) => object.clone().into(),
            #[cfg(feature = "rdf-12")]
            GroundTerm::Triple(subject) => convert_ground_triple(subject).into(),
        },
    }
}
