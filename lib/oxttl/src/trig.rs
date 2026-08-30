//! A [TriG](https://www.w3.org/TR/trig/) streaming parser implemented by [`TriGParser`]
//! and a serializer implemented by [`TriGSerializer`].

use crate::DEFAULT_MAX_BUFFER_SIZE;
use crate::lexer::N3Lexer;
use crate::serialization::{ensure_terse_graph_name_compatible, ensure_terse_parts_compatible};
use crate::terse::TriGRecognizer;
#[cfg(feature = "async-tokio")]
use crate::toolkit::TokioAsyncReaderIterator;
use crate::toolkit::{Parser, ReaderIterator, SliceIterator, TurtleParseError, TurtleSyntaxError};
use oxiri::{Iri, IriParseError};
use oxrdf::vocab::{rdf, xsd};
use oxrdf::{
    Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, RdfVersion, Term, Triple,
};
use oxstr::OxString;
use std::borrow::Cow;
use std::cmp::Reverse;
use std::collections::hash_map::Iter;
use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::io::{self, Read, Write};
#[cfg(feature = "async-tokio")]
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};

/// A [TriG](https://www.w3.org/TR/trig/) streaming parser.
///
/// Count the number of people:
/// ```
/// use oxrdf::NamedNode;
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGParser;
///
/// let file = r#"@base <http://example.com/> .
/// @prefix schema: <http://schema.org/> .
/// <foo> a schema:Person ;
///     schema:name "Foo" .
/// <bar> a schema:Person ;
///     schema:name "Bar" ."#;
///
/// let schema_person = NamedNode::new("http://schema.org/Person")?;
/// let mut count = 0;
/// for quad in TriGParser::new().for_reader(file.as_bytes()) {
///     let quad = quad?;
///     if quad.predicate == rdf::TYPE && quad.object == schema_person {
///         count += 1;
///     }
/// }
/// assert_eq!(2, count);
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
///
/// The streaming iterators emit quads only, so empty named graphs are not
/// iterator items. Use [`ReaderTriGParser::collect_dataset`] or
/// [`SliceTriGParser::collect_dataset`] when complete RDF dataset topology must
/// be preserved.
#[derive(Clone)]
#[must_use]
pub struct TriGParser {
    lenient: bool,
    base: Option<Iri<OxString>>,
    prefixes: HashMap<OxString, Iri<OxString>>,
    max_buffer_size: usize,
}

impl Default for TriGParser {
    fn default() -> Self {
        Self::new()
    }
}

impl TriGParser {
    /// Builds a new [`TriGParser`].
    #[inline]
    pub fn new() -> Self {
        Self {
            max_buffer_size: DEFAULT_MAX_BUFFER_SIZE,
            lenient: false,
            base: None,
            prefixes: HashMap::new(),
        }
    }

    /// Define an upper bound for the internal buffer of the parser in bytes
    ///
    /// This limits the memory consumption of the parser and the maximum size of parsed IRIs and literals.
    ///
    /// The default is set conservatively, use this function to change it (e.g. to [`usize::MAX`] to not set an upper bound).
    #[inline]
    pub fn with_max_buffer_size(mut self, max_buffer_size: usize) -> Self {
        self.max_buffer_size = max_buffer_size;
        self
    }

    /// Assumes the file is valid to make parsing faster.
    ///
    /// It will skip some validations.
    ///
    /// Note that if the file is actually not valid, the parser might emit broken RDF.
    #[inline]
    pub fn lenient(mut self) -> Self {
        self.lenient = true;
        self
    }

    #[inline]
    pub fn with_base_iri(mut self, base_iri: &str) -> Result<Self, IriParseError> {
        self.base = Some(Iri::parse(OxString::new_owned(base_iri))?);
        Ok(self)
    }

    #[inline]
    pub fn with_prefix(
        mut self,
        prefix_name: &str,
        prefix_iri: &str,
    ) -> Result<Self, IriParseError> {
        self.prefixes.insert(
            OxString::new_owned(prefix_name),
            Iri::parse(OxString::new_owned(prefix_iri))?,
        );
        Ok(self)
    }

    /// Parses a TriG file from a [`Read`] implementation.
    ///
    /// Count the number of people:
    /// ```
    /// use oxrdf::NamedNode;
    /// use oxrdf::vocab::rdf;
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" .
    /// <bar> a schema:Person ;
    ///     schema:name "Bar" ."#;
    ///
    /// let schema_person = NamedNode::new("http://schema.org/Person")?;
    /// let mut count = 0;
    /// for quad in TriGParser::new().for_reader(file.as_bytes()) {
    ///     let quad = quad?;
    ///     if quad.predicate == rdf::TYPE && quad.object == schema_person {
    ///         count += 1;
    ///     }
    /// }
    /// assert_eq!(2, count);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn for_reader<R: Read>(self, reader: R) -> ReaderTriGParser<R> {
        ReaderTriGParser {
            inner: self.low_level().parser.for_reader(reader),
        }
    }

    /// Parses a TriG file from a [`AsyncRead`] implementation.
    ///
    /// Count the number of people:
    /// ```
    /// # #[tokio::main(flavor = "current_thread")]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// use oxrdf::NamedNode;
    /// use oxrdf::vocab::rdf;
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" .
    /// <bar> a schema:Person ;
    ///     schema:name "Bar" ."#;
    ///
    /// let schema_person = NamedNode::new("http://schema.org/Person")?;
    /// let mut count = 0;
    /// let mut parser = TriGParser::new().for_tokio_async_reader(file.as_bytes());
    /// while let Some(triple) = parser.next().await {
    ///     let triple = triple?;
    ///     if triple.predicate == rdf::TYPE && triple.object == schema_person {
    ///         count += 1;
    ///     }
    /// }
    /// assert_eq!(2, count);
    /// # Ok(())
    /// # }
    /// ```
    #[cfg(feature = "async-tokio")]
    pub fn for_tokio_async_reader<R: AsyncRead + Unpin>(
        self,
        reader: R,
    ) -> TokioAsyncReaderTriGParser<R> {
        TokioAsyncReaderTriGParser {
            inner: self.low_level().parser.for_tokio_async_reader(reader),
        }
    }

    /// Parses a TriG file from a byte slice.
    ///
    /// Count the number of people:
    /// ```
    /// use oxrdf::NamedNode;
    /// use oxrdf::vocab::rdf;
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" .
    /// <bar> a schema:Person ;
    ///     schema:name "Bar" ."#;
    ///
    /// let schema_person = NamedNode::new("http://schema.org/Person")?;
    /// let mut count = 0;
    /// for quad in TriGParser::new().for_slice(file) {
    ///     let quad = quad?;
    ///     if quad.predicate == rdf::TYPE && quad.object == schema_person {
    ///         count += 1;
    ///     }
    /// }
    /// assert_eq!(2, count);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn for_slice(self, slice: &(impl AsRef<[u8]> + ?Sized)) -> SliceTriGParser<'_> {
        SliceTriGParser {
            inner: TriGRecognizer::new_parser(
                slice.as_ref(),
                true,
                true,
                self.lenient,
                self.base,
                self.prefixes,
                self.max_buffer_size,
            )
            .into_iter(),
        }
    }

    /// Allows to parse a TriG file by using a low-level API.
    ///
    /// Count the number of people:
    /// ```
    /// use oxrdf::NamedNode;
    /// use oxrdf::vocab::rdf;
    /// use oxttl::TriGParser;
    ///
    /// let file: [&[u8]; 5] = [
    ///     b"@base <http://example.com/>",
    ///     b". @prefix schema: <http://schema.org/> .",
    ///     b"<foo> a schema:Person",
    ///     b" ; schema:name \"Foo\" . <bar>",
    ///     b" a schema:Person ; schema:name \"Bar\" .",
    /// ];
    ///
    /// let schema_person = NamedNode::new("http://schema.org/Person")?;
    /// let mut count = 0;
    /// let mut parser = TriGParser::new().low_level();
    /// let mut file_chunks = file.iter();
    /// while !parser.is_end() {
    ///     // We feed more data to the parser
    ///     if let Some(chunk) = file_chunks.next() {
    ///         parser.extend_from_slice(chunk);
    ///     } else {
    ///         parser.end(); // It's finished
    ///     }
    ///     // We read as many quads from the parser as possible
    ///     while let Some(quad) = parser.parse_next() {
    ///         let quad = quad?;
    ///         if quad.predicate == rdf::TYPE && quad.object == schema_person {
    ///             count += 1;
    ///         }
    ///     }
    /// }
    /// assert_eq!(2, count);
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn low_level(self) -> LowLevelTriGParser {
        LowLevelTriGParser {
            parser: TriGRecognizer::new_parser(
                Vec::new(),
                false,
                true,
                self.lenient,
                self.base,
                self.prefixes,
                self.max_buffer_size,
            ),
        }
    }
}

