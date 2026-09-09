use super::{AccessError, GraphTarget};
use oxhttp::model::header::{ACCESS_CONTROL_REQUEST_METHOD, CONTENT_TYPE};
use oxhttp::model::{HeaderMap, Method, Uri};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Endpoint {
    Ui,
    Query,
    Update,
    Sparql,
    GraphStore,
    Health,
    Ready,
    Metrics,
    AccessPolicy,
    Audit,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum OperationKind {
    Discovery,
    Query,
    Update,
    GraphRead,
    GraphWrite,
    Health,
    Operator,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ListenerKind {
    Data,
    Operator,
}

/// Whole-operation authorization, never SPARQL algebra or row filtering.
#[derive(Clone, Debug)]
pub struct RequestOperation {
    pub endpoint: Endpoint,
    pub method: Method,
    pub preflight_method: Option<Method>,
    pub required: Vec<OperationKind>,
    pub graph: Option<GraphTarget>,
}

impl RequestOperation {
    pub fn classify(
        uri: &Uri,
        method: &Method,
        headers: &HeaderMap,
        listener: ListenerKind,
    ) -> Result<Self, AccessError> {
        let mut operation = Self {
            endpoint: Endpoint::Unknown,
            method: method.clone(),
            preflight_method: None,
            required: vec![OperationKind::Unknown],
            graph: None,
        };
        let effective_method = if *method == Method::OPTIONS {
            let value = super::unique_header(headers, ACCESS_CONTROL_REQUEST_METHOD.as_str())?
                .ok_or(AccessError::Denied)?;
            let method = Method::from_bytes(value.as_bytes()).map_err(|_| AccessError::Denied)?;
            if method == Method::OPTIONS {
                return Err(AccessError::Denied);
            }
            operation.preflight_method = Some(method.clone());
            method
        } else {
            method.clone()
        };
        if listener == ListenerKind::Operator {
            (operation.endpoint, operation.required) = match (uri.path(), effective_method.as_str())
            {
                ("/health", "GET" | "HEAD") => (Endpoint::Health, vec![OperationKind::Health]),
                ("/ready", "GET" | "HEAD") => (Endpoint::Ready, vec![OperationKind::Operator]),
                ("/metrics", "GET" | "HEAD") => (Endpoint::Metrics, vec![OperationKind::Operator]),
                ("/access/policy/reload", "POST") => {
                    (Endpoint::AccessPolicy, vec![OperationKind::Operator])
                }
                ("/access/audit", "GET" | "HEAD") => {
                    (Endpoint::Audit, vec![OperationKind::Operator])
                }
                _ => (Endpoint::Unknown, vec![OperationKind::Unknown]),
            };
            if uri.query().is_some() {
                return Err(AccessError::Denied);
            }
            return Ok(operation);
        }
        let (endpoint, required) = match (uri.path(), effective_method.as_str()) {
            ("/" | "/yasgui.min.css" | "/yasgui.min.js" | "/logo.svg", "GET" | "HEAD") => {
                (Endpoint::Ui, vec![OperationKind::Discovery])
            }
            ("/query" | "/sparql", "GET") => (
                if uri.path() == "/query" {
                    Endpoint::Query
                } else {
                    Endpoint::Sparql
                },
                vec![if uri.query().is_some() {
                    OperationKind::Query
                } else {
                    OperationKind::Discovery
                }],
            ),
            ("/update", "GET") => (Endpoint::Update, vec![OperationKind::Discovery]),
            ("/query", "POST" | "QUERY") => (Endpoint::Query, vec![OperationKind::Query]),
            ("/update", "POST") => (Endpoint::Update, vec![OperationKind::Update]),
            ("/sparql", "QUERY") => (Endpoint::Sparql, vec![OperationKind::Query]),
            ("/sparql", "POST") => {
                if operation.preflight_method.is_some() {
                    operation.endpoint = Endpoint::Sparql;
                    operation.required = vec![OperationKind::Query, OperationKind::Update];
                    return Ok(operation);
                }
                let content = super::unique_header(headers, CONTENT_TYPE.as_str())?
                    .ok_or(AccessError::Denied)?;
                let media = content.split(';').next().unwrap_or_default().trim();
                let required = if media.eq_ignore_ascii_case("application/sparql-query") {
                    vec![OperationKind::Query]
                } else if media.eq_ignore_ascii_case("application/sparql-update") {
                    vec![OperationKind::Update]
                } else if media.eq_ignore_ascii_case("application/x-www-form-urlencoded") {
                    vec![OperationKind::Query, OperationKind::Update]
                } else {
                    return Err(AccessError::Denied);
                };
                (Endpoint::Sparql, required)
            }
            (path, "GET" | "HEAD" | "PUT" | "POST" | "DELETE")
                if path == "/store" || path.starts_with("/store/") =>
            {
                operation.graph =
                    Some(GraphTarget::from_uri(uri).map_err(|_| AccessError::Denied)?);
                (
                    Endpoint::GraphStore,
                    vec![if matches!(effective_method.as_str(), "GET" | "HEAD") {
                        OperationKind::GraphRead
                    } else {
                        OperationKind::GraphWrite
                    }],
                )
            }
            _ => (Endpoint::Unknown, vec![OperationKind::Unknown]),
        };
        operation.endpoint = endpoint;
        operation.required = required;
        Ok(operation)
    }

    pub fn is_write(&self) -> bool {
        self.required
            .iter()
            .any(|kind| matches!(kind, OperationKind::Update | OperationKind::GraphWrite))
    }
}
