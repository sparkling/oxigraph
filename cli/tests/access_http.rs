#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI authentication wire contracts"
)]
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::fmt::Write as _;
use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const READER: &str = "private-reader-subject";
const WRITER: &str = "private-writer-subject";
const OPERATOR: &str = "private-operator-subject";

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        drop(self.0.kill());
        drop(self.0.wait());
    }
}
struct Running {
    child: ChildGuard,
    command: Command,
    public: SocketAddr,
    admin: SocketAddr,
    policy: PathBuf,
    workload_policy: Option<PathBuf>,
    directory: assert_fs::TempDir,
    readiness_method: &'static str,
    startup_log_offset: usize,
}
fn binary() -> std::ffi::OsString {
    // Reuse the same native tests against an explicitly identified release artifact.
    std::env::var_os("OXIGRAPH_ACCESS_TEST_BINARY")
        .unwrap_or_else(|| env!("CARGO_BIN_EXE_oxigraph").into())
}
fn config() -> Value {
    let mut rules = Vec::new();
    for subject in [READER, WRITER] {
        for endpoint in ["query", "sparql"] {
            let operations = if subject == WRITER {
                json!(["discovery", "query", "update"])
            } else {
                json!(["discovery", "query"])
            };
            rules.push(json!({"subject":subject,"endpoint":endpoint,"methods":["GET","HEAD","POST","QUERY","OPTIONS"],"operations":operations,"workload_class":"default"}));
        }
        rules.push(json!({"subject":subject,"endpoint":"ui","methods":["GET","HEAD"],"operations":["discovery"],"workload_class":"default"}));
    }
    rules.push(json!({"subject":WRITER,"endpoint":"update","methods":["GET","POST","OPTIONS"],"operations":["discovery","update"],"workload_class":"default"}));
    rules.push(json!({"subject":WRITER,"endpoint":"graph-store","methods":["GET","HEAD","PUT","POST","DELETE","OPTIONS"],"operations":["graph-read","graph-write"],"graphs":[{"kind":"all"}],"workload_class":"default"}));
    rules.push(json!({"subject":READER,"endpoint":"graph-store","methods":["GET","HEAD","OPTIONS"],"operations":["graph-read"],"graphs":[{"kind":"named-graph","iri":"urn:allowed"}],"workload_class":"default"}));
    for endpoint in ["health", "ready", "metrics", "audit", "access-policy"] {
        rules.push(json!({"subject":OPERATOR,"endpoint":endpoint,"methods":["GET","HEAD","POST"],"operations":["health","operator"],"workload_class":"default"}));
    }
    json!({"format":"oxigraph-access-v1","policy_id":"test-policy","version":1,
        "proxy":{"peers":["127.0.0.1"],"issuer":"fixture-edge","audience":"fixture-store","version":1,"max_lifetime_seconds":60},
        "anonymous_liveness":true,"workload_classes":["default"],"rules":rules})
}
fn workload_reload_config() -> Value {
    let mut policy = config();
    policy["rules"]
        .as_array_mut()
        .expect("rules array")
        .push(json!({"subject":OPERATOR,"endpoint":"workload-policy","methods":["POST"],"operations":["operator"],"workload_class":"default"}));
    policy
}
fn assertion(subject: &str, version: u64) -> Result<Value> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    Ok(
        json!({"scheme":"oxigraph-proxy-v1","subject":subject,"issuer":"fixture-edge","audience":"fixture-store","proxy_version":version,"issued_at":now,"expires_at":now+60}),
    )
}
fn identity(subject: &str, version: u64) -> Result<String> {
    Ok(format!(
        "Oxigraph-Identity: {}\r\n",
        assertion(subject, version)?
    ))
}
fn write_policy(path: &Path, policy: &Value) -> Result<()> {
    // Operator-style atomic replacement: requests never see half a JSON file.
    let temporary = path.with_extension("next");
    std::fs::write(&temporary, serde_json::to_vec(policy)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}
fn start(policy: &Value, read_only: bool) -> Result<Running> {
    start_with_workload(policy, read_only, None)
}
fn start_with_workload(
    policy: &Value,
    read_only: bool,
    workload: Option<&Value>,
) -> Result<Running> {
    start_with_workload_entailment(policy, read_only, workload, None)
}
fn start_with_workload_entailment(
    policy: &Value,
    read_only: bool,
    workload: Option<&Value>,
    entailment: Option<&str>,
) -> Result<Running> {
    retry_initial_bind(|| {
        try_start_with_workload_entailment(policy, read_only, workload, entailment)
    })
}

fn retry_initial_bind<T>(mut start: impl FnMut() -> Result<T>) -> Result<T> {
    for attempt in 1..=3 {
        let result = start();
        if attempt < 3
            && result.as_ref().err().is_some_and(|error| {
                error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == ErrorKind::AddrInUse)
            })
        {
            // The released port-zero reservations can race another socket bind.
            // Only initial fixture setup retries, with fresh ports and store.
            // Running::drop has already reaped the failed child. Restart tests
            // call wait_ready directly and never receive this retry.
            continue;
        }
        return result;
    }
    unreachable!()
}

#[test]
fn initial_bind_retry_is_bounded_and_does_not_retry_other_failures() -> Result<()> {
    let mut calls = 0;
    let error = retry_initial_bind::<()>(|| {
        calls += 1;
        Err(std::io::Error::new(ErrorKind::AddrInUse, "fixture bind").into())
    })
    .unwrap_err();
    ensure!(calls == 3 && error.to_string() == "fixture bind");
    calls = 0;
    let error = retry_initial_bind::<()>(|| {
        calls += 1;
        Err(std::io::Error::other("real startup failure").into())
    })
    .unwrap_err();
    ensure!(calls == 1 && error.to_string() == "real startup failure");
    calls = 0;
    retry_initial_bind(|| {
        calls += 1;
        if calls == 1 {
            Err(std::io::Error::new(ErrorKind::AddrInUse, "fixture bind").into())
        } else {
            Ok(())
        }
    })?;
    ensure!(calls == 2);
    Ok(())
}

fn try_start_with_workload_entailment(
    policy: &Value,
    read_only: bool,
    workload: Option<&Value>,
    entailment: Option<&str>,
) -> Result<Running> {
    let directory = assert_fs::TempDir::new()?;
    let location = directory.path().join("store");
    if read_only {
        drop(oxigraph::store::Store::open(&location)?);
    }
    let policy_path = directory.path().join("access.json");
    write_policy(&policy_path, policy)?;
    let public = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let admin = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let public_address = public.local_addr()?;
    let admin_address = admin.local_addr()?;
    let mut command = Command::new(binary());
    command
        .arg(if read_only {
            "serve-read-only"
        } else {
            "serve"
        })
        .arg("--location")
        .arg(location)
        .arg("--access-policy")
        .arg(&policy_path)
        .args([
            "--bind",
            &public_address.to_string(),
            "--admin-bind",
            &admin_address.to_string(),
            "--cors",
        ])
        .env_remove("NOTIFY_SOCKET")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(std::fs::File::create(directory.path().join("stderr.log"))?);
    if let Some(entailment) = entailment {
        command.arg("--entailment").arg(entailment);
    }
    let workload_path = if let Some(workload) = workload {
        let path = directory.path().join("workload.json");
        std::fs::write(&path, serde_json::to_vec(workload)?)?;
        command.arg("--workload-policy").arg(&path);
        Some(path)
    } else {
        None
    };
    drop(public);
    drop(admin);
    let mut running = Running {
        child: ChildGuard(command.spawn()?),
        command,
        public: public_address,
        admin: admin_address,
        policy: policy_path,
        workload_policy: workload_path,
        directory,
        // An explicit result cap may be smaller than the generated readiness
        // representation. Keep the readiness request bodyless in that case;
        // the zero-cap fixture in particular must not require response bytes.
        readiness_method: if workload.is_some_and(|profile| !profile["max_result_bytes"].is_null())
        {
            "HEAD"
        } else {
            "GET"
        },
        startup_log_offset: 0,
    };
    wait_ready(&mut running)?;
    Ok(running)
}
fn wait_ready(running: &mut Running) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = running.child.0.try_wait()? {
            let stderr = std::fs::read_to_string(running.directory.path().join("stderr.log"))
                .context("reading CLI startup failure log")?;
            let diagnostic = format!("CLI exited before startup ({status}): {stderr}");
            // Match only the actual native bind diagnostic, not an arbitrary
            // failure containing a similar phrase. Preserve it on exhaustion.
            #[cfg(target_os = "linux")]
            if status.code() == Some(1)
                && stderr.trim() == format!("Error: {}", std::io::Error::from_raw_os_error(98))
            {
                return Err(std::io::Error::new(ErrorKind::AddrInUse, diagnostic).into());
            }
            anyhow::bail!(diagnostic);
        }
        // `serve` emits this exact line only after both listeners bind and
        // `started` becomes true. Liveness alone (or CORS preflight, which
        // bypasses the data gate) is insufficient. `/ready` cannot be the
        // fixture barrier when a test intentionally denies all proxy peers or
        // forbids every generated response byte. Each restart needs a NEW line.
        let stderr = std::fs::read_to_string(running.directory.path().join("stderr.log"))?;
        let announced = startup_announced(&stderr, running.startup_log_offset, running.public);
        if announced
            && request(running.admin, running.readiness_method, "/health", "", "")
                .is_ok_and(|response| response.status == 200)
        {
            running.startup_log_offset = stderr.len();
            return Ok(());
        }
        ensure!(
            Instant::now() < deadline,
            "startup timed out: fresh startup announcement={announced}"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn startup_announced(stderr: &str, offset: usize, public: SocketAddr) -> bool {
    let expected = format!("Listening for requests at http://{public}");
    stderr
        .get(offset..)
        .is_some_and(|tail| tail.lines().any(|line| line == expected))
}

#[test]
fn startup_barrier_rejects_partial_or_previous_process_announcements() {
    let address: SocketAddr = (Ipv4Addr::LOCALHOST, 12345).into();
    let previous = format!("Listening for requests at http://{address}\n");
    assert!(!startup_announced("Opening store\n", 0, address));
    assert!(startup_announced(&previous, 0, address));
    assert!(!startup_announced(&previous, previous.len(), address));
    assert!(!startup_announced(
        &format!("{previous}Opening store\n"),
        previous.len(),
        address,
    ));
    assert!(startup_announced(
        &format!("{previous}Opening store\n{previous}"),
        previous.len(),
        address,
    ));
}

#[test]
fn startup_failure_reports_exit_status_and_cli_diagnostic() -> Result<()> {
    let directory = assert_fs::TempDir::new()?;
    let mut command = Command::new(binary());
    command
        .arg("--oxigraph-test-invalid-option")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(std::fs::File::create(directory.path().join("stderr.log"))?);
    let mut running = Running {
        child: ChildGuard(command.spawn()?),
        command,
        public: (Ipv4Addr::LOCALHOST, 0).into(),
        admin: (Ipv4Addr::LOCALHOST, 0).into(),
        policy: directory.path().join("unused.json"),
        workload_policy: None,
        directory,
        readiness_method: "GET",
        startup_log_offset: 0,
    };
    let error = wait_ready(&mut running).unwrap_err().to_string();
    let status = running.child.0.wait()?;
    ensure!(!status.success());
    ensure!(
        error.contains(&format!("CLI exited before startup ({status}):")),
        "{error}"
    );
    ensure!(error.contains("--oxigraph-test-invalid-option"), "{error}");
    Ok(())
}

#[test]
fn authenticated_write_rollback_and_restart_journey() -> Result<()> {
    write_rollback_and_restart(start(&config(), false)?)
}

#[test]
fn workload_write_rollback_and_restart_journey() -> Result<()> {
    write_rollback_and_restart(start_with_workload(
        &config(),
        false,
        Some(&workload(2, 2, 500)),
    )?)
}

fn write_rollback_and_restart(mut running: Running) -> Result<()> {
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:persisted> <urn:p> <urn:o> }; CREATE GRAPH <urn:allowed>"
        )?
        .status
            == 204
    );
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:rolled-back> <urn:p> <urn:o> }; CREATE GRAPH <urn:allowed>"
        )?
        .status
            == 500
    );
    running.child.0.kill()?;
    running.child.0.wait()?;
    running.child = ChildGuard(running.command.spawn()?);
    wait_ready(&mut running)?;
    for (subject, expected) in [("urn:persisted", true), ("urn:rolled-back", false)] {
        let response = sparql(
            &running,
            READER,
            "/query",
            &format!("ASK {{ <{subject}> <urn:p> <urn:o> }}"),
        )?;
        ensure!(
            response.status == 200
                && serde_json::from_str::<Value>(&response.body)?["boolean"] == expected
        );
    }
    ensure!(
        request(
            running.public,
            "GET",
            "/store?graph=urn:allowed",
            &identity(READER, 1)?,
            ""
        )?
        .status
            == 200
    );
    ensure!(request(running.public, "GET", "/query", "", "")?.status == 401);
    Ok(())
}
struct Wire {
    status: u16,
    head: String,
    body: String,
}
fn request(
    address: SocketAddr,
    method: &str,
    target: &str,
    headers: &str,
    body: &str,
) -> Result<Wire> {
    wire(
        address,
        &format!(
            "{method} {target} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}",
            body.len()
        ),
    )
}
fn wire(address: SocketAddr, request: &str) -> Result<Wire> {
    wire_bytes(address, request.as_bytes())
}
fn wire_bytes(address: SocketAddr, request: &[u8]) -> Result<Wire> {
    let result = raw_wire_bytes(address, request)?;
    decode_wire(&result)
}
fn raw_wire_bytes(address: SocketAddr, request: &[u8]) -> Result<String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    stream.write_all(request)?;
    let mut result = String::new();
    match stream.read_to_string(&mut result) {
        Ok(_) => (),
        Err(error) if error.kind() == ErrorKind::ConnectionReset => (),
        Err(error) => return Err(error.into()),
    }
    Ok(result)
}
fn decode_wire(result: &str) -> Result<Wire> {
    let (head, body) = result
        .split_once("\r\n\r\n")
        .context("missing final response")?;
    let status = head
        .split_whitespace()
        .nth(1)
        .context("missing status")?
        .parse()?;
    let mut decoded = String::new();
    if head
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        let mut rest = body;
        loop {
            let (size, tail) = rest.split_once("\r\n").context("chunk size missing")?;
            let size = usize::from_str_radix(size, 16)?;
            if size == 0 {
                break;
            }
            ensure!(tail.len() >= size + 2, "short chunk");
            decoded.push_str(&tail[..size]);
            rest = &tail[size + 2..];
        }
    } else {
        decoded.push_str(body);
    }
    Ok(Wire {
        status,
        head: head.to_owned(),
        body: decoded,
    })
}
fn sparql(running: &Running, subject: &str, route: &str, body: &str) -> Result<Wire> {
    let content = if route == "/update" {
        "application/sparql-update"
    } else {
        "application/sparql-query"
    };
    request(
        running.public,
        "POST",
        route,
        &format!(
            "{}Content-Type: {content}\r\nAccept: application/sparql-results+json\r\n",
            identity(subject, 1)?
        ),
        body,
    )
}

