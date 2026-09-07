use crate::model::{GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use crate::storage::CorruptionError;
pub use crate::storage::error::StorageError;
use crate::storage::numeric_encoder::{
    Decoder, EncodedQuad, EncodedTerm, StrHash, StrHashHasher, StrLookup, insert_term,
};
use crate::storage::{
    StorageTransactionOutcome, StorageTransactionStartError, TransactionStartControl,
    TransactionStartControlError,
};
use crate::store::receipt::GovernanceState;
use crate::store::{
    CommitReceipt, CommitReceiptOutcome, Namespace, NamespacePrefix, SemanticChangeSet,
    TransactionCommitError, TransactionNonCommitReason,
};
use dashmap::iter::Iter;
use dashmap::mapref::entry::Entry;
use dashmap::{DashMap, DashSet};
use oxstr::OxString;
use rustc_hash::{FxHashSet, FxHasher};
use std::borrow::Borrow;
use std::collections::{BTreeMap, HashMap};
use std::hash::{BuildHasherDefault, Hash, Hasher};
use std::marker::PhantomData;
use std::mem::{take, transmute};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock, Weak};
use std::time::Instant;

/// In-memory storage working with MVCC
///
/// Each quad and graph name is annotated by a version range, allowing to read old versions while updates are applied.
/// To simplify the implementation, a single write transaction is currently allowed. This restriction should be lifted in the future.
#[derive(Clone)]
pub struct MemoryStorage {
    content: Arc<Content>,
    id2str: Arc<DashMap<StrHash, OxString, BuildHasherDefault<StrHashHasher>>>,
    transaction_outcomes: Arc<DashMap<[u8; 16], MemoryTransactionOutcomeState>>,
    governance: Arc<RwLock<MemoryGovernance>>,
    version_counter: Arc<AtomicUsize>,
    transaction_counter: Arc<AtomicUsize>,
    transaction_lock: Arc<Lock>,
}

#[derive(Default)]
struct MemoryGovernance {
    state: GovernanceState,
    governed_keys: FxHashSet<[u8; 16]>,
    receipts: HashMap<[u8; 16], crate::store::shacl_receipt::GovernedReceipt>,
    expired: HashMap<[u8; 16], crate::store::ExpiredCommitReceipt>,
    outbox: BTreeMap<u64, Vec<u8>>,
}

struct Content {
    quad_set: DashSet<Arc<QuadListNode>, BuildHasherDefault<FxHasher>>,
    last_quad: RwLock<Option<Weak<QuadListNode>>>,
    last_quad_by_subject:
        DashMap<EncodedTerm, (Weak<QuadListNode>, u64), BuildHasherDefault<FxHasher>>,
    last_quad_by_predicate:
        DashMap<EncodedTerm, (Weak<QuadListNode>, u64), BuildHasherDefault<FxHasher>>,
    last_quad_by_object:
        DashMap<EncodedTerm, (Weak<QuadListNode>, u64), BuildHasherDefault<FxHasher>>,
    last_quad_by_graph_name:
        DashMap<EncodedTerm, (Weak<QuadListNode>, u64), BuildHasherDefault<FxHasher>>,
    graphs: DashMap<EncodedTerm, VersionRange>,
    namespaces: DashMap<NamespaceMapping, VersionRange>,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct NamespaceMapping {
    prefix: NamespacePrefix,
    iri: NamedNode,
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self {
            content: Arc::new(Content {
                quad_set: DashSet::default(),
                last_quad: RwLock::new(None),
                last_quad_by_subject: DashMap::default(),
                last_quad_by_predicate: DashMap::default(),
                last_quad_by_object: DashMap::default(),
                last_quad_by_graph_name: DashMap::default(),
                graphs: DashMap::default(),
                namespaces: DashMap::default(),
            }),
            id2str: Arc::new(DashMap::default()),
            transaction_outcomes: Arc::new(DashMap::default()),
            governance: Arc::new(RwLock::new(MemoryGovernance::default())),
            version_counter: Arc::new(AtomicUsize::new(0)),
            transaction_counter: Arc::new(AtomicUsize::new(usize::MAX >> 1)),
            transaction_lock: Arc::new(Lock::new()),
        }
    }

