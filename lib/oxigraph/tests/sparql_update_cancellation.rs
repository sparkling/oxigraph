#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert the public update-cancellation contract"
)]

use oxigraph::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{CancellationToken, SparqlEvaluator, UpdateEvaluationError};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use oxigraph::store::Store;
use oxigraph::store::{TransactionalDataset, WritableDataset};
use std::cell::{Cell, RefCell, RefMut};
use std::convert::Infallible;
use std::error::Error;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use std::io;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use std::sync::Arc;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use std::sync::mpsc::{self, RecvTimeoutError};
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use std::thread;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use std::time::Duration;

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
type TestError = Box<dyn Error + Send + Sync>;

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
const MUST_BLOCK_FOR: Duration = Duration::from_millis(100);
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
const CANCELLATION_BOUND: Duration = Duration::from_secs(1);

#[derive(Default)]
struct ProbeState {
    starts: Cell<usize>,
    mutations: Cell<usize>,
    mutation_after_cancellation: Cell<bool>,
    commits: Cell<usize>,
    rollbacks: Cell<usize>,
}

struct CancellationProbeDataset {
    dataset: RefCell<Dataset>,
    token: CancellationToken,
    cancel_after_mutation: Option<usize>,
    state: ProbeState,
}

impl CancellationProbeDataset {
    fn new(
        dataset: Dataset,
        token: CancellationToken,
        cancel_after_mutation: Option<usize>,
    ) -> Self {
        Self {
            dataset: RefCell::new(dataset),
            token,
            cancel_after_mutation,
            state: ProbeState::default(),
        }
    }

    fn snapshot(&self) -> Dataset {
        self.dataset.borrow().clone()
    }
}

struct CancellationProbeTransaction<'a> {
    target: RefMut<'a, Dataset>,
    staged: Dataset,
    token: CancellationToken,
    cancel_after_mutation: Option<usize>,
    state: &'a ProbeState,
}

impl CancellationProbeTransaction<'_> {
    fn observe_mutation(&self) {
        if self.token.is_cancelled() {
            self.state.mutation_after_cancellation.set(true);
        }
        let mutations = self.state.mutations.get() + 1;
        self.state.mutations.set(mutations);
        if self.cancel_after_mutation == Some(mutations) {
            self.token.cancel();
        }
    }
}

impl TransactionalDataset for CancellationProbeDataset {
    type Error = Infallible;
    type Transaction<'a> = CancellationProbeTransaction<'a>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        self.state.starts.set(self.state.starts.get() + 1);
        let staged = self.dataset.borrow().clone();
        Ok(CancellationProbeTransaction {
            target: self.dataset.borrow_mut(),
            staged,
            token: self.token.clone(),
            cancel_after_mutation: self.cancel_after_mutation,
            state: &self.state,
        })
    }
}

impl WritableDataset for CancellationProbeTransaction<'_> {
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
        self.observe_mutation();
        self.staged.insert(quad);
        Ok(())
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.observe_mutation();
        self.staged.remove(quad.as_ref());
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.observe_mutation();
        self.staged.insert_named_graph(graph_name);
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        self.observe_mutation();
        self.staged
            .clear_graph(&graph_name.map_or(GraphName::DefaultGraph, |graph_name| {
                GraphName::from(graph_name.clone())
            }));
        Ok(())
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.observe_mutation();
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.clear_graph(&GraphName::from(graph_name));
        }
        Ok(())
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.observe_mutation();
        self.staged.clear();
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.insert_named_graph(graph_name);
        }
        Ok(())
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.observe_mutation();
        self.staged.remove_named_graph(graph_name.as_ref());
        Ok(())
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.observe_mutation();
        for graph_name in self.staged.named_graphs().collect::<Vec<_>>() {
            self.staged.remove_named_graph(graph_name.as_ref());
        }
        Ok(())
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        self.observe_mutation();
        self.staged.clear();
        Ok(())
    }

    fn commit(self) -> Result<(), Self::Error> {
        self.state.commits.set(self.state.commits.get() + 1);
        let Self {
            mut target, staged, ..
        } = self;
        *target = staged;
        Ok(())
    }

    fn rollback(self) -> Result<(), Self::Error> {
        self.state.rollbacks.set(self.state.rollbacks.get() + 1);
        Ok(())
    }
}

fn cancellation_is_typed(result: &Result<(), UpdateEvaluationError>) -> bool {
    matches!(result, Err(UpdateEvaluationError::Cancelled))
}

