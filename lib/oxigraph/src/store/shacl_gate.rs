//! Opt-in full staged-view validation under the native governed writer permit.
use super::{
    ChangeTrackingError, CommitReceipt, GovernedTransaction, Namespace, NamespacePrefix,
    NegotiatedTransaction, OutcomeAwareWritableDataset, SemanticChange, StorageError, Store,
    TransactionCommitError, TransactionKey, TransactionRequest, TransactionRollbackError,
    TransactionStartControl, TransactionStartError, WritableDataset, WritableNamespaceRegistry,
};
use crate::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    CancellationToken, CompileError, ConformanceRequest, GraphSnapshot, LimitKind, ProfileSet,
    ShapesGraph, ValidationError, ValidationOptions, ValidationReport, Validator,
};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::time::Instant;

type BackendError = ChangeTrackingError<StorageError>;

/// One explicitly selected graph. Required named graphs must exist in the
/// resulting staged state (they may be created by this transaction);
/// an optional absent graph is validated as empty, with its absence recorded.
#[derive(Clone, Debug)]
pub struct ShaclGraphScope {
    pub graph_name: GraphName,
    pub required: bool,
}

/// External RDF shapes are owned and pinned at begin. Stored shapes are read
/// under the writer permit; mutable shapes are compiled again from staged state.
/// Imports and remote resolution are not supported by this gate.
#[derive(Clone, Debug)]
pub enum ShaclShapesSource {
    External(Box<GraphSnapshot>),
    Stored {
        graph_name: GraphName,
        mutable: bool,
    },
}

/// Cancels both native writer admission and SHACL evaluation. Clone before
/// beginning a transaction to cancel it from another thread.
#[derive(Clone, Debug, Default)]
pub struct ShaclTransactionControl {
    admission: TransactionStartControl,
    validation: CancellationToken,
}

impl ShaclTransactionControl {
    pub fn cancel(&self) {
        self.admission.cancel();
        self.validation.cancel();
    }
}

/// Owned, immutable-after-begin validation policy. No inference or rule
/// materialization is performed. Each data graph is validated independently.
#[derive(Clone, Debug)]
#[must_use]
pub struct ShaclCommitPolicy {
    data: Vec<ShaclGraphScope>,
    shapes: ShaclShapesSource,
    profiles: ProfileSet,
    options: ValidationOptions,
    control: ShaclTransactionControl,
    max_graphs: usize,
    max_snapshot_bytes: usize,
}

impl ShaclCommitPolicy {
    pub fn new(data: Vec<ShaclGraphScope>, shapes: ShaclShapesSource) -> Self {
        Self {
            data,
            shapes,
            profiles: ProfileSet::default(),
            options: ValidationOptions::default(),
            control: ShaclTransactionControl::default(),
            max_graphs: 32,
            max_snapshot_bytes: 64 * 1024 * 1024,
        }
    }

    pub fn with_profiles(mut self, profiles: ProfileSet) -> Self {
        self.profiles = profiles;
        self
    }

    /// Processor limits apply per compile/graph, except data quads, results,
    /// and deadline, which are cumulative across this transaction's gate.
    /// A finite timeout is required and includes writer admission and staging.
    pub fn with_validation_options(mut self, options: ValidationOptions) -> Self {
        self.control.validation = options.cancellation_token.clone();
        self.options = options;
        self
    }

    /// Additional gate bounds: selected graph count and cumulative logical
    /// snapshot bytes, including retained report-shapes copies (framed RDF
    /// terms, not all processor allocations or allocator/RSS accounting).
    pub fn with_snapshot_limits(mut self, max_graphs: usize, max_bytes: usize) -> Self {
        self.max_graphs = max_graphs;
        self.max_snapshot_bytes = max_bytes;
        self
    }

    pub fn control(&self) -> ShaclTransactionControl {
        self.control.clone()
    }

