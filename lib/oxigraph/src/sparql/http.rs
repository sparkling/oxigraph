use crate::http::{EgressError, EgressErrorKind, HttpClient, find_egress_error};
use crate::model::NamedNode;
use crate::sparql::federation::{
    HttpServiceFailure, HttpServiceInvocation, ObservedBody, ObservedSolutions,
};
use oxiri::Iri;
use oxstr::OxString;
use sparesults::{QueryResultsParser, ReaderQueryResultsParserOutput};
use spareval::{DefaultServiceHandler, QueryEvaluationError, QuerySolutionIter};
use spargebra::SparqlVersion;
use spargebra::algebra::QueryExpression;
use spargebra::query::SelectQuery;
use std::error::Error;
use std::sync::Arc;

pub struct HttpServiceHandler {
    client: HttpClient,
    version: SparqlVersion,
}

impl HttpServiceHandler {
    pub fn new(client: HttpClient, version: SparqlVersion) -> Self {
        Self { client, version }
    }
}

impl DefaultServiceHandler for HttpServiceHandler {
    type Error = QueryEvaluationError;

    fn handle(
        &self,
        service_name: &NamedNode,
        expression: &QueryExpression,
        base_iri: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let (content_type, accept) = match self.version {
            SparqlVersion::V1_1 => (
                "application/sparql-query",
                "application/sparql-results+json, application/sparql-results+xml",
            ),
            SparqlVersion::V1_2Basic => (
                "application/sparql-query; version=1.2-basic",
                "application/sparql-results+json; version=1.2-basic, application/sparql-results+xml; version=1.2-basic, application/sparql-results+json, application/sparql-results+xml",
            ),
            SparqlVersion::V1_2 => (
                "application/sparql-query; version=1.2",
                "application/sparql-results+json; version=1.2, application/sparql-results+xml; version=1.2, application/sparql-results+json, application/sparql-results+xml",
            ),
            _ => unreachable!("unsupported SPARQL version"),
        };
        // One handler entry is one logical attempt, counted before
        // authorization so that a denial before any dispatch is still reported.
        let client = self.client.for_operation();
        let invocation = client.service_invocation();
        let (content_type, body) = client
            .post(
                service_name.as_str(),
                SelectQuery {
                    dataset: None,
                    expression: expression.clone(),
                    base_iri: base_iri.cloned(),
                }
                .to_string()
                .into_bytes(),
                content_type,
                accept,
            )
            .map_err(|error| service_error(error, &client, invocation.as_ref()))?;
        let parser = QueryResultsParser::from_media_type(&content_type).map_err(|error| {
            record(invocation.as_ref(), HttpServiceFailure::ResultStream);
            QueryEvaluationError::Service(
                format!(
                    "Unsupported Content-Type returned by service {service_name}: \
                     {content_type}: {error}"
                )
                .into(),
            )
        })?;
        // The parser reads through the observing wrapper, so its read-ahead and
        // syntax bytes are counted exactly as delivered. The governed body
        // still owns the decoded limit and releases its admission permit.
        let ReaderQueryResultsParserOutput::Solutions(reader) = parser
            .for_reader(ObservedBody::new(body, invocation.clone()))
            .map_err(|error| service_error(error, &client, invocation.as_ref()))?
        else {
            record(invocation.as_ref(), HttpServiceFailure::ResultStream);
            return Err(QueryEvaluationError::Service(
                "No valid SPARQL solutions returned by {service_name}".into(),
            ));
        };
        let stream_invocation = invocation.clone();
        Ok(QuerySolutionIter::new(
            reader.variables().into(),
            Box::new(ObservedSolutions::new(
                reader.map(move |result| {
                    result.map_err(|error| {
                        service_error(error, &client, stream_invocation.as_ref())
                    })
                }),
                invocation,
            )),
        ))
    }
}

fn service_error(
    error: impl Error + Send + Sync + 'static,
    client: &HttpClient,
    invocation: Option<&Arc<HttpServiceInvocation>>,
) -> QueryEvaluationError {
    let (error, failure) = service_failure(error, client);
    record(invocation, failure);
    error
}

/// Maps one failure to its evaluation error and its fixed observed category.
fn service_failure(
    error: impl Error + Send + Sync + 'static,
    client: &HttpClient,
) -> (QueryEvaluationError, HttpServiceFailure) {
    // A request deadline is fatal even for SERVICE SILENT. A remote policy
    // timeout remains a service failure and retains its existing SILENT rules.
    if let Some(reason) = client.cancellation_reason() {
        return match reason {
            crate::sparql::CancellationReason::Cancelled => {
                (QueryEvaluationError::Cancelled, HttpServiceFailure::Cancelled)
            }
            crate::sparql::CancellationReason::TimedOut => {
                (QueryEvaluationError::TimedOut, HttpServiceFailure::TimedOut)
            }
        };
    }
    if let Some(kind) = find_egress_error(&error).map(EgressError::kind) {
        return if kind == EgressErrorKind::Cancelled {
            (QueryEvaluationError::Cancelled, HttpServiceFailure::Cancelled)
        } else {
            (
                QueryEvaluationError::Service(Box::new(error)),
                HttpServiceFailure::Egress(kind),
            )
        };
    }
    if let Some(error) = client.take_recorded_error() {
        let kind = error.kind();
        return if kind == EgressErrorKind::Cancelled {
            (QueryEvaluationError::Cancelled, HttpServiceFailure::Cancelled)
        } else {
            (
                QueryEvaluationError::Service(Box::new(error)),
                HttpServiceFailure::Egress(kind),
            )
        };
    }
    (
        QueryEvaluationError::Service(Box::new(error)),
        HttpServiceFailure::ResultStream,
    )
}

/// Records a failure once. Later outcomes, including drop, keep it.
fn record(invocation: Option<&Arc<HttpServiceInvocation>>, failure: HttpServiceFailure) {
    if let Some(invocation) = invocation {
        invocation.fail(failure);
    }
}