#[test]
fn inner_join_budget_spans_operations_and_rolls_back_the_owned_request()
-> Result<(), Box<dyn Error>> {
    use oxigraph::sparql::{InnerJoinBuildBudget, QueryResource, QueryResourcePhase};
    for limit in [3, 4] {
        let initial = three_quads();
        let dataset =
            CancellationProbeDataset::new(initial.clone(), CancellationToken::new(), None);
        let budget = InnerJoinBuildBudget::new(limit);
        let result = SparqlEvaluator::new().without_optimizations()
            .with_inner_join_build_budget(budget.clone())
            .parse_update("INSERT DATA { <urn:start> <urn:p> <urn:o> };
                INSERT { ?s <urn:first> ?o } WHERE { VALUES ?s { <urn:a> <urn:b> } VALUES ?o { <urn:o> } };
                INSERT { ?s <urn:second> ?o } WHERE { VALUES ?s { <urn:a> <urn:b> } VALUES ?o { <urn:o> } };
                INSERT DATA { <urn:end> <urn:p> <urn:o> }")?
            .on_dataset(&dataset).execute();
        if limit == 3 {
            assert!(matches!(
                result,
                Err(UpdateEvaluationError::ResourceLimitExceeded {
                    resource: QueryResource::InnerJoinBuildRows,
                    phase: QueryResourcePhase::JoinBuild,
                    limit: 3
                })
            ));
            assert_eq!(dataset.snapshot(), initial);
            assert_eq!(dataset.state.commits.get(), 0);
            assert_eq!(dataset.state.rollbacks.get(), 1);
            assert_eq!(dataset.state.mutations.get(), 3);
        } else {
            result?;
            assert_eq!(dataset.snapshot().len(), initial.len() + 6);
            assert_eq!(dataset.state.commits.get(), 1);
            assert_eq!(dataset.state.rollbacks.get(), 0);
            budget.check()?;
        }
        assert_eq!(budget.charged_rows(), limit);
    }
    Ok(())
}

#[test]
fn sort_buffer_budget_spans_operations_and_rolls_back_the_owned_request()
-> Result<(), Box<dyn Error>> {
    use oxigraph::sparql::{QueryResource, QueryResourcePhase, SortBufferBudget};
    for limit in [3, 4] {
        let initial = three_quads();
        let dataset =
            CancellationProbeDataset::new(initial.clone(), CancellationToken::new(), None);
        let budget = SortBufferBudget::new(limit);
        let result = SparqlEvaluator::new()
            .without_optimizations()
            .with_sort_buffer_budget(budget.clone())
            .parse_update(
                "INSERT DATA { <urn:start> <urn:p> <urn:o> };
                INSERT { ?s <urn:first> <urn:o> } WHERE {
                    { SELECT ?s WHERE { VALUES ?s { <urn:b> <urn:a> } } ORDER BY ?s } };
                INSERT { ?s <urn:second> <urn:o> } WHERE {
                    { SELECT ?s WHERE { VALUES ?s { <urn:b> <urn:a> } } ORDER BY ?s } };
                INSERT DATA { <urn:end> <urn:p> <urn:o> }",
            )?
            .on_dataset(&dataset)
            .execute();
        if limit == 3 {
            assert!(matches!(
                result,
                Err(UpdateEvaluationError::ResourceLimitExceeded {
                    resource: QueryResource::SortBufferRows,
                    phase: QueryResourcePhase::SortBuffer,
                    limit: 3
                })
            ));
            // The first three mutations were staged, then everything rolled back.
            assert_eq!(dataset.snapshot(), initial);
            assert_eq!(dataset.state.commits.get(), 0);
            assert_eq!(dataset.state.rollbacks.get(), 1);
            assert_eq!(dataset.state.mutations.get(), 3);
        } else {
            result?;
            assert_eq!(dataset.snapshot().len(), initial.len() + 6);
            assert_eq!(dataset.state.commits.get(), 1);
            assert_eq!(dataset.state.rollbacks.get(), 0);
            budget.check()?;
        }
        assert_eq!(budget.charged_rows(), limit);
    }
    Ok(())
}

fn quad(subject: &str) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(subject.to_owned()),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:o"),
        GraphName::DefaultGraph,
    )
}

fn three_quads() -> Dataset {
    Dataset::from_iter([quad("urn:s1"), quad("urn:s2"), quad("urn:s3")])
}

#[test]
fn cancellation_before_validation_does_not_open_a_transaction() -> Result<(), Box<dyn Error>> {
    let token = CancellationToken::new();
    token.cancel();
    let dataset = CancellationProbeDataset::new(Dataset::new(), token.clone(), None);
    let result = SparqlEvaluator::new()
        .with_cancellation_token(token)
        .parse_update("INSERT DATA { <urn:s> <urn:p> <urn:o> }")?
        .on_dataset(&dataset)
        .execute();

    assert!(cancellation_is_typed(&result));
    assert_eq!(dataset.state.starts.get(), 0);
    assert!(dataset.snapshot().is_empty());
    Ok(())
}

#[test]
fn insert_data_stops_at_cancellation_and_rolls_back() -> Result<(), Box<dyn Error>> {
    let token = CancellationToken::new();
    let dataset = CancellationProbeDataset::new(Dataset::new(), token.clone(), Some(1));
    let result = SparqlEvaluator::new()
        .with_cancellation_token(token)
        .parse_update(
            "INSERT DATA {
                <urn:s1> <urn:p> <urn:o> .
                <urn:s2> <urn:p> <urn:o> .
                <urn:s3> <urn:p> <urn:o>
            }",
        )?
        .on_dataset(&dataset)
        .execute();

    assert!(cancellation_is_typed(&result));
    assert_eq!(dataset.state.mutations.get(), 1);
    assert!(!dataset.state.mutation_after_cancellation.get());
    assert_eq!(dataset.state.commits.get(), 0);
    assert_eq!(dataset.state.rollbacks.get(), 1);
    assert!(dataset.snapshot().is_empty());
    Ok(())
}

