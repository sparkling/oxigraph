use crate::QueryEvaluationError;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// A cooperatively counted evaluator resource, not a process memory limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
#[expect(
    clippy::enum_variant_names,
    reason = "the published row-counter names share their unit deliberately"
)]
pub enum QueryResource {
    /// Rows inserted into native Cartesian and hash inner-join build tables.
    InnerJoinBuildRows,
    /// Rows admitted into native `ORDER BY` sort buffers.
    SortBufferRows,
    /// Unique tuples retained by native `DISTINCT` hash sets.
    DistinctBufferRows,
    /// Accumulator groups retained by native grouping operators.
    GroupBufferRows,
    /// Unique keys retained by native aggregate `DISTINCT` accumulators.
    AggregateDistinctRows,
    /// Entries retained in native property-path sets and worklists.
    PathBufferRows,
}

impl fmt::Display for QueryResource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InnerJoinBuildRows => f.write_str("inner_join_build_rows"),
            Self::SortBufferRows => f.write_str("sort_buffer_rows"),
            Self::DistinctBufferRows => f.write_str("distinct_buffer_rows"),
            Self::GroupBufferRows => f.write_str("group_buffer_rows"),
            Self::AggregateDistinctRows => f.write_str("aggregate_distinct_rows"),
            Self::PathBufferRows => f.write_str("path_buffer_rows"),
        }
    }
}

/// The evaluator phase in which a cooperative resource limit was exceeded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum QueryResourcePhase {
    JoinBuild,
    SortBuffer,
    DistinctBuffer,
    GroupBuffer,
    AggregateDistinct,
    PathBuffer,
}

impl fmt::Display for QueryResourcePhase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::JoinBuild => f.write_str("join_build"),
            Self::SortBuffer => f.write_str("sort_buffer"),
            Self::DistinctBuffer => f.write_str("distinct_buffer"),
            Self::GroupBuffer => f.write_str("group_buffer"),
            Self::AggregateDistinct => f.write_str("aggregate_distinct"),
            Self::PathBuffer => f.write_str("path_buffer"),
        }
    }
}

/// One cumulative row counter with a sticky failure, shared by every clone.
#[derive(Debug)]
struct RowBudgetState {
    resource: QueryResource,
    phase: QueryResourcePhase,
    limit: u64,
    charged: AtomicU64,
    exhausted: AtomicBool,
}

impl RowBudgetState {
    fn new(resource: QueryResource, phase: QueryResourcePhase, limit: u64) -> Arc<Self> {
        Arc::new(Self {
            resource,
            phase,
            limit,
            charged: AtomicU64::new(0),
            exhausted: AtomicBool::new(false),
        })
    }

    fn charged_rows(&self) -> u64 {
        self.charged.load(Ordering::Acquire)
    }

    fn check(&self) -> Result<(), QueryEvaluationError> {
        if self.exhausted.load(Ordering::Acquire) {
            Err(self.error())
        } else {
            Ok(())
        }
    }

