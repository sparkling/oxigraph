use crate::context::has_keyword_form;
#[cfg(feature = "async-tokio")]
use json_event_parser::TokioAsyncWriterJsonSerializer;
use json_event_parser::{JsonEvent, WriterJsonSerializer};
use oxiri::{Iri, IriParseError};
#[cfg(feature = "rdf-12")]
use oxrdf::BaseDirection;
use oxrdf::vocab::xsd;
use oxrdf::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term, Triple};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::io;
use std::io::Write;
#[cfg(feature = "async-tokio")]
use tokio::io::AsyncWrite;

/// A [JSON-LD](https://www.w3.org/TR/json-ld/) serializer.
///
/// Returns [Streaming JSON-LD](https://www.w3.org/TR/json-ld11-streaming/).
///
/// It does not implement exactly the [RDF as JSON-LD Algorithm](https://www.w3.org/TR/json-ld-api/#serialize-rdf-as-json-ld-algorithm)
/// to be a streaming serializer but aims at being close to it.
/// Features like `@json` and `@list` generation are not implemented.
///
/// ```
/// use oxrdf::{GraphName, Literal, NamedNode, Quad};
/// use oxrdf::vocab::rdf;
/// use oxjsonld::JsonLdSerializer;
///
/// let mut serializer = JsonLdSerializer::new().with_prefix("schema", "http://schema.org/")?.for_writer(Vec::new());
/// serializer.serialize_quad(&Quad::new(
///     NamedNode::new("http://example.com#me")?,
///     rdf::TYPE,
///     NamedNode::new("http://schema.org/Person")?,
///     GraphName::DefaultGraph
/// ))?;
/// serializer.serialize_quad(&Quad::new(
///     NamedNode::new("http://example.com#me")?,
///     NamedNode::new("http://schema.org/name")?,
///     Literal::new_language_tagged_literal_unchecked("Foo Bar", "en"),
///     GraphName::DefaultGraph
/// ))?;
/// assert_eq!(
///     b"{\"@context\":{\"schema\":\"http://schema.org/\"},\"@graph\":[{\"@id\":\"http://example.com#me\",\"http://www.w3.org/1999/02/22-rdf-syntax-ns#type\":[{\"@id\":\"http://schema.org/Person\"}],\"http://schema.org/name\":[{\"@language\":\"en\",\"@value\":\"Foo Bar\"}]}]}",
///     serializer.finish()?.as_slice()
/// );
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[derive(Default, Clone)]
#[must_use]
pub struct JsonLdSerializer {
    prefixes: BTreeMap<String, String>,
    base_iri: Option<Iri<String>>,
}

impl JsonLdSerializer {
    /// Builds a new [`JsonLdSerializer`].
    #[inline]
    pub fn new() -> Self {
        Self {
            prefixes: BTreeMap::new(),
            base_iri: None,
        }
    }

    #[inline]
    pub fn with_prefix(
        mut self,
        prefix_name: &str,
        prefix_iri: &str,
    ) -> Result<Self, IriParseError> {
        self.prefixes.insert(
            prefix_name.into(),
            Iri::parse(prefix_iri.into())?.into_inner(),
        );
        Ok(self)
    }