#[test]
fn every_route_authenticates_before_body_or_resource_disclosure() -> Result<()> {
    let running = start(&config(), false)?;
    for path in [
        "/",
        "/yasgui.min.js",
        "/yasgui.min.css",
        "/logo.svg",
        "/query",
        "/update",
        "/sparql",
        "/store",
        "/store/direct",
        "/store?graph=urn:hidden",
        "/store?graph=%GG",
        "/absent",
    ] {
        for method in [
            "GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "QUERY",
        ] {
            let response = wire(
                running.public,
                &format!(
                    "{method} {path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000000\r\nExpect: 100-continue\r\n\r\n"
                ),
            )?;
            ensure!(
                response.status == 401 && response.body.is_empty(),
                "unauthenticated {method} {path}: {}",
                response.status
            );
            ensure!(
                !response.head.contains("100 Continue")
                    && response.head.contains("connection: close")
            );
        }
    }
    for path in [
        "/ready",
        "/metrics",
        "/access/audit",
        "/access/policy/reload",
        "/absent",
    ] {
        ensure!(request(running.admin, "GET", path, "", "")?.status == 401);
    }
    ensure!(request(running.admin, "GET", "/health", "", "")?.status == 200);
    ensure!(request(running.admin, "GET", "/ready", &identity(READER, 1)?, "")?.status == 403);
    ensure!(request(running.public, "GET", "/absent", &identity(READER, 1)?, "")?.status == 403);
    Ok(())
}

#[test]
fn identity_envelope_rejects_spoofing_expiry_and_ambiguity() -> Result<()> {
    let running = start(&config(), false)?;
    let valid = assertion(READER, 1)?;
    let mut invalid = vec![json!({}), json!({"subject":READER}), valid.clone()];
    invalid[2]["extra"] = json!("not allowed");
    for (field, value) in [
        ("issuer", json!("wrong")),
        ("audience", json!("wrong")),
        ("proxy_version", json!(2)),
        ("scheme", json!("other")),
        ("subject", json!("private\ncredential")),
        ("expires_at", json!(0)),
        ("issued_at", json!(u64::MAX)),
        ("expires_at", json!(u64::MAX)),
    ] {
        let mut assertion = valid.clone();
        assertion[field] = value;
        invalid.push(assertion);
    }
    for assertion in invalid {
        let response = request(
            running.public,
            "GET",
            "/query",
            &format!("Oxigraph-Identity: {assertion}\r\n"),
            "",
        )?;
        ensure!(response.status == 401 && response.body.is_empty());
    }
    for header in [
        format!("{}{}", identity(READER, 1)?, identity(READER, 1)?),
        "Oxigraph-Identity: {\"subject\":\"a\",\"subject\":\"b\"}\r\n".into(),
        format!("Oxigraph-Identity: {}\r\n", "x".repeat(2049)),
        "X-Forwarded-For: 127.0.0.1\r\nAuthorization: Bearer private-token\r\n".into(),
    ] {
        ensure!(request(running.public, "GET", "/query", &header, "")?.status == 401);
    }
    let mut wrong_peer = config();
    wrong_peer["proxy"]["peers"] = json!(["192.0.2.1"]);
    let untrusted = start(&wrong_peer, false)?;
    ensure!(
        request(
            untrusted.public,
            "GET",
            "/query",
            &format!("{}X-Forwarded-For: 192.0.2.1\r\n", identity(READER, 1)?),
            ""
        )?
        .status
            == 401
    );
    Ok(())
}

#[test]
fn whole_operation_and_graph_permissions_preserve_real_store_behavior() -> Result<()> {
    let running = start(&config(), false)?;
    ensure!(sparql(&running,WRITER,"/update","INSERT DATA { <urn:s> <urn:p> <urn:o> }; CREATE GRAPH <urn:allowed>; CREATE GRAPH <urn:hidden>")?.status==204);
    let answer = sparql(
        &running,
        READER,
        "/query",
        "ASK { <urn:s> <urn:p> <urn:o> }",
    )?;
    ensure!(
        answer.status == 200 && serde_json::from_str::<Value>(&answer.body)?["boolean"] == true
    );
    ensure!(
        sparql(
            &running,
            READER,
            "/update",
            "INSERT DATA { <urn:denied> <urn:p> <urn:o> }"
        )?
        .status
            == 403
    );
    ensure!(
        serde_json::from_str::<Value>(
            &sparql(
                &running,
                WRITER,
                "/query",
                "ASK { <urn:denied> <urn:p> <urn:o> }"
            )?
            .body
        )?["boolean"]
            == false
    );
    ensure!(
        request(
            running.public,
            "GET",
            "/store?graph=urn%3Aallowed",
            &identity(READER, 1)?,
            ""
        )?
        .status
            == 200
    );
    for path in [
        "/store?graph=urn:hidden",
        "/store?graph=urn:missing",
        "/store?default",
        "/store",
        "/store/direct",
    ] {
        let denied = request(running.public, "GET", path, &identity(READER, 1)?, "")?;
        ensure!(
            denied.status == 403 && denied.body.is_empty(),
            "protected {path} leaked"
        );
    }
    let form = "query=ASK%20%7B%7D";
    let headers = format!(
        "{}Content-Type: application/x-www-form-urlencoded\r\n",
        identity(READER, 1)?
    );
    ensure!(request(running.public, "POST", "/sparql", &headers, form)?.status == 403);
    ensure!(request(running.public, "POST", "/query", &headers, form)?.status == 200);
    let headers = format!(
        "{}Content-Type: application/x-www-form-urlencoded\r\n",
        identity(WRITER, 1)?
    );
    ensure!(request(running.public, "POST", "/sparql", &headers, form)?.status == 200);
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:rolled-back> <urn:p> <urn:o> }; CREATE GRAPH <urn:allowed>"
        )?
        .status
            == 500
    );
    ensure!(
        serde_json::from_str::<Value>(
            &sparql(
                &running,
                WRITER,
                "/query",
                "ASK { <urn:rolled-back> <urn:p> <urn:o> }"
            )?
            .body
        )?["boolean"]
            == false
    );
    let read_only = start(&config(), true)?;
    ensure!(
        sparql(
            &read_only,
            WRITER,
            "/update",
            "INSERT DATA { <urn:s> <urn:p> <urn:o> }"
        )?
        .status
            == 403
    );
    ensure!(sparql(&read_only, READER, "/query", "ASK {}")?.status == 200);
    Ok(())
}

#[test]
fn cors_forwarding_and_audit_do_not_bypass_identity() -> Result<()> {
    let running = start(&config(), false)?;
    let preflight = "Origin: https://client.invalid\r\nAccess-Control-Request-Method: POST\r\n";
    ensure!(request(running.public, "OPTIONS", "/query", preflight, "")?.status == 401);
    let allowed = request(
        running.public,
        "OPTIONS",
        "/query",
        &format!("{}{preflight}", identity(READER, 1)?),
        "",
    )?;
    ensure!(allowed.status == 204);
    ensure!(
        allowed
            .head
            .to_ascii_lowercase()
            .contains("access-control-allow-methods: post"),
        "CORS method allowance missing: {}",
        allowed.head
    );
    ensure!(
        request(
            running.public,
            "OPTIONS",
            "/update",
            &format!("{}{preflight}", identity(READER, 1)?),
            ""
        )?
        .status
            == 403
    );
    let headers = format!(
        "{}Accept: text/turtle\r\nX-Forwarded-Host: forged.invalid\r\nX-Forwarded-Proto: https\r\nForwarded: host=forged.invalid;proto=https\r\nAuthorization: Bearer private-token\r\nCookie: private-cookie\r\n",
        identity(READER, 1)?
    );
    let description = request(running.public, "GET", "/query", &headers, "")?;
    ensure!(description.status == 200 && !description.body.contains("forged.invalid"));
    for _ in 0..260 {
        ensure!(
            request(running.public, "GET", "/absent", &identity(READER, 1)?, "")?.status == 403
        );
    }
    let audit = request(
        running.admin,
        "GET",
        "/access/audit",
        &identity(OPERATOR, 1)?,
        "",
    )?;
    ensure!(audit.status == 200);
    let data: Value = serde_json::from_str(&audit.body)?;
    ensure!(
        data["events"].as_array().context("events missing")?.len() == 256
            && data["overwritten"]
                .as_u64()
                .context("overwritten missing")?
                > 0
    );
    for secret in [
        READER,
        WRITER,
        OPERATOR,
        "private-token",
        "private-cookie",
        "forged.invalid",
        "urn:hidden",
    ] {
        ensure!(!audit.body.contains(secret), "audit disclosed raw field");
    }
    ensure!(
        data["events"]
            .as_array()
            .context("events")?
            .iter()
            .any(|event| event["principal_ref"]
                .as_str()
                .is_some_and(|value| value.len() == 32))
    );
    Ok(())
}

#[test]
fn policy_reload_is_atomic_and_requires_operator_authority() -> Result<()> {
    let running = start(&config(), false)?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/access/policy/reload",
            &identity(READER, 1)?,
            ""
        )?
        .status
            == 403
    );
    let mut invalid = config();
    invalid["version"] = json!(2);
    invalid["proxy"]["version"] = json!(2);
    invalid["unknown"] = json!("private-setting");
    write_policy(&running.policy, &invalid)?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/access/policy/reload",
            &identity(OPERATOR, 1)?,
            ""
        )?
        .status
            == 400
    );
    ensure!(sparql(&running, READER, "/query", "ASK {}")?.status == 200);
    let mut candidate = config();
    candidate["version"] = json!(2);
    candidate["proxy"]["version"] = json!(2);
    candidate["rules"]
        .as_array_mut()
        .context("rules")?
        .retain(|rule| rule["subject"] != READER);
    write_policy(&running.policy, &candidate)?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/access/policy/reload",
            &identity(OPERATOR, 1)?,
            ""
        )?
        .status
            == 204
    );
    ensure!(request(running.public, "GET", "/query", &identity(READER, 1)?, "")?.status == 401);
    ensure!(request(running.public, "GET", "/query", &identity(READER, 2)?, "")?.status == 403);
    ensure!(request(running.public, "GET", "/query", &identity(WRITER, 2)?, "")?.status == 200);
    ensure!(
        request(
            running.admin,
            "POST",
            "/access/policy/reload",
            &identity(OPERATOR, 2)?,
            ""
        )?
        .status
            == 400
    );
    Ok(())
}

#[test]
fn reload_retains_in_flight_snapshot_but_readmits_keep_alive_requests() -> Result<()> {
    let running = start(&config(), false)?;
    let mut keep_alive = TcpStream::connect(running.public)?;
    keep_alive.set_read_timeout(Some(Duration::from_secs(3)))?;
    write!(
        keep_alive,
        "HEAD / HTTP/1.1\r\nHost: {}\r\n{}\r\n",
        running.public,
        identity(READER, 1)?
    )?;
    ensure!(read_status_head(&mut keep_alive)? == 200);

    let update = "INSERT DATA { <urn:in-flight> <urn:p> <urn:o> }";
    let mut in_flight = TcpStream::connect(running.public)?;
    in_flight.set_read_timeout(Some(Duration::from_secs(3)))?;
    write!(
        in_flight,
        "POST /update HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/sparql-update\r\nContent-Length: {}\r\nExpect: 100-continue\r\n{}\r\n",
        running.public,
        update.len(),
        identity(WRITER, 1)?
    )?;
    // A real 100 response proves policy v1 admitted the headers before the body.
    ensure!(read_status_head(&mut in_flight)? == 100);
    let mut candidate = config();
    candidate["version"] = json!(2);
    candidate["proxy"]["version"] = json!(2);
    candidate["rules"]
        .as_array_mut()
        .context("rules")?
        .retain(|rule| rule["subject"] != WRITER);
    write_policy(&running.policy, &candidate)?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/access/policy/reload",
            &identity(OPERATOR, 1)?,
            ""
        )?
        .status
            == 204
    );
    in_flight.write_all(update.as_bytes())?;
    ensure!(read_status_head(&mut in_flight)? == 204);

    // The old TCP connection carries no reusable authorization decision.
    write!(
        keep_alive,
        "HEAD / HTTP/1.1\r\nHost: {}\r\n{}\r\n",
        running.public,
        identity(READER, 1)?
    )?;
    ensure!(read_status_head(&mut keep_alive)? == 401);
    ensure!(
        request(
            running.public,
            "POST",
            "/update",
            &format!(
                "{}Content-Type: application/sparql-update\r\n",
                identity(WRITER, 2)?
            ),
            update
        )?
        .status
            == 403
    );
    let result = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\n",
            identity(READER, 2)?
        ),
        "ASK { <urn:in-flight> <urn:p> <urn:o> }",
    )?;
    ensure!(
        result.status == 200 && serde_json::from_str::<Value>(&result.body)?["boolean"] == true
    );
    Ok(())
}

#[test]
fn workload_reload_is_explicit_loopback_operator_only_and_bodyless() -> Result<()> {
    let existing = start_with_workload(&config(), false, Some(&workload(1, 1, 500)))?;
    for (subject, expected) in [(READER, 403), (OPERATOR, 403)] {
        ensure!(
            request(
                existing.admin,
                "POST",
                "/workload/policy/reload",
                &identity(subject, 1)?,
                "",
            )?
            .status
                == expected
        );
    }
    ensure!(request(existing.admin, "POST", "/workload/policy/reload", "", "",)?.status == 401);
    for (headers, expected) in [
        (identity(OPERATOR, 1)?, 403),
        (identity(READER, 1)?, 403),
        (String::new(), 401),
    ] {
        let denied = wire(
            existing.admin,
            &format!(
                "POST /workload/policy/reload HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: 8\r\nExpect: 100-continue\r\n{}\r\n",
                existing.admin, headers
            ),
        )?;
        ensure!(denied.status == expected && denied.body.is_empty());
        ensure!(
            !denied.head.contains("100 Continue"),
            "denied reload requested its malformed body"
        );
    }
    drop(existing);

    let no_workload = start(&workload_reload_config(), false)?;
    let rejected = request(
        no_workload.admin,
        "POST",
        "/workload/policy/reload",
        &identity(OPERATOR, 1)?,
        "",
    )?;
    ensure!(rejected.status == 400 && rejected.body == "{\"error\":\"policy_reload_rejected\"}\n");
    drop(no_workload);

    let policy = workload_reload_config();
    let running = start_with_workload(&policy, false, Some(&workload(1, 1, 500)))?;
    for response in [
        request(
            running.admin,
            "GET",
            "/workload/policy/reload",
            &identity(OPERATOR, 1)?,
            "",
        )?,
        request(
            running.admin,
            "POST",
            "/workload/policy/reload?path=private",
            &identity(OPERATOR, 1)?,
            "",
        )?,
        request(
            running.public,
            "POST",
            "/workload/policy/reload",
            &identity(OPERATOR, 1)?,
            "",
        )?,
    ] {
        ensure!(response.status == 403 && response.body.is_empty());
    }
    let body = request(
        running.admin,
        "POST",
        "/workload/policy/reload",
        &identity(OPERATOR, 1)?,
        "not-empty",
    )?;
    ensure!(body.status == 400 && body.body == "{\"error\":\"body_not_supported\"}\n");
    let chunked = wire(
        running.admin,
        &format!(
            "POST /workload/policy/reload HTTP/1.1\r\nHost: {}\r\nTransfer-Encoding: chunked\r\n{}\r\n0\r\n\r\n",
            running.admin,
            identity(OPERATOR, 1)?
        ),
    )?;
    ensure!(chunked.status == 400 && chunked.body.contains("body_not_supported"));

    let mut next = workload(1, 1, 500);
    next["version"] = json!(2);
    write_policy(
        running
            .workload_policy
            .as_deref()
            .context("workload path missing")?,
        &next,
    )?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/workload/policy/reload",
            &identity(OPERATOR, 1)?,
            "",
        )?
        .status
            == 204
    );
    Ok(())
}

