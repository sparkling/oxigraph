//! Public-API tests for strict SPARQL queries bound to one admitted finite-RDFS projection
//! generation. Answers are compared with ordinary Store query-time entailment, the full finite
//! RDFS snapshot oracle, and with plain Store queries; never with private binding internals.
#![cfg(all(feature = "rdfs", feature = "rocksdb", not(target_family = "wasm")))]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration-test entry points live at the crate root"
)]

use oxigraph::model::vocab::{rdf, rdfs};
use oxigraph::model::{
    BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term, Triple,
};
use oxigraph::sparql::{
    BoundEntailmentProjectionSparqlQuery, CancellationToken, PreparedSparqlQuery,
    QueryDatasetSpecification, QueryEntailment, QueryEntailmentDataset, QueryEntailmentOptions,
    QueryEntailmentProjectionError, QueryEntailmentProjectionErrorKind,
    QueryEntailmentProjectionOptions, QueryEntailmentProjectionResource, QueryEvaluationError,
    QueryResults, QuerySolution, SparqlEvaluator,
};
use oxigraph::store::{
    ContributorIdentity, DerivedFiles, DerivedGenerationError, DerivedGenerationLimits,
    DerivedIndex, DerivedLimits, DerivedProvider, DerivedSnapshot, DerivedWriter,
    EntailmentProjectionHydrationLimits, EntailmentProjectionHydrationResource,
    EntailmentProjectionLimits, EntailmentProjectionProvider, Store, TransactionStartControl,
    entailment_projection_identity,
};
use std::collections::BTreeSet;
use std::fmt::Display;
use std::num::{NonZeroU32, NonZeroU64};
use std::time::{Duration, Instant};

type Res<T = ()> = Result<T, String>;
type Binding = Result<BoundEntailmentProjectionSparqlQuery, QueryEntailmentProjectionError>;
type Kind = QueryEntailmentProjectionErrorKind;

const FILES: [&str; 3] = ["meta", "image", "inferred"];
const WIDE: EntailmentProjectionHydrationLimits = EntailmentProjectionHydrationLimits {
    max_source_records: NonZeroU64::MAX,
    max_inferred_records: NonZeroU64::MAX,
    max_payload_bytes: NonZeroU64::MAX,
    max_estimated_bytes: NonZeroU64::MAX,
};
const ASK_FIDO_ANIMAL: &str = "ASK { <urn:test:fido> a <urn:test:Animal> }";
const TYPES: &str = "SELECT ?x ?c WHERE { ?x a ?c }";
const EMPTY_SELECT: &str = "SELECT ?x WHERE { ?x a <urn:test:Nothing> }";

const ORACLE_SELECTS: [&str; 11] = [
    TYPES,
    "SELECT ?x WHERE { ?x a ?c }",
    "SELECT ?s ?p ?o WHERE { ?s ?p ?o }",
    "SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } }",
    "SELECT ?g ?x ?c WHERE { GRAPH ?g { ?x a ?c } }",
    "SELECT ?g WHERE { GRAPH ?g { } }",
    "SELECT ?x WHERE { { ?x a <urn:test:Animal> } UNION { GRAPH ?g { ?x a <urn:test:Animal> } } }",
    "SELECT ?x ?g WHERE { GRAPH ?g { ?x a <urn:test:Animal> } FILTER(isBlank(?g)) }",
    "SELECT ?x WHERE { ?x a <urn:test:Person> }",
    "SELECT ?o WHERE { <urn:test:a> <urn:test:says> ?o }",
    "SELECT ?g (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g",
];

/// Hand-derived finite-RDFS answers; the ordinary oracle must agree before the projection is judged.
const ORACLE_ASKS: [(&str, bool); 10] = [
    (ASK_FIDO_ANIMAL, true),
    // Canonical default: the default graph is the physical default graph, not the union.
    ("ASK { <urn:test:rex> a <urn:test:Animal> }", false),
    (
        "ASK { GRAPH <urn:test:g1> { <urn:test:rex> a <urn:test:Animal> } }",
        true,
    ),
    (
        "ASK { GRAPH <urn:test:g1> { <urn:test:rex> a <urn:test:Pet> } }",
        true,
    ),
    // Graph-local: Cat subClassOf Animal lives only in the default graph.
    (
        "ASK { GRAPH <urn:test:g2> { <urn:test:tom> a <urn:test:Animal> } }",
        false,
    ),
    ("ASK { GRAPH <urn:test:empty> { } }", true),
    ("ASK { GRAPH <urn:test:missing> { } }", false),
    ("ASK { <urn:test:a> a <urn:test:Speaker> }", true),
    ("ASK { ?b a <urn:test:Person> FILTER(isBlank(?b)) }", true),
    (
        "ASK { GRAPH ?g { ?b a <urn:test:Animal> } FILTER(isBlank(?b) && isBlank(?g)) }",
        true,
    ),
];

trait Ctx<T> {
    fn ctx(self, what: &str) -> Res<T>;
}

impl<T, E: Display> Ctx<T> for Result<T, E> {
    fn ctx(self, what: &str) -> Res<T> {
        self.map_err(|error| format!("{what}: {error}"))
    }
}

fn ensure(condition: bool, message: &str) -> Res {
    if condition {
        Ok(())
    } else {
        Err(message.to_owned())
    }
}

fn nonzero(value: u64) -> Res<NonZeroU64> {
    NonZeroU64::new(value).ok_or_else(|| "fixture measured a zero resource".to_owned())
}

// ---------------------------------------------------------------- vocabulary

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:test:{local}"))
}

fn nested_object() -> Triple {
    Triple::new(
        iri("s"),
        iri("q"),
        Triple::new(iri("x"), iri("y"), iri("z")),
    )
}

fn seed() -> Vec<Quad> {
    let default = GraphName::DefaultGraph;
    let g1 = GraphName::from(iri("g1"));
    let g2 = GraphName::from(iri("g2"));
    let bg = GraphName::from(BlankNode::new_unchecked("bg"));
    let b1 = BlankNode::new_unchecked("b1");
    vec![
        Quad::new(
            iri("Dog"),
            rdfs::SUB_CLASS_OF,
            iri("Animal"),
            default.clone(),
        ),
        Quad::new(
            iri("Cat"),
            rdfs::SUB_CLASS_OF,
            iri("Animal"),
            default.clone(),
        ),
        Quad::new(iri("fido"), rdf::TYPE, iri("Dog"), default.clone()),
        Quad::new(iri("knows"), rdfs::RANGE, iri("Person"), default.clone()),
        Quad::new(iri("fido"), iri("knows"), b1.clone(), default.clone()),
        Quad::new(
            b1.clone(),
            iri("knows"),
            BlankNode::new_unchecked("b2"),
            default.clone(),
        ),
        Quad::new(iri("says"), rdfs::DOMAIN, iri("Speaker"), default.clone()),
        Quad::new(iri("a"), iri("says"), nested_object(), default),
        Quad::new(iri("Dog"), rdfs::SUB_CLASS_OF, iri("Animal"), g1.clone()),
        Quad::new(iri("Dog"), rdfs::SUB_CLASS_OF, iri("Pet"), g1.clone()),
        Quad::new(iri("rex"), rdf::TYPE, iri("Dog"), g1),
        Quad::new(iri("tom"), rdf::TYPE, iri("Cat"), g2),
        Quad::new(iri("Dog"), rdfs::SUB_CLASS_OF, iri("Animal"), bg.clone()),
        Quad::new(b1, rdf::TYPE, iri("Dog"), bg),
    ]
}