    /// Allows to set the base IRI for serialization.
    ///
    /// Corresponds to the [`base` option from the algorithm specification](https://www.w3.org/TR/json-ld-api/#dom-jsonldoptions-base).
    /// ```
    /// use oxrdf::{GraphName, NamedNode, Quad};
    /// use oxjsonld::JsonLdSerializer;
    ///
    /// let mut serializer = JsonLdSerializer::new()
    ///     .with_base_iri("http://example.com")?
    ///     .with_prefix("ex", "http://example.com/ns#")?
    ///     .for_writer(Vec::new());
    /// serializer.serialize_quad(&Quad::new(
    ///     NamedNode::new("http://example.com#me")?,
    ///     NamedNode::new("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")?,
    ///     NamedNode::new("http://example.com/ns#Person")?,
    ///     GraphName::DefaultGraph
    /// ))?;
    /// serializer.serialize_quad(&Quad::new(
    ///     NamedNode::new("http://example.com#me")?,
    ///     NamedNode::new("http://example.com/ns#parent")?,
    ///     NamedNode::new("http://example.com#other")?,
    ///     GraphName::DefaultGraph
    /// ))?;
    /// assert_eq!(
    ///     b"{\"@context\":{\"@base\":\"http://example.com\",\"ex\":\"http://example.com/ns#\"},\"@graph\":[{\"@id\":\"#me\",\"http://www.w3.org/1999/02/22-rdf-syntax-ns#type\":[{\"@id\":\"/ns#Person\"}],\"http://example.com/ns#parent\":[{\"@id\":\"#other\"}]}]}",
    ///     serializer.finish()?.as_slice()
    /// );
    /// # Result::<_,Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_base_iri(mut self, base_iri: &str) -> Result<Self, IriParseError> {
        self.base_iri = Some(Iri::parse(base_iri.into())?);
        Ok(self)
    }

    /// Serializes a JSON-LD file to a [`Write`] implementation.
    ///
    /// This writer does unbuffered writes.
    ///
    /// ```
    /// use oxrdf::{GraphName, Literal, NamedNode, Quad};
    /// use oxrdf::vocab::rdf;
    /// use oxjsonld::JsonLdSerializer;
    ///
    /// let mut serializer = JsonLdSerializer::new().with_prefix("schema", "http://schema.org/")?.for_writer(Vec::new());
    /// serializer.serialize_quad(&Quad::new(
    ///     NamedNode::new("http://example.com#me")?,
    ///     rdf::TYPE,
    ///     NamedNode::new("http://schema.org/Person")?,
    ///     GraphName::DefaultGraph
    /// ))?;
    /// serializer.serialize_quad(&Quad::new(
    ///     NamedNode::new("http://example.com#me")?,
    ///     NamedNode::new("http://schema.org/name")?,
    ///     Literal::new_language_tagged_literal_unchecked("Foo Bar", "en"),
    ///     GraphName::DefaultGraph
    /// ))?;
    /// assert_eq!(
    ///     b"{\"@context\":{\"schema\":\"http://schema.org/\"},\"@graph\":[{\"@id\":\"http://example.com#me\",\"http://www.w3.org/1999/02/22-rdf-syntax-ns#type\":[{\"@id\":\"http://schema.org/Person\"}],\"http://schema.org/name\":[{\"@language\":\"en\",\"@value\":\"Foo Bar\"}]}]}",
    ///     serializer.finish()?.as_slice()
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn for_writer<W: Write>(self, writer: W) -> WriterJsonLdSerializer<W> {
        WriterJsonLdSerializer {
            writer: WriterJsonSerializer::new(writer),
            inner: self.inner_writer(),
        }
    }

    /// Serializes a JSON-LD file to a [`AsyncWrite`] implementation.
    ///
    /// This writer does unbuffered writes.
    ///
    /// ```
    /// # #[tokio::main(flavor = "current_thread")]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// use oxrdf::{NamedNode, Quad, Literal, GraphName};
    /// use oxrdf::vocab::rdf;
    /// use oxjsonld::JsonLdSerializer;
    ///
    /// let mut serializer = JsonLdSerializer::new().with_prefix("schema", "http://schema.org/")?.for_tokio_async_writer(Vec::new());
    /// serializer.serialize_quad(&Quad::new(
    ///     NamedNode::new("http://example.com#me")?,
    ///     rdf::TYPE,
    ///     NamedNode::new("http://schema.org/Person")?,
    ///     GraphName::DefaultGraph
    /// )).await?;
    /// serializer.serialize_quad(&Quad::new(
    ///     NamedNode::new("http://example.com#me")?,
    ///     NamedNode::new("http://schema.org/name")?,
    ///     Literal::new_language_tagged_literal_unchecked("Foo Bar", "en"),
    ///     GraphName::DefaultGraph
    /// )).await?;
    /// assert_eq!(
    ///     b"{\"@context\":{\"schema\":\"http://schema.org/\"},\"@graph\":[{\"@id\":\"http://example.com#me\",\"http://www.w3.org/1999/02/22-rdf-syntax-ns#type\":[{\"@id\":\"http://schema.org/Person\"}],\"http://schema.org/name\":[{\"@language\":\"en\",\"@value\":\"Foo Bar\"}]}]}",
    ///     serializer.finish().await?.as_slice()
    /// );
    /// # Ok(())
    /// # }
    /// ```
    #[cfg(feature = "async-tokio")]
    pub fn for_tokio_async_writer<W: AsyncWrite + Unpin>(
        self,
        writer: W,
    ) -> TokioAsyncWriterJsonLdSerializer<W> {
        TokioAsyncWriterJsonLdSerializer {
            writer: TokioAsyncWriterJsonSerializer::new(writer),
            inner: self.inner_writer(),
        }
    }

    fn inner_writer(self) -> InnerJsonLdWriter {
        InnerJsonLdWriter {
            started: false,
            current_graph_name: None,
            current_subject: None,
            current_predicate: None,
            emitted_predicates: BTreeSet::new(),
            emitted_named_graphs: HashSet::new(),
            explicitly_empty_graphs: HashSet::new(),
            prefixes: self.prefixes,
            base_iri: self.base_iri,
        }
    }
}

