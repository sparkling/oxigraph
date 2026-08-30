//! [In-memory implementation](Dataset) of [RDF datasets](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-dataset).
//!
//! Usage example:
//! ```
//! use oxrdf::*;
//!
//! let mut dataset = Dataset::default();
//!
//! // insertion
//! let ex = NamedNode::new("http://example.com")?;
//! let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone());
//! dataset.insert(quad.clone());
//!
//! // simple filter
//! let results: Vec<_> = dataset.quads_for_subject(&ex).collect();
//! assert_eq!(vec![quad], results);
//!
//! // direct access to a dataset graph
//! let results: Vec<_> = dataset.graph(&ex).iter().collect();
//! assert_eq!(vec![Triple::new(ex.clone(), ex.clone(), ex)], results);
//!
//! // Print
//! assert_eq!(
//!     dataset.to_string(),
//!     "<http://example.com> <http://example.com> <http://example.com> <http://example.com> .\n"
//! );
//! # Result::<_, Box<dyn std::error::Error>>::Ok(())
//! ```
//!
//! See also [`Graph`] if you only care about plain triples.

use crate::interning::*;
use crate::*;
use oxstr::OxString;
#[cfg(feature = "rdfc-10")]
use sha2::{Digest, Sha256, Sha384};
use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::mem::take;

/// An in-memory [RDF dataset](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-dataset).
///
/// It can accommodate a fairly large number of quads (in the few millions).
///
/// <div class="warning">It interns the strings and does not do any garbage collection yet:
/// if you insert and remove a lot of different terms, memory will grow without any reduction.</div>
///
/// Usage example:
/// ```
/// use oxrdf::*;
///
/// let mut dataset = Dataset::default();
///
/// // insertion
/// let ex = NamedNode::new("http://example.com")?;
/// let quad = Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone());
/// dataset.insert(quad.clone());
///
/// // simple filter
/// let results: Vec<_> = dataset.quads_for_subject(&ex).collect();
/// assert_eq!(vec![quad], results);
///
/// // direct access to a dataset graph
/// let results: Vec<_> = dataset.graph(&ex).iter().collect();
/// assert_eq!(vec![Triple::new(ex.clone(), ex.clone(), ex)], results);
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[derive(Debug, Default, Clone)]
pub struct Dataset {
    interner: Interner,
    named_graphs: BTreeSet<InternedGraphName>,
    gspo: BTreeSet<(
        InternedGraphName,
        InternedNamedOrBlankNode,
        InternedNamedNode,
        InternedTerm,
    )>,
    gpos: BTreeSet<(
        InternedGraphName,
        InternedNamedNode,
        InternedTerm,
        InternedNamedOrBlankNode,
    )>,
    gosp: BTreeSet<(
        InternedGraphName,
        InternedTerm,
        InternedNamedOrBlankNode,
        InternedNamedNode,
    )>,
    spog: BTreeSet<(
        InternedNamedOrBlankNode,
        InternedNamedNode,
        InternedTerm,
        InternedGraphName,
    )>,
    posg: BTreeSet<(
        InternedNamedNode,
        InternedTerm,
        InternedNamedOrBlankNode,
        InternedGraphName,
    )>,
    ospg: BTreeSet<(
        InternedTerm,
        InternedNamedOrBlankNode,
        InternedNamedNode,
        InternedGraphName,
    )>,
}

impl Dataset {
    /// Creates a new dataset
    pub fn new() -> Self {
        Self::default()
    }

