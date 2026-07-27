use super::rdf::{RdfView, to_shape_id};
use crate::control::{Budget, ValidationError, ValidationOptions};
use crate::model::{GraphSnapshot, ShapeId};
use crate::profile::{ProfileId, ProfileSet};
use oxrdf::{NamedOrBlankNode, Term};
use std::collections::{BTreeMap, BTreeSet};

mod constraints;
mod index;
mod path;
mod reifiers;

use self::index::GraphIndex;

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
#[cfg(feature = "rdf-12")]
const RDF_REIFIES: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";
const RDFS_CLASS: &str = "http://www.w3.org/2000/01/rdf-schema#Class";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const SH: &str = "http://www.w3.org/ns/shacl#";
const NODE_SHAPE: &str = "http://www.w3.org/ns/shacl#NodeShape";
const PROPERTY_SHAPE: &str = "http://www.w3.org/ns/shacl#PropertyShape";
const SHAPES_GRAPH: &str = "http://www.w3.org/ns/shacl#ShapesGraph";
const DATA_GRAPH: &str = "http://www.w3.org/ns/shacl#DataGraph";
const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";
const RDF_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
const RDF_DIR_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
const RDF_HTML: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#HTML";

const SHAPE_TRIGGERS: &[&str] = &[
    "path",
    "targetNode",
    "targetClass",
    "targetSubjectsOf",
    "targetObjectsOf",
    "targetWhere",
    "class",
    "datatype",
    "nodeKind",
    "minCount",
    "maxCount",
    "minExclusive",
    "minInclusive",
    "maxExclusive",
    "maxInclusive",
    "minLength",
    "maxLength",
    "pattern",
    "flags",
    "singleLine",
    "languageIn",
    "uniqueLang",
    "memberShape",
    "minListLength",
    "maxListLength",
    "uniqueMembers",
    "equals",
    "disjoint",
    "subsetOf",
    "lessThan",
    "lessThanOrEquals",
    "not",
    "and",
    "or",
    "xone",
    "node",
    "property",
    "someValue",
    "qualifiedValueShape",
    "qualifiedMinCount",
    "qualifiedMaxCount",
    "qualifiedValueShapesDisjoint",
    "reifierShape",
    "reificationRequired",
    "closed",
    "ignoredProperties",
    "hasValue",
    "in",
    "rootClass",
    "uniqueValuesFor",
];

const DIRECT_SHAPE_REFERENCES: &[&str] = &[
    "targetWhere",
    "memberShape",
    "not",
    "node",
    "property",
    "someValue",
    "qualifiedValueShape",
    "reifierShape",
];

const LIST_SHAPE_REFERENCES: &[&str] = &["and", "or", "xone"];

pub(super) fn check(
    source: &GraphSnapshot,
    profiles: &ProfileSet,
    options: &ValidationOptions,
) -> Result<BTreeSet<String>, ValidationError> {
    let mut budget = Budget::new(options)?;
    budget.charge_memory(source.triple_count().saturating_mul(192))?;
    let index = GraphIndex::new(source);
    check_global_syntax(&index)?;
    if profiles.contains(ProfileId::NodeExpressions12Subset20260108) {
        RdfView::new(source).validate_custom_node_expression_functions(
            &mut budget,
            options.limits.max_recursion_depth,
            options.limits.max_list_items,
        )?;
    }
    let shapes = index.shape_nodes(&mut budget)?;
    for shape in shapes.values() {
        budget.check()?;
        check_shape_header(&index, shape, profiles, &mut budget)?;
        constraints::check(&index, shape, &mut budget)?;
    }
    check_shape_references(&index, &shapes, &mut budget)?;
    reifiers::check(&index, &shapes)?;
    Ok(shapes.into_keys().collect())
}

fn insert_shape(shapes: &mut BTreeMap<String, ShapeId>, shape: ShapeId) {
    shapes.entry(shape.to_string()).or_insert(shape);
}

