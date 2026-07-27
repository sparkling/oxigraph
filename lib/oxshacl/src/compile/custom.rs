use super::rdf::{RdfView, as_literal, as_named, sh, to_shape_id};
use crate::constraint::{Constraint, literal_bool};
use crate::control::{Budget, ValidationError, ValidationOptions};
use crate::model::ShapeId;
use crate::{ShapesGraph, Validator};
use oxrdf::{Literal, NamedNode, Term, Variable};
use std::collections::BTreeSet;

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const COMPONENT: &str = "http://www.w3.org/ns/shacl#ConstraintComponent";
const ASK_VALIDATOR: &str = "http://www.w3.org/ns/shacl#SPARQLAskValidator";
const SELECT_VALIDATOR: &str = "http://www.w3.org/ns/shacl#SPARQLSelectValidator";
const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";
const RDF_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
const RDF_DIR_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";

#[derive(Debug)]
struct Parameter {
    shape: ShapeId,
    variable: String,
    predicate: NamedNode,
    optional: bool,
}

pub(super) fn validate_parameter_shapes(
    shapes: &ShapesGraph,
    options: &ValidationOptions,
) -> Result<(), ValidationError> {
    let view = RdfView::new(shapes.source());
    let validator = Validator::new(shapes, options);
    for component in component_nodes(&view) {
        component_iri(&component)?;
        let parameters = parameters(&view, &component)?;
        validate_component_syntax(&view, &component, &parameters)?;
        for owner in shapes.shapes() {
            if parameter_bindings(&view, &owner.id, &parameters).is_none() {
                continue;
            }
            let focus = Term::from(owner.id.clone());
            for parameter in &parameters {
                if !validator.conforms_node(shapes.source(), &parameter.shape, &focus)? {
                    return Err(ValidationError::IllFormed(format!(
                        "constraint `{}` does not conform to parameter shape `{}` of component `{component}`",
                        owner.id, parameter.shape
                    )));
                }
            }
        }
    }
    Ok(())
}

fn validate_component_syntax(
    view: &RdfView<'_>,
    component: &ShapeId,
    parameters: &[Parameter],
) -> Result<(), ValidationError> {
    for value in view.objects(component, &sh("labelTemplate")) {
        let literal = as_literal(value, &sh("labelTemplate"))?;
        if !matches!(
            literal.datatype().as_str(),
            XSD_STRING | RDF_LANG_STRING | RDF_DIR_LANG_STRING
        ) {
            return Err(ValidationError::IllFormed(
                "sh:labelTemplate values must be strings".to_owned(),
            ));
        }
    }
    for (property, ask) in [
        ("nodeValidator", false),
        ("propertyValidator", false),
        ("validator", true),
    ] {
        for term in view.objects(component, &sh(property)) {
            let validator = to_shape_id(&term).ok_or_else(|| {
                ValidationError::IllFormed(format!(
                    "sh:{property} must reference an IRI or blank node"
                ))
            })?;
            let expected_class = if ask { ASK_VALIDATOR } else { SELECT_VALIDATOR };
            if !is_instance_of(view, &validator, expected_class) {
                return Err(ValidationError::IllFormed(format!(
                    "sh:{property} must reference a {} validator",
                    if ask { "SPARQL ASK" } else { "SPARQL SELECT" }
                )));
            }
            validate_validator(view, &validator, parameters, ask)?;
        }
    }
    Ok(())
}

fn validate_validator(
    view: &RdfView<'_>,
    validator: &ShapeId,
    parameters: &[Parameter],
    ask: bool,
) -> Result<(), ValidationError> {
    let predicate = if ask { sh("ask") } else { sh("select") };
    let query = as_literal(view.exactly_one(validator, &predicate)?, &predicate)?;
    super::syntax::require_xsd_string(&query, if ask { "sh:ask" } else { "sh:select" })?;
    let query = view.apply_sparql_prefixes(validator, query.value())?;
    let mut prebound = vec!["this"];
    if ask {
        prebound.push("value");
    }
    prebound.extend(
        parameters
            .iter()
            .map(|parameter| parameter.variable.as_str()),
    );
    crate::sparql::validate_custom_query(&query, ask, &prebound)?;
    validator_messages(view, validator, validator)?;
    super::result_annotations::compile(view, validator)?;
    Ok(())
}

