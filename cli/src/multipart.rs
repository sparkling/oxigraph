use memchr::memmem;
use std::fmt;

const MAX_PARTS: usize = 1024;
const MAX_HEADER_BYTES: usize = 64 * 1024;

#[derive(Debug)]
pub struct MultipartError(String);

impl MultipartError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for MultipartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

pub struct MultipartPart<'a> {
    pub content_type: String,
    pub body: &'a [u8],
}

pub fn boundary_from_content_type(value: &str) -> Result<Option<String>, MultipartError> {
    let mut segments = value.split(';');
    let media_type = segments.next().unwrap_or_default().trim();
    if !media_type.eq_ignore_ascii_case("multipart/form-data") {
        return Ok(None);
    }

    let mut boundary = None;
    for segment in segments {
        let (name, value) = segment
            .split_once('=')
            .ok_or_else(|| MultipartError::new("Malformed multipart media type parameter"))?;
        if !name.trim().eq_ignore_ascii_case("boundary") {
            continue;
        }
        if boundary.is_some() {
            return Err(MultipartError::new(
                "Multiple multipart boundary parameters provided",
            ));
        }
        boundary = Some(parse_quoted_parameter(value.trim())?);
    }
    let boundary =
        boundary.ok_or_else(|| MultipartError::new("Missing multipart boundary parameter"))?;
    validate_boundary(&boundary)?;
    Ok(Some(boundary))
}

fn parse_quoted_parameter(value: &str) -> Result<String, MultipartError> {
    if !value.starts_with('"') {
        if value.is_empty() {
            return Err(MultipartError::new(
                "The multipart boundary must not be empty",
            ));
        }
        return Ok(value.to_owned());
    }
    if !value.ends_with('"') || value.len() < 2 {
        return Err(MultipartError::new(
            "Unterminated quoted multipart boundary",
        ));
    }
    let mut result = String::new();
    let mut escaped = false;
    for character in value[1..value.len() - 1].chars() {
        if escaped {
            if character == '\r' || character == '\n' {
                return Err(MultipartError::new(
                    "A multipart boundary must not contain line breaks",
                ));
            }
            result.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' || character == '\r' || character == '\n' {
            return Err(MultipartError::new(
                "Invalid character in quoted multipart boundary",
            ));
        } else {
            result.push(character);
        }
    }
    if escaped {
        return Err(MultipartError::new(
            "A quoted multipart boundary ends with an escape",
        ));
    }
    Ok(result)
}

fn validate_boundary(boundary: &str) -> Result<(), MultipartError> {
    if boundary.is_empty() || boundary.len() > 70 {
        return Err(MultipartError::new(
            "A multipart boundary must contain between 1 and 70 characters",
        ));
    }
    if boundary.ends_with(' ')
        || !boundary.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'\''
                        | b'('
                        | b')'
                        | b'+'
                        | b'_'
                        | b','
                        | b'-'
                        | b'.'
                        | b'/'
                        | b':'
                        | b'='
                        | b'?'
                        | b' '
                )
        })
    {
        return Err(MultipartError::new("Invalid multipart boundary"));
    }
    Ok(())
}

pub fn parse_multipart<'a>(
    body: &'a [u8],
    boundary: &str,
) -> Result<Vec<MultipartPart<'a>>, MultipartError> {
    let delimiter = [b"--".as_slice(), boundary.as_bytes()].concat();
    let delimiter_start = find_first_delimiter(body, &delimiter)
        .ok_or_else(|| MultipartError::new("Multipart opening boundary not found"))?;
    let mut cursor = delimiter_start;
    let mut parts = Vec::new();

    loop {
        let delimiter_end = cursor + delimiter.len();
        let suffix = body
            .get(delimiter_end..)
            .ok_or_else(|| MultipartError::new("Truncated multipart boundary"))?;
        let header_start = match delimiter_suffix(suffix) {
            Some(DelimiterSuffix::Part { consumed }) => delimiter_end + consumed,
            Some(DelimiterSuffix::Closing) => {
                if parts.is_empty() {
                    return Err(MultipartError::new(
                        "A multipart RDF request must contain at least one part",
                    ));
                }
                return Ok(parts);
            }
            None => {
                return Err(MultipartError::new(
                    "A multipart boundary must end with CRLF",
                ));
            }
        };
        let header_separator = b"\r\n\r\n";
        let relative_header_end = memmem::find(
            body.get(header_start..)
                .ok_or_else(|| MultipartError::new("Truncated multipart headers"))?,
            header_separator,
        )
        .ok_or_else(|| MultipartError::new("Multipart headers are not terminated"))?;
        if relative_header_end > MAX_HEADER_BYTES {
            return Err(MultipartError::new("Multipart part headers are too large"));
        }
        let header_end = header_start + relative_header_end;
        let content_type = parse_part_headers(&body[header_start..header_end])?;
        let part_start = header_end + header_separator.len();
        let (part_end, next_delimiter) = find_next_delimiter(body, part_start, &delimiter)
            .ok_or_else(|| MultipartError::new("Multipart closing boundary not found"))?;
        parts.push(MultipartPart {
            content_type,
            body: &body[part_start..part_end],
        });
        if parts.len() > MAX_PARTS {
            return Err(MultipartError::new(
                "A multipart request contains too many parts",
            ));
        }
        cursor = next_delimiter;
    }
}

