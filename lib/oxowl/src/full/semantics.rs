#![expect(
    clippy::multiple_inherent_impl,
    reason = "the bounded runtime is split by rule family"
)]

use super::{Owl2RlRdfError, Runtime, subject_term, term_resource};
use crate::vocabulary::{
    ALL_DIFFERENT, ALL_DISJOINT_PROPERTIES, DIFFERENT_FROM, DISTINCT_MEMBERS, FUNCTIONAL_PROPERTY,
    INVERSE_FUNCTIONAL_PROPERTY, MEMBERS, NAMED_INDIVIDUAL, PROPERTY_CHAIN_AXIOM,
    PROPERTY_DISJOINT_WITH, REFLEXIVE_PROPERTY, TRANSITIVE_PROPERTY,
};
use oxrdf::{BlankNode, GraphName, NamedNode, Quad, Term, vocab::rdf};

impl Runtime<'_> {
    /// Sound RDF-based semantic consequences not expressible as range-restricted
    /// OWL 2 RL rules because their conclusions contain existential witnesses.
    pub(super) fn apply_rdf_based_semantics(&mut self) -> Result<(), Owl2RlRdfError> {
        let quads = self.checked_collect(self.all.iter())?;
        self.different_symmetry(&quads)?;
        self.semantic_property_features(&quads)?;
        self.semantic_disjoint_properties(&quads)?;
        self.semantic_complements(&quads)?;
        self.semantic_datatype_ranges(&quads)?;
        self.semantic_expression_witnesses()
    }

    fn different_symmetry(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for fact in quads {
            self.check()?;
            if fact.predicate != DIFFERENT_FROM {
                continue;
            }
            if let Some(object) = term_resource(&fact.object) {
                self.insert(
                    Quad::new(
                        object,
                        DIFFERENT_FROM,
                        subject_term(fact),
                        fact.graph_name.clone(),
                    ),
                    "rdf-sem-different-symmetry",
                    std::slice::from_ref(fact),
                )?;
            }
        }
        self.check()
    }

    fn semantic_property_features(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            let Some(property) = named_subject(declaration) else {
                continue;
            };
            if declaration.predicate == PROPERTY_CHAIN_AXIOM {
                let chain = self.list(&declaration.object, &declaration.graph_name)?;
                if chain == [Term::from(property.clone()), Term::from(property.clone())] {
                    self.insert(
                        Quad::new(
                            property.clone(),
                            rdf::TYPE,
                            TRANSITIVE_PROPERTY,
                            declaration.graph_name.clone(),
                        ),
                        "rdf-sem-chain-transitive",
                        std::slice::from_ref(declaration),
                    )?;
                }
            }
            if declaration.predicate != rdf::TYPE {
                continue;
            }
            if declaration.object == REFLEXIVE_PROPERTY {
                for individual in quads {
                    self.check()?;
                    if individual.graph_name != declaration.graph_name
                        || individual.predicate != rdf::TYPE
                        || individual.object != NAMED_INDIVIDUAL
                    {
                        continue;
                    }
                    self.insert(
                        Quad::new(
                            individual.subject.clone(),
                            property.clone(),
                            subject_term(individual),
                            declaration.graph_name.clone(),
                        ),
                        "rdf-sem-reflexive",
                        &[declaration.clone(), individual.clone()],
                    )?;
                }
            }
            if declaration.object == FUNCTIONAL_PROPERTY
                || declaration.object == INVERSE_FUNCTIONAL_PROPERTY
            {
                let mut facts = Vec::new();
                for quad in quads {
                    self.check()?;
                    if quad.graph_name == declaration.graph_name && quad.predicate == property {
                        facts.push(quad);
                    }
                }
                for left in &facts {
                    self.check()?;
                    for right in &facts {
                        self.check()?;
                        if declaration.object == FUNCTIONAL_PROPERTY {
                            if self.different(
                                &declaration.graph_name,
                                &left.object,
                                &right.object,
                                quads,
                            )? {
                                self.insert_different(
                                    &declaration.graph_name,
                                    &subject_term(left),
                                    subject_term(right),
                                    "rdf-sem-functional-contrapositive",
                                    &[declaration.clone(), (*left).clone(), (*right).clone()],
                                )?;
                            }
                        } else {
                            let left_subject = subject_term(left);
                            let right_subject = subject_term(right);
                            if self.different(
                                &declaration.graph_name,
                                &left_subject,
                                &right_subject,
                                quads,
                            )? {
                                self.insert_different(
                                    &declaration.graph_name,
                                    &left.object,
                                    right.object.clone(),
                                    "rdf-sem-functional-contrapositive",
                                    &[declaration.clone(), (*left).clone(), (*right).clone()],
                                )?;
                            }
                        }
                    }
                }
            }
        }
        self.check()
    }

    fn semantic_disjoint_properties(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        for declaration in quads {
            self.check()?;
            if declaration.predicate == PROPERTY_DISJOINT_WITH {
                let Some(left) = named_subject(declaration) else {
                    continue;
                };
                let Term::NamedNode(right) = &declaration.object else {
                    continue;
                };
                self.disjoint_property_pair(
                    quads,
                    &declaration.graph_name,
                    &left,
                    right,
                    std::slice::from_ref(declaration),
                )?;
            }
            if declaration.predicate == rdf::TYPE && declaration.object == ALL_DISJOINT_PROPERTIES {
                let Some(members) = self.checked_find(quads, |quad| {
                    quad.graph_name == declaration.graph_name
                        && quad.subject == declaration.subject
                        && (quad.predicate == MEMBERS || quad.predicate == DISTINCT_MEMBERS)
                })?
                else {
                    continue;
                };
                let list = self.list(&members.object, &members.graph_name)?;
                let mut properties = Vec::new();
                for term in list {
                    self.check()?;
                    if let Term::NamedNode(node) = term {
                        properties.push(node);
                    }
                }
                for (index, left) in properties.iter().enumerate() {
                    self.check()?;
                    for right in properties.iter().skip(index + 1) {
                        self.check()?;
                        self.disjoint_property_pair(
                            quads,
                            &declaration.graph_name,
                            left,
                            right,
                            &[declaration.clone(), members.clone()],
                        )?;
                    }
                }
                self.all_different_property_values(quads, declaration, members, &properties)?;
            }
        }
        self.check()
    }

    fn disjoint_property_pair(
        &mut self,
        quads: &[Quad],
        graph: &GraphName,
        left_property: &NamedNode,
        right_property: &NamedNode,
        evidence: &[Quad],
    ) -> Result<(), Owl2RlRdfError> {
        for left in quads {
            self.check()?;
            if &left.graph_name != graph || left.predicate != *left_property {
                continue;
            }
            for right in quads {
                self.check()?;
                if &right.graph_name != graph || right.predicate != *right_property {
                    continue;
                }
                if self.is_equal(graph, &subject_term(left), &subject_term(right)) {
                    self.insert_different(
                        graph,
                        &left.object,
                        right.object.clone(),
                        "rdf-sem-property-disjoint",
                        evidence,
                    )?;
                }
                if self.is_equal(graph, &left.object, &right.object) {
                    self.insert_different(
                        graph,
                        &subject_term(left),
                        subject_term(right),
                        "rdf-sem-property-disjoint",
                        evidence,
                    )?;
                }
            }
        }
        self.check()
    }

    fn all_different_property_values(
        &mut self,
        quads: &[Quad],
        declaration: &Quad,
        members: &Quad,
        properties: &[NamedNode],
    ) -> Result<(), Owl2RlRdfError> {
        for anchor in quads {
            self.check()?;
            let mut by_subject = Vec::new();
            for property in properties {
                self.check()?;
                if let Some(quad) = self.checked_find(quads, |quad| {
                    quad.graph_name == declaration.graph_name
                        && quad.subject == anchor.subject
                        && quad.predicate == *property
                })? {
                    by_subject.push(quad.object.clone());
                }
            }
            if by_subject.len() == properties.len() {
                self.materialize_all_different(
                    &declaration.graph_name,
                    &by_subject,
                    &[declaration.clone(), members.clone()],
                )?;
            }
            let mut by_object = Vec::new();
            for property in properties {
                self.check()?;
                if let Some(quad) = self.checked_find(quads, |quad| {
                    quad.graph_name == declaration.graph_name
                        && quad.predicate == *property
                        && self.is_equal(&quad.graph_name, &quad.object, &anchor.object)
                })? {
                    by_object.push(subject_term(quad));
                }
            }
            if by_object.len() == properties.len() {
                self.materialize_all_different(
                    &declaration.graph_name,
                    &by_object,
                    &[declaration.clone(), members.clone()],
                )?;
            }
        }
        self.check()
    }

    fn insert_different(
        &mut self,
        graph: &GraphName,
        left: &Term,
        right: Term,
        rule: &'static str,
        evidence: &[Quad],
    ) -> Result<(), Owl2RlRdfError> {
        self.check()?;
        if left == &right {
            return Ok(());
        }
        let Some(subject) = term_resource(left) else {
            return Ok(());
        };
        if term_resource(&right).is_some() {
            self.insert(
                Quad::new(subject, DIFFERENT_FROM, right, graph.clone()),
                rule,
                evidence,
            )?;
        }
        self.check()
    }

    pub(super) fn different(
        &self,
        graph: &GraphName,
        left: &Term,
        right: &Term,
        quads: &[Quad],
    ) -> Result<bool, Owl2RlRdfError> {
        self.checked_any(quads, |quad| {
            &quad.graph_name == graph
                && quad.predicate == DIFFERENT_FROM
                && ((subject_term(quad) == *left && quad.object == *right)
                    || (subject_term(quad) == *right && quad.object == *left))
        })
    }

    fn materialize_all_different(
        &mut self,
        graph: &GraphName,
        values: &[Term],
        evidence: &[Quad],
    ) -> Result<(), Owl2RlRdfError> {
        let key = self.witness_key(values)?;
        let declaration = witness("all-different", graph, &key);
        let list = self.materialize_list(graph, "all-different-list", values)?;
        self.insert(
            Quad::new(declaration.clone(), rdf::TYPE, ALL_DIFFERENT, graph.clone()),
            "rdf-sem-all-different-witness",
            evidence,
        )?;
        self.insert(
            Quad::new(declaration, MEMBERS, list, graph.clone()),
            "rdf-sem-all-different-witness",
            evidence,
        )?;
        self.check()
    }

    pub(super) fn materialize_list(
        &mut self,
        graph: &GraphName,
        purpose: &str,
        values: &[Term],
    ) -> Result<BlankNode, Owl2RlRdfError> {
        let key = self.witness_key(values)?;
        for (index, value) in values.iter().enumerate() {
            self.check()?;
            let current = witness(purpose, graph, &format!("{key}|{index}"));
            let next = if index + 1 == values.len() {
                Term::from(rdf::NIL)
            } else {
                Term::from(witness(purpose, graph, &format!("{key}|{}", index + 1)))
            };
            self.insert(
                Quad::new(current.clone(), rdf::TYPE, rdf::LIST, graph.clone()),
                "rdf-sem-list-witness",
                &[],
            )?;
            self.insert(
                Quad::new(current.clone(), rdf::FIRST, value.clone(), graph.clone()),
                "rdf-sem-list-witness",
                &[],
            )?;
            self.insert(
                Quad::new(current, rdf::REST, next, graph.clone()),
                "rdf-sem-list-witness",
                &[],
            )?;
        }
        self.check()?;
        // Index zero uses the same stable node as the returned head.
        if !values.is_empty() {
            let first = witness(purpose, graph, &format!("{key}|0"));
            return Ok(first);
        }
        Ok(witness(purpose, graph, &key))
    }

    fn witness_key(&self, values: &[Term]) -> Result<String, Owl2RlRdfError> {
        self.check()?;
        let mut key = String::new();
        for (index, value) in values.iter().enumerate() {
            self.check()?;
            if index != 0 {
                key.push('|');
            }
            key.push_str(&value.to_string());
        }
        self.check()?;
        Ok(key)
    }
}

fn named_subject(quad: &Quad) -> Option<NamedNode> {
    match &quad.subject {
        oxrdf::NamedOrBlankNode::NamedNode(node) => Some(node.clone()),
        oxrdf::NamedOrBlankNode::BlankNode(_) => None,
    }
}

pub(super) fn witness(purpose: &str, graph: &GraphName, value: &str) -> BlankNode {
    let hash = fnv1a(format!("{purpose}|{graph}|{value}").as_bytes());
    BlankNode::new_unchecked(format!("oxowl{hash:016x}"))
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
    })
}
