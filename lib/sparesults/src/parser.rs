#[cfg(feature = "async-tokio")]
use crate::charset::TokioAsyncCharsetReader;
use crate::charset::{CharsetReader, validate_slice};
use crate::csv::{
    ReaderTsvQueryResultsParserOutput, ReaderTsvSolutionsParser, SliceTsvQueryResultsParserOutput,
    SliceTsvSolutionsParser,
};
#[cfg(feature = "async-tokio")]
use crate::csv::{TokioAsyncReaderTsvQueryResultsParserOutput, TokioAsyncReaderTsvSolutionsParser};
use crate::error::{QueryResultsParseError, QueryResultsSyntaxError};
use crate::format::QueryResultsFormat;
use crate::json::{
    ReaderJsonQueryResultsParserOutput, ReaderJsonSolutionsParser,
    SliceJsonQueryResultsParserOutput, SliceJsonSolutionsParser,
};
#[cfg(feature = "async-tokio")]
use crate::json::{
    TokioAsyncReaderJsonQueryResultsParserOutput, TokioAsyncReaderJsonSolutionsParser,
};
use crate::media_type::{
    QueryResultsCharset, QueryResultsMediaType, QueryResultsMediaTypeParseError,
};
use crate::solution::QuerySolution;
use crate::xml::{
    ReaderXmlQueryResultsParserOutput, ReaderXmlSolutionsParser, SliceXmlQueryResultsParserOutput,
    SliceXmlSolutionsParser,
};
#[cfg(feature = "async-tokio")]
use crate::xml::{TokioAsyncReaderXmlQueryResultsParserOutput, TokioAsyncReaderXmlSolutionsParser};
#[cfg(feature = "sparql-12")]
use oxrdf::NamedOrBlankNode;
use oxrdf::{BlankNode, RdfVersion, Term, Variable};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
#[cfg(feature = "async-tokio")]
use tokio::io::AsyncRead;

/// Parsers for [SPARQL query](https://www.w3.org/TR/sparql11-query/) results serialization formats.
///
/// It currently supports the following formats:
/// * [SPARQL Query Results XML Format](https://www.w3.org/TR/rdf-sparql-XMLres/) ([`QueryResultsFormat::Xml`](QueryResultsFormat::Xml)).
/// * [SPARQL Query Results JSON Format](https://www.w3.org/TR/sparql11-results-json/) ([`QueryResultsFormat::Json`](QueryResultsFormat::Json)).
/// * [SPARQL Query Results TSV Format](https://www.w3.org/TR/sparql11-results-csv-tsv/) ([`QueryResultsFormat::Tsv`](QueryResultsFormat::Tsv)).
///
/// Example in JSON (the API is the same for XML and TSV):
/// ```
/// use sparesults::{QueryResultsFormat, QueryResultsParser, ReaderQueryResultsParserOutput};
/// use oxrdf::{Literal, Variable};
///
/// let json_parser = QueryResultsParser::from_format(QueryResultsFormat::Json);
/// // boolean
/// if let ReaderQueryResultsParserOutput::Boolean(v) = json_parser.clone().for_reader(br#"{"head":{},"boolean":true}"#.as_slice())? {
///     assert_eq!(v, true);
/// }
/// // solutions
/// if let ReaderQueryResultsParserOutput::Solutions(solutions) = json_parser.for_reader(br#"{"head":{"vars":["foo","bar"]},"results":{"bindings":[{"foo":{"type":"literal","value":"test"}}]}}"#.as_slice())? {
///     assert_eq!(solutions.variables(), &[Variable::new("foo")?, Variable::new("bar")?]);
///     for solution in solutions {
///         assert_eq!(solution?.iter().collect::<Vec<_>>(), vec![(&Variable::new("foo")?, &Literal::from("test").into())]);
///     }
/// }
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
#[must_use]
#[derive(Clone)]
pub struct QueryResultsParser {
    format: QueryResultsFormat,
    rdf_version: Option<RdfVersion>,
    charset: Option<QueryResultsCharset>,
}

