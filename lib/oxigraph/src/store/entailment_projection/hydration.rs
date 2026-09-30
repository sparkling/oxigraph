//! Immutable, bounded hydration of one admitted finite-RDFS projection generation (ADR-0032).
//!
//! Hydration supports strict views only. It copies `meta`, `image` and `inferred` from the view's
//! own generation through that generation's retained inventory, never appending inferred records
//! to a newer Store snapshot, and returns one owned snapshot that outlives the view, its primary
//! snapshot and the index handle. No closure is recomputed and no watcher thread is started.
//!
//! Caller ceilings are independent from the stored build policy, which never raises them. Record
//! counts and cumulative copied payload bytes are preflighted from integrity-checked metadata
//! before any section is read; each decoded record is then admitted against the record and
//! estimated-byte ceilings before it is retained. One decoded record may already exist when it is
//! refused. Whole-section buffers, hashing, topology sets, allocator overhead and process RSS are
//! neither measured nor bounded.
//!
//! Control checks are cooperative and share one entry clock for the whole call, including the
//! end-of-section and final publication boundaries. Native reads, one record decode and the
//! existing whole-buffer hashing are not preemptible. The relative timeout ends on successful
//! return; later query execution needs its own cancellation and deadline controls. Integrity
//! checks detect accidental damage and replacement, not a dishonest provider that rewrites every
//! binding.
use super::*;
use crate::model::Dataset;
use crate::storage::TransactionStartControlError;
use crate::store::derived_generation::DerivedView;
use crate::store::{BackupCheckpoint, TransactionStartControl};
use std::collections::HashSet;

/// Logical charge per retained quad or named-graph declaration, before its display length.
const RECORD_OVERHEAD: u64 = 160;
/// Every framed record carries at least its 4-byte length header.
const FRAME_HEADER: u64 = 4;

type HydrationError = EntailmentProjectionHydrationError;
type Resource = EntailmentProjectionHydrationResource;

/// Caller-owned hydration ceilings. All are mandatory and none is an RSS guarantee.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntailmentProjectionHydrationLimits {
    /// Primary image records: quads plus named-graph declarations.
    pub max_source_records: NonZeroU64,
    /// Entailed-only records: inferred quads plus inferred named-graph declarations.
    pub max_inferred_records: NonZeroU64,
    /// Cumulative copied `meta`, `image` and `inferred` bytes, including frame headers.
    pub max_payload_bytes: NonZeroU64,
    /// Cumulative logical estimate of retained image and inferred records: 160 bytes plus the
    /// display length of each quad or named-graph declaration, counted without allocating.
    pub max_estimated_bytes: NonZeroU64,
}

impl EntailmentProjectionHydrationLimits {
    pub const fn new(
        max_source_records: NonZeroU64,
        max_inferred_records: NonZeroU64,
        max_payload_bytes: NonZeroU64,
        max_estimated_bytes: NonZeroU64,
    ) -> Self {
        Self {
            max_source_records,
            max_inferred_records,
            max_payload_bytes,
            max_estimated_bytes,
        }
    }
}

/// The caller ceiling a hydration exceeded.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum EntailmentProjectionHydrationResource {
    SourceRecords,
    InferredRecords,
    PayloadBytes,
    EstimatedBytes,
}

impl fmt::Display for EntailmentProjectionHydrationResource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::SourceRecords => "source-record",
            Self::InferredRecords => "inferred-record",
            Self::PayloadBytes => "payload-byte",
            Self::EstimatedBytes => "estimated-byte",
        })
    }
}

/// Typed hydration failure. No partial snapshot is ever returned.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum EntailmentProjectionHydrationError {
    /// Only strict views can be hydrated; eventual views are refused before payload I/O.
    #[error("projection hydration supports only strict derived views")]
    UnsupportedConsistency,
    /// Foreign provider, schema, profile or primary lineage.
    #[error("derived view is not a finite-RDFS projection of this primary lineage")]
    Identity,
    /// The generation is not bound to the admitted primary snapshot.
    #[error("projection generation does not match the admitted primary snapshot")]
    ProjectionNotFresh,
    /// Inconsistent inventory, declared sizes or counts, framing, hashes or topology.
    #[error("projection payload, inventory binding, framing or topology is corrupt")]
    Corrupt,
    /// A valid payload exceeds a caller ceiling.
    #[error("projection hydration {resource} ceiling {ceiling} exceeded")]
    LimitExceeded {
        /// The exceeded caller resource.
        resource: EntailmentProjectionHydrationResource,
        /// The configured caller ceiling.
        ceiling: u64,
    },
    /// Explicit cancellation of the supplied control.
    #[error("projection hydration was cancelled")]
    Cancelled,
    /// The relative timeout or the absolute token deadline elapsed.
    #[error("projection hydration deadline elapsed")]
    TimedOut,
    /// Storage failure below the generation reader.
    #[error(transparent)]
    Storage(StorageError),
    /// Remaining generation or I/O failure, preserved unchanged.
    #[error(transparent)]
    Generation(DerivedGenerationError),
}

