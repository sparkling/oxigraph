use super::ValidationContext;
use crate::Constraint;
use crate::control::{Budget, ValidationError};
use crate::expression::ExpressionContext;
use crate::model::{Shape, ShapeId, Target, shape_key};
use crate::path::{all_graph_nodes, deduplicate};
use oxrdf::{NamedNode, Term};
use std::collections::BTreeSet;

impl ValidationContext<'_> {
    pub(super) fn qualified_sibling_shapes(
        &self,
        current: &Shape,
    ) -> Result<Vec<Shape>, ValidationError> {
        let mut shape_ids = BTreeSet::new();
        for owner in self.shapes.shapes() {
            let owns_current = owner.constraints.iter().any(
                |constraint| matches!(constraint, Constraint::Property(id) if id == &current.id),
            );
            if !owns_current {
                continue;
            }
            for constraint in &owner.constraints {
                let Constraint::Property(sibling_id) = constraint else {
                    continue;
                };
                if sibling_id == &current.id {
                    continue;
                }
                let sibling = self.shape(sibling_id)?;
                if sibling.path != current.path {
                    continue;
                }
                for constraint in &sibling.constraints {
                    if let Constraint::Qualified(qualified) = constraint {
                        shape_ids.insert(shape_key(&qualified.shape));
                    }
                }
            }
        }
        shape_ids
            .into_iter()
            .map(|key| {
                self.shapes
                    .shapes()
                    .find(|shape| shape_key(&shape.id) == key)
                    .cloned()
                    .ok_or(ValidationError::UnknownShape(key))
            })
            .collect()
    }

    pub(super) fn allowed_properties_by_types(
        &mut self,
        focus: &Term,
        budget: &mut Budget<'_>,
    ) -> Result<BTreeSet<String>, ValidationError> {
        let mut roots = Vec::new();
        for shape in self.shapes.shapes().cloned().collect::<Vec<_>>() {
            let mut applies = false;
            for target in &shape.targets {
                if let Target::Class(class) = target
                    && self.is_instance(focus, class, budget)?
                {
                    applies = true;
                    break;
                }
            }
            if applies {
                roots.push(shape);
            }
        }
        let mut allowed =
            BTreeSet::from(["http://www.w3.org/1999/02/22-rdf-syntax-ns#type".to_owned()]);
        let mut seen = BTreeSet::new();
        for shape in roots {
            self.collect_shape_properties(&shape, &mut allowed, &mut seen)?;
        }
        Ok(allowed)
    }

    fn collect_shape_properties(
        &self,
        shape: &Shape,
        allowed: &mut BTreeSet<String>,
        seen: &mut BTreeSet<String>,
    ) -> Result<(), ValidationError> {
        if !seen.insert(shape_key(&shape.id)) {
            return Ok(());
        }
        for constraint in &shape.constraints {
            match constraint {
                Constraint::Property(property) => {
                    let property = self.shape(property)?;
                    if let Some(crate::PropertyPath::Predicate(predicate)) = &property.path {
                        allowed.insert(predicate.as_str().to_owned());
                    }
                    self.collect_shape_properties(&property, allowed, seen)?;
                }
                Constraint::Node(node) => {
                    let node = self.shape(node)?;
                    self.collect_shape_properties(&node, allowed, seen)?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    pub(super) fn shape(&self, id: &ShapeId) -> Result<Shape, ValidationError> {
        self.shapes
            .shape(id)
            .cloned()
            .ok_or_else(|| ValidationError::UnknownShape(shape_key(id)))
    }

    pub(super) fn is_instance(
        &mut self,
        node: &Term,
        class: &NamedNode,
        budget: &mut Budget<'_>,
    ) -> Result<bool, ValidationError> {
        let (Term::NamedNode(_) | Term::BlankNode(_)) = node else {
            return Ok(false);
        };
        let classes = self.node_classes(node, budget)?;
        let superclasses = self.superclasses(&classes, budget)?;
        Ok(superclasses.contains(class.as_str()))
    }

    fn node_classes(
        &mut self,
        node: &Term,
        budget: &mut Budget<'_>,
    ) -> Result<BTreeSet<String>, ValidationError> {
        let node = node.to_string();
        let mut classes = BTreeSet::new();
        for triple in self.graph.triples() {
            budget.path_visit()?;
            if triple.subject.to_string() == node
                && triple.predicate.as_str() == "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
                && let Term::NamedNode(class) = triple.object
            {
                classes.insert(class.as_str().to_owned());
            }
        }
        Ok(classes)
    }

    fn superclasses(
        &mut self,
        classes: &BTreeSet<String>,
        budget: &mut Budget<'_>,
    ) -> Result<BTreeSet<String>, ValidationError> {
        let mut closure = classes.clone();
        loop {
            let before = closure.len();
            add_superclasses(self.graph, &mut closure, budget)?;
            if self.sub_class_of_in_shapes_graph {
                add_superclasses(self.shapes.source(), &mut closure, budget)?;
            }
            if closure.len() == before {
                return Ok(closure);
            }
        }
    }

    pub(super) fn is_subclass(
        &mut self,
        node: &Term,
        root: &NamedNode,
        budget: &mut Budget<'_>,
    ) -> Result<bool, ValidationError> {
        let Term::NamedNode(class) = node else {
            return Ok(false);
        };
        let classes = BTreeSet::from([class.as_str().to_owned()]);
        Ok(self.superclasses(&classes, budget)?.contains(root.as_str()))
    }
}

fn add_superclasses(
    graph: &crate::GraphSnapshot,
    closure: &mut BTreeSet<String>,
    budget: &mut Budget<'_>,
) -> Result<(), ValidationError> {
    for triple in graph.triples() {
        budget.path_visit()?;
        if triple.predicate.as_str() == "http://www.w3.org/2000/01/rdf-schema#subClassOf"
            && matches!(
                &triple.subject,
                oxrdf::NamedOrBlankNode::NamedNode(class)
                    if closure.contains(class.as_str())
            )
            && let Term::NamedNode(superclass) = triple.object
        {
            closure.insert(superclass.as_str().to_owned());
        }
    }
    Ok(())
}

impl ExpressionContext for ValidationContext<'_> {
    fn conforms(
        &mut self,
        shape: &ShapeId,
        node: &Term,
        budget: &mut Budget<'_>,
        depth: usize,
    ) -> Result<bool, ValidationError> {
        let shape = self.shape(shape)?;
        Ok(self
            .validate_shape(&shape, node, budget, depth, false)?
            .is_empty())
    }

    fn instances_of(
        &mut self,
        class: &NamedNode,
        budget: &mut Budget<'_>,
    ) -> Result<Vec<Term>, ValidationError> {
        let nodes = all_graph_nodes(self.graph, budget)?;
        let mut output = Vec::new();
        for node in nodes {
            if self.is_instance(&node, class, budget)? {
                output.push(node);
            }
        }
        Ok(deduplicate(output))
    }

    fn all_nodes(&mut self, budget: &mut Budget<'_>) -> Result<Vec<Term>, ValidationError> {
        all_graph_nodes(self.graph, budget)
    }
}

#[cfg(test)]
mod tests;
