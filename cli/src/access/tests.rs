//! Independent native ADR-0026 acceptance cases. No production implementation.
use super::*;
use anyhow::{Result, ensure};
use oxhttp::Server;
use serde_json::json;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::mpsc;
use std::time::Duration;

const METHODS: [&str; 9] = [
    "GET", "HEAD", "POST", "QUERY", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE",
];

struct FailedProvider(AccessError);
impl RequestIdentityProvider for FailedProvider {
    fn authenticate(
        &self,
        _: RequestMetadata<'_>,
        _: u64,
        _: Instant,
    ) -> Result<RequestPrincipal, AccessError> {
        Err(self.0)
    }
}
struct CountAuthorizer(Arc<std::sync::atomic::AtomicUsize>);
impl RequestAuthorizer for CountAuthorizer {
    fn authorize(
        &self,
        _: &RequestPrincipal,
        _: &RequestOperation,
        _: Instant,
    ) -> Result<AccessGrant, AccessError> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Err(AccessError::Denied)
    }
}

#[test]
fn failed_providers_stop_every_route_before_authorization() -> Result<()> {
    let socket = connection()?;
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    for failure in [
        AccessError::Unauthenticated,
        AccessError::Expired,
        AccessError::Provider,
        AccessError::Deadline,
    ] {
        let controller = AccessController::new(
            AccessPolicy::new(
                "error-profile".into(),
                1,
                Arc::new(FailedProvider(failure)),
                Arc::new(CountAuthorizer(Arc::clone(&calls))),
                vec!["default".into()],
                Duration::from_secs(1),
            )?,
            false,
        );
        for (path, listener) in [
            ("/", ListenerKind::Data),
            ("/yasgui.min.css", ListenerKind::Data),
            ("/yasgui.min.js", ListenerKind::Data),
            ("/logo.svg", ListenerKind::Data),
            ("/query", ListenerKind::Data),
            ("/update", ListenerKind::Data),
            ("/sparql", ListenerKind::Data),
            ("/store", ListenerKind::Data),
            ("/store/direct", ListenerKind::Data),
            ("/store?graph=urn:a&default", ListenerKind::Data),
            ("/health", ListenerKind::Operator),
            ("/ready", ListenerKind::Operator),
            ("/metrics", ListenerKind::Operator),
            ("/access/audit", ListenerKind::Operator),
            ("/access/policy/reload", ListenerKind::Operator),
            ("/absent", ListenerKind::Data),
        ] {
            for method in METHODS {
                let head = Request::builder()
                    .method(method)
                    .uri(format!("http://localhost{path}"))
                    .header("expect", "100-continue")
                    .header("content-length", "999999999");
                let rejected = controller
                    .admit(&head, socket, listener)
                    .err()
                    .ok_or_else(|| anyhow::anyhow!("failed provider allowed {method} {path}"))?;
                ensure!(
                    rejected.status() == StatusCode::UNAUTHORIZED
                        && rejected.body().len() == Some(0)
                );
                ensure!(
                    rejected
                        .headers()
                        .get(CACHE_CONTROL)
                        .is_some_and(|value| value == "no-store")
                );
            }
        }
    }
    ensure!(
        calls.load(std::sync::atomic::Ordering::SeqCst) == 0,
        "provider failure reached authorizer"
    );
    Ok(())
}

#[test]
fn partial_permissions_do_not_combine_for_forms_or_preflights() -> Result<()> {
    let base: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../tests/fixtures/access-policy-v1.json"))?;
    let principal = authenticate(&policy()?, connection()?, "allowed", 1000, 1000, 1060)?;
    let mut headers = HeaderMap::new();
    headers.insert("content-type", "application/x-www-form-urlencoded".parse()?);
    headers.insert("access-control-request-method", "POST".parse()?);
    let uri = Uri::from_static("http://localhost/sparql");
    let form = RequestOperation::classify(&uri, &Method::POST, &headers, ListenerKind::Data)?;
    let preflight =
        RequestOperation::classify(&uri, &Method::OPTIONS, &headers, ListenerKind::Data)?;
    let mut split = base.clone();
    split["rules"] = json!([
        {"subject":"allowed","endpoint":"sparql","methods":["POST","OPTIONS"],"operations":["query"],"workload_class":"default"},
        {"subject":"allowed","endpoint":"sparql","methods":["POST","OPTIONS"],"operations":["update"],"workload_class":"default"}
    ]);
    let split = AccessPolicy::from_json(&serde_json::to_vec(&split)?)?;
    for operation in [&form, &preflight] {
        ensure!(matches!(
            split.authorizer.authorize(
                &principal,
                operation,
                Instant::now() + Duration::from_secs(1)
            ),
            Err(AccessError::Denied)
        ));
    }
    for method in ["POST", "OPTIONS"] {
        let mut partial = base.clone();
        partial["rules"] = json!([{"subject":"allowed","endpoint":"sparql","methods":[method],"operations":["query","update"],"workload_class":"default"}]);
        let partial = AccessPolicy::from_json(&serde_json::to_vec(&partial)?)?;
        ensure!(matches!(
            partial.authorizer.authorize(
                &principal,
                &preflight,
                Instant::now() + Duration::from_secs(1)
            ),
            Err(AccessError::Denied)
        ));
    }
    Ok(())
}

