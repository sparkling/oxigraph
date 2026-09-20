#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise public SRL DATA graph semantics"
)]

use oxrdf::{Dataset, GraphName, NamedNode, Quad};
use oxshacl::{
    GraphSnapshot, LimitKind, ProfileId, ProfileSet, SrlError, SrlExecution, SrlRuleSet,
    ValidationError, ValidationOptions, execute_srl_rules,
};

const EX: &str = "http://example/";

fn profiles() -> ProfileSet {
    ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap()
}

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{EX}{local}"))
}

fn quad(subject: &str, predicate: &str, object: &str) -> Quad {
    Quad::new(
        iri(subject),
        iri(predicate),
        iri(object),
        GraphName::DefaultGraph,
    )
}

fn base(triples: &[(&str, &str, &str)]) -> GraphSnapshot {
    GraphSnapshot::default_graph(Dataset::from_iter(
        triples
            .iter()
            .map(|&(subject, predicate, object)| quad(subject, predicate, object)),
    ))
}

fn execute(source: &str, triples: &[(&str, &str, &str)]) -> SrlExecution {
    let rules = SrlRuleSet::parse(source, None, profiles()).unwrap();
    execute_srl_rules(&rules, &base(triples), &ValidationOptions::default()).unwrap()
}

fn assert_inferred(execution: &SrlExecution, subject: &str, predicate: &str, object: &str) {
    assert!(
        execution
            .inference()
            .dataset()
            .contains(&quad(subject, predicate, object)),
        "expected inferred triple ({subject}, {predicate}, {object})"
    );
}

fn assert_not_inferred(execution: &SrlExecution, subject: &str, predicate: &str, object: &str) {
    assert!(
        !execution
            .inference()
            .dataset()
            .contains(&quad(subject, predicate, object)),
        "forbidden inferred triple ({subject}, {predicate}, {object})"
    );
}

#[test]
fn frozen_data_graph_contains_base_and_every_inline_block() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "DATA { :inline1 :edge :inline2 } ",
            "RULE { :root :joined ?end } WHERE DATA { ",
            "  :root :baseEdge :inline1 . ",
            "  :inline1 :edge :inline2 . ",
            "  :inline2 :edge ?end ",
            "} ",
            "DATA { :inline2 :edge :end }",
        ),
        &[("root", "baseEdge", "inline1")],
    );

    assert_inferred(&execution, "root", "joined", "end");
}

#[test]
fn ordinary_rules_see_derivations_but_where_data_does_not() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :seed :stage :value } WHERE { :seed :input :value } ",
            "RULE { :ordinary :saw :value } WHERE { :seed :stage :value } ",
            "RULE { :dataOnly :saw :value } WHERE DATA { :seed :stage :value }",
        ),
        &[("seed", "input", "value")],
    );

    assert_inferred(&execution, "seed", "stage", "value");
    assert_inferred(&execution, "ordinary", "saw", "value");
    assert_not_inferred(&execution, "dataOnly", "saw", "value");
}

#[test]
fn where_data_is_sticky_through_plain_nested_negation() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :seed :blocked :value } WHERE { :seed :candidate :value } ",
            "RULE { :probe :status :accepted } WHERE DATA { ",
            "  :seed :candidate :value . ",
            "  NOT { :seed :blocked :value } ",
            "}",
        ),
        &[("seed", "candidate", "value")],
    );

    // Stratification derives the blocker before evaluating the negating rule.
    // The plain NOT still reads GD because WHERE DATA is sticky.
    assert_inferred(&execution, "seed", "blocked", "value");
    assert_inferred(&execution, "probe", "status", "accepted");
}

#[test]
fn not_data_scopes_to_its_subtree_and_restores_the_outer_graph() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :seed :ready :value } WHERE { :seed :candidate :value } ",
            "RULE { :seed :blocked :value } WHERE { :seed :candidate :value } ",
            "RULE { :seed :after :value } WHERE { :seed :candidate :value } ",
            "RULE { :probe :status :accepted } WHERE { ",
            "  :seed :ready :value . ",
            "  NOT DATA { ",
            "    :seed :candidate :value . ",
            "    :seed :blocked :value ",
            "  } ",
            "  :seed :after :value ",
            "}",
        ),
        &[("seed", "candidate", "value")],
    );

    // Both outer positive patterns read GE. The complete negated conjunction
    // reads frozen GD, and evaluation returns to GE after the subtree.
    assert_inferred(&execution, "seed", "ready", "value");
    assert_inferred(&execution, "seed", "blocked", "value");
    assert_inferred(&execution, "seed", "after", "value");
    assert_inferred(&execution, "probe", "status", "accepted");
}

#[test]
fn not_data_observes_blockers_in_the_frozen_data_graph() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :probe :status :accepted } WHERE { ",
            "  :seed :candidate :value . ",
            "  NOT DATA { :seed :blocked :value } ",
            "}",
        ),
        &[("seed", "candidate", "value"), ("seed", "blocked", "value")],
    );

    assert_not_inferred(&execution, "probe", "status", "accepted");
}

#[test]
fn not_data_inside_where_data_uses_the_frozen_graph() {
    let source = concat!(
        "PREFIX : <http://example/> ",
        "RULE { :seed :blocked :value } WHERE { :seed :candidate :value } ",
        "RULE { :probe :status :accepted } WHERE DATA { ",
        "  :seed :candidate :value . ",
        "  NOT DATA { :seed :blocked :value } ",
        "}",
    );
    let derived_blocker = execute(source, &[("seed", "candidate", "value")]);

    // Stratification makes the GE-only blocker available before the DATA rule.
    // Both WHERE DATA and its NOT DATA element still read frozen GD.
    assert_inferred(&derived_blocker, "seed", "blocked", "value");
    assert_inferred(&derived_blocker, "probe", "status", "accepted");

    let data_blocker = execute(
        source,
        &[("seed", "candidate", "value"), ("seed", "blocked", "value")],
    );
    assert_not_inferred(&data_blocker, "probe", "status", "accepted");
}

#[test]
fn no_data_native_rules_do_not_pay_for_a_frozen_graph_copy() {
    let rules = SrlRuleSet::parse(
        "RULE {} WHERE { NOT { <urn:missing> <urn:p> <urn:o> } }",
        None,
        profiles(),
    )
    .unwrap();
    let mut options = ValidationOptions::default();
    options.limits.max_estimated_memory_bytes = 200;

    execute_srl_rules(&rules, &base(&[("base", "p", "o")]), &options)
        .unwrap();
}

#[test]
fn frozen_data_graph_copy_respects_the_memory_limit() {
    let rules = SrlRuleSet::parse(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE {} WHERE DATA { :base :p :o }",
        ),
        None,
        profiles(),
    )
    .unwrap();
    let mut options = ValidationOptions::default();
    options.limits.max_estimated_memory_bytes = 200;

    assert!(matches!(
        execute_srl_rules(&rules, &base(&[("base", "p", "o")]), &options),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::EstimatedMemory,
            ..
        }))
    ));
}
