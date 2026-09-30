//! Public-API tests for immutable, bounded finite-RDFS projection hydration against real derived
//! generations. Hydrated contents are compared with an independent full closure of the primary.
#![cfg(all(feature = "rdfs", feature = "rocksdb", not(target_family = "wasm")))]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration-test entry points live at the crate root"
)]

use oxigraph::model::vocab::{rdf, rdfs};
use oxigraph::model::{
    BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term, Triple,
};
use oxigraph::sparql::{QueryEntailment, QueryEntailmentDataset, QueryEntailmentOptions};
use oxigraph::store::{
    ContributorIdentity, DerivedFiles, DerivedGenerationError, DerivedGenerationLimits,
    DerivedIndex, DerivedLimits, DerivedProvider, DerivedSnapshot, DerivedWriter,
    EntailmentProjectionHydrationError, EntailmentProjectionHydrationLimits,
    EntailmentProjectionHydrationResource, EntailmentProjectionLimits,
    EntailmentProjectionProvider, EntailmentProjectionSnapshot, EntailmentProjectionState, Store,
    TransactionKey, TransactionRequest, TransactionStartControl, WritableDataset,
    entailment_projection_identity,
};
use std::collections::BTreeSet;
use std::fmt::Display;
use std::num::{NonZeroU32, NonZeroU64};
use std::path::{Path, PathBuf};
use std::time::Duration;

type Res<T = ()> = Result<T, String>;
type Hydrated = Result<EntailmentProjectionSnapshot, EntailmentProjectionHydrationError>;

const FILES: [&str; 3] = ["meta", "image", "inferred"];
const WIDE: EntailmentProjectionHydrationLimits = EntailmentProjectionHydrationLimits {
    max_source_records: NonZeroU64::MAX,
    max_inferred_records: NonZeroU64::MAX,
    max_payload_bytes: NonZeroU64::MAX,
    max_estimated_bytes: NonZeroU64::MAX,
};

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

fn hydrated(result: Hydrated) -> Res<EntailmentProjectionSnapshot> {
    result.ctx("hydrate")
}

fn failure(result: Hydrated) -> Res<EntailmentProjectionHydrationError> {
    match result {
        Ok(_) => Err("expected hydration to fail but it returned a snapshot".to_owned()),
        Err(error) => Ok(error),
    }
}

fn nonzero(value: u64) -> Res<NonZeroU64> {
    NonZeroU64::new(value).ok_or_else(|| "fixture measured a zero resource".to_owned())
}

// ---------------------------------------------------------------- vocabulary

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:test:{local}"))
}

fn type_of(subject: &str, class: &str) -> Quad {
    Quad::new(iri(subject), rdf::TYPE, iri(class), GraphName::DefaultGraph)
}

fn sub_class(child: &str, parent: &str) -> Quad {
    Quad::new(
        iri(child),
        rdfs::SUB_CLASS_OF,
        iri(parent),
        GraphName::DefaultGraph,
    )
}

fn in_graph(quad: &Quad, graph: GraphName) -> Quad {
    Quad::new(
        quad.subject.clone(),
        quad.predicate.clone(),
        quad.object.clone(),
        graph,
    )
}

fn graph_node(local: &str) -> NamedOrBlankNode {
    iri(local).into()
}

fn nested() -> Quad {
    Quad::new(
        iri("a"),
        iri("says"),
        Triple::new(
            iri("s"),
            iri("q"),
            Triple::new(iri("x"), iri("y"), iri("z")),
        ),
        GraphName::DefaultGraph,
    )
}