#[test]
fn workload_reload_changes_new_real_limits_but_keeps_admitted_snapshot() -> Result<()> {
    let mut v1 = workload(1, 1, 3000);
    v1["max_result_bytes"] = json!(1024);
    v1["request_body_limits"] = json!({"max_encoded_bytes":1024,"max_decoded_bytes":1024});
    for read_only in [false, true] {
        let running = start_with_workload(&workload_reload_config(), read_only, Some(&v1))?;
        let query = "ASK {}";
        let mut admitted = TcpStream::connect(running.public)?;
        admitted.set_read_timeout(Some(Duration::from_secs(3)))?;
        write!(
            admitted,
            "POST /query HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\nExpect: 100-continue\r\n{}\r\n",
            running.public,
            query.len(),
            identity(READER, 1)?,
        )?;
        ensure!(read_status_head(&mut admitted)? == 100);

        let mut v2 = workload(1, 1, 3000);
        v2["version"] = json!(2);
        v2["max_result_bytes"] = json!(0);
        v2["request_body_limits"] = json!({"max_encoded_bytes":0,"max_decoded_bytes":0});
        write_policy(
            running
                .workload_policy
                .as_deref()
                .context("workload path missing")?,
            &v2,
        )?;
        ensure!(
            request(
                running.admin,
                "POST",
                "/workload/policy/reload",
                &identity(OPERATOR, 1)?,
                "",
            )?
            .status
                == 204
        );
        admitted.write_all(query.as_bytes())?;
        let mut final_response = String::new();
        admitted.read_to_string(&mut final_response)?;
        let final_response = decode_wire(&final_response)?;
        ensure!(final_response.status == 200 && final_response.body.contains("true"));

        let body_limited = sparql(&running, READER, "/query", query)?;
        ensure!(body_limited.status == 413 && body_limited.body.is_empty());
        let result_limited = request(
            running.public,
            "GET",
            "/query?query=ASK%20%7B%7D",
            &format!(
                "{}Accept: application/sparql-results+json\r\n",
                identity(READER, 1)?
            ),
            "",
        )?;
        ensure!(result_limited.status == 503 && result_limited.body.is_empty());

        let mut v3 = v1.clone();
        v3["version"] = json!(3);
        write_policy(
            running
                .workload_policy
                .as_deref()
                .context("workload path missing")?,
            &v3,
        )?;
        ensure!(
            request(
                running.admin,
                "POST",
                "/workload/policy/reload",
                &identity(OPERATOR, 1)?,
                "",
            )?
            .status
                == 204
        );
        ensure!(sparql(&running, READER, "/query", query)?.status == 200);
        if read_only {
            drop(running);
        } else {
            write_rollback_and_restart(running)?;
        }
    }
    Ok(())
}

#[test]
fn path_buffer_reload_keeps_admitted_handle_and_applies_to_new_requests() -> Result<()> {
    let query = "ASK { <urn:a> <urn:p>* ?o }";
    for read_only in [false, true] {
        let mut v1 = workload(1, 1, 3000);
        v1["max_path_buffer_rows"] = json!(2);
        let running = start_with_workload(&workload_reload_config(), read_only, Some(&v1))?;
        ensure!(sparql(&running, READER, "/query", query)?.status == 200);
        let mut admitted = TcpStream::connect(running.public)?;
        admitted.set_read_timeout(Some(Duration::from_secs(3)))?;
        write!(
            admitted,
            "POST /query HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\nExpect: 100-continue\r\n{}\r\n",
            running.public,
            query.len(),
            identity(READER, 1)?,
        )?;
        ensure!(read_status_head(&mut admitted)? == 100);
        let mut v2 = v1.clone();
        v2["version"] = json!(2);
        v2["max_path_buffer_rows"] = json!(1);
        write_policy(
            running
                .workload_policy
                .as_deref()
                .context("workload path missing")?,
            &v2,
        )?;
        ensure!(
            request(
                running.admin,
                "POST",
                "/workload/policy/reload",
                &identity(OPERATOR, 1)?,
                ""
            )?
            .status
                == 204
        );
        // Admission captured v1 before the body was sent. Both the seed set
        // and worklist entry still fit after v2 is installed.
        admitted.write_all(query.as_bytes())?;
        let mut response = String::new();
        admitted.read_to_string(&mut response)?;
        let response = decode_wire(&response)?;
        ensure!(response.status == 200 && response.body.contains("true"));
        let refused = sparql(&running, READER, "/query", query)?;
        ensure!(refused.status == 503 && refused.body.is_empty());
        // Both admitted-v1 handles and the exhausted v2 handle contribute to
        // the same process-local counters; reloading must not reset them.
        assert_path_resource_observations(&running, [3, 5, 1, 2])?;
    }
    Ok(())
}

#[test]
fn aggregate_distinct_reload_keeps_admitted_handle_and_applies_to_new_requests() -> Result<()> {
    let query = "ASK { { SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { VALUES ?p { 1 2 } } } }";
    for read_only in [false, true] {
        let mut v1 = workload(1, 1, 3000);
        v1["max_aggregate_distinct_rows"] = json!(2);
        let running = start_with_workload(&workload_reload_config(), read_only, Some(&v1))?;
        ensure!(sparql(&running, READER, "/query", query)?.status == 200);
        let mut admitted = TcpStream::connect(running.public)?;
        admitted.set_read_timeout(Some(Duration::from_secs(3)))?;
        write!(
            admitted,
            "POST /query HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\nExpect: 100-continue\r\n{}\r\n",
            running.public,
            query.len(),
            identity(READER, 1)?,
        )?;
        ensure!(read_status_head(&mut admitted)? == 100);
        let mut v2 = v1.clone();
        v2["version"] = json!(2);
        v2["max_aggregate_distinct_rows"] = json!(1);
        write_policy(
            running
                .workload_policy
                .as_deref()
                .context("workload path missing")?,
            &v2,
        )?;
        ensure!(
            request(
                running.admin,
                "POST",
                "/workload/policy/reload",
                &identity(OPERATOR, 1)?,
                ""
            )?
            .status
                == 204
        );
        // The v1 request was admitted but has not evaluated its body. It must
        // still admit both distinct keys after the v2 limit has been installed.
        admitted.write_all(query.as_bytes())?;
        let mut final_response = String::new();
        admitted.read_to_string(&mut final_response)?;
        let final_response = decode_wire(&final_response)?;
        ensure!(final_response.status == 200 && final_response.body.contains("true"));
        let refused = sparql(&running, READER, "/query", query)?;
        ensure!(refused.status == 503 && refused.body.is_empty());
    }
    Ok(())
}

#[test]
fn access_reload_may_introduce_unknown_class_until_workload_catches_up() -> Result<()> {
    let running =
        start_with_workload(&workload_reload_config(), false, Some(&workload(1, 1, 500)))?;
    let mut access_v2 = workload_reload_config();
    access_v2["version"] = json!(2);
    access_v2["proxy"]["version"] = json!(2);
    access_v2["workload_classes"] = json!(["default", "unmapped"]);
    for rule in access_v2["rules"].as_array_mut().context("rules")? {
        if rule["subject"] == READER && rule["endpoint"] == "query" {
            rule["workload_class"] = json!("unmapped");
        }
    }
    write_policy(&running.policy, &access_v2)?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/access/policy/reload",
            &identity(OPERATOR, 1)?,
            "",
        )?
        .status
            == 204
    );
    let query_v2 = || {
        request(
            running.public,
            "POST",
            "/query",
            &format!(
                "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\n",
                identity(READER, 2)?
            ),
            "ASK {}",
        )
    };
    ensure!(query_v2()?.status == 503);

    let mut workload_v2 = workload(1, 1, 500);
    workload_v2["version"] = json!(2);
    write_policy(
        running
            .workload_policy
            .as_deref()
            .context("workload path missing")?,
        &workload_v2,
    )?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/workload/policy/reload",
            &identity(OPERATOR, 2)?,
            "",
        )?
        .status
            == 400
    );
    workload_v2["classes"]["unmapped"] = json!({"max_active":1,"max_queued":1});
    write_policy(
        running
            .workload_policy
            .as_deref()
            .context("workload path missing")?,
        &workload_v2,
    )?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/workload/policy/reload",
            &identity(OPERATOR, 2)?,
            "",
        )?
        .status
            == 204
    );
    ensure!(query_v2()?.status == 200);
    Ok(())
}

fn read_status_head(stream: &mut TcpStream) -> Result<u16> {
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        ensure!(head.len() < 8192, "response head too large");
        let mut byte = [0];
        stream.read_exact(&mut byte)?;
        head.push(byte[0]);
    }
    Ok(std::str::from_utf8(&head)?
        .split_whitespace()
        .nth(1)
        .context("status missing")?
        .parse()?)
}

#[test]
fn invalid_or_ambiguous_policy_never_opens_the_store() -> Result<()> {
    oxigraph_cli::access::AccessPolicy::from_json(include_bytes!(
        "../examples/access-policy.json"
    ))?;
    let directory = assert_fs::TempDir::new()?;
    let policy = directory.path().join("access.json");
    let mut bad = config();
    bad["proxy"]["peers"] = json!(["::ffff:127.0.0.1"]);
    for value in [json!({}), bad, json!({"format":"anonymous"})] {
        write_policy(&policy, &value)?;
        for mode in ["serve", "serve-read-only"] {
            let location = directory.path().join(mode);
            let output = Command::new(binary())
                .args([mode, "--bind", "192.0.2.1:7878", "--access-policy"])
                .arg(&policy)
                .arg("--location")
                .arg(&location)
                .env_remove("NOTIFY_SOCKET")
                .output()?;
            ensure!(!output.status.success() && !location.exists());
            ensure!(String::from_utf8(output.stderr)?.contains("access policy rejected"));
        }
    }
    write_policy(&policy, &config())?;
    let output = Command::new(binary())
        .args(["serve", "--access-policy"])
        .arg(&policy)
        .arg("--unsafe-allow-remote-anonymous")
        .output()?;
    ensure!(!output.status.success());
    Ok(())
}

#[test]
fn allowed_direct_graph_iri_round_trips_through_the_shared_target() -> Result<()> {
    let mut policy = config();
    for rule in policy["rules"].as_array_mut().context("rules")? {
        if rule["subject"] == READER && rule["endpoint"] == "graph-store" {
            rule["graphs"] = json!([{"kind":"named-graph","iri":"http://localhost/store/direct"}]);
        }
    }
    let running = start(&policy, false)?;
    let body = "<urn:direct-subject> <urn:p> <urn:o> .";
    let response = wire(
        running.public,
        &format!(
            "PUT /store/direct HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: text/turtle\r\nIf-None-Match: *\r\nContent-Length: {}\r\n{}\r\n{body}",
            body.len(),
            identity(WRITER, 1)?
        ),
    )?;
    ensure!(response.status == 201);
    for method in ["GET", "HEAD"] {
        let response = wire(
            running.public,
            &format!(
                "{method} /store/direct HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAccept: application/n-triples\r\n{}\r\n",
                identity(READER, 1)?
            ),
        )?;
        ensure!(response.status == 200);
        ensure!(if method == "GET" {
            response.body.contains("urn:direct-subject")
        } else {
            response.body.is_empty()
        });
    }
    let indirect = request(
        running.public,
        "GET",
        "/store?graph=http%3A%2F%2Flocalhost%2Fstore%2Fdirect",
        &format!("{}Accept: application/n-triples\r\n", identity(READER, 1)?),
        "",
    )?;
    ensure!(indirect.status == 200 && indirect.body.contains("urn:direct-subject"));
    ensure!(
        request(
            running.public,
            "GET",
            "/store/direct",
            &identity(READER, 1)?,
            ""
        )?
        .status
            == 403,
        "different authority must select a different direct graph"
    );
    Ok(())
}

fn work_counters(running: &Running) -> Result<Vec<String>> {
    let metrics = request(
        running.admin,
        "GET",
        "/metrics",
        &identity(OPERATOR, 1)?,
        "",
    )?;
    ensure!(metrics.status == 200);
    let lines = metrics
        .body
        .lines()
        .filter(|line| {
            [
                "oxigraph_transaction",
                "oxigraph_queries",
                "oxigraph_query_duration",
                "oxigraph_updates",
                "oxigraph_update_duration",
                "oxigraph_egress",
            ]
            .iter()
            .any(|prefix| line.starts_with(prefix))
        })
        .map(str::to_owned)
        .collect::<Vec<_>>();
    ensure!(!lines.is_empty(), "work counters absent");
    Ok(lines)
}

fn metric_counter(running: &Running, sample: &str) -> Result<u64> {
    let metrics = request(
        running.admin,
        "GET",
        "/metrics",
        &identity(OPERATOR, 1)?,
        "",
    )?;
    ensure!(metrics.status == 200);
    let prefix = format!("{sample} ");
    metrics
        .body
        .lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .with_context(|| format!("missing metric sample {sample}"))?
        .parse()
        .map_err(Into::into)
}