/// Immutable, owned image and entailed-only records of one strict projection generation.
///
/// Provenance is copied from the admitted view; there is no public unchecked constructor and no
/// writable accessor. Later primary commits, generation swaps or payload changes cannot alter it.
pub struct EntailmentProjectionSnapshot {
    image: Dataset,
    inferred: Dataset,
    profile: QueryEntailment,
    build_limits: EntailmentProjectionLimits,
    source_checkpoint: BackupCheckpoint,
    applied_checkpoint: BackupCheckpoint,
    generation_fingerprint: [u8; 32],
}

impl fmt::Debug for EntailmentProjectionSnapshot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EntailmentProjectionSnapshot")
            .field("profile", &self.profile)
            .field("image_quads", &self.image.len())
            .field("inferred_quads", &self.inferred.len())
            .finish_non_exhaustive()
    }
}

impl EntailmentProjectionSnapshot {
    /// Hydrates the view's own generation under caller ceilings and control.
    ///
    /// Strict proof comes from the admitted view's checkpoint and content validation and the
    /// trusted provider reconciliation; this call additionally binds every copied byte to the
    /// generation's retained inventory and metadata. Semantics are not recomputed.
    pub fn hydrate(
        view: &DerivedView<'_>,
        limits: &EntailmentProjectionHydrationLimits,
        control: &TransactionStartControl,
    ) -> Result<Self, EntailmentProjectionHydrationError> {
        Self::hydrate_observed(view, limits, control, &mut |_| {})
    }

    /// Primary image quads and named-graph topology, including empty graphs.
    pub const fn image(&self) -> &Dataset {
        &self.image
    }

    /// Entailed quads and named graphs that are not primary records.
    pub const fn inferred(&self) -> &Dataset {
        &self.inferred
    }

    pub const fn profile(&self) -> QueryEntailment {
        self.profile
    }

    /// The stored build policy of the generation, not the caller hydration ceilings.
    pub const fn build_limits(&self) -> EntailmentProjectionLimits {
        self.build_limits
    }

    /// Checkpoint of the admitted primary snapshot.
    pub const fn source_checkpoint(&self) -> &BackupCheckpoint {
        &self.source_checkpoint
    }

    /// Checkpoint the generation was built from; equal to the source under strict admission.
    pub const fn applied_checkpoint(&self) -> &BackupCheckpoint {
        &self.applied_checkpoint
    }

    pub const fn generation_fingerprint(&self) -> &[u8; 32] {
        &self.generation_fingerprint
    }

