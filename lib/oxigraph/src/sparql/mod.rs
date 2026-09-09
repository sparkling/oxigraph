//! [SPARQL](https://www.w3.org/TR/sparql11-overview/) implementation.
//!
//! The entry point for SPARQL execution is the [`SparqlEvaluator`] type.

mod dataset;
mod entailment;
mod error;
#[cfg(feature = "http-client")]
mod http;
#[cfg(all(
    not(target_family = "wasm"),
    any(
        feature = "text-index",
        feature = "spatial-index",
        feature = "statistics"
    )
))]
mod index_service;
pub mod results;
#[cfg(all(not(target_family = "wasm"), feature = "spatial-index"))]
mod spatial_service;
#[cfg(all(not(target_family = "wasm"), feature = "statistics"))]
mod statistics;
#[cfg(all(not(target_family = "wasm"), feature = "text-index"))]
mod text_service;
mod update;
#[cfg(all(not(target_family = "wasm"), feature = "statistics"))]
pub use statistics::{BoundStatisticsSparqlQuery, StatisticsAvailability, StatisticsQueryContext};

#[cfg(feature = "http-client")]
use crate::http::HttpClient;
#[cfg(feature = "http-client")]
pub use crate::http::{
    EgressError, EgressErrorKind, EgressPolicy, EgressPolicyConfigurationError, EgressPurpose,
};
use crate::model::{IriParseError, NamedNode, Term};
pub use crate::model::{Variable, VariableNameParseError};
use crate::sparql::dataset::DatasetView;
pub use crate::sparql::entailment::{
    QueryEntailment, QueryEntailmentDataset, QueryEntailmentError, QueryEntailmentOptions,
};
pub use crate::sparql::error::UpdateEvaluationError;
#[cfg(feature = "http-client")]
use crate::sparql::http::HttpServiceHandler;
pub use crate::sparql::update::{
    BoundKeyedSparqlUpdate, BoundNegotiatedSparqlUpdate, BoundPreparedSparqlUpdate,
    BoundTransactionalSparqlUpdate, PreparedSparqlUpdate,
};
use crate::store::EvaluationOperation;
use crate::store::evaluation_metrics::{EvaluationObservation, observe_query_result};
use crate::store::{Store, Transaction};
pub use spareval::{
    AggregateFunctionAccumulator, BoundedJoinCostModel, BoundedJoinPlanning, CancellationReason,
    CancellationToken, CardinalityFeedback, CardinalityFeedbackNode, DefaultServiceHandler,
    EstimateBasis, JoinPlanningReport, QueryDatasetSpecification, QueryEvaluationError,
    QueryExplanation, QueryResults, QuerySolution, QuerySolutionIter, QueryTripleIter,
    ServiceHandler,
};
use spareval::{QueryEvaluator, QueryableDataset};
use spargebra::SparqlParser;
pub use spargebra::{ParsedQuery, ParsedUpdate, Query, SparqlSyntaxError, SparqlVersion, Update};
#[cfg(all(not(target_family = "wasm"), feature = "spatial-index"))]
pub use spatial_service::{
    BoundSpatialSparqlQuery, SPATIAL_SEARCH_SERVICE, SpatialQueryContext, SpatialServiceError,
    SpatialSparqlResults,
};
use std::collections::HashMap;
use std::marker::PhantomData;
use std::mem::take;
#[cfg(feature = "http-client")]
use std::time::Duration;
#[cfg(all(not(target_family = "wasm"), feature = "text-index"))]
pub use text_service::{
    BoundTextSparqlQuery, TEXT_SEARCH_SERVICE, TextQueryContext, TextServiceError,
    TextSparqlResults,
};

/// Dataset specification applied while evaluating a prepared SPARQL query.
pub type QueryDataset = QueryDatasetSpecification;

/// An immutable snapshot of the evaluator's effective remote capabilities.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EffectiveCapabilities {
    default_service_handler: bool,
    remote_load: bool,
}

impl EffectiveCapabilities {
    /// Whether a default `SERVICE` handler is available.
    #[inline]
    pub const fn default_service_handler(self) -> bool {
        self.default_service_handler
    }

    /// Whether remote `LOAD` is available.
    #[inline]
    pub const fn remote_load(self) -> bool {
        self.remote_load
    }
}

