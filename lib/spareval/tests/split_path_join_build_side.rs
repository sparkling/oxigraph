//! Regression for fuzz artifact `sparql_query_eval/oom-1007e2363b10d32274268b884b4bc2ef68bd4a7a`.
//!
//! Repeated copies of one split property path over the same subject make the
//! greedy planner chain the fan-out scans first. Every nullable path piece
//! then has to stay a hash join, and building it from the accumulated output
//! materialized millions of rows although the query has no solution.
#![cfg(test)]

use oxrdf::vocab::xsd;
use oxrdf::{Dataset, GraphName, Literal, NamedNode, Quad, Term};
use spareval::{
    BoundedJoinCostModel, BoundedJoinPlanning, InnerJoinBuildBudget, QueryEvaluator, QueryResults,
};
use spargebra::SparqlParser;
use std::collections::BTreeMap;
use std::error::Error;

const PLANNING_MODES: [Option<BoundedJoinCostModel>; 5] = [
    None,
    Some(BoundedJoinCostModel::IndependentV1),
    Some(BoundedJoinCostModel::ConditionalV2),
    Some(BoundedJoinCostModel::CorrelatedV3),
    Some(BoundedJoinCostModel::DomainAwareV4),
];

/// Six copies of the fuzz artifact's path keep the streamed fan-out small.
const PATH: &str = "<http://example.org/5> / ^<http://example.org/2>? / <http://example.org/1>? / <http://example.org/1>? / <http://example.org/1>";

fn ex(n: u8) -> NamedNode {
    NamedNode::new_unchecked(format!("http://example.org/{n}"))
}

fn literal(value: &str, datatype: NamedNode) -> Term {
    Literal::new_typed_literal(value.to_owned(), datatype).into()
}

/// The default graph of `sparql_smith::DATA_TRIG`.
fn dataset() -> Dataset {
    let mut dataset = Dataset::new();
    let mut add = |subject: u8, predicate: u8, object: Term| {
        dataset.insert(Quad::new(
            ex(subject),
            ex(predicate),
            object,
            GraphName::DefaultGraph,
        ));
    };
    add(1, 2, ex(3).into());
    add(1, 2, ex(4).into());
    add(1, 5, literal("true", xsd::BOOLEAN));
    add(1, 5, literal("1", xsd::INTEGER));
    add(1, 5, literal("1", xsd::DECIMAL));
    add(1, 5, literal("1.0E0", xsd::DOUBLE));
    add(3, 2, ex(4).into());
    add(3, 5, literal("false", xsd::BOOLEAN));
    add(3, 5, literal("0", xsd::INTEGER));
    add(3, 5, literal("0", xsd::DECIMAL));
    add(3, 5, literal("0.0E0", xsd::DOUBLE));
    dataset
}

fn ask(evaluator: &QueryEvaluator, dataset: &Dataset) -> Result<bool, Box<dyn Error>> {
    let query = SparqlParser::new()
        .parse_query(&format!("ASK WHERE {{ ?3 {PATH} ?4, ?4, ?4, ?4, ?4, ?1 }}"))?;
    match evaluator.prepare(&query).execute(dataset)? {
        QueryResults::Boolean(value) => Ok(value),
        _ => Err("ASK query must return a boolean".into()),
    }
}

#[test]
fn repeated_split_paths_do_not_materialize_the_fan_out() {
    let dataset = dataset();
    assert!(!ask(&QueryEvaluator::new().without_optimizations(), &dataset).unwrap());
    for planning in PLANNING_MODES {
        // Two subjects with four objects each fan out to 2 * 4^6 rows.
        let budget = InnerJoinBuildBudget::new(1_024);
        let mut evaluator = QueryEvaluator::new().with_inner_join_build_budget(budget.clone());
        if let Some(model) = planning {
            evaluator = evaluator
                .with_bounded_join_planning(BoundedJoinPlanning::default().with_cost_model(model));
        }
        assert_eq!(
            ask(&evaluator, &dataset).map_err(|e| e.to_string()),
            Ok(false),
            "{planning:?}"
        );
        assert!(budget.charged_rows() < 1_024, "{planning:?}");
    }
}

#[test]
fn smaller_path_build_preserves_the_solution_bag() {
    let node = |iri| NamedNode::new_unchecked(iri);
    let dataset = Dataset::from_iter(["urn:a", "urn:b"].map(|object| {
        Quad::new(
            node("urn:s"),
            node("urn:p"),
            node(object),
            GraphName::DefaultGraph,
        )
    }));
    fn solution_bag(
        evaluator: QueryEvaluator,
        dataset: &Dataset,
    ) -> Result<BTreeMap<String, usize>, Box<dyn Error>> {
        let query = SparqlParser::new().parse_query(
            "SELECT ?x WHERE { ?s <urn:p> ?o1 . ?s <urn:p> ?o2 . ?s <urn:p> ?o3 . ?s <urn:p> ?o4 . ?s <urn:p> ?o5 . ?x <urn:q>? ?o1 }",
        )?;
        let QueryResults::Solutions(solutions) = evaluator.prepare(&query).execute(dataset)? else {
            return Err("expected SELECT solutions".into());
        };
        let mut bag = BTreeMap::new();
        for solution in solutions {
            let solution = solution?;
            let value = solution.get("x").ok_or("unbound ?x")?.to_string();
            *bag.entry(value).or_insert(0) += 1;
        }
        Ok(bag)
    }
    // Five independent two-row choices produce 32 solutions, not two distinct
    // values. The absent q predicate contributes only graph-node identities.
    let expected = BTreeMap::from([("<urn:a>".to_owned(), 16), ("<urn:b>".to_owned(), 16)]);
    assert_eq!(
        solution_bag(QueryEvaluator::new().without_optimizations(), &dataset).unwrap(),
        expected
    );
    for planning in PLANNING_MODES {
        let mut evaluator = QueryEvaluator::new();
        if let Some(model) = planning {
            evaluator = evaluator
                .with_bounded_join_planning(BoundedJoinPlanning::default().with_cost_model(model));
        }
        assert_eq!(
            solution_bag(evaluator, &dataset).unwrap(),
            expected,
            "{planning:?}"
        );
    }
}
