//! Explicit, opt-in analytical execution of one local basic graph pattern.
//!
//! This is the ADR-0033 research path. It is never selected by `on_store` or
//! any default executor, and there is no automatic mode. An eligible SELECT is
//! answered by leapfrog intersection over one retained Store snapshot: on
//! RocksDB every pattern is an ordered prefix-seek descriptor of an existing
//! quad index, on the in-memory backend a bounded, sorted transient relation.
//!
//! A deterministic variable order is chosen before any row. On RocksDB every
//! pattern must have a compatible existing index order, otherwise the attempt
//! is declined. Capability declines use the declared [`AnalyticalFallback`] on
//! the SAME snapshot. Budget, deadline and cancellation stops are always typed
//! failures: they never start the standard executor, which would run without
//! the analytical ceilings. The first binding is searched before the stream is
//! returned, so every stop before the first row follows that pre-stream policy.
//! Once a row has been returned no fallback happens and nothing is replayed;
//! in particular a stored RDF 1.2 triple term met later by a native seek fails
//! the stream with a typed refusal.

use super::dataset::DatasetView;
use super::{
    PreparedSparqlQuery, QueryEvaluationError, QueryResults, QuerySolution, QuerySolutionIter,
};
use crate::model::{Term, Variable};
use crate::storage::analytical::{AccessError, Control, Key, Limit, Position, Relation};
use crate::storage::numeric_encoder::{Decoder, EncodedTerm, StrHash};
use crate::storage::{CorruptionError, StorageError, StorageReader};
use crate::store::evaluation_metrics::{EvaluationObservation, observe_query_result};
use crate::store::{EvaluationOperation, Store};
use oxstr::OxString;
use spareval::{CancellationReason, CancellationToken, QueryEvaluator};
use spargebra::algebra::QueryExpression as AlQueryExpression;
use spargebra::term::{BlankNode, GroundTermPattern, NamedNode, NamedNodePattern, TermPattern};
use spargebra::{Query, SparqlVersion};
use sparopt::algebra::{JoinAlgorithm, QueryExpression};
use sparopt::{AnalyticalEligibility, AnalyticalEligibilityLimits, AnalyticalEligibilityOutcome};
use std::cmp::Reverse;
use std::collections::HashMap;
use std::fmt;
use std::mem::{size_of, take};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

const MAX_PATTERNS: usize = 16;
const MAX_VARIABLES: usize = 8;
/// Projected variables, bound or not, accepted before any allocation.
const MAX_PROJECTED: usize = 64;
const DEFAULT_ORDER_SEARCH_NODES: u32 = 4096;
/// Charged per decoded term on top of its dictionary strings: inline strings,
/// lexical forms of native literals and well-known datatype IRIs.
const TERM_OVERHEAD: usize = 128;

type Alive = Box<dyn FnMut() -> bool>;

#[cfg(test)]
mod tests;

/// Whether the analytical operator may be attempted at all.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalExecutionMode {
    /// Standard evaluation only; the stable default.
    #[default]
    Disabled,
    /// Attempt the analytical operator for an eligible query.
    Explicit,
}

/// Declared disposition when an explicit attempt is declined for a capability
/// reason before any row. Budget, deadline and cancellation stops are never
/// declines and never use this policy.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum AnalyticalFallback {
    /// Evaluate with the standard executor on the same retained snapshot.
    #[default]
    Standard,
    /// Return a typed [`AnalyticalExecutionError`] instead.
    Refuse,
}

/// A rejected analytical limit or strategy.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[non_exhaustive]
pub enum AnalyticalLimitsError {
    #[error("analytical max_patterns must be between 1 and 16")]
    Patterns,
    #[error("analytical max_variables must be between 1 and 8")]
    Variables,
    #[error("analytical max_rows_per_relation must be positive")]
    RelationRows,
    #[error("analytical max_materialized_bytes must be positive")]
    MaterializedBytes,
    #[error("analytical max_work must be positive")]
    Work,
    #[error("analytical max_output_rows must be positive")]
    OutputRows,
    #[error("analytical max_wall_time must be positive")]
    WallTime,
    #[error("analytical variable order must be a permutation of 1 to 8 distinct positions below 8")]
    VariableOrder,
    #[error("analytical max_search_nodes must be positive")]
    OrderSearch,
}

/// Explicit positive ceilings of one analytical execution.
///
/// Materialized relations grow geometrically, each growth charged against
/// `max_materialized_bytes` before allocation, together with the plan, cursor
/// state and the row being returned. These are requested allocation and work
/// counters, not process RSS, native snapshot memory or CPU quotas. The wall
/// time starts when `execute` is called and includes slow consumers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AnalyticalExecutionLimits {
    patterns: usize,
    variables: usize,
    relation_rows: usize,
    materialized_bytes: usize,
    work: u64,
    output_rows: u64,
    wall_time: Duration,
}

impl AnalyticalExecutionLimits {
    pub fn new(
        max_patterns: usize,
        max_variables: usize,
        max_rows_per_relation: usize,
        max_materialized_bytes: usize,
        max_work: u64,
        max_output_rows: u64,
        max_wall_time: Duration,
    ) -> Result<Self, AnalyticalLimitsError> {
        if !(1..=MAX_PATTERNS).contains(&max_patterns) {
            return Err(AnalyticalLimitsError::Patterns);
        }
        if !(1..=MAX_VARIABLES).contains(&max_variables) {
            return Err(AnalyticalLimitsError::Variables);
        }
        if max_rows_per_relation == 0 {
            return Err(AnalyticalLimitsError::RelationRows);
        }
        if max_materialized_bytes == 0 {
            return Err(AnalyticalLimitsError::MaterializedBytes);
        }
        if max_work == 0 {
            return Err(AnalyticalLimitsError::Work);
        }
        if max_output_rows == 0 {
            return Err(AnalyticalLimitsError::OutputRows);
        }
        if max_wall_time.is_zero() {
            return Err(AnalyticalLimitsError::WallTime);
        }
        Ok(Self {
            patterns: max_patterns,
            variables: max_variables,
            relation_rows: max_rows_per_relation,
            materialized_bytes: max_materialized_bytes,
            work: max_work,
            output_rows: max_output_rows,
            wall_time: max_wall_time,
        })
    }

    /// Field-wise minimum; a policy ceiling can only reduce these limits.
    #[must_use]
    pub fn restricted_to(self, ceiling: Self) -> Self {
        Self {
            patterns: self.patterns.min(ceiling.patterns),
            variables: self.variables.min(ceiling.variables),
            relation_rows: self.relation_rows.min(ceiling.relation_rows),
            materialized_bytes: self.materialized_bytes.min(ceiling.materialized_bytes),
            work: self.work.min(ceiling.work),
            output_rows: self.output_rows.min(ceiling.output_rows),
            wall_time: self.wall_time.min(ceiling.wall_time),
        }
    }

    pub const fn max_patterns(self) -> usize {
        self.patterns
    }

    pub const fn max_variables(self) -> usize {
        self.variables
    }

    pub const fn max_rows_per_relation(self) -> usize {
        self.relation_rows
    }

