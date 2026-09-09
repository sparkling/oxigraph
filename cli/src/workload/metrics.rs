//! ADR-0027 admission telemetry: a fixed pool/disposition vocabulary, saturating
//! process-local counters and actual queue-wait observations. Nothing here is a
//! request-success, rollback or resource oracle: `Admitted` means a lease was
//! returned, and dropping that lease is only a capacity release.
//!
//! No class name, policy identity, principal, endpoint, query, RDF term or error
//! text is retained or exported.
use super::{AdmissionScope, AdmissionSnapshot, WorkloadError, WorkloadLease};
use crate::access::ListenerKind;
use std::fmt::{self, Write};
use std::time::Duration;

/// Capacity pool of one admission attempt. Workload classes are deliberately
/// not a label; they are operator-defined names.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdmissionPool {
    Data,
    Operator,
}

impl AdmissionPool {
    /// The complete, fixed pool vocabulary.
    pub const ALL: [Self; 2] = [Self::Data, Self::Operator];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Data => "data",
            Self::Operator => "operator",
        }
    }
}

impl From<ListenerKind> for AdmissionPool {
    fn from(listener: ListenerKind) -> Self {
        match listener {
            ListenerKind::Data => Self::Data,
            ListenerKind::Operator => Self::Operator,
        }
    }
}

/// Terminal result of one `acquire` call, counted exactly once when that call
/// returns. Later cancellation of an admitted lease, its clones, drop or unwind
/// never produce a second observation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdmissionDisposition {
    Admitted,
    RefusedGlobal,
    RefusedClass,
    RefusedOperator,
    UnknownClass,
    /// Explicit token cancellation, including an observed queued transport abort.
    Cancelled,
    /// The absolute request deadline elapsed before or during queue residence.
    RequestTimedOut,
    /// The queue timeout elapsed while waiting for capacity.
    QueueTimedOut,
    /// Controller-internal failure (poisoned state or an invalid clock bound).
    Unavailable,
}

impl AdmissionDisposition {
    /// The complete, fixed disposition vocabulary.
    pub const ALL: [Self; 9] = [
        Self::Admitted,
        Self::RefusedGlobal,
        Self::RefusedClass,
        Self::RefusedOperator,
        Self::UnknownClass,
        Self::Cancelled,
        Self::RequestTimedOut,
        Self::QueueTimedOut,
        Self::Unavailable,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Admitted => "admitted",
            Self::RefusedGlobal => "refused_global",
            Self::RefusedClass => "refused_class",
            Self::RefusedOperator => "refused_operator",
            Self::UnknownClass => "unknown_class",
            Self::Cancelled => "cancelled",
            Self::RequestTimedOut => "request_timed_out",
            Self::QueueTimedOut => "queue_timed_out",
            Self::Unavailable => "unavailable",
        }
    }

    pub(super) fn of(result: &Result<WorkloadLease, WorkloadError>) -> Self {
        match result {
            Ok(_) => Self::Admitted,
            Err(WorkloadError::Overloaded(AdmissionScope::Global)) => Self::RefusedGlobal,
            Err(WorkloadError::Overloaded(AdmissionScope::Class)) => Self::RefusedClass,
            Err(WorkloadError::Overloaded(AdmissionScope::Operator)) => Self::RefusedOperator,
            Err(WorkloadError::UnknownClass) => Self::UnknownClass,
            Err(WorkloadError::Cancelled) => Self::Cancelled,
            Err(WorkloadError::RequestTimedOut) => Self::RequestTimedOut,
            Err(WorkloadError::AdmissionTimedOut) => Self::QueueTimedOut,
            // A missing trusted access context is refused before `acquire` runs
            // and is never counted; the arm only keeps this mapping total.
            Err(
                WorkloadError::Unavailable
                | WorkloadError::InvalidPolicy
                | WorkloadError::MissingAccessContext,
            ) => Self::Unavailable,
        }
    }
}

// Same measurement resolution as Store transaction telemetry, not a threshold.
const BOUNDS_MICROS: [u64; 7] = [
    100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 60_000_000,
];
const BOUND_LABELS: [&str; 8] = ["0.0001", "0.001", "0.01", "0.1", "1", "10", "60", "+Inf"];

/// Cumulative, microsecond-resolution queue-wait observations for one pool.
/// Only requests that actually entered the queue are observed, from their
/// locked enqueue to the locked scheduling pass that produced their terminal
/// disposition. Immediate admission or refusal contributes nothing.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct QueueWaitHistogram {
    buckets: [u64; 8],
    sum_micros: u64,
}

impl QueueWaitHistogram {
    /// Ordered inclusive upper bounds and cumulative counts; `None` is positive infinity.
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

