#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests keep assertions close to their named scenarios"
)]
#![cfg_attr(
    feature = "rdf-12",
    expect(clippy::panic, reason = "the query result variant is an invariant")
)]

use oxdatalog::{
    CancellationToken, EvaluationError, EvaluationLimits, EvaluationOptions, LimitKind,
    rdf::{RdfEvaluationError, fact_from_quad},
};
#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxrdf::{
    BlankNode, Dataset, GraphName, Literal, NamedNode, Quad, Term,
    vocab::{rdf, rdfs},
};
use oxrdfs::{
    INCLUDES_AXIOMATIC_TRIPLES, RDFS_12_ENTAILMENT_PROFILE, RDFS_D0_PROFILE, RdfsD0, RdfsD0Error,
    RdfsD0InputError,
};

const _: () = assert!(
    !INCLUDES_AXIOMATIC_TRIPLES,
    "rdfs-d0 must not silently enable axiomatic triples"
);

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("http://example.com/{local}")).unwrap()
}

fn quad(subject: &NamedNode, predicate: impl Into<NamedNode>, object: impl Into<Term>) -> Quad {
    Quad::new(subject.clone(), predicate, object, GraphName::DefaultGraph)
}

fn graph_quad(
    subject: &NamedNode,
    predicate: impl Into<NamedNode>,
    object: impl Into<Term>,
    graph_name: impl Into<GraphName>,
) -> Quad {
    Quad::new(subject.clone(), predicate, object, graph_name)
}

fn contains(dataset: &Dataset, expected: &Quad) -> bool {
    dataset
        .iter()
        .any(|quad| quad.as_ref() == expected.as_ref())
}

#[test]
fn rule_inventory_and_full_claim_rejection_are_exact() {
    assert_eq!(RdfsD0::profile_id(), RDFS_D0_PROFILE);
    assert_eq!(
        RdfsD0::implemented_rules()
            .iter()
            .map(|rule| rule.id())
            .collect::<Vec<_>>(),
        [
            "rdfs2", "rdfs3", "rdfs5", "rdfs6", "rdfs7", "rdfs8", "rdfs9", "rdfs10", "rdfs11",
            "rdfs12", "rdfs13",
        ]
    );
    for rule in RdfsD0::implemented_rules() {
        assert_eq!(
            rule.source(),
            format!(
                "https://www.w3.org/TR/2026/\
                 CR-rdf12-semantics-20260407/#{}",
                rule.id()
            )
        );
    }
    assert_eq!(
        RdfsD0::omitted_patterns()
            .iter()
            .map(|rule| rule.id())
            .collect::<Vec<_>>(),
        ["rdfs1", "rdfs4", "rdfs14", "rdfs14a"]
    );
    let error = RdfsD0::require_full_conformance().unwrap_err();
    assert_eq!(error.requested(), RDFS_12_ENTAILMENT_PROFILE);
    assert_eq!(error.available(), RDFS_D0_PROFILE);
    assert_eq!(error.implemented_rule_count(), 11);
    assert_eq!(error.omitted_pattern_count(), 4);
}

#[test]
fn empty_dataset_does_not_materialize_axiomatic_triples() {
    let closure = RdfsD0::new()
        .evaluate(&Dataset::new(), &EvaluationOptions::default())
        .unwrap();

    assert!(closure.base().is_empty());
    assert!(closure.inference().is_empty());
    assert_eq!(closure.receipt().derived_quads, 0);
}

