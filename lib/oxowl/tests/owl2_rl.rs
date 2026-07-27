#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests keep assertions close to their named scenarios"
)]

use oxdatalog::{
    EvaluationError, EvaluationOptions, LimitKind,
    rdf::{RdfEvaluationError, fact_from_quad},
};
use oxowl::{
    OWL2_RL_RDF_POSITIVE_SEED_PROFILE, OWL2_RL_RDF_PROFILE, Owl2RlPositiveSeed, Owl2RlSeedClosure,
    Owl2RlSeedError, Owl2RlSeedInputError,
};
use oxrdf::{
    Dataset, GraphName, NamedNode, Quad, Term,
    vocab::{rdf, rdfs},
};
use std::time::Duration;

const OWL: &str = "http://www.w3.org/2002/07/owl#";

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("http://example.com/{local}")).unwrap()
}

fn owl(local: &str) -> NamedNode {
    NamedNode::new(format!("{OWL}{local}")).unwrap()
}

fn quad(subject: &NamedNode, predicate: &NamedNode, object: impl Into<Term>) -> Quad {
    Quad::new(
        subject.clone(),
        predicate.clone(),
        object,
        GraphName::DefaultGraph,
    )
}

fn contains(dataset: &Dataset, expected: &Quad) -> bool {
    dataset
        .iter()
        .any(|quad| quad.as_ref() == expected.as_ref())
}

fn accepts_only_seed_closure(_: &Owl2RlSeedClosure) {}

#[test]
fn subclass_typing_closes_the_schema_and_instances() {
    let dog = node("Dog");
    let mammal = node("Mammal");
    let animal = node("Animal");
    let fido = node("fido");
    let mut base = Dataset::new();
    base.insert(quad(&dog, &rdfs::SUB_CLASS_OF, mammal.clone()));
    base.insert(quad(&mammal, &rdfs::SUB_CLASS_OF, animal.clone()));
    base.insert(quad(&fido, &rdf::TYPE, dog.clone()));

    let closure = Owl2RlPositiveSeed::new()
        .evaluate(
            &base,
            &EvaluationOptions {
                track_provenance: true,
                ..EvaluationOptions::default()
            },
        )
        .unwrap();

    let schema = quad(&dog, &rdfs::SUB_CLASS_OF, animal.clone());
    let typing = quad(&fido, &rdf::TYPE, animal.clone());
    assert!(contains(closure.inference(), &schema));
    assert!(contains(closure.inference(), &typing));

    let direct_typing = quad(&fido, &rdf::TYPE, mammal.clone());
    let derivation = closure
        .evaluation()
        .provenance()
        .unwrap()
        .derivation(&fact_from_quad(direct_typing))
        .unwrap();
    assert_eq!(derivation.rule_id().as_str(), "cax-sco");
    assert_eq!(
        derivation.rule_source(),
        Some(
            "https://www.w3.org/TR/2012/\
             REC-owl2-profiles-20121211/#cax-sco"
        )
    );
}

#[test]
fn subproperty_closes_the_schema_and_assertions() {
    let child = node("child");
    let relation = node("relation");
    let connected = node("connected");
    let alice = node("alice");
    let bob = node("bob");
    let mut base = Dataset::new();
    base.insert(quad(&child, &rdfs::SUB_PROPERTY_OF, relation.clone()));
    base.insert(quad(&relation, &rdfs::SUB_PROPERTY_OF, connected.clone()));
    base.insert(quad(&alice, &child, bob.clone()));

    let closure = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    assert!(contains(
        closure.inference(),
        &quad(&child, &rdfs::SUB_PROPERTY_OF, connected.clone())
    ));
    assert!(contains(
        closure.inference(),
        &quad(&alice, &connected, bob.clone())
    ));
}

#[test]
fn domain_and_range_type_the_property_endpoints() {
    let parent = node("parent");
    let person = node("Person");
    let agent = node("Agent");
    let alice = node("alice");
    let bob = node("bob");
    let mut base = Dataset::new();
    base.insert(quad(&parent, &rdfs::DOMAIN, person.clone()));
    base.insert(quad(&parent, &rdfs::RANGE, agent.clone()));
    base.insert(quad(&alice, &parent, bob.clone()));

    let closure = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    assert!(contains(
        closure.inference(),
        &quad(&alice, &rdf::TYPE, person.clone())
    ));
    assert!(contains(
        closure.inference(),
        &quad(&bob, &rdf::TYPE, agent.clone())
    ));
}

