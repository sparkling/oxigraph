#![cfg(test)]

use oxiri::Iri;
use oxrdf::{Dataset, GraphName, NamedNode, Quad, Term, Variable};
use oxstr::OxString;
use spareval::{
    CancellationToken, DistinctBufferBudget, GroupBufferBudget, InnerJoinBuildBudget, InternalQuad,
    QueryEvaluationError, QueryEvaluator, QueryResults, QuerySolution, QuerySolutionIter,
    QueryableDataset, ServiceHandler, SortBufferBudget,
};
use spargebra::SparqlParser;
use spargebra::algebra::QueryExpression;
use std::io;
use std::iter::once;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn node(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn data(graph: &GraphName, with_probe: bool) -> Dataset {
    let mut data = Dataset::new();
    for value in ["urn:a", "urn:b"] {
        data.insert(Quad::new(
            node("urn:s"),
            node("urn:p"),
            node(value),
            graph.clone(),
        ));
    }
    if with_probe {
        for value in ["urn:c", "urn:d"] {
            data.insert(Quad::new(
                node("urn:s"),
                node("urn:q"),
                node(value),
                graph.clone(),
            ));
        }
    }
    data
}

/// Objects of `predicate` in the default graph, taken from the same underlying
/// [`Dataset`] iterator the evaluator reads. The fixture must not assume a
/// lexical order: interning makes the actual order dataset-defined.
fn dataset_objects(data: &Dataset, predicate: &str) -> Vec<Term> {
    let predicate = Term::from(node(predicate));
    data.internal_quads_for_pattern(None, Some(&predicate), None, Some(None))
        .map(|quad| match quad {
            Ok(quad) => quad.object,
            Err(never) => match never {},
        })
        .collect()
}

struct ReadProbe {
    data: Dataset,
    build_reads: Arc<AtomicUsize>,
    probe_reads: Arc<AtomicUsize>,
    cancel_probe_eof: Option<CancellationToken>,
    build_error: bool,
    probe_error: bool,
}

impl ReadProbe {
    fn new(data: Dataset) -> Self {
        Self {
            data,
            build_reads: Arc::default(),
            probe_reads: Arc::default(),
            cancel_probe_eof: None,
            build_error: false,
            probe_error: false,
        }
    }
}

impl<'a> QueryableDataset<'a> for &'a ReadProbe {
    type InternalTerm = Term;
    type Error = io::Error;

    fn internal_quads_for_pattern(
        &self,
        subject: Option<&Term>,
        predicate: Option<&Term>,
        object: Option<&Term>,
        graph_name: Option<Option<&Term>>,
    ) -> impl Iterator<Item = Result<InternalQuad<Term>, io::Error>> + use<'a> {
        let is_probe = predicate == Some(&Term::from(node("urn:q")));
        let reads = Arc::clone(if is_probe {
            &self.probe_reads
        } else {
            &self.build_reads
        });
        let cancel = if is_probe {
            self.cancel_probe_eof.clone()
        } else {
            None
        };
        let failure = if is_probe {
            self.probe_error.then_some("probe failure")
        } else {
            self.build_error.then_some("build failure")
        };
        let mut rows =
            (&self.data).internal_quads_for_pattern(subject, predicate, object, graph_name);
        let mut first = true;
        std::iter::from_fn(move || {
            reads.fetch_add(1, Ordering::SeqCst);
            if std::mem::take(&mut first) {
                if let Some(message) = failure {
                    return Some(Err(io::Error::other(message)));
                }
            }
            let row = rows.next().map(|r| r.map_err(|never| match never {}));
            if row.is_none() {
                if let Some(token) = &cancel {
                    token.cancel();
                }
            }
            row
        })
    }

    fn internalize_term(&self, term: Term) -> Result<Term, io::Error> {
        Ok(term)
    }

    fn externalize_term(&self, term: Term) -> Result<Term, io::Error> {
        Ok(term)
    }
}

/// Counts its own dispatches so an empty probe cannot be proved to have run a
/// nested SERVICE by agreeing with another plan of the same query.
struct CountingService {
    calls: Arc<AtomicUsize>,
    fail: bool,
}

impl ServiceHandler for CountingService {
    type Error = io::Error;

