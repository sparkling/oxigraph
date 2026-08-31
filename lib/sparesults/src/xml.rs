//! Implementation of [SPARQL Query Results XML Format](https://www.w3.org/TR/rdf-sparql-XMLres/)

use crate::error::{QueryResultsParseError, QueryResultsSyntaxError};
use crate::version::{parse_results_version, results_version_label, validate_term_version};
use oxrdf::vocab::{rdf, xsd};
use oxrdf::*;
use oxstr::OxString;
use quick_xml::escape::{EscapeError, resolve_xml_entity};
use quick_xml::events::{BytesDecl, BytesEnd, BytesRef, BytesStart, BytesText, Event};
use quick_xml::name::{NamespaceResolver, QName, ResolveResult};
use quick_xml::reader::Config;
use quick_xml::{Error, NsReader, Writer, XmlVersion};
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{self, BufReader, Read, Write};
use std::mem::take;
#[cfg(feature = "async-tokio")]
use std::sync::Arc;
#[cfg(feature = "async-tokio")]
use tokio::io::{AsyncRead, AsyncWrite, BufReader as AsyncBufReader};

pub fn write_boolean_xml_result<W: Write>(
    writer: W,
    value: bool,
    version: Option<RdfVersion>,
) -> io::Result<W> {
    let mut writer = Writer::new(writer);
    for event in inner_write_boolean_xml_result(value, version) {
        writer.write_event(event)?;
    }
    Ok(writer.into_inner())
}

#[cfg(feature = "async-tokio")]
pub async fn tokio_async_write_boolean_xml_result<W: AsyncWrite + Unpin>(
    writer: W,
    value: bool,
    version: Option<RdfVersion>,
) -> io::Result<W> {
    let mut writer = Writer::new(writer);
    for event in inner_write_boolean_xml_result(value, version) {
        writer
            .write_event_async(event)
            .await
            .map_err(map_xml_error)?;
    }
    Ok(writer.into_inner())
}

fn inner_write_boolean_xml_result(value: bool, version: Option<RdfVersion>) -> Vec<Event<'static>> {
    vec![
        Event::Decl(BytesDecl::new("1.0", None, None)),
        Event::Start(sparql_start(version)),
        Event::Start(BytesStart::new("head")),
        Event::End(BytesEnd::new("head")),
        Event::Start(BytesStart::new("boolean")),
        Event::Text(BytesText::new(if value { "true" } else { "false" })),
        Event::End(BytesEnd::new("boolean")),
        Event::End(BytesEnd::new("sparql")),
    ]
}

fn sparql_start(version: Option<RdfVersion>) -> BytesStart<'static> {
    let mut start = BytesStart::new("sparql")
        .with_attributes([("xmlns", "http://www.w3.org/2005/sparql-results#")]);
    if let Some(version) = version.and_then(results_version_label) {
        start.push_attribute(("version", version));
    }
    start
}

pub struct WriterXmlSolutionsSerializer<W: Write> {
    inner: InnerXmlSolutionsSerializer,
    writer: Writer<W>,
}

impl<W: Write> WriterXmlSolutionsSerializer<W> {
    pub fn start(
        writer: W,
        variables: &[Variable],
        version: Option<RdfVersion>,
    ) -> io::Result<Self> {
        let mut writer = Writer::new(writer);
        let mut buffer = Vec::with_capacity(48);
        let inner = InnerXmlSolutionsSerializer::start(&mut buffer, variables, version);
        Self::do_write(&mut writer, buffer)?;
        Ok(Self { inner, writer })
    }

    pub fn serialize<'a>(
        &mut self,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) -> io::Result<()> {
        let mut buffer = Vec::with_capacity(48);
        self.inner.write(&mut buffer, solution);
        Self::do_write(&mut self.writer, buffer)
    }

    pub fn finish(mut self) -> io::Result<W> {
        let mut buffer = Vec::with_capacity(4);
        self.inner.finish(&mut buffer);
        Self::do_write(&mut self.writer, buffer)?;
        Ok(self.writer.into_inner())
    }

    fn do_write(writer: &mut Writer<W>, output: Vec<Event<'_>>) -> io::Result<()> {
        for event in output {
            writer.write_event(event)?;
        }
        Ok(())
    }
}

#[cfg(feature = "async-tokio")]
pub struct TokioAsyncWriterXmlSolutionsSerializer<W: AsyncWrite + Unpin> {
    inner: InnerXmlSolutionsSerializer,
    writer: Writer<W>,
}

#[cfg(feature = "async-tokio")]
impl<W: AsyncWrite + Unpin> TokioAsyncWriterXmlSolutionsSerializer<W> {
    pub async fn start(
        writer: W,
        variables: &[Variable],
        version: Option<RdfVersion>,
    ) -> io::Result<Self> {
        let mut writer = Writer::new(writer);
        let mut buffer = Vec::with_capacity(48);
        let inner = InnerXmlSolutionsSerializer::start(&mut buffer, variables, version);
        Self::do_write(&mut writer, buffer).await?;
        Ok(Self { inner, writer })
    }

    pub async fn serialize<'a>(
        &mut self,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) -> io::Result<()> {
        let mut buffer = Vec::with_capacity(48);
        self.inner.write(&mut buffer, solution);
        Self::do_write(&mut self.writer, buffer).await
    }

    pub async fn finish(mut self) -> io::Result<W> {
        let mut buffer = Vec::with_capacity(4);
        self.inner.finish(&mut buffer);
        Self::do_write(&mut self.writer, buffer).await?;
        Ok(self.writer.into_inner())
    }

    async fn do_write(writer: &mut Writer<W>, output: Vec<Event<'_>>) -> io::Result<()> {
        for event in output {
            writer
                .write_event_async(event)
                .await
                .map_err(map_xml_error)?;
        }
        Ok(())
    }
}

struct InnerXmlSolutionsSerializer;

impl InnerXmlSolutionsSerializer {
    fn start<'a>(
        output: &mut Vec<Event<'a>>,
        variables: &'a [Variable],
        version: Option<RdfVersion>,
    ) -> Self {
        output.push(Event::Decl(BytesDecl::new("1.0", None, None)));
        output.push(Event::Start(sparql_start(version)));
        output.push(Event::Start(BytesStart::new("head")));
        for variable in variables {
            output.push(Event::Empty(
                BytesStart::new("variable").with_attributes([("name", variable.as_str())]),
            ));
        }
        output.push(Event::End(BytesEnd::new("head")));
        output.push(Event::Start(BytesStart::new("results")));
        Self {}
    }

    #[expect(clippy::unused_self)]
    fn write<'a>(
        &self,
        output: &mut Vec<Event<'a>>,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) {
        output.push(Event::Start(BytesStart::new("result")));
        for (variable, value) in solution {
            output.push(Event::Start(
                BytesStart::new("binding").with_attributes([("name", variable.as_str())]),
            ));
            write_xml_term(output, value);
            output.push(Event::End(BytesEnd::new("binding")));
        }
        output.push(Event::End(BytesEnd::new("result")));
    }

    #[expect(clippy::unused_self)]
    fn finish(self, output: &mut Vec<Event<'_>>) {
        output.push(Event::End(BytesEnd::new("results")));
        output.push(Event::End(BytesEnd::new("sparql")));
    }
}

