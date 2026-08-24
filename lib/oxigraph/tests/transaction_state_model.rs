#![expect(
    clippy::panic,
    clippy::tests_outside_test_module,
    reason = "the test harness panics with backend, replay seed, and minimized trace diagnostics"
)]

use oxigraph::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::store::{Store, TransactionalDataset, WritableDataset};
use std::collections::BTreeSet;
use std::convert::Infallible;
use std::sync::{Mutex, MutexGuard};

const TRACE_COUNT: u64 = 10_000;
const OPERATIONS_PER_TRACE: usize = 6;
const FIRST_SEED: u64 = 0x6f78_6967_7261_7068;
const GENERATOR_VERSION: &str = "xorshift64-v1";

#[derive(Clone, Copy, Debug)]
enum Operation {
    InsertQuad(u8),
    RemoveQuad(u8),
    CreateGraph(u8),
    ClearGraph(u8),
    DropGraph(u8),
    ClearAllNamedGraphs,
    ClearAllGraphs,
    RemoveAllNamedGraphs,
    ClearStore,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Terminal {
    Commit,
    Rollback,
    Drop,
}

#[derive(Clone, Debug)]
struct Trace {
    seed: u64,
    operations: Vec<Operation>,
    terminal: Terminal,
}

impl Trace {
    fn generate(seed: u64) -> Self {
        let mut random = XorShift64::new(seed);
        let operations = std::iter::repeat_with(|| {
            let argument = random.next().to_le_bytes()[0];
            match random.next() % 9 {
                0 => Operation::InsertQuad(argument),
                1 => Operation::RemoveQuad(argument),
                2 => Operation::CreateGraph(argument),
                3 => Operation::ClearGraph(argument),
                4 => Operation::DropGraph(argument),
                5 => Operation::ClearAllNamedGraphs,
                6 => Operation::ClearAllGraphs,
                7 => Operation::RemoveAllNamedGraphs,
                _ => Operation::ClearStore,
            }
        })
        .take(OPERATIONS_PER_TRACE)
        .collect();
        let terminal = match random.next() % 3 {
            0 => Terminal::Commit,
            1 => Terminal::Rollback,
            _ => Terminal::Drop,
        };
        Self {
            seed,
            operations,
            terminal,
        }
    }
}

#[derive(Debug, Default, Eq, PartialEq)]
struct DatasetSnapshot {
    quads: BTreeSet<String>,
    named_graphs: BTreeSet<String>,
}

#[derive(Default)]
struct ReferenceDataset {
    quads: Vec<Quad>,
    named_graphs: Vec<NamedOrBlankNode>,
}

impl ReferenceDataset {
    fn apply(&mut self, operation: Operation) {
        match operation {
            Operation::InsertQuad(index) => {
                let quad = quad(index);
                if !self.quads.contains(&quad) {
                    self.quads.push(quad);
                }
                if let Some(graph) = quad_named_graph(index) {
                    self.insert_graph(graph);
                }
            }
            Operation::RemoveQuad(index) => {
                let quad = quad(index);
                self.quads.retain(|candidate| candidate != &quad);
            }
            Operation::CreateGraph(index) => self.insert_graph(named_graph(index)),
            Operation::ClearGraph(index) => {
                let graph_name = graph_name(index);
                self.quads
                    .retain(|candidate| candidate.graph_name != graph_name);
            }
            Operation::DropGraph(index) => {
                let graph = named_graph(index);
                let graph_name = GraphName::from(graph.clone());
                self.quads
                    .retain(|candidate| candidate.graph_name != graph_name);
                self.named_graphs.retain(|candidate| candidate != &graph);
            }
            Operation::ClearAllNamedGraphs => self
                .quads
                .retain(|candidate| candidate.graph_name.is_default_graph()),
            Operation::ClearAllGraphs => self.quads.clear(),
            Operation::RemoveAllNamedGraphs => {
                self.quads
                    .retain(|candidate| candidate.graph_name.is_default_graph());
                self.named_graphs.clear();
            }
            Operation::ClearStore => {
                self.quads.clear();
                self.named_graphs.clear();
            }
        }
    }

    fn insert_graph(&mut self, graph: NamedOrBlankNode) {
        if !self.named_graphs.contains(&graph) {
            self.named_graphs.push(graph);
        }
    }

    fn snapshot(&self) -> DatasetSnapshot {
        DatasetSnapshot {
            quads: self.quads.iter().map(ToString::to_string).collect(),
            named_graphs: self.named_graphs.iter().map(ToString::to_string).collect(),
        }
    }
}

struct XorShift64(u64);

impl XorShift64 {
    fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }

    fn next(&mut self) -> u64 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value;
        value
    }
}

