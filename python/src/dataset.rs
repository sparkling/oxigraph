use crate::model::{
    PyBlankNode, PyGraphNameRef, PyNamedNodeRef, PyNamedOrBlankNode, PyNamedOrBlankNodeRef, PyQuad,
    PyTermRef,
};
use oxigraph::model::dataset::{CanonicalizationAlgorithm, CanonicalizationHashAlgorithm, Dataset};
use oxigraph::model::{GraphNameRef, Quad};
use pyo3::exceptions::{PyKeyError, PyRuntimeError, PyValueError};
use pyo3::prelude::*;
use std::collections::HashMap;
use std::fmt;

/// An in-memory `RDF dataset <https://www.w3.org/TR/rdf11-concepts/#dfn-rdf-dataset>`_.
///
/// It can accommodate a fairly large number of quads (in the few millions).
///
/// Use :py:class:`Store` if you need on-disk persistence or SPARQL.
///
/// Warning: It interns the strings and does not do any garbage collection yet:
/// if you insert and remove a lot of different terms, memory will grow without any reduction.
///
/// :param quads: some quads to initialize the dataset with.
/// :type quads: collections.abc.Iterable[Quad] or None, optional
/// :param named_graphs: named graphs to initialize, including empty graphs.
/// :type named_graphs: collections.abc.Iterable[NamedNode or BlankNode] or None, optional
///
/// The :py:class:`str` function provides an N-Quads serialization:
///
/// >>> str(Dataset([Quad(NamedNode('http://example.com/s'), NamedNode('http://example.com/p'), NamedNode('http://example.com/o'), NamedNode('http://example.com/g'))]))
/// '<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .\n'
#[pyclass(name = "Dataset", module = "pyoxigraph", eq, str)]
#[derive(Eq, PartialEq, Debug)]
pub struct PyDataset {
    inner: Dataset,
}

#[pymethods]
impl PyDataset {
    #[new]
    #[pyo3(signature = (quads = None, *, named_graphs = None))]
    fn new(
        quads: Option<&Bound<'_, PyAny>>,
        named_graphs: Option<&Bound<'_, PyAny>>,
    ) -> PyResult<Self> {
        let mut inner = Dataset::new();
        if let Some(quads) = quads {
            for quad in quads.try_iter()? {
                inner.insert(quad?.extract::<PyQuad>()?);
            }
        }
        if let Some(named_graphs) = named_graphs {
            for graph_name in named_graphs.try_iter()? {
                inner.insert_named_graph(graph_name?.extract::<PyNamedOrBlankNode>()?);
            }
        }
        Ok(Self { inner })
    }

    /// Looks for the quads with the given subject.
    ///
    /// :param subject: the quad subject.
    /// :type subject: NamedNode or BlankNode or Triple
    /// :return: an iterator of the quads.
    /// :rtype: collections.abc.Iterator[Quad]
    ///
    /// >>> store = Dataset([Quad(NamedNode('http://example.com'), NamedNode('http://example.com/p'), Literal('1'), NamedNode('http://example.com/g'))])
    /// >>> list(store.quads_for_subject(NamedNode('http://example.com')))
    /// [<Quad subject=<NamedNode value=http://example.com> predicate=<NamedNode value=http://example.com/p> object=<Literal value=1 datatype=<NamedNode value=http://www.w3.org/2001/XMLSchema#string>> graph_name=<NamedNode value=http://example.com/g>>]
    #[expect(clippy::needless_pass_by_value)]
    fn quads_for_subject(&self, subject: PyNamedOrBlankNodeRef<'_>) -> QuadIter {
        QuadIter {
            inner: self
                .inner
                .quads_for_subject(&subject)
                .collect::<Vec<_>>()
                .into_iter(),
        }
    }

    /// Looks for the quads with the given predicate.
    ///
    /// :param predicate: the quad predicate.
    /// :type predicate: NamedNode
    /// :return: an iterator of the quads.
    /// :rtype: collections.abc.Iterator[Quad]
    ///
    /// >>> store = Dataset([Quad(NamedNode('http://example.com'), NamedNode('http://example.com/p'), Literal('1'), NamedNode('http://example.com/g'))])
    /// >>> list(store.quads_for_predicate(NamedNode('http://example.com/p')))
    /// [<Quad subject=<NamedNode value=http://example.com> predicate=<NamedNode value=http://example.com/p> object=<Literal value=1 datatype=<NamedNode value=http://www.w3.org/2001/XMLSchema#string>> graph_name=<NamedNode value=http://example.com/g>>]
    #[expect(clippy::needless_pass_by_value)]
    fn quads_for_predicate(&self, predicate: PyNamedNodeRef<'_>) -> QuadIter {
        QuadIter {
            inner: self
                .inner
                .quads_for_predicate(&predicate)
                .collect::<Vec<_>>()
                .into_iter(),
        }
    }