pub(super) fn compile_custom_constraints(
    view: &RdfView<'_>,
    shape: &ShapeId,
    budget: &mut Budget<'_>,
) -> Result<Vec<Constraint>, ValidationError> {
    let mut output = Vec::new();
    for component in component_nodes(view) {
        budget.check()?;
        let component_name = component_iri(&component)?;
        if component_name
            .as_str()
            .starts_with("http://www.w3.org/ns/shacl#")
        {
            continue;
        }
        let parameters = parameters(view, &component)?;
        let Some(bindings) = parameter_bindings(view, shape, &parameters) else {
            continue;
        };
        let Some(validator) = validators(view, &component, shape)?.into_iter().next() else {
            continue;
        };
        let ask = is_instance_of(view, &validator, ASK_VALIDATOR);
        let select = is_instance_of(view, &validator, SELECT_VALIDATOR);
        if ask == select {
            return Err(ValidationError::IllFormed(
                "custom SPARQL validator must be exactly one of ASK or SELECT".to_owned(),
            ));
        }
        let predicate = if ask { sh("ask") } else { sh("select") };
        let query = as_literal(view.exactly_one(&validator, &predicate)?, &predicate)?;
        super::syntax::require_xsd_string(&query, if ask { "sh:ask" } else { "sh:select" })?;
        let query = view.apply_sparql_prefixes(&validator, query.value())?;
        let query = bind_path(view, shape, query, budget)?;
        let messages = validator_messages(view, &validator, &component)?;
        let annotations = super::result_annotations::compile(view, &validator)?;
        for binding in binding_products(&bindings) {
            output.push(Constraint::Sparql(crate::SparqlConstraint::new_custom(
                query.clone(),
                ask,
                binding,
                component_name.clone(),
                messages.clone(),
                annotations.clone(),
            )?));
        }
    }
    Ok(output)
}

fn component_iri(component: &ShapeId) -> Result<NamedNode, ValidationError> {
    match component {
        ShapeId::NamedNode(component) => Ok(component.clone()),
        ShapeId::BlankNode(_) => Err(ValidationError::IllFormed(
            "a SHACL constraint component must be an IRI".to_owned(),
        )),
    }
}

fn validator_messages(
    view: &RdfView<'_>,
    validator: &ShapeId,
    component: &ShapeId,
) -> Result<Vec<Literal>, ValidationError> {
    let mut messages = view.objects(validator, &sh("message"));
    if messages.is_empty() {
        messages = view.objects(component, &sh("message"));
    }
    let messages = messages
        .into_iter()
        .map(|term| as_literal(term, &sh("message")))
        .collect::<Result<Vec<_>, _>>()?;
    super::syntax::validate_messages(&messages)?;
    Ok(messages)
}

fn component_nodes(view: &RdfView<'_>) -> Vec<ShapeId> {
    let mut output = BTreeSet::new();
    for triple in view.graph().triples() {
        if triple.predicate.as_str() == RDF_TYPE
            && let Term::NamedNode(class) = triple.object
            && class_reaches(view, &class, COMPONENT)
        {
            output.insert(triple.subject.to_string());
        }
    }
    output
        .into_iter()
        .filter_map(|key| {
            view.graph()
                .triples()
                .find(|triple| triple.subject.to_string() == key)
                .map(|triple| triple.subject)
        })
        .collect()
}

