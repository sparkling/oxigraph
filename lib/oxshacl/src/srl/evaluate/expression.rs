use super::head::SharedBlankAllocator;
use super::native::{ExecutionGuard, Solution};
#[cfg(feature = "sparql")]
use crate::srl::{SrlBinaryOperator, SrlNode, SrlPredicate, SrlUnaryOperator};
use crate::srl::{SrlError, SrlExpression};
use oxrdf::Term;

#[cfg(feature = "sparql")]
use oxrdf::vocab::xsd;
#[cfg(feature = "sparql")]
use oxrdf::{Dataset, Literal, NamedNode, Variable};
#[cfg(feature = "sparql")]
use spareval::{QueryEvaluator, QueryResults};
#[cfg(feature = "sparql")]
use spargebra::{Query, SparqlParser, SparqlVersion};
#[cfg(feature = "sparql")]
use std::collections::BTreeSet;
#[cfg(feature = "sparql")]
use std::sync::{Arc, Mutex};
#[cfg(all(
    feature = "sparql",
    not(all(target_family = "wasm", target_os = "unknown"))
))]
use std::time::Instant;
#[cfg(all(feature = "sparql", target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

#[cfg(feature = "sparql")]
const BNODE_FUNCTION: &str = "urn:oxigraph:oxshacl:srl:bnode";

pub(super) struct ExpressionRuntime {
    #[cfg(feature = "sparql")]
    evaluator: QueryEvaluator,
    #[cfg(feature = "sparql")]
    callback: Arc<Mutex<BnodeCallback>>,
    #[cfg(feature = "sparql")]
    now: String,
}

#[cfg(feature = "sparql")]
struct BnodeCallback {
    blanks: SharedBlankAllocator,
    solution_id: u64,
    pending_memory: usize,
    remaining_memory: usize,
    memory_limit: usize,
    cancellation: crate::CancellationToken,
    timeout_started: Instant,
    timeout_remaining: Option<std::time::Duration>,
    timeout_limit: usize,
    failure: Option<SrlError>,
}

impl ExpressionRuntime {
    pub(super) fn new(blanks: SharedBlankAllocator) -> Self {
        #[cfg(feature = "sparql")]
        {
            let callback = Arc::new(Mutex::new(BnodeCallback {
                blanks,
                solution_id: 0,
                pending_memory: 0,
                remaining_memory: 0,
                memory_limit: 0,
                cancellation: crate::CancellationToken::default(),
                timeout_started: Instant::now(),
                timeout_remaining: None,
                timeout_limit: 0,
                failure: None,
            }));
            let function_callback = Arc::clone(&callback);
            Self {
                // Optimizing before prepared substitutions can fold the UNDEF
                // registration used to expose exact RDF term bindings.
                evaluator: QueryEvaluator::new()
                    .without_optimizations()
                    .with_version(SparqlVersion::current())
                    .with_custom_function(
                        NamedNode::new_unchecked(BNODE_FUNCTION),
                        move |arguments| evaluate_bnode(arguments, &function_callback),
                    ),
                callback,
                now: Literal::from(oxsdatatypes::DateTime::now()).to_string(),
            }
        }
        #[cfg(not(feature = "sparql"))]
        {
            drop(blanks);
            Self {}
        }
    }

    #[cfg(feature = "sparql")]
    pub(super) fn term(
        &self,
        expression: &SrlExpression,
        solution: &Solution,
        guard: &mut ExecutionGuard<'_>,
    ) -> Result<Option<Term>, SrlError> {
        let source = format!(
            "SELECT (({}) AS ?__srl_value) WHERE {{ }}",
            expression_source(expression, &self.now)?
        );
        let (query, variables) = prepare_query(&source, expression, guard)?;
        self.begin(solution.id(), guard)?;
        guard.check()?;
        let mut prepared = self.evaluator.prepare(&query);
        for variable in &variables {
            let value = solution.get(variable.as_str()).ok_or_else(|| {
                SrlError::WellFormed(format!(
                    "expression variable `?{variable}` has no solution binding"
                ))
            })?;
            prepared = prepared.substitute_variable(variable.clone(), value.clone());
        }
        let result = match prepared.execute(&Dataset::new()) {
            Ok(QueryResults::Solutions(mut solutions)) => match solutions.next() {
                Some(Ok(solution)) => Ok(solution.get("__srl_value").cloned()),
                Some(Err(error)) => Err(SrlError::Unsupported(format!(
                    "SRL expression solution failed: {error}"
                ))),
                None => Ok(None),
            },
            Ok(_) => Err(SrlError::Unsupported(
                "SRL expression evaluator returned a non-solution result".to_owned(),
            )),
            Err(error) => Err(SrlError::Unsupported(format!(
                "SRL expression evaluation failed: {error}"
            ))),
        };
        let callback = self.finish(guard);
        callback?;
        guard.check()?;
        result
    }

