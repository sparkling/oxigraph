mod common;

use common::{SwallowingService, consume};
use oxrdf::{Dataset, Literal, NamedNode, Term};
use spareval::{
    CancellationToken, ExpressionTerm, InnerJoinBuildBudget, InternalQuad, QueryEvaluationError,
    QueryEvaluator, QueryResource, QueryResourcePhase, QueryResults, QueryableDataset,
    SortBufferBudget,
};
use spargebra::SparqlParser;
use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn resource_error(error: QueryEvaluationError, limit: u64) {
    common::resource_error(
        error,
        QueryResource::SortBufferRows,
        QueryResourcePhase::SortBuffer,
        limit,
    );
}

/// The ordered projected values, so a budgeted run can be compared with the
/// unbudgeted bag including duplicates and order.
fn ordered_values<'b>(
    evaluator: &QueryEvaluator,
    query: &str,
    dataset: impl QueryableDataset<'b>,
) -> Result<Vec<String>, QueryEvaluationError> {
    let parsed = SparqlParser::new().parse_query(query).unwrap();
    let QueryResults::Solutions(rows) = evaluator.prepare(&parsed).execute(dataset)? else {
        panic!("solutions expected");
    };
    rows.map(|row| {
        row.map(|row| {
            row.iter()
                .map(|(_, term)| match term {
                    Term::Literal(literal) => literal.value().to_owned(),
                    other => other.to_string(),
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
    })
    .collect()
}

const DUPLICATED: &str = "SELECT ?x WHERE { VALUES ?x { 3 1 2 1 } } ORDER BY DESC(?x)";

#[test]
fn budgeted_results_match_the_unbudgeted_order_and_duplicates() {
    for optimized in [false, true] {
        let plain = if optimized {
            QueryEvaluator::new()
        } else {
            QueryEvaluator::new().without_optimizations()
        };
        let baseline = ordered_values(&plain, DUPLICATED, &Dataset::new()).unwrap();
        assert_eq!(baseline, ["3", "2", "1", "1"]);
        for limit in [4, 5, u64::MAX] {
            let budget = SortBufferBudget::new(limit);
            let evaluator = plain.clone().with_sort_buffer_budget(budget.clone());
            assert_eq!(
                ordered_values(&evaluator, DUPLICATED, &Dataset::new()).unwrap(),
                baseline
            );
            assert_eq!(budget.charged_rows(), 4);
            budget.check().unwrap();
        }
    }
}

#[test]
fn zero_exact_and_one_beyond_are_the_boundary() {
    for limit in [0, 3, 4, 5] {
        let budget = SortBufferBudget::new(limit);
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_sort_buffer_budget(budget.clone());
        let result = consume(&evaluator, DUPLICATED);
        if limit < 4 {
            resource_error(result.unwrap_err(), limit);
            assert!(budget.check().is_err());
            assert_eq!(budget.charged_rows(), limit);
            // The latch is sticky even for work that needs no sort buffer.
            resource_error(
                consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { 1 } }").unwrap_err(),
                limit,
            );
        } else {
            assert_eq!(result.unwrap(), 4);
            assert_eq!(budget.charged_rows(), 4);
            budget.check().unwrap();
        }
    }
    // Zero permits queries that never admit a row to a sort buffer.
    let zero = SortBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_sort_buffer_budget(zero.clone());
    assert_eq!(
        consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { 1 2 3 } }").unwrap(),
        3
    );
    assert_eq!(
        consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { } } ORDER BY ?x").unwrap(),
        0
    );
    assert_eq!(
        consume(
            &evaluator,
            "SELECT * WHERE { VALUES ?x { 1 } VALUES ?y { 2 } }"
        )
        .unwrap(),
        1
    );
    zero.check().unwrap();
    assert_eq!(zero.charged_rows(), 0);
    resource_error(
        consume(
            &evaluator,
            "SELECT ?x WHERE { VALUES ?x { 1 } } ORDER BY ?x",
        )
        .unwrap_err(),
        0,
    );
}

#[test]
fn repeated_nested_buffers_and_cloned_evaluators_are_cumulative() {
    let nested = "SELECT ?x WHERE {
        { SELECT ?x WHERE { VALUES ?x { 2 1 } } ORDER BY ?x }
    } ORDER BY DESC(?x)";
    for optimized in [false, true] {
        let plain = if optimized {
            QueryEvaluator::new()
        } else {
            QueryEvaluator::new().without_optimizations()
        };
        assert_eq!(
            ordered_values(&plain, nested, &Dataset::new()).unwrap(),
            ["2", "1"]
        );
        let budget = SortBufferBudget::new(4);
        let evaluator = plain.clone().with_sort_buffer_budget(budget.clone());
        assert_eq!(
            ordered_values(&evaluator, nested, &Dataset::new()).unwrap(),
            ["2", "1"]
        );
        // Inner and outer buffers each admitted two rows.
        assert_eq!(budget.charged_rows(), 4);
        budget.check().unwrap();
        // A clone shares the counter: the next buffered row is denied.
        let clone = evaluator.clone();
        resource_error(consume(&clone, nested).unwrap_err(), 4);
        assert_eq!(budget.charged_rows(), 4);
        assert!(evaluator.sort_buffer_budget().unwrap().check().is_err());
        assert_eq!(evaluator.sort_buffer_budget().unwrap().limit(), 4);
    }
    // Repeated executions of one prepared query also accumulate.
    let budget = SortBufferBudget::new(5);
    let evaluator = QueryEvaluator::new().with_sort_buffer_budget(budget.clone());
    let parsed = SparqlParser::new()
        .parse_query("SELECT ?x WHERE { VALUES ?x { 1 2 } } ORDER BY ?x")
        .unwrap();
    let prepared = evaluator.prepare(&parsed);
    let empty = Dataset::new();
    for _ in 0..2 {
        let QueryResults::Solutions(rows) = prepared.clone().execute(&empty).unwrap() else {
            panic!("solutions expected");
        };
        // Collect results so a swallowed error can never count as a row.
        assert_eq!(rows.collect::<Result<Vec<_>, _>>().unwrap().len(), 2);
    }
    assert_eq!(budget.charged_rows(), 4);
    let QueryResults::Solutions(mut rows) = prepared.execute(&empty).unwrap() else {
        panic!("solutions expected");
    };
    resource_error(rows.next().unwrap().unwrap_err(), 5);
    assert!(rows.next().is_none());
    assert_eq!(budget.charged_rows(), 5);
}

