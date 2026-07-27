#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests lock the pinned UI and Profiling clause dispositions"
)]

use std::collections::BTreeSet;

const PINNED_UI_SHA256: &str = "3b289645228d4cf154608259d38555d9b946f50b52c21648d586fd8172c07853";
const PINNED_PROFILING_SHA256: &str =
    "248602e3a92b2c6d72b6734ce65638dcdc05afe7c4a657abba719d2c07f25202";
const PINNED_UI_SYNTAX_RULES: usize = 0;
const PINNED_PROFILING_SYNTAX_RULES: usize = 0;
const PINNED_UI_APPROVED_TESTS: usize = 0;
const PINNED_PROFILING_APPROVED_TESTS: usize = 0;

const UI_RENDERER_OR_UI_SECTIONS: &str = "
abstract sotd introduction scope terminology conventions conformance compatibility getting-started
rendering-concepts renderer node-ui-component property-ui-component scoring-system scoring-system-intro
select-function select-function-processing scoring-algorithm-validation-function
scoring-algorithm-matcher-function scoring-algorithm-score-function scoring-algorithm-accept-function
scoring-algorithm-widget-selection select-function-widget-score-validation widgets editors viewers
core-constraints property-paths property-paths-view view-predicate-paths view-complex-paths
property-paths-edit edit-predicate-paths edit-alternative-paths edit-other-complex-paths
label-and-lang lang-resolution label-resolution label-resolution-property-labels
label-resolution-value-node-labels label-resolution-local-name patterns builtin-widgets
builtin-editors AutoCompleteEditor BlankNodeEditor BooleanEditor DatePickerEditor DateTimePickerEditor
DetailsEditor EnumSelectEditor InstancesSelectEditor IRIEditor NumberFieldEditor RichTextEditor
SubClassEditor TextAreaEditor TextAreaWithLangEditor TextFieldEditor TextFieldWithLangEditor
builtin-viewers BlankNodeViewer DetailsViewer HTMLViewer HyperlinkViewer ImageViewer IRIViewer
LabelViewer LangStringViewer LiteralViewer ValueTableViewer property-roles syntax-rules security
privacy internationalization ack shacl-syntax-index issue-summary
";

const PROFILING_SECTIONS: &str = "
abstract sotd specifications introduction what-is scope terminology conventions conformance packaging
packaging-motivation packaging-recommendations explicit rec-shapesgraph rec-defined rec-member
rec-imports dependencies indicating-validity profiling-of-shacl defining-profiles
known-profiles-of-shacl other-profiles creating-profiles profiling-with-shacl
profiling-specifications profiling-data profile-parts hierarchies null-profiles vocabulary
cls-shapesgraph prop-imports prop-member cls-datagraph prop-conformsto prop-hasvalidationreport
cls-validationreport prop-usedshapesgraph prop-conforms cls-shape prop-isdefinedby rule-conformsto
profiles specification-profiles union-profile ui-profile cl1-profile 10-profile pp-profile
owl-consistent-profile null-profile-examples null-profile-of-pos null-profile-of-prof security ack
internationalization index issue-summary
";

const PROFILING_API_CONCEPT_SECTIONS: &[(&str, &str)] = &[
    (
        "profiling-of-shacl",
        "profile_catalog_export_is_canonical_and_machine_readable",
    ),
    (
        "defining-profiles",
        "pinned_w3c_profiles_are_descriptive_and_never_subset_aliases",
    ),
    (
        "known-profiles-of-shacl",
        "pinned_w3c_profiles_are_descriptive_and_never_subset_aliases",
    ),
    (
        "creating-profiles",
        "implemented_profile_metadata_is_exact_and_dependency_closed",
    ),
    (
        "hierarchies",
        "implemented_profile_metadata_is_exact_and_dependency_closed",
    ),
    (
        "profiles",
        "pinned_w3c_profiles_are_descriptive_and_never_subset_aliases",
    ),
    (
        "specification-profiles",
        "pinned_w3c_profiles_are_descriptive_and_never_subset_aliases",
    ),
    (
        "union-profile",
        "complete_ui_profiling_and_union_requests_fail_closed",
    ),
    (
        "ui-profile",
        "complete_ui_profiling_and_union_requests_fail_closed",
    ),
];

