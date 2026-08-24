use super::*;
use anyhow::{Context, Result, ensure};
use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};

const TARGET: &str = "/store?graph=http%3A%2F%2Fexample.com%2Fwire";
const TRIPLE: &str = "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n";

#[test]
fn graph_store_operates_over_an_http_1_1_connection() -> Result<()> {
    let store = Store::new()?;
    let (address, _server) = start_server(&store)?;
    let put = request(
        address,
        &format!(
            "PUT {TARGET} HTTP/1.1\r\nHost: {address}\r\nContent-Type: text/turtle\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{TRIPLE}",
            TRIPLE.len()
        ),
    )?;
    ensure!(put.status == 201, "wire PUT returned {}", put.status);

    let get = request(
        address,
        &format!(
            "GET {TARGET} HTTP/1.1\r\nHost: {address}\r\nAccept: application/n-triples\r\nConnection: close\r\n\r\n"
        ),
    )?;
    ensure!(get.status == 200, "wire GET returned {}", get.status);
    ensure!(
        get.header("content-type") == Some("application/n-triples"),
        "wire GET returned the wrong content type"
    );
    ensure!(
        str::from_utf8(&get.body)?.contains("http://example.com/s"),
        "wire GET omitted the stored triple"
    );

    let head = request(
        address,
        &format!(
            "HEAD {TARGET} HTTP/1.1\r\nHost: {address}\r\nAccept: application/n-triples\r\nConnection: close\r\n\r\n"
        ),
    )?;
    ensure!(head.status == 200, "wire HEAD returned {}", head.status);
    ensure!(head.body.is_empty(), "wire HEAD returned a response body");
    ensure!(
        head.header("content-length")
            .and_then(|value| value.parse().ok())
            == Some(get.body.len()),
        "wire HEAD content length {:?} differs from GET body length {}",
        head.header("content-length"),
        get.body.len()
    );

    let delete = request(
        address,
        &format!("DELETE {TARGET} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"),
    )?;
    ensure!(
        delete.status == 204,
        "wire DELETE returned {}",
        delete.status
    );
    let missing = request(
        address,
        &format!("GET {TARGET} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"),
    )?;
    ensure!(
        missing.status == 404,
        "wire GET after DELETE returned {}",
        missing.status
    );
    Ok(())
}

#[test]
fn graph_store_wire_rejects_relative_selectors_and_post_to_missing_graphs() -> Result<()> {
    let store = Store::new()?;
    let (address, _server) = start_server(&store)?;
    for target in ["/store?graph=relative", "/store?graph=%2Frelative%2Fgraph"] {
        let response = request(
            address,
            &format!("GET {target} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"),
        )?;
        ensure!(
            response.status == 400,
            "relative selector {target} returned {}",
            response.status
        );
    }

    for missing in [
        "/store?graph=http%3A%2F%2Fexample.com%2Fmissing",
        "/store/missing-direct",
    ] {
        let response = request(
            address,
            &format!(
                "POST {missing} HTTP/1.1\r\nHost: {address}\r\nContent-Type: text/turtle\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{TRIPLE}",
                TRIPLE.len()
            ),
        )?;
        ensure!(
            response.status == 404,
            "POST to missing graph {missing} returned {}",
            response.status
        );
    }
    ensure!(
        store.named_graphs().next().is_none(),
        "failed POST created a named graph"
    );
    Ok(())
}

