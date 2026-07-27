use super::{
    SrlBodyElement, SrlError, SrlExpression, SrlNode, SrlPredicate, SrlRule, SrlRuleSet,
    SrlStratification, SrlStratum, SrlTriple, rules,
};
use std::collections::BTreeSet;

const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_REIFIES: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";

pub(super) fn well_formed(rule_set: &SrlRuleSet) -> Result<(), SrlError> {
    for (index, rule) in rules(rule_set).enumerate() {
        let mut bound = rule
            .for_clause
            .as_ref()
            .map(|(variable, _)| BTreeSet::from([variable.clone()]))
            .unwrap_or_default();
        check_sequence(&rule.body, &mut bound, index)?;
        let mut head_variables = BTreeSet::new();
        for triple in &rule.head {
            triple.variables(&mut head_variables);
        }
        if let Some(variable) = head_variables
            .iter()
            .find(|variable| !bound.contains(*variable))
        {
            return Err(SrlError::WellFormed(format!(
                "rule {} head variable `?{variable}` is not defined by its body",
                rule_name(rule, index)
            )));
        }
    }
    Ok(())
}

fn check_sequence(
    body: &[SrlBodyElement],
    bound: &mut BTreeSet<String>,
    rule_index: usize,
) -> Result<(), SrlError> {
    for (element_index, element) in body.iter().enumerate() {
        match element {
            SrlBodyElement::Triple(triple) => triple.variables(bound),
            SrlBodyElement::Filter(expression) => {
                require_bound(expression, bound, rule_index, element_index, "filter")?;
            }
            SrlBodyElement::Assignment {
                variable,
                expression,
            } => {
                require_bound(
                    expression,
                    bound,
                    rule_index,
                    element_index,
                    "assignment expression",
                )?;
                if bound.contains(variable) {
                    return Err(SrlError::WellFormed(format!(
                        "rule {} element {} assigns already-defined variable `?{variable}`",
                        rule_index + 1,
                        element_index + 1
                    )));
                }
                bound.insert(variable.clone());
            }
            SrlBodyElement::Negation { body, .. } => {
                let mut nested = bound.clone();
                check_sequence(body, &mut nested, rule_index)?;
            }
        }
    }
    Ok(())
}

fn require_bound(
    expression: &SrlExpression,
    bound: &BTreeSet<String>,
    rule_index: usize,
    element_index: usize,
    kind: &str,
) -> Result<(), SrlError> {
    let mut variables = BTreeSet::new();
    expression.variables(&mut variables);
    if let Some(variable) = variables.iter().find(|variable| !bound.contains(*variable)) {
        return Err(SrlError::WellFormed(format!(
            "rule {} element {} {kind} uses undefined variable `?{variable}`",
            rule_index + 1,
            element_index + 1
        )));
    }
    Ok(())
}

pub(super) fn stratify(rule_set: &SrlRuleSet) -> Result<SrlStratification, SrlError> {
    let rules = rules(rule_set).collect::<Vec<_>>();
    let produced = rules
        .iter()
        .map(|rule| expanded_head(&rule.head))
        .collect::<Vec<_>>();
    let mut edges = Vec::new();
    for (consumer_index, consumer) in rules.iter().enumerate() {
        let run_once = is_run_once(consumer);
        for (pattern, negative) in body_patterns(&consumer.body) {
            for (producer_index, templates) in produced.iter().enumerate() {
                if templates
                    .iter()
                    .any(|template| possibly_matches(&pattern, template))
                {
                    let closed = negative || run_once;
                    merge_edge(&mut edges, consumer_index, producer_index, closed);
                }
            }
        }
    }
    for &(source, target, closed) in &edges {
        if closed && reachable(target, source, &edges, rules.len()) {
            return Err(SrlError::Stratification(format!(
                "closed dependency {} -> {} participates in a recursive dependency",
                source + 1,
                target + 1
            )));
        }
    }
    let mut levels = vec![0_usize; rules.len()];
    for _ in 0..=rules.len() {
        let mut changed = false;
        for &(source, target, closed) in &edges {
            let required = levels[target] + usize::from(closed);
            if levels[source] < required {
                levels[source] = required;
                changed = true;
            }
        }
        if !changed {
            return Ok(build_strata(&rules, &levels));
        }
    }
    Err(SrlError::Stratification(
        "dependency levels did not converge".to_owned(),
    ))
}

fn body_patterns(body: &[SrlBodyElement]) -> Vec<(SrlTriple, bool)> {
    let mut output = Vec::new();
    for element in body {
        match element {
            SrlBodyElement::Triple(triple) => output.extend(
                expanded_pattern(triple)
                    .into_iter()
                    .map(|pattern| (pattern, false)),
            ),
            SrlBodyElement::Negation { body, .. } => {
                for element in body {
                    if let SrlBodyElement::Triple(triple) = element {
                        output.extend(
                            expanded_pattern(triple)
                                .into_iter()
                                .map(|pattern| (pattern, true)),
                        );
                    }
                }
            }
            SrlBodyElement::Filter(_) | SrlBodyElement::Assignment { .. } => {}
        }
    }
    output
}

