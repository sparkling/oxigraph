#![expect(
    clippy::tests_outside_test_module,
    reason = "external embedding and native wire fixture"
)]
use anyhow::{Context, Result, ensure};
use oxhttp::Server;
use oxhttp::model::{Body, Request, Response};
use oxigraph_cli::access::{
    AccessController, AccessError, AccessGrant, AccessPolicy, AuthenticationMethod, ListenerKind,
    RequestAuthorizer, RequestContext, RequestIdentityProvider, RequestMetadata, RequestOperation,
    RequestPrincipal,
};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

struct Provider(Arc<AtomicU8>);
impl RequestIdentityProvider for Provider {
    fn authenticate(
        &self,
        request: RequestMetadata<'_>,
        _: u64,
        _: Instant,
    ) -> Result<RequestPrincipal, AccessError> {
        if !request.connection.peer_addr().ip().is_loopback() {
            return Err(AccessError::Provider);
        }
        match self.0.load(Ordering::SeqCst) {
            1 => return Err(AccessError::Provider),
            2 => std::thread::sleep(Duration::from_millis(30)),
            3 => return Err(AccessError::Denied),
            _ => (),
        }
        RequestPrincipal::authenticated(
            "private-custom-subject".into(),
            AuthenticationMethod::Custom,
        )
    }
}
struct Authorizer(Arc<AtomicU8>);
impl RequestAuthorizer for Authorizer {
    fn authorize(
        &self,
        principal: &RequestPrincipal,
        operation: &RequestOperation,
        _: Instant,
    ) -> Result<AccessGrant, AccessError> {
        if principal.subject() != Some("private-custom-subject") || operation.required.len() != 1 {
            return Err(AccessError::Policy);
        }
        if self.0.load(Ordering::SeqCst) == 1 {
            return Err(AccessError::Denied);
        }
        Ok(AccessGrant {
            policy_id: "embedding-fixture".into(),
            workload_class: if self.0.load(Ordering::SeqCst) == 2 {
                "client-unconfigured-class"
            } else {
                "default"
            }
            .into(),
        })
    }
}

#[test]
#[expect(
    clippy::panic_in_result_fn,
    reason = "assertions execute in the non-Result HTTP callback"
)]
fn custom_extensions_fail_closed_and_propagate_only_trusted_context() -> Result<()> {
    let provider_mode = Arc::new(AtomicU8::new(0));
    let authorizer_mode = Arc::new(AtomicU8::new(0));
    let policy = AccessPolicy::new(
        "embedding-fixture".into(),
        1,
        Arc::new(Provider(Arc::clone(&provider_mode))),
        Arc::new(Authorizer(Arc::clone(&authorizer_mode))),
        vec!["default".into()],
        Duration::from_millis(20),
    )?;
    let controller = Arc::new(AccessController::new(policy, false));
    let admission = Arc::clone(&controller);
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&calls);
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let address = listener.local_addr()?;
    drop(listener);
    // OxHTTP listeners have test-process lifetime; every request connection closes.
    let _server = Server::new(move |request| {
        if let Err(error) = AccessController::prepare_request(request) {
            return oxigraph_cli::access::denial(error);
        }
        for name in [
            "oxigraph-identity",
            "authorization",
            "proxy-authorization",
            "cookie",
            "forwarded",
            "x-forwarded-host",
        ] {
            assert!(
                !request.headers().contains_key(name),
                "sensitive header reached handler: {name}"
            );
        }
        let context = request.extensions().get::<RequestContext>().unwrap();
        assert_eq!(
            context.principal().subject(),
            Some("private-custom-subject")
        );
        assert_eq!(context.policy_version(), 1);
        assert_eq!(context.grant().workload_class, "default");
        assert!(
            !format!("{context:?}").contains("private-custom-subject"),
            "Debug disclosed subject"
        );
        observed.fetch_add(1, Ordering::SeqCst);
        Response::builder().body(Body::empty()).unwrap()
    })
    .with_request_admission(move |head, socket| admission.admit(head, socket, ListenerKind::Data))
    .bind(address)
    .with_global_timeout(Duration::from_secs(2))
    .spawn()?;
    for (provider, authorizer, expected) in [
        (0, 0, 200),
        (1, 0, 401),
        (2, 0, 401),
        (3, 0, 401),
        (0, 1, 403),
        (0, 2, 401),
    ] {
        provider_mode.store(provider, Ordering::SeqCst);
        authorizer_mode.store(authorizer, Ordering::SeqCst);
        let mut stream = TcpStream::connect(address)?;
        stream.set_read_timeout(Some(Duration::from_secs(3)))?;
        stream.write_all(b"GET /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nOxigraph-Identity: untrusted\r\nAuthorization: Bearer private-token\r\nProxy-Authorization: private-proxy-token\r\nCookie: private-cookie\r\nForwarded: host=forged.invalid\r\nX-Forwarded-Host: forged.invalid\r\n\r\n")?;
        let mut wire = String::new();
        stream.read_to_string(&mut wire)?;
        let status = wire
            .split_whitespace()
            .nth(1)
            .context("status missing")?
            .parse::<u16>()?;
        ensure!(
            status == expected,
            "provider={provider}, authorizer={authorizer}: {status}"
        );
    }
    ensure!(
        calls.load(Ordering::SeqCst) == 1,
        "denied provider/policy reached application"
    );
    let audit = serde_json::to_string(&controller.audit_snapshot()?)?;
    for raw in [
        "private-custom-subject",
        "private-token",
        "private-cookie",
        "forged.invalid",
    ] {
        ensure!(!audit.contains(raw));
    }
    let mut bypass = Request::builder()
        .uri("http://localhost/query")
        .body(Body::empty())?;
    ensure!(
        AccessController::prepare_request(&mut bypass).is_err(),
        "missing admission context bypassed wrapper"
    );
    Ok(())
}