/// SPARQL evaluator.
///
/// It supports [SPARQL 1.1 query](https://www.w3.org/TR/sparql11-query/) and [SPARQL 1.1 update](https://www.w3.org/TR/sparql11-update/).
///
/// If the `"http-client"` optional feature is enabled,
/// a simple HTTP 1.1 client is used to execute [SPARQL 1.1 Federated Query](https://www.w3.org/TR/sparql11-federated-query/) SERVICE calls.
///
/// Usage example disabling the federated query support:
/// ```
/// use oxigraph::model::NamedNode;
/// use oxigraph::sparql::SparqlEvaluator;
/// use oxigraph::store::Store;
///
/// SparqlEvaluator::new()
///     .with_custom_function(NamedNode::new("http://example.com/identity")?, |args| {
///         args.get(0).cloned()
///     })
///     .parse_query("SELECT (<http://example.com/identity>('foo') AS ?r) WHERE {}")?
///     .on_store(&Store::new()?)
///     .execute()?;
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[derive(Clone)]
#[must_use]
pub struct SparqlEvaluator {
    #[cfg(feature = "http-client")]
    http_timeout: Option<Duration>,
    #[cfg(feature = "http-client")]
    http_redirection_limit: usize,
    #[cfg(feature = "http-client")]
    with_http_default_service_handler: bool,
    #[cfg(feature = "http-client")]
    egress_policy: Option<EgressPolicy>,
    cancellation_token: Option<CancellationToken>,
    parser: SparqlParser,
    inner: QueryEvaluator,
}

struct PreparedEvaluator {
    inner: QueryEvaluator,
    #[cfg(feature = "http-client")]
    service_client: Option<HttpClient>,
}

#[cfg(feature = "http-client")]
fn bind_store_service(
    evaluator: QueryEvaluator,
    client: Option<HttpClient>,
    store: &Store,
) -> QueryEvaluator {
    if let Some(client) = client {
        let version = evaluator.version();
        evaluator.with_default_service_handler(HttpServiceHandler::new(
            client.with_policy_metrics(store.policy_metrics_state()),
            version,
        ))
    } else {
        evaluator
    }
}

impl SparqlEvaluator {
    /// Creates an evaluator using the default parser and evaluation settings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Provides an IRI that could be used to resolve the operation relative IRIs.
    ///
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    ///
    /// if let QueryResults::Solutions(mut solutions) = SparqlEvaluator::new()
    ///     .with_base_iri("http://example.com/")?
    ///     .parse_query("SELECT (<> AS ?r) WHERE {}")?
    ///     .on_store(&Store::new()?)
    ///     .execute()?
    /// {
    ///     assert_eq!(
    ///         solutions.next().unwrap()?.get("r"),
    ///         Some(&NamedNode::new("http://example.com/")?.into())
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_base_iri(mut self, base_iri: &str) -> Result<Self, IriParseError> {
        self.parser = self.parser.with_base_iri(base_iri)?;
        Ok(self)
    }

    /// Set a default IRI prefix used during parsing.
    ///
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    ///
    /// if let QueryResults::Solutions(mut solutions) = SparqlEvaluator::new()
    ///     .with_prefix("ex", "http://example.com/")?
    ///     .parse_query("SELECT (ex: AS ?r) WHERE {}")?
    ///     .on_store(&Store::new()?)
    ///     .execute()?
    /// {
    ///     assert_eq!(
    ///         solutions.next().unwrap()?.get("r"),
    ///         Some(&NamedNode::new("http://example.com/")?.into())
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_prefix(
        mut self,
        prefix_name: &str,
        prefix_iri: &str,
    ) -> Result<Self, IriParseError> {
        self.parser = self.parser.with_prefix(prefix_name, prefix_iri)?;
        Ok(self)
    }

    /// Selects the fallback SPARQL syntax and semantic feature mode.
    ///
    /// An in-band `VERSION` declaration is authoritative when present; this
    /// setting is used when the operation does not declare a version.
    #[inline]
    pub fn with_version(mut self, version: SparqlVersion) -> Self {
        self.parser = self.parser.with_version(version);
        self.inner = self.inner.with_version(version);
        self
    }

    /// Use a given [`ServiceHandler`] to execute [SPARQL 1.1 Federated Query](https://www.w3.org/TR/sparql11-federated-query/) SERVICE calls.
    ///
    /// See [`ServiceHandler`] for an example.
    #[inline]
    pub fn with_service_handler(
        mut self,
        service_name: impl Into<NamedNode>,
        handler: impl ServiceHandler + 'static,
    ) -> Self {
        self.inner = self.inner.with_service_handler(service_name, handler);
        self
    }

