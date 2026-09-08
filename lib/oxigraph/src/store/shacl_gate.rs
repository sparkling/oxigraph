//! Opt-in full staged-view validation under the native governed writer permit.
use super::{
    ChangeTrackingError, CommitReceipt, GovernedTransaction, Namespace, NamespacePrefix,
    NegotiatedTransaction, OutcomeAwareWritableDataset, SemanticChange, ShaclDisposition,
    ShaclPolicyDescriptor, ShaclValidationEvidence, StorageError, Store, TransactionCommitError,
    TransactionKey, TransactionRequest, TransactionRollbackError, TransactionStartControl,
    TransactionStartError, WritableDataset, WritableNamespaceRegistry,
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
    /// Executable policy comparison without copying RDF terms into the receipt.
    /// Cancellation state and absolute Instant are excluded; the exact timeout
    /// duration and all semantic/resource settings are included.
    pub fn descriptor(&self) -> Result<ShaclPolicyDescriptor, ShaclGateError> {
        use super::shacl_receipt::{MAX_SCOPES, MAX_SEVERITIES};
        if self.data.is_empty()
            || self.data.len() > MAX_SCOPES
            || self.options.conformance_disallows.len() > MAX_SEVERITIES
        {
            return Err(ShaclGateError::Policy(
                "receipt supports 1-128 graph scopes and at most 32 input severities",
            ));
        }
        let profiles = self.profiles.iter().fold(0, |mask, profile| {
            mask | (1
                << match profile {
                    oxshacl::ProfileId::Core12Subset20260723 => 0,
                    oxshacl::ProfileId::NodeExpressions12Subset20260108 => 1,
                    oxshacl::ProfileId::SparqlExtensions12Subset20260130 => 2,
                    oxshacl::ProfileId::Rules12Subset20260727 => 3,
                    oxshacl::ProfileId::CompactSyntax12Subset20251030 => 4,
                })
        });
        let (shapes_source, shapes_graph) = match &self.shapes {
            ShaclShapesSource::External(source) => (0, graph_identity(source.graph_name())),
            ShaclShapesSource::Stored {
                graph_name,
                mutable,
            } => (if *mutable { 2 } else { 1 }, graph_identity(graph_name)),
        };
        let mut severities: Vec<_> = self
            .options
            .conformance_disallows
            .iter()
            .map(|iri| {
                super::receipt::envelope_checksum(
                    b"oxigraph.shacl-severity.v1\0",
                    iri.as_str().as_bytes(),
                )
            })
            .collect();
        severities.sort_unstable();
        severities.dedup();
        let limits = &self.options.limits;
        let descriptor = ShaclPolicyDescriptor {
            profiles,
            scopes: self
                .data
                .iter()
                .map(|scope| (graph_identity(&scope.graph_name), scope.required))
                .collect(),
            shapes_source,
            shapes_graph,
            severities,
            flags: u8::from(self.options.sub_class_of_in_shapes_graph)
                | (u8::from(self.options.report_shapes_graph_well_formed) << 1),
            limits: [
                limits.max_data_quads,
                limits.max_shape_quads,
                limits.max_shapes,
                limits.max_constraints,
                limits.max_focus_nodes,
                limits.max_results,
                limits.max_path_visits,
                limits.max_list_items,
                limits.max_recursion_depth,
                limits.max_query_bytes,
                limits.max_query_solutions,
                limits.max_rule_iterations,
                limits.max_derived_triples,
                limits.max_estimated_memory_bytes,
                self.max_graphs,
                self.max_snapshot_bytes,
            ]
            .map(|value| value as u64),
            timeout: limits
                .timeout
                .ok_or(ShaclGateError::Policy("finite timeout required"))?,
        };
        descriptor
            .validate()
            .map_err(|_| ShaclGateError::Policy("invalid bounded receipt policy descriptor"))?;
        Ok(descriptor)
    }
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
        validation: Box<ShaclValidationEvidence>,
    },
    #[error("native commit after SHACL validation: {outcome}")]
    Commit {
        #[source]
        outcome: TransactionCommitError<BackendError>,
        validation: Box<ShaclValidationEvidence>,
    },
}