#[test]
fn subclass_closure_and_type_propagation_have_w3c_provenance() {
    let dog = node("Dog");
    let mammal = node("Mammal");
    let animal = node("Animal");
    let fido = node("fido");
    let base = Dataset::from_iter([
        quad(&dog, rdfs::SUB_CLASS_OF, mammal.clone()),
        quad(&mammal, rdfs::SUB_CLASS_OF, animal.clone()),
        quad(&fido, rdf::TYPE, dog.clone()),
    ]);
    let closure = RdfsD0::new()
        .evaluate(
            &base,
            &EvaluationOptions {
                track_provenance: true,
                ..EvaluationOptions::default()
            },
        )
        .unwrap();

    let schema = quad(&dog, rdfs::SUB_CLASS_OF, animal.clone());
    let typing = quad(&fido, rdf::TYPE, animal);
    assert!(contains(closure.inference(), &schema));
    assert!(contains(closure.inference(), &typing));

    let direct = quad(&fido, rdf::TYPE, mammal);
    let derivation = closure
        .evaluation()
        .provenance()
        .unwrap()
        .derivation(&fact_from_quad(direct))
        .unwrap();
    assert_eq!(derivation.rule_id().as_str(), "rdfs9");
    assert_eq!(
        derivation.rule_source(),
        Some(
            "https://www.w3.org/TR/2026/\
             CR-rdf12-semantics-20260407/#rdfs9"
        )
    );
}

#[test]
fn subproperty_closure_propagates_assertions() {
    let child = node("child");
    let relation = node("relation");
    let connected = node("connected");
    let alice = node("alice");
    let bob = node("bob");
    let base = Dataset::from_iter([
        quad(&child, rdfs::SUB_PROPERTY_OF, relation.clone()),
        quad(&relation, rdfs::SUB_PROPERTY_OF, connected.clone()),
        quad(&alice, child.clone(), bob.clone()),
    ]);
    let closure = RdfsD0::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    assert!(contains(
        closure.inference(),
        &quad(&child, rdfs::SUB_PROPERTY_OF, connected.clone())
    ));
    assert!(contains(closure.inference(), &quad(&alice, connected, bob)));
}

#[test]
fn domain_and_range_type_resource_endpoints() {
    let parent = node("parent");
    let person = node("Person");
    let agent = node("Agent");
    let alice = node("alice");
    let bob = node("bob");
    let base = Dataset::from_iter([
        quad(&parent, rdfs::DOMAIN, person.clone()),
        quad(&parent, rdfs::RANGE, agent.clone()),
        quad(&alice, parent, bob.clone()),
    ]);
    let closure = RdfsD0::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    assert!(contains(
        closure.inference(),
        &quad(&alice, rdf::TYPE, person)
    ));
    assert!(contains(closure.inference(), &quad(&bob, rdf::TYPE, agent)));
}

#[test]
fn reflexive_class_property_container_and_datatype_patterns_run() {
    let property = node("property");
    let class = node("Class");
    let member = node("member");
    let datatype = node("datatype");
    let base = Dataset::from_iter([
        quad(&property, rdf::TYPE, rdf::PROPERTY),
        quad(&class, rdf::TYPE, rdfs::CLASS),
        quad(&member, rdf::TYPE, rdfs::CONTAINER_MEMBERSHIP_PROPERTY),
        quad(&datatype, rdf::TYPE, rdfs::DATATYPE),
    ]);
    let closure = RdfsD0::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    for expected in [
        quad(&property, rdfs::SUB_PROPERTY_OF, property.clone()),
        quad(&class, rdfs::SUB_CLASS_OF, class.clone()),
        quad(&class, rdfs::SUB_CLASS_OF, rdfs::RESOURCE),
        quad(&member, rdfs::SUB_PROPERTY_OF, rdfs::MEMBER),
        quad(&datatype, rdfs::SUB_CLASS_OF, rdfs::LITERAL),
    ] {
        assert!(contains(closure.inference(), &expected), "{expected}");
    }
}