    /// Use a given [`DefaultServiceHandler`] to execute [SPARQL 1.1 Federated Query](https://www.w3.org/TR/sparql11-federated-query/) SERVICE calls if no explicit service handler is defined for the service.
    ///
    /// This replaces the default service handler that does HTTP requests to remote endpoints.
    ///
    /// See [`DefaultServiceHandler`] for an example.
    #[inline]
    pub fn with_default_service_handler(
        mut self,
        handler: impl DefaultServiceHandler + 'static,
    ) -> Self {
        #[cfg(feature = "http-client")]
        {
            self.with_http_default_service_handler = false;
        }
        self.inner = self.inner.with_default_service_handler(handler);
        self
    }

    /// Disables the default `SERVICE` call implementation that does HTTP requests to remote endpoints.
    #[cfg(feature = "http-client")]
    #[inline]
    pub fn without_default_http_service_handler(mut self) -> Self {
        self.with_http_default_service_handler = false;
        self
    }

    /// Sets a timeout for HTTP requests done during SPARQL evaluation.
    #[cfg(feature = "http-client")]
    #[inline]
    pub fn with_http_timeout(mut self, timeout: Duration) -> Self {
        self.http_timeout = Some(timeout);
        self
    }

    /// Sets an upper bound to the number of HTTP redirections followed per HTTP request done during SPARQL evaluation.
    ///
    /// By default, this value is `0`.
    #[cfg(feature = "http-client")]
    #[inline]
    pub fn with_http_redirection_limit(mut self, redirection_limit: usize) -> Self {
        self.http_redirection_limit = redirection_limit;
        self
    }

    /// Applies one deny-by-default policy to built-in `SERVICE`, `LOAD`, and
    /// nested document retrieval.
    #[cfg(feature = "http-client")]
    #[inline]
    pub fn with_egress_policy(mut self, policy: EgressPolicy) -> Self {
        self.egress_policy = Some(policy);
        self
    }

    /// Denies all built-in remote `SERVICE`, `LOAD`, and nested document
    /// retrieval.
    ///
    /// This method is always available so callers do not need to mirror this
    /// crate's feature resolution. If the `http-client` feature is disabled,
    /// Oxigraph has no built-in HTTP egress and this method is a no-op.
    #[inline]
    pub fn with_deny_all_egress_policy(self) -> Self {
        #[cfg(feature = "http-client")]
        {
            self.with_egress_policy(EgressPolicy::deny_all())
        }
        #[cfg(not(feature = "http-client"))]
        {
            self
        }
    }

    /// Returns an immutable snapshot of the effective remote capabilities.
    pub fn effective_capabilities(&self) -> EffectiveCapabilities {
        #[cfg(feature = "http-client")]
        {
            let built_in_remote = self
                .egress_policy
                .as_ref()
                .is_none_or(EgressPolicy::allows_compiled_http_transport);
            EffectiveCapabilities {
                default_service_handler: self.inner.has_default_service_handler()
                    || (built_in_remote && self.with_http_default_service_handler),
                remote_load: built_in_remote,
            }
        }
        #[cfg(not(feature = "http-client"))]
        {
            EffectiveCapabilities {
                default_service_handler: self.inner.has_default_service_handler(),
                remote_load: false,
            }
        }
    }

    /// Adds a custom SPARQL evaluation function.
    ///
    /// Example with a function serializing terms to N-Triples:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    ///
    /// if let QueryResults::Solutions(mut solutions) = SparqlEvaluator::new()
    ///     .with_custom_function(
    ///         NamedNode::new("http://www.w3.org/ns/formats/N-Triples")?,
    ///         |args| args.get(0).map(|t| Literal::from(t.to_string()).into()),
    ///     )
    ///     .parse_query("SELECT (<http://www.w3.org/ns/formats/N-Triples>(1) AS ?nt) WHERE {}")?
    ///     .on_store(&Store::new()?)
    ///     .execute()?
    /// {
    ///     assert_eq!(
    ///         solutions.next().unwrap()?.get("nt"),
    ///         Some(&Literal::from("\"1\"^^<http://www.w3.org/2001/XMLSchema#integer>").into())
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_custom_function(
        mut self,
        name: NamedNode,
        evaluator: impl Fn(&[Term]) -> Option<Term> + Send + Sync + 'static,
    ) -> Self {
        self.inner = self.inner.with_custom_function(name, evaluator);
        self
    }

    /// Returns the list of custom functions currently registered in the evaluator.
    ///
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::sparql::SparqlEvaluator;
    ///
    /// let evaluator = SparqlEvaluator::new().with_custom_function(
    ///     NamedNode::new("http://www.w3.org/ns/formats/N-Triples")?,
    ///     |args| args.get(0).map(|t| Literal::from(t.to_string()).into()),
    /// );
    /// assert!(
    ///     evaluator
    ///         .custom_functions()
    ///         .collect::<Vec<_>>()
    ///         .contains(&&NamedNode::new("http://www.w3.org/ns/formats/N-Triples")?)
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn custom_functions(&self) -> impl Iterator<Item = &NamedNode> {
        self.inner.custom_functions()
    }

