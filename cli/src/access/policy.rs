use super::{
    AccessError, AccessGrant, AuthenticationMethod, Endpoint, GraphTarget, IDENTITY_HEADER,
    OperationKind, RequestAuthorizer, RequestIdentityProvider, RequestMetadata, RequestOperation,
    RequestPrincipal, bounded_name, unique_header,
};
use serde::Deserialize;
use std::fmt;
use std::fs::File;
use std::io::Read;
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
#[expect(
    clippy::field_scoped_visibility_modifiers,
    reason = "controller constructs fixed private policy errors"
)]
pub struct PolicyError(pub(super) &'static str);
impl fmt::Display for PolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "access policy rejected: {}", self.0)
    }
}
impl std::error::Error for PolicyError {}

#[expect(
    clippy::field_scoped_visibility_modifiers,
    reason = "only the parent admission controller can inspect the immutable policy; callers cannot mutate it"
)]
pub struct AccessPolicy {
    pub(super) id: String,
    pub(super) version: u64,
    pub(super) provider: Arc<dyn RequestIdentityProvider>,
    pub(super) authorizer: Arc<dyn RequestAuthorizer>,
    pub(super) workload_classes: Vec<String>,
    pub(super) anonymous_liveness: bool,
    pub(super) open: bool,
    pub(super) timeout: Duration,
    pub(super) proxy_version: Option<u64>,
}

impl AccessPolicy {
    /// Builds a source-compatible custom server policy. No network or storage
    /// handle is given to either extension, and no default allow is implied.
    pub fn new(
        id: String,
        version: u64,
        provider: Arc<dyn RequestIdentityProvider>,
        authorizer: Arc<dyn RequestAuthorizer>,
        workload_classes: Vec<String>,
        timeout: Duration,
    ) -> Result<Self, PolicyError> {
        if !bounded_name(&id, 64)
            || version == 0
            || workload_classes.is_empty()
            || workload_classes.len() > 16
            || workload_classes.iter().any(|name| !bounded_name(name, 32))
            || timeout.is_zero()
            || timeout > Duration::from_secs(1)
        {
            return Err(PolicyError(
                "invalid policy identity, workload classes or deadline",
            ));
        }
        Ok(Self {
            id,
            version,
            provider,
            authorizer,
            workload_classes,
            anonymous_liveness: false,
            open: false,
            timeout,
            proxy_version: None,
        })
    }

    pub fn anonymous() -> Self {
        Self {
            id: "anonymous".into(),
            version: 0,
            provider: Arc::new(Anonymous),
            authorizer: Arc::new(Anonymous),
            workload_classes: vec!["default".into()],
            anonymous_liveness: true,
            open: true,
            timeout: Duration::from_millis(100),
            proxy_version: None,
        }
    }

    pub fn load(path: &Path) -> Result<Self, PolicyError> {
        let metadata =
            std::fs::metadata(path).map_err(|_| PolicyError("policy file unavailable"))?;
        if !metadata.is_file() || metadata.len() > 64 * 1024 {
            return Err(PolicyError(
                "policy must be a regular file of at most 64 KiB",
            ));
        }
        let file = File::open(path).map_err(|_| PolicyError("policy file unavailable"))?;
        let mut bytes = Vec::new();
        file.take(64 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| PolicyError("policy file unreadable"))?;
        Self::from_json(&bytes)
    }

