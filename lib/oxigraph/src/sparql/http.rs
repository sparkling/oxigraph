use crate::http::{EgressErrorKind, HttpClient, find_egress_error};
use crate::model::NamedNode;
use oxiri::Iri;
use oxstr::OxString;
use sparesults::{QueryResultsParser, ReaderQueryResultsParserOutput};
use spareval::{DefaultServiceHandler, QueryEvaluationError, QuerySolutionIter};
use spargebra::SparqlVersion;
use spargebra::algebra::QueryExpression;
use spargebra::query::SelectQuery;
use std::error::Error;

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
        let client = self.client.for_operation();
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
            .map_err(|error| service_error(error, &client))?;
        let parser = QueryResultsParser::from_media_type(&content_type).map_err(|error| {
            QueryEvaluationError::Service(
                format!(
                    "Unsupported Content-Type returned by service {service_name}: \
                     {content_type}: {error}"
                )
                .into(),
            )
        })?;
        let ReaderQueryResultsParserOutput::Solutions(reader) = parser
            .for_reader(body)
            .map_err(|error| service_error(error, &client))?
        else {
            return Err(QueryEvaluationError::Service(
                "No valid SPARQL solutions returned by {service_name}".into(),
            ));
        };
        Ok(QuerySolutionIter::new(
            reader.variables().into(),
            Box::new(
                reader.map(move |result| result.map_err(|error| service_error(error, &client))),
            ),
        ))
    }
}

fn service_error(
    error: impl Error + Send + Sync + 'static,
    client: &HttpClient,
) -> QueryEvaluationError {
    if find_egress_error(&error).is_some_and(|error| error.kind() == EgressErrorKind::Cancelled) {
        return QueryEvaluationError::Cancelled;
    }
    if find_egress_error(&error).is_some() {
        return QueryEvaluationError::Service(Box::new(error));
    }
    if let Some(error) = client.take_recorded_error() {
        return if error.kind() == EgressErrorKind::Cancelled {
            QueryEvaluationError::Cancelled
        } else {
            QueryEvaluationError::Service(Box::new(error))
        };
    }
    QueryEvaluationError::Service(Box::new(error))
}
