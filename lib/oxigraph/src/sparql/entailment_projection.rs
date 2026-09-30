//! Strict SPARQL binding over one admitted finite-RDFS projection generation (ADR-0032).
//!
//! A prepared query is bound to exactly one strict [`DerivedView`] through the accepted immutable
//! [`EntailmentProjectionSnapshot::hydrate`] API. There is no `Store` argument, no later Store
//! snapshot, no ACTIVE lookup, no provider recomputation and no fallback to full materialization.
//!
//! Only the canonical default dataset is supported: the physical default graph plus every named
//! graph, with GRAPH patterns evaluated graph-locally. Graph-local cached inference cannot supply
//! consequences that require inference after graph merging, so an original `FROM`/`FROM NAMED`
//! clause is rejected even when the effective dataset was later reset, and so is any effective
//! specification that is not the default one (union, custom or duplicate default selections and
//! named-graph restrictions). Scope, profile, consistency, provider identity and the exact
//! required checkpoint are all checked before any payload I/O.
//!
//! After hydration a private visible [`Dataset`] is built from the hydrated image and entailed-only
//! records. Each distinct named-graph declaration and quad is admitted against two caller
//! ceilings before insertion: a record count and a logical estimate of 160 bytes plus the display
//! length. Blank-node identities, nested triple terms and empty graphs are preserved unchanged;
//! nothing is merged or relabelled. The estimate is not an RSS bound: the hydrated snapshot and
//! the visible copy coexist, and allocator overhead is neither measured nor bounded.
//!
//! The optional binding timeout shares one entry clock across validation, hydration (which
//! receives only the remaining budget), visible admission and final publication; it ends when
//! binding succeeds. The evaluator cancellation token and its absolute deadline stay effective
//! during binding and during lazy execution through the existing `&Dataset` query adapter.
use super::{
    CancellationReason, CancellationToken, PreparedSparqlQuery, QueryEntailment,
    QueryEvaluationError, QueryExplanation, QueryResults,
};
use crate::model::{Dataset, GraphName, NamedOrBlankNode, Term, Variable};
use crate::store::{
    BackupCheckpoint, DerivedGenerationError, DerivedView, EntailmentProjectionHydrationError,
    EntailmentProjectionHydrationLimits, EntailmentProjectionHydrationResource,
    EntailmentProjectionLimits, EntailmentProjectionSnapshot, StorageError,
    TransactionStartControl, entailment_projection_identity,
};
use std::collections::HashSet;
use std::fmt;
use std::num::NonZeroU64;
use std::time::{Duration, Instant};

/// Logical charge per visible quad or named-graph declaration, before its display length.
const RECORD_OVERHEAD: u64 = 160;

type Kind = QueryEntailmentProjectionErrorKind;

/// Mandatory options for binding a prepared query to one admitted projection generation.
///
/// There is deliberately no `Default`: every ceiling and the required checkpoint are explicit.
#[derive(Clone, Debug)]
pub struct QueryEntailmentProjectionOptions {
    profile: QueryEntailment,
    required_checkpoint: BackupCheckpoint,
    hydration: EntailmentProjectionHydrationLimits,
    max_visible_records: NonZeroU64,
    max_visible_estimated_bytes: NonZeroU64,
    timeout: Option<Duration>,
}

impl QueryEntailmentProjectionOptions {
    /// `profile` must be [`QueryEntailment::Rdfs12Finite`]. `required_checkpoint` must equal both
    /// the view's primary snapshot checkpoint and the generation's applied checkpoint.
    /// `max_visible_records` counts distinct visible quads plus distinct named-graph declarations;
    /// `max_visible_estimated_bytes` charges each of them 160 bytes plus its display length.
    pub fn new(
        profile: QueryEntailment,
        required_checkpoint: BackupCheckpoint,
        hydration: EntailmentProjectionHydrationLimits,
        max_visible_records: NonZeroU64,
        max_visible_estimated_bytes: NonZeroU64,
    ) -> Self {
        Self {
            profile,
            required_checkpoint,
            hydration,
            max_visible_records,
            max_visible_estimated_bytes,
            timeout: None,
        }
    }

    /// Relative binding budget from entry to successful publication. It never applies to
    /// execution; use the evaluator cancellation token and its deadline for that.
    #[must_use]
    pub const fn with_timeout(mut self, timeout: Option<Duration>) -> Self {
        self.timeout = timeout;
        self
    }

    pub const fn profile(&self) -> QueryEntailment {
        self.profile
    }

    pub const fn required_checkpoint(&self) -> &BackupCheckpoint {
        &self.required_checkpoint
    }

    pub const fn hydration_limits(&self) -> &EntailmentProjectionHydrationLimits {
        &self.hydration
    }

    pub const fn max_visible_records(&self) -> NonZeroU64 {
        self.max_visible_records
    }

    pub const fn max_visible_estimated_bytes(&self) -> NonZeroU64 {
        self.max_visible_estimated_bytes
    }

    pub const fn timeout(&self) -> Option<Duration> {
        self.timeout
    }
}

/// Immutable provenance of a projection binding.
///
/// Requested identities are always present. Observed identities are recorded only once they have
/// been read from the admitted view or the hydrated snapshot; a successful binding has all of them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueryEntailmentProjectionContext {
    requested_profile: QueryEntailment,
    required_checkpoint: BackupCheckpoint,
    source_checkpoint: Option<BackupCheckpoint>,
    applied_checkpoint: Option<BackupCheckpoint>,
    generation_fingerprint: Option<[u8; 32]>,
    build_limits: Option<EntailmentProjectionLimits>,
}