    /// Adds a custom SPARQL evaluation aggregate function.
    ///
    /// Example with a function doing concatenation:
    /// ```
    /// use oxigraph::model::{Literal, NamedNode, Term};
    /// use oxigraph::sparql::{AggregateFunctionAccumulator, QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    /// use std::mem::take;
    ///
    /// struct ConcatAccumulator {
    ///     value: String,
    /// }
    ///
    /// impl AggregateFunctionAccumulator for ConcatAccumulator {
    ///     fn accumulate(&mut self, element: Term) {
    ///         if let Term::Literal(v) = element {
    ///             if !self.value.is_empty() {
    ///                 self.value.push(' ');
    ///             }
    ///             self.value.push_str(v.value());
    ///         }
    ///     }
    ///
    ///     fn finish(&mut self) -> Option<Term> {
    ///         Some(Literal::new_simple_literal(take(&mut self.value)).into())
    ///     }
    /// }
    ///
    /// if let QueryResults::Solutions(mut solutions) = SparqlEvaluator::new()
    ///     .with_custom_aggregate_function(NamedNode::new("http://example.com/concat")?, || {
    ///         Box::new(ConcatAccumulator {
    ///             value: String::new(),
    ///         })
    ///     })
    ///     .parse_query(
    ///         "SELECT (<http://example.com/concat>(?v) AS ?r) WHERE { VALUES ?v { 1 2 3 } }",
    ///     )?
    ///     .on_store(&Store::new()?)
    ///     .execute()?
    /// {
    ///     assert_eq!(
    ///         solutions.next().unwrap()?.get("r"),
    ///         Some(&Literal::new_simple_literal("1 2 3").into())
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_custom_aggregate_function(
        mut self,
        name: NamedNode,
        evaluator: impl Fn() -> Box<dyn AggregateFunctionAccumulator + Send + Sync>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        self.parser = self.parser.with_custom_aggregate_function(name.clone());
        self.inner = self.inner.with_custom_aggregate_function(name, evaluator);
        self
    }

    /// Returns the list of custom aggregate functions currently registered in the evaluator.
    pub fn custom_aggregate_functions(&self) -> impl Iterator<Item = &NamedNode> {
        self.inner.custom_aggregate_functions()
    }

    #[doc(hidden)]
    #[inline]
    pub fn without_optimizations(mut self) -> Self {
        self.inner = self.inner.without_optimizations();
        self
    }

    /// Opts into bounded same-graph basic-join search with an explicit <=8-leaf
    /// ceiling. Larger or ineligible components keep deterministic greedy
    /// planning. QueryExplanation::join_planning reports the search work.
    /// This is not a measured-speed or default-planner promotion.
    pub fn with_bounded_join_planning(mut self, options: BoundedJoinPlanning) -> Self {
        self.inner = self.inner.with_bounded_join_planning(options);
        self
    }

