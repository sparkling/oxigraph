#![cfg(feature = "w3c-tests")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public checked-compilation boundary"
)]

//! Locally corrected copies of two malformed fixtures in the pinned
//! `w3c/data-shapes` SHACL 1.2 suite (commit `eedda09f`).
//!
//! The pinned upstream files cannot be executed at all:
//!
//! - `core/node/in-003.ttl` references `shsh:inSubjectsShape` and
//!   `shsh:inSubjectsShapeInPropertyShape` without declaring `@prefix shsh:`,
//!   so it is not parseable Turtle. The terms are legitimate —
//!   `http://www.w3.org/ns/shacl-shacl#` really does define both — so the
//!   fixture's intent is sound and one missing line is the whole defect.
//! - `core/node/in-002.ttl` types its instance as `ex:TestShape` and expects a
//!   result citing `sh:sourceShape ex:TestShape`, but only defines
//!   `ex:TestInUnsatisfiableShape`. Sibling `in-001.ttl` shows the intended
//!   pattern: the shape carries the same name the instances are typed with, so
//!   it is its own implicit class target.
//!
//! The corrected copies in `fixtures/upstream-corrections/` differ from the
//! pinned bytes by exactly one line each. They are **local corrections, not
//! upstream evidence**: the W3C runner still excludes both originals by exact
//! content hash, so this file adds coverage without ever letting a repaired
//! fixture masquerade as a passing upstream case. If upstream fixes the files,
//! the runner's hash exclusions break loudly and both can be retired together.

use oxrdf::{Dataset, GraphName, NamedNode, Quad, Term};
use oxshacl::{GraphSnapshot, ProfileSet, ShapesGraph, ValidationOptions, validate};
use oxttl::TurtleParser;

const SH: &str = "http://www.w3.org/ns/shacl#";
const EX_TEST_SHAPE: &str = "http://example.com/ns#TestShape";
const EX_INSTANCE: &str = "http://example.com/ns#Instance";
const SHSH: &str = "http://www.w3.org/ns/shacl-shacl#";

fn parse(source: &str, base: &str) -> Dataset {
    let parser = TurtleParser::new().with_base_iri(base).unwrap();
    let mut dataset = Dataset::new();
    for triple in parser.for_slice(source.as_bytes()) {
        let triple = triple.unwrap();
        dataset.insert(Quad::new(
            triple.subject,
            triple.predicate,
            triple.object,
            GraphName::DefaultGraph,
        ));
    }
    dataset
}

fn in_002() -> Dataset {
    parse(
        include_str!("fixtures/upstream-corrections/in-002.corrected.ttl"),
        "http://example.org/in-002",
    )
}

fn in_003() -> Dataset {
    parse(
        include_str!("fixtures/upstream-corrections/in-003.corrected.ttl"),
        "http://example.org/in-003",
    )
}

/// The upstream bytes fail here; the corrected copy must not.
#[test]
fn corrected_in_003_parses_where_the_pinned_fixture_cannot() {
    let dataset = in_003();
    assert!(!dataset.is_empty());
    // The shsh: terms that the missing prefix made unreachable now resolve.
    let subjects = dataset
        .iter()
        .map(|quad| quad.subject.to_string())
        .collect::<Vec<_>>();
    assert!(
        subjects
            .iter()
            .any(|s| s == &format!("<{SHSH}inSubjectsShape>")),
        "expected shsh:inSubjectsShape to resolve, got {subjects:?}"
    );
    assert!(
        subjects
            .iter()
            .any(|s| s == &format!("<{SHSH}inSubjectsShapeInPropertyShape>")),
        "expected shsh:inSubjectsShapeInPropertyShape to resolve"
    );
}

/// `sh:in ()` is unsatisfiable, so the instance the shape targets must violate
/// it. This is the behavior the pinned fixture meant to assert and could not.
#[test]
fn corrected_in_002_reports_the_unsatisfiable_empty_in_list() {
    let dataset = in_002();
    let shapes = ShapesGraph::compile(
        &GraphSnapshot::default_graph(dataset.clone()),
        ProfileSet::default(),
        &ValidationOptions::default(),
    )
    .unwrap();
    let report = validate(
        &shapes,
        &GraphSnapshot::default_graph(dataset),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert!(
        !report.conforms(),
        "an empty sh:in list is unsatisfiable, so the targeted instance must not conform"
    );
    let results = report.results();
    assert_eq!(results.len(), 1, "expected exactly one violation");
    let result = &results[0];
    assert_eq!(
        result.focus_node,
        Term::NamedNode(NamedNode::new_unchecked(EX_INSTANCE.to_owned())),
        "the instance is the focus node"
    );
    assert_eq!(
        result.source_constraint_component,
        NamedNode::new_unchecked(format!("{SH}InConstraintComponent")),
        "the violation comes from sh:in"
    );
}

/// The correction renames the shape so it actually targets the instance; the
/// pinned fixture's dangling `ex:TestShape` reference is what made it
/// unrunnable. Pin that the shape is now present and reachable.
#[test]
fn corrected_in_002_defines_the_shape_its_expected_result_cites() {
    let dataset = in_002();
    let declared = dataset
        .iter()
        .any(|quad| quad.subject.to_string() == format!("<{EX_TEST_SHAPE}>"));
    assert!(
        declared,
        "ex:TestShape must be declared for the expected sh:sourceShape to resolve"
    );
    // And the dangling name the pinned fixture left behind is gone.
    let stale = dataset
        .iter()
        .any(|quad| quad.subject.to_string() == "<http://example.com/ns#TestInUnsatisfiableShape>");
    assert!(!stale, "the unreferenced shape name should not remain");
}