impl QueryResultsParser {
    /// Builds a parser configured from a SPARQL results media type.
    ///
    /// If a `version` parameter is present, it takes precedence over an inline
    /// JSON or XML version declaration.
    pub fn from_media_type(media_type: &str) -> Result<Self, QueryResultsMediaTypeParseError> {
        let descriptor = QueryResultsMediaType::parse(media_type)?;
        Ok(Self::from_media_type_descriptor(&descriptor))
    }

    /// Builds a parser from a parsed SPARQL results media type descriptor.
    pub fn from_media_type_descriptor(descriptor: &QueryResultsMediaType) -> Self {
        Self {
            format: descriptor.format(),
            rdf_version: descriptor.version(),
            charset: descriptor.charset(),
        }
    }

    /// Builds a parser for the given format.
    #[inline]
    pub fn from_format(format: QueryResultsFormat) -> Self {
        Self {
            format,
            rdf_version: None,
            charset: None,
        }
    }

    /// Returns the externally configured SPARQL results version, if any.
    pub const fn rdf_version(&self) -> Option<RdfVersion> {
        self.rdf_version
    }

    /// Returns the externally declared character encoding, if any.
    pub const fn charset(&self) -> Option<QueryResultsCharset> {
        self.charset
    }

    /// Reads a result file from a [`Read`] implementation.
    ///
    /// Reads are automatically buffered.
    ///
    /// Example in XML (the API is the same for JSON and TSV):
    /// ```
    /// use sparesults::{QueryResultsFormat, QueryResultsParser, ReaderQueryResultsParserOutput};
    /// use oxrdf::{Literal, Variable};
    ///
    /// let xml_parser = QueryResultsParser::from_format(QueryResultsFormat::Xml);
    ///
    /// // boolean
    /// if let ReaderQueryResultsParserOutput::Boolean(v) = xml_parser.clone().for_reader(br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean></sparql>"#.as_slice())? {
    ///     assert_eq!(v, true);
    /// }
    ///
    /// // solutions
    /// if let ReaderQueryResultsParserOutput::Solutions(solutions) = xml_parser.for_reader(br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="foo"/><variable name="bar"/></head><results><result><binding name="foo"><literal>test</literal></binding></result></results></sparql>"#.as_slice())? {
    ///     assert_eq!(solutions.variables(), &[Variable::new("foo")?, Variable::new("bar")?]);
    ///     for solution in solutions {
    ///         assert_eq!(solution?.iter().collect::<Vec<_>>(), vec![(&Variable::new("foo")?, &Literal::from("test").into())]);
    ///     }
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn for_reader<R: Read>(
        self,
        reader: R,
    ) -> Result<ReaderQueryResultsParserOutput<R>, QueryResultsParseError> {
        Ok(match self.format {
            QueryResultsFormat::Xml => match ReaderXmlQueryResultsParserOutput::read(
                CharsetReader::new(reader, self.charset),
                self.rdf_version,
            )? {
                ReaderXmlQueryResultsParserOutput::Boolean(r) => ReaderQueryResultsParserOutput::Boolean(r),
                ReaderXmlQueryResultsParserOutput::Solutions {
                    solutions,
                    variables,
                } => ReaderQueryResultsParserOutput::Solutions(ReaderSolutionsParser {
                    variables: variables.into(),
                    solutions: ReaderSolutionsParserKind::Xml(Box::new(solutions)),
                    blank_nodes: BlankNodeScope::default(),
                }),
            },
            QueryResultsFormat::Json => match ReaderJsonQueryResultsParserOutput::read(
                CharsetReader::new(reader, self.charset),
                self.rdf_version,
            )? {
                ReaderJsonQueryResultsParserOutput::Boolean(r) => ReaderQueryResultsParserOutput::Boolean(r),
                ReaderJsonQueryResultsParserOutput::Solutions {
                    solutions,
                    variables,
                } => ReaderQueryResultsParserOutput::Solutions(ReaderSolutionsParser {
                    variables: variables.into(),
                    solutions: ReaderSolutionsParserKind::Json(Box::new(solutions)),
                    blank_nodes: BlankNodeScope::default(),
                }),
            },
            QueryResultsFormat::Csv => return Err(QueryResultsSyntaxError::msg("CSV SPARQL results syntax is lossy and can't be parsed to a proper RDF representation").into()),
            QueryResultsFormat::Tsv => match ReaderTsvQueryResultsParserOutput::read(
                CharsetReader::new(reader, self.charset),
            )? {
                ReaderTsvQueryResultsParserOutput::Boolean(r) => ReaderQueryResultsParserOutput::Boolean(r),
                ReaderTsvQueryResultsParserOutput::Solutions {
                    solutions,
                    variables,
                } => ReaderQueryResultsParserOutput::Solutions(ReaderSolutionsParser {
                    variables: variables.into(),
                    solutions: ReaderSolutionsParserKind::Tsv(solutions),
                    blank_nodes: BlankNodeScope::default(),
                }),
            },
        })
    }

