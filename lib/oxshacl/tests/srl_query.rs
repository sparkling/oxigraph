#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public Rules QUERY operation"
)]

use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, Quad};
use oxshacl::{
    GraphSnapshot, ProfileId, ProfileSet, SrlConstant, SrlError, SrlNode, SrlPathElement,
    SrlPredicate, SrlRuleSet, SrlTriple, ValidationOptions, query_srl_rules,
    query_srl_rules_with_imports,
};

const EX: &str = "http://example/";

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
    NamedNode::new_unchecked(format!("{EX}{local}"))
}

fn iri_node(local: &str) -> SrlNode {
    SrlNode::Constant(SrlConstant::Iri(format!("{EX}{local}")))
}

fn goal(subject: SrlNode, predicate: SrlNode, object: SrlNode) -> SrlTriple {
    SrlTriple {
        subject,
        predicate: SrlPredicate::Node(predicate),
        object,
    }
}

fn base(
    subject: impl Into<oxrdf::NamedOrBlankNode>,
    predicate: &str,
    object: &str,
) -> GraphSnapshot {
    GraphSnapshot::default_graph(Dataset::from_iter([Quad::new(
        subject,
        iri(predicate),
        iri(object),
        GraphName::DefaultGraph,
    )]))
}

#[test]
fn query_matches_inferred_and_base_triples() {
    let rules = parse("PREFIX : <http://example/> RULE { ?s :derived ?o } WHERE { ?s :source ?o }");
    let data = base(iri("subject"), "source", "object");
    let options = ValidationOptions::default();

    assert!(
        query_srl_rules(
            &rules,
            &data,
            &goal(iri_node("subject"), iri_node("derived"), iri_node("object"),),
            &options,
        )
        .unwrap()
    );
    assert!(
        query_srl_rules(
            &rules,
            &data,
            &goal(iri_node("subject"), iri_node("source"), iri_node("object")),
            &options,
        )
        .unwrap()
    );
    assert!(
        !query_srl_rules(
            &rules,
            &data,
            &goal(iri_node("subject"), iri_node("missing"), iri_node("object")),
            &options,
        )
        .unwrap()
    );
}

#[test]
fn query_variables_are_existential_and_must_be_consistent() {
    let rules = parse("PREFIX : <http://example/>");
    let data = base(iri("same"), "edge", "same");
    let repeated = SrlNode::Variable("node".to_owned());

    assert!(
        query_srl_rules(
            &rules,
            &data,
            &goal(repeated.clone(), iri_node("edge"), repeated),
            &ValidationOptions::default(),
        )
        .unwrap()
    );
    assert!(
        !query_srl_rules(
            &rules,
            &base(iri("left"), "edge", "right"),
            &goal(
                SrlNode::Variable("node".to_owned()),
                iri_node("edge"),
                SrlNode::Variable("node".to_owned()),
            ),
            &ValidationOptions::default(),
        )
        .unwrap()
    );
}

#[test]
fn query_blank_node_constants_match_by_rdf_term_identity() {
    let rules = parse("PREFIX : <http://example/>");
    let same = BlankNode::new_unchecked("same");
    let data = base(same, "edge", "object");

    assert!(
        query_srl_rules(
            &rules,
            &data,
            &goal(
                SrlNode::Constant(SrlConstant::BlankNode("same".to_owned())),
                iri_node("edge"),
                iri_node("object"),
            ),
            &ValidationOptions::default(),
        )
        .unwrap()
    );
    assert!(
        !query_srl_rules(
            &rules,
            &data,
            &goal(
                SrlNode::Constant(SrlConstant::BlankNode("other".to_owned())),
                iri_node("edge"),
                iri_node("object"),
            ),
            &ValidationOptions::default(),
        )
        .unwrap()
    );
}

#[test]
fn query_resolves_rules_imports_only_through_the_callback() {
    let root = parse("PREFIX : <http://example/> IMPORTS :imported");
    let data = base(iri("subject"), "source", "object");
    let query = goal(iri_node("subject"), iri_node("derived"), iri_node("object"));
    let resolver = |iri: &str, selected: &ProfileSet| {
        assert_eq!(iri, "http://example/imported");
        SrlRuleSet::parse(
            "PREFIX : <http://example/> RULE { ?s :derived ?o } WHERE { ?s :source ?o }",
            None,
            selected.clone(),
        )
    };

    assert!(
        query_srl_rules_with_imports(
            &root,
            &data,
            &query,
            &ValidationOptions::default(),
            &resolver,
        )
        .unwrap()
    );
    assert!(matches!(
        query_srl_rules(
            &root,
            &data,
            &query,
            &ValidationOptions::default(),
        ),
        Err(SrlError::Unsupported(reason)) if reason.contains("IMPORTS")
    ));
}

#[test]
fn query_accepts_only_one_abstract_triple_pattern() {
    let rules = parse("PREFIX : <http://example/>");
    let data = GraphSnapshot::default_graph(Dataset::new());
    let path_goal = SrlTriple {
        subject: SrlNode::Variable("subject".to_owned()),
        predicate: SrlPredicate::Path(vec![SrlPathElement {
            inverse: false,
            iri: format!("{EX}path"),
        }]),
        object: SrlNode::Variable("object".to_owned()),
    };
    let abbreviation_goal = goal(
        SrlNode::Collection {
            id: 0,
            values: vec![iri_node("member")],
        },
        iri_node("predicate"),
        iri_node("object"),
    );
    let literal_subject = goal(
        SrlNode::Constant(SrlConstant::Boolean(true)),
        iri_node("predicate"),
        iri_node("object"),
    );

    for invalid in [&path_goal, &abbreviation_goal, &literal_subject] {
        assert!(matches!(
            query_srl_rules(
                &rules,
                &data,
                invalid,
                &ValidationOptions::default(),
            ),
            Err(SrlError::Unsupported(reason))
                if reason.contains("abstract triple pattern")
        ));
    }
}

#[test]
fn query_obeys_execution_limits_and_draft_open_constructs() {
    let rules = parse("PREFIX : <http://example/> RULE {} WHERE DATA {}");
    let error = query_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(Dataset::new()),
        &goal(
            SrlNode::Variable("subject".to_owned()),
            iri_node("predicate"),
            SrlNode::Variable("object".to_owned()),
        ),
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(matches!(error, SrlError::Unsupported(reason) if reason.contains("#960")));
}
