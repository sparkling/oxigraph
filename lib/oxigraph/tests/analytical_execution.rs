#![expect(
    clippy::tests_outside_test_module,
    clippy::panic,
    reason = "integration tests compare analytical dispositions with the standard evaluators"
)]

use oxigraph::model::{NamedNode, Term, Variable};
#[cfg(feature = "http-client")]
use oxigraph::sparql::HttpServiceObservation;
#[cfg(feature = "rdf-12")]
use oxigraph::sparql::SparqlVersion;
use oxigraph::sparql::{
    AnalyticalBudget, AnalyticalDisposition, AnalyticalExecutionError, AnalyticalExecutionLimits,
    AnalyticalExecutionMode, AnalyticalExecutionOptions, AnalyticalExecutionSnapshot,
    AnalyticalFallback, AnalyticalLimitsError, AnalyticalReason, AnalyticalVariableOrder,
    AnalyticalVariableOrderKind, BoundAnalyticalSparqlQuery, CancellationToken,
    InnerJoinBuildBudget, PreparedSparqlQuery, QueryEvaluationError, QueryResults, QuerySolution,
    QuerySolutionIter, SparqlEvaluator,
};
use oxigraph::store::{EvaluationOperation, EvaluationOutcome, Store};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

const PREFIXES: &str = "PREFIX ex: <urn:ax:>\nPREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n";
const TRIANGLE: &str = "SELECT * WHERE { ?a ?p ?b . ?b ?q ?c . ?c ?r ?a }";
const CYCLE: &str = "SELECT * WHERE { ?a ?p ?b . ?b ?q ?c . ?c ?r ?d . ?d ?s ?a }";
const CHAIN: &str = "SELECT * WHERE { ?a ?p ?b . ?b ?q ?c . ?c ?r ?d }";
const STAR: &str = "SELECT * WHERE { ?x ?p1 ?l1 . ?x ?p2 ?l2 . ?x ?p3 ?l3 }";
const SINGLE: &str = "SELECT * WHERE { ?s ?p ?o }";

// Thirteen default-graph edges: one triangle (with a doubled edge), a 4-ring,
// a 3-way hub and dead ends.
const GRAPH_DATA: &str = "ex:n1 ex:p1 ex:n2 . ex:n1 ex:p4 ex:n2 . ex:n2 ex:p2 ex:n3 . \
    ex:n3 ex:p3 ex:n1 . ex:n1 ex:p1 ex:n4 . ex:n4 ex:p2 ex:n5 . \
    ex:c1 ex:r ex:c2 . ex:c2 ex:r ex:c3 . ex:c3 ex:r ex:c4 . ex:c4 ex:r ex:c1 . \
    ex:h ex:s1 ex:l1 . ex:h ex:s2 ex:l2 . ex:h ex:s3 ex:l3 .";

// One constant predicate: a directed triangle, a 2-cycle, a self loop, a
// 4-ring and a hub.
const CONST_DATA: &str = "ex:n1 ex:p ex:n2 . ex:n2 ex:p ex:n3 . ex:n3 ex:p ex:n1 . \
    ex:n1 ex:p ex:n4 . ex:n4 ex:p ex:n1 . ex:n2 ex:p ex:n2 . \
    ex:c1 ex:p ex:c2 . ex:c2 ex:p ex:c3 . ex:c3 ex:p ex:c4 . ex:c4 ex:p ex:c1 . \
    ex:h ex:p ex:l1 . ex:h ex:p ex:l2 . ex:h ex:p ex:l3 .";

type Rows = Vec<Vec<Option<String>>>;
type Edge = (&'static str, &'static str, &'static str);

const SHAPES: [(&str, &[Edge]); 4] = [
    (
        "triangle",
        &[("a", "p", "b"), ("b", "q", "c"), ("c", "r", "a")],
    ),
    (
        "cycle",
        &[
            ("a", "p", "b"),
            ("b", "q", "c"),
            ("c", "r", "d"),
            ("d", "s", "a"),
        ],
    ),
    (
        "chain",
        &[("a", "p", "b"), ("b", "q", "c"), ("c", "r", "d")],
    ),
    (
        "star",
        &[("x", "p1", "l1"), ("x", "p2", "l2"), ("x", "p3", "l3")],
    ),
];

#[derive(Clone, Copy)]
struct Ceilings {
    patterns: usize,
    variables: usize,
    rows: usize,
    bytes: usize,
    work: u64,
    output: u64,
    wall: Duration,
}

const ROOMY: Ceilings = Ceilings {
    patterns: 16,
    variables: 8,
    rows: 4096,
    bytes: 64 * 1024 * 1024,
    work: 50_000_000,
    output: 1_000_000,
    wall: Duration::from_secs(3600),
};

impl Ceilings {
    fn limits(self) -> AnalyticalExecutionLimits {
        AnalyticalExecutionLimits::new(
            self.patterns,
            self.variables,
            self.rows,
            self.bytes,
            self.work,
            self.output,
            self.wall,
        )
        .unwrap()
    }

    fn options(self) -> AnalyticalExecutionOptions {
        AnalyticalExecutionOptions::explicit(self.limits())
    }
}

/// Exhaustive index-aware search: finds a compatible order whenever one exists.
fn exhaustive_search() -> AnalyticalExecutionOptions {
    ROOMY
        .options()
        .with_variable_order(AnalyticalVariableOrder::index_aware(200_000).unwrap())
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Solutions { variables: Vec<String>, rows: Rows },
    Boolean(bool),
    Graph(Vec<String>),
}

impl Outcome {
    fn rows(&self) -> &Rows {
        match self {
            Self::Solutions { rows, .. } => rows,
            _ => panic!("solutions expected"),
        }
    }
}

/// A stop that must fail the execution, never start the standard executor.
#[derive(Clone, Copy, Debug)]
enum Stopped {
    Budget(AnalyticalBudget),
    TimedOut,
}

impl Stopped {
    fn reason(self) -> AnalyticalReason {
        match self {
            Self::Budget(budget) => AnalyticalReason::Budget(budget),
            Self::TimedOut => AnalyticalReason::Budget(AnalyticalBudget::WallTime),
        }
    }

    fn metric(self) -> &'static str {
        match self {
            Self::Budget(_) => "failed",
            Self::TimedOut => "timed_out",
        }
    }

    fn check(self, label: &str, error: QueryEvaluationError) {
        match self {
            Self::Budget(budget) => assert_eq!(
                typed(error),
                AnalyticalExecutionError::BudgetExceeded(budget),
                "{label}"
            ),
            Self::TimedOut => assert!(
                matches!(error, QueryEvaluationError::TimedOut),
                "{label}: {error:?}"
            ),
        }
    }
}

struct Streamed {
    variables: Vec<String>,
    rows: Rows,
    error: Option<QueryEvaluationError>,
}

struct Verified {
    started: AnalyticalExecutionSnapshot,
    finished: AnalyticalExecutionSnapshot,
    rows: Rows,
}

fn count(value: usize) -> u64 {
    u64::try_from(value).unwrap()
}

fn evaluator() -> SparqlEvaluator {
    #[cfg(feature = "rdf-12")]
    {
        SparqlEvaluator::new().with_version(SparqlVersion::V1_2)
    }
    #[cfg(not(feature = "rdf-12"))]
    {
        SparqlEvaluator::new()
    }
}

fn on_backends(scenario: impl Fn(&str, &Store)) {
    scenario("memory", &Store::new().unwrap());
    #[cfg(feature = "rocksdb")]
    {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path().join("store")).unwrap();
        scenario("rocksdb", &store);
    }
}

fn load(store: &Store, triples: &str) {
    evaluator()
        .parse_update(&format!("{PREFIXES}INSERT DATA {{ {triples} }}"))
        .unwrap()
        .on_store(store)
        .execute()
        .unwrap();
}

fn load_graph(store: &Store) {
    load(store, GRAPH_DATA);
}

fn parse(evaluator: SparqlEvaluator, body: &str) -> PreparedSparqlQuery {
    evaluator.parse_query(&format!("{PREFIXES}{body}")).unwrap()
}

fn bind_with(
    evaluator: SparqlEvaluator,
    store: &Store,
    body: &str,
    options: AnalyticalExecutionOptions,
) -> BoundAnalyticalSparqlQuery {
    parse(evaluator, body).on_store_with_analytical(store, options)
}

fn bind(
    store: &Store,
    body: &str,
    options: AnalyticalExecutionOptions,
) -> BoundAnalyticalSparqlQuery {
    bind_with(evaluator(), store, body, options)
}

fn row_of(solution: &QuerySolution, width: usize) -> Vec<Option<String>> {
    (0..width)
        .map(|index| solution.get(index).map(ToString::to_string))
        .collect()
}

fn collect_solutions(iter: &mut QuerySolutionIter<'_>) -> Streamed {
    let variables = iter
        .variables()
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    let mut error = None;
    for item in &mut *iter {
        match item {
            Ok(solution) => rows.push(row_of(&solution, variables.len())),
            Err(failure) => {
                error = Some(failure);
                break;
            }
        }
    }
    Streamed {
        variables,
        rows,
        error,
    }
}

// Analytical streams only: after the end or an error they stay fused.
fn stream(results: QueryResults<'_>) -> Streamed {
    let QueryResults::Solutions(mut iter) = results else {
        panic!("solutions expected");
    };
    let streamed = collect_solutions(&mut iter);
    assert!(iter.next().is_none(), "stream is not fused");
    assert!(iter.next().is_none(), "stream is not fused twice");
    streamed
}

fn outcome(results: QueryResults<'_>) -> Result<Outcome, QueryEvaluationError> {
    match results {
        QueryResults::Solutions(mut iter) => {
            let collected = collect_solutions(&mut iter);
            if let Some(error) = collected.error {
                return Err(error);
            }
            let mut rows = collected.rows;
            rows.sort();
            Ok(Outcome::Solutions {
                variables: collected.variables,
                rows,
            })
        }
        QueryResults::Boolean(value) => Ok(Outcome::Boolean(value)),
        QueryResults::Graph(triples) => {
            let mut lines = Vec::new();
            for triple in triples {
                lines.push(triple?.to_string());
            }
            lines.sort();
            Ok(Outcome::Graph(lines))
        }
    }
}

/// Consumes a result like a client would, stopping at the first error.
fn drain(result: Result<QueryResults<'_>, QueryEvaluationError>) {
    if let Ok(QueryResults::Solutions(iter)) = result {
        for item in iter {
            if item.is_err() {
                break;
            }
        }
    }
}