    pub const fn max_materialized_bytes(self) -> usize {
        self.materialized_bytes
    }

    pub const fn max_work(self) -> u64 {
        self.work
    }

    pub const fn max_output_rows(self) -> u64 {
        self.output_rows
    }

    pub const fn max_wall_time(self) -> Duration {
        self.wall_time
    }
}

/// Kind of a variable-order strategy, for reports.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalVariableOrderKind {
    FirstOccurrence,
    Explicit,
    IndexAware,
}

/// Deterministic choice of the global variable order of the search.
///
/// Variables are numbered by first occurrence in the basic graph pattern:
/// subject, predicate then object of each pattern in textual order, each
/// blank-node label being one variable. Positions never contain RDF terms.
/// On RocksDB every pattern needs an existing index ordering its graph, its
/// constants, then its variables in the chosen order; otherwise the attempt is
/// declined before any row. The in-memory backend accepts any order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AnalyticalVariableOrder(OrderStrategy);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OrderStrategy {
    FirstOccurrence,
    Explicit {
        positions: [u8; MAX_VARIABLES],
        len: u8,
    },
    IndexAware {
        max_search_nodes: u32,
    },
}

const DEFAULT_ORDER: AnalyticalVariableOrder = AnalyticalVariableOrder(OrderStrategy::IndexAware {
    max_search_nodes: DEFAULT_ORDER_SEARCH_NODES,
});

impl AnalyticalVariableOrder {
    /// The first-occurrence order, without any search.
    pub const fn first_occurrence() -> Self {
        Self(OrderStrategy::FirstOccurrence)
    }

    /// An explicit permutation of first-occurrence positions. It must cover
    /// exactly the variables of the pattern, otherwise the attempt is declined.
    pub fn explicit(positions: &[usize]) -> Result<Self, AnalyticalLimitsError> {
        if positions.is_empty() || positions.len() > MAX_VARIABLES {
            return Err(AnalyticalLimitsError::VariableOrder);
        }
        let mut seen = 0_u16;
        let mut ordered = [0; MAX_VARIABLES];
        for (slot, position) in ordered.iter_mut().zip(positions) {
            if *position >= MAX_VARIABLES || seen & (1 << *position) != 0 {
                return Err(AnalyticalLimitsError::VariableOrder);
            }
            seen |= 1 << *position;
            *slot = u8::try_from(*position).map_err(|_| AnalyticalLimitsError::VariableOrder)?;
        }
        Ok(Self(OrderStrategy::Explicit {
            positions: ordered,
            len: u8::try_from(positions.len()).map_err(|_| AnalyticalLimitsError::VariableOrder)?,
        }))
    }

    /// Depth-first search over variable permutations, in decreasing number of
    /// patterns per variable then first occurrence, pruned as soon as a pattern
    /// has no compatible index order. Every visited node and compatibility
    /// check is charged as work; state is fixed-size. Visiting more than
    /// `max_search_nodes` nodes declines the attempt; this cap depends only on
    /// the query shape and backend, never on data.
    pub fn index_aware(max_search_nodes: u32) -> Result<Self, AnalyticalLimitsError> {
        if max_search_nodes == 0 {
            return Err(AnalyticalLimitsError::OrderSearch);
        }
        Ok(Self(OrderStrategy::IndexAware { max_search_nodes }))
    }

    pub const fn kind(self) -> AnalyticalVariableOrderKind {
        match self.0 {
            OrderStrategy::FirstOccurrence => AnalyticalVariableOrderKind::FirstOccurrence,
            OrderStrategy::Explicit { .. } => AnalyticalVariableOrderKind::Explicit,
            OrderStrategy::IndexAware { .. } => AnalyticalVariableOrderKind::IndexAware,
        }
    }

    pub fn explicit_positions(&self) -> Option<&[u8]> {
        match &self.0 {
            OrderStrategy::Explicit { positions, len } => Some(&positions[..usize::from(*len)]),
            _ => None,
        }
    }

    pub const fn max_search_nodes(self) -> Option<u32> {
        match self.0 {
            OrderStrategy::IndexAware { max_search_nodes } => Some(max_search_nodes),
            _ => None,
        }
    }
}

impl Default for AnalyticalVariableOrder {
    /// Index-aware search with 4096 nodes.
    fn default() -> Self {
        DEFAULT_ORDER
    }
}

/// Explicit analytical execution configuration. There is no automatic mode.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AnalyticalExecutionOptions {
    limits: Option<AnalyticalExecutionLimits>,
    fallback: AnalyticalFallback,
    variable_order: AnalyticalVariableOrder,
}

impl AnalyticalExecutionOptions {
    /// Standard evaluation only.
    pub const fn disabled() -> Self {
        Self {
            limits: None,
            fallback: AnalyticalFallback::Standard,
            variable_order: DEFAULT_ORDER,
        }
    }

    /// Attempt the analytical operator within `limits`.
    pub const fn explicit(limits: AnalyticalExecutionLimits) -> Self {
        Self {
            limits: Some(limits),
            fallback: AnalyticalFallback::Standard,
            variable_order: DEFAULT_ORDER,
        }
    }

    #[must_use]
    pub const fn with_fallback(mut self, fallback: AnalyticalFallback) -> Self {
        self.fallback = fallback;
        self
    }

    #[must_use]
    pub const fn with_variable_order(mut self, variable_order: AnalyticalVariableOrder) -> Self {
        self.variable_order = variable_order;
        self
    }

    /// These options reduced by a policy: disabled if either is disabled,
    /// field-wise minimum limits, refusal if either refuses, and the smaller
    /// index-aware search cap. A policy can never grant more.
    #[must_use]
    pub fn restricted_by(self, policy: Self) -> Self {
        let limits = match (self.limits, policy.limits) {
            (Some(own), Some(ceiling)) => Some(own.restricted_to(ceiling)),
            _ => None,
        };
        let fallback = if self.fallback == AnalyticalFallback::Refuse
            || policy.fallback == AnalyticalFallback::Refuse
        {
            AnalyticalFallback::Refuse
        } else {
            AnalyticalFallback::Standard
        };
        let variable_order = match (self.variable_order.0, policy.variable_order.0) {
            (
                OrderStrategy::IndexAware {
                    max_search_nodes: own,
                },
                OrderStrategy::IndexAware {
                    max_search_nodes: ceiling,
                },
            ) => AnalyticalVariableOrder(OrderStrategy::IndexAware {
                max_search_nodes: own.min(ceiling),
            }),
            _ => self.variable_order,
        };
        Self {
            limits,
            fallback,
            variable_order,
        }
    }

    pub const fn mode(self) -> AnalyticalExecutionMode {
        if self.limits.is_some() {
            AnalyticalExecutionMode::Explicit
        } else {
            AnalyticalExecutionMode::Disabled
        }
    }

    pub const fn fallback(self) -> AnalyticalFallback {
        self.fallback
    }

    pub const fn limits(self) -> Option<AnalyticalExecutionLimits> {
        self.limits
    }

    pub const fn variable_order(self) -> AnalyticalVariableOrder {
        self.variable_order
    }
}

