//! Public-API recovery test for a finite-RDFS projection whose applied governed cursor fell below
//! retained outbox history (ADR-0032 cursor and recovery gate). Expired catch-up must fail closed
//! before and after an orderly reopen; only an explicit full rebuild may supply strict answers
//! again. Answers are compared with an independent full closure of the quiescent primary.
//!
//! Reopen here releases every handle in order. It is not abrupt-exit, syscall-fault, page-cache
//! loss or power-loss evidence.
#![cfg(all(
    unix,
    feature = "rdfs",
    feature = "rocksdb",
    not(target_family = "wasm")
))]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration-test entry points live at the crate root"
)]

use oxigraph::model::vocab::{rdf, rdfs};
use oxigraph::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::sparql::{
    BoundEntailmentProjectionSparqlQuery, PreparedSparqlQuery, QueryEntailment,
    QueryEntailmentDataset, QueryEntailmentOptions, QueryEntailmentProjectionOptions, QueryResults,
    QuerySolution, SparqlEvaluator,
};
use oxigraph::store::{
    CommitReceipt, DerivedError, DerivedGenerationError, DerivedGenerationLimits, DerivedIndex,
    DerivedSnapshot, EntailmentProjectionHydrationLimits, EntailmentProjectionLimits,
    EntailmentProjectionProvider, EntailmentProjectionState, GovernanceTime, OutboxCursor,
    OutboxReadError, OutboxRetentionPolicy, Store, TransactionKey, TransactionRequest,
    TransactionStartControl, WritableDataset, entailment_projection_identity,
};
use std::collections::BTreeSet;
use std::fmt::Display;
use std::num::{NonZeroU16, NonZeroU64, NonZeroUsize};

type Res<T = ()> = Result<T, String>;

const ASK_FIDO_ANIMAL: &str = "ASK { <urn:test:fido> a <urn:test:Animal> }";
const ALL_QUADS: &str = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
const SUBJECTS: &str = "SELECT ?s WHERE { ?s ?p ?o }";
const GRAPHS: &str = "SELECT ?g WHERE { GRAPH ?g { } }";
/// Explicit caller ceilings: generous for this fixture, but finite and supplied by the caller.
const MAX_RECORDS: u64 = 1_000_000;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;

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

fn err_of<T>(result: Result<T, DerivedGenerationError>) -> Res<DerivedGenerationError> {
    match result {
        Ok(_) => Err("expected an error but the operation succeeded".to_owned()),
        Err(error) => Ok(error),
    }
}

fn nonzero(value: u64) -> Res<NonZeroU64> {
    NonZeroU64::new(value).ok_or_else(|| "zero ceiling".to_owned())
}

// ---------------------------------------------------------------- vocabulary

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:test:{local}"))
}

fn type_of(subject: &str, class: &str) -> Quad {
    Quad::new(iri(subject), rdf::TYPE, iri(class), GraphName::DefaultGraph)
}

fn dog_animal() -> Quad {
    Quad::new(
        iri("Dog"),
        rdfs::SUB_CLASS_OF,
        iri("Animal"),
        GraphName::DefaultGraph,
    )
}

fn key(id: u8) -> TransactionKey {
    TransactionKey::new([id; 16])
}

fn time(millis: u64) -> GovernanceTime {
    GovernanceTime::from_unix_millis(millis)
}

// ------------------------------------------------------------ store helpers

fn commit(
    store: &Store,
    id: u8,
    graphs: &[NamedOrBlankNode],
    removed: &[Quad],
    added: &[Quad],
) -> Res<CommitReceipt> {
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), key(id))
        .ctx("start governed transaction")?
        .into_transaction();
    for graph in graphs {
        tx.insert_named_graph(graph.clone())
            .ctx("declare named graph")?;
    }
    for quad in removed {
        tx.remove(quad).ctx("remove")?;
    }
    for quad in added {
        tx.insert(quad.clone()).ctx("insert")?;
    }
    tx.commit().ctx("commit")
}

fn snapshot(store: &Store) -> Res<DerivedSnapshot> {
    store
        .derived_snapshot(&TransactionStartControl::new())
        .ctx("derived snapshot")
}

fn active_fingerprint(index: &DerivedIndex, limits: &DerivedGenerationLimits) -> Res<[u8; 32]> {
    Ok(index.active(limits).ctx("active generation")?.fingerprint())
}

