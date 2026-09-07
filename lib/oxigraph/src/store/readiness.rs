//! Bounded operational observations, not full-store integrity or deployment proof.
use super::{
    ContributorError, ContributorInventory, ContributorObservation, ContributorRegistry,
    GovernanceHealth, GovernanceTime, SemanticChange, Store, TransactionStartControl,
};
use crate::storage::numeric_encoder::Decoder;
use std::collections::BTreeSet;
use std::num::NonZeroUsize;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadinessDisposition {
    Ready,
    Degraded,
    NotReady,
}
/// Operator-supplied circuit observation. G2.5 does not create an admission
/// controller, automatically retry work, or infer an unknown breaker is closed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CircuitState {
    Closed,
    HalfOpen,
    Open,
    Unknown,
}
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ReadinessReason {
    Cancelled,
    TimedOut,
    Storage,
    Outbox,
    PartialOutbox,
    Backpressure,
    ConsumerLag,
    Circuit,
    Contributors,
    RecoveryExpired,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProbeCoverage {
    Unobserved,
    Complete,
    Partial,
}

/// One call's observation bounds. Record limits do not hard-bound allocator
/// memory: an RDF term is decoded before its logical byte charge is known.
#[derive(Clone, Debug)]
pub struct ReadinessPolicy {
    max_primary_records: NonZeroUsize,
    max_primary_bytes: NonZeroUsize,
    max_outbox_records: NonZeroUsize,
    allow_partial_outbox: bool,
    max_live_consumer_lag_records: Option<u64>,
    timeout: Duration,
    recovery_valid_until: Option<GovernanceTime>,
}
impl Default for ReadinessPolicy {
    fn default() -> Self {
        Self {
            max_primary_records: NonZeroUsize::new(128).unwrap_or(NonZeroUsize::MIN),
            max_primary_bytes: NonZeroUsize::new(1024 * 1024).unwrap_or(NonZeroUsize::MIN),
            max_outbox_records: NonZeroUsize::new(256).unwrap_or(NonZeroUsize::MIN),
            allow_partial_outbox: false,
            max_live_consumer_lag_records: None,
            timeout: Duration::from_secs(5),
            recovery_valid_until: None,
        }
    }
}
impl ReadinessPolicy {
    #[must_use]
    pub const fn with_probe_limits(
        mut self,
        records: NonZeroUsize,
        logical_bytes: NonZeroUsize,
        outbox_records: NonZeroUsize,
    ) -> Self {
        self.max_primary_records = records;
        self.max_primary_bytes = logical_bytes;
        self.max_outbox_records = outbox_records;
        self
    }
    /// Explicitly allow readiness from a bounded retained prefix; coverage stays
    /// Partial. This never claims uninspected history is corruption-free.
    #[must_use]
    pub const fn allowing_partial_outbox(mut self, allow: bool) -> Self {
        self.allow_partial_outbox = allow;
        self
    }
    #[must_use]
    pub const fn with_max_live_consumer_lag(mut self, records: u64) -> Self {
        self.max_live_consumer_lag_records = Some(records);
        self
    }
    #[must_use]
    pub const fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
    /// Optional operator policy input. Does not mint or validate backup evidence.
    #[must_use]
    pub const fn requiring_recovery_freshness(mut self, valid_until: GovernanceTime) -> Self {
        self.recovery_valid_until = Some(valid_until);
        self
    }
}

/// Fixed metric vocabulary. No labels, payloads, provider IDs or raw errors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OperationalMetric {
    name: &'static str,
    unit: &'static str,
    value: u64,
}
impl OperationalMetric {
    pub const fn name(&self) -> &'static str {
        self.name
    }
    pub const fn unit(&self) -> &'static str {
        self.unit
    }
    pub const fn value(&self) -> u64 {
        self.value
    }
}