    /// `observe` runs immediately before each phase control check; production passes a no-op.
    fn hydrate_observed(
        view: &DerivedView<'_>,
        limits: &EntailmentProjectionHydrationLimits,
        control: &TransactionStartControl,
        observe: &mut dyn FnMut(Phase),
    ) -> Result<Self, HydrationError> {
        let started = Instant::now();
        let mut run = Run {
            control,
            input: DerivedLimits {
                control: control.clone(),
                ..DerivedLimits::default()
            },
            started,
            observe,
        };
        run.at(Phase::Entry)?;
        if view.is_eventual() {
            return Err(HydrationError::UnsupportedConsistency);
        }
        let generation = view.generation();
        if generation.identity() != entailment_projection_identity() {
            return Err(HydrationError::Identity);
        }
        bind_source(generation.source(), view.source().checkpoint())?;
        let files = generation.files();
        run.at(Phase::Bound)?;

        let payload_ceiling = limits.max_payload_bytes;
        let meta_cap = MAX_META.min(payload_ceiling.get());
        let meta_bytes =
            read_all(files, FILE_META, meta_cap, &run.input, run.started).map_err(|error| {
                run.failed(
                    error,
                    if meta_cap < MAX_META {
                        exceeded(Resource::PayloadBytes, payload_ceiling)
                    } else {
                        HydrationError::Corrupt
                    },
                )
            })?;
        let meta = Meta::decode(&meta_bytes)
            .map_err(|error| run.failed(error, HydrationError::Corrupt))?;
        if (meta.identity, meta.last) != source_position(view.source()) {
            return Err(HydrationError::Corrupt);
        }
        let meta_len = u64::try_from(meta_bytes.len()).map_err(|_| HydrationError::Corrupt)?;
        drop(meta_bytes);
        run.at(Phase::Meta)?;
        preflight(&meta, meta_len, limits)?;
        run.at(Phase::Preflight)?;

        let mut admission = Admission {
            estimated: 0,
            ceiling: limits.max_estimated_bytes,
        };
        let mut image = Dataset::new();
        let mut image_graphs = HashSet::new();
        let mut used_graphs = HashSet::new();
        let bytes = read_payload(&run, files, FILE_IMAGE, &meta.image)?;
        run.at(Phase::ImageRead)?;
        decode_section(
            &mut run,
            &bytes,
            &SectionPlan {
                declared: meta.image.records,
                ceiling: limits.max_source_records,
                resource: Resource::SourceRecords,
                record: Phase::ImageRecord,
                end: Phase::ImageEnd,
            },
            &mut admission,
            |change| {
                match change {
                    SemanticChange::QuadAdded(quad) => {
                        if let Some(graph) = graph_node(&quad.graph_name) {
                            used_graphs.insert(graph);
                        }
                        image.insert(quad);
                    }
                    SemanticChange::NamedGraphCreated(graph) => {
                        image_graphs.insert(graph.clone());
                        image.insert_named_graph(graph);
                    }
                    _ => return Err(HydrationError::Corrupt),
                }
                Ok(())
            },
        )?;
        drop(bytes);
        // Every image quad graph must be an explicitly declared image graph.
        if !used_graphs.is_subset(&image_graphs) {
            return Err(HydrationError::Corrupt);
        }
        drop(used_graphs);

        let mut inferred = Dataset::new();
        let mut inferred_graphs = HashSet::new();
        let mut hosted = HashSet::new();
        let bytes = read_payload(&run, files, FILE_INFERRED, &meta.inferred)?;
        run.at(Phase::InferredRead)?;
        decode_section(
            &mut run,
            &bytes,
            &SectionPlan {
                declared: meta.inferred.records,
                ceiling: limits.max_inferred_records,
                resource: Resource::InferredRecords,
                record: Phase::InferredRecord,
                end: Phase::InferredEnd,
            },
            &mut admission,
            |change| {
                match change {
                    // Entailed-only: a primary record is never repeated as inferred.
                    SemanticChange::QuadAdded(quad) => {
                        if image.contains(&quad) {
                            return Err(HydrationError::Corrupt);
                        }
                        if let Some(graph) = graph_node(&quad.graph_name) {
                            hosted.insert(graph);
                        }
                        inferred.insert(quad);
                    }
                    SemanticChange::NamedGraphCreated(graph) => {
                        if image_graphs.contains(&graph) {
                            return Err(HydrationError::Corrupt);
                        }
                        inferred_graphs.insert(graph.clone());
                        inferred.insert_named_graph(graph);
                    }
                    _ => return Err(HydrationError::Corrupt),
                }
                Ok(())
            },
        )?;
        drop(bytes);
        if hosted
            .iter()
            .any(|graph| !image_graphs.contains(graph) && !inferred_graphs.contains(graph))
        {
            return Err(HydrationError::Corrupt);
        }
        run.at(Phase::Final)?;
        Ok(Self {
            image,
            inferred,
            profile: PROFILE,
            build_limits: meta.limits,
            source_checkpoint: view.source().checkpoint().clone(),
            applied_checkpoint: generation.source().clone(),
            generation_fingerprint: generation.fingerprint(),
        })
    }
}

/// Observable control checkpoints, in hydration order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Phase {
    Entry,
    Bound,
    Meta,
    Preflight,
    ImageRead,
    /// After decoding the numbered image record, before its admission and retention.
    ImageRecord(u64),
    ImageEnd,
    InferredRead,
    /// After decoding the numbered inferred record, before its admission and retention.
    InferredRecord(u64),
    InferredEnd,
    Final,
}

struct Run<'a> {
    control: &'a TransactionStartControl,
    /// Carries the same control to `read_verified`; its record and byte fields are unused.
    input: DerivedLimits,
    started: Instant,
    observe: &'a mut dyn FnMut(Phase),
}

impl Run<'_> {
    /// Distinguishes explicit cancellation, token deadline and relative timeout.
    fn check(&self) -> Result<(), HydrationError> {
        self.control
            .check(self.started)
            .map_err(|error| match error {
                TransactionStartControlError::Cancelled => HydrationError::Cancelled,
                TransactionStartControlError::TimedOut => HydrationError::TimedOut,
            })
    }

    fn at(&mut self, phase: Phase) -> Result<(), HydrationError> {
        (self.observe)(phase);
        self.check()
    }

    /// Control wins over a nested failure; the backup-style reader reports a token deadline as
    /// cancellation, so the direct check runs before any nested category is propagated.
    fn failed(&self, error: DerivedGenerationError, on_limit: HydrationError) -> HydrationError {
        if let Err(control) = self.check() {
            return control;
        }
        match error {
            DerivedGenerationError::Limit => on_limit,
            other => normalize(other),
        }
    }
}

