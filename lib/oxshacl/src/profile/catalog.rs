use super::ProfileError;
use std::fmt::{Display, Formatter};
use std::str::FromStr;

/// Git commit from which the pinned SHACL draft artifacts were captured.
pub const PINNED_SHACL_SOURCE_COMMIT: &str = "eedda09f93c39be1d2e978f3f942631494ae25a0";

const CORE_DEPENDENCIES: &[ProfileId] = &[];
const EXTENSION_DEPENDENCIES: &[ProfileId] = &[ProfileId::Core12Subset20260723];

/// Dated feature-set identifiers implemented by this crate.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ProfileId {
    /// The dated SHACL 1.2 Core implementation subset.
    Core12Subset20260723,
    /// The dated SHACL 1.2 Node Expressions implementation subset.
    NodeExpressions12Subset20260108,
    /// The dated SHACL 1.2 SPARQL Extensions implementation subset.
    SparqlExtensions12Subset20260130,
    /// The dated SHACL 1.2 Rules implementation subset.
    Rules12Subset20260727,
    /// The dated SHACL 1.2 Compact Syntax implementation subset.
    CompactSyntax12Subset20251030,
}

/// The pinned source version used to define an implementation profile.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProfileVersion {
    /// Publication date of the pinned editor's draft.
    pub draft_date: &'static str,
    /// Revision of OxSHACL's subset definition for that draft.
    pub subset_revision: u16,
    /// Git commit used to obtain the source artifact.
    pub source_commit: &'static str,
    /// SHA-256 digest of the pinned source artifact.
    pub source_sha256: &'static str,
}

/// Machine-readable metadata for one implemented, explicitly incomplete profile.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProfileDescriptor {
    /// Stable identifier for the implementation profile.
    pub id: ProfileId,
    /// Human-readable implementation profile name.
    pub label: &'static str,
    /// Specification defining the feature family.
    pub specification_iri: &'static str,
    /// Corresponding W3C profile, when one is defined.
    pub w3c_profile: Option<SpecificationProfileId>,
    /// Pinned draft and subset revision.
    pub version: ProfileVersion,
    /// Profiles that must be selected with this profile.
    pub dependencies: &'static [ProfileId],
    /// Cargo feature required to select this profile, if any.
    pub required_feature: Option<&'static str>,
}

/// Profiles named by the pinned SHACL Profiling appendix.
///
/// These identifiers describe W3C profiles. They are deliberately distinct
/// from [`ProfileId`], because OxSHACL implements dated subsets rather than any
/// complete W3C profile.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum SpecificationProfileId {
    /// SHACL Core.
    Core,
    /// SHACL SPARQL Extensions.
    Sparql,
    /// SHACL Node Expressions.
    NodeExpressions,
    /// SHACL Rules.
    Rules,
    /// SHACL UI.
    Ui,
    /// SHACL Profiling.
    Profiling,
    /// The union of the SHACL profiles.
    Union,
}

const CORE: ProfileDescriptor = ProfileDescriptor {
    id: ProfileId::Core12Subset20260723,
    label: "OxSHACL SHACL 1.2 Core subset",
    specification_iri: "https://w3c.github.io/data-shapes/shacl12-core/",
    w3c_profile: Some(SpecificationProfileId::Core),
    version: ProfileVersion {
        draft_date: "2026-07-23",
        subset_revision: 1,
        source_commit: PINNED_SHACL_SOURCE_COMMIT,
        source_sha256: "69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e",
    },
    dependencies: CORE_DEPENDENCIES,
    required_feature: None,
};

const NODE_EXPRESSIONS: ProfileDescriptor = ProfileDescriptor {
    id: ProfileId::NodeExpressions12Subset20260108,
    label: "OxSHACL SHACL 1.2 Node Expressions subset",
    specification_iri: "https://w3c.github.io/data-shapes/shacl12-node-expr/",
    w3c_profile: Some(SpecificationProfileId::NodeExpressions),
    version: ProfileVersion {
        draft_date: "2026-01-08",
        subset_revision: 1,
        source_commit: PINNED_SHACL_SOURCE_COMMIT,
        source_sha256: "a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72",
    },
    dependencies: EXTENSION_DEPENDENCIES,
    required_feature: None,
};

const SPARQL: ProfileDescriptor = ProfileDescriptor {
    id: ProfileId::SparqlExtensions12Subset20260130,
    label: "OxSHACL SHACL 1.2 SPARQL Extensions subset",
    specification_iri: "https://w3c.github.io/data-shapes/shacl12-sparql/",
    w3c_profile: Some(SpecificationProfileId::Sparql),
    version: ProfileVersion {
        draft_date: "2026-01-30",
        subset_revision: 1,
        source_commit: PINNED_SHACL_SOURCE_COMMIT,
        source_sha256: "c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c",
    },
    dependencies: EXTENSION_DEPENDENCIES,
    required_feature: Some("sparql"),
};