/// Catch-up must stop at the exact retained whole-commit boundary, never guess past it.
fn expect_cursor_expired<T>(
    result: Result<T, DerivedGenerationError>,
    boundary: &OutboxCursor,
    case: &str,
) -> Res {
    match err_of(result)? {
        DerivedGenerationError::Input(DerivedError::Outbox(OutboxReadError::CursorExpired {
            retained_after,
        })) => ensure(
            &retained_after == boundary,
            &format!("{case}: expiry boundary {retained_after:?}, expected {boundary:?}"),
        ),
        other => Err(format!("{case}: expected CursorExpired, got {other}")),
    }
}

#[derive(Debug, Eq, PartialEq)]
struct Primary {
    quads: BTreeSet<String>,
    graphs: BTreeSet<String>,
    namespaces: Vec<String>,
}

fn primary(store: &Store) -> Res<Primary> {
    let mut quads = BTreeSet::new();
    for quad in store {
        quads.insert(quad.ctx("read primary quad")?.to_string());
    }
    let mut graphs = BTreeSet::new();
    for graph in store.named_graphs() {
        graphs.insert(graph.ctx("read primary graph")?.to_string());
    }
    let mut namespaces = Vec::new();
    for entry in store.namespaces() {
        let entry = entry.ctx("read namespace")?;
        namespaces.push(format!("{}={}", entry.prefix(), entry.iri()));
    }
    Ok(Primary {
        quads,
        graphs,
        namespaces,
    })
}

// ------------------------------------------------------------ query helpers

fn rdfs_options() -> QueryEntailmentOptions {
    QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite)
}

fn prepare(query: &str) -> Res<PreparedSparqlQuery> {
    SparqlEvaluator::new().parse_query(query).ctx("parse query")
}

/// Ordinary query-time full finite-RDFS materialization over the live Store.
fn oracle(store: &Store, query: &str) -> Res<QueryResults<'static>> {
    prepare(query)?
        .on_store_with_entailment(store, &rdfs_options())
        .ctx("ordinary RDFS entailment binding")?
        .execute()
        .ctx("ordinary RDFS entailment execution")
}

/// Plain simple-entailment Store query: primary RDF only.
fn primary_query(store: &Store, query: &str) -> Res<QueryResults<'static>> {
    prepare(query)?
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

fn diff(what: &str, expected: &BTreeSet<String>, actual: &BTreeSet<String>) -> Res {
    if expected == actual {
        return Ok(());
    }
    let missing: Vec<_> = expected.difference(actual).take(4).collect();
    let extra: Vec<_> = actual.difference(expected).take(4).collect();
    Err(format!(
        "{what} diverged; missing {missing:?}; unexpected {extra:?}"
    ))
}

fn same_rows(what: &str, expected: &[String], actual: &[String]) -> Res {
    if expected == actual {
        return Ok(());
    }
    let expected_set: BTreeSet<_> = expected.iter().cloned().collect();
    let actual_set: BTreeSet<_> = actual.iter().cloned().collect();
    diff(what, &expected_set, &actual_set)?;
    Err(format!(
        "{what}: multiplicity differs; expected {} rows, got {}",
        expected.len(),
        actual.len()
    ))
}

fn projection_options(required: &DerivedSnapshot) -> Res<QueryEntailmentProjectionOptions> {
    Ok(QueryEntailmentProjectionOptions::new(
        QueryEntailment::Rdfs12Finite,
        required.checkpoint().clone(),
        EntailmentProjectionHydrationLimits::new(
            nonzero(MAX_RECORDS)?,
            nonzero(MAX_RECORDS)?,
            nonzero(MAX_BYTES)?,
            nonzero(MAX_BYTES)?,
        ),
        nonzero(MAX_RECORDS)?,
        nonzero(MAX_BYTES)?,
    ))
}

/// Executes and requires the result envelope to carry the binding provenance.
fn run(bound: &BoundEntailmentProjectionSparqlQuery) -> Res<QueryResults<'_>> {
    match bound.execute() {
        Ok(results) => {
            ensure(
                results.context() == bound.context(),
                "result envelope lost the binding context",
            )?;
            Ok(results.into_results())
        }
        Err(error) => {
            ensure(
                error.context() == bound.context(),
                "execution error lost the binding context",
            )?;
            Err(format!("projection execution: {error}"))
        }
    }
}