    /// Provides a read-only view on an [RDF graph](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-graph) contained in this dataset.
    ///
    /// ```
    /// use oxrdf::*;
    ///
    /// let mut dataset = Dataset::default();
    /// let ex = NamedNode::new("http://example.com")?;
    /// dataset.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone()));
    ///
    /// let results: Vec<_> = dataset.graph(&ex).iter().collect();
    /// assert_eq!(vec![Triple::new(ex.clone(), ex.clone(), ex)], results);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn graph<'a, 'b>(&'a self, graph_name: impl Into<GraphNameRef<'b>>) -> GraphView<'a> {
        let graph_name = self
            .encoded_graph_name(graph_name)
            .unwrap_or_else(InternedGraphName::impossible);
        GraphView {
            dataset: self,
            graph_name,
        }
    }

    /// Provides a read/write view on an [RDF graph](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-graph) contained in this dataset.
    ///
    /// ```
    /// use oxrdf::*;
    ///
    /// let mut dataset = Dataset::default();
    /// let ex = NamedNode::new("http://example.com")?;
    ///
    /// // We edit and query the dataset http://example.com graph
    /// {
    ///     let mut graph = dataset.graph_mut(ex.clone());
    ///     graph.insert(Triple::new(ex.clone(), ex.clone(), ex.clone()));
    ///     let results: Vec<_> = graph.iter().collect();
    ///     assert_eq!(
    ///         vec![Triple::new(ex.clone(), ex.clone(), ex.clone())],
    ///         results
    ///     );
    /// }
    ///
    /// // We have also changes the dataset itself
    /// let results: Vec<_> = dataset.iter().collect();
    /// assert_eq!(
    ///     vec![Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone())],
    ///     results
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn graph_mut(&mut self, graph_name: impl Into<GraphName>) -> GraphViewMut<'_> {
        let graph_name = InternedGraphName::encoded_into(graph_name.into(), &mut self.interner);
        if !matches!(graph_name, InternedGraphName::DefaultGraph) {
            self.named_graphs.insert(graph_name);
        }
        GraphViewMut {
            dataset: self,
            graph_name,
        }
    }

    /// Returns all the quads contained by the dataset.
    ///
    /// Empty named graphs have no quad representation and are therefore not
    /// returned. Use [`named_graphs`](Self::named_graphs) to inspect complete
    /// dataset topology.
    pub fn iter(&self) -> Iter<'_> {
        let iter = self.spog.iter();
        Iter {
            dataset: self,
            inner: iter,
        }
    }

    /// Returns the names of all named graphs in this dataset, including empty
    /// named graphs.
    ///
    /// Quad iteration cannot expose empty named graphs. Use this iterator when
    /// the complete RDF dataset topology matters.
    pub fn named_graphs(&self) -> NamedGraphsIter<'_> {
        NamedGraphsIter {
            dataset: self,
            inner: self.named_graphs.iter(),
        }
    }

    /// Checks whether this dataset contains a named graph.
    ///
    /// This returns `true` for empty named graphs as well as graphs containing
    /// quads.
    pub fn contains_named_graph<'a>(&self, graph_name: impl Into<NamedOrBlankNodeRef<'a>>) -> bool {
        self.encoded_named_graph_name(graph_name)
            .is_some_and(|graph_name| self.named_graphs.contains(&graph_name))
    }

    /// Adds a named graph to this dataset.
    ///
    /// The graph is initially empty unless quads with the same graph name are
    /// already present.
    pub fn insert_named_graph(&mut self, graph_name: impl Into<NamedOrBlankNode>) -> bool {
        let graph_name = self.encode_named_graph_name(graph_name.into());
        self.named_graphs.insert(graph_name)
    }

    /// Clears all quads from a graph while retaining named-graph presence.
    ///
    /// The default graph always exists. For a named graph, this operation does
    /// not remove the graph from [`named_graphs`](Self::named_graphs).
    pub fn clear_graph<'a>(&mut self, graph_name: impl Into<GraphNameRef<'a>>) {
        let Some(graph_name) = self.encoded_graph_name(graph_name) else {
            return;
        };
        self.clear_encoded_graph(graph_name);
    }

    /// Removes a named graph and all of its quads from this dataset.
    ///
    /// Returns whether the named graph was present.
    pub fn remove_named_graph<'a>(
        &mut self,
        graph_name: impl Into<NamedOrBlankNodeRef<'a>>,
    ) -> bool {
        let Some(graph_name) = self.encoded_named_graph_name(graph_name) else {
            return false;
        };
        let was_present = self.named_graphs.remove(&graph_name);
        self.clear_encoded_graph(graph_name);
        was_present
    }

    pub fn quads_for_subject<'a, 'b>(
        &'a self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
    ) -> impl Iterator<Item = Quad> + 'a {
        let subject = self
            .encoded_named_or_blank_node(subject)
            .unwrap_or_else(InternedNamedOrBlankNode::impossible);
        self.interned_quads_for_subject(&subject)
            .map(move |q| self.decode_spog(q))
    }

    fn interned_quads_for_subject<'a>(
        &'a self,
        subject: &InternedNamedOrBlankNode,
    ) -> impl Iterator<
        Item = (
            &'a InternedNamedOrBlankNode,
            &'a InternedNamedNode,
            &'a InternedTerm,
            &'a InternedGraphName,
        ),
    > + use<'a> {
        self.spog
            .range(
                &(
                    *subject,
                    InternedNamedNode::first(),
                    InternedTerm::first(),
                    InternedGraphName::first(),
                )
                    ..&(
                        subject.next(),
                        InternedNamedNode::first(),
                        InternedTerm::first(),
                        InternedGraphName::first(),
                    ),
            )
            .map(|(s, p, o, g)| (s, p, o, g))
    }

    pub fn quads_for_predicate<'a, 'b>(
        &'a self,
        predicate: impl Into<NamedNodeRef<'b>>,
    ) -> impl Iterator<Item = Quad> + 'a {
        let predicate = self
            .encoded_named_node(predicate)
            .unwrap_or_else(InternedNamedNode::impossible);
        self.interned_quads_for_predicate(predicate)
            .map(move |q| self.decode_spog(q))
    }

    fn interned_quads_for_predicate(
        &self,
        predicate: InternedNamedNode,
    ) -> impl Iterator<
        Item = (
            &InternedNamedOrBlankNode,
            &InternedNamedNode,
            &InternedTerm,
            &InternedGraphName,
        ),
    > + '_ {
        self.posg
            .range(
                &(
                    predicate,
                    InternedTerm::first(),
                    InternedNamedOrBlankNode::first(),
                    InternedGraphName::first(),
                )
                    ..&(
                        predicate.next(),
                        InternedTerm::first(),
                        InternedNamedOrBlankNode::first(),
                        InternedGraphName::first(),
                    ),
            )
            .map(|(p, o, s, g)| (s, p, o, g))
    }

    pub fn quads_for_object<'a, 'b>(
        &'a self,
        object: impl Into<TermRef<'b>>,
    ) -> impl Iterator<Item = Quad> + 'a {
        let object = self
            .encoded_term(object)
            .unwrap_or_else(InternedTerm::impossible);

        self.interned_quads_for_object(&object)
            .map(move |q| self.decode_spog(q))
    }

    fn interned_quads_for_object<'a>(
        &'a self,
        object: &InternedTerm,
    ) -> impl Iterator<
        Item = (
            &'a InternedNamedOrBlankNode,
            &'a InternedNamedNode,
            &'a InternedTerm,
            &'a InternedGraphName,
        ),
    > + use<'a> {
        self.ospg
            .range(
                &(
                    object.clone(),
                    InternedNamedOrBlankNode::first(),
                    InternedNamedNode::first(),
                    InternedGraphName::first(),
                )
                    ..&(
                        object.next(),
                        InternedNamedOrBlankNode::first(),
                        InternedNamedNode::first(),
                        InternedGraphName::first(),
                    ),
            )
            .map(|(o, s, p, g)| (s, p, o, g))
    }

    pub fn quads_for_graph_name<'a, 'b>(
        &'a self,
        graph_name: impl Into<GraphNameRef<'b>>,
    ) -> impl Iterator<Item = Quad> + 'a {
        let graph_name = self
            .encoded_graph_name(graph_name)
            .unwrap_or_else(InternedGraphName::impossible);

        self.interned_quads_for_graph_name(&graph_name)
            .map(move |q| self.decode_spog(q))
    }

    fn interned_quads_for_graph_name<'a>(
        &'a self,
        graph_name: &InternedGraphName,
    ) -> impl Iterator<
        Item = (
            &'a InternedNamedOrBlankNode,
            &'a InternedNamedNode,
            &'a InternedTerm,
            &'a InternedGraphName,
        ),
    > + use<'a> {
        self.gspo
            .range(
                &(
                    *graph_name,
                    InternedNamedOrBlankNode::first(),
                    InternedNamedNode::first(),
                    InternedTerm::first(),
                )
                    ..&(
                        graph_name.next(),
                        InternedNamedOrBlankNode::first(),
                        InternedNamedNode::first(),
                        InternedTerm::first(),
                    ),
            )
            .map(|(g, s, p, o)| (s, p, o, g))
    }

    /// Retrieves quads with a filter on each quad component
    pub fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<NamedOrBlankNodeRef<'a>>,
        predicate: Option<NamedNodeRef<'a>>,
        object: Option<TermRef<'a>>,
        graph_name: Option<GraphNameRef<'a>>,
    ) -> impl Iterator<Item = Quad> + 'a {
        let iter: Box<dyn Iterator<Item = _>> = if let Some(subject) = subject {
            Box::new(self.quads_for_subject(subject).filter(move |q| {
                predicate.as_ref().is_none_or(|p| *p == q.predicate)
                    && object.as_ref().is_none_or(|o| *o == q.object.as_ref())
                    && graph_name
                        .as_ref()
                        .is_none_or(|g| *g == q.graph_name.as_ref())
            }))
        } else if let Some(object) = object {
            Box::new(self.quads_for_object(object).filter(move |q| {
                predicate.as_ref().is_none_or(|p| *p == q.predicate)
                    && graph_name
                        .as_ref()
                        .is_none_or(|g| *g == q.graph_name.as_ref())
            }))
        } else if let Some(predicate) = predicate {
            Box::new(self.quads_for_predicate(predicate).filter(move |q| {
                graph_name
                    .as_ref()
                    .is_none_or(|g| *g == q.graph_name.as_ref())
            }))
        } else if let Some(graph_name) = graph_name {
            Box::new(self.quads_for_graph_name(graph_name))
        } else {
            Box::new(self.iter())
        };
        iter
    }

    /// Checks if the dataset contains the given quad
    pub fn contains<'a>(&self, quad: impl Into<QuadRef<'a>>) -> bool {
        if let Some(q) = self.encoded_quad(quad.into()) {
            self.spog.contains(&q)
        } else {
            false
        }
    }

    /// Returns the number of quads in this dataset.
    pub fn len(&self) -> usize {
        self.gspo.len()
    }

    /// Checks if this dataset contains a quad.
    pub fn is_empty(&self) -> bool {
        self.gspo.is_empty()
    }

    /// Adds a quad to the dataset.
    pub fn insert(&mut self, quad: impl Into<Quad>) -> bool {
        let quad = self.encode_quad(quad.into());
        self.insert_encoded(quad)
    }

    fn insert_encoded(
        &mut self,
        quad: (
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
            InternedGraphName,
        ),
    ) -> bool {
        let (s, p, o, g) = quad;
        if !matches!(g, InternedGraphName::DefaultGraph) {
            self.named_graphs.insert(g);
        }
        self.gspo.insert((g, s, p, o.clone()));
        self.gpos.insert((g, p, o.clone(), s));
        self.gosp.insert((g, o.clone(), s, p));
        self.spog.insert((s, p, o.clone(), g));
        self.posg.insert((p, o.clone(), s, g));
        self.ospg.insert((o, s, p, g))
    }

    /// Removes a concrete quad from the dataset.
    pub fn remove<'a>(&mut self, quad: impl Into<QuadRef<'a>>) -> bool {
        if let Some(quad) = self.encoded_quad(quad.into()) {
            self.remove_encoded(quad)
        } else {
            false
        }
    }

    fn remove_encoded(
        &mut self,
        quad: (
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
            InternedGraphName,
        ),
    ) -> bool {
        let (s, p, o, g) = quad;
        self.gspo.remove(&(g, s, p, o.clone()));
        self.gpos.remove(&(g, p, o.clone(), s));
        self.gosp.remove(&(g, o.clone(), s, p));
        self.spog.remove(&(s, p, o.clone(), g));
        self.posg.remove(&(p, o.clone(), s, g));
        self.ospg.remove(&(o, s, p, g))
    }

    fn clear_encoded_graph(&mut self, graph_name: InternedGraphName) {
        let quads = self
            .interned_quads_for_graph_name(&graph_name)
            .map(|(s, p, o, g)| (*s, *p, o.clone(), *g))
            .collect::<Vec<_>>();
        for quad in quads {
            self.remove_encoded(quad);
        }
    }

    /// Clears the dataset.
    pub fn clear(&mut self) {
        self.named_graphs.clear();
        self.gspo.clear();
        self.gpos.clear();
        self.gosp.clear();
        self.spog.clear();
        self.posg.clear();
        self.ospg.clear();
    }

    fn encode_quad(
        &mut self,
        quad: Quad,
    ) -> (
        InternedNamedOrBlankNode,
        InternedNamedNode,
        InternedTerm,
        InternedGraphName,
    ) {
        (
            InternedNamedOrBlankNode::encoded_into(quad.subject, &mut self.interner),
            InternedNamedNode::encoded_into(quad.predicate, &mut self.interner),
            InternedTerm::encoded_into(quad.object, &mut self.interner),
            InternedGraphName::encoded_into(quad.graph_name, &mut self.interner),
        )
    }

    fn encoded_quad(
        &self,
        quad: QuadRef<'_>,
    ) -> Option<(
        InternedNamedOrBlankNode,
        InternedNamedNode,
        InternedTerm,
        InternedGraphName,
    )> {
        Some((
            self.encoded_named_or_blank_node(quad.subject)?,
            self.encoded_named_node(quad.predicate)?,
            self.encoded_term(quad.object)?,
            self.encoded_graph_name(quad.graph_name)?,
        ))
    }

    pub(super) fn encoded_named_node<'a>(
        &self,
        node: impl Into<NamedNodeRef<'a>>,
    ) -> Option<InternedNamedNode> {
        InternedNamedNode::encoded_from(node.into(), &self.interner)
    }

    pub(super) fn encoded_named_or_blank_node<'a>(
        &self,
        node: impl Into<NamedOrBlankNodeRef<'a>>,
    ) -> Option<InternedNamedOrBlankNode> {
        InternedNamedOrBlankNode::encoded_from(node.into(), &self.interner)
    }

    pub(super) fn encoded_term<'a>(&self, term: impl Into<TermRef<'a>>) -> Option<InternedTerm> {
        InternedTerm::encoded_from(term.into(), &self.interner)
    }

    pub(super) fn encoded_graph_name<'a>(
        &self,
        graph_name: impl Into<GraphNameRef<'a>>,
    ) -> Option<InternedGraphName> {
        InternedGraphName::encoded_from(graph_name.into(), &self.interner)
    }

    fn encode_named_graph_name(&mut self, graph_name: NamedOrBlankNode) -> InternedGraphName {
        match InternedNamedOrBlankNode::encoded_into(graph_name, &mut self.interner) {
            InternedNamedOrBlankNode::NamedNode(node) => InternedGraphName::NamedNode(node),
            InternedNamedOrBlankNode::BlankNode(node) => InternedGraphName::BlankNode(node),
        }
    }

    fn encoded_named_graph_name<'a>(
        &self,
        graph_name: impl Into<NamedOrBlankNodeRef<'a>>,
    ) -> Option<InternedGraphName> {
        Some(
            match InternedNamedOrBlankNode::encoded_from(graph_name.into(), &self.interner)? {
                InternedNamedOrBlankNode::NamedNode(node) => InternedGraphName::NamedNode(node),
                InternedNamedOrBlankNode::BlankNode(node) => InternedGraphName::BlankNode(node),
            },
        )
    }

    fn decode_named_graph_name(&self, graph_name: &InternedGraphName) -> NamedOrBlankNode {
        match graph_name {
            InternedGraphName::NamedNode(node) => node.decode_from(&self.interner).into(),
            InternedGraphName::BlankNode(node) => node.decode_from(&self.interner).into(),
            InternedGraphName::DefaultGraph => {
                unreachable!("the default graph is not a named graph")
            }
        }
    }

    fn decode_spog(
        &self,
        quad: (
            &InternedNamedOrBlankNode,
            &InternedNamedNode,
            &InternedTerm,
            &InternedGraphName,
        ),
    ) -> Quad {
        Quad {
            subject: quad.0.decode_from(&self.interner),
            predicate: quad.1.decode_from(&self.interner),
            object: quad.2.decode_from(&self.interner),
            graph_name: quad.3.decode_from(&self.interner),
        }
    }

    fn decode_spo(
        &self,
        triple: (&InternedNamedOrBlankNode, &InternedNamedNode, &InternedTerm),
    ) -> Triple {
        Triple {
            subject: triple.0.decode_from(&self.interner),
            predicate: triple.1.decode_from(&self.interner),
            object: triple.2.decode_from(&self.interner),
        }
    }

    /// Canonicalizes the dataset by renaming blank nodes.
    ///
    /// Usage example ([Dataset isomorphism](https://www.w3.org/TR/rdf11-concepts/#dfn-dataset-isomorphism)):
    /// ```
    /// use oxrdf::dataset::CanonicalizationAlgorithm;
    /// use oxrdf::*;
    ///
    /// let iri = NamedNode::new("http://example.com")?;
    ///
    /// let mut graph1 = Graph::new();
    /// let bnode1 = BlankNode::default();
    /// graph1.insert(Triple::new(iri.clone(), iri.clone(), bnode1.clone()));
    /// graph1.insert(Triple::new(bnode1, iri.clone(), iri.clone()));
    ///
    /// let mut graph2 = Graph::new();
    /// let bnode2 = BlankNode::default();
    /// graph2.insert(Triple::new(iri.clone(), iri.clone(), bnode2.clone()));
    /// graph2.insert(Triple::new(bnode2, iri.clone(), iri));
    ///
    /// assert_ne!(graph1, graph2);
    /// graph1.canonicalize(CanonicalizationAlgorithm::Unstable)?;
    /// graph2.canonicalize(CanonicalizationAlgorithm::Unstable)?;
    /// assert_eq!(graph1, graph2);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    ///
    /// It supports the [RDF Dataset Canonicalization](https://www.w3.org/TR/rdf-canon/) standard algorithm.
    /// Support requires the `rdfc-10` feature to be enabled.
    ///
    /// Empty named graphs participate in blank-node canonicalization so that
    /// RDF dataset isomorphism includes complete dataset topology. RDFC-1.0 has
    /// no line-syntax representation for empty graph pairs; their inclusion is
    /// therefore an OxRDF model extension to the RDFC algorithm.
    ///
    /// <div class="warning">Blank node ids depend on the current shape of the graph. Adding a new quad might change the ids of a lot of blank nodes.
    /// Hence, this canonization might not be suitable for diffs.</div>
    ///
    /// Work is limited by default to one Hash N-Degree Quads call per non-unique
    /// blank node for every algorithm. For RDFC-1.0 this is the linear
    /// work-factor defense recommended for untrusted input. Use
    /// [`canonicalize_with_n_degree_call_limit`](Self::canonicalize_with_n_degree_call_limit)
    /// when a different explicit budget is required.
    pub fn canonicalize(
        &mut self,
        algorithm: CanonicalizationAlgorithm,
    ) -> Result<(), CanonicalizationError> {
        self.canonicalize_with_n_degree_limit(algorithm, NdegreeCallLimit::Default)
    }

    /// Canonicalizes the dataset using a work-factor-derived call limit.
    ///
    /// A factor of `0` disables Hash N-Degree Quads calls, `1` allows linear
    /// work in the number of non-unique blank nodes, and `2` allows quadratic
    /// work. High factors can permit expensive poison datasets and should only
    /// be used with trusted input.
    pub fn canonicalize_with_work_factor(
        &mut self,
        algorithm: CanonicalizationAlgorithm,
        max_work_factor: u32,
    ) -> Result<(), CanonicalizationError> {
        self.canonicalize_with_n_degree_limit(
            algorithm,
            NdegreeCallLimit::WorkFactor(max_work_factor),
        )
    }

    /// Canonicalizes the dataset with an explicit maximum number of calls to the
    /// Hash N-Degree Quads algorithm.
    ///
    /// The dataset is only mutated after canonicalization succeeds.
    pub fn canonicalize_with_n_degree_call_limit(
        &mut self,
        algorithm: CanonicalizationAlgorithm,
        max_n_degree_calls: usize,
    ) -> Result<(), CanonicalizationError> {
        self.canonicalize_with_n_degree_limit(
            algorithm,
            NdegreeCallLimit::Exact(max_n_degree_calls),
        )
    }

    fn canonicalize_with_n_degree_limit(
        &mut self,
        algorithm: CanonicalizationAlgorithm,
        n_degree_call_limit: NdegreeCallLimit,
    ) -> Result<(), CanonicalizationError> {
        let bnode_mapping =
            self.canonicalize_interned_blank_nodes(algorithm, n_degree_call_limit)?;
        let new_named_graphs = self.map_named_graph_blank_nodes(&bnode_mapping);
        let new_quads = self.map_blank_nodes(&bnode_mapping);
        self.clear();
        self.named_graphs.extend(new_named_graphs);
        for quad in new_quads {
            self.insert_encoded(quad);
        }
        Ok(())
    }

    /// Checks whether this dataset is isomorphic to another RDF dataset.
    ///
    /// Dataset isomorphism includes empty named graphs. The default
    /// canonicalization work-factor defense is used, and an error is returned
    /// if that budget is exceeded.
    pub fn is_isomorphic_to(&self, other: &Self) -> Result<bool, CanonicalizationError> {
        if self.len() != other.len() || self.named_graphs.len() != other.named_graphs.len() {
            return Ok(false);
        }
        let mut left = self.clone();
        let mut right = other.clone();
        left.canonicalize(CanonicalizationAlgorithm::Unstable)?;
        right.canonicalize(CanonicalizationAlgorithm::Unstable)?;
        Ok(left == right)
    }

    /// Returns a map between the current dataset blank node and the canonicalized blank node
    /// to create a canonical dataset.
    ///
    /// See also [`canonicalize`](Self::canonicalize).
    pub fn canonicalize_blank_nodes(
        &self,
        algorithm: CanonicalizationAlgorithm,
    ) -> Result<HashMap<BlankNode, BlankNode>, CanonicalizationError> {
        self.canonicalize_blank_nodes_with_n_degree_limit(algorithm, NdegreeCallLimit::Default)
    }

    /// Returns the canonical blank-node map using a work-factor-derived limit.
    pub fn canonicalize_blank_nodes_with_work_factor(
        &self,
        algorithm: CanonicalizationAlgorithm,
        max_work_factor: u32,
    ) -> Result<HashMap<BlankNode, BlankNode>, CanonicalizationError> {
        self.canonicalize_blank_nodes_with_n_degree_limit(
            algorithm,
            NdegreeCallLimit::WorkFactor(max_work_factor),
        )
    }

    /// Returns the canonical blank-node map with an explicit maximum number of
    /// Hash N-Degree Quads calls.
    pub fn canonicalize_blank_nodes_with_n_degree_call_limit(
        &self,
        algorithm: CanonicalizationAlgorithm,
        max_n_degree_calls: usize,
    ) -> Result<HashMap<BlankNode, BlankNode>, CanonicalizationError> {
        self.canonicalize_blank_nodes_with_n_degree_limit(
            algorithm,
            NdegreeCallLimit::Exact(max_n_degree_calls),
        )
    }

    fn canonicalize_blank_nodes_with_n_degree_limit(
        &self,
        algorithm: CanonicalizationAlgorithm,
        n_degree_call_limit: NdegreeCallLimit,
    ) -> Result<HashMap<BlankNode, BlankNode>, CanonicalizationError> {
        Ok(self
            .canonicalize_interned_blank_nodes(algorithm, n_degree_call_limit)?
            .into_iter()
            .map(|(from, to)| (from.decode_from(&self.interner), to))
            .collect())
    }

    fn canonicalize_interned_blank_nodes(
        &self,
        algorithm: CanonicalizationAlgorithm,
        n_degree_call_limit: NdegreeCallLimit,
    ) -> Result<HashMap<InternedBlankNode, BlankNode>, CanonicalizationError> {
        let hash_algorithm = match algorithm {
            CanonicalizationAlgorithm::Unstable | CanonicalizationAlgorithm::UnstableHashedIds => {
                None
            }
            #[cfg(feature = "rdfc-10")]
            CanonicalizationAlgorithm::Rdfc10 { hash_algorithm } => Some(hash_algorithm),
        };
        // https://www.w3.org/TR/rdf-canon/#canon-algo-algo
        // 1)
        let mut canonicalization_state = CanonicalizationState {
            blank_node_to_quads_map: QuadsPerBlankNode::new(),
            hash_to_blank_nodes_map: BTreeMap::new(),
            canonical_issuer: IdentifierIssuer::new("c14n"),
            empty_named_graphs: HashSet::new(),
        };
        // 2)
        for quad in &self.spog {
            if let InternedNamedOrBlankNode::BlankNode(bnode) = quad.0 {
                Self::add_quad_to_blank_node_to_quads_map_for_blank_node(
                    bnode,
                    quad,
                    &mut canonicalization_state.blank_node_to_quads_map,
                );
            }
            if let InternedTerm::BlankNode(bnode) = &quad.2 {
                Self::add_quad_to_blank_node_to_quads_map_for_blank_node(
                    *bnode,
                    quad,
                    &mut canonicalization_state.blank_node_to_quads_map,
                );
            }
            #[cfg(feature = "rdf-12")]
            if let InternedTerm::Triple(t) = &quad.2 {
                Self::add_quad_to_blank_node_to_quads_map_based_on_triple(
                    t,
                    quad,
                    &mut canonicalization_state.blank_node_to_quads_map,
                );
            }
            if let InternedGraphName::BlankNode(bnode) = &quad.3 {
                Self::add_quad_to_blank_node_to_quads_map_for_blank_node(
                    *bnode,
                    quad,
                    &mut canonicalization_state.blank_node_to_quads_map,
                );
            }
        }
        for graph_name in &self.named_graphs {
            if let InternedGraphName::BlankNode(blank_node) = graph_name {
                if self
                    .interned_quads_for_graph_name(graph_name)
                    .next()
                    .is_none()
                {
                    canonicalization_state
                        .empty_named_graphs
                        .insert(*blank_node);
                    canonicalization_state
                        .blank_node_to_quads_map
                        .entry(*blank_node)
                        .or_default();
                }
            }
        }
        // 3)
        for n in canonicalization_state.blank_node_to_quads_map.keys() {
            // 3.1)
            let hash = self.hash_first_degree_quads(&canonicalization_state, *n, hash_algorithm);
            // 3.2)
            canonicalization_state
                .hash_to_blank_nodes_map
                .entry(hash)
                .or_default()
                .push(*n);
        }
        // 4)
        canonicalization_state.hash_to_blank_nodes_map = canonicalization_state
            .hash_to_blank_nodes_map
            .into_iter()
            .filter(|(hash, identifier_list)| {
                match identifier_list.len() {
                    0 => unreachable!(),
                    // 4.1)
                    2.. => true,
                    1 => {
                        // 4.2)
                        Self::issue_identifier(
                            &mut canonicalization_state.canonical_issuer,
                            identifier_list[0],
                            algorithm,
                            hash,
                        );
                        // 4.3)
                        false
                    }
                }
            })
            .collect::<BTreeMap<_, _>>();
        let default_n_degree_call_limit = canonicalization_state
            .hash_to_blank_nodes_map
            .values()
            .map(Vec::len)
            .sum();
        let mut n_degree_call_budget =
            NdegreeCallBudget::new(n_degree_call_limit.maximum(default_n_degree_call_limit));
        // 5)
        for (hash, identifier_list) in take(&mut canonicalization_state.hash_to_blank_nodes_map) {
            // 5.1)
            let mut hash_path_list = Vec::new();
            // 5.2)
            for n in identifier_list {
                // 5.2.1)
                if canonicalization_state
                    .canonical_issuer
                    .issued_identifier_map
                    .contains_key(&n)
                {
                    continue;
                }
                // 5.2.2)
                let mut temporary_issuer = IdentifierIssuer::new("b");
                // 5.2.3)
                Self::issue_identifier(&mut temporary_issuer, n, algorithm, &hash);
                // 5.2.4)
                hash_path_list.push(self.hash_n_degree_quads(
                    &canonicalization_state,
                    n,
                    &temporary_issuer,
                    algorithm,
                    hash_algorithm,
                    &mut n_degree_call_budget,
                )?)
            }
            // 5.3)
            hash_path_list.sort_unstable_by(|(_, hl), (_, hr)| hl.cmp(hr));
            for (result_identifier_issuer, _) in hash_path_list {
                // 5.3.1)
                for existing_identifier in result_identifier_issuer.issued_identifier_order {
                    Self::issue_identifier(
                        &mut canonicalization_state.canonical_issuer,
                        existing_identifier,
                        algorithm,
                        &hash,
                    );
                }
            }
        }
        // 6)
        Ok(canonicalization_state
            .canonical_issuer
            .issued_identifier_map)
    }

    #[cfg(feature = "rdf-12")]
    fn add_quad_to_blank_node_to_quads_map_based_on_triple<'a>(
        triple: &InternedTriple,
        quad: &'a (
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
            InternedGraphName,
        ),
        blank_node_to_quads_map: &mut QuadsPerBlankNode<'a>,
    ) {
        if let InternedNamedOrBlankNode::BlankNode(bnode) = triple.subject {
            Self::add_quad_to_blank_node_to_quads_map_for_blank_node(
                bnode,
                quad,
                blank_node_to_quads_map,
            );
        }
        if let InternedTerm::BlankNode(bnode) = &triple.object {
            Self::add_quad_to_blank_node_to_quads_map_for_blank_node(
                *bnode,
                quad,
                blank_node_to_quads_map,
            );
        } else if let InternedTerm::Triple(t) = &triple.object {
            Self::add_quad_to_blank_node_to_quads_map_based_on_triple(
                t,
                quad,
                blank_node_to_quads_map,
            );
        }
    }

    fn add_quad_to_blank_node_to_quads_map_for_blank_node<'a>(
        bnode: InternedBlankNode,
        quad: &'a (
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
            InternedGraphName,
        ),
        blank_node_to_quads_map: &mut QuadsPerBlankNode<'a>,
    ) {
        let entry = blank_node_to_quads_map.entry(bnode).or_default();
        if !entry.ends_with(&[quad]) {
            entry.push(quad);
        }
    }

    /// RDFC [Issue Identifier Algorithm](https://www.w3.org/TR/rdf-canon/#issue-identifier)
    fn issue_identifier(
        issuer: &mut IdentifierIssuer,
        blank_node: InternedBlankNode,
        algorithm: CanonicalizationAlgorithm,
        hash: &str,
    ) -> BlankNode {
        match issuer.issued_identifier_map.entry(blank_node) {
            // 1)
            Entry::Occupied(entry) => entry.get().clone(),
            Entry::Vacant(entry) => {
                if algorithm == CanonicalizationAlgorithm::UnstableHashedIds {
                    let mut issued_identifier = BlankNode::new_unchecked(OxString::new_owned(hash));
                    let mut i = 0;
                    while !issuer
                        .already_issued_identifiers
                        .insert(issued_identifier.clone())
                    {
                        i += 1;
                        issued_identifier =
                            BlankNode::new_unchecked(OxString::new_owned(&format!("{hash}{i}")));
                    }
                    entry.insert(issued_identifier.clone());
                    issuer.issued_identifier_order.push(blank_node);
                    issued_identifier
                } else {
                    // 2)
                    let issued_identifier = BlankNode::new_unchecked(OxString::new_owned(
                        &format!("{}{}", issuer.identifier_prefix, issuer.identifier_counter),
                    ));
                    // 3)
                    entry.insert(issued_identifier.clone());
                    issuer.issued_identifier_order.push(blank_node);
                    // 4)
                    issuer.identifier_counter += 1;
                    // 5)
                    issued_identifier
                }
            }
        }
    }

    /// RDFC [Hash First Degree Quads](https://www.w3.org/TR/rdf-canon/#hash-1d-quads)
    fn hash_first_degree_quads(
        &self,
        canonicalization_state: &CanonicalizationState<'_>,
        reference_blank_node_identifier: InternedBlankNode,
        hash_algorithm: Option<CanonicalizationHashAlgorithm>,
    ) -> String {
        // 1)
        let mut nquads = Vec::new();
        // 2)
        let quads =
            &canonicalization_state.blank_node_to_quads_map[&reference_blank_node_identifier];
        if canonicalization_state
            .empty_named_graphs
            .contains(&reference_blank_node_identifier)
        {
            nquads.push("@empty-named-graph _:a\n".to_owned());
        }
        // 3)
        for (subject, predicate, object, graph_name) in quads {
            // 3.1)
            let subject = self.hash_first_degree_quads_decode_named_or_blank_node(
                subject,
                &reference_blank_node_identifier,
            );
            let predicate = predicate.decode_from(&self.interner);
            let object =
                self.hash_first_degree_quads_decode_term(object, &reference_blank_node_identifier);
            let graph_name = self.hash_first_degree_quads_decode_graph_name(
                graph_name,
                &reference_blank_node_identifier,
            );
            nquads.push(if graph_name.is_default_graph() {
                format!("{subject} {predicate} {object} .\n")
            } else {
                format!("{subject} {predicate} {object} {graph_name} .\n")
            });
        }
        // 3)
        nquads.sort();
        // 4)
        Self::hash_function(&nquads.join(""), hash_algorithm)
    }

    fn hash_first_degree_quads_decode_named_or_blank_node(
        &self,
        term: &InternedNamedOrBlankNode,
        reference_blank_node_identifier: &InternedBlankNode,
    ) -> NamedOrBlankNode {
        match term {
            InternedNamedOrBlankNode::NamedNode(t) => t.decode_from(&self.interner).into(),
            InternedNamedOrBlankNode::BlankNode(t) => {
                BlankNodeRef::new_unchecked(if t == reference_blank_node_identifier {
                    "a"
                } else {
                    "z"
                })
                .into()
            }
        }
    }

    fn hash_first_degree_quads_decode_term(
        &self,
        term: &InternedTerm,
        reference_blank_node_identifier: &InternedBlankNode,
    ) -> Term {
        match term {
            InternedTerm::NamedNode(t) => t.decode_from(&self.interner).into(),
            InternedTerm::BlankNode(t) => {
                BlankNodeRef::new_unchecked(if t == reference_blank_node_identifier {
                    "a"
                } else {
                    "z"
                })
                .into()
            }
            InternedTerm::Literal(t) => t.decode_from(&self.interner).into(),
            #[cfg(feature = "rdf-12")]
            InternedTerm::Triple(t) => Triple::new(
                self.hash_first_degree_quads_decode_named_or_blank_node(
                    &t.subject,
                    reference_blank_node_identifier,
                ),
                t.predicate.decode_from(&self.interner),
                self.hash_first_degree_quads_decode_term(
                    &t.object,
                    reference_blank_node_identifier,
                ),
            )
            .into(),
        }
    }

    fn hash_first_degree_quads_decode_graph_name(
        &self,
        term: &InternedGraphName,
        reference_blank_node_identifier: &InternedBlankNode,
    ) -> GraphName {
        match term {
            InternedGraphName::NamedNode(t) => t.decode_from(&self.interner).into(),
            InternedGraphName::BlankNode(t) => {
                BlankNodeRef::new_unchecked(if t == reference_blank_node_identifier {
                    "a"
                } else {
                    "z"
                })
                .into()
            }
            InternedGraphName::DefaultGraph => GraphName::DefaultGraph,
        }
    }

    /// RDFC [Hash Related Blank Node](https://www.w3.org/TR/rdf-canon/#hash-related-blank-node)
    fn hash_related_blank_node(
        &self,
        canonicalization_state: &CanonicalizationState<'_>,
        related: InternedBlankNode,
        quad: &(
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
            InternedGraphName,
        ),
        issuer: &IdentifierIssuer,
        position: &str,
        hash_algorithm: Option<CanonicalizationHashAlgorithm>,
    ) -> String {
        // 1)
        let mut input = position.to_owned();
        // 2)
        if position != "g" {
            input.push('<');
            input.push_str(quad.1.decode_from(&self.interner).as_str());
            input.push('>');
        }
        // 3)
        if let Some(id) = canonicalization_state
            .canonical_issuer
            .issued_identifier_map
            .get(&related)
            .or_else(|| issuer.issued_identifier_map.get(&related))
        {
            input.push_str("_:");
            input.push_str(id.as_str());
        } else {
            // 4)
            input.push_str(&self.hash_first_degree_quads(
                canonicalization_state,
                related,
                hash_algorithm,
            ));
        }
        // 5)
        Self::hash_function(&input, hash_algorithm)
    }

    /// RDFC [Hash N Degree Quads](https://www.w3.org/TR/rdf-canon/#hash-nd-quads)
    fn hash_n_degree_quads(
        &self,
        canonicalization_state: &CanonicalizationState<'_>,
        identifier: InternedBlankNode,
        issuer: &IdentifierIssuer,
        algorithm: CanonicalizationAlgorithm,
        hash_algorithm: Option<CanonicalizationHashAlgorithm>,
        n_degree_call_budget: &mut NdegreeCallBudget,
    ) -> Result<(IdentifierIssuer, String), CanonicalizationError> {
        n_degree_call_budget.consume()?;
        let mut issuer = issuer.clone();
        // 1)
        let mut h_n = BTreeMap::<_, HashSet<_>>::new();
        // 2)
        let quads = &canonicalization_state.blank_node_to_quads_map[&identifier];
        // 3)
        for quad in quads {
            // 3.1)
            if let InternedNamedOrBlankNode::BlankNode(component) = quad.0 {
                self.hash_related_blank_node_on_possible_component(
                    canonicalization_state,
                    component,
                    identifier,
                    quad,
                    &issuer,
                    "s",
                    &mut h_n,
                    hash_algorithm,
                );
            }
            if let InternedTerm::BlankNode(component) = quad.2 {
                self.hash_related_blank_node_on_possible_component(
                    canonicalization_state,
                    component,
                    identifier,
                    quad,
                    &issuer,
                    "o",
                    &mut h_n,
                    hash_algorithm,
                );
            }
            #[cfg(feature = "rdf-12")]
            if let InternedTerm::Triple(t) = &quad.2 {
                self.hash_related_blank_node_on_possible_triple(
                    canonicalization_state,
                    t,
                    identifier,
                    quad,
                    &issuer,
                    &mut h_n,
                    hash_algorithm,
                );
            }
            if let InternedGraphName::BlankNode(component) = quad.3 {
                self.hash_related_blank_node_on_possible_component(
                    canonicalization_state,
                    component,
                    identifier,
                    quad,
                    &issuer,
                    "g",
                    &mut h_n,
                    hash_algorithm,
                );
            }
        }
        // 4)
        let mut data_to_hash = String::new();
        // 5)
        for (related_hash, blank_node_list) in h_n {
            // 5.1)
            data_to_hash.push_str(&related_hash);
            // 5.2)
            let mut chosen_path = String::new();
            // 5.3)
            let mut chosen_issuer = IdentifierIssuer::new("");
            // 5.4)
            let mut blank_node_list = blank_node_list.into_iter().collect::<Vec<_>>();
            blank_node_list.sort_unstable();
            'perm: for p in Permutations::new(blank_node_list) {
                // 5.4.1)
                let mut issuer_copy = issuer.clone();
                // 5.4.2)
                let mut path = String::new();
                // 5.4.3)
                let mut recursion_list = Vec::new();
                // 5.4.4)
                for related in p {
                    // 5.4.4.1)
                    if let Some(id) = canonicalization_state
                        .canonical_issuer
                        .issued_identifier_map
                        .get(&related)
                    {
                        path.push_str("_:");
                        path.push_str(id.as_str());
                    } else {
                        // 5.4.4.2)
                        // 5.4.4.2.1)
                        if !issuer_copy.issued_identifier_map.contains_key(&related) {
                            recursion_list.push(related);
                        }
                        // 5.4.4.2.2)
                        let id = Self::issue_identifier(
                            &mut issuer_copy,
                            related,
                            algorithm,
                            &related_hash,
                        );
                        path.push_str("_:");
                        path.push_str(id.as_str());
                    }
                    // 5.4.4.3)
                    if !chosen_path.is_empty()
                        && path.len() >= chosen_path.len()
                        && path > chosen_path
                    {
                        continue 'perm;
                    }
                }
                // 5.4.5)
                for related in recursion_list {
                    // 5.4.5.1)
                    let (result_identifier_issuer, result_hash) = self.hash_n_degree_quads(
                        canonicalization_state,
                        related,
                        &issuer_copy,
                        algorithm,
                        hash_algorithm,
                        n_degree_call_budget,
                    )?;
                    // 5.4.5.2)
                    let id =
                        Self::issue_identifier(&mut issuer_copy, related, algorithm, &result_hash);
                    path.push_str("_:");
                    path.push_str(id.as_str());
                    // 5.4.5.3)
                    path.push('<');
                    path.push_str(&result_hash);
                    path.push('>');
                    // 5.4.5.4)
                    issuer_copy = result_identifier_issuer;
                    // 5.4.5.5)
                    if !chosen_path.is_empty()
                        && path.len() >= chosen_path.len()
                        && path > chosen_path
                    {
                        continue 'perm;
                    }
                }
                // 5.4.6)
                if chosen_path.is_empty() || path < chosen_path {
                    chosen_path = path;
                    chosen_issuer = issuer_copy;
                }
            }
            // 5.5)
            data_to_hash.push_str(&chosen_path);
            // 5.6)
            issuer = chosen_issuer;
        }
        // 6)
        Ok((issuer, Self::hash_function(&data_to_hash, hash_algorithm)))
    }

    #[cfg(feature = "rdf-12")]
    fn hash_related_blank_node_on_possible_triple(
        &self,
        canonicalization_state: &CanonicalizationState<'_>,
        triple: &InternedTriple,
        identifier: InternedBlankNode,
        quad: &(
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
            InternedGraphName,
        ),
        issuer: &IdentifierIssuer,
        h_n: &mut BTreeMap<String, HashSet<InternedBlankNode>>,
        hash_algorithm: Option<CanonicalizationHashAlgorithm>,
    ) {
        if let InternedNamedOrBlankNode::BlankNode(component) = triple.subject {
            self.hash_related_blank_node_on_possible_component(
                canonicalization_state,
                component,
                identifier,
                quad,
                issuer,
                "os",
                h_n,
                hash_algorithm,
            );
        }
        if let InternedTerm::BlankNode(component) = &triple.object {
            self.hash_related_blank_node_on_possible_component(
                canonicalization_state,
                *component,
                identifier,
                quad,
                issuer,
                "oo",
                h_n,
                hash_algorithm,
            );
        }
    }

    fn hash_related_blank_node_on_possible_component(
        &self,
        canonicalization_state: &CanonicalizationState<'_>,
        component: InternedBlankNode,
        identifier: InternedBlankNode,
        quad: &(
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
            InternedGraphName,
        ),
        issuer: &IdentifierIssuer,
        position: &str,
        h_n: &mut BTreeMap<String, HashSet<InternedBlankNode>>,
        hash_algorithm: Option<CanonicalizationHashAlgorithm>,
    ) {
        if component != identifier {
            // 3.1.1)
            let hash = self.hash_related_blank_node(
                canonicalization_state,
                component,
                quad,
                issuer,
                position,
                hash_algorithm,
            );
            // 3.1.2)
            h_n.entry(hash).or_default().insert(component);
        }
    }

    fn hash_function(input: &str, hash_algorithm: Option<CanonicalizationHashAlgorithm>) -> String {
        match hash_algorithm {
            #[cfg(feature = "rdfc-10")]
            Some(CanonicalizationHashAlgorithm::Sha256) => {
                hex::encode(Sha256::new().chain_update(input).finalize())
            }
            #[cfg(feature = "rdfc-10")]
            Some(CanonicalizationHashAlgorithm::Sha384) => {
                hex::encode(Sha384::new().chain_update(input).finalize())
            }
            None => {
                let mut hasher = DefaultHasher::new();
                input.hash(&mut hasher);
                hasher.finish().to_string()
            }
        }
    }

    #[expect(clippy::needless_collect)]
    fn map_named_graph_blank_nodes(
        &mut self,
        bnode_mapping: &HashMap<InternedBlankNode, BlankNode>,
    ) -> Vec<InternedGraphName> {
        let old_named_graphs = self.named_graphs.iter().copied().collect::<Vec<_>>();
        old_named_graphs
            .into_iter()
            .map(|graph_name| match graph_name {
                InternedGraphName::NamedNode(_) => graph_name,
                InternedGraphName::BlankNode(blank_node) => {
                    InternedGraphName::BlankNode(InternedBlankNode::encoded_into(
                        bnode_mapping[&blank_node].clone(),
                        &mut self.interner,
                    ))
                }
                InternedGraphName::DefaultGraph => {
                    unreachable!("the default graph is not a named graph")
                }
            })
            .collect()
    }

    #[expect(clippy::needless_collect)]
    fn map_blank_nodes(
        &mut self,
        bnode_mapping: &HashMap<InternedBlankNode, BlankNode>,
    ) -> Vec<(
        InternedNamedOrBlankNode,
        InternedNamedNode,
        InternedTerm,
        InternedGraphName,
    )> {
        let old_quads: Vec<_> = self.spog.iter().cloned().collect();
        old_quads
            .into_iter()
            .map(|(s, p, o, g)| {
                (
                    match s {
                        InternedNamedOrBlankNode::NamedNode(_) => s,
                        InternedNamedOrBlankNode::BlankNode(bnode) => {
                            InternedNamedOrBlankNode::BlankNode(InternedBlankNode::encoded_into(
                                bnode_mapping[&bnode].clone(),
                                &mut self.interner,
                            ))
                        }
                    },
                    p,
                    match o {
                        InternedTerm::NamedNode(_) | InternedTerm::Literal(_) => o,
                        InternedTerm::BlankNode(bnode) => {
                            InternedTerm::BlankNode(InternedBlankNode::encoded_into(
                                bnode_mapping[&bnode].clone(),
                                &mut self.interner,
                            ))
                        }
                        #[cfg(feature = "rdf-12")]
                        InternedTerm::Triple(triple) => {
                            InternedTerm::Triple(Box::new(InternedTriple::encoded_into(
                                self.map_triple_blank_nodes(&triple, bnode_mapping),
                                &mut self.interner,
                            )))
                        }
                    },
                    match g {
                        InternedGraphName::NamedNode(_) | InternedGraphName::DefaultGraph => g,
                        InternedGraphName::BlankNode(bnode) => {
                            InternedGraphName::BlankNode(InternedBlankNode::encoded_into(
                                bnode_mapping[&bnode].clone(),
                                &mut self.interner,
                            ))
                        }
                    },
                )
            })
            .collect()
    }

    #[cfg(feature = "rdf-12")]
    fn map_triple_blank_nodes(
        &mut self,
        triple: &InternedTriple,
        bnode_mapping: &HashMap<InternedBlankNode, BlankNode>,
    ) -> Triple {
        Triple {
            subject: if let InternedNamedOrBlankNode::BlankNode(bnode) = &triple.subject {
                bnode_mapping[bnode].clone().into()
            } else {
                triple.subject.decode_from(&self.interner)
            },
            predicate: triple.predicate.decode_from(&self.interner),
            object: if let InternedTerm::BlankNode(bnode) = &triple.object {
                bnode_mapping[bnode].clone().into()
            } else if let InternedTerm::Triple(t) = &triple.object {
                self.map_triple_blank_nodes(t, bnode_mapping).into()
            } else {
                triple.object.decode_from(&self.interner)
            },
        }
    }
}

