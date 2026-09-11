use super::*;

const SUBJECT: &str = "urn:rdf12:s";
const PREDICATE: &str = "urn:rdf12:p";
const OBJECT: &str = "urn:rdf12:o";
const GRAPH: &str = "urn:rdf12:g";
const RDF_DIR_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";

fn field(value: &str) -> Vec<u8> {
    [
        (value.len() as u64).to_be_bytes().as_slice(),
        value.as_bytes(),
    ]
    .concat()
}

fn iri(value: &str) -> Vec<u8> {
    [vec![1], field(value)].concat()
}

fn blank(value: &str) -> Vec<u8> {
    [vec![2], field(value)].concat()
}

fn literal(value: &str, datatype: &str, language: Option<&str>, direction: u8) -> Vec<u8> {
    let mut bytes = vec![3];
    bytes.extend_from_slice(&field(value));
    bytes.extend_from_slice(&field(datatype));
    if let Some(language) = language {
        bytes.push(1);
        bytes.extend_from_slice(&field(language));
    } else {
        bytes.push(0);
    }
    bytes.push(direction);
    bytes
}

fn triple(object: Vec<u8>) -> Vec<u8> {
    [vec![4], iri(SUBJECT), iri(PREDICATE), object].concat()
}

fn quad(operation: u8, object: Vec<u8>, graph: Vec<u8>) -> Vec<u8> {
    [vec![operation], iri(SUBJECT), iri(PREDICATE), object, graph].concat()
}

fn nested_triple(depth: usize) -> Vec<u8> {
    let mut value = iri(OBJECT);
    for _ in 0..depth {
        value = triple(value);
    }
    value
}

pub(crate) fn valid_single_triple_payload() -> Vec<u8> {
    quad(0, nested_triple(1), vec![0])
}

fn valid_rdf_12_payloads() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("single triple", valid_single_triple_payload()),
        ("nested triple", quad(1, nested_triple(2), iri(GRAPH))),
        (
            "left-to-right literal",
            quad(
                0,
                literal("left", RDF_DIR_LANG_STRING, Some("en"), 1),
                vec![0],
            ),
        ),
        (
            "right-to-left literal",
            quad(
                1,
                literal("right", RDF_DIR_LANG_STRING, Some("ar"), 2),
                blank("g"),
            ),
        ),
        (
            "maximum-depth triple",
            quad(0, nested_triple(MAX_TRIPLE_DEPTH), vec![0]),
        ),
    ]
}

fn assert_corruption(bytes: &[u8]) {
    assert!(matches!(decode(bytes), Err(StorageError::Corruption(_))));
}

#[cfg(not(feature = "rdf-12"))]
fn assert_feature_incompatible(bytes: &[u8]) {
    assert!(matches!(
        decode(bytes),
        Err(StorageError::FeatureIncompatible { feature: "rdf-12" })
    ));
}

#[cfg(feature = "rdf-12")]
#[test]
fn production_encoder_matches_independent_rdf_12_payload_fixtures()
-> Result<(), Box<dyn std::error::Error>> {
    use crate::model::{BaseDirection, Triple};

    let subject = NamedNode::new(SUBJECT)?;
    let predicate = NamedNode::new(PREDICATE)?;
    let object = NamedNode::new(OBJECT)?;
    let single: Term = Triple::new(subject.clone(), predicate.clone(), object.clone()).into();
    let nested: Term = Triple::new(subject.clone(), predicate.clone(), single.clone()).into();
    let mut maximum: Term = object.into();
    for _ in 0..MAX_TRIPLE_DEPTH {
        maximum = Triple::new(subject.clone(), predicate.clone(), maximum).into();
    }
    let changes = vec![
        SemanticChange::QuadAdded(Quad::new(
            subject.clone(),
            predicate.clone(),
            single,
            GraphName::DefaultGraph,
        )),
        SemanticChange::QuadRemoved(Quad::new(
            subject.clone(),
            predicate.clone(),
            nested,
            NamedNode::new(GRAPH)?,
        )),
        SemanticChange::QuadAdded(Quad::new(
            subject.clone(),
            predicate.clone(),
            Literal::new_directional_language_tagged_literal("left", "en", BaseDirection::Ltr)?,
            GraphName::DefaultGraph,
        )),
        SemanticChange::QuadRemoved(Quad::new(
            subject.clone(),
            predicate.clone(),
            Literal::new_directional_language_tagged_literal("right", "ar", BaseDirection::Rtl)?,
            BlankNode::new("g")?,
        )),
        SemanticChange::QuadAdded(Quad::new(
            subject,
            predicate,
            maximum,
            GraphName::DefaultGraph,
        )),
    ];
    for ((name, fixture), change) in valid_rdf_12_payloads().into_iter().zip(changes) {
        assert_eq!(encode(&change)?, fixture, "{name}");
        assert_eq!(decode(&fixture)?, change, "{name}");
    }
    Ok(())
}

