#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public OWL 2 RL datatype boundary"
)]

use oxowl::{Owl2RlConsistency, Owl2RlRdf, Owl2RlRdfOptions};
use oxrdf::{Dataset, GraphName, Literal, NamedNode, Quad, Term, vocab::xsd};

const RDF_PLAIN_LITERAL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#PlainLiteral";
const RDF_XML_LITERAL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral";
const OWL_DIFFERENT_FROM: &str = "http://www.w3.org/2002/07/owl#differentFrom";

fn typed(value: &str, datatype: NamedNode) -> Literal {
    Literal::new_typed_literal(value.to_owned(), datatype)
}

fn evaluate(literals: impl IntoIterator<Item = Literal>) -> oxowl::Owl2RlRdfClosure {
    let predicate = NamedNode::new("http://example.com/value").unwrap();
    let dataset = Dataset::from_iter(literals.into_iter().enumerate().map(|(index, literal)| {
        Quad::new(
            NamedNode::new(format!("http://example.com/s{index}")).unwrap(),
            predicate.clone(),
            literal,
            GraphName::DefaultGraph,
        )
    }));
    Owl2RlRdf
        .evaluate(&dataset, &Owl2RlRdfOptions::default())
        .unwrap()
}

fn same(closure: &oxowl::Owl2RlRdfClosure, left: &Literal, right: &Literal) -> bool {
    closure
        .equality_facts()
        .iter()
        .any(|(_, actual_left, actual_right)| {
            actual_left == &Term::from(left.clone()) && actual_right == &Term::from(right.clone())
        })
}

fn different(closure: &oxowl::Owl2RlRdfClosure, left: &Literal, right: &Literal) -> bool {
    let predicate = NamedNode::new(OWL_DIFFERENT_FROM).unwrap();
    closure.generalized_facts().iter().any(|fact| {
        fact.subject == left.clone()
            && fact.predicate == predicate.clone()
            && fact.object == right.clone()
    })
}

fn inconsistent(closure: &oxowl::Owl2RlRdfClosure) -> bool {
    matches!(closure.consistency(), Owl2RlConsistency::Inconsistent(_))
}

#[test]
fn arbitrary_precision_integers_are_not_truncated() {
    let canonical = typed(
        "12345678901234567890123456789012345678901234567890",
        xsd::INTEGER,
    );
    let alternate = typed(
        "+00012345678901234567890123456789012345678901234567890",
        xsd::NON_NEGATIVE_INTEGER,
    );
    let closure = evaluate([canonical.clone(), alternate.clone()]);
    assert!(!inconsistent(&closure));
    assert!(same(&closure, &canonical, &alternate));

    let outside_unsigned_long = typed("18446744073709551616", xsd::UNSIGNED_LONG);
    assert!(inconsistent(&evaluate([outside_unsigned_long])));
}

#[test]
fn decimal_lexical_space_and_value_equality_are_arbitrary_precision() {
    let leading_dot = typed(".5000000000000000000000000000000000000001", xsd::DECIMAL);
    let leading_zero = typed(
        "+0.5000000000000000000000000000000000000001000",
        xsd::DECIMAL,
    );
    let closure = evaluate([leading_dot.clone(), leading_zero.clone()]);
    assert!(!inconsistent(&closure));
    assert!(same(&closure, &leading_dot, &leading_zero));
    assert!(inconsistent(&evaluate([typed(".", xsd::DECIMAL)])));
}

#[test]
fn integer_and_decimal_values_share_the_decimal_value_space() {
    let integer = typed("42", xsd::INTEGER);
    let decimal = typed("42.000", xsd::DECIMAL);
    let non_integer = typed("42.5", xsd::DECIMAL);
    let closure = evaluate([integer.clone(), decimal.clone(), non_integer.clone()]);
    assert!(same(&closure, &integer, &decimal));
    assert!(different(&closure, &integer, &non_integer));
}

#[test]
fn floating_value_spaces_preserve_signed_zero_and_primitive_boundaries() {
    let positive_zero = typed("0", xsd::FLOAT);
    let negative_zero = typed("-0", xsd::FLOAT);
    let overflow = typed("1E999999999999999999999999", xsd::FLOAT);
    let float_infinity = typed("INF", xsd::FLOAT);
    let double_infinity = typed("INF", xsd::DOUBLE);
    let closure = evaluate([
        positive_zero.clone(),
        negative_zero.clone(),
        overflow.clone(),
        float_infinity.clone(),
        double_infinity.clone(),
    ]);
    assert!(different(&closure, &positive_zero, &negative_zero));
    assert!(same(&closure, &overflow, &float_infinity));
    assert!(different(&closure, &float_infinity, &double_infinity));
    assert!(inconsistent(&evaluate([typed("+INF", xsd::FLOAT)])));
    assert!(inconsistent(&evaluate([typed("1e", xsd::DOUBLE)])));
}

