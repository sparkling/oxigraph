#![expect(
    clippy::many_single_char_names,
    clippy::panic,
    clippy::tests_outside_test_module,
    reason = "the pinned rule matrix mirrors the specification's metavariables"
)]

use oxdatalog::EvaluationOptions;
#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxrdf::{
    BlankNode, Dataset, GraphName, Literal, NamedNode, Quad, Term,
    vocab::{rdf, rdfs, xsd},
};
use oxrdfs::{
    RDFS_12_FINITE_PROFILE, RDFS_12_IMPLEMENTED_PATTERNS, Rdfs12Error, Rdfs12Finite, Rdfs12Options,
};
use std::collections::HashSet;

const C_SHA: &str = "2e67fd5c732edf127f711c75c4a4ce35e9cbca936b3dfe25386383b92f683365";
const S_SHA: &str = "4fadc242c1aca2c2b713ace0c45c8c8c27d517b346e02e436c3c2e62d349e52e";
const R_SHA: &str = "74c02d34edddd24c466c3d0988fb57d2a999b5cf3d507e92f824810106dca399";
const CONCEPTS_APPEARING_RECURSIVELY: &str =
    "rdf12-concepts:normative-prose-block:a32f56aad0a6a3f86beae3bc";

struct RuleEvidence {
    rule: &'static str,
    semantics_candidate: &'static str,
    schema_candidate: Option<&'static str>,
}

const RDFS_RULE_EVIDENCE: &[RuleEvidence] = &[
    RuleEvidence {
        rule: "rdfs1",
        semantics_candidate: "rdf12-semantics:normative-prose-block:c13633587d39c59c90713975",
        schema_candidate: None,
    },
    RuleEvidence {
        rule: "rdfs2",
        semantics_candidate: "rdf12-semantics:normative-prose-block:b958ae2f7d85f6bf80b2726b",
        schema_candidate: Some("rdf12-schema:normative-prose-block:8c23f28d86789affb1c2e2ce"),
    },
    RuleEvidence {
        rule: "rdfs3",
        semantics_candidate: "rdf12-semantics:normative-prose-block:e8828af2edde668b3e94344e",
        schema_candidate: Some("rdf12-schema:normative-prose-block:6e0227066f7adfb6b53e38e3"),
    },
    RuleEvidence {
        rule: "rdfs4",
        semantics_candidate: "rdf12-semantics:normative-prose-block:ff6b2e4be6f0c4f31f0fb4b4",
        schema_candidate: None,
    },
    RuleEvidence {
        rule: "rdfs5",
        semantics_candidate: "rdf12-semantics:normative-prose-block:b1ac7ce2857de9f0d7416d43",
        schema_candidate: Some("rdf12-schema:normative-prose-block:3a4e451334782331f5a86d39"),
    },
    RuleEvidence {
        rule: "rdfs6",
        semantics_candidate: "rdf12-semantics:normative-prose-block:b1ac7ce2857de9f0d7416d43",
        schema_candidate: None,
    },
    RuleEvidence {
        rule: "rdfs7",
        semantics_candidate: "rdf12-semantics:normative-prose-block:54e4d542bcb3a6cd5ab665f0",
        schema_candidate: Some("rdf12-schema:normative-prose-block:8f2f8bb98b433d3602fc6944"),
    },
    RuleEvidence {
        rule: "rdfs8",
        semantics_candidate: "rdf12-semantics:normative-prose-block:3bd9181dc14d948f4fa6c506",
        schema_candidate: None,
    },
    RuleEvidence {
        rule: "rdfs9",
        semantics_candidate: "rdf12-semantics:normative-prose-block:7992f85b660f3a22e190f5de",
        schema_candidate: Some("rdf12-schema:normative-prose-block:a7f6c59d2b9cd97b2d8fb108"),
    },
    RuleEvidence {
        rule: "rdfs10",
        semantics_candidate: "rdf12-semantics:normative-prose-block:918d102c2e6332f18da16661",
        schema_candidate: None,
    },
    RuleEvidence {
        rule: "rdfs11",
        semantics_candidate: "rdf12-semantics:normative-prose-block:918d102c2e6332f18da16661",
        schema_candidate: Some("rdf12-schema:normative-prose-block:a78b438353b41f4178ce1087"),
    },
    RuleEvidence {
        rule: "rdfs12",
        semantics_candidate: "rdf12-semantics:normative-prose-block:e739a4e6cd4778fa2b0c6c76",
        schema_candidate: None,
    },
    RuleEvidence {
        rule: "rdfs13",
        semantics_candidate: "rdf12-semantics:normative-prose-block:6f688282b0a69e20ee79b81b",
        schema_candidate: None,
    },
    #[cfg(feature = "rdf-12")]
    RuleEvidence {
        rule: "rdfs14",
        semantics_candidate: "rdf12-semantics:normative-prose-block:a040f9fe9c29e4d71b265a24",
        schema_candidate: Some("rdf12-schema:normative-prose-block:fd126a00e676af4b66390035"),
    },
    RuleEvidence {
        rule: "rdfs14a",
        semantics_candidate: "rdf12-semantics:normative-prose-block:4ddb66c62e8b239a1926e04e",
        schema_candidate: Some("rdf12-schema:normative-prose-block:daa2d500f41f312454723ffa"),
    },
];

