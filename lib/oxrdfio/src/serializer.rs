//! Utilities to write RDF graphs and datasets.

use crate::format::RdfFormat;
use crate::media_type::{RdfMediaType, RdfMediaTypeParseError};
use crate::serializer_options::RdfSerializerConfigError;
#[cfg(feature = "async-tokio")]
use oxjsonld::TokioAsyncWriterJsonLdSerializer;
use oxjsonld::{JsonLdProfile, JsonLdSerializer, WriterJsonLdSerializer};
use oxrdf::{Dataset, IriParseError, NamedOrBlankNode, Quad, RdfVersion, Term, Triple};
#[cfg(feature = "async-tokio")]
use oxrdfxml::TokioAsyncWriterRdfXmlSerializer;
use oxrdfxml::{RdfXmlSerializer, WriterRdfXmlSerializer};
use oxttl::NTriplesMediaType;
#[cfg(feature = "async-tokio")]
use oxttl::nquads::TokioAsyncWriterNQuadsSerializer;
use oxttl::nquads::{NQuadsSerializer, WriterNQuadsSerializer};
#[cfg(feature = "async-tokio")]
use oxttl::ntriples::TokioAsyncWriterNTriplesSerializer;
use oxttl::ntriples::{NTriplesSerializer, WriterNTriplesSerializer};
#[cfg(feature = "async-tokio")]
use oxttl::trig::TokioAsyncWriterTriGSerializer;
use oxttl::trig::{TriGSerializer, WriterTriGSerializer};
#[cfg(feature = "async-tokio")]
use oxttl::turtle::TokioAsyncWriterTurtleSerializer;
use oxttl::turtle::{TurtleSerializer, WriterTurtleSerializer};
use std::io::{self, Write};
#[cfg(feature = "async-tokio")]
use tokio::io::AsyncWrite;

/// A serializer for RDF serialization formats.
///
/// It currently supports the following formats:
/// * [JSON-LD](https://www.w3.org/TR/json-ld/) ([`RdfFormat::JsonLd`])
/// * [N3](https://w3c.github.io/N3/spec/) ([`RdfFormat::N3`])
/// * [N-Quads](https://www.w3.org/TR/n-quads/) ([`RdfFormat::NQuads`])
/// * [canonical](https://www.w3.org/TR/n-triples/#canonical-ntriples) [N-Triples](https://www.w3.org/TR/n-triples/) ([`RdfFormat::NTriples`])
/// * [RDF/XML](https://www.w3.org/TR/rdf-syntax-grammar/) ([`RdfFormat::RdfXml`])
/// * [TriG](https://www.w3.org/TR/trig/) ([`RdfFormat::TriG`])
/// * [Turtle](https://www.w3.org/TR/turtle/) ([`RdfFormat::Turtle`])
///
/// ```
/// use oxrdfio::{RdfFormat, RdfSerializer};
/// use oxrdf::{Quad, NamedNode};
///
/// let mut serializer = RdfSerializer::from_format(RdfFormat::NQuads).for_writer(Vec::new());
/// serializer.serialize_quad(&Quad {
///    subject: NamedNode::new("http://example.com/s")?.into(),
///    predicate: NamedNode::new("http://example.com/p")?,
///    object: NamedNode::new("http://example.com/o")?.into(),
///    graph_name: NamedNode::new("http://example.com/g")?.into()
/// })?;
/// assert_eq!(serializer.finish()?, b"<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .\n");
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
#[derive(Clone)]
pub struct RdfSerializer {
    inner: RdfSerializerKind,
    format: RdfFormat,
    rdf_version: Option<RdfVersion>,
}

#[derive(Clone)]
enum RdfSerializerKind {
    JsonLd(JsonLdSerializer),
    NQuads(NQuadsSerializer),
    NTriples(NTriplesSerializer),
    RdfXml(RdfXmlSerializer),
    TriG(TriGSerializer),
    Turtle(TurtleSerializer),
}

