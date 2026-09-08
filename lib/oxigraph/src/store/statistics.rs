//! Bounded physical-dataset statistics on the shared generation lifecycle.
use super::backup::check;
use super::{
    BackupCheckpoint, ContributorIdentity, DerivedDelta, DerivedFiles, DerivedGenerationError,
    DerivedLimits, DerivedProvider, DerivedSnapshot, DerivedView, DerivedWriter, SemanticChange,
    StorageError,
};
use crate::model::{GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::num::{NonZeroU32, NonZeroUsize};
use std::time::Instant;

const FILE: &str = "statistics.v1";
const WIDTH: usize = 256;
const DEPTH: usize = 4;
const HEAVY: usize = 32;
const CELLS: usize = WIDTH * DEPTH;
const SCOPE_BYTES: usize = 2 * CELLS * 8 + 128;
const TERM_NODE: &str = "urn:oxigraph:statistics:term-codec:v1";

/// Logical retained-state ceilings; native records, output buffers and allocator
/// overhead can coexist and are not an RSS quota.
#[derive(Clone, Debug)]
#[expect(clippy::struct_field_names, reason = "explicit ceiling names")]
pub struct StatisticsLimits {
    pub max_graphs: NonZeroUsize,
    pub max_scopes: NonZeroUsize,
    pub max_record_bytes: NonZeroUsize,
    pub max_index_bytes: NonZeroUsize,
}
impl Default for StatisticsLimits {
    fn default() -> Self {
        Self {
            max_graphs: NonZeroUsize::new(1024).unwrap_or(NonZeroUsize::MIN),
            max_scopes: NonZeroUsize::new(1024).unwrap_or(NonZeroUsize::MIN),
            max_record_bytes: NonZeroUsize::new(1024 * 1024).unwrap_or(NonZeroUsize::MIN),
            max_index_bytes: NonZeroUsize::new(64 * 1024 * 1024).unwrap_or(NonZeroUsize::MIN),
        }
    }
}
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum StatisticsError {
    #[error(transparent)]
    Generation(#[from] DerivedGenerationError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error("statistics logical resource ceiling exceeded")]
    Limit,
    #[error("statistics profile or canonical payload mismatch")]
    Profile,
    #[error("statistics do not reproduce the retained primary snapshot")]
    NotEquivalent,
}
fn provider_error(error: StatisticsError) -> DerivedGenerationError {
    match error {
        StatisticsError::Generation(error) => error,
        StatisticsError::Limit => DerivedGenerationError::Limit,
        other => DerivedGenerationError::Reconciliation(other.to_string()),
    }
}
fn controlled(limits: &DerivedLimits, started: Instant) -> Result<(), StatisticsError> {
    check(&limits.control, started).map_err(DerivedGenerationError::from)?;
    Ok(())
}

/// Deterministic frequency bounds, not a confidence interval or point estimate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrequencyBounds {
    pub lower: u64,
    pub upper: u64,
}
impl FrequencyBounds {
    pub const fn is_exact(self) -> bool {
        self.lower == self.upper
    }
}
/// A retained heavy-hitter candidate, not a certified exact top-K ranking.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FrequentValue {
    pub value: Term,
    pub frequency: FrequencyBounds,
}

#[derive(Clone, Eq, PartialEq)]
struct Sketch {
    cells: Vec<u64>,
}
impl Sketch {
    fn new() -> Self {
        Self {
            cells: vec![0; CELLS],
        }
    }
    fn positions(bytes: &[u8], position: u8) -> [usize; DEPTH] {
        std::array::from_fn(|row| {
            let mut hash = Sha256::new();
            hash.update(b"oxigraph.statistics.cms.v1\0");
            hash.update([position, u8::try_from(row).unwrap_or(0)]);
            hash.update(bytes);
            row * WIDTH + usize::from(hash.finalize()[0])
        })
    }
    fn insert(&mut self, bytes: &[u8], position: u8) -> Result<(), StatisticsError> {
        for i in Self::positions(bytes, position) {
            self.cells[i] = self.cells[i].checked_add(1).ok_or(StatisticsError::Limit)?;
        }
        Ok(())
    }
    fn upper(&self, bytes: &[u8], position: u8) -> u64 {
        Self::positions(bytes, position)
            .into_iter()
            .map(|i| self.cells[i])
            .min()
            .unwrap_or(0)
    }
}