#[test]
fn join_and_sort_budgets_are_independent_and_typed_separately() {
    let join = InnerJoinBuildBudget::new(0);
    let sort = SortBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(join.clone())
        .with_sort_buffer_budget(sort.clone());
    assert_eq!(
        consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { 1 2 } }").unwrap(),
        2
    );
    // A sort failure never charges or latches the join counter.
    resource_error(consume(&evaluator, DUPLICATED).unwrap_err(), 0);
    join.check().unwrap();
    assert_eq!(join.charged_rows(), 0);
    assert_eq!(sort.charged_rows(), 0);
    // A latched join budget keeps reporting the join resource first.
    let join = InnerJoinBuildBudget::new(0);
    let sort = SortBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(join.clone())
        .with_sort_buffer_budget(sort.clone());
    common::resource_error(
        consume(
            &evaluator,
            "SELECT * WHERE { VALUES ?x { 1 } VALUES ?y { 2 } }",
        )
        .unwrap_err(),
        QueryResource::InnerJoinBuildRows,
        QueryResourcePhase::JoinBuild,
        0,
    );
    sort.check().unwrap();
    common::resource_error(
        consume(&evaluator, DUPLICATED).unwrap_err(),
        QueryResource::InnerJoinBuildRows,
        QueryResourcePhase::JoinBuild,
        0,
    );
    assert_eq!(sort.charged_rows(), 0);
    // A sort budget alone leaves joins uninstrumented.
    let sort = SortBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_sort_buffer_budget(sort.clone());
    assert_eq!(
        consume(
            &evaluator,
            "SELECT * WHERE { VALUES ?x { 1 2 } VALUES ?y { 3 } }",
        )
        .unwrap(),
        2
    );
    assert!(evaluator.inner_join_build_budget().is_none());
}

#[test]
fn cancellation_keeps_precedence_over_an_intact_sort_budget() {
    let token = CancellationToken::new();
    let budget = SortBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .with_cancellation_token(token.clone())
        .with_sort_buffer_budget(budget.clone());
    token.cancel();
    assert!(matches!(
        consume(&evaluator, DUPLICATED),
        Err(QueryEvaluationError::Cancelled)
    ));
    budget.check().unwrap();
    assert_eq!(budget.charged_rows(), 0);
}

/// A dataset whose pattern iterator lies about its size and counts every read
/// and every sort-key externalization.
struct CountingDataset {
    objects: Vec<u64>,
    reads: Arc<AtomicUsize>,
    keyed: Arc<AtomicUsize>,
}