impl RdfSerializer {
    /// Builds a serializer configured from an RDF media type.
    ///
    /// A `version` parameter is emitted by concrete syntaxes that have a
    /// `VERSION` directive. For other syntaxes it is retained as an external
    /// media-type constraint and incompatible RDF terms are rejected.
    pub fn from_media_type(media_type: &str) -> Result<Self, RdfMediaTypeParseError> {
        let descriptor = RdfMediaType::parse(media_type)?;
        Ok(Self::from_media_type_descriptor(&descriptor))
    }

    /// Builds a serializer from a parsed RDF media type descriptor.
    pub fn from_media_type_descriptor(descriptor: &RdfMediaType) -> Self {
        let serializer = Self::from_format(descriptor.format());
        if let Some(rdf_version) = descriptor.version() {
            serializer.with_version_constraint(rdf_version)
        } else {
            serializer
        }
    }

    /// Builds a serializer for the given format
    #[inline]
    pub fn from_format(format: RdfFormat) -> Self {
        let reported_format = match format {
            RdfFormat::JsonLd { .. } => RdfFormat::JsonLd {
                profile: JsonLdProfile::Streaming.into(),
            },
            RdfFormat::N3 => RdfFormat::Turtle,
            _ => format,
        };
        Self {
            inner: match format {
                RdfFormat::JsonLd { .. } => RdfSerializerKind::JsonLd(JsonLdSerializer::new()),
                RdfFormat::NQuads => RdfSerializerKind::NQuads(NQuadsSerializer::new()),
                RdfFormat::NTriples => RdfSerializerKind::NTriples(NTriplesSerializer::new()),
                RdfFormat::NTriplesTextPlain => RdfSerializerKind::NTriples(
                    NTriplesSerializer::new().with_media_type(NTriplesMediaType::TextPlain),
                ),
                RdfFormat::RdfXml => RdfSerializerKind::RdfXml(RdfXmlSerializer::new()),
                RdfFormat::TriG => RdfSerializerKind::TriG(TriGSerializer::new()),
                RdfFormat::Turtle | RdfFormat::N3 => {
                    RdfSerializerKind::Turtle(TurtleSerializer::new())
                }
            },
            format: reported_format,
            rdf_version: None,
        }
    }

    /// The format the serializer serializes to.
    ///
    /// ```
    /// use oxrdfio::{RdfFormat, RdfSerializer};
    ///
    /// assert_eq!(
    ///     RdfSerializer::from_format(RdfFormat::Turtle).format(),
    ///     RdfFormat::Turtle
    /// );
    /// ```
    pub fn format(&self) -> RdfFormat {
        self.format
    }

    /// Returns the externally configured RDF version constraint, if any.
    pub const fn rdf_version(&self) -> Option<RdfVersion> {
        self.rdf_version
    }

    /// Sets the RDF version for Turtle, TriG, N-Triples, or N-Quads
    /// serialization.
    ///
    /// Other concrete syntaxes return an error instead of silently ignoring
    /// the request to announce a version. Use [`Self::from_media_type`] when a
    /// syntax carries the version only as a media-type parameter.
    pub fn with_rdf_version(
        self,
        rdf_version: RdfVersion,
    ) -> Result<Self, RdfSerializerConfigError> {
        if matches!(
            self.inner,
            RdfSerializerKind::NQuads(_)
                | RdfSerializerKind::NTriples(_)
                | RdfSerializerKind::TriG(_)
                | RdfSerializerKind::Turtle(_)
        ) {
            Ok(self.with_version_constraint(rdf_version))
        } else {
            Err(RdfSerializerConfigError::UnsupportedRdfVersion {
                format: self.format,
            })
        }
    }

