use super::environment::ArgumentBinding;
use super::{ExpressionContext, ExpressionEnvironment, NodeExpression};
use crate::control::{Budget, ValidationError};
use crate::model::GraphSnapshot;
use crate::path::term_key;
use oxrdf::{NamedNode, Term};
use std::collections::BTreeMap;

/// Calling convention for a custom SHACL node expression.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CustomNodeExpressionKind {
    /// Arguments remain expressions and are resolved by named parameter.
    NamedParameter,
    /// Arguments are evaluated eagerly as zero-or-one-term lists.
    ListParameter,
}

/// A compiled custom SHACL node-expression invocation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CustomNodeExpression {
    function: NamedNode,
    kind: CustomNodeExpressionKind,
    arguments: Vec<(Term, NodeExpression)>,
    body: Box<NodeExpression>,
}

impl CustomNodeExpression {
    pub(crate) fn new(
        function: NamedNode,
        kind: CustomNodeExpressionKind,
        arguments: Vec<(Term, NodeExpression)>,
        body: NodeExpression,
    ) -> Self {
        Self {
            function,
            kind,
            arguments,
            body: Box::new(body),
        }
    }

    /// Returns the IRI identifying the custom function.
    pub fn function(&self) -> &NamedNode {
        &self.function
    }

    /// Returns the function's calling convention.
    pub fn kind(&self) -> CustomNodeExpressionKind {
        self.kind
    }

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
        let arguments = match self.kind {
            CustomNodeExpressionKind::NamedParameter => self
                .arguments
                .iter()
                .map(|(key, expression)| {
                    (
                        term_key(key),
                        ArgumentBinding::Expression(expression.clone()),
                    )
                })
                .collect(),
            CustomNodeExpressionKind::ListParameter => {
                let clean = environment.without_arguments();
                let mut bindings = BTreeMap::new();
                for (key, expression) in &self.arguments {
                    let values = expression
                        .evaluate(graph, focus, &clean, context, budget, depth, max_depth)?;
                    if values.len() > 1 {
                        return Err(ValidationError::IllFormed(format!(
                            "custom list-parameter function <{}> argument {} produced more than one output node",
                            self.function, key
                        )));
                    }
                    bindings.insert(term_key(key), ArgumentBinding::Values(values));
                }
                bindings
            }
        };
        let scoped = environment.with_arguments(arguments);
        let output = self
            .body
            .evaluate(graph, focus, &scoped, context, budget, depth, max_depth)?;
        if self.kind == CustomNodeExpressionKind::ListParameter && output.len() > 1 {
            return Err(ValidationError::IllFormed(format!(
                "custom list-parameter function <{}> produced more than one output node",
                self.function
            )));
        }
        Ok(output)
    }
}

pub(super) fn evaluate_argument(
    key: &Term,
    graph: &GraphSnapshot,
    focus: &Term,
    environment: &ExpressionEnvironment,
    context: &mut impl ExpressionContext,
    budget: &mut Budget<'_>,
    depth: usize,
    max_depth: usize,
) -> Result<Vec<Term>, ValidationError> {
    match environment.argument(&term_key(key)).cloned() {
        Some(ArgumentBinding::Expression(expression)) => expression.evaluate(
            graph,
            focus,
            &environment.without_arguments(),
            context,
            budget,
            depth,
            max_depth,
        ),
        Some(ArgumentBinding::Values(values)) => Ok(values),
        None => Ok(Vec::new()),
    }
}