    /// Looks for the quads with the given object.
    ///
    /// :param object: the quad object.
    /// :type object: NamedNode or BlankNode or Literal or Triple
    /// :return: an iterator of the quads.
    /// :rtype: collections.abc.Iterator[Quad]
    ///
    /// >>> store = Dataset([Quad(NamedNode('http://example.com'), NamedNode('http://example.com/p'), Literal('1'), NamedNode('http://example.com/g'))])
    /// >>> list(store.quads_for_object(Literal('1')))
    /// [<Quad subject=<NamedNode value=http://example.com> predicate=<NamedNode value=http://example.com/p> object=<Literal value=1 datatype=<NamedNode value=http://www.w3.org/2001/XMLSchema#string>> graph_name=<NamedNode value=http://example.com/g>>]
    #[expect(clippy::needless_pass_by_value)]
    fn quads_for_object(&self, object: PyTermRef<'_>) -> QuadIter {
        QuadIter {
            inner: self
                .inner
                .quads_for_object(&object)
                .collect::<Vec<_>>()
                .into_iter(),
        }
    }

    /// Looks for the quads with the given graph name.
    ///
    /// :param graph_name: the quad graph name.
    /// :type graph_name: NamedNode or BlankNode or DefaultGraph
    /// :return: an iterator of the quads.
    /// :rtype: collections.abc.Iterator[Quad]
    ///
    /// >>> store = Dataset([Quad(NamedNode('http://example.com'), NamedNode('http://example.com/p'), Literal('1'), NamedNode('http://example.com/g'))])
    /// >>> list(store.quads_for_graph_name(NamedNode('http://example.com/g')))
    /// [<Quad subject=<NamedNode value=http://example.com> predicate=<NamedNode value=http://example.com/p> object=<Literal value=1 datatype=<NamedNode value=http://www.w3.org/2001/XMLSchema#string>> graph_name=<NamedNode value=http://example.com/g>>]
    #[expect(clippy::needless_pass_by_value)]
    fn quads_for_graph_name(&self, graph_name: PyGraphNameRef<'_>) -> QuadIter {
        QuadIter {
            inner: self
                .inner
                .quads_for_graph_name(&graph_name)
                .collect::<Vec<_>>()
                .into_iter(),
        }
    }

    /// Adds a quad to the dataset.
    ///
    /// :param quad: the quad to add.
    /// :type quad: Quad
    /// :rtype: None
    ///
    /// >>> quad = Quad(NamedNode('http://example.com/s'), NamedNode('http://example.com/p'), NamedNode('http://example.com/o'), NamedNode('http://example.com/g'))
    /// >>> dataset = Dataset()
    /// >>> dataset.add(quad)
    /// >>> quad in dataset
    /// True
    fn add(&mut self, quad: PyQuad) {
        self.inner.insert(quad);
    }

    /// Removes a quad from the dataset and raises an exception if it is not in the set.
    ///
    /// :param quad: the quad to remove.
    /// :type quad: Quad
    /// :rtype: None
    /// :raises KeyError: if the element was not in the set.
    ///
    /// >>> quad = Quad(NamedNode('http://example.com/s'), NamedNode('http://example.com/p'), NamedNode('http://example.com/o'), NamedNode('http://example.com/g'))
    /// >>> dataset = Dataset([quad])
    /// >>> dataset.remove(quad)
    /// >>> quad in dataset
    /// False
    fn remove(&mut self, quad: &PyQuad) -> PyResult<()> {
        if self.inner.remove(quad.as_ref()) {
            Ok(())
        } else {
            Err(PyKeyError::new_err(format!(
                "{} is not in the Dataset",
                quad.as_ref()
            )))
        }
    }

    /// Removes a quad from the dataset if it is present.
    ///
    /// :param quad: the quad to remove.
    /// :type quad: Quad
    /// :rtype: None
    ///
    /// >>> quad = Quad(NamedNode('http://example.com/s'), NamedNode('http://example.com/p'), NamedNode('http://example.com/o'), NamedNode('http://example.com/g'))
    /// >>> dataset = Dataset([quad])
    /// >>> dataset.discard(quad)
    /// >>> quad in dataset
    /// False
    fn discard(&mut self, quad: &PyQuad) {
        self.inner.remove(quad.as_ref());
    }

