#![cfg(test)]
#![expect(
    clippy::panic,
    reason = "a wrong result variant fails the integration fixture"
)]

#[expect(
    clippy::needless_pass_by_value,
    clippy::unwrap_in_result,
    reason = "existing shared test helpers consume errors and assert fixture syntax"
)]
mod common;

use common::{SwallowingService, consume};
use oxrdf::{Dataset, Literal, NamedNode, Term};
use spareval::{
    CancellationToken, DistinctBufferBudget, InnerJoinBuildBudget, InternalQuad,
    QueryEvaluationError, QueryEvaluator, QueryResource, QueryResourcePhase, QueryResults,
    QueryableDataset, SortBufferBudget,
};
use spargebra::SparqlParser;
use std::convert::Infallible;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn resource_error(error: QueryEvaluationError, limit: u64) {
    common::resource_error(
        error,
        QueryResource::DistinctBufferRows,
        QueryResourcePhase::DistinctBuffer,
        limit,
    );
}

/// The projected values in result order, so a budgeted run can be compared
/// with the unbudgeted first-occurrence sequence.
#[expect(
    clippy::panic_in_result_fn,
    clippy::unwrap_in_result,
    reason = "invalid fixture syntax or result shape must fail independently of evaluation errors"
)]
fn values<'b>(
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

fn plain(optimized: bool) -> QueryEvaluator {
    if optimized {
        QueryEvaluator::new()
    } else {
        QueryEvaluator::new().without_optimizations()
    }
}

// Five tuples, three unique: duplicates are eliminated but never charged.
const DUPLICATED: &str = "SELECT DISTINCT ?x WHERE { VALUES ?x { 3 1 2 1 3 } }";

#[test]
fn budgeted_results_keep_first_occurrence_order_and_duplicate_elimination() {
    for optimized in [false, true] {
        let plain = plain(optimized);
        let baseline = values(&plain, DUPLICATED, &Dataset::new()).unwrap();
        assert_eq!(baseline, ["3", "1", "2"]);
        for limit in [3, 4, u64::MAX] {
            let budget = DistinctBufferBudget::new(limit);
            let evaluator = plain.clone().with_distinct_buffer_budget(budget.clone());
            assert_eq!(
                values(&evaluator, DUPLICATED, &Dataset::new()).unwrap(),
                baseline
            );
            // Only the three unique tuples were charged, never the duplicates.
            assert_eq!(budget.charged_rows(), 3);
            budget.check().unwrap();
        }
    }
}

#[test]
fn bound_and_unbound_columns_are_distinct_mappings_not_flattened_values() {
    let query = SparqlParser::new()
        .parse_query(
            "SELECT DISTINCT ?x ?y WHERE { VALUES (?x ?y) {
                (UNDEF UNDEF) (UNDEF UNDEF) (1 UNDEF)
                (1 2) (1 2) (UNDEF 2)
            } }",
        )
        .unwrap();
    let expected = vec![
        [None, None],
        [Some(Term::from(Literal::from(1))), None],
        [
            Some(Term::from(Literal::from(1))),
            Some(Term::from(Literal::from(2))),
        ],
        [None, Some(Term::from(Literal::from(2)))],
    ];
    for optimized in [false, true] {
        for limit in [None, Some(0), Some(3), Some(4)] {
            let budget = limit.map(DistinctBufferBudget::new);
            let mut evaluator = plain(optimized);
            if let Some(budget) = &budget {
                evaluator = evaluator.with_distinct_buffer_budget(budget.clone());
            }
            let dataset = Dataset::new();
            let QueryResults::Solutions(rows) =
                evaluator.prepare(&query).execute(&dataset).unwrap()
            else {
                panic!("solutions expected");
            };
            let result = rows
                .map(|row| row.map(|row| [row.get("x").cloned(), row.get("y").cloned()]))
                .collect::<Result<Vec<_>, _>>();
            if let Some(limit @ (0 | 3)) = limit {
                resource_error(result.unwrap_err(), limit);
                let budget = budget.unwrap();
                assert_eq!(budget.charged_rows(), limit);
                assert!(budget.check().is_err());
            } else {
                assert_eq!(result.unwrap(), expected);
                if let Some(budget) = budget {
                    assert_eq!(budget.charged_rows(), 4);
                    budget.check().unwrap();
                }
            }
        }
    }
}

