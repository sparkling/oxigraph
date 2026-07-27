use super::rdf::{RdfView, as_literal, as_named, as_usize, sh, to_shape_id};
use crate::constraint::{Constraint, NodeKind, QualifiedValueShape, literal_bool};
use crate::control::{Budget, ValidationError};
use crate::model::ShapeId;
use oxrdf::Term;

pub(super) fn compile_constraints(
    view: &RdfView<'_>,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
) -> Result<Vec<Constraint>, ValidationError> {
    let limits = budget_limits(budget);
    let mut constraints = Vec::new();
    for term in view.objects(shape, &sh("class")) {
        if matches!(term, Term::BlankNode(_)) {
            let values = view
                .list(&term, budget, limits.max_list_items)?
                .into_iter()
                .map(|value| as_named(value, &sh("class")))
                .collect::<Result<Vec<_>, _>>()?;
            constraints.push(Constraint::Classes(values));
        } else {
            constraints.push(Constraint::Class(as_named(term, &sh("class"))?));
        }
    }
    for term in view.objects(shape, &sh("datatype")) {
        if matches!(term, Term::BlankNode(_)) {
            let values = view
                .list(&term, budget, limits.max_list_items)?
                .into_iter()
                .map(|value| as_named(value, &sh("datatype")))
                .collect::<Result<Vec<_>, _>>()?;
            constraints.push(Constraint::Datatypes(values));
        } else {
            constraints.push(Constraint::Datatype(as_named(term, &sh("datatype"))?));
        }
    }
    for term in view.objects(shape, &sh("nodeKind")) {
        if matches!(term, Term::BlankNode(_)) {
            let values = view
                .list(&term, budget, limits.max_list_items)?
                .into_iter()
                .map(parse_node_kind)
                .collect::<Result<Vec<_>, _>>()?;
            constraints.push(Constraint::NodeKinds(values));
        } else {
            constraints.push(Constraint::NodeKind(parse_node_kind(term)?));
        }
    }
    push_counts(view, shape, &mut constraints)?;
    let ranges: [(&str, fn(Term) -> Constraint); 4] = [
        ("minExclusive", Constraint::MinExclusive),
        ("minInclusive", Constraint::MinInclusive),
        ("maxExclusive", Constraint::MaxExclusive),
        ("maxInclusive", Constraint::MaxInclusive),
    ];
    for (local, constructor) in ranges {
        for term in view.objects(shape, &sh(local)) {
            constraints.push(constructor(term));
        }
    }
    let lengths: [(&str, fn(usize) -> Constraint); 4] = [
        ("minLength", Constraint::MinLength),
        ("maxLength", Constraint::MaxLength),
        ("minListLength", Constraint::MinListLength),
        ("maxListLength", Constraint::MaxListLength),
    ];
    for (local, constructor) in lengths {
        for term in view.objects(shape, &sh(local)) {
            constraints.push(constructor(as_usize(term, &sh(local))?));
        }
    }
    compile_strings(view, shape, budget, &mut constraints)?;
    compile_lists(view, shape, budget, &mut constraints)?;
    compile_pairs(view, shape, budget, &mut constraints)?;
    compile_shapes(view, shape, budget, &mut constraints)?;
    compile_misc(view, shape, budget, &mut constraints)?;
    #[cfg(feature = "sparql")]
    constraints.extend(super::custom::compile_custom_constraints(
        view, shape, budget,
    )?);
    if constraints.len() > limits.max_constraints {
        return Err(ValidationError::LimitExceeded {
            kind: crate::LimitKind::Constraints,
            limit: limits.max_constraints,
        });
    }
    Ok(constraints)
}

fn push_counts(
    view: &RdfView<'_>,
    shape: &ShapeId,
    constraints: &mut Vec<Constraint>,
) -> Result<(), ValidationError> {
    for term in view.objects(shape, &sh("minCount")) {
        constraints.push(Constraint::MinCount(as_usize(term, &sh("minCount"))?));
    }
    for term in view.objects(shape, &sh("maxCount")) {
        constraints.push(Constraint::MaxCount(as_usize(term, &sh("maxCount"))?));
    }
    Ok(())
}

