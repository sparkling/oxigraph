use super::{ValidationContext, Violation};
use crate::constraint::{Constraint, NodeKind};
use crate::control::{Budget, LimitKind, ValidationError};
use crate::expression::compare_terms;
use crate::model::Shape;
use crate::path::{PropertyPath, as_subject, term_key};
use oxrdf::{NamedNode, Term};
use regex::RegexBuilder;
use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn violating_values(
    values: &[Term],
    mut conforms: impl FnMut(&Term) -> Result<bool, ValidationError>,
) -> Result<Vec<Violation>, ValidationError> {
    let mut violations = Vec::new();
    for value in values {
        if !conforms(value)? {
            violations.push(Violation::value(value.clone()));
        }
    }
    Ok(violations)
}

pub(super) fn compare_values(values: &[Term], bound: &Term, expected: Ordering) -> Vec<Violation> {
    values
        .iter()
        .filter(|value| compare_terms(value, bound) != Some(expected))
        .cloned()
        .map(Violation::value)
        .collect()
}

pub(super) fn string_lengths(values: &[Term], limit: usize, minimum: bool) -> Vec<Violation> {
    values
        .iter()
        .filter(|value| {
            let length = lexical(value).map(str::chars).map(Iterator::count);
            if minimum {
                length.is_none_or(|length| length < limit)
            } else {
                length.is_none_or(|length| length > limit)
            }
        })
        .cloned()
        .map(Violation::value)
        .collect()
}

pub(super) fn pattern_values(
    values: &[Term],
    pattern: &str,
    flags: &str,
) -> Result<Vec<Violation>, ValidationError> {
    if flags
        .chars()
        .any(|flag| !matches!(flag, 'i' | 'm' | 's' | 'x' | 'q'))
    {
        return Err(ValidationError::IllFormed(format!(
            "unsupported sh:flags value `{flags}`"
        )));
    }
    let pattern = if flags.contains('q') {
        Cow::Owned(regex::escape(pattern))
    } else {
        Cow::Borrowed(pattern)
    };
    let expression = RegexBuilder::new(&pattern)
        .case_insensitive(flags.contains('i'))
        .multi_line(flags.contains('m'))
        .dot_matches_new_line(flags.contains('s'))
        .ignore_whitespace(flags.contains('x'))
        .build()
        .map_err(|error| ValidationError::IllFormed(format!("invalid sh:pattern: {error}")))?;
    Ok(values
        .iter()
        .filter(|value| !lexical(value).is_some_and(|text| expression.is_match(text)))
        .cloned()
        .map(Violation::value)
        .collect())
}

pub(super) fn language_matches(value: &Term, ranges: &[String]) -> bool {
    let Term::Literal(literal) = value else {
        return false;
    };
    let Some(language) = literal.language() else {
        return false;
    };
    let language = language.to_ascii_lowercase();
    ranges.iter().any(|range| {
        let range = range.to_ascii_lowercase();
        range == "*" || language == range || language.starts_with(&format!("{range}-"))
    })
}

pub(super) fn matches_kind(term: &Term, kind: NodeKind) -> bool {
    match kind {
        NodeKind::Iri => matches!(term, Term::NamedNode(_)),
        NodeKind::BlankNode => matches!(term, Term::BlankNode(_)),
        NodeKind::Literal => matches!(term, Term::Literal(_)),
        NodeKind::BlankNodeOrIri => matches!(term, Term::BlankNode(_) | Term::NamedNode(_)),
        NodeKind::BlankNodeOrLiteral => matches!(term, Term::BlankNode(_) | Term::Literal(_)),
        NodeKind::IriOrLiteral => matches!(term, Term::NamedNode(_) | Term::Literal(_)),
        #[cfg(feature = "rdf-12")]
        NodeKind::TripleTerm => matches!(term, Term::Triple(_)),
        #[cfg(not(feature = "rdf-12"))]
        NodeKind::TripleTerm => false,
    }
}

pub(super) fn list_lengths(
    context: &mut ValidationContext<'_>,
    values: &[Term],
    limit: usize,
    minimum: bool,
    budget: &mut Budget<'_>,
) -> Result<Vec<Violation>, ValidationError> {
    let mut violations = Vec::new();
    for value in values {
        let length = match data_list(context, value, budget) {
            Ok(members) => members.len(),
            Err(ValidationError::IllFormed(_)) => {
                violations.push(Violation::value(value.clone()));
                continue;
            }
            Err(error) => return Err(error),
        };
        if (minimum && length < limit) || (!minimum && length > limit) {
            violations.push(Violation::value(value.clone()));
        }
    }
    Ok(violations)
}

