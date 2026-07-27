use crate::control::{Budget, LimitKind, ValidationError};
use crate::model::{GraphSnapshot, ShapeId};
use crate::path::{PropertyPath, deduplicate, term_key};
use oxrdf::{Literal, NamedNode, Term};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

mod cardinality;
mod custom;
mod environment;
mod numeric;
mod ordering;

use self::cardinality::single_argument;
pub use self::custom::{CustomNodeExpression, CustomNodeExpressionKind};
pub use self::environment::ExpressionEnvironment;
use self::numeric::sum_terms;
pub(crate) use self::ordering::compare_terms;

/// A compiled SHACL node expression.
///
/// Evaluation always yields an ordered sequence of RDF terms. Expressions that
/// require a single argument reject multi-valued input during validation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NodeExpression {
    /// Produces no terms.
    Empty,
    /// Produces one fixed RDF term.
    Constant(Term),
    /// Produces the current focus node.
    Focus,
    /// Looks up a variable in the expression environment.
    Variable(String),
    /// Looks up a custom-function argument by its RDF key.
    Argument(Term),
    /// Invokes a compiled custom node expression.
    Custom(CustomNodeExpression),
    /// Concatenates the outputs of the listed expressions.
    List(Vec<Self>),
    /// Evaluates a property path from the node produced by `nodes`.
    PathValues {
        /// Expression producing the path's start node.
        nodes: Box<Self>,
        /// Property path to follow.
        path: PropertyPath,
    },
    /// Produces `true` when the nested expression has at least one result.
    Exists(Box<Self>),
    /// Selects one of two expressions using the condition's effective boolean value.
    If {
        /// Expression whose output chooses the branch.
        condition: Box<Self>,
        /// Expression evaluated when the condition is true.
        then_expression: Box<Self>,
        /// Expression evaluated when the condition is false.
        else_expression: Box<Self>,
    },
    /// Removes duplicate terms while preserving first-occurrence order.
    Distinct(Box<Self>),
    /// Produces terms present in every nested expression.
    Intersection(Vec<Self>),
    /// Concatenates the outputs of the nested expressions.
    Concat(Vec<Self>),
    /// Removes terms produced by one expression from another sequence.
    Remove {
        /// Expression producing the candidate terms.
        input: Box<Self>,
        /// Expression producing terms to remove.
        remove: Box<Self>,
    },
    /// Keeps input terms that conform to a shape.
    FilterShape {
        /// Expression producing candidate terms.
        input: Box<Self>,
        /// Shape used as the filter predicate.
        shape: ShapeId,
    },
    /// Keeps at most the first `count` input terms.
    Limit {
        /// Expression producing the input sequence.
        input: Box<Self>,
        /// Maximum number of output terms.
        count: usize,
    },
    /// Skips the first `count` input terms.
    Offset {
        /// Expression producing the input sequence.
        input: Box<Self>,
        /// Number of terms to skip.
        count: usize,
    },
    /// Sorts input terms by an expression evaluated for each term.
    OrderBy {
        /// Expression producing the input sequence.
        input: Box<Self>,
        /// Expression producing each term's sort key.
        key: Box<Self>,
        /// Whether to reverse the ascending order.
        descending: bool,
    },
    /// Evaluates an expression once for each input term and concatenates results.
    FlatMap {
        /// Expression producing the input sequence.
        input: Box<Self>,
        /// Variable bound to each input term.
        variable: String,
        /// Expression evaluated under each binding.
        expression: Box<Self>,
    },
    /// Produces the number of terms returned by the nested expression.
    Count(Box<Self>),
    /// Produces the minimum term, or no term for empty input.
    Min(Box<Self>),
    /// Produces the maximum term, or no term for empty input.
    Max(Box<Self>),
    /// Produces the numeric sum of the nested expression's terms.
    Sum(Box<Self>),
    /// Produces graph nodes that are instances of the given class.
    InstancesOf(NamedNode),
    /// Produces graph nodes that conform to the given shape.
    NodesMatching(ShapeId),
    /// Produces a boolean indicating whether a computed node conforms to a computed shape.
    ConformsToShape {
        /// Expression producing the node to validate.
        node: Box<Self>,
        /// Expression producing the shape IRI.
        shape: Box<Self>,
    },
    /// Produces the first input term conforming to a shape.
    FindFirst {
        /// Expression producing candidate terms.
        input: Box<Self>,
        /// Shape used to test candidates.
        shape: ShapeId,
    },
    /// Produces all input terms if every input term conforms, otherwise no terms.
    MatchAll {
        /// Expression producing candidate terms.
        input: Box<Self>,
        /// Shape each candidate must conform to.
        shape: ShapeId,
    },
    /// Evaluates a SHACL-SPARQL `SELECT` node expression.
    #[cfg(feature = "sparql")]
    SparqlSelect(String),
    /// Evaluates a SPARQL expression with positional node-expression arguments.
    #[cfg(feature = "sparql")]
    SparqlFunction {
        /// SPARQL expression text.
        expression: String,
        /// Node expressions supplying positional arguments.
        arguments: Vec<Self>,
    },
}