// ------------------------------------------------------------ query helpers

fn rdfs_options() -> QueryEntailmentOptions {
    QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite)
}

fn prepare(query: &str, token: Option<&CancellationToken>) -> Res<PreparedSparqlQuery> {
    let mut evaluator = SparqlEvaluator::new();
    if let Some(token) = token {
        evaluator = evaluator.with_cancellation_token(token.clone());
    }
    evaluator.parse_query(query).ctx("parse query")
}

/// Ordinary query-time full finite-RDFS materialization over the live Store.
fn oracle(store: &Store, query: &str) -> Res<QueryResults<'static>> {
    prepare(query, None)?
        .on_store_with_entailment(store, &rdfs_options())
        .ctx("ordinary RDFS entailment binding")?
        .execute()
        .ctx("ordinary RDFS entailment execution")
}

/// Plain simple-entailment Store query: primary RDF only.
fn primary_query(store: &Store, query: &str) -> Res<QueryResults<'static>> {
    prepare(query, None)?
        .on_store(store)
        .execute()
        .ctx("primary Store query")
}

fn render(solution: &QuerySolution) -> String {
    let mut parts: Vec<String> = solution
        .iter()
        .map(|(variable, term)| format!("{variable}={term}"))
        .collect();
    parts.sort();
    parts.join(" ")
}

/// Sorted rendered rows; duplicates are kept so multiplicity is compared.
fn rows_of(results: QueryResults<'_>) -> Res<Vec<String>> {
    let QueryResults::Solutions(solutions) = results else {
        return Err("expected SELECT solutions".to_owned());
    };
    let mut rows = Vec::new();
    for solution in solutions {
        rows.push(render(&solution.ctx("read solution")?));
    }
    rows.sort();
    Ok(rows)
}

fn boolean(results: QueryResults<'_>) -> Res<bool> {
    if let QueryResults::Boolean(answer) = results {
        Ok(answer)
    } else {
        Err("expected an ASK boolean".to_owned())
    }
}

fn same_rows(what: &str, expected: &[String], actual: &[String]) -> Res {
    if expected == actual {
        return Ok(());
    }
    let expected_set: BTreeSet<_> = expected.iter().collect();
    let actual_set: BTreeSet<_> = actual.iter().collect();
    let missing: Vec<_> = expected_set.difference(&actual_set).take(4).collect();
    let extra: Vec<_> = actual_set.difference(&expected_set).take(4).collect();
    Err(format!(
        "{what}: expected {} rows, got {}; missing {missing:?}; unexpected {extra:?}",
        expected.len(),
        actual.len()
    ))
}

fn bound(result: Binding) -> Res<BoundEntailmentProjectionSparqlQuery> {
    result.ctx("bind projection query")
}

fn failure(result: Binding) -> Res<QueryEntailmentProjectionError> {
    match result {
        Ok(_) => Err("expected projection binding to fail but it succeeded".to_owned()),
        Err(error) => Ok(error),
    }
}

/// Executes the bound query and checks that both envelopes carry the binding provenance.
fn projection_execute(
    bound: &BoundEntailmentProjectionSparqlQuery,
) -> Res<Result<QueryResults<'_>, QueryEvaluationError>> {
    match bound.execute() {
        Ok(results) => {
            ensure(
                results.context() == bound.context(),
                "result envelope lost the binding context",
            )?;
            Ok(Ok(results.into_results()))
        }
        Err(error) => {
            ensure(
                error.context() == bound.context(),
                "execution error lost the binding context",
            )?;
            ensure(
                error.to_string() == error.error().to_string(),
                "execution error display differs from its evaluation error",
            )?;
            Ok(Err(error.into_error()))
        }
    }
}

fn run(bound: &BoundEntailmentProjectionSparqlQuery) -> Res<QueryResults<'_>> {
    projection_execute(bound)?.ctx("projection execution")
}

fn options(required: &DerivedSnapshot) -> QueryEntailmentProjectionOptions {
    configured(
        QueryEntailment::Rdfs12Finite,
        required,
        WIDE,
        NonZeroU64::MAX,
        NonZeroU64::MAX,
    )
}

fn configured(
    profile: QueryEntailment,
    required: &DerivedSnapshot,
    hydration: EntailmentProjectionHydrationLimits,
    max_visible_records: NonZeroU64,
    max_visible_estimated_bytes: NonZeroU64,
) -> QueryEntailmentProjectionOptions {
    QueryEntailmentProjectionOptions::new(
        profile,
        required.checkpoint().clone(),
        hydration,
        max_visible_records,
        max_visible_estimated_bytes,
    )
}

/// Only the request is echoed: nothing was observed from a view or a hydrated snapshot.
fn requested_only(
    error: &QueryEntailmentProjectionError,
    profile: QueryEntailment,
    required: &DerivedSnapshot,
    case: &str,
) -> Res {
    let context = error.context();
    ensure(
        context.requested_profile() == profile
            && context.required_checkpoint() == required.checkpoint(),
        &format!("{case}: requested provenance was not echoed"),
    )?;
    ensure(
        context.source_checkpoint().is_none()
            && context.applied_checkpoint().is_none()
            && context.generation_fingerprint().is_none()
            && context.build_limits().is_none(),
        &format!("{case}: provenance observed before admission"),
    )
}

/// View checkpoints were observed, but no generation was hydrated.
fn observed_unhydrated(
    error: &QueryEntailmentProjectionError,
    observed: &DerivedSnapshot,
    case: &str,
) -> Res {
    let context = error.context();
    ensure(
        context.source_checkpoint() == Some(observed.checkpoint())
            && context.applied_checkpoint() == Some(observed.checkpoint()),
        &format!("{case}: observed view checkpoints were not recorded exactly"),
    )?;
    ensure(
        context.generation_fingerprint().is_none() && context.build_limits().is_none(),
        &format!("{case}: hydrated provenance invented for a failed binding"),
    )
}