// Obtain actual immutable socket provenance through the public transport hook;
// do not add a test-only way to forge ConnectionInfo in the product API.
fn connection() -> Result<ConnectionInfo> {
    let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let address = reservation.local_addr()?;
    drop(reservation);
    let (send, receive) = mpsc::sync_channel(1);
    let _server = Server::new(|_| Response::new(Body::empty()))
        .with_request_admission(move |_, socket| {
            send.send(socket)
                .map_err(|_| Box::new(denial(AccessError::Policy)))?;
            Err(Box::new(denial(AccessError::Unauthenticated)))
        })
        .bind(address)
        .with_global_timeout(Duration::from_secs(2))
        .spawn()?;
    let mut stream = TcpStream::connect(address)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
    let socket = receive.recv_timeout(Duration::from_secs(3))?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    ensure!(response.starts_with("HTTP/1.1 401"));
    Ok(socket)
}

fn policy() -> Result<AccessPolicy> {
    Ok(AccessPolicy::from_json(include_bytes!(
        "../../tests/fixtures/access-policy-v1.json"
    ))?)
}

fn authenticate(
    policy: &AccessPolicy,
    socket: ConnectionInfo,
    subject: &str,
    now: u64,
    issued: u64,
    expires: u64,
) -> Result<RequestPrincipal, AccessError> {
    let uri = Uri::from_static("http://localhost/query");
    let mut headers = HeaderMap::new();
    let assertion = json!({"scheme":"oxigraph-proxy-v1","subject":subject,"issuer":"acceptance-edge","audience":"acceptance-store","proxy_version":1,"issued_at":issued,"expires_at":expires});
    headers.insert(
        IDENTITY_HEADER,
        oxhttp::model::HeaderValue::from_str(&assertion.to_string())
            .map_err(|_| AccessError::Provider)?,
    );
    policy.provider.authenticate(
        RequestMetadata {
            uri: &uri,
            method: &Method::GET,
            headers: &headers,
            connection: socket,
        },
        now,
        Instant::now() + Duration::from_secs(1),
    )
}

#[test]
fn exact_identity_time_boundaries() -> Result<()> {
    let policy = policy()?;
    let socket = connection()?;
    // Fixed provider clock: no sleep, truncation race or mock authentication.
    for (now, issued, expires, allowed) in [
        (1000, 1000, 1060, true), // inclusive maximum lifetime
        (1000, 1000, 1061, false),
        (1000, 1005, 1065, true), // inclusive configured skew
        (1000, 1006, 1066, false),
        (1000, 940, 1000, false), // exclusive expiry
        (1000, 941, 1001, true),
        (1000, 1000, 1000, false),
        (1000, 1001, 1000, false), // subtraction underflow
        (u64::MAX - 1, u64::MAX - 1, u64::MAX, false), // skew addition overflow
    ] {
        ensure!(
            authenticate(&policy, socket, "allowed", now, issued, expires).is_ok() == allowed,
            "clock case now={now} issued={issued} expires={expires}"
        );
    }
    Ok(())
}

