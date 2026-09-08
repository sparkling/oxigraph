//! CRS84 envelope candidates on the shared durable derived-index lifecycle.
use super::backup::check;
use super::{
    BackupCheckpoint, ContributorIdentity, DerivedDelta, DerivedFiles, DerivedGenerationError,
    DerivedLimits, DerivedProvider, DerivedSnapshot, DerivedView, DerivedWriter, SemanticChange,
    StorageError,
};
use crate::model::{GraphName, Literal, NamedNode, Quad, Term};
use rstar::{AABB, RTree, RTreeObject};
use sha2::{Digest, Sha256};
use spargeo::{SpatialEnvelope, spatial_envelope};
use std::collections::BTreeMap;
use std::num::{NonZeroU32, NonZeroUsize};
use std::time::Instant;

const PROFILE: &str = "spatial.profile";
const BASE: &str = "spatial.base";
const OVERLAY: &str = "spatial.overlay";
const MAGIC: &[u8] = b"oxigraph.spatial.records.v1\0";

/// Logical working-set ceilings, not RSS/native allocation quotas.
#[derive(Clone, Debug)]
#[expect(clippy::struct_field_names, reason = "explicit logical ceiling names")]
pub struct SpatialLimits {
    pub max_documents: NonZeroUsize,
    pub max_document_bytes: NonZeroUsize,
    pub max_index_bytes: NonZeroUsize,
    pub max_candidates: NonZeroUsize,
    pub max_overlay_records: NonZeroUsize,
}
impl Default for SpatialLimits {
    fn default() -> Self {
        Self {
            max_documents: NonZeroUsize::new(100_000).unwrap_or(NonZeroUsize::MIN),
            max_document_bytes: NonZeroUsize::new(1024 * 1024).unwrap_or(NonZeroUsize::MIN),
            max_index_bytes: NonZeroUsize::new(64 * 1024 * 1024).unwrap_or(NonZeroUsize::MIN),
            max_candidates: NonZeroUsize::new(10_000).unwrap_or(NonZeroUsize::MIN),
            max_overlay_records: NonZeroUsize::new(10_000).unwrap_or(NonZeroUsize::MIN),
        }
    }
}