/// The analytical ceiling that stopped an execution.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalBudget {
    RelationRows,
    MaterializedBytes,
    Work,
    OutputRows,
    WallTime,
}

impl fmt::Display for AnalyticalBudget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::RelationRows => "relation_rows",
            Self::MaterializedBytes => "materialized_bytes",
            Self::Work => "work",
            Self::OutputRows => "output_rows",
            Self::WallTime => "wall_time",
        })
    }
}

/// Bounded, term-free reason for a disposition.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalReason {
    Disabled,
    NotSelect,
    QueryDataset,
    Substitutions,
    Version,
    ResourceBudgets,
    UnsupportedAlgebra,
    VariableGraph,
    TripleTerm,
    TooManyPatterns,
    TooManyVariables,
    TooManyProjected,
    Ineligible,
    EligibilityBudget,
    UnsupportedTerm,
    UnsupportedOrder,
    InvalidVariableOrder,
    OrderSearchBudget,
    Budget(AnalyticalBudget),
    Storage,
    Cancelled,
    TimedOut,
}

impl fmt::Display for AnalyticalReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Budget(budget) => return write!(f, "budget {budget}"),
            Self::Disabled => "disabled",
            Self::NotSelect => "not_select",
            Self::QueryDataset => "query_dataset",
            Self::Substitutions => "substitutions",
            Self::Version => "version",
            Self::ResourceBudgets => "resource_budgets",
            Self::UnsupportedAlgebra => "unsupported_algebra",
            Self::VariableGraph => "variable_graph",
            Self::TripleTerm => "triple_term",
            Self::TooManyPatterns => "too_many_patterns",
            Self::TooManyVariables => "too_many_variables",
            Self::TooManyProjected => "too_many_projected",
            Self::Ineligible => "ineligible",
            Self::EligibilityBudget => "eligibility_budget",
            Self::UnsupportedTerm => "unsupported_term",
            Self::UnsupportedOrder => "unsupported_order",
            Self::InvalidVariableOrder => "invalid_variable_order",
            Self::OrderSearchBudget => "order_search_budget",
            Self::Storage => "storage",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
        };
        f.write_str(text)
    }
}

/// Typed refusal or budget failure, boxed as [`QueryEvaluationError::Dataset`].
/// Wall-time expiry is reported as [`QueryEvaluationError::TimedOut`] instead.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[non_exhaustive]
pub enum AnalyticalExecutionError {
    #[error("analytical execution refused: {0}")]
    Refused(AnalyticalReason),
    #[error("analytical execution budget exceeded: {0}")]
    BudgetExceeded(AnalyticalBudget),
}

/// What happened to one bound execution.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
#[non_exhaustive]
pub enum AnalyticalDisposition {
    /// Not executed yet, or the mode is disabled.
    #[default]
    NotAttempted,
    /// Rows are produced by the analytical operator.
    Analytical,
    /// Declined for a capability reason before any row; the standard
    /// executor answered.
    Fallback,
    /// Declined for a capability reason before any row with a typed error.
    Refused,
    /// Budget, deadline, cancellation, storage failure, or any failure after
    /// streaming began. Never followed by the standard executor.
    Failed,
}

/// Term-free observation of one execution.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub struct AnalyticalExecutionSnapshot {
    pub disposition: AnalyticalDisposition,
    pub reason: Option<AnalyticalReason>,
    /// Basic graph pattern size, once planned.
    pub patterns: usize,
    /// Distinct variables including normalized blank nodes, once planned.
    pub variables: usize,
    /// Relations built, once the analytical stream is returned.
    pub relations: usize,
    /// Currently charged transient bytes: plan, relations, cursors, row.
    pub materialized_bytes: usize,
    /// Charged work units across planning, order search, seeks, search and
    /// output.
    pub work: u64,
    /// Analytical rows returned to the consumer.
    pub output_rows: u64,
    /// The analytical stream reached its end without error.
    pub completed: bool,
    /// Strategy that chose the variable order, once chosen.
    pub variable_order_kind: Option<AnalyticalVariableOrderKind>,
    /// Chosen order as first-occurrence positions; `variable_order_len` used.
    pub variable_order: [u8; MAX_VARIABLES],
    pub variable_order_len: usize,
    /// Candidate orders or search nodes examined.
    pub order_search_nodes: u64,
    /// Relation seeks issued by the intersection.
    pub seeks: u64,
}

impl Default for AnalyticalExecutionSnapshot {
    fn default() -> Self {
        Self {
            disposition: AnalyticalDisposition::NotAttempted,
            reason: None,
            patterns: 0,
            variables: 0,
            relations: 0,
            materialized_bytes: 0,
            work: 0,
            output_rows: 0,
            completed: false,
            variable_order_kind: None,
            variable_order: [0; MAX_VARIABLES],
            variable_order_len: 0,
            order_search_nodes: 0,
            seeks: 0,
        }
    }
}

/// Cloneable observation handle of one bound execution.
#[derive(Clone, Debug, Default)]
pub struct AnalyticalExecutionReport(Arc<Mutex<AnalyticalExecutionSnapshot>>);

impl AnalyticalExecutionReport {
    pub fn snapshot(&self) -> AnalyticalExecutionSnapshot {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn update(&self, change: impl FnOnce(&mut AnalyticalExecutionSnapshot)) {
        let mut guard = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        change(&mut guard);
    }

    fn finish(&self, disposition: AnalyticalDisposition, reason: AnalyticalReason) {
        self.update(|snapshot| {
            snapshot.disposition = disposition;
            snapshot.reason = Some(reason);
        });
    }

    fn charged<F: FnMut() -> bool>(&self, control: &Control<F>, seeks: u64) {
        self.update(|snapshot| {
            snapshot.work = control.work();
            snapshot.materialized_bytes = control.bytes();
            snapshot.seeks = seeks;
        });
    }
}

/// A prepared query explicitly bound to analytical execution on a [`Store`].
#[must_use]
pub struct BoundAnalyticalSparqlQuery {
    prepared: PreparedSparqlQuery,
    reader: StorageReader<'static>,
    options: AnalyticalExecutionOptions,
    report: AnalyticalExecutionReport,
    observation: Option<EvaluationObservation>,
}

impl PreparedSparqlQuery {
    /// The analytical options configured with
    /// `SparqlEvaluator::with_analytical_execution`; disabled by default.
    pub fn analytical_execution(&self) -> AnalyticalExecutionOptions {
        self.analytical
    }

    /// Binds this query to one retained [`Store`] snapshot with the analytical
    /// options configured on the evaluator. Disabled options evaluate with the
    /// standard executor. `on_store` and the default executor are unchanged.
    ///
    /// Only a SELECT projecting one basic graph pattern, optionally inside a
    /// constant `GRAPH` IRI, with the default dataset and no substitutions is
    /// attempted. Everything else is declined before any row is produced.
    pub fn on_store_analytical(self, store: &Store) -> BoundAnalyticalSparqlQuery {
        let options = self.analytical;
        self.bind_analytical(store, options)
    }

