use crate::io::{
    BUFFER_CAPACITY, decode_request_body, decode_request_headers, encode_response,
    encode_response_with_connection,
};
use crate::model::header::{CONNECTION, CONTENT_TYPE, EXPECT, InvalidHeaderValue, SERVER};
use crate::model::request::Builder as RequestBuilder;
use crate::model::{Body, Extensions, HeaderValue, Request, Response, StatusCode, Version};
use std::any::Any;
use std::fmt;
use std::io::{BufReader, BufWriter, Error, ErrorKind, Result, Write, copy, sink};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{Builder as ThreadBuilder, JoinHandle};
use std::time::Duration;

mod deadline;
use deadline::DeadlineWatch;
pub use deadline::RequestDeadline;

/// Socket-derived context for an accepted connection, never taken from HTTP headers.
///
/// Available in every request's extensions, including when no admission hook is installed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ConnectionInfo {
    peer_addr: SocketAddr,
    local_addr: SocketAddr,
}

impl ConnectionInfo {
    /// The immediate TCP peer (not a forwarded client address).
    pub fn peer_addr(self) -> SocketAddr {
        self.peer_addr
    }

    /// The local socket address on which this connection was accepted.
    pub fn local_addr(self) -> SocketAddr {
        self.local_addr
    }
}

type RequestAdmission = dyn Fn(&RequestBuilder, ConnectionInfo) -> std::result::Result<Extensions, Box<Response<Body>>>
    + Send
    + Sync
    + 'static;

/// An optional admission guard held until response encoding and flushing finish,
/// including error/unwind paths. Insert it in the admission hook's extensions.
/// Clones share one guard; application-held clones can extend its lifetime.
#[derive(Clone)]
pub struct RequestLifetime {
    _guard: Arc<dyn Any + Send + Sync>,
}

impl RequestLifetime {
    pub fn new(guard: impl Any + Send + Sync) -> Self {
        Self {
            _guard: Arc::new(guard),
        }
    }
}

/// An HTTP server.
///
/// It uses a very simple threading mechanism: a new thread is started on each connection and closed when the client connection is closed.
/// To avoid crashes it is possible to set an upper bound to the number of concurrent connections using the [`Server::with_max_concurrent_connections`] function.
///
/// ```no_run
/// use std::net::{Ipv4Addr, Ipv6Addr};
/// use oxhttp::Server;
/// use oxhttp::model::{Body, Response, StatusCode};
/// use std::time::Duration;
///
/// // Builds a new server that returns a 404 everywhere except for "/" where it returns the body 'home'
/// let mut server = Server::new(|request| {
///     if request.uri().path() == "/" {
///         Response::builder().body(Body::from("home")).unwrap()
///     } else {
///         Response::builder().status(StatusCode::NOT_FOUND).body(Body::empty()).unwrap()
///     }
/// });
/// // We bind the server to localhost on both IPv4 and v6
/// server = server.bind((Ipv4Addr::LOCALHOST, 8080)).bind((Ipv6Addr::LOCALHOST, 8080));
/// // Raise a timeout error if the client does not respond after 10s.
/// server = server.with_global_timeout(Duration::from_secs(10));
/// // Limits the number of concurrent connections to 128.
/// server = server.with_max_concurrent_connections(128);
/// // We spawn the server and block on it
/// server.spawn()?.join()?;
/// # Result::<_,Box<dyn std::error::Error>>::Ok(())
/// ```
#[allow(missing_copy_implementations)]
pub struct Server {
    #[allow(clippy::type_complexity)]
    on_request: Arc<dyn Fn(&mut Request<Body>) -> Response<Body> + Send + Sync + 'static>,
    request_admission: Option<Arc<RequestAdmission>>,
    socket_addrs: Vec<SocketAddr>,
    timeout: Option<Duration>,
    server: Option<HeaderValue>,
    max_num_thread: Option<usize>,
}

impl Server {
    /// Builds the server using the given `on_request` method that builds a `Response` from a given `Request`.
    #[inline]
    pub fn new(
        on_request: impl Fn(&mut Request<Body>) -> Response<Body> + Send + Sync + 'static,
    ) -> Self {
        Self {
            on_request: Arc::new(on_request),
            request_admission: None,
            socket_addrs: Vec::new(),
            timeout: None,
            server: None,
            max_num_thread: None,
        }
    }

