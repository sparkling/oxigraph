#![expect(
    clippy::cloned_ref_to_slice_refs,
    clippy::multiple_inherent_impl,
    reason = "owned rule evidence and rule-family separation are intentional"
)]

use super::{
    Rdfs12Error, Runtime, subject_term,
    terms::{predicates_in_quad, term_resource, terms_in_quad},
};
use oxrdf::{
    Quad, Term,
    vocab::{rdf, rdfs},
};

impl Runtime<'_> {
    pub(super) fn apply_patterns(&mut self) -> Result<(), Rdfs12Error> {
        let quads = self.collect(self.all.iter())?;
        for quad in &quads {
            self.check()?;
            self.touch()?;
            #[cfg(feature = "rdf-12")]
            self.apply_triple_term_witnesses(quad)?;
            self.apply_literal_witnesses(quad)?;
            for predicate in predicates_in_quad(quad) {
                self.insert(
                    Quad::new(predicate, rdf::TYPE, rdf::PROPERTY, quad.graph_name.clone()),
                    "rdfD2",
                    &[quad.clone()],
                )?;
            }
            for term in terms_in_quad(quad) {
                if let Some(resource) = term_resource(&term) {
                    self.insert(
                        Quad::new(resource, rdf::TYPE, rdfs::RESOURCE, quad.graph_name.clone()),
                        "rdfs4",
                        &[quad.clone()],
                    )?;
                } else {
                    self.omit_generalized(
                        term,
                        Term::from(rdf::TYPE),
                        Term::from(rdfs::RESOURCE),
                        quad.graph_name.clone(),
                    )?;
                }
            }
            self.apply_unary(quad)?;
        }
        self.apply_binary_patterns(&quads)
    }

    pub(super) fn apply_binary_patterns(&mut self, quads: &[Quad]) -> Result<(), Rdfs12Error> {
        self.check()?;
        for left in quads {
            self.check()?;
            if left.predicate != rdfs::DOMAIN
                && left.predicate != rdfs::RANGE
                && left.predicate != rdfs::SUB_PROPERTY_OF
                && left.predicate != rdfs::SUB_CLASS_OF
            {
                continue;
            }
            for right in quads {
                self.check()?;
                if left.graph_name == right.graph_name {
                    self.touch()?;
                    self.apply_binary(left, right)?;
                }
            }
        }
        self.check()
    }

    fn apply_unary(&mut self, quad: &Quad) -> Result<(), Rdfs12Error> {
        if quad.predicate != rdf::TYPE {
            return Ok(());
        }
        if quad.object == rdf::PROPERTY {
            self.insert(
                Quad::new(
                    quad.subject.clone(),
                    rdfs::SUB_PROPERTY_OF,
                    Term::from(quad.subject.clone()),
                    quad.graph_name.clone(),
                ),
                "rdfs6",
                &[quad.clone()],
            )?;
        }
        if quad.object == rdfs::CLASS {
            for object in [Term::from(rdfs::RESOURCE), Term::from(quad.subject.clone())] {
                let id = if object == rdfs::RESOURCE {
                    "rdfs8"
                } else {
                    "rdfs10"
                };
                self.insert(
                    Quad::new(
                        quad.subject.clone(),
                        rdfs::SUB_CLASS_OF,
                        object,
                        quad.graph_name.clone(),
                    ),
                    id,
                    &[quad.clone()],
                )?;
            }
        }
        if quad.object == rdfs::CONTAINER_MEMBERSHIP_PROPERTY {
            self.insert(
                Quad::new(
                    quad.subject.clone(),
                    rdfs::SUB_PROPERTY_OF,
                    rdfs::MEMBER,
                    quad.graph_name.clone(),
                ),
                "rdfs12",
                &[quad.clone()],
            )?;
        }
        if quad.object == rdfs::DATATYPE {
            self.insert(
                Quad::new(
                    quad.subject.clone(),
                    rdfs::SUB_CLASS_OF,
                    rdfs::LITERAL,
                    quad.graph_name.clone(),
                ),
                "rdfs13",
                &[quad.clone()],
            )?;
        }
        Ok(())
    }

    fn apply_binary(&mut self, schema: &Quad, fact: &Quad) -> Result<(), Rdfs12Error> {
        if schema.predicate == rdfs::DOMAIN && subject_term(schema) == fact.predicate.clone() {
            self.insert(
                Quad::new(
                    fact.subject.clone(),
                    rdf::TYPE,
                    schema.object.clone(),
                    fact.graph_name.clone(),
                ),
                "rdfs2",
                &[schema.clone(), fact.clone()],
            )?;
        }
        if schema.predicate == rdfs::RANGE && subject_term(schema) == fact.predicate.clone() {
            if let Some(object) = term_resource(&fact.object) {
                self.insert(
                    Quad::new(
                        object,
                        rdf::TYPE,
                        schema.object.clone(),
                        fact.graph_name.clone(),
                    ),
                    "rdfs3",
                    &[schema.clone(), fact.clone()],
                )?;
            } else {
                self.omit_generalized(
                    fact.object.clone(),
                    Term::from(rdf::TYPE),
                    schema.object.clone(),
                    fact.graph_name.clone(),
                )?;
            }
        }
        if schema.predicate == rdfs::SUB_PROPERTY_OF {
            if let Term::NamedNode(superproperty) = &schema.object
                && schema.subject == fact.predicate
            {
                self.insert(
                    Quad::new(
                        fact.subject.clone(),
                        superproperty.clone(),
                        fact.object.clone(),
                        fact.graph_name.clone(),
                    ),
                    "rdfs7",
                    &[schema.clone(), fact.clone()],
                )?;
            } else if schema.subject == fact.predicate {
                self.omit_generalized(
                    subject_term(fact),
                    schema.object.clone(),
                    fact.object.clone(),
                    fact.graph_name.clone(),
                )?;
            }
            if fact.predicate == rdfs::SUB_PROPERTY_OF && schema.object == subject_term(fact) {
                self.insert(
                    Quad::new(
                        schema.subject.clone(),
                        rdfs::SUB_PROPERTY_OF,
                        fact.object.clone(),
                        fact.graph_name.clone(),
                    ),
                    "rdfs5",
                    &[schema.clone(), fact.clone()],
                )?;
            }
        }
        if schema.predicate == rdfs::SUB_CLASS_OF {
            if fact.predicate == rdf::TYPE && fact.object == subject_term(schema) {
                self.insert(
                    Quad::new(
                        fact.subject.clone(),
                        rdf::TYPE,
                        schema.object.clone(),
                        fact.graph_name.clone(),
                    ),
                    "rdfs9",
                    &[schema.clone(), fact.clone()],
                )?;
            }
            if fact.predicate == rdfs::SUB_CLASS_OF && schema.object == subject_term(fact) {
                self.insert(
                    Quad::new(
                        schema.subject.clone(),
                        rdfs::SUB_CLASS_OF,
                        fact.object.clone(),
                        fact.graph_name.clone(),
                    ),
                    "rdfs11",
                    &[schema.clone(), fact.clone()],
                )?;
            }
        }
        Ok(())
    }
}