    fn with_version_constraint(mut self, rdf_version: RdfVersion) -> Self {
        self.inner = match self.inner {
            RdfSerializerKind::NQuads(serializer) => {
                RdfSerializerKind::NQuads(serializer.with_rdf_version(rdf_version))
            }
            RdfSerializerKind::NTriples(serializer) => {
                RdfSerializerKind::NTriples(serializer.with_rdf_version(rdf_version))
            }
            RdfSerializerKind::TriG(serializer) => {
                RdfSerializerKind::TriG(serializer.with_rdf_version(rdf_version))
            }
            RdfSerializerKind::Turtle(serializer) => {
                RdfSerializerKind::Turtle(serializer.with_rdf_version(rdf_version))
            }
            other => other,
        };
        self.rdf_version = Some(rdf_version);
        self
    }

    /// If the format supports it, sets a prefix.
    ///
    /// ```
    /// use oxrdf::vocab::rdf;
    /// use oxrdf::{NamedNode, Triple};
    /// use oxrdfio::{RdfFormat, RdfSerializer};
    ///
    /// let mut serializer = RdfSerializer::from_format(RdfFormat::Turtle)
    ///     .with_prefix("schema", "http://schema.org/")?
    ///     .for_writer(Vec::new());
    /// serializer.serialize_triple(&Triple::new(
    ///     NamedNode::new("http://example.com/s")?,
    ///     rdf::TYPE,
    ///     NamedNode::new("http://schema.org/Person")?,
    /// ))?;
    /// assert_eq!(
    ///     serializer.finish()?,
    ///     b"@prefix schema: <http://schema.org/> .\n<http://example.com/s> a schema:Person .\n"
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_prefix(
        mut self,
        prefix_name: &str,
        prefix_iri: &str,
    ) -> Result<Self, IriParseError> {
        self.inner = match self.inner {
            RdfSerializerKind::JsonLd(s) => RdfSerializerKind::JsonLd(s),
            RdfSerializerKind::NQuads(s) => RdfSerializerKind::NQuads(s),
            RdfSerializerKind::NTriples(s) => RdfSerializerKind::NTriples(s),
            RdfSerializerKind::RdfXml(s) => {
                RdfSerializerKind::RdfXml(s.with_prefix(prefix_name, prefix_iri)?)
            }
            RdfSerializerKind::TriG(s) => {
                RdfSerializerKind::TriG(s.with_prefix(prefix_name, prefix_iri)?)
            }
            RdfSerializerKind::Turtle(s) => {
                RdfSerializerKind::Turtle(s.with_prefix(prefix_name, prefix_iri)?)
            }
        };
        Ok(self)
    }