fn failure(result: Result<QueryResults<'_>, QueryEvaluationError>) -> QueryEvaluationError {
    match result {
        Err(error) => error,
        Ok(_) => panic!("an error was expected before any row"),
    }
}

fn typed(error: QueryEvaluationError) -> AnalyticalExecutionError {
    match error {
        QueryEvaluationError::Dataset(inner) => {
            match inner.downcast_ref::<AnalyticalExecutionError>() {
                Some(typed) => *typed,
                None => panic!("dataset error is not a typed analytical error: {inner}"),
            }
        }
        other => panic!("unexpected error {other:?}"),
    }
}

fn expected_error(reason: AnalyticalReason) -> AnalyticalExecutionError {
    match reason {
        AnalyticalReason::Budget(budget) => AnalyticalExecutionError::BudgetExceeded(budget),
        other => AnalyticalExecutionError::Refused(other),
    }
}

fn query_counts(store: &Store) -> [u64; 7] {
    let metrics = store.evaluation_metrics();
    EvaluationOutcome::ALL.map(|outcome| metrics.count(EvaluationOperation::Query, outcome))
}

/// Query outcomes observed since `before`, by outcome name.
fn delta(store: &Store, before: &[u64; 7]) -> BTreeMap<&'static str, u64> {
    let after = query_counts(store);
    EvaluationOutcome::ALL
        .iter()
        .zip(after.iter().zip(before))
        .filter(|(_, (after, before))| after != before)
        .map(|(outcome, (after, before))| (outcome.as_str(), after - before))
        .collect()
}