#[test]
fn zero_exact_and_one_beyond_are_the_boundary() {
    for optimized in [false, true] {
        for limit in [0, 2, 3, 4] {
            let budget = DistinctBufferBudget::new(limit);
            let evaluator = plain(optimized).with_distinct_buffer_budget(budget.clone());
            let result = consume(&evaluator, DUPLICATED);
            if limit < 3 {
                resource_error(result.unwrap_err(), limit);
                assert!(budget.check().is_err());
                assert_eq!(budget.charged_rows(), limit);
                // The latch is sticky even for work that retains nothing.
                resource_error(
                    consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { 1 } }").unwrap_err(),
                    limit,
                );
            } else {
                assert_eq!(result.unwrap(), 3);
                assert_eq!(budget.charged_rows(), 3);
                budget.check().unwrap();
            }
        }
    }
    // Zero permits every query that retains no tuple in a native DISTINCT set.
    for optimized in [false, true] {
        let zero = DistinctBufferBudget::new(0);
        let evaluator = plain(optimized).with_distinct_buffer_budget(zero.clone());
        assert_eq!(
            consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { 1 1 2 } }").unwrap(),
            3
        );
        assert_eq!(
            consume(&evaluator, "SELECT DISTINCT ?x WHERE { VALUES ?x { } }").unwrap(),
            0
        );
        assert_eq!(
            consume(
                &evaluator,
                "SELECT ?x WHERE { VALUES ?x { 2 1 } } ORDER BY ?x"
            )
            .unwrap(),
            2
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
            consume(&evaluator, "SELECT DISTINCT ?x WHERE { VALUES ?x { 1 } }").unwrap_err(),
            0,
        );
    }
}

#[test]
fn duplicate_heavy_input_succeeds_at_the_unique_row_cap() {
    let input = (0..200)
        .map(|n| (n % 4).to_string())
        .collect::<Vec<_>>()
        .join(" ");
    let query = format!("SELECT DISTINCT ?x WHERE {{ VALUES ?x {{ {input} }} }}");
    for optimized in [false, true] {
        let budget = DistinctBufferBudget::new(4);
        let evaluator = plain(optimized).with_distinct_buffer_budget(budget.clone());
        assert_eq!(
            values(&evaluator, &query, &Dataset::new()).unwrap(),
            ["0", "1", "2", "3"]
        );
        assert_eq!(budget.charged_rows(), 4);
        budget.check().unwrap();
        let budget = DistinctBufferBudget::new(3);
        let evaluator = plain(optimized).with_distinct_buffer_budget(budget.clone());
        resource_error(consume(&evaluator, &query).unwrap_err(), 3);
        assert_eq!(budget.charged_rows(), 3);
    }
}

#[test]
fn excluded_deduplication_and_the_plain_path_charge_nothing() {
    let dataset = Dataset::from_iter([
        oxrdf::Quad::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            NamedNode::new_unchecked("urn:o"),
            oxrdf::GraphName::DefaultGraph,
        ),
        oxrdf::Quad::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:q"),
            NamedNode::new_unchecked("urn:o"),
            oxrdf::GraphName::DefaultGraph,
        ),
    ]);
    for optimized in [false, true] {
        let zero = DistinctBufferBudget::new(0);
        let evaluator = plain(optimized).with_distinct_buffer_budget(zero.clone());
        for (query, rows) in [
            // Aggregate DISTINCT accumulators are separate state.
            (
                "SELECT (COUNT(DISTINCT ?x) AS ?c) WHERE { VALUES ?x { 1 1 2 } }",
                1,
            ),
            // Property-path alternative deduplication is separate state.
            ("SELECT ?o WHERE { <urn:s> (<urn:p>|<urn:q>) ?o }", 1),
            ("SELECT ?o WHERE { <urn:s> <urn:p>? ?o }", 2),
            // GROUP BY buffers are separate state.
            ("SELECT ?x WHERE { VALUES ?x { 1 1 2 } } GROUP BY ?x", 2),
        ] {
            let parsed = SparqlParser::new().parse_query(query).unwrap();
            let QueryResults::Solutions(solutions) =
                evaluator.prepare(&parsed).execute(&dataset).unwrap()
            else {
                panic!("solutions expected");
            };
            assert_eq!(
                solutions.collect::<Result<Vec<_>, _>>().unwrap().len(),
                rows,
                "{query}"
            );
        }
        zero.check().unwrap();
        assert_eq!(zero.charged_rows(), 0);
        assert!(evaluator.distinct_buffer_budget().is_some());
    }
    // Without a budget the getter is empty and nothing is instrumented.
    assert!(QueryEvaluator::new().distinct_buffer_budget().is_none());
}