fn write_xml_term<'a>(output: &mut Vec<Event<'a>>, term: &'a Term) {
    match term {
        Term::NamedNode(uri) => write_xml_named_node(output, uri),
        Term::BlankNode(bnode) => write_xml_blank_node(output, bnode),
        Term::Literal(literal) => {
            let mut start = BytesStart::new("literal");
            if let Some(language) = literal.language() {
                start.push_attribute(("xml:lang", language));
                #[cfg(feature = "sparql-12")]
                if let Some(direction) = literal.direction() {
                    start.push_attribute((
                        "its:dir",
                        match direction {
                            BaseDirection::Ltr => "ltr",
                            BaseDirection::Rtl => "rtl",
                        },
                    ));
                    // TODO: put it in the root?
                    start.push_attribute(("xmlns:its", "http://www.w3.org/2005/11/its"));
                    start.push_attribute(("its:version", "2.0"));
                }
            } else if *literal.datatype() != xsd::STRING {
                start.push_attribute(("datatype", literal.datatype().as_str()))
            }
            output.push(Event::Start(start));
            output.push(Event::Text(BytesText::from_escaped(
                escape_including_bound_whitespaces(literal.value()),
            )));
            output.push(Event::End(BytesEnd::new("literal")));
        }
        #[cfg(feature = "sparql-12")]
        Term::Triple(triple) => {
            output.push(Event::Start(BytesStart::new("triple")));
            output.push(Event::Start(BytesStart::new("subject")));
            match &triple.subject {
                NamedOrBlankNode::NamedNode(uri) => write_xml_named_node(output, uri),
                NamedOrBlankNode::BlankNode(bnode) => write_xml_blank_node(output, bnode),
            }
            output.push(Event::End(BytesEnd::new("subject")));
            output.push(Event::Start(BytesStart::new("predicate")));
            write_xml_named_node(output, &triple.predicate);
            output.push(Event::End(BytesEnd::new("predicate")));
            output.push(Event::Start(BytesStart::new("object")));
            write_xml_term(output, &triple.object);
            output.push(Event::End(BytesEnd::new("object")));
            output.push(Event::End(BytesEnd::new("triple")));
        }
    }
}

fn write_xml_named_node<'a>(output: &mut Vec<Event<'a>>, uri: &'a NamedNode) {
    output.push(Event::Start(BytesStart::new("uri")));
    output.push(Event::Text(BytesText::new(uri.as_str())));
    output.push(Event::End(BytesEnd::new("uri")));
}

fn write_xml_blank_node<'a>(output: &mut Vec<Event<'a>>, bnode: &'a BlankNode) {
    output.push(Event::Start(BytesStart::new("bnode")));
    output.push(Event::Text(BytesText::new(bnode.as_str())));
    output.push(Event::End(BytesEnd::new("bnode")));
}

#[expect(clippy::large_enum_variant)]
pub enum ReaderXmlQueryResultsParserOutput<R: Read> {
    Solutions {
        variables: Vec<Variable>,
        solutions: ReaderXmlSolutionsParser<R>,
    },
    Boolean(bool),
}

impl<R: Read> ReaderXmlQueryResultsParserOutput<R> {
    pub fn read(reader: R, version: Option<RdfVersion>) -> Result<Self, QueryResultsParseError> {
        let mut reader = NsReader::from_reader(BufReader::new(reader));
        XmlInnerQueryResultsParser::set_options(reader.config_mut());
        let mut reader_buffer = Vec::new();
        let mut inner = XmlInnerQueryResultsParser {
            state: ResultsState::Start,
            variables: Vec::new(),
            text_buffer: String::new(),
            xml_version: XmlVersion::Implicit1_0,
            results_version: version,
            links_started: false,
            boolean: None,
        };
        loop {
            reader_buffer.clear();
            let event = reader.read_event_into(&mut reader_buffer)?;
            validate_sparql_element_namespace(&event, reader.resolver())?;
            if let Some(result) = inner.read_event(event, reader.resolver())? {
                return Ok(match result {
                    XmlInnerQueryResults::Solutions {
                        variables,
                        solutions,
                    } => Self::Solutions {
                        variables,
                        solutions: ReaderXmlSolutionsParser {
                            reader,
                            inner: solutions,
                            reader_buffer,
                        },
                    },
                    XmlInnerQueryResults::Boolean(value) => Self::Boolean(value),
                });
            }
        }
    }
}

pub struct ReaderXmlSolutionsParser<R: Read> {
    reader: NsReader<BufReader<R>>,
    inner: XmlInnerSolutionsParser,
    reader_buffer: Vec<u8>,
}

impl<R: Read> ReaderXmlSolutionsParser<R> {
    pub fn parse_next(&mut self) -> Result<Option<Vec<Option<Term>>>, QueryResultsParseError> {
        if self.inner.is_done() {
            return Ok(None);
        }
        loop {
            self.reader_buffer.clear();
            let event = self.reader.read_event_into(&mut self.reader_buffer)?;
            validate_sparql_element_namespace(&event, self.reader.resolver())?;
            if let Some(solution) = self.inner.read_event(event, self.reader.resolver())? {
                return Ok(Some(solution));
            }
            if self.inner.is_done() {
                return Ok(None);
            }
        }
    }
}

#[cfg(feature = "async-tokio")]
#[expect(clippy::large_enum_variant)]
pub enum TokioAsyncReaderXmlQueryResultsParserOutput<R: AsyncRead + Unpin> {
    Solutions {
        variables: Vec<Variable>,
        solutions: TokioAsyncReaderXmlSolutionsParser<R>,
    },
    Boolean(bool),
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> TokioAsyncReaderXmlQueryResultsParserOutput<R> {
    pub async fn read(
        reader: R,
        version: Option<RdfVersion>,
    ) -> Result<Self, QueryResultsParseError> {
        let mut reader = NsReader::from_reader(AsyncBufReader::new(reader));
        XmlInnerQueryResultsParser::set_options(reader.config_mut());
        let mut reader_buffer = Vec::new();
        let mut inner = XmlInnerQueryResultsParser {
            state: ResultsState::Start,
            variables: Vec::new(),
            text_buffer: String::new(),
            xml_version: XmlVersion::Implicit1_0,
            results_version: version,
            links_started: false,
            boolean: None,
        };
        loop {
            reader_buffer.clear();
            let event = reader.read_event_into_async(&mut reader_buffer).await?;
            validate_sparql_element_namespace(&event, reader.resolver())?;
            if let Some(result) = inner.read_event(event, reader.resolver())? {
                return Ok(match result {
                    XmlInnerQueryResults::Solutions {
                        variables,
                        solutions,
                    } => Self::Solutions {
                        variables,
                        solutions: TokioAsyncReaderXmlSolutionsParser {
                            reader,
                            inner: solutions,
                            reader_buffer,
                        },
                    },
                    XmlInnerQueryResults::Boolean(value) => Self::Boolean(value),
                });
            }
        }
    }
}

#[cfg(feature = "async-tokio")]
pub struct TokioAsyncReaderXmlSolutionsParser<R: AsyncRead + Unpin> {
    reader: NsReader<AsyncBufReader<R>>,
    inner: XmlInnerSolutionsParser,
    reader_buffer: Vec<u8>,
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> TokioAsyncReaderXmlSolutionsParser<R> {
    pub async fn parse_next(
        &mut self,
    ) -> Result<Option<Vec<Option<Term>>>, QueryResultsParseError> {
        if self.inner.is_done() {
            return Ok(None);
        }
        loop {
            self.reader_buffer.clear();
            let event = self
                .reader
                .read_event_into_async(&mut self.reader_buffer)
                .await?;
            validate_sparql_element_namespace(&event, self.reader.resolver())?;
            if let Some(solution) = self.inner.read_event(event, self.reader.resolver())? {
                return Ok(Some(solution));
            }
            if self.inner.is_done() {
                return Ok(None);
            }
        }
    }
}

#[expect(clippy::large_enum_variant)]
pub enum SliceXmlQueryResultsParserOutput<'a> {
    Solutions {
        variables: Vec<Variable>,
        solutions: SliceXmlSolutionsParser<'a>,
    },
    Boolean(bool),
}

impl<'a> SliceXmlQueryResultsParserOutput<'a> {
    pub fn read(
        slice: &'a [u8],
        version: Option<RdfVersion>,
    ) -> Result<Self, QueryResultsSyntaxError> {
        Self::do_read(slice, version).map_err(|e| match e {
            QueryResultsParseError::Syntax(e) => e,
            QueryResultsParseError::Io(e) => {
                unreachable!("I/O error are not possible for slice but found {e}")
            }
        })
    }

