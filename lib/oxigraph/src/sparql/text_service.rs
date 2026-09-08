//! Explicit local SERVICE extension over one retained native primary snapshot.
use super::dataset::DatasetView;
use super::{
    BoundPreparedSparqlQuery, PreparedSparqlQuery, QueryEvaluationError, QueryResults,
    QuerySolution, QuerySolutionIter, ServiceHandler,
};
use crate::model::vocab::xsd;
use crate::model::{GraphName, Literal, NamedNode, NamedNodeRef, Term, Variable};
use crate::store::{
    BackupCheckpoint, DerivedGeneration, DerivedGenerationError, DerivedGenerationLimits,
    DerivedIndex, DerivedSnapshot, TextError, TextIndexProvider, TextMatch, TextQuery,
    TextQueryMode, TransactionStartControl,
};
use oxiri::Iri;
use oxstr::OxString;
use spargebra::algebra::QueryExpression;
use spargebra::term::{NamedNodePattern, TermPattern};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Local opt-in extension, not an HTTP endpoint or a SPARQL conformance claim.
pub const TEXT_SEARCH_SERVICE: NamedNodeRef<'static> =
    NamedNodeRef::new_unchecked("urn:oxigraph:text:search:v1");
const VOCAB: &str = "urn:oxigraph:text:";

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum TextServiceError {
    #[error(transparent)]
    Text(#[from] TextError),
    #[error("text index admission failed: {0}")]
    Admission(#[source] Arc<DerivedGenerationError>),
    #[error("unsupported text SERVICE v1 pattern: {0}")]
    Pattern(&'static str),
    #[error("text SERVICE consistency must match the explicitly selected binding")]
    Consistency,
    #[error("text SERVICE deadline exceeded")]
    TimedOut,
    #[error("text SERVICE cache ceiling exceeded or cache unavailable")]
    CacheLimit,
}

impl From<TextServiceError> for QueryEvaluationError {
    fn from(error: TextServiceError) -> Self {
        Self::Service(Box::new(error))
    }
}

/// Snapshot metadata independent of rows, including an empty eventual result.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TextQueryContext {
    pub source: BackupCheckpoint,
    /// None means index admission failed; SERVICE evaluation reports that error.
    pub applied: Option<BackupCheckpoint>,
    pub generation: Option<[u8; 32]>,
    pub eventual: bool,
}

/// Opt-in text query with an observation available before execution.
#[must_use]
pub struct BoundTextSparqlQuery {
    query: BoundPreparedSparqlQuery<'static>,
    context: TextQueryContext,
    control: TransactionStartControl,
    started: Instant,
}
impl BoundTextSparqlQuery {
    pub const fn context(&self) -> &TextQueryContext {
        &self.context
    }
    pub fn execute(self) -> Result<TextSparqlResults, QueryEvaluationError> {
        let results = self.query.execute()?;
        // The evaluator may materialize SERVICE rows before returning its own
        // iterator. Preserve both controls across that buffering boundary too.
        check_control(&self.control, self.started)?;
        let control = self.control;
        let started = self.started;
        let results = match results {
            QueryResults::Solutions(rows) => {
                let variables: Arc<[Variable]> = rows.variables().into();
                QueryResults::Solutions(QuerySolutionIter::new(
                    variables,
                    rows.map(move |row| {
                        check_control(&control, started)?;
                        row
                    }),
                ))
            }
            QueryResults::Graph(rows) => {
                QueryResults::Graph(super::QueryTripleIter::new(rows.map(move |row| {
                    check_control(&control, started)?;
                    row
                })))
            }
            QueryResults::Boolean(value) => QueryResults::Boolean(value),
        };
        Ok(TextSparqlResults {
            results,
            context: self.context,
        })
    }
}
/// The normal SPARQL result and its retained primary/index snapshot identities.
pub struct TextSparqlResults {
    pub results: QueryResults<'static>,
    pub context: TextQueryContext,
}

impl PreparedSparqlQuery {
    /// Bind ordinary RDF patterns and the local `urn:oxigraph:text:search:v1`
    /// SERVICE to the SAME retained snapshot. Normal `on_store` is unchanged.
    /// Index admission errors are returned by SERVICE evaluation (and therefore
    /// obey SERVICE SILENT), not substituted with incomplete candidates.
    ///
    /// The SERVICE body is one BGP with a shared literal-result variable:
    /// `?literal <urn:oxigraph:text:query> "words"; <urn:oxigraph:text:score> ?score`.
    /// Join `?s ?p ?literal` outside SERVICE to retrieve RDF subjects. The service
    /// emits distinct projected rows, never physical blank-node subjects.
    /// Query-time FILTER/VALUES/OPTIONAL/order/project belong outside the body.
    /// Graph scope inside SERVICE addresses physical snapshot graphs, independent
    /// of outer FROM/FROM NAMED, just like an explicit service dataset. Ordinary
    /// RDF dataset selection and blank-node merge behavior remain unchanged.
    /// Inputs are constants, not correlated outer bindings. No implicit top-N is
    /// applied; `text:limit` is an explicit SERVICE-wide limit before outer joins.
    /// At most 16 different bodies and `max_candidates` total cached rows are
    /// admitted. Cached serialized term bytes are bounded by `max_inspected_bytes`.
    /// Control timeout runs from binding, including admission and all SERVICE
    /// calls, not independently for each outer row. Release results promptly:
    /// retained snapshots can delay native reclamation.
    pub fn on_text_index(
        self,
        source: DerivedSnapshot,
        index: &DerivedIndex,
        provider: TextIndexProvider,
        limits: DerivedGenerationLimits,
    ) -> BoundTextSparqlQuery {
        self.bind_text_index(source, index, provider, limits, false)
    }

    /// Explicit eventual variant. Each SERVICE body must additionally contain
    /// `<urn:oxigraph:text:consistency> <urn:oxigraph:text:eventual>`; otherwise
    /// it fails. Missing additions are allowed only with both opt-ins. Scope and
    /// primary candidate verification still use the retained query snapshot.
    pub fn on_eventual_text_index(
        self,
        source: DerivedSnapshot,
        index: &DerivedIndex,
        provider: TextIndexProvider,
        limits: DerivedGenerationLimits,
    ) -> BoundTextSparqlQuery {
        self.bind_text_index(source, index, provider, limits, true)
    }

    fn bind_text_index(
        mut self,
        source: DerivedSnapshot,
        index: &DerivedIndex,
        provider: TextIndexProvider,
        mut limits: DerivedGenerationLimits,
        eventual: bool,
    ) -> BoundTextSparqlQuery {
        let started = Instant::now();
        limits.input.control = limits
            .input
            .control
            .with_query_cancellation(self.cancellation_token.take());
        let reader = source.text_query_reader();
        let generation = if eventual {
            index.eventual(&source, &limits)
        } else {
            index.strict(&source, &limits)
        }
        .map(|view| view.generation().clone())
        .map_err(Arc::new);
        let context = TextQueryContext {
            source: source.checkpoint().clone(),
            applied: generation.as_ref().ok().map(|g| g.source().clone()),
            generation: generation.as_ref().ok().map(DerivedGeneration::fingerprint),
            eventual,
        };
        let version = self.version();
        let control = limits.input.control.clone();
        let handler = TextService {
            source,
            generation,
            provider,
            limits,
            eventual,
            started,
            term_guard: spareval::QueryEvaluator::new().with_version(version),
            cache: Mutex::new(Cache::default()),
        };
        #[cfg(feature = "http-client")]
        if let Some(client) = self.service_client.take() {
            // Retain configured HTTP policy/timeout behavior, without attributing
            // snapshot-only queries to a Store metrics owner they do not hold.
            self.evaluator =
                self.evaluator
                    .with_default_service_handler(super::http::HttpServiceHandler::new(
                        client, version,
                    ));
        }
        self.evaluator = self
            .evaluator
            .with_service_handler(TEXT_SEARCH_SERVICE.into_owned(), handler);
        BoundTextSparqlQuery {
            query: self.on_queryable_dataset(DatasetView::new(reader)),
            context,
            control,
            started,
        }
    }
}

struct TextService {
    source: DerivedSnapshot,
    generation: Result<DerivedGeneration, Arc<DerivedGenerationError>>,
    provider: TextIndexProvider,
    limits: DerivedGenerationLimits,
    eventual: bool,
    term_guard: spareval::QueryEvaluator,
    started: Instant,
    cache: Mutex<Cache>,
}

#[derive(Default)]
struct Cache {
    entries: Vec<(QueryExpression, CachedRows)>,
    rows: usize,
    bytes: usize,
}
#[derive(Clone)]
struct CachedRows {
    variables: Arc<[Variable]>,
    rows: Arc<[Vec<Option<Term>>]>,
}
impl CachedRows {
    fn iter(
        &self,
        control: TransactionStartControl,
        started: Instant,
    ) -> QuerySolutionIter<'static> {
        let variables = Arc::clone(&self.variables);
        let rows = Arc::clone(&self.rows);
        QuerySolutionIter::new(
            Arc::clone(&variables),
            (0..rows.len()).map(move |i| {
                check_control(&control, started)?;
                Ok(QuerySolution::from((
                    Arc::clone(&variables),
                    rows[i].clone(),
                )))
            }),
        )
    }
}
impl TextService {
    fn check(&self) -> Result<(), QueryEvaluationError> {
        check_control(&self.limits.input.control, self.started)
    }
}
fn check_control(
    control: &TransactionStartControl,
    started: Instant,
) -> Result<(), QueryEvaluationError> {
    if control.is_cancelled() {
        return Err(QueryEvaluationError::Cancelled);
    }
    if control
        .timeout()
        .is_some_and(|timeout| started.elapsed() >= timeout)
    {
        return Err(TextServiceError::TimedOut.into());
    }
    Ok(())
}
impl ServiceHandler for TextService {
    type Error = QueryEvaluationError;
    fn handle(
        &self,
        expression: &QueryExpression,
        _base: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        self.check()?;
        // Validate constant terms before the extension's structural/type errors
        // can turn an incompatible term into a SILENT-able SERVICE failure.
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
        let mut request = Request::parse(expression)?;
        if request.eventual != self.eventual {
            return Err(TextServiceError::Consistency.into());
        }
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| TextServiceError::CacheLimit)?;
        if let Some((_, rows)) = cache.entries.iter().find(|(key, _)| key == expression) {
            return Ok(rows.iter(self.limits.input.control.clone(), self.started));
        }
        if cache.entries.len() >= 16 {
            return Err(TextServiceError::CacheLimit.into());
        }
        let generation = self
            .generation
            .as_ref()
            .map_err(|error| TextServiceError::Admission(Arc::clone(error)))?;
        // Query every bounded candidate first; requested top-N is applied only
        // after deduplication and repeated output-variable equality checks.
        request.query.limit = self.provider.limits.max_candidates;
        let mut input = self.limits.input.clone();
        if let Some(timeout) = input.control.timeout() {
            input.control = input
                .control
                .with_timeout(timeout.saturating_sub(self.started.elapsed()));
        }
        let result = self.provider.query_snapshot(
            generation,
            &self.source,
            self.eventual,
            &request.query,
            &input,
        );
        self.check()?; // Cancellation remains fatal even with SERVICE SILENT.
        let result = result.map_err(TextServiceError::from)?;
        let variables: Arc<[Variable]> = request.variables().into();
        let mut rows = Vec::new();
        let mut seen = HashSet::new();
        let mut bytes = 0_usize;
        let applied = Literal::from(TextIndexProvider::checkpoint_binding(&result.applied));
        let source = Literal::from(TextIndexProvider::checkpoint_binding(&result.source));
        for hit in result.matches {
            self.check()?;
            // Preserve the selected term model even if the incompatible literal
            // is not requested as an output column by this particular pattern.
            self.term_guard.ensure_term_compatible(&hit.quad.object)?;
            let mut bindings = BTreeMap::new();
            let mut compatible = true;
            for (variable, column) in &request.outputs {
                let value = column.value(&hit, self.eventual, &applied, &source);
                if let Some(value) = value {
                    if let Some(previous) = bindings.insert(variable.clone(), value.clone()) {
                        if previous != value {
                            compatible = false;
                            break;
                        }
                    }
                } else {
                    compatible = false;
                    break;
                }
            }
            if compatible {
                let values = variables
                    .iter()
                    .map(|v| bindings.remove(v))
                    .collect::<Vec<_>>();
                if seen.insert(values.clone()) {
                    for value in values.iter().flatten() {
                        bytes = bytes
                            .checked_add(value.to_string().len())
                            .ok_or(TextServiceError::CacheLimit)?;
                    }
                    if bytes
                        > self
                            .provider
                            .limits
                            .max_inspected_bytes
                            .get()
                            .saturating_sub(cache.bytes)
                    {
                        return Err(TextServiceError::CacheLimit.into());
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
            return Err(TextServiceError::CacheLimit.into());
        }
        self.check()?;
        cache.rows += rows.len();
        cache.bytes += bytes;
        let cached = CachedRows {
            variables,
            rows: rows.into(),
        };
        let iter = cached.iter(self.limits.input.control.clone(), self.started);
        cache.entries.push((expression.clone(), cached));
        Ok(iter)
    }
}

struct Request {
    outputs: Vec<(Variable, Column)>,
    query: TextQuery,
    limit: Option<NonZeroUsize>,
    eventual: bool,
}
impl Request {
    fn parse(expression: &QueryExpression) -> Result<Self, TextServiceError> {
        let QueryExpression::Bgp { patterns } = expression else {
            return Err(TextServiceError::Pattern(
                "body must be one basic graph pattern; place operators outside SERVICE",
            ));
        };
        if patterns.is_empty() || patterns.len() > 16 {
            return Err(TextServiceError::Pattern("expected 1 to 16 fields"));
        }
        let subject = patterns[0].subject.clone();
        let mut outputs = Vec::new();
        match &subject {
            TermPattern::Variable(variable) => outputs.push((variable.clone(), Column::Literal)),
            _ => {
                return Err(TextServiceError::Pattern(
                    "shared subject must be a literal-result variable",
                ));
            }
        }
        let mut query = TextQuery::new("");
        let mut fields = BTreeSet::new();
        let mut limit = None;
        let mut eventual = false;
        for pattern in patterns {
            if pattern.subject != subject {
                return Err(TextServiceError::Pattern(
                    "all fields must share one subject",
                ));
            }
            let NamedNodePattern::NamedNode(predicate) = &pattern.predicate else {
                return Err(TextServiceError::Pattern("field predicate must be an IRI"));
            };
            let field = predicate
                .as_str()
                .strip_prefix(VOCAB)
                .ok_or(TextServiceError::Pattern("unknown field namespace"))?;
            if !fields.insert(field) {
                return Err(TextServiceError::Pattern("duplicate field"));
            }
            match field {
                "query" => query.text = string(&pattern.object, 4096)?,
                "language" => query.language = Some(string(&pattern.object, 255)?),
                "mode" => match iri(&pattern.object)? {
                    "urn:oxigraph:text:all" => query.mode = TextQueryMode::AllTerms,
                    "urn:oxigraph:text:any" => query.mode = TextQueryMode::AnyTerm,
                    _ => {
                        return Err(TextServiceError::Pattern(
                            "mode must be text:all or text:any",
                        ));
                    }
                },
                "consistency" => match iri(&pattern.object)? {
                    "urn:oxigraph:text:strict" => eventual = false,
                    "urn:oxigraph:text:eventual" => eventual = true,
                    _ => {
                        return Err(TextServiceError::Pattern(
                            "consistency must be text:strict or text:eventual",
                        ));
                    }
                },
                "inGraph" => {
                    query.graph =
                        Some(NamedNode::new_unchecked(iri(&pattern.object)?.to_owned()).into())
                }
                "inPredicate" => {
                    query.predicate =
                        Some(NamedNode::new_unchecked(iri(&pattern.object)?.to_owned()))
                }
                "defaultGraph" => {
                    let TermPattern::Literal(value) = &pattern.object else {
                        return Err(TextServiceError::Pattern("defaultGraph requires true"));
                    };
                    if *value.datatype() != xsd::BOOLEAN || !matches!(value.value(), "true" | "1") {
                        return Err(TextServiceError::Pattern("defaultGraph requires true"));
                    }
                    query.graph = Some(GraphName::DefaultGraph);
                }
                "limit" => {
                    let TermPattern::Literal(value) = &pattern.object else {
                        return Err(TextServiceError::Pattern(
                            "limit requires a positive integer",
                        ));
                    };
                    if *value.datatype() != xsd::INTEGER || value.value().len() > 20 {
                        return Err(TextServiceError::Pattern(
                            "limit requires a positive integer",
                        ));
                    }
                    limit = Some(value.value().parse::<NonZeroUsize>().map_err(|_| {
                        TextServiceError::Pattern("limit requires a positive integer")
                    })?);
                }
                "literal" | "predicate" | "graph" | "isDefaultGraph" | "score" | "eventual"
                | "applied" | "source" => {
                    let TermPattern::Variable(variable) = &pattern.object else {
                        return Err(TextServiceError::Pattern(
                            "output field requires a variable",
                        ));
                    };
                    let column = match field {
                        "literal" => Column::Literal,
                        "predicate" => Column::Predicate,
                        "graph" => Column::Graph,
                        "isDefaultGraph" => Column::IsDefaultGraph,
                        "score" => Column::Score,
                        "eventual" => Column::Eventual,
                        "applied" => Column::Applied,
                        _ => Column::Source,
                    };
                    outputs.push((variable.clone(), column));
                }
                _ => return Err(TextServiceError::Pattern("unknown field")),
            }
        }
        if !fields.contains("query") {
            return Err(TextServiceError::Pattern("query field is required"));
        }
        if fields.contains("inGraph") && fields.contains("defaultGraph") {
            return Err(TextServiceError::Pattern(
                "inGraph and defaultGraph are mutually exclusive",
            ));
        }
        Ok(Self {
            outputs,
            query,
            limit,
            eventual,
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
fn string(value: &TermPattern, max: usize) -> Result<String, TextServiceError> {
    let TermPattern::Literal(value) = value else {
        return Err(TextServiceError::Pattern(
            "input requires a constant string",
        ));
    };
    if *value.datatype() != xsd::STRING || value.value().len() > max {
        return Err(TextServiceError::Pattern("input string type or byte limit"));
    }
    Ok(value.value().to_owned())
}
fn iri(value: &TermPattern) -> Result<&str, TextServiceError> {
    match value {
        TermPattern::NamedNode(value) => Ok(value.as_str()),
        _ => Err(TextServiceError::Pattern("input requires a constant IRI")),
    }
}
enum Column {
    Predicate,
    Literal,
    Graph,
    IsDefaultGraph,
    Score,
    Eventual,
    Applied,
    Source,
}
impl Column {
    fn value(
        &self,
        hit: &TextMatch,
        eventual: bool,
        applied: &Literal,
        source: &Literal,
    ) -> Option<Term> {
        Some(match self {
            Self::Predicate => hit.quad.predicate.clone().into(),
            Self::Literal => hit.quad.object.clone(),
            Self::Graph => match &hit.quad.graph_name {
                GraphName::DefaultGraph => return None,
                GraphName::NamedNode(value) => value.clone().into(),
                GraphName::BlankNode(value) => value.clone().into(),
            },
            Self::IsDefaultGraph => {
                Literal::from(hit.quad.graph_name == GraphName::DefaultGraph).into()
            }
            Self::Score => Literal::from(i64::from(hit.score)).into(),
            Self::Eventual => Literal::from(eventual).into(),
            Self::Applied => applied.clone().into(),
            Self::Source => source.clone().into(),
        })
    }
}