    fn handle(
        &self,
        _expression: &QueryExpression,
        _base_iri: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, io::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err(io::Error::other("service failure"));
        }
        let variables: Arc<[Variable]> = [Variable::new_unchecked("service")].into();
        Ok(QuerySolutionIter::new(
            Arc::clone(&variables),
            once(Ok(QuerySolution::from((
                variables,
                vec![Some(node("urn:service").into())],
            )))),
        ))
    }
}

const QUERY: &str = "SELECT ?s ?o ?v WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v }";

#[expect(
    clippy::unwrap_in_result,
    reason = "fixture syntax is an independent assertion"
)]
fn rows(
    evaluator: &QueryEvaluator,
    query: &str,
    data: &ReadProbe,
) -> Result<Vec<Vec<Option<Term>>>, QueryEvaluationError> {
    let query = SparqlParser::new().parse_query(query).unwrap();
    let QueryResults::Solutions(rows) = evaluator.prepare(&query).execute(data)? else {
        unreachable!("fixture expects SELECT");
    };
    let columns = rows.variables().len();
    rows.map(|row| row.map(|row| (0..columns).map(|i| row.get(i).cloned()).collect()))
        .collect()
}

#[test]
fn empty_quad_probe_skips_native_build_reads_and_nested_cartesian_prefixes() {
    for query in [
        QUERY,
        "SELECT ?s WHERE { ?s <urn:p> ?a . ?s <urn:p> ?b . ?s <urn:p> ?c . ?s <urn:q> ?missing }",
        "SELECT ?s WHERE { ?s <urn:p>+ ?a . ?s <urn:p>+ ?b . ?s <urn:q> ?missing }",
    ] {
        let probe = ReadProbe::new(data(&GraphName::DefaultGraph, false));
        assert!(
            rows(
                &QueryEvaluator::new().without_optimizations(),
                query,
                &probe
            )
            .unwrap()
            .is_empty()
        );
        assert_eq!(probe.build_reads.load(Ordering::SeqCst), 0, "{query}");
        assert_eq!(probe.probe_reads.load(Ordering::SeqCst), 1, "{query}");
    }
}

#[test]
fn nonempty_probe_keeps_first_tuple_order_and_duplicate_multiplicity() {
    let dataset = data(&GraphName::DefaultGraph, true);
    // The Cartesian iterator emits probe rows outermost and build rows inside,
    // each in the dataset's own iteration order.
    let mut expected = Vec::new();
    for v in dataset_objects(&dataset, "urn:q") {
        for o in dataset_objects(&dataset, "urn:p") {
            expected.push(vec![
                Some(node("urn:s").into()),
                Some(o.clone()),
                Some(v.clone()),
            ]);
        }
    }

    let preflighted = ReadProbe::new(dataset.clone());
    let actual = rows(
        &QueryEvaluator::new().without_optimizations(),
        QUERY,
        &preflighted,
    )
    .unwrap();
    assert_eq!(actual, expected);
    // The peeked first probe tuple is retained, not re-read or dropped.
    assert_eq!(preflighted.build_reads.load(Ordering::SeqCst), 3);
    assert_eq!(preflighted.probe_reads.load(Ordering::SeqCst), 3);

    // Same dataset through the original build-first path, which an unexhausted
    // budget still forces.
    let budgeted = ReadProbe::new(dataset.clone());
    let budget = InnerJoinBuildBudget::new(64);
    let build_first = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(budget.clone());
    assert_eq!(rows(&build_first, QUERY, &budgeted).unwrap(), expected);
    assert_eq!(budget.charged_rows(), 2);
    assert_eq!(budgeted.build_reads.load(Ordering::SeqCst), 3);
    assert_eq!(budgeted.probe_reads.load(Ordering::SeqCst), 3);

    let duplicated = "SELECT ?o WHERE { ?s <urn:p> ?o . ?s <urn:p> ?a . ?s <urn:q> ?v }";
    let preflighted = ReadProbe::new(dataset.clone());
    let duplicates = rows(
        &QueryEvaluator::new().without_optimizations(),
        duplicated,
        &preflighted,
    )
    .unwrap();
    let budgeted = ReadProbe::new(dataset.clone());
    let build_first = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(InnerJoinBuildBudget::new(64));
    assert_eq!(
        duplicates,
        rows(&build_first, duplicated, &budgeted).unwrap()
    );
    assert_eq!(duplicates.len(), 8);
    for value in dataset_objects(&dataset, "urn:p") {
        assert_eq!(
            duplicates
                .iter()
                .filter(|row| row[0] == Some(value.clone()))
                .count(),
            4
        );
    }
}

