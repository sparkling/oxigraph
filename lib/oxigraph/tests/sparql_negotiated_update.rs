#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests assert negotiated SPARQL update admission"
)]

use oxigraph::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::{CancellationToken, SparqlEvaluator, UpdateEvaluationError};
use oxigraph::store::{
    NegotiatedTransaction, NegotiatedTransactionalDataset, RollbackGuarantee, Store,
    TransactionCapabilities, TransactionRequest, TransactionRequirements, TransactionStartControl,
    TransactionStartError, TransactionalDataset, UnmetTransactionRequirement, WritableDataset,
    WriterIsolation,
};
use std::convert::Infallible;
use std::error::Error;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

type TestError = Box<dyn Error + Send + Sync>;

const ADMISSION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MUST_BLOCK_FOR: Duration = Duration::from_millis(100);
const CANCELLATION_BOUND: Duration = Duration::from_secs(1);

#[derive(Default)]
struct AdmissionState {
    open: bool,
    entered: usize,
}

#[derive(Debug, Eq, PartialEq)]
struct ProbeReceipt {
    controlled_attempts: usize,
    opens: usize,
    mutations: usize,
    mutation_after_cancellation: bool,
    commits: usize,
    rollbacks: usize,
    dataset: Dataset,
}

struct AdmissionProbe {
    dataset: Mutex<Dataset>,
    admission: Mutex<AdmissionState>,
    admission_changed: Condvar,
    capabilities: TransactionCapabilities,
    cancellation_token: CancellationToken,
    cancel_after_mutation: Option<usize>,
    controlled_attempts: AtomicUsize,
    opens: AtomicUsize,
    mutations: AtomicUsize,
    mutation_after_cancellation: AtomicBool,
    commits: AtomicUsize,
    rollbacks: AtomicUsize,
}

impl AdmissionProbe {
    fn new(
        capabilities: TransactionCapabilities,
        admission_open: bool,
        cancellation_token: CancellationToken,
        cancel_after_mutation: Option<usize>,
    ) -> Self {
        Self {
            dataset: Mutex::new(Dataset::new()),
            admission: Mutex::new(AdmissionState {
                open: admission_open,
                entered: 0,
            }),
            admission_changed: Condvar::new(),
            capabilities,
            cancellation_token,
            cancel_after_mutation,
            controlled_attempts: AtomicUsize::new(0),
            opens: AtomicUsize::new(0),
            mutations: AtomicUsize::new(0),
            mutation_after_cancellation: AtomicBool::new(false),
            commits: AtomicUsize::new(0),
            rollbacks: AtomicUsize::new(0),
        }
    }

    fn wait_for_controlled_admission(&self) -> Result<(), io::Error> {
        let admission = self
            .admission
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (admission, timeout) = self
            .admission_changed
            .wait_timeout_while(admission, CANCELLATION_BOUND, |state| state.entered == 0)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if timeout.timed_out() && admission.entered == 0 {
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "negotiated admission was not entered",
            ))
        } else {
            Ok(())
        }
    }

    fn receipt(&self) -> ProbeReceipt {
        ProbeReceipt {
            controlled_attempts: self.controlled_attempts.load(Ordering::SeqCst),
            opens: self.opens.load(Ordering::SeqCst),
            mutations: self.mutations.load(Ordering::SeqCst),
            mutation_after_cancellation: self.mutation_after_cancellation.load(Ordering::SeqCst),
            commits: self.commits.load(Ordering::SeqCst),
            rollbacks: self.rollbacks.load(Ordering::SeqCst),
            dataset: self
                .dataset
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone(),
        }
    }
}

struct ProbeTransaction<'a> {
    target: &'a AdmissionProbe,
    staged: Dataset,
}

impl ProbeTransaction<'_> {
    fn observe_mutation(&self) {
        if self.target.cancellation_token.is_cancelled() {
            self.target
                .mutation_after_cancellation
                .store(true, Ordering::SeqCst);
        }
        let mutations = self.target.mutations.fetch_add(1, Ordering::SeqCst) + 1;
        if self.target.cancel_after_mutation == Some(mutations) {
            self.target.cancellation_token.cancel();
        }
    }
}

impl TransactionalDataset for AdmissionProbe {
    type Error = Infallible;
    type Transaction<'a> = ProbeTransaction<'a>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        self.opens.fetch_add(1, Ordering::SeqCst);
        Ok(ProbeTransaction {
            target: self,
            staged: self
                .dataset
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone(),
        })
    }
}