    /// If the format supports it, sets a base IRI.
    ///
    /// ```
    /// use oxrdf::vocab::rdf;
    /// use oxrdf::{NamedNode, Triple};
    /// use oxrdfio::{RdfFormat, RdfSerializer};
    ///
    /// let mut serializer = RdfSerializer::from_format(RdfFormat::Turtle)
    ///     .with_base_iri("http://example.com")?
    ///     .with_prefix("ex", "http://example.com/ns#")?
    ///     .for_writer(Vec::new());
    /// serializer.serialize_triple(&Triple::new(
    ///     NamedNode::new("http://example.com/me")?,
    ///     rdf::TYPE,
    ///     NamedNode::new("http://example.com/ns#Person")?,
    /// ))?;
    /// assert_eq!(
    ///     serializer.finish()?,
    ///     b"@base <http://example.com> .\n@prefix ex: </ns#> .\n</me> a ex:Person .\n",
    /// );
    /// # Result::<_,Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_base_iri(mut self, base_iri: &str) -> Result<Self, IriParseError> {
        self.inner = match self.inner {
            RdfSerializerKind::JsonLd(s) => RdfSerializerKind::JsonLd(s),
            RdfSerializerKind::NQuads(s) => RdfSerializerKind::NQuads(s),
            RdfSerializerKind::NTriples(s) => RdfSerializerKind::NTriples(s),
            RdfSerializerKind::RdfXml(s) => RdfSerializerKind::RdfXml(s.with_base_iri(base_iri)?),
            RdfSerializerKind::TriG(s) => RdfSerializerKind::TriG(s.with_base_iri(base_iri)?),
            RdfSerializerKind::Turtle(s) => RdfSerializerKind::Turtle(s.with_base_iri(base_iri)?),
        };
        Ok(self)
    }

    /// Serializes to a [`Write`] implementation.
    ///
    /// <div class="warning">
    ///
    /// Do not forget to run the [`finish`](WriterQuadSerializer::finish()) method to properly write the last bytes of the file.</div>
    ///
    /// <div class="warning">
    ///
    /// This writer does unbuffered writes. You might want to use [`BufWriter`](io::BufWriter) to avoid that.</div>
    ///
    /// ```
    /// use oxrdfio::{RdfFormat, RdfSerializer};
    /// use oxrdf::{Quad, NamedNode};
    ///
    /// let mut serializer = RdfSerializer::from_format(RdfFormat::NQuads).for_writer(Vec::new());
    /// serializer.serialize_quad(&Quad {
    ///    subject: NamedNode::new("http://example.com/s")?.into(),
    ///    predicate: NamedNode::new("http://example.com/p")?,
    ///    object: NamedNode::new("http://example.com/o")?.into(),
    ///    graph_name: NamedNode::new("http://example.com/g")?.into()
    /// })?;
    /// assert_eq!(serializer.finish()?, b"<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .\n");
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn for_writer<W: Write>(self, writer: W) -> WriterQuadSerializer<W> {
        WriterQuadSerializer {
            rdf_version: self.rdf_version,
            inner: match self.inner {
                RdfSerializerKind::JsonLd(s) => {
                    WriterQuadSerializerKind::JsonLd(s.for_writer(writer))
                }
                RdfSerializerKind::NQuads(s) => {
                    WriterQuadSerializerKind::NQuads(s.for_writer(writer))
                }
                RdfSerializerKind::NTriples(s) => {
                    WriterQuadSerializerKind::NTriples(s.for_writer(writer))
                }
                RdfSerializerKind::RdfXml(s) => {
                    WriterQuadSerializerKind::RdfXml(s.for_writer(writer))
                }
                RdfSerializerKind::TriG(s) => WriterQuadSerializerKind::TriG(s.for_writer(writer)),
                RdfSerializerKind::Turtle(s) => {
                    WriterQuadSerializerKind::Turtle(s.for_writer(writer))
                }
            },
        }
    }

    /// Serializes to a Tokio [`AsyncWrite`] implementation.
    ///
    /// <div class="warning">
    ///
    /// Do not forget to run the [`finish`](TokioAsyncWriterQuadSerializer::finish()) method to properly write the last bytes of the file.</div>
    ///
    /// <div class="warning">
    ///
    /// This writer does unbuffered writes. You might want to use [`BufWriter`](tokio::io::BufWriter) to avoid that.</div>
    ///
    /// ```
    /// # #[tokio::main(flavor = "current_thread")]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// use oxrdfio::{RdfFormat, RdfSerializer};
    /// use oxrdf::{Quad, NamedNode};
    ///
    /// let mut serializer = RdfSerializer::from_format(RdfFormat::NQuads).for_tokio_async_writer(Vec::new());
    /// serializer.serialize_quad(&Quad {
    ///     subject: NamedNode::new("http://example.com/s")?.into(),
    ///     predicate: NamedNode::new("http://example.com/p")?,
    ///     object: NamedNode::new("http://example.com/o")?.into(),
    ///     graph_name: NamedNode::new("http://example.com/g")?.into()
    /// }).await?;
    /// assert_eq!(serializer.finish().await?, b"<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .\n");
    /// # Ok(())
    /// # }
    /// ```
    #[cfg(feature = "async-tokio")]
    pub fn for_tokio_async_writer<W: AsyncWrite + Unpin>(
        self,
        writer: W,
    ) -> TokioAsyncWriterQuadSerializer<W> {
        TokioAsyncWriterQuadSerializer {
            rdf_version: self.rdf_version,
            inner: match self.inner {
                RdfSerializerKind::JsonLd(s) => {
                    TokioAsyncWriterQuadSerializerKind::JsonLd(s.for_tokio_async_writer(writer))
                }
                RdfSerializerKind::NQuads(s) => {
                    TokioAsyncWriterQuadSerializerKind::NQuads(s.for_tokio_async_writer(writer))
                }
                RdfSerializerKind::NTriples(s) => {
                    TokioAsyncWriterQuadSerializerKind::NTriples(s.for_tokio_async_writer(writer))
                }
                RdfSerializerKind::RdfXml(s) => {
                    TokioAsyncWriterQuadSerializerKind::RdfXml(s.for_tokio_async_writer(writer))
                }
                RdfSerializerKind::TriG(s) => {
                    TokioAsyncWriterQuadSerializerKind::TriG(s.for_tokio_async_writer(writer))
                }
                RdfSerializerKind::Turtle(s) => {
                    TokioAsyncWriterQuadSerializerKind::Turtle(s.for_tokio_async_writer(writer))
                }
            },
        }
    }
}

