use super::native::{ExecutionGuard, Solution};
use crate::srl::{
    SrlAnnotation, SrlConstant, SrlError, SrlNode, SrlPredicate, SrlProperty, SrlTriple,
};
use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term, Triple};
use std::collections::{BTreeMap, BTreeSet};

const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const RDF_REIFIES: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";

pub(super) type QuadEmitter<'a> =
    dyn FnMut(Quad, &mut ExecutionGuard<'_>) -> Result<(), SrlError> + 'a;

pub(super) struct HeadBuilder {
    blanks: BlankAllocator,
}

impl HeadBuilder {
    pub(super) fn new(graph: &Dataset) -> Self {
        Self {
            blanks: BlankAllocator::new(graph),
        }
    }

    pub(super) fn instantiate(
        &mut self,
        rule_index: usize,
        solution_index: usize,
        templates: &[SrlTriple],
        solution: &Solution,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<(), SrlError> {
        let construction = ConstructionScope::Head(format!("r{rule_index}:s{solution_index}"));
        for template in templates {
            self.statement(template, solution, &construction, 0, guard, emit)?;
        }
        Ok(())
    }

    pub(super) fn materialize_data(
        &mut self,
        document_scope: usize,
        triple: &SrlTriple,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<(), SrlError> {
        self.statement(
            triple,
            &Solution::new(),
            &ConstructionScope::Data(document_scope),
            0,
            guard,
            emit,
        )?;
        Ok(())
    }

    fn statement(
        &mut self,
        triple: &SrlTriple,
        solution: &Solution,
        construction: &ConstructionScope,
        depth: usize,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<Triple, SrlError> {
        guard.check()?;
        let subject = as_subject(
            self.node(&triple.subject, solution, construction, depth, guard, emit)?,
            construction,
        )?;
        self.emit_statement(
            subject,
            &triple.predicate,
            &triple.object,
            solution,
            construction,
            depth,
            guard,
            emit,
        )
    }

    fn emit_statement(
        &mut self,
        subject: NamedOrBlankNode,
        predicate: &SrlPredicate,
        object: &SrlNode,
        solution: &Solution,
        construction: &ConstructionScope,
        depth: usize,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<Triple, SrlError> {
        let predicate = as_predicate(
            self.predicate(predicate, solution, construction, depth, guard, emit)?,
            construction,
        )?;
        let (object, annotation_id, annotations) = match object {
            SrlNode::Annotated {
                id,
                value,
                annotations,
            } => (value.as_ref(), Some(*id), annotations.as_slice()),
            value => (value, None, &[][..]),
        };
        if annotation_id.is_some() {
            guard.depth(depth.saturating_add(1))?;
        }
        let object = self.node(object, solution, construction, depth, guard, emit)?;
        let triple = Triple::new(subject, predicate, object);
        emit(triple.clone().in_graph(GraphName::DefaultGraph), guard)?;
        if let Some(annotation_id) = annotation_id {
            self.annotations(
                &triple,
                annotation_id,
                annotations,
                solution,
                construction,
                depth.saturating_add(1),
                guard,
                emit,
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
        construction: &ConstructionScope,
        depth: usize,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<(), SrlError> {
        guard.depth(depth)?;
        for (index, annotation) in annotations.iter().enumerate() {
            let reifier = if let Some(reifier) = &annotation.reifier {
                self.node(reifier, solution, construction, depth, guard, emit)?
            } else {
                self.blank(
                    construction.key(&format!("annotation:{annotation_id}:{index}")),
                    guard,
                )?
                .into()
            };
            let reifier = as_subject(reifier, construction)?;
            emit(
                Quad::new(
                    reifier.clone(),
                    NamedNode::new_unchecked(RDF_REIFIES),
                    triple_term(triple.clone())?,
                    GraphName::DefaultGraph,
                ),
                guard,
            )?;
            self.properties(
                &reifier,
                &annotation.properties,
                solution,
                construction,
                depth,
                guard,
                emit,
            )?;
        }
        Ok(())
    }

    fn properties(
        &mut self,
        subject: &NamedOrBlankNode,
        properties: &[SrlProperty],
        solution: &Solution,
        construction: &ConstructionScope,
        depth: usize,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<(), SrlError> {
        guard.depth(depth)?;
        for property in properties {
            for object in &property.objects {
                self.emit_statement(
                    subject.clone(),
                    &property.predicate,
                    object,
                    solution,
                    construction,
                    depth,
                    guard,
                    emit,
                )?;
            }
        }
        Ok(())
    }

    fn node(
        &mut self,
        node: &SrlNode,
        solution: &Solution,
        construction: &ConstructionScope,
        depth: usize,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<Term, SrlError> {
        guard.depth(depth)?;
        match node {
            SrlNode::Variable(variable) => solution.get(variable).cloned().ok_or_else(|| {
                if construction.is_data() {
                    SrlError::Unsupported("variable in DATA block".to_owned())
                } else {
                    SrlError::WellFormed(format!(
                        "head variable `?{variable}` has no solution binding"
                    ))
                }
            }),
            SrlNode::Constant(SrlConstant::BlankNode(label)) => Ok(self
                .blank(construction.key(&format!("label:{label}")), guard)?
                .into()),
            SrlNode::GeneratedBlankNode(id) => Ok(self
                .blank(construction.key(&format!("generated:{id}")), guard)?
                .into()),
            SrlNode::Constant(_) => node.as_term(),
            SrlNode::PropertyList { id, properties } => {
                guard.depth(depth.saturating_add(1))?;
                let node = self.blank(construction.key(&format!("property:{id}")), guard)?;
                self.properties(
                    &node.clone().into(),
                    properties,
                    solution,
                    construction,
                    depth.saturating_add(1),
                    guard,
                    emit,
                )?;
                Ok(node.into())
            }
            SrlNode::Collection { id, values } => {
                self.collection(*id, values, solution, construction, depth, guard, emit)
            }
            SrlNode::TripleTerm(triple) => Ok(triple_term(self.core_triple(
                triple,
                solution,
                construction,
                depth.saturating_add(1),
                guard,
                emit,
            )?)?),
            SrlNode::Reified {
                id,
                triple,
                reifier,
            } => {
                let nested_depth = depth.saturating_add(1);
                let triple =
                    self.core_triple(triple, solution, construction, nested_depth, guard, emit)?;
                let reifier = if let Some(reifier) = reifier {
                    self.node(reifier, solution, construction, nested_depth, guard, emit)?
                } else {
                    self.blank(construction.key(&format!("reified:{id}")), guard)?
                        .into()
                };
                let reifier = as_subject(reifier, construction)?;
                emit(
                    Quad::new(
                        reifier.clone(),
                        NamedNode::new_unchecked(RDF_REIFIES),
                        triple_term(triple)?,
                        GraphName::DefaultGraph,
                    ),
                    guard,
                )?;
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
        construction: &ConstructionScope,
        depth: usize,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<Term, SrlError> {
        match predicate {
            SrlPredicate::Node(node) => self.node(node, solution, construction, depth, guard, emit),
            SrlPredicate::Path(_) if construction.is_data() => Err(SrlError::Unsupported(
                "non-ground predicate in DATA block".to_owned(),
            )),
            SrlPredicate::Path(_) => Err(SrlError::WellFormed(
                "property paths are not allowed in SRL rule heads".to_owned(),
            )),
        }
    }

    fn core_triple(
        &mut self,
        triple: &SrlTriple,
        solution: &Solution,
        construction: &ConstructionScope,
        depth: usize,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<Triple, SrlError> {
        guard.depth(depth)?;
        if matches!(triple.object, SrlNode::Annotated { .. }) {
            return Err(SrlError::Unsupported(
                "an annotated triple nested inside an RDF triple term".to_owned(),
            ));
        }
        Ok(Triple::new(
            as_subject(
                self.node(&triple.subject, solution, construction, depth, guard, emit)?,
                construction,
            )?,
            as_predicate(
                self.predicate(
                    &triple.predicate,
                    solution,
                    construction,
                    depth,
                    guard,
                    emit,
                )?,
                construction,
            )?,
            self.node(&triple.object, solution, construction, depth, guard, emit)?,
        ))
    }

    fn collection(
        &mut self,
        id: u64,
        values: &[SrlNode],
        solution: &Solution,
        construction: &ConstructionScope,
        depth: usize,
        guard: &mut ExecutionGuard<'_>,
        emit: &mut QuadEmitter<'_>,
    ) -> Result<Term, SrlError> {
        guard.depth(depth)?;
        if values.is_empty() {
            return Ok(NamedNode::new_unchecked(RDF_NIL).into());
        }
        guard.depth(depth.saturating_add(1))?;
        let head = self.blank(construction.key(&format!("collection:{id}:0")), guard)?;
        let mut current = head.clone();
        for (index, value) in values.iter().enumerate() {
            let next = if index + 1 == values.len() {
                None
            } else {
                Some(self.blank(
                    construction.key(&format!("collection:{id}:{}", index + 1)),
                    guard,
                )?)
            };
            let first = self.node(
                value,
                solution,
                construction,
                depth.saturating_add(1),
                guard,
                emit,
            )?;
            emit(
                Quad::new(
                    current.clone(),
                    NamedNode::new_unchecked(RDF_FIRST),
                    first,
                    GraphName::DefaultGraph,
                ),
                guard,
            )?;
            let rest = next
                .clone()
                .map_or_else(|| NamedNode::new_unchecked(RDF_NIL).into(), Term::from);
            emit(
                Quad::new(
                    current.clone(),
                    NamedNode::new_unchecked(RDF_REST),
                    rest,
                    GraphName::DefaultGraph,
                ),
                guard,
            )?;
            if let Some(next) = next {
                current = next;
            }
        }
        Ok(head.into())
    }

    fn blank(
        &mut self,
        key: String,
        guard: &mut ExecutionGuard<'_>,
    ) -> Result<BlankNode, SrlError> {
        self.blanks.for_key(key, guard)
    }
}

enum ConstructionScope {
    Head(String),
    Data(usize),
}

impl ConstructionScope {
    fn key(&self, identity: &str) -> String {
        match self {
            Self::Head(scope) => format!("head:{scope}:{identity}"),
            Self::Data(scope) => format!("data:{scope}:{identity}"),
        }
    }

    fn is_data(&self) -> bool {
        matches!(self, Self::Data(_))
    }
}

fn as_subject(term: Term, construction: &ConstructionScope) -> Result<NamedOrBlankNode, SrlError> {
    if construction.is_data() {
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
        return NamedOrBlankNode::try_from(term).map_err(|_| {
            SrlError::Unsupported("RDF triple-term subjects in SRL DATA evaluation".to_owned())
        });
    }
    term.try_into().map_err(|_| {
        SrlError::WellFormed("an SRL template subject is not an IRI or blank node".to_owned())
    })
}

fn as_predicate(term: Term, construction: &ConstructionScope) -> Result<NamedNode, SrlError> {
    term.try_into().map_err(|_| {
        if construction.is_data() {
            SrlError::Unsupported("non-ground predicate in DATA block".to_owned())
        } else {
            SrlError::WellFormed("an SRL template predicate is not an IRI".to_owned())
        }
    })
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
            if let GraphName::BlankNode(node) = &quad.graph_name {
                used.insert(node.as_str().to_owned());
            }
        }
        Self {
            by_key: BTreeMap::new(),
            used,
            next: 0,
        }
    }

    fn for_key(
        &mut self,
        key: String,
        guard: &mut ExecutionGuard<'_>,
    ) -> Result<BlankNode, SrlError> {
        if let Some(node) = self.by_key.get(&key) {
            return Ok(node.clone());
        }
        loop {
            let candidate = format!("oxshacl-srl-node-{}", self.next);
            self.next = self.next.saturating_add(1);
            if self.used.insert(candidate.clone()) {
                guard.memory(key.len().saturating_add(candidate.len()).saturating_add(64))?;
                let node = BlankNode::new(candidate)
                    .map_err(|error| SrlError::Unsupported(error.to_string()))?;
                self.by_key.insert(key, node.clone());
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
