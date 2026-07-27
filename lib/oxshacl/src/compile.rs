use crate::constraint::literal_bool;
use crate::control::{Budget, ValidationError, ValidationOptions};
use crate::model::{ConstraintAnnotation, GraphSnapshot, Shape, ShapeMap, Target, shape_key};
use crate::profile::{ProfileId, ProfileSet};
use crate::{Constraint, ShapeId};
use oxrdf::{Literal, NamedNode, NamedOrBlankNode};
use std::collections::{BTreeMap, BTreeSet};

mod api;
mod conformance;
mod constraints;
#[cfg(feature = "sparql")]
mod custom;
mod imports;
mod node_expression;
#[cfg(feature = "sparql")]
mod prefixes;
mod rdf;
#[cfg(feature = "sparql")]
mod result_annotations;
#[cfg(feature = "sparql")]
mod syntax;
mod well_formed;

use self::constraints::compile_constraints;
pub use self::imports::ShapesGraphImportResolver;
use self::rdf::{RdfView, as_literal, as_named, sh, to_shape_id};

/// Failure while resolving, checking, or compiling a shapes graph.
#[derive(Debug, thiserror::Error)]
pub enum CompileError {
    /// SHACL validation or resource-control failure.
    #[error(transparent)]
    Validation(#[from] ValidationError),
    /// An `owl:imports` target was not supplied to the compiler.
    #[error("shapes graph import <{iri}> was not supplied by the application resolver")]
    UnresolvedImport {
        /// Unresolved import IRI.
        iri: NamedNode,
    },
    /// The application import resolver returned an error.
    #[error("application resolver failed for shapes graph import <{iri}>: {source}")]
    ImportResolution {
        /// Import IRI being resolved.
        iri: NamedNode,
        #[source]
        /// Application-provided resolver error.
        source: Box<dyn std::error::Error + Send + Sync>,
    },
}

/// Immutable, checked representation of a shapes graph and its selected profiles.
#[derive(Clone, Debug)]
pub struct ShapesGraph {
    source: GraphSnapshot,
    profiles: ProfileSet,
    shapes: ShapeMap,
    well_formedness_checked: bool,
}

/// Compiles one node-expression RDF term under the supplied resource limits.
pub fn compile_node_expression(
    source: &GraphSnapshot,
    term: &oxrdf::Term,
    options: &ValidationOptions,
) -> Result<crate::NodeExpression, CompileError> {
    let mut budget = Budget::new(options)?;
    let view = RdfView::new(source);
    view.expression(
        term,
        &mut budget,
        0,
        options.limits.max_recursion_depth,
        options.limits.max_list_items,
    )
    .map_err(Into::into)
}

#[cfg(feature = "sparql")]
pub(crate) fn apply_sparql_prefixes(
    source: &GraphSnapshot,
    owner: &ShapeId,
    query: &str,
) -> Result<String, ValidationError> {
    RdfView::new(source).apply_sparql_prefixes(owner, query)
}

fn compile_shape(
    view: &RdfView<'_>,
    id: ShapeId,
    budget: &mut Budget<'_>,
) -> Result<Shape, ValidationError> {
    let node_shape = view.has_type(&id, "http://www.w3.org/ns/shacl#NodeShape");
    let property_shape = view.has_type(&id, "http://www.w3.org/ns/shacl#PropertyShape");
    let path_term = view.optional_one(&id, &sh("path"))?;
    if node_shape && (property_shape || path_term.is_some()) {
        return Err(ValidationError::IllFormed(format!(
            "`{id}` cannot be both a node shape and property shape"
        )));
    }
    if property_shape && path_term.is_none() {
        return Err(ValidationError::IllFormed(format!(
            "property shape `{id}` requires exactly one sh:path"
        )));
    }
    let path = path_term
        .map(|term| {
            view.path(
                &term,
                budget,
                0,
                budget.limits().max_recursion_depth,
                budget.limits().max_list_items,
            )
        })
        .transpose()?;
    let mut targets = Vec::new();
    for term in view.objects(&id, &sh("targetNode")) {
        if view.is_expression_node(&term) || view.is_custom_expression_node(&term, budget)? {
            targets.push(Target::Expression(view.expression(
                &term,
                budget,
                0,
                budget.limits().max_recursion_depth,
                budget.limits().max_list_items,
            )?));
        } else {
            targets.push(Target::Node(term));
        }
    }
    for term in view.objects(&id, &sh("targetClass")) {
        targets.push(Target::Class(as_named(term, &sh("targetClass"))?));
    }
    for term in view.objects(&id, &sh("targetSubjectsOf")) {
        targets.push(Target::SubjectsOf(as_named(term, &sh("targetSubjectsOf"))?));
    }
    for term in view.objects(&id, &sh("targetObjectsOf")) {
        targets.push(Target::ObjectsOf(as_named(term, &sh("targetObjectsOf"))?));
    }
    for term in view.objects(&id, &sh("targetWhere")) {
        targets.push(Target::Where(to_shape_id(&term).ok_or_else(|| {
            ValidationError::IllFormed(
                "sh:targetWhere values must be IRIs or blank nodes".to_owned(),
            )
        })?));
    }
    if (view.has_type(&id, "http://www.w3.org/2000/01/rdf-schema#Class")
        || view.has_type(&id, "http://www.w3.org/ns/shacl#ShapeClass"))
        && let NamedOrBlankNode::NamedNode(class) = &id
    {
        targets.push(Target::Class(class.clone()));
    }
    let severity = view
        .optional_one(&id, &sh("severity"))?
        .map(|term| as_named(term, &sh("severity")))
        .transpose()?
        .unwrap_or_else(|| NamedNode::new_unchecked("http://www.w3.org/ns/shacl#Violation"));
    let messages = view
        .objects(&id, &sh("message"))
        .into_iter()
        .map(|term| as_literal(term, &sh("message")))
        .collect::<Result<Vec<Literal>, _>>()?;
    let deactivated = view
        .optional_one(&id, &sh("deactivated"))?
        .map(|term| {
            let literal = as_literal(term, &sh("deactivated"))?;
            literal_bool(&literal).ok_or_else(|| {
                ValidationError::IllFormed("sh:deactivated must be boolean".to_owned())
            })
        })
        .transpose()?
        .unwrap_or(false);
    let values = view
        .optional_one(&id, &sh("values"))?
        .map(|term| {
            view.expression(
                &term,
                budget,
                0,
                budget.limits().max_recursion_depth,
                budget.limits().max_list_items,
            )
        })
        .transpose()?;
    let default_value = view
        .optional_one(&id, &sh("defaultValue"))?
        .map(|term| {
            view.expression(
                &term,
                budget,
                0,
                budget.limits().max_recursion_depth,
                budget.limits().max_list_items,
            )
        })
        .transpose()?;
    if (values.is_some() || default_value.is_some())
        && !matches!(path, Some(crate::PropertyPath::Predicate(_)))
    {
        return Err(ValidationError::IllFormed(
            "sh:values and sh:defaultValue require a predicate path".to_owned(),
        ));
    }
    let constraints = compile_constraints(view, &id, budget)?;
    let mut occurrences = BTreeMap::new();
    let constraint_annotations = constraints
        .iter()
        .map(|constraint| {
            let Some(local) = constraint.parameter_local_name() else {
                return Ok(ConstraintAnnotation::default());
            };
            let occurrence = occurrences.entry(local).or_insert(0_usize);
            let annotation = view.statement_annotation(&id, &sh(local), *occurrence)?;
            *occurrence = occurrence.saturating_add(1);
            Ok(annotation)
        })
        .collect::<Result<Vec<_>, ValidationError>>()?;
    Ok(Shape {
        id,
        path,
        values,
        default_value,
        targets,
        constraints,
        constraint_annotations,
        severity,
        messages,
        deactivated,
    })
}

fn validate_profile_features(profiles: &ProfileSet, shape: &Shape) -> Result<(), ValidationError> {
    for constraint in &shape.constraints {
        if matches!(
            constraint,
            Constraint::Expression(_) | Constraint::NodeByExpression(_)
        ) && !profiles.contains(ProfileId::NodeExpressions12Subset20260108)
        {
            return Err(ValidationError::UnsupportedFeature(
                "node expressions require the dated Node Expressions profile".to_owned(),
            ));
        }
        #[cfg(feature = "sparql")]
        if matches!(constraint, Constraint::Sparql(_))
            && !profiles.contains(ProfileId::SparqlExtensions12Subset20260130)
        {
            return Err(ValidationError::UnsupportedFeature(
                "SHACL-SPARQL requires the dated SPARQL Extensions profile".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_dependencies(shapes: &ShapeMap) -> Result<(), ValidationError> {
    for shape in shapes.values() {
        for target in &shape.targets {
            if let Target::Where(dependency) = target
                && !shapes.contains_key(&shape_key(dependency))
            {
                return Err(ValidationError::UnknownShape(dependency.to_string()));
            }
        }
        for dependency in shape.constraints.iter().flat_map(Constraint::dependencies) {
            if !shapes.contains_key(&shape_key(dependency)) {
                return Err(ValidationError::UnknownShape(dependency.to_string()));
            }
        }
    }
    let mut complete = BTreeSet::new();
    let mut active = BTreeSet::new();
    for key in shapes.keys() {
        visit(key, shapes, &mut active, &mut complete)?;
    }
    Ok(())
}

fn visit(
    key: &str,
    shapes: &ShapeMap,
    active: &mut BTreeSet<String>,
    complete: &mut BTreeSet<String>,
) -> Result<(), ValidationError> {
    if complete.contains(key) {
        return Ok(());
    }
    if !active.insert(key.to_owned()) {
        return Err(ValidationError::RecursiveShape(key.to_owned()));
    }
    let shape = shapes
        .get(key)
        .ok_or_else(|| ValidationError::UnknownShape(key.to_owned()))?;
    for dependency in shape.constraints.iter().flat_map(Constraint::dependencies) {
        visit(&shape_key(dependency), shapes, active, complete)?;
    }
    for target in &shape.targets {
        if let Target::Where(dependency) = target {
            visit(&shape_key(dependency), shapes, active, complete)?;
        }
    }
    active.remove(key);
    complete.insert(key.to_owned());
    Ok(())
}

fn reject_unsupported_shape_properties(
    source: &GraphSnapshot,
    shape: &ShapeId,
) -> Result<(), ValidationError> {
    let shape = shape.to_string();
    for triple in source.triples() {
        if triple.subject.to_string() != shape {
            continue;
        }
        let predicate = triple.predicate.as_str();
        if let Some(local) = predicate.strip_prefix("http://www.w3.org/ns/shacl#")
            && !supported_shape_property(local)
        {
            return Err(ValidationError::UnsupportedFeature(format!(
                "sh:{local} on shape `{shape}`"
            )));
        }
    }
    Ok(())
}

fn supported_shape_property(local: &str) -> bool {
    matches!(
        local,
        "path"
            | "targetNode"
            | "targetClass"
            | "targetSubjectsOf"
            | "targetObjectsOf"
            | "targetWhere"
            | "severity"
            | "message"
            | "deactivated"
            | "name"
            | "description"
            | "order"
            | "group"
            | "intent"
            | "agentInstruction"
            | "codeIdentifier"
            | "unit"
            | "defaultValue"
            | "values"
            | "class"
            | "datatype"
            | "nodeKind"
            | "minCount"
            | "maxCount"
            | "minExclusive"
            | "minInclusive"
            | "maxExclusive"
            | "maxInclusive"
            | "minLength"
            | "maxLength"
            | "pattern"
            | "flags"
            | "singleLine"
            | "languageIn"
            | "uniqueLang"
            | "memberShape"
            | "minListLength"
            | "maxListLength"
            | "uniqueMembers"
            | "equals"
            | "disjoint"
            | "subsetOf"
            | "lessThan"
            | "lessThanOrEquals"
            | "not"
            | "and"
            | "or"
            | "xone"
            | "node"
            | "property"
            | "someValue"
            | "qualifiedValueShape"
            | "qualifiedMinCount"
            | "qualifiedMaxCount"
            | "qualifiedValueShapesDisjoint"
            | "reifierShape"
            | "reificationRequired"
            | "closed"
            | "ignoredProperties"
            | "hasValue"
            | "in"
            | "rootClass"
            | "uniqueValuesFor"
            | "expression"
            | "nodeByExpression"
            | "sparql"
            | "rule"
            | "prefixes"
            | "select"
            | "optional"
            | "keyParameter"
    )
}

#[cfg(test)]
mod tests;