    fn do_read(
        slice: &'a [u8],
        version: Option<RdfVersion>,
    ) -> Result<Self, QueryResultsParseError> {
        let mut reader = NsReader::from_reader(slice);
        XmlInnerQueryResultsParser::set_options(reader.config_mut());
        let mut reader_buffer = Vec::new();
        let mut inner = XmlInnerQueryResultsParser {
            state: ResultsState::Start,
            variables: Vec::new(),
            text_buffer: String::new(),
            xml_version: XmlVersion::Implicit1_0,
            results_version: version,
            links_started: false,
            boolean: None,
        };
        loop {
            reader_buffer.clear();
            let event = reader.read_event_into(&mut reader_buffer)?;
            validate_sparql_element_namespace(&event, reader.resolver())?;
            if let Some(result) = inner.read_event(event, reader.resolver())? {
                return Ok(match result {
                    XmlInnerQueryResults::Solutions {
                        variables,
                        solutions,
                    } => Self::Solutions {
                        variables,
                        solutions: SliceXmlSolutionsParser {
                            reader,
                            inner: solutions,
                            reader_buffer,
                        },
                    },
                    XmlInnerQueryResults::Boolean(value) => Self::Boolean(value),
                });
            }
        }
    }
}

pub struct SliceXmlSolutionsParser<'a> {
    reader: NsReader<&'a [u8]>,
    inner: XmlInnerSolutionsParser,
    reader_buffer: Vec<u8>,
}

impl SliceXmlSolutionsParser<'_> {
    pub fn parse_next(&mut self) -> Result<Option<Vec<Option<Term>>>, QueryResultsSyntaxError> {
        self.do_parse_next().map_err(|e| match e {
            QueryResultsParseError::Syntax(e) => e,
            QueryResultsParseError::Io(e) => {
                unreachable!("I/O error are not possible for slice but found {e}")
            }
        })
    }

    fn do_parse_next(&mut self) -> Result<Option<Vec<Option<Term>>>, QueryResultsParseError> {
        if self.inner.is_done() {
            return Ok(None);
        }
        loop {
            self.reader_buffer.clear();
            let event = self.reader.read_event_into(&mut self.reader_buffer)?;
            validate_sparql_element_namespace(&event, self.reader.resolver())?;
            if let Some(solution) = self.inner.read_event(event, self.reader.resolver())? {
                return Ok(Some(solution));
            }
            if self.inner.is_done() {
                return Ok(None);
            }
        }
    }
}

#[expect(clippy::allow_attributes)]
#[allow(clippy::large_enum_variant)]
enum XmlInnerQueryResults {
    Solutions {
        variables: Vec<Variable>,
        solutions: XmlInnerSolutionsParser,
    },
    Boolean(bool),
}

#[derive(Clone, Copy)]
enum ResultsState {
    Start,
    Sparql,
    Head,
    Variable,
    Link,
    AfterHead,
    Boolean,
    AfterBoolean,
    AfterRoot,
}

struct XmlInnerQueryResultsParser {
    state: ResultsState,
    variables: Vec<Variable>,
    text_buffer: String,
    xml_version: XmlVersion,
    results_version: Option<RdfVersion>,
    links_started: bool,
    boolean: Option<bool>,
}

impl XmlInnerQueryResultsParser {
    fn set_options(config: &mut Config) {
        config.expand_empty_elements = true;
    }

