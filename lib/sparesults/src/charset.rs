use crate::error::QueryResultsSyntaxError;
use crate::media_type::QueryResultsCharset;
use std::io::{self, Read};
#[cfg(feature = "async-tokio")]
use std::pin::Pin;
#[cfg(feature = "async-tokio")]
use std::task::{Context, Poll};
#[cfg(feature = "async-tokio")]
use tokio::io::{AsyncRead, ReadBuf};

const NON_ASCII_MESSAGE: &str =
    "input contains a non-ASCII octet but the media type declares US-ASCII";

pub(crate) fn validate_slice(
    input: &[u8],
    charset: Option<QueryResultsCharset>,
) -> Result<(), QueryResultsSyntaxError> {
    if requires_ascii(charset) && !input.is_ascii() {
        Err(QueryResultsSyntaxError::msg(NON_ASCII_MESSAGE))
    } else {
        Ok(())
    }
}

pub(crate) struct CharsetReader<R> {
    inner: R,
    charset: Option<QueryResultsCharset>,
}

impl<R> CharsetReader<R> {
    pub(crate) const fn new(inner: R, charset: Option<QueryResultsCharset>) -> Self {
        Self { inner, charset }
    }
}

impl<R: Read> Read for CharsetReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(buf)?;
        validate_read(&buf[..count], self.charset)?;
        Ok(count)
    }
}

#[cfg(feature = "async-tokio")]
pub(crate) struct TokioAsyncCharsetReader<R> {
    inner: R,
    charset: Option<QueryResultsCharset>,
}

#[cfg(feature = "async-tokio")]
impl<R> TokioAsyncCharsetReader<R> {
    pub(crate) const fn new(inner: R, charset: Option<QueryResultsCharset>) -> Self {
        Self { inner, charset }
    }
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> AsyncRead for TokioAsyncCharsetReader<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let previous_length = buf.filled().len();
        match Pin::new(&mut this.inner).poll_read(cx, buf) {
            Poll::Ready(Ok(())) => {
                let new_bytes = &buf.filled()[previous_length..];
                Poll::Ready(validate_read(new_bytes, this.charset))
            }
            result => result,
        }
    }
}

fn validate_read(input: &[u8], charset: Option<QueryResultsCharset>) -> io::Result<()> {
    if requires_ascii(charset) && !input.is_ascii() {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            NON_ASCII_MESSAGE,
        ))
    } else {
        Ok(())
    }
}

fn requires_ascii(charset: Option<QueryResultsCharset>) -> bool {
    matches!(charset, Some(QueryResultsCharset::UsAscii))
}