    /// Removes all quads from the dataset.
    ///
    /// :rtype: None
    ///
    /// >>> quad = Quad(NamedNode('http://example.com/s'), NamedNode('http://example.com/p'), NamedNode('http://example.com/o'), NamedNode('http://example.com/g'))
    /// >>> dataset = Dataset([quad])
    /// >>> dataset.clear()
    /// >>> len(dataset)
    /// 0
    fn clear(&mut self) {
        self.inner.clear()
    }

    /// Returns all named graphs, including empty named graphs.
    ///
    /// :rtype: list[NamedNode or BlankNode]
    fn named_graphs(&self) -> Vec<PyNamedOrBlankNode> {
        self.inner.named_graphs().map(Into::into).collect()
    }

    /// Returns whether the dataset contains a named graph.
    ///
    /// Empty named graphs are considered present.
    ///
    /// :param graph_name: the named graph to look up.
    /// :type graph_name: NamedNode or BlankNode
    /// :rtype: bool
    #[expect(clippy::needless_pass_by_value)]
    fn contains_named_graph(&self, graph_name: PyNamedOrBlankNodeRef<'_>) -> bool {
        self.inner.contains_named_graph(&graph_name)
    }

    /// Adds a named graph, even if it contains no quads.
    ///
    /// :param graph_name: the named graph to add.
    /// :type graph_name: NamedNode or BlankNode
    /// :rtype: None
    fn add_graph(&mut self, graph_name: PyNamedOrBlankNode) {
        self.inner.insert_named_graph(graph_name);
    }

    /// Clears a graph while retaining named-graph presence.
    ///
    /// :param graph_name: the graph to clear.
    /// :type graph_name: NamedNode or BlankNode or DefaultGraph
    /// :rtype: None
    #[expect(clippy::needless_pass_by_value)]
    fn clear_graph(&mut self, graph_name: PyGraphNameRef<'_>) {
        self.inner.clear_graph(&graph_name);
    }

    /// Removes a named graph and all its quads.
    ///
    /// The default graph is cleared because it is always present.
    ///
    /// :param graph_name: the graph to remove.
    /// :type graph_name: NamedNode or BlankNode or DefaultGraph
    /// :rtype: None
    #[expect(clippy::needless_pass_by_value)]
    fn remove_graph(&mut self, graph_name: PyGraphNameRef<'_>) {
        match GraphNameRef::from(&graph_name) {
            GraphNameRef::NamedNode(graph_name) => {
                self.inner.remove_named_graph(graph_name);
            }
            GraphNameRef::BlankNode(graph_name) => {
                self.inner.remove_named_graph(graph_name);
            }
            GraphNameRef::DefaultGraph => self.inner.clear_graph(GraphNameRef::DefaultGraph),
        }
    }

    /// Tests RDF dataset isomorphism, including empty named-graph topology.
    ///
    /// :param other: the other dataset.
    /// :type other: Dataset
    /// :rtype: bool
    fn is_isomorphic_to(&self, other: &Self) -> PyResult<bool> {
        self.inner
            .is_isomorphic_to(&other.inner)
            .map_err(|error| PyRuntimeError::new_err(error.to_string()))
    }