#[derive(Default)]
struct RewrittenPersistencePlane {
    dataset: Mutex<Dataset>,
}

struct RewrittenTransaction<'a> {
    target: &'a Mutex<Dataset>,
    staged: Dataset,
}

impl TransactionalDataset for RewrittenPersistencePlane {
    type Error = Infallible;
    type Transaction<'a> = RewrittenTransaction<'a>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        let staged = lock_dataset(&self.dataset).clone();
        Ok(RewrittenTransaction {
            target: &self.dataset,
            staged,
        })
    }
}

impl WritableDataset for RewrittenTransaction<'_> {
    type Error = Infallible;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Infallible>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Infallible>> + 'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        let subject = subject.cloned();
        let predicate = predicate.cloned();
        let object = object.cloned();
        let graph_name = graph_name.map(Option::<&NamedOrBlankNode>::cloned);
        Box::new(
            self.staged
                .iter()
                .filter(move |quad| {
                    subject.as_ref().is_none_or(|term| term == &quad.subject)
                        && predicate
                            .as_ref()
                            .is_none_or(|term| term == &quad.predicate)
                        && object.as_ref().is_none_or(|term| term == &quad.object)
                        && match &graph_name {
                            Some(None) => quad.graph_name.is_default_graph(),
                            Some(Some(graph_name)) => {
                                quad.graph_name == GraphName::from(graph_name.clone())
                            }
                            None => !quad.graph_name.is_default_graph(),
                        }
                })
                .map(Ok),
        )
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        Box::new(self.staged.named_graphs().map(Ok))
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        Ok(self.staged.contains_named_graph(graph_name.as_ref()))
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.staged.insert(quad);
        Ok(())
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.staged.remove(quad.as_ref());
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.insert_named_graph(graph_name);
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        let graph_name = graph_name.map_or(GraphName::DefaultGraph, |graph_name| {
            GraphName::from(graph_name.clone())
        });
        self.staged.clear_graph(&graph_name);
        Ok(())
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.clear_graph(&GraphName::from(graph_name));
        }
        Ok(())
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.staged.clear_graph(&GraphName::DefaultGraph);
        self.clear_all_named_graphs()
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.remove_named_graph(graph_name.as_ref());
        Ok(())
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.remove_named_graph(graph_name.as_ref());
        }
        Ok(())
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        self.staged.clear();
        Ok(())
    }

    fn commit(self) -> Result<(), Self::Error> {
        *lock_dataset(self.target) = self.staged;
        Ok(())
    }

    fn rollback(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

fn lock_dataset(dataset: &Mutex<Dataset>) -> MutexGuard<'_, Dataset> {
    match dataset.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn named_graph(index: u8) -> NamedOrBlankNode {
    NamedNode::new_unchecked(format!("urn:oxigraph:state-model:graph:{}", index % 4)).into()
}

fn graph_name(index: u8) -> GraphName {
    if index.is_multiple_of(4) {
        GraphName::DefaultGraph
    } else {
        named_graph(index).into()
    }
}

fn quad_named_graph(index: u8) -> Option<NamedOrBlankNode> {
    if index.is_multiple_of(4) {
        None
    } else {
        Some(named_graph(index))
    }
}

fn quad(index: u8) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:oxigraph:state-model:subject:{}", index % 5)),
        NamedNode::new_unchecked(format!("urn:oxigraph:state-model:predicate:{}", index % 3)),
        NamedNode::new_unchecked(format!("urn:oxigraph:state-model:object:{}", index % 7)),
        graph_name(index),
    )
}

fn apply_operation<T: WritableDataset>(
    transaction: &mut T,
    operation: Operation,
) -> Result<(), T::Error> {
    match operation {
        Operation::InsertQuad(index) => transaction.insert(quad(index)),
        Operation::RemoveQuad(index) => transaction.remove(&quad(index)),
        Operation::CreateGraph(index) => transaction.insert_named_graph(named_graph(index)),
        Operation::ClearGraph(index) => {
            let graph = quad_named_graph(index);
            transaction.clear_graph(graph.as_ref())
        }
        Operation::DropGraph(index) => transaction.remove_named_graph(&named_graph(index)),
        Operation::ClearAllNamedGraphs => transaction.clear_all_named_graphs(),
        Operation::ClearAllGraphs => transaction.clear_all_graphs(),
        Operation::RemoveAllNamedGraphs => transaction.remove_all_named_graphs(),
        Operation::ClearStore => transaction.clear(),
    }
}

