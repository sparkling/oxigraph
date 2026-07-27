use crate::QueryResultsFormat;
use oxrdf::RdfVersion;
use std::fmt;

/// A supported character encoding declared by a SPARQL results media type.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum QueryResultsCharset {
    /// UTF-8 (`utf-8` or the legacy `utf8` spelling).
    Utf8,
    /// US-ASCII (`us-ascii` or the legacy `ascii` spelling).
    UsAscii,
}

/// A parsed SPARQL results media type and its processing parameters.
///
/// Unlike [`QueryResultsFormat::from_media_type`], this descriptor retains
/// `version` and `charset` parameters.
#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub struct QueryResultsMediaType {
    format: QueryResultsFormat,
    version: Option<RdfVersion>,
    charset: Option<QueryResultsCharset>,
}

impl QueryResultsMediaType {
    /// Parses a SPARQL results media type and all supported processing
    /// parameters.
    pub fn parse(value: &str) -> Result<Self, QueryResultsMediaTypeParseError> {
        let fields = split_fields(value)?;
        let type_subtype = fields
            .first()
            .ok_or(QueryResultsMediaTypeParseError::Malformed)?;
        let is_text_media_type = type_subtype
            .split_once('/')
            .is_some_and(|(r#type, _)| r#type.trim().eq_ignore_ascii_case("text"));
        let format = QueryResultsFormat::from_media_type(type_subtype)
            .ok_or(QueryResultsMediaTypeParseError::Unsupported)?;
        let mut version = None;
        let mut charset = None;
        let mut csv_header = None;
        for field in fields.iter().skip(1) {
            let (name, raw_value) = field
                .split_once('=')
                .ok_or(QueryResultsMediaTypeParseError::Malformed)?;
            let name = name.trim();
            if name.is_empty() {
                return Err(QueryResultsMediaTypeParseError::Malformed);
            }
            let value = parse_parameter_value(raw_value.trim())?;
            if name.eq_ignore_ascii_case("charset") {
                let parsed = parse_charset(&value)?;
                if charset.replace(parsed).is_some() {
                    return Err(QueryResultsMediaTypeParseError::DuplicateParameter(
                        "charset",
                    ));
                }
            } else if name.eq_ignore_ascii_case("version") {
                let parsed = parse_version(&value)?;
                if version.replace(parsed).is_some() {
                    return Err(QueryResultsMediaTypeParseError::DuplicateParameter(
                        "version",
                    ));
                }
            } else if format == QueryResultsFormat::Csv && name.eq_ignore_ascii_case("header") {
                if csv_header.replace(()).is_some() {
                    return Err(QueryResultsMediaTypeParseError::DuplicateParameter(
                        "header",
                    ));
                }
                if !value.eq_ignore_ascii_case("present") {
                    return Err(QueryResultsMediaTypeParseError::UnsupportedCsvHeader(value));
                }
            }
        }
        if version.is_some()
            && !matches!(format, QueryResultsFormat::Json | QueryResultsFormat::Xml)
        {
            return Err(QueryResultsMediaTypeParseError::VersionNotSupportedForFormat { format });
        }
        if is_text_media_type
            && charset.is_none()
            && matches!(format, QueryResultsFormat::Csv | QueryResultsFormat::Tsv)
        {
            charset = Some(QueryResultsCharset::UsAscii);
        }
        Ok(Self {
            format,
            version,
            charset,
        })
    }

    /// Returns the SPARQL results serialization format.
    pub const fn format(&self) -> QueryResultsFormat {
        self.format
    }

    /// Returns the media-type version parameter, if present.
    pub const fn version(&self) -> Option<RdfVersion> {
        self.version
    }

    /// Returns the declared character encoding, if present.
    pub const fn charset(&self) -> Option<QueryResultsCharset> {
        self.charset
    }
}

impl std::str::FromStr for QueryResultsMediaType {
    type Err = QueryResultsMediaTypeParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

/// Error returned when parsing a SPARQL results media type.
#[derive(Debug, Clone, Eq, PartialEq)]
#[non_exhaustive]
pub enum QueryResultsMediaTypeParseError {
    /// The media type or one of its parameters is malformed.
    Malformed,
    /// The media type is not a supported SPARQL results media type.
    Unsupported,
    /// A processing parameter that must occur at most once was repeated.
    DuplicateParameter(&'static str),
    /// The charset is not supported by the SPARQL results parsers.
    UnsupportedCharset(String),
    /// A CSV media type declared a header mode other than `present`.
    UnsupportedCsvHeader(String),
    /// The SPARQL results version label is not supported.
    UnsupportedVersion(String),
    /// The selected format does not support a version parameter.
    VersionNotSupportedForFormat {
        /// The selected serialization format.
        format: QueryResultsFormat,
    },
}

impl fmt::Display for QueryResultsMediaTypeParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed => f.write_str("malformed SPARQL results media type"),
            Self::Unsupported => f.write_str("unsupported SPARQL results media type"),
            Self::DuplicateParameter(name) => {
                write!(f, "duplicate '{name}' media type parameter")
            }
            Self::UnsupportedCharset(value) => {
                write!(f, "unsupported SPARQL results character encoding '{value}'")
            }
            Self::UnsupportedCsvHeader(value) => {
                write!(f, "unsupported SPARQL CSV header mode '{value}'")
            }
            Self::UnsupportedVersion(value) => {
                write!(f, "unsupported SPARQL results version label '{value}'")
            }
            Self::VersionNotSupportedForFormat { format } => {
                write!(f, "SPARQL results version cannot be declared for {format}")
            }
        }
    }
}

impl std::error::Error for QueryResultsMediaTypeParseError {}

fn parse_charset(value: &str) -> Result<QueryResultsCharset, QueryResultsMediaTypeParseError> {
    if value.eq_ignore_ascii_case("utf-8") || value.eq_ignore_ascii_case("utf8") {
        Ok(QueryResultsCharset::Utf8)
    } else if value.eq_ignore_ascii_case("us-ascii") || value.eq_ignore_ascii_case("ascii") {
        Ok(QueryResultsCharset::UsAscii)
    } else {
        Err(QueryResultsMediaTypeParseError::UnsupportedCharset(
            value.to_owned(),
        ))
    }
}

fn parse_version(value: &str) -> Result<RdfVersion, QueryResultsMediaTypeParseError> {
    match value {
        "1.1" => Ok(RdfVersion::V1_1),
        "1.2-basic" => Ok(RdfVersion::V1_2Basic),
        "1.2" => Ok(RdfVersion::V1_2),
        _ => Err(QueryResultsMediaTypeParseError::UnsupportedVersion(
            value.to_owned(),
        )),
    }
}

fn split_fields(value: &str) -> Result<Vec<&str>, QueryResultsMediaTypeParseError> {
    let mut fields = Vec::new();
    let mut start = 0;
    let mut quoted = false;
    let mut escaped = false;
    for (index, character) in value.char_indices() {
        if quoted {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                quoted = false;
            }
        } else if character == '"' {
            quoted = true;
        } else if character == ';' {
            fields.push(value[start..index].trim());
            start = index + character.len_utf8();
        }
    }
    if quoted || escaped {
        return Err(QueryResultsMediaTypeParseError::Malformed);
    }
    fields.push(value[start..].trim());
    if fields.iter().any(|field| field.is_empty()) {
        return Err(QueryResultsMediaTypeParseError::Malformed);
    }
    Ok(fields)
}

fn parse_parameter_value(value: &str) -> Result<String, QueryResultsMediaTypeParseError> {
    if let Some(value) = value.strip_prefix('"') {
        let value = value
            .strip_suffix('"')
            .ok_or(QueryResultsMediaTypeParseError::Malformed)?;
        let mut output = String::with_capacity(value.len());
        let mut escaped = false;
        for character in value.chars() {
            if escaped {
                output.push(character);
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                return Err(QueryResultsMediaTypeParseError::Malformed);
            } else {
                output.push(character);
            }
        }
        if escaped {
            return Err(QueryResultsMediaTypeParseError::Malformed);
        }
        Ok(output)
    } else if value.contains('"') || value.is_empty() {
        Err(QueryResultsMediaTypeParseError::Malformed)
    } else {
        Ok(value.to_owned())
    }
}
