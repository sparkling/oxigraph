use crate::{HttpError, bad_request};
use oxhttp::model::{Body, Request};

pub(super) fn parameters(request: &Request<Body>) -> Result<Vec<(String, String)>, HttpError> {
    oxigraph_cli::access::target::parameters(request.uri()).map_err(bad_request)
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
