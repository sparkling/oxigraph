//! Source-bound advisory statistics; query truth remains in the native reader.
use super::dataset::DatasetView;
use super::index_service::guard_results;
use super::{
    BoundPreparedSparqlQuery, PreparedSparqlQuery, QueryDatasetSpecification, QueryEvaluationError,
    QueryExplanation, QueryResults,
};
use crate::model::{NamedOrBlankNode, Term};
use crate::store::{
    BackupCheckpoint, DerivedGenerationError, DerivedGenerationLimits, DerivedIndex,
    DerivedSnapshot, StatisticsError, StatisticsProvider, StatisticsSnapshot,
    TransactionStartControl,
};
use spareval::CardinalityEstimator;
use spargebra::term::{GroundTermPattern, NamedNodePattern};
use std::time::Instant;

/// Fixed admission classification; contains no query text, RDF terms or paths.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatisticsAvailability {
    Current,
    Missing,
    Stale,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatisticsQueryContext {
    pub source: BackupCheckpoint,
    pub generation: Option<[u8; 32]>,
    pub availability: StatisticsAvailability,
}

#[must_use]
pub struct BoundStatisticsSparqlQuery {
    query: BoundPreparedSparqlQuery<'static>,
    context: StatisticsQueryContext,
    control: TransactionStartControl,
    started: Instant,
}
impl BoundStatisticsSparqlQuery {
    pub const fn context(&self) -> &StatisticsQueryContext {
        &self.context
    }
    pub fn compute_statistics(mut self) -> Self {
        self.query = self.query.compute_statistics();
        self
    }
    pub fn execute(self) -> Result<QueryResults<'static>, QueryEvaluationError> {
        check(&self.control, self.started)?;
        guard_results(self.query.execute()?, self.control, self.started, check)
    }
    pub fn explain(
        self,
    ) -> Result<
        (
            Result<QueryResults<'static>, QueryEvaluationError>,
            QueryExplanation,
        ),
        QueryEvaluationError,
    > {
        check(&self.control, self.started)?;
        let (result, explanation) = self.query.explain();
        let result = result.and_then(|r| guard_results(r, self.control, self.started, check));
        Ok((result, explanation))
    }
}

impl PreparedSparqlQuery {
    /// Uses advisory statistics and RDF evaluation from the SAME retained source.
    /// Missing, stale, incompatible or corrupt generations select the unchanged
    /// heuristic; cancellation/deadline remain fatal. Admission is read-only.
    ///
    /// The v1 estimator supports one physical default/FROM graph and constant
    /// allowed GRAPH names. Merged/union defaults, variable graphs, paths,
    /// substitutions and unrepresentable terms retain heuristic estimates.
    /// Statistics change costs only, never eliminate algebra or establish truth.
    /// No automatic telemetry is exported. Release results promptly since their
    /// retained snapshot can delay storage reclamation.
    pub fn on_statistics(
        mut self,
        source: DerivedSnapshot,
        index: &DerivedIndex,
        provider: &StatisticsProvider,
        mut limits: DerivedGenerationLimits,
    ) -> Result<BoundStatisticsSparqlQuery, QueryEvaluationError> {
        let started = Instant::now();
        limits.input.control = limits
            .input
            .control
            .with_query_cancellation(self.cancellation_token.take());
        let control = limits.input.control.clone();
        check(&control, started)?;
        let read = index
            .strict(&source, &limits)
            .map_err(StatisticsError::from)
            .and_then(|view| provider.read(&view, &limits.input));
        check(&control, started)?;
        let availability = match &read {
            Ok(_) => StatisticsAvailability::Current,
            Err(StatisticsError::Generation(DerivedGenerationError::Unavailable)) => {
                StatisticsAvailability::Missing
            }
            Err(StatisticsError::Generation(DerivedGenerationError::NotFresh)) => {
                StatisticsAvailability::Stale
            }
            Err(_) => StatisticsAvailability::Rejected,
        };
        let context = StatisticsQueryContext {
            source: source.checkpoint().clone(),
            generation: read
                .as_ref()
                .ok()
                .map(StatisticsSnapshot::generation)
                .copied(),
            availability,
        };
        if let Ok(statistics) = read {
            self.evaluator = self.evaluator.with_cardinality_estimator(DatasetEstimator {
                statistics,
                dataset: self.dataset.clone(),
            });
        }
        #[cfg(feature = "http-client")]
        if let Some(client) = self.service_client.take() {
            let version = self.version();
            self.evaluator =
                self.evaluator
                    .with_default_service_handler(super::http::HttpServiceHandler::new(
                        client, version,
                    ));
        }
        let reader = source.index_query_reader();
        drop(source); // reader owns the same snapshot; do not retain two handles.
        Ok(BoundStatisticsSparqlQuery {
            query: self.on_queryable_dataset(DatasetView::new(reader)),
            context,
            control,
            started,
        })
    }
}

