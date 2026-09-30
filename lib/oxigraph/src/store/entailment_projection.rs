//! Bounded finite-RDFS projection provider on the ADR-0024 derived-index lifecycle (ADR-0032 P1).
//!
//! Full-closure maintenance only: every build rescans or replays into an in-memory model and
//! recomputes the exact `Rdfs12Finite` closure through [`QueryEntailmentDataset`], the same
//! full-closure oracle used by query-time entailment. Primary quads, graphs and namespaces are
//! never written. Namespaces are not part of the image because they cannot affect entailment.
//! There is no query overlay, incremental algorithm or Strict-by-cursor claim.
//!
//! Bounds are logical. Record counts and encoded payload bytes are checked before each record is
//! retained, and the closure runs under the opt-in materialization admission ceilings. One
//! decoded or encoded record may already exist when it is refused. The model, the closure
//! snapshot and the encoded records coexist; storage buffers, allocator overhead and process RSS
//! are neither measured nor bounded.
//!
//! Deadlines are per provider call. `rebuild`, `apply` and `reconcile` each start one clock at
//! entry and share it across their phases, but the lifecycle invokes them separately (build,
//! build-time reconcile, activation reconcile), and `DerivedSnapshot::scan` and the generation
//! writer run their own clocks. A `DerivedLimits` control deadline is therefore not a global build
//! deadline. [`EntailmentProjectionLimits::timeout`] applies to each closure invocation.
use super::backup::check;
use super::{
    BackupError, CommitId, ContributorIdentity, DerivedDelta, DerivedError, DerivedFiles,
    DerivedGenerationError, DerivedLimits, DerivedProvider, DerivedSnapshot, DerivedWriter,
    GraphNameIter, QuadIter, SemanticChange, StorageError, Store, StoreIdentity, Transaction,
    WritableDataset,
};
use crate::model::{GraphName, NamedOrBlankNode, Quad};
use crate::sparql::{
    CancellationToken, QueryEntailment, QueryEntailmentDataset, QueryEntailmentError,
    QueryEntailmentOptions, QueryEvaluationError,
};
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::Read;
use std::num::{NonZeroU32, NonZeroU64, NonZeroUsize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const PROFILE: QueryEntailment = QueryEntailment::Rdfs12Finite;
const FILE_META: &str = "meta";
const FILE_IMAGE: &str = "image";
const FILE_INFERRED: &str = "inferred";
const META_MAGIC: &[u8] = b"oxigraph.entrdfs.meta.v2\0";
const MAX_META: u64 = 8 * 1024;
/// Encoded-payload ceiling per section, including 4-byte frame headers. The provider receives
/// only [`DerivedLimits`], not `DerivedGenerationLimits::max_bytes`, so a smaller writer ceiling
/// still fails in the writer after the section has been encoded in memory.
const MAX_PAYLOAD: u64 = 256 * 1024 * 1024;
const WATCH_INTERVAL: Duration = Duration::from_millis(2);

/// Provider identity: provider bytes `oxigraph.entrdfs` (exactly 16), schema 1.
pub const fn entailment_projection_identity() -> ContributorIdentity {
    ContributorIdentity::new(*b"oxigraph.entrdfs", NonZeroU32::MIN)
}

/// Logical projection bounds. None of them is an RSS guarantee.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntailmentProjectionLimits {
    /// Primary image records: quads plus named-graph declarations.
    pub max_source_quads: NonZeroU64,
    /// Entailed-only records: inferred quads plus inferred named-graph declarations.
    pub max_inferred_quads: NonZeroU64,
    /// Forwarded to [`QueryEntailmentOptions::with_max_estimated_materialization_bytes`]: a
    /// deterministic logical estimate charged per materialization stage, not process memory.
    pub max_estimated_bytes: NonZeroU64,
    /// Cooperative closure timeout per closure invocation, stored with nanosecond precision.
    pub timeout: Duration,
}

impl Default for EntailmentProjectionLimits {
    fn default() -> Self {
        Self {
            max_source_quads: NonZeroU64::new(1_000_000).unwrap_or(NonZeroU64::MIN),
            max_inferred_quads: NonZeroU64::new(4_000_000).unwrap_or(NonZeroU64::MIN),
            max_estimated_bytes: NonZeroU64::new(1024 * 1024 * 1024).unwrap_or(NonZeroU64::MIN),
            timeout: Duration::from_secs(60),
        }
    }
}

impl EntailmentProjectionLimits {
    /// Materialized-quad admission ceiling: source plus inferred records. Every closure stage
    /// (snapshot, source, working, engine facts, visible) must fit it.
    fn materialized_quads(&self) -> NonZeroUsize {
        ceiling(
            self.max_source_quads
                .get()
                .saturating_add(self.max_inferred_quads.get()),
        )
    }

    fn materialized_bytes(&self) -> NonZeroUsize {
        ceiling(self.max_estimated_bytes.get())
    }
}

fn ceiling(value: u64) -> NonZeroUsize {
    NonZeroUsize::new(usize::try_from(value).unwrap_or(usize::MAX)).unwrap_or(NonZeroUsize::MIN)
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn storage(error: StorageError) -> DerivedGenerationError {
    DerivedError::Storage(error).into()
}

/// Input ceilings and control failures keep the same typed errors as the provider's own.
fn input(error: DerivedError) -> DerivedGenerationError {
    match error {
        DerivedError::Limit => DerivedGenerationError::Limit,
        DerivedError::Backup(error) => error.into(),
        other => other.into(),
    }
}

fn stale() -> DerivedGenerationError {
    DerivedGenerationError::Reconciliation("inferred facts are stale; recompute first".into())
}

/// Only effects outside outbox v1 (over 32 nested triple terms) fail to encode.
fn encode(change: &SemanticChange) -> Result<Vec<u8>, DerivedGenerationError> {
    super::change_codec::encode(change).map_err(|_| DerivedGenerationError::Limit)
}

fn decode(record: &[u8]) -> Result<SemanticChange, DerivedGenerationError> {
    super::change_codec::decode(record).map_err(|_| DerivedGenerationError::Corrupt)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Section {
    records: u64,
    bytes: u64,
    sha256: [u8; 32],
}

/// Canonical length-prefixed records together with their section binding.
struct Framed {
    bytes: Vec<u8>,
    section: Section,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Meta {
    identity: Option<[u8; 16]>,
    last: Option<(u64, [u8; 32])>,
    limits: EntailmentProjectionLimits,
    image: Section,
    inferred: Section,
}

fn put_str(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend_from_slice(&u32::try_from(value.len()).unwrap_or(u32::MAX).to_be_bytes());
    bytes.extend_from_slice(value.as_bytes());
}

fn nonzero(value: u64) -> Result<NonZeroU64, DerivedGenerationError> {
    NonZeroU64::new(value).ok_or(DerivedGenerationError::Corrupt)
}

struct Input<'a>(&'a [u8]);
impl<'a> Input<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], DerivedGenerationError> {
        if count > self.0.len() {
            return Err(DerivedGenerationError::Corrupt);
        }
        let (value, rest) = self.0.split_at(count);
        self.0 = rest;
        Ok(value)
    }
    fn array<const N: usize>(&mut self) -> Result<[u8; N], DerivedGenerationError> {
        self.take(N)?
            .try_into()
            .map_err(|_| DerivedGenerationError::Corrupt)
    }
    fn flag(&mut self) -> Result<bool, DerivedGenerationError> {
        match self.array::<1>()? {
            [0] => Ok(false),
            [1] => Ok(true),
            _ => Err(DerivedGenerationError::Corrupt),
        }
    }
    fn u32(&mut self) -> Result<u32, DerivedGenerationError> {
        Ok(u32::from_be_bytes(self.array()?))
    }
    fn u64(&mut self) -> Result<u64, DerivedGenerationError> {
        Ok(u64::from_be_bytes(self.array()?))
    }
    fn string(&mut self) -> Result<&'a str, DerivedGenerationError> {
        let count = usize::try_from(self.u32()?).map_err(|_| DerivedGenerationError::Corrupt)?;
        if count > 1024 {
            return Err(DerivedGenerationError::Corrupt);
        }
        std::str::from_utf8(self.take(count)?).map_err(|_| DerivedGenerationError::Corrupt)
    }
    fn section(&mut self) -> Result<Section, DerivedGenerationError> {
        Ok(Section {
            records: self.u64()?,
            bytes: self.u64()?,
            sha256: self.array()?,
        })
    }
}