    /// Installs a per-request admission hook after bounded header parsing, before
    /// body decoding, `100 Continue`, or the application handler.
    ///
    /// Return trusted extensions to admit the request, or a final response to
    /// reject it. Rejection closes the connection without decoding or draining
    /// the body. Informational rejection responses become an empty HTTP 500.
    /// Header buffering may read ahead from the socket; this is not a guarantee
    /// that no body bytes have entered the transport buffer.
    ///
    /// The request head is immutable so admission cannot alter message framing.
    /// Returned extensions cannot replace the socket-derived [`ConnectionInfo`].
    /// The hook runs again for each keep-alive request. Without a hook, existing
    /// request handling is unchanged.
    ///
    /// Insert a [`RequestLifetime`] extension to retain an admission lease until
    /// the response has been encoded and flushed (or handling fails). Only that
    /// shared guard is cloned; other extension values are moved into the request.
    /// Removing the guard in a handler cannot release it while the response is
    /// still streaming. An application-held clone can extend its lifetime.
    ///
    /// ```no_run
    /// use oxhttp::{ConnectionInfo, Server};
    /// use oxhttp::model::{Body, Extensions, Response, StatusCode};
    ///
    /// // A transport admission example, not a user-authentication policy.
    /// let server = Server::new(|request| {
    ///     let socket = request.extensions().get::<ConnectionInfo>().unwrap();
    ///     assert!(socket.peer_addr().ip().is_loopback());
    ///     Response::builder().body(Body::empty()).unwrap()
    /// }).with_request_admission(|_head, socket| {
    ///     if socket.peer_addr().ip().is_loopback() {
    ///         Ok(Extensions::new())
    ///     } else {
    ///         Err(Box::new(Response::builder().status(StatusCode::FORBIDDEN)
    ///             .body(Body::empty()).unwrap()))
    ///     }
    /// });
    /// ```
    pub fn with_request_admission(
        mut self,
        admission: impl Fn(
            &RequestBuilder,
            ConnectionInfo,
        ) -> std::result::Result<Extensions, Box<Response<Body>>>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        self.request_admission = Some(Arc::new(admission));
        self
    }

    /// Ask the server to listen to a given socket when spawned.
    pub fn bind(mut self, addr: impl Into<SocketAddr>) -> Self {
        let addr = addr.into();
        if !self.socket_addrs.contains(&addr) {
            self.socket_addrs.push(addr);
        }
        self
    }

    /// Sets the default value for the [`Server`](https://httpwg.org/http-core/draft-ietf-httpbis-semantics-latest.html#field.server) header.
    #[inline]
    pub fn with_server_name(
        mut self,
        server: impl Into<String>,
    ) -> std::result::Result<Self, InvalidHeaderValue> {
        self.server = Some(HeaderValue::try_from(server.into())?);
        Ok(self)
    }

    /// Sets the global timeout value (applies to both read and write).
    #[inline]
    pub fn with_global_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Sets the number maximum number of threads this server can spawn.
    #[inline]
    pub fn with_max_concurrent_connections(mut self, max_num_thread: usize) -> Self {
        self.max_num_thread = Some(max_num_thread);
        self
    }

