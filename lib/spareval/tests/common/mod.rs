//! Shared helpers for the cooperative row-budget integration tests.
use oxrdf::Dataset;
use spareval::{
    QueryEvaluationError, QueryEvaluator, QueryResource, QueryResourcePhase, QueryResults,
    QuerySolution, QuerySolutionIter, ServiceHandler,
};
use spargebra::SparqlParser;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

pub fn resource_error(
    error: QueryEvaluationError,
    resource: QueryResource,
    phase: QueryResourcePhase,
    limit: u64,
) {
    assert!(
        matches!(&error, QueryEvaluationError::ResourceLimitExceeded {
            resource: actual_resource,
            phase: actual_phase,
            limit: actual_limit,
        } if *actual_resource == resource && *actual_phase == phase && *actual_limit == limit),
        "{error:?}"
    );
}

pub fn consume(evaluator: &QueryEvaluator, query: &str) -> Result<usize, QueryEvaluationError> {
    let parsed = SparqlParser::new().parse_query(query).unwrap();
    match evaluator.prepare(&parsed).execute(&Dataset::new())? {
        QueryResults::Solutions(mut rows) => rows.try_fold(0, |count, row| row.map(|_| count + 1)),
        QueryResults::Boolean(value) => Ok(usize::from(value)),
        QueryResults::Graph(mut rows) => rows.try_fold(0, |count, row| row.map(|_| count + 1)),
    }
}

/// Exhausts a shared budget inside the handler (at dispatch, or lazily while
/// iterating) and swallows that failure, returning EOF or empty rows instead.
pub struct SwallowingService {
    pub exhaust: Arc<dyn Fn() + Send + Sync>,
    pub lazy: bool,
    pub calls: Arc<AtomicUsize>,
}

impl ServiceHandler for SwallowingService {
    type Error = std::convert::Infallible;
    fn handle(
        &self,
        _: &spargebra::algebra::QueryExpression,
        _: Option<&oxiri::Iri<oxrdf::OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let exhaust = Arc::clone(&self.exhaust);
        if self.lazy {
            let calls = Arc::clone(&self.calls);
            Ok(QuerySolutionIter::new(
                Arc::from([]),
                std::iter::from_fn(move || {
                    let call = calls.fetch_add(1, Ordering::SeqCst);
                    if call > 10 {
                        return None;
                    }
                    exhaust();
                    Some(Ok(QuerySolution::from((Arc::from([]), vec![]))))
                }),
            ))
        } else {
            exhaust();
            Ok(QuerySolutionIter::new(Arc::from([]), []))
        }
    }
}