/// Parses a TriG file from a [`Read`] implementation.
///
/// Can be built using [`TriGParser::for_reader`].
///
/// Count the number of people:
/// ```
/// use oxrdf::NamedNode;
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGParser;
///
/// let file = r#"@base <http://example.com/> .
/// @prefix schema: <http://schema.org/> .
/// <foo> a schema:Person ;
///     schema:name "Foo" .
/// <bar> a schema:Person ;
///     schema:name "Bar" ."#;
///
/// let schema_person = NamedNode::new("http://schema.org/Person")?;
/// let mut count = 0;
/// for quad in TriGParser::new().for_reader(file.as_bytes()) {
///     let quad = quad?;
///     if quad.predicate == rdf::TYPE && quad.object == schema_person {
///         count += 1;
///     }
/// }
/// assert_eq!(2, count);
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
pub struct ReaderTriGParser<R: Read> {
    inner: ReaderIterator<R, TriGRecognizer>,
}

impl<R: Read> ReaderTriGParser<R> {
    /// The list of IRI prefixes considered at the current step of the parsing.
    ///
    /// This method returns (prefix name, prefix value) tuples.
    /// It is empty at the beginning of the parsing and gets updated when prefixes are encountered.
    /// It should be full at the end of the parsing (but if a prefix is overridden, only the latest version will be returned).
    ///
    /// ```
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" ."#;
    ///
    /// let mut parser = TriGParser::new().for_reader(file.as_bytes());
    /// assert_eq!(parser.prefixes().collect::<Vec<_>>(), []); // No prefix at the beginning
    ///
    /// parser.next().unwrap()?; // We read the first triple
    /// assert_eq!(
    ///     parser.prefixes().collect::<Vec<_>>(),
    ///     [("schema", "http://schema.org/")]
    /// ); // There are now prefixes
    /// //
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn prefixes(&self) -> TriGPrefixesIter<'_> {
        TriGPrefixesIter {
            inner: self.inner.parser.context.prefixes(),
        }
    }

    /// The base IRI considered at the current step of the parsing.
    ///
    /// ```
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" ."#;
    ///
    /// let mut parser = TriGParser::new().for_reader(file.as_bytes());
    /// assert!(parser.base_iri().is_none()); // No base at the beginning because none has been given to the parser.
    ///
    /// parser.next().unwrap()?; // We read the first triple
    /// assert_eq!(parser.base_iri(), Some("http://example.com/")); // There is now a base IRI.
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn base_iri(&self) -> Option<&str> {
        self.inner
            .parser
            .context
            .lexer_options
            .base_iri
            .as_ref()
            .map(Iri::as_str)
    }

    /// Returns named graph declarations encountered so far.
    ///
    /// Unlike quad iteration, this includes named graphs whose TriG blocks are
    /// empty.
    pub fn named_graphs(&self) -> impl Iterator<Item = &NamedOrBlankNode> {
        self.inner.parser.context.named_graphs()
    }

    /// Consumes the parser and returns the complete RDF dataset.
    ///
    /// This method preserves empty named graphs. Collecting the parser through
    /// its [`Iterator`] implementation cannot preserve them because iterator
    /// items are quads.
    pub fn collect_dataset(mut self) -> Result<Dataset, TurtleParseError> {
        let mut dataset = Dataset::new();
        for quad in self.by_ref() {
            dataset.insert(quad?);
        }
        for graph_name in self.named_graphs() {
            dataset.insert_named_graph(graph_name.clone());
        }
        Ok(dataset)
    }
}

impl<R: Read> Iterator for ReaderTriGParser<R> {
    type Item = Result<Quad, TurtleParseError>;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next()
    }
}

/// Parses a TriG file from a [`AsyncRead`] implementation.
///
/// Can be built using [`TriGParser::for_tokio_async_reader`].
///
/// Count the number of people:
/// ```
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
/// use oxrdf::NamedNode;
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGParser;
///
/// let file = r#"@base <http://example.com/> .
/// @prefix schema: <http://schema.org/> .
/// <foo> a schema:Person ;
///     schema:name "Foo" .
/// <bar> a schema:Person ;
///     schema:name "Bar" ."#;
///
/// let schema_person = NamedNode::new("http://schema.org/Person")?;
/// let mut count = 0;
/// let mut parser = TriGParser::new().for_tokio_async_reader(file.as_bytes());
/// while let Some(triple) = parser.next().await {
///     let triple = triple?;
///     if triple.predicate == rdf::TYPE && triple.object == schema_person {
///         count += 1;
///     }
/// }
/// assert_eq!(2, count);
/// # Ok(())
/// # }
/// ```
#[cfg(feature = "async-tokio")]
#[must_use]
pub struct TokioAsyncReaderTriGParser<R: AsyncRead + Unpin> {
    inner: TokioAsyncReaderIterator<R, TriGRecognizer>,
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> TokioAsyncReaderTriGParser<R> {
    /// Reads the next triple or returns `None` if the file is finished.
    pub async fn next(&mut self) -> Option<Result<Quad, TurtleParseError>> {
        self.inner.next().await
    }

    /// The list of IRI prefixes considered at the current step of the parsing.
    ///
    /// This method returns (prefix name, prefix value) tuples.
    /// It is empty at the beginning of the parsing and gets updated when prefixes are encountered.
    /// It should be full at the end of the parsing (but if a prefix is overridden, only the latest version will be returned).
    ///
    /// ```
    /// # #[tokio::main(flavor = "current_thread")]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" ."#;
    ///
    /// let mut parser = TriGParser::new().for_tokio_async_reader(file.as_bytes());
    /// assert_eq!(parser.prefixes().collect::<Vec<_>>(), []); // No prefix at the beginning
    ///
    /// parser.next().await.unwrap()?; // We read the first triple
    /// assert_eq!(
    ///     parser.prefixes().collect::<Vec<_>>(),
    ///     [("schema", "http://schema.org/")]
    /// ); // There are now prefixes
    /// //
    /// # Ok(())
    /// # }
    /// ```
    pub fn prefixes(&self) -> TriGPrefixesIter<'_> {
        TriGPrefixesIter {
            inner: self.inner.parser.context.prefixes(),
        }
    }

