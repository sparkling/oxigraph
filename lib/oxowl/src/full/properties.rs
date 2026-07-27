#![expect(
    clippy::multiple_inherent_impl,
    reason = "the bounded runtime is split by rule family"
)]

use super::{Owl2RlRdfError, Runtime, subject_term, term_resource};
use crate::vocabulary::{
    EQUIVALENT_PROPERTY, FUNCTIONAL_PROPERTY, HAS_KEY, INVERSE_FUNCTIONAL_PROPERTY, INVERSE_OF,
    PROPERTY_CHAIN_AXIOM, SYMMETRIC_PROPERTY, TRANSITIVE_PROPERTY,
};
use oxrdf::{
    NamedNode, NamedOrBlankNode, Quad, Term,
    vocab::{rdf, rdfs},
};

impl Runtime<'_> {
    pub(super) fn apply_properties(&mut self) -> Result<(), Owl2RlRdfError> {
        let quads = self.all.iter().collect::<Vec<_>>();
        self.property_axioms(&quads)?;
        self.property_characteristics(&quads)?;
        self.property_chains(&quads)?;
        self.keys(&quads)
    }

    fn property_axioms(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for schema in quads {
            let Some(property) = property_subject(schema) else {
                continue;
            };
            for fact in quads {
                if schema.graph_name != fact.graph_name {
                    continue;
                }
                if schema.predicate == rdfs::DOMAIN && fact.predicate == property {
                    self.touch()?;
                    self.insert(
                        Quad::new(
                            fact.subject.clone(),
                            rdf::TYPE,
                            schema.object.clone(),
                            fact.graph_name.clone(),
                        ),
                        "prp-dom",
                        &[schema.clone(), fact.clone()],
                    )?;
                }
                if schema.predicate == rdfs::RANGE && fact.predicate == property {
                    self.touch()?;
                    if let Some(object) = term_resource(&fact.object) {
                        self.insert(
                            Quad::new(
                                object,
                                rdf::TYPE,
                                schema.object.clone(),
                                fact.graph_name.clone(),
                            ),
                            "prp-rng",
                            &[schema.clone(), fact.clone()],
                        )?;
                    } else {
                        self.add_generalized(
                            &fact.graph_name,
                            fact.object.clone(),
                            rdf::TYPE,
                            schema.object.clone(),
                        )?;
                    }
                }
                if schema.predicate == rdfs::SUB_PROPERTY_OF
                    && let Term::NamedNode(superproperty) = &schema.object
                    && fact.predicate == property
                {
                    self.touch()?;
                    self.insert(
                        Quad::new(
                            fact.subject.clone(),
                            superproperty.clone(),
                            fact.object.clone(),
                            fact.graph_name.clone(),
                        ),
                        "prp-spo1",
                        &[schema.clone(), fact.clone()],
                    )?;
                }
                if schema.predicate == EQUIVALENT_PROPERTY
                    && let Term::NamedNode(equivalent) = &schema.object
                {
                    if fact.predicate == property {
                        self.touch()?;
                        self.insert(
                            Quad::new(
                                fact.subject.clone(),
                                equivalent.clone(),
                                fact.object.clone(),
                                fact.graph_name.clone(),
                            ),
                            "prp-eqp1",
                            &[schema.clone(), fact.clone()],
                        )?;
                    }
                    if fact.predicate == *equivalent {
                        self.touch()?;
                        self.insert(
                            Quad::new(
                                fact.subject.clone(),
                                property.clone(),
                                fact.object.clone(),
                                fact.graph_name.clone(),
                            ),
                            "prp-eqp2",
                            &[schema.clone(), fact.clone()],
                        )?;
                    }
                }
                if schema.predicate == INVERSE_OF
                    && let Term::NamedNode(inverse) = &schema.object
                {
                    if fact.predicate == property
                        && let Some(object) = term_resource(&fact.object)
                    {
                        self.touch()?;
                        self.insert(
                            Quad::new(
                                object,
                                inverse.clone(),
                                subject_term(fact),
                                fact.graph_name.clone(),
                            ),
                            "prp-inv1",
                            &[schema.clone(), fact.clone()],
                        )?;
                    }
                    if fact.predicate == *inverse
                        && let Some(object) = term_resource(&fact.object)
                    {
                        self.touch()?;
                        self.insert(
                            Quad::new(
                                object,
                                property.clone(),
                                subject_term(fact),
                                fact.graph_name.clone(),
                            ),
                            "prp-inv2",
                            &[schema.clone(), fact.clone()],
                        )?;
                    }
                }
            }
        }
        Ok(())
    }

    fn property_characteristics(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            if declaration.predicate != rdf::TYPE {
                continue;
            }
            let Some(property) = property_subject(declaration) else {
                continue;
            };
            let facts = quads
                .iter()
                .filter(|quad| {
                    quad.graph_name == declaration.graph_name && quad.predicate == property
                })
                .collect::<Vec<_>>();
            if declaration.object == SYMMETRIC_PROPERTY {
                for fact in &facts {
                    if let Some(object) = term_resource(&fact.object) {
                        self.insert(
                            Quad::new(
                                object,
                                property.clone(),
                                subject_term(fact),
                                fact.graph_name.clone(),
                            ),
                            "prp-symp",
                            &[declaration.clone(), (*fact).clone()],
                        )?;
                    }
                }
            }
            for left in &facts {
                for right in &facts {
                    self.touch()?;
                    if declaration.object == FUNCTIONAL_PROPERTY && left.subject == right.subject {
                        self.add_equality(
                            &left.graph_name,
                            left.object.clone(),
                            right.object.clone(),
                            "prp-fp",
                            &[declaration.clone(), (*left).clone(), (*right).clone()],
                        )?;
                    }
                    if declaration.object == INVERSE_FUNCTIONAL_PROPERTY
                        && self.is_equal(&left.graph_name, &left.object, &right.object)
                    {
                        self.add_equality(
                            &left.graph_name,
                            subject_term(left),
                            subject_term(right),
                            "prp-ifp",
                            &[declaration.clone(), (*left).clone(), (*right).clone()],
                        )?;
                    }
                    if declaration.object == TRANSITIVE_PROPERTY
                        && left.object == subject_term(right)
                    {
                        self.insert(
                            Quad::new(
                                left.subject.clone(),
                                property.clone(),
                                right.object.clone(),
                                left.graph_name.clone(),
                            ),
                            "prp-trp",
                            &[declaration.clone(), (*left).clone(), (*right).clone()],
                        )?;
                    }
                }
            }
        }
        Ok(())
    }

    fn property_chains(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            if declaration.predicate != PROPERTY_CHAIN_AXIOM {
                continue;
            }
            let Some(superproperty) = property_subject(declaration) else {
                continue;
            };
            let chain = self.list(&declaration.object, &declaration.graph_name)?;
            let properties = chain
                .iter()
                .map(|term| match term {
                    Term::NamedNode(node) => Some(node.clone()),
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()
                .unwrap_or_default();
            if properties.len() != chain.len() || properties.is_empty() {
                continue;
            }
            let mut paths = quads
                .iter()
                .filter(|quad| {
                    quad.graph_name == declaration.graph_name && quad.predicate == properties[0]
                })
                .filter_map(|quad| {
                    term_resource(&quad.object)
                        .map(|end| (quad.subject.clone(), Term::from(end), vec![quad.clone()]))
                })
                .collect::<Vec<_>>();
            for property in properties.iter().skip(1) {
                let mut next = Vec::new();
                for (start, end, evidence) in paths {
                    for fact in quads {
                        self.touch()?;
                        if fact.graph_name == declaration.graph_name
                            && fact.predicate == *property
                            && subject_term(fact) == end
                        {
                            let mut evidence = evidence.clone();
                            evidence.push(fact.clone());
                            next.push((start.clone(), fact.object.clone(), evidence));
                        }
                    }
                }
                paths = next;
            }
            for (start, end, mut evidence) in paths {
                evidence.push(declaration.clone());
                self.insert(
                    Quad::new(
                        start,
                        superproperty.clone(),
                        end,
                        declaration.graph_name.clone(),
                    ),
                    "prp-spo2",
                    &evidence,
                )?;
            }
        }
        Ok(())
    }

    fn keys(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            if declaration.predicate != HAS_KEY {
                continue;
            }
            let class = subject_term(declaration);
            let keys = self.list(&declaration.object, &declaration.graph_name)?;
            let properties = keys
                .iter()
                .filter_map(|term| match term {
                    Term::NamedNode(node) => Some(node.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>();
            if properties.len() != keys.len() {
                continue;
            }
            let instances = quads
                .iter()
                .filter(|quad| {
                    quad.graph_name == declaration.graph_name
                        && quad.predicate == rdf::TYPE
                        && quad.object == class
                })
                .collect::<Vec<_>>();
            for left in &instances {
                for right in &instances {
                    self.touch()?;
                    if properties
                        .iter()
                        .all(|property| shared_value(quads, left, right, property, self))
                    {
                        self.add_equality(
                            &declaration.graph_name,
                            subject_term(left),
                            subject_term(right),
                            "prp-key",
                            &[declaration.clone(), (*left).clone(), (*right).clone()],
                        )?;
                    }
                }
            }
        }
        Ok(())
    }
}

fn property_subject(quad: &Quad) -> Option<NamedNode> {
    match &quad.subject {
        NamedOrBlankNode::NamedNode(node) => Some(node.clone()),
        NamedOrBlankNode::BlankNode(_) => None,
    }
}

fn shared_value(
    quads: &[Quad],
    left: &Quad,
    right: &Quad,
    property: &NamedNode,
    runtime: &Runtime<'_>,
) -> bool {
    quads.iter().any(|left_value| {
        left_value.graph_name == left.graph_name
            && left_value.subject == left.subject
            && left_value.predicate == *property
            && quads.iter().any(|right_value| {
                right_value.graph_name == right.graph_name
                    && right_value.subject == right.subject
                    && right_value.predicate == *property
                    && runtime.is_equal(&left.graph_name, &left_value.object, &right_value.object)
            })
    })
}