    /// Reads a result file from a Tokio [`AsyncRead`] implementation.
    ///
    /// Reads are automatically buffered.
    ///
    /// Example in XML (the API is the same for JSON and TSV):
    /// ```
    /// # #[tokio::main(flavor = "current_thread")]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// use sparesults::{QueryResultsFormat, QueryResultsParser, TokioAsyncReaderQueryResultsParserOutput};
    /// use oxrdf::{Literal, Variable};
    ///
    /// let xml_parser = QueryResultsParser::from_format(QueryResultsFormat::Xml);
    ///
    /// // boolean
    /// if let TokioAsyncReaderQueryResultsParserOutput::Boolean(v) = xml_parser.clone().for_tokio_async_reader(br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean></sparql>"#.as_slice()).await? {
    ///     assert_eq!(v, true);
    /// }
    ///
    /// // solutions
    /// if let TokioAsyncReaderQueryResultsParserOutput::Solutions(mut solutions) = xml_parser.for_tokio_async_reader(br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="foo"/><variable name="bar"/></head><results><result><binding name="foo"><literal>test</literal></binding></result></results></sparql>"#.as_slice()).await? {
    ///     assert_eq!(solutions.variables(), &[Variable::new("foo")?, Variable::new("bar")?]);
    ///     while let Some(solution) = solutions.next().await {
    ///         assert_eq!(solution?.iter().collect::<Vec<_>>(), vec![(&Variable::new("foo")?, &Literal::from("test").into())]);
    ///     }
    /// }
    /// # Ok(())
    /// # }
    /// ```
    #[cfg(feature = "async-tokio")]
    pub async fn for_tokio_async_reader<R: AsyncRead + Unpin>(
        self,
        reader: R,
    ) -> Result<TokioAsyncReaderQueryResultsParserOutput<R>, QueryResultsParseError> {
        Ok(match self.format {
            QueryResultsFormat::Xml => match TokioAsyncReaderXmlQueryResultsParserOutput::read(TokioAsyncCharsetReader::new(reader, self.charset), self.rdf_version).await? {
                TokioAsyncReaderXmlQueryResultsParserOutput::Boolean(r) => TokioAsyncReaderQueryResultsParserOutput::Boolean(r),
                TokioAsyncReaderXmlQueryResultsParserOutput::Solutions {
                    solutions,
                    variables,
                } => TokioAsyncReaderQueryResultsParserOutput::Solutions(TokioAsyncReaderSolutionsParser {
                    variables: variables.into(),
                    solutions: TokioAsyncReaderSolutionsParserKind::Xml(Box::new(solutions)),
                    blank_nodes: BlankNodeScope::default(),
                }),
            },
            QueryResultsFormat::Json => match TokioAsyncReaderJsonQueryResultsParserOutput::read(TokioAsyncCharsetReader::new(reader, self.charset), self.rdf_version).await? {
                TokioAsyncReaderJsonQueryResultsParserOutput::Boolean(r) => TokioAsyncReaderQueryResultsParserOutput::Boolean(r),
                TokioAsyncReaderJsonQueryResultsParserOutput::Solutions {
                    solutions,
                    variables,
                } => TokioAsyncReaderQueryResultsParserOutput::Solutions(TokioAsyncReaderSolutionsParser {
                    variables: variables.into(),
                    solutions: TokioAsyncReaderSolutionsParserKind::Json(Box::new(solutions)),
                    blank_nodes: BlankNodeScope::default(),
                }),
            },
            QueryResultsFormat::Csv => return Err(QueryResultsSyntaxError::msg("CSV SPARQL results syntax is lossy and can't be parsed to a proper RDF representation").into()),
            QueryResultsFormat::Tsv => match TokioAsyncReaderTsvQueryResultsParserOutput::read(TokioAsyncCharsetReader::new(reader, self.charset)).await? {
                TokioAsyncReaderTsvQueryResultsParserOutput::Boolean(r) => TokioAsyncReaderQueryResultsParserOutput::Boolean(r),
                TokioAsyncReaderTsvQueryResultsParserOutput::Solutions {
                    solutions,
                    variables,
                } => TokioAsyncReaderQueryResultsParserOutput::Solutions(TokioAsyncReaderSolutionsParser {
                    variables: variables.into(),
                    solutions: TokioAsyncReaderSolutionsParserKind::Tsv(solutions),
                    blank_nodes: BlankNodeScope::default(),
                }),
            },
        })
    }

