use std::collections::BTreeSet;

mod catalog;
mod negotiation;

pub use self::catalog::{
    PINNED_SHACL_SOURCE_COMMIT, ProfileDescriptor, ProfileId, ProfileVersion,
    SpecificationProfileId, profile_catalog_json,
};
pub use self::negotiation::{
    ProfileNegotiation, ProfileRejection, ProfileRequest, negotiate_profiles,
};

/// A closed set of implementation feature profiles used for one operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileSet(BTreeSet<ProfileId>);

impl Default for ProfileSet {
    fn default() -> Self {
        Self(BTreeSet::from([ProfileId::Core12Subset20260723]))
    }
}

impl ProfileSet {
    /// Builds a profile set and verifies feature availability and dependencies.
    ///
    /// The set must not be empty. Extension profiles must be accompanied by
    /// every dependency declared in their [`ProfileDescriptor`].
    pub fn new(profiles: impl IntoIterator<Item = ProfileId>) -> Result<Self, ProfileError> {
        let profiles = profiles.into_iter().collect::<BTreeSet<_>>();
        if profiles.is_empty() {
            return Err(ProfileError::Empty);
        }
        for profile in &profiles {
            for dependency in profile.descriptor().dependencies {
                if !profiles.contains(dependency) {
                    if *dependency == ProfileId::Core12Subset20260723 {
                        return Err(ProfileError::CoreRequired);
                    }
                    return Err(ProfileError::MissingDependency {
                        profile: *profile,
                        dependency: *dependency,
                    });
                }
            }
            #[cfg(not(feature = "sparql"))]
            if profile.descriptor().required_feature == Some("sparql") {
                return Err(ProfileError::FeatureDisabled("sparql"));
            }
        }
        Ok(Self(profiles))
    }

    /// Returns whether `profile` is selected.
    pub fn contains(&self, profile: ProfileId) -> bool {
        self.0.contains(&profile)
    }

    /// Iterates over the selected profiles in their canonical order.
    pub fn iter(&self) -> impl Iterator<Item = ProfileId> + '_ {
        self.0.iter().copied()
    }

    /// Serializes the selected identifiers as a canonical comma-separated list.
    pub fn canonical_text(&self) -> String {
        self.iter()
            .map(ProfileId::as_str)
            .collect::<Vec<_>>()
            .join(",")
    }

    /// Serializes the selected identifiers to a deterministic JSON object.
    pub fn canonical_json(&self) -> String {
        let mut output = String::from("{\"profiles\":[");
        for (index, profile) in self.iter().enumerate() {
            if index > 0 {
                output.push(',');
            }
            output.push('"');
            output.push_str(profile.as_str());
            output.push('"');
        }
        output.push_str("]}");
        output
    }

    /// Returns whether this set contains all profiles in `required`.
    pub fn is_compatible_with(&self, required: &Self) -> bool {
        required.0.is_subset(&self.0)
    }

    /// Verifies that this set contains all profiles in `required`.
    pub fn ensure_compatible_with(&self, required: &Self) -> Result<(), ProfileError> {
        if let Some(profile) = required.iter().find(|profile| !self.contains(*profile)) {
            return Err(ProfileError::MissingProfile(profile));
        }
        Ok(())
    }

    pub(super) fn with_dependencies(
        profiles: impl IntoIterator<Item = ProfileId>,
    ) -> Result<Self, ProfileError> {
        let mut profiles = profiles.into_iter().collect::<BTreeSet<_>>();
        loop {
            let dependencies = profiles
                .iter()
                .flat_map(|profile| profile.descriptor().dependencies.iter().copied())
                .filter(|dependency| !profiles.contains(dependency))
                .collect::<Vec<_>>();
            if dependencies.is_empty() {
                break;
            }
            profiles.extend(dependencies);
        }
        Self::new(profiles)
    }
}