impl PartialEq for Dataset {
    fn eq(&self, other: &Self) -> bool {
        if self.len() != other.len() || self.named_graphs.len() != other.named_graphs.len() {
            return false;
        }
        for graph_name in self.named_graphs() {
            if !other.contains_named_graph(&graph_name) {
                return false;
            }
        }
        for q in self {
            if !other.contains(&q) {
                return false;
            }
        }
        true
    }
}

impl Eq for Dataset {}

impl<'a> IntoIterator for &'a Dataset {
    type Item = Quad;
    type IntoIter = Iter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<Q: Into<Quad>> FromIterator<Q> for Dataset {
    fn from_iter<I: IntoIterator<Item = Q>>(iter: I) -> Self {
        let mut g = Self::new();
        g.extend(iter);
        g
    }
}

impl<Q: Into<Quad>> Extend<Q> for Dataset {
    fn extend<I: IntoIterator<Item = Q>>(&mut self, iter: I) {
        for q in iter {
            self.insert(q);
        }
    }
}

/// Formats dataset quads using N-Quads-style lines.
///
/// Empty named graphs have no line representation and are omitted. Use a TriG
/// or JSON-LD dataset serializer when complete dataset topology must be preserved.
impl fmt::Display for Dataset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for t in self {
            writeln!(f, "{t} .")?;
        }
        Ok(())
    }
}