impl QueryEntailmentProjectionContext {
    fn requested(options: &QueryEntailmentProjectionOptions) -> Self {
        Self {
            requested_profile: options.profile,
            required_checkpoint: options.required_checkpoint.clone(),
            source_checkpoint: None,
            applied_checkpoint: None,
            generation_fingerprint: None,
            build_limits: None,
        }
    }

    pub const fn requested_profile(&self) -> QueryEntailment {
        self.requested_profile
    }

    pub const fn required_checkpoint(&self) -> &BackupCheckpoint {
        &self.required_checkpoint
    }

    /// Checkpoint of the admitted primary snapshot, once observed.
    pub const fn source_checkpoint(&self) -> Option<&BackupCheckpoint> {
        self.source_checkpoint.as_ref()
    }

    /// Checkpoint the generation was built from, once observed.
    pub const fn applied_checkpoint(&self) -> Option<&BackupCheckpoint> {
        self.applied_checkpoint.as_ref()
    }

    /// Fingerprint of the hydrated generation, once hydrated.
    pub const fn generation_fingerprint(&self) -> Option<&[u8; 32]> {
        self.generation_fingerprint.as_ref()
    }

    /// Stored build policy of the hydrated generation, once hydrated.
    pub const fn build_limits(&self) -> Option<EntailmentProjectionLimits> {
        self.build_limits
    }
}

/// The binding ceiling a projection query exceeded.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum QueryEntailmentProjectionResource {
    /// A hydration ceiling from [`EntailmentProjectionHydrationLimits`].
    Hydration(EntailmentProjectionHydrationResource),
    /// Distinct visible quads plus named-graph declarations.
    VisibleRecords,
    /// Logical estimate of the visible copy.
    VisibleEstimatedBytes,
}

impl fmt::Display for QueryEntailmentProjectionResource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Hydration(resource) => write!(f, "hydration {resource}"),
            Self::VisibleRecords => f.write_str("visible-record"),
            Self::VisibleEstimatedBytes => f.write_str("visible estimated-byte"),
        }
    }
}

/// Typed binding failure category. No partial binding is ever returned.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum QueryEntailmentProjectionErrorKind {
    /// Original `FROM`/`FROM NAMED` or a non-default effective dataset specification.
    #[error("projection queries support only the canonical default dataset")]
    UnsupportedDataset,
    /// Only the finite RDFS 1.2 profile is served by projections.
    #[error("query entailment profile {profile} is not served by entailment projections")]
    UnsupportedProfile {
        /// The requested profile.
        profile: QueryEntailment,
    },
    /// Eventual views are refused before payload I/O.
    #[error("projection queries support only strict derived views")]
    UnsupportedConsistency,
    /// Foreign provider, schema or primary lineage.
    #[error("derived view is not a finite-RDFS projection of the required primary lineage")]
    Identity,
    /// Same lineage, but not the exact required checkpoint.
    #[error("projection generation does not match the required primary checkpoint")]
    ProjectionNotFresh,
    /// Damaged or inconsistent projection payloads.
    #[error("projection payload, inventory binding, framing or topology is corrupt")]
    Corrupt,
    /// A valid binding exceeds a caller ceiling.
    #[error("projection query binding {resource} ceiling {ceiling} exceeded")]
    LimitExceeded {
        /// The exceeded caller resource.
        resource: QueryEntailmentProjectionResource,
        /// The configured caller ceiling.
        ceiling: u64,
    },
    /// Explicit cancellation of the evaluator token.
    #[error("projection query binding was cancelled")]
    Cancelled,
    /// The binding timeout or the evaluator token deadline elapsed.
    #[error("projection query binding deadline elapsed")]
    TimedOut,
    /// Storage failure below the generation reader.
    #[error(transparent)]
    Storage(StorageError),
    /// Remaining generation or I/O failure, preserved unchanged.
    #[error(transparent)]
    Generation(DerivedGenerationError),
}

/// Binding failure together with the requested and observed provenance.
#[derive(Debug, thiserror::Error)]
#[error("{kind}")]
pub struct QueryEntailmentProjectionError {
    kind: QueryEntailmentProjectionErrorKind,
    context: Box<QueryEntailmentProjectionContext>,
}

impl QueryEntailmentProjectionError {
    pub const fn kind(&self) -> &QueryEntailmentProjectionErrorKind {
        &self.kind
    }

    pub fn into_kind(self) -> QueryEntailmentProjectionErrorKind {
        self.kind
    }

    pub fn context(&self) -> &QueryEntailmentProjectionContext {
        &self.context
    }
}

/// Failure when evaluation starts, carrying the binding provenance. Errors raised later while
/// consuming a result stream stay plain [`QueryEvaluationError`]s; the context remains available
/// from [`QueryEntailmentProjectionResults`].
#[derive(Debug, thiserror::Error)]
#[error("{error}")]
pub struct QueryEntailmentProjectionExecutionError {
    context: Box<QueryEntailmentProjectionContext>,
    error: QueryEvaluationError,
}

impl QueryEntailmentProjectionExecutionError {
    pub fn context(&self) -> &QueryEntailmentProjectionContext {
        &self.context
    }