    pub fn snapshot(&self) -> MemoryStorageReader<'static> {
        MemoryStorageReader {
            storage: self.clone(),
            snapshot_id: self.version_counter.load(Ordering::Acquire),
            _lifetime: PhantomData,
        }
    }

    pub fn start_transaction(&self) -> MemoryStorageTransaction<'_> {
        // We ensure there is only one transaction running
        let transaction_guard = self.transaction_lock.lock();
        self.start_transaction_with_guard(transaction_guard)
    }

    pub fn start_transaction_with_control(
        &self,
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<MemoryStorageTransaction<'_>, TransactionStartControlError> {
        let transaction_guard = self
            .transaction_lock
            .lock_with_control(control, started_at)?;
        Ok(self.start_transaction_with_guard(transaction_guard))
    }

    pub fn start_keyed_readable_transaction_with_control(
        &self,
        transaction_key: &[u8; 16],
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<MemoryStorageTransaction<'_>, StorageTransactionStartError> {
        // Reserve only after admission succeeds. This keeps a rejected or timed-out request from
        // consuming a key that never owned the writer gate.
        let transaction_guard = self
            .transaction_lock
            .lock_with_control(control, started_at)?;
        match self.transaction_outcomes.entry(*transaction_key) {
            Entry::Occupied(_) => {
                return Err(StorageError::Other(
                    "transaction key has already been reserved".into(),
                )
                .into());
            }
            Entry::Vacant(entry) => {
                entry.insert(MemoryTransactionOutcomeState::Staging);
            }
        }
        Ok(self.start_transaction_with_guard_and_key(transaction_guard, Some(*transaction_key)))
    }

    pub fn lookup_transaction_outcome(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<StorageTransactionOutcome, StorageError> {
        // A governed publication holds this lock through both MVCC publication
        // and terminal outcome/receipt installation.
        let _governance = self
            .governance
            .read()
            .map_err(|_| CorruptionError::msg("poisoned memory governance state"))?;
        Ok(self.transaction_outcomes.get(transaction_key).map_or(
            StorageTransactionOutcome::Indeterminate,
            |state| match *state {
                MemoryTransactionOutcomeState::Committed => StorageTransactionOutcome::Committed,
                MemoryTransactionOutcomeState::RolledBack => StorageTransactionOutcome::RolledBack,
                MemoryTransactionOutcomeState::Staging
                | MemoryTransactionOutcomeState::CommitAttempted => {
                    StorageTransactionOutcome::Indeterminate
                }
            },
        ))
    }

    pub fn start_governed_transaction_with_control(
        &self,
        transaction_key: &[u8; 16],
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<MemoryStorageTransaction<'_>, StorageTransactionStartError> {
        let mut transaction = self.start_keyed_readable_transaction_with_control(
            transaction_key,
            control,
            started_at,
        )?;
        self.governance
            .write()
            .map_err(|_| {
                StorageError::from(CorruptionError::msg("poisoned memory governance state"))
            })?
            .governed_keys
            .insert(*transaction_key);
        transaction.governed = true;
        Ok(transaction)
    }

    pub fn lookup_commit_receipt(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<CommitReceiptOutcome, StorageError> {
        let governance = self
            .governance
            .read()
            .map_err(|_| CorruptionError::msg("poisoned memory governance state"))?;
        self.lookup_commit_receipt_locked(transaction_key, &governance)
    }

    pub fn lookup_shacl_receipt(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<crate::store::ShaclReceiptOutcome, StorageError> {
        let governance = self
            .governance
            .read()
            .map_err(|_| CorruptionError::msg("poisoned memory governance state"))?;
        let outcome = self.lookup_commit_receipt_locked(transaction_key, &governance)?;
        Ok(governance.receipts.get(transaction_key).map_or_else(
            || crate::store::ShaclReceiptOutcome::Unavailable(outcome),
            crate::store::shacl_receipt::GovernedReceipt::outcome,
        ))
    }

    fn lookup_commit_receipt_locked(
        &self,
        transaction_key: &[u8; 16],
        governance: &MemoryGovernance,
    ) -> Result<CommitReceiptOutcome, StorageError> {
        let state = self
            .transaction_outcomes
            .get(transaction_key)
            .map(|value| *value);
        if let Some(expired) = governance.expired.get(transaction_key) {
            expired.validate(&governance.state)?;
            if state != Some(MemoryTransactionOutcomeState::Committed)
                || governance.receipts.contains_key(transaction_key)
            {
                return Err(CorruptionError::msg("inconsistent expired memory receipt").into());
            }
            return Ok(CommitReceiptOutcome::Expired(expired.clone()));
        }
        if let Some(receipt) = governance.receipts.get(transaction_key) {
            if state != Some(MemoryTransactionOutcomeState::Committed) {
                return Err(
                    CorruptionError::msg("receipt without committed memory outcome").into(),
                );
            }
            return Ok(CommitReceiptOutcome::Committed(receipt.receipt().clone()));
        }
        Ok(match state {
            Some(MemoryTransactionOutcomeState::Committed) => {
                if governance.governed_keys.contains(transaction_key) {
                    return Err(
                        CorruptionError::msg("governed memory commit has no receipt").into(),
                    );
                }
                CommitReceiptOutcome::CommittedWithoutReceipt
            }
            Some(MemoryTransactionOutcomeState::RolledBack) => {
                CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
            }
            _ => CommitReceiptOutcome::Indeterminate,
        })
    }

    pub fn read_outbox(
        &self,
        after: Option<&crate::store::OutboxCursor>,
        limit: std::num::NonZeroUsize,
    ) -> Result<crate::store::OutboxBatch, crate::store::OutboxReadError> {
        let governance = self.governance.read().map_err(|_| {
            StorageError::from(CorruptionError::msg("poisoned memory governance state"))
        })?;
        self.read_outbox_locked(&governance, after, limit)
    }

    fn read_outbox_locked(
        &self,
        governance: &MemoryGovernance,
        after: Option<&crate::store::OutboxCursor>,
        limit: std::num::NonZeroUsize,
    ) -> Result<crate::store::OutboxBatch, crate::store::OutboxReadError> {
        let gc = crate::store::retention::physical_gc(&governance.state);
        let high = governance
            .state
            .outbox
            .as_ref()
            .map_or(0, |state| state.high_water);
        crate::store::retention::validate_cleanup_head(&governance.state, |position| {
            Ok(governance.outbox.get(&position).cloned())
        })?;
        if governance.outbox.first_key_value().map(|(key, _)| *key) != (gc < high).then(|| gc + 1) {
            return Err(
                StorageError::from(CorruptionError::msg("invalid physical outbox origin")).into(),
            );
        }
        crate::store::outbox::read_page(
            Some(&governance.state),
            after,
            limit,
            |position| Ok(governance.outbox.get(&position).cloned()),
            |key| {
                if self
                    .transaction_outcomes
                    .get(key)
                    .is_none_or(|entry| *entry != MemoryTransactionOutcomeState::Committed)
                {
                    return Err(
                        CorruptionError::msg("outbox receipt has no committed outcome").into(),
                    );
                }
                if let Some(expired) = governance.expired.get(key) {
                    return crate::store::retention::anchor_receipt(&governance.state, expired)
                        .map(Some);
                }
                Ok(governance
                    .receipts
                    .get(key)
                    .map(|receipt| receipt.receipt().clone()))
            },
            |position| {
                Ok(governance
                    .outbox
                    .last_key_value()
                    .is_some_and(|(last, _)| *last > position))
            },
        )
    }

    pub fn govern_outbox(
        &self,
        action: crate::store::retention::Action<'_>,
        now: crate::store::GovernanceTime,
    ) -> Result<crate::store::retention::ActionResult, crate::store::GovernanceError> {
        let _writer = self.transaction_lock.lock();
        let mut governance = self.governance.write().map_err(|_| {
            StorageError::from(CorruptionError::msg("poisoned memory governance state"))
        })?;
        self.read_outbox_locked(&governance, None, std::num::NonZeroUsize::MIN)?;
        if let Some(cursor) = action.cursor() {
            self.read_outbox_locked(&governance, Some(cursor), std::num::NonZeroUsize::MIN)?;
        }
        let prepared =
            crate::store::retention::prepare(&governance.state, action, now, |position| {
                let bytes = governance
                    .outbox
                    .get(&position)
                    .ok_or_else(|| CorruptionError::msg("missing cleanup record"))?;
                crate::store::outbox::decode_record(
                    &governance.state.store_identity,
                    position,
                    bytes,
                )
            })?;
        if let Some(receipt) = prepared.expired {
            let key = *receipt.transaction_key().as_bytes();
            governance
                .expired
                .insert(key, crate::store::ExpiredCommitReceipt::new(&receipt));
            governance.receipts.remove(&key);
        }
        for position in prepared.remove {
            governance.outbox.remove(&position);
        }
        governance.state = prepared.state;
        Ok(prepared.result)
    }

    pub fn governance_health(
        &self,
        now: crate::store::GovernanceTime,
        limit: std::num::NonZeroUsize,
    ) -> Result<crate::store::GovernanceHealth, crate::store::GovernanceError> {
        let governance = self.governance.read().map_err(|_| {
            StorageError::from(CorruptionError::msg("poisoned memory governance state"))
        })?;
        let page = self.read_outbox_locked(&governance, None, limit)?;
        crate::store::retention::health(Some(&governance.state), now, &page)
    }

    fn start_transaction_with_guard<'a>(
        &'a self,
        transaction_guard: LockGuard<'a>,
    ) -> MemoryStorageTransaction<'a> {
        self.start_transaction_with_guard_and_key(transaction_guard, None)
    }

    fn start_transaction_with_guard_and_key<'a>(
        &'a self,
        transaction_guard: LockGuard<'a>,
        transaction_key: Option<[u8; 16]>,
    ) -> MemoryStorageTransaction<'a> {
        let transaction_id = self.transaction_counter.fetch_add(1, Ordering::Acquire);
        let snapshot_id = self.version_counter.load(Ordering::Relaxed);
        MemoryStorageTransaction {
            storage: self,
            log: Vec::new(),
            transaction_id,
            snapshot_id,
            transaction_key,
            governed: false,
            _transaction_guard: transaction_guard,
            completed: false,
        }
    }

    pub fn bulk_loader(&self) -> MemoryStorageBulkLoader<'_> {
        MemoryStorageBulkLoader {
            transaction: self.start_transaction(),
            done: 0,
            hooks: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MemoryTransactionOutcomeState {
    Staging,
    CommitAttempted,
    Committed,
    RolledBack,
}

#[derive(Clone)]
#[must_use]
pub struct MemoryStorageReader<'a> {
    storage: MemoryStorage,
    snapshot_id: usize,
    _lifetime: PhantomData<&'a ()>,
}