#[test]
fn denied_work_never_starts_transactions_evaluation_or_egress() -> Result<()> {
    let running = start(&config(), false)?;
    let trap = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    trap.set_nonblocking(true)?;
    let remote = format!("http://{}/private-denied-resource", trap.local_addr()?);
    let before = work_counters(&running)?;
    let cases = [
        (
            READER,
            "/update",
            "application/sparql-update",
            format!("LOAD <{remote}>"),
        ),
        (
            OPERATOR,
            "/query",
            "application/sparql-query",
            format!("SELECT * WHERE {{ SERVICE <{remote}> {{ ?s ?p ?o }} }}"),
        ),
        (
            READER,
            "/sparql",
            "application/x-www-form-urlencoded",
            "query=ASK%7B%7D&update=malformed-private-query".into(),
        ),
        (
            READER,
            "/store?graph=urn:allowed",
            "text/turtle",
            "malformed-private-graph-body".into(),
        ),
    ];
    for (subject, path, content, body) in cases {
        let response = request(
            running.public,
            "POST",
            path,
            &format!(
                "{}Content-Type: {content}\r\nAuthorization: Bearer private-denied-token\r\nCookie: private-denied-cookie\r\n",
                identity(subject, 1)?
            ),
            &body,
        )?;
        ensure!(
            response.status == 403 && response.body.is_empty(),
            "denial exposed or parsed {path}"
        );
    }
    ensure!(
        work_counters(&running)? == before,
        "denied requests started measured work"
    );
    ensure!(
        trap.accept()
            .is_err_and(|error| error.kind() == ErrorKind::WouldBlock),
        "denied egress connected to local observer"
    );
    let logs = std::fs::read_to_string(running.directory.path().join("stderr.log"))?;
    for private in [
        READER,
        OPERATOR,
        "private-denied-token",
        "private-denied-cookie",
        "private-denied-resource",
        "malformed-private-query",
        "malformed-private-graph-body",
    ] {
        ensure!(!logs.contains(private), "request material reached stderr");
    }
    // Positive controls ensure a constant/empty observer cannot pass this test.
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:positive> <urn:p> <urn:o> }"
        )?
        .status
            == 204
    );
    ensure!(
        sparql(
            &running,
            READER,
            "/query",
            "ASK { <urn:positive> <urn:p> <urn:o> }"
        )?
        .status
            == 200
    );
    ensure!(
        work_counters(&running)? != before,
        "successful work was not measured"
    );
    Ok(())
}

fn workload(queued: usize, class_queued: usize, timeout_ms: u64) -> Value {
    json!({"format":"oxigraph-admission-v1","policy_id":"wire-test","version":1,
        "max_active":1,"max_queued":queued,"operator_max_active":1,"operator_max_queued":0,
        "queue_timeout_ms":timeout_ms,"retry_after_seconds":2,
        "classes":{"default":{"max_active":1,"max_queued":class_queued}}})
}

#[test]
fn result_limits_exact_boolean_and_generated_operator_failures() -> Result<()> {
    let baseline = start(&config(), false)?;
    let full = sparql(&baseline, READER, "/query", "ASK {}")?;
    ensure!(full.status == 200);
    let length = full.body.len();
    drop(baseline);
    for limit in [length, length - 1] {
        let mut profile = workload(1, 1, 1000);
        profile["max_result_bytes"] = json!(limit);
        let running = start_with_workload(&config(), true, Some(&profile))?;
        let response = sparql(&running, READER, "/query", "ASK {}")?;
        if limit == length {
            ensure!(response.status == 200 && response.body == full.body);
        } else {
            ensure!(
                response.status == 503 && response.body.is_empty(),
                "{} {}",
                response.status,
                response.body
            );
            ensure!(response.head.contains("cache-control: no-store"));
        }
        for route in ["/metrics", "/ready", "/access/audit"] {
            let response = request(running.admin, "GET", route, &identity(OPERATOR, 1)?, "")?;
            ensure!(
                response.status == 503 && response.body.is_empty(),
                "{route}: {} {}",
                response.status,
                response.body
            );
        }
        let response = request(running.public, "GET", "/query", &identity(READER, 1)?, "")?;
        ensure!(
            response.status == 503 && response.body.is_empty(),
            "service description: {}",
            response.status
        );
        let response = request(running.public, "GET", "/", &identity(READER, 1)?, "")?;
        ensure!(
            response.status == 503 && response.body.is_empty(),
            "static UI: {}",
            response.status
        );
        ensure!(request(running.public, "GET", "/query", "", "")?.status == 401);
    }
    Ok(())
}

#[test]
fn inner_join_limits_rollback_multi_operation_updates_and_release_the_request() -> Result<()> {
    for limit in [3, 4] {
        let mut profile = workload(1, 1, 1000);
        profile["max_inner_join_build_rows"] = json!(limit);
        let running = start_with_workload(&config(), false, Some(&profile))?;
        ensure!(
            sparql(
                &running,
                WRITER,
                "/update",
                "INSERT DATA {
            <urn:a> <urn:p> 1; <urn:q> 2 . <urn:b> <urn:p> 3; <urn:q> 4 . }"
            )?
            .status
                == 204
        );
        let query = "SELECT ?s WHERE { ?s <urn:p> ?p . ?other <urn:q> ?q }";
        ensure!(sparql(&running, READER, "/query", query)?.status == 200);
        let update = "INSERT DATA { <urn:marker> <urn:start> true };
            INSERT { ?s <urn:first> ?p } WHERE { ?s <urn:p> ?p . ?other <urn:q> ?q };
            INSERT { ?s <urn:second> ?p } WHERE { ?s <urn:p> ?p . ?other <urn:q> ?q };
            INSERT DATA { <urn:marker> <urn:end> true }";
        let response = sparql(&running, WRITER, "/update", update)?;
        if limit == 3 {
            ensure!(
                response.status == 503 && response.body.is_empty(),
                "{} {}",
                response.status,
                response.body
            );
            ensure!(
                response.head.contains("cache-control: no-store")
                    && !response.head.contains("retry-after:")
            );
            let absent = sparql(
                &running,
                READER,
                "/query",
                "ASK { <urn:marker> <urn:start> true }",
            )?;
            ensure!(absent.body.contains("false"), "{}", absent.body);
            let absent = sparql(&running, READER, "/query", "ASK { ?s <urn:first> ?o }")?;
            ensure!(absent.body.contains("false"));
        } else {
            ensure!(
                response.status == 204,
                "{} {}",
                response.status,
                response.body
            );
            ensure!(
                sparql(
                    &running,
                    READER,
                    "/query",
                    "ASK { <urn:marker> <urn:end> true }"
                )?
                .body
                .contains("true")
            );
        }
        // A new admission gets a new budget and the single active slot back.
        ensure!(sparql(&running, READER, "/query", query)?.status == 200);
        write_rollback_and_restart(running)?;
    }
    Ok(())
}

#[test]
fn inner_join_limits_buffered_refusal_and_failed_stream_are_not_success() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["max_inner_join_build_rows"] = json!(1);
    let running = start_with_workload(&config(), false, Some(&profile))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA {
        <urn:a> <urn:p> 1; <urn:q> 2 . <urn:b> <urn:p> 3; <urn:q> 4 . }"
        )?
        .status
            == 204
    );
    let query = "SELECT ?s WHERE { ?s <urn:p> ?p . ?other <urn:q> ?q }";
    let buffered = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        query,
    )?;
    ensure!(
        buffered.status == 503 && buffered.body.is_empty(),
        "{} {}",
        buffered.status,
        buffered.body
    );
    let graph = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/n-triples; version=1.1\r\n",
            identity(READER, 1)?
        ),
        "CONSTRUCT { ?s <urn:out> ?p } WHERE { ?s <urn:p> ?p . ?other <urn:q> ?q }",
    )?;
    ensure!(
        graph.status == 503 && graph.body.is_empty(),
        "{} {}",
        graph.status,
        graph.body
    );
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{query}", identity(READER, 1)?, query.len()).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    let ask = sparql(
        &running,
        READER,
        "/query",
        "ASK { ?s <urn:p> ?p . ?other <urn:q> ?q }",
    )?;
    ensure!(ask.status == 503 && ask.body.is_empty());
    ensure!(sparql(&running, READER, "/query", "ASK { ?s <urn:p> ?p }")?.status == 200);
    Ok(())
}

const SORTED_ROWS: &str = "SELECT ?s WHERE { ?s <urn:p> ?p } ORDER BY ?p";

#[test]
fn sort_buffer_limits_rollback_multi_operation_updates_and_release_the_request() -> Result<()> {
    for limit in [3, 4] {
        let mut profile = workload(1, 1, 1000);
        profile["max_sort_buffer_rows"] = json!(limit);
        let running = start_with_workload(&config(), false, Some(&profile))?;
        ensure!(
            sparql(
                &running,
                WRITER,
                "/update",
                "INSERT DATA { <urn:a> <urn:p> 1 . <urn:b> <urn:p> 2 }"
            )?
            .status
                == 204
        );
        // Each ORDER BY subselect admits two rows: 4 in total across operations.
        let update = "INSERT DATA { <urn:marker> <urn:start> true };
            INSERT { ?s <urn:first> ?p } WHERE {
                { SELECT ?s ?p WHERE { ?s <urn:p> ?p } ORDER BY DESC(?p) } };
            INSERT { ?s <urn:second> ?p } WHERE {
                { SELECT ?s ?p WHERE { ?s <urn:p> ?p } ORDER BY ?p } };
            INSERT DATA { <urn:marker> <urn:end> true }";
        let response = sparql(&running, WRITER, "/update", update)?;
        if limit == 3 {
            ensure!(
                response.status == 503 && response.body.is_empty(),
                "{} {}",
                response.status,
                response.body
            );
            ensure!(
                response.head.contains("cache-control: no-store")
                    && !response.head.contains("retry-after:")
            );
            for absent in [
                "ASK { <urn:marker> <urn:start> true }",
                "ASK { ?s <urn:first> ?o }",
                "ASK { <urn:marker> <urn:end> true }",
            ] {
                let response = sparql(&running, READER, "/query", absent)?;
                ensure!(
                    response.status == 200 && response.body.contains("false"),
                    "{absent}: {} {}",
                    response.status,
                    response.body
                );
            }
        } else {
            ensure!(
                response.status == 204,
                "{} {}",
                response.status,
                response.body
            );
            ensure!(
                sparql(
                    &running,
                    READER,
                    "/query",
                    "ASK { <urn:marker> <urn:end> true . <urn:a> <urn:second> 1 }"
                )?
                .body
                .contains("true")
            );
        }
        // A new admission gets a fresh budget and the single active slot back.
        let response = sparql(&running, READER, "/query", SORTED_ROWS)?;
        ensure!(
            response.status == 200,
            "{} {}",
            response.status,
            response.body
        );
        ensure!(
            serde_json::from_str::<Value>(&response.body)?["results"]["bindings"]
                .as_array()
                .is_some_and(|rows| rows.len() == 2),
            "{}",
            response.body
        );
        write_rollback_and_restart(running)?;
    }
    Ok(())
}

#[test]
fn sort_buffer_limits_buffered_refusal_and_failed_stream_are_not_success() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["max_sort_buffer_rows"] = json!(1);
    let running = start_with_workload(&config(), false, Some(&profile))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA {
        <urn:a> <urn:p> 1; <urn:q> 2 . <urn:b> <urn:p> 3; <urn:q> 4 . }"
        )?
        .status
            == 204
    );
    let buffered = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        SORTED_ROWS,
    )?;
    ensure!(
        buffered.status == 503 && buffered.body.is_empty(),
        "{} {}",
        buffered.status,
        buffered.body
    );
    ensure!(
        buffered.head.contains("cache-control: no-store")
            && !buffered.head.contains("retry-after:")
    );
    let graph = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/n-triples; version=1.1\r\n",
            identity(READER, 1)?
        ),
        "CONSTRUCT { ?s <urn:out> ?p } WHERE { { SELECT ?s ?p WHERE { ?s <urn:p> ?p } ORDER BY ?p } }",
    )?;
    ensure!(
        graph.status == 503 && graph.body.is_empty(),
        "{} {}",
        graph.status,
        graph.body
    );
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{SORTED_ROWS}", identity(READER, 1)?, SORTED_ROWS.len()).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    let ask = sparql(
        &running,
        READER,
        "/query",
        "ASK { { SELECT ?s WHERE { ?s <urn:p> ?p } ORDER BY ?p } }",
    )?;
    ensure!(ask.status == 503 && ask.body.is_empty());
    // The sort cap leaves inner joins uninstrumented, and each request starts
    // a fresh counter: exactly one admitted row succeeds.
    ensure!(
        sparql(
            &running,
            READER,
            "/query",
            "SELECT ?s WHERE { ?s <urn:p> ?p . ?other <urn:q> ?q }"
        )?
        .status
            == 200
    );
    let single = sparql(
        &running,
        READER,
        "/query",
        "SELECT ?p WHERE { <urn:a> <urn:p> ?p } ORDER BY ?p",
    )?;
    ensure!(single.status == 200, "{} {}", single.status, single.body);
    ensure!(
        serde_json::from_str::<Value>(&single.body)?["results"]["bindings"]
            .as_array()
            .is_some_and(|rows| rows.len() == 1)
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn sort_buffer_limit_applies_under_finite_rdf_materialization_then_persists() -> Result<()> {
    let mut profile = workload(1, 1, 3000);
    profile["max_sort_buffer_rows"] = json!(1);
    let running =
        start_with_workload_entailment(&config(), false, Some(&profile), Some("rdf-1.2-finite"))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:a> <urn:p> 1 . <urn:b> <urn:p> 2 }"
        )?
        .status
            == 204
    );
    // Buffered (preflighted) output refuses before headers; streamed output
    // already sent 200 and then fails without a terminating chunk.
    let response = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        SORTED_ROWS,
    )?;
    ensure!(
        response.status == 503 && response.body.is_empty(),
        "{} {}",
        response.status,
        response.body
    );
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{SORTED_ROWS}", identity(READER, 1)?, SORTED_ROWS.len()).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    let response = sparql(
        &running,
        READER,
        "/query",
        "SELECT ?s WHERE { ?s <urn:p> ?p }",
    )?;
    ensure!(
        response.status == 200
            && serde_json::from_str::<Value>(&response.body)?["results"]["bindings"]
                .as_array()
                .is_some_and(|rows| rows.len() == 2),
        "{} {}",
        response.status,
        response.body
    );
    write_rollback_and_restart(running)
}

const GROUP_ROWS: &str = "SELECT ?p (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?p } GROUP BY ?p";

const AGGREGATE_DISTINCT_ROWS: &str = "SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?s <urn:p> ?p }";