fn check(control: &TransactionStartControl, started: Instant) -> Result<(), QueryEvaluationError> {
    if control.is_cancelled() {
        return Err(QueryEvaluationError::Cancelled);
    }
    if control
        .timeout()
        .is_some_and(|timeout| started.elapsed() >= timeout)
    {
        return Err(QueryEvaluationError::Dataset(Box::new(
            std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "statistics-bound query deadline exceeded",
            ),
        )));
    }
    Ok(())
}

struct DatasetEstimator {
    statistics: StatisticsSnapshot,
    dataset: QueryDatasetSpecification,
}
impl CardinalityEstimator for DatasetEstimator {
    fn estimate_quad_pattern(
        &self,
        subject: &GroundTermPattern,
        predicate: &NamedNodePattern,
        object: &GroundTermPattern,
        graph_name: Option<&NamedNodePattern>,
    ) -> Option<u64> {
        let graph = match graph_name {
            None => match self.dataset.default_graph_graphs()? {
                [] => return Some(0),
                [graph] => graph.clone(),
                graphs if graphs.iter().all(|g| g == &graphs[0]) => graphs[0].clone(),
                _ => return None,
            },
            Some(NamedNodePattern::NamedNode(graph)) => {
                if self
                    .dataset
                    .available_named_graphs()
                    .is_some_and(|graphs| !graphs.contains(&graph.clone().into()))
                {
                    return Some(0);
                }
                graph.clone().into()
            }
            Some(NamedNodePattern::Variable(_)) => return None,
        };
        // Repeated variables impose equality constraints not described by
        // independent marginals. Nested triple patterns may contain variables.
        let mut variables = Vec::new();
        for term in [subject, object] {
            if let GroundTermPattern::Variable(v) = term {
                variables.push(v);
            }
        }
        if let NamedNodePattern::Variable(v) = predicate {
            variables.push(v);
        }
        if variables
            .iter()
            .enumerate()
            .any(|(i, v)| variables[..i].contains(v))
        {
            return None;
        }
        let subject = constant(subject)?;
        let object = constant(object)?;
        let predicate = match predicate {
            NamedNodePattern::NamedNode(p) => Some(p),
            NamedNodePattern::Variable(_) => None,
        };
        let total = self.statistics.count_quads(Some(&graph), predicate);
        if subject.is_none() && object.is_none() {
            return Some(total);
        }
        let predicate = predicate?;
        let Some(scope) = self.statistics.scope(&graph, predicate) else {
            return Some(0);
        };
        let subject = match subject {
            Some(Term::NamedNode(n)) => Some(NamedOrBlankNode::NamedNode(n)),
            Some(_) => return None,
            None => None,
        };
        let subject_upper = subject.as_ref().map_or(Some(total), |s| {
            scope.subject_frequency(s).ok().map(|f| f.upper)
        })?;
        let object_upper = object.as_ref().map_or(Some(total), |o| {
            scope.object_frequency(o).ok().map(|f| f.upper)
        })?;
        // Conservative upper point hint, no independence/correlation claim.
        Some(subject_upper.min(object_upper).min(total))
    }
}
fn constant(pattern: &GroundTermPattern) -> Option<Option<Term>> {
    match pattern {
        GroundTermPattern::Variable(_) => Some(None),
        GroundTermPattern::NamedNode(n) => Some(Some(n.clone().into())),
        GroundTermPattern::Literal(l) => Some(Some(l.clone().into())),
        #[cfg(feature = "rdf-12")]
        GroundTermPattern::Triple(_) => None,
    }
}