/// One physical graph/predicate scope. Marginal bounds cannot by themselves
/// determine subject/object conjunctions or joined-result cardinality.
#[derive(Clone, Eq, PartialEq)]
pub struct GraphPredicateStatistics {
    graph: GraphName,
    predicate: NamedNode,
    count: u64,
    subjects: Sketch,
    objects: Sketch,
    heavy: BTreeMap<Vec<u8>, u64>,
    decrements: u64,
    max_record_bytes: usize,
}
impl GraphPredicateStatistics {
    pub const fn graph(&self) -> &GraphName {
        &self.graph
    }
    pub const fn predicate(&self) -> &NamedNode {
        &self.predicate
    }
    pub const fn count(&self) -> u64 {
        self.count
    }
    pub fn subject_frequency(
        &self,
        subject: &NamedOrBlankNode,
    ) -> Result<FrequencyBounds, StatisticsError> {
        let key = term_key(&Term::from(subject.clone()), self.max_record_bytes)?;
        Ok(FrequencyBounds {
            lower: 0,
            upper: self.subjects.upper(&key, 0).min(self.count),
        })
    }
    pub fn object_frequency(&self, object: &Term) -> Result<FrequencyBounds, StatisticsError> {
        let key = term_key(object, self.max_record_bytes)?;
        let lower = self.heavy.get(&key).copied().unwrap_or(0);
        Ok(FrequencyBounds {
            lower,
            upper: self
                .objects
                .upper(&key, 1)
                .min(self.count)
                .min(lower.saturating_add(self.decrements)),
        })
    }
    /// At most 32 candidates, ordered by descending lower count then canonical
    /// term bytes. This explicitly returns RDF values; do not export as telemetry.
    pub fn frequent_objects(&self) -> Result<Vec<FrequentValue>, StatisticsError> {
        let mut entries: Vec<_> = self.heavy.iter().collect();
        entries.sort_unstable_by(|(a, ac), (b, bc)| bc.cmp(ac).then_with(|| a.cmp(b)));
        entries
            .into_iter()
            .map(|(key, lower)| {
                Ok(FrequentValue {
                    value: term_from_key(key)?,
                    frequency: FrequencyBounds {
                        lower: *lower,
                        upper: self
                            .objects
                            .upper(key, 1)
                            .min(self.count)
                            .min(lower.saturating_add(self.decrements)),
                    },
                })
            })
            .collect()
    }
}