    pub fn from_json(bytes: &[u8]) -> Result<Self, PolicyError> {
        if bytes.len() > 64 * 1024 {
            return Err(PolicyError("policy exceeds 64 KiB"));
        }
        let config: Config = serde_json::from_slice(bytes)
            .map_err(|_| PolicyError("invalid policy JSON or fields"))?;
        if config.format != "oxigraph-access-v1" {
            return Err(PolicyError("unsupported policy format"));
        }
        config.proxy.validate()?;
        if config.rules.len() > 256 {
            return Err(PolicyError("too many rules"));
        }
        for rule in &config.rules {
            rule.validate(&config.workload_classes)?;
        }
        let proxy_version = config.proxy.version;
        let mut policy = Self::new(
            config.policy_id.clone(),
            config.version,
            Arc::new(config.proxy),
            Arc::new(Rules {
                policy_id: config.policy_id,
                rules: config.rules,
            }),
            config.workload_classes,
            Duration::from_millis(100),
        )?;
        if config.anonymous_liveness
            && !policy.workload_classes.iter().any(|name| name == "default")
        {
            return Err(PolicyError(
                "anonymous liveness requires the default workload class",
            ));
        }
        policy.anonymous_liveness = config.anonymous_liveness;
        policy.proxy_version = Some(proxy_version);
        Ok(policy)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    format: String,
    policy_id: String,
    version: u64,
    proxy: Proxy,
    #[serde(default)]
    anonymous_liveness: bool,
    workload_classes: Vec<String>,
    rules: Vec<Rule>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Proxy {
    peers: Vec<IpAddr>,
    issuer: String,
    audience: String,
    version: u64,
    max_lifetime_seconds: u64,
    #[serde(default)]
    clock_skew_seconds: u64,
}
impl Proxy {
    fn validate(&self) -> Result<(), PolicyError> {
        if self.peers.is_empty()
            || self.peers.len() > 32
            || self.peers.iter().any(|ip| {
                ip.is_unspecified()
                    || ip.is_multicast()
                    || matches!(ip, IpAddr::V6(ip) if ip.to_ipv4_mapped().is_some())
            })
        {
            return Err(PolicyError(
                "proxy peers must be exact, non-mapped numeric IPs",
            ));
        }
        if !bounded_name(&self.issuer, 128)
            || !bounded_name(&self.audience, 128)
            || self.version == 0
            || self.max_lifetime_seconds == 0
            || self.max_lifetime_seconds > 300
            || self.clock_skew_seconds > 30
        {
            return Err(PolicyError("invalid proxy identity or assertion lifetime"));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Assertion {
    scheme: String,
    subject: String,
    issuer: String,
    audience: String,
    proxy_version: u64,
    issued_at: u64,
    expires_at: u64,
}

impl RequestIdentityProvider for Proxy {
    fn authenticate(
        &self,
        request: RequestMetadata<'_>,
        now: u64,
        deadline: Instant,
    ) -> Result<RequestPrincipal, AccessError> {
        if Instant::now() >= deadline {
            return Err(AccessError::Deadline);
        }
        if !self.peers.contains(&request.connection.peer_addr().ip()) {
            return Err(AccessError::Unauthenticated);
        }
        let raw =
            unique_header(request.headers, IDENTITY_HEADER)?.ok_or(AccessError::Unauthenticated)?;
        if raw.len() > 2048 {
            return Err(AccessError::Unauthenticated);
        }
        let assertion: Assertion =
            serde_json::from_str(raw).map_err(|_| AccessError::Unauthenticated)?;
        if assertion.scheme != "oxigraph-proxy-v1"
            || assertion.issuer != self.issuer
            || assertion.audience != self.audience
            || assertion.proxy_version != self.version
        {
            return Err(AccessError::Unauthenticated);
        }
        let lifetime = assertion
            .expires_at
            .checked_sub(assertion.issued_at)
            .ok_or(AccessError::Expired)?;
        if lifetime == 0
            || lifetime > self.max_lifetime_seconds
            || assertion.expires_at <= now
            || assertion.issued_at
                > now
                    .checked_add(self.clock_skew_seconds)
                    .ok_or(AccessError::Provider)?
        {
            return Err(AccessError::Expired);
        }
        RequestPrincipal::authenticated(assertion.subject, AuthenticationMethod::TrustedProxy)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Rule {
    subject: String,
    endpoint: Endpoint,
    methods: Vec<String>,
    operations: Vec<OperationKind>,
    #[serde(default)]
    graphs: Vec<GraphPermission>,
    workload_class: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum GraphPermission {
    All,
    Dataset,
    DefaultGraph,
    NamedGraph { iri: String },
}

impl Rule {
    fn validate(&self, classes: &[String]) -> Result<(), PolicyError> {
        if !bounded_name(&self.subject, 128)
            || self.methods.is_empty()
            || self.methods.len() > 8
            || self.operations.is_empty()
            || self.operations.len() > 8
            || self.graphs.len() > 128
            || !classes.contains(&self.workload_class)
            || self.endpoint == Endpoint::Unknown
            || self.operations.contains(&OperationKind::Unknown)
            || self.methods.iter().any(|method| {
                !matches!(
                    method.as_str(),
                    "GET" | "HEAD" | "POST" | "QUERY" | "PUT" | "DELETE" | "OPTIONS" | "PATCH"
                )
            })
        {
            return Err(PolicyError("invalid access rule"));
        }
        if self.endpoint != Endpoint::GraphStore && !self.graphs.is_empty() {
            return Err(PolicyError(
                "graph selectors apply only to Graph Store, not SPARQL filtering",
            ));
        }
        for graph in &self.graphs {
            if let GraphPermission::NamedGraph { iri } = graph {
                if iri.len() > 2048 || oxigraph::model::NamedNodeRef::new(iri.as_str()).is_err() {
                    return Err(PolicyError("invalid graph permission IRI"));
                }
            }
        }
        Ok(())
    }

    fn matches(&self, principal: &RequestPrincipal, operation: &RequestOperation) -> bool {
        principal.subject() == Some(self.subject.as_str())
            && operation.endpoint == self.endpoint
            && self
                .methods
                .iter()
                .any(|method| method == operation.method.as_str())
            && operation.preflight_method.as_ref().is_none_or(|preflight| {
                self.methods
                    .iter()
                    .any(|method| method == preflight.as_str())
            })
            && operation
                .required
                .iter()
                .all(|kind| self.operations.contains(kind))
            && operation.graph.as_ref().is_none_or(|target| {
                self.graphs
                    .iter()
                    .any(|permission| match (permission, target) {
                        (GraphPermission::All, _)
                        | (GraphPermission::Dataset, GraphTarget::Dataset)
                        | (GraphPermission::DefaultGraph, GraphTarget::DefaultGraph) => true,
                        (GraphPermission::NamedGraph { iri }, GraphTarget::NamedGraph(graph)) => {
                            iri == graph.as_str()
                        }
                        _ => false,
                    })
            })
    }
}

struct Rules {
    policy_id: String,
    rules: Vec<Rule>,
}
impl RequestAuthorizer for Rules {
    fn authorize(
        &self,
        principal: &RequestPrincipal,
        operation: &RequestOperation,
        deadline: Instant,
    ) -> Result<AccessGrant, AccessError> {
        if Instant::now() >= deadline {
            return Err(AccessError::Deadline);
        }
        // One complete rule supplies one coherent grant. Never combine partial
        // query/update grants with conflicting workload classes.
        let rule = self
            .rules
            .iter()
            .find(|rule| rule.matches(principal, operation))
            .ok_or(AccessError::Denied)?;
        Ok(AccessGrant {
            policy_id: self.policy_id.clone(),
            workload_class: rule.workload_class.clone(),
        })
    }
}

struct Anonymous;
impl RequestIdentityProvider for Anonymous {
    fn authenticate(
        &self,
        _: RequestMetadata<'_>,
        _: u64,
        _: Instant,
    ) -> Result<RequestPrincipal, AccessError> {
        Ok(RequestPrincipal::anonymous())
    }
}
impl RequestAuthorizer for Anonymous {
    fn authorize(
        &self,
        _: &RequestPrincipal,
        _: &RequestOperation,
        _: Instant,
    ) -> Result<AccessGrant, AccessError> {
        Ok(AccessGrant {
            policy_id: "anonymous".into(),
            workload_class: "default".into(),
        })
    }
}