fn snapshot<T: WritableDataset>(dataset: &T) -> Result<DatasetSnapshot, T::Error> {
    let mut quads = BTreeSet::new();
    for quad in dataset.quads_for_pattern(None, None, None, Some(None)) {
        quads.insert(quad?.to_string());
    }
    for quad in dataset.quads_for_pattern(None, None, None, None) {
        quads.insert(quad?.to_string());
    }
    let mut named_graphs = BTreeSet::new();
    for graph in dataset.named_graphs() {
        named_graphs.insert(graph?.to_string());
    }
    Ok(DatasetSnapshot {
        quads,
        named_graphs,
    })
}

fn committed_snapshot<D: TransactionalDataset>(dataset: &D) -> Result<DatasetSnapshot, D::Error> {
    let transaction = dataset.start_transaction()?;
    let result = snapshot(&transaction)?;
    transaction.rollback()?;
    Ok(result)
}

fn reset<D: TransactionalDataset>(dataset: &D) -> Result<(), D::Error> {
    let mut transaction = dataset.start_transaction()?;
    transaction.clear()?;
    transaction.commit()
}

fn evaluate<D: TransactionalDataset>(
    dataset: &D,
    trace: &Trace,
) -> Result<Option<String>, D::Error> {
    let mut transaction = dataset.start_transaction()?;
    let mut reference = ReferenceDataset::default();

    for (step, operation) in trace.operations.iter().copied().enumerate() {
        reference.apply(operation);
        apply_operation(&mut transaction, operation)?;
        let expected = reference.snapshot();
        let actual = snapshot(&transaction)?;
        if actual != expected {
            return Ok(Some(format!(
                "read-your-writes mismatch at step {step}: expected {expected:?}, got {actual:?}"
            )));
        }
    }

    let expected = if trace.terminal == Terminal::Commit {
        reference.snapshot()
    } else {
        DatasetSnapshot::default()
    };
    match trace.terminal {
        Terminal::Commit => transaction.commit()?,
        Terminal::Rollback => transaction.rollback()?,
        Terminal::Drop => drop(transaction),
    }
    let actual = committed_snapshot(dataset)?;
    let mismatch = if actual == expected {
        None
    } else {
        Some(format!(
            "terminal {:?} mismatch: expected {expected:?}, got {actual:?}",
            trace.terminal
        ))
    };
    if actual != DatasetSnapshot::default() {
        reset(dataset)?;
    }
    Ok(mismatch)
}

fn shrink<D: TransactionalDataset>(dataset: &D, trace: &Trace) -> Result<Trace, D::Error> {
    let mut minimized = trace.clone();
    let mut index = 0;
    while index < minimized.operations.len() {
        let mut candidate = minimized.clone();
        candidate.operations.remove(index);
        if evaluate(dataset, &candidate)?.is_some() {
            minimized = candidate;
        } else {
            index += 1;
        }
    }
    Ok(minimized)
}

fn run_backend<D: TransactionalDataset>(backend: &str, dataset: &D) {
    reset(dataset).unwrap_or_else(|error| panic!("{backend} state-model reset failed: {error}"));
    let seeds = if let Ok(value) = std::env::var("OXIGRAPH_TX_TRACE_SEED") {
        vec![parse_seed(&value).unwrap_or_else(|| {
            panic!("invalid OXIGRAPH_TX_TRACE_SEED {value:?}; expected decimal or 0x-prefixed hex")
        })]
    } else {
        (0..TRACE_COUNT)
            .map(|offset| FIRST_SEED.wrapping_add(offset))
            .collect()
    };
    for seed in seeds {
        let trace = Trace::generate(seed);
        match evaluate(dataset, &trace) {
            Ok(None) => {}
            Ok(Some(reason)) => {
                let minimized = shrink(dataset, &trace).unwrap_or_else(|error| {
                    panic!(
                        "{backend} state-model shrink failed; generator={GENERATOR_VERSION}; replay seed={:#018x}: {error}", trace.seed
                    )
                });
                panic!(
                    "{backend} state-model failure; generator={GENERATOR_VERSION}; replay seed={:#018x}; {reason}; minimized={minimized:?}",
                    trace.seed
                );
            }
            Err(error) => panic!(
                "{backend} state-model execution failed; generator={GENERATOR_VERSION}; replay seed={:#018x}; trace={trace:?}: {error}",
                trace.seed
            ),
        }
    }
}

fn parse_seed(value: &str) -> Option<u64> {
    value.strip_prefix("0x").map_or_else(
        || value.parse().ok(),
        |hex| u64::from_str_radix(hex, 16).ok(),
    )
}

#[test]
fn memory_matches_the_transaction_reference_model() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    run_backend("memory", &store);
    Ok(())
}

#[test]
fn rewritten_persistence_plane_matches_the_transaction_reference_model() {
    run_backend(
        "rewritten-persistence-plane",
        &RewrittenPersistencePlane::default(),
    );
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_matches_the_transaction_reference_model() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path())?;
    run_backend("rocksdb", &store);
    Ok(())
}