    /// Binds this query with `options` replacing the evaluator configuration
    /// for this binding only. Apply [`AnalyticalExecutionOptions::restricted_by`]
    /// first when a server policy must bound caller-supplied options.
    pub fn on_store_with_analytical(
        self,
        store: &Store,
        options: AnalyticalExecutionOptions,
    ) -> BoundAnalyticalSparqlQuery {
        self.bind_analytical(store, options)
    }

    #[cfg_attr(not(feature = "http-client"), expect(unused_mut))]
    fn bind_analytical(
        mut self,
        store: &Store,
        options: AnalyticalExecutionOptions,
    ) -> BoundAnalyticalSparqlQuery {
        let observation = store.start_evaluation_observation(EvaluationOperation::Query);
        #[cfg(feature = "http-client")]
        {
            self.evaluator =
                super::bind_store_service(self.evaluator, self.service_client.take(), store);
        }
        BoundAnalyticalSparqlQuery {
            reader: store.storage().snapshot(),
            prepared: self,
            options,
            report: AnalyticalExecutionReport::default(),
            observation: Some(observation),
        }
    }
}

impl BoundAnalyticalSparqlQuery {
    /// The observation handle of this execution.
    pub fn report(&self) -> AnalyticalExecutionReport {
        self.report.clone()
    }

    /// Evaluates the query. Only capability declines before the first row may
    /// use the fallback policy; budget, deadline and cancellation stops are
    /// typed failures and never start the standard executor.
    pub fn execute(self) -> Result<QueryResults<'static>, QueryEvaluationError> {
        let Self {
            prepared,
            reader,
            options,
            report,
            mut observation,
        } = self;
        if let Some(observation) = &mut observation {
            observation.begin();
        }
        let token = prepared.cancellation_token.clone();
        if let Some((error, reason)) = interrupted(token.as_ref()) {
            report.finish(AnalyticalDisposition::Failed, reason);
            return observe_query_result(Err(error), observation);
        }
        let Some(limits) = options.limits else {
            report.finish(
                AnalyticalDisposition::NotAttempted,
                AnalyticalReason::Disabled,
            );
            return standard(prepared, &reader, observation);
        };
        // An unrepresentable deadline is beyond any reachable instant.
        let deadline = Instant::now().checked_add(limits.wall_time);
        // One control for planning, order search, building, seeks, search and
        // output; never reset.
        let mut control = Control::new(
            limits.relation_rows,
            limits.materialized_bytes,
            limits.work,
            alive(token.clone(), deadline),
        );
        let outcome = attempt(
            &prepared,
            &reader,
            &limits,
            options.variable_order,
            &mut control,
            &report,
            token.as_ref(),
        );
        report.charged(&control, 0);
        let Attempt {
            order,
            width,
            relations,
            participants,
            projection,
            output,
        } = match outcome {
            Ok(started) => started,
            Err(stop) => {
                return conclude(
                    stop,
                    options.fallback,
                    prepared,
                    &reader,
                    &report,
                    observation,
                );
            }
        };
        let mut search = Search {
            reader,
            relations,
            participants,
            order,
            width,
            values: [None; MAX_VARIABLES],
            depth: 0,
            prefix: Vec::with_capacity(2),
            control,
            seeks: 0,
            exhausted: false,
        };
        // The first binding is found before the stream is returned: any stop
        // before the first row is decided under the pre-stream policy.
        let first = search.next_binding();
        report.charged(&search.control, search.seeks);
        match first {
            Ok(ready) => {
                let relations = search.relations.len();
                report.update(|snapshot| {
                    snapshot.disposition = AnalyticalDisposition::Analytical;
                    snapshot.reason = None;
                    snapshot.relations = relations;
                });
                let rows = AnalyticalRows {
                    search,
                    ready,
                    projection,
                    max_output_rows: limits.output_rows,
                    emitted: 0,
                    row_bytes: 0,
                    finished: false,
                    token,
                    report,
                };
                observe_query_result(
                    Ok(QueryResults::Solutions(QuerySolutionIter::from_tuples(
                        output, rows,
                    ))),
                    observation,
                )
            }
            Err(error) => {
                let stop = access_stop(error, token.as_ref());
                let Search { reader, .. } = search;
                conclude(
                    stop,
                    options.fallback,
                    prepared,
                    &reader,
                    &report,
                    observation,
                )
            }
        }
    }
}

/// Standard evaluation over the SAME retained snapshot, never a newer one.
fn standard(
    prepared: PreparedSparqlQuery,
    reader: &StorageReader<'static>,
    observation: Option<EvaluationObservation>,
) -> Result<QueryResults<'static>, QueryEvaluationError> {
    let mut bound = prepared.on_queryable_dataset(DatasetView::new(reader.clone_for_index_query()));
    bound.observation = observation;
    bound.execute()
}

/// Applies a pre-stream stop: failures are final, declines use the policy.
fn conclude(
    stop: Stop,
    fallback: AnalyticalFallback,
    prepared: PreparedSparqlQuery,
    reader: &StorageReader<'static>,
    report: &AnalyticalExecutionReport,
    observation: Option<EvaluationObservation>,
) -> Result<QueryResults<'static>, QueryEvaluationError> {
    match stop {
        Stop::Fatal(error, reason) => {
            report.finish(AnalyticalDisposition::Failed, reason);
            observe_query_result(Err(error), observation)
        }
        Stop::Decline(reason) => match fallback {
            AnalyticalFallback::Standard => {
                report.finish(AnalyticalDisposition::Fallback, reason);
                standard(prepared, reader, observation)
            }
            AnalyticalFallback::Refuse => {
                report.finish(AnalyticalDisposition::Refused, reason);
                observe_query_result(Err(refusal(reason)), observation)
            }
        },
    }
}

enum Stop {
    /// A capability decline before any row; the fallback policy applies.
    Decline(AnalyticalReason),
    /// Budget, deadline, cancellation or storage failure; never replaced by
    /// a fallback.
    Fatal(QueryEvaluationError, AnalyticalReason),
}

fn alive(token: Option<CancellationToken>, deadline: Option<Instant>) -> Alive {
    Box::new(move || {
        token.as_ref().is_none_or(|token| !token.is_cancelled())
            && deadline.is_none_or(|deadline| Instant::now() < deadline)
    })
}

fn interrupted(
    token: Option<&CancellationToken>,
) -> Option<(QueryEvaluationError, AnalyticalReason)> {
    Some(match token?.cancellation_reason()? {
        CancellationReason::Cancelled => {
            (QueryEvaluationError::Cancelled, AnalyticalReason::Cancelled)
        }
        CancellationReason::TimedOut => {
            (QueryEvaluationError::TimedOut, AnalyticalReason::TimedOut)
        }
    })
}

const fn budget(limit: Limit) -> AnalyticalBudget {
    match limit {
        Limit::Rows => AnalyticalBudget::RelationRows,
        Limit::Bytes => AnalyticalBudget::MaterializedBytes,
        Limit::Work => AnalyticalBudget::Work,
    }
}

