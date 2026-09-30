//! SHACL-declared node-expression functions exposed as SPARQL functions.
//!
//! [shacl12-sparql](https://www.w3.org/TR/shacl12-sparql/#sparql-functions)
//! recommends that a SPARQL engine register a function for every SHACL
//! instance of `sh:ListParameterExpressionFunction` in a provided shapes
//! graph. Declarations are compiled once with the shapes graph and adapted
//! here to spareval's `Fn(&[Term]) -> Option<Term> + Send + Sync` registry
//! entry point.
//!
//! The adaptation problem is that a node-expression body needs a `&mut Budget`
//! and a `&mut impl ExpressionContext`, while a registry entry is a shared,
//! immutable closure invoked mid-query. Rather than widening spareval's public
//! API, each registered function owns the state it needs:
//!
//! * the shapes graph and the data graph are cloned into the closure, so a
//!   body evaluates against the same `focusGraph` the query sees. A nested
//!   registration cannot reuse its parent's copies: a body only reaches the
//!   graphs as `&ShapesGraph` and `&GraphSnapshot`, while a registry entry
//!   must own `'static` state;
//! * those copies, and the isolated dataset every query builds, are reserved
//!   against the memory ceiling before they are made. They are freed when
//!   their query returns, so they are not charged cumulatively; instead each
//!   reservation is part of the baseline the nested calls of that query start
//!   from, so the copies held by every level still on the stack add up
//!   against one ceiling as recursion deepens;
//! * a fresh [`Budget`] is built per call from the outer budget's options, so
//!   the shared [`CancellationToken`](crate::CancellationToken), the remaining
//!   wall-clock deadline, and every configured ceiling still apply inside it;
//! * the resources each call consumed are accumulated in shared state and
//!   charged to the outer budget once the query finishes, so work done inside
//!   a function counts against the caller's totals;
//! * a limit or cancellation is parked in the same shared state and re-raised
//!   afterwards, because a SPARQL function can only report "no value" to the
//!   evaluator; any other body failure is a SPARQL error of that call;
//! * a body may itself run SPARQL that calls declared functions, which text
//!   alone can make recursive, or reach a `sh:sparql` constraint that calls
//!   them again through a shape, for example with `shnex:conformsToShape`.
//!   Every registration therefore receives a strictly smaller recursion bound
//!   than the budget it starts from, stored as the per-call
//!   `max_recursion_depth`. Once it is spent, every call is refused before a
//!   body runs, so the recursion cannot go past the caller's configured bound;
//! * spareval invokes a registered function synchronously from inside its own
//!   expression evaluator, so every recursion level would otherwise keep a
//!   whole nested query evaluation on the caller's stack. Each call runs its
//!   body on a scoped thread of the default size and the caller only waits,
//!   which keeps the stack used by one level independent of the depth.

use crate::control::{Budget, LimitKind, NestedUsage, ValidationError, ValidationOptions};
use crate::model::GraphSnapshot;
use crate::{ExpressionEnvironment, NodeExpression, ShapesGraph};
use oxrdf::{Literal, NamedNode, Term};
use spareval::QueryEvaluator;
use std::sync::{Arc, Mutex};
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

/// Estimated bytes of one copied quad or compiled item.
///
/// This is the figure `Validator::validate` charges per quad of the data
/// snapshot, so a copy is estimated to cost as much as the graph it copies.
const BYTES_PER_QUAD: usize = 128;

/// A `sh:ListParameterExpressionFunction` that can be registered with SPARQL.
#[derive(Clone, Debug)]
pub(crate) struct DeclaredFunction {
    function: NamedNode,
    /// The compiled `sh:bodyExpression`, scoped to the function's arguments.
    body: NodeExpression,
}

impl DeclaredFunction {
    pub(crate) fn new(function: NamedNode, body: NodeExpression) -> Self {
        Self { function, body }
    }
}