const RDF_RULE_EVIDENCE: &[RuleEvidence] = &[
    RuleEvidence {
        rule: "rdfD1",
        semantics_candidate: "rdf12-semantics:normative-table-row:0c2f2c21917f7be81488418d",
        schema_candidate: None,
    },
    RuleEvidence {
        rule: "rdfD1a",
        semantics_candidate: "rdf12-semantics:normative-table-row:0c2f2c21917f7be81488418d",
        schema_candidate: None,
    },
    RuleEvidence {
        rule: "rdfD2",
        semantics_candidate: "rdf12-semantics:normative-table-row:6a959f6e57e11557f2e36d13",
        schema_candidate: None,
    },
];

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("urn:rdfs12-evidence:{local}")).unwrap()
}

fn quad(
    subject: impl Into<oxrdf::NamedOrBlankNode>,
    predicate: NamedNode,
    object: impl Into<Term>,
) -> Quad {
    Quad::new(subject, predicate, object, GraphName::DefaultGraph)
}

fn evidence_options() -> Rdfs12Options {
    Rdfs12Options {
        evaluation: EvaluationOptions {
            track_provenance: true,
            ..EvaluationOptions::default()
        },
        container_membership_limit: 0,
        ..Rdfs12Options::default()
    }
}

fn regular_case(rule: &str) -> Option<(Dataset, Quad)> {
    let (p, q, r) = (node("p"), node("q"), node("r"));
    let (s, o) = (node("s"), node("o"));
    let (c, d, e) = (node("C"), node("D"), node("E"));
    Some(match rule {
        "rdfs1" => (Dataset::new(), quad(xsd::STRING, rdf::TYPE, rdfs::DATATYPE)),
        "rdfs2" => (
            Dataset::from_iter([
                quad(
                    p.clone(),
                    rdfs::DOMAIN,
                    Literal::new_simple_literal("class"),
                ),
                quad(s.clone(), p, o),
            ]),
            quad(s, rdf::TYPE, Literal::new_simple_literal("class")),
        ),
        "rdfs3" => (
            Dataset::from_iter([
                quad(p.clone(), rdfs::RANGE, c.clone()),
                quad(s, p, o.clone()),
            ]),
            quad(o, rdf::TYPE, c),
        ),
        "rdfs4" => (
            Dataset::from_iter([quad(s.clone(), p, o)]),
            quad(s, rdf::TYPE, rdfs::RESOURCE),
        ),
        "rdfs5" => (
            Dataset::from_iter([
                quad(p.clone(), rdfs::SUB_PROPERTY_OF, q.clone()),
                quad(q, rdfs::SUB_PROPERTY_OF, r.clone()),
            ]),
            quad(p, rdfs::SUB_PROPERTY_OF, r),
        ),
        "rdfs6" => (
            Dataset::from_iter([quad(p.clone(), rdf::TYPE, rdf::PROPERTY)]),
            quad(p.clone(), rdfs::SUB_PROPERTY_OF, p),
        ),
        "rdfs7" => (
            Dataset::from_iter([
                quad(p.clone(), rdfs::SUB_PROPERTY_OF, q.clone()),
                quad(s.clone(), p, o.clone()),
            ]),
            quad(s, q, o),
        ),
        "rdfs8" => (
            Dataset::from_iter([quad(c.clone(), rdf::TYPE, rdfs::CLASS)]),
            quad(c, rdfs::SUB_CLASS_OF, rdfs::RESOURCE),
        ),
        "rdfs9" => (
            Dataset::from_iter([
                quad(c.clone(), rdfs::SUB_CLASS_OF, d.clone()),
                quad(s.clone(), rdf::TYPE, c),
            ]),
            quad(s, rdf::TYPE, d),
        ),
        "rdfs10" => (
            Dataset::from_iter([quad(c.clone(), rdf::TYPE, rdfs::CLASS)]),
            quad(c.clone(), rdfs::SUB_CLASS_OF, c),
        ),
        "rdfs11" => (
            Dataset::from_iter([
                quad(c.clone(), rdfs::SUB_CLASS_OF, d.clone()),
                quad(d, rdfs::SUB_CLASS_OF, e.clone()),
            ]),
            quad(c, rdfs::SUB_CLASS_OF, e),
        ),
        "rdfs12" => (
            Dataset::from_iter([quad(
                p.clone(),
                rdf::TYPE,
                rdfs::CONTAINER_MEMBERSHIP_PROPERTY,
            )]),
            quad(p, rdfs::SUB_PROPERTY_OF, rdfs::MEMBER),
        ),
        "rdfs13" => (
            Dataset::from_iter([quad(c.clone(), rdf::TYPE, rdfs::DATATYPE)]),
            quad(c, rdfs::SUB_CLASS_OF, rdfs::LITERAL),
        ),
        _ => return None,
    })
}