    /// The base IRI considered at the current step of the parsing.
    ///
    /// ```
    /// # #[tokio::main(flavor = "current_thread")]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" ."#;
    ///
    /// let mut parser = TriGParser::new().for_tokio_async_reader(file.as_bytes());
    /// assert!(parser.base_iri().is_none()); // No base IRI at the beginning
    ///
    /// parser.next().await.unwrap()?; // We read the first triple
    /// assert_eq!(parser.base_iri(), Some("http://example.com/")); // There is now a base IRI
    /// //
    /// # Ok(())
    /// # }
    /// ```
    pub fn base_iri(&self) -> Option<&str> {
        self.inner
            .parser
            .context
            .lexer_options
            .base_iri
            .as_ref()
            .map(Iri::as_str)
    }

    /// Returns named graph declarations encountered so far, including empty
    /// named graph blocks.
    pub fn named_graphs(&self) -> impl Iterator<Item = &NamedOrBlankNode> {
        self.inner.parser.context.named_graphs()
    }

    /// Consumes the parser and returns the complete RDF dataset, preserving
    /// empty named graphs.
    pub async fn collect_dataset(mut self) -> Result<Dataset, TurtleParseError> {
        let mut dataset = Dataset::new();
        while let Some(quad) = self.next().await {
            dataset.insert(quad?);
        }
        for graph_name in self.named_graphs() {
            dataset.insert_named_graph(graph_name.clone());
        }
        Ok(dataset)
    }
}

/// Parses a TriG file from a byte slice.
///
/// Can be built using [`TriGParser::for_slice`].
///
/// Count the number of people:
/// ```
/// use oxrdf::NamedNode;
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGParser;
///
/// let file = r#"@base <http://example.com/> .
/// @prefix schema: <http://schema.org/> .
/// <foo> a schema:Person ;
///     schema:name "Foo" .
/// <bar> a schema:Person ;
///     schema:name "Bar" ."#;
///
/// let schema_person = NamedNode::new("http://schema.org/Person")?;
/// let mut count = 0;
/// for quad in TriGParser::new().for_slice(file) {
///     let quad = quad?;
///     if quad.predicate == rdf::TYPE && quad.object == schema_person {
///         count += 1;
///     }
/// }
/// assert_eq!(2, count);
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
pub struct SliceTriGParser<'a> {
    inner: SliceIterator<'a, TriGRecognizer>,
}

impl SliceTriGParser<'_> {
    /// The list of IRI prefixes considered at the current step of the parsing.
    ///
    /// This method returns (prefix name, prefix value) tuples.
    /// It is empty at the beginning of the parsing and gets updated when prefixes are encountered.
    /// It should be full at the end of the parsing (but if a prefix is overridden, only the latest version will be returned).
    ///
    /// ```
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" ."#;
    ///
    /// let mut parser = TriGParser::new().for_slice(file);
    /// assert_eq!(parser.prefixes().collect::<Vec<_>>(), []); // No prefix at the beginning
    ///
    /// parser.next().unwrap()?; // We read the first triple
    /// assert_eq!(
    ///     parser.prefixes().collect::<Vec<_>>(),
    ///     [("schema", "http://schema.org/")]
    /// ); // There are now prefixes
    /// //
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn prefixes(&self) -> TriGPrefixesIter<'_> {
        TriGPrefixesIter {
            inner: self.inner.parser.context.prefixes(),
        }
    }

    /// The base IRI considered at the current step of the parsing.
    ///
    /// ```
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" ."#;
    ///
    /// let mut parser = TriGParser::new().for_slice(file);
    /// assert!(parser.base_iri().is_none()); // No base at the beginning because none has been given to the parser.
    ///
    /// parser.next().unwrap()?; // We read the first triple
    /// assert_eq!(parser.base_iri(), Some("http://example.com/")); // There is now a base IRI.
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn base_iri(&self) -> Option<&str> {
        self.inner
            .parser
            .context
            .lexer_options
            .base_iri
            .as_ref()
            .map(Iri::as_str)
    }

    /// Returns named graph declarations encountered so far, including empty
    /// named graph blocks.
    pub fn named_graphs(&self) -> impl Iterator<Item = &NamedOrBlankNode> {
        self.inner.parser.context.named_graphs()
    }

    /// Consumes the parser and returns the complete RDF dataset.
    ///
    /// This method preserves empty named graphs, unlike collecting the
    /// streaming quad iterator directly.
    pub fn collect_dataset(mut self) -> Result<Dataset, TurtleSyntaxError> {
        let mut dataset = Dataset::new();
        for quad in self.by_ref() {
            dataset.insert(quad?);
        }
        for graph_name in self.named_graphs() {
            dataset.insert_named_graph(graph_name.clone());
        }
        Ok(dataset)
    }
}

impl Iterator for SliceTriGParser<'_> {
    type Item = Result<Quad, TurtleSyntaxError>;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next()
    }
}

/// Parses a TriG file by using a low-level API.
///
/// Can be built using [`TriGParser::low_level`].
///
/// Count the number of people:
/// ```
/// use oxrdf::NamedNode;
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGParser;
///
/// let file: [&[u8]; 5] = [
///     b"@base <http://example.com/>",
///     b". @prefix schema: <http://schema.org/> .",
///     b"<foo> a schema:Person",
///     b" ; schema:name \"Foo\" . <bar>",
///     b" a schema:Person ; schema:name \"Bar\" .",
/// ];
///
/// let schema_person = NamedNode::new("http://schema.org/Person")?;
/// let mut count = 0;
/// let mut parser = TriGParser::new().low_level();
/// let mut file_chunks = file.iter();
/// while !parser.is_end() {
///     // We feed more data to the parser
///     if let Some(chunk) = file_chunks.next() {
///         parser.extend_from_slice(chunk);
///     } else {
///         parser.end(); // It's finished
///     }
///     // We read as many quads from the parser as possible
///     while let Some(quad) = parser.parse_next() {
///         let quad = quad?;
///         if quad.predicate == rdf::TYPE && quad.object == schema_person {
///             count += 1;
///         }
///     }
/// }
/// assert_eq!(2, count);
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
pub struct LowLevelTriGParser {
    parser: Parser<Vec<u8>, TriGRecognizer>,
}

impl LowLevelTriGParser {
    /// Adds some extra bytes to the parser. Should be called when [`parse_next`](Self::parse_next) returns [`None`] and there is still unread data.
    pub fn extend_from_slice(&mut self, other: &[u8]) {
        self.parser.extend_from_slice(other)
    }

    /// Tell the parser that the file is finished.
    ///
    /// This triggers the parsing of the final bytes and might lead [`parse_next`](Self::parse_next) to return some extra values.
    pub fn end(&mut self) {
        self.parser.end()
    }

    /// Returns if the parsing is finished i.e. [`end`](Self::end) has been called and [`parse_next`](Self::parse_next) is always going to return `None`.
    pub fn is_end(&self) -> bool {
        self.parser.is_end()
    }

    /// Attempt to parse a new quad from the already provided data.
    ///
    /// Returns [`None`] if the parsing is finished or more data is required.
    /// If it is the case more data should be fed using [`extend_from_slice`](Self::extend_from_slice).
    pub fn parse_next(&mut self) -> Option<Result<Quad, TurtleSyntaxError>> {
        self.parser.parse_next()
    }

