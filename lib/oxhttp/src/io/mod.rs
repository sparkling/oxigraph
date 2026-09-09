mod decoder;
mod encoder;
#[cfg(feature = "server")]
pub(crate) mod limited_body;

pub use decoder::{decode_request_body, decode_request_headers, decode_response};
#[cfg(feature = "server")]
pub(crate) use encoder::encode_head_response;
pub use encoder::{encode_request, encode_response, encode_response_with_connection};

/// Capacity for buffers.
///
/// Should be significantly greater than BufWriter capacity to avoid flush in the `copy` method.
pub(super) const BUFFER_CAPACITY: usize = 16 * 1024;
