use crate::QueryEvaluationError;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// A cooperatively counted evaluator resource, not a process memory limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum QueryResource {
    /// Rows inserted into native Cartesian and hash inner-join build tables.
    InnerJoinBuildRows,
}

impl fmt::Display for QueryResource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InnerJoinBuildRows => f.write_str("inner_join_build_rows"),
        }
    }
}

/// The evaluator phase in which a cooperative resource limit was exceeded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum QueryResourcePhase {
    JoinBuild,
}

impl fmt::Display for QueryResourcePhase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::JoinBuild => f.write_str("join_build"),
        }
    }
}

/// An explicit, shared, cumulative native inner-join build-row budget.
///
/// Clones share the same counter and sticky failure. Create a fresh budget for
/// an independent request; reusing an evaluator does not reset its budget.
/// Each destination row (including duplicates and repeated/nested builds) is
/// charged before insertion. An attempted row beyond the limit fails the
/// budget permanently; reaching the limit exactly is not failure.
///
/// This does not bound probes, scans, row width, other operator buffers,
/// planning, inference, foreign SERVICE work, or process memory/CPU.
#[derive(Debug, Clone)]
pub struct InnerJoinBuildBudget(Arc<InnerJoinBuildState>);

#[derive(Debug)]
struct InnerJoinBuildState {
    limit: u64,
    charged: AtomicU64,
    exhausted: AtomicBool,
}

impl InnerJoinBuildBudget {
    #[must_use]
    pub fn new(limit: u64) -> Self {
        Self(Arc::new(InnerJoinBuildState {
            limit,
            charged: AtomicU64::new(0),
            exhausted: AtomicBool::new(false),
        }))
    }

    #[must_use]
    pub fn limit(&self) -> u64 {
        self.0.limit
    }

    /// Successfully charged destination rows, never greater than the limit.
    #[must_use]
    pub fn charged_rows(&self) -> u64 {
        self.0.charged.load(Ordering::Acquire)
    }

    /// Checks the sticky failure, without consuming a row or resetting it.
    pub fn check(&self) -> Result<(), QueryEvaluationError> {
        if self.0.exhausted.load(Ordering::Acquire) {
            Err(self.error())
        } else {
            Ok(())
        }
    }

    pub(crate) fn charge(&self) -> Result<(), QueryEvaluationError> {
        self.check()?;
        if self
            .0
            .charged
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                (used < self.0.limit).then(|| used + 1)
            })
            .is_err()
        {
            self.0.exhausted.store(true, Ordering::Release);
            return Err(self.error());
        }
        Ok(())
    }

    fn error(&self) -> QueryEvaluationError {
        QueryEvaluationError::ResourceLimitExceeded {
            resource: QueryResource::InnerJoinBuildRows,
            phase: QueryResourcePhase::JoinBuild,
            limit: self.0.limit,
        }
    }
}

/// Check after `next` as well: expressions and SILENT handlers may swallow an
/// inner error or return EOF after triggering the shared latch.
pub(crate) fn budgeted_iter<T>(
    mut iter: impl Iterator<Item = Result<T, QueryEvaluationError>>,
    budget: InnerJoinBuildBudget,
) -> impl Iterator<Item = Result<T, QueryEvaluationError>> {
    let mut finished = false;
    std::iter::from_fn(move || {
        if finished {
            return None;
        }
        if let Err(error) = budget.check() {
            finished = true;
            return Some(Err(error));
        }
        let item = iter.next();
        if let Err(error) = budget.check() {
            finished = true;
            return Some(Err(error));
        }
        finished = item.is_none();
        item
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_limit_and_shared_sticky_failure() {
        let budget = InnerJoinBuildBudget::new(1);
        let clone = budget.clone();
        budget.charge().unwrap();
        clone.check().unwrap();
        assert_eq!(clone.charged_rows(), 1);
        assert!(clone.charge().is_err());
        assert!(budget.check().is_err());
        assert_eq!(budget.charged_rows(), 1);
    }

    #[test]
    fn zero_and_maximum_do_not_overflow() {
        let zero = InnerJoinBuildBudget::new(0);
        zero.check().unwrap();
        assert!(zero.charge().is_err());
        let max = InnerJoinBuildBudget::new(u64::MAX);
        max.0.charged.store(u64::MAX - 1, Ordering::Release);
        max.charge().unwrap();
        max.check().unwrap();
        assert!(max.charge().is_err());
        assert_eq!(max.charged_rows(), u64::MAX);
    }
}
