use super::*;
use crate::Rdfs12Options;
use oxdatalog::{CancellationToken, EvaluationError, rdf::RdfEvaluationError};
use oxrdf::{Dataset, GraphName};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[test]
fn checked_reason_order_matches_stable_sort_and_adjacent_dedup() {
    let first = Quad::new(rdf::TYPE, rdf::TYPE, rdf::PROPERTY, GraphName::DefaultGraph);
    let second = Quad::new(rdfs::CLASS, rdf::TYPE, rdfs::CLASS, GraphName::DefaultGraph);
    let a = reason("a", std::slice::from_ref(&first));
    let b = reason("b", std::slice::from_ref(&first));
    let c = reason("c", std::slice::from_ref(&second));
    let reasons = vec![c.clone(), a.clone(), a.clone(), b, a, c];
    let mut expected = reasons.clone();
    expected.sort_by_key(|item| {
        item.evidence
            .first()
            .map_or_else(String::new, ToString::to_string)
    });
    expected.dedup();
    let options = Rdfs12Options::default();
    let runtime = Runtime::new(&Dataset::new(), &options).unwrap();
    assert_eq!(runtime.order_reasons(reasons).unwrap(), expected);
}

#[test]
fn reason_grouping_and_flattening_are_cancellable() {
    let evidence = Quad::new(rdf::TYPE, rdf::TYPE, rdf::PROPERTY, GraphName::DefaultGraph);
    let reasons = vec![reason("same-key", &[evidence]); 128];
    // First point interrupts grouping; second interrupts equal-key flattening.
    for stop_at in [64, 160] {
        let checks = Arc::new(AtomicUsize::new(usize::MAX));
        let signal = Arc::clone(&checks);
        let mut options = Rdfs12Options::default();
        options.evaluation.cancellation_token =
            CancellationToken::new().with_cancellation_check(move || {
                signal
                    .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |left| {
                        if left == usize::MAX {
                            None
                        } else {
                            Some(left.saturating_sub(1))
                        }
                    })
                    .is_ok_and(|left| left <= 1)
            });
        let runtime = Runtime::new(&Dataset::new(), &options).unwrap();
        checks.store(stop_at, Ordering::Relaxed);
        assert!(matches!(
            runtime.order_reasons(reasons.clone()),
            Err(Rdfs12Error::Evaluation(RdfEvaluationError::Evaluation(
                EvaluationError::Cancelled
            )))
        ));
        assert_eq!(checks.load(Ordering::Relaxed), 0);
    }
}