struct InflatedIter<I> {
    inner: I,
    reads: Arc<AtomicUsize>,
}

impl<I: Iterator> Iterator for InflatedIter<I> {
    type Item = I::Item;
    fn next(&mut self) -> Option<I::Item> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.inner.next()
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        (usize::MAX, None)
    }
}

const SUBJECT: u64 = 1;
const PREDICATE: u64 = 2;
const OBJECT_BASE: u64 = 100;

impl<'a> QueryableDataset<'a> for &'a CountingDataset {
    type InternalTerm = u64;
    type Error = Infallible;

    fn internal_quads_for_pattern(
        &self,
        subject: Option<&u64>,
        predicate: Option<&u64>,
        object: Option<&u64>,
        graph_name: Option<Option<&u64>>,
    ) -> impl Iterator<Item = Result<InternalQuad<u64>, Infallible>> + use<'a> {
        let quads = if graph_name.is_none_or(|graph| graph.is_some()) {
            Vec::new()
        } else {
            self.objects
                .iter()
                .filter(|value| {
                    subject.is_none_or(|term| *term == SUBJECT)
                        && predicate.is_none_or(|term| *term == PREDICATE)
                        && object.is_none_or(|term| term == *value)
                })
                .map(|value| {
                    Ok(InternalQuad {
                        subject: SUBJECT,
                        predicate: PREDICATE,
                        object: *value,
                        graph_name: None,
                    })
                })
                .collect::<Vec<_>>()
        };
        InflatedIter {
            inner: quads.into_iter(),
            reads: Arc::clone(&self.reads),
        }
    }

    fn internalize_term(&self, term: Term) -> Result<u64, Infallible> {
        Ok(match term {
            Term::NamedNode(node) if node.as_str() == "urn:s" => SUBJECT,
            Term::NamedNode(node) if node.as_str() == "urn:p" => PREDICATE,
            Term::Literal(literal) => OBJECT_BASE + literal.value().parse::<u64>().unwrap(),
            _ => 0,
        })
    }

    fn externalize_term(&self, term: u64) -> Result<Term, Infallible> {
        Ok(match term {
            SUBJECT => NamedNode::new_unchecked("urn:s").into(),
            PREDICATE => NamedNode::new_unchecked("urn:p").into(),
            value => Literal::from(i64::try_from(value - OBJECT_BASE).unwrap()).into(),
        })
    }

    /// `ORDER BY` keys are the only expression-term externalizations here.
    fn externalize_expression_term(&self, term: u64) -> Result<ExpressionTerm, Infallible> {
        self.keyed.fetch_add(1, Ordering::SeqCst);
        Ok(self.externalize_term(term)?.into())
    }
}

#[test]
fn denied_row_is_neither_keyed_nor_read_beyond_despite_inflated_size_hints() {
    let query = "SELECT ?o WHERE { <urn:s> <urn:p> ?o } ORDER BY DESC(?o)";
    let objects = [3, 1, 4, 1, 5, 9].map(|value| OBJECT_BASE + value).to_vec();
    let dataset = || CountingDataset {
        objects: objects.clone(),
        reads: Arc::default(),
        keyed: Arc::default(),
    };
    let baseline = dataset();
    assert_eq!(
        ordered_values(&QueryEvaluator::new(), query, &baseline).unwrap(),
        ["9", "5", "4", "3", "1", "1"]
    );
    // Six rows plus the EOF read; one sort key per admitted row.
    assert_eq!(baseline.reads.load(Ordering::SeqCst), 7);
    assert_eq!(baseline.keyed.load(Ordering::SeqCst), 6);
    for limit in [0, 4, 6, 7] {
        let counting = dataset();
        let budget = SortBufferBudget::new(limit);
        let evaluator = QueryEvaluator::new().with_sort_buffer_budget(budget.clone());
        let result = ordered_values(&evaluator, query, &counting);
        if limit < 6 {
            resource_error(result.unwrap_err(), limit);
            // The denied row was read, but never keyed or buffered, and no
            // further row was pulled from the source despite its size hint.
            let admitted = usize::try_from(limit).unwrap();
            assert_eq!(counting.reads.load(Ordering::SeqCst), admitted + 1);
            assert_eq!(counting.keyed.load(Ordering::SeqCst), admitted);
            assert_eq!(budget.charged_rows(), limit);
        } else {
            assert_eq!(
                result.unwrap(),
                ordered_values(&QueryEvaluator::new(), query, &baseline).unwrap()
            );
            assert_eq!(counting.reads.load(Ordering::SeqCst), 7);
            assert_eq!(counting.keyed.load(Ordering::SeqCst), 6);
            assert_eq!(budget.charged_rows(), 6);
            budget.check().unwrap();
        }
    }
}

