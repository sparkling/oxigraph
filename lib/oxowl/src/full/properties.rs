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
        let quads = self.checked_collect(self.all.iter())?;
        self.property_axioms(&quads)?;
        self.property_characteristics(&quads)?;
        self.property_chains(&quads)?;
        self.keys(&quads)
    }

    fn property_axioms(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for schema in quads {
            self.check()?;
            let Some(property) = property_subject(schema) else {
                continue;
            };
            for fact in quads {
                self.check()?;
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
        self.check()
    }

    fn property_characteristics(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            if declaration.predicate != rdf::TYPE {
                continue;
            }
            let Some(property) = property_subject(declaration) else {
                continue;
            };
            let mut facts = Vec::new();
            for quad in quads {
                self.check()?;
                if quad.graph_name == declaration.graph_name && quad.predicate == property {
                    facts.push(quad);
                }
            }
            if declaration.object == SYMMETRIC_PROPERTY {
                for fact in &facts {
                    self.check()?;
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
                self.check()?;
                for right in &facts {
                    self.check()?;
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
        self.check()
    }

    fn property_chains(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            if declaration.predicate != PROPERTY_CHAIN_AXIOM {
                continue;
            }
            let Some(superproperty) = property_subject(declaration) else {
                continue;
            };
            let chain = self.list(&declaration.object, &declaration.graph_name)?;
            let mut properties = Vec::new();
            for term in &chain {
                self.check()?;
                let Term::NamedNode(node) = term else {
                    properties.clear();
                    break;
                };
                properties.push(node.clone());
            }
            if properties.len() != chain.len() || properties.is_empty() {
                continue;
            }
            let mut paths = Vec::new();
            for quad in quads {
                self.check()?;
                if quad.graph_name == declaration.graph_name
                    && quad.predicate == properties[0]
                    && let Some(end) = term_resource(&quad.object)
                {
                    paths.push((quad.subject.clone(), Term::from(end), vec![quad.clone()]));
                }
            }
            for property in properties.iter().skip(1) {
                self.check()?;
                let mut next = Vec::new();
                for (start, end, evidence) in paths {
                    self.check()?;
                    for fact in quads {
                        self.check()?;
                        self.touch()?;
                        if fact.graph_name == declaration.graph_name
                            && fact.predicate == *property
                            && subject_term(fact) == end
                        {
                            let mut evidence = self.checked_collect(evidence.iter().cloned())?;
                            evidence.push(fact.clone());
                            next.push((start.clone(), fact.object.clone(), evidence));
                        }
                    }
                }
                paths = next;
            }
            for (start, end, mut evidence) in paths {
                self.check()?;
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
        self.check()
    }

    fn keys(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            if declaration.predicate != HAS_KEY {
                continue;
            }
            let class = subject_term(declaration);
            let keys = self.list(&declaration.object, &declaration.graph_name)?;
            let mut properties = Vec::new();
            for term in &keys {
                self.check()?;
                if let Term::NamedNode(node) = term {
                    properties.push(node.clone());
                }
            }
            if properties.len() != keys.len() {
                continue;
            }
            let mut instances = Vec::new();
            for quad in quads {
                self.check()?;
                if quad.graph_name == declaration.graph_name
                    && quad.predicate == rdf::TYPE
                    && quad.object == class
                {
                    instances.push(quad);
                }
            }
            for left in &instances {
                self.check()?;
                for right in &instances {
                    self.check()?;
                    self.touch()?;
                    let mut shared_all = true;
                    for property in &properties {
                        self.check()?;
                        if !shared_value(quads, left, right, property, self)? {
                            shared_all = false;
                            break;
                        }
                    }
                    if shared_all {
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
        self.check()
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
) -> Result<bool, Owl2RlRdfError> {
    runtime.check()?;
    for left_value in quads {
        runtime.check()?;
        if left_value.graph_name == left.graph_name
            && left_value.subject == left.subject
            && left_value.predicate == *property
            && runtime.checked_any(quads.iter(), |right_value| {
                right_value.graph_name == right.graph_name
                    && right_value.subject == right.subject
                    && right_value.predicate == *property
                    && runtime.is_equal(&left.graph_name, &left_value.object, &right_value.object)
            })?
        {
            return Ok(true);
        }
    }
    runtime.check()?;
    Ok(false)
}