const RULES: ProfileDescriptor = ProfileDescriptor {
    id: ProfileId::Rules12Subset20260727,
    label: "OxSHACL SHACL 1.2 Rules subset",
    specification_iri: "https://w3c.github.io/data-shapes/shacl12-rules/",
    w3c_profile: Some(SpecificationProfileId::Rules),
    version: ProfileVersion {
        draft_date: "2026-07-27",
        subset_revision: 1,
        source_commit: PINNED_SHACL_SOURCE_COMMIT,
        source_sha256: "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
    },
    dependencies: EXTENSION_DEPENDENCIES,
    required_feature: None,
};

const COMPACT: ProfileDescriptor = ProfileDescriptor {
    id: ProfileId::CompactSyntax12Subset20251030,
    label: "OxSHACL SHACL 1.2 Compact Syntax subset",
    specification_iri: "https://w3c.github.io/data-shapes/shacl12-compact-syntax/",
    w3c_profile: None,
    version: ProfileVersion {
        draft_date: "2025-10-30",
        subset_revision: 1,
        source_commit: PINNED_SHACL_SOURCE_COMMIT,
        source_sha256: "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
    },
    dependencies: EXTENSION_DEPENDENCIES,
    required_feature: None,
};

impl ProfileId {
    /// Returns every dated implementation profile in canonical order.
    pub const fn all() -> [Self; 5] {
        [
            Self::Core12Subset20260723,
            Self::NodeExpressions12Subset20260108,
            Self::SparqlExtensions12Subset20260130,
            Self::Rules12Subset20260727,
            Self::CompactSyntax12Subset20251030,
        ]
    }

    /// Returns the stable textual identifier for this implementation profile.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Core12Subset20260723 => "shacl-1.2-core-2026-07-23-subset-v1",
            Self::NodeExpressions12Subset20260108 => {
                "shacl-1.2-node-expressions-2026-01-08-subset-v1"
            }
            Self::SparqlExtensions12Subset20260130 => {
                "shacl-1.2-sparql-extensions-2026-01-30-subset-v1"
            }
            Self::Rules12Subset20260727 => "shacl-1.2-rules-2026-07-27-subset-v1",
            Self::CompactSyntax12Subset20251030 => "shacl-1.2-compact-syntax-2025-10-30-subset-v1",
        }
    }

    /// Returns the metadata describing this implementation profile.
    pub const fn descriptor(self) -> &'static ProfileDescriptor {
        match self {
            Self::Core12Subset20260723 => &CORE,
            Self::NodeExpressions12Subset20260108 => &NODE_EXPRESSIONS,
            Self::SparqlExtensions12Subset20260130 => &SPARQL,
            Self::Rules12Subset20260727 => &RULES,
            Self::CompactSyntax12Subset20251030 => &COMPACT,
        }
    }

    /// Parses a dated implementation-profile identifier.
    ///
    /// A complete W3C profile IRI is rejected explicitly rather than silently
    /// converted to the corresponding incomplete subset.
    pub fn from_identifier(identifier: &str) -> Result<Self, ProfileError> {
        if let Some(profile) = Self::all()
            .into_iter()
            .find(|profile| identifier == profile.as_str())
        {
            return Ok(profile);
        }
        if let Some(profile) = SpecificationProfileId::from_iri(identifier) {
            return Err(ProfileError::UnsupportedComplete(profile.label()));
        }
        Err(ProfileError::UnknownIdentifier(identifier.to_owned()))
    }
}

impl Display for ProfileId {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ProfileId {
    type Err = ProfileError;

    fn from_str(identifier: &str) -> Result<Self, Self::Err> {
        Self::from_identifier(identifier)
    }
}

impl SpecificationProfileId {
    /// Returns every W3C SHACL profile in canonical order.
    pub const fn all() -> [Self; 7] {
        [
            Self::Core,
            Self::Sparql,
            Self::NodeExpressions,
            Self::Rules,
            Self::Ui,
            Self::Profiling,
            Self::Union,
        ]
    }

    /// Returns the normative profile IRI.
    pub const fn as_iri(self) -> &'static str {
        match self {
            Self::Core => "http://www.w3.org/ns/shacl/profile/core",
            Self::Sparql => "http://www.w3.org/ns/shacl/profile/sparql",
            Self::NodeExpressions => "http://www.w3.org/ns/shacl/profile/node-expr",
            Self::Rules => "http://www.w3.org/ns/shacl/profile/rules",
            Self::Ui => "http://www.w3.org/ns/shacl/profile/ui",
            Self::Profiling => "http://www.w3.org/ns/shacl/profile/profiling",
            Self::Union => "http://www.w3.org/ns/shacl/profile/union",
        }
    }

