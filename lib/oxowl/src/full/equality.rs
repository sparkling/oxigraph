#![expect(
    clippy::cloned_ref_to_slice_refs,
    clippy::multiple_inherent_impl,
    reason = "rule evidence is owned and the runtime is split by rule family"
)]

use super::{Owl2RlRdfError, Runtime, subject_term, term_resource};
use crate::vocabulary::SAME_AS;
use oxrdf::{Quad, Term};

impl Runtime<'_> {
    pub(super) fn apply_equality(&mut self) -> Result<(), Owl2RlRdfError> {
        let quads = self.checked_collect(self.all.iter())?;
        for quad in &quads {
            self.check()?;
            self.touch()?;
            let subject = subject_term(quad);
            let predicate = Term::from(quad.predicate.clone());
            self.add_equality(
                &quad.graph_name,
                subject.clone(),
                subject,
                "eq-ref",
                &[quad.clone()],
            )?;
            self.add_equality(
                &quad.graph_name,
                predicate.clone(),
                predicate,
                "eq-ref",
                &[quad.clone()],
            )?;
            self.add_equality(
                &quad.graph_name,
                quad.object.clone(),
                quad.object.clone(),
                "eq-ref",
                &[quad.clone()],
            )?;
            if quad.predicate == SAME_AS {
                self.add_equality(
                    &quad.graph_name,
                    subject_term(quad),
                    quad.object.clone(),
                    "eq-input",
                    &[quad.clone()],
                )?;
            }
        }
        let equalities = self.checked_collect(self.equalities.iter().cloned())?;
        for (graph, left, right) in &equalities {
            self.check()?;
            self.touch()?;
            self.add_equality(graph, right.clone(), left.clone(), "eq-sym", &[])?;
        }
        for (left_graph, left, middle) in &equalities {
            self.check()?;
            for (right_graph, candidate, right) in &equalities {
                self.check()?;
                if left_graph == right_graph && middle == candidate {
                    self.touch()?;
                    self.add_equality(left_graph, left.clone(), right.clone(), "eq-trans", &[])?;
                }
            }
        }
        self.apply_replacement(&quads)
    }

    fn apply_replacement(&mut self, quads: &[Quad]) -> Result<(), Owl2RlRdfError> {
        let equalities = self.checked_collect(self.equalities.iter().cloned())?;
        for quad in quads {
            self.check()?;
            for (graph, left, right) in &equalities {
                self.check()?;
                if graph != &quad.graph_name {
                    continue;
                }
                if left == &subject_term(quad)
                    && let Some(subject) = term_resource(right)
                {
                    self.touch()?;
                    self.insert(
                        Quad::new(
                            subject,
                            quad.predicate.clone(),
                            quad.object.clone(),
                            quad.graph_name.clone(),
                        ),
                        "eq-rep-s",
                        &[quad.clone()],
                    )?;
                }
                if left == &Term::from(quad.predicate.clone())
                    && let Term::NamedNode(predicate) = right
                {
                    self.touch()?;
                    self.insert(
                        Quad::new(
                            quad.subject.clone(),
                            predicate.clone(),
                            quad.object.clone(),
                            quad.graph_name.clone(),
                        ),
                        "eq-rep-p",
                        &[quad.clone()],
                    )?;
                }
                if left == &quad.object {
                    self.touch()?;
                    self.insert(
                        Quad::new(
                            quad.subject.clone(),
                            quad.predicate.clone(),
                            right.clone(),
                            quad.graph_name.clone(),
                        ),
                        "eq-rep-o",
                        &[quad.clone()],
                    )?;
                }
            }
        }
        self.check()
    }
}