    /// Spawns the server by listening to the given addresses.
    ///
    /// Note that this is not blocking.
    /// To wait for the server to terminate indefinitely, call [`join`](ListeningServer::join) on the result.
    pub fn spawn(self) -> Result<ListeningServer> {
        let timeout = self.timeout;
        let thread_limit = self.max_num_thread.map(Semaphore::new);
        let listener_threads = self.socket_addrs
                .into_iter()
                .map(|listener_addr| {
                    let listener = TcpListener::bind(listener_addr)?;
                    let thread_name = format!("{listener_addr}: listener thread of OxHTTP");
                    let thread_limit = thread_limit.clone();
                    let on_request = Arc::clone(&self.on_request);
                    let request_admission = self.request_admission.clone();
                    let server = self.server.clone();
                    ThreadBuilder::new().name(thread_name).spawn(move || {
                        for stream in listener.incoming() {
                            match stream {
                                Ok(stream) => {
                                    let peer_addr = match stream.peer_addr() {
                                        Ok(peer) => peer,
                                        Err(error) => {
                                            eprintln!("OxHTTP TCP error when attempting to get the peer address: {error}");
                                            continue;
                                        }
                                    };
                                    if let Err(error) = stream.set_nodelay(true) {
                                        eprintln!("OxHTTP TCP error when attempting to set the TCP_NODELAY option: {error}");
                                    }
                                    let thread_name = format!("{peer_addr}: responding thread of OxHTTP");
                                    let thread_guard = thread_limit.as_ref().map(|s| s.lock());
                                    let on_request = Arc::clone(&on_request);
                                    let request_admission = request_admission.clone();
                                    let server = server.clone();
                                    if let Err(error) = ThreadBuilder::new().name(thread_name).spawn(
                                        move || {
                                            if let Err(error) =
                                                accept_request(stream, &*on_request, request_admission.as_deref(), timeout, &server)
                                            {
                                                eprintln!(
                                                    "OxHTTP TCP error when writing response to {peer_addr}: {error}"
                                                )
                                            }
                                            drop(thread_guard);
                                        }
                                    ) {
                                        eprintln!("OxHTTP thread spawn error: {error}");
                                    }
                                }
                                Err(error) => {
                                    eprintln!("OxHTTP TCP error when opening stream: {error}");
                                }
                            }
                        }
                    })
                })
                .collect::<Result<Vec<_>>>()?;
        Ok(ListeningServer {
            threads: listener_threads,
        })
    }
}

/// Handle to a running server created by [`Server::spawn`].
pub struct ListeningServer {
    threads: Vec<JoinHandle<()>>,
}

impl ListeningServer {
    /// Join the server threads and wait for them indefinitely except in case of crash.
    pub fn join(self) -> Result<()> {
        for thread in self.threads {
            thread.join().map_err(|e| {
                Error::other(if let Ok(e) = e.downcast::<&dyn fmt::Display>() {
                    format!("The server thread panicked with error: {e}")
                } else {
                    "The server thread panicked with an unknown error".into()
                })
            })?;
        }
        Ok(())
    }
}

fn accept_request(
    mut stream: TcpStream,
    on_request: &dyn Fn(&mut Request<Body>) -> Response<Body>,
    request_admission: Option<&RequestAdmission>,
    timeout: Option<Duration>,
    server: &Option<HeaderValue>,
) -> Result<()> {
    let connection = ConnectionInfo {
        peer_addr: stream.peer_addr()?,
        local_addr: stream.local_addr()?,
    };
    stream.set_read_timeout(timeout)?;
    stream.set_write_timeout(timeout)?;
    let mut connection_state = ConnectionState::KeepAlive;
    while connection_state == ConnectionState::KeepAlive {
        let mut admission_denied = false;
        let mut admission_lifetime = None;
        // Declared after the lease: stop/join the timer before releasing capacity.
        let mut deadline_watch = None;
        let mut reader = BufReader::with_capacity(BUFFER_CAPACITY, stream.try_clone()?);
        let (mut response, new_connection_state) = match decode_request_headers(&mut reader, false)
        {
            Ok(mut request) => {
                request.extensions_mut().unwrap().insert(connection);
                match request_admission.map_or_else(
                    || Ok(Extensions::new()),
                    |admission| admission(&request, connection),
                ) {
                    Ok(context) => {
                        let extensions = request.extensions_mut().unwrap();
                        admission_lifetime = context.get::<RequestLifetime>().cloned();
                        if let Some(deadline) = context.get::<RequestDeadline>() {
                            deadline_watch = Some(DeadlineWatch::start(&stream, deadline.0)?);
                        }
                        extensions.extend(context);
                        extensions.insert(connection);
                        // Handles Expect only after admission.
                        if let Some(expect) = request.headers_ref().unwrap().get(EXPECT).cloned() {
                            if request
                                .version_ref()
                                .map_or(true, |v| *v >= Version::HTTP_11)
                                && expect.as_bytes().eq_ignore_ascii_case(b"100-continue")
                            {
                                stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n")?;
                                read_body_and_build_response(request, reader, on_request)
                            } else {
                                (
                                    build_text_response(
                                        StatusCode::EXPECTATION_FAILED,
                                        format!(
                                            "Expect header value '{}' is not supported.",
                                            String::from_utf8_lossy(expect.as_ref())
                                        ),
                                    ),
                                    ConnectionState::Close,
                                )
                            }
                        } else {
                            read_body_and_build_response(request, reader, on_request)
                        }
                    }
                    Err(response) => {
                        admission_denied = true;
                        let mut response = *response;
                        if response.status().is_informational() {
                            response = Response::builder()
                                .status(StatusCode::INTERNAL_SERVER_ERROR)
                                .body(Body::empty())
                                .unwrap();
                        }
                        response
                            .headers_mut()
                            .insert(CONNECTION, HeaderValue::from_static("close"));
                        (response, ConnectionState::Close)
                    }
                }
            }
            Err(error) => {
                if error.kind() == ErrorKind::ConnectionAborted {
                    return Ok(()); // The client is disconnected. Let's ignore this error and do not try to write an answer that won't be received.
                } else {
                    (build_error(error), ConnectionState::Close)
                }
            }
        };
        connection_state = new_connection_state;

        // Additional headers
        if let Some(server) = server {
            response
                .headers_mut()
                .entry(SERVER)
                .or_insert_with(|| server.clone());
        }

        if let Some(watch) = &deadline_watch {
            watch.check()?;
        }
        let writer = BufWriter::with_capacity(BUFFER_CAPACITY, stream);
        stream = if admission_denied {
            encode_response_with_connection(&mut response, writer, true)
        } else {
            encode_response(&mut response, writer)
        }?
        .into_inner()
        .map_err(|e| e.into_error())?;
        if let Some(watch) = &deadline_watch {
            watch.check()?;
        }
        drop(deadline_watch);
        drop(admission_lifetime);
    }
    Ok(())
}