    /// Reads a result file from a [`Read`] implementation.
    ///
    /// Reads are automatically buffered.
    ///
    /// Example in XML (the API is the same for JSON and TSV):
    /// ```
    /// use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};
    /// use oxrdf::{Literal, Variable};
    ///
    /// let xml_parser = QueryResultsParser::from_format(QueryResultsFormat::Xml);
    ///
    /// // boolean
    /// if let SliceQueryResultsParserOutput::Boolean(v) = xml_parser.clone().for_slice(r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head/><boolean>true</boolean></sparql>"#)? {
    ///     assert_eq!(v, true);
    /// }
    ///
    /// // solutions
    /// if let SliceQueryResultsParserOutput::Solutions(solutions) = xml_parser.for_slice(r#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="foo"/><variable name="bar"/></head><results><result><binding name="foo"><literal>test</literal></binding></result></results></sparql>"#)? {
    ///     assert_eq!(solutions.variables(), &[Variable::new("foo")?, Variable::new("bar")?]);
    ///     for solution in solutions {
    ///         assert_eq!(solution?.iter().collect::<Vec<_>>(), vec![(&Variable::new("foo")?, &Literal::from("test").into())]);
    ///     }
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    pub fn for_slice(
        self,
        slice: &(impl AsRef<[u8]> + ?Sized),
    ) -> Result<SliceQueryResultsParserOutput<'_>, QueryResultsSyntaxError> {
        let slice = slice.as_ref();
        validate_slice(slice, self.charset)?;
        Ok(match self.format {
            QueryResultsFormat::Xml => {
                match SliceXmlQueryResultsParserOutput::read(slice, self.rdf_version)? {
                    SliceXmlQueryResultsParserOutput::Boolean(r) => {
                        SliceQueryResultsParserOutput::Boolean(r)
                    }
                    SliceXmlQueryResultsParserOutput::Solutions {
                        solutions,
                        variables,
                    } => SliceQueryResultsParserOutput::Solutions(SliceSolutionsParser {
                        variables: variables.into(),
                        solutions: SliceSolutionsParserKind::Xml(Box::new(solutions)),
                        blank_nodes: BlankNodeScope::default(),
                    }),
                }
            }
            QueryResultsFormat::Json => {
                match SliceJsonQueryResultsParserOutput::read(slice, self.rdf_version)? {
                    SliceJsonQueryResultsParserOutput::Boolean(r) => {
                        SliceQueryResultsParserOutput::Boolean(r)
                    }
                    SliceJsonQueryResultsParserOutput::Solutions {
                        solutions,
                        variables,
                    } => SliceQueryResultsParserOutput::Solutions(SliceSolutionsParser {
                        variables: variables.into(),
                        solutions: SliceSolutionsParserKind::Json(Box::new(solutions)),
                        blank_nodes: BlankNodeScope::default(),
                    }),
                }
            }
            QueryResultsFormat::Csv => {
                return Err(QueryResultsSyntaxError::msg(
                    "CSV SPARQL results syntax is lossy and can't be parsed to a proper RDF representation",
                ));
            }
            QueryResultsFormat::Tsv => match SliceTsvQueryResultsParserOutput::read(slice)? {
                SliceTsvQueryResultsParserOutput::Boolean(r) => {
                    SliceQueryResultsParserOutput::Boolean(r)
                }
                SliceTsvQueryResultsParserOutput::Solutions {
                    solutions,
                    variables,
                } => SliceQueryResultsParserOutput::Solutions(SliceSolutionsParser {
                    variables: variables.into(),
                    solutions: SliceSolutionsParserKind::Tsv(solutions),
                    blank_nodes: BlankNodeScope::default(),
                }),
            },
        })
    }
}

