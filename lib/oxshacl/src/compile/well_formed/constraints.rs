use super::path;
use super::{GraphIndex, sh, syntax};
use crate::control::{Budget, ValidationError};
use crate::model::ShapeId;
use oxrdf::Term;
use regex::RegexBuilder;
use std::borrow::Cow;

const XSD_BOOLEAN: &str = "http://www.w3.org/2001/XMLSchema#boolean";
const XSD_INTEGER: &str = "http://www.w3.org/2001/XMLSchema#integer";
const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";
const SH_BY_TYPES: &str = "http://www.w3.org/ns/shacl#ByTypes";

pub(super) fn check(
    index: &GraphIndex,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    let property_shape = !index.values(shape, &sh("path")).is_empty();
    check_iri_or_iri_list(index, shape, "class", false, budget)?;
    check_iri_or_iri_list(index, shape, "datatype", true, budget)?;
    check_node_kind(index, shape, budget)?;
    check_counts_and_ranges(index, shape, property_shape)?;
    check_strings(index, shape, property_shape, budget)?;
    check_lists(index, shape, budget)?;
    check_paths(index, shape, property_shape, budget)?;
    check_qualified(index, shape, property_shape)?;
    check_closed_and_reification(index, shape)?;
    check_iri_or_iri_list(index, shape, "rootClass", false, budget)?;
    check_iri_or_iri_list(index, shape, "uniqueValuesFor", false, budget)?;
    Ok(())
}

fn check_iri_or_iri_list(
    index: &GraphIndex,
    shape: &ShapeId,
    local: &str,
    at_most_one: bool,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    let values = index.values(shape, &sh(local));
    if at_most_one && values.len() > 1 {
        return Err(syntax(
            &format!("{local}-maxCount"),
            shape,
            "has multiple values",
        ));
    }
    for value in values {
        if matches!(value, Term::NamedNode(_)) {
            continue;
        }
        let members = path::list(index, value, budget, &format!("{local}-nodeKind"))?;
        if members
            .iter()
            .any(|member| !matches!(member, Term::NamedNode(_)))
        {
            return Err(syntax(
                &format!("{local}-nodeKind"),
                shape,
                "list members must be IRIs",
            ));
        }
    }
    Ok(())
}

fn check_node_kind(
    index: &GraphIndex,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    let values = index.values(shape, &sh("nodeKind"));
    if values.len() > 1 {
        return Err(syntax(
            "nodeKind-maxCount",
            shape,
            "has multiple sh:nodeKind values",
        ));
    }
    let Some(value) = values.first() else {
        return Ok(());
    };
    let all = [
        "BlankNode",
        "IRI",
        "Literal",
        "BlankNodeOrIRI",
        "BlankNodeOrLiteral",
        "IRIOrLiteral",
        "TripleTerm",
    ];
    let basic = ["BlankNode", "IRI", "Literal", "TripleTerm"];
    match value {
        Term::NamedNode(node) if node_kind_is(node.as_str(), &all) => Ok(()),
        Term::NamedNode(_) => Err(syntax(
            "nodeKind-in",
            shape,
            "sh:nodeKind is not a defined node kind",
        )),
        _ => {
            let members = path::list(index, value, budget, "nodeKind-in")?;
            if members.iter().all(|member| {
                matches!(
                    member,
                    Term::NamedNode(node) if node_kind_is(node.as_str(), &basic)
                )
            }) {
                Ok(())
            } else {
                Err(syntax(
                    "nodeKind-in",
                    shape,
                    "node-kind list contains an unsupported member",
                ))
            }
        }
    }
}

fn node_kind_is(value: &str, allowed: &[&str]) -> bool {
    value
        .strip_prefix("http://www.w3.org/ns/shacl#")
        .is_some_and(|local| allowed.contains(&local))
}