#[test]
fn delete_data_stops_at_cancellation_and_rolls_back() -> Result<(), Box<dyn Error>> {
    let token = CancellationToken::new();
    let initial = three_quads();
    let dataset = CancellationProbeDataset::new(initial.clone(), token.clone(), Some(1));
    let result = SparqlEvaluator::new()
        .with_cancellation_token(token)
        .parse_update(
            "DELETE DATA {
                <urn:s1> <urn:p> <urn:o> .
                <urn:s2> <urn:p> <urn:o> .
                <urn:s3> <urn:p> <urn:o>
            }",
        )?
        .on_dataset(&dataset)
        .execute();

    assert!(cancellation_is_typed(&result));
    assert_eq!(dataset.state.mutations.get(), 1);
    assert!(!dataset.state.mutation_after_cancellation.get());
    assert_eq!(dataset.state.commits.get(), 0);
    assert_eq!(dataset.state.rollbacks.get(), 1);
    assert_eq!(dataset.snapshot(), initial);
    Ok(())
}

#[test]
fn delete_insert_stops_at_cancellation_and_rolls_back() -> Result<(), Box<dyn Error>> {
    let token = CancellationToken::new();
    let initial = three_quads();
    let dataset = CancellationProbeDataset::new(initial.clone(), token.clone(), Some(1));
    let result = SparqlEvaluator::new()
        .with_cancellation_token(token)
        .parse_update(
            "DELETE { ?s <urn:p> ?o }
             INSERT { ?s <urn:p2> ?o }
             WHERE { ?s <urn:p> ?o }",
        )?
        .on_dataset(&dataset)
        .execute();

    assert!(cancellation_is_typed(&result));
    assert_eq!(dataset.state.mutations.get(), 1);
    assert!(!dataset.state.mutation_after_cancellation.get());
    assert_eq!(dataset.state.commits.get(), 0);
    assert_eq!(dataset.state.rollbacks.get(), 1);
    assert_eq!(dataset.snapshot(), initial);
    Ok(())
}

#[test]
fn cancellation_after_the_last_mutation_is_checked_before_commit() -> Result<(), Box<dyn Error>> {
    let token = CancellationToken::new();
    let dataset = CancellationProbeDataset::new(Dataset::new(), token.clone(), Some(1));
    let result = SparqlEvaluator::new()
        .with_cancellation_token(token)
        .parse_update("INSERT DATA { <urn:s> <urn:p> <urn:o> }")?
        .on_dataset(&dataset)
        .execute();

    assert!(cancellation_is_typed(&result));
    assert_eq!(dataset.state.mutations.get(), 1);
    assert_eq!(dataset.state.commits.get(), 0);
    assert_eq!(dataset.state.rollbacks.get(), 1);
    assert!(dataset.snapshot().is_empty());
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn queued_store_update_uses_the_same_cancellation_token_and_releases_admission()
-> Result<(), TestError> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(directory.path())?);
    let holder = store.start_transaction()?;
    let token = CancellationToken::new();
    let waiter_store = Arc::clone(&store);
    let waiter_token = token.clone();
    let (started, starts) = mpsc::channel();
    let (finished, finishes) = mpsc::channel();
    let waiter = thread::spawn(move || -> Result<(), TestError> {
        started.send(())?;
        let result = SparqlEvaluator::new()
            .with_cancellation_token(waiter_token)
            .parse_update("INSERT DATA { <urn:waiter> <urn:p> <urn:o> }")?
            .on_store(&waiter_store)
            .execute();
        finished.send(cancellation_is_typed(&result))?;
        Ok(())
    });

    starts.recv_timeout(CANCELLATION_BOUND)?;
    assert_eq!(
        finishes.recv_timeout(MUST_BLOCK_FOR),
        Err(RecvTimeoutError::Timeout),
        "the update did not wait behind the active writer"
    );
    token.cancel();
    let cancelled = match finishes.recv_timeout(CANCELLATION_BOUND) {
        Ok(cancelled) => cancelled,
        Err(error) => {
            drop(holder);
            waiter
                .join()
                .map_err(|_| io::Error::other("waiter thread panicked"))??;
            return Err(error.into());
        }
    };
    assert!(
        cancelled,
        "queued admission did not return typed cancellation"
    );
    drop(holder);
    waiter
        .join()
        .map_err(|_| io::Error::other("waiter thread panicked"))??;

    let transaction = store.start_transaction()?;
    WritableDataset::rollback(transaction)?;
    assert!(store.is_empty()?);
    Ok(())
}
