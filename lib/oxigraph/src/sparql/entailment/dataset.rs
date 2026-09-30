use super::{
    Budget, Control, Limits, QueryEntailment, QueryEntailmentError, QueryEntailmentOptions,
    SOURCE_STAGE, SnapshotAdmission, rdf12_finite, term_graph_name,
};
#[cfg(any(feature = "owl2-rl", feature = "rdfs"))]
use super::{VISIBLE_STAGE, reject_reserved_witnesses, visible_dataset};
#[cfg(feature = "rdfs")]
use super::{WORKING_STAGE, rdfs_working_dataset};
#[cfg(feature = "rdf-12")]
use crate::model::Triple;
use crate::model::{BlankNode, Dataset, GraphName, NamedOrBlankNode, Quad, Term};
use crate::sparql::CancellationToken;
use crate::store::{SnapshotItem, Store};
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
        options.ensure_supported()?;
        let (base, named_graphs) = bounded_snapshot(store, options.limits, &control)?;
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
        options.ensure_supported()?;
        // The Store copies all graphs before FROM/FROM NAMED selection;
        // admission bounds that copy record by record, so selection starts
        // from a snapshot already within both ceilings.
        let (stored, stored_named_graphs) = bounded_snapshot(store, options.limits, &control)?;
        let (base, named_graphs) = effective_query_dataset(
            &stored,
            &stored_named_graphs,
            specification,
            &control,
            options.limits,
        )?;
        drop(stored);
        drop(stored_named_graphs);
        Self::from_snapshot(base, named_graphs, options, control)
    }

    fn from_snapshot(
        base: Dataset,
        named_graphs: Vec<Term>,
        options: &QueryEntailmentOptions,
        control: Control,
    ) -> Result<Self, QueryEntailmentError> {
        options.ensure_supported()?;
        control.check()?;
        let graph_names =
            control.collect::<_, Vec<_>>(named_graphs.iter().filter_map(term_graph_name))?;
        let dataset = match options.profile {
            QueryEntailment::Simple => base,
            QueryEntailment::Rdf12Finite => rdf12_finite(&base, &graph_names, &control)?,
            QueryEntailment::Rdfs12Finite => {
                #[cfg(feature = "rdfs")]
                {
                    let limits = options.limits;
                    // Reject an oversized source before any wrapper-owned copy.
                    let source = Budget::starting_with(limits, SOURCE_STAGE, &base, &control)?;
                    reject_reserved_witnesses(&base, "oxrdfs", &control)?;
                    let working = rdfs_working_dataset(
                        &base,
                        &graph_names,
                        &control,
                        source.at_stage(WORKING_STAGE),
                    )?;
                    let mut engine_options = crate::rdfs::Rdfs12Options {
                        container_membership_limit: 0,
                        ..crate::rdfs::Rdfs12Options::default()
                    };
                    let inference_control = control.clone();
                    if options.timeout.is_some() {
                        engine_options.evaluation.limits.timeout = options.timeout;
                    }
                    // Configured ceilings only tighten the engine's built-in bounds.
                    let engine_limits = &mut engine_options.evaluation.limits;
                    if let Some(max) = limits.quads {
                        engine_limits.max_facts = engine_limits.max_facts.min(max.get());
                    }
                    if let Some(max) = limits.bytes {
                        engine_limits.max_memory_bytes =
                            engine_limits.max_memory_bytes.min(max.get());
                    }
                    engine_options.evaluation.cancellation_token = engine_options
                        .evaluation
                        .cancellation_token
                        .with_cancellation_check(move || inference_control.check().is_err());
                    let closure = crate::rdfs::Rdfs12Finite.evaluate(&working, &engine_options);
                    // The closure owns its own copies; release the working set early.
                    drop(working);
                    control.check()?;
                    let closure = closure?;
                    if let crate::rdfs::Rdfs12Consistency::Inconsistent(reasons) =
                        closure.consistency()
                    {
                        return Err(QueryEntailmentError::RdfsInconsistent {
                            reasons: reasons.len(),
                        });
                    }
                    visible_dataset(
                        &base,
                        closure.entailed(),
                        &control,
                        source.at_stage(VISIBLE_STAGE),
                    )?
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
                    // Ceilings are rejected for this profile before snapshotting.
                    visible_dataset(
                        &base,
                        closure.entailed(),
                        &control,
                        Budget::new(Limits::default(), VISIBLE_STAGE),
                    )?
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

/// Copies the Store snapshot, admitting each decoded quad and named-graph
/// declaration against the configured ceilings before the Store accumulates
/// it. One decoded record may exist when admission refuses it.
fn bounded_snapshot(
    store: &Store,
    limits: Limits,
    control: &Control,
) -> Result<(Dataset, Vec<NamedOrBlankNode>), QueryEntailmentError> {
    bounded_snapshot_with(store, limits, control, |_| {})
}

/// `observe` sees each decoded record before its cancellation and admission
/// checks. Cancellation and deadlines take precedence over ceilings.
fn bounded_snapshot_with(
    store: &Store,
    limits: Limits,
    control: &Control,
    mut observe: impl FnMut(&SnapshotItem<'_>),
) -> Result<(Dataset, Vec<NamedOrBlankNode>), QueryEntailmentError> {
    let mut admission = SnapshotAdmission::new(limits);
    store.snapshot_contents_with_admission(
        || control.check(),
        |item| {
            observe(&item);
            control.check()?;
            admission.admit(&item)
        },
    )
}

fn effective_query_dataset(
    stored: &Dataset,
    stored_named_graphs: &[NamedOrBlankNode],
    specification: &QueryDatasetSpecification,
    control: &Control,
    limits: Limits,
) -> Result<(Dataset, Vec<Term>), QueryEntailmentError> {
    control.check()?;
    let mut budget = Budget::new(limits, SOURCE_STAGE);
    let mut effective = Dataset::new();
    match specification.default_graph_graphs() {
        Some(graphs) if specification.is_default_dataset() => {
            for graph in graphs {
                copy_graph(stored, graph, graph, &mut effective, &mut budget, control)?;
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
                    &mut budget,
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
                budget.insert(
                    &mut effective,
                    Quad::new(
                        quad.subject.clone(),
                        quad.predicate.clone(),
                        quad.object.clone(),
                        GraphName::DefaultGraph,
                    ),
                )?;
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
        copy_graph(
            stored,
            &graph_name,
            &graph_name,
            &mut effective,
            &mut budget,
            control,
        )?;
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
    budget: &mut Budget,
    control: &Control,
) -> Result<(), QueryEntailmentError> {
    control.check()?;
    // Both indexes order a fixed graph by subject/predicate/object. Restrict
    // the range before decoding; scanning every quad per graph is quadratic
    // for datasets with many small named graphs.
    for quad in source.quads_for_graph_name(source_graph) {
        control.check()?;
        budget.insert(
            target,
            Quad::new(
                rewrite_subject(&quad.subject, blank_nodes, used_blank_nodes, control)?,
                quad.predicate.clone(),
                rewrite_term(&quad.object, blank_nodes, used_blank_nodes, control)?,
                GraphName::DefaultGraph,
            ),
        )?;
    }
    control.check()
}

fn copy_graph(
    source: &Dataset,
    source_graph: &GraphName,
    target_graph: &GraphName,
    target: &mut Dataset,
    budget: &mut Budget,
    control: &Control,
) -> Result<(), QueryEntailmentError> {
    control.check()?;
    for quad in source.quads_for_graph_name(source_graph) {
        control.check()?;
        budget.insert(
            target,
            Quad::new(
                quad.subject.clone(),
                quad.predicate.clone(),
                quad.object.clone(),
                target_graph.clone(),
            ),
        )?;
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
    use std::num::NonZeroUsize;

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
                &mut Budget::new(Limits::default(), SOURCE_STAGE),
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
            effective_query_dataset(&source, &names, &specification, &control, Limits::default())
                .unwrap();
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
                &mut Budget::new(Limits::default(), SOURCE_STAGE),
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

    fn materialize(
        store: &Store,
        options: &QueryEntailmentOptions,
        query_dataset: bool,
    ) -> Result<QueryEntailmentDataset, QueryEntailmentError> {
        if query_dataset {
            QueryEntailmentDataset::from_store_with_query_dataset(
                store,
                options,
                &QueryDatasetSpecification::new(),
                None,
            )
        } else {
            QueryEntailmentDataset::from_store(store, options)
        }
    }

    #[test]
    fn ceilings_are_typed_opt_in_and_default_to_unbounded() {
        // Zero is unrepresentable; one is the tightest possible ceiling.
        assert!(NonZeroUsize::new(0).is_none());
        let options = QueryEntailmentOptions::default();
        assert_eq!(options.max_materialized_quads(), None);
        assert_eq!(options.max_estimated_materialization_bytes(), None);
        assert_eq!(options.limits, Limits::default());
        let options = options
            .with_max_materialized_quads(Some(NonZeroUsize::MIN))
            .with_max_estimated_materialization_bytes(Some(NonZeroUsize::MAX));
        assert_eq!(options.max_materialized_quads(), Some(NonZeroUsize::MIN));
        assert_eq!(
            options.max_estimated_materialization_bytes(),
            Some(NonZeroUsize::MAX)
        );
        let cleared = options
            .with_max_materialized_quads(None)
            .with_max_estimated_materialization_bytes(None);
        assert!(cleared.limits.is_unbounded());
        // Saturating accounting: usize::MAX ceilings never overflow admission.
        let saturated = Limits {
            quads: Some(NonZeroUsize::MAX),
            bytes: Some(NonZeroUsize::MAX),
        };
        let quad = Quad::new(
            NamedNode::new("urn:test:s").unwrap(),
            NamedNode::new("urn:test:p").unwrap(),
            NamedNode::new("urn:test:o").unwrap(),
            GraphName::DefaultGraph,
        );
        let mut admission = SnapshotAdmission::new(saturated);
        admission.records = usize::MAX - 1;
        admission.budget.bytes = usize::MAX - 1;
        for _ in 0..3 {
            admission.admit(&SnapshotItem::Quad(&quad)).unwrap();
        }
        assert_eq!(admission.records, usize::MAX);
        assert_eq!(admission.budget.bytes, usize::MAX);
    }

    type Snapshot = Result<(Dataset, Vec<NamedOrBlankNode>), QueryEntailmentError>;

    /// Independent per-record oracle: 160 plus the allocated display length.
    fn oracle_bytes(item: &SnapshotItem<'_>) -> usize {
        160 + match item {
            SnapshotItem::Quad(quad) => quad.to_string().len(),
            SnapshotItem::NamedGraph(graph) => graph.to_string().len(),
        }
    }

    /// Returns the oracle size of every record the admission callback saw.
    fn observed_snapshot(
        store: &Store,
        limits: Limits,
        control: &Control,
    ) -> (Vec<usize>, Snapshot) {
        let mut sizes = Vec::new();
        let result = bounded_snapshot_with(store, limits, control, |item| {
            sizes.push(oracle_bytes(item));
        });
        (sizes, result)
    }

    fn snapshot_limit(result: &Snapshot) -> Option<&'static str> {
        match result {
            Err(QueryEntailmentError::LimitExceeded {
                limit,
                stage: "snapshot",
                ..
            }) => Some(*limit),
            _ => None,
        }
    }

    fn quad_store(count: usize) -> Store {
        let store = Store::new().unwrap();
        for n in 0..count {
            store
                .insert(Quad::new(
                    NamedNode::new(format!("urn:test:s{n}")).unwrap(),
                    NamedNode::new("urn:test:p").unwrap(),
                    NamedNode::new("urn:test:o").unwrap(),
                    GraphName::DefaultGraph,
                ))
                .unwrap();
        }
        store
    }

    #[test]
    fn snapshot_admission_stops_at_the_first_rejected_record() {
        let store = quad_store(5);
        let before = store.iter().collect::<Result<Vec<_>, _>>().unwrap();
        let control = Control::new(&QueryEntailmentOptions::default(), None);
        let (all, full) = observed_snapshot(&store, Limits::default(), &control);
        let (dataset, graphs) = full.unwrap();
        assert_eq!(all.len(), 5);
        assert_eq!(dataset.len(), 5);
        assert!(graphs.is_empty());
        for (limits, calls, expected) in [
            (
                Limits {
                    quads: NonZeroUsize::new(1),
                    bytes: None,
                },
                2,
                "quad",
            ),
            (
                Limits {
                    quads: None,
                    bytes: NonZeroUsize::new(all[0]),
                },
                2,
                "estimated-byte",
            ),
            (
                Limits {
                    quads: None,
                    bytes: NonZeroUsize::new(all[0] - 1),
                },
                1,
                "estimated-byte",
            ),
        ] {
            let (sizes, result) = observed_snapshot(&store, limits, &control);
            // No later record reaches admission once one is refused.
            assert_eq!(sizes.len(), calls);
            assert_eq!(snapshot_limit(&result), Some(expected));
        }
        assert_eq!(store.iter().collect::<Result<Vec<_>, _>>().unwrap(), before);
    }

    #[test]
    fn graph_only_huge_iri_is_refused_at_its_declaration() {
        let store = Store::new().unwrap();
        let huge = NamedNode::new(format!("urn:test:{}", "g".repeat(1 << 20))).unwrap();
        store.insert_named_graph(huge.clone()).unwrap();
        let control = Control::new(&QueryEntailmentOptions::default(), None);
        let limits = Limits {
            quads: None,
            bytes: NonZeroUsize::new(65_536),
        };
        let mut kinds = Vec::new();
        let result = bounded_snapshot_with(&store, limits, &control, |item| {
            kinds.push(matches!(item, SnapshotItem::NamedGraph(_)));
        });
        assert_eq!(kinds, [true]);
        assert!(matches!(
            result,
            Err(QueryEntailmentError::LimitExceeded {
                limit: "estimated-byte",
                stage: "snapshot",
                ceiling: 65_536
            })
        ));
        assert!(store.is_empty().unwrap());
        assert!(store.contains_named_graph(&huge.into()).unwrap());
    }

    #[test]
    fn exact_boundary_admits_quads_and_empty_named_graph_topology() {
        let store = quad_store(1);
        let empty = NamedNode::new("urn:test:empty").unwrap();
        store.insert_named_graph(empty.clone()).unwrap();
        let control = Control::new(&QueryEntailmentOptions::default(), None);
        let exact = Limits {
            quads: NonZeroUsize::new(2),
            bytes: None,
        };
        let (sizes, result) = observed_snapshot(&store, exact, &control);
        let (dataset, graphs) = result.unwrap();
        assert_eq!(sizes.len(), 2);
        assert_eq!(dataset.len(), 1);
        assert_eq!(graphs, vec![NamedOrBlankNode::from(empty.clone())]);
        assert!(dataset.contains_named_graph(&empty));
        assert_eq!(dataset.quads_for_graph_name(&empty).count(), 0);
        // The graph declaration is the record that exceeds a one-record ceiling.
        let (rejected, result) = observed_snapshot(
            &store,
            Limits {
                quads: NonZeroUsize::new(1),
                bytes: None,
            },
            &control,
        );
        assert_eq!(rejected.len(), 2);
        assert_eq!(snapshot_limit(&result), Some("quad"));
        // Named-graph bytes count too: the exact oracle total fits, one less does not.
        let total = sizes.iter().sum::<usize>();
        let (_, fits) = observed_snapshot(
            &store,
            Limits {
                quads: None,
                bytes: NonZeroUsize::new(total),
            },
            &control,
        );
        assert!(fits.is_ok());
        let (rejected, result) = observed_snapshot(
            &store,
            Limits {
                quads: None,
                bytes: NonZeroUsize::new(total - 1),
            },
            &control,
        );
        assert_eq!(rejected.len(), 2);
        assert_eq!(snapshot_limit(&result), Some("estimated-byte"));
        assert_eq!(store.len().unwrap(), 1);
        assert!(store.contains_named_graph(&empty.into()).unwrap());
    }

    #[test]
    fn midpoint_cancellation_precedes_admission_ceilings() {
        use crate::sparql::QueryEvaluationError;
        let store = quad_store(6);
        // Record 3 would also breach the two-record ceiling; cancellation wins.
        for (cancel_at, quads) in [(2, None), (3, NonZeroUsize::new(2))] {
            let token = CancellationToken::new();
            let control = Control::new(
                &QueryEntailmentOptions::default().with_cancellation_token(token.clone()),
                None,
            );
            let mut calls = 0;
            let result =
                bounded_snapshot_with(&store, Limits { quads, bytes: None }, &control, |_| {
                    calls += 1;
                    if calls == cancel_at {
                        token.cancel();
                    }
                });
            assert_eq!(calls, cancel_at);
            assert!(matches!(
                result,
                Err(QueryEntailmentError::Evaluation(
                    QueryEvaluationError::Cancelled
                ))
            ));
        }
        assert_eq!(store.len().unwrap(), 6);
    }

    #[test]
    fn quad_ceiling_is_checked_before_bytes_for_the_same_record() {
        let store = quad_store(3);
        let control = Control::new(&QueryEntailmentOptions::default(), None);
        let (all, _) = observed_snapshot(&store, Limits::default(), &control);
        // Record 2 breaches both ceilings: the quad ceiling is reported.
        let (sizes, result) = observed_snapshot(
            &store,
            Limits {
                quads: NonZeroUsize::new(1),
                bytes: NonZeroUsize::new(all[0]),
            },
            &control,
        );
        assert_eq!(sizes.len(), 2);
        assert_eq!(snapshot_limit(&result), Some("quad"));
        // Record 1 breaches only the byte ceiling.
        let (sizes, result) = observed_snapshot(
            &store,
            Limits {
                quads: NonZeroUsize::new(1),
                bytes: NonZeroUsize::new(all[0] - 1),
            },
            &control,
        );
        assert_eq!(sizes.len(), 1);
        assert_eq!(snapshot_limit(&result), Some("estimated-byte"));
    }

    #[test]
    fn unbounded_admission_matches_the_compatibility_snapshot() {
        use crate::store::StorageError;
        let store = quad_store(4);
        let graph = NamedNode::new("urn:test:g").unwrap();
        store
            .insert(Quad::new(
                NamedNode::new("urn:test:s").unwrap(),
                NamedNode::new("urn:test:p").unwrap(),
                NamedNode::new("urn:test:o").unwrap(),
                graph,
            ))
            .unwrap();
        store
            .insert_named_graph(NamedNode::new("urn:test:empty").unwrap())
            .unwrap();
        let control = Control::new(&QueryEntailmentOptions::default(), None);
        let (sizes, result) = observed_snapshot(&store, Limits::default(), &control);
        let (dataset, graphs) = result.unwrap();
        let (expected, expected_graphs) = store
            .snapshot_contents_with_control(|| Ok::<(), StorageError>(()))
            .unwrap();
        assert_eq!(dataset, expected);
        assert_eq!(graphs, expected_graphs);
        assert_eq!(sizes.len(), expected.len() + expected_graphs.len());
    }

    #[test]
    fn configured_ceilings_fail_closed_for_profiles_that_cannot_enforce_them() {
        let store = Store::new().unwrap();
        for profile in [
            QueryEntailment::Simple,
            QueryEntailment::Rdf12Finite,
            QueryEntailment::Owl2RlRdfBounded,
        ] {
            if !profile.is_supported() {
                continue;
            }
            for options in [
                QueryEntailmentOptions::new(profile)
                    .with_max_materialized_quads(Some(NonZeroUsize::MAX)),
                QueryEntailmentOptions::new(profile)
                    .with_max_estimated_materialization_bytes(Some(NonZeroUsize::MAX)),
            ] {
                assert!(matches!(
                    options.ensure_supported(),
                    Err(QueryEntailmentError::UnsupportedLimits { profile: p }) if p == profile
                ));
                for query_dataset in [false, true] {
                    assert!(matches!(
                        materialize(&store, &options, query_dataset),
                        Err(QueryEntailmentError::UnsupportedLimits { profile: p }) if p == profile
                    ));
                }
            }
            // The same profile without ceilings keeps working unchanged.
            materialize(&store, &QueryEntailmentOptions::new(profile), false).unwrap();
        }
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    fn rdfs_base() -> Dataset {
        use crate::model::vocab::{rdf, rdfs};
        let mut base = Dataset::new();
        base.insert(Quad::new(
            NamedNode::new("urn:test:Dog").unwrap(),
            rdfs::SUB_CLASS_OF,
            NamedNode::new("urn:test:Animal").unwrap(),
            GraphName::DefaultGraph,
        ));
        base.insert(Quad::new(
            NamedNode::new("urn:test:fido").unwrap(),
            rdf::TYPE,
            NamedNode::new("urn:test:Dog").unwrap(),
            GraphName::DefaultGraph,
        ));
        base
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    fn fido_is_animal() -> Quad {
        Quad::new(
            NamedNode::new("urn:test:fido").unwrap(),
            crate::model::vocab::rdf::TYPE,
            NamedNode::new("urn:test:Animal").unwrap(),
            GraphName::DefaultGraph,
        )
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    fn rdfs_store() -> Store {
        let store = Store::new().unwrap();
        for quad in &rdfs_base() {
            store.insert(quad).unwrap();
        }
        store
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    fn rdfs_limits(quads: Option<usize>, bytes: Option<usize>) -> QueryEntailmentOptions {
        QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite)
            .with_max_materialized_quads(quads.and_then(NonZeroUsize::new))
            .with_max_estimated_materialization_bytes(bytes.and_then(NonZeroUsize::new))
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn saturated_ceilings_preserve_the_unbounded_rdfs_result() {
        let store = rdfs_store();
        let unbounded = QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite);
        let saturated = unbounded
            .clone()
            .with_max_materialized_quads(Some(NonZeroUsize::MAX))
            .with_max_estimated_materialization_bytes(Some(NonZeroUsize::MAX));
        for query_dataset in [false, true] {
            let expected = materialize(&store, &unbounded, query_dataset).unwrap();
            assert!(expected.dataset().contains(&fido_is_animal()));
            let actual = materialize(&store, &saturated, query_dataset).unwrap();
            assert_eq!(actual.dataset(), expected.dataset());
            assert_eq!(actual.named_graphs, expected.named_graphs);
        }
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn quad_ceiling_stops_snapshot_copy_and_admits_the_exact_boundary() {
        let store = rdfs_store();
        for query_dataset in [false, true] {
            assert!(matches!(
                materialize(&store, &rdfs_limits(Some(1), None), query_dataset),
                Err(QueryEntailmentError::LimitExceeded {
                    limit: "quad",
                    stage: "snapshot",
                    ceiling: 1
                })
            ));
            // Exactly two stored quads pass snapshot and source; the RDF axioms
            // are then rejected before insertion into the working dataset.
            assert!(matches!(
                materialize(&store, &rdfs_limits(Some(2), None), query_dataset),
                Err(QueryEntailmentError::LimitExceeded {
                    limit: "quad",
                    stage: "working",
                    ceiling: 2
                })
            ));
        }
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn empty_named_graphs_are_bounded_before_their_axioms_are_inserted() {
        let store = Store::new().unwrap();
        for n in 0..3 {
            store
                .insert_named_graph(NamedNode::new(format!("urn:test:empty{n}")).unwrap())
                .unwrap();
        }
        for query_dataset in [false, true] {
            assert!(matches!(
                materialize(&store, &rdfs_limits(Some(2), None), query_dataset),
                Err(QueryEntailmentError::LimitExceeded {
                    limit: "quad",
                    stage: "snapshot",
                    ceiling: 2
                })
            ));
            assert!(matches!(
                materialize(&store, &rdfs_limits(Some(3), None), query_dataset),
                Err(QueryEntailmentError::LimitExceeded {
                    limit: "quad",
                    stage: "working",
                    ceiling: 3
                })
            ));
        }
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn engine_fact_ceiling_keeps_its_original_error() {
        let base = rdfs_base();
        let unbounded = QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite);
        let visible = QueryEntailmentDataset::from_snapshot(
            base.clone(),
            Vec::new(),
            &unbounded,
            Control::new(&unbounded, None),
        )
        .unwrap()
        .dataset()
        .len();
        let control = Control::new(&unbounded, None);
        let working = rdfs_working_dataset(
            &base,
            &[],
            &control,
            Budget::new(Limits::default(), WORKING_STAGE),
        )
        .unwrap();
        let ceiling = visible - 1;
        // Wrapper stages fit; only the engine's closure can exceed the ceiling.
        assert!(working.len() < ceiling);
        let options = rdfs_limits(Some(ceiling), None);
        let error = QueryEntailmentDataset::from_snapshot(
            base,
            Vec::new(),
            &options,
            Control::new(&options, None),
        )
        .unwrap_err();
        assert!(matches!(error, QueryEntailmentError::Rdfs(_)));
        assert_eq!(
            error.to_string(),
            format!("Facts limit of {ceiling} exceeded")
        );
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn engine_memory_ceiling_keeps_its_original_error() {
        use super::super::estimated_quad_bytes;
        let base = rdfs_base();
        let unbounded = QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite);
        let control = Control::new(&unbounded, None);
        let working = rdfs_working_dataset(
            &base,
            &[],
            &control,
            Budget::new(Limits::default(), WORKING_STAGE),
        )
        .unwrap();
        let working_bytes = working
            .iter()
            .map(|quad| estimated_quad_bytes(&quad))
            .sum::<usize>();
        // The working estimate fits exactly; the engine's first new axiom does not.
        let ceiling = working_bytes + 1;
        let options = rdfs_limits(None, Some(ceiling));
        let error = QueryEntailmentDataset::from_snapshot(
            base,
            Vec::new(),
            &options,
            Control::new(&options, None),
        )
        .unwrap_err();
        assert!(matches!(error, QueryEntailmentError::Rdfs(_)));
        assert_eq!(
            error.to_string(),
            format!("Memory limit of {ceiling} exceeded")
        );
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn huge_terms_fail_before_any_further_copy() {
        use crate::model::Literal;
        let literal_store = Store::new().unwrap();
        literal_store
            .insert(Quad::new(
                NamedNode::new("urn:test:s").unwrap(),
                NamedNode::new("urn:test:p").unwrap(),
                Literal::new_simple_literal("x".repeat(1 << 20)),
                GraphName::DefaultGraph,
            ))
            .unwrap();
        let graph_store = Store::new().unwrap();
        graph_store
            .insert_named_graph(
                NamedNode::new(format!("urn:test:{}", "g".repeat(1 << 20))).unwrap(),
            )
            .unwrap();
        let options = rdfs_limits(None, Some(65_536));
        for store in [&literal_store, &graph_store] {
            for query_dataset in [false, true] {
                assert!(matches!(
                    materialize(store, &options, query_dataset),
                    Err(QueryEntailmentError::LimitExceeded {
                        limit: "estimated-byte",
                        stage: "snapshot",
                        ceiling: 65_536
                    })
                ));
            }
        }
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn ceilings_do_not_mask_cancellation_or_deadlines() {
        use crate::sparql::QueryEvaluationError;
        use std::time::{Duration, Instant};
        let store = rdfs_store();
        let token = CancellationToken::new();
        token.cancel();
        assert!(matches!(
            QueryEntailmentDataset::from_store(
                &store,
                &rdfs_limits(Some(1), Some(1)).with_cancellation_token(token)
            ),
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::Cancelled
            ))
        ));
        assert!(matches!(
            QueryEntailmentDataset::from_store(
                &store,
                &rdfs_limits(Some(1), Some(1)).with_timeout(Some(Duration::ZERO))
            ),
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::TimedOut
            ))
        ));
        assert!(matches!(
            QueryEntailmentDataset::from_store_with_query_dataset(
                &store,
                &rdfs_limits(Some(1), Some(1)),
                &QueryDatasetSpecification::new(),
                Some(CancellationToken::new().with_deadline(Instant::now())),
            ),
            Err(QueryEntailmentError::Evaluation(
                QueryEvaluationError::TimedOut
            ))
        ));
        // A live budget does not turn a ceiling failure into a timeout.
        let live = rdfs_limits(Some(1), None)
            .with_timeout(Some(Duration::from_secs(60)))
            .with_cancellation_token(CancellationToken::new());
        assert!(matches!(
            QueryEntailmentDataset::from_store(&store, &live),
            Err(QueryEntailmentError::LimitExceeded {
                stage: "snapshot",
                ..
            })
        ));
        // A bounded success releases its relative timeout like an unbounded one.
        let mut bounded = QueryEntailmentDataset::from_store(
            &store,
            &rdfs_limits(Some(usize::MAX), Some(usize::MAX))
                .with_timeout(Some(Duration::from_secs(60))),
        )
        .unwrap();
        bounded.control.expire_materialization_clock_for_test();
        assert!(matches!(
            bounded
                .internal_quads_for_pattern(None, None, None, Some(None))
                .next(),
            Some(Ok(_))
        ));
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn ceiling_failures_preserve_primary_store_contents() {
        let store = rdfs_store();
        let before = store.iter().collect::<Result<Vec<_>, _>>().unwrap();
        for options in [rdfs_limits(Some(2), None), rdfs_limits(None, Some(1))] {
            for query_dataset in [false, true] {
                assert!(matches!(
                    materialize(&store, &options, query_dataset),
                    Err(QueryEntailmentError::LimitExceeded { .. })
                ));
            }
        }
        assert_eq!(store.iter().collect::<Result<Vec<_>, _>>().unwrap(), before);
        assert!(!store.contains(&fido_is_animal()).unwrap());
        let unbounded = QueryEntailmentDataset::from_store(
            &store,
            &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
        )
        .unwrap();
        assert!(unbounded.dataset().contains(&fido_is_animal()));
        for quad in &before {
            assert!(unbounded.dataset().contains(quad));
        }
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn prepared_queries_surface_ceiling_errors() {
        let store = rdfs_store();
        let result = crate::sparql::SparqlEvaluator::new()
            .parse_query("ASK {}")
            .unwrap()
            .on_store_with_entailment(&store, &rdfs_limits(Some(2), None));
        assert!(matches!(
            result,
            Err(QueryEntailmentError::LimitExceeded {
                limit: "quad",
                stage: "working",
                ceiling: 2
            })
        ));
    }
}
