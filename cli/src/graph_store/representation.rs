use super::{State, Target};
use crate::rdf_response::RdfResponseFormat;
use crate::{HttpError, internal_server_error, rdf_content_negotiation, rdf_response_media_type};
use oxhttp::model::header::{ACCEPT, CONTENT_TYPE};
use oxhttp::model::{Body, HeaderValue, Request, Response, StatusCode};
use oxigraph::io::RdfFormat;
use oxigraph::model::{GraphName, NamedOrBlankNode, Triple};
use std::collections::HashSet;

pub(super) fn response(
    state: &State,
    target: &Target,
    selected: RdfResponseFormat,
    etag: String,
    request: &Request<Body>,
) -> Result<Response<Body>, HttpError> {
    let body = serialize(state, target, selected, request)?;
    Response::builder()
        .header(CONTENT_TYPE, rdf_response_media_type(selected))
        .header(oxhttp::model::header::CONTENT_LENGTH, body.len())
        .header(oxhttp::model::header::ETAG, etag)
        .header(oxhttp::model::header::VARY, "Accept")
        .header(oxhttp::model::header::CACHE_CONTROL, "no-cache")
        .body(body.into())
        .map_err(internal_server_error)
}

pub(super) fn format(
    request: &Request<Body>,
    target: &Target,
) -> Result<RdfResponseFormat, HttpError> {
    let selected = if !matches!(target, Target::Dataset)
        && request
            .headers()
            .get(ACCEPT)
            .is_none_or(HeaderValue::is_empty)
    {
        RdfResponseFormat::rdf11(RdfFormat::NTriples)
    } else {
        rdf_content_negotiation(request)?
    };
    if matches!(target, Target::Dataset) && !selected.format().supports_datasets() {
        return Err((
            StatusCode::NOT_ACCEPTABLE,
            "The requested RDF representation is not available for this Graph Store resource"
                .into(),
        ));
    }
    Ok(selected)
}

fn serialize(
    state: &State,
    target: &Target,
    selected: RdfResponseFormat,
    request: &Request<Body>,
) -> Result<Vec<u8>, HttpError> {
    let mut serializer = selected
        .serializer()
        .map_err(internal_server_error)?
        .for_writer(Vec::new());
    let mut non_empty_named_graphs = HashSet::new();
    for quad in &state.quads {
        crate::check_request(request)?;
        if matches!(target, Target::Dataset) {
            selected.ensure_quad(quad).map_err(not_acceptable)?;
            match &quad.graph_name {
                GraphName::NamedNode(graph_name) => {
                    non_empty_named_graphs.insert(NamedOrBlankNode::NamedNode(graph_name.clone()));
                }
                GraphName::BlankNode(graph_name) => {
                    non_empty_named_graphs.insert(NamedOrBlankNode::BlankNode(graph_name.clone()));
                }
                GraphName::DefaultGraph => {}
            }
            serializer
                .serialize_quad(quad)
                .map_err(internal_server_error)?;
        } else {
            let triple = Triple::new(
                quad.subject.clone(),
                quad.predicate.clone(),
                quad.object.clone(),
            );
            selected.ensure_triple(&triple).map_err(not_acceptable)?;
            serializer
                .serialize_triple(&triple)
                .map_err(internal_server_error)?;
        }
    }
    if matches!(target, Target::Dataset) {
        for graph_name in &state.named_graphs {
            crate::check_request(request)?;
            if !non_empty_named_graphs.contains(graph_name) {
                serializer
                    .serialize_empty_graph(graph_name)
                    .map_err(not_acceptable)?;
            }
        }
    }
    crate::check_request(request)?;
    serializer.finish().map_err(internal_server_error)
}

fn not_acceptable(error: impl std::fmt::Display) -> HttpError {
    (
        StatusCode::NOT_ACCEPTABLE,
        format!("The requested RDF version cannot represent this resource: {error}"),
    )
}
