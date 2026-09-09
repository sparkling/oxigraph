#![expect(
    clippy::multiple_inherent_impl,
    reason = "recursive term handling is kept separate from closure orchestration"
)]

use super::{Rdfs12Error, Runtime};
#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};

pub(super) const WITNESS_PREFIX: &str = "oxrdfs";

pub(super) fn reject_reserved_witness_labels(
    dataset: &Dataset,
    check: impl Fn() -> Result<(), Rdfs12Error>,
) -> Result<(), Rdfs12Error> {
    check()?;
    for quad in dataset {
        check()?;
        for term in terms_in_quad(&quad) {
            check()?;
            if let Term::BlankNode(node) = &term {
                reject_node(node)?;
            }
        }
        if let GraphName::BlankNode(node) = &quad.graph_name {
            reject_node(node)?;
        }
    }
    check()
}

fn reject_node(node: &BlankNode) -> Result<(), Rdfs12Error> {
    if node.as_str().starts_with(WITNESS_PREFIX) {
        Err(Rdfs12Error::ReservedWitnessLabel {
            label: node.as_str().to_owned(),
            prefix: WITNESS_PREFIX,
        })
    } else {
        Ok(())
    }
}

pub(super) fn terms_in_quad(quad: &Quad) -> Vec<Term> {
    let mut terms = vec![
        Term::from(quad.subject.clone()),
        Term::from(quad.predicate.clone()),
    ];
    collect_terms(&quad.object, &mut terms);
    terms
}

fn collect_terms(term: &Term, output: &mut Vec<Term>) {
    output.push(term.clone());
    #[cfg(feature = "rdf-12")]
    if let Term::Triple(triple) = term {
        output.push(Term::from(triple.subject.clone()));
        output.push(Term::from(triple.predicate.clone()));
        collect_terms(&triple.object, output);
    }
}

pub(super) fn predicates_in_quad(quad: &Quad) -> Vec<NamedNode> {
    let mut predicates = vec![quad.predicate.clone()];
    collect_predicates(&quad.object, &mut predicates);
    predicates
}

#[cfg(feature = "rdf-12")]
fn collect_predicates(term: &Term, output: &mut Vec<NamedNode>) {
    if let Term::Triple(triple) = term {
        output.push(triple.predicate.clone());
        collect_predicates(&triple.object, output);
    }
}

#[cfg(not(feature = "rdf-12"))]
fn collect_predicates(_term: &Term, _output: &mut Vec<NamedNode>) {}

pub(super) fn term_resource(term: &Term) -> Option<NamedOrBlankNode> {
    match term {
        Term::NamedNode(node) => Some(node.clone().into()),
        Term::BlankNode(node) => Some(node.clone().into()),
        Term::Literal(_) => None,
        #[cfg(feature = "rdf-12")]
        Term::Triple(_) => None,
    }
}

pub(super) fn contains_matching_literal(
    term: &Term,
    predicate: impl Copy + Fn(&Literal) -> bool,
) -> bool {
    match term {
        Term::Literal(literal) => predicate(literal),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => contains_matching_literal(&triple.object, predicate),
        Term::NamedNode(_) | Term::BlankNode(_) => false,
    }
}

pub(super) fn literal_replacements(
    term: &Term,
    graph: &GraphName,
    recognizes: impl Copy + Fn(&NamedNode) -> bool,
) -> Vec<(Term, BlankNode, NamedNode)> {
    match term {
        Term::Literal(literal) if recognizes(literal.datatype()) => {
            let witness = Runtime::witness("rdfD1", graph, &literal.to_string());
            vec![(
                Term::from(witness.clone()),
                witness,
                literal.datatype().clone(),
            )]
        }
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => literal_replacements(&triple.object, graph, recognizes)
            .into_iter()
            .map(|(object, witness, datatype)| {
                (
                    Term::from(Triple::new(
                        triple.subject.clone(),
                        triple.predicate.clone(),
                        object,
                    )),
                    witness,
                    datatype,
                )
            })
            .collect(),
        Term::NamedNode(_) | Term::BlankNode(_) | Term::Literal(_) => Vec::new(),
    }
}

#[cfg(feature = "rdf-12")]
pub(super) fn triple_term_replacements(term: &Term, graph: &GraphName) -> Vec<(Term, BlankNode)> {
    let Term::Triple(triple) = term else {
        return Vec::new();
    };
    let witness = Runtime::witness("rdfs14", graph, &triple.to_string());
    let mut replacements = vec![(Term::from(witness.clone()), witness)];
    replacements.extend(
        triple_term_replacements(&triple.object, graph)
            .into_iter()
            .map(|(object, witness)| {
                (
                    Term::from(Triple::new(
                        triple.subject.clone(),
                        triple.predicate.clone(),
                        object,
                    )),
                    witness,
                )
            }),
    );
    replacements
}

#[cfg(feature = "rdf-12")]
impl Runtime<'_> {
    pub(super) fn apply_triple_term_witnesses(&mut self, quad: &Quad) -> Result<(), Rdfs12Error> {
        for (object, witness) in triple_term_replacements(&quad.object, &quad.graph_name) {
            self.insert(
                Quad::new(
                    quad.subject.clone(),
                    quad.predicate.clone(),
                    object,
                    quad.graph_name.clone(),
                ),
                "rdfs14",
                std::slice::from_ref(quad),
            )?;
            self.insert(
                Quad::new(
                    witness,
                    oxrdf::vocab::rdf::TYPE,
                    oxrdf::vocab::rdfs::PROPOSITION,
                    quad.graph_name.clone(),
                ),
                "rdfs14",
                std::slice::from_ref(quad),
            )?;
        }
        Ok(())
    }
}

impl Runtime<'_> {
    pub(super) fn witness(purpose: &str, graph: &GraphName, value: &str) -> BlankNode {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut label = String::from(WITNESS_PREFIX);
        for component in [purpose, &graph.to_string(), value] {
            label.push('z');
            for byte in component.as_bytes() {
                label.push(char::from(HEX[usize::from(byte >> 4)]));
                label.push(char::from(HEX[usize::from(byte & 0x0f)]));
            }
        }
        BlankNode::new_unchecked(label)
    }
}