pub(super) fn unique_members(
    context: &mut ValidationContext<'_>,
    shape: &Shape,
    focus: &Term,
    constraint: &Constraint,
    values: &[Term],
    required: bool,
    budget: &mut Budget<'_>,
) -> Result<Vec<Violation>, ValidationError> {
    if !required {
        return Ok(Vec::new());
    }
    let mut violations = Vec::new();
    for value in values {
        let members = match data_list(context, value, budget) {
            Ok(members) => members,
            Err(ValidationError::IllFormed(_)) => {
                violations.push(Violation::value(value.clone()));
                continue;
            }
            Err(error) => return Err(error),
        };
        let mut counts = BTreeMap::<String, (Term, usize)>::new();
        for member in members {
            let entry = counts
                .entry(term_key(&member))
                .or_insert_with(|| (member, 0));
            entry.1 = entry.1.saturating_add(1);
        }
        let duplicates = counts
            .into_values()
            .filter_map(|(member, count)| (count > 1).then_some(member))
            .collect::<Vec<_>>();
        if !duplicates.is_empty() {
            let mut violation = Violation::value(value.clone());
            violation.details = duplicates
                .into_iter()
                .map(|duplicate| {
                    ValidationContext::result(shape, focus, constraint, Violation::value(duplicate))
                })
                .collect();
            violations.push(violation);
        }
    }
    Ok(violations)
}

#[derive(Clone, Copy)]
pub(super) enum PairKind {
    Equals,
    Disjoint,
    Subset,
}

pub(super) fn pair_set(
    context: &mut ValidationContext<'_>,
    focus: &Term,
    values: &[Term],
    path: &PropertyPath,
    kind: PairKind,
    budget: &mut Budget<'_>,
) -> Result<Vec<Violation>, ValidationError> {
    let others = path.evaluate(context.graph, [focus.clone()], budget, context.max_depth)?;
    let mut value_map = values
        .iter()
        .cloned()
        .map(|value| (term_key(&value), value))
        .collect::<BTreeMap<_, _>>();
    let values = value_map.keys().cloned().collect::<BTreeSet<_>>();
    if matches!(kind, PairKind::Equals) {
        value_map.extend(
            others
                .iter()
                .cloned()
                .map(|value| (term_key(&value), value)),
        );
    }
    let others = others.iter().map(term_key).collect::<BTreeSet<_>>();
    let offending: BTreeSet<String> = match kind {
        PairKind::Equals => values.symmetric_difference(&others).cloned().collect(),
        PairKind::Disjoint => values.intersection(&others).cloned().collect(),
        PairKind::Subset => values.difference(&others).cloned().collect(),
    };
    Ok(offending
        .into_iter()
        .filter_map(|key| value_map.get(&key).cloned())
        .map(Violation::value)
        .collect())
}

pub(super) fn ordered_pair(
    context: &mut ValidationContext<'_>,
    focus: &Term,
    values: &[Term],
    path: &PropertyPath,
    inclusive: bool,
    budget: &mut Budget<'_>,
) -> Result<Vec<Violation>, ValidationError> {
    let others = path.evaluate(context.graph, [focus.clone()], budget, context.max_depth)?;
    let mut violations = Vec::new();
    for value in values {
        for other in &others {
            let conforms = match compare_terms(value, other) {
                Some(Ordering::Less) => true,
                Some(Ordering::Equal) => inclusive,
                _ => false,
            };
            if !conforms {
                violations.push(Violation::value(value.clone()));
            }
        }
    }
    Ok(violations)
}

#[derive(Clone, Copy)]
pub(super) enum Logical {
    And,
    Or,
    Xone,
}

pub(super) fn logical(
    context: &mut ValidationContext<'_>,
    values: &[Term],
    shapes: &[crate::ShapeId],
    kind: Logical,
    budget: &mut Budget<'_>,
    depth: usize,
) -> Result<Vec<Violation>, ValidationError> {
    let shapes = shapes
        .iter()
        .map(|shape| context.shape(shape))
        .collect::<Result<Vec<_>, _>>()?;
    let mut violations = Vec::new();
    for value in values {
        let mut conforming = 0_usize;
        for shape in &shapes {
            if context
                .validate_shape(shape, value, budget, depth, false)?
                .is_empty()
            {
                conforming = conforming.saturating_add(1);
            }
        }
        let valid = match kind {
            Logical::And => conforming == shapes.len(),
            Logical::Or => conforming > 0,
            Logical::Xone => conforming == 1,
        };
        if !valid {
            violations.push(Violation::value(value.clone()));
        }
    }
    Ok(violations)
}

pub(super) fn closed(
    context: &mut ValidationContext<'_>,
    shape: &Shape,
    focus: &Term,
    ignored: &[NamedNode],
    by_types: bool,
    budget: &mut Budget<'_>,
) -> Result<Vec<Violation>, ValidationError> {
    let Some(subject) = as_subject(focus) else {
        return Ok(Vec::new());
    };
    let mut allowed = ignored
        .iter()
        .map(|node| node.as_str().to_owned())
        .collect::<BTreeSet<_>>();
    if by_types {
        allowed.extend(context.allowed_properties_by_types(focus, budget)?);
    }
    for constraint in &shape.constraints {
        if let Constraint::Property(property) = constraint
            && let Some(property) = context.shapes.shape(property)
            && let Some(PropertyPath::Predicate(predicate)) = &property.path
        {
            allowed.insert(predicate.as_str().to_owned());
        }
    }
    let mut violations = Vec::new();
    for triple in context.graph.triples() {
        budget.path_visit()?;
        if triple.subject == subject && !allowed.contains(triple.predicate.as_str()) {
            let mut violation = Violation::value(triple.object);
            violation.path = Some(PropertyPath::Predicate(triple.predicate));
            violations.push(violation);
        }
    }
    Ok(violations)
}