    fn check(&self, started: Instant) -> Result<(), ShaclGateError> {
        if self.control.validation.is_cancelled() || self.control.admission.is_cancelled() {
            return Err(ValidationError::Cancelled.into());
        }
        let timeout = self.options.limits.timeout.ok_or(ShaclGateError::Policy(
            "a finite transaction validation timeout is required",
        ))?;
        if started.elapsed() >= timeout {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::Time,
                limit: usize::try_from(timeout.as_millis()).unwrap_or(usize::MAX),
            }
            .into());
        }
        Ok(())
    }

    fn remaining_options(&self, started: Instant) -> Result<ValidationOptions, ShaclGateError> {
        self.check(started)?;
        let mut options = self.options.clone();
        options.cancellation_token = self.control.validation.clone();
        options.limits.timeout = options
            .limits
            .timeout
            .map(|timeout| timeout.saturating_sub(started.elapsed()));
        Ok(options)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ShaclGateError {
    #[error("invalid SHACL commit policy: {0}")]
    Policy(&'static str),
    #[error("required selected graph is absent: {0}")]
    MissingGraph(GraphName),
    #[error("immutable stored shapes changed")]
    ShapesChanged,
    #[error("cumulative logical snapshot byte limit exceeded: {0}")]
    SnapshotBytes(usize),
    #[error("staged data does not conform in graph {graph_name}")]
    Nonconforming {
        graph_name: GraphName,
        report: Box<ValidationReport>,
    },
    #[error(transparent)]
    Validation(#[from] ValidationError),
    #[error(transparent)]
    Compile(#[from] CompileError),
    #[error(transparent)]
    Backend(#[from] BackendError),
}

#[derive(Debug, thiserror::Error)]
pub enum ShaclStartError {
    #[error(transparent)]
    Admission(#[from] TransactionStartError<StorageError>),
    #[error("SHACL policy could not be admitted: {source}; rollback failure: {rollback:?}")]
    Policy {
        #[source]
        source: ShaclGateError,
        rollback: Option<TransactionRollbackError<BackendError>>,
    },
}

/// Rejection consumes the transaction via explicit rollback. Once native
/// commit is attempted, its exact outcome is retained and rollback is not tried.
#[derive(Debug, thiserror::Error)]
pub enum ShaclCommitError {
    #[error("SHACL commit rejected: {source}; rollback failure: {rollback:?}")]
    Rejected {
        #[source]
        source: ShaclGateError,
        rollback: Option<TransactionRollbackError<BackendError>>,
    },
    #[error(transparent)]
    Commit(#[from] TransactionCommitError<BackendError>),
}

/// Diagnostic report; may contain RDF payloads. It is not a durable policy receipt.
#[derive(Clone, Debug)]
pub struct ShaclGraphValidation {
    pub graph_name: GraphName,
    pub present: bool,
    pub report: ValidationReport,
}

#[derive(Clone, Debug)]
pub struct ShaclCommitReport {
    pub receipt: CommitReceipt,
    /// Exact RDF identity, including graph name/presence and blank-node labels.
    /// Order independent, not RDF graph-isomorphism canonicalization.
    pub shapes_at_begin: [u8; 32],
    pub shapes_at_commit: [u8; 32],
    pub graphs: Vec<ShaclGraphValidation>,
}

/// A governed transaction with no mutable escape hatch around its SHACL gate.
#[must_use]
pub struct ShaclTransaction<'a> {
    inner: GovernedTransaction<'a>,
    policy: ShaclCommitPolicy,
    started: Instant,
    shapes_at_begin: [u8; 32],
}

impl<'a> ShaclTransaction<'a> {
    pub(super) fn start(
        store: &'a Store,
        request: TransactionRequest,
        key: TransactionKey,
        mut policy: ShaclCommitPolicy,
    ) -> Result<NegotiatedTransaction<Self>, ShaclStartError> {
        let started = Instant::now();
        let check = || {
            policy.check(started)?;
            if policy.data.is_empty() || policy.data.len() > policy.max_graphs {
                return Err(ShaclGateError::Policy(
                    "selected data graph count outside limit",
                ));
            }
            let mut seen = HashSet::new();
            if policy
                .data
                .iter()
                .any(|scope| !seen.insert(&scope.graph_name))
            {
                return Err(ShaclGateError::Policy("duplicate selected data graph"));
            }
            Ok(())
        };
        check().map_err(|source| ShaclStartError::Policy {
            source,
            rollback: None,
        })?;
        let options =
            policy
                .remaining_options(started)
                .map_err(|source| ShaclStartError::Policy {
                    source,
                    rollback: None,
                })?;
        let control = policy
            .control
            .admission
            .clone()
            .with_timeout(options.limits.timeout.unwrap_or_default());
        let negotiated = store.start_governed_transaction_with_control(request, key, control)?;
        let effective = negotiated.effective_capabilities().clone();
        let inner = negotiated.into_transaction();
        let prepare = || {
            let mut budget = SnapshotBudget::default();
            let (snapshot, identity) = match &policy.shapes {
                ShaclShapesSource::External(source) => {
                    external_snapshot(source, &policy, started, &mut budget)?
                }
                ShaclShapesSource::Stored { graph_name, .. } => staged_snapshot(
                    &inner,
                    graph_name,
                    true,
                    true,
                    &policy,
                    started,
                    &mut budget,
                )?,
            };
            let shapes_bytes = budget.bytes;
            budget.charge_copy(shapes_bytes, &policy)?; // Compiled source clone.
            if matches!(policy.shapes, ShaclShapesSource::External(_)) {
                budget.charge_copy(shapes_bytes, &policy)?; // Owned external source.
            }
            ShapesGraph::compile_checked(
                &snapshot,
                policy.profiles.clone(),
                &policy.remaining_options(started)?,
            )?;
            policy.check(started)?;
            Ok::<_, ShaclGateError>((snapshot, identity))
        };
        let (snapshot, shapes_at_begin) = match prepare() {
            Ok(value) => value,
            Err(source) => {
                return Err(ShaclStartError::Policy {
                    source,
                    rollback: inner.rollback().err(),
                });
            }
        };
        if matches!(policy.shapes, ShaclShapesSource::External(_)) {
            // Discard unrelated graphs in a caller-supplied external dataset.
            policy.shapes = ShaclShapesSource::External(Box::new(snapshot));
        }
        Ok(NegotiatedTransaction::new(
            Self {
                inner,
                policy,
                started,
                shapes_at_begin,
            },
            effective,
        ))
    }

    pub fn transaction_key(&self) -> &TransactionKey {
        self.inner.transaction_key()
    }

    #[expect(
        clippy::same_name_method,
        reason = "typed commit report refines the minimal write trait"
    )]
    pub fn commit(self) -> Result<ShaclCommitReport, ShaclCommitError> {
        let (shapes_at_commit, graphs) = match self.validate() {
            Ok(value) => value,
            Err(source) => {
                return Err(ShaclCommitError::Rejected {
                    source,
                    rollback: self.inner.rollback().err(),
                });
            }
        };
        let receipt = self.inner.commit()?;
        Ok(ShaclCommitReport {
            receipt,
            shapes_at_begin: self.shapes_at_begin,
            shapes_at_commit,
            graphs,
        })
    }

    #[expect(
        clippy::same_name_method,
        reason = "typed rollback preserves native outcome"
    )]
    pub fn rollback(self) -> Result<(), TransactionRollbackError<BackendError>> {
        self.inner.rollback()
    }

    fn validate(&self) -> Result<([u8; 32], Vec<ShaclGraphValidation>), ShaclGateError> {
        let mut budget = SnapshotBudget::default();
        let (shapes, identity) = match &self.policy.shapes {
            ShaclShapesSource::External(source) => {
                external_snapshot(source, &self.policy, self.started, &mut budget)?
            }
            ShaclShapesSource::Stored {
                graph_name,
                mutable,
            } => {
                let snapshot = staged_snapshot(
                    &self.inner,
                    graph_name,
                    true,
                    true,
                    &self.policy,
                    self.started,
                    &mut budget,
                )?;
                if !mutable && snapshot.1 != self.shapes_at_begin {
                    return Err(ShaclGateError::ShapesChanged);
                }
                snapshot
            }
        };
        let shapes_bytes = budget.bytes;
        budget.charge_copy(shapes_bytes, &self.policy)?; // Compiled source clone.
        if matches!(self.policy.shapes, ShaclShapesSource::External(_)) {
            budget.charge_copy(shapes_bytes, &self.policy)?; // Pinned external source.
        }
        let compiled = ShapesGraph::compile_checked(
            &shapes,
            self.policy.profiles.clone(),
            &self.policy.remaining_options(self.started)?,
        )?;
        let mut graphs = Vec::new();
        let mut results = 0_usize;
        for scope in &self.policy.data {
            let (snapshot, _) = staged_snapshot(
                &self.inner,
                &scope.graph_name,
                scope.required,
                false,
                &self.policy,
                self.started,
                &mut budget,
            )?;
            let mut options = self.policy.remaining_options(self.started)?;
            options.limits.max_results = options.limits.max_results.saturating_sub(results);
            // ValidationReport owns a clone of the shapes graph. Charge it
            // before validation creates it, even for a nonconforming report.
            budget.charge_copy(shapes_bytes, &self.policy)?;
            let report = Validator::new(&compiled, &options)
                .validate(&snapshot, ConformanceRequest::ImplementedFeatureSet)?;
            self.policy.check(self.started)?;
            if !report.conforms() {
                return Err(ShaclGateError::Nonconforming {
                    graph_name: scope.graph_name.clone(),
                    report: Box::new(report),
                });
            }
            results = results.saturating_add(report.results().len());
            graphs.push(ShaclGraphValidation {
                graph_name: scope.graph_name.clone(),
                present: snapshot_present(&snapshot),
                report,
            });
        }
        self.policy.check(self.started)?;
        Ok((identity, graphs))
    }
}

#[derive(Default)]
struct SnapshotBudget {
    data: usize,
    shapes: usize,
    bytes: usize,
}

impl SnapshotBudget {
    fn charge_copy(
        &mut self,
        bytes: usize,
        policy: &ShaclCommitPolicy,
    ) -> Result<(), ShaclGateError> {
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .filter(|total| *total <= policy.max_snapshot_bytes)
            .ok_or(ShaclGateError::SnapshotBytes(policy.max_snapshot_bytes))?;
        Ok(())
    }
}

fn snapshot_present(source: &GraphSnapshot) -> bool {
    match source.graph_name() {
        GraphName::DefaultGraph => true,
        GraphName::NamedNode(name) => source.dataset().contains_named_graph(name),
        GraphName::BlankNode(name) => source.dataset().contains_named_graph(name),
    }
}

fn external_snapshot(
    source: &GraphSnapshot,
    policy: &ShaclCommitPolicy,
    started: Instant,
    budget: &mut SnapshotBudget,
) -> Result<(GraphSnapshot, [u8; 32]), ShaclGateError> {
    let present = snapshot_present(source);
    if !present {
        return Err(ShaclGateError::MissingGraph(source.graph_name().clone()));
    }
    collect_snapshot(
        source.graph_name(),
        present,
        source
            .triples()
            .map(|triple| Ok(triple.in_graph(source.graph_name().clone()))),
        true,
        policy,
        started,
        budget,
    )
}

fn staged_snapshot(
    tx: &GovernedTransaction<'_>,
    name: &GraphName,
    required: bool,
    shapes: bool,
    policy: &ShaclCommitPolicy,
    started: Instant,
    budget: &mut SnapshotBudget,
) -> Result<(GraphSnapshot, [u8; 32]), ShaclGateError> {
    policy.check(started)?;
    let named = match name {
        GraphName::DefaultGraph => None,
        GraphName::NamedNode(name) => Some(NamedOrBlankNode::NamedNode(name.clone())),
        GraphName::BlankNode(name) => Some(NamedOrBlankNode::BlankNode(name.clone())),
    };
    let present = named
        .as_ref()
        .map(|name| tx.contains_named_graph(name))
        .transpose()?
        .unwrap_or(true);
    if required && !present {
        return Err(ShaclGateError::MissingGraph(name.clone()));
    }
    collect_snapshot(
        name,
        present,
        tx.quads_for_pattern(None, None, None, Some(named.as_ref())),
        shapes,
        policy,
        started,
        budget,
    )
}

fn collect_snapshot(
    name: &GraphName,
    present: bool,
    quads: impl Iterator<Item = Result<Quad, BackendError>>,
    shapes: bool,
    policy: &ShaclCommitPolicy,
    started: Instant,
    budget: &mut SnapshotBudget,
) -> Result<(GraphSnapshot, [u8; 32]), ShaclGateError> {
    policy.check(started)?;
    let mut dataset = Dataset::new();
    if present {
        match name {
            GraphName::DefaultGraph => (),
            GraphName::NamedNode(name) => {
                dataset.insert_named_graph(name.clone());
            }
            GraphName::BlankNode(name) => {
                dataset.insert_named_graph(name.clone());
            }
        }
    }
    let mut records = Vec::new();
    let mut identity = Sha256::new();
    identity.update(b"oxigraph.shacl-exact-graph.v1\0");
    identity.update([u8::from(present)]);
    // The same logical encoder frames graph names and RDF terms without a
    // recursive formatter or an outbox-specific triple-depth restriction.
    super::change_codec::emit(&SemanticChange::GraphCleared(name.clone()), &mut |bytes| {
        budget.bytes = budget.bytes.saturating_add(bytes.len());
        identity.update(bytes);
    });
    for quad in quads {
        policy.check(started)?;
        let quad = quad?;
        let (count, limit, kind) = if shapes {
            (
                &mut budget.shapes,
                policy.options.limits.max_shape_quads,
                LimitKind::ShapeQuads,
            )
        } else {
            (
                &mut budget.data,
                policy.options.limits.max_data_quads,
                LimitKind::DataQuads,
            )
        };
        if *count >= limit {
            return Err(ValidationError::LimitExceeded { kind, limit }.into());
        }
        *count += 1;
        let change = SemanticChange::QuadAdded(quad);
        let mut hash = Sha256::new();
        super::change_codec::emit(&change, &mut |bytes| {
            budget.bytes = budget.bytes.saturating_add(bytes.len());
            hash.update(bytes);
        });
        if budget.bytes > policy.max_snapshot_bytes {
            return Err(ShaclGateError::SnapshotBytes(policy.max_snapshot_bytes));
        }
        records.push(<[u8; 32]>::from(hash.finalize()));
        if let SemanticChange::QuadAdded(quad) = change {
            dataset.insert(quad);
        }
    }
    if budget.bytes > policy.max_snapshot_bytes {
        return Err(ShaclGateError::SnapshotBytes(policy.max_snapshot_bytes));
    }
    records.sort_unstable();
    identity.update((records.len() as u64).to_be_bytes());
    for record in records {
        identity.update(record);
    }
    policy.check(started)?;
    Ok((
        GraphSnapshot::new(dataset, name.clone()),
        identity.finalize().into(),
    ))
}

impl WritableDataset for ShaclTransaction<'_> {
    type Error = BackendError;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Self::Error>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Self::Error>> + 'a>
    where
        Self: 'a;
    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        self.inner
            .quads_for_pattern(subject, predicate, object, graph_name)
    }
    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        self.inner.named_graphs()
    }
    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        self.inner.contains_named_graph(graph_name)
    }
    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.inner.insert(quad)
    }
    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.inner.remove(quad)
    }
    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.inner.insert_named_graph(graph_name)
    }
    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        self.inner.clear_graph(graph_name)
    }
    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_all_named_graphs()
    }
    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_all_graphs()
    }
    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.inner.remove_named_graph(graph_name)
    }
    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.inner.remove_all_named_graphs()
    }
    fn clear(&mut self) -> Result<(), Self::Error> {
        self.inner.clear()
    }
    fn commit(self) -> Result<(), Self::Error> {
        ShaclTransaction::commit(self)
            .map(|_| ())
            .map_err(|error| ChangeTrackingError::Backend(StorageError::Other(Box::new(error))))
    }
    fn rollback(self) -> Result<(), Self::Error> {
        WritableDataset::rollback(self.inner)
    }
}

