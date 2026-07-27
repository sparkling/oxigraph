//! Implementation of [SPARQL Query Results JSON Format](https://www.w3.org/TR/sparql11-results-json/)

use crate::error::{QueryResultsParseError, QueryResultsSyntaxError};
use crate::version::{parse_results_version, results_version_label, validate_term_version};
use json_event_parser::{JsonEvent, ReaderJsonParser, SliceJsonParser, WriterJsonSerializer};
#[cfg(feature = "async-tokio")]
use json_event_parser::{TokioAsyncReaderJsonParser, TokioAsyncWriterJsonSerializer};
use oxrdf::vocab::{rdf, xsd};
use oxrdf::*;
use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Write};
use std::mem::take;
#[cfg(feature = "async-tokio")]
use tokio::io::{AsyncRead, AsyncWrite};

pub fn write_boolean_json_result<W: Write>(
    writer: W,
    value: bool,
    version: Option<RdfVersion>,
) -> io::Result<W> {
    let mut serializer = WriterJsonSerializer::new(writer);
    for event in inner_write_boolean_json_result(value, version) {
        serializer.serialize_event(event)?;
    }
    serializer.finish()
}

#[cfg(feature = "async-tokio")]
pub async fn tokio_async_write_boolean_json_result<W: AsyncWrite + Unpin>(
    writer: W,
    value: bool,
    version: Option<RdfVersion>,
) -> io::Result<W> {
    let mut serializer = TokioAsyncWriterJsonSerializer::new(writer);
    for event in inner_write_boolean_json_result(value, version) {
        serializer.serialize_event(event).await?;
    }
    serializer.finish()
}

fn inner_write_boolean_json_result(
    value: bool,
    _version: Option<RdfVersion>,
) -> Vec<JsonEvent<'static>> {
    vec![
        JsonEvent::StartObject,
        JsonEvent::ObjectKey("head".into()),
        JsonEvent::StartObject,
        JsonEvent::EndObject,
        JsonEvent::ObjectKey("boolean".into()),
        JsonEvent::Boolean(value),
        JsonEvent::EndObject,
    ]
}

pub struct WriterJsonSolutionsSerializer<W: Write> {
    inner: InnerJsonSolutionsSerializer,
    serializer: WriterJsonSerializer<W>,
}

impl<W: Write> WriterJsonSolutionsSerializer<W> {
    pub fn start(
        writer: W,
        variables: &[Variable],
        version: Option<RdfVersion>,
    ) -> io::Result<Self> {
        let mut serializer = WriterJsonSerializer::new(writer);
        let mut buffer = Vec::with_capacity(48);
        let inner = InnerJsonSolutionsSerializer::start(&mut buffer, variables, version);
        Self::do_write(&mut serializer, buffer)?;
        Ok(Self { inner, serializer })
    }

    pub fn serialize<'a>(
        &mut self,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) -> io::Result<()> {
        let mut buffer = Vec::with_capacity(48);
        self.inner.write(&mut buffer, solution);
        Self::do_write(&mut self.serializer, buffer)
    }

    pub fn finish(mut self) -> io::Result<W> {
        let mut buffer = Vec::with_capacity(4);
        self.inner.finish(&mut buffer);
        Self::do_write(&mut self.serializer, buffer)?;
        self.serializer.finish()
    }

    fn do_write(
        serializer: &mut WriterJsonSerializer<W>,
        output: Vec<JsonEvent<'_>>,
    ) -> io::Result<()> {
        for event in output {
            serializer.serialize_event(event)?;
        }
        Ok(())
    }
}

#[cfg(feature = "async-tokio")]
pub struct TokioAsyncWriterJsonSolutionsSerializer<W: AsyncWrite + Unpin> {
    inner: InnerJsonSolutionsSerializer,
    serializer: TokioAsyncWriterJsonSerializer<W>,
}

#[cfg(feature = "async-tokio")]
impl<W: AsyncWrite + Unpin> TokioAsyncWriterJsonSolutionsSerializer<W> {
    pub async fn start(
        writer: W,
        variables: &[Variable],
        version: Option<RdfVersion>,
    ) -> io::Result<Self> {
        let mut serializer = TokioAsyncWriterJsonSerializer::new(writer);
        let mut buffer = Vec::with_capacity(48);
        let inner = InnerJsonSolutionsSerializer::start(&mut buffer, variables, version);
        Self::do_write(&mut serializer, buffer).await?;
        Ok(Self { inner, serializer })
    }

    pub async fn serialize<'a>(
        &mut self,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) -> io::Result<()> {
        let mut buffer = Vec::with_capacity(48);
        self.inner.write(&mut buffer, solution);
        Self::do_write(&mut self.serializer, buffer).await
    }

    pub async fn finish(mut self) -> io::Result<W> {
        let mut buffer = Vec::with_capacity(4);
        self.inner.finish(&mut buffer);
        Self::do_write(&mut self.serializer, buffer).await?;
        self.serializer.finish()
    }

    async fn do_write(
        serializer: &mut TokioAsyncWriterJsonSerializer<W>,
        output: Vec<JsonEvent<'_>>,
    ) -> io::Result<()> {
        for event in output {
            serializer.serialize_event(event).await?;
        }
        Ok(())
    }
}

struct InnerJsonSolutionsSerializer;

impl InnerJsonSolutionsSerializer {
    fn start<'a>(
        output: &mut Vec<JsonEvent<'a>>,
        variables: &'a [Variable],
        version: Option<RdfVersion>,
    ) -> Self {
        output.push(JsonEvent::StartObject);
        output.push(JsonEvent::ObjectKey("head".into()));
        output.push(JsonEvent::StartObject);
        if let Some(version) = version.and_then(results_version_label) {
            output.push(JsonEvent::ObjectKey("version".into()));
            output.push(JsonEvent::String(version.into()));
        }
        output.push(JsonEvent::ObjectKey("vars".into()));
        output.push(JsonEvent::StartArray);
        for variable in variables {
            output.push(JsonEvent::String(variable.as_str().into()));
        }
        output.push(JsonEvent::EndArray);
        output.push(JsonEvent::EndObject);
        output.push(JsonEvent::ObjectKey("results".into()));
        output.push(JsonEvent::StartObject);
        output.push(JsonEvent::ObjectKey("bindings".into()));
        output.push(JsonEvent::StartArray);
        Self {}
    }

    #[expect(clippy::unused_self)]
    fn write<'a>(
        &self,
        output: &mut Vec<JsonEvent<'a>>,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) {
        output.push(JsonEvent::StartObject);
        for (variable, value) in solution {
            output.push(JsonEvent::ObjectKey(variable.as_str().into()));
            write_json_term(output, value);
        }
        output.push(JsonEvent::EndObject);
    }

    #[expect(clippy::unused_self)]
    fn finish(self, output: &mut Vec<JsonEvent<'_>>) {
        output.push(JsonEvent::EndArray);
        output.push(JsonEvent::EndObject);
        output.push(JsonEvent::EndObject);
    }
}

