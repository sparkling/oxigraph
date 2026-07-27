#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests lock the pinned SRL clause and grammar inventory"
)]

use oxrdf::{Dataset, GraphName, NamedNode, Quad};
use oxshacl::{
    GraphSnapshot, PINNED_SHACL_SOURCE_COMMIT, ProfileId, ProfileSet, SrlError, SrlRuleSet,
    ValidationOptions, execute_srl_rules,
};
use std::collections::BTreeSet;

const PINNED_W3C_COMMIT: &str = "eedda09f93c39be1d2e978f3f942631494ae25a0";
const PINNED_SUITE_CONTENT_SHA256: &str =
    "1d2c1c40769da1cf63fef62f3029447a66b5e81b5744b4cf2eaa5e128ba51a3a";
const PINNED_RULES_SPEC_SHA256: &str =
    "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4";
const PINNED_BNF_SHA256: &str = "2ecae1fc84256ed54e2ec829d2e7008718cebdbd5aaf93a08f830b6aa77d4858";
const STANDALONE_MANIFEST_COUNTS: &[(&str, usize)] = &[
    ("positive-syntax", 108),
    ("negative-syntax", 30),
    ("positive-well-formedness", 4),
    ("negative-well-formedness", 4),
    ("positive-stratification", 5),
    ("negative-stratification", 4),
    ("evaluation", 16),
];
const PINNED_PRODUCTION_NAMES: &str = "
RuleSet RuleOrDataBlock RuleOrData Prologue Prologue1 BaseDecl PrefixDecl VersionDecl
VersionSpecifier ImportsDecl Rule Rule1 Rule2 Data HeadTemplate ForClause BodyPattern
BodyNotTriples Filter Constraint FunctionCall ArgList ExpressionList Negation BodyBasic
BodyBasicNotTriples Assignment DataTriplesBlock TriplesSameSubjectData PropertyListData
PropertyListNotEmptyData VerbData ObjectListData ObjectData GraphNodeData TriplesNodeData
BlankNodePropertyListData CollectionData AnnotationData AnnotationBlockData ReifierData
ReifierIdData ReifiedTripleBlockData ReifiedTripleData ReifiedTripleSubjectData
ReifiedTripleObjectData TripleTermData TripleTermSubjectData TripleTermObjectData
HeadTemplateBlock TriplesBlockTemplate TriplesSameSubjectTemplate PropertyListTemplate
PropertyListNotEmptyTemplate ObjectListTemplate ObjectTemplate GraphNodeTemplate
TriplesNodeTemplate BlankNodePropertyListTemplate CollectionTemplate AnnotationTemplate
AnnotationBlockTemplate ReifiedTripleBlockTemplate BodyTriplesBlock TriplesBlockPattern
ReifiedTripleBlockPattern TriplesSameSubjectPattern PropertyListPattern
PropertyListNotEmptyPattern ObjectListPattern ObjectPattern TriplesNodePattern
BlankNodePropertyListPattern CollectionPattern AnnotationPattern AnnotationBlockPattern
GraphNodePattern Reifier ReifierId ReifiedTriple ReifiedTripleSubject ReifiedTripleObject
TripleTerm TripleTermSubject TripleTermObject Verb VerbPath Path PathSequence
PathEltOrInverse PathElt RDFTermData VarOrRDFTerm VarOrIri Var RDFLiteral NumericLiteral
NumericLiteralUnsigned NumericLiteralPositive NumericLiteralNegative BooleanLiteral String
iri PrefixedName BlankNode Expression ConditionalOrExpression ConditionalAndExpression
ValueLogical RelationalExpression NumericExpression AdditiveExpression MultiplicativeExpression
UnaryExpression PrimaryExpression iriOrFunction ExprTripleTerm ExprTripleTermSubject
ExprTripleTermObject BrackettedExpression BuiltInCall IRIREF PNAME_NS PNAME_LN
BLANK_NODE_LABEL VAR1 VAR2 LANG_DIR INTEGER DECIMAL DOUBLE INTEGER_POSITIVE DECIMAL_POSITIVE
DOUBLE_POSITIVE INTEGER_NEGATIVE DECIMAL_NEGATIVE DOUBLE_NEGATIVE STRING_LITERAL1
STRING_LITERAL2 STRING_LITERAL_LONG1 STRING_LITERAL_LONG2 ECHAR UCHAR NIL WS ANON
PN_CHARS_BASE PN_CHARS_U VARNAME PN_CHARS PN_PREFIX PN_LOCAL PLX PERCENT HEX PN_LOCAL_ESC
";