    pub const fn error(&self) -> &QueryEvaluationError {
        &self.error
    }

    pub fn into_error(self) -> QueryEvaluationError {
        self.error
    }
}

/// Existing lazy query results together with the binding provenance.
pub struct QueryEntailmentProjectionResults<'a> {
    context: &'a QueryEntailmentProjectionContext,
    results: QueryResults<'a>,
}

impl<'a> QueryEntailmentProjectionResults<'a> {
    pub const fn context(&self) -> &'a QueryEntailmentProjectionContext {
        self.context
    }

    pub const fn results(&self) -> &QueryResults<'a> {
        &self.results
    }

    pub fn results_mut(&mut self) -> &mut QueryResults<'a> {
        &mut self.results
    }

    pub fn into_results(self) -> QueryResults<'a> {
        self.results
    }

    pub fn into_parts(self) -> (&'a QueryEntailmentProjectionContext, QueryResults<'a>) {
        (self.context, self.results)
    }
}

/// A prepared query bound to one owned, immutable projection generation.
///
/// Later primary commits, ACTIVE swaps, payload replacement or dropping the view, snapshot, index
/// or store cannot alter its answers or provenance. Execution borrows the bound data and can be
/// repeated; a failure never rebinds against another generation.
#[must_use]
pub struct BoundEntailmentProjectionSparqlQuery {
    prepared: PreparedSparqlQuery,
    snapshot: EntailmentProjectionSnapshot,
    visible: Dataset,
    context: QueryEntailmentProjectionContext,
}

impl fmt::Debug for BoundEntailmentProjectionSparqlQuery {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BoundEntailmentProjectionSparqlQuery")
            .field("context", &self.context)
            .field("visible_quads", &self.visible.len())
            .finish_non_exhaustive()
    }
}

impl BoundEntailmentProjectionSparqlQuery {
    pub const fn context(&self) -> &QueryEntailmentProjectionContext {
        &self.context
    }

    /// The hydrated generation this query is bound to.
    pub const fn snapshot(&self) -> &EntailmentProjectionSnapshot {
        &self.snapshot
    }

    /// The admitted visible dataset: image plus entailed-only records and their topology.
    pub const fn visible_dataset(&self) -> &Dataset {
        &self.visible
    }

    /// Substitutes a variable exactly as [`PreparedSparqlQuery::substitute_variable`] does.
    pub fn substitute_variable(
        mut self,
        variable: impl Into<Variable>,
        term: impl Into<Term>,
    ) -> Self {
        self.prepared = self.prepared.substitute_variable(variable, term);
        self
    }

    /// Computes statistics during evaluation and fills them in the explanation tree.
    pub fn compute_statistics(mut self) -> Self {
        self.prepared.evaluator = self.prepared.evaluator.compute_statistics();
        self
    }

    /// Evaluates the query over the bound visible dataset.
    pub fn execute(
        &self,
    ) -> Result<QueryEntailmentProjectionResults<'_>, QueryEntailmentProjectionExecutionError> {
        let result = self
            .prepared
            .clone()
            .on_queryable_dataset(&self.visible)
            .execute();
        self.envelope(result)
    }

    /// Evaluates the query and returns the existing explanation.
    pub fn explain(
        &self,
    ) -> (
        Result<QueryEntailmentProjectionResults<'_>, QueryEntailmentProjectionExecutionError>,
        QueryExplanation,
    ) {
        let (result, explanation) = self
            .prepared
            .clone()
            .on_queryable_dataset(&self.visible)
            .explain();
        (self.envelope(result), explanation)
    }

    fn envelope<'a>(
        &'a self,
        result: Result<QueryResults<'a>, QueryEvaluationError>,
    ) -> Result<QueryEntailmentProjectionResults<'a>, QueryEntailmentProjectionExecutionError> {
        match result {
            Ok(results) => Ok(QueryEntailmentProjectionResults {
                context: &self.context,
                results,
            }),
            Err(error) => Err(QueryEntailmentProjectionExecutionError {
                context: Box::new(self.context.clone()),
                error,
            }),
        }
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "projection bindings are isolated in their feature-gated module"
)]
impl PreparedSparqlQuery {
    /// Binds this query to one admitted strict finite-RDFS projection generation.
    ///
    /// Scope, profile, strict consistency, provider identity and the exact required checkpoint
    /// are validated before any payload I/O. The view's own generation is hydrated exactly once,
    /// its provenance is checked against the request, and a private visible dataset is admitted
    /// under the visible-copy ceilings. Ordinary `on_store*` bindings are unaffected.
    pub fn on_entailment_projection(
        self,
        view: &DerivedView<'_>,
        options: &QueryEntailmentProjectionOptions,
    ) -> Result<BoundEntailmentProjectionSparqlQuery, QueryEntailmentProjectionError> {
        self.on_entailment_projection_observed(view, options, &mut |_| {})
    }