    /// The list of IRI prefixes considered at the current step of the parsing.
    ///
    /// This method returns (prefix name, prefix value) tuples.
    /// It is empty at the beginning of the parsing and gets updated when prefixes are encountered.
    /// It should be full at the end of the parsing (but if a prefix is overridden, only the latest version will be returned).
    ///
    /// ```
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" ."#;
    ///
    /// let mut parser = TriGParser::new().low_level();
    /// parser.extend_from_slice(file.as_bytes());
    /// assert_eq!(parser.prefixes().collect::<Vec<_>>(), []); // No prefix at the beginning
    ///
    /// parser.parse_next().unwrap()?; // We read the first triple
    /// assert_eq!(
    ///     parser.prefixes().collect::<Vec<_>>(),
    ///     [("schema", "http://schema.org/")]
    /// ); // There are now prefixes
    /// //
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn prefixes(&self) -> TriGPrefixesIter<'_> {
        TriGPrefixesIter {
            inner: self.parser.context.prefixes(),
        }
    }

    /// The base IRI considered at the current step of the parsing.
    ///
    /// ```
    /// use oxttl::TriGParser;
    ///
    /// let file = r#"@base <http://example.com/> .
    /// @prefix schema: <http://schema.org/> .
    /// <foo> a schema:Person ;
    ///     schema:name "Foo" ."#;
    ///
    /// let mut parser = TriGParser::new().low_level();
    /// parser.extend_from_slice(file.as_bytes());
    /// assert!(parser.base_iri().is_none()); // No base IRI at the beginning
    ///
    /// parser.parse_next().unwrap()?; // We read the first triple
    /// assert_eq!(parser.base_iri(), Some("http://example.com/")); // There is now a base IRI
    /// //
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn base_iri(&self) -> Option<&str> {
        self.parser
            .context
            .lexer_options
            .base_iri
            .as_ref()
            .map(Iri::as_str)
    }

    /// Returns named graph declarations encountered so far, including empty
    /// named graph blocks.
    pub fn named_graphs(&self) -> impl Iterator<Item = &NamedOrBlankNode> {
        self.parser.context.named_graphs()
    }
}

/// Iterator on the file prefixes.
///
/// See [`LowLevelTriGParser::prefixes`].
pub struct TriGPrefixesIter<'a> {
    inner: Iter<'a, OxString, Iri<OxString>>,
}

impl<'a> Iterator for TriGPrefixesIter<'a> {
    type Item = (&'a str, &'a str);

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        let (key, value) = self.inner.next()?;
        Some((key.as_str(), value.as_str()))
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

/// A [TriG](https://www.w3.org/TR/trig/) serializer.
///
/// ```
/// use oxrdf::{NamedNode, Quad};
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGSerializer;
///
/// let mut serializer = TriGSerializer::new()
///     .with_prefix("schema", "http://schema.org/")?
///     .for_writer(Vec::new());
/// serializer.serialize_quad(&Quad::new(
///     NamedNode::new("http://example.com#me")?,
///     rdf::TYPE,
///     NamedNode::new("http://schema.org/Person")?,
///     NamedNode::new("http://example.com")?,
/// ))?;
/// assert_eq!(
///     b"@prefix schema: <http://schema.org/> .\n<http://example.com> {\n\t<http://example.com#me> a schema:Person .\n}\n",
///     serializer.finish()?.as_slice()
/// );
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[derive(Default, Clone)]
#[must_use]
pub struct TriGSerializer {
    base_iri: Option<Iri<String>>,
    prefixes: BTreeMap<String, String>,
    rdf_version: RdfVersion,
}

impl TriGSerializer {
    /// Builds a new [`TriGSerializer`].
    #[inline]
    pub fn new() -> Self {
        Self {
            base_iri: None,
            prefixes: BTreeMap::new(),
            rdf_version: RdfVersion::V1_1,
        }
    }

    /// Sets the RDF version announced by the serialized document.
    ///
    /// RDF 1.1 is used by default. RDF 1.2 and RDF 1.2 Basic modes write their
    /// corresponding `VERSION` directive before any base or prefix directive.
    /// RDF 1.2 Basic accepts directional language-tagged strings but rejects
    /// triple terms.
    #[inline]
    pub fn with_rdf_version(mut self, rdf_version: RdfVersion) -> Self {
        self.rdf_version = rdf_version;
        self
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

    /// Adds a base IRI to the serialization.
    ///
    /// ```
    /// use oxrdf::vocab::rdf;
    /// use oxrdf::{NamedNode, Quad};
    /// use oxttl::TriGSerializer;
    ///
    /// let mut serializer = TriGSerializer::new()
    ///     .with_base_iri("http://example.com")?
    ///     .with_prefix("ex", "http://example.com/ns#")?
    ///     .for_writer(Vec::new());
    /// serializer.serialize_quad(&Quad::new(
    ///     NamedNode::new("http://example.com/me")?,
    ///     rdf::TYPE,
    ///     NamedNode::new("http://example.com/ns#Person")?,
    ///     NamedNode::new("http://example.com")?,
    /// ))?;
    /// assert_eq!(
    ///     b"@base <http://example.com> .\n@prefix ex: </ns#> .\n<> {\n\t</me> a ex:Person .\n}\n",
    ///     serializer.finish()?.as_slice()
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn with_base_iri(mut self, base_iri: &str) -> Result<Self, IriParseError> {
        self.base_iri = Some(Iri::parse(base_iri.into())?);
        Ok(self)
    }

    /// Writes a TriG file to a [`Write`] implementation.
    ///
    /// ```
    /// use oxrdf::{NamedNode, Quad};
    /// use oxrdf::vocab::rdf;
    /// use oxttl::TriGSerializer;
    ///
    /// let mut serializer = TriGSerializer::new()
    ///     .with_prefix("schema", "http://schema.org/")?
    ///     .for_writer(Vec::new());
    /// serializer.serialize_quad(&Quad::new(
    ///     NamedNode::new("http://example.com#me")?,
    ///     rdf::TYPE,
    ///     NamedNode::new("http://schema.org/Person")?,
    ///     NamedNode::new("http://example.com")?,
    /// ))?;
    /// assert_eq!(
    ///     b"@prefix schema: <http://schema.org/> .\n<http://example.com> {\n\t<http://example.com#me> a schema:Person .\n}\n",
    ///     serializer.finish()?.as_slice()
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn for_writer<W: Write>(self, writer: W) -> WriterTriGSerializer<W> {
        WriterTriGSerializer {
            writer,
            low_level_writer: self.low_level(),
        }
    }

    /// Writes a TriG file to a [`AsyncWrite`] implementation.
    ///
    /// ```
    /// # #[tokio::main(flavor = "current_thread")]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// use oxrdf::{NamedNode, Quad};
    /// use oxrdf::vocab::rdf;
    /// use oxttl::TriGSerializer;
    ///
    /// let mut serializer = TriGSerializer::new()
    ///     .with_prefix("schema", "http://schema.org/")?
    ///     .for_tokio_async_writer(Vec::new());
    /// serializer
    ///     .serialize_quad(&Quad::new(
    ///         NamedNode::new("http://example.com#me")?,
    ///         rdf::TYPE,
    ///         NamedNode::new("http://schema.org/Person")?,
    ///         NamedNode::new("http://example.com")?,
    ///     ))
    ///     .await?;
    /// assert_eq!(
    ///     b"@prefix schema: <http://schema.org/> .\n<http://example.com> {\n\t<http://example.com#me> a schema:Person .\n}\n",
    ///     serializer.finish().await?.as_slice()
    /// );
    /// # Ok(())
    /// # }
    /// ```
    #[cfg(feature = "async-tokio")]
    pub fn for_tokio_async_writer<W: AsyncWrite + Unpin>(
        self,
        writer: W,
    ) -> TokioAsyncWriterTriGSerializer<W> {
        TokioAsyncWriterTriGSerializer {
            writer,
            low_level_writer: self.low_level(),
            buffer: Vec::new(),
        }
    }

    /// Builds a low-level TriG writer.
    ///
    /// ```
    /// use oxrdf::{NamedNode, Quad};
    /// use oxrdf::vocab::rdf;
    /// use oxttl::TriGSerializer;
    ///
    /// let mut buf = Vec::new();
    /// let mut serializer = TriGSerializer::new()
    ///     .with_prefix("schema", "http://schema.org/")?
    ///     .low_level();
    /// serializer.serialize_quad(
    ///     &Quad::new(
    ///         NamedNode::new("http://example.com#me")?,
    ///         rdf::TYPE,
    ///         NamedNode::new("http://schema.org/Person")?,
    ///         NamedNode::new("http://example.com")?,
    ///     ),
    ///     &mut buf,
    /// )?;
    /// serializer.finish(&mut buf)?;
    /// assert_eq!(
    ///     b"@prefix schema: <http://schema.org/> .\n<http://example.com> {\n\t<http://example.com#me> a schema:Person .\n}\n",
    ///     buf.as_slice()
    /// );
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn low_level(self) -> LowLevelTriGSerializer {
        // We sort prefixes by decreasing length
        let mut prefixes = self.prefixes.into_iter().collect::<Vec<_>>();
        prefixes.sort_unstable_by_key(|(_, p)| Reverse(p.len()));
        LowLevelTriGSerializer {
            prefixes,
            base_iri: self.base_iri,
            rdf_version: self.rdf_version,
            prelude_written: false,
            current_graph_name: GraphName::DefaultGraph,
            current_subject_predicate: None,
        }
    }
}

/// Writes a TriG file to a [`Write`] implementation.
///
/// Can be built using [`TriGSerializer::for_writer`].
///
/// ```
/// use oxrdf::{NamedNode, Quad};
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGSerializer;
///
/// let mut serializer = TriGSerializer::new()
///     .with_prefix("schema", "http://schema.org/")?
///     .for_writer(Vec::new());
/// serializer.serialize_quad(&Quad::new(
///     NamedNode::new("http://example.com#me")?,
///     rdf::TYPE,
///     NamedNode::new("http://schema.org/Person")?,
///     NamedNode::new("http://example.com")?,
/// ))?;
/// assert_eq!(
///     b"@prefix schema: <http://schema.org/> .\n<http://example.com> {\n\t<http://example.com#me> a schema:Person .\n}\n",
///     serializer.finish()?.as_slice()
/// );
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
pub struct WriterTriGSerializer<W: Write> {
    writer: W,
    low_level_writer: LowLevelTriGSerializer,
}

impl<W: Write> WriterTriGSerializer<W> {
    /// Writes an extra quad.
    pub fn serialize_quad(&mut self, quad: &Quad) -> io::Result<()> {
        self.low_level_writer.serialize_quad(quad, &mut self.writer)
    }

