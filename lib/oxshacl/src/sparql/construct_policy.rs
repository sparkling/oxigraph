use crate::control::ValidationError;
use spargebra::algebra::{AggregateExpression, Expression, OrderExpression, QueryExpression};
use spargebra::{Query, SparqlParser};

pub(crate) fn parse(query: &str) -> Result<Query, ValidationError> {
    let parsed = SparqlParser::new()
        .parse_query(query)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?;
    let Query::Construct(construct) = &parsed else {
        return Err(ValidationError::IllFormed(
            "sh:construct must contain a SPARQL CONSTRUCT query".to_owned(),
        ));
    };
    if parsed.dataset().is_some() {
        return Err(ValidationError::UnsupportedFeature(
            "FROM is forbidden in the isolated SHACL-SPARQL profile".to_owned(),
        ));
    }
    check_pattern(&construct.expression)?;
    Ok(parsed)
}

#[expect(
    clippy::allow_attributes,
    reason = "the Rust lint is conditional on dependency feature unification"
)]
#[allow(
    clippy::match_wildcard_for_single_variants,
    unreachable_patterns,
    reason = "dependency feature unification can add SPARQL 1.2 graph-pattern variants"
)]
fn check_pattern(pattern: &QueryExpression) -> Result<(), ValidationError> {
    match pattern {
        QueryExpression::Bgp { .. }
        | QueryExpression::Path { .. }
        | QueryExpression::Values { .. } => Ok(()),
        QueryExpression::Join { left, right }
        | QueryExpression::Union { left, right }
        | QueryExpression::Minus { left, right } => {
            check_pattern(left)?;
            check_pattern(right)
        }
        QueryExpression::LeftJoin {
            left,
            right,
            expression,
        } => {
            check_pattern(left)?;
            check_pattern(right)?;
            if let Some(expression) = expression {
                check_expression(expression)?;
            }
            Ok(())
        }
        QueryExpression::Graph { inner, .. }
        | QueryExpression::Project { inner, .. }
        | QueryExpression::Distinct { inner }
        | QueryExpression::Reduced { inner }
        | QueryExpression::Slice { inner, .. } => check_pattern(inner),
        QueryExpression::Filter { expr, inner } => {
            check_pattern(inner)?;
            check_expression(expr)
        }
        QueryExpression::Extend {
            inner, expression, ..
        } => {
            check_pattern(inner)?;
            check_expression(expression)
        }
        QueryExpression::OrderBy { inner, expression } => {
            check_pattern(inner)?;
            for expression in expression {
                let (OrderExpression::Asc(expression) | OrderExpression::Desc(expression)) =
                    expression;
                check_expression(expression)?;
            }
            Ok(())
        }
        QueryExpression::Group {
            inner, aggregates, ..
        } => {
            check_pattern(inner)?;
            for (_, aggregate) in aggregates {
                if let AggregateExpression::FunctionCall { expr, .. } = aggregate {
                    check_expression(expr)?;
                }
            }
            Ok(())
        }
        QueryExpression::Service { .. } => Err(ValidationError::UnsupportedFeature(
            "SERVICE is disabled in the isolated SHACL-SPARQL profile".to_owned(),
        )),
        _ => Err(ValidationError::UnsupportedFeature(
            "SPARQL LATERAL is not yet available in the isolated SHACL-SPARQL profile".to_owned(),
        )),
    }
}

fn check_expression(expression: &Expression) -> Result<(), ValidationError> {
    match expression {
        Expression::NamedNode(_)
        | Expression::Literal(_)
        | Expression::Variable(_)
        | Expression::Bound(_) => Ok(()),
        Expression::Or(left, right) | Expression::And(left, right) => {
            check_expression(left)?;
            check_expression(right)
        }
        Expression::In(left, right) => {
            check_expression(left)?;
            for expression in right {
                check_expression(expression)?;
            }
            Ok(())
        }
        Expression::Exists(pattern) => check_pattern(pattern),
        Expression::If(condition, then_branch, else_branch) => {
            check_expression(condition)?;
            check_expression(then_branch)?;
            check_expression(else_branch)
        }
        Expression::Coalesce(expressions) | Expression::FunctionCall(_, expressions) => {
            for expression in expressions {
                check_expression(expression)?;
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn construct_policy_is_structural_and_isolated() {
        parse("CONSTRUCT { <urn:s> <urn:p> \"SERVICE\" } WHERE { # SERVICE\n }").unwrap();
        for query in [
            "CONSTRUCT { ?s ?p ?o } WHERE { SERVICE <urn:service> { ?s ?p ?o } }",
            "CONSTRUCT { ?s ?p ?o } WHERE { FILTER EXISTS { SERVICE <urn:service> { ?s ?p ?o } } }",
            "CONSTRUCT { ?s ?p ?o } FROM <urn:graph> WHERE { ?s ?p ?o }",
        ] {
            assert!(matches!(
                parse(query),
                Err(ValidationError::UnsupportedFeature(_))
            ));
        }
    }
}