    pub fn read_event(
        &mut self,
        event: Event<'_>,
        namespaces: &NamespaceResolver,
    ) -> Result<Option<XmlInnerQueryResults>, QueryResultsParseError> {
        match event {
            Event::Start(event) => {
                require_xml_whitespace(
                    &take(&mut self.text_buffer),
                    "between structural elements",
                )?;
                match self.state {
                    ResultsState::Start => {
                        expect_xml_element(&event, "sparql")?;
                        self.results_version = validate_root_attributes(
                            &event,
                            namespaces,
                            self.xml_version,
                            self.results_version,
                        )?;
                        self.state = ResultsState::Sparql;
                        Ok(None)
                    }
                    ResultsState::Sparql => {
                        expect_xml_element(&event, "head")?;
                        validate_no_element_attributes(&event, namespaces, "head")?;
                        self.state = ResultsState::Head;
                        Ok(None)
                    }
                    ResultsState::Head => {
                        if event.local_name().into_inner() == "variable" {
                            if self.links_started {
                                return Err(QueryResultsSyntaxError::msg(
                                    "<variable> elements must precede <link> elements",
                                )
                                .into());
                            }
                            let name = required_unbound_attribute(
                                &event,
                                namespaces,
                                "name",
                                "variable",
                                self.xml_version,
                            )?;
                            let variable = Variable::new(name).map_err(|error| {
                                QueryResultsSyntaxError::msg(format!(
                                    "Invalid variable name: {error}"
                                ))
                            })?;
                            if self.variables.contains(&variable) {
                                return Err(QueryResultsSyntaxError::msg(format!(
                                    "The variable {variable} is declared twice"
                                ))
                                .into());
                            }
                            self.variables.push(variable);
                            self.state = ResultsState::Variable;
                            Ok(None)
                        } else if event.local_name().into_inner() == "link" {
                            self.links_started = true;
                            let href = required_unbound_attribute(
                                &event,
                                namespaces,
                                "href",
                                "link",
                                self.xml_version,
                            )?;
                            validate_iri_reference(&href)?;
                            self.state = ResultsState::Link;
                            Ok(None)
                        } else {
                            Err(QueryResultsSyntaxError::msg(format!(
                                "Expecting <variable> or <link>, found <{}>",
                                event.name().into_inner()
                            ))
                            .into())
                        }
                    }
                    ResultsState::AfterHead => {
                        if event.local_name().into_inner() == "boolean" {
                            if !self.variables.is_empty() {
                                return Err(QueryResultsSyntaxError::msg(
                                    "A boolean result head must not declare variables",
                                )
                                .into());
                            }
                            validate_no_element_attributes(&event, namespaces, "boolean")?;
                            self.state = ResultsState::Boolean;
                            Ok(None)
                        } else if event.local_name().into_inner() == "results" {
                            validate_no_element_attributes(&event, namespaces, "results")?;
                            let mapping = self
                                .variables
                                .iter()
                                .enumerate()
                                .map(|(index, variable)| (variable.clone().into_string(), index))
                                .collect();
                            Ok(Some(XmlInnerQueryResults::Solutions {
                                variables: take(&mut self.variables),
                                solutions: XmlInnerSolutionsParser {
                                    mapping,
                                    state_stack: vec![State::Document, State::Results],
                                    new_bindings: Vec::new(),
                                    current_var: None,
                                    term: None,
                                    lang: None,
                                    #[cfg(feature = "sparql-12")]
                                    direction: None,
                                    datatype: None,
                                    subject_stack: Vec::new(),
                                    predicate_stack: Vec::new(),
                                    object_stack: Vec::new(),
                                    triple_state_stack: Vec::new(),
                                    text_buffer: String::new(),
                                    first_text_event_end: 0,
                                    last_text_event_start: None,
                                    xml_version: self.xml_version,
                                    results_version: self.results_version,
                                    finished: false,
                                },
                            }))
                        } else {
                            Err(QueryResultsSyntaxError::msg(format!(
                                "Expecting <results> or <boolean>, found <{}>",
                                event.name().into_inner()
                            ))
                            .into())
                        }
                    }
                    ResultsState::Variable
                    | ResultsState::Link
                    | ResultsState::Boolean
                    | ResultsState::AfterBoolean
                    | ResultsState::AfterRoot => Err(QueryResultsSyntaxError::msg(format!(
                        "Unexpected child element <{}>",
                        event.name().into_inner()
                    ))
                    .into()),
                }
            }
            Event::Text(event) => {
                self.text_buffer
                    .push_str(&event.xml_content(self.xml_version));
                Ok(None)
            }
            Event::GeneralRef(event) => {
                decode_xml_entity(&event, &mut self.text_buffer, self.xml_version)?;
                Ok(None)
            }
            Event::End(event) => {
                let value = take(&mut self.text_buffer);
                match self.state {
                    ResultsState::Variable => {
                        expect_xml_end(&event, "variable")?;
                        require_empty_xml_content(&value, "variable")?;
                        self.state = ResultsState::Head;
                        Ok(None)
                    }
                    ResultsState::Link => {
                        expect_xml_end(&event, "link")?;
                        require_empty_xml_content(&value, "link")?;
                        self.state = ResultsState::Head;
                        Ok(None)
                    }
                    ResultsState::Head => {
                        expect_xml_end(&event, "head")?;
                        require_xml_whitespace(&value, "inside head")?;
                        self.state = ResultsState::AfterHead;
                        Ok(None)
                    }
                    ResultsState::Boolean => {
                        expect_xml_end(&event, "boolean")?;
                        let value = value.trim_matches(|c| matches!(c, '\t' | '\n' | '\r' | ' '));
                        self.boolean = Some(match value {
                            "true" => true,
                            "false" => false,
                            _ => {
                                return Err(QueryResultsSyntaxError::msg(format!(
                                    "Unexpected boolean value '{value}'"
                                ))
                                .into());
                            }
                        });
                        self.state = ResultsState::AfterBoolean;
                        Ok(None)
                    }
                    ResultsState::AfterBoolean => {
                        expect_xml_end(&event, "sparql")?;
                        require_xml_whitespace(&value, "after boolean")?;
                        self.state = ResultsState::AfterRoot;
                        Ok(None)
                    }
                    _ => Err(QueryResultsSyntaxError::msg(format!(
                        "Unexpected closing element </{}>",
                        event.name().into_inner()
                    ))
                    .into()),
                }
            }
            Event::Eof => {
                if matches!(self.state, ResultsState::AfterRoot) {
                    require_xml_whitespace(&take(&mut self.text_buffer), "after sparql")?;
                    Ok(Some(XmlInnerQueryResults::Boolean(
                        self.boolean.ok_or_else(|| {
                            QueryResultsSyntaxError::msg("Missing boolean result")
                        })?,
                    )))
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "Unexpected end of SPARQL XML results before the document was complete",
                    )
                    .into())
                }
            }
            Event::Decl(event) => {
                if !matches!(self.state, ResultsState::Start) {
                    return Err(QueryResultsSyntaxError::msg(
                        "An XML declaration is only allowed before the document element",
                    )
                    .into());
                }
                self.xml_version = event.xml_version()?;
                Ok(None)
            }
            Event::Comment(_) | Event::PI(_) => Ok(None),
            Event::DocType(_) if matches!(self.state, ResultsState::Start) => Ok(None),
            Event::DocType(_) => Err(QueryResultsSyntaxError::msg(
                "A document type declaration is only allowed before the document element",
            )
            .into()),
            Event::Empty(_) => unreachable!("Empty events are expended"),
            Event::CData(event) => {
                self.text_buffer
                    .push_str(&event.xml_content(self.xml_version));
                Ok(None)
            }
        }
    }
}

enum State {
    Document,
    Results,
    Result,
    Binding,
    Uri,
    BNode,
    Literal,
    Triple,
    Subject,
    Predicate,
    Object,
}

struct XmlInnerSolutionsParser {
    mapping: HashMap<OxString, usize>,
    state_stack: Vec<State>,
    new_bindings: Vec<Option<Term>>,
    current_var: Option<OxString>,
    term: Option<Term>,
    lang: Option<OxString>,
    #[cfg(feature = "sparql-12")]
    direction: Option<BaseDirection>,
    datatype: Option<NamedNode>,
    subject_stack: Vec<Term>,
    predicate_stack: Vec<Term>,
    object_stack: Vec<Term>,
    triple_state_stack: Vec<u8>,
    text_buffer: String,
    first_text_event_end: usize,
    last_text_event_start: Option<usize>,
    xml_version: XmlVersion,
    results_version: Option<RdfVersion>,
    finished: bool,
}

impl XmlInnerSolutionsParser {
    fn take_boundary_trimmed_text(&mut self) -> String {
        let start = self.first_text_event_end
            - self.text_buffer[..self.first_text_event_end]
                .trim_start_matches(['\t', '\n', '\r', ' '])
                .len();
        let end = self
            .last_text_event_start
            .map_or(self.text_buffer.len(), |start| {
                start
                    + self.text_buffer[start..]
                        .trim_end_matches(['\t', '\n', '\r', ' '])
                        .len()
            });
        let text = take(&mut self.text_buffer);
        self.first_text_event_end = 0;
        self.last_text_event_start = None;
        text.get(start..end).unwrap_or_default().to_owned()
    }

    fn is_done(&self) -> bool {
        self.finished
    }