fn seed() -> (Vec<NamedOrBlankNode>, Vec<Quad>) {
    let g1 = GraphName::NamedNode(iri("g1"));
    let bg = GraphName::from(BlankNode::new_unchecked("bg"));
    let graphs = vec![
        graph_node("g1"),
        BlankNode::new_unchecked("bg").into(),
        graph_node("empty"),
    ];
    let quads = vec![
        sub_class("Dog", "Animal"),
        type_of("fido", "Dog"),
        in_graph(&sub_class("Dog", "Animal"), g1.clone()),
        in_graph(&type_of("rex", "Dog"), g1),
        in_graph(&sub_class("Dog", "Animal"), bg.clone()),
        Quad::new(BlankNode::new_unchecked("b1"), rdf::TYPE, iri("Dog"), bg),
        Quad::new(
            iri("fido"),
            iri("knows"),
            BlankNode::new_unchecked("b1"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            BlankNode::new_unchecked("b1"),
            iri("knows"),
            BlankNode::new_unchecked("b2"),
            GraphName::DefaultGraph,
        ),
        nested(),
    ];
    (graphs, quads)
}

// ------------------------------------------------ independent primary oracle

#[derive(Debug, Default, Eq, PartialEq)]
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

#[derive(Debug, Default, Eq, PartialEq)]
struct Contents {
    quads: BTreeSet<String>,
    graphs: BTreeSet<String>,
}

fn contents(dataset: &Dataset) -> Contents {
    let mut quads = BTreeSet::new();
    for quad in dataset {
        quads.insert(quad.to_string());
    }
    let mut graphs = BTreeSet::new();
    for name in dataset.named_graphs() {
        graphs.insert(name.to_string());
    }
    Contents { quads, graphs }
}

fn diff(what: &str, expected: &BTreeSet<String>, actual: &BTreeSet<String>) -> Res {
    if expected == actual {
        return Ok(());
    }
    let missing: Vec<_> = expected.difference(actual).take(4).collect();
    let extra: Vec<_> = actual.difference(expected).take(4).collect();
    Err(format!(
        "{what} diverged; missing from snapshot {missing:?}; unexpected in snapshot {extra:?}"
    ))
}

fn blank_labels(quad: &Quad, output: &mut BTreeSet<String>) {
    if let NamedOrBlankNode::BlankNode(node) = &quad.subject {
        output.insert(node.as_str().to_owned());
    }
    term_blank_labels(&quad.object, output);
    if let GraphName::BlankNode(node) = &quad.graph_name {
        output.insert(node.as_str().to_owned());
    }
}

fn term_blank_labels(term: &Term, output: &mut BTreeSet<String>) {
    match term {
        Term::BlankNode(node) => {
            output.insert(node.as_str().to_owned());
        }
        Term::Triple(triple) => {
            if let NamedOrBlankNode::BlankNode(node) = &triple.subject {
                output.insert(node.as_str().to_owned());
            }
            term_blank_labels(&triple.object, output);
        }
        _ => {}
    }
}

/// Test-side recomputation of the caller resources a successful hydration consumed.
struct Measure {
    source: u64,
    inferred: u64,
    estimated: u64,
}

fn estimate(value: &impl Display) -> u64 {
    160_u64.saturating_add(u64::try_from(value.to_string().len()).unwrap_or(u64::MAX))
}

fn measure(snapshot: &EntailmentProjectionSnapshot) -> Measure {
    let mut measured = Measure {
        source: 0,
        inferred: 0,
        estimated: 0,
    };
    let mut image_graphs = BTreeSet::new();
    for quad in snapshot.image() {
        measured.source += 1;
        measured.estimated += estimate(&quad);
    }
    for graph in snapshot.image().named_graphs() {
        measured.source += 1;
        measured.estimated += estimate(&graph);
        image_graphs.insert(graph.to_string());
    }
    for quad in snapshot.inferred() {
        measured.inferred += 1;
        measured.estimated += estimate(&quad);
    }
    for graph in snapshot.inferred().named_graphs() {
        if !image_graphs.contains(&graph.to_string()) {
            measured.inferred += 1;
            measured.estimated += estimate(&graph);
        }
    }
    measured
}

fn payload_bytes(directory: &Path) -> Res<u64> {
    let mut total = 0_u64;
    for name in FILES {
        total += std::fs::metadata(directory.join(name))
            .ctx("payload metadata")?
            .len();
    }
    Ok(total)
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
        Self::with(&[], &[])
    }

    fn with(extra_graphs: &[NamedOrBlankNode], extra_quads: &[Quad]) -> Res<Self> {
        let dir = tempfile::tempdir().ctx("tempdir")?;
        let store = Store::open(dir.path().join("db")).ctx("open store")?;
        let index =
            DerivedIndex::create(dir.path().join("index"), entailment_projection_identity())
                .ctx("create index")?;
        let mut fixture = Self {
            dir,
            store,
            index,
            provider: EntailmentProjectionProvider::default(),
            limits: DerivedGenerationLimits::default(),
            keys: 0,
        };
        let (mut graphs, mut quads) = seed();
        graphs.extend_from_slice(extra_graphs);
        quads.extend_from_slice(extra_quads);
        fixture.commit(&graphs, &quads)?;
        fixture.refresh()?;
        Ok(fixture)
    }

    fn commit(&mut self, graphs: &[NamedOrBlankNode], quads: &[Quad]) -> Res {
        self.keys += 1;
        let mut tx = self
            .store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([self.keys; 16]),
            )
            .ctx("start governed transaction")?
            .into_transaction();
        for graph in graphs {
            tx.insert_named_graph(graph.clone()).ctx("create graph")?;
        }
        for quad in quads {
            tx.insert(quad.clone()).ctx("insert")?;
        }
        tx.commit().ctx("commit")?;
        Ok(())
    }

    /// Always a full rebuild, so lineage establishment never needs a catch-up.
    fn refresh(&mut self) -> Res {
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
            .ctx("snapshot")
    }

    fn hydrate(
        &self,
        limits: &EntailmentProjectionHydrationLimits,
        control: &TransactionStartControl,
    ) -> Res<Hydrated> {
        let source = self.snapshot()?;
        let view = self
            .index
            .strict(&source, &self.limits)
            .ctx("strict view")?;
        Ok(EntailmentProjectionSnapshot::hydrate(
            &view, limits, control,
        ))
    }

    fn generation_directory(&self) -> Res<PathBuf> {
        Ok(self
            .index
            .active(&self.limits)
            .ctx("active generation")?
            .directory()
            .to_owned())
    }
}

