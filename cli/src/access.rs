//! ADR-0026: request identity, whole-operation authorization and bounded audit.
//! Authentication has no access to request bodies, storage or an egress client.
mod operation;
mod policy;
pub mod target;
#[cfg(test)]
mod tests;

pub use operation::{Endpoint, ListenerKind, OperationKind, RequestOperation};
pub use policy::{AccessPolicy, PolicyError};
pub use target::GraphTarget;

use oxhttp::ConnectionInfo;
use oxhttp::model::header::{
    AUTHORIZATION, CACHE_CONTROL, COOKIE, PROXY_AUTHORIZATION, WWW_AUTHENTICATE,
};
use oxhttp::model::request::Builder;
use oxhttp::model::{Body, Extensions, HeaderMap, Method, Request, Response, StatusCode, Uri};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const IDENTITY_HEADER: &str = "oxigraph-identity";
const AUDIT_CAPACITY: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthenticationMethod {
    Anonymous,
    TrustedProxy,
    Custom,
}

/// An opaque, bounded identity. Debug output deliberately omits the subject.
#[derive(Clone)]
pub struct RequestPrincipal {
    subject: Option<String>,
    method: AuthenticationMethod,
}

impl RequestPrincipal {
    pub fn anonymous() -> Self {
        Self {
            subject: None,
            method: AuthenticationMethod::Anonymous,
        }
    }
    pub fn authenticated(
        subject: String,
        method: AuthenticationMethod,
    ) -> Result<Self, AccessError> {
        if method == AuthenticationMethod::Anonymous || !bounded_name(&subject, 128) {
            return Err(AccessError::Provider);
        }
        Ok(Self {
            subject: Some(subject),
            method,
        })
    }
    pub fn subject(&self) -> Option<&str> {
        self.subject.as_deref()
    }
    pub fn method(&self) -> AuthenticationMethod {
        self.method
    }
}
impl fmt::Debug for RequestPrincipal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RequestPrincipal")
            .field("method", &self.method)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy)]
pub struct RequestMetadata<'a> {
    pub uri: &'a Uri,
    pub method: &'a Method,
    pub headers: &'a HeaderMap,
    pub connection: ConnectionInfo,
}

/// Implementations must perform bounded metadata-only work and honor the deadline.
/// The controller also rejects a result returned after it. It cannot preempt
/// arbitrary blocking custom code; native providers perform no I/O here.
pub trait RequestIdentityProvider: Send + Sync {
    fn authenticate(
        &self,
        request: RequestMetadata<'_>,
        now: u64,
        deadline: Instant,
    ) -> Result<RequestPrincipal, AccessError>;
}

/// Returns one decision for the entire operation, including all possible actions
/// in an ambiguous form request. It must not inspect RDF data or rewrite queries.
pub trait RequestAuthorizer: Send + Sync {
    fn authorize(
        &self,
        principal: &RequestPrincipal,
        operation: &RequestOperation,
        deadline: Instant,
    ) -> Result<AccessGrant, AccessError>;
}

#[derive(Clone, Debug)]
pub struct AccessGrant {
    pub policy_id: String,
    pub workload_class: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccessError {
    Unauthenticated,
    Expired,
    Provider,
    Deadline,
    Denied,
    Policy,
}
impl fmt::Display for AccessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unauthenticated => "unauthenticated",
            Self::Expired => "expired",
            Self::Provider => "identity-provider-error",
            Self::Deadline => "admission-deadline",
            Self::Denied => "access-denied",
            Self::Policy => "policy-unavailable",
        })
    }
}
impl std::error::Error for AccessError {}

#[derive(Clone)]
pub struct RequestContext {
    principal: RequestPrincipal,
    operation: RequestOperation,
    grant: AccessGrant,
    policy: Arc<AccessPolicy>,
    request_id: String,
}
impl RequestContext {
    pub fn principal(&self) -> &RequestPrincipal {
        &self.principal
    }
    pub fn operation(&self) -> &RequestOperation {
        &self.operation
    }
    pub fn grant(&self) -> &AccessGrant {
        &self.grant
    }
    pub fn policy_version(&self) -> u64 {
        self.policy.version
    }
    pub fn request_id(&self) -> &str {
        &self.request_id
    }
}
impl fmt::Debug for RequestContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RequestContext")
            .field("policy_version", &self.policy.version)
            .finish_non_exhaustive()
    }
}