#[derive(Clone, Debug)]
pub struct OperationalSnapshot {
    live: bool,
    disposition: ReadinessDisposition,
    reasons: BTreeSet<ReadinessReason>,
    primary_coverage: ProbeCoverage,
    primary_records: usize,
    primary_bytes: usize,
    governance: Option<GovernanceHealth>,
    outbox_coverage: ProbeCoverage,
    contributors: Option<ContributorInventory>,
    contributor_error: Option<ContributorError>,
    circuit: CircuitState,
}
impl OperationalSnapshot {
    /// A returning native call proves in-process liveness, not storage readiness.
    pub const fn live(&self) -> bool {
        self.live
    }
    pub const fn disposition(&self) -> ReadinessDisposition {
        self.disposition
    }
    pub fn reasons(&self) -> impl Iterator<Item = ReadinessReason> + '_ {
        self.reasons.iter().copied()
    }
    pub const fn primary_coverage(&self) -> ProbeCoverage {
        self.primary_coverage
    }
    pub const fn inspected_primary_records(&self) -> usize {
        self.primary_records
    }
    pub const fn inspected_primary_logical_bytes(&self) -> usize {
        self.primary_bytes
    }
    pub const fn governance(&self) -> Option<&GovernanceHealth> {
        self.governance.as_ref()
    }
    pub const fn outbox_coverage(&self) -> ProbeCoverage {
        self.outbox_coverage
    }
    pub const fn contributors(&self) -> Option<&ContributorInventory> {
        self.contributors.as_ref()
    }
    pub const fn contributor_error(&self) -> Option<ContributorError> {
        self.contributor_error
    }
    pub const fn circuit(&self) -> CircuitState {
        self.circuit
    }
    /// Gauges are emitted only when observed. Fixed *_observed gauges distinguish
    /// unavailable values from zero. At most 21 series, independent of inventory.
    pub fn metrics(&self) -> Vec<OperationalMetric> {
        let mut metrics = Vec::new();
        let mut add = |name, unit, value| metrics.push(OperationalMetric { name, unit, value });
        add("oxigraph_live", "boolean", 1);
        add(
            "oxigraph_ready",
            "boolean",
            u64::from(self.disposition != ReadinessDisposition::NotReady),
        );
        add(
            "oxigraph_degraded",
            "boolean",
            u64::from(self.disposition == ReadinessDisposition::Degraded),
        );
        add(
            "oxigraph_primary_probe_records",
            "records",
            self.primary_records as u64,
        );
        add(
            "oxigraph_primary_probe_logical_bytes",
            "bytes",
            self.primary_bytes as u64,
        );
        add(
            "oxigraph_primary_probe_complete",
            "boolean",
            u64::from(self.primary_coverage == ProbeCoverage::Complete),
        );
        add(
            "oxigraph_governance_observed",
            "boolean",
            u64::from(self.governance.is_some()),
        );
        add(
            "oxigraph_outbox_probe_complete",
            "boolean",
            u64::from(self.outbox_coverage == ProbeCoverage::Complete),
        );
        add(
            "oxigraph_probe_cancelled",
            "boolean",
            u64::from(self.reasons.contains(&ReadinessReason::Cancelled)),
        );
        add(
            "oxigraph_probe_timed_out",
            "boolean",
            u64::from(self.reasons.contains(&ReadinessReason::TimedOut)),
        );
        add(
            "oxigraph_circuit_closed",
            "boolean",
            u64::from(self.circuit == CircuitState::Closed),
        );
        add(
            "oxigraph_contributors_observed",
            "boolean",
            u64::from(self.contributors.is_some()),
        );
        if let Some(health) = &self.governance {
            add(
                "oxigraph_outbox_retained_records",
                "records",
                health.retained_records(),
            );
            add(
                "oxigraph_outbox_physical_records",
                "records",
                health.physical_records(),
            );
            let high = health.high_water().map_or(0, super::OutboxCursor::position);
            let observed = health
                .validated_through()
                .map_or(0, super::OutboxCursor::position);
            add(
                "oxigraph_outbox_uninspected_records",
                "records",
                high.saturating_sub(observed),
            );
            add(
                "oxigraph_outbox_live_leases",
                "leases",
                health.live_leases() as u64,
            );
            add(
                "oxigraph_outbox_expired_leases",
                "leases",
                health.expired_leases() as u64,
            );
            if health.live_leases() > 0 {
                add(
                    "oxigraph_outbox_live_consumer_lag_records",
                    "records",
                    high.saturating_sub(
                        health
                            .oldest_live_checkpoint()
                            .map_or(0, super::OutboxCursor::position),
                    ),
                );
            }
        }
        if let Some(inventory) = &self.contributors {
            add(
                "oxigraph_contributors",
                "contributors",
                inventory.entries().len() as u64,
            );
            add(
                "oxigraph_contributors_degraded",
                "contributors",
                inventory
                    .entries()
                    .iter()
                    .filter(|entry| entry.degraded())
                    .count() as u64,
            );
            add(
                "oxigraph_contributor_max_lag_records",
                "records",
                inventory
                    .entries()
                    .iter()
                    .filter_map(super::ContributorInventoryEntry::lag_records)
                    .max()
                    .unwrap_or(0),
            );
        }
        metrics
    }
}