impl<'a> MemoryStorageReader<'a> {
    pub fn len(&self) -> usize {
        self.storage
            .content
            .quad_set
            .iter()
            .filter(|e| self.is_node_in_range(e))
            .count()
    }

    pub fn is_empty(&self) -> bool {
        !self
            .storage
            .content
            .quad_set
            .iter()
            .any(|e| self.is_node_in_range(&e))
    }

    pub fn contains(&self, quad: &EncodedQuad) -> bool {
        self.storage
            .content
            .quad_set
            .get(quad)
            .is_some_and(|node| self.is_node_in_range(&node))
    }

    pub fn quads_for_pattern(
        &self,
        subject: Option<&EncodedTerm>,
        predicate: Option<&EncodedTerm>,
        object: Option<&EncodedTerm>,
        graph_name: Option<&EncodedTerm>,
    ) -> QuadIterator<'a> {
        fn get_start_and_count(
            map: &DashMap<EncodedTerm, (Weak<QuadListNode>, u64), BuildHasherDefault<FxHasher>>,
            term: Option<&EncodedTerm>,
        ) -> (Option<Weak<QuadListNode>>, u64) {
            let Some(term) = term else {
                return (None, u64::MAX);
            };
            map.view(term, |_, (node, count)| (Some(Weak::clone(node)), *count))
                .unwrap_or_default()
        }

        let (subject_start, subject_count) =
            get_start_and_count(&self.storage.content.last_quad_by_subject, subject);
        let (predicate_start, predicate_count) =
            get_start_and_count(&self.storage.content.last_quad_by_predicate, predicate);
        let (object_start, object_count) =
            get_start_and_count(&self.storage.content.last_quad_by_object, object);
        let (graph_name_start, graph_name_count) =
            get_start_and_count(&self.storage.content.last_quad_by_graph_name, graph_name);

        let (start, kind) = if subject.is_some()
            && subject_count <= predicate_count
            && subject_count <= object_count
            && subject_count <= graph_name_count
        {
            (subject_start, QuadIteratorKind::Subject)
        } else if predicate.is_some()
            && predicate_count <= object_count
            && predicate_count <= graph_name_count
        {
            (predicate_start, QuadIteratorKind::Predicate)
        } else if object.is_some() && object_count <= graph_name_count {
            (object_start, QuadIteratorKind::Object)
        } else if graph_name.is_some() {
            (graph_name_start, QuadIteratorKind::GraphName)
        } else {
            (
                self.storage.content.last_quad.read().unwrap().clone(),
                QuadIteratorKind::All,
            )
        };
        QuadIterator {
            reader: self.clone(),
            current: start,
            kind,
            expect_subject: if kind == QuadIteratorKind::Subject {
                None
            } else {
                subject.cloned()
            },
            expect_predicate: if kind == QuadIteratorKind::Predicate {
                None
            } else {
                predicate.cloned()
            },
            expect_object: if kind == QuadIteratorKind::Object {
                None
            } else {
                object.cloned()
            },
            expect_graph_name: if kind == QuadIteratorKind::GraphName {
                None
            } else {
                graph_name.cloned()
            },
        }
    }

    #[expect(unsafe_code)]
    pub fn named_graphs(&self) -> MemoryDecodingGraphIterator<'a> {
        MemoryDecodingGraphIterator {
            reader: self.clone(),
            // SAFETY: this is fine, the owning struct also owns the iterated data structure
            iter: unsafe {
                transmute::<Iter<'_, _, _>, Iter<'a, _, _>>(self.storage.content.graphs.iter())
            },
        }
    }

    pub fn contains_named_graph(&self, graph_name: &EncodedTerm) -> bool {
        self.storage
            .content
            .graphs
            .get(graph_name)
            .is_some_and(|range| self.is_in_range(&range))
    }

    pub fn namespaces(&self) -> Result<Vec<Namespace>, StorageError> {
        let mut namespaces = Vec::<Namespace>::new();
        let mut prefixes = FxHashSet::default();
        for entry in &self.storage.content.namespaces {
            if !self.is_in_range(entry.value()) {
                continue;
            }
            if !prefixes.insert(entry.key().prefix.clone()) {
                return Err(CorruptionError::msg(
                    "multiple namespace mappings are visible for one prefix",
                )
                .into());
            }
            namespaces.push(Namespace::new(
                entry.key().prefix.clone(),
                entry.key().iri.clone(),
            ));
        }
        namespaces.sort_unstable_by(|left, right| {
            left.prefix()
                .as_str()
                .as_bytes()
                .cmp(right.prefix().as_str().as_bytes())
        });
        Ok(namespaces)
    }

    pub fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, StorageError> {
        Ok(self
            .namespaces()?
            .into_iter()
            .find(|namespace| namespace.prefix() == prefix))
    }

    pub fn contains_str(&self, key: &StrHash) -> bool {
        self.storage.id2str.contains_key(key)
    }

    /// Validate that all the storage invariants held in the data
    #[expect(clippy::unwrap_in_result)]
    pub fn validate(&self) -> Result<(), StorageError> {
        self.namespaces()?;
        // All used named graphs are in graph set
        let expected_quad_len = self.storage.content.quad_set.len() as u64;

        // last quad chain
        let mut next = self.storage.content.last_quad.read().unwrap().clone();
        let mut count_last_quad = 0;
        while let Some(current) = next.take().and_then(|c| c.upgrade()) {
            count_last_quad += 1;
            if !self
                .storage
                .content
                .quad_set
                .get(&current.quad)
                .is_some_and(|e| Arc::ptr_eq(&e, &current))
            {
                return Err(
                    CorruptionError::new("Quad in previous chain but not in quad set").into(),
                );
            }
            self.decode_quad(&current.quad)?;
            if !current.quad.graph_name.is_default_graph()
                && !self
                    .storage
                    .content
                    .graphs
                    .contains_key(&current.quad.graph_name)
            {
                return Err(
                    CorruptionError::new("Quad in named graph that does not exists").into(),
                );
            }
            next.clone_from(&current.previous);
        }
        if count_last_quad != expected_quad_len {
            return Err(CorruptionError::new("Too many quads in quad_set").into());
        }

        // By subject chain
        let mut count_last_by_subject = 0;
        for entry in &self.storage.content.last_quad_by_subject {
            let mut next = Some(Weak::clone(&entry.value().0));
            let mut element_count = 0;
            while let Some(current) = next.take().and_then(|n| n.upgrade()) {
                element_count += 1;
                if current.quad.subject != *entry.key() {
                    return Err(CorruptionError::new("Quad in wrong list").into());
                }
                if !self
                    .storage
                    .content
                    .quad_set
                    .get(&current.quad)
                    .is_some_and(|e| Arc::ptr_eq(&e, &current))
                {
                    return Err(
                        CorruptionError::new("Quad in previous chain but not in quad set").into(),
                    );
                }
                next.clone_from(&current.previous_subject);
            }
            if element_count != entry.value().1 {
                return Err(CorruptionError::new("Too many quads in a chain").into());
            }
            count_last_by_subject += element_count;
        }
        if count_last_by_subject != expected_quad_len {
            return Err(CorruptionError::new("Too many quads in quad_set").into());
        }

        // By predicate chains
        let mut count_last_by_predicate = 0;
        for entry in &self.storage.content.last_quad_by_predicate {
            let mut next = Some(Weak::clone(&entry.value().0));
            let mut element_count = 0;
            while let Some(current) = next.take().and_then(|n| n.upgrade()) {
                element_count += 1;
                if current.quad.predicate != *entry.key() {
                    return Err(CorruptionError::new("Quad in wrong list").into());
                }
                if !self
                    .storage
                    .content
                    .quad_set
                    .get(&current.quad)
                    .is_some_and(|e| Arc::ptr_eq(&e, &current))
                {
                    return Err(
                        CorruptionError::new("Quad in previous chain but not in quad set").into(),
                    );
                }
                next.clone_from(&current.previous_predicate);
            }
            if element_count != entry.value().1 {
                return Err(CorruptionError::new("Too many quads in a chain").into());
            }
            count_last_by_predicate += element_count;
        }
        if count_last_by_predicate != expected_quad_len {
            return Err(CorruptionError::new("Too many quads in quad_set").into());
        }

        // By object chains
        let mut count_last_by_object = 0;
        for entry in &self.storage.content.last_quad_by_object {
            let mut next = Some(Weak::clone(&entry.value().0));
            let mut element_count = 0;
            while let Some(current) = next.take().and_then(|n| n.upgrade()) {
                element_count += 1;
                if current.quad.object != *entry.key() {
                    return Err(CorruptionError::new("Quad in wrong list").into());
                }
                if !self
                    .storage
                    .content
                    .quad_set
                    .get(&current.quad)
                    .is_some_and(|e| Arc::ptr_eq(&e, &current))
                {
                    return Err(
                        CorruptionError::new("Quad in previous chain but not in quad set").into(),
                    );
                }
                next.clone_from(&current.previous_object);
            }
            if element_count != entry.value().1 {
                return Err(CorruptionError::new("Too many quads in a chain").into());
            }
            count_last_by_object += element_count;
        }
        if count_last_by_object != expected_quad_len {
            return Err(CorruptionError::new("Too many quads in quad_set").into());
        }

        // By graph_name chains
        let mut count_last_by_graph_name = 0;
        for entry in &self.storage.content.last_quad_by_graph_name {
            let mut next = Some(Weak::clone(&entry.value().0));
            let mut element_count = 0;
            while let Some(current) = next.take().and_then(|n| n.upgrade()) {
                element_count += 1;
                if current.quad.graph_name != *entry.key() {
                    return Err(CorruptionError::new("Quad in wrong list").into());
                }
                if !self
                    .storage
                    .content
                    .quad_set
                    .get(&current.quad)
                    .is_some_and(|e| Arc::ptr_eq(&e, &current))
                {
                    return Err(
                        CorruptionError::new("Quad in previous chain but not in quad set").into(),
                    );
                }
                next.clone_from(&current.previous_graph_name);
            }
            if element_count != entry.value().1 {
                return Err(CorruptionError::new("Too many quads in a chain").into());
            }
            count_last_by_graph_name += element_count;
        }
        if count_last_by_graph_name != expected_quad_len {
            return Err(CorruptionError::new("Too many quads in quad_set").into());
        }

        Ok(())
    }

    fn is_in_range(&self, range: &VersionRange) -> bool {
        range.contains(self.snapshot_id)
    }

    fn is_node_in_range(&self, node: &QuadListNode) -> bool {
        let range = node.range.lock().unwrap();
        self.is_in_range(&range)
    }
}

