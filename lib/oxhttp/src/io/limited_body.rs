use super::decoder::{decode_transfer_body, unique_header};
use crate::model::header::CONTENT_ENCODING;
use crate::model::{Body, HeaderMap};
use std::fmt;
use std::io::{BufRead, Error, ErrorKind, Read, Result};
use std::time::Instant;

/// Opt-in pre-handler buffering limits installed by a trusted admission hook.
/// Encoded bytes are the entity after transfer decoding, before content decoding
/// (not HTTP headers/chunk framing). Decoded bytes are after gzip/deflate.
/// Both limits are required; zero allows an empty entity. This is not an RSS cap.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestBodyLimits {
    pub max_encoded_bytes: u64,
    pub max_decoded_bytes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestBodyResource {
    EncodedBytes,
    DecodedBytes,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestBodyPhase {
    Headers,
    TransferDecoding,
    ContentDecoding,
}

/// A typed representation-limit failure, mapped to HTTP 413 by the server.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestBodyLimitExceeded {
    pub resource: RequestBodyResource,
    pub phase: RequestBodyPhase,
    pub limit: u64,
}

impl fmt::Display for RequestBodyLimitExceeded {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "request body {:?} limit {} exceeded during {:?}",
            self.resource, self.limit, self.phase
        )
    }
}
impl std::error::Error for RequestBodyLimitExceeded {}

#[derive(Clone, Copy, PartialEq)]
enum Coding {
    Identity,
    #[cfg(feature = "flate2")]
    Gzip,
    #[cfg(feature = "flate2")]
    Deflate,
}

fn coding(headers: &HeaderMap) -> Result<Coding> {
    let Some(value) = unique_header(headers, &CONTENT_ENCODING)? else {
        return Ok(Coding::Identity);
    };
    let bytes = value.as_bytes();
    if bytes.eq_ignore_ascii_case(b"identity") {
        return Ok(Coding::Identity);
    }
    #[cfg(feature = "flate2")]
    {
        if bytes.eq_ignore_ascii_case(b"gzip") || bytes.eq_ignore_ascii_case(b"x-gzip") {
            return Ok(Coding::Gzip);
        }
        if bytes.eq_ignore_ascii_case(b"deflate") {
            return Ok(Coding::Deflate);
        }
    }
    Err(Error::new(
        ErrorKind::Unsupported,
        "content encoding is unsupported by the request body limit profile",
    ))
}

pub(crate) fn check_headers(headers: &HeaderMap, limits: RequestBodyLimits) -> Result<()> {
    // Parse the existing framing contract, without reading any body bytes.
    let body = decode_transfer_body(headers, std::io::empty())?;
    let coding = coding(headers)?;
    if let Some(length) = body.len() {
        if length > limits.max_encoded_bytes {
            return Err(exceeded(
                RequestBodyResource::EncodedBytes,
                RequestBodyPhase::Headers,
                limits.max_encoded_bytes,
            ));
        }
        if coding == Coding::Identity && length > limits.max_decoded_bytes {
            return Err(exceeded(
                RequestBodyResource::DecodedBytes,
                RequestBodyPhase::Headers,
                limits.max_decoded_bytes,
            ));
        }
    }
    Ok(())
}

fn exceeded(resource: RequestBodyResource, phase: RequestBodyPhase, limit: u64) -> Error {
    Error::other(RequestBodyLimitExceeded {
        resource,
        phase,
        limit,
    })
}

fn checkpoint(deadline: Option<Instant>) -> Result<()> {
    if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
        Err(Error::new(ErrorKind::TimedOut, "request deadline elapsed"))
    } else {
        Ok(())
    }
}

