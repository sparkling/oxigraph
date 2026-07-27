#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public RDFS 1.2 profile"
)]

use oxdatalog::{EvaluationError, LimitKind, rdf::RdfEvaluationError};
use oxrdf::{
    Dataset, GraphName, Literal, NamedNode, Quad, Term,
    vocab::{rdf, rdfs, xsd},
};
use oxrdfs::{
    RDFS_12_FINITE_PROFILE, RDFS_12_IMPLEMENTED_PATTERNS, Rdfs12Error, Rdfs12Finite, Rdfs12Options,
};

const PROFILE_EVIDENCE: &[(&str, &str)] = &[
    (
        "rdf12-semantics:bcp14-clause:9e458eeb84621ac667f63580",
        "mandatory_rdf12_datatypes_cannot_be_removed_from_public_options",
    ),
    (
        "rdf12-semantics:normative-table-row:d66ab16229407c04bb757ef0",
        "empty_graph_gets_finite_axioms_and_existential_witness",
    ),
    (
        "rdf12-semantics:normative-table-row:01a8ffd9d602c340611833d2",
        "empty_graph_gets_finite_axioms_and_existential_witness",
    ),
];

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("http://example.com/{local}")).unwrap()
}

fn quad(subject: &NamedNode, predicate: &NamedNode, object: impl Into<Term>) -> Quad {
    Quad::new(
        subject.clone(),
        predicate.clone(),
        object,
        GraphName::DefaultGraph,
    )
}

#[test]
fn mandatory_datatype_and_axiom_evidence_is_pinned_to_tests() {
    assert!(PROFILE_EVIDENCE.iter().all(|(candidate, test)| {
        candidate.starts_with("rdf12-semantics:") && !test.is_empty()
    }));
}

#[test]
fn empty_graph_gets_finite_axioms_and_existential_witness() {
    let mut options = Rdfs12Options::default();
    options.evaluation.track_provenance = true;
    let closure = Rdfs12Finite.evaluate(&Dataset::new(), &options).unwrap();
    let member = NamedNode::new("http://www.w3.org/1999/02/22-rdf-syntax-ns#_1").unwrap();
    assert!(closure.entailed().contains(&quad(
        &member,
        &rdf::TYPE,
        rdfs::CONTAINER_MEMBERSHIP_PROPERTY
    )));
    assert!(
        closure
            .entailed()
            .iter()
            .any(|item| { item.predicate == rdf::TYPE && item.object == rdfs::PROPOSITION })
    );
    for expected in [
        quad(&rdf::REIFIES, &rdf::TYPE, rdf::PROPERTY),
        quad(&rdfs::PROPOSITION, &rdfs::SUB_CLASS_OF, rdfs::RESOURCE),
    ] {
        assert!(closure.entailed().contains(&expected));
        assert_eq!(
            closure.derivation(&expected).unwrap().rule_id(),
            "rdfs-axiom"
        );
    }
    assert_eq!(closure.receipt().profile, RDFS_12_FINITE_PROFILE);
    assert_eq!(
        closure.receipt().implemented_patterns,
        RDFS_12_IMPLEMENTED_PATTERNS
    );
}

#[test]
fn explicitly_empty_named_graph_gets_graph_local_axioms() {
    let graph = node("empty-named");
    let mut base = Dataset::new();
    base.insert_named_graph(graph.clone());

    let closure = Rdfs12Finite
        .evaluate(&base, &Rdfs12Options::default())
        .unwrap();
    assert!(closure.base().contains_named_graph(&graph));
    assert!(closure.entailed().contains_named_graph(&graph));
    assert!(
        closure
            .entailed()
            .contains(&Quad::new(rdf::TYPE, rdf::TYPE, rdf::PROPERTY, graph,))
    );
}

#[test]
#[cfg(feature = "rdf-12")]
fn reifies_range_types_propositions() {
    let subject = node("reifier");
    let object = node("proposition");
    let base = Dataset::from_iter([quad(&subject, &rdf::REIFIES, object.clone())]);
    let closure = Rdfs12Finite
        .evaluate(&base, &Rdfs12Options::default())
        .unwrap();
    assert!(
        closure
            .entailed()
            .contains(&quad(&object, &rdf::TYPE, rdfs::PROPOSITION))
    );
}

#[cfg(feature = "rdf-12")]
#[test]
fn triple_terms_get_deterministic_proposition_witnesses() {
    use oxrdf::Triple;

    let subject = node("subject");
    let predicate = node("predicate");
    let triple = Triple::new(node("s"), node("p"), node("o"));
    let base = Dataset::from_iter([quad(&subject, &predicate, triple)]);
    let first = Rdfs12Finite
        .evaluate(&base, &Rdfs12Options::default())
        .unwrap();
    let second = Rdfs12Finite
        .evaluate(&base, &Rdfs12Options::default())
        .unwrap();
    let witness = first
        .entailed()
        .iter()
        .find(|item| item.subject == subject && item.predicate == predicate)
        .and_then(|item| match item.object {
            Term::BlankNode(node) => Some(node),
            _ => None,
        })
        .unwrap();
    assert!(first.entailed().contains(&Quad::new(
        witness,
        rdf::TYPE,
        rdfs::PROPOSITION,
        GraphName::DefaultGraph,
    )));
    assert_eq!(
        first.receipt().canonical_inference_nquads,
        second.receipt().canonical_inference_nquads
    );
}