impl NegotiatedTransactionalDataset for AdmissionProbe {
    fn transaction_capabilities(&self) -> TransactionCapabilities {
        self.capabilities.clone()
    }

    fn start_transaction_with_control(
        &self,
        request: TransactionRequest,
        control: TransactionStartControl,
    ) -> Result<NegotiatedTransaction<Self::Transaction<'_>>, TransactionStartError<Self::Error>>
    {
        let started_at = Instant::now();
        let effective = self.transaction_capabilities();
        let unmet = effective.unmet_requirements(request.requirements());
        if !unmet.is_empty() {
            return Err(TransactionStartError::RequirementsNotMet { unmet, effective });
        }

        self.controlled_attempts.fetch_add(1, Ordering::SeqCst);
        let mut admission = self
            .admission
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        admission.entered += 1;
        self.admission_changed.notify_all();
        while !admission.open {
            if control.is_cancelled() {
                return Err(TransactionStartError::Cancelled);
            }
            let wait = if let Some(timeout) = control.timeout() {
                if started_at.elapsed() >= timeout {
                    return Err(TransactionStartError::TimedOut);
                }
                ADMISSION_POLL_INTERVAL.min(timeout.saturating_sub(started_at.elapsed()))
            } else {
                ADMISSION_POLL_INTERVAL
            };
            (admission, _) = self
                .admission_changed
                .wait_timeout(admission, wait)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        drop(admission);
        if control.is_cancelled() {
            return Err(TransactionStartError::Cancelled);
        }

        let transaction = self
            .start_transaction()
            .map_err(TransactionStartError::Backend)?;
        Ok(NegotiatedTransaction::new(transaction, effective))
    }
}

impl WritableDataset for ProbeTransaction<'_> {
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
        self.target.commits.fetch_add(1, Ordering::SeqCst);
        *self
            .target
            .dataset
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = self.staged;
        Ok(())
    }

    fn rollback(self) -> Result<(), Self::Error> {
        self.target.rollbacks.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

fn legacy_profile() -> TransactionCapabilities {
    TransactionCapabilities::none()
        .with_atomic_publication()
        .with_read_your_writes()
        .with_rollback(RollbackGuarantee::ExplicitOrDropBeforeCommit)
}

fn serialized_profile() -> TransactionCapabilities {
    legacy_profile().with_writer_isolation(WriterIsolation::Serialized)
}

fn quad(subject: &str) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(subject.to_owned()),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:o"),
        GraphName::DefaultGraph,
    )
}

fn execute_update<D: NegotiatedTransactionalDataset>(
    dataset: &D,
    cancellation_token: CancellationToken,
    request: TransactionRequest,
    update: &str,
) -> Result<Result<(), UpdateEvaluationError>, TestError> {
    Ok(SparqlEvaluator::new()
        .with_cancellation_token(cancellation_token)
        .parse_update(update)?
        .on_dataset_with_request(dataset, request)
        .execute())
}

fn find_start_error<'a>(
    error: &'a (dyn Error + 'static),
) -> Option<&'a TransactionStartError<Infallible>> {
    let mut current = Some(error);
    while let Some(error) = current {
        if let Some(error) = error.downcast_ref() {
            return Some(error);
        }
        current = error.source();
    }
    None
}

#[test]
fn request_requirements_are_rejected_before_transaction_open() -> Result<(), TestError> {
    let token = CancellationToken::new();
    let probe = AdmissionProbe::new(legacy_profile(), true, token.clone(), None);
    let request = TransactionRequest::new(
        TransactionRequirements::legacy().requiring_writer_isolation(WriterIsolation::Serialized),
    );
    let result = execute_update(
        &probe,
        token,
        request,
        "INSERT DATA { <urn:rejected> <urn:p> <urn:o> }",
    )?;
    let Err(error) = result else {
        return Err(io::Error::other("unsupported requirements must be rejected").into());
    };
    let Some(TransactionStartError::RequirementsNotMet { unmet, .. }) = find_start_error(&error)
    else {
        return Err(io::Error::other(format!(
            "requirements rejection was not preserved as a source error: {error}"
        ))
        .into());
    };

    assert_eq!(unmet, &[UnmetTransactionRequirement::WriterIsolation]);
    assert_eq!(
        probe.receipt(),
        ProbeReceipt {
            controlled_attempts: 0,
            opens: 0,
            mutations: 0,
            mutation_after_cancellation: false,
            commits: 0,
            rollbacks: 0,
            dataset: Dataset::new(),
        }
    );
    Ok(())
}