    pub fn read_event(
        &mut self,
        event: Event<'_>,
        namespaces: &NamespaceResolver,
    ) -> Result<Option<Vec<Option<Term>>>, QueryResultsParseError> {
        match event {
            Event::Start(event) => {
                require_xml_whitespace(
                    &self.take_boundary_trimmed_text(),
                    "between structural elements",
                )?;
                match self.state_stack.last().ok_or_else(|| {
                    QueryResultsSyntaxError::msg(
                        "Extra XML is not allowed at the end of the document",
                    )
                })? {
                    State::Document => Err(QueryResultsSyntaxError::msg(format!(
                        "Unexpected element <{}> after </results>",
                        event.name().into_inner()
                    ))
                    .into()),
                    State::Results => {
                        if event.local_name().into_inner() == "result" {
                            validate_no_element_attributes(&event, namespaces, "result")?;
                            self.new_bindings = vec![None; self.mapping.len()];
                            self.state_stack.push(State::Result);
                            Ok(None)
                        } else {
                            Err(QueryResultsSyntaxError::msg(format!(
                                "Expecting <result>, found <{}>",
                                event.name().into_inner()
                            ))
                            .into())
                        }
                    }
                    State::Result => {
                        if event.local_name().into_inner() == "binding" {
                            self.current_var = Some(required_unbound_attribute(
                                &event,
                                namespaces,
                                "name",
                                "binding",
                                self.xml_version,
                            )?);
                            self.state_stack.push(State::Binding);
                            Ok(None)
                        } else {
                            Err(QueryResultsSyntaxError::msg(format!(
                                "Expecting <binding>, found <{}>",
                                event.name().into_inner()
                            ))
                            .into())
                        }
                    }
                    State::Binding | State::Subject | State::Predicate | State::Object => {
                        if self.term.is_some() {
                            return Err(QueryResultsSyntaxError::msg(
                                "There is already a value for the current binding",
                            )
                            .into());
                        }
                        if event.local_name().into_inner() == "uri" {
                            validate_no_element_attributes(&event, namespaces, "uri")?;
                            self.state_stack.push(State::Uri);
                            Ok(None)
                        } else if event.local_name().into_inner() == "bnode" {
                            validate_no_element_attributes(&event, namespaces, "bnode")?;
                            self.state_stack.push(State::BNode);
                            Ok(None)
                        } else if event.local_name().into_inner() == "literal" {
                            let mut its_version_seen = false;
                            for attr in event.attributes() {
                                let attr = attr.map_err(Error::from)?;
                                if is_namespace_declaration(attr.key) {
                                    continue;
                                }
                                if is_xml_attribute(attr.key, namespaces, "lang") {
                                    if self.lang.is_some() {
                                        return Err(QueryResultsSyntaxError::msg(
                                            "Duplicate xml:lang attribute on <literal>",
                                        )
                                        .into());
                                    }
                                    self.lang = Some(OxString::new_owned(
                                        &attr.normalized_value(self.xml_version)?,
                                    ));
                                } else if is_unbound_attribute(attr.key, namespaces, "datatype") {
                                    if self.datatype.is_some() {
                                        return Err(QueryResultsSyntaxError::msg(
                                            "Duplicate datatype attribute on <literal>",
                                        )
                                        .into());
                                    }
                                    let iri = attr.normalized_value(self.xml_version)?;
                                    self.datatype = Some(
                                        NamedNode::new(OxString::new_owned(&iri)).map_err(|e| {
                                            QueryResultsSyntaxError::msg(format!(
                                                "Invalid datatype IRI '{iri}': {e}"
                                            ))
                                        })?,
                                    );
                                } else if is_its_attribute(attr.key, namespaces, "version") {
                                    if its_version_seen {
                                        return Err(QueryResultsSyntaxError::msg(
                                            "Duplicate its:version attribute on <literal>",
                                        )
                                        .into());
                                    }
                                    its_version_seen = true;
                                } else if is_its_direction(attr.key, namespaces) {
                                    #[cfg(feature = "sparql-12")]
                                    {
                                        if self.direction.is_some() {
                                            return Err(QueryResultsSyntaxError::msg(
                                                "Duplicate its:dir attribute on <literal>",
                                            )
                                            .into());
                                        }
                                        let value = attr.normalized_value(self.xml_version)?;
                                        self.direction = Some(match value.as_ref() {
                                            "ltr" => BaseDirection::Ltr,
                                            "rtl" => BaseDirection::Rtl,
                                            _ => {
                                                return Err(QueryResultsSyntaxError::msg(format!(
                                                "Invalid its:dir value '{value}', expecting 'ltr' or 'rtl'"
                                            )).into());
                                            }
                                        });
                                    }
                                    #[cfg(not(feature = "sparql-12"))]
                                    return Err(QueryResultsSyntaxError::msg(
                                        "The its:dir attribute requires SPARQL 1.2 support",
                                    )
                                    .into());
                                } else {
                                    return Err(
                                        unexpected_xml_attribute(attr.key, "literal").into()
                                    );
                                }
                            }
                            self.state_stack.push(State::Literal);
                            Ok(None)
                        } else if event.local_name().into_inner() == "triple" {
                            validate_no_element_attributes(&event, namespaces, "triple")?;
                            self.state_stack.push(State::Triple);
                            self.triple_state_stack.push(0);
                            Ok(None)
                        } else {
                            Err(QueryResultsSyntaxError::msg(format!(
                                "Expecting <uri>, <bnode> or <literal> found <{}>",
                                event.name().into_inner()
                            ))
                            .into())
                        }
                    }
                    State::Triple => {
                        let state = self.triple_state_stack.last_mut().ok_or_else(|| {
                            QueryResultsSyntaxError::msg("Missing triple parser state")
                        })?;
                        if *state == 0 && event.local_name().into_inner() == "subject" {
                            validate_no_element_attributes(&event, namespaces, "subject")?;
                            *state = 1;
                            self.state_stack.push(State::Subject);
                            Ok(None)
                        } else if *state == 1 && event.local_name().into_inner() == "predicate" {
                            validate_no_element_attributes(&event, namespaces, "predicate")?;
                            *state = 2;
                            self.state_stack.push(State::Predicate);
                            Ok(None)
                        } else if *state == 2 && event.local_name().into_inner() == "object" {
                            validate_no_element_attributes(&event, namespaces, "object")?;
                            *state = 3;
                            self.state_stack.push(State::Object);
                            Ok(None)
                        } else {
                            Err(QueryResultsSyntaxError::msg(format!(
                                "Triple components must appear exactly once in subject, predicate, object order; found <{}>",
                                event.name().into_inner()
                            ))
                            .into())
                        }
                    }
                    State::Uri => Err(QueryResultsSyntaxError::msg(format!(
                        "<uri> must only contain a string, found <{}>",
                        event.name().into_inner()
                    ))
                    .into()),
                    State::BNode => Err(QueryResultsSyntaxError::msg(format!(
                        "<bnode> must only contain a string, found <{}>",
                        event.name().into_inner()
                    ))
                    .into()),
                    State::Literal => Err(QueryResultsSyntaxError::msg(format!(
                        "<literal> must only contain a string, found <{}>",
                        event.name().into_inner()
                    ))
                    .into()),
                }
            }
            Event::Text(event) => {
                let value = event.xml_content(self.xml_version);
                if !value.is_empty() {
                    let start = self.text_buffer.len();
                    self.text_buffer.push_str(&value);
                    if start == 0 {
                        self.first_text_event_end = self.text_buffer.len();
                    }
                    self.last_text_event_start = Some(start);
                }
                Ok(None)
            }
            Event::End(event) => {
                let state = self.state_stack.pop().ok_or_else(|| {
                    QueryResultsSyntaxError::msg(
                        "Extra XML is not allowed at the end of the document",
                    )
                })?;
                let raw_value = self.take_boundary_trimmed_text();
                match state {
                    State::Document => {
                        expect_xml_end(&event, "sparql")?;
                        require_xml_whitespace(&raw_value, "after results")?;
                        Ok(None)
                    }
                    State::Results => {
                        expect_xml_end(&event, "results")?;
                        require_xml_whitespace(&raw_value, "inside results")?;
                        Ok(None)
                    }
                    State::Result => {
                        expect_xml_end(&event, "result")?;
                        require_xml_whitespace(&raw_value, "inside result")?;
                        Ok(Some(take(&mut self.new_bindings)))
                    }
                    State::Binding => {
                        expect_xml_end(&event, "binding")?;
                        require_xml_whitespace(&raw_value, "inside binding")?;
                        let variable = self.current_var.take().ok_or_else(|| {
                            QueryResultsSyntaxError::msg("No name found for <binding> tag")
                        })?;
                        let index = *self.mapping.get(variable.as_str()).ok_or_else(|| {
                            QueryResultsSyntaxError::msg(format!(
                                "The variable '{variable}' is used in a binding but not declared in the variables list"
                            ))
                        })?;
                        let term = self.term.take().ok_or_else(|| {
                            QueryResultsSyntaxError::msg(
                                "A <binding> must contain exactly one RDF term",
                            )
                        })?;
                        validate_term_version(&term, self.results_version)?;
                        if self.new_bindings[index].is_some() {
                            return Err(QueryResultsSyntaxError::msg(format!(
                                "The variable '{variable}' is bound more than once in one result"
                            ))
                            .into());
                        }
                        self.new_bindings[index] = Some(term);
                        Ok(None)
                    }
                    State::Subject => {
                        expect_xml_end(&event, "subject")?;
                        require_xml_whitespace(&raw_value, "inside subject")?;
                        self.subject_stack.push(self.term.take().ok_or_else(|| {
                            QueryResultsSyntaxError::msg(
                                "A <subject> must contain exactly one RDF term",
                            )
                        })?);
                        Ok(None)
                    }
                    State::Predicate => {
                        expect_xml_end(&event, "predicate")?;
                        require_xml_whitespace(&raw_value, "inside predicate")?;
                        self.predicate_stack.push(self.term.take().ok_or_else(|| {
                            QueryResultsSyntaxError::msg(
                                "A <predicate> must contain exactly one RDF term",
                            )
                        })?);
                        Ok(None)
                    }
                    State::Object => {
                        expect_xml_end(&event, "object")?;
                        require_xml_whitespace(&raw_value, "inside object")?;
                        self.object_stack.push(self.term.take().ok_or_else(|| {
                            QueryResultsSyntaxError::msg(
                                "An <object> must contain exactly one RDF term",
                            )
                        })?);
                        Ok(None)
                    }
                    State::Uri => {
                        expect_xml_end(&event, "uri")?;
                        let value = OxString::new_owned(&raw_value);
                        self.term = Some(
                            NamedNode::new(value.clone())
                                .map_err(|e| {
                                    QueryResultsSyntaxError::msg(format!(
                                        "Invalid IRI value '{value}': {e}"
                                    ))
                                })?
                                .into(),
                        );
                        Ok(None)
                    }
                    State::BNode => {
                        expect_xml_end(&event, "bnode")?;
                        let value = OxString::new_owned(&raw_value);
                        self.term = Some(
                            if value.is_empty() {
                                BlankNode::default()
                            } else {
                                BlankNode::new(value.clone()).map_err(|e| {
                                    QueryResultsSyntaxError::msg(format!(
                                        "Invalid blank node value '{value}': {e}"
                                    ))
                                })?
                            }
                            .into(),
                        );
                        Ok(None)
                    }
                    State::Literal => {
                        expect_xml_end(&event, "literal")?;
                        self.term = Some(
                            build_literal(
                                OxString::new_owned(&raw_value),
                                self.lang.take(),
                                #[cfg(feature = "sparql-12")]
                                self.direction.take(),
                                self.datatype.take(),
                            )?
                            .into(),
                        );
                        Ok(None)
                    }
                    State::Triple => {
                        expect_xml_end(&event, "triple")?;
                        require_xml_whitespace(&raw_value, "inside triple")?;
                        if self.triple_state_stack.pop() != Some(3) {
                            return Err(QueryResultsSyntaxError::msg(
                                "A <triple> must contain subject, predicate and object in order",
                            )
                            .into());
                        }
                        #[cfg(feature = "sparql-12")]
                        if let (Some(subject), Some(predicate), Some(object)) = (
                            self.subject_stack.pop(),
                            self.predicate_stack.pop(),
                            self.object_stack.pop(),
                        ) {
                            self.term = Some(
                                Triple::new(
                                    match subject {
                                        Term::NamedNode(subject) => NamedOrBlankNode::from(subject),
                                        Term::BlankNode(subject) => NamedOrBlankNode::from(subject),
                                        Term::Triple(_) => {
                                            return Err(QueryResultsSyntaxError::msg(
                                                "The <subject> value cannot be a <triple>",
                                            )
                                            .into());
                                        }
                                        Term::Literal(_) => {
                                            return Err(QueryResultsSyntaxError::msg(
                                                "The <subject> value cannot be a <literal>",
                                            )
                                            .into());
                                        }
                                    },
                                    if let Term::NamedNode(predicate) = predicate {
                                        predicate
                                    } else {
                                        return Err(QueryResultsSyntaxError::msg(
                                            "The <predicate> value must be an <uri>",
                                        )
                                        .into());
                                    },
                                    object,
                                )
                                .into(),
                            );
                            Ok(None)
                        } else {
                            Err(QueryResultsSyntaxError::msg(
                                "A <triple> must contain a <subject>, a <predicate> and an <object>",
                            )
                                .into())
                        }
                        #[cfg(not(feature = "sparql-12"))]
                        {
                            Err(QueryResultsSyntaxError::msg(
                                "The <triple> tag is only supported in RDF 1.2",
                            )
                            .into())
                        }
                    }
                }
            }
            Event::Decl(_) => Err(QueryResultsSyntaxError::msg(
                "An XML declaration is only allowed before the document element",
            )
            .into()),
            Event::Eof => {
                if self.state_stack.is_empty() {
                    require_xml_whitespace(&self.take_boundary_trimmed_text(), "after sparql")?;
                    self.finished = true;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "Unexpected end of SPARQL XML results before </results></sparql>",
                    )
                    .into())
                }
            }
            Event::Comment(_) | Event::PI(_) => Ok(None),
            Event::DocType(_) => Err(QueryResultsSyntaxError::msg(
                "A document type declaration is only allowed before the document element",
            )
            .into()),
            Event::GeneralRef(event) => {
                decode_xml_entity(&event, &mut self.text_buffer, self.xml_version)?;
                self.last_text_event_start = None;
                Ok(None)
            }
            Event::Empty(_) => unreachable!("Empty events are expended"),
            Event::CData(event) => {
                let value = event.xml_content(self.xml_version);
                if !value.is_empty() {
                    self.text_buffer.push_str(&value);
                    self.last_text_event_start = None;
                }
                Ok(None)
            }
        }
    }
}