    #[cfg(not(feature = "sparql"))]
    #[expect(
        clippy::unused_self,
        reason = "the feature-independent call site uses the same runtime method"
    )]
    pub(super) fn term(
        &self,
        _expression: &SrlExpression,
        _solution: &Solution,
        _guard: &mut ExecutionGuard<'_>,
    ) -> Result<Option<Term>, SrlError> {
        Err(SrlError::Unsupported(
            "FILTER and SET execution requires the `sparql` crate feature".to_owned(),
        ))
    }

    #[cfg(feature = "sparql")]
    pub(super) fn ebv(
        &self,
        expression: &SrlExpression,
        solution: &Solution,
        guard: &mut ExecutionGuard<'_>,
    ) -> Result<Option<bool>, SrlError> {
        let source = format!(
            "ASK {{ FILTER({}) }}",
            expression_source(expression, &self.now)?
        );
        let (query, variables) = prepare_query(&source, expression, guard)?;
        self.begin(solution.id(), guard)?;
        guard.check()?;
        let mut prepared = self.evaluator.prepare(&query);
        for variable in &variables {
            let value = solution.get(variable.as_str()).ok_or_else(|| {
                SrlError::WellFormed(format!(
                    "expression variable `?{variable}` has no solution binding"
                ))
            })?;
            prepared = prepared.substitute_variable(variable.clone(), value.clone());
        }
        let result = match prepared.execute(&Dataset::new()) {
            Ok(QueryResults::Boolean(value)) => Ok(Some(value)),
            Ok(_) => Err(SrlError::Unsupported(
                "SRL filter evaluator returned a non-boolean result".to_owned(),
            )),
            Err(_) => Ok(None),
        };
        let callback = self.finish(guard);
        callback?;
        guard.check()?;
        result
    }

    #[cfg(not(feature = "sparql"))]
    #[expect(
        clippy::unused_self,
        reason = "the feature-independent call site uses the same runtime method"
    )]
    pub(super) fn ebv(
        &self,
        _expression: &SrlExpression,
        _solution: &Solution,
        _guard: &mut ExecutionGuard<'_>,
    ) -> Result<Option<bool>, SrlError> {
        Err(SrlError::Unsupported(
            "FILTER and SET execution requires the `sparql` crate feature".to_owned(),
        ))
    }

    #[cfg(feature = "sparql")]
    fn begin(&self, solution_id: u64, guard: &ExecutionGuard<'_>) -> Result<(), SrlError> {
        let mut callback = self.callback.lock().map_err(lock_error)?;
        callback.solution_id = solution_id;
        callback.pending_memory = 0;
        callback.remaining_memory = guard.remaining_allocation_memory();
        callback.memory_limit = guard.memory_limit();
        callback.cancellation = guard.callback_cancellation_token();
        let timeout = guard.callback_timeout();
        callback.timeout_started = Instant::now();
        callback.timeout_remaining = timeout.map(|(remaining, _)| remaining);
        callback.timeout_limit = timeout.map_or(0, |(_, limit)| limit);
        callback.failure = None;
        Ok(())
    }

    #[cfg(feature = "sparql")]
    fn finish(&self, guard: &mut ExecutionGuard<'_>) -> Result<(), SrlError> {
        let (memory, failure) = {
            let mut callback = self.callback.lock().map_err(lock_error)?;
            (callback.pending_memory, callback.failure.take())
        };
        guard.memory(memory)?;
        failure.map_or(Ok(()), Err)
    }
}