// -------------------------------------------------------------------- tests

#[test]
fn hydrated_snapshot_matches_the_full_closure_oracle() -> Res {
    let fx = Fixture::new()?;
    let source = fx.snapshot()?;
    let view = fx.index.strict(&source, &fx.limits).ctx("strict view")?;
    let snapshot = hydrated(EntailmentProjectionSnapshot::hydrate(
        &view,
        &WIDE,
        &TransactionStartControl::new(),
    ))?;

    let expected = primary(&fx.store)?;
    let image = contents(snapshot.image());
    diff("image quads", &expected.quads, &image.quads)?;
    diff("image graph topology", &expected.graphs, &image.graphs)?;
    ensure(
        image.graphs.contains(&graph_node("empty").to_string()),
        "empty named graph lost",
    )?;
    ensure(image.graphs.contains("_:bg"), "blank graph name lost")?;
    ensure(
        image.quads.contains(&nested().to_string()),
        "nested RDF 1.2 triple term lost",
    )?;

    let oracle = closure_extra(&fx.store)?;
    let inferred = contents(snapshot.inferred());
    diff("inferred quads", &oracle.quads, &inferred.quads)?;
    let inferred_only = inferred
        .graphs
        .difference(&expected.graphs)
        .cloned()
        .collect();
    diff("inferred graph topology", &oracle.graphs, &inferred_only)?;
    ensure(
        inferred
            .quads
            .contains(&type_of("fido", "Animal").to_string()),
        "subclass entailment missing",
    )?;
    ensure(
        inferred.quads.contains(
            &Quad::new(
                BlankNode::new_unchecked("b1"),
                rdf::TYPE,
                iri("Animal"),
                GraphName::from(BlankNode::new_unchecked("bg")),
            )
            .to_string(),
        ),
        "graph-local blank-node entailment lost its identity",
    )?;

    // Generated witnesses never appear: every inferred blank node is a primary blank node.
    let mut base = BTreeSet::new();
    for quad in snapshot.image() {
        blank_labels(&quad, &mut base);
    }
    for graph in snapshot.image().named_graphs() {
        if let NamedOrBlankNode::BlankNode(node) = graph {
            base.insert(node.as_str().to_owned());
        }
    }
    for quad in snapshot.inferred() {
        let mut labels = BTreeSet::new();
        blank_labels(&quad, &mut labels);
        ensure(
            labels.is_subset(&base) && labels.iter().all(|label| !label.starts_with("oxrdfs")),
            &format!("generated witness exposed in {quad}"),
        )?;
    }

    ensure(
        snapshot.profile() == QueryEntailment::Rdfs12Finite,
        "unexpected profile",
    )?;
    ensure(
        snapshot.build_limits() == EntailmentProjectionLimits::default(),
        "stored build limits not copied",
    )?;
    ensure(
        snapshot.source_checkpoint() == source.checkpoint(),
        "source checkpoint not copied from the admitted view",
    )?;
    ensure(
        snapshot.applied_checkpoint() == view.generation().source(),
        "applied checkpoint not copied from the generation",
    )?;
    ensure(
        *snapshot.generation_fingerprint() == view.generation().fingerprint(),
        "generation fingerprint not copied",
    )
}