fn read_bounded(
    reader: &mut impl Read,
    limit: u64,
    resource: RequestBodyResource,
    phase: RequestBodyPhase,
    deadline: Option<Instant>,
) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        checkpoint(deadline)?;
        let remaining = limit - output.len() as u64;
        let length = remaining.min(buffer.len() as u64 - 1) as usize + 1;
        let count = match reader.read(&mut buffer[..length]) {
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            result => result?,
        };
        checkpoint(deadline)?;
        if count == 0 {
            return Ok(output);
        }
        if count as u64 > remaining {
            return Err(exceeded(resource, phase, limit));
        }
        output.try_reserve(count).map_err(Error::other)?;
        output.extend_from_slice(&buffer[..count]);
    }
}

pub(super) fn decode(
    headers: &HeaderMap,
    reader: impl BufRead + 'static,
    limits: RequestBodyLimits,
    deadline: Option<Instant>,
) -> Result<Body> {
    checkpoint(deadline)?;
    check_headers(headers, limits)?;
    let coding = coding(headers)?;
    let mut entity = decode_transfer_body(headers, reader)?;
    let known_length = coding == Coding::Identity && entity.len().is_some();
    let (limit, resource) =
        if coding == Coding::Identity && limits.max_decoded_bytes < limits.max_encoded_bytes {
            (limits.max_decoded_bytes, RequestBodyResource::DecodedBytes)
        } else {
            (limits.max_encoded_bytes, RequestBodyResource::EncodedBytes)
        };
    // Finish the entire framed entity first. A content decoder's EOF alone
    // cannot prove that the HTTP body/trailers have been consumed.
    let encoded = read_bounded(
        &mut entity,
        limit,
        resource,
        RequestBodyPhase::TransferDecoding,
        deadline,
    )
    .map_err(|error| match error.kind() {
        // The existing sized-body reader reports premature framed EOF as
        // ConnectionAborted. In this pre-handler profile it is bad input, not
        // an application failure. A fired deadline takes precedence.
        ErrorKind::ConnectionAborted | ErrorKind::UnexpectedEof => checkpoint(deadline)
            .err()
            .unwrap_or_else(|| Error::new(ErrorKind::InvalidData, error)),
        _ => error,
    })?;
    let trailers = entity.trailers().cloned();
    let decoded = match coding {
        Coding::Identity => encoded,
        #[cfg(feature = "flate2")]
        Coding::Gzip => read_bounded(
            &mut flate2::bufread::MultiGzDecoder::new(CheckedInput {
                bytes: encoded.as_slice(),
                deadline,
            }),
            limits.max_decoded_bytes,
            RequestBodyResource::DecodedBytes,
            RequestBodyPhase::ContentDecoding,
            deadline,
        )
        .map_err(|error| match error.kind() {
            ErrorKind::InvalidInput | ErrorKind::UnexpectedEof => {
                Error::new(ErrorKind::InvalidData, error)
            }
            _ => error,
        })?,
        #[cfg(feature = "flate2")]
        Coding::Deflate => inflate(&encoded, limits.max_decoded_bytes, deadline)?,
    };
    checkpoint(deadline)?;
    Ok(Body::from_buffered(decoded, trailers, known_length))
}

#[cfg(feature = "flate2")]
struct CheckedInput<'a> {
    bytes: &'a [u8],
    deadline: Option<Instant>,
}
#[cfg(feature = "flate2")]
impl BufRead for CheckedInput<'_> {
    fn fill_buf(&mut self) -> Result<&[u8]> {
        checkpoint(self.deadline)?;
        Ok(&self.bytes[..self.bytes.len().min(8192)])
    }
    fn consume(&mut self, count: usize) {
        self.bytes = &self.bytes[count..];
    }
}
#[cfg(feature = "flate2")]
impl Read for CheckedInput<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> Result<usize> {
        let bytes = self.fill_buf()?;
        let count = buffer.len().min(bytes.len());
        buffer[..count].copy_from_slice(&bytes[..count]);
        self.consume(count);
        Ok(count)
    }
}

