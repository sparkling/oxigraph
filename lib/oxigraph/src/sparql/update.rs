#[cfg(feature = "http-client")]
use crate::http::HttpClient;
#[cfg(feature = "http-client")]
use crate::io::DocumentLoader;
#[cfg(feature = "http-client")]
use crate::io::RdfParser;
use crate::model::{
    Dataset as OxDataset, GraphName as OxGraphName, NamedOrBlankNode as OxNamedOrBlankNode,
    OxString, Quad as OxQuad, Term as OxTerm,
};
use crate::sparql::dataset::DatasetView;
use crate::sparql::error::UpdateEvaluationError;
use crate::storage::{Storage, StorageError, StorageTransaction};
use crate::store::{Store, Transaction, TransactionalDataset, WritableDataset};
use oxiri::Iri;
use rustc_hash::FxHashMap;
use spareval::{
    DeleteInsertQuad, InternalQuad, QueryDatasetSpecification, QueryEvaluator, QueryableDataset,
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
#[cfg(feature = "http-client")]
use std::time::Duration;

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
    #[cfg(feature = "http-client")]
    http_timeout: Option<Duration>,
    #[cfg(feature = "http-client")]
    http_redirection_limit: usize,
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
        #[cfg(feature = "http-client")] http_timeout: Option<Duration>,
        #[cfg(feature = "http-client")] http_redirection_limit: usize,
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
            #[cfg(feature = "http-client")]
            http_timeout,
            #[cfg(feature = "http-client")]
            http_redirection_limit,
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
    pub fn on_store(self, store: &Store) -> BoundPreparedSparqlUpdate<'_, '_> {
        let transaction = if update_requires_read(&self.update) {
            store
                .start_transaction()
                .map(UpdateTransaction::OwnedReadable)
        } else {
            let storage = store.storage();
            storage
                .start_transaction()
                .map(|transaction| UpdateTransaction::Owned(transaction, storage))
        };
        BoundPreparedSparqlUpdate {
            evaluator: self.evaluator,
            update: self.update,
            using_datasets: self.using_datasets,
            #[cfg(feature = "http-client")]
            http_timeout: self.http_timeout,
            #[cfg(feature = "http-client")]
            http_redirection_limit: self.http_redirection_limit,
            transaction,
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
            #[cfg(feature = "http-client")]
            http_timeout: self.http_timeout,
            #[cfg(feature = "http-client")]
            http_redirection_limit: self.http_redirection_limit,
            dataset,
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
        BoundPreparedSparqlUpdate {
            evaluator: self.evaluator,
            update: self.update,
            using_datasets: self.using_datasets,
            #[cfg(feature = "http-client")]
            http_timeout: self.http_timeout,
            #[cfg(feature = "http-client")]
            http_redirection_limit: self.http_redirection_limit,
            transaction: Ok(UpdateTransaction::BorrowedReadable(transaction)),
        }
    }
}

/// A prepared SPARQL update bound to a backend-neutral transactional dataset.
#[must_use]
pub struct BoundTransactionalSparqlUpdate<'a, D: TransactionalDataset> {
    evaluator: QueryEvaluator,
    update: Update,
    using_datasets: Vec<Option<QueryDatasetSpecification>>,
    #[cfg(feature = "http-client")]
    http_timeout: Option<Duration>,
    #[cfg(feature = "http-client")]
    http_redirection_limit: usize,
    dataset: &'a D,
}

impl<D: TransactionalDataset> BoundTransactionalSparqlUpdate<'_, D> {
    /// Evaluates and atomically commits the update.
    pub fn execute(self) -> Result<(), UpdateEvaluationError> {
        let mut transaction = self
            .dataset
            .start_transaction()
            .map_err(UpdateEvaluationError::dataset)?;
        let result = ReadableUpdateEvaluator {
            transaction: &mut transaction,
            base_iri: self.update.base_iri.clone(),
            query_evaluator: self.evaluator,
            #[cfg(feature = "http-client")]
            client: HttpClient::new(self.http_timeout, self.http_redirection_limit),
        }
        .eval_all(&self.update.operations, &self.using_datasets);
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

#[derive(Debug, thiserror::Error)]
#[error("SPARQL update failed ({update}) and transaction rollback also failed ({rollback})")]
struct UpdateRollbackError {
    #[source]
    update: UpdateEvaluationError,
    rollback: Box<dyn std::error::Error + Send + Sync + 'static>,
}

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
    #[cfg(feature = "http-client")]
    http_timeout: Option<Duration>,
    #[cfg(feature = "http-client")]
    http_redirection_limit: usize,
    transaction: Result<UpdateTransaction<'a, 'b>, StorageError>,
}