#[test]
fn dataset_graphs_are_isolated_and_preserved() {
    let property = node("property");
    let superproperty = node("superproperty");
    let alice = node("alice");
    let bob = node("bob");
    let graph = node("graph");
    let base = Dataset::from_iter([
        graph_quad(
            &property,
            rdfs::SUB_PROPERTY_OF,
            superproperty.clone(),
            graph.clone(),
        ),
        quad(&alice, property.clone(), bob.clone()),
        graph_quad(&alice, property, bob.clone(), graph.clone()),
    ]);
    let closure = RdfsD0::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    assert!(contains(
        closure.inference(),
        &graph_quad(&alice, superproperty.clone(), bob.clone(), graph)
    ));
    assert!(!contains(
        closure.inference(),
        &quad(&alice, superproperty, bob)
    ));
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf_12_triple_terms_survive_supported_quad_rules() {
    let property = node("property");
    let superproperty = node("superproperty");
    let domain = node("Domain");
    let statement = node("statement");
    let quoted = Term::from(Triple::new(node("s"), node("p"), node("o")));
    let graph = node("graph");
    let base = Dataset::from_iter([
        graph_quad(
            &property,
            rdfs::SUB_PROPERTY_OF,
            superproperty.clone(),
            graph.clone(),
        ),
        graph_quad(&property, rdfs::DOMAIN, domain.clone(), graph.clone()),
        graph_quad(&statement, property, quoted.clone(), graph.clone()),
    ]);
    let closure = RdfsD0::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    assert!(contains(
        closure.inference(),
        &graph_quad(&statement, superproperty, quoted, graph.clone())
    ));
    assert!(contains(
        closure.inference(),
        &graph_quad(&statement, rdf::TYPE, domain, graph)
    ));
}

#[test]
fn range_over_literal_fails_closed_before_evaluation() {
    let property = node("property");
    let superproperty = node("superproperty");
    let class = node("Class");
    let subject = node("subject");
    let data = quad(&subject, property.clone(), Literal::from("literal"));
    let base = Dataset::from_iter([
        quad(&property, rdfs::SUB_PROPERTY_OF, superproperty.clone()),
        quad(&superproperty, rdfs::RANGE, class),
        data.clone(),
    ]);
    let snapshot = base.clone();

    let error = RdfsD0::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap_err();

    assert!(matches!(
        error,
        RdfsD0Error::Input(RdfsD0InputError::RangeOnNonResource {
            range_property,
            ..
        }) if range_property == property
    ));
    assert_eq!(base, snapshot);
    assert!(base.contains(&data));
}

#[test]
fn generalized_and_dynamic_property_expressions_fail_closed() {
    let property = node("property");
    let class = node("Class");
    let blank = BlankNode::new("property").unwrap();
    let cases = [
        Quad::new(
            blank,
            rdfs::SUB_PROPERTY_OF,
            property.clone(),
            GraphName::DefaultGraph,
        ),
        quad(
            &property,
            rdfs::SUB_PROPERTY_OF,
            BlankNode::new("target").unwrap(),
        ),
        quad(&property, rdfs::SUB_PROPERTY_OF, rdfs::RANGE),
        quad(&property, rdfs::SUB_PROPERTY_OF, rdf::TYPE),
        quad(&property, rdfs::DOMAIN, Literal::from("not-a-class")),
        quad(
            &property,
            rdfs::RANGE,
            Term::from(Literal::from("not-a-class")),
        ),
        quad(&class, rdfs::SUB_CLASS_OF, Literal::from("not-a-class")),
        quad(
            &class,
            rdfs::SUB_CLASS_OF,
            rdfs::CONTAINER_MEMBERSHIP_PROPERTY,
        ),
    ];

    for base in cases.map(|quad| Dataset::from_iter([quad])) {
        let error = RdfsD0::new()
            .evaluate(&base, &EvaluationOptions::default())
            .unwrap_err();
        assert!(matches!(error, RdfsD0Error::Input(_)));
    }
}

#[test]
fn container_membership_range_risk_fails_during_preflight() {
    let membership = node("membership");
    let class = node("Class");
    let subject = node("subject");
    let base = Dataset::from_iter([
        quad(&membership, rdf::TYPE, rdfs::CONTAINER_MEMBERSHIP_PROPERTY),
        quad(&rdfs::MEMBER, rdfs::RANGE, class),
        quad(&subject, membership.clone(), Literal::from("literal")),
    ]);

    let error = RdfsD0::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap_err();

    assert!(matches!(
        error,
        RdfsD0Error::Input(RdfsD0InputError::RangeOnNonResource {
            range_property,
            ..
        }) if range_property == membership
    ));
}

#[test]
fn resource_limits_and_cancellation_leave_the_base_unchanged() {
    let property = node("property");
    let class = node("Class");
    let subject = node("subject");
    let object = node("object");
    let base = Dataset::from_iter([
        quad(&property, rdfs::DOMAIN, class),
        quad(&subject, property, object),
    ]);
    let snapshot = base.clone();
    let limited = EvaluationOptions {
        limits: EvaluationLimits {
            max_facts: 1,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let error = RdfsD0::new().evaluate(&base, &limited).unwrap_err();
    assert!(matches!(
        error,
        RdfsD0Error::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Facts,
                limit: 1,
            }
        ))
    ));
    assert_eq!(base, snapshot);

    let cancellation_token = CancellationToken::new();
    cancellation_token.cancel();
    let cancelled = EvaluationOptions {
        cancellation_token,
        ..EvaluationOptions::default()
    };
    let error = RdfsD0::new().evaluate(&base, &cancelled).unwrap_err();
    assert!(matches!(
        error,
        RdfsD0Error::Evaluation(RdfEvaluationError::Evaluation(EvaluationError::Cancelled))
    ));
    assert_eq!(base, snapshot);
}

