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
//! * a limit, cancellation, or ill-formedness failure is parked in the same
//!   shared state and re-raised afterwards, because a SPARQL function can only
//!   report "no value" to the evaluator.

use crate::control::{Budget, NestedUsage, ValidationError, ValidationOptions};
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
    /// The declared `sh:parameter` paths in `shnex:argN` order.
    parameters: Vec<ParameterDeclaration>,
}

#[derive(Clone, Debug)]
pub(crate) struct ParameterDeclaration {
    /// The `shnex:argN` index naming the positional argument.
    key: Term,
    /// Whether `sh:optional true` was declared for the parameter.
    optional: bool,
}

impl DeclaredFunction {
    pub(crate) fn new(
        function: NamedNode,
        body: NodeExpression,
        parameters: Vec<ParameterDeclaration>,
    ) -> Self {
        Self {
            function,
            body,
            parameters,
        }
    }
}

impl ParameterDeclaration {
    pub(crate) fn new(key: Term, optional: bool) -> Self {
        Self { key, optional }
    }
}

/// State shared between the registered closures and the calling evaluator.
///
/// `failure` holds the first limit, cancellation, or ill-formedness error a
/// call hit. A SPARQL function can only return "no value", so the error is
/// parked and re-raised once the query returns.
#[derive(Debug, Default)]
struct SharedState {
    usage: NestedUsage,
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
    let state = Arc::new(Mutex::new(SharedState::default()));
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
    for declaration in declarations.iter().cloned() {
        let name = declaration.function.clone();
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
/// Returns `None` both for a genuinely empty result and for a failure; in the
/// failure case the error is recorded in `state` and re-raised by
/// [`FunctionScope::finish`], so an unbound result never masks an error.
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
        Err(error) => {
            if let Ok(mut state) = lock(state) {
                state.failure.get_or_insert(error);
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
    let scope = argument_scope(declaration, arguments)?;
    let environment = ExpressionEnvironment::default().with_positional_arguments(scope);

    // The per-call budget shares the caller's cancellation token and ceilings,
    // and inherits what is left of the caller's wall-clock deadline. Its
    // consumption is folded into the outer budget by `FunctionScope::finish`.
    let mut options = options.clone();
    if let Some(deadline) = deadline {
        options.limits.timeout = Some(deadline.saturating_duration_since(Instant::now()));
    }
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
    // Exactly one output node is the value; none is "no value"; more than one
    // is an evaluation failure per `CustomListParameterExpression-evaluation`.
    match result?.as_slice() {
        [] => Ok(None),
        [value] => Ok(Some(value.clone())),
        _ => Err(ValidationError::IllFormed(format!(
            "custom SPARQL function <{}> produced more than one output node",
            declaration.function
        ))),
    }
}

/// Maps the positional arguments of a call onto the declared `shnex:argN` keys.
///
/// Declared parameters document the positional arguments, so a call cannot pass
/// more of them than were declared. A missing argument is only tolerated when
/// its parameter is `sh:optional true`, in which case the key stays unbound; an
/// argument that is itself unbound is passed through as unbound, which is what
/// `ex:langLabelCount(?none, 'en')` relies on.
fn argument_scope(
    declaration: &DeclaredFunction,
    arguments: &[Term],
) -> Result<Vec<(Term, Option<Term>)>, ValidationError> {
    if declaration.parameters.is_empty() {
        // An undeclared parameter list still names arguments by position.
        return arguments
            .iter()
            .enumerate()
            .map(|(index, argument)| Ok((list_index(index)?, Some(argument.clone()))))
            .collect();
    }
    if arguments.len() > declaration.parameters.len() {
        return Err(ValidationError::IllFormed(format!(
            "custom SPARQL function <{}> accepts at most {} arguments, but {} were given",
            declaration.function,
            declaration.parameters.len(),
            arguments.len()
        )));
    }
    let mut scope = Vec::with_capacity(declaration.parameters.len());
    for (index, parameter) in declaration.parameters.iter().enumerate() {
        let argument = arguments.get(index).cloned();
        if argument.is_none() && !parameter.optional {
            return Err(ValidationError::IllFormed(format!(
                "custom SPARQL function <{}> requires argument {index}",
                declaration.function
            )));
        }
        scope.push((parameter.key.clone(), argument));
    }
    Ok(scope)
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
            Vec::new(),
        )
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
