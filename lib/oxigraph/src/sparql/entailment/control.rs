use super::{QueryEntailmentError, QueryEntailmentOptions};
use crate::model::Dataset;
use crate::sparql::{CancellationReason, CancellationToken, QueryEvaluationError};
use std::fmt;
use std::time::Duration;
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

/// One materialization budget, starting before snapshot acquisition. An
/// enclosing request token retains its own earlier absolute deadline.
#[derive(Clone)]
pub(super) struct Control {
    tokens: [Option<CancellationToken>; 2],
    started: Option<Instant>,
    timeout: Option<Duration>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{GraphName, NamedNode, Quad};
    use crate::store::Store;
    use std::cell::Cell;

    #[test]
    fn checked_collection_stops_mid_copy_and_returns_no_partial_dataset() {
        let token = CancellationToken::new();
        let control = Control::new(
            &QueryEntailmentOptions::default().with_cancellation_token(token.clone()),
            None,
        );
        let consumed = Cell::new(0);
        let items = (0..1_000).inspect(|n| {
            consumed.set(consumed.get() + 1);
            if *n == 8 {
                token.cancel();
            }
        });
        assert!(matches!(
            control.collect::<_, Vec<_>>(items),
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::Cancelled
            ))
        ));
        assert_eq!(consumed.get(), 9);
    }

    #[test]
    fn snapshot_cancellation_after_copied_rows_keeps_source_and_empty_topology() {
        let store = Store::new().unwrap();
        for n in 0..32 {
            store
                .insert(Quad::new(
                    NamedNode::new(format!("urn:s{n}")).unwrap(),
                    NamedNode::new("urn:p").unwrap(),
                    NamedNode::new("urn:o").unwrap(),
                    GraphName::DefaultGraph,
                ))
                .unwrap();
        }
        let empty = NamedNode::new("urn:empty").unwrap();
        store.insert_named_graph(empty.clone()).unwrap();
        let mut checks = 0;
        let result = store.snapshot_contents_with_control(|| {
            checks += 1;
            if checks == 12 {
                Err(QueryEntailmentError::Evaluation(
                    QueryEvaluationError::TimedOut,
                ))
            } else {
                Ok(())
            }
        });
        assert!(matches!(
            result,
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::TimedOut
            ))
        ));
        assert_eq!(checks, 12);
        assert_eq!(store.len().unwrap(), 32);
        assert!(store.contains_named_graph(&empty.into()).unwrap());
    }

    #[test]
    fn collection_checks_expiry_at_eof_not_only_emitted_rows() {
        let token = CancellationToken::new();
        let control = Control::new(
            &QueryEntailmentOptions::default().with_cancellation_token(token.clone()),
            None,
        );
        let items = std::iter::from_fn(|| {
            token.cancel();
            None::<()>
        });
        assert!(matches!(
            control.collect::<_, Vec<_>>(items),
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::Cancelled
            ))
        ));
    }

    #[test]
    fn successful_materialization_clears_only_its_relative_budget() {
        let token = CancellationToken::new();
        let mut control = Control::new(
            &QueryEntailmentOptions::default()
                .with_timeout(Some(Duration::from_secs(1)))
                .with_cancellation_token(token.clone()),
            None,
        );
        // Deterministic elapsed-time seam: no wall-clock sleep.
        control.started = Some(Instant::now() - Duration::from_secs(2));
        assert!(control.check().is_err());
        let control = control.after_materialization();
        assert!(control.check().is_ok());
        token.cancel();
        assert!(matches!(
            control.check(),
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::Cancelled
            ))
        ));
        let control = Control::new(
            &QueryEntailmentOptions::default(),
            Some(CancellationToken::new().with_deadline(Instant::now())),
        )
        .after_materialization();
        assert!(matches!(
            control.check(),
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::TimedOut
            ))
        ));
    }
}

impl fmt::Debug for Control {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Control")
            .field("timeout", &self.timeout)
            .finish_non_exhaustive()
    }
}

impl Control {
    #[cfg(test)]
    pub(super) fn expire_materialization_clock_for_test(&mut self) {
        self.started = Some(Instant::now() - Duration::from_secs(120));
    }
    pub(super) fn after_materialization(mut self) -> Self {
        self.started = None;
        self.timeout = None;
        self
    }
    pub(super) fn new(options: &QueryEntailmentOptions, caller: Option<CancellationToken>) -> Self {
        Self {
            tokens: [options.cancellation_token.clone(), caller],
            started: options.timeout.map(|_| Instant::now()),
            timeout: options.timeout,
        }
    }

    pub(super) fn check(&self) -> Result<(), QueryEntailmentError> {
        for token in self.tokens.iter().flatten() {
            match token.cancellation_reason() {
                Some(CancellationReason::Cancelled) => {
                    return Err(QueryEvaluationError::Cancelled.into());
                }
                Some(CancellationReason::TimedOut) => {
                    return Err(QueryEvaluationError::TimedOut.into());
                }
                None => (),
            }
        }
        if self
            .timeout
            .zip(self.started)
            .is_some_and(|(timeout, started)| started.elapsed() >= timeout)
        {
            return Err(QueryEvaluationError::TimedOut.into());
        }
        Ok(())
    }

    pub(super) fn collect<T, C: FromIterator<T>>(
        &self,
        iter: impl IntoIterator<Item = T>,
    ) -> Result<C, QueryEntailmentError> {
        self.check()?;
        let result = iter
            .into_iter()
            .map(|item| {
                self.check()?;
                Ok(item)
            })
            .collect();
        self.check()?;
        result
    }

    pub(super) fn copy(&self, source: &Dataset) -> Result<Dataset, QueryEntailmentError> {
        let mut target: Dataset = self.collect(source)?;
        for graph in source.named_graphs() {
            self.check()?;
            target.insert_named_graph(graph);
        }
        self.check()?;
        Ok(target)
    }

    pub(super) fn results<T>(
        &self,
        rows: Result<Vec<T>, QueryEntailmentError>,
    ) -> impl Iterator<Item = Result<T, QueryEntailmentError>> + use<T> {
        let control = self.clone();
        let (mut rows, mut error) = match rows {
            Ok(rows) => (rows.into_iter(), None),
            Err(error) => (Vec::new().into_iter(), Some(error)),
        };
        let mut finished = false;
        std::iter::from_fn(move || {
            if finished {
                return None;
            }
            if let Some(error) = error.take() {
                finished = true;
                return Some(Err(error));
            }
            if let Err(error) = control.check() {
                finished = true;
                return Some(Err(error));
            }
            let next = rows.next();
            finished = next.is_none();
            next.map(Ok)
        })
    }
}