/// The binding names exactly the admitted generation, checkpoint and profile.
fn exact_provenance(
    bound: &BoundEntailmentProjectionSparqlQuery,
    source: &DerivedSnapshot,
    fingerprint: &[u8; 32],
    case: &str,
) -> Res {
    let context = bound.context();
    ensure(
        context.requested_profile() == QueryEntailment::Rdfs12Finite
            && context.required_checkpoint() == source.checkpoint(),
        &format!("{case}: requested profile or required checkpoint not recorded"),
    )?;
    ensure(
        context.source_checkpoint() == Some(source.checkpoint())
            && context.applied_checkpoint() == Some(source.checkpoint()),
        &format!("{case}: source or applied checkpoint differs from the admitted snapshot"),
    )?;
    ensure(
        context.generation_fingerprint() == Some(fingerprint),
        &format!("{case}: generation fingerprint differs from the admitted generation"),
    )?;
    ensure(
        context.build_limits() == Some(EntailmentProjectionLimits::default()),
        &format!("{case}: stored build limits not recorded"),
    )?;
    let snapshot = bound.snapshot();
    ensure(
        snapshot.profile() == QueryEntailment::Rdfs12Finite
            && snapshot.source_checkpoint() == source.checkpoint()
            && snapshot.applied_checkpoint() == source.checkpoint()
            && snapshot.generation_fingerprint() == fingerprint,
        &format!("{case}: hydrated snapshot provenance differs from the binding context"),
    )
}

fn host(graph: &GraphName) -> Option<NamedOrBlankNode> {
    match graph {
        GraphName::NamedNode(name) => Some(name.clone().into()),
        GraphName::BlankNode(name) => Some(name.clone().into()),
        GraphName::DefaultGraph => None,
    }
}

/// Independent visible-dataset expectation: the full closure plus primary graph declarations.
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

// -------------------------------------------------------------------- test