impl From<QueryResultsFormat> for QueryResultsParser {
    fn from(format: QueryResultsFormat) -> Self {
        Self::from_format(format)
    }
}

/// The reader for a given read of a results file.
///
/// It is either a read boolean ([`bool`]) or a streaming reader of a set of solutions ([`ReaderSolutionsParser`]).
///
/// Example in TSV (the API is the same for JSON and XML):
/// ```
/// use oxrdf::{Literal, Variable};
/// use sparesults::{QueryResultsFormat, QueryResultsParser, ReaderQueryResultsParserOutput};
///
/// let tsv_parser = QueryResultsParser::from_format(QueryResultsFormat::Tsv);
///
/// // boolean
/// if let ReaderQueryResultsParserOutput::Boolean(v) =
///     tsv_parser.clone().for_reader("true".as_bytes())?
/// {
///     assert_eq!(v, true);
/// }
///
/// // solutions
/// if let ReaderQueryResultsParserOutput::Solutions(solutions) =
///     tsv_parser.for_reader("?foo\t?bar\n\"test\"\t".as_bytes())?
/// {
///     assert_eq!(
///         solutions.variables(),
///         &[Variable::new("foo")?, Variable::new("bar")?]
///     );
///     for solution in solutions {
///         assert_eq!(
///             solution?.iter().collect::<Vec<_>>(),
///             vec![(&Variable::new("foo")?, &Literal::from("test").into())]
///         );
///     }
/// }
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
pub enum ReaderQueryResultsParserOutput<R: Read> {
    Solutions(ReaderSolutionsParser<R>),
    Boolean(bool),
}

/// A streaming parser of a set of [`QuerySolution`] solutions.
///
/// It implements the [`Iterator`] API to iterate over the solutions.
///
/// Example in JSON (the API is the same for XML and TSV):
/// ```
/// use sparesults::{QueryResultsFormat, QueryResultsParser, ReaderQueryResultsParserOutput};
/// use oxrdf::{Literal, Variable};
///
/// let json_parser = QueryResultsParser::from_format(QueryResultsFormat::Json);
/// if let ReaderQueryResultsParserOutput::Solutions(solutions) = json_parser.for_reader(br#"{"head":{"vars":["foo","bar"]},"results":{"bindings":[{"foo":{"type":"literal","value":"test"}}]}}"#.as_slice())? {
///     assert_eq!(solutions.variables(), &[Variable::new("foo")?, Variable::new("bar")?]);
///     for solution in solutions {
///         assert_eq!(solution?.iter().collect::<Vec<_>>(), vec![(&Variable::new("foo")?, &Literal::from("test").into())]);
///     }
/// }
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
pub struct ReaderSolutionsParser<R: Read> {
    variables: Arc<[Variable]>,
    solutions: ReaderSolutionsParserKind<R>,
    blank_nodes: BlankNodeScope,
}

enum ReaderSolutionsParserKind<R: Read> {
    Xml(Box<ReaderXmlSolutionsParser<CharsetReader<R>>>),
    Json(Box<ReaderJsonSolutionsParser<CharsetReader<R>>>),
    Tsv(ReaderTsvSolutionsParser<CharsetReader<R>>),
}

impl<R: Read> ReaderSolutionsParser<R> {
    /// Ordered list of the declared variables at the beginning of the results.
    ///
    /// Example in TSV (the API is the same for JSON and XML):
    /// ```
    /// use oxrdf::Variable;
    /// use sparesults::{QueryResultsFormat, QueryResultsParser, ReaderQueryResultsParserOutput};
    ///
    /// let tsv_parser = QueryResultsParser::from_format(QueryResultsFormat::Tsv);
    /// if let ReaderQueryResultsParserOutput::Solutions(solutions) =
    ///     tsv_parser.for_reader(b"?foo\t?bar\n\"ex1\"\t\"ex2\"".as_slice())?
    /// {
    ///     assert_eq!(
    ///         solutions.variables(),
    ///         &[Variable::new("foo")?, Variable::new("bar")?]
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn variables(&self) -> &[Variable] {
        &self.variables
    }
}

