use crate::Validator;
use crate::control::{Budget, LimitKind, ValidationError, ValidationOptions};
use crate::model::{GraphSnapshot, Shape, ShapeId};
use crate::rules::RuleError;
use crate::{Constraint, PropertyPath, ShapesGraph};
use oxrdf::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use std::collections::{BTreeSet, HashSet, VecDeque};
#[cfg(feature = "rdf-12")]
const RDF_REIFIES: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";

pub(super) fn prepare_layer(
    shapes: &ShapesGraph,
    expected_predicates: &BTreeSet<NamedNode>,
    layer_start: &GraphSnapshot,
    options: &ValidationOptions,
    budget: &mut Budget<'_>,
    admissions: &mut usize,
) -> Result<Dataset, RuleError> {
    if expected_predicates.is_empty() {
        return Ok(Dataset::new());
    }
    let relevant = relevant_shapes(shapes, expected_predicates, budget)?;
    let validator = Validator::new(shapes, options);
    let mut pending = VecDeque::<(ShapeId, Term, usize)>::new();
    for shape in shapes
        .shapes()
        .filter(|shape| relevant.contains(&shape.id) && !shape.deactivated)
    {
        let focuses = validator.focus_nodes_with_budget(layer_start, &shape.id, budget)?;
        budget.charge_memory(focuses.len().saturating_mul(128))?;
        for focus in focuses {
            budget.charge_memory(128)?;
            pending.push_back((shape.id.clone(), focus, 0));
        }
    }

    let mut visited = HashSet::<(ShapeId, Term)>::new();
    let mut derived = Dataset::new();
    while let Some((shape_id, focus, depth)) = pending.pop_front() {
        budget.check()?;
        if depth > options.limits.max_recursion_depth {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: options.limits.max_recursion_depth,
            }
            .into());
        }
        let visit = (shape_id.clone(), focus.clone());
        if visited.contains(&visit) {
            continue;
        }
        budget.charge_memory(128)?;
        visited.insert(visit);
        let shape = shapes.shape(&shape_id).ok_or_else(|| {
            ValidationError::UnknownShape(shape_id.to_string())
        })?;
        if shape.deactivated {
            continue;
        }
        budget.focus()?;

        let property_values = if shape.path.is_some() {
            let values = validator.value_nodes_with_budget(
                layer_start,
                &shape.id,
                &focus,
                budget,
                depth,
            )?;
            budget.charge_memory(values.len().saturating_mul(128))?;
            Some(values)
        } else {
            None
        };
        if let Some(predicate) = qualifying_predicate(shape, expected_predicates) {
            let values = property_values.as_deref().unwrap_or(&[]);
            if let Ok(subject) = NamedOrBlankNode::try_from(focus.clone()) {
                for value in values {
                    let quad = Quad::new(
                        subject.clone(),
                        predicate.clone(),
                        value.clone(),
                        GraphName::DefaultGraph,
                    );
                    if !layer_start.dataset().contains(&quad) && !derived.contains(&quad) {
                        admit(admissions, options)?;
                        budget.charge_memory(128)?;
                        derived.insert(quad);
                    }
                }
            }
        }

        for constraint in &shape.constraints {
            budget.path_visit()?;
            let Constraint::Property(child) = constraint else {
                continue;
            };
            if !relevant.contains(child)
                || shapes.shape(child).is_some_and(|shape| shape.deactivated)
            {
                continue;
            }
            if let Some(child_focuses) = &property_values {
                for child_focus in child_focuses {
                    budget.charge_memory(128)?;
                    pending.push_back((
                        child.clone(),
                        child_focus.clone(),
                        depth.saturating_add(1),
                    ));
                }
            } else {
                budget.charge_memory(128)?;
                pending.push_back((
                    child.clone(),
                    focus.clone(),
                    depth.saturating_add(1),
                ));
            }
        }
    }
    Ok(derived)
}

fn relevant_shapes(
    shapes: &ShapesGraph,
    expected_predicates: &BTreeSet<NamedNode>,
    budget: &mut Budget<'_>,
) -> Result<HashSet<ShapeId>, ValidationError> {
    let shape_count = shapes.shapes().count();
    budget.charge_memory(shape_count.saturating_mul(128))?;
    let all = shapes.shapes().collect::<Vec<_>>();
    let mut relevant = HashSet::new();
    for shape in &all {
        budget.check()?;
        if qualifying_predicate(shape, expected_predicates).is_some() {
            budget.charge_memory(128)?;
            relevant.insert(shape.id.clone());
        }
    }
    loop {
        let before = relevant.len();
        for shape in &all {
            budget.check()?;
            if shape.deactivated || relevant.contains(&shape.id) {
                continue;
            }
            let mut is_relevant = false;
            for constraint in &shape.constraints {
                budget.path_visit()?;
                if matches!(constraint, Constraint::Property(child) if relevant.contains(child))
                {
                    is_relevant = true;
                    break;
                }
            }
            if is_relevant {
                budget.charge_memory(128)?;
                relevant.insert(shape.id.clone());
            }
        }
        if relevant.len() == before {
            return Ok(relevant);
        }
    }
}

