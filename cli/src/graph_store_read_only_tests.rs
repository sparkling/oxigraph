#![expect(
    clippy::panic_in_result_fn,
    reason = "test assertions report protocol mismatches while Result propagates setup failures"
)]

use super::*;
use anyhow::{Result, anyhow};
use assert_fs::TempDir;
use oxhttp::model::header::{ETAG, IF_NONE_MATCH};
use oxigraph::model::Quad;
use std::collections::HashSet;
use std::io::read_to_string;

const POPULATED_GRAPH: &str = "http://localhost/store/read-only-populated";
const EMPTY_GRAPH: &str = "http://localhost/store/read-only-empty";
const MISSING_GRAPH: &str = "http://localhost/store/read-only-missing";

struct ReadOnlyTestServer {
    store: Store,
}

impl ReadOnlyTestServer {
    fn open(store_dir: &TempDir) -> Result<Self> {
        Ok(Self {
            store: Store::open_read_only(store_dir.path())?,
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
                true,
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
}

#[test]
fn graph_store_read_only_disk_backed_get_head_preserve_state() -> Result<()> {
    let store_dir = TempDir::new()?;
    let populated_graph = NamedNode::new(POPULATED_GRAPH)?;
    let empty_graph = NamedNode::new(EMPTY_GRAPH)?;
    let quad = Quad::new(
        NamedNode::new("http://example.com/subject")?,
        NamedNode::new("http://example.com/predicate")?,
        NamedNode::new("http://example.com/object")?,
        populated_graph.clone(),
    );
    {
        let writer = Store::open(store_dir.path())?;
        writer.insert(quad.clone())?;
        writer.insert_named_graph(empty_graph.clone())?;
        writer.flush()?;
    }
    let server = ReadOnlyTestServer::open(&store_dir)?;

    let mut get = server.status(
        Request::builder()
            .uri(POPULATED_GRAPH)
            .header(ACCEPT, "application/n-triples")
            .body(())?,
        StatusCode::OK,
    )?;
    let etag = get
        .headers()
        .get(ETAG)
        .cloned()
        .ok_or_else(|| anyhow!("read-only GET response has no ETag"))?;
    let body = read_to_string(get.body_mut())?;
    assert_eq!(
        RdfParser::from_format(RdfFormat::NTriples)
            .for_slice(body.as_bytes())
            .collect::<Result<Vec<_>, _>>()?,
        vec![Quad::new(
            quad.subject.clone(),
            quad.predicate.clone(),
            quad.object.clone(),
            GraphName::DefaultGraph,
        )]
    );

    let mut head = server.status(
        Request::builder()
            .method(Method::HEAD)
            .uri(POPULATED_GRAPH)
            .header(ACCEPT, "application/n-triples")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(head.headers().get(ETAG), Some(&etag));
    assert!(read_to_string(head.body_mut())?.is_empty());

    let mut not_modified = server.status(
        Request::builder()
            .uri(POPULATED_GRAPH)
            .header(ACCEPT, "application/n-triples")
            .header(IF_NONE_MATCH, etag.clone())
            .body(())?,
        StatusCode::NOT_MODIFIED,
    )?;
    assert_eq!(not_modified.headers().get(ETAG), Some(&etag));
    assert!(read_to_string(not_modified.body_mut())?.is_empty());

    let mut head_not_modified = server.status(
        Request::builder()
            .method(Method::HEAD)
            .uri(POPULATED_GRAPH)
            .header(ACCEPT, "application/n-triples")
            .header(IF_NONE_MATCH, etag)
            .body(())?,
        StatusCode::NOT_MODIFIED,
    )?;
    assert_eq!(
        head_not_modified.headers().get(ETAG),
        head.headers().get(ETAG)
    );
    assert!(read_to_string(head_not_modified.body_mut())?.is_empty());

    server.status(
        Request::builder()
            .uri(EMPTY_GRAPH)
            .header(ACCEPT, "text/turtle")
            .body(())?,
        StatusCode::OK,
    )?;
    server.status(
        Request::builder().uri(MISSING_GRAPH).body(())?,
        StatusCode::NOT_FOUND,
    )?;

    let mut dataset_response = server.status(
        Request::builder()
            .uri("http://localhost/store")
            .header(ACCEPT, "application/trig")
            .body(())?,
        StatusCode::OK,
    )?;
    let dataset_etag = dataset_response
        .headers()
        .get(ETAG)
        .cloned()
        .ok_or_else(|| anyhow!("read-only dataset GET response has no ETag"))?;
    let dataset_body = read_to_string(dataset_response.body_mut())?;
    let dataset = RdfParser::from_format(RdfFormat::TriG)
        .for_slice(dataset_body.as_bytes())
        .collect_dataset()?;
    assert!(dataset.contains(&quad));
    assert!(dataset.contains_named_graph(&populated_graph));
    assert!(dataset.contains_named_graph(&empty_graph));
    let mut dataset_head = server.status(
        Request::builder()
            .method(Method::HEAD)
            .uri("http://localhost/store")
            .header(ACCEPT, "application/trig")
            .body(())?,
        StatusCode::OK,
    )?;
    assert_eq!(dataset_head.headers().get(ETAG), Some(&dataset_etag));
    assert!(read_to_string(dataset_head.body_mut())?.is_empty());

    for request in [
        Request::builder()
            .method(Method::PUT)
            .uri(POPULATED_GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .body("<http://example.com/new> <http://example.com/p> <http://example.com/o> .")?,
        Request::builder()
            .method(Method::POST)
            .uri(POPULATED_GRAPH)
            .header(CONTENT_TYPE, "text/turtle")
            .body("<http://example.com/new> <http://example.com/p> <http://example.com/o> .")?,
        Request::builder()
            .method(Method::DELETE)
            .uri(POPULATED_GRAPH)
            .body("")?,
        Request::builder()
            .method(Method::POST)
            .uri("http://localhost/update")
            .header(CONTENT_TYPE, "application/sparql-update")
            .body("CLEAR ALL")?,
    ] {
        server.status(request, StatusCode::FORBIDDEN)?;
    }

    drop(server);
    let verified = Store::open_read_only(store_dir.path())?;
    assert_eq!(verified.iter().collect::<Result<Vec<_>, _>>()?, vec![quad]);
    assert_eq!(
        verified.named_graphs().collect::<Result<HashSet<_>, _>>()?,
        HashSet::from([populated_graph.into(), empty_graph.into()])
    );
    Ok(())
}