    /// `observe` runs immediately before each phase control check; production passes a no-op.
    fn on_entailment_projection_observed(
        self,
        view: &DerivedView<'_>,
        options: &QueryEntailmentProjectionOptions,
        observe: &mut dyn FnMut(Phase),
    ) -> Result<BoundEntailmentProjectionSparqlQuery, QueryEntailmentProjectionError> {
        let mut context = QueryEntailmentProjectionContext::requested(options);
        let mut binding = Binding {
            token: self.cancellation_token.clone(),
            started: Instant::now(),
            timeout: options.timeout,
            observe,
        };
        match self.bind_projection(view, options, &mut binding, &mut context) {
            Ok((snapshot, visible)) => Ok(BoundEntailmentProjectionSparqlQuery {
                prepared: self,
                snapshot,
                visible,
                context,
            }),
            Err(kind) => Err(QueryEntailmentProjectionError {
                kind,
                context: Box::new(context),
            }),
        }
    }

    fn bind_projection(
        &self,
        view: &DerivedView<'_>,
        options: &QueryEntailmentProjectionOptions,
        binding: &mut Binding<'_>,
        context: &mut QueryEntailmentProjectionContext,
    ) -> Result<(EntailmentProjectionSnapshot, Dataset), Kind> {
        binding.at(Phase::Entry)?;
        // The original query is checked too: resetting the effective specification must not
        // mask FROM/FROM NAMED clauses.
        if self.query.dataset().is_some() || !self.dataset.is_default_dataset() {
            return Err(Kind::UnsupportedDataset);
        }
        if options.profile != QueryEntailment::Rdfs12Finite || !options.profile.is_supported() {
            return Err(Kind::UnsupportedProfile {
                profile: options.profile,
            });
        }
        if view.is_eventual() {
            return Err(Kind::UnsupportedConsistency);
        }
        let generation = view.generation();
        context.source_checkpoint = Some(view.source().checkpoint().clone());
        context.applied_checkpoint = Some(generation.source().clone());
        if generation.identity() != entailment_projection_identity() {
            return Err(Kind::Identity);
        }
        bind_checkpoint(&options.required_checkpoint, view.source().checkpoint())?;
        bind_checkpoint(&options.required_checkpoint, generation.source())?;
        binding.at(Phase::Validated)?;

        binding.at(Phase::Hydrate)?;
        let control = binding.hydration_control()?;
        let snapshot = EntailmentProjectionSnapshot::hydrate(view, &options.hydration, &control)
            .map_err(hydration_kind)?;
        context.source_checkpoint = Some(snapshot.source_checkpoint().clone());
        context.applied_checkpoint = Some(snapshot.applied_checkpoint().clone());
        context.generation_fingerprint = Some(*snapshot.generation_fingerprint());
        context.build_limits = Some(snapshot.build_limits());
        bind_checkpoint(&options.required_checkpoint, snapshot.source_checkpoint())?;
        bind_checkpoint(&options.required_checkpoint, snapshot.applied_checkpoint())?;
        if snapshot.profile() != options.profile {
            return Err(Kind::Identity);
        }
        binding.at(Phase::Hydrated)?;

        let visible = visible_dataset(&snapshot, options, binding)?;
        binding.at(Phase::Final)?;
        Ok((snapshot, visible))
    }
}

/// Observable control checkpoints, in binding order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Phase {
    Entry,
    Validated,
    /// Immediately before hydration.
    Hydrate,
    Hydrated,
    /// Before admitting and retaining the numbered distinct visible record.
    VisibleRecord(u64),
    VisibleEnd,
    Final,
}

struct Binding<'a> {
    token: Option<CancellationToken>,
    started: Instant,
    timeout: Option<Duration>,
    observe: &'a mut dyn FnMut(Phase),
}

impl Binding<'_> {
    /// Explicit cancellation, token deadline, then the relative binding timeout.
    fn check(&self) -> Result<(), Kind> {
        if let Some(token) = &self.token {
            match token.cancellation_reason() {
                Some(CancellationReason::Cancelled) => return Err(Kind::Cancelled),
                Some(CancellationReason::TimedOut) => return Err(Kind::TimedOut),
                None => (),
            }
        }
        if self
            .timeout
            .is_some_and(|timeout| self.started.elapsed() >= timeout)
        {
            return Err(Kind::TimedOut);
        }
        Ok(())
    }

    fn at(&mut self, phase: Phase) -> Result<(), Kind> {
        (self.observe)(phase);
        self.check()
    }

    /// Hydration receives the evaluator token and only the remaining relative budget.
    fn hydration_control(&self) -> Result<TransactionStartControl, Kind> {
        let mut control = TransactionStartControl::new();
        if let Some(token) = &self.token {
            control = control.with_cancellation_token(token.clone());
        }
        if let Some(timeout) = self.timeout {
            let remaining = timeout
                .checked_sub(self.started.elapsed())
                .filter(|remaining| !remaining.is_zero())
                .ok_or(Kind::TimedOut)?;
            control = control.with_timeout(remaining);
        }
        Ok(control)
    }
}

/// Exact equality is required; a foreign lineage is an identity failure, not staleness.
fn bind_checkpoint(required: &BackupCheckpoint, observed: &BackupCheckpoint) -> Result<(), Kind> {
    if required == observed {
        return Ok(());
    }
    if required.database_id() != observed.database_id()
        || required.store_identity() != observed.store_identity()
        || required.storage_version() != observed.storage_version()
    {
        return Err(Kind::Identity);
    }
    Err(Kind::ProjectionNotFresh)
}

