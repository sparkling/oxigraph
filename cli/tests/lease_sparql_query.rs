//! Public-API tests for prepared SPARQL queries over a leased staged
//! transaction, on real memory and disk stores. No sleeps; time is injected.

use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Variable};
use oxigraph::sparql::{
    CancellationToken, PreparedSparqlQuery, QueryEvaluationError, QueryResource, QueryResults,
    SortBufferBudget, SparqlEvaluator,
};
use oxigraph::store::{
    OwnedTransactionalDataset, Store, TransactionRequest, TransactionStartControl,
};
use oxigraph_cli::lease::registry::{ActiveOperation, Registry, RegistryError, RegistryLimits};
use oxigraph_cli::lease::{
    CommitKey, LeaseBinding, LeaseError, LeaseId, LeaseLimits, LeasePhase, LimitsSpec, LogicalTime,
    Outcome, RollbackReason,
};
use std::error::Error;
use std::time::Duration;

type TestError = Box<dyn Error + Send + Sync>;
type TestResult = Result<(), TestError>;
type Table = (Vec<String>, Vec<Vec<Option<String>>>);
type Build = fn() -> Result<PreparedSparqlQuery, TestError>;
type Check = fn(&QueryEvaluationError) -> bool;

const TIMEOUT: Duration = Duration::from_secs(1);
const PROBE: Duration = Duration::from_millis(50);
const ALL: &str = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
const QUERIES: [&str; 10] = [
    ALL,
    "SELECT ?g ?s ?o WHERE { GRAPH ?g { ?s <urn:lq:p> ?o } }",
    "SELECT ?g WHERE { GRAPH ?g { } }",
    "SELECT ?s ?o FROM NAMED <urn:lq:g1> WHERE { GRAPH <urn:lq:g1> { ?s <urn:lq:p> ?o } }",
    "SELECT ?b ?l WHERE { { ?b <urn:lq:label> ?l } UNION { GRAPH ?g { ?b <urn:lq:label> ?l } } }",
    "SELECT (COUNT(*) AS ?n) WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }",
    "ASK { <urn:lq:a> <urn:lq:p> ?o }",
    "ASK { <urn:lq:none> ?p ?o }",
    "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
    "CONSTRUCT { ?s <urn:lq:seen> ?g } WHERE { GRAPH ?g { ?s ?p ?o } }",
];

#[derive(Debug, PartialEq)]
enum Refusal {
    Unknown,
    Finished,
    Lease(LeaseError),
    Query,
    Other,
}

fn refusal<T>(result: Result<T, RegistryError>) -> Option<Refusal> {
    Some(match result.err()? {
        RegistryError::Unknown => Refusal::Unknown,
        RegistryError::Finished => Refusal::Finished,
        RegistryError::Lease(error) => Refusal::Lease(error),
        RegistryError::Query(_) => Refusal::Query,
        _ => Refusal::Other,
    })
}

fn t(time: u64) -> LogicalTime {
    LogicalTime(time)
}

fn ck(byte: u8) -> CommitKey {
    CommitKey::new([byte; 16])
}

fn n(label: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:lq:{label}"))
}

fn quad(subject: &str, predicate: &str, object: &str) -> Quad {
    Quad::new(n(subject), n(predicate), n(object), GraphName::DefaultGraph)
}

fn owner() -> LeaseBinding {
    LeaseBinding::new("alice", "acme", "repo-1").expect("valid binding")
}

fn registry() -> Registry {
    let spec = LimitsSpec {
        idle: 10,
        absolute: 100,
        max_extension: 20,
        cancel_grace: 5,
        commit_wait: 7,
        retention: 50,
    };
    Registry::new(RegistryLimits {
        lease: LeaseLimits::new(spec).expect("valid lease limits"),
        max_entries: 16,
        max_global: 8,
        max_per_repository: 8,
        max_per_principal: 8,
        max_operations_per_lease: 100,
        max_start_timeout: TIMEOUT,
        max_maintenance_work: 64,
    })
    .expect("valid registry limits")
}

