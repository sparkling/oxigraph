#[cfg(feature = "rdfs")]
use super::rdfs_working_dataset;
use super::{
    Control, QueryEntailment, QueryEntailmentError, QueryEntailmentOptions, rdf12_finite,
    term_graph_name,
};
#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
use super::{reject_reserved_witnesses, visible_dataset};
#[cfg(feature = "rdf-12")]
use crate::model::Triple;
use crate::model::{BlankNode, Dataset, GraphName, NamedOrBlankNode, Quad, Term};
use crate::sparql::CancellationToken;
use crate::store::Store;
use spareval::{InternalQuad, QueryDatasetSpecification, QueryableDataset};
use std::collections::{HashMap, HashSet};

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
    control: Control,
}

impl QueryEntailmentDataset {
    /// Captures a Store snapshot and materializes the selected bounded profile.
    pub fn from_store(
        store: &Store,
        options: &QueryEntailmentOptions,
    ) -> Result<Self, QueryEntailmentError> {
        let control = Control::new(options, None);
        options.profile.ensure_supported()?;
        let (base, named_graphs) = store.snapshot_contents_with_control(|| control.check())?;
        Self::from_snapshot(
            base,
            control.collect(named_graphs.into_iter().map(Term::from))?,
            options,
            control,
        )
    }

    pub(crate) fn from_store_with_query_dataset(
        store: &Store,
        options: &QueryEntailmentOptions,
        specification: &QueryDatasetSpecification,
        caller: Option<CancellationToken>,
    ) -> Result<Self, QueryEntailmentError> {
        let control = Control::new(options, caller);
        options.profile.ensure_supported()?;
        let (stored, stored_named_graphs) =
            store.snapshot_contents_with_control(|| control.check())?;
        let (base, named_graphs) =
            effective_query_dataset(&stored, &stored_named_graphs, specification, &control)?;
        Self::from_snapshot(base, named_graphs, options, control)
    }

