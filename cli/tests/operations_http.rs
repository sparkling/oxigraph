#![expect(
    clippy::tests_outside_test_module,
    reason = "CLI subprocess wire contracts"
)]
use anyhow::{Context, Result, ensure};
use oxigraph::model::{GraphName, Literal, NamedNode, Quad};
use oxigraph::store::{
    GovernanceTime, OutboxRetentionPolicy, Store, TransactionKey, TransactionRequest,
    WritableDataset,
};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::num::{NonZeroU16, NonZeroU64};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        drop(self.0.kill());
        drop(self.0.wait());
    }
}
struct Running {
    child: ChildGuard,
    public: SocketAddr,
    admin: SocketAddr,
}
fn command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_oxigraph"));
    command
        .env_remove("NOTIFY_SOCKET")
        .stdin(Stdio::null())
        .stdout(Stdio::null());
    command
}
fn reserved() -> Result<TcpListener> {
    Ok(TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?)
}
fn start(location: Option<&Path>, read_only: bool) -> Result<Running> {
    let public = reserved()?;
    let admin = reserved()?;
    let public_addr = public.local_addr()?;
    let admin_addr = admin.local_addr()?;
    let mut cmd = command();
    cmd.arg(if read_only {
        "serve-read-only"
    } else {
        "serve"
    })
    .args([
        "--bind",
        &public_addr.to_string(),
        "--admin-bind",
        &admin_addr.to_string(),
    ]);
    if let Some(location) = location {
        cmd.arg("--location").arg(location);
    }
    drop(public);
    drop(admin);
    let mut running = Running {
        child: ChildGuard(cmd.spawn()?),
        public: public_addr,
        admin: admin_addr,
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        ensure!(
            running.child.0.try_wait()?.is_none(),
            "CLI exited before readiness listener started"
        );
        if wire(running.admin, "GET", "/health").is_ok_and(|response| response.status == 200)
            && wire(running.public, "GET", "/").is_ok_and(|response| response.status == 200)
        {
            return Ok(running);
        }
        ensure!(
            Instant::now() < deadline,
            "admin listener startup timed out"
        );
        thread::sleep(Duration::from_millis(20));
    }
}
struct WireResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}
impl WireResponse {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}
fn wire(address: SocketAddr, method: &str, target: &str) -> Result<WireResponse> {
    wire_body(address, method, target, "", "application/octet-stream")
}

fn wire_body(
    address: SocketAddr,
    method: &str,
    target: &str,
    body: &str,
    content_type: &str,
) -> Result<WireResponse> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    write!(
        stream,
        "{method} {target} HTTP/1.1\r\nHost: {address}\r\nOrigin: https://example.invalid\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    let mut bytes = String::new();
    stream.read_to_string(&mut bytes)?;
    let (head, body) = bytes
        .split_once("\r\n\r\n")
        .context("missing HTTP header end")?;
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .context("missing status line")?
        .split_whitespace()
        .nth(1)
        .context("missing status")?
        .parse()?;
    let headers = lines
        .map(|line| {
            let (name, value) = line.split_once(':').context("malformed response header")?;
            Ok((name.to_owned(), value.trim().to_owned()))
        })
        .collect::<Result<_>>()?;
    Ok(WireResponse {
        status,
        headers,
        body: body.to_owned(),
    })
}

#[test]
fn loopback_routes_are_separate_and_head_matches_get() -> Result<()> {
    let running = start(None, false)?;
    for path in ["/health", "/ready", "/metrics"] {
        let get = wire(running.admin, "GET", path)?;
        let head = wire(running.admin, "HEAD", path)?;
        ensure!(
            get.status == 200 && head.status == 200,
            "healthy endpoint failed: {path}"
        );
        ensure!(head.body.is_empty(), "HEAD returned bytes: {path}");
        ensure!(
            get.header("content-length") == head.header("content-length"),
            "HEAD length differs: {path}"
        );
        ensure!(
            get.header("cache-control") == Some("no-store"),
            "response is cacheable"
        );
        ensure!(
            get.header("access-control-allow-origin").is_none(),
            "admin CORS unexpectedly enabled"
        );
        ensure!(
            wire(running.public, "GET", path)?.status == 404,
            "admin path leaked onto public listener"
        );
        for method in ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"] {
            let denied = wire(running.admin, method, path)?;
            ensure!(
                denied.status == 405 && denied.header("allow") == Some("GET, HEAD"),
                "write method was not rejected"
            );
        }
    }
    for path in [
        "/query",
        "/update",
        "/store",
        "/backup",
        "/optimize",
        "/",
        "/ready/",
    ] {
        ensure!(
            wire(running.admin, "GET", path)?.status == 404,
            "non-operational route admitted: {path}"
        );
    }
    let response = wire(running.admin, "GET", "/ready?query=private-rdf-marker")?;
    ensure!(
        response.status == 400 && !response.body.contains("private-rdf-marker"),
        "query input leaked or accepted"
    );
    let ready = wire(running.admin, "GET", "/ready")?;
    ensure!(
        ready.body.contains("\"status\":\"ready\""),
        "empty inventory not ready"
    );
    let metrics = wire(running.admin, "GET", "/metrics")?;
    ensure!(
        metrics.body.contains("oxigraph_ready 1\n"),
        "ready gauge absent"
    );
    let samples: Vec<_> = metrics
        .body
        .lines()
        .filter(|line| !line.starts_with('#'))
        .filter(|line| {
            !line.starts_with("oxigraph_transaction_")
                && !line.starts_with("oxigraph_transactions_total")
                && !line.starts_with("oxigraph_query_")
                && !line.starts_with("oxigraph_queries_total")
                && !line.starts_with("oxigraph_update_")
                && !line.starts_with("oxigraph_updates_total")
                && !line.starts_with("oxigraph_egress_")
                && !line.starts_with("oxigraph_shacl_commit_")
        })
        .collect();
    ensure!(
        samples.len() <= 21
            && samples
                .iter()
                .all(|line| line.starts_with("oxigraph_") && !line.contains('{')),
        "metric vocabulary/cardinality drift"
    );
    let public = running.public;
    let admin = running.admin;
    drop(running);
    ensure!(
        TcpStream::connect(public).is_err() && TcpStream::connect(admin).is_err(),
        "listeners survived CLI kill/wait"
    );
    Ok(())
}

