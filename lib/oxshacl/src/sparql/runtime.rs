#[cfg(test)]
use super::SparqlConstraint;
use crate::control::{Budget, LimitKind, ValidationError};
use crate::model::GraphSnapshot;
use oxrdf::{Term, Variable};
use spareval::{QueryEvaluator, QueryResults};
use spargebra::algebra::{Expression, QueryExpression};
use spargebra::{Query, SparqlParser};
#[cfg(not(target_family = "wasm"))]
use std::sync::Arc;
#[cfg(not(target_family = "wasm"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(not(target_family = "wasm"))]
use std::time::Instant;

/// Evaluates a `sh:select` body with the enclosing custom-function scope pre-bound.
///
/// Scope variables are pre-bound by name per shacl12-sparql
/// `SelectExpression-evaluation`; a scope variable named `this` is a failure
/// because `this` is reserved for the focus node.
pub(crate) fn evaluate_node_expression_in_scope(
    query: &str,
    graph: &GraphSnapshot,
    focus: Option<&Term>,
    environment: &crate::ExpressionEnvironment,
    budget: &mut Budget<'_>,
) -> Result<Vec<Term>, ValidationError> {
    for variable in environment.scope_variables() {
        if variable.as_str() == "this" {
            return Err(ValidationError::IllFormed(
                "a node-expression scope variable may not be named `this`".to_owned(),
            ));
        }
    }
    // A scope argument that produced no term contributes no substitution, so the
    // body sees the variable as unbound.
    let substitutions = environment.scope_substitutions();
    evaluate_node_expression_with_substitutions(query, graph, focus, &substitutions, budget)
}

fn evaluate_node_expression_with_substitutions(
    query: &str,
    graph: &GraphSnapshot,
    focus: Option<&Term>,
    substitutions: &[(Variable, Term)],
    budget: &mut Budget<'_>,
) -> Result<Vec<Term>, ValidationError> {
    if query.len() > budget.limits().max_query_bytes {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::QueryBytes,
            limit: budget.limits().max_query_bytes,
        });
    }
    // An aggregate projection cannot also project `?this`, so an injected
    // `?this` would make it invalid. Such a query is left as written and `this`
    // is pre-bound by substitution instead (shacl12-sparql
    // `SelectExpression-evaluation`).
    let aggregate = focus.is_some() && is_aggregate_projection(query);
    let query = match focus {
        Some(focus) if !aggregate => {
            let query = ensure_this_projection(query);
            bind_this(&replace_this_in_patterns(&query, focus), focus)?
        }
        _ => query.to_owned(),
    };
    let mut substitutions = substitutions.to_vec();
    if aggregate && let Some(focus) = focus {
        substitutions.push((Variable::new_unchecked("this"), focus.clone()));
    }
    let substitutions = substitutions.as_slice();
    let mut parsed = SparqlParser::new()
        .parse_query(&query)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?;
    let substitution_variables = substitutions
        .iter()
        .map(|(variable, _)| variable.clone())
        .collect::<Vec<_>>();
    super::expose_prebound_variables(&mut parsed, &substitution_variables);
    if !matches!(parsed, Query::Select(_)) {
        return Err(ValidationError::UnsupportedFeature(
            "node-expression sh:select must be SELECT".to_owned(),
        ));
    }
    let cancellation = spareval::CancellationToken::new();
    let watchdog = Watchdog::start(cancellation.clone(), budget)?;
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_cancellation_token(cancellation);
    let dataset = graph.isolated_default_dataset();
    let mut prepared = evaluator.prepare(&parsed);
    for (variable, term) in substitutions {
        prepared = prepared.substitute_variable(variable.clone(), term.clone());
    }
    let QueryResults::Solutions(solutions) = prepared
        .execute(&dataset)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?
    else {
        return Err(ValidationError::Sparql(
            "node expression did not return solutions".to_owned(),
        ));
    };
    let mut output = Vec::new();
    for solution in solutions {
        budget.query_solution()?;
        let solution = solution.map_err(|error| ValidationError::Sparql(error.to_string()))?;
        let values = solution
            .iter()
            .filter(|(variable, _)| {
                variable.as_str() != "this"
                    && !substitutions
                        .iter()
                        .any(|(substitution, _)| substitution == *variable)
            })
            .map(|(_, value)| value.clone())
            .collect::<Vec<_>>();
        let [value] = values.as_slice() else {
            return Err(ValidationError::IllFormed(
                "node-expression SELECT must bind exactly one variable per row".to_owned(),
            ));
        };
        output.push(value.clone());
    }
    watchdog.finish();
    Ok(output)
}