#[test]
fn path_buffer_limits_refuse_buffered_output_fail_streams_and_roll_back_updates() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["max_path_buffer_rows"] = json!(3);
    let running = start_with_workload(&config(), false, Some(&profile))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:a> <urn:p> <urn:b> }"
        )?
        .status
            == 204
    );
    let query = "SELECT ?o WHERE { <urn:a> <urn:p>* ?o }";
    let buffered = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        query,
    )?;
    ensure!(
        buffered.status == 503
            && buffered.body.is_empty()
            && buffered.head.contains("cache-control: no-store"),
        "{} {}",
        buffered.status,
        buffered.body
    );
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{query}",
        identity(READER, 1)?, query.len()
    ).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    // Each closure alone fits (two entries); the second operation exhausts
    // the shared request handle, including writes staged before either path.
    let update = "INSERT DATA { <urn:marker> <urn:start> true };
        INSERT { <urn:marker> <urn:first> ?o } WHERE { <urn:x> <urn:q>* ?o };
        INSERT { <urn:marker> <urn:second> ?o } WHERE { <urn:x> <urn:q>* ?o };
        INSERT DATA { <urn:marker> <urn:end> true }";
    let refused = sparql(&running, WRITER, "/update", update)?;
    ensure!(refused.status == 503 && refused.body.is_empty());
    ensure!(
        sparql(&running, READER, "/query", "ASK { <urn:marker> ?p ?o }")?
            .body
            .contains("false")
    );
    // Fresh admissions have fresh counters; ordinary writes/queries consume none.
    for _ in 0..2 {
        ensure!(sparql(&running, READER, "/query", "ASK { <urn:x> <urn:q>* ?o }")?.status == 200);
    }
    // Buffered refusal, failed stream and rolled-back update each report their
    // exhausted handle, independently of the request's success or write effect.
    assert_path_resource_observations(&running, [7, 13, 3, 3])?;
    write_rollback_and_restart(running)
}

#[test]
fn aggregate_distinct_limits_refuse_buffered_output_fail_streams_and_roll_back_updates()
-> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["max_aggregate_distinct_rows"] = json!(1);
    let running = start_with_workload(&config(), false, Some(&profile))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:a> <urn:p> 1 . <urn:b> <urn:p> 2 . <urn:c> <urn:p> 1 }"
        )?
        .status
            == 204
    );
    let buffered = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        AGGREGATE_DISTINCT_ROWS,
    )?;
    ensure!(
        buffered.status == 503
            && buffered.body.is_empty()
            && buffered.head.contains("cache-control: no-store"),
        "{} {}",
        buffered.status,
        buffered.body
    );
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{AGGREGATE_DISTINCT_ROWS}", identity(READER, 1)?, AGGREGATE_DISTINCT_ROWS.len()).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    let update = "INSERT DATA { <urn:marker> <urn:start> true };
        INSERT { <urn:marker> <urn:value> ?n } WHERE {
            { SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { ?s <urn:p> ?p } } };
        INSERT DATA { <urn:marker> <urn:end> true }";
    let refused = sparql(&running, WRITER, "/update", update)?;
    ensure!(refused.status == 503 && refused.body.is_empty());
    ensure!(
        sparql(&running, READER, "/query", "ASK { <urn:marker> ?p ?o }")?
            .body
            .contains("false")
    );
    // Each fresh admission gets a fresh aggregate-DISTINCT handle, while
    // ordinary queries and writes do not consume it.
    ensure!(
        sparql(
            &running,
            READER,
            "/query",
            "SELECT ?s WHERE { ?s <urn:p> ?o }"
        )?
        .status
            == 200
    );
    write_rollback_and_restart(running)
}

#[test]
fn group_buffer_limits_rollback_multi_operation_updates_and_release_the_request() -> Result<()> {
    for limit in [3, 4] {
        let mut profile = workload(1, 1, 1000);
        profile["max_group_buffer_rows"] = json!(limit);
        let running = start_with_workload(&config(), false, Some(&profile))?;
        ensure!(
            sparql(
                &running,
                WRITER,
                "/update",
                "INSERT DATA { <urn:a> <urn:p> 1 . <urn:b> <urn:p> 2 . <urn:c> <urn:p> 1 }"
            )?
            .status
                == 204
        );
        // Each GROUP BY subselect retains two groups from three rows:
        // 4 in total across operations.
        let update = "INSERT DATA { <urn:marker> <urn:start> true };
            INSERT { <urn:first> <urn:value> ?p } WHERE {
                { SELECT ?p (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?p } GROUP BY ?p } };
            INSERT { <urn:second> <urn:value> ?p } WHERE {
                { SELECT ?p (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?p } GROUP BY ?p } };
            INSERT DATA { <urn:marker> <urn:end> true }";
        let response = sparql(&running, WRITER, "/update", update)?;
        if limit == 3 {
            ensure!(
                response.status == 503 && response.body.is_empty(),
                "{} {}",
                response.status,
                response.body
            );
            ensure!(
                response.head.contains("cache-control: no-store")
                    && !response.head.contains("retry-after:")
            );
            for absent in [
                "ASK { <urn:marker> <urn:start> true }",
                "ASK { <urn:first> <urn:value> ?o }",
                "ASK { <urn:marker> <urn:end> true }",
            ] {
                let response = sparql(&running, READER, "/query", absent)?;
                ensure!(
                    response.status == 200 && response.body.contains("false"),
                    "{absent}: {} {}",
                    response.status,
                    response.body
                );
            }
        } else {
            ensure!(
                response.status == 204,
                "{} {}",
                response.status,
                response.body
            );
            ensure!(
                sparql(
                    &running,
                    READER,
                    "/query",
                    "ASK { <urn:marker> <urn:end> true . <urn:second> <urn:value> 1 }"
                )?
                .body
                .contains("true")
            );
        }
        // A new admission gets a fresh budget and the single active slot back.
        let response = sparql(&running, READER, "/query", GROUP_ROWS)?;
        ensure!(
            response.status == 200,
            "{} {}",
            response.status,
            response.body
        );
        ensure!(
            serde_json::from_str::<Value>(&response.body)?["results"]["bindings"]
                .as_array()
                .is_some_and(|rows| rows.len() == 2),
            "{}",
            response.body
        );
        write_rollback_and_restart(running)?;
    }
    Ok(())
}

#[test]
fn group_buffer_limits_buffered_refusal_and_failed_stream_are_not_success() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["max_group_buffer_rows"] = json!(1);
    let running = start_with_workload(&config(), false, Some(&profile))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA {
        <urn:a> <urn:p> 1; <urn:q> 2 . <urn:b> <urn:p> 3; <urn:q> 4 . <urn:c> <urn:p> 1 }"
        )?
        .status
            == 204
    );
    let buffered = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        GROUP_ROWS,
    )?;
    ensure!(
        buffered.status == 503 && buffered.body.is_empty(),
        "{} {}",
        buffered.status,
        buffered.body
    );
    ensure!(
        buffered.head.contains("cache-control: no-store")
            && !buffered.head.contains("retry-after:")
    );
    let graph = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/n-triples; version=1.1\r\n",
            identity(READER, 1)?
        ),
        "CONSTRUCT { <urn:out> <urn:value> ?p } WHERE { { SELECT ?p (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?p } GROUP BY ?p } }",
    )?;
    ensure!(
        graph.status == 503 && graph.body.is_empty(),
        "{} {}",
        graph.status,
        graph.body
    );
    // Streaming serialization may send headers before observing the eager
    // grouping failure. It must never finish as a successful truncated result.
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{GROUP_ROWS}", identity(READER, 1)?, GROUP_ROWS.len()).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    // A buffered outer aggregate refuses before headers as well.
    let count = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        "SELECT (COUNT(*) AS ?c) WHERE { { SELECT ?p (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?p } GROUP BY ?p } }",
    )?;
    ensure!(
        count.status == 503 && count.body.is_empty(),
        "{} {}",
        count.status,
        count.body
    );
    // The group cap leaves inner joins and sorts uninstrumented, and each
    // request starts a fresh counter: exactly one group succeeds.
    ensure!(
        sparql(
            &running,
            READER,
            "/query",
            "SELECT ?s WHERE { ?s <urn:p> ?p . ?other <urn:q> ?q } ORDER BY ?p"
        )?
        .status
            == 200
    );
    let single = sparql(
        &running,
        READER,
        "/query",
        "SELECT ?p (COUNT(*) AS ?n) WHERE { ?s <urn:p> ?p FILTER(?p = 1) } GROUP BY ?p",
    )?;
    ensure!(single.status == 200, "{} {}", single.status, single.body);
    ensure!(
        serde_json::from_str::<Value>(&single.body)?["results"]["bindings"]
            .as_array()
            .is_some_and(|rows| rows.len() == 1)
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn group_buffer_limit_applies_under_finite_rdf_materialization_then_persists() -> Result<()> {
    let mut profile = workload(1, 1, 3000);
    profile["max_group_buffer_rows"] = json!(1);
    let running =
        start_with_workload_entailment(&config(), false, Some(&profile), Some("rdf-1.2-finite"))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:a> <urn:p> 1 . <urn:b> <urn:p> 2 . <urn:c> <urn:p> 1 }"
        )?
        .status
            == 204
    );
    // Materialization must keep the same cumulative group handle.
    let response = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        GROUP_ROWS,
    )?;
    ensure!(
        response.status == 503 && response.body.is_empty(),
        "{} {}",
        response.status,
        response.body
    );
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{GROUP_ROWS}", identity(READER, 1)?, GROUP_ROWS.len()).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    let response = sparql(
        &running,
        READER,
        "/query",
        "SELECT ?s WHERE { ?s <urn:p> ?p }",
    )?;
    ensure!(
        response.status == 200
            && serde_json::from_str::<Value>(&response.body)?["results"]["bindings"]
                .as_array()
                .is_some_and(|rows| rows.len() == 3),
        "{} {}",
        response.status,
        response.body
    );
    write_rollback_and_restart(running)
}

const DISTINCT_ROWS: &str = "SELECT DISTINCT ?p WHERE { ?s <urn:p> ?p }";

#[test]
fn distinct_buffer_limits_rollback_multi_operation_updates_and_release_the_request() -> Result<()> {
    for limit in [3, 4] {
        let mut profile = workload(1, 1, 1000);
        profile["max_distinct_buffer_rows"] = json!(limit);
        let running = start_with_workload(&config(), false, Some(&profile))?;
        ensure!(
            sparql(
                &running,
                WRITER,
                "/update",
                "INSERT DATA { <urn:a> <urn:p> 1 . <urn:b> <urn:p> 2 . <urn:c> <urn:p> 1 }"
            )?
            .status
                == 204
        );
        // Each DISTINCT subselect retains two unique values from three rows:
        // 4 in total across operations.
        let update = "INSERT DATA { <urn:marker> <urn:start> true };
            INSERT { <urn:first> <urn:value> ?p } WHERE {
                { SELECT DISTINCT ?p WHERE { ?s <urn:p> ?p } } };
            INSERT { <urn:second> <urn:value> ?p } WHERE {
                { SELECT DISTINCT ?p WHERE { ?s <urn:p> ?p } } };
            INSERT DATA { <urn:marker> <urn:end> true }";
        let response = sparql(&running, WRITER, "/update", update)?;
        if limit == 3 {
            ensure!(
                response.status == 503 && response.body.is_empty(),
                "{} {}",
                response.status,
                response.body
            );
            ensure!(
                response.head.contains("cache-control: no-store")
                    && !response.head.contains("retry-after:")
            );
            for absent in [
                "ASK { <urn:marker> <urn:start> true }",
                "ASK { <urn:first> <urn:value> ?o }",
                "ASK { <urn:marker> <urn:end> true }",
            ] {
                let response = sparql(&running, READER, "/query", absent)?;
                ensure!(
                    response.status == 200 && response.body.contains("false"),
                    "{absent}: {} {}",
                    response.status,
                    response.body
                );
            }
        } else {
            ensure!(
                response.status == 204,
                "{} {}",
                response.status,
                response.body
            );
            ensure!(
                sparql(
                    &running,
                    READER,
                    "/query",
                    "ASK { <urn:marker> <urn:end> true . <urn:second> <urn:value> 1 }"
                )?
                .body
                .contains("true")
            );
        }
        // A new admission gets a fresh budget and the single active slot back.
        let response = sparql(&running, READER, "/query", DISTINCT_ROWS)?;
        ensure!(
            response.status == 200,
            "{} {}",
            response.status,
            response.body
        );
        ensure!(
            serde_json::from_str::<Value>(&response.body)?["results"]["bindings"]
                .as_array()
                .is_some_and(|rows| rows.len() == 2),
            "{}",
            response.body
        );
        write_rollback_and_restart(running)?;
    }
    Ok(())
}

#[test]
fn distinct_buffer_limits_buffered_refusal_and_failed_stream_are_not_success() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["max_distinct_buffer_rows"] = json!(1);
    let running = start_with_workload(&config(), false, Some(&profile))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA {
        <urn:a> <urn:p> 1; <urn:q> 2 . <urn:b> <urn:p> 3; <urn:q> 4 . <urn:c> <urn:p> 1 }"
        )?
        .status
            == 204
    );
    let buffered = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        DISTINCT_ROWS,
    )?;
    ensure!(
        buffered.status == 503 && buffered.body.is_empty(),
        "{} {}",
        buffered.status,
        buffered.body
    );
    ensure!(
        buffered.head.contains("cache-control: no-store")
            && !buffered.head.contains("retry-after:")
    );
    let graph = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/n-triples; version=1.1\r\n",
            identity(READER, 1)?
        ),
        "CONSTRUCT { <urn:out> <urn:value> ?p } WHERE { { SELECT DISTINCT ?p WHERE { ?s <urn:p> ?p } } }",
    )?;
    ensure!(
        graph.status == 503 && graph.body.is_empty(),
        "{} {}",
        graph.status,
        graph.body
    );
    // DISTINCT streams: the first retained row is emitted after the 200
    // headers, then the second unique row is denied and the stream fails
    // without a terminating chunk.
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{DISTINCT_ROWS}", identity(READER, 1)?, DISTINCT_ROWS.len()).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    // A buffered aggregate over the same DISTINCT is refused before headers;
    // an ASK that stops at the first retained row succeeds.
    let count = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        "SELECT (COUNT(*) AS ?c) WHERE { { SELECT DISTINCT ?p WHERE { ?s <urn:p> ?p } } }",
    )?;
    ensure!(
        count.status == 503 && count.body.is_empty(),
        "{} {}",
        count.status,
        count.body
    );
    let ask = sparql(
        &running,
        READER,
        "/query",
        "ASK { { SELECT DISTINCT ?p WHERE { ?s <urn:p> ?p } } }",
    )?;
    ensure!(
        ask.status == 200 && ask.body.contains("true"),
        "{} {}",
        ask.status,
        ask.body
    );
    // The distinct cap leaves inner joins and sorts uninstrumented, and each
    // request starts a fresh counter: exactly one unique row succeeds.
    ensure!(
        sparql(
            &running,
            READER,
            "/query",
            "SELECT ?s WHERE { ?s <urn:p> ?p . ?other <urn:q> ?q } ORDER BY ?p"
        )?
        .status
            == 200
    );
    let single = sparql(
        &running,
        READER,
        "/query",
        "SELECT DISTINCT ?p WHERE { ?s <urn:p> ?p FILTER(?p = 1) }",
    )?;
    ensure!(single.status == 200, "{} {}", single.status, single.body);
    ensure!(
        serde_json::from_str::<Value>(&single.body)?["results"]["bindings"]
            .as_array()
            .is_some_and(|rows| rows.len() == 1)
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn distinct_buffer_limit_applies_under_finite_rdf_materialization_then_persists() -> Result<()> {
    let mut profile = workload(1, 1, 3000);
    profile["max_distinct_buffer_rows"] = json!(1);
    let running =
        start_with_workload_entailment(&config(), false, Some(&profile), Some("rdf-1.2-finite"))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:a> <urn:p> 1 . <urn:b> <urn:p> 2 . <urn:c> <urn:p> 1 }"
        )?
        .status
            == 204
    );
    // Buffered (preflighted) output refuses before headers; streamed output
    // already sent 200 and then fails without a terminating chunk.
    let response = request(
        running.public,
        "POST",
        "/query",
        &format!(
            "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
            identity(READER, 1)?
        ),
        DISTINCT_ROWS,
    )?;
    ensure!(
        response.status == 503 && response.body.is_empty(),
        "{} {}",
        response.status,
        response.body
    );
    let raw = raw_wire_bytes(running.public, format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{DISTINCT_ROWS}", identity(READER, 1)?, DISTINCT_ROWS.len()).as_bytes())?;
    ensure!(raw.starts_with("HTTP/1.1 200 "), "{raw}");
    ensure!(
        decode_wire(&raw).is_err() && !raw.ends_with("0\r\n\r\n") && !raw.contains("exceeded"),
        "{raw}"
    );
    let response = sparql(
        &running,
        READER,
        "/query",
        "SELECT ?s WHERE { ?s <urn:p> ?p }",
    )?;
    ensure!(
        response.status == 200
            && serde_json::from_str::<Value>(&response.body)?["results"]["bindings"]
                .as_array()
                .is_some_and(|rows| rows.len() == 3),
        "{} {}",
        response.status,
        response.body
    );
    write_rollback_and_restart(running)
}

