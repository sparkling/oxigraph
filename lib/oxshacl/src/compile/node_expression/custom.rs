use super::super::rdf::{RdfView, as_literal, as_named, sh, shnex, to_shape_id};
use super::syntax::{active_predicates, validate_properties};
use crate::constraint::literal_bool;
use crate::control::{Budget, ValidationError};
use crate::expression::CustomNodeExpressionKind;
use crate::path::term_key;
use crate::{NodeExpression, ShapeId};
use oxrdf::{Literal, NamedNode, NamedOrBlankNode, Term};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS: &str = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const NAMED_FUNCTION: &str = "http://www.w3.org/ns/shacl#NamedParameterExpressionFunction";
const NAMED_EXPRESSION: &str = "http://www.w3.org/ns/shacl#NamedParameterExpression";
const LIST_FUNCTION: &str = "http://www.w3.org/ns/shacl#ListParameterExpressionFunction";
const LIST_EXPRESSION: &str = "http://www.w3.org/ns/shacl#ListParameterExpression";
const SH: &str = "http://www.w3.org/ns/shacl#";
const SHNEX: &str = "http://www.w3.org/ns/shacl-node-expr#";
const SPARQL: &str = "http://www.w3.org/ns/sparql#";
const XSD_INTEGER: &str = "http://www.w3.org/2001/XMLSchema#integer";

#[derive(Clone, Debug)]
pub(super) struct Definition {
    pub function: NamedNode,
    pub kind: CustomNodeExpressionKind,
    pub body: Term,
    pub parameter_keys: Vec<NamedNode>,
    pub key_parameters: BTreeSet<String>,
}

impl Definition {
    pub(super) fn scope(&self) -> Scope {
        match self.kind {
            CustomNodeExpressionKind::NamedParameter => Scope::Named(
                self.parameter_keys
                    .iter()
                    .map(|key| term_key(&Term::from(key.clone())))
                    .collect(),
            ),
            CustomNodeExpressionKind::ListParameter => Scope::List,
        }
    }
}

#[derive(Clone, Debug)]
pub(super) enum Scope {
    Named(BTreeSet<String>),
    List,
}

#[derive(Clone, Debug)]
pub(super) enum Call {
    Named {
        definition: Definition,
        arguments: Vec<(Term, Term)>,
    },
    List {
        definition: Definition,
        object: Term,
    },
}

#[derive(Clone, Debug, Default)]
pub(super) struct Registry {
    definitions: BTreeMap<String, Definition>,
    named_by_key: BTreeMap<String, String>,
    list_by_predicate: BTreeMap<String, String>,
}

impl Registry {
    pub(super) fn new(
        view: &RdfView<'_>,
        budget: &mut Budget<'_>,
    ) -> Result<Self, ValidationError> {
        let subjects = view
            .graph()
            .triples()
            .filter_map(|triple| match triple.subject {
                NamedOrBlankNode::NamedNode(node) => Some(node),
                NamedOrBlankNode::BlankNode(_) => None,
            })
            .collect::<BTreeSet<_>>();
        let mut output = Self::default();
        for function in subjects {
            budget.check()?;
            let id = ShapeId::from(function.clone());
            let named = is_instance(view, &id, NAMED_FUNCTION);
            let list = is_instance(view, &id, LIST_FUNCTION);
            if !named && !list {
                continue;
            }
            if named && list {
                return Err(ValidationError::IllFormed(format!(
                    "custom node-expression function <{function}> is both named-parameter and list-parameter"
                )));
            }
            if reserved(function.as_str()) && view.objects(&id, &sh("bodyExpression")).is_empty() {
                continue;
            }
            if reserved(function.as_str()) {
                return Err(ValidationError::IllFormed(format!(
                    "custom node-expression function <{function}> uses a reserved namespace"
                )));
            }
            let definition = if named {
                named_definition(view, function)?
            } else {
                list_definition(view, function)?
            };
            output.insert(definition)?;
        }
        Ok(output)
    }

    pub(super) fn definitions(&self) -> impl Iterator<Item = &Definition> {
        self.definitions.values()
    }

