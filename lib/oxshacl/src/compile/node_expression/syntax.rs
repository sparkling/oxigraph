use super::super::rdf::{RdfView, as_literal, shnex};
use crate::ShapeId;
use crate::control::ValidationError;
use oxrdf::Term;
#[cfg(feature = "sparql")]
use spargebra::{Query, SparqlParser};
use std::collections::BTreeSet;

pub(super) fn validate_signature(
    view: &RdfView<'_>,
    node: &ShapeId,
    function: &str,
) -> Result<(), ValidationError> {
    let (allowed, required): (&[&str], &[&str]) = match function {
        "var" => (&["var"], &["var"]),
        "pathValues" => (&["pathValues", "focusNode"], &["pathValues"]),
        "if" => (&["if", "then", "else"], &["if"]),
        "remove" => (&["remove", "nodes"], &["remove", "nodes"]),
        "filterShape" => (&["filterShape", "nodes"], &["filterShape", "nodes"]),
        "limit" => (&["limit", "nodes"], &["limit", "nodes"]),
        "offset" => (&["offset", "nodes"], &["offset", "nodes"]),
        "orderBy" => (&["orderBy", "nodes", "desc"], &["orderBy", "nodes"]),
        "flatMap" => (&["flatMap", "nodes"], &["flatMap"]),
        "findFirst" => (&["findFirst", "nodes"], &["findFirst"]),
        "matchAll" => (&["matchAll", "nodes"], &["matchAll"]),
        "count" | "distinct" | "exists" | "min" | "max" | "sum" | "intersection" | "concat"
        | "instancesOf" | "nodesMatching" | "conformsToShape" => (&[function], &[function]),
        _ => unreachable!(),
    };
    validate_properties(
        view,
        node,
        &format!("shnex:{function} expression"),
        &allowed.iter().map(|local| shnex(local)).collect::<Vec<_>>(),
        &required
            .iter()
            .map(|local| shnex(local))
            .collect::<Vec<_>>(),
    )?;
    if function == "if"
        && view.optional_one(node, &shnex("then"))?.is_none()
        && view.optional_one(node, &shnex("else"))?.is_none()
    {
        return Err(ValidationError::IllFormed(
            "shnex:if requires shnex:then or shnex:else".to_owned(),
        ));
    }
    Ok(())
}

pub(super) fn validate_properties(
    view: &RdfView<'_>,
    node: &ShapeId,
    label: &str,
    allowed: &[String],
    required: &[String],
) -> Result<(), ValidationError> {
    for predicate in active_predicates(view, node) {
        if !allowed.contains(&predicate) {
            return Err(ValidationError::IllFormed(format!(
                "{label} `{node}` has unexpected property <{predicate}>"
            )));
        }
    }
    for predicate in allowed {
        if view.objects(node, predicate).len() > 1 {
            return Err(ValidationError::IllFormed(format!(
                "{label} `{node}` has multiple <{predicate}> values"
            )));
        }
    }
    for predicate in required {
        if view.objects(node, predicate).len() != 1 {
            return Err(ValidationError::IllFormed(format!(
                "{label} `{node}` requires exactly one <{predicate}> value"
            )));
        }
    }
    Ok(())
}

pub(super) fn active_predicates(view: &RdfView<'_>, node: &ShapeId) -> BTreeSet<String> {
    view.graph()
        .triples()
        .filter(|triple| triple.subject == *node)
        .map(|triple| triple.predicate.as_str().to_owned())
        .filter(|predicate| !view.objects(node, predicate).is_empty())
        .collect()
}

pub(super) fn variable_name(term: Term) -> Result<String, ValidationError> {
    let literal = as_literal(term, &shnex("var"))?;
    if literal.datatype().as_str() != "http://www.w3.org/2001/XMLSchema#string"
        || literal.value().is_empty()
    {
        return Err(ValidationError::IllFormed(
            "shnex:var must be a non-empty xsd:string".to_owned(),
        ));
    }
    Ok(literal.value().to_owned())
}

pub(super) fn non_negative_integer(term: Term, local: &str) -> Result<usize, ValidationError> {
    let literal = as_literal(term, &shnex(local))?;
    if literal.datatype().as_str() != "http://www.w3.org/2001/XMLSchema#integer" {
        return Err(ValidationError::IllFormed(format!(
            "shnex:{local} must be a non-negative xsd:integer"
        )));
    }
    literal.value().parse().map_err(|_| {
        ValidationError::IllFormed(format!("shnex:{local} must be a non-negative xsd:integer"))
    })
}

#[cfg(feature = "sparql")]
pub(super) fn validate_select_query(query: &str) -> Result<(), ValidationError> {
    let parsed = SparqlParser::new()
        .parse_query(query)
        .map_err(|error| ValidationError::Sparql(error.to_string()))?;
    let Query::Select(select) = parsed else {
        return Err(ValidationError::IllFormed(
            "node-expression sh:select must be a SELECT query".to_owned(),
        ));
    };
    let mut projected = BTreeSet::new();
    select
        .expression
        .on_in_scope_variable(|variable| _ = projected.insert(variable.as_str().to_owned()));
    if projected.len() != 1 {
        return Err(ValidationError::IllFormed(
            "node-expression SELECT must project exactly one variable".to_owned(),
        ));
    }
    Ok(())
}
