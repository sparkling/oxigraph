#[cfg(feature = "rdfs")]
use super::rdfs_working_dataset;
use super::{
    QueryEntailment, QueryEntailmentError, QueryEntailmentOptions, rdf12_finite, term_graph_name,
};
#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
use super::{reject_reserved_witnesses, visible_dataset};
#[cfg(feature = "rdf-12")]
use crate::model::Triple;
use crate::model::{BlankNode, Dataset, GraphName, NamedOrBlankNode, Quad, Term};
use crate::store::Store;
use spareval::{InternalQuad, QueryDatasetSpecification, QueryableDataset};
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;

/// Owned, repeatable-read dataset used by a query-time entailment profile.
///
/// [`Dataset`] retains named graph topology, including empty named graphs. The
/// separate graph-name sequence provides the term representation required by
/// [`QueryableDataset`]. Prepared queries construct their effective query
/// dataset before materialization, so graphs merged by multiple `FROM` clauses
/// form one active default graph while `GRAPH`-selected named graphs remain
/// independent.
#[derive(Clone, Debug)]
pub struct QueryEntailmentDataset {
    dataset: Dataset,
    named_graphs: Vec<Term>,
    profile: QueryEntailment,
}

impl QueryEntailmentDataset {
    /// Captures a Store snapshot and materializes the selected bounded profile.
    pub fn from_store(
        store: &Store,
        options: &QueryEntailmentOptions,
    ) -> Result<Self, QueryEntailmentError> {
        let (base, named_graphs) = store.snapshot_contents()?;
        Self::from_snapshot(
            base,
            named_graphs.into_iter().map(Term::from).collect(),
            options,
        )
    }

    pub(crate) fn from_store_with_query_dataset(
        store: &Store,
        options: &QueryEntailmentOptions,
        specification: &QueryDatasetSpecification,
    ) -> Result<Self, QueryEntailmentError> {
        let (stored, stored_named_graphs) = store.snapshot_contents()?;
        let (base, named_graphs) =
            effective_query_dataset(&stored, &stored_named_graphs, specification);
        Self::from_snapshot(base, named_graphs, options)
    }

    fn from_snapshot(
        base: Dataset,
        named_graphs: Vec<Term>,
        options: &QueryEntailmentOptions,
    ) -> Result<Self, QueryEntailmentError> {
        options.profile.ensure_supported()?;
        let graph_names = named_graphs
            .iter()
            .filter_map(term_graph_name)
            .collect::<Vec<_>>();
        let dataset = match options.profile {
            QueryEntailment::Simple => base,
            QueryEntailment::Rdf12Finite => rdf12_finite(&base, &graph_names)?,
            QueryEntailment::Rdfs12Finite => {
                #[cfg(feature = "rdfs")]
                {
                    reject_reserved_witnesses(&base, "oxrdfs")?;
                    let working = rdfs_working_dataset(&base, &graph_names);
                    let mut engine_options = crate::rdfs::Rdfs12Options {
                        container_membership_limit: 0,
                        ..crate::rdfs::Rdfs12Options::default()
                    };
                    if options.timeout.is_some() {
                        engine_options.evaluation.limits.timeout = options.timeout;
                    }
                    let closure = crate::rdfs::Rdfs12Finite.evaluate(&working, &engine_options)?;
                    if let crate::rdfs::Rdfs12Consistency::Inconsistent(reasons) =
                        closure.consistency()
                    {
                        return Err(QueryEntailmentError::RdfsInconsistent {
                            reasons: reasons.len(),
                        });
                    }
                    visible_dataset(&base, closure.entailed())
                }
                #[cfg(not(feature = "rdfs"))]
                {
                    unreachable!("profile availability was checked")
                }
            }
            QueryEntailment::Owl2RlRdfBounded => {
                #[cfg(feature = "owl2-rl")]
                {
                    reject_reserved_witnesses(&base, "oxowl")?;
                    let mut engine_options = crate::owl2_rl::Owl2RlRdfOptions::default();
                    if options.timeout.is_some() {
                        engine_options.evaluation.limits.timeout = options.timeout;
                    }
                    let closure = crate::owl2_rl::Owl2RlRdf.evaluate(&base, &engine_options)?;
                    if let crate::owl2_rl::Owl2RlConsistency::Inconsistent(contradictions) =
                        closure.consistency()
                    {
                        return Err(QueryEntailmentError::Owl2RlInconsistent {
                            contradictions: contradictions.len(),
                        });
                    }
                    visible_dataset(&base, closure.entailed())
                }
                #[cfg(not(feature = "owl2-rl"))]
                {
                    unreachable!("profile availability was checked")
                }
            }
        };
        Ok(Self {
            dataset,
            named_graphs,
            profile: options.profile,
        })
    }