    /// Canonicalizes the dataset by renaming blank nodes.
    ///
    /// Warning: Blank node ids depend on the current shape of the graph. Adding a new quad might change the ids of a lot of blank nodes.
    /// Hence, this canonization might not be suitable for diffs.
    ///
    /// Canonicalization uses a linear work budget by default and raises
    /// :py:class:`RuntimeError` instead of performing unbounded work.
    /// Trusted callers may select a larger work factor or an exact Hash
    /// N-Degree Quads call limit. The two overrides are mutually exclusive.
    ///
    /// :param algorithm: the canonicalization algorithm to use.
    /// :type algorithm: CanonicalizationAlgorithm
    /// :param max_work_factor: optional exponent for a work-factor-derived call budget.
    /// :type max_work_factor: int or None, optional
    /// :param max_n_degree_calls: optional exact Hash N-Degree Quads call budget.
    /// :type max_n_degree_calls: int or None, optional
    /// :rtype: None
    ///
    /// >>> d1 = Dataset([Quad(BlankNode(), NamedNode('http://example.com/p'), BlankNode())])
    /// >>> d2 = Dataset([Quad(BlankNode(), NamedNode('http://example.com/p'), BlankNode())])
    /// >>> d1 == d2
    /// False
    /// >>> d1.canonicalize(CanonicalizationAlgorithm.UNSTABLE)
    /// >>> d2.canonicalize(CanonicalizationAlgorithm.UNSTABLE)
    /// >>> d1 == d2
    /// True
    #[pyo3(signature = (algorithm, *, max_work_factor = None, max_n_degree_calls = None))]
    fn canonicalize(
        &mut self,
        algorithm: &PyCanonicalizationAlgorithm,
        max_work_factor: Option<u32>,
        max_n_degree_calls: Option<usize>,
    ) -> PyResult<()> {
        let result = match (max_work_factor, max_n_degree_calls) {
            (None, None) => self.inner.canonicalize(algorithm.inner),
            (Some(factor), None) => self
                .inner
                .canonicalize_with_work_factor(algorithm.inner, factor),
            (None, Some(maximum)) => self
                .inner
                .canonicalize_with_n_degree_call_limit(algorithm.inner, maximum),
            (Some(_), Some(_)) => {
                return Err(PyValueError::new_err(
                    "max_work_factor and max_n_degree_calls are mutually exclusive",
                ));
            }
        };
        result.map_err(|error| PyRuntimeError::new_err(error.to_string()))
    }

    /// Returns a map between the current dataset blank node and the canonicalized blank node
    /// to create a canonical dataset.
    ///
    /// See :py:func:`canonicalize` for more details.
    ///
    /// :param algorithm: the canonicalization algorithm to use.
    /// :type algorithm: CanonicalizationAlgorithm
    /// :param max_work_factor: optional exponent for a work-factor-derived call budget.
    /// :type max_work_factor: int or None, optional
    /// :param max_n_degree_calls: optional exact Hash N-Degree Quads call budget.
    /// :type max_n_degree_calls: int or None, optional
    /// :rtype: dict[BlankNode, BlankNode]
    ///
    /// >>> d1 = Dataset([Quad(BlankNode('a'), NamedNode('http://example.com/p'), Literal('b'))])
    /// >>> d1.canonicalize_blank_nodes(CanonicalizationAlgorithm.RDFC_1_0)
    /// {<BlankNode value=a>: <BlankNode value=c14n0>}
    #[pyo3(signature = (algorithm, *, max_work_factor = None, max_n_degree_calls = None))]
    fn canonicalize_blank_nodes(
        &self,
        algorithm: &PyCanonicalizationAlgorithm,
        max_work_factor: Option<u32>,
        max_n_degree_calls: Option<usize>,
    ) -> PyResult<HashMap<PyBlankNode, PyBlankNode>> {
        let result = match (max_work_factor, max_n_degree_calls) {
            (None, None) => self.inner.canonicalize_blank_nodes(algorithm.inner),
            (Some(factor), None) => self
                .inner
                .canonicalize_blank_nodes_with_work_factor(algorithm.inner, factor),
            (None, Some(maximum)) => self
                .inner
                .canonicalize_blank_nodes_with_n_degree_call_limit(algorithm.inner, maximum),
            (Some(_), Some(_)) => {
                return Err(PyValueError::new_err(
                    "max_work_factor and max_n_degree_calls are mutually exclusive",
                ));
            }
        };
        Ok(result
            .map_err(|error| PyRuntimeError::new_err(error.to_string()))?
            .into_iter()
            .map(|(k, v)| (k.into(), v.into()))
            .collect())
    }

    fn __bool__(&self) -> bool {
        !self.inner.is_empty()
    }

    fn __len__(&self) -> usize {
        self.inner.len()
    }

    fn __contains__(&self, quad: &PyQuad) -> bool {
        self.inner.contains(quad.as_ref())
    }

    fn __iter__(&self) -> QuadIter {
        // TODO: very inefficient
        QuadIter {
            inner: self.inner.iter().collect::<Vec<_>>().into_iter(),
        }
    }
}

impl PyDataset {
    pub(crate) fn from_dataset(inner: Dataset) -> Self {
        Self { inner }
    }

    pub(crate) fn as_dataset(&self) -> &Dataset {
        &self.inner
    }
}

impl fmt::Display for PyDataset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.inner.fmt(f)
    }
}

#[pyclass(unsendable, module = "pyoxigraph")]
pub struct QuadIter {
    inner: std::vec::IntoIter<Quad>,
}

