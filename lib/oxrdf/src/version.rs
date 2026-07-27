/// An RDF language version.
///
/// This type is used by serializers whose concrete syntax can explicitly
/// announce the RDF version of a document.
#[derive(Default, Debug, Clone, Copy, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum RdfVersion {
    /// RDF 1.1.
    ///
    /// This is the default in order to preserve the output of existing
    /// serializers.
    #[default]
    V1_1,
    /// RDF 1.2 Basic.
    ///
    /// This profile includes directional language-tagged strings but excludes
    /// triple terms.
    V1_2Basic,
    /// RDF 1.2.
    V1_2,
}

impl RdfVersion {
    /// Returns whether this version permits directional language-tagged
    /// strings.
    pub const fn supports_directional_language_strings(self) -> bool {
        matches!(self, Self::V1_2Basic | Self::V1_2)
    }

    /// Returns whether this version permits triple terms.
    pub const fn supports_triple_terms(self) -> bool {
        matches!(self, Self::V1_2)
    }
}
