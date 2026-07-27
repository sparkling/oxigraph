#![expect(
    clippy::panic_in_result_fn,
    reason = "test assertions report protocol mismatches while Result propagates setup failures"
)]

use super::*;
use anyhow::{Result, anyhow};
use oxhttp::model::header::{CONTENT_LENGTH, ETAG, HeaderValue, IF_MATCH, IF_NONE_MATCH, LOCATION};
#[cfg(feature = "rdf-12")]
use oxigraph::model::{Quad, Triple};
use std::io::read_to_string;

const GRAPH: &str = "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fconditional";
const OLD: &str = "<http://example.com/old> <http://example.com/p> <http://example.com/o> .";
const NEW: &str = "<http://example.com/new> <http://example.com/p> <http://example.com/o> .";

struct TestServer {
    store: Store,
}

impl TestServer {
    fn new() -> Result<Self> {
        Ok(Self {
            store: Store::new()?,
        })
    }

    fn exec(&self, request: Request<impl Into<Body>>) -> Response<Body> {
        let mut request = request.map(Into::into);
        let method = request.method().clone();
        finalize_response(
            &method,
            handle_request(
                &mut request,
                self.store.clone(),
                SparqlEvaluator::new(),
                false,
                false,
                QueryEntailment::Simple,
                None,
            )
            .unwrap_or_else(|(status, message)| error(status, message)),
        )
    }

    fn status(
        &self,
        request: Request<impl Into<Body>>,
        expected: StatusCode,
    ) -> Result<Response<Body>> {
        let mut response = self.exec(request);
        if response.status() != expected {
            let body = read_to_string(response.body_mut())?;
            return Err(anyhow!(
                "expected {expected}, got {}: {body}",
                response.status()
            ));
        }
        Ok(response)
    }

    fn get(&self, uri: &str) -> Result<(HeaderValue, String)> {
        let mut response = self.status(
            Request::builder()
                .uri(uri)
                .header(ACCEPT, "application/n-triples")
                .body(())?,
            StatusCode::OK,
        )?;
        let etag = response
            .headers()
            .get(ETAG)
            .cloned()
            .ok_or_else(|| anyhow!("GET response has no ETag"))?;
        Ok((etag, read_to_string(response.body_mut())?))
    }
}

#[test]
fn graph_store_get_head_and_cache_validation_are_consistent() -> Result<()> {
    let server = TestServer::new()?;
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .body(OLD)?,
        StatusCode::CREATED,
    )?;

    let mut get = server.status(
        Request::builder()
            .uri(GRAPH)
            .header(ACCEPT, "application/n-triples")
            .body(())?,
        StatusCode::OK,
    )?;
    let etag = get
        .headers()
        .get(ETAG)
        .cloned()
        .ok_or_else(|| anyhow!("GET response has no ETag"))?;
    let content_length = get
        .headers()
        .get(CONTENT_LENGTH)
        .cloned()
        .ok_or_else(|| anyhow!("GET response has no Content-Length"))?;
    let body = read_to_string(get.body_mut())?;
    assert_eq!(content_length.to_str()?.parse::<usize>()?, body.len());

    let mut head = server.status(
        Request::builder()
            .method(Method::HEAD)
            .uri(GRAPH)
            .header(ACCEPT, "application/n-triples")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(head.headers().get(ETAG), Some(&etag));
    assert_eq!(head.headers().get(CONTENT_LENGTH), Some(&content_length));
    assert!(read_to_string(head.body_mut())?.is_empty());

    for candidate in [etag.to_str()?.to_owned(), format!("W/{}", etag.to_str()?)] {
        let mut response = server.status(
            Request::builder()
                .uri(GRAPH)
                .header(ACCEPT, "application/n-triples")
                .header(IF_NONE_MATCH, candidate)
                .body(())?,
            StatusCode::NOT_MODIFIED,
        )?;
        assert_eq!(response.headers().get(ETAG), Some(&etag));
        assert!(read_to_string(response.body_mut())?.is_empty());
    }
    server.status(
        Request::builder()
            .uri(GRAPH)
            .header(IF_NONE_MATCH, "\"unterminated")
            .body(())?,
        StatusCode::BAD_REQUEST,
    )?;
    server.status(
        Request::builder()
            .uri(GRAPH)
            .header(IF_MATCH, format!("W/{}", etag.to_str()?))
            .body(())?,
        StatusCode::PRECONDITION_FAILED,
    )?;
    Ok(())
}