fn hydration_kind(error: EntailmentProjectionHydrationError) -> Kind {
    match error {
        EntailmentProjectionHydrationError::UnsupportedConsistency => Kind::UnsupportedConsistency,
        EntailmentProjectionHydrationError::Identity => Kind::Identity,
        EntailmentProjectionHydrationError::ProjectionNotFresh => Kind::ProjectionNotFresh,
        EntailmentProjectionHydrationError::Corrupt => Kind::Corrupt,
        EntailmentProjectionHydrationError::LimitExceeded { resource, ceiling } => {
            Kind::LimitExceeded {
                resource: QueryEntailmentProjectionResource::Hydration(resource),
                ceiling,
            }
        }
        EntailmentProjectionHydrationError::Cancelled => Kind::Cancelled,
        EntailmentProjectionHydrationError::TimedOut => Kind::TimedOut,
        EntailmentProjectionHydrationError::Storage(error) => Kind::Storage(error),
        EntailmentProjectionHydrationError::Generation(error) => Kind::Generation(error),
    }
}

/// Cumulative admission of the visible copy: count first, then the estimate, before retention.
struct VisibleAdmission {
    records: u64,
    bytes: u64,
    max_records: NonZeroU64,
    max_bytes: NonZeroU64,
}

impl VisibleAdmission {
    fn admit(&mut self, value: &dyn fmt::Display) -> Result<(), Kind> {
        let records = self
            .records
            .checked_add(1)
            .filter(|count| *count <= self.max_records.get())
            .ok_or(Kind::LimitExceeded {
                resource: QueryEntailmentProjectionResource::VisibleRecords,
                ceiling: self.max_records.get(),
            })?;
        let bytes = record_estimate(value)
            .and_then(|bytes| self.bytes.checked_add(bytes))
            .filter(|total| *total <= self.max_bytes.get())
            .ok_or(Kind::LimitExceeded {
                resource: QueryEntailmentProjectionResource::VisibleEstimatedBytes,
                ceiling: self.max_bytes.get(),
            })?;
        self.records = records;
        self.bytes = bytes;
        Ok(())
    }
}

fn host(graph: &GraphName) -> Option<NamedOrBlankNode> {
    match graph {
        GraphName::NamedNode(name) => Some(name.clone().into()),
        GraphName::BlankNode(name) => Some(name.clone().into()),
        GraphName::DefaultGraph => None,
    }
}

/// Named-graph topology first (image, then inferred), then quads; an undeclared host graph is
/// admitted as its own declaration before its quad. Duplicates are skipped before admission.
fn visible_dataset(
    snapshot: &EntailmentProjectionSnapshot,
    options: &QueryEntailmentProjectionOptions,
    binding: &mut Binding<'_>,
) -> Result<Dataset, Kind> {
    let mut admission = VisibleAdmission {
        records: 0,
        bytes: 0,
        max_records: options.max_visible_records,
        max_bytes: options.max_visible_estimated_bytes,
    };
    let mut visible = Dataset::new();
    let mut graphs = HashSet::new();
    let mut position = 0_u64;
    let image = snapshot.image();
    let inferred = snapshot.inferred();
    for graph in image.named_graphs().chain(inferred.named_graphs()) {
        if graphs.contains(&graph) {
            continue;
        }
        position = position.saturating_add(1);
        binding.at(Phase::VisibleRecord(position))?;
        admission.admit(&graph)?;
        graphs.insert(graph.clone());
        visible.insert_named_graph(graph);
    }
    for quad in image.iter().chain(inferred.iter()) {
        if let Some(graph) = host(&quad.graph_name) {
            if !graphs.contains(&graph) {
                position = position.saturating_add(1);
                binding.at(Phase::VisibleRecord(position))?;
                admission.admit(&graph)?;
                graphs.insert(graph.clone());
                visible.insert_named_graph(graph);
            }
        }
        if visible.contains(&quad) {
            continue;
        }
        position = position.saturating_add(1);
        binding.at(Phase::VisibleRecord(position))?;
        admission.admit(&quad)?;
        visible.insert(quad);
    }
    binding.at(Phase::VisibleEnd)?;
    Ok(visible)
}

struct DisplayLength(u64);

impl fmt::Write for DisplayLength {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        self.0 = self
            .0
            .saturating_add(u64::try_from(value.len()).unwrap_or(u64::MAX));
        Ok(())
    }
}

/// 160 bytes plus the display length, counted without allocating the rendered string. `None`
/// means the estimate overflowed.
fn record_estimate(value: &dyn fmt::Display) -> Option<u64> {
    let mut length = DisplayLength(0);
    fmt::write(&mut length, format_args!("{value}")).ok()?;
    RECORD_OVERHEAD.checked_add(length.0)
}

#[cfg(all(test, unix))]
#[expect(
    clippy::panic_in_result_fn,
    reason = "isolated binding scope, control, admission and provenance assertions"
)]
mod tests {
    use super::*;
    use crate::model::vocab::{rdf, rdfs};
    use crate::model::{BlankNode, NamedNode, Quad};
    use crate::sparql::{QueryDatasetSpecification, SparqlEvaluator};
    use crate::store::{
        DerivedGenerationLimits, DerivedIndex, DerivedSnapshot, EntailmentProjectionProvider, Store,
    };

    type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

    const FILES: [&str; 3] = ["meta", "image", "inferred"];
    const ASK_ANIMAL: &str = "ASK { <urn:test:fido> a <urn:test:Animal> }";
    const WIDE: EntailmentProjectionHydrationLimits = EntailmentProjectionHydrationLimits::new(
        NonZeroU64::MAX,
        NonZeroU64::MAX,
        NonZeroU64::MAX,
        NonZeroU64::MAX,
    );

