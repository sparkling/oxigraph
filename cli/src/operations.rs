//! Opt-in process-lifetime loopback observations; no SPARQL or maintenance API.
use oxhttp::model::header::{
    ALLOW, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, TRANSFER_ENCODING,
};
use oxhttp::model::{Body, Method, Request, Response, StatusCode};
use oxhttp::{ListeningServer, Server};
use oxigraph::store::{
    CircuitState, ContributorRegistry, GovernanceTime, ProbeCoverage, ReadinessDisposition,
    ReadinessPolicy, ReadinessReason, Store, TransactionStartControl,
};
use oxigraph_cli::access::{AccessController, ListenerKind};
use oxigraph_cli::workload::{AdmissionController, AdmissionMetrics, WorkloadError, WorkloadLease};
use std::fmt::Write as _;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub(super) fn spawn(
    store: Store,
    address: SocketAddr,
    started: Arc<AtomicBool>,
    access: Arc<AccessController>,
    workload: Option<AdmissionController>,
) -> std::io::Result<ListeningServer> {
    // Also defend this private seam, independent of Clap validation.
    if !address.ip().is_loopback() || address.port() == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "admin listener must use a numeric loopback IP and nonzero port",
        ));
    }
    let admission = Arc::clone(&access);
    let connection_limit = workload.as_ref().map_or(2, |controller| {
        controller.connection_limit(ListenerKind::Operator)
    });
    // The handler observes the same shared controller that admitted it: a
    // `/metrics` scrape therefore sees its own operator lease as active.
    let telemetry = workload.clone();
    Server::new(move |request| {
        if let Err(error) = AccessController::prepare_request(request) {
            return oxigraph_cli::access::denial(error);
        }
        if access.is_proxy_profile() {
            if let Some(response) = operator_operation(request, &access, telemetry.as_ref()) {
                return response;
            }
        }
        handle(
            request,
            &store,
            started.load(Ordering::Acquire),
            telemetry.as_ref(),
        )
    })
    .with_request_admission(move |head, connection| {
        let mut context = admission.admit(head, connection, ListenerKind::Operator)?;
        if let Some(workload) = &workload {
            workload.admit_request(head, &mut context, ListenerKind::Operator)?;
        }
        Ok(context)
    })
    .bind(address)
    .with_max_concurrent_connections(connection_limit)
    .with_global_timeout(Duration::from_secs(2))
    .spawn()
}

fn operator_operation(
    request: &Request<Body>,
    access: &AccessController,
    workload: Option<&AdmissionController>,
) -> Option<Response<Body>> {
    let (status, body) = match (request.uri().path(), request.method().as_str()) {
        ("/access/policy/reload", "POST") => {
            if request.body().len() == Some(0) {
                match access.reload() {
                    Ok(_) => (StatusCode::NO_CONTENT, String::new()),
                    Err(_) => (
                        StatusCode::BAD_REQUEST,
                        "{\"error\":\"policy_reload_rejected\"}\n".into(),
                    ),
                }
            } else {
                (
                    StatusCode::BAD_REQUEST,
                    "{\"error\":\"body_not_supported\"}\n".into(),
                )
            }
        }
        ("/workload/policy/reload", "POST") => {
            if known_empty_body(request) {
                let result = request
                    .extensions()
                    .get::<WorkloadLease>()
                    .ok_or(WorkloadError::MissingAccessContext)
                    .and_then(|lease| {
                        workload
                            .ok_or(WorkloadError::Unavailable)?
                            .reload_with_cancellation(access, lease.cancellation_token())
                    });
                match result {
                    Ok(_) => (StatusCode::NO_CONTENT, String::new()),
                    Err(WorkloadError::RequestTimedOut | WorkloadError::Cancelled) => {
                        (StatusCode::REQUEST_TIMEOUT, String::new())
                    }
                    Err(_) => (
                        StatusCode::BAD_REQUEST,
                        "{\"error\":\"policy_reload_rejected\"}\n".into(),
                    ),
                }
            } else {
                (
                    StatusCode::BAD_REQUEST,
                    "{\"error\":\"body_not_supported\"}\n".into(),
                )
            }
        }
        ("/access/audit", "GET" | "HEAD") => match access.audit_snapshot() {
            Ok(audit) => {
                return Some(generated_response(
                    request,
                    StatusCode::OK,
                    "application/json",
                    |writer| serde_json::to_writer(writer, &audit).map_err(|_| std::fmt::Error),
                ));
            }
            Err(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "{\"error\":\"audit_unavailable\"}\n".into(),
            ),
        },
        _ => return None,
    };
    Some(response(request, status, "application/json", body))
}