    /// Returns the profile used to construct this owned dataset.
    pub const fn profile(&self) -> QueryEntailment {
        self.profile
    }

    /// Returns the owned base-plus-visible-inference dataset.
    pub const fn dataset(&self) -> &Dataset {
        &self.dataset
    }
}

fn effective_query_dataset(
    stored: &Dataset,
    stored_named_graphs: &[NamedOrBlankNode],
    specification: &QueryDatasetSpecification,
) -> (Dataset, Vec<Term>) {
    let mut effective = Dataset::new();
    match specification.default_graph_graphs() {
        Some(graphs) if specification.is_default_dataset() => {
            for graph in graphs {
                copy_graph(stored, graph, graph, &mut effective);
            }
        }
        Some(graphs) => {
            let mut used_blank_nodes = collect_blank_nodes(stored);
            let mut mappings = HashMap::new();
            for graph in graphs {
                copy_graph_into_merged_default(
                    stored,
                    graph,
                    mappings.entry(graph.clone()).or_default(),
                    &mut used_blank_nodes,
                    &mut effective,
                );
            }
        }
        None => {
            for quad in stored
                .iter()
                .filter(|quad| !quad.graph_name.is_default_graph())
            {
                effective.insert(Quad::new(
                    quad.subject.clone(),
                    quad.predicate.clone(),
                    quad.object.clone(),
                    GraphName::DefaultGraph,
                ));
            }
        }
    }

    let mut named_graphs = specification
        .available_named_graphs()
        .map_or_else(|| stored_named_graphs.to_vec(), <[_]>::to_vec);
    let mut seen_named_graphs = HashSet::new();
    named_graphs.retain(|graph| seen_named_graphs.insert(graph.clone()));
    for graph in &named_graphs {
        let graph_name = GraphName::from(graph.clone());
        effective.insert_named_graph(graph.clone());
        copy_graph(stored, &graph_name, &graph_name, &mut effective);
    }
    (
        effective,
        named_graphs.into_iter().map(Term::from).collect(),
    )
}

fn copy_graph_into_merged_default(
    source: &Dataset,
    source_graph: &GraphName,
    blank_nodes: &mut HashMap<BlankNode, BlankNode>,
    used_blank_nodes: &mut HashSet<BlankNode>,
    target: &mut Dataset,
) {
    for quad in source
        .iter()
        .filter(|quad| quad.graph_name == *source_graph)
    {
        target.insert(Quad::new(
            rewrite_subject(&quad.subject, blank_nodes, used_blank_nodes),
            quad.predicate.clone(),
            rewrite_term(&quad.object, blank_nodes, used_blank_nodes),
            GraphName::DefaultGraph,
        ));
    }
}

fn copy_graph(
    source: &Dataset,
    source_graph: &GraphName,
    target_graph: &GraphName,
    target: &mut Dataset,
) {
    for quad in source
        .iter()
        .filter(|quad| quad.graph_name == *source_graph)
    {
        target.insert(Quad::new(
            quad.subject.clone(),
            quad.predicate.clone(),
            quad.object.clone(),
            target_graph.clone(),
        ));
    }
}

fn rewrite_subject(
    subject: &NamedOrBlankNode,
    blank_nodes: &mut HashMap<BlankNode, BlankNode>,
    used_blank_nodes: &mut HashSet<BlankNode>,
) -> NamedOrBlankNode {
    match subject {
        NamedOrBlankNode::NamedNode(node) => node.clone().into(),
        NamedOrBlankNode::BlankNode(node) => {
            rewrite_blank_node(node, blank_nodes, used_blank_nodes).into()
        }
    }
}

fn rewrite_term(
    term: &Term,
    blank_nodes: &mut HashMap<BlankNode, BlankNode>,
    used_blank_nodes: &mut HashSet<BlankNode>,
) -> Term {
    match term {
        Term::NamedNode(node) => node.clone().into(),
        Term::BlankNode(node) => rewrite_blank_node(node, blank_nodes, used_blank_nodes).into(),
        Term::Literal(literal) => literal.clone().into(),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => Triple::new(
            rewrite_subject(&triple.subject, blank_nodes, used_blank_nodes),
            triple.predicate.clone(),
            rewrite_term(&triple.object, blank_nodes, used_blank_nodes),
        )
        .into(),
    }
}

fn rewrite_blank_node(
    node: &BlankNode,
    blank_nodes: &mut HashMap<BlankNode, BlankNode>,
    used_blank_nodes: &mut HashSet<BlankNode>,
) -> BlankNode {
    blank_nodes
        .entry(node.clone())
        .or_insert_with(|| {
            loop {
                let candidate = BlankNode::default();
                if used_blank_nodes.insert(candidate.clone()) {
                    break candidate;
                }
            }
        })
        .clone()
}