    pub(super) fn call(
        &self,
        view: &RdfView<'_>,
        node: &ShapeId,
    ) -> Result<Option<Call>, ValidationError> {
        let predicates = active_predicates(view, node);
        let mut candidates = predicates
            .iter()
            .filter_map(|predicate| self.named_by_key.get(predicate))
            .chain(
                predicates
                    .iter()
                    .filter_map(|predicate| self.list_by_predicate.get(predicate)),
            )
            .cloned()
            .collect::<BTreeSet<_>>();
        let Some(function) = candidates.pop_first() else {
            return Ok(None);
        };
        if !candidates.is_empty() {
            return Err(ValidationError::IllFormed(format!(
                "custom node expression `{node}` selects multiple functions"
            )));
        }
        let definition = self.definitions[&function].clone();
        match definition.kind {
            CustomNodeExpressionKind::NamedParameter => {
                let allowed = definition
                    .parameter_keys
                    .iter()
                    .map(NamedNode::as_str)
                    .collect::<BTreeSet<_>>();
                for predicate in &predicates {
                    if !allowed.contains(predicate.as_str()) {
                        return Err(ValidationError::IllFormed(format!(
                            "custom named-parameter expression `{node}` has unexpected property <{predicate}>"
                        )));
                    }
                }
                let mut arguments = Vec::new();
                let mut has_key = false;
                for key in &definition.parameter_keys {
                    let values = view.objects(node, key.as_str());
                    if values.len() > 1 {
                        return Err(ValidationError::IllFormed(format!(
                            "custom named-parameter expression `{node}` has multiple <{key}> values"
                        )));
                    }
                    if let Some(value) = values.first() {
                        has_key |= definition.key_parameters.contains(key.as_str());
                        arguments.push((Term::from(key.clone()), value.clone()));
                    }
                }
                if !has_key {
                    return Err(ValidationError::IllFormed(format!(
                        "custom named-parameter expression `{node}` requires exactly one value for at least one key parameter"
                    )));
                }
                Ok(Some(Call::Named {
                    definition,
                    arguments,
                }))
            }
            CustomNodeExpressionKind::ListParameter => {
                validate_properties(
                    view,
                    node,
                    "custom list-parameter expression",
                    &[definition.function.as_str().to_owned()],
                    &[definition.function.as_str().to_owned()],
                )?;
                let object = view.exactly_one(node, definition.function.as_str())?;
                Ok(Some(Call::List { definition, object }))
            }
        }
    }

    fn insert(&mut self, definition: Definition) -> Result<(), ValidationError> {
        let function = definition.function.as_str().to_owned();
        match definition.kind {
            CustomNodeExpressionKind::NamedParameter => {
                for key in &definition.key_parameters {
                    reject_reserved_key(key, &definition.function)?;
                    if self.named_by_key.contains_key(key)
                        || self.list_by_predicate.contains_key(key)
                    {
                        return Err(ValidationError::IllFormed(format!(
                            "custom node-expression key parameter <{key}> is not disjoint"
                        )));
                    }
                    self.named_by_key.insert(key.clone(), function.clone());
                }
            }
            CustomNodeExpressionKind::ListParameter => {
                reject_reserved_key(&function, &definition.function)?;
                if self.named_by_key.contains_key(&function)
                    || self.list_by_predicate.contains_key(&function)
                {
                    return Err(ValidationError::IllFormed(format!(
                        "custom list-parameter property <{function}> is not disjoint"
                    )));
                }
                self.list_by_predicate
                    .insert(function.clone(), function.clone());
            }
        }
        self.definitions.insert(function, definition);
        Ok(())
    }
}

pub(super) fn argument(
    view: &RdfView<'_>,
    node: &ShapeId,
    scope: Option<&Scope>,
) -> Result<Option<NodeExpression>, ValidationError> {
    let Some(key) = view.optional_one(node, &shnex("arg"))? else {
        return Ok(None);
    };
    validate_properties(
        view,
        node,
        "shnex:arg expression",
        &[shnex("arg")],
        &[shnex("arg")],
    )?;
    if !matches!(&key, Term::NamedNode(_))
        && !matches!(
            &key,
            Term::Literal(literal) if literal.datatype().as_str() == XSD_INTEGER
        )
    {
        return Err(ValidationError::IllFormed(
            "shnex:arg must be an IRI or xsd:integer".to_owned(),
        ));
    }
    let Some(scope) = scope else {
        return Err(ValidationError::IllFormed(
            "shnex:arg is only well-formed inside a custom node-expression body".to_owned(),
        ));
    };
    match scope {
        Scope::Named(keys)
            if matches!(key, Term::NamedNode(_)) && keys.contains(&term_key(&key)) => {}
        Scope::List
            if matches!(
                &key,
                Term::Literal(literal) if literal.datatype().as_str() == XSD_INTEGER
            ) => {}
        Scope::Named(_) => {
            return Err(ValidationError::IllFormed(format!(
                "shnex:arg key {key} is not declared by the enclosing custom named-parameter function"
            )));
        }
        Scope::List => {
            return Err(ValidationError::IllFormed(
                "custom list-parameter function shnex:arg keys must be xsd:integer".to_owned(),
            ));
        }
    }
    Ok(Some(NodeExpression::Argument(key)))
}