fn known_empty_body(request: &Request<Body>) -> bool {
    request.body().len() == Some(0)
        && request.headers().get(TRANSFER_ENCODING).is_none()
        && request
            .headers()
            .get(CONTENT_LENGTH)
            .is_some_and(|value| value == "0")
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

fn generated_response(
    request: &Request<Body>,
    status: StatusCode,
    content_type: &'static str,
    build: impl FnOnce(&mut crate::result_body::ResultBodyWriter<Vec<u8>>) -> std::fmt::Result,
) -> Response<Body> {
    let mut writer = crate::result_body::ResultBodyWriter::new(Vec::new(), request);
    let generated = build(&mut writer);
    // fmt/serde may erase an io::Error's type. The writer retains an overflow
    // latch; inspect it first, so limits remain 503 rather than becoming 500.
    match writer
        .finish()
        .and_then(|bytes| String::from_utf8(bytes).map_err(std::io::Error::other))
    {
        Err(error) => {
            let (status, message) = crate::result_body::internal_error(error);
            response(request, status, "text/plain", message)
        }
        Ok(body) if generated.is_ok() => response(request, status, content_type, body),
        Ok(_) => response(
            request,
            StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain",
            String::new(),
        ),
    }
}

/// Without a workload policy the admission families are absent, not zero.
/// An unobservable controller fails the whole scrape closed with a bounded
/// diagnostic rather than exporting zeros or a raw error.
fn admission_metrics(
    request: &Request<Body>,
    metrics: Option<Result<AdmissionMetrics, WorkloadError>>,
) -> Result<Option<AdmissionMetrics>, Box<Response<Body>>> {
    metrics.transpose().map_err(|_| {
        Box::new(response(
            request,
            StatusCode::SERVICE_UNAVAILABLE,
            "application/json",
            "{\"error\":\"admission_metrics_unavailable\"}\n".into(),
        ))
    })
}

fn handle(
    request: &mut Request<Body>,
    store: &Store,
    started: bool,
    workload: Option<&AdmissionController>,
) -> Response<Body> {
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
    // Observe admission before any store probe; it never dequeues or releases.
    let admission = if path == "/metrics" {
        match admission_metrics(request, workload.map(AdmissionController::metrics)) {
            Ok(admission) => admission,
            Err(response) => return *response,
        }
    } else {
        None
    };
    let Ok(now) = GovernanceTime::now() else {
        return response(
            request,
            StatusCode::SERVICE_UNAVAILABLE,
            JSON,
            "{\"status\":\"not_ready\",\"reasons\":[\"clock\"]}\n".into(),
        );
    };
    let cancellation = crate::request_cancellation(request);
    let timeout = cancellation
        .as_ref()
        .and_then(oxigraph::sparql::CancellationToken::deadline)
        .map_or(Duration::from_millis(250), |deadline| {
            deadline
                .saturating_duration_since(std::time::Instant::now())
                .min(Duration::from_millis(250))
        });
    let control = cancellation.map_or_else(TransactionStartControl::new, |token| {
        TransactionStartControl::new().with_cancellation_token(token)
    });
    let snapshot = store.operational_snapshot(
        &ReadinessPolicy::default().with_timeout(timeout),
        &ContributorRegistry::default(),
        &[],
        now,
        &control,
        if started {
            CircuitState::Closed
        } else {
            CircuitState::Unknown
        },
    );
    if path == "/metrics" {
        return generated_response(
            request,
            StatusCode::OK,
            "text/plain; version=0.0.4; charset=utf-8",
            |body| {
                for metric in snapshot.metrics() {
                    writeln!(
                        body,
                        "# TYPE {} gauge\n{} {}",
                        metric.name(),
                        metric.name(),
                        metric.value()
                    )?;
                }
                store.transaction_metrics().write_prometheus(body)?;
                store.evaluation_metrics().write_prometheus(body)?;
                store.policy_metrics().write_prometheus(body)?;
                admission
                    .as_ref()
                    .map_or(Ok(()), |metrics| metrics.write_prometheus(body))
            },
        );
    }
    let (status, disposition) = match snapshot.disposition() {
        ReadinessDisposition::Ready => (StatusCode::OK, "ready"),
        ReadinessDisposition::Degraded => (StatusCode::OK, "degraded"),
        ReadinessDisposition::NotReady => (StatusCode::SERVICE_UNAVAILABLE, "not_ready"),
    };
    generated_response(request, status, JSON, |body| {
        write!(
            body,
            "{{\"status\":\"{disposition}\",\"primary_coverage\":\"{}\",\"outbox_coverage\":\"{}\",\"reasons\":[",
            coverage_name(snapshot.primary_coverage()),
            coverage_name(snapshot.outbox_coverage())
        )?;
        for (index, reason) in snapshot.reasons().enumerate() {
            if index != 0 {
                body.write_char(',')?;
            }
            write!(body, "\"{}\"", reason_name(reason))?;
        }
        body.write_str("]}\n")
    })
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
                handle(&mut request, &store, false, None).status() == expected,
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

    fn scrape(
        store: &Store,
        workload: Option<&AdmissionController>,
    ) -> Result<(StatusCode, String)> {
        let mut request = Request::builder()
            .uri("http://localhost/metrics")
            .body(Body::empty())?;
        let mut response = handle(&mut request, store, true, workload);
        let body = std::io::read_to_string(response.body_mut())?;
        Ok((response.status(), body))
    }

    #[test]
    fn metrics_omit_admission_without_policy_and_fail_closed_when_unobservable() -> Result<()> {
        let store = Store::new()?;
        let (status, baseline) = scrape(&store, None)?;
        ensure!(status == StatusCode::OK, "baseline scrape failed");
        ensure!(
            !baseline.contains("admission"),
            "no-workload output changed: admission families present"
        );
        let controller = AdmissionController::new(oxigraph_cli::workload::WorkloadPolicy::from_json(
            serde_json::json!({"format":"oxigraph-admission-v1","policy_id":"private-policy","version":1,
            "max_active":1,"max_queued":0,"operator_max_active":1,"operator_max_queued":0,
            "queue_timeout_ms":1000,"retry_after_seconds":1,
            "classes":{"private-class":{"max_active":1,"max_queued":0},"default":{"max_active":1,"max_queued":0}}})
            .to_string()
            .as_bytes(),
        )?)?;
        // `handle` is called directly here, so no operator lease exists: the
        // served endpoint additionally counts its own admitted scrape.
        let held = controller.acquire(
            "private-class",
            ListenerKind::Data,
            oxigraph::sparql::CancellationToken::new(),
        )?;
        let (status, body) = scrape(&store, Some(&controller))?;
        ensure!(status == StatusCode::OK, "workload scrape failed");
        ensure!(
            body.starts_with(
                &baseline[..baseline.find("oxigraph_transactions_total").unwrap_or(0)]
            ),
            "readiness gauges changed"
        );
        let admission = body
            .lines()
            .filter(|line| !line.starts_with('#') && line.contains("admission"))
            .count();
        ensure!(
            admission == AdmissionMetrics::SAMPLES,
            "admission sample count differs: {admission}"
        );
        ensure!(
            body.contains("oxigraph_admission_active{pool=\"data\"} 1\n")
                && body.contains("oxigraph_admission_active{pool=\"operator\"} 0\n")
                && body.contains(
                    "oxigraph_admissions_total{pool=\"data\",disposition=\"admitted\"} 1\n"
                ),
            "active lease not exported"
        );
        ensure!(
            !body.contains("private") && !body.contains("default"),
            "class or policy identity leaked"
        );
        drop(held);
        // Fail closed with a bounded diagnostic; the Store families are withheld
        // rather than exported next to zeros or a raw error.
        let mut request = Request::builder()
            .uri("http://localhost/metrics")
            .body(Body::empty())?;
        let unavailable = admission_metrics(&request, Some(Err(WorkloadError::Unavailable)))
            .err()
            .map(|response| *response);
        let Some(mut unavailable) = unavailable else {
            anyhow::bail!("unavailable admission telemetry was exported");
        };
        let diagnostic = std::io::read_to_string(unavailable.body_mut())?;
        ensure!(
            unavailable.status() == StatusCode::SERVICE_UNAVAILABLE
                && diagnostic == "{\"error\":\"admission_metrics_unavailable\"}\n"
                && unavailable.headers()[CACHE_CONTROL] == "no-store",
            "fail-closed diagnostic differs"
        );
        ensure!(
            admission_metrics(&request, None).is_ok_and(|metrics| metrics.is_none())
                && admission_metrics(&request, Some(Ok(AdmissionMetrics::default())))
                    .is_ok_and(|metrics| metrics.is_some()),
            "observable telemetry was withheld"
        );
        drop(request);
        Ok(())
    }
}