#[expect(
    clippy::multiple_inherent_impl,
    reason = "operational API is kept in its bounded-context module"
)]
impl Store {
    /// Collects read-only, bounded operational observations. Primary probe and
    /// governance are separate snapshots; contributors are caller-sampled against
    /// governance's exact latest receipt. No writer lock or admission is acquired.
    ///
    /// The cooperative deadline covers this call, not prior caller sampling or
    /// a blocking native I/O syscall. Ready is not a full-store integrity,
    /// power-loss, backup, HTTP-service, or production-promotion certificate.
    pub fn operational_snapshot(
        &self,
        policy: &ReadinessPolicy,
        registry: &ContributorRegistry,
        observations: &[ContributorObservation],
        now: GovernanceTime,
        control: &TransactionStartControl,
        circuit: CircuitState,
    ) -> OperationalSnapshot {
        let started = Instant::now();
        let check = || {
            if control.is_cancelled() {
                Some(ReadinessReason::Cancelled)
            } else if started.elapsed() >= policy.timeout
                || control
                    .timeout()
                    .is_some_and(|timeout| started.elapsed() >= timeout)
            {
                Some(ReadinessReason::TimedOut)
            } else {
                None
            }
        };
        let mut snapshot = OperationalSnapshot {
            live: true,
            disposition: ReadinessDisposition::Ready,
            reasons: BTreeSet::new(),
            primary_coverage: ProbeCoverage::Unobserved,
            primary_records: 0,
            primary_bytes: 0,
            governance: None,
            outbox_coverage: ProbeCoverage::Unobserved,
            contributors: None,
            contributor_error: None,
            circuit,
        };
        if circuit != CircuitState::Closed {
            snapshot.reasons.insert(ReadinessReason::Circuit);
        }
        if policy
            .recovery_valid_until
            .is_some_and(|until| now >= until)
        {
            snapshot.reasons.insert(ReadinessReason::RecoveryExpired);
        }
        if let Some(reason) = check() {
            snapshot.reasons.insert(reason);
            snapshot.disposition = ReadinessDisposition::NotReady;
            return snapshot;
        }
        let reader = self.storage.snapshot();
        if reader.check_layout().is_err() {
            snapshot.reasons.insert(ReadinessReason::Storage);
        } else {
            let mut records = reader.quads_for_pattern(None, None, None, None);
            snapshot.primary_coverage = ProbeCoverage::Partial;
            loop {
                if let Some(reason) = check() {
                    snapshot.reasons.insert(reason);
                    break;
                }
                // One lookahead determines EOF, but its RDF payload is not decoded.
                let Some(record) = records.next() else {
                    snapshot.primary_coverage = ProbeCoverage::Complete;
                    break;
                };
                if record.is_err() {
                    snapshot.reasons.insert(ReadinessReason::Storage);
                    break;
                }
                if snapshot.primary_records >= policy.max_primary_records.get() {
                    break;
                }
                let Ok(quad) = record.and_then(|quad| reader.decode_quad(&quad)) else {
                    snapshot.reasons.insert(ReadinessReason::Storage);
                    break;
                };
                let mut bytes = 0_usize;
                super::change_codec::emit(&SemanticChange::QuadAdded(quad), &mut |part| {
                    bytes = bytes.saturating_add(part.len());
                });
                snapshot.primary_bytes = snapshot.primary_bytes.saturating_add(bytes);
                snapshot.primary_records += 1;
                if snapshot.primary_bytes > policy.max_primary_bytes.get() {
                    break;
                }
            }
        }
        if check().is_none() {
            match self.governance_health(now, policy.max_outbox_records) {
                Ok(health) => {
                    snapshot.outbox_coverage = if health.high_water() == health.validated_through()
                    {
                        ProbeCoverage::Complete
                    } else {
                        ProbeCoverage::Partial
                    };
                    if snapshot.outbox_coverage == ProbeCoverage::Partial
                        && !policy.allow_partial_outbox
                    {
                        snapshot.reasons.insert(ReadinessReason::PartialOutbox);
                    }
                    if health.backpressured() {
                        snapshot.reasons.insert(ReadinessReason::Backpressure);
                    }
                    if health.live_leases() > 0
                        && policy.max_live_consumer_lag_records.is_some_and(|limit| {
                            health
                                .high_water()
                                .map_or(0, super::OutboxCursor::position)
                                .saturating_sub(
                                    health
                                        .oldest_live_checkpoint()
                                        .map_or(0, super::OutboxCursor::position),
                                )
                                > limit
                        })
                    {
                        snapshot.reasons.insert(ReadinessReason::ConsumerLag);
                    }
                    match registry.evaluate(self, &health, observations, || check().is_none()) {
                        Ok(inventory) => snapshot.contributors = Some(inventory),
                        Err(error) => {
                            snapshot.contributor_error = Some(error);
                            snapshot.reasons.insert(ReadinessReason::Contributors);
                        }
                    }
                    snapshot.governance = Some(health);
                }
                Err(_) => {
                    snapshot.reasons.insert(ReadinessReason::Outbox);
                }
            }
        }
        if let Some(reason) = check() {
            snapshot.reasons.insert(reason);
        }
        snapshot.disposition = if !snapshot.reasons.is_empty() {
            ReadinessDisposition::NotReady
        } else if snapshot.primary_coverage != ProbeCoverage::Complete
            || snapshot.outbox_coverage != ProbeCoverage::Complete
            || snapshot.contributors.as_ref().is_some_and(|inventory| {
                inventory
                    .entries()
                    .iter()
                    .any(super::ContributorInventoryEntry::degraded)
            })
        {
            ReadinessDisposition::Degraded
        } else {
            ReadinessDisposition::Ready
        };
        snapshot
    }
}

#[cfg(all(test, not(target_family = "wasm"), feature = "rocksdb"))]
#[expect(
    clippy::missing_assert_message,
    reason = "temporary database corruption fixtures"
)]
mod tests {
    use super::*;
    #[test]
    fn encountered_storage_and_governance_corruption_never_report_ready()
    -> Result<(), super::super::StorageError> {
        for field in 0..3 {
            let directory = tempfile::tempdir()?;
            let store = Store::open(directory.path())?;
            store.storage.corrupt_readiness_fixture(field)?;
            let report = store.operational_snapshot(
                &ReadinessPolicy::default(),
                &ContributorRegistry::default(),
                &[],
                GovernanceTime::from_unix_millis(1),
                &TransactionStartControl::new(),
                CircuitState::Closed,
            );
            assert_eq!(report.disposition(), ReadinessDisposition::NotReady);
            assert!(report.live());
            let expected = if field == 1 {
                ReadinessReason::Outbox
            } else {
                ReadinessReason::Storage
            };
            assert!(report.reasons().any(|reason| reason == expected));
        }
        Ok(())
    }
}