#[test]
fn reduced_is_planned_as_the_physical_hash_distinct_operator_and_charged() {
    // The upstream planner lowers REDUCED to the same physical hash DISTINCT
    // operator, so its retained tuples are charged like DISTINCT ones; the
    // consecutive-deduplication evaluator is not reached from parsed queries.
    let query = "SELECT REDUCED ?x WHERE { VALUES ?x { 1 1 2 } }";
    for optimized in [false, true] {
        let budget = DistinctBufferBudget::new(2);
        let evaluator = plain(optimized).with_distinct_buffer_budget(budget.clone());
        assert_eq!(
            values(&evaluator, query, &Dataset::new()).unwrap(),
            ["1", "2"]
        );
        assert_eq!(budget.charged_rows(), 2);
        let budget = DistinctBufferBudget::new(1);
        let evaluator = plain(optimized).with_distinct_buffer_budget(budget.clone());
        resource_error(consume(&evaluator, query).unwrap_err(), 1);
        assert_eq!(budget.charged_rows(), 1);
    }
}

#[test]
fn a_distinct_the_optimizer_removes_retains_and_charges_nothing() {
    // The optimizer folds the always-false filter into an empty plan and drops
    // the redundant DISTINCT; the unoptimized operator sees zero tuples.
    let query = "SELECT DISTINCT ?x WHERE { VALUES ?x { 1 2 } FILTER(false) }";
    for optimized in [false, true] {
        let zero = DistinctBufferBudget::new(0);
        let evaluator = plain(optimized).with_distinct_buffer_budget(zero.clone());
        assert_eq!(consume(&evaluator, query).unwrap(), 0);
        zero.check().unwrap();
        assert_eq!(zero.charged_rows(), 0);
    }
}

#[test]
fn repeated_nested_sets_and_cloned_evaluators_are_cumulative() {
    let nested = "SELECT DISTINCT ?x WHERE {
        { SELECT DISTINCT ?x WHERE { VALUES ?x { 2 1 2 } } }
    }";
    for optimized in [false, true] {
        let plain = plain(optimized);
        assert_eq!(values(&plain, nested, &Dataset::new()).unwrap(), ["2", "1"]);
        let budget = DistinctBufferBudget::new(4);
        let evaluator = plain.clone().with_distinct_buffer_budget(budget.clone());
        assert_eq!(
            values(&evaluator, nested, &Dataset::new()).unwrap(),
            ["2", "1"]
        );
        // Inner and outer sets each retained two unique tuples.
        assert_eq!(budget.charged_rows(), 4);
        budget.check().unwrap();
        // A clone shares the counter: the next retained tuple is denied.
        let clone = evaluator.clone();
        resource_error(consume(&clone, nested).unwrap_err(), 4);
        assert_eq!(budget.charged_rows(), 4);
        assert!(evaluator.distinct_buffer_budget().unwrap().check().is_err());
        assert_eq!(evaluator.distinct_buffer_budget().unwrap().limit(), 4);
    }
    // Repeated executions of one prepared query also accumulate.
    let budget = DistinctBufferBudget::new(5);
    let evaluator = QueryEvaluator::new().with_distinct_buffer_budget(budget.clone());
    let parsed = SparqlParser::new()
        .parse_query("SELECT DISTINCT ?x WHERE { VALUES ?x { 1 2 1 } }")
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
    // The fifth unique tuple is still admitted; the sixth is denied.
    rows.next().unwrap().unwrap();
    resource_error(rows.next().unwrap().unwrap_err(), 5);
    assert!(rows.next().is_none());
    assert_eq!(budget.charged_rows(), 5);
}

