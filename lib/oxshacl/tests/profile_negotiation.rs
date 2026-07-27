#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests lock the public profile metadata and negotiation contract"
)]

use oxshacl::{
    ConformanceRequest, PINNED_SHACL_SOURCE_COMMIT, ProfileError, ProfileId, ProfileRequest,
    ProfileSet, SpecificationProfileId, negotiate_profiles, profile_catalog_json,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[test]
fn implemented_profile_metadata_is_exact_and_dependency_closed() {
    let expected = [
        (
            ProfileId::Core12Subset20260723,
            "shacl-1.2-core-2026-07-23-subset-v1",
            "2026-07-23",
            "69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e",
            Some(SpecificationProfileId::Core),
        ),
        (
            ProfileId::NodeExpressions12Subset20260108,
            "shacl-1.2-node-expressions-2026-01-08-subset-v1",
            "2026-01-08",
            "a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72",
            Some(SpecificationProfileId::NodeExpressions),
        ),
        (
            ProfileId::SparqlExtensions12Subset20260130,
            "shacl-1.2-sparql-extensions-2026-01-30-subset-v1",
            "2026-01-30",
            "c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c",
            Some(SpecificationProfileId::Sparql),
        ),
        (
            ProfileId::Rules12Subset20260727,
            "shacl-1.2-rules-2026-07-27-subset-v1",
            "2026-07-27",
            "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
            Some(SpecificationProfileId::Rules),
        ),
        (
            ProfileId::CompactSyntax12Subset20251030,
            "shacl-1.2-compact-syntax-2025-10-30-subset-v1",
            "2025-10-30",
            "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
            None,
        ),
    ];
    assert_eq!(ProfileId::all().len(), expected.len());
    assert_eq!(PINNED_SHACL_SOURCE_COMMIT.len(), 40);
    for (profile, identifier, draft_date, source_sha256, w3c_profile) in expected {
        let descriptor = profile.descriptor();
        assert_eq!(profile.as_str(), identifier);
        assert_eq!(descriptor.id, profile);
        assert_eq!(descriptor.version.draft_date, draft_date);
        assert_eq!(descriptor.version.subset_revision, 1);
        assert_eq!(descriptor.version.source_commit, PINNED_SHACL_SOURCE_COMMIT);
        assert_eq!(descriptor.version.source_sha256, source_sha256);
        assert_eq!(descriptor.w3c_profile, w3c_profile);
        assert_eq!(descriptor.version.source_sha256.len(), 64);
        assert_eq!(
            ProfileId::from_identifier(identifier),
            Ok(profile),
            "stable text identifier must round-trip"
        );
        if profile == ProfileId::Core12Subset20260723 {
            assert!(descriptor.dependencies.is_empty());
        } else {
            assert_eq!(descriptor.dependencies, [ProfileId::Core12Subset20260723]);
        }
    }
}

#[test]
fn pinned_w3c_profiles_are_descriptive_and_never_subset_aliases() {
    let expected = BTreeSet::from([
        "http://www.w3.org/ns/shacl/profile/core",
        "http://www.w3.org/ns/shacl/profile/sparql",
        "http://www.w3.org/ns/shacl/profile/node-expr",
        "http://www.w3.org/ns/shacl/profile/rules",
        "http://www.w3.org/ns/shacl/profile/ui",
        "http://www.w3.org/ns/shacl/profile/profiling",
        "http://www.w3.org/ns/shacl/profile/union",
    ]);
    let actual = SpecificationProfileId::all()
        .into_iter()
        .map(SpecificationProfileId::as_iri)
        .collect::<BTreeSet<_>>();
    assert_eq!(actual, expected);
    assert_eq!(actual.len(), 7);
    assert_eq!(SpecificationProfileId::Ui.implemented_subset(), None);
    assert_eq!(SpecificationProfileId::Profiling.implemented_subset(), None);
    assert_eq!(SpecificationProfileId::Union.implemented_subset(), None);

    for profile in SpecificationProfileId::all() {
        assert!(matches!(
            ProfileId::from_identifier(profile.as_iri()),
            Err(ProfileError::UnsupportedComplete(_))
        ));
    }
}

#[test]
fn negotiation_resolves_dependencies_and_reports_optional_rejections() {
    let request = ProfileRequest::new(
        [ProfileId::NodeExpressions12Subset20260108.as_str()],
        [
            "urn:example:unknown-profile",
            SpecificationProfileId::Ui.as_iri(),
        ],
    );
    let result = request.negotiate().unwrap();
    assert_eq!(
        result.selected().iter().collect::<BTreeSet<_>>(),
        BTreeSet::from([
            ProfileId::Core12Subset20260723,
            ProfileId::NodeExpressions12Subset20260108,
        ])
    );
    assert_eq!(result.rejected_optional().len(), 2);
    assert!(result.rejected_optional().iter().any(|rejection| {
        rejection.identifier() == "urn:example:unknown-profile"
            && matches!(rejection.error(), ProfileError::UnknownIdentifier(_))
    }));
    assert!(result.rejected_optional().iter().any(|rejection| {
        rejection.identifier() == SpecificationProfileId::Ui.as_iri()
            && matches!(rejection.error(), ProfileError::UnsupportedComplete(_))
    }));

    assert!(matches!(
        negotiate_profiles(
            [SpecificationProfileId::Profiling.as_iri()],
            std::iter::empty::<&str>()
        ),
        Err(ProfileError::UnsupportedComplete("SHACL 1.2 Profiling"))
    ));
    assert!(matches!(
        negotiate_profiles(std::iter::empty::<&str>(), ["urn:example:unknown-profile"]),
        Err(ProfileError::NoCompatibleProfile)
    ));
}

#[test]
fn compatibility_is_directional_and_missing_profiles_fail_closed() {
    let core = ProfileSet::default();
    let rules = ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap();
    assert!(rules.is_compatible_with(&core));
    assert!(!core.is_compatible_with(&rules));
    assert_eq!(
        core.ensure_compatible_with(&rules),
        Err(ProfileError::MissingProfile(
            ProfileId::Rules12Subset20260727
        ))
    );
}

#[test]
fn feature_negotiation_is_explicit() {
    let identifier = ProfileId::SparqlExtensions12Subset20260130.as_str();
    #[cfg(feature = "sparql")]
    {
        let negotiated = negotiate_profiles([identifier], std::iter::empty::<&str>()).unwrap();
        assert!(
            negotiated
                .selected()
                .contains(ProfileId::SparqlExtensions12Subset20260130)
        );
    }
    #[cfg(not(feature = "sparql"))]
    {
        assert_eq!(
            negotiate_profiles([identifier], std::iter::empty::<&str>()),
            Err(ProfileError::FeatureDisabled("sparql"))
        );
        let negotiated =
            negotiate_profiles([ProfileId::Core12Subset20260723.as_str()], [identifier]).unwrap();
        assert_eq!(negotiated.rejected_optional().len(), 1);
        assert!(matches!(
            negotiated.rejected_optional()[0].error(),
            ProfileError::FeatureDisabled("sparql")
        ));
    }
}

#[test]
fn complete_ui_profiling_and_union_requests_fail_closed() {
    for request in [
        ConformanceRequest::CompleteUi12,
        ConformanceRequest::CompleteProfiling12,
        ConformanceRequest::CompleteUnion12,
    ] {
        assert!(matches!(
            request.verify(),
            Err(ProfileError::UnsupportedComplete(_))
        ));
    }
}

#[test]
fn profile_catalog_export_is_canonical_and_machine_readable() {
    let json = profile_catalog_json();
    assert_eq!(json, profile_catalog_json());
    assert!(json.starts_with("{\"schemaVersion\":1,\"sourceCommit\":\""));
    assert_eq!(json.matches("\"complete\":false").count(), 5);
    assert_eq!(json.matches("\"completeImplemented\":false").count(), 7);
    assert_eq!(json.matches("\"implementedSubset\":null").count(), 3);
    assert!(!json.contains("\"complete\":true"));
    assert_eq!(
        sha256_hex(json.as_bytes()),
        "1bc87e57198754e659d73b75077ea1f180a1d1a45330756a20414263a84e1a4e"
    );

    let selected = ProfileSet::new([
        ProfileId::Rules12Subset20260727,
        ProfileId::Core12Subset20260723,
    ])
    .unwrap();
    assert_eq!(
        selected.canonical_json(),
        "{\"profiles\":[\"shacl-1.2-core-2026-07-23-subset-v1\",\"shacl-1.2-rules-2026-07-27-subset-v1\"]}"
    );
}

fn sha256_hex(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(value);
    let mut output = String::with_capacity(64);
    for byte in digest {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}