#[pymethods]
impl QuadIter {
    fn __iter__(slf: PyRef<'_, Self>) -> PyRef<'_, Self> {
        slf
    }

    fn __next__(&mut self) -> Option<PyQuad> {
        Some(self.inner.next()?.into())
    }
}

/// RDF canonicalization algorithms.
///
/// The following algorithms are supported:
///
/// * :py:attr:`CanonicalizationAlgorithm.UNSTABLE`: an unstable algorithm preferred by PyOxigraph.
/// * :py:attr:`CanonicalizationAlgorithm.RDFC_1_0`: the `RDF Canonicalization algorithm version 1.0 <https://www.w3.org/TR/rdf-canon/#dfn-rdfc-1-0>`_.
/// * :py:attr:`CanonicalizationAlgorithm.RDFC_1_0_SHA_384`: the same algorithm with SHA-384 hash function.
#[pyclass(
    frozen,
    name = "CanonicalizationAlgorithm",
    module = "pyoxigraph",
    eq,
    hash
)]
#[derive(Eq, PartialEq, Hash)]
pub struct PyCanonicalizationAlgorithm {
    inner: CanonicalizationAlgorithm,
}

#[pymethods]
impl PyCanonicalizationAlgorithm {
    /// The algorithm preferred by PyOxigraph.
    ///
    /// Warning: Might change between Oxigraph versions. No stability guaranties.
    #[classattr]
    const UNSTABLE: Self = Self {
        inner: CanonicalizationAlgorithm::Unstable,
    };

    /// The algorithm preferred by PyOxigraph but outputting ids based on hashes.
    ///
    /// This enables to use the blank node ids for diffing, additions or deletions of triples affect less blank node ids.
    ///
    /// Warning: Might change between Oxigraph versions. No stability guaranties.
    #[classattr]
    const UNSTABLE_HASHED_IDS: Self = Self {
        inner: CanonicalizationAlgorithm::UnstableHashedIds,
    };

    /// The `RDF Canonicalization algorithm version 1.0 <https://www.w3.org/TR/rdf-canon/#dfn-rdfc-1-0>`_hash .
    #[classattr]
    const RDFC_1_0: Self = Self::RDFC_1_0_SHA_256;

    /// The `RDF Canonicalization algorithm version 1.0 <https://www.w3.org/TR/rdf-canon/#dfn-rdfc-1-0>`_ with the SHA-256 hash function (this is the default version of the algorithm).
    #[classattr]
    const RDFC_1_0_SHA_256: Self = Self {
        inner: CanonicalizationAlgorithm::Rdfc10 {
            hash_algorithm: CanonicalizationHashAlgorithm::Sha256,
        },
    };

    /// The `RDF Canonicalization algorithm version 1.0 <https://www.w3.org/TR/rdf-canon/#dfn-rdfc-1-0>`_ with the SHA-384 hash function.
    #[classattr]
    const RDFC_1_0_SHA_384: Self = Self {
        inner: CanonicalizationAlgorithm::Rdfc10 {
            hash_algorithm: CanonicalizationHashAlgorithm::Sha384,
        },
    };

    fn __repr__(&self) -> String {
        format!(
            "<CanonicalizationAlgorithm {}>",
            match self.inner {
                CanonicalizationAlgorithm::Unstable => "unstable",
                CanonicalizationAlgorithm::UnstableHashedIds => "unstable with ids based on hashes",
                CanonicalizationAlgorithm::Rdfc10 {
                    hash_algorithm: CanonicalizationHashAlgorithm::Sha256,
                } => "RDFC-1.0 (SHA-256)",
                CanonicalizationAlgorithm::Rdfc10 {
                    hash_algorithm: CanonicalizationHashAlgorithm::Sha384,
                } => "RDFC-1.0 (SHA-384)",
                CanonicalizationAlgorithm::Rdfc10 { .. } => "RDFC-1.0",
                _ => "unknown",
            }
        )
    }

    /// :rtype: CanonicalizationAlgorithm
    fn __copy__(slf: PyRef<'_, Self>) -> PyRef<'_, Self> {
        slf
    }

    /// :type memo: typing.Any
    /// :rtype: CanonicalizationAlgorithm
    #[expect(unused_variables)]
    fn __deepcopy__<'a>(slf: PyRef<'a, Self>, memo: &'_ Bound<'_, PyAny>) -> PyRef<'a, Self> {
        slf
    }
}