fn outcomes(pairs: &[(&'static str, u64)]) -> BTreeMap<&'static str, u64> {
    pairs.iter().copied().collect()
}

fn oracle(store: &Store, body: &str) -> Outcome {
    outcome(parse(evaluator(), body).on_store(store).execute().unwrap()).unwrap()
}

fn oracle_unoptimized(store: &Store, body: &str) -> Outcome {
    outcome(
        parse(evaluator().without_optimizations(), body)
            .on_store(store)
            .execute()
            .unwrap(),
    )
    .unwrap()
}

fn oracles(label: &str, store: &Store, body: &str) -> Outcome {
    let standard = oracle(store, body);
    assert_eq!(
        standard,
        oracle_unoptimized(store, body),
        "{label}: standard and optimization-disabled evaluators disagree"
    );
    standard
}

fn verify_analytical_options(
    label: &str,
    store: &Store,
    body: &str,
    options: AnalyticalExecutionOptions,
) -> Verified {
    let expected = oracles(label, store, body);
    let bound = bind(store, body, options);
    let report = bound.report();
    assert_eq!(
        report.snapshot(),
        AnalyticalExecutionSnapshot::default(),
        "{label}: report is not empty before execution"
    );
    let results = bound.execute().unwrap();
    let started = report.snapshot();
    assert_eq!(
        started.disposition,
        AnalyticalDisposition::Analytical,
        "{label}: {started:?}"
    );
    assert_eq!(started.reason, None, "{label}: {started:?}");
    assert!(
        !started.completed && started.output_rows == 0,
        "{label}: {started:?}"
    );
    assert!(
        started.patterns >= 2 && started.relations == started.patterns,
        "{label}: {started:?}"
    );
    assert!(
        started.variables >= 1 && started.work > 0 && started.materialized_bytes > 0,
        "{label}: {started:?}"
    );
    assert_eq!(
        started.variable_order_len, started.variables,
        "{label}: {started:?}"
    );
    let actual = outcome(results).unwrap();
    assert_eq!(
        actual, expected,
        "{label}: analytical answer differs from the standard evaluator"
    );
    let finished = report.snapshot();
    assert_eq!(
        finished.disposition,
        AnalyticalDisposition::Analytical,
        "{label}: {finished:?}"
    );
    assert_eq!(finished.reason, None, "{label}: {finished:?}");
    assert!(finished.completed, "{label}: {finished:?}");
    let rows = actual.rows().clone();
    assert_eq!(finished.output_rows, count(rows.len()), "{label}");
    assert!(finished.work >= started.work, "{label}");
    assert_eq!(
        finished.materialized_bytes, started.materialized_bytes,
        "{label}: row charges were not released"
    );
    Verified {
        started,
        finished,
        rows,
    }
}

fn verify_analytical_with(label: &str, store: &Store, body: &str, ceilings: Ceilings) -> Verified {
    verify_analytical_options(label, store, body, ceilings.options())
}

fn verify_analytical(label: &str, store: &Store, body: &str) -> Verified {
    verify_analytical_with(label, store, body, ROOMY)
}

/// A capability decline: the declared fallback answers, refusal is typed.
fn check_declined(
    label: &str,
    store: &Store,
    prepare: &dyn Fn() -> PreparedSparqlQuery,
    options: AnalyticalExecutionOptions,
    expected: &Outcome,
    reason: AnalyticalReason,
) -> [AnalyticalExecutionSnapshot; 2] {
    let before = query_counts(store);
    let bound = prepare()
        .on_store_with_analytical(store, options.with_fallback(AnalyticalFallback::Standard));
    let report = bound.report();
    let actual = outcome(bound.execute().unwrap()).unwrap();
    assert_eq!(
        &actual, expected,
        "{label}: fallback answer differs from the standard evaluator"
    );
    assert_eq!(
        delta(store, &before),
        outcomes(&[("succeeded", 1)]),
        "{label}: fallback is observed exactly once"
    );
    let fallback = report.snapshot();
    assert_eq!(
        fallback.disposition,
        AnalyticalDisposition::Fallback,
        "{label}: {fallback:?}"
    );
    assert_eq!(fallback.reason, Some(reason), "{label}: {fallback:?}");
    assert!(
        fallback.output_rows == 0 && !fallback.completed && fallback.relations == 0,
        "{label}: {fallback:?}"
    );

    let bound = prepare()
        .on_store_with_analytical(store, options.with_fallback(AnalyticalFallback::Refuse));
    let report = bound.report();
    let error = failure(bound.execute());
    assert_eq!(typed(error), expected_error(reason), "{label}");
    let refused = report.snapshot();
    assert_eq!(
        refused.disposition,
        AnalyticalDisposition::Refused,
        "{label}: {refused:?}"
    );
    assert_eq!(refused.reason, Some(reason), "{label}: {refused:?}");
    assert!(
        refused.output_rows == 0 && !refused.completed && refused.relations == 0,
        "{label}: {refused:?}"
    );
    [fallback, refused]
}

/// Budget, deadline and cancellation stops before the stream are typed
/// failures under both policies; the standard executor never runs.
fn check_failed_before_stream(
    label: &str,
    store: &Store,
    prepare: &dyn Fn() -> PreparedSparqlQuery,
    options: AnalyticalExecutionOptions,
    stopped: Stopped,
) {
    for fallback in [AnalyticalFallback::Standard, AnalyticalFallback::Refuse] {
        let label = format!("{label}/{fallback:?}");
        let before = query_counts(store);
        let bound = prepare().on_store_with_analytical(store, options.with_fallback(fallback));
        let report = bound.report();
        stopped.check(&label, failure(bound.execute()));
        let snapshot = report.snapshot();
        assert_eq!(
            snapshot.disposition,
            AnalyticalDisposition::Failed,
            "{label}: {snapshot:?}"
        );
        assert_eq!(
            snapshot.reason,
            Some(stopped.reason()),
            "{label}: {snapshot:?}"
        );
        assert!(
            snapshot.relations == 0 && snapshot.output_rows == 0 && !snapshot.completed,
            "{label}: {snapshot:?}"
        );
        assert_eq!(
            delta(store, &before),
            outcomes(&[(stopped.metric(), 1)]),
            "{label}: a stop started the standard executor or was not observed once"
        );
    }
}

fn run_stream(
    store: &Store,
    body: &str,
    options: AnalyticalExecutionOptions,
) -> (Streamed, AnalyticalExecutionSnapshot) {
    let bound = bind(store, body, options);
    let report = bound.report();
    let streamed = stream(bound.execute().unwrap());
    (streamed, report.snapshot())
}

fn assert_sub_multiset(label: &str, part: &Rows, full: &Rows) {
    let mut available = BTreeMap::<Vec<Option<String>>, usize>::new();
    for row in full {
        *available.entry(row.clone()).or_default() += 1;
    }
    for row in part {
        let slot = available
            .get_mut(row)
            .unwrap_or_else(|| panic!("{label}: emitted row {row:?} is not an answer"));
        assert!(
            *slot > 0,
            "{label}: row {row:?} emitted more often than its multiplicity"
        );
        *slot -= 1;
    }
}

fn assert_failed_stream(
    label: &str,
    streamed: Streamed,
    snapshot: &AnalyticalExecutionSnapshot,
    full: &Rows,
    error: AnalyticalExecutionError,
    reason: AnalyticalReason,
) {
    let raised = streamed
        .error
        .unwrap_or_else(|| panic!("{label}: stream ended without the typed failure"));
    assert_eq!(typed(raised), error, "{label}");
    assert_eq!(
        snapshot.disposition,
        AnalyticalDisposition::Failed,
        "{label}: {snapshot:?}"
    );
    assert_eq!(snapshot.reason, Some(reason), "{label}: {snapshot:?}");
    assert!(!snapshot.completed, "{label}: {snapshot:?}");
    assert_eq!(snapshot.output_rows, count(streamed.rows.len()), "{label}");
    assert!(
        streamed.rows.len() < full.len(),
        "{label}: failure did not stop the stream"
    );
    assert_sub_multiset(label, &streamed.rows, full);
}

/// Least value in `(failing, passing]` accepted by a monotone predicate.
fn least_passing(mut failing: usize, mut passing: usize, passes: impl Fn(usize) -> bool) -> usize {
    assert!(
        !passes(failing),
        "lower bound {failing} unexpectedly passes"
    );
    assert!(passes(passing), "upper bound {passing} unexpectedly fails");
    while passing - failing > 1 {
        let middle = failing + (passing - failing) / 2;
        if passes(middle) {
            passing = middle;
        } else {
            failing = middle;
        }
    }
    passing
}

fn assert_bytes_exceeded(label: &str, error: QueryEvaluationError) {
    assert_eq!(
        typed(error),
        AnalyticalExecutionError::BudgetExceeded(AnalyticalBudget::MaterializedBytes),
        "{label}"
    );
}

/// Whether the stream is returned under a byte ceiling.
fn starts(label: &str, store: &Store, body: &str, bytes: usize) -> bool {
    match bind(store, body, Ceilings { bytes, ..ROOMY }.options()).execute() {
        Ok(_) => true,
        Err(error) => {
            assert_bytes_exceeded(label, error);
            false
        }
    }
}

fn permutations(n: usize) -> Vec<Vec<usize>> {
    if n == 0 {
        return vec![Vec::new()];
    }
    let mut all = Vec::new();
    for rest in permutations(n - 1) {
        for slot in 0..=rest.len() {
            let mut order = rest.clone();
            order.insert(slot, n - 1);
            all.push(order);
        }
    }
    all
}

/// A basic graph pattern of `edges` in textual `order`, with the subject and
/// object of edge `i` exchanged when bit `i` of `swaps` is set. The projection
/// is fixed, so answers of every permutation are comparable.
fn shape_body(
    edges: &[Edge],
    order: &[usize],
    swaps: usize,
    constant: bool,
) -> (String, Vec<(&'static str, &'static str)>) {
    let mut variables = BTreeSet::new();
    let mut patterns = Vec::new();
    let mut pairs = Vec::new();
    for &index in order {
        let (subject, predicate, object) = edges[index];
        let (subject, object) = if swaps & (1 << index) == 0 {
            (subject, object)
        } else {
            (object, subject)
        };
        let predicate = if constant {
            "ex:p".to_owned()
        } else {
            variables.insert(predicate);
            format!("?{predicate}")
        };
        variables.insert(subject);
        variables.insert(object);
        patterns.push(format!("?{subject} {predicate} ?{object}"));
        pairs.push((subject, object));
    }
    let projection = variables
        .iter()
        .map(|variable| format!("?{variable}"))
        .collect::<Vec<_>>()
        .join(" ");
    (
        format!("SELECT {projection} WHERE {{ {} }}", patterns.join(" . ")),
        pairs,
    )
}

/// With one constant predicate, only the existing POS index order applies:
/// every object must precede its subject in the global variable order.
fn has_compatible_order(pairs: &[(&str, &str)]) -> bool {
    let mut names = pairs
        .iter()
        .flat_map(|(subject, object)| [*subject, *object])
        .collect::<Vec<_>>();
    names.sort_unstable();
    names.dedup();
    permutations(names.len()).iter().any(|order| {
        let rank = |name: &str| order.iter().position(|index| names[*index] == name);
        pairs
            .iter()
            .all(|(subject, object)| rank(object) < rank(subject))
    })
}

#[test]
fn limits_are_validated() {
    let wall = Duration::from_secs(1);
    let new = |p, v, r, b, w, o, t| AnalyticalExecutionLimits::new(p, v, r, b, w, o, t);
    assert_eq!(
        new(0, 8, 1, 1, 1, 1, wall),
        Err(AnalyticalLimitsError::Patterns)
    );
    assert_eq!(
        new(17, 8, 1, 1, 1, 1, wall),
        Err(AnalyticalLimitsError::Patterns)
    );
    assert_eq!(
        new(16, 0, 1, 1, 1, 1, wall),
        Err(AnalyticalLimitsError::Variables)
    );
    assert_eq!(
        new(16, 9, 1, 1, 1, 1, wall),
        Err(AnalyticalLimitsError::Variables)
    );
    assert_eq!(
        new(1, 1, 0, 1, 1, 1, wall),
        Err(AnalyticalLimitsError::RelationRows)
    );
    assert_eq!(
        new(1, 1, 1, 0, 1, 1, wall),
        Err(AnalyticalLimitsError::MaterializedBytes)
    );
    assert_eq!(
        new(1, 1, 1, 1, 0, 1, wall),
        Err(AnalyticalLimitsError::Work)
    );
    assert_eq!(
        new(1, 1, 1, 1, 1, 0, wall),
        Err(AnalyticalLimitsError::OutputRows)
    );
    assert_eq!(
        new(1, 1, 1, 1, 1, 1, Duration::ZERO),
        Err(AnalyticalLimitsError::WallTime)
    );
    assert!(new(1, 1, 1, 1, 1, 1, Duration::from_nanos(1)).is_ok());
    assert!(new(16, 8, 1, 1, 1, 1, wall).is_ok());
    let limits = new(3, 5, 7, 11, 13, 17, wall).unwrap();
    assert_eq!(
        (
            limits.max_patterns(),
            limits.max_variables(),
            limits.max_rows_per_relation(),
            limits.max_materialized_bytes(),
            limits.max_work(),
            limits.max_output_rows(),
            limits.max_wall_time()
        ),
        (3, 5, 7, 11, 13, 17, wall)
    );
}

#[test]
fn options_expose_mode_and_fallback() {
    let defaults = AnalyticalExecutionOptions::default();
    assert_eq!(defaults, AnalyticalExecutionOptions::disabled());
    assert_eq!(defaults.mode(), AnalyticalExecutionMode::Disabled);
    assert_eq!(defaults.limits(), None);
    assert_eq!(defaults.fallback(), AnalyticalFallback::Standard);
    assert_eq!(
        defaults.variable_order(),
        AnalyticalVariableOrder::default()
    );
    let explicit = ROOMY.options();
    assert_eq!(explicit.mode(), AnalyticalExecutionMode::Explicit);
    assert_eq!(explicit.limits(), Some(ROOMY.limits()));
    assert_eq!(explicit.fallback(), AnalyticalFallback::Standard);
    assert_eq!(
        explicit.variable_order(),
        AnalyticalVariableOrder::default()
    );
    assert_eq!(
        explicit
            .with_fallback(AnalyticalFallback::Refuse)
            .fallback(),
        AnalyticalFallback::Refuse
    );
}

#[test]
fn variable_order_constructors_are_validated() {
    for positions in [
        &[][..],
        &[0, 0][..],
        &[8][..],
        &[0, 1, 2, 3, 4, 5, 6, 7, 8][..],
    ] {
        assert_eq!(
            AnalyticalVariableOrder::explicit(positions),
            Err(AnalyticalLimitsError::VariableOrder),
            "{positions:?}"
        );
    }
    assert_eq!(
        AnalyticalVariableOrder::index_aware(0),
        Err(AnalyticalLimitsError::OrderSearch)
    );
    let default = AnalyticalVariableOrder::default();
    assert_eq!(default.kind(), AnalyticalVariableOrderKind::IndexAware);
    assert_eq!(default.max_search_nodes(), Some(4096));
    assert_eq!(default.explicit_positions(), None);
    let explicit = AnalyticalVariableOrder::explicit(&[2, 0, 1]).unwrap();
    assert_eq!(explicit.kind(), AnalyticalVariableOrderKind::Explicit);
    assert_eq!(explicit.explicit_positions(), Some(&[2_u8, 0, 1][..]));
    assert_eq!(explicit.max_search_nodes(), None);
    let first = AnalyticalVariableOrder::first_occurrence();
    assert_eq!(first.kind(), AnalyticalVariableOrderKind::FirstOccurrence);
    assert_eq!(first.explicit_positions(), None);
    assert_eq!(first.max_search_nodes(), None);
}

#[test]
fn policy_restriction_only_reduces() {
    let own =
        AnalyticalExecutionLimits::new(3, 8, 100, 1000, 50, 20, Duration::from_secs(10)).unwrap();
    let ceiling =
        AnalyticalExecutionLimits::new(16, 5, 10, 2000, 40, 100, Duration::from_secs(1)).unwrap();
    let minimum =
        AnalyticalExecutionLimits::new(3, 5, 10, 1000, 40, 20, Duration::from_secs(1)).unwrap();
    assert_eq!(own.restricted_to(ceiling), minimum);
    assert_eq!(ceiling.restricted_to(own), minimum);
    assert_eq!(
        own.restricted_to(ROOMY.limits()),
        own,
        "a roomier policy grants nothing"
    );

    let search = |nodes| AnalyticalVariableOrder::index_aware(nodes).unwrap();
    let options = AnalyticalExecutionOptions::explicit(own).with_variable_order(search(100));
    let policy = AnalyticalExecutionOptions::explicit(ceiling)
        .with_fallback(AnalyticalFallback::Refuse)
        .with_variable_order(search(10));
    let restricted = options.restricted_by(policy);
    assert_eq!(restricted.mode(), AnalyticalExecutionMode::Explicit);
    assert_eq!(restricted.limits(), Some(minimum));
    assert_eq!(restricted.fallback(), AnalyticalFallback::Refuse);
    assert_eq!(restricted.variable_order(), search(10));

    let relaxed = options
        .with_fallback(AnalyticalFallback::Refuse)
        .restricted_by(ROOMY.options());
    assert_eq!(relaxed.limits(), Some(own));
    assert_eq!(relaxed.fallback(), AnalyticalFallback::Refuse);
    assert_eq!(relaxed.variable_order(), search(100));

    let explicit = AnalyticalVariableOrder::explicit(&[1, 0]).unwrap();
    assert_eq!(
        options
            .with_variable_order(explicit)
            .restricted_by(policy)
            .variable_order(),
        explicit
    );

    for restricted in [
        options.restricted_by(AnalyticalExecutionOptions::disabled()),
        AnalyticalExecutionOptions::disabled().restricted_by(policy),
    ] {
        assert_eq!(restricted.mode(), AnalyticalExecutionMode::Disabled);
        assert_eq!(restricted.limits(), None);
    }
}

#[test]
fn disabled_default_is_unchanged() {
    on_backends(|backend, store| {
        load_graph(store);
        let expected = oracles(backend, store, TRIANGLE);
        let plain = outcome(
            parse(evaluator(), TRIANGLE)
                .on_store(store)
                .execute()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(plain, expected, "{backend}: on_store changed");
        for options in [
            AnalyticalExecutionOptions::default(),
            AnalyticalExecutionOptions::disabled(),
            AnalyticalExecutionOptions::disabled().with_fallback(AnalyticalFallback::Refuse),
        ] {
            let bound = bind(store, TRIANGLE, options);
            let report = bound.report();
            assert_eq!(outcome(bound.execute().unwrap()).unwrap(), expected);
            let snapshot = report.snapshot();
            assert_eq!(snapshot.disposition, AnalyticalDisposition::NotAttempted);
            assert_eq!(snapshot.reason, Some(AnalyticalReason::Disabled));
            assert_eq!(
                (
                    snapshot.patterns,
                    snapshot.variables,
                    snapshot.relations,
                    snapshot.work,
                    snapshot.output_rows
                ),
                (0, 0, 0, 0, 0)
            );
            assert!(!snapshot.completed);
        }
    });
}

#[test]
fn evaluator_options_are_carried_through_clones() {
    on_backends(|backend, store| {
        load_graph(store);
        let expected = oracles(backend, store, TRIANGLE);
        assert_eq!(
            evaluator().analytical_execution(),
            AnalyticalExecutionOptions::disabled()
        );
        let options = ROOMY
            .options()
            .with_variable_order(AnalyticalVariableOrder::first_occurrence());
        let configured = evaluator().with_analytical_execution(options);
        assert_eq!(configured.analytical_execution(), options);
        let cloned = configured.clone();
        assert_eq!(cloned.analytical_execution(), options);
        let prepared = parse(cloned, TRIANGLE);
        assert_eq!(prepared.analytical_execution(), options);
        for bound in [
            prepared.clone().on_store_analytical(store),
            prepared.on_store_analytical(store),
        ] {
            let report = bound.report();
            assert_eq!(outcome(bound.execute().unwrap()).unwrap(), expected);
            let snapshot = report.snapshot();
            assert_eq!(
                snapshot.disposition,
                AnalyticalDisposition::Analytical,
                "{backend}: {snapshot:?}"
            );
            assert_eq!(
                snapshot.variable_order_kind,
                Some(AnalyticalVariableOrderKind::FirstOccurrence),
                "{backend}: the configured order was not carried"
            );
        }

        // Ordinary bindings of a configured evaluator are unchanged.
        assert_eq!(
            outcome(
                parse(configured.clone(), TRIANGLE)
                    .on_store(store)
                    .execute()
                    .unwrap()
            )
            .unwrap(),
            expected
        );
        // A per-binding override replaces the configuration for that binding.
        let bound = parse(configured, TRIANGLE)
            .on_store_with_analytical(store, AnalyticalExecutionOptions::disabled());
        let report = bound.report();
        assert_eq!(outcome(bound.execute().unwrap()).unwrap(), expected);
        assert_eq!(
            report.snapshot().disposition,
            AnalyticalDisposition::NotAttempted
        );
        // The default evaluator binds analytically as disabled.
        let bound = parse(evaluator(), TRIANGLE).on_store_analytical(store);
        let report = bound.report();
        assert_eq!(outcome(bound.execute().unwrap()).unwrap(), expected);
        assert_eq!(report.snapshot().reason, Some(AnalyticalReason::Disabled));
        // A refusal policy is carried too.
        let refusing = evaluator()
            .with_analytical_execution(ROOMY.options().with_fallback(AnalyticalFallback::Refuse));
        let bound = parse(refusing.clone(), SINGLE).on_store_analytical(store);
        assert_eq!(
            typed(failure(bound.execute())),
            AnalyticalExecutionError::Refused(AnalyticalReason::Ineligible),
            "{backend}"
        );
    });
}

#[test]
fn variable_predicate_shapes_match_standard() {
    on_backends(|backend, store| {
        load_graph(store);
        let triangle = verify_analytical(&format!("{backend}/triangle"), store, TRIANGLE);
        assert_eq!(triangle.rows.len(), 6, "{backend}: triangle multiplicity");
        assert_eq!(
            (
                triangle.started.patterns,
                triangle.started.variables,
                triangle.started.relations
            ),
            (3, 6, 3)
        );
        let cycle = verify_analytical(&format!("{backend}/cycle"), store, CYCLE);
        assert_eq!(cycle.rows.len(), 4, "{backend}: 4-cycle rotations");
        assert_eq!((cycle.started.patterns, cycle.started.variables), (4, 8));
        let chain = verify_analytical(&format!("{backend}/chain"), store, CHAIN);
        assert!(!chain.rows.is_empty(), "{backend}: chain is vacuous");
        assert_eq!((chain.started.patterns, chain.started.variables), (3, 7));
        let star = verify_analytical(&format!("{backend}/star"), store, STAR);
        assert_eq!(star.rows.len(), 61, "{backend}: star multiplicity");
        assert_eq!((star.started.patterns, star.started.variables), (3, 7));
        assert_eq!(star.finished.output_rows, 61);
    });
}

fn permutation_scenario(backend: &str, store: &Store, constant: bool) {
    let options = exhaustive_search();
    let (mut analytical, mut declined) = (0_usize, 0_usize);
    for (name, edges) in SHAPES {
        let orders = permutations(edges.len());
        for swaps in 0..(1_usize << edges.len()) {
            let mut reference: Option<Rows> = None;
            for order in &orders {
                let (body, pairs) = shape_body(edges, order, swaps, constant);
                let label = format!("{backend}/{name}/order {order:?}/swaps {swaps:04b}");
                let supported = !constant || backend == "memory" || has_compatible_order(&pairs);
                let rows = if supported {
                    analytical += 1;
                    verify_analytical_options(&label, store, &body, options).rows
                } else {
                    declined += 1;
                    let expected = oracles(&label, store, &body);
                    let [fallback, _] = check_declined(
                        &label,
                        store,
                        &|| parse(evaluator(), &body),
                        options,
                        &expected,
                        AnalyticalReason::UnsupportedOrder,
                    );
                    assert_eq!(fallback.variable_order_kind, None, "{label}");
                    expected.rows().clone()
                };
                if let Some(reference) = &reference {
                    assert_eq!(
                        &rows, reference,
                        "{label}: pattern order changed the answer"
                    );
                } else {
                    reference = Some(rows);
                }
            }
        }
    }
    assert!(analytical > 0, "{backend}: no analytical permutation");
    if constant && backend != "memory" {
        assert!(declined > 0, "{backend}: no incompatible permutation");
    } else {
        assert_eq!(declined, 0, "{backend}");
    }
}

#[test]
fn pattern_permutations_with_variable_predicates_match_standard() {
    on_backends(|backend, store| {
        load_graph(store);
        permutation_scenario(backend, store, false);
    });
}

#[test]
fn constant_predicate_permutations_follow_index_compatibility() {
    on_backends(|backend, store| {
        load(store, CONST_DATA);
        permutation_scenario(backend, store, true);
    });
}

#[test]
fn directed_constant_triangle_needs_a_compatible_index() {
    on_backends(|backend, store| {
        load(store, CONST_DATA);
        let body = "SELECT ?a ?b ?c WHERE { ?a ex:p ?b . ?b ex:p ?c . ?c ex:p ?a }";
        let expected = oracles(backend, store, body);
        assert!(!expected.rows().is_empty(), "{backend}: vacuous triangle");
        for order in [
            AnalyticalVariableOrder::default(),
            AnalyticalVariableOrder::first_occurrence(),
            AnalyticalVariableOrder::explicit(&[2, 1, 0]).unwrap(),
            AnalyticalVariableOrder::index_aware(200_000).unwrap(),
        ] {
            let options = ROOMY.options().with_variable_order(order);
            let label = format!("{backend}/{:?}", order.kind());
            if backend == "memory" {
                let verified = verify_analytical_options(&label, store, body, options);
                assert_eq!(&verified.rows, expected.rows(), "{label}");
                assert_eq!(
                    verified.started.variable_order_kind,
                    Some(order.kind()),
                    "{label}"
                );
            } else {
                check_declined(
                    &label,
                    store,
                    &|| parse(evaluator(), body),
                    options,
                    &expected,
                    AnalyticalReason::UnsupportedOrder,
                );
            }
        }
    });
}

#[test]
fn variable_order_strategies_are_reported_and_checked() {
    on_backends(|backend, store| {
        load_graph(store);
        let identity = [0_u8, 1, 2, 3, 4, 5];
        for (name, order, positions) in [
            (
                "first-occurrence",
                AnalyticalVariableOrder::first_occurrence(),
                Some(identity),
            ),
            (
                "explicit",
                AnalyticalVariableOrder::explicit(&[0, 1, 2, 3, 4, 5]).unwrap(),
                Some(identity),
            ),
            ("index-aware", AnalyticalVariableOrder::default(), None),
        ] {
            let label = format!("{backend}/{name}");
            let verified = verify_analytical_options(
                &label,
                store,
                TRIANGLE,
                ROOMY.options().with_variable_order(order),
            );
            let snapshot = verified.started;
            assert_eq!(snapshot.variable_order_kind, Some(order.kind()), "{label}");
            let chosen = &snapshot.variable_order[..snapshot.variable_order_len];
            let mut sorted = chosen.to_vec();
            sorted.sort_unstable();
            assert_eq!(sorted, identity, "{label}: not a permutation");
            if let Some(positions) = positions {
                assert_eq!(chosen, positions, "{label}");
            }
            assert!(snapshot.order_search_nodes >= 1, "{label}");
            assert_eq!(verified.rows.len(), 6, "{label}");
        }

        let expected = oracles(backend, store, TRIANGLE);
        let prepare = || parse(evaluator(), TRIANGLE);
        // The predicate before its subject has no existing index order.
        let incompatible = AnalyticalVariableOrder::explicit(&[1, 0, 2, 3, 4, 5]).unwrap();
        let label = format!("{backend}/incompatible explicit");
        if backend == "memory" {
            let verified = verify_analytical_options(
                &label,
                store,
                TRIANGLE,
                ROOMY.options().with_variable_order(incompatible),
            );
            assert_eq!(
                &verified.started.variable_order[..6],
                &[1, 0, 2, 3, 4, 5],
                "{label}"
            );
        } else {
            check_declined(
                &label,
                store,
                &prepare,
                ROOMY.options().with_variable_order(incompatible),
                &expected,
                AnalyticalReason::UnsupportedOrder,
            );
        }

        for (name, positions) in [
            ("short", &[0, 1, 2][..]),
            ("out of range", &[0, 1, 2, 3, 4, 7][..]),
        ] {
            let label = format!("{backend}/{name}");
            let order = AnalyticalVariableOrder::explicit(positions).unwrap();
            for snapshot in check_declined(
                &label,
                store,
                &prepare,
                ROOMY.options().with_variable_order(order),
                &expected,
                AnalyticalReason::InvalidVariableOrder,
            ) {
                assert_eq!(snapshot.variable_order_kind, None, "{label}");
            }
        }

        let label = format!("{backend}/search budget");
        for snapshot in check_declined(
            &label,
            store,
            &prepare,
            ROOMY
                .options()
                .with_variable_order(AnalyticalVariableOrder::index_aware(1).unwrap()),
            &expected,
            AnalyticalReason::OrderSearchBudget,
        ) {
            assert!(snapshot.order_search_nodes > 1, "{label}: {snapshot:?}");
            assert_eq!(snapshot.variable_order_kind, None, "{label}");
        }
    });
}

#[test]
fn repeated_variable_positions_match_standard() {
    on_backends(|backend, store| {
        load(
            store,
            "ex:s ex:loop ex:s . ex:s ex:next ex:t . ex:t ex:loop ex:t . ex:u ex:next ex:s . \
             ex:k ex:k ex:s . ex:k ex:k ex:k .",
        );
        for (name, body) in [
            ("object-subject", "SELECT * WHERE { ?a ?p ?a . ?a ?q ?c }"),
            (
                "predicate-subject",
                "SELECT * WHERE { ?x ?x ?y . ?x ?z ?y }",
            ),
            ("all-same", "SELECT * WHERE { ?x ?x ?x . ?x ?p ?o }"),
        ] {
            let verified = verify_analytical(&format!("{backend}/{name}"), store, body);
            assert!(!verified.rows.is_empty(), "{backend}/{name}: vacuous");
        }
    });
}

#[test]
fn duplicate_patterns_match_standard() {
    on_backends(|backend, store| {
        load_graph(store);
        let same = verify_analytical(
            &format!("{backend}/same"),
            store,
            "SELECT * WHERE { ?a ?p ?b . ?a ?p ?b }",
        );
        assert_eq!(
            same.rows.len(),
            13,
            "{backend}: duplicate pattern collapsed or doubled"
        );
        assert_eq!(same.started.patterns, 2);
        for (name, body) in [
            (
                "partial",
                "SELECT * WHERE { ?a ex:p1 ?b . ?a ex:p1 ?b . ?b ?q ?c }",
            ),
            ("projected", "SELECT ?a WHERE { ?a ?p ?b . ?a ?p ?b }"),
            (
                "blank",
                "SELECT ?a WHERE { ?a ?p _:m . ?a ?p _:m . _:m ?q ?c }",
            ),
        ] {
            verify_analytical(&format!("{backend}/{name}"), store, body);
        }
    });
}

#[test]
fn projection_multiplicity_order_and_unbound_variables() {
    on_backends(|backend, store| {
        load_graph(store);
        let body = "{ ?a ?p ?b . ?b ?q ?c . ?c ?r ?a }";
        let projected = verify_analytical(
            &format!("{backend}/multiplicity"),
            store,
            &format!("SELECT ?a WHERE {body}"),
        );
        assert_eq!(projected.rows.len(), 6);
        let mut seen = BTreeMap::<&Vec<Option<String>>, usize>::new();
        for row in &projected.rows {
            *seen.entry(row).or_default() += 1;
        }
        assert!(
            seen.values().any(|times| *times > 1),
            "{backend}: projection collapsed duplicate solutions"
        );
        verify_analytical(
            &format!("{backend}/reordered"),
            store,
            &format!("SELECT ?c ?a ?p WHERE {body}"),
        );
        let unbound = verify_analytical(
            &format!("{backend}/unbound"),
            store,
            &format!("SELECT ?a ?z WHERE {body}"),
        );
        assert!(
            unbound
                .rows
                .iter()
                .all(|row| row[0].is_some() && row[1].is_none())
        );
        let only_unbound = verify_analytical(
            &format!("{backend}/only-unbound"),
            store,
            &format!("SELECT ?z WHERE {body}"),
        );
        assert_eq!(only_unbound.rows.len(), 6);
        // A parser that rejects repeated projected variables is upstream of the
        // analytical path, so there is nothing further to compare.
        let repeated = format!("SELECT ?a ?a ?b WHERE {body}");
        if evaluator()
            .parse_query(&format!("{PREFIXES}{repeated}"))
            .is_ok()
        {
            verify_analytical(&format!("{backend}/repeated"), store, &repeated);
        }
    });
}

#[test]
fn projection_width_is_bounded_before_allocation() {
    on_backends(|backend, store| {
        load_graph(store);
        let unbound = |range: std::ops::Range<usize>| {
            range.map(|index| format!(" ?u{index}")).collect::<String>()
        };
        let body =
            |extra: String| format!("SELECT ?a{extra} WHERE {{ ?a ?p ?b . ?b ?q ?c . ?c ?r ?a }}");
        let widest = verify_analytical(&format!("{backend}/64"), store, &body(unbound(1..64)));
        assert_eq!(widest.rows.len(), 6);
        assert!(widest.rows.iter().all(|row| row.len() == 64));

        let over = body(unbound(0..64));
        let label = format!("{backend}/65");
        let expected = oracles(&label, store, &over);
        for snapshot in check_declined(
            &label,
            store,
            &|| parse(evaluator(), &over),
            ROOMY.options(),
            &expected,
            AnalyticalReason::TooManyProjected,
        ) {
            assert_eq!(
                (
                    snapshot.patterns,
                    snapshot.work,
                    snapshot.materialized_bytes
                ),
                (0, 0, 0),
                "{label}: charged before the projection bound"
            );
        }

        // 100k distinct unbound variables, inserted into the parsed algebra:
        // the textual form would spend quadratic time in the parser.
        let mut query = spargebra::SparqlParser::new()
            .parse_query(&format!("{PREFIXES}{}", body(String::new())))
            .unwrap();
        let spargebra::Query::Select(select) = &mut query else {
            panic!("select expected");
        };
        let spargebra::algebra::QueryExpression::Project { variables, .. } = &mut select.expression
        else {
            panic!("projection expected");
        };
        variables.extend((0..100_000).map(|index| Variable::new(format!("u{index}")).unwrap()));
        let bound = evaluator().for_query(query).on_store_with_analytical(
            store,
            ROOMY.options().with_fallback(AnalyticalFallback::Refuse),
        );
        let report = bound.report();
        assert_eq!(
            typed(failure(bound.execute())),
            AnalyticalExecutionError::Refused(AnalyticalReason::TooManyProjected),
            "{backend}/100k"
        );
        let snapshot = report.snapshot();
        assert_eq!(snapshot.disposition, AnalyticalDisposition::Refused);
        assert_eq!(
            (
                snapshot.patterns,
                snapshot.work,
                snapshot.materialized_bytes
            ),
            (0, 0, 0),
            "{backend}/100k: charged before the projection bound"
        );
    });
}

#[test]
fn wide_rows_release_their_charge_under_a_byte_ceiling() {
    on_backends(|backend, store| {
        const ROWS: usize = 100;
        let data = (0..ROWS)
            .map(|index| format!("ex:s{index} ex:w ex:o{index} . ex:o{index} ex:k ex:end ."))
            .collect::<Vec<_>>();
        load(store, &data.join(" "));
        let extra = (0..61)
            .map(|index| format!(" ?u{index}"))
            .collect::<String>();
        let body = format!("SELECT ?s ?o ?e{extra} WHERE {{ ?s ex:w ?o . ?o ex:k ?e }}");
        let label = format!("{backend}/wide");
        let full = verify_analytical(&label, store, &body);
        assert_eq!(full.rows.len(), ROWS);
        assert!(full.rows.iter().all(|row| row.len() == 64));
        let completes = |bytes: usize| match bind(
            store,
            &body,
            Ceilings { bytes, ..ROOMY }.options(),
        )
        .execute()
        {
            Err(error) => {
                assert_bytes_exceeded(&label, error);
                false
            }
            Ok(results) => {
                let streamed = stream(results);
                match streamed.error {
                    None => {
                        assert_eq!(streamed.rows.len(), ROWS, "{label}");
                        true
                    }
                    Some(error) => {
                        assert_bytes_exceeded(&label, error);
                        false
                    }
                }
            }
        };
        let least = least_passing(1, ROOMY.bytes, completes);
        // Were row charges retained, the whole stream would need at least
        // ROWS row widths above the pre-stream charge.
        let width = 64 * std::mem::size_of::<Option<Term>>();
        assert!(
            least < full.started.materialized_bytes + ROWS / 2 * width,
            "{label}: row charges accumulate ({least} bytes needed)"
        );
    });
}

#[test]
fn empty_answers_are_analytical() {
    on_backends(|backend, store| {
        let empty = verify_analytical(&format!("{backend}/empty-store"), store, TRIANGLE);
        assert!(empty.rows.is_empty());
        load_graph(store);
        for (name, body) in [
            (
                "absent-predicate",
                "SELECT * WHERE { ?a ex:absent ?b . ?b ?q ?c }",
            ),
            (
                "absent-graph",
                "SELECT * WHERE { GRAPH ex:missing { ?a ?p ?b . ?b ?q ?c } }",
            ),
            ("no-join", "SELECT * WHERE { ?a ex:s1 ?b . ?b ex:s2 ?c }"),
        ] {
            let verified = verify_analytical(&format!("{backend}/{name}"), store, body);
            assert!(verified.rows.is_empty(), "{backend}/{name}");
            assert_eq!(verified.finished.output_rows, 0);
        }
    });
}

#[test]
fn fixed_named_graph_matches_standard() {
    on_backends(|backend, store| {
        load(
            store,
            "ex:d1 ex:p ex:d2 . ex:d2 ex:p ex:d3 . ex:d3 ex:p ex:d1 . \
             GRAPH ex:g { ex:n1 ex:p1 ex:n2 . ex:n2 ex:p2 ex:n3 . ex:n3 ex:p3 ex:n1 . \
                          ex:n1 ex:p1 ex:n4 . ex:n4 ex:p2 ex:n5 } \
             GRAPH ex:h { ex:n1 ex:p1 ex:n2 . ex:h1 ex:p9 ex:h2 . ex:h2 ex:p9 ex:h3 . ex:h3 ex:p9 ex:h1 }",
        );
        let default = verify_analytical(&format!("{backend}/default"), store, TRIANGLE);
        assert_eq!(default.rows.len(), 3);
        for (name, graph) in [("g", "ex:g"), ("h", "ex:h")] {
            let body =
                format!("SELECT * WHERE {{ GRAPH {graph} {{ ?a ?p ?b . ?b ?q ?c . ?c ?r ?a }} }}");
            let verified = verify_analytical(&format!("{backend}/{name}"), store, &body);
            assert_eq!(verified.rows.len(), 3, "{backend}/{name}");
            assert_ne!(
                verified.rows, default.rows,
                "{backend}/{name} saw the default graph"
            );
        }
        verify_analytical(
            &format!("{backend}/g-constants"),
            store,
            "SELECT * WHERE { GRAPH ex:g { ?a ex:p1 ?b . ?b ex:p2 ?c } }",
        );
    });
}

#[test]
fn literal_term_identity_matches_standard() {
    on_backends(|backend, store| {
        let objects = [
            r#""1"^^xsd:integer"#,
            r#""1""#,
            r#""1"@en"#,
            r#""1.0"^^xsd:decimal"#,
            r#""1"^^ex:custom"#,
            r#""1"^^xsd:double"#,
            r#""01"^^xsd:integer"#,
            r#""b c"@fr"#,
        ];
        let data = objects
            .iter()
            .enumerate()
            .map(|(index, object)| {
                format!("ex:s{index} ex:v {object} . ex:t{index} ex:w {object} .")
            })
            .collect::<Vec<_>>();
        load(store, &data.join(" "));
        let joined = verify_analytical(
            &format!("{backend}/join"),
            store,
            "SELECT ?s ?t ?o WHERE { ?s ex:v ?o . ?t ex:w ?o }",
        );
        assert!(
            joined.rows.len() >= objects.len(),
            "{backend}: distinct literals were merged"
        );
        for (index, body) in [
            r#"SELECT ?s ?o WHERE { ?s ex:v "1"@en . ?s ex:v ?o }"#,
            r#"SELECT ?s ?o WHERE { ?s ex:v "1.0"^^xsd:decimal . ?s ex:v ?o }"#,
            r#"SELECT ?s ?o WHERE { ?s ex:v "01"^^xsd:integer . ?s ex:v ?o }"#,
            r#"SELECT ?s ?o WHERE { ?s ex:v "1"^^ex:custom . ?s ex:v ?o }"#,
            r#"SELECT ?s ?o WHERE { ?s ex:v "b c"@fr . ?s ex:v ?o }"#,
        ]
        .into_iter()
        .enumerate()
        {
            let verified = verify_analytical(&format!("{backend}/constant{index}"), store, body);
            assert!(
                !verified.rows.is_empty(),
                "{backend}/constant{index}: vacuous"
            );
        }
    });
}

#[test]
fn double_zero_and_nan_identity_matches_standard() {
    on_backends(|backend, store| {
        load(
            store,
            r#"ex:s1 ex:v "0"^^xsd:double . ex:t1 ex:w "-0"^^xsd:double . ex:t2 ex:w "0"^^xsd:double .
               ex:s2 ex:v "NaN"^^xsd:double . ex:t3 ex:w "NaN"^^xsd:double .
               ex:s3 ex:v "1"^^xsd:float . ex:t4 ex:w "1"^^xsd:double ."#,
        );
        verify_analytical(
            backend,
            store,
            "SELECT ?s ?t ?o WHERE { ?s ex:v ?o . ?t ex:w ?o }",
        );
    });
}

#[test]
fn blank_node_identity_matches_standard() {
    on_backends(|backend, store| {
        load(
            store,
            "_:b1 ex:v ex:x . _:b1 ex:w ex:y . _:b2 ex:v ex:x . _:b3 ex:w ex:y . \
             ex:a ex:has _:o1 . _:o1 ex:w ex:end . ex:a ex:has _:o2 . _:o2 ex:z ex:other .",
        );
        let shared = verify_analytical(
            &format!("{backend}/stored-blank-join"),
            store,
            "SELECT ?b ?x ?y WHERE { ?b ex:v ?x . ?b ex:w ?y }",
        );
        assert_eq!(
            shared.rows.len(),
            1,
            "{backend}: distinct blank nodes were joined"
        );
        assert!(
            shared.rows[0][0]
                .as_deref()
                .is_some_and(|term| term.starts_with("_:"))
        );
        let query_blank = verify_analytical(
            &format!("{backend}/query-blank"),
            store,
            "SELECT ?s ?y WHERE { ?s ex:has _:m . _:m ex:w ?y }",
        );
        assert_eq!(query_blank.rows.len(), 1);
        let distinct_labels = verify_analytical(
            &format!("{backend}/distinct-labels"),
            store,
            "SELECT ?s WHERE { ?s ex:has _:m1 . ?s ex:has _:m2 }",
        );
        assert_eq!(
            distinct_labels.rows.len(),
            4,
            "{backend}: labels m1 and m2 were merged"
        );
        let same_label = verify_analytical(
            &format!("{backend}/same-label"),
            store,
            "SELECT ?s WHERE { ?s ex:has _:m . ?s ex:has _:m }",
        );
        assert_eq!(same_label.rows.len(), 2);
        let returned = verify_analytical(
            &format!("{backend}/returned-blank"),
            store,
            "SELECT ?o WHERE { ?s ex:has ?o . ?o ex:w ?y }",
        );
        assert_eq!(returned.rows.len(), 1);
        assert!(
            returned.rows[0][0]
                .as_deref()
                .is_some_and(|term| term.starts_with("_:"))
        );
    });
}

fn random_graph(seed: u64) -> String {
    let mut state = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15).wrapping_add(1);
    let mut next = |bound: u64| {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (state >> 33) % bound
    };
    let mut edges = Vec::new();
    for _ in 0..30 {
        let subject = next(6);
        let predicate = next(3);
        let object = next(6);
        edges.push(format!("ex:r{subject} ex:e{predicate} ex:r{object} ."));
    }
    format!("GRAPH ex:g{seed} {{ {} }}", edges.join(" "))
}

#[test]
fn seeded_random_graphs_match_standard() {
    on_backends(|backend, store| {
        for seed in 0..6_u64 {
            load(store, &random_graph(seed));
        }
        for seed in 0..6_u64 {
            for (name, patterns) in [
                ("triangle", "?a ?p ?b . ?b ?q ?c . ?c ?r ?a"),
                ("cycle", "?a ?p ?b . ?b ?q ?c . ?c ?r ?d . ?d ?s ?a"),
                ("chain", "?a ?p ?b . ?b ?q ?c . ?c ?r ?d"),
                ("star", "?x ?p1 ?l1 . ?x ?p2 ?l2 . ?x ?p3 ?l3"),
            ] {
                let body = format!("SELECT * WHERE {{ GRAPH ex:g{seed} {{ {patterns} }} }}");
                verify_analytical(&format!("{backend} seed {seed} {name}"), store, &body);
            }
        }
    });
}

#[test]
fn snapshot_is_bound_before_later_mutation() {
    on_backends(|backend, store| {
        load_graph(store);
        let before_triangle = oracles(backend, store, TRIANGLE);
        let before_single = oracles(backend, store, SINGLE);
        let analytical = bind(store, TRIANGLE, ROOMY.options());
        let analytical_report = analytical.report();
        let fallback = bind(store, SINGLE, ROOMY.options());
        let fallback_report = fallback.report();
        let standard = parse(evaluator(), TRIANGLE).on_store(store);
        let streaming = bind(store, TRIANGLE, ROOMY.options());
        let streaming_results = streaming.execute().unwrap();
        let QueryResults::Solutions(mut streaming_rows) = streaming_results else {
            panic!("solutions expected");
        };
        let mut seen = vec![row_of(
            &streaming_rows.next().unwrap().unwrap(),
            streaming_rows.variables().len(),
        )];

        load(
            store,
            "ex:x1 ex:p1 ex:x2 . ex:x2 ex:p2 ex:x3 . ex:x3 ex:p3 ex:x1 .",
        );

        assert_eq!(
            outcome(analytical.execute().unwrap()).unwrap(),
            before_triangle,
            "{backend}: analytical execution saw a later write"
        );
        assert_eq!(
            analytical_report.snapshot().disposition,
            AnalyticalDisposition::Analytical
        );
        assert_eq!(
            outcome(fallback.execute().unwrap()).unwrap(),
            before_single,
            "{backend}: fallback used a newer snapshot"
        );
        assert_eq!(
            fallback_report.snapshot().disposition,
            AnalyticalDisposition::Fallback
        );
        assert_eq!(
            outcome(standard.execute().unwrap()).unwrap(),
            before_triangle
        );
        let width = streaming_rows.variables().len();
        for item in streaming_rows {
            seen.push(row_of(&item.unwrap(), width));
        }
        seen.sort();
        assert_eq!(
            &seen,
            before_triangle.rows(),
            "{backend}: an already streaming query saw a later write"
        );

        let after = verify_analytical(&format!("{backend}/after"), store, TRIANGLE);
        assert_eq!(after.rows.len(), before_triangle.rows().len() + 3);
    });
}

#[test]
fn unsupported_forms_fall_back_or_refuse_before_any_row() {
    on_backends(|backend, store| {
        load_graph(store);
        load(
            store,
            "GRAPH ex:g { ex:n1 ex:p1 ex:n2 . ex:n2 ex:p2 ex:n3 }",
        );
        let bgp = "?a ?p ?b . ?b ?q ?c";
        let cases = [
            (
                "ask",
                format!("ASK {{ {bgp} }}"),
                AnalyticalReason::NotSelect,
            ),
            (
                "construct",
                format!("CONSTRUCT {{ ?a ex:linked ?c }} WHERE {{ {bgp} }}"),
                AnalyticalReason::NotSelect,
            ),
            ("single", SINGLE.to_owned(), AnalyticalReason::Ineligible),
            (
                "disconnected",
                "SELECT * WHERE { ?a ?p ?b . ?c ?q ?d }".to_owned(),
                AnalyticalReason::Ineligible,
            ),
            (
                "ground-disconnected",
                "SELECT * WHERE { ex:n1 ex:p1 ex:n2 . ?a ?p ?b }".to_owned(),
                AnalyticalReason::Ineligible,
            ),
            (
                "optional",
                format!("SELECT * WHERE {{ ?a ?p ?b OPTIONAL {{ ?b ?q ?c }} }}"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "union",
                "SELECT * WHERE { { ?a ?p ?b . ?b ?q ?c } UNION { ?a ?p ?c . ?c ?q ?b } }"
                    .to_owned(),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "filter",
                format!("SELECT * WHERE {{ {bgp} FILTER(?a != ?c) }}"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "minus",
                format!("SELECT * WHERE {{ {bgp} MINUS {{ ?a ex:p1 ?b }} }}"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "path",
                "SELECT * WHERE { ?a ex:p1+ ?b . ?b ?q ?c }".to_owned(),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "bind",
                format!("SELECT * WHERE {{ {bgp} BIND(1 AS ?one) }}"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "values",
                format!("SELECT * WHERE {{ {bgp} VALUES ?a {{ ex:n1 }} }}"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "subquery",
                "SELECT * WHERE { { SELECT ?a WHERE { ?a ?p ?b } } ?a ?q ?c }".to_owned(),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "aggregate",
                format!("SELECT (COUNT(*) AS ?n) WHERE {{ {bgp} }}"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "distinct",
                format!("SELECT DISTINCT ?a WHERE {{ {bgp} }}"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "order",
                format!("SELECT * WHERE {{ {bgp} }} ORDER BY ?a ?b ?c ?p ?q"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "slice",
                format!("SELECT * WHERE {{ {bgp} }} LIMIT 1000"),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "graph-over-optional",
                "SELECT * WHERE { GRAPH ex:g { ?a ?p ?b OPTIONAL { ?b ?q ?c } } }".to_owned(),
                AnalyticalReason::UnsupportedAlgebra,
            ),
            (
                "variable-graph",
                format!("SELECT * WHERE {{ GRAPH ?g {{ {bgp} }} }}"),
                AnalyticalReason::VariableGraph,
            ),
            (
                "from",
                format!("SELECT * FROM ex:g WHERE {{ {bgp} }}"),
                AnalyticalReason::QueryDataset,
            ),
            (
                "from-named",
                format!("SELECT * FROM NAMED ex:g WHERE {{ {bgp} }}"),
                AnalyticalReason::QueryDataset,
            ),
        ];
        for (name, body, reason) in &cases {
            let label = format!("{backend}/{name}");
            let expected = oracles(&label, store, body);
            check_declined(
                &label,
                store,
                &|| parse(evaluator(), body),
                ROOMY.options(),
                &expected,
                *reason,
            );
        }
    });
}

#[test]
fn substitutions_are_declined() {
    on_backends(|backend, store| {
        load_graph(store);
        let body = "SELECT ?a ?b ?c WHERE { ?a ?p ?b . ?b ?q ?c . ?c ?r ?a }";
        let variable = Variable::new("a").unwrap();
        let node = NamedNode::new("urn:ax:n1").unwrap();
        let prepare =
            || parse(evaluator(), body).substitute_variable(variable.clone(), node.clone());
        let expected = outcome(prepare().on_store(store).execute().unwrap()).unwrap();
        check_declined(
            backend,
            store,
            &prepare,
            ROOMY.options(),
            &expected,
            AnalyticalReason::Substitutions,
        );
    });
}

#[test]
fn evaluator_resource_budgets_are_not_bypassed() {
    on_backends(|backend, store| {
        load_graph(store);
        let expected = oracles(backend, store, TRIANGLE);
        let budget = InnerJoinBuildBudget::new(1_000_000);
        let prepare = || {
            parse(
                evaluator().with_inner_join_build_budget(budget.clone()),
                TRIANGLE,
            )
        };
        let bound = prepare().on_store_with_analytical(
            store,
            ROOMY.options().with_fallback(AnalyticalFallback::Refuse),
        );
        assert_eq!(
            typed(failure(bound.execute())),
            AnalyticalExecutionError::Refused(AnalyticalReason::ResourceBudgets)
        );
        assert_eq!(
            budget.charged_rows(),
            0,
            "{backend}: refusal executed the standard plan"
        );
        check_declined(
            backend,
            store,
            &prepare,
            ROOMY.options(),
            &expected,
            AnalyticalReason::ResourceBudgets,
        );
    });
}

#[test]
fn ceilings_decline_before_the_stream() {
    on_backends(|backend, store| {
        load_graph(store);
        let expected = oracles(backend, store, TRIANGLE);
        let base = verify_analytical(backend, store, TRIANGLE);
        let prepare = || parse(evaluator(), TRIANGLE);

        // Budget and wall-time stops before the first row are typed failures
        // under both policies, never a standard fallback.
        let mut failures = vec![
            (
                // The pre-stream peak exceeds the charge kept once streaming.
                "bytes",
                Ceilings {
                    bytes: base.started.materialized_bytes - 1,
                    ..ROOMY
                },
                Stopped::Budget(AnalyticalBudget::MaterializedBytes),
            ),
            (
                "work",
                Ceilings { work: 1, ..ROOMY },
                Stopped::Budget(AnalyticalBudget::Work),
            ),
            (
                // The first binding is searched before the stream is returned.
                "work at first binding",
                Ceilings {
                    work: base.started.work - 1,
                    ..ROOMY
                },
                Stopped::Budget(AnalyticalBudget::Work),
            ),
            (
                // The deadline expires during planning, no sleep involved.
                "wall time",
                Ceilings {
                    wall: Duration::from_nanos(1),
                    ..ROOMY
                },
                Stopped::TimedOut,
            ),
        ];
        if backend == "memory" {
            failures.push((
                "relation rows",
                Ceilings { rows: 12, ..ROOMY },
                Stopped::Budget(AnalyticalBudget::RelationRows),
            ));
        } else {
            // Native relations are index descriptors: no row is materialized.
            let native = verify_analytical_with(
                &format!("{backend}/native relation rows"),
                store,
                TRIANGLE,
                Ceilings { rows: 1, ..ROOMY },
            );
            assert_eq!(native.rows, base.rows);
        }
        for (name, ceilings, stopped) in failures {
            check_failed_before_stream(
                &format!("{backend}/{name}"),
                store,
                &prepare,
                ceilings.options(),
                stopped,
            );
        }

        // Shape ceilings are capability declines.
        for (name, ceilings, reason) in [
            (
                "patterns",
                Ceilings {
                    patterns: 2,
                    ..ROOMY
                },
                AnalyticalReason::TooManyPatterns,
            ),
            (
                "variables",
                Ceilings {
                    variables: 5,
                    ..ROOMY
                },
                AnalyticalReason::TooManyVariables,
            ),
        ] {
            let label = format!("{backend}/{name}");
            check_declined(
                &label,
                store,
                &prepare,
                ceilings.options(),
                &expected,
                reason,
            );
        }
        for (name, ceilings) in [
            (
                "exact patterns and variables",
                Ceilings {
                    patterns: 3,
                    variables: 6,
                    ..ROOMY
                },
            ),
            ("exact relation rows", Ceilings { rows: 13, ..ROOMY }),
            (
                "exact work",
                Ceilings {
                    work: base.finished.work,
                    ..ROOMY
                },
            ),
        ] {
            verify_analytical_with(&format!("{backend}/{name}"), store, TRIANGLE, ceilings);
        }
    });
}

#[test]
fn stream_failures_are_typed_fused_and_never_replayed() {
    on_backends(|backend, store| {
        load_graph(store);
        let full = verify_analytical(backend, store, STAR);
        let total = count(full.rows.len());
        assert_eq!(total, 61);

        for ceiling in [1, 10, total - 1] {
            let label = format!("{backend}/output {ceiling}");
            let (streamed, snapshot) = run_stream(
                store,
                STAR,
                Ceilings {
                    output: ceiling,
                    ..ROOMY
                }
                .options(),
            );
            assert_eq!(count(streamed.rows.len()), ceiling, "{label}");
            assert_failed_stream(
                &label,
                streamed,
                &snapshot,
                &full.rows,
                AnalyticalExecutionError::BudgetExceeded(AnalyticalBudget::OutputRows),
                AnalyticalReason::Budget(AnalyticalBudget::OutputRows),
            );
        }
        let exact = verify_analytical_with(
            &format!("{backend}/output exact"),
            store,
            STAR,
            Ceilings {
                output: total,
                ..ROOMY
            },
        );
        assert_eq!(exact.rows, full.rows);

        // The first binding is charged before the stream is returned.
        let first = full.started.work;
        let overall = full.finished.work;
        assert!(
            overall > first + 10,
            "{backend}: search work is not charged"
        );
        check_failed_before_stream(
            &format!("{backend}/work below first binding"),
            store,
            &|| parse(evaluator(), STAR),
            Ceilings {
                work: first - 1,
                ..ROOMY
            }
            .options(),
            Stopped::Budget(AnalyticalBudget::Work),
        );
        for (name, work, some_rows) in [
            ("work at first row", first, false),
            ("work midway", first + (overall - first) / 2, true),
        ] {
            let label = format!("{backend}/{name}");
            let (streamed, snapshot) =
                run_stream(store, STAR, Ceilings { work, ..ROOMY }.options());
            assert_eq!(!streamed.rows.is_empty(), some_rows, "{label}");
            assert_failed_stream(
                &label,
                streamed,
                &snapshot,
                &full.rows,
                AnalyticalExecutionError::BudgetExceeded(AnalyticalBudget::Work),
                AnalyticalReason::Budget(AnalyticalBudget::Work),
            );
        }

        // Planning charges are released before the stream: the pre-stream
        // peak lies strictly above the charge kept while streaming.
        let label = format!("{backend}/bytes");
        let peak = least_passing(full.started.materialized_bytes, ROOMY.bytes, |bytes| {
            starts(&label, store, STAR, bytes)
        });
        check_failed_before_stream(
            &format!("{label} below peak"),
            store,
            &|| parse(evaluator(), STAR),
            Ceilings {
                bytes: peak - 1,
                ..ROOMY
            }
            .options(),
            Stopped::Budget(AnalyticalBudget::MaterializedBytes),
        );
        let (streamed, snapshot) = run_stream(
            store,
            STAR,
            Ceilings {
                bytes: peak,
                ..ROOMY
            }
            .options(),
        );
        if streamed.error.is_some() {
            assert_failed_stream(
                &format!("{label} at peak"),
                streamed,
                &snapshot,
                &full.rows,
                AnalyticalExecutionError::BudgetExceeded(AnalyticalBudget::MaterializedBytes),
                AnalyticalReason::Budget(AnalyticalBudget::MaterializedBytes),
            );
        } else {
            let mut rows = streamed.rows;
            rows.sort();
            assert_eq!(rows, full.rows, "{label} at peak");
            assert!(snapshot.completed, "{label} at peak: {snapshot:?}");
        }
    });
}

#[test]
fn stored_large_literal_fails_the_stream_before_any_copy() {
    on_backends(|backend, store| {
        let large = "x".repeat(128 * 1024);
        load(
            store,
            &format!(
                "ex:s0 ex:v \"{large}\" . ex:s0 ex:w ex:t0 . ex:s1 ex:v \"a\" . ex:s1 ex:w ex:t1 . \
                 ex:s2 ex:v \"b\" . ex:s2 ex:w ex:t2 . ex:s3 ex:v \"c\" . ex:s3 ex:w ex:t3 ."
            ),
        );
        let body = "SELECT ?s ?o ?t WHERE { ?s ex:v ?o . ?s ex:w ?t }";
        let label = format!("{backend}/large literal");
        let full = verify_analytical(&label, store, body);
        assert_eq!(full.rows.len(), 4);
        // Room for the plan and any small row, far below the large literal.
        let ceiling = full.started.materialized_bytes + 64 * 1024;
        let (streamed, snapshot) = run_stream(
            store,
            body,
            Ceilings {
                bytes: ceiling,
                ..ROOMY
            }
            .options(),
        );
        assert!(
            streamed
                .rows
                .iter()
                .flatten()
                .flatten()
                .all(|term| term.len() < 1024),
            "{label}: the large literal was returned"
        );
        assert!(
            snapshot.materialized_bytes <= ceiling,
            "{label}: {snapshot:?}"
        );
        assert_failed_stream(
            &label,
            streamed,
            &snapshot,
            &full.rows,
            AnalyticalExecutionError::BudgetExceeded(AnalyticalBudget::MaterializedBytes),
            AnalyticalReason::Budget(AnalyticalBudget::MaterializedBytes),
        );
    });
}

#[test]
fn cancellation_before_execute_never_falls_back() {
    on_backends(|backend, store| {
        load_graph(store);
        for options in [
            ROOMY.options(),
            ROOMY.options().with_fallback(AnalyticalFallback::Refuse),
            AnalyticalExecutionOptions::disabled(),
        ] {
            let token = CancellationToken::new();
            token.cancel();
            let bound = bind_with(
                evaluator().with_cancellation_token(token),
                store,
                TRIANGLE,
                options,
            );
            let report = bound.report();
            assert!(
                matches!(failure(bound.execute()), QueryEvaluationError::Cancelled),
                "{backend}: pre-cancelled token"
            );
            let snapshot = report.snapshot();
            assert_eq!(snapshot.disposition, AnalyticalDisposition::Failed);
            assert_eq!(snapshot.reason, Some(AnalyticalReason::Cancelled));
            assert_eq!(
                (snapshot.relations, snapshot.work, snapshot.output_rows),
                (0, 0, 0)
            );

            let token = CancellationToken::new();
            let bound = bind_with(
                evaluator().with_cancellation_token(token.clone()),
                store,
                TRIANGLE,
                options,
            );
            let report = bound.report();
            token.cancel();
            assert!(
                matches!(failure(bound.execute()), QueryEvaluationError::Cancelled),
                "{backend}: cancelled between bind and execute"
            );
            assert_eq!(report.snapshot().disposition, AnalyticalDisposition::Failed);
            assert_eq!(report.snapshot().reason, Some(AnalyticalReason::Cancelled));
        }
    });
}

#[test]
fn cancellation_during_rows_is_typed_and_fused() {
    on_backends(|backend, store| {
        load_graph(store);
        let token = CancellationToken::new();
        let bound = bind_with(
            evaluator().with_cancellation_token(token.clone()),
            store,
            STAR,
            ROOMY.options(),
        );
        let report = bound.report();
        let QueryResults::Solutions(mut iter) = bound.execute().unwrap() else {
            panic!("solutions expected");
        };
        assert!(matches!(iter.next(), Some(Ok(_))), "{backend}");
        assert!(matches!(iter.next(), Some(Ok(_))), "{backend}");
        token.cancel();
        assert!(
            matches!(iter.next(), Some(Err(QueryEvaluationError::Cancelled))),
            "{backend}: cancellation was not reported"
        );
        assert!(iter.next().is_none(), "{backend}: not fused");
        assert!(iter.next().is_none(), "{backend}: not fused twice");
        let snapshot = report.snapshot();
        assert_eq!(snapshot.disposition, AnalyticalDisposition::Failed);
        assert_eq!(snapshot.reason, Some(AnalyticalReason::Cancelled));
        assert_eq!(snapshot.output_rows, 2);
        assert!(!snapshot.completed);
    });
}

#[test]
fn evaluation_metrics_match_the_standard_executor() {
    on_backends(|backend, store| {
        load_graph(store);
        let standard = || parse(evaluator(), STAR).on_store(store);
        let analytical = || bind(store, STAR, ROOMY.options());

        let before = query_counts(store);
        drain(standard().execute());
        let expected = delta(store, &before);
        assert_eq!(expected, outcomes(&[("succeeded", 1)]), "{backend}");
        let before = query_counts(store);
        drain(analytical().execute());
        assert_eq!(delta(store, &before), expected, "{backend}: success");

        let first_row_only = |result: Result<QueryResults<'_>, QueryEvaluationError>| {
            if let Ok(QueryResults::Solutions(mut iter)) = result {
                assert!(matches!(iter.next(), Some(Ok(_))));
            }
        };
        let before = query_counts(store);
        first_row_only(standard().execute());
        let expected = delta(store, &before);
        assert_eq!(expected, outcomes(&[("abandoned", 1)]), "{backend}");
        let before = query_counts(store);
        first_row_only(analytical().execute());
        assert_eq!(delta(store, &before), expected, "{backend}: early drop");

        let before = query_counts(store);
        drop(standard());
        let expected = delta(store, &before);
        assert_eq!(expected, outcomes(&[("abandoned", 1)]), "{backend}");
        let before = query_counts(store);
        drop(analytical());
        assert_eq!(delta(store, &before), expected, "{backend}: never executed");

        let cancelled = || {
            let token = CancellationToken::new();
            token.cancel();
            evaluator().with_cancellation_token(token)
        };
        let before = query_counts(store);
        drain(parse(cancelled(), STAR).on_store(store).execute());
        let expected = delta(store, &before);
        assert_eq!(expected, outcomes(&[("cancelled", 1)]), "{backend}");
        let before = query_counts(store);
        drain(bind_with(cancelled(), store, STAR, ROOMY.options()).execute());
        assert_eq!(delta(store, &before), expected, "{backend}: cancelled");

        let before = query_counts(store);
        drain(
            bind(
                store,
                STAR,
                Ceilings {
                    wall: Duration::from_nanos(1),
                    ..ROOMY
                }
                .options(),
            )
            .execute(),
        );
        assert_eq!(
            delta(store, &before),
            outcomes(&[("timed_out", 1)]),
            "{backend}: analytical wall time"
        );

        let before = query_counts(store);
        drain(
            bind(
                store,
                SINGLE,
                ROOMY.options().with_fallback(AnalyticalFallback::Refuse),
            )
            .execute(),
        );
        assert_eq!(
            delta(store, &before),
            outcomes(&[("failed", 1)]),
            "{backend}: refusal"
        );
    });
}

#[cfg(feature = "http-client")]
#[test]
fn analytical_execution_performs_no_egress() {
    on_backends(|backend, store| {
        load_graph(store);
        let observation = HttpServiceObservation::new(16).unwrap();
        let configured = evaluator()
            .with_deny_all_egress_policy()
            .with_http_service_observation(observation.clone());
        for (body, options, disposition) in [
            (TRIANGLE, ROOMY.options(), AnalyticalDisposition::Analytical),
            (
                SINGLE,
                ROOMY.options().with_fallback(AnalyticalFallback::Refuse),
                AnalyticalDisposition::Refused,
            ),
            (
                TRIANGLE,
                Ceilings { work: 1, ..ROOMY }.options(),
                AnalyticalDisposition::Failed,
            ),
        ] {
            let bound = bind_with(configured.clone(), store, body, options);
            let report = bound.report();
            drain(bound.execute());
            assert_eq!(report.snapshot().disposition, disposition, "{backend}");
        }
        assert_eq!(
            observation.snapshot().attempts(),
            0,
            "{backend}: analytical execution attempted egress"
        );
    });
}

#[cfg(feature = "rdf-12")]
#[test]
fn unsupported_sparql_version_is_declined() {
    on_backends(|backend, store| {
        load_graph(store);
        let prepare = || parse(evaluator().with_version(SparqlVersion::V1_1), TRIANGLE);
        let expected = outcome(prepare().on_store(store).execute().unwrap()).unwrap();
        check_declined(
            backend,
            store,
            &prepare,
            ROOMY.options(),
            &expected,
            AnalyticalReason::Version,
        );
    });
}

#[cfg(feature = "rdf-12")]
#[test]
fn triple_terms_use_the_declared_refusal_or_fallback_contract() {
    on_backends(|backend, store| {
        load(
            store,
            "ex:a ex:says <<( ex:x ex:y ex:z )>> . ex:a ex:other ex:b . ex:a ex:says ex:plain .",
        );
        let pattern = "SELECT * WHERE { ?a ex:says <<( ?x ?y ?z )>> . ?a ex:other ?b }";
        let label = format!("{backend}/triple pattern");
        let expected = oracles(&label, store, pattern);
        check_declined(
            &label,
            store,
            &|| parse(evaluator(), pattern),
            ROOMY.options(),
            &expected,
            AnalyticalReason::TripleTerm,
        );

        let stored = "SELECT * WHERE { ?a ?p ?o . ?a ex:other ?b }";
        let label = format!("{backend}/stored triple");
        let expected = oracles(&label, store, stored);
        if backend == "memory" {
            // Materialization reads every quad before any row.
            check_declined(
                &label,
                store,
                &|| parse(evaluator(), stored),
                ROOMY.options(),
                &expected,
                AnalyticalReason::UnsupportedTerm,
            );
        } else {
            // Native relations read no quad at build: the triple term, last in
            // its prefix, is met by a seek after a row was returned. The
            // stream then fails typed under either policy, without replay.
            for fallback in [AnalyticalFallback::Standard, AnalyticalFallback::Refuse] {
                let label = format!("{label}/{fallback:?}");
                let (streamed, snapshot) =
                    run_stream(store, stored, ROOMY.options().with_fallback(fallback));
                assert!(
                    !streamed.rows.is_empty(),
                    "{label}: the triple term was met before the first row"
                );
                assert_failed_stream(
                    &label,
                    streamed,
                    &snapshot,
                    expected.rows(),
                    AnalyticalExecutionError::Refused(AnalyticalReason::UnsupportedTerm),
                    AnalyticalReason::UnsupportedTerm,
                );
            }
        }
    });
}