#[test]
fn every_configured_row_budget_disables_preflight_and_keeps_build_first_reads() {
    let base = || QueryEvaluator::new().without_optimizations();
    let inner_join = InnerJoinBuildBudget::new(64);
    let sort = SortBufferBudget::new(64);
    let distinct = DistinctBufferBudget::new(64);
    let group = GroupBufferBudget::new(64);
    for (name, evaluator) in [
        (
            "inner join",
            base().with_inner_join_build_budget(inner_join.clone()),
        ),
        ("sort", base().with_sort_buffer_budget(sort.clone())),
        (
            "distinct",
            base().with_distinct_buffer_budget(distinct.clone()),
        ),
        ("group", base().with_group_buffer_budget(group.clone())),
    ] {
        let probe = ReadProbe::new(data(&GraphName::DefaultGraph, false));
        assert!(
            rows(&evaluator, QUERY, &probe).unwrap().is_empty(),
            "{name}"
        );
        assert_eq!(probe.build_reads.load(Ordering::SeqCst), 3, "{name}");
        assert_eq!(probe.probe_reads.load(Ordering::SeqCst), 1, "{name}");
    }
    // The query has no sort, distinct or group operator, so those handles stay
    // unused as well as unexhausted and still have to disable the preflight.
    assert_eq!(inner_join.charged_rows(), 2);
    assert_eq!(sort.charged_rows(), 0);
    assert_eq!(distinct.charged_rows(), 0);
    assert_eq!(group.charged_rows(), 0);
}

#[test]
fn nested_service_build_subtree_still_runs_on_empty_probe() {
    const SERVICE_QUERY: &str =
        "SELECT ?s ?v WHERE { ?s <urn:p> ?o . SERVICE <urn:service> {} . ?s <urn:q> ?v }";
    let calls = Arc::new(AtomicUsize::new(0));
    let probe = ReadProbe::new(data(&GraphName::DefaultGraph, false));
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_service_handler(
            node("urn:service"),
            CountingService {
                calls: Arc::clone(&calls),
                fail: false,
            },
        );
    assert!(rows(&evaluator, SERVICE_QUERY, &probe).unwrap().is_empty());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(probe.build_reads.load(Ordering::SeqCst), 3);
    assert_eq!(probe.probe_reads.load(Ordering::SeqCst), 1);

    // A failing handler is still dispatched, and its silent-capable error keeps
    // the pre-existing empty-probe discard.
    let calls = Arc::new(AtomicUsize::new(0));
    let probe = ReadProbe::new(data(&GraphName::DefaultGraph, false));
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_service_handler(
            node("urn:service"),
            CountingService {
                calls: Arc::clone(&calls),
                fail: true,
            },
        );
    assert!(rows(&evaluator, SERVICE_QUERY, &probe).unwrap().is_empty());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn nested_custom_function_build_subtree_still_runs_on_empty_probe() {
    const FUNCTION_QUERY: &str = "SELECT ?s ?v WHERE { \
         { SELECT ?s ?o WHERE { ?s <urn:p> ?o FILTER(<urn:fn>(?o)) } } . ?s <urn:q> ?v }";
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let probe = ReadProbe::new(data(&GraphName::DefaultGraph, false));
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_custom_function(node("urn:fn"), move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            Some(oxrdf::Literal::from(true).into())
        });
    assert!(rows(&evaluator, FUNCTION_QUERY, &probe).unwrap().is_empty());
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(probe.build_reads.load(Ordering::SeqCst), 3);
    assert_eq!(probe.probe_reads.load(Ordering::SeqCst), 1);
}

#[test]
fn scaled_left_deep_prefix_is_not_materialized_before_an_empty_probe() {
    // The fuzzer OOM shape: a left-deep chain over repeated objects followed by
    // an absent right-hand predicate. It is scaled down so that a regression
    // stays bounded: the skipped prefix is 4^7 tuples here, not the input's.
    let mut dataset = Dataset::new();
    for object in ["urn:o0", "urn:o1", "urn:o2", "urn:o3"] {
        dataset.insert(Quad::new(
            node("urn:s"),
            node("urn:p"),
            node(object),
            GraphName::DefaultGraph,
        ));
    }
    let query = "SELECT ?s WHERE { \
         ?s <urn:p> ?o0 . ?s <urn:p> ?o1 . ?s <urn:p> ?o2 . ?s <urn:p> ?o3 . \
         ?s <urn:p> ?o4 . ?s <urn:p> ?o5 . ?s <urn:p> ?o6 . ?s <urn:q> ?missing }";
    let probe = ReadProbe::new(dataset);
    assert!(
        rows(
            &QueryEvaluator::new().without_optimizations(),
            query,
            &probe
        )
        .unwrap()
        .is_empty()
    );
    assert_eq!(probe.build_reads.load(Ordering::SeqCst), 0);
    assert_eq!(probe.probe_reads.load(Ordering::SeqCst), 1);
}