const RELEVANT_CLAUSES: &[(&str, &str)] = &[
    ("conformance", "inventory:grammar+fail-closed-subset"),
    ("defined-version-labels", "local:version_and_prologue_edges"),
    (
        "introduction",
        "infer:implemented-subset;query:residual-no-api",
    ),
    (
        "rules-abstract-syntax",
        "local:well_formed_sequence_clauses_are_locked",
    ),
    (
        "rules-defns",
        "infer:execute_srl_rules;query:residual-no-api",
    ),
    ("wellformed", "w3c:wellformed:8+local:well-formed"),
    (
        "rule-dependency",
        "w3c:stratification:9+local:signed-dependency",
    ),
    (
        "dependency-graph",
        "local:signed_dependency_and_strata_are_locked",
    ),
    (
        "dependency-graph-construction-algorithm",
        "local:signed_dependency_and_strata_are_locked",
    ),
    (
        "stratification",
        "w3c:stratification:9+local:signed-dependency",
    ),
    (
        "stratification-condition",
        "local:signed_dependency_and_strata_are_locked",
    ),
    (
        "stratification-algorithm",
        "local:signed_dependency_and_strata_are_locked",
    ),
    ("concrete-syntax", "inventory:productions-1..156"),
    ("shape-rules-syntax", "w3c:syntax:138"),
    (
        "rdf-rules-syntax",
        "residual:draft-placeholders-no-normative-mapping-or-parser",
    ),
    ("rule-set-evaluation", "w3c:evaluation:16"),
    ("rule-eval-definitions", "w3c:evaluation:16"),
    ("evaluation-preparation", "local:imports+stratification"),
    (
        "process-imports",
        "local:recursive_imports_are_resolved_once",
    ),
    ("calculate-stratification", "w3c:stratification:9"),
    (
        "eval-expression",
        "local:filter_and_set_follow_sparql_semantics",
    ),
    (
        "eval-rule",
        "w3c:evaluation:16+local:blank_template_identity_and_body_policy_are_locked",
    ),
    ("eval-rule-set", "w3c:evaluation:16"),
    ("shapes-rules-grammar", "inventory:productions-1..156"),
    ("grammar-ws", "w3c:syntax:positive-negative"),
    ("grammar-comments", "w3c:syntax:positive-negative"),
    ("iri-references", "local:version_and_prologue_edges"),
    ("escapes", "local:numeric_and_escape_edges_are_locked"),
    ("grammar", "inventory:productions-1..156"),
    ("mediaType", "residual:caller-selected-dated-profile"),
];

fn profiles() -> ProfileSet {
    ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap()
}

fn parse(source: &str) -> Result<SrlRuleSet, SrlError> {
    SrlRuleSet::parse(source, Some("http://example/base/document.srl"), profiles())
}

