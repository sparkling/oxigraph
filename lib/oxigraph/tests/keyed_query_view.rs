#![cfg(not(target_family = "wasm"))]
#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the staged-view query contract"
)]

use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Variable};
use oxigraph::sparql::{
    CancellationToken, PreparedSparqlQuery, QueryEvaluationError, QueryResource, QueryResults,
    SortBufferBudget, SparqlEvaluator,
};
use oxigraph::store::{KeyedTransaction, Store, TransactionKey, TransactionRequest};
use std::error::Error;

type TestError = Box<dyn Error + Send + Sync>;
type TestResult = Result<(), TestError>;
type Table = (Vec<String>, Vec<Vec<Option<String>>>);
type Build = fn() -> Result<PreparedSparqlQuery, TestError>;
type Check = fn(&QueryEvaluationError) -> bool;

const ALL: &str = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
const IN_GRAPHS: &str = "SELECT ?s WHERE { GRAPH ?g { ?s ?p ?o } }";
const QUERIES: [&str; 10] = [
    ALL,
    "SELECT ?g ?s ?o WHERE { GRAPH ?g { ?s <urn:kqv:p> ?o } }",
    "SELECT ?g WHERE { GRAPH ?g { } }",
    "SELECT ?s ?o FROM NAMED <urn:kqv:g1> WHERE { GRAPH <urn:kqv:g1> { ?s <urn:kqv:p> ?o } }",
    "SELECT ?b ?l WHERE { { ?b <urn:kqv:label> ?l } UNION { GRAPH ?g { ?b <urn:kqv:label> ?l } } }",
    "SELECT (COUNT(*) AS ?n) WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }",
    "ASK { <urn:kqv:a> <urn:kqv:p> ?o }",
    "ASK { <urn:kqv:none> ?p ?o }",
    "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
    "CONSTRUCT { ?s <urn:kqv:seen> ?g } WHERE { GRAPH ?g { ?s ?p ?o } }",
];

fn n(label: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:kqv:{label}"))
}

fn quad(label: &str) -> Quad {
    Quad::new(n(label), n("p"), n("o"), GraphName::DefaultGraph)
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

fn open(store: &Store, byte: u8) -> Result<KeyedTransaction<'static>, TestError> {
    Ok(store
        .start_owned_transaction_with_key(
            TransactionRequest::default(),
            TransactionKey::new([byte; 16]),
        )?
        .into_transaction())
}

