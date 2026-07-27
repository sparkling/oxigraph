use super::native::Solution;
use crate::srl::{
    SrlAnnotation, SrlConstant, SrlError, SrlNode, SrlPredicate, SrlProperty, SrlTriple,
};
use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term, Triple};
use std::collections::{BTreeMap, BTreeSet};

const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const RDF_REIFIES: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";

pub(super) struct HeadBuilder {
    blanks: BlankAllocator,
    output: Vec<Quad>,
}

impl HeadBuilder {
    pub(super) fn new(graph: &Dataset) -> Self {
        Self {
            blanks: BlankAllocator::new(graph),
            output: Vec::new(),
        }
    }

    pub(super) fn instantiate(
        &mut self,
        rule_index: usize,
        solution_index: usize,
        templates: &[SrlTriple],
        solution: &Solution,
    ) -> Result<Vec<Quad>, SrlError> {
        self.output.clear();
        let scope = format!("r{rule_index}:s{solution_index}");
        for (index, template) in templates.iter().enumerate() {
            self.statement(template, solution, &format!("{scope}:h{index}"))?;
        }
        Ok(std::mem::take(&mut self.output))
    }

    fn statement(
        &mut self,
        triple: &SrlTriple,
        solution: &Solution,
        scope: &str,
    ) -> Result<Triple, SrlError> {
        let subject = as_subject(self.node(&triple.subject, solution, &format!("{scope}:s"))?)?;
        self.emit_statement(subject, &triple.predicate, &triple.object, solution, scope)
    }

    fn emit_statement(
        &mut self,
        subject: NamedOrBlankNode,
        predicate: &SrlPredicate,
        object: &SrlNode,
        solution: &Solution,
        scope: &str,
    ) -> Result<Triple, SrlError> {
        let predicate = as_predicate(self.predicate(predicate, solution, scope)?)?;
        let (object, annotation_id, annotations) = match object {
            SrlNode::Annotated {
                id,
                value,
                annotations,
            } => (value.as_ref(), Some(*id), annotations.as_slice()),
            value => (value, None, &[][..]),
        };
        let object = self.node(object, solution, &format!("{scope}:o"))?;
        let triple = Triple::new(subject, predicate, object);
        self.output
            .push(triple.clone().in_graph(GraphName::DefaultGraph));
        if let Some(annotation_id) = annotation_id {
            self.annotations(
                &triple,
                annotation_id,
                annotations,
                solution,
                &format!("{scope}:a"),
            )?;
        }
        Ok(triple)
    }

    fn annotations(
        &mut self,
        triple: &Triple,
        annotation_id: u64,
        annotations: &[SrlAnnotation],
        solution: &Solution,
        scope: &str,
    ) -> Result<(), SrlError> {
        for (index, annotation) in annotations.iter().enumerate() {
            let reifier = if let Some(reifier) = &annotation.reifier {
                self.node(reifier, solution, &format!("{scope}:{index}:r"))?
            } else {
                self.blank(&allocation_key(
                    scope,
                    &format!("annotation:{annotation_id}:{index}"),
                ))?
                .into()
            };
            let reifier = as_subject(reifier)?;
            self.output.push(Quad::new(
                reifier.clone(),
                NamedNode::new_unchecked(RDF_REIFIES),
                triple_term(triple.clone())?,
                GraphName::DefaultGraph,
            ));
            self.properties(
                &reifier,
                &annotation.properties,
                solution,
                &format!("{scope}:{index}:p"),
            )?;
        }
        Ok(())
    }

    fn properties(
        &mut self,
        subject: &NamedOrBlankNode,
        properties: &[SrlProperty],
        solution: &Solution,
        scope: &str,
    ) -> Result<(), SrlError> {
        for (property_index, property) in properties.iter().enumerate() {
            for (object_index, object) in property.objects.iter().enumerate() {
                self.emit_statement(
                    subject.clone(),
                    &property.predicate,
                    object,
                    solution,
                    &format!("{scope}:{property_index}:{object_index}"),
                )?;
            }
        }
        Ok(())
    }

    fn node(&mut self, node: &SrlNode, solution: &Solution, scope: &str) -> Result<Term, SrlError> {
        match node {
            SrlNode::Variable(variable) => solution.get(variable).cloned().ok_or_else(|| {
                SrlError::WellFormed(format!(
                    "head variable `?{variable}` has no solution binding"
                ))
            }),
            SrlNode::Constant(SrlConstant::BlankNode(label)) => Ok(self
                .blank(&allocation_key(scope, &format!("label:{label}")))?
                .into()),
            SrlNode::GeneratedBlankNode(id) => Ok(self
                .blank(&allocation_key(scope, &format!("generated:{id}")))?
                .into()),
            SrlNode::Constant(_) => node.as_term(),
            SrlNode::PropertyList { id, properties } => {
                let node = self.blank(&allocation_key(scope, &format!("property:{id}")))?;
                self.properties(
                    &node.clone().into(),
                    properties,
                    solution,
                    &format!("{scope}:property:{id}"),
                )?;
                Ok(node.into())
            }
            SrlNode::Collection { id, values } => self.collection(*id, values, solution, scope),
            SrlNode::TripleTerm(triple) => {
                Ok(triple_term(self.core_triple(triple, solution, scope)?)?)
            }
            SrlNode::Reified {
                id,
                triple,
                reifier,
            } => {
                let triple = self.core_triple(triple, solution, &format!("{scope}:t"))?;
                let reifier = if let Some(reifier) = reifier {
                    self.node(reifier, solution, &format!("{scope}:r"))?
                } else {
                    self.blank(&allocation_key(scope, &format!("reified:{id}")))?
                        .into()
                };
                let reifier = as_subject(reifier)?;
                self.output.push(Quad::new(
                    reifier.clone(),
                    NamedNode::new_unchecked(RDF_REIFIES),
                    triple_term(triple)?,
                    GraphName::DefaultGraph,
                ));
                Ok(Term::from(reifier))
            }
            SrlNode::Annotated { .. } => Err(SrlError::Unsupported(
                "an annotation without a containing SRL triple template".to_owned(),
            )),
        }
    }

