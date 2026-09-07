//! Opt-in process-lifetime loopback observations; no SPARQL or maintenance API.
use oxhttp::model::header::{ALLOW, CACHE_CONTROL, CONTENT_TYPE};
use oxhttp::model::{Body, Method, Request, Response, StatusCode};
use oxhttp::{ListeningServer, Server};
use oxigraph::store::{
    CircuitState, ContributorRegistry, GovernanceTime, ProbeCoverage, ReadinessDisposition,
    ReadinessPolicy, ReadinessReason, Store, TransactionStartControl,
};
use std::fmt::Write as _;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub(super) fn spawn(
    store: Store,
    address: SocketAddr,
    started: Arc<AtomicBool>,
) -> std::io::Result<ListeningServer> {
    // Also defend this private seam, independent of Clap validation.
    if !address.ip().is_loopback() || address.port() == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "admin listener must use a numeric loopback IP and nonzero port",
        ));
    }
    Server::new(move |request| handle(request, &store, started.load(Ordering::Acquire)))
        .bind(address)
        .with_max_concurrent_connections(2)
        .with_global_timeout(Duration::from_secs(2))
        .spawn()
}

/// Fail closed before invoking any application handler during partial startup.
pub(super) fn gate(
    started: Arc<AtomicBool>,
    on_request: impl Fn(&mut Request<Body>) -> Response<Body> + Send + Sync + 'static,
) -> impl Fn(&mut Request<Body>) -> Response<Body> + Send + Sync + 'static {
    move |request| {
        if started.load(Ordering::Acquire) {
            on_request(request)
        } else {
            response(
                request,
                StatusCode::SERVICE_UNAVAILABLE,
                "application/json",
                "{\"status\":\"starting\"}\n".into(),
            )
        }
    }
}

fn response(
    request: &Request<Body>,
    status: StatusCode,
    content_type: &'static str,
    body: String,
) -> Response<Body> {
    let mut builder = Response::builder()
        .status(status)
        .header(CONTENT_TYPE, content_type)
        .header(CACHE_CONTROL, "no-store");
    if status == StatusCode::METHOD_NOT_ALLOWED {
        builder = builder.header(ALLOW, "GET, HEAD");
    }
    crate::finalize_response(request.method(), builder.body(body.into()).unwrap())
}

fn handle(request: &mut Request<Body>, store: &Store, started: bool) -> Response<Body> {
    const JSON: &str = "application/json";
    let path = request.uri().path();
    if !matches!(path, "/health" | "/ready" | "/metrics") {
        return response(
            request,
            StatusCode::NOT_FOUND,
            JSON,
            "{\"error\":\"not_found\"}\n".into(),
        );
    }
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return response(
            request,
            StatusCode::METHOD_NOT_ALLOWED,
            JSON,
            "{\"error\":\"method_not_allowed\"}\n".into(),
        );
    }
    if request.uri().query().is_some() {
        return response(
            request,
            StatusCode::BAD_REQUEST,
            JSON,
            "{\"error\":\"query_not_supported\"}\n".into(),
        );
    }
    if path == "/health" {
        return response(request, StatusCode::OK, JSON, "{\"live\":true}\n".into());
    }
    let Ok(now) = GovernanceTime::now() else {
        return response(
            request,
            StatusCode::SERVICE_UNAVAILABLE,
            JSON,
            "{\"status\":\"not_ready\",\"reasons\":[\"clock\"]}\n".into(),
        );
    };
    let snapshot = store.operational_snapshot(
        &ReadinessPolicy::default().with_timeout(Duration::from_millis(250)),
        &ContributorRegistry::default(),
        &[],
        now,
        &TransactionStartControl::new(),
        if started {
            CircuitState::Closed
        } else {
            CircuitState::Unknown
        },
    );
    if path == "/metrics" {
        let mut body = String::new();
        for metric in snapshot.metrics() {
            writeln!(
                body,
                "# TYPE {} gauge\n{} {}",
                metric.name(),
                metric.name(),
                metric.value()
            )
            .unwrap();
        }
        return response(
            request,
            StatusCode::OK,
            "text/plain; version=0.0.4; charset=utf-8",
            body,
        );
    }
    let (status, disposition) = match snapshot.disposition() {
        ReadinessDisposition::Ready => (StatusCode::OK, "ready"),
        ReadinessDisposition::Degraded => (StatusCode::OK, "degraded"),
        ReadinessDisposition::NotReady => (StatusCode::SERVICE_UNAVAILABLE, "not_ready"),
    };
    let reasons = snapshot
        .reasons()
        .map(|reason| format!("\"{}\"", reason_name(reason)))
        .collect::<Vec<_>>()
        .join(",");
    response(
        request,
        status,
        JSON,
        format!(
            "{{\"status\":\"{disposition}\",\"primary_coverage\":\"{}\",\"outbox_coverage\":\"{}\",\"reasons\":[{reasons}]}}\n",
            coverage_name(snapshot.primary_coverage()),
            coverage_name(snapshot.outbox_coverage())
        ),
    )
}

fn coverage_name(coverage: ProbeCoverage) -> &'static str {
    match coverage {
        ProbeCoverage::Unobserved => "unobserved",
        ProbeCoverage::Complete => "complete",
        ProbeCoverage::Partial => "partial",
    }
}
fn reason_name(reason: ReadinessReason) -> &'static str {
    match reason {
        ReadinessReason::Cancelled => "cancelled",
        ReadinessReason::TimedOut => "timed_out",
        ReadinessReason::Storage => "storage",
        ReadinessReason::Outbox => "outbox",
        ReadinessReason::PartialOutbox => "partial_outbox",
        ReadinessReason::Backpressure => "backpressure",
        ReadinessReason::ConsumerLag => "consumer_lag",
        ReadinessReason::Circuit => "circuit",
        ReadinessReason::Contributors => "contributors",
        ReadinessReason::RecoveryExpired => "recovery_expired",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::{Result, ensure};
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn partial_startup_cannot_enter_application_or_report_ready() -> Result<()> {
        let started = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&calls);
        let handler = gate(Arc::clone(&started), move |_| {
            observed.fetch_add(1, Ordering::Relaxed);
            Response::builder().body(Body::empty()).unwrap()
        });
        for (method, path) in [("POST", "/update"), ("PUT", "/store"), ("GET", "/query")] {
            let mut request = Request::builder()
                .method(method)
                .uri(format!("http://localhost{path}"))
                .body(Body::empty())?;
            ensure!(
                handler(&mut request).status() == StatusCode::SERVICE_UNAVAILABLE,
                "partial startup admitted application work"
            );
        }
        ensure!(calls.load(Ordering::Relaxed) == 0, "gated handler ran");
        let store = Store::new()?;
        for (path, expected) in [
            ("/health", StatusCode::OK),
            ("/ready", StatusCode::SERVICE_UNAVAILABLE),
        ] {
            let mut request = Request::builder()
                .uri(format!("http://localhost{path}"))
                .body(Body::empty())?;
            ensure!(
                handle(&mut request, &store, false).status() == expected,
                "partial startup operational status differs"
            );
        }
        started.store(true, Ordering::Release);
        let mut request = Request::builder()
            .uri("http://localhost/update")
            .body(Body::empty())?;
        ensure!(
            handler(&mut request).status() == StatusCode::OK,
            "successful startup stayed gated"
        );
        ensure!(
            calls.load(Ordering::Relaxed) == 1,
            "activated handler did not run once"
        );
        Ok(())
    }
}