#[test]
fn graph_store_root_post_creates_one_graph_and_rejects_dataset_payloads() -> Result<()> {
    let store = Store::new()?;
    let (address, _server) = start_server(&store)?;
    let empty = request(
        address,
        &format!(
            "POST /store HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/n-quads\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ),
    )?;
    ensure!(
        empty.status == 204,
        "empty root POST returned {}",
        empty.status
    );

    let dataset = "<urn:dataset:s> <urn:dataset:p> <urn:dataset:o> <urn:dataset:graph> .\n";
    let rejected = request(
        address,
        &format!(
            "POST /store HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/n-quads\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{dataset}",
            dataset.len()
        ),
    )?;
    ensure!(
        rejected.status == 400,
        "root dataset POST returned {}",
        rejected.status
    );
    ensure!(store.is_empty()?, "rejected dataset POST changed the store");
    ensure!(
        store.named_graphs().next().is_none(),
        "rejected dataset POST created a graph"
    );

    let malformed = "@prefix broken";
    let rejected = request(
        address,
        &format!(
            "POST /store HTTP/1.1\r\nHost: {address}\r\nContent-Type: text/turtle\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{malformed}",
            malformed.len()
        ),
    )?;
    ensure!(
        rejected.status == 400,
        "malformed root graph POST returned {}",
        rejected.status
    );
    ensure!(
        store.named_graphs().next().is_none(),
        "malformed root graph POST leaked its allocated graph"
    );

    let multipart_dataset = concat!(
        "--dataset\r\n",
        "Content-Type: application/n-quads\r\n\r\n",
        "<urn:s> <urn:p> <urn:o> <urn:g> .\r\n",
        "--dataset--\r\n"
    );
    let rejected = request(
        address,
        &format!(
            "POST /store HTTP/1.1\r\nHost: {address}\r\nContent-Type: multipart/form-data; boundary=dataset\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{multipart_dataset}",
            multipart_dataset.len()
        ),
    )?;
    ensure!(
        rejected.status == 400,
        "multipart dataset root POST returned {}",
        rejected.status
    );
    ensure!(
        store.named_graphs().next().is_none(),
        "multipart dataset root POST leaked its allocated graph"
    );

    let created = request(
        address,
        &format!(
            "POST /store HTTP/1.1\r\nHost: {address}\r\nContent-Type: text/turtle\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{TRIPLE}",
            TRIPLE.len()
        ),
    )?;
    ensure!(
        created.status == 201,
        "root graph POST returned {}",
        created.status
    );
    let location = created
        .header("location")
        .context("root graph POST omitted Location")?;
    ensure!(
        location != format!("http://{address}/store"),
        "root graph POST reused the Graph Store IRI"
    );
    ensure!(
        store.named_graphs().collect::<Result<Vec<_>, _>>()?.len() == 1,
        "root graph POST did not create exactly one graph"
    );
    let fetched = request(
        address,
        &format!(
            "GET {location} HTTP/1.1\r\nHost: {address}\r\nAccept: application/n-triples\r\nConnection: close\r\n\r\n"
        ),
    )?;
    ensure!(
        fetched.status == 200,
        "GET of created graph returned {}",
        fetched.status
    );
    ensure!(
        str::from_utf8(&fetched.body)?.contains("http://example.com/s"),
        "created graph omitted the posted triple"
    );
    Ok(())
}

#[test]
fn graph_store_root_dataset_get_put_delete_are_oxigraph_extensions() -> Result<()> {
    let store = Store::new()?;
    let (address, _server) = start_server(&store)?;
    let dataset = concat!(
        "<urn:default:s> <urn:p> <urn:o> .\n",
        "<urn:named:s> <urn:p> <urn:o> <urn:named:g> .\n"
    );
    let put = request(
        address,
        &format!(
            "PUT /store HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/n-quads\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{dataset}",
            dataset.len()
        ),
    )?;
    ensure!(put.status == 204, "extension PUT returned {}", put.status);

    let get = request(
        address,
        &format!(
            "GET /store HTTP/1.1\r\nHost: {address}\r\nAccept: application/n-quads\r\nConnection: close\r\n\r\n"
        ),
    )?;
    ensure!(get.status == 200, "extension GET returned {}", get.status);
    let body = str::from_utf8(&get.body)?;
    ensure!(
        body.contains("urn:default:s") && body.contains("urn:named:g"),
        "extension GET did not serialize the dataset"
    );

    let delete = request(
        address,
        &format!("DELETE /store HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"),
    )?;
    ensure!(
        delete.status == 204,
        "extension DELETE returned {}",
        delete.status
    );
    ensure!(
        store.is_empty()?,
        "extension DELETE did not clear the dataset"
    );
    Ok(())
}

fn start_server(store: &Store) -> Result<(SocketAddr, oxhttp::ListeningServer)> {
    let mut remaining_bind_attempts = 32;
    loop {
        let _bind_guard = HTTP_TEST_BIND_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let address = reserve_address()?;
        let evaluator = SparqlEvaluator::new();
        let server_store = store.clone();
        let server = Server::new(move |request| {
            let method = request.method().clone();
            finalize_response(
                &method,
                handle_request(
                    request,
                    &server_store,
                    &evaluator,
                    false,
                    false,
                    QueryEntailment::Simple,
                    None,
                )
                .unwrap_or_else(|(status, message)| error(status, message)),
            )
        })
        .with_global_timeout(Duration::from_secs(5))
        .bind(address)
        .spawn();
        match server {
            Ok(server) => return Ok((address, server)),
            Err(error) if error.kind() == ErrorKind::AddrInUse && remaining_bind_attempts > 1 => {
                remaining_bind_attempts -= 1;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn reserve_address() -> Result<SocketAddr> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let address = listener.local_addr()?;
    drop(listener);
    Ok(address)
}

fn request(address: SocketAddr, request: &str) -> Result<RawResponse> {
    let mut stream = connect(address)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(request.as_bytes())?;
    stream.shutdown(Shutdown::Write)?;
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    RawResponse::parse(&bytes)
}

fn connect(address: SocketAddr) -> Result<TcpStream> {
    let mut last_error = None;
    for _ in 0..50 {
        match TcpStream::connect_timeout(&address, Duration::from_millis(20)) {
            Ok(stream) => return Ok(stream),
            Err(error) => {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(10));
            }
        }
    }
    Err(last_error
        .context("HTTP server did not accept a connection")?
        .into())
}

struct RawResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl RawResponse {
    fn parse(bytes: &[u8]) -> Result<Self> {
        let split = bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .context("HTTP response has no header terminator")?;
        let head = str::from_utf8(&bytes[..split])?;
        let mut lines = head.split("\r\n");
        let status = lines
            .next()
            .context("HTTP response has no status line")?
            .split_whitespace()
            .nth(1)
            .context("HTTP response has no status code")?
            .parse()?;
        let headers = lines
            .map(|line| {
                let (name, value) = line
                    .split_once(':')
                    .with_context(|| format!("invalid HTTP header line: {line}"))?;
                Ok((name.to_ascii_lowercase(), value.trim().to_owned()))
            })
            .collect::<Result<_>>()?;
        Ok(Self {
            status,
            headers,
            body: bytes[split + 4..].to_vec(),
        })
    }

    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(candidate, _)| candidate == name)
            .map(|(_, value)| value.as_str())
    }
}
