use super::*;
use std::io::Read;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

// Own and join the only worker; bind port zero before connecting, without sleeps.
fn connect(server: Server) -> Result<(TcpStream, JoinHandle<Result<()>>)> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
    let address = listener.local_addr()?;
    let worker = thread::spawn(move || {
        let (stream, _) = listener.accept()?;
        accept_request(
            stream,
            &*server.on_request,
            server.request_admission.as_deref(),
            Some(Duration::from_secs(5)),
            &server.server,
        )
    });
    let stream = TcpStream::connect(address)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    Ok((stream, worker))
}

fn expect_bytes(stream: &mut TcpStream, expected: &[u8]) -> Result<()> {
    let mut actual = vec![0; expected.len()];
    stream.read_exact(&mut actual)?;
    assert_eq!(actual, expected);
    Ok(())
}

fn read_closed_response(stream: &mut TcpStream) -> Result<String> {
    let mut response = String::new();
    // Closing without draining unread request bytes can end with a TCP reset.
    // Still require the actual final HTTP response in each caller below.
    match stream.read_to_string(&mut response) {
        Ok(_) => Ok(response),
        Err(error) if error.kind() == ErrorKind::ConnectionReset => Ok(response),
        Err(error) => Err(error),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Admitted(usize);

struct LeaseDrop(Arc<AtomicUsize>);
impl Drop for LeaseDrop {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

struct NeverClone;
impl Clone for NeverClone {
    fn clone(&self) -> Self {
        panic!("unrelated admission extensions must be moved, never cloned");
    }
}

#[test]
fn complete_half_closed_requests_survive_waiting_admission() -> Result<()> {
    for wire in [
        "GET / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n",
        "POST / HTTP/1.1\r\nhost: localhost\r\ncontent-length: 4\r\nconnection: close\r\n\r\nbody",
        "POST / HTTP/1.1\r\nhost: localhost\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n4\r\nbody\r\n0\r\n\r\n",
    ] {
        let (entered, waiting) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let released = Mutex::new(released);
        let (mut stream, worker) = connect(
            Server::new(|request| {
                assert!(request.extensions().get::<AdmissionAbort>().is_none());
                let mut body = String::new();
                request.body_mut().read_to_string(&mut body).unwrap();
                assert!(body.is_empty() || body == "body");
                Response::builder().body(Body::from("ok")).unwrap()
            })
            .with_request_admission(move |head, _| {
                let abort = head
                    .extensions_ref()
                    .unwrap()
                    .get::<AdmissionAbort>()
                    .unwrap();
                entered.send(()).unwrap();
                released
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
                assert!(!abort.is_aborted());
                Ok(Extensions::new())
            }),
        )?;
        stream.write_all(wire.as_bytes())?;
        stream.shutdown(std::net::Shutdown::Write)?;
        waiting.recv_timeout(Duration::from_secs(3)).unwrap();
        release.send(()).unwrap();
        assert!(read_closed_response(&mut stream)?.ends_with("\r\n\r\nok"));
        worker.join().unwrap()?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
#[test]
fn observed_reset_prevents_body_and_expect_even_if_hook_returns_success() -> Result<()> {
    let (entered, waiting) = std::sync::mpsc::channel();
    let previous = Mutex::new(None::<AdmissionAbort>);
    let (mut stream, worker) = connect(
        Server::new(|request| {
            assert_eq!(
                request.uri().path(),
                "/first",
                "aborted request reached handler"
            );
            Response::builder().body(Body::from("unread")).unwrap()
        })
        .with_request_admission(move |head, _| {
            if head.uri_ref().unwrap().path() == "/second" {
                let abort = head
                    .extensions_ref()
                    .unwrap()
                    .get::<AdmissionAbort>()
                    .unwrap();
                entered.send(()).unwrap();
                let deadline = std::time::Instant::now() + Duration::from_secs(3);
                while !abort.is_aborted() {
                    assert!(!previous.lock().unwrap().as_ref().unwrap().is_aborted());
                    assert!(std::time::Instant::now() < deadline, "reset not observed");
                    thread::yield_now();
                }
                assert!(!previous.lock().unwrap().as_ref().unwrap().is_aborted());
            } else {
                *previous.lock().unwrap() = head
                    .extensions_ref()
                    .unwrap()
                    .get::<AdmissionAbort>()
                    .cloned();
            }
            Ok(Extensions::new()) // Intentionally ignore the abort.
        }),
    )?;
    stream.write_all(b"GET /first HTTP/1.1\r\nhost: localhost\r\n\r\n")?;
    assert!(stream.peek(&mut [0; 1])? > 0);
    stream.write_all(b"POST /second HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: invalid\r\n\r\n")?;
    waiting.recv_timeout(Duration::from_secs(3)).unwrap();
    drop(stream); // The unread first response makes this a reset on Linux.
    assert_eq!(
        worker.join().unwrap().unwrap_err().kind(),
        ErrorKind::ConnectionAborted
    );
    Ok(())
}

#[test]
fn deadline_unblocks_stalled_expect_body_and_releases_capacity() -> Result<()> {
    let drops = Arc::new(AtomicUsize::new(0));
    let admission_drops = Arc::clone(&drops);
    let (mut stream, worker) = connect(
        Server::new(|request| {
            let mut body = Vec::new();
            drop(request.body_mut().read_to_end(&mut body));
            Response::builder()
                .body(Body::from("must not succeed"))
                .unwrap()
        })
        .with_request_admission(move |_, _| {
            let mut context = Extensions::new();
            context.insert(RequestDeadline(
                std::time::Instant::now() + Duration::from_millis(250),
            ));
            context.insert(RequestLifetime::new(LeaseDrop(Arc::clone(
                &admission_drops,
            ))));
            Ok(context)
        }),
    )?;
    stream.write_all(
        b"POST / HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: 10\r\n\r\n",
    )?;
    expect_bytes(&mut stream, b"HTTP/1.1 100 Continue\r\n\r\n")?;
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    assert!(read_closed_response(&mut stream)?.is_empty());
    assert_eq!(
        worker.join().unwrap().unwrap_err().kind(),
        ErrorKind::TimedOut
    );
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    Ok(())
}

#[test]
fn deadline_fails_partial_stream_without_releasing_a_running_handler() -> Result<()> {
    struct Payload {
        remaining: usize,
        release: std::sync::mpsc::Receiver<()>,
    }
    impl Read for Payload {
        fn read(&mut self, buffer: &mut [u8]) -> Result<usize> {
            if buffer.is_empty() {
                return Ok(0);
            }
            if self.remaining != 0 {
                let length = buffer.len().min(self.remaining);
                self.remaining -= length;
                buffer[..length].fill(b'x');
                return Ok(length);
            }
            self.release
                .recv_timeout(Duration::from_secs(3))
                .map_err(Error::other)?;
            Ok(0)
        }
    }
    let drops = Arc::new(AtomicUsize::new(0));
    let admission_drops = Arc::clone(&drops);
    let (release, released) = std::sync::mpsc::channel();
    let released = Mutex::new(Some(released));
    let (mut stream, worker) = connect(
        Server::new(move |request| {
            request.extensions_mut().clear();
            Response::builder()
                .body(Body::from_read(Payload {
                    remaining: 128 * 1024,
                    release: released.lock().unwrap().take().unwrap(),
                }))
                .unwrap()
        })
        .with_request_admission(move |_, _| {
            let mut context = Extensions::new();
            context.insert(RequestDeadline(
                std::time::Instant::now() + Duration::from_millis(250),
            ));
            context.insert(RequestLifetime::new(LeaseDrop(Arc::clone(
                &admission_drops,
            ))));
            Ok(context)
        }),
    )?;
    stream.write_all(b"GET / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    let response = read_closed_response(&mut stream)?;
    assert!(
        response.starts_with("HTTP/1.1 200 OK") && response.contains("xxxx"),
        "{response}"
    );
    assert!(
        !response.ends_with("0\r\n\r\n"),
        "expired stream acquired a valid terminator"
    );
    assert_eq!(
        drops.load(Ordering::SeqCst),
        0,
        "I/O shutdown cannot release active work"
    );
    release.send(()).unwrap();
    assert!(worker.join().unwrap().is_err());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    Ok(())
}

#[test]
fn completed_deadline_watch_cannot_close_next_keepalive_request() -> Result<()> {
    let old_deadline = Arc::new(Mutex::new(None::<std::time::Instant>));
    let admission_deadline = Arc::clone(&old_deadline);
    let (mut stream, worker) = connect(
        Server::new(move |request| {
            if request.uri().path() == "/second" {
                let deadline = old_deadline.lock().unwrap().unwrap();
                thread::sleep(
                    deadline.saturating_duration_since(std::time::Instant::now())
                        + Duration::from_millis(40),
                );
            }
            Response::builder().body(Body::from("ok")).unwrap()
        })
        .with_request_admission(move |request, _| {
            let mut context = Extensions::new();
            if request.uri_ref().unwrap().path() == "/first" {
                let deadline = std::time::Instant::now() + Duration::from_millis(250);
                *admission_deadline.lock().unwrap() = Some(deadline);
                context.insert(RequestDeadline(deadline));
            }
            Ok(context)
        }),
    )?;
    stream.write_all(b"GET /first HTTP/1.1\r\nhost: localhost\r\n\r\n")?;
    expect_bytes(
        &mut stream,
        b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok",
    )?;
    stream.write_all(b"GET /second HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    assert!(read_closed_response(&mut stream)?.ends_with("\r\n\r\nok"));
    worker.join().unwrap()?;
    Ok(())
}

#[test]
fn lifetime_guard_survives_request_clear_and_streaming_then_drops_once() -> Result<()> {
    struct Payload {
        drops: Arc<AtomicUsize>,
        read: bool,
    }
    impl Read for Payload {
        fn read(&mut self, buffer: &mut [u8]) -> Result<usize> {
            assert_eq!(self.drops.load(Ordering::SeqCst), 0);
            if self.read || buffer.is_empty() {
                return Ok(0);
            }
            self.read = true;
            buffer[0] = b'x';
            Ok(1)
        }
    }
    let drops = Arc::new(AtomicUsize::new(0));
    let admission_drops = Arc::clone(&drops);
    let handler_drops = Arc::clone(&drops);
    let (mut stream, worker) = connect(
        Server::new(move |request| {
            request.extensions_mut().clear();
            Response::builder()
                .body(Body::from_read(Payload {
                    drops: Arc::clone(&handler_drops),
                    read: false,
                }))
                .unwrap()
        })
        .with_request_admission(move |_, _| {
            let mut context = Extensions::new();
            context.insert(NeverClone);
            context.insert(RequestLifetime::new(LeaseDrop(Arc::clone(
                &admission_drops,
            ))));
            Ok(context)
        }),
    )?;
    stream.write_all(b"GET / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    let response = read_closed_response(&mut stream)?;
    assert!(response.ends_with("1\r\nx\r\n0\r\n\r\n"), "{response}");
    drop(stream);
    worker.join().unwrap()?;
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    Ok(())
}

#[test]
fn lifetime_guard_drops_after_response_flush_not_only_body_encoding() -> Result<()> {
    struct FlushProbe(Mutex<TcpStream>);
    impl Drop for FlushProbe {
        fn drop(&mut self) {
            // Small response remains in BufWriter until into_inner flushes.
            // If guard release moves before that flush, this read times out.
            let mut stream = self.0.lock().unwrap();
            expect_bytes(
                &mut stream,
                b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok",
            )
            .unwrap();
        }
    }
    let (sender, receiver) = std::sync::mpsc::channel::<TcpStream>();
    let receiver = Mutex::new(receiver);
    let (mut stream, worker) = connect(
        Server::new(|request| {
            request.extensions_mut().clear();
            Response::builder().body(Body::from("ok")).unwrap()
        })
        .with_request_admission(move |_, _| {
            let mut context = Extensions::new();
            context.insert(RequestLifetime::new(FlushProbe(Mutex::new(
                receiver
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(2))
                    .unwrap(),
            ))));
            Ok(context)
        }),
    )?;
    sender.send(stream.try_clone()?).unwrap();
    stream.write_all(b"GET / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    worker.join().unwrap()?;
    Ok(())
}

#[test]
fn lifetime_guard_releases_on_decode_drain_encode_error_and_handler_unwind() -> Result<()> {
    struct BadPayload;
    impl Read for BadPayload {
        fn read(&mut self, _: &mut [u8]) -> Result<usize> {
            Err(Error::other("injected serialization error"))
        }
    }
    for case in ["decode", "drain", "expect", "encode", "panic"] {
        let drops = Arc::new(AtomicUsize::new(0));
        let admission_drops = Arc::clone(&drops);
        let (mut stream, worker) = connect(
            Server::new(move |request| {
                request.extensions_mut().clear();
                assert_ne!(case, "panic", "injected handler unwind");
                Response::builder()
                    .body(if case == "encode" {
                        Body::from_read(BadPayload)
                    } else {
                        Body::empty()
                    })
                    .unwrap()
            })
            .with_request_admission(move |_, _| {
                let mut context = Extensions::new();
                context.insert(RequestLifetime::new(LeaseDrop(Arc::clone(
                    &admission_drops,
                ))));
                Ok(context)
            }),
        )?;
        let framing = match case {
            "decode" => "content-length: invalid\r\n\r\n",
            "drain" => "transfer-encoding: chunked\r\n\r\nnot a chunk\r\n",
            "expect" => "expect: unsupported\r\n\r\n",
            _ => "\r\n",
        };
        write!(
            stream,
            "POST / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n{framing}"
        )?;
        let response = read_closed_response(&mut stream)?;
        let result = worker.join();
        if case == "panic" {
            assert!(result.is_err());
        } else if case == "encode" {
            assert!(result.unwrap().is_err());
        } else {
            result.unwrap()?;
            assert!(response.starts_with("HTTP/1.1 4"), "{response}");
        }
        assert_eq!(drops.load(Ordering::SeqCst), 1, "{case}");
    }
    Ok(())
}

#[test]
fn allow_expect_preserves_socket_and_trusted_context() -> Result<()> {
    let calls = Arc::new(AtomicUsize::new(0));
    let admission_calls = Arc::clone(&calls);
    let (sender, receiver) = std::sync::mpsc::channel();
    let (mut stream, worker) = connect(
        Server::new(move |request| {
            assert_eq!(request.extensions().get::<Admitted>(), Some(&Admitted(1)));
            let connection = *request.extensions().get::<ConnectionInfo>().unwrap();
            sender.send(connection).unwrap();
            let mut body = String::new();
            request.body_mut().read_to_string(&mut body).unwrap();
            assert_eq!(body, "data");
            Response::builder().body(Body::from("ok")).unwrap()
        })
        .with_request_admission(move |head, connection| {
            assert_eq!(head.method_ref().unwrap(), "POST");
            assert_eq!(head.uri_ref().unwrap().path(), "/update");
            assert_eq!(head.headers_ref().unwrap()["x-forwarded-for"], "192.0.2.1");
            assert!(connection.peer_addr().ip().is_loopback());
            assert_eq!(
                head.extensions_ref().unwrap().get::<ConnectionInfo>(),
                Some(&connection)
            );
            admission_calls.fetch_add(1, Ordering::SeqCst);
            let mut context = Extensions::new();
            context.insert(Admitted(1));
            // Even a callback returning a different connection cannot override provenance.
            context.insert(ConnectionInfo {
                peer_addr: "192.0.2.1:1234".parse().unwrap(),
                local_addr: connection.local_addr(),
            });
            Ok(context)
        }),
    )?;
    stream.write_all(b"POST /update HTTP/1.1\r\nhost: localhost\r\nx-forwarded-for: 192.0.2.1\r\nexpect: 100-continue\r\nconnection: close\r\ncontent-length: 4\r\n\r\n")?;
    expect_bytes(&mut stream, b"HTTP/1.1 100 Continue\r\n\r\n")?;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    stream.write_all(b"data")?;
    expect_bytes(
        &mut stream,
        b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok",
    )?;
    let connection = receiver.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(connection.peer_addr(), stream.local_addr()?);
    assert_eq!(connection.local_addr(), stream.peer_addr()?);
    assert_eq!(stream.read(&mut [0])?, 0);
    drop(stream);
    worker.join().unwrap()
}

#[test]
fn denied_requests_skip_expect_body_decoder_drain_and_handler() -> Result<()> {
    // No body, eager body, invalid body framing, and unsupported expectation.
    // Every variant must return the same denial before processing any of them.
    for suffix in [
        "expect: 100-continue\r\ncontent-length: 1000000\r\n\r\n",
        "content-length: 1000000\r\n\r\neager bytes",
        "expect: 100-continue\r\ncontent-length: invalid\r\n\r\n",
        "expect: unsupported\r\ncontent-length: 1000000\r\n\r\n",
        "transfer-encoding: chunked\r\n\r\nnot a chunk",
    ] {
        let calls = Arc::new(AtomicUsize::new(0));
        let admission_calls = Arc::clone(&calls);
        let (mut stream, worker) = connect(
            Server::new(|_| panic!("denied request reached application")).with_request_admission(
                move |_, _| {
                    admission_calls.fetch_add(1, Ordering::SeqCst);
                    Err(Box::new(
                        Response::builder()
                            .status(StatusCode::UNAUTHORIZED)
                            .header(CONNECTION, "keep-alive")
                            .body(Body::empty())
                            .unwrap(),
                    ))
                },
            ),
        )?;
        write!(
            stream,
            "POST /update HTTP/1.1\r\nhost: localhost\r\n{suffix}"
        )?;
        let response = read_closed_response(&mut stream)?;
        assert_eq!(
            response,
            "HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        drop(stream);
        worker.join().unwrap()?;
    }
    Ok(())
}

#[test]
fn keep_alive_requires_new_admission_and_does_not_reuse_context() -> Result<()> {
    let calls = Arc::new(AtomicUsize::new(0));
    let admission_calls = Arc::clone(&calls);
    let (mut stream, worker) = connect(
        Server::new(|request| {
            assert_eq!(request.extensions().get::<Admitted>(), Some(&Admitted(1)));
            Response::builder().body(Body::empty()).unwrap()
        })
        .with_request_admission(move |head, _| {
            assert!(head.extensions_ref().unwrap().get::<Admitted>().is_none());
            let count = admission_calls.fetch_add(1, Ordering::SeqCst) + 1;
            if count == 1 {
                let mut context = Extensions::new();
                context.insert(Admitted(count));
                Ok(context)
            } else {
                Err(Box::new(
                    Response::builder()
                        .status(StatusCode::FORBIDDEN)
                        .body(Body::empty())
                        .unwrap(),
                ))
            }
        }),
    )?;
    stream.write_all(b"GET / HTTP/1.1\r\nhost: localhost\r\n\r\n")?;
    expect_bytes(&mut stream, b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n")?;
    stream.write_all(
        b"POST / HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: 4\r\n\r\n",
    )?;
    expect_bytes(
        &mut stream,
        b"HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
    )?;
    assert_eq!(stream.read(&mut [0])?, 0);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    drop(stream);
    worker.join().unwrap()
}

#[test]
fn malformed_or_oversized_headers_never_reach_admission() -> Result<()> {
    for headers in [
        "bad header\r\n".into(),
        format!("x-large: {}\r\n", "a".repeat(9000)),
    ] {
        let (mut stream, worker) = connect(
            Server::new(|_| panic!("malformed request reached application"))
                .with_request_admission(|_, _| panic!("malformed request reached admission")),
        )?;
        write!(stream, "GET / HTTP/1.1\r\nhost: localhost\r\n{headers}\r\n")?;
        let response = read_closed_response(&mut stream)?;
        assert!(
            response.starts_with("HTTP/1.1 400 Bad Request\r\n"),
            "{response}"
        );
        drop(stream);
        worker.join().unwrap()?;
    }
    Ok(())
}

#[test]
fn informational_rejection_fails_closed() -> Result<()> {
    let (mut stream, worker) = connect(
        Server::new(|_| panic!("rejected request reached application")).with_request_admission(
            |_, _| {
                Err(Box::new(
                    Response::builder()
                        .status(StatusCode::CONTINUE)
                        .body(Body::empty())
                        .unwrap(),
                ))
            },
        ),
    )?;
    stream.write_all(
        b"POST / HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: 4\r\n\r\n",
    )?;
    expect_bytes(
        &mut stream,
        b"HTTP/1.1 500 Internal Server Error\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
    )?;
    assert_eq!(stream.read(&mut [0])?, 0);
    drop(stream);
    worker.join().unwrap()
}

#[test]
fn socket_context_is_available_without_admission() -> Result<()> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let (mut stream, worker) = connect(Server::new(move |request| {
        sender
            .send(*request.extensions().get::<ConnectionInfo>().unwrap())
            .unwrap();
        Response::builder().body(Body::empty()).unwrap()
    }))?;
    stream.write_all(b"GET / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    expect_bytes(&mut stream, b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n")?;
    assert_eq!(
        receiver
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .peer_addr(),
        stream.local_addr()?
    );
    drop(stream);
    worker.join().unwrap()
}
