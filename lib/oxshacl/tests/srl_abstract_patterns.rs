#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise supported SRL abstract-pattern lowering"
)]

use oxrdf::{Dataset, GraphName, NamedNode, Quad};
use oxshacl::{
    GraphSnapshot, ProfileId, ProfileSet, SrlRuleSet, ValidationOptions, execute_srl_rules,
};

fn profiles() -> ProfileSet {
    ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap()
}

fn parse(source: &str) -> SrlRuleSet {
    SrlRuleSet::parse(source, None, profiles()).unwrap()
}

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("http://example/{local}"))
}

fn quad(subject: &str, predicate: &str, object: &str) -> Quad {
    Quad::new(
        iri(subject),
        iri(predicate),
        iri(object),
        GraphName::DefaultGraph,
    )
}

#[test]
fn variable_predicates_are_lowered_as_abstract_triple_pattern_variables() {
    let rules = parse(
        "PREFIX : <http://example/> RULE { ?s :matchedPredicate ?p } WHERE { ?s ?p :object }",
    );
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(Dataset::from_iter([quad(
            "subject",
            "sourcePredicate",
            "object",
        )])),
        &ValidationOptions::default(),
    )
    .unwrap();

    assert!(execution.inference().dataset().contains(&quad(
        "subject",
        "matchedPredicate",
        "sourcePredicate",
    )));
}

#[test]
fn supported_sequence_and_inverse_paths_expand_to_triple_patterns() {
    let rules = parse(
        "PREFIX : <http://example/> \
         RULE { ?person :grandparent ?ancestor } \
         WHERE { ?person :parent/^:child ?ancestor }",
    );
    let data = Dataset::from_iter([
        quad("person", "parent", "middle"),
        quad("ancestor", "child", "middle"),
    ]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();

    assert!(
        execution
            .inference()
            .dataset()
            .contains(&quad("person", "grandparent", "ancestor",))
    );
}

#[cfg(feature = "rdf-12")]
#[test]
fn triple_term_patterns_bind_nested_variables() {
    use oxrdf::{Term, Triple};

    let rules = parse(
        "PREFIX : <http://example/> \
         RULE { :record :matched ?object } \
         WHERE { :record :statement <<( :subject :predicate ?object )>> }",
    );
    let statement = Triple::new(iri("subject"), iri("predicate"), iri("object"));
    let data = Dataset::from_iter([Quad::new(
        iri("record"),
        iri("statement"),
        Term::Triple(Box::new(statement)),
        GraphName::DefaultGraph,
    )]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();

    assert!(
        execution
            .inference()
            .dataset()
            .contains(&quad("record", "matched", "object"))
    );
}
