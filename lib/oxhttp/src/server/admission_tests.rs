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
fn result_limit_checks_known_length_and_preserves_bodyless_responses() -> Result<()> {
    for (method, status, content, limit, expected) in [
        ("GET", StatusCode::OK, "body", 4, 200),
        ("GET", StatusCode::OK, "body", 3, 503),
        ("GET", StatusCode::OK, "", 0, 200),
        ("HEAD", StatusCode::OK, "body", 0, 200),
        ("GET", StatusCode::NOT_MODIFIED, "body", 0, 304),
        ("GET", StatusCode::NO_CONTENT, "body", 0, 204),
        ("GET", StatusCode::PAYLOAD_TOO_LARGE, "body", 0, 413),
    ] {
        let (mut stream, worker) = connect(
            Server::new(move |request| {
                request.extensions_mut().clear(); // Cannot remove captured transport cap.
                Response::builder()
                    .status(status)
                    .body(Body::from(content))
                    .unwrap()
            })
            .with_request_admission(move |_, _| {
                let mut context = Extensions::new();
                context.insert(crate::ResponseBodyLimit(limit));
                Ok(context)
            }),
        )?;
        write!(
            stream,
            "{method} / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n"
        )?;
        let response = read_closed_response(&mut stream)?;
        assert!(
            response.starts_with(&format!("HTTP/1.1 {expected} ")),
            "{response}"
        );
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        if method == "HEAD" || status != StatusCode::OK || expected == 503 {
            assert!(body.is_empty());
        } else {
            assert_eq!(body, content);
        }
        if method == "HEAD" {
            assert!(head.contains("content-length: 4"));
        }
        if status == StatusCode::NOT_MODIFIED {
            assert!(!head.contains("content-length:"));
        }
        if expected == 503 {
            assert!(head.contains("cache-control: no-store"));
        }
        worker.join().unwrap()?;
    }
    Ok(())
}