/// Fixed-shape audit: no raw subjects, headers, URLs, queries or graph selectors.
#[derive(Clone, Debug, Serialize)]
pub struct AuditEvent {
    pub request_id: String,
    pub principal_ref: Option<String>,
    pub policy_id: String,
    pub policy_version: u64,
    pub endpoint: Endpoint,
    pub operations: Vec<OperationKind>,
    pub allowed: bool,
    pub reason: Option<AccessError>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuditSnapshot {
    pub events: Vec<AuditEvent>,
    pub overwritten: u64,
}
#[derive(Default)]
struct AuditLog {
    events: VecDeque<AuditEvent>,
    overwritten: u64,
}

/// An immutable per-request policy with an atomic, explicitly requested reload.
/// This is server state, not dataset state or an authentication service.
pub struct AccessController {
    policy: RwLock<Arc<AccessPolicy>>,
    source: Option<PathBuf>,
    audit: Mutex<AuditLog>,
    salt: [u8; 32],
    read_only: bool,
}

impl AccessController {
    /// Configured labels only; no principal or rule information is exposed.
    pub fn workload_classes(&self) -> Result<Vec<String>, AccessError> {
        self.policy
            .read()
            .map(|policy| policy.workload_classes.clone())
            .map_err(|_| AccessError::Provider)
    }

    /// Runs a bounded local check while retaining one coherent access-policy
    /// read guard. Callers must not invoke an access-policy write while the
    /// callback runs. ADR-0027 uses this access-before-workload lock order for
    /// its atomic cross-policy validation and swap.
    pub(crate) fn with_workload_classes<T>(
        &self,
        check: impl FnOnce(&[String]) -> T,
    ) -> Result<T, AccessError> {
        let policy = self.policy.read().map_err(|_| AccessError::Provider)?;
        Ok(check(&policy.workload_classes))
    }

    pub fn new(policy: AccessPolicy, read_only: bool) -> Self {
        Self {
            policy: RwLock::new(Arc::new(policy)),
            source: None,
            audit: Mutex::new(AuditLog::default()),
            salt: rand::random(),
            read_only,
        }
    }

    /// Validates the policy file before the caller opens a store or listeners.
    pub fn from_file(path: &Path, read_only: bool) -> Result<Self, PolicyError> {
        let mut controller = Self::new(AccessPolicy::load(path)?, read_only);
        controller.source = Some(path.to_owned());
        Ok(controller)
    }

    pub fn anonymous(read_only: bool) -> Self {
        Self::new(AccessPolicy::anonymous(), read_only)
    }

    /// True only for a validated trusted-proxy file profile, never an open file.
    pub fn is_proxy_profile(&self) -> bool {
        self.source.is_some()
    }

    pub fn admit(
        &self,
        head: &Builder,
        connection: ConnectionInfo,
        listener: ListenerKind,
    ) -> Result<Extensions, Box<Response<Body>>> {
        self.admit_inner(head, connection, listener)
            .map_err(|error| Box::new(denial(error)))
    }

