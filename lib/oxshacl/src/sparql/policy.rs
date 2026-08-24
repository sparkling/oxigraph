use crate::control::ValidationError;
use spargebra::algebra::{AggregateExpression, Expression, OrderExpression, QueryExpression};
use spargebra::term::NamedNodePattern;
use spargebra::{Query, SparqlParser};
use std::collections::BTreeSet;

#[derive(Clone, Copy)]
pub(super) enum ExpectedQuery {
    Ask,
    Select,
}

pub(super) fn validate_query_policy(
    query: &str,
    expected: ExpectedQuery,
    prebound: &[&str],
) -> Result<(), ValidationError> {
    let parsed = SparqlParser::new()
        .parse_query(query)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?;
    let pattern = match (&parsed, expected) {
        (Query::Select(select), ExpectedQuery::Select) => {
            let mut projects_this = false;
            select
                .expression
                .on_in_scope_variable(|variable| projects_this |= variable.as_str() == "this");
            if !projects_this {
                return Err(ValidationError::IllFormed(
                    "SHACL-SPARQL SELECT must project ?this".to_owned(),
                ));
            }
            &select.expression
        }
        (Query::Ask(ask), ExpectedQuery::Ask) => &ask.expression,
        (_, ExpectedQuery::Select) => {
            return Err(ValidationError::IllFormed(
                "SHACL-SPARQL constraint must be a SELECT query".to_owned(),
            ));
        }
        (_, ExpectedQuery::Ask) => {
            return Err(ValidationError::IllFormed(
                "SHACL-SPARQL ASK validator must be an ASK query".to_owned(),
            ));
        }
    };
    if parsed.dataset().is_some() {
        return Err(ValidationError::UnsupportedFeature(
            "FROM is forbidden in the isolated SHACL-SPARQL profile".to_owned(),
        ));
    }
    let prebound = prebound.iter().copied().collect::<BTreeSet<_>>();
    // spargebra represents every top-level query with a Project node. It is
    // not a subquery and must not be subjected to the nested SELECT rule.
    let inner = match pattern {
        QueryExpression::Project { inner, .. } => inner.as_ref(),
        _ => pattern,
    };
    check_pattern(inner, &prebound)
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
fn check_pattern(
    pattern: &QueryExpression,
    prebound: &BTreeSet<&str>,
) -> Result<(), ValidationError> {
    match pattern {
        QueryExpression::Bgp { .. } | QueryExpression::Path { .. } => Ok(()),
        QueryExpression::Join { left, right } | QueryExpression::Union { left, right } => {
            check_pattern(left, prebound)?;
            check_pattern(right, prebound)
        }
        QueryExpression::LeftJoin {
            left,
            right,
            expression,
        } => {
            check_pattern(left, prebound)?;
            check_pattern(right, prebound)?;
            if let Some(expression) = expression {
                check_expression(expression, prebound)?;
            }
            Ok(())
        }
        QueryExpression::Graph { inner, .. }
        | QueryExpression::Distinct { inner }
        | QueryExpression::Reduced { inner }
        | QueryExpression::Slice { inner, .. } => check_pattern(inner, prebound),
        QueryExpression::Filter { expr, inner } => {
            check_pattern(inner, prebound)?;
            check_expression(expr, prebound)
        }
        QueryExpression::OrderBy { inner, expression } => {
            check_pattern(inner, prebound)?;
            for expression in expression {
                let (OrderExpression::Asc(expression) | OrderExpression::Desc(expression)) =
                    expression;
                check_expression(expression, prebound)?;
            }
            Ok(())
        }
        QueryExpression::Project { inner, variables } => {
            if !variables.iter().any(|variable| variable.as_str() == "this") {
                return Err(ValidationError::UnsupportedFeature(
                    "SHACL-SPARQL subqueries must project ?this".to_owned(),
                ));
            }
            check_pattern(inner, prebound)
        }
        QueryExpression::Extend {
            inner,
            variable,
            expression,
        } => {
            reject_prebound("AS", variable.as_str(), prebound)?;
            check_pattern(inner, prebound)?;
            check_expression(expression, prebound)
        }
        QueryExpression::Group {
            inner, aggregates, ..
        } => {
            check_pattern(inner, prebound)?;
            for (variable, aggregate) in aggregates {
                reject_prebound("AS", variable.as_str(), prebound)?;
                if let AggregateExpression::FunctionCall { expr, .. } = aggregate {
                    check_expression(expr, prebound)?;
                }
            }
            Ok(())
        }
        QueryExpression::Values { .. } => Err(ValidationError::UnsupportedFeature(
            "VALUES is forbidden in SHACL-SPARQL queries".to_owned(),
        )),
        QueryExpression::Minus { .. } => Err(ValidationError::UnsupportedFeature(
            "MINUS is forbidden in SHACL-SPARQL queries".to_owned(),
        )),
        QueryExpression::Service { .. } => Err(ValidationError::UnsupportedFeature(
            "SERVICE is disabled in the isolated SHACL-SPARQL profile".to_owned(),
        )),
        _ => Err(ValidationError::UnsupportedFeature(
            "SPARQL LATERAL is not yet available in the isolated SHACL-SPARQL profile".to_owned(),
        )),
    }
}

fn check_expression(
    expression: &Expression,
    prebound: &BTreeSet<&str>,
) -> Result<(), ValidationError> {
    match expression {
        Expression::NamedNode(_)
        | Expression::Literal(_)
        | Expression::Variable(_)
        | Expression::Bound(_) => Ok(()),
        Expression::Or(left, right) | Expression::And(left, right) => {
            check_expression(left, prebound)?;
            check_expression(right, prebound)
        }
        Expression::In(left, right) => {
            check_expression(left, prebound)?;
            for expression in right {
                check_expression(expression, prebound)?;
            }
            Ok(())
        }
        Expression::Exists(pattern) => check_pattern(pattern, prebound),
        Expression::If(condition, then_branch, else_branch) => {
            check_expression(condition, prebound)?;
            check_expression(then_branch, prebound)?;
            check_expression(else_branch, prebound)
        }
        Expression::Coalesce(expressions) | Expression::FunctionCall(_, expressions) => {
            for expression in expressions {
                check_expression(expression, prebound)?;
            }
            Ok(())
        }
    }
}

fn reject_prebound(
    construct: &str,
    variable: &str,
    prebound: &BTreeSet<&str>,
) -> Result<(), ValidationError> {
    if prebound.contains(variable) {
        return Err(ValidationError::UnsupportedFeature(format!(
            "{construct} may not rebind the potentially pre-bound variable ?{variable}"
        )));
    }
    Ok(())
}

pub(crate) fn substitute_path(query: &str, surface: &str) -> Result<String, ValidationError> {
    let parsed = SparqlParser::new()
        .parse_query(query)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?;
    let (rewritten, occurrences) = replace_path_variables(query, surface);
    if occurrences == 0 {
        return Ok(rewritten);
    }
    let pattern = match &parsed {
        Query::Select(query) => &query.expression,
        Query::Ask(query) => &query.expression,
        Query::Construct(query) => &query.expression,
        Query::Describe(query) => &query.pattern,
    };
    if legal_path_predicates(pattern) != occurrences {
        return Err(ValidationError::IllFormed(
            "PATH may only occur in predicate position of a triple pattern".to_owned(),
        ));
    }
    SparqlParser::new()
        .parse_query(&rewritten)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?;
    Ok(rewritten)
}

#[expect(
    clippy::allow_attributes,
    reason = "the Rust lint is conditional on dependency feature unification"
)]
#[allow(
    unreachable_patterns,
    reason = "dependency feature unification can add SPARQL 1.2 graph-pattern variants"
)]
fn legal_path_predicates(pattern: &QueryExpression) -> usize {
    match pattern {
        QueryExpression::Bgp { patterns } => patterns
            .iter()
            .filter(|pattern| {
                matches!(
                    &pattern.predicate,
                    NamedNodePattern::Variable(variable) if variable.as_str() == "PATH"
                )
            })
            .count(),
        QueryExpression::Join { left, right }
        | QueryExpression::Union { left, right }
        | QueryExpression::Minus { left, right } => {
            legal_path_predicates(left) + legal_path_predicates(right)
        }
        QueryExpression::LeftJoin {
            left,
            right,
            expression,
        } => {
            legal_path_predicates(left)
                + legal_path_predicates(right)
                + expression
                    .as_ref()
                    .map_or(0, legal_path_predicates_expression)
        }
        QueryExpression::Graph { inner, .. }
        | QueryExpression::Project { inner, .. }
        | QueryExpression::Distinct { inner }
        | QueryExpression::Reduced { inner }
        | QueryExpression::Slice { inner, .. }
        | QueryExpression::Service { inner, .. } => legal_path_predicates(inner),
        QueryExpression::Filter { expr, inner } => {
            legal_path_predicates(inner) + legal_path_predicates_expression(expr)
        }
        QueryExpression::Extend {
            inner, expression, ..
        } => legal_path_predicates(inner) + legal_path_predicates_expression(expression),
        QueryExpression::OrderBy { inner, expression } => {
            legal_path_predicates(inner)
                + expression
                    .iter()
                    .map(|expression| match expression {
                        OrderExpression::Asc(expression) | OrderExpression::Desc(expression) => {
                            legal_path_predicates_expression(expression)
                        }
                    })
                    .sum::<usize>()
        }
        QueryExpression::Group {
            inner, aggregates, ..
        } => {
            legal_path_predicates(inner)
                + aggregates
                    .iter()
                    .map(|(_, aggregate)| match aggregate {
                        AggregateExpression::CountSolutions { .. } => 0,
                        AggregateExpression::FunctionCall { expr, .. } => {
                            legal_path_predicates_expression(expr)
                        }
                    })
                    .sum::<usize>()
        }
        // VALUES and property paths contain no replaceable BGP predicate.
        // Dependency-unified LATERAL also returns zero, which makes any
        // textual $PATH occurrence fail the equality check in substitute_path.
        _ => 0,
    }
}

