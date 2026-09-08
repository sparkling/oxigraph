use oxhttp::model::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE};
use oxhttp::model::{Body, Method, Request, Response};
use spareval::CancellationToken;
use std::collections::HashSet;
use std::error::Error as StdError;
use std::fmt;
use std::io::{self, Read};
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use url::{Host, Url};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_RESPONSE_LIMIT: usize = 16 * 1024 * 1024;
const DEFAULT_CONCURRENT_REQUESTS: usize = 16;

/// The reason a governed outbound request failed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum EgressErrorKind {
    /// The destination or response transition was not authorized.
    PolicyDenied,
    /// The configured request deadline expired.
    Timeout,
    /// The owning SPARQL operation was cancelled.
    Cancelled,
    /// The encoded response exceeded its byte limit.
    EncodedResponseTooLarge,
    /// The decoded response exceeded its byte limit.
    DecodedResponseTooLarge,
    /// The shared outbound-request budget was exhausted.
    ConnectionBudgetExceeded,
    /// The remote exchange or response framing failed.
    RemoteFailure,
}

impl fmt::Display for EgressErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::PolicyDenied => "policy denied",
            Self::Timeout => "request timed out",
            Self::Cancelled => "request cancelled",
            Self::EncodedResponseTooLarge => "encoded response limit exceeded",
            Self::DecodedResponseTooLarge => "decoded response limit exceeded",
            Self::ConnectionBudgetExceeded => "connection budget exceeded",
            Self::RemoteFailure => "remote request failed",
        })
    }
}

/// The SPARQL retrieval path that initiated an outbound request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum EgressPurpose {
    /// A federated-query `SERVICE` request.
    Service,
    /// A SPARQL Update `LOAD` request.
    Load,
    /// A nested document request, such as a JSON-LD context.
    Document,
}

impl fmt::Display for EgressPurpose {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Service => "SERVICE",
            Self::Load => "LOAD",
            Self::Document => "document",
        })
    }
}

/// A typed, destination-redacted outbound-request error.
#[derive(Clone)]
pub struct EgressError {
    kind: EgressErrorKind,
    purpose: EgressPurpose,
    detail: Option<String>,
    source: Option<Arc<dyn StdError + Send + Sync + 'static>>,
}

impl EgressError {
    /// Returns the stable failure category.
    #[inline]
    pub const fn kind(&self) -> EgressErrorKind {
        self.kind
    }

    /// Returns the retrieval path that initiated the request.
    #[inline]
    pub const fn purpose(&self) -> EgressPurpose {
        self.purpose
    }
}

impl fmt::Debug for EgressError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EgressError")
            .field("kind", &self.kind)
            .field("purpose", &self.purpose)
            .finish_non_exhaustive()
    }
}

impl fmt::Display for EgressError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} egress request: {}", self.purpose, self.kind)?;
        if let Some(detail) = &self.detail {
            write!(f, " ({detail})")?;
        }
        Ok(())
    }
}

impl StdError for EgressError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self.source.as_deref() {
            Some(source) => Some(source),
            None => None,
        }
    }
}

impl From<EgressError> for io::Error {
    fn from(error: EgressError) -> Self {
        let kind = match error.kind {
            EgressErrorKind::Timeout => io::ErrorKind::TimedOut,
            EgressErrorKind::Cancelled => io::ErrorKind::Interrupted,
            EgressErrorKind::PolicyDenied => io::ErrorKind::PermissionDenied,
            EgressErrorKind::EncodedResponseTooLarge | EgressErrorKind::DecodedResponseTooLarge => {
                io::ErrorKind::InvalidData
            }
            EgressErrorKind::ConnectionBudgetExceeded => io::ErrorKind::WouldBlock,
            EgressErrorKind::RemoteFailure => io::ErrorKind::Other,
        };
        Self::new(kind, error)
    }
}

/// A redacted error returned for an unsafe egress-policy value.
pub struct EgressPolicyConfigurationError {
    reason: &'static str,
}

impl EgressPolicyConfigurationError {
    const fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}

impl fmt::Debug for EgressPolicyConfigurationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EgressPolicyConfigurationError")
            .field("reason", &self.reason)
            .finish()
    }
}

impl fmt::Display for EgressPolicyConfigurationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid egress policy: {}", self.reason)
    }
}

impl StdError for EgressPolicyConfigurationError {}

struct RequestBudget {
    maximum: usize,
    active: AtomicUsize,
}

impl RequestBudget {
    fn new(maximum: usize) -> Self {
        Self {
            maximum,
            active: AtomicUsize::new(0),
        }
    }

