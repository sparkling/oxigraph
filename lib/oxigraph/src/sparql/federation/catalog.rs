//! Versioned, immutable endpoint catalog attributing built-in HTTP `SERVICE` observations.
use super::{Counter, HttpServiceInvocationState};
use crate::model::NamedNode;
use std::collections::HashMap;
use std::error::Error;
use std::fmt;
use url::Url;

/// The largest number of endpoints one catalog may declare.
const MAXIMUM_CATALOG_ENDPOINTS: usize = 64;

/// The schema version of the catalog and its snapshot.
const CATALOG_SCHEMA_VERSION: u32 = 1;

/// One declared endpoint with optional declared evidence.
///
/// The declared expected rows and decoded bytes are caller declarations. They
/// are never derived from, compared with, or updated by actual counters, and
/// they make no freshness, health or capability claim. `Debug` redacts the
/// endpoint IRI.
#[derive(Clone)]
pub struct HttpServiceEndpointDeclaration {
    endpoint: NamedNode,
    expected_rows: Option<u64>,
    expected_decoded_bytes: Option<u64>,
}

impl HttpServiceEndpointDeclaration {
    /// Declares one endpoint, matched by exact IRI string.
    pub fn new(endpoint: NamedNode) -> Self {
        Self {
            endpoint,
            expected_rows: None,
            expected_decoded_bytes: None,
        }
    }

    /// Declares the caller's expected remote row count for this endpoint.
    #[must_use]
    pub fn with_expected_rows(mut self, rows: u64) -> Self {
        self.expected_rows = Some(rows);
        self
    }

    /// Declares the caller's expected decoded response bytes for this endpoint.
    #[must_use]
    pub fn with_expected_decoded_bytes(mut self, bytes: u64) -> Self {
        self.expected_decoded_bytes = Some(bytes);
        self
    }
}

impl fmt::Debug for HttpServiceEndpointDeclaration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpServiceEndpointDeclaration")
            .field("expected_rows", &self.expected_rows)
            .field("expected_decoded_bytes", &self.expected_decoded_bytes)
            .finish_non_exhaustive()
    }
}

/// A redacted error returned for an unsupported catalog declaration.
pub struct HttpServiceCatalogError {
    reason: &'static str,
}

impl HttpServiceCatalogError {
    const fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}

impl fmt::Debug for HttpServiceCatalogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpServiceCatalogError")
            .field("reason", &self.reason)
            .finish()
    }
}

impl fmt::Display for HttpServiceCatalogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid HTTP SERVICE catalog: {}", self.reason)
    }
}

impl Error for HttpServiceCatalogError {}

#[derive(Clone, Copy)]
struct DeclaredEvidence {
    expected_rows: Option<u64>,
    expected_decoded_bytes: Option<u64>,
}

/// An immutable catalog of at most 64 declared endpoints.
///
/// Endpoints receive `u16` ordinals in declaration order and match a `SERVICE`
/// name by exact IRI string: there is no normalization, redirect following,
/// DNS resolution or probing. Catalog membership neither authorizes egress nor
/// selects an endpoint; it only attributes actual observations. Duplicate and
/// credential-bearing endpoint IRIs are rejected. `Debug` and errors redact
/// every endpoint.
#[derive(Clone)]
pub struct HttpServiceCatalog {
    caller_epoch: Option<u64>,
    ordinals: HashMap<String, u16>,
    declared: Vec<DeclaredEvidence>,
}

impl HttpServiceCatalog {
    /// Builds a catalog from at most 64 endpoint declarations.
    pub fn new(
        endpoints: Vec<HttpServiceEndpointDeclaration>,
    ) -> Result<Self, HttpServiceCatalogError> {
        if endpoints.len() > MAXIMUM_CATALOG_ENDPOINTS {
            return Err(HttpServiceCatalogError::new(
                "at most 64 endpoints may be declared",
            ));
        }
        let mut ordinals = HashMap::with_capacity(endpoints.len());
        let mut declared = Vec::with_capacity(endpoints.len());
        for (index, declaration) in endpoints.iter().enumerate() {
            validate_endpoint(declaration.endpoint.as_str())?;
            let ordinal = u16::try_from(index)
                .map_err(|_| HttpServiceCatalogError::new("too many endpoints"))?;
            if ordinals
                .insert(declaration.endpoint.as_str().to_owned(), ordinal)
                .is_some()
            {
                return Err(HttpServiceCatalogError::new(
                    "an endpoint may be declared only once",
                ));
            }
            declared.push(DeclaredEvidence {
                expected_rows: declaration.expected_rows,
                expected_decoded_bytes: declaration.expected_decoded_bytes,
            });
        }
        Ok(Self {
            caller_epoch: None,
            ordinals,
            declared,
        })
    }

