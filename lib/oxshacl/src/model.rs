use crate::{Constraint, PropertyPath};
use oxrdf::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use std::collections::BTreeMap;

/// RDF identifier of a node or property shape.
pub type ShapeId = NamedOrBlankNode;

/// Compiled SHACL target declaration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Target {
    /// One explicit target node.
    Node(Term),
    /// Nodes returned by a bounded node expression.
    Expression(crate::NodeExpression),
    /// Nodes selected by another shape's target semantics.
    Where(ShapeId),
    /// Instances of a target class.
    Class(NamedNode),
    /// Subjects using a target predicate.
    SubjectsOf(NamedNode),
    /// Objects reached through a target predicate.
    ObjectsOf(NamedNode),
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ConstraintAnnotation {
    pub severity: Option<NamedNode>,
    pub messages: Vec<oxrdf::Literal>,
}

/// Typed node or property shape consumed by the validator.
#[derive(Clone, Debug)]
#[expect(
    clippy::partial_pub_fields,
    clippy::field_scoped_visibility_modifiers,
    reason = "statement annotations are compiler metadata shared only across crate modules"
)]
pub struct Shape {
    /// RDF identifier of the shape.
    pub id: ShapeId,
    /// Property path, present for property shapes.
    pub path: Option<PropertyPath>,
    /// Optional node expression that supplies property-shape values.
    pub values: Option<crate::NodeExpression>,
    /// Optional node expression used when the ordinary value set is empty.
    pub default_value: Option<crate::NodeExpression>,
    /// Target declarations selecting focus nodes.
    pub targets: Vec<Target>,
    /// Constraints evaluated for each focus/value pair.
    pub constraints: Vec<Constraint>,
    pub(crate) constraint_annotations: Vec<ConstraintAnnotation>,
    /// Default severity for results produced by this shape.
    pub severity: NamedNode,
    /// Default result messages.
    pub messages: Vec<oxrdf::Literal>,
    /// Whether the shape is excluded from validation.
    pub deactivated: bool,
}

impl Shape {
    /// Constructs an active node shape with violation severity and no constraints.
    pub fn node(id: impl Into<ShapeId>) -> Self {
        Self {
            id: id.into(),
            path: None,
            values: None,
            default_value: None,
            targets: Vec::new(),
            constraints: Vec::new(),
            constraint_annotations: Vec::new(),
            severity: NamedNode::new_unchecked("http://www.w3.org/ns/shacl#Violation"),
            messages: Vec::new(),
            deactivated: false,
        }
    }

    /// Constructs an active property shape for the supplied path.
    pub fn property(id: impl Into<ShapeId>, path: PropertyPath) -> Self {
        Self {
            path: Some(path),
            ..Self::node(id)
        }
    }
}

/// A read-only, owned graph snapshot used to isolate validation from writes.
#[derive(Clone, Debug)]
pub struct GraphSnapshot {
    dataset: Dataset,
    graph_name: GraphName,
}

impl GraphSnapshot {
    /// Creates a snapshot selecting one graph from an owned dataset.
    pub fn new(dataset: Dataset, graph_name: GraphName) -> Self {
        Self {
            dataset,
            graph_name,
        }
    }

    /// Creates a snapshot selecting the dataset's default graph.
    pub fn default_graph(dataset: Dataset) -> Self {
        Self::new(dataset, GraphName::DefaultGraph)
    }

    /// Returns the complete owned dataset backing this snapshot.
    pub fn dataset(&self) -> &Dataset {
        &self.dataset
    }

    /// Returns the graph selected for SHACL processing.
    pub fn graph_name(&self) -> &GraphName {
        &self.graph_name
    }

    /// Iterates over triples in the selected graph.
    pub fn triples(&self) -> impl Iterator<Item = oxrdf::Triple> + '_ {
        self.dataset.graph(&self.graph_name).iter()
    }

    /// Returns the number of triples in the selected graph.
    pub fn triple_count(&self) -> usize {
        self.triples().count()
    }

    pub(crate) fn isolated_default_dataset(&self) -> Dataset {
        self.triples()
            .map(|triple| {
                Quad::new(
                    triple.subject,
                    triple.predicate,
                    triple.object,
                    GraphName::DefaultGraph,
                )
            })
            .collect::<Dataset>()
    }
}

/// Store-neutral seam: implementations return a stable snapshot.
pub trait SnapshotSource {
    /// Failure while obtaining a stable snapshot.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Returns an owned snapshot isolated from subsequent source mutations.
    fn snapshot(&self) -> Result<GraphSnapshot, Self::Error>;
}

impl SnapshotSource for GraphSnapshot {
    type Error = std::convert::Infallible;

    fn snapshot(&self) -> Result<GraphSnapshot, Self::Error> {
        Ok(self.clone())
    }
}

impl SnapshotSource for Dataset {
    type Error = std::convert::Infallible;

    fn snapshot(&self) -> Result<GraphSnapshot, Self::Error> {
        Ok(GraphSnapshot::default_graph(self.clone()))
    }
}

pub(crate) type ShapeMap = BTreeMap<String, Shape>;

pub(crate) fn shape_key(id: &ShapeId) -> String {
    id.to_string()
}