impl<R: Read> Iterator for ReaderSolutionsParser<R> {
    type Item = Result<QuerySolution, QueryResultsParseError>;

    fn next(&mut self) -> Option<Self::Item> {
        Some(
            match &mut self.solutions {
                ReaderSolutionsParserKind::Xml(reader) => reader.parse_next(),
                ReaderSolutionsParserKind::Json(reader) => reader.parse_next(),
                ReaderSolutionsParserKind::Tsv(reader) => reader.parse_next(),
            }
            .transpose()?
            .map(|values| {
                (
                    Arc::clone(&self.variables),
                    self.blank_nodes.scope_values(values),
                )
                    .into()
            }),
        )
    }
}

/// The reader for a given read of a results file.
///
/// It is either a read boolean ([`bool`]) or a streaming reader of a set of solutions ([`ReaderSolutionsParser`]).
///
/// Example in TSV (the API is the same for JSON and XML):
/// ```
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
/// use oxrdf::{Literal, Variable};
/// use sparesults::{
///     QueryResultsFormat, QueryResultsParser, TokioAsyncReaderQueryResultsParserOutput,
/// };
///
/// let tsv_parser = QueryResultsParser::from_format(QueryResultsFormat::Tsv);
///
/// // boolean
/// if let TokioAsyncReaderQueryResultsParserOutput::Boolean(v) = tsv_parser
///     .clone()
///     .for_tokio_async_reader(b"true".as_slice())
///     .await?
/// {
///     assert_eq!(v, true);
/// }
///
/// // solutions
/// if let TokioAsyncReaderQueryResultsParserOutput::Solutions(mut solutions) = tsv_parser
///     .for_tokio_async_reader(b"?foo\t?bar\n\"test\"\t".as_slice())
///     .await?
/// {
///     assert_eq!(
///         solutions.variables(),
///         &[Variable::new("foo")?, Variable::new("bar")?]
///     );
///     while let Some(solution) = solutions.next().await {
///         assert_eq!(
///             solution?.iter().collect::<Vec<_>>(),
///             vec![(&Variable::new("foo")?, &Literal::from("test").into())]
///         );
///     }
/// }
/// # Ok(())
/// # }
/// ```
#[cfg(feature = "async-tokio")]
pub enum TokioAsyncReaderQueryResultsParserOutput<R: AsyncRead + Unpin> {
    Solutions(TokioAsyncReaderSolutionsParser<R>),
    Boolean(bool),
}

/// A streaming parser of a set of [`QuerySolution`] solutions.
///
/// It implements the [`Iterator`] API to iterate over the solutions.
///
/// Example in JSON (the API is the same for XML and TSV):
/// ```
/// # #[tokio::main(flavor = "current_thread")]
/// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
/// use sparesults::{QueryResultsFormat, QueryResultsParser, TokioAsyncReaderQueryResultsParserOutput};
/// use oxrdf::{Literal, Variable};
///
/// let json_parser = QueryResultsParser::from_format(QueryResultsFormat::Json);
/// if let TokioAsyncReaderQueryResultsParserOutput::Solutions(mut solutions) = json_parser.for_tokio_async_reader(br#"{"head":{"vars":["foo","bar"]},"results":{"bindings":[{"foo":{"type":"literal","value":"test"}}]}}"#.as_slice()).await? {
///     assert_eq!(solutions.variables(), &[Variable::new("foo")?, Variable::new("bar")?]);
///     while let Some(solution) = solutions.next().await {
///         assert_eq!(solution?.iter().collect::<Vec<_>>(), vec![(&Variable::new("foo")?, &Literal::from("test").into())]);
///     }
/// }
/// # Ok(())
/// # }
/// ```
#[cfg(feature = "async-tokio")]
pub struct TokioAsyncReaderSolutionsParser<R: AsyncRead + Unpin> {
    variables: Arc<[Variable]>,
    solutions: TokioAsyncReaderSolutionsParserKind<R>,
    blank_nodes: BlankNodeScope,
}