fn primary_state(store: &Store) -> Res<(BTreeSet<String>, BTreeSet<String>)> {
    let mut quads = BTreeSet::new();
    for quad in store {
        quads.insert(quad.ctx("read primary quad")?.to_string());
    }
    let mut graphs = BTreeSet::new();
    for graph in store.named_graphs() {
        graphs.insert(graph.ctx("read primary graph")?.to_string());
    }
    Ok((quads, graphs))
}

fn host(graph: &GraphName) -> Option<NamedOrBlankNode> {
    match graph {
        GraphName::NamedNode(name) => Some(name.clone().into()),
        GraphName::BlankNode(name) => Some(name.clone().into()),
        GraphName::DefaultGraph => None,
    }
}

/// Independent visible-dataset expectation: the ordinary full closure plus primary topology.
fn oracle_visible(store: &Store) -> Res<(BTreeSet<String>, BTreeSet<String>)> {
    let snapshot =
        QueryEntailmentDataset::from_store(store, &rdfs_options()).ctx("full closure oracle")?;
    let dataset = snapshot.dataset();
    let mut graphs = BTreeSet::new();
    for graph in store.named_graphs() {
        graphs.insert(graph.ctx("read primary graph")?.to_string());
    }
    for graph in dataset.named_graphs() {
        graphs.insert(graph.to_string());
    }
    let mut quads = BTreeSet::new();
    for quad in dataset.iter() {
        if let Some(graph) = host(&quad.graph_name) {
            graphs.insert(graph.to_string());
        }
        quads.insert(quad.to_string());
    }
    Ok((graphs, quads))
}

fn visible_contents(dataset: &Dataset) -> (BTreeSet<String>, BTreeSet<String>) {
    let graphs = dataset
        .named_graphs()
        .map(|graph| graph.to_string())
        .collect();
    let quads = dataset.iter().map(|quad| quad.to_string()).collect();
    (graphs, quads)
}

// ------------------------------------------------------------------ fixture

struct Fixture {
    dir: tempfile::TempDir,
    store: Store,
    index: DerivedIndex,
    provider: EntailmentProjectionProvider,
    limits: DerivedGenerationLimits,
}

impl Fixture {
    fn new() -> Res<Self> {
        let dir = tempfile::tempdir().ctx("tempdir")?;
        let store = Store::open(dir.path().join("db")).ctx("open store")?;
        for quad in seed() {
            store.insert(quad).ctx("insert seed quad")?;
        }
        store
            .insert_named_graph(iri("empty"))
            .ctx("declare empty graph")?;
        let index =
            DerivedIndex::create(dir.path().join("index"), entailment_projection_identity())
                .ctx("create index")?;
        let mut fixture = Self {
            dir,
            store,
            index,
            provider: EntailmentProjectionProvider::default(),
            limits: DerivedGenerationLimits::default(),
        };
        fixture.publish()?;
        Ok(fixture)
    }

    /// Full rebuild and activation of the current primary.
    fn publish(&mut self) -> Res {
        let source = self.snapshot()?;
        let candidate = self
            .index
            .rebuild(&source, &self.provider, &self.limits)
            .ctx("rebuild")?;
        self.index
            .activate(&candidate, &source, &self.provider, &self.limits)
            .ctx("activate")
    }

    fn snapshot(&self) -> Res<DerivedSnapshot> {
        self.store
            .derived_snapshot(&TransactionStartControl::new())
            .ctx("derived snapshot")
    }

    fn active_fingerprint(&self) -> Res<[u8; 32]> {
        Ok(self
            .index
            .active(&self.limits)
            .ctx("active generation")?
            .fingerprint())
    }

    fn bind(
        &self,
        prepared: PreparedSparqlQuery,
        source: &DerivedSnapshot,
        options: &QueryEntailmentProjectionOptions,
    ) -> Res<Binding> {
        let view = self.index.strict(source, &self.limits).ctx("strict view")?;
        Ok(prepared.on_entailment_projection(&view, options))
    }

    fn projection_rows(&self, source: &DerivedSnapshot, query: &str) -> Res<Vec<String>> {
        let bound = bound(self.bind(prepare(query, None)?, source, &options(source))?)?;
        let rows = rows_of(run(&bound)?)?;
        Ok(rows)
    }

    fn projection_ask(&self, source: &DerivedSnapshot, query: &str) -> Res<bool> {
        let bound = bound(self.bind(prepare(query, None)?, source, &options(source))?)?;
        let answer = boolean(run(&bound)?)?;
        Ok(answer)
    }
}

// ------------------------------------------------------ cancellation scenarios

#[derive(Clone, Debug, Eq, PartialEq)]
enum Step {
    Row,
    End,
    Cancelled,
    TimedOut,
    Failed(String),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CancelAt {
    BeforeExecute,
    BeforeFirst,
    AfterFirst,
    AfterEnd,
}

fn error_step(error: &QueryEvaluationError) -> Step {
    match error {
        QueryEvaluationError::Cancelled => Step::Cancelled,
        QueryEvaluationError::TimedOut => Step::TimedOut,
        other => Step::Failed(other.to_string()),
    }
}

fn step(next: Option<Result<QuerySolution, QueryEvaluationError>>) -> Step {
    match next {
        None => Step::End,
        Some(Ok(_)) => Step::Row,
        Some(Err(error)) => error_step(&error),
    }
}

/// Cancels the token at `at` and records every observed step, ending with the first step
/// after cancellation.
fn scenario<'a>(
    token: &CancellationToken,
    at: CancelAt,
    execute: impl FnOnce() -> Res<Result<QueryResults<'a>, QueryEvaluationError>>,
) -> Res<Vec<Step>> {
    if at == CancelAt::BeforeExecute {
        token.cancel();
    }
    let mut steps = Vec::new();
    let mut solutions = match execute()? {
        Ok(QueryResults::Solutions(solutions)) => solutions,
        Ok(_) => return Err("expected SELECT solutions".to_owned()),
        Err(error) => {
            steps.push(error_step(&error));
            return Ok(steps);
        }
    };
    match at {
        CancelAt::BeforeExecute => {}
        CancelAt::BeforeFirst => token.cancel(),
        CancelAt::AfterFirst => {
            steps.push(step(solutions.next()));
            token.cancel();
        }
        CancelAt::AfterEnd => {
            loop {
                let next = step(solutions.next());
                let row = next == Step::Row;
                steps.push(next);
                if !row {
                    break;
                }
            }
            token.cancel();
        }
    }
    steps.push(step(solutions.next()));
    Ok(steps)
}

