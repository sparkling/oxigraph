use super::native::{ExecutionGuard, Solution};
use crate::srl::{SrlConstant, SrlError, SrlNode, SrlPredicate, SrlTriple};
use oxrdf::{Dataset, GraphName, NamedNode, Term};

pub(super) fn match_pattern(
    pattern: &SrlTriple,
    graph: &Dataset,
    input: &[Solution],
    scope: &str,
    guard: &mut ExecutionGuard<'_>,
) -> Result<Vec<Solution>, SrlError> {
    let patterns = expand_path(pattern, scope);
    let mut solutions = input.to_vec();
    for (index, pattern) in patterns.iter().enumerate() {
        let mut next = Vec::new();
        for solution in &solutions {
            for quad in graph {
                guard.check()?;
                if quad.graph_name != GraphName::DefaultGraph {
                    continue;
                }
                let mut candidate = solution.clone();
                if match_node(
                    &pattern.subject,
                    Term::from(quad.subject),
                    &format!("{scope}:{index}:s"),
                    &mut candidate,
                )? && match_predicate(
                    &pattern.predicate,
                    quad.predicate,
                    &format!("{scope}:{index}:p"),
                    &mut candidate,
                )? && match_node(
                    &pattern.object,
                    quad.object,
                    &format!("{scope}:{index}:o"),
                    &mut candidate,
                )? {
                    guard.row(&candidate)?;
                    next.push(candidate);
                }
            }
        }
        solutions = next;
        if solutions.is_empty() {
            break;
        }
    }
    Ok(solutions)
}

fn expand_path(pattern: &SrlTriple, scope: &str) -> Vec<SrlTriple> {
    let SrlPredicate::Path(path) = &pattern.predicate else {
        return vec![pattern.clone()];
    };
    let mut output = Vec::with_capacity(path.len());
    let mut current = pattern.subject.clone();
    for (index, element) in path.iter().enumerate() {
        let next = if index + 1 == path.len() {
            pattern.object.clone()
        } else {
            SrlNode::Variable(format!("\0path:{scope}:{index}"))
        };
        let predicate =
            SrlPredicate::Node(SrlNode::Constant(SrlConstant::Iri(element.iri.clone())));
        let (subject, object) = if element.inverse {
            (next.clone(), current.clone())
        } else {
            (current.clone(), next.clone())
        };
        output.push(SrlTriple {
            subject,
            predicate,
            object,
        });
        current = next;
    }
    output
}

fn match_predicate(
    pattern: &SrlPredicate,
    value: NamedNode,
    scope: &str,
    solution: &mut Solution,
) -> Result<bool, SrlError> {
    let SrlPredicate::Node(pattern) = pattern else {
        return Err(SrlError::Unsupported(
            "an unexpanded SRL property path".to_owned(),
        ));
    };
    match_node(pattern, Term::from(value), scope, solution)
}

fn match_node(
    pattern: &SrlNode,
    value: Term,
    scope: &str,
    solution: &mut Solution,
) -> Result<bool, SrlError> {
    match pattern {
        SrlNode::Variable(variable) => Ok(bind(solution, variable, value)),
        SrlNode::GeneratedBlankNode(id) => Ok(bind(
            solution,
            &format!("\0blank:{scope}:generated:{id}"),
            value,
        )),
        SrlNode::Constant(_) => Ok(pattern.as_term()? == value),
        SrlNode::TripleTerm(triple) => match_triple_term(triple, value, scope, solution),
        SrlNode::Collection { .. }
        | SrlNode::PropertyList { .. }
        | SrlNode::Reified { .. }
        | SrlNode::Annotated { .. } => Err(SrlError::Unsupported(
            "collection, property-list, annotation, or reification in an SRL body pattern"
                .to_owned(),
        )),
    }
}

fn bind(solution: &mut Solution, variable: &str, value: Term) -> bool {
    if let Some(existing) = solution.get(variable) {
        existing == &value
    } else {
        solution.insert(variable.to_owned(), value);
        true
    }
}

#[cfg(feature = "rdf-12")]
fn match_triple_term(
    pattern: &SrlTriple,
    value: Term,
    scope: &str,
    solution: &mut Solution,
) -> Result<bool, SrlError> {
    let Term::Triple(value) = value else {
        return Ok(false);
    };
    let SrlPredicate::Node(predicate) = &pattern.predicate else {
        return Err(SrlError::Unsupported(
            "property path in an SRL triple-term pattern".to_owned(),
        ));
    };
    Ok(match_node(
        &pattern.subject,
        Term::from(value.subject),
        &format!("{scope}:ts"),
        solution,
    )? && match_node(
        predicate,
        Term::from(value.predicate),
        &format!("{scope}:tp"),
        solution,
    )? && match_node(
        &pattern.object,
        value.object,
        &format!("{scope}:to"),
        solution,
    )?)
}

#[cfg(not(feature = "rdf-12"))]
fn match_triple_term(
    _pattern: &SrlTriple,
    _value: Term,
    _scope: &str,
    _solution: &mut Solution,
) -> Result<bool, SrlError> {
    Err(SrlError::Unsupported(
        "SRL triple-term matching requires the `rdf-12` crate feature".to_owned(),
    ))
}