#[test]
fn valid_rdf_12_payloads_and_every_truncation_have_exact_classification() {
    for (name, payload) in valid_rdf_12_payloads() {
        assert!(matches!(inspect_features(&payload), Ok(true)), "{name}");
        #[cfg(not(feature = "rdf-12"))]
        assert_feature_incompatible(&payload);
        #[cfg(feature = "rdf-12")]
        assert!(decode(&payload).is_ok(), "{name}");
        for end in 0..payload.len() {
            assert!(
                matches!(decode(&payload[..end]), Err(StorageError::Corruption(_))),
                "{name} truncation at {end}"
            );
        }
    }
}

#[test]
fn malformed_rdf_12_payloads_remain_corruption_after_unsupported_terms() {
    let mut trailing = valid_single_triple_payload();
    trailing.push(0);

    let bad_graph = quad(0, nested_triple(1), vec![255]);
    let bad_object_tag = triple(vec![255]);

    let mut bad_predicate_triple = vec![4];
    bad_predicate_triple.extend_from_slice(&iri(SUBJECT));
    bad_predicate_triple.extend_from_slice(&blank("predicate"));
    bad_predicate_triple.extend_from_slice(&iri(OBJECT));

    let mut bad_language_presence = vec![3];
    bad_language_presence.extend_from_slice(&field("value"));
    bad_language_presence.extend_from_slice(&field(RDF_DIR_LANG_STRING));
    bad_language_presence.extend_from_slice(&[2, 1]);

    for payload in [
        trailing,
        bad_graph,
        quad(0, bad_object_tag, vec![0]),
        quad(0, bad_predicate_triple, vec![0]),
        quad(
            0,
            triple(literal(
                "value",
                "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
                Some("EN"),
                0,
            )),
            vec![0],
        ),
        quad(
            0,
            triple(literal("value", "urn:wrong", Some("en"), 0)),
            vec![0],
        ),
        quad(0, literal("value", RDF_DIR_LANG_STRING, None, 1), vec![0]),
        quad(
            0,
            literal("value", RDF_DIR_LANG_STRING, Some("not_a_tag"), 1),
            vec![0],
        ),
        quad(
            0,
            literal("value", RDF_DIR_LANG_STRING, Some("EN"), 1),
            vec![0],
        ),
        quad(0, literal("value", "urn:wrong", Some("en"), 1), vec![0]),
        quad(0, literal("value", "relative", Some("en"), 1), vec![0]),
        quad(
            0,
            literal("value", RDF_DIR_LANG_STRING, Some("en"), 3),
            vec![0],
        ),
        quad(0, bad_language_presence, vec![0]),
        quad(0, nested_triple(MAX_TRIPLE_DEPTH + 1), vec![0]),
        quad(0, vec![0], vec![0]),
    ] {
        assert_corruption(&payload);
        assert!(matches!(
            inspect_features(&payload),
            Err(StorageError::Corruption(_))
        ));
    }
}

#[test]
fn directionless_dir_lang_string_keeps_existing_feature_mode_semantics() {
    let payload = quad(0, literal("legacy", RDF_DIR_LANG_STRING, None, 0), vec![0]);
    #[cfg(not(feature = "rdf-12"))]
    {
        assert!(decode(&payload).is_ok());
        assert!(matches!(inspect_features(&payload), Ok(false)));
    }
    #[cfg(feature = "rdf-12")]
    {
        assert_corruption(&payload);
        assert!(matches!(
            inspect_features(&payload),
            Err(StorageError::Corruption(_))
        ));
    }
}

#[test]
fn nested_directionless_dir_lang_string_is_corruption_in_all_feature_modes() {
    let payload = quad(
        0,
        triple(literal("nested", RDF_DIR_LANG_STRING, None, 0)),
        vec![0],
    );
    assert_corruption(&payload);
}
