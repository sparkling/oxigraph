use super::*;
use oxdatalog::CancellationToken;
use oxrdf::BlankNode;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;

#[derive(Default)]
struct Probe {
    seen: AtomicUsize,
    stop_at: AtomicUsize,
}

impl Probe {
    fn arm(&self, stop_at: usize) {
        self.seen.store(0, Ordering::Relaxed);
        self.stop_at.store(stop_at, Ordering::Relaxed);
    }
}

fn controlled_options() -> (Rdfs12Options, Arc<Probe>) {
    let probe = Arc::new(Probe::default());
    probe.arm(usize::MAX);
    let callback = Arc::clone(&probe);
    let mut options = Rdfs12Options {
        container_membership_limit: 0,
        ..Rdfs12Options::default()
    };
    options.evaluation.limits.timeout = None;
    options.evaluation.cancellation_token =
        CancellationToken::new().with_cancellation_check(move || {
            callback.seen.fetch_add(1, Ordering::Relaxed) + 1
                >= callback.stop_at.load(Ordering::Relaxed)
        });
    (options, probe)
}

fn fixture() -> Dataset {
    let mut result = Dataset::new();
    for index in 0..32 {
        result.insert(Quad::new(
            NamedNode::new(format!("urn:subject:{index}")).unwrap(),
            NamedNode::new("urn:predicate").unwrap(),
            NamedNode::new("urn:object").unwrap(),
            GraphName::DefaultGraph,
        ));
    }
    result.insert_named_graph(BlankNode::new("empty-graph").unwrap());
    result
}

fn assert_cancelled<T>(result: Result<T, Rdfs12Error>) {
    assert!(matches!(
        result,
        Err(Rdfs12Error::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::Cancelled
        )))
    ));
    drop(result);
}

fn assert_phase_cancellable(phase: impl Fn(&mut Runtime<'_>) -> Result<(), Rdfs12Error>) {
    let source = fixture();
    let original = source.clone();
    let (options, probe) = controlled_options();
    let mut runtime = Runtime::new(&source, &options).unwrap();
    probe.arm(usize::MAX);
    phase(&mut runtime).unwrap();
    let checks = probe.seen.load(Ordering::Relaxed);
    assert!(checks > source.len(), "phase skipped raw input checkpoints");
    for stop_at in [1, checks / 2, checks] {
        let (options, probe) = controlled_options();
        let mut runtime = Runtime::new(&source, &options).unwrap();
        probe.arm(stop_at);
        assert_cancelled(phase(&mut runtime));
        assert_eq!(probe.seen.load(Ordering::Relaxed), stop_at);
        assert_eq!(source, original);
    }
}

#[test]
fn preflight_and_both_snapshot_copies_are_cancellable() {
    let source = fixture();
    let original = source.clone();
    let (options, probe) = controlled_options();
    Runtime::new(&source, &options).unwrap();
    let checks = probe.seen.load(Ordering::Relaxed);
    // Exercise every preflight/copy/accounting checkpoint, without timing races.
    for stop_at in 1..=checks {
        let (options, probe) = controlled_options();
        probe.arm(stop_at);
        assert_cancelled(Runtime::new(&source, &options));
        assert_eq!(probe.seen.load(Ordering::Relaxed), stop_at);
        assert_eq!(source, original);
    }
}

#[test]
#[expect(
    clippy::redundant_closure_for_method_calls,
    reason = "method item does not satisfy the higher-ranked Runtime lifetime"
)]
fn snapshot_copy_and_seed_preserve_empty_graphs_and_cancel() {
    assert_phase_cancellable(|runtime| {
        let copy = runtime.copy_dataset(&runtime.base)?;
        assert_eq!(copy, runtime.base);
        assert_eq!(
            copy.iter().collect::<Vec<_>>(),
            runtime.base.iter().collect::<Vec<_>>()
        );
        assert!(copy.contains_named_graph(&BlankNode::new("empty-graph").unwrap()));
        Ok(())
    });
    assert_phase_cancellable(|runtime| runtime.seed());
}

#[test]
#[expect(
    clippy::redundant_closure_for_method_calls,
    reason = "method item does not satisfy the higher-ranked Runtime lifetime"
)]
fn collection_no_match_consistency_output_and_accounting_cancel() {
    assert_phase_cancellable(|runtime| runtime.collect(runtime.all.iter()).map(|_| ()));
    assert_phase_cancellable(|runtime| runtime.detect_datatype_inconsistency().map(|_| ()));
    assert_phase_cancellable(|runtime| runtime.inference().map(|_| ()));
    assert_phase_cancellable(|runtime| runtime.observe_memory());
}