#[derive(Clone, Eq, PartialEq)]
struct Data {
    graphs: BTreeMap<Vec<u8>, GraphName>,
    scopes: BTreeMap<(Vec<u8>, String), GraphPredicateStatistics>,
    bytes: usize,
}
impl Data {
    fn charge(&mut self, bytes: usize, limits: &StatisticsLimits) -> Result<(), StatisticsError> {
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .filter(|n| *n <= limits.max_index_bytes.get())
            .ok_or(StatisticsError::Limit)?;
        Ok(())
    }
    fn graph(
        &mut self,
        graph: &GraphName,
        limits: &StatisticsLimits,
    ) -> Result<Vec<u8>, StatisticsError> {
        let key = graph_key(graph, limits.max_record_bytes.get())?;
        if !self.graphs.contains_key(&key) {
            if self.graphs.len() >= limits.max_graphs.get() {
                return Err(StatisticsError::Limit);
            }
            self.charge(
                key.len()
                    .checked_mul(2)
                    .and_then(|n| n.checked_add(64))
                    .ok_or(StatisticsError::Limit)?,
                limits,
            )?;
            self.graphs.insert(key.clone(), graph.clone());
        }
        Ok(key)
    }
    fn insert(&mut self, quad: &Quad, limits: &StatisticsLimits) -> Result<(), StatisticsError> {
        let graph = self.graph(&quad.graph_name, limits)?;
        if quad.predicate.as_str().len() > limits.max_record_bytes.get() {
            return Err(StatisticsError::Limit);
        }
        let key = (graph, quad.predicate.as_str().to_owned());
        if !self.scopes.contains_key(&key) {
            if self.scopes.len() >= limits.max_scopes.get() {
                return Err(StatisticsError::Limit);
            }
            self.charge(scope_bytes(&key)?, limits)?;
            self.scopes.insert(
                key.clone(),
                GraphPredicateStatistics {
                    graph: quad.graph_name.clone(),
                    predicate: quad.predicate.clone(),
                    count: 0,
                    subjects: Sketch::new(),
                    objects: Sketch::new(),
                    heavy: BTreeMap::new(),
                    decrements: 0,
                    max_record_bytes: limits.max_record_bytes.get(),
                },
            );
        }
        let subject = term_key(
            &Term::from(quad.subject.clone()),
            limits.max_record_bytes.get(),
        )?;
        let object = term_key(&quad.object, limits.max_record_bytes.get())?;
        let group = self.scopes.get_mut(&key).ok_or(StatisticsError::Profile)?;
        group.count = group.count.checked_add(1).ok_or(StatisticsError::Limit)?;
        group.subjects.insert(&subject, 0)?;
        group.objects.insert(&object, 1)?;
        if let Some(count) = group.heavy.get_mut(&object) {
            *count = count.checked_add(1).ok_or(StatisticsError::Limit)?;
        } else if group.heavy.len() < HEAVY {
            let charge = object.len().checked_add(72).ok_or(StatisticsError::Limit)?;
            self.charge(charge, limits)?;
            self.scopes
                .get_mut(&key)
                .ok_or(StatisticsError::Profile)?
                .heavy
                .insert(object, 1);
        } else {
            group.decrements = group
                .decrements
                .checked_add(1)
                .ok_or(StatisticsError::Limit)?;
            let mut invalid_charge = false;
            group.heavy.retain(|key, count| {
                *count -= 1;
                if *count == 0 {
                    if let Some(bytes) = key
                        .len()
                        .checked_add(72)
                        .and_then(|n| self.bytes.checked_sub(n))
                    {
                        self.bytes = bytes;
                    } else {
                        invalid_charge = true;
                    }
                    false
                } else {
                    true
                }
            });
            if invalid_charge {
                return Err(StatisticsError::Limit);
            }
        }
        Ok(())
    }
}
fn scope_bytes(key: &(Vec<u8>, String)) -> Result<usize, StatisticsError> {
    key.0
        .len()
        .checked_add(key.1.len())
        .and_then(|n| n.checked_mul(2))
        .and_then(|n| n.checked_add(SCOPE_BYTES))
        .ok_or(StatisticsError::Limit)
}

/// Owned observations for exactly the admitted physical primary snapshot.
/// Not SPARQL FROM/union statistics: physical sums count each graph occurrence.
/// No automatic telemetry or optimizer influence is introduced by this API.
pub struct StatisticsSnapshot {
    data: Data,
    source: BackupCheckpoint,
    generation: [u8; 32],
    origin: std::sync::Arc<()>,
    max_record_bytes: usize,
}
impl StatisticsSnapshot {
    pub(crate) fn matches_source(&self, source: &DerivedSnapshot) -> bool {
        std::sync::Arc::ptr_eq(&self.origin, source.statistics_origin())
            && self.source() == source.checkpoint()
    }
    pub const fn source(&self) -> &BackupCheckpoint {
        &self.source
    }
    pub const fn generation(&self) -> &[u8; 32] {
        &self.generation
    }
    pub fn graphs(&self) -> impl Iterator<Item = &GraphName> {
        self.data.graphs.values()
    }
    pub fn scopes(&self) -> impl Iterator<Item = &GraphPredicateStatistics> {
        self.data.scopes.values()
    }
    pub fn scope(
        &self,
        graph: &GraphName,
        predicate: &NamedNode,
    ) -> Option<&GraphPredicateStatistics> {
        // Use the already-verified canonical index instead of scanning all
        // scopes on each estimator lookup. Reject oversized query keys before
        // cloning/encoding them; no admitted scope can contain such a key.
        let graph_length = match graph {
            GraphName::DefaultGraph => 0,
            GraphName::NamedNode(node) => node.as_str().len(),
            GraphName::BlankNode(node) => node.as_str().len(),
        };
        if graph_length > self.max_record_bytes || predicate.as_str().len() > self.max_record_bytes
        {
            return None;
        }
        self.data.scopes.get(&(
            graph_key(graph, self.max_record_bytes).ok()?,
            predicate.as_str().to_owned(),
        ))
    }
    /// Exact quad occurrences, not distinct merged RDF triples. None selects all
    /// physical graphs/predicates, including the default graph.
    pub fn count_quads(&self, graph: Option<&GraphName>, predicate: Option<&NamedNode>) -> u64 {
        if let (Some(graph), Some(predicate)) = (graph, predicate) {
            return self.scope(graph, predicate).map_or(0, |scope| scope.count);
        }
        self.scopes()
            .filter(|scope| {
                graph.is_none_or(|g| g == &scope.graph)
                    && predicate.is_none_or(|p| p == &scope.predicate)
            })
            .map(|scope| scope.count)
            .sum()
    }
}

