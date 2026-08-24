use crate::PropertyPath;
use crate::control::{Budget, LimitKind, ValidationError};
use crate::model::{ConstraintAnnotation, GraphSnapshot, ShapeId};
use oxrdf::{Literal, NamedNode, Term};
use std::collections::BTreeSet;

pub(super) struct RdfView<'a> {
    graph: &'a GraphSnapshot,
}

impl<'a> RdfView<'a> {
    pub(super) fn new(graph: &'a GraphSnapshot) -> Self {
        Self { graph }
    }

    pub(super) fn graph(&self) -> &GraphSnapshot {
        self.graph
    }

    pub(super) fn objects(&self, subject: &ShapeId, predicate: &str) -> Vec<Term> {
        let subject = subject.to_string();
        self.graph
            .triples()
            .filter(|triple| {
                triple.subject.to_string() == subject
                    && triple.predicate.as_str() == predicate
                    && !self.statement_deactivated(triple)
            })
            .map(|triple| triple.object)
            .collect()
    }

    #[cfg_attr(
        not(feature = "rdf-12"),
        expect(
            unused_variables,
            clippy::unused_self,
            reason = "RDF 1.1 keeps the same feature-independent compiler interface"
        )
    )]
    fn statement_deactivated(&self, statement: &oxrdf::Triple) -> bool {
        #[cfg(feature = "rdf-12")]
        {
            let reifiers = self
                .graph
                .triples()
                .filter(|triple| {
                    triple.predicate.as_str()
                        == "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies"
                        && matches!(
                            &triple.object,
                            Term::Triple(value) if value.as_ref() == statement
                        )
                })
                .map(|triple| triple.subject.to_string())
                .collect::<BTreeSet<_>>();
            if reifiers.is_empty() {
                return false;
            }
            return self.graph.triples().any(|triple| {
                reifiers.contains(&triple.subject.to_string())
                    && triple.predicate.as_str() == "http://www.w3.org/ns/shacl#deactivated"
                    && matches!(
                        triple.object,
                        Term::Literal(literal) if literal.value() == "true"
                    )
            });
        }
        #[cfg(not(feature = "rdf-12"))]
        {
            false
        }
    }

    #[cfg_attr(
        not(feature = "rdf-12"),
        expect(
            unused_variables,
            clippy::unused_self,
            clippy::unnecessary_wraps,
            reason = "the feature-independent compiler uses one typed annotation interface"
        )
    )]
    pub(super) fn statement_annotation(
        &self,
        subject: &ShapeId,
        predicate: &str,
        occurrence: usize,
    ) -> Result<ConstraintAnnotation, ValidationError> {
        #[cfg(feature = "rdf-12")]
        {
            let subject = subject.to_string();
            let statement = self
                .graph
                .triples()
                .filter(|triple| {
                    triple.subject.to_string() == subject
                        && triple.predicate.as_str() == predicate
                        && !self.statement_deactivated(triple)
                })
                .nth(occurrence);
            let Some(statement) = statement else {
                return Ok(ConstraintAnnotation::default());
            };
            let reifiers = self
                .graph
                .triples()
                .filter(|triple| {
                    triple.predicate.as_str()
                        == "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies"
                        && matches!(
                            &triple.object,
                            Term::Triple(value) if value.as_ref() == &statement
                        )
                })
                .map(|triple| triple.subject.to_string())
                .collect::<BTreeSet<_>>();
            let mut severity = Vec::new();
            let mut messages = Vec::new();
            for triple in self
                .graph
                .triples()
                .filter(|triple| reifiers.contains(&triple.subject.to_string()))
            {
                match triple.predicate.as_str() {
                    "http://www.w3.org/ns/shacl#severity" => {
                        severity.push(as_named(triple.object, &sh("severity"))?);
                    }
                    "http://www.w3.org/ns/shacl#message" => {
                        messages.push(as_literal(triple.object, &sh("message"))?);
                    }
                    _ => {}
                }
            }
            if severity.len() > 1 {
                return Err(ValidationError::IllFormed(
                    "a constraint statement annotation has multiple sh:severity values".to_owned(),
                ));
            }
            Ok(ConstraintAnnotation {
                severity: severity.pop(),
                messages,
            })
        }
        #[cfg(not(feature = "rdf-12"))]
        {
            Ok(ConstraintAnnotation::default())
        }
    }

    pub(super) fn exactly_one(
        &self,
        subject: &ShapeId,
        predicate: &str,
    ) -> Result<Term, ValidationError> {
        let values = self.objects(subject, predicate);
        match values.as_slice() {
            [value] => Ok(value.clone()),
            _ => Err(ValidationError::IllFormed(format!(
                "`{subject}` must have exactly one <{predicate}> value"
            ))),
        }
    }

    pub(super) fn optional_one(
        &self,
        subject: &ShapeId,
        predicate: &str,
    ) -> Result<Option<Term>, ValidationError> {
        let values = self.objects(subject, predicate);
        match values.as_slice() {
            [] => Ok(None),
            [value] => Ok(Some(value.clone())),
            _ => Err(ValidationError::IllFormed(format!(
                "`{subject}` must have at most one <{predicate}> value"
            ))),
        }
    }

    pub(super) fn has_type(&self, subject: &ShapeId, object: &str) -> bool {
        self.objects(subject, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
            .iter()
            .any(|term| matches!(term, Term::NamedNode(node) if node.as_str() == object))
    }

    pub(super) fn is_list_node(&self, term: &Term) -> bool {
        if matches!(term, Term::NamedNode(node) if node.as_str() == rdf("nil")) {
            return true;
        }
        let Some(node) = to_shape_id(term) else {
            return false;
        };
        !self.objects(&node, rdf("first")).is_empty()
            || !self.objects(&node, rdf("rest")).is_empty()
    }

    pub(super) fn is_expression_node(&self, term: &Term) -> bool {
        let Some(subject) = to_shape_id(term) else {
            return false;
        };
        let key = subject.to_string();
        self.graph.triples().any(|triple| {
            triple.subject.to_string() == key
                && (triple
                    .predicate
                    .as_str()
                    .starts_with("http://www.w3.org/ns/shacl-node-expr#")
                    || triple
                        .predicate
                        .as_str()
                        .starts_with("http://www.w3.org/ns/sparql#")
                    || matches!(
                        triple.predicate.as_str(),
                        "http://www.w3.org/1999/02/22-rdf-syntax-ns#first"
                            | "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest"
                    )
                    || matches!(
                        triple.predicate.as_str(),
                        "http://www.w3.org/ns/shacl#select"
                            | "http://www.w3.org/ns/shacl#sparqlExpr"
                    ))
        })
    }

    pub(super) fn shape_subjects(&self) -> BTreeSet<String> {
        let mut subjects = BTreeSet::new();
        for triple in self.graph.triples() {
            let predicate = triple.predicate.as_str();
            let is_shape_type = predicate == "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
                && matches!(
                    &triple.object,
                    Term::NamedNode(node)
                        if matches!(
                            node.as_str(),
                            "http://www.w3.org/ns/shacl#NodeShape"
                                | "http://www.w3.org/ns/shacl#PropertyShape"
                                | "http://www.w3.org/ns/shacl#ShapeClass"
                        )
                );
            if is_shape_type || is_shape_trigger(predicate) {
                subjects.insert(triple.subject.to_string());
            }
        }
        subjects
    }

    pub(super) fn find_subject(&self, key: &str) -> Option<ShapeId> {
        self.graph.triples().find_map(|triple| {
            if triple.subject.to_string() == key {
                return Some(triple.subject);
            }
            let node = to_shape_id(&triple.object)?;
            (node.to_string() == key).then_some(node)
        })
    }

    pub(super) fn list(
        &self,
        head: &Term,
        budget: &mut Budget<'_>,
        max_items: usize,
    ) -> Result<Vec<Term>, ValidationError> {
        let mut current = head.clone();
        let mut seen = BTreeSet::new();
        let mut output = Vec::new();
        loop {
            if matches!(&current, Term::NamedNode(node) if node.as_str() == rdf("nil")) {
                return Ok(output);
            }
            let node = to_shape_id(&current).ok_or_else(|| {
                ValidationError::IllFormed(
                    "SHACL list node must be an IRI or blank node".to_owned(),
                )
            })?;
            if !seen.insert(node.to_string()) {
                return Err(ValidationError::IllFormed("cyclic SHACL list".to_owned()));
            }
            if output.len() >= max_items {
                return Err(ValidationError::LimitExceeded {
                    kind: LimitKind::ListItems,
                    limit: max_items,
                });
            }
            output.push(self.exactly_one(&node, rdf("first"))?);
            current = self.exactly_one(&node, rdf("rest"))?;
            budget.check()?;
        }
    }

    pub(super) fn path(
        &self,
        term: &Term,
        budget: &mut Budget<'_>,
        depth: usize,
        max_depth: usize,
        max_items: usize,
    ) -> Result<PropertyPath, ValidationError> {
        if depth > max_depth {
            return Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: max_depth,
            });
        }
        if let Term::NamedNode(predicate) = term {
            return Ok(PropertyPath::Predicate(predicate.clone()));
        }
        let node = to_shape_id(term).ok_or_else(|| {
            ValidationError::IllFormed(
                "SHACL property path must be an IRI or blank node".to_owned(),
            )
        })?;
        let next = depth.saturating_add(1);
        let operators = [
            ("alternativePath", 0_u8),
            ("inversePath", 1),
            ("zeroOrMorePath", 2),
            ("oneOrMorePath", 3),
            ("zeroOrOnePath", 4),
        ]
        .into_iter()
        .filter_map(|(local, kind)| {
            self.optional_one(&node, &sh(local))
                .transpose()
                .map(|value| value.map(|value| (kind, value)))
        })
        .collect::<Result<Vec<_>, _>>()?;
        if operators.len() > 1 {
            return Err(ValidationError::IllFormed(format!(
                "path `{node}` has multiple path operators"
            )));
        }
        if let Some((kind, value)) = operators.into_iter().next() {
            if kind == 0 {
                let paths = self
                    .list(&value, budget, max_items)?
                    .iter()
                    .map(|term| self.path(term, budget, next, max_depth, max_items))
                    .collect::<Result<Vec<_>, _>>()?;
                return Ok(PropertyPath::Alternative(paths));
            }
            let path = Box::new(self.path(&value, budget, next, max_depth, max_items)?);
            return Ok(match kind {
                1 => PropertyPath::Inverse(path),
                2 => PropertyPath::ZeroOrMore(path),
                3 => PropertyPath::OneOrMore(path),
                4 => PropertyPath::ZeroOrOne(path),
                _ => unreachable!(),
            });
        }
        let paths = self
            .list(term, budget, max_items)?
            .iter()
            .map(|term| self.path(term, budget, next, max_depth, max_items))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(PropertyPath::Sequence(paths))
    }
}