fn ordinary_steps(store: &Store, query: &str, at: CancelAt) -> Res<Vec<Step>> {
    let token = CancellationToken::new();
    let bound = prepare(query, Some(&token))?
        .on_store_with_entailment(store, &rdfs_options())
        .ctx("ordinary RDFS entailment binding")?;
    scenario(&token, at, move || Ok(bound.execute()))
}

fn projection_steps(
    fx: &Fixture,
    source: &DerivedSnapshot,
    query: &str,
    at: CancelAt,
) -> Res<Vec<Step>> {
    let token = CancellationToken::new();
    let bound = bound(fx.bind(prepare(query, Some(&token))?, source, &options(source))?)?;
    let steps = scenario(&token, at, || projection_execute(&bound))?;
    Ok(steps)
}

// -------------------------------------------------------------------- tests

#[test]
fn canonical_default_answers_match_the_full_rdfs_store_oracle() -> Res {
    let fx = Fixture::new()?;
    let source = fx.snapshot()?;
    for query in ORACLE_SELECTS {
        let expected = rows_of(oracle(&fx.store, query)?)?;
        ensure(
            !expected.is_empty(),
            &format!("{query}: oracle answer is vacuous"),
        )?;
        let bound = bound(fx.bind(prepare(query, None)?, &source, &options(&source))?)?;
        let first = rows_of(run(&bound)?)?;
        same_rows(query, &expected, &first)?;
        let repeated = rows_of(run(&bound)?)?;
        same_rows(&format!("{query} (repeated)"), &expected, &repeated)?;
        let (explained, _explanation) = bound.explain();
        let explained = rows_of(explained.ctx("projection explain")?.into_results())?;
        same_rows(&format!("{query} (explain)"), &expected, &explained)?;
    }
    for (query, answer) in ORACLE_ASKS {
        let expected = boolean(oracle(&fx.store, query)?)?;
        ensure(
            expected == answer,
            &format!("{query}: ordinary RDFS oracle answered {expected}, fixture expects {answer}"),
        )?;
        let actual = fx.projection_ask(&source, query)?;
        ensure(
            actual == answer,
            &format!("{query}: projection answered {actual}, oracle answered {expected}"),
        )?;
    }
    // The expected inference is real: none of these hold over primary RDF alone.
    for query in [
        ASK_FIDO_ANIMAL,
        "ASK { GRAPH <urn:test:g1> { <urn:test:rex> a <urn:test:Animal> } }",
        "ASK { GRAPH <urn:test:g1> { <urn:test:rex> a <urn:test:Pet> } }",
        "ASK { <urn:test:a> a <urn:test:Speaker> }",
        "ASK { ?b a <urn:test:Person> FILTER(isBlank(?b)) }",
    ] {
        ensure(
            !boolean(primary_query(&fx.store, query)?)?,
            &format!("{query}: primary RDF already answers it; the inference check is vacuous"),
        )?;
    }
    Ok(())
}

#[test]
fn multiplicity_blank_identity_nested_terms_and_empty_topology_are_preserved() -> Res {
    let fx = Fixture::new()?;
    let source = fx.snapshot()?;

    // Multiplicity: duplicate solutions are neither collapsed nor invented.
    let multiset = fx.projection_rows(&source, "SELECT ?x WHERE { ?x a ?c }")?;
    let distinct: BTreeSet<_> = multiset.iter().collect();
    ensure(
        multiset.len() > distinct.len(),
        "non-DISTINCT solutions were collapsed",
    )?;
    let fido = "?x=<urn:test:fido>";
    let projected = multiset.iter().filter(|row| row.as_str() == fido).count();
    let primary = rows_of(primary_query(&fx.store, "SELECT ?x WHERE { ?x a ?c }")?)?
        .iter()
        .filter(|row| row.as_str() == fido)
        .count();
    ensure(
        primary == 1 && projected > primary,
        &format!("fido typing multiplicity: primary {primary}, projection {projected}"),
    )?;
    let mut animals = vec![
        "?x=<urn:test:fido>".to_owned(),
        "?x=<urn:test:rex>".to_owned(),
        "?x=_:b1".to_owned(),
    ];
    animals.sort();
    same_rows(
        "Animal members across default and named graphs",
        &animals,
        &fx.projection_rows(
            &source,
            "SELECT ?x WHERE { { ?x a <urn:test:Animal> } UNION { GRAPH ?g { ?x a <urn:test:Animal> } } }",
        )?,
    )?;

    // Legal blank-node graph and term identity: the same primary blank nodes, never relabelled.
    let expected = rows_of(primary_query(
        &fx.store,
        "SELECT ?x ?g WHERE { GRAPH ?g { ?x a <urn:test:Dog> } FILTER(isBlank(?g)) }",
    )?)?;
    ensure(!expected.is_empty(), "fixture lacks a blank-node graph")?;
    same_rows(
        "blank-node graph-local entailment",
        &expected,
        &fx.projection_rows(
            &source,
            "SELECT ?x ?g WHERE { GRAPH ?g { ?x a <urn:test:Animal> } FILTER(isBlank(?g)) }",
        )?,
    )?;
    let expected = rows_of(primary_query(
        &fx.store,
        "SELECT ?x WHERE { ?y <urn:test:knows> ?x }",
    )?)?;
    ensure(expected.len() == 2, "fixture must know two blank nodes")?;
    same_rows(
        "blank-node range entailment",
        &expected,
        &fx.projection_rows(&source, "SELECT ?x WHERE { ?x a <urn:test:Person> }")?,
    )?;

    // Nested RDF 1.2 triple terms survive unchanged.
    same_rows(
        "nested triple term",
        &[format!("?o={}", Term::from(nested_object()))],
        &fx.projection_rows(
            &source,
            "SELECT ?o WHERE { <urn:test:a> <urn:test:says> ?o }",
        )?,
    )?;

    // GRAPH topology keeps the primary-empty graph and the blank graph name.
    let graphs = fx.projection_rows(&source, "SELECT ?g WHERE { GRAPH ?g { } }")?;
    ensure(
        graphs.iter().any(|row| row == "?g=<urn:test:empty>"),
        &format!("empty named graph missing from GRAPH topology: {graphs:?}"),
    )?;
    ensure(
        graphs.iter().any(|row| row == "?g=_:bg"),
        &format!("blank graph name missing from GRAPH topology: {graphs:?}"),
    )?;
    ensure(
        rows_of(primary_query(
            &fx.store,
            "SELECT ?s ?p ?o WHERE { GRAPH <urn:test:empty> { ?s ?p ?o } }",
        )?)?
        .is_empty(),
        "fixture graph <urn:test:empty> is not empty in the primary",
    )?;
    ensure(
        fx.store
            .contains_named_graph(&NamedOrBlankNode::from(iri("empty")))
            .ctx("primary graph membership")?,
        "fixture did not declare the empty graph",
    )
}