#[derive(Clone, Debug, Default)]
pub struct StatisticsProvider {
    pub limits: StatisticsLimits,
}
impl StatisticsProvider {
    pub fn profile() -> String {
        format!(
            "oxigraph.statistics.physical.v1;cms=sha256-4x256-u64;mg=32;codec=1;rdf12={}",
            cfg!(feature = "rdf-12")
        )
    }
    fn scan(
        &self,
        source: &DerivedSnapshot,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Data, StatisticsError> {
        let mut data = Data {
            graphs: BTreeMap::new(),
            scopes: BTreeMap::new(),
            bytes: 128,
        };
        data.graph(&GraphName::DefaultGraph, &self.limits)?;
        let mut failure = None;
        let result = source.scan(limits, |change| {
            let apply = (|| {
                controlled(limits, started)?;
                match change {
                    SemanticChange::NamedGraphCreated(graph) => {
                        data.graph(&GraphName::from(graph.clone()), &self.limits)?;
                    }
                    SemanticChange::QuadAdded(quad) => data.insert(quad, &self.limits)?,
                    _ => (),
                }
                Ok::<_, StatisticsError>(())
            })();
            if let Err(error) = apply {
                failure = Some(error);
                return Err(StorageError::Other("statistics scan failed".into()));
            }
            Ok(())
        });
        if let Some(error) = failure {
            return Err(error);
        }
        result.map_err(DerivedGenerationError::from)?;
        controlled(limits, started)?;
        Ok(data)
    }
    /// Requires a strictly admitted view. Missing/stale/corrupt statistics are
    /// errors here; an optimizer adapter must choose its heuristic fallback.
    pub fn read(
        &self,
        view: &DerivedView<'_>,
        limits: &DerivedLimits,
    ) -> Result<StatisticsSnapshot, StatisticsError> {
        let started = Instant::now();
        controlled(limits, started)?;
        if view.is_eventual() {
            return Err(DerivedGenerationError::NotFresh.into());
        }
        if view.generation().identity() != self.identity() {
            return Err(StatisticsError::Profile);
        }
        let data = self.open(view.generation().files(), limits, started)?;
        if data != self.scan(view.source(), limits, started)? {
            return Err(StatisticsError::NotEquivalent);
        }
        controlled(limits, started)?;
        Ok(StatisticsSnapshot {
            data,
            source: view.source().checkpoint().clone(),
            generation: view.generation().fingerprint(),
            origin: std::sync::Arc::clone(view.source().statistics_origin()),
            max_record_bytes: self.limits.max_record_bytes.get(),
        })
    }
    fn write(
        &self,
        data: &Data,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<(), StatisticsError> {
        let mut bytes = Vec::new();
        self.blob(&mut bytes, Self::profile().as_bytes())?;
        put(&mut bytes, data.graphs.len() as u64);
        for key in data.graphs.keys() {
            controlled(limits, started)?;
            self.blob(&mut bytes, key)?;
        }
        put(&mut bytes, data.scopes.len() as u64);
        for ((graph, predicate), scope) in &data.scopes {
            controlled(limits, started)?;
            self.blob(&mut bytes, graph)?;
            self.blob(&mut bytes, predicate.as_bytes())?;
            put(&mut bytes, scope.count);
            for sketch in [&scope.subjects, &scope.objects] {
                for value in &sketch.cells {
                    put(&mut bytes, *value);
                }
            }
            put(&mut bytes, scope.decrements);
            put(&mut bytes, scope.heavy.len() as u64);
            for (key, count) in &scope.heavy {
                controlled(limits, started)?;
                self.blob(&mut bytes, key)?;
                put(&mut bytes, *count);
            }
            if bytes.len() > self.limits.max_index_bytes.get() {
                return Err(StatisticsError::Limit);
            }
        }
        controlled(limits, started)?;
        output.write_file(FILE, bytes.as_slice())?;
        Ok(())
    }
    fn blob(&self, bytes: &mut Vec<u8>, value: &[u8]) -> Result<(), StatisticsError> {
        if value.len() > self.limits.max_record_bytes.get()
            || bytes
                .len()
                .checked_add(value.len())
                .and_then(|n| n.checked_add(8))
                .is_none_or(|n| n > self.limits.max_index_bytes.get())
        {
            return Err(StatisticsError::Limit);
        }
        put(bytes, value.len() as u64);
        bytes.extend_from_slice(value);
        Ok(())
    }
    fn open(
        &self,
        files: &DerivedFiles,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Data, StatisticsError> {
        if files.names().collect::<Vec<_>>() != [FILE] {
            return Err(StatisticsError::Profile);
        }
        let bytes =
            files.read_verified(FILE, self.limits.max_index_bytes.get(), limits, started)?;
        let mut decoder = Decoder {
            bytes: &bytes,
            record_limit: self.limits.max_record_bytes.get(),
        };
        if decoder.blob()? != Self::profile().as_bytes() {
            return Err(StatisticsError::Profile);
        }
        let mut data = Data {
            graphs: BTreeMap::new(),
            scopes: BTreeMap::new(),
            bytes: 128,
        };
        let count = decoder.count(self.limits.max_graphs.get())?;
        for _ in 0..count {
            controlled(limits, started)?;
            let key = decoder.blob()?;
            let SemanticChange::GraphCleared(graph) = super::change_codec::decode(key)? else {
                return Err(StatisticsError::Profile);
            };
            if data
                .graphs
                .last_key_value()
                .is_some_and(|(previous, _)| previous.as_slice() >= key)
                || graph_key(&graph, self.limits.max_record_bytes.get())? != key
            {
                return Err(StatisticsError::Profile);
            }
            data.graph(&graph, &self.limits)?;
        }
        if !data.graphs.values().any(|g| *g == GraphName::DefaultGraph) {
            return Err(StatisticsError::Profile);
        }
        let count = decoder.count(self.limits.max_scopes.get())?;
        let mut total = 0_u64;
        for _ in 0..count {
            controlled(limits, started)?;
            let graph = decoder.blob()?;
            let predicate =
                std::str::from_utf8(decoder.blob()?).map_err(|_| StatisticsError::Profile)?;
            let key = (graph.to_vec(), predicate.to_owned());
            if data
                .scopes
                .last_key_value()
                .is_some_and(|(previous, _)| previous >= &key)
            {
                return Err(StatisticsError::Profile);
            }
            data.charge(scope_bytes(&key)?, &self.limits)?;
            let mut scope = GraphPredicateStatistics {
                graph: data
                    .graphs
                    .get(graph)
                    .ok_or(StatisticsError::Profile)?
                    .clone(),
                predicate: NamedNode::new(predicate.to_owned())
                    .map_err(|_| StatisticsError::Profile)?,
                count: decoder.number()?,
                subjects: Sketch::new(),
                objects: Sketch::new(),
                heavy: BTreeMap::new(),
                decrements: 0,
                max_record_bytes: self.limits.max_record_bytes.get(),
            };
            if scope.count == 0 {
                return Err(StatisticsError::Profile);
            }
            total = total
                .checked_add(scope.count)
                .ok_or(StatisticsError::Profile)?;
            for sketch in [&mut scope.subjects, &mut scope.objects] {
                for row in sketch.cells.chunks_exact_mut(WIDTH) {
                    let mut sum = 0_u64;
                    for value in row {
                        *value = decoder.number()?;
                        sum = sum.checked_add(*value).ok_or(StatisticsError::Profile)?;
                    }
                    if sum != scope.count {
                        return Err(StatisticsError::Profile);
                    }
                }
            }
            scope.decrements = decoder.number()?;
            let count = decoder.count(HEAVY)?;
            let mut mass = scope
                .decrements
                .checked_mul((HEAVY + 1) as u64)
                .ok_or(StatisticsError::Profile)?;
            for _ in 0..count {
                controlled(limits, started)?;
                let key = decoder.blob()?;
                let value = term_from_key(key)?;
                if term_key(&value, self.limits.max_record_bytes.get())? != key
                    || scope
                        .heavy
                        .last_key_value()
                        .is_some_and(|(previous, _)| previous.as_slice() >= key)
                {
                    return Err(StatisticsError::Profile);
                }
                let count = decoder.number()?;
                if count == 0 {
                    return Err(StatisticsError::Profile);
                }
                mass = mass.checked_add(count).ok_or(StatisticsError::Profile)?;
                data.charge(
                    key.len().checked_add(72).ok_or(StatisticsError::Limit)?,
                    &self.limits,
                )?;
                scope.heavy.insert(key.to_vec(), count);
            }
            if mass != scope.count {
                return Err(StatisticsError::Profile);
            }
            data.scopes.insert(key, scope);
        }
        if !decoder.bytes.is_empty() {
            return Err(StatisticsError::Profile);
        }
        controlled(limits, started)?;
        Ok(data)
    }
}
impl DerivedProvider for StatisticsProvider {
    fn identity(&self) -> ContributorIdentity {
        let hash = Sha256::digest(Self::profile());
        let mut id = [0; 16];
        id.copy_from_slice(&hash[..16]);
        ContributorIdentity::new(id, NonZeroU32::MIN)
    }
    fn rebuild(
        &self,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        let data = self.scan(source, limits, started).map_err(provider_error)?;
        self.write(&data, output, limits, started)
            .map_err(provider_error)
    }
    fn apply(
        &self,
        previous: &DerivedFiles,
        _delta: &DerivedDelta,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        // Core validates the complete retained delta before invoking this hook.
        // Recompute also handles deletes and ungoverned changes without pretending
        // an insertion-only heavy-hitter sketch is safely decrementable.
        let started = Instant::now();
        self.open(previous, limits, started)
            .map_err(provider_error)?;
        let data = self.scan(source, limits, started).map_err(provider_error)?;
        self.write(&data, output, limits, started)
            .map_err(provider_error)
    }
    fn reconcile(
        &self,
        source: &DerivedSnapshot,
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        let actual = self.open(files, limits, started).map_err(provider_error)?;
        if actual != self.scan(source, limits, started).map_err(provider_error)? {
            return Err(provider_error(StatisticsError::NotEquivalent));
        }
        Ok(())
    }
}
fn encoded(change: &SemanticChange, max: usize) -> Result<Vec<u8>, StatisticsError> {
    let mut size = Some(0_usize);
    super::change_codec::emit(change, &mut |bytes| {
        size = size.and_then(|n| n.checked_add(bytes.len()))
    });
    if size.is_none_or(|n| n > max) {
        return Err(StatisticsError::Limit);
    }
    Ok(super::change_codec::encode(change)?)
}
fn graph_key(graph: &GraphName, max: usize) -> Result<Vec<u8>, StatisticsError> {
    encoded(&SemanticChange::GraphCleared(graph.clone()), max)
}
fn term_key(value: &Term, max: usize) -> Result<Vec<u8>, StatisticsError> {
    encoded(
        &SemanticChange::QuadAdded(Quad::new(
            NamedNode::new_unchecked(TERM_NODE),
            NamedNode::new_unchecked(TERM_NODE),
            value.clone(),
            GraphName::DefaultGraph,
        )),
        max,
    )
}
fn term_from_key(key: &[u8]) -> Result<Term, StatisticsError> {
    let SemanticChange::QuadAdded(quad) = super::change_codec::decode(key)? else {
        return Err(StatisticsError::Profile);
    };
    if quad.subject != NamedNode::new_unchecked(TERM_NODE)
        || quad.predicate.as_str() != TERM_NODE
        || quad.graph_name != GraphName::DefaultGraph
    {
        return Err(StatisticsError::Profile);
    }
    Ok(quad.object)
}
fn put(bytes: &mut Vec<u8>, value: u64) {
    bytes.extend_from_slice(&value.to_be_bytes());
}
struct Decoder<'a> {
    bytes: &'a [u8],
    record_limit: usize,
}
impl<'a> Decoder<'a> {
    fn number(&mut self) -> Result<u64, StatisticsError> {
        let (head, tail) = self
            .bytes
            .split_at_checked(8)
            .ok_or(StatisticsError::Profile)?;
        self.bytes = tail;
        Ok(u64::from_be_bytes(
            head.try_into().map_err(|_| StatisticsError::Profile)?,
        ))
    }
    fn count(&mut self, max: usize) -> Result<usize, StatisticsError> {
        let count = usize::try_from(self.number()?).map_err(|_| StatisticsError::Limit)?;
        if count > max {
            return Err(StatisticsError::Limit);
        }
        Ok(count)
    }
    fn blob(&mut self) -> Result<&'a [u8], StatisticsError> {
        let length = self.count(self.record_limit)?;
        let (head, tail) = self
            .bytes
            .split_at_checked(length)
            .ok_or(StatisticsError::Profile)?;
        self.bytes = tail;
        Ok(head)
    }
}
