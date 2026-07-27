use crate::RdfFormat;
use oxjsonld::{JsonLdProfile, JsonLdProfileSet};
use oxrdf::RdfVersion;
use std::fmt;

/// A supported character encoding declared by an RDF media type.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash)]
#[non_exhaustive]
pub enum RdfCharset {
    /// UTF-8 (`utf-8` or the legacy `utf8` spelling).
    Utf8,
    /// US-ASCII (`us-ascii` or the legacy `ascii` spelling).
    UsAscii,
}

/// A parsed RDF media type, including parameters that affect RDF processing.
///
/// Unlike [`RdfFormat::from_media_type`], this descriptor retains the RDF
/// `version`, every `profile` URI, and the declared `charset`.
#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub struct RdfMediaType {
    format: RdfFormat,
    version: Option<RdfVersion>,
    profiles: Vec<String>,
    charset: Option<RdfCharset>,
}

impl RdfMediaType {
    /// Parses an RDF media type and all supported processing parameters.
    pub fn parse(value: &str) -> Result<Self, RdfMediaTypeParseError> {
        let fields = split_fields(value)?;
        let type_subtype = fields.first().ok_or(RdfMediaTypeParseError::Malformed)?;
        let (top_level, subtype) = type_subtype
            .split_once('/')
            .ok_or(RdfMediaTypeParseError::Malformed)?;
        let top_level = top_level.trim();
        if !top_level.eq_ignore_ascii_case("application") && !top_level.eq_ignore_ascii_case("text")
        {
            return Err(RdfMediaTypeParseError::Unsupported);
        }
        let mut subtype = subtype.trim().to_ascii_lowercase();
        if let Some(without_prefix) = subtype.strip_prefix("x-") {
            subtype = without_prefix.to_owned();
        }
        let mut format =
            format_from_subtype(top_level, &subtype).ok_or(RdfMediaTypeParseError::Unsupported)?;
        let mut version = None;
        let mut profiles = Vec::new();
        let mut charset = None;
        for field in fields.iter().skip(1) {
            let (name, raw_value) = field
                .split_once('=')
                .ok_or(RdfMediaTypeParseError::Malformed)?;
            let name = name.trim();
            if name.is_empty() {
                return Err(RdfMediaTypeParseError::Malformed);
            }
            let value = parse_parameter_value(raw_value.trim())?;
            if name.eq_ignore_ascii_case("charset") {
                let parsed = parse_charset(&value)?;
                if charset.replace(parsed).is_some() {
                    return Err(RdfMediaTypeParseError::DuplicateParameter("charset"));
                }
            } else if name.eq_ignore_ascii_case("version") {
                let parsed = parse_version(&value)?;
                if version.replace(parsed).is_some() {
                    return Err(RdfMediaTypeParseError::DuplicateParameter("version"));
                }
            } else if name.eq_ignore_ascii_case("profile") {
                let values = value
                    .split_ascii_whitespace()
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>();
                if values.is_empty() {
                    return Err(RdfMediaTypeParseError::EmptyProfile);
                }
                profiles.extend(values);
            }
        }
        if let RdfFormat::JsonLd { profile } = &mut format {
            for value in &profiles {
                if let Some(value) = JsonLdProfile::from_iri(value) {
                    *profile |= value;
                }
            }
        }
        if charset == Some(RdfCharset::UsAscii) && format != RdfFormat::NTriplesTextPlain {
            return Err(RdfMediaTypeParseError::UnsupportedCharset(
                "us-ascii".to_owned(),
            ));
        }
        Ok(Self {
            format,
            version,
            profiles,
            charset,
        })
    }

    /// Returns the RDF serialization format.
    pub const fn format(&self) -> RdfFormat {
        self.format
    }

    /// Returns the media-type RDF version parameter, if present.
    pub const fn version(&self) -> Option<RdfVersion> {
        self.version
    }

    /// Returns all profile URIs in declaration order.
    pub fn profiles(&self) -> &[String] {
        &self.profiles
    }

    /// Returns the declared character encoding, if present.
    pub const fn charset(&self) -> Option<RdfCharset> {
        self.charset
    }
}

impl std::str::FromStr for RdfMediaType {
    type Err = RdfMediaTypeParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

/// Error returned when parsing an RDF media type.
#[derive(Debug, Clone, Eq, PartialEq)]
#[non_exhaustive]
pub enum RdfMediaTypeParseError {
    /// The media type or one of its parameters is malformed.
    Malformed,
    /// The media type is well-formed but is not an RDF media type supported by
    /// this crate.
    Unsupported,
    /// A processing parameter that must occur at most once was repeated.
    DuplicateParameter(&'static str),
    /// The charset is not supported by the RDF parsers.
    UnsupportedCharset(String),
    /// The RDF version label is not supported.
    UnsupportedVersion(String),
    /// The profile parameter did not contain a profile URI.
    EmptyProfile,
}

impl fmt::Display for RdfMediaTypeParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed => f.write_str("malformed RDF media type"),
            Self::Unsupported => f.write_str("unsupported RDF media type"),
            Self::DuplicateParameter(name) => {
                write!(f, "duplicate '{name}' media type parameter")
            }
            Self::UnsupportedCharset(value) => {
                write!(f, "unsupported RDF character encoding '{value}'")
            }
            Self::UnsupportedVersion(value) => {
                write!(f, "unsupported RDF version label '{value}'")
            }
            Self::EmptyProfile => f.write_str("the RDF profile parameter is empty"),
        }
    }
}

impl std::error::Error for RdfMediaTypeParseError {}