    /// Injects a cancellation token into SPARQL evaluation.
    ///
    /// It may be used to abort a query or an update cleanly. Updates that own
    /// their transaction roll back staged changes when cancellation is observed.
    /// Updates bound to a caller-owned transaction return
    /// [`UpdateEvaluationError::Cancelled`] but leave rollback to the caller.
    /// A custom [`TransactionalDataset`] whose `start_transaction` call blocks
    /// cannot observe cancellation until that call returns.
    ///
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::sparql::{
    ///     CancellationToken, QueryEvaluationError, QueryResults, SparqlEvaluator,
    /// };
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    /// store.insert(Quad::new(
    ///     NamedNode::new("http://example.com/s")?,
    ///     NamedNode::new("http://example.com/p")?,
    ///     NamedNode::new("http://example.com/o")?,
    ///     GraphName::DefaultGraph,
    /// ))?;
    /// let cancellation_token = CancellationToken::new();
    /// if let QueryResults::Solutions(mut solutions) = SparqlEvaluator::new()
    ///     .with_cancellation_token(cancellation_token.clone())
    ///     .parse_query("SELECT * WHERE { ?s ?p ?o }")?
    ///     .on_store(&store)
    ///     .execute()?
    /// {
    ///     cancellation_token.cancel(); // We cancel
    ///     assert!(matches!(
    ///         solutions.next().unwrap().unwrap_err(),
    ///         QueryEvaluationError::Cancelled
    ///     ));
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn with_cancellation_token(mut self, cancellation_token: CancellationToken) -> Self {
        self.cancellation_token = Some(cancellation_token.clone());
        self.inner = self.inner.with_cancellation_token(cancellation_token);
        self
    }

    #[cfg(feature = "http-client")]
    fn http_client(&self, purpose: EgressPurpose) -> HttpClient {
        HttpClient::new(self.http_timeout, self.http_redirection_limit).with_egress(
            self.egress_policy.clone(),
            purpose,
            self.cancellation_token.clone(),
        )
    }

    #[cfg_attr(not(feature = "http-client"), expect(unused_mut))]
    fn into_evaluator(mut self) -> PreparedEvaluator {
        #[cfg(feature = "http-client")]
        let service_client = self
            .with_http_default_service_handler
            .then(|| self.http_client(EgressPurpose::Service));
        #[cfg(feature = "http-client")]
        if let Some(client) = &service_client {
            let version = self.inner.version();
            self.inner = self
                .inner
                .with_default_service_handler(HttpServiceHandler::new(client.clone(), version));
        }
        PreparedEvaluator {
            inner: self.inner,
            #[cfg(feature = "http-client")]
            service_client,
        }
    }

    /// Parse a query and returns a [`PreparedSparqlQuery`] for the current evaluator.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    ///
    /// let store = Store::new()?;
    /// let ex = NamedNode::new("http://example.com")?;
    /// store.insert(Quad::new(
    ///     ex.clone(),
    ///     ex.clone(),
    ///     ex.clone(),
    ///     GraphName::DefaultGraph,
    /// ))?;
    ///
    /// let prepared_query = SparqlEvaluator::new().parse_query("SELECT ?s WHERE { ?s ?p ?o }")?;
    ///
    /// if let QueryResults::Solutions(mut solutions) = prepared_query.on_store(&store).execute()? {
    ///     assert_eq!(
    ///         solutions.next().unwrap()?.get("s"),
    ///         Some(&ex.clone().into())
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn parse_query(
        mut self,
        query: &(impl AsRef<str> + ?Sized),
    ) -> Result<PreparedSparqlQuery, SparqlSyntaxError> {
        let query = take(&mut self.parser).parse_query_with_metadata(query.as_ref())?;
        Ok(self.for_parsed_query(query))
    }

    /// Parses a query, retaining and enforcing its `VERSION` declaration.
    pub fn parse_query_with_metadata(
        mut self,
        query: &(impl AsRef<str> + ?Sized),
    ) -> Result<PreparedSparqlQuery, SparqlSyntaxError> {
        let parsed = take(&mut self.parser).parse_query_with_metadata(query.as_ref())?;
        Ok(self.for_parsed_query(parsed))
    }

    /// Returns a prepared query using the parsed query's effective version.
    pub fn for_parsed_query(mut self, query: ParsedQuery) -> PreparedSparqlQuery {
        self.inner = self.inner.with_version(query.effective_version());
        self.for_query(query.into_query())
    }

    /// Returns a [`PreparedSparqlQuery`] for the current evaluator and SPARQL query.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::*;
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    /// use spargebra::SparqlParser;
    ///
    /// let store = Store::new()?;
    /// let ex = NamedNode::new("http://example.com")?;
    /// store.insert(Quad::new(
    ///     ex.clone(),
    ///     ex.clone(),
    ///     ex.clone(),
    ///     GraphName::DefaultGraph,
    /// ))?;
    ///
    /// let query = SparqlParser::new().parse_query("SELECT ?s WHERE { ?s ?p ?o }")?;
    ///
    /// let prepared_query = SparqlEvaluator::new().for_query(query);
    ///
    /// if let QueryResults::Solutions(mut solutions) = prepared_query.on_store(&store).execute()? {
    ///     assert_eq!(
    ///         solutions.next().unwrap()?.get("s"),
    ///         Some(&ex.clone().into())
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn for_query(self, query: Query) -> PreparedSparqlQuery {
        let dataset = query.dataset().cloned().map(Into::into).unwrap_or_default();
        #[cfg(all(
            not(target_family = "wasm"),
            any(
                feature = "text-index",
                feature = "spatial-index",
                feature = "statistics"
            )
        ))]
        let cancellation_token = self.cancellation_token.clone();
        let evaluator = self.into_evaluator();
        PreparedSparqlQuery {
            dataset,
            query,
            evaluator: evaluator.inner,
            #[cfg(feature = "http-client")]
            service_client: evaluator.service_client,
            substitutions: HashMap::new(),
            #[cfg(all(
                not(target_family = "wasm"),
                any(
                    feature = "text-index",
                    feature = "spatial-index",
                    feature = "statistics"
                )
            ))]
            cancellation_token,
        }
    }

    /// Parse an update and returns a [`PreparedSparqlUpdate`] for the current evaluator.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::sparql::SparqlEvaluator;
    /// use oxigraph::store::Store;
    ///
    /// SparqlEvaluator::new()
    ///     .parse_update(
    ///         "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
    ///     )?
    ///     .on_store(&Store::new()?)
    ///     .execute()?;
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    pub fn parse_update(
        mut self,
        query: &(impl AsRef<str> + ?Sized),
    ) -> Result<PreparedSparqlUpdate, SparqlSyntaxError> {
        let update = take(&mut self.parser).parse_update_with_metadata(query.as_ref())?;
        Ok(self.for_parsed_update(update))
    }

    /// Parses an update, retaining and enforcing its `VERSION` declaration.
    pub fn parse_update_with_metadata(
        mut self,
        update: &(impl AsRef<str> + ?Sized),
    ) -> Result<PreparedSparqlUpdate, SparqlSyntaxError> {
        let parsed = take(&mut self.parser).parse_update_with_metadata(update.as_ref())?;
        Ok(self.for_parsed_update(parsed))
    }

    /// Returns a prepared update using the parsed update's effective version.
    pub fn for_parsed_update(mut self, update: ParsedUpdate) -> PreparedSparqlUpdate {
        self.inner = self.inner.with_version(update.effective_version());
        self.for_update(update.into_update())
    }

    /// Returns a [`PreparedSparqlUpdate`] for the current evaluator and SPARQL update.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::sparql::SparqlEvaluator;
    /// use oxigraph::store::Store;
    /// use spargebra::SparqlParser;
    ///
    /// let update = SparqlParser::new().parse_update(
    ///     "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
    /// )?;
    /// SparqlEvaluator::new()
    ///     .for_update(update)
    ///     .on_store(&Store::new()?)
    ///     .execute()?;
    /// # Ok::<_, Box<dyn std::error::Error>>(())
    /// ```
    pub fn for_update(self, update: Update) -> PreparedSparqlUpdate {
        let cancellation_token = self.cancellation_token.clone();
        #[cfg(feature = "http-client")]
        let client = self.http_client(EgressPurpose::Load);
        let evaluator = self.into_evaluator();
        PreparedSparqlUpdate::new(
            evaluator.inner,
            update,
            cancellation_token,
            #[cfg(feature = "http-client")]
            client,
            #[cfg(feature = "http-client")]
            evaluator.service_client,
        )
    }
}