    fn charge(&self) -> Result<(), QueryEvaluationError> {
        self.check()?;
        if self
            .charged
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                (used < self.limit).then(|| used + 1)
            })
            .is_err()
        {
            self.exhausted.store(true, Ordering::Release);
            return Err(self.error());
        }
        Ok(())
    }

    fn error(&self) -> QueryEvaluationError {
        QueryEvaluationError::ResourceLimitExceeded {
            resource: self.resource,
            phase: self.phase,
            limit: self.limit,
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
pub struct InnerJoinBuildBudget(Arc<RowBudgetState>);

impl InnerJoinBuildBudget {
    #[must_use]
    pub fn new(limit: u64) -> Self {
        Self(RowBudgetState::new(
            QueryResource::InnerJoinBuildRows,
            QueryResourcePhase::JoinBuild,
            limit,
        ))
    }

    #[must_use]
    pub fn limit(&self) -> u64 {
        self.0.limit
    }

    /// Successfully charged destination rows, never greater than the limit.
    #[must_use]
    pub fn charged_rows(&self) -> u64 {
        self.0.charged_rows()
    }

    /// Checks the sticky failure, without consuming a row or resetting it.
    pub fn check(&self) -> Result<(), QueryEvaluationError> {
        self.0.check()
    }

    pub(crate) fn charge(&self) -> Result<(), QueryEvaluationError> {
        self.0.charge()
    }
}

/// An explicit, shared, cumulative native `ORDER BY` sort-buffer row budget.
///
/// Clones share the same counter and sticky failure. Create a fresh budget for
/// an independent request; reusing an evaluator does not reset its budget.
/// Every successful child tuple admitted to a native sort buffer (including
/// duplicates and repeated/nested `ORDER BY` invocations) is charged before
/// its decoded sort-key vector is built and before it is inserted into the
/// destination buffer. `ORDER BY` expressions may already have been evaluated
/// by an upstream extend operator; that earlier expression work and its
/// allocations are not charged. An attempted row beyond the limit fails the
/// budget permanently; reaching the limit exactly is not failure, and omitting
/// `ORDER BY` charges nothing.
///
/// This does not bound row width, comparator work, other operator buffers,
/// planning, inference, foreign SERVICE work, or process memory/CPU.
#[derive(Debug, Clone)]
pub struct SortBufferBudget(Arc<RowBudgetState>);

impl SortBufferBudget {
    #[must_use]
    pub fn new(limit: u64) -> Self {
        Self(RowBudgetState::new(
            QueryResource::SortBufferRows,
            QueryResourcePhase::SortBuffer,
            limit,
        ))
    }

    #[must_use]
    pub fn limit(&self) -> u64 {
        self.0.limit
    }

    /// Successfully admitted sort-buffer rows, never greater than the limit.
    #[must_use]
    pub fn charged_rows(&self) -> u64 {
        self.0.charged_rows()
    }

    /// Checks the sticky failure, without consuming a row or resetting it.
    pub fn check(&self) -> Result<(), QueryEvaluationError> {
        self.0.check()
    }

    pub(crate) fn charge(&self) -> Result<(), QueryEvaluationError> {
        self.0.charge()
    }
}

/// An explicit, shared, cumulative native `DISTINCT` retained-row budget.
///
/// Clones share the same counter and sticky failure. Create a fresh budget for
/// an independent request; reusing an evaluator does not reset its budget.
/// Every tuple newly retained by a native hash `DISTINCT` operator (including
/// repeated/nested operators and prepared re-executions) is charged before it
/// is cloned into that operator's set. A successful duplicate of an already
/// retained tuple is not charged again. An attempted unique tuple beyond the
/// limit fails the budget permanently; reaching the limit exactly is not
/// failure, and work without a native `DISTINCT` operator charges nothing.
/// The bounded path never reserves capacity from the child's size hint.
///
/// This counts the physical operator the planner emits, whether the surface
/// syntax was `DISTINCT` or `REDUCED`; an operator the planner removes as
/// redundant retains nothing and charges nothing. It does not bound child row
/// creation, row width, hashing/comparison work, allocator capacity, aggregate
/// `DISTINCT` accumulators, group buffers, property-path or dataset
/// deduplication, planning, inference, foreign SERVICE work, or process
/// memory/CPU.
#[derive(Debug, Clone)]
pub struct DistinctBufferBudget(Arc<RowBudgetState>);

impl DistinctBufferBudget {
    #[must_use]
    pub fn new(limit: u64) -> Self {
        Self(RowBudgetState::new(
            QueryResource::DistinctBufferRows,
            QueryResourcePhase::DistinctBuffer,
            limit,
        ))
    }

    #[must_use]
    pub fn limit(&self) -> u64 {
        self.0.limit
    }

    /// Successfully retained unique tuples, never greater than the limit.
    #[must_use]
    pub fn charged_rows(&self) -> u64 {
        self.0.charged_rows()
    }

    /// Checks the sticky failure, without consuming a row or resetting it.
    pub fn check(&self) -> Result<(), QueryEvaluationError> {
        self.0.check()
    }

    pub(crate) fn charge(&self) -> Result<(), QueryEvaluationError> {
        self.0.charge()
    }
}

/// An explicit, shared, cumulative native accumulator-group budget.
///
/// Each new group is charged before its accumulators are constructed and the
/// group is inserted. Repeated keys within one group map do not charge again.
/// A global aggregate creates one empty-key group even on empty input, so a
/// zero limit rejects it before reading its child. Empty keyed input creates
/// no groups. Reaching the limit exactly succeeds until another group is tried.
///
/// Clones, nested groups and prepared re-executions share the counter and sticky
/// failure. Create a fresh budget for each independent request. Only physical
/// grouping operators count; eliminated operators and ungrouped work do not.
/// This does not bound child/key creation or width, per-group aggregate DISTINCT
/// sets, GROUP_CONCAT contents, hashing or accumulator CPU, allocator capacity,
/// other buffers, inference, foreign SERVICE work, or process memory.
#[derive(Debug, Clone)]
pub struct GroupBufferBudget(Arc<RowBudgetState>);

impl GroupBufferBudget {
    #[must_use]
    pub fn new(limit: u64) -> Self {
        Self(RowBudgetState::new(
            QueryResource::GroupBufferRows,
            QueryResourcePhase::GroupBuffer,
            limit,
        ))
    }

    #[must_use]
    pub fn limit(&self) -> u64 {
        self.0.limit
    }

    /// Successfully admitted groups, never greater than the limit.
    #[must_use]
    pub fn charged_rows(&self) -> u64 {
        self.0.charged_rows()
    }

    /// Checks the sticky failure without consuming a group or resetting it.
    pub fn check(&self) -> Result<(), QueryEvaluationError> {
        self.0.check()
    }

    pub(crate) fn charge(&self) -> Result<(), QueryEvaluationError> {
        self.0.charge()
    }
}

/// An explicit, shared, cumulative native aggregate-`DISTINCT` key budget.
///
/// Each unique value or tuple retained by one native aggregate `DISTINCT` set
/// is charged before it is cloned or inserted. Duplicates in that set do not
/// charge again, while another aggregate set retaining the same key does.
/// Clones, nested groups and prepared re-executions share the counter and
/// sticky failure. Create a fresh budget for each independent request.
///
/// This does not bound expression evaluation, accumulator contents,
/// `GROUP_CONCAT` growth, row width, hashing, comparator or accumulator CPU,
/// allocator capacity, other buffers, inference, foreign SERVICE work, or
/// process memory.
#[derive(Debug, Clone)]
pub struct AggregateDistinctBudget(Arc<RowBudgetState>);

impl AggregateDistinctBudget {
    #[must_use]
    pub fn new(limit: u64) -> Self {
        Self(RowBudgetState::new(
            QueryResource::AggregateDistinctRows,
            QueryResourcePhase::AggregateDistinct,
            limit,
        ))
    }

    #[must_use]
    pub fn limit(&self) -> u64 {
        self.0.limit
    }

    /// Successfully retained aggregate-`DISTINCT` keys, never above the limit.
    #[must_use]
    pub fn charged_rows(&self) -> u64 {
        self.0.charged_rows()
    }

    /// Checks the sticky failure without consuming a key or resetting it.
    pub fn check(&self) -> Result<(), QueryEvaluationError> {
        self.0.check()
    }

    pub(crate) fn charge(&self) -> Result<(), QueryEvaluationError> {
        self.0.charge()
    }
}

/// An explicit, shared, cumulative native property-path buffer-entry budget.
///
/// Every insertion into a path-owned deduplication/visited set or closure
/// worklist is charged before retention. A key retained in both a visited set
/// and a worklist counts twice. Initial worklist duplicates count separately;
/// duplicates in a set do not. Clones, repeated/nested paths and prepared
/// executions share the counter and sticky failure. Use a fresh handle for an
/// independent request. Omitting the handle preserves the original path.
///
/// This does not bound term width, source-iterator/expression temporaries,
/// scans, streaming path sequences, hashing, allocator capacity, other
/// operator buffers, inference, foreign SERVICE work, process memory or CPU.
#[derive(Debug, Clone)]
pub struct PathBufferBudget(Arc<RowBudgetState>);

impl PathBufferBudget {
    #[must_use]
    pub fn new(limit: u64) -> Self {
        Self(RowBudgetState::new(
            QueryResource::PathBufferRows,
            QueryResourcePhase::PathBuffer,
            limit,
        ))
    }

    #[must_use]
    pub fn limit(&self) -> u64 {
        self.0.limit
    }

    /// Cumulative successful entry charges, never above the limit.
    #[must_use]
    pub fn charged_rows(&self) -> u64 {
        self.0.charged_rows()
    }

    /// Checks the sticky failure without consuming or resetting a charge.
    pub fn check(&self) -> Result<(), QueryEvaluationError> {
        self.0.check()
    }

    pub(crate) fn charge(&self) -> Result<(), QueryEvaluationError> {
        self.0.charge()
    }
}

/// Every optional cooperative budget one evaluator carries. Checks keep the
/// existing precedence: inner-join, sort, distinct, group, then aggregate
/// distinct failures, followed by property-path buffer failures.
#[derive(Debug, Clone, Default)]
pub(crate) struct ResourceBudgets {
    inner_join_build: Option<InnerJoinBuildBudget>,
    sort_buffer: Option<SortBufferBudget>,
    distinct_buffer: Option<DistinctBufferBudget>,
    group_buffer: Option<GroupBufferBudget>,
    aggregate_distinct: Option<AggregateDistinctBudget>,
    path_buffer: Option<PathBufferBudget>,
}

impl ResourceBudgets {
    pub(crate) fn new(
        inner_join_build: Option<InnerJoinBuildBudget>,
        sort_buffer: Option<SortBufferBudget>,
        distinct_buffer: Option<DistinctBufferBudget>,
        group_buffer: Option<GroupBufferBudget>,
        aggregate_distinct: Option<AggregateDistinctBudget>,
    ) -> Self {
        Self {
            inner_join_build,
            sort_buffer,
            distinct_buffer,
            group_buffer,
            aggregate_distinct,
            path_buffer: None,
        }
    }

    pub(crate) fn with_path_buffer(mut self, budget: Option<PathBufferBudget>) -> Self {
        self.path_buffer = budget;
        self
    }

    pub(crate) fn path_buffer(&self) -> Option<&PathBufferBudget> {
        self.path_buffer.as_ref()
    }

    pub(crate) fn inner_join_build(&self) -> Option<&InnerJoinBuildBudget> {
        self.inner_join_build.as_ref()
    }

    pub(crate) fn sort_buffer(&self) -> Option<&SortBufferBudget> {
        self.sort_buffer.as_ref()
    }

    pub(crate) fn distinct_buffer(&self) -> Option<&DistinctBufferBudget> {
        self.distinct_buffer.as_ref()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.inner_join_build.is_none()
            && self.sort_buffer.is_none()
            && self.distinct_buffer.is_none()
            && self.group_buffer.is_none()
            && self.aggregate_distinct.is_none()
            && self.path_buffer.is_none()
    }

    pub(crate) fn group_buffer(&self) -> Option<&GroupBufferBudget> {
        self.group_buffer.as_ref()
    }

    pub(crate) fn aggregate_distinct(&self) -> Option<&AggregateDistinctBudget> {
        self.aggregate_distinct.as_ref()
    }

    pub(crate) fn check(&self) -> Result<(), QueryEvaluationError> {
        if let Some(budget) = &self.inner_join_build {
            budget.check()?;
        }
        if let Some(budget) = &self.sort_buffer {
            budget.check()?;
        }
        if let Some(budget) = &self.distinct_buffer {
            budget.check()?;
        }
        if let Some(budget) = &self.group_buffer {
            budget.check()?;
        }
        if let Some(budget) = &self.aggregate_distinct {
            budget.check()?;
        }
        if let Some(budget) = &self.path_buffer {
            budget.check()?;
        }
        Ok(())
    }
}

/// Check after `next` as well: expressions and SILENT handlers may swallow an
/// inner error or return EOF after triggering the shared latch.
pub(crate) fn budgeted_iter<T>(
    mut iter: impl Iterator<Item = Result<T, QueryEvaluationError>>,
    budgets: ResourceBudgets,
) -> impl Iterator<Item = Result<T, QueryEvaluationError>> {
    let mut finished = false;
    std::iter::from_fn(move || {
        if finished {
            return None;
        }
        if let Err(error) = budgets.check() {
            finished = true;
            return Some(Err(error));
        }
        let item = iter.next();
        if let Err(error) = budgets.check() {
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
    fn path_budget_is_typed_shared_and_checked_after_existing_budgets() {
        let path = PathBufferBudget::new(1);
        let clone = path.clone();
        let only = ResourceBudgets::default().with_path_buffer(Some(path.clone()));
        assert!(!only.is_empty());
        only.check().unwrap();
        path.charge().unwrap();
        assert_eq!(clone.charged_rows(), 1);
        assert!(clone.charge().is_err());
        assert!(matches!(
            only.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::PathBufferRows,
                phase: QueryResourcePhase::PathBuffer,
                limit: 1,
            })
        ));
        let aggregate = AggregateDistinctBudget::new(0);
        let budgets = ResourceBudgets::new(None, None, None, None, Some(aggregate.clone()))
            .with_path_buffer(Some(path));
        assert!(aggregate.charge().is_err());
        assert!(matches!(
            budgets.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::AggregateDistinctRows,
                ..
            })
        ));
        assert_eq!(
            QueryResource::PathBufferRows.to_string(),
            "path_buffer_rows"
        );
        assert_eq!(QueryResourcePhase::PathBuffer.to_string(), "path_buffer");
        let max = PathBufferBudget::new(u64::MAX);
        max.0.charged.store(u64::MAX - 1, Ordering::Release);
        max.charge().unwrap();
        assert!(max.charge().is_err());
        assert_eq!(max.charged_rows(), u64::MAX);
    }

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

    #[test]
    fn sort_budget_is_typed_shared_and_independent_of_the_join_budget() {
        let sort = SortBufferBudget::new(1);
        let clone = sort.clone();
        assert_eq!(sort.limit(), 1);
        sort.charge().unwrap();
        clone.check().unwrap();
        assert_eq!(clone.charged_rows(), 1);
        assert!(matches!(
            clone.charge(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::SortBufferRows,
                phase: QueryResourcePhase::SortBuffer,
                limit: 1,
            })
        ));
        assert!(sort.check().is_err());
        assert_eq!(sort.charged_rows(), 1);
        let zero = SortBufferBudget::new(0);
        zero.check().unwrap();
        assert!(zero.charge().is_err());
        let join = InnerJoinBuildBudget::new(0);
        join.check().unwrap();
        let budgets = ResourceBudgets::new(Some(join.clone()), Some(sort), None, None, None);
        assert!(!budgets.is_empty());
        assert!(matches!(
            budgets.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::SortBufferRows,
                ..
            })
        ));
        assert!(join.charge().is_err());
        assert!(matches!(
            budgets.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::InnerJoinBuildRows,
                ..
            })
        ));
        assert!(ResourceBudgets::default().is_empty());
        ResourceBudgets::default().check().unwrap();
    }

    #[test]
    fn distinct_budget_is_typed_shared_and_checked_after_join_and_sort() {
        let distinct = DistinctBufferBudget::new(1);
        let clone = distinct.clone();
        assert_eq!(distinct.limit(), 1);
        distinct.charge().unwrap();
        clone.check().unwrap();
        assert_eq!(clone.charged_rows(), 1);
        assert!(matches!(
            clone.charge(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::DistinctBufferRows,
                phase: QueryResourcePhase::DistinctBuffer,
                limit: 1,
            })
        ));
        assert!(distinct.check().is_err());
        assert_eq!(distinct.charged_rows(), 1);
        assert_eq!(
            QueryResource::DistinctBufferRows.to_string(),
            "distinct_buffer_rows"
        );
        assert_eq!(
            QueryResourcePhase::DistinctBuffer.to_string(),
            "distinct_buffer"
        );
        let zero = DistinctBufferBudget::new(0);
        zero.check().unwrap();
        assert!(zero.charge().is_err());
        // A distinct-only set is not empty, and a distinct failure is reported
        // only when the join and sort handles are intact.
        let join = InnerJoinBuildBudget::new(0);
        let sort = SortBufferBudget::new(0);
        let budgets = ResourceBudgets::new(
            Some(join.clone()),
            Some(sort.clone()),
            Some(distinct),
            None,
            None,
        );
        assert!(!budgets.is_empty());
        assert!(matches!(
            budgets.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::DistinctBufferRows,
                ..
            })
        ));
        assert!(sort.charge().is_err());
        assert!(matches!(
            budgets.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::SortBufferRows,
                ..
            })
        ));
        assert!(join.charge().is_err());
        assert!(matches!(
            budgets.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::InnerJoinBuildRows,
                ..
            })
        ));
        let only = ResourceBudgets::new(None, None, Some(DistinctBufferBudget::new(0)), None, None);
        assert!(!only.is_empty());
        only.check().unwrap();
    }

    #[test]
    fn group_budget_is_typed_shared_and_checked_after_distinct() {
        let group = GroupBufferBudget::new(1);
        let clone = group.clone();
        group.charge().unwrap();
        clone.check().unwrap();
        assert_eq!(clone.limit(), 1);
        assert_eq!(clone.charged_rows(), 1);
        assert!(clone.charge().is_err());
        let budgets = ResourceBudgets::new(None, None, None, Some(group), None);
        assert!(!budgets.is_empty());
        assert!(matches!(
            budgets.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::GroupBufferRows,
                phase: QueryResourcePhase::GroupBuffer,
                limit: 1,
            })
        ));
        let distinct = DistinctBufferBudget::new(0);
        let budgets = ResourceBudgets::new(None, None, Some(distinct.clone()), Some(clone), None);
        assert!(distinct.charge().is_err());
        assert!(matches!(
            budgets.check(),
            Err(QueryEvaluationError::ResourceLimitExceeded {
                resource: QueryResource::DistinctBufferRows,
                ..
            })
        ));
        assert_eq!(
            QueryResource::GroupBufferRows.to_string(),
            "group_buffer_rows"
        );
        assert_eq!(QueryResourcePhase::GroupBuffer.to_string(), "group_buffer");
    }
}