fn write_json_term<'a>(output: &mut Vec<JsonEvent<'a>>, term: &'a Term) {
    match term {
        Term::NamedNode(uri) => write_json_named_node(output, uri),
        Term::BlankNode(bnode) => write_json_blank_node(output, bnode),
        Term::Literal(literal) => {
            output.push(JsonEvent::StartObject);
            output.push(JsonEvent::ObjectKey("type".into()));
            output.push(JsonEvent::String("literal".into()));
            output.push(JsonEvent::ObjectKey("value".into()));
            output.push(JsonEvent::String(literal.value().into()));
            if let Some(language) = literal.language() {
                output.push(JsonEvent::ObjectKey("xml:lang".into()));
                output.push(JsonEvent::String(language.into()));
                #[cfg(feature = "sparql-12")]
                if let Some(direction) = literal.direction() {
                    output.push(JsonEvent::ObjectKey("its:dir".into()));
                    output.push(JsonEvent::String(
                        match direction {
                            BaseDirection::Ltr => "ltr",
                            BaseDirection::Rtl => "rtl",
                        }
                        .into(),
                    ));
                }
            } else if *literal.datatype() != xsd::STRING {
                output.push(JsonEvent::ObjectKey("datatype".into()));
                output.push(JsonEvent::String(literal.datatype().as_str().into()));
            }
            output.push(JsonEvent::EndObject);
        }
        #[cfg(feature = "sparql-12")]
        Term::Triple(triple) => {
            output.push(JsonEvent::StartObject);
            output.push(JsonEvent::ObjectKey("type".into()));
            output.push(JsonEvent::String("triple".into()));
            output.push(JsonEvent::ObjectKey("value".into()));
            output.push(JsonEvent::StartObject);
            output.push(JsonEvent::ObjectKey("subject".into()));
            match &triple.subject {
                NamedOrBlankNode::NamedNode(uri) => write_json_named_node(output, uri),
                NamedOrBlankNode::BlankNode(bnode) => write_json_blank_node(output, bnode),
            }
            output.push(JsonEvent::ObjectKey("predicate".into()));
            write_json_named_node(output, &triple.predicate);
            output.push(JsonEvent::ObjectKey("object".into()));
            write_json_term(output, &triple.object);
            output.push(JsonEvent::EndObject);
            output.push(JsonEvent::EndObject);
        }
    }
}
fn write_json_named_node<'a>(output: &mut Vec<JsonEvent<'a>>, uri: &'a NamedNode) {
    output.push(JsonEvent::StartObject);
    output.push(JsonEvent::ObjectKey("type".into()));
    output.push(JsonEvent::String("uri".into()));
    output.push(JsonEvent::ObjectKey("value".into()));
    output.push(JsonEvent::String(uri.as_str().into()));
    output.push(JsonEvent::EndObject);
}

fn write_json_blank_node<'a>(output: &mut Vec<JsonEvent<'a>>, bnode: &'a BlankNode) {
    output.push(JsonEvent::StartObject);
    output.push(JsonEvent::ObjectKey("type".into()));
    output.push(JsonEvent::String("bnode".into()));
    output.push(JsonEvent::ObjectKey("value".into()));
    output.push(JsonEvent::String(bnode.as_str().into()));
    output.push(JsonEvent::EndObject);
}

#[expect(clippy::allow_attributes)]
#[allow(clippy::large_enum_variant)]
pub enum ReaderJsonQueryResultsParserOutput<R: Read> {
    Solutions {
        variables: Vec<Variable>,
        solutions: ReaderJsonSolutionsParser<R>,
    },
    Boolean(bool),
}

impl<R: Read> ReaderJsonQueryResultsParserOutput<R> {
    pub fn read(reader: R, version: Option<RdfVersion>) -> Result<Self, QueryResultsParseError> {
        let mut json_parser = ReaderJsonParser::new(reader);
        let mut inner = JsonInnerReader::new(version);
        loop {
            if let Some(result) = inner.read_event(json_parser.parse_next()?)? {
                return match result {
                    JsonInnerQueryResults::Solutions {
                        variables,
                        solutions,
                    } => Ok(Self::Solutions {
                        variables,
                        solutions: ReaderJsonSolutionsParser {
                            inner: solutions,
                            json_parser,
                        },
                    }),
                    JsonInnerQueryResults::Boolean(value) => Ok(Self::Boolean(value)),
                };
            }
        }
    }
}

pub struct ReaderJsonSolutionsParser<R: Read> {
    inner: JsonInnerSolutions,
    json_parser: ReaderJsonParser<R>,
}

impl<R: Read> ReaderJsonSolutionsParser<R> {
    pub fn parse_next(&mut self) -> Result<Option<Vec<Option<Term>>>, QueryResultsParseError> {
        match &mut self.inner {
            JsonInnerSolutions::Reader(reader) => {
                if reader.is_done() {
                    return Ok(None);
                }
                loop {
                    if let Some(result) = reader.parse_event(self.json_parser.parse_next()?)? {
                        return Ok(Some(result));
                    }
                    if reader.is_done() {
                        return Ok(None);
                    }
                }
            }
            JsonInnerSolutions::Iterator(iter) => Ok(iter.next()),
        }
    }
}