#[cfg(feature = "flate2")]
fn inflate(encoded: &[u8], limit: u64, deadline: Option<Instant>) -> Result<Vec<u8>> {
    // HTTP deflate is zlib-wrapped. Retain the existing raw-deflate compatibility
    // only when there is no zlib header; never retry a corrupt zlib stream as raw.
    let zlib = encoded.len() >= 2
        && encoded[0] & 15 == 8
        && encoded[0] >> 4 <= 7
        && u16::from_be_bytes([encoded[0], encoded[1]]) % 31 == 0;
    let mut decoder = flate2::Decompress::new(zlib);
    let mut output = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        checkpoint(deadline)?;
        let remaining = limit - output.len() as u64;
        let length = remaining.min(buffer.len() as u64 - 1) as usize + 1;
        let before_in = decoder.total_in();
        let before_out = decoder.total_out();
        let status = decoder
            .decompress(
                &encoded[before_in as usize..encoded.len().min(before_in as usize + 8192)],
                &mut buffer[..length],
                flate2::FlushDecompress::None,
            )
            .map_err(|error| Error::new(ErrorKind::InvalidData, error))?;
        let count = (decoder.total_out() - before_out) as usize;
        checkpoint(deadline)?;
        if count as u64 > remaining {
            return Err(exceeded(
                RequestBodyResource::DecodedBytes,
                RequestBodyPhase::ContentDecoding,
                limit,
            ));
        }
        output.try_reserve(count).map_err(Error::other)?;
        output.extend_from_slice(&buffer[..count]);
        if status == flate2::Status::StreamEnd {
            if decoder.total_in() as usize != encoded.len() {
                return Err(Error::new(
                    ErrorKind::InvalidData,
                    "trailing bytes after deflate stream",
                ));
            }
            return Ok(output);
        }
        if before_in == decoder.total_in() && count == 0 {
            return Err(Error::new(
                ErrorKind::InvalidData,
                "incomplete deflate stream",
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::HeaderValue;
    use crate::model::header::{CONTENT_LENGTH, TRANSFER_ENCODING};
    use std::io::Cursor;

    fn headers(length: usize, encoding: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_LENGTH, HeaderValue::from(length));
        if let Some(encoding) = encoding {
            headers.insert(CONTENT_ENCODING, encoding.parse().unwrap());
        }
        headers
    }

    fn limits(encoded: u64, decoded: u64) -> RequestBodyLimits {
        RequestBodyLimits {
            max_encoded_bytes: encoded,
            max_decoded_bytes: decoded,
        }
    }

    fn limit_error(error: &Error, resource: RequestBodyResource, phase: RequestBodyPhase) {
        let error = error
            .get_ref()
            .unwrap()
            .downcast_ref::<RequestBodyLimitExceeded>()
            .unwrap();
        assert_eq!(error.resource, resource);
        assert_eq!(error.phase, phase);
    }

    #[test]
    fn sized_exact_limits_empty_and_header_rejections() -> Result<()> {
        let body = decode(
            &headers(4, None),
            Cursor::new(b"body".to_vec()),
            limits(4, 4),
            None,
        )?;
        assert_eq!(body.len(), Some(4));
        assert_eq!(body.to_vec()?, b"body");
        assert!(
            decode(
                &headers(0, None),
                Cursor::new(Vec::new()),
                limits(0, 0),
                None
            )?
            .to_vec()?
            .is_empty()
        );
        limit_error(
            &check_headers(&headers(5, None), limits(4, 5)).unwrap_err(),
            RequestBodyResource::EncodedBytes,
            RequestBodyPhase::Headers,
        );
        limit_error(
            &check_headers(&headers(5, None), limits(5, 4)).unwrap_err(),
            RequestBodyResource::DecodedBytes,
            RequestBodyPhase::Headers,
        );
        assert_eq!(
            decode(
                &headers(5, None),
                Cursor::new(b"body".to_vec()),
                limits(5, 5),
                None
            )
            .unwrap_err()
            .kind(),
            ErrorKind::InvalidData
        );
        Ok(())
    }

    #[test]
    fn chunked_exact_limit_preserves_trailers_and_rejects_overflow() -> Result<()> {
        let mut headers = HeaderMap::new();
        headers.insert(TRANSFER_ENCODING, HeaderValue::from_static("chunked"));
        let payload = b"2\r\nbo\r\n2\r\ndy\r\n0\r\nX-Proof: retained\r\n\r\n".to_vec();
        let mut body = decode(&headers, Cursor::new(payload.clone()), limits(4, 4), None)?;
        assert_eq!(body.len(), None);
        assert_eq!(body.trailers().unwrap()["x-proof"], "retained");
        let mut data = Vec::new();
        body.read_to_end(&mut data)?;
        assert_eq!(data, b"body");
        for (limits, resource) in [
            (limits(3, 4), RequestBodyResource::EncodedBytes),
            (limits(4, 3), RequestBodyResource::DecodedBytes),
        ] {
            limit_error(
                &decode(&headers, Cursor::new(payload.clone()), limits, None).unwrap_err(),
                resource,
                RequestBodyPhase::TransferDecoding,
            );
        }
        assert!(
            decode(
                &headers,
                Cursor::new(b"4\r\nbody\r\n0\r\n".to_vec()),
                limits(4, 4),
                None
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn unsupported_encoding_and_expired_deadline_are_distinct() -> Result<()> {
        #[cfg(not(feature = "flate2"))]
        for encoding in ["gzip", "x-gzip", "deflate"] {
            assert_eq!(
                check_headers(&headers(1, Some(encoding)), limits(9, 9))
                    .unwrap_err()
                    .kind(),
                ErrorKind::Unsupported
            );
        }
        assert_eq!(
            check_headers(&headers(1, Some("br")), limits(9, 9))
                .unwrap_err()
                .kind(),
            ErrorKind::Unsupported
        );
        assert_eq!(
            decode(
                &headers(0, None),
                Cursor::new(Vec::new()),
                limits(0, 0),
                Some(Instant::now())
            )
            .unwrap_err()
            .kind(),
            ErrorKind::TimedOut
        );
        Ok(())
    }

    #[cfg(feature = "flate2")]
    fn compressed(input: &[u8], coding: &str) -> Result<Vec<u8>> {
        use flate2::{
            Compression,
            write::{DeflateEncoder, GzEncoder, ZlibEncoder},
        };
        use std::io::Write;
        match coding {
            "gzip" => {
                let mut e = GzEncoder::new(Vec::new(), Compression::default());
                e.write_all(input)?;
                e.finish()
            }
            "zlib" => {
                let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
                e.write_all(input)?;
                e.finish()
            }
            _ => {
                let mut e = DeflateEncoder::new(Vec::new(), Compression::default());
                e.write_all(input)?;
                e.finish()
            }
        }
    }

    #[cfg(feature = "flate2")]
    #[test]
    fn compressed_exact_expansion_limits_and_complete_stream_validation() -> Result<()> {
        let data = vec![b'x'; 20_000]; // Multiple output checkpoints.
        for format in ["gzip", "zlib", "raw"] {
            let encoding = if format == "gzip" { "gzip" } else { "deflate" };
            let empty = compressed(b"", format)?;
            assert!(
                decode(
                    &headers(empty.len(), Some(encoding)),
                    Cursor::new(empty.clone()),
                    limits(empty.len() as u64, 0),
                    None
                )?
                .to_vec()?
                .is_empty()
            );
            let encoded = compressed(&data, format)?;
            let h = headers(encoded.len(), Some(encoding));
            assert_eq!(
                decode(
                    &h,
                    Cursor::new(encoded.clone()),
                    limits(encoded.len() as u64, data.len() as u64),
                    None
                )?
                .to_vec()?,
                data
            );
            limit_error(
                &decode(
                    &h,
                    Cursor::new(encoded.clone()),
                    limits(encoded.len() as u64, data.len() as u64 - 1),
                    None,
                )
                .unwrap_err(),
                RequestBodyResource::DecodedBytes,
                RequestBodyPhase::ContentDecoding,
            );
            limit_error(
                &check_headers(&h, limits(encoded.len() as u64 - 1, data.len() as u64))
                    .unwrap_err(),
                RequestBodyResource::EncodedBytes,
                RequestBodyPhase::Headers,
            );
            let truncated = &encoded[..encoded.len() - 1];
            assert_eq!(
                decode(
                    &headers(truncated.len(), Some(encoding)),
                    Cursor::new(truncated.to_vec()),
                    limits(30_000, 30_000),
                    None
                )
                .unwrap_err()
                .kind(),
                ErrorKind::InvalidData,
                "truncated {format}"
            );
            let mut trailing = encoded;
            trailing.extend_from_slice(b"junk");
            assert_eq!(
                decode(
                    &headers(trailing.len(), Some(encoding)),
                    Cursor::new(trailing),
                    limits(30_000, 30_000),
                    None
                )
                .unwrap_err()
                .kind(),
                ErrorKind::InvalidData,
                "trailing {format}"
            );
        }
        Ok(())
    }

    #[cfg(feature = "flate2")]
    #[test]
    fn gzip_members_share_one_decoded_budget_and_check_crc() -> Result<()> {
        let mut encoded = compressed(b"one", "gzip")?;
        encoded.extend(compressed(b"two", "gzip")?);
        let h = headers(encoded.len(), Some("gzip"));
        assert_eq!(
            decode(&h, Cursor::new(encoded.clone()), limits(999, 6), None)?.to_vec()?,
            b"onetwo"
        );
        limit_error(
            &decode(&h, Cursor::new(encoded.clone()), limits(999, 5), None).unwrap_err(),
            RequestBodyResource::DecodedBytes,
            RequestBodyPhase::ContentDecoding,
        );
        let index = encoded.len() - 8;
        encoded[index] ^= 1;
        assert_eq!(
            decode(&h, Cursor::new(encoded), limits(999, 6), None)
                .unwrap_err()
                .kind(),
            ErrorKind::InvalidData
        );
        let mut input = CheckedInput {
            bytes: b"",
            deadline: Some(Instant::now()),
        };
        assert_eq!(input.fill_buf().unwrap_err().kind(), ErrorKind::TimedOut);
        let mut empty_members = compressed(b"", "gzip")?;
        empty_members.extend(compressed(b"", "gzip")?);
        let mut decoder = flate2::bufread::MultiGzDecoder::new(CheckedInput {
            bytes: &empty_members,
            deadline: None,
        });
        decoder.get_mut().deadline = Some(Instant::now());
        assert_eq!(
            decoder.read(&mut [0; 1]).unwrap_err().kind(),
            ErrorKind::TimedOut
        );
        Ok(())
    }

    #[cfg(feature = "flate2")]
    #[test]
    fn zlib_looking_raw_stream_is_not_retried_as_raw() -> Result<()> {
        // A legal raw stored block can begin with a zlib-looking prefix.
        // Bounded-profile compatibility is intentionally limited to raw streams
        // without that prefix; corrupt zlib is never retried under another format.
        let mut encoded = vec![0x78, 0x9c, 0x00, 0x63, 0xff];
        encoded.extend_from_slice(&[b'x'; 156]);
        encoded.extend_from_slice(&[0x01, 0x00, 0x00, 0xff, 0xff]);
        let mut raw = flate2::read::DeflateDecoder::new(encoded.as_slice());
        let mut decoded = Vec::new();
        raw.read_to_end(&mut decoded)?;
        assert_eq!(decoded, [b'x'; 156]);
        assert_eq!(
            inflate(&encoded, 156, None).unwrap_err().kind(),
            ErrorKind::InvalidData
        );
        Ok(())
    }
}
