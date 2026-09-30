//! Public-API tests for the finite-RDFS projection provider on real derived generations. Every
//! step compares the provider state with an independent full closure of the primary store.
#![cfg(all(feature = "rdfs", feature = "rocksdb", not(target_family = "wasm")))]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration-test entry points live at the crate root"
)]

use oxigraph::model::vocab::{rdf, rdfs};
use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Triple};
use oxigraph::sparql::{QueryEntailment, QueryEntailmentDataset, QueryEntailmentOptions};
use oxigraph::store::{
    BackupError, CommitReceipt, ContributorCheckpoint, ContributorIdentity, DerivedError,
    DerivedFiles, DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedLimits,
    DerivedProvider, DerivedSnapshot, DerivedState, DerivedWriter, EntailmentProjectionLimits,
    EntailmentProjectionProvider, EntailmentProjectionState, GovernedTransaction, Namespace,
    NamespacePrefix, OutboxCursor, Store, TransactionKey, TransactionRequest,
    TransactionStartControl, WritableDataset, WritableNamespaceRegistry,
    entailment_projection_identity,
};
use std::collections::BTreeSet;
use std::fmt::Display;
use std::num::{NonZeroU64, NonZeroUsize};
use std::time::{Duration, Instant};

type Res<T = ()> = Result<T, String>;

const CHAIN: usize = 200;

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

// ---------------------------------------------------------------- vocabulary

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:test:{local}"))
}

fn type_of(subject: &str, class: &str) -> Quad {
    Quad::new(
        iri(subject),
        NamedNode::from(rdf::TYPE),
        iri(class),
        GraphName::DefaultGraph,
    )
}

fn sub_class(child: &str, parent: &str) -> Quad {
    Quad::new(
        iri(child),
        NamedNode::from(rdfs::SUB_CLASS_OF),
        iri(parent),
        GraphName::DefaultGraph,
    )
}

fn with_graph(quad: &Quad, graph: GraphName) -> Quad {
    Quad::new(
        quad.subject.clone(),
        quad.predicate.clone(),
        quad.object.clone(),
        graph,
    )
}

fn graph(local: &str) -> GraphName {
    GraphName::NamedNode(iri(local))
}

fn graph_node(local: &str) -> NamedOrBlankNode {
    iri(local).into()
}

fn blank_graph() -> NamedOrBlankNode {
    NamedOrBlankNode::from(BlankNode::new_unchecked("bg"))
}

fn key(id: u8) -> TransactionKey {
    TransactionKey::new([id; 16])
}