#[test]
fn exact_caller_ceilings_pass_and_one_less_fails_for_each_resource() -> Res {
    let long_graph = NamedNode::new_unchecked(format!("urn:test:{}", "e".repeat(32_768)));
    let huge = Quad::new(
        iri("fido"),
        iri("note"),
        Literal::new_simple_literal("x".repeat(65_536)),
        GraphName::DefaultGraph,
    );
    let fx = Fixture::with(&[long_graph.into()], &[huge])?;
    let control = TransactionStartControl::new();
    let snapshot = hydrated(fx.hydrate(&WIDE, &control)?)?;
    let measured = measure(&snapshot);
    ensure(
        measured.estimated >= 65_536 + 32_768 + 2 * 160,
        "huge literal and long empty-graph IRI were not charged",
    )?;
    let payload = payload_bytes(&fx.generation_directory()?)?;
    let exact = EntailmentProjectionHydrationLimits {
        max_source_records: nonzero(measured.source)?,
        max_inferred_records: nonzero(measured.inferred)?,
        max_payload_bytes: nonzero(payload)?,
        max_estimated_bytes: nonzero(measured.estimated)?,
    };
    hydrated(fx.hydrate(&exact, &control)?).ctx("exact caller ceilings")?;

    let less = |value: u64| nonzero(value.checked_sub(1).unwrap_or(0));
    for (resource, ceiling, limits) in [
        (
            EntailmentProjectionHydrationResource::SourceRecords,
            measured.source - 1,
            EntailmentProjectionHydrationLimits {
                max_source_records: less(measured.source)?,
                ..exact
            },
        ),
        (
            EntailmentProjectionHydrationResource::InferredRecords,
            measured.inferred - 1,
            EntailmentProjectionHydrationLimits {
                max_inferred_records: less(measured.inferred)?,
                ..exact
            },
        ),
        (
            EntailmentProjectionHydrationResource::PayloadBytes,
            payload - 1,
            EntailmentProjectionHydrationLimits {
                max_payload_bytes: less(payload)?,
                ..exact
            },
        ),
        (
            EntailmentProjectionHydrationResource::EstimatedBytes,
            measured.estimated - 1,
            EntailmentProjectionHydrationLimits {
                max_estimated_bytes: less(measured.estimated)?,
                ..exact
            },
        ),
    ] {
        let error = failure(fx.hydrate(&limits, &control)?)?;
        ensure(
            matches!(
                error,
                EntailmentProjectionHydrationError::LimitExceeded {
                    resource: actual,
                    ceiling: reported,
                } if actual == resource && reported == ceiling
            ),
            &format!("{resource}: one-less ceiling returned {error}"),
        )?;
    }
    Ok(())
}

#[test]
fn stored_build_ceilings_never_raise_tight_caller_ceilings() -> Res {
    let fx = Fixture::new()?;
    let stored = EntailmentProjectionLimits::default();
    ensure(
        stored.max_source_quads.get() > 1 && stored.max_inferred_quads.get() > 1,
        "fixture must be built under larger stored ceilings",
    )?;
    for (resource, limits) in [
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
        let error = failure(fx.hydrate(&limits, &TransactionStartControl::new())?)?;
        ensure(
            matches!(
                error,
                EntailmentProjectionHydrationError::LimitExceeded {
                    resource: actual,
                    ceiling: 1,
                } if actual == resource
            ),
            &format!("{resource}: tight caller ceiling returned {error}"),
        )?;
    }
    Ok(())
}

#[test]
fn eventual_view_is_unsupported_before_payload_io() -> Res {
    let fx = Fixture::new()?;
    let source = fx.snapshot()?;
    let view = fx
        .index
        .eventual(&source, &fx.limits)
        .ctx("eventual view")?;
    let directory = view.generation().directory().to_owned();
    for name in FILES {
        std::fs::write(directory.join(name), b"damaged").ctx("damage payload")?;
    }
    let error = failure(EntailmentProjectionSnapshot::hydrate(
        &view,
        &WIDE,
        &TransactionStartControl::new(),
    ))?;
    ensure(
        matches!(
            error,
            EntailmentProjectionHydrationError::UnsupportedConsistency
        ),
        &format!("eventual view returned {error}"),
    )
}

