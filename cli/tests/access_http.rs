#![expect(
    clippy::tests_outside_test_module,
    reason = "native CLI authentication wire contracts"
)]
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
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
    directory: assert_fs::TempDir,
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
    if let Some(workload) = workload {
        let path = directory.path().join("workload.json");
        std::fs::write(&path, serde_json::to_vec(workload)?)?;
        command.arg("--workload-policy").arg(path);
    }
    drop(public);
    drop(admin);
    let mut running = Running {
        child: ChildGuard(command.spawn()?),
        command,
        public: public_address,
        admin: admin_address,
        policy: policy_path,
        directory,
    };
    wait_ready(&mut running)?;
    Ok(running)
}
fn wait_ready(running: &mut Running) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        ensure!(
            running.child.0.try_wait()?.is_none(),
            "CLI exited before startup"
        );
        if request(running.admin, "GET", "/health", "", "")
            .is_ok_and(|response| response.status == 200)
        {
            return Ok(());
        }
        ensure!(Instant::now() < deadline, "startup timed out");
        thread::sleep(Duration::from_millis(10));
    }
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
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    stream.write_all(request.as_bytes())?;
    let mut result = String::new();
    match stream.read_to_string(&mut result) {
        Ok(_) => (),
        Err(error) if error.kind() == ErrorKind::ConnectionReset => (),
        Err(error) => return Err(error.into()),
    }
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
fn owl_workload_deadline_remains_explicitly_unsupported() -> Result<()> {
    let mut profile = workload(1, 1, 3000);
    profile["request_timeout_ms"] = json!(5000);
    let running = start_with_workload_entailment(
        &config(),
        false,
        Some(&profile),
        Some("owl2-rl-rdf-bounded"),
    )?;
    let response = sparql(&running, READER, "/query", "ASK {}")?;
    ensure!(
        response.status == 400,
        "{} {}",
        response.status,
        response.body
    );
    ensure!(
        response
            .body
            .contains("OWL materialization is unsupported with request deadlines")
    );
    Ok(())
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