    fn observe(&mut self, wait: Duration) {
        let micros = u64::try_from(wait.as_micros()).unwrap_or(u64::MAX);
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

    fn write_series(&self, output: &mut impl Write, pool: &'static str) -> fmt::Result {
        for (bound, count) in BOUND_LABELS.iter().zip(self.buckets) {
            writeln!(
                output,
                "oxigraph_admission_queue_wait_seconds_bucket{{pool=\"{pool}\",le=\"{bound}\"}} {count}"
            )?;
        }
        writeln!(
            output,
            "oxigraph_admission_queue_wait_seconds_count{{pool=\"{pool}\"}} {}",
            self.count()
        )?;
        writeln!(
            output,
            "oxigraph_admission_queue_wait_seconds_sum{{pool=\"{pool}\"}} {}.{:06}",
            self.sum_micros / 1_000_000,
            self.sum_micros % 1_000_000
        )
    }
}

/// Additive telemetry view of one controller, separate from [`AdmissionSnapshot`].
///
/// Counters are shared by every clone of one controller and start at zero for a
/// new controller. Every returned `acquire` result is counted exactly once in
/// `admissions`; results of requests that entered the queue are additionally
/// counted in `queued_admissions` and observed in the pool's wait histogram.
/// Before either counter saturates, their difference gives immediate outcomes.
/// Gauges are the
/// instantaneous active/queued occupancy captured with the counters under both
/// controller locks, without dequeueing, purging or releasing anything.
/// Counts and sums saturate at their maximum; the struct has a fixed size.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AdmissionMetrics {
    active: [usize; 2],
    queued: [usize; 2],
    admissions: [[u64; 9]; 2],
    queued_admissions: [[u64; 9]; 2],
    queue_wait: [QueueWaitHistogram; 2],
}

impl AdmissionMetrics {
    /// Exact number of Prometheus samples written by [`Self::write_prometheus`].
    pub const SAMPLES: usize = 2 + 2 + 18 + 18 + 20;

    pub const fn active(&self, pool: AdmissionPool) -> usize {
        self.active[pool as usize]
    }

    pub const fn queued(&self, pool: AdmissionPool) -> usize {
        self.queued[pool as usize]
    }

    /// Terminal `acquire` results, immediate and queued.
    pub const fn count(&self, pool: AdmissionPool, disposition: AdmissionDisposition) -> u64 {
        self.admissions[pool as usize][disposition as usize]
    }

    /// Terminal results of requests that actually waited in the queue.
    pub const fn queued_count(
        &self,
        pool: AdmissionPool,
        disposition: AdmissionDisposition,
    ) -> u64 {
        self.queued_admissions[pool as usize][disposition as usize]
    }

    pub const fn queue_wait(&self, pool: AdmissionPool) -> &QueueWaitHistogram {
        &self.queue_wait[pool as usize]
    }

    pub(super) fn record(
        &mut self,
        pool: AdmissionPool,
        disposition: AdmissionDisposition,
        queue_wait: Option<Duration>,
    ) {
        let (pool, disposition) = (pool as usize, disposition as usize);
        self.admissions[pool][disposition] = self.admissions[pool][disposition].saturating_add(1);
        if let Some(wait) = queue_wait {
            self.queued_admissions[pool][disposition] =
                self.queued_admissions[pool][disposition].saturating_add(1);
            self.queue_wait[pool].observe(wait);
        }
    }

    pub(super) fn with_gauges(mut self, snapshot: AdmissionSnapshot) -> Self {
        self.active = [snapshot.active, snapshot.operator_active];
        self.queued = [snapshot.queued, snapshot.operator_queued];
        self
    }

