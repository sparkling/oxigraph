use super::{
    HttpError, bad_request, base_url, internal_server_error, limited_body, loader_to_http_error,
    method_not_allowed_response, multipart, resolve_with_base, the_server_is_read_only,
    unsupported_media_type, url_has_query_parameter,
};
use crate::http_validators::Decision;
use oxhttp::model::header::{CACHE_CONTROL, CONTENT_TYPE, ETAG, LOCATION, VARY};
use oxhttp::model::{Body, Method, Request, Response, StatusCode};
use oxigraph::io::{RdfFormat, RdfParser};
use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::store::{Store, Transaction};
use rand::random;

mod legacy;
mod representation;
mod selector;
mod state;
mod validators;
use validators::{
    conditions, etag_opaque, quoted_etag, require_mutation_preconditions, state_digest,
};

#[derive(Clone, Debug, Eq, PartialEq)]
enum Target {
    Dataset,
    DefaultGraph,
    NamedGraph(NamedNode),
}

struct State {
    exists: bool,
    quads: Vec<Quad>,
    named_graphs: Vec<NamedOrBlankNode>,
}

pub fn is_route(path: &str) -> bool {
    path == "/store" || path.starts_with("/store/")
}

pub fn handle(
    request: &mut Request<Body>,
    store: &Store,
    read_only: bool,
) -> Result<Response<Body>, HttpError> {
    if !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::PUT | Method::POST | Method::DELETE
    ) {
        return method_not_allowed_response(request, "GET, HEAD, PUT, POST, DELETE");
    }
    let target = target(request)?;
    match *request.method() {
        Method::GET | Method::HEAD => get(request, store, &target, read_only),
        Method::PUT => {
            if read_only {
                Err(the_server_is_read_only())
            } else {
                put(request, store, &target)
            }
        }
        Method::POST => {
            if read_only {
                Err(the_server_is_read_only())
            } else {
                post(request, store, &target)
            }
        }
        Method::DELETE => {
            if read_only {
                Err(the_server_is_read_only())
            } else {
                delete(request, store, &target)
            }
        }
        _ => method_not_allowed_response(request, "GET, HEAD, PUT, POST, DELETE"),
    }
}

fn target(request: &Request<Body>) -> Result<Target, HttpError> {
    let direct = request.uri().path() != "/store";
    let mut graph = None;
    let mut has_default = false;
    for (key, value) in selector::parameters(request)? {
        match key.as_str() {
            "graph" => {
                if graph.is_some() || has_default {
                    return Err(bad_request(
                        "A Graph Store request must contain exactly one graph selector",
                    ));
                }
                if value.is_empty() {
                    return Err(bad_request("The graph selector must contain a graph IRI"));
                }
                graph = Some(value);
            }
            "default" => {
                if has_default || graph.is_some() {
                    return Err(bad_request(
                        "A Graph Store request must contain exactly one graph selector",
                    ));
                }
                if !value.is_empty() {
                    return Err(bad_request("The default selector must not have a value"));
                }
                has_default = true;
            }
            "lenient" | "no_transaction" if value.is_empty() => {}
            _ => {
                return Err(bad_request(format!(
                    "Unknown Graph Store parameter '{key}'"
                )));
            }
        }
    }
    if direct {
        if graph.is_some() || has_default {
            return Err(bad_request(
                "An indirect graph selector cannot be combined with a direct graph IRI",
            ));
        }
        Ok(Target::NamedGraph(resolve_with_base(request, "")?))
    } else if let Some(graph) = graph {
        Ok(Target::NamedGraph(NamedNode::new(graph).map_err(|_| {
            bad_request("The graph selector must be an absolute IRI")
        })?))
    } else if has_default {
        Ok(Target::DefaultGraph)
    } else {
        // Oxigraph extension for GET/HEAD/PUT/DELETE; selector-less POST is GSP.
        Ok(Target::Dataset)
    }
}

fn get(
    request: &Request<Body>,
    store: &Store,
    target: &Target,
    read_only: bool,
) -> Result<Response<Body>, HttpError> {
    let state = if read_only {
        state::from_read_only_store(store, target)?
    } else {
        let transaction = store.start_transaction().map_err(internal_server_error)?;
        state::from_transaction(&transaction, target)?
    };
    if !state.exists {
        return Err(not_found(target));
    }
    let format = representation::format(request, target)?;
    let digest = state_digest(&state, target);
    let opaque = etag_opaque(format, &digest);
    match conditions(request, &state, target, Some(&opaque))? {
        Decision::PreconditionFailed => return Err(precondition_failed()),
        Decision::NotModified => {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(ETAG, quoted_etag(&opaque))
                .header(VARY, "Accept")
                .header(CACHE_CONTROL, "no-cache")
                .body(Body::empty())
                .map_err(internal_server_error);
        }
        Decision::Proceed => {}
    }
    representation::response(&state, target, format, quoted_etag(&opaque))
}