impl From<RdfFormat> for RdfSerializer {
    fn from(format: RdfFormat) -> Self {
        Self::from_format(format)
    }
}

/// Serializes quads or triples to a [`Write`] implementation.
///
/// Can be built using [`RdfSerializer::for_writer`].
///
/// <div class="warning">
///
/// Do not forget to run the [`finish`](WriterQuadSerializer::finish()) method to properly write the last bytes of the file.</div>
///
/// <div class="warning">
///
/// This writer does unbuffered writes. You might want to use [`BufWriter`](io::BufWriter) to avoid that.</div>
///
/// ```
/// use oxrdfio::{RdfFormat, RdfSerializer};
/// use oxrdf::{Quad, NamedNode};
///
/// let mut serializer = RdfSerializer::from_format(RdfFormat::NQuads).for_writer(Vec::new());
/// serializer.serialize_quad(&Quad {
///    subject: NamedNode::new("http://example.com/s")?.into(),
///    predicate: NamedNode::new("http://example.com/p")?,
///    object: NamedNode::new("http://example.com/o")?.into(),
///    graph_name: NamedNode::new("http://example.com/g")?.into(),
/// })?;
/// assert_eq!(serializer.finish()?, b"<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .\n");
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
pub struct WriterQuadSerializer<W: Write> {
    inner: WriterQuadSerializerKind<W>,
    rdf_version: Option<RdfVersion>,
}

enum WriterQuadSerializerKind<W: Write> {
    JsonLd(WriterJsonLdSerializer<W>),
    NQuads(WriterNQuadsSerializer<W>),
    NTriples(WriterNTriplesSerializer<W>),
    RdfXml(WriterRdfXmlSerializer<W>),
    TriG(WriterTriGSerializer<W>),
    Turtle(WriterTurtleSerializer<W>),
}

impl<W: Write> WriterQuadSerializer<W> {
    /// Serializes a [`Quad`]
    pub fn serialize_quad(&mut self, quad: &Quad) -> io::Result<()> {
        ensure_term_compatible(self.rdf_version, &quad.object)?;
        match &mut self.inner {
            WriterQuadSerializerKind::JsonLd(serializer) => serializer.serialize_quad(quad),
            WriterQuadSerializerKind::NQuads(serializer) => serializer.serialize_quad(quad),
            WriterQuadSerializerKind::NTriples(serializer) => {
                serializer.serialize_triple(to_triple(quad)?)
            }
            WriterQuadSerializerKind::RdfXml(serializer) => {
                serializer.serialize_triple(to_triple(quad)?)
            }
            WriterQuadSerializerKind::TriG(serializer) => serializer.serialize_quad(quad),
            WriterQuadSerializerKind::Turtle(serializer) => {
                serializer.serialize_triple(to_triple(quad)?)
            }
        }
    }