#[test]
fn control_categories_are_exact_and_return_no_snapshot() -> Res {
    let fx = Fixture::new()?;
    let cancelled = TransactionStartControl::new();
    cancelled.cancel();
    let error = failure(fx.hydrate(&WIDE, &cancelled)?)?;
    ensure(
        matches!(error, EntailmentProjectionHydrationError::Cancelled),
        &format!("pre-cancelled control returned {error}"),
    )?;
    let expired = TransactionStartControl::new().with_timeout(Duration::ZERO);
    let error = failure(fx.hydrate(&WIDE, &expired)?)?;
    ensure(
        matches!(error, EntailmentProjectionHydrationError::TimedOut),
        &format!("zero relative timeout returned {error}"),
    )?;
    let exhausted = EntailmentProjectionHydrationLimits {
        max_source_records: NonZeroU64::MIN,
        max_payload_bytes: NonZeroU64::MIN,
        ..WIDE
    };
    let error = failure(fx.hydrate(&exhausted, &cancelled)?)?;
    ensure(
        matches!(error, EntailmentProjectionHydrationError::Cancelled),
        &format!("cancellation must win over admission exhaustion, got {error}"),
    )
}

#[test]
fn payload_damage_after_view_admission_fails_closed() -> Res {
    let fx = Fixture::new()?;
    for name in FILES {
        for truncate in [false, true] {
            let source = fx.snapshot()?;
            let view = fx.index.strict(&source, &fx.limits).ctx("strict view")?;
            let path = view.generation().directory().join(name);
            let original = std::fs::read(&path).ctx("read payload")?;
            ensure(original.len() > 8, "payload unexpectedly small")?;
            let mut damaged = original.clone();
            if truncate {
                damaged.pop();
            } else {
                let middle = damaged.len() / 2;
                damaged[middle] ^= 0x55;
            }
            std::fs::write(&path, &damaged).ctx("write damaged payload")?;
            let result = EntailmentProjectionSnapshot::hydrate(
                &view,
                &WIDE,
                &TransactionStartControl::new(),
            );
            std::fs::write(&path, &original).ctx("restore payload")?;
            let error = failure(result)?;
            ensure(
                matches!(error, EntailmentProjectionHydrationError::Corrupt),
                &format!("{name} truncate={truncate} returned {error}"),
            )?;
        }
    }
    hydrated(fx.hydrate(&WIDE, &TransactionStartControl::new())?)
        .ctx("restored payload must hydrate")?;
    Ok(())
}

#[test]
fn retained_inventory_rejects_coherent_replacement_after_admission() -> Res {
    let mut fx = Fixture::new()?;
    let source = fx.snapshot()?;
    let view = fx.index.strict(&source, &fx.limits).ctx("strict view")?;
    let retained = view.generation().directory().to_owned();
    fx.commit(&[], &[type_of("another", "Dog")])?;
    fx.refresh()?;
    let replacement = fx.generation_directory()?;
    ensure(retained != replacement, "distinct generations expected")?;
    for name in FILES {
        std::fs::copy(replacement.join(name), retained.join(name))
            .ctx("replace with a complete internally consistent payload set")?;
    }
    let error = failure(EntailmentProjectionSnapshot::hydrate(
        &view,
        &WIDE,
        &TransactionStartControl::new(),
    ))?;
    ensure(
        matches!(error, EntailmentProjectionHydrationError::Corrupt),
        &format!("coherent replacement returned {error}"),
    )
}

#[test]
fn foreign_provider_identity_is_rejected() -> Res {
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
    let error = failure(EntailmentProjectionSnapshot::hydrate(
        &view,
        &WIDE,
        &TransactionStartControl::new(),
    ))?;
    ensure(
        matches!(error, EntailmentProjectionHydrationError::Identity),
        &format!("foreign provider returned {error}"),
    )
}