/// A read-only view on an [RDF graph](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-graph) contained in a [`Dataset`].
///
/// It is built using the [`Dataset::graph`] method.
///
/// Usage example:
/// ```
/// use oxrdf::*;
///
/// let mut dataset = Dataset::default();
/// let ex = NamedNode::new("http://example.com")?;
/// dataset.insert(Quad::new(ex.clone(), ex.clone(), ex.clone(), ex.clone()));
///
/// let results: Vec<_> = dataset.graph(&ex).iter().collect();
/// assert_eq!(vec![Triple::new(ex.clone(), ex.clone(), ex)], results);
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[derive(Clone, Debug)]
pub struct GraphView<'a> {
    dataset: &'a Dataset,
    graph_name: InternedGraphName,
}

impl<'a> GraphView<'a> {
    /// Checks whether this graph is present in the dataset.
    ///
    /// The default graph is always present. Named graphs may be present even
    /// when they contain no triples.
    pub fn is_present(&self) -> bool {
        matches!(self.graph_name, InternedGraphName::DefaultGraph)
            || self.dataset.named_graphs.contains(&self.graph_name)
    }

    /// Returns all the triples contained by the graph.
    pub fn iter(&self) -> GraphViewIter<'a> {
        let iter = self.dataset.gspo.range(
            &(
                self.graph_name,
                InternedNamedOrBlankNode::first(),
                InternedNamedNode::first(),
                InternedTerm::first(),
            )
                ..&(
                    self.graph_name.next(),
                    InternedNamedOrBlankNode::first(),
                    InternedNamedNode::first(),
                    InternedTerm::first(),
                ),
        );
        GraphViewIter {
            dataset: self.dataset,
            inner: iter,
        }
    }

    pub fn triples_for_subject<'b>(
        &self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
    ) -> impl Iterator<Item = Triple> + 'a {
        self.triples_for_interned_subject(self.dataset.encoded_named_or_blank_node(subject))
    }

    pub(super) fn triples_for_interned_subject(
        &self,
        subject: Option<InternedNamedOrBlankNode>,
    ) -> impl Iterator<Item = Triple> + use<'a> {
        let subject = subject.unwrap_or_else(InternedNamedOrBlankNode::impossible);
        let ds = self.dataset;
        self.dataset
            .gspo
            .range(
                &(
                    self.graph_name,
                    subject,
                    InternedNamedNode::first(),
                    InternedTerm::first(),
                )
                    ..&(
                        self.graph_name,
                        subject.next(),
                        InternedNamedNode::first(),
                        InternedTerm::first(),
                    ),
            )
            .map(move |q| {
                let (_, s, p, o) = q;
                ds.decode_spo((s, p, o))
            })
    }

    pub fn objects_for_subject_predicate<'b>(
        &self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
        predicate: impl Into<NamedNodeRef<'b>>,
    ) -> impl Iterator<Item = Term> + 'a {
        self.objects_for_interned_subject_predicate(
            self.dataset.encoded_named_or_blank_node(subject),
            self.dataset.encoded_named_node(predicate),
        )
    }

    pub(super) fn objects_for_interned_subject_predicate(
        &self,
        subject: Option<InternedNamedOrBlankNode>,
        predicate: Option<InternedNamedNode>,
    ) -> impl Iterator<Item = Term> + use<'a> {
        let subject = subject.unwrap_or_else(InternedNamedOrBlankNode::impossible);
        let predicate = predicate.unwrap_or_else(InternedNamedNode::impossible);
        let ds = self.dataset;
        self.dataset
            .gspo
            .range(
                &(self.graph_name, subject, predicate, InternedTerm::first())
                    ..&(
                        self.graph_name,
                        subject,
                        predicate.next(),
                        InternedTerm::first(),
                    ),
            )
            .map(move |q| q.3.decode_from(&ds.interner))
    }

    pub fn object_for_subject_predicate<'b>(
        &self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
        predicate: impl Into<NamedNodeRef<'b>>,
    ) -> Option<Term> {
        self.objects_for_subject_predicate(subject, predicate)
            .next()
    }

    pub fn predicates_for_subject_object<'b>(
        &self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
        object: impl Into<TermRef<'b>>,
    ) -> impl Iterator<Item = NamedNode> + 'a {
        self.predicates_for_interned_subject_object(
            self.dataset.encoded_named_or_blank_node(subject),
            self.dataset.encoded_term(object),
        )
    }

    pub(super) fn predicates_for_interned_subject_object(
        &self,
        subject: Option<InternedNamedOrBlankNode>,
        object: Option<InternedTerm>,
    ) -> impl Iterator<Item = NamedNode> + use<'a> {
        let subject = subject.unwrap_or_else(InternedNamedOrBlankNode::impossible);
        let object = object.unwrap_or_else(InternedTerm::impossible);
        let ds = self.dataset;
        self.dataset
            .gosp
            .range(
                &(
                    self.graph_name,
                    object.clone(),
                    subject,
                    InternedNamedNode::first(),
                )
                    ..&(
                        self.graph_name,
                        object,
                        subject.next(),
                        InternedNamedNode::first(),
                    ),
            )
            .map(move |q| q.3.decode_from(&ds.interner))
    }

    pub fn triples_for_predicate<'b>(
        &self,
        predicate: impl Into<NamedNodeRef<'b>>,
    ) -> impl Iterator<Item = Triple> + 'a {
        self.triples_for_interned_predicate(self.dataset.encoded_named_node(predicate))
    }

    pub(super) fn triples_for_interned_predicate(
        &self,
        predicate: Option<InternedNamedNode>,
    ) -> impl Iterator<Item = Triple> + use<'a> {
        let predicate = predicate.unwrap_or_else(InternedNamedNode::impossible);
        let ds = self.dataset;
        self.dataset
            .gpos
            .range(
                &(
                    self.graph_name,
                    predicate,
                    InternedTerm::first(),
                    InternedNamedOrBlankNode::first(),
                )
                    ..&(
                        self.graph_name,
                        predicate.next(),
                        InternedTerm::first(),
                        InternedNamedOrBlankNode::first(),
                    ),
            )
            .map(move |(_, p, o, s)| ds.decode_spo((s, p, o)))
    }

    pub fn subjects_for_predicate_object<'b>(
        &self,
        predicate: impl Into<NamedNodeRef<'b>>,
        object: impl Into<TermRef<'b>>,
    ) -> impl Iterator<Item = NamedOrBlankNode> + 'a {
        self.subjects_for_interned_predicate_object(
            self.dataset.encoded_named_node(predicate),
            self.dataset.encoded_term(object),
        )
    }

    pub(super) fn subjects_for_interned_predicate_object(
        &self,
        predicate: Option<InternedNamedNode>,
        object: Option<InternedTerm>,
    ) -> impl Iterator<Item = NamedOrBlankNode> + use<'a> {
        let predicate = predicate.unwrap_or_else(InternedNamedNode::impossible);
        let object = object.unwrap_or_else(InternedTerm::impossible);
        let ds = self.dataset;
        self.dataset
            .gpos
            .range(
                &(
                    self.graph_name,
                    predicate,
                    object.clone(),
                    InternedNamedOrBlankNode::first(),
                )
                    ..&(
                        self.graph_name,
                        predicate,
                        object.next(),
                        InternedNamedOrBlankNode::first(),
                    ),
            )
            .map(move |q| q.3.decode_from(&ds.interner))
    }

    pub fn subject_for_predicate_object<'b>(
        &self,
        predicate: impl Into<NamedNodeRef<'b>>,
        object: impl Into<TermRef<'b>>,
    ) -> Option<NamedOrBlankNode> {
        self.subjects_for_predicate_object(predicate, object).next()
    }

    pub fn triples_for_object<'b>(
        &self,
        object: impl Into<TermRef<'b>>,
    ) -> impl Iterator<Item = Triple> + 'a {
        self.triples_for_interned_object(self.dataset.encoded_term(object))
    }

    pub(super) fn triples_for_interned_object(
        &self,
        object: Option<InternedTerm>,
    ) -> impl Iterator<Item = Triple> + use<'a> {
        let object = object.unwrap_or_else(InternedTerm::impossible);
        let ds = self.dataset;
        self.dataset
            .gosp
            .range(
                &(
                    self.graph_name,
                    object.clone(),
                    InternedNamedOrBlankNode::first(),
                    InternedNamedNode::first(),
                )
                    ..&(
                        self.graph_name,
                        object.next(),
                        InternedNamedOrBlankNode::first(),
                        InternedNamedNode::first(),
                    ),
            )
            .map(move |(_, o, s, p)| ds.decode_spo((s, p, o)))
    }

    /// Retrieves triples with a filter on each triple component
    pub fn triples_for_pattern(
        &self,
        subject: Option<NamedOrBlankNodeRef<'a>>,
        predicate: Option<NamedNodeRef<'a>>,
        object: Option<TermRef<'a>>,
    ) -> impl Iterator<Item = Triple> + 'a {
        let iter: Box<dyn Iterator<Item = _>> = match (subject, predicate, object) {
            (Some(subject), Some(predicate), Some(object)) => {
                let triple = Triple::new(subject, predicate, object);
                Box::new(self.contains(&triple).then_some(triple).into_iter())
            }
            (Some(subject), Some(predicate), None) => Box::new(
                self.objects_for_subject_predicate(subject, predicate)
                    .map(move |object| Triple::new(subject, predicate, object)),
            ),
            (Some(subject), None, Some(object)) => Box::new(
                self.predicates_for_subject_object(subject, object)
                    .map(move |predicate| Triple::new(subject, predicate, object)),
            ),
            (Some(subject), None, None) => Box::new(self.triples_for_subject(subject)),
            (None, Some(predicate), Some(object)) => Box::new(
                self.subjects_for_predicate_object(predicate, object)
                    .map(move |subject| Triple::new(subject, predicate, object)),
            ),
            (None, Some(predicate), None) => Box::new(self.triples_for_predicate(predicate)),
            (None, None, Some(object)) => Box::new(self.triples_for_object(object)),
            (None, None, None) => Box::new(self.iter()),
        };
        iter
    }

    /// Checks if the graph contains the given triple.
    pub fn contains<'b>(&self, triple: impl Into<TripleRef<'b>>) -> bool {
        if let Some(triple) = self.encoded_triple(triple.into()) {
            self.dataset.gspo.contains(&(
                self.graph_name,
                triple.subject,
                triple.predicate,
                triple.object,
            ))
        } else {
            false
        }
    }

    /// Returns the number of triples in this graph.
    pub fn len(&self) -> usize {
        self.iter().count()
    }

    /// Checks if this graph contains a triple.
    pub fn is_empty(&self) -> bool {
        self.iter().next().is_none()
    }

    fn encoded_triple(&self, triple: TripleRef<'_>) -> Option<InternedTriple> {
        Some(InternedTriple {
            subject: self.dataset.encoded_named_or_blank_node(triple.subject)?,
            predicate: self.dataset.encoded_named_node(triple.predicate)?,
            object: self.dataset.encoded_term(triple.object)?,
        })
    }
}