#[cfg(feature = "async-tokio")]
enum TokioAsyncReaderSolutionsParserKind<R: AsyncRead + Unpin> {
    Json(Box<TokioAsyncReaderJsonSolutionsParser<TokioAsyncCharsetReader<R>>>),
    Xml(Box<TokioAsyncReaderXmlSolutionsParser<TokioAsyncCharsetReader<R>>>),
    Tsv(TokioAsyncReaderTsvSolutionsParser<TokioAsyncCharsetReader<R>>),
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> TokioAsyncReaderSolutionsParser<R> {
    /// Ordered list of the declared variables at the beginning of the results.
    ///
    /// Example in TSV (the API is the same for JSON and XML):
    /// ```
    /// # #[tokio::main(flavor = "current_thread")]
    /// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// use oxrdf::Variable;
    /// use sparesults::{
    ///     QueryResultsFormat, QueryResultsParser, TokioAsyncReaderQueryResultsParserOutput,
    /// };
    ///
    /// let tsv_parser = QueryResultsParser::from_format(QueryResultsFormat::Tsv);
    /// if let TokioAsyncReaderQueryResultsParserOutput::Solutions(solutions) = tsv_parser
    ///     .for_tokio_async_reader(b"?foo\t?bar\n\"ex1\"\t\"ex2\"".as_slice())
    ///     .await?
    /// {
    ///     assert_eq!(
    ///         solutions.variables(),
    ///         &[Variable::new("foo")?, Variable::new("bar")?]
    ///     );
    /// }
    /// # Ok(())
    /// # }
    /// ```
    #[inline]
    pub fn variables(&self) -> &[Variable] {
        &self.variables
    }

    /// Reads the next solution or returns `None` if the file is finished.
    pub async fn next(&mut self) -> Option<Result<QuerySolution, QueryResultsParseError>> {
        Some(
            match &mut self.solutions {
                TokioAsyncReaderSolutionsParserKind::Json(reader) => reader.parse_next().await,
                TokioAsyncReaderSolutionsParserKind::Xml(reader) => reader.parse_next().await,
                TokioAsyncReaderSolutionsParserKind::Tsv(reader) => reader.parse_next().await,
            }
            .transpose()?
            .map(|values| {
                (
                    Arc::clone(&self.variables),
                    self.blank_nodes.scope_values(values),
                )
                    .into()
            }),
        )
    }
}

/// The reader for a given read of a results file.
///
/// It is either a read boolean ([`bool`]) or a streaming reader of a set of solutions ([`SliceSolutionsParser`]).
///
/// Example in TSV (the API is the same for JSON and XML):
/// ```
/// use oxrdf::{Literal, Variable};
/// use sparesults::{QueryResultsFormat, QueryResultsParser, ReaderQueryResultsParserOutput};
///
/// let tsv_parser = QueryResultsParser::from_format(QueryResultsFormat::Tsv);
///
/// // boolean
/// if let ReaderQueryResultsParserOutput::Boolean(v) =
///     tsv_parser.clone().for_reader(b"true".as_slice())?
/// {
///     assert_eq!(v, true);
/// }
///
/// // solutions
/// if let ReaderQueryResultsParserOutput::Solutions(solutions) =
///     tsv_parser.for_reader(b"?foo\t?bar\n\"test\"\t".as_slice())?
/// {
///     assert_eq!(
///         solutions.variables(),
///         &[Variable::new("foo")?, Variable::new("bar")?]
///     );
///     for solution in solutions {
///         assert_eq!(
///             solution?.iter().collect::<Vec<_>>(),
///             vec![(&Variable::new("foo")?, &Literal::from("test").into())]
///         );
///     }
/// }
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
pub enum SliceQueryResultsParserOutput<'a> {
    Solutions(SliceSolutionsParser<'a>),
    Boolean(bool),
}

/// A streaming parser of a set of [`QuerySolution`] solutions.
///
/// It implements the [`Iterator`] API to iterate over the solutions.
///
/// Example in JSON (the API is the same for XML and TSV):
/// ```
/// use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};
/// use oxrdf::{Literal, Variable};
///
/// let json_parser = QueryResultsParser::from_format(QueryResultsFormat::Json);
/// if let SliceQueryResultsParserOutput::Solutions(solutions) = json_parser.for_slice(r#"{"head":{"vars":["foo","bar"]},"results":{"bindings":[{"foo":{"type":"literal","value":"test"}}]}}"#)? {
///     assert_eq!(solutions.variables(), &[Variable::new("foo")?, Variable::new("bar")?]);
///     for solution in solutions {
///         assert_eq!(solution?.iter().collect::<Vec<_>>(), vec![(&Variable::new("foo")?, &Literal::from("test").into())]);
///     }
/// }
/// # Result::<_, Box<dyn std::error::Error>>::Ok(())
/// ```
pub struct SliceSolutionsParser<'a> {
    variables: Arc<[Variable]>,
    solutions: SliceSolutionsParserKind<'a>,
    blank_nodes: BlankNodeScope,
}