#[test]
fn graph_store_write_preconditions_prevent_lost_updates() -> Result<()> {
    let server = TestServer::new()?;
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .body(OLD)?,
        StatusCode::CREATED,
    )?;
    let (old_etag, old_body) = server.get(GRAPH)?;

    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .header(IF_MATCH, "\"stale\"")
            .body(NEW)?,
        StatusCode::PRECONDITION_FAILED,
    )?;
    assert_eq!(server.get(GRAPH)?.1, old_body);

    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .header(IF_MATCH, old_etag.clone())
            .body(NEW)?,
        StatusCode::NO_CONTENT,
    )?;
    let (new_etag, new_body) = server.get(GRAPH)?;
    assert_ne!(new_etag, old_etag);
    assert!(new_body.contains("http://example.com/new"));

    server.status(
        Request::builder()
            .method(Method::POST)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .header(IF_MATCH, old_etag)
            .body(OLD)?,
        StatusCode::PRECONDITION_FAILED,
    )?;
    assert_eq!(server.get(GRAPH)?.1, new_body);
    server.status(
        Request::builder()
            .method(Method::POST)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .header(IF_MATCH, new_etag)
            .body(OLD)?,
        StatusCode::NO_CONTENT,
    )?;
    let (merged_etag, merged_body) = server.get(GRAPH)?;
    assert!(merged_body.contains("http://example.com/old"));
    assert!(merged_body.contains("http://example.com/new"));

    server.status(
        Request::builder()
            .method(Method::DELETE)
            .uri(GRAPH)
            .header(IF_MATCH, "\"stale\"")
            .body(())?,
        StatusCode::PRECONDITION_FAILED,
    )?;
    server.status(
        Request::builder()
            .method(Method::DELETE)
            .uri(GRAPH)
            .header(IF_MATCH, merged_etag)
            .body(())?,
        StatusCode::NO_CONTENT,
    )?;
    server.status(
        Request::builder().uri(GRAPH).body(())?,
        StatusCode::NOT_FOUND,
    )?;

    let create_only = "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fcreate-only";
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(create_only)
            .header(CONTENT_TYPE, "text/turtle")
            .header(IF_NONE_MATCH, "*")
            .body(OLD)?,
        StatusCode::CREATED,
    )?;
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(create_only)
            .header(CONTENT_TYPE, "text/turtle")
            .header(IF_NONE_MATCH, "*")
            .body(NEW)?,
        StatusCode::PRECONDITION_FAILED,
    )?;
    Ok(())
}

#[test]
fn graph_store_put_replacement_is_atomic() -> Result<()> {
    let server = TestServer::new()?;
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .body(OLD)?,
        StatusCode::CREATED,
    )?;
    let before = server.get(GRAPH)?;
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .body(concat!(
                "<http://example.com/leak> <http://example.com/p> <http://example.com/o> .\n",
                "@prefix broken"
            ))?,
        StatusCode::BAD_REQUEST,
    )?;
    assert_eq!(server.get(GRAPH)?, before);

    let default = "http://localhost/store?default";
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(default)
            .header(CONTENT_TYPE, "text/turtle")
            .body(OLD)?,
        StatusCode::NO_CONTENT,
    )?;
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store")
            .header(CONTENT_TYPE, "application/trig")
            .body(concat!(
                "<http://example.com/leak> <http://example.com/p> <http://example.com/o> .\n",
                "{ broken"
            ))?,
        StatusCode::BAD_REQUEST,
    )?;
    assert!(server.get(default)?.1.contains("http://example.com/old"));
    Ok(())
}