    fn acquire(self: &Arc<Self>) -> Option<RequestPermit> {
        let mut active = self.active.load(Ordering::Acquire);
        loop {
            if active >= self.maximum {
                return None;
            }
            match self.active.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    return Some(RequestPermit {
                        budget: Arc::clone(self),
                    });
                }
                Err(observed) => active = observed,
            }
        }
    }
}

struct RequestPermit {
    budget: Arc<RequestBudget>,
}

impl Drop for RequestPermit {
    fn drop(&mut self) {
        self.budget.active.fetch_sub(1, Ordering::AcqRel);
    }
}

/// A deny-by-default policy shared by `SERVICE`, `LOAD`, and nested documents.
///
/// Origins and IP addresses are conjunctive. This initial profile accepts only
/// literal-IP HTTP(S) origins, which makes authorization independent of DNS.
#[derive(Clone)]
pub struct EgressPolicy {
    origins: Arc<HashSet<String>>,
    ips: Arc<HashSet<IpAddr>>,
    timeout: Duration,
    encoded_response_limit: usize,
    decoded_response_limit: usize,
    budget: Arc<RequestBudget>,
}

impl EgressPolicy {
    /// Creates a bounded policy with no authorized destinations.
    pub fn deny_all() -> Self {
        Self {
            origins: Arc::new(HashSet::new()),
            ips: Arc::new(HashSet::new()),
            timeout: DEFAULT_TIMEOUT,
            encoded_response_limit: DEFAULT_RESPONSE_LIMIT,
            decoded_response_limit: DEFAULT_RESPONSE_LIMIT,
            budget: Arc::new(RequestBudget::new(DEFAULT_CONCURRENT_REQUESTS)),
        }
    }

    /// Adds one literal-IP HTTP(S) origin, without path, query, fragment, or credentials.
    pub fn allow_origin(mut self, origin: &str) -> Result<Self, EgressPolicyConfigurationError> {
        let (origin, _) = parse_origin(origin)?;
        Arc::make_mut(&mut self.origins).insert(origin);
        Ok(self)
    }

    /// Adds one IP address. A request must also match an allowed origin.
    #[must_use]
    pub fn allow_ip(mut self, ip: IpAddr) -> Self {
        Arc::make_mut(&mut self.ips).insert(ip);
        self
    }

    /// Sets the complete request deadline.
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Sets the maximum encoded response size declared by HTTP framing.
    #[must_use]
    pub fn with_encoded_response_limit(mut self, bytes: usize) -> Self {
        self.encoded_response_limit = bytes;
        self
    }

    /// Sets the maximum bytes exposed after HTTP content decoding.
    #[must_use]
    pub fn with_decoded_response_limit(mut self, bytes: usize) -> Self {
        self.decoded_response_limit = bytes;
        self
    }

    /// Sets the fail-fast request budget shared by all clones of this policy.
    pub fn with_max_concurrent_requests(
        mut self,
        maximum: usize,
    ) -> Result<Self, EgressPolicyConfigurationError> {
        if maximum == 0 {
            return Err(EgressPolicyConfigurationError::new(
                "the concurrent-request limit must be positive",
            ));
        }
        self.budget = Arc::new(RequestBudget::new(maximum));
        Ok(self)
    }

    fn authorize(&self, target: &str) -> Result<RequestPermit, EgressErrorKind> {
        let (origin, ip) = parse_request_target(target)?;
        if !self.origins.contains(&origin) || !self.ips.contains(&ip) {
            return Err(EgressErrorKind::PolicyDenied);
        }
        self.budget
            .acquire()
            .ok_or(EgressErrorKind::ConnectionBudgetExceeded)
    }

    pub(crate) fn allows_compiled_http_transport(&self) -> bool {
        self.origins.iter().any(|origin| {
            let Ok(url) = Url::parse(origin) else {
                return false;
            };
            let scheme_supported = match url.scheme() {
                "http" => true,
                "https" => cfg!(any(
                    feature = "http-client-native-tls",
                    feature = "http-client-rustls-native",
                    feature = "http-client-rustls-webpki"
                )),
                _ => false,
            };
            scheme_supported && literal_ip(&url).is_some_and(|ip| self.ips.contains(&ip))
        })
    }
}

impl Default for EgressPolicy {
    fn default() -> Self {
        Self::deny_all()
    }
}

