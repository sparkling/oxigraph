use super::text::{valid_xml_name, xml_chars};

/// Recognizes a deliberately conservative, self-contained XML fragment subset.
///
/// Full XML canonicalization is not approximated here. Accepting only constructs
/// whose well-formedness can be established locally prevents false datatype
/// equality and difference conclusions.
pub(super) fn safe_xml_fragment(value: &str) -> bool {
    if !xml_chars(value) {
        return false;
    }
    let mut rest = value;
    let mut elements = Vec::<String>::new();
    while let Some(start) = rest.find('<') {
        if !valid_character_data(&rest[..start]) {
            return false;
        }
        rest = &rest[start..];
        if let Some(after) = rest.strip_prefix("<!--") {
            let Some(end) = after.find("-->") else {
                return false;
            };
            if after[..end].contains("--") || after[..end].ends_with('-') {
                return false;
            }
            rest = &after[end + 3..];
        } else if let Some(after) = rest.strip_prefix("<![CDATA[") {
            let Some(end) = after.find("]]>") else {
                return false;
            };
            rest = &after[end + 3..];
        } else if let Some(after) = rest.strip_prefix("<?") {
            let Some(end) = after.find("?>") else {
                return false;
            };
            if !valid_processing_instruction(&after[..end]) {
                return false;
            }
            rest = &after[end + 2..];
        } else {
            let Some(end) = tag_end(rest) else {
                return false;
            };
            if !consume_tag(&rest[1..end], &mut elements) {
                return false;
            }
            rest = &rest[end + 1..];
        }
    }
    elements.is_empty() && valid_character_data(rest)
}

fn valid_processing_instruction(value: &str) -> bool {
    let target_end = value.find(char::is_whitespace).unwrap_or(value.len());
    let target = &value[..target_end];
    valid_xml_name(target, false) && !target.eq_ignore_ascii_case("xml")
}

fn tag_end(value: &str) -> Option<usize> {
    let mut quote = None;
    for (index, character) in value.char_indices().skip(1) {
        if matches!(character, '\'' | '"') {
            if quote == Some(character) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(character);
            }
        } else if character == '>' && quote.is_none() {
            return Some(index);
        }
    }
    None
}

fn consume_tag(value: &str, elements: &mut Vec<String>) -> bool {
    let value = value.trim();
    if value.starts_with('!') || value.starts_with('?') || value.is_empty() {
        return false;
    }
    if let Some(name) = value.strip_prefix('/') {
        let name = name.trim();
        return valid_xml_name(name, false) && elements.pop().as_deref() == Some(name);
    }
    let (value, empty) = value
        .strip_suffix('/')
        .map_or((value, false), |value| (value.trim_end(), true));
    let name_end = value.find(char::is_whitespace).unwrap_or(value.len());
    let name = &value[..name_end];
    if !valid_xml_name(name, false) || !valid_attributes(&value[name_end..]) {
        return false;
    }
    if !empty {
        elements.push(name.to_owned());
    }
    true
}

fn valid_attributes(mut value: &str) -> bool {
    let mut names = Vec::new();
    loop {
        let had_separator = value.chars().next().is_some_and(char::is_whitespace);
        value = value.trim_start();
        if value.is_empty() {
            return true;
        }
        if !had_separator {
            return false;
        }
        let name_end = value
            .find(|character: char| character.is_whitespace() || character == '=')
            .unwrap_or(value.len());
        let name = &value[..name_end];
        if !valid_xml_name(name, false) || names.contains(&name) {
            return false;
        }
        names.push(name);
        value = value[name_end..].trim_start();
        let Some(after_equals) = value.strip_prefix('=') else {
            return false;
        };
        value = after_equals.trim_start();
        let Some(quote @ ('\'' | '"')) = value.chars().next() else {
            return false;
        };
        let after_quote = &value[quote.len_utf8()..];
        let Some(end) = after_quote.find(quote) else {
            return false;
        };
        if after_quote[..end].contains('<') || !valid_entities(&after_quote[..end]) {
            return false;
        }
        value = &after_quote[end + quote.len_utf8()..];
    }
}

fn valid_character_data(value: &str) -> bool {
    !value.contains("]]>") && valid_entities(value)
}

fn valid_entities(mut value: &str) -> bool {
    while let Some(start) = value.find('&') {
        let after = &value[start + 1..];
        let Some(end) = after.find(';') else {
            return false;
        };
        let entity = &after[..end];
        let valid = matches!(entity, "amp" | "lt" | "gt" | "apos" | "quot")
            || entity
                .strip_prefix("#x")
                .and_then(|value| u32::from_str_radix(value, 16).ok())
                .and_then(char::from_u32)
                .is_some_and(valid_reference_character)
            || entity
                .strip_prefix('#')
                .and_then(|value| value.parse::<u32>().ok())
                .and_then(char::from_u32)
                .is_some_and(valid_reference_character);
        if !valid {
            return false;
        }
        value = &after[end + 1..];
    }
    true
}

fn valid_reference_character(value: char) -> bool {
    let mut buffer = [0; 4];
    xml_chars(value.encode_utf8(&mut buffer))
}