impl StrLookup for MemoryStorageReader<'_> {
    fn get_str(&self, key: &StrHash) -> Result<Option<OxString>, StorageError> {
        Ok(self.storage.id2str.view(key, |_, v| v.clone()))
    }
}

#[must_use]
pub struct MemoryStorageTransaction<'a> {
    storage: &'a MemoryStorage,
    log: Vec<LogEntry>,
    transaction_id: usize,
    snapshot_id: usize,
    transaction_key: Option<[u8; 16]>,
    governed: bool,
    completed: bool,
    _transaction_guard: LockGuard<'a>,
}

impl MemoryStorageTransaction<'_> {
    fn transition_outcome(
        &self,
        expected: MemoryTransactionOutcomeState,
        next: MemoryTransactionOutcomeState,
    ) -> Result<(), StorageError> {
        let Some(transaction_key) = self.transaction_key else {
            return Ok(());
        };
        let Some(mut state) = self.storage.transaction_outcomes.get_mut(&transaction_key) else {
            return Err(CorruptionError::msg(
                "a keyed memory transaction lost its outcome reservation",
            )
            .into());
        };
        if *state != expected {
            return Err(CorruptionError::msg(
                "a keyed memory transaction outcome attempted an invalid transition",
            )
            .into());
        }
        *state = next;
        Ok(())
    }

    fn transition_to_rolled_back(&self) -> Result<(), StorageError> {
        let Some(transaction_key) = self.transaction_key else {
            return Ok(());
        };
        let Some(mut state) = self.storage.transaction_outcomes.get_mut(&transaction_key) else {
            return Err(CorruptionError::msg(
                "a keyed memory transaction lost its outcome reservation",
            )
            .into());
        };
        if *state != MemoryTransactionOutcomeState::Staging {
            return Err(CorruptionError::msg(
                "a keyed memory transaction may roll back only before commit is attempted",
            )
            .into());
        }
        *state = MemoryTransactionOutcomeState::RolledBack;
        Ok(())
    }

    pub fn reader(&self) -> MemoryStorageReader<'_> {
        MemoryStorageReader {
            storage: self.storage.clone(),
            snapshot_id: self.transaction_id,
            _lifetime: PhantomData,
        }
    }

    pub fn set_namespace(&mut self, namespace: Namespace) -> Result<(), StorageError> {
        if let Some(current) = self.reader().namespace(namespace.prefix())? {
            if current == namespace {
                return Ok(());
            }
            self.remove_namespace_mapping(current);
        }
        let (prefix, iri) = namespace.into_parts();
        let mapping = NamespaceMapping { prefix, iri };
        let added = match self.storage.content.namespaces.entry(mapping.clone()) {
            Entry::Occupied(mut entry) => entry.get_mut().add(self.transaction_id),
            Entry::Vacant(entry) => {
                entry.insert(VersionRange::Start(self.transaction_id));
                true
            }
        };
        if added {
            self.log.push(LogEntry::Namespace(mapping));
        }
        Ok(())
    }

    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), StorageError> {
        if let Some(namespace) = self.reader().namespace(prefix)? {
            self.remove_namespace_mapping(namespace);
        }
        Ok(())
    }

    fn remove_namespace_mapping(&mut self, namespace: Namespace) {
        let (prefix, iri) = namespace.into_parts();
        let mapping = NamespaceMapping { prefix, iri };
        let removed = self
            .storage
            .content
            .namespaces
            .get_mut(&mapping)
            .is_some_and(|mut entry| entry.value_mut().remove(self.transaction_id));
        if removed {
            self.log.push(LogEntry::Namespace(mapping));
        }
    }

    pub fn clear_namespaces(&mut self) -> Result<(), StorageError> {
        for namespace in self.reader().namespaces()? {
            self.remove_namespace_mapping(namespace);
        }
        Ok(())
    }

    pub fn insert(&mut self, quad: Quad) {
        let encoded = EncodedQuad::from(&quad);
        if let Some(node) = self
            .storage
            .content
            .quad_set
            .get(&encoded)
            .map(|node| Arc::clone(&node))
        {
            let added = node.range.lock().unwrap().add(self.transaction_id);
            if added {
                self.log.push(LogEntry::QuadNode(node));
                if !quad.graph_name.is_default_graph()
                    && self
                        .storage
                        .content
                        .graphs
                        .get_mut(&encoded.graph_name)
                        .unwrap()
                        .add(self.transaction_id)
                {
                    self.log.push(LogEntry::Graph(encoded.graph_name.clone()));
                }
            }
        } else {
            let node = Arc::new(QuadListNode {
                quad: encoded.clone(),
                range: Mutex::new(VersionRange::Start(self.transaction_id)),
                previous: self.storage.content.last_quad.read().unwrap().clone(),
                previous_subject: self
                    .storage
                    .content
                    .last_quad_by_subject
                    .view(&encoded.subject, |_, (node, _)| Weak::clone(node)),
                previous_predicate: self
                    .storage
                    .content
                    .last_quad_by_predicate
                    .view(&encoded.predicate, |_, (node, _)| Weak::clone(node)),
                previous_object: self
                    .storage
                    .content
                    .last_quad_by_object
                    .view(&encoded.object, |_, (node, _)| Weak::clone(node)),
                previous_graph_name: self
                    .storage
                    .content
                    .last_quad_by_graph_name
                    .view(&encoded.graph_name, |_, (node, _)| Weak::clone(node)),
            });
            self.storage.content.quad_set.insert(Arc::clone(&node));
            *self.storage.content.last_quad.write().unwrap() = Some(Arc::downgrade(&node));
            self.storage
                .content
                .last_quad_by_subject
                .entry(encoded.subject.clone())
                .and_modify(|(e, count)| {
                    *e = Arc::downgrade(&node);
                    *count += 1;
                })
                .or_insert_with(|| (Arc::downgrade(&node), 1));
            self.storage
                .content
                .last_quad_by_predicate
                .entry(encoded.predicate.clone())
                .and_modify(|(e, count)| {
                    *e = Arc::downgrade(&node);
                    *count += 1;
                })
                .or_insert_with(|| (Arc::downgrade(&node), 1));
            self.storage
                .content
                .last_quad_by_object
                .entry(encoded.object.clone())
                .and_modify(|(e, count)| {
                    *e = Arc::downgrade(&node);
                    *count += 1;
                })
                .or_insert_with(|| (Arc::downgrade(&node), 1));
            self.storage
                .content
                .last_quad_by_graph_name
                .entry(encoded.graph_name.clone())
                .and_modify(|(e, count)| {
                    *e = Arc::downgrade(&node);
                    *count += 1;
                })
                .or_insert_with(|| (Arc::downgrade(&node), 1));

            self.insert_term(quad.subject.into(), &encoded.subject);
            self.insert_term(quad.predicate.into(), &encoded.predicate);
            self.insert_term(quad.object, &encoded.object);

            match quad.graph_name {
                GraphName::NamedNode(graph_name) => {
                    self.insert_encoded_named_graph(graph_name.into(), encoded.graph_name.clone());
                }
                GraphName::BlankNode(graph_name) => {
                    self.insert_encoded_named_graph(graph_name.into(), encoded.graph_name.clone());
                }
                GraphName::DefaultGraph => (),
            }
            self.log.push(LogEntry::QuadNode(node));
        }
    }

    pub fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) {
        let encoded_graph_name = (&graph_name).into();
        self.insert_encoded_named_graph(graph_name, encoded_graph_name)
    }

    fn insert_encoded_named_graph(
        &mut self,
        graph_name: NamedOrBlankNode,
        encoded_graph_name: EncodedTerm,
    ) {
        let added = match self
            .storage
            .content
            .graphs
            .entry(encoded_graph_name.clone())
        {
            Entry::Occupied(mut entry) => entry.get_mut().add(self.transaction_id),
            Entry::Vacant(entry) => {
                entry.insert(VersionRange::Start(self.transaction_id));
                self.insert_term(graph_name.into(), &encoded_graph_name);
                true
            }
        };
        if added {
            self.log.push(LogEntry::Graph(encoded_graph_name));
        }
    }

    fn insert_term(&self, term: Term, encoded: &EncodedTerm) {
        insert_term(term, encoded, &mut |key, value| {
            self.insert_str(key, &value)
        })
    }

    fn insert_str(&self, key: &StrHash, value: &OxString) {
        let inserted = self
            .storage
            .id2str
            .entry(*key)
            .or_insert_with(|| value.clone());
        debug_assert_eq!(
            inserted.as_str(),
            value.as_str(),
            "Hash conflict for two strings"
        );
    }

    pub fn remove(&mut self, quad: &Quad) {
        self.remove_encoded(&quad.into())
    }

    fn remove_encoded(&mut self, quad: &EncodedQuad) {
        let Some(node) = self
            .storage
            .content
            .quad_set
            .get(quad)
            .map(|node| Arc::clone(&node))
        else {
            return;
        };
        let removed = node.range.lock().unwrap().remove(self.transaction_id);
        if removed {
            self.log.push(LogEntry::QuadNode(node));
        }
    }

    pub fn clear_graph(&mut self, graph_name: &GraphName) {
        self.clear_encoded_graph(&graph_name.into())
    }

    fn clear_encoded_graph(&mut self, graph_name: &EncodedTerm) {
        let mut next = self
            .storage
            .content
            .last_quad_by_graph_name
            .view(graph_name, |_, (node, _)| Weak::clone(node));
        while let Some(current) = next.take().and_then(|c| c.upgrade()) {
            if current.range.lock().unwrap().remove(self.transaction_id) {
                self.log.push(LogEntry::QuadNode(Arc::clone(&current)));
            }
            next.clone_from(&current.previous_graph_name);
        }
    }

    pub fn clear_all_named_graphs(&mut self) {
        let graph_names = self.reader().named_graphs().collect::<Vec<_>>();
        for graph_name in graph_names {
            self.clear_encoded_graph(&graph_name)
        }
    }

    pub fn clear_all_graphs(&mut self) {
        self.storage.content.quad_set.iter().for_each(|node| {
            if node.range.lock().unwrap().remove(self.transaction_id) {
                self.log.push(LogEntry::QuadNode(Arc::clone(&node)));
            }
        });
    }

    pub fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) {
        self.remove_encoded_named_graph(&graph_name.into())
    }

    fn remove_encoded_named_graph(&mut self, graph_name: &EncodedTerm) {
        self.clear_encoded_graph(graph_name);
        let removed = self
            .storage
            .content
            .graphs
            .get_mut(graph_name)
            .is_some_and(|mut entry| entry.value_mut().remove(self.transaction_id));
        if removed {
            self.log.push(LogEntry::Graph(graph_name.clone()));
        }
    }

    pub fn remove_all_named_graphs(&mut self) {
        self.clear_all_named_graphs();
        self.do_remove_graphs();
    }

    fn do_remove_graphs(&mut self) {
        self.storage
            .content
            .graphs
            .iter_mut()
            .for_each(|mut entry| {
                if entry.value_mut().remove(self.transaction_id) {
                    self.log.push(LogEntry::Graph(entry.key().clone()));
                }
            });
    }

    pub fn clear(&mut self) {
        self.clear_all_graphs();
        self.do_remove_graphs();
    }

    fn publish(&mut self) {
        let new_version_id = self.snapshot_id + 1;
        for operation in take(&mut self.log) {
            match operation {
                LogEntry::QuadNode(node) => {
                    node.range
                        .lock()
                        .unwrap()
                        .upgrade_transaction(self.transaction_id, new_version_id);
                }
                LogEntry::Graph(graph_name) => {
                    if let Some(mut entry) = self.storage.content.graphs.get_mut(&graph_name) {
                        entry
                            .value_mut()
                            .upgrade_transaction(self.transaction_id, new_version_id)
                    }
                }
                LogEntry::Namespace(mapping) => {
                    if let Some(mut entry) = self.storage.content.namespaces.get_mut(&mapping) {
                        entry
                            .value_mut()
                            .upgrade_transaction(self.transaction_id, new_version_id)
                    }
                }
            }
        }
        self.storage
            .version_counter
            .store(new_version_id, Ordering::Release);
        self.completed = true;
    }

    fn rollback_changes(&mut self) {
        for operation in take(&mut self.log) {
            match operation {
                LogEntry::QuadNode(node) => {
                    node.range
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .rollback_transaction(self.transaction_id);
                }
                LogEntry::Graph(graph_name) => {
                    if let Some(mut entry) = self.storage.content.graphs.get_mut(&graph_name) {
                        entry.value_mut().rollback_transaction(self.transaction_id)
                    }
                }
                LogEntry::Namespace(mapping) => {
                    if let Some(mut entry) = self.storage.content.namespaces.get_mut(&mapping) {
                        entry.value_mut().rollback_transaction(self.transaction_id)
                    }
                }
            }
        }
    }

    pub fn commit(mut self) {
        self.publish();
    }

    pub fn commit_with_outcome(mut self) -> Result<(), StorageError> {
        if self.governed {
            return Err(StorageError::Other(
                "a governed transaction must commit its receipt".into(),
            ));
        }
        self.transition_outcome(
            MemoryTransactionOutcomeState::Staging,
            MemoryTransactionOutcomeState::CommitAttempted,
        )?;
        self.publish();
        self.transition_outcome(
            MemoryTransactionOutcomeState::CommitAttempted,
            MemoryTransactionOutcomeState::Committed,
        )
    }

    pub fn commit_with_receipt(
        mut self,
        changes: &SemanticChangeSet,
        validation: Option<crate::store::shacl_receipt::ValidationCommitContext<'_>>,
    ) -> Result<CommitReceipt, TransactionCommitError<StorageError>> {
        let transaction_key = self.transaction_key.ok_or_else(|| {
            TransactionCommitError::Rejected(StorageError::Other(
                "governed transaction key missing".into(),
            ))
        })?;
        if !self.governed {
            return Err(TransactionCommitError::Rejected(StorageError::Other(
                "receipt capture was not enabled at admission".into(),
            )));
        }
        let storage = self.storage;
        let mut governance = storage.governance.write().map_err(|_| {
            TransactionCommitError::Rejected(
                CorruptionError::msg("poisoned memory governance state").into(),
            )
        })?;
        storage
            .read_outbox_locked(&governance, None, std::num::NonZeroUsize::MIN)
            .map_err(|error| TransactionCommitError::Rejected(error.into_storage()))?;
        let prepared = crate::store::outbox::prepare(&governance.state, &transaction_key, changes)
            .map_err(TransactionCommitError::Rejected)?;
        let terminal = crate::store::shacl_receipt::GovernedReceipt::new(
            prepared.receipt.clone(),
            validation.map(|context| context.evidence),
        )
        .map_err(TransactionCommitError::Rejected)?;
        let mut outcome = storage
            .transaction_outcomes
            .get_mut(&transaction_key)
            .ok_or_else(|| {
                TransactionCommitError::Rejected(
                    CorruptionError::msg("missing governed transaction reservation").into(),
                )
            })?;
        if *outcome != MemoryTransactionOutcomeState::Staging {
            return Err(TransactionCommitError::Rejected(
                CorruptionError::msg("governed transaction is not staging").into(),
            ));
        }
        if let Some(validation) = validation {
            if let Err(source) = (validation.before_attempt)() {
                // Release the outcome guard before rollback reacquires that entry.
                drop(outcome);
                drop(governance);
                let rollback = self.rollback_with_outcome().err();
                return Err(TransactionCommitError::Rejected(StorageError::Other(
                    Box::new(crate::store::shacl_receipt::ValidationPreAttemptError {
                        source,
                        rollback,
                    }),
                )));
            }
        }
        *outcome = MemoryTransactionOutcomeState::CommitAttempted;
        let receipt = prepared.receipt;
        governance.state = prepared.state;
        governance.outbox.extend(prepared.records);
        governance.receipts.insert(transaction_key, terminal);
        self.publish();
        // Retain the entry guard: no fallible lookup remains after publication.
        *outcome = MemoryTransactionOutcomeState::Committed;
        Ok(receipt)
    }

    pub fn rollback_with_outcome(mut self) -> Result<(), StorageError> {
        self.rollback_changes();
        let result = self.transition_to_rolled_back();
        self.completed = true;
        result
    }
}