fn stage(keyed: &mut KeyedTransaction<'static>) {
    let (quads, graphs) = fixture();
    for graph in graphs {
        keyed.insert_named_graph(graph);
    }
    keyed.extend(quads);
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

fn on_reference(store: &Store, prepared: PreparedSparqlQuery) -> Result<String, TestError> {
    render(prepared.on_store(store).execute()?)
}

fn on_staged(
    keyed: &KeyedTransaction<'static>,
    prepared: PreparedSparqlQuery,
) -> Result<String, TestError> {
    render(prepared.on_writable_dataset(keyed).execute()?)
}

fn run(keyed: &KeyedTransaction<'static>, query: &str) -> Result<Table, TestError> {
    table(
        evaluator()
            .parse_query(query)?
            .on_writable_dataset(keyed)
            .execute()?,
    )
}

fn rows(keyed: &KeyedTransaction<'static>, query: &str) -> Result<usize, TestError> {
    Ok(run(keyed, query)?.1.len())
}

fn committed_rows(store: &Store, query: &str) -> Result<usize, TestError> {
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

fn staged_forms_match_the_reference(store: Store) -> TestResult {
    let reference = reference()?;
    let empty = Store::new()?;
    let mut keyed = open(&store, 1)?;
    stage(&mut keyed);
    for query in QUERIES {
        let prepared = evaluator().parse_query(query)?;
        let expected = on_reference(&reference, prepared.clone())?;
        assert_eq!(on_staged(&keyed, prepared)?, expected, "{query}");
    }
    let prepared = evaluator().parse_query(ALL)?;
    let blank = on_reference(&empty, prepared.clone())?;
    assert_ne!(on_staged(&keyed, prepared)?, blank);
    assert!(store.is_empty()?);
    Ok(())
}

fn graph_scope_and_blank_terms(store: Store) -> TestResult {
    let mut keyed = open(&store, 1)?;
    stage(&mut keyed);
    assert_eq!(rows(&keyed, ALL)?, 3);
    assert_eq!(rows(&keyed, IN_GRAPHS)?, 3);
    let distinct = "SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }";
    let graphs = run(&keyed, distinct)?.1;
    let expected = vec![
        vec![Some("<urn:kqv:g1>".to_owned())],
        vec![Some("_:gb".to_owned())],
    ];
    assert_eq!(graphs, expected);
    let blank_query = "SELECT ?b WHERE { { ?b <urn:kqv:label> ?l } UNION \
                       { GRAPH ?g { ?b <urn:kqv:label> ?l } } }";
    let blanks = run(&keyed, blank_query)?.1;
    assert_eq!(blanks, vec![vec![Some("_:x".to_owned())]; 2]);
    Ok(())
}

fn read_your_writes_through_the_view(store: Store) -> TestResult {
    let mut keyed = open(&store, 1)?;
    assert_eq!(rows(&keyed, ALL)?, 0);
    keyed.insert(quad("a"));
    assert_eq!(rows(&keyed, ALL)?, 1);
    keyed.insert(quad("b"));
    assert_eq!(rows(&keyed, ALL)?, 2);
    keyed.remove(&quad("a"));
    assert_eq!(rows(&keyed, ALL)?, 1);
    keyed.insert(Quad::new(n("c"), n("p"), n("o"), n("g")));
    assert_eq!(rows(&keyed, IN_GRAPHS)?, 1);
    keyed.clear_graph(&GraphName::DefaultGraph)?;
    assert_eq!(rows(&keyed, ALL)?, 0);
    assert!(store.is_empty()?);
    Ok(())
}

fn committed_store_is_isolated_until_commit(store: Store) -> TestResult {
    let mut keyed = open(&store, 1)?;
    keyed.insert(quad("a"));
    assert_eq!(rows(&keyed, ALL)?, 1);
    assert!(store.is_empty()?);
    assert_eq!(committed_rows(&store, ALL)?, 0);
    keyed.commit()?;
    assert_eq!(committed_rows(&store, ALL)?, 1);
    Ok(())
}

fn commit_publishes_and_drop_discards(store: Store) -> TestResult {
    let mut keyed = open(&store, 1)?;
    keyed.insert(quad("a"));
    assert_eq!(rows(&keyed, ALL)?, 1);
    keyed.commit()?;
    assert_eq!(committed_rows(&store, ALL)?, 1);

    let mut second = open(&store, 2)?;
    second.insert(quad("b"));
    assert_eq!(rows(&second, ALL)?, 2);
    drop(second);
    assert_eq!(committed_rows(&store, ALL)?, 1);
    open(&store, 3)?.rollback()?;
    Ok(())
}

fn owned_transaction_uses_the_same_seam(store: Store) -> TestResult {
    let reference = Store::new()?;
    reference.insert(quad("a"))?;
    let mut owned = store.start_owned_transaction()?;
    owned.as_transaction_mut().insert(quad("a"));
    let prepared = evaluator().parse_query(ALL)?;
    let expected = on_reference(&reference, prepared.clone())?;
    let staged = render(prepared.on_writable_dataset(&owned).execute()?)?;
    assert_eq!(staged, expected);
    assert!(store.is_empty()?);
    owned.rollback()?;
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

fn remote() -> Result<PreparedSparqlQuery, TestError> {
    let query = "SELECT * WHERE { SERVICE <http://example.invalid/sparql> { ?s ?p ?o } }";
    Ok(evaluator().parse_query(query)?)
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

fn is_any(_: &QueryEvaluationError) -> bool {
    true
}

fn errors_match_the_reference_and_leave_staged_state_intact(store: Store) -> TestResult {
    let reference = reference()?;
    let mut keyed = open(&store, 1)?;
    stage(&mut keyed);
    let cases: [(Build, Check); 4] = [
        (substituted, is_substitution),
        (over_limit, is_sort_limit),
        (cancelled, is_cancelled),
        (remote, is_any),
    ];
    for (build, check) in cases {
        let baseline = build()?.on_store(&reference).execute();
        let expected = first_error(baseline).ok_or("reference did not fail")?;
        let staged = build()?.on_writable_dataset(&keyed).execute();
        let found = first_error(staged).ok_or("staged query did not fail")?;
        assert!(check(&found), "{found}");
        assert_eq!(found.to_string(), expected.to_string());
        assert_eq!(
            std::mem::discriminant(&found),
            std::mem::discriminant(&expected)
        );
        assert_eq!(rows(&keyed, ALL)?, 3);
    }
    keyed.commit()?;
    assert_eq!(committed_rows(&store, ALL)?, 3);
    Ok(())
}

macro_rules! backends {
    ($($name:ident),* $(,)?) => {
        mod memory {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    super::$name(Store::new()?)
                }
            )*
        }

        #[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
        mod disk {
            use super::{Store, TestResult};
            $(
                #[test]
                fn $name() -> TestResult {
                    let directory = tempfile::tempdir()?;
                    super::$name(Store::open(directory.path())?)
                }
            )*
        }
    };
}

backends!(
    staged_forms_match_the_reference,
    graph_scope_and_blank_terms,
    read_your_writes_through_the_view,
    committed_store_is_isolated_until_commit,
    commit_publishes_and_drop_discards,
    owned_transaction_uses_the_same_seam,
    errors_match_the_reference_and_leave_staged_state_intact,
);

#[test]
fn query_results_are_tied_to_the_transaction_borrow() -> TestResult {
    let store = Store::new()?;
    let keyed = open(&store, 9)?;
    let results = evaluator()
        .parse_query(ALL)?
        .on_writable_dataset(&keyed)
        .execute()?;
    assert_eq!(table(results)?.1.len(), 0);
    keyed.rollback()?;
    Ok(())
}