const UI_BCP14: &[(&str, &str, &str)] = &[
    (
        "ui:compatibility:dc3edc99592b",
        "dc3edc99592b4643f748267cf7661ad8b10b2dde46372f092de1efb69118702a",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:select-function-processing:9f548a2b4031",
        "9f548a2b40316664f05748d00a4e9f54b9192f4729b30984bf104c6298771341",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:scoring-algorithm-widget-selection:ddaf2d313084",
        "ddaf2d3130848e04d04fed57374df55c8b8e3f0f4f405a25725ad54f04bbe3ee",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:scoring-algorithm-widget-selection:91148a44e915",
        "91148a44e915759975e4dd1738211f96d2433e8deefa55021e2294e966d855b7",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:view-predicate-paths:844005fbb708",
        "844005fbb7084c5a4c7583f472c3fc7779ffcdad480d544a6349ac320c12bfe9",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:view-complex-paths:efc1f61bfc8c",
        "efc1f61bfc8cb0afc7fc7ec3e1be943b49dfaec968543f66f153d09b7f373db1",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:edit-predicate-paths:5f9a77216d90",
        "5f9a77216d90ef4c830815029deb8283899c6da812c9f7c04c33dbb905327d00",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:edit-alternative-paths:121e5a60c1ba",
        "121e5a60c1ba66c7d82f36bfa5c26c626e436a95980e2ea0491a77cbb69f9c44",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:edit-alternative-paths:4a53b8cad89d",
        "4a53b8cad89d117c28eb240bda0d275e8a7f6dbadc4047cb7f97065ccf97b0c9",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:edit-other-complex-paths:ec1d5502d3aa",
        "ec1d5502d3aa0758dd39505afd20aeea6ca3dfaa7e24b16f976edc1e8e265248",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:lang-resolution:eee988313a5c",
        "eee988313a5c647fb5e94dfe978c0d52ca968c93e1a15649a8395184f1b1f93d",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:lang-resolution:72731f9b3a1a",
        "72731f9b3a1ab6a86208df38952645ffecbd74680cc2423ecd9ceffb09f91082",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:lang-resolution:a7c2eaa33b02",
        "a7c2eaa33b02b4e68e2758fadaa44c0a1fdbca81d73a7549511200b2a96745d2",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:lang-resolution:9b41c38ddb9e",
        "9b41c38ddb9e802bb0f3ba320449eb7ec77209eed77f4dfd2c81bff303417f9e",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:label-resolution-property-labels:8bd6ab9cabde",
        "8bd6ab9cabdee59e3ee700bbf93514635cc424e3129da8f3cdb60b7a56c3319c",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:label-resolution-value-node-labels:de0ae6d2248d",
        "de0ae6d2248d21a58e61859a6305e11e6c76d6eb3311f805d82b21b868d2760a",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:label-resolution-local-name:818f348ca026",
        "818f348ca0268d01607ab1653da9dab46c0fdd7921b73671c2c4476ed26dcf41",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:DetailsViewer:7d10a4a3377e",
        "7d10a4a3377efab5f35d83b216f0ece7e94844c5e9f5508c6df0636382ddddd3",
        "not-applicable:renderer-or-ui",
    ),
    (
        "ui:property-roles:b5ba8389b6b3",
        "b5ba8389b6b34c53c69693149e6ee45c0d48d2ddc3bb537fd11edd4c835f0f27",
        "not-applicable:renderer-or-ui",
    ),
];

