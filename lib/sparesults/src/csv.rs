//! Implementation of [SPARQL 1.1 Query Results CSV and TSV Formats](https://www.w3.org/TR/sparql11-results-csv-tsv/)

use crate::error::{QueryResultsParseError, QueryResultsSyntaxError, TextPosition};
use memchr::memchr;
use oxrdf::vocab::xsd;
use oxrdf::*;
use std::borrow::Cow;
use std::io::{self, Read, Write};
use std::str::{self, FromStr};
#[cfg(feature = "async-tokio")]
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const MAX_BUFFER_SIZE: usize = 4096 * 4096;

pub fn write_boolean_csv_result<W: Write>(mut writer: W, value: bool) -> io::Result<W> {
    writer.write_all(if value { b"true" } else { b"false" })?;
    Ok(writer)
}

#[cfg(feature = "async-tokio")]
pub async fn tokio_async_write_boolean_csv_result<W: AsyncWrite + Unpin>(
    mut writer: W,
    value: bool,
) -> io::Result<W> {
    writer
        .write_all(if value { b"true" } else { b"false" })
        .await?;
    Ok(writer)
}

pub struct WriterCsvSolutionsSerializer<W: Write> {
    inner: InnerCsvSolutionsSerializer,
    writer: W,
    buffer: String,
}

impl<W: Write> WriterCsvSolutionsSerializer<W> {
    pub fn start(mut writer: W, variables: Vec<Variable>) -> io::Result<Self> {
        let mut buffer = String::new();
        let inner = InnerCsvSolutionsSerializer::start(&mut buffer, variables);
        writer.write_all(buffer.as_bytes())?;
        buffer.clear();
        Ok(Self {
            inner,
            writer,
            buffer,
        })
    }

    pub fn serialize<'a>(
        &mut self,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) -> io::Result<()> {
        self.inner.write(&mut self.buffer, solution);
        self.writer.write_all(self.buffer.as_bytes())?;
        self.buffer.clear();
        Ok(())
    }

    pub fn finish(self) -> W {
        self.writer
    }
}

#[cfg(feature = "async-tokio")]
pub struct TokioAsyncWriterCsvSolutionsSerializer<W: AsyncWrite + Unpin> {
    inner: InnerCsvSolutionsSerializer,
    writer: W,
    buffer: String,
}

#[cfg(feature = "async-tokio")]
impl<W: AsyncWrite + Unpin> TokioAsyncWriterCsvSolutionsSerializer<W> {
    pub async fn start(mut writer: W, variables: Vec<Variable>) -> io::Result<Self> {
        let mut buffer = String::new();
        let inner = InnerCsvSolutionsSerializer::start(&mut buffer, variables);
        writer.write_all(buffer.as_bytes()).await?;
        buffer.clear();
        Ok(Self {
            inner,
            writer,
            buffer,
        })
    }

    pub async fn serialize<'a>(
        &mut self,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) -> io::Result<()> {
        self.inner.write(&mut self.buffer, solution);
        self.writer.write_all(self.buffer.as_bytes()).await?;
        self.buffer.clear();
        Ok(())
    }

    pub fn finish(self) -> W {
        self.writer
    }
}

struct InnerCsvSolutionsSerializer {
    variables: Vec<Variable>,
}

impl InnerCsvSolutionsSerializer {
    fn start(output: &mut String, variables: Vec<Variable>) -> Self {
        let mut start_vars = true;
        for variable in &variables {
            if start_vars {
                start_vars = false;
            } else {
                output.push(',');
            }
            output.push_str(variable.as_str());
        }
        output.push_str("\r\n");
        Self { variables }
    }

    fn write<'a>(
        &self,
        output: &mut String,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) {
        let mut values = vec![None; self.variables.len()];
        for (variable, value) in solution {
            if let Some(position) = self.variables.iter().position(|v| v == variable) {
                values[position] = Some(value);
            }
        }
        let mut start_binding = true;
        for value in values {
            if start_binding {
                start_binding = false;
            } else {
                output.push(',');
            }
            if let Some(value) = value {
                write_csv_term(output, value);
            }
        }
        output.push_str("\r\n");
    }
}

fn write_csv_term(output: &mut String, term: &Term) {
    #[cfg(feature = "sparql-12")]
    if let Term::Triple(_) = term {
        let mut value = String::new();
        write_csv_triple_term_value(&mut value, term);
        write_escaped_csv_string(output, &value);
        return;
    }
    match term {
        Term::NamedNode(uri) => write_csv_named_node(output, uri),
        Term::BlankNode(bnode) => write_csv_blank_node(output, bnode),
        Term::Literal(literal) => write_escaped_csv_string(output, literal.value()),
        #[cfg(feature = "sparql-12")]
        Term::Triple(_) => unreachable!(),
    }
}