impl Default for SparqlEvaluator {
    fn default() -> Self {
        Self {
            #[cfg(feature = "http-client")]
            http_timeout: None,
            #[cfg(feature = "http-client")]
            http_redirection_limit: 0,
            #[cfg(feature = "http-client")]
            with_http_default_service_handler: true,
            #[cfg(feature = "http-client")]
            egress_policy: None,
            cancellation_token: None,
            parser: SparqlParser::new(),
            inner: QueryEvaluator::new(),
        }
    }
}

/// A prepared SPARQL query.
///
/// Allows customizing things like the evaluation dataset and substituting variables.
///
/// Usage example:
/// ```
/// use oxigraph::model::{Literal, Variable};
/// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
/// use oxigraph::store::Store;
///
/// let prepared_query = SparqlEvaluator::new()
///     .parse_query("SELECT ?v WHERE {}")?
///     .substitute_variable(Variable::new("v")?, Literal::from(1));
///
/// if let QueryResults::Solutions(mut solutions) =
///     prepared_query.on_store(&Store::new()?).execute()?
/// {
///     assert_eq!(
///         solutions.next().unwrap()?.get("v"),
///         Some(&Literal::from(1).into())
///     );
/// }
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[derive(Clone)]
#[must_use]
pub struct PreparedSparqlQuery {
    evaluator: QueryEvaluator,
    #[cfg(all(
        not(target_family = "wasm"),
        any(
            feature = "text-index",
            feature = "spatial-index",
            feature = "statistics"
        )
    ))]
    cancellation_token: Option<CancellationToken>,
    #[cfg(feature = "http-client")]
    service_client: Option<HttpClient>,
    query: Query,
    dataset: QueryDatasetSpecification,
    substitutions: HashMap<Variable, Term>,
}

