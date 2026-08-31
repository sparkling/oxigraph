use oxigraph::model::{NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::store::{TransactionalDataset, WritableDataset};
use std::error::Error;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum FaultPlan {
    #[default]
    None,
    Open,
    Read,
    Mutation {
        fail_on_attempt: usize,
        rollback_failure: bool,
    },
    PrepublicationCommit,
}

impl FaultPlan {
    pub const fn open_failure() -> Self {
        Self::Open
    }

    pub const fn read_failure() -> Self {
        Self::Read
    }

    pub const fn mutation_failure(fail_on_attempt: usize) -> Self {
        Self::Mutation {
            fail_on_attempt,
            rollback_failure: false,
        }
    }

    pub const fn mutation_and_rollback_failure(fail_on_attempt: usize) -> Self {
        Self::Mutation {
            fail_on_attempt,
            rollback_failure: true,
        }
    }

    pub const fn prepublication_commit_failure() -> Self {
        Self::PrepublicationCommit
    }

    const fn mutation_attempt(self) -> Option<usize> {
        match self {
            Self::Mutation {
                fail_on_attempt, ..
            } => Some(fail_on_attempt),
            Self::None | Self::Open | Self::Read | Self::PrepublicationCommit => None,
        }
    }

    const fn rollback_fails(self) -> bool {
        matches!(
            self,
            Self::Mutation {
                rollback_failure: true,
                ..
            }
        )
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct FaultReceipt {
    pub open_attempts: usize,
    pub opens: usize,
    pub read_attempts: usize,
    pub mutation_attempts: usize,
    pub delegated_mutations: usize,
    pub commit_attempts: usize,
    pub delegated_commits: usize,
    pub rollback_attempts: usize,
    pub delegated_rollbacks: usize,
}

#[derive(Default)]
struct FaultCounters {
    open_attempts: AtomicUsize,
    opens: AtomicUsize,
    read_attempts: AtomicUsize,
    mutation_attempts: AtomicUsize,
    delegated_mutations: AtomicUsize,
    commit_attempts: AtomicUsize,
    delegated_commits: AtomicUsize,
    rollback_attempts: AtomicUsize,
    delegated_rollbacks: AtomicUsize,
}

impl FaultCounters {
    fn receipt(&self) -> FaultReceipt {
        FaultReceipt {
            open_attempts: self.open_attempts.load(Ordering::SeqCst),
            opens: self.opens.load(Ordering::SeqCst),
            read_attempts: self.read_attempts.load(Ordering::SeqCst),
            mutation_attempts: self.mutation_attempts.load(Ordering::SeqCst),
            delegated_mutations: self.delegated_mutations.load(Ordering::SeqCst),
            commit_attempts: self.commit_attempts.load(Ordering::SeqCst),
            delegated_commits: self.delegated_commits.load(Ordering::SeqCst),
            rollback_attempts: self.rollback_attempts.load(Ordering::SeqCst),
            delegated_rollbacks: self.delegated_rollbacks.load(Ordering::SeqCst),
        }
    }
}

#[derive(Debug)]
pub enum FaultDatasetError<E> {
    Backend(E),
    Injected(&'static str),
}

impl<E: fmt::Display> fmt::Display for FaultDatasetError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backend(error) => error.fmt(f),
            Self::Injected(message) => f.write_str(message),
        }
    }
}

impl<E: Error + 'static> Error for FaultDatasetError<E> {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Backend(error) => Some(error),
            Self::Injected(_) => None,
        }
    }
}

pub struct FaultInjectingDataset<D> {
    inner: D,
    plan: FaultPlan,
    counters: Arc<FaultCounters>,
}

impl<D> FaultInjectingDataset<D> {
    pub fn new(inner: D, plan: FaultPlan) -> Self {
        Self {
            inner,
            plan,
            counters: Arc::new(FaultCounters::default()),
        }
    }

    pub fn receipt(&self) -> FaultReceipt {
        self.counters.receipt()
    }
}

pub struct FaultInjectingTransaction<T: WritableDataset> {
    inner: T,
    plan: FaultPlan,
    counters: Arc<FaultCounters>,
}

