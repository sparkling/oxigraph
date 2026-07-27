use super::native::{ExecutionGuard, Solution};
#[cfg(feature = "sparql")]
use crate::srl::{SrlBinaryOperator, SrlNode, SrlPredicate, SrlUnaryOperator};
use crate::srl::{SrlError, SrlExpression};
use oxrdf::Term;
#[cfg(feature = "sparql")]
use std::collections::BTreeSet;

#[cfg(feature = "sparql")]
use oxrdf::{Dataset, Literal};
#[cfg(feature = "sparql")]
use spareval::{QueryEvaluator, QueryResults};
#[cfg(feature = "sparql")]
use spargebra::{SparqlParser, SparqlVersion};

pub(super) struct ExpressionRuntime {
    #[cfg(feature = "sparql")]
    evaluator: QueryEvaluator,
    #[cfg(feature = "sparql")]
    now: String,
}

impl ExpressionRuntime {
    pub(super) fn new() -> Self {
        Self {
            #[cfg(feature = "sparql")]
            evaluator: QueryEvaluator::new().with_version(SparqlVersion::current()),
            #[cfg(feature = "sparql")]
            now: Literal::from(oxsdatatypes::DateTime::now()).to_string(),
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
            "SELECT (({}) AS ?__srl_value) WHERE {{ {} }}",
            expression_source(expression, &self.now)?,
            values_clause(expression, solution)?
        );
        guard.query(&source)?;
        let query = SparqlParser::new()
            .with_version(SparqlVersion::current())
            .parse_query(&source)
            .map_err(|error| {
                SrlError::Unsupported(format!(
                    "SRL expression could not be mapped to SPARQL: {error}"
                ))
            })?;
        let prepared = self.evaluator.prepare(&query);
        let empty = Dataset::new();
        let QueryResults::Solutions(mut solutions) = prepared.execute(&empty).map_err(|error| {
            SrlError::Unsupported(format!("SRL expression evaluation failed: {error}"))
        })?
        else {
            return Err(SrlError::Unsupported(
                "SRL expression evaluator returned a non-solution result".to_owned(),
            ));
        };
        let Some(solution) = solutions.next() else {
            return Ok(None);
        };
        let solution = solution.map_err(|error| {
            SrlError::Unsupported(format!("SRL expression solution failed: {error}"))
        })?;
        Ok(solution.get("__srl_value").cloned())
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
            "ASK {{ {} FILTER({}) }}",
            values_clause(expression, solution)?,
            expression_source(expression, &self.now)?,
        );
        guard.query(&source)?;
        let query = SparqlParser::new()
            .with_version(SparqlVersion::current())
            .parse_query(&source)
            .map_err(|error| {
                SrlError::Unsupported(format!("SRL filter could not be mapped to SPARQL: {error}"))
            })?;
        let prepared = self.evaluator.prepare(&query);
        match prepared.execute(&Dataset::new()) {
            Ok(QueryResults::Boolean(value)) => Ok(Some(value)),
            Ok(_) => Err(SrlError::Unsupported(
                "SRL filter evaluator returned a non-boolean result".to_owned(),
            )),
            Err(_) => Ok(None),
        }
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
        SrlExpression::Call { function, .. } if function.eq_ignore_ascii_case("BNODE") => {
            return Err(SrlError::Unsupported(
                "BNODE expression results require evaluation-scoped blank-node identity".to_owned(),
            ));
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
        oxrdf::NamedNode::new(value.to_owned())
            .map(|node| node.to_string())
            .map_err(|error| SrlError::Unsupported(error.to_string()))
    }
}

#[cfg(feature = "sparql")]
fn values_clause(expression: &SrlExpression, solution: &Solution) -> Result<String, SrlError> {
    let mut variables = BTreeSet::new();
    expression.variables(&mut variables);
    if variables.is_empty() {
        return Ok(String::new());
    }
    let values = variables
        .iter()
        .map(|variable| {
            solution.get(variable).map(Term::to_string).ok_or_else(|| {
                SrlError::WellFormed(format!(
                    "expression variable `?{variable}` has no solution binding"
                ))
            })
        })
        .collect::<Result<Vec<_>, _>>()?
        .join(" ");
    let variables = variables
        .iter()
        .map(|variable| format!("?{variable}"))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(format!("VALUES ({variables}) {{ ({values}) }}"))
}