/// State shared between the registered closures and the calling evaluator.
///
/// `baseline` is the outer budget's consumption when the query began, plus the
/// memory reserved for the copies that live as long as the query; `usage`
/// grows with every call. Their sum is what the limits apply to.
///
/// `failure` holds the first limit or cancellation a call hit. A SPARQL
/// function can only return "no value", so the error is parked and re-raised
/// once the query returns.
#[derive(Debug, Default)]
struct SharedState {
    /// Consumption of all calls in this query.
    usage: NestedUsage,
    /// The outer budget's consumption when the query started, plus the
    /// memory reserved for this query's copies.
    baseline: NestedUsage,
    failure: Option<ValidationError>,
}

/// Guards one query execution that may call SHACL-declared SPARQL functions.
///
/// The guard must be finished after the query so that accumulated usage is
/// charged and any recorded failure is re-raised.
pub(crate) struct FunctionScope {
    state: Arc<Mutex<SharedState>>,
}

impl FunctionScope {
    /// Charges accumulated usage to `budget` and re-raises any recorded failure.
    ///
    /// A recorded failure wins over a limit the charge itself reaches, because
    /// it is the first stop any call hit. A recursion-depth failure is reported
    /// against `budget`'s own configured depth, not the smaller bound a nested
    /// call ran under.
    pub(crate) fn finish(self, budget: &mut Budget<'_>) -> Result<(), ValidationError> {
        let (usage, failure) = {
            let mut state = lock(&self.state)?;
            (state.usage, state.failure.take())
        };
        // Charge first: a call that failed still consumed resources.
        let charged = budget.charge_nested(usage);
        match failure {
            Some(error) => Err(against_configured_depth(error, budget)),
            None => charged,
        }
    }
}

/// Estimated size of the isolated dataset a query over `data` builds.
pub(crate) fn isolated_dataset_bytes(data: &GraphSnapshot) -> usize {
    data.triple_count().saturating_mul(BYTES_PER_QUAD)
}

/// Estimated size of the shapes-graph and data-graph copies one registration
/// makes.
///
/// A data copy clones the whole backing dataset, not only the selected graph.
/// A shapes copy clones its source snapshot, every compiled shape and
/// constraint, and every declaration.
fn registration_copy_bytes(shapes: &ShapesGraph, data: &GraphSnapshot) -> usize {
    let compiled =
        shapes
            .shapes()
            .fold(shapes.declared_sparql_functions().len(), |total, shape| {
                total
                    .saturating_add(1)
                    .saturating_add(shape.constraints.len())
            });
    data.dataset()
        .len()
        .saturating_add(shapes.source().dataset().len())
        .saturating_add(compiled)
        .saturating_mul(BYTES_PER_QUAD)
}

/// Checks that `bytes` more memory fits under `budget`'s ceiling.
///
/// The memory is held only while one query runs, so it is reserved rather
/// than charged: charging it would add up copies that are never live
/// together. Nested calls see the reservation through the baseline of the
/// registration that made it.
pub(crate) fn reserve(budget: &Budget<'_>, bytes: usize) -> Result<(), ValidationError> {
    budget.check()?;
    let limit = budget.limits().max_estimated_memory_bytes;
    if budget.estimated_memory().saturating_add(bytes) > limit {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::EstimatedMemory,
            limit,
        });
    }
    Ok(())
}