#[cfg(feature = "async-tokio")]
#[expect(clippy::large_enum_variant)]
pub enum TokioAsyncReaderJsonQueryResultsParserOutput<R: AsyncRead + Unpin> {
    Solutions {
        variables: Vec<Variable>,
        solutions: TokioAsyncReaderJsonSolutionsParser<R>,
    },
    Boolean(bool),
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> TokioAsyncReaderJsonQueryResultsParserOutput<R> {
    pub async fn read(
        reader: R,
        version: Option<RdfVersion>,
    ) -> Result<Self, QueryResultsParseError> {
        let mut json_parser = TokioAsyncReaderJsonParser::new(reader);
        let mut inner = JsonInnerReader::new(version);
        loop {
            if let Some(result) = inner.read_event(json_parser.parse_next().await?)? {
                return match result {
                    JsonInnerQueryResults::Solutions {
                        variables,
                        solutions,
                    } => Ok(Self::Solutions {
                        variables,
                        solutions: TokioAsyncReaderJsonSolutionsParser {
                            inner: solutions,
                            json_parser,
                        },
                    }),
                    JsonInnerQueryResults::Boolean(value) => Ok(Self::Boolean(value)),
                };
            }
        }
    }
}

#[cfg(feature = "async-tokio")]
pub struct TokioAsyncReaderJsonSolutionsParser<R: AsyncRead + Unpin> {
    inner: JsonInnerSolutions,
    json_parser: TokioAsyncReaderJsonParser<R>,
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> TokioAsyncReaderJsonSolutionsParser<R> {
    pub async fn parse_next(
        &mut self,
    ) -> Result<Option<Vec<Option<Term>>>, QueryResultsParseError> {
        match &mut self.inner {
            JsonInnerSolutions::Reader(reader) => {
                if reader.is_done() {
                    return Ok(None);
                }
                loop {
                    if let Some(result) =
                        reader.parse_event(self.json_parser.parse_next().await?)?
                    {
                        return Ok(Some(result));
                    }
                    if reader.is_done() {
                        return Ok(None);
                    }
                }
            }
            JsonInnerSolutions::Iterator(iter) => Ok(iter.next()),
        }
    }
}

#[expect(clippy::allow_attributes)]
#[allow(clippy::large_enum_variant)]
pub enum SliceJsonQueryResultsParserOutput<'a> {
    Solutions {
        variables: Vec<Variable>,
        solutions: SliceJsonSolutionsParser<'a>,
    },
    Boolean(bool),
}

impl<'a> SliceJsonQueryResultsParserOutput<'a> {
    pub fn read(
        slice: &'a [u8],
        version: Option<RdfVersion>,
    ) -> Result<Self, QueryResultsSyntaxError> {
        let mut json_parser = SliceJsonParser::new(slice);
        let mut inner = JsonInnerReader::new(version);
        loop {
            if let Some(result) = inner.read_event(json_parser.parse_next()?)? {
                return match result {
                    JsonInnerQueryResults::Solutions {
                        variables,
                        solutions,
                    } => Ok(Self::Solutions {
                        variables,
                        solutions: SliceJsonSolutionsParser {
                            inner: solutions,
                            json_parser,
                        },
                    }),
                    JsonInnerQueryResults::Boolean(value) => Ok(Self::Boolean(value)),
                };
            }
        }
    }
}

pub struct SliceJsonSolutionsParser<'a> {
    inner: JsonInnerSolutions,
    json_parser: SliceJsonParser<'a>,
}

impl SliceJsonSolutionsParser<'_> {
    pub fn parse_next(&mut self) -> Result<Option<Vec<Option<Term>>>, QueryResultsSyntaxError> {
        match &mut self.inner {
            JsonInnerSolutions::Reader(reader) => {
                if reader.is_done() {
                    return Ok(None);
                }
                loop {
                    if let Some(result) = reader.parse_event(self.json_parser.parse_next()?)? {
                        return Ok(Some(result));
                    }
                    if reader.is_done() {
                        return Ok(None);
                    }
                }
            }
            JsonInnerSolutions::Iterator(iter) => Ok(iter.next()),
        }
    }
}

#[expect(clippy::large_enum_variant)]
enum JsonInnerQueryResults {
    Solutions {
        variables: Vec<Variable>,
        solutions: JsonInnerSolutions,
    },
    Boolean(bool),
}

#[expect(clippy::allow_attributes)]
#[allow(clippy::large_enum_variant)]
enum JsonInnerSolutions {
    Reader(JsonInnerSolutionsParser),
    Iterator(JsonBufferedSolutionsIterator),
}

struct JsonInnerReader {
    state: JsonInnerReaderState,
    variables: Vec<Variable>,
    current_solution_variables: Vec<OxString>,
    current_solution_values: Vec<Term>,
    current_solution_keys: HashSet<OxString>,
    solutions: Vec<(Vec<OxString>, Vec<Term>)>,
    root_keys: HashSet<OxString>,
    head_keys: HashSet<OxString>,
    head_read: bool,
    vars_read: bool,
    results_read: bool,
    boolean: Option<bool>,
    version: Option<RdfVersion>,
}

#[expect(clippy::allow_attributes)]
#[allow(clippy::large_enum_variant)]
enum JsonInnerReaderState {
    Start,
    InRootObject,
    BeforeHead,
    InHead,
    BeforeVars,
    InVars,
    BeforeLinks,
    InLinks,
    BeforeVersion,
    BeforeResults,
    InResults,
    BeforeBindings,
    BeforeSolution,
    BetweenSolutionTerms,
    Term {
        reader: JsonInnerTermReader,
        variable: OxString,
    },
    AfterBindings,
    BeforeBoolean,
    IgnoreRootValue {
        level: usize,
    },
    AfterRoot,
}

impl JsonInnerReader {
    fn new(version: Option<RdfVersion>) -> Self {
        Self {
            state: JsonInnerReaderState::Start,
            variables: Vec::new(),
            current_solution_variables: Vec::new(),
            current_solution_values: Vec::new(),
            current_solution_keys: HashSet::new(),
            solutions: Vec::new(),
            root_keys: HashSet::new(),
            head_keys: HashSet::new(),
            head_read: false,
            vars_read: false,
            results_read: false,
            boolean: None,
            version,
        }
    }