fn parameters(view: &RdfView<'_>, component: &ShapeId) -> Result<Vec<Parameter>, ValidationError> {
    let parameters = view
        .objects(component, &sh("parameter"))
        .into_iter()
        .map(|term| {
            let parameter = to_shape_id(&term).ok_or_else(|| {
                ValidationError::IllFormed(
                    "sh:parameter values must be IRIs or blank nodes".to_owned(),
                )
            })?;
            let predicate = as_named(view.exactly_one(&parameter, &sh("path"))?, &sh("path"))?;
            let variable = parameter_name(predicate.as_str())?.to_owned();
            Variable::new(variable.clone()).map_err(|_| {
                ValidationError::IllFormed(format!(
                    "custom parameter `{variable}` is not a SPARQL VARNAME"
                ))
            })?;
            if matches!(variable.as_str(), "this" | "path" | "PATH" | "value") {
                return Err(ValidationError::IllFormed(format!(
                    "`{variable}` is a reserved SHACL-SPARQL parameter name"
                )));
            }
            let optional = view
                .optional_one(&parameter, &sh("optional"))?
                .map(|term| {
                    let literal = as_literal(term, &sh("optional"))?;
                    literal_bool(&literal).ok_or_else(|| {
                        ValidationError::IllFormed("sh:optional must be an xsd:boolean".to_owned())
                    })
                })
                .transpose()?
                .unwrap_or(false);
            Ok(Parameter {
                shape: parameter,
                variable,
                predicate,
                optional,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !parameters.iter().any(|parameter| !parameter.optional) {
        return Err(ValidationError::IllFormed(
            "custom constraint components require a non-optional parameter".to_owned(),
        ));
    }
    let mut names = BTreeSet::new();
    for parameter in &parameters {
        if !names.insert(parameter.variable.clone()) {
            return Err(ValidationError::IllFormed(format!(
                "duplicate custom parameter name `{}`",
                parameter.variable
            )));
        }
    }
    Ok(parameters)
}

pub(super) fn parameter_name(iri: &str) -> Result<&str, ValidationError> {
    let scheme_colon = iri.find(':');
    for (start, _) in iri.char_indices() {
        if scheme_colon.is_some_and(|colon| start == colon.saturating_add(1)) {
            continue;
        }
        let candidate = &iri[start..];
        if valid_ncname(candidate) {
            return Ok(candidate);
        }
    }
    Err(ValidationError::IllFormed(
        "custom parameter path has no XML NCName local name".to_owned(),
    ))
}

fn valid_ncname(value: &str) -> bool {
    let mut characters = value.chars();
    characters.next().is_some_and(ncname_start) && characters.all(ncname_character)
}

fn ncname_start(character: char) -> bool {
    matches!(
        character,
        '_'
            | 'A'..='Z'
            | 'a'..='z'
            | '\u{00C0}'..='\u{00D6}'
            | '\u{00D8}'..='\u{00F6}'
            | '\u{00F8}'..='\u{02FF}'
            | '\u{0370}'..='\u{037D}'
            | '\u{037F}'..='\u{1FFF}'
            | '\u{200C}'..='\u{200D}'
            | '\u{2070}'..='\u{218F}'
            | '\u{2C00}'..='\u{2FEF}'
            | '\u{3001}'..='\u{D7FF}'
            | '\u{F900}'..='\u{FDCF}'
            | '\u{FDF0}'..='\u{FFFD}'
            | '\u{10000}'..='\u{EFFFF}'
    )
}

fn ncname_character(character: char) -> bool {
    ncname_start(character)
        || matches!(
            character,
            '-' | '.' | '0'..='9' | '\u{00B7}' | '\u{0300}'..='\u{036F}' | '\u{203F}'..='\u{2040}'
        )
}

fn parameter_bindings(
    view: &RdfView<'_>,
    shape: &ShapeId,
    parameters: &[Parameter],
) -> Option<Vec<(String, Vec<Option<Term>>)>> {
    let mut output = Vec::new();
    for parameter in parameters {
        let values = view.objects(shape, parameter.predicate.as_str());
        if values.is_empty() && !parameter.optional {
            return None;
        }
        let values = if values.is_empty() {
            vec![None]
        } else {
            values.into_iter().map(Some).collect()
        };
        output.push((parameter.variable.clone(), values));
    }
    Some(output)
}

fn binding_products(bindings: &[(String, Vec<Option<Term>>)]) -> Vec<Vec<(String, Option<Term>)>> {
    let mut products = vec![Vec::new()];
    for (name, values) in bindings {
        let mut next = Vec::new();
        for product in products {
            for value in values {
                let mut product = product.clone();
                product.push((name.clone(), value.clone()));
                next.push(product);
            }
        }
        products = next;
    }
    products
}

fn validators(
    view: &RdfView<'_>,
    component: &ShapeId,
    shape: &ShapeId,
) -> Result<Vec<ShapeId>, ValidationError> {
    let property = !view.objects(shape, &sh("path")).is_empty();
    let specialized = if property {
        "propertyValidator"
    } else {
        "nodeValidator"
    };
    let terms = view.objects(component, &sh(specialized));
    let terms = if terms.is_empty() {
        view.objects(component, &sh("validator"))
    } else {
        terms
    };
    terms
        .into_iter()
        .map(|term| {
            to_shape_id(&term).ok_or_else(|| {
                ValidationError::IllFormed(
                    "custom validator must be an IRI or blank node".to_owned(),
                )
            })
        })
        .collect()
}

fn is_instance_of(view: &RdfView<'_>, subject: &ShapeId, target: &str) -> bool {
    view.objects(subject, RDF_TYPE)
        .iter()
        .any(|term| matches!(term, Term::NamedNode(class) if class_reaches(view, class, target)))
}

fn class_reaches(view: &RdfView<'_>, class: &NamedNode, target: &str) -> bool {
    let mut active = vec![class.clone()];
    let mut seen = BTreeSet::new();
    while let Some(class) = active.pop() {
        if class.as_str() == target {
            return true;
        }
        if !seen.insert(class.as_str().to_owned()) {
            continue;
        }
        for triple in view.graph().triples() {
            if triple.predicate.as_str() == RDFS_SUBCLASS
                && triple.subject.to_string() == class.to_string()
                && let Term::NamedNode(parent) = triple.object
            {
                active.push(parent);
            }
        }
    }
    false
}

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
    let limits = budget.limits().clone();
    let path = view.path(
        &term,
        budget,
        0,
        limits.max_recursion_depth,
        limits.max_list_items,
    )?;
    crate::sparql::substitute_path(&query, &path.to_sparql())
}

#[cfg(test)]
mod tests;