#[test]
fn successful_update_and_failed_request_export_distinct_transaction_observations() -> Result<()> {
    let running = start(None, false)?;
    let update = wire_body(
        running.public,
        "POST",
        "/update",
        "INSERT DATA { <urn:private:telemetry> <urn:p> <urn:o> }",
        "application/sparql-update",
    )?;
    ensure!(
        update.status == 204,
        "update did not commit: {} {}",
        update.status,
        update.body
    );
    let failed = wire_body(
        running.public,
        "POST",
        "/update",
        "INSERT DATA { <urn:private:rollback> <urn:p> <urn:o> }; CREATE GRAPH <urn:g>; CREATE GRAPH <urn:g>",
        "application/sparql-update",
    )?;
    ensure!(failed.status >= 400, "failing update succeeded");
    let query = wire_body(
        running.public,
        "POST",
        "/query",
        "ASK { <urn:private:rollback> <urn:p> <urn:o> }",
        "application/sparql-query",
    )?;
    ensure!(
        query.status == 200 && query.body.contains("false"),
        "failed update left data: {}",
        query.body
    );
    let metrics = wire(running.admin, "GET", "/metrics")?;
    ensure!(metrics.status == 200, "scrape failed");
    ensure!(
        metrics
            .body
            .contains("oxigraph_transactions_total{outcome=\"committed\"} 1\n"),
        "commit counted incorrectly"
    );
    // The existing on_store evaluator abandons its owned transaction on evaluation
    // error; backend Drop removes staged data but supplies no explicit rollback result.
    ensure!(
        metrics
            .body
            .contains("oxigraph_transactions_total{outcome=\"abandoned\"} 1\n")
            && metrics
                .body
                .contains("oxigraph_transactions_total{outcome=\"rolled_back\"} 0\n"),
        "drop-based update cleanup was mislabeled as explicit rollback"
    );
    ensure!(
        metrics
            .body
            .contains("# TYPE oxigraph_transaction_duration_seconds histogram\n"),
        "histogram type missing"
    );
    ensure!(
        metrics.body.contains(
            "oxigraph_transaction_duration_seconds_bucket{outcome=\"committed\",le=\"+Inf\"} 1\n"
        ),
        "infinite bucket differs"
    );
    ensure!(
        !metrics.body.contains("private") && !metrics.body.contains("urn:"),
        "request data leaked"
    );
    let samples = metrics
        .body
        .lines()
        .filter(|line| {
            line.starts_with("oxigraph_transaction_")
                || line.starts_with("oxigraph_transactions_total")
        })
        .count();
    ensure!(
        samples == 89,
        "transaction metric cardinality differs: {samples}"
    );
    for (family, outcome) in [
        ("queries", "succeeded"),
        ("updates", "succeeded"),
        ("updates", "failed"),
    ] {
        ensure!(
            metrics.body.contains(&format!(
                "oxigraph_{family}_total{{outcome=\"{outcome}\"}} 1\n"
            )),
            "evaluation observation differs: {family}/{outcome}"
        );
    }
    let evaluation_samples = metrics
        .body
        .lines()
        .filter(|line| {
            line.starts_with("oxigraph_query_")
                || line.starts_with("oxigraph_queries_total")
                || line.starts_with("oxigraph_update_")
                || line.starts_with("oxigraph_updates_total")
        })
        .count();
    ensure!(
        evaluation_samples == 154,
        "evaluation metric cardinality differs: {evaluation_samples}"
    );
    let policy_samples = metrics
        .body
        .lines()
        .filter(|line| {
            line.starts_with("oxigraph_egress_") || line.starts_with("oxigraph_shacl_commit_")
        })
        .count();
    ensure!(
        policy_samples == 143,
        "policy metric cardinality differs: {policy_samples}"
    );
    Ok(())
}

