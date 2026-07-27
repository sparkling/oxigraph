use super::super::rdf::{RdfView, as_literal, sh};
use super::syntax::{active_predicates, validate_properties, validate_select_query};
use crate::NodeExpression;
use crate::control::{Budget, ValidationError};
use oxrdf::Term;

const SPARQL: &str = "http://www.w3.org/ns/sparql#";

impl RdfView<'_> {
    pub(super) fn select_expression(
        &self,
        node: &crate::ShapeId,
    ) -> Result<Option<NodeExpression>, ValidationError> {
        if let Some(select) = self.optional_one(node, &sh("select"))? {
            validate_properties(
                self,
                node,
                "select expression",
                &[sh("select"), sh("prefixes")],
                &[sh("select")],
            )?;
            let select = as_literal(select, &sh("select"))?;
            super::super::syntax::require_xsd_string(&select, "sh:select")?;
            let query = self.apply_sparql_prefixes(node, select.value())?;
            validate_select_query(&query)?;
            return Ok(Some(NodeExpression::SparqlSelect(query)));
        }
        if let Some(expression) = self.optional_one(node, &sh("sparqlExpr"))? {
            validate_properties(
                self,
                node,
                "SPARQL expr expression",
                &[sh("sparqlExpr"), sh("prefixes")],
                &[sh("sparqlExpr")],
            )?;
            let expression = as_literal(expression, &sh("sparqlExpr"))?;
            super::super::syntax::require_xsd_string(&expression, "sh:sparqlExpr")?;
            let query = format!("SELECT ({} AS ?value) WHERE {{ }}", expression.value());
            let query = self.apply_sparql_prefixes(node, &query)?;
            validate_select_query(&query)?;
            return Ok(Some(NodeExpression::SparqlSelect(query)));
        }
        Ok(None)
    }

    pub(super) fn sparql_function_call(
        &self,
        node: &crate::ShapeId,
        budget: &mut Budget<'_>,
        max_items: usize,
    ) -> Result<Option<(String, Vec<Term>)>, ValidationError> {
        let predicates = active_predicates(self, node);
        let calls = predicates
            .iter()
            .filter(|predicate| predicate.starts_with(SPARQL))
            .collect::<Vec<_>>();
        if calls.is_empty() {
            return Ok(None);
        }
        let [predicate] = calls.as_slice() else {
            return Err(ValidationError::IllFormed(
                "SPARQL node expression must have exactly one function".to_owned(),
            ));
        };
        if predicates.len() != 1 {
            return Err(ValidationError::IllFormed(
                "SPARQL node expression must be the subject of exactly one triple".to_owned(),
            ));
        }
        let local = predicate.strip_prefix(SPARQL).unwrap_or_default();
        let object = self.exactly_one(node, predicate)?;
        let argument_terms = if self.is_list_node(&object) {
            self.list(&object, budget, max_items)?
        } else {
            vec![object]
        };
        let variables = (0..argument_terms.len())
            .map(|index| format!("?__shacl_arg_{index}"))
            .collect::<Vec<_>>();
        Ok(Some((
            render_sparql_call(local, &variables)?,
            argument_terms,
        )))
    }
}

fn render_sparql_call(local: &str, arguments: &[String]) -> Result<String, ValidationError> {
    let binary = match local {
        "plus" => Some("+"),
        "subtract" => Some("-"),
        "multiply" => Some("*"),
        "divide" => Some("/"),
        "equals" => Some("="),
        "not-equals" => Some("!="),
        "less-than" => Some("<"),
        "less-than-or-equal" => Some("<="),
        "greater-than" => Some(">"),
        "greater-than-or-equal" => Some(">="),
        "logical-and" => Some("&&"),
        "logical-or" => Some("||"),
        _ => None,
    };
    if let Some(operator) = binary {
        let [left, right] = arguments else {
            return Err(ValidationError::IllFormed(format!(
                "sparql:{local} requires two arguments"
            )));
        };
        return Ok(format!("({left} {operator} {right})"));
    }
    if matches!(local, "unary-plus" | "unary-minus" | "logical-not") {
        let [argument] = arguments else {
            return Err(ValidationError::IllFormed(format!(
                "sparql:{local} requires one argument"
            )));
        };
        let operator = match local {
            "unary-plus" => "+",
            "unary-minus" => "-",
            _ => "!",
        };
        return Ok(format!("({operator}{argument})"));
    }
    if local == "hasLang"
        && let [value, language_range] = arguments
    {
        return Ok(format!("langMatches(lang({value}), {language_range})"));
    }
    if local == "sameValue"
        && let [left, right] = arguments
    {
        return Ok(format!("({left} = {right})"));
    }
    let function = match local {
        "encode" => "ENCODE_FOR_URI",
        "isURI" => "isIRI",
        value => value,
    };
    Ok(format!("{}({})", function, arguments.join(", ")))
}