impl fmt::Debug for EgressPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EgressPolicy")
            .field("allowed_origins", &self.origins.len())
            .field("allowed_ips", &self.ips.len())
            .field("timeout", &self.timeout)
            .field("encoded_response_limit", &self.encoded_response_limit)
            .field("decoded_response_limit", &self.decoded_response_limit)
            .field("max_concurrent_requests", &self.budget.maximum)
            .finish()
    }
}

fn parse_origin(value: &str) -> Result<(String, IpAddr), EgressPolicyConfigurationError> {
    let url = Url::parse(value)
        .map_err(|_| EgressPolicyConfigurationError::new("origin is not an absolute URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(EgressPolicyConfigurationError::new(
            "origin scheme must be HTTP or HTTPS",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(EgressPolicyConfigurationError::new(
            "origin credentials are forbidden",
        ));
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(EgressPolicyConfigurationError::new(
            "origin must not contain a path, query, or fragment",
        ));
    }
    let ip = literal_ip(&url).ok_or_else(|| {
        EgressPolicyConfigurationError::new("origin host must be a literal IP address")
    })?;
    Ok((url.origin().ascii_serialization(), ip))
}

fn parse_request_target(value: &str) -> Result<(String, IpAddr), EgressErrorKind> {
    let url = Url::parse(value).map_err(|_| EgressErrorKind::PolicyDenied)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(EgressErrorKind::PolicyDenied);
    }
    let ip = literal_ip(&url).ok_or(EgressErrorKind::PolicyDenied)?;
    Ok((url.origin().ascii_serialization(), ip))
}

fn literal_ip(url: &Url) -> Option<IpAddr> {
    match url.host()? {
        Host::Ipv4(ip) => Some(ip.into()),
        Host::Ipv6(ip) => Some(ip.into()),
        Host::Domain(_) => None,
    }
}

/// Finds the first typed egress failure in an error source chain.
pub(crate) fn find_egress_error<'a>(
    error: &'a (dyn StdError + 'static),
) -> Option<&'a EgressError> {
    let mut current = Some(error);
    while let Some(error) = current {
        if let Some(error) = error.downcast_ref::<EgressError>() {
            return Some(error);
        }
        current = error.source();
    }
    None
}

#[derive(Clone)]
struct RequestContext {
    policy: Option<EgressPolicy>,
    purpose: EgressPurpose,
    cancellation: Option<CancellationToken>,
    last_error: Arc<Mutex<Option<EgressError>>>,
    timeout: Option<Duration>,
    deadline: Option<Instant>,
    policy_metrics: Option<Arc<crate::store::policy_metrics::PolicyMetricsState>>,
    attempt_started: Option<Instant>,
}

impl RequestContext {
    fn for_request(&self) -> Self {
        let mut context = self.clone();
        context.attempt_started = Some(Instant::now());
        context.deadline = self
            .timeout
            .and_then(|timeout| Instant::now().checked_add(timeout));
        context
    }

    fn error(
        &self,
        kind: EgressErrorKind,
        source: Option<Box<dyn StdError + Send + Sync + 'static>>,
    ) -> EgressError {
        let error = EgressError {
            kind,
            purpose: self.purpose,
            detail: None,
            source: source.map(Arc::from),
        };
        self.record_error(&error);
        error
    }

    fn error_with_detail(&self, kind: EgressErrorKind, detail: String) -> EgressError {
        let error = EgressError {
            kind,
            purpose: self.purpose,
            detail: Some(detail),
            source: None,
        };
        self.record_error(&error);
        error
    }

    fn record_error(&self, error: &EgressError) {
        if error.kind == EgressErrorKind::PolicyDenied
            && let (Some(metrics), Some(started)) = (&self.policy_metrics, self.attempt_started)
        {
            metrics.deny(
                match self.purpose {
                    EgressPurpose::Service => crate::store::PolicyDenialPurpose::Service,
                    EgressPurpose::Load => crate::store::PolicyDenialPurpose::Load,
                    EgressPurpose::Document => crate::store::PolicyDenialPurpose::Document,
                },
                started.elapsed(),
            );
        }
        let mut slot = self
            .last_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = Some(error.clone());
    }

    fn ensure_alive(&self) -> Result<(), EgressError> {
        if self
            .cancellation
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
        {
            Err(self.error(EgressErrorKind::Cancelled, None))
        } else if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            Err(self.error(EgressErrorKind::Timeout, None))
        } else {
            Ok(())
        }
    }

    fn map_transport_error(&self, error: io::Error) -> EgressError {
        if let Err(error) = self.ensure_alive() {
            return error;
        }
        let kind = if matches!(
            error.kind(),
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
        ) {
            EgressErrorKind::Timeout
        } else if self.policy.is_some() && error.to_string().contains("too many redirects") {
            return self.error(EgressErrorKind::PolicyDenied, None);
        } else {
            EgressErrorKind::RemoteFailure
        };
        self.error(kind, Some(Box::new(error)))
    }
}

