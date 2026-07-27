use super::path;
use super::{
    DIRECT_SHAPE_REFERENCES, LIST_SHAPE_REFERENCES, NODE_SHAPE, PROPERTY_SHAPE, RDF_TYPE,
    RDFS_SUBCLASS, SH, SHAPE_TRIGGERS, insert_shape,
};
use crate::compile::rdf::to_shape_id;
use crate::control::{Budget, ValidationError};
use crate::model::{GraphSnapshot, ShapeId};
use oxrdf::{NamedNode, Term, Triple};
use std::collections::{BTreeMap, BTreeSet};

pub(super) struct GraphIndex {
    source: GraphSnapshot,
    triples: Vec<Triple>,
    by_subject_predicate: BTreeMap<(String, String), Vec<Term>>,
    subject_counts: BTreeMap<String, usize>,
}

impl GraphIndex {
    pub(super) fn new(source: &GraphSnapshot) -> Self {
        let triples = source.triples().collect::<Vec<_>>();
        let mut by_subject_predicate = BTreeMap::<(String, String), Vec<Term>>::new();
        let mut subject_counts = BTreeMap::<String, usize>::new();
        for triple in &triples {
            let subject_key = triple.subject.to_string();
            by_subject_predicate
                .entry((subject_key.clone(), triple.predicate.as_str().to_owned()))
                .or_default()
                .push(triple.object.clone());
            *subject_counts.entry(subject_key).or_default() += 1;
        }
        Self {
            source: source.clone(),
            triples,
            by_subject_predicate,
            subject_counts,
        }
    }

    pub(super) fn source(&self) -> &GraphSnapshot {
        &self.source
    }

    pub(super) fn values(&self, subject: &ShapeId, predicate: &str) -> &[Term] {
        self.by_subject_predicate
            .get(&(subject.to_string(), predicate.to_owned()))
            .map_or(&[], Vec::as_slice)
    }

    pub(super) fn triples(&self) -> &[Triple] {
        &self.triples
    }

    pub(super) fn subject_count(&self, subject: &ShapeId) -> usize {
        self.subject_counts
            .get(&subject.to_string())
            .copied()
            .unwrap_or_default()
    }

    pub(super) fn is_instance(&self, subject: &ShapeId, class: &str) -> bool {
        self.values(subject, RDF_TYPE).iter().any(
            |term| matches!(term, Term::NamedNode(actual) if self.class_reaches(actual, class)),
        )
    }

    fn class_reaches(&self, class: &NamedNode, target: &str) -> bool {
        let mut pending = vec![class.clone()];
        let mut seen = BTreeSet::new();
        while let Some(class) = pending.pop() {
            if class.as_str() == target {
                return true;
            }
            if !seen.insert(class.as_str().to_owned()) {
                continue;
            }
            let id = ShapeId::from(class);
            pending.extend(
                self.values(&id, RDFS_SUBCLASS)
                    .iter()
                    .filter_map(|term| match term {
                        Term::NamedNode(parent) => Some(parent.clone()),
                        _ => None,
                    }),
            );
        }
        false
    }

    pub(super) fn shape_nodes(
        &self,
        budget: &mut Budget<'_>,
    ) -> Result<BTreeMap<String, ShapeId>, ValidationError> {
        let mut shapes = BTreeMap::new();
        let mut list_heads = Vec::new();
        for triple in &self.triples {
            let typed_shape = triple.predicate.as_str() == RDF_TYPE
                && matches!(
                    &triple.object,
                    Term::NamedNode(class)
                        if self.class_reaches(class, NODE_SHAPE)
                            || self.class_reaches(class, PROPERTY_SHAPE)
                );
            let local = triple.predicate.as_str().strip_prefix(SH);
            if typed_shape || local.is_some_and(|local| SHAPE_TRIGGERS.contains(&local)) {
                insert_shape(&mut shapes, triple.subject.clone());
            }
            if local.is_some_and(|local| DIRECT_SHAPE_REFERENCES.contains(&local))
                && let Some(shape) = to_shape_id(&triple.object)
            {
                insert_shape(&mut shapes, shape);
            }
            if let Some(local) = local
                && LIST_SHAPE_REFERENCES.contains(&local)
            {
                list_heads.push((local.to_owned(), triple.object.clone()));
            }
        }
        for (local, head) in list_heads {
            for term in path::list(self, &head, budget, &format!("{local}-node"))? {
                if let Some(shape) = to_shape_id(&term) {
                    insert_shape(&mut shapes, shape);
                }
            }
        }
        Ok(shapes)
    }
}