fn expanded_pattern(pattern: &SrlTriple) -> Vec<SrlTriple> {
    let SrlPredicate::Path(path) = &pattern.predicate else {
        return vec![pattern.clone()];
    };
    let mut output = Vec::with_capacity(path.len());
    let mut current = pattern.subject.clone();
    for (index, element) in path.iter().enumerate() {
        let next = if index + 1 == path.len() {
            pattern.object.clone()
        } else {
            SrlNode::Variable(format!("\0dependency-path-{index}"))
        };
        let predicate = SrlPredicate::Node(SrlNode::Constant(super::SrlConstant::Iri(
            element.iri.clone(),
        )));
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

fn expanded_head(head: &[SrlTriple]) -> Vec<SrlTriple> {
    let mut output = head.to_vec();
    for triple in head {
        collect_auxiliary_node(&triple.subject, &mut output);
        if let SrlPredicate::Node(predicate) = &triple.predicate {
            collect_auxiliary_node(predicate, &mut output);
        }
        collect_auxiliary_node(&triple.object, &mut output);
    }
    output
}

fn collect_auxiliary_node(node: &SrlNode, output: &mut Vec<SrlTriple>) {
    match node {
        SrlNode::Collection { values, .. } => {
            for value in values {
                output.push(auxiliary_template(RDF_FIRST, value.clone()));
                output.push(auxiliary_template(RDF_REST, SrlNode::GeneratedBlankNode(0)));
                collect_auxiliary_node(value, output);
            }
        }
        SrlNode::PropertyList { properties, .. } => {
            collect_auxiliary_properties(properties, output)
        }
        SrlNode::Reified {
            triple, reifier, ..
        } => {
            output.push(auxiliary_template(
                RDF_REIFIES,
                SrlNode::TripleTerm(triple.clone()),
            ));
            collect_auxiliary_triple(triple, output);
            if let Some(reifier) = reifier {
                collect_auxiliary_node(reifier, output);
            }
        }
        SrlNode::TripleTerm(triple) => collect_auxiliary_triple(triple, output),
        SrlNode::Annotated {
            value, annotations, ..
        } => {
            collect_auxiliary_node(value, output);
            for annotation in annotations {
                output.push(auxiliary_template(
                    RDF_REIFIES,
                    SrlNode::GeneratedBlankNode(0),
                ));
                if let Some(reifier) = &annotation.reifier {
                    collect_auxiliary_node(reifier, output);
                }
                collect_auxiliary_properties(&annotation.properties, output);
            }
        }
        SrlNode::Variable(_) | SrlNode::Constant(_) | SrlNode::GeneratedBlankNode(_) => {}
    }
}

fn collect_auxiliary_triple(triple: &SrlTriple, output: &mut Vec<SrlTriple>) {
    collect_auxiliary_node(&triple.subject, output);
    if let SrlPredicate::Node(predicate) = &triple.predicate {
        collect_auxiliary_node(predicate, output);
    }
    collect_auxiliary_node(&triple.object, output);
}

fn collect_auxiliary_properties(properties: &[super::SrlProperty], output: &mut Vec<SrlTriple>) {
    for property in properties {
        for object in &property.objects {
            output.push(SrlTriple {
                subject: SrlNode::GeneratedBlankNode(0),
                predicate: property.predicate.clone(),
                object: object.clone(),
            });
            collect_auxiliary_node(object, output);
        }
    }
}

fn auxiliary_template(predicate: &str, object: SrlNode) -> SrlTriple {
    SrlTriple {
        subject: SrlNode::GeneratedBlankNode(0),
        predicate: SrlPredicate::Node(SrlNode::Constant(super::SrlConstant::Iri(
            predicate.to_owned(),
        ))),
        object,
    }
}

fn is_run_once(rule: &SrlRule) -> bool {
    rule.body
        .iter()
        .any(|element| matches!(element, SrlBodyElement::Assignment { .. }))
        || rule.head.iter().any(SrlTriple::contains_generated_blank)
}

fn merge_edge(edges: &mut Vec<(usize, usize, bool)>, from: usize, to: usize, closed: bool) {
    if let Some(edge) = edges
        .iter_mut()
        .find(|(source, target, _)| *source == from && *target == to)
    {
        edge.2 |= closed;
    } else {
        edges.push((from, to, closed));
    }
}

fn reachable(start: usize, goal: usize, edges: &[(usize, usize, bool)], count: usize) -> bool {
    let mut pending = vec![start];
    let mut seen = vec![false; count];
    while let Some(node) = pending.pop() {
        if node == goal {
            return true;
        }
        if seen[node] {
            continue;
        }
        seen[node] = true;
        pending.extend(
            edges
                .iter()
                .filter_map(|(source, target, _)| (*source == node).then_some(*target)),
        );
    }
    false
}

fn build_strata(rules: &[&SrlRule], levels: &[usize]) -> SrlStratification {
    let count = levels.iter().copied().max().map_or(0, |value| value + 1);
    let mut strata = std::iter::repeat_with(|| SrlStratum {
        once: Vec::new(),
        general: Vec::new(),
    })
    .take(count)
    .collect::<Vec<_>>();
    for (index, (rule, level)) in rules.iter().zip(levels).enumerate() {
        if is_run_once(rule) {
            strata[*level].once.push(index);
        } else {
            strata[*level].general.push(index);
        }
    }
    SrlStratification { strata }
}

fn possibly_matches(pattern: &SrlTriple, template: &SrlTriple) -> bool {
    let Some(pattern_terms) = simple_terms(pattern) else {
        return true;
    };
    let Some(template_terms) = simple_terms(template) else {
        return true;
    };
    for index in 0..3 {
        if constants_conflict(&pattern_terms[index], &template_terms[index]) {
            return false;
        }
    }
    repeated_variables_compatible(&pattern_terms, &template_terms)
        && repeated_variables_compatible(&template_terms, &pattern_terms)
}

#[derive(Clone, Copy)]
enum SimpleTerm<'a> {
    Variable(&'a str),
    Constant(&'a super::SrlConstant),
    Iri(&'a str),
    Other,
}

fn simple_terms(triple: &SrlTriple) -> Option<[SimpleTerm<'_>; 3]> {
    let predicate = match &triple.predicate {
        SrlPredicate::Node(node) => simple_node(node),
        SrlPredicate::Path(path) if path.len() == 1 && !path[0].inverse => {
            return Some([
                simple_node(&triple.subject),
                SimpleTerm::Iri(&path[0].iri),
                simple_node(&triple.object),
            ]);
        }
        SrlPredicate::Path(_) => return None,
    };
    Some([
        simple_node(&triple.subject),
        predicate,
        simple_node(&triple.object),
    ])
}

fn simple_node(node: &SrlNode) -> SimpleTerm<'_> {
    match node {
        SrlNode::Variable(variable) => SimpleTerm::Variable(variable),
        SrlNode::Constant(value) => SimpleTerm::Constant(value),
        _ => SimpleTerm::Other,
    }
}

fn repeated_variables_compatible(left: &[SimpleTerm<'_>; 3], right: &[SimpleTerm<'_>; 3]) -> bool {
    for first in 0..3 {
        for second in (first + 1)..3 {
            if matches!(
                (&left[first], &left[second]),
                (SimpleTerm::Variable(a), SimpleTerm::Variable(b)) if a == b
            ) && !could_be_equal(&right[first], &right[second])
            {
                return false;
            }
        }
    }
    true
}

fn could_be_equal(left: &SimpleTerm<'_>, right: &SimpleTerm<'_>) -> bool {
    !constants_conflict(left, right)
}

fn constants_conflict(left: &SimpleTerm<'_>, right: &SimpleTerm<'_>) -> bool {
    match (left, right) {
        (SimpleTerm::Constant(a), SimpleTerm::Constant(b)) => {
            let left = SrlNode::Constant((*a).clone()).as_term();
            let right = SrlNode::Constant((*b).clone()).as_term();
            matches!((left, right), (Ok(left), Ok(right)) if left != right)
        }
        (SimpleTerm::Iri(a), SimpleTerm::Iri(b)) => a != b,
        (SimpleTerm::Iri(a), SimpleTerm::Constant(super::SrlConstant::Iri(b)))
        | (SimpleTerm::Constant(super::SrlConstant::Iri(b)), SimpleTerm::Iri(a)) => a != b,
        (SimpleTerm::Iri(_), SimpleTerm::Constant(_))
        | (SimpleTerm::Constant(_), SimpleTerm::Iri(_)) => true,
        _ => false,
    }
}

fn rule_name(rule: &SrlRule, index: usize) -> String {
    rule.id
        .as_deref()
        .map_or_else(|| (index + 1).to_string(), |id| format!("`{id}`"))
}

#[cfg(test)]
mod tests {
    use crate::{ProfileId, ProfileSet, SrlRuleSet};

    fn parse(source: &str) -> SrlRuleSet {
        SrlRuleSet::parse(
            source,
            None,
            ProfileSet::new([
                ProfileId::Core12Subset20260723,
                ProfileId::Rules12Subset20260727,
            ])
            .unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn constants_avoid_false_dependency() {
        parse(
            "PREFIX : <http://example/> RULE { ?s :p \"abc\" } WHERE { NOT { ?s :p \"XYZ\" } SET(?s := :s) }",
        )
        .stratification()
        .unwrap();
    }

    #[test]
    fn closed_recursive_dependency_is_rejected() {
        parse("PREFIX : <http://example/> RULE { ?s :p \"x\" } WHERE { NOT { ?s :p \"x\" } }")
            .stratification()
            .unwrap_err();
    }
}