impl<T: WritableDataset> FaultInjectingTransaction<T> {
    fn inner(&self) -> &T {
        &self.inner
    }

    fn inner_mut(&mut self) -> &mut T {
        &mut self.inner
    }

    fn mutate<R>(
        &mut self,
        operation: impl FnOnce(&mut T) -> Result<R, T::Error>,
    ) -> Result<R, FaultDatasetError<T::Error>> {
        let attempt = self
            .counters
            .mutation_attempts
            .fetch_add(1, Ordering::SeqCst)
            + 1;
        if self.plan.mutation_attempt() == Some(attempt) {
            return Err(FaultDatasetError::Injected(
                "injected transaction mutation failure",
            ));
        }
        self.counters
            .delegated_mutations
            .fetch_add(1, Ordering::SeqCst);
        operation(self.inner_mut()).map_err(FaultDatasetError::Backend)
    }
}

impl<D: TransactionalDataset> TransactionalDataset for FaultInjectingDataset<D> {
    type Error = FaultDatasetError<D::Error>;
    type Transaction<'a>
        = FaultInjectingTransaction<D::Transaction<'a>>
    where
        Self: 'a;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        self.counters.open_attempts.fetch_add(1, Ordering::SeqCst);
        if self.plan == FaultPlan::Open {
            return Err(FaultDatasetError::Injected(
                "injected transaction open failure",
            ));
        }
        let inner = self
            .inner
            .start_transaction()
            .map_err(FaultDatasetError::Backend)?;
        self.counters.opens.fetch_add(1, Ordering::SeqCst);
        Ok(FaultInjectingTransaction {
            inner,
            plan: self.plan,
            counters: Arc::clone(&self.counters),
        })
    }
}

impl<T: WritableDataset> WritableDataset for FaultInjectingTransaction<T> {
    type Error = FaultDatasetError<T::Error>;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Self::Error>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Self::Error>> + 'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        self.counters.read_attempts.fetch_add(1, Ordering::SeqCst);
        if self.plan == FaultPlan::Read {
            return Box::new(std::iter::once(Err(FaultDatasetError::Injected(
                "injected transaction read failure",
            ))));
        }
        Box::new(
            self.inner()
                .quads_for_pattern(subject, predicate, object, graph_name)
                .map(|result| result.map_err(FaultDatasetError::Backend)),
        )
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        Box::new(
            self.inner()
                .named_graphs()
                .map(|result| result.map_err(FaultDatasetError::Backend)),
        )
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        self.inner()
            .contains_named_graph(graph_name)
            .map_err(FaultDatasetError::Backend)
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.mutate(|inner| inner.insert(quad))
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.mutate(|inner| inner.remove(quad))
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.mutate(|inner| inner.insert_named_graph(graph_name))
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        self.mutate(|inner| inner.clear_graph(graph_name))
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.mutate(WritableDataset::clear_all_named_graphs)
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.mutate(WritableDataset::clear_all_graphs)
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.mutate(|inner| inner.remove_named_graph(graph_name))
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        self.mutate(WritableDataset::remove_all_named_graphs)
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        self.mutate(WritableDataset::clear)
    }

    fn commit(self) -> Result<(), Self::Error> {
        let Self {
            inner,
            plan,
            counters,
        } = self;
        counters.commit_attempts.fetch_add(1, Ordering::SeqCst);
        if plan == FaultPlan::PrepublicationCommit {
            drop(inner);
            return Err(FaultDatasetError::Injected(
                "injected prepublication commit failure",
            ));
        }
        counters.delegated_commits.fetch_add(1, Ordering::SeqCst);
        inner.commit().map_err(FaultDatasetError::Backend)
    }

    fn rollback(self) -> Result<(), Self::Error> {
        let Self {
            inner,
            plan,
            counters,
        } = self;
        counters.rollback_attempts.fetch_add(1, Ordering::SeqCst);
        if plan.rollback_fails() {
            drop(inner);
            return Err(FaultDatasetError::Injected(
                "injected transaction rollback failure",
            ));
        }
        counters.delegated_rollbacks.fetch_add(1, Ordering::SeqCst);
        inner.rollback().map_err(FaultDatasetError::Backend)
    }
}