#[cfg(feature = "sparql")]
fn prepare_query(
    source: &str,
    expression: &SrlExpression,
    guard: &mut ExecutionGuard<'_>,
) -> Result<(Query, Vec<Variable>), SrlError> {
    guard.query(source)?;
    let mut query = SparqlParser::new()
        .with_version(SparqlVersion::current())
        .parse_query(source)
        .map_err(|error| {
            SrlError::Unsupported(format!(
                "SRL expression could not be mapped to SPARQL: {error}"
            ))
        })?;
    let mut names = BTreeSet::new();
    expression.variables(&mut names);
    let variables = names
        .into_iter()
        .map(Variable::new)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| SrlError::WellFormed(error.to_string()))?;
    crate::sparql::expose_prebound_variables(&mut query, &variables);
    Ok((query, variables))
}

#[cfg(feature = "sparql")]
fn evaluate_bnode(arguments: &[Term], callback: &Arc<Mutex<BnodeCallback>>) -> Option<Term> {
    let mut callback = callback.lock().ok()?;
    if callback.failure.is_some() {
        return None;
    }
    if callback.cancellation.is_cancelled() {
        callback.failure = Some(crate::ValidationError::Cancelled.into());
        return None;
    }
    if callback
        .timeout_remaining
        .is_some_and(|remaining| callback.timeout_started.elapsed() >= remaining)
    {
        callback.failure = Some(
            crate::ValidationError::LimitExceeded {
                kind: crate::LimitKind::Time,
                limit: callback.timeout_limit,
            }
            .into(),
        );
        return None;
    }
    let key = match arguments {
        [] => None,
        [Term::Literal(value)] if *value.datatype() == xsd::STRING => {
            Some(format!("bnode:{}:{}", callback.solution_id, value.value()))
        }
        _ => return None,
    };
    let blanks = Arc::clone(&callback.blanks);
    let allocated = {
        let Ok(mut blanks) = blanks.lock() else {
            callback.failure = Some(lock_error(()));
            return None;
        };
        match key {
            Some(key) => blanks.for_key_with_limit(key, callback.remaining_memory),
            None => blanks.fresh_with_limit(callback.remaining_memory),
        }
    };
    match allocated {
        Ok(Some((node, memory))) => {
            callback.pending_memory = callback.pending_memory.saturating_add(memory);
            callback.remaining_memory = callback.remaining_memory.saturating_sub(memory);
            Some(node.into())
        }
        Ok(None) => {
            callback.failure = Some(
                crate::ValidationError::LimitExceeded {
                    kind: crate::LimitKind::EstimatedMemory,
                    limit: callback.memory_limit,
                }
                .into(),
            );
            None
        }
        Err(error) => {
            callback.failure = Some(error);
            None
        }
    }
}

#[cfg(feature = "sparql")]
fn lock_error<T>(_: T) -> SrlError {
    SrlError::Unsupported("SRL BNODE callback lock failed".to_owned())
}