    /// Attaches an opaque caller epoch. It is echoed unchanged and carries no
    /// freshness meaning.
    #[must_use]
    pub fn with_caller_epoch(mut self, epoch: u64) -> Self {
        self.caller_epoch = Some(epoch);
        self
    }

    pub(super) fn ordinal_of(&self, endpoint: &str) -> Option<u16> {
        self.ordinals.get(endpoint).copied()
    }

    pub(super) fn endpoint_count(&self) -> usize {
        self.declared.len()
    }

    pub(super) fn snapshot(&self, counters: &CatalogCounters) -> HttpServiceCatalogSnapshot {
        let endpoints = self
            .declared
            .iter()
            .zip(&counters.by_ordinal)
            .enumerate()
            .map(
                |(index, (declared, actual))| HttpServiceEndpointObservation {
                    ordinal: u16::try_from(index).unwrap_or(u16::MAX),
                    declared_expected_rows: declared.expected_rows,
                    declared_expected_decoded_bytes: declared.expected_decoded_bytes,
                    actual: *actual,
                },
            )
            .collect();
        HttpServiceCatalogSnapshot {
            schema_version: CATALOG_SCHEMA_VERSION,
            caller_epoch: self.caller_epoch,
            endpoints,
            uncataloged: counters.uncataloged,
        }
    }
}

impl fmt::Debug for HttpServiceCatalog {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpServiceCatalog")
            .field("schema_version", &CATALOG_SCHEMA_VERSION)
            .field("endpoints", &self.declared.len())
            .field("caller_epoch", &self.caller_epoch)
            .finish_non_exhaustive()
    }
}

fn validate_endpoint(iri: &str) -> Result<(), HttpServiceCatalogError> {
    let url = Url::parse(iri)
        .map_err(|_| HttpServiceCatalogError::new("an endpoint must be an absolute URL"))?;
    if !url.username().is_empty() || url.password().is_some() || authority_has_userinfo(iri) {
        return Err(HttpServiceCatalogError::new(
            "an endpoint must not contain credentials",
        ));
    }
    Ok(())
}

fn authority_has_userinfo(iri: &str) -> bool {
    let Some((_, rest)) = iri.split_once("://") else {
        return false;
    };
    rest.split(['/', '?', '#'])
        .next()
        .is_some_and(|authority| authority.contains('@'))
}

/// Which counters one invocation feeds.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum EndpointSlot {
    Uncataloged,
    Endpoint(usize),
}

/// Actual counters of one cataloged endpoint, or of the fixed uncataloged
/// aggregate.
///
/// Each total saturates at `u64::MAX` with its own flag; the terminal totals
/// are bounded by the attempt total and share its flag. These are measurements
/// of what the built-in handler did, not endpoint health or capability.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct HttpServiceActualCounters {
    attempts: Counter,
    dispatches: Counter,
    decoded_bytes: Counter,
    rows: Counter,
    completed: Counter,
    failed: Counter,
    abandoned: Counter,
}

impl HttpServiceActualCounters {
    pub(super) fn record_attempt(&mut self) {
        self.attempts.add(1);
    }

    pub(super) fn record_dispatch(&mut self) {
        self.dispatches.add(1);
    }

    pub(super) fn record_decoded(&mut self, bytes: u64) {
        self.decoded_bytes.add(bytes);
    }

    pub(super) fn record_row(&mut self) {
        self.rows.add(1);
    }

    pub(super) fn record_terminal(&mut self, state: HttpServiceInvocationState) {
        match state {
            HttpServiceInvocationState::Completed => self.completed.add(1),
            HttpServiceInvocationState::Failed => self.failed.add(1),
            HttpServiceInvocationState::Abandoned => self.abandoned.add(1),
            HttpServiceInvocationState::InProgress => {}
        }
    }

    /// Logical attempts attributed here.
    #[inline]
    pub const fn attempts(&self) -> u64 {
        self.attempts.value
    }

    /// Whether the attempt total, and therefore the terminal totals, saturated.
    #[inline]
    pub const fn attempts_saturated(&self) -> bool {
        self.attempts.saturated
    }

    /// Admitted HTTP-client dispatches.
    #[inline]
    pub const fn dispatches(&self) -> u64 {
        self.dispatches.value
    }