    /// Returns a human-readable profile name.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Core => "SHACL 1.2 Core",
            Self::Sparql => "SHACL 1.2 SPARQL",
            Self::NodeExpressions => "SHACL 1.2 Node Expressions",
            Self::Rules => "SHACL 1.2 Rules",
            Self::Ui => "SHACL 1.2 UI",
            Self::Profiling => "SHACL 1.2 Profiling",
            Self::Union => "SHACL 1.2 Union Profile",
        }
    }

    /// Returns the editor's-draft IRI, if the profile has a standalone draft.
    pub const fn specification_iri(self) -> Option<&'static str> {
        match self {
            Self::Core => Some("https://w3c.github.io/data-shapes/shacl12-core/"),
            Self::Sparql => Some("https://w3c.github.io/data-shapes/shacl12-sparql/"),
            Self::NodeExpressions => Some("https://w3c.github.io/data-shapes/shacl12-node-expr/"),
            Self::Rules => Some("https://w3c.github.io/data-shapes/shacl12-rules/"),
            Self::Ui => Some("https://w3c.github.io/data-shapes/shacl12-ui/"),
            Self::Profiling => Some("https://w3c.github.io/data-shapes/shacl12-profiling/"),
            Self::Union => None,
        }
    }

    /// Returns the digest of the pinned draft artifact, if one exists.
    pub const fn source_sha256(self) -> Option<&'static str> {
        match self {
            Self::Core => Some("69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e"),
            Self::Sparql => {
                Some("c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c")
            }
            Self::NodeExpressions => {
                Some("a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72")
            }
            Self::Rules => Some("45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4"),
            Self::Ui => Some("3b289645228d4cf154608259d38555d9b946f50b52c21648d586fd8172c07853"),
            Self::Profiling => {
                Some("248602e3a92b2c6d72b6734ce65638dcdc05afe7c4a657abba719d2c07f25202")
            }
            Self::Union => None,
        }
    }

    /// Returns OxSHACL's corresponding dated subset, if implemented.
    pub const fn implemented_subset(self) -> Option<ProfileId> {
        match self {
            Self::Core => Some(ProfileId::Core12Subset20260723),
            Self::Sparql => Some(ProfileId::SparqlExtensions12Subset20260130),
            Self::NodeExpressions => Some(ProfileId::NodeExpressions12Subset20260108),
            Self::Rules => Some(ProfileId::Rules12Subset20260727),
            Self::Ui | Self::Profiling | Self::Union => None,
        }
    }

    /// Resolves a normative W3C profile IRI.
    pub fn from_iri(iri: &str) -> Option<Self> {
        Self::all()
            .into_iter()
            .find(|profile| profile.as_iri() == iri)
    }
}

/// Serializes the W3C and implementation profile catalogs as deterministic JSON.
pub fn profile_catalog_json() -> String {
    let mut output = String::from("{\"schemaVersion\":1,\"sourceCommit\":\"");
    output.push_str(PINNED_SHACL_SOURCE_COMMIT);
    output.push_str("\",\"w3cProfiles\":[");
    for (index, profile) in SpecificationProfileId::all().into_iter().enumerate() {
        if index > 0 {
            output.push(',');
        }
        output.push_str("{\"id\":\"");
        output.push_str(profile.as_iri());
        output.push_str("\",\"label\":\"");
        output.push_str(profile.label());
        output.push_str("\",\"completeImplemented\":false,\"specification\":");
        push_optional_json_string(&mut output, profile.specification_iri());
        output.push_str(",\"sourceSha256\":");
        push_optional_json_string(&mut output, profile.source_sha256());
        output.push_str(",\"implementedSubset\":");
        push_optional_json_string(
            &mut output,
            profile.implemented_subset().map(ProfileId::as_str),
        );
        output.push('}');
    }
    output.push_str("],\"implementationProfiles\":[");
    for (index, profile) in ProfileId::all().into_iter().enumerate() {
        if index > 0 {
            output.push(',');
        }
        let descriptor = profile.descriptor();
        output.push_str("{\"id\":\"");
        output.push_str(profile.as_str());
        output.push_str("\",\"label\":\"");
        output.push_str(descriptor.label);
        output.push_str("\",\"complete\":false,\"specification\":\"");
        output.push_str(descriptor.specification_iri);
        output.push_str("\",\"w3cProfile\":");
        push_optional_json_string(
            &mut output,
            descriptor.w3c_profile.map(SpecificationProfileId::as_iri),
        );
        output.push_str(",\"draftDate\":\"");
        output.push_str(descriptor.version.draft_date);
        output.push_str("\",\"subsetRevision\":");
        output.push_str(&descriptor.version.subset_revision.to_string());
        output.push_str(",\"sourceSha256\":\"");
        output.push_str(descriptor.version.source_sha256);
        output.push_str("\",\"dependencies\":[");
        for (dependency_index, dependency) in descriptor.dependencies.iter().enumerate() {
            if dependency_index > 0 {
                output.push(',');
            }
            output.push('"');
            output.push_str(dependency.as_str());
            output.push('"');
        }
        output.push_str("],\"requiredFeature\":");
        push_optional_json_string(&mut output, descriptor.required_feature);
        output.push('}');
    }
    output.push_str("]}");
    output
}

fn push_optional_json_string(output: &mut String, value: Option<&str>) {
    if let Some(value) = value {
        output.push('"');
        output.push_str(value);
        output.push('"');
    } else {
        output.push_str("null");
    }
}