/// Serializes a JSON-LD file to a [`Write`] implementation.
///
/// Can be built using [`JsonLdSerializer::for_writer`].
///
/// ```
/// use oxrdf::{GraphName, Literal, NamedNode, Quad};
/// use oxrdf::vocab::rdf;
/// use oxjsonld::JsonLdSerializer;
///
/// let mut serializer = JsonLdSerializer::new().with_prefix("schema", "http://schema.org/")?.for_writer(Vec::new());
/// serializer.serialize_quad(&Quad::new(
///     NamedNode::new("http://example.com#me")?,
///     rdf::TYPE,
///     NamedNode::new("http://schema.org/Person")?,
///     GraphName::DefaultGraph
/// ))?;
/// serializer.serialize_quad(&Quad::new(
///     NamedNode::new("http://example.com#me")?,
///     NamedNode::new("http://schema.org/name")?,
///     Literal::new_language_tagged_literal_unchecked("Foo Bar", "en"),
///     GraphName::DefaultGraph
/// ))?;
/// assert_eq!(
///     b"{\"@context\":{\"schema\":\"http://schema.org/\"},\"@graph\":[{\"@id\":\"http://example.com#me\",\"http://www.w3.org/1999/02/22-rdf-syntax-ns#type\":[{\"@id\":\"http://schema.org/Person\"}],\"http://schema.org/name\":[{\"@language\":\"en\",\"@value\":\"Foo Bar\"}]}]}",
///     serializer.finish()?.as_slice()
/// );
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
pub struct WriterJsonLdSerializer<W: Write> {
    writer: WriterJsonSerializer<W>,
    inner: InnerJsonLdWriter,
}

impl<W: Write> WriterJsonLdSerializer<W> {
    /// Serializes an extra quad.
    pub fn serialize_quad(&mut self, quad: &Quad) -> io::Result<()> {
        let mut buffer = Vec::new();
        self.inner.serialize_quad(
            &quad.subject,
            &quad.predicate,
            &quad.object,
            &quad.graph_name,
            &mut buffer,
        )?;
        self.flush_buffer(&mut buffer)
    }

    /// Serializes an explicitly present empty named graph.
    ///
    /// A graph may be emitted only once through this method, and no quad may
    /// be appended to it afterwards.
    pub fn serialize_empty_graph(&mut self, graph_name: &NamedOrBlankNode) -> io::Result<()> {
        let mut buffer = Vec::new();
        self.inner.serialize_empty_graph(graph_name, &mut buffer)?;
        self.flush_buffer(&mut buffer)
    }

    /// Serializes a complete RDF dataset, including empty named graphs.
    pub fn serialize_dataset(&mut self, dataset: &Dataset) -> io::Result<()> {
        self.inner.validate_dataset(dataset)?;
        for quad in dataset {
            self.serialize_quad(&quad)?;
        }
        for graph_name in dataset
            .named_graphs()
            .filter(|graph_name| dataset.graph(graph_name).is_empty())
        {
            self.serialize_empty_graph(&graph_name)?;
        }
        Ok(())
    }