#[cfg(feature = "sparql-12")]
fn write_csv_triple_term_value(output: &mut String, term: &Term) {
    let Term::Triple(triple) = term else {
        write_csv_nested_term_value(output, term);
        return;
    };
    output.push_str("<<( ");
    match &triple.subject {
        NamedOrBlankNode::NamedNode(uri) => write_csv_named_node(output, uri),
        NamedOrBlankNode::BlankNode(bnode) => write_csv_blank_node(output, bnode),
    }
    output.push(' ');
    write_csv_named_node(output, &triple.predicate);
    output.push(' ');
    write_csv_nested_term_value(output, &triple.object);
    output.push_str(" )>>");
}

#[cfg(feature = "sparql-12")]
fn write_csv_nested_term_value(output: &mut String, term: &Term) {
    match term {
        Term::NamedNode(uri) => write_csv_named_node(output, uri),
        Term::BlankNode(bnode) => write_csv_blank_node(output, bnode),
        Term::Literal(literal) => write_always_quoted_csv_string(output, literal.value()),
        Term::Triple(_) => write_csv_triple_term_value(output, term),
    }
}

#[cfg(feature = "sparql-12")]
fn write_always_quoted_csv_string(output: &mut String, value: &str) {
    output.push('"');
    for character in value.chars() {
        if character == '"' {
            output.push('"');
        }
        output.push(character);
    }
    output.push('"');
}

fn write_csv_named_node(output: &mut String, uri: &NamedNode) {
    output.push_str(uri.as_str())
}

fn write_csv_blank_node(output: &mut String, bnode: &BlankNode) {
    output.push_str("_:");
    output.push_str(bnode.as_str())
}

fn write_escaped_csv_string(output: &mut String, s: &str) {
    if s.bytes().any(|c| matches!(c, b'"' | b',' | b'\n' | b'\r')) {
        output.push('"');
        for c in s.chars() {
            if c == '"' {
                output.push('"');
                output.push('"');
            } else {
                output.push(c)
            }
        }
        output.push('"');
    } else {
        output.push_str(s)
    }
}

pub struct WriterTsvSolutionsSerializer<W: Write> {
    inner: InnerTsvSolutionsSerializer,
    writer: W,
    buffer: String,
}

impl<W: Write> WriterTsvSolutionsSerializer<W> {
    pub fn start(mut writer: W, variables: Vec<Variable>) -> io::Result<Self> {
        let mut buffer = String::new();
        let inner = InnerTsvSolutionsSerializer::start(&mut buffer, variables);
        writer.write_all(buffer.as_bytes())?;
        buffer.clear();
        Ok(Self {
            inner,
            writer,
            buffer,
        })
    }

    pub fn serialize<'a>(
        &mut self,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) -> io::Result<()> {
        self.inner.write(&mut self.buffer, solution);
        self.writer.write_all(self.buffer.as_bytes())?;
        self.buffer.clear();
        Ok(())
    }

    pub fn finish(self) -> W {
        self.writer
    }
}

#[cfg(feature = "async-tokio")]
pub struct TokioAsyncWriterTsvSolutionsSerializer<W: AsyncWrite + Unpin> {
    inner: InnerTsvSolutionsSerializer,
    writer: W,
    buffer: String,
}

#[cfg(feature = "async-tokio")]
impl<W: AsyncWrite + Unpin> TokioAsyncWriterTsvSolutionsSerializer<W> {
    pub async fn start(mut writer: W, variables: Vec<Variable>) -> io::Result<Self> {
        let mut buffer = String::new();
        let inner = InnerTsvSolutionsSerializer::start(&mut buffer, variables);
        writer.write_all(buffer.as_bytes()).await?;
        buffer.clear();
        Ok(Self {
            inner,
            writer,
            buffer,
        })
    }

    pub async fn serialize<'a>(
        &mut self,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) -> io::Result<()> {
        self.inner.write(&mut self.buffer, solution);
        self.writer.write_all(self.buffer.as_bytes()).await?;
        self.buffer.clear();
        Ok(())
    }

    pub fn finish(self) -> W {
        self.writer
    }
}

struct InnerTsvSolutionsSerializer {
    variables: Vec<Variable>,
}

impl InnerTsvSolutionsSerializer {
    fn start(output: &mut String, variables: Vec<Variable>) -> Self {
        let mut start_vars = true;
        for variable in &variables {
            if start_vars {
                start_vars = false;
            } else {
                output.push('\t');
            }
            output.push('?');
            output.push_str(variable.as_str());
        }
        output.push('\n');
        Self { variables }
    }