pub(super) fn to_shape_id(term: &Term) -> Option<ShapeId> {
    #[allow(
        unreachable_patterns,
        reason = "dependency feature unification may expose RDF 1.2 triple terms"
    )]
    match term {
        Term::NamedNode(node) => Some(node.clone().into()),
        Term::BlankNode(node) => Some(node.clone().into()),
        Term::Literal(_) => None,
        _ => None,
    }
}

pub(super) fn as_named(term: Term, property: &str) -> Result<NamedNode, ValidationError> {
    if let Term::NamedNode(node) = term {
        Ok(node)
    } else {
        Err(ValidationError::IllFormed(format!(
            "<{property}> values must be IRIs"
        )))
    }
}

pub(super) fn as_literal(term: Term, property: &str) -> Result<Literal, ValidationError> {
    if let Term::Literal(literal) = term {
        Ok(literal)
    } else {
        Err(ValidationError::IllFormed(format!(
            "<{property}> values must be literals"
        )))
    }
}

pub(super) fn as_usize(term: Term, property: &str) -> Result<usize, ValidationError> {
    let literal = as_literal(term, property)?;
    literal.value().parse().map_err(|_| {
        ValidationError::IllFormed(format!("<{property}> must be a non-negative integer"))
    })
}

pub(super) fn sh(local: &str) -> String {
    format!("http://www.w3.org/ns/shacl#{local}")
}

pub(super) fn shnex(local: &str) -> String {
    format!("http://www.w3.org/ns/shacl-node-expr#{local}")
}

pub(super) fn rdf(local: &str) -> &'static str {
    match local {
        "type" => "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "first" => "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
        "rest" => "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
        "nil" => "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil",
        _ => unreachable!(),
    }
}

fn is_shape_trigger(predicate: &str) -> bool {
    let Some(local) = predicate.strip_prefix("http://www.w3.org/ns/shacl#") else {
        return false;
    };
    matches!(
        local,
        "path"
            | "targetNode"
            | "targetClass"
            | "targetSubjectsOf"
            | "targetObjectsOf"
            | "targetWhere"
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
    )
}