impl<'a> IntoIterator for GraphView<'a> {
    type Item = Triple;
    type IntoIter = GraphViewIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'a> IntoIterator for &GraphView<'a> {
    type Item = Triple;
    type IntoIter = GraphViewIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl fmt::Display for GraphView<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for t in self {
            writeln!(f, "{t} .")?;
        }
        Ok(())
    }
}

/// A read/write view on an [RDF graph](https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-graph) contained in a [`Dataset`].
///
/// It is built using the [`Dataset::graph_mut`] method.
///
/// Usage example:
/// ```
/// use oxrdf::*;
///
/// let mut dataset = Dataset::default();
/// let ex = NamedNode::new("http://example.com")?;
///
/// // We edit and query the dataset http://example.com graph
/// {
///     let mut graph = dataset.graph_mut(ex.clone());
///     graph.insert(Triple::new(ex.clone(), ex.clone(), ex.clone()));
///     let results: Vec<_> = graph.iter().collect();
///     assert_eq!(
///         vec![Triple::new(ex.clone(), ex.clone(), ex.clone())],
///         results
///     );
/// }
///
/// // We have also changes the dataset itself
/// let results: Vec<_> = dataset.iter().collect();
/// assert_eq!(
///     vec![Quad::new(ex.clone(), ex.clone(), ex.clone(), ex)],
///     results
/// );
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[derive(Debug)]
pub struct GraphViewMut<'a> {
    dataset: &'a mut Dataset,
    graph_name: InternedGraphName,
}