#[test]
fn every_route_and_method_has_a_complete_authenticated_decision() -> Result<()> {
    use Endpoint as E;
    use OperationKind as K;
    let policy = policy()?;
    let socket = connection()?;
    let allowed = authenticate(&policy, socket, "allowed", 1000, 1000, 1060)?;
    let denied = authenticate(&policy, socket, "denied", 1000, 1000, 1060)?;
    // Expected dispatch is literal test input, not derived from the classifier.
    let routes: &[(&str, ListenerKind, E, &[(&str, K)])] = &[
        (
            "/",
            ListenerKind::Data,
            E::Ui,
            &[("GET", K::Discovery), ("HEAD", K::Discovery)],
        ),
        (
            "/yasgui.min.css",
            ListenerKind::Data,
            E::Ui,
            &[("GET", K::Discovery), ("HEAD", K::Discovery)],
        ),
        (
            "/yasgui.min.js",
            ListenerKind::Data,
            E::Ui,
            &[("GET", K::Discovery), ("HEAD", K::Discovery)],
        ),
        (
            "/logo.svg",
            ListenerKind::Data,
            E::Ui,
            &[("GET", K::Discovery), ("HEAD", K::Discovery)],
        ),
        (
            "/query",
            ListenerKind::Data,
            E::Query,
            &[
                ("GET", K::Discovery),
                ("POST", K::Query),
                ("QUERY", K::Query),
            ],
        ),
        (
            "/query?query=ASK%7B%7D",
            ListenerKind::Data,
            E::Query,
            &[("GET", K::Query), ("POST", K::Query), ("QUERY", K::Query)],
        ),
        (
            "/update",
            ListenerKind::Data,
            E::Update,
            &[("GET", K::Discovery), ("POST", K::Update)],
        ),
        (
            "/sparql",
            ListenerKind::Data,
            E::Sparql,
            &[
                ("GET", K::Discovery),
                ("POST", K::Query),
                ("QUERY", K::Query),
            ],
        ),
        (
            "/sparql?query=ASK%7B%7D",
            ListenerKind::Data,
            E::Sparql,
            &[("GET", K::Query), ("POST", K::Query), ("QUERY", K::Query)],
        ),
        (
            "/store",
            ListenerKind::Data,
            E::GraphStore,
            &[
                ("GET", K::GraphRead),
                ("HEAD", K::GraphRead),
                ("POST", K::GraphWrite),
                ("PUT", K::GraphWrite),
                ("DELETE", K::GraphWrite),
            ],
        ),
        (
            "/store/direct",
            ListenerKind::Data,
            E::GraphStore,
            &[
                ("GET", K::GraphRead),
                ("HEAD", K::GraphRead),
                ("POST", K::GraphWrite),
                ("PUT", K::GraphWrite),
                ("DELETE", K::GraphWrite),
            ],
        ),
        (
            "/health",
            ListenerKind::Operator,
            E::Health,
            &[("GET", K::Health), ("HEAD", K::Health)],
        ),
        (
            "/ready",
            ListenerKind::Operator,
            E::Ready,
            &[("GET", K::Operator), ("HEAD", K::Operator)],
        ),
        (
            "/metrics",
            ListenerKind::Operator,
            E::Metrics,
            &[("GET", K::Operator), ("HEAD", K::Operator)],
        ),
        (
            "/access/audit",
            ListenerKind::Operator,
            E::Audit,
            &[("GET", K::Operator), ("HEAD", K::Operator)],
        ),
        (
            "/access/policy/reload",
            ListenerKind::Operator,
            E::AccessPolicy,
            &[("POST", K::Operator)],
        ),
        ("/absent", ListenerKind::Data, E::Unknown, &[]),
        ("/repositories/absent", ListenerKind::Data, E::Unknown, &[]),
        ("/metrics", ListenerKind::Data, E::Unknown, &[]),
        ("/query", ListenerKind::Operator, E::Unknown, &[]),
    ];
    let mut cases = 0;
    for &(path, listener, endpoint, supported) in routes {
        for method in METHODS {
            let uri: Uri = format!("http://localhost{path}").parse()?;
            let method: Method = method.parse()?;
            let mut headers = HeaderMap::new();
            headers.insert(
                "content-type",
                oxhttp::model::HeaderValue::from_static("application/sparql-query"),
            );
            headers.insert(
                "access-control-request-method",
                oxhttp::model::HeaderValue::from_static("GET"),
            );
            let operation = RequestOperation::classify(&uri, &method, &headers, listener)?;
            let effective = if method == Method::OPTIONS {
                "GET"
            } else {
                method.as_str()
            };
            let expected = supported
                .iter()
                .find(|(candidate, _)| *candidate == effective);
            ensure!(
                operation.endpoint == expected.map_or(E::Unknown, |_| endpoint),
                "endpoint mismatch {method} {path}"
            );
            ensure!(
                operation.required == vec![expected.map_or(K::Unknown, |(_, kind)| *kind)],
                "operation mismatch {method} {path}"
            );
            ensure!(
                operation.method == method
                    && operation.preflight_method.is_some() == (method == Method::OPTIONS)
            );
            for (principal, should_allow) in [(&allowed, expected.is_some()), (&denied, false)] {
                let decision = policy.authorizer.authorize(
                    principal,
                    &operation,
                    Instant::now() + Duration::from_secs(1),
                );
                ensure!(
                    decision.is_ok() == should_allow,
                    "authorization mismatch {method} {path}"
                );
                if let Ok(grant) = decision {
                    ensure!(
                        grant.policy_id == "acceptance-v1" && grant.workload_class == "default"
                    );
                }
                cases += 1;
            }
        }
    }
    ensure!(cases == 360, "route matrix inventory drift");
    Ok(())
}