#[test]
fn join_sort_and_distinct_budgets_are_independent_and_typed_separately() {
    let join = InnerJoinBuildBudget::new(0);
    let sort = SortBufferBudget::new(0);
    let distinct = DistinctBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(join.clone())
        .with_sort_buffer_budget(sort.clone())
        .with_distinct_buffer_budget(distinct.clone());
    assert_eq!(
        consume(&evaluator, "SELECT ?x WHERE { VALUES ?x { 1 2 } }").unwrap(),
        2
    );
    // A distinct failure never charges or latches the join or sort counters.
    resource_error(consume(&evaluator, DUPLICATED).unwrap_err(), 0);
    join.check().unwrap();
    sort.check().unwrap();
    assert_eq!(join.charged_rows(), 0);
    assert_eq!(sort.charged_rows(), 0);
    assert_eq!(distinct.charged_rows(), 0);
    // A latched sort budget keeps reporting the sort resource before distinct.
    let sort = SortBufferBudget::new(0);
    let distinct = DistinctBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_sort_buffer_budget(sort.clone())
        .with_distinct_buffer_budget(distinct.clone());
    common::resource_error(
        consume(
            &evaluator,
            "SELECT ?x WHERE { VALUES ?x { 1 } } ORDER BY ?x",
        )
        .unwrap_err(),
        QueryResource::SortBufferRows,
        QueryResourcePhase::SortBuffer,
        0,
    );
    distinct.check().unwrap();
    common::resource_error(
        consume(&evaluator, DUPLICATED).unwrap_err(),
        QueryResource::SortBufferRows,
        QueryResourcePhase::SortBuffer,
        0,
    );
    assert_eq!(distinct.charged_rows(), 0);
    // A latched join budget keeps precedence over both later resources.
    let join = InnerJoinBuildBudget::new(0);
    let distinct = DistinctBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_inner_join_build_budget(join.clone())
        .with_distinct_buffer_budget(distinct.clone());
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
    common::resource_error(
        consume(&evaluator, DUPLICATED).unwrap_err(),
        QueryResource::InnerJoinBuildRows,
        QueryResourcePhase::JoinBuild,
        0,
    );
    assert_eq!(distinct.charged_rows(), 0);
    // A distinct budget alone leaves joins and sorts uninstrumented.
    let distinct = DistinctBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_distinct_buffer_budget(distinct.clone());
    assert_eq!(
        consume(
            &evaluator,
            "SELECT * WHERE { VALUES ?x { 1 2 } VALUES ?y { 3 } } ORDER BY ?x",
        )
        .unwrap(),
        2
    );
    assert!(evaluator.inner_join_build_budget().is_none());
    assert!(evaluator.sort_buffer_budget().is_none());
    distinct.check().unwrap();
}

#[test]
fn cancellation_keeps_precedence_over_an_intact_distinct_budget() {
    let token = CancellationToken::new();
    let budget = DistinctBufferBudget::new(0);
    let evaluator = QueryEvaluator::new()
        .with_cancellation_token(token.clone())
        .with_distinct_buffer_budget(budget.clone());
    token.cancel();
    assert!(matches!(
        consume(&evaluator, DUPLICATED),
        Err(QueryEvaluationError::Cancelled)
    ));
    budget.check().unwrap();
    assert_eq!(budget.charged_rows(), 0);
}