#[test]
fn graph_scope_is_preserved_for_empty_and_nonempty_probe() {
    let graph = GraphName::from(node("urn:g"));
    let mut dataset = data(&graph, false);
    dataset.insert(Quad::new(
        node("urn:s"),
        node("urn:q"),
        node("urn:default-only"),
        GraphName::DefaultGraph,
    ));
    let query = "SELECT ?o ?v WHERE { GRAPH <urn:g> { ?s <urn:p> ?o . ?s <urn:q> ?v } }";
    let probe = ReadProbe::new(dataset);
    assert!(
        rows(
            &QueryEvaluator::new().without_optimizations(),
            query,
            &probe
        )
        .unwrap()
        .is_empty()
    );
    let probe = ReadProbe::new(data(&graph, true));
    let result = rows(
        &QueryEvaluator::new().without_optimizations(),
        query,
        &probe,
    )
    .unwrap();
    assert_eq!(result.len(), 4);
    assert!(
        result
            .iter()
            .all(|row| row[1] != Some(node("urn:default-only").into()))
    );
}

#[test]
fn configured_budget_keeps_build_failure_before_empty_probe() {
    let probe = ReadProbe::new(data(&GraphName::DefaultGraph, false));
    let budget = InnerJoinBuildBudget::new(1);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(budget.clone());
    assert!(matches!(
        rows(&evaluator, QUERY, &probe),
        Err(QueryEvaluationError::ResourceLimitExceeded { limit: 1, .. })
    ));
    assert_eq!(budget.charged_rows(), 1);
    assert_eq!(probe.build_reads.load(Ordering::SeqCst), 2);
    assert_eq!(probe.probe_reads.load(Ordering::SeqCst), 0);
}

#[test]
fn cancellation_at_probe_eof_is_not_successful_emptiness() {
    let token = CancellationToken::new();
    let mut probe = ReadProbe::new(data(&GraphName::DefaultGraph, false));
    probe.cancel_probe_eof = Some(token.clone());
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_cancellation_token(token);
    assert!(matches!(
        rows(&evaluator, QUERY, &probe),
        Err(QueryEvaluationError::Cancelled)
    ));
    assert_eq!(probe.build_reads.load(Ordering::SeqCst), 0);
    assert_eq!(probe.probe_reads.load(Ordering::SeqCst), 1);
}

#[test]
fn error_probe_keeps_build_error_precedence_and_empty_build_behavior() {
    let mut probe = ReadProbe::new(data(&GraphName::DefaultGraph, false));
    probe.build_error = true;
    probe.probe_error = true;
    assert_eq!(
        rows(
            &QueryEvaluator::new().without_optimizations(),
            QUERY,
            &probe
        )
        .unwrap_err()
        .to_string(),
        "build failure"
    );
    probe.data = Dataset::new();
    probe.build_error = false;
    assert!(
        rows(
            &QueryEvaluator::new().without_optimizations(),
            QUERY,
            &probe
        )
        .unwrap()
        .is_empty()
    );
}

#[cfg(feature = "sparql-12")]
#[test]
fn older_modes_keep_incompatible_build_terms_before_empty_probe() {
    use spargebra::SparqlVersion;

    for version in [SparqlVersion::V1_1, SparqlVersion::V1_2Basic] {
        let mut dataset = Dataset::new();
        dataset.insert(Quad::new(
            node("urn:s"),
            node("urn:p"),
            oxrdf::Triple::new(node("urn:a"), node("urn:p"), node("urn:b")),
            GraphName::DefaultGraph,
        ));
        let probe = ReadProbe::new(dataset);
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_version(version);
        assert!(matches!(
            rows(&evaluator, QUERY, &probe),
            Err(QueryEvaluationError::IncompatibleTerm { version: found, .. }) if found == version
        ));
        assert_eq!(probe.probe_reads.load(Ordering::SeqCst), 0);
    }
}