    /// Writes an empty named graph block.
    pub fn serialize_empty_graph(&mut self, graph_name: &NamedOrBlankNode) -> io::Result<()> {
        self.low_level_writer
            .serialize_empty_graph(graph_name, &mut self.writer)
    }

    /// Writes a complete RDF dataset, including empty named graphs.
    ///
    /// Use this method instead of serializing only [`Dataset::iter`] when
    /// dataset topology must round-trip.
    pub fn serialize_dataset(&mut self, dataset: &Dataset) -> io::Result<()> {
        self.low_level_writer
            .serialize_dataset(dataset, &mut self.writer)
    }

    #[doc(hidden)]
    pub fn serialize_triple(&mut self, triple: &Triple) -> io::Result<()> {
        self.low_level_writer
            .serialize_triple(triple, &mut self.writer)
    }

    /// Ends the write process and returns the underlying [`Write`].
    pub fn finish(mut self) -> io::Result<W> {
        self.low_level_writer.finish(&mut self.writer)?;
        Ok(self.writer)
    }
}

/// Writes a TriG file to a [`AsyncWrite`] implementation.
///
/// Can be built using [`TriGSerializer::for_tokio_async_writer`].
///
/// ```
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
/// use oxrdf::{NamedNode, Quad};
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGSerializer;
///
/// let mut serializer = TriGSerializer::new()
///     .with_prefix("schema", "http://schema.org/")?
///     .for_tokio_async_writer(Vec::new());
/// serializer
///     .serialize_quad(&Quad::new(
///         NamedNode::new("http://example.com#me")?,
///         rdf::TYPE,
///         NamedNode::new("http://schema.org/Person")?,
///         NamedNode::new("http://example.com")?,
///     ))
///     .await?;
/// assert_eq!(
///     b"@prefix schema: <http://schema.org/> .\n<http://example.com> {\n\t<http://example.com#me> a schema:Person .\n}\n",
///     serializer.finish().await?.as_slice()
/// );
/// # Ok(())
/// # }
/// ```
#[cfg(feature = "async-tokio")]
#[must_use]
pub struct TokioAsyncWriterTriGSerializer<W: AsyncWrite + Unpin> {
    writer: W,
    low_level_writer: LowLevelTriGSerializer,
    buffer: Vec<u8>,
}

#[cfg(feature = "async-tokio")]
impl<W: AsyncWrite + Unpin> TokioAsyncWriterTriGSerializer<W> {
    /// Writes an extra quad.
    pub async fn serialize_quad(&mut self, quad: &Quad) -> io::Result<()> {
        self.low_level_writer
            .serialize_quad(quad, &mut self.buffer)?;
        self.writer.write_all(&self.buffer).await?;
        self.buffer.clear();
        Ok(())
    }

    /// Writes an empty named graph block.
    pub async fn serialize_empty_graph(&mut self, graph_name: &NamedOrBlankNode) -> io::Result<()> {
        self.low_level_writer
            .serialize_empty_graph(graph_name, &mut self.buffer)?;
        self.writer.write_all(&self.buffer).await?;
        self.buffer.clear();
        Ok(())
    }

    /// Writes a complete RDF dataset, including empty named graphs.
    pub async fn serialize_dataset(&mut self, dataset: &Dataset) -> io::Result<()> {
        let empty_named_graphs =
            ensure_terse_dataset_compatible(self.low_level_writer.rdf_version, dataset)?;
        for quad in dataset {
            self.serialize_quad(&quad).await?;
        }
        for graph_name in empty_named_graphs {
            self.serialize_empty_graph(&graph_name).await?;
        }
        Ok(())
    }

    #[doc(hidden)]
    pub async fn serialize_triple(&mut self, triple: &Triple) -> io::Result<()> {
        self.low_level_writer
            .serialize_triple(triple, &mut self.buffer)?;
        self.writer.write_all(&self.buffer).await?;
        self.buffer.clear();
        Ok(())
    }

