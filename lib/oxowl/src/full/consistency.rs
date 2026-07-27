#![expect(
    clippy::cloned_ref_to_slice_refs,
    clippy::multiple_inherent_impl,
    clippy::unnecessary_wraps,
    reason = "owned rule evidence and uniform fallible phases support a split rule runtime"
)]

use super::{Owl2RlRdfError, Runtime, subject_term};
use crate::vocabulary::{
    ALL_DIFFERENT, ALL_DISJOINT_CLASSES, ALL_DISJOINT_PROPERTIES, ASSERTION_PROPERTY,
    ASYMMETRIC_PROPERTY, COMPLEMENT_OF, DIFFERENT_FROM, DISJOINT_WITH, DISTINCT_MEMBERS,
    IRREFLEXIVE_PROPERTY, MAX_CARDINALITY, MAX_QUALIFIED_CARDINALITY, MEMBERS, NOTHING, ON_CLASS,
    ON_PROPERTY, PROPERTY_DISJOINT_WITH, SOURCE_INDIVIDUAL, TARGET_INDIVIDUAL, TARGET_VALUE, THING,
};
use oxrdf::{NamedNode, Quad, Term, vocab::rdf};

impl Runtime<'_> {
    pub(super) fn detect_contradictions(&mut self) -> Result<(), Owl2RlRdfError> {
        let quads = self.all.iter().collect::<Vec<_>>();
        self.equality_contradictions(&quads)?;
        self.property_contradictions(&quads)?;
        self.negative_assertions(&quads)?;
        self.class_contradictions(&quads)
    }

    fn equality_contradictions(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for different in quads {
            if different.predicate == DIFFERENT_FROM
                && self.is_equal(
                    &different.graph_name,
                    &subject_term(different),
                    &different.object,
                )
            {
                self.contradiction("eq-diff1", &[different.clone()]);
            }
        }
        for declaration in quads {
            if declaration.predicate != rdf::TYPE || declaration.object != ALL_DIFFERENT {
                continue;
            }
            for members in quads {
                if members.graph_name != declaration.graph_name
                    || members.subject != declaration.subject
                    || (members.predicate != MEMBERS && members.predicate != DISTINCT_MEMBERS)
                {
                    continue;
                }
                let list = self.list(&members.object, &members.graph_name)?;
                for (index, left) in list.iter().enumerate() {
                    for right in list.iter().skip(index + 1) {
                        if self.is_equal(&members.graph_name, left, right) {
                            self.contradiction(
                                if members.predicate == MEMBERS {
                                    "eq-diff2"
                                } else {
                                    "eq-diff3"
                                },
                                &[declaration.clone(), members.clone()],
                            );
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn property_contradictions(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            if declaration.predicate == rdf::TYPE
                && (declaration.object == IRREFLEXIVE_PROPERTY
                    || declaration.object == ASYMMETRIC_PROPERTY)
            {
                let Some(property) = named_subject(declaration) else {
                    continue;
                };
                let facts = quads
                    .iter()
                    .filter(|quad| {
                        quad.graph_name == declaration.graph_name && quad.predicate == property
                    })
                    .collect::<Vec<_>>();
                for left in &facts {
                    if declaration.object == IRREFLEXIVE_PROPERTY
                        && self.is_equal(&left.graph_name, &subject_term(left), &left.object)
                    {
                        self.contradiction("prp-irp", &[declaration.clone(), (*left).clone()]);
                    }
                    if declaration.object == ASYMMETRIC_PROPERTY {
                        for right in &facts {
                            if self.is_equal(&left.graph_name, &subject_term(left), &right.object)
                                && self.is_equal(
                                    &left.graph_name,
                                    &left.object,
                                    &subject_term(right),
                                )
                            {
                                self.contradiction(
                                    "prp-asyp",
                                    &[declaration.clone(), (*left).clone(), (*right).clone()],
                                );
                            }
                        }
                    }
                }
            }
            if declaration.predicate == PROPERTY_DISJOINT_WITH {
                let Some(left_property) = named_subject(declaration) else {
                    continue;
                };
                let Term::NamedNode(right_property) = &declaration.object else {
                    continue;
                };
                for left in quads.iter().filter(|quad| {
                    quad.graph_name == declaration.graph_name && quad.predicate == left_property
                }) {
                    for right in quads.iter().filter(|quad| {
                        quad.graph_name == declaration.graph_name
                            && quad.predicate == *right_property
                    }) {
                        if left.subject == right.subject
                            && self.is_equal(&left.graph_name, &left.object, &right.object)
                        {
                            self.contradiction(
                                "prp-pdw",
                                &[declaration.clone(), left.clone(), right.clone()],
                            );
                        }
                    }
                }
            }
            if declaration.predicate == rdf::TYPE && declaration.object == ALL_DISJOINT_PROPERTIES {
                self.all_disjoint_properties(quads, declaration)?;
            }
        }
        Ok(())
    }

    fn all_disjoint_properties(
        &mut self,
        quads: &[Quad],
        declaration: &Quad,
    ) -> Result<(), Owl2RlRdfError> {
        let Some(members) = quads.iter().find(|quad| {
            quad.graph_name == declaration.graph_name
                && quad.subject == declaration.subject
                && quad.predicate == MEMBERS
        }) else {
            return Ok(());
        };
        let properties = self.list(&members.object, &members.graph_name)?;
        for (index, left) in properties.iter().enumerate() {
            let Term::NamedNode(left) = left else {
                continue;
            };
            for right in properties.iter().skip(index + 1) {
                let Term::NamedNode(right) = right else {
                    continue;
                };
                for left_fact in quads.iter().filter(|quad| quad.predicate == *left) {
                    for right_fact in quads.iter().filter(|quad| quad.predicate == *right) {
                        if left_fact.graph_name == declaration.graph_name
                            && right_fact.graph_name == declaration.graph_name
                            && left_fact.subject == right_fact.subject
                            && self.is_equal(
                                &declaration.graph_name,
                                &left_fact.object,
                                &right_fact.object,
                            )
                        {
                            self.contradiction(
                                "prp-adp",
                                &[
                                    declaration.clone(),
                                    members.clone(),
                                    left_fact.clone(),
                                    right_fact.clone(),
                                ],
                            );
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn negative_assertions(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for source in quads
            .iter()
            .filter(|quad| quad.predicate == SOURCE_INDIVIDUAL)
        {
            let assertion = quads.iter().find(|quad| {
                quad.graph_name == source.graph_name
                    && quad.subject == source.subject
                    && quad.predicate == ASSERTION_PROPERTY
            });
            let Some(assertion) = assertion else {
                continue;
            };
            let Term::NamedNode(property) = &assertion.object else {
                continue;
            };
            for target in quads.iter().filter(|quad| {
                quad.graph_name == source.graph_name
                    && quad.subject == source.subject
                    && (quad.predicate == TARGET_INDIVIDUAL || quad.predicate == TARGET_VALUE)
            }) {
                let exists = quads.iter().any(|fact| {
                    fact.graph_name == source.graph_name
                        && fact.predicate == *property
                        && subject_term(fact) == source.object
                        && self.is_equal(&fact.graph_name, &fact.object, &target.object)
                });
                if exists {
                    self.contradiction(
                        if target.predicate == TARGET_INDIVIDUAL {
                            "prp-npa1"
                        } else {
                            "prp-npa2"
                        },
                        &[source.clone(), assertion.clone(), target.clone()],
                    );
                }
            }
        }
        Ok(())
    }

    fn class_contradictions(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for typed in quads {
            if typed.predicate == rdf::TYPE && typed.object == NOTHING {
                self.contradiction("cls-nothing2", &[typed.clone()]);
            }
        }
        for schema in quads {
            if schema.predicate == COMPLEMENT_OF || schema.predicate == DISJOINT_WITH {
                let left = subject_term(schema);
                for typed in quads.iter().filter(|quad| {
                    quad.graph_name == schema.graph_name
                        && quad.predicate == rdf::TYPE
                        && quad.object == left
                }) {
                    if quads.iter().any(|other| {
                        other.graph_name == typed.graph_name
                            && other.subject == typed.subject
                            && other.predicate == rdf::TYPE
                            && other.object == schema.object
                    }) {
                        self.contradiction(
                            if schema.predicate == COMPLEMENT_OF {
                                "cls-com"
                            } else {
                                "cax-dw"
                            },
                            &[schema.clone(), typed.clone()],
                        );
                    }
                }
            }
            if schema.predicate == rdf::TYPE && schema.object == ALL_DISJOINT_CLASSES {
                self.all_disjoint_classes(quads, schema)?;
            }
            if schema.predicate == MAX_CARDINALITY || schema.predicate == MAX_QUALIFIED_CARDINALITY
            {
                self.zero_cardinality(quads, schema)?;
            }
        }
        Ok(())
    }

    fn all_disjoint_classes(
        &mut self,
        quads: &[Quad],
        declaration: &Quad,
    ) -> Result<(), Owl2RlRdfError> {
        let Some(members) = quads.iter().find(|quad| {
            quad.graph_name == declaration.graph_name
                && quad.subject == declaration.subject
                && quad.predicate == MEMBERS
        }) else {
            return Ok(());
        };
        let classes = self.list(&members.object, &members.graph_name)?;
        let typings = quads
            .iter()
            .filter(|quad| quad.predicate == rdf::TYPE)
            .collect::<Vec<_>>();
        for typed in &typings {
            let count = classes
                .iter()
                .filter(|class| &typed.object == *class)
                .count();
            if count > 1 {
                self.contradiction(
                    "cax-adc",
                    &[declaration.clone(), members.clone(), (*typed).clone()],
                );
            }
            for other in &typings {
                if typed.graph_name == other.graph_name
                    && typed.subject == other.subject
                    && typed.object != other.object
                    && classes.contains(&typed.object)
                    && classes.contains(&other.object)
                {
                    self.contradiction(
                        "cax-adc",
                        &[
                            declaration.clone(),
                            members.clone(),
                            (*typed).clone(),
                            (*other).clone(),
                        ],
                    );
                }
            }
        }
        Ok(())
    }

    fn zero_cardinality(
        &mut self,
        quads: &[Quad],
        cardinality: &Quad,
    ) -> Result<(), Owl2RlRdfError> {
        if !matches!(&cardinality.object, Term::Literal(literal) if literal.value() == "0") {
            return Ok(());
        }
        let restriction = subject_term(cardinality);
        let property = quads.iter().find_map(|quad| {
            (quad.graph_name == cardinality.graph_name
                && subject_term(quad) == restriction
                && quad.predicate == ON_PROPERTY)
                .then(|| match &quad.object {
                    Term::NamedNode(node) => Some(node.clone()),
                    _ => None,
                })
                .flatten()
        });
        let Some(property) = property else {
            return Ok(());
        };
        let qualifier = quads.iter().find(|quad| {
            quad.graph_name == cardinality.graph_name
                && subject_term(quad) == restriction
                && quad.predicate == ON_CLASS
        });
        for typed in quads.iter().filter(|quad| {
            quad.predicate == rdf::TYPE
                && quad.graph_name == cardinality.graph_name
                && quad.object == restriction
        }) {
            for fact in quads.iter().filter(|quad| {
                quad.graph_name == typed.graph_name
                    && quad.subject == typed.subject
                    && quad.predicate == property
            }) {
                let qualified = qualifier.is_none_or(|class| {
                    class.object == THING
                        || quads.iter().any(|item| {
                            item.graph_name == fact.graph_name
                                && item.predicate == rdf::TYPE
                                && subject_term(item) == fact.object
                                && item.object == class.object
                        })
                });
                if qualified {
                    let rule = match (
                        cardinality.predicate == MAX_QUALIFIED_CARDINALITY,
                        qualifier,
                    ) {
                        (false, _) => "cls-maxc1",
                        (true, Some(class)) if class.object == THING => "cls-maxqc2",
                        (true, _) => "cls-maxqc1",
                    };
                    self.contradiction(rule, &[cardinality.clone(), typed.clone(), fact.clone()]);
                }
            }
        }
        Ok(())
    }
}

fn named_subject(quad: &Quad) -> Option<NamedNode> {
    match &quad.subject {
        oxrdf::NamedOrBlankNode::NamedNode(node) => Some(node.clone()),
        oxrdf::NamedOrBlankNode::BlankNode(_) => None,
    }
}
