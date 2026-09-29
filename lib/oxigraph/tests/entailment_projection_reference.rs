//! TEST ONLY reference evaluator: replays governed outbox groups into a separate model Store and
//! compares it with the source and its full RDFS closure. No incremental algorithm, no projection.
#![cfg(feature = "rdfs")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration-test entry points live at the crate root"
)]

use oxigraph::model::vocab::{rdf, rdfs};
use oxigraph::model::{BlankNode, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{QueryEntailment, QueryEntailmentDataset, QueryEntailmentOptions};
use oxigraph::store::{
    CommitId, CommitReceipt, GovernedTransaction, Namespace, NamespacePrefix, OutboxCursor,
    OutboxRecord, SemanticChange, SemanticChangeSet, Store, TransactionKey, TransactionRequest,
    WritableDataset, WritableNamespaceRegistry,
};
use std::collections::{BTreeSet, HashMap};
use std::fmt::Display;
use std::num::NonZeroUsize;

type Res<T = ()> = Result<T, String>;

const PAGES: [usize; 4] = [1, 2, 3, 100];
const MAX_POLLS: usize = 512;
const SHRINK_BUDGET: usize = 40;
const DEFAULT_SEEDS: [u64; 10] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const INDIVIDUALS: [&str; 3] = ["x", "y", "fido"];
const CLASSES: [&str; 3] = ["Dog", "Animal", "A"];
const PROPERTIES: [&str; 2] = ["p", "q"];
const BLANKS: [&str; 2] = ["b1", "b2"];
const PREFIXES: [&str; 3] = ["ex", "dc", ""];
const NAMESPACE_MARKER: &str = "urn:test:ns/";

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

fn page_size(count: usize) -> Res<NonZeroUsize> {
    NonZeroUsize::new(count).ok_or_else(|| "page size must be non-zero".to_owned())
}

fn count(len: usize) -> u64 {
    u64::try_from(len).unwrap_or(u64::MAX)
}

/// Position of a cursor, read from its public encoding after the checksummed
/// encoding has been validated by the public decoder.
fn position(cursor: &OutboxCursor) -> Res<u64> {
    let bytes = cursor.to_bytes();
    let decoded = OutboxCursor::from_bytes(&bytes).ctx("cursor encoding")?;
    ensure(&decoded == cursor, "cursor encoding does not round-trip")?;
    let raw = bytes
        .get(17..25)
        .and_then(|field| <[u8; 8]>::try_from(field).ok())
        .ok_or_else(|| "cursor position field is missing".to_owned())?;
    Ok(u64::from_be_bytes(raw))
}

// ---------------------------------------------------------------- vocabulary

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("urn:test:{local}"))
}

fn bnode(label: &'static str) -> BlankNode {
    BlankNode::new_unchecked(label)
}

fn graph(local: &str) -> GraphName {
    GraphName::NamedNode(iri(local))
}

fn graph_node(local: &str) -> NamedOrBlankNode {
    iri(local).into()
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

fn with_graph(quad: &Quad, graph_name: GraphName) -> Quad {
    Quad::new(
        quad.subject.clone(),
        quad.predicate.clone(),
        quad.object.clone(),
        graph_name,
    )
}

// --------------------------------------------------------------------- trace

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
    RemoveNamespace(&'static str),
    ClearNamespaces,
}

#[derive(Clone, Copy, Debug)]
enum End {
    Commit,
    Rollback,
    Drop,
}

#[derive(Clone, Debug)]
struct Tx {
    ops: Vec<Op>,
    end: End,
    restart: bool,
}

impl Tx {
    fn namespace_only(&self) -> bool {
        !self.ops.is_empty()
            && self.ops.iter().all(|op| {
                matches!(
                    op,
                    Op::SetNamespace(..) | Op::RemoveNamespace(_) | Op::ClearNamespaces
                )
            })
    }
}

fn commit(ops: Vec<Op>) -> Tx {
    ended(ops, End::Commit)
}

fn ended(ops: Vec<Op>, end: End) -> Tx {
    Tx {
        ops,
        end,
        restart: false,
    }
}

fn key(id: u64) -> TransactionKey {
    let mut bytes = [0_u8; 16];
    bytes[..8].copy_from_slice(&id.to_be_bytes());
    TransactionKey::new(bytes)
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
        Op::RemoveNamespace(prefix) => {
            let prefix = NamespacePrefix::new(*prefix).ctx("namespace prefix")?;
            tx.remove_namespace(&prefix).ctx("remove namespace")
        }
        Op::ClearNamespaces => tx.clear_namespaces().ctx("clear namespaces"),
    }
}

fn stage<'a>(source: &'a Store, id: u64, ops: &[Op]) -> Res<GovernedTransaction<'a>> {
    let mut tx = source
        .start_governed_transaction(TransactionRequest::default(), key(id))
        .ctx("start governed transaction")?
        .into_transaction();
    for op in ops {
        apply_op(&mut tx, op)?;
    }
    Ok(tx)
}