impl Drop for MemoryStorageTransaction<'_> {
    fn drop(&mut self) {
        // We roll back
        if !self.completed {
            self.rollback_changes();
            // Drop cannot report an invariant failure. Leaving the reservation missing or
            // nonterminal makes lookup fail closed as Indeterminate; an existing terminal state
            // is never overwritten.
            drop(self.transition_to_rolled_back());
            self.completed = true;
            // TODO: garbage collection
        }
    }
}

#[must_use]
pub struct QuadIterator<'a> {
    reader: MemoryStorageReader<'a>,
    current: Option<Weak<QuadListNode>>,
    kind: QuadIteratorKind,
    expect_subject: Option<EncodedTerm>,
    expect_predicate: Option<EncodedTerm>,
    expect_object: Option<EncodedTerm>,
    expect_graph_name: Option<EncodedTerm>,
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum QuadIteratorKind {
    All,
    Subject,
    Predicate,
    Object,
    GraphName,
}

impl Iterator for QuadIterator<'_> {
    type Item = EncodedQuad;

    fn next(&mut self) -> Option<EncodedQuad> {
        loop {
            let current = self.current.take()?.upgrade()?;
            self.current = match self.kind {
                QuadIteratorKind::All => current.previous.clone(),
                QuadIteratorKind::Subject => current.previous_subject.clone(),
                QuadIteratorKind::Predicate => current.previous_predicate.clone(),
                QuadIteratorKind::Object => current.previous_object.clone(),
                QuadIteratorKind::GraphName => current.previous_graph_name.clone(),
            };
            if !self.reader.is_node_in_range(&current) {
                continue;
            }
            if let Some(expect_subject) = &self.expect_subject {
                if current.quad.subject != *expect_subject {
                    continue;
                }
            }
            if let Some(expect_predicate) = &self.expect_predicate {
                if current.quad.predicate != *expect_predicate {
                    continue;
                }
            }
            if let Some(expect_object) = &self.expect_object {
                if current.quad.object != *expect_object {
                    continue;
                }
            }
            if let Some(expect_graph_name) = &self.expect_graph_name {
                if current.quad.graph_name != *expect_graph_name {
                    continue;
                }
            }
            return Some(current.quad.clone());
        }
    }
}