#[test]
fn graph_store_dataset_get_preserves_empty_named_graphs() -> Result<()> {
    let server = TestServer::new()?;
    let graph = NamedNode::new("http://example.com/empty")?;
    server.store.insert_named_graph(graph.clone())?;

    let mut response = server.status(
        Request::builder()
            .uri("http://localhost/store")
            .header(ACCEPT, "application/trig")
            .body(())?,
        StatusCode::OK,
    )?;
    let body = read_to_string(response.body_mut())?;
    let dataset = RdfParser::from_format(RdfFormat::TriG)
        .for_slice(body.as_bytes())
        .collect_dataset()?;
    assert!(dataset.contains_named_graph(&graph));

    let mut json_ld_response = server.status(
        Request::builder()
            .uri("http://localhost/store")
            .header(ACCEPT, "application/ld+json")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(
        json_ld_response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/ld+json")
    );
    let json_ld_etag = json_ld_response
        .headers()
        .get(ETAG)
        .cloned()
        .ok_or_else(|| anyhow!("JSON-LD GET response has no ETag"))?;
    assert!(
        json_ld_etag
            .to_str()?
            .contains("oxigraph-gsp-v2-jsonld-11-")
    );
    let json_ld_body = read_to_string(json_ld_response.body_mut())?;
    let json_ld_dataset = RdfParser::from_format(
        RdfFormat::from_media_type("application/ld+json")
            .ok_or_else(|| anyhow!("JSON-LD media type is not registered"))?,
    )
    .for_slice(json_ld_body.as_bytes())
    .collect_dataset()?;
    assert!(json_ld_dataset.contains_named_graph(&graph));

    let mut json_ld_head = server.status(
        Request::builder()
            .method(Method::HEAD)
            .uri("http://localhost/store")
            .header(ACCEPT, "application/ld+json")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(json_ld_head.headers().get(ETAG), Some(&json_ld_etag));
    assert_eq!(
        json_ld_head.headers().get(CONTENT_TYPE),
        json_ld_response.headers().get(CONTENT_TYPE)
    );
    assert!(read_to_string(json_ld_head.body_mut())?.is_empty());

    let empty_graph_uri = "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fempty";
    let mut empty_graph_response = server.status(
        Request::builder()
            .uri(empty_graph_uri)
            .header(ACCEPT, "application/ld+json")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(
        empty_graph_response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/ld+json")
    );
    let empty_graph_etag = empty_graph_response
        .headers()
        .get(ETAG)
        .cloned()
        .ok_or_else(|| anyhow!("empty graph JSON-LD response has no ETag"))?;
    let empty_graph_body = read_to_string(empty_graph_response.body_mut())?;
    assert!(
        RdfParser::from_format(
            RdfFormat::from_media_type("application/ld+json")
                .ok_or_else(|| anyhow!("JSON-LD media type is not registered"))?
        )
        .for_slice(empty_graph_body.as_bytes())
        .collect_dataset()?
        .is_empty()
    );
    let mut empty_graph_head = server.status(
        Request::builder()
            .method(Method::HEAD)
            .uri(empty_graph_uri)
            .header(ACCEPT, "application/ld+json")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(
        empty_graph_head.headers().get(ETAG),
        Some(&empty_graph_etag)
    );
    assert!(read_to_string(empty_graph_head.body_mut())?.is_empty());
    server.status(
        Request::builder()
            .method(Method::POST)
            .uri(empty_graph_uri)
            .header(CONTENT_TYPE, "text/turtle")
            .header(IF_MATCH, empty_graph_etag)
            .body("# still an empty RDF graph\n")?,
        StatusCode::NO_CONTENT,
    )?;

    server.status(
        Request::builder()
            .uri("http://localhost/store")
            .header(ACCEPT, "application/n-quads")
            .body(())?,
        StatusCode::NOT_ACCEPTABLE,
    )?;
    Ok(())
}

#[test]
fn selectorless_post_distinguishes_zero_length_from_empty_rdf_graphs() -> Result<()> {
    let server = TestServer::new()?;
    for suffix in ["", "?no_transaction"] {
        let response = server.status(
            Request::builder()
                .method(Method::POST)
                .uri(format!("http://localhost/store{suffix}"))
                .header(CONTENT_TYPE, "text/turtle")
                .body(())?,
            StatusCode::NO_CONTENT,
        )?;
        assert!(response.headers().get(LOCATION).is_none());
    }
    assert_eq!(
        server
            .store
            .named_graphs()
            .collect::<Result<Vec<_>, _>>()?
            .len(),
        0
    );

    for (suffix, content_type, body) in [
        ("", "text/turtle", "# a valid empty RDF graph\n"),
        ("?no_transaction", "application/ld+json", "[]"),
    ] {
        let mut response = server.status(
            Request::builder()
                .method(Method::POST)
                .uri(format!("http://localhost/store{suffix}"))
                .header(CONTENT_TYPE, content_type)
                .body(body)?,
            StatusCode::CREATED,
        )?;
        let location = response
            .headers()
            .get(LOCATION)
            .ok_or_else(|| anyhow!("empty RDF graph POST response has no Location"))?
            .to_str()?
            .to_owned();
        let graph = NamedNode::new(location.clone())?;
        assert!(server.store.contains_named_graph(&graph.into())?);
        assert!(read_to_string(response.body_mut())?.is_empty());
        server.status(
            Request::builder()
                .uri(location)
                .header(ACCEPT, "application/ld+json")
                .body(())?,
            StatusCode::OK,
        )?;
    }
    assert_eq!(server.store.len()?, 0);
    assert_eq!(
        server
            .store
            .named_graphs()
            .collect::<Result<Vec<_>, _>>()?
            .len(),
        2
    );

    server.status(
        Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store?default")
            .header(CONTENT_TYPE, "text/turtle")
            .body(())?,
        StatusCode::NO_CONTENT,
    )?;
    Ok(())
}

#[test]
fn graph_store_selectors_media_types_and_route_boundaries_are_strict() -> Result<()> {
    let server = TestServer::new()?;
    let method_error = server.status(
        Request::builder()
            .method(Method::PATCH)
            .uri("http://localhost/store?graph=&default")
            .body(())?,
        StatusCode::METHOD_NOT_ALLOWED,
    )?;
    assert_eq!(
        method_error
            .headers()
            .get(ALLOW)
            .and_then(|value| value.to_str().ok()),
        Some("GET, HEAD, PUT, POST, DELETE")
    );
    for uri in [
        "http://localhost/store?graph=",
        "http://localhost/store?graph=relative",
        "http://localhost/store?default=value",
        "http://localhost/store?unknown=value",
        "http://localhost/store/direct?default",
    ] {
        server.status(
            Request::builder().uri(uri).body(())?,
            StatusCode::BAD_REQUEST,
        )?;
    }
    server.status(
        Request::builder()
            .uri("http://localhost/storefront")
            .body(())?,
        StatusCode::NOT_FOUND,
    )?;
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "application/octet-stream")
            .body("not RDF")?,
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
    )?;
    server.status(
        Request::builder()
            .method(Method::PUT)
            .uri(GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .body(OLD)?,
        StatusCode::CREATED,
    )?;
    let graph_default = server.status(Request::builder().uri(GRAPH).body(())?, StatusCode::OK)?;
    assert_eq!(
        graph_default
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some(rdf_response_media_type(RdfResponseFormat::rdf11(
            RdfFormat::NTriples
        )))
    );
    server.status(
        Request::builder()
            .uri(GRAPH)
            .header(ACCEPT, "application/octet-stream")
            .body(())?,
        StatusCode::NOT_ACCEPTABLE,
    )?;

    let mut created = server.status(
        Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store")
            .header(CONTENT_TYPE, "text/turtle")
            .body(OLD)?,
        StatusCode::CREATED,
    )?;
    let location = created
        .headers()
        .get(LOCATION)
        .ok_or_else(|| anyhow!("201 response has no Location"))?
        .to_str()?
        .to_owned();
    assert_ne!(location, "http://localhost/store");
    assert!(read_to_string(created.body_mut())?.is_empty());
    server.status(Request::builder().uri(location).body(())?, StatusCode::OK)?;
    server.status(
        Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store")
            .header(CONTENT_TYPE, "application/octet-stream")
            .body(())?,
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
    )?;
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn service_description_discovers_only_the_endpoint_capabilities() -> Result<()> {
    let server = TestServer::new()?;
    let mut query = server.status(
        Request::builder()
            .uri("http://localhost/query")
            .header(ACCEPT, "application/n-triples")
            .body(())?,
        StatusCode::OK,
    )?;
    let query = read_to_string(query.body_mut())?;
    assert!(query.contains("<http://localhost/query>"));
    assert!(query.contains("SPARQLQuery"));
    assert!(query.contains("version-1.2-basic"));
    assert!(query.contains("version-1.2"));
    assert!(!query.contains("SPARQLUpdate"));

    let mut combined = server.status(
        Request::builder()
            .uri("http://localhost/sparql")
            .header(ACCEPT, "application/n-triples")
            .body(())?,
        StatusCode::OK,
    )?;
    let combined = read_to_string(combined.body_mut())?;
    assert!(combined.contains("SPARQLQuery"));
    assert!(combined.contains("SPARQLUpdate"));
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn graph_store_negotiates_rdf12_and_rejects_rdf12_terms_in_rdf11() -> Result<()> {
    let server = TestServer::new()?;
    let embedded = Triple::new(
        NamedNode::new_unchecked("urn:embedded:s"),
        NamedNode::new_unchecked("urn:embedded:p"),
        NamedNode::new_unchecked("urn:embedded:o"),
    );
    server.store.insert(Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        embedded,
        GraphName::DefaultGraph,
    ))?;

    for accept in [
        "application/n-triples",
        "application/n-triples; version=1.1",
    ] {
        server.status(
            Request::builder()
                .uri("http://localhost/store?default")
                .header(ACCEPT, accept)
                .body(())?,
            StatusCode::NOT_ACCEPTABLE,
        )?;
    }

    let mut ntriples = server.status(
        Request::builder()
            .uri("http://localhost/store?default")
            .header(ACCEPT, "application/n-triples; version=1.2")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(
        ntriples
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|h| h.to_str().ok()),
        Some("application/n-triples; version=1.2")
    );
    assert!(read_to_string(ntriples.body_mut())?.contains("<<( <urn:embedded:s>"));

    let mut turtle = server.status(
        Request::builder()
            .uri("http://localhost/store?default")
            .header(ACCEPT, "text/turtle; version=1.2")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(
        turtle
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|h| h.to_str().ok()),
        Some("text/turtle; version=1.2")
    );
    assert!(read_to_string(turtle.body_mut())?.starts_with("VERSION \"1.2\"\n"));
    Ok(())
}
