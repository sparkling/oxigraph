use super::*;
use oxdatalog::CancellationToken;
use oxrdf::{BlankNode, Literal, vocab::xsd};
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

fn controlled_options() -> (Owl2RlRdfOptions, Arc<Probe>) {
    let probe = Arc::new(Probe::default());
    probe.arm(usize::MAX);
    let signal = Arc::clone(&probe);
    let mut options = Owl2RlRdfOptions::default();
    options.evaluation.limits.timeout = None;
    options.evaluation.cancellation_token =
        CancellationToken::new().with_cancellation_check(move || {
            signal.seen.fetch_add(1, Ordering::Relaxed) + 1
                >= signal.stop_at.load(Ordering::Relaxed)
        });
    (options, probe)
}

fn fixture() -> Dataset {
    let mut source = Dataset::new();
    for index in 0..16 {
        source.insert(Quad::new(
            NamedNode::new(format!("urn:s:{index}")).unwrap(),
            NamedNode::new("urn:p").unwrap(),
            Literal::new_typed_literal(index.to_string(), xsd::INTEGER),
            GraphName::DefaultGraph,
        ));
    }
    source.insert_named_graph(BlankNode::new("empty-graph").unwrap());
    source
}

fn assert_cancelled<T>(result: Result<T, Owl2RlRdfError>) {
    assert!(matches!(
        result,
        Err(Owl2RlRdfError::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::Cancelled
        )))
    ));
    drop(result);
}