pub(crate) fn evaluate_node_function(
    expression: &str,
    arguments: &[Option<Term>],
    graph: &GraphSnapshot,
    budget: &mut Budget<'_>,
) -> Result<Vec<Term>, ValidationError> {
    let query = format!("SELECT ({expression} AS ?value) WHERE {{ }}");
    let substitutions = arguments
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            value.as_ref().map(|value| {
                (
                    Variable::new_unchecked(format!("__shacl_arg_{index}")),
                    value.clone(),
                )
            })
        })
        .collect::<Vec<_>>();
    let output = evaluate_scalar_expression(&query, arguments, graph, &substitutions, budget)?;
    if output.len() > 1 {
        return Err(ValidationError::IllFormed(
            "SPARQL list-parameter function produced more than one output node".to_owned(),
        ));
    }
    Ok(output)
}

fn evaluate_scalar_expression(
    query: &str,
    arguments: &[Option<Term>],
    graph: &GraphSnapshot,
    substitutions: &[(Variable, Term)],
    budget: &mut Budget<'_>,
) -> Result<Vec<Term>, ValidationError> {
    if query.len() > budget.limits().max_query_bytes {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::QueryBytes,
            limit: budget.limits().max_query_bytes,
        });
    }
    budget.check()?;
    let mut parsed = SparqlParser::new()
        .parse_query(query)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?;
    let result_variable = Variable::new_unchecked("value");
    let scalar_expression = scalar_projection_expression(&parsed, &result_variable)?;
    if strict_call_has_missing_operand(scalar_expression, arguments) {
        // The empty input still consumes the single conceptual scalar solution.
        budget.query_solution()?;
        budget.check()?;
        return Ok(Vec::new());
    }

    let substitution_variables = substitutions
        .iter()
        .map(|(variable, _)| variable.clone())
        .collect::<Vec<_>>();
    super::expose_prebound_variables(&mut parsed, &substitution_variables);
    let cancellation = spareval::CancellationToken::new();
    let watchdog = Watchdog::start(cancellation.clone(), budget)?;
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_cancellation_token(cancellation);
    let dataset = graph.isolated_default_dataset();
    let mut prepared = evaluator.prepare(&parsed);
    for (variable, term) in substitutions {
        prepared = prepared.substitute_variable(variable.clone(), term.clone());
    }
    let QueryResults::Solutions(solutions) = prepared
        .execute(&dataset)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?
    else {
        return Err(ValidationError::Sparql(
            "SPARQL scalar expression did not return solutions".to_owned(),
        ));
    };
    let mut output = None;
    for solution in solutions {
        budget.query_solution()?;
        let solution = solution.map_err(|error| ValidationError::Sparql(error.to_string()))?;
        if output.is_some() {
            return Err(ValidationError::IllFormed(
                "SPARQL list-parameter function produced more than one output node".to_owned(),
            ));
        }
        let value = solution.get(&result_variable).ok_or_else(|| {
            ValidationError::Sparql("SPARQL scalar expression evaluation failed".to_owned())
        })?;
        output = Some(value.clone());
    }
    watchdog.finish();
    budget.check()?;
    output.map_or_else(
        || {
            Err(ValidationError::Sparql(
                "SPARQL scalar expression produced no solution".to_owned(),
            ))
        },
        |value| Ok(vec![value]),
    )
}