fn open(registry: &Registry, store: &Store, byte: u8) -> Result<LeaseId, RegistryError> {
    registry.begin(store, &owner(), ck(byte), t(0), TIMEOUT)
}

fn commit(registry: &Registry, id: LeaseId, time: u64) -> TestResult {
    let pending = registry.prepare_commit(&owner(), id, t(time))?;
    let report = pending.execute(t(time))?;
    assert!(report.recorded);
    assert_eq!(report.outcome, Outcome::Committed);
    Ok(())
}

fn writer_free(store: &Store) -> bool {
    let probe = TransactionStartControl::new().with_timeout(PROBE);
    let request = TransactionRequest::default();
    match store.start_owned_transaction_with_control(request, probe) {
        Ok(started) => started.into_transaction().rollback().is_ok(),
        Err(_) => false,
    }
}

/// Default graph: 3 quads. `g1`: 2. Blank graph `gb`: 1. One empty named graph.
fn fixture() -> (Vec<Quad>, Vec<NamedOrBlankNode>) {
    let x = BlankNode::new_unchecked("x");
    let gb = BlankNode::new_unchecked("gb");
    let quads = vec![
        Quad::new(
            n("a"),
            n("p"),
            Literal::new_simple_literal("1"),
            GraphName::DefaultGraph,
        ),
        Quad::new(n("a"), n("q"), n("b"), GraphName::DefaultGraph),
        Quad::new(
            x.clone(),
            n("label"),
            Literal::new_simple_literal("x"),
            GraphName::DefaultGraph,
        ),
        Quad::new(n("a"), n("p"), Literal::new_simple_literal("2"), n("g1")),
        Quad::new(n("c"), n("p"), Literal::new_simple_literal("3"), n("g1")),
        Quad::new(x, n("label"), Literal::new_simple_literal("y"), gb),
    ];
    (quads, vec![NamedOrBlankNode::from(n("empty"))])
}

fn reference() -> Result<Store, TestError> {
    let (quads, graphs) = fixture();
    let store = Store::new()?;
    for graph in graphs {
        store.insert_named_graph(graph)?;
    }
    store.extend(quads)?;
    Ok(store)
}

fn stage_fixture(operation: &mut ActiveOperation<'_>) -> TestResult {
    let (quads, graphs) = fixture();
    for graph in graphs {
        operation.insert_named_graph(graph)?;
    }
    operation.extend(quads)?;
    Ok(())
}

fn evaluator() -> SparqlEvaluator {
    SparqlEvaluator::new().with_deny_all_egress_policy()
}

fn table(results: QueryResults<'_>) -> Result<Table, TestError> {
    let QueryResults::Solutions(solutions) = results else {
        return Err("expected solutions".into());
    };
    let variables = solutions
        .variables()
        .iter()
        .map(|variable| variable.as_str().to_owned())
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    for solution in solutions {
        let solution = solution?;
        rows.push(
            variables
                .iter()
                .map(|variable| solution.get(variable.as_str()).map(ToString::to_string))
                .collect::<Vec<_>>(),
        );
    }
    rows.sort();
    Ok((variables, rows))
}