#[derive(Clone, Debug)]
enum Op {
    Insert(Quad),
    Remove(Quad),
    CreateGraph(NamedOrBlankNode),
    ClearGraph(Option<NamedOrBlankNode>),
    DropGraph(NamedOrBlankNode),
    ClearAllNamed,
    ClearAllGraphs,
    DropAllNamed,
    ClearAll,
    SetNamespace(&'static str, NamedNode),
    ClearNamespaces,
}

fn apply_op(tx: &mut GovernedTransaction<'_>, op: &Op) -> Res {
    match op {
        Op::Insert(quad) => tx.insert(quad.clone()).ctx("insert"),
        Op::Remove(quad) => tx.remove(quad).ctx("remove"),
        Op::CreateGraph(name) => tx.insert_named_graph(name.clone()).ctx("create graph"),
        Op::ClearGraph(name) => tx.clear_graph(name.as_ref()).ctx("clear graph"),
        Op::DropGraph(name) => tx.remove_named_graph(name).ctx("drop graph"),
        Op::ClearAllNamed => tx.clear_all_named_graphs().ctx("clear all named"),
        Op::ClearAllGraphs => tx.clear_all_graphs().ctx("clear all graphs"),
        Op::DropAllNamed => tx.remove_all_named_graphs().ctx("drop all named"),
        Op::ClearAll => tx.clear().ctx("clear"),
        Op::SetNamespace(prefix, target) => {
            let prefix = NamespacePrefix::new(*prefix).ctx("namespace prefix")?;
            tx.set_namespace(Namespace::new(prefix, target.clone()))
                .ctx("set namespace")
        }
        Op::ClearNamespaces => tx.clear_namespaces().ctx("clear namespaces"),
    }
}

// ------------------------------------------------ independent primary oracle

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct Primary {
    quads: BTreeSet<String>,
    graphs: BTreeSet<String>,
    namespaces: Vec<String>,
}

fn primary(store: &Store) -> Res<Primary> {
    let mut quads = BTreeSet::new();
    for quad in store {
        quads.insert(quad.ctx("read quad")?.to_string());
    }
    let mut graphs = BTreeSet::new();
    for name in store.named_graphs() {
        graphs.insert(name.ctx("read named graph")?.to_string());
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

/// The state's image, read only through its read-only snapshot accessors.
fn image_of(state: &EntailmentProjectionState) -> Res<Primary> {
    let mut quads = BTreeSet::new();
    for quad in state.image_quads() {
        quads.insert(quad.ctx("read image quad")?.to_string());
    }
    let mut graphs = BTreeSet::new();
    for name in state.image_named_graphs() {
        graphs.insert(name.ctx("read image graph")?.to_string());
    }
    Ok(Primary {
        quads,
        graphs,
        namespaces: Vec::new(),
    })
}

#[derive(Debug, Default)]
struct Closure {
    quads: BTreeSet<String>,
    graphs: BTreeSet<String>,
}

/// Entailed quads and named graphs that are not primary, from the full closure over the store.
fn closure_extra(store: &Store) -> Res<Closure> {
    let snapshot = QueryEntailmentDataset::from_store(
        store,
        &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
    )
    .ctx("full closure oracle")?;
    let dataset = snapshot.dataset();
    let mut quads = BTreeSet::new();
    for quad in dataset {
        if !store.contains(&quad).ctx("primary membership")? {
            quads.insert(quad.to_string());
        }
    }
    let mut graphs = BTreeSet::new();
    for name in dataset.named_graphs() {
        if !store.contains_named_graph(&name).ctx("primary graph")? {
            graphs.insert(name.to_string());
        }
    }
    Ok(Closure { quads, graphs })
}

fn strings<T: Display>(values: &[T]) -> BTreeSet<String> {
    values.iter().map(ToString::to_string).collect()
}

fn diff(what: &str, expected: &BTreeSet<String>, actual: &BTreeSet<String>) -> Res {
    if expected == actual {
        return Ok(());
    }
    let missing: Vec<_> = expected.difference(actual).take(4).collect();
    let extra: Vec<_> = actual.difference(expected).take(4).collect();
    Err(format!(
        "{what} diverged; missing from projection {missing:?}; unexpected in projection {extra:?}"
    ))
}

fn high_water(store: &Store) -> Res<Option<OutboxCursor>> {
    Ok(store
        .read_outbox(None, NonZeroUsize::MIN)
        .ctx("read outbox")?
        .high_water()
        .cloned())
}

// ------------------------------------------------------------------ fixture

struct Fixture {
    dir: tempfile::TempDir,
    store: Store,
    index: DerivedIndex,
    provider: EntailmentProjectionProvider,
    limits: DerivedGenerationLimits,
    keys: u8,
}

impl Fixture {
    fn new() -> Res<Self> {
        Self::with_provider(EntailmentProjectionProvider::default())
    }

    fn with_provider(provider: EntailmentProjectionProvider) -> Res<Self> {
        let dir = tempfile::tempdir().ctx("tempdir")?;
        let store = Store::open(dir.path().join("db")).ctx("open store")?;
        let index =
            DerivedIndex::create(dir.path().join("index"), entailment_projection_identity())
                .ctx("create index")?;
        Ok(Self {
            dir,
            store,
            index,
            provider,
            limits: DerivedGenerationLimits::default(),
            keys: 0,
        })
    }

    fn snapshot(&self) -> Res<DerivedSnapshot> {
        self.store
            .derived_snapshot(&TransactionStartControl::new())
            .ctx("snapshot")
    }

    fn stage(&mut self, ops: &[Op]) -> Res<GovernedTransaction<'_>> {
        self.keys += 1;
        let mut tx = self
            .store
            .start_governed_transaction(TransactionRequest::default(), key(self.keys))
            .ctx("start governed transaction")?
            .into_transaction();
        for op in ops {
            apply_op(&mut tx, op)?;
        }
        Ok(tx)
    }

    fn commit(&mut self, ops: &[Op]) -> Res<CommitReceipt> {
        self.stage(ops)?.commit().ctx("commit")
    }

    fn refresh(&mut self) -> Res {
        let snapshot = self.snapshot()?;
        let candidate = match self.index.active(&self.limits) {
            Ok(_) => self.index.catch_up(&snapshot, &self.provider, &self.limits),
            Err(DerivedGenerationError::Unavailable) => {
                self.index.rebuild(&snapshot, &self.provider, &self.limits)
            }
            Err(error) => return Err(format!("active generation: {error}")),
        }
        .ctx("build candidate")?;
        self.index
            .activate(&candidate, &snapshot, &self.provider, &self.limits)
            .ctx("activate")?;
        self.index
            .strict(&snapshot, &self.limits)
            .ctx("strict view")?;
        Ok(())
    }

    fn state(&self) -> Res<EntailmentProjectionState> {
        let generation = self.index.active(&self.limits).ctx("active generation")?;
        EntailmentProjectionState::load(generation.files()).ctx("load state")
    }

    /// Compares the active generation's state with the primary store and the full closure.
    fn check(&self) -> Res {
        let state = self.state()?;
        let expected = primary(&self.store)?;
        let image = image_of(&state)?;
        diff("image quads", &expected.quads, &image.quads)?;
        diff("image graph topology", &expected.graphs, &image.graphs)?;
        let oracle = closure_extra(&self.store)?;
        let quads = state.inferred_quads().ctx("inferred quads")?;
        diff("inferred quads", &oracle.quads, &strings(&quads))?;
        let graphs = state.inferred_named_graphs().ctx("inferred graphs")?;
        diff("inferred graph topology", &oracle.graphs, &strings(&graphs))?;
        let snapshot = self.snapshot()?;
        ensure(
            state.last_receipt_sequence()
                == snapshot
                    .checkpoint()
                    .latest_receipt()
                    .map(CommitReceipt::sequence),
            "state cursor is not the source's latest receipt",
        )
    }

    fn step(&mut self, ops: &[Op]) -> Res {
        self.commit(ops)?;
        self.refresh()?;
        self.check()
    }

    fn inferred(&self) -> Res<BTreeSet<String>> {
        Ok(strings(
            &self.state()?.inferred_quads().ctx("inferred quads")?,
        ))
    }

    /// A rolled back or dropped governed transaction leaves the outbox and the state unchanged.
    fn discard(&mut self, ops: &[Op], rollback: bool) -> Res {
        let before_cursor = high_water(&self.store)?;
        let before = primary(&self.store)?;
        let tx = self.stage(ops)?;
        if rollback {
            tx.rollback().ctx("rollback")?;
        } else {
            drop(tx);
        }
        ensure(
            high_water(&self.store)? == before_cursor,
            "a non-committed transaction moved the outbox cursor",
        )?;
        ensure(
            primary(&self.store)? == before,
            "a non-committed transaction changed the primary store",
        )?;
        self.refresh()?;
        self.check()
    }
}

fn dog_animal_ops() -> Vec<Op> {
    vec![
        Op::Insert(sub_class("Dog", "Animal")),
        Op::Insert(type_of("fido", "Dog")),
    ]
}

fn checkpoint(receipt: CommitReceipt) -> Res<ContributorCheckpoint> {
    ContributorCheckpoint::new(receipt).ctx("checkpoint")
}

// -------------------------------------------------------------------- tests

#[test]
fn provider_identity_is_sixteen_checked_bytes() -> Res {
    ensure(
        entailment_projection_identity().provider() == b"oxigraph.entrdfs",
        "unexpected provider identity",
    )
}

#[test]
fn projection_matches_full_closure_oracle_after_every_step() -> Res {
    let mut fx = Fixture::new()?;
    // Empty store: axioms only.
    fx.refresh()?;
    fx.check()?;

    let dog = type_of("fido", "Dog");
    let pet = type_of("fido", "Pet");
    let animal = type_of("fido", "Animal").to_string();
    let dog_sub = sub_class("Dog", "Animal");
    let g1 = graph("g1");
    let g1_node = graph_node("g1");

    // The first governed commit establishes lineage. An unidentified generation
    // cannot be caught up across that identity change; explicitly rebuild it.
    fx.commit(&dog_animal_ops())?;
    let snapshot = fx.snapshot()?;
    ensure(
        matches!(
            fx.index.catch_up(&snapshot, &fx.provider, &fx.limits),
            Err(DerivedGenerationError::Identity)
        ),
        "catch-up must refuse the initial lineage change",
    )?;
    let candidate = fx
        .index
        .rebuild(&snapshot, &fx.provider, &fx.limits)
        .ctx("rebuild after lineage establishment")?;
    fx.index
        .activate(&candidate, &snapshot, &fx.provider, &fx.limits)
        .ctx("activate identified generation")?;
    fx.check()?;
    ensure(
        fx.inferred()?.contains(&animal),
        "subclass entailment missing",
    )?;
    ensure(
        !primary(&fx.store)?.quads.contains(&animal),
        "entailed quad leaked into primary",
    )?;

    // alternate support survives one removal, then disappears
    fx.step(&[
        Op::Insert(pet.clone()),
        Op::Insert(sub_class("Pet", "Animal")),
    ])?;
    fx.step(&[Op::Remove(dog.clone())])?;
    ensure(
        fx.inferred()?.contains(&animal),
        "alternate support lost entailment",
    )?;
    fx.step(&[Op::Remove(sub_class("Pet", "Animal"))])?;
    ensure(
        !fx.inferred()?.contains(&animal),
        "entailment survived removal of its last support",
    )?;

    // rollback and drop leave the cursor, the primary and the state unchanged
    fx.discard(
        &[
            Op::Insert(type_of("x", "Dog")),
            Op::CreateGraph(graph_node("g2")),
        ],
        true,
    )?;
    fx.discard(&[Op::Insert(type_of("y", "Dog")), Op::ClearAll], false)?;

    // graph create, clear, drop and recreate
    fx.step(&[
        Op::CreateGraph(g1_node.clone()),
        Op::Insert(with_graph(&dog, g1.clone())),
        Op::Insert(with_graph(&dog_sub, g1.clone())),
    ])?;
    ensure(
        fx.inferred()?
            .contains(&with_graph(&type_of("fido", "Animal"), g1.clone()).to_string()),
        "graph-local entailment missing",
    )?;
    fx.step(&[Op::ClearGraph(Some(g1_node.clone()))])?;
    ensure(
        primary(&fx.store)?.graphs.contains(&g1_node.to_string()),
        "cleared graph must stay as empty topology",
    )?;
    fx.step(&[Op::DropGraph(g1_node.clone())])?;
    fx.step(&[
        Op::CreateGraph(g1_node.clone()),
        Op::Insert(with_graph(&dog, g1.clone())),
    ])?;
    // empty commit: header-only governed group
    fx.step(&[])?;

    // blank nodes, blank graph name and an empty named graph
    let blank_graph_name = GraphName::from(BlankNode::new_unchecked("bg"));
    let blank_type = Quad::new(
        BlankNode::new_unchecked("b1"),
        NamedNode::from(rdf::TYPE),
        iri("Dog"),
        blank_graph_name.clone(),
    );
    fx.step(&[
        Op::CreateGraph(blank_graph()),
        Op::CreateGraph(graph_node("empty")),
        Op::Insert(blank_type.clone()),
        Op::Insert(with_graph(&dog_sub, blank_graph_name.clone())),
        Op::Insert(Quad::new(
            iri("fido"),
            iri("p"),
            BlankNode::new_unchecked("b1"),
            GraphName::DefaultGraph,
        )),
        Op::Insert(Quad::new(
            BlankNode::new_unchecked("b1"),
            iri("p"),
            BlankNode::new_unchecked("b2"),
            GraphName::DefaultGraph,
        )),
    ])?;
    fx.step(&[Op::Remove(blank_type)])?;

    // RDF 1.2 triple terms
    fx.step(&[Op::Insert(Quad::new(
        iri("a"),
        iri("p"),
        Triple::new(iri("s"), iri("q"), iri("o")),
        GraphName::DefaultGraph,
    ))])?;

    // namespaces are primary metadata, never part of the projection
    fx.step(&[
        Op::SetNamespace("ex", iri("ns/a")),
        Op::SetNamespace("dc", iri("ns/b")),
    ])?;
    ensure(
        primary(&fx.store)?.namespaces.len() == 2,
        "namespaces missing from primary",
    )?;

    // aggregate lifecycle operations and dataset clear; RDF clear keeps namespaces
    fx.step(&[
        Op::Insert(with_graph(&dog, graph("g2"))),
        Op::ClearAllNamed,
        Op::DropAllNamed,
        Op::ClearAllGraphs,
        Op::Insert(dog),
        Op::Insert(dog_sub),
    ])?;
    fx.step(&[Op::ClearAll])?;
    ensure(
        primary(&fx.store)?.quads.is_empty(),
        "dataset clear left quads",
    )?;
    ensure(
        primary(&fx.store)?.namespaces.len() == 2,
        "RDF clear must not clear namespaces",
    )?;
    fx.step(&[Op::ClearNamespaces])?;
    ensure(
        primary(&fx.store)?.namespaces.is_empty(),
        "namespace clear failed",
    )
}

#[test]
fn provider_never_writes_the_primary_store() -> Res {
    let mut fx = Fixture::new()?;
    fx.step(&dog_animal_ops())?;
    fx.commit(&[Op::SetNamespace("ex", iri("ns/a"))])?;
    let before_checkpoint = fx.snapshot()?.checkpoint().clone();
    let before = primary(&fx.store)?;
    fx.refresh()?;
    fx.refresh()?;
    let generation = fx.index.active(&fx.limits).ctx("active")?;
    let snapshot = fx.snapshot()?;
    fx.provider
        .reconcile(&snapshot, generation.files(), &DerivedLimits::default())
        .ctx("reconcile")?;
    drop(snapshot);
    ensure(
        fx.snapshot()?.checkpoint() == &before_checkpoint,
        "provider operations changed the primary checkpoint",
    )?;
    ensure(
        primary(&fx.store)? == before,
        "provider operations changed primary quads, graphs or namespaces",
    )
}

#[test]
fn stale_copy_with_the_same_identity_fails_real_reconcile_at_activation() -> Res {
    struct Stale {
        real: EntailmentProjectionProvider,
        old: DerivedFiles,
    }
    impl DerivedProvider for Stale {
        fn identity(&self) -> ContributorIdentity {
            self.real.identity()
        }
        fn rebuild(
            &self,
            _: &DerivedSnapshot,
            output: &mut DerivedWriter<'_>,
            _: &DerivedLimits,
        ) -> Result<(), DerivedGenerationError> {
            for name in ["meta", "image", "inferred"] {
                output.write_file(name, self.old.read(name)?)?;
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

    let mut fx = Fixture::new()?;
    fx.step(&dog_animal_ops())?;
    let old = fx.index.active(&fx.limits).ctx("active")?;
    fx.commit(&[Op::Insert(type_of("rex", "Dog"))])?;
    let snapshot = fx.snapshot()?;
    let stale = Stale {
        real: fx.provider,
        old: old.files().clone(),
    };
    let candidate = fx
        .index
        .rebuild(&snapshot, &stale, &fx.limits)
        .ctx("lenient build of stale files")?;
    let error = err_of(
        fx.index
            .activate(&candidate, &snapshot, &fx.provider, &fx.limits),
    )?;
    ensure(
        matches!(error, DerivedGenerationError::Reconciliation(_)),
        &format!("stale copy activation returned {error}"),
    )?;
    ensure(
        fx.index.active(&fx.limits).ctx("active")?.fingerprint() == old.fingerprint(),
        "failed activation replaced the active generation",
    )
}

#[test]
fn ungoverned_write_is_invisible_to_the_outbox_and_needs_rebuild() -> Res {
    let mut fx = Fixture::new()?;
    fx.step(&dog_animal_ops())?;
    let generation = fx.index.active(&fx.limits).ctx("active")?;
    fx.store
        .insert(type_of("rex", "Dog"))
        .ctx("ungoverned insert")?;
    let snapshot = fx.snapshot()?;
    let applied = checkpoint(
        generation
            .source()
            .latest_receipt()
            .cloned()
            .ok_or("no governed receipt")?,
    )?;
    let delta = snapshot
        .delta(Some(&applied), &DerivedLimits::default())
        .ctx("delta")?;
    ensure(
        delta.commits().is_empty(),
        "an ungoverned write appeared in the outbox",
    )?;
    let error = err_of(fx.index.strict(&snapshot, &fx.limits))?;
    ensure(
        matches!(error, DerivedGenerationError::NotFresh),
        &format!("strict returned {error}"),
    )?;
    ensure(
        fx.index.state(&snapshot, &fx.limits).ctx("state")? == DerivedState::Lagging,
        "state should be lagging",
    )?;
    let error = err_of(fx.index.catch_up(&snapshot, &fx.provider, &fx.limits))?;
    ensure(
        matches!(error, DerivedGenerationError::Reconciliation(_)),
        &format!("catch-up over an ungoverned write returned {error}"),
    )?;
    let rebuilt = fx
        .index
        .rebuild(&snapshot, &fx.provider, &fx.limits)
        .ctx("rebuild")?;
    fx.index
        .activate(&rebuilt, &snapshot, &fx.provider, &fx.limits)
        .ctx("activate rebuilt")?;
    fx.index
        .strict(&snapshot, &fx.limits)
        .ctx("strict after rebuild")?;
    fx.check()
}

#[test]
fn reconcile_compares_independent_primary_recomputation() -> Res {
    let mut fx = Fixture::new()?;
    fx.step(&dog_animal_ops())?;
    let generation = fx.index.active(&fx.limits).ctx("active")?;
    let snapshot = fx.snapshot()?;
    fx.provider
        .reconcile(&snapshot, generation.files(), &DerivedLimits::default())
        .ctx("fresh generation must reconcile")?;
    fx.store
        .insert(type_of("rex", "Dog"))
        .ctx("ungoverned insert")?;
    let changed = fx.snapshot()?;
    let error = err_of(fx.provider.reconcile(
        &changed,
        generation.files(),
        &DerivedLimits::default(),
    ))?;
    ensure(
        matches!(error, DerivedGenerationError::Reconciliation(_)),
        &format!("divergent primary reconciled as {error}"),
    )
}

#[test]
fn every_payload_file_detects_byte_flips_and_truncation() -> Res {
    for name in ["meta", "image", "inferred"] {
        for truncate in [false, true] {
            let mut fx = Fixture::new()?;
            fx.step(&dog_animal_ops())?;
            let generation = fx.index.active(&fx.limits).ctx("active")?;
            let path = generation.directory().join(name);
            let mut bytes = std::fs::read(&path).ctx("read payload")?;
            ensure(bytes.len() > 8, "payload unexpectedly small")?;
            if truncate {
                bytes.pop();
            } else {
                let middle = bytes.len() / 2;
                bytes[middle] ^= 0x55;
            }
            std::fs::write(&path, &bytes).ctx("write damaged payload")?;
            let case = format!("{name} truncate={truncate}");
            let error = err_of(EntailmentProjectionState::load(generation.files()))?;
            ensure(
                matches!(error, DerivedGenerationError::Corrupt),
                &format!("{case}: state load returned {error}"),
            )?;
            let error = err_of(fx.index.active(&fx.limits))?;
            ensure(
                matches!(error, DerivedGenerationError::Corrupt),
                &format!("{case}: active generation returned {error}"),
            )?;
            let snapshot = fx.snapshot()?;
            err_of(fx.index.catch_up(&snapshot, &fx.provider, &fx.limits))?;
        }
    }
    Ok(())
}

#[test]
fn state_apply_is_idempotent_and_rejects_foreign_lower_and_gapped_deltas() -> Res {
    let mut fx = Fixture::new()?;
    // Genesis generation: no governed commit yet.
    fx.refresh()?;
    let genesis = fx.index.active(&fx.limits).ctx("active")?;
    let first = fx.commit(&dog_animal_ops())?;
    let mut state = EntailmentProjectionState::load(genesis.files()).ctx("load")?;
    ensure(
        state.last_receipt_sequence().is_none(),
        "genesis state should have no receipt",
    )?;
    let delta = fx
        .snapshot()?
        .delta(None, &DerivedLimits::default())
        .ctx("delta")?;
    ensure(delta.commits().len() == 1, "expected exactly one commit")?;
    state.apply(&delta).ctx("apply")?;
    ensure(
        state.inferred_record_count().is_none(),
        "applied state must be stale until recompute",
    )?;
    let expected = primary(&fx.store)?;
    let once = image_of(&state)?;
    diff("image quads after apply", &expected.quads, &once.quads)?;
    diff("image graphs after apply", &expected.graphs, &once.graphs)?;
    state.apply(&delta).ctx("apply the same delta again")?;
    ensure(
        image_of(&state)? == once,
        "applying the same delta twice changed the image",
    )?;
    ensure(
        state.last_receipt_sequence() == Some(1)
            && state.last_commit_id().as_ref() == Some(first.commit_id()),
        "cursor did not settle on the applied receipt",
    )?;

    // a delta from another store lineage is never applied
    let other = Store::open(fx.dir.path().join("other")).ctx("open other store")?;
    other
        .start_governed_transaction(TransactionRequest::default(), key(77))
        .ctx("start other")?
        .into_transaction()
        .commit()
        .ctx("commit other")?;
    let foreign = other
        .derived_snapshot(&TransactionStartControl::new())
        .ctx("other snapshot")?
        .delta(None, &DerivedLimits::default())
        .ctx("other delta")?;
    ensure(
        matches!(
            state.apply(&foreign),
            Err(DerivedGenerationError::RebuildRequired)
        ),
        "foreign delta was not rejected",
    )?;

    // an overlapping delta skips the duplicate and applies the new commit
    let second = fx.commit(&[Op::Insert(type_of("rex", "Dog"))])?;
    let both = fx
        .snapshot()?
        .delta(None, &DerivedLimits::default())
        .ctx("overlapping delta")?;
    ensure(both.commits().len() == 2, "expected two commits")?;
    state.apply(&both).ctx("apply overlapping delta")?;
    ensure(
        image_of(&state)?.quads == primary(&fx.store)?.quads,
        "overlapping delta did not converge",
    )?;
    ensure(
        state.last_receipt_sequence() == Some(2),
        "cursor should be at the second commit",
    )?;
    // a lower sequence (commit 1 after 2) is rejected before any replay
    ensure(
        matches!(
            state.apply(&both),
            Err(DerivedGenerationError::RebuildRequired)
        ),
        "lower-sequence delta was not rejected",
    )?;

    let third = fx.commit(&[Op::Insert(type_of("tom", "Dog"))])?;
    fx.commit(&[Op::Insert(type_of("ann", "Dog"))])?;

    // gap from genesis: the first delivered commit is not sequence 1 (`None` arm)
    let after_second = fx
        .snapshot()?
        .delta(Some(&checkpoint(second)?), &DerivedLimits::default())
        .ctx("delta after the second commit")?;
    let mut lagging = EntailmentProjectionState::load(genesis.files()).ctx("reload")?;
    ensure(
        matches!(
            lagging.apply(&after_second),
            Err(DerivedGenerationError::RebuildRequired)
        ),
        "gap from genesis was not rejected",
    )?;

    // gap after an applied receipt: last is 2, the delta starts at 4 (`Some(last)` arm)
    let only_fourth = fx
        .snapshot()?
        .delta(Some(&checkpoint(third)?), &DerivedLimits::default())
        .ctx("delta after the third commit")?;
    ensure(
        only_fourth
            .commits()
            .first()
            .map(|commit| commit.receipt().sequence())
            == Some(4),
        "fixture delta must start at sequence 4",
    )?;
    ensure(
        matches!(
            state.apply(&only_fourth),
            Err(DerivedGenerationError::RebuildRequired)
        ),
        "gap after an applied receipt was not rejected",
    )?;
    ensure(
        state.last_receipt_sequence() == Some(2),
        "a rejected gap advanced the cursor",
    )
}

fn rebuild_error(
    provider: EntailmentProjectionProvider,
    seed: Vec<Quad>,
) -> Res<DerivedGenerationError> {
    let mut fx = Fixture::with_provider(provider)?;
    for quad in seed {
        fx.store.insert(quad).ctx("seed insert")?;
    }
    let snapshot = fx.snapshot()?;
    let error = err_of(fx.index.rebuild(&snapshot, &fx.provider, &fx.limits))?;
    ensure(
        matches!(
            fx.index.active(&fx.limits),
            Err(DerivedGenerationError::Unavailable)
        ),
        "a failed build activated a generation",
    )?;
    Ok(error)
}

fn provider_with(limits: EntailmentProjectionLimits) -> EntailmentProjectionProvider {
    EntailmentProjectionProvider::new(limits)
}

#[test]
fn inconsistent_reserved_overflowing_and_cancelled_builds_never_activate() -> Res {
    let default = EntailmentProjectionProvider::default();
    let inconsistent = Quad::new(
        iri("outer-subject"),
        iri("outer-predicate"),
        Triple::new(
            iri("inner-subject"),
            iri("inner-predicate"),
            Literal::new_simple_literal("\u{FFFF}"),
        ),
        GraphName::DefaultGraph,
    );
    let error = rebuild_error(default, vec![inconsistent.clone()])?;
    ensure(
        matches!(error, DerivedGenerationError::Reconciliation(_)),
        &format!("RdfsInconsistent build returned {error}"),
    )?;

    let reserved = Quad::new(
        BlankNode::new("oxrdfs1").ctx("blank node")?,
        iri("p"),
        iri("o"),
        GraphName::DefaultGraph,
    );
    let error = rebuild_error(default, vec![reserved])?;
    ensure(
        matches!(error, DerivedGenerationError::Reconciliation(_)),
        &format!("reserved witness label build returned {error}"),
    )?;

    let tiny_inferred = provider_with(EntailmentProjectionLimits {
        max_inferred_quads: NonZeroU64::MIN,
        ..EntailmentProjectionLimits::default()
    });
    let error = rebuild_error(tiny_inferred, vec![type_of("fido", "Dog")])?;
    ensure(
        matches!(error, DerivedGenerationError::Limit),
        &format!("inferred cap returned {error}"),
    )?;

    let tiny_source = provider_with(EntailmentProjectionLimits {
        max_source_quads: NonZeroU64::MIN,
        ..EntailmentProjectionLimits::default()
    });
    let error = rebuild_error(
        tiny_source,
        vec![type_of("fido", "Dog"), type_of("rex", "Dog")],
    )?;
    ensure(
        matches!(error, DerivedGenerationError::Limit),
        &format!("source cap returned {error}"),
    )?;

    // cancelled control: the build fails with the cancellation, never silently
    let mut fx = Fixture::new()?;
    fx.step(&dog_animal_ops())?;
    let before = fx.index.active(&fx.limits).ctx("active")?.fingerprint();
    let snapshot = fx.snapshot()?;
    fx.limits.input.control.cancel();
    let error = err_of(fx.index.rebuild(&snapshot, &fx.provider, &fx.limits))?;
    ensure(
        matches!(
            error,
            DerivedGenerationError::Backup(BackupError::Cancelled)
        ),
        &format!("cancelled rebuild returned {error}"),
    )?;
    let generation = fx
        .index
        .active(&DerivedGenerationLimits::default())
        .ctx("active")?;
    ensure(
        generation.fingerprint() == before,
        "cancelled build changed the active generation",
    )?;
    let mut state = EntailmentProjectionState::load(generation.files()).ctx("load")?;
    let cancelled = DerivedLimits::default();
    cancelled.control.cancel();
    ensure(
        matches!(
            state.recompute(&cancelled),
            Err(DerivedGenerationError::Backup(BackupError::Cancelled))
        ),
        "cancelled recompute did not report the cancellation",
    )?;
    ensure(
        state.inferred_record_count().is_none(),
        "a failed recompute left inferred records usable",
    )?;
    let mut state = EntailmentProjectionState::load(generation.files()).ctx("load")?;
    let expired = DerivedLimits {
        control: TransactionStartControl::new().with_timeout(Duration::ZERO),
        ..DerivedLimits::default()
    };
    ensure(
        matches!(
            state.recompute(&expired),
            Err(DerivedGenerationError::Backup(BackupError::TimedOut))
        ),
        "expired recompute did not report the deadline",
    )?;
    ensure(
        state.inferred_record_count().is_none(),
        "expired recompute left inferred records usable",
    )?;

    // failed build after an active generation leaves the prior generation intact
    let mut fx = Fixture::new()?;
    fx.step(&dog_animal_ops())?;
    let before = fx.index.active(&fx.limits).ctx("active")?.fingerprint();
    fx.store.insert(inconsistent).ctx("insert inconsistent")?;
    let snapshot = fx.snapshot()?;
    let error = err_of(fx.index.rebuild(&snapshot, &fx.provider, &fx.limits))?;
    ensure(
        matches!(error, DerivedGenerationError::Reconciliation(_)),
        &format!("inconsistent rebuild returned {error}"),
    )?;
    ensure(
        fx.index.active(&fx.limits).ctx("active")?.fingerprint() == before,
        "failed build replaced the prior active generation",
    )
}

#[test]
fn closure_timeout_and_byte_ceiling_fail_closed_without_activation() -> Res {
    let zero = provider_with(EntailmentProjectionLimits {
        timeout: Duration::ZERO,
        ..EntailmentProjectionLimits::default()
    });
    let error = rebuild_error(zero, vec![type_of("fido", "Dog")])?;
    ensure(
        matches!(error, DerivedGenerationError::Backup(BackupError::TimedOut)),
        &format!("zero closure timeout returned {error}"),
    )?;

    let tiny_bytes = provider_with(EntailmentProjectionLimits {
        max_estimated_bytes: NonZeroU64::MIN,
        ..EntailmentProjectionLimits::default()
    });
    let error = rebuild_error(tiny_bytes, vec![type_of("fido", "Dog")])?;
    ensure(
        matches!(error, DerivedGenerationError::Limit),
        &format!("estimated-byte ceiling returned {error}"),
    )?;

    // a timed-out closure over a newer source leaves the prior generation intact
    let mut fx = Fixture::new()?;
    fx.step(&dog_animal_ops())?;
    let before = fx.index.active(&fx.limits).ctx("active")?.fingerprint();
    fx.commit(&[Op::Insert(type_of("rex", "Dog"))])?;
    let snapshot = fx.snapshot()?;
    let error = err_of(fx.index.rebuild(&snapshot, &zero, &fx.limits))?;
    ensure(
        matches!(error, DerivedGenerationError::Backup(BackupError::TimedOut)),
        &format!("timed-out rebuild returned {error}"),
    )?;
    ensure(
        fx.index.active(&fx.limits).ctx("active")?.fingerprint() == before,
        "timed-out build replaced the prior active generation",
    )
}

#[test]
fn cancellation_from_another_thread_during_a_build_keeps_the_prior_generation() -> Res {
    let mut fx = Fixture::new()?;
    fx.step(&dog_animal_ops())?;
    let before = fx.index.active(&fx.limits).ctx("active")?.fingerprint();
    let mut chain: Vec<Op> = (0..CHAIN)
        .map(|n| Op::Insert(sub_class(&format!("c{n}"), &format!("c{}", n + 1))))
        .collect();
    chain.push(Op::Insert(type_of("member", "c0")));
    fx.commit(&chain)?;
    let snapshot = fx.snapshot()?;
    let monitor = fx.index.monitor();
    let control = fx.limits.input.control.clone();
    let limits = fx.limits.clone();
    let (observed, result) = std::thread::scope(|scope| {
        let canceller = scope.spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(60);
            while Instant::now() < deadline {
                if monitor.state() == DerivedState::Building {
                    control.cancel();
                    return true;
                }
                std::thread::yield_now();
            }
            false
        });
        let result = fx.index.rebuild(&snapshot, &fx.provider, &limits);
        (canceller.join(), result)
    });
    ensure(
        observed.map_err(|_| "canceller panicked".to_owned())?,
        "the canceller never observed the build",
    )?;
    let error = err_of(result)?;
    ensure(
        matches!(
            error,
            DerivedGenerationError::Backup(BackupError::Cancelled)
                | DerivedGenerationError::Input(DerivedError::Backup(BackupError::Cancelled))
        ),
        &format!("build cancelled from another thread returned {error}"),
    )?;
    ensure(
        fx.index
            .active(&DerivedGenerationLimits::default())
            .ctx("active")?
            .fingerprint()
            == before,
        "cancelled build replaced the prior active generation",
    )
}