#[test]
fn result_limits_buffered_streaming_conditional_and_persistent_journey() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["max_result_bytes"] = json!(512);
    let running = start_with_workload(&config(), false, Some(&profile))?;
    let mut update = String::from("INSERT DATA { GRAPH <urn:results> {");
    for index in 0..100 {
        write!(update, "<urn:s{index}> <urn:p> \"{}\" .", "x".repeat(80))?;
    }
    update.push_str("} }");
    ensure!(sparql(&running, WRITER, "/update", &update)?.status == 204);
    let query = "SELECT ?s ?o WHERE { GRAPH <urn:results> { ?s <urn:p> ?o } }";
    let headers = format!(
        "{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json; version=1.1\r\n",
        identity(READER, 1)?
    );
    let response = request(running.public, "POST", "/query", &headers, query)?;
    ensure!(
        response.status == 503 && response.body.is_empty(),
        "buffered SELECT: {} {}",
        response.status,
        response.body
    );
    let raw = format!(
        "POST /query HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nContent-Length: {}\r\n\r\n{query}",
        identity(READER, 1)?,
        query.len()
    );
    let response = raw_wire_bytes(running.public, raw.as_bytes())?;
    ensure!(response.starts_with("HTTP/1.1 200 "), "{response}");
    ensure!(
        response.contains("transfer-encoding: chunked"),
        "{response}"
    );
    ensure!(
        decode_wire(&response).is_err(),
        "exhausted stream decoded as complete"
    );
    ensure!(
        !response.contains("limit") && !response.ends_with("0\r\n\r\n"),
        "error text or successful EOF: {response}"
    );
    // A subsequent query fits the single active slot: failed output released it.
    ensure!(
        sparql(
            &running,
            READER,
            "/query",
            "ASK { GRAPH <urn:results> { ?s ?p ?o } }"
        )?
        .status
            == 200
    );
    for (route, body, accept) in [
        (
            "/query",
            "CONSTRUCT { ?s <urn:p> ?o } WHERE { GRAPH <urn:results> { ?s <urn:p> ?o } }",
            "application/n-triples; version=1.1",
        ),
        ("/store?graph=urn:results", "", "application/n-triples"),
        ("/store?graph=urn:results", "", "text/turtle"),
        ("/store?graph=urn:results", "", "application/rdf+xml"),
        (
            "/query",
            query,
            "application/sparql-results+xml; version=1.1",
        ),
    ] {
        let response = request(
            running.public,
            if body.is_empty() { "GET" } else { "POST" },
            route,
            &format!(
                "{}Content-Type: application/sparql-query\r\nAccept: {accept}\r\n",
                identity(WRITER, 1)?
            ),
            body,
        )?;
        ensure!(
            response.status == 503 && response.body.is_empty(),
            "{route}: {} {}",
            response.status,
            response.body
        );
    }
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { GRAPH <urn:small> { <urn:s> <urn:p> <urn:o> } }"
        )?
        .status
            == 204
    );
    let route = "/store?graph=urn:small";
    let response = request(running.public, "GET", route, &identity(WRITER, 1)?, "")?;
    ensure!(response.status == 200 && !response.body.is_empty());
    let etag = response
        .head
        .lines()
        .find_map(|line| line.strip_prefix("etag: "))
        .context("missing graph ETag")?;
    let conditional = request(
        running.public,
        "GET",
        route,
        &format!("{}If-None-Match: {etag}\r\n", identity(WRITER, 1)?),
        "",
    )?;
    ensure!(conditional.status == 304 && conditional.body.is_empty());
    ensure!(
        !conditional.head.contains("content-length:"),
        "304 invented representation length"
    );
    let head = request(running.public, "HEAD", route, &identity(WRITER, 1)?, "")?;
    ensure!(head.status == 200 && head.body.is_empty());
    ensure!(
        head.head
            .contains(&format!("content-length: {}", response.body.len()))
    );
    write_rollback_and_restart(running)
}

#[test]
fn result_limits_zero_allow_empty_commits_and_preserve_request_failures() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["max_result_bytes"] = json!(0);
    profile["request_body_limits"] = json!({"max_encoded_bytes":128,"max_decoded_bytes":128});
    let running = start_with_workload(&config(), false, Some(&profile))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:zero> <urn:p> <urn:o> }"
        )?
        .status
            == 204
    );
    let response = sparql(&running, READER, "/query", "ASK {}")?;
    ensure!(response.status == 503 && response.body.is_empty());
    for (extra, expected) in [
        ("Content-Length: 129\r\n", 413),
        (
            "Content-Length: 0\r\nContent-Encoding: unsupported\r\n",
            415,
        ),
    ] {
        let raw = format!(
            "POST /update HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}Content-Type: application/sparql-update\r\nExpect: 100-continue\r\n{extra}\r\n",
            identity(WRITER, 1)?
        );
        let response = wire(running.public, &raw)?;
        ensure!(
            response.status == expected && response.body.is_empty(),
            "{} {}",
            response.status,
            response.body
        );
    }
    let mut next_policy = config();
    next_policy["version"] = json!(2);
    next_policy["proxy"]["version"] = json!(2);
    write_policy(&running.policy, &next_policy)?;
    ensure!(
        request(
            running.admin,
            "POST",
            "/access/policy/reload",
            &identity(OPERATOR, 1)?,
            ""
        )?
        .status
            == 204
    );
    drop(running.child);
    let store = oxigraph::store::Store::open(running.directory.path().join("store"))?;
    ensure!(store.contains(&oxigraph::model::Quad::new(
        oxigraph::model::NamedNode::new("urn:zero")?,
        oxigraph::model::NamedNode::new("urn:p")?,
        oxigraph::model::NamedNode::new("urn:o")?,
        oxigraph::model::GraphName::DefaultGraph,
    ))?);
    Ok(())
}

fn bounded_body_wire(
    running: &Running,
    path: &str,
    input: &[u8],
    encoding: Option<&str>,
    chunked: bool,
) -> Result<Wire> {
    let mut head = format!(
        "POST {path} HTTP/1.1\r\nHost: localhost\r\n{}Content-Type: application/sparql-update\r\nConnection: close\r\n",
        identity(WRITER, 1)?
    );
    if let Some(encoding) = encoding {
        write!(head, "Content-Encoding: {encoding}\r\n")?;
    }
    if chunked {
        head.push_str("Transfer-Encoding: chunked\r\n\r\n");
        let mut bytes = head.into_bytes();
        bytes.extend_from_slice(format!("{:x}\r\n", input.len()).as_bytes());
        bytes.extend_from_slice(input);
        bytes.extend_from_slice(b"\r\n0\r\n\r\n");
        wire_bytes(running.public, &bytes)
    } else {
        write!(head, "Content-Length: {}\r\n\r\n", input.len())?;
        let mut bytes = head.into_bytes();
        bytes.extend_from_slice(input);
        wire_bytes(running.public, &bytes)
    }
}

#[test]
fn request_body_limits_refuse_framing_and_expansion_before_rdf_work() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["request_body_limits"] = json!({"max_encoded_bytes":512,"max_decoded_bytes":256});
    let running = start_with_workload(&config(), false, Some(&profile))?;
    let before = work_counters(&running)?;
    for length in [257, 513] {
        let response = wire(
            running.public,
            &format!(
                "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Expect: 100-continue\r\nContent-Length: {length}\r\n\r\n",
                identity(WRITER, 1)?
            ),
        )?;
        ensure!(
            response.status == 413
                && response
                    .head
                    .to_ascii_lowercase()
                    .contains("connection: close")
        );
    }
    let response = wire(
        running.public,
        "POST /update HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Length: 99999\r\n\r\n",
    )?;
    ensure!(
        response.status == 401,
        "byte limits bypassed authentication"
    );
    let mut update = b"INSERT DATA { <urn:oversize> <urn:p> <urn:o> } #".to_vec();
    update.resize(1000, b'x');
    let gzip = {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&update)?;
        encoder.finish()?
    };
    let deflate = {
        let mut encoder =
            flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&update)?;
        encoder.finish()?
    };
    for chunked in [false, true] {
        for (body, encoding) in [
            (&update, None),
            (&gzip, Some("gzip")),
            (&deflate, Some("deflate")),
        ] {
            ensure!(bounded_body_wire(&running, "/update", body, encoding, chunked)?.status == 413);
        }
        for path in [
            "/store?graph=urn:allowed",
            "/store?graph=urn:allowed&no_transaction",
        ] {
            ensure!(bounded_body_wire(&running, path, &update, None, chunked)?.status == 413);
        }
    }
    ensure!(
        bounded_body_wire(&running, "/update", b"invalid gzip", Some("gzip"), false)?.status == 400
    );
    ensure!(
        bounded_body_wire(&running, "/update", b"unsupported", Some("br"), false)?.status == 415
    );
    let denied_operator = request(
        running.admin,
        "GET",
        "/ready",
        &identity(OPERATOR, 1)?,
        &"x".repeat(257),
    )?;
    ensure!(denied_operator.status == 413);
    ensure!(
        work_counters(&running)? == before,
        "rejected body entered RDF work"
    );
    // An exact decoded-boundary request is accepted, rather than always denying.
    let mut exact = b"INSERT DATA { <urn:exact> <urn:p> <urn:o> } #".to_vec();
    exact.resize(256, b'x');
    ensure!(bounded_body_wire(&running, "/update", &exact, None, true)?.status == 204);
    let response = sparql(
        &running,
        READER,
        "/query",
        "ASK { <urn:oversize> <urn:p> <urn:o> }",
    )?;
    ensure!(
        response.status == 200
            && serde_json::from_str::<Value>(&response.body)?["boolean"] == false
    );
    let response = sparql(
        &running,
        READER,
        "/query",
        "ASK { <urn:exact> <urn:p> <urn:o> }",
    )?;
    ensure!(
        response.status == 200 && serde_json::from_str::<Value>(&response.body)?["boolean"] == true
    );
    write_rollback_and_restart(running)
}

#[test]
fn request_body_limits_accept_compressed_updates_and_read_only_queries() -> Result<()> {
    let mut profile = workload(1, 1, 1000);
    profile["request_body_limits"] = json!({"max_encoded_bytes":512,"max_decoded_bytes":256});
    let running = start_with_workload(&config(), false, Some(&profile))?;
    for (subject, encoding) in [("gzip", "gzip"), ("deflate", "deflate")] {
        let update = format!("INSERT DATA {{ <urn:{subject}> <urn:p> <urn:o> }}");
        let encoded = if encoding == "gzip" {
            let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(update.as_bytes())?;
            e.finish()?
        } else {
            let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(update.as_bytes())?;
            e.finish()?
        };
        ensure!(
            bounded_body_wire(&running, "/update", &encoded, Some(encoding), true)?.status == 204
        );
        let response = sparql(
            &running,
            READER,
            "/query",
            &format!("ASK {{ <urn:{subject}> <urn:p> <urn:o> }}"),
        )?;
        ensure!(
            response.status == 200
                && serde_json::from_str::<Value>(&response.body)?["boolean"] == true
        );
    }
    let read_only = start_with_workload(&config(), true, Some(&profile))?;
    ensure!(sparql(&read_only, READER, "/query", "ASK {}").is_ok_and(|r| r.status == 200));
    let before = work_counters(&read_only)?;
    ensure!(
        sparql(
            &read_only,
            READER,
            "/query",
            &format!("ASK {{}} #{}", "x".repeat(256))
        )?
        .status
            == 413
    );
    ensure!(work_counters(&read_only)? == before);
    write_rollback_and_restart(running)
}

#[test]
fn workload_deadline_closes_stalled_body_then_allows_write_rollback_restart() -> Result<()> {
    let mut profile = workload(1, 1, 3000);
    profile["request_timeout_ms"] = json!(1000);
    let running = start_with_workload(&config(), false, Some(&profile))?;
    let before = work_counters(&running)?;
    let mut occupied = occupy_admission(&running)?;
    let mut response = Vec::new();
    match occupied.read_to_end(&mut response) {
        Ok(_) => (),
        Err(error) if error.kind() == ErrorKind::ConnectionReset => (),
        Err(error) => return Err(error.into()),
    }
    ensure!(response.is_empty(), "expired body returned a final success");
    ensure!(
        work_counters(&running)? == before,
        "incomplete body entered RDF work"
    );
    write_rollback_and_restart(running)
}

#[cfg(feature = "rdf-12")]
#[test]
fn finite_rdf_workload_deadline_supports_inference_and_persistent_journey() -> Result<()> {
    let mut profile = workload(1, 1, 3000);
    profile["request_timeout_ms"] = json!(3000);
    let running =
        start_with_workload_entailment(&config(), false, Some(&profile), Some("rdf-1.2-finite"))?;
    ensure!(
        sparql(
            &running,
            WRITER,
            "/update",
            "INSERT DATA { <urn:seed> <urn:predicate> <urn:object> }"
        )?
        .status
            == 204
    );
    let response = sparql(
        &running,
        READER,
        "/query",
        "ASK { <urn:predicate> a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> }",
    )?;
    ensure!(
        response.status == 200,
        "{} {}",
        response.status,
        response.body
    );
    ensure!(serde_json::from_str::<Value>(&response.body)?["boolean"] == true);
    write_rollback_and_restart(running)
}