    fn write<'a>(
        &self,
        output: &mut String,
        solution: impl IntoIterator<Item = (&'a Variable, &'a Term)>,
    ) {
        let mut values = vec![None; self.variables.len()];
        for (variable, value) in solution {
            if let Some(position) = self.variables.iter().position(|v| v == variable) {
                values[position] = Some(value);
            }
        }
        let mut start_binding = true;
        for value in values {
            if start_binding {
                start_binding = false;
            } else {
                output.push('\t');
            }
            if let Some(value) = value {
                write_tsv_term(output, value);
            }
        }
        output.push('\n');
    }
}

fn write_tsv_term(output: &mut String, term: &Term) {
    match term {
        Term::NamedNode(node) => write_tsv_named_node(output, node),
        Term::BlankNode(node) => write_tsv_blank_node(output, node),
        Term::Literal(literal) => {
            let value = literal.value();
            if let Some(language) = literal.language() {
                write_tsv_quoted_str(output, value);
                output.push('@');
                output.push_str(language);
                #[cfg(feature = "sparql-12")]
                if let Some(direction) = literal.direction() {
                    output.push_str(match direction {
                        BaseDirection::Ltr => "--ltr",
                        BaseDirection::Rtl => "--rtl",
                    })
                }
            } else {
                let datatype = literal.datatype();
                if *datatype == xsd::BOOLEAN && is_turtle_boolean(value)
                    || *datatype == xsd::INTEGER && is_turtle_integer(value)
                    || *datatype == xsd::DECIMAL && is_turtle_decimal(value)
                    || *datatype == xsd::DOUBLE && is_turtle_double(value)
                {
                    output.push_str(value)
                } else {
                    write_tsv_quoted_str(output, value);
                    if *datatype != xsd::STRING {
                        output.push_str("^^");
                        write_tsv_named_node(output, datatype);
                    }
                }
            }
        }
        #[cfg(feature = "sparql-12")]
        Term::Triple(triple) => {
            output.push_str("<<( ");
            match &triple.subject {
                NamedOrBlankNode::NamedNode(node) => write_tsv_named_node(output, node),
                NamedOrBlankNode::BlankNode(node) => write_tsv_blank_node(output, node),
            }
            output.push(' ');
            write_tsv_named_node(output, &triple.predicate);
            output.push(' ');
            write_tsv_term(output, &triple.object);
            output.push_str(" )>>");
        }
    }
}

fn write_tsv_named_node(output: &mut String, node: &NamedNode) {
    output.push('<');
    output.push_str(node.as_str());
    output.push('>');
}

fn write_tsv_blank_node(output: &mut String, node: &BlankNode) {
    output.push_str("_:");
    output.push_str(node.as_str());
}