#[test]
fn pinned_clause_and_production_inventory_is_exact() {
    assert_eq!(PINNED_SHACL_SOURCE_COMMIT, PINNED_W3C_COMMIT);
    assert_eq!(
        ProfileId::Rules12Subset20260727
            .descriptor()
            .version
            .source_sha256,
        PINNED_RULES_SPEC_SHA256
    );
    let inventory = include_str!("fixtures/srl_clause_productions.tsv");
    for expected_header in [
        format!("# W3C data-shapes commit: {PINNED_W3C_COMMIT}"),
        format!("# shacl12-test-suite/tests tree sha256: {PINNED_SUITE_CONTENT_SHA256}"),
        format!("# shacl12-rules/index.html sha256: {PINNED_RULES_SPEC_SHA256}"),
        format!("# shapes-rule-language.bnf sha256: {PINNED_BNF_SHA256}"),
    ] {
        assert!(
            inventory.lines().any(|line| line == expected_header),
            "missing exact pinned inventory header `{expected_header}`"
        );
    }
    assert_eq!(
        STANDALONE_MANIFEST_COUNTS
            .iter()
            .map(|(_, count)| count)
            .sum::<usize>(),
        171
    );
    assert_eq!(
        STANDALONE_MANIFEST_COUNTS
            .iter()
            .filter(|(kind, _)| kind.contains("syntax"))
            .map(|(_, count)| count)
            .sum::<usize>(),
        138
    );
    let expected_names = PINNED_PRODUCTION_NAMES
        .split_ascii_whitespace()
        .collect::<Vec<_>>();
    let rows = inventory
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.split('\t').collect::<Vec<_>>())
        .collect::<Vec<_>>();
    assert_eq!(rows.len(), 156);
    assert_eq!(expected_names.len(), 156);
    for (index, row) in rows.iter().enumerate() {
        assert_eq!(
            row.len(),
            3,
            "inventory row {} has three columns",
            index + 1
        );
        assert_eq!(row[0].parse::<usize>().unwrap(), index + 1);
        assert_eq!(row[1], expected_names[index]);
        assert!(
            row[2].starts_with("w3c:") || row[2].starts_with("local:"),
            "production {} lacks executable test evidence",
            index + 1
        );
    }
    let clause_ids = RELEVANT_CLAUSES
        .iter()
        .map(|(id, _)| *id)
        .collect::<BTreeSet<_>>();
    assert_eq!(clause_ids.len(), RELEVANT_CLAUSES.len());
    assert_eq!(clause_ids.len(), 30);
    assert_eq!(
        RELEVANT_CLAUSES
            .iter()
            .find(|(id, _)| *id == "rdf-rules-syntax")
            .map(|(_, evidence)| *evidence),
        Some("residual:draft-placeholders-no-normative-mapping-or-parser")
    );
}

#[test]
fn version_and_prologue_edges() {
    let parsed = parse(
        "VERSION \"1.2\" BASE <../base/> PREFIX : <vocab#> DATA { :s :p :o } \
         VERSION '1.2' IMPORTS <library.srl>",
    )
    .unwrap();
    assert_eq!(parsed.versions(), ["1.2", "1.2"]);
    assert_eq!(parsed.imports(), ["http://example/base/library.srl"]);
    assert!(matches!(
        parse("VERSION \"future\" RULE {} WHERE {}"),
        Err(SrlError::Profile(_))
    ));
    assert!(matches!(
        parse("VERSION \"\"\"1.2\"\"\""),
        Err(SrlError::Syntax { .. })
    ));
}

#[test]
fn numeric_and_escape_edges_are_locked() {
    parse(
        "PREFIX : <http://example/> RULE {} WHERE { \
         FILTER(1.e2 = +1.e2 && -1.e2 < .2e3) \
         :s :p '\\t\\b\\n\\r\\f\\\"\\'\\\\\\u0061\\U0001F600' }",
    )
    .unwrap();
    parse("PREFIX : <http://example/> RULE {} WHERE { :a\\~b :p \"\u{10ffff}\" }").unwrap();
    for source in [
        r#"PREFIX : <http://example/> RULE {} WHERE { :s :p "\uD800" }"#,
        r"BASE <http://example/\uDFFF> RULE {} WHERE {}",
        r#"PREFIX : <http://example/> RULE {} WHERE { :s :p "\U00110000" }"#,
    ] {
        assert!(matches!(parse(source), Err(SrlError::Syntax { .. })));
    }
}

#[test]
fn lexical_ws_escaped_local_and_anon_edges_are_locked() {
    parse(
        r"PREFIX : <http://example/> RULE { :s :p :o ~ [] } WHERE {
           :\. :p <<( :s :p [] )>> .
           :a\. :p << :s :p [] >> .
           <=> <=> <=>
        }",
    )
    .unwrap();
    parse("PREFIX : <http://example/a\u{a0}b> RULE {} WHERE {}").unwrap();
    for source in [
        "RULE\u{a0}{} WHERE {}",
        "PREFIX ex:: <http://example/> RULE {} WHERE {}",
        "PREFIX : <http://example/> RULE {} WHERE { :s :p <<( :a :b [ :p :o ] )>> }",
        "PREFIX : <http://example/> RULE {} WHERE { :unescaped. :p :o }",
    ] {
        assert!(matches!(parse(source), Err(SrlError::Syntax { .. })));
    }
}

