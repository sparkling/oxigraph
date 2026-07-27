#![expect(
    clippy::tests_outside_test_module,
    reason = "the integration test locks the pinned Compact Syntax production inventory"
)]

use std::collections::{BTreeMap, BTreeSet};

const PINNED_SPEC_SHA256: &str = "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd";
const PINNED_GRAMMAR_SHA256: &str =
    "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04";

const PARSER_PRODUCTIONS: &str = "
shaclDoc directive baseDecl importsDecl prefixDecl shapeClass nodeShape nodeShapeBody targetClass
constraint nodeOr nodeNot nodeValue propertyShape propertyOr propertyNot propertyAtom propertyCount
propertyMinCount propertyMaxCount propertyType nodeKind shapeRef propertyValue negation path
pathAlternative pathSequence pathElt pathEltOrInverse pathInverse pathMod pathPrimary
iriOrLiteralOrArray iriOrLiteral iri prefixedName literal booleanLiteral numericLiteral rdfLiteral
datatype string array nodeParam propertyParam
";

const LEXER_PRODUCTIONS: &str = "
KW_BASE KW_IMPORTS KW_PREFIX KW_SHAPE_CLASS KW_SHAPE KW_TRUE KW_FALSE PASS COMMENT IRIREF PNAME_NS
PNAME_LN ATPNAME_NS ATPNAME_LN LANGTAG INTEGER DECIMAL DOUBLE EXPONENT STRING_LITERAL1
STRING_LITERAL2 STRING_LITERAL_LONG1 STRING_LITERAL_LONG2 UCHAR ECHAR WS PN_CHARS_BASE PN_CHARS_U
PN_CHARS PN_PREFIX PN_LOCAL PLX PERCENT HEX PN_LOCAL_ESC
";

const MAPPING_RULES: &str = "
baseDecl importsDecl prefixDecl documentCompletion nodeShape shapeClass targetClass nodeShapeBody
constraint nodeOr nodeNot nodeValue propertyShape propertyCount propertyOr propertyNot propertyAtom
propertyType nodeKind shapeRef propertyValue path pathSequence pathEltOrInverse pathElt pathPrimary
iriOrLiteralOrArray iriOrLiteral iri IRIREF
";

const PINNED_FIXTURES: &str = "
array-in basic-shape-iri basic-shape-with-target basic-shape-with-targets basic-shape class comment
complex1 complex2 count-0-1 count-0-unlimited count-1-2 count-1-unlimited datatype directives empty
nestedShape node-or-2 node-or-3-not nodeKind path-alternative path-complex path-inverse path-oneOrMore
path-sequence path-zeroOrMore path-zeroOrOne property-empty property-not property-or-2 property-or-3
shapeRef
";

const LOCAL_EVIDENCE: &str = "
covers_prefixed_name_lexical_alternatives
covers_shape_reference_token_alternatives
directives_resolve_at_declaration_time_and_map_final_base
follows_grammar_whitespace_and_lexical_count_mapping
maps_literal_and_iri_lexical_surfaces
parameter_and_node_kind_surfaces_are_exact
prefixed_names_follow_escape_rules
property_type_uses_sparql_11_datatype_set
rejects_grammar_and_lexer_near_misses
";

#[test]
fn pinned_compact_inventory_has_exact_sets_and_counts() {
    assert_eq!(PINNED_SPEC_SHA256.len(), 64);
    assert_eq!(PINNED_GRAMMAR_SHA256.len(), 64);

    let expected = BTreeMap::from([
        ("parser", words(PARSER_PRODUCTIONS)),
        ("lexer", words(LEXER_PRODUCTIONS)),
        ("mapping", words(MAPPING_RULES)),
        ("fixture", words(PINNED_FIXTURES)),
    ]);
    assert_eq!(expected["parser"].len(), 46);
    assert_eq!(expected["lexer"].len(), 35);
    assert_eq!(expected["mapping"].len(), 30);
    assert_eq!(expected["fixture"].len(), 32);
    let local_evidence = words(LOCAL_EVIDENCE);

    let mut actual = BTreeMap::<&str, BTreeSet<&str>>::new();
    for (line_number, line) in include_str!("fixtures/compact_syntax_inventory.tsv")
        .lines()
        .enumerate()
    {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let columns = line.split('\t').collect::<Vec<_>>();
        assert_eq!(
            columns.len(),
            3,
            "inventory line {} must have three columns",
            line_number + 1
        );
        let kind = columns[0];
        assert!(
            expected.contains_key(kind),
            "unknown inventory kind `{kind}`"
        );
        let mut evidence_parts = columns[2].splitn(2, ':');
        let source = evidence_parts.next().unwrap_or_default();
        let evidence = evidence_parts.next().unwrap_or_default();
        assert!(
            !evidence.is_empty(),
            "inventory evidence must be executable: {}",
            columns[2]
        );
        assert!(
            matches!(source, "local" | "w3c"),
            "unknown evidence source `{source}`"
        );
        if source == "local" {
            assert!(
                local_evidence.contains(evidence),
                "unknown local test evidence `{evidence}`"
            );
        } else {
            assert!(
                matches!(evidence, "32-pairs" | "graph-isomorphic")
                    || expected["fixture"].contains(evidence),
                "unknown W3C fixture evidence `{evidence}`"
            );
        }
        assert!(
            actual.entry(kind).or_default().insert(columns[1]),
            "duplicate {kind} inventory item `{}`",
            columns[1]
        );
    }
    assert_eq!(actual, expected);

    let grammar = actual["parser"]
        .union(&actual["lexer"])
        .copied()
        .collect::<BTreeSet<_>>();
    assert_eq!(grammar.len(), 81);
}

fn words(value: &str) -> BTreeSet<&str> {
    value.split_ascii_whitespace().collect()
}
