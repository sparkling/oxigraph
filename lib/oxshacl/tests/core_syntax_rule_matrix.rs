#![expect(
    clippy::tests_outside_test_module,
    reason = "the integration test locks the pinned normative clause inventory"
)]

use std::collections::BTreeSet;

const PINNED_SYNTAX_RULE_IDS: &str = "
SHACL-list entailment-nodeKind shape multiple-parameters targetNode-nodeKind targetClass-nodeKind
implicit-targetClass-nodeKind targetSubjectsOf-nodeKind targetObjectsOf-nodeKind targetWhere-node
shape-nodeKind severity-maxCount severity-nodeKind severity-reifier-maxCount message-datatype
message-reifier-maxCount deactivated-maxCount deactivated-datatype deactivated-reified-maxCount
NodeShape-path-maxCount PropertyShape path-maxCount path-node PropertyShape-path-minCount path-values
path-defaultValue path-values-iri path-metarule path-non-recursive path-sequence path-alternative
path-inverse path-zero-or-more path-one-or-more path-zero-or-one IRIExpression-syntax
LiteralExpression-syntax ShapesGraph DataGraph shapesGraph-nodeKind class-nodeKind datatype-maxCount
datatype-nodeKind nodeKind-maxCount nodeKind-in minCount-scope minCount-maxCount minCount-datatype
maxCount-scope maxCount-maxCount maxCount-datatype minExclusive-nodeKind minExclusive-maxCount
minInclusive-nodeKind minInclusive-maxCount maxExclusive-nodeKind maxExclusive-maxCount
maxInclusive-nodeKind maxInclusive-maxCount minLength-datatype minLength-maxCount maxLength-datatype
maxLength-maxCount pattern-datatype pattern-regex flags-datatype singleLine-datatype
singleLine-maxCount languageIn-node languageIn-members-datatype languageIn-maxCount
uniqueLang-datatype uniqueLang-maxCount uniqueLang-scope memberShape-node minListLength-datatype
minListLength-minInclusive maxListLength-datatype maxListLength-minInclusive uniqueMembers-datatype
equals-nodeKind disjoint-nodeKind subsetOf-nodeKind lessThan-nodeKind lessThan-scope
lessThanOrEquals-nodeKind lessThanOrEquals-scope not-node and-node and-members-node or-node
or-members-node xone-node xone-members-node xone-minListLength node-node property-node someValue-shape
qualifiedValueShape-node qualifiedValueShape-scope qualifiedValueShapesDisjoint-datatype
qualifiedMinCount-datatype qualifiedMaxCount-datatype reifierShape-node
reificationRequired-datatype closed-datatype ignoredProperties-node
ignoredProperties-members-nodeKind in-node in-maxCount in-minListLength rootClass-nodeKind
uniqueValuesFor-node
";