#[test]
fn hydrated_snapshot_is_owned_immutable_and_leaves_primary_and_index_unchanged() -> Res {
    let mut fx = Fixture::new()?;
    let before_primary = primary(&fx.store)?;
    let source = fx.snapshot()?;
    let before_checkpoint = source.checkpoint().clone();
    let before_active = fx.index.active(&fx.limits).ctx("active")?.fingerprint();
    let view = fx.index.strict(&source, &fx.limits).ctx("strict view")?;
    let retained = view.generation().directory().to_owned();
    let snapshot = hydrated(EntailmentProjectionSnapshot::hydrate(
        &view,
        &WIDE,
        &TransactionStartControl::new(),
    ))?;
    drop(view);
    drop(source);

    ensure(
        primary(&fx.store)? == before_primary,
        "hydration changed primary quads, topology or namespaces",
    )?;
    ensure(
        fx.snapshot()?.checkpoint() == &before_checkpoint,
        "hydration changed the primary checkpoint",
    )?;
    ensure(
        fx.index.active(&fx.limits).ctx("active")?.fingerprint() == before_active,
        "hydration changed the active generation",
    )?;
    let image = contents(snapshot.image());
    let inferred = contents(snapshot.inferred());

    // Primary commit and ACTIVE swap.
    fx.commit(
        &[graph_node("later")],
        &[type_of("tom", "Cat"), sub_class("Cat", "Animal")],
    )?;
    fx.refresh()?;
    ensure(
        fx.index.active(&fx.limits).ctx("active")?.fingerprint() != before_active,
        "fixture did not swap the active generation",
    )?;
    // Payload replacement in the hydrated generation.
    for name in FILES {
        std::fs::write(retained.join(name), b"replaced").ctx("replace payload")?;
    }
    // Mutation of separately loaded state.
    let mut state =
        EntailmentProjectionState::load(fx.index.active(&fx.limits).ctx("active")?.files())
            .ctx("load separate state")?;
    state
        .recompute(&DerivedLimits::default())
        .ctx("recompute separate state")?;
    drop(state);
    // Index, store and directory drop.
    let Fixture {
        dir, store, index, ..
    } = fx;
    drop(index);
    drop(store);
    drop(dir);

    ensure(
        contents(snapshot.image()) == image,
        "later operations altered the hydrated image",
    )?;
    ensure(
        contents(snapshot.inferred()) == inferred,
        "later operations altered the hydrated inferred records",
    )?;
    ensure(
        snapshot.source_checkpoint() == &before_checkpoint,
        "later operations altered the hydrated provenance",
    )?;
    ensure(
        *snapshot.generation_fingerprint() == before_active,
        "later operations altered the hydrated generation fingerprint",
    )
}

#[test]
fn old_admitted_view_hydrates_after_primary_and_active_advance() -> Res {
    let mut fx = Fixture::new()?;
    let source = fx.snapshot()?;
    let view = fx.index.strict(&source, &fx.limits).ctx("strict C")?;
    let expected = primary(&fx.store)?;
    let oracle = closure_extra(&fx.store)?;
    let fingerprint = view.generation().fingerprint();
    fx.commit(
        &[graph_node("later")],
        &[type_of("tom", "Cat"), sub_class("Cat", "Animal")],
    )?;
    fx.refresh()?;
    ensure(
        fx.snapshot()?.checkpoint() != source.checkpoint(),
        "primary did not advance",
    )?;
    ensure(
        fx.index.active(&fx.limits).ctx("active D")?.fingerprint() != fingerprint,
        "ACTIVE did not advance",
    )?;
    let snapshot = hydrated(EntailmentProjectionSnapshot::hydrate(
        &view,
        &WIDE,
        &TransactionStartControl::new(),
    ))?;
    let image = contents(snapshot.image());
    let inferred = contents(snapshot.inferred());
    diff("C image quads", &expected.quads, &image.quads)?;
    diff("C image graphs", &expected.graphs, &image.graphs)?;
    diff("C inferred quads", &oracle.quads, &inferred.quads)?;
    let extra = inferred
        .graphs
        .difference(&expected.graphs)
        .cloned()
        .collect();
    diff("C inferred graphs", &oracle.graphs, &extra)?;
    ensure(
        snapshot.source_checkpoint() == source.checkpoint()
            && snapshot.applied_checkpoint() == source.checkpoint()
            && *snapshot.generation_fingerprint() == fingerprint,
        "hydration mixed C and D provenance",
    )
}