fn named_definition(
    view: &RdfView<'_>,
    function: NamedNode,
) -> Result<Definition, ValidationError> {
    let id = ShapeId::from(function.clone());
    require_subclass(view, NAMED_EXPRESSION, &function)?;
    let body = view.exactly_one(&id, &sh("bodyExpression"))?;
    let parameters = view.objects(&id, &sh("parameter"));
    if parameters.is_empty() {
        return Err(ValidationError::IllFormed(format!(
            "custom named-parameter function <{function}> requires sh:parameter"
        )));
    }
    let mut parameter_keys = Vec::new();
    let mut key_parameters = BTreeSet::new();
    for parameter in parameters {
        let parameter = to_shape_id(&parameter).ok_or_else(|| {
            ValidationError::IllFormed(format!(
                "custom function <{function}> has a non-node sh:parameter"
            ))
        })?;
        let path = as_named(view.exactly_one(&parameter, &sh("path"))?, &sh("path"))?;
        if parameter_keys.contains(&path) {
            return Err(ValidationError::IllFormed(format!(
                "custom function <{function}> declares duplicate parameter path <{path}>"
            )));
        }
        let key_values = view.objects(&parameter, &sh("keyParameter"));
        if key_values.len() > 1 {
            return Err(ValidationError::IllFormed(format!(
                "parameter `{parameter}` has multiple sh:keyParameter values"
            )));
        }
        if let Some(value) = key_values.first() {
            let literal = as_literal(value.clone(), &sh("keyParameter"))?;
            let key = literal_bool(&literal).ok_or_else(|| {
                ValidationError::IllFormed("sh:keyParameter must be xsd:boolean".to_owned())
            })?;
            if key {
                key_parameters.insert(path.as_str().to_owned());
            }
        }
        parameter_keys.push(path);
    }
    if key_parameters.is_empty() {
        return Err(ValidationError::IllFormed(format!(
            "custom named-parameter function <{function}> requires a true sh:keyParameter"
        )));
    }
    Ok(Definition {
        function,
        kind: CustomNodeExpressionKind::NamedParameter,
        body,
        parameter_keys,
        key_parameters,
    })
}

fn list_definition(view: &RdfView<'_>, function: NamedNode) -> Result<Definition, ValidationError> {
    let id = ShapeId::from(function.clone());
    require_subclass(view, LIST_EXPRESSION, &function)?;
    let body = view.exactly_one(&id, &sh("bodyExpression"))?;
    Ok(Definition {
        function,
        kind: CustomNodeExpressionKind::ListParameter,
        body,
        parameter_keys: Vec::new(),
        key_parameters: BTreeSet::new(),
    })
}

fn require_subclass(
    view: &RdfView<'_>,
    target: &str,
    iri: &NamedNode,
) -> Result<(), ValidationError> {
    if class_reaches(view, iri, target) {
        Ok(())
    } else {
        Err(ValidationError::IllFormed(format!(
            "custom node-expression function <{iri}> is not a SHACL subclass of <{target}>"
        )))
    }
}

fn is_instance(view: &RdfView<'_>, subject: &ShapeId, class: &str) -> bool {
    view.objects(subject, RDF_TYPE)
        .iter()
        .any(|term| matches!(term, Term::NamedNode(actual) if class_reaches(view, actual, class)))
}

fn class_reaches(view: &RdfView<'_>, class: &NamedNode, target: &str) -> bool {
    let mut pending = vec![class.clone()];
    let mut seen = BTreeSet::new();
    while let Some(class) = pending.pop() {
        if class.as_str() == target {
            return true;
        }
        if !seen.insert(class.as_str().to_owned()) {
            continue;
        }
        pending.extend(
            view.objects(&ShapeId::from(class), RDFS_SUBCLASS)
                .into_iter()
                .filter_map(|term| match term {
                    Term::NamedNode(parent) => Some(parent),
                    _ => None,
                }),
        );
    }
    false
}

fn reject_reserved_key(key: &str, function: &NamedNode) -> Result<(), ValidationError> {
    if reserved(key) {
        Err(ValidationError::IllFormed(format!(
            "custom node-expression function <{function}> uses reserved key <{key}>"
        )))
    } else {
        Ok(())
    }
}

fn reserved(iri: &str) -> bool {
    iri.starts_with(SH) || iri.starts_with(SHNEX) || iri.starts_with(SPARQL)
}

pub(super) fn list_index(index: usize) -> Result<Term, ValidationError> {
    let index = i64::try_from(index).map_err(|_| {
        ValidationError::IllFormed("custom list-parameter index exceeds xsd:integer".to_owned())
    })?;
    Ok(Term::Literal(Literal::from(index)))
}

impl RdfView<'_> {
    pub(in crate::compile) fn is_custom_expression_node(
        &self,
        term: &Term,
        budget: &mut Budget<'_>,
    ) -> Result<bool, ValidationError> {
        let Some(node) = to_shape_id(term) else {
            return Ok(false);
        };
        Registry::new(self, budget)?
            .call(self, &node)
            .map(|call| call.is_some())
    }

    pub(in crate::compile) fn validate_custom_node_expression_functions(
        &self,
        budget: &mut Budget<'_>,
        max_depth: usize,
        max_items: usize,
    ) -> Result<(), ValidationError> {
        let registry = Registry::new(self, budget)?;
        for definition in registry.definitions().cloned().collect::<Vec<_>>() {
            let function = definition.function.as_str().to_owned();
            let active_functions = RefCell::new(BTreeSet::from([function.clone()]));
            let scope = definition.scope();
            let result = self.expression_scoped(
                &definition.body,
                budget,
                1,
                max_depth,
                max_items,
                &registry,
                Some(&scope),
                &active_functions,
            );
            if let Err(error) = result {
                return Err(ValidationError::IllFormed(format!(
                    "custom node-expression function <{function}> has an invalid sh:bodyExpression: {error}"
                )));
            }
        }
        Ok(())
    }
}