    fn node(local: &str) -> NamedNode {
        NamedNode::new_unchecked(format!("urn:test:{local}"))
    }

    fn seed() -> Vec<Quad> {
        let bg = GraphName::from(BlankNode::new_unchecked("bg"));
        vec![
            Quad::new(
                node("Dog"),
                rdfs::SUB_CLASS_OF,
                node("Animal"),
                GraphName::DefaultGraph,
            ),
            Quad::new(
                node("fido"),
                rdf::TYPE,
                node("Dog"),
                GraphName::DefaultGraph,
            ),
            Quad::new(node("Dog"), rdfs::SUB_CLASS_OF, node("Animal"), bg.clone()),
            Quad::new(BlankNode::new_unchecked("b1"), rdf::TYPE, node("Dog"), bg),
        ]
    }

    struct Fixture {
        dir: tempfile::TempDir,
        store: Store,
        index: DerivedIndex,
        limits: DerivedGenerationLimits,
    }

    impl Fixture {
        fn new() -> TestResult<Self> {
            let dir = tempfile::tempdir()?;
            let store = Store::open(dir.path().join("db"))?;
            for quad in seed() {
                store.insert(quad)?;
            }
            store.insert_named_graph(node("empty"))?;
            let index =
                DerivedIndex::create(dir.path().join("index"), entailment_projection_identity())?;
            let mut fixture = Self {
                dir,
                store,
                index,
                limits: DerivedGenerationLimits::default(),
            };
            fixture.publish()?;
            Ok(fixture)
        }

        fn publish(&mut self) -> TestResult {
            let provider = EntailmentProjectionProvider::default();
            let source = self.source()?;
            let candidate = self.index.rebuild(&source, &provider, &self.limits)?;
            self.index
                .activate(&candidate, &source, &provider, &self.limits)?;
            Ok(())
        }

        fn source(&self) -> TestResult<DerivedSnapshot> {
            Ok(self
                .store
                .derived_snapshot(&TransactionStartControl::new())?)
        }
    }

    fn options(source: &DerivedSnapshot) -> QueryEntailmentProjectionOptions {
        QueryEntailmentProjectionOptions::new(
            QueryEntailment::Rdfs12Finite,
            source.checkpoint().clone(),
            WIDE,
            NonZeroU64::MAX,
            NonZeroU64::MAX,
        )
    }

    fn query(text: &str, token: Option<CancellationToken>) -> TestResult<PreparedSparqlQuery> {
        let mut evaluator = SparqlEvaluator::new();
        if let Some(token) = token {
            evaluator = evaluator.with_cancellation_token(token);
        }
        Ok(evaluator.parse_query(text)?)
    }

    fn failure(
        result: Result<BoundEntailmentProjectionSparqlQuery, QueryEntailmentProjectionError>,
    ) -> TestResult<QueryEntailmentProjectionError> {
        match result {
            Ok(_) => Err("binding unexpectedly succeeded".into()),
            Err(error) => Ok(error),
        }
    }

    fn ask(bound: &BoundEntailmentProjectionSparqlQuery) -> TestResult<bool> {
        match bound.execute()?.into_results() {
            QueryResults::Boolean(answer) => Ok(answer),
            _ => Err("ASK did not return a boolean".into()),
        }
    }

    #[test]
    fn every_binding_phase_reports_cancellation_without_a_binding() -> TestResult {
        let fx = Fixture::new()?;
        let source = fx.source()?;
        let view = fx.index.strict(&source, &fx.limits)?;
        let options = options(&source);
        let mut phases = Vec::new();
        let bound = query(ASK_ANIMAL, None)?.on_entailment_projection_observed(
            &view,
            &options,
            &mut |phase| phases.push(phase),
        )?;
        assert!(ask(&bound)?, "subclass entailment missing");
        for expected in [
            Phase::Entry,
            Phase::Validated,
            Phase::Hydrate,
            Phase::Hydrated,
            Phase::VisibleRecord(1),
            Phase::VisibleEnd,
            Phase::Final,
        ] {
            assert!(phases.contains(&expected), "{expected:?} never observed");
        }
        assert_eq!(phases.last(), Some(&Phase::Final), "publication is last");
        for target in phases {
            let token = CancellationToken::new();
            let mut reached = false;
            let result = query(ASK_ANIMAL, Some(token.clone()))?.on_entailment_projection_observed(
                &view,
                &options,
                &mut |phase| {
                    if phase == target {
                        reached = true;
                        token.cancel();
                    }
                },
            );
            assert!(reached, "{target:?} was not reached");
            let error = failure(result)?;
            assert!(
                matches!(error.kind(), Kind::Cancelled),
                "{target:?}: {error}"
            );
        }
        Ok(())
    }

