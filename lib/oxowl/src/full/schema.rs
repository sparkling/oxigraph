#![expect(
    clippy::cloned_ref_to_slice_refs,
    clippy::multiple_inherent_impl,
    reason = "rule evidence is owned and the runtime is split by rule family"
)]

use super::{Owl2RlRdfError, Runtime, subject_term};
use crate::vocabulary::{
    ALL_VALUES_FROM, CLASS, DATATYPE_PROPERTY, EQUIVALENT_CLASS, EQUIVALENT_PROPERTY, HAS_VALUE,
    INTERSECTION_OF, NOTHING, OBJECT_PROPERTY, ON_PROPERTY, SOME_VALUES_FROM, THING, UNION_OF,
};
use oxrdf::{
    NamedNode, Quad, Term,
    vocab::{rdf, rdfs},
};

impl Runtime<'_> {
    pub(super) fn apply_schema(&mut self) -> Result<(), Owl2RlRdfError> {
        let quads = self.checked_collect(self.all.iter())?;
        self.schema_classes(&quads)?;
        self.schema_properties(&quads)?;
        self.schema_domains(&quads)?;
        self.schema_restrictions(&quads)?;
        self.schema_lists(&quads)
    }

    fn schema_classes(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            if declaration.predicate == rdf::TYPE && declaration.object == CLASS {
                let class = subject_term(declaration);
                for (subject, predicate, object) in [
                    (class.clone(), rdfs::SUB_CLASS_OF, class.clone()),
                    (class.clone(), EQUIVALENT_CLASS, class.clone()),
                    (class.clone(), rdfs::SUB_CLASS_OF, Term::from(THING)),
                    (Term::from(NOTHING), rdfs::SUB_CLASS_OF, class),
                ] {
                    if let Some(subject) = super::term_resource(&subject) {
                        self.insert(
                            Quad::new(subject, predicate, object, declaration.graph_name.clone()),
                            "scm-cls",
                            &[declaration.clone()],
                        )?;
                    }
                }
            }
            if declaration.predicate == EQUIVALENT_CLASS {
                for (subject, object) in [
                    (declaration.subject.clone(), declaration.object.clone()),
                    (
                        super::term_resource(&declaration.object)
                            .unwrap_or_else(|| declaration.subject.clone()),
                        subject_term(declaration),
                    ),
                ] {
                    self.insert(
                        Quad::new(
                            subject,
                            rdfs::SUB_CLASS_OF,
                            object,
                            declaration.graph_name.clone(),
                        ),
                        "scm-eqc1",
                        &[declaration.clone()],
                    )?;
                }
            }
        }
        for left in quads {
            self.check()?;
            for right in quads {
                self.check()?;
                if left.graph_name != right.graph_name {
                    continue;
                }
                if left.predicate == rdfs::SUB_CLASS_OF && right.predicate == rdfs::SUB_CLASS_OF {
                    if left.object == subject_term(right) {
                        self.insert(
                            Quad::new(
                                left.subject.clone(),
                                rdfs::SUB_CLASS_OF,
                                right.object.clone(),
                                left.graph_name.clone(),
                            ),
                            "scm-sco",
                            &[left.clone(), right.clone()],
                        )?;
                    }
                    if left.object == subject_term(right) && right.object == subject_term(left) {
                        self.insert(
                            Quad::new(
                                left.subject.clone(),
                                EQUIVALENT_CLASS,
                                left.object.clone(),
                                left.graph_name.clone(),
                            ),
                            "scm-eqc2",
                            &[left.clone(), right.clone()],
                        )?;
                    }
                }
            }
        }
        self.check()
    }

    fn schema_properties(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            if declaration.predicate == rdf::TYPE
                && (declaration.object == OBJECT_PROPERTY
                    || declaration.object == DATATYPE_PROPERTY)
            {
                for predicate in [rdfs::SUB_PROPERTY_OF, EQUIVALENT_PROPERTY] {
                    self.check()?;
                    self.insert(
                        Quad::new(
                            declaration.subject.clone(),
                            predicate,
                            subject_term(declaration),
                            declaration.graph_name.clone(),
                        ),
                        if declaration.object == OBJECT_PROPERTY {
                            "scm-op"
                        } else {
                            "scm-dp"
                        },
                        &[declaration.clone()],
                    )?;
                }
            }
            if declaration.predicate == EQUIVALENT_PROPERTY
                && let Some(other) = super::term_resource(&declaration.object)
            {
                for (subject, object) in [
                    (declaration.subject.clone(), declaration.object.clone()),
                    (other, subject_term(declaration)),
                ] {
                    self.insert(
                        Quad::new(
                            subject,
                            rdfs::SUB_PROPERTY_OF,
                            object,
                            declaration.graph_name.clone(),
                        ),
                        "scm-eqp1",
                        &[declaration.clone()],
                    )?;
                }
            }
        }
        for left in quads {
            self.check()?;
            for right in quads {
                self.check()?;
                if left.graph_name != right.graph_name
                    || left.predicate != rdfs::SUB_PROPERTY_OF
                    || right.predicate != rdfs::SUB_PROPERTY_OF
                {
                    continue;
                }
                if left.object == subject_term(right) {
                    self.insert(
                        Quad::new(
                            left.subject.clone(),
                            rdfs::SUB_PROPERTY_OF,
                            right.object.clone(),
                            left.graph_name.clone(),
                        ),
                        "scm-spo",
                        &[left.clone(), right.clone()],
                    )?;
                }
                if left.object == subject_term(right) && right.object == subject_term(left) {
                    self.insert(
                        Quad::new(
                            left.subject.clone(),
                            EQUIVALENT_PROPERTY,
                            left.object.clone(),
                            left.graph_name.clone(),
                        ),
                        "scm-eqp2",
                        &[left.clone(), right.clone()],
                    )?;
                }
            }
        }
        self.check()
    }

    fn schema_domains(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for schema in quads {
            self.check()?;
            if schema.predicate != rdfs::DOMAIN && schema.predicate != rdfs::RANGE {
                continue;
            }
            for relation in quads {
                self.check()?;
                if relation.graph_name != schema.graph_name {
                    continue;
                }
                if relation.predicate == rdfs::SUB_CLASS_OF
                    && schema.object == subject_term(relation)
                {
                    self.insert(
                        Quad::new(
                            schema.subject.clone(),
                            schema.predicate.clone(),
                            relation.object.clone(),
                            schema.graph_name.clone(),
                        ),
                        if schema.predicate == rdfs::DOMAIN {
                            "scm-dom1"
                        } else {
                            "scm-rng1"
                        },
                        &[schema.clone(), relation.clone()],
                    )?;
                }
                if relation.predicate == rdfs::SUB_PROPERTY_OF
                    && relation.object == subject_term(schema)
                {
                    self.insert(
                        Quad::new(
                            relation.subject.clone(),
                            schema.predicate.clone(),
                            schema.object.clone(),
                            schema.graph_name.clone(),
                        ),
                        if schema.predicate == rdfs::DOMAIN {
                            "scm-dom2"
                        } else {
                            "scm-rng2"
                        },
                        &[schema.clone(), relation.clone()],
                    )?;
                }
            }
        }
        self.check()
    }

    fn schema_restrictions(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        let mut restrictions = Vec::new();
        for quad in quads {
            self.check()?;
            if quad.predicate == HAS_VALUE
                || quad.predicate == SOME_VALUES_FROM
                || quad.predicate == ALL_VALUES_FROM
            {
                restrictions.push(quad);
            }
        }
        self.check()?;
        for left in &restrictions {
            self.check()?;
            let Some(left_property) = on_property(self, quads, left)? else {
                continue;
            };
            for right in &restrictions {
                self.check()?;
                if left.graph_name != right.graph_name || left.predicate != right.predicate {
                    continue;
                }
                let Some(right_property) = on_property(self, quads, right)? else {
                    continue;
                };
                let property_subsumes = subproperty(
                    self,
                    quads,
                    &left.graph_name,
                    &left_property,
                    &right_property,
                )?;
                let filler_subsumes =
                    subclass(self, quads, &left.graph_name, &left.object, &right.object)?;
                let applies = if left.predicate == HAS_VALUE {
                    left.object == right.object && property_subsumes
                } else if left.predicate == SOME_VALUES_FROM {
                    (left_property == right_property && filler_subsumes)
                        || (left.object == right.object && property_subsumes)
                } else {
                    (left_property == right_property && filler_subsumes)
                        || (left.object == right.object
                            && subproperty(
                                self,
                                quads,
                                &left.graph_name,
                                &right_property,
                                &left_property,
                            )?)
                };
                if applies {
                    let rule = if left.predicate == HAS_VALUE {
                        "scm-hv"
                    } else if left.predicate == SOME_VALUES_FROM {
                        if left_property == right_property {
                            "scm-svf1"
                        } else {
                            "scm-svf2"
                        }
                    } else if left_property == right_property {
                        "scm-avf1"
                    } else {
                        "scm-avf2"
                    };
                    self.insert(
                        Quad::new(
                            left.subject.clone(),
                            rdfs::SUB_CLASS_OF,
                            subject_term(right),
                            left.graph_name.clone(),
                        ),
                        rule,
                        &[(*left).clone(), (*right).clone()],
                    )?;
                }
            }
        }
        self.check()
    }

    fn schema_lists(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            if declaration.predicate != INTERSECTION_OF && declaration.predicate != UNION_OF {
                continue;
            }
            let class = subject_term(declaration);
            for member in self.list(&declaration.object, &declaration.graph_name)? {
                self.check()?;
                let (subject, object, rule) = if declaration.predicate == INTERSECTION_OF {
                    (declaration.subject.clone(), member, "scm-int")
                } else if let Some(subject) = super::term_resource(&member) {
                    (subject, class.clone(), "scm-uni")
                } else {
                    continue;
                };
                self.insert(
                    Quad::new(
                        subject,
                        rdfs::SUB_CLASS_OF,
                        object,
                        declaration.graph_name.clone(),
                    ),
                    rule,
                    &[declaration.clone()],
                )?;
            }
        }
        self.check()
    }
}

