//! Bounded Store-attributed observations of query and update evaluation.
use super::{StorageError, TransactionDurationHistogram};
use crate::sparql::{
    QueryEvaluationError, QueryResults, QuerySolutionIter, QueryTripleIter, UpdateEvaluationError,
};
use std::error::Error;
use std::fmt::{self, Write};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// The fixed set of Store-bound SPARQL operation families.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvaluationOperation {
    Query,
    Update,
}

impl EvaluationOperation {
    pub const ALL: [Self; 2] = [Self::Query, Self::Update];
    const fn names(self) -> (&'static str, &'static str) {
        match self {
            Self::Query => ("oxigraph_queries_total", "oxigraph_query_duration_seconds"),
            Self::Update => ("oxigraph_updates_total", "oxigraph_update_duration_seconds"),
        }
    }
}

/// One observed operation result. These are not durable transaction outcomes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvaluationOutcome {
    Succeeded,
    /// Query failure or update failure before commit. No error text is retained.
    Failed,
    Cancelled,
    TimedOut,
    PolicyDenied,
    /// An update commit call failed or unwound; its effects must not be replayed.
    Indeterminate,
    /// Bound operation or lazy results dropped without observed completion.
    Abandoned,
}

impl EvaluationOutcome {
    pub const ALL: [Self; 7] = [
        Self::Succeeded,
        Self::Failed,
        Self::Cancelled,
        Self::TimedOut,
        Self::PolicyDenied,
        Self::Indeterminate,
        Self::Abandoned,
    ];
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
            Self::PolicyDenied => "policy_denied",
            Self::Indeterminate => "indeterminate",
            Self::Abandoned => "abandoned",
        }
    }
}

/// Evaluation durations use the same cumulative buckets and saturating microsecond sum
/// as transaction durations. The measured operation boundary differs.
pub type EvaluationDurationHistogram = TransactionDurationHistogram;

/// Internally consistent per-open-Store observations, shared by clones and reset on reopen.
///
/// Only `on_store` and `on_store_with_entailment` bindings are attributed. Parsing,
/// generic dataset bindings (even to a Store), borrowed transactions, and standalone
/// entailment/validation calls are excluded. Duration starts before Store binding and
/// includes snapshot/materialization, admission, caller delay and lazy consumption.
/// Boolean queries finish immediately; lazy queries succeed only at observed EOF,
/// fail once at the first returned error, or are abandoned on early drop. Iteration is
/// never eagerly drained, fused or retried by telemetry. A successful `SILENT` operation
/// remains successful; these are not counts of swallowed remote-denial attempts.
/// Update success requires acknowledged commit; commit errors remain indeterminate.
/// Error classification inspects at most 32 known wrapper levels, never custom error
/// callbacks. Unknown errors are `Failed`, even if their private source has another kind.
/// No query, RDF, identifier, or raw error is retained. Counters/sums saturate at u64::MAX.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EvaluationMetrics {
    durations: [[EvaluationDurationHistogram; 7]; 2],
}