#[test]
fn successful_binding_records_exact_generation_provenance_and_isolates_primary() -> Res {
    let fx = Fixture::new()?;
    let before = primary_state(&fx.store)?;
    let source = fx.snapshot()?;
    let checkpoint = source.checkpoint().clone();
    let active = fx.active_fingerprint()?;
    let view = fx.index.strict(&source, &fx.limits).ctx("strict view")?;
    let generation_fingerprint = view.generation().fingerprint();
    let bound =
        bound(prepare(ASK_FIDO_ANIMAL, None)?.on_entailment_projection(&view, &options(&source)))?;

    let context = bound.context();
    ensure(
        context.requested_profile() == QueryEntailment::Rdfs12Finite,
        "requested profile not recorded",
    )?;
    ensure(
        context.required_checkpoint() == &checkpoint,
        "required checkpoint not recorded",
    )?;
    ensure(
        context.source_checkpoint() == Some(&checkpoint),
        "source checkpoint not copied from the admitted view",
    )?;
    ensure(
        context.applied_checkpoint() == Some(view.generation().source())
            && context.applied_checkpoint() == Some(&checkpoint),
        "applied checkpoint not copied from the generation",
    )?;
    ensure(
        context.generation_fingerprint() == Some(&generation_fingerprint)
            && generation_fingerprint == active,
        "generation fingerprint is not the admitted ACTIVE generation",
    )?;
    ensure(
        context.build_limits() == Some(EntailmentProjectionLimits::default()),
        "stored build limits not recorded",
    )?;
    let snapshot = bound.snapshot();
    ensure(
        snapshot.profile() == QueryEntailment::Rdfs12Finite
            && snapshot.source_checkpoint() == &checkpoint
            && snapshot.applied_checkpoint() == &checkpoint
            && snapshot.generation_fingerprint() == &active
            && snapshot.build_limits() == EntailmentProjectionLimits::default(),
        "hydrated snapshot provenance differs from the binding context",
    )?;

    ensure(
        boolean(run(&bound)?)?,
        "projection lacks subclass entailment",
    )?;
    ensure(
        !boolean(primary_query(&fx.store, ASK_FIDO_ANIMAL)?)?,
        "an ordinary Store query sees inferred projection data",
    )?;
    ensure(
        !fx.store
            .contains(&Quad::new(
                iri("fido"),
                rdf::TYPE,
                iri("Animal"),
                GraphName::DefaultGraph,
            ))
            .ctx("primary membership")?,
        "inferred quad written to the primary",
    )?;
    drop(bound);
    drop(view);
    drop(source);
    ensure(
        primary_state(&fx.store)? == before,
        "binding or execution changed primary quads or graph topology",
    )?;
    ensure(
        fx.snapshot()?.checkpoint() == &checkpoint,
        "binding or execution changed the primary checkpoint",
    )?;
    ensure(
        fx.active_fingerprint()? == active,
        "binding or execution changed the ACTIVE generation",
    )
}

#[test]
fn old_generation_answers_survive_primary_commit_new_active_and_payload_replacement() -> Res {
    let mut fx = Fixture::new()?;
    let source_c = fx.snapshot()?;
    let view_c = fx.index.strict(&source_c, &fx.limits).ctx("strict C")?;
    let expected_c = rows_of(oracle(&fx.store, TYPES)?)?;
    let bound_c =
        bound(prepare(TYPES, None)?.on_entailment_projection(&view_c, &options(&source_c)))?;
    same_rows("C before advance", &expected_c, &rows_of(run(&bound_c)?)?)?;
    let context_c = bound_c.context().clone();
    let fingerprint_c = *context_c
        .generation_fingerprint()
        .ok_or("C binding lacks a fingerprint")?;
    let directory_c = view_c.generation().directory().to_owned();

    fx.store
        .insert(Quad::new(
            iri("tom2"),
            rdf::TYPE,
            iri("Dog"),
            GraphName::DefaultGraph,
        ))
        .ctx("primary commit")?;
    fx.publish()?;
    let source_d = fx.snapshot()?;
    ensure(
        source_d.checkpoint() != source_c.checkpoint(),
        "primary did not advance",
    )?;
    let fingerprint_d = fx.active_fingerprint()?;
    ensure(fingerprint_d != fingerprint_c, "ACTIVE did not advance")?;
    let expected_d = rows_of(oracle(&fx.store, TYPES)?)?;
    let tom2 = "?c=<urn:test:Animal> ?x=<urn:test:tom2>";
    ensure(
        expected_d.iter().any(|row| row == tom2) && !expected_c.iter().any(|row| row == tom2),
        "fixture D does not differ from C by a new inference",
    )?;

    same_rows(
        "bound C after advance",
        &expected_c,
        &rows_of(run(&bound_c)?)?,
    )?;
    ensure(
        bound_c.context() == &context_c,
        "bound C provenance changed",
    )?;
    let rebound =
        bound(prepare(TYPES, None)?.on_entailment_projection(&view_c, &options(&source_c)))?;
    same_rows(
        "old admitted view C rebound",
        &expected_c,
        &rows_of(run(&rebound)?)?,
    )?;
    ensure(
        rebound.context() == &context_c,
        "old admitted view mixed C and D provenance",
    )?;

    let view_d = fx.index.strict(&source_d, &fx.limits).ctx("strict D")?;
    let bound_d =
        bound(prepare(TYPES, None)?.on_entailment_projection(&view_d, &options(&source_d)))?;
    same_rows("D", &expected_d, &rows_of(run(&bound_d)?)?)?;
    ensure(
        bound_d.context().generation_fingerprint() == Some(&fingerprint_d)
            && bound_d.context().source_checkpoint() == Some(source_d.checkpoint()),
        "D binding lacks D provenance",
    )?;

    // Exact checkpoints: neither generation answers for the other's commit.
    let error =
        failure(prepare(TYPES, None)?.on_entailment_projection(&view_d, &options(&source_c)))?;
    ensure(
        matches!(error.kind(), Kind::ProjectionNotFresh),
        &format!("required C on view D returned {error}"),
    )?;
    ensure(
        error.context().required_checkpoint() == source_c.checkpoint(),
        "required C not echoed",
    )?;
    observed_unhydrated(&error, &source_d, "required C on view D")?;
    let error =
        failure(prepare(TYPES, None)?.on_entailment_projection(&view_c, &options(&source_d)))?;
    ensure(
        matches!(error.kind(), Kind::ProjectionNotFresh),
        &format!("required D on view C returned {error}"),
    )?;
    observed_unhydrated(&error, &source_c, "required D on view C")?;

    drop(rebound);
    drop(bound_d);
    drop(view_d);
    drop(view_c);
    drop(source_d);
    drop(source_c);
    for name in FILES {
        std::fs::write(directory_c.join(name), b"replaced").ctx("replace C payload")?;
    }
    same_rows(
        "bound C after payload replacement",
        &expected_c,
        &rows_of(run(&bound_c)?)?,
    )?;
    drop(fx);
    same_rows(
        "bound C after store, index and directory release",
        &expected_c,
        &rows_of(run(&bound_c)?)?,
    )?;
    ensure(
        bound_c.context() == &context_c,
        "bound C provenance changed after release",
    )
}