    /// Ends the write process and returns the underlying [`Write`].
    pub async fn finish(mut self) -> io::Result<W> {
        self.low_level_writer.finish(&mut self.buffer)?;
        self.writer.write_all(&self.buffer).await?;
        self.buffer.clear();
        Ok(self.writer)
    }
}

/// Writes a TriG file by using a low-level API.
///
/// Can be built using [`TriGSerializer::low_level`].
///
/// ```
/// use oxrdf::{NamedNode, Quad};
/// use oxrdf::vocab::rdf;
/// use oxttl::TriGSerializer;
///
/// let mut buf = Vec::new();
/// let mut serializer = TriGSerializer::new()
///     .with_prefix("schema", "http://schema.org/")?
///     .low_level();
/// serializer.serialize_quad(
///     &Quad::new(
///         NamedNode::new("http://example.com#me")?,
///         rdf::TYPE,
///         NamedNode::new("http://schema.org/Person")?,
///         NamedNode::new("http://example.com")?,
///     ),
///     &mut buf,
/// )?;
/// serializer.finish(&mut buf)?;
/// assert_eq!(
///     b"@prefix schema: <http://schema.org/> .\n<http://example.com> {\n\t<http://example.com#me> a schema:Person .\n}\n",
///     buf.as_slice()
/// );
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
pub struct LowLevelTriGSerializer {
    prefixes: Vec<(String, String)>,
    base_iri: Option<Iri<String>>,
    rdf_version: RdfVersion,
    prelude_written: bool,
    current_graph_name: GraphName,
    current_subject_predicate: Option<(NamedOrBlankNode, NamedNode)>,
}

impl LowLevelTriGSerializer {
    /// Writes an extra quad.
    pub fn serialize_quad(&mut self, quad: &Quad, writer: impl Write) -> io::Result<()> {
        self.serialize_quad_parts(
            &quad.subject,
            &quad.predicate,
            &quad.object,
            &quad.graph_name,
            writer,
        )
    }

    /// Writes an empty named graph block.
    pub fn serialize_empty_graph(
        &mut self,
        graph_name: &NamedOrBlankNode,
        mut writer: impl Write,
    ) -> io::Result<()> {
        ensure_terse_graph_name_compatible(self.rdf_version, graph_name)?;
        self.ensure_prelude(&mut writer)?;
        self.finish_current_graph(&mut writer)?;
        match graph_name {
            NamedOrBlankNode::NamedNode(graph_name) => writeln!(
                writer,
                "{} {{}}",
                TurtleNamedNode {
                    node: graph_name,
                    prefixes: &self.prefixes,
                    base_iri: &self.base_iri,
                }
            ),
            NamedOrBlankNode::BlankNode(graph_name) => writeln!(writer, "{graph_name} {{}}"),
        }
    }

    /// Writes a complete RDF dataset, including empty named graphs.
    pub fn serialize_dataset(
        &mut self,
        dataset: &Dataset,
        mut writer: impl Write,
    ) -> io::Result<()> {
        let empty_named_graphs = ensure_terse_dataset_compatible(self.rdf_version, dataset)?;
        for quad in dataset {
            self.serialize_quad(&quad, &mut writer)?;
        }
        for graph_name in empty_named_graphs {
            self.serialize_empty_graph(&graph_name, &mut writer)?;
        }
        Ok(())
    }

    pub(crate) fn serialize_triple(
        &mut self,
        triple: &Triple,
        writer: impl Write,
    ) -> io::Result<()> {
        self.serialize_quad_parts(
            &triple.subject,
            &triple.predicate,
            &triple.object,
            &GraphName::DefaultGraph,
            writer,
        )
    }

    fn serialize_quad_parts(
        &mut self,
        subject: &NamedOrBlankNode,
        predicate: &NamedNode,
        object: &Term,
        graph_name: &GraphName,
        mut writer: impl Write,
    ) -> io::Result<()> {
        ensure_terse_parts_compatible(self.rdf_version, subject, predicate, object, graph_name)?;
        self.ensure_prelude(&mut writer)?;
        if *graph_name == self.current_graph_name {
            if let Some((current_subject, current_predicate)) =
                self.current_subject_predicate.take()
            {
                if *subject == current_subject {
                    if *predicate == current_predicate {
                        self.current_subject_predicate = Some((current_subject, current_predicate));
                        write!(writer, " , {}", self.object(object))
                    } else {
                        self.current_subject_predicate = Some((current_subject, predicate.clone()));
                        writeln!(writer, " ;")?;
                        if !self.current_graph_name.is_default_graph() {
                            write!(writer, "\t")?;
                        }
                        write!(
                            writer,
                            "\t{} {}",
                            self.predicate(predicate),
                            self.object(object)
                        )
                    }
                } else {
                    self.current_subject_predicate = Some((subject.clone(), predicate.clone()));
                    writeln!(writer, " .")?;
                    if !self.current_graph_name.is_default_graph() {
                        write!(writer, "\t")?;
                    }
                    write!(
                        writer,
                        "{} {} {}",
                        self.subject(subject),
                        self.predicate(predicate),
                        self.object(object)
                    )
                }
            } else {
                self.current_subject_predicate = Some((subject.clone(), predicate.clone()));
                if !self.current_graph_name.is_default_graph() {
                    write!(writer, "\t")?;
                }
                write!(
                    writer,
                    "{} {} {}",
                    self.subject(subject),
                    self.predicate(predicate),
                    self.object(object)
                )
            }
        } else {
            if self.current_subject_predicate.is_some() {
                writeln!(writer, " .")?;
            }
            if !self.current_graph_name.is_default_graph() {
                writeln!(writer, "}}")?;
            }
            self.current_graph_name = graph_name.clone();
            self.current_subject_predicate = Some((subject.clone(), predicate.clone()));
            match &self.current_graph_name {
                GraphName::NamedNode(g) => {
                    writeln!(
                        writer,
                        "{} {{",
                        TurtleNamedNode {
                            node: g,
                            prefixes: &self.prefixes,
                            base_iri: &self.base_iri,
                        }
                    )?;
                    write!(writer, "\t")?;
                }
                GraphName::BlankNode(g) => {
                    writeln!(writer, "{g} {{")?;
                    write!(writer, "\t")?;
                }
                GraphName::DefaultGraph => (),
            }

            write!(
                writer,
                "{} {} {}",
                self.subject(subject),
                self.predicate(predicate),
                self.object(object)
            )
        }
    }

    fn subject<'a>(&'a self, node: &'a NamedOrBlankNode) -> TurtleNamedOrBlankNode<'a> {
        TurtleNamedOrBlankNode {
            node,
            prefixes: &self.prefixes,
            base_iri: &self.base_iri,
        }
    }

    fn predicate<'a>(&'a self, named_node: &'a NamedNode) -> TurtlePredicate<'a> {
        TurtlePredicate {
            named_node,
            prefixes: &self.prefixes,
            base_iri: &self.base_iri,
        }
    }

    fn object<'a>(&'a self, term: &'a Term) -> TurtleTerm<'a> {
        TurtleTerm {
            term,
            prefixes: &self.prefixes,
            base_iri: &self.base_iri,
        }
    }

    fn ensure_prelude(&mut self, mut writer: impl Write) -> io::Result<()> {
        if self.prelude_written {
            return Ok(());
        }
        for (prefix_name, _) in &self.prefixes {
            if !is_valid_prefix_name(prefix_name) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("'{prefix_name}' is not a valid Turtle prefix name"),
                ));
            }
        }
        let mut prelude = Vec::new();
        match self.rdf_version {
            RdfVersion::V1_1 => {}
            #[cfg(feature = "rdf-12")]
            RdfVersion::V1_2Basic => writeln!(prelude, "VERSION \"1.2-basic\"")?,
            #[cfg(feature = "rdf-12")]
            RdfVersion::V1_2 => writeln!(prelude, "VERSION \"1.2\"")?,
            #[cfg(not(feature = "rdf-12"))]
            RdfVersion::V1_2Basic | RdfVersion::V1_2 => {
                return Err(rdf_12_feature_required());
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "unsupported RDF version",
                ));
            }
        }
        if let Some(base_iri) = &self.base_iri {
            writeln!(prelude, "@base <{base_iri}> .")?;
        }
        for (prefix_name, prefix_iri) in &self.prefixes {
            writeln!(
                prelude,
                "@prefix {prefix_name}: <{}> .",
                relative_iri(prefix_iri, &self.base_iri)
            )?;
        }
        writer.write_all(&prelude)?;
        self.prelude_written = true;
        Ok(())
    }

    fn finish_current_graph(&mut self, mut writer: impl Write) -> io::Result<()> {
        if self.current_subject_predicate.take().is_some() {
            writeln!(writer, " .")?;
        }
        if !self.current_graph_name.is_default_graph() {
            writeln!(writer, "}}")?;
        }
        self.current_graph_name = GraphName::DefaultGraph;
        Ok(())
    }

    /// Finishes to write the file.
    pub fn finish(&mut self, mut writer: impl Write) -> io::Result<()> {
        self.ensure_prelude(&mut writer)?;
        self.finish_current_graph(writer)
    }
}