    #[doc(hidden)]
    pub fn serialize_triple(&mut self, triple: &Triple) -> io::Result<()> {
        let mut buffer = Vec::new();
        self.inner.serialize_quad(
            &triple.subject,
            &triple.predicate,
            &triple.object,
            &GraphName::DefaultGraph,
            &mut buffer,
        )?;
        self.flush_buffer(&mut buffer)
    }

    /// Ends the write process and returns the underlying [`Write`].
    pub fn finish(mut self) -> io::Result<W> {
        let mut buffer = Vec::new();
        self.inner.finish(&mut buffer);
        self.flush_buffer(&mut buffer)?;
        self.writer.finish()
    }

    fn flush_buffer(&mut self, buffer: &mut Vec<JsonEvent<'_>>) -> io::Result<()> {
        for event in buffer.drain(0..) {
            self.writer.serialize_event(event)?;
        }
        Ok(())
    }
}

/// Serializes a JSON-LD file to a [`AsyncWrite`] implementation.
///
/// Can be built using [`JsonLdSerializer::for_tokio_async_writer`].
///
/// ```
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
/// use oxrdf::{NamedNode, Quad, Literal, GraphName};
/// use oxrdf::vocab::rdf;
/// use oxjsonld::JsonLdSerializer;
///
/// let mut serializer = JsonLdSerializer::new().with_prefix("schema", "http://schema.org/")?.for_tokio_async_writer(Vec::new());
/// serializer.serialize_quad(&Quad::new(
///     NamedNode::new("http://example.com#me")?,
///     rdf::TYPE,
///     NamedNode::new("http://schema.org/Person")?,
///     GraphName::DefaultGraph
/// )).await?;
/// serializer.serialize_quad(&Quad::new(
///     NamedNode::new("http://example.com#me")?,
///     NamedNode::new("http://schema.org/name")?,
///     Literal::new_language_tagged_literal_unchecked("Foo Bar", "en"),
///     GraphName::DefaultGraph
/// )).await?;
/// assert_eq!(
///     b"{\"@context\":{\"schema\":\"http://schema.org/\"},\"@graph\":[{\"@id\":\"http://example.com#me\",\"http://www.w3.org/1999/02/22-rdf-syntax-ns#type\":[{\"@id\":\"http://schema.org/Person\"}],\"http://schema.org/name\":[{\"@language\":\"en\",\"@value\":\"Foo Bar\"}]}]}",
///     serializer.finish().await?.as_slice()
/// );
/// # Ok(())
/// # }
/// ```
#[cfg(feature = "async-tokio")]
#[must_use]
pub struct TokioAsyncWriterJsonLdSerializer<W: AsyncWrite + Unpin> {
    writer: TokioAsyncWriterJsonSerializer<W>,
    inner: InnerJsonLdWriter,
}

#[cfg(feature = "async-tokio")]
impl<W: AsyncWrite + Unpin> TokioAsyncWriterJsonLdSerializer<W> {
    /// Serializes an extra quad.
    pub async fn serialize_quad(&mut self, quad: &Quad) -> io::Result<()> {
        let mut buffer = Vec::new();
        self.inner.serialize_quad(
            &quad.subject,
            &quad.predicate,
            &quad.object,
            &quad.graph_name,
            &mut buffer,
        )?;
        self.flush_buffer(&mut buffer).await
    }

    /// Serializes an explicitly present empty named graph.
    ///
    /// A graph may be emitted only once through this method, and no quad may
    /// be appended to it afterwards.
    pub async fn serialize_empty_graph(&mut self, graph_name: &NamedOrBlankNode) -> io::Result<()> {
        let mut buffer = Vec::new();
        self.inner.serialize_empty_graph(graph_name, &mut buffer)?;
        self.flush_buffer(&mut buffer).await
    }

    /// Serializes a complete RDF dataset, including empty named graphs.
    pub async fn serialize_dataset(&mut self, dataset: &Dataset) -> io::Result<()> {
        self.inner.validate_dataset(dataset)?;
        for quad in dataset {
            self.serialize_quad(&quad).await?;
        }
        for graph_name in dataset
            .named_graphs()
            .filter(|graph_name| dataset.graph(graph_name).is_empty())
        {
            self.serialize_empty_graph(&graph_name).await?;
        }
        Ok(())
    }