fn on_property(
    runtime: &Runtime<'_>,
    quads: &[Quad],
    restriction: &Quad,
) -> Result<Option<NamedNode>, Owl2RlRdfError> {
    let found = runtime.checked_find(quads.iter(), |quad| {
        quad.graph_name == restriction.graph_name
            && quad.predicate == ON_PROPERTY
            && quad.subject == restriction.subject
            && matches!(&quad.object, Term::NamedNode(_))
    })?;
    Ok(found.and_then(|quad| match &quad.object {
        Term::NamedNode(node) => Some(node.clone()),
        _ => None,
    }))
}

fn subproperty(
    runtime: &Runtime<'_>,
    quads: &[Quad],
    graph: &oxrdf::GraphName,
    left: &NamedNode,
    right: &NamedNode,
) -> Result<bool, Owl2RlRdfError> {
    if left == right {
        runtime.check()?;
        return Ok(true);
    }
    runtime.checked_any(quads.iter(), |quad| {
        &quad.graph_name == graph
            && quad.predicate == rdfs::SUB_PROPERTY_OF
            && quad.subject == *left
            && quad.object == *right
    })
}

fn subclass(
    runtime: &Runtime<'_>,
    quads: &[Quad],
    graph: &oxrdf::GraphName,
    left: &Term,
    right: &Term,
) -> Result<bool, Owl2RlRdfError> {
    if left == right {
        runtime.check()?;
        return Ok(true);
    }
    runtime.checked_any(quads.iter(), |quad| {
        &quad.graph_name == graph
            && quad.predicate == rdfs::SUB_CLASS_OF
            && subject_term(quad) == *left
            && quad.object == *right
    })
}