    fn predicate(
        &mut self,
        predicate: &SrlPredicate,
        solution: &Solution,
        scope: &str,
    ) -> Result<Term, SrlError> {
        match predicate {
            SrlPredicate::Node(node) => self.node(node, solution, &format!("{scope}:p")),
            SrlPredicate::Path(_) => Err(SrlError::WellFormed(
                "property paths are not allowed in SRL rule heads".to_owned(),
            )),
        }
    }

    fn core_triple(
        &mut self,
        triple: &SrlTriple,
        solution: &Solution,
        scope: &str,
    ) -> Result<Triple, SrlError> {
        if matches!(triple.object, SrlNode::Annotated { .. }) {
            return Err(SrlError::Unsupported(
                "an annotated triple nested inside an RDF triple term".to_owned(),
            ));
        }
        Ok(Triple::new(
            as_subject(self.node(&triple.subject, solution, &format!("{scope}:s"))?)?,
            as_predicate(self.predicate(&triple.predicate, solution, scope)?)?,
            self.node(&triple.object, solution, &format!("{scope}:o"))?,
        ))
    }

    fn collection(
        &mut self,
        id: u64,
        values: &[SrlNode],
        solution: &Solution,
        scope: &str,
    ) -> Result<Term, SrlError> {
        if values.is_empty() {
            return Ok(NamedNode::new_unchecked(RDF_NIL).into());
        }
        let nodes = (0..values.len())
            .map(|index| self.blank(&allocation_key(scope, &format!("collection:{id}:{index}"))))
            .collect::<Result<Vec<_>, _>>()?;
        for (index, value) in values.iter().enumerate() {
            let first = self.node(
                value,
                solution,
                &format!("{scope}:collection:{id}:{index}:v"),
            )?;
            self.output.push(Quad::new(
                nodes[index].clone(),
                NamedNode::new_unchecked(RDF_FIRST),
                first,
                GraphName::DefaultGraph,
            ));
            let rest: Term = if index + 1 == nodes.len() {
                NamedNode::new_unchecked(RDF_NIL).into()
            } else {
                nodes[index + 1].clone().into()
            };
            self.output.push(Quad::new(
                nodes[index].clone(),
                NamedNode::new_unchecked(RDF_REST),
                rest,
                GraphName::DefaultGraph,
            ));
        }
        Ok(nodes[0].clone().into())
    }

    fn blank(&mut self, key: &str) -> Result<BlankNode, SrlError> {
        self.blanks.for_key(key)
    }
}

fn allocation_key(scope: &str, suffix: &str) -> String {
    let root = scope.split_once(":h").map_or(scope, |(root, _)| root);
    format!("{root}:{suffix}")
}

fn as_subject(term: Term) -> Result<NamedOrBlankNode, SrlError> {
    term.try_into().map_err(|_| {
        SrlError::WellFormed("an SRL template subject is not an IRI or blank node".to_owned())
    })
}

fn as_predicate(term: Term) -> Result<NamedNode, SrlError> {
    term.try_into()
        .map_err(|_| SrlError::WellFormed("an SRL template predicate is not an IRI".to_owned()))
}

#[cfg(feature = "rdf-12")]
#[expect(
    clippy::unnecessary_wraps,
    reason = "the matching non-rdf-12 implementation returns an explicit capability error"
)]
fn triple_term(triple: Triple) -> Result<Term, SrlError> {
    Ok(Term::Triple(Box::new(triple)))
}

#[cfg(not(feature = "rdf-12"))]
fn triple_term(_triple: Triple) -> Result<Term, SrlError> {
    Err(SrlError::Unsupported(
        "SRL triple terms and reification require the `rdf-12` crate feature".to_owned(),
    ))
}

struct BlankAllocator {
    by_key: BTreeMap<String, BlankNode>,
    used: BTreeSet<String>,
    next: usize,
}

impl BlankAllocator {
    fn new(graph: &Dataset) -> Self {
        let mut used = BTreeSet::new();
        for quad in graph {
            collect_subject(&quad.subject, &mut used);
            collect_term(&quad.object, &mut used);
        }
        Self {
            by_key: BTreeMap::new(),
            used,
            next: 0,
        }
    }

    fn for_key(&mut self, key: &str) -> Result<BlankNode, SrlError> {
        if let Some(node) = self.by_key.get(key) {
            return Ok(node.clone());
        }
        loop {
            let candidate = format!("oxshacl-srl-head-{}", self.next);
            self.next = self.next.saturating_add(1);
            if self.used.insert(candidate.clone()) {
                let node = BlankNode::new(candidate)
                    .map_err(|error| SrlError::Unsupported(error.to_string()))?;
                self.by_key.insert(key.to_owned(), node.clone());
                return Ok(node);
            }
        }
    }
}

fn collect_subject(subject: &NamedOrBlankNode, output: &mut BTreeSet<String>) {
    if let NamedOrBlankNode::BlankNode(node) = subject {
        output.insert(node.as_str().to_owned());
    }
}

fn collect_term(term: &Term, output: &mut BTreeSet<String>) {
    if let Term::BlankNode(node) = term {
        output.insert(node.as_str().to_owned());
    }
    #[cfg(feature = "rdf-12")]
    if let Term::Triple(triple) = term {
        collect_subject(&triple.subject, output);
        collect_term(&triple.object, output);
    }
}