const PROFILING_BCP14: &[(&str, &str, &str)] = &[
    (
        "profiling:conformance:5e31de4aff3c",
        "5e31de4aff3ccd85d17d696e023ab697de09303d3392959f51b7a081008a07d5",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:packaging-recommendations:f894ff717f97",
        "f894ff717f974a2813ccca1600edad2450e852f38c91db46c162f592d1531a96",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:packaging-recommendations:fd5ada30d769",
        "fd5ada30d76917f7d327afa5ad0dc87ce2651f744dd2f553e7debdc9175b33ee",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:rec-member:a5cbae06e72f",
        "a5cbae06e72fe87fcd8ff608f0452919dd1ad73b1cc468db6b7d7a12a6fefa28",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:packaging-recommendations:2ca1b1b86a7f",
        "2ca1b1b86a7fa052c7e2af4515bebcf3de85b0e4d018ae4fc132afbd952868f8",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:rec-shapesgraph:ea4b84761fa8",
        "ea4b84761fa8f19252f05c6582ffb57873e1f9b11c98d1a3e98c412bf769474f",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:rec-defined:118431a184be",
        "118431a184be3c360e9910cac5fe6c686ca2efb3c6191fd83b204c80aa38ea89",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:rec-defined:0409e466bdbc",
        "0409e466bdbc0922404579941eabb30f4b95e6665f880c283e4a345cf1a6ccb3",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:rec-defined:a8068b319424",
        "a8068b3194245da3ae383be477b4beb60f94159ec72e48d3e58780c6cdcdeab8",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:rec-member:486ebdb69f88",
        "486ebdb69f88bad7f810048c18a5a39e3254bf1982229c1b62c7aeeb05ceb9a9",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:rec-imports:1fedfdd69633",
        "1fedfdd696336ecd955e2effd2a70224a8f9b4c6cacc8e1aad5647c22eebfcdc",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:indicating-validity:1ecf3013b42b",
        "1ecf3013b42bc5b4cc398db8841e6663c5d902e8d19123cb0a47a224fe3f56ad",
        "not-applicable:profile-or-data-author",
    ),
    (
        "profiling:creating-profiles:14e790d1cfd4",
        "14e790d1cfd483b9a322cdbb4b3f90cec20397878f8a1db31e1506450bc14c36",
        "not-applicable:profile-or-data-author",
    ),
];

#[test]
fn section_inventory_has_exact_set_and_disposition_counts() {
    let ui = words(UI_RENDERER_OR_UI_SECTIONS);
    let profiling = words(PROFILING_SECTIONS);
    let api_concepts = PROFILING_API_CONCEPT_SECTIONS
        .iter()
        .map(|(section, _)| *section)
        .collect::<BTreeSet<_>>();
    assert_eq!(ui.len(), 79);
    assert_eq!(profiling.len(), 59);
    assert_eq!(api_concepts.len(), 9);
    assert!(api_concepts.is_subset(&profiling));
    assert_eq!(profiling.difference(&api_concepts).count(), 50);
    assert_eq!(
        ui.len(),
        UI_RENDERER_OR_UI_SECTIONS.split_ascii_whitespace().count(),
        "duplicate UI section identifier"
    );
    assert_eq!(
        profiling.len(),
        PROFILING_SECTIONS.split_ascii_whitespace().count(),
        "duplicate Profiling section identifier"
    );
    assert_eq!(
        api_concepts.len(),
        PROFILING_API_CONCEPT_SECTIONS.len(),
        "duplicate API concept disposition"
    );
    assert!(
        PROFILING_API_CONCEPT_SECTIONS
            .iter()
            .all(|(_, evidence)| !evidence.is_empty())
    );
}

#[test]
fn all_bcp14_candidates_have_exact_hashes_and_role_dispositions() {
    assert_eq!(PINNED_UI_SHA256.len(), 64, "UI source hash width");
    assert_eq!(
        PINNED_PROFILING_SHA256.len(),
        64,
        "Profiling source hash width"
    );
    assert_eq!(PINNED_UI_SYNTAX_RULES, 0, "UI syntax-rule count");
    assert_eq!(
        PINNED_PROFILING_SYNTAX_RULES, 0,
        "Profiling syntax-rule count"
    );
    assert_eq!(PINNED_UI_APPROVED_TESTS, 0, "UI approved-test count");
    assert_eq!(
        PINNED_PROFILING_APPROVED_TESTS, 0,
        "Profiling approved-test count"
    );
    assert_eq!(UI_BCP14.len(), 19);
    assert_eq!(PROFILING_BCP14.len(), 13);
    assert_exact_rows(UI_BCP14, "not-applicable:renderer-or-ui");
    assert_exact_rows(PROFILING_BCP14, "not-applicable:profile-or-data-author");
}

fn words(value: &'static str) -> BTreeSet<&'static str> {
    value.split_ascii_whitespace().collect()
}

fn assert_exact_rows(rows: &[(&str, &str, &str)], expected_disposition: &str) {
    let ids = rows.iter().map(|(id, _, _)| *id).collect::<BTreeSet<_>>();
    assert_eq!(ids.len(), rows.len(), "duplicate clause candidate ID");
    for (id, hash, disposition) in rows {
        assert!(!id.is_empty(), "clause candidate ID must not be empty");
        assert_eq!(hash.len(), 64, "{id} must have a full SHA-256");
        assert!(
            hash.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "{id} has a non-hexadecimal SHA-256"
        );
        assert_eq!(
            *disposition, expected_disposition,
            "{id} has the wrong processor-role disposition"
        );
    }
}