impl<'a> GraphViewMut<'a> {
    fn read(&self) -> GraphView<'_> {
        GraphView {
            dataset: self.dataset,
            graph_name: self.graph_name,
        }
    }

    /// Adds a triple to the graph.
    pub fn insert(&mut self, triple: impl Into<Triple>) -> bool {
        let triple = self.encode_triple(triple.into());
        self.dataset.insert_encoded((
            triple.subject,
            triple.predicate,
            triple.object,
            self.graph_name,
        ))
    }

    /// Removes a concrete triple from the graph.
    pub fn remove<'b>(&mut self, triple: impl Into<TripleRef<'b>>) -> bool {
        if let Some(triple) = self.read().encoded_triple(triple.into()) {
            self.dataset.remove_encoded((
                triple.subject,
                triple.predicate,
                triple.object,
                self.graph_name,
            ))
        } else {
            false
        }
    }

    /// Clears all triples from this graph.
    ///
    /// A named graph remains present in the dataset after it is cleared.
    pub fn clear(&mut self) {
        self.dataset.clear_encoded_graph(self.graph_name);
    }

    fn encode_triple(&mut self, triple: Triple) -> InternedTriple {
        InternedTriple {
            subject: InternedNamedOrBlankNode::encoded_into(
                triple.subject,
                &mut self.dataset.interner,
            ),
            predicate: InternedNamedNode::encoded_into(
                triple.predicate,
                &mut self.dataset.interner,
            ),
            object: InternedTerm::encoded_into(triple.object, &mut self.dataset.interner),
        }
    }

    /// Returns all the triples contained by the graph
    pub fn iter(&'a self) -> GraphViewIter<'a> {
        self.read().iter()
    }

    pub fn triples_for_subject<'b>(
        &'a self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
    ) -> impl Iterator<Item = Triple> + 'a {
        self.read()
            .triples_for_interned_subject(self.dataset.encoded_named_or_blank_node(subject))
    }

    pub fn objects_for_subject_predicate<'b>(
        &'a self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
        predicate: impl Into<NamedNodeRef<'b>>,
    ) -> impl Iterator<Item = Term> + 'a {
        self.read().objects_for_interned_subject_predicate(
            self.dataset.encoded_named_or_blank_node(subject),
            self.dataset.encoded_named_node(predicate),
        )
    }

    pub fn object_for_subject_predicate<'b>(
        &'a self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
        predicate: impl Into<NamedNodeRef<'b>>,
    ) -> Option<Term> {
        self.read().object_for_subject_predicate(subject, predicate)
    }

    pub fn predicates_for_subject_object<'b>(
        &'a self,
        subject: impl Into<NamedOrBlankNodeRef<'b>>,
        object: impl Into<TermRef<'b>>,
    ) -> impl Iterator<Item = NamedNode> + 'a {
        self.read().predicates_for_interned_subject_object(
            self.dataset.encoded_named_or_blank_node(subject),
            self.dataset.encoded_term(object),
        )
    }

    pub fn triples_for_predicate<'b>(
        &'a self,
        predicate: impl Into<NamedNodeRef<'b>>,
    ) -> impl Iterator<Item = Triple> + 'a {
        self.read()
            .triples_for_interned_predicate(self.dataset.encoded_named_node(predicate))
    }

    pub fn subjects_for_predicate_object<'b>(
        &'a self,
        predicate: impl Into<NamedNodeRef<'b>>,
        object: impl Into<TermRef<'b>>,
    ) -> impl Iterator<Item = NamedOrBlankNode> + 'a {
        self.read().subjects_for_interned_predicate_object(
            self.dataset.encoded_named_node(predicate),
            self.dataset.encoded_term(object),
        )
    }

    pub fn subject_for_predicate_object<'b>(
        &'a self,
        predicate: impl Into<NamedNodeRef<'b>>,
        object: impl Into<TermRef<'b>>,
    ) -> Option<NamedOrBlankNode> {
        self.read().subject_for_predicate_object(predicate, object)
    }

    pub fn triples_for_object<'b>(
        &'a self,
        object: TermRef<'b>,
    ) -> impl Iterator<Item = Triple> + 'a {
        self.read()
            .triples_for_interned_object(self.dataset.encoded_term(object))
    }

    /// Checks if the graph contains the given triple.
    pub fn contains<'b>(&self, triple: impl Into<TripleRef<'b>>) -> bool {
        self.read().contains(triple)
    }

    /// Returns the number of triples in this graph.
    pub fn len(&self) -> usize {
        self.read().len()
    }

    /// Checks if this graph contains a triple.
    pub fn is_empty(&self) -> bool {
        self.read().is_empty()
    }

    /// Checks whether this graph is present in the dataset.
    ///
    /// A mutable view creates a named graph when the view is requested, so this
    /// method always returns `true`.
    pub fn is_present(&self) -> bool {
        matches!(self.graph_name, InternedGraphName::DefaultGraph)
            || self.dataset.named_graphs.contains(&self.graph_name)
    }
}