/// Evaluates the ordered relation `relation(candidate_literal, geometry)`.
/// All existing SF, Egenhofer and RCC8 binary relation names are accepted.
#[derive(Clone, Debug)]
pub struct SpatialQuery {
    pub geometry: Term,
    pub relation: NamedNode,
    pub graph: Option<GraphName>,
    pub predicate: Option<NamedNode>,
    /// Explicit output limit, after all bounded candidates are exactly refined.
    pub limit: Option<NonZeroUsize>,
}
impl SpatialQuery {
    pub fn new(geometry: impl Into<Term>, relation: impl Into<NamedNode>) -> Self {
        Self {
            geometry: geometry.into(),
            relation: relation.into(),
            graph: None,
            predicate: None,
            limit: None,
        }
    }
}
#[derive(Clone, Debug)]
pub struct SpatialResults {
    pub matches: Vec<Quad>,
    pub candidates: usize,
    pub total_matches: usize,
    pub source: BackupCheckpoint,
    pub applied: BackupCheckpoint,
}
impl SpatialResults {
    pub fn truncated(&self) -> bool {
        self.matches.len() < self.total_matches
    }
}
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum SpatialError {
    #[error(transparent)]
    Generation(#[from] DerivedGenerationError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error("unsupported spatial query relation or geometry")]
    Query,
    #[error("nonfinite geometry coordinates cannot be indexed or exactly refined")]
    NonFinite,
    #[error("invalid geometry topology is outside the spatial profile")]
    InvalidGeometry,
    #[error("geometry coordinates exceed the spatial profile arithmetic range")]
    CoordinateRange,
    #[error("nonempty geometry collections are outside the spatial profile")]
    GeometryCollection,
    #[error("spatial provider logical resource ceiling exceeded")]
    Limit,
    #[error("spatial profile or canonical envelope payload differs; rebuild required")]
    Profile,
    #[error("spatial candidates do not reproduce the exact primary geometry set")]
    NotEquivalent,
}
fn provider_error(error: SpatialError) -> DerivedGenerationError {
    match error {
        SpatialError::Generation(error) => error,
        SpatialError::Limit => DerivedGenerationError::Limit,
        other => DerivedGenerationError::Reconciliation(other.to_string()),
    }
}
fn controlled(limits: &DerivedLimits, started: Instant) -> Result<(), SpatialError> {
    check(&limits.control, started).map_err(DerivedGenerationError::from)?;
    Ok(())
}

#[derive(Clone, Debug, Default)]
pub struct SpatialIndexProvider {
    pub limits: SpatialLimits,
}
#[derive(Clone, Debug, PartialEq)]
struct Document {
    quad: Quad,
    envelope: SpatialEnvelope,
}
#[derive(Clone, Debug, Default, PartialEq)]
struct Documents {
    entries: BTreeMap<Vec<u8>, Document>,
    // Conservative encoded key + frame + largest envelope, charged before insertion.
    bytes: usize,
}
impl Documents {
    fn remove(&mut self, key: &[u8]) {
        if self.entries.remove(key).is_some() {
            self.bytes -= key.len() + 41;
        }
    }
    fn retain(
        &mut self,
        keep: impl Fn(&Document) -> bool,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<(), SpatialError> {
        let mut failure = None;
        self.entries.retain(|key, document| {
            if failure.is_some() {
                return true;
            }
            if let Err(error) = controlled(limits, started) {
                failure = Some(error);
                return true;
            }
            if keep(document) {
                true
            } else {
                self.bytes -= key.len() + 41;
                false
            }
        });
        if let Some(error) = failure {
            return Err(error);
        }
        Ok(())
    }
}
struct IndexedBox {
    envelope: AABB<[f64; 2]>,
    ordinal: usize,
}
impl RTreeObject for IndexedBox {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}
struct Payload {
    base: Documents,
    overlay: Vec<SemanticChange>,
}

impl SpatialIndexProvider {
    /// Versioned raw-XY CRS84 WKT/GeoJSON profile; no native tree layout is stored.
    /// Opening rechecks every stored envelope with the current shared parser.
    /// Queries additionally reconcile the entire current accepted geometry set.
    pub fn profile() -> String {
        format!(
            "oxigraph.spatial.crs84.rawxy.v1;rstar=0.13;quad-codec=1;rdf12={}",
            cfg!(feature = "rdf-12")
        )
    }
    fn encoded(&self, change: &SemanticChange) -> Result<Vec<u8>, SpatialError> {
        let mut size = 0_usize;
        super::change_codec::emit(change, &mut |part| size = size.saturating_add(part.len()));
        if size > self.limits.max_document_bytes.get() {
            return Err(SpatialError::Limit);
        }
        Ok(super::change_codec::encode(change)?)
    }
    fn classify(&self, quad: &Quad) -> Result<Option<SpatialEnvelope>, SpatialError> {
        let Term::Literal(literal) = &quad.object else {
            return Ok(None);
        };
        if !matches!(
            literal.datatype().as_str(),
            "http://www.opengis.net/ont/geosparql#wktLiteral"
                | "http://www.opengis.net/ont/geosparql#geoJSONLiteral"
        ) {
            return Ok(None);
        }
        if literal.value().len() > self.limits.max_document_bytes.get() {
            return Err(SpatialError::Limit);
        }
        match spatial_envelope(&quad.object) {
            SpatialEnvelope::Unsupported => Ok(None),
            SpatialEnvelope::NonFinite => Err(SpatialError::NonFinite),
            SpatialEnvelope::Invalid => Err(SpatialError::InvalidGeometry),
            SpatialEnvelope::OutOfRange => Err(SpatialError::CoordinateRange),
            SpatialEnvelope::UnsupportedCollection => Err(SpatialError::GeometryCollection),
            envelope => Ok(Some(envelope)),
        }
    }
    fn insert(&self, documents: &mut Documents, quad: &Quad) -> Result<(), SpatialError> {
        let Some(envelope) = self.classify(quad)? else {
            return Ok(());
        };
        let key = self.encoded(&SemanticChange::QuadAdded(quad.clone()))?;
        self.insert_document(
            documents,
            key,
            Document {
                quad: quad.clone(),
                envelope,
            },
        )
    }
    fn insert_document(
        &self,
        documents: &mut Documents,
        key: Vec<u8>,
        document: Document,
    ) -> Result<(), SpatialError> {
        if documents.entries.contains_key(&key) {
            return Ok(());
        }
        if documents.entries.len() >= self.limits.max_documents.get() {
            return Err(SpatialError::Limit);
        }
        let bytes = documents
            .bytes
            .checked_add(key.len() + 41)
            .ok_or(SpatialError::Limit)?;
        if bytes > self.limits.max_index_bytes.get() {
            return Err(SpatialError::Limit);
        }
        documents.entries.insert(key, document);
        documents.bytes = bytes;
        Ok(())
    }
    fn scan(
        &self,
        source: &DerivedSnapshot,
        limits: &DerivedLimits,
    ) -> Result<Documents, SpatialError> {
        let mut documents = Documents::default();
        let mut failure = None;
        let result = source.scan(limits, |change| {
            if let SemanticChange::QuadAdded(quad) = change {
                if let Err(error) = self.insert(&mut documents, quad) {
                    failure = Some(error);
                    return Err(StorageError::Other(
                        "spatial source scan interrupted".into(),
                    ));
                }
            }
            Ok(())
        });
        if let Some(error) = failure {
            return Err(error);
        }
        result.map_err(DerivedGenerationError::from)?;
        Ok(documents)
    }
    fn replay(
        &self,
        documents: &mut Documents,
        change: &SemanticChange,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<(), SpatialError> {
        controlled(limits, started)?;
        match change {
            SemanticChange::QuadAdded(quad) => self.insert(documents, quad)?,
            SemanticChange::QuadRemoved(quad) => {
                documents.remove(&self.encoded(&SemanticChange::QuadAdded(quad.clone()))?);
            }
            SemanticChange::GraphCleared(graph) => {
                documents.retain(|doc| &doc.quad.graph_name != graph, limits, started)?
            }
            SemanticChange::NamedGraphDropped(graph) => {
                let graph = GraphName::from(graph.clone());
                documents.retain(|doc| doc.quad.graph_name != graph, limits, started)?;
            }
            SemanticChange::AllNamedGraphsCleared | SemanticChange::AllNamedGraphsDropped => {
                documents.retain(
                    |doc| doc.quad.graph_name == GraphName::DefaultGraph,
                    limits,
                    started,
                )?
            }
            SemanticChange::AllGraphsCleared | SemanticChange::DatasetCleared => {
                documents.retain(|_| false, limits, started)?
            }
            SemanticChange::NamedGraphCreated(_)
            | SemanticChange::NamespaceChanged { .. }
            | SemanticChange::NamespacesCleared => (),
        }
        controlled(limits, started)
    }
    fn materialize(
        &self,
        payload: &Payload,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Documents, SpatialError> {
        let mut documents = payload.base.clone();
        for change in &payload.overlay {
            self.replay(&mut documents, change, limits, started)?;
        }
        Ok(documents)
    }
    fn open(
        &self,
        files: &DerivedFiles,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Payload, SpatialError> {
        if files.names().collect::<Vec<_>>() != [BASE, OVERLAY, PROFILE] {
            return Err(SpatialError::Profile);
        }
        let profile = files.read_verified(PROFILE, 4096, limits, started)?;
        if profile != Self::profile().as_bytes() {
            return Err(SpatialError::Profile);
        }
        let base_bytes =
            files.read_verified(BASE, self.limits.max_index_bytes.get(), limits, started)?;
        let overlay_bytes = files.read_verified(
            OVERLAY,
            self.limits
                .max_index_bytes
                .get()
                .saturating_sub(base_bytes.len()),
            limits,
            started,
        )?;
        let mut decoder = Decoder::new(&base_bytes)?;
        let mut base = Documents::default();
        let count = decoder.count(self.limits.max_documents.get())?;
        for _ in 0..count {
            controlled(limits, started)?;
            let key = decoder.record(self.limits.max_document_bytes.get())?;
            let SemanticChange::QuadAdded(quad) = super::change_codec::decode(key)? else {
                return Err(SpatialError::Profile);
            };
            let envelope = decoder.envelope()?;
            if self.classify(&quad)? != Some(envelope)
                || base
                    .entries
                    .last_key_value()
                    .is_some_and(|(previous, _)| previous.as_slice() >= key)
            {
                return Err(SpatialError::Profile);
            }
            self.insert_document(&mut base, key.to_vec(), Document { quad, envelope })?;
        }
        decoder.finish()?;
        let mut decoder = Decoder::new(&overlay_bytes)?;
        let count = decoder.count(self.limits.max_overlay_records.get())?;
        let mut overlay = Vec::new();
        for _ in 0..count {
            controlled(limits, started)?;
            overlay.push(super::change_codec::decode(
                decoder.record(self.limits.max_document_bytes.get())?,
            )?);
        }
        decoder.finish()?;
        Ok(Payload { base, overlay })
    }
    fn write(
        &self,
        payload: &Payload,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<(), SpatialError> {
        if payload.overlay.len() > self.limits.max_overlay_records.get() {
            return Err(SpatialError::Limit);
        }
        let mut base = MAGIC.to_vec();
        put_count(&mut base, payload.base.entries.len())?;
        for (key, document) in &payload.base.entries {
            controlled(limits, started)?;
            put_record(&mut base, key)?;
            match document.envelope {
                SpatialEnvelope::Unbounded => base.push(0),
                SpatialEnvelope::Bounds { lower, upper } => {
                    base.push(1);
                    for coordinate in lower.into_iter().chain(upper) {
                        base.extend_from_slice(&coordinate.to_bits().to_be_bytes());
                    }
                }
                _ => return Err(SpatialError::Profile),
            }
        }
        let mut overlay = MAGIC.to_vec();
        put_count(&mut overlay, payload.overlay.len())?;
        for change in &payload.overlay {
            controlled(limits, started)?;
            put_record(&mut overlay, &self.encoded(change)?)?;
            if base.len().saturating_add(overlay.len()) > self.limits.max_index_bytes.get() {
                return Err(SpatialError::Limit);
            }
        }
        if base.len().saturating_add(overlay.len()) > self.limits.max_index_bytes.get() {
            return Err(SpatialError::Limit);
        }
        output.write_file(PROFILE, Self::profile().as_bytes())?;
        output.write_file(BASE, base.as_slice())?;
        output.write_file(OVERLAY, overlay.as_slice())?;
        Ok(())
    }
    /// Strict only. Candidates are scoped, point-verified and refined through
    /// the existing exact function table. Disjoint and unbounded query shapes
    /// use all records; empty candidates are always refined.
    pub fn query(
        &self,
        view: &DerivedView<'_>,
        query: &SpatialQuery,
        limits: &DerivedLimits,
    ) -> Result<SpatialResults, SpatialError> {
        let started = Instant::now();
        controlled(limits, started)?;
        if view.is_eventual() {
            return Err(DerivedGenerationError::NotFresh.into());
        }
        if view.generation().identity() != self.identity() {
            return Err(SpatialError::Profile);
        }
        let (function, disjoint) = relation(&query.relation).ok_or(SpatialError::Query)?;
        let Term::Literal(literal) = &query.geometry else {
            return Err(SpatialError::Query);
        };
        if literal.value().len() > self.limits.max_document_bytes.get() {
            return Err(SpatialError::Limit);
        }
        let envelope = spatial_envelope(&query.geometry);
        match envelope {
            SpatialEnvelope::Unsupported => return Err(SpatialError::Query),
            SpatialEnvelope::NonFinite => return Err(SpatialError::NonFinite),
            SpatialEnvelope::Invalid => return Err(SpatialError::InvalidGeometry),
            SpatialEnvelope::OutOfRange => return Err(SpatialError::CoordinateRange),
            SpatialEnvelope::UnsupportedCollection => return Err(SpatialError::GeometryCollection),
            _ => (),
        }
        let payload = self.open(view.generation().files(), limits, started)?;
        let documents = self.materialize(&payload, limits, started)?;
        // Parser/dependency changes cannot hide newly accepted primary literals.
        // This correctness baseline deliberately scans, not an acceleration claim.
        if documents != self.scan(view.source(), limits)? {
            return Err(SpatialError::NotEquivalent);
        }
        let records: Vec<_> = documents.entries.values().collect();
        let mut boxes = Vec::new();
        let mut candidates = Vec::new();
        for (ordinal, document) in records.iter().enumerate() {
            controlled(limits, started)?;
            if let SpatialEnvelope::Bounds { lower, upper } = document.envelope {
                boxes.push(IndexedBox {
                    envelope: AABB::from_corners(lower, upper),
                    ordinal,
                });
            } else {
                if candidates.len() >= self.limits.max_candidates.get() {
                    return Err(SpatialError::Limit);
                }
                candidates.push(ordinal);
            }
        }
        if let SpatialEnvelope::Bounds { lower, upper } = envelope {
            if disjoint {
                if records.len() > self.limits.max_candidates.get() {
                    return Err(SpatialError::Limit);
                }
                candidates = (0..records.len()).collect();
            } else {
                let tree = RTree::bulk_load(boxes);
                for item in tree.locate_in_envelope_intersecting(AABB::from_corners(lower, upper)) {
                    controlled(limits, started)?;
                    if candidates.len() >= self.limits.max_candidates.get() {
                        return Err(SpatialError::Limit);
                    }
                    candidates.push(item.ordinal);
                }
            }
        } else {
            if records.len() > self.limits.max_candidates.get() {
                return Err(SpatialError::Limit);
            }
            candidates = (0..records.len()).collect();
        }
        if candidates.len() > self.limits.max_candidates.get() {
            return Err(SpatialError::Limit);
        }
        candidates.sort_unstable();
        let candidate_count = candidates.len();
        let mut matches = Vec::new();
        for ordinal in candidates {
            controlled(limits, started)?;
            let quad = &records[ordinal].quad;
            if query
                .graph
                .as_ref()
                .is_some_and(|graph| graph != &quad.graph_name)
                || query
                    .predicate
                    .as_ref()
                    .is_some_and(|predicate| predicate != &quad.predicate)
                || !view.source().contains(quad)?
            {
                continue;
            }
            if function(&[quad.object.clone(), query.geometry.clone()])
                == Some(Literal::from(true).into())
            {
                matches.push(quad.clone());
            }
        }
        let total_matches = matches.len();
        if let Some(limit) = query.limit {
            matches.truncate(limit.get());
        }
        controlled(limits, started)?;
        Ok(SpatialResults {
            matches,
            candidates: candidate_count,
            total_matches,
            source: view.source().checkpoint().clone(),
            applied: view.generation().source().clone(),
        })
    }
}

impl DerivedProvider for SpatialIndexProvider {
    fn identity(&self) -> ContributorIdentity {
        let digest = Sha256::digest(Self::profile());
        let mut id = [0; 16];
        id.copy_from_slice(&digest[..16]);
        ContributorIdentity::new(id, NonZeroU32::MIN)
    }
    fn rebuild(
        &self,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        let base = self.scan(source, limits).map_err(provider_error)?;
        self.write(
            &Payload {
                base,
                overlay: Vec::new(),
            },
            output,
            limits,
            started,
        )
        .map_err(provider_error)
    }
    fn apply(
        &self,
        previous: &DerivedFiles,
        delta: &DerivedDelta,
        _source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        let mut payload = self
            .open(previous, limits, started)
            .map_err(provider_error)?;
        let mut bytes = payload.base.bytes.saturating_add(2 * (MAGIC.len() + 8));
        for change in &payload.overlay {
            controlled(limits, started).map_err(provider_error)?;
            bytes = bytes.saturating_add(self.encoded(change).map_err(provider_error)?.len() + 8);
        }
        for commit in delta.commits() {
            for change in commit.changes() {
                controlled(limits, started).map_err(provider_error)?;
                if matches!(
                    change,
                    SemanticChange::NamespaceChanged { .. }
                        | SemanticChange::NamespacesCleared
                        | SemanticChange::NamedGraphCreated(_)
                ) {
                    continue;
                }
                if payload.overlay.len() >= self.limits.max_overlay_records.get() {
                    return Err(DerivedGenerationError::RebuildRequired);
                }
                bytes =
                    bytes.saturating_add(self.encoded(change).map_err(provider_error)?.len() + 8);
                if bytes > self.limits.max_index_bytes.get() {
                    return Err(DerivedGenerationError::RebuildRequired);
                }
                payload.overlay.push(change.clone());
            }
        }
        self.write(&payload, output, limits, started)
            .map_err(provider_error)
    }
    fn reconcile(
        &self,
        source: &DerivedSnapshot,
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        let started = Instant::now();
        let payload = self.open(files, limits, started).map_err(provider_error)?;
        let documents = self
            .materialize(&payload, limits, started)
            .map_err(provider_error)?;
        if documents != self.scan(source, limits).map_err(provider_error)? {
            return Err(provider_error(SpatialError::NotEquivalent));
        }
        Ok(())
    }
}
type RelationFn = fn(&[Term]) -> Option<Term>;
fn relation(name: &NamedNode) -> Option<(RelationFn, bool)> {
    let local = name
        .as_str()
        .strip_prefix("http://www.opengis.net/def/function/geosparql/")?;
    if !matches!(
        local,
        "sfEquals"
            | "sfDisjoint"
            | "sfIntersects"
            | "sfTouches"
            | "sfCrosses"
            | "sfWithin"
            | "sfContains"
            | "sfOverlaps"
            | "ehEquals"
            | "ehDisjoint"
            | "ehMeet"
            | "ehOverlap"
            | "ehCovers"
            | "ehCoveredBy"
            | "ehInside"
            | "ehContains"
            | "rcc8eq"
            | "rcc8dc"
            | "rcc8ec"
            | "rcc8po"
            | "rcc8tpp"
            | "rcc8ntpp"
            | "rcc8tppi"
            | "rcc8ntppi"
    ) {
        return None;
    }
    spargeo::GEOSPARQL_EXTENSION_FUNCTIONS
        .into_iter()
        .find(|(iri, _)| iri == name)
        .map(|(_, function)| {
            (
                function,
                matches!(local, "sfDisjoint" | "ehDisjoint" | "rcc8dc"),
            )
        })
}
fn put_count(bytes: &mut Vec<u8>, count: usize) -> Result<(), SpatialError> {
    bytes.extend_from_slice(
        &u64::try_from(count)
            .map_err(|_| SpatialError::Limit)?
            .to_be_bytes(),
    );
    Ok(())
}
fn put_record(bytes: &mut Vec<u8>, record: &[u8]) -> Result<(), SpatialError> {
    put_count(bytes, record.len())?;
    bytes.extend_from_slice(record);
    Ok(())
}
struct Decoder<'a> {
    bytes: &'a [u8],
}
impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8]) -> Result<Self, SpatialError> {
        Ok(Self {
            bytes: bytes.strip_prefix(MAGIC).ok_or(SpatialError::Profile)?,
        })
    }
    fn take(&mut self, len: usize) -> Result<&'a [u8], SpatialError> {
        let (head, tail) = self
            .bytes
            .split_at_checked(len)
            .ok_or(SpatialError::Profile)?;
        self.bytes = tail;
        Ok(head)
    }
    fn number(&mut self) -> Result<u64, SpatialError> {
        Ok(u64::from_be_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| SpatialError::Profile)?,
        ))
    }
    fn count(&mut self, max: usize) -> Result<usize, SpatialError> {
        let count = usize::try_from(self.number()?).map_err(|_| SpatialError::Limit)?;
        if count > max {
            return Err(SpatialError::Limit);
        }
        Ok(count)
    }
    fn record(&mut self, max: usize) -> Result<&'a [u8], SpatialError> {
        let len = self.count(max)?;
        self.take(len)
    }
    fn envelope(&mut self) -> Result<SpatialEnvelope, SpatialError> {
        match self.take(1)? {
            [0] => Ok(SpatialEnvelope::Unbounded),
            [1] => {
                let mut values = [0.; 4];
                for value in &mut values {
                    *value = f64::from_bits(self.number()?);
                }
                if values.iter().any(|v| !v.is_finite() || v.abs() > 1e150)
                    || values[0] > values[2]
                    || values[1] > values[3]
                {
                    return Err(SpatialError::Profile);
                }
                Ok(SpatialEnvelope::Bounds {
                    lower: [values[0], values[1]],
                    upper: [values[2], values[3]],
                })
            }
            _ => Err(SpatialError::Profile),
        }
    }
    fn finish(self) -> Result<(), SpatialError> {
        if self.bytes.is_empty() {
            Ok(())
        } else {
            Err(SpatialError::Profile)
        }
    }
}