fn format_from_subtype(top_level: &str, subtype: &str) -> Option<RdfFormat> {
    let format = match subtype {
        "activity+json" | "json" | "ld+json" | "jsonld" => RdfFormat::JsonLd {
            profile: JsonLdProfileSet::empty(),
        },
        "n-quads" | "nquads" => RdfFormat::NQuads,
        "n-triples" | "ntriples" => RdfFormat::NTriples,
        "n3" => RdfFormat::N3,
        "plain" if top_level.eq_ignore_ascii_case("text") => RdfFormat::NTriplesTextPlain,
        "rdf+xml" | "xml" => RdfFormat::RdfXml,
        "trig" => RdfFormat::TriG,
        "turtle" => RdfFormat::Turtle,
        _ => return None,
    };
    Some(format)
}

fn parse_charset(value: &str) -> Result<RdfCharset, RdfMediaTypeParseError> {
    if value.eq_ignore_ascii_case("utf-8") || value.eq_ignore_ascii_case("utf8") {
        Ok(RdfCharset::Utf8)
    } else if value.eq_ignore_ascii_case("us-ascii") || value.eq_ignore_ascii_case("ascii") {
        Ok(RdfCharset::UsAscii)
    } else {
        Err(RdfMediaTypeParseError::UnsupportedCharset(value.to_owned()))
    }
}

fn parse_version(value: &str) -> Result<RdfVersion, RdfMediaTypeParseError> {
    match value {
        "1.1" => Ok(RdfVersion::V1_1),
        "1.2-basic" => Ok(RdfVersion::V1_2Basic),
        "1.2" => Ok(RdfVersion::V1_2),
        _ => Err(RdfMediaTypeParseError::UnsupportedVersion(value.to_owned())),
    }
}

fn split_fields(value: &str) -> Result<Vec<&str>, RdfMediaTypeParseError> {
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
        return Err(RdfMediaTypeParseError::Malformed);
    }
    fields.push(value[start..].trim());
    if fields.iter().any(|field| field.is_empty()) {
        return Err(RdfMediaTypeParseError::Malformed);
    }
    Ok(fields)
}

fn parse_parameter_value(value: &str) -> Result<String, RdfMediaTypeParseError> {
    if let Some(value) = value.strip_prefix('"') {
        let value = value
            .strip_suffix('"')
            .ok_or(RdfMediaTypeParseError::Malformed)?;
        let mut output = String::with_capacity(value.len());
        let mut escaped = false;
        for character in value.chars() {
            if escaped {
                output.push(character);
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                return Err(RdfMediaTypeParseError::Malformed);
            } else {
                output.push(character);
            }
        }
        if escaped {
            return Err(RdfMediaTypeParseError::Malformed);
        }
        Ok(output)
    } else if value.contains('"') || value.is_empty() {
        Err(RdfMediaTypeParseError::Malformed)
    } else {
        Ok(value.to_owned())
    }
}

#[cfg(test)]
mod tests {
    #![expect(clippy::panic_in_result_fn)]

    use super::*;
    use std::error::Error;

    #[test]
    fn parameters_are_retained_and_case_insensitive() -> Result<(), Box<dyn Error>> {
        let descriptor = RdfMediaType::parse(concat!(
            "Text/Turtle; VERSION=\"1.2-basic\";",
            " PROFILE=\"https://example.com/a https://example.com/b\";",
            " CHARSET=\"UTF-8\"",
        ))?;
        assert_eq!(descriptor.format(), RdfFormat::Turtle);
        assert_eq!(descriptor.version(), Some(RdfVersion::V1_2Basic));
        assert_eq!(
            descriptor.profiles(),
            ["https://example.com/a", "https://example.com/b"]
        );
        assert_eq!(descriptor.charset(), Some(RdfCharset::Utf8));
        Ok(())
    }

    #[test]
    fn quoted_semicolons_and_json_ld_profiles_are_parsed() -> Result<(), Box<dyn Error>> {
        let descriptor = RdfMediaType::parse(concat!(
            "application/ld+json;",
            "profile=\"https://example.com/a;b ",
            "http://www.w3.org/ns/json-ld#streaming\"",
        ))?;
        assert_eq!(
            descriptor.format(),
            RdfFormat::JsonLd {
                profile: JsonLdProfile::Streaming.into()
            }
        );
        assert_eq!(descriptor.profiles()[0], "https://example.com/a;b");
        Ok(())
    }

    #[test]
    fn unsupported_or_malformed_parameters_fail_closed() -> Result<(), Box<dyn Error>> {
        assert!(matches!(
            RdfMediaType::parse("text/turtle; Charset=iso-8859-1"),
            Err(RdfMediaTypeParseError::UnsupportedCharset(_))
        ));
        assert!(matches!(
            RdfMediaType::parse("application/n-triples; charset=us-ascii"),
            Err(RdfMediaTypeParseError::UnsupportedCharset(_))
        ));
        let text_plain = RdfMediaType::parse("text/plain; charset=us-ascii")?;
        assert_eq!(text_plain.charset(), Some(RdfCharset::UsAscii));
        assert!(matches!(
            RdfMediaType::parse("text/turtle; version=9.9"),
            Err(RdfMediaTypeParseError::UnsupportedVersion(_))
        ));
        assert!(matches!(
            RdfMediaType::parse("text/turtle; charset=\"utf-8"),
            Err(RdfMediaTypeParseError::Malformed)
        ));
        assert!(matches!(
            RdfMediaType::parse("text/turtle; version=1.2; VERSION=1.1"),
            Err(RdfMediaTypeParseError::DuplicateParameter("version"))
        ));
        Ok(())
    }
}