fn collect_blank_nodes(dataset: &Dataset) -> HashSet<BlankNode> {
    let mut blank_nodes = HashSet::new();
    for graph_name in dataset.named_graphs() {
        if let NamedOrBlankNode::BlankNode(node) = graph_name {
            blank_nodes.insert(node);
        }
    }
    for quad in dataset {
        if let NamedOrBlankNode::BlankNode(node) = &quad.subject {
            blank_nodes.insert(node.clone());
        }
        collect_term_blank_nodes(&quad.object, &mut blank_nodes);
        if let GraphName::BlankNode(node) = &quad.graph_name {
            blank_nodes.insert(node.clone());
        }
    }
    blank_nodes
}

fn collect_term_blank_nodes(term: &Term, blank_nodes: &mut HashSet<BlankNode>) {
    match term {
        Term::BlankNode(node) => {
            blank_nodes.insert(node.clone());
        }
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => {
            if let NamedOrBlankNode::BlankNode(node) = &triple.subject {
                blank_nodes.insert(node.clone());
            }
            collect_term_blank_nodes(&triple.object, blank_nodes);
        }
        Term::NamedNode(_) | Term::Literal(_) => {}
    }
}

impl<'a> QueryableDataset<'a> for QueryEntailmentDataset {
    type InternalTerm = Term;
    type Error = Infallible;

    fn internal_quads_for_pattern(
        &self,
        subject: Option<&Term>,
        predicate: Option<&Term>,
        object: Option<&Term>,
        graph_name: Option<Option<&Term>>,
    ) -> impl Iterator<Item = Result<InternalQuad<Term>, Infallible>> + use<'a> {
        let dataset = &self.dataset;
        <&Dataset as QueryableDataset<'_>>::internal_quads_for_pattern(
            &dataset, subject, predicate, object, graph_name,
        )
        .collect::<Vec<_>>()
        .into_iter()
    }

    fn internal_named_graphs(&self) -> impl Iterator<Item = Result<Term, Infallible>> + use<'a> {
        self.named_graphs
            .clone()
            .into_iter()
            .map(Ok::<_, Infallible>)
    }

    fn contains_internal_graph_name(&self, graph_name: &Term) -> Result<bool, Infallible> {
        Ok(self.named_graphs.contains(graph_name))
    }

    fn internalize_term(&self, term: Term) -> Result<Term, Infallible> {
        Ok(term)
    }

    fn externalize_term(&self, term: Term) -> Result<Term, Infallible> {
        Ok(term)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NamedNode;

    fn assert_selected_empty_graph_topology(profile: QueryEntailment) {
        let store = Store::new().unwrap();
        let selected = NamedNode::new("urn:test:selected-empty").unwrap();
        let excluded = NamedNode::new("urn:test:excluded-empty").unwrap();
        store.insert_named_graph(selected.clone()).unwrap();
        store.insert_named_graph(excluded.clone()).unwrap();

        let mut specification = QueryDatasetSpecification::new();
        specification.set_available_named_graphs(vec![selected.clone().into()]);
        let snapshot = QueryEntailmentDataset::from_store_with_query_dataset(
            &store,
            &QueryEntailmentOptions::new(profile),
            &specification,
        )
        .unwrap();

        assert!(snapshot.dataset().contains_named_graph(&selected));
        assert!(!snapshot.dataset().contains_named_graph(&excluded));
        assert_eq!(
            snapshot.dataset().named_graphs().collect::<Vec<_>>(),
            vec![NamedOrBlankNode::from(selected)]
        );
    }

    #[test]
    fn simple_preserves_selected_empty_graph_topology() {
        assert_selected_empty_graph_topology(QueryEntailment::Simple);
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn rdfs_preserves_selected_empty_graph_topology() {
        assert_selected_empty_graph_topology(QueryEntailment::Rdfs12Finite);
    }

    #[cfg(feature = "owl2-rl")]
    #[test]
    fn owl2_rl_preserves_selected_empty_graph_topology() {
        assert_selected_empty_graph_topology(QueryEntailment::Owl2RlRdfBounded);
    }

    #[test]
    fn empty_blank_graph_names_are_reserved_for_merge_rewriting() {
        let topology_name = BlankNode::new_from_unique_id(0xace);
        let mut dataset = Dataset::new();
        dataset.insert_named_graph(topology_name.clone());

        let mut used_blank_nodes = collect_blank_nodes(&dataset);
        assert!(used_blank_nodes.contains(&topology_name));
        let rewritten = rewrite_blank_node(
            &BlankNode::new("source-node").unwrap(),
            &mut HashMap::new(),
            &mut used_blank_nodes,
        );
        assert_ne!(rewritten, topology_name);
    }
}
