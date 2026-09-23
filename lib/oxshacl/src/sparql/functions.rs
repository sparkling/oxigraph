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
//!   body evaluates against the same `focusGraph` the query sees;
//! * a fresh [`Budget`] is built per call from the outer budget's options, so
//!   the shared [`CancellationToken`](crate::CancellationToken), the remaining
//!   wall-clock deadline, and every configured ceiling still apply inside it;
//! * the resources each call consumed are accumulated in shared state and
//!   charged to the outer budget once the query finishes, so work done inside
//!   a function counts against the caller's totals;
//! * a limit or cancellation is parked in the same shared state and re-raised
//!   afterwards, because a SPARQL function can only report "no value" to the
//!   evaluator; any other body failure is a SPARQL error of that call.

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
/// `baseline` is the outer budget's consumption when the query began and
/// `usage` grows with every call; their sum is what the limits apply to.
///
/// `failure` holds the first limit or cancellation a call hit. A SPARQL function can only return "no value", so the error is
/// parked and re-raised once the query returns.
#[derive(Debug, Default)]
struct SharedState {
    /// Consumption of all calls in this query.
    usage: NestedUsage,
    /// The outer budget's consumption when the query started.
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
    pub(crate) fn finish(self, budget: &mut Budget<'_>) -> Result<(), ValidationError> {
        let (usage, failure) = {
            let mut state = lock(&self.state)?;
            (state.usage, state.failure.take())
        };
        // Charge first: a call that failed still consumed resources.
        budget.charge_nested(usage)?;
        failure.map_or(Ok(()), Err)
    }
}

/// Registers every SHACL-declared function of `shapes` on `evaluator`.
///
/// `data` is the focus graph the function bodies evaluate against. Returns the
/// extended evaluator and the scope to finish after execution.
pub(crate) fn register(
    mut evaluator: QueryEvaluator,
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    budget: &Budget<'_>,
) -> (QueryEvaluator, FunctionScope) {
    let state = Arc::new(Mutex::new(SharedState {
        usage: NestedUsage::default(),
        baseline: NestedUsage::of(budget),
        failure: None,
    }));
    let declarations = shapes.declared_sparql_functions();
    if declarations.is_empty() {
        return (evaluator, FunctionScope { state });
    }
    // A body may itself call shapes-graph-defined functions through node
    // expressions, so the compiled shapes graph travels into the closure.
    let shapes = Arc::new(shapes.clone());
    let data = Arc::new(data.clone());
    // Cloning the options carries the caller's cancellation token and limits
    // into the per-call budget; that is how cancellation reaches a body.
    let options = Arc::new(budget.options().clone());
    // The per-call budget restarts its own clock, so the caller's deadline is
    // captured as an absolute instant and converted back to a shrinking
    // timeout at each call.
    let deadline = budget
        .remaining_timeout()
        .map(|remaining| Instant::now() + remaining);
    let registered = evaluator.custom_functions().cloned().collect::<Vec<_>>();
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
    (evaluator, FunctionScope { state })
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
    match evaluate_call(
        declaration,
        arguments,
        shapes,
        data,
        options,
        deadline,
        state,
    ) {
        Ok(output) => output,
        // shacl12-sparql: an evaluation failure of the body makes the call a
        // SPARQL error, which spareval can only express as no value. Resource
        // limits and cancellation are not evaluation failures of the function:
        // they must stop validation, so those are parked and re-raised.
        Err(error) if !is_resource_stop(&error) => None,
        Err(error) => {
            if let Ok(mut state) = lock(state) {
                state
                    .failure
                    .get_or_insert(configured_limit(error, options));
            }
            None
        }
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
    // caller had already used before the query and by what earlier calls in
    // this query used, so K calls cannot each spend a full ceiling.
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
        _ => limit,
    };
    ValidationError::LimitExceeded { kind, limit }
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
                kind: crate::LimitKind::PathVisits,
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
                    kind: crate::LimitKind::Time,
                    ..
                })
            ),
            "the inherited deadline did not surface as a time limit"
        );
    }
}