impl ShaclCommitError {
    pub fn validation_evidence(&self) -> &ShaclValidationEvidence {
        match self {
            Self::Rejected { validation, .. } | Self::Commit { validation, .. } => validation,
        }
    }
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
    /// Also persisted with the primary receipt in the native validated outcome.
    pub validation: ShaclValidationEvidence,
}

/// A governed transaction with no mutable escape hatch around its SHACL gate.
#[must_use]
pub struct ShaclTransaction<'a> {
    inner: GovernedTransaction<'a>,
    policy: ShaclCommitPolicy,
    started: Instant,
    shapes_at_begin: [u8; 32],
    descriptor: ShaclPolicyDescriptor,
    metrics: std::sync::Arc<super::policy_metrics::PolicyMetricsState>,
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
        let descriptor = policy
            .descriptor()
            .map_err(|source| ShaclStartError::Policy {
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
                descriptor,
                metrics: store.policy_metrics_state(),
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
        let metrics = std::sync::Arc::clone(&self.metrics);
        let started = Instant::now();
        let result = self.commit_inner();
        let disposition = match &result {
            Ok(report) => report.validation.disposition(),
            Err(error) => error.validation_evidence().disposition(),
        };
        metrics.validation(disposition, started.elapsed());
        result
    }

    fn commit_inner(self) -> Result<ShaclCommitReport, ShaclCommitError> {
        let mut validation = ShaclValidationEvidence {
            policy: self.descriptor.clone(),
            shapes_at_begin: self.shapes_at_begin,
            shapes_at_commit: None,
            topology: vec![None; self.policy.data.len()],
            validated_graphs: 0,
            disposition: ShaclDisposition::PolicyError,
        };
        let (shapes_at_commit, graphs) = match self.validate(&mut validation) {
            Ok(value) => value,
            Err(source) => {
                validation.disposition = disposition(&source);
                return Err(ShaclCommitError::Rejected {
                    source,
                    rollback: self.inner.rollback().err(),
                    validation: Box::new(validation),
                });
            }
        };
        validation.disposition = ShaclDisposition::Accepted;
        let before_attempt = || {
            self.policy
                .check(self.started)
                .map_err(|error| StorageError::Other(Box::new(error)))
        };
        let receipt = self
            .inner
            .commit_validated(&validation, &before_attempt)
            .map_err(|outcome| commit_error(outcome, validation.clone()))?;
        Ok(ShaclCommitReport {
            receipt,
            shapes_at_begin: self.shapes_at_begin,
            shapes_at_commit,
            graphs,
            validation,
        })
    }

    #[expect(
        clippy::same_name_method,
        reason = "typed rollback preserves native outcome"
    )]
    pub fn rollback(self) -> Result<(), TransactionRollbackError<BackendError>> {
        self.inner.rollback()
    }

    fn validate(
        &self,
        evidence: &mut ShaclValidationEvidence,
    ) -> Result<([u8; 32], Vec<ShaclGraphValidation>), ShaclGateError> {
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
                evidence.shapes_at_commit = Some(snapshot.1);
                if !mutable && snapshot.1 != self.shapes_at_begin {
                    return Err(ShaclGateError::ShapesChanged);
                }
                snapshot
            }
        };
        let shapes_bytes = budget.bytes;
        evidence.shapes_at_commit = Some(identity);
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
        for (index, scope) in self.policy.data.iter().enumerate() {
            let snapshot = staged_snapshot(
                &self.inner,
                &scope.graph_name,
                scope.required,
                false,
                &self.policy,
                self.started,
                &mut budget,
            );
            if matches!(&snapshot, Err(ShaclGateError::MissingGraph(_))) {
                evidence.topology[index] = Some(false);
            }
            let (snapshot, _) = snapshot?;
            evidence.topology[index] = Some(snapshot_present(&snapshot));
            let mut options = self.policy.remaining_options(self.started)?;
            options.limits.max_results = options.limits.max_results.saturating_sub(results);
            // ValidationReport owns a clone of the shapes graph. Charge it
            // before validation creates it, even for a nonconforming report.
            budget.charge_copy(shapes_bytes, &self.policy)?;
            let report = Validator::new(&compiled, &options)
                .validate(&snapshot, ConformanceRequest::ImplementedFeatureSet)?;
            evidence.validated_graphs = u16::try_from(index + 1)
                .map_err(|_| ShaclGateError::Policy("validated graph count overflow"))?;
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

fn commit_error(
    outcome: TransactionCommitError<BackendError>,
    mut validation: ShaclValidationEvidence,
) -> ShaclCommitError {
    let outcome = match outcome {
        TransactionCommitError::Rejected(ChangeTrackingError::Backend(StorageError::Other(
            error,
        ))) => match error.downcast::<super::shacl_receipt::ValidationPreAttemptError>() {
            Ok(error) => {
                let source = match error.source {
                    StorageError::Other(source) => match source.downcast::<ShaclGateError>() {
                        Ok(source) => *source,
                        Err(source) => ShaclGateError::Backend(ChangeTrackingError::Backend(
                            StorageError::Other(source),
                        )),
                    },
                    source => ShaclGateError::Backend(ChangeTrackingError::Backend(source)),
                };
                validation.disposition = disposition(&source);
                return ShaclCommitError::Rejected {
                    source,
                    rollback: error.rollback.map(|source| {
                        TransactionRollbackError::Failed(ChangeTrackingError::Backend(source))
                    }),
                    validation: Box::new(validation),
                };
            }
            Err(error) => TransactionCommitError::Rejected(ChangeTrackingError::Backend(
                StorageError::Other(error),
            )),
        },
        other => other,
    };
    ShaclCommitError::Commit {
        outcome,
        validation: Box::new(validation),
    }
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    clippy::panic_in_result_fn,
    reason = "native SHACL fault contract assertions"
)]
mod tests {
    use super::*;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    use crate::store::CommitReceiptOutcome;
    use crate::store::ShaclReceiptOutcome;
    type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;
    fn key(id: u8) -> TransactionKey {
        TransactionKey::new([id; 16])
    }
    fn policy() -> ShaclCommitPolicy {
        ShaclCommitPolicy::new(
            vec![ShaclGraphScope {
                graph_name: GraphName::DefaultGraph,
                required: true,
            }],
            ShaclShapesSource::External(Box::new(GraphSnapshot::default_graph(Dataset::default()))),
        )
    }
    fn quad() -> Quad {
        let name = NamedNode::new_unchecked("urn:atomic");
        Quad::new(name.clone(), name.clone(), name, GraphName::DefaultGraph)
    }
    fn accepted(tx: &ShaclTransaction<'_>) -> ShaclValidationEvidence {
        ShaclValidationEvidence {
            policy: tx.descriptor.clone(),
            shapes_at_begin: tx.shapes_at_begin,
            shapes_at_commit: Some(tx.shapes_at_begin),
            topology: vec![Some(true)],
            validated_graphs: 1,
            disposition: ShaclDisposition::Accepted,
        }
    }
    #[test]
    fn descriptor_captures_every_resource_and_semantic_setting() -> TestResult {
        let base = policy();
        let expected = base.descriptor()?;
        assert_eq!(
            expected.profiles().collect::<Vec<_>>(),
            vec!["shacl-1.2-core-2026-07-23-subset-v1"]
        );
        for index in 0..16 {
            let mut changed = base.clone();
            let limits = &mut changed.options.limits;
            let fields = [
                &mut limits.max_data_quads,
                &mut limits.max_shape_quads,
                &mut limits.max_shapes,
                &mut limits.max_constraints,
                &mut limits.max_focus_nodes,
                &mut limits.max_results,
                &mut limits.max_path_visits,
                &mut limits.max_list_items,
                &mut limits.max_recursion_depth,
                &mut limits.max_query_bytes,
                &mut limits.max_query_solutions,
                &mut limits.max_rule_iterations,
                &mut limits.max_derived_triples,
                &mut limits.max_estimated_memory_bytes,
                &mut changed.max_graphs,
                &mut changed.max_snapshot_bytes,
            ];
            *fields.into_iter().nth(index).unwrap() += 1;
            let actual = changed.descriptor()?;
            for position in 0..16 {
                assert_eq!(
                    actual.limits()[position],
                    expected.limits()[position] + u64::from(position == index)
                );
            }
            assert_ne!(actual.fingerprint(), expected.fingerprint());
        }
        let mut changes = Vec::new();
        let mut changed = base.clone();
        changed.options.limits.timeout =
            Some(expected.timeout() + std::time::Duration::from_nanos(1));
        changes.push(changed);
        let mut changed = base.clone();
        changed.options.sub_class_of_in_shapes_graph =
            !changed.options.sub_class_of_in_shapes_graph;
        changes.push(changed);
        let mut changed = base.clone();
        changed.options.report_shapes_graph_well_formed =
            !changed.options.report_shapes_graph_well_formed;
        changes.push(changed);
        let mut changed = base.clone();
        changed.data[0].required = false;
        changes.push(changed);
        let mut changed = base.clone();
        changed.data[0].graph_name = NamedNode::new_unchecked("urn:other").into();
        changes.push(changed);
        for mutable in [false, true] {
            let mut changed = base.clone();
            changed.shapes = ShaclShapesSource::Stored {
                graph_name: GraphName::DefaultGraph,
                mutable,
            };
            changes.push(changed);
        }
        let mut changed = base.clone();
        changed.profiles = ProfileSet::new([
            oxshacl::ProfileId::Core12Subset20260723,
            oxshacl::ProfileId::NodeExpressions12Subset20260108,
        ])?;
        changes.push(changed);
        let mut changed = base.clone();
        changed
            .options
            .conformance_disallows
            .push(NamedNode::new_unchecked("urn:severity"));
        changes.push(changed.clone());
        let original = changed.descriptor()?;
        changed.options.conformance_disallows.reverse();
        changed
            .options
            .conformance_disallows
            .push(NamedNode::new_unchecked("urn:severity"));
        assert_eq!(changed.descriptor()?, original);
        for changed in changes {
            assert_ne!(changed.descriptor()?.fingerprint(), expected.fingerprint());
        }
        let mut scoped = base.clone();
        scoped.data.push(ShaclGraphScope {
            graph_name: NamedNode::new_unchecked("urn:extra").into(),
            required: false,
        });
        let first = scoped.descriptor()?;
        scoped.data.reverse();
        assert_ne!(scoped.descriptor()?, first);
        Ok(())
    }
    fn final_guard(store: &Store, rollback_failure: bool) -> TestResult {
        let mut tx = store
            .start_shacl_transaction(TransactionRequest::default(), key(1), policy())?
            .into_transaction();
        tx.insert(quad())?;
        let evidence = accepted(&tx);
        let control = tx.policy.control();
        let started = tx.started;
        let policy = tx.policy;
        let check = || {
            control.cancel();
            policy
                .check(started)
                .map_err(|error| StorageError::Other(Box::new(error)))
        };
        let error = tx.inner.commit_validated(&evidence, &check).unwrap_err();
        let error = commit_error(error, evidence);
        assert!(
            matches!(&error, ShaclCommitError::Rejected { source: ShaclGateError::Validation(ValidationError::Cancelled), rollback, .. } if rollback.is_some() == rollback_failure)
        );
        assert_eq!(
            error.validation_evidence().disposition(),
            ShaclDisposition::Cancelled
        );
        assert_eq!(
            ShaclValidationEvidence::from_bytes(&error.validation_evidence().to_bytes())?,
            *error.validation_evidence()
        );
        assert!(store.is_empty()?);
        assert!(
            store
                .read_outbox(None, std::num::NonZeroUsize::MIN)?
                .records()
                .is_empty()
        );
        assert!(!matches!(
            store.lookup_shacl_receipt(&key(1))?,
            ShaclReceiptOutcome::Validated(_)
        ));
        Ok(())
    }
    #[test]
    fn final_guard_explicitly_rolls_back_memory_before_publication() -> TestResult {
        final_guard(&Store::new()?, false)
    }

