#![expect(
    clippy::cloned_ref_to_slice_refs,
    reason = "rule evidence is owned and the runtime is split by rule family"
)]

use super::{Owl2RlRdfError, Runtime, subject_term, term_resource};
use crate::vocabulary::{
    ALL_VALUES_FROM, EQUIVALENT_CLASS, HAS_VALUE, INTERSECTION_OF, MAX_CARDINALITY,
    MAX_QUALIFIED_CARDINALITY, ON_CLASS, ON_PROPERTY, ONE_OF, SOME_VALUES_FROM, THING, UNION_OF,
};
use oxrdf::{
    NamedNode, Quad, Term,
    vocab::{rdf, rdfs},
};

impl Runtime<'_> {
    pub(super) fn apply_classes(&mut self) -> Result<(), Owl2RlRdfError> {
        let quads = self.checked_collect(self.all.iter())?;
        self.class_lists(&quads)?;
        self.restrictions(&quads)?;
        self.cardinalities(&quads)?;
        self.class_axioms(&quads)
    }

    fn class_lists(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            if declaration.predicate != INTERSECTION_OF
                && declaration.predicate != UNION_OF
                && declaration.predicate != ONE_OF
            {
                continue;
            }
            let class = subject_term(declaration);
            let members = self.list(&declaration.object, &declaration.graph_name)?;
            if declaration.predicate == ONE_OF {
                for member in members {
                    self.check()?;
                    if let Some(subject) = term_resource(&member) {
                        self.insert(
                            Quad::new(
                                subject,
                                rdf::TYPE,
                                class.clone(),
                                declaration.graph_name.clone(),
                            ),
                            "cls-oo",
                            &[declaration.clone()],
                        )?;
                    } else {
                        self.add_generalized(
                            &declaration.graph_name,
                            member,
                            rdf::TYPE,
                            class.clone(),
                        )?;
                    }
                }
                continue;
            }
            let mut instances = Vec::new();
            for quad in quads {
                self.check()?;
                if quad.graph_name == declaration.graph_name && quad.predicate == rdf::TYPE {
                    instances.push(quad);
                }
            }
            self.check()?;
            if declaration.predicate == INTERSECTION_OF {
                for typed in &instances {
                    self.check()?;
                    if typed.object == class {
                        for member in &members {
                            self.check()?;
                            self.insert(
                                Quad::new(
                                    typed.subject.clone(),
                                    rdf::TYPE,
                                    member.clone(),
                                    typed.graph_name.clone(),
                                ),
                                "cls-int2",
                                &[declaration.clone(), (*typed).clone()],
                            )?;
                        }
                    }
                }
                for candidate in &instances {
                    self.check()?;
                    self.touch()?;
                    let mut has_all_types = true;
                    for member in &members {
                        self.check()?;
                        if !has_type(
                            self,
                            quads,
                            &candidate.graph_name,
                            &candidate.subject,
                            member,
                        )? {
                            has_all_types = false;
                            break;
                        }
                    }
                    if has_all_types {
                        self.insert(
                            Quad::new(
                                candidate.subject.clone(),
                                rdf::TYPE,
                                class.clone(),
                                candidate.graph_name.clone(),
                            ),
                            "cls-int1",
                            &[declaration.clone(), (*candidate).clone()],
                        )?;
                    }
                }
            } else {
                for typed in &instances {
                    self.check()?;
                    if self.checked_any(members.iter(), |member| **member == typed.object)? {
                        self.insert(
                            Quad::new(
                                typed.subject.clone(),
                                rdf::TYPE,
                                class.clone(),
                                typed.graph_name.clone(),
                            ),
                            "cls-uni",
                            &[declaration.clone(), (*typed).clone()],
                        )?;
                    }
                }
            }
        }
        self.check()
    }

    fn restrictions(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for restriction in quads {
            self.check()?;
            if restriction.predicate != ON_PROPERTY {
                continue;
            }
            let Term::NamedNode(property) = &restriction.object else {
                continue;
            };
            let expression = subject_term(restriction);
            for facet in quads {
                self.check()?;
                if facet.graph_name != restriction.graph_name || subject_term(facet) != expression {
                    continue;
                }
                if facet.predicate == SOME_VALUES_FROM {
                    self.some_values(quads, restriction, facet, property)?;
                } else if facet.predicate == ALL_VALUES_FROM {
                    self.all_values(quads, restriction, facet, property)?;
                } else if facet.predicate == HAS_VALUE {
                    self.has_value(quads, restriction, facet, property)?;
                }
            }
        }
        self.check()
    }

    fn some_values(
        &mut self,
        quads: &[Quad],
        on_property: &Quad,
        facet: &Quad,
        property: &NamedNode,
    ) -> Result<(), Owl2RlRdfError> {
        let restriction = subject_term(on_property);
        for fact in quads {
            self.check()?;
            if fact.graph_name != facet.graph_name || fact.predicate != *property {
                continue;
            }
            let matches = facet.object == THING
                || self.checked_any(quads.iter(), |typed| {
                    typed.graph_name == fact.graph_name
                        && typed.predicate == rdf::TYPE
                        && subject_term(typed) == fact.object
                        && typed.object == facet.object
                })?;
            if matches {
                self.insert(
                    Quad::new(
                        fact.subject.clone(),
                        rdf::TYPE,
                        restriction.clone(),
                        fact.graph_name.clone(),
                    ),
                    if facet.object == THING {
                        "cls-svf2"
                    } else {
                        "cls-svf1"
                    },
                    &[on_property.clone(), facet.clone(), fact.clone()],
                )?;
            }
        }
        self.check()
    }

    fn all_values(
        &mut self,
        quads: &[Quad],
        on_property: &Quad,
        facet: &Quad,
        property: &NamedNode,
    ) -> Result<(), Owl2RlRdfError> {
        let restriction = subject_term(on_property);
        for typed in quads {
            self.check()?;
            if typed.graph_name != facet.graph_name
                || typed.predicate != rdf::TYPE
                || typed.object != restriction
            {
                continue;
            }
            for fact in quads {
                self.check()?;
                if fact.graph_name == typed.graph_name
                    && fact.subject == typed.subject
                    && fact.predicate == *property
                {
                    if let Some(object) = term_resource(&fact.object) {
                        self.insert(
                            Quad::new(
                                object,
                                rdf::TYPE,
                                facet.object.clone(),
                                fact.graph_name.clone(),
                            ),
                            "cls-avf",
                            &[
                                on_property.clone(),
                                facet.clone(),
                                typed.clone(),
                                fact.clone(),
                            ],
                        )?;
                    } else {
                        self.add_generalized(
                            &fact.graph_name,
                            fact.object.clone(),
                            rdf::TYPE,
                            facet.object.clone(),
                        )?;
                    }
                }
            }
        }
        self.check()
    }

    fn has_value(
        &mut self,
        quads: &[Quad],
        on_property: &Quad,
        facet: &Quad,
        property: &NamedNode,
    ) -> Result<(), Owl2RlRdfError> {
        let restriction = subject_term(on_property);
        for quad in quads {
            self.check()?;
            if quad.graph_name != facet.graph_name {
                continue;
            }
            if quad.predicate == rdf::TYPE && quad.object == restriction {
                self.insert(
                    Quad::new(
                        quad.subject.clone(),
                        property.clone(),
                        facet.object.clone(),
                        quad.graph_name.clone(),
                    ),
                    "cls-hv1",
                    &[on_property.clone(), facet.clone(), quad.clone()],
                )?;
            }
            if quad.predicate == *property && quad.object == facet.object {
                self.insert(
                    Quad::new(
                        quad.subject.clone(),
                        rdf::TYPE,
                        restriction.clone(),
                        quad.graph_name.clone(),
                    ),
                    "cls-hv2",
                    &[on_property.clone(), facet.clone(), quad.clone()],
                )?;
            }
        }
        self.check()
    }

    fn cardinalities(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for cardinality in quads {
            self.check()?;
            if cardinality.predicate != MAX_CARDINALITY
                && cardinality.predicate != MAX_QUALIFIED_CARDINALITY
            {
                continue;
            }
            let Some(maximum) = cardinality_value(&cardinality.object) else {
                continue;
            };
            if maximum > 1 {
                continue;
            }
            let restriction = subject_term(cardinality);
            let Some(on_property) = self.checked_find(quads.iter(), |quad| {
                quad.graph_name == cardinality.graph_name
                    && subject_term(quad) == restriction
                    && quad.predicate == ON_PROPERTY
            })?
            else {
                continue;
            };
            let Term::NamedNode(property) = &on_property.object else {
                continue;
            };
            let qualifier = self.checked_find(quads.iter(), |quad| {
                cardinality.predicate == MAX_QUALIFIED_CARDINALITY
                    && quad.graph_name == cardinality.graph_name
                    && subject_term(quad) == restriction
                    && quad.predicate == ON_CLASS
            })?;
            if maximum == 1 {
                self.cardinality_one(
                    quads,
                    cardinality,
                    property,
                    qualifier.map(|quad| &quad.object),
                )?;
            }
        }
        self.check()
    }

    fn cardinality_one(
        &mut self,
        quads: &[Quad],
        cardinality: &Quad,
        property: &NamedNode,
        qualifier: Option<&Term>,
    ) -> Result<(), Owl2RlRdfError> {
        let restriction = subject_term(cardinality);
        for instance in quads {
            self.check()?;
            if instance.graph_name != cardinality.graph_name
                || instance.predicate != rdf::TYPE
                || instance.object != restriction
            {
                continue;
            }
            let mut values = Vec::new();
            for quad in quads {
                self.check()?;
                if quad.graph_name != instance.graph_name
                    || quad.subject != instance.subject
                    || quad.predicate != *property
                {
                    continue;
                }
                let qualified = match qualifier {
                    None => true,
                    Some(class) if class == &Term::from(THING) => true,
                    Some(class) => self.checked_any(quads.iter(), |typed| {
                        typed.graph_name == quad.graph_name
                            && typed.predicate == rdf::TYPE
                            && subject_term(typed) == quad.object
                            && &typed.object == class
                    })?,
                };
                if qualified {
                    values.push(quad);
                }
            }
            self.check()?;
            for left in &values {
                self.check()?;
                for right in &values {
                    self.check()?;
                    self.add_equality(
                        &instance.graph_name,
                        left.object.clone(),
                        right.object.clone(),
                        if qualifier.is_some() {
                            if qualifier == Some(&Term::from(THING)) {
                                "cls-maxqc4"
                            } else {
                                "cls-maxqc3"
                            }
                        } else {
                            "cls-maxc2"
                        },
                        &[cardinality.clone(), (*left).clone(), (*right).clone()],
                    )?;
                }
            }
        }
        self.check()
    }

    fn class_axioms(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for schema in quads {
            self.check()?;
            if schema.predicate != rdfs::SUB_CLASS_OF && schema.predicate != EQUIVALENT_CLASS {
                continue;
            }
            let source = subject_term(schema);
            for typed in quads {
                self.check()?;
                if typed.graph_name != schema.graph_name || typed.predicate != rdf::TYPE {
                    continue;
                }
                let (matches, target, rule) = if schema.predicate == rdfs::SUB_CLASS_OF {
                    (typed.object == source, schema.object.clone(), "cax-sco")
                } else if typed.object == source {
                    (true, schema.object.clone(), "cax-eqc1")
                } else {
                    (typed.object == schema.object, source.clone(), "cax-eqc2")
                };
                if matches {
                    self.insert(
                        Quad::new(
                            typed.subject.clone(),
                            rdf::TYPE,
                            target,
                            typed.graph_name.clone(),
                        ),
                        rule,
                        &[schema.clone(), typed.clone()],
                    )?;
                }
            }
        }
        self.check()
    }
}

fn has_type(
    runtime: &Runtime<'_>,
    quads: &[Quad],
    graph: &oxrdf::GraphName,
    subject: &oxrdf::NamedOrBlankNode,
    class: &Term,
) -> Result<bool, Owl2RlRdfError> {
    runtime.checked_any(quads.iter(), |quad| {
        &quad.graph_name == graph
            && &quad.subject == subject
            && quad.predicate == rdf::TYPE
            && &quad.object == class
    })
}

fn cardinality_value(term: &Term) -> Option<u8> {
    let Term::Literal(literal) = term else {
        return None;
    };
    match literal.value() {
        "0" => Some(0),
        "1" => Some(1),
        _ => None,
    }
}
