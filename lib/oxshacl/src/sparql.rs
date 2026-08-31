use crate::constraint::literal_bool;
use crate::control::{Budget, LimitKind, ValidationError};
use crate::model::GraphSnapshot;
use crate::path::PropertyPath;
use crate::validate::evaluate::Violation;
use oxrdf::{Literal, NamedNode, Term, Variable};
use spareval::{QueryEvaluator, QueryResults};
use spargebra::{Query, SparqlParser};

mod annotations;
mod construct_policy;
mod policy;
mod prebinding;
mod runtime;
#[cfg(test)]
mod tests;

pub(crate) use self::annotations::ResultAnnotation;
pub(crate) use self::construct_policy::parse as parse_construct_policy;
pub(crate) use self::policy::substitute_path;
use self::policy::{ExpectedQuery, validate_query_policy};
pub(crate) use self::prebinding::expose_prebound_variables;
pub(crate) use self::runtime::{Watchdog, evaluate_node_expression, evaluate_node_function};

/// A validated SHACL-SPARQL `SELECT` constraint.
#[derive(Clone, Debug)]
pub struct SparqlConstraint {
    select: String,
    messages: Vec<Literal>,
    source: Option<Term>,
    severity: Option<NamedNode>,
    result_annotations: Vec<ResultAnnotation>,
    custom: Option<CustomConstraint>,
}

#[derive(Clone, Debug)]
struct CustomConstraint {
    ask: bool,
    bindings: Vec<(String, Option<Term>)>,
    component: NamedNode,
}

impl SparqlConstraint {
    /// Parses and policy-checks a SHACL-SPARQL `SELECT` constraint.
    ///
    /// The query must satisfy the processor's isolated-dataset and prebinding
    /// policy.
    pub fn new(select: impl Into<String>) -> Result<Self, ValidationError> {
        let select = select.into();
        validate_query_policy(&select, ExpectedQuery::Select, &["this"])?;
        Ok(Self {
            select,
            messages: Vec::new(),
            source: None,
            severity: None,
            result_annotations: Vec::new(),
            custom: None,
        })
    }

    pub(crate) fn new_custom(
        query: String,
        ask: bool,
        bindings: Vec<(String, Option<Term>)>,
        component: NamedNode,
        messages: Vec<Literal>,
        result_annotations: Vec<ResultAnnotation>,
    ) -> Result<Self, ValidationError> {
        let mut prebound = vec!["this"];
        if ask {
            prebound.push("value");
        }
        prebound.extend(bindings.iter().map(|(name, _)| name.as_str()));
        validate_custom_query(&query, ask, &prebound)?;
        let messages = messages
            .into_iter()
            .map(|message| interpolate_message(&message, &bindings))
            .collect();
        Ok(Self {
            select: query,
            messages,
            source: None,
            severity: None,
            result_annotations,
            custom: Some(CustomConstraint {
                ask,
                bindings,
                component,
            }),
        })
    }

    #[must_use]
    /// Sets fallback result messages.
    pub fn with_messages(mut self, messages: impl IntoIterator<Item = Literal>) -> Self {
        self.messages = messages.into_iter().collect();
        self
    }

    #[must_use]
    /// Sets the severity emitted by this constraint.
    pub fn with_severity(mut self, severity: NamedNode) -> Self {
        self.severity = Some(severity);
        self
    }

    /// Returns the validated query text.
    pub fn select(&self) -> &str {
        &self.select
    }

    pub(crate) fn component(&self) -> Option<&NamedNode> {
        self.custom.as_ref().map(|custom| &custom.component)
    }

    pub(crate) fn with_source(mut self, source: Term) -> Self {
        self.source = Some(source);
        self
    }

    pub(crate) fn with_result_annotations(mut self, annotations: Vec<ResultAnnotation>) -> Self {
        self.result_annotations = annotations;
        self
    }