    /// Serializes an explicitly present empty named graph.
    ///
    /// TriG and JSON-LD preserve this topology. Other formats fail instead of
    /// silently losing the graph.
    pub fn serialize_empty_graph(&mut self, graph_name: &NamedOrBlankNode) -> io::Result<()> {
        match &mut self.inner {
            WriterQuadSerializerKind::JsonLd(serializer) => {
                serializer.serialize_empty_graph(graph_name)
            }
            WriterQuadSerializerKind::TriG(serializer) => {
                serializer.serialize_empty_graph(graph_name)
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the selected RDF format cannot represent an empty named graph",
            )),
        }
    }

    /// Serializes a complete RDF dataset.
    ///
    /// TriG and JSON-LD preserve empty named graphs. Formats whose RDF mapping
    /// cannot represent an empty named graph fail instead of silently dropping
    /// that topology.
    pub fn serialize_dataset(&mut self, dataset: &Dataset) -> io::Result<()> {
        match &mut self.inner {
            WriterQuadSerializerKind::JsonLd(serializer) => {
                return serializer.serialize_dataset(dataset);
            }
            WriterQuadSerializerKind::TriG(serializer) => {
                return serializer.serialize_dataset(dataset);
            }
            _ => {}
        }
        ensure_no_empty_named_graphs(dataset)?;
        for quad in dataset {
            self.serialize_quad(&quad)?;
        }
        Ok(())
    }

    /// Serializes a [`Triple`]
    pub fn serialize_triple(&mut self, triple: &Triple) -> io::Result<()> {
        ensure_term_compatible(self.rdf_version, &triple.object)?;
        match &mut self.inner {
            WriterQuadSerializerKind::JsonLd(serializer) => serializer.serialize_triple(triple),
            WriterQuadSerializerKind::NQuads(serializer) => serializer.serialize_triple(triple),
            WriterQuadSerializerKind::NTriples(serializer) => serializer.serialize_triple(triple),
            WriterQuadSerializerKind::RdfXml(serializer) => serializer.serialize_triple(triple),
            WriterQuadSerializerKind::TriG(serializer) => serializer.serialize_triple(triple),
            WriterQuadSerializerKind::Turtle(serializer) => serializer.serialize_triple(triple),
        }
    }

    /// Writes the last bytes of the file
    ///
    /// Note that this function does not flush the writer. You need to do that if you are using a [`BufWriter`](io::BufWriter).
    pub fn finish(self) -> io::Result<W> {
        Ok(match self.inner {
            WriterQuadSerializerKind::JsonLd(serializer) => serializer.finish()?,
            WriterQuadSerializerKind::NQuads(serializer) => serializer.finish()?,
            WriterQuadSerializerKind::NTriples(serializer) => serializer.finish()?,
            WriterQuadSerializerKind::RdfXml(serializer) => serializer.finish()?,
            WriterQuadSerializerKind::TriG(serializer) => serializer.finish()?,
            WriterQuadSerializerKind::Turtle(serializer) => serializer.finish()?,
        })
    }
}