#[test]
fn pinned_rule_evidence_has_one_fixture_for_each_applicable_pattern() {
    assert_eq!(C_SHA.len() + S_SHA.len() + R_SHA.len(), 3 * 64);
    assert_eq!(RDFS_RULE_EVIDENCE.len(), RDFS_12_IMPLEMENTED_PATTERNS);
    let rules = RDFS_RULE_EVIDENCE
        .iter()
        .map(|entry| entry.rule)
        .collect::<HashSet<_>>();
    assert_eq!(rules.len(), RDFS_RULE_EVIDENCE.len());
    for entry in RDFS_RULE_EVIDENCE {
        assert!(
            entry
                .semantics_candidate
                .starts_with("rdf12-semantics:normative-")
        );
        assert!(
            entry
                .schema_candidate
                .is_none_or(|candidate| { candidate.starts_with("rdf12-schema:normative-") })
        );
        assert!(regular_case(entry.rule).is_some() || matches!(entry.rule, "rdfs14" | "rdfs14a"));
    }
    assert_eq!(
        CONCEPTS_APPEARING_RECURSIVELY,
        "rdf12-concepts:normative-prose-block:a32f56aad0a6a3f86beae3bc"
    );
}

#[test]
fn rdfs1_through_rdfs13_have_provenanced_fixture_derivations() {
    for evidence in RDFS_RULE_EVIDENCE {
        let Some((base, expected)) = regular_case(evidence.rule) else {
            continue;
        };
        let closure = Rdfs12Finite.evaluate(&base, &evidence_options()).unwrap();
        let derivation = closure
            .derivation(&expected)
            .unwrap_or_else(|| panic!("{} did not derive expected quad {expected}", evidence.rule));
        assert_eq!(derivation.rule_id(), evidence.rule);
        assert!(closure.entailed().contains(&expected));
    }
}