#[must_use]
pub struct MemoryDecodingGraphIterator<'a> {
    reader: MemoryStorageReader<'a>, // Needed to make sure the underlying map is not GCed
    iter: Iter<'a, EncodedTerm, VersionRange>,
}

impl Iterator for MemoryDecodingGraphIterator<'_> {
    type Item = EncodedTerm;

    fn next(&mut self) -> Option<EncodedTerm> {
        loop {
            let entry = self.iter.next()?;
            if self.reader.is_in_range(entry.value()) {
                return Some(entry.key().clone());
            }
        }
    }
}

#[must_use]
pub struct MemoryStorageBulkLoader<'a> {
    transaction: MemoryStorageTransaction<'a>,
    done: u64,
    hooks: Vec<Box<dyn Fn(u64) + Send + Sync>>,
}

impl MemoryStorageBulkLoader<'_> {
    pub fn on_progress(mut self, callback: impl Fn(u64) + Send + Sync + 'static) -> Self {
        self.hooks.push(Box::new(callback));
        self
    }

    pub fn load_batch(&mut self, new_quads: Vec<Quad>) {
        for quad in new_quads {
            self.transaction.insert(quad);
            self.done += 1;
            if self.done.is_multiple_of(1_000_000) {
                for hook in &self.hooks {
                    hook(self.done);
                }
            }
        }
    }

    pub fn load_named_graphs(&mut self, graph_names: Vec<NamedOrBlankNode>) {
        for graph_name in graph_names {
            self.transaction.insert_named_graph(graph_name);
        }
    }

    pub fn commit(self) {
        self.transaction.commit();
    }
}