fn check_global_syntax(index: &GraphIndex) -> Result<(), ValidationError> {
    for (predicate, rule) in [
        (sh("entailment"), "entailment-nodeKind"),
        (sh("shapesGraph"), "shapesGraph-nodeKind"),
        (sh("shape"), "shape-nodeKind"),
    ] {
        for triple in index
            .triples()
            .iter()
            .filter(|triple| triple.predicate.as_str() == predicate)
        {
            if !matches!(triple.object, Term::NamedNode(_)) {
                return Err(syntax(rule, &triple.subject, "value must be an IRI"));
            }
        }
    }
    for (class, rule) in [(SHAPES_GRAPH, "ShapesGraph"), (DATA_GRAPH, "DataGraph")] {
        for triple in index
            .triples()
            .iter()
            .filter(|triple| triple.predicate.as_str() == RDF_TYPE)
        {
            if matches!(&triple.object, Term::NamedNode(actual) if actual.as_str() == class)
                && !matches!(triple.subject, NamedOrBlankNode::NamedNode(_))
            {
                return Err(syntax(
                    rule,
                    &triple.subject,
                    "graph type subjects must be IRIs",
                ));
            }
        }
    }
    Ok(())
}

fn check_message_values(index: &GraphIndex, subject: &ShapeId) -> Result<(), ValidationError> {
    for value in index.values(subject, &sh("message")) {
        let Term::Literal(literal) = value else {
            return Err(syntax(
                "message-datatype",
                subject,
                "sh:message values must be literals",
            ));
        };
        if !matches!(
            literal.datatype().as_str(),
            XSD_STRING | RDF_LANG_STRING | RDF_DIR_LANG_STRING | RDF_HTML
        ) {
            return Err(syntax(
                "message-datatype",
                subject,
                "sh:message has an unsupported datatype",
            ));
        }
    }
    Ok(())
}

fn check_shape_header(
    index: &GraphIndex,
    shape: &ShapeId,
    profiles: &ProfileSet,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    let paths = index.values(shape, &sh("path"));
    if paths.len() > 1 {
        return Err(syntax(
            "path-maxCount",
            shape,
            "has multiple sh:path values",
        ));
    }
    let declared_node = index.is_instance(shape, NODE_SHAPE);
    let declared_property = index.is_instance(shape, PROPERTY_SHAPE);
    if declared_node && !paths.is_empty() {
        return Err(syntax(
            "NodeShape-path-maxCount",
            shape,
            "is a node shape with sh:path",
        ));
    }
    if declared_property && paths.len() != 1 {
        return Err(syntax(
            "PropertyShape-path-minCount",
            shape,
            "is a property shape without exactly one sh:path",
        ));
    }
    if !matches!(shape, NamedOrBlankNode::NamedNode(_))
        && (declared_node || declared_property)
        && index.is_instance(shape, RDFS_CLASS)
    {
        return Err(syntax(
            "implicit-targetClass-nodeKind",
            shape,
            "is also an rdfs:Class but is not an IRI",
        ));
    }
    if let Some(path) = paths.first() {
        if !matches!(path, Term::NamedNode(_) | Term::BlankNode(_)) {
            return Err(syntax(
                "path-node",
                shape,
                "sh:path must be an IRI or blank node",
            ));
        }
        path::check(index, path, budget)?;
    }
    for (local, rule) in [
        ("targetClass", "targetClass-nodeKind"),
        ("targetSubjectsOf", "targetSubjectsOf-nodeKind"),
        ("targetObjectsOf", "targetObjectsOf-nodeKind"),
    ] {
        for value in index.values(shape, &sh(local)) {
            if !matches!(value, Term::NamedNode(_)) {
                return Err(syntax(rule, shape, "value must be an IRI"));
            }
        }
    }
    for value in index.values(shape, &sh("targetNode")) {
        check_expression(index, value, profiles, budget, shape, "targetNode-nodeKind")?;
    }
    for local in ["values", "defaultValue"] {
        let values = index.values(shape, &sh(local));
        if values.len() > 1 {
            return Err(syntax(
                if local == "values" {
                    "path-values"
                } else {
                    "path-defaultValue"
                },
                shape,
                "has multiple values",
            ));
        }
        if let Some(value) = values.first() {
            if !matches!(paths.first(), Some(Term::NamedNode(_))) {
                return Err(syntax(
                    "path-values-iri",
                    shape,
                    "sh:values or sh:defaultValue requires a predicate path",
                ));
            }
            check_expression(
                index,
                value,
                profiles,
                budget,
                shape,
                if local == "values" {
                    "path-values"
                } else {
                    "path-defaultValue"
                },
            )?;
        }
    }
    check_shape_annotations(index, shape)
}