    pub(crate) fn evaluate(
        &self,
        graph: &GraphSnapshot,
        focus: &Term,
        values: &[Term],
        budget: &mut Budget<'_>,
    ) -> Result<Vec<Violation>, ValidationError> {
        if self.select.len() > budget.limits().max_query_bytes {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::QueryBytes,
                limit: budget.limits().max_query_bytes,
            });
        }
        budget.check()?;
        if let Some(custom) = &self.custom {
            return self.evaluate_custom(custom, graph, focus, values, budget);
        }
        let mut query = SparqlParser::new()
            .parse_query(&self.select)
            .map_err(|error| ValidationError::Sparql(error.to_string()))?;
        if !matches!(query, Query::Select(_)) {
            return Err(ValidationError::UnsupportedFeature(
                "SHACL-SPARQL constraints require SELECT queries".to_owned(),
            ));
        }
        expose_prebound_variables(&mut query, &[Variable::new_unchecked("this")]);
        let cancellation = spareval::CancellationToken::new();
        let watchdog = Watchdog::start(cancellation.clone(), budget)?;
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_cancellation_token(cancellation);
        let dataset = graph.isolated_default_dataset();
        let results = evaluator
            .prepare(&query)
            .substitute_variable(Variable::new_unchecked("this"), focus.clone())
            .execute(&dataset)
            .map_err(|error| ValidationError::Sparql(error.to_string()))?;
        let QueryResults::Solutions(solutions) = results else {
            return Err(ValidationError::Sparql(
                "SELECT query did not produce solutions".to_owned(),
            ));
        };
        let mut violations = Vec::new();
        for solution in solutions {
            budget.query_solution()?;
            let solution = solution.map_err(|error| ValidationError::Sparql(error.to_string()))?;
            violations.push(self.map_solution(&solution, focus, values, None)?);
        }
        watchdog.finish();
        budget.check()?;
        Ok(violations)
    }

    fn evaluate_custom(
        &self,
        custom: &CustomConstraint,
        graph: &GraphSnapshot,
        focus: &Term,
        values: &[Term],
        budget: &mut Budget<'_>,
    ) -> Result<Vec<Violation>, ValidationError> {
        if custom.ask {
            let mut parsed = SparqlParser::new()
                .parse_query(&self.select)
                .map_err(|error| ValidationError::Sparql(error.to_string()))?;
            let mut variables = vec![
                Variable::new_unchecked("this"),
                Variable::new_unchecked("value"),
            ];
            variables.extend(
                custom
                    .bindings
                    .iter()
                    .map(|(name, _)| Variable::new_unchecked(name.clone())),
            );
            expose_prebound_variables(&mut parsed, &variables);
            let mut violations = Vec::new();
            for value in values {
                let cancellation = spareval::CancellationToken::new();
                let watchdog = Watchdog::start(cancellation.clone(), budget)?;
                let evaluator = QueryEvaluator::new()
                    .without_optimizations()
                    .with_cancellation_token(cancellation);
                let dataset = graph.isolated_default_dataset();
                let mut prepared = evaluator
                    .prepare(&parsed)
                    .substitute_variable(Variable::new_unchecked("this"), focus.clone())
                    .substitute_variable(Variable::new_unchecked("value"), value.clone());
                for (name, binding) in &custom.bindings {
                    if let Some(binding) = binding {
                        prepared = prepared.substitute_variable(
                            Variable::new_unchecked(name.clone()),
                            binding.clone(),
                        );
                    }
                }
                let results = prepared
                    .execute(&dataset)
                    .map_err(|error| ValidationError::Sparql(error.to_string()))?;
                watchdog.finish();
                budget.check()?;
                match results {
                    QueryResults::Boolean(true) => {}
                    QueryResults::Boolean(false) => {
                        let mut violation = Violation::value(value.clone());
                        let mut bindings = vec![
                            ("this".to_owned(), Some(focus.clone())),
                            ("value".to_owned(), Some(value.clone())),
                        ];
                        bindings.extend(custom.bindings.iter().cloned());
                        violation.messages = self
                            .messages
                            .iter()
                            .map(|message| interpolate_message(message, &bindings))
                            .collect();
                        violation.severity.clone_from(&self.severity);
                        self.apply_result_annotations(None, &mut violation.annotations);
                        violations.push(violation);
                    }
                    _ => {
                        return Err(ValidationError::Sparql(
                            "custom ASK validator did not produce a boolean".to_owned(),
                        ));
                    }
                }
            }
            return Ok(violations);
        }
        let mut parsed = SparqlParser::new()
            .parse_query(&self.select)
            .map_err(|error| ValidationError::Sparql(error.to_string()))?;
        let mut variables = vec![Variable::new_unchecked("this")];
        variables.extend(
            custom
                .bindings
                .iter()
                .map(|(name, _)| Variable::new_unchecked(name.clone())),
        );
        expose_prebound_variables(&mut parsed, &variables);
        let cancellation = spareval::CancellationToken::new();
        let watchdog = Watchdog::start(cancellation.clone(), budget)?;
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_cancellation_token(cancellation);
        let dataset = graph.isolated_default_dataset();
        let mut prepared = evaluator
            .prepare(&parsed)
            .substitute_variable(Variable::new_unchecked("this"), focus.clone());
        for (name, binding) in &custom.bindings {
            if let Some(binding) = binding {
                prepared = prepared
                    .substitute_variable(Variable::new_unchecked(name.clone()), binding.clone());
            }
        }
        let QueryResults::Solutions(solutions) = prepared
            .execute(&dataset)
            .map_err(|error| ValidationError::Sparql(error.to_string()))?
        else {
            return Err(ValidationError::Sparql(
                "custom SELECT validator did not produce solutions".to_owned(),
            ));
        };
        let mut violations = Vec::new();
        for solution in solutions {
            budget.query_solution()?;
            let solution = solution.map_err(|error| ValidationError::Sparql(error.to_string()))?;
            violations.push(self.map_solution(&solution, focus, values, Some(custom))?);
        }
        watchdog.finish();
        budget.check()?;
        Ok(violations)
    }

    fn map_solution(
        &self,
        solution: &spareval::QuerySolution,
        focus: &Term,
        values: &[Term],
        custom: Option<&CustomConstraint>,
    ) -> Result<Violation, ValidationError> {
        if solution.get("failure").is_some_and(term_is_true) {
            return Err(ValidationError::Sparql(
                "SHACL-SPARQL solution requested validation failure".to_owned(),
            ));
        }
        let result_focus = solution.get("this").ok_or_else(|| {
            ValidationError::Sparql(
                "a SHACL-SPARQL result has no binding for projected variable ?this".to_owned(),
            )
        })?;
        if result_focus != focus {
            return Err(ValidationError::Sparql(
                "a SHACL-SPARQL result rebound ?this".to_owned(),
            ));
        }

        let mut violation = Violation::empty_value();
        violation.value = if let Some(value) = solution.get("value") {
            Some(value.clone())
        } else {
            match values {
                [] => None,
                [value] => Some(value.clone()),
                _ => {
                    return Err(ValidationError::Sparql(
                        "a SHACL-SPARQL result without ?value is ambiguous for multiple value nodes"
                            .to_owned(),
                    ));
                }
            }
        };
        violation.source_constraint.clone_from(&self.source);
        violation.severity.clone_from(&self.severity);
        if let Some(Term::NamedNode(path)) = solution.get("path") {
            violation.path = Some(PropertyPath::Predicate(path.clone()));
        }

        let mut bindings = solution
            .iter()
            .map(|(variable, term)| (variable.as_str().to_owned(), Some(term.clone())))
            .collect::<Vec<_>>();
        if let Some(custom) = custom {
            bindings.extend(custom.bindings.iter().cloned());
        }
        if let Some(Term::Literal(message)) = solution.get("message") {
            violation
                .messages
                .push(interpolate_message(message, &bindings));
        } else if solution.get("message").is_some() {
            return Err(ValidationError::IllFormed(
                "?message must be a literal".to_owned(),
            ));
        } else {
            violation.messages = self
                .messages
                .iter()
                .map(|message| interpolate_message(message, &bindings))
                .collect();
        }
        self.apply_result_annotations(Some(solution), &mut violation.annotations);
        Ok(violation)
    }

    fn apply_result_annotations(
        &self,
        solution: Option<&spareval::QuerySolution>,
        output: &mut Vec<(NamedNode, Term)>,
    ) {
        for annotation in &self.result_annotations {
            annotation.append(solution, output);
        }
    }
}