/// Registers every SHACL-declared function of `shapes` on `evaluator`.
///
/// `data` is the focus graph the function bodies evaluate against. Every body
/// evaluates with `body_depth` as its `max_recursion_depth`, so a SPARQL query
/// inside a body registers the functions again with a strictly smaller bound.
/// `None` means the bound is spent: the functions stay registered but every
/// call parks a recursion-depth failure and yields no value before any body,
/// or any deeper stack, exists.
///
/// `live_bytes` is the caller's other memory that lives as long as the query,
/// namely its isolated dataset. It and this registration's copies are
/// reserved against `budget` before anything is copied, and become part of
/// the baseline every call starts from. Returns the extended evaluator and
/// the scope to finish after execution.
pub(crate) fn register_nested(
    mut evaluator: QueryEvaluator,
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    budget: &Budget<'_>,
    body_depth: Option<usize>,
    live_bytes: usize,
) -> Result<(QueryEvaluator, FunctionScope), ValidationError> {
    let declarations = shapes.declared_sparql_functions();
    let copies = if declarations.is_empty() || body_depth.is_none() {
        0
    } else {
        registration_copy_bytes(shapes, data)
    };
    let reserved = live_bytes.saturating_add(copies);
    reserve(budget, reserved)?;
    let state = Arc::new(Mutex::new(SharedState {
        usage: NestedUsage::default(),
        baseline: NestedUsage::of(budget).plus(NestedUsage {
            estimated_memory: reserved,
            ..NestedUsage::default()
        }),
        failure: None,
    }));
    if declarations.is_empty() {
        return Ok((evaluator, FunctionScope { state }));
    }
    let registered = evaluator.custom_functions().cloned().collect::<Vec<_>>();
    let Some(depth) = body_depth else {
        let configured_depth = budget.limits().max_recursion_depth;
        for declaration in declarations {
            let name = declaration.function.clone();
            if registered.contains(&name) {
                continue;
            }
            let state = Arc::clone(&state);
            evaluator = evaluator.with_custom_function(name, move |_| {
                if let Ok(mut guard) = lock(&state) {
                    guard.failure.get_or_insert(ValidationError::LimitExceeded {
                        kind: LimitKind::RecursionDepth,
                        limit: configured_depth,
                    });
                }
                None
            });
        }
        return Ok((evaluator, FunctionScope { state }));
    };
    // A body may itself call shapes-graph-defined functions through node
    // expressions, so the compiled shapes graph travels into the closure.
    // Both copies were reserved above.
    let shapes = Arc::new(shapes.clone());
    let data = Arc::new(data.clone());
    // Cloning the options carries the caller's cancellation token and limits
    // into the per-call budget; that is how cancellation reaches a body.
    let mut options = budget.options().clone();
    options.limits.max_recursion_depth = depth;
    let options = Arc::new(options);
    // The per-call budget restarts its own clock, so the caller's deadline is
    // captured as an absolute instant and converted back to a shrinking
    // timeout at each call.
    let deadline = budget
        .remaining_timeout()
        .map(|remaining| Instant::now() + remaining);
    for declaration in declarations.iter().cloned() {
        let name = declaration.function.clone();
        // shacl12-sparql: an engine MUST ignore an attempt to redefine a
        // function that is already registered, unless it was itself added as a
        // custom SPARQL function. Built-in `xsd:` and `sparql:` functions are
        // rejected at compile time; this keeps extension functions such as
        // GeoSPARQL's.
        if registered.contains(&name) {
            continue;
        }
        let shapes = Arc::clone(&shapes);
        let data = Arc::clone(&data);
        let options = Arc::clone(&options);
        let state = Arc::clone(&state);
        evaluator = evaluator.with_custom_function(name, move |arguments| {
            call(
                &declaration,
                arguments,
                &shapes,
                &data,
                &options,
                deadline,
                &state,
            )
        });
    }
    Ok((evaluator, FunctionScope { state }))
}

/// Evaluates one custom-function call inside a running SPARQL query.
///
/// Returns `None` for any result other than exactly one node and for a body
/// evaluation failure, both of which are SPARQL errors. A resource limit or
/// cancellation is also recorded in `state` and re-raised by
/// [`FunctionScope::finish`], so it can never be hidden as an unbound value.
fn call(
    declaration: &DeclaredFunction,
    arguments: &[Term],
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    options: &ValidationOptions,
    deadline: Option<Instant>,
    state: &Arc<Mutex<SharedState>>,
) -> Option<Term> {
    if lock(state).ok()?.failure.is_some() {
        // A previous call already failed; the query result is discarded anyway.
        return None;
    }
    // spareval runs this closure synchronously inside its expression
    // evaluator, and a body that queries again re-enters spareval, so on one
    // thread every recursion level would keep a whole query evaluation on the
    // stack. The body gets a scoped thread of the default size instead and
    // this thread only waits, so no level's stack depends on the depth.
    let evaluated = std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name("oxshacl-declared-function".to_owned())
            .spawn_scoped(scope, move || {
                evaluate_call(
                    declaration,
                    arguments,
                    shapes,
                    data,
                    options,
                    deadline,
                    state,
                )
            })
            .map(|body| match body.join() {
                Ok(result) => result,
                Err(panic) => std::panic::resume_unwind(panic),
            })
    });
    let result = match evaluated {
        Ok(result) => result,
        Err(error) => {
            // The body never ran; that must stop validation rather than read
            // as an unbound value.
            park(
                state,
                ValidationError::Sparql(format!(
                    "custom SPARQL function <{}> could not start its body: {error}",
                    declaration.function
                )),
            );
            return None;
        }
    };
    match result {
        Ok(output) => output,
        // shacl12-sparql: an evaluation failure of the body makes the call a
        // SPARQL error, which spareval can only express as no value. Resource
        // limits and cancellation are not evaluation failures of the function:
        // they must stop validation, so those are parked and re-raised.
        Err(error) if !is_resource_stop(&error) => None,
        Err(error) => {
            park(state, configured_limit(error, options));
            None
        }
    }
}