#[test]
fn transitive_symmetric_and_inverse_properties_are_materialized() {
    let ancestor = node("ancestor");
    let knows = node("knows");
    let parent = node("parent");
    let child = node("child");
    let alice = node("alice");
    let bob = node("bob");
    let carol = node("carol");
    let dave = node("dave");
    let eve = node("eve");
    let mut base = Dataset::new();
    base.insert(quad(&ancestor, &rdf::TYPE, owl("TransitiveProperty")));
    base.insert(quad(&alice, &ancestor, bob.clone()));
    base.insert(quad(&bob, &ancestor, carol.clone()));
    base.insert(quad(&knows, &rdf::TYPE, owl("SymmetricProperty")));
    base.insert(quad(&alice, &knows, bob.clone()));
    base.insert(quad(&parent, &owl("inverseOf"), child.clone()));
    base.insert(quad(&alice, &parent, dave.clone()));
    base.insert(quad(&eve, &child, bob.clone()));

    let closure = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    for expected in [
        quad(&alice, &ancestor, carol.clone()),
        quad(&bob, &knows, alice.clone()),
        quad(&dave, &child, alice.clone()),
        quad(&bob, &parent, eve.clone()),
    ] {
        assert!(contains(closure.inference(), &expected), "{expected}");
    }
}

#[test]
fn equivalent_classes_and_properties_propagate_both_directions() {
    let student = node("Student");
    let person = node("Person");
    let alice = node("alice");
    let bob = node("bob");
    let parent = node("parent");
    let guardian = node("guardian");
    let carol = node("carol");
    let dave = node("dave");
    let mut base = Dataset::new();
    base.insert(quad(&student, &owl("equivalentClass"), person.clone()));
    base.insert(quad(&alice, &rdf::TYPE, student.clone()));
    base.insert(quad(&bob, &rdf::TYPE, person.clone()));
    base.insert(quad(&parent, &owl("equivalentProperty"), guardian.clone()));
    base.insert(quad(&alice, &parent, bob.clone()));
    base.insert(quad(&carol, &guardian, dave.clone()));

    let closure = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();

    for expected in [
        quad(&alice, &rdf::TYPE, person),
        quad(&bob, &rdf::TYPE, student),
        quad(&alice, &guardian, bob),
        quad(&carol, &parent, dave),
    ] {
        assert!(contains(closure.inference(), &expected), "{expected}");
    }
}

#[test]
fn named_same_as_closes_and_replaces_subject_predicate_and_object() {
    let alice = node("alice");
    let alicia = node("alicia");
    let ally = node("ally");
    let bob = node("bob");
    let robert = node("robert");
    let knows = node("knows");
    let acquainted = node("acquainted");
    let mut base = Dataset::new();
    base.insert(quad(&alice, &owl("sameAs"), alicia.clone()));
    base.insert(quad(&alicia, &owl("sameAs"), ally.clone()));
    base.insert(quad(&bob, &owl("sameAs"), robert.clone()));
    base.insert(quad(&knows, &owl("sameAs"), acquainted.clone()));
    base.insert(quad(&alice, &knows, bob.clone()));

    let closure = Owl2RlPositiveSeed::new()
        .evaluate(
            &base,
            &EvaluationOptions {
                track_provenance: true,
                ..EvaluationOptions::default()
            },
        )
        .unwrap();

    let replaced_subject = quad(&alicia, &knows, bob.clone());
    for expected in [
        quad(&alicia, &owl("sameAs"), alice.clone()),
        quad(&alice, &owl("sameAs"), ally.clone()),
        replaced_subject.clone(),
        quad(&alice, &acquainted, bob),
        quad(&alice, &knows, robert),
    ] {
        assert!(contains(closure.inference(), &expected), "{expected}");
    }
    let derivation = closure
        .evaluation()
        .provenance()
        .unwrap()
        .derivation(&fact_from_quad(replaced_subject))
        .unwrap();
    assert_eq!(derivation.rule_id().as_str(), "eq-rep-s");
    assert_eq!(
        derivation.rule_source(),
        Some(
            "https://www.w3.org/TR/2012/\
             REC-owl2-profiles-20121211/#eq-rep-s"
        )
    );
}

#[test]
fn same_as_cannot_bypass_functional_property_rejection() {
    let property = node("property");
    let functional_alias = node("functionalAlias");
    let mut base = Dataset::new();
    base.insert(quad(
        &functional_alias,
        &owl("sameAs"),
        owl("FunctionalProperty"),
    ));
    base.insert(quad(&property, &rdf::TYPE, functional_alias));

    let error = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap_err();

    assert!(matches!(
        error,
        Owl2RlSeedError::Input(
            Owl2RlSeedInputError::EqualityCanReachUnsupportedOwlVocabulary {
                construct,
                ..
            }
        ) if construct == owl("FunctionalProperty")
    ));
}

#[test]
fn predicate_equality_cannot_introduce_unsupported_owl_vocabulary() {
    let subject = node("subject");
    let object = node("object");
    let predicate_alias = node("predicateAlias");
    let mut base = Dataset::new();
    base.insert(quad(
        &predicate_alias,
        &owl("sameAs"),
        owl("propertyChainAxiom"),
    ));
    base.insert(quad(&subject, &predicate_alias, object));

    let error = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap_err();

    assert!(matches!(
        error,
        Owl2RlSeedError::Input(
            Owl2RlSeedInputError::EqualityCanReachUnsupportedOwlVocabulary {
                construct,
                ..
            }
        ) if construct == owl("propertyChainAxiom")
    ));
}