#[test]
fn expression_grammar_edges_are_locked() {
    parse(
        "PREFIX : <http://example/> RULE {} WHERE { \
         FILTER((!(true)) || (+(-1) * 2 <= 3 && :fn(1) NOT IN (2, 3))) \
         FILTER(isTRIPLE(<<( :s :p <<( :x :q :y )>> )>>)) }",
    )
    .unwrap();
    for source in [
        "RULE {} WHERE { FILTER(!!true) }",
        "RULE {} WHERE { FILTER(++?x) }",
        "RULE {} WHERE { FILTER(1 = 1 = 1) }",
    ] {
        assert!(matches!(parse(source), Err(SrlError::Syntax { .. })));
    }
}

#[test]
fn built_in_production_arities_are_locked() {
    const ARITIES: &[(&str, usize, Option<usize>)] = &[
        ("STR", 1, Some(1)),
        ("LANG", 1, Some(1)),
        ("LANGMATCHES", 2, Some(2)),
        ("LANGDIR", 1, Some(1)),
        ("DATATYPE", 1, Some(1)),
        ("IRI", 1, Some(1)),
        ("URI", 1, Some(1)),
        ("BNODE", 0, Some(1)),
        ("ABS", 1, Some(1)),
        ("CEIL", 1, Some(1)),
        ("FLOOR", 1, Some(1)),
        ("ROUND", 1, Some(1)),
        ("CONCAT", 0, None),
        ("SUBSTR", 2, Some(3)),
        ("STRLEN", 1, Some(1)),
        ("REPLACE", 3, Some(4)),
        ("UCASE", 1, Some(1)),
        ("LCASE", 1, Some(1)),
        ("ENCODE_FOR_URI", 1, Some(1)),
        ("CONTAINS", 2, Some(2)),
        ("STRSTARTS", 2, Some(2)),
        ("STRENDS", 2, Some(2)),
        ("STRBEFORE", 2, Some(2)),
        ("STRAFTER", 2, Some(2)),
        ("YEAR", 1, Some(1)),
        ("MONTH", 1, Some(1)),
        ("DAY", 1, Some(1)),
        ("HOURS", 1, Some(1)),
        ("MINUTES", 1, Some(1)),
        ("SECONDS", 1, Some(1)),
        ("TIMEZONE", 1, Some(1)),
        ("TZ", 1, Some(1)),
        ("NOW", 0, Some(0)),
        ("UUID", 0, Some(0)),
        ("STRUUID", 0, Some(0)),
        ("IF", 3, Some(3)),
        ("STRLANG", 2, Some(2)),
        ("STRLANGDIR", 3, Some(3)),
        ("STRDT", 2, Some(2)),
        ("sameTerm", 2, Some(2)),
        ("isIRI", 1, Some(1)),
        ("isURI", 1, Some(1)),
        ("isBLANK", 1, Some(1)),
        ("isLITERAL", 1, Some(1)),
        ("isNUMERIC", 1, Some(1)),
        ("hasLANG", 1, Some(1)),
        ("hasLANGDIR", 1, Some(1)),
        ("REGEX", 2, Some(3)),
        ("isTRIPLE", 1, Some(1)),
        ("TRIPLE", 3, Some(3)),
        ("SUBJECT", 1, Some(1)),
        ("PREDICATE", 1, Some(1)),
        ("OBJECT", 1, Some(1)),
    ];
    assert_eq!(ARITIES.len(), 53);
    for (name, minimum, maximum) in ARITIES {
        for arity in [*minimum, maximum.unwrap_or(minimum.saturating_add(2))] {
            let arguments = std::iter::repeat_n("true", arity)
                .collect::<Vec<_>>()
                .join(",");
            parse(&format!(
                "RULE {{}} WHERE {{ FILTER({name}({arguments})) }}"
            ))
            .unwrap();
        }
        if *minimum > 0 {
            parse(&format!("RULE {{}} WHERE {{ FILTER({name}()) }}")).unwrap_err();
        }
        if let Some(maximum) = maximum {
            let arguments = std::iter::repeat_n("true", maximum + 1)
                .collect::<Vec<_>>()
                .join(",");
            parse(&format!(
                "RULE {{}} WHERE {{ FILTER({name}({arguments})) }}"
            ))
            .unwrap_err();
        }
    }
}

