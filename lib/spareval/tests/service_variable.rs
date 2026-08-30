#![cfg(test)]
#![cfg(feature = "sep-0006")]
#![expect(
    clippy::panic_in_result_fn,
    reason = "integration tests use assertions while propagating public API errors"
)]

use oxiri::Iri;
use oxrdf::{Dataset, GraphName, Literal, NamedNode, OxString, Quad, Term, Variable};
use spareval::{
    DefaultServiceHandler, QueryEvaluationError, QueryEvaluator, QueryResults, QuerySolution,
    QuerySolutionIter,
};
use spargebra::SparqlParser;
use spargebra::algebra::QueryExpression;
use std::convert::Infallible;
use std::iter::once;
use std::sync::Arc;

#[derive(Clone, Copy)]
struct EndpointEchoService;

impl DefaultServiceHandler for EndpointEchoService {
    type Error = Infallible;

    fn handle(
        &self,
        service_name: &NamedNode,
        _expression: &QueryExpression,
        _base_iri: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let variables: Arc<[Variable]> = [Variable::new_unchecked("title")].into();
        Ok(QuerySolutionIter::new(
            Arc::clone(&variables),
            once(Ok(QuerySolution::from((
                variables,
                vec![Some(service_name.clone().into())],
            )))),
        ))
    }
}

fn endpoint_dataset() -> Dataset {
    let endpoint = NamedNode::new_unchecked("urn:endpoint");
    Dataset::from_iter([
        Quad::new(
            NamedNode::new_unchecked("urn:source:one"),
            endpoint.clone(),
            NamedNode::new_unchecked("urn:service:one"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            NamedNode::new_unchecked("urn:source:two"),
            endpoint,
            NamedNode::new_unchecked("urn:service:two"),
            GraphName::DefaultGraph,
        ),
    ])
}

fn evaluate_endpoint_query(
    query: &str,
    without_optimizations: bool,
) -> Result<Vec<(Term, Term)>, Box<dyn std::error::Error>> {
    let query = SparqlParser::new().parse_query(query)?;
    let mut evaluator = QueryEvaluator::new().with_default_service_handler(EndpointEchoService);
    if without_optimizations {
        evaluator = evaluator.without_optimizations();
    }
    let dataset = endpoint_dataset();
    let QueryResults::Solutions(solutions) = evaluator.prepare(&query).execute(&dataset)? else {
        return Err("expected SELECT solutions".into());
    };
    solutions
        .map(|solution| {
            let solution = solution?;
            let service = solution
                .get("service")
                .ok_or("expected ?service binding")?
                .clone();
            let title = solution
                .get("title")
                .ok_or("expected ?title binding")?
                .clone();
            Ok((service, title))
        })
        .collect()
}

#[test]
fn variable_service_runs_after_its_local_binder_with_and_without_optimizations()
-> Result<(), Box<dyn std::error::Error>> {
    let expected = vec![
        (
            NamedNode::new_unchecked("urn:service:one").into(),
            NamedNode::new_unchecked("urn:service:one").into(),
        ),
        (
            NamedNode::new_unchecked("urn:service:two").into(),
            NamedNode::new_unchecked("urn:service:two").into(),
        ),
    ];
    for query in [
        "SELECT ?service ?title WHERE {
            ?source <urn:endpoint> ?service .
            SERVICE ?service { ?project <urn:name> ?title }
        } ORDER BY ?service",
        "SELECT ?service ?title WHERE {
            SERVICE ?service { ?project <urn:name> ?title }
            ?source <urn:endpoint> ?service .
        } ORDER BY ?service",
    ] {
        assert_eq!(evaluate_endpoint_query(query, false)?, expected);
        assert_eq!(evaluate_endpoint_query(query, true)?, expected);
    }
    Ok(())
}

fn first_solution_error(query: &str) -> Result<QueryEvaluationError, Box<dyn std::error::Error>> {
    let query = SparqlParser::new().parse_query(query)?;
    match QueryEvaluator::new()
        .with_default_service_handler(EndpointEchoService)
        .prepare(&query)
        .execute(&Dataset::new())
    {
        Err(error) => Ok(error),
        Ok(QueryResults::Solutions(mut solutions)) => match solutions.next() {
            Some(Err(error)) => Ok(error),
            Some(Ok(_)) => Err("expected an unbound SERVICE error, got a solution".into()),
            None => Err("expected an unbound SERVICE error, got no solutions".into()),
        },
        Ok(_) => Err("expected SELECT solutions".into()),
    }
}

#[test]
fn genuinely_unbound_variable_service_is_an_error() -> Result<(), Box<dyn std::error::Error>> {
    assert!(matches!(
        first_solution_error(
            "SELECT ?title WHERE {
                SERVICE ?service { ?project <urn:name> ?title }
            }"
        )?,
        QueryEvaluationError::UnboundService
    ));
    Ok(())
}

#[test]
fn genuinely_unbound_variable_service_silent_keeps_the_input_solution()
-> Result<(), Box<dyn std::error::Error>> {
    let query = SparqlParser::new().parse_query(
        "SELECT ?keep ?title WHERE {
            VALUES ?keep { 1 }
            SERVICE SILENT ?service { ?project <urn:name> ?title }
        }",
    )?;
    let dataset = Dataset::new();
    for without_optimizations in [false, true] {
        let mut evaluator = QueryEvaluator::new().with_default_service_handler(EndpointEchoService);
        if without_optimizations {
            evaluator = evaluator.without_optimizations();
        }
        let QueryResults::Solutions(solutions) = evaluator.prepare(&query).execute(&dataset)?
        else {
            return Err("expected SELECT solutions".into());
        };
        let solutions = solutions.collect::<Result<Vec<_>, _>>()?;
        assert_eq!(solutions.len(), 1);
        assert_eq!(solutions[0].get("keep"), Some(&Literal::from(1).into()));
        assert_eq!(solutions[0].get("title"), None);
    }
    Ok(())
}