fn assert_phase_cancellable(phase: impl Fn(&mut Runtime<'_>) -> Result<(), Owl2RlRdfError>) {
    let source = fixture();
    let original = source.clone();
    let (options, probe) = controlled_options();
    let mut runtime = Runtime::new(&source, &options).unwrap();
    probe.arm(usize::MAX);
    phase(&mut runtime).unwrap();
    let checks = probe.seen.load(Ordering::Relaxed);
    assert!(checks > source.len(), "phase omitted candidate checkpoints");
    for stop_at in [1, checks / 2] {
        let (options, probe) = controlled_options();
        let mut runtime = Runtime::new(&source, &options).unwrap();
        probe.arm(stop_at);
        assert_cancelled(phase(&mut runtime));
        assert_eq!(probe.seen.load(Ordering::Relaxed), stop_at);
        assert_eq!(source, original);
    }
}

#[test]
fn every_preflight_and_snapshot_checkpoint_cancels_without_changing_input() {
    let source = fixture();
    let original = source.clone();
    let (options, probe) = controlled_options();
    let runtime = Runtime::new(&source, &options).unwrap();
    assert_eq!(
        runtime.base.iter().collect::<Vec<_>>(),
        source.iter().collect::<Vec<_>>()
    );
    assert_eq!(
        runtime.all.iter().collect::<Vec<_>>(),
        source.iter().collect::<Vec<_>>()
    );
    assert_eq!(
        runtime.base.named_graphs().collect::<Vec<_>>(),
        source.named_graphs().collect::<Vec<_>>()
    );
    let checks = probe.seen.load(Ordering::Relaxed);
    for stop_at in 1..=checks {
        let (options, probe) = controlled_options();
        probe.arm(stop_at);
        assert_cancelled(Runtime::new(&source, &options));
        assert_eq!(probe.seen.load(Ordering::Relaxed), stop_at);
        assert_eq!(source, original);
    }
}

#[test]
fn class_schema_property_and_contradiction_no_match_scans_cancel() {
    assert_phase_cancellable(|runtime| {
        runtime.apply_classes()?;
        Ok(())
    });
    assert_phase_cancellable(|runtime| {
        runtime.apply_schema()?;
        Ok(())
    });
    assert_phase_cancellable(|runtime| {
        runtime.apply_properties()?;
        Ok(())
    });
    assert_phase_cancellable(|runtime| {
        runtime.detect_contradictions()?;
        Ok(())
    });
}

#[test]
fn equality_datatypes_semantics_and_datalog_phases_cancel() {
    assert_phase_cancellable(|runtime| {
        runtime.apply_equality()?;
        Ok(())
    });
    assert_phase_cancellable(|runtime| {
        runtime.apply_datatypes()?;
        Ok(())
    });
    assert_phase_cancellable(|runtime| {
        runtime.apply_rdf_based_semantics()?;
        Ok(())
    });
    assert_phase_cancellable(|runtime| {
        runtime.apply_datalog_core()?;
        Ok(())
    });
}

// A successful no-match phase must observe quadratic raw candidate work.
// Merely cancelling while checked_collect copies the input cannot pass this
// assertion: removing the inner checks leaves only linear outer-loop checks.
fn assert_guarded_no_match_scan(
    source: &Dataset,
    phase: impl Fn(&mut Runtime<'_>) -> Result<(), Owl2RlRdfError>,
) {
    let (options, probe) = controlled_options();
    let mut runtime = Runtime::new(source, &options).unwrap();
    probe.arm(usize::MAX);
    phase(&mut runtime).unwrap();
    let checks = probe.seen.load(Ordering::Relaxed);
    assert!(checks >= source.len() * source.len() / 2);
    assert_eq!(runtime.all, *source);
    assert_eq!(runtime.intermediate_rows, 0);
    for stop_at in [checks / 3, 2 * checks / 3] {
        assert!(stop_at > source.len() + 2, "must pass input collection");
        let (options, probe) = controlled_options();
        let mut runtime = Runtime::new(source, &options).unwrap();
        probe.arm(stop_at);
        assert_cancelled(phase(&mut runtime));
        assert_eq!(probe.seen.load(Ordering::Relaxed), stop_at);
        assert_eq!(runtime.all, *source);
        assert_eq!(runtime.intermediate_rows, 0);
    }
}

#[test]
fn guarded_class_schema_consistency_and_witness_scans_check_raw_no_matches() {
    use crate::vocabulary::{DISJOINT_WITH, IRREFLEXIVE_PROPERTY, ON_PROPERTY};
    for kind in 0..4 {
        let mut source = Dataset::new();
        for index in 0..32 {
            let (predicate, object) = match kind {
                0 => (
                    ON_PROPERTY,
                    NamedNode::new(format!("urn:property:{index}")).unwrap(),
                ),
                1 => (rdf::TYPE, IRREFLEXIVE_PROPERTY),
                2 => (
                    DISJOINT_WITH,
                    NamedNode::new(format!("urn:class:{index}")).unwrap(),
                ),
                _ => (
                    NamedNode::new("urn:noise").unwrap(),
                    NamedNode::new("urn:o").unwrap(),
                ),
            };
            source.insert(Quad::new(
                NamedNode::new(format!("urn:declaration:{index}")).unwrap(),
                predicate,
                object,
                GraphName::DefaultGraph,
            ));
            source.insert(Quad::new(
                NamedNode::new(format!("urn:unrelated:{index}")).unwrap(),
                NamedNode::new("urn:unrelated-p").unwrap(),
                NamedNode::new("urn:unrelated-o").unwrap(),
                NamedNode::new("urn:other-graph").unwrap(),
            ));
        }
        let quads = source.iter().collect::<Vec<_>>();
        assert_guarded_no_match_scan(&source, |runtime| match kind {
            0 => runtime.apply_classes(),
            1 => runtime.detect_contradictions(),
            2 => runtime.semantic_complements(&quads),
            _ => runtime.apply_schema(),
        });
    }
}

#[test]
fn semantic_witnesses_cancel_inside_ordered_nonmatching_inner_candidates() {
    use crate::vocabulary::DISJOINT_WITH;
    let source = fixture();
    for predicate in [DISJOINT_WITH, oxrdf::vocab::rdfs::RANGE] {
        let mut quads = vec![Quad::new(
            NamedNode::new("urn:left").unwrap(),
            predicate.clone(),
            NamedNode::new("urn:right").unwrap(),
            GraphName::DefaultGraph,
        )];
        quads.extend(source.iter());
        let (options, probe) = controlled_options();
        let mut runtime = Runtime::new(&source, &options).unwrap();
        // One outer check then raw inner checks: the eighth callback is
        // necessarily inside the no-match scan, not input collection.
        probe.arm(8);
        let result = if predicate == DISJOINT_WITH {
            runtime.semantic_complements(&quads)
        } else {
            runtime.semantic_datatype_ranges(&quads)
        };
        assert_cancelled(result);
        assert_eq!(probe.seen.load(Ordering::Relaxed), 8);
        assert_eq!(runtime.all, source);
        assert_eq!(runtime.intermediate_rows, 0);
    }
}

#[test]
fn seed_output_and_memory_accounting_cancel() {
    assert_phase_cancellable(|runtime| {
        runtime.seed()?;
        Ok(())
    });
    assert_phase_cancellable(|runtime| runtime.inference().map(|_| ()));
    assert_phase_cancellable(|runtime| {
        runtime.observe_memory()?;
        Ok(())
    });
}

#[test]
fn checked_find_any_and_sort_cover_no_match_empty_input_and_stable_ties() {
    let (options, probe) = controlled_options();
    let runtime = Runtime::new(&Dataset::new(), &options).unwrap();
    let values = (0..128)
        .rev()
        .map(|index| (index % 5, index))
        .collect::<Vec<_>>();
    let mut expected = values.clone();
    expected.sort_by_key(|item| item.0);
    assert_eq!(
        runtime
            .checked_sort_by_key(values.clone(), |item| item.0)
            .unwrap(),
        expected
    );
    assert!(runtime.checked_find(&values, |_| false).unwrap().is_none());
    assert!(!runtime.checked_any(&values, |_| false).unwrap());
    probe.arm(16);
    assert_cancelled(runtime.checked_find(&values, |_| false));
    assert_cancelled(runtime.checked_collect(std::iter::empty::<usize>()));
    for stop_at in [64, 160] {
        let (options, probe) = controlled_options();
        let runtime = Runtime::new(&Dataset::new(), &options).unwrap();
        probe.arm(stop_at);
        assert_cancelled(runtime.checked_sort_by_key(values.clone(), |item| item.0));
        assert_eq!(probe.seen.load(Ordering::Relaxed), stop_at);
    }
}

#[test]
fn list_cell_full_dataset_scan_and_contradiction_dedup_cancel() {
    let source = fixture();
    let (options, probe) = controlled_options();
    let mut runtime = Runtime::new(&source, &options).unwrap();
    probe.arm(8);
    assert_cancelled(runtime.list(
        &Term::from(NamedNode::new("urn:missing-list").unwrap()),
        &GraphName::DefaultGraph,
    ));
    let (options, probe) = controlled_options();
    let mut runtime = Runtime::new(&source, &options).unwrap();
    for quad in &source {
        runtime.contradiction("fixture", &[quad]).unwrap();
    }
    probe.arm(8);
    assert_cancelled(runtime.contradiction("no-match", &[]));
    assert_eq!(runtime.intermediate_rows, 0);
}

#[test]
fn cooperative_clone_preserves_first_property_match_and_encoded_order() {
    let mut source = fixture();
    let restriction = NamedNode::new("urn:restriction").unwrap();
    for index in 0..32 {
        source.insert(Quad::new(
            restriction.clone(),
            crate::vocabulary::ON_PROPERTY,
            NamedNode::new(format!("urn:property:{index}")).unwrap(),
            GraphName::DefaultGraph,
        ));
    }
    let first = source
        .iter()
        .find(|quad| quad.predicate == crate::vocabulary::ON_PROPERTY)
        .unwrap();
    let (options, _) = controlled_options();
    for _ in 0..8 {
        let runtime = Runtime::new(&source, &options).unwrap();
        let actual = runtime
            .checked_find(runtime.all.iter(), |quad| {
                quad.predicate == crate::vocabulary::ON_PROPERTY
            })
            .unwrap()
            .unwrap();
        assert_eq!(actual, first);
        assert_eq!(
            runtime.all.iter().collect::<Vec<_>>(),
            source.iter().collect::<Vec<_>>()
        );
    }
}

#[test]
fn successful_controls_preserve_closure_and_resource_accounting() {
    let mut source = Dataset::new();
    source.insert(Quad::new(
        NamedNode::new("urn:s").unwrap(),
        NamedNode::new("urn:p").unwrap(),
        NamedNode::new("urn:o").unwrap(),
        GraphName::DefaultGraph,
    ));
    source.insert_named_graph(BlankNode::new("empty").unwrap());
    let (mut options, _) = controlled_options();
    options.evaluation.track_provenance = true;
    let mut ordinary = options.clone();
    ordinary.evaluation.cancellation_token = CancellationToken::new();
    let expected = Owl2RlRdf.evaluate(&source, &ordinary).unwrap();
    let actual = Owl2RlRdf.evaluate(&source, &options).unwrap();
    assert_eq!(actual.base, expected.base);
    assert_eq!(actual.entailed, expected.entailed);
    assert_eq!(actual.inference, expected.inference);
    assert_eq!(actual.equality_facts, expected.equality_facts);
    assert_eq!(actual.generalized_facts, expected.generalized_facts);
    assert_eq!(actual.consistency, expected.consistency);
    assert_eq!(actual.receipt(), expected.receipt());
    let runtime = Runtime::new(&source, &options).unwrap();
    let expected_bytes = source
        .iter()
        .map(|quad| 160 + quad.to_string().len())
        .sum::<usize>();
    assert_eq!(runtime.runtime_memory_estimate().unwrap(), expected_bytes);
    assert_eq!(runtime.intermediate_rows, 0);
}

#[test]
fn relative_timeout_is_typed_at_entry_and_after_preparation() {
    let (mut options, _) = controlled_options();
    options.evaluation.limits.timeout = Some(Duration::ZERO);
    assert!(matches!(
        Runtime::new(&fixture(), &options),
        Err(Owl2RlRdfError::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Time,
                ..
            }
        )))
    ));
    options.evaluation.limits.timeout = Some(Duration::from_secs(1));
    let mut runtime = Runtime::new(&fixture(), &options).unwrap();
    runtime.started = Instant::now().checked_sub(Duration::from_secs(2)).unwrap();
    assert!(matches!(
        runtime.inference(),
        Err(Owl2RlRdfError::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Time,
                limit: 1000
            }
        )))
    ));
}