fn scalar_projection_expression<'a>(
    query: &'a Query,
    result_variable: &Variable,
) -> Result<&'a Expression, ValidationError> {
    let Query::Select(select) = query else {
        return Err(ValidationError::Sparql(
            "SPARQL scalar expression must be SELECT".to_owned(),
        ));
    };
    let QueryExpression::Project { inner, variables } = &select.expression else {
        return Err(ValidationError::Sparql(
            "SPARQL scalar expression has an unexpected projection".to_owned(),
        ));
    };
    if variables.len() != 1 || &variables[0] != result_variable {
        return Err(ValidationError::Sparql(
            "SPARQL scalar expression must project only ?value".to_owned(),
        ));
    }
    let QueryExpression::Extend {
        variable,
        expression,
        ..
    } = inner.as_ref()
    else {
        return Err(ValidationError::Sparql(
            "SPARQL scalar expression has no value binding".to_owned(),
        ));
    };
    if variable != result_variable {
        return Err(ValidationError::Sparql(
            "SPARQL scalar expression binds an unexpected variable".to_owned(),
        ));
    }
    Ok(expression)
}

fn strict_call_has_missing_operand(
    expression: &Expression,
    arguments: &[Option<Term>],
) -> bool {
    if !strict_invocation_is_fully_supported(expression) {
        return false;
    }
    match expression {
        Expression::FunctionCall(function, operands)
            if known_strict_sparql_arity(function.as_str(), operands.len()) == Some(true) =>
        {
            operands
                .iter()
                .any(|operand| required_operand_is_missing(operand, arguments))
        }
        _ => false,
    }
}

fn required_operand_is_missing(expression: &Expression, arguments: &[Option<Term>]) -> bool {
    match expression {
        Expression::Variable(variable) => variable
            .as_str()
            .strip_prefix("__shacl_arg_")
            .and_then(|index| index.parse::<usize>().ok())
            .is_some_and(|index| arguments.get(index).is_some_and(Option::is_none)),
        Expression::FunctionCall(function, operands)
            if known_strict_sparql_arity(function.as_str(), operands.len()) == Some(true) =>
        {
            operands
                .iter()
                .any(|operand| required_operand_is_missing(operand, arguments))
        }
        Expression::Bound(_)
        | Expression::Coalesce(_)
        | Expression::If(_, _, _)
        | Expression::And(_, _)
        | Expression::Or(_, _)
        | Expression::In(_, _)
        | Expression::Exists(_)
        | Expression::NamedNode(_)
        | Expression::Literal(_)
        | Expression::FunctionCall(_, _) => false,
    }
}

fn strict_invocation_is_fully_supported(expression: &Expression) -> bool {
    match expression {
        Expression::FunctionCall(function, operands) => {
            known_strict_sparql_arity(function.as_str(), operands.len()) == Some(true)
                && operands.iter().all(strict_invocation_is_fully_supported)
        }
        Expression::In(value, choices) => {
            strict_invocation_is_fully_supported(value)
                && choices.iter().all(strict_invocation_is_fully_supported)
        }
        Expression::If(condition, then_branch, else_branch) => {
            strict_invocation_is_fully_supported(condition)
                && strict_invocation_is_fully_supported(then_branch)
                && strict_invocation_is_fully_supported(else_branch)
        }
        Expression::Coalesce(expressions) => {
            expressions.iter().all(strict_invocation_is_fully_supported)
        }
        Expression::And(left, right) | Expression::Or(left, right) => {
            strict_invocation_is_fully_supported(left)
                && strict_invocation_is_fully_supported(right)
        }
        Expression::Bound(_)
        | Expression::NamedNode(_)
        | Expression::Literal(_)
        | Expression::Variable(_) => true,
        Expression::Exists(_) => false,
    }
}

