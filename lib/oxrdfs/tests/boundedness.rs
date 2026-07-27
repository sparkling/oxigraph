#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise public boundedness contracts"
)]

use oxdatalog::{
    EvaluationError, EvaluationLimits, EvaluationOptions, LimitKind, rdf::RdfEvaluationError,
};
use oxrdf::{Dataset, GraphName, NamedNode, Quad, vocab::rdfs};
use oxrdfs::{RdfsD0, RdfsD0Error};

fn node(name: &str) -> NamedNode {
    NamedNode::new(format!("http://example.com/{name}")).unwrap()
}

#[test]
fn ranged_subproperty_closure_obeys_the_memory_limit() {
    let first = node("p0");
    let second = node("p1");
    let third = node("p2");
    let class = node("Class");
    let base = Dataset::from_iter([
        Quad::new(
            first,
            rdfs::SUB_PROPERTY_OF,
            second.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            second,
            rdfs::SUB_PROPERTY_OF,
            third.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(third, rdfs::RANGE, class, GraphName::DefaultGraph),
    ]);
    let error = RdfsD0::new()
        .evaluate(
            &base,
            &EvaluationOptions {
                limits: EvaluationLimits {
                    max_memory_bytes: 500,
                    ..EvaluationLimits::default()
                },
                ..EvaluationOptions::default()
            },
        )
        .unwrap_err();

    assert!(matches!(
        error,
        RdfsD0Error::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Memory,
                limit: 500,
            }
        ))
    ));
}