#[test]
fn equality_rejects_indirect_rdf_type_substitution_of_unsupported_owl_vocabulary() {
    let subject = node("subject");
    let type_alias = node("typeAlias");
    let mut base = Dataset::new();
    base.insert(quad(&type_alias, &owl("sameAs"), rdf::TYPE));
    base.insert(quad(&subject, &type_alias, owl("FunctionalProperty")));

    let error = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap_err();

    assert!(matches!(
        error,
        Owl2RlSeedError::Input(
            Owl2RlSeedInputError::EqualityCanReachUnsupportedOwlVocabulary {
                construct,
                ..
            }
        ) if construct == owl("FunctionalProperty")
    ));
}

#[test]
fn unsupported_constructs_fail_closed_before_evaluation() {
    let parent = node("parent");
    let chain = node("chain");
    let mut base = Dataset::new();
    base.insert(quad(&parent, &owl("propertyChainAxiom"), chain));

    let error = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap_err();

    assert!(matches!(
        error,
        Owl2RlSeedError::Input(Owl2RlSeedInputError::UnsupportedOwlConstruct { .. })
    ));
}

#[test]
fn full_owl2_rl_rdf_conformance_claim_is_typed_and_rejected() {
    let seed = Owl2RlPositiveSeed::new();
    assert_eq!(
        Owl2RlPositiveSeed::profile_id(),
        OWL2_RL_RDF_POSITIVE_SEED_PROFILE
    );
    let rules = Owl2RlPositiveSeed::implemented_rules();
    assert_eq!(
        rules.iter().map(|rule| rule.id()).collect::<Vec<_>>(),
        [
            "eq-sym", "eq-trans", "eq-rep-s", "eq-rep-p", "eq-rep-o", "scm-sco", "scm-spo",
            "cax-sco", "cax-eqc1", "cax-eqc2", "prp-spo1", "prp-eqp1", "prp-eqp2", "prp-dom",
            "prp-rng", "prp-trp", "prp-symp", "prp-inv1", "prp-inv2",
        ]
    );
    for rule in rules {
        assert_eq!(
            rule.source(),
            format!(
                "https://www.w3.org/TR/2012/\
                 REC-owl2-profiles-20121211/#{}",
                rule.id()
            )
        );
    }
    let error = seed.require_full_conformance().unwrap_err();
    assert_eq!(error.requested(), OWL2_RL_RDF_PROFILE);
    assert_eq!(error.available(), OWL2_RL_RDF_POSITIVE_SEED_PROFILE);
    assert_eq!(error.implemented_rule_count(), 19);
}

#[test]
fn receipt_names_only_the_positive_seed_and_stable_rules() {
    let alice = node("alice");
    let student = node("Student");
    let person = node("Person");
    let mut base = Dataset::new();
    base.insert(quad(&alice, &rdf::TYPE, student.clone()));
    base.insert(quad(&student, &rdfs::SUB_CLASS_OF, person));
    let reasoner = Owl2RlPositiveSeed::new();
    let closure = reasoner
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();
    accepts_only_seed_closure(&closure);
    let receipt = reasoner.receipt(&closure);

    assert_eq!(receipt.profile(), OWL2_RL_RDF_POSITIVE_SEED_PROFILE);
    assert_ne!(receipt.profile(), OWL2_RL_RDF_PROFILE);
    assert_eq!(receipt.implemented_rule_ids().len(), 19);
    assert_eq!(receipt.base_quads(), 2);
    assert_eq!(receipt.derived_quads(), 1);
    assert!(
        receipt
            .canonical_text()
            .contains("implemented-rules=eq-sym")
    );
    assert!(receipt.canonical_text().contains("scm-sco"));
    assert!(
        receipt
            .canonical_text()
            .contains("profile=owl2-rl-rdf-positive-seed")
    );
}

#[test]
fn seed_validation_observes_cancellation_and_fact_limits() {
    let subject = node("subject");
    let predicate = node("predicate");
    let object = node("object");
    let mut base = Dataset::new();
    base.insert(quad(&subject, &predicate, object));

    let cancelled = EvaluationOptions::default();
    cancelled.cancellation_token.cancel();
    let error = Owl2RlPositiveSeed::new()
        .evaluate(&base, &cancelled)
        .unwrap_err();
    assert!(matches!(
        error,
        Owl2RlSeedError::Evaluation(RdfEvaluationError::Evaluation(EvaluationError::Cancelled))
    ));

    let mut limited = EvaluationOptions::default();
    limited.limits.max_facts = 0;
    let error = Owl2RlPositiveSeed::new()
        .evaluate(&base, &limited)
        .unwrap_err();
    assert!(matches!(
        error,
        Owl2RlSeedError::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Facts,
                limit: 0
            }
        ))
    ));

    let mut timed_out = EvaluationOptions::default();
    timed_out.limits.timeout = Some(Duration::ZERO);
    let error = Owl2RlPositiveSeed::new()
        .evaluate(&base, &timed_out)
        .unwrap_err();
    assert!(matches!(
        error,
        Owl2RlSeedError::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Time,
                limit: 0
            }
        ))
    ));
}