#[test]
fn unsupported_requests_are_rejected_before_payload_io() -> Res {
    let mut fx = Fixture::new()?;
    let source_c = fx.snapshot()?;
    fx.store
        .insert(Quad::new(
            iri("tom2"),
            rdf::TYPE,
            iri("Dog"),
            GraphName::DefaultGraph,
        ))
        .ctx("primary commit")?;
    fx.publish()?;
    let source = fx.snapshot()?;
    let view = fx.index.strict(&source, &fx.limits).ctx("strict view")?;
    let eventual = fx
        .index
        .eventual(&source, &fx.limits)
        .ctx("eventual view")?;
    let other = Store::open(fx.dir.path().join("other")).ctx("open foreign store")?;
    let foreign = other
        .derived_snapshot(&TransactionStartControl::new())
        .ctx("foreign snapshot")?;

    // Every payload is damaged: any rejection below that read it would report Corrupt.
    let directory = view.generation().directory().to_owned();
    for name in FILES {
        std::fs::write(directory.join(name), b"damaged").ctx("damage payload")?;
    }

    let supported = options(&source);
    let mut masked_from = prepare("ASK FROM <urn:test:g1> { ?s ?p ?o }", None)?;
    *masked_from.dataset_mut() = QueryDatasetSpecification::default();
    let mut masked_named = prepare(
        "ASK FROM NAMED <urn:test:g1> { GRAPH ?g { ?s ?p ?o } }",
        None,
    )?;
    *masked_named.dataset_mut() = QueryDatasetSpecification::default();
    let mut union = prepare(ASK_FIDO_ANIMAL, None)?;
    union.dataset_mut().set_default_graph_as_union();
    let mut custom = prepare(ASK_FIDO_ANIMAL, None)?;
    custom
        .dataset_mut()
        .set_default_graph(vec![GraphName::from(iri("g1"))]);
    let mut restricted = prepare(ASK_FIDO_ANIMAL, None)?;
    restricted
        .dataset_mut()
        .set_available_named_graphs(Vec::new());
    let mut duplicated = prepare(ASK_FIDO_ANIMAL, None)?;
    duplicated
        .dataset_mut()
        .set_default_graph(vec![GraphName::DefaultGraph, GraphName::DefaultGraph]);
    for (case, prepared) in [
        (
            "FROM",
            prepare("ASK FROM <urn:test:g1> { ?s ?p ?o }", None)?,
        ),
        (
            "FROM NAMED",
            prepare(
                "ASK FROM NAMED <urn:test:g1> { GRAPH ?g { ?s ?p ?o } }",
                None,
            )?,
        ),
        ("FROM after effective reset", masked_from),
        ("FROM NAMED after effective reset", masked_named),
        ("union default graph", union),
        ("custom default graph", custom),
        ("restricted named graphs", restricted),
        ("duplicate default graph", duplicated),
    ] {
        let error = failure(prepared.on_entailment_projection(&view, &supported))?;
        ensure(
            matches!(error.kind(), Kind::UnsupportedDataset),
            &format!("{case}: returned {error}"),
        )?;
        ensure(
            error.to_string().contains("canonical default dataset"),
            &format!("{case}: unhelpful message {error}"),
        )?;
        requested_only(&error, QueryEntailment::Rdfs12Finite, &source, case)?;
    }

    for profile in [
        QueryEntailment::Simple,
        QueryEntailment::Rdf12Finite,
        QueryEntailment::Owl2RlRdfBounded,
    ] {
        let error = failure(prepare(ASK_FIDO_ANIMAL, None)?.on_entailment_projection(
            &view,
            &configured(profile, &source, WIDE, NonZeroU64::MAX, NonZeroU64::MAX),
        ))?;
        ensure(
            matches!(error.kind(), Kind::UnsupportedProfile { profile: actual } if *actual == profile),
            &format!("{profile}: returned {error}"),
        )?;
        ensure(
            error.to_string().contains(&profile.to_string()),
            &format!("{profile}: message does not name the profile: {error}"),
        )?;
        requested_only(&error, profile, &source, "unsupported profile")?;
    }

    let error =
        failure(prepare(ASK_FIDO_ANIMAL, None)?.on_entailment_projection(&eventual, &supported))?;
    ensure(
        matches!(error.kind(), Kind::UnsupportedConsistency),
        &format!("eventual view returned {error}"),
    )?;
    requested_only(
        &error,
        QueryEntailment::Rdfs12Finite,
        &source,
        "eventual view",
    )?;

    let error = failure(
        prepare(ASK_FIDO_ANIMAL, None)?.on_entailment_projection(&view, &options(&foreign)),
    )?;
    ensure(
        matches!(error.kind(), Kind::Identity),
        &format!("foreign required checkpoint returned {error}"),
    )?;
    ensure(
        error.context().required_checkpoint() == foreign.checkpoint(),
        "foreign required checkpoint not echoed",
    )?;
    observed_unhydrated(&error, &source, "foreign required checkpoint")?;

    let error = failure(
        prepare(ASK_FIDO_ANIMAL, None)?.on_entailment_projection(&view, &options(&source_c)),
    )?;
    ensure(
        matches!(error.kind(), Kind::ProjectionNotFresh),
        &format!("older required checkpoint returned {error}"),
    )?;
    ensure(
        error.to_string().contains("required primary checkpoint"),
        &format!("unhelpful freshness message {error}"),
    )?;
    observed_unhydrated(&error, &source, "older required checkpoint")?;

    // Positive control: a supported request reaches the damaged payload.
    let error =
        failure(prepare(ASK_FIDO_ANIMAL, None)?.on_entailment_projection(&view, &supported))?;
    ensure(
        matches!(error.kind(), Kind::Corrupt),
        &format!("supported request must reach the damaged payload: {error}"),
    )?;
    observed_unhydrated(&error, &source, "damaged payload")
}