#[test]
fn receipt_is_profile_specific_and_deterministic() {
    let class = node("Class");
    let parent = node("Parent");
    let child = node("Child");
    let instance = node("instance");
    let quads = [
        quad(&child, rdfs::SUB_CLASS_OF, parent.clone()),
        quad(&instance, rdf::TYPE, child),
        quad(&parent, rdfs::SUB_CLASS_OF, class.clone()),
    ];
    let first = RdfsD0::new()
        .evaluate(
            &Dataset::from_iter(quads.clone()),
            &EvaluationOptions::default(),
        )
        .unwrap()
        .receipt();
    let second = RdfsD0::new()
        .evaluate(
            &Dataset::from_iter(quads.into_iter().rev()),
            &EvaluationOptions::default(),
        )
        .unwrap()
        .receipt();

    assert_eq!(first, second);
    assert_eq!(first.profile, RDFS_D0_PROFILE);
    assert_eq!(first.implemented_rule_count, 11);
    assert!(first.canonical_text().starts_with("profile=rdfs-d0\n"));
    assert!(first.canonical_text().contains(&class.to_string()));
}

#[cfg(feature = "spareval")]
#[test]
fn sparql_queries_the_entailed_view() {
    use spareval::{QueryEvaluator, QueryResults};
    use spargebra::SparqlParser;

    let child = node("Child");
    let parent = node("Parent");
    let instance = node("instance");
    let base = Dataset::from_iter([
        quad(&child, rdfs::SUB_CLASS_OF, parent.clone()),
        quad(&instance, rdf::TYPE, child),
    ]);
    let closure = RdfsD0::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();
    let query = SparqlParser::new()
        .parse_query(
            "SELECT ?class WHERE {
                <http://example.com/instance>
                    a ?class
            }",
        )
        .unwrap();
    let results = QueryEvaluator::new()
        .prepare(&query)
        .execute(closure.entailed())
        .unwrap();
    let QueryResults::Solutions(solutions) = results else {
        panic!("SELECT query did not return solutions");
    };
    let values = solutions
        .map(|solution| solution.unwrap()["class"].clone())
        .collect::<Vec<_>>();

    assert!(values.contains(&Term::from(parent)));
}
