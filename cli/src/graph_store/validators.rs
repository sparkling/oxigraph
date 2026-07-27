use super::{State, Target};
use crate::http_validators::{Decision, EntityTag, evaluate};
use crate::rdf_response::RdfResponseFormat;
use crate::{HttpError, bad_request};
use oxhttp::model::{Body, Request};
use oxigraph::model::Triple;
use sha2::{Digest, Sha256};

const HEX: &[u8; 16] = b"0123456789abcdef";

pub(super) fn conditions(
    request: &Request<Body>,
    state: &State,
    target: &Target,
    selected: Option<&str>,
) -> Result<Decision, HttpError> {
    let digest = state_digest(state, target);
    evaluate(request, state.exists, |tag| {
        selected.map_or_else(
            || current_for_any_format(tag, target, &digest),
            |opaque| tag.opaque() == opaque,
        )
    })
    .map_err(bad_request)
}

pub(super) fn require_mutation_preconditions(
    request: &Request<Body>,
    state: &State,
    target: &Target,
) -> Result<(), HttpError> {
    match conditions(request, state, target, None)? {
        Decision::Proceed => Ok(()),
        Decision::NotModified | Decision::PreconditionFailed => Err((
            oxhttp::model::StatusCode::PRECONDITION_FAILED,
            "A Graph Store request precondition did not match the current resource".into(),
        )),
    }
}

pub(super) fn state_digest(state: &State, target: &Target) -> String {
    let mut hasher = Sha256::new();
    hasher.update(if state.exists { b"exists" } else { b"absent" });
    for quad in &state.quads {
        if matches!(target, Target::Dataset) {
            hasher.update(quad.to_string().as_bytes());
        } else {
            let triple = Triple::new(
                quad.subject.clone(),
                quad.predicate.clone(),
                quad.object.clone(),
            );
            hasher.update(triple.to_string().as_bytes());
        }
        hasher.update(b"\0");
    }
    if matches!(target, Target::Dataset) {
        for graph_name in &state.named_graphs {
            hasher.update(b"named-graph\0");
            hasher.update(graph_name.to_string().as_bytes());
            hasher.update(b"\0");
        }
    }
    let mut result = String::with_capacity(64);
    for byte in hasher.finalize() {
        result.push(char::from(HEX[usize::from(byte >> 4)]));
        result.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    result
}

pub(super) fn etag_opaque(selected: RdfResponseFormat, digest: &str) -> String {
    format!(
        "oxigraph-gsp-v2-{}-{}-{digest}",
        selected.format().file_extension(),
        selected.etag_profile()
    )
}

pub(super) fn quoted_etag(opaque: &str) -> String {
    format!("\"{opaque}\"")
}

fn current_for_any_format(tag: &EntityTag, target: &Target, digest: &str) -> bool {
    let Some(rest) = tag.opaque().strip_prefix("oxigraph-gsp-v2-") else {
        return false;
    };
    let mut parts = rest.splitn(3, '-');
    let (Some(code), Some(profile), Some(candidate_digest)) =
        (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let supported = match code {
        "nt" | "n3" | "rdf" | "ttl" => !matches!(target, Target::Dataset),
        "jsonld" | "nq" | "trig" => true,
        _ => false,
    };
    let supported_profile =
        profile == "11" || profile == "12" && matches!(code, "nt" | "nq" | "ttl" | "trig");
    supported && supported_profile && candidate_digest == digest
}