fn validate_sparql_element_namespace(
    event: &Event<'_>,
    namespaces: &NamespaceResolver,
) -> Result<(), QueryResultsSyntaxError> {
    let name = match event {
        Event::Start(event) | Event::Empty(event) => event.name(),
        Event::End(event) => event.name(),
        _ => return Ok(()),
    };
    let (namespace, _) = namespaces.resolve_element(name);
    if matches!(
        namespace,
        ResolveResult::Bound(namespace)
            if namespace.as_ref() == "http://www.w3.org/2005/sparql-results#"
    ) {
        Ok(())
    } else {
        Err(QueryResultsSyntaxError::msg(
            "SPARQL XML result elements must use the SPARQL results namespace",
        ))
    }
}

fn expect_xml_element(
    event: &BytesStart<'_>,
    expected: &str,
) -> Result<(), QueryResultsSyntaxError> {
    if event.local_name().into_inner() == expected {
        Ok(())
    } else {
        Err(QueryResultsSyntaxError::msg(format!(
            "Expecting <{expected}>, found <{}>",
            event.name().into_inner()
        )))
    }
}

fn expect_xml_end(event: &BytesEnd<'_>, expected: &str) -> Result<(), QueryResultsSyntaxError> {
    if event.local_name().into_inner() == expected {
        Ok(())
    } else {
        Err(QueryResultsSyntaxError::msg(format!(
            "Expecting </{expected}>, found </{}>",
            event.name().into_inner()
        )))
    }
}