fn render(results: QueryResults<'_>) -> Result<String, TestError> {
    if let QueryResults::Boolean(value) = results {
        return Ok(format!("ask {value}"));
    }
    if let QueryResults::Graph(triples) = results {
        let mut lines = triples
            .map(|triple| triple.map(|triple| triple.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        lines.sort();
        return Ok(format!("graph {lines:?}"));
    }
    Ok(format!("select {:?}", table(results)?))
}

fn staged_count(operation: &ActiveOperation<'_>, query: &str) -> Result<usize, TestError> {
    let results = operation.query(evaluator().parse_query(query)?)?;
    Ok(table(results)?.1.len())
}

fn stored_count(store: &Store, query: &str) -> Result<usize, TestError> {
    let prepared = evaluator().parse_query(query)?;
    let results = prepared.on_store(store).execute()?;
    Ok(table(results)?.1.len())
}

fn first_error(
    result: Result<QueryResults<'_>, QueryEvaluationError>,
) -> Option<QueryEvaluationError> {
    match result {
        Err(error) => Some(error),
        Ok(QueryResults::Solutions(solutions)) => solutions.filter_map(Result::err).next(),
        Ok(_) => None,
    }
}

/// Errors raised while opening the query must be the typed `Query` variant;
/// anything else is a test failure, not an evaluation error.
fn staged_result<'a>(
    operation: &'a ActiveOperation<'_>,
    prepared: PreparedSparqlQuery,
) -> Result<Result<QueryResults<'a>, QueryEvaluationError>, RegistryError> {
    match operation.query(prepared) {
        Ok(results) => Ok(Ok(results)),
        Err(RegistryError::Query(error)) => Ok(Err(error)),
        Err(other) => Err(other),
    }
}

fn staged_forms_match_the_reference(store: &Store) -> TestResult {
    let registry = registry();
    let reference = reference()?;
    let empty = Store::new()?;
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner(), id, t(1))?;
    stage_fixture(&mut operation)?;
    for query in QUERIES {
        let prepared = evaluator().parse_query(query)?;
        let expected = render(prepared.clone().on_store(&reference).execute()?)?;
        let staged = render(operation.query(prepared)?)?;
        assert_eq!(staged, expected, "{query}");
    }
    let prepared = evaluator().parse_query(ALL)?;
    let blank = render(prepared.clone().on_store(&empty).execute()?)?;
    assert_ne!(render(operation.query(prepared)?)?, blank);
    assert!(store.is_empty()?);
    operation.finish(t(2))?;
    drop(operation);
    registry.rollback(&owner(), id, t(3))?;
    assert!(writer_free(store));
    Ok(())
}

fn read_your_writes_across_operations(store: &Store) -> TestResult {
    let registry = registry();
    let id = open(&registry, store, 1)?;
    let mut first = registry.begin_operation(&owner(), id, t(1))?;
    first.insert(quad("a", "p", "b"))?;
    assert_eq!(staged_count(&first, ALL)?, 1);
    first.finish(t(2))?;
    drop(first);
    let mut second = registry.begin_operation(&owner(), id, t(3))?;
    assert_eq!(staged_count(&second, ALL)?, 1);
    second.insert(quad("c", "p", "d"))?;
    assert_eq!(staged_count(&second, ALL)?, 2);
    second.remove(&quad("a", "p", "b"))?;
    assert_eq!(staged_count(&second, ALL)?, 1);
    assert!(store.is_empty()?);
    second.finish(t(4))?;
    drop(second);
    commit(&registry, id, 5)?;
    assert_eq!(stored_count(store, ALL)?, 1);
    assert!(writer_free(store));
    Ok(())
}

fn committed_store_is_isolated_until_commit(store: &Store) -> TestResult {
    let registry = registry();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner(), id, t(1))?;
    stage_fixture(&mut operation)?;
    assert_eq!(staged_count(&operation, ALL)?, 3);
    assert!(store.is_empty()?);
    assert_eq!(stored_count(store, ALL)?, 0);
    operation.finish(t(2))?;
    drop(operation);
    assert_eq!(stored_count(store, ALL)?, 0);
    commit(&registry, id, 3)?;
    assert_eq!(stored_count(store, ALL)?, 3);
    let graph_query = "SELECT ?s WHERE { GRAPH ?g { ?s ?p ?o } }";
    assert_eq!(stored_count(store, graph_query)?, 3);
    assert!(store.contains_named_graph(&NamedOrBlankNode::from(n("empty")))?);
    assert!(writer_free(store));
    Ok(())
}