#[test]
fn string_derived_datatypes_apply_whitespace_and_name_facets() {
    let token = typed("  alpha\t beta  ", xsd::TOKEN);
    let string = typed("alpha beta", xsd::STRING);
    let unicode_name = typed("\u{c5}ngstr\u{f6}m", xsd::NC_NAME);
    let closure = evaluate([token.clone(), string.clone(), unicode_name]);
    assert!(!inconsistent(&closure));
    assert!(same(&closure, &token, &string));
    assert!(inconsistent(&evaluate([typed("a:b", xsd::NC_NAME)])));
    assert!(inconsistent(&evaluate([typed("12", xsd::LANGUAGE)])));
}

#[test]
fn plain_and_language_tagged_strings_keep_language_in_the_value() {
    let english = Literal::new_language_tagged_literal("chat", "en").unwrap();
    let french = Literal::new_language_tagged_literal("chat", "fr").unwrap();
    let plain = typed("chat@EN", NamedNode::new(RDF_PLAIN_LITERAL).unwrap());
    let closure = evaluate([english.clone(), french.clone(), plain.clone()]);
    assert!(same(&closure, &english, &plain));
    assert!(!same(&closure, &english, &french));
    assert!(different(&closure, &english, &french));
}

#[test]
fn binary_lexicals_decode_without_merging_disjoint_binary_spaces() {
    let hex_lower = typed("0aff", xsd::HEX_BINARY);
    let hex_upper = typed("0AFF", xsd::HEX_BINARY);
    let base64_spaced = typed("Y Q==\n", xsd::BASE_64_BINARY);
    let base64_compact = typed("YQ==", xsd::BASE_64_BINARY);
    let closure = evaluate([
        hex_lower.clone(),
        hex_upper.clone(),
        base64_spaced.clone(),
        base64_compact.clone(),
    ]);
    assert!(same(&closure, &hex_lower, &hex_upper));
    assert!(same(&closure, &base64_spaced, &base64_compact));
    assert!(different(&closure, &hex_lower, &base64_compact));
    assert!(inconsistent(&evaluate([typed("0", xsd::HEX_BINARY)])));
    assert!(inconsistent(&evaluate([typed(
        "YR==",
        xsd::BASE_64_BINARY
    )])));
}

#[test]
fn datetime_identity_normalizes_lexical_aliases_but_retains_timezone() {
    let end_of_day = typed("2000-01-01T24:00:00Z", xsd::DATE_TIME);
    let next_day = typed("2000-01-02T00:00:00.0+00:00", xsd::DATE_TIME_STAMP);
    let eastern = typed("1956-06-25T04:00:00-05:00", xsd::DATE_TIME);
    let central_europe = typed("1956-06-25T10:00:00+01:00", xsd::DATE_TIME);
    let closure = evaluate([
        end_of_day.clone(),
        next_day.clone(),
        eastern.clone(),
        central_europe.clone(),
    ]);
    assert!(same(&closure, &end_of_day, &next_day));
    // XML Schema 1.1 makes these instants equal but nonidentical. OWL 2
    // datatype identity therefore keeps them as distinct data values.
    assert!(different(&closure, &eastern, &central_europe));
    assert!(inconsistent(&evaluate([typed(
        "2023-02-29T00:00:00Z",
        xsd::DATE_TIME,
    )])));
    assert!(inconsistent(&evaluate([typed(
        "2024-02-29T00:00:00",
        xsd::DATE_TIME_STAMP,
    )])));
}

#[test]
fn any_uri_and_safe_xml_literals_validate_conservatively() {
    let uri = typed("  relative/path  ", xsd::ANY_URI);
    let collapsed = typed("relative/path", xsd::ANY_URI);
    let xml = typed(
        "<root key='value'>safe&amp;text</root>",
        NamedNode::new(RDF_XML_LITERAL).unwrap(),
    );
    let closure = evaluate([uri.clone(), collapsed.clone(), xml]);
    assert!(!inconsistent(&closure));
    assert!(same(&closure, &uri, &collapsed));
    assert!(inconsistent(&evaluate([typed(
        "<root><broken></root>",
        NamedNode::new(RDF_XML_LITERAL).unwrap(),
    )])));
    for invalid in [
        "<root a='1'b='2'/>",
        "<root>not allowed ]]></root>",
        "<!--comment--->",
        "<?xml forbidden?>",
        "<? ?>",
    ] {
        assert!(inconsistent(&evaluate([typed(
            invalid,
            NamedNode::new(RDF_XML_LITERAL).unwrap(),
        )])));
    }
}

#[cfg(feature = "rdf-12")]
#[test]
fn directional_language_values_include_the_base_direction() {
    use oxrdf::BaseDirection;

    let text = "\u{645}\u{631}\u{62d}\u{628}\u{627}";
    let left =
        Literal::new_directional_language_tagged_literal(text, "ar", BaseDirection::Ltr).unwrap();
    let right =
        Literal::new_directional_language_tagged_literal(text, "ar", BaseDirection::Rtl).unwrap();
    let closure = evaluate([left.clone(), right.clone()]);
    assert!(!same(&closure, &left, &right));
    assert!(different(&closure, &left, &right));
}