fn compile_strings(
    view: &RdfView<'_>,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
    constraints: &mut Vec<Constraint>,
) -> Result<(), ValidationError> {
    let flags = view
        .optional_one(shape, &sh("flags"))?
        .map(|term| as_literal(term, &sh("flags")))
        .transpose()?
        .map(|literal| literal.value().to_owned())
        .unwrap_or_default();
    for term in view.objects(shape, &sh("pattern")) {
        constraints.push(Constraint::Pattern {
            pattern: as_literal(term, &sh("pattern"))?.value().to_owned(),
            flags: flags.clone(),
        });
    }
    for term in view.objects(shape, &sh("singleLine")) {
        let literal = as_literal(term, &sh("singleLine"))?;
        constraints.push(Constraint::SingleLine(literal_bool(&literal).ok_or_else(
            || ValidationError::IllFormed("sh:singleLine must be boolean".to_owned()),
        )?));
    }
    for term in view.objects(shape, &sh("languageIn")) {
        let values = view
            .list(&term, budget, budget_limits(budget).max_list_items)?
            .into_iter()
            .map(|term| {
                as_literal(term, &sh("languageIn")).map(|literal| literal.value().to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        constraints.push(Constraint::LanguageIn(values));
    }
    for term in view.objects(shape, &sh("uniqueLang")) {
        let literal = as_literal(term, &sh("uniqueLang"))?;
        if literal.datatype().as_str() != "http://www.w3.org/2001/XMLSchema#boolean" {
            return Err(ValidationError::IllFormed(
                "sh:uniqueLang must be boolean".to_owned(),
            ));
        }
        // SHACL activates this component only when the parameter term is the
        // literal `"true"^^xsd:boolean`; the approved uniqueLang-002 case
        // deliberately verifies that the alternate lexical form `"1"` is
        // ignored.
        constraints.push(Constraint::UniqueLang(literal.value() == "true"));
    }
    Ok(())
}

fn compile_lists(
    view: &RdfView<'_>,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
    constraints: &mut Vec<Constraint>,
) -> Result<(), ValidationError> {
    let booleans: [(&str, fn(bool) -> Constraint); 1] =
        [("uniqueMembers", Constraint::UniqueMembers)];
    for (local, constructor) in booleans {
        for term in view.objects(shape, &sh(local)) {
            let literal = as_literal(term, &sh(local))?;
            constraints.push(constructor(literal_bool(&literal).ok_or_else(|| {
                ValidationError::IllFormed(format!("sh:{local} must be boolean"))
            })?));
        }
    }
    for term in view.objects(shape, &sh("memberShape")) {
        constraints.push(Constraint::MemberShape(shape_id(&term, "memberShape")?));
    }
    for term in view.objects(shape, &sh("in")) {
        constraints.push(Constraint::In(view.list(
            &term,
            budget,
            budget_limits(budget).max_list_items,
        )?));
    }
    Ok(())
}

fn compile_pairs(
    view: &RdfView<'_>,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
    constraints: &mut Vec<Constraint>,
) -> Result<(), ValidationError> {
    let limits = budget_limits(budget);
    let pairs: [(&str, fn(crate::PropertyPath) -> Constraint); 5] = [
        ("equals", Constraint::Equals),
        ("disjoint", Constraint::Disjoint),
        ("subsetOf", Constraint::SubsetOf),
        ("lessThan", Constraint::LessThan),
        ("lessThanOrEquals", Constraint::LessThanOrEquals),
    ];
    for (local, constructor) in pairs {
        for term in view.objects(shape, &sh(local)) {
            let path = view.path(
                &term,
                budget,
                0,
                limits.max_recursion_depth,
                limits.max_list_items,
            )?;
            constraints.push(constructor(path));
        }
    }
    for term in view.objects(shape, &sh("uniqueValuesFor")) {
        let properties = match term {
            Term::NamedNode(property) => vec![property],
            list_head => view
                .list(&list_head, budget, limits.max_list_items)?
                .into_iter()
                .map(|term| as_named(term, &sh("uniqueValuesFor")))
                .collect::<Result<Vec<_>, _>>()?,
        };
        constraints.push(Constraint::UniqueValuesFor(properties));
    }
    Ok(())
}

fn compile_shapes(
    view: &RdfView<'_>,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
    constraints: &mut Vec<Constraint>,
) -> Result<(), ValidationError> {
    let references: [(&str, fn(ShapeId) -> Constraint); 4] = [
        ("not", Constraint::Not),
        ("node", Constraint::Node),
        ("property", Constraint::Property),
        ("someValue", Constraint::SomeValue),
    ];
    for (local, constructor) in references {
        for term in view.objects(shape, &sh(local)) {
            constraints.push(constructor(shape_id(&term, local)?));
        }
    }
    let logical: [(&str, fn(Vec<ShapeId>) -> Constraint); 3] = [
        ("and", Constraint::And),
        ("or", Constraint::Or),
        ("xone", Constraint::Xone),
    ];
    for (local, constructor) in logical {
        for term in view.objects(shape, &sh(local)) {
            let shapes = view
                .list(&term, budget, budget_limits(budget).max_list_items)?
                .into_iter()
                .map(|term| shape_id(&term, local))
                .collect::<Result<Vec<_>, _>>()?;
            constraints.push(constructor(shapes));
        }
    }
    let qualified = view.objects(shape, &sh("qualifiedValueShape"));
    if qualified.len() > 1 {
        return Err(ValidationError::IllFormed(
            "sh:qualifiedValueShape must have at most one value".to_owned(),
        ));
    }
    if let Some(term) = qualified.into_iter().next() {
        let min_count = optional_usize(view, shape, "qualifiedMinCount")?;
        let max_count = optional_usize(view, shape, "qualifiedMaxCount")?;
        let disjoint = optional_bool(view, shape, "qualifiedValueShapesDisjoint")?.unwrap_or(false);
        constraints.push(Constraint::Qualified(QualifiedValueShape {
            shape: shape_id(&term, "qualifiedValueShape")?,
            min_count,
            max_count,
            disjoint,
        }));
    }
    Ok(())
}

fn compile_misc(
    view: &RdfView<'_>,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
    constraints: &mut Vec<Constraint>,
) -> Result<(), ValidationError> {
    let closed = view.optional_one(shape, &sh("closed"))?;
    let closed_mode = closed
        .map(|term| match term {
            Term::NamedNode(node) if node.as_str() == "http://www.w3.org/ns/shacl#ByTypes" => {
                Ok(Some(true))
            }
            Term::Literal(literal) => literal_bool(&literal)
                .map(|enabled| enabled.then_some(false))
                .ok_or_else(|| {
                    ValidationError::IllFormed("sh:closed must be boolean or sh:ByTypes".to_owned())
                }),
            _ => Err(ValidationError::IllFormed(
                "sh:closed must be boolean or sh:ByTypes".to_owned(),
            )),
        })
        .transpose()?
        .flatten();
    if let Some(by_types) = closed_mode {
        let ignored_properties = match view.optional_one(shape, &sh("ignoredProperties"))? {
            Some(head) => view
                .list(&head, budget, budget_limits(budget).max_list_items)?
                .into_iter()
                .map(|term| as_named(term, &sh("ignoredProperties")))
                .collect::<Result<Vec<_>, _>>()?,
            None => Vec::new(),
        };
        constraints.push(Constraint::Closed {
            ignored_properties,
            by_types,
        });
    }
    let reification_required = optional_bool(view, shape, "reificationRequired")?.unwrap_or(false);
    for term in view.objects(shape, &sh("reifierShape")) {
        constraints.push(Constraint::ReifierShape {
            shape: shape_id(&term, "reifierShape")?,
            required: reification_required,
        });
    }
    for term in view.objects(shape, &sh("hasValue")) {
        constraints.push(Constraint::HasValue(term));
    }
    for term in view.objects(shape, &sh("rootClass")) {
        if matches!(term, Term::BlankNode(_)) {
            let values = view
                .list(&term, budget, budget_limits(budget).max_list_items)?
                .into_iter()
                .map(|value| as_named(value, &sh("rootClass")))
                .collect::<Result<Vec<_>, _>>()?;
            constraints.push(Constraint::RootClasses(values));
        } else {
            constraints.push(Constraint::RootClass(as_named(term, &sh("rootClass"))?));
        }
    }
    for term in view.objects(shape, &sh("expression")) {
        constraints.push(Constraint::Expression(view.expression(
            &term,
            budget,
            0,
            budget_limits(budget).max_recursion_depth,
            budget_limits(budget).max_list_items,
        )?));
    }
    for term in view.objects(shape, &sh("nodeByExpression")) {
        constraints.push(Constraint::NodeByExpression(view.expression(
            &term,
            budget,
            0,
            budget_limits(budget).max_recursion_depth,
            budget_limits(budget).max_list_items,
        )?));
    }
    #[cfg(feature = "sparql")]
    for term in view.objects(shape, &sh("sparql")) {
        let node = shape_id(&term, "sparql")?;
        let deactivated = optional_bool(view, &node, "deactivated")?.unwrap_or(false);
        let select = as_literal(view.exactly_one(&node, &sh("select"))?, &sh("select"))?;
        super::syntax::require_xsd_string(&select, "sh:select")?;
        let select = view.apply_sparql_prefixes(&node, select.value())?;
        let select = bind_path(view, shape, select, budget)?;
        let messages = view
            .objects(&node, &sh("message"))
            .into_iter()
            .map(|term| as_literal(term, &sh("message")))
            .collect::<Result<Vec<_>, _>>()?;
        super::syntax::validate_messages(&messages)?;
        let severity = view
            .optional_one(&node, &sh("severity"))?
            .map(|term| as_named(term, &sh("severity")))
            .transpose()?;
        let mut constraint = crate::SparqlConstraint::new(select)?
            .with_messages(messages)
            .with_source(term)
            .with_result_annotations(super::result_annotations::compile(view, &node)?);
        if let Some(severity) = severity {
            constraint = constraint.with_severity(severity);
        }
        if !deactivated {
            constraints.push(Constraint::Sparql(constraint));
        }
    }
    #[cfg(not(feature = "sparql"))]
    if !view.objects(shape, &sh("sparql")).is_empty() {
        return Err(ValidationError::UnsupportedFeature(
            "SHACL-SPARQL support is disabled".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(feature = "sparql")]
fn bind_path(
    view: &RdfView<'_>,
    shape: &ShapeId,
    query: String,
    budget: &mut Budget<'_>,
) -> Result<String, ValidationError> {
    if !query.contains("$PATH") && !query.contains("?PATH") {
        return Ok(query);
    }
    let term = view.exactly_one(shape, &sh("path"))?;
    let limits = budget_limits(budget);
    let path = view.path(
        &term,
        budget,
        0,
        limits.max_recursion_depth,
        limits.max_list_items,
    )?;
    crate::sparql::substitute_path(&query, &path.to_sparql())
}

fn parse_node_kind(term: Term) -> Result<NodeKind, ValidationError> {
    let node = as_named(term, &sh("nodeKind"))?;
    match node.as_str().strip_prefix("http://www.w3.org/ns/shacl#") {
        Some("IRI") => Ok(NodeKind::Iri),
        Some("BlankNode") => Ok(NodeKind::BlankNode),
        Some("Literal") => Ok(NodeKind::Literal),
        Some("BlankNodeOrIRI") => Ok(NodeKind::BlankNodeOrIri),
        Some("BlankNodeOrLiteral") => Ok(NodeKind::BlankNodeOrLiteral),
        Some("IRIOrLiteral") => Ok(NodeKind::IriOrLiteral),
        Some("TripleTerm") => Ok(NodeKind::TripleTerm),
        _ => Err(ValidationError::IllFormed(format!(
            "`{node}` is not a supported SHACL node kind"
        ))),
    }
}

fn shape_id(term: &Term, local: &str) -> Result<ShapeId, ValidationError> {
    to_shape_id(term).ok_or_else(|| {
        ValidationError::IllFormed(format!("sh:{local} values must be IRIs or blank nodes"))
    })
}

fn optional_usize(
    view: &RdfView<'_>,
    shape: &ShapeId,
    local: &str,
) -> Result<Option<usize>, ValidationError> {
    view.optional_one(shape, &sh(local))?
        .map(|term| as_usize(term, &sh(local)))
        .transpose()
}

fn optional_bool(
    view: &RdfView<'_>,
    shape: &ShapeId,
    local: &str,
) -> Result<Option<bool>, ValidationError> {
    view.optional_one(shape, &sh(local))?
        .map(|term| {
            let literal = as_literal(term, &sh(local))?;
            literal_bool(&literal)
                .ok_or_else(|| ValidationError::IllFormed(format!("sh:{local} must be boolean")))
        })
        .transpose()
}

fn budget_limits(budget: &Budget<'_>) -> crate::ValidationLimits {
    budget.limits().clone()
}