fn graph_scope_and_blank_terms(store: &Store) -> TestResult {
    let registry = registry();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner(), id, t(1))?;
    stage_fixture(&mut operation)?;
    assert_eq!(staged_count(&operation, ALL)?, 3);
    let graph_query = "SELECT ?s WHERE { GRAPH ?g { ?s ?p ?o } }";
    assert_eq!(staged_count(&operation, graph_query)?, 3);
    let distinct = "SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }";
    let graph_results = operation.query(evaluator().parse_query(distinct)?)?;
    let graphs = table(graph_results)?.1;
    let expected = vec![
        vec![Some("<urn:lq:g1>".to_owned())],
        vec![Some("_:gb".to_owned())],
    ];
    assert_eq!(graphs, expected);
    let blank_query = "SELECT ?b WHERE { { ?b <urn:lq:label> ?l } UNION \
                       { GRAPH ?g { ?b <urn:lq:label> ?l } } }";
    let blank_results = operation.query(evaluator().parse_query(blank_query)?)?;
    let blanks = table(blank_results)?.1;
    assert_eq!(blanks, vec![vec![Some("_:x".to_owned())]; 2]);
    Ok(())
}

fn drop_paths_roll_back_and_release_the_writer(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let dropped = Some(Outcome::RolledBack(RollbackReason::Dropped));
    for (byte, partial) in [(1_u8, false), (2, true)] {
        let id = open(&registry, store, byte)?;
        let mut operation = registry.begin_operation(&owner, id, t(1))?;
        operation.insert(quad("a", "p", "b"))?;
        operation.insert(quad("c", "p", "d"))?;
        {
            let results = operation.query(evaluator().parse_query(ALL)?)?;
            if partial {
                let QueryResults::Solutions(mut solutions) = results else {
                    return Err("expected solutions".into());
                };
                solutions.next().ok_or("no row")??;
            }
        }
        drop(operation);
        assert_eq!(registry.outcome(&owner, id, t(2))?, dropped);
        assert!(store.is_empty()?);
        assert!(writer_free(store));
    }
    let snapshot = registry.snapshot();
    assert_eq!((snapshot.reserved, snapshot.pending_begins), (0, 0));
    Ok(())
}

fn open_results_are_lazy_and_bounded_by_the_operation(store: &Store) -> TestResult {
    let registry = registry();
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner(), id, t(1))?;
    for label in ["a", "b", "c"] {
        operation.insert(quad(label, "p", "o"))?;
    }
    {
        let first_results = operation.query(evaluator().parse_query(ALL)?)?;
        let second_results = operation.query(evaluator().parse_query(ALL)?)?;
        let QueryResults::Solutions(mut first) = first_results else {
            return Err("expected solutions".into());
        };
        let QueryResults::Solutions(mut second) = second_results else {
            return Err("expected solutions".into());
        };
        for _ in 0..3 {
            first.next().ok_or("first ended early")??;
            second.next().ok_or("second ended early")??;
        }
        assert!(first.next().is_none());
        assert!(second.next().is_none());
    }
    operation.finish(t(2))?;
    drop(operation);
    commit(&registry, id, 3)?;
    assert_eq!(stored_count(store, ALL)?, 3);
    Ok(())
}

fn substituted() -> Result<PreparedSparqlQuery, TestError> {
    Ok(evaluator()
        .parse_query(ALL)?
        .substitute_variable(Variable::new("zz")?, Literal::from(1)))
}

fn over_limit() -> Result<PreparedSparqlQuery, TestError> {
    Ok(evaluator()
        .with_sort_buffer_budget(SortBufferBudget::new(0))
        .parse_query("SELECT ?s WHERE { ?s ?p ?o } ORDER BY ?s")?)
}

fn cancelled() -> Result<PreparedSparqlQuery, TestError> {
    let token = CancellationToken::new();
    token.cancel();
    Ok(evaluator()
        .with_cancellation_token(token)
        .parse_query(ALL)?)
}