    fn read_event(
        &mut self,
        event: JsonEvent<'_>,
    ) -> Result<Option<JsonInnerQueryResults>, QueryResultsSyntaxError> {
        match &mut self.state {
            JsonInnerReaderState::Start => {
                if event == JsonEvent::StartObject {
                    self.state = JsonInnerReaderState::InRootObject;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "SPARQL JSON results must be an object",
                    ))
                }
            }
            JsonInnerReaderState::InRootObject => match event {
                JsonEvent::ObjectKey(key) => {
                    let key = OxString::new_owned(&key);
                    if !self.root_keys.insert(key.clone()) {
                        return Err(QueryResultsSyntaxError::msg(format!(
                            "Duplicate top-level SPARQL JSON results key '{key}'"
                        )));
                    }
                    match key.as_str() {
                        "head" => {
                            self.state = JsonInnerReaderState::BeforeHead;
                            Ok(None)
                        }
                        "results" => {
                            if self.boolean.is_some() || self.root_keys.contains("boolean") {
                                return Err(QueryResultsSyntaxError::msg(
                                    "SPARQL JSON results must contain exactly one of 'results' and 'boolean'",
                                ));
                            }
                            self.results_read = true;
                            self.state = JsonInnerReaderState::BeforeResults;
                            Ok(None)
                        }
                        "boolean" => {
                            if self.results_read {
                                return Err(QueryResultsSyntaxError::msg(
                                    "SPARQL JSON results must contain exactly one of 'results' and 'boolean'",
                                ));
                            }
                            self.state = JsonInnerReaderState::BeforeBoolean;
                            Ok(None)
                        }
                        _ => {
                            self.state = JsonInnerReaderState::IgnoreRootValue { level: 0 };
                            Ok(None)
                        }
                    }
                }
                JsonEvent::EndObject => {
                    self.validate_document_shape()?;
                    self.state = JsonInnerReaderState::AfterRoot;
                    Ok(None)
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results before the top-level object was closed",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Expected a key or the end of the top-level SPARQL JSON results object",
                )),
            },
            JsonInnerReaderState::BeforeHead => {
                if event == JsonEvent::StartObject {
                    self.head_read = true;
                    self.state = JsonInnerReaderState::InHead;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "SPARQL JSON results head must be an object",
                    ))
                }
            }
            JsonInnerReaderState::InHead => match event {
                JsonEvent::ObjectKey(key) => {
                    let key = OxString::new_owned(&key);
                    if !self.head_keys.insert(key.clone()) {
                        return Err(QueryResultsSyntaxError::msg(format!(
                            "Duplicate SPARQL JSON results head key '{key}'"
                        )));
                    }
                    match key.as_str() {
                        "vars" => {
                            self.vars_read = true;
                            self.state = JsonInnerReaderState::BeforeVars;
                            Ok(None)
                        }
                        "link" => {
                            self.state = JsonInnerReaderState::BeforeLinks;
                            Ok(None)
                        }
                        "version" => {
                            self.state = JsonInnerReaderState::BeforeVersion;
                            Ok(None)
                        }
                        _ => Err(QueryResultsSyntaxError::msg(format!(
                            "Unsupported SPARQL JSON results head key '{key}'"
                        ))),
                    }
                }
                JsonEvent::EndObject => {
                    self.state = JsonInnerReaderState::InRootObject;
                    Ok(None)
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results inside 'head'",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Expected a key or the end of the SPARQL JSON results head object",
                )),
            },
            JsonInnerReaderState::BeforeVars => {
                if event == JsonEvent::StartArray {
                    self.state = JsonInnerReaderState::InVars;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "SPARQL JSON results vars must be an array",
                    ))
                }
            }
            JsonInnerReaderState::InVars => match event {
                JsonEvent::String(variable) => {
                    match Variable::new(OxString::new_owned(&variable)) {
                        Ok(var) => {
                            if self.variables.contains(&var) {
                                return Err(QueryResultsSyntaxError::msg(format!(
                                    "The variable {var} is declared twice"
                                )));
                            }
                            self.variables.push(var);
                            Ok(None)
                        }
                        Err(e) => Err(QueryResultsSyntaxError::msg(format!(
                            "Invalid variable name '{variable}': {e}"
                        ))),
                    }
                }
                JsonEvent::EndArray => {
                    self.state = JsonInnerReaderState::InHead;
                    Ok(None)
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results inside the vars array",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Variable names in the vars array must be strings",
                )),
            },
            JsonInnerReaderState::BeforeLinks => {
                if event == JsonEvent::StartArray {
                    self.state = JsonInnerReaderState::InLinks;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "SPARQL JSON results link must be an array",
                    ))
                }
            }
            JsonInnerReaderState::InLinks => match event {
                JsonEvent::String(link) => {
                    NamedNode::new(OxString::new_owned(&link)).map_err(|error| {
                        QueryResultsSyntaxError::msg(format!(
                            "Invalid IRI in the link array: {error}"
                        ))
                    })?;
                    Ok(None)
                }
                JsonEvent::EndArray => {
                    self.state = JsonInnerReaderState::InHead;
                    Ok(None)
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results inside the link array",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Links in the link array must be IRI strings",
                )),
            },
            JsonInnerReaderState::BeforeVersion => {
                if let JsonEvent::String(value) = event {
                    let inline_version = parse_results_version(&value)?;
                    if self.version.is_none() {
                        self.version = Some(inline_version);
                    }
                    self.state = JsonInnerReaderState::InHead;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "SPARQL JSON results head version must be a string",
                    ))
                }
            }
            JsonInnerReaderState::BeforeResults => {
                if event == JsonEvent::StartObject {
                    self.state = JsonInnerReaderState::InResults;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "SPARQL JSON results result must be an object",
                    ))
                }
            }
            JsonInnerReaderState::InResults => match event {
                JsonEvent::ObjectKey(key) if key == "bindings" => {
                    self.state = JsonInnerReaderState::BeforeBindings;
                    Ok(None)
                }
                JsonEvent::ObjectKey(key) => Err(QueryResultsSyntaxError::msg(format!(
                    "The results object has an unsupported key '{key}'; its single key must be 'bindings'"
                ))),
                JsonEvent::EndObject => Err(QueryResultsSyntaxError::msg(
                    "The results object must contain a 'bindings' key",
                )),
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results inside 'results'",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Expected the 'bindings' key in the results object",
                )),
            },
            JsonInnerReaderState::BeforeBindings => {
                if event == JsonEvent::StartArray {
                    if self.head_read {
                        if !self.vars_read {
                            return Err(QueryResultsSyntaxError::msg(
                                "A SELECT SPARQL JSON results head must contain 'vars'",
                            ));
                        }
                        let mapping = variable_mapping(&self.variables);
                        Ok(Some(JsonInnerQueryResults::Solutions {
                            variables: take(&mut self.variables),
                            solutions: JsonInnerSolutions::Reader(JsonInnerSolutionsParser::new(
                                mapping,
                                take(&mut self.root_keys),
                                self.version,
                            )),
                        }))
                    } else {
                        self.state = JsonInnerReaderState::BeforeSolution;
                        Ok(None)
                    }
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "SPARQL JSON results bindings must be an array",
                    ))
                }
            }
            JsonInnerReaderState::BeforeSolution => match event {
                JsonEvent::StartObject => {
                    self.current_solution_keys.clear();
                    self.state = JsonInnerReaderState::BetweenSolutionTerms;
                    Ok(None)
                }
                JsonEvent::EndArray => {
                    self.state = JsonInnerReaderState::AfterBindings;
                    Ok(None)
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results inside the bindings array",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Expecting a new solution object",
                )),
            },
            JsonInnerReaderState::BetweenSolutionTerms => match event {
                JsonEvent::ObjectKey(key) => {
                    let variable = OxString::new_owned(&key);
                    if !self.current_solution_keys.insert(variable.clone()) {
                        return Err(QueryResultsSyntaxError::msg(format!(
                            "The variable {variable} is bound more than once in one solution"
                        )));
                    }
                    self.state = JsonInnerReaderState::Term {
                        reader: JsonInnerTermReader::default(),
                        variable,
                    };
                    Ok(None)
                }
                JsonEvent::EndObject => {
                    self.state = JsonInnerReaderState::BeforeSolution;
                    self.solutions.push((
                        take(&mut self.current_solution_variables),
                        take(&mut self.current_solution_values),
                    ));
                    Ok(None)
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results inside a solution",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Expected a variable key or the end of a solution object",
                )),
            },
            JsonInnerReaderState::Term { reader, variable } => {
                let result = reader.read_event(event);
                if let Some(term) = result? {
                    self.current_solution_variables.push(take(variable));
                    self.current_solution_values.push(term);
                    self.state = JsonInnerReaderState::BetweenSolutionTerms;
                }
                Ok(None)
            }
            JsonInnerReaderState::AfterBindings => {
                if event == JsonEvent::EndObject {
                    self.state = JsonInnerReaderState::InRootObject;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "The results object must contain only the 'bindings' key",
                    ))
                }
            }
            JsonInnerReaderState::BeforeBoolean => {
                if let JsonEvent::Boolean(value) = event {
                    self.boolean = Some(value);
                    self.state = JsonInnerReaderState::InRootObject;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "The SPARQL JSON 'boolean' value must be true or false",
                    ))
                }
            }
            JsonInnerReaderState::IgnoreRootValue { level } => {
                if update_ignore_level(&event, level)? {
                    self.state = JsonInnerReaderState::InRootObject;
                }
                Ok(None)
            }
            JsonInnerReaderState::AfterRoot => {
                if event == JsonEvent::Eof {
                    self.build_output().map(Some)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "Unexpected JSON after the top-level SPARQL results object",
                    ))
                }
            }
        }
    }

    fn validate_document_shape(&self) -> Result<(), QueryResultsSyntaxError> {
        if !self.head_read {
            return Err(QueryResultsSyntaxError::msg(
                "SPARQL JSON results must contain a 'head' object",
            ));
        }
        match (self.results_read, self.boolean.is_some()) {
            (true, false) => {
                if !self.vars_read {
                    return Err(QueryResultsSyntaxError::msg(
                        "A SELECT SPARQL JSON results head must contain 'vars'",
                    ));
                }
            }
            (false, true) => {
                if self.vars_read {
                    return Err(QueryResultsSyntaxError::msg(
                        "An ASK SPARQL JSON results head must not contain 'vars'",
                    ));
                }
                if self.head_keys.contains("version") {
                    return Err(QueryResultsSyntaxError::msg(
                        "An ASK SPARQL JSON results head must not contain 'version'; \
                         use the media type parameter",
                    ));
                }
            }
            _ => {
                return Err(QueryResultsSyntaxError::msg(
                    "SPARQL JSON results must contain exactly one of 'results' and 'boolean'",
                ));
            }
        }
        Ok(())
    }

    fn build_output(&mut self) -> Result<JsonInnerQueryResults, QueryResultsSyntaxError> {
        if let Some(value) = self.boolean {
            return Ok(JsonInnerQueryResults::Boolean(value));
        }
        let mapping = variable_mapping(&self.variables);
        let mut bindings = Vec::with_capacity(self.solutions.len());
        for (solution_variables, solution_values) in take(&mut self.solutions) {
            let mut row = vec![None; mapping.len()];
            for (variable, value) in solution_variables.into_iter().zip(solution_values) {
                let key = *mapping.get(&variable).ok_or_else(|| {
                    QueryResultsSyntaxError::msg(format!(
                        "The variable {variable} has not been defined in the header"
                    ))
                })?;
                if row[key].is_some() {
                    return Err(QueryResultsSyntaxError::msg(format!(
                        "The variable {variable} is bound more than once in one solution"
                    )));
                }
                validate_term_version(&value, self.version)?;
                row[key] = Some(value);
            }
            bindings.push(row);
        }
        Ok(JsonInnerQueryResults::Solutions {
            variables: take(&mut self.variables),
            solutions: JsonInnerSolutions::Iterator(JsonBufferedSolutionsIterator {
                bindings: bindings.into_iter(),
            }),
        })
    }
}