#[cfg(any(
    feature = "native-tls",
    feature = "rustls-native",
    feature = "rustls-webpki"
))]
#[test]
fn silent_policy_denials_remain_visible_without_failed_operation_counts() -> Result<()> {
    let running = start(None, false)?;
    for silent in [false, true] {
        let keyword = if silent { "SILENT" } else { "" };
        let update = wire_body(
            running.public,
            "POST",
            "/update",
            &format!("LOAD {keyword} <http://example.invalid/private>"),
            "application/sparql-update",
        )?;
        ensure!(
            if silent {
                update.status == 204
            } else {
                update.status >= 400
            },
            "unexpected update result"
        );
    }
    let query = wire_body(
        running.public,
        "POST",
        "/query",
        "ASK { SERVICE SILENT <http://example.invalid/private> { ?s ?p ?o } }",
        "application/sparql-query",
    )?;
    ensure!(
        query.status == 200 && query.body.contains("true"),
        "SILENT query did not succeed"
    );
    let metrics = wire(running.admin, "GET", "/metrics")?;
    for sample in [
        "oxigraph_egress_denials_total{purpose=\"load\"} 2\n",
        "oxigraph_egress_denials_total{purpose=\"service\"} 1\n",
        "oxigraph_queries_total{outcome=\"succeeded\"} 1\n",
        "oxigraph_updates_total{outcome=\"succeeded\"} 1\n",
        "oxigraph_updates_total{outcome=\"policy_denied\"} 1\n",
    ] {
        ensure!(
            metrics.body.contains(sample),
            "missing bounded observation: {sample}"
        );
    }
    ensure!(
        !metrics.body.contains("private") && !metrics.body.contains("example.invalid"),
        "request value leaked"
    );
    Ok(())
}

#[test]
fn backpressure_is_not_ready_but_process_is_live_after_reopen() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let location = directory.path().join("store");
    let store = Store::open(&location)?;
    store.configure_outbox_retention(
        OutboxRetentionPolicy::new(NonZeroU64::new(2).context("zero")?, NonZeroU16::MIN)?,
        GovernanceTime::now()?,
    )?;
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([83; 16]))?
        .into_transaction();
    tx.insert(Quad::new(
        NamedNode::new("urn:private-subject")?,
        NamedNode::new("urn:private-predicate")?,
        Literal::new_simple_literal("private-rdf-marker"),
        GraphName::DefaultGraph,
    ))?;
    tx.commit()?;
    drop(store);
    for read_only in [false, true] {
        let running = start(Some(&location), read_only)?;
        let ready = wire(running.admin, "GET", "/ready")?;
        ensure!(
            ready.status == 503 && ready.body.contains("backpressure"),
            "backpressure was reported ready"
        );
        let head = wire(running.admin, "HEAD", "/ready")?;
        ensure!(
            head.status == 503
                && head.body.is_empty()
                && head.header("content-length") == ready.header("content-length"),
            "failed readiness HEAD differs"
        );
        ensure!(
            wire(running.admin, "GET", "/health")?.status == 200,
            "liveness followed storage readiness"
        );
        let metrics = wire(running.admin, "GET", "/metrics")?;
        ensure!(
            metrics.status == 200 && metrics.body.contains("oxigraph_ready 0\n"),
            "not-ready gauge absent"
        );
        ensure!(
            !metrics.body.contains("private-")
                && !metrics.body.contains("urn:")
                && !metrics.body.contains("receipt")
                && !metrics.body.contains("535353"),
            "private data in metrics"
        );
    }
    Ok(())
}

#[test]
fn invalid_admin_configuration_rejects_before_store_open() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let unopened = directory.path().join("must-not-exist");
    for address in [
        "0.0.0.0:9797",
        "192.0.2.1:9797",
        "[::]:9797",
        "localhost:9797",
        "127.0.0.1:0",
    ] {
        let output = command()
            .args(["serve", "--admin-bind", address, "--location"])
            .arg(&unopened)
            .output()?;
        ensure!(
            !output.status.success(),
            "invalid admin bind accepted: {address}"
        );
        ensure!(!unopened.exists(), "invalid admin bind opened storage");
    }
    Ok(())
}

#[test]
fn occupied_admin_port_exits_and_releases_the_public_listener() -> Result<()> {
    let public = reserved()?;
    let occupied = reserved()?;
    let public_address = public.local_addr()?;
    let occupied_address = occupied.local_addr()?;
    drop(public);
    let mut child = ChildGuard(
        command()
            .args([
                "serve",
                "--bind",
                &public_address.to_string(),
                "--admin-bind",
                &occupied_address.to_string(),
            ])
            .spawn()?,
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.0.try_wait()? {
            ensure!(!status.success(), "occupied admin bind returned success");
            break;
        }
        ensure!(
            Instant::now() < deadline,
            "CLI did not exit after admin bind failure"
        );
        thread::sleep(Duration::from_millis(20));
    }
    ensure!(
        TcpStream::connect(public_address).is_err(),
        "public listener survived failed CLI startup"
    );
    Ok(())
}