fn ensure_terse_dataset_compatible(
    rdf_version: RdfVersion,
    dataset: &Dataset,
) -> io::Result<Vec<NamedOrBlankNode>> {
    for quad in dataset {
        ensure_terse_parts_compatible(
            rdf_version,
            &quad.subject,
            &quad.predicate,
            &quad.object,
            &quad.graph_name,
        )?;
    }
    let empty_named_graphs = dataset
        .named_graphs()
        .filter(|graph_name| dataset.graph(graph_name).is_empty())
        .collect::<Vec<_>>();
    for graph_name in &empty_named_graphs {
        ensure_terse_graph_name_compatible(rdf_version, graph_name)?;
    }
    Ok(empty_named_graphs)
}

#[cfg(not(feature = "rdf-12"))]
fn rdf_12_feature_required() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "RDF 1.2 serialization requires the 'rdf-12' feature",
    )
}

fn is_valid_prefix_name(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return true;
    };
    if !is_pn_chars_base(first) {
        return false;
    }
    let mut last = first;
    for character in characters {
        if character != '.' && !is_pn_chars(character) {
            return false;
        }
        last = character;
    }
    is_pn_chars(last)
}

fn is_pn_chars(character: char) -> bool {
    is_pn_chars_base(character)
        || character == '_'
        || character == '-'
        || character.is_ascii_digit()
        || character == '\u{B7}'
        || ('\u{0300}'..='\u{036F}').contains(&character)
        || ('\u{203F}'..='\u{2040}').contains(&character)
}

fn is_pn_chars_base(character: char) -> bool {
    character.is_ascii_alphabetic()
        || ('\u{00C0}'..='\u{00D6}').contains(&character)
        || ('\u{00D8}'..='\u{00F6}').contains(&character)
        || ('\u{00F8}'..='\u{02FF}').contains(&character)
        || ('\u{0370}'..='\u{037D}').contains(&character)
        || ('\u{037F}'..='\u{1FFF}').contains(&character)
        || ('\u{200C}'..='\u{200D}').contains(&character)
        || ('\u{2070}'..='\u{218F}').contains(&character)
        || ('\u{2C00}'..='\u{2FEF}').contains(&character)
        || ('\u{3001}'..='\u{D7FF}').contains(&character)
        || ('\u{F900}'..='\u{FDCF}').contains(&character)
        || ('\u{FDF0}'..='\u{FFFD}').contains(&character)
        || ('\u{10000}'..='\u{EFFFF}').contains(&character)
}

struct TurtleNamedNode<'a> {
    node: &'a NamedNode,
    prefixes: &'a Vec<(String, String)>,
    base_iri: &'a Option<Iri<String>>,
}

impl fmt::Display for TurtleNamedNode<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (prefix_name, prefix_iri) in self.prefixes {
            if let Some(local_name) = self.node.as_str().strip_prefix(prefix_iri) {
                if local_name.is_empty() {
                    return write!(f, "{prefix_name}:");
                } else if let Some(escaped_local_name) = escape_local_name(local_name) {
                    return write!(f, "{prefix_name}:{escaped_local_name}");
                }
            }
        }
        write!(f, "<{}>", relative_iri(self.node.as_str(), self.base_iri))
    }
}

struct TurtlePredicate<'a> {
    named_node: &'a NamedNode,
    prefixes: &'a Vec<(String, String)>,
    base_iri: &'a Option<Iri<String>>,
}

impl fmt::Display for TurtlePredicate<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if *self.named_node == rdf::TYPE {
            f.write_str("a")
        } else {
            TurtleNamedNode {
                node: self.named_node,
                prefixes: self.prefixes,
                base_iri: self.base_iri,
            }
            .fmt(f)
        }
    }
}

struct TurtleNamedOrBlankNode<'a> {
    node: &'a NamedOrBlankNode,
    prefixes: &'a Vec<(String, String)>,
    base_iri: &'a Option<Iri<String>>,
}

impl fmt::Display for TurtleNamedOrBlankNode<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.node {
            NamedOrBlankNode::NamedNode(v) => TurtleNamedNode {
                node: v,
                prefixes: self.prefixes,
                base_iri: self.base_iri,
            }
            .fmt(f),
            NamedOrBlankNode::BlankNode(v) => write!(f, "{v}"),
        }
    }
}

struct TurtleTerm<'a> {
    term: &'a Term,
    prefixes: &'a Vec<(String, String)>,
    base_iri: &'a Option<Iri<String>>,
}

impl fmt::Display for TurtleTerm<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.term {
            Term::NamedNode(v) => TurtleNamedNode {
                node: v,
                prefixes: self.prefixes,
                base_iri: self.base_iri,
            }
            .fmt(f),
            Term::BlankNode(v) => write!(f, "{v}"),
            Term::Literal(v) => {
                let value = v.value();
                let datatype = v.datatype();
                let is_plain = {
                    #[cfg(feature = "rdf-12")]
                    {
                        *datatype == xsd::STRING
                            || *datatype == rdf::LANG_STRING
                            || *datatype == rdf::DIR_LANG_STRING
                    }
                    #[cfg(not(feature = "rdf-12"))]
                    {
                        *datatype == xsd::STRING || *datatype == rdf::LANG_STRING
                    }
                };
                if is_plain {
                    write!(f, "{v}")
                } else {
                    let datatype = v.datatype();
                    if *datatype == xsd::BOOLEAN && is_turtle_boolean(value)
                        || *datatype == xsd::INTEGER && is_turtle_integer(value)
                        || *datatype == xsd::DECIMAL && is_turtle_decimal(value)
                        || *datatype == xsd::DOUBLE && is_turtle_double(value)
                    {
                        f.write_str(value)
                    } else {
                        write!(
                            f,
                            "{}^^{}",
                            Literal::new_simple_literal(v.clone().into_value()),
                            TurtleNamedNode {
                                node: v.datatype(),
                                prefixes: self.prefixes,
                                base_iri: self.base_iri,
                            }
                        )
                    }
                }
            }
            #[cfg(feature = "rdf-12")]
            Term::Triple(t) => {
                write!(
                    f,
                    "<<( {} {} {} )>>",
                    TurtleNamedOrBlankNode {
                        node: &t.subject,
                        prefixes: self.prefixes,
                        base_iri: self.base_iri,
                    },
                    TurtlePredicate {
                        named_node: &t.predicate,
                        prefixes: self.prefixes,
                        base_iri: self.base_iri,
                    },
                    TurtleTerm {
                        term: &t.object,
                        prefixes: self.prefixes,
                        base_iri: self.base_iri,
                    }
                )
            }
        }
    }
}