#[test]
fn well_formed_sequence_clauses_are_locked() {
    for source in [
        "PREFIX : <http://example/> RULE { ?x :p :o } WHERE {}",
        "PREFIX : <http://example/> RULE {} WHERE { FILTER(?x) ?x :p :o }",
        "PREFIX : <http://example/> RULE {} WHERE { SET(?x := ?y) }",
        "PREFIX : <http://example/> RULE {} WHERE { ?x :p :o SET(?x := 1) }",
        "PREFIX : <http://example/> RULE {} WHERE { NOT { ?x :p :o } FILTER(?x) }",
    ] {
        assert!(matches!(
            parse(source).unwrap().check_well_formed(),
            Err(SrlError::WellFormed(_))
        ));
    }
    parse(
        "PREFIX : <http://example/> RULE { ?x :q ?z } WHERE { \
         ?x :p ?y FILTER(?y) SET(?z := ?y) NOT { ?x :blocked ?z FILTER(?z) } }",
    )
    .unwrap()
    .check_well_formed()
    .unwrap();
}

#[test]
fn signed_dependency_and_strata_are_locked() {
    let open_recursive =
        parse("PREFIX : <http://example/> RULE { ?s :p ?o } WHERE { ?s :p ?o }").unwrap();
    let strata = open_recursive.stratification().unwrap();
    assert_eq!(strata.strata.len(), 1);
    assert_eq!(strata.strata[0].general, [0]);
    assert!(strata.strata[0].once.is_empty());

    let ordered = parse(
        "PREFIX : <http://example/> \
         RULE { ?s :q ?o } WHERE { ?s :p ?o } \
         RULE { ?s :safe true } WHERE { ?s :p ?o NOT { ?s :q ?o } }",
    )
    .unwrap()
    .stratification()
    .unwrap();
    assert_eq!(ordered.strata.len(), 2);
    assert_eq!(ordered.strata[0].general, [0]);
    assert_eq!(ordered.strata[1].general, [1]);

    parse(
        "PREFIX : <http://example/> \
         RULE { ?s :q ?o } WHERE { ?s :seed ?o NOT { ?s :a/:b ?o } } \
         RULE { ?s :c ?o } WHERE { ?s :q ?o }",
    )
    .unwrap()
    .stratification()
    .unwrap();

    for source in [
        "PREFIX : <http://example/> RULE { ?s :p ?o } WHERE { \
         ?s :seed ?o NOT { ?s :p ?o } }",
        "PREFIX : <http://example/> RULE { ?s :p ?x } WHERE { ?s :p ?o SET(?x := ?o) }",
        "PREFIX : <http://example/> RULE { [] :p ?o } WHERE { ?s :p ?o }",
        "PREFIX : <http://example/> RULE { ?s :p ?o } WHERE { \
         ?s :p ?o NOT { ?s :p ?o } }",
        "PREFIX : <http://example/> \
         PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> \
         RULE { :root :list ( ?o ) } WHERE { ?s :trigger ?o } \
         RULE { ?s :trigger ?o } WHERE { ?s :seed ?o NOT { ?x rdf:first ?o } }",
        "PREFIX : <http://example/> \
         PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> \
         RULE { ?s :p \"x\" } WHERE { ?s :seed ?o } \
         RULE { ?s :seed ?o } WHERE { ?s :input ?o NOT { ?s :p \"x\"^^xsd:string } }",
    ] {
        assert!(matches!(
            parse(source).unwrap().stratification(),
            Err(SrlError::Stratification(_))
        ));
    }
}

#[test]
fn blank_template_identity_and_body_policy_are_locked() {
    let rules = parse(
        "PREFIX : <http://example/> \
         RULE { _:shared :p ?o . _:shared :q ?o } WHERE { :s :value ?o }",
    )
    .unwrap();
    let data = Dataset::from_iter([Quad::new(
        NamedNode::new_unchecked("http://example/s"),
        NamedNode::new_unchecked("http://example/value"),
        NamedNode::new_unchecked("http://example/o"),
        GraphName::DefaultGraph,
    )]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    let subjects = execution
        .inference()
        .dataset()
        .iter()
        .filter(|quad| {
            matches!(
                quad.predicate.as_str(),
                "http://example/p" | "http://example/q"
            )
        })
        .map(|quad| quad.subject)
        .collect::<Vec<_>>();
    assert_eq!(subjects.len(), 2);
    assert_eq!(subjects[0], subjects[1]);

    let unsupported =
        parse("PREFIX : <http://example/> RULE {} WHERE { ?s :p _:b FILTER(true) }").unwrap();
    assert!(matches!(
        execute_srl_rules(
            &unsupported,
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default(),
        ),
        Err(SrlError::Unsupported(_))
    ));
}