#[cfg(feature = "rdfs")]
#[test]
fn finite_rdfs_workload_deadline_supports_inference_and_persistent_journey() -> Result<()> {
    let mut profile = workload(1, 1, 3000);
    profile["request_timeout_ms"] = json!(5000);
    let running =
        start_with_workload_entailment(&config(), false, Some(&profile), Some("rdfs-1.2-finite"))?;
    ensure!(sparql(&running, WRITER, "/update",
        "INSERT DATA { <urn:seed> <urn:predicate> <urn:object> . <urn:predicate> <http://www.w3.org/2000/01/rdf-schema#domain> <urn:Class> }")?.status == 204);
    let response = sparql(
        &running,
        READER,
        "/query",
        "ASK { <urn:seed> a <urn:Class> }",
    )?;
    ensure!(
        response.status == 200,
        "{} {}",
        response.status,
        response.body
    );
    ensure!(serde_json::from_str::<Value>(&response.body)?["boolean"] == true);
    write_rollback_and_restart(running)
}

#[cfg(all(feature = "rdf-12", feature = "owl2-rl"))]
#[test]
fn owl_workload_deadline_supports_inference_and_persistent_journey() -> Result<()> {
    let mut profile = workload(1, 1, 3000);
    profile["request_timeout_ms"] = json!(5000);
    let running = start_with_workload_entailment(
        &config(),
        false,
        Some(&profile),
        Some("owl2-rl-rdf-bounded"),
    )?;
    ensure!(sparql(&running, WRITER, "/update",
        "INSERT DATA { <urn:seed> <urn:predicate> <urn:object> . <urn:predicate> <http://www.w3.org/2002/07/owl#inverseOf> <urn:inverse> }")?.status == 204);
    let response = sparql(
        &running,
        READER,
        "/query",
        "ASK { <urn:object> <urn:inverse> <urn:seed> }",
    )?;
    ensure!(
        response.status == 200,
        "{} {}",
        response.status,
        response.body
    );
    ensure!(serde_json::from_str::<Value>(&response.body)?["boolean"] == true);
    write_rollback_and_restart(running)
}

fn occupy_admission(running: &Running) -> Result<TcpStream> {
    let mut stream = TcpStream::connect(running.public)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    write!(
        stream,
        "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Content-Type: application/sparql-update\r\nExpect: 100-continue\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n",
        identity(WRITER, 1)?
    )?;
    let mut interim = vec![0; b"HTTP/1.1 100 Continue\r\n\r\n".len()];
    stream.read_exact(&mut interim)?;
    ensure!(
        interim == b"HTTP/1.1 100 Continue\r\n\r\n",
        "first request not admitted"
    );
    Ok(stream)
}

fn pending_priority_query(running: &Running, subject: &str) -> Result<TcpStream> {
    let mut stream = TcpStream::connect(running.public)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    write!(
        stream,
        "POST /query HTTP/1.1\r\nHost: localhost\r\n{}Content-Type: application/sparql-query\r\nAccept: application/sparql-results+json\r\nExpect: 100-continue\r\nContent-Length: 6\r\nConnection: close\r\n\r\n",
        identity(subject, 1)?
    )?;
    Ok(stream)
}

fn finish_priority_query(stream: &mut TcpStream) -> Result<()> {
    stream.write_all(b"ASK {}")?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let response = decode_wire(&response)?;
    ensure!(response.status == 200, "query status {}", response.status);
    ensure!(serde_json::from_str::<Value>(&response.body)?["boolean"] == true);
    Ok(())
}

fn wait_data_queue(running: &Running, expected: u64) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let queued = metric_counter(running, "oxigraph_admission_queued{pool=\"data\"}")?;
        if queued == expected {
            return Ok(());
        }
        ensure!(Instant::now() < deadline, "queue {queued} != {expected}");
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn workload_priority_bounds_newer_bypasses_and_preserves_fifo_and_restart() -> Result<()> {
    for read_only in [false, true] {
        for max_bypass in [None, Some(0), Some(2)] {
            let mut access = config();
            access["workload_classes"] = json!(["default", "interactive"]);
            for rule in access["rules"].as_array_mut().context("rules missing")? {
                if rule["subject"] == READER {
                    rule["workload_class"] = json!("interactive");
                }
            }
            let mut profile = workload(4, 4, 10_000);
            profile["classes"]["interactive"] = json!({"max_active":1,"max_queued":4});
            if let Some(limit) = max_bypass {
                profile["priority_scheduling"] = json!({
                    "max_bypass":limit,
                    "class_priorities":{"default":0,"interactive":3}
                });
            }
            let running = start_with_workload(&access, read_only, Some(&profile))?;
            let before = work_counters(&running)?;
            let mut held = pending_priority_query(&running, WRITER)?;
            ensure!(read_status_head(&mut held)? == 100);
            let mut pending = Vec::new();
            for subject in [WRITER, READER, READER, READER] {
                pending.push(pending_priority_query(&running, subject)?);
                // Observe enqueue order on the live controller, not a sleep or
                // connection-order assumption. The operator reserve stays usable.
                wait_data_queue(&running, pending.len() as u64)?;
            }
            ensure!(
                work_counters(&running)? == before,
                "pre-body work entered evaluation"
            );
            finish_priority_query(&mut held)?;
            let order = if max_bypass == Some(2) {
                [1, 2, 0, 3]
            } else {
                [0, 1, 2, 3]
            };
            for index in order {
                // A wrong winner holds the sole slot with its body withheld,
                // so this exact expected admission fails rather than racing.
                ensure!(
                    read_status_head(&mut pending[index])? == 100,
                    "unexpected admission: read_only={read_only}, max_bypass={max_bypass:?}, index={index}"
                );
                finish_priority_query(&mut pending[index])?;
            }
            wait_data_queue(&running, 0)?;
            if !read_only {
                write_rollback_and_restart(running)?;
            }
        }
    }
    Ok(())
}

#[test]
fn workload_overload_precedes_expect_body_and_work_but_not_auth() -> Result<()> {
    for (queued, class_queued, expected) in [(0, 0, 503), (1, 0, 429)] {
        let running =
            start_with_workload(&config(), false, Some(&workload(queued, class_queued, 500)))?;
        let before = work_counters(&running)?;
        let occupied = occupy_admission(&running)?;
        let denied = wire(
            running.public,
            &format!(
                "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Expect: 100-continue\r\nContent-Length: invalid\r\n\r\n",
                identity(WRITER, 1)?
            ),
        )?;
        ensure!(
            denied.status == expected && denied.body.is_empty(),
            "wrong overload: {}",
            denied.status
        );
        if expected == 429 {
            ensure!(denied.head.to_ascii_lowercase().contains("retry-after: 2"));
        }
        let unauthorized = wire(
            running.public,
            "POST /update HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Length: invalid\r\n\r\n",
        )?;
        ensure!(unauthorized.status == 401, "overload bypassed auth");
        ensure!(
            request(running.admin, "GET", "/health", "", "")?.status == 200,
            "data saturation consumed operator reserve"
        );
        ensure!(
            work_counters(&running)? == before,
            "overload started RDF work"
        );
        drop(occupied);
        // Disconnect/read failure must release the running slot. A successful
        // positive control rules out a controller that always denies requests.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let response = sparql(
                &running,
                WRITER,
                "/update",
                "INSERT DATA { <urn:admitted> <urn:p> <urn:o> }",
            )?;
            if response.status == 204 {
                break;
            }
            ensure!(
                [429, 503].contains(&response.status) && Instant::now() < deadline,
                "slot did not release: {}",
                response.status
            );
            thread::yield_now();
        }
        let response = sparql(
            &running,
            READER,
            "/query",
            "ASK { <urn:admitted> <urn:p> <urn:o> }",
        )?;
        ensure!(response.status == 200 && response.body.contains("true"));
        ensure!(
            work_counters(&running)? != before,
            "positive work not observed"
        );
    }
    Ok(())
}

#[test]
fn workload_principal_caps_isolate_authenticated_subjects_and_preserve_restart_journey()
-> Result<()> {
    let mut profile = workload(1, 1, 30_000);
    profile["max_active"] = json!(2);
    profile["classes"]["default"]["max_active"] = json!(2);
    profile["principal"] = json!({"max_active":1,"max_queued":0});
    let running = start_with_workload(&config(), false, Some(&profile))?;
    let occupied = occupy_admission(&running)?;
    let same_principal = wire(
        running.public,
        &format!(
            "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Expect: 100-continue\r\nContent-Length: invalid\r\n\r\n",
            identity(WRITER, 1)?
        ),
    )?;
    ensure!(
        same_principal.status == 429
            && same_principal.body.is_empty()
            && same_principal
                .head
                .to_ascii_lowercase()
                .contains("retry-after: 2"),
        "same-principal cap did not refuse: {} {}",
        same_principal.status,
        same_principal.body
    );
    ensure!(
        sparql(&running, READER, "/query", "ASK {}")?.status == 200,
        "another authenticated principal was blocked by a same-principal cap"
    );
    ensure!(request(running.admin, "GET", "/health", "", "")?.status == 200);
    drop(occupied);
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if sparql(&running, WRITER, "/query", "ASK {}")?.status == 200 {
            break;
        }
        ensure!(
            Instant::now() < deadline,
            "same-principal capacity did not release"
        );
        thread::yield_now();
    }
    write_rollback_and_restart(running)
}

#[test]
fn workload_queue_times_out_before_continue_and_remains_usable() -> Result<()> {
    let running = start_with_workload(&config(), false, Some(&workload(1, 1, 40)))?;
    let occupied = occupy_admission(&running)?;
    let response = wire(
        running.public,
        &format!(
            "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Expect: 100-continue\r\nContent-Length: 100\r\n\r\n",
            identity(WRITER, 1)?
        ),
    )?;
    ensure!(response.status == 503 && response.body.is_empty());
    ensure!(request(running.admin, "GET", "/health", "", "")?.status == 200);
    drop(occupied);
    ensure!(sparql(&running, READER, "/query", "ASK {}").is_ok_and(|r| r.status == 200));
    Ok(())
}

fn scrape(running: &Running, method: &str) -> Result<Wire> {
    request(
        running.admin,
        method,
        "/metrics",
        &identity(OPERATOR, 1)?,
        "",
    )
}

fn admission_sample(body: &str, family: &str, labels: &str) -> Result<u64> {
    let prefix = format!("{family}{{{labels}}} ");
    let line = body
        .lines()
        .find(|line| line.starts_with(&prefix))
        .with_context(|| format!("missing sample {prefix}"))?;
    Ok(line[prefix.len()..].parse()?)
}