#[test]
fn sparse_cross_graph_binary_scan_checks_unmatched_candidates_without_charging_rows() {
    let mut quads = Vec::new();
    for index in 0..32 {
        quads.push(Quad::new(
            NamedNode::new(format!("urn:property:{index}")).unwrap(),
            rdfs::DOMAIN,
            NamedNode::new("urn:Class").unwrap(),
            NamedNode::new(format!("urn:graph:{index}")).unwrap(),
        ));
    }
    let (options, probe) = controlled_options();
    let mut runtime = Runtime::new(&Dataset::new(), &options).unwrap();
    probe.arm(usize::MAX);
    runtime.apply_binary_patterns(&quads).unwrap();
    assert_eq!(runtime.intermediate_rows, quads.len());
    assert!(runtime.all.is_empty());
    let checks = probe.seen.load(Ordering::Relaxed);
    assert!(checks > quads.len() * quads.len());
    let (options, probe) = controlled_options();
    let mut runtime = Runtime::new(&Dataset::new(), &options).unwrap();
    probe.arm(checks / 2);
    assert_cancelled(runtime.apply_binary_patterns(&quads));
    assert_eq!(probe.seen.load(Ordering::Relaxed), checks / 2);
    assert!(runtime.intermediate_rows < quads.len());
}

#[test]
fn container_axiom_generation_cancels_before_building_the_full_range() {
    let (options, probe) = controlled_options();
    let runtime = Runtime::new(&Dataset::new(), &options).unwrap();
    let mut axioms = Dataset::new();
    probe.arm(10);
    assert_cancelled(insert_container_axioms(
        &mut axioms,
        &GraphName::DefaultGraph,
        usize::MAX,
        || runtime.check(),
    ));
    assert_eq!(axioms.len(), 24);
}

#[test]
fn successful_controls_preserve_closure_provenance_and_memory_estimate() {
    let source = fixture();
    let (mut controlled, _) = controlled_options();
    controlled.evaluation.track_provenance = true;
    let mut ordinary = controlled.clone();
    ordinary.evaluation.cancellation_token = CancellationToken::new();
    let expected = Rdfs12Finite.evaluate(&source, &ordinary).unwrap();
    let actual = Rdfs12Finite.evaluate(&source, &controlled).unwrap();
    assert_eq!(actual.base, expected.base);
    assert_eq!(actual.inference, expected.inference);
    assert_eq!(actual.entailed, expected.entailed);
    // Hash iteration can choose different first derivations across runs; each
    // derivation must still exist and retain its exact conclusion.
    assert_eq!(actual.derivations.len(), expected.derivations.len());
    assert_eq!(actual.consistency, expected.consistency);
    assert_eq!(actual.receipt(), expected.receipt());
    assert_eq!(actual.iterations, expected.iterations);
    assert_eq!(
        actual.peak_estimated_memory_bytes,
        expected.peak_estimated_memory_bytes
    );
    let mut runtime = Runtime::new(&source, &controlled).unwrap();
    let expected_bytes = source
        .iter()
        .map(|quad| 160 + quad.to_string().len())
        .sum::<usize>();
    assert_eq!(runtime.peak_memory, expected_bytes);
    runtime.observe_memory().unwrap();
    assert_eq!(runtime.intermediate_rows, 0);
}

#[test]
fn relative_timeout_starts_before_preflight_and_retains_time_error() {
    let (mut options, _) = controlled_options();
    options.evaluation.limits.timeout = Some(Duration::ZERO);
    assert!(matches!(
        Runtime::new(&fixture(), &options),
        Err(Rdfs12Error::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Time,
                ..
            }
        )))
    ));
}

#[test]
fn elapsed_relative_budget_stops_a_no_match_phase_with_typed_time_error() {
    let (mut options, _) = controlled_options();
    options.evaluation.limits.timeout = Some(Duration::from_secs(1));
    let mut runtime = Runtime::new(&fixture(), &options).unwrap();
    runtime.started = Instant::now().checked_sub(Duration::from_secs(2)).unwrap();
    assert!(matches!(
        runtime.inference(),
        Err(Rdfs12Error::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Time,
                limit: 1000,
            }
        )))
    ));
    assert_eq!(runtime.intermediate_rows, 0);
}