const fn exceeded(resource: Resource, ceiling: NonZeroU64) -> HydrationError {
    HydrationError::LimitExceeded {
        resource,
        ceiling: ceiling.get(),
    }
}

fn normalize(error: DerivedGenerationError) -> HydrationError {
    match error {
        DerivedGenerationError::Backup(BackupError::Cancelled)
        | DerivedGenerationError::Input(DerivedError::Backup(BackupError::Cancelled)) => {
            HydrationError::Cancelled
        }
        DerivedGenerationError::Backup(BackupError::TimedOut)
        | DerivedGenerationError::Input(DerivedError::Backup(BackupError::TimedOut)) => {
            HydrationError::TimedOut
        }
        DerivedGenerationError::Backup(BackupError::Storage(error))
        | DerivedGenerationError::Input(
            DerivedError::Storage(error) | DerivedError::Backup(BackupError::Storage(error)),
        ) => HydrationError::Storage(error),
        DerivedGenerationError::Corrupt => HydrationError::Corrupt,
        DerivedGenerationError::Identity => HydrationError::Identity,
        DerivedGenerationError::NotFresh
        | DerivedGenerationError::Input(DerivedError::NotFresh) => {
            HydrationError::ProjectionNotFresh
        }
        other => HydrationError::Generation(other),
    }
}

/// Exact equality is required; a foreign lineage is an identity failure, not staleness.
fn bind_source(
    applied: &BackupCheckpoint,
    source: &BackupCheckpoint,
) -> Result<(), HydrationError> {
    if applied == source {
        return Ok(());
    }
    if applied.database_id() != source.database_id()
        || applied.store_identity() != source.store_identity()
        || applied.storage_version() != source.storage_version()
    {
        return Err(HydrationError::Identity);
    }
    Err(HydrationError::ProjectionNotFresh)
}

/// Stored format and build-policy inconsistencies are corrupt; valid payloads beyond the caller
/// ceilings are limits. Nothing beyond `meta` has been read yet.
fn preflight(
    meta: &Meta,
    meta_len: u64,
    limits: &EntailmentProjectionHydrationLimits,
) -> Result<(), HydrationError> {
    for (section, stored) in [
        (&meta.image, meta.limits.max_source_quads),
        (&meta.inferred, meta.limits.max_inferred_quads),
    ] {
        if section.bytes > MAX_PAYLOAD
            || section.records > stored.get()
            || section
                .records
                .checked_mul(FRAME_HEADER)
                .is_none_or(|minimum| minimum > section.bytes)
        {
            return Err(HydrationError::Corrupt);
        }
    }
    if meta.image.records > limits.max_source_records.get() {
        return Err(exceeded(Resource::SourceRecords, limits.max_source_records));
    }
    if meta.inferred.records > limits.max_inferred_records.get() {
        return Err(exceeded(
            Resource::InferredRecords,
            limits.max_inferred_records,
        ));
    }
    meta_len
        .checked_add(meta.image.bytes)
        .and_then(|total| total.checked_add(meta.inferred.bytes))
        .filter(|total| *total <= limits.max_payload_bytes.get())
        .map(|_| ())
        .ok_or_else(|| exceeded(Resource::PayloadBytes, limits.max_payload_bytes))
}

/// Copies one section against the retained inventory, then its metadata binding. A file larger
/// than its declared section is corrupt, not a limit.
fn read_payload(
    run: &Run<'_>,
    files: &DerivedFiles,
    name: &str,
    section: &Section,
) -> Result<Vec<u8>, HydrationError> {
    run.check()?;
    let bytes = read_all(files, name, section.bytes, &run.input, run.started)
        .map_err(|error| run.failed(error, HydrationError::Corrupt))?;
    verify(&bytes, section).map_err(|error| run.failed(error, HydrationError::Corrupt))?;
    Ok(bytes)
}

struct SectionPlan {
    declared: u64,
    ceiling: NonZeroU64,
    resource: Resource,
    record: fn(u64) -> Phase,
    end: Phase,
}

/// Cumulative estimate over image and inferred records.
struct Admission {
    estimated: u64,
    ceiling: NonZeroU64,
}