fn variable_mapping(variables: &[Variable]) -> HashMap<OxString, usize> {
    variables
        .iter()
        .enumerate()
        .map(|(index, variable)| (variable.clone().into_string(), index))
        .collect()
}

fn update_ignore_level(
    event: &JsonEvent<'_>,
    level: &mut usize,
) -> Result<bool, QueryResultsSyntaxError> {
    match event {
        JsonEvent::StartArray | JsonEvent::StartObject => {
            *level += 1;
            Ok(false)
        }
        JsonEvent::EndArray | JsonEvent::EndObject => {
            if *level == 0 {
                Err(QueryResultsSyntaxError::msg(
                    "Missing value for a top-level extension key",
                ))
            } else {
                *level -= 1;
                Ok(*level == 0)
            }
        }
        JsonEvent::String(_) | JsonEvent::Number(_) | JsonEvent::Boolean(_) | JsonEvent::Null => {
            Ok(*level == 0)
        }
        JsonEvent::ObjectKey(_) => {
            if *level == 0 {
                Err(QueryResultsSyntaxError::msg(
                    "Missing value for a top-level extension key",
                ))
            } else {
                Ok(false)
            }
        }
        JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
            "Unexpected end of SPARQL JSON results inside a top-level extension value",
        )),
    }
}

fn validate_term_members(
    term_type: Option<&TermType>,
    keys: &HashSet<OxString>,
) -> Result<(), QueryResultsSyntaxError> {
    if !keys.contains("type") {
        return Ok(()); // The caller reports the missing required type.
    }
    if !keys.contains("value") {
        return Err(QueryResultsSyntaxError::msg(
            "RDF term serialization must have a 'value' key",
        ));
    }
    for key in keys {
        let allowed = match term_type {
            Some(TermType::Uri | TermType::BNode) => {
                matches!(key.as_str(), "type" | "value")
            }
            Some(TermType::Literal) => {
                let allowed = matches!(key.as_str(), "type" | "value" | "datatype" | "xml:lang");
                #[cfg(feature = "sparql-12")]
                let allowed = allowed || key == "its:dir";
                allowed
            }
            #[cfg(feature = "sparql-12")]
            Some(TermType::Triple) => matches!(key.as_str(), "type" | "value"),
            None => true,
        };
        if !allowed {
            return Err(QueryResultsSyntaxError::msg(format!(
                "The RDF term type does not allow the key '{key}'"
            )));
        }
    }
    Ok(())
}