pub(crate) trait ExpressionContext {
    fn conforms(
        &mut self,
        shape: &ShapeId,
        node: &Term,
        budget: &mut Budget<'_>,
        depth: usize,
    ) -> Result<bool, ValidationError>;

    fn instances_of(
        &mut self,
        class: &NamedNode,
        budget: &mut Budget<'_>,
    ) -> Result<Vec<Term>, ValidationError>;

    fn all_nodes(&mut self, budget: &mut Budget<'_>) -> Result<Vec<Term>, ValidationError>;
}

impl NodeExpression {
    pub(crate) fn evaluate(
        &self,
        graph: &GraphSnapshot,
        focus: &Term,
        environment: &ExpressionEnvironment,
        context: &mut impl ExpressionContext,
        budget: &mut Budget<'_>,
        depth: usize,
        max_depth: usize,
    ) -> Result<Vec<Term>, ValidationError> {
        budget.check()?;
        if depth > max_depth {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: max_depth,
            });
        }
        let next = depth.saturating_add(1);
        let output = match self {
            Self::Empty => Vec::new(),
            Self::Constant(term) => vec![term.clone()],
            Self::Focus => vec![focus.clone()],
            Self::Variable(name)
                if name == "focusNode" && !environment.is_explicitly_unbound(name) =>
            {
                vec![focus.clone()]
            }
            Self::Variable(name) => environment.get(name).cloned().into_iter().collect(),
            Self::Argument(key) => custom::evaluate_argument(
                key,
                graph,
                focus,
                environment,
                context,
                budget,
                next,
                max_depth,
            )?,
            Self::Custom(expression) => {
                expression.evaluate(graph, focus, environment, context, budget, next, max_depth)?
            }
            Self::List(expressions) | Self::Concat(expressions) => {
                let mut output = Vec::new();
                for expression in expressions {
                    output.extend(expression.evaluate(
                        graph,
                        focus,
                        environment,
                        context,
                        budget,
                        next,
                        max_depth,
                    )?);
                }
                output
            }
            Self::PathValues { nodes, path } => {
                let nodes =
                    nodes.evaluate(graph, focus, environment, context, budget, next, max_depth)?;
                match nodes.as_slice() {
                    [] => Vec::new(),
                    [node] => {
                        path.evaluate(graph, std::iter::once(node.clone()), budget, max_depth)?
                    }
                    _ => {
                        return Err(ValidationError::IllFormed(
                            "path values expression produced more than one focus node".to_owned(),
                        ));
                    }
                }
            }
            Self::Exists(expression) => vec![bool_term(
                !expression
                    .evaluate(graph, focus, environment, context, budget, next, max_depth)?
                    .is_empty(),
            )],
            Self::If {
                condition,
                then_expression,
                else_expression,
            } => {
                let condition = condition.evaluate(
                    graph,
                    focus,
                    environment,
                    context,
                    budget,
                    next,
                    max_depth,
                )?;
                let selected = if is_true_list(&condition) {
                    then_expression
                } else {
                    else_expression
                };
                selected.evaluate(graph, focus, environment, context, budget, next, max_depth)?
            }
            Self::Distinct(expression) => deduplicate(expression.evaluate(
                graph,
                focus,
                environment,
                context,
                budget,
                next,
                max_depth,
            )?),
            Self::Intersection(expressions) => {
                let mut iterator = expressions.iter();
                let Some(first) = iterator.next() else {
                    return Ok(Vec::new());
                };
                let mut intersection = deduplicate(first.evaluate(
                    graph,
                    focus,
                    environment,
                    context,
                    budget,
                    next,
                    max_depth,
                )?);
                for expression in iterator {
                    let values = keys(&expression.evaluate(
                        graph,
                        focus,
                        environment,
                        context,
                        budget,
                        next,
                        max_depth,
                    )?);
                    intersection.retain(|value| values.contains_key(&term_key(value)));
                }
                intersection
            }
            Self::Remove { input, remove } => {
                let removed =
                    remove.evaluate(graph, focus, environment, context, budget, next, max_depth)?;
                let removed = removed.iter().map(term_key).collect::<BTreeSet<_>>();
                input
                    .evaluate(graph, focus, environment, context, budget, next, max_depth)?
                    .into_iter()
                    .filter(|term| !removed.contains(&term_key(term)))
                    .collect()
            }
            Self::FilterShape { input, shape } => {
                let mut output = Vec::new();
                for node in
                    input.evaluate(graph, focus, environment, context, budget, next, max_depth)?
                {
                    if context.conforms(shape, &node, budget, next)? {
                        output.push(node);
                    }
                }
                output
            }
            Self::Limit { input, count } => input
                .evaluate(graph, focus, environment, context, budget, next, max_depth)?
                .into_iter()
                .take(*count)
                .collect(),
            Self::Offset { input, count } => input
                .evaluate(graph, focus, environment, context, budget, next, max_depth)?
                .into_iter()
                .skip(*count)
                .collect(),
            Self::OrderBy {
                input,
                key,
                descending,
            } => {
                let values =
                    input.evaluate(graph, focus, environment, context, budget, next, max_depth)?;
                let mut keyed = Vec::new();
                for value in values {
                    let mut environment = environment.clone();
                    environment.insert("focusNode", value.clone());
                    let keys = key.evaluate(
                        graph,
                        &value,
                        &environment,
                        context,
                        budget,
                        next,
                        max_depth,
                    )?;
                    keyed.push((keys.into_iter().next(), value));
                }
                keyed.sort_by(|(left, _), (right, _)| {
                    let order = match (left, right) {
                        (Some(left), Some(right)) => compare_terms(left, right)
                            .unwrap_or_else(|| term_key(left).cmp(&term_key(right))),
                        (None, None) => Ordering::Equal,
                        (None, Some(_)) => Ordering::Less,
                        (Some(_), None) => Ordering::Greater,
                    };
                    if *descending { order.reverse() } else { order }
                });
                keyed.into_iter().map(|(_, value)| value).collect()
            }
            Self::FlatMap {
                input,
                variable,
                expression,
            } => {
                let mut output = Vec::new();
                for value in
                    input.evaluate(graph, focus, environment, context, budget, next, max_depth)?
                {
                    let mut environment = environment.clone();
                    environment.insert(variable, value.clone());
                    output.extend(expression.evaluate(
                        graph,
                        &value,
                        &environment,
                        context,
                        budget,
                        next,
                        max_depth,
                    )?);
                }
                output
            }
            Self::Count(expression) => {
                let count = expression
                    .evaluate(graph, focus, environment, context, budget, next, max_depth)?
                    .len();
                vec![Term::Literal(Literal::from(
                    i64::try_from(count).unwrap_or(i64::MAX),
                ))]
            }
            Self::Min(expression) | Self::Max(expression) => {
                let values = expression.evaluate(
                    graph,
                    focus,
                    environment,
                    context,
                    budget,
                    next,
                    max_depth,
                )?;
                let select_min = matches!(self, Self::Min(_));
                values
                    .into_iter()
                    .reduce(|left, right| match compare_terms(&left, &right) {
                        Some(Ordering::Greater) if select_min => right,
                        Some(Ordering::Less) if !select_min => right,
                        _ => left,
                    })
                    .into_iter()
                    .collect()
            }
            Self::Sum(expression) => {
                let values = expression.evaluate(
                    graph,
                    focus,
                    environment,
                    context,
                    budget,
                    next,
                    max_depth,
                )?;
                vec![Term::Literal(sum_terms(&values)?)]
            }
            Self::InstancesOf(class) => context.instances_of(class, budget)?,
            Self::NodesMatching(shape) => {
                let mut output = Vec::new();
                for node in context.all_nodes(budget)? {
                    if context.conforms(shape, &node, budget, next)? {
                        output.push(node);
                    }
                }
                output
            }
            Self::ConformsToShape { node, shape } => {
                let nodes =
                    node.evaluate(graph, focus, environment, context, budget, next, max_depth)?;
                let shapes =
                    shape.evaluate(graph, focus, environment, context, budget, next, max_depth)?;
                let Some(node) = single_argument(nodes, "node")? else {
                    return Ok(Vec::new());
                };
                let Some(shape) = single_argument(shapes, "shape")? else {
                    return Ok(Vec::new());
                };
                let Term::NamedNode(shape) = shape else {
                    return Err(ValidationError::IllFormed(
                        "conformsToShape shape argument must produce an IRI".to_owned(),
                    ));
                };
                vec![bool_term(context.conforms(
                    &ShapeId::from(shape),
                    &node,
                    budget,
                    next,
                )?)]
            }
            Self::FindFirst { input, shape } => {
                let nodes =
                    input.evaluate(graph, focus, environment, context, budget, next, max_depth)?;
                let mut output = Vec::new();
                for node in nodes {
                    if context.conforms(shape, &node, budget, next)? {
                        output.push(node);
                        break;
                    }
                }
                output
            }
            Self::MatchAll { input, shape } => {
                let nodes =
                    input.evaluate(graph, focus, environment, context, budget, next, max_depth)?;
                let mut matches = true;
                for node in nodes {
                    if !context.conforms(shape, &node, budget, next)? {
                        matches = false;
                        break;
                    }
                }
                vec![bool_term(matches)]
            }
            #[cfg(feature = "sparql")]
            Self::SparqlSelect(query) => {
                crate::sparql::evaluate_node_expression(query, graph, Some(focus), budget)?
            }
            #[cfg(feature = "sparql")]
            Self::SparqlFunction {
                expression,
                arguments,
            } => {
                let mut values = Vec::with_capacity(arguments.len());
                for argument in arguments {
                    let output = argument.evaluate(
                        graph,
                        focus,
                        environment,
                        context,
                        budget,
                        next,
                        max_depth,
                    )?;
                    if output.len() > 1 {
                        return Err(ValidationError::IllFormed(
                            "SPARQL list-parameter argument produced more than one output node"
                                .to_owned(),
                        ));
                    }
                    values.push(output.into_iter().next());
                }
                crate::sparql::evaluate_node_function(expression, &values, graph, budget)?
            }
        };
        budget.charge_memory(output.iter().map(term_estimate).sum())?;
        Ok(output)
    }
}

pub(crate) fn is_true_list(terms: &[Term]) -> bool {
    matches!(
        terms,
        [Term::Literal(literal)]
            if literal.datatype().as_str() == "http://www.w3.org/2001/XMLSchema#boolean"
                && matches!(literal.value(), "true" | "1")
    )
}

fn bool_term(value: bool) -> Term {
    Term::Literal(Literal::from(value))
}

fn keys(terms: &[Term]) -> BTreeMap<String, Term> {
    terms
        .iter()
        .cloned()
        .map(|term| (term_key(&term), term))
        .collect()
}

fn term_estimate(term: &Term) -> usize {
    32_usize.saturating_add(term.to_string().len())
}