impl Admission {
    fn charge(&mut self, change: &SemanticChange) -> Result<(), HydrationError> {
        let bytes = match change {
            SemanticChange::QuadAdded(quad) => record_estimate(quad),
            SemanticChange::NamedGraphCreated(graph) => record_estimate(graph),
            _ => return Err(HydrationError::Corrupt),
        };
        self.estimated = bytes
            .and_then(|bytes| self.estimated.checked_add(bytes))
            .filter(|total| *total <= self.ceiling.get())
            .ok_or_else(|| exceeded(Resource::EstimatedBytes, self.ceiling))?;
        Ok(())
    }
}

/// Decodes canonical ascending frames one at a time. Control, record admission and estimate
/// admission all precede retention; the first failure stops before any later frame is decoded.
fn decode_section(
    run: &mut Run<'_>,
    bytes: &[u8],
    plan: &SectionPlan,
    admission: &mut Admission,
    mut retain: impl FnMut(SemanticChange) -> Result<(), HydrationError>,
) -> Result<(), HydrationError> {
    let mut count = 0_u64;
    for frame in Frames::new(bytes) {
        run.check()?;
        count = count
            .checked_add(1)
            .filter(|count| *count <= plan.declared)
            .ok_or(HydrationError::Corrupt)?;
        let change = frame
            .and_then(decode)
            .map_err(|error| run.failed(error, HydrationError::Corrupt))?;
        run.at((plan.record)(count))?;
        if count > plan.ceiling.get() {
            return Err(exceeded(plan.resource, plan.ceiling));
        }
        admission.charge(&change)?;
        retain(change)?;
    }
    if count != plan.declared {
        return Err(HydrationError::Corrupt);
    }
    run.at(plan.end)
}

fn graph_node(graph: &GraphName) -> Option<NamedOrBlankNode> {
    match graph {
        GraphName::NamedNode(name) => Some(name.clone().into()),
        GraphName::BlankNode(name) => Some(name.clone().into()),
        GraphName::DefaultGraph => None,
    }
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
    reason = "isolated hydration control, admission and integrity assertions"
)]
mod tests {
    use super::*;
    use crate::model::NamedNode;
    use crate::model::vocab::{rdf, rdfs};
    use crate::store::{DerivedGenerationLimits, DerivedIndex};

    type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

    const WIDE: EntailmentProjectionHydrationLimits = EntailmentProjectionHydrationLimits::new(
        NonZeroU64::MAX,
        NonZeroU64::MAX,
        NonZeroU64::MAX,
        NonZeroU64::MAX,
    );

    fn node(local: &str) -> NamedNode {
        NamedNode::new_unchecked(format!("urn:test:{local}"))
    }

    fn dog() -> Quad {
        Quad::new(
            node("fido"),
            rdf::TYPE,
            node("Dog"),
            GraphName::DefaultGraph,
        )
    }