#[cfg(feature = "sparql-12")]
fn validate_triple_value_members(keys: &HashSet<OxString>) -> Result<(), QueryResultsSyntaxError> {
    for required in ["subject", "predicate", "object"] {
        if !keys.contains(required) {
            return Err(QueryResultsSyntaxError::msg(format!(
                "Triple term serialization must have a '{required}' key"
            )));
        }
    }
    if keys.len() != 3 {
        return Err(QueryResultsSyntaxError::msg(
            "A triple term value must contain only subject, predicate and object",
        ));
    }
    Ok(())
}

struct JsonInnerSolutionsParser {
    state: JsonInnerSolutionsParserState,
    mapping: HashMap<OxString, usize>,
    new_bindings: Vec<Option<Term>>,
    current_solution_keys: HashSet<usize>,
    root_keys: HashSet<OxString>,
    version: Option<RdfVersion>,
}

#[expect(clippy::allow_attributes)]
#[allow(clippy::large_enum_variant)]
enum JsonInnerSolutionsParserState {
    BeforeSolution,
    BetweenSolutionTerms,
    Term {
        reader: JsonInnerTermReader,
        key: usize,
    },
    AfterBindings,
    InRootObject,
    IgnoreRootValue {
        level: usize,
    },
    AfterRoot,
    Done,
}

impl JsonInnerSolutionsParser {
    fn new(
        mapping: HashMap<OxString, usize>,
        root_keys: HashSet<OxString>,
        version: Option<RdfVersion>,
    ) -> Self {
        Self {
            state: JsonInnerSolutionsParserState::BeforeSolution,
            mapping,
            new_bindings: Vec::new(),
            current_solution_keys: HashSet::new(),
            root_keys,
            version,
        }
    }

    fn is_done(&self) -> bool {
        matches!(self.state, JsonInnerSolutionsParserState::Done)
    }

    fn parse_event(
        &mut self,
        event: JsonEvent<'_>,
    ) -> Result<Option<Vec<Option<Term>>>, QueryResultsSyntaxError> {
        match &mut self.state {
            JsonInnerSolutionsParserState::BeforeSolution => match event {
                JsonEvent::StartObject => {
                    self.state = JsonInnerSolutionsParserState::BetweenSolutionTerms;
                    self.new_bindings = vec![None; self.mapping.len()];
                    self.current_solution_keys.clear();
                    Ok(None)
                }
                JsonEvent::EndArray => {
                    self.state = JsonInnerSolutionsParserState::AfterBindings;
                    Ok(None)
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results inside the bindings array",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Expecting a new solution object",
                )),
            },
            JsonInnerSolutionsParserState::BetweenSolutionTerms => match event {
                JsonEvent::ObjectKey(key) => {
                    let key = *self.mapping.get(key.as_ref()).ok_or_else(|| {
                        QueryResultsSyntaxError::msg(format!(
                            "The variable {key} has not been defined in the header"
                        ))
                    })?;
                    if !self.current_solution_keys.insert(key) {
                        return Err(QueryResultsSyntaxError::msg(
                            "A variable is bound more than once in one solution",
                        ));
                    }
                    self.state = JsonInnerSolutionsParserState::Term {
                        reader: JsonInnerTermReader::default(),
                        key,
                    };
                    Ok(None)
                }
                JsonEvent::EndObject => {
                    self.state = JsonInnerSolutionsParserState::BeforeSolution;
                    Ok(Some(take(&mut self.new_bindings)))
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results inside a solution",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Expected a variable key or the end of a solution object",
                )),
            },
            JsonInnerSolutionsParserState::Term { reader, key } => {
                let result = reader.read_event(event);
                if let Some(term) = result? {
                    validate_term_version(&term, self.version)?;
                    self.new_bindings[*key] = Some(term);
                    self.state = JsonInnerSolutionsParserState::BetweenSolutionTerms;
                }
                Ok(None)
            }
            JsonInnerSolutionsParserState::AfterBindings => {
                if event == JsonEvent::EndObject {
                    self.state = JsonInnerSolutionsParserState::InRootObject;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "The results object must contain only the 'bindings' key",
                    ))
                }
            }
            JsonInnerSolutionsParserState::InRootObject => match event {
                JsonEvent::ObjectKey(key) => {
                    let key = OxString::new_owned(&key);
                    if !self.root_keys.insert(key.clone()) {
                        return Err(QueryResultsSyntaxError::msg(format!(
                            "Duplicate top-level SPARQL JSON results key '{key}'"
                        )));
                    }
                    if matches!(key.as_str(), "head" | "results" | "boolean") {
                        return Err(QueryResultsSyntaxError::msg(
                            "SPARQL JSON results must contain one head and exactly one result kind",
                        ));
                    }
                    self.state = JsonInnerSolutionsParserState::IgnoreRootValue { level: 0 };
                    Ok(None)
                }
                JsonEvent::EndObject => {
                    self.state = JsonInnerSolutionsParserState::AfterRoot;
                    Ok(None)
                }
                JsonEvent::Eof => Err(QueryResultsSyntaxError::msg(
                    "Unexpected end of SPARQL JSON results before the top-level object was closed",
                )),
                _ => Err(QueryResultsSyntaxError::msg(
                    "Expected a key or the end of the top-level SPARQL JSON results object",
                )),
            },
            JsonInnerSolutionsParserState::IgnoreRootValue { level } => {
                if update_ignore_level(&event, level)? {
                    self.state = JsonInnerSolutionsParserState::InRootObject;
                }
                Ok(None)
            }
            JsonInnerSolutionsParserState::AfterRoot => {
                if event == JsonEvent::Eof {
                    self.state = JsonInnerSolutionsParserState::Done;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "Unexpected JSON after the top-level SPARQL results object",
                    ))
                }
            }
            JsonInnerSolutionsParserState::Done => {
                if event == JsonEvent::Eof {
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "Unexpected JSON after the top-level SPARQL results object",
                    ))
                }
            }
        }
    }
}