    /// Writes five fixed-label families with exactly [`Self::SAMPLES`] samples.
    /// A scrape served through an admitted operator lease observes itself.
    pub fn write_prometheus(&self, output: &mut impl Write) -> fmt::Result {
        writeln!(output, "# TYPE oxigraph_admission_active gauge")?;
        for pool in AdmissionPool::ALL {
            writeln!(
                output,
                "oxigraph_admission_active{{pool=\"{}\"}} {}",
                pool.as_str(),
                self.active(pool)
            )?;
        }
        writeln!(output, "# TYPE oxigraph_admission_queued gauge")?;
        for pool in AdmissionPool::ALL {
            writeln!(
                output,
                "oxigraph_admission_queued{{pool=\"{}\"}} {}",
                pool.as_str(),
                self.queued(pool)
            )?;
        }
        writeln!(output, "# TYPE oxigraph_admissions_total counter")?;
        for pool in AdmissionPool::ALL {
            for disposition in AdmissionDisposition::ALL {
                writeln!(
                    output,
                    "oxigraph_admissions_total{{pool=\"{}\",disposition=\"{}\"}} {}",
                    pool.as_str(),
                    disposition.as_str(),
                    self.count(pool, disposition)
                )?;
            }
        }
        writeln!(output, "# TYPE oxigraph_admissions_queued_total counter")?;
        for pool in AdmissionPool::ALL {
            for disposition in AdmissionDisposition::ALL {
                writeln!(
                    output,
                    "oxigraph_admissions_queued_total{{pool=\"{}\",disposition=\"{}\"}} {}",
                    pool.as_str(),
                    disposition.as_str(),
                    self.queued_count(pool, disposition)
                )?;
            }
        }
        writeln!(
            output,
            "# TYPE oxigraph_admission_queue_wait_seconds histogram"
        )?;
        for pool in AdmissionPool::ALL {
            self.queue_wait(pool).write_series(output, pool.as_str())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::{Result, ensure};

    /// Fails after a fixed number of accepted characters.
    struct Bounded {
        remaining: usize,
        text: String,
    }
    impl Write for Bounded {
        fn write_str(&mut self, s: &str) -> fmt::Result {
            if s.len() > self.remaining {
                return Err(fmt::Error);
            }
            self.remaining -= s.len();
            self.text.push_str(s);
            Ok(())
        }
    }

    #[test]
    fn histogram_boundaries_and_saturation_are_cumulative() {
        let mut histogram = QueueWaitHistogram::default();
        for micros in [0, 100, 101, 1_000, 60_000_001] {
            histogram.observe(Duration::from_micros(micros));
        }
        assert_eq!(
            histogram.buckets,
            [2, 4, 4, 4, 4, 4, 4, 5],
            "inclusive cumulative buckets"
        );
        assert_eq!(histogram.count(), 5, "count is the +Inf bucket");
        assert_eq!(
            histogram.sum(),
            Duration::from_micros(60_001_202),
            "microsecond sum"
        );
        assert_eq!(
            histogram
                .buckets()
                .map(|(bound, _)| bound)
                .collect::<Vec<_>>(),
            BOUNDS_MICROS
                .iter()
                .map(|&bound| Some(Duration::from_micros(bound)))
                .chain([None])
                .collect::<Vec<_>>(),
            "bound vocabulary"
        );
        histogram.buckets = [u64::MAX; 8];
        histogram.sum_micros = u64::MAX;
        histogram.observe(Duration::MAX);
        assert_eq!(histogram.buckets, [u64::MAX; 8], "bucket saturation");
        assert_eq!(histogram.sum_micros, u64::MAX, "sum saturation");
    }

    #[test]
    fn counters_saturate_and_queue_observations_stay_consistent() {
        let mut metrics = AdmissionMetrics::default();
        metrics.admissions[0][0] = u64::MAX;
        metrics.queued_admissions[0][0] = u64::MAX;
        metrics.record(
            AdmissionPool::Data,
            AdmissionDisposition::Admitted,
            Some(Duration::from_micros(7)),
        );
        metrics.record(AdmissionPool::Data, AdmissionDisposition::Admitted, None);
        assert_eq!(
            metrics.count(AdmissionPool::Data, AdmissionDisposition::Admitted),
            u64::MAX,
            "total saturates"
        );
        assert_eq!(
            metrics.queued_count(AdmissionPool::Data, AdmissionDisposition::Admitted),
            u64::MAX,
            "queued saturates"
        );
        assert_eq!(
            metrics.queue_wait(AdmissionPool::Data).count(),
            1,
            "only the queued result is observed"
        );
        assert_eq!(
            metrics.queue_wait(AdmissionPool::Operator),
            &QueueWaitHistogram::default(),
            "pools are independent"
        );
        assert_eq!(
            metrics.count(AdmissionPool::Operator, AdmissionDisposition::Admitted),
            0,
            "pools are independent"
        );
    }

    #[test]
    fn export_has_fixed_samples_vocabulary_and_propagates_errors() -> Result<()> {
        let mut metrics = AdmissionMetrics::default();
        metrics.record(
            AdmissionPool::Operator,
            AdmissionDisposition::QueueTimedOut,
            Some(Duration::from_millis(15)),
        );
        metrics.record(
            AdmissionPool::Data,
            AdmissionDisposition::RefusedClass,
            None,
        );
        let metrics = metrics.with_gauges(AdmissionSnapshot {
            active: 3,
            queued: 2,
            operator_active: 1,
            operator_queued: 0,
        });
        let mut text = String::new();
        metrics.write_prometheus(&mut text)?;
        let samples: Vec<_> = text.lines().filter(|line| !line.starts_with('#')).collect();
        ensure!(
            samples.len() == AdmissionMetrics::SAMPLES,
            "{}",
            samples.len()
        );
        ensure!(
            text.lines()
                .filter(|line| line.starts_with("# TYPE "))
                .count()
                == 5
        );
        for expected in [
            "oxigraph_admission_active{pool=\"data\"} 3\n",
            "oxigraph_admission_queued{pool=\"data\"} 2\n",
            "oxigraph_admission_active{pool=\"operator\"} 1\n",
            "oxigraph_admission_queued{pool=\"operator\"} 0\n",
            "oxigraph_admissions_total{pool=\"data\",disposition=\"refused_class\"} 1\n",
            "oxigraph_admissions_queued_total{pool=\"data\",disposition=\"refused_class\"} 0\n",
            "oxigraph_admissions_total{pool=\"operator\",disposition=\"queue_timed_out\"} 1\n",
            "oxigraph_admissions_queued_total{pool=\"operator\",disposition=\"queue_timed_out\"} 1\n",
            "oxigraph_admission_queue_wait_seconds_bucket{pool=\"operator\",le=\"0.01\"} 0\n",
            "oxigraph_admission_queue_wait_seconds_bucket{pool=\"operator\",le=\"0.1\"} 1\n",
            "oxigraph_admission_queue_wait_seconds_bucket{pool=\"operator\",le=\"+Inf\"} 1\n",
            "oxigraph_admission_queue_wait_seconds_count{pool=\"operator\"} 1\n",
            "oxigraph_admission_queue_wait_seconds_sum{pool=\"operator\"} 0.015000\n",
            "oxigraph_admission_queue_wait_seconds_count{pool=\"data\"} 0\n",
        ] {
            ensure!(text.contains(expected), "missing {expected}");
        }
        for line in &samples {
            let (name, rest) = line.split_once('{').unwrap_or((line, ""));
            ensure!(
                name.starts_with("oxigraph_admission"),
                "family drift: {line}"
            );
            let labels = rest.split_once('}').map_or("", |(labels, _)| labels);
            for label in labels.split(',').filter(|label| !label.is_empty()) {
                let (key, value) = label.split_once('=').unwrap_or((label, ""));
                let value = value.trim_matches('"');
                let allowed = match key {
                    "pool" => AdmissionPool::ALL.iter().any(|pool| pool.as_str() == value),
                    "disposition" => AdmissionDisposition::ALL
                        .iter()
                        .any(|disposition| disposition.as_str() == value),
                    "le" => BOUND_LABELS.contains(&value),
                    _ => false,
                };
                ensure!(allowed, "label vocabulary drift: {line}");
            }
        }
        // Errors propagate from every write position; no truncated success.
        for remaining in 0..text.len() {
            let mut bounded = Bounded {
                remaining,
                text: String::new(),
            };
            ensure!(
                metrics.write_prometheus(&mut bounded).is_err(),
                "formatter error swallowed at {remaining}"
            );
            ensure!(text.starts_with(&bounded.text), "prefix differs");
        }
        let mut exact = Bounded {
            remaining: text.len(),
            text: String::new(),
        };
        metrics.write_prometheus(&mut exact)?;
        ensure!(exact.text == text, "bounded rewrite differs");
        Ok(())
    }

    #[test]
    fn every_acquire_result_maps_to_one_fixed_disposition() {
        let errors = [
            (
                WorkloadError::Overloaded(AdmissionScope::Global),
                "refused_global",
            ),
            (
                WorkloadError::Overloaded(AdmissionScope::Class),
                "refused_class",
            ),
            (
                WorkloadError::Overloaded(AdmissionScope::Operator),
                "refused_operator",
            ),
            (WorkloadError::UnknownClass, "unknown_class"),
            (WorkloadError::Cancelled, "cancelled"),
            (WorkloadError::RequestTimedOut, "request_timed_out"),
            (WorkloadError::AdmissionTimedOut, "queue_timed_out"),
            (WorkloadError::Unavailable, "unavailable"),
            (WorkloadError::InvalidPolicy, "unavailable"),
            (WorkloadError::MissingAccessContext, "unavailable"),
        ];
        for (error, expected) in errors {
            assert_eq!(
                AdmissionDisposition::of(&Err(error)).as_str(),
                expected,
                "{error}"
            );
        }
        assert_eq!(
            AdmissionPool::from(ListenerKind::Operator),
            AdmissionPool::Operator,
            "operator listener maps to the operator pool"
        );
        assert_eq!(
            AdmissionPool::from(ListenerKind::Data),
            AdmissionPool::Data,
            "data listener maps to the data pool"
        );
    }
}