// ------------------------------------------------- full-closure baseline oracle

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct Primary {
    quads: BTreeSet<String>,
    graphs: BTreeSet<String>,
    namespaces: Vec<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct Closure {
    quads: BTreeSet<String>,
    graphs: BTreeSet<String>,
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

fn closure(store: &Store) -> Res<Closure> {
    let snapshot = QueryEntailmentDataset::from_store(
        store,
        &QueryEntailmentOptions::new(QueryEntailment::Rdfs12Finite),
    )
    .ctx("full closure")?;
    let dataset = snapshot.dataset();
    let mut quads = BTreeSet::new();
    for quad in dataset {
        quads.insert(quad.to_string());
    }
    let mut graphs = BTreeSet::new();
    for name in dataset.named_graphs() {
        graphs.insert(name.to_string());
    }
    Ok(Closure { quads, graphs })
}

fn diff(what: &str, source: &BTreeSet<String>, model: &BTreeSet<String>) -> Res {
    if source == model {
        return Ok(());
    }
    let only_source: Vec<_> = source.difference(model).take(4).collect();
    let only_model: Vec<_> = model.difference(source).take(4).collect();
    Err(format!(
        "{what} diverged; only in source {only_source:?}; only in model {only_model:?}"
    ))
}

fn compare_stores(source: &Store, model: &Store) -> Res<(Primary, Closure)> {
    let source_primary = primary(source)?;
    let model_primary = primary(model)?;
    diff("primary quads", &source_primary.quads, &model_primary.quads)?;
    diff(
        "named-graph topology",
        &source_primary.graphs,
        &model_primary.graphs,
    )?;
    ensure(
        source_primary.namespaces == model_primary.namespaces,
        "namespace records diverged",
    )?;
    let source_closure = closure(source)?;
    let model_closure = closure(model)?;
    diff("closure quads", &source_closure.quads, &model_closure.quads)?;
    diff(
        "closure graphs",
        &source_closure.graphs,
        &model_closure.graphs,
    )?;
    Ok((source_primary, source_closure))
}

// ------------------------------------------------ outbox-driven replay consumer

struct Expected<'a> {
    receipt: &'a CommitReceipt,
    changes: &'a SemanticChangeSet,
}

struct Group {
    receipt: CommitReceipt,
    header_cursor: OutboxCursor,
    last_cursor: OutboxCursor,
    events: Vec<SemanticChange>,
    duplicate: bool,
}

impl Group {
    fn is_complete(&self) -> bool {
        count(self.events.len()) == self.receipt.effect_count()
    }
}

#[derive(Debug, Eq, PartialEq)]
struct Fingerprint {
    model: Primary,
    applied_cursor: Option<[u8; 57]>,
    last_sequence: u64,
    commits: Vec<[u8; 32]>,
    pending: bool,
}

struct Consumer {
    model: Store,
    applied_cursor: Option<OutboxCursor>,
    poll_cursor: Option<OutboxCursor>,
    last_sequence: u64,
    applied: HashMap<CommitId, Vec<SemanticChange>>,
    pending: Option<Group>,
    skip_quad_removals: bool,
    duplicates_skipped: usize,
}

impl Consumer {
    fn new(skip_quad_removals: bool) -> Res<Self> {
        Ok(Self {
            model: Store::new().ctx("model store")?,
            applied_cursor: None,
            poll_cursor: None,
            last_sequence: 0,
            applied: HashMap::new(),
            pending: None,
            skip_quad_removals,
            duplicates_skipped: 0,
        })
    }

    fn is_pending(&self) -> bool {
        self.pending.is_some()
    }

    fn restart(&mut self) {
        self.pending = None;
        self.poll_cursor.clone_from(&self.applied_cursor);
    }

    fn rewind(&mut self) {
        self.pending = None;
        self.poll_cursor = None;
    }

    fn fingerprint(&self) -> Res<Fingerprint> {
        let mut commits: Vec<[u8; 32]> = self.applied.keys().map(|id| *id.as_bytes()).collect();
        commits.sort_unstable();
        Ok(Fingerprint {
            model: primary(&self.model)?,
            applied_cursor: self.applied_cursor.as_ref().map(OutboxCursor::to_bytes),
            last_sequence: self.last_sequence,
            commits,
            pending: self.pending.is_some(),
        })
    }

    fn deliver(&mut self, records: &[OutboxRecord], expected: Option<&Expected<'_>>) -> Res {
        for record in records {
            if let Err(error) = self.accept(record, expected) {
                self.restart();
                return Err(error);
            }
        }
        Ok(())
    }

    fn accept(&mut self, record: &OutboxRecord, expected: Option<&Expected<'_>>) -> Res {
        match record {
            OutboxRecord::Commit { cursor, receipt } => {
                ensure(
                    self.pending.is_none(),
                    "commit header inside an incomplete group",
                )?;
                ensure(
                    receipt.outbox_header_cursor().as_ref() == Some(cursor),
                    "header cursor disagrees with its receipt",
                )?;
                self.pending = Some(Group {
                    receipt: receipt.clone(),
                    header_cursor: cursor.clone(),
                    last_cursor: cursor.clone(),
                    events: Vec::new(),
                    duplicate: self.applied.contains_key(receipt.commit_id()),
                });
            }
            OutboxRecord::Event {
                cursor,
                header_cursor,
                commit_id,
                event_index,
                event_count,
                change,
            } => {
                let group = self
                    .pending
                    .as_mut()
                    .ok_or_else(|| "event without a commit header".to_owned())?;
                let index = count(group.events.len());
                ensure(
                    *event_index == index,
                    "event index is not contiguous from zero",
                )?;
                ensure(
                    commit_id == group.receipt.commit_id(),
                    "event commit id differs from its header",
                )?;
                ensure(
                    *event_count == group.receipt.effect_count(),
                    "event count differs from its header",
                )?;
                ensure(
                    header_cursor == &group.header_cursor,
                    "event header cursor differs from its header",
                )?;
                // Store identity plus exact position is full cursor equality: these are the
                // only cursor fields, and integration tests cannot construct a cursor directly.
                ensure(
                    cursor.store_identity() == group.header_cursor.store_identity(),
                    "event cursor belongs to a different store lineage",
                )?;
                let expected_position = position(&group.header_cursor)?
                    .checked_add(1)
                    .and_then(|next| next.checked_add(index));
                ensure(
                    Some(position(cursor)?) == expected_position,
                    "event cursor is not contiguous",
                )?;
                group.events.push(change.clone());
                group.last_cursor = cursor.clone();
            }
            _ => return Err("unknown outbox record kind".to_owned()),
        }
        let complete = self.pending.as_ref().is_some_and(Group::is_complete);
        if complete {
            let group = self
                .pending
                .take()
                .ok_or_else(|| "completed group vanished".to_owned())?;
            self.finish(&group, expected)?;
        }
        Ok(())
    }

    fn finish(&mut self, group: &Group, expected: Option<&Expected<'_>>) -> Res {
        if group.duplicate {
            let original = self.applied.get(group.receipt.commit_id());
            ensure(
                original == Some(&group.events),
                "duplicate delivery differs from the applied group",
            )?;
            self.duplicates_skipped += 1;
            return Ok(());
        }
        let expected = expected
            .ok_or_else(|| "no source receipt witness for a non-duplicate group".to_owned())?;
        ensure(
            &group.receipt == expected.receipt,
            "header receipt is not the committed receipt",
        )?;
        ensure(
            expected.receipt.verifies_changes(expected.changes),
            "committed receipt does not verify the writer's change set",
        )?;
        ensure(
            group.events.as_slice() == expected.changes.as_slice(),
            "events differ from the writer's change set",
        )?;
        ensure(
            Some(&group.last_cursor) == expected.receipt.outbox_end_cursor().as_ref(),
            "last event cursor is not the receipt end cursor",
        )?;
        ensure(
            group.receipt.sequence() == self.last_sequence + 1,
            "receipt sequence is stale or skipped",
        )?;
        self.apply(&group.events)?;
        self.applied
            .insert(group.receipt.commit_id().clone(), group.events.clone());
        self.last_sequence = group.receipt.sequence();
        self.applied_cursor = Some(group.last_cursor.clone());
        Ok(())
    }

    fn apply(&self, changes: &[SemanticChange]) -> Res {
        let mut tx = self
            .model
            .start_transaction()
            .ctx("open model transaction")?;
        for change in changes {
            match change {
                SemanticChange::QuadAdded(quad) => tx.insert(quad.clone()),
                SemanticChange::QuadRemoved(quad) => {
                    if !self.skip_quad_removals {
                        tx.remove(quad);
                    }
                }
                SemanticChange::NamedGraphCreated(name) => tx.insert_named_graph(name.clone()),
                SemanticChange::GraphCleared(name) => tx.clear_graph(name).ctx("clear graph")?,
                SemanticChange::NamedGraphDropped(name) => {
                    tx.remove_named_graph(name).ctx("drop graph")?;
                }
                SemanticChange::AllNamedGraphsCleared => {
                    tx.clear_all_named_graphs().ctx("clear all named")?;
                }
                SemanticChange::AllGraphsCleared => {
                    tx.clear_all_graphs().ctx("clear all graphs")?;
                }
                SemanticChange::AllNamedGraphsDropped => {
                    tx.remove_all_named_graphs().ctx("drop all named")?;
                }
                SemanticChange::DatasetCleared => tx.clear().ctx("clear dataset")?,
                SemanticChange::NamespaceChanged {
                    prefix,
                    before,
                    after,
                } => {
                    let current = tx
                        .namespace(prefix)
                        .ctx("read namespace")?
                        .map(|entry| entry.into_parts().1);
                    ensure(
                        &current == before,
                        "namespace change disagrees with the model's prior mapping",
                    )?;
                    match after {
                        Some(target) => tx
                            .set_namespace(Namespace::new(prefix.clone(), target.clone()))
                            .ctx("set namespace")?,
                        None => tx.remove_namespace(prefix).ctx("remove namespace")?,
                    }
                }
                SemanticChange::NamespacesCleared => {
                    tx.clear_namespaces().ctx("clear namespaces")?;
                }
                _ => return Err("unknown semantic change kind".to_owned()),
            }
        }
        tx.commit().ctx("model commit")
    }
}

// ------------------------------------------------------------------- driver

#[derive(Debug, Default)]
struct Report {
    comparisons: usize,
    witness_hits: usize,
    restarts: usize,
    header_only: usize,
}

struct Harness {
    source: Store,
    consumer: Consumer,
    keys: u64,
    report: Report,
    primary: Primary,
    closure: Closure,
}

fn high_water(store: &Store) -> Res<Option<OutboxCursor>> {
    Ok(store
        .read_outbox(None, NonZeroUsize::MIN)
        .ctx("read outbox")?
        .high_water()
        .cloned())
}

impl Harness {
    fn new(fault: bool) -> Res<Self> {
        let mut harness = Self {
            source: Store::new().ctx("source store")?,
            consumer: Consumer::new(fault)?,
            keys: 0,
            report: Report::default(),
            primary: Primary::default(),
            closure: Closure::default(),
        };
        harness.compare()?;
        Ok(harness)
    }

    fn compare(&mut self) -> Res {
        let (primary, closure) = compare_stores(&self.source, &self.consumer.model)?;
        self.report.comparisons += 1;
        let witness = type_of("fido", "Animal").to_string();
        if closure.quads.contains(&witness) && !primary.quads.contains(&witness) {
            self.report.witness_hits += 1;
        }
        self.primary = primary;
        self.closure = closure;
        Ok(())
    }

    fn step(&mut self, tx: &Tx, page: usize) -> Res {
        let high_before = high_water(&self.source)?;
        let primary_before = self.primary.clone();
        let closure_before = self.closure.clone();
        self.keys += 1;
        let staged = stage(&self.source, self.keys, &tx.ops)?;
        let committed = matches!(tx.end, End::Commit);
        match tx.end {
            End::Commit => {
                let changes = staged.changes().ctx("pending changes")?;
                let receipt = staged.commit().ctx("governed commit")?;
                ensure(
                    receipt.verifies_changes(&changes),
                    "receipt does not verify the captured changes",
                )?;
                self.catch_up(&receipt, &changes, page, tx.restart)?;
                ensure(
                    self.consumer.applied_cursor == receipt.outbox_end_cursor(),
                    "consumer cursor is not the receipt end cursor",
                )?;
                ensure(
                    self.consumer.last_sequence == receipt.sequence(),
                    "consumer sequence is not the receipt sequence",
                )?;
                ensure(
                    high_water(&self.source)? == receipt.outbox_end_cursor(),
                    "outbox high water is not the receipt end cursor",
                )?;
            }
            End::Rollback => staged.rollback().ctx("rollback")?,
            End::Drop => drop(staged),
        }
        if !committed {
            ensure(
                high_water(&self.source)? == high_before,
                "a non-committed transaction moved the outbox",
            )?;
        }
        self.compare()?;
        if !committed || tx.namespace_only() {
            ensure(
                self.primary.quads == primary_before.quads
                    && self.primary.graphs == primary_before.graphs,
                "RDF changed by a rolled back, dropped or namespace-only transaction",
            )?;
            ensure(
                self.closure == closure_before,
                "closure changed by a rolled back, dropped or namespace-only transaction",
            )?;
        }
        Ok(())
    }

    fn catch_up(
        &mut self,
        receipt: &CommitReceipt,
        changes: &SemanticChangeSet,
        page: usize,
        restart: bool,
    ) -> Res {
        let size = page_size(page)?;
        let expected = Expected { receipt, changes };
        let target = receipt.outbox_end_cursor();
        let mut restarted = false;
        if changes.is_empty() {
            self.report.header_only += 1;
        }
        for _ in 0..MAX_POLLS {
            if self.consumer.applied_cursor == target {
                return Ok(());
            }
            let batch = self
                .source
                .read_outbox(self.consumer.poll_cursor.as_ref(), size)
                .ctx("read outbox")?;
            ensure(
                !batch.records().is_empty(),
                "outbox ended before the commit was delivered",
            )?;
            self.consumer.deliver(batch.records(), Some(&expected))?;
            self.consumer.poll_cursor = batch.next_cursor().cloned();
            if restart && !restarted && self.consumer.is_pending() {
                self.consumer.restart();
                restarted = true;
                self.report.restarts += 1;
            }
        }
        Err("outbox delivery exceeded the poll bound".to_owned())
    }

    fn redeliver(&mut self) -> Res {
        let before = self.consumer.fingerprint()?;
        let skipped_before = self.consumer.duplicates_skipped;
        let size = page_size(2)?;
        self.consumer.rewind();
        let mut drained = false;
        for _ in 0..MAX_POLLS {
            let batch = self
                .source
                .read_outbox(self.consumer.poll_cursor.as_ref(), size)
                .ctx("read outbox")?;
            if batch.records().is_empty() {
                drained = true;
                break;
            }
            self.consumer.deliver(batch.records(), None)?;
            self.consumer.poll_cursor = batch.next_cursor().cloned();
        }
        ensure(drained, "redelivery did not drain within the poll bound")?;
        ensure(
            !self.consumer.is_pending(),
            "redelivery ended inside a group",
        )?;
        ensure(
            self.consumer.duplicates_skipped - skipped_before == self.consumer.applied.len(),
            "every committed group must be recognised as a duplicate",
        )?;
        ensure(
            self.consumer.fingerprint()? == before,
            "duplicate delivery changed the applied model",
        )?;
        self.consumer.restart();
        Ok(())
    }

    fn entailed(&self, quad: &Quad, expected: bool, what: &str) -> Res {
        let text = quad.to_string();
        ensure(
            self.closure.quads.contains(&text) == expected,
            &format!("{what}: closure membership should be {expected}"),
        )?;
        ensure(
            !self.primary.quads.contains(&text),
            &format!("{what}: entailed quad leaked into primary quads"),
        )
    }

    fn graph_present(&self, name: &NamedOrBlankNode, expected: bool, what: &str) -> Res {
        ensure(
            self.primary.graphs.contains(&name.to_string()) == expected,
            &format!("{what}: named-graph presence should be {expected}"),
        )
    }
}

fn run_trace(trace: &[Tx], fault: bool) -> Res<Report> {
    let mut harness = Harness::new(fault)?;
    for (index, tx) in trace.iter().enumerate() {
        let page = PAGES.get(index % PAGES.len()).copied().unwrap_or(1);
        harness
            .step(tx, page)
            .map_err(|error| format!("tx {index}: {error}"))?;
    }
    harness.redeliver()?;
    ensure(
        harness.report.comparisons == trace.len() + 1,
        "silent empty comparison: comparison count differs from step count",
    )?;
    Ok(harness.report)
}

// ---------------------------------------------------- seeded traces, shrinking

struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut mixed = self.0;
        mixed = (mixed ^ (mixed >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        mixed = (mixed ^ (mixed >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        mixed ^ (mixed >> 31)
    }

    fn below(&mut self, bound: usize) -> usize {
        let bound = u64::try_from(bound.max(1)).unwrap_or(1);
        usize::try_from(self.next_u64() % bound).unwrap_or(0)
    }
}

fn pick(rng: &mut Rng, items: &[&'static str]) -> &'static str {
    items.get(rng.below(items.len())).copied().unwrap_or("x")
}

fn pick_graph(rng: &mut Rng) -> GraphName {
    match rng.below(6) {
        0..=2 => GraphName::DefaultGraph,
        3 => graph("g1"),
        4 => graph("g2"),
        _ => GraphName::from(bnode("bg")),
    }
}

fn pick_named(rng: &mut Rng) -> NamedOrBlankNode {
    match rng.below(3) {
        0 => graph_node("g1"),
        1 => graph_node("g2"),
        _ => NamedOrBlankNode::from(bnode("bg")),
    }
}

fn gen_quad(rng: &mut Rng) -> Quad {
    let graph_name = pick_graph(rng);
    let type_predicate = NamedNode::from(rdf::TYPE);
    match rng.below(8) {
        0 | 1 => Quad::new(
            iri(pick(rng, &INDIVIDUALS)),
            type_predicate,
            iri(pick(rng, &CLASSES)),
            graph_name,
        ),
        2 => Quad::new(
            iri(pick(rng, &CLASSES)),
            NamedNode::from(rdfs::SUB_CLASS_OF),
            iri(pick(rng, &CLASSES)),
            graph_name,
        ),
        3 => Quad::new(
            iri(pick(rng, &PROPERTIES)),
            NamedNode::from(rdfs::DOMAIN),
            iri(pick(rng, &CLASSES)),
            graph_name,
        ),
        4 => Quad::new(
            iri(pick(rng, &PROPERTIES)),
            NamedNode::from(rdfs::RANGE),
            iri(pick(rng, &CLASSES)),
            graph_name,
        ),
        5 => Quad::new(
            iri(pick(rng, &PROPERTIES)),
            NamedNode::from(rdfs::SUB_PROPERTY_OF),
            iri(pick(rng, &PROPERTIES)),
            graph_name,
        ),
        6 => {
            if rng.below(3) == 0 {
                Quad::new(
                    iri(pick(rng, &INDIVIDUALS)),
                    iri(pick(rng, &PROPERTIES)),
                    bnode(pick(rng, &BLANKS)),
                    graph_name,
                )
            } else {
                Quad::new(
                    iri(pick(rng, &INDIVIDUALS)),
                    iri(pick(rng, &PROPERTIES)),
                    iri(pick(rng, &INDIVIDUALS)),
                    graph_name,
                )
            }
        }
        _ => Quad::new(
            bnode(pick(rng, &BLANKS)),
            type_predicate,
            Term::from(iri(pick(rng, &CLASSES))),
            graph_name,
        ),
    }
}

fn gen_op(rng: &mut Rng, history: &mut Vec<Quad>) -> Op {
    match rng.below(24) {
        10..=14 => {
            let picked = history.get(rng.below(history.len())).cloned();
            Op::Remove(picked.unwrap_or_else(|| gen_quad(rng)))
        }
        15 => Op::CreateGraph(pick_named(rng)),
        16 => Op::ClearGraph(if rng.below(4) == 0 {
            None
        } else {
            Some(pick_named(rng))
        }),
        17 => Op::DropGraph(pick_named(rng)),
        18 => Op::SetNamespace(
            pick(rng, &PREFIXES),
            iri(if rng.below(2) == 0 { "ns/a" } else { "ns/b" }),
        ),
        19 => Op::RemoveNamespace(pick(rng, &PREFIXES)),
        20 => Op::ClearNamespaces,
        21 => match rng.below(4) {
            0 => Op::ClearAllNamed,
            1 => Op::ClearAllGraphs,
            2 => Op::DropAllNamed,
            _ => Op::ClearAll,
        },
        _ => {
            let quad = gen_quad(rng);
            history.push(quad.clone());
            Op::Insert(quad)
        }
    }
}

fn generate(seed: u64) -> Vec<Tx> {
    let mut rng = Rng(seed);
    let prelude = vec![
        Op::Insert(sub_class("Dog", "Animal")),
        Op::Insert(type_of("fido", "Dog")),
    ];
    let mut history = vec![sub_class("Dog", "Animal"), type_of("fido", "Dog")];
    let mut trace = vec![commit(prelude)];
    let extra = 3 + rng.below(9);
    for _ in 0..extra {
        let op_count = rng.below(6);
        let mut ops = Vec::new();
        for _ in 0..op_count {
            ops.push(gen_op(&mut rng, &mut history));
        }
        let end = match rng.below(10) {
            0..=6 => End::Commit,
            7 | 8 => End::Rollback,
            _ => End::Drop,
        };
        trace.push(Tx {
            ops,
            end,
            restart: rng.below(6) == 0,
        });
    }
    trace
}

/// Diagnostic kind of a trace failure, independent of the failing transaction index and of
/// the concrete diverging terms, so that a shrunk trace must fail for the same reason.
fn diagnostic_category(error: &str) -> &str {
    let detail = error
        .strip_prefix("tx ")
        .and_then(|rest| rest.split_once(": "))
        .map_or(error, |(_, detail)| detail);
    detail.split([';', ':']).next().unwrap_or(detail).trim()
}

fn reproduces(trace: &[Tx], fault: bool, category: &str) -> bool {
    run_trace(trace, fault).is_err_and(|error| diagnostic_category(&error) == category)
}

fn op_count(trace: &[Tx]) -> usize {
    trace.iter().map(|tx| tx.ops.len()).sum()
}

fn shrink(trace: &[Tx], fault: bool, category: &str, budget: usize) -> Vec<Tx> {
    let mut best = trace.to_vec();
    let mut replays = 0;
    loop {
        let mut progressed = false;
        let mut index = 0;
        while index < best.len() {
            if replays >= budget {
                return best;
            }
            let mut candidate = best.clone();
            candidate.remove(index);
            replays += 1;
            if reproduces(&candidate, fault, category) {
                best = candidate;
                progressed = true;
            } else {
                index += 1;
            }
        }
        for tx_index in 0..best.len() {
            let mut op_index = 0;
            while op_index < best.get(tx_index).map_or(0, |tx| tx.ops.len()) {
                if replays >= budget {
                    return best;
                }
                let mut candidate = best.clone();
                if let Some(tx) = candidate.get_mut(tx_index) {
                    tx.ops.remove(op_index);
                }
                replays += 1;
                if reproduces(&candidate, fault, category) {
                    best = candidate;
                    progressed = true;
                } else {
                    op_index += 1;
                }
            }
        }
        if !progressed {
            return best;
        }
    }
}

fn seeds() -> Res<Vec<u64>> {
    match std::env::var("OXIGRAPH_PROJECTION_SEED") {
        Ok(value) => Ok(vec![
            value
                .trim()
                .parse::<u64>()
                .ctx("OXIGRAPH_PROJECTION_SEED")?,
        ]),
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_SEEDS.to_vec()),
        Err(error) => Err(error.to_string()),
    }
}

// --------------------------------------------- raw groups for negative controls

struct Committed {
    receipt: CommitReceipt,
    changes: SemanticChangeSet,
    records: Vec<OutboxRecord>,
}

impl Committed {
    fn expected(&self) -> Expected<'_> {
        Expected {
            receipt: &self.receipt,
            changes: &self.changes,
        }
    }
}

fn governed_commit(
    source: &Store,
    id: u64,
    ops: &[Op],
    after: Option<&OutboxCursor>,
) -> Res<Committed> {
    let staged = stage(source, id, ops)?;
    let changes = staged.changes().ctx("pending changes")?;
    let receipt = staged.commit().ctx("governed commit")?;
    ensure(
        receipt.verifies_changes(&changes),
        "receipt does not verify the captured changes",
    )?;
    let records = source
        .read_outbox(after, page_size(1000)?)
        .ctx("read outbox")?
        .records()
        .to_vec();
    Ok(Committed {
        receipt,
        changes,
        records,
    })
}

fn cursor_at(records: &[OutboxRecord], at: usize) -> Res<OutboxCursor> {
    records
        .get(at)
        .map(|record| record.cursor().clone())
        .ok_or_else(|| format!("no outbox record at index {at}"))
}

struct EventEdit {
    cursor: OutboxCursor,
    header_cursor: OutboxCursor,
    commit_id: CommitId,
    event_index: u64,
    event_count: u64,
    change: SemanticChange,
}

fn edit_event(
    records: &[OutboxRecord],
    at: usize,
    edit: impl FnOnce(&mut EventEdit),
) -> Res<Vec<OutboxRecord>> {
    let mut edited = records.to_vec();
    let Some(OutboxRecord::Event {
        cursor,
        header_cursor,
        commit_id,
        event_index,
        event_count,
        change,
    }) = edited.get_mut(at)
    else {
        return Err("record is not an event".to_owned());
    };
    let mut fields = EventEdit {
        cursor: cursor.clone(),
        header_cursor: header_cursor.clone(),
        commit_id: commit_id.clone(),
        event_index: *event_index,
        event_count: *event_count,
        change: change.clone(),
    };
    edit(&mut fields);
    *cursor = fields.cursor;
    *header_cursor = fields.header_cursor;
    *commit_id = fields.commit_id;
    *event_index = fields.event_index;
    *event_count = fields.event_count;
    *change = fields.change;
    Ok(edited)
}

fn edit_header(
    records: &[OutboxRecord],
    edit: impl FnOnce(&mut OutboxCursor, &mut CommitReceipt),
) -> Res<Vec<OutboxRecord>> {
    let mut edited = records.to_vec();
    let Some(OutboxRecord::Commit { cursor, receipt }) = edited.first_mut() else {
        return Err("first record is not a header".to_owned());
    };
    edit(cursor, receipt);
    Ok(edited)
}

fn expect_rejected(
    consumer: &mut Consumer,
    name: &str,
    records: &[OutboxRecord],
    expected: Option<&Expected<'_>>,
    baseline: &Fingerprint,
) -> Res<String> {
    let Err(error) = consumer.deliver(records, expected) else {
        return Err(format!("{name} was accepted"));
    };
    ensure(
        !consumer.is_pending(),
        &format!("{name} left a buffered group"),
    )?;
    ensure(
        &consumer.fingerprint()? == baseline,
        &format!("{name} changed model or consumer state"),
    )?;
    Ok(error)
}

// -------------------------------------------------------------------- tests

#[test]
fn fixed_trace_full_scenario() -> Res {
    let mut h = Harness::new(false)?;
    let dog = type_of("fido", "Dog");
    let pet = type_of("fido", "Pet");
    let animal = type_of("fido", "Animal");
    let dog_sub = sub_class("Dog", "Animal");
    let pet_sub = sub_class("Pet", "Animal");
    let g1 = graph("g1");
    let g1_node = graph_node("g1");
    let g2_node = graph_node("g2");
    let bg = GraphName::from(bnode("bg"));
    let bg_node = NamedOrBlankNode::from(bnode("bg"));
    let animal_in_g1 = with_graph(&animal, g1.clone());

    // insert, entailment, alternate supports
    h.step(
        &commit(vec![Op::Insert(dog_sub.clone()), Op::Insert(dog.clone())]),
        1,
    )?;
    h.entailed(&animal, true, "subclass entailment")?;
    h.step(
        &commit(vec![Op::Insert(pet.clone()), Op::Insert(pet_sub.clone())]),
        2,
    )?;
    h.step(&commit(vec![Op::Remove(dog.clone())]), 3)?;
    h.entailed(&animal, true, "alternate support keeps entailment")?;
    h.step(&commit(vec![Op::Remove(pet_sub)]), 100)?;
    h.entailed(&animal, false, "last support removed")?;

    // recursive subclass cycle, then schema deletion (mid-group restart on page size 1)
    let member = type_of("x", "ca");
    let member_of_cb = type_of("x", "cb");
    let mut cycle = commit(vec![
        Op::Insert(sub_class("ca", "cb")),
        Op::Insert(sub_class("cb", "ca")),
        Op::Insert(member),
    ]);
    cycle.restart = true;
    h.step(&cycle, 1)?;
    h.entailed(&member_of_cb, true, "cycle entailment")?;
    h.step(&commit(vec![Op::Remove(sub_class("cb", "ca"))]), 2)?;
    h.entailed(&member_of_cb, true, "one cycle edge still supports")?;
    h.step(&commit(vec![Op::Remove(sub_class("ca", "cb"))]), 3)?;
    h.entailed(&member_of_cb, false, "schema edge deleted")?;

    // graph create / clear / drop / recreate, with rollback and drop
    h.step(
        &commit(vec![
            Op::CreateGraph(g1_node.clone()),
            Op::Insert(with_graph(&dog, g1.clone())),
            Op::Insert(with_graph(&dog_sub, g1.clone())),
        ]),
        2,
    )?;
    h.entailed(&animal_in_g1, true, "graph-local entailment")?;
    h.step(
        &ended(
            vec![
                Op::ClearGraph(Some(g1_node.clone())),
                Op::CreateGraph(g2_node.clone()),
            ],
            End::Rollback,
        ),
        1,
    )?;
    h.graph_present(&g2_node, false, "rolled back graph creation")?;
    h.entailed(&animal_in_g1, true, "rollback keeps graph contents")?;
    h.step(&ended(vec![Op::DropGraph(g1_node.clone())], End::Drop), 2)?;
    h.graph_present(&g1_node, true, "dropped transaction keeps graph")?;
    h.step(&commit(vec![Op::ClearGraph(Some(g1_node.clone()))]), 100)?;
    h.graph_present(&g1_node, true, "cleared graph stays as empty topology")?;
    h.entailed(&animal_in_g1, false, "cleared graph has no entailment")?;
    h.step(&commit(vec![Op::DropGraph(g1_node.clone())]), 1)?;
    h.graph_present(&g1_node, false, "dropped graph")?;
    h.step(
        &commit(vec![
            Op::CreateGraph(g1_node.clone()),
            Op::Insert(with_graph(&dog, g1.clone())),
        ]),
        2,
    )?;
    h.graph_present(&g1_node, true, "recreated graph")?;
    h.entailed(&animal_in_g1, false, "entailment stays graph-local")?;

    // empty commit and an all-no-op commit: header-only groups
    h.step(&commit(Vec::new()), 1)?;
    h.step(&commit(vec![Op::Insert(with_graph(&dog, g1.clone()))]), 2)?;

    // blank-node subject, object and graph-name identity
    let blank_type = Quad::new(
        bnode("b1"),
        NamedNode::from(rdf::TYPE),
        iri("Dog"),
        bg.clone(),
    );
    let blank_animal = Quad::new(
        bnode("b1"),
        NamedNode::from(rdf::TYPE),
        iri("Animal"),
        bg.clone(),
    );
    h.step(
        &commit(vec![
            Op::CreateGraph(bg_node.clone()),
            Op::Insert(blank_type.clone()),
            Op::Insert(with_graph(&dog_sub, bg.clone())),
            Op::Insert(Quad::new(
                bnode("b1"),
                iri("p"),
                bnode("b2"),
                GraphName::DefaultGraph,
            )),
            Op::Insert(Quad::new(
                iri("fido"),
                iri("p"),
                bnode("b1"),
                GraphName::DefaultGraph,
            )),
        ]),
        2,
    )?;
    h.entailed(&blank_animal, true, "blank node in blank graph")?;
    h.step(&commit(vec![Op::Remove(blank_type)]), 100)?;
    h.entailed(&blank_animal, false, "blank support removed")?;
    h.graph_present(&bg_node, true, "blank graph name preserved")?;

    // namespace records are never RDF
    h.step(
        &commit(vec![
            Op::SetNamespace("ex", iri("ns/a")),
            Op::SetNamespace("dc", iri("ns/b")),
            Op::SetNamespace("", iri("ns/a")),
        ]),
        1,
    )?;
    ensure(
        h.primary.namespaces.len() == 3,
        "three namespace records expected",
    )?;
    ensure(
        !h.primary
            .quads
            .iter()
            .chain(&h.closure.quads)
            .any(|quad| quad.contains(NAMESPACE_MARKER)),
        "namespace record leaked into RDF",
    )?;
    h.step(
        &commit(vec![
            Op::SetNamespace("ex", iri("ns/b")),
            Op::RemoveNamespace("dc"),
        ]),
        2,
    )?;
    ensure(
        h.primary.namespaces.len() == 2,
        "two namespace records expected",
    )?;
    h.step(&commit(vec![Op::ClearNamespaces]), 3)?;
    ensure(
        h.primary.namespaces.is_empty(),
        "namespaces should be cleared",
    )?;
    h.step(
        &ended(vec![Op::SetNamespace("ex", iri("ns/a"))], End::Rollback),
        1,
    )?;
    h.step(
        &ended(vec![Op::SetNamespace("ex", iri("ns/a"))], End::Drop),
        2,
    )?;
    ensure(
        h.primary.namespaces.is_empty(),
        "non-committed namespace write became visible",
    )?;

    // aggregate lifecycle operations; RDF clear never clears namespaces
    let y_dog = type_of("y", "Dog");
    h.step(
        &commit(vec![
            Op::SetNamespace("ex", iri("ns/a")),
            Op::Insert(with_graph(&y_dog, graph("g2"))),
            Op::Insert(y_dog.clone()),
            Op::ClearAllNamed,
            Op::DropAllNamed,
            Op::ClearAllGraphs,
            Op::Insert(dog_sub.clone()),
            Op::Insert(y_dog),
        ]),
        1,
    )?;
    h.entailed(&type_of("y", "Animal"), true, "after aggregate operations")?;
    h.graph_present(&g1_node, false, "drop all named graphs")?;
    h.graph_present(&bg_node, false, "drop all named graphs (blank)")?;
    h.step(&commit(vec![Op::ClearAll]), 100)?;
    ensure(h.primary.quads.is_empty(), "dataset clear left quads")?;
    ensure(
        h.primary.namespaces.len() == 1,
        "RDF clear must not clear namespaces",
    )?;
    h.step(
        &commit(vec![
            Op::ClearNamespaces,
            Op::Insert(type_of("z", "Dog")),
            Op::ClearGraph(None),
        ]),
        2,
    )?;
    ensure(h.primary.namespaces.is_empty(), "namespace clear failed")?;
    ensure(h.primary.quads.is_empty(), "default graph clear failed")?;

    // duplicate delivery of the entire feed
    h.redeliver()?;
    ensure(
        h.report.comparisons == 26,
        "unexpected comparison count for the fixed trace",
    )?;
    ensure(
        h.report.restarts >= 1,
        "mid-group restart was not exercised",
    )?;
    ensure(
        h.report.header_only >= 2,
        "header-only groups not exercised",
    )?;
    ensure(
        h.consumer.duplicates_skipped > 0,
        "no duplicate group was skipped",
    )?;
    Ok(())
}

#[test]
fn seeded_traces_bounded() -> Res {
    let mut comparisons = 0;
    for seed in seeds()? {
        let trace = generate(seed);
        match run_trace(&trace, false) {
            Ok(report) => {
                ensure(
                    report.comparisons == trace.len() + 1,
                    "seeded trace compared fewer states than steps",
                )?;
                ensure(
                    report.witness_hits >= 1,
                    "seeded trace never observed a non-primary entailed quad",
                )?;
                comparisons += report.comparisons;
            }
            Err(error) => {
                let category = diagnostic_category(&error);
                let shrunk = shrink(&trace, false, category, SHRINK_BUDGET);
                return Err(format!(
                    "seed {seed} failed: {error}\nreproduce with OXIGRAPH_PROJECTION_SEED={seed}\n\
                     shrunk trace preserving `{category}` ({} tx): {shrunk:#?}",
                    shrunk.len()
                ));
            }
        }
    }
    ensure(comparisons > 0, "no comparison was executed")
}

#[test]
fn shrinker_minimizes_injected_fault() -> Res {
    let removed = type_of("fido", "Dog");
    let trace = vec![
        commit(vec![
            Op::Insert(sub_class("Dog", "Animal")),
            Op::Insert(removed.clone()),
        ]),
        commit(vec![Op::Insert(type_of("rex", "Dog"))]),
        ended(vec![Op::Insert(type_of("tom", "Cat"))], End::Rollback),
        commit(vec![Op::Remove(removed)]),
        commit(vec![Op::SetNamespace("ex", iri("ns/a"))]),
        commit(vec![Op::Insert(type_of("rex", "Pet"))]),
    ];
    ensure(
        run_trace(&trace, false).is_ok(),
        "the fault-free replay must agree with the source",
    )?;
    let Err(original) = run_trace(&trace, true) else {
        return Err("an injected missing-removal fault escaped the comparison".to_owned());
    };
    let category = diagnostic_category(&original);
    ensure(
        category == "primary quads diverged",
        &format!("injected fault produced an unexpected diagnostic: {original}"),
    )?;
    let shrunk = shrink(&trace, true, category, SHRINK_BUDGET);
    ensure(
        shrunk.len() < trace.len(),
        "shrinker did not reduce the failing trace",
    )?;
    ensure(
        run_trace(&shrunk, true).is_err(),
        "shrunk trace no longer fails",
    )?;
    ensure(
        reproduces(&shrunk, true, category),
        "shrunk trace fails for a different reason than the original",
    )?;
    ensure(
        run_trace(&shrunk, false).is_ok(),
        "shrunk trace fails without the injected fault",
    )?;
    // A diagnostic this trace never produces must not let any candidate count as failing.
    let unrelated = shrink(&trace, true, "unrelated diagnostic", SHRINK_BUDGET);
    ensure(
        unrelated.len() == trace.len() && op_count(&unrelated) == op_count(&trace),
        "shrinker accepted a candidate failing for a different reason",
    )
}

#[test]
fn negative_controls_leave_no_partial_model() -> Res {
    let source = Store::new().ctx("source store")?;
    let mut consumer = Consumer::new(false)?;
    let g1 = governed_commit(&source, 1, &[Op::Insert(sub_class("Dog", "Animal"))], None)?;
    consumer.deliver(&g1.records, Some(&g1.expected()))?;
    let g2_ops = [
        Op::Insert(type_of("fido", "Dog")),
        Op::Insert(type_of("rex", "Dog")),
        Op::Insert(type_of("tom", "Dog")),
    ];
    let g2 = governed_commit(&source, 2, &g2_ops, g1.receipt.outbox_end_cursor().as_ref())?;
    let g3 = governed_commit(
        &source,
        3,
        &[Op::Insert(type_of("ann", "Dog"))],
        g2.receipt.outbox_end_cursor().as_ref(),
    )?;
    ensure(
        g2.records.len() == 4,
        "fixture needs a header and three distinct events",
    )?;
    let g2_expected = g2.expected();
    let baseline = consumer.fingerprint()?;

    // A separate lineage supplies checksum-valid cursors at exactly g2's positions.
    let foreign_store = Store::new().ctx("foreign store")?;
    let foreign_ops: Vec<Op> = ["a", "b", "c", "d", "e"]
        .into_iter()
        .map(|name| Op::Insert(type_of(name, "Dog")))
        .collect();
    let foreign = governed_commit(&foreign_store, 1, &foreign_ops, None)?;
    ensure(
        foreign.records.len() == 6,
        "foreign fixture needs a header and five events",
    )?;
    let g2_header = cursor_at(&g2.records, 0)?;
    let g2_middle = cursor_at(&g2.records, 2)?;
    let g2_last = cursor_at(&g2.records, 3)?;
    let foreign_header = cursor_at(&foreign.records, 2)?;
    let foreign_middle = cursor_at(&foreign.records, 4)?;
    let foreign_last = cursor_at(&foreign.records, 5)?;
    for (ours, theirs) in [
        (&g2_header, &foreign_header),
        (&g2_middle, &foreign_middle),
        (&g2_last, &foreign_last),
    ] {
        ensure(
            position(ours)? == position(theirs)?
                && ours.store_identity() != theirs.store_identity(),
            "foreign cursor must share the position but not the store lineage",
        )?;
    }

    let mut dropped_middle = g2.records.clone();
    dropped_middle.remove(2);
    let mut swapped = g2.records.clone();
    swapped.swap(1, 2);
    let headerless: Vec<OutboxRecord> = g2.records.iter().skip(1).cloned().collect();
    let mallory = SemanticChange::QuadAdded(type_of("mallory", "Dog"));
    let rejected = [
        (
            "dropped middle event",
            "event index is not contiguous",
            dropped_middle,
        ),
        ("swapped events", "event index is not contiguous", swapped),
        (
            "events without header",
            "event without a commit header",
            headerless,
        ),
        (
            "mutated event index",
            "event index is not contiguous",
            edit_event(&g2.records, 2, |fields| fields.event_index = 9)?,
        ),
        (
            "mutated event count",
            "event count differs from its header",
            edit_event(&g2.records, 1, |fields| fields.event_count += 1)?,
        ),
        (
            "mutated change",
            "events differ from the writer's change set",
            edit_event(&g2.records, 2, |fields| fields.change = mallory)?,
        ),
        (
            "foreign commit id",
            "event commit id differs from its header",
            edit_event(&g2.records, 2, |fields| {
                fields.commit_id.clone_from(g1.receipt.commit_id());
            })?,
        ),
        (
            "wrong header receipt",
            "header cursor disagrees with its receipt",
            edit_header(&g2.records, |_, receipt| receipt.clone_from(&g1.receipt))?,
        ),
        (
            "foreign-lineage header cursor",
            "header cursor disagrees with its receipt",
            edit_header(&g2.records, |cursor, _| cursor.clone_from(&foreign_header))?,
        ),
        (
            "foreign-lineage event header cursor",
            "event header cursor differs from its header",
            edit_event(&g2.records, 1, |fields| {
                fields.header_cursor.clone_from(&foreign_header);
            })?,
        ),
        (
            "foreign-lineage middle event cursor",
            "event cursor belongs to a different store lineage",
            edit_event(&g2.records, 2, |fields| {
                fields.cursor.clone_from(&foreign_middle);
            })?,
        ),
        (
            "foreign-lineage final event cursor",
            "event cursor belongs to a different store lineage",
            edit_event(&g2.records, 3, |fields| {
                fields.cursor.clone_from(&foreign_last);
            })?,
        ),
        (
            "shifted event cursor",
            "event cursor is not contiguous",
            edit_event(&g2.records, 2, |fields| fields.cursor.clone_from(&g2_last))?,
        ),
    ];
    for (name, fragment, records) in &rejected {
        let error = expect_rejected(&mut consumer, name, records, Some(&g2_expected), &baseline)?;
        ensure(
            error.contains(fragment),
            &format!("{name} was rejected for another reason: {error}"),
        )?;
    }
    let error = expect_rejected(
        &mut consumer,
        "skipped receipt sequence",
        &g3.records,
        Some(&g3.expected()),
        &baseline,
    )?;
    ensure(
        error.contains("receipt sequence is stale or skipped"),
        &format!("skipped receipt sequence was rejected for another reason: {error}"),
    )?;
    let error = expect_rejected(
        &mut consumer,
        "missing receipt witness",
        &g2.records,
        None,
        &baseline,
    )?;
    ensure(
        error.contains("no source receipt witness"),
        &format!("missing receipt witness was rejected for another reason: {error}"),
    )?;

    // A truncated group buffers without applying anything.
    let mut truncated = g2.records.clone();
    truncated.pop();
    consumer.deliver(&truncated, Some(&g2_expected))?;
    ensure(
        consumer.is_pending(),
        "truncated group must stay incomplete",
    )?;
    ensure(
        primary(&consumer.model)? == baseline.model,
        "truncated group partially changed the model",
    )?;
    consumer.restart();
    ensure(
        consumer.fingerprint()? == baseline,
        "restart after truncation changed consumer state",
    )?;

    // Clean redelivery succeeds and duplicates are harmless.
    consumer.deliver(&g2.records, Some(&g2_expected))?;
    consumer.deliver(&g3.records, Some(&g3.expected()))?;
    compare_stores(&source, &consumer.model)?;
    let settled = consumer.fingerprint()?;
    consumer.deliver(&g2.records, None)?;
    ensure(
        consumer.fingerprint()? == settled,
        "duplicate delivery changed the model",
    )?;
    ensure(
        consumer.duplicates_skipped == 1,
        "duplicate delivery was not recognised",
    )
}

#[test]
fn mid_apply_failure_rolls_back_the_model_transaction() -> Res {
    let source = Store::new().ctx("source store")?;
    let mut consumer = Consumer::new(false)?;
    let staged = type_of("fido", "Dog");
    let group = governed_commit(
        &source,
        1,
        &[
            Op::Insert(staged.clone()),
            Op::SetNamespace("ex", iri("ns/a")),
        ],
        None,
    )?;
    let expected = group.expected();
    ensure(
        matches!(
            group.changes.as_slice(),
            [
                SemanticChange::QuadAdded(first),
                SemanticChange::NamespaceChanged {
                    before: None,
                    after: Some(_),
                    ..
                },
            ] if *first == staged
        ),
        "fixture needs a staged quad addition before a namespace change from no mapping",
    )?;

    // An ungoverned model write makes the later namespace before-state disagree, so the
    // failure happens inside the model transaction after the quad addition was staged.
    let prefix = NamespacePrefix::new("ex").ctx("namespace prefix")?;
    consumer
        .model
        .set_namespace(Namespace::new(prefix.clone(), iri("ns/b")))
        .ctx("seed conflicting model namespace")?;
    let baseline = consumer.fingerprint()?;
    let error = expect_rejected(
        &mut consumer,
        "namespace before-state mismatch after a staged addition",
        &group.records,
        Some(&expected),
        &baseline,
    )?;
    ensure(
        error.contains("namespace change disagrees with the model's prior mapping"),
        &format!("group was not rejected inside the model transaction: {error}"),
    )?;
    ensure(
        !consumer.model.contains(&staged).ctx("model contains")?,
        "staged quad addition survived the failed model transaction",
    )?;
    ensure(
        consumer.applied.is_empty()
            && consumer.applied_cursor.is_none()
            && consumer.last_sequence == 0,
        "failed apply advanced consumer bookkeeping",
    )?;

    // Once the conflict is removed, the same witnessed group applies atomically.
    consumer
        .model
        .remove_namespace(&prefix)
        .ctx("remove conflicting model namespace")?;
    consumer.deliver(&group.records, Some(&expected))?;
    compare_stores(&source, &consumer.model)?;
    ensure(
        consumer.model.contains(&staged).ctx("model contains")?,
        "clean delivery did not apply the quad",
    )?;
    ensure(
        consumer.last_sequence == group.receipt.sequence()
            && consumer.applied_cursor == group.receipt.outbox_end_cursor(),
        "clean delivery did not advance to the receipt",
    )
}

#[test]
fn cursor_alone_cannot_prove_strict_freshness() -> Res {
    let source = Store::new().ctx("source store")?;
    let mut consumer = Consumer::new(false)?;
    let g1 = governed_commit(
        &source,
        1,
        &[
            Op::Insert(sub_class("Dog", "Animal")),
            Op::Insert(type_of("fido", "Dog")),
        ],
        None,
    )?;
    consumer.deliver(&g1.records, Some(&g1.expected()))?;
    compare_stores(&source, &consumer.model)?;
    let high = high_water(&source)?;
    ensure(
        high.is_some() && consumer.applied_cursor == high,
        "consumer cursor should sit at the outbox high water",
    )?;

    // An ungoverned write changes the source and its closure but not the feed.
    source
        .insert(type_of("rex", "Dog"))
        .ctx("ungoverned insert")?;
    let page = source
        .read_outbox(consumer.applied_cursor.as_ref(), page_size(10)?)
        .ctx("re-poll")?;
    ensure(
        page.records().is_empty(),
        "ungoverned write produced outbox records",
    )?;
    ensure(
        page.high_water().cloned() == high,
        "ungoverned write moved the outbox high water",
    )?;
    ensure(
        consumer.applied_cursor.as_ref() == page.high_water(),
        "cursor no longer looks fresh",
    )?;

    // The cursor still claims freshness while the comparison reports divergence.
    let rex_animal = type_of("rex", "Animal").to_string();
    let source_primary = primary(&source)?;
    let model_primary = primary(&consumer.model)?;
    ensure(
        source_primary.quads != model_primary.quads,
        "primary divergence went undetected",
    )?;
    ensure(
        closure(&source)?.quads.contains(&rex_animal)
            && !closure(&consumer.model)?.quads.contains(&rex_animal),
        "closure divergence went undetected",
    )?;

    // A later governed commit is delivered cleanly but does not repair the divergence.
    let g2 = governed_commit(
        &source,
        2,
        &[Op::Insert(type_of("fido", "Pet"))],
        high.as_ref(),
    )?;
    consumer.deliver(&g2.records, Some(&g2.expected()))?;
    ensure(
        consumer.applied_cursor == high_water(&source)?,
        "cursor should track the new high water",
    )?;
    ensure(
        primary(&source)?.quads != primary(&consumer.model)?.quads,
        "a later governed commit must not repair an ungoverned write",
    )?;
    ensure(
        !closure(&consumer.model)?.quads.contains(&rex_animal),
        "model closure gained an unreplayed entailment",
    )
}