#[derive(Default)]
struct JsonInnerTermReader {
    state: JsonInnerTermReaderState,
    seen_keys: HashSet<OxString>,
    term_type: Option<TermType>,
    value: Option<OxString>,
    lang: Option<OxString>,
    #[cfg(feature = "sparql-12")]
    direction: Option<BaseDirection>,
    datatype: Option<NamedNode>,
    #[cfg(feature = "sparql-12")]
    subject: Option<Term>,
    #[cfg(feature = "sparql-12")]
    predicate: Option<Term>,
    #[cfg(feature = "sparql-12")]
    object: Option<Term>,
    #[cfg(feature = "sparql-12")]
    triple_value_keys: HashSet<OxString>,
}

#[derive(Default)]
enum JsonInnerTermReaderState {
    #[default]
    Start,
    Middle,
    TermType,
    Value,
    Lang,
    #[cfg(feature = "sparql-12")]
    BaseDirection,
    Datatype,
    #[cfg(feature = "sparql-12")]
    InValue,
    #[cfg(feature = "sparql-12")]
    Subject(Box<JsonInnerTermReader>),
    #[cfg(feature = "sparql-12")]
    Predicate(Box<JsonInnerTermReader>),
    #[cfg(feature = "sparql-12")]
    Object(Box<JsonInnerTermReader>),
}

enum TermType {
    Uri,
    BNode,
    Literal,
    #[cfg(feature = "sparql-12")]
    Triple,
}

