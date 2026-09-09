#![expect(
    clippy::multiple_inherent_impl,
    reason = "the bounded runtime is split by rule family"
)]

use super::{Owl2RlRdfError, Owl2RlRdfInputError, Runtime, subject_term, term_resource};
use oxrdf::{GraphName, Term, vocab::rdf};
use std::collections::HashSet;

impl Runtime<'_> {
    pub(super) fn list(
        &mut self,
        head: &Term,
        graph: &GraphName,
    ) -> Result<Vec<Term>, Owl2RlRdfError> {
        self.check()?;
        if head == &Term::from(rdf::NIL) {
            return Ok(Vec::new());
        }
        let original = head.clone();
        let mut current = head.clone();
        let mut visited = HashSet::new();
        let mut output = Vec::new();
        loop {
            self.check()?;
            if output.len() >= self.options.max_list_length {
                return Err(Owl2RlRdfInputError::ListLength {
                    head: original,
                    limit: self.options.max_list_length,
                }
                .into());
            }
            if !visited.insert(current.clone()) {
                return Err(malformed(original, graph));
            }
            let mut first = Vec::new();
            let mut rest = Vec::new();
            for quad in &self.all {
                self.check()?;
                if &quad.graph_name != graph || subject_term(&quad) != current {
                    continue;
                }
                if quad.predicate == rdf::FIRST {
                    first.push(quad.object);
                } else if quad.predicate == rdf::REST {
                    rest.push(quad.object);
                }
            }
            deduplicate_equal(self, graph, &mut first)?;
            deduplicate_equal(self, graph, &mut rest)?;
            if first.len() != 1 || rest.len() != 1 {
                return Err(malformed(original, graph));
            }
            output.push(first.remove(0));
            let next = rest.remove(0);
            if next == rdf::NIL {
                self.check()?;
                return Ok(output);
            }
            if term_resource(&next).is_none() {
                return Err(malformed(original, graph));
            }
            current = next;
        }
    }
}

fn deduplicate_equal(
    runtime: &Runtime<'_>,
    graph: &GraphName,
    values: &mut Vec<Term>,
) -> Result<(), Owl2RlRdfError> {
    runtime.check()?;
    let mut unique = Vec::new();
    for value in values.drain(..) {
        runtime.check()?;
        if !runtime.checked_any(unique.iter(), |item| runtime.is_equal(graph, item, &value))? {
            unique.push(value);
        }
    }
    runtime.check()?;
    *values = unique;
    Ok(())
}

fn malformed(head: Term, graph_name: &GraphName) -> Owl2RlRdfError {
    Owl2RlRdfInputError::MalformedList {
        head,
        graph_name: graph_name.clone(),
    }
    .into()
}
