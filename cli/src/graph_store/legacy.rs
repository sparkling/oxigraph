use super::Target;
use crate::{
    HttpError, bad_request, internal_server_error, resolve_with_base, web_load_dataset,
    web_load_graph,
};
use oxhttp::model::header::LOCATION;
use oxhttp::model::{Body, Request, Response, StatusCode};
use oxigraph::io::RdfFormat;
use oxigraph::model::GraphName;
use oxigraph::store::Store;
use rand::random;

pub(super) fn put(
    request: &mut Request<Body>,
    store: &Store,
    target: &Target,
    format: RdfFormat,
    created: bool,
) -> Result<Response<Body>, HttpError> {
    match target {
        Target::Dataset => {
            store.clear().map_err(internal_server_error)?;
            web_load_dataset(store, request, format)?;
        }
        Target::DefaultGraph => {
            store
                .clear_graph(&GraphName::DefaultGraph)
                .map_err(internal_server_error)?;
            web_load_graph(store, request, format, &GraphName::DefaultGraph)?;
        }
        Target::NamedGraph(graph) => {
            if created {
                store
                    .insert_named_graph(graph.clone())
                    .map_err(internal_server_error)?;
            } else {
                store
                    .clear_graph(&graph.clone().into())
                    .map_err(internal_server_error)?;
            }
            web_load_graph(store, request, format, &graph.clone().into())?;
        }
    }
    Response::builder()
        .status(if created {
            StatusCode::CREATED
        } else {
            StatusCode::NO_CONTENT
        })
        .body(Body::empty())
        .map_err(internal_server_error)
}

pub(super) fn post(
    request: &mut Request<Body>,
    store: &Store,
    target: &Target,
    format: RdfFormat,
) -> Result<Response<Body>, HttpError> {
    if request.body().len() == Some(0) {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .map_err(internal_server_error);
    }
    if matches!(target, Target::Dataset)
        && format.supports_datasets()
        && !matches!(format, RdfFormat::JsonLd { .. })
    {
        return Err(bad_request(
            "POST to the Graph Store IRI requires an RDF graph payload",
        ));
    }
    match target {
        Target::Dataset => {
            let graph = resolve_with_base(request, &format!("/store/{:x}", random::<u128>()))?;
            store
                .insert_named_graph(graph.clone())
                .map_err(internal_server_error)?;
            if let Err(error) = web_load_graph(store, request, format, &graph.clone().into()) {
                store
                    .remove_named_graph(&graph.clone().into())
                    .map_err(internal_server_error)?;
                return Err(error);
            }
            Response::builder()
                .status(StatusCode::CREATED)
                .header(LOCATION, graph.as_str())
                .body(Body::empty())
                .map_err(internal_server_error)
        }
        Target::DefaultGraph => {
            web_load_graph(store, request, format, &GraphName::DefaultGraph)?;
            Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Body::empty())
                .map_err(internal_server_error)
        }
        Target::NamedGraph(graph) => {
            web_load_graph(store, request, format, &graph.clone().into())?;
            Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Body::empty())
                .map_err(internal_server_error)
        }
    }
}