/// Wall-time expiry is a deadline, observed like any other query deadline.
fn budget_error(budget: AnalyticalBudget) -> QueryEvaluationError {
    if budget == AnalyticalBudget::WallTime {
        QueryEvaluationError::TimedOut
    } else {
        QueryEvaluationError::Dataset(Box::new(AnalyticalExecutionError::BudgetExceeded(budget)))
    }
}

fn access_stop(error: AccessError, token: Option<&CancellationToken>) -> Stop {
    match error {
        AccessError::Storage(error) => Stop::Fatal(
            QueryEvaluationError::Dataset(Box::new(error)),
            AnalyticalReason::Storage,
        ),
        AccessError::Limit(limit) => {
            let budget = budget(limit);
            Stop::Fatal(budget_error(budget), AnalyticalReason::Budget(budget))
        }
        AccessError::Unsupported => Stop::Decline(AnalyticalReason::UnsupportedTerm),
        AccessError::UnsupportedOrder => Stop::Decline(AnalyticalReason::UnsupportedOrder),
        // Caller cancellation first; otherwise the analytical wall time expired.
        AccessError::Interrupted => interrupted(token).map_or_else(
            || {
                Stop::Fatal(
                    QueryEvaluationError::TimedOut,
                    AnalyticalReason::Budget(AnalyticalBudget::WallTime),
                )
            },
            |(error, reason)| Stop::Fatal(error, reason),
        ),
    }
}

fn refusal(reason: AnalyticalReason) -> QueryEvaluationError {
    match reason {
        AnalyticalReason::Budget(budget) => budget_error(budget),
        other => QueryEvaluationError::Dataset(Box::new(AnalyticalExecutionError::Refused(other))),
    }
}

/// After a row was returned every stop fails the stream; nothing is replayed.
fn stream_failure(
    error: AccessError,
    token: Option<&CancellationToken>,
) -> (QueryEvaluationError, AnalyticalReason) {
    match access_stop(error, token) {
        Stop::Fatal(error, reason) => (error, reason),
        Stop::Decline(reason) => (refusal(reason), reason),
    }
}

fn count(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

/// The standard executor validates every scanned term against the selected
/// mode. The analytical path only runs where that validation is a no-op.
fn version_supported(version: SparqlVersion) -> bool {
    version.is_supported() && (version == SparqlVersion::V1_2 || !cfg!(feature = "rdf-12"))
}

/// Analytical relations would not be charged to caller operator budgets.
fn has_resource_budgets(evaluator: &QueryEvaluator) -> bool {
    evaluator.inner_join_build_budget().is_some()
        || evaluator.sort_buffer_budget().is_some()
        || evaluator.distinct_buffer_budget().is_some()
        || evaluator.group_buffer_budget().is_some()
        || evaluator.aggregate_distinct_budget().is_some()
        || evaluator.path_buffer_budget().is_some()
        || evaluator.conditional_join_build_budget().is_some()
}

struct Plan {
    patterns: Vec<[Position; 3]>,
    graph: EncodedTerm,
    variable_count: usize,
    /// Per distinct projected variable, its local index if the pattern binds it.
    projection: Vec<Option<usize>>,
    output: Arc<[Variable]>,
    /// Charge of `patterns`, released once relations are built.
    pattern_bytes: usize,
}

#[derive(Default)]
struct Converter {
    blanks: HashMap<BlankNode, Variable>,
    indexes: HashMap<Variable, usize>,
}

impl Converter {
    fn variable(&mut self, variable: Variable) -> (GroundTermPattern, Position) {
        let next = self.indexes.len();
        let index = *self.indexes.entry(variable.clone()).or_insert(next);
        (
            GroundTermPattern::Variable(variable),
            Position::Variable(index),
        )
    }

    fn term(
        &mut self,
        term: &TermPattern,
    ) -> Result<(GroundTermPattern, Position), AnalyticalReason> {
        Ok(match term {
            TermPattern::NamedNode(node) => (
                GroundTermPattern::NamedNode(node.clone()),
                Position::Constant(EncodedTerm::from(node)),
            ),
            TermPattern::Literal(literal) => (
                GroundTermPattern::Literal(literal.clone()),
                Position::Constant(EncodedTerm::from(literal)),
            ),
            TermPattern::Variable(variable) => self.variable(variable.clone()),
            TermPattern::BlankNode(node) => {
                // One label is one variable across the whole BGP, so blank-node
                // joins are preserved. '#' cannot occur in a parsed variable.
                let next = self.blanks.len();
                let variable = self
                    .blanks
                    .entry(node.clone())
                    .or_insert_with(|| {
                        Variable::new_unchecked(OxString::new_owned(&format!(
                            "#analytical-blank-{next}"
                        )))
                    })
                    .clone();
                self.variable(variable)
            }
            #[cfg(feature = "rdf-12")]
            TermPattern::Triple(_) => return Err(AnalyticalReason::TripleTerm),
        })
    }

    fn predicate(&mut self, predicate: &NamedNodePattern) -> (NamedNodePattern, Position) {
        match predicate {
            NamedNodePattern::NamedNode(node) => (
                NamedNodePattern::NamedNode(node.clone()),
                Position::Constant(EncodedTerm::from(node)),
            ),
            NamedNodePattern::Variable(variable) => {
                let (_, position) = self.variable(variable.clone());
                (NamedNodePattern::Variable(variable.clone()), position)
            }
        }
    }
}

fn plan(
    prepared: &PreparedSparqlQuery,
    limits: &AnalyticalExecutionLimits,
    control: &mut Control<Alive>,
    token: Option<&CancellationToken>,
) -> Result<Plan, Stop> {
    let stop = move |error: AccessError| access_stop(error, token);
    let Query::Select(select) = &prepared.query else {
        return Err(Stop::Decline(AnalyticalReason::NotSelect));
    };
    if select.dataset.is_some() || !prepared.dataset.is_default_dataset() {
        return Err(Stop::Decline(AnalyticalReason::QueryDataset));
    }
    if !prepared.substitutions.is_empty() {
        return Err(Stop::Decline(AnalyticalReason::Substitutions));
    }
    if !version_supported(prepared.evaluator.version()) {
        return Err(Stop::Decline(AnalyticalReason::Version));
    }
    if has_resource_budgets(&prepared.evaluator) {
        return Err(Stop::Decline(AnalyticalReason::ResourceBudgets));
    }
    let AlQueryExpression::Project {
        inner,
        variables: projected,
    } = &select.expression
    else {
        return Err(Stop::Decline(AnalyticalReason::UnsupportedAlgebra));
    };
    let (graph, patterns): (Option<&NamedNode>, _) = match inner.as_ref() {
        AlQueryExpression::Bgp { patterns } => (None, patterns),
        AlQueryExpression::Graph {
            name: NamedNodePattern::NamedNode(graph),
            inner,
        } => {
            let AlQueryExpression::Bgp { patterns } = inner.as_ref() else {
                return Err(Stop::Decline(AnalyticalReason::UnsupportedAlgebra));
            };
            (Some(graph), patterns)
        }
        AlQueryExpression::Graph {
            name: NamedNodePattern::Variable(_),
            ..
        } => return Err(Stop::Decline(AnalyticalReason::VariableGraph)),
        _ => return Err(Stop::Decline(AnalyticalReason::UnsupportedAlgebra)),
    };
    // Bounded before any conversion or allocation proportional to the input.
    if projected.len() > MAX_PROJECTED {
        return Err(Stop::Decline(AnalyticalReason::TooManyProjected));
    }
    if patterns.len() > limits.patterns {
        return Err(Stop::Decline(AnalyticalReason::TooManyPatterns));
    }
    // Both counts are bounded above: none of these products can overflow.
    let pattern_bytes = patterns.len() * size_of::<[Position; 3]>();
    let transient_bytes = patterns.len()
        * (size_of::<QueryExpression>()
            + 3 * (size_of::<GroundTermPattern>()
                + size_of::<Variable>()
                + size_of::<BlankNode>()
                + size_of::<usize>()));
    let projection_bytes = projected.len() * (size_of::<Option<usize>>() + size_of::<Variable>());
    control
        .tick(1 + count(patterns.len()) + count(projected.len()))
        .map_err(stop)?;
    control
        .reserve(pattern_bytes + transient_bytes + projection_bytes)
        .map_err(stop)?;
    let mut converter = Converter::default();
    let mut positions = Vec::with_capacity(patterns.len());
    {
        let mut quads = Vec::with_capacity(patterns.len());
        for pattern in patterns {
            let (subject, subject_position) =
                converter.term(&pattern.subject).map_err(Stop::Decline)?;
            let (predicate, predicate_position) = converter.predicate(&pattern.predicate);
            let (object, object_position) =
                converter.term(&pattern.object).map_err(Stop::Decline)?;
            // The fixed GRAPH is pushed onto every pattern, as the optimizer does.
            quads.push(QueryExpression::QuadPattern {
                subject,
                predicate,
                object,
                graph_name: graph.map(|graph| NamedNodePattern::NamedNode(graph.clone())),
            });
            positions.push([subject_position, predicate_position, object_position]);
        }
        if converter.indexes.len() > limits.variables {
            return Err(Stop::Decline(AnalyticalReason::TooManyVariables));
        }
        let expression = quads
            .into_iter()
            .reduce(|left, right| QueryExpression::Join {
                left: Box::new(left),
                right: Box::new(right),
                algorithm: JoinAlgorithm::default(),
            })
            .ok_or(Stop::Decline(AnalyticalReason::Ineligible))?;
        let eligibility = AnalyticalEligibilityLimits::new(
            limits.patterns,
            limits.variables,
            2 * limits.patterns,
            limits.patterns + 1,
        )
        .map_err(|_| Stop::Decline(AnalyticalReason::Ineligible))?;
        match AnalyticalEligibility::new(eligibility)
            .examine(&expression)
            .outcome
        {
            AnalyticalEligibilityOutcome::Eligible => {}
            AnalyticalEligibilityOutcome::BudgetExceeded(_) => {
                return Err(Stop::Decline(AnalyticalReason::EligibilityBudget));
            }
            _ => return Err(Stop::Decline(AnalyticalReason::Ineligible)),
        }
    }
    control.release(transient_bytes);
    let variable_count = converter.indexes.len();
    if variable_count == 0 {
        return Err(Stop::Decline(AnalyticalReason::Ineligible));
    }
    // Output variables mirror the standard projection: first occurrence order,
    // each once. Solution multiplicity is never collapsed. The projection is
    // capped above, so the linear duplicate check is bounded.
    let mut output = Vec::with_capacity(projected.len());
    let mut projection = Vec::with_capacity(projected.len());
    for variable in projected {
        if !output.contains(variable) {
            projection.push(converter.indexes.get(variable).copied());
            output.push(variable.clone());
        }
    }
    Ok(Plan {
        patterns: positions,
        graph: graph.map_or(EncodedTerm::DefaultGraph, EncodedTerm::from),
        variable_count,
        projection,
        output: output.into(),
        pattern_bytes,
    })
}

/// Chooses the global variable order; every check is charged to `Control`.
struct OrderSearch<'a> {
    plan: &'a Plan,
    reader: &'a StorageReader<'static>,
    token: Option<&'a CancellationToken>,
    nodes: u64,
}