enum SliceSolutionsParserKind<'a> {
    Xml(Box<SliceXmlSolutionsParser<'a>>),
    Json(Box<SliceJsonSolutionsParser<'a>>),
    Tsv(SliceTsvSolutionsParser<'a>),
}

impl SliceSolutionsParser<'_> {
    /// Ordered list of the declared variables at the beginning of the results.
    ///
    /// Example in TSV (the API is the same for JSON and XML):
    /// ```
    /// use oxrdf::Variable;
    /// use sparesults::{QueryResultsFormat, QueryResultsParser, SliceQueryResultsParserOutput};
    ///
    /// let tsv_parser = QueryResultsParser::from_format(QueryResultsFormat::Tsv);
    /// if let SliceQueryResultsParserOutput::Solutions(solutions) =
    ///     tsv_parser.for_slice("?foo\t?bar\n\"ex1\"\t\"ex2\"")?
    /// {
    ///     assert_eq!(
    ///         solutions.variables(),
    ///         &[Variable::new("foo")?, Variable::new("bar")?]
    ///     );
    /// }
    /// # Result::<_, Box<dyn std::error::Error>>::Ok(())
    /// ```
    #[inline]
    pub fn variables(&self) -> &[Variable] {
        &self.variables
    }
}

impl Iterator for SliceSolutionsParser<'_> {
    type Item = Result<QuerySolution, QueryResultsSyntaxError>;

    fn next(&mut self) -> Option<Self::Item> {
        Some(
            match &mut self.solutions {
                SliceSolutionsParserKind::Xml(reader) => reader.parse_next(),
                SliceSolutionsParserKind::Json(reader) => reader.parse_next(),
                SliceSolutionsParserKind::Tsv(reader) => reader.parse_next(),
            }
            .transpose()?
            .map(|values| {
                (
                    Arc::clone(&self.variables),
                    self.blank_nodes.scope_values(values),
                )
                    .into()
            }),
        )
    }
}

#[derive(Default)]
struct BlankNodeScope {
    mapping: HashMap<BlankNode, BlankNode>,
}

impl BlankNodeScope {
    fn scope_values(&mut self, values: Vec<Option<Term>>) -> Vec<Option<Term>> {
        values
            .into_iter()
            .map(|value| value.map(|value| self.scope_term(value)))
            .collect()
    }

    fn scope_term(&mut self, term: Term) -> Term {
        match term {
            Term::NamedNode(node) => node.into(),
            Term::BlankNode(node) => self.scope_blank_node(node).into(),
            Term::Literal(literal) => literal.into(),
            #[cfg(feature = "sparql-12")]
            Term::Triple(triple) => {
                let oxrdf::Triple {
                    subject,
                    predicate,
                    object,
                } = *triple;
                oxrdf::Triple::new(
                    self.scope_named_or_blank_node(subject),
                    predicate,
                    self.scope_term(object),
                )
                .into()
            }
        }
    }

    fn scope_blank_node(&mut self, node: BlankNode) -> BlankNode {
        self.mapping.entry(node).or_default().clone()
    }

    #[cfg(feature = "sparql-12")]
    fn scope_named_or_blank_node(&mut self, node: NamedOrBlankNode) -> NamedOrBlankNode {
        match node {
            NamedOrBlankNode::NamedNode(node) => node.into(),
            NamedOrBlankNode::BlankNode(node) => self.scope_blank_node(node).into(),
        }
    }
}