/// Serializes quads or triples to a [`AsyncWrite`] implementation.
///
/// Can be built using [`RdfSerializer::for_tokio_async_writer`].
///
/// <div class="warning">
///
/// Do not forget to run the [`finish`](WriterQuadSerializer::finish()) method to properly write the last bytes of the file.</div>
///
/// <div class="warning">
///
/// This writer does unbuffered writes. You might want to use [`BufWriter`](io::BufWriter) to avoid that.</div>
///
/// ```
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
/// use oxrdfio::{RdfFormat, RdfSerializer};
/// use oxrdf::{Quad, NamedNode};
///
/// let mut serializer = RdfSerializer::from_format(RdfFormat::NQuads).for_tokio_async_writer(Vec::new());
/// serializer.serialize_quad(&Quad {
///     subject: NamedNode::new("http://example.com/s")?.into(),
///     predicate: NamedNode::new("http://example.com/p")?,
///     object: NamedNode::new("http://example.com/o")?.into(),
///     graph_name: NamedNode::new("http://example.com/g")?.into()
/// }).await?;
/// assert_eq!(serializer.finish().await?, b"<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .\n");
/// # Ok(())
/// # }
/// ```
#[must_use]
#[cfg(feature = "async-tokio")]
pub struct TokioAsyncWriterQuadSerializer<W: AsyncWrite + Unpin> {
    inner: TokioAsyncWriterQuadSerializerKind<W>,
    rdf_version: Option<RdfVersion>,
}

#[cfg(feature = "async-tokio")]
enum TokioAsyncWriterQuadSerializerKind<W: AsyncWrite + Unpin> {
    JsonLd(TokioAsyncWriterJsonLdSerializer<W>),
    NQuads(TokioAsyncWriterNQuadsSerializer<W>),
    NTriples(TokioAsyncWriterNTriplesSerializer<W>),
    RdfXml(TokioAsyncWriterRdfXmlSerializer<W>),
    TriG(TokioAsyncWriterTriGSerializer<W>),
    Turtle(TokioAsyncWriterTurtleSerializer<W>),
}

#[cfg(feature = "async-tokio")]
impl<W: AsyncWrite + Unpin> TokioAsyncWriterQuadSerializer<W> {
    /// Serializes a [`Quad`]
    pub async fn serialize_quad(&mut self, quad: &Quad) -> io::Result<()> {
        ensure_term_compatible(self.rdf_version, &quad.object)?;
        match &mut self.inner {
            TokioAsyncWriterQuadSerializerKind::JsonLd(serializer) => {
                serializer.serialize_quad(quad).await
            }
            TokioAsyncWriterQuadSerializerKind::NQuads(serializer) => {
                serializer.serialize_quad(quad).await
            }
            TokioAsyncWriterQuadSerializerKind::NTriples(serializer) => {
                serializer.serialize_triple(to_triple(quad)?).await
            }
            TokioAsyncWriterQuadSerializerKind::RdfXml(serializer) => {
                serializer.serialize_triple(to_triple(quad)?).await
            }
            TokioAsyncWriterQuadSerializerKind::TriG(serializer) => {
                serializer.serialize_quad(quad).await
            }
            TokioAsyncWriterQuadSerializerKind::Turtle(serializer) => {
                serializer.serialize_triple(to_triple(quad)?).await
            }
        }
    }