fn require_xml_whitespace(value: &str, context: &str) -> Result<(), QueryResultsSyntaxError> {
    if value
        .chars()
        .all(|character| matches!(character, '\t' | '\n' | '\r' | ' '))
    {
        Ok(())
    } else {
        Err(QueryResultsSyntaxError::msg(format!(
            "Unexpected text {context}: '{value}'"
        )))
    }
}

fn require_empty_xml_content(value: &str, element: &str) -> Result<(), QueryResultsSyntaxError> {
    if value.is_empty() {
        Ok(())
    } else {
        Err(QueryResultsSyntaxError::msg(format!(
            "<{element}> must be empty"
        )))
    }
}

fn validate_root_attributes(
    event: &BytesStart<'_>,
    namespaces: &NamespaceResolver,
    xml_version: XmlVersion,
    external_version: Option<RdfVersion>,
) -> Result<Option<RdfVersion>, QueryResultsParseError> {
    let mut its_version_seen = false;
    let mut inline_version = None;
    let mut schema_location_seen = false;
    let mut xml_base_seen = false;
    for attribute in event.attributes() {
        let attribute = attribute.map_err(Error::from)?;
        if is_namespace_declaration(attribute.key) {
            continue;
        }
        if is_unbound_attribute(attribute.key, namespaces, "version") {
            if inline_version.is_some() {
                return Err(QueryResultsSyntaxError::msg(
                    "Duplicate version attribute on <sparql>",
                )
                .into());
            }
            let value = attribute.normalized_value(xml_version)?;
            inline_version = Some(parse_results_version(&value)?);
        } else if is_its_attribute(attribute.key, namespaces, "version") {
            if its_version_seen {
                return Err(QueryResultsSyntaxError::msg(
                    "Duplicate its:version attribute on <sparql>",
                )
                .into());
            }
            its_version_seen = true;
        } else if is_xsi_attribute(attribute.key, namespaces, "schemaLocation") {
            if schema_location_seen {
                return Err(QueryResultsSyntaxError::msg(
                    "Duplicate xsi:schemaLocation attribute on <sparql>",
                )
                .into());
            }
            schema_location_seen = true;
        } else if is_xml_attribute(attribute.key, namespaces, "base") {
            if xml_base_seen {
                return Err(QueryResultsSyntaxError::msg(
                    "Duplicate xml:base attribute on <sparql>",
                )
                .into());
            }
            xml_base_seen = true;
            let value = attribute.normalized_value(xml_version)?;
            validate_iri_reference(&value)?;
        } else {
            return Err(unexpected_xml_attribute(attribute.key, "sparql").into());
        }
    }
    Ok(external_version.or(inline_version))
}

fn validate_no_element_attributes(
    event: &BytesStart<'_>,
    _namespaces: &NamespaceResolver,
    element: &str,
) -> Result<(), QueryResultsParseError> {
    for attribute in event.attributes() {
        let attribute = attribute.map_err(Error::from)?;
        if !is_namespace_declaration(attribute.key) {
            return Err(unexpected_xml_attribute(attribute.key, element).into());
        }
    }
    Ok(())
}

fn required_unbound_attribute(
    event: &BytesStart<'_>,
    namespaces: &NamespaceResolver,
    expected: &str,
    element: &str,
    xml_version: XmlVersion,
) -> Result<OxString, QueryResultsParseError> {
    let mut value = None;
    for attribute in event.attributes() {
        let attribute = attribute.map_err(Error::from)?;
        if is_namespace_declaration(attribute.key) {
            continue;
        }
        if is_unbound_attribute(attribute.key, namespaces, expected) {
            if value.is_some() {
                return Err(QueryResultsSyntaxError::msg(format!(
                    "Duplicate {expected} attribute on <{element}>"
                ))
                .into());
            }
            value = Some(OxString::new_owned(
                &attribute.normalized_value(xml_version)?,
            ));
        } else {
            return Err(unexpected_xml_attribute(attribute.key, element).into());
        }
    }
    value.ok_or_else(|| {
        QueryResultsSyntaxError::msg(format!("No {expected} attribute found for <{element}>"))
            .into()
    })
}

fn unexpected_xml_attribute(name: QName<'_>, element: &str) -> QueryResultsSyntaxError {
    QueryResultsSyntaxError::msg(format!(
        "Unexpected attribute '{}' on <{element}>",
        name.into_inner()
    ))
}

fn validate_iri_reference(value: &str) -> Result<(), QueryResultsSyntaxError> {
    if NamedNode::new(value.to_owned()).is_ok()
        || NamedNode::new(format!("https://example.invalid/{value}")).is_ok()
    {
        Ok(())
    } else {
        Err(QueryResultsSyntaxError::msg(format!(
            "Invalid IRI reference '{value}'"
        )))
    }
}

fn is_namespace_declaration(name: QName<'_>) -> bool {
    name.into_inner() == "xmlns" || name.into_inner().starts_with("xmlns:")
}

fn is_xml_attribute(
    name: QName<'_>,
    namespaces: &NamespaceResolver,
    expected_local_name: &str,
) -> bool {
    is_bound_attribute(
        name,
        namespaces,
        expected_local_name,
        "http://www.w3.org/XML/1998/namespace",
    )
}

fn is_its_attribute(
    name: QName<'_>,
    namespaces: &NamespaceResolver,
    expected_local_name: &str,
) -> bool {
    is_bound_attribute(
        name,
        namespaces,
        expected_local_name,
        "http://www.w3.org/2005/11/its",
    )
}

fn is_xsi_attribute(
    name: QName<'_>,
    namespaces: &NamespaceResolver,
    expected_local_name: &str,
) -> bool {
    is_bound_attribute(
        name,
        namespaces,
        expected_local_name,
        "http://www.w3.org/2001/XMLSchema-instance",
    )
}

fn is_bound_attribute(
    name: QName<'_>,
    namespaces: &NamespaceResolver,
    expected_local_name: &str,
    expected_namespace: &str,
) -> bool {
    let (namespace, local_name) = namespaces.resolve_attribute(name);
    local_name.into_inner() == expected_local_name
        && matches!(
            namespace,
            ResolveResult::Bound(namespace) if namespace.as_ref() == expected_namespace
        )
}

fn is_its_direction(name: QName<'_>, namespaces: &NamespaceResolver) -> bool {
    is_its_attribute(name, namespaces, "dir")
}

fn is_unbound_attribute(
    name: QName<'_>,
    namespaces: &NamespaceResolver,
    expected_local_name: &str,
) -> bool {
    let (namespace, local_name) = namespaces.resolve_attribute(name);
    local_name.into_inner() == expected_local_name && namespace == ResolveResult::Unbound
}