fn write_tsv_quoted_str(output: &mut String, string: &str) {
    output.push('"');
    for c in string.chars() {
        match c {
            '\t' => output.push_str("\\t"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            _ => output.push(c),
        }
    }
    output.push('"');
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

pub enum ReaderTsvQueryResultsParserOutput<R: Read> {
    Solutions {
        variables: Vec<Variable>,
        solutions: ReaderTsvSolutionsParser<R>,
    },
    Boolean(bool),
}

impl<R: Read> ReaderTsvQueryResultsParserOutput<R> {
    pub fn read(mut reader: R) -> Result<Self, QueryResultsParseError> {
        let mut line_reader = LineReader::new();
        let mut buffer = Vec::new();
        let line = line_reader.next_line_from_reader(&mut buffer, &mut reader)?;
        Ok(match inner_read_first_line(line_reader, line)? {
            TsvInnerQueryResults::Solutions {
                variables,
                solutions,
            } => Self::Solutions {
                variables,
                solutions: ReaderTsvSolutionsParser {
                    reader,
                    inner: solutions,
                    buffer,
                },
            },
            TsvInnerQueryResults::Boolean(value) => Self::Boolean(value),
        })
    }
}

pub struct ReaderTsvSolutionsParser<R: Read> {
    reader: R,
    inner: TsvInnerSolutionsParser,
    buffer: Vec<u8>,
}

impl<R: Read> ReaderTsvSolutionsParser<R> {
    pub fn parse_next(&mut self) -> Result<Option<Vec<Option<Term>>>, QueryResultsParseError> {
        let line = self
            .inner
            .line_reader
            .next_line_from_reader(&mut self.buffer, &mut self.reader)?;
        Ok(self.inner.parse_next(line)?)
    }
}

#[cfg(feature = "async-tokio")]
pub enum TokioAsyncReaderTsvQueryResultsParserOutput<R: AsyncRead + Unpin> {
    Solutions {
        variables: Vec<Variable>,
        solutions: TokioAsyncReaderTsvSolutionsParser<R>,
    },
    Boolean(bool),
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> TokioAsyncReaderTsvQueryResultsParserOutput<R> {
    pub async fn read(mut reader: R) -> Result<Self, QueryResultsParseError> {
        let mut line_reader = LineReader::new();
        let mut buffer = Vec::new();
        let line = line_reader
            .next_line_from_tokio_async_read(&mut buffer, &mut reader)
            .await?;
        Ok(match inner_read_first_line(line_reader, line)? {
            TsvInnerQueryResults::Solutions {
                variables,
                solutions,
            } => Self::Solutions {
                variables,
                solutions: TokioAsyncReaderTsvSolutionsParser {
                    reader,
                    inner: solutions,
                    buffer,
                },
            },
            TsvInnerQueryResults::Boolean(value) => Self::Boolean(value),
        })
    }
}

#[cfg(feature = "async-tokio")]
pub struct TokioAsyncReaderTsvSolutionsParser<R: AsyncRead + Unpin> {
    reader: R,
    inner: TsvInnerSolutionsParser,
    buffer: Vec<u8>,
}

#[cfg(feature = "async-tokio")]
impl<R: AsyncRead + Unpin> TokioAsyncReaderTsvSolutionsParser<R> {
    pub async fn parse_next(
        &mut self,
    ) -> Result<Option<Vec<Option<Term>>>, QueryResultsParseError> {
        let line = self
            .inner
            .line_reader
            .next_line_from_tokio_async_read(&mut self.buffer, &mut self.reader)
            .await?;
        Ok(self.inner.parse_next(line)?)
    }
}

pub enum SliceTsvQueryResultsParserOutput<'a> {
    Solutions {
        variables: Vec<Variable>,
        solutions: SliceTsvSolutionsParser<'a>,
    },
    Boolean(bool),
}

impl<'a> SliceTsvQueryResultsParserOutput<'a> {
    pub fn read(slice: &'a [u8]) -> Result<Self, QueryResultsSyntaxError> {
        let mut reader = LineReader::new();
        let line = reader.next_line_from_slice(slice)?;
        Ok(match inner_read_first_line(reader, line)? {
            TsvInnerQueryResults::Solutions {
                variables,
                solutions,
            } => Self::Solutions {
                variables,
                solutions: SliceTsvSolutionsParser {
                    slice,
                    inner: solutions,
                },
            },
            TsvInnerQueryResults::Boolean(value) => Self::Boolean(value),
        })
    }
}

pub struct SliceTsvSolutionsParser<'a> {
    slice: &'a [u8],
    inner: TsvInnerSolutionsParser,
}

impl SliceTsvSolutionsParser<'_> {
    pub fn parse_next(&mut self) -> Result<Option<Vec<Option<Term>>>, QueryResultsSyntaxError> {
        let line = self.inner.line_reader.next_line_from_slice(self.slice)?;
        self.inner.parse_next(line)
    }
}

enum TsvInnerQueryResults {
    Solutions {
        variables: Vec<Variable>,
        solutions: TsvInnerSolutionsParser,
    },
    Boolean(bool),
}

fn inner_read_first_line(
    reader: LineReader,
    line: &str,
) -> Result<TsvInnerQueryResults, QueryResultsSyntaxError> {
    let line = line.trim_matches(|c| matches!(c, ' ' | '\r' | '\n'));
    if line.eq_ignore_ascii_case("true") {
        return Ok(TsvInnerQueryResults::Boolean(true));
    }
    if line.eq_ignore_ascii_case("false") {
        return Ok(TsvInnerQueryResults::Boolean(false));
    }
    let mut variables = Vec::new();
    if !line.is_empty() {
        for v in line.split('\t') {
            let v = v.trim();
            if v.is_empty() {
                return Err(QueryResultsSyntaxError::msg(
                    "Empty column on the first row. The first row should be a list of variables like ?foo or $bar",
                ));
            }
            let variable = Variable::from_str(v).map_err(|e| {
                QueryResultsSyntaxError::msg(format!("Invalid variable declaration '{v}': {e}"))
            })?;
            if variables.contains(&variable) {
                return Err(QueryResultsSyntaxError::msg(format!(
                    "The variable {variable} is declared twice"
                )));
            }
            variables.push(variable);
        }
    }
    let column_len = variables.len();
    Ok(TsvInnerQueryResults::Solutions {
        variables,
        solutions: TsvInnerSolutionsParser {
            line_reader: reader,
            column_len,
        },
    })
}

struct TsvInnerSolutionsParser {
    line_reader: LineReader,
    column_len: usize,
}