#[derive(Eq, PartialEq, Debug, Copy, Clone)]
enum ConnectionState {
    Close,
    KeepAlive,
}

fn read_body_and_build_response(
    request: RequestBuilder,
    reader: BufReader<TcpStream>,
    on_request: &dyn Fn(&mut Request<Body>) -> Response<Body>,
) -> (Response<Body>, ConnectionState) {
    match decode_request_body(request, reader) {
        Ok(mut request) => {
            let response = on_request(&mut request);
            // We make sure to finish reading the body
            if let Err(error) = copy(request.body_mut(), &mut sink()) {
                (build_error(error), ConnectionState::Close) // TODO: ignore?
            } else {
                let connection_state = request
                    .headers()
                    .get(CONNECTION)
                    .and_then(|v| {
                        v.as_bytes()
                            .eq_ignore_ascii_case(b"close")
                            .then_some(ConnectionState::Close)
                    })
                    .unwrap_or_else(|| {
                        if request.version() <= Version::HTTP_10 {
                            ConnectionState::Close
                        } else {
                            ConnectionState::KeepAlive
                        }
                    });
                (response, connection_state)
            }
        }
        Err(error) => (build_error(error), ConnectionState::Close),
    }
}

fn build_error(error: Error) -> Response<Body> {
    build_text_response(
        match error.kind() {
            ErrorKind::TimedOut => StatusCode::REQUEST_TIMEOUT,
            ErrorKind::InvalidData => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        },
        error.to_string(),
    )
}

fn build_text_response(status: StatusCode, text: String) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(text))
        .unwrap()
}

/// Dumb semaphore allowing to overflow capacity
#[derive(Clone)]
struct Semaphore {
    inner: Arc<InnerSemaphore>,
}

struct InnerSemaphore {
    count: Mutex<usize>,
    capacity: usize,
    condvar: Condvar,
}

impl Semaphore {
    fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new(InnerSemaphore {
                count: Mutex::new(0),
                capacity,
                condvar: Condvar::new(),
            }),
        }
    }

    fn lock(&self) -> SemaphoreGuard {
        let data = &self.inner;
        *data
            .condvar
            .wait_while(data.count.lock().unwrap(), |count| *count >= data.capacity)
            .unwrap() += 1;
        SemaphoreGuard {
            inner: Arc::clone(&self.inner),
        }
    }
}

struct SemaphoreGuard {
    inner: Arc<InnerSemaphore>,
}