const ORDERED_PAIR: &str = "{ SELECT ?x WHERE { VALUES ?x { 1 2 } } ORDER BY ?x }";

#[test]
fn exists_ask_union_aggregates_construct_and_describe_cannot_mask_exhaustion() {
    for query in [
        format!("ASK {{ {ORDERED_PAIR} UNION {{ VALUES ?ok {{ 1 }} }} }}"),
        format!("ASK {{ {{ SERVICE <urn:missing> {{ ?s ?p ?o }} }} UNION {ORDERED_PAIR} }}"),
        format!("ASK {{ FILTER EXISTS {ORDERED_PAIR} }}"),
        format!("ASK {{ FILTER NOT EXISTS {ORDERED_PAIR} }}"),
        format!("SELECT (EXISTS {ORDERED_PAIR} AS ?exists) WHERE {{}}"),
        format!("SELECT (COUNT(*) AS ?count) WHERE {ORDERED_PAIR}"),
        format!("SELECT ?x WHERE {ORDERED_PAIR} LIMIT 1"),
        format!("CONSTRUCT {{ <urn:s> <urn:p> ?x }} WHERE {ORDERED_PAIR}"),
        "DESCRIBE ?x WHERE { { SELECT ?x WHERE { VALUES ?x { <urn:a> <urn:b> } } ORDER BY ?x } }"
            .to_owned(),
    ] {
        for optimized in [false, true] {
            let plain = if optimized {
                QueryEvaluator::new()
            } else {
                QueryEvaluator::new().without_optimizations()
            };
            let budget = SortBufferBudget::new(1);
            let evaluator = plain.with_sort_buffer_budget(budget.clone());
            resource_error(consume(&evaluator, &query).unwrap_err(), 1);
            assert_eq!(budget.charged_rows(), 1, "{query}");
        }
    }
}

#[test]
fn buffered_graph_results_observe_failure_from_a_shared_execution() {
    let dataset = Dataset::from_iter([
        oxrdf::Quad::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            NamedNode::new_unchecked("urn:a"),
            oxrdf::GraphName::DefaultGraph,
        ),
        oxrdf::Quad::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:q"),
            NamedNode::new_unchecked("urn:b"),
            oxrdf::GraphName::DefaultGraph,
        ),
    ]);
    for query in [
        "CONSTRUCT { <urn:s> <urn:p> <urn:a> . <urn:s> <urn:q> <urn:b> } WHERE {}",
        "DESCRIBE <urn:s> WHERE {}",
    ] {
        let budget = SortBufferBudget::new(1);
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_sort_buffer_budget(budget);
        let parsed = SparqlParser::new().parse_query(query).unwrap();
        let QueryResults::Graph(mut rows) = evaluator.prepare(&parsed).execute(&dataset).unwrap()
        else {
            panic!("graph expected");
        };
        rows.next().unwrap().unwrap();
        resource_error(
            consume(&evaluator.clone(), &format!("ASK {ORDERED_PAIR}")).unwrap_err(),
            1,
        );
        resource_error(rows.next().unwrap().unwrap_err(), 1);
        assert!(rows.next().is_none());
    }
}

#[test]
fn service_silent_cannot_hide_shared_exhaustion_at_dispatch_or_eof() {
    for lazy in [false, true] {
        let budget = SortBufferBudget::new(1);
        let calls = Arc::new(AtomicUsize::new(0));
        let shared = budget.clone();
        let evaluator = QueryEvaluator::new()
            .with_sort_buffer_budget(budget.clone())
            .with_service_handler(
                NamedNode::new_unchecked("urn:service"),
                SwallowingService {
                    exhaust: Arc::new(move || {
                        let evaluator =
                            QueryEvaluator::new().with_sort_buffer_budget(shared.clone());
                        resource_error(consume(&evaluator, DUPLICATED).unwrap_err(), 1);
                    }),
                    lazy,
                    calls: Arc::clone(&calls),
                },
            );
        resource_error(
            consume(
                &evaluator,
                "ASK { SERVICE SILENT <urn:service> { ?s ?p ?o } }",
            )
            .unwrap_err(),
            1,
        );
        assert_eq!(calls.load(Ordering::SeqCst), usize::from(lazy));
        assert_eq!(budget.charged_rows(), 1);
    }
}