impl Meta {
    fn encode(&self) -> Vec<u8> {
        let mut bytes = META_MAGIC.to_vec();
        bytes.extend_from_slice(&NonZeroU32::MIN.get().to_be_bytes());
        put_str(&mut bytes, PROFILE.profile_iri().unwrap_or_default());
        put_str(
            &mut bytes,
            PROFILE.datatype_policy_iri().unwrap_or_default(),
        );
        for value in [
            self.limits.max_source_quads.get(),
            self.limits.max_inferred_quads.get(),
            self.limits.max_estimated_bytes.get(),
            self.limits.timeout.as_secs(),
        ] {
            bytes.extend_from_slice(&value.to_be_bytes());
        }
        bytes.extend_from_slice(&self.limits.timeout.subsec_nanos().to_be_bytes());
        match &self.identity {
            Some(identity) => {
                bytes.push(1);
                bytes.extend_from_slice(identity);
            }
            None => bytes.push(0),
        }
        match &self.last {
            Some((sequence, id)) => {
                bytes.push(1);
                bytes.extend_from_slice(&sequence.to_be_bytes());
                bytes.extend_from_slice(id);
            }
            None => bytes.push(0),
        }
        for section in [&self.image, &self.inferred] {
            bytes.extend_from_slice(&section.records.to_be_bytes());
            bytes.extend_from_slice(&section.bytes.to_be_bytes());
            bytes.extend_from_slice(&section.sha256);
        }
        let sum = sha256(&bytes);
        bytes.extend_from_slice(&sum);
        bytes
    }

    fn decode(bytes: &[u8]) -> Result<Self, DerivedGenerationError> {
        let split = bytes
            .len()
            .checked_sub(32)
            .ok_or(DerivedGenerationError::Corrupt)?;
        let (body, sum) = bytes.split_at(split);
        if sha256(body).as_slice() != sum {
            return Err(DerivedGenerationError::Corrupt);
        }
        let mut input = Input(
            body.strip_prefix(META_MAGIC)
                .ok_or(DerivedGenerationError::Corrupt)?,
        );
        if input.u32()? != NonZeroU32::MIN.get() {
            return Err(DerivedGenerationError::Identity);
        }
        let profile = input.string()?;
        let datatype = input.string()?;
        if profile != PROFILE.profile_iri().unwrap_or_default()
            || datatype != PROFILE.datatype_policy_iri().unwrap_or_default()
        {
            return Err(DerivedGenerationError::Identity);
        }
        let max_source_quads = nonzero(input.u64()?)?;
        let max_inferred_quads = nonzero(input.u64()?)?;
        let max_estimated_bytes = nonzero(input.u64()?)?;
        let seconds = input.u64()?;
        let nanos = input.u32()?;
        if nanos >= 1_000_000_000 {
            return Err(DerivedGenerationError::Corrupt);
        }
        let limits = EntailmentProjectionLimits {
            max_source_quads,
            max_inferred_quads,
            max_estimated_bytes,
            timeout: Duration::new(seconds, nanos),
        };
        let identity = if input.flag()? {
            Some(input.array()?)
        } else {
            None
        };
        let last = if input.flag()? {
            Some((input.u64()?, input.array()?))
        } else {
            None
        };
        let image = input.section()?;
        let inferred = input.section()?;
        if !input.0.is_empty() {
            return Err(DerivedGenerationError::Corrupt);
        }
        let meta = Self {
            identity,
            last,
            limits,
            image,
            inferred,
        };
        if meta.encode() != bytes {
            return Err(DerivedGenerationError::Corrupt);
        }
        Ok(meta)
    }
}

/// Lazily splits length-prefixed records and requires strictly ascending bytes (canonical, no
/// duplicates). Iteration stops after the first error.
struct Frames<'a> {
    rest: &'a [u8],
    previous: Option<&'a [u8]>,
}

impl<'a> Frames<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self {
            rest: bytes,
            previous: None,
        }
    }

    fn step(&mut self) -> Result<&'a [u8], DerivedGenerationError> {
        let (length, tail) = self
            .rest
            .split_at_checked(4)
            .ok_or(DerivedGenerationError::Corrupt)?;
        let length = u32::from_be_bytes(
            length
                .try_into()
                .map_err(|_| DerivedGenerationError::Corrupt)?,
        );
        let length = usize::try_from(length).map_err(|_| DerivedGenerationError::Corrupt)?;
        let (record, rest) = tail
            .split_at_checked(length)
            .ok_or(DerivedGenerationError::Corrupt)?;
        if self.previous.is_some_and(|previous| previous >= record) {
            return Err(DerivedGenerationError::Corrupt);
        }
        self.previous = Some(record);
        self.rest = rest;
        Ok(record)
    }
}

impl<'a> Iterator for Frames<'a> {
    type Item = Result<&'a [u8], DerivedGenerationError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.rest.is_empty() {
            return None;
        }
        let result = self.step();
        if result.is_err() {
            self.rest = &[];
        }
        Some(result)
    }
}