/// Conformance claim requested by an application.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConformanceRequest {
    /// Claim only the explicitly selected dated implementation profiles.
    ImplementedFeatureSet,
    /// Request complete SHACL 1.2 Core conformance.
    CompleteCore12,
    /// Request complete SHACL 1.2 Node Expressions conformance.
    CompleteNodeExpressions12,
    /// Request complete SHACL 1.2 SPARQL Extensions conformance.
    CompleteSparqlExtensions12,
    /// Request complete SHACL 1.2 Rules conformance.
    CompleteRules12,
    /// Request complete SHACL 1.2 Compact Syntax conformance.
    CompleteCompactSyntax12,
    /// Request complete SHACL 1.2 UI conformance.
    CompleteUi12,
    /// Request complete SHACL 1.2 Profiling conformance.
    CompleteProfiling12,
    /// Request complete SHACL 1.2 Union Profile conformance.
    CompleteUnion12,
}

impl ConformanceRequest {
    /// Verifies that this conformance claim is supported.
    ///
    /// Complete-profile requests currently fail closed because the crate claims
    /// only its dated implementation feature sets.
    pub fn verify(self) -> Result<(), ProfileError> {
        match self {
            Self::ImplementedFeatureSet => Ok(()),
            Self::CompleteCore12 => Err(ProfileError::UnsupportedComplete("SHACL 1.2 Core")),
            Self::CompleteNodeExpressions12 => Err(ProfileError::UnsupportedComplete(
                "SHACL 1.2 Node Expressions",
            )),
            Self::CompleteSparqlExtensions12 => Err(ProfileError::UnsupportedComplete(
                "SHACL 1.2 SPARQL Extensions",
            )),
            Self::CompleteRules12 => Err(ProfileError::UnsupportedComplete("SHACL 1.2 Rules")),
            Self::CompleteCompactSyntax12 => Err(ProfileError::UnsupportedComplete(
                "SHACL 1.2 Compact Syntax",
            )),
            Self::CompleteUi12 => Err(ProfileError::UnsupportedComplete("SHACL 1.2 UI")),
            Self::CompleteProfiling12 => {
                Err(ProfileError::UnsupportedComplete("SHACL 1.2 Profiling"))
            }
            Self::CompleteUnion12 => {
                Err(ProfileError::UnsupportedComplete("SHACL 1.2 Union Profile"))
            }
        }
    }
}

/// An invalid, unavailable, or unsupported SHACL profile selection.
#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ProfileError {
    /// No implementation profile was selected.
    #[error("at least one SHACL profile must be selected")]
    Empty,
    /// An extension profile was selected without the required Core profile.
    #[error("extension profiles require the dated SHACL Core subset")]
    CoreRequired,
    /// A selected profile is missing one of its dependencies.
    #[error("profile `{profile}` requires profile `{dependency}`")]
    MissingDependency {
        /// The profile whose dependency is missing.
        profile: ProfileId,
        /// The missing dependency.
        dependency: ProfileId,
    },
    /// A profile required by a compatibility check is not selected.
    #[error("the required profile `{0}` is not selected")]
    MissingProfile(ProfileId),
    /// A profile depends on a disabled crate feature.
    #[error("the crate feature `{0}` is disabled")]
    FeatureDisabled(&'static str),
    /// An identifier names neither an implementation profile nor a W3C profile.
    #[error("unknown SHACL implementation profile identifier `{0}`")]
    UnknownIdentifier(String),
    /// Negotiation did not select any implementation profile.
    #[error("no requested SHACL implementation profile is available")]
    NoCompatibleProfile,
    /// A complete W3C profile was requested where only a dated subset exists.
    #[error("complete {0} conformance is not implemented; request the dated feature set")]
    UnsupportedComplete(&'static str),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_requires_core() {
        assert_eq!(
            ProfileSet::new([ProfileId::Rules12Subset20260727]),
            Err(ProfileError::CoreRequired)
        );
    }

    #[test]
    fn full_claim_fails_closed() {
        assert!(matches!(
            ConformanceRequest::CompleteCore12.verify(),
            Err(ProfileError::UnsupportedComplete(_))
        ));
    }
}