fn is_substitution(error: &QueryEvaluationError) -> bool {
    matches!(
        error,
        QueryEvaluationError::NotExistingSubstitutedVariable(_)
    )
}

fn is_sort_limit(error: &QueryEvaluationError) -> bool {
    matches!(
        error,
        QueryEvaluationError::ResourceLimitExceeded {
            resource: QueryResource::SortBufferRows,
            ..
        }
    )
}

fn is_cancelled(error: &QueryEvaluationError) -> bool {
    matches!(error, QueryEvaluationError::Cancelled)
}

fn query_errors_are_typed_and_leave_the_operation_usable(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let reference = reference()?;
    let id = open(&registry, store, 1)?;
    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    stage_fixture(&mut operation)?;
    let cases: [(Build, Check); 3] = [
        (substituted, is_substitution),
        (over_limit, is_sort_limit),
        (cancelled, is_cancelled),
    ];
    for (build, check) in cases {
        let baseline = build()?.on_store(&reference).execute();
        let expected = first_error(baseline).ok_or("reference did not fail")?;
        let staged = staged_result(&operation, build()?)?;
        let found = first_error(staged).ok_or("staged query did not fail")?;
        assert!(check(&found), "{found}");
        assert_eq!(found.to_string(), expected.to_string());
        assert_eq!(
            registry.status(&owner, id, t(2))?.phase,
            LeasePhase::Operating
        );
        assert_eq!(registry.outcome(&owner, id, t(2))?, None);
        assert_eq!(staged_count(&operation, ALL)?, 3);
    }
    operation.finish(t(3))?;
    drop(operation);
    commit(&registry, id, 4)?;
    assert_eq!(stored_count(store, ALL)?, 3);
    assert!(writer_free(store));
    Ok(())
}

fn finished_wrong_binding_and_busy_are_refused(store: &Store) -> TestResult {
    let registry = registry();
    let owner = owner();
    let id = open(&registry, store, 1)?;
    let stranger = LeaseBinding::new("mallory", "acme", "repo-1")?;
    let refused = refusal(registry.begin_operation(&stranger, id, t(1)));
    assert_eq!(refused, Some(Refusal::Unknown));

    let mut operation = registry.begin_operation(&owner, id, t(1))?;
    operation.insert(quad("a", "p", "b"))?;
    {
        let results = operation.query(evaluator().parse_query(ALL)?)?;
        let busy = refusal(registry.begin_operation(&owner, id, t(2)));
        assert_eq!(busy, Some(Refusal::Lease(LeaseError::Busy)));
        assert_eq!(table(results)?.1.len(), 1);
    }
    operation.finish(t(3))?;
    let refused = refusal(operation.query(evaluator().parse_query(ALL)?));
    assert_eq!(refused, Some(Refusal::Finished));
    drop(operation);
    let rolled_back = registry.rollback(&owner, id, t(4))?;
    assert_eq!(
        rolled_back.outcome,
        Outcome::RolledBack(RollbackReason::Explicit)
    );
    assert!(writer_free(store));
    assert!(store.is_empty()?);
    Ok(())
}

macro_rules! backends {
    ($($name:ident),* $(,)?) => {
        mod memory {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    super::$name(&Store::new()?)
                }
            )*
        }

        mod disk {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    let directory = tempfile::tempdir()?;
                    let store = Store::open(directory.path())?;
                    super::$name(&store)
                }
            )*
        }
    };
}

backends!(
    staged_forms_match_the_reference,
    read_your_writes_across_operations,
    committed_store_is_isolated_until_commit,
    graph_scope_and_blank_terms,
    drop_paths_roll_back_and_release_the_writer,
    open_results_are_lazy_and_bounded_by_the_operation,
    query_errors_are_typed_and_leave_the_operation_usable,
    finished_wrong_binding_and_busy_are_refused,
);