    fn admit_inner(
        &self,
        head: &Builder,
        connection: ConnectionInfo,
        listener: ListenerKind,
    ) -> Result<Extensions, AccessError> {
        let policy = Arc::clone(&*self.policy.read().map_err(|_| AccessError::Policy)?);
        let deadline = Instant::now() + policy.timeout;
        let request_id = format!("{:032x}", rand::random::<u128>());
        let metadata = RequestMetadata {
            uri: head.uri_ref().ok_or(AccessError::Unauthenticated)?,
            method: head.method_ref().ok_or(AccessError::Unauthenticated)?,
            headers: head.headers_ref().ok_or(AccessError::Unauthenticated)?,
            connection,
        };
        let mut principal = None;
        let mut operation = None;
        let decision = (|| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| AccessError::Provider)?
                .as_secs();
            let liveness = policy.anonymous_liveness
                && listener == ListenerKind::Operator
                && metadata.uri.path() == "/health"
                && metadata.uri.query().is_none()
                && matches!(metadata.method.as_str(), "GET" | "HEAD");
            principal = Some(if liveness {
                RequestPrincipal::anonymous()
            } else {
                policy
                    .provider
                    .authenticate(metadata, now, deadline)
                    .map_err(|error| match error {
                        // A provider has not established identity on an error.
                        // Only the post-authentication decision may return 403.
                        AccessError::Denied => AccessError::Provider,
                        other => other,
                    })?
            });
            if Instant::now() >= deadline {
                return Err(AccessError::Deadline);
            }
            operation = Some(
                match RequestOperation::classify(
                    metadata.uri,
                    metadata.method,
                    metadata.headers,
                    listener,
                ) {
                    Ok(value) => value,
                    Err(_) if policy.open => RequestOperation {
                        endpoint: Endpoint::Unknown,
                        method: metadata.method.clone(),
                        preflight_method: None,
                        required: vec![OperationKind::Unknown],
                        graph: None,
                    },
                    Err(_) => return Err(AccessError::Denied),
                },
            );
            let operation = operation.as_ref().ok_or(AccessError::Policy)?;
            if self.read_only && !policy.open && operation.is_write() {
                return Err(AccessError::Denied);
            }
            let grant = if liveness {
                AccessGrant {
                    policy_id: policy.id.clone(),
                    workload_class: "default".into(),
                }
            } else {
                policy.authorizer.authorize(
                    principal.as_ref().ok_or(AccessError::Provider)?,
                    operation,
                    deadline,
                )?
            };
            if Instant::now() >= deadline {
                return Err(AccessError::Deadline);
            }
            if grant.policy_id != policy.id
                || !policy.workload_classes.contains(&grant.workload_class)
            {
                return Err(AccessError::Policy);
            }
            Ok(grant)
        })();
        let principal_ref = principal
            .as_ref()
            .and_then(RequestPrincipal::subject)
            .map(|subject| {
                let mut hash = Sha256::new();
                hash.update(self.salt);
                hash.update(b"oxigraph-admission-principal-v1");
                hash.update(policy.id.as_bytes());
                hash.update([0]);
                hash.update(policy.version.to_be_bytes());
                hash.update(subject.as_bytes());
                let mut digest_prefix = [0; 16];
                digest_prefix.copy_from_slice(&hash.finalize()[..16]);
                format!("{:032x}", u128::from_be_bytes(digest_prefix))
            });
        let event = AuditEvent {
            request_id: request_id.clone(),
            principal_ref,
            policy_id: policy.id.clone(),
            policy_version: policy.version,
            endpoint: operation
                .as_ref()
                .map_or(Endpoint::Unknown, |operation| operation.endpoint),
            operations: operation.as_ref().map_or_else(
                || vec![OperationKind::Unknown],
                |operation| operation.required.clone(),
            ),
            allowed: decision.is_ok(),
            reason: decision.as_ref().err().copied(),
        };
        let mut audit = self.audit.lock().map_err(|_| AccessError::Policy)?;
        if audit.events.len() == AUDIT_CAPACITY {
            audit.events.pop_front();
            audit.overwritten = audit.overwritten.saturating_add(1);
        }
        audit.events.push_back(event);
        drop(audit);
        let grant = decision?;
        let mut extensions = Extensions::new();
        extensions.insert(RequestContext {
            principal: principal.ok_or(AccessError::Provider)?,
            operation: operation.ok_or(AccessError::Policy)?,
            grant,
            policy,
            request_id,
        });
        Ok(extensions)
    }

    /// Call before CORS and application routing. A missing admission context fails closed.
    pub fn prepare_request(request: &mut Request<Body>) -> Result<(), AccessError> {
        let names = request
            .headers()
            .keys()
            .filter(|name| {
                **name == AUTHORIZATION
                    || **name == PROXY_AUTHORIZATION
                    || **name == COOKIE
                    || name.as_str() == IDENTITY_HEADER
                    || name.as_str() == "forwarded"
                    || name.as_str().starts_with("x-forwarded-")
            })
            .cloned()
            .collect::<Vec<_>>();
        for name in names {
            request.headers_mut().remove(name);
        }
        if request.extensions().get::<RequestContext>().is_none() {
            return Err(AccessError::Unauthenticated);
        }
        Ok(())
    }

    /// Only call this after an explicit operator authorization decision.
    /// Invalid/stale replacements leave the last good snapshot intact.
    pub fn reload(&self) -> Result<u64, PolicyError> {
        let path = self
            .source
            .as_ref()
            .ok_or(PolicyError("reload requires a policy file"))?;
        let candidate = Arc::new(AccessPolicy::load(path)?);
        let mut current = self
            .policy
            .write()
            .map_err(|_| PolicyError("policy lock unavailable"))?;
        if candidate.id != current.id
            || candidate.version <= current.version
            || candidate.proxy_version <= current.proxy_version
        {
            return Err(PolicyError(
                "reload requires the same policy ID and newer policy/proxy versions",
            ));
        }
        let version = candidate.version;
        *current = candidate;
        Ok(version)
    }

    /// Local trusted caller/authorized operator API, not a public data-plane route.
    pub fn audit_snapshot(&self) -> Result<AuditSnapshot, AccessError> {
        let audit = self.audit.lock().map_err(|_| AccessError::Policy)?;
        Ok(AuditSnapshot {
            events: audit.events.iter().cloned().collect(),
            overwritten: audit.overwritten,
        })
    }
}

pub fn denial(error: AccessError) -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = if error == AccessError::Denied {
        StatusCode::FORBIDDEN
    } else {
        StatusCode::UNAUTHORIZED
    };
    response.headers_mut().insert(
        CACHE_CONTROL,
        oxhttp::model::HeaderValue::from_static("no-store"),
    );
    if response.status() == StatusCode::UNAUTHORIZED {
        response.headers_mut().insert(
            WWW_AUTHENTICATE,
            oxhttp::model::HeaderValue::from_static("OxigraphProxy realm=\"oxigraph\""),
        );
    }
    response
}

fn unique_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, AccessError> {
    let mut values = headers.get_all(name).iter();
    let first = values.next();
    if values.next().is_some() {
        return Err(AccessError::Unauthenticated);
    }
    first
        .map(|v| v.to_str().map_err(|_| AccessError::Unauthenticated))
        .transpose()
}

fn bounded_name(value: &str, limit: usize) -> bool {
    !value.is_empty()
        && value.len() <= limit
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-:@/".contains(&b))
}