    fn from_snapshot(
        base: Dataset,
        named_graphs: Vec<Term>,
        options: &QueryEntailmentOptions,
        control: Control,
    ) -> Result<Self, QueryEntailmentError> {
        options.profile.ensure_supported()?;
        control.check()?;
        let graph_names =
            control.collect::<_, Vec<_>>(named_graphs.iter().filter_map(term_graph_name))?;
        let dataset = match options.profile {
            QueryEntailment::Simple => base,
            QueryEntailment::Rdf12Finite => rdf12_finite(&base, &graph_names, &control)?,
            QueryEntailment::Rdfs12Finite => {
                #[cfg(feature = "rdfs")]
                {
                    reject_reserved_witnesses(&base, "oxrdfs", &control)?;
                    let working = rdfs_working_dataset(&base, &graph_names, &control)?;
                    let mut engine_options = crate::rdfs::Rdfs12Options {
                        container_membership_limit: 0,
                        ..crate::rdfs::Rdfs12Options::default()
                    };
                    let inference_control = control.clone();
                    if options.timeout.is_some() {
                        engine_options.evaluation.limits.timeout = options.timeout;
                    }
                    engine_options.evaluation.cancellation_token = engine_options
                        .evaluation
                        .cancellation_token
                        .with_cancellation_check(move || inference_control.check().is_err());
                    let closure = crate::rdfs::Rdfs12Finite.evaluate(&working, &engine_options);
                    control.check()?;
                    let closure = closure?;
                    if let crate::rdfs::Rdfs12Consistency::Inconsistent(reasons) =
                        closure.consistency()
                    {
                        return Err(QueryEntailmentError::RdfsInconsistent {
                            reasons: reasons.len(),
                        });
                    }
                    visible_dataset(&base, closure.entailed(), &control)?
                }
                #[cfg(not(feature = "rdfs"))]
                {
                    unreachable!("profile availability was checked")
                }
            }
            QueryEntailment::Owl2RlRdfBounded => {
                #[cfg(feature = "owl2-rl")]
                {
                    reject_reserved_witnesses(&base, "oxowl", &control)?;
                    let mut engine_options = crate::owl2_rl::Owl2RlRdfOptions::default();
                    if options.timeout.is_some() {
                        engine_options.evaluation.limits.timeout = options.timeout;
                    }
                    let inference_control = control.clone();
                    engine_options.evaluation.cancellation_token = engine_options
                        .evaluation
                        .cancellation_token
                        .with_cancellation_check(move || inference_control.check().is_err());
                    let closure = crate::owl2_rl::Owl2RlRdf.evaluate(&base, &engine_options);
                    control.check()?;
                    let closure = closure?;
                    if let crate::owl2_rl::Owl2RlConsistency::Inconsistent(contradictions) =
                        closure.consistency()
                    {
                        return Err(QueryEntailmentError::Owl2RlInconsistent {
                            contradictions: contradictions.len(),
                        });
                    }
                    visible_dataset(&base, closure.entailed(), &control)?
                }
                #[cfg(not(feature = "owl2-rl"))]
                {
                    unreachable!("profile availability was checked")
                }
            }
        };
        control.check()?;
        Ok(Self {
            dataset,
            named_graphs,
            profile: options.profile,
            control: control.after_materialization(),
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
    control: &Control,
) -> Result<(Dataset, Vec<Term>), QueryEntailmentError> {
    control.check()?;
    let mut effective = Dataset::new();
    match specification.default_graph_graphs() {
        Some(graphs) if specification.is_default_dataset() => {
            for graph in graphs {
                copy_graph(stored, graph, graph, &mut effective, control)?;
            }
        }
        Some(graphs) => {
            let mut used_blank_nodes = collect_blank_nodes(stored, control)?;
            let mut mappings = HashMap::new();
            for graph in graphs {
                copy_graph_into_merged_default(
                    stored,
                    graph,
                    mappings.entry(graph.clone()).or_default(),
                    &mut used_blank_nodes,
                    &mut effective,
                    control,
                )?;
            }
        }
        None => {
            for quad in stored {
                control.check()?;
                if quad.graph_name.is_default_graph() {
                    continue;
                }
                effective.insert(Quad::new(
                    quad.subject.clone(),
                    quad.predicate.clone(),
                    quad.object.clone(),
                    GraphName::DefaultGraph,
                ));
            }
        }
    }

    let mut named_graphs = Vec::new();
    let mut seen_named_graphs = HashSet::new();
    for graph in specification
        .available_named_graphs()
        .unwrap_or(stored_named_graphs)
    {
        control.check()?;
        if !seen_named_graphs.insert(graph.clone()) {
            continue;
        }
        let graph_name = GraphName::from(graph.clone());
        effective.insert_named_graph(graph.clone());
        copy_graph(stored, &graph_name, &graph_name, &mut effective, control)?;
        named_graphs.push(Term::from(graph.clone()));
    }
    control.check()?;
    Ok((effective, named_graphs))
}

fn copy_graph_into_merged_default(
    source: &Dataset,
    source_graph: &GraphName,
    blank_nodes: &mut HashMap<BlankNode, BlankNode>,
    used_blank_nodes: &mut HashSet<BlankNode>,
    target: &mut Dataset,
    control: &Control,
) -> Result<(), QueryEntailmentError> {
    control.check()?;
    // Both indexes order a fixed graph by subject/predicate/object. Restrict
    // the range before decoding; scanning every quad per graph is quadratic
    // for datasets with many small named graphs.
    for quad in source.quads_for_graph_name(source_graph) {
        control.check()?;
        target.insert(Quad::new(
            rewrite_subject(&quad.subject, blank_nodes, used_blank_nodes, control)?,
            quad.predicate.clone(),
            rewrite_term(&quad.object, blank_nodes, used_blank_nodes, control)?,
            GraphName::DefaultGraph,
        ));
    }
    control.check()
}

fn copy_graph(
    source: &Dataset,
    source_graph: &GraphName,
    target_graph: &GraphName,
    target: &mut Dataset,
    control: &Control,
) -> Result<(), QueryEntailmentError> {
    control.check()?;
    for quad in source.quads_for_graph_name(source_graph) {
        control.check()?;
        target.insert(Quad::new(
            quad.subject.clone(),
            quad.predicate.clone(),
            quad.object.clone(),
            target_graph.clone(),
        ));
    }
    control.check()
}

fn rewrite_subject(
    subject: &NamedOrBlankNode,
    blank_nodes: &mut HashMap<BlankNode, BlankNode>,
    used_blank_nodes: &mut HashSet<BlankNode>,
    control: &Control,
) -> Result<NamedOrBlankNode, QueryEntailmentError> {
    control.check()?;
    Ok(match subject {
        NamedOrBlankNode::NamedNode(node) => node.clone().into(),
        NamedOrBlankNode::BlankNode(node) => {
            rewrite_blank_node(node, blank_nodes, used_blank_nodes, control)?.into()
        }
    })
}

fn rewrite_term(
    term: &Term,
    blank_nodes: &mut HashMap<BlankNode, BlankNode>,
    used_blank_nodes: &mut HashSet<BlankNode>,
    control: &Control,
) -> Result<Term, QueryEntailmentError> {
    control.check()?;
    Ok(match term {
        Term::NamedNode(node) => node.clone().into(),
        Term::BlankNode(node) => {
            rewrite_blank_node(node, blank_nodes, used_blank_nodes, control)?.into()
        }
        Term::Literal(literal) => literal.clone().into(),
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => Triple::new(
            rewrite_subject(&triple.subject, blank_nodes, used_blank_nodes, control)?,
            triple.predicate.clone(),
            rewrite_term(&triple.object, blank_nodes, used_blank_nodes, control)?,
        )
        .into(),
    })
}

fn rewrite_blank_node(
    node: &BlankNode,
    blank_nodes: &mut HashMap<BlankNode, BlankNode>,
    used_blank_nodes: &mut HashSet<BlankNode>,
    control: &Control,
) -> Result<BlankNode, QueryEntailmentError> {
    control.check()?;
    if let Some(existing) = blank_nodes.get(node) {
        return Ok(existing.clone());
    }
    loop {
        control.check()?;
        let candidate = BlankNode::default();
        if used_blank_nodes.insert(candidate.clone()) {
            blank_nodes.insert(node.clone(), candidate.clone());
            return Ok(candidate);
        }
    }
}

fn collect_blank_nodes(
    dataset: &Dataset,
    control: &Control,
) -> Result<HashSet<BlankNode>, QueryEntailmentError> {
    let mut blank_nodes = HashSet::new();
    for graph_name in dataset.named_graphs() {
        control.check()?;
        if let NamedOrBlankNode::BlankNode(node) = graph_name {
            blank_nodes.insert(node);
        }
    }
    for quad in dataset {
        control.check()?;
        if let NamedOrBlankNode::BlankNode(node) = &quad.subject {
            blank_nodes.insert(node.clone());
        }
        collect_term_blank_nodes(&quad.object, &mut blank_nodes, control)?;
        if let GraphName::BlankNode(node) = &quad.graph_name {
            blank_nodes.insert(node.clone());
        }
    }
    control.check()?;
    Ok(blank_nodes)
}

fn collect_term_blank_nodes(
    term: &Term,
    blank_nodes: &mut HashSet<BlankNode>,
    control: &Control,
) -> Result<(), QueryEntailmentError> {
    control.check()?;
    match term {
        Term::BlankNode(node) => {
            blank_nodes.insert(node.clone());
        }
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => {
            if let NamedOrBlankNode::BlankNode(node) = &triple.subject {
                blank_nodes.insert(node.clone());
            }
            collect_term_blank_nodes(&triple.object, blank_nodes, control)?;
        }
        Term::NamedNode(_) | Term::Literal(_) => {}
    }
    Ok(())
}

impl<'a> QueryableDataset<'a> for QueryEntailmentDataset {
    type InternalTerm = Term;
    type Error = QueryEntailmentError;

    fn internal_quads_for_pattern(
        &self,
        subject: Option<&Term>,
        predicate: Option<&Term>,
        object: Option<&Term>,
        graph_name: Option<Option<&Term>>,
    ) -> impl Iterator<Item = Result<InternalQuad<Term>, QueryEntailmentError>> + use<'a> {
        // Check before filtering, including scans that produce no matches.
        // Keep the same subject/object/predicate/graph index selection as Dataset.
        let candidates: Box<dyn Iterator<Item = Quad> + '_> = if let Some(subject) = subject {
            match subject {
                Term::NamedNode(node) => Box::new(self.dataset.quads_for_subject(node)),
                Term::BlankNode(node) => Box::new(self.dataset.quads_for_subject(node)),
                _ => Box::new(std::iter::empty()),
            }
        } else if let Some(object) = object {
            Box::new(self.dataset.quads_for_object(object))
        } else if let Some(predicate) = predicate {
            match predicate {
                Term::NamedNode(node) => Box::new(self.dataset.quads_for_predicate(node)),
                _ => Box::new(std::iter::empty()),
            }
        } else if let Some(graph) = graph_name {
            match graph {
                Some(Term::NamedNode(node)) => Box::new(self.dataset.quads_for_graph_name(node)),
                Some(Term::BlankNode(node)) => Box::new(self.dataset.quads_for_graph_name(node)),
                None => Box::new(self.dataset.quads_for_graph_name(&GraphName::DefaultGraph)),
                _ => Box::new(std::iter::empty()),
            }
        } else {
            Box::new(self.dataset.iter())
        };
        let rows = (|| {
            self.control.check()?;
            let mut rows = Vec::new();
            for quad in candidates {
                self.control.check()?;
                if subject.is_some_and(|term| *term != Term::from(quad.subject.clone()))
                    || predicate.is_some_and(|term| *term != quad.predicate)
                    || object.is_some_and(|term| *term != quad.object)
                    || match graph_name {
                        None => quad.graph_name.is_default_graph(),
                        Some(None) => !quad.graph_name.is_default_graph(),
                        Some(Some(term)) => {
                            term_graph_name(term).as_ref() != Some(&quad.graph_name)
                        }
                    }
                {
                    continue;
                }
                rows.push(InternalQuad {
                    subject: quad.subject.into(),
                    predicate: quad.predicate.into(),
                    object: quad.object,
                    graph_name: match quad.graph_name {
                        GraphName::DefaultGraph => None,
                        GraphName::NamedNode(node) => Some(node.into()),
                        GraphName::BlankNode(node) => Some(node.into()),
                    },
                });
            }
            self.control.check()?;
            Ok(rows)
        })();
        self.control.results(rows)
    }

    fn internal_named_graphs(
        &self,
    ) -> impl Iterator<Item = Result<Term, QueryEntailmentError>> + use<'a> {
        self.control
            .results(self.control.collect(self.named_graphs.iter().cloned()))
    }