impl OrderSearch<'_> {
    fn choose(
        &mut self,
        strategy: AnalyticalVariableOrder,
        control: &mut Control<Alive>,
    ) -> Result<[usize; MAX_VARIABLES], Stop> {
        let width = self.plan.variable_count;
        let mut order = [0; MAX_VARIABLES];
        match strategy.0 {
            OrderStrategy::FirstOccurrence => {
                for (index, slot) in order.iter_mut().enumerate().take(width) {
                    *slot = index;
                }
                self.verify(&order[..width], control)?;
            }
            OrderStrategy::Explicit { positions, len } => {
                // Positions are distinct by construction: a length match with
                // every position in range makes a permutation.
                if usize::from(len) != width
                    || positions[..width]
                        .iter()
                        .any(|position| usize::from(*position) >= width)
                {
                    return Err(Stop::Decline(AnalyticalReason::InvalidVariableOrder));
                }
                for (slot, position) in order.iter_mut().zip(&positions[..width]) {
                    *slot = usize::from(*position);
                }
                self.verify(&order[..width], control)?;
            }
            OrderStrategy::IndexAware { max_search_nodes } => {
                order = self.search(max_search_nodes, control)?;
            }
        }
        Ok(order)
    }

    /// Whether one pattern has a compatible cursor for `order`, which covers
    /// all its variables. Charged, reads no data.
    fn supported(
        &self,
        pattern: usize,
        order: &[usize],
        control: &mut Control<Alive>,
    ) -> Result<bool, Stop> {
        control
            .tick(1)
            .map_err(|error| access_stop(error, self.token))?;
        Relation::supports_order(
            self.reader,
            &self.plan.patterns[pattern],
            &self.plan.graph,
            order,
        )
        .map_err(|error| access_stop(error, self.token))
    }

    fn verify(&mut self, order: &[usize], control: &mut Control<Alive>) -> Result<(), Stop> {
        self.nodes += 1;
        for pattern in 0..self.plan.patterns.len() {
            if !self.supported(pattern, order, control)? {
                return Err(Stop::Decline(AnalyticalReason::UnsupportedOrder));
            }
        }
        Ok(())
    }

    fn masks(&self) -> [u8; MAX_PATTERNS] {
        let mut masks = [0; MAX_PATTERNS];
        for (mask, pattern) in masks.iter_mut().zip(&self.plan.patterns) {
            for position in pattern {
                if let Position::Variable(variable) = position {
                    *mask |= 1_u8 << *variable;
                }
            }
        }
        masks
    }

    /// Iterative depth-first search in a fixed priority. A pattern is checked
    /// exactly once, when its last variable is placed: the restriction of any
    /// completion to its variables is then fixed, so pruning is exact.
    fn search(
        &mut self,
        max_search_nodes: u32,
        control: &mut Control<Alive>,
    ) -> Result<[usize; MAX_VARIABLES], Stop> {
        let width = self.plan.variable_count;
        let patterns = self.plan.patterns.len();
        let masks = self.masks();
        let mut priority = [0; MAX_VARIABLES];
        for (index, slot) in priority.iter_mut().enumerate().take(width) {
            *slot = index;
        }
        priority[..width].sort_unstable_by_key(|variable| {
            let bit = 1_u8 << *variable;
            (
                Reverse(
                    masks[..patterns]
                        .iter()
                        .filter(|mask| **mask & bit != 0)
                        .count(),
                ),
                *variable,
            )
        });
        let mut order = [0; MAX_VARIABLES];
        // Next index into `priority` to try at each depth.
        let mut next = [0; MAX_VARIABLES];
        let mut placed = 0_u8;
        let mut depth = 0;
        while depth < width {
            let mut chosen = false;
            while !chosen && next[depth] < width {
                let variable = priority[next[depth]];
                next[depth] += 1;
                let bit = 1_u8 << variable;
                if placed & bit != 0 {
                    continue;
                }
                self.nodes += 1;
                if self.nodes > u64::from(max_search_nodes) {
                    return Err(Stop::Decline(AnalyticalReason::OrderSearchBudget));
                }
                control
                    .tick(1)
                    .map_err(|error| access_stop(error, self.token))?;
                order[depth] = variable;
                let now = placed | bit;
                chosen = true;
                for (pattern, mask) in masks[..patterns].iter().enumerate() {
                    if mask & bit != 0
                        && mask & !now == 0
                        && !self.supported(pattern, &order[..=depth], control)?
                    {
                        chosen = false;
                        break;
                    }
                }
                if chosen {
                    placed = now;
                }
            }
            if chosen {
                depth += 1;
                if depth < width {
                    next[depth] = 0;
                }
            } else if depth == 0 {
                return Err(Stop::Decline(AnalyticalReason::UnsupportedOrder));
            } else {
                depth -= 1;
                placed &= !(1_u8 << order[depth]);
            }
        }
        Ok(order)
    }
}