/// Encoded records admitted one at a time: the record count and the framed byte total are both
/// checked before a record is retained. Only the refused record has already been encoded.
struct Records {
    items: Vec<Vec<u8>>,
    bytes: u64,
    max: u64,
}

impl Records {
    const fn new(max: u64) -> Self {
        Self {
            items: Vec::new(),
            bytes: 0,
            max,
        }
    }

    fn push(&mut self, change: &SemanticChange) -> Result<(), DerivedGenerationError> {
        if u64::try_from(self.items.len()).map_or(true, |count| count >= self.max) {
            return Err(DerivedGenerationError::Limit);
        }
        let record = encode(change)?;
        let size = u64::try_from(record.len())
            .ok()
            .and_then(|length| length.checked_add(4))
            .ok_or(DerivedGenerationError::Limit)?;
        self.bytes = self
            .bytes
            .checked_add(size)
            .filter(|total| *total <= MAX_PAYLOAD)
            .ok_or(DerivedGenerationError::Limit)?;
        self.items.push(record);
        Ok(())
    }

    /// Sorts into canonical order and frames, releasing each record once it is copied.
    fn finish(
        mut self,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Framed, DerivedGenerationError> {
        check(&limits.control, started)?;
        self.items.sort_unstable();
        check(&limits.control, started)?;
        self.items.dedup();
        let records = u64::try_from(self.items.len()).map_err(|_| DerivedGenerationError::Limit)?;
        let mut bytes = Vec::with_capacity(usize::try_from(self.bytes).unwrap_or(0));
        for record in self.items {
            check(&limits.control, started)?;
            let length = u32::try_from(record.len()).map_err(|_| DerivedGenerationError::Limit)?;
            bytes.extend_from_slice(&length.to_be_bytes());
            bytes.extend_from_slice(&record);
        }
        let mut hash = Sha256::new();
        for chunk in bytes.chunks(64 * 1024) {
            check(&limits.control, started)?;
            hash.update(chunk);
        }
        check(&limits.control, started)?;
        let section = Section {
            records,
            bytes: u64::try_from(bytes.len()).map_err(|_| DerivedGenerationError::Limit)?,
            sha256: hash.finalize().into(),
        };
        Ok(Framed { bytes, section })
    }
}

fn verify(bytes: &[u8], section: &Section) -> Result<(), DerivedGenerationError> {
    if u64::try_from(bytes.len()).ok() != Some(section.bytes) || sha256(bytes) != section.sha256 {
        return Err(DerivedGenerationError::Corrupt);
    }
    Ok(())
}

fn read_all(
    files: &DerivedFiles,
    name: &str,
    max: u64,
    limits: &DerivedLimits,
    started: Instant,
) -> Result<Vec<u8>, DerivedGenerationError> {
    let mut reader = files.read(name)?;
    let mut bytes = Vec::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        check(&limits.control, started)?;
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let total = u64::try_from(bytes.len())
            .ok()
            .and_then(|size| size.checked_add(u64::try_from(count).ok()?))
            .ok_or(DerivedGenerationError::Limit)?;
        if total > max {
            return Err(DerivedGenerationError::Limit);
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    Ok(bytes)
}

/// Reads at most the declared section size; a longer file is corrupt, not a limit.
fn read_section(
    files: &DerivedFiles,
    name: &str,
    section: &Section,
    limits: &DerivedLimits,
    started: Instant,
) -> Result<Vec<u8>, DerivedGenerationError> {
    let bytes =
        read_all(files, name, section.bytes, limits, started).map_err(|error| match error {
            DerivedGenerationError::Limit => DerivedGenerationError::Corrupt,
            other => other,
        })?;
    verify(&bytes, section)?;
    Ok(bytes)
}

/// Streams a stored file against expected bytes without buffering the file.
fn same_file(
    files: &DerivedFiles,
    name: &str,
    expected: &[u8],
    limits: &DerivedLimits,
    started: Instant,
) -> Result<bool, DerivedGenerationError> {
    let mut reader = files.read(name)?;
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut offset = 0_usize;
    loop {
        check(&limits.control, started)?;
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            return Ok(offset == expected.len());
        }
        let Some(end) = offset.checked_add(count) else {
            return Ok(false);
        };
        if expected.get(offset..end) != buffer.get(..count) {
            return Ok(false);
        }
        offset = end;
    }
}

/// Every inferred record must be a quad addition or a named-graph declaration.
fn validate_inferred(
    bytes: &[u8],
    records: u64,
    limits: &DerivedLimits,
    started: Instant,
) -> Result<(), DerivedGenerationError> {
    validate_inferred_with(bytes, records, limits, started, decode)
}

fn validate_inferred_with(
    bytes: &[u8],
    records: u64,
    limits: &DerivedLimits,
    started: Instant,
    mut decode_record: impl FnMut(&[u8]) -> Result<SemanticChange, DerivedGenerationError>,
) -> Result<(), DerivedGenerationError> {
    let mut count = 0_u64;
    for record in Frames::new(bytes) {
        check(&limits.control, started)?;
        count += 1;
        if count > records {
            return Err(DerivedGenerationError::Corrupt);
        }
        if !matches!(
            decode_record(record?)?,
            SemanticChange::QuadAdded(_) | SemanticChange::NamedGraphCreated(_)
        ) {
            return Err(DerivedGenerationError::Corrupt);
        }
    }
    if count != records {
        return Err(DerivedGenerationError::Corrupt);
    }
    check(&limits.control, started)?;
    Ok(())
}

/// Mirrors the reference consumer on an in-memory transaction. Namespace effects are ignored.
fn replay<'a>(
    model: &Store,
    changes: impl IntoIterator<Item = &'a SemanticChange>,
    max_records: u64,
    limits: &DerivedLimits,
    started: Instant,
) -> Result<(), DerivedGenerationError> {
    check(&limits.control, started)?;
    let mut tx = model.start_transaction().map_err(storage)?;
    let mut count = replay_record_count(&tx, max_records, limits, started)?;
    for change in changes {
        check(&limits.control, started)?;
        let additional = match change {
            SemanticChange::QuadAdded(quad) => {
                let graph = match &quad.graph_name {
                    GraphName::NamedNode(name) => Some(NamedOrBlankNode::from(name.clone())),
                    GraphName::BlankNode(name) => Some(NamedOrBlankNode::from(name.clone())),
                    GraphName::DefaultGraph => None,
                };
                u64::from(!tx.contains(quad).map_err(storage)?)
                    + match graph {
                        Some(graph) => {
                            u64::from(!tx.contains_named_graph(&graph).map_err(storage)?)
                        }
                        None => 0,
                    }
            }
            SemanticChange::NamedGraphCreated(graph) => {
                u64::from(!tx.contains_named_graph(graph).map_err(storage)?)
            }
            _ => 0,
        };
        count = count
            .checked_add(additional)
            .filter(|value| *value <= max_records)
            .ok_or(DerivedGenerationError::Limit)?;
        match change {
            SemanticChange::QuadAdded(quad) => tx.insert(quad.clone()),
            SemanticChange::QuadRemoved(quad) => tx.remove(quad),
            SemanticChange::NamedGraphCreated(graph) => tx.insert_named_graph(graph.clone()),
            SemanticChange::GraphCleared(graph) => tx.clear_graph(graph).map_err(storage)?,
            SemanticChange::NamedGraphDropped(graph) => {
                tx.remove_named_graph(graph).map_err(storage)?
            }
            SemanticChange::AllNamedGraphsCleared => {
                WritableDataset::clear_all_named_graphs(&mut tx).map_err(storage)?;
            }
            SemanticChange::AllGraphsCleared => {
                WritableDataset::clear_all_graphs(&mut tx).map_err(storage)?
            }
            SemanticChange::AllNamedGraphsDropped => {
                WritableDataset::remove_all_named_graphs(&mut tx).map_err(storage)?;
            }
            SemanticChange::DatasetCleared => tx.clear().map_err(storage)?,
            SemanticChange::NamespaceChanged { .. } | SemanticChange::NamespacesCleared => {}
        }
        if !matches!(
            change,
            SemanticChange::QuadAdded(_)
                | SemanticChange::NamedGraphCreated(_)
                | SemanticChange::NamespaceChanged { .. }
                | SemanticChange::NamespacesCleared
        ) {
            count = replay_record_count(&tx, max_records, limits, started)?;
        }
    }
    check(&limits.control, started)?;
    tx.commit().map_err(storage)
}

