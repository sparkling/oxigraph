use crate::RdfFormat;

/// An invalid serializer configuration.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum RdfSerializerConfigError {
    /// The selected concrete syntax cannot announce an RDF version.
    #[error("RDF version cannot be configured for {format}")]
    UnsupportedRdfVersion {
        /// The selected serialization format.
        format: RdfFormat,
    },
}