    /// Whether the dispatch total saturated.
    #[inline]
    pub const fn dispatches_saturated(&self) -> bool {
        self.dispatches.saturated
    }

    /// Bytes delivered to the results parser.
    #[inline]
    pub const fn decoded_bytes(&self) -> u64 {
        self.decoded_bytes.value
    }

    /// Whether the decoded-byte total saturated.
    #[inline]
    pub const fn decoded_bytes_saturated(&self) -> bool {
        self.decoded_bytes.saturated
    }

    /// Solutions the remote results parser produced.
    #[inline]
    pub const fn rows(&self) -> u64 {
        self.rows.value
    }

    /// Whether the row total saturated.
    #[inline]
    pub const fn rows_saturated(&self) -> bool {
        self.rows.saturated
    }

    /// Invocations that reached EOF without a failure.
    #[inline]
    pub const fn completed(&self) -> u64 {
        self.completed.value
    }

    /// Invocations that failed, each counted once.
    #[inline]
    pub const fn failed(&self) -> u64 {
        self.failed.value
    }

    /// Invocations dropped before completion or an observed failure.
    #[inline]
    pub const fn abandoned(&self) -> u64 {
        self.abandoned.value
    }

    /// Invocations still observable when the snapshot was taken.
    #[inline]
    pub const fn in_progress(&self) -> u64 {
        self.attempts
            .value
            .saturating_sub(self.completed.value)
            .saturating_sub(self.failed.value)
            .saturating_sub(self.abandoned.value)
    }
}

/// Fixed-size counters allocated once at construction.
pub(super) struct CatalogCounters {
    by_ordinal: Vec<HttpServiceActualCounters>,
    uncataloged: HttpServiceActualCounters,
}

impl CatalogCounters {
    pub(super) fn new(endpoints: usize) -> Self {
        Self {
            by_ordinal: vec![HttpServiceActualCounters::default(); endpoints],
            uncataloged: HttpServiceActualCounters::default(),
        }
    }

    pub(super) fn counters_mut(
        &mut self,
        slot: EndpointSlot,
    ) -> Option<&mut HttpServiceActualCounters> {
        match slot {
            EndpointSlot::Uncataloged => Some(&mut self.uncataloged),
            EndpointSlot::Endpoint(index) => self.by_ordinal.get_mut(index),
        }
    }
}

/// One cataloged endpoint's declared evidence next to its actual counters.
///
/// The declaration fields are copied verbatim and are kept apart from the
/// actual counters. No IRI is retained here.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HttpServiceEndpointObservation {
    ordinal: u16,
    declared_expected_rows: Option<u64>,
    declared_expected_decoded_bytes: Option<u64>,
    actual: HttpServiceActualCounters,
}

impl HttpServiceEndpointObservation {
    /// The declaration ordinal of this endpoint.
    #[inline]
    pub const fn ordinal(&self) -> u16 {
        self.ordinal
    }

    /// The caller's declared expected rows, unchanged.
    #[inline]
    pub const fn declared_expected_rows(&self) -> Option<u64> {
        self.declared_expected_rows
    }

    /// The caller's declared expected decoded bytes, unchanged.
    #[inline]
    pub const fn declared_expected_decoded_bytes(&self) -> Option<u64> {
        self.declared_expected_decoded_bytes
    }

    /// The actual counters attributed to this endpoint.
    #[inline]
    pub const fn actual(&self) -> &HttpServiceActualCounters {
        &self.actual
    }
}

/// The catalog view of one observation snapshot.
///
/// It exposes the schema version, the opaque caller epoch, per-endpoint
/// ordinals with declared evidence and actual counters, and one fixed
/// aggregate for every endpoint the catalog does not list. It carries no IRI,
/// query text, RDF term or credential.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HttpServiceCatalogSnapshot {
    schema_version: u32,
    caller_epoch: Option<u64>,
    endpoints: Vec<HttpServiceEndpointObservation>,
    uncataloged: HttpServiceActualCounters,
}

impl HttpServiceCatalogSnapshot {
    /// The catalog schema version.
    #[inline]
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// The opaque caller epoch, if one was attached.
    #[inline]
    pub const fn caller_epoch(&self) -> Option<u64> {
        self.caller_epoch
    }

    /// Per-endpoint views, indexed by declaration ordinal.
    #[inline]
    pub fn endpoints(&self) -> &[HttpServiceEndpointObservation] {
        &self.endpoints
    }

    /// Counters of every invocation whose endpoint the catalog does not list.
    #[inline]
    pub const fn uncataloged(&self) -> &HttpServiceActualCounters {
        &self.uncataloged
    }
}