const IMPLEMENTATION_MATRIX: &[(&str, &str)] = &[
    ("SHACL-list", "path"),
    ("entailment-nodeKind", "global"),
    ("shape", "index"),
    ("multiple-parameters", "constraints"),
    ("targetNode-nodeKind", "header"),
    ("targetClass-nodeKind", "header"),
    ("implicit-targetClass-nodeKind", "header"),
    ("targetSubjectsOf-nodeKind", "header"),
    ("targetObjectsOf-nodeKind", "header"),
    ("targetWhere-node", "references"),
    ("shape-nodeKind", "global"),
    ("severity-maxCount", "annotations"),
    ("severity-nodeKind", "annotations"),
    ("severity-reifier-maxCount", "reifiers"),
    ("message-datatype", "annotations"),
    ("message-reifier-maxCount", "reifiers"),
    ("deactivated-maxCount", "annotations"),
    ("deactivated-datatype", "annotations"),
    ("deactivated-reified-maxCount", "reifiers"),
    ("NodeShape-path-maxCount", "header"),
    ("PropertyShape", "index"),
    ("path-maxCount", "header"),
    ("path-node", "path"),
    ("PropertyShape-path-minCount", "header"),
    ("path-values", "expressions"),
    ("path-defaultValue", "expressions"),
    ("path-values-iri", "header"),
    ("path-metarule", "path"),
    ("path-non-recursive", "path"),
    ("path-sequence", "path"),
    ("path-alternative", "path"),
    ("path-inverse", "path"),
    ("path-zero-or-more", "path"),
    ("path-one-or-more", "path"),
    ("path-zero-or-one", "path"),
    ("IRIExpression-syntax", "expressions"),
    ("LiteralExpression-syntax", "expressions"),
    ("ShapesGraph", "global"),
    ("DataGraph", "global"),
    ("shapesGraph-nodeKind", "global"),
    ("class-nodeKind", "constraints"),
    ("datatype-maxCount", "constraints"),
    ("datatype-nodeKind", "constraints"),
    ("nodeKind-maxCount", "constraints"),
    ("nodeKind-in", "constraints"),
    ("minCount-scope", "constraints"),
    ("minCount-maxCount", "constraints"),
    ("minCount-datatype", "constraints"),
    ("maxCount-scope", "constraints"),
    ("maxCount-maxCount", "constraints"),
    ("maxCount-datatype", "constraints"),
    ("minExclusive-nodeKind", "constraints"),
    ("minExclusive-maxCount", "constraints"),
    ("minInclusive-nodeKind", "constraints"),
    ("minInclusive-maxCount", "constraints"),
    ("maxExclusive-nodeKind", "constraints"),
    ("maxExclusive-maxCount", "constraints"),
    ("maxInclusive-nodeKind", "constraints"),
    ("maxInclusive-maxCount", "constraints"),
    ("minLength-datatype", "constraints"),
    ("minLength-maxCount", "constraints"),
    ("maxLength-datatype", "constraints"),
    ("maxLength-maxCount", "constraints"),
    ("pattern-datatype", "constraints"),
    ("pattern-regex", "constraints"),
    ("flags-datatype", "constraints"),
    ("singleLine-datatype", "constraints"),
    ("singleLine-maxCount", "constraints"),
    ("languageIn-node", "constraints"),
    ("languageIn-members-datatype", "constraints"),
    ("languageIn-maxCount", "constraints"),
    ("uniqueLang-datatype", "constraints"),
    ("uniqueLang-maxCount", "constraints"),
    ("uniqueLang-scope", "constraints"),
    ("memberShape-node", "references"),
    ("minListLength-datatype", "constraints"),
    ("minListLength-minInclusive", "constraints"),
    ("maxListLength-datatype", "constraints"),
    ("maxListLength-minInclusive", "constraints"),
    ("uniqueMembers-datatype", "constraints"),
    ("equals-nodeKind", "path-parameters"),
    ("disjoint-nodeKind", "path-parameters"),
    ("subsetOf-nodeKind", "path-parameters"),
    ("lessThan-nodeKind", "path-parameters"),
    ("lessThan-scope", "constraints"),
    ("lessThanOrEquals-nodeKind", "path-parameters"),
    ("lessThanOrEquals-scope", "constraints"),
    ("not-node", "references"),
    ("and-node", "references"),
    ("and-members-node", "references"),
    ("or-node", "references"),
    ("or-members-node", "references"),
    ("xone-node", "references"),
    ("xone-members-node", "references"),
    ("xone-minListLength", "advisory-only"),
    ("node-node", "references"),
    ("property-node", "references"),
    ("someValue-shape", "references"),
    ("qualifiedValueShape-node", "references"),
    ("qualifiedValueShape-scope", "constraints"),
    ("qualifiedValueShapesDisjoint-datatype", "constraints"),
    ("qualifiedMinCount-datatype", "constraints"),
    ("qualifiedMaxCount-datatype", "constraints"),
    ("reifierShape-node", "references"),
    ("reificationRequired-datatype", "constraints"),
    ("closed-datatype", "constraints"),
    ("ignoredProperties-node", "constraints"),
    ("ignoredProperties-members-nodeKind", "constraints"),
    ("in-node", "constraints"),
    ("in-maxCount", "constraints"),
    ("in-minListLength", "advisory-only"),
    ("rootClass-nodeKind", "constraints"),
    ("uniqueValuesFor-node", "constraints"),
];

#[test]
fn pinned_clause_id_matrix_has_exact_set_equality() {
    let expected = PINNED_SYNTAX_RULE_IDS
        .split_ascii_whitespace()
        .collect::<BTreeSet<_>>();
    let actual = IMPLEMENTATION_MATRIX
        .iter()
        .map(|(id, _)| *id)
        .collect::<BTreeSet<_>>();
    assert_eq!(expected.len(), 113);
    assert_eq!(
        IMPLEMENTATION_MATRIX.len(),
        actual.len(),
        "duplicate rule ID in implementation matrix"
    );
    assert_eq!(actual, expected);

    let advisory = IMPLEMENTATION_MATRIX
        .iter()
        .filter_map(|(id, handling)| (*handling == "advisory-only").then_some(*id))
        .collect::<BTreeSet<_>>();
    assert_eq!(
        advisory,
        BTreeSet::from(["in-minListLength", "xone-minListLength"])
    );
    assert_eq!(
        IMPLEMENTATION_MATRIX
            .iter()
            .find(|(id, _)| *id == "message-datatype"),
        Some(&("message-datatype", "annotations")),
        "message-datatype remains normative for datatype checking; its duplicate-message tail is advisory"
    );
}