impl TsvInnerSolutionsParser {
    #[expect(clippy::unwrap_in_result)]
    pub fn parse_next(
        &self,
        line: &str,
    ) -> Result<Option<Vec<Option<Term>>>, QueryResultsSyntaxError> {
        if line.is_empty() {
            return Ok(None); // EOF
        }
        let elements = line
            .split('\t')
            .enumerate()
            .map(|(i, v)| {
                let v = v.trim();
                if v.is_empty() {
                    Ok(None)
                } else {
                    let start_position_char = line
                        .split('\t')
                        .take(i)
                        .map(|c| c.chars().count() + 1)
                        .sum::<usize>();
                    let start_position_bytes =
                        line.split('\t').take(i).map(|c| c.len() + 1).sum::<usize>();
                    let location = TextPosition {
                        line: self.line_reader.line_count - 1,
                        column: start_position_char.try_into().unwrap(),
                        offset: self.line_reader.last_line_start
                            + u64::try_from(start_position_bytes).unwrap(),
                    }..TextPosition {
                        line: self.line_reader.line_count - 1,
                        column: (start_position_char + v.chars().count())
                            .try_into()
                            .unwrap(),
                        offset: self.line_reader.last_line_start
                            + u64::try_from(start_position_bytes + v.len()).unwrap(),
                    };
                    let normalized = normalize_tsv_term(v).map_err(|message| {
                        QueryResultsSyntaxError::located_message(message, location.clone())
                    })?;
                    Ok(Some(Term::from_str(&normalized).map_err(|e| {
                        QueryResultsSyntaxError::term(e, v.into(), location)
                    })?))
                }
            })
            .collect::<Result<Vec<_>, QueryResultsSyntaxError>>()?;
        if elements.len() == self.column_len {
            Ok(Some(elements))
        } else if self.column_len == 0 && elements == [None] {
            Ok(Some(Vec::new())) // Zero columns case
        } else {
            Err(QueryResultsSyntaxError::located_message(
                format!(
                    "This TSV files has {} columns but we found a row on line {} with {} columns: {}",
                    self.column_len,
                    self.line_reader.line_count - 1,
                    elements.len(),
                    line
                ),
                TextPosition {
                    line: self.line_reader.line_count - 1,
                    column: 0,
                    offset: self.line_reader.last_line_start,
                }..TextPosition {
                    line: self.line_reader.line_count - 1,
                    column: line.chars().count().try_into().unwrap(),
                    offset: self.line_reader.last_line_end,
                },
            ))
        }
    }
}

fn normalize_tsv_term(value: &str) -> Result<Cow<'_, str>, &'static str> {
    let mut output = String::with_capacity(value.len());
    let mut offset = 0;
    let mut changed = false;
    while offset < value.len() {
        let remaining = &value[offset..];
        if remaining.starts_with("<<(") {
            output.push_str("<<(");
            offset += 3;
            continue;
        }
        let Some(character) = remaining.chars().next() else {
            break;
        };
        if character == '<' {
            loop {
                let Some(character) = value[offset..].chars().next() else {
                    return Err("An IRI in a SPARQL TSV term is not closed");
                };
                output.push(character);
                offset += character.len_utf8();
                if character == '>' || offset == value.len() {
                    break;
                }
            }
            continue;
        }
        if matches!(character, '"' | '\'') {
            let quote = character;
            if remaining.starts_with(if quote == '"' { "\"\"\"" } else { "'''" }) {
                return Err("Long string literals are not allowed in SPARQL TSV results");
            }
            changed |= quote == '\'';
            output.push('"');
            offset += quote.len_utf8();
            let mut closed = false;
            while offset < value.len() {
                let Some(character) = value[offset..].chars().next() else {
                    break;
                };
                if character == quote {
                    output.push('"');
                    offset += character.len_utf8();
                    closed = true;
                    break;
                }
                if matches!(character, '\t' | '\n' | '\r') {
                    return Err(
                        "Tab, newline, and carriage return characters must be escaped in SPARQL TSV literals",
                    );
                }
                if character == '\\' {
                    output.push('\\');
                    offset += character.len_utf8();
                    let Some(escaped) = value[offset..].chars().next() else {
                        return Err("A SPARQL TSV literal ends with an incomplete escape");
                    };
                    if quote == '\'' && escaped == '\'' {
                        output.pop();
                        output.push('\'');
                    } else {
                        output.push(escaped);
                    }
                    offset += escaped.len_utf8();
                } else {
                    if quote == '\'' && character == '"' {
                        output.push('\\');
                    }
                    output.push(character);
                    offset += character.len_utf8();
                }
            }
            if !closed {
                return Err("A SPARQL TSV literal is not closed");
            }
            continue;
        }
        output.push(character);
        offset += character.len_utf8();
    }
    if changed {
        Ok(Cow::Owned(output))
    } else {
        Ok(Cow::Borrowed(value))
    }
}

struct LineReader {
    buffer_start: usize,
    buffer_end: usize,
    line_count: u64,
    last_line_start: u64,
    last_line_end: u64,
}

impl LineReader {
    fn new() -> Self {
        Self {
            buffer_start: 0,
            buffer_end: 0,
            line_count: 0,
            last_line_start: 0,
            last_line_end: 0,
        }
    }