#[test]
fn recognized_ill_typed_and_range_clash_inputs_are_inconsistent() {
    let subject = node("subject");
    let property = node("property");
    let ill_typed = Dataset::from_iter([quad(
        &subject,
        &property,
        Literal::new_typed_literal(" flargh ", xsd::INTEGER),
    )]);
    let integer_options = Rdfs12Options::default().with_recognized_datatypes([xsd::INTEGER]);
    assert!(
        !Rdfs12Finite
            .evaluate(&ill_typed, &integer_options)
            .unwrap()
            .is_consistent()
    );

    let range_clash = Dataset::from_iter([
        quad(&property, &rdfs::RANGE, xsd::STRING),
        quad(
            &subject,
            &property,
            Literal::new_typed_literal("25", xsd::INTEGER),
        ),
    ]);
    let options = Rdfs12Options::default().with_recognized_datatypes([xsd::INTEGER, xsd::STRING]);
    assert!(
        !Rdfs12Finite
            .evaluate(&range_clash, &options)
            .unwrap()
            .is_consistent()
    );
}

#[test]
fn unrecognized_ill_typed_literal_remains_opaque() {
    let property = node("property");
    let base = Dataset::from_iter([quad(
        &node("subject"),
        &property,
        Literal::new_typed_literal("flargh", xsd::INTEGER),
    )]);
    let options = Rdfs12Options::default().with_recognized_datatypes([]);
    assert!(
        Rdfs12Finite
            .evaluate(&base, &options)
            .unwrap()
            .is_consistent()
    );

    let ranged = Dataset::from_iter([
        quad(&property, &rdfs::RANGE, xsd::STRING),
        quad(
            &node("subject"),
            &property,
            Literal::new_typed_literal("flargh", xsd::INTEGER),
        ),
    ]);
    assert!(
        Rdfs12Finite
            .evaluate(&ranged, &options)
            .unwrap()
            .is_consistent()
    );
}

#[test]
fn mandatory_rdf12_datatypes_cannot_be_removed_from_public_options() {
    let mut options = Rdfs12Options::default();
    options.recognized_datatypes.clear();
    let closure = Rdfs12Finite.evaluate(&Dataset::new(), &options).unwrap();
    let dir_lang_string =
        NamedNode::new("http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString").unwrap();

    for datatype in [xsd::STRING, rdf::LANG_STRING, dir_lang_string] {
        assert!(
            closure
                .entailed()
                .contains(&quad(&datatype, &rdf::TYPE, rdfs::DATATYPE))
        );
    }
}

#[test]
fn unsupported_recognized_datatype_is_rejected() {
    let datatype = node("customDatatype");
    let options = Rdfs12Options::default().with_recognized_datatypes([datatype.clone()]);
    let error = Rdfs12Finite
        .evaluate(&Dataset::new(), &options)
        .unwrap_err();
    assert!(matches!(
        error,
        Rdfs12Error::UnsupportedRecognizedDatatype {
            datatype: rejected
        } if rejected == datatype
    ));
}

#[test]
fn mandatory_xsd_string_uses_its_rdf12_lexical_space() {
    let subject = node("subject");
    let property = node("property");
    let legal = Dataset::from_iter([quad(
        &subject,
        &property,
        Literal::new_simple_literal("\u{1}"),
    )]);
    assert!(
        Rdfs12Finite
            .evaluate(&legal, &Rdfs12Options::default())
            .unwrap()
            .is_consistent()
    );

    let illegal = Dataset::from_iter([quad(
        &subject,
        &property,
        Literal::new_simple_literal("\u{FFFF}"),
    )]);
    assert!(
        !Rdfs12Finite
            .evaluate(&illegal, &Rdfs12Options::default())
            .unwrap()
            .is_consistent()
    );
}

#[test]
fn supported_numeric_datatypes_have_checked_lexical_mappings() {
    let subject = node("subject");
    let property = node("property");
    let huge_integer = "999999999999999999999999999999999999999999999999999999";
    let legal = Dataset::from_iter([
        quad(&property, &rdfs::RANGE, xsd::DECIMAL),
        quad(
            &subject,
            &property,
            Literal::new_typed_literal(huge_integer, xsd::INTEGER),
        ),
        quad(
            &subject,
            &node("decimal"),
            Literal::new_typed_literal(".5", xsd::DECIMAL),
        ),
    ]);
    let options = Rdfs12Options::default().with_recognized_datatypes([xsd::INTEGER, xsd::DECIMAL]);
    assert!(
        Rdfs12Finite
            .evaluate(&legal, &options)
            .unwrap()
            .is_consistent()
    );

    for (lexical_form, datatype) in [
        (".", xsd::DECIMAL),
        ("inf", xsd::FLOAT),
        ("+INF", xsd::DOUBLE),
        ("truthy", xsd::BOOLEAN),
    ] {
        let base = Dataset::from_iter([quad(
            &subject,
            &property,
            Literal::new_typed_literal(lexical_form, datatype.clone()),
        )]);
        let options = Rdfs12Options::default().with_recognized_datatypes([datatype]);
        assert!(
            !Rdfs12Finite
                .evaluate(&base, &options)
                .unwrap()
                .is_consistent()
        );
    }
}

#[test]
fn malformed_recognized_xml_literal_is_inconsistent() {
    let base = Dataset::from_iter([quad(
        &node("subject"),
        &node("property"),
        Literal::new_typed_literal("<", rdf::XML_LITERAL),
    )]);
    let options = Rdfs12Options::default().with_recognized_datatypes([rdf::XML_LITERAL]);
    assert!(
        !Rdfs12Finite
            .evaluate(&base, &options)
            .unwrap()
            .is_consistent()
    );
}

#[test]
fn validation_and_materialization_observe_limits() {
    let mut options = Rdfs12Options::default();
    options.evaluation.limits.max_facts = 1;
    let error = Rdfs12Finite
        .evaluate(&Dataset::new(), &options)
        .unwrap_err();
    assert!(matches!(
        error,
        Rdfs12Error::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Facts,
                limit: 1
            }
        ))
    ));
}