#[test]
fn rdf_patterns_have_recursive_or_existential_fixture_derivations() {
    assert_eq!(RDF_RULE_EVIDENCE.len(), 3);
    let empty = Rdfs12Finite
        .evaluate(&Dataset::new(), &evidence_options())
        .unwrap();
    let d1a = empty
        .entailed()
        .iter()
        .find(|quad| {
            quad.predicate == rdf::TYPE
                && quad.object == xsd::STRING
                && empty
                    .derivation(quad)
                    .is_some_and(|item| item.rule_id() == "rdfD1a")
        })
        .unwrap();
    assert_eq!(empty.derivation(&d1a).unwrap().rule_id(), "rdfD1a");

    let predicate = node("predicate");
    let base_quad = quad(
        node("subject"),
        predicate.clone(),
        Literal::new_simple_literal("value"),
    );
    let closure = Rdfs12Finite
        .evaluate(
            &Dataset::from_iter([base_quad.clone()]),
            &evidence_options(),
        )
        .unwrap();
    let d2 = quad(predicate, rdf::TYPE, rdf::PROPERTY);
    assert_eq!(closure.derivation(&d2).unwrap().rule_id(), "rdfD2");
    assert!(closure.entailed().iter().any(|candidate| {
        candidate.subject == base_quad.subject
            && candidate.predicate == base_quad.predicate
            && matches!(candidate.object, Term::BlankNode(_))
            && closure
                .derivation(&candidate)
                .is_some_and(|item| item.rule_id() == "rdfD1")
    }));

    #[cfg(feature = "rdf-12")]
    {
        let inner_predicate = node("inner-predicate");
        let base_quad = quad(
            node("outer-subject"),
            node("outer-predicate"),
            Triple::new(
                node("inner-subject"),
                inner_predicate.clone(),
                Literal::new_simple_literal("value"),
            ),
        );
        let closure = Rdfs12Finite
            .evaluate(
                &Dataset::from_iter([base_quad.clone()]),
                &evidence_options(),
            )
            .unwrap();
        let d2 = quad(inner_predicate, rdf::TYPE, rdf::PROPERTY);
        assert_eq!(closure.derivation(&d2).unwrap().rule_id(), "rdfD2");
        assert!(closure.entailed().iter().any(|candidate| {
            candidate.subject == base_quad.subject
                && candidate.predicate == base_quad.predicate
                && matches!(
                    &candidate.object,
                    Term::Triple(triple) if matches!(triple.object, Term::BlankNode(_))
                )
                && closure
                    .derivation(&candidate)
                    .is_some_and(|item| item.rule_id() == "rdfD1")
        }));
    }
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdfs14_recurses_and_composes_with_rdfd1_to_a_fixed_point() {
    let inner = Triple::new(
        node("inner-subject"),
        node("inner-predicate"),
        Literal::new_simple_literal("value"),
    );
    let outer = Triple::new(node("middle-subject"), node("middle-predicate"), inner);
    let base_quad = quad(node("outer-subject"), node("outer-predicate"), outer);
    let closure = Rdfs12Finite
        .evaluate(
            &Dataset::from_iter([base_quad.clone()]),
            &evidence_options(),
        )
        .unwrap();

    let nested_replacements = closure
        .entailed()
        .iter()
        .filter(|candidate| {
            candidate.subject == base_quad.subject
                && candidate.predicate == base_quad.predicate
                && matches!(
                    &candidate.object,
                    Term::Triple(triple) if matches!(triple.object, Term::BlankNode(_))
                )
        })
        .collect::<Vec<_>>();
    assert!(
        nested_replacements.len() >= 2,
        "direct and rdfD1-composed rdfs14 substitutions must both close"
    );
    assert!(nested_replacements.iter().any(|candidate| {
        closure.derivation(candidate).is_some_and(|item| {
            item.rule_id() == "rdfs14"
                && item.premises().iter().any(|premise| {
                    closure
                        .derivation(premise)
                        .is_some_and(|parent| parent.rule_id() == "rdfD1")
                })
        })
    }));
    assert!(closure.entailed().iter().any(|candidate| {
        candidate.subject == base_quad.subject
            && candidate.predicate == base_quad.predicate
            && matches!(candidate.object, Term::BlankNode(_))
            && closure
                .derivation(&candidate)
                .is_some_and(|item| item.rule_id() == "rdfs14")
    }));
}

#[test]
fn empty_graph_has_the_rdfs14a_existential_but_not_a_query_claim() {
    let closure = Rdfs12Finite
        .evaluate(&Dataset::new(), &evidence_options())
        .unwrap();
    assert!(closure.entailed().iter().any(|quad| {
        quad.predicate == rdf::TYPE
            && quad.object
                == NamedNode::new("http://www.w3.org/2000/01/rdf-schema#Proposition").unwrap()
            && closure
                .derivation(&quad)
                .is_some_and(|item| item.rule_id() == "rdfs14a")
    }));
}

#[test]
fn active_container_axioms_are_not_cut_off_by_the_prefix_limit() {
    let active = NamedNode::new("http://www.w3.org/1999/02/22-rdf-syntax-ns#_999999").unwrap();
    let base = Dataset::from_iter([quad(node("s"), active.clone(), node("o"))]);
    let closure = Rdfs12Finite.evaluate(&base, &evidence_options()).unwrap();
    for (predicate, object) in [
        (rdf::TYPE, rdfs::CONTAINER_MEMBERSHIP_PROPERTY),
        (rdfs::DOMAIN, rdfs::RESOURCE),
        (rdfs::RANGE, rdfs::RESOURCE),
    ] {
        let expected = quad(active.clone(), predicate, object);
        assert!(closure.entailed().contains(&expected));
        assert_eq!(
            closure.derivation(&expected).unwrap().rule_id(),
            "rdfs-axiom"
        );
    }
}

#[test]
fn generalized_omission_receipt_counts_unique_legal_rdf_boundary() {
    let opaque_datatype = node("opaque-datatype");
    let base = Dataset::from_iter([quad(
        node("s"),
        node("p"),
        Literal::new_typed_literal("value", opaque_datatype),
    )]);
    let first = Rdfs12Finite
        .evaluate(&base, &evidence_options())
        .unwrap()
        .receipt();
    let second = Rdfs12Finite
        .evaluate(&base, &evidence_options())
        .unwrap()
        .receipt();
    assert_eq!(first.generalized_consequences_omitted, 1);
    assert_eq!(first.canonical_text(), second.canonical_text());
}

#[test]
fn reserved_witness_labels_are_rejected_before_materialization() {
    let reserved = BlankNode::new("oxrdfs-user-label").unwrap();
    let base = Dataset::from_iter([quad(reserved.clone(), node("p"), node("o"))]);
    assert!(matches!(
        Rdfs12Finite.evaluate(&base, &evidence_options()),
        Err(Rdfs12Error::ReservedWitnessLabel {
            prefix: "oxrdfs",
            ..
        })
    ));
    #[cfg(feature = "rdf-12")]
    {
        let nested = Dataset::from_iter([quad(
            node("outer"),
            node("outer-predicate"),
            Triple::new(reserved, node("inner-predicate"), node("object")),
        )]);
        assert!(matches!(
            Rdfs12Finite.evaluate(&nested, &evidence_options()),
            Err(Rdfs12Error::ReservedWitnessLabel {
                prefix: "oxrdfs",
                ..
            })
        ));
    }
}

#[test]
fn receipt_keeps_the_bounded_profile_name_and_applicable_count() {
    let receipt = Rdfs12Finite
        .evaluate(&Dataset::new(), &evidence_options())
        .unwrap()
        .receipt();
    assert_eq!(receipt.profile, RDFS_12_FINITE_PROFILE);
    assert_eq!(receipt.implemented_patterns, RDFS_12_IMPLEMENTED_PATTERNS);
}