    #[expect(clippy::unwrap_in_result)]
    fn next_line_from_reader<'a>(
        &mut self,
        buffer: &'a mut Vec<u8>,
        reader: &mut impl Read,
    ) -> Result<&'a str, QueryResultsParseError> {
        let line_end = loop {
            if let Some(eol) = memchr(b'\n', &buffer[self.buffer_start..self.buffer_end]) {
                break self.buffer_start + eol + 1;
            }
            if self.buffer_start > 0 {
                buffer.copy_within(self.buffer_start..self.buffer_end, 0);
                self.buffer_end -= self.buffer_start;
                self.buffer_start = 0;
            }
            if self.buffer_end + 1024 > buffer.len() {
                if self.buffer_end + 1024 > MAX_BUFFER_SIZE {
                    return Err(io::Error::new(
                        io::ErrorKind::OutOfMemory,
                        format!("Reached the buffer maximal size of {MAX_BUFFER_SIZE}"),
                    )
                    .into());
                }
                buffer.resize(self.buffer_end + 1024, b'\0');
            }
            let read = reader.read(&mut buffer[self.buffer_end..])?;
            if read == 0 {
                break self.buffer_end;
            }
            self.buffer_end += read;
        };
        let result = str::from_utf8(&buffer[self.buffer_start..line_end]).map_err(|e| {
            QueryResultsSyntaxError::msg(format!("Invalid UTF-8 in the TSV file: {e}")).into()
        });
        self.line_count += 1;
        self.last_line_start = self.last_line_end;
        self.last_line_end += u64::try_from(line_end - self.buffer_start).unwrap();
        self.buffer_start = line_end;
        result
    }

    #[cfg(feature = "async-tokio")]
    async fn next_line_from_tokio_async_read<'a>(
        &mut self,
        buffer: &'a mut Vec<u8>,
        reader: &mut (impl AsyncRead + Unpin),
    ) -> Result<&'a str, QueryResultsParseError> {
        let line_end = loop {
            if let Some(eol) = memchr(b'\n', &buffer[self.buffer_start..self.buffer_end]) {
                break self.buffer_start + eol + 1;
            }
            if self.buffer_start > 0 {
                buffer.copy_within(self.buffer_start..self.buffer_end, 0);
                self.buffer_end -= self.buffer_start;
                self.buffer_start = 0;
            }
            if self.buffer_end + 1024 > buffer.len() {
                if self.buffer_end + 1024 > MAX_BUFFER_SIZE {
                    return Err(io::Error::new(
                        io::ErrorKind::OutOfMemory,
                        format!("Reached the buffer maximal size of {MAX_BUFFER_SIZE}"),
                    )
                    .into());
                }
                buffer.resize(self.buffer_end + 1024, b'\0');
            }
            let read = reader.read(&mut buffer[self.buffer_end..]).await?;
            if read == 0 {
                break self.buffer_end;
            }
            self.buffer_end += read;
        };
        let result = str::from_utf8(&buffer[self.buffer_start..line_end]).map_err(|e| {
            QueryResultsSyntaxError::msg(format!("Invalid UTF-8 in the TSV file: {e}")).into()
        });
        self.line_count += 1;
        self.last_line_start = self.last_line_end;
        self.last_line_end += u64::try_from(line_end - self.buffer_start).unwrap();
        self.buffer_start = line_end;
        result
    }

    #[expect(clippy::unwrap_in_result)]
    fn next_line_from_slice<'a>(
        &mut self,
        slice: &'a [u8],
    ) -> Result<&'a str, QueryResultsSyntaxError> {
        let line_end = memchr(b'\n', &slice[self.buffer_start..])
            .map_or_else(|| slice.len(), |eol| self.buffer_start + eol + 1);
        let result = str::from_utf8(&slice[self.buffer_start..line_end]).map_err(|e| {
            QueryResultsSyntaxError::msg(format!("Invalid UTF-8 in the TSV file: {e}"))
        });
        self.line_count += 1;
        self.last_line_start = self.last_line_end;
        self.last_line_end += u64::try_from(line_end - self.buffer_start).unwrap();
        self.buffer_start = line_end;
        result
    }
}

#[cfg(test)]
#[expect(clippy::panic_in_result_fn)]
mod tests {
    use super::*;
    use std::error::Error;

