use super::GraphIndex;
#[cfg(feature = "rdf-12")]
use super::{RDF_REIFIES, SH, check_message_values, is_core_boolean, sh, syntax};
use crate::control::ValidationError;
use crate::model::ShapeId;
#[cfg(feature = "rdf-12")]
use oxrdf::{Term, Triple};
use std::collections::BTreeMap;

#[cfg(feature = "rdf-12")]
const SINGLE_PARAMETER_COMPONENTS: &[&str] = &[
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
    "hasValue",
    "in",
    "rootClass",
    "uniqueValuesFor",
];

#[cfg(feature = "rdf-12")]
pub(super) fn check(
    index: &GraphIndex,
    shapes: &BTreeMap<String, ShapeId>,
) -> Result<(), ValidationError> {
    let mut reifiers = BTreeMap::<String, Vec<ShapeId>>::new();
    for triple in index
        .triples()
        .iter()
        .filter(|triple| triple.predicate.as_str() == RDF_REIFIES)
    {
        let Term::Triple(statement) = &triple.object else {
            continue;
        };
        if shapes.contains_key(&statement.subject.to_string())
            && statement
                .predicate
                .as_str()
                .strip_prefix(SH)
                .is_some_and(is_constraint_parameter)
        {
            reifiers
                .entry(statement.to_string())
                .or_default()
                .push(triple.subject.clone());
        }
    }

    for nodes in reifiers.values() {
        check_deactivation(index, nodes)?;
    }
    for shape in shapes.values() {
        check_constraint_annotations(index, shape, &reifiers)?;
    }
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[expect(
    clippy::unnecessary_wraps,
    reason = "keeps one fallible interface across RDF feature sets"
)]
pub(super) fn check(
    _index: &GraphIndex,
    _shapes: &BTreeMap<String, ShapeId>,
) -> Result<(), ValidationError> {
    Ok(())
}

#[cfg(feature = "rdf-12")]
fn check_constraint_annotations(
    index: &GraphIndex,
    shape: &ShapeId,
    reifiers: &BTreeMap<String, Vec<ShapeId>>,
) -> Result<(), ValidationError> {
    for local in SINGLE_PARAMETER_COMPONENTS {
        for statement in statements(index, shape, &[*local]) {
            check_annotation_counts(index, &annotation_nodes([statement], reifiers))?;
        }
    }

    check_component(index, shape, reifiers, &["pattern"], &["pattern", "flags"])?;
    check_component(
        index,
        shape,
        reifiers,
        &["qualifiedValueShape", "qualifiedMinCount"],
        &[
            "qualifiedValueShape",
            "qualifiedMinCount",
            "qualifiedValueShapesDisjoint",
        ],
    )?;
    check_component(
        index,
        shape,
        reifiers,
        &["qualifiedValueShape", "qualifiedMaxCount"],
        &[
            "qualifiedValueShape",
            "qualifiedMaxCount",
            "qualifiedValueShapesDisjoint",
        ],
    )?;
    check_component(
        index,
        shape,
        reifiers,
        &["reifierShape"],
        &["reifierShape", "reificationRequired"],
    )?;
    check_component(
        index,
        shape,
        reifiers,
        &["closed"],
        &["closed", "ignoredProperties"],
    )
}

#[cfg(feature = "rdf-12")]
fn check_component(
    index: &GraphIndex,
    shape: &ShapeId,
    reifiers: &BTreeMap<String, Vec<ShapeId>>,
    mandatory: &[&str],
    parameters: &[&str],
) -> Result<(), ValidationError> {
    if mandatory
        .iter()
        .any(|local| index.values(shape, &sh(local)).is_empty())
    {
        return Ok(());
    }
    check_annotation_counts(
        index,
        &annotation_nodes(statements(index, shape, parameters), reifiers),
    )
}

#[cfg(feature = "rdf-12")]
fn statements<'a>(index: &'a GraphIndex, shape: &ShapeId, parameters: &[&str]) -> Vec<&'a Triple> {
    let shape = shape.to_string();
    index
        .triples()
        .iter()
        .filter(|triple| {
            triple.subject.to_string() == shape
                && triple
                    .predicate
                    .as_str()
                    .strip_prefix(SH)
                    .is_some_and(|local| parameters.contains(&local))
        })
        .collect()
}

#[cfg(feature = "rdf-12")]
fn annotation_nodes<'a>(
    statements: impl IntoIterator<Item = &'a Triple>,
    reifiers: &BTreeMap<String, Vec<ShapeId>>,
) -> Vec<ShapeId> {
    let mut nodes = BTreeMap::new();
    for statement in statements {
        for node in reifiers.get(&statement.to_string()).into_iter().flatten() {
            nodes
                .entry(node.to_string())
                .or_insert_with(|| node.clone());
        }
    }
    nodes.into_values().collect()
}

#[cfg(feature = "rdf-12")]
fn check_annotation_counts(index: &GraphIndex, nodes: &[ShapeId]) -> Result<(), ValidationError> {
    for node in nodes {
        check_message_values(index, node)?;
        if index
            .values(node, &sh("severity"))
            .iter()
            .any(|value| !matches!(value, Term::NamedNode(_)))
        {
            return Err(syntax(
                "severity-nodeKind",
                node,
                "reified sh:severity must be an IRI",
            ));
        }
    }
    let severity_count = nodes
        .iter()
        .map(|node| index.values(node, &sh("severity")).len())
        .sum::<usize>();
    let message_count = nodes
        .iter()
        .map(|node| index.values(node, &sh("message")).len())
        .sum::<usize>();
    if severity_count > 1 {
        return Err(syntax(
            "severity-reifier-maxCount",
            &nodes[0],
            "constraint reifiers have multiple sh:severity values",
        ));
    }
    if message_count > 1 {
        return Err(syntax(
            "message-reifier-maxCount",
            &nodes[0],
            "constraint reifiers have multiple sh:message values",
        ));
    }
    Ok(())
}

#[cfg(feature = "rdf-12")]
fn check_deactivation(index: &GraphIndex, nodes: &[ShapeId]) -> Result<(), ValidationError> {
    let deactivating = nodes
        .iter()
        .filter(|node| !index.values(node, &sh("deactivated")).is_empty())
        .collect::<Vec<_>>();
    if deactivating.len() > 1 {
        return Err(syntax(
            "deactivated-reified-maxCount",
            deactivating[0],
            "constraint triple has multiple deactivating reifiers",
        ));
    }
    for node in nodes {
        for value in index.values(node, &sh("deactivated")) {
            if !is_core_boolean(value) {
                return Err(syntax(
                    "deactivated-datatype",
                    node,
                    "reified sh:deactivated must be true or false",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(feature = "rdf-12")]
fn is_constraint_parameter(local: &str) -> bool {
    SINGLE_PARAMETER_COMPONENTS.contains(&local)
        || matches!(
            local,
            "pattern"
                | "flags"
                | "qualifiedValueShape"
                | "qualifiedMinCount"
                | "qualifiedMaxCount"
                | "qualifiedValueShapesDisjoint"
                | "reifierShape"
                | "reificationRequired"
                | "closed"
                | "ignoredProperties"
        )
}
