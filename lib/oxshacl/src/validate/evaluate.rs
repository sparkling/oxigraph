use super::ValidationContext;
use crate::constraint::Constraint;
use crate::control::{Budget, ValidationError};
use crate::expression::{compare_terms, is_true_list};
use crate::model::Shape;
use crate::path::PropertyPath;
use crate::report::ValidationResult;
use oxrdf::{Literal, NamedNode, Term};
use std::cmp::Ordering;
use std::collections::BTreeSet;

mod helpers;

use self::helpers::*;

#[derive(Debug)]
pub(crate) struct Violation {
    pub value: Option<Term>,
    pub path: Option<PropertyPath>,
    pub source_constraint: Option<Term>,
    pub source_constraint_component: Option<NamedNode>,
    pub severity: Option<NamedNode>,
    pub messages: Vec<Literal>,
    pub annotations: Vec<(NamedNode, Term)>,
    pub details: Vec<ValidationResult>,
}

impl Violation {
    pub(crate) fn value(value: Term) -> Self {
        Self {
            value: Some(value),
            path: None,
            source_constraint: None,
            source_constraint_component: None,
            severity: None,
            messages: Vec::new(),
            annotations: Vec::new(),
            details: Vec::new(),
        }
    }

    fn empty() -> Self {
        Self {
            value: None,
            path: None,
            source_constraint: None,
            source_constraint_component: None,
            severity: None,
            messages: Vec::new(),
            annotations: Vec::new(),
            details: Vec::new(),
        }
    }

    pub(crate) fn empty_value() -> Self {
        Self::empty()
    }
}