    fn build_example() -> (Vec<Variable>, Vec<Vec<Option<Term>>>) {
        (
            vec![
                Variable::new_unchecked("x"),
                Variable::new_unchecked("literal"),
            ],
            vec![
                vec![
                    Some(NamedNode::new_unchecked("http://example/x").into()),
                    Some(Literal::new_simple_literal("String").into()),
                ],
                vec![
                    Some(NamedNode::new_unchecked("http://example/x").into()),
                    Some(Literal::new_simple_literal("String-with-dquote\"").into()),
                ],
                vec![
                    Some(BlankNode::new_unchecked("b0").into()),
                    Some(Literal::new_simple_literal("Blank node").into()),
                ],
                vec![
                    None,
                    Some(Literal::new_simple_literal("Missing 'x'").into()),
                ],
                vec![None, None],
                vec![
                    Some(NamedNode::new_unchecked("http://example/x").into()),
                    None,
                ],
                vec![
                    Some(BlankNode::new_unchecked("b1").into()),
                    Some(
                        Literal::new_language_tagged_literal_unchecked("String-with-lang", "en")
                            .into(),
                    ),
                ],
                vec![
                    Some(BlankNode::new_unchecked("b1").into()),
                    Some(Literal::new_typed_literal("123", xsd::INTEGER).into()),
                ],
                vec![
                    None,
                    Some(Literal::new_simple_literal("escape,\t\r\n").into()),
                ],
                #[cfg(feature = "sparql-12")]
                vec![
                    None,
                    Some(
                        Literal::new_directional_language_tagged_literal_unchecked(
                            "String-with-dir",
                            "en",
                            BaseDirection::Ltr,
                        )
                        .into(),
                    ),
                ],
            ],
        )
    }

