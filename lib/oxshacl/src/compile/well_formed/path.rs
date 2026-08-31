use super::{GraphIndex, sh, syntax};
use crate::control::{Budget, LimitKind, ValidationError};
use crate::model::ShapeId;
use oxrdf::{NamedOrBlankNode, Term};
use std::collections::BTreeSet;

const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";

pub(super) fn list(
    index: &GraphIndex,
    head: &Term,
    budget: &mut Budget<'_>,
    rule: &str,
) -> Result<Vec<Term>, ValidationError> {
    let mut current = head.clone();
    let mut seen = BTreeSet::new();
    let mut output = Vec::new();
    loop {
        let node = as_node(&current)
            .ok_or_else(|| syntax(rule, &current, "list node must be an IRI or blank node"))?;
        if matches!(&node, NamedOrBlankNode::NamedNode(iri) if iri.as_str() == RDF_NIL) {
            if !index.values(&node, RDF_FIRST).is_empty()
                || !index.values(&node, RDF_REST).is_empty()
            {
                return Err(syntax(
                    "SHACL-list",
                    &node,
                    "rdf:nil has an rdf:first or rdf:rest value",
                ));
            }
            return Ok(output);
        }
        if !seen.insert(node.to_string()) {
            return Err(syntax("SHACL-list", &node, "list is cyclic"));
        }
        if output.len() >= budget.limits().max_list_items {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::ListItems,
                limit: budget.limits().max_list_items,
            });
        }
        let first = index.values(&node, RDF_FIRST);
        let rest = index.values(&node, RDF_REST);
        if first.len() != 1 || rest.len() != 1 {
            return Err(syntax(
                "SHACL-list",
                &node,
                "list node must have exactly one rdf:first and rdf:rest",
            ));
        }
        output.push(first[0].clone());
        current.clone_from(&rest[0]);
        budget.check()?;
    }
}

pub(super) fn check(
    index: &GraphIndex,
    term: &Term,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    let mut active = BTreeSet::new();
    let mut complete = BTreeSet::new();
    check_inner(index, term, budget, &mut active, &mut complete)
}

fn check_inner(
    index: &GraphIndex,
    term: &Term,
    budget: &mut Budget<'_>,
    active: &mut BTreeSet<String>,
    complete: &mut BTreeSet<String>,
) -> Result<(), ValidationError> {
    budget.check()?;
    if matches!(term, Term::NamedNode(_)) {
        return Ok(());
    }
    let Term::BlankNode(blank) = term else {
        return Err(syntax(
            "path-metarule",
            term,
            "path must be an IRI or blank node",
        ));
    };
    let node = ShapeId::from(blank.clone());
    let key = node.to_string();
    if complete.contains(&key) {
        return Ok(());
    }
    if !active.insert(key.clone()) {
        return Err(syntax(
            "path-non-recursive",
            &node,
            "path transitively references itself",
        ));
    }
    let has_list_syntax =
        !index.values(&node, RDF_FIRST).is_empty() || !index.values(&node, RDF_REST).is_empty();
    let operators = [
        "alternativePath",
        "inversePath",
        "zeroOrMorePath",
        "oneOrMorePath",
        "zeroOrOnePath",
    ]
    .into_iter()
    .filter(|local| !index.values(&node, &sh(local)).is_empty())
    .collect::<Vec<_>>();
    let variants = usize::from(has_list_syntax).saturating_add(operators.len());
    if variants != 1 {
        return Err(syntax(
            "path-metarule",
            &node,
            "path must satisfy exactly one path syntax",
        ));
    }
    if has_list_syntax {
        let members = list(index, term, budget, "path-sequence")?;
        if members.len() < 2 {
            return Err(syntax(
                "path-sequence",
                &node,
                "sequence path requires at least two members",
            ));
        }
        for member in members {
            check_inner(index, &member, budget, active, complete)?;
        }
    } else {
        let operator = operators[0];
        let rule = match operator {
            "alternativePath" => "path-alternative",
            "inversePath" => "path-inverse",
            "zeroOrMorePath" => "path-zero-or-more",
            "oneOrMorePath" => "path-one-or-more",
            "zeroOrOnePath" => "path-zero-or-one",
            _ => unreachable!(),
        };
        if index.subject_count(&node) != 1 {
            return Err(syntax(
                rule,
                &node,
                "operator path blank node must be subject of exactly one triple",
            ));
        }
        let values = index.values(&node, &sh(operator));
        let [value] = values else {
            return Err(syntax(
                rule,
                &node,
                "operator path must have exactly one value",
            ));
        };
        if operator == "alternativePath" {
            let members = list(index, value, budget, "path-alternative")?;
            if members.len() < 2 {
                return Err(syntax(
                    "path-alternative",
                    &node,
                    "alternative path requires at least two members",
                ));
            }
            for member in members {
                check_inner(index, &member, budget, active, complete)?;
            }
        } else {
            check_inner(index, value, budget, active, complete)?;
        }
    }
    active.remove(&key);
    complete.insert(key);
    Ok(())
}

fn as_node(term: &Term) -> Option<ShapeId> {
    if let Term::NamedNode(node) = term {
        Some(node.clone().into())
    } else if let Term::BlankNode(node) = term {
        Some(node.clone().into())
    } else {
        None
    }
}