fn find_first_delimiter(body: &[u8], delimiter: &[u8]) -> Option<usize> {
    if body.starts_with(delimiter) && valid_delimiter_suffix(body.get(delimiter.len()..)) {
        return Some(0);
    }
    let marker = [b"\r\n".as_slice(), delimiter].concat();
    memmem::find_iter(body, &marker)
        .map(|position| position + 2)
        .find(|position| valid_delimiter_suffix(body.get(position + delimiter.len()..)))
}

fn find_next_delimiter(body: &[u8], from: usize, delimiter: &[u8]) -> Option<(usize, usize)> {
    let marker = [b"\r\n".as_slice(), delimiter].concat();
    memmem::find_iter(body.get(from..)?, &marker).find_map(|relative_position| {
        let marker_start = from + relative_position;
        let delimiter_start = marker_start + 2;
        valid_delimiter_suffix(body.get(delimiter_start + delimiter.len()..))
            .then_some((marker_start, delimiter_start))
    })
}

fn valid_delimiter_suffix(suffix: Option<&[u8]>) -> bool {
    suffix.and_then(delimiter_suffix).is_some()
}

enum DelimiterSuffix {
    Part { consumed: usize },
    Closing,
}

fn delimiter_suffix(suffix: &[u8]) -> Option<DelimiterSuffix> {
    let (closing, mut cursor) = if suffix.starts_with(b"--") {
        (true, 2)
    } else {
        (false, 0)
    };
    while suffix
        .get(cursor)
        .is_some_and(|byte| matches!(*byte, b' ' | b'\t'))
    {
        cursor += 1;
    }
    if closing {
        let rest = suffix.get(cursor..)?;
        (rest.is_empty() || rest.starts_with(b"\r\n")).then_some(DelimiterSuffix::Closing)
    } else if suffix
        .get(cursor..)
        .is_some_and(|rest| rest.starts_with(b"\r\n"))
    {
        Some(DelimiterSuffix::Part {
            consumed: cursor + 2,
        })
    } else {
        None
    }
}

fn parse_part_headers(headers: &[u8]) -> Result<String, MultipartError> {
    let headers = std::str::from_utf8(headers)
        .map_err(|_| MultipartError::new("Multipart part headers must be valid UTF-8"))?;
    let mut content_type = None;
    for line in headers.split("\r\n") {
        if line.starts_with(' ') || line.starts_with('\t') {
            return Err(MultipartError::new(
                "Folded multipart headers are not supported",
            ));
        }
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| MultipartError::new("Malformed multipart part header"))?;
        if name.is_empty()
            || !name.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(
                        byte,
                        b'!' | b'#'
                            | b'$'
                            | b'%'
                            | b'&'
                            | b'\''
                            | b'*'
                            | b'+'
                            | b'-'
                            | b'.'
                            | b'^'
                            | b'_'
                            | b'`'
                            | b'|'
                            | b'~'
                    )
            })
        {
            return Err(MultipartError::new("Invalid multipart part header name"));
        }
        if !name.eq_ignore_ascii_case("content-type") {
            continue;
        }
        if content_type.is_some() {
            return Err(MultipartError::new(
                "A multipart part has multiple Content-Type headers",
            ));
        }
        let value = value.trim();
        if value.is_empty() {
            return Err(MultipartError::new(
                "A multipart part has an empty Content-Type header",
            ));
        }
        content_type = Some(value.to_owned());
    }
    content_type.ok_or_else(|| {
        MultipartError::new("Each multipart RDF part must have a Content-Type header")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_boundary_and_multiple_parts() {
        let boundary = boundary_from_content_type(
            "multipart/form-data; boundary=\"simple:boundary\"; charset=utf-8",
        )
        .unwrap()
        .unwrap();
        let body = b"--simple:boundary\r\nContent-Type: text/turtle\r\n\r\n<a> <b> <c> .\r\n--simple:boundary\r\nContent-Disposition: form-data; name=\"second\"\r\nContent-Type: application/n-triples\r\n\r\n<d> <e> <f> .\r\n--simple:boundary--\r\n";
        let parts = parse_multipart(body, &boundary).unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].content_type, "text/turtle");
        assert_eq!(parts[0].body, b"<a> <b> <c> .");
        assert_eq!(parts[1].content_type, "application/n-triples");
        assert_eq!(parts[1].body, b"<d> <e> <f> .");
    }

    #[test]
    fn rejects_ambiguous_or_truncated_multipart() {
        boundary_from_content_type("multipart/form-data; boundary=one; boundary=two").unwrap_err();
        assert!(
            parse_multipart(
                b"--boundary\r\nContent-Type: text/turtle\r\n\r\n<a> <b> <c> .",
                "boundary"
            )
            .is_err()
        );
        assert!(
            parse_multipart(
                b"not-a-boundary\r\nContent-Type: text/turtle\r\n\r\n<a> <b> <c> .",
                "boundary"
            )
            .is_err()
        );
        assert!(parse_multipart(b"--boundary--\r\n", "boundary").is_err());
    }

    #[test]
    fn accepts_transport_padding_on_delimiter_lines() {
        let body = b"--boundary \t\r\nContent-Type: text/turtle\r\n\r\n<a> <b> <c> .\r\n--boundary-- \t\r\n";
        let parts = parse_multipart(body, "boundary").unwrap();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].body, b"<a> <b> <c> .");
    }
}