fn known_strict_sparql_arity(function: &str, arity: usize) -> Option<bool> {
    let local = function.strip_prefix("http://www.w3.org/ns/sparql#")?;
    Some(match local {
        "add"
        | "subtract"
        | "multiply"
        | "divide"
        | "equals"
        | "not-equals"
        | "greater-than"
        | "less-than"
        | "greater-than-or-equal"
        | "less-than-or-equal"
        | "sameTerm"
        | "langMatches"
        | "contains"
        | "strstarts"
        | "strends"
        | "strbefore"
        | "strafter"
        | "strlang"
        | "strdt" => arity == 2,
        "unary-minus"
        | "unary-plus"
        | "logical-not"
        | "isIRI"
        | "isURI"
        | "isBlank"
        | "isLiteral"
        | "isNumeric"
        | "str"
        | "lang"
        | "datatype"
        | "iri"
        | "uri"
        | "strlen"
        | "ucase"
        | "lcase"
        | "encodeForUri"
        | "abs"
        | "round"
        | "ceil"
        | "floor"
        | "year"
        | "month"
        | "day"
        | "hours"
        | "minutes"
        | "seconds"
        | "timezone"
        | "tz"
        | "md5"
        | "sha1"
        | "sha256"
        | "sha384"
        | "sha512" => arity == 1,
        "bnode" => arity <= 1,
        "rand" | "now" | "uuid" | "struuid" => arity == 0,
        "substr" | "regex" => (2..=3).contains(&arity),
        "replace" => (3..=4).contains(&arity),
        "concat" => true,
        #[cfg(feature = "rdf-12")]
        "triple" | "strlangdir" => arity == 3,
        #[cfg(feature = "rdf-12")]
        "langdir" | "hasLang" | "hasLangdir" | "subject" | "predicate" | "object"
        | "isTriple" => arity == 1,
        _ => return None,
    })
}

pub(super) fn bind_this(query: &str, focus: &Term) -> Result<String, ValidationError> {
    let upper = query.to_ascii_uppercase();
    let search_from = upper.find("WHERE").unwrap_or(0);
    let Some(relative) = query[search_from..].find('{') else {
        return Err(ValidationError::Sparql(
            "SHACL-SPARQL query has no group graph pattern".to_owned(),
        ));
    };
    let position = search_from + relative + 1;
    let mut bound = String::with_capacity(query.len() + focus.to_string().len() + 30);
    bound.push_str(&query[..position]);
    bound.push_str(" VALUES ?this { ");
    bound.push_str(&focus.to_string());
    bound.push_str(" } ");
    bound.push_str(&query[position..]);
    Ok(bound)
}

/// Whether the top-level SELECT groups its solutions (explicit GROUP BY or an
/// aggregate in the projection). Such a projection cannot list `?this`.
fn is_aggregate_projection(query: &str) -> bool {
    let Ok(Query::Select(select)) = SparqlParser::new().parse_query(query) else {
        return false;
    };
    let mut expression = &select.expression;
    loop {
        expression = match expression {
            QueryExpression::Project { inner, .. }
            | QueryExpression::Distinct { inner }
            | QueryExpression::Reduced { inner }
            | QueryExpression::Slice { inner, .. }
            | QueryExpression::OrderBy { inner, .. }
            | QueryExpression::Extend { inner, .. }
            | QueryExpression::Filter { inner, .. } => inner,
            QueryExpression::Group { .. } => return true,
            _ => return false,
        };
    }
}

fn ensure_this_projection(query: &str) -> String {
    let upper = query.to_ascii_uppercase();
    let Some(select) = upper.find("SELECT") else {
        return query.to_owned();
    };
    let tail = &upper[select + "SELECT".len()..];
    let projection = tail
        .split_once("WHERE")
        .map_or(tail, |(projection, _)| projection);
    if projection.contains("?THIS") || projection.contains("$THIS") {
        return query.to_owned();
    }
    let position = select + "SELECT".len();
    let mut output = String::with_capacity(query.len() + 7);
    output.push_str(&query[..position]);
    output.push_str(" ?this ");
    output.push_str(&query[position..]);
    output
}

pub(super) fn replace_this_in_patterns(query: &str, focus: &Term) -> String {
    let query = replace_ascii_case(query, "BOUND($THIS)", "(true)");
    let query = replace_ascii_case(&query, "BOUND(?THIS)", "(true)");
    let upper = query.to_ascii_uppercase();
    let mut projection_ranges = Vec::new();
    let mut offset = 0;
    while let Some(relative) = upper[offset..].find("SELECT") {
        let start = offset + relative;
        let after = start + "SELECT".len();
        let Some(where_relative) = upper[after..].find("WHERE") else {
            break;
        };
        let end = after + where_relative;
        projection_ranges.push(start..end);
        offset = end + "WHERE".len();
    }
    let replacement = focus.to_string();
    let bytes = query.as_bytes();
    let mut output = String::with_capacity(query.len() + replacement.len());
    let mut index = 0;
    while index < bytes.len() {
        let is_this = bytes[index] == b'?' || bytes[index] == b'$';
        let token_end = index.saturating_add(5);
        let in_projection = projection_ranges.iter().any(|range| range.contains(&index));
        if is_this
            && token_end <= bytes.len()
            && query[index + 1..token_end].eq_ignore_ascii_case("this")
            && !in_projection
        {
            output.push_str(&replacement);
            index = token_end;
        } else {
            let Some(character) = query[index..].chars().next() else {
                break;
            };
            output.push(character);
            index += character.len_utf8();
        }
    }
    output
}

