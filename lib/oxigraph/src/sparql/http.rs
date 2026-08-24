use crate::http::HttpClient;
use crate::model::{NamedNode, OxString};
use oxiri::Iri;
use sparesults::{QueryResultsParser, ReaderQueryResultsParserOutput};
use spareval::{DefaultServiceHandler, QueryEvaluationError, QuerySolutionIter};
use spargebra::SparqlVersion;
use spargebra::algebra::QueryExpression;
use spargebra::query::SelectQuery;
use std::time::Duration;

pub struct HttpServiceHandler {
    client: HttpClient,
    version: SparqlVersion,
}

impl HttpServiceHandler {
    pub fn new(
        http_timeout: Option<Duration>,
        http_redirection_limit: usize,
        version: SparqlVersion,
    ) -> Self {
        Self {
            client: HttpClient::new(http_timeout, http_redirection_limit),
            version,
        }
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
        let (content_type, body) = self
            .client
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
            .map_err(|e| QueryEvaluationError::Service(Box::new(e)))?;
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
            .map_err(|e| QueryEvaluationError::Service(Box::new(e)))?
        else {
            return Err(QueryEvaluationError::Service(
                "No valid SPARQL solutions returned by {service_name}".into(),
            ));
        };
        Ok(QuerySolutionIter::new(
            reader.variables().into(),
            Box::new(reader.map(|t| t.map_err(|e| QueryEvaluationError::Service(Box::new(e))))),
        ))
    }
}