    /// Serializes an explicitly present empty named graph.
    ///
    /// TriG and JSON-LD preserve this topology.
    pub async fn serialize_empty_graph(&mut self, graph_name: &NamedOrBlankNode) -> io::Result<()> {
        match &mut self.inner {
            TokioAsyncWriterQuadSerializerKind::JsonLd(serializer) => {
                serializer.serialize_empty_graph(graph_name).await
            }
            TokioAsyncWriterQuadSerializerKind::TriG(serializer) => {
                serializer.serialize_empty_graph(graph_name).await
            }
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the selected RDF format cannot represent an empty named graph",
            )),
        }
    }

    /// Serializes a complete RDF dataset.
    ///
    /// TriG and JSON-LD preserve empty named graphs. Other formats fail if
    /// doing so is not possible instead of silently dropping dataset topology.
    pub async fn serialize_dataset(&mut self, dataset: &Dataset) -> io::Result<()> {
        match &mut self.inner {
            TokioAsyncWriterQuadSerializerKind::JsonLd(serializer) => {
                return serializer.serialize_dataset(dataset).await;
            }
            TokioAsyncWriterQuadSerializerKind::TriG(serializer) => {
                return serializer.serialize_dataset(dataset).await;
            }
            _ => {}
        }
        ensure_no_empty_named_graphs(dataset)?;
        for quad in dataset {
            self.serialize_quad(&quad).await?;
        }
        Ok(())
    }

    /// Serializes a [`Triple`]
    pub async fn serialize_triple(&mut self, triple: &Triple) -> io::Result<()> {
        ensure_term_compatible(self.rdf_version, &triple.object)?;
        match &mut self.inner {
            TokioAsyncWriterQuadSerializerKind::JsonLd(serializer) => {
                serializer.serialize_triple(triple).await
            }
            TokioAsyncWriterQuadSerializerKind::NQuads(serializer) => {
                serializer.serialize_triple(triple).await
            }
            TokioAsyncWriterQuadSerializerKind::NTriples(serializer) => {
                serializer.serialize_triple(triple).await
            }
            TokioAsyncWriterQuadSerializerKind::RdfXml(serializer) => {
                serializer.serialize_triple(triple).await
            }
            TokioAsyncWriterQuadSerializerKind::TriG(serializer) => {
                serializer.serialize_triple(triple).await
            }
            TokioAsyncWriterQuadSerializerKind::Turtle(serializer) => {
                serializer.serialize_triple(triple).await
            }
        }
    }

    /// Writes the last bytes of the file
    ///
    /// Note that this function does not flush the writer. You need to do that if you are using a [`BufWriter`](io::BufWriter).
    pub async fn finish(self) -> io::Result<W> {
        Ok(match self.inner {
            TokioAsyncWriterQuadSerializerKind::JsonLd(serializer) => serializer.finish().await?,
            TokioAsyncWriterQuadSerializerKind::NQuads(serializer) => serializer.finish().await?,
            TokioAsyncWriterQuadSerializerKind::NTriples(serializer) => serializer.finish().await?,
            TokioAsyncWriterQuadSerializerKind::RdfXml(serializer) => serializer.finish().await?,
            TokioAsyncWriterQuadSerializerKind::TriG(serializer) => serializer.finish().await?,
            TokioAsyncWriterQuadSerializerKind::Turtle(serializer) => serializer.finish().await?,
        })
    }
}

#[cfg(feature = "rdf-12")]
fn ensure_term_compatible(rdf_version: Option<RdfVersion>, term: &Term) -> io::Result<()> {
    let Some(rdf_version) = rdf_version else {
        return Ok(());
    };
    match term {
        Term::Literal(literal)
            if literal.direction().is_some()
                && !rdf_version.supports_directional_language_strings() =>
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "directional language-tagged strings require RDF 1.2",
            ));
        }
        Term::Triple(triple) if !rdf_version.supports_triple_terms() => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "triple terms require the full RDF 1.2 profile",
            ));
        }
        Term::Triple(triple) => ensure_term_compatible(Some(rdf_version), &triple.object)?,
        Term::NamedNode(_) | Term::BlankNode(_) | Term::Literal(_) => {}
    }
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[expect(
    clippy::unnecessary_wraps,
    reason = "keeps feature-independent serializer control flow"
)]
fn ensure_term_compatible(_rdf_version: Option<RdfVersion>, _term: &Term) -> io::Result<()> {
    Ok(())
}

fn ensure_no_empty_named_graphs(dataset: &Dataset) -> io::Result<()> {
    if dataset
        .named_graphs()
        .any(|graph_name| dataset.graph(&graph_name).is_empty())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "this RDF format cannot preserve empty named graphs; use TriG or JSON-LD for dataset-topology serialization",
        ));
    }
    Ok(())
}

fn to_triple(quad: &Quad) -> io::Result<&Triple> {
    if quad.graph_name.is_default_graph() {
        Ok(quad.as_triple())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Only quads in the default graph can be serialized to a RDF graph format",
        ))
    }
}
