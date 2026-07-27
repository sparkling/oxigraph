use super::PLAIN_LITERAL;
use oxrdf::{Literal, NamedNode, vocab::rdf, vocab::xsd};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct TextValue {
    text: String,
    language: Option<String>,
    direction: Option<String>,
}

pub(super) fn string_datatype(datatype: &NamedNode) -> bool {
    [
        xsd::STRING,
        xsd::NORMALIZED_STRING,
        xsd::TOKEN,
        xsd::LANGUAGE,
        xsd::NAME,
        xsd::NC_NAME,
        xsd::NMTOKEN,
    ]
    .contains(datatype)
}

pub(super) fn parse_text(literal: &Literal) -> Option<TextValue> {
    let datatype = literal.datatype();
    if datatype == &PLAIN_LITERAL {
        let (text, language) = literal.value().rsplit_once('@')?;
        if !xml_chars(text) || (!language.is_empty() && !valid_language_tag(language)) {
            return None;
        }
        return Some(TextValue {
            text: text.to_owned(),
            language: (!language.is_empty()).then(|| language.to_ascii_lowercase()),
            direction: None,
        });
    }
    let text = if datatype == &xsd::STRING {
        literal.value().to_owned()
    } else if datatype == &xsd::NORMALIZED_STRING {
        replace_whitespace(literal.value())
    } else {
        collapse_whitespace(literal.value())
    };
    if !xml_chars(&text) || !text_in_xsd_datatype(&text, datatype) {
        return None;
    }
    Some(TextValue {
        text,
        language: None,
        direction: None,
    })
}

#[cfg_attr(
    not(feature = "rdf-12"),
    expect(
        unused_variables,
        reason = "the RDF 1.1 build keeps the common datatype-call signature"
    )
)]
pub(super) fn parse_language_text(literal: &Literal, directional: bool) -> Option<TextValue> {
    let language = literal.language()?;
    if !xml_chars(literal.value()) || !valid_language_tag(language) {
        return None;
    }
    #[cfg(feature = "rdf-12")]
    let direction = if directional {
        Some(literal.direction()?.to_string())
    } else {
        None
    };
    #[cfg(not(feature = "rdf-12"))]
    let direction = None;
    Some(TextValue {
        text: literal.value().to_owned(),
        language: Some(language.to_ascii_lowercase()),
        direction,
    })
}

pub(super) fn text_in_datatype(value: &TextValue, datatype: &NamedNode) -> bool {
    if datatype == &PLAIN_LITERAL {
        return value.direction.is_none();
    }
    if datatype == &rdf::LANG_STRING {
        return value.language.is_some() && value.direction.is_none();
    }
    #[cfg(feature = "rdf-12")]
    if datatype == &rdf::DIR_LANG_STRING {
        return value.language.is_some() && value.direction.is_some();
    }
    value.language.is_none()
        && value.direction.is_none()
        && string_datatype(datatype)
        && text_in_xsd_datatype(&value.text, datatype)
}

fn text_in_xsd_datatype(value: &str, datatype: &NamedNode) -> bool {
    if datatype == &xsd::STRING {
        true
    } else if datatype == &xsd::NORMALIZED_STRING {
        !value.bytes().any(is_replaceable_whitespace)
    } else if datatype == &xsd::TOKEN {
        token_value(value)
    } else if datatype == &xsd::LANGUAGE {
        token_value(value) && valid_xsd_language(value)
    } else if datatype == &xsd::NAME {
        token_value(value) && valid_xml_name(value, true)
    } else if datatype == &xsd::NC_NAME {
        token_value(value) && valid_xml_name(value, false)
    } else {
        datatype == &xsd::NMTOKEN
            && token_value(value)
            && !value.is_empty()
            && value
                .chars()
                .all(|character| xml_name_character(character, true))
    }
}

fn replace_whitespace(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if matches!(character, '\t' | '\n' | '\r') {
                ' '
            } else {
                character
            }
        })
        .collect()
}

pub(super) fn collapse_whitespace(value: &str) -> String {
    replace_whitespace(value)
        .split(' ')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn token_value(value: &str) -> bool {
    collapse_whitespace(value) == value
}

fn valid_xsd_language(value: &str) -> bool {
    let mut parts = value.split('-');
    let Some(first) = parts.next() else {
        return false;
    };
    (1..=8).contains(&first.len())
        && first.bytes().all(|byte| byte.is_ascii_alphabetic())
        && parts.all(|part| {
            (1..=8).contains(&part.len()) && part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
}

fn valid_language_tag(value: &str) -> bool {
    Literal::new_language_tagged_literal("", value.to_owned()).is_ok()
}

pub(super) fn valid_xml_name(value: &str, allow_colon: bool) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| xml_name_start(character, allow_colon))
        && characters.all(|character| xml_name_character(character, allow_colon))
}

fn xml_name_start(character: char, allow_colon: bool) -> bool {
    let value = u32::from(character);
    (allow_colon && character == ':')
        || character == '_'
        || character.is_ascii_alphabetic()
        || matches!(
            value,
            0xC0..=0xD6
                | 0xD8..=0xF6
                | 0xF8..=0x2FF
                | 0x370..=0x37D
                | 0x37F..=0x1FFF
                | 0x200C..=0x200D
                | 0x2070..=0x218F
                | 0x2C00..=0x2FEF
                | 0x3001..=0xD7FF
                | 0xF900..=0xFDCF
                | 0xFDF0..=0xFFFD
                | 0x10000..=0xEFFFF
        )
}

fn xml_name_character(character: char, allow_colon: bool) -> bool {
    let value = u32::from(character);
    xml_name_start(character, allow_colon)
        || character.is_ascii_digit()
        || matches!(character, '-' | '.')
        || value == 0xB7
        || matches!(value, 0x0300..=0x036F | 0x203F..=0x2040)
}

pub(super) fn xml_chars(value: &str) -> bool {
    value.chars().all(|character| {
        matches!(
            u32::from(character),
            0x9 | 0xA | 0xD | 0x20..=0xD7FF | 0xE000..=0xFFFD | 0x10000..=0x10_FFFF
        )
    })
}

const fn is_replaceable_whitespace(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | b'\r')
}