impl EvaluationMetrics {
    pub fn count(&self, operation: EvaluationOperation, outcome: EvaluationOutcome) -> u64 {
        self.duration(operation, outcome).count()
    }
    pub fn duration(
        &self,
        operation: EvaluationOperation,
        outcome: EvaluationOutcome,
    ) -> &EvaluationDurationHistogram {
        &self.durations[operation as usize][outcome as usize]
    }
    /// Four Prometheus families, exactly 154 fixed-label samples. No user-derived labels.
    pub fn write_prometheus(&self, output: &mut impl Write) -> fmt::Result {
        for operation in EvaluationOperation::ALL {
            let (counter, histogram) = operation.names();
            writeln!(output, "# TYPE {counter} counter")?;
            for outcome in EvaluationOutcome::ALL {
                writeln!(
                    output,
                    "{counter}{{outcome=\"{}\"}} {}",
                    outcome.as_str(),
                    self.count(operation, outcome)
                )?;
            }
            writeln!(output, "# TYPE {histogram} histogram")?;
            for outcome in EvaluationOutcome::ALL {
                self.duration(operation, outcome).write_series(
                    output,
                    histogram,
                    "outcome",
                    outcome.as_str(),
                )?;
            }
        }
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct EvaluationMetricsState(Mutex<EvaluationMetrics>);
impl EvaluationMetricsState {
    pub(crate) fn snapshot(&self) -> EvaluationMetrics {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
    pub(crate) fn start(self: &Arc<Self>, operation: EvaluationOperation) -> EvaluationObservation {
        EvaluationObservation {
            metrics: Arc::clone(self),
            operation,
            started: Instant::now(),
            pending: Some(EvaluationOutcome::Abandoned),
        }
    }
}

pub(crate) struct EvaluationObservation {
    metrics: Arc<EvaluationMetricsState>,
    operation: EvaluationOperation,
    started: Instant,
    pending: Option<EvaluationOutcome>,
}

impl EvaluationObservation {
    pub(crate) fn begin(&mut self) {
        if self.pending.is_some() {
            self.pending = Some(EvaluationOutcome::Failed);
        }
    }
    fn await_results(&mut self) {
        if self.pending.is_some() {
            self.pending = Some(EvaluationOutcome::Abandoned);
        }
    }
    pub(crate) fn before_commit(&mut self) {
        if self.pending.is_some() {
            self.pending = Some(EvaluationOutcome::Indeterminate);
        }
    }
    pub(crate) fn finish(&mut self, outcome: EvaluationOutcome) {
        if self.pending.take().is_none() {
            return;
        }
        let elapsed = self.started.elapsed();
        self.metrics
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .durations[self.operation as usize][outcome as usize]
            .observe(elapsed);
    }
    pub(crate) fn finish_error(&mut self, error: &(dyn Error + 'static)) {
        self.finish(error_outcome(error));
    }
    pub(crate) fn finish_update(&mut self, result: &Result<(), UpdateEvaluationError>) {
        match result {
            Ok(()) => self.finish(EvaluationOutcome::Succeeded),
            Err(_) if self.pending == Some(EvaluationOutcome::Indeterminate) => {
                self.finish(EvaluationOutcome::Indeterminate)
            }
            Err(error) => self.finish_error(error),
        }
    }
}

impl Drop for EvaluationObservation {
    fn drop(&mut self) {
        if let Some(outcome) = self.pending {
            self.finish(outcome);
        }
    }
}

fn error_outcome(mut error: &(dyn Error + 'static)) -> EvaluationOutcome {
    // Inspect only known wrapper fields. Calling a foreign Error::source or Display
    // can panic or have effects; telemetry must never invoke those callbacks.
    for _ in 0..32 {
        if matches!(
            error.downcast_ref::<QueryEvaluationError>(),
            Some(QueryEvaluationError::Cancelled)
        ) || matches!(
            error.downcast_ref::<UpdateEvaluationError>(),
            Some(UpdateEvaluationError::Cancelled)
        ) {
            return EvaluationOutcome::Cancelled;
        }
        #[cfg(feature = "http-client")]
        if let Some(error) = error.downcast_ref::<crate::http::EgressError>() {
            return match error.kind() {
                crate::http::EgressErrorKind::Cancelled => EvaluationOutcome::Cancelled,
                crate::http::EgressErrorKind::Timeout => EvaluationOutcome::TimedOut,
                crate::http::EgressErrorKind::PolicyDenied => EvaluationOutcome::PolicyDenied,
                _ => EvaluationOutcome::Failed,
            };
        }
        error = if let Some(error) = error.downcast_ref::<QueryEvaluationError>() {
            match error {
                QueryEvaluationError::Service(error)
                | QueryEvaluationError::Dataset(error)
                | QueryEvaluationError::Unexpected(error) => error.as_ref(),
                _ => break,
            }
        } else if let Some(error) = error.downcast_ref::<UpdateEvaluationError>() {
            match error {
                UpdateEvaluationError::Service(error)
                | UpdateEvaluationError::Dataset(error)
                | UpdateEvaluationError::Unexpected(error) => error.as_ref(),
                UpdateEvaluationError::Storage(error) => error,
                _ => break,
            }
        } else if let Some(error) = error.downcast_ref::<StorageError>() {
            match error {
                StorageError::Io(error) => error,
                StorageError::Other(error) => error.as_ref(),
                _ => break,
            }
        } else if let Some(error) = error.downcast_ref::<std::io::Error>() {
            let Some(inner) = error.get_ref() else {
                break;
            };
            inner
        } else {
            break;
        };
    }
    EvaluationOutcome::Failed
}

pub(crate) fn observe_query_result(
    result: Result<QueryResults<'_>, QueryEvaluationError>,
    observation: Option<EvaluationObservation>,
) -> Result<QueryResults<'_>, QueryEvaluationError> {
    let Some(mut observation) = observation else {
        return result;
    };
    match result {
        Err(error) => {
            observation.finish_error(&error);
            Err(error)
        }
        Ok(QueryResults::Boolean(value)) => {
            observation.finish(EvaluationOutcome::Succeeded);
            Ok(QueryResults::Boolean(value))
        }
        Ok(QueryResults::Solutions(iter)) => {
            observation.await_results();
            Ok(QueryResults::Solutions(QuerySolutionIter::new(
                iter.variables().into(),
                ObservedIterator {
                    inner: iter,
                    observation,
                },
            )))
        }
        Ok(QueryResults::Graph(iter)) => {
            observation.await_results();
            Ok(QueryResults::Graph(QueryTripleIter::new(
                ObservedIterator {
                    inner: iter,
                    observation,
                },
            )))
        }
    }
}

struct ObservedIterator<I> {
    inner: I,
    observation: EvaluationObservation,
}
impl<T, I: Iterator<Item = Result<T, QueryEvaluationError>>> Iterator for ObservedIterator<I> {
    type Item = I::Item;
    fn next(&mut self) -> Option<Self::Item> {
        self.observation.begin();
        let value = self.inner.next();
        match &value {
            Some(Ok(_)) => self.observation.await_results(),
            Some(Err(error)) => self.observation.finish_error(error),
            None => self.observation.finish(EvaluationOutcome::Succeeded),
        }
        value
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    reason = "isolated telemetry lifecycle assertions"
)]
mod tests {
    use super::*;

    #[test]
    fn commit_error_and_unwind_remain_indeterminate() {
        let metrics = Arc::new(EvaluationMetricsState::default());
        {
            let mut guard = metrics.start(EvaluationOperation::Update);
            guard.begin();
            guard.before_commit();
            guard.finish_update(&Err(
                StorageError::Other("private commit error".into()).into()
            ));
            guard.finish_update(&Ok(()));
        }
        let result = std::panic::catch_unwind({
            let metrics = Arc::clone(&metrics);
            move || {
                let mut guard = metrics.start(EvaluationOperation::Update);
                guard.begin();
                guard.before_commit();
                panic!("isolated commit unwind");
            }
        });
        assert!(result.is_err());
        let snapshot = metrics.snapshot();
        assert_eq!(
            snapshot.count(
                EvaluationOperation::Update,
                EvaluationOutcome::Indeterminate
            ),
            2
        );
        assert_eq!(
            snapshot.count(EvaluationOperation::Update, EvaluationOutcome::Succeeded),
            0
        );
    }

    #[test]
    fn iterator_retains_items_after_first_error_and_is_not_eager() {
        let metrics = Arc::new(EvaluationMetricsState::default());
        let mut iterator = ObservedIterator {
            inner: [
                Ok(1),
                Err(QueryEvaluationError::Cancelled),
                Ok(2),
                Err(QueryEvaluationError::UnexpectedDefaultGraph),
            ]
            .into_iter(),
            observation: metrics.start(EvaluationOperation::Query),
        };
        assert_eq!(iterator.size_hint(), (4, Some(4)));
        assert_eq!(metrics.snapshot(), EvaluationMetrics::default());
        assert!(matches!(iterator.next(), Some(Ok(1))));
        assert!(matches!(
            iterator.next(),
            Some(Err(QueryEvaluationError::Cancelled))
        ));
        assert!(matches!(iterator.next(), Some(Ok(2))));
        assert!(matches!(
            iterator.next(),
            Some(Err(QueryEvaluationError::UnexpectedDefaultGraph))
        ));
        assert!(iterator.next().is_none());
        drop(iterator);
        let snapshot = metrics.snapshot();
        assert_eq!(
            snapshot.count(EvaluationOperation::Query, EvaluationOutcome::Cancelled),
            1
        );
        assert_eq!(
            snapshot.count(EvaluationOperation::Query, EvaluationOutcome::Failed),
            0
        );
        assert_eq!(
            snapshot.count(EvaluationOperation::Query, EvaluationOutcome::Succeeded),
            0
        );
        assert_eq!(
            snapshot.count(EvaluationOperation::Query, EvaluationOutcome::Abandoned),
            0
        );
    }

    #[test]
    fn diagnostic_traversal_never_calls_foreign_error_methods() {
        #[derive(Debug)]
        struct CyclicError;
        impl fmt::Display for CyclicError {
            fn fmt(&self, _: &mut fmt::Formatter<'_>) -> fmt::Result {
                panic!("telemetry must not format errors")
            }
        }
        impl Error for CyclicError {
            fn source(&self) -> Option<&(dyn Error + 'static)> {
                panic!("telemetry must not call custom source")
            }
        }
        assert_eq!(error_outcome(&CyclicError), EvaluationOutcome::Failed);
        assert_eq!(
            error_outcome(&QueryEvaluationError::Service(Box::new(CyclicError))),
            EvaluationOutcome::Failed
        );
        assert_eq!(
            error_outcome(&QueryEvaluationError::Service(Box::new(
                QueryEvaluationError::Cancelled
            ))),
            EvaluationOutcome::Cancelled
        );
        let mut nested = QueryEvaluationError::Cancelled;
        for _ in 0..40 {
            nested = QueryEvaluationError::Unexpected(Box::new(nested));
        }
        assert_eq!(error_outcome(&nested), EvaluationOutcome::Failed);
    }
}