#[test]
fn foreign_provider_view_is_an_identity_error_before_hydration() -> Res {
    struct Foreign;
    impl DerivedProvider for Foreign {
        fn identity(&self) -> ContributorIdentity {
            ContributorIdentity::new(*b"oxigraph.foreign", NonZeroU32::MIN)
        }
        fn rebuild(
            &self,
            _: &DerivedSnapshot,
            output: &mut DerivedWriter<'_>,
            _: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            for name in FILES {
                output.write_file(name, b"foreign".as_slice())?;
            }
            Ok(())
        }
        fn reconcile(
            &self,
            _: &DerivedSnapshot,
            _: &DerivedFiles,
            _: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            Ok(())
        }
    }

    let fx = Fixture::new()?;
    let mut index = DerivedIndex::create(fx.dir.path().join("foreign"), Foreign.identity())
        .ctx("create foreign index")?;
    let source = fx.snapshot()?;
    let candidate = index
        .rebuild(&source, &Foreign, &fx.limits)
        .ctx("foreign rebuild")?;
    index
        .activate(&candidate, &source, &Foreign, &fx.limits)
        .ctx("foreign activate")?;
    let view = index
        .strict(&source, &fx.limits)
        .ctx("foreign strict view")?;
    let error = failure(
        prepare(ASK_FIDO_ANIMAL, None)?.on_entailment_projection(&view, &options(&source)),
    )?;
    ensure(
        matches!(error.kind(), Kind::Identity),
        &format!("foreign provider returned {error}"),
    )?;
    ensure(
        error.to_string().contains("finite-RDFS projection"),
        &format!("unhelpful identity message {error}"),
    )?;
    observed_unhydrated(&error, &source, "foreign provider")
}

#[test]
fn visible_copy_ceilings_are_exact_against_the_oracle_dataset() -> Res {
    let fx = Fixture::new()?;
    let source = fx.snapshot()?;
    let (graphs, quads) = oracle_visible(&fx.store)?;
    let (primary_quads, _) = primary_state(&fx.store)?;
    ensure(
        quads.len() > primary_quads.len(),
        "oracle closure adds no inferred quads",
    )?;
    let mut records = 0_u64;
    let mut bytes = 0_u64;
    for value in graphs.iter().chain(quads.iter()) {
        records += 1;
        bytes += 160 + u64::try_from(value.len()).ctx("display length")?;
    }
    let exact = |max_records: u64, max_bytes: u64| -> Res<QueryEntailmentProjectionOptions> {
        Ok(configured(
            QueryEntailment::Rdfs12Finite,
            &source,
            WIDE,
            nonzero(max_records)?,
            nonzero(max_bytes)?,
        ))
    };

    let bound = bound(fx.bind(
        prepare(ASK_FIDO_ANIMAL, None)?,
        &source,
        &exact(records, bytes)?,
    )?)?;
    let (visible_graphs, visible_quads) = visible_contents(bound.visible_dataset());
    ensure(
        visible_graphs == graphs,
        &format!(
            "visible topology diverged from the oracle: missing {:?}, unexpected {:?}",
            graphs
                .difference(&visible_graphs)
                .take(4)
                .collect::<Vec<_>>(),
            visible_graphs
                .difference(&graphs)
                .take(4)
                .collect::<Vec<_>>()
        ),
    )?;
    ensure(
        visible_quads == quads,
        &format!(
            "visible quads diverged from the oracle: missing {:?}, unexpected {:?}",
            quads.difference(&visible_quads).take(4).collect::<Vec<_>>(),
            visible_quads.difference(&quads).take(4).collect::<Vec<_>>()
        ),
    )?;
    ensure(
        visible_graphs.contains(&iri("empty").to_string()) && visible_graphs.contains("_:bg"),
        "visible topology lost the empty or blank graph",
    )?;
    ensure(boolean(run(&bound)?)?, "exact ceilings changed the answer")?;

    for (resource, max_records, max_bytes, ceiling) in [
        (
            QueryEntailmentProjectionResource::VisibleRecords,
            records - 1,
            bytes,
            records - 1,
        ),
        (
            QueryEntailmentProjectionResource::VisibleEstimatedBytes,
            records,
            bytes - 1,
            bytes - 1,
        ),
        // The count is admitted before the estimate of the same record.
        (
            QueryEntailmentProjectionResource::VisibleRecords,
            records - 1,
            bytes - 1,
            records - 1,
        ),
    ] {
        let error = failure(fx.bind(
            prepare(ASK_FIDO_ANIMAL, None)?,
            &source,
            &exact(max_records, max_bytes)?,
        )?)?;
        ensure(
            matches!(
                error.kind(),
                Kind::LimitExceeded { resource: actual, ceiling: reported }
                    if *actual == resource && *reported == ceiling
            ),
            &format!("{resource} ({max_records}, {max_bytes}): returned {error}"),
        )?;
        ensure(
            error
                .to_string()
                .contains(&format!("{resource} ceiling {ceiling}")),
            &format!("unhelpful limit message {error}"),
        )?;
        let context = error.context();
        ensure(
            context.source_checkpoint() == Some(source.checkpoint())
                && context.generation_fingerprint() == Some(&fx.active_fingerprint()?)
                && context.build_limits() == Some(EntailmentProjectionLimits::default()),
            &format!("{resource}: hydrated provenance missing from a visible-copy failure"),
        )?;
    }
    Ok(())
}

#[test]
fn hydration_failures_keep_their_categories_and_partial_provenance() -> Res {
    let fx = Fixture::new()?;
    let source = fx.snapshot()?;
    for (resource, hydration) in [
        (
            EntailmentProjectionHydrationResource::SourceRecords,
            EntailmentProjectionHydrationLimits {
                max_source_records: NonZeroU64::MIN,
                ..WIDE
            },
        ),
        (
            EntailmentProjectionHydrationResource::InferredRecords,
            EntailmentProjectionHydrationLimits {
                max_inferred_records: NonZeroU64::MIN,
                ..WIDE
            },
        ),
        (
            EntailmentProjectionHydrationResource::PayloadBytes,
            EntailmentProjectionHydrationLimits {
                max_payload_bytes: NonZeroU64::MIN,
                ..WIDE
            },
        ),
        (
            EntailmentProjectionHydrationResource::EstimatedBytes,
            EntailmentProjectionHydrationLimits {
                max_estimated_bytes: NonZeroU64::MIN,
                ..WIDE
            },
        ),
    ] {
        let error = failure(fx.bind(
            prepare(ASK_FIDO_ANIMAL, None)?,
            &source,
            &configured(
                QueryEntailment::Rdfs12Finite,
                &source,
                hydration,
                NonZeroU64::MAX,
                NonZeroU64::MAX,
            ),
        )?)?;
        ensure(
            matches!(
                error.kind(),
                Kind::LimitExceeded {
                    resource: QueryEntailmentProjectionResource::Hydration(actual),
                    ceiling: 1,
                } if *actual == resource
            ),
            &format!("{resource}: returned {error}"),
        )?;
        ensure(
            error
                .to_string()
                .contains(&format!("hydration {resource} ceiling 1")),
            &format!("unhelpful hydration limit message {error}"),
        )?;
        observed_unhydrated(&error, &source, "hydration limit")?;
    }

    for name in FILES {
        let source = fx.snapshot()?;
        let view = fx.index.strict(&source, &fx.limits).ctx("strict view")?;
        let path = view.generation().directory().join(name);
        let original = std::fs::read(&path).ctx("read payload")?;
        ensure(original.len() > 8, "payload unexpectedly small")?;
        let mut damaged = original.clone();
        let middle = damaged.len() / 2;
        damaged[middle] ^= 0x55;
        std::fs::write(&path, &damaged).ctx("damage payload")?;
        let result =
            prepare(ASK_FIDO_ANIMAL, None)?.on_entailment_projection(&view, &options(&source));
        std::fs::write(&path, &original).ctx("restore payload")?;
        let error = failure(result)?;
        ensure(
            matches!(error.kind(), Kind::Corrupt),
            &format!("damaged {name} returned {error}"),
        )?;
        ensure(
            error.to_string().contains("corrupt"),
            &format!("unhelpful corruption message {error}"),
        )?;
        observed_unhydrated(&error, &source, name)?;
    }
    ensure(
        fx.projection_ask(&source, ASK_FIDO_ANIMAL)?,
        "restored payloads must bind and answer",
    )
}