    #[test]
    fn relative_binding_timeout_is_timed_out_and_ends_after_binding() -> TestResult {
        let fx = Fixture::new()?;
        let source = fx.source()?;
        let view = fx.index.strict(&source, &fx.limits)?;
        let expired = options(&source).with_timeout(Some(Duration::ZERO));
        let error = failure(query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &expired))?;
        assert!(matches!(error.kind(), Kind::TimedOut), "{error}");
        let timeout = Duration::from_millis(200);
        let bounded = options(&source).with_timeout(Some(timeout));
        let bound = query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &bounded)?;
        std::thread::sleep(timeout);
        assert!(ask(&bound)?, "binding timeout leaked into execution");
        Ok(())
    }

    #[test]
    fn unsupported_scopes_fail_before_payload_io() -> TestResult {
        let fx = Fixture::new()?;
        let source = fx.source()?;
        let view = fx.index.strict(&source, &fx.limits)?;
        let directory = view.generation().directory().to_owned();
        for name in FILES {
            std::fs::write(directory.join(name), b"damaged")?;
        }
        let options = options(&source);
        let mut masked = query("ASK FROM <urn:test:g> { ?s ?p ?o }", None)?;
        *masked.dataset_mut() = QueryDatasetSpecification::default();
        let mut union = query(ASK_ANIMAL, None)?;
        union.dataset_mut().set_default_graph_as_union();
        let mut restricted = query(ASK_ANIMAL, None)?;
        restricted
            .dataset_mut()
            .set_available_named_graphs(Vec::new());
        let mut duplicated = query(ASK_ANIMAL, None)?;
        duplicated
            .dataset_mut()
            .set_default_graph(vec![GraphName::DefaultGraph, GraphName::DefaultGraph]);
        for (case, prepared) in [
            ("from", query("ASK FROM <urn:test:g> { ?s ?p ?o }", None)?),
            (
                "from named",
                query("ASK FROM NAMED <urn:test:g> { ?s ?p ?o }", None)?,
            ),
            ("masked from", masked),
            ("union", union),
            ("restricted named", restricted),
            ("duplicate default", duplicated),
        ] {
            let mut phases = Vec::new();
            let error = failure(prepared.on_entailment_projection_observed(
                &view,
                &options,
                &mut |phase| phases.push(phase),
            ))?;
            assert!(
                matches!(error.kind(), Kind::UnsupportedDataset),
                "{case}: {error}"
            );
            assert_eq!(phases, [Phase::Entry], "{case}: work after scope rejection");
            assert!(
                error.context().source_checkpoint().is_none()
                    && error.context().generation_fingerprint().is_none(),
                "{case}: provenance invented before admission"
            );
        }
        let error = failure(query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &options))?;
        assert!(
            matches!(error.kind(), Kind::Corrupt),
            "supported scope must reach the damaged payload: {error}"
        );
        Ok(())
    }

    #[test]
    fn required_checkpoint_profile_and_consistency_are_checked_before_hydration() -> TestResult {
        let mut fx = Fixture::new()?;
        let old = fx.source()?.checkpoint().clone();
        fx.store.insert(Quad::new(
            node("tom"),
            rdf::TYPE,
            node("Dog"),
            GraphName::DefaultGraph,
        ))?;
        fx.publish()?;
        let source = fx.source()?;
        let view = fx.index.strict(&source, &fx.limits)?;
        let stale = QueryEntailmentProjectionOptions::new(
            QueryEntailment::Rdfs12Finite,
            old,
            WIDE,
            NonZeroU64::MAX,
            NonZeroU64::MAX,
        );
        let error = failure(query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &stale))?;
        assert!(matches!(error.kind(), Kind::ProjectionNotFresh), "{error}");
        assert_eq!(
            error.context().source_checkpoint(),
            Some(source.checkpoint()),
            "observed source not recorded"
        );

        let other = Store::open(fx.dir.path().join("other"))?;
        let foreign = other
            .derived_snapshot(&TransactionStartControl::new())?
            .checkpoint()
            .clone();
        let foreign = QueryEntailmentProjectionOptions::new(
            QueryEntailment::Rdfs12Finite,
            foreign,
            WIDE,
            NonZeroU64::MAX,
            NonZeroU64::MAX,
        );
        let error = failure(query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &foreign))?;
        assert!(matches!(error.kind(), Kind::Identity), "{error}");

        let simple = QueryEntailmentProjectionOptions::new(
            QueryEntailment::Simple,
            source.checkpoint().clone(),
            WIDE,
            NonZeroU64::MAX,
            NonZeroU64::MAX,
        );
        let error = failure(query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &simple))?;
        assert!(
            matches!(
                error.kind(),
                Kind::UnsupportedProfile {
                    profile: QueryEntailment::Simple
                }
            ),
            "{error}"
        );

        let eventual = fx.index.eventual(&source, &fx.limits)?;
        let error = failure(
            query(ASK_ANIMAL, None)?.on_entailment_projection(&eventual, &options(&source)),
        )?;
        assert!(
            matches!(error.kind(), Kind::UnsupportedConsistency),
            "{error}"
        );

        let bound = query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &options(&source))?;
        let context = bound.context();
        assert!(
            context.source_checkpoint() == Some(source.checkpoint())
                && context.applied_checkpoint() == Some(source.checkpoint())
                && context.generation_fingerprint() == Some(&view.generation().fingerprint())
                && context.build_limits() == Some(EntailmentProjectionLimits::default()),
            "successful binding lacks exact provenance"
        );
        Ok(())
    }

    #[test]
    fn visible_copy_ceilings_are_exact_and_preserve_topology() -> TestResult {
        let fx = Fixture::new()?;
        let source = fx.source()?;
        let view = fx.index.strict(&source, &fx.limits)?;
        let bound = query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &options(&source))?;

        // Independent recount over the hydrated image and entailed-only records.
        let snapshot = bound.snapshot();
        let mut graphs = HashSet::new();
        let mut quads = HashSet::new();
        for graph in snapshot
            .image()
            .named_graphs()
            .chain(snapshot.inferred().named_graphs())
        {
            graphs.insert(graph.to_string());
        }
        for quad in snapshot.image().iter().chain(snapshot.inferred().iter()) {
            match &quad.graph_name {
                GraphName::NamedNode(name) => {
                    graphs.insert(name.to_string());
                }
                GraphName::BlankNode(name) => {
                    graphs.insert(name.to_string());
                }
                GraphName::DefaultGraph => {}
            }
            quads.insert(quad.to_string());
        }
        assert!(
            graphs.contains(&node("empty").to_string()) && graphs.contains("_:bg"),
            "fixture topology missing"
        );
        let mut records = 0_u64;
        let mut bytes = 0_u64;
        for value in graphs.iter().chain(quads.iter()) {
            records += 1;
            bytes += 160 + u64::try_from(value.len())?;
        }
        let visible = bound.visible_dataset();
        let visible_graphs: HashSet<String> = visible
            .named_graphs()
            .map(|graph| graph.to_string())
            .collect();
        let visible_quads: HashSet<String> = visible.iter().map(|quad| quad.to_string()).collect();
        assert_eq!(visible_graphs, graphs, "visible topology diverged");
        assert_eq!(visible_quads, quads, "visible quads diverged");

        let exact = |records: u64, bytes: u64| -> TestResult<QueryEntailmentProjectionOptions> {
            Ok(QueryEntailmentProjectionOptions::new(
                QueryEntailment::Rdfs12Finite,
                source.checkpoint().clone(),
                WIDE,
                NonZeroU64::new(records).ok_or("zero records")?,
                NonZeroU64::new(bytes).ok_or("zero bytes")?,
            ))
        };
        query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &exact(records, bytes)?)?;
        let error = failure(
            query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &exact(records - 1, bytes)?),
        )?;
        assert!(
            matches!(
                error.kind(),
                Kind::LimitExceeded {
                    resource: QueryEntailmentProjectionResource::VisibleRecords,
                    ceiling,
                } if *ceiling == records - 1
            ),
            "{error}"
        );
        let error = failure(
            query(ASK_ANIMAL, None)?.on_entailment_projection(&view, &exact(records, bytes - 1)?),
        )?;
        assert!(
            matches!(
                error.kind(),
                Kind::LimitExceeded {
                    resource: QueryEntailmentProjectionResource::VisibleEstimatedBytes,
                    ceiling,
                } if *ceiling == bytes - 1
            ),
            "{error}"
        );

        let graph_local = query(
            "ASK { GRAPH ?g { ?x a <urn:test:Animal> } FILTER(isBlank(?g) && isBlank(?x)) }",
            None,
        )?
        .on_entailment_projection(&view, &options(&source))?;
        assert!(ask(&graph_local)?, "graph-local blank-node entailment lost");
        let empty = query("ASK { GRAPH <urn:test:empty> { } }", None)?
            .on_entailment_projection(&view, &options(&source))?;
        assert!(ask(&empty)?, "empty named graph lost");
        Ok(())
    }

    #[test]
    fn bound_generation_survives_later_primary_active_and_payload_changes() -> TestResult {
        let mut fx = Fixture::new()?;
        let source = fx.source()?;
        let view = fx.index.strict(&source, &fx.limits)?;
        let directory = view.generation().directory().to_owned();
        let bound = query("ASK { <urn:test:tom> a <urn:test:Animal> }", None)?
            .on_entailment_projection(&view, &options(&source))?;
        let context = bound.context().clone();
        assert!(!ask(&bound)?, "generation C already contains tom");
        drop(view);
        drop(source);
        fx.store.insert(Quad::new(
            node("tom"),
            rdf::TYPE,
            node("Dog"),
            GraphName::DefaultGraph,
        ))?;
        fx.publish()?;
        assert!(
            fx.index.active(&fx.limits)?.fingerprint().as_slice()
                != context
                    .generation_fingerprint()
                    .ok_or("no fingerprint")?
                    .as_slice(),
            "ACTIVE did not advance"
        );
        for name in FILES {
            std::fs::write(directory.join(name), b"replaced")?;
        }
        assert!(!ask(&bound)?, "later generation D leaked into bound C");
        assert_eq!(bound.context(), &context, "bound provenance changed");
        Ok(())
    }

    #[test]
    fn evaluator_cancellation_reaches_lazy_consumption() -> TestResult {
        let fx = Fixture::new()?;
        let source = fx.source()?;
        let view = fx.index.strict(&source, &fx.limits)?;
        let token = CancellationToken::new();
        let bound = query("SELECT ?s WHERE { ?s ?p ?o }", Some(token.clone()))?
            .on_entailment_projection(&view, &options(&source))?;
        let results = bound.execute()?;
        assert_eq!(
            results.context(),
            bound.context(),
            "envelope context differs"
        );
        let QueryResults::Solutions(mut solutions) = results.into_results() else {
            return Err("SELECT did not return solutions".into());
        };
        solutions.next().ok_or("no solution")??;
        token.cancel();
        assert!(
            matches!(solutions.next(), Some(Err(QueryEvaluationError::Cancelled))),
            "cancellation not observed during consumption"
        );
        Ok(())
    }
}