fn check_expression(
    index: &GraphIndex,
    value: &Term,
    profiles: &ProfileSet,
    budget: &mut Budget<'_>,
    owner: &ShapeId,
    rule: &str,
) -> Result<(), ValidationError> {
    if matches!(value, Term::NamedNode(_) | Term::Literal(_)) {
        return Ok(());
    }
    if !profiles.contains(ProfileId::NodeExpressions12Subset20260108) {
        return Err(syntax(
            rule,
            owner,
            "Core node expressions must be IRIs or literals",
        ));
    }
    RdfView::new(index.source()).expression(
        value,
        budget,
        0,
        budget.limits().max_recursion_depth,
        budget.limits().max_list_items,
    )?;
    Ok(())
}

fn check_shape_annotations(index: &GraphIndex, shape: &ShapeId) -> Result<(), ValidationError> {
    check_message_values(index, shape)?;
    let severity = index.values(shape, &sh("severity"));
    if severity.len() > 1 {
        return Err(syntax(
            "severity-maxCount",
            shape,
            "has multiple sh:severity values",
        ));
    }
    if severity
        .iter()
        .any(|value| !matches!(value, Term::NamedNode(_)))
    {
        return Err(syntax(
            "severity-nodeKind",
            shape,
            "sh:severity must be an IRI",
        ));
    }
    let deactivated = index.values(shape, &sh("deactivated"));
    if deactivated.len() > 1 {
        return Err(syntax(
            "deactivated-maxCount",
            shape,
            "has multiple sh:deactivated values",
        ));
    }
    if let Some(value) = deactivated.first()
        && !is_core_boolean(value)
    {
        return Err(syntax(
            "deactivated-datatype",
            shape,
            "sh:deactivated must be true or false",
        ));
    }
    Ok(())
}

fn check_shape_references(
    index: &GraphIndex,
    shapes: &BTreeMap<String, ShapeId>,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    for owner in shapes.values() {
        for (local, rule, expected_property) in [
            ("targetWhere", "targetWhere-node", None),
            ("memberShape", "memberShape-node", Some(false)),
            ("not", "not-node", None),
            ("node", "node-node", Some(false)),
            ("property", "property-node", Some(true)),
            ("someValue", "someValue-shape", None),
            ("qualifiedValueShape", "qualifiedValueShape-node", None),
            ("reifierShape", "reifierShape-node", Some(false)),
        ] {
            for term in index.values(owner, &sh(local)) {
                check_shape_reference(index, shapes, owner, term, rule, expected_property)?;
            }
        }
        for local in LIST_SHAPE_REFERENCES {
            for head in index.values(owner, &sh(local)) {
                for term in path::list(index, head, budget, &format!("{local}-node"))? {
                    check_shape_reference(
                        index,
                        shapes,
                        owner,
                        &term,
                        &format!("{local}-members-node"),
                        None,
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn check_shape_reference(
    index: &GraphIndex,
    shapes: &BTreeMap<String, ShapeId>,
    owner: &ShapeId,
    term: &Term,
    rule: &str,
    expected_property: Option<bool>,
) -> Result<(), ValidationError> {
    let referenced = to_shape_id(term)
        .ok_or_else(|| syntax(rule, owner, "shape reference must be an IRI or blank node"))?;
    if !shapes.contains_key(&referenced.to_string()) {
        return Err(syntax(rule, owner, "references a node that is not a shape"));
    }
    if let Some(expected_property) = expected_property {
        let property = !index.values(&referenced, &sh("path")).is_empty();
        if property != expected_property {
            return Err(syntax(
                rule,
                owner,
                if expected_property {
                    "must reference a property shape"
                } else {
                    "must reference a node shape"
                },
            ));
        }
    }
    Ok(())
}

pub(super) fn syntax(rule: &str, node: &impl ToString, detail: &str) -> ValidationError {
    ValidationError::IllFormed(format!("[{rule}] `{}` {detail}", node.to_string()))
}

pub(super) fn sh(local: &str) -> String {
    format!("{SH}{local}")
}

pub(super) fn is_core_boolean(term: &Term) -> bool {
    matches!(
        term,
        Term::Literal(literal) if crate::constraint::literal_bool(literal).is_some()
    )
}