#[test]
fn result_limit_stream_overflow_never_finishes_and_releases_lease() -> Result<()> {
    for length in [4, 5] {
        let drops = Arc::new(AtomicUsize::new(0));
        let admission_drops = Arc::clone(&drops);
        let (mut stream, worker) = connect(
            Server::new(move |_| {
                Response::builder()
                    .body(Body::from_read(std::io::Cursor::new(vec![b'x'; length])))
                    .unwrap()
            })
            .with_request_admission(move |_, _| {
                let mut context = Extensions::new();
                context.insert(crate::ResponseBodyLimit(4));
                context.insert(RequestLifetime::new(LeaseDrop(Arc::clone(
                    &admission_drops,
                ))));
                Ok(context)
            }),
        )?;
        stream.write_all(b"GET / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
        let response = read_closed_response(&mut stream)?;
        let result = worker.join().unwrap();
        if length == 4 {
            result?;
            assert!(response.ends_with("4\r\nxxxx\r\n0\r\n\r\n"), "{response}");
        } else {
            let error = result.unwrap_err();
            assert!(error
                .get_ref()
                .unwrap()
                .is::<crate::ResponseBodyLimitExceeded>());
            assert!(
                !response.ends_with("0\r\n\r\n"),
                "overflow closed as successful chunked EOF"
            );
            assert!(!response.contains("limit"), "overflow injected error text");
        }
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }
    Ok(())
}

#[test]
fn result_limit_excludes_headers_and_trailers_across_sequential_requests() -> Result<()> {
    struct Payload {
        bytes: std::io::Cursor<&'static [u8]>,
        trailers: crate::model::HeaderMap,
    }
    impl Read for Payload {
        fn read(&mut self, buffer: &mut [u8]) -> Result<usize> {
            self.bytes.read(buffer)
        }
    }
    impl crate::model::ChunkedTransferPayload for Payload {
        fn trailers(&self) -> Option<&crate::model::HeaderMap> {
            Some(&self.trailers)
        }
    }
    let (mut stream, worker) = connect(
        Server::new(|_| {
            let mut trailers = crate::model::HeaderMap::new();
            trailers.insert("x-proof", HeaderValue::from_static("longer-than-cap"));
            Response::builder()
                .header("x-meta", "longer-than-cap")
                .body(Body::from_chunked_transfer_payload(Payload {
                    bytes: std::io::Cursor::new(b"body"),
                    trailers,
                }))
                .unwrap()
        })
        .with_request_admission(|_, _| {
            let mut context = Extensions::new();
            context.insert(crate::ResponseBodyLimit(4));
            Ok(context)
        }),
    )?;
    for close in [false, true] {
        write!(
            stream,
            "GET / HTTP/1.1\r\nhost: localhost\r\n{}\r\n",
            if close { "connection: close\r\n" } else { "" }
        )?;
        expect_bytes(&mut stream, format!("HTTP/1.1 200 OK\r\n{}x-meta: longer-than-cap\r\ntransfer-encoding: chunked\r\n\r\n4\r\nbody\r\n0\r\nx-proof: longer-than-cap\r\n\r\n", if close { "connection: close\r\n" } else { "" }).as_bytes())?;
    }
    assert_eq!(stream.read(&mut [0; 1])?, 0);
    worker.join().unwrap()
}

#[test]
fn body_limits_reject_before_continue_or_handler_and_release_lease() -> Result<()> {
    for wire in [
        "POST / HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: 5\r\n\r\n",
        "HEAD / HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: 5\r\n\r\n",
        "HEAD / HTTP/1.1\r\nhost: localhost\r\ntransfer-encoding: chunked\r\n\r\n5\r\n12345\r\n0\r\n\r\n",
        "POST / HTTP/1.1\r\nhost: localhost\r\ntransfer-encoding: chunked\r\n\r\n5\r\n12345\r\n0\r\n\r\n",
    ] {
        let drops = Arc::new(AtomicUsize::new(0));
        let admission_drops = Arc::clone(&drops);
        let (mut stream, worker) = connect(
            Server::new(|_| panic!("oversize body reached handler")).with_request_admission(
                move |_, _| {
                    let mut context = Extensions::new();
                    context.insert(crate::RequestBodyLimits {
                        max_encoded_bytes: 4,
                        max_decoded_bytes: 4,
                    });
                    context.insert(RequestLifetime::new(LeaseDrop(Arc::clone(
                        &admission_drops,
                    ))));
                    Ok(context)
                },
            ),
        )?;
        stream.write_all(wire.as_bytes())?;
        let response = read_closed_response(&mut stream)?;
        assert!(response.starts_with("HTTP/1.1 413 "), "{response}");
        assert!(response.contains("connection: close\r\n"));
        assert!(!response.contains("100 Continue"));
        if wire.starts_with("HEAD ") {
            assert!(response.ends_with("\r\n\r\n"), "HEAD error carried a body");
            assert!(!response.contains("content-length: 0\r\n"));
        }
        worker.join().unwrap()?;
        assert_eq!(drops.load(Ordering::SeqCst), 1);
    }
    Ok(())
}

#[test]
fn bounded_head_keeps_representation_length_without_body() -> Result<()> {
    let (mut stream, worker) = connect(
        Server::new(|_| Response::builder().body(Body::from("ok")).unwrap())
            .with_request_admission(|_, _| {
                let mut context = Extensions::new();
                context.insert(crate::RequestBodyLimits {
                    max_encoded_bytes: 0,
                    max_decoded_bytes: 0,
                });
                Ok(context)
            }),
    )?;
    stream.write_all(b"HEAD / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    assert_eq!(
        read_closed_response(&mut stream)?,
        "HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 2\r\n\r\n"
    );
    worker.join().unwrap()?;
    Ok(())
}

#[test]
fn bounded_incomplete_body_returns_bad_request_before_handler() -> Result<()> {
    let (mut stream, worker) = connect(
        Server::new(|_| panic!("incomplete body reached handler")).with_request_admission(
            |_, _| {
                let mut context = Extensions::new();
                context.insert(crate::RequestBodyLimits {
                    max_encoded_bytes: 5,
                    max_decoded_bytes: 5,
                });
                Ok(context)
            },
        ),
    )?;
    stream.write_all(b"POST / HTTP/1.1\r\nhost: localhost\r\ncontent-length: 5\r\n\r\nbody")?;
    stream.shutdown(std::net::Shutdown::Write)?;
    let response = read_closed_response(&mut stream)?;
    assert!(response.starts_with("HTTP/1.1 400 "), "{response}");
    assert!(response.contains("connection: close\r\n"));
    worker.join().unwrap()?;
    Ok(())
}

#[test]
fn bounded_chunked_body_preserves_trailers_and_next_sequential_request() -> Result<()> {
    let (mut stream, worker) = connect(
        Server::new(|request| {
            if request.uri().path() == "/body" {
                assert_eq!(request.body().len(), None);
                assert_eq!(request.body().trailers().unwrap()["x-proof"], "kept");
                let mut data = String::new();
                request.body_mut().read_to_string(&mut data).unwrap();
                assert_eq!(data, "body");
            }
            Response::builder().body(Body::from("ok")).unwrap()
        })
        .with_request_admission(|_, _| {
            let mut context = Extensions::new();
            context.insert(crate::RequestBodyLimits {
                max_encoded_bytes: 4,
                max_decoded_bytes: 4,
            });
            Ok(context)
        }),
    )?;
    stream.write_all(b"POST /body HTTP/1.1\r\nhost: localhost\r\ntransfer-encoding: chunked\r\n\r\n4\r\nbody\r\n0\r\nX-Proof: kept\r\n\r\n")?;
    expect_bytes(
        &mut stream,
        b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok",
    )?;
    stream.write_all(b"GET /next HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    assert!(read_closed_response(&mut stream)?.ends_with("\r\n\r\nok"));
    worker.join().unwrap()?;
    Ok(())
}

#[cfg(feature = "flate2")]
#[test]
fn bounded_compressed_body_survives_continue_and_sequential_reuse() -> Result<()> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(b"body")?;
    let encoded = encoder.finish()?;
    let encoded_limit = encoded.len() as u64;
    let (mut stream, worker) = connect(
        Server::new(|request| {
            if request.uri().path() == "/body" {
                assert_eq!(request.body().len(), None);
                assert_eq!(request.body().trailers().unwrap()["x-proof"], "kept");
                let mut data = String::new();
                request.body_mut().read_to_string(&mut data).unwrap();
                assert_eq!(data, "body");
            }
            Response::builder().body(Body::from("ok")).unwrap()
        })
        .with_request_admission(move |_, _| {
            let mut context = Extensions::new();
            context.insert(crate::RequestBodyLimits {
                max_encoded_bytes: encoded_limit,
                max_decoded_bytes: 4,
            });
            Ok(context)
        }),
    )?;
    stream.write_all(b"POST /body HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-encoding: gzip\r\ntransfer-encoding: chunked\r\n\r\n")?;
    expect_bytes(&mut stream, b"HTTP/1.1 100 Continue\r\n\r\n")?;
    write!(stream, "{:x}\r\n", encoded.len())?;
    stream.write_all(&encoded)?;
    stream.write_all(b"\r\n0\r\nX-Proof: kept\r\n\r\n")?;
    expect_bytes(
        &mut stream,
        b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok",
    )?;
    stream.write_all(b"GET /next HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    assert!(read_closed_response(&mut stream)?.ends_with("\r\n\r\nok"));
    worker.join().unwrap()?;
    Ok(())
}

#[test]
fn bounded_preflight_deadline_releases_capacity_without_handler() -> Result<()> {
    let drops = Arc::new(AtomicUsize::new(0));
    let admission_drops = Arc::clone(&drops);
    let (mut stream, worker) = connect(
        Server::new(|_| panic!("incomplete body reached handler")).with_request_admission(
            move |_, _| {
                let mut context = Extensions::new();
                context.insert(crate::RequestBodyLimits {
                    max_encoded_bytes: 10,
                    max_decoded_bytes: 10,
                });
                context.insert(RequestDeadline(
                    std::time::Instant::now() + Duration::from_millis(250),
                ));
                context.insert(RequestLifetime::new(LeaseDrop(Arc::clone(
                    &admission_drops,
                ))));
                Ok(context)
            },
        ),
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
fn complete_half_closed_requests_survive_waiting_admission() -> Result<()> {
    for wire in [
        "GET / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n",
        "POST / HTTP/1.1\r\nhost: localhost\r\ncontent-length: 4\r\nconnection: close\r\n\r\nbody",
        "POST / HTTP/1.1\r\nhost: localhost\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n4\r\nbody\r\n0\r\n\r\n",
    ] {
        let (entered, waiting) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let released = Mutex::new(released);
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let admission_cancelled = Arc::clone(&cancelled);
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
                let mut context = Extensions::new();
                let cancelled = Arc::clone(&admission_cancelled);
                context.insert(RequestTransportCancellation::new(move || {
                    cancelled.store(true, Ordering::SeqCst);
                }));
                Ok(context)
            }),
        )?;
        stream.write_all(wire.as_bytes())?;
        stream.shutdown(std::net::Shutdown::Write)?;
        waiting.recv_timeout(Duration::from_secs(3)).unwrap();
        release.send(()).unwrap();
        assert!(read_closed_response(&mut stream)?.ends_with("\r\n\r\nok"));
        worker.join().unwrap()?;
        assert!(!cancelled.load(Ordering::SeqCst));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
#[test]
fn active_reset_cancels_handler_without_releasing_its_lifetime() -> Result<()> {
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let drops = Arc::new(AtomicUsize::new(0));
    let work = Arc::new(AtomicUsize::new(0));
    let (entered, waiting) = std::sync::mpsc::channel();
    let handler_cancelled = Arc::clone(&cancelled);
    let handler_drops = Arc::clone(&drops);
    let handler_work = Arc::clone(&work);
    let admission_cancelled = Arc::clone(&cancelled);
    let admission_drops = Arc::clone(&drops);
    let callback_drops = Arc::clone(&drops);
    let (mut stream, worker) = connect(
        Server::new(move |_| {
            entered.send(()).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            while !handler_cancelled.load(Ordering::SeqCst) {
                handler_work.fetch_add(1, Ordering::SeqCst);
                assert!(
                    std::time::Instant::now() < deadline,
                    "active reset did not reach callback"
                );
                thread::yield_now();
            }
            assert_eq!(handler_drops.load(Ordering::SeqCst), 0);
            // The latched pre-encode check must fail even though there is no
            // response entity whose write could rediscover SO_ERROR.
            Response::builder().body(Body::empty()).unwrap()
        })
        .with_request_admission(move |_, _| {
            let mut context = Extensions::new();
            let cancelled = Arc::clone(&admission_cancelled);
            let drops = Arc::clone(&callback_drops);
            context.insert(RequestTransportCancellation::new(move || {
                assert_eq!(drops.load(Ordering::SeqCst), 0);
                cancelled.store(true, Ordering::SeqCst);
            }));
            context.insert(RequestLifetime::new(LeaseDrop(Arc::clone(
                &admission_drops,
            ))));
            Ok(context)
        }),
    )?;
    // The unread 100 response makes dropping this Linux socket an active reset.
    stream.write_all(
        b"POST / HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: 1\r\n\r\nx",
    )?;
    waiting.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(stream.peek(&mut [0; 1])? > 0);
    drop(stream);
    assert_eq!(
        worker.join().unwrap().unwrap_err().kind(),
        ErrorKind::ConnectionAborted
    );
    assert!(cancelled.load(Ordering::SeqCst));
    assert!(work.load(Ordering::SeqCst) > 0);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    Ok(())
}

#[cfg(target_os = "linux")]
#[test]
fn active_reset_cancels_lazy_response_before_distant_deadline() -> Result<()> {
    struct Payload {
        initial_chunks: usize,
        cancelled: Arc<std::sync::atomic::AtomicBool>,
        entered: Option<std::sync::mpsc::Sender<()>>,
        work: Arc<AtomicUsize>,
    }
    impl Read for Payload {
        fn read(&mut self, buffer: &mut [u8]) -> Result<usize> {
            if self.initial_chunks != 0 {
                self.initial_chunks -= 1;
                let length = buffer.len();
                buffer[..length].fill(b'x');
                return Ok(length);
            }
            if let Some(entered) = self.entered.take() {
                entered.send(()).unwrap();
            }
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            while !self.cancelled.load(Ordering::SeqCst) {
                self.work.fetch_add(1, Ordering::SeqCst);
                assert!(
                    std::time::Instant::now() < deadline,
                    "lazy response did not observe transport cancellation"
                );
                thread::yield_now();
            }
            Err(Error::new(
                ErrorKind::ConnectionAborted,
                "cooperative response cancellation",
            ))
        }
    }

    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let work = Arc::new(AtomicUsize::new(0));
    let (entered, waiting) = std::sync::mpsc::channel();
    let body_cancelled = Arc::clone(&cancelled);
    let body_work = Arc::clone(&work);
    let admission_cancelled = Arc::clone(&cancelled);
    let started = std::time::Instant::now();
    let (mut stream, worker) = connect(
        Server::new(move |_| {
            Response::builder()
                .body(Body::from_read(Payload {
                    // Two full chunks force BufWriter to emit bytes before the
                    // third cooperative read blocks on cancellation.
                    initial_chunks: 2,
                    cancelled: Arc::clone(&body_cancelled),
                    entered: Some(entered.clone()),
                    work: Arc::clone(&body_work),
                }))
                .unwrap()
        })
        .with_request_admission(move |_, _| {
            let mut context = Extensions::new();
            let cancelled = Arc::clone(&admission_cancelled);
            context.insert(RequestTransportCancellation::new(move || {
                cancelled.store(true, Ordering::SeqCst);
            }));
            context.insert(RequestDeadline(
                std::time::Instant::now() + Duration::from_secs(10),
            ));
            Ok(context)
        }),
    )?;
    // Keep the interim response unread as the deterministic Linux reset source;
    // the lazy final response is already blocked at its cooperative checkpoint.
    stream.write_all(b"POST / HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: 1\r\nconnection: close\r\n\r\nx")?;
    waiting.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(stream.peek(&mut [0; 1])? > 0);
    drop(stream);
    assert!(worker.join().unwrap().is_err());
    assert!(cancelled.load(Ordering::SeqCst));
    assert!(work.load(Ordering::SeqCst) > 0);
    assert!(started.elapsed() < Duration::from_secs(5));
    Ok(())
}

#[test]
fn finished_transport_watch_is_inert_after_handler_unwind() -> Result<()> {
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let admission_cancelled = Arc::clone(&cancelled);
    let (mut stream, worker) = connect(
        Server::new(|_| panic!("injected active handler unwind")).with_request_admission(
            move |_, _| {
                let mut context = Extensions::new();
                let cancelled = Arc::clone(&admission_cancelled);
                context.insert(RequestTransportCancellation::new(move || {
                    cancelled.store(true, Ordering::SeqCst);
                }));
                Ok(context)
            },
        ),
    )?;
    stream.write_all(b"GET / HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
    assert!(worker.join().is_err());
    drop(stream);
    assert!(!cancelled.load(Ordering::SeqCst));
    assert_eq!(Arc::strong_count(&cancelled), 1);
    Ok(())
}

#[cfg(target_os = "linux")]
#[test]
fn completed_transport_watch_cannot_cancel_next_keepalive_request() -> Result<()> {
    let old_cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let admission_cancelled = Arc::clone(&old_cancelled);
    let (entered, waiting) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel();
    let released = Mutex::new(released);
    let (mut stream, worker) = connect(
        Server::new(move |request| {
            if request.uri().path() == "/second" {
                entered.send(()).unwrap();
                released
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
            }
            Response::builder().body(Body::from("ok")).unwrap()
        })
        .with_request_admission(move |request, _| {
            let mut context = Extensions::new();
            if request.uri_ref().unwrap().path() == "/first" {
                let cancelled = Arc::clone(&admission_cancelled);
                context.insert(RequestTransportCancellation::new(move || {
                    cancelled.store(true, Ordering::SeqCst);
                }));
            }
            Ok(context)
        }),
    )?;
    stream.write_all(b"GET /first HTTP/1.1\r\nhost: localhost\r\n\r\n")?;
    expect_bytes(
        &mut stream,
        b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok",
    )?;
    stream.write_all(b"POST /second HTTP/1.1\r\nhost: localhost\r\nexpect: 100-continue\r\ncontent-length: 1\r\nconnection: close\r\n\r\nx")?;
    waiting.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(stream.peek(&mut [0; 1])? > 0);
    drop(stream);
    release.send(()).unwrap();
    assert!(worker.join().unwrap().is_err());
    assert!(!old_cancelled.load(Ordering::SeqCst));
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
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let admission_drops = Arc::clone(&drops);
    let admission_cancelled = Arc::clone(&cancelled);
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
            let cancelled = Arc::clone(&admission_cancelled);
            context.insert(RequestTransportCancellation::new(move || {
                cancelled.store(true, Ordering::SeqCst);
            }));
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
    assert!(
        !cancelled.load(Ordering::SeqCst),
        "deadline shutdown was mislabeled as transport cancellation"
    );
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