#[test]
fn cancellation_and_explicit_deadlines_before_binding_are_exact() -> Res {
    let fx = Fixture::new()?;
    let source = fx.snapshot()?;

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let error = failure(fx.bind(
        prepare(TYPES, Some(&cancelled))?,
        &source,
        &options(&source),
    )?)?;
    ensure(
        matches!(error.kind(), Kind::Cancelled),
        &format!("pre-cancelled token returned {error}"),
    )?;
    ensure(
        error.to_string().contains("cancelled"),
        &format!("unhelpful cancellation message {error}"),
    )?;
    requested_only(
        &error,
        QueryEntailment::Rdfs12Finite,
        &source,
        "pre-cancelled",
    )?;

    // An elapsed absolute deadline is TimedOut, not Cancelled, even under a long relative budget.
    let expired = CancellationToken::new().with_deadline(Instant::now());
    let error = failure(fx.bind(
        prepare(TYPES, Some(&expired))?,
        &source,
        &options(&source).with_timeout(Some(Duration::from_secs(3600))),
    )?)?;
    ensure(
        matches!(error.kind(), Kind::TimedOut),
        &format!("expired absolute deadline returned {error}"),
    )?;
    requested_only(
        &error,
        QueryEntailment::Rdfs12Finite,
        &source,
        "expired deadline",
    )?;

    let error = failure(fx.bind(
        prepare(TYPES, None)?,
        &source,
        &options(&source).with_timeout(Some(Duration::ZERO)),
    )?)?;
    ensure(
        matches!(error.kind(), Kind::TimedOut),
        &format!("zero relative binding timeout returned {error}"),
    )?;
    requested_only(
        &error,
        QueryEntailment::Rdfs12Finite,
        &source,
        "zero timeout",
    )?;
    ensure(
        options(&source)
            .with_timeout(Some(Duration::ZERO))
            .timeout()
            == Some(Duration::ZERO),
        "binding timeout option not retained",
    )?;

    let error = failure(fx.bind(
        prepare(TYPES, Some(&cancelled))?,
        &source,
        &options(&source).with_timeout(Some(Duration::ZERO)),
    )?)?;
    ensure(
        matches!(error.kind(), Kind::Cancelled),
        &format!("explicit cancellation must win over the relative timeout, got {error}"),
    )?;

    // A pending explicit absolute deadline is preserved through binding and execution.
    let deadline =
        CancellationToken::new().with_deadline(Instant::now() + Duration::from_secs(3600));
    let bound = bound(fx.bind(
        prepare(TYPES, Some(&deadline))?,
        &source,
        &options(&source).with_timeout(Some(Duration::from_secs(3600))),
    )?)?;
    ensure(
        deadline.cancellation_reason().is_none(),
        "binding altered the caller token",
    )?;
    same_rows(
        "pending absolute deadline",
        &rows_of(oracle(&fx.store, TYPES)?)?,
        &rows_of(run(&bound)?)?,
    )?;
    // The bound evaluator still observes the same token: explicit cancellation is reported as
    // Cancelled while the deadline is still pending, never as TimedOut.
    let steps = scenario(&deadline, CancelAt::BeforeExecute, || {
        projection_execute(&bound)
    })?;
    ensure(
        steps.last() == Some(&Step::Cancelled) && !steps.contains(&Step::Row),
        &format!("cancelling the deadline token before execution produced {steps:?}"),
    )
}

#[test]
fn cancellation_during_result_iteration_matches_the_ordinary_evaluator() -> Res {
    let fx = Fixture::new()?;
    let source = fx.snapshot()?;
    for query in [TYPES, EMPTY_SELECT] {
        for at in [
            CancelAt::BeforeExecute,
            CancelAt::BeforeFirst,
            CancelAt::AfterFirst,
            CancelAt::AfterEnd,
        ] {
            let expected = ordinary_steps(&fx.store, query, at)?;
            let actual = projection_steps(&fx, &source, query, at)?;
            ensure(
                actual == expected,
                &format!("{query} {at:?}: projection {actual:?}, ordinary evaluator {expected:?}"),
            )?;
            let last = actual.last().ok_or("no step recorded")?;
            ensure(
                matches!(last, Step::Cancelled | Step::End),
                &format!("{query} {at:?}: step after cancellation was {last:?}"),
            )?;
            if query == EMPTY_SELECT {
                ensure(
                    !actual.contains(&Step::Row),
                    &format!("{at:?}: the empty query produced a row: {actual:?}"),
                )?;
            }
        }
    }
    let steps = projection_steps(&fx, &source, TYPES, CancelAt::AfterFirst)?;
    ensure(
        steps == [Step::Row, Step::Cancelled],
        &format!("cancellation during lazy consumption was not observed: {steps:?}"),
    )?;
    let steps = projection_steps(&fx, &source, TYPES, CancelAt::AfterEnd)?;
    let rows = steps.iter().filter(|step| **step == Step::Row).count();
    ensure(
        rows == rows_of(oracle(&fx.store, TYPES)?)?.len(),
        &format!("end-of-stream scenario consumed {rows} rows"),
    )?;
    // Cancellation of one execution never poisons a fresh binding of the same generation.
    same_rows(
        "fresh binding after cancellation",
        &rows_of(oracle(&fx.store, TYPES)?)?,
        &fx.projection_rows(&source, TYPES)?,
    )
}