#[cfg(feature = "sparql")]
fn expression_source(expression: &SrlExpression, now: &str) -> Result<String, SrlError> {
    Ok(match expression {
        SrlExpression::Node(node) => node_source(node)?,
        SrlExpression::Unary { operator, operand } => {
            let operator = match operator {
                SrlUnaryOperator::Not => "!",
                SrlUnaryOperator::Plus => "+",
                SrlUnaryOperator::Minus => "-",
            };
            format!("{operator}({})", expression_source(operand, now)?)
        }
        SrlExpression::Binary {
            operator,
            left,
            right,
        } => {
            let operator = match operator {
                SrlBinaryOperator::Or => "||",
                SrlBinaryOperator::And => "&&",
                SrlBinaryOperator::Equal => "=",
                SrlBinaryOperator::NotEqual => "!=",
                SrlBinaryOperator::Less => "<",
                SrlBinaryOperator::Greater => ">",
                SrlBinaryOperator::LessOrEqual => "<=",
                SrlBinaryOperator::GreaterOrEqual => ">=",
                SrlBinaryOperator::Add => "+",
                SrlBinaryOperator::Subtract => "-",
                SrlBinaryOperator::Multiply => "*",
                SrlBinaryOperator::Divide => "/",
            };
            format!(
                "({} {operator} {})",
                expression_source(left, now)?,
                expression_source(right, now)?
            )
        }
        SrlExpression::In {
            value,
            values,
            negated,
        } => {
            let values = values
                .iter()
                .map(|value| expression_source(value, now))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            format!(
                "({} {}IN ({values}))",
                expression_source(value, now)?,
                if *negated { "NOT " } else { "" }
            )
        }
        SrlExpression::Call { function, .. } if function.eq_ignore_ascii_case("NOW") => {
            now.to_owned()
        }
        SrlExpression::Call {
            function,
            arguments,
        } if function.eq_ignore_ascii_case("BNODE") => {
            let arguments = arguments
                .iter()
                .map(|argument| expression_source(argument, now))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            format!("<{BNODE_FUNCTION}>({arguments})")
        }
        SrlExpression::Call {
            function,
            arguments,
        } => {
            let function = if function.contains(':') {
                NamedNodeSource::render(function)?
            } else {
                function.clone()
            };
            let arguments = arguments
                .iter()
                .map(|argument| expression_source(argument, now))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            format!("{function}({arguments})")
        }
    })
}

#[cfg(feature = "sparql")]
fn node_source(node: &SrlNode) -> Result<String, SrlError> {
    match node {
        SrlNode::Variable(variable) => Ok(format!("?{variable}")),
        SrlNode::Constant(_) => Ok(node.as_term()?.to_string()),
        SrlNode::TripleTerm(triple) => {
            let predicate = match &triple.predicate {
                SrlPredicate::Node(predicate) => node_source(predicate)?,
                SrlPredicate::Path(_) => {
                    return Err(SrlError::Unsupported(
                        "property path inside an SRL triple-term expression".to_owned(),
                    ));
                }
            };
            Ok(format!(
                "<<( {} {predicate} {} )>>",
                node_source(&triple.subject)?,
                node_source(&triple.object)?
            ))
        }
        _ => Err(SrlError::Unsupported(
            "collection, property-list, annotation, or reification in an SRL expression".to_owned(),
        )),
    }
}

#[cfg(feature = "sparql")]
struct NamedNodeSource;

#[cfg(feature = "sparql")]
impl NamedNodeSource {
    fn render(value: &str) -> Result<String, SrlError> {
        NamedNode::new(value.to_owned())
            .map(|node| node.to_string())
            .map_err(|error| SrlError::Unsupported(error.to_string()))
    }
}

#[cfg(test)]
#[cfg(feature = "sparql")]
mod tests {
    use super::super::head::HeadBuilder;
    use super::*;
    use crate::{LimitKind, ValidationError, ValidationOptions};

    #[test]
    fn callback_stops_before_a_denied_selected_allocation() {
        let graph = Dataset::new();
        let heads = HeadBuilder::new_with_execution(&graph, "control");
        let allocator = heads.blank_allocator();
        let runtime = ExpressionRuntime::new(Arc::clone(&allocator));
        let first_cost = "oxshacl-srl-control-node-0".len() + 64;
        let mut options = ValidationOptions::default();
        options.limits.max_estimated_memory_bytes = first_cost;
        let mut guard = ExecutionGuard::new(&options, &graph).unwrap();
        runtime.begin(1, &guard).unwrap();

        assert!(evaluate_bnode(&[], &runtime.callback).is_some());
        assert!(evaluate_bnode(&[], &runtime.callback).is_none());
        assert!(evaluate_bnode(&[], &runtime.callback).is_none());
        assert_eq!(allocator.lock().unwrap().next(), 1);
        assert!(matches!(
            runtime.finish(&mut guard),
            Err(SrlError::Validation(ValidationError::LimitExceeded {
                kind: LimitKind::EstimatedMemory,
                limit,
            })) if limit == first_cost
        ));
    }
}