fn order_report(order: &[usize]) -> [u8; MAX_VARIABLES] {
    let mut report = [0; MAX_VARIABLES];
    for (slot, variable) in report.iter_mut().zip(order) {
        *slot = u8::try_from(*variable).unwrap_or(u8::MAX);
    }
    report
}

struct Attempt {
    order: [usize; MAX_VARIABLES],
    width: usize,
    relations: Vec<Relation>,
    /// Per variable: (relation, column) of every relation containing it.
    participants: Vec<Vec<(usize, usize)>>,
    projection: Vec<Option<usize>>,
    output: Arc<[Variable]>,
}

fn attempt(
    prepared: &PreparedSparqlQuery,
    reader: &StorageReader<'static>,
    limits: &AnalyticalExecutionLimits,
    strategy: AnalyticalVariableOrder,
    control: &mut Control<Alive>,
    report: &AnalyticalExecutionReport,
    token: Option<&CancellationToken>,
) -> Result<Attempt, Stop> {
    let plan = plan(prepared, limits, control, token)?;
    report.update(|snapshot| {
        snapshot.patterns = plan.patterns.len();
        snapshot.variables = plan.variable_count;
    });
    let mut search = OrderSearch {
        plan: &plan,
        reader,
        token,
        nodes: 0,
    };
    let order = search.choose(strategy, control);
    let nodes = search.nodes;
    report.update(|snapshot| snapshot.order_search_nodes = nodes);
    let order = order?;
    let width = plan.variable_count;
    report.update(|snapshot| {
        snapshot.variable_order_kind = Some(strategy.kind());
        snapshot.variable_order = order_report(&order[..width]);
        snapshot.variable_order_len = width;
    });
    let (relations, participants) = start(&plan, reader, &order[..width], control, token)?;
    let Plan {
        patterns,
        projection,
        output,
        pattern_bytes,
        ..
    } = plan;
    drop(patterns);
    control.release(pattern_bytes);
    Ok(Attempt {
        order,
        width,
        relations,
        participants,
        projection,
        output,
    })
}

fn start(
    plan: &Plan,
    reader: &StorageReader<'static>,
    order: &[usize],
    control: &mut Control<Alive>,
    token: Option<&CancellationToken>,
) -> Result<(Vec<Relation>, Vec<Vec<(usize, usize)>>), Stop> {
    let stop = move |error: AccessError| access_stop(error, token);
    let slots = plan.patterns.len();
    // Participant lists and the two-key seek prefix live with the search.
    let cursor_bytes = plan
        .variable_count
        .saturating_mul(
            size_of::<Vec<(usize, usize)>>()
                .saturating_add(slots.saturating_mul(size_of::<(usize, usize)>())),
        )
        .saturating_add(2 * size_of::<Key>());
    control.reserve(cursor_bytes).map_err(stop)?;
    // Each build charges its relation, which covers this vector's slot.
    let mut relations = Vec::with_capacity(slots);
    for pattern in &plan.patterns {
        relations
            .push(Relation::build(reader, pattern, &plan.graph, order, control).map_err(stop)?);
    }
    let mut participants = (0..plan.variable_count)
        .map(|_| Vec::with_capacity(slots))
        .collect::<Vec<_>>();
    for (relation_index, relation) in relations.iter().enumerate() {
        for (column, variable) in relation.variables().iter().enumerate() {
            participants[*variable].push((relation_index, column));
        }
    }
    if participants.iter().any(Vec::is_empty) {
        return Err(Stop::Decline(AnalyticalReason::Ineligible));
    }
    Ok((relations, participants))
}

/// Iterative depth-first leapfrog search over the chosen global order.
struct Search {
    reader: StorageReader<'static>,
    relations: Vec<Relation>,
    participants: Vec<Vec<(usize, usize)>>,
    order: [usize; MAX_VARIABLES],
    width: usize,
    /// Bound values indexed by variable, not by depth.
    values: [Option<Key>; MAX_VARIABLES],
    depth: usize,
    prefix: Vec<Key>,
    control: Control<Alive>,
    seeks: u64,
    exhausted: bool,
}

impl Search {
    /// Advances to the next complete binding. After a row or a backtrack the
    /// value at that depth is always advanced exclusively.
    fn next_binding(&mut self) -> Result<bool, AccessError> {
        if self.exhausted {
            // Polling an exhausted search still observes cancellation and the
            // deadline, as the standard iterator does before every poll.
            self.control.tick(0)?;
            return Ok(false);
        }
        loop {
            self.control.tick(1)?;
            let variable = self.order[self.depth];
            if let Some(value) = self.leapfrog(variable)? {
                self.values[variable] = Some(value);
                if self.depth + 1 == self.width {
                    return Ok(true);
                }
                self.depth += 1;
                self.values[self.order[self.depth]] = None;
            } else {
                self.values[variable] = None;
                if self.depth == 0 {
                    self.exhausted = true;
                    return Ok(false);
                }
                self.depth -= 1;
            }
        }
    }