    #[test]
    fn transaction_metrics_preserve_rejection_without_a_second_terminal_observation() -> TestResult
    {
        use crate::store::TransactionObservation;
        let store = Store::new()?;
        final_guard(&store, false)?;
        let metrics = store.transaction_metrics();
        assert_eq!(metrics.count(TransactionObservation::Rejected), 1);
        assert_eq!(metrics.rollback_failures(), 0);
        assert_eq!(
            TransactionObservation::ALL
                .into_iter()
                .map(|outcome| metrics.count(outcome))
                .sum::<u64>(),
            1
        );
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn transaction_metrics_count_internal_rollback_failure_separately_from_commit_rejection()
    -> TestResult {
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        use crate::store::TransactionObservation;
        for fault in [
            None,
            Some(Fault::RolledBackBefore),
            Some(Fault::RolledBackAfter),
        ] {
            let directory = tempfile::tempdir()?;
            let store = Store::open(directory.path())?;
            if let Some(fault) = fault {
                store.storage.arm_transaction_outcome_fault(fault)?;
            }
            final_guard(&store, fault.is_some())?;
            let metrics = store.transaction_metrics();
            assert_eq!(metrics.count(TransactionObservation::Rejected), 1);
            assert_eq!(metrics.rollback_failures(), u64::from(fault.is_some()));
            assert_eq!(
                TransactionObservation::ALL
                    .into_iter()
                    .map(|outcome| metrics.count(outcome))
                    .sum::<u64>(),
                1
            );
            let events = store.storage.transaction_outcome_fault_events()?;
            assert!(!events.contains(&Fault::CommitAttemptedBefore));
            assert!(!events.contains(&Fault::CommitAttemptedAfter));
        }
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn final_guard_preserves_original_failure_and_rollback_errors() -> TestResult {
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        for fault in [
            None,
            Some(Fault::RolledBackBefore),
            Some(Fault::RolledBackAfter),
        ] {
            let directory = tempfile::tempdir()?;
            let store = Store::open(directory.path())?;
            if let Some(point) = fault {
                store.storage.arm_transaction_outcome_fault(point)?;
            }
            final_guard(&store, fault.is_some())?;
            let events = store.storage.transaction_outcome_fault_events()?;
            assert!(!events.contains(&Fault::CommitAttemptedBefore));
            assert!(!events.contains(&Fault::CommitAttemptedAfter));
            if let Some(point) = fault {
                assert!(events.contains(&point));
            }
            drop(store);
            let store = Store::open(directory.path())?;
            assert!(store.is_empty()?);
            assert!(!matches!(
                store.lookup_shacl_receipt(&key(1))?,
                ShaclReceiptOutcome::Validated(_)
            ));
        }
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn policy_metrics_preserve_validation_under_commit_and_rollback_failures() -> TestResult {
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        use crate::store::TransactionObservation;
        for fault in [
            Fault::CommitAttemptedBefore,
            Fault::CommitAttemptedAfter,
            Fault::FinalBatchBefore,
            Fault::FinalBatchAfter,
        ] {
            let directory = tempfile::tempdir()?;
            let store = Store::open(directory.path())?;
            let mut tx = store
                .start_shacl_transaction(TransactionRequest::default(), key(1), policy())?
                .into_transaction();
            tx.insert(quad())?;
            store.storage.arm_transaction_outcome_fault(fault)?;
            let error = tx.commit().unwrap_err();
            assert_eq!(
                error.validation_evidence().disposition(),
                ShaclDisposition::Accepted
            );
            assert_eq!(
                store
                    .policy_metrics()
                    .validations(ShaclDisposition::Accepted),
                1
            );
            assert_eq!(
                store
                    .transaction_metrics()
                    .count(TransactionObservation::Indeterminate),
                1
            );
            let before = store.policy_metrics();
            store.lookup_shacl_receipt(&key(1))?;
            assert_eq!(store.policy_metrics(), before);
            let events = store.storage.transaction_outcome_fault_events()?;
            assert!(!events.contains(&Fault::RolledBackBefore));
        }
        for fault in [Fault::RolledBackBefore, Fault::RolledBackAfter] {
            let directory = tempfile::tempdir()?;
            let store = Store::open(directory.path())?;
            let gate_policy = policy();
            let control = gate_policy.control();
            let tx = store
                .start_shacl_transaction(TransactionRequest::default(), key(1), gate_policy)?
                .into_transaction();
            store.storage.arm_transaction_outcome_fault(fault)?;
            control.cancel();
            let error = tx.commit().unwrap_err();
            assert!(matches!(
                &error,
                ShaclCommitError::Rejected {
                    rollback: Some(_),
                    ..
                }
            ));
            assert_eq!(
                store
                    .policy_metrics()
                    .validations(ShaclDisposition::Cancelled),
                1
            );
            assert_eq!(
                store
                    .policy_metrics()
                    .validations(ShaclDisposition::Accepted),
                0
            );
            assert_eq!(store.transaction_metrics().rollback_failures(), 1);
        }
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn validated_commit_faults_resolve_atomically_without_replay_or_rollback() -> TestResult {
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        for fault in [
            Fault::CommitAttemptedBefore,
            Fault::CommitAttemptedAfter,
            Fault::FinalBatchBefore,
            Fault::FinalBatchAfter,
        ] {
            let directory = tempfile::tempdir()?;
            let expected;
            {
                let store = Store::open(directory.path())?;
                let mut tx = store
                    .start_shacl_transaction(TransactionRequest::default(), key(1), policy())?
                    .into_transaction();
                tx.insert(quad())?;
                tx.set_namespace(Namespace::new(
                    NamespacePrefix::new("ex")?,
                    NamedNode::new_unchecked("urn:ns"),
                ))?;
                expected = accepted(&tx);
                store.storage.arm_transaction_outcome_fault(fault)?;
                let error = tx.commit().unwrap_err();
                assert!(
                    matches!(&error, ShaclCommitError::Commit { outcome: TransactionCommitError::Indeterminate { transaction_key, .. }, .. } if transaction_key == &key(1))
                );
                assert_eq!(error.validation_evidence(), &expected);
                let events = store.storage.transaction_outcome_fault_events()?;
                assert!(events.contains(&fault));
                assert!(!events.contains(&Fault::RolledBackBefore));
                assert!(!events.contains(&Fault::RolledBackAfter));
            }
            let store = Store::open(directory.path())?;
            let committed = fault == Fault::FinalBatchAfter;
            assert_eq!(store.contains(&quad())?, committed);
            assert_eq!(
                store.namespace(&NamespacePrefix::new("ex")?)?.is_some(),
                committed
            );
            match store.lookup_shacl_receipt(&key(1))? {
                ShaclReceiptOutcome::Validated(receipt) => {
                    assert!(committed);
                    assert_eq!(receipt.validation(), &expected);
                    assert_eq!(receipt.commit_receipt().sequence(), 1);
                }
                ShaclReceiptOutcome::Unavailable(CommitReceiptOutcome::Indeterminate) => {
                    assert!(!committed)
                }
                other => return Err(format!("unexpected outcome {other:?}").into()),
            }
            assert_eq!(
                store
                    .read_outbox(None, std::num::NonZeroUsize::new(10).unwrap())?
                    .records()
                    .len(),
                if committed { 3 } else { 0 }
            );
            assert!(
                store
                    .start_shacl_transaction(TransactionRequest::default(), key(1), policy())
                    .is_err()
            );
            let next = store
                .start_shacl_transaction(TransactionRequest::default(), key(2), policy())?
                .into_transaction()
                .commit()?;
            assert_eq!(next.receipt.sequence(), if committed { 2 } else { 1 });
        }
        Ok(())
    }
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn validated_admission_and_gate_rollback_faults_publish_nothing() -> TestResult {
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        for fault in [
            Fault::StagingBefore,
            Fault::StagingAfter,
            Fault::RolledBackBefore,
            Fault::RolledBackAfter,
        ] {
            let directory = tempfile::tempdir()?;
            {
                let store = Store::open(directory.path())?;
                if matches!(fault, Fault::StagingBefore | Fault::StagingAfter) {
                    store.storage.arm_transaction_outcome_fault(fault)?;
                    assert!(
                        store
                            .start_shacl_transaction(
                                TransactionRequest::default(),
                                key(1),
                                policy()
                            )
                            .is_err()
                    );
                } else {
                    let policy = policy();
                    let control = policy.control();
                    let mut tx = store
                        .start_shacl_transaction(TransactionRequest::default(), key(1), policy)?
                        .into_transaction();
                    tx.insert(quad())?;
                    tx.set_namespace(Namespace::new(
                        NamespacePrefix::new("ex")?,
                        NamedNode::new_unchecked("urn:ns"),
                    ))?;
                    control.cancel();
                    store.storage.arm_transaction_outcome_fault(fault)?;
                    let error = tx.commit().unwrap_err();
                    assert!(matches!(
                        &error,
                        ShaclCommitError::Rejected {
                            rollback: Some(_),
                            ..
                        }
                    ));
                    assert_eq!(
                        error.validation_evidence().disposition(),
                        ShaclDisposition::Cancelled
                    );
                }
                assert!(
                    store
                        .storage
                        .transaction_outcome_fault_events()?
                        .contains(&fault)
                );
            }
            let store = Store::open(directory.path())?;
            assert!(store.is_empty()?);
            assert!(store.namespace(&NamespacePrefix::new("ex")?)?.is_none());
            assert!(matches!(
                store.lookup_shacl_receipt(&key(1))?,
                ShaclReceiptOutcome::Unavailable(
                    CommitReceiptOutcome::Indeterminate | CommitReceiptOutcome::ProvenAbsent(_)
                )
            ));
            assert!(
                store
                    .read_outbox(None, std::num::NonZeroUsize::MIN)?
                    .records()
                    .is_empty()
            );
        }
        Ok(())
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
                ShaclCommitError::Commit { outcome, .. } => outcome,
                rejected @ ShaclCommitError::Rejected { .. } => TransactionCommitError::Rejected(
                    ChangeTrackingError::Backend(StorageError::Other(Box::new(rejected))),
                ),
            })
    }
    fn rollback_with_outcome(self) -> Result<(), TransactionRollbackError<Self::Error>> {
        self.inner.rollback()
    }
}

fn graph_identity(name: &GraphName) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"oxigraph.shacl-graph-selector.v1\0");
    super::change_codec::emit(&SemanticChange::GraphCleared(name.clone()), &mut |bytes| {
        hash.update(bytes)
    });
    hash.finalize().into()
}

fn disposition(error: &ShaclGateError) -> ShaclDisposition {
    match error {
        ShaclGateError::Policy(_) => ShaclDisposition::PolicyError,
        ShaclGateError::MissingGraph(_) => ShaclDisposition::MissingGraph,
        ShaclGateError::ShapesChanged => ShaclDisposition::ShapesChanged,
        ShaclGateError::SnapshotBytes(_) => ShaclDisposition::LimitExceeded,
        ShaclGateError::Nonconforming { .. } => ShaclDisposition::Nonconforming,
        ShaclGateError::Backend(_) => ShaclDisposition::StorageError,
        ShaclGateError::Validation(error)
        | ShaclGateError::Compile(CompileError::Validation(error)) => match error {
            ValidationError::Cancelled => ShaclDisposition::Cancelled,
            ValidationError::LimitExceeded {
                kind: LimitKind::Time,
                ..
            } => ShaclDisposition::TimedOut,
            ValidationError::LimitExceeded { .. } => ShaclDisposition::LimitExceeded,
            _ => ShaclDisposition::ProcessorError,
        },
        ShaclGateError::Compile(_) => ShaclDisposition::ProcessorError,
    }
}