pub(super) fn evaluate_constraint(
    context: &mut ValidationContext<'_>,
    shape: &Shape,
    focus: &Term,
    values: &[Term],
    constraint: &Constraint,
    budget: &mut Budget<'_>,
    depth: usize,
) -> Result<Vec<Violation>, ValidationError> {
    budget.check()?;
    match constraint {
        Constraint::Class(class) => {
            violating_values(values, |value| context.is_instance(value, class, budget))
        }
        Constraint::Classes(classes) => violating_values(values, |value| {
            for class in classes {
                if context.is_instance(value, class, budget)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }),
        Constraint::Datatype(datatype) => Ok(values
            .iter()
            .filter(|value| {
                !matches!(
                    value,
                    Term::Literal(literal)
                        if crate::datatype::literal_matches_datatype(literal, datatype)
                )
            })
            .cloned()
            .map(Violation::value)
            .collect()),
        Constraint::Datatypes(datatypes) => Ok(values
            .iter()
            .filter(|value| {
                !matches!(
                    value,
                    Term::Literal(literal)
                        if datatypes.iter().any(|datatype|
                            crate::datatype::literal_matches_datatype(literal, datatype))
                )
            })
            .cloned()
            .map(Violation::value)
            .collect()),
        Constraint::NodeKind(kind) => Ok(values
            .iter()
            .filter(|value| !matches_kind(value, *kind))
            .cloned()
            .map(Violation::value)
            .collect()),
        Constraint::NodeKinds(kinds) => Ok(values
            .iter()
            .filter(|value| !kinds.iter().any(|kind| matches_kind(value, *kind)))
            .cloned()
            .map(Violation::value)
            .collect()),
        Constraint::MinCount(count) if values.len() < *count => Ok(vec![Violation::empty()]),
        Constraint::MinCount(_) => Ok(Vec::new()),
        Constraint::MaxCount(count) if values.len() > *count => Ok(vec![Violation::empty()]),
        Constraint::MaxCount(_) => Ok(Vec::new()),
        Constraint::MinExclusive(bound) => Ok(compare_values(values, bound, Ordering::Greater)),
        Constraint::MinInclusive(bound) => Ok(values
            .iter()
            .filter(|value| {
                !matches!(
                    compare_terms(value, bound),
                    Some(Ordering::Greater | Ordering::Equal)
                )
            })
            .cloned()
            .map(Violation::value)
            .collect()),
        Constraint::MaxExclusive(bound) => Ok(compare_values(values, bound, Ordering::Less)),
        Constraint::MaxInclusive(bound) => Ok(values
            .iter()
            .filter(|value| {
                !matches!(
                    compare_terms(value, bound),
                    Some(Ordering::Less | Ordering::Equal)
                )
            })
            .cloned()
            .map(Violation::value)
            .collect()),
        Constraint::MinLength(length) => Ok(string_lengths(values, *length, true)),
        Constraint::MaxLength(length) => Ok(string_lengths(values, *length, false)),
        Constraint::Pattern { pattern, flags } => pattern_values(values, pattern, flags),
        Constraint::SingleLine(required) => Ok(if *required {
            values
                .iter()
                .filter(|value| {
                    lexical(value).is_some_and(|text| text.contains(['\r', '\n', '\u{b}', '\u{c}']))
                })
                .cloned()
                .map(Violation::value)
                .collect()
        } else {
            Vec::new()
        }),
        Constraint::LanguageIn(ranges) => Ok(values
            .iter()
            .filter(|value| !language_matches(value, ranges))
            .cloned()
            .map(Violation::value)
            .collect()),
        Constraint::UniqueLang(required) => {
            if !required {
                return Ok(Vec::new());
            }
            let mut languages = BTreeSet::new();
            let mut duplicates = BTreeSet::new();
            for value in values {
                if let Term::Literal(literal) = value
                    && let Some(language) = crate::datatype::language_key(literal)
                    && !languages.insert(language.clone())
                {
                    duplicates.insert(language);
                }
            }
            Ok(duplicates.into_iter().map(|_| Violation::empty()).collect())
        }
        Constraint::MemberShape(member_shape) => {
            let member_shape = context.shape(member_shape)?;
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
                let mut details = Vec::new();
                for member in members {
                    details.extend(context.validate_shape(
                        &member_shape,
                        &member,
                        budget,
                        depth,
                        true,
                    )?);
                }
                if !details.is_empty() {
                    let mut violation = Violation::value(value.clone());
                    violation.details = details;
                    violations.push(violation);
                }
            }
            Ok(violations)
        }
        Constraint::MinListLength(length) => list_lengths(context, values, *length, true, budget),
        Constraint::MaxListLength(length) => list_lengths(context, values, *length, false, budget),
        Constraint::UniqueMembers(required) => {
            unique_members(context, shape, focus, constraint, values, *required, budget)
        }
        Constraint::Equals(path) => {
            pair_set(context, focus, values, path, PairKind::Equals, budget)
        }
        Constraint::Disjoint(path) => {
            pair_set(context, focus, values, path, PairKind::Disjoint, budget)
        }
        Constraint::SubsetOf(path) => {
            pair_set(context, focus, values, path, PairKind::Subset, budget)
        }
        Constraint::LessThan(path) => ordered_pair(context, focus, values, path, false, budget),
        Constraint::LessThanOrEquals(path) => {
            ordered_pair(context, focus, values, path, true, budget)
        }
        Constraint::Not(other) => {
            let other = context.shape(other)?;
            violating_values(values, |value| {
                Ok(!context
                    .validate_shape(&other, value, budget, depth, false)?
                    .is_empty())
            })
        }
        Constraint::And(shapes) => logical(context, values, shapes, Logical::And, budget, depth),
        Constraint::Or(shapes) => logical(context, values, shapes, Logical::Or, budget, depth),
        Constraint::Xone(shapes) => logical(context, values, shapes, Logical::Xone, budget, depth),
        Constraint::Node(other) => {
            let other = context.shape(other)?;
            violating_values(values, |value| {
                Ok(context
                    .validate_shape(&other, value, budget, depth, false)?
                    .is_empty())
            })
        }
        Constraint::Property(other) => {
            let other = context.shape(other)?;
            let mut violations = Vec::new();
            for value in values {
                if !context
                    .validate_shape(&other, value, budget, depth, false)?
                    .is_empty()
                {
                    violations.push(Violation::value(value.clone()));
                }
            }
            Ok(violations)
        }
        Constraint::SomeValue(other) => {
            let other = context.shape(other)?;
            for value in values {
                if context
                    .validate_shape(&other, value, budget, depth, false)?
                    .is_empty()
                {
                    return Ok(Vec::new());
                }
            }
            Ok(vec![Violation::empty()])
        }
        Constraint::Qualified(qualified) => {
            let qualified_shape = context.shape(&qualified.shape)?;
            let siblings = if qualified.disjoint {
                context.qualified_sibling_shapes(shape)?
            } else {
                Vec::new()
            };
            let mut count = 0_usize;
            for value in values {
                if context
                    .validate_shape(&qualified_shape, value, budget, depth, false)?
                    .is_empty()
                {
                    let mut sibling_match = false;
                    for sibling in &siblings {
                        if context
                            .validate_shape(sibling, value, budget, depth, false)?
                            .is_empty()
                        {
                            sibling_match = true;
                            break;
                        }
                    }
                    if !sibling_match {
                        count = count.saturating_add(1);
                    }
                }
            }
            let mut violations = Vec::new();
            if qualified.min_count.is_some_and(|minimum| count < minimum) {
                let mut violation = Violation::empty();
                violation.source_constraint_component = Some(NamedNode::new_unchecked(
                    "http://www.w3.org/ns/shacl#QualifiedMinCountConstraintComponent",
                ));
                violations.push(violation);
            }
            if qualified.max_count.is_some_and(|maximum| count > maximum) {
                let mut violation = Violation::empty();
                violation.source_constraint_component = Some(NamedNode::new_unchecked(
                    "http://www.w3.org/ns/shacl#QualifiedMaxCountConstraintComponent",
                ));
                violations.push(violation);
            }
            Ok(violations)
        }
        Constraint::Closed {
            ignored_properties,
            by_types,
        } => closed(context, shape, focus, ignored_properties, *by_types, budget),
        Constraint::ReifierShape {
            shape: reifier_shape,
            required,
        } => reifier_shape_values(
            context,
            shape,
            reifier_shape,
            *required,
            focus,
            values,
            budget,
            depth,
        ),
        Constraint::HasValue(expected) => {
            if values.contains(expected) {
                Ok(Vec::new())
            } else {
                Ok(vec![Violation::empty()])
            }
        }
        Constraint::In(allowed) => Ok(values
            .iter()
            .filter(|value| !allowed.contains(value))
            .cloned()
            .map(Violation::value)
            .collect()),
        Constraint::RootClass(root) => {
            violating_values(values, |value| context.is_subclass(value, root, budget))
        }
        Constraint::RootClasses(roots) => violating_values(values, |value| {
            for root in roots {
                if context.is_subclass(value, root, budget)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }),
        Constraint::UniqueValuesFor(_) => Ok(Vec::new()),
        Constraint::Expression(expression) => {
            let graph = context.graph;
            let mut violations = Vec::new();
            for value in values {
                let mut environment = crate::ExpressionEnvironment::default();
                environment.insert("value", value.clone());
                let output = expression.evaluate(
                    graph,
                    focus,
                    &environment,
                    context,
                    budget,
                    depth,
                    context.max_depth,
                )?;
                if !is_true_list(&output) {
                    let mut violation = Violation::value(value.clone());
                    if let NodeExpressionSource::Constant(term) = expression_source(expression) {
                        violation.source_constraint = Some(term);
                    }
                    violations.push(violation);
                }
            }
            Ok(violations)
        }
        Constraint::NodeByExpression(expression) => {
            let graph = context.graph;
            let environment = crate::ExpressionEnvironment::default();
            let mut violations = Vec::new();
            for value in values {
                let shapes = expression.evaluate(
                    graph,
                    value,
                    &environment,
                    context,
                    budget,
                    depth,
                    context.max_depth,
                )?;
                for shape in shapes {
                    let shape_id = match &shape {
                        Term::NamedNode(node) => node.clone().into(),
                        Term::BlankNode(node) => node.clone().into(),
                        Term::Literal(_) => {
                            return Err(ValidationError::IllFormed(
                                "sh:nodeByExpression output must be a shape IRI or blank node"
                                    .to_owned(),
                            ));
                        }
                        #[cfg(feature = "rdf-12")]
                        Term::Triple(_) => {
                            return Err(ValidationError::IllFormed(
                                "sh:nodeByExpression output must be a shape IRI or blank node"
                                    .to_owned(),
                            ));
                        }
                    };
                    let target_shape = context.shape(&shape_id)?;
                    if !context
                        .validate_shape(&target_shape, value, budget, depth, false)?
                        .is_empty()
                    {
                        let mut violation = Violation::value(value.clone());
                        violation.source_constraint = Some(shape);
                        violations.push(violation);
                    }
                }
            }
            Ok(violations)
        }
        #[cfg(feature = "sparql")]
        Constraint::Sparql(constraint) => constraint.evaluate(context.graph, focus, values, budget),
    }
}