/// Records the first failure that must stop validation once the query returns.
fn park(state: &Arc<Mutex<SharedState>>, error: ValidationError) {
    if let Ok(mut state) = lock(state) {
        state.failure.get_or_insert(error);
    }
}

fn evaluate_call(
    declaration: &DeclaredFunction,
    arguments: &[Term],
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    options: &ValidationOptions,
    deadline: Option<Instant>,
    state: &Arc<Mutex<SharedState>>,
) -> Result<Option<Term>, ValidationError> {
    let scope = argument_scope(arguments)?;
    let environment = ExpressionEnvironment::default().with_positional_arguments(scope);

    // The per-call budget shares the caller's cancellation token and ceilings,
    // and inherits what is left of the caller's wall-clock deadline. Its
    // consumption is folded into the outer budget by `FunctionScope::finish`.
    let mut options = options.clone();
    if let Some(deadline) = deadline {
        options.limits.timeout = Some(deadline.saturating_duration_since(Instant::now()));
    }
    // Every call shares one global ceiling: each limit is lowered by what the
    // caller had already used or reserved before the query and by what earlier
    // calls in this query used, so K calls cannot each spend a full ceiling.
    let used = {
        let state = lock(state)?;
        state.baseline.plus(state.usage)
    };
    used.restrict(&mut options.limits);
    let mut budget = Budget::new(&options)?;
    // shacl12-sparql: "the focusNode passed into a custom SPARQL function based
    // on a node expression is the IRI of the function itself".
    let focus = Term::from(declaration.function.clone());
    let result = crate::validate::evaluate_expression_with_budget(
        &declaration.body,
        shapes,
        data,
        &focus,
        &environment,
        &mut budget,
    );
    if let Ok(mut state) = lock(state) {
        state.usage.accumulate(&budget);
    }
    // shacl12-sparql `EVALUATION OF CUSTOM SPARQL FUNCTIONS`: exactly one
    // output node is the value; any other count makes the call an error.
    // spareval can only express that error as "no value", so the call yields
    // unbound without parking a failure: this is a SPARQL expression error,
    // not a limit or cancellation that must abort validation.
    match result?.as_slice() {
        [value] => Ok(Some(value.clone())),
        _ => Ok(None),
    }
}

/// Maps the positional arguments of a call onto `shnex:argN` scope keys.
///
/// shacl12-sparql `EVALUATION OF CUSTOM SPARQL FUNCTIONS`: an argument whose
/// evaluation errors makes the whole call an error unless its parameter is
/// `sh:optional true`. spareval evaluates every argument before calling a
/// registered function and yields no value (its representation of an
/// expression error) as soon as one is unbound or erroneous, so this closure
/// only ever receives complete, bound argument lists. It therefore cannot see
/// an optional parameter's erroring argument: such a call is an error too,
/// which is stricter than the specification. A call that simply omits
/// trailing arguments leaves those keys unbound. `sh:parameter` declarations
/// are documentation and are not enforced, so extra arguments are passed
/// through by position.
fn argument_scope(arguments: &[Term]) -> Result<Vec<(Term, Option<Term>)>, ValidationError> {
    arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| Ok((list_index(index)?, Some(argument.clone()))))
        .collect()
}

/// Whether `error` is a resource limit or cancellation rather than a failure
/// of the function's own evaluation.
fn is_resource_stop(error: &ValidationError) -> bool {
    matches!(
        error,
        ValidationError::Cancelled | ValidationError::LimitExceeded { .. }
    )
}