    #[doc(hidden)]
    pub async fn serialize_triple(&mut self, triple: &Triple) -> io::Result<()> {
        let mut buffer = Vec::new();
        self.inner.serialize_quad(
            &triple.subject,
            &triple.predicate,
            &triple.object,
            &GraphName::DefaultGraph,
            &mut buffer,
        )?;
        self.flush_buffer(&mut buffer).await
    }

    /// Ends the write process and returns the underlying [`Write`].
    pub async fn finish(mut self) -> io::Result<W> {
        let mut buffer = Vec::new();
        self.inner.finish(&mut buffer);
        self.flush_buffer(&mut buffer).await?;
        self.writer.finish()
    }

    async fn flush_buffer(&mut self, buffer: &mut Vec<JsonEvent<'_>>) -> io::Result<()> {
        for event in buffer.drain(0..) {
            self.writer.serialize_event(event).await?;
        }
        Ok(())
    }
}

pub struct InnerJsonLdWriter {
    started: bool,
    current_graph_name: Option<GraphName>,
    current_subject: Option<NamedOrBlankNode>,
    current_predicate: Option<NamedNode>,
    emitted_predicates: BTreeSet<NamedNode>,
    emitted_named_graphs: HashSet<NamedOrBlankNode>,
    explicitly_empty_graphs: HashSet<NamedOrBlankNode>,
    prefixes: BTreeMap<String, String>,
    base_iri: Option<Iri<String>>,
}