#[test]
fn source_errors_are_unchanged_by_the_budget() {
    let query = "SELECT DISTINCT ?x WHERE { { VALUES ?x { 1 } } UNION { SERVICE <urn:missing> { ?s ?p ?o } } }";
    let unbudgeted = consume(&QueryEvaluator::new().without_optimizations(), query).unwrap_err();
    let budget = DistinctBufferBudget::new(8);
    let evaluator = QueryEvaluator::new()
        .without_optimizations()
        .with_distinct_buffer_budget(budget.clone());
    let budgeted = consume(&evaluator, query).unwrap_err();
    assert!(
        matches!(unbudgeted, QueryEvaluationError::UnsupportedService(_)),
        "{unbudgeted:?}"
    );
    assert!(
        matches!(budgeted, QueryEvaluationError::UnsupportedService(_)),
        "{budgeted:?}"
    );
    // The retained first tuple was charged; the failure is not a resource one.
    assert_eq!(budget.charged_rows(), 1);
    budget.check().unwrap();
}

/// A term that counts every clone and every hash, so the set's behaviour on
/// retained, duplicate and denied tuples is directly observable.
#[derive(Debug)]
struct Tracked {
    value: u64,
    clones: Arc<AtomicUsize>,
    hashes: Arc<AtomicUsize>,
}

impl Clone for Tracked {
    fn clone(&self) -> Self {
        self.clones.fetch_add(1, Ordering::SeqCst);
        Self {
            value: self.value,
            clones: Arc::clone(&self.clones),
            hashes: Arc::clone(&self.hashes),
        }
    }
}

impl PartialEq for Tracked {
    fn eq(&self, other: &Self) -> bool {
        self.value == other.value
    }
}

impl Eq for Tracked {}

impl Hash for Tracked {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.hashes.fetch_add(1, Ordering::SeqCst);
        self.value.hash(state);
    }
}

/// A dataset whose pattern iterator lies about its size and counts reads.
struct TrackedDataset {
    objects: Vec<u64>,
    reads: Arc<AtomicUsize>,
    clones: Arc<AtomicUsize>,
    hashes: Arc<AtomicUsize>,
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

impl TrackedDataset {
    fn new(objects: &[u64]) -> Self {
        Self {
            objects: objects.iter().map(|value| OBJECT_BASE + value).collect(),
            reads: Arc::default(),
            clones: Arc::default(),
            hashes: Arc::default(),
        }
    }

    fn term(&self, value: u64) -> Tracked {
        Tracked {
            value,
            clones: Arc::clone(&self.clones),
            hashes: Arc::clone(&self.hashes),
        }
    }