fn check_counts_and_ranges(
    index: &GraphIndex,
    shape: &ShapeId,
    property_shape: bool,
) -> Result<(), ValidationError> {
    for local in ["minCount", "maxCount"] {
        let values = index.values(shape, &sh(local));
        if !property_shape && !values.is_empty() {
            return Err(syntax(
                &format!("{local}-scope"),
                shape,
                "node shape cannot use this parameter",
            ));
        }
        at_most_one(values, shape, &format!("{local}-maxCount"))?;
        require_datatype(values, shape, &format!("{local}-datatype"), XSD_INTEGER)?;
    }
    for local in [
        "minExclusive",
        "minInclusive",
        "maxExclusive",
        "maxInclusive",
    ] {
        let values = index.values(shape, &sh(local));
        at_most_one(values, shape, &format!("{local}-maxCount"))?;
        if values
            .iter()
            .any(|value| !matches!(value, Term::Literal(_)))
        {
            return Err(syntax(
                &format!("{local}-nodeKind"),
                shape,
                "value must be a literal",
            ));
        }
    }
    for local in ["minLength", "maxLength"] {
        let values = index.values(shape, &sh(local));
        at_most_one(values, shape, &format!("{local}-maxCount"))?;
        require_datatype(values, shape, &format!("{local}-datatype"), XSD_INTEGER)?;
    }
    for local in ["minListLength", "maxListLength"] {
        let values = index.values(shape, &sh(local));
        require_datatype(values, shape, &format!("{local}-datatype"), XSD_INTEGER)?;
        for value in values {
            let Term::Literal(value) = value else {
                unreachable!();
            };
            if !is_non_negative_integer(value.value()) {
                return Err(syntax(
                    &format!("{local}-minInclusive"),
                    shape,
                    "value must be non-negative",
                ));
            }
        }
    }
    Ok(())
}

fn is_non_negative_integer(value: &str) -> bool {
    let (negative, digits) = if let Some(digits) = value.strip_prefix('-') {
        (true, digits)
    } else {
        (false, value.strip_prefix('+').unwrap_or(value))
    };
    !digits.is_empty()
        && digits.bytes().all(|digit| digit.is_ascii_digit())
        && (!negative || digits.bytes().all(|digit| digit == b'0'))
}

fn check_strings(
    index: &GraphIndex,
    shape: &ShapeId,
    property_shape: bool,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    let patterns = index.values(shape, &sh("pattern"));
    let flags = index.values(shape, &sh("flags"));
    at_most_one(patterns, shape, "multiple-parameters")?;
    at_most_one(flags, shape, "multiple-parameters")?;
    require_datatype(patterns, shape, "pattern-datatype", XSD_STRING)?;
    require_datatype(flags, shape, "flags-datatype", XSD_STRING)?;
    if let Some(Term::Literal(pattern)) = patterns.first() {
        let flags = match flags.first() {
            Some(Term::Literal(flags)) => flags.value(),
            _ => "",
        };
        check_regex(pattern.value(), flags, shape)?;
    }
    let single_line = index.values(shape, &sh("singleLine"));
    at_most_one(single_line, shape, "singleLine-maxCount")?;
    require_datatype(single_line, shape, "singleLine-datatype", XSD_BOOLEAN)?;
    let language_in = index.values(shape, &sh("languageIn"));
    at_most_one(language_in, shape, "languageIn-maxCount")?;
    for value in language_in {
        let members = path::list(index, value, budget, "languageIn-node")?;
        require_datatype(&members, shape, "languageIn-members-datatype", XSD_STRING)?;
    }
    let unique_lang = index.values(shape, &sh("uniqueLang"));
    if !property_shape && !unique_lang.is_empty() {
        return Err(syntax(
            "uniqueLang-scope",
            shape,
            "node shape cannot use sh:uniqueLang",
        ));
    }
    at_most_one(unique_lang, shape, "uniqueLang-maxCount")?;
    require_datatype(unique_lang, shape, "uniqueLang-datatype", XSD_BOOLEAN)
}