impl<T: Into<Triple>> Extend<T> for GraphViewMut<'_> {
    fn extend<I: IntoIterator<Item = T>>(&mut self, iter: I) {
        for t in iter {
            self.insert(t);
        }
    }
}

impl<'a> IntoIterator for &'a GraphViewMut<'a> {
    type Item = Triple;
    type IntoIter = GraphViewIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl fmt::Display for GraphViewMut<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for t in self {
            writeln!(f, "{t}")?;
        }
        Ok(())
    }
}

/// Iterator returned by [`Dataset::iter`].
pub struct Iter<'a> {
    dataset: &'a Dataset,
    inner: std::collections::btree_set::Iter<
        'a,
        (
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
            InternedGraphName,
        ),
    >,
}

impl Iterator for Iter<'_> {
    type Item = Quad;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner
            .next()
            .map(|(s, p, o, g)| self.dataset.decode_spog((s, p, o, g)))
    }
}

/// Iterator returned by [`Dataset::named_graphs`].
pub struct NamedGraphsIter<'a> {
    dataset: &'a Dataset,
    inner: std::collections::btree_set::Iter<'a, InternedGraphName>,
}

impl Iterator for NamedGraphsIter<'_> {
    type Item = NamedOrBlankNode;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner
            .next()
            .map(|graph_name| self.dataset.decode_named_graph_name(graph_name))
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl ExactSizeIterator for NamedGraphsIter<'_> {}