fn assert_path_resource_observations(running: &Running, expected: [u64; 4]) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let metrics = scrape(running, "GET")?;
        ensure!(metrics.status == 200, "resource scrape: {}", metrics.status);
        let mut actual = [0; 4];
        for (value, family) in actual.iter_mut().zip([
            "oxigraph_workload_resource_observations_total",
            "oxigraph_workload_resource_charged_rows_total",
            "oxigraph_workload_resource_exhausted_total",
            "oxigraph_workload_resource_charged_rows_max",
        ]) {
            *value = admission_sample(
                &metrics.body,
                family,
                "pool=\"data\",resource=\"path_buffer_rows\",phase=\"path_buffer\"",
            )?;
        }
        // Transport EOF can precede final lease cleanup. Wait for that exact
        // observation, not a timing assumption; operator scrapes use a separate pool.
        if actual[0] >= expected[0] {
            ensure!(
                actual == expected,
                "resource observations {actual:?} != {expected:?}"
            );
            let samples: Vec<_> = metrics
                .body
                .lines()
                .filter(|line| line.starts_with("oxigraph_workload_resource_"))
                .collect();
            ensure!(samples.len() == 48, "unexpected resource sample count");
            ensure!(
                samples.iter().all(|line| {
                    line.contains("resource=\"path_buffer_rows\"") || line.ends_with(" 0")
                }),
                "unconfigured resource handle was observed"
            );
            return Ok(());
        }
        ensure!(
            Instant::now() < deadline,
            "final lease not observed: {actual:?} != {expected:?}"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

const ADMISSION_DISPOSITIONS: [&str; 9] = [
    "admitted",
    "refused_global",
    "refused_class",
    "refused_operator",
    "unknown_class",
    "cancelled",
    "request_timed_out",
    "queue_timed_out",
    "unavailable",
];

/// Every admission sample of one pool: (disposition, total, queued).
fn pool_dispositions(body: &str, pool: &str) -> Result<Vec<(&'static str, u64, u64)>> {
    ADMISSION_DISPOSITIONS
        .into_iter()
        .map(|disposition| {
            let labels = format!("pool=\"{pool}\",disposition=\"{disposition}\"");
            Ok((
                disposition,
                admission_sample(body, "oxigraph_admissions_total", &labels)?,
                admission_sample(body, "oxigraph_admissions_queued_total", &labels)?,
            ))
        })
        .collect()
}

#[test]
fn workload_admission_metrics_export_bounded_pool_dispositions() -> Result<()> {
    for (queued, class_queued, disposition, status) in [
        (0, 0, "refused_global", 503),
        (1, 0, "refused_class", 429),
        (1, 1, "queue_timed_out", 503),
    ] {
        let running =
            start_with_workload(&config(), false, Some(&workload(queued, class_queued, 40)))?;
        let before = scrape(&running, "GET")?;
        ensure!(before.status == 200, "authorized scrape failed");
        let lines: Vec<_> = before
            .body
            .lines()
            .filter(|line| line.contains("admission"))
            .collect();
        ensure!(
            lines.iter().filter(|line| !line.starts_with('#')).count() == 60
                && lines
                    .iter()
                    .filter(|line| line.starts_with("# TYPE "))
                    .count()
                    == 5,
            "admission sample cardinality drifted: {}",
            lines.len()
        );
        for line in &lines {
            ensure!(
                line.starts_with("oxigraph_admission")
                    || line.starts_with("# TYPE oxigraph_admission"),
                "family drift: {line}"
            );
            for private in [
                OPERATOR,
                WRITER,
                READER,
                "wire-test",
                "class=",
                "default",
                "urn:",
                "private",
                "endpoint",
                "principal",
            ] {
                ensure!(!line.contains(private), "private material exported: {line}");
            }
        }
        // The scrape is served through its own admitted operator lease.
        ensure!(
            admission_sample(
                &before.body,
                "oxigraph_admission_active",
                "pool=\"operator\""
            )? == 1
                && admission_sample(
                    &before.body,
                    "oxigraph_admission_queued",
                    "pool=\"operator\""
                )? == 0
                && admission_sample(&before.body, "oxigraph_admission_active", "pool=\"data\"")?
                    == 0
                && admission_sample(&before.body, "oxigraph_admission_queued", "pool=\"data\"")?
                    == 0,
            "gauges differ before load"
        );
        let operator_before = pool_dispositions(&before.body, "operator")?;
        let admitted_before = operator_before[0].1;
        ensure!(
            admitted_before >= 1
                && operator_before[1..]
                    .iter()
                    .all(|(_, total, queued)| *total == 0 && *queued == 0)
                && operator_before[0].2 == 0,
            "operator dispositions before load: {operator_before:?}"
        );
        ensure!(
            pool_dispositions(&before.body, "data")?
                .iter()
                .all(|(_, total, queued)| *total == 0 && *queued == 0),
            "data pool observed before any data request"
        );
        // Access rejection precedes admission: denied scrapes are never counted.
        ensure!(
            request(running.admin, "GET", "/metrics", &identity(READER, 1)?, "")?.status == 403
        );
        ensure!(request(running.admin, "GET", "/metrics", "", "")?.status == 401);

        let occupied = occupy_admission(&running)?;
        let body = if disposition == "queue_timed_out" {
            "Content-Length: 100"
        } else {
            "Content-Length: invalid"
        };
        let denied = wire(
            running.public,
            &format!(
                "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Expect: 100-continue\r\n{body}\r\n\r\n",
                identity(WRITER, 1)?
            ),
        )?;
        ensure!(
            denied.status == status && denied.body.is_empty(),
            "wrong overload: {}",
            denied.status
        );
        // HEAD performs the same bounded observation and is itself admitted.
        let head = scrape(&running, "HEAD")?;
        ensure!(
            head.status == 200
                && head.body.is_empty()
                && head.head.to_ascii_lowercase().contains("content-length: "),
            "operator HEAD scrape differs"
        );
        let after = scrape(&running, "GET")?;
        ensure!(
            after.status == 200,
            "occupied data slot consumed the operator reserve"
        );
        let operator_after = pool_dispositions(&after.body, "operator")?;
        ensure!(
            operator_after[0] == ("admitted", admitted_before + 2, 0)
                && operator_after[1..] == operator_before[1..],
            "denied scrapes were counted or authorized ones were not: {operator_after:?}"
        );
        let data_after = pool_dispositions(&after.body, "data")?;
        let queued_expected = u64::from(disposition == "queue_timed_out");
        ensure!(
            data_after.iter().all(|(name, total, queued)| match *name {
                "admitted" => (*total, *queued) == (1, 0),
                name if name == disposition => (*total, *queued) == (1, queued_expected),
                _ => (*total, *queued) == (0, 0),
            }),
            "data dispositions differ: {data_after:?}"
        );
        ensure!(
            admission_sample(&after.body, "oxigraph_admission_active", "pool=\"data\"")? == 1
                && admission_sample(&after.body, "oxigraph_admission_queued", "pool=\"data\"")?
                    == 0
                && admission_sample(
                    &after.body,
                    "oxigraph_admission_active",
                    "pool=\"operator\""
                )? == 1,
            "gauges differ under load"
        );
        let wait_count = admission_sample(
            &after.body,
            "oxigraph_admission_queue_wait_seconds_count",
            "pool=\"data\"",
        )?;
        ensure!(
            wait_count == queued_expected,
            "queue wait observations: {wait_count}"
        );
        ensure!(
            admission_sample(
                &after.body,
                "oxigraph_admission_queue_wait_seconds_count",
                "pool=\"operator\"",
            )? == 0,
            "operator requests never queued"
        );
        if disposition == "queue_timed_out" {
            // At least the 40ms queue timeout elapsed: absent from the 10ms bucket.
            ensure!(
                admission_sample(
                    &after.body,
                    "oxigraph_admission_queue_wait_seconds_bucket",
                    "pool=\"data\",le=\"0.01\"",
                )? == 0
                    && admission_sample(
                        &after.body,
                        "oxigraph_admission_queue_wait_seconds_bucket",
                        "pool=\"data\",le=\"+Inf\"",
                    )? == 1,
                "queue wait buckets differ"
            );
            let sum = after
                .body
                .lines()
                .find_map(|line| {
                    line.strip_prefix("oxigraph_admission_queue_wait_seconds_sum{pool=\"data\"} ")
                })
                .context("missing wait sum")?
                .parse::<f64>()?;
            ensure!(sum >= 0.03, "queue wait sum too small: {sum}");
        }
        drop(occupied);
        // Release after observed disconnect, then a successful write is admitted.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let response = sparql(
                &running,
                WRITER,
                "/update",
                "INSERT DATA { <urn:admitted> <urn:p> <urn:o> }",
            )?;
            if response.status == 204 {
                break;
            }
            ensure!(
                [429, 503].contains(&response.status) && Instant::now() < deadline,
                "slot did not release: {}",
                response.status
            );
            thread::yield_now();
        }
        let released = scrape(&running, "GET")?;
        let data_released = pool_dispositions(&released.body, "data")?;
        ensure!(
            data_released[0].1 >= 2
                && admission_sample(&released.body, "oxigraph_admission_active", "pool=\"data\"")?
                    == 0,
            "release and later admission not observed: {data_released:?}"
        );
        ensure!(
            pool_dispositions(&released.body, "operator")?[0].1 == admitted_before + 3,
            "operator scrapes not counted exactly"
        );
    }
    Ok(())
}

#[cfg(target_os = "linux")]
#[test]
fn workload_queued_reset_frees_slot_and_half_closed_write_survives_restart() -> Result<()> {
    let mut running = start_with_workload(&config(), false, Some(&workload(1, 1, 30_000)))?;
    let mut abandoned = TcpStream::connect(running.public)?;
    abandoned.set_read_timeout(Some(Duration::from_secs(3)))?;
    write!(
        abandoned,
        "GET /query HTTP/1.1\r\nHost: localhost\r\n{}\r\n",
        identity(READER, 1)?
    )?;
    ensure!(abandoned.peek(&mut [0; 1])? > 0);
    // Keep that response unread: dropping this socket later sends a Linux TCP
    // reset, unlike an ordinary FIN that could be a valid write-half-close.
    let occupied = occupy_admission(&running)?;
    let before = work_counters(&running)?;
    let update = "INSERT DATA { <urn:abandoned> <urn:p> <urn:o> }";
    write!(
        abandoned,
        "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Content-Type: application/sparql-update\r\nContent-Length: {}\r\n\r\n{update}",
        identity(WRITER, 1)?,
        update.len()
    )?;
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let audit = request(
            running.admin,
            "GET",
            "/access/audit",
            &identity(OPERATOR, 1)?,
            "",
        )?;
        ensure!(audit.status == 200);
        let audit: Value = serde_json::from_str(&audit.body)?;
        if audit["events"]
            .as_array()
            .context("missing audit events")?
            .iter()
            .filter(|event| event["endpoint"] == "update" && event["allowed"] == true)
            .count()
            >= 2
        {
            break;
        }
        ensure!(
            Instant::now() < deadline,
            "queued request was not authenticated"
        );
        thread::yield_now();
    }
    // Unlike the audit event, overload verifies that the single queue slot is
    // occupied. Unit tests additionally inspect exact controller counters.
    ensure!(request(running.public, "GET", "/query", &identity(READER, 1)?, "")?.status == 503);
    drop(abandoned);

    let successor_update = "INSERT DATA { <urn:half-closed> <urn:p> <urn:o> }";
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut successor = loop {
        let mut candidate = TcpStream::connect(running.public)?;
        candidate.set_read_timeout(Some(Duration::from_millis(100)))?;
        write!(
            candidate,
            "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Content-Type: application/sparql-update\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{successor_update}",
            identity(WRITER, 1)?,
            successor_update.len()
        )?;
        let half_closed = match candidate.shutdown(std::net::Shutdown::Write) {
            Ok(()) => true,
            // An immediate overload response can close/reset before this call.
            // Accept only the actual 503 branch below, never an admitted socket.
            Err(error) if error.kind() == ErrorKind::NotConnected => false,
            Err(error) => return Err(error).context("half-closing successor"),
        };
        match candidate.peek(&mut [0; 1]) {
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                ensure!(
                    half_closed,
                    "unconnected successor cannot prove a valid half-close"
                );
                break candidate;
            }
            Ok(count) if count > 0 => {
                let mut response = String::new();
                // A pre-body rejection may close with unread request bytes and
                // thus a reset. Still require the actual final overload reply.
                match candidate.read_to_string(&mut response) {
                    Ok(_) => (),
                    Err(error) if error.kind() == ErrorKind::ConnectionReset => (),
                    Err(error) => return Err(error).context("reading successor overload"),
                }
                ensure!(
                    response.starts_with("HTTP/1.1 503 "),
                    "unexpected queued response: {response}"
                );
            }
            other => anyhow::bail!("queued successor closed unexpectedly: {other:?}"),
        }
        ensure!(
            Instant::now() < deadline,
            "reset failed to free the queue before its 30s timeout"
        );
    };
    ensure!(
        work_counters(&running)? == before,
        "queued requests entered RDF work"
    );
    drop(occupied);
    successor.set_read_timeout(Some(Duration::from_secs(3)))?;
    let mut response = String::new();
    successor
        .read_to_string(&mut response)
        .context("reading admitted half-closed successor")?;
    ensure!(
        response.starts_with("HTTP/1.1 204 "),
        "half-closed write failed: {response}"
    );
    running.child.0.kill()?;
    running.child.0.wait()?;
    running.child = ChildGuard(running.command.spawn()?);
    wait_ready(&mut running)?;
    for (subject, expected) in [("urn:abandoned", false), ("urn:half-closed", true)] {
        let response = sparql(
            &running,
            READER,
            "/query",
            &format!("ASK {{ <{subject}> <urn:p> <urn:o> }}"),
        )?;
        ensure!(
            response.status == 200
                && serde_json::from_str::<Value>(&response.body)?["boolean"] == expected
        );
    }
    write_rollback_and_restart(running)
}

#[cfg(target_os = "linux")]
#[test]
fn workload_active_reset_cancels_update_before_commit_and_survives_restart() -> Result<()> {
    let mut running = start_with_workload(&config(), false, Some(&workload(0, 0, 30_000)))?;

    // A small retained input drives a much larger duplicate-heavy join without
    // leaving millions of distinct quads if cancellation arrives late.
    let mut seed = String::from("INSERT DATA {");
    for index in 0..1500 {
        write!(seed, "<urn:left:{index}> <urn:left> <urn:value> .")?;
        write!(seed, "<urn:right:{index}> <urn:right> <urn:value> .")?;
    }
    seed.push('}');
    ensure!(sparql(&running, WRITER, "/update", &seed)?.status == 204);

    let cancelled_before =
        metric_counter(&running, "oxigraph_updates_total{outcome=\"cancelled\"}")?;
    let succeeded_before =
        metric_counter(&running, "oxigraph_updates_total{outcome=\"succeeded\"}")?;
    let update = "INSERT DATA { <urn:disconnect-marker> <urn:p> <urn:o> };\n\
        INSERT { <urn:join-result> <urn:p> ?left } WHERE {\n\
          ?left <urn:left> <urn:value> . ?right <urn:right> <urn:value>\n\
        }";

    let mut abandoned = TcpStream::connect(running.public)?;
    abandoned.set_read_timeout(Some(Duration::from_secs(3)))?;
    abandoned.set_write_timeout(Some(Duration::from_secs(3)))?;
    write!(
        abandoned,
        "GET /query?query=ASK%20%7B%7D HTTP/1.1\r\nHost: localhost\r\n{}\r\n",
        identity(READER, 1)?
    )?;
    ensure!(abandoned.peek(&mut [0; 1])? > 0);
    write!(
        abandoned,
        "POST /update HTTP/1.1\r\nHost: localhost\r\n{}Content-Type: application/sparql-update\r\nContent-Length: {}\r\n\r\n{update}",
        identity(WRITER, 1)?,
        update.len()
    )?;

    // These are transport-visible scheduler observations, not a synthetic
    // sleep: the target owns the only data slot across multiple live scrapes,
    // and a separately authenticated request is refused by that ownership.
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut observations = 0;
    while observations < 4 {
        if metric_counter(&running, "oxigraph_admission_active{pool=\"data\"}")? == 1 {
            observations += 1;
        } else {
            observations = 0;
        }
        ensure!(
            Instant::now() < deadline,
            "active update did not retain admission capacity"
        );
    }
    ensure!(
        request(running.public, "GET", "/query", &identity(READER, 1)?, "")?.status == 503,
        "active update did not occupy the only data slot"
    );

    // The unread first response makes this an active Linux reset rather than
    // a FIN. The terminal Store counter below proves evaluator cancellation,
    // rather than treating socket closure alone as the result.
    drop(abandoned);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if metric_counter(&running, "oxigraph_updates_total{outcome=\"cancelled\"}")?
            == cancelled_before + 1
        {
            break;
        }
        ensure!(
            Instant::now() < deadline,
            "active reset did not reach an update cancellation checkpoint"
        );
        thread::yield_now();
    }
    ensure!(
        metric_counter(&running, "oxigraph_updates_total{outcome=\"succeeded\"}")?
            == succeeded_before,
        "abandoned update reported success"
    );

    running.child.0.kill()?;
    running.child.0.wait()?;
    running.child = ChildGuard(running.command.spawn()?);
    wait_ready(&mut running)?;
    for subject in ["urn:disconnect-marker", "urn:join-result"] {
        let response = sparql(
            &running,
            READER,
            "/query",
            &format!("ASK {{ <{subject}> <urn:p> ?o }}"),
        )?;
        ensure!(
            response.status == 200
                && serde_json::from_str::<Value>(&response.body)?["boolean"] == false,
            "cancelled update left data after restart: {subject}"
        );
    }
    write_rollback_and_restart(running)
}

#[test]
fn workload_invalid_or_unmapped_policy_rejects_startup_before_store_open() -> Result<()> {
    for bad in [json!({"format":"unknown"}), workload(0, 0, 100)] {
        let directory = assert_fs::TempDir::new()?;
        let mut access = config();
        access["workload_classes"] = json!(["default", "unmapped"]);
        let access_path = directory.path().join("access.json");
        let workload_path = directory.path().join("workload.json");
        std::fs::write(&access_path, serde_json::to_vec(&access)?)?;
        std::fs::write(&workload_path, serde_json::to_vec(&bad)?)?;
        let location = directory.path().join("must-not-exist");
        let result = Command::new(binary())
            .arg("serve")
            .arg("--location")
            .arg(&location)
            .arg("--access-policy")
            .arg(access_path)
            .arg("--workload-policy")
            .arg(workload_path)
            .env_remove("NOTIFY_SOCKET")
            .output()?;
        ensure!(
            !result.status.success() && !location.exists(),
            "bad profile opened store"
        );
    }
    Ok(())
}