#[cfg_attr(
    all(
        not(target_family = "wasm"),
        any(
            feature = "text-index",
            feature = "spatial-index",
            feature = "statistics"
        )
    ),
    expect(
        clippy::multiple_inherent_impl,
        reason = "optional index bindings are isolated in their service modules"
    )
)]
impl PreparedSparqlQuery {
    /// The SPARQL semantic feature mode used during evaluation.
    #[inline]
    pub fn version(&self) -> SparqlVersion {
        self.evaluator.version()
    }

    /// Substitute a variable with a given RDF term in the SPARQL query.
    ///
    /// The variable must be part of the `SELECT` clause to be substituted.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::{Literal, Variable};
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    ///
    /// let prepared_query = SparqlEvaluator::new()
    ///     .parse_query("SELECT ?x ?v WHERE { BIND(?v+1 AS ?x) }")?
    ///     .substitute_variable(Variable::new("v")?, Literal::from(1));
    ///
    /// if let QueryResults::Solutions(mut solutions) =
    ///     prepared_query.on_store(&Store::new()?).execute()?
    /// {
    ///     assert_eq!(
    ///         solutions.next().unwrap()?.get("x"),
    ///         Some(&Literal::from(2).into())
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn substitute_variable(
        mut self,
        variable: impl Into<Variable>,
        term: impl Into<Term>,
    ) -> Self {
        self.substitutions.insert(variable.into(), term.into());
        self
    }

    /// Returns [the query dataset specification](https://www.w3.org/TR/sparql11-query/#specifyingDataset) of this prepared query.
    #[inline]
    pub fn dataset(&self) -> &QueryDataset {
        &self.dataset
    }

    /// Returns [the query dataset specification](https://www.w3.org/TR/sparql11-query/#specifyingDataset) of this prepared query.
    #[inline]
    pub fn dataset_mut(&mut self) -> &mut QueryDataset {
        &mut self.dataset
    }

    /// Bind the prepared query to the [`Store`] it should be evaluated on.
    #[cfg_attr(not(feature = "http-client"), expect(unused_mut))]
    pub fn on_store(mut self, store: &Store) -> BoundPreparedSparqlQuery<'static> {
        let observation = store.start_evaluation_observation(EvaluationOperation::Query);
        #[cfg(feature = "http-client")]
        {
            self.evaluator = bind_store_service(self.evaluator, self.service_client.take(), store);
        }
        let reader = store.storage().snapshot();
        let queryable_dataset = DatasetView::new(reader);
        let mut bound = self.on_queryable_dataset(queryable_dataset);
        bound.observation = Some(observation);
        bound
    }

    /// Binds this query to an owned store snapshot prepared with an explicit
    /// query-time entailment profile.
    pub fn on_store_with_entailment(
        mut self,
        store: &Store,
        options: &QueryEntailmentOptions,
    ) -> Result<BoundPreparedSparqlQuery<'static, QueryEntailmentDataset>, QueryEntailmentError>
    {
        let mut observation = store.start_evaluation_observation(EvaluationOperation::Query);
        #[cfg(feature = "http-client")]
        {
            self.evaluator = bind_store_service(self.evaluator, self.service_client.take(), store);
        }
        let queryable_dataset = match QueryEntailmentDataset::from_store_with_query_dataset(
            store,
            options,
            &self.dataset,
        ) {
            Ok(dataset) => dataset,
            Err(error) => {
                observation.finish_error(&error);
                return Err(error);
            }
        };
        // The query dataset has already been constructed and materialized. A
        // second application of FROM/FROM NAMED here would address the source
        // graph names rather than the effective graph topology.
        self.dataset = QueryDatasetSpecification::default();
        let mut bound = self.on_queryable_dataset(queryable_dataset);
        bound.observation = Some(observation);
        Ok(bound)
    }

    /// Bind the prepared query to the [`Transaction`] it should be evaluated on.
    pub fn on_transaction<'b>(
        self,
        transaction: &'b Transaction<'_>,
    ) -> BoundPreparedSparqlQuery<'b> {
        let reader = transaction.inner().reader();
        let dataset = DatasetView::new(reader);
        self.on_queryable_dataset(dataset)
    }

    /// Bind the prepared query to the [`QueryableDataset`] it should be evaluated on.
    pub fn on_queryable_dataset<'a, D: QueryableDataset<'a>>(
        self,
        queryable_dataset: D,
    ) -> BoundPreparedSparqlQuery<'a, D> {
        BoundPreparedSparqlQuery {
            evaluator: self.evaluator,
            query: self.query,
            queryable_dataset,
            substitutions: self.substitutions,
            dataset: self.dataset,
            marker: PhantomData,
            observation: None,
        }
    }
}

