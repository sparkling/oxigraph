use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const IO_TIMEOUT: Duration = Duration::from_secs(3);
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(5);

pub struct ResponseSpec {
    status: &'static str,
    content_type: Option<&'static str>,
    body: &'static str,
    delay: Duration,
}

impl ResponseSpec {
    pub const fn ok(content_type: &'static str, body: &'static str) -> Self {
        Self {
            status: "200 OK",
            content_type: Some(content_type),
            body,
            delay: Duration::ZERO,
        }
    }

    pub const fn status(status: &'static str, body: &'static str) -> Self {
        Self {
            status,
            content_type: Some("text/plain"),
            body,
            delay: Duration::ZERO,
        }
    }

    pub const fn delayed(content_type: &'static str, body: &'static str, delay: Duration) -> Self {
        Self {
            status: "200 OK",
            content_type: Some(content_type),
            body,
            delay,
        }
    }
}

pub struct ObservedRequest {
    method: String,
    target: String,
    body: String,
    headers: Vec<(String, String)>,
}

impl ObservedRequest {
    pub fn method(&self) -> &str {
        &self.method
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn body(&self) -> &str {
        &self.body
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

pub struct TestEndpoint {
    iri: String,
    handle: JoinHandle<io::Result<Vec<ObservedRequest>>>,
}

impl TestEndpoint {
    pub fn spawn(responses: Vec<ResponseSpec>) -> io::Result<Self> {
        if responses.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a test endpoint needs at least one response",
            ));
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let handle = thread::spawn(move || serve(&listener, responses));
        Ok(Self {
            iri: format!("http://{address}/sparql"),
            handle,
        })
    }

    pub fn finish(self) -> io::Result<Vec<ObservedRequest>> {
        self.handle
            .join()
            .map_err(|_| io::Error::other("test endpoint thread panicked"))?
    }

    pub fn iri(&self) -> &str {
        &self.iri
    }
}

fn serve(listener: &TcpListener, responses: Vec<ResponseSpec>) -> io::Result<Vec<ObservedRequest>> {
    let mut requests = Vec::with_capacity(responses.len());
    for response in responses {
        let mut stream = accept_until(listener)?;
        stream.set_read_timeout(Some(IO_TIMEOUT))?;
        stream.set_write_timeout(Some(IO_TIMEOUT))?;
        requests.push(read_request(&mut stream)?);
        if !response.delay.is_zero() {
            thread::sleep(response.delay);
        }
        let mut head = format!(
            "HTTP/1.1 {}\r\nContent-Length: {}\r\nConnection: close\r\n",
            response.status,
            response.body.len()
        );
        if let Some(content_type) = response.content_type {
            head.push_str("Content-Type: ");
            head.push_str(content_type);
            head.push_str("\r\n");
        }
        head.push_str("\r\n");
        write_allowing_timeout_disconnect(&mut stream, head.as_bytes())?;
        write_allowing_timeout_disconnect(&mut stream, response.body.as_bytes())?;
        drop(stream.shutdown(Shutdown::Write));
    }
    Ok(requests)
}

fn accept_until(listener: &TcpListener) -> io::Result<TcpStream> {
    let deadline = Instant::now() + ACCEPT_TIMEOUT;
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false)?;
                return Ok(stream);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "SPARQL client did not connect to the test endpoint",
                    ));
                }
                thread::sleep(Duration::from_millis(2));
            }
            Err(error) => return Err(error),
        }
    }
}

fn read_request(stream: &mut TcpStream) -> io::Result<ObservedRequest> {
    let mut bytes = Vec::new();
    let header_end = loop {
        if let Some(position) = find_header_end(&bytes) {
            break position;
        }
        read_more(stream, &mut bytes)?;
    };
    let head = std::str::from_utf8(&bytes[..header_end])
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut lines = head.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing request line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing request method"))?
        .to_owned();
    let target = request_parts
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing request target"))?
        .to_owned();
    let headers = lines
        .map(|line| {
            let (name, value) = line.split_once(':').ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "malformed request header")
            })?;
            Ok((name.to_ascii_lowercase(), value.trim().to_owned()))
        })
        .collect::<io::Result<Vec<_>>>()?;
    let content_length = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .map(|(_, value)| value.parse::<usize>())
        .transpose()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        .unwrap_or_default();
    let body_start = header_end + 4;
    while bytes.len() < body_start + content_length {
        read_more(stream, &mut bytes)?;
    }
    let body = String::from_utf8(bytes[body_start..body_start + content_length].to_vec())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(ObservedRequest {
        method,
        target,
        body,
        headers,
    })
}

fn read_more(stream: &mut TcpStream, bytes: &mut Vec<u8>) -> io::Result<()> {
    let mut buffer = [0; 4096];
    let count = stream.read(&mut buffer)?;
    if count == 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "HTTP request ended before its declared body",
        ));
    }
    bytes.extend_from_slice(&buffer[..count]);
    Ok(())
}

fn write_allowing_timeout_disconnect(stream: &mut TcpStream, bytes: &[u8]) -> io::Result<()> {
    match stream.write_all(bytes) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::BrokenPipe
                    | io::ErrorKind::ConnectionAborted
                    | io::ErrorKind::ConnectionReset
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}
