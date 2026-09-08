//! Shared query-local row storage and consumer controls for native index bindings.
use super::{
    QueryEvaluationError, QueryResults, QuerySolution, QuerySolutionIter, QueryTripleIter,
};
use crate::model::{Term, Variable};
use crate::store::TransactionStartControl;
use spargebra::algebra::QueryExpression;
use std::sync::Arc;
use std::time::Instant;

type Check = fn(&TransactionStartControl, Instant) -> Result<(), QueryEvaluationError>;

pub(super) fn guard_results(
    results: QueryResults<'static>,
    control: TransactionStartControl,
    started: Instant,
    check: Check,
) -> Result<QueryResults<'static>, QueryEvaluationError> {
    // SERVICE rows can already be buffered inside the ordinary evaluator.
    check(&control, started)?;
    Ok(match results {
        QueryResults::Solutions(rows) => {
            let variables: Arc<[Variable]> = rows.variables().into();
            QueryResults::Solutions(QuerySolutionIter::new(
                variables,
                controlled_rows(rows, control, started, check),
            ))
        }
        QueryResults::Graph(rows) => QueryResults::Graph(QueryTripleIter::new(controlled_rows(
            rows, control, started, check,
        ))),
        QueryResults::Boolean(value) => QueryResults::Boolean(value),
    })
}

fn controlled_rows<T>(
    mut rows: impl Iterator<Item = Result<T, QueryEvaluationError>>,
    control: TransactionStartControl,
    started: Instant,
    check: Check,
) -> impl Iterator<Item = Result<T, QueryEvaluationError>> {
    let mut finished = false;
    std::iter::from_fn(move || {
        if finished {
            return None;
        }
        // Check before polling: lazy evaluation may invoke another SERVICE.
        if let Err(error) = check(&control, started) {
            finished = true;
            return Some(Err(error));
        }
        let row = rows.next();
        // Cancellation/deadline may also change during that unit of work.
        if let Err(error) = check(&control, started) {
            finished = true;
            return Some(Err(error));
        }
        finished = row.is_none();
        row
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn check(control: &TransactionStartControl, _: Instant) -> Result<(), QueryEvaluationError> {
        if control.is_cancelled() {
            Err(QueryEvaluationError::Cancelled)
        } else {
            Ok(())
        }
    }
    #[test]
    fn cancellation_prevents_polling_underlying_lazy_work() {
        let polls = Cell::new(0);
        let control = TransactionStartControl::new();
        let source = std::iter::from_fn(|| {
            polls.set(polls.get() + 1);
            Some(Ok(()))
        });
        let mut rows = controlled_rows(source, control.clone(), Instant::now(), check);
        assert!(rows.next().unwrap().is_ok());
        control.cancel();
        assert!(matches!(
            rows.next(),
            Some(Err(QueryEvaluationError::Cancelled))
        ));
        assert!(rows.next().is_none());
        assert_eq!(polls.get(), 1);
    }
    #[test]
    fn cancellation_during_lazy_work_is_checked_before_returning() {
        let control = TransactionStartControl::new();
        let source = std::iter::from_fn(|| {
            control.cancel();
            Some(Ok(()))
        });
        let mut rows = controlled_rows(source, control.clone(), Instant::now(), check);
        assert!(matches!(
            rows.next(),
            Some(Err(QueryEvaluationError::Cancelled))
        ));
        assert!(rows.next().is_none());
    }
}

#[derive(Default)]
pub(super) struct Cache {
    pub entries: Vec<(QueryExpression, CachedRows)>,
    pub rows: usize,
    pub bytes: usize,
}
#[derive(Clone)]
pub(super) struct CachedRows {
    pub variables: Arc<[Variable]>,
    pub rows: Arc<[Vec<Option<Term>>]>,
}
impl CachedRows {
    pub fn iter(
        &self,
        control: TransactionStartControl,
        started: Instant,
        check: Check,
    ) -> QuerySolutionIter<'static> {
        let variables = Arc::clone(&self.variables);
        let rows = Arc::clone(&self.rows);
        QuerySolutionIter::new(
            Arc::clone(&variables),
            (0..rows.len()).map(move |i| {
                check(&control, started)?;
                Ok(QuerySolution::from((
                    Arc::clone(&variables),
                    rows[i].clone(),
                )))
            }),
        )
    }
}