enum LogEntry {
    QuadNode(Arc<QuadListNode>),
    Graph(EncodedTerm),
    Namespace(NamespaceMapping),
}

struct QuadListNode {
    quad: EncodedQuad,
    range: Mutex<VersionRange>,
    previous: Option<Weak<Self>>,
    previous_subject: Option<Weak<Self>>,
    previous_predicate: Option<Weak<Self>>,
    previous_object: Option<Weak<Self>>,
    previous_graph_name: Option<Weak<Self>>,
}

impl PartialEq for QuadListNode {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.quad == other.quad
    }
}

impl Eq for QuadListNode {}

impl Hash for QuadListNode {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.quad.hash(state)
    }
}

impl Borrow<EncodedQuad> for Arc<QuadListNode> {
    fn borrow(&self) -> &EncodedQuad {
        &self.quad
    }
}

// TODO: reduce the size to 128bits
#[derive(Default, Eq, PartialEq, Clone)]
enum VersionRange {
    #[default]
    Empty,
    Start(usize),
    StartEnd(usize, usize),
    Bigger(Box<[usize]>),
}

impl VersionRange {
    fn contains(&self, version: usize) -> bool {
        match self {
            VersionRange::Empty => false,
            VersionRange::Start(start) => *start <= version,
            VersionRange::StartEnd(start, end) => *start <= version && version < *end,
            VersionRange::Bigger(range) => {
                for start_end in range.chunks(2) {
                    match start_end {
                        [start, end] if *start <= version && version < *end => {
                            return true;
                        }
                        [start] if *start <= version => {
                            return true;
                        }
                        _ => (),
                    }
                }
                false
            }
        }
    }

    fn add(&mut self, version: usize) -> bool {
        match self {
            VersionRange::Empty => {
                *self = VersionRange::Start(version);
                true
            }
            VersionRange::Start(_) => false,
            VersionRange::StartEnd(start, end) => {
                *self = if version == *end {
                    VersionRange::Start(*start)
                } else {
                    VersionRange::Bigger(Box::new([*start, *end, version]))
                };
                true
            }
            VersionRange::Bigger(vec) => {
                if vec.len() % 2 == 0 {
                    *self = VersionRange::Bigger(if vec.ends_with(&[version]) {
                        pop_boxed_slice(vec)
                    } else {
                        push_boxed_slice(vec, version)
                    });
                    true
                } else {
                    false
                }
            }
        }
    }

    fn remove(&mut self, version: usize) -> bool {
        match self {
            VersionRange::Empty | VersionRange::StartEnd(_, _) => false,
            VersionRange::Start(start) => {
                *self = if *start == version {
                    VersionRange::Empty
                } else {
                    VersionRange::StartEnd(*start, version)
                };
                true
            }
            VersionRange::Bigger(vec) => {
                if vec.len() % 2 == 0 {
                    false
                } else {
                    *self = if vec.ends_with(&[version]) {
                        match vec.as_ref() {
                            [start, end, _] => Self::StartEnd(*start, *end),
                            _ => Self::Bigger(pop_boxed_slice(vec)),
                        }
                    } else {
                        Self::Bigger(push_boxed_slice(vec, version))
                    };
                    true
                }
            }
        }
    }

    fn upgrade_transaction(&mut self, transaction_id: usize, version_id: usize) {
        match self {
            VersionRange::Empty => (),
            VersionRange::Start(start) => {
                if *start == transaction_id {
                    *start = version_id;
                }
            }
            VersionRange::StartEnd(_, end) => {
                if *end == transaction_id {
                    *end = version_id
                }
            }
            VersionRange::Bigger(vec) => {
                if vec.ends_with(&[transaction_id]) {
                    vec[vec.len() - 1] = version_id
                }
            }
        }
    }

    fn rollback_transaction(&mut self, transaction_id: usize) {
        match self {
            VersionRange::Empty => (),
            VersionRange::Start(start) => {
                if *start == transaction_id {
                    *self = VersionRange::Empty;
                }
            }
            VersionRange::StartEnd(start, end) => {
                if *end == transaction_id {
                    *self = VersionRange::Start(*start)
                }
            }
            VersionRange::Bigger(vec) => {
                if vec.ends_with(&[transaction_id]) {
                    *self = match vec.as_ref() {
                        [start, end, _] => Self::StartEnd(*start, *end),
                        _ => Self::Bigger(pop_boxed_slice(vec)),
                    }
                }
            }
        }
    }
}

fn push_boxed_slice<T: Copy>(slice: &[T], element: T) -> Box<[T]> {
    let mut out = Vec::with_capacity(slice.len() + 1);
    out.extend_from_slice(slice);
    out.push(element);
    out.into_boxed_slice()
}

fn pop_boxed_slice<T: Copy>(slice: &[T]) -> Box<[T]> {
    slice[..slice.len() - 1].into()
}

struct Lock {
    mutex: Mutex<bool>,
    condvar: Condvar,
}

impl Lock {
    fn new() -> Self {
        Self {
            mutex: Mutex::new(false),
            condvar: Condvar::new(),
        }
    }

    fn lock(&self) -> LockGuard<'_> {
        *self
            .condvar
            .wait_while(self.mutex.lock().unwrap(), |v| *v)
            .unwrap() = true;
        LockGuard {
            mutex: &self.mutex,
            condvar: &self.condvar,
        }
    }

    fn lock_with_control(
        &self,
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<LockGuard<'_>, TransactionStartControlError> {
        control.check(started_at)?;
        let mut occupied = self
            .mutex
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while *occupied {
            let wait = control.next_wait(started_at)?;
            (occupied, _) = self
                .condvar
                .wait_timeout(occupied, wait)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        control.check(started_at)?;
        *occupied = true;
        Ok(LockGuard {
            mutex: &self.mutex,
            condvar: &self.condvar,
        })
    }
}

struct LockGuard<'a> {
    mutex: &'a Mutex<bool>,
    condvar: &'a Condvar,
}

impl Drop for LockGuard<'_> {
    fn drop(&mut self) {
        *self.mutex.lock().unwrap() = false;
        self.condvar.notify_one();
    }
}