    fn contains_internal_graph_name(
        &self,
        graph_name: &Term,
    ) -> Result<bool, QueryEntailmentError> {
        for graph in &self.named_graphs {
            self.control.check()?;
            if graph == graph_name {
                return Ok(true);
            }
        }
        self.control.check()?;
        Ok(false)
    }

    fn internalize_term(&self, term: Term) -> Result<Term, QueryEntailmentError> {
        self.control.check()?;
        Ok(term)
    }

    fn externalize_term(&self, term: Term) -> Result<Term, QueryEntailmentError> {
        self.control.check()?;
        Ok(term)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NamedNode;

    #[test]
    fn successful_binding_does_not_retain_relative_materialization_timeout() {
        let options = QueryEntailmentOptions::default()
            .with_timeout(Some(std::time::Duration::from_secs(60)));
        let mut dataset = QueryEntailmentDataset::from_snapshot(
            Dataset::new(),
            Vec::new(),
            &options,
            Control::new(&options, None),
        )
        .unwrap();
        // Move the post-construction clock forward deterministically. If binding
        // retains its relative timeout, this previously usable dataset expires.
        dataset.control.expire_materialization_clock_for_test();
        assert!(dataset.internal_named_graphs().next().is_none());
        assert!(
            dataset
                .internal_quads_for_pattern(None, None, None, Some(None))
                .next()
                .is_none()
        );
    }

    #[test]
    fn controlled_pattern_indexes_match_the_existing_dataset_adapter() {
        use crate::model::Literal;
        let node = NamedNode::new("urn:n").unwrap();
        let blank = BlankNode::new("b").unwrap();
        let absent = NamedNode::new("urn:absent").unwrap();
        let terms = [
            None,
            Some(Term::from(node.clone())),
            Some(Term::from(blank.clone())),
            Some(Term::from(absent)),
            Some(Term::from(Literal::from(7))),
        ];
        let mut source = Dataset::new();
        for graph in [
            GraphName::DefaultGraph,
            node.clone().into(),
            blank.clone().into(),
        ] {
            for subject in [NamedOrBlankNode::from(node.clone()), blank.clone().into()] {
                for object in terms.iter().flatten() {
                    source.insert(Quad::new(
                        subject.clone(),
                        node.clone(),
                        object.clone(),
                        graph.clone(),
                    ));
                }
            }
        }
        let names = source.named_graphs().map(Term::from).collect();
        let options = QueryEntailmentOptions::default();
        let controlled = QueryEntailmentDataset::from_snapshot(
            source.clone(),
            names,
            &options,
            Control::new(&options, None),
        )
        .unwrap();
        let key = |row: InternalQuad<Term>| {
            (
                row.subject.to_string(),
                row.predicate.to_string(),
                row.object.to_string(),
                row.graph_name.map(|g| g.to_string()),
            )
        };
        for subject in &terms {
            for predicate in &terms {
                for object in &terms {
                    for graph in std::iter::once(None).chain(terms.iter().map(|g| Some(g.as_ref())))
                    {
                        let mut actual = controlled
                            .internal_quads_for_pattern(
                                subject.as_ref(),
                                predicate.as_ref(),
                                object.as_ref(),
                                graph,
                            )
                            .map(|row| key(row.unwrap()))
                            .collect::<Vec<_>>();
                        let mut expected =
                            <&Dataset as QueryableDataset<'_>>::internal_quads_for_pattern(
                                &&source,
                                subject.as_ref(),
                                predicate.as_ref(),
                                object.as_ref(),
                                graph,
                            )
                            .map(|row| key(row.unwrap()))
                            .collect::<Vec<_>>();
                        actual.sort();
                        expected.sort();
                        assert_eq!(actual, expected);
                    }
                }
            }
        }
    }

