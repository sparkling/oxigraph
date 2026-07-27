use crate::{HttpError, bad_request};
use oxhttp::model::{Body, Request};

pub(super) fn parameters(request: &Request<Body>) -> Result<Vec<(String, String)>, HttpError> {
    request
        .uri()
        .query()
        .unwrap_or_default()
        .split('&')
        .filter(|field| !field.is_empty())
        .map(|field| {
            let (key, value) = field.split_once('=').unwrap_or((field, ""));
            Ok((decode(key)?, decode(value)?))
        })
        .collect()
}

fn decode(value: &str) -> Result<String, HttpError> {
    let input = value.as_bytes();
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            let high = input
                .get(index + 1)
                .copied()
                .and_then(hex)
                .ok_or_else(invalid_percent_encoding)?;
            let low = input
                .get(index + 2)
                .copied()
                .and_then(hex)
                .ok_or_else(invalid_percent_encoding)?;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(input[index]);
            index += 1;
        }
    }
    String::from_utf8(output)
        .map_err(|_| bad_request("Graph Store query parameters must be UTF-8 encoded"))
}

fn invalid_percent_encoding() -> HttpError {
    bad_request("Invalid percent encoding in Graph Store query parameter")
}

const fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // SPARQL 1.2 Graph Store Protocol editor HEAD 69c4f0b, §4.1
    // #indirect-graph-identification: percent-decode to a UTF-8 IRI string.
    #[test]
    fn indirect_graph_selector_uses_strict_rfc3986_utf8_decoding() {
        let request = Request::builder()
            .uri("http://localhost/store?graph=https%3A%2F%2Fexample.com%2F%E2%82%AC+a")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            parameters(&request).unwrap(),
            [(
                "graph".to_owned(),
                "https://example.com/\u{20ac}+a".to_owned()
            )]
        );

        for query in ["graph=%FF", "graph=%C3%28", "graph=%", "graph=%GG"] {
            let request = Request::builder()
                .uri(format!("http://localhost/store?{query}"))
                .body(Body::empty())
                .unwrap();
            assert!(parameters(&request).is_err(), "{query} must be rejected");
        }
    }
}
