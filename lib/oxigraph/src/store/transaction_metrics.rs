//! Process-local observations, deliberately independent of the durable outcome ledger.
use super::{StorageError, TransactionCommitError};
use std::fmt::{self, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Terminal observation of an admitted built-in storage transaction, not an outcome oracle.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransactionObservation {
    Committed,
    Rejected,
    Conflicted,
    Cancelled,
    RolledBack,
    RollbackFailed,
    Indeterminate,
    /// Dropped without an explicit terminal call. Does not assert durable rollback.
    Abandoned,
}

impl TransactionObservation {
    /// The complete, fixed metric label vocabulary.
    pub const ALL: [Self; 8] = [
        Self::Committed,
        Self::Rejected,
        Self::Conflicted,
        Self::Cancelled,
        Self::RolledBack,
        Self::RollbackFailed,
        Self::Indeterminate,
        Self::Abandoned,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Committed => "committed",
            Self::Rejected => "rejected",
            Self::Conflicted => "conflicted",
            Self::Cancelled => "cancelled",
            Self::RolledBack => "rolled_back",
            Self::RollbackFailed => "rollback_failed",
            Self::Indeterminate => "indeterminate",
            Self::Abandoned => "abandoned",
        }
    }
}

// Measurement resolution, not performance acceptance thresholds.
const BOUNDS_MICROS: [u64; 7] = [
    100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 60_000_000,
];
const BOUND_LABELS: [&str; 8] = ["0.0001", "0.001", "0.01", "0.1", "1", "10", "60", "+Inf"];

/// Cumulative, microsecond-resolution duration observations for one terminal category.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TransactionDurationHistogram {
    buckets: [u64; 8],
    sum_micros: u64,
}

impl TransactionDurationHistogram {
    /// Ordered inclusive upper bounds and cumulative counts; `None` means positive infinity.
    pub fn buckets(&self) -> impl Iterator<Item = (Option<Duration>, u64)> + '_ {
        self.buckets.iter().enumerate().map(|(index, &count)| {
            (
                BOUNDS_MICROS.get(index).copied().map(Duration::from_micros),
                count,
            )
        })
    }

    pub const fn count(&self) -> u64 {
        self.buckets[7]
    }

    pub const fn sum(&self) -> Duration {
        Duration::from_micros(self.sum_micros)
    }

    pub(crate) fn observe(&mut self, duration: Duration) {
        let micros = u64::try_from(duration.as_micros()).unwrap_or(u64::MAX);
        for (index, count) in self.buckets.iter_mut().enumerate() {
            if BOUNDS_MICROS
                .get(index)
                .is_none_or(|&bound| micros <= bound)
            {
                *count = count.saturating_add(1);
            }
        }
        self.sum_micros = self.sum_micros.saturating_add(micros);
    }

    pub(crate) fn write_series(
        &self,
        output: &mut impl Write,
        family: &'static str,
        outcome: &'static str,
    ) -> fmt::Result {
        for (label, count) in BOUND_LABELS.iter().zip(self.buckets) {
            writeln!(
                output,
                "{family}_bucket{{outcome=\"{outcome}\",le=\"{label}\"}} {count}"
            )?;
        }
        writeln!(
            output,
            "{family}_count{{outcome=\"{outcome}\"}} {}",
            self.count()
        )?;
        writeln!(
            output,
            "{family}_sum{{outcome=\"{outcome}\"}} {}.{:06}",
            self.sum_micros / 1_000_000,
            self.sum_micros % 1_000_000
        )
    }
}

/// Consistent, bounded per-open-Store transaction telemetry shared by its clones.
///
/// Counts admitted legacy, keyed and governed transactions, including autocommit writes.
/// One terminal observation is recorded per storage wrapper, not per nested API wrapper.
/// Durations run from successful admission to the terminal call returning or drop.
/// Admission failures/wait time, bulk loaders, direct governance maintenance, query/update
/// evaluation and external persistence adapters are excluded. An early wrapper rejection
/// that drops its storage transaction is `Abandoned`, not a second physical commit attempt.
/// No keys, RDF terms, query text or error messages are retained. Counters and sums saturate
/// at `u64::MAX`. Reopening, restarting, or independently opening a read-only Store resets
/// this telemetry; it never changes or replaces durable transaction outcome lookup.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TransactionMetrics {
    durations: [TransactionDurationHistogram; 8],
    rollback_failures: u64,
}

impl TransactionMetrics {
    pub fn count(&self, outcome: TransactionObservation) -> u64 {
        self.duration(outcome).count()
    }

    pub fn duration(&self, outcome: TransactionObservation) -> &TransactionDurationHistogram {
        &self.durations[outcome as usize]
    }

    /// Failed explicit rollbacks, including a validation pre-attempt rollback whose outer
    /// commit result is still a proven rejection. Best-effort backend drop is not included.
    pub const fn rollback_failures(&self) -> u64 {
        self.rollback_failures
    }