    #[test]
    fn indexed_graph_copies_preserve_contents_and_membership() {
        let control = Control::new(&QueryEntailmentOptions::default(), None);
        let mut source = Dataset::new();
        let predicate = NamedNode::new("urn:p").unwrap();
        let shared = BlankNode::new("shared").unwrap();
        let mut graphs = vec![
            GraphName::DefaultGraph,
            BlankNode::new("graph").unwrap().into(),
        ];
        graphs.extend((0..64).map(|n| NamedNode::new(format!("urn:g{n}")).unwrap().into()));
        for graph in &graphs {
            source.insert(Quad::new(
                NamedNode::new("urn:ground").unwrap(),
                predicate.clone(),
                NamedNode::new("urn:shared-object").unwrap(),
                graph.clone(),
            ));
            for n in 0..3 {
                source.insert(Quad::new(
                    shared.clone(),
                    predicate.clone(),
                    NamedNode::new(format!("urn:o{n}")).unwrap(),
                    graph.clone(),
                ));
            }
        }
        source.insert(Quad::new(
            NamedNode::new("urn:default-only").unwrap(),
            predicate.clone(),
            NamedNode::new("urn:excluded").unwrap(),
            GraphName::DefaultGraph,
        ));
        let empty = NamedNode::new("urn:empty").unwrap();
        source.insert_named_graph(empty.clone());
        graphs.extend([empty.into(), NamedNode::new("urn:absent").unwrap().into()]);
        for graph in &graphs {
            let expected = source
                .iter()
                .filter(|q| q.graph_name == *graph)
                .collect::<Vec<_>>();
            let mut copied = Dataset::new();
            copy_graph(
                &source,
                graph,
                &GraphName::DefaultGraph,
                &mut copied,
                &control,
            )
            .unwrap();
            let mut baseline = Dataset::new();
            for quad in expected {
                baseline.insert(Quad::new(
                    quad.subject,
                    quad.predicate,
                    quad.object,
                    GraphName::DefaultGraph,
                ));
            }
            assert_eq!(copied, baseline);
        }
        let mut specification = QueryDatasetSpecification::new();
        specification.set_default_graph_as_union();
        let names = source.named_graphs().collect::<Vec<_>>();
        let (effective, _) =
            effective_query_dataset(&source, &names, &specification, &control).unwrap();
        assert!(effective.contains_named_graph(&NamedNode::new("urn:empty").unwrap()));
        assert!(!effective.contains_named_graph(&NamedNode::new("urn:absent").unwrap()));
        assert_eq!(
            effective
                .quads_for_graph_name(&GraphName::DefaultGraph)
                .count(),
            4
        );

        let mut used = collect_blank_nodes(&source, &control).unwrap();
        let mut merged = Dataset::new();
        for graph in &graphs[1..3] {
            copy_graph_into_merged_default(
                &source,
                graph,
                &mut HashMap::new(),
                &mut used,
                &mut merged,
                &control,
            )
            .unwrap();
        }
        assert_eq!(merged.len(), 7); // Ground quad dedups; blank labels stay distinct across FROM graphs.
        assert_eq!(
            merged
                .iter()
                .map(|q| q.subject)
                .collect::<HashSet<_>>()
                .len(),
            3
        );
    }

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
            None,
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
        let control = Control::new(&QueryEntailmentOptions::default(), None);
        let topology_name = BlankNode::new_from_unique_id(0xace);
        let mut dataset = Dataset::new();
        dataset.insert_named_graph(topology_name.clone());

        let mut used_blank_nodes = collect_blank_nodes(&dataset, &control).unwrap();
        assert!(used_blank_nodes.contains(&topology_name));
        let rewritten = rewrite_blank_node(
            &BlankNode::new("source-node").unwrap(),
            &mut HashMap::new(),
            &mut used_blank_nodes,
            &control,
        )
        .unwrap();
        assert_ne!(rewritten, topology_name);
    }
}