#[cfg(feature = "rdf-12")]
pub(super) fn reifier_shape_values(
    context: &mut ValidationContext<'_>,
    property_shape: &Shape,
    reifier_shape: &crate::ShapeId,
    required: bool,
    focus: &Term,
    values: &[Term],
    budget: &mut Budget<'_>,
    depth: usize,
) -> Result<Vec<Violation>, ValidationError> {
    let Some(subject) = as_subject(focus) else {
        return Ok(values.iter().cloned().map(Violation::value).collect());
    };
    let Some(PropertyPath::Predicate(predicate)) = &property_shape.path else {
        return Err(ValidationError::IllFormed(
            "sh:reifierShape requires an IRI property path".to_owned(),
        ));
    };
    let reifier_shape = context.shape(reifier_shape)?;
    let mut violations = Vec::new();
    for value in values {
        let statement = Term::from(oxrdf::Triple::new(
            subject.clone(),
            predicate.clone(),
            value.clone(),
        ));
        let mut reifiers = Vec::new();
        for triple in context.graph.triples() {
            budget.path_visit()?;
            if triple.predicate.as_str() == "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies"
                && triple.object == statement
            {
                reifiers.push(Term::from(triple.subject));
            }
        }
        if required && reifiers.is_empty() {
            violations.push(Violation::value(value.clone()));
            continue;
        }
        for reifier in reifiers {
            if !context
                .validate_shape(&reifier_shape, &reifier, budget, depth, false)?
                .is_empty()
            {
                violations.push(Violation::value(value.clone()));
                break;
            }
        }
    }
    Ok(violations)
}

#[cfg(not(feature = "rdf-12"))]
pub(super) fn reifier_shape_values(
    _context: &mut ValidationContext<'_>,
    _property_shape: &Shape,
    _reifier_shape: &crate::ShapeId,
    _required: bool,
    _focus: &Term,
    _values: &[Term],
    _budget: &mut Budget<'_>,
    _depth: usize,
) -> Result<Vec<Violation>, ValidationError> {
    Err(ValidationError::UnsupportedFeature(
        "sh:reifierShape requires the rdf-12 feature".to_owned(),
    ))
}

pub(super) enum NodeExpressionSource {
    Constant(Term),
    Other,
}

pub(super) fn expression_source(expression: &crate::NodeExpression) -> NodeExpressionSource {
    if let crate::NodeExpression::Constant(term) = expression {
        NodeExpressionSource::Constant(term.clone())
    } else {
        NodeExpressionSource::Other
    }
}

pub(super) fn lexical(term: &Term) -> Option<&str> {
    match term {
        Term::NamedNode(node) => Some(node.as_str()),
        Term::Literal(literal) => Some(literal.value()),
        Term::BlankNode(_) => None,
        #[cfg(feature = "rdf-12")]
        Term::Triple(_) => None,
    }
}

pub(super) fn data_list(
    context: &mut ValidationContext<'_>,
    head: &Term,
    budget: &mut Budget<'_>,
) -> Result<Vec<Term>, ValidationError> {
    let mut current = head.clone();
    let mut seen = BTreeSet::new();
    let mut output = Vec::new();
    loop {
        if matches!(&current, Term::NamedNode(node) if node.as_str() == rdf("nil")) {
            return Ok(output);
        }
        let subject = as_subject(&current).ok_or_else(|| {
            ValidationError::IllFormed("RDF list head must be an IRI or blank node".to_owned())
        })?;
        if !seen.insert(subject.to_string()) {
            return Err(ValidationError::IllFormed("cyclic RDF list".to_owned()));
        }
        if output.len() >= budget.limits().max_list_items {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::ListItems,
                limit: budget.limits().max_list_items,
            });
        }
        let mut first = Vec::new();
        let mut rest = Vec::new();
        for triple in context.graph.triples() {
            budget.path_visit()?;
            if triple.subject == subject {
                if triple.predicate.as_str() == rdf("first") {
                    first.push(triple.object);
                } else if triple.predicate.as_str() == rdf("rest") {
                    rest.push(triple.object);
                }
            }
        }
        let ([first], [rest]) = (first.as_slice(), rest.as_slice()) else {
            return Err(ValidationError::IllFormed(
                "RDF list cells require exactly one rdf:first and rdf:rest".to_owned(),
            ));
        };
        output.push(first.clone());
        current = rest.clone();
    }
}

fn rdf(local: &str) -> &'static str {
    match local {
        "first" => "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
        "rest" => "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
        "nil" => "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
        _ => unreachable!(),
    }
}