impl JsonInnerTermReader {
    fn read_event(
        &mut self,
        event: JsonEvent<'_>,
    ) -> Result<Option<Term>, QueryResultsSyntaxError> {
        match &mut self.state {
            JsonInnerTermReaderState::Start => {
                if event == JsonEvent::StartObject {
                    self.seen_keys.clear();
                    self.state = JsonInnerTermReaderState::Middle;
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "RDF terms must be encoded using objects",
                    ))
                }
            }
            JsonInnerTermReaderState::Middle => match event {
                JsonEvent::ObjectKey(object_key) => {
                    let key = OxString::new_owned(&object_key);
                    if !self.seen_keys.insert(key.clone()) {
                        return Err(QueryResultsSyntaxError::msg(format!(
                            "Duplicate RDF term key '{key}'"
                        )));
                    }
                    self.state = match object_key.as_ref() {
                        "type" => JsonInnerTermReaderState::TermType,
                        "value" => JsonInnerTermReaderState::Value,
                        "datatype" => JsonInnerTermReaderState::Datatype,
                        "xml:lang" => JsonInnerTermReaderState::Lang,
                        #[cfg(feature = "sparql-12")]
                        "its:dir" => JsonInnerTermReaderState::BaseDirection,
                        _ => {
                            return Err(QueryResultsSyntaxError::msg(format!(
                                "Unsupported term key: {object_key}"
                            )));
                        }
                    };
                    Ok(None)
                }
                JsonEvent::EndObject => {
                    self.state = JsonInnerTermReaderState::Start;
                    let term_type = self.term_type.take();
                    validate_term_members(term_type.as_ref(), &self.seen_keys)?;
                    match term_type {
                        None => Err(QueryResultsSyntaxError::msg(
                            "Term serialization must have a 'type' key",
                        )),
                        Some(TermType::Uri) => Ok(Some(
                            NamedNode::new(self.value.take().ok_or_else(|| {
                                QueryResultsSyntaxError::msg(
                                    "uri serialization must have a 'value' key",
                                )
                            })?)
                            .map_err(|e| {
                                QueryResultsSyntaxError::msg(format!("Invalid uri value: {e}"))
                            })?
                            .into(),
                        )),
                        Some(TermType::BNode) => Ok(Some(
                            BlankNode::new(self.value.take().ok_or_else(|| {
                                QueryResultsSyntaxError::msg(
                                    "bnode serialization must have a 'value' key",
                                )
                            })?)
                            .map_err(|e| {
                                QueryResultsSyntaxError::msg(format!("Invalid bnode value: {e}"))
                            })?
                            .into(),
                        )),
                        Some(TermType::Literal) => {
                            let value = self.value.take().ok_or_else(|| {
                                QueryResultsSyntaxError::msg(
                                    "literal serialization must have a 'value' key",
                                )
                            })?;
                            Ok(Some(if let Some(lang) = self.lang.take() {
                                #[cfg(feature = "sparql-12")]
                                if let Some(direction) = self.direction.take() {
                                    if let Some(datatype) = &self.datatype {
                                        if datatype.as_ref() != rdf::DIR_LANG_STRING {
                                            return Err(QueryResultsSyntaxError::msg(format!(
                                                "xml:lang value '{lang}' and its:dir value '{direction}' provided with the datatype {datatype}"
                                            )));
                                        }
                                    }
                                    return Ok(Some(Literal::new_directional_language_tagged_literal(
                                        value,
                                        lang.clone(),
                                        direction
                                    ).map_err(|e| {
                                        QueryResultsSyntaxError::msg(format!(
                                            "Invalid xml:lang value '{lang}': {e}"
                                        ))
                                    })?.into()))
                                }
                                if let Some(datatype) = &self.datatype {
                                    if datatype.as_ref() != rdf::LANG_STRING {
                                        return Err(QueryResultsSyntaxError::msg(format!(
                                            "xml:lang value '{lang}' provided with the datatype {datatype}"
                                        )));
                                    }
                                }
                                Literal::new_language_tagged_literal(value, lang.clone())
                                    .map_err(|e| {
                                        QueryResultsSyntaxError::msg(format!(
                                            "Invalid xml:lang value '{lang}': {e}"
                                        ))
                                    })?
                            } else {
                                #[cfg(feature = "sparql-12")]
                                if self.direction.take().is_some() {
                                    return Err(QueryResultsSyntaxError::msg("its:dir can only be present alongside xml:lang"))
                                }
                                if let Some(datatype) = self.datatype.take() {
                                    Literal::try_new_typed_literal(value, datatype).map_err(
                                        |error| {
                                            QueryResultsSyntaxError::msg(error.to_string())
                                        },
                                    )?
                                } else {
                                    Literal::new_simple_literal(value)
                                }
                            }.into()))
                        }
                        #[cfg(feature = "sparql-12")]
                        Some(TermType::Triple) => {
                            validate_triple_value_members(&self.triple_value_keys)?;
                            Ok(Some(
                                Triple::new(
                                    match self.subject.take().ok_or_else(|| {
                                        QueryResultsSyntaxError::msg(
                                            "triple serialization must have a 'subject' key",
                                        )
                                    })? {
                                        Term::NamedNode(subject) => NamedOrBlankNode::from(subject),
                                        Term::BlankNode(subject) => NamedOrBlankNode::from(subject),
                                        Term::Triple(_) => {
                                            return Err(QueryResultsSyntaxError::msg(
                                                "The 'subject' value cannot be a triple term",
                                            ));
                                        }
                                        Term::Literal(_) => {
                                            return Err(QueryResultsSyntaxError::msg(
                                                "The 'subject' value cannot be a literal",
                                            ));
                                        }
                                    },
                                    if let Term::NamedNode(predicate) =
                                        self.predicate.take().ok_or_else(|| {
                                            QueryResultsSyntaxError::msg(
                                                "triple serialization must have a 'predicate' key",
                                            )
                                        })?
                                    {
                                        predicate
                                    } else {
                                        return Err(QueryResultsSyntaxError::msg(
                                            "The 'predicate' value must be a uri",
                                        ));
                                    },
                                    self.object.take().ok_or_else(|| {
                                        QueryResultsSyntaxError::msg(
                                            "triple serialization must have an 'object' key",
                                        )
                                    })?,
                                )
                                .into(),
                            ))
                        }
                    }
                }
                _ => unreachable!(),
            },
            JsonInnerTermReaderState::TermType => {
                self.state = JsonInnerTermReaderState::Middle;
                if let JsonEvent::String(value) = event {
                    match value.as_ref() {
                        "uri" => {
                            self.term_type = Some(TermType::Uri);
                            Ok(None)
                        }
                        "bnode" => {
                            self.term_type = Some(TermType::BNode);
                            Ok(None)
                        }
                        "literal" | "typed-literal" => {
                            self.term_type = Some(TermType::Literal);
                            Ok(None)
                        }
                        #[cfg(feature = "sparql-12")]
                        "triple" => {
                            self.term_type = Some(TermType::Triple);
                            Ok(None)
                        }
                        _ => Err(QueryResultsSyntaxError::msg(format!(
                            "Unexpected term type: '{value}'"
                        ))),
                    }
                } else {
                    Err(QueryResultsSyntaxError::msg("Term type must be a string"))
                }
            }
            JsonInnerTermReaderState::Value => match event {
                JsonEvent::String(value) => {
                    self.value = Some(OxString::new_owned(&value));
                    self.state = JsonInnerTermReaderState::Middle;
                    Ok(None)
                }
                #[cfg(feature = "sparql-12")]
                JsonEvent::StartObject => {
                    self.triple_value_keys.clear();
                    self.state = JsonInnerTermReaderState::InValue;
                    Ok(None)
                }
                _ => {
                    self.state = JsonInnerTermReaderState::Middle;
                    Err(QueryResultsSyntaxError::msg("Term value must be a string"))
                }
            },
            JsonInnerTermReaderState::Lang => {
                self.state = JsonInnerTermReaderState::Middle;
                if let JsonEvent::String(value) = event {
                    self.lang = Some(OxString::new_owned(&value));
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg("Term lang must be strings"))
                }
            }
            #[cfg(feature = "sparql-12")]
            JsonInnerTermReaderState::BaseDirection => {
                self.state = JsonInnerTermReaderState::Middle;
                if let JsonEvent::String(value) = event {
                    self.direction = Some(match value.as_ref() {
                        "ltr" => BaseDirection::Ltr,
                        "rtl" => BaseDirection::Rtl,
                        _ => {
                            return Err(QueryResultsSyntaxError::msg(format!(
                                "Invalid its:dir value '{value}', expecting 'ltr' or 'rtl'"
                            )));
                        }
                    });
                    Ok(None)
                } else {
                    Err(QueryResultsSyntaxError::msg(
                        "Term base directions must be strings",
                    ))
                }
            }
            JsonInnerTermReaderState::Datatype => {
                self.state = JsonInnerTermReaderState::Middle;
                if let JsonEvent::String(value) = event {
                    match NamedNode::new(OxString::new_owned(&value)) {
                        Ok(datatype) => {
                            self.datatype = Some(datatype);
                            Ok(None)
                        }
                        Err(e) => Err(QueryResultsSyntaxError::msg(format!(
                            "Invalid datatype: {e}"
                        ))),
                    }
                } else {
                    Err(QueryResultsSyntaxError::msg("Term lang must be strings"))
                }
            }
            #[cfg(feature = "sparql-12")]
            JsonInnerTermReaderState::InValue => match event {
                JsonEvent::ObjectKey(object_key) => {
                    let key = OxString::new_owned(&object_key);
                    if !self.triple_value_keys.insert(key.clone()) {
                        return Err(QueryResultsSyntaxError::msg(format!(
                            "Duplicate triple value key '{key}'"
                        )));
                    }
                    self.state = match object_key.as_ref() {
                        "subject" => JsonInnerTermReaderState::Subject(Box::default()),
                        "predicate" => JsonInnerTermReaderState::Predicate(Box::default()),
                        "object" => JsonInnerTermReaderState::Object(Box::default()),
                        _ => {
                            return Err(QueryResultsSyntaxError::msg(format!(
                                "Unsupported value key: {object_key}"
                            )));
                        }
                    };
                    Ok(None)
                }
                JsonEvent::EndObject => {
                    self.state = JsonInnerTermReaderState::Middle;
                    Ok(None)
                }
                _ => unreachable!(),
            },
            #[cfg(feature = "sparql-12")]
            JsonInnerTermReaderState::Subject(inner_state) => {
                if let Some(term) = inner_state.read_event(event)? {
                    self.state = JsonInnerTermReaderState::InValue;
                    self.subject = Some(term);
                }
                Ok(None)
            }
            #[cfg(feature = "sparql-12")]
            JsonInnerTermReaderState::Predicate(inner_state) => {
                if let Some(term) = inner_state.read_event(event)? {
                    self.state = JsonInnerTermReaderState::InValue;
                    self.predicate = Some(term);
                }
                Ok(None)
            }
            #[cfg(feature = "sparql-12")]
            JsonInnerTermReaderState::Object(inner_state) => {
                if let Some(term) = inner_state.read_event(event)? {
                    self.state = JsonInnerTermReaderState::InValue;
                    self.object = Some(term);
                }
                Ok(None)
            }
        }
    }
}

pub struct JsonBufferedSolutionsIterator {
    bindings: std::vec::IntoIter<Vec<Option<Term>>>,
}

impl JsonBufferedSolutionsIterator {
    fn next(&mut self) -> Option<Vec<Option<Term>>> {
        self.bindings.next()
    }
}