    /// Writes three Prometheus families with exactly 89 fixed-label samples.
    /// Histogram buckets are cumulative, with a matching `+Inf`, `_count` and `_sum`.
    pub fn write_prometheus(&self, output: &mut impl Write) -> fmt::Result {
        writeln!(output, "# TYPE oxigraph_transactions_total counter")?;
        for outcome in TransactionObservation::ALL {
            writeln!(
                output,
                "oxigraph_transactions_total{{outcome=\"{}\"}} {}",
                outcome.as_str(),
                self.count(outcome)
            )?;
        }
        writeln!(
            output,
            "# TYPE oxigraph_transaction_duration_seconds histogram"
        )?;
        for outcome in TransactionObservation::ALL {
            self.duration(outcome).write_series(
                output,
                "oxigraph_transaction_duration_seconds",
                outcome.as_str(),
            )?;
        }
        writeln!(
            output,
            "# TYPE oxigraph_transaction_rollback_failures_total counter\noxigraph_transaction_rollback_failures_total {}",
            self.rollback_failures
        )
    }
}

#[derive(Default)]
pub(crate) struct TransactionMetricsState(Mutex<TransactionMetrics>);

impl TransactionMetricsState {
    pub(crate) fn snapshot(&self) -> TransactionMetrics {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub(crate) fn start(self: &Arc<Self>) -> TransactionObservationGuard {
        TransactionObservationGuard {
            metrics: Arc::clone(self),
            started: Instant::now(),
            pending: Some(TransactionObservation::Abandoned),
        }
    }
}

pub(crate) struct TransactionObservationGuard {
    metrics: Arc<TransactionMetricsState>,
    started: Instant,
    pending: Option<TransactionObservation>,
}

impl TransactionObservationGuard {
    pub(crate) fn before_commit(&mut self) {
        // A panic during the terminal call cannot become a false rollback observation.
        self.pending = Some(TransactionObservation::Indeterminate);
    }

    pub(crate) fn before_rollback(&mut self) {
        self.pending = Some(TransactionObservation::RollbackFailed);
    }

    pub(crate) fn finish(&mut self, outcome: TransactionObservation, rollback_failed: bool) {
        if self.pending.take().is_none() {
            return;
        }
        let elapsed = self.started.elapsed();
        let mut metrics = self
            .metrics
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        metrics.durations[outcome as usize].observe(elapsed);
        if rollback_failed || outcome == TransactionObservation::RollbackFailed {
            metrics.rollback_failures = metrics.rollback_failures.saturating_add(1);
        }
    }

    pub(crate) fn finish_commit<T>(&mut self, result: &Result<T, StorageError>) {
        self.finish(
            if result.is_ok() {
                TransactionObservation::Committed
            } else {
                TransactionObservation::Indeterminate
            },
            false,
        );
    }

    pub(crate) fn finish_governed<T>(
        &mut self,
        result: &Result<T, TransactionCommitError<StorageError>>,
    ) {
        let mut rollback_failed = false;
        let outcome = match result {
            Ok(_) => TransactionObservation::Committed,
            Err(TransactionCommitError::Rejected(error)) => {
                if let StorageError::Other(source) = error {
                    rollback_failed = source
                        .downcast_ref::<super::shacl_receipt::ValidationPreAttemptError>()
                        .is_some_and(|error| error.rollback.is_some());
                }
                TransactionObservation::Rejected
            }
            Err(TransactionCommitError::Conflicted) => TransactionObservation::Conflicted,
            Err(TransactionCommitError::Cancelled) => TransactionObservation::Cancelled,
            Err(TransactionCommitError::Indeterminate { .. }) => {
                TransactionObservation::Indeterminate
            }
        };
        self.finish(outcome, rollback_failed);
    }
}

impl Drop for TransactionObservationGuard {
    fn drop(&mut self) {
        if let Some(outcome) = self.pending {
            self.finish(outcome, false);
        }
    }
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    clippy::panic_in_result_fn,
    reason = "bounded observation and isolated fault assertions"
)]
mod tests {
    use super::*;
    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    use crate::store::Store;

    #[test]
    fn histogram_boundaries_and_saturation_are_cumulative() {
        let mut histogram = TransactionDurationHistogram::default();
        for micros in [0, 100, 101, 1_000, 60_000_001] {
            histogram.observe(Duration::from_micros(micros));
        }
        assert_eq!(histogram.buckets, [2, 4, 4, 4, 4, 4, 4, 5]);
        assert_eq!(histogram.sum(), Duration::from_micros(60_001_202));
        histogram.buckets = [u64::MAX; 8];
        histogram.sum_micros = u64::MAX;
        histogram.observe(Duration::from_micros(1));
        assert_eq!(histogram.buckets, [u64::MAX; 8]);
        assert_eq!(histogram.sum_micros, u64::MAX);
    }