impl InnerJsonLdWriter {
    fn serialize_quad<'a>(
        &mut self,
        subject: &'a NamedOrBlankNode,
        predicate: &'a NamedNode,
        object: &'a Term,
        graph_name: &'a GraphName,
        output: &mut Vec<JsonEvent<'a>>,
    ) -> io::Result<()> {
        Self::ensure_term_supported(object)?;
        let named_graph_name = named_graph_name(graph_name);
        if named_graph_name
            .as_ref()
            .is_some_and(|graph_name| self.explicitly_empty_graphs.contains(graph_name))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a quad cannot be serialized after its named graph was declared empty",
            ));
        }
        if !self.started {
            self.serialize_start(output);
            self.started = true;
        }

        if self
            .current_graph_name
            .as_ref()
            .is_some_and(|current_graph_name| current_graph_name != graph_name)
        {
            output.push(JsonEvent::EndArray);
            output.push(JsonEvent::EndObject);
            if self
                .current_graph_name
                .as_ref()
                .is_some_and(|g| !g.is_default_graph())
            {
                output.push(JsonEvent::EndArray);
                output.push(JsonEvent::EndObject);
            }
            self.current_graph_name = None;
            self.current_subject = None;
            self.current_predicate = None;
            self.emitted_predicates.clear();
        } else if self
            .current_subject
            .as_ref()
            .is_some_and(|current_subject| current_subject != subject)
            || self
                .current_predicate
                .as_ref()
                .is_some_and(|current_predicate| current_predicate != predicate)
                && self.emitted_predicates.contains(predicate)
        {
            output.push(JsonEvent::EndArray);
            output.push(JsonEvent::EndObject);
            self.current_subject = None;
            self.emitted_predicates.clear();
            self.current_predicate = None;
        } else if self
            .current_predicate
            .as_ref()
            .is_some_and(|current_predicate| current_predicate != predicate)
        {
            output.push(JsonEvent::EndArray);
            if let Some(current_predicate) = self.current_predicate.take() {
                self.emitted_predicates.insert(current_predicate);
            }
        }

        if self.current_graph_name.is_none() {
            if !graph_name.is_default_graph() {
                // We open a new graph name
                output.push(JsonEvent::StartObject);
                output.push(JsonEvent::ObjectKey("@id".into()));
                output.push(JsonEvent::String(match &graph_name {
                    GraphName::NamedNode(iri) => self.named_node_id_value(iri),
                    GraphName::BlankNode(bnode) => bnode.to_string().into(),
                    GraphName::DefaultGraph => unreachable!(),
                }));
                output.push(JsonEvent::ObjectKey("@graph".into()));
                output.push(JsonEvent::StartArray);
            }
            self.current_graph_name = Some(graph_name.clone());
        }

        // We open a new subject block if useful (ie. new subject or already used predicate)
        if self.current_subject.is_none() {
            output.push(JsonEvent::StartObject);
            output.push(JsonEvent::ObjectKey("@id".into()));
            output.push(JsonEvent::String(match &subject {
                NamedOrBlankNode::NamedNode(iri) => self.named_node_id_value(iri),
                NamedOrBlankNode::BlankNode(bnode) => bnode.to_string().into(),
            }));
            self.current_subject = Some(subject.clone());
        }

        // We open a predicate key
        if self.current_predicate.is_none() {
            output.push(JsonEvent::ObjectKey(
                // TODO: use @type
                predicate.as_str().into(), // TODO: prefixes including @vocab
            ));
            output.push(JsonEvent::StartArray);
            self.current_predicate = Some(predicate.clone());
        }

        self.serialize_term(object, output)?;
        if let Some(graph_name) = named_graph_name {
            self.emitted_named_graphs.insert(graph_name);
        }
        Ok(())
    }

    fn serialize_empty_graph<'a>(
        &mut self,
        graph_name: &'a NamedOrBlankNode,
        output: &mut Vec<JsonEvent<'a>>,
    ) -> io::Result<()> {
        if self.emitted_named_graphs.contains(graph_name) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the named graph has already been serialized",
            ));
        }
        if !self.started {
            self.serialize_start(output);
            self.started = true;
        }
        self.finish_current_graph(output);
        output.push(JsonEvent::StartObject);
        output.push(JsonEvent::ObjectKey("@id".into()));
        output.push(JsonEvent::String(match graph_name {
            NamedOrBlankNode::NamedNode(graph_name) => self.named_node_id_value(graph_name),
            NamedOrBlankNode::BlankNode(graph_name) => graph_name.to_string().into(),
        }));
        output.push(JsonEvent::ObjectKey("@graph".into()));
        output.push(JsonEvent::StartArray);
        output.push(JsonEvent::EndArray);
        output.push(JsonEvent::EndObject);
        self.emitted_named_graphs.insert(graph_name.clone());
        self.explicitly_empty_graphs.insert(graph_name.clone());
        Ok(())
    }

    fn validate_dataset(&self, dataset: &Dataset) -> io::Result<()> {
        for quad in dataset {
            Self::ensure_term_supported(&quad.object)?;
            if named_graph_name(&quad.graph_name)
                .as_ref()
                .is_some_and(|graph_name| self.explicitly_empty_graphs.contains(graph_name))
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "a quad cannot be serialized after its named graph was declared empty",
                ));
            }
        }
        for graph_name in dataset
            .named_graphs()
            .filter(|graph_name| dataset.graph(graph_name).is_empty())
        {
            if self.emitted_named_graphs.contains(&graph_name) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "the named graph has already been serialized",
                ));
            }
        }
        Ok(())
    }

    #[cfg(feature = "rdf-12")]
    fn ensure_term_supported(term: &Term) -> io::Result<()> {
        if matches!(term, Term::Triple(_)) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "JSON-LD does not support RDF 1.2 yet",
            ));
        }
        Ok(())
    }

    #[cfg(not(feature = "rdf-12"))]
    #[expect(
        clippy::unnecessary_wraps,
        reason = "keeps serializer control flow independent of the rdf-12 feature"
    )]
    fn ensure_term_supported(_term: &Term) -> io::Result<()> {
        Ok(())
    }

    fn finish_current_graph(&mut self, output: &mut Vec<JsonEvent<'_>>) {
        if self.current_predicate.take().is_some() {
            output.push(JsonEvent::EndArray);
        }
        if self.current_subject.take().is_some() {
            output.push(JsonEvent::EndObject);
        }
        if self
            .current_graph_name
            .take()
            .is_some_and(|graph_name| !graph_name.is_default_graph())
        {
            output.push(JsonEvent::EndArray);
            output.push(JsonEvent::EndObject);
        }
        self.emitted_predicates.clear();
    }

    fn serialize_start(&self, output: &mut Vec<JsonEvent<'_>>) {
        if self.base_iri.is_some() || !self.prefixes.is_empty() {
            output.push(JsonEvent::StartObject);
            output.push(JsonEvent::ObjectKey("@context".into()));
            output.push(JsonEvent::StartObject);
            if let Some(base_iri) = &self.base_iri {
                output.push(JsonEvent::ObjectKey("@base".into()));
                output.push(JsonEvent::String(base_iri.to_string().into()));
            }
            for (prefix_name, prefix_iri) in &self.prefixes {
                output.push(JsonEvent::ObjectKey(if prefix_name.is_empty() {
                    "@vocab".into()
                } else {
                    prefix_name.clone().into()
                }));
                output.push(JsonEvent::String(prefix_iri.clone().into()));
            }
            output.push(JsonEvent::EndObject);
            output.push(JsonEvent::ObjectKey("@graph".into()));
        }
        output.push(JsonEvent::StartArray);
    }

    fn serialize_term<'a>(
        &self,
        term: &'a Term,
        output: &mut Vec<JsonEvent<'a>>,
    ) -> io::Result<()> {
        output.push(JsonEvent::StartObject);
        #[cfg_attr(feature = "rdf-12", expect(clippy::match_wildcard_for_single_variants))]
        #[cfg_attr(not(feature = "rdf-12"), expect(unreachable_patterns))]
        match term {
            Term::NamedNode(iri) => {
                output.push(JsonEvent::ObjectKey("@id".into()));
                output.push(JsonEvent::String(self.named_node_id_value(iri)));
            }
            Term::BlankNode(bnode) => {
                output.push(JsonEvent::ObjectKey("@id".into()));
                output.push(JsonEvent::String(bnode.to_string().into()));
            }
            Term::Literal(literal) => {
                if let Some(language) = literal.language() {
                    output.push(JsonEvent::ObjectKey("@language".into()));
                    output.push(JsonEvent::String(language.into()));
                    #[cfg(feature = "rdf-12")]
                    if let Some(direction) = literal.direction() {
                        output.push(JsonEvent::ObjectKey("@direction".into()));
                        output.push(JsonEvent::String(
                            match direction {
                                BaseDirection::Ltr => "ltr",
                                BaseDirection::Rtl => "rtl",
                            }
                            .into(),
                        ));
                    }
                } else if *literal.datatype() != xsd::STRING {
                    output.push(JsonEvent::ObjectKey("@type".into()));
                    output.push(JsonEvent::String(
                        Self::named_node_type_value(literal.datatype()).into(),
                    ));
                }
                output.push(JsonEvent::ObjectKey("@value".into()));
                output.push(JsonEvent::String(literal.value().into()));
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "JSON-LD does not support RDF 1.2 yet",
                ));
            }
        }
        output.push(JsonEvent::EndObject);
        Ok(())
    }

    fn named_node_id_value<'a>(&self, iri: &'a NamedNode) -> Cow<'a, str> {
        if let Some(base_iri) = &self.base_iri {
            if let Ok(relative) = base_iri.relativize(&Iri::parse_unchecked(iri.as_str())) {
                let relative = relative.into_inner();
                // We check the relative IRI is not considered as absolute or a keyword by IRI expansion
                if !relative
                    .split_once(':')
                    .is_some_and(|(prefix, suffix)| prefix == "_" || suffix.starts_with("//"))
                    && !has_keyword_form(&relative)
                {
                    return relative.into();
                }
            }
        }
        iri.as_str().into()
    }

    fn named_node_type_value(iri: &NamedNode) -> &str {
        iri.as_str() // TODO: use prefixes?
    }

    fn finish(&mut self, output: &mut Vec<JsonEvent<'static>>) {
        if !self.started {
            self.serialize_start(output);
        }
        self.finish_current_graph(output);
        output.push(JsonEvent::EndArray);
        if self.base_iri.is_some() || !self.prefixes.is_empty() {
            output.push(JsonEvent::EndObject);
        }
    }
}

fn named_graph_name(graph_name: &GraphName) -> Option<NamedOrBlankNode> {
    match graph_name {
        GraphName::NamedNode(graph_name) => Some(graph_name.clone().into()),
        GraphName::BlankNode(graph_name) => Some(graph_name.clone().into()),
        GraphName::DefaultGraph => None,
    }
}