fn build_literal(
    value: OxString,
    lang: Option<OxString>,
    #[cfg(feature = "sparql-12")] direction: Option<BaseDirection>,
    datatype: Option<NamedNode>,
) -> Result<Literal, QueryResultsSyntaxError> {
    if let Some(lang) = lang {
        #[cfg(feature = "sparql-12")]
        if let Some(direction) = direction {
            if let Some(datatype) = datatype {
                if datatype.as_ref() != rdf::DIR_LANG_STRING {
                    return Err(QueryResultsSyntaxError::msg(format!(
                        "its:dir value '{direction}' provided with the datatype {datatype}"
                    )));
                }
            }
            return Literal::new_directional_language_tagged_literal(
                value,
                lang.clone(),
                direction,
            )
            .map_err(|e| {
                QueryResultsSyntaxError::msg(format!("Invalid xml:lang value '{lang}': {e}"))
            });
        }
        if let Some(datatype) = datatype {
            if datatype.as_ref() != rdf::LANG_STRING {
                return Err(QueryResultsSyntaxError::msg(format!(
                    "xml:lang value '{lang}' provided with the datatype {datatype}"
                )));
            }
        }
        Literal::new_language_tagged_literal(value, lang.clone()).map_err(|e| {
            QueryResultsSyntaxError::msg(format!("Invalid xml:lang value '{lang}': {e}"))
        })
    } else {
        #[cfg(feature = "sparql-12")]
        if direction.is_some() {
            return Err(QueryResultsSyntaxError::msg(
                "its:dir can only be present alongside xml:lang",
            ));
        }
        if let Some(datatype) = datatype {
            Literal::try_new_typed_literal(value, datatype)
                .map_err(|error| QueryResultsSyntaxError::msg(error.to_string()))
        } else {
            Ok(Literal::new_simple_literal(value))
        }
    }
}

/// Escapes characters to avoid parsing issues (<, >, &...) or normalization (\r, whitespace at the beginning or end...)
fn escape_including_bound_whitespaces(value: &str) -> Cow<'_, str> {
    let mut escaped = None;
    let mut previous_index = 0;
    let mut push_escaped = |escape: &'static str, c: char, i: usize| {
        let buf = escaped.get_or_insert_with(|| String::with_capacity(value.len()));
        buf.push_str(&value[previous_index..i]);
        buf.push_str(escape);
        previous_index = i + c.len_utf8();
    };

    for (i, c) in value.char_indices() {
        match c {
            '<' => push_escaped("&lt;", c, i),
            '>' => push_escaped("&gt;", c, i),
            '\'' => push_escaped("&apos;", c, i),
            '&' => push_escaped("&amp;", c, i),
            '"' => push_escaped("&quot;", c, i),
            '\r' => push_escaped("&#13;", c, i),
            '\u{85}' => push_escaped("&#133;", c, i),
            '\u{2028}' => push_escaped("&#8232;", c, i),
            '\t' if i == 0 || i == value.len() - 1 => push_escaped("&#9;", c, i),
            '\n' if i == 0 || i == value.len() - 1 => push_escaped("&#10;", c, i),
            ' ' if i == 0 || i == value.len() - 1 => push_escaped("&#32;", c, i),
            _ => (),
        }
    }
    if let Some(mut escaped) = escaped {
        escaped.push_str(&value[previous_index..]);
        escaped.into()
    } else {
        value.into()
    }
}

fn decode_xml_entity(
    event: &BytesRef<'_>,
    buffer: &mut String,
    xml_version: XmlVersion,
) -> Result<(), Error> {
    if let Some(char_ref) = event.resolve_char_ref()? {
        buffer.push(char_ref);
        return Ok(());
    }
    let reference = event.xml_content(xml_version);
    let Some(value) = resolve_xml_entity(&reference) else {
        return Err(EscapeError::UnrecognizedEntity(0..event.len(), reference.into()).into());
    };
    buffer.push_str(value);
    Ok(())
}

#[cfg(feature = "async-tokio")]
fn map_xml_error(error: Error) -> io::Error {
    match error {
        Error::Io(error) => {
            Arc::try_unwrap(error).unwrap_or_else(|error| io::Error::new(error.kind(), error))
        }
        _ => io::Error::new(io::ErrorKind::InvalidData, error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_single_term(input: &[u8]) -> Result<Term, QueryResultsSyntaxError> {
        let SliceXmlQueryResultsParserOutput::Solutions {
            variables,
            mut solutions,
        } = SliceXmlQueryResultsParserOutput::read(input, None)?
        else {
            return Err(QueryResultsSyntaxError::msg("Expected solutions"));
        };
        if variables.len() != 1 {
            return Err(QueryResultsSyntaxError::msg("Expected one variable"));
        }
        let row = solutions
            .parse_next()?
            .ok_or_else(|| QueryResultsSyntaxError::msg("Expected one solution"))?;
        let term = row
            .into_iter()
            .next()
            .flatten()
            .ok_or_else(|| QueryResultsSyntaxError::msg("Expected one bound term"))?;
        if solutions.parse_next()?.is_some() {
            return Err(QueryResultsSyntaxError::msg(
                "Expected exactly one solution",
            ));
        }
        Ok(term)
    }

    fn assert_single_term_error(input: &[u8]) -> Result<(), QueryResultsSyntaxError> {
        let SliceXmlQueryResultsParserOutput::Solutions { mut solutions, .. } =
            SliceXmlQueryResultsParserOutput::read(input, None)?
        else {
            return Err(QueryResultsSyntaxError::msg("Expected solutions"));
        };
        if solutions.parse_next().is_ok() {
            return Err(QueryResultsSyntaxError::msg(
                "Expected the RDF term to be rejected",
            ));
        }
        Ok(())
    }

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the assertion verifies the exact decoded literal while parser errors propagate"
    )]
    fn literal_boundary_whitespace_distinguishes_text_references_and_cdata()
    -> Result<(), QueryResultsSyntaxError> {
        let term = parse_single_term(
            br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="x"/></head><results><result><binding name="x"><literal> &#32;&#9;value&#10;&#32; <![CDATA[ cdata ]]></literal></binding></result></results></sparql>"#,
        )?;
        assert_eq!(term, Term::from(Literal::from(" \tvalue\n   cdata ")));
        Ok(())
    }

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        reason = "the assertion verifies the exact decoded literal while parser errors propagate"
    )]
    fn empty_cdata_does_not_preserve_ordinary_trailing_whitespace()
    -> Result<(), QueryResultsSyntaxError> {
        let term = parse_single_term(
            br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="x"/></head><results><result><binding name="x"><literal>value <![CDATA[]]></literal></binding></result></results></sparql>"#,
        )?;
        assert_eq!(term, Term::from(Literal::from("value")));
        Ok(())
    }

    #[test]
    fn uri_and_blank_node_boundary_whitespace_references_are_not_trimmed()
    -> Result<(), QueryResultsSyntaxError> {
        assert_single_term_error(
            br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="x"/></head><results><result><binding name="x"><uri>&#32;https://example.com/</uri></binding></result></results></sparql>"#,
        )?;
        assert_single_term_error(
            br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="x"/></head><results><result><binding name="x"><bnode>example&#32;</bnode></binding></result></results></sparql>"#,
        )?;
        Ok(())
    }

    #[test]
    fn uri_boundary_whitespace_in_cdata_is_not_trimmed() -> Result<(), QueryResultsSyntaxError> {
        assert_single_term_error(
            br#"<sparql xmlns="http://www.w3.org/2005/sparql-results#"><head><variable name="x"/></head><results><result><binding name="x"><uri><![CDATA[ https://example.com/]]></uri></binding></result></results></sparql>"#,
        )
    }
}
