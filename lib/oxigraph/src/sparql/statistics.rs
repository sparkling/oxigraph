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
use spargebra::term::{GroundTermPattern, NamedNodePattern, Variable};
use std::sync::Arc;
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
    distinct_estimation_profile: Option<&'static str>,
}
impl BoundStatisticsSparqlQuery {
    pub const fn context(&self) -> &StatisticsQueryContext {
        &self.context
    }
    /// Optional admitted observation profile, not an assertion that this query
    /// used NDV hints. Unsupported patterns and older cost models ignore them.
    pub const fn distinct_estimation_profile(&self) -> Option<&'static str> {
        self.distinct_estimation_profile
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
        self.bind_statistics(
            source,
            read.ok().map(Arc::new),
            availability,
            control,
            started,
        )
    }

    /// Reuses an independently verified, immutable statistics snapshot without
    /// reopening its generation or reconstructing primary statistics per query.
    /// Obtain it using [`StatisticsProvider::read`], then share it using [`Arc`].
    ///
    /// Both the private live-store identity and complete physical checkpoint
    /// must match the supplied retained source. Store clones share identity;
    /// a reopen or a copied database does not, even with identical disk IDs.
    /// A mismatch selects heuristic costs and reports `Stale`; it never changes
    /// the RDF source or refreshes statistics. The owned observations remain
    /// valid for their exact source even if generation files subsequently change.
    /// This is explicit snapshot reuse, not a cache of current-store statistics.
    /// Dataset scope, cancellation, deadlines and fallback rules are unchanged.
    pub fn on_statistics_snapshot(
        mut self,
        source: DerivedSnapshot,
        statistics: Arc<StatisticsSnapshot>,
        control: TransactionStartControl,
    ) -> Result<BoundStatisticsSparqlQuery, QueryEvaluationError> {
        let started = Instant::now();
        let control = control.with_query_cancellation(self.cancellation_token.take());
        check(&control, started)?;
        let current = statistics.matches_source(&source);
        self.bind_statistics(
            source,
            current.then_some(statistics),
            if current {
                StatisticsAvailability::Current
            } else {
                StatisticsAvailability::Stale
            },
            control,
            started,
        )
    }

    fn bind_statistics(
        mut self,
        source: DerivedSnapshot,
        statistics: Option<Arc<StatisticsSnapshot>>,
        availability: StatisticsAvailability,
        control: TransactionStartControl,
        started: Instant,
    ) -> Result<BoundStatisticsSparqlQuery, QueryEvaluationError> {
        check(&control, started)?;
        let context = StatisticsQueryContext {
            source: source.checkpoint().clone(),
            generation: statistics
                .as_ref()
                .map(|statistics| *statistics.generation()),
            availability,
        };
        let distinct_estimation_profile = statistics
            .as_ref()
            .and_then(|s| s.distinct_estimation_profile());
        if let Some(statistics) = statistics {
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
            distinct_estimation_profile,
        })
    }
}