/// Reports a limit error against the configured ceiling rather than the
/// reduced one a call's budget enforced (see [`NestedUsage::restrict`]).
fn configured_limit(error: ValidationError, options: &ValidationOptions) -> ValidationError {
    let ValidationError::LimitExceeded { kind, limit } = error else {
        return error;
    };
    let limits = &options.limits;
    let limit = match kind {
        LimitKind::PathVisits => limits.max_path_visits,
        LimitKind::QuerySolutions => limits.max_query_solutions,
        LimitKind::EstimatedMemory => limits.max_estimated_memory_bytes,
        LimitKind::Time => limits.timeout.map_or(limit, |timeout| {
            usize::try_from(timeout.as_millis()).unwrap_or(usize::MAX)
        }),
        _ => limit,
    };
    ValidationError::LimitExceeded { kind, limit }
}

/// Reports a recursion-depth failure against `budget`'s configured depth,
/// which is the bound its caller chose rather than a nested call's remainder.
fn against_configured_depth(error: ValidationError, budget: &Budget<'_>) -> ValidationError {
    match error {
        ValidationError::LimitExceeded {
            kind: LimitKind::RecursionDepth,
            ..
        } => ValidationError::LimitExceeded {
            kind: LimitKind::RecursionDepth,
            limit: budget.limits().max_recursion_depth,
        },
        other => other,
    }
}

/// Names positional argument `index` the way `shnex:arg N` does.
fn list_index(index: usize) -> Result<Term, ValidationError> {
    let index = i64::try_from(index).map_err(|_| {
        ValidationError::IllFormed("custom list-parameter index exceeds xsd:integer".to_owned())
    })?;
    Ok(Term::Literal(Literal::from(index)))
}

