use crate::srl::SrlError;
use crate::srl::lexer::chars::{is_pn_chars, is_pn_chars_base, is_pn_chars_u};

pub(super) fn is_builtin(value: &str) -> bool {
    [
        "STR",
        "LANG",
        "LANGMATCHES",
        "LANGDIR",
        "DATATYPE",
        "IRI",
        "URI",
        "BNODE",
        "ABS",
        "CEIL",
        "FLOOR",
        "ROUND",
        "CONCAT",
        "SUBSTR",
        "STRLEN",
        "REPLACE",
        "UCASE",
        "LCASE",
        "ENCODE_FOR_URI",
        "CONTAINS",
        "STRSTARTS",
        "STRENDS",
        "STRBEFORE",
        "STRAFTER",
        "YEAR",
        "MONTH",
        "DAY",
        "HOURS",
        "MINUTES",
        "SECONDS",
        "TIMEZONE",
        "TZ",
        "NOW",
        "UUID",
        "STRUUID",
        "IF",
        "STRLANG",
        "STRLANGDIR",
        "STRDT",
        "sameTerm",
        "isIRI",
        "isURI",
        "isBLANK",
        "isLITERAL",
        "isNUMERIC",
        "hasLANG",
        "hasLANGDIR",
        "REGEX",
        "isTRIPLE",
        "TRIPLE",
        "SUBJECT",
        "PREDICATE",
        "OBJECT",
    ]
    .iter()
    .any(|candidate| value.eq_ignore_ascii_case(candidate))
}

pub(super) fn valid_builtin_arity(value: &str, arity: usize) -> bool {
    let matches = |name: &str| value.eq_ignore_ascii_case(name);
    if matches("BNODE") {
        return arity <= 1;
    }
    if matches("CONCAT") {
        return true;
    }
    if matches("SUBSTR") || matches("REGEX") {
        return (2..=3).contains(&arity);
    }
    if matches("REPLACE") {
        return (3..=4).contains(&arity);
    }
    if [
        "LANGMATCHES",
        "CONTAINS",
        "STRSTARTS",
        "STRENDS",
        "STRBEFORE",
        "STRAFTER",
        "STRLANG",
        "STRDT",
        "sameTerm",
    ]
    .iter()
    .any(|name| matches(name))
    {
        return arity == 2;
    }
    if ["IF", "STRLANGDIR", "TRIPLE"]
        .iter()
        .any(|name| matches(name))
    {
        return arity == 3;
    }
    if ["NOW", "UUID", "STRUUID"].iter().any(|name| matches(name)) {
        return arity == 0;
    }
    arity == 1
}

pub(super) fn unescape_local(value: &str) -> Result<String, SrlError> {
    let mut output = String::new();
    let mut chars = value.chars();
    while let Some(value) = chars.next() {
        if value == '\\' {
            let Some(escaped) = chars.next() else {
                return Err(SrlError::Syntax {
                    line: 0,
                    column: 0,
                    message: "trailing escape in prefixed name".to_owned(),
                });
            };
            output.push(escaped);
        } else {
            output.push(value);
        }
    }
    Ok(output)
}

pub(super) fn valid_prefix_name(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let mut chars = value.chars();
    chars.next().is_some_and(is_pn_chars_base)
        && !value.ends_with('.')
        && chars.all(|value| is_pn_chars(value) || value == '.')
}

pub(super) fn valid_local_name(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    let chars = value.chars().collect::<Vec<_>>();
    if !is_local_start(chars[0]) {
        return false;
    }
    let mut index = 0;
    while index < chars.len() {
        match chars[index] {
            '%' => {
                if index + 2 >= chars.len()
                    || !chars[index + 1].is_ascii_hexdigit()
                    || !chars[index + 2].is_ascii_hexdigit()
                {
                    return false;
                }
                index += 3;
            }
            '\\' => {
                if index + 1 >= chars.len() || !is_local_escape(chars[index + 1]) {
                    return false;
                }
                index += 2;
            }
            '.' if index + 1 == chars.len() => return false,
            value if is_local_char(value) => index += 1,
            _ => return false,
        }
    }
    true
}

fn is_local_start(value: char) -> bool {
    is_pn_chars_u(value) || value.is_ascii_digit() || matches!(value, ':' | '%' | '\\')
}

fn is_local_char(value: char) -> bool {
    is_pn_chars(value) || matches!(value, ':' | '.' | '%' | '\\')
}

fn is_local_escape(value: char) -> bool {
    matches!(
        value,
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
