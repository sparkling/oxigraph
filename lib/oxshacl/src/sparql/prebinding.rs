use oxrdf::Variable;
use spargebra::Query;
use spargebra::algebra::{AggregateExpression, Expression, OrderExpression, QueryExpression};

pub(crate) fn expose_prebound_variables(query: &mut Query, variables: &[Variable]) {
    // spareval can substitute RDF terms (including blank nodes) only for variables
    // exposed by the algebra. A one-row UNDEF table is an identity join that
    // exposes the variables at each leaf without serializing terms into SPARQL.
    // Extending projections keeps those bindings visible through subqueries.
    let pattern = match query {
        Query::Select(query) => &mut query.expression,
        Query::Ask(query) => &mut query.expression,
        Query::Construct(query) => &mut query.expression,
        Query::Describe(_) => return,
    };
    *pattern = expose_in_pattern(std::mem::take(pattern), variables);
}

#[expect(
    clippy::allow_attributes,
    reason = "the Rust lint is conditional on dependency feature unification"
)]
#[allow(
    clippy::match_wildcard_for_single_variants,
    unreachable_patterns,
    reason = "dependency-unified LATERAL is rejected by policy before pre-binding"
)]
fn expose_in_pattern(pattern: QueryExpression, variables: &[Variable]) -> QueryExpression {
    match pattern {
        leaf @ (QueryExpression::Bgp { .. }
        | QueryExpression::Path { .. }
        | QueryExpression::Values { .. }) => QueryExpression::Join {
            left: Box::new(leaf),
            right: Box::new(unbound_registration(variables)),
        },
        QueryExpression::Join { left, right } => QueryExpression::Join {
            left: Box::new(expose_in_pattern(*left, variables)),
            right: Box::new(expose_in_pattern(*right, variables)),
        },
        QueryExpression::LeftJoin {
            left,
            right,
            expression,
        } => QueryExpression::LeftJoin {
            left: Box::new(expose_in_pattern(*left, variables)),
            right: Box::new(expose_in_pattern(*right, variables)),
            expression: expression.map(|expression| expose_in_expression(expression, variables)),
        },
        QueryExpression::Union { left, right } => QueryExpression::Union {
            left: Box::new(expose_in_pattern(*left, variables)),
            right: Box::new(expose_in_pattern(*right, variables)),
        },
        QueryExpression::Minus { left, right } => QueryExpression::Minus {
            left: Box::new(expose_in_pattern(*left, variables)),
            right: Box::new(expose_in_pattern(*right, variables)),
        },
        QueryExpression::Graph { name, inner } => QueryExpression::Join {
            left: Box::new(QueryExpression::Graph {
                name,
                inner: Box::new(expose_in_pattern(*inner, variables)),
            }),
            right: Box::new(unbound_registration(variables)),
        },
        QueryExpression::Filter { expr, inner } => QueryExpression::Filter {
            expr: expose_in_expression(expr, variables),
            inner: Box::new(expose_in_pattern(*inner, variables)),
        },
        QueryExpression::Extend {
            inner,
            variable,
            expression,
        } => QueryExpression::Extend {
            inner: Box::new(expose_in_pattern(*inner, variables)),
            variable,
            expression: expose_in_expression(expression, variables),
        },
        QueryExpression::OrderBy { inner, expression } => QueryExpression::OrderBy {
            inner: Box::new(expose_in_pattern(*inner, variables)),
            expression: expression
                .into_iter()
                .map(|expression| match expression {
                    OrderExpression::Asc(expression) => {
                        OrderExpression::Asc(expose_in_expression(expression, variables))
                    }
                    OrderExpression::Desc(expression) => {
                        OrderExpression::Desc(expose_in_expression(expression, variables))
                    }
                })
                .collect(),
        },
        QueryExpression::Project {
            inner,
            variables: mut projected,
        } => {
            for variable in variables {
                if !projected.contains(variable) {
                    projected.push(variable.clone());
                }
            }
            QueryExpression::Project {
                inner: Box::new(expose_in_pattern(*inner, variables)),
                variables: projected,
            }
        }
        QueryExpression::Distinct { inner } => QueryExpression::Distinct {
            inner: Box::new(expose_in_pattern(*inner, variables)),
        },
        QueryExpression::Reduced { inner } => QueryExpression::Reduced {
            inner: Box::new(expose_in_pattern(*inner, variables)),
        },
        QueryExpression::Slice {
            inner,
            offset,
            limit,
        } => QueryExpression::Slice {
            inner: Box::new(expose_in_pattern(*inner, variables)),
            offset,
            limit,
        },
        QueryExpression::Group {
            inner,
            variables: mut grouped,
            aggregates,
        } => {
            for variable in variables {
                if !grouped.contains(variable) {
                    grouped.push(variable.clone());
                }
            }
            QueryExpression::Group {
                inner: Box::new(expose_in_pattern(*inner, variables)),
                variables: grouped,
                aggregates: aggregates
                    .into_iter()
                    .map(|(variable, aggregate)| {
                        (
                            variable,
                            match aggregate {
                                AggregateExpression::CountSolutions { distinct } => {
                                    AggregateExpression::CountSolutions { distinct }
                                }
                                AggregateExpression::FunctionCall {
                                    name,
                                    expr,
                                    distinct,
                                    scalarvals,
                                } => AggregateExpression::FunctionCall {
                                    name,
                                    expr: expose_in_expression(expr, variables),
                                    distinct,
                                    scalarvals,
                                },
                            },
                        )
                    })
                    .collect(),
            }
        }
        QueryExpression::Service {
            name,
            inner,
            silent,
        } => QueryExpression::Service {
            name,
            inner: Box::new(expose_in_pattern(*inner, variables)),
            silent,
        },
        other => other,
    }
}

fn expose_in_expression(expression: Expression, variables: &[Variable]) -> Expression {
    match expression {
        terminal @ (Expression::NamedNode(_)
        | Expression::Literal(_)
        | Expression::Variable(_)
        | Expression::Bound(_)) => terminal,
        Expression::Or(left, right) => Expression::Or(
            Box::new(expose_in_expression(*left, variables)),
            Box::new(expose_in_expression(*right, variables)),
        ),
        Expression::And(left, right) => Expression::And(
            Box::new(expose_in_expression(*left, variables)),
            Box::new(expose_in_expression(*right, variables)),
        ),
        Expression::In(left, right) => Expression::In(
            Box::new(expose_in_expression(*left, variables)),
            right
                .into_iter()
                .map(|expression| expose_in_expression(expression, variables))
                .collect(),
        ),
        Expression::Exists(pattern) => {
            Expression::Exists(Box::new(expose_in_pattern(*pattern, variables)))
        }
        Expression::If(condition, then_branch, else_branch) => Expression::If(
            Box::new(expose_in_expression(*condition, variables)),
            Box::new(expose_in_expression(*then_branch, variables)),
            Box::new(expose_in_expression(*else_branch, variables)),
        ),
        Expression::Coalesce(expressions) => Expression::Coalesce(
            expressions
                .into_iter()
                .map(|expression| expose_in_expression(expression, variables))
                .collect(),
        ),
        Expression::FunctionCall(function, expressions) => Expression::FunctionCall(
            function,
            expressions
                .into_iter()
                .map(|expression| expose_in_expression(expression, variables))
                .collect(),
        ),
    }
}

fn unbound_registration(variables: &[Variable]) -> QueryExpression {
    QueryExpression::Values {
        variables: variables.to_vec(),
        bindings: vec![vec![None; variables.len()]],
    }
}
