//! ADR-0027 result-generation counters. This bounds destination bytes, not
//! serializer-private terms/rows, query state, or allocator/RSS overhead.
use crate::HttpError;
use oxhttp::model::{Body, Request, StatusCode};
use oxhttp::{ResponseBodyLimit, ResponseBodyLimitExceeded, ResponseBodyPhase};
use oxigraph_cli::workload::{WorkloadError, WorkloadLease};
use std::io::{self, Write};

pub(super) struct ResultBodyWriter<W> {
    inner: W,
    limit: Option<ResponseBodyLimit>,
    written: u64,
    exceeded: Option<ResponseBodyLimitExceeded>,
    lease: Option<WorkloadLease>,
}
impl<W> ResultBodyWriter<W> {
    pub(super) fn new(inner: W, request: &Request<Body>) -> Self {
        Self::with_lease(inner, request.extensions().get::<WorkloadLease>().cloned())
    }
    pub(super) fn with_lease(inner: W, lease: Option<WorkloadLease>) -> Self {
        Self {
            inner,
            limit: lease.as_ref().and_then(WorkloadLease::result_byte_limit),
            written: 0,
            exceeded: None,
            lease,
        }
    }
    fn check(&self) -> io::Result<()> {
        if let Some(error) = self.exceeded {
            return Err(io::Error::other(error));
        }
        if let Some(lease) = &self.lease {
            lease.check().map_err(|error| {
                io::Error::new(
                    if error == WorkloadError::RequestTimedOut {
                        io::ErrorKind::TimedOut
                    } else {
                        io::ErrorKind::Other
                    },
                    error,
                )
            })?;
        }
        Ok(())
    }
    pub(super) fn finish(self) -> io::Result<W> {
        self.check()?;
        Ok(self.inner)
    }
}
impl<W: Write> Write for ResultBodyWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.check()?;
        if let Some(limit) = self.limit {
            if buf.len() as u64 > limit.0 - self.written {
                let error = ResponseBodyLimitExceeded {
                    limit: limit.0,
                    phase: ResponseBodyPhase::Serialization,
                };
                self.exceeded = Some(error);
                return Err(io::Error::other(error));
            }
        }
        let count = self.inner.write(buf)?;
        self.written = self.written.saturating_add(count as u64);
        Ok(count)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.check()?;
        self.inner.flush()
    }
}
impl<W: Write> std::fmt::Write for ResultBodyWriter<W> {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        self.write_all(s.as_bytes()).map_err(|_| std::fmt::Error)
    }
}

/// Preserve resource failure before existing 406/500 semantic/error mappings.
pub(super) fn http_error(error: io::Error, fallback: fn(io::Error) -> HttpError) -> HttpError {
    if matches!(error.get_ref(), Some(inner) if inner.is::<ResponseBodyLimitExceeded>()
        || matches!(inner.downcast_ref::<oxigraph::sparql::QueryEvaluationError>(),
            Some(oxigraph::sparql::QueryEvaluationError::ResourceLimitExceeded { .. })))
    {
        (StatusCode::SERVICE_UNAVAILABLE, String::new())
    } else if error.kind() == io::ErrorKind::TimedOut
        || matches!(error.get_ref(), Some(inner) if inner.is::<WorkloadError>())
    {
        (StatusCode::REQUEST_TIMEOUT, String::new())
    } else {
        fallback(error)
    }
}
pub(super) fn internal_error(error: io::Error) -> HttpError {
    http_error(error, crate::internal_server_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write as _;
    use std::io::Read;

    fn writer(limit: u64) -> ResultBodyWriter<Vec<u8>> {
        ResultBodyWriter {
            inner: Vec::new(),
            limit: Some(ResponseBodyLimit(limit)),
            written: 0,
            exceeded: None,
            lease: None,
        }
    }
    pub(super) fn request(limit: u64) -> Request<Body> {
        let policy = oxigraph_cli::workload::WorkloadPolicy::from_json(
            serde_json::json!({"format":"oxigraph-admission-v1","policy_id":"result-test","version":1,
            "max_active":1,"max_queued":0,"operator_max_active":1,"operator_max_queued":0,
            "queue_timeout_ms":1000,"retry_after_seconds":1,"max_result_bytes":limit,
            "classes":{"default":{"max_active":1,"max_queued":0}}}).to_string().as_bytes()
        ).unwrap();
        let controller = oxigraph_cli::workload::AdmissionController::new(policy).unwrap();
        let lease = controller
            .acquire(
                "default",
                oxigraph_cli::access::ListenerKind::Data,
                oxigraph::sparql::CancellationToken::new(),
            )
            .unwrap();
        let mut request = Request::builder().body(Body::empty()).unwrap();
        request.extensions_mut().insert(lease);
        request
    }

    #[test]
    fn cumulative_io_fmt_overflow_is_sticky_and_typed() -> io::Result<()> {
        let mut output = writer(4);
        output.write_all(b"12")?;
        output.write_str("34").unwrap();
        assert_eq!(output.finish()?, b"1234");
        let mut output = writer(4);
        output.write_str("12345").unwrap_err();
        let error = output.write(b"").unwrap_err();
        assert!(error.get_ref().unwrap().is::<ResponseBodyLimitExceeded>());
        assert!(output.finish().is_err());
        assert_eq!(
            internal_error(error),
            (StatusCode::SERVICE_UNAVAILABLE, String::new())
        );
        assert_eq!(writer(0).finish()?, b"");
        Ok(())
    }

    #[test]
    fn streaming_counter_survives_buffer_resets_and_error_never_becomes_eof() {
        for limit in [3, 4] {
            let request = request(limit);
            let response = crate::ReadForWrite::build_response(
                |mut writer| {
                    writer.write_all(b"a")?;
                    Ok((writer, 0))
                },
                |(mut writer, count)| {
                    writer.write_all(b"b")?;
                    Ok((count < 2).then_some((writer, count + 1)))
                },
                "text/plain",
                &request,
            )
            .unwrap();
            let mut body = response.into_body();
            let mut bytes = Vec::new();
            let result = body.read_to_end(&mut bytes);
            if limit == 4 {
                result.unwrap();
                assert_eq!(bytes, b"abbb");
            } else {
                assert!(
                    result
                        .unwrap_err()
                        .get_ref()
                        .unwrap()
                        .is::<ResponseBodyLimitExceeded>()
                );
                assert_eq!(bytes, b"abb");
                assert!(body.read(&mut [0; 1]).is_err());
            }
        }
        let calls = std::rc::Rc::new(std::cell::Cell::new(0));
        let observed = calls.clone();
        let mut response = crate::ReadForWrite::build_response(
            |_| Ok(()),
            move |()| {
                observed.set(observed.get() + 1);
                Err(io::Error::other("injected serializer failure"))
            },
            "text/plain",
            &request(9),
        )
        .unwrap();
        assert_eq!(response.body_mut().read(&mut []).unwrap(), 0);
        assert_eq!(calls.get(), 0);
        assert!(response.body_mut().read(&mut [0; 1]).is_err());
        assert!(response.body_mut().read(&mut [0; 1]).is_err());
        assert_eq!(calls.get(), 1);
    }
}