fn check_regex(pattern: &str, flags: &str, shape: &ShapeId) -> Result<(), ValidationError> {
    if flags
        .chars()
        .any(|flag| !matches!(flag, 'i' | 'm' | 's' | 'x' | 'q'))
    {
        return Err(syntax(
            "pattern-regex",
            shape,
            "sh:flags contains an unsupported flag",
        ));
    }
    let pattern = if flags.contains('q') {
        Cow::Owned(regex::escape(pattern))
    } else {
        Cow::Borrowed(pattern)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(flags.contains('i'))
        .multi_line(flags.contains('m'))
        .dot_matches_new_line(flags.contains('s'))
        .ignore_whitespace(flags.contains('x'))
        .build()
        .map(|_| ())
        .map_err(|error| {
            syntax(
                "pattern-regex",
                shape,
                &format!("invalid regular expression: {error}"),
            )
        })
}

fn check_lists(
    index: &GraphIndex,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    require_datatype(
        index.values(shape, &sh("uniqueMembers")),
        shape,
        "uniqueMembers-datatype",
        XSD_BOOLEAN,
    )?;
    for local in ["languageIn", "in", "ignoredProperties"] {
        let values = index.values(shape, &sh(local));
        if local == "in" {
            at_most_one(values, shape, "in-maxCount")?;
        }
        if local == "ignoredProperties" {
            at_most_one(values, shape, "multiple-parameters")?;
        }
        for value in values {
            let members = path::list(index, value, budget, &format!("{local}-node"))?;
            if local == "ignoredProperties"
                && members
                    .iter()
                    .any(|member| !matches!(member, Term::NamedNode(_)))
            {
                return Err(syntax(
                    "ignoredProperties-members-nodeKind",
                    shape,
                    "list members must be IRIs",
                ));
            }
        }
    }
    Ok(())
}

fn check_paths(
    index: &GraphIndex,
    shape: &ShapeId,
    property_shape: bool,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    for local in [
        "equals",
        "disjoint",
        "subsetOf",
        "lessThan",
        "lessThanOrEquals",
    ] {
        let values = index.values(shape, &sh(local));
        if !property_shape && matches!(local, "lessThan" | "lessThanOrEquals") && !values.is_empty()
        {
            return Err(syntax(
                &format!("{local}-scope"),
                shape,
                "node shape cannot use this parameter",
            ));
        }
        for value in values {
            if !matches!(value, Term::NamedNode(_) | Term::BlankNode(_)) {
                return Err(syntax(
                    &format!("{local}-nodeKind"),
                    shape,
                    "value must be an IRI or blank node",
                ));
            }
            path::check(index, value, budget)?;
        }
    }
    Ok(())
}

fn check_qualified(
    index: &GraphIndex,
    shape: &ShapeId,
    property_shape: bool,
) -> Result<(), ValidationError> {
    for local in [
        "qualifiedValueShape",
        "qualifiedMinCount",
        "qualifiedMaxCount",
        "qualifiedValueShapesDisjoint",
    ] {
        at_most_one(
            index.values(shape, &sh(local)),
            shape,
            "multiple-parameters",
        )?;
    }
    if !property_shape && !index.values(shape, &sh("qualifiedValueShape")).is_empty() {
        return Err(syntax(
            "qualifiedValueShape-scope",
            shape,
            "node shape cannot use sh:qualifiedValueShape",
        ));
    }
    for local in ["qualifiedMinCount", "qualifiedMaxCount"] {
        require_datatype(
            index.values(shape, &sh(local)),
            shape,
            &format!("{local}-datatype"),
            XSD_INTEGER,
        )?;
    }
    require_datatype(
        index.values(shape, &sh("qualifiedValueShapesDisjoint")),
        shape,
        "qualifiedValueShapesDisjoint-datatype",
        XSD_BOOLEAN,
    )
}

fn check_closed_and_reification(
    index: &GraphIndex,
    shape: &ShapeId,
) -> Result<(), ValidationError> {
    for local in ["closed", "ignoredProperties"] {
        at_most_one(
            index.values(shape, &sh(local)),
            shape,
            "multiple-parameters",
        )?;
    }
    for value in index.values(shape, &sh("closed")) {
        if !matches!(
            value,
            Term::Literal(literal) if literal.datatype().as_str() == XSD_BOOLEAN
        ) && !matches!(value, Term::NamedNode(iri) if iri.as_str() == SH_BY_TYPES)
        {
            return Err(syntax(
                "closed-datatype",
                shape,
                "sh:closed must be boolean or sh:ByTypes",
            ));
        }
    }
    for local in ["reifierShape", "reificationRequired"] {
        at_most_one(
            index.values(shape, &sh(local)),
            shape,
            "multiple-parameters",
        )?;
    }
    require_datatype(
        index.values(shape, &sh("reificationRequired")),
        shape,
        "reificationRequired-datatype",
        XSD_BOOLEAN,
    )?;
    if !index.values(shape, &sh("reifierShape")).is_empty()
        && !matches!(index.values(shape, &sh("path")), [Term::NamedNode(_)])
    {
        return Err(syntax(
            "reifierShape-node",
            shape,
            "sh:reifierShape requires an IRI sh:path",
        ));
    }
    Ok(())
}

fn at_most_one(values: &[Term], shape: &ShapeId, rule: &str) -> Result<(), ValidationError> {
    if values.len() > 1 {
        Err(syntax(rule, shape, "has multiple values"))
    } else {
        Ok(())
    }
}

fn require_datatype(
    values: &[Term],
    shape: &ShapeId,
    rule: &str,
    datatype: &str,
) -> Result<(), ValidationError> {
    if values.iter().all(
        |value| matches!(value, Term::Literal(literal) if literal.datatype().as_str() == datatype),
    ) {
        Ok(())
    } else {
        Err(syntax(
            rule,
            shape,
            &format!("values must be <{datatype}> literals"),
        ))
    }
}