/// A prepared SPARQL query bound to a storage, ready to be executed.
///
/// Usage example:
/// ```
/// use oxigraph::model::{Literal, Variable};
/// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
/// use oxigraph::store::Store;
///
/// let prepared_query = SparqlEvaluator::new()
///     .parse_query("SELECT ?v WHERE {}")?
///     .substitute_variable(Variable::new("v")?, Literal::from(1));
///
/// if let QueryResults::Solutions(mut solutions) =
///     prepared_query.on_store(&Store::new()?).execute()?
/// {
///     assert_eq!(
///         solutions.next().unwrap()?.get("v"),
///         Some(&Literal::from(1).into())
///     );
/// }
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
pub struct BoundPreparedSparqlQuery<'a, D: QueryableDataset<'a> = DatasetView<'a>> {
    evaluator: QueryEvaluator,
    query: Query,
    queryable_dataset: D,
    substitutions: HashMap<Variable, Term>,
    dataset: QueryDatasetSpecification,
    marker: PhantomData<&'a ()>,
    observation: Option<EvaluationObservation>,
}

impl<'a, D: QueryableDataset<'a>> BoundPreparedSparqlQuery<'a, D> {
    /// Substitute a variable with a given RDF term in the SPARQL query.
    ///
    /// The variable must be part of the `SELECT` clause to be substituted.
    ///
    /// Usage example:
    /// ```
    /// use oxigraph::model::{Literal, Variable};
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    ///
    /// let prepared_query = SparqlEvaluator::new()
    ///     .parse_query("SELECT ?x ?v WHERE { BIND(?v+1 AS ?x)}")?
    ///     .on_store(&Store::new()?)
    ///     .substitute_variable(Variable::new("v")?, Literal::from(1));
    ///
    /// if let QueryResults::Solutions(mut solutions) = prepared_query.execute()? {
    ///     assert_eq!(
    ///         solutions.next().unwrap()?.get("x"),
    ///         Some(&Literal::from(2).into())
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn substitute_variable(
        mut self,
        variable: impl Into<Variable>,
        term: impl Into<Term>,
    ) -> Self {
        self.substitutions.insert(variable.into(), term.into());
        self
    }

    /// Evaluate the query against the given store.
    pub fn execute(self) -> Result<QueryResults<'a>, QueryEvaluationError> {
        let mut observation = self.observation;
        if let Some(observation) = &mut observation {
            observation.begin();
        }
        let mut prepared = self.evaluator.prepare(&self.query);
        for (variable, term) in self.substitutions {
            prepared = prepared.substitute_variable(variable, term);
        }
        *prepared.dataset_mut() = self.dataset;
        observe_query_result(prepared.execute(self.queryable_dataset), observation)
    }

    /// Compute statistics during evaluation and fills them in the explanation tree.
    pub fn compute_statistics(mut self) -> Self {
        self.evaluator = self.evaluator.compute_statistics();
        self
    }

    /// Executes a [SPARQL 1.1 query](https://www.w3.org/TR/sparql11-query/) with some options and
    /// returns a query explanation with some statistics (if enabled with the [`compute_statistics`](Self::compute_statistics) option).
    ///
    /// <div class="warning">If you want to compute statistics, you need to exhaust the results iterator before having a look at them.</div>
    ///
    /// Usage example serializing the explanation with statistics in JSON:
    /// ```
    /// use oxigraph::sparql::{QueryResults, SparqlEvaluator};
    /// use oxigraph::store::Store;
    ///
    /// if let (Ok(QueryResults::Solutions(solutions)), explanation) = SparqlEvaluator::new()
    ///     .parse_query("SELECT ?s WHERE { VALUES ?s { 1 2 3 } }")?
    ///     .on_store(&Store::new()?)
    ///     .explain()
    /// {
    ///     // We make sure to have read all the solutions
    ///     for _ in solutions {}
    ///     let mut buf = Vec::new();
    ///     explanation.write_in_json(&mut buf)?;
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn explain(
        self,
    ) -> (
        Result<QueryResults<'a>, QueryEvaluationError>,
        QueryExplanation,
    ) {
        let mut observation = self.observation;
        if let Some(observation) = &mut observation {
            observation.begin();
        }
        let mut prepared = self.evaluator.prepare(&self.query);
        for (variable, term) in self.substitutions {
            prepared = prepared.substitute_variable(variable, term);
        }
        *prepared.dataset_mut() = self.dataset;
        let (result, explanation) = prepared.explain(self.queryable_dataset);
        (observe_query_result(result, observation), explanation)
    }
}
