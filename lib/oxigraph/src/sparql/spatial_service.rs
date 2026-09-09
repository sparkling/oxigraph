//! Opt-in local spatial literal relation on one retained primary snapshot.
use super::dataset::DatasetView;
use super::index_service::{Cache, CachedRows, guard_results};
use super::{
    BoundPreparedSparqlQuery, PreparedSparqlQuery, QueryEvaluationError, QueryResults,
    QuerySolutionIter, ServiceHandler,
};
use crate::model::vocab::xsd;
use crate::model::{GraphName, Literal, NamedNode, NamedNodeRef, Quad, Term, Variable};
use crate::store::{
    BackupCheckpoint, DerivedGeneration, DerivedGenerationError, DerivedGenerationLimits,
    DerivedIndex, DerivedSnapshot, SpatialError, SpatialIndexProvider, SpatialQuery,
    TransactionStartControl,
};
use oxiri::Iri;
use oxstr::OxString;
use spargebra::algebra::QueryExpression;
use spargebra::term::{NamedNodePattern, TermPattern};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Local opt-in extension, not an HTTP endpoint or conformance advertisement.
pub const SPATIAL_SEARCH_SERVICE: NamedNodeRef<'static> =
    NamedNodeRef::new_unchecked("urn:oxigraph:spatial:search:v1");
