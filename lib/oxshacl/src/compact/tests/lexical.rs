use crate::{ShaclcError, parse_shaclc};
use std::fmt::Write as _;

#[test]
fn covers_prefixed_name_lexical_alternatives() {
    let escaped_locals = [
        r"a\_b", r"a\~b", r"a\.b", r"a\-b", r"a\!b", r"a\$b", r"a\&b", r"a\'b", r"a\(b", r"a\)b",
        r"a\*b", r"a\+b", r"a\,b", r"a\;b", r"a\=b", r"a\/b", r"a\?b", r"a\#b", r"a\@b", r"a\%25",
    ];
    let mut source = "PREFIX ex: <urn:escape:> shape ex:S {".to_owned();
    for local in escaped_locals {
        write!(source, " ex:{local} .").unwrap();
    }
    source.push('}');
    let graph = parse_shaclc(&source, Some("urn:base:")).unwrap();
    let path_count = graph
        .dataset()
        .iter()
        .filter(|quad| quad.predicate.as_str() == "http://www.w3.org/ns/shacl#path")
        .count();
    assert_eq!(path_count, escaped_locals.len());

    parse_shaclc(
        "PREFIX : <urn:default:>
         PREFIX A\u{b7}_\u{301}: <urn:unicode:>
         shape :S { :1x . :_x . ::x . :%2F . :\\~x . A\u{b7}_\u{301}:\u{e9} . }",
        Some("urn:base:"),
    )
    .unwrap();
}

#[test]
fn covers_shape_reference_token_alternatives() {
    let graph = parse_shaclc(
        "BASE <http://example.test/base/>
         PREFIX : <urn:default:>
         shape :S { :p @: @:Target @<relative> . }",
        None,
    )
    .unwrap();
    let nodes = graph
        .dataset()
        .iter()
        .filter(|quad| quad.predicate.as_str() == "http://www.w3.org/ns/shacl#node")
        .map(|quad| quad.object.to_string())
        .collect::<Vec<_>>();
    assert_eq!(nodes.len(), 3);
    assert!(nodes.iter().any(|value| value == "<urn:default:>"));
    assert!(nodes.iter().any(|value| value == "<urn:default:Target>"));
    assert!(
        nodes
            .iter()
            .any(|value| value == "<http://example.test/base/relative>")
    );
}

#[test]
fn rejects_lexical_boundary_violations() {
    for source in [
        "PREFIX _bad: <urn:bad:> shape <urn:s> {}",
        "PREFIX bad.: <urn:bad:> shape <urn:s> {}",
        "PREFIX \u{E000}: <urn:bad:> shape <urn:s> {}",
        "PREFIX \u{1f600}: <urn:bad:> shape <urn:s> {}",
        r"PREFIX ex: <urn:ex:> shape ex:S { ex:a\\b . }",
        r"PREFIX ex: <urn:ex:> shape ex:S { ex:a\u0062 . }",
        "PREFIX ex: <urn:ex:> shape ex:S { ex:a;b . }",
        r"shape <urn:\q> {}",
        r"shape <urn:\uD800> {}",
        r#"shape <urn:s> { hasValue="\uD800" . }"#,
        r#"shape <urn:s> { hasValue="x"@en- . }"#,
        r#"shape <urn:s> { hasValue="x"@en_US . }"#,
        "shape\u{000B}<urn:s> {}",
        "shape\u{000C}<urn:s> {}",
        "shape <urn:s> { hasValue='line\nbreak' . }",
        "shape <urn:s> { hasValue='''unterminated . }",
        "shape <urn:s=> {}",
        "shape <urn:s{> {}",
        "shape <urn:s|> {}",
        "shape <urn:s^> {}",
        "shape <urn:s`> {}",
    ] {
        assert!(
            matches!(
                parse_shaclc(source, Some("urn:base:")),
                Err(ShaclcError::Syntax { .. } | ShaclcError::Iri(_))
            ),
            "{source:?}"
        );
    }
}