/// Internal HTTP client with an optional governed egress context.
#[derive(Clone)]
pub struct HttpClient {
    client: Arc<oxhttp::Client>,
    timeout: Option<Duration>,
    redirection_limit: usize,
    context: RequestContext,
}

impl HttpClient {
    pub fn new(timeout: Option<Duration>, redirection_limit: usize) -> Self {
        Self {
            client: Arc::new(build_client(timeout, redirection_limit)),
            timeout,
            redirection_limit,
            context: RequestContext {
                policy: None,
                purpose: EgressPurpose::Document,
                cancellation: None,
                last_error: Arc::new(Mutex::new(None)),
                timeout,
                deadline: None,
                policy_metrics: None,
                attempt_started: None,
            },
        }
    }

    pub(crate) fn with_egress(
        mut self,
        policy: Option<EgressPolicy>,
        purpose: EgressPurpose,
        cancellation: Option<CancellationToken>,
    ) -> Self {
        let effective_timeout = policy
            .as_ref()
            .map(|policy| {
                self.timeout
                    .map_or(policy.timeout, |timeout| timeout.min(policy.timeout))
            })
            .or(self.timeout);
        let redirection_limit = if policy.is_some() {
            0
        } else {
            self.redirection_limit
        };
        self.client = Arc::new(build_client(effective_timeout, redirection_limit));
        self.context.policy = policy;
        self.context.purpose = purpose;
        self.context.cancellation = cancellation;
        self.context.timeout = effective_timeout;
        self.context.deadline = None;
        self
    }

    pub(crate) fn for_purpose(&self, purpose: EgressPurpose) -> Self {
        let mut client = self.clone();
        client.context.purpose = purpose;
        client
    }

    pub(crate) fn with_policy_metrics(
        mut self,
        metrics: Arc<crate::store::policy_metrics::PolicyMetricsState>,
    ) -> Self {
        self.context.policy_metrics = Some(metrics);
        self
    }

    pub(crate) fn for_operation(&self) -> Self {
        let mut client = self.clone();
        client.context.last_error = Arc::new(Mutex::new(None));
        client
    }

    pub(crate) fn ensure_alive(&self) -> Result<(), EgressError> {
        self.context.ensure_alive()
    }

    pub(crate) fn validate_document_target(&self, target: &str) -> Result<(), EgressError> {
        self.context.ensure_alive()?;
        if self.context.policy.is_some() {
            let mut context = self.context.clone();
            context.attempt_started = Some(Instant::now());
            parse_request_target(target)
                .map(|_| ())
                .map_err(|kind| context.error(kind, None))?;
        }
        Ok(())
    }

    pub(crate) fn clear_recorded_error(&self) {
        let mut slot = self
            .context
            .last_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = None;
    }

    pub(crate) fn take_recorded_error(&self) -> Option<EgressError> {
        self.context
            .last_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
    }

    pub fn get(&self, url: &str, accept: &str) -> Result<(String, EgressBody), EgressError> {
        let context = self.context.for_request();
        context.ensure_alive()?;
        let permit = Self::authorize(&context, url)?;
        let request = Request::builder()
            .uri(url)
            .header(ACCEPT, accept)
            .body(())
            .map_err(|error| {
                let source = context.policy.is_none().then(|| boxed_error(error));
                context.error(EgressErrorKind::PolicyDenied, source)
            })?;
        self.send(request, permit, context)
    }

    pub fn post(
        &self,
        url: &str,
        payload: Vec<u8>,
        content_type: &str,
        accept: &str,
    ) -> Result<(String, EgressBody), EgressError> {
        let context = self.context.for_request();
        context.ensure_alive()?;
        let permit = Self::authorize(&context, url)?;
        let request = Request::builder()
            .method(Method::POST)
            .uri(url)
            .header(ACCEPT, accept)
            .header(CONTENT_TYPE, content_type)
            .body(payload)
            .map_err(|error| {
                let source = context.policy.is_none().then(|| boxed_error(error));
                context.error(EgressErrorKind::PolicyDenied, source)
            })?;
        self.send(request, permit, context)
    }