const VOCAB: &str = "urn:oxigraph:spatial:";

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum SpatialServiceError {
    #[error(transparent)]
    Spatial(#[from] SpatialError),
    #[error("spatial index admission failed: {0}")]
    Admission(#[source] Arc<DerivedGenerationError>),
    #[error("unsupported spatial SERVICE v1 pattern: {0}")]
    Pattern(&'static str),
    #[error("spatial SERVICE deadline exceeded")]
    TimedOut,
    #[error("spatial SERVICE cache ceiling exceeded or cache unavailable")]
    CacheLimit,
}
impl From<SpatialServiceError> for QueryEvaluationError {
    fn from(error: SpatialServiceError) -> Self {
        Self::Service(Box::new(error))
    }
}

/// Index/primary identities remain observable even when no rows match.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpatialQueryContext {
    pub source: BackupCheckpoint,
    /// None means admission failed; invoking SERVICE reports the error.
    pub applied: Option<BackupCheckpoint>,
    pub generation: Option<[u8; 32]>,
}
#[must_use]
pub struct BoundSpatialSparqlQuery {
    query: BoundPreparedSparqlQuery<'static>,
    context: SpatialQueryContext,
    control: TransactionStartControl,
    started: Instant,
}
impl BoundSpatialSparqlQuery {
    pub const fn context(&self) -> &SpatialQueryContext {
        &self.context
    }
    pub fn execute(self) -> Result<SpatialSparqlResults, QueryEvaluationError> {
        check_control(&self.control, self.started)?;
        let results = guard_results(
            self.query.execute()?,
            self.control,
            self.started,
            check_control,
        )?;
        Ok(SpatialSparqlResults {
            results,
            context: self.context,
        })
    }
}
pub struct SpatialSparqlResults {
    pub results: QueryResults<'static>,
    pub context: SpatialQueryContext,
}

impl PreparedSparqlQuery {
    /// Binds ordinary RDF patterns and `urn:oxigraph:spatial:search:v1` to the
    /// SAME retained snapshot. Standard `on_store` and exact functions are unchanged.
    ///
    /// Body: `?literal spatial:geometry "POINT(1 2)"^^geo:wktLiteral;
    /// spatial:relation geof:sfWithin`, where `spatial:` is `urn:oxigraph:spatial:`.
    /// The relation is evaluated as `relation(candidate_literal, input_geometry)`.
    /// Inputs must be constants. Join `?s ?p ?literal` outside SERVICE to retrieve
    /// subjects under normal FROM/RDF-merge rules. Graph/predicate service filters
    /// qualify literal existence; they do not restrict later ordinary RDF joins.
    ///
    /// Admission/profile errors obey SERVICE SILENT: it can preserve a row without
    /// any spatial match. To require success, request `spatial:matched ?ok` with a
    /// fresh, otherwise-unbound variable and use `FILTER(?ok)` outside SERVICE.
    /// Cancellation remains fatal. There is no eventual spatial binding.
    ///
    /// No implicit result limit. An explicit positive `spatial:limit` applies to
    /// distinct projected SERVICE rows before outer joins. Cache bounds: 16 bodies,
    /// provider max_candidates total rows and max_index_bytes serialized term bytes.
    /// Timeout starts at binding and covers admission, SERVICE and row consumption.
    /// Release results promptly; retained snapshots can delay native reclamation.
    pub fn on_spatial_index(
        mut self,
        source: DerivedSnapshot,
        index: &DerivedIndex,
        provider: SpatialIndexProvider,
        mut limits: DerivedGenerationLimits,
    ) -> BoundSpatialSparqlQuery {
        let started = Instant::now();
        limits.input.control = limits
            .input
            .control
            .with_query_cancellation(self.cancellation_token.take());
        let reader = source.index_query_reader();
        let generation = index
            .strict(&source, &limits)
            .map(|view| view.generation().clone())
            .map_err(Arc::new);
        let context = SpatialQueryContext {
            source: source.checkpoint().clone(),
            applied: generation.as_ref().ok().map(|g| g.source().clone()),
            generation: generation.as_ref().ok().map(DerivedGeneration::fingerprint),
        };
        let control = limits.input.control.clone();
        let version = self.version();
        let handler = SpatialService {
            source,
            generation,
            provider,
            limits,
            started,
            term_guard: spareval::QueryEvaluator::new().with_version(version),
            cache: Mutex::new(Cache::default()),
        };
        #[cfg(feature = "http-client")]
        if let Some(client) = self.service_client.take() {
            self.evaluator =
                self.evaluator
                    .with_default_service_handler(super::http::HttpServiceHandler::new(
                        client, version,
                    ));
        }
        self.evaluator = self
            .evaluator
            .with_service_handler(SPATIAL_SEARCH_SERVICE.into_owned(), handler);
        BoundSpatialSparqlQuery {
            query: self.on_queryable_dataset(DatasetView::new(reader)),
            context,
            control,
            started,
        }
    }
}
struct SpatialService {
    source: DerivedSnapshot,
    generation: Result<DerivedGeneration, Arc<DerivedGenerationError>>,
    provider: SpatialIndexProvider,
    limits: DerivedGenerationLimits,
    started: Instant,
    term_guard: spareval::QueryEvaluator,
    cache: Mutex<Cache>,
}
fn check_control(
    control: &TransactionStartControl,
    started: Instant,
) -> Result<(), QueryEvaluationError> {
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
        return Err(SpatialServiceError::TimedOut.into());
    }
    Ok(())
}
impl SpatialService {
    fn check(&self) -> Result<(), QueryEvaluationError> {
        check_control(&self.limits.input.control, self.started)
    }
}
impl ServiceHandler for SpatialService {
    type Error = QueryEvaluationError;
    fn handle(
        &self,
        expression: &QueryExpression,
        _base: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        self.check()?;
        // Mode errors must remain fatal, before any SILENT-able pattern error.
        if let QueryExpression::Bgp { patterns } = expression {
            for pattern in patterns {
                self.check()?;
                for term in [&pattern.subject, &pattern.object] {
                    if let Ok(term) = Term::try_from(term.clone()) {
                        self.term_guard.ensure_term_compatible(&term)?;
                    }
                }
            }
        }
        let request = Request::parse(expression)?;
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| SpatialServiceError::CacheLimit)?;
        if let Some((_, rows)) = cache.entries.iter().find(|(key, _)| key == expression) {
            return Ok(rows.iter(
                self.limits.input.control.clone(),
                self.started,
                check_control,
            ));
        }
        if cache.entries.len() >= 16 {
            return Err(SpatialServiceError::CacheLimit.into());
        }
        let generation = self
            .generation
            .as_ref()
            .map_err(|error| SpatialServiceError::Admission(Arc::clone(error)))?;
        let mut input = self.limits.input.clone();
        if let Some(timeout) = input.control.timeout() {
            input.control = input
                .control
                .with_timeout(timeout.saturating_sub(self.started.elapsed()));
        }
        // No native output limit: apply explicit SERVICE limit only after row
        // equality/deduplication, with every candidate covered by native bounds.
        let result = self
            .provider
            .query_snapshot(generation, &self.source, &request.query, &input);
        self.check()?;
        let result = result.map_err(SpatialServiceError::from)?;
        let variables: Arc<[Variable]> = request.variables().into();
        let mut rows = Vec::new();
        let mut seen = HashSet::new();
        let mut bytes = 0_usize;
        for quad in result.matches {
            self.check()?;
            self.term_guard.ensure_term_compatible(&quad.object)?;
            let mut bindings = BTreeMap::new();
            let mut compatible = true;
            for (variable, column) in &request.outputs {
                let Some(value) = column.value(&quad) else {
                    compatible = false;
                    break;
                };
                if let Some(previous) = bindings.insert(variable.clone(), value.clone()) {
                    if previous != value {
                        compatible = false;
                        break;
                    }
                }
            }
            if compatible {
                let values: Vec<_> = variables.iter().map(|v| bindings.remove(v)).collect();
                if seen.insert(values.clone()) {
                    for value in values.iter().flatten() {
                        bytes = bytes
                            .checked_add(value.to_string().len())
                            .ok_or(SpatialServiceError::CacheLimit)?;
                    }
                    if bytes
                        > self
                            .provider
                            .limits
                            .max_index_bytes
                            .get()
                            .saturating_sub(cache.bytes)
                    {
                        return Err(SpatialServiceError::CacheLimit.into());
                    }
                    rows.push(values);
                }
            }
        }
        if let Some(limit) = request.limit {
            rows.truncate(limit.get());
        }
        if rows.len()
            > self
                .provider
                .limits
                .max_candidates
                .get()
                .saturating_sub(cache.rows)
        {
            return Err(SpatialServiceError::CacheLimit.into());
        }
        self.check()?;
        cache.rows += rows.len();
        cache.bytes += bytes;
        let cached = CachedRows {
            variables,
            rows: rows.into(),
        };
        let iter = cached.iter(
            self.limits.input.control.clone(),
            self.started,
            check_control,
        );
        cache.entries.push((expression.clone(), cached));
        Ok(iter)
    }
}
struct Request {
    query: SpatialQuery,
    outputs: Vec<(Variable, Column)>,
    limit: Option<NonZeroUsize>,
}
impl Request {
    fn parse(expression: &QueryExpression) -> Result<Self, SpatialServiceError> {
        let QueryExpression::Bgp { patterns } = expression else {
            return Err(SpatialServiceError::Pattern(
                "body must be one BGP; put operators outside SERVICE",
            ));
        };
        if !(2..=12).contains(&patterns.len()) {
            return Err(SpatialServiceError::Pattern(
                "expected 2 to 12 distinct fields",
            ));
        }
        let subject = &patterns[0].subject;
        let TermPattern::Variable(variable) = subject else {
            return Err(SpatialServiceError::Pattern(
                "shared subject must be a literal-result variable",
            ));
        };
        let mut outputs = vec![(variable.clone(), Column::Literal)];
        let mut fields = BTreeSet::new();
        let (mut geometry, mut relation, mut graph, mut predicate, mut limit) =
            (None, None, None, None, None);
        for pattern in patterns {
            if &pattern.subject != subject {
                return Err(SpatialServiceError::Pattern(
                    "all fields must share a subject",
                ));
            }
            let NamedNodePattern::NamedNode(field) = &pattern.predicate else {
                return Err(SpatialServiceError::Pattern(
                    "field predicate must be an IRI",
                ));
            };
            let field = field
                .as_str()
                .strip_prefix(VOCAB)
                .ok_or(SpatialServiceError::Pattern("unknown field namespace"))?;
            if !fields.insert(field) {
                return Err(SpatialServiceError::Pattern("duplicate field"));
            }
            match field {
                "geometry" => {
                    let TermPattern::Literal(value) = &pattern.object else {
                        return Err(SpatialServiceError::Pattern(
                            "geometry must be a constant literal",
                        ));
                    };
                    geometry = Some(value.clone());
                }
                "relation" => relation = Some(iri(&pattern.object)?.clone()),
                "inGraph" => graph = Some(GraphName::from(iri(&pattern.object)?.clone())),
                "inPredicate" => predicate = Some(iri(&pattern.object)?.clone()),
                "defaultGraph" => {
                    let TermPattern::Literal(value) = &pattern.object else {
                        return Err(SpatialServiceError::Pattern("defaultGraph requires true"));
                    };
                    if *value.datatype() != xsd::BOOLEAN || !matches!(value.value(), "true" | "1") {
                        return Err(SpatialServiceError::Pattern("defaultGraph requires true"));
                    }
                    graph = Some(GraphName::DefaultGraph);
                }
                "limit" => {
                    let TermPattern::Literal(value) = &pattern.object else {
                        return Err(SpatialServiceError::Pattern(
                            "limit requires positive integer",
                        ));
                    };
                    if *value.datatype() != xsd::INTEGER || value.value().len() > 20 {
                        return Err(SpatialServiceError::Pattern(
                            "limit requires positive integer",
                        ));
                    }
                    limit = Some(value.value().parse::<NonZeroUsize>().map_err(|_| {
                        SpatialServiceError::Pattern("limit requires positive integer")
                    })?);
                }
                "literal" | "predicate" | "graph" | "isDefaultGraph" | "matched" => {
                    let TermPattern::Variable(variable) = &pattern.object else {
                        return Err(SpatialServiceError::Pattern("output requires variable"));
                    };
                    let column = match field {
                        "literal" => Column::Literal,
                        "predicate" => Column::Predicate,
                        "graph" => Column::Graph,
                        "isDefaultGraph" => Column::IsDefaultGraph,
                        _ => Column::Matched,
                    };
                    outputs.push((variable.clone(), column));
                }
                _ => return Err(SpatialServiceError::Pattern("unknown field")),
            }
        }
        if fields.contains("inGraph") && fields.contains("defaultGraph") {
            return Err(SpatialServiceError::Pattern(
                "inGraph and defaultGraph are mutually exclusive",
            ));
        }
        let mut query = SpatialQuery::new(
            geometry.ok_or(SpatialServiceError::Pattern("geometry is required"))?,
            relation.ok_or(SpatialServiceError::Pattern("relation is required"))?,
        );
        query.graph = graph;
        query.predicate = predicate;
        Ok(Self {
            query,
            outputs,
            limit,
        })
    }
    fn variables(&self) -> Vec<Variable> {
        self.outputs
            .iter()
            .map(|(v, _)| v.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
}
fn iri(value: &TermPattern) -> Result<&NamedNode, SpatialServiceError> {
    match value {
        TermPattern::NamedNode(value) => Ok(value),
        _ => Err(SpatialServiceError::Pattern("input requires constant IRI")),
    }
}
enum Column {
    Literal,
    Predicate,
    Graph,
    IsDefaultGraph,
    Matched,
}
impl Column {
    fn value(&self, quad: &Quad) -> Option<Term> {
        Some(match self {
            Self::Literal => quad.object.clone(),
            Self::Predicate => quad.predicate.clone().into(),
            Self::Graph => match &quad.graph_name {
                GraphName::DefaultGraph => return None,
                GraphName::NamedNode(node) => node.clone().into(),
                GraphName::BlankNode(node) => node.clone().into(),
            },
            Self::IsDefaultGraph => {
                Literal::from(quad.graph_name == GraphName::DefaultGraph).into()
            }
            Self::Matched => Literal::from(true).into(),
        })
    }
}