impl WritableNamespaceRegistry for ShaclTransaction<'_> {
    type Namespaces<'a>
        = Box<dyn Iterator<Item = Result<Namespace, Self::Error>> + 'a>
    where
        Self: 'a;
    fn namespaces(&self) -> Self::Namespaces<'_> {
        self.inner.namespaces()
    }
    fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, Self::Error> {
        self.inner.namespace(prefix)
    }
    fn set_namespace(&mut self, namespace: Namespace) -> Result<(), Self::Error> {
        self.inner.set_namespace(namespace)
    }
    fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), Self::Error> {
        self.inner.remove_namespace(prefix)
    }
    fn clear_namespaces(&mut self) -> Result<(), Self::Error> {
        self.inner.clear_namespaces()
    }
}

impl OutcomeAwareWritableDataset for ShaclTransaction<'_> {
    fn commit_with_outcome(self) -> Result<(), TransactionCommitError<Self::Error>> {
        ShaclTransaction::commit(self)
            .map(|_| ())
            .map_err(|error| match error {
                ShaclCommitError::Commit(outcome) => outcome,
                rejected @ ShaclCommitError::Rejected { .. } => TransactionCommitError::Rejected(
                    ChangeTrackingError::Backend(StorageError::Other(Box::new(rejected))),
                ),
            })
    }
    fn rollback_with_outcome(self) -> Result<(), TransactionRollbackError<Self::Error>> {
        self.inner.rollback()
    }
}