fn check(control: &TransactionStartControl, started: Instant) -> Result<(), QueryEvaluationError> {
    if let Some(reason) = control.cancellation_reason() {
        return Err(match reason {
            spareval::CancellationReason::Cancelled => QueryEvaluationError::Cancelled,
            spareval::CancellationReason::TimedOut => QueryEvaluationError::TimedOut,
        });
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
    statistics: Arc<StatisticsSnapshot>,
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

    fn estimate_distinct_values(
        &self,
        subject: &GroundTermPattern,
        predicate: &NamedNodePattern,
        object: &GroundTermPattern,
        graph_name: Option<&NamedNodePattern>,
        variable: &Variable,
    ) -> Option<u64> {
        self.statistics.distinct_estimation_profile()?;
        let NamedNodePattern::NamedNode(p) = predicate else {
            return None;
        };
        // Validate term/repetition/dataset support even for an empty scope.
        constant(subject)?;
        constant(object)?;
        let is_subject = matches!(subject, GroundTermPattern::Variable(v) if v == variable);
        let is_object = matches!(object, GroundTermPattern::Variable(v) if v == variable);
        if is_subject == is_object {
            return None;
        }
        let rows = self.estimate_quad_pattern(subject, predicate, object, graph_name)?;
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
        let (subjects, objects) = self.statistics.distinct_values(&graph, p)?;
        // Scope NDV is not conditioned on the other endpoint. Clamping to the
        // marginal row hint is advisory, not a conjunction/intersection bound.
        Some(if is_subject { subjects } else { objects }.min(rows))
    }
}
#[cfg_attr(
    not(feature = "rdf-12"),
    expect(
        clippy::unnecessary_wraps,
        reason = "Shared signature distinguishes unsupported RDF 1.2 triples from variable terms"
    )
)]
fn constant(pattern: &GroundTermPattern) -> Option<Option<Term>> {
    match pattern {
        GroundTermPattern::Variable(_) => Some(None),
        GroundTermPattern::NamedNode(n) => Some(Some(n.clone().into())),
        GroundTermPattern::Literal(l) => Some(Some(l.clone().into())),
        #[cfg(feature = "rdf-12")]
        GroundTermPattern::Triple(_) => None,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::model::{Literal, NamedNode};
    use crate::sparql::SparqlEvaluator;
    use crate::store::{DerivedProvider, DistinctStatisticsLimits, Store};

    #[test]
    fn distinct_adapter_scopes_and_conditions_only_supported_variables()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let store = Store::open(directory.path().join("db"))?;
        store.load_from_slice(
            crate::io::RdfFormat::TriG,
            "<urn:s1> <urn:p> 'red' . <urn:s2> <urn:p> 'red' . <urn:s3> <urn:p> 'blue' .
             <urn:g> { <urn:s1> <urn:p> 'green' . }",
        )?;
        let provider = StatisticsProvider::default();
        let limits = DerivedGenerationLimits::default();
        let source = store.derived_snapshot(&TransactionStartControl::new())?;
        let mut index = DerivedIndex::create(directory.path().join("stats"), provider.identity())?;
        let generation = index.rebuild(&source, &provider, &limits)?;
        index.activate(&generation, &source, &provider, &limits)?;
        let statistics = Arc::new(provider.read_with_distinct_estimates(
            &index.strict(&source, &limits)?,
            &limits.input,
            &DistinctStatisticsLimits::default(),
        )?);
        let estimator = |query: &str| -> Result<_, crate::sparql::SparqlSyntaxError> {
            Ok(DatasetEstimator {
                statistics: Arc::clone(&statistics),
                dataset: SparqlEvaluator::new().parse_query(query)?.dataset,
            })
        };
        let s = Variable::new("s")?;
        let o = Variable::new("o")?;
        let subject = GroundTermPattern::Variable(s.clone());
        let object = GroundTermPattern::Variable(o.clone());
        let predicate = NamedNodePattern::NamedNode(NamedNode::new("urn:p")?);
        let default = estimator("SELECT * { ?s ?p ?o }")?;
        let estimate = <DatasetEstimator as CardinalityEstimator>::estimate_distinct_values;
        assert_eq!(
            estimate(&default, &subject, &predicate, &object, None, &s),
            Some(3)
        );
        assert_eq!(
            estimate(&default, &subject, &predicate, &object, None, &o),
            Some(2)
        );
        assert_eq!(
            estimate(
                &default,
                &subject,
                &predicate,
                &GroundTermPattern::Literal(Literal::from("red")),
                None,
                &s
            ),
            Some(2)
        );
        assert_eq!(
            estimate(
                &default,
                &GroundTermPattern::NamedNode(NamedNode::new("urn:s1")?),
                &predicate,
                &object,
                None,
                &o
            ),
            Some(1)
        );
        assert_eq!(
            estimate(&default, &subject, &predicate, &subject, None, &s),
            None
        );
        assert_eq!(
            estimate(
                &default,
                &subject,
                &NamedNodePattern::Variable(s.clone()),
                &object,
                None,
                &s
            ),
            None
        );
        assert_eq!(
            estimate(
                &default,
                &subject,
                &predicate,
                &object,
                Some(&NamedNodePattern::Variable(s.clone())),
                &s
            ),
            None
        );
        assert_eq!(
            estimate(
                &default,
                &subject,
                &predicate,
                &object,
                None,
                &Variable::new("absent")?
            ),
            None
        );
        let named = estimator("SELECT * FROM <urn:g> FROM <urn:g> { ?s ?p ?o }")?;
        assert_eq!(
            estimate(&named, &subject, &predicate, &object, None, &s),
            Some(1)
        );
        let merged = estimator("SELECT * FROM <urn:g> FROM <urn:h> { ?s ?p ?o }")?;
        assert_eq!(
            estimate(&merged, &subject, &predicate, &object, None, &s),
            None
        );
        let excluded = estimator("SELECT * FROM NAMED <urn:h> { GRAPH <urn:g> { ?s ?p ?o } }")?;
        assert_eq!(
            estimate(
                &excluded,
                &subject,
                &predicate,
                &object,
                Some(&NamedNodePattern::NamedNode(NamedNode::new("urn:g")?)),
                &s
            ),
            Some(0)
        );
        assert_eq!(
            estimate(&excluded, &subject, &predicate, &object, None, &s),
            Some(0)
        );
        Ok(())
    }
}
