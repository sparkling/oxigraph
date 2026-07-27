use oxrdf::{NamedNode, Term};
use spareval::QuerySolution;

#[derive(Clone, Debug)]
pub(crate) struct ResultAnnotation {
    property: NamedNode,
    variable: Option<String>,
    defaults: Vec<Term>,
}

impl ResultAnnotation {
    pub(crate) fn new(property: NamedNode, variable: Option<String>, defaults: Vec<Term>) -> Self {
        Self {
            property,
            variable,
            defaults,
        }
    }

    pub(crate) fn append(
        &self,
        solution: Option<&QuerySolution>,
        output: &mut Vec<(NamedNode, Term)>,
    ) {
        let binding = self
            .variable
            .as_deref()
            .and_then(|variable| {
                let solution = solution?;
                solution.get(variable)
            })
            .cloned();
        if let Some(binding) = binding {
            output.push((self.property.clone(), binding));
        } else {
            output.extend(
                self.defaults
                    .iter()
                    .cloned()
                    .map(|value| (self.property.clone(), value)),
            );
        }
    }
}