fn put(
    request: &mut Request<Body>,
    store: &Store,
    target: &Target,
) -> Result<Response<Body>, HttpError> {
    let format = input_format(request)?;
    if url_has_query_parameter(request, "no_transaction") {
        let transaction = store.start_transaction().map_err(internal_server_error)?;
        let current = state::from_transaction(&transaction, target)?;
        require_mutation_preconditions(request, &current, target)?;
        let created = !current.exists;
        drop(transaction);
        return legacy::put(request, store, target, format, created);
    }
    let body = limited_body(request)?;
    let mut transaction = store.start_transaction().map_err(internal_server_error)?;
    let current = state::from_transaction(&transaction, target)?;
    require_mutation_preconditions(request, &current, target)?;
    let created = !current.exists;
    replace(&mut transaction, request, target, format, &body)?;
    transaction.commit().map_err(internal_server_error)?;
    Response::builder()
        .status(if created {
            StatusCode::CREATED
        } else {
            StatusCode::NO_CONTENT
        })
        .body(Body::empty())
        .map_err(internal_server_error)
}

fn post(
    request: &mut Request<Body>,
    store: &Store,
    target: &Target,
) -> Result<Response<Body>, HttpError> {
    let raw_content_type = raw_content_type(request)?;
    let boundary = raw_content_type
        .as_deref()
        .map(multipart::boundary_from_content_type)
        .transpose()
        .map_err(bad_request)?
        .flatten();
    let format = if boundary.is_none() {
        Some(
            raw_content_type
                .as_deref()
                .map_or(Some(RdfFormat::RdfXml), RdfFormat::from_media_type)
                .ok_or_else(|| {
                    unsupported_media_type(raw_content_type.as_deref().unwrap_or_default())
                })?,
        )
    } else {
        None
    };
    if url_has_query_parameter(request, "no_transaction") && boundary.is_none() {
        let transaction = store.start_transaction().map_err(internal_server_error)?;
        let current = state::from_transaction(&transaction, target)?;
        require_mutation_preconditions(request, &current, target)?;
        if matches!(target, Target::NamedGraph(_)) && !current.exists {
            return Err(not_found(target));
        }
        drop(transaction);
        return legacy::post(
            request,
            store,
            target,
            format.ok_or_else(|| internal_server_error("missing RDF format"))?,
        );
    }
    let body = limited_body(request)?;
    let mut transaction = store.start_transaction().map_err(internal_server_error)?;
    let current = state::from_transaction(&transaction, target)?;
    require_mutation_preconditions(request, &current, target)?;
    if matches!(target, Target::NamedGraph(_)) && !current.exists {
        return Err(not_found(target));
    }
    if body.is_empty() && boundary.is_none() {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .map_err(internal_server_error);
    }
    if matches!(target, Target::Dataset)
        && format.is_some_and(|format| {
            format.supports_datasets() && !matches!(format, RdfFormat::JsonLd { .. })
        })
    {
        return Err(bad_request(
            "POST to the Graph Store IRI requires an RDF graph payload",
        ));
    }

    let creates_graph = matches!(target, Target::Dataset);
    let (target, location, created) = match target {
        Target::Dataset => {
            let graph = allocate_graph(&transaction, request)?;
            (
                Target::NamedGraph(graph.clone()),
                Some(graph.as_str().to_owned()),
                true,
            )
        }
        Target::NamedGraph(graph) => (Target::NamedGraph(graph.clone()), None, false),
        Target::DefaultGraph => (Target::DefaultGraph, None, false),
    };
    if let Target::NamedGraph(graph) = &target
        && created
    {
        transaction.insert_named_graph(graph.clone());
    }
    if let Some(boundary) = boundary {
        load_multipart(
            &mut transaction,
            request,
            &target,
            &body,
            &boundary,
            creates_graph,
        )?;
    } else {
        load_graph(
            &mut transaction,
            request,
            &target,
            format.ok_or_else(|| internal_server_error("missing RDF format"))?,
            &body,
        )?;
    }
    transaction.commit().map_err(internal_server_error)?;
    let mut response = Response::builder().status(if created {
        StatusCode::CREATED
    } else {
        StatusCode::NO_CONTENT
    });
    if let Some(location) = location {
        response = response.header(LOCATION, location);
    }
    response.body(Body::empty()).map_err(internal_server_error)
}