    /// Leapfrog intersection for one variable: the least value strictly after
    /// its current value (or the least value if unbound) present in every
    /// participating relation under that relation's already bound prefix.
    fn leapfrog(&mut self, variable: usize) -> Result<Option<Key>, AccessError> {
        let participants = &self.participants[variable];
        let after = self.values[variable];
        let mut target = after;
        let mut strict = after.is_some();
        let mut agreeing = 0;
        let mut index = 0;
        loop {
            let &(relation, column) = participants.get(index).ok_or(AccessError::Unsupported)?;
            let relation = &self.relations[relation];
            self.prefix.clear();
            for bound in &relation.variables()[..column] {
                self.prefix
                    .push(self.values[*bound].ok_or(AccessError::Unsupported)?);
            }
            self.seeks += 1;
            let Some(found) = relation.seek(
                &self.reader,
                self.prefix.as_slice(),
                target.as_ref(),
                strict,
                &mut self.control,
            )?
            else {
                return Ok(None);
            };
            if !strict && target == Some(found) {
                agreeing += 1;
            } else {
                // A strictly larger candidate restarts agreement.
                target = Some(found);
                strict = false;
                agreeing = 1;
            }
            if agreeing == participants.len() {
                return Ok(Some(found));
            }
            index = (index + 1) % participants.len();
        }
    }
}

struct AnalyticalRows {
    search: Search,
    /// A binding found before the stream was returned, not yet emitted.
    ready: bool,
    projection: Vec<Option<usize>>,
    max_output_rows: u64,
    emitted: u64,
    /// Charge of the row last returned; released on the next call.
    row_bytes: usize,
    finished: bool,
    token: Option<CancellationToken>,
    report: AnalyticalExecutionReport,
}

impl AnalyticalRows {
    /// Decodes one row. Its width and every term's dictionary strings are
    /// charged from lengths alone before any allocation or copy.
    fn decode_row(&mut self) -> Result<Vec<Option<Term>>, AccessError> {
        let search = &mut self.search;
        search.control.tick(1)?;
        let mut bytes = size_of::<QuerySolution>()
            .saturating_add(size_of::<Option<Term>>().saturating_mul(self.projection.len()));
        for variable in self.projection.iter().flatten() {
            let key = search.values[*variable].ok_or(AccessError::Unsupported)?;
            bytes = bytes.saturating_add(term_charge(&search.reader, &key.decode()?)?);
        }
        search.control.reserve(bytes)?;
        self.row_bytes = bytes;
        let mut row = Vec::with_capacity(self.projection.len());
        for slot in &self.projection {
            row.push(match slot {
                Some(variable) => {
                    let key = search.values[*variable].ok_or(AccessError::Unsupported)?;
                    Some(search.reader.decode_term(&key.decode()?)?)
                }
                None => None,
            });
        }
        self.emitted += 1;
        Ok(row)
    }
}

impl Iterator for AnalyticalRows {
    type Item = Result<Vec<Option<Term>>, QueryEvaluationError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.finished {
            return None;
        }
        // The previous row has been handed over to the consumer.
        self.search.control.release(take(&mut self.row_bytes));
        let binding = if take(&mut self.ready) {
            Ok(true)
        } else {
            self.search.next_binding()
        };
        let outcome = match binding {
            Ok(false) => Ok(None),
            Ok(true) if self.emitted >= self.max_output_rows => {
                let budget = AnalyticalBudget::OutputRows;
                Err((budget_error(budget), AnalyticalReason::Budget(budget)))
            }
            Ok(true) => self
                .decode_row()
                .map(Some)
                .map_err(|error| stream_failure(error, self.token.as_ref())),
            Err(error) => Err(stream_failure(error, self.token.as_ref())),
        };
        let (emitted, work, bytes, seeks) = (
            self.emitted,
            self.search.control.work(),
            self.search.control.bytes(),
            self.search.seeks,
        );
        self.report.update(|snapshot| {
            snapshot.output_rows = emitted;
            snapshot.work = work;
            snapshot.materialized_bytes = bytes;
            snapshot.seeks = seeks;
            match &outcome {
                Ok(None) => snapshot.completed = true,
                Err((_, reason)) => {
                    snapshot.disposition = AnalyticalDisposition::Failed;
                    snapshot.reason = Some(*reason);
                }
                Ok(Some(_)) => {}
            }
        });
        match outcome {
            Ok(Some(row)) => Some(Ok(row)),
            Ok(None) => {
                self.finished = true;
                None
            }
            // Emitted once, then fused; the standard plan is never replayed.
            Err((error, _)) => {
                self.finished = true;
                Some(Err(error))
            }
        }
    }
}

/// Upper bound of the transient bytes one decoded term allocates, from
/// dictionary string lengths only: nothing is copied before this charge.
/// Each dictionary string becomes one owned string moved into the term.
fn term_charge(reader: &StorageReader<'_>, term: &EncodedTerm) -> Result<usize, AccessError> {
    let ids: [Option<&StrHash>; 2] = match term {
        EncodedTerm::NamedNode { iri_id: id }
        | EncodedTerm::BigBlankNode { id_id: id }
        | EncodedTerm::BigStringLiteral { value_id: id }
        | EncodedTerm::SmallBigLangStringLiteral {
            language_id: id, ..
        }
        | EncodedTerm::BigSmallLangStringLiteral { value_id: id, .. }
        | EncodedTerm::SmallTypedLiteral {
            datatype_id: id, ..
        } => [Some(id), None],
        EncodedTerm::BigBigLangStringLiteral {
            value_id,
            language_id,
        } => [Some(value_id), Some(language_id)],
        EncodedTerm::BigTypedLiteral {
            value_id,
            datatype_id,
        } => [Some(value_id), Some(datatype_id)],
        #[cfg(feature = "rdf-12")]
        EncodedTerm::LtrSmallBigDirLangStringLiteral {
            language_id: id, ..
        }
        | EncodedTerm::RtlSmallBigDirLangStringLiteral {
            language_id: id, ..
        }
        | EncodedTerm::LtrBigSmallDirLangStringLiteral { value_id: id, .. }
        | EncodedTerm::RtlBigSmallDirLangStringLiteral { value_id: id, .. } => [Some(id), None],
        #[cfg(feature = "rdf-12")]
        EncodedTerm::LtrBigBigDirLangStringLiteral {
            value_id,
            language_id,
        }
        | EncodedTerm::RtlBigBigDirLangStringLiteral {
            value_id,
            language_id,
        } => [Some(value_id), Some(language_id)],
        // Relations never contain triple terms; refuse rather than estimate.
        #[cfg(feature = "rdf-12")]
        EncodedTerm::Triple(_) => return Err(AccessError::Unsupported),
        _ => [None, None],
    };
    let mut bytes = TERM_OVERHEAD;
    for id in ids.into_iter().flatten() {
        let len = reader.str_len(id)?.ok_or_else(|| {
            AccessError::Storage(StorageError::from(CorruptionError::msg(
                "analytical row refers to a missing dictionary string",
            )))
        })?;
        bytes = bytes
            .checked_add(len)
            .ok_or(AccessError::Limit(Limit::Bytes))?;
    }
    Ok(bytes)
}