fn lock(
    state: &Arc<Mutex<SharedState>>,
) -> Result<std::sync::MutexGuard<'_, SharedState>, ValidationError> {
    state.lock().map_err(|_| {
        ValidationError::Sparql("custom SPARQL function state was poisoned".to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ProfileId, ProfileSet};
    use oxrdf::Dataset;

    fn shapes() -> ShapesGraph {
        ShapesGraph::from_shapes(
            ProfileSet::new([ProfileId::Core12Subset20260723]).unwrap(),
            std::iter::empty(),
            &ValidationOptions::default(),
        )
        .unwrap()
    }

    fn declaration() -> DeclaredFunction {
        DeclaredFunction::new(
            NamedNode::new_unchecked("urn:function"),
            NodeExpression::Constant(Term::from(NamedNode::new_unchecked("urn:value"))),
        )
    }

    #[test]
    fn a_call_gets_only_the_ceiling_left_by_the_caller_and_earlier_calls() {
        // `shnex:instancesOf` visits paths, so a call needs path-visit room.
        let class = NamedNode::new_unchecked("urn:Class");
        let declaration = DeclaredFunction::new(
            NamedNode::new_unchecked("urn:function"),
            NodeExpression::InstancesOf(Box::new(NodeExpression::Constant(Term::from(
                class.clone(),
            )))),
        );
        let data = GraphSnapshot::default_graph(Dataset::from_iter([oxrdf::Quad::new(
            NamedNode::new_unchecked("urn:a"),
            NamedNode::new_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
            class,
            oxrdf::GraphName::DefaultGraph,
        )]));
        let options = ValidationOptions::default();
        let state = |used: usize| {
            Arc::new(Mutex::new(SharedState {
                usage: NestedUsage::default(),
                baseline: NestedUsage {
                    path_visits: used,
                    ..NestedUsage::default()
                },
                failure: None,
            }))
        };
        let fresh = state(0);
        assert!(call(&declaration, &[], &shapes(), &data, &options, None, &fresh).is_some());
        assert!(lock(&fresh).unwrap().failure.is_none());

        // The caller has already used the whole ceiling, so the same call fails.
        let spent = state(options.limits.max_path_visits);
        assert!(call(&declaration, &[], &shapes(), &data, &options, None, &spent).is_none());
        // The error names the configured ceiling, not the reduced one (zero).
        assert!(matches!(
            lock(&spent).unwrap().failure,
            Some(ValidationError::LimitExceeded {
                kind: LimitKind::PathVisits,
                limit,
            }) if limit == options.limits.max_path_visits
        ));
    }

    #[test]
    fn a_body_evaluation_failure_is_a_call_error_not_a_validation_failure() {
        // `shnex:instancesOf` requires IRI classes; a literal is an evaluation
        // failure of the body, which makes the call a SPARQL error (unbound).
        let declaration = DeclaredFunction::new(
            NamedNode::new_unchecked("urn:function"),
            NodeExpression::InstancesOf(Box::new(NodeExpression::Constant(Term::from(
                Literal::from("not a class"),
            )))),
        );
        let state = Arc::new(Mutex::new(SharedState::default()));
        let output = call(
            &declaration,
            &[],
            &shapes(),
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default(),
            None,
            &state,
        );
        assert!(output.is_none());
        assert!(lock(&state).unwrap().failure.is_none());
    }

    #[test]
    fn cancellation_inside_a_call_is_reported_instead_of_an_unbound_result() {
        let options = ValidationOptions::default();
        options.cancellation_token.cancel();
        let state = Arc::new(Mutex::new(SharedState::default()));
        let output = call(
            &declaration(),
            &[],
            &shapes(),
            &GraphSnapshot::default_graph(Dataset::new()),
            &options,
            None,
            &state,
        );
        assert!(
            output.is_none(),
            "a cancelled call must not produce a value"
        );

        let scope = FunctionScope { state };
        let outer = ValidationOptions::default();
        let mut budget = Budget::new(&outer).unwrap();
        assert!(
            matches!(scope.finish(&mut budget), Err(ValidationError::Cancelled)),
            "the parked cancellation was not re-raised"
        );
    }

    #[test]
    fn an_expired_deadline_fails_the_call_before_the_body_runs() {
        let state = Arc::new(Mutex::new(SharedState::default()));
        let output = call(
            &declaration(),
            &[],
            &shapes(),
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default(),
            Some(Instant::now()),
            &state,
        );
        assert!(output.is_none(), "an expired call must not produce a value");

        let scope = FunctionScope { state };
        let outer = ValidationOptions::default();
        let mut budget = Budget::new(&outer).unwrap();
        assert!(
            matches!(
                scope.finish(&mut budget),
                Err(ValidationError::LimitExceeded {
                    kind: LimitKind::Time,
                    ..
                })
            ),
            "the inherited deadline did not surface as a time limit"
        );
    }

    #[test]
    fn a_parked_failure_wins_over_a_limit_reached_while_charging_its_usage() {
        let state = Arc::new(Mutex::new(SharedState {
            usage: NestedUsage {
                path_visits: usize::MAX,
                ..NestedUsage::default()
            },
            baseline: NestedUsage::default(),
            failure: Some(ValidationError::Cancelled),
        }));
        let options = ValidationOptions::default();
        let mut budget = Budget::new(&options).unwrap();
        assert!(
            matches!(
                FunctionScope { state }.finish(&mut budget),
                Err(ValidationError::Cancelled)
            ),
            "the charge's own path-visit limit replaced the parked failure"
        );
    }

    #[test]
    fn a_registration_is_refused_before_copying_when_its_copies_do_not_fit() {
        let mut options = ValidationOptions::default();
        options.limits.max_estimated_memory_bytes = 100;
        let budget = Budget::new(&options).unwrap();
        let data = GraphSnapshot::default_graph(Dataset::new());
        let refused = register_nested(
            QueryEvaluator::new(),
            &shapes(),
            &data,
            &budget,
            Some(1),
            101,
        );
        assert!(
            matches!(
                refused.err(),
                Some(ValidationError::LimitExceeded {
                    kind: LimitKind::EstimatedMemory,
                    limit: 100,
                })
            ),
            "a reservation over the ceiling must fail as estimated memory"
        );
        let (_, scope) = register_nested(
            QueryEvaluator::new(),
            &shapes(),
            &data,
            &budget,
            Some(1),
            100,
        )
        .unwrap();
        // The reservation is part of the baseline nested calls start from.
        assert_eq!(lock(&scope.state).unwrap().baseline.estimated_memory, 100);
    }
}