#[test]
fn forms_preflights_and_graph_selectors_preserve_whole_operations() -> Result<()> {
    use OperationKind as K;
    let policy = policy()?;
    let principal = authenticate(&policy, connection()?, "allowed", 1000, 1000, 1060)?;
    for (path, method, content, required) in [
        (
            "/query",
            "POST",
            "application/x-www-form-urlencoded",
            vec![K::Query],
        ),
        (
            "/update",
            "POST",
            "application/x-www-form-urlencoded",
            vec![K::Update],
        ),
        (
            "/sparql",
            "POST",
            "application/sparql-query",
            vec![K::Query],
        ),
        (
            "/sparql",
            "POST",
            "application/sparql-update",
            vec![K::Update],
        ),
        (
            "/sparql",
            "POST",
            "application/x-www-form-urlencoded",
            vec![K::Query, K::Update],
        ),
        (
            "/sparql",
            "QUERY",
            "application/x-www-form-urlencoded",
            vec![K::Query],
        ),
        ("/sparql", "OPTIONS", "", vec![K::Query, K::Update]),
    ] {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", content.parse()?);
        headers.insert("access-control-request-method", "POST".parse()?);
        let operation = RequestOperation::classify(
            &format!("http://localhost{path}").parse()?,
            &method.parse()?,
            &headers,
            ListenerKind::Data,
        )?;
        ensure!(
            operation.required == required,
            "wrong composite operation {method} {path}"
        );
        policy.authorizer.authorize(
            &principal,
            &operation,
            Instant::now() + Duration::from_secs(1),
        )?;
    }
    for values in [
        vec![],
        vec!["OPTIONS"],
        vec!["GET", "POST"],
        vec!["invalid method"],
    ] {
        let mut headers = HeaderMap::new();
        for value in values {
            headers.append("access-control-request-method", value.parse()?);
        }
        ensure!(
            RequestOperation::classify(
                &Uri::from_static("http://localhost/query"),
                &Method::OPTIONS,
                &headers,
                ListenerKind::Data
            )
            .is_err()
        );
    }
    for (path, expected) in [
        ("/store", GraphTarget::Dataset),
        ("/store?default", GraphTarget::DefaultGraph),
        (
            "/store?graph=urn%3Aallowed%2Bgraph",
            GraphTarget::NamedGraph(oxigraph::model::NamedNode::new("urn:allowed+graph")?),
        ),
        (
            "/store/direct",
            GraphTarget::NamedGraph(oxigraph::model::NamedNode::new(
                "http://localhost/store/direct",
            )?),
        ),
    ] {
        for method in ["GET", "HEAD", "PUT", "POST", "DELETE"] {
            let operation = RequestOperation::classify(
                &format!("http://localhost{path}").parse()?,
                &method.parse()?,
                &HeaderMap::new(),
                ListenerKind::Data,
            )?;
            ensure!(operation.graph.as_ref() == Some(&expected));
            policy.authorizer.authorize(
                &principal,
                &operation,
                Instant::now() + Duration::from_secs(1),
            )?;
        }
    }
    for path in [
        "/store?graph=urn:a&graph=urn:a",
        "/store?default&graph=urn:a",
        "/store?graph=urn:%XX",
        "/store?unknown",
        "/store/direct?default",
        "/store?graph=relative",
        "/store?default=value",
    ] {
        ensure!(
            RequestOperation::classify(
                &format!("http://localhost{path}").parse()?,
                &Method::GET,
                &HeaderMap::new(),
                ListenerKind::Data
            )
            .is_err(),
            "selector accepted {path}"
        );
    }
    Ok(())
}