    fn authorize(
        context: &RequestContext,
        target: &str,
    ) -> Result<Option<RequestPermit>, EgressError> {
        context
            .policy
            .as_ref()
            .map(|policy| {
                policy
                    .authorize(target)
                    .map_err(|kind| context.error(kind, None))
            })
            .transpose()
    }

    fn send<B: Into<Body>>(
        &self,
        request: Request<B>,
        permit: Option<RequestPermit>,
        context: RequestContext,
    ) -> Result<(String, EgressBody), EgressError> {
        context.ensure_alive()?;
        let response = self
            .client
            .request(request)
            .map_err(|error| context.map_transport_error(error))?;
        context.ensure_alive()?;
        Self::response(response, permit, context)
    }

    fn response(
        response: Response<Body>,
        permit: Option<RequestPermit>,
        context: RequestContext,
    ) -> Result<(String, EgressBody), EgressError> {
        let status = response.status();
        if !status.is_success() {
            return if context.policy.is_some() {
                let kind = if status.is_redirection() {
                    EgressErrorKind::PolicyDenied
                } else {
                    EgressErrorKind::RemoteFailure
                };
                Err(context.error(kind, None))
            } else {
                Err(context.error_with_detail(
                    EgressErrorKind::RemoteFailure,
                    format!("HTTP status {status}"),
                ))
            };
        }
        if let Some(policy) = &context.policy {
            let length = response
                .headers()
                .get(CONTENT_LENGTH)
                .ok_or_else(|| context.error(EgressErrorKind::RemoteFailure, None))?
                .to_str()
                .map_err(|error| {
                    context.error(EgressErrorKind::RemoteFailure, Some(Box::new(error)))
                })?
                .parse::<u64>()
                .map_err(|error| {
                    context.error(EgressErrorKind::RemoteFailure, Some(Box::new(error)))
                })?;
            if length > u64::try_from(policy.encoded_response_limit).unwrap_or(u64::MAX) {
                return Err(context.error(EgressErrorKind::EncodedResponseTooLarge, None));
            }
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .ok_or_else(|| context.error(EgressErrorKind::RemoteFailure, None))?
            .to_str()
            .map_err(|error| context.error(EgressErrorKind::RemoteFailure, Some(Box::new(error))))?
            .to_owned();
        Ok((
            content_type,
            EgressBody {
                body: response.into_body(),
                context,
                decoded: 0,
                permit,
            },
        ))
    }
}

#[expect(
    clippy::expect_used,
    reason = "the compile-time Oxigraph user-agent literal is valid"
)]
fn build_client(timeout: Option<Duration>, redirection_limit: usize) -> oxhttp::Client {
    let mut client = oxhttp::Client::new()
        .with_redirection_limit(redirection_limit)
        .with_user_agent(concat!("Oxigraph/", env!("CARGO_PKG_VERSION")))
        .expect("the static Oxigraph user agent is valid");
    if let Some(timeout) = timeout {
        client = client.with_global_timeout(timeout);
    }
    client
}

fn boxed_error(
    error: impl StdError + Send + Sync + 'static,
) -> Box<dyn StdError + Send + Sync + 'static> {
    Box::new(error)
}

/// A response body that retains request admission and enforces decoded limits.
pub struct EgressBody {
    body: Body,
    context: RequestContext,
    decoded: usize,
    permit: Option<RequestPermit>,
}

impl EgressBody {
    fn finish(&mut self) {
        self.body = Body::empty();
        self.permit.take();
    }
}

impl Read for EgressBody {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        if let Err(error) = self.context.ensure_alive() {
            self.finish();
            return Err(error.into());
        }
        let allowed = if let Some(policy) = &self.context.policy {
            let remaining = policy.decoded_response_limit.saturating_sub(self.decoded);
            buf.len().min(remaining.saturating_add(1))
        } else {
            buf.len()
        };
        let read = match self.body.read(&mut buf[..allowed]) {
            Ok(read) => read,
            Err(error) => {
                let error = self.context.map_transport_error(error);
                self.finish();
                return Err(error.into());
            }
        };
        if let Err(error) = self.context.ensure_alive() {
            self.finish();
            return Err(error.into());
        }
        if let Some(policy) = &self.context.policy {
            if read > policy.decoded_response_limit.saturating_sub(self.decoded) {
                let error = self
                    .context
                    .error(EgressErrorKind::DecodedResponseTooLarge, None);
                self.finish();
                return Err(error.into());
            }
        }
        self.decoded = self.decoded.saturating_add(read);
        if read == 0 {
            self.finish();
        }
        Ok(read)
    }
}