#[cfg(test)]
#[expect(clippy::panic_in_result_fn)]
mod tests {
    use super::*;
    use crate::model::NamedNode;

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::missing_assert_message,
        reason = "receipt invariant assertions"
    )]
    fn governed_memory_rejects_invalid_reservation_before_publication()
    -> Result<(), Box<dyn std::error::Error>> {
        for state in [None, Some(MemoryTransactionOutcomeState::RolledBack)] {
            let storage = MemoryStorage::new();
            let key = [1; 16];
            let mut tx = storage
                .start_governed_transaction_with_control(
                    &key,
                    &TransactionStartControl::new(),
                    Instant::now(),
                )
                .map_err(|_| "fresh memory transaction did not open")?;
            let node = NamedNode::new_unchecked("urn:unpublished");
            let quad = Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph);
            tx.insert(quad.clone());
            if let Some(state) = state {
                storage.transaction_outcomes.insert(key, state);
            } else {
                storage.transaction_outcomes.remove(&key);
            }
            assert!(matches!(
                tx.commit_with_receipt(&SemanticChangeSet::default(), None),
                Err(TransactionCommitError::Rejected(StorageError::Corruption(
                    _
                )))
            ));
            assert!(!storage.snapshot().contains(&EncodedQuad::from(&quad)));
            let governance = storage.governance.read().unwrap();
            assert_eq!(governance.state.sequence, 0);
            assert!(governance.receipts.is_empty());
        }
        Ok(())
    }

    #[test]
    #[expect(
        clippy::panic,
        clippy::missing_assert_message,
        reason = "intentional lock poison tests fail-closed lookups"
    )]
    fn governed_memory_poison_is_corruption_for_both_lookups() {
        let storage = MemoryStorage::new();
        drop(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || {
                let _guard = storage.governance.write().unwrap();
                panic!("inject governance lock poison");
            },
        )));
        assert!(matches!(
            storage.lookup_commit_receipt(&[1; 16]),
            Err(StorageError::Corruption(_))
        ));
        assert!(matches!(
            storage.lookup_transaction_outcome(&[1; 16]),
            Err(StorageError::Corruption(_))
        ));
    }

    #[test]
    fn test_range() {
        let mut range = VersionRange::default();

        assert!(range.add(1));
        assert!(!range.add(1));
        assert!(range.contains(1));
        assert!(!range.contains(0));
        assert!(range.contains(2));

        assert!(range.remove(1));
        assert!(!range.remove(1));
        assert!(!range.contains(1));

        assert!(range.add(1));
        assert!(range.remove(2));
        assert!(!range.remove(2));
        assert!(range.contains(1));
        assert!(!range.contains(2));

        assert!(range.add(2));
        assert!(range.contains(3));

        assert!(range.remove(2));
        assert!(range.add(4));
        assert!(range.remove(6));
        assert!(!range.contains(3));
        assert!(range.contains(4));
        assert!(!range.contains(6));
    }

    #[test]
    fn test_upgrade() {
        let mut range = VersionRange::default();

        assert!(range.add(1000));
        range.upgrade_transaction(999, 1);
        assert!(!range.contains(1));
        range.upgrade_transaction(1000, 1);
        assert!(range.contains(1));

        assert!(range.remove(1000));
        range.upgrade_transaction(999, 2);
        assert!(range.contains(2));
        range.upgrade_transaction(1000, 2);
        assert!(!range.contains(2));

        assert!(range.add(1000));
        range.upgrade_transaction(999, 3);
        assert!(!range.contains(3));
        range.upgrade_transaction(1000, 3);
        assert!(range.contains(3));
    }

    #[test]
    fn test_rollback() {
        let mut range = VersionRange::default();

        assert!(range.add(1000));
        range.rollback_transaction(999);
        assert!(range.contains(1000));
        range.rollback_transaction(1000);
        assert!(!range.contains(1));
    }

    #[test]
    fn test_transaction() -> Result<(), StorageError> {
        let example = NamedNode::new_unchecked("http://example.com/1");
        let example2 = NamedNode::new_unchecked("http://example.com/2");
        let encoded_example = EncodedTerm::from(&example);
        let encoded_example2 = EncodedTerm::from(&example2);
        let default_quad = Quad::new(
            example.clone(),
            example.clone(),
            example.clone(),
            GraphName::DefaultGraph,
        );
        let encoded_default_quad = EncodedQuad::from(&default_quad);
        let named_graph_quad = Quad::new(
            example.clone(),
            example.clone(),
            example.clone(),
            example.clone(),
        );
        let encoded_named_graph_quad = EncodedQuad::from(&named_graph_quad);

        let storage = MemoryStorage::new();

        // We start with a graph
        let snapshot = storage.snapshot();
        let mut transaction = storage.start_transaction();
        transaction.insert_named_graph(example.clone().into());
        transaction.commit();
        assert!(!snapshot.contains_named_graph(&encoded_example));
        assert!(storage.snapshot().contains_named_graph(&encoded_example));
        storage.snapshot().validate()?;

        // We add two quads
        let snapshot = storage.snapshot();
        let mut transaction = storage.start_transaction();
        transaction.insert(default_quad.clone());
        transaction.insert(named_graph_quad.clone());
        transaction.commit();
        assert!(!snapshot.contains(&encoded_default_quad));
        assert!(!snapshot.contains(&encoded_named_graph_quad));
        assert!(storage.snapshot().contains(&encoded_default_quad));
        assert!(storage.snapshot().contains(&encoded_named_graph_quad));
        storage.snapshot().validate()?;

        // We remove the quads
        let snapshot = storage.snapshot();
        let mut transaction = storage.start_transaction();
        transaction.remove(&default_quad);
        transaction.remove_named_graph(&example.into());
        transaction.commit();
        assert!(snapshot.contains(&encoded_default_quad));
        assert!(snapshot.contains(&encoded_named_graph_quad));
        assert!(snapshot.contains_named_graph(&encoded_example));
        assert!(!storage.snapshot().contains(&encoded_default_quad));
        assert!(!storage.snapshot().contains(&encoded_named_graph_quad));
        assert!(!storage.snapshot().contains_named_graph(&encoded_example));
        storage.snapshot().validate()?;

        // We add the quads again but rollback
        let snapshot = storage.snapshot();
        let mut transaction = storage.start_transaction();
        transaction.insert(default_quad.clone());
        transaction.insert(named_graph_quad.clone());
        transaction.insert_named_graph(example2.clone().into());
        drop(transaction);
        assert!(!snapshot.contains(&encoded_default_quad));
        assert!(!snapshot.contains(&encoded_named_graph_quad));
        assert!(!snapshot.contains_named_graph(&encoded_example));
        assert!(!snapshot.contains_named_graph(&encoded_example2));
        assert!(!storage.snapshot().contains(&encoded_default_quad));
        assert!(!storage.snapshot().contains(&encoded_named_graph_quad));
        assert!(!storage.snapshot().contains_named_graph(&encoded_example));
        assert!(!storage.snapshot().contains_named_graph(&encoded_example2));
        storage.snapshot().validate()?;

        // We add quads and graph, then clear
        storage
            .bulk_loader()
            .load_batch(vec![default_quad, named_graph_quad]);
        let mut transaction = storage.start_transaction();
        transaction.insert_named_graph(example2.into());
        transaction.commit();
        let mut transaction = storage.start_transaction();
        transaction.clear();
        transaction.commit();
        assert!(!storage.snapshot().contains(&encoded_default_quad));
        assert!(!storage.snapshot().contains(&encoded_named_graph_quad));
        assert!(!storage.snapshot().contains_named_graph(&encoded_example));
        assert!(!storage.snapshot().contains_named_graph(&encoded_example2));
        assert!(storage.snapshot().is_empty());
        storage.snapshot().validate()?;

        Ok(())
    }
}
