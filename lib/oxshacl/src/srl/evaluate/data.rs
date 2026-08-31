use crate::srl::{SrlConstant, SrlError, SrlItem, SrlNode, SrlPredicate, SrlRuleSet, SrlTriple};
use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn inline_data(rule_set: &SrlRuleSet, external: &Dataset) -> Result<Dataset, SrlError> {
    let mut allocator = BlankAllocator::new(external);
    let mut output = Dataset::new();
    for (item, document_scope) in rule_set.items.iter().zip(&rule_set.item_scopes) {
        if let SrlItem::Data(triples) = item {
            for triple in triples {
                output.insert(ground_quad(triple, *document_scope, &mut allocator)?);
            }
        }
    }
    Ok(output)
}

fn ground_quad(
    triple: &SrlTriple,
    document_scope: usize,
    allocator: &mut BlankAllocator,
) -> Result<Quad, SrlError> {
    let subject = as_subject(ground_term(&triple.subject, document_scope, allocator)?)?;
    let predicate = match &triple.predicate {
        SrlPredicate::Node(SrlNode::Constant(SrlConstant::Iri(iri))) => {
            NamedNode::new_unchecked(iri.clone())
        }
        _ => {
            return Err(SrlError::Unsupported(
                "non-ground predicate in DATA block".to_owned(),
            ));
        }
    };
    Ok(Quad::new(
        subject,
        predicate,
        ground_term(&triple.object, document_scope, allocator)?,
        GraphName::DefaultGraph,
    ))
}

fn ground_term(
    node: &SrlNode,
    document_scope: usize,
    allocator: &mut BlankAllocator,
) -> Result<Term, SrlError> {
    match node {
        SrlNode::Constant(SrlConstant::BlankNode(label)) => Ok(Term::from(
            allocator.for_key(format!("{document_scope}:label:{label}"))?,
        )),
        SrlNode::GeneratedBlankNode(id) => Ok(Term::from(
            allocator.for_key(format!("{document_scope}:generated:{id}"))?,
        )),
        SrlNode::Constant(_) => node.as_term(),
        _ => Err(SrlError::Unsupported(
            "collection, property-list, annotation, or reified DATA lowering".to_owned(),
        )),
    }
}

fn as_subject(term: Term) -> Result<NamedOrBlankNode, SrlError> {
    if matches!(&term, Term::Literal(_)) {
        return Err(SrlError::Unsupported(
            "generalized RDF subjects in SRL DATA evaluation".to_owned(),
        ));
    }
    #[cfg(feature = "rdf-12")]
    if matches!(&term, Term::Triple(_)) {
        return Err(SrlError::Unsupported(
            "RDF triple-term subjects in SRL DATA evaluation".to_owned(),
        ));
    }
    NamedOrBlankNode::try_from(term).map_err(|_| {
        SrlError::Unsupported("RDF triple-term subjects in SRL DATA evaluation".to_owned())
    })
}

struct BlankAllocator {
    by_source: BTreeMap<String, BlankNode>,
    used: BTreeSet<String>,
    next: usize,
}

impl BlankAllocator {
    fn new(external: &Dataset) -> Self {
        let mut used = BTreeSet::new();
        for quad in external {
            if let NamedOrBlankNode::BlankNode(node) = &quad.subject {
                used.insert(node.as_str().to_owned());
            }
            collect_term_blanks(&quad.object, &mut used);
            if let GraphName::BlankNode(node) = &quad.graph_name {
                used.insert(node.as_str().to_owned());
            }
        }
        Self {
            by_source: BTreeMap::new(),
            used,
            next: 0,
        }
    }

    fn for_key(&mut self, key: String) -> Result<BlankNode, SrlError> {
        if let Some(node) = self.by_source.get(&key) {
            return Ok(node.clone());
        }
        loop {
            let candidate = format!("oxshacl-srl-inline-{}", self.next);
            self.next += 1;
            if self.used.insert(candidate.clone()) {
                let node = BlankNode::new(candidate)
                    .map_err(|error| SrlError::Unsupported(error.to_string()))?;
                self.by_source.insert(key, node.clone());
                return Ok(node);
            }
        }
    }
}

fn collect_term_blanks(term: &Term, output: &mut BTreeSet<String>) {
    if let Term::BlankNode(node) = term {
        output.insert(node.as_str().to_owned());
    }
    #[cfg(feature = "rdf-12")]
    if let Term::Triple(triple) = term {
        if let NamedOrBlankNode::BlankNode(node) = &triple.subject {
            output.insert(node.as_str().to_owned());
        }
        collect_term_blanks(&triple.object, output);
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "rdf-12")]
    use super::*;
    #[cfg(feature = "rdf-12")]
    use oxrdf::{Literal, Triple};

    #[cfg(feature = "rdf-12")]
    #[test]
    fn triple_and_literal_subject_failures_remain_distinct() {
        let triple = Term::Triple(Box::new(Triple::new(
            NamedNode::new_unchecked("urn:subject"),
            NamedNode::new_unchecked("urn:predicate"),
            NamedNode::new_unchecked("urn:object"),
        )));
        assert!(matches!(
            as_subject(triple),
            Err(SrlError::Unsupported(reason))
                if reason == "RDF triple-term subjects in SRL DATA evaluation"
        ));
        assert!(matches!(
            as_subject(Literal::from("value").into()),
            Err(SrlError::Unsupported(reason))
                if reason == "generalized RDF subjects in SRL DATA evaluation"
        ));
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn nested_triple_term_blank_nodes_are_reserved() {
        let term = Term::Triple(Box::new(Triple::new(
            BlankNode::new_unchecked("outer"),
            NamedNode::new_unchecked("urn:predicate"),
            Term::Triple(Box::new(Triple::new(
                NamedNode::new_unchecked("urn:subject"),
                NamedNode::new_unchecked("urn:nested-predicate"),
                BlankNode::new_unchecked("inner"),
            ))),
        )));
        let mut blank_nodes = BTreeSet::new();
        collect_term_blanks(&term, &mut blank_nodes);
        assert_eq!(
            blank_nodes,
            BTreeSet::from(["inner".to_owned(), "outer".to_owned()])
        );
    }
}
