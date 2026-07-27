use super::{ProfileError, ProfileId, ProfileSet};
use std::collections::BTreeSet;

/// Required and optional profile identifiers supplied by a caller.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProfileRequest {
    required: BTreeSet<String>,
    optional: BTreeSet<String>,
}

impl ProfileRequest {
    /// Creates a request from required and optional profile identifiers.
    ///
    /// Identifiers repeated in both inputs remain required.
    pub fn new<R, O, Required, Optional>(required: R, optional: O) -> Self
    where
        R: IntoIterator<Item = Required>,
        O: IntoIterator<Item = Optional>,
        Required: Into<String>,
        Optional: Into<String>,
    {
        let required = required
            .into_iter()
            .map(Into::into)
            .collect::<BTreeSet<_>>();
        let mut optional = optional
            .into_iter()
            .map(Into::into)
            .collect::<BTreeSet<_>>();
        optional.retain(|identifier| !required.contains(identifier));
        Self { required, optional }
    }

    /// Iterates over required identifiers in lexical order.
    pub fn required(&self) -> impl Iterator<Item = &str> {
        self.required.iter().map(String::as_str)
    }

    /// Iterates over optional identifiers in lexical order.
    pub fn optional(&self) -> impl Iterator<Item = &str> {
        self.optional.iter().map(String::as_str)
    }

    /// Negotiates this request against the profiles compiled into the crate.
    pub fn negotiate(&self) -> Result<ProfileNegotiation, ProfileError> {
        negotiate_profiles(self.required(), self.optional())
    }
}

/// An optional profile that was not selected, with the exact reason.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileRejection {
    identifier: String,
    error: ProfileError,
}

impl ProfileRejection {
    /// Returns the rejected optional identifier.
    pub fn identifier(&self) -> &str {
        &self.identifier
    }

    /// Returns the reason the optional identifier was rejected.
    pub fn error(&self) -> &ProfileError {
        &self.error
    }
}

/// The selected implementation profiles and all rejected optional offers.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileNegotiation {
    selected: ProfileSet,
    rejected_optional: Vec<ProfileRejection>,
}

impl ProfileNegotiation {
    /// Returns the selected implementation profile set.
    pub fn selected(&self) -> &ProfileSet {
        &self.selected
    }

    /// Returns optional offers that could not be selected.
    pub fn rejected_optional(&self) -> &[ProfileRejection] {
        &self.rejected_optional
    }

    /// Consumes the negotiation and returns its selected profile set.
    pub fn into_selected(self) -> ProfileSet {
        self.selected
    }
}

/// Negotiates required and optional profile identifiers.
///
/// Required identifiers fail the whole negotiation when unavailable. Optional
/// identifiers are retained as [`ProfileRejection`] values with exact reasons.
/// Dependencies of selected profiles are added automatically.
pub fn negotiate_profiles<R, O, Required, Optional>(
    required: R,
    optional: O,
) -> Result<ProfileNegotiation, ProfileError>
where
    R: IntoIterator<Item = Required>,
    O: IntoIterator<Item = Optional>,
    Required: AsRef<str>,
    Optional: AsRef<str>,
{
    let mut selected = BTreeSet::new();
    for identifier in required {
        let profile = ProfileId::from_identifier(identifier.as_ref())?;
        selected.extend(ProfileSet::with_dependencies([profile])?.iter());
    }

    let mut rejected_optional = Vec::new();
    for identifier in optional {
        let identifier = identifier.as_ref();
        match ProfileId::from_identifier(identifier)
            .and_then(|profile| ProfileSet::with_dependencies([profile]))
        {
            Ok(profiles) => selected.extend(profiles.iter()),
            Err(error) => rejected_optional.push(ProfileRejection {
                identifier: identifier.to_owned(),
                error,
            }),
        }
    }

    if selected.is_empty() {
        return Err(ProfileError::NoCompatibleProfile);
    }
    Ok(ProfileNegotiation {
        selected: ProfileSet::new(selected)?,
        rejected_optional,
    })
}