    #[test]
    fn test_csv_serialization() {
        let (variables, solutions) = build_example();
        let mut buffer = String::new();
        let serializer = InnerCsvSolutionsSerializer::start(&mut buffer, variables.clone());
        for solution in solutions {
            serializer.write(
                &mut buffer,
                variables
                    .iter()
                    .zip(&solution)
                    .filter_map(|(v, s)| s.as_ref().map(|s| (v, s))),
            );
        }
        #[cfg_attr(not(feature = "sparql-12"), expect(unused_mut))]
        let mut expected = "x,literal\r\nhttp://example/x,String\r\nhttp://example/x,\"String-with-dquote\"\"\"\r\n_:b0,Blank node\r\n,Missing 'x'\r\n,\r\nhttp://example/x,\r\n_:b1,String-with-lang\r\n_:b1,123\r\n,\"escape,\t\r\n\"\r\n".to_owned();
        #[cfg(feature = "sparql-12")]
        {
            expected.push_str(",String-with-dir\r\n")
        }
        assert_eq!(buffer, expected);
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn test_csv_triple_term_serialization() {
        let term = Triple::new(
            NamedNode::new_unchecked("http://example.com/alice"),
            NamedNode::new_unchecked("http://example.com/says"),
            Literal::new_simple_literal(r#"Hello "Bob"."#),
        )
        .into();
        let mut output = String::new();
        write_csv_term(&mut output, &term);
        assert_eq!(
            output,
            r#""<<( http://example.com/alice http://example.com/says ""Hello """"Bob""""."" )>>""#
        );
    }

    #[test]
    fn test_tsv_roundtrip() -> Result<(), Box<dyn Error>> {
        let (variables, solutions) = build_example();

        // Write
        let mut buffer = String::new();
        let serializer = InnerTsvSolutionsSerializer::start(&mut buffer, variables.clone());
        for solution in &solutions {
            serializer.write(
                &mut buffer,
                variables
                    .iter()
                    .zip(solution)
                    .filter_map(|(v, s)| s.as_ref().map(|s| (v, s))),
            );
        }
        #[cfg_attr(not(feature = "sparql-12"), expect(unused_mut))]
        let mut expected = "?x\t?literal\n<http://example/x>\t\"String\"\n<http://example/x>\t\"String-with-dquote\\\"\"\n_:b0\t\"Blank node\"\n\t\"Missing 'x'\"\n\t\n<http://example/x>\t\n_:b1\t\"String-with-lang\"@en\n_:b1\t123\n\t\"escape,\\t\\r\\n\"\n".to_owned();
        #[cfg(feature = "sparql-12")]
        {
            expected.push_str("\t\"String-with-dir\"@en--ltr\n")
        }
        assert_eq!(buffer, expected);

        // Read
        if let SliceTsvQueryResultsParserOutput::Solutions {
            solutions: mut solutions_iter,
            variables: actual_variables,
        } = SliceTsvQueryResultsParserOutput::read(buffer.as_bytes())?
        {
            assert_eq!(actual_variables.as_slice(), variables.as_slice());
            let mut rows = Vec::new();
            while let Some(row) = solutions_iter.parse_next()? {
                rows.push(row);
            }
            assert_eq!(rows, solutions);
        } else {
            unreachable!()
        }

        Ok(())
    }

    #[test]
    fn test_tsv_single_quoted_literal_parsing() -> Result<(), Box<dyn Error>> {
        let input = "?value\n'single \"double\" and \\' apostrophe'@en\n";
        let SliceTsvQueryResultsParserOutput::Solutions {
            mut solutions,
            variables,
        } = SliceTsvQueryResultsParserOutput::read(input.as_bytes())?
        else {
            unreachable!()
        };
        assert_eq!(variables, vec![Variable::new("value")?]);
        assert_eq!(
            solutions.parse_next()?,
            Some(vec![Some(
                Literal::new_language_tagged_literal("single \"double\" and ' apostrophe", "en")?
                    .into()
            )])
        );
        assert_eq!(solutions.parse_next()?, None);
        Ok(())
    }

    #[cfg(feature = "sparql-12")]
    #[test]
    fn test_tsv_single_quoted_literal_in_triple_term() -> Result<(), Box<dyn Error>> {
        let input = "?value\n<<( <urn:s> <urn:p> 'nested \"quote\"' )>>\n";
        let SliceTsvQueryResultsParserOutput::Solutions { mut solutions, .. } =
            SliceTsvQueryResultsParserOutput::read(input.as_bytes())?
        else {
            unreachable!()
        };
        assert_eq!(
            solutions.parse_next()?,
            Some(vec![Some(
                Triple::new(
                    NamedNode::new("urn:s")?,
                    NamedNode::new("urn:p")?,
                    Literal::from("nested \"quote\"")
                )
                .into()
            )])
        );
        Ok(())
    }

    #[test]
    fn test_tsv_rejects_long_or_raw_control_string_forms() -> Result<(), Box<dyn Error>> {
        for input in [
            "?value\n\"\"\"long\"\"\"\n",
            "?value\n'''long'''\n",
            "?value\n\"raw\rcarriage\"\n",
        ] {
            let SliceTsvQueryResultsParserOutput::Solutions { mut solutions, .. } =
                SliceTsvQueryResultsParserOutput::read(input.as_bytes())?
            else {
                unreachable!()
            };
            assert!(solutions.parse_next().is_err(), "accepted {input:?}");
        }
        Ok(())
    }

    #[test]
    fn test_bad_tsv() {
        let mut bad_tsvs = vec![
            "?",
            "?p",
            "?p?o",
            "?p\n<",
            "?p\n_",
            "?p\n_:",
            "?p\n\"",
            "?p\n<<",
            "?p\n<<(",
            "?p\n1\t2\n",
            "?p\n\n",
        ];
        let a_lot_of_strings = format!("?p\n{}\n", "<".repeat(100_000));
        bad_tsvs.push(&a_lot_of_strings);
        for bad_tsv in bad_tsvs {
            if let Ok(ReaderTsvQueryResultsParserOutput::Solutions { mut solutions, .. }) =
                ReaderTsvQueryResultsParserOutput::read(bad_tsv.as_bytes())
            {
                while let Ok(Some(_)) = solutions.parse_next() {}
            }
        }
    }

    #[test]
    fn test_no_columns_csv_serialization() {
        let mut buffer = String::new();
        let serializer = InnerCsvSolutionsSerializer::start(&mut buffer, Vec::new());
        serializer.write(&mut buffer, []);
        assert_eq!(buffer, "\r\n\r\n");
    }

    #[test]
    fn test_no_columns_tsv_serialization() {
        let mut buffer = String::new();
        let serializer = InnerTsvSolutionsSerializer::start(&mut buffer, Vec::new());
        serializer.write(&mut buffer, []);
        assert_eq!(buffer, "\n\n");
    }

    #[test]
    fn test_no_columns_tsv_parsing() -> io::Result<()> {
        if let ReaderTsvQueryResultsParserOutput::Solutions {
            mut solutions,
            variables,
        } = ReaderTsvQueryResultsParserOutput::read(b"\n\n".as_slice())?
        {
            assert_eq!(variables, Vec::<Variable>::new());
            assert_eq!(solutions.parse_next()?, Some(Vec::new()));
            assert_eq!(solutions.parse_next()?, None);
        } else {
            unreachable!()
        }
        Ok(())
    }

    #[test]
    fn test_no_results_csv_serialization() {
        let mut buffer = String::new();
        InnerCsvSolutionsSerializer::start(&mut buffer, vec![Variable::new_unchecked("a")]);
        assert_eq!(buffer, "a\r\n");
    }

    #[test]
    fn test_no_results_tsv_serialization() {
        let mut buffer = String::new();
        InnerTsvSolutionsSerializer::start(&mut buffer, vec![Variable::new_unchecked("a")]);
        assert_eq!(buffer, "?a\n");
    }

    #[test]
    fn test_no_results_tsv_parsing() -> io::Result<()> {
        if let ReaderTsvQueryResultsParserOutput::Solutions {
            mut solutions,
            variables,
        } = ReaderTsvQueryResultsParserOutput::read(b"?a\n".as_slice())?
        {
            assert_eq!(variables, vec![Variable::new_unchecked("a")]);
            assert_eq!(solutions.parse_next()?, None);
        } else {
            unreachable!()
        }
        Ok(())
    }
}