fn legal_path_predicates_expression(expression: &Expression) -> usize {
    match expression {
        Expression::NamedNode(_)
        | Expression::Literal(_)
        | Expression::Variable(_)
        | Expression::Bound(_) => 0,
        Expression::Or(left, right) | Expression::And(left, right) => {
            legal_path_predicates_expression(left) + legal_path_predicates_expression(right)
        }
        Expression::In(left, right) => {
            legal_path_predicates_expression(left)
                + right
                    .iter()
                    .map(legal_path_predicates_expression)
                    .sum::<usize>()
        }
        Expression::Exists(pattern) => legal_path_predicates(pattern),
        Expression::If(condition, then_branch, else_branch) => {
            legal_path_predicates_expression(condition)
                + legal_path_predicates_expression(then_branch)
                + legal_path_predicates_expression(else_branch)
        }
        Expression::Coalesce(expressions) | Expression::FunctionCall(_, expressions) => expressions
            .iter()
            .map(legal_path_predicates_expression)
            .sum(),
    }
}

fn replace_path_variables(query: &str, surface: &str) -> (String, usize) {
    let bytes = query.as_bytes();
    let mut output = String::with_capacity(query.len() + surface.len());
    let mut index = 0;
    let mut count = 0;
    while index < bytes.len() {
        if bytes[index] == b'#' {
            let end = query[index..]
                .find('\n')
                .map_or(bytes.len(), |offset| index + offset);
            output.push_str(&query[index..end]);
            index = end;
            continue;
        }
        if matches!(bytes[index], b'\'' | b'"') {
            let end = quoted_end(bytes, index);
            output.push_str(&query[index..end]);
            index = end;
            continue;
        }
        if bytes[index] == b'<'
            && bytes
                .get(index + 1)
                .is_some_and(|next| !next.is_ascii_whitespace() && *next != b'=')
        {
            let end = iri_end(bytes, index);
            output.push_str(&query[index..end]);
            index = end;
            continue;
        }
        if matches!(bytes[index], b'?' | b'$')
            && bytes
                .get(index + 1..index.saturating_add(5))
                .is_some_and(|name| name == b"PATH")
            && bytes
                .get(index + 5)
                .is_none_or(|next| !variable_byte(*next))
        {
            output.push_str(surface);
            index += 5;
            count += 1;
            continue;
        }
        let Some(character) = query[index..].chars().next() else {
            break;
        };
        output.push(character);
        index += character.len_utf8();
    }
    (output, count)
}