    fn counts(&self) -> (usize, usize, usize) {
        (
            self.reads.load(Ordering::SeqCst),
            self.hashes.load(Ordering::SeqCst),
            self.clones.load(Ordering::SeqCst),
        )
    }
}

#[expect(
    clippy::unwrap_in_result,
    reason = "this synthetic dataset asserts the fixture's unsigned numeric term encoding"
)]
impl<'a> QueryableDataset<'a> for &'a TrackedDataset {
    type InternalTerm = Tracked;
    type Error = Infallible;

    fn internal_quads_for_pattern(
        &self,
        subject: Option<&Tracked>,
        predicate: Option<&Tracked>,
        object: Option<&Tracked>,
        graph_name: Option<Option<&Tracked>>,
    ) -> impl Iterator<Item = Result<InternalQuad<Tracked>, Infallible>> + use<'a> {
        let quads = if graph_name.is_none_or(|graph| graph.is_some()) {
            Vec::new()
        } else {
            self.objects
                .iter()
                .filter(|value| {
                    subject.is_none_or(|term| term.value == SUBJECT)
                        && predicate.is_none_or(|term| term.value == PREDICATE)
                        && object.is_none_or(|term| term.value == **value)
                })
                .map(|value| {
                    Ok(InternalQuad {
                        subject: self.term(SUBJECT),
                        predicate: self.term(PREDICATE),
                        object: self.term(*value),
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

    fn internalize_term(&self, term: Term) -> Result<Tracked, Infallible> {
        Ok(self.term(match term {
            Term::NamedNode(node) if node.as_str() == "urn:s" => SUBJECT,
            Term::NamedNode(node) if node.as_str() == "urn:p" => PREDICATE,
            Term::Literal(literal) => OBJECT_BASE + literal.value().parse::<u64>().unwrap(),
            _ => 0,
        }))
    }

    fn externalize_term(&self, term: Tracked) -> Result<Term, Infallible> {
        Ok(match term.value {
            SUBJECT => NamedNode::new_unchecked("urn:s").into(),
            PREDICATE => NamedNode::new_unchecked("urn:p").into(),
            value => Literal::from(i64::try_from(value - OBJECT_BASE).unwrap()).into(),
        })
    }
}

#[test]
fn denied_tuple_is_treated_like_a_duplicate_and_nothing_is_read_beyond_it() {
    let query = "SELECT DISTINCT ?o WHERE { <urn:s> <urn:p> ?o }";
    // Four tuples, three unique; the duplicate "1" sits inside the prefix.
    let objects = [3, 1, 1, 2];
    let baseline = TrackedDataset::new(&objects);
    assert_eq!(
        values(&QueryEvaluator::new(), query, &baseline).unwrap(),
        ["3", "1", "2"]
    );
    // Four rows plus the EOF read.
    let (plain_reads, _, plain_clones) = baseline.counts();
    assert_eq!(plain_reads, 5);
    for limit in [0, 1, 2, 3, 4] {
        let tracked = TrackedDataset::new(&objects);
        let budget = DistinctBufferBudget::new(limit);
        let evaluator = QueryEvaluator::new().with_distinct_buffer_budget(budget.clone());
        let result = values(&evaluator, query, &tracked);
        let (reads, hashes, clones) = tracked.counts();
        if limit < 3 {
            resource_error(result.unwrap_err(), limit);
            assert_eq!(budget.charged_rows(), limit);
            let admitted = usize::try_from(limit).unwrap();
            // The denied tuple was read, but nothing was pulled from the
            // source after it despite the inflated size hint.
            let duplicates = usize::from(limit == 2);
            let consumed = admitted + duplicates + 1;
            assert_eq!(reads, consumed, "limit {limit}");
            // A run over exactly the consumed prefix behaves identically.
            let prefix = TrackedDataset::new(&objects[..consumed]);
            let budget = DistinctBufferBudget::new(limit);
            let evaluator = QueryEvaluator::new().with_distinct_buffer_budget(budget.clone());
            resource_error(values(&evaluator, query, &prefix).unwrap_err(), limit);
            assert_eq!(prefix.counts(), (reads, hashes, clones), "limit {limit}");
            // Retaining that same prefix under a sufficient cap clones and
            // hashes strictly more: the denied tuple never entered the set.
            let retained = TrackedDataset::new(&objects[..consumed]);
            let evaluator = QueryEvaluator::new()
                .with_distinct_buffer_budget(DistinctBufferBudget::new(limit + 1));
            values(&evaluator, query, &retained).unwrap();
            let (_, retained_hashes, retained_clones) = retained.counts();
            assert!(retained_clones > clones, "limit {limit}");
            assert!(retained_hashes > hashes, "limit {limit}");
            if admitted > 0 {
                // Replacing the denied tuple with a duplicate of a retained
                // one costs exactly the same hashing and cloning: only the
                // final EOF read is added, so the denied tuple was handled
                // like a duplicate, without cloning it into the set.
                let mut with_duplicate = objects[..consumed].to_vec();
                *with_duplicate.last_mut().unwrap() = objects[0];
                let duplicate = TrackedDataset::new(&with_duplicate);
                let budget = DistinctBufferBudget::new(limit);
                let evaluator = QueryEvaluator::new().with_distinct_buffer_budget(budget.clone());
                values(&evaluator, query, &duplicate).unwrap();
                assert_eq!(budget.charged_rows(), limit);
                assert_eq!(
                    duplicate.counts(),
                    (reads + 1, hashes, clones),
                    "limit {limit}"
                );
            }
        } else {
            assert_eq!(result.unwrap(), ["3", "1", "2"]);
            assert_eq!(budget.charged_rows(), 3);
            budget.check().unwrap();
            assert_eq!(reads, plain_reads);
            // The plain path clones a duplicate before its rejected insertion;
            // the bounded path clones only the three retained tuples.
            assert_eq!(clones + 1, plain_clones);
        }
    }
}

const DISTINCT_PAIR: &str = "{ SELECT DISTINCT ?x WHERE { VALUES ?x { 1 2 1 } } }";

#[test]
fn exists_ask_union_aggregates_construct_and_describe_cannot_mask_exhaustion() {
    // DISTINCT streams: a consumer that stops after the first retained tuple
    // (ASK, EXISTS, LIMIT 1) never attempts the second unique one, so those
    // shapes are driven with a zero cap. Fully consuming shapes are also
    // checked with a cap of one, where the second unique tuple is denied.
    let partial = [
        format!("ASK {{ {DISTINCT_PAIR} UNION {{ VALUES ?ok {{ 1 }} }} }}"),
        format!("ASK {{ {{ SERVICE <urn:missing> {{ ?s ?p ?o }} }} UNION {DISTINCT_PAIR} }}"),
        format!("ASK {{ FILTER EXISTS {DISTINCT_PAIR} }}"),
        format!("ASK {{ FILTER NOT EXISTS {DISTINCT_PAIR} }}"),
        format!("SELECT (EXISTS {DISTINCT_PAIR} AS ?exists) WHERE {{}}"),
        format!("SELECT ?x WHERE {DISTINCT_PAIR} LIMIT 1"),
    ];
    let full = [
        format!("SELECT (COUNT(*) AS ?count) WHERE {DISTINCT_PAIR}"),
        // The optimizer may push this filter below DISTINCT; both tuples pass.
        format!("SELECT ?x WHERE {{ {DISTINCT_PAIR} FILTER(?x < 3) }}"),
        format!("SELECT ?x WHERE {{ {DISTINCT_PAIR} UNION {{ VALUES ?x {{ 3 }} }} }}"),
        format!("CONSTRUCT {{ <urn:s> <urn:p> ?x }} WHERE {DISTINCT_PAIR}"),
        "DESCRIBE ?x WHERE { { SELECT DISTINCT ?x WHERE { VALUES ?x { <urn:a> <urn:b> } } } }"
            .to_owned(),
    ];
    for (query, limit) in partial
        .iter()
        .chain(&full)
        .map(|query| (query, 0))
        .chain(full.iter().map(|query| (query, 1)))
    {
        for optimized in [false, true] {
            let budget = DistinctBufferBudget::new(limit);
            let evaluator = plain(optimized).with_distinct_buffer_budget(budget.clone());
            let result = consume(&evaluator, query);
            assert!(result.is_err(), "{query} limit {limit}: {result:?}");
            resource_error(result.unwrap_err(), limit);
            assert_eq!(budget.charged_rows(), limit, "{query}");
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
        let budget = DistinctBufferBudget::new(1);
        let evaluator = QueryEvaluator::new()
            .without_optimizations()
            .with_distinct_buffer_budget(budget);
        let parsed = SparqlParser::new().parse_query(query).unwrap();
        let QueryResults::Graph(mut rows) = evaluator.prepare(&parsed).execute(&dataset).unwrap()
        else {
            panic!("graph expected");
        };
        rows.next().unwrap().unwrap();
        resource_error(
            consume(
                &evaluator.clone(),
                &format!("SELECT (COUNT(*) AS ?count) WHERE {DISTINCT_PAIR}"),
            )
            .unwrap_err(),
            1,
        );
        resource_error(rows.next().unwrap().unwrap_err(), 1);
        assert!(rows.next().is_none());
    }
}

#[test]
fn service_silent_cannot_hide_shared_exhaustion_at_dispatch_or_eof() {
    for lazy in [false, true] {
        let budget = DistinctBufferBudget::new(1);
        let calls = Arc::new(AtomicUsize::new(0));
        let shared = budget.clone();
        let evaluator = QueryEvaluator::new()
            .with_distinct_buffer_budget(budget.clone())
            .with_service_handler(
                NamedNode::new_unchecked("urn:service"),
                SwallowingService {
                    exhaust: Arc::new(move || {
                        let evaluator =
                            QueryEvaluator::new().with_distinct_buffer_budget(shared.clone());
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