fn qualifying_predicate<'a>(
    shape: &'a Shape,
    expected_predicates: &BTreeSet<NamedNode>,
) -> Option<&'a NamedNode> {
    if shape.deactivated || (shape.values.is_none() && shape.default_value.is_none()) {
        return None;
    }
    let Some(PropertyPath::Predicate(predicate)) = &shape.path else {
        return None;
    };
    expected_predicates.contains(predicate).then_some(predicate)
}

pub(super) fn admit(
    admissions: &mut usize,
    options: &ValidationOptions,
) -> Result<(), RuleError> {
    *admissions = admissions.saturating_add(1);
    if *admissions > options.limits.max_derived_triples {
        return Err(ValidationError::LimitExceeded {
            kind: LimitKind::DerivedTriples,
            limit: options.limits.max_derived_triples,
        }
        .into());
    }
    Ok(())
}

pub(super) fn cleanup_layer(
    base: &Dataset,
    entailed: &mut Dataset,
    inference: &mut Dataset,
    layer_start_inference: &Dataset,
    derived: &Dataset,
    budget: &mut Budget<'_>,
) -> Result<(), RuleError> {
    let mut expired = Vec::new();
    for quad in derived {
        budget.path_visit()?;
        if !base.contains(&quad) && !inference.contains(&quad) {
            budget.charge_memory(128)?;
            expired.push(quad);
        }
    }
    #[cfg(not(feature = "rdf-12"))]
    let _: &Dataset = layer_start_inference;
    #[cfg(feature = "rdf-12")]
    cleanup_reifiers(
        entailed,
        inference,
        layer_start_inference,
        &expired,
        budget,
    )?;
    for quad in expired {
        entailed.remove(&quad);
    }
    Ok(())
}

#[cfg(feature = "rdf-12")]
fn cleanup_reifiers(
    entailed: &mut Dataset,
    inference: &mut Dataset,
    layer_start_inference: &Dataset,
    expired: &[Quad],
    budget: &mut Budget<'_>,
) -> Result<(), RuleError> {
    let mut expired_triples = HashSet::new();
    for quad in expired {
        budget.path_visit()?;
        let triple = oxrdf::Triple::from(quad.clone());
        if !expired_triples.contains(&triple) {
            budget.charge_memory(128)?;
            expired_triples.insert(triple);
        }
    }
    if expired_triples.is_empty() {
        return Ok(());
    }
    let mut reifiers = HashSet::<NamedOrBlankNode>::new();
    for quad in entailed.iter() {
        budget.path_visit()?;
        if quad.predicate.as_str() == RDF_REIFIES
            && matches!(&quad.object, Term::Triple(statement) if expired_triples.contains(statement.as_ref()))
            && !reifiers.contains(&quad.subject)
        {
            budget.charge_memory(128)?;
            reifiers.insert(quad.subject);
        }
    }
    for reifier in reifiers {
        let mut current_outgoing = Vec::new();
        for quad in inference.quads_for_subject(&reifier) {
            budget.path_visit()?;
            if !layer_start_inference.contains(&quad) {
                budget.charge_memory(128)?;
                current_outgoing.push(quad);
            }
        }
        if current_outgoing.is_empty() {
            continue;
        }
        for quad in entailed.quads_for_subject(&reifier) {
            budget.path_visit()?;
            if quad.predicate.as_str() != RDF_REIFIES {
                continue;
            }
            let Term::Triple(statement) = quad.object else {
                continue;
            };
            if expired_triples.contains(statement.as_ref()) {
                continue;
            }
            let statement = Quad::new(
                statement.subject.clone(),
                statement.predicate.clone(),
                statement.object.clone(),
                GraphName::DefaultGraph,
            );
            if entailed.contains(&statement) {
                return Err(ValidationError::UnsupportedFeature(
                    "a reifier shared by expired and retained triples cannot be cleaned safely"
                        .to_owned(),
                )
                .into());
            }
        }
        for quad in current_outgoing {
            inference.remove(&quad);
            entailed.remove(&quad);
        }
    }
    Ok(())
}