    /// Writes fixed payload bytes behind a valid retained inventory; never reconciles.
    struct Payload(Vec<(&'static str, Vec<u8>)>);

    impl DerivedProvider for Payload {
        fn identity(&self) -> ContributorIdentity {
            entailment_projection_identity()
        }

        fn rebuild(
            &self,
            _: &DerivedSnapshot,
            output: &mut DerivedWriter<'_>,
            _: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            for (name, bytes) in &self.0 {
                output.write_file(name, bytes.as_slice())?;
            }
            Ok(())
        }

        fn reconcile(
            &self,
            _: &DerivedSnapshot,
            _: &DerivedFiles,
            _: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            Ok(())
        }
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
            for quad in [
                Quad::new(
                    node("Dog"),
                    rdfs::SUB_CLASS_OF,
                    node("Animal"),
                    GraphName::DefaultGraph,
                ),
                dog(),
                Quad::new(node("Dog"), rdfs::SUB_CLASS_OF, node("Animal"), node("g")),
                Quad::new(node("rex"), rdf::TYPE, node("Dog"), node("g")),
            ] {
                store.insert(quad)?;
            }
            let index =
                DerivedIndex::create(dir.path().join("index"), entailment_projection_identity())?;
            let mut fixture = Self {
                dir,
                store,
                index,
                limits: DerivedGenerationLimits::default(),
            };
            fixture.publish(&EntailmentProjectionProvider::default())?;
            Ok(fixture)
        }

        fn publish(&mut self, provider: &dyn DerivedProvider) -> TestResult {
            let source = self
                .store
                .derived_snapshot(&TransactionStartControl::new())?;
            let candidate = self.index.rebuild(&source, provider, &self.limits)?;
            self.index
                .activate(&candidate, &source, provider, &self.limits)?;
            Ok(())
        }

        fn payload(&self, name: &str) -> TestResult<Vec<u8>> {
            Ok(std::fs::read(
                self.index.active(&self.limits)?.directory().join(name),
            )?)
        }

        fn hydrate(
            &self,
            limits: &EntailmentProjectionHydrationLimits,
            control: &TransactionStartControl,
            observe: &mut dyn FnMut(Phase),
        ) -> TestResult<Result<EntailmentProjectionSnapshot, HydrationError>> {
            let source = self
                .store
                .derived_snapshot(&TransactionStartControl::new())?;
            let view = self.index.strict(&source, &self.limits)?;
            Ok(EntailmentProjectionSnapshot::hydrate_observed(
                &view, limits, control, observe,
            ))
        }
    }

    fn framed(changes: &[SemanticChange]) -> Result<Framed, DerivedGenerationError> {
        let mut records = Records::new(u64::MAX);
        for change in changes {
            records.push(change)?;
        }
        records.finish(&DerivedLimits::default(), Instant::now())
    }

    #[test]
    fn every_phase_boundary_reports_cancellation_without_a_snapshot() -> TestResult {
        let fx = Fixture::new()?;
        let mut phases = Vec::new();
        fx.hydrate(&WIDE, &TransactionStartControl::new(), &mut |phase| {
            phases.push(phase);
        })??;
        for expected in [
            Phase::Entry,
            Phase::Bound,
            Phase::Meta,
            Phase::Preflight,
            Phase::ImageRead,
            Phase::ImageRecord(1),
            Phase::ImageEnd,
            Phase::InferredRead,
            Phase::InferredRecord(1),
            Phase::InferredEnd,
            Phase::Final,
        ] {
            assert!(
                phases.contains(&expected),
                "phase {expected:?} was never observed"
            );
        }
        assert_eq!(
            phases.last(),
            Some(&Phase::Final),
            "final publication must be the last checkpoint"
        );
        for target in phases {
            let control = TransactionStartControl::new();
            let mut reached = false;
            let result = fx.hydrate(&WIDE, &control, &mut |phase| {
                if phase == target {
                    reached = true;
                    control.cancel();
                }
            })?;
            assert!(reached, "{target:?} was not reached");
            assert!(
                matches!(result, Err(HydrationError::Cancelled)),
                "{target:?}: {result:?}"
            );
        }
        Ok(())
    }

    #[test]
    fn relative_deadline_expiring_at_eof_and_final_boundaries_is_timed_out() -> TestResult {
        let fx = Fixture::new()?;
        let timeout = Duration::from_secs(1);
        for target in [Phase::ImageEnd, Phase::InferredEnd, Phase::Final] {
            let control = TransactionStartControl::new().with_timeout(timeout);
            let entered = Instant::now();
            let mut reached = false;
            let result = fx.hydrate(&WIDE, &control, &mut |phase| {
                if phase == target {
                    assert!(
                        entered.elapsed() < timeout,
                        "deadline expired before {target:?}"
                    );
                    reached = true;
                    // Delay at an observed checkpoint; never infer the boundary from sleep alone.
                    std::thread::sleep(timeout);
                }
            })?;
            assert!(reached, "{target:?} was not reached");
            assert!(
                matches!(result, Err(HydrationError::TimedOut)),
                "{target:?}: {result:?}"
            );
        }
        Ok(())
    }

    #[test]
    fn estimated_byte_rejection_stops_before_later_frames_and_cancellation_wins() -> TestResult {
        let fx = Fixture::new()?;
        let image = fx.payload(FILE_IMAGE)?;
        let first = Frames::new(&image).next().ok_or("empty image")??;
        let first = match decode(first)? {
            SemanticChange::QuadAdded(quad) => record_estimate(&quad),
            SemanticChange::NamedGraphCreated(graph) => record_estimate(&graph),
            _ => return Err("unexpected image record kind".into()),
        }
        .ok_or("estimate overflow")?;
        let ceiling = NonZeroU64::new(first).ok_or("zero estimate")?;
        let limits = EntailmentProjectionHydrationLimits {
            max_estimated_bytes: ceiling,
            ..WIDE
        };
        let mut seen = Vec::new();
        let result = fx.hydrate(&limits, &TransactionStartControl::new(), &mut |phase| {
            seen.push(phase);
        })?;
        assert!(
            matches!(
                result,
                Err(HydrationError::LimitExceeded {
                    resource: Resource::EstimatedBytes,
                    ceiling,
                }) if ceiling == first
            ),
            "{result:?}"
        );
        assert_eq!(
            seen.last(),
            Some(&Phase::ImageRecord(2)),
            "a later frame was decoded after the rejection"
        );
        assert!(
            !seen.contains(&Phase::InferredRead),
            "inferred payload was read after the rejection"
        );
        let control = TransactionStartControl::new();
        let result = fx.hydrate(&limits, &control, &mut |phase| {
            if phase == Phase::ImageRecord(2) {
                control.cancel();
            }
        })?;
        assert!(
            matches!(result, Err(HydrationError::Cancelled)),
            "cancellation must win over simultaneous admission exhaustion: {result:?}"
        );
        Ok(())
    }

    #[test]
    fn absolute_deadlines_cover_final_decode_publication_and_nested_reader() -> TestResult {
        let fx = Fixture::new()?;
        let expired = TransactionStartControl::new()
            .with_cancellation_token(CancellationToken::new().with_deadline(Instant::now()));
        assert!(matches!(
            fx.hydrate(&WIDE, &expired, &mut |_| {})?,
            Err(HydrationError::TimedOut)
        ));
        let mut phases = Vec::new();
        fx.hydrate(&WIDE, &TransactionStartControl::new(), &mut |p| {
            phases.push(p)
        })??;
        let last_record = *phases
            .iter()
            .rev()
            .find(|p| matches!(p, Phase::InferredRecord(_)))
            .ok_or("no inferred record")?;
        for target in [last_record, Phase::InferredEnd, Phase::Final] {
            let deadline = Instant::now() + Duration::from_secs(1);
            let control = TransactionStartControl::new()
                .with_cancellation_token(CancellationToken::new().with_deadline(deadline));
            let mut reached = false;
            let result = fx.hydrate(&WIDE, &control, &mut |phase| {
                if phase == target {
                    assert!(Instant::now() < deadline, "expired before {target:?}");
                    reached = true;
                    std::thread::sleep(deadline.saturating_duration_since(Instant::now()));
                }
            })?;
            assert!(reached, "missing {target:?}");
            assert!(
                matches!(result, Err(HydrationError::TimedOut)),
                "{target:?}: {result:?}"
            );
        }
        let source = fx.store.derived_snapshot(&TransactionStartControl::new())?;
        let view = fx.index.strict(&source, &fx.limits)?;
        let mut observe = |_| {};
        let run = Run {
            control: &expired,
            input: DerivedLimits {
                control: expired.clone(),
                ..DerivedLimits::default()
            },
            started: Instant::now(),
            observe: &mut observe,
        };
        let error = read_all(
            view.generation().files(),
            FILE_META,
            MAX_META,
            &run.input,
            run.started,
        )
        .expect_err("expired reader succeeded");
        assert!(
            matches!(
                &error,
                DerivedGenerationError::Backup(BackupError::Cancelled)
            ),
            "unexpected reader error: {error:?}"
        );
        assert!(matches!(
            run.failed(error, HydrationError::Corrupt),
            HydrationError::TimedOut
        ));
        Ok(())
    }

    #[test]
    fn inconsistent_payloads_behind_a_valid_inventory_fail_closed() -> TestResult {
        let mut fx = Fixture::new()?;
        let meta = Meta::decode(&fx.payload(FILE_META)?)?;
        let image = fx.payload(FILE_IMAGE)?;
        let inferred = fx.payload(FILE_INFERRED)?;
        assert!(meta.image.records >= 2, "fixture image too small");

        // Positive control: the same bytes through the fixed-payload provider hydrate.
        fx.publish(&Payload(vec![
            (FILE_META, meta.encode()),
            (FILE_IMAGE, image.clone()),
            (FILE_INFERRED, inferred.clone()),
        ]))?;
        fx.hydrate(&WIDE, &TransactionStartControl::new(), &mut |_| {})??;

        let mut cases: Vec<(&str, Meta, Vec<u8>, Vec<u8>)> = Vec::new();
        let mut changed = meta.clone();
        changed.image.records += 1;
        cases.push(("image count", changed, image.clone(), inferred.clone()));
        let mut changed = meta.clone();
        changed.inferred.records += 1;
        cases.push(("inferred count", changed, image.clone(), inferred.clone()));
        let mut changed = meta.clone();
        changed.limits.max_source_quads = NonZeroU64::MIN;
        cases.push(("stored ceiling", changed, image.clone(), inferred.clone()));
        let mut changed = meta.clone();
        changed.last = Some((u64::MAX, [3; 32]));
        cases.push(("position", changed, image.clone(), inferred.clone()));
        let mut trailing = image.clone();
        trailing.extend_from_slice(&[0, 0, 0]);
        let mut changed = meta.clone();
        changed.image = Section {
            records: meta.image.records,
            bytes: u64::try_from(trailing.len())?,
            sha256: sha256(&trailing),
        };
        cases.push(("trailing frame", changed, trailing, inferred.clone()));
        let removed = framed(&[SemanticChange::QuadRemoved(dog())])?;
        let mut changed = meta.clone();
        changed.image = removed.section;
        cases.push(("event kind", changed, removed.bytes, inferred.clone()));
        let orphan = framed(&[SemanticChange::QuadAdded(Quad::new(
            node("s"),
            node("p"),
            node("o"),
            node("orphan"),
        ))])?;
        let mut changed = meta.clone();
        changed.image = orphan.section;
        cases.push(("undeclared graph", changed, orphan.bytes, inferred.clone()));
        let overlap = framed(&[SemanticChange::QuadAdded(dog())])?;
        let mut changed = meta.clone();
        changed.inferred = overlap.section;
        cases.push(("inferred overlap", changed, image.clone(), overlap.bytes));
        let redeclared = framed(&[SemanticChange::NamedGraphCreated(node("g").into())])?;
        let mut changed = meta.clone();
        changed.inferred = redeclared.section;
        cases.push(("redeclared graph", changed, image.clone(), redeclared.bytes));
        let unhosted = framed(&[SemanticChange::QuadAdded(Quad::new(
            node("s"),
            node("p"),
            node("o"),
            node("nowhere"),
        ))])?;
        let mut changed = meta.clone();
        changed.inferred = unhosted.section;
        cases.push(("unhosted inferred", changed, image.clone(), unhosted.bytes));

        for (case, meta, image, inferred) in cases {
            fx.publish(&Payload(vec![
                (FILE_META, meta.encode()),
                (FILE_IMAGE, image),
                (FILE_INFERRED, inferred),
            ]))?;
            let result = fx.hydrate(&WIDE, &TransactionStartControl::new(), &mut |_| {})?;
            assert!(
                matches!(result, Err(HydrationError::Corrupt)),
                "{case}: {result:?}"
            );
        }

        let mut foreign = META_MAGIC.to_vec();
        foreign.extend_from_slice(&2_u32.to_be_bytes());
        let sum = sha256(&foreign);
        foreign.extend_from_slice(&sum);
        fx.publish(&Payload(vec![
            (FILE_META, foreign),
            (FILE_IMAGE, image),
            (FILE_INFERRED, inferred),
        ]))?;
        let result = fx.hydrate(&WIDE, &TransactionStartControl::new(), &mut |_| {})?;
        assert!(
            matches!(result, Err(HydrationError::Identity)),
            "foreign meta schema: {result:?}"
        );
        Ok(())
    }

    #[test]
    fn source_binding_distinguishes_lineage_from_freshness() -> TestResult {
        let fx = Fixture::new()?;
        let control = TransactionStartControl::new();
        let before = fx.store.derived_snapshot(&control)?.checkpoint().clone();
        fx.store.insert(Quad::new(
            node("tom"),
            rdf::TYPE,
            node("Dog"),
            GraphName::DefaultGraph,
        ))?;
        let after = fx.store.derived_snapshot(&control)?.checkpoint().clone();
        let other = Store::open(fx.dir.path().join("other"))?;
        let foreign = other.derived_snapshot(&control)?.checkpoint().clone();
        assert!(
            bind_source(&before, &before).is_ok(),
            "exact binding refused"
        );
        assert!(
            matches!(
                bind_source(&before, &after),
                Err(HydrationError::ProjectionNotFresh)
            ),
            "same lineage must be stale"
        );
        assert!(
            matches!(
                bind_source(&before, &foreign),
                Err(HydrationError::Identity)
            ),
            "foreign lineage must be identity"
        );
        Ok(())
    }

    #[test]
    fn nested_categories_are_normalized_without_display_parsing() {
        assert!(
            matches!(
                normalize(DerivedGenerationError::Backup(BackupError::Cancelled)),
                HydrationError::Cancelled
            ),
            "backup cancellation"
        );
        assert!(
            matches!(
                normalize(DerivedGenerationError::Input(DerivedError::Backup(
                    BackupError::TimedOut
                ))),
                HydrationError::TimedOut
            ),
            "input deadline"
        );
        assert!(
            matches!(
                normalize(DerivedGenerationError::Corrupt),
                HydrationError::Corrupt
            ),
            "corruption"
        );
        assert!(
            matches!(
                normalize(DerivedGenerationError::Identity),
                HydrationError::Identity
            ),
            "identity"
        );
        assert!(
            matches!(
                normalize(DerivedGenerationError::NotFresh),
                HydrationError::ProjectionNotFresh
            ),
            "freshness"
        );
        assert!(
            matches!(
                normalize(DerivedGenerationError::Busy),
                HydrationError::Generation(DerivedGenerationError::Busy)
            ),
            "remaining causes are preserved"
        );
    }
}