#[test]
fn evaluator_token_cancels_custom_negotiated_admission() -> Result<(), TestError> {
    let token = CancellationToken::new();
    let probe = Arc::new(AdmissionProbe::new(
        legacy_profile(),
        false,
        token.clone(),
        None,
    ));
    let waiter_probe = Arc::clone(&probe);
    let waiter_token = token.clone();
    let (finished, finishes) = mpsc::channel();
    let waiter = thread::spawn(move || -> Result<(), TestError> {
        let result = execute_update(
            waiter_probe.as_ref(),
            waiter_token,
            TransactionRequest::default(),
            "INSERT DATA { <urn:waiter> <urn:p> <urn:o> }",
        )?;
        finished.send(matches!(result, Err(UpdateEvaluationError::Cancelled)))?;
        Ok(())
    });

    probe.wait_for_controlled_admission()?;
    assert_eq!(
        finishes.recv_timeout(MUST_BLOCK_FOR),
        Err(RecvTimeoutError::Timeout),
        "the custom adapter did not remain queued"
    );
    token.cancel();
    let cancelled = finishes.recv_timeout(CANCELLATION_BOUND)?;
    waiter
        .join()
        .map_err(|_| io::Error::other("custom admission waiter panicked"))??;

    assert!(
        cancelled,
        "custom admission did not return typed cancellation"
    );
    assert_eq!(
        probe.receipt(),
        ProbeReceipt {
            controlled_attempts: 1,
            opens: 0,
            mutations: 0,
            mutation_after_cancellation: false,
            commits: 0,
            rollbacks: 0,
            dataset: Dataset::new(),
        }
    );
    Ok(())
}

#[test]
fn cancelled_negotiated_update_explicitly_rolls_back() -> Result<(), TestError> {
    let token = CancellationToken::new();
    let probe = AdmissionProbe::new(legacy_profile(), true, token.clone(), Some(1));
    let result = execute_update(
        &probe,
        token,
        TransactionRequest::default(),
        "INSERT DATA { <urn:cancelled> <urn:p> <urn:o> }",
    )?;

    assert!(matches!(result, Err(UpdateEvaluationError::Cancelled)));
    assert_eq!(
        probe.receipt(),
        ProbeReceipt {
            controlled_attempts: 1,
            opens: 1,
            mutations: 1,
            mutation_after_cancellation: false,
            commits: 0,
            rollbacks: 1,
            dataset: Dataset::new(),
        }
    );
    Ok(())
}

#[test]
fn successful_negotiated_update_commits_once() -> Result<(), TestError> {
    let token = CancellationToken::new();
    let probe = AdmissionProbe::new(serialized_profile(), true, token.clone(), None);
    let request = TransactionRequest::new(
        TransactionRequirements::legacy().requiring_writer_isolation(WriterIsolation::Serialized),
    );
    let result = execute_update(
        &probe,
        token,
        request,
        "INSERT DATA { <urn:committed> <urn:p> <urn:o> }",
    )?;

    result?;
    assert_eq!(
        probe.receipt(),
        ProbeReceipt {
            controlled_attempts: 1,
            opens: 1,
            mutations: 1,
            mutation_after_cancellation: false,
            commits: 1,
            rollbacks: 0,
            dataset: Dataset::from_iter([quad("urn:committed")]),
        }
    );
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn store_negotiated_admission_is_cancellable_and_releases_writer_gate() -> Result<(), TestError> {
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
        let result = execute_update(
            waiter_store.as_ref(),
            waiter_token,
            TransactionRequest::default(),
            "INSERT DATA { <urn:store-waiter> <urn:p> <urn:o> }",
        )?;
        finished.send(matches!(result, Err(UpdateEvaluationError::Cancelled)))?;
        Ok(())
    });

    starts.recv_timeout(CANCELLATION_BOUND)?;
    assert_eq!(
        finishes.recv_timeout(MUST_BLOCK_FOR),
        Err(RecvTimeoutError::Timeout),
        "the Store update did not wait behind the active writer"
    );
    token.cancel();
    let cancelled = match finishes.recv_timeout(CANCELLATION_BOUND) {
        Ok(cancelled) => cancelled,
        Err(error) => {
            drop(holder);
            waiter
                .join()
                .map_err(|_| io::Error::other("Store admission waiter panicked"))??;
            return Err(error.into());
        }
    };
    drop(holder);
    waiter
        .join()
        .map_err(|_| io::Error::other("Store admission waiter panicked"))??;

    assert!(
        cancelled,
        "Store admission did not return typed cancellation"
    );
    let transaction = store.start_transaction()?;
    WritableDataset::rollback(transaction)?;
    assert!(store.is_empty()?);
    Ok(())
}