fn replace_ascii_case(input: &str, needle: &str, replacement: &str) -> String {
    let upper = input.to_ascii_uppercase();
    let needle = needle.to_ascii_uppercase();
    let mut output = String::with_capacity(input.len());
    let mut offset = 0;
    while let Some(relative) = upper[offset..].find(&needle) {
        let position = offset + relative;
        output.push_str(&input[offset..position]);
        output.push_str(replacement);
        offset = position + needle.len();
    }
    output.push_str(&input[offset..]);
    output
}

pub(crate) struct Watchdog {
    #[cfg(not(target_family = "wasm"))]
    stop: Arc<AtomicBool>,
    #[cfg(not(target_family = "wasm"))]
    thread: Option<std::thread::JoinHandle<()>>,
    #[cfg(target_family = "wasm")]
    marker: (),
}

const SYNCHRONOUS_WASM_CONTROL_ERROR: &str = "SPARQL-backed SHACL execution is unavailable on synchronous WebAssembly because cooperative timeout and cancellation cannot be guaranteed";

fn ensure_sparql_control(
    budget: &Budget<'_>,
    cooperative_control_available: bool,
) -> Result<(), ValidationError> {
    budget.check()?;
    if cooperative_control_available {
        Ok(())
    } else {
        Err(ValidationError::UnsupportedFeature(
            SYNCHRONOUS_WASM_CONTROL_ERROR.to_owned(),
        ))
    }
}

impl Watchdog {
    #[cfg(not(target_family = "wasm"))]
    pub(crate) fn start(
        cancellation: spareval::CancellationToken,
        budget: &Budget<'_>,
    ) -> Result<Self, ValidationError> {
        ensure_sparql_control(budget, true)?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let stop = Arc::clone(&stop);
            let external = budget.cancellation_token();
            let timeout = budget.remaining_timeout();
            Some(std::thread::spawn(move || {
                let started = Instant::now();
                while !stop.load(Ordering::Acquire) {
                    if external.is_cancelled()
                        || timeout.is_some_and(|timeout| started.elapsed() >= timeout)
                    {
                        cancellation.cancel();
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
            }))
        };
        Ok(Self { stop, thread })
    }

    #[cfg(target_family = "wasm")]
    pub(crate) fn start(
        _cancellation: spareval::CancellationToken,
        budget: &Budget<'_>,
    ) -> Result<Self, ValidationError> {
        ensure_sparql_control(budget, false)?;
        Ok(Self { marker: () })
    }

    #[cfg(not(target_family = "wasm"))]
    pub(crate) fn finish(mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            drop(thread.join());
        }
    }

    #[cfg(target_family = "wasm")]
    pub(crate) fn finish(self) {
        let Self { marker } = self;
        marker
    }
}

#[cfg(not(target_family = "wasm"))]
impl Drop for Watchdog {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            drop(thread.join());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_service() {
        let error = SparqlConstraint::new(
            "SELECT ?this WHERE { SERVICE <https://example.com/> { ?this ?p ?o } }",
        )
        .unwrap_err();
        assert!(matches!(error, ValidationError::UnsupportedFeature(_)));
    }

    #[test]
    fn synchronous_wasm_control_policy_fails_closed() {
        let options = crate::ValidationOptions::default();
        let budget = Budget::new(&options).unwrap();
        let error = ensure_sparql_control(&budget, false).unwrap_err();
        assert!(matches!(
            error,
            ValidationError::UnsupportedFeature(message)
                if message == SYNCHRONOUS_WASM_CONTROL_ERROR
        ));
    }
}