#[test]
fn expired_projection_cursor_rebuilds_after_reopen_and_supplies_strict_queries() -> Res {
    let dir = tempfile::tempdir().ctx("tempdir")?;
    let db_path = dir.path().join("db");
    let index_path = dir.path().join("index");
    let provider = EntailmentProjectionProvider::default();
    let limits = DerivedGenerationLimits::default();
    let fido_animal = type_of("fido", "Animal");
    let empty = NamedOrBlankNode::from(iri("empty"));

    // ---- C1 and the first strict generation G1.
    let store = Store::open(&db_path).ctx("open store")?;
    store
        .configure_outbox_retention(
            OutboxRetentionPolicy::new(nonzero(100)?, NonZeroU16::MIN).ctx("retention policy")?,
            time(1),
        )
        .ctx("configure retention")?;
    let c1 = commit(
        &store,
        1,
        &[empty.clone()],
        &[],
        &[dog_animal(), type_of("fido", "Dog")],
    )?;
    let mut index =
        DerivedIndex::create(&index_path, entailment_projection_identity()).ctx("create index")?;
    let s1 = snapshot(&store)?;
    ensure(
        s1.checkpoint().latest_receipt() == Some(&c1),
        "C1 is not the latest governed receipt of the G1 source",
    )?;
    let g1 = index.rebuild(&s1, &provider, &limits).ctx("rebuild G1")?;
    index
        .activate(&g1, &s1, &provider, &limits)
        .ctx("activate G1")?;
    let g1_fingerprint = g1.fingerprint();
    ensure(g1.source() == s1.checkpoint(), "G1 is not bound to C1")?;

    let view = index.strict(&s1, &limits).ctx("strict G1 view")?;
    let bound_g1 = prepare(ASK_FIDO_ANIMAL)?
        .on_entailment_projection(&view, &projection_options(&s1)?)
        .ctx("bind G1 query")?;
    exact_provenance(&bound_g1, &s1, &g1_fingerprint, "G1")?;
    ensure(
        boolean(run(&bound_g1)?)?,
        "G1 lacks the fido Animal subclass entailment",
    )?;
    ensure(
        !store.contains(&fido_animal).ctx("primary membership")?,
        "inferred quad leaked into primary RDF",
    )?;
    ensure(
        !boolean(primary_query(&store, ASK_FIDO_ANIMAL)?)?,
        "primary RDF alone answers the G1 inference; the check is vacuous",
    )?;
    drop(bound_g1);
    drop(view);
    drop(s1);

    // ---- C2 retracts the schema, C3 is header-only, then retention expires C1 and C2.
    let c2 = commit(&store, 2, &[], &[dog_animal()], &[type_of("rex", "Dog")])?;
    let c3 = commit(&store, 3, &[], &[], &[])?;
    ensure(c3.effect_count() == 0, "C3 is not a header-only commit")?;
    ensure(
        c1.sequence() == 1 && c2.sequence() == 2 && c3.sequence() == 3,
        "unexpected governed receipt sequences",
    )?;
    let boundary = c2
        .outbox_end_cursor()
        .ok_or("C2 has no outbox end cursor")?;
    let batch = NonZeroUsize::new(100).ok_or("zero maintenance limit")?;
    let first = store
        .maintain_outbox(&boundary, batch, time(2))
        .ctx("first maintenance")?;
    ensure(
        first.expired_receipt_sequence() == Some(1),
        &format!(
            "first maintenance expired {:?}, expected C1",
            first.expired_receipt_sequence()
        ),
    )?;
    ensure(
        first.retained_after() == c1.outbox_end_cursor().as_ref(),
        "first maintenance did not stop at the C1 whole-commit boundary",
    )?;
    let second = store
        .maintain_outbox(&boundary, batch, time(3))
        .ctx("second maintenance")?;
    ensure(
        second.expired_receipt_sequence() == Some(2),
        &format!(
            "second maintenance expired {:?}, expected C2",
            second.expired_receipt_sequence()
        ),
    )?;
    ensure(
        second.retained_after() == Some(&boundary),
        "retention did not end at the C2 whole-commit boundary",
    )?;

    let current = snapshot(&store)?;
    ensure(
        current.checkpoint().retained_after() == Some(&boundary),
        "current snapshot does not retain after C2",
    )?;
    ensure(
        current.checkpoint().latest_receipt() == Some(&c3),
        "current snapshot does not end at C3",
    )?;
    expect_cursor_expired(
        index.catch_up(&current, &provider, &limits),
        &boundary,
        "catch-up before reopen",
    )?;
    ensure(
        active_fingerprint(&index, &limits)? == g1_fingerprint,
        "failed catch-up replaced ACTIVE G1",
    )?;
    let error = err_of(index.strict(&current, &limits))?;
    ensure(
        matches!(error, DerivedGenerationError::NotFresh),
        &format!("strict G1 against the current snapshot returned {error}"),
    )?;

    // ---- Orderly release of every handle, then reopen.
    drop(current);
    drop(g1);
    drop(index);
    drop(store);

    let store = Store::open(&db_path).ctx("reopen store")?;
    let mut index =
        DerivedIndex::open(&index_path, entailment_projection_identity()).ctx("reopen index")?;
    ensure(
        !index.recovered_pending_activation(),
        "reopen discarded an unexpected pending activation",
    )?;
    let active = index.active(&limits).ctx("reopened ACTIVE")?;
    ensure(
        active.fingerprint() == g1_fingerprint,
        "reopened ACTIVE is not G1",
    )?;
    let state = EntailmentProjectionState::load(active.files()).ctx("load reopened G1")?;
    ensure(
        state.last_receipt_sequence() == Some(c1.sequence())
            && state.last_commit_id().as_ref() == Some(c1.commit_id()),
        "reopened G1 state is not at the C1 receipt",
    )?;
    drop(state);
    drop(active);

    let reopened = snapshot(&store)?;
    ensure(
        reopened.checkpoint().retained_after() == Some(&boundary)
            && reopened.checkpoint().latest_receipt() == Some(&c3),
        "reopened snapshot lost the retention boundary or C3",
    )?;
    expect_cursor_expired(
        index.catch_up(&reopened, &provider, &limits),
        &boundary,
        "catch-up after reopen",
    )?;
    ensure(
        active_fingerprint(&index, &limits)? == g1_fingerprint,
        "failed catch-up after reopen replaced ACTIVE G1",
    )?;
    let error = err_of(index.strict(&reopened, &limits))?;
    ensure(
        matches!(error, DerivedGenerationError::NotFresh),
        &format!("strict G1 after reopen returned {error}"),
    )?;

    // ---- Explicit full rebuild from the reopened primary.
    let before = primary(&store)?;
    let checkpoint = reopened.checkpoint().clone();
    ensure(
        !store.contains(&dog_animal()).ctx("primary membership")?
            && store
                .contains(&type_of("rex", "Dog"))
                .ctx("primary membership")?
            && store
                .contains_named_graph(&empty)
                .ctx("primary graph membership")?,
        "reopened primary does not reflect C1 through C3",
    )?;
    let recovered = index
        .rebuild(&reopened, &provider, &limits)
        .ctx("explicit rebuild")?;
    index
        .activate(&recovered, &reopened, &provider, &limits)
        .ctx("activate recovered generation")?;
    let recovered_fingerprint = recovered.fingerprint();
    ensure(
        recovered.base_fingerprint().is_none(),
        "recovered generation claims an incremental base",
    )?;
    ensure(
        recovered_fingerprint != g1_fingerprint,
        "recovered generation reuses the G1 fingerprint",
    )?;
    ensure(
        recovered.source() == reopened.checkpoint(),
        "recovered generation is not bound to the reopened checkpoint",
    )?;
    ensure(
        active_fingerprint(&index, &limits)? == recovered_fingerprint,
        "ACTIVE is not the recovered generation",
    )?;
    let state = EntailmentProjectionState::load(recovered.files()).ctx("load recovered")?;
    ensure(
        state.last_receipt_sequence() == Some(c3.sequence())
            && state.last_commit_id().as_ref() == Some(c3.commit_id())
            && state.store_identity().as_ref() == Some(c3.store_identity()),
        "recovered state cursor is not the C3 receipt",
    )?;
    drop(state);

    // ---- Strict public queries against the recovered generation.
    let view = index
        .strict(&reopened, &limits)
        .ctx("strict recovered view")?;
    ensure(
        !view.is_eventual() && view.generation().fingerprint() == recovered_fingerprint,
        "strict view did not admit the recovered generation",
    )?;
    let options = projection_options(&reopened)?;
    let bind = |query: &str| -> Res<BoundEntailmentProjectionSparqlQuery> {
        prepare(query)?
            .on_entailment_projection(&view, &options)
            .ctx("bind recovered projection query")
    };

    let (oracle_graphs, oracle_quads) = oracle_visible(&store)?;
    let ask = bind(ASK_FIDO_ANIMAL)?;
    exact_provenance(&ask, &reopened, &recovered_fingerprint, "recovered ASK")?;
    let (graphs, quads) = visible_contents(ask.visible_dataset());
    diff("visible named-graph topology", &oracle_graphs, &graphs)?;
    diff("visible quads", &oracle_quads, &quads)?;
    ensure(
        graphs.contains(&empty.to_string()),
        "visible topology lost the empty named graph",
    )?;
    ensure(
        !quads.contains(&fido_animal.to_string()),
        "retracted fido Animal entailment is still visible",
    )?;
    ensure(
        quads.contains(&type_of("rex", "Dog").to_string()),
        "C2 primary quad missing from the visible dataset",
    )?;
    ensure(
        !boolean(oracle(&store, ASK_FIDO_ANIMAL)?)?,
        "ordinary RDFS oracle still entails fido Animal after schema removal",
    )?;
    ensure(
        !boolean(run(&ask)?)?,
        "recovered projection still entails fido Animal after schema removal",
    )?;

    for query in [ALL_QUADS, GRAPHS, SUBJECTS] {
        let expected = rows_of(oracle(&store, query)?)?;
        ensure(
            !expected.is_empty(),
            &format!("{query}: oracle answer is vacuous"),
        )?;
        if query == SUBJECTS {
            ensure(
                expected.windows(2).any(|pair| pair[0] == pair[1]),
                "subject-projection oracle must contain duplicate rows",
            )?;
        }
        let bound = bind(query)?;
        exact_provenance(&bound, &reopened, &recovered_fingerprint, query)?;
        let actual = rows_of(run(&bound)?)?;
        same_rows(query, &expected, &actual)?;
        if query == GRAPHS {
            ensure(
                actual.iter().any(|row| row == "?g=<urn:test:empty>"),
                &format!("empty named graph missing from GRAPH topology: {actual:?}"),
            )?;
        }
    }
    drop(ask);
    drop(view);

    // ---- Rebuild, binding and execution never wrote the primary.
    ensure(
        primary(&store)? == before,
        "rebuild, binding or execution changed primary quads, topology or namespaces",
    )?;
    ensure(
        snapshot(&store)?.checkpoint() == &checkpoint,
        "rebuild, binding or execution changed the primary checkpoint",
    )?;
    ensure(
        !store.contains(&fido_animal).ctx("primary membership")?,
        "inferred quad leaked into primary RDF",
    )
}