fn replay_record_count(
    tx: &Transaction<'_>,
    max: u64,
    limits: &DerivedLimits,
    started: Instant,
) -> Result<u64, DerivedGenerationError> {
    let mut count = 0_u64;
    for record in tx
        .iter()
        .map(|item| item.map(|_| ()))
        .chain(tx.named_graphs().map(|item| item.map(|_| ())))
    {
        check(&limits.control, started)?;
        record.map_err(storage)?;
        count = count
            .checked_add(1)
            .filter(|value| *value <= max)
            .ok_or(DerivedGenerationError::Limit)?;
    }
    Ok(count)
}

/// Quads and named-graph declarations both count against `max_records`.
fn scan_into_model(
    source: &DerivedSnapshot,
    limits: &DerivedLimits,
    max_records: u64,
) -> Result<Store, DerivedGenerationError> {
    let model = Store::new().map_err(storage)?;
    let mut exceeded = false;
    let mut records = 0_u64;
    let mut tx = model.start_transaction().map_err(storage)?;
    let scanned = source.scan(limits, |change| {
        if matches!(
            change,
            SemanticChange::QuadAdded(_) | SemanticChange::NamedGraphCreated(_)
        ) {
            records += 1;
            if records > max_records {
                exceeded = true;
                return Err(StorageError::Other(
                    "projection source record limit exceeded".into(),
                ));
            }
        }
        match change {
            SemanticChange::QuadAdded(quad) => tx.insert(quad.clone()),
            SemanticChange::NamedGraphCreated(graph) => tx.insert_named_graph(graph.clone()),
            _ => {}
        }
        Ok(())
    });
    if let Err(error) = scanned {
        return Err(if exceeded {
            DerivedGenerationError::Limit
        } else {
            input(error)
        });
    }
    tx.commit().map_err(storage)?;
    Ok(model)
}

fn image_records(
    model: &Store,
    max_records: u64,
    limits: &DerivedLimits,
    started: Instant,
) -> Result<Framed, DerivedGenerationError> {
    let mut records = Records::new(max_records);
    for graph in model.named_graphs() {
        check(&limits.control, started)?;
        records.push(&SemanticChange::NamedGraphCreated(graph.map_err(storage)?))?;
    }
    for quad in model {
        check(&limits.control, started)?;
        records.push(&SemanticChange::QuadAdded(quad.map_err(storage)?))?;
    }
    records.finish(limits, started)
}

struct DoneGuard<'a>(&'a AtomicBool);
impl Drop for DoneGuard<'_> {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

/// Preserve nested engine failure categories without parsing display strings.
fn entailment_error(error: QueryEntailmentError) -> DerivedGenerationError {
    match error {
        QueryEntailmentError::Evaluation(QueryEvaluationError::Cancelled) => {
            BackupError::Cancelled.into()
        }
        QueryEntailmentError::Evaluation(QueryEvaluationError::TimedOut) => {
            BackupError::TimedOut.into()
        }
        QueryEntailmentError::Storage(error) => storage(error),
        QueryEntailmentError::Rdfs(error) if error.is_cancelled() => BackupError::Cancelled.into(),
        QueryEntailmentError::Rdfs(error) if error.is_timed_out() => BackupError::TimedOut.into(),
        QueryEntailmentError::Rdfs(error) if error.is_resource_limit() => {
            DerivedGenerationError::Limit
        }
        QueryEntailmentError::LimitExceeded { .. } => DerivedGenerationError::Limit,
        other => DerivedGenerationError::Reconciliation(other.to_string()),
    }
}

/// Exact finite-RDFS closure of `model` minus its primary records, as canonical framed records.
/// The closure runs through the query-entailment oracle under its admission ceilings. `before`
/// runs on the calling thread after the control watcher starts; production passes a no-op.
fn closure_records(
    model: &Store,
    limits: &EntailmentProjectionLimits,
    control: &DerivedLimits,
    started: Instant,
    before: impl FnOnce(&CancellationToken),
) -> Result<Framed, DerivedGenerationError> {
    check(&control.control, started)?;
    let token = CancellationToken::new();
    let options = QueryEntailmentOptions::new(PROFILE)
        .with_timeout(Some(limits.timeout))
        .with_cancellation_token(token.clone())
        .with_max_materialized_quads(Some(limits.materialized_quads()))
        .with_max_estimated_materialization_bytes(Some(limits.materialized_bytes()));
    let done = AtomicBool::new(false);
    // The control does not expose a token, so a watcher forwards its cancellation and deadline.
    let outcome = std::thread::scope(|scope| {
        let _done = DoneGuard(&done);
        let watched = token.clone();
        let watch = control.control.clone();
        let finished = &done;
        scope.spawn(move || {
            while !finished.load(Ordering::Acquire) {
                if check(&watch, started).is_err() {
                    watched.cancel();
                    return;
                }
                std::thread::sleep(WATCH_INTERVAL);
            }
        });
        before(&token);
        QueryEntailmentDataset::from_store(model, &options)
    });
    let snapshot = match outcome {
        Ok(snapshot) => snapshot,
        Err(error) => {
            // A forwarded control cancellation or deadline reports the control's own reason.
            check(&control.control, started)?;
            return Err(entailment_error(error));
        }
    };
    let mut records = Records::new(limits.max_inferred_quads.get());
    let dataset = snapshot.dataset();
    for quad in dataset {
        check(&control.control, started)?;
        if !model.contains(&quad).map_err(storage)? {
            records.push(&SemanticChange::QuadAdded(quad))?;
        }
    }
    for graph in dataset.named_graphs() {
        check(&control.control, started)?;
        if !model.contains_named_graph(&graph).map_err(storage)? {
            records.push(&SemanticChange::NamedGraphCreated(graph))?;
        }
    }
    drop(snapshot);
    records.finish(control, started)
}