pub(crate) fn validate_custom_query(
    query: &str,
    ask: bool,
    prebound: &[&str],
) -> Result<(), ValidationError> {
    validate_query_policy(
        query,
        if ask {
            ExpectedQuery::Ask
        } else {
            ExpectedQuery::Select
        },
        prebound,
    )
}

fn term_is_true(term: &Term) -> bool {
    matches!(term, Term::Literal(literal) if literal_bool(literal) == Some(true))
}

fn interpolate_message(message: &Literal, bindings: &[(String, Option<Term>)]) -> Literal {
    let mut value = message.value().to_owned();
    for (name, term) in bindings {
        let replacement = term.as_ref().map_or_else(String::new, parameter_text);
        value = value
            .replace(&format!("{{?{name}}}"), &replacement)
            .replace(&format!("{{${name}}}"), &replacement);
    }
    rebuild_literal(message, value)
}

fn parameter_text(term: &Term) -> String {
    if let Term::Literal(literal) = term {
        literal.value().to_owned()
    } else if let Term::NamedNode(node) = term {
        node.as_str().to_owned()
    } else if let Term::BlankNode(node) = term {
        node.as_str().to_owned()
    } else {
        term.to_string()
    }
}

#[cfg(feature = "rdf-12")]
fn rebuild_literal(source: &Literal, value: String) -> Literal {
    if let Some(language) = source.language() {
        if let Some(direction) = source.direction() {
            return Literal::new_directional_language_tagged_literal_unchecked(
                value,
                language.to_owned(),
                direction,
            );
        }
        return Literal::new_language_tagged_literal_unchecked(value, language.to_owned());
    }
    Literal::new_typed_literal(value, source.datatype().clone())
}

#[cfg(not(feature = "rdf-12"))]
fn rebuild_literal(source: &Literal, value: String) -> Literal {
    if let Some(language) = source.language() {
        return Literal::new_language_tagged_literal_unchecked(value, language.to_owned());
    }
    Literal::new_typed_literal(value, source.datatype().clone())
}
