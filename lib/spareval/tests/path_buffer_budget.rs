#![cfg(test)]
#![expect(
    clippy::panic,
    reason = "unexpected fixture result types fail the test"
)]

use oxrdf::{Dataset, GraphName, NamedNode, Quad, Variable};
use spareval::{
    AggregateDistinctBudget, GroupBufferBudget, PathBufferBudget, QueryEvaluationError,
    QueryEvaluator, QueryResource, QueryResourcePhase, QueryResults, QuerySolution,
    QuerySolutionIter, ServiceHandler,
};
use spargebra::SparqlParser;
use std::sync::Arc;

fn data() -> Dataset {
    let mut data = Dataset::new();
    data.insert(Quad::new(
        NamedNode::new_unchecked("urn:a"),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:b"),
        GraphName::DefaultGraph,
    ));
    data
}

fn run(
    evaluator: &QueryEvaluator,
    query: &str,
    data: &Dataset,
) -> Result<Vec<String>, QueryEvaluationError> {
    let query = SparqlParser::new().parse_query(query).unwrap();
    match evaluator.prepare(&query).execute(data)? {
        QueryResults::Boolean(value) => Ok(vec![value.to_string()]),
        QueryResults::Solutions(rows) => {
            let mut rows = rows
                .map(|row| {
                    row.map(|row| {
                        row.iter()
                            .map(|(name, value)| format!("{name}={value}"))
                            .collect::<Vec<_>>()
                            .join(";")
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            rows.sort_unstable();
            Ok(rows)
        }
        QueryResults::Graph(_) => panic!("unexpected graph result"),
    }
}

fn assert_limit(error: QueryEvaluationError, limit: u64) {
    assert!(matches!(
        error,
        QueryEvaluationError::ResourceLimitExceeded {
            resource: QueryResource::PathBufferRows,
            phase: QueryResourcePhase::PathBuffer,
            limit: actual,
        } if actual == limit
    ));
}

#[test]
fn forward_reverse_open_and_closed_paths_count_actual_buffer_entries() {
    let data = data();
    // Closure worklists and visited sets own separate entries. The optional
    // paths use one deduplication set; open paths retain endpoint pairs.
    for (query, entries) in [
        ("SELECT ?o WHERE { <urn:a> <urn:p>? ?o }", 2),
        ("SELECT ?s WHERE { ?s <urn:p>? <urn:b> }", 2),
        ("SELECT ?s ?o WHERE { ?s <urn:p>? ?o }", 3),
        ("SELECT ?o WHERE { <urn:a> <urn:p>* ?o }", 4),
        ("SELECT ?s WHERE { ?s <urn:p>* <urn:b> }", 4),
        ("SELECT ?s ?o WHERE { ?s <urn:p>* ?o }", 6),
        ("SELECT ?o WHERE { <urn:a> <urn:p>+ ?o }", 2),
        ("SELECT ?s ?o WHERE { ?s <urn:p>+ ?o }", 2),
        ("ASK { <urn:a> <urn:p>+ <urn:b> }", 2),
        ("ASK { <urn:a> <urn:p>* <urn:b> }", 2),
        ("SELECT ?o WHERE { <urn:a> (<urn:p>|<urn:p>) ?o }", 1),
    ] {
        let baseline = run(&QueryEvaluator::new().without_optimizations(), query, &data).unwrap();
        for limit in [0, entries - 1, entries, entries + 1] {
            let budget = PathBufferBudget::new(limit);
            let evaluator = QueryEvaluator::new()
                .without_optimizations()
                .with_path_buffer_budget(budget.clone());
            let result = run(&evaluator, query, &data);
            assert_eq!(budget.charged_rows(), limit.min(entries), "{query}");
            if limit < entries {
                assert_limit(result.unwrap_err(), limit);
                assert_limit(run(&evaluator, "ASK {}", &data).unwrap_err(), limit);
            } else {
                assert_eq!(result.unwrap(), baseline, "{query}");
                budget.check().unwrap();
            }
        }
        // The optimizer may remove/rewrite physical path buffers. Successful
        // results must remain identical; do not invent a plan-independent count.
        let optimized = QueryEvaluator::new().with_path_buffer_budget(PathBufferBudget::new(100));
        assert_eq!(run(&optimized, query, &data).unwrap(), baseline, "{query}");
    }
}

#[test]
fn bufferless_and_empty_paths_allow_zero_and_other_counters_stay_independent() {
    let data = data();
    for query in [
        "ASK {}",
        "ASK { <urn:a> <urn:p>* <urn:a> }",
        "SELECT ?o WHERE { <urn:a> <urn:p> ?o }",
        "SELECT ?o WHERE { <urn:a> !<urn:missing> ?o }",
        "SELECT ?o WHERE { <urn:missing> <urn:p>+ ?o }",
    ] {
        let budget = PathBufferBudget::new(0);
        let plain = QueryEvaluator::new().without_optimizations();
        assert_eq!(
            run(
                &plain.clone().with_path_buffer_budget(budget.clone()),
                query,
                &data
            )
            .unwrap(),
            run(&plain, query, &data).unwrap(),
        );
        assert_eq!(budget.charged_rows(), 0);
        budget.check().unwrap();
    }
    let group = GroupBufferBudget::new(0);
    let aggregate = AggregateDistinctBudget::new(0);
    let path = PathBufferBudget::new(2);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_path_buffer_budget(path.clone())
        .with_group_buffer_budget(group.clone())
        .with_aggregate_distinct_budget(aggregate.clone());
    run(&evaluator, "SELECT ?o WHERE { <urn:a> <urn:p>? ?o }", &data).unwrap();
    assert_eq!(path.charged_rows(), 2);
    assert_eq!(group.charged_rows(), 0);
    assert_eq!(aggregate.charged_rows(), 0);
}

#[test]
fn prepared_clones_repeated_paths_and_named_graphs_share_one_counter() {
    let query = SparqlParser::new()
        .parse_query("SELECT ?o WHERE { <urn:a> <urn:p>* ?o }")
        .unwrap();
    let empty = Dataset::new();
    let budget = PathBufferBudget::new(4);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_path_buffer_budget(budget.clone());
    let prepared = evaluator.prepare(&query);
    for _ in 0..2 {
        let QueryResults::Solutions(rows) = prepared.clone().execute(&empty).unwrap() else {
            panic!("solutions expected");
        };
        assert_eq!(rows.collect::<Result<Vec<_>, _>>().unwrap().len(), 1);
    }
    assert_eq!(budget.charged_rows(), 4);
    assert_limit(
        run(&evaluator, "ASK { <urn:a> <urn:p>+ <urn:b> }", &data()).unwrap_err(),
        4,
    );

    let budget = PathBufferBudget::new(3);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_path_buffer_budget(budget.clone());
    assert_limit(
        run(
            &evaluator,
            "SELECT ?o ?z WHERE { <urn:a> <urn:p>* ?o . <urn:c> <urn:p>* ?z }",
            &empty,
        )
        .unwrap_err(),
        3,
    );

    let mut named = Dataset::new();
    for quad in data().iter() {
        named.insert(Quad::new(
            quad.subject,
            quad.predicate,
            quad.object,
            NamedNode::new_unchecked("urn:g"),
        ));
    }
    let budget = PathBufferBudget::new(1);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_path_buffer_budget(budget);
    assert_limit(
        run(
            &evaluator,
            "SELECT ?o WHERE { GRAPH <urn:g> { <urn:a> <urn:p>? ?o } }",
            &named,
        )
        .unwrap_err(),
        1,
    );
}

#[test]
fn ask_exists_and_service_silent_do_not_hide_exhausted_path_budget() {
    let empty = Dataset::new();
    for query in [
        "ASK { <urn:a> <urn:p>* ?o }",
        "SELECT (EXISTS { <urn:a> <urn:p>* ?o } AS ?exists) WHERE {}",
    ] {
        let budget = PathBufferBudget::new(0);
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_path_buffer_budget(budget);
        assert_limit(run(&evaluator, query, &empty).unwrap_err(), 0);
    }
    for lazy in [false, true] {
        let budget = PathBufferBudget::new(0);
        let evaluator = QueryEvaluator::new()
            .with_path_buffer_budget(budget.clone())
            .with_service_handler(
                NamedNode::new_unchecked("urn:child"),
                SwallowingPath { budget, lazy },
            );
        assert_limit(
            run(
                &evaluator,
                "ASK { SERVICE SILENT <urn:child> { ?s ?p ?o } }",
                &empty,
            )
            .unwrap_err(),
            0,
        );
    }
}

struct SwallowingPath {
    budget: PathBufferBudget,
    lazy: bool,
}

impl SwallowingPath {
    fn exhaust(budget: PathBufferBudget) {
        let inner = QueryEvaluator::new()
            .without_optimizations()
            .with_path_buffer_budget(budget);
        assert_limit(
            run(
                &inner,
                "SELECT ?o WHERE { <urn:a> <urn:p>* ?o }",
                &Dataset::new(),
            )
            .unwrap_err(),
            0,
        );
    }
}

impl ServiceHandler for SwallowingPath {
    type Error = QueryEvaluationError;

    fn handle(
        &self,
        _query: &spargebra::algebra::QueryExpression,
        _base: Option<&oxiri::Iri<oxstr::OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let variables: Arc<[Variable]> = Arc::from([]);
        let row_variables = Arc::clone(&variables);
        let budget = self.budget.clone();
        let lazy = self.lazy;
        if !lazy {
            Self::exhaust(budget.clone());
        }
        Ok(QuerySolutionIter::new(
            variables,
            std::iter::once_with(move || {
                if lazy {
                    Self::exhaust(budget);
                }
                Ok(QuerySolution::from((row_variables, Vec::new())))
            }),
        ))
    }
}