fn quoted_end(bytes: &[u8], start: usize) -> usize {
    let quote = bytes[start];
    let triple = bytes.get(start..start + 3) == Some(&[quote, quote, quote]);
    let width = if triple { 3 } else { 1 };
    let mut index = start + width;
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = index.saturating_add(2);
        } else if triple && bytes.get(index..index + 3) == Some(&[quote, quote, quote]) {
            return index + 3;
        } else if !triple && bytes[index] == quote {
            return index + 1;
        } else {
            index += 1;
        }
    }
    bytes.len()
}

fn iri_end(bytes: &[u8], start: usize) -> usize {
    let mut index = start + 1;
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = index.saturating_add(2);
        } else if bytes[index] == b'>' {
            return index + 1;
        } else {
            index += 1;
        }
    }
    start + 1
}

fn variable_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || !byte.is_ascii()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_forbidden_words_in_literals_and_comments() {
        validate_query_policy(
            "SELECT ?this WHERE { BIND(\"SERVICE MINUS VALUES\" AS ?text) # SERVICE\n }",
            ExpectedQuery::Select,
            &["this"],
        )
        .unwrap();
    }

    #[test]
    fn rejects_values_and_as_for_any_prebound_variable() {
        for query in [
            "SELECT ?this WHERE { VALUES (?this) { (<urn:x>) } }",
            "SELECT ?this WHERE { VALUES (?other) { (<urn:x>) } }",
            "SELECT (1 AS ?this) WHERE { }",
            "SELECT ?this WHERE { BIND(1 AS ?parameter) }",
        ] {
            let error = validate_query_policy(query, ExpectedQuery::Select, &["this", "parameter"])
                .unwrap_err();
            assert!(matches!(error, ValidationError::UnsupportedFeature(_)));
        }
    }

    #[test]
    fn rejects_forbidden_patterns_nested_in_expressions_and_aggregate_rebinding() {
        for query in [
            "SELECT ?this WHERE { FILTER EXISTS { SERVICE <urn:service> { ?this ?p ?o } } }",
            "SELECT ?this WHERE { FILTER EXISTS { ?this ?p ?o MINUS { ?this ?q ?o } } }",
            "SELECT (COUNT(*) AS ?this) WHERE { ?subject ?predicate ?object }",
        ] {
            let error = validate_query_policy(query, ExpectedQuery::Select, &["this"]).unwrap_err();
            assert!(matches!(error, ValidationError::UnsupportedFeature(_)));
        }
    }

    #[test]
    fn substitutes_only_legal_path_variables() {
        let rewritten = substitute_path(
            "SELECT ?this WHERE { ?this $PATH ?value . BIND(\"$PATH\" AS ?text) }",
            "(<urn:p>|<urn:q>)",
        )
        .unwrap();
        assert!(rewritten.contains("?this (<urn:p>|<urn:q>) ?value"));
        assert!(rewritten.contains("\"$PATH\""));

        let error =
            substitute_path("SELECT ?this WHERE { BIND($PATH AS ?value) }", "<urn:p>").unwrap_err();
        assert!(matches!(error, ValidationError::IllFormed(_)));

        let rewritten = substitute_path(
            "SELECT ?this WHERE { FILTER EXISTS { ?this $PATH ?value } }",
            "<urn:p>",
        )
        .unwrap();
        assert!(rewritten.contains("EXISTS { ?this <urn:p> ?value }"));
    }
}
