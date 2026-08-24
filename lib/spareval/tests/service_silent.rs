#![cfg(test)]
#![expect(
    clippy::assertions_on_result_states,
    clippy::panic_in_result_fn,
    reason = "integration tests exercise the public streaming SERVICE boundary"
)]

use oxiri::Iri;
use oxrdf::{Dataset, Literal, NamedNode, OxString, Variable};
use spareval::{
    QueryEvaluationError, QueryEvaluator, QueryResults, QuerySolution, QuerySolutionIter,
    ServiceHandler,
};
use spargebra::SparqlParser;
use spargebra::algebra::QueryExpression;
use std::convert::Infallible;
use std::io;
use std::sync::Arc;

struct LazyErrorService;

impl ServiceHandler for LazyErrorService {
    type Error = Infallible;

    fn handle(
        &self,
        _expression: &QueryExpression,
        _base_iri: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let variables: Arc<[Variable]> = [Variable::new_unchecked("remote")].into();
        Ok(QuerySolutionIter::new(
            Arc::clone(&variables),
            [
                Ok(QuerySolution::from((
                    Arc::clone(&variables),
                    vec![Some(Literal::from(2).into())],
                ))),
                Err(QueryEvaluationError::Service(Box::new(io::Error::other(
                    "lazy remote failure",
                )))),
            ],
        ))
    }
}

#[test]
fn service_silent_suppresses_lazy_stream_errors_atomically()
-> Result<(), Box<dyn std::error::Error>> {
    let service = NamedNode::new("urn:test:service")?;
    let query = SparqlParser::new().parse_query(
        "SELECT ?input ?remote WHERE {
            VALUES ?input { 1 }
            SERVICE SILENT <urn:test:service> { ?s ?p ?remote }
        }",
    )?;
    let dataset = Dataset::new();
    let QueryResults::Solutions(solutions) = QueryEvaluator::new()
        .with_service_handler(service, LazyErrorService)
        .prepare(&query)
        .execute(&dataset)?
    else {
        return Err("expected SELECT solutions".into());
    };
    let solutions = solutions.collect::<Result<Vec<_>, _>>()?;
    assert_eq!(solutions.len(), 1);
    assert_eq!(solutions[0].get("input"), Some(&Literal::from(1).into()));
    assert_eq!(solutions[0].get("remote"), None);
    Ok(())
}

#[test]
fn service_without_silent_propagates_lazy_stream_errors() -> Result<(), Box<dyn std::error::Error>>
{
    let service = NamedNode::new("urn:test:service")?;
    let query = SparqlParser::new().parse_query(
        "SELECT ?input ?remote WHERE {
            VALUES ?input { 1 }
            SERVICE <urn:test:service> { ?s ?p ?remote }
        }",
    )?;
    let dataset = Dataset::new();
    let QueryResults::Solutions(mut solutions) = QueryEvaluator::new()
        .with_service_handler(service, LazyErrorService)
        .prepare(&query)
        .execute(&dataset)?
    else {
        return Err("expected SELECT solutions".into());
    };
    let first = solutions.next().ok_or("expected the first service row")??;
    assert_eq!(first.get("remote"), Some(&Literal::from(2).into()));
    assert!(
        solutions
            .next()
            .ok_or("expected the lazy service error")?
            .is_err()
    );
    Ok(())
}