struct Parts {
    meta: Vec<u8>,
    image: Vec<u8>,
}

/// Loaded or freshly computed projection state: a private in-memory primary image (quads and
/// graph topology, no namespaces), the last applied governed receipt and the entailed-only
/// records. The image is exposed only through read-only snapshot accessors.
pub struct EntailmentProjectionState {
    model: Store,
    identity: Option<[u8; 16]>,
    last: Option<(u64, [u8; 32])>,
    limits: EntailmentProjectionLimits,
    /// `None` while stale after `apply` or a failed `recompute`.
    inferred: Option<Framed>,
}

impl fmt::Debug for EntailmentProjectionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EntailmentProjectionState")
            .field("last_receipt_sequence", &self.last_receipt_sequence())
            .field("inferred_records", &self.inferred_record_count())
            .finish_non_exhaustive()
    }
}

impl EntailmentProjectionState {
    /// Loads and integrity-checks `meta`, `image` and `inferred` with default input limits.
    pub fn load(files: &DerivedFiles) -> Result<Self, DerivedGenerationError> {
        Self::load_with(files, &DerivedLimits::default())
    }

    /// As [`Self::load`], honouring the supplied control. Declared record counts and bytes are
    /// checked against the stored limits before any payload is read, and image records are
    /// decoded one at a time. Damage, truncation or a hash disagreement is `Corrupt`; a foreign
    /// profile or schema is `Identity`.
    pub fn load_with(
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> Result<Self, DerivedGenerationError> {
        Self::load_at(files, limits, Instant::now())
    }

    fn load_at(
        files: &DerivedFiles,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Self, DerivedGenerationError> {
        let meta = Meta::decode(&read_all(files, FILE_META, MAX_META, limits, started)?)?;
        if meta.image.records > meta.limits.max_source_quads.get()
            || meta.inferred.records > meta.limits.max_inferred_quads.get()
            || meta.image.bytes > MAX_PAYLOAD
            || meta.inferred.bytes > MAX_PAYLOAD
        {
            return Err(DerivedGenerationError::Limit);
        }
        let image = read_section(files, FILE_IMAGE, &meta.image, limits, started)?;
        let model = Store::new().map_err(storage)?;
        let mut tx = model.start_transaction().map_err(storage)?;
        let mut count = 0_u64;
        for record in Frames::new(&image) {
            check(&limits.control, started)?;
            count += 1;
            if count > meta.image.records {
                return Err(DerivedGenerationError::Corrupt);
            }
            match decode(record?)? {
                SemanticChange::QuadAdded(quad) => tx.insert(quad),
                SemanticChange::NamedGraphCreated(graph) => tx.insert_named_graph(graph),
                _ => return Err(DerivedGenerationError::Corrupt),
            }
        }
        if count != meta.image.records {
            return Err(DerivedGenerationError::Corrupt);
        }
        tx.commit().map_err(storage)?;
        drop(image);
        let inferred = read_section(files, FILE_INFERRED, &meta.inferred, limits, started)?;
        validate_inferred(&inferred, meta.inferred.records, limits, started)?;
        check(&limits.control, started)?;
        Ok(Self {
            model,
            identity: meta.identity,
            last: meta.last,
            limits: meta.limits,
            inferred: Some(Framed {
                bytes: inferred,
                section: meta.inferred,
            }),
        })
    }

    /// Applies complete governed commits to the image, skipping a duplicate of the last commit.
    /// Same sequence with a different id, a lower sequence, a gap or a foreign store identity is
    /// `RebuildRequired`. Inferred records become stale until [`Self::recompute`]. After an error
    /// the state may be partially applied and must be discarded.
    pub fn apply(&mut self, delta: &DerivedDelta) -> Result<(), DerivedGenerationError> {
        self.apply_at(delta, &DerivedLimits::default(), Instant::now())
    }

    fn apply_at(
        &mut self,
        delta: &DerivedDelta,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<(), DerivedGenerationError> {
        for commit in delta.commits() {
            check(&limits.control, started)?;
            let receipt = commit.receipt();
            let sequence = receipt.sequence();
            let id = *receipt.commit_id().as_bytes();
            let store = *receipt.store_identity().as_bytes();
            if self.identity.is_some_and(|known| known != store) {
                return Err(DerivedGenerationError::RebuildRequired);
            }
            match self.last {
                Some((last, last_id)) if sequence == last => {
                    if id == last_id {
                        continue;
                    }
                    return Err(DerivedGenerationError::RebuildRequired);
                }
                Some((last, _)) if last.checked_add(1) != Some(sequence) => {
                    return Err(DerivedGenerationError::RebuildRequired);
                }
                None if sequence != 1 => return Err(DerivedGenerationError::RebuildRequired),
                _ => {}
            }
            if !commit.changes().is_empty() {
                self.inferred = None;
            }
            replay(
                &self.model,
                commit.changes(),
                self.limits.max_source_quads.get(),
                limits,
                started,
            )?;
            self.identity = Some(store);
            self.last = Some((sequence, id));
            if !commit.changes().is_empty() {
                self.inferred = None;
            }
        }
        Ok(())
    }

    /// Recomputes the exact full closure of the image. Fails closed, leaving the state stale, on
    /// the source, inferred and materialization ceilings, cancellation, the closure timeout,
    /// inconsistency and reserved witness labels.
    pub fn recompute(&mut self, limits: &DerivedLimits) -> Result<(), DerivedGenerationError> {
        self.recompute_at(limits, Instant::now())
    }

    fn recompute_at(
        &mut self,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<(), DerivedGenerationError> {
        self.inferred = None;
        check(&limits.control, started)?;
        self.check_source(limits, started)?;
        let inferred = closure_records(&self.model, &self.limits, limits, started, |_| {})?;
        check(&limits.control, started)?;
        self.inferred = Some(inferred);
        Ok(())
    }

    fn check_source(
        &self,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<(), DerivedGenerationError> {
        let max = self.limits.max_source_quads.get();
        let mut count = u64::try_from(self.model.len().map_err(storage)?)
            .map_err(|_| DerivedGenerationError::Limit)?;
        if count > max {
            return Err(DerivedGenerationError::Limit);
        }
        for graph in self.model.named_graphs() {
            check(&limits.control, started)?;
            graph.map_err(storage)?;
            count += 1;
            if count > max {
                return Err(DerivedGenerationError::Limit);
            }
        }
        Ok(())
    }

    fn parts(
        &self,
        inferred: &Framed,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Parts, DerivedGenerationError> {
        let image = image_records(
            &self.model,
            self.limits.max_source_quads.get(),
            limits,
            started,
        )?;
        let meta = Meta {
            identity: self.identity,
            last: self.last,
            limits: self.limits,
            image: image.section,
            inferred: inferred.section,
        }
        .encode();
        Ok(Parts {
            meta,
            image: image.bytes,
        })
    }

    /// Writes `meta`, `image` and `inferred` through the bounded generation writer.
    pub fn write(
        &self,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        self.write_at(output, limits, Instant::now())
    }

    fn write_at(
        &self,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<(), DerivedGenerationError> {
        let inferred = self.inferred.as_ref().ok_or_else(stale)?;
        let parts = self.parts(inferred, limits, started)?;
        output.write_file(FILE_META, parts.meta.as_slice())?;
        output.write_file(FILE_IMAGE, parts.image.as_slice())?;
        output.write_file(FILE_INFERRED, inferred.bytes.as_slice())
    }

    /// Read-only snapshot of the image quads, taken when called.
    pub fn image_quads(&self) -> QuadIter<'static> {
        self.model.iter()
    }

    /// Read-only snapshot of the image named-graph topology, including empty graphs.
    pub fn image_named_graphs(&self) -> GraphNameIter<'static> {
        self.model.named_graphs()
    }

    pub fn image_contains(&self, quad: &Quad) -> Result<bool, StorageError> {
        self.model.contains(quad)
    }

    fn decode_inferred<T>(
        &self,
        mut pick: impl FnMut(SemanticChange) -> Option<T>,
    ) -> Result<Vec<T>, DerivedGenerationError> {
        let inferred = self.inferred.as_ref().ok_or_else(stale)?;
        let mut values = Vec::new();
        for record in Frames::new(&inferred.bytes) {
            if let Some(value) = pick(decode(record?)?) {
                values.push(value);
            }
        }
        Ok(values)
    }

    /// Entailed quads that are not primary quads. Errors while stale.
    pub fn inferred_quads(&self) -> Result<Vec<Quad>, DerivedGenerationError> {
        self.decode_inferred(|change| match change {
            SemanticChange::QuadAdded(quad) => Some(quad),
            _ => None,
        })
    }

    /// Entailed named graphs that are not primary named graphs. Errors while stale.
    pub fn inferred_named_graphs(&self) -> Result<Vec<NamedOrBlankNode>, DerivedGenerationError> {
        self.decode_inferred(|change| match change {
            SemanticChange::NamedGraphCreated(graph) => Some(graph),
            _ => None,
        })
    }

    /// Inferred record count, or `None` while stale.
    pub fn inferred_record_count(&self) -> Option<u64> {
        self.inferred.as_ref().map(|framed| framed.section.records)
    }

    pub fn store_identity(&self) -> Option<StoreIdentity> {
        self.identity.map(StoreIdentity::from_bytes)
    }

    pub fn last_receipt_sequence(&self) -> Option<u64> {
        self.last.map(|(sequence, _)| sequence)
    }

    pub fn last_commit_id(&self) -> Option<CommitId> {
        self.last.map(|(_, id)| CommitId::from_bytes(id))
    }

    pub const fn limits(&self) -> EntailmentProjectionLimits {
        self.limits
    }
}

type SourcePosition = (Option<[u8; 16]>, Option<(u64, [u8; 32])>);

fn source_position(source: &DerivedSnapshot) -> SourcePosition {
    let checkpoint = source.checkpoint();
    (
        checkpoint
            .store_identity()
            .map(|identity| *identity.as_bytes()),
        checkpoint
            .latest_receipt()
            .map(|receipt| (receipt.sequence(), *receipt.commit_id().as_bytes())),
    )
}

/// Finite RDFS 1.2 projection provider: rebuild is scan then full closure; catch-up is replay of
/// governed deltas then full closure; reconcile independently recomputes from the primary
/// snapshot. Primary data is only read.
#[derive(Clone, Copy, Debug, Default)]
pub struct EntailmentProjectionProvider {
    limits: EntailmentProjectionLimits,
}

impl EntailmentProjectionProvider {
    pub const fn new(limits: EntailmentProjectionLimits) -> Self {
        Self { limits }
    }

    pub const fn limits(&self) -> EntailmentProjectionLimits {
        self.limits
    }

    fn scan_state(
        &self,
        source: &DerivedSnapshot,
        limits: &DerivedLimits,
    ) -> Result<EntailmentProjectionState, DerivedGenerationError> {
        let model = scan_into_model(source, limits, self.limits.max_source_quads.get())?;
        let (identity, last) = source_position(source);
        Ok(EntailmentProjectionState {
            model,
            identity,
            last,
            limits: self.limits,
            inferred: None,
        })
    }
}

impl DerivedProvider for EntailmentProjectionProvider {
    fn identity(&self) -> ContributorIdentity {
        entailment_projection_identity()
    }

    fn rebuild(
        &self,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        let mut state = self.scan_state(source, limits)?;
        state.recompute_at(limits, started)?;
        state.write_at(output, limits, started)
    }

    fn apply(
        &self,
        previous: &DerivedFiles,
        delta: &DerivedDelta,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        let mut state = EntailmentProjectionState::load_at(previous, limits, started)?;
        if state.limits != self.limits {
            return Err(DerivedGenerationError::RebuildRequired);
        }
        state.apply_at(delta, limits, started)?;
        if (state.identity, state.last) != source_position(source) {
            return Err(DerivedGenerationError::RebuildRequired);
        }
        state.recompute_at(limits, started)?;
        state.write_at(output, limits, started)
    }

    fn reconcile(
        &self,
        source: &DerivedSnapshot,
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        let stored = Meta::decode(&read_all(files, FILE_META, MAX_META, limits, started)?)?;
        if stored.limits != self.limits {
            return Err(DerivedGenerationError::Reconciliation(
                "candidate was built under different projection limits".into(),
            ));
        }
        let mut expected = self.scan_state(source, limits)?;
        expected.recompute_at(limits, started)?;
        let inferred = expected.inferred.as_ref().ok_or_else(stale)?;
        let parts = expected.parts(inferred, limits, started)?;
        for (name, bytes) in [
            (FILE_META, parts.meta.as_slice()),
            (FILE_IMAGE, parts.image.as_slice()),
            (FILE_INFERRED, inferred.bytes.as_slice()),
        ] {
            if !same_file(files, name, bytes, limits, started)? {
                return Err(DerivedGenerationError::Reconciliation(format!(
                    "{name} differs from the independent primary recomputation"
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[expect(
    clippy::missing_assert_message,
    clippy::panic_in_result_fn,
    reason = "isolated format, replay and closure-control assertions"
)]
mod tests {
    use super::*;
    use crate::model::vocab::{rdf, rdfs};
    use crate::model::{GraphName, NamedNode};

    fn node(local: &str) -> NamedNode {
        NamedNode::new_unchecked(format!("urn:test:{local}"))
    }

    fn frame_count(bytes: &[u8]) -> Result<usize, DerivedGenerationError> {
        Frames::new(bytes).try_fold(0, |count, frame| frame.map(|_| count + 1))
    }

    #[test]
    fn final_inferred_decode_cannot_publish_after_cancellation()
    -> Result<(), Box<dyn std::error::Error>> {
        let limits = DerivedLimits::default();
        let mut records = Records::new(1);
        records.push(&SemanticChange::NamedGraphCreated(node("g").into()))?;
        let framed = records.finish(&limits, Instant::now())?;
        let mut decoded = 0;
        let result = validate_inferred_with(&framed.bytes, 1, &limits, Instant::now(), |bytes| {
            let value = decode(bytes)?;
            decoded += 1;
            limits.control.cancel();
            Ok(value)
        });
        assert_eq!(decoded, 1);
        assert!(matches!(
            result,
            Err(DerivedGenerationError::Backup(BackupError::Cancelled))
        ));
        Ok(())
    }

    fn sample(timeout: Duration) -> Meta {
        Meta {
            identity: Some([7; 16]),
            last: Some((3, [9; 32])),
            limits: EntailmentProjectionLimits {
                timeout,
                ..EntailmentProjectionLimits::default()
            },
            image: Section {
                records: 2,
                bytes: 10,
                sha256: [1; 32],
            },
            inferred: Section {
                records: 0,
                bytes: 0,
                sha256: [2; 32],
            },
        }
    }

    fn dog_model() -> Result<Store, StorageError> {
        let model = Store::new()?;
        model.insert(Quad::new(
            node("Dog"),
            rdfs::SUB_CLASS_OF,
            node("Animal"),
            GraphName::DefaultGraph,
        ))?;
        model.insert(Quad::new(
            node("fido"),
            rdf::TYPE,
            node("Dog"),
            GraphName::DefaultGraph,
        ))?;
        Ok(model)
    }

    #[test]
    fn identity_provider_bytes_are_exactly_sixteen() {
        assert_eq!(
            entailment_projection_identity().provider(),
            b"oxigraph.entrdfs"
        );
        assert_eq!(entailment_projection_identity().schema(), NonZeroU32::MIN);
    }

    #[test]
    fn meta_round_trips_and_rejects_every_flip_and_truncation() {
        let meta = sample(Duration::from_secs(60));
        let bytes = meta.encode();
        assert_eq!(Meta::decode(&bytes).ok(), Some(meta));
        for index in 0..bytes.len() {
            let mut corrupt = bytes.clone();
            corrupt[index] ^= 1;
            assert!(Meta::decode(&corrupt).is_err());
        }
        for end in 0..bytes.len() {
            assert!(Meta::decode(&bytes[..end]).is_err());
        }
    }

    #[test]
    fn meta_keeps_submillisecond_timeout_identity() -> Result<(), DerivedGenerationError> {
        let fine = sample(Duration::from_nanos(1_500_001));
        let decoded = Meta::decode(&fine.encode())?;
        assert_eq!(decoded.limits.timeout, Duration::from_nanos(1_500_001));
        let other = sample(Duration::from_nanos(1_500_002));
        assert_ne!(fine.encode(), other.encode());
        assert_ne!(decoded.limits, other.limits);
        Ok(())
    }

    #[test]
    fn frames_must_be_ascending_and_complete() {
        let ordered = [0, 0, 0, 1, b'a', 0, 0, 0, 1, b'b'];
        assert_eq!(frame_count(&ordered).ok(), Some(2));
        assert!(frame_count(&[0, 0, 0, 1, b'b', 0, 0, 0, 1, b'a']).is_err());
        assert!(frame_count(&[0, 0, 0, 1, b'a', 0, 0, 0, 1, b'a']).is_err());
        assert!(frame_count(&ordered[..ordered.len() - 1]).is_err());
        assert!(frame_count(&[0, 0, 0]).is_err());
    }

    #[test]
    fn replay_mirrors_deletion_semantics() -> Result<(), Box<dyn std::error::Error>> {
        let store = Store::new()?;
        let graph = node("g");
        let quad = Quad::new(node("s"), node("p"), node("o"), graph.clone());
        let add = SemanticChange::QuadAdded(quad.clone());
        let limits = DerivedLimits::default();
        let started = Instant::now();
        replay(&store, [&add], 10, &limits, started)?;
        assert!(store.contains(&quad)?);
        let clear = SemanticChange::GraphCleared(GraphName::from(graph.clone()));
        replay(&store, [&clear], 10, &limits, started)?;
        assert!(!store.contains(&quad)?);
        assert!(store.contains_named_graph(&graph.clone().into())?);
        let drop_graph = SemanticChange::NamedGraphDropped(graph.clone().into());
        replay(&store, [&drop_graph], 10, &limits, started)?;
        assert!(!store.contains_named_graph(&graph.into())?);
        replay(
            &store,
            [&add, &SemanticChange::DatasetCleared],
            10,
            &limits,
            started,
        )?;
        assert!(store.is_empty()?);
        Ok(())
    }

    #[test]
    fn replay_admits_quad_and_implicit_graph_before_retention()
    -> Result<(), Box<dyn std::error::Error>> {
        let store = Store::new()?;
        let quad = Quad::new(node("s"), node("p"), node("o"), node("g"));
        let add = SemanticChange::QuadAdded(quad.clone());
        let limits = DerivedLimits::default();
        let started = Instant::now();
        assert!(matches!(
            replay(&store, [&add], 1, &limits, started),
            Err(DerivedGenerationError::Limit)
        ));
        assert!(store.is_empty()?);
        assert!(store.named_graphs().next().is_none());
        replay(&store, [&add, &add], 2, &limits, started)?;
        assert!(store.contains(&quad)?);
        let extra = SemanticChange::NamedGraphCreated(node("extra").into());
        assert!(matches!(
            replay(&store, [&extra], 2, &limits, started),
            Err(DerivedGenerationError::Limit)
        ));
        assert!(!store.contains_named_graph(&node("extra").into())?);
        let clear = SemanticChange::DatasetCleared;
        replay(&store, [&clear, &extra], 2, &limits, started)?;
        assert!(store.is_empty()?);
        assert!(store.contains_named_graph(&node("extra").into())?);
        limits.control.cancel();
        assert!(matches!(
            replay(&store, [&clear], 2, &limits, started),
            Err(DerivedGenerationError::Backup(BackupError::Cancelled))
        ));
        assert!(store.contains_named_graph(&node("extra").into())?);
        Ok(())
    }

    #[test]
    fn closure_records_are_canonical_entailed_only_and_capped()
    -> Result<(), Box<dyn std::error::Error>> {
        let model = dog_model()?;
        let limits = EntailmentProjectionLimits::default();
        let control = DerivedLimits::default();
        let framed = closure_records(&model, &limits, &control, Instant::now(), |_| {})?;
        verify(&framed.bytes, &framed.section)?;
        assert_eq!(
            framed.section.records,
            u64::try_from(frame_count(&framed.bytes)?)?
        );
        let mut quads = Vec::new();
        for record in Frames::new(&framed.bytes) {
            if let SemanticChange::QuadAdded(quad) = decode(record?)? {
                assert!(!model.contains(&quad)?);
                quads.push(quad);
            }
        }
        assert!(quads.contains(&Quad::new(
            node("fido"),
            rdf::TYPE,
            node("Animal"),
            GraphName::DefaultGraph,
        )));
        let tiny_inferred = EntailmentProjectionLimits {
            max_inferred_quads: NonZeroU64::MIN,
            ..limits
        };
        assert!(matches!(
            closure_records(&model, &tiny_inferred, &control, Instant::now(), |_| {}),
            Err(DerivedGenerationError::Limit)
        ));
        let tiny_bytes = EntailmentProjectionLimits {
            max_estimated_bytes: NonZeroU64::MIN,
            ..limits
        };
        assert!(matches!(
            closure_records(&model, &tiny_bytes, &control, Instant::now(), |_| {}),
            Err(DerivedGenerationError::Limit)
        ));
        Ok(())
    }

    #[test]
    fn control_cancellation_reaches_the_running_materialization_through_the_watcher()
    -> Result<(), StorageError> {
        use std::cell::{Cell, RefCell};
        use std::rc::Rc;
        let model = dog_model()?;
        let control = DerivedLimits::default();
        let limits = EntailmentProjectionLimits::default();
        let seen = Rc::new(Cell::new(0));
        let probe_seen = Rc::clone(&seen);
        let token = Rc::new(RefCell::new(None::<CancellationToken>));
        let probe_token = Rc::clone(&token);
        let cancellation = control.control.clone();
        let result = QueryEntailmentDataset::with_rdfs_checkpoint_probe(
            move || {
                probe_seen.set(probe_seen.get() + 1);
                if probe_seen.get() == 32 {
                    // This callback runs inside Rdfs12Finite.evaluate, not at provider entry.
                    cancellation.cancel();
                    let token = probe_token.borrow();
                    let token = token.as_ref().expect("materialization token installed");
                    let deadline = Instant::now() + Duration::from_secs(5);
                    while !token.is_cancelled() && Instant::now() < deadline {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    assert!(
                        token.is_cancelled(),
                        "watcher did not forward active cancellation"
                    );
                }
            },
            || {
                closure_records(&model, &limits, &control, Instant::now(), |value| {
                    token.replace(Some(value.clone()));
                })
            },
        );
        assert!(seen.get() >= 32, "test never reached active engine work");
        assert!(matches!(
            result,
            Err(DerivedGenerationError::Backup(BackupError::Cancelled))
        ));
        Ok(())
    }

    #[test]
    fn positive_deadline_expires_inside_active_materialization() -> Result<(), StorageError> {
        use std::cell::Cell;
        use std::rc::Rc;
        let model = dog_model()?;
        let seen = Rc::new(Cell::new(0));
        let probe_seen = Rc::clone(&seen);
        let limits = EntailmentProjectionLimits {
            timeout: Duration::from_secs(1),
            ..EntailmentProjectionLimits::default()
        };
        let started = Instant::now();
        let result = QueryEntailmentDataset::with_rdfs_checkpoint_probe(
            move || {
                probe_seen.set(probe_seen.get() + 1);
                if probe_seen.get() == 32 {
                    assert!(
                        started.elapsed() < Duration::from_secs(1),
                        "deadline expired before active checkpoint"
                    );
                    // Delay at an observed engine checkpoint; never infer active work from sleep alone.
                    std::thread::sleep(Duration::from_secs(1));
                }
            },
            || closure_records(&model, &limits, &DerivedLimits::default(), started, |_| {}),
        );
        assert!(seen.get() >= 32);
        assert!(matches!(
            result,
            Err(DerivedGenerationError::Backup(BackupError::TimedOut))
        ));
        Ok(())
    }

    #[test]
    fn closure_timeout_is_typed_timed_out() -> Result<(), StorageError> {
        let model = dog_model()?;
        let zero = EntailmentProjectionLimits {
            timeout: Duration::ZERO,
            ..EntailmentProjectionLimits::default()
        };
        let result = closure_records(
            &model,
            &zero,
            &DerivedLimits::default(),
            Instant::now(),
            |_| {},
        );
        assert!(matches!(
            result,
            Err(DerivedGenerationError::Backup(BackupError::TimedOut))
        ));
        Ok(())
    }

    #[test]
    fn entailment_errors_keep_their_category() {
        assert!(matches!(
            entailment_error(QueryEntailmentError::Rdfs(
                oxrdfs::Rdfs12Error::ReservedWitnessLabel {
                    label: "oxrdfs1".into(),
                    prefix: "oxrdfs",
                }
            )),
            DerivedGenerationError::Reconciliation(_)
        ));
        assert!(matches!(
            entailment_error(QueryEntailmentError::Rdfs(
                oxrdfs::Rdfs12Error::UnsupportedRecognizedDatatype {
                    datatype: node("unsupported"),
                }
            )),
            DerivedGenerationError::Reconciliation(_)
        ));
        assert!(matches!(
            entailment_error(QueryEvaluationError::Cancelled.into()),
            DerivedGenerationError::Backup(BackupError::Cancelled)
        ));
        assert!(matches!(
            entailment_error(QueryEvaluationError::TimedOut.into()),
            DerivedGenerationError::Backup(BackupError::TimedOut)
        ));
        assert!(matches!(
            entailment_error(QueryEntailmentError::LimitExceeded {
                limit: "quad",
                stage: "snapshot",
                ceiling: 1,
            }),
            DerivedGenerationError::Limit
        ));
        assert!(matches!(
            entailment_error(QueryEntailmentError::RdfsInconsistent { reasons: 1 }),
            DerivedGenerationError::Reconciliation(_)
        ));
    }
}