fn delete(
    request: &Request<Body>,
    store: &Store,
    target: &Target,
) -> Result<Response<Body>, HttpError> {
    let mut transaction = store.start_transaction().map_err(internal_server_error)?;
    let current = state::from_transaction(&transaction, target)?;
    if !current.exists {
        return Err(not_found(target));
    }
    require_mutation_preconditions(request, &current, target)?;
    match target {
        Target::Dataset => transaction.clear().map_err(internal_server_error)?,
        Target::DefaultGraph => transaction
            .clear_graph(&GraphName::DefaultGraph)
            .map_err(internal_server_error)?,
        Target::NamedGraph(graph) => transaction
            .remove_named_graph(&graph.clone().into())
            .map_err(internal_server_error)?,
    }
    transaction.commit().map_err(internal_server_error)?;
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .map_err(internal_server_error)
}

fn replace(
    transaction: &mut Transaction<'_>,
    request: &Request<Body>,
    target: &Target,
    format: RdfFormat,
    body: &[u8],
) -> Result<(), HttpError> {
    match target {
        Target::Dataset => {
            transaction.clear().map_err(internal_server_error)?;
            let mut parser = RdfParser::from_format(format);
            if url_has_query_parameter(request, "lenient") {
                parser = parser.lenient();
            }
            transaction
                .load_from_slice(parser, body)
                .map_err(loader_to_http_error)
        }
        Target::DefaultGraph => {
            transaction
                .clear_graph(&GraphName::DefaultGraph)
                .map_err(internal_server_error)?;
            load_graph(transaction, request, target, format, body)
        }
        Target::NamedGraph(graph) => {
            transaction
                .clear_graph(&graph.clone().into())
                .map_err(internal_server_error)?;
            transaction.insert_named_graph(graph.clone());
            load_graph(transaction, request, target, format, body)
        }
    }
}

fn load_graph(
    transaction: &mut Transaction<'_>,
    request: &Request<Body>,
    target: &Target,
    format: RdfFormat,
    body: &[u8],
) -> Result<(), HttpError> {
    let graph_name = match target {
        Target::DefaultGraph => GraphName::DefaultGraph,
        Target::NamedGraph(graph) => graph.clone().into(),
        Target::Dataset => return Err(internal_server_error("A graph payload needs a graph")),
    };
    let mut parser = RdfParser::from_format(format)
        .without_named_graphs()
        .with_default_graph(graph_name);
    if url_has_query_parameter(request, "lenient") {
        parser = parser.lenient();
    }
    let base = match target {
        Target::NamedGraph(graph) => graph.as_str().to_owned(),
        Target::DefaultGraph | Target::Dataset => base_url(request),
    };
    parser = parser.with_base_iri(&base).map_err(bad_request)?;
    transaction
        .load_from_slice(parser, body)
        .map_err(loader_to_http_error)
}

fn load_multipart(
    transaction: &mut Transaction<'_>,
    request: &Request<Body>,
    target: &Target,
    body: &[u8],
    boundary: &str,
    graph_formats_only: bool,
) -> Result<(), HttpError> {
    for part in multipart::parse_multipart(body, boundary).map_err(bad_request)? {
        let format = RdfFormat::from_media_type(&part.content_type)
            .ok_or_else(|| unsupported_media_type(&part.content_type))?;
        if graph_formats_only
            && format.supports_datasets()
            && !matches!(format, RdfFormat::JsonLd { .. })
        {
            return Err(bad_request(
                "POST to the Graph Store IRI requires RDF graph parts",
            ));
        }
        load_graph(transaction, request, target, format, part.body)?;
    }
    Ok(())
}

fn input_format(request: &Request<Body>) -> Result<RdfFormat, HttpError> {
    let content_type = raw_content_type(request)?;
    content_type
        .as_deref()
        .map_or(Some(RdfFormat::RdfXml), RdfFormat::from_media_type)
        .ok_or_else(|| unsupported_media_type(content_type.as_deref().unwrap_or_default()))
}

fn raw_content_type(request: &Request<Body>) -> Result<Option<String>, HttpError> {
    request
        .headers()
        .get(CONTENT_TYPE)
        .map(|value| {
            value
                .to_str()
                .map(str::to_owned)
                .map_err(|_| bad_request("The Content-Type header must contain visible ASCII"))
        })
        .transpose()
}

fn allocate_graph(
    transaction: &Transaction<'_>,
    request: &Request<Body>,
) -> Result<NamedNode, HttpError> {
    for _ in 0..8 {
        let graph = resolve_with_base(request, &format!("/store/{:x}", random::<u128>()))?;
        if !transaction
            .contains_named_graph(&graph.clone().into())
            .map_err(internal_server_error)?
        {
            return Ok(graph);
        }
    }
    Err(internal_server_error(
        "Unable to allocate a unique Graph Store IRI",
    ))
}

fn not_found(target: &Target) -> HttpError {
    (
        StatusCode::NOT_FOUND,
        format!("The Graph Store resource {target:?} does not exist"),
    )
}

fn precondition_failed() -> HttpError {
    (
        StatusCode::PRECONDITION_FAILED,
        "A Graph Store request precondition did not match the current resource".into(),
    )
}