impl Drop for SemaphoreGuard {
    fn drop(&mut self) {
        let data = &self.inner;
        *data.count.lock().unwrap() -= 1;
        data.condvar.notify_one();
    }
}

#[cfg(test)]
mod admission_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::{Ipv4Addr, Ipv6Addr};
    use std::thread::sleep;

    #[test]
    fn test_regular_http_operations() -> Result<()> {
        test_server(
            "localhost",
            9999,
            [
                "GET / HTTP/1.1\nhost: localhost:9999\n\n",
                "POST /foo HTTP/1.1\nhost: localhost:9999\nexpect: 100-continue\nconnection:close\ncontent-length:4\n\nabcd",
            ],
            [
                "HTTP/1.1 200 OK\r\nserver: OxHTTP/1.0\r\ncontent-length: 4\r\n\r\nhome",
                "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 404 Not Found\r\nserver: OxHTTP/1.0\r\ncontent-length: 0\r\n\r\n",
            ],
        )
    }

    #[test]
    fn test_bad_request() -> Result<()> {
        test_server(
            "::1",
            9998,
            ["GET / HTTP/1.1\nhost: localhost:9999\nfoo\n\n"],
            [
                "HTTP/1.1 400 Bad Request\r\ncontent-type: text/plain; charset=utf-8\r\nserver: OxHTTP/1.0\r\ncontent-length: 19\r\n\r\ninvalid header name",
            ],
        )
    }

    #[test]
    fn test_bad_expect() -> Result<()> {
        test_server(
            "127.0.0.1",
            9997,
            ["GET / HTTP/1.1\nhost: localhost:9999\nexpect: bad\n\n"],
            [
                "HTTP/1.1 417 Expectation Failed\r\ncontent-type: text/plain; charset=utf-8\r\nserver: OxHTTP/1.0\r\ncontent-length: 43\r\n\r\nExpect header value 'bad' is not supported.",
            ],
        )
    }

    fn test_server(
        request_host: &'static str,
        server_port: u16,
        requests: impl IntoIterator<Item = &'static str>,
        responses: impl IntoIterator<Item = &'static str>,
    ) -> Result<()> {
        Server::new(|request| {
            if request.uri().path() == "/" {
                Response::builder().body(Body::from("home")).unwrap()
            } else {
                Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::empty())
                    .unwrap()
            }
        })
        .bind((Ipv4Addr::LOCALHOST, server_port))
        .bind((Ipv6Addr::LOCALHOST, server_port))
        .with_server_name("OxHTTP/1.0")
        .unwrap()
        .with_global_timeout(Duration::from_secs(1))
        .spawn()?;
        sleep(Duration::from_millis(100)); // Makes sure the server is up
        let mut stream = TcpStream::connect((request_host, server_port))?;
        for (request, response) in requests.into_iter().zip(responses) {
            stream.write_all(request.as_bytes())?;
            let mut output = vec![b'\0'; response.len()];
            stream.read_exact(&mut output)?;
            assert_eq!(String::from_utf8(output).unwrap(), response);
        }
        Ok(())
    }

    #[test]
    fn test_thread_limit() -> Result<()> {
        let server_port = 9996;
        let request = b"GET / HTTP/1.1\nhost: localhost:9999\n\n";
        let response = b"HTTP/1.1 200 OK\r\nserver: OxHTTP/1.0\r\ncontent-length: 4\r\n\r\nhome";
        Server::new(|_| Response::builder().body(Body::from("home")).unwrap())
            .bind((Ipv4Addr::LOCALHOST, server_port))
            .bind((Ipv6Addr::LOCALHOST, server_port))
            .with_server_name("OxHTTP/1.0")
            .unwrap()
            .with_global_timeout(Duration::from_secs(1))
            .with_max_concurrent_connections(2)
            .spawn()?;
        sleep(Duration::from_millis(100)); // Makes sure the server is up
        let streams = (0..128)
            .map(|_| {
                let mut stream = TcpStream::connect(("localhost", server_port))?;
                stream.write_all(request)?;
                Ok(stream)
            })
            .collect::<Result<Vec<_>>>()?;
        for mut stream in streams {
            let mut output = vec![b'\0'; response.len()];
            stream.read_exact(&mut output)?;
            assert_eq!(output, response);
        }
        Ok(())
    }
}