impl BoundPreparedSparqlUpdate<'_, '_> {
    /// Evaluate the update against the given store.
    pub fn execute(self) -> Result<(), UpdateEvaluationError> {
        match self.transaction? {
            UpdateTransaction::OwnedReadable(mut transaction) => {
                ReadableUpdateEvaluator {
                    transaction: &mut transaction,
                    base_iri: self.update.base_iri.clone(),
                    query_evaluator: self.evaluator,
                    #[cfg(feature = "http-client")]
                    client: HttpClient::new(self.http_timeout, self.http_redirection_limit),
                }
                .eval_all(&self.update.operations, &self.using_datasets)?;
                transaction.commit()?;
                Ok(())
            }
            UpdateTransaction::BorrowedReadable(transaction) => ReadableUpdateEvaluator {
                transaction,
                base_iri: self.update.base_iri.clone(),
                query_evaluator: self.evaluator,
                #[cfg(feature = "http-client")]
                client: HttpClient::new(self.http_timeout, self.http_redirection_limit),
            }
            .eval_all(&self.update.operations, &self.using_datasets),
            UpdateTransaction::Owned(mut transaction, storage) => {
                WriteOnlyUpdateEvaluator {
                    transaction: &mut transaction,
                    storage_for_initial_read: Some(storage),
                    base_iri: self.update.base_iri.clone(),
                    query_evaluator: self.evaluator,
                    #[cfg(feature = "http-client")]
                    client: HttpClient::new(self.http_timeout, self.http_redirection_limit),
                }
                .eval_all(&self.update.operations, &self.using_datasets)?;
                transaction.commit()?;
                Ok(())
            }
        }
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
    #[cfg(feature = "http-client")]
    client: HttpClient,
}

impl<D: WritableDataset> ReadableUpdateEvaluator<'_, D> {
    fn eval_all(
        &mut self,
        updates: &[GraphUpdateOperation],
        using_datasets: &[Option<QueryDatasetSpecification>],
    ) -> Result<(), UpdateEvaluationError> {
        validate_update_terms(&self.query_evaluator, updates)?;
        for (update, using_dataset) in updates.iter().zip(using_datasets) {
            self.eval(update, using_dataset)?;
        }
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
        .and_then(|loaded| validate_loaded_terms(&self.query_evaluator, loaded));
        match loaded {
            Ok(loaded) => {
                if let Some(graph_name) = loaded.named_graph_to_create {
                    self.transaction
                        .insert_named_graph(graph_name.into())
                        .map_err(UpdateEvaluationError::dataset)?;
                }
                for graph_name in loaded.dataset.named_graphs() {
                    self.transaction
                        .insert_named_graph(graph_name)
                        .map_err(UpdateEvaluationError::dataset)?;
                }
                for quad in &loaded.dataset {
                    self.transaction
                        .insert(quad)
                        .map_err(UpdateEvaluationError::dataset)?;
                }
                Ok(())
            }
            Err(_) if operation.silent => Ok(()),
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
    #[cfg(feature = "http-client")]
    client: HttpClient,
}

impl WriteOnlyUpdateEvaluator<'_, '_> {
    fn eval_all(
        &mut self,
        updates: &[GraphUpdateOperation],
        using_datasets: &[Option<QueryDatasetSpecification>],
    ) -> Result<(), UpdateEvaluationError> {
        validate_update_terms(&self.query_evaluator, updates)?;
        for (update, using_dataset) in updates.iter().zip(using_datasets) {
            self.eval(update, using_dataset)?;
            self.storage_for_initial_read.take(); // We unset the initial reader because we have likely mutated the store state.
        }
        Ok(())
    }

    fn eval(
        &mut self,
        update: &GraphUpdateOperation,
        using_dataset: &Option<QueryDatasetSpecification>,
    ) -> Result<(), UpdateEvaluationError> {
        match update {
            GraphUpdateOperation::InsertData(op) => {
                self.eval_insert_data(op);
                Ok(())
            }
            GraphUpdateOperation::DeleteData(op) => {
                self.eval_delete_data(op);
                Ok(())
            }
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

    fn eval_insert_data(&mut self, operation: &InsertDataOperation) {
        let mut bnodes = FxHashMap::default();
        for quad in &operation.data {
            let quad = convert_quad(quad, &mut bnodes);
            self.transaction.insert(quad);
        }
    }

    fn eval_delete_data(&mut self, operation: &DeleteDataOperation) {
        for quad in &operation.data {
            let quad = convert_ground_quad(quad);
            self.transaction.remove(&quad);
        }
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
        .and_then(|loaded| validate_loaded_terms(&self.query_evaluator, loaded));
        match loaded {
            Ok(loaded) => {
                if let Some(graph_name) = loaded.named_graph_to_create {
                    self.transaction.insert_named_graph(graph_name.into());
                }
                for graph_name in loaded.dataset.named_graphs() {
                    self.transaction.insert_named_graph(graph_name);
                }
                for quad in &loaded.dataset {
                    self.transaction.insert(quad);
                }
                Ok(())
            }
            Err(_) if operation.silent => Ok(()),
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
) -> Result<(), UpdateEvaluationError> {
    for update in updates {
        match update {
            GraphUpdateOperation::InsertData(operation) => {
                for quad in &operation.data {
                    evaluator.ensure_term_compatible(&quad.object)?;
                }
            }
            GraphUpdateOperation::DeleteData(operation) => {
                for quad in &operation.data {
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
) -> Result<LoadedUpdate, UpdateEvaluationError> {
    for quad in &loaded.dataset {
        evaluator.ensure_term_compatible(&quad.object)?;
    }
    Ok(loaded)
}

#[cfg(feature = "http-client")]
fn eval_load(
    operation: &LoadOperation,
    version: SparqlVersion,
    client: &HttpClient,
) -> Result<LoadedUpdate, UpdateEvaluationError> {
    let (content_type, body) = client
        .get(
            operation.source.as_str(),
            "application/n-triples, text/turtle, application/rdf+xml, application/n-quads, application/trig, application/ld+json",
        )
        .map_err(|e| UpdateEvaluationError::Service(Box::new(e)))?;
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
    let client = client.clone();
    let parser = parser
        .for_reader(body)
        .with_document_loader(DocumentLoader::new().with_http_client(client));
    Ok(LoadedUpdate {
        dataset: parser.collect_dataset()?,
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