/// Iterator returned by [`GraphView::iter`].
pub struct GraphViewIter<'a> {
    dataset: &'a Dataset,
    inner: std::collections::btree_set::Range<
        'a,
        (
            InternedGraphName,
            InternedNamedOrBlankNode,
            InternedNamedNode,
            InternedTerm,
        ),
    >,
}

impl Iterator for GraphViewIter<'_> {
    type Item = Triple;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner
            .next()
            .map(|(_, s, p, o)| self.dataset.decode_spo((s, p, o)))
    }
}

type QuadsPerBlankNode<'a> = HashMap<
    InternedBlankNode,
    Vec<&'a (
        InternedNamedOrBlankNode,
        InternedNamedNode,
        InternedTerm,
        InternedGraphName,
    )>,
>;

/// Error raised while canonicalizing an RDF dataset.
#[derive(Debug, Clone, Copy, Eq, PartialEq, thiserror::Error)]
#[non_exhaustive]
pub enum CanonicalizationError {
    /// The configured denial-of-service defense stopped canonicalization.
    #[error(
        "canonicalization exceeded the configured maximum of {maximum} Hash N-Degree Quads calls"
    )]
    TooManyNDegreeCalls {
        /// Maximum number of calls allowed for this operation.
        maximum: usize,
    },
}

/// An algorithm used to canonicalize graph and datasets.
///
/// See [`Graph::canonicalize`] and [`Dataset::canonicalize`].
#[derive(Default, Debug, Clone, Copy, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum CanonicalizationAlgorithm {
    /// The algorithm preferred by OxRDF.
    ///
    /// <div class="warning">The canonicalization algorithm is not stable and canonical blank node ids might change between versions.</div>
    #[default]
    Unstable,
    /// The algorithm preferred by OxRDF but outputting ids based on hashes.
    ///
    /// This enables to use the blank node ids for diffing, additions or deletions of triples affect less blank node ids.
    ///
    /// <div class="warning">The canonicalization algorithm is not stable and canonical blank node ids might change between versions.</div>
    UnstableHashedIds,
    /// The [RDF Canonicalization algorithm version 1.0](https://www.w3.org/TR/rdf-canon/#dfn-rdfc-1-0) parametrized with its used [`CanonicalizationHashAlgorithm`](hash algorithm).
    ///
    /// <div class="warning">Note that the algorithm does not support RDF 1.2, this implementation behavior on triple terms is not part of the standard and might change.</div>
    #[cfg(feature = "rdfc-10")]
    Rdfc10 {
        hash_algorithm: CanonicalizationHashAlgorithm,
    },
}

/// The hash function to use to canonicalize graph and datasets.
///
/// See [`Graph::canonicalize`] and [`Dataset::canonicalize`].
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum CanonicalizationHashAlgorithm {
    #[cfg(feature = "rdfc-10")]
    Sha256,
    #[cfg(feature = "rdfc-10")]
    Sha384,
}

/// A RDFC [canonicalization state](https://www.w3.org/TR/rdf-canon/#canon-state)
struct CanonicalizationState<'a> {
    blank_node_to_quads_map: QuadsPerBlankNode<'a>,
    hash_to_blank_nodes_map: BTreeMap<String, Vec<InternedBlankNode>>,
    canonical_issuer: IdentifierIssuer,
    empty_named_graphs: HashSet<InternedBlankNode>,
}

#[derive(Clone, Copy)]
enum NdegreeCallLimit {
    Default,
    Exact(usize),
    WorkFactor(u32),
}

impl NdegreeCallLimit {
    fn maximum(self, non_unique_blank_nodes: usize) -> usize {
        match self {
            Self::Default => non_unique_blank_nodes,
            Self::Exact(maximum) => maximum,
            Self::WorkFactor(0) => 0,
            Self::WorkFactor(factor) => non_unique_blank_nodes
                .checked_pow(factor)
                .unwrap_or(usize::MAX),
        }
    }
}

struct NdegreeCallBudget {
    maximum: usize,
    remaining: usize,
}

impl NdegreeCallBudget {
    fn new(maximum: usize) -> Self {
        Self {
            maximum,
            remaining: maximum,
        }
    }

    fn consume(&mut self) -> Result<(), CanonicalizationError> {
        if self.remaining == 0 {
            return Err(CanonicalizationError::TooManyNDegreeCalls {
                maximum: self.maximum,
            });
        }
        self.remaining -= 1;
        Ok(())
    }
}

/// A RDFC [identifier issuer](https://www.w3.org/TR/rdf-canon/#dfn-identifier-issuer)
#[derive(Clone)]
struct IdentifierIssuer {
    identifier_prefix: &'static str,
    identifier_counter: u32,
    issued_identifier_map: HashMap<InternedBlankNode, BlankNode>,
    issued_identifier_order: Vec<InternedBlankNode>, /* hack to know the insertion order in the hash map */
    already_issued_identifiers: HashSet<BlankNode>,
}

impl IdentifierIssuer {
    fn new(identifier_prefix: &'static str) -> Self {
        Self {
            identifier_prefix,
            identifier_counter: 0,
            issued_identifier_map: HashMap::new(),
            issued_identifier_order: Vec::new(),
            already_issued_identifiers: HashSet::new(),
        }
    }
}

struct Permutations<T> {
    items: Vec<T>,
    counters: Vec<usize>,
    index: usize,
    first: bool,
}

impl<T: Copy> Permutations<T> {
    fn new(items: Vec<T>) -> Self {
        Self {
            counters: vec![0; items.len()],
            items,
            index: 0,
            first: true,
        }
    }
}

impl<T: Copy> Iterator for Permutations<T> {
    type Item = Vec<T>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.first {
            self.first = false;
            return Some(self.items.clone());
        }
        while self.index < self.items.len() {
            if self.counters[self.index] < self.index {
                if self.index.is_multiple_of(2) {
                    self.items.swap(0, self.index);
                } else {
                    self.items.swap(self.counters[self.index], self.index);
                }
                self.counters[self.index] += 1;
                self.index = 0;
                return Some(self.items.clone());
            }
            self.counters[self.index] = 0;
            self.index += 1;
        }
        None
    }
}

#[cfg(feature = "rdfc-10")]
#[cfg(test)]
#[expect(
    clippy::panic_in_result_fn,
    reason = "assertions provide clearer canonicalization regression failures"
)]
mod tests {
    use super::*;
    use std::error::Error;

    #[test]
    fn test_canon() -> Result<(), Box<dyn Error>> {
        let p = NamedNode::new_unchecked("http://example.com/#p");
        let q = NamedNode::new_unchecked("http://example.com/#q");
        let r = NamedNode::new_unchecked("http://example.com/#r");

        let mut dataset = Dataset::new();
        let e0 = BlankNode::new_unchecked("e0");
        let e1 = BlankNode::new_unchecked("e1");
        let e2 = BlankNode::new_unchecked("e2");
        let e3 = BlankNode::new_unchecked("e3");
        dataset.insert(QuadRef::new(&p, &q, &e0, GraphNameRef::DefaultGraph));
        dataset.insert(QuadRef::new(&p, &q, &e1, GraphNameRef::DefaultGraph));
        dataset.insert(QuadRef::new(&e0, &p, &e2, GraphNameRef::DefaultGraph));
        dataset.insert(QuadRef::new(&e1, &p, &e3, GraphNameRef::DefaultGraph));
        dataset.insert(QuadRef::new(&e2, &r, &e3, GraphNameRef::DefaultGraph));
        dataset.canonicalize(CanonicalizationAlgorithm::Rdfc10 {
            hash_algorithm: CanonicalizationHashAlgorithm::Sha256,
        })?;

        let mut expected = Dataset::new();
        let c14n0 = BlankNode::new_unchecked("c14n0");
        let c14n1 = BlankNode::new_unchecked("c14n1");
        let c14n2 = BlankNode::new_unchecked("c14n2");
        let c14n3 = BlankNode::new_unchecked("c14n3");
        expected.insert(QuadRef::new(&p, &q, &c14n2, GraphNameRef::DefaultGraph));
        expected.insert(QuadRef::new(&p, &q, &c14n3, GraphNameRef::DefaultGraph));
        expected.insert(QuadRef::new(&c14n0, &r, &c14n1, GraphNameRef::DefaultGraph));
        expected.insert(QuadRef::new(&c14n2, &p, &c14n1, GraphNameRef::DefaultGraph));
        expected.insert(QuadRef::new(&c14n3, &p, &c14n0, GraphNameRef::DefaultGraph));
        assert_eq!(dataset, expected);
        Ok(())
    }

    #[test]
    fn n_degree_call_limit_is_fallible_and_atomic() -> Result<(), Box<dyn Error>> {
        let predicate = NamedNode::new_unchecked("http://example.com/p");
        let first = BlankNode::new_unchecked("first");
        let second = BlankNode::new_unchecked("second");
        let mut dataset = Dataset::new();
        dataset.insert(QuadRef::new(
            &first,
            &predicate,
            &second,
            GraphNameRef::DefaultGraph,
        ));
        dataset.insert(QuadRef::new(
            &second,
            &predicate,
            &first,
            GraphNameRef::DefaultGraph,
        ));
        let original = dataset.clone();

        let algorithms = [
            CanonicalizationAlgorithm::Unstable,
            CanonicalizationAlgorithm::UnstableHashedIds,
            CanonicalizationAlgorithm::Rdfc10 {
                hash_algorithm: CanonicalizationHashAlgorithm::Sha256,
            },
        ];
        for algorithm in algorithms {
            let Err(error) = dataset.canonicalize_with_n_degree_call_limit(algorithm, 0) else {
                return Err(std::io::Error::other("zero work budget was not enforced").into());
            };
            assert_eq!(
                error,
                CanonicalizationError::TooManyNDegreeCalls { maximum: 0 }
            );
            assert_eq!(dataset, original);
        }

        dataset.canonicalize_with_n_degree_call_limit(
            CanonicalizationAlgorithm::Rdfc10 {
                hash_algorithm: CanonicalizationHashAlgorithm::Sha256,
            },
            16,
        )?;
        assert_ne!(dataset, original);
        Ok(())
    }
}