fn relative_iri<'a>(iri: &'a str, base_iri: &Option<Iri<String>>) -> Cow<'a, str> {
    if let Some(base_iri) = base_iri {
        if let Ok(relative) = base_iri.relativize(&Iri::parse_unchecked(iri)) {
            return relative.into_inner().into();
        }
    }
    iri.into()
}

fn is_turtle_boolean(value: &str) -> bool {
    matches!(value, "true" | "false")
}

fn is_turtle_integer(value: &str) -> bool {
    // [19]  INTEGER  ::=  [+-]? [0-9]+
    let mut value = value.as_bytes();
    if let Some(v) = value.strip_prefix(b"+") {
        value = v;
    } else if let Some(v) = value.strip_prefix(b"-") {
        value = v;
    }
    !value.is_empty() && value.iter().all(u8::is_ascii_digit)
}

fn is_turtle_decimal(value: &str) -> bool {
    // [20]  DECIMAL  ::=  [+-]? [0-9]* '.' [0-9]+
    let mut value = value.as_bytes();
    if let Some(v) = value.strip_prefix(b"+") {
        value = v;
    } else if let Some(v) = value.strip_prefix(b"-") {
        value = v;
    }
    while value.first().is_some_and(u8::is_ascii_digit) {
        value = &value[1..];
    }
    let Some(value) = value.strip_prefix(b".") else {
        return false;
    };
    !value.is_empty() && value.iter().all(u8::is_ascii_digit)
}

fn is_turtle_double(value: &str) -> bool {
    // [21]    DOUBLE    ::=  [+-]? ([0-9]+ '.' [0-9]* EXPONENT | '.' [0-9]+ EXPONENT | [0-9]+ EXPONENT)
    // [154s]  EXPONENT  ::=  [eE] [+-]? [0-9]+
    let mut value = value.as_bytes();
    if let Some(v) = value.strip_prefix(b"+") {
        value = v;
    } else if let Some(v) = value.strip_prefix(b"-") {
        value = v;
    }
    let mut with_before = false;
    while value.first().is_some_and(u8::is_ascii_digit) {
        value = &value[1..];
        with_before = true;
    }
    let mut with_after = false;
    if let Some(v) = value.strip_prefix(b".") {
        value = v;
        while value.first().is_some_and(u8::is_ascii_digit) {
            value = &value[1..];
            with_after = true;
        }
    }
    if let Some(v) = value.strip_prefix(b"e") {
        value = v;
    } else if let Some(v) = value.strip_prefix(b"E") {
        value = v;
    } else {
        return false;
    }
    if let Some(v) = value.strip_prefix(b"+") {
        value = v;
    } else if let Some(v) = value.strip_prefix(b"-") {
        value = v;
    }
    (with_before || with_after) && !value.is_empty() && value.iter().all(u8::is_ascii_digit)
}

fn escape_local_name(value: &str) -> Option<String> {
    // TODO: PLX
    // [168s] 	PN_LOCAL 	::= 	(PN_CHARS_U | ':' | [0-9] | PLX) ((PN_CHARS | '.' | ':' | PLX)* (PN_CHARS | ':' | PLX))?
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars();
    let first = chars.next()?;
    if N3Lexer::is_possible_pn_chars_u(first) || first == ':' || first.is_ascii_digit() {
        output.push(first);
    } else if can_be_escaped_in_local_name(first) {
        output.push('\\');
        output.push(first);
    } else {
        return None;
    }

    while let Some(c) = chars.next() {
        if N3Lexer::is_possible_pn_chars(c) || c == ':' || (c == '.' && !chars.as_str().is_empty())
        {
            output.push(c);
        } else if can_be_escaped_in_local_name(c) {
            output.push('\\');
            output.push(c);
        } else {
            return None;
        }
    }

    Some(output)
}

fn can_be_escaped_in_local_name(c: char) -> bool {
    matches!(
        c,
        '_' | '~'
            | '.'
            | '-'
            | '!'
            | '$'
            | '&'
            | '\''
            | '('
            | ')'
            | '*'
            | '+'
            | ','
            | ';'
            | '='
            | '/'
            | '?'
            | '#'
            | '@'
            | '%'
    )
}

#[cfg(test)]
#[expect(clippy::panic_in_result_fn)]
mod tests {
    use super::*;
    use oxrdf::BlankNode;

    #[test]
    fn test_write() -> io::Result<()> {
        let mut serializer = TriGSerializer::new()
            .with_prefix("ex", "http://example.com/")
            .map_err(io::Error::other)?
            .with_prefix("exl", "http://example.com/p/")
            .map_err(io::Error::other)?
            .for_writer(Vec::new());
        serializer.serialize_quad(&Quad::new(
            NamedNode::new_unchecked("http://example.com/s"),
            NamedNode::new_unchecked("http://example.com/p"),
            NamedNode::new_unchecked("http://example.com/p/o."),
            NamedNode::new_unchecked("http://example.com/g"),
        ))?;
        serializer.serialize_quad(&Quad::new(
            NamedNode::new_unchecked("http://example.com/s"),
            NamedNode::new_unchecked("http://example.com/p"),
            NamedNode::new_unchecked("https://example.com/o"),
            NamedNode::new_unchecked("http://example.com/g"),
        ))?;
        serializer.serialize_quad(&Quad::new(
            NamedNode::new_unchecked("http://example.com/s"),
            NamedNode::new_unchecked("http://example.com/p"),
            NamedNode::new_unchecked("http://example.com/"),
            NamedNode::new_unchecked("http://example.com/g"),
        ))?;
        serializer.serialize_quad(&Quad::new(
            NamedNode::new_unchecked("http://example.com/s"),
            NamedNode::new_unchecked("http://example.com/p"),
            Literal::new_simple_literal("foo"),
            NamedNode::new_unchecked("http://example.com/g"),
        ))?;
        serializer.serialize_quad(&Quad::new(
            NamedNode::new_unchecked("http://example.com/s"),
            NamedNode::new_unchecked("http://example.com/p2"),
            Literal::new_language_tagged_literal_unchecked("foo", "en"),
            NamedNode::new_unchecked("http://example.com/g"),
        ))?;
        serializer.serialize_quad(&Quad::new(
            BlankNode::new_unchecked("b"),
            NamedNode::new_unchecked("http://example.com/p2"),
            BlankNode::new_unchecked("b2"),
            NamedNode::new_unchecked("http://example.com/g"),
        ))?;
        serializer.serialize_quad(&Quad::new(
            BlankNode::new_unchecked("b"),
            NamedNode::new_unchecked("http://example.com/p2"),
            Literal::new_typed_literal("true", xsd::BOOLEAN),
            GraphName::DefaultGraph,
        ))?;
        serializer.serialize_quad(&Quad::new(
            BlankNode::new_unchecked("b"),
            NamedNode::new_unchecked("http://example.org/p2"),
            Literal::new_typed_literal("false", xsd::BOOLEAN),
            NamedNode::new_unchecked("http://example.com/g2"),
        ))?;
        assert_eq!(
            String::from_utf8(serializer.finish()?).map_err(io::Error::other)?,
            "@prefix exl: <http://example.com/p/> .\n@prefix ex: <http://example.com/> .\nex:g {\n\tex:s ex:p exl:o\\. , <https://example.com/o> , ex: , \"foo\" ;\n\t\tex:p2 \"foo\"@en .\n\t_:b ex:p2 _:b2 .\n}\n_:b ex:p2 true .\nex:g2 {\n\t_:b <http://example.org/p2> false .\n}\n"
        );
        Ok(())
    }
}
