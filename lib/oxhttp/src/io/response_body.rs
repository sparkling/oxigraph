use crate::model::Body;
use std::fmt;
use std::io::{Error, ErrorKind, Read, Result};

/// Trusted admission limit on emitted response entity bytes, excluding HTTP
/// headers, chunk framing and trailers. HEAD/bodyless responses emit no entity.
/// Application serializers may independently enforce the same generation cap.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResponseBodyLimit(pub u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResponseBodyPhase {
    Serialization,
    Transmission,
}

/// Result exhaustion is distinct from a malformed request or RDF negotiation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResponseBodyLimitExceeded {
    pub limit: u64,
    pub phase: ResponseBodyPhase,
}
impl fmt::Display for ResponseBodyLimitExceeded {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "response body byte limit {} exceeded during {:?}",
            self.limit, self.phase
        )
    }
}
impl std::error::Error for ResponseBodyLimitExceeded {}

pub(crate) struct LimitedResponseBody {
    pub(crate) inner: Body,
    limit: ResponseBodyLimit,
    consumed: u64,
    failed: Option<ErrorKind>,
}
impl LimitedResponseBody {
    pub(crate) fn new(inner: Body, limit: ResponseBodyLimit) -> Result<Self> {
        let body = Self {
            inner,
            limit,
            consumed: 0,
            failed: None,
        };
        if body.inner.len().is_some_and(|length| length > limit.0) {
            return Err(body.exceeded());
        }
        Ok(body)
    }
    fn exceeded(&self) -> Error {
        Error::other(ResponseBodyLimitExceeded {
            limit: self.limit.0,
            phase: ResponseBodyPhase::Transmission,
        })
    }
}
impl Read for LimitedResponseBody {
    fn read(&mut self, buffer: &mut [u8]) -> Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        if let Some(kind) = self.failed {
            return Err(Error::new(kind, "response body previously failed"));
        }
        // Probe one byte past the cap to distinguish exact EOF from truncation.
        let remaining = self.limit.0 - self.consumed;
        let length = buffer
            .len()
            .min(remaining.saturating_add(1).try_into().unwrap_or(usize::MAX));
        let count = match self.inner.read(&mut buffer[..length]) {
            Ok(count) => count,
            Err(error) => {
                if error.kind() != ErrorKind::Interrupted {
                    self.failed = Some(error.kind());
                }
                return Err(error);
            }
        };
        if count as u64 > remaining {
            self.failed = Some(ErrorKind::Other);
            return Err(self.exceeded());
        }
        self.consumed += count as u64;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn underlying_failure_at_exact_cap_is_not_eof() -> Result<()> {
        struct Broken {
            sent: bool,
        }
        impl Read for Broken {
            fn read(&mut self, buffer: &mut [u8]) -> Result<usize> {
                if self.sent {
                    return Err(Error::new(ErrorKind::UnexpectedEof, "broken serializer"));
                }
                self.sent = true;
                buffer[0] = b'x';
                Ok(1)
            }
        }
        let mut body = LimitedResponseBody::new(
            Body::from_read(Broken { sent: false }),
            ResponseBodyLimit(1),
        )?;
        let mut result = Vec::new();
        assert_eq!(
            body.read_to_end(&mut result).unwrap_err().kind(),
            ErrorKind::UnexpectedEof
        );
        assert_eq!(result, b"x");
        assert!(body.read(&mut [0; 1]).is_err());
        Ok(())
    }

    #[test]
    fn exact_eof_overflow_and_empty_reads_are_distinct() -> Result<()> {
        for length in [0, 4] {
            let bytes = vec![b'x'; length];
            let mut body = LimitedResponseBody::new(
                Body::from_read(Cursor::new(bytes.clone())),
                ResponseBodyLimit(length as u64),
            )?;
            assert_eq!(body.read(&mut [])?, 0);
            let mut result = Vec::new();
            body.read_to_end(&mut result)?;
            assert_eq!(result, bytes);
            assert_eq!(body.read(&mut [0; 1])?, 0);
        }
        let mut body =
            LimitedResponseBody::new(Body::from_read(Cursor::new(b"12345")), ResponseBodyLimit(4))?;
        let mut prefix = [0; 4];
        body.read_exact(&mut prefix)?;
        assert_eq!(prefix, *b"1234");
        let error = body.read(&mut [0; 1]).unwrap_err();
        assert_eq!(
            error
                .get_ref()
                .unwrap()
                .downcast_ref::<ResponseBodyLimitExceeded>(),
            Some(&ResponseBodyLimitExceeded {
                limit: 4,
                phase: ResponseBodyPhase::Transmission
            })
        );
        assert!(body.read(&mut [0; 1]).is_err(), "overflow resumed as EOF");
        assert!(LimitedResponseBody::new(Body::from("12345"), ResponseBodyLimit(4)).is_err());
        Ok(())
    }
}