    #[test]
    fn terminal_guard_records_once_and_unwind_is_conservative() {
        let metrics = Arc::new(TransactionMetricsState::default());
        {
            let mut guard = metrics.start();
            guard.before_commit();
            guard.finish(TransactionObservation::Committed, false);
            guard.finish(TransactionObservation::Rejected, false);
        }
        for commit in [true, false] {
            let result = std::panic::catch_unwind({
                let metrics = Arc::clone(&metrics);
                move || {
                    let mut guard = metrics.start();
                    if commit {
                        guard.before_commit();
                    } else {
                        guard.before_rollback();
                    }
                    panic!("isolated terminal unwind");
                }
            });
            assert!(result.is_err());
        }
        drop(metrics.start());
        let snapshot = metrics.snapshot();
        for outcome in [
            TransactionObservation::Committed,
            TransactionObservation::Indeterminate,
            TransactionObservation::RollbackFailed,
            TransactionObservation::Abandoned,
        ] {
            assert_eq!(snapshot.count(outcome), 1);
        }
        assert_eq!(snapshot.count(TransactionObservation::Rejected), 0);
        assert_eq!(snapshot.rollback_failures(), 1);
    }

    #[test]
    fn typed_reasons_remain_distinct_without_retaining_errors() {
        let metrics = Arc::new(TransactionMetricsState::default());
        for error in [
            TransactionCommitError::Conflicted,
            TransactionCommitError::Cancelled,
            TransactionCommitError::Rejected(StorageError::Other("private message".into())),
        ] {
            metrics.start().finish_governed(&Err::<(), _>(error));
        }
        let snapshot = metrics.snapshot();
        for outcome in [
            TransactionObservation::Conflicted,
            TransactionObservation::Cancelled,
            TransactionObservation::Rejected,
        ] {
            assert_eq!(snapshot.count(outcome), 1);
        }
        let mut text = String::new();
        snapshot.write_prometheus(&mut text).unwrap();
        assert!(!text.contains("private"));
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn observed_commit_failure_does_not_relabel_durable_success_or_trigger_rollback()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        use crate::store::{CommitReceiptOutcome, TransactionKey, TransactionRequest};
        for fault in [
            Fault::CommitAttemptedBefore,
            Fault::CommitAttemptedAfter,
            Fault::FinalBatchBefore,
            Fault::FinalBatchAfter,
        ] {
            let directory = tempfile::tempdir()?;
            let store = Store::open(directory.path())?;
            let key = TransactionKey::new([91; 16]);
            let transaction = store
                .start_governed_transaction(TransactionRequest::default(), key.clone())?
                .into_transaction();
            store.storage.arm_transaction_outcome_fault(fault)?;
            assert!(matches!(
                transaction.commit(),
                Err(TransactionCommitError::Indeterminate { .. })
            ));
            let observed = store.transaction_metrics();
            assert_eq!(observed.count(TransactionObservation::Indeterminate), 1);
            assert_eq!(
                TransactionObservation::ALL
                    .into_iter()
                    .map(|outcome| observed.count(outcome))
                    .sum::<u64>(),
                1
            );
            assert_eq!(observed.rollback_failures(), 0);
            let events = store.storage.transaction_outcome_fault_events()?;
            assert!(events.contains(&fault));
            assert!(!events.contains(&Fault::RolledBackBefore));
            assert!(!events.contains(&Fault::RolledBackAfter));
            let actual = store.lookup_commit_receipt(&key)?;
            if fault == Fault::FinalBatchAfter {
                assert!(matches!(actual, CommitReceiptOutcome::Committed(_)));
            } else {
                assert_eq!(actual, CommitReceiptOutcome::Indeterminate);
            }
            assert_eq!(
                store.transaction_metrics(),
                observed,
                "lookup must not rewrite telemetry or replay effects"
            );
        }
        Ok(())
    }

    #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
    #[test]
    fn explicit_rollback_error_is_counted_once_even_when_drop_retries_marker()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use crate::storage::TransactionOutcomeFaultPoint as Fault;
        use crate::store::{TransactionKey, TransactionRequest};
        for fault in [Fault::RolledBackBefore, Fault::RolledBackAfter] {
            let directory = tempfile::tempdir()?;
            let store = Store::open(directory.path())?;
            let transaction = store
                .start_governed_transaction(
                    TransactionRequest::default(),
                    TransactionKey::new([92; 16]),
                )?
                .into_transaction();
            store.storage.arm_transaction_outcome_fault(fault)?;
            assert!(transaction.rollback().is_err());
            let observed = store.transaction_metrics();
            assert_eq!(observed.count(TransactionObservation::RollbackFailed), 1);
            assert_eq!(observed.rollback_failures(), 1);
            assert_eq!(
                TransactionObservation::ALL
                    .into_iter()
                    .map(|outcome| observed.count(outcome))
                    .sum::<u64>(),
                1
            );
            assert!(
                store
                    .storage
                    .transaction_outcome_fault_events()?
                    .contains(&fault)
            );
        }
        Ok(())
    }
}
