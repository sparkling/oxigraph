use json_event_parser::{JsonEvent, SliceJsonParser};
use std::collections::BTreeMap;

#[derive(Debug, PartialEq)]
enum JsonValue {
    Null,
    Boolean(bool),
    Number(u64),
    String(String),
    Array(Vec<Self>),
    Object(BTreeMap<String, Self>),
}

pub(super) fn json_equal(left: &str, right: &str) -> bool {
    parse(left).is_some_and(|left| parse(right).is_some_and(|right| left == right))
}

pub(super) fn json_is_valid(input: &str) -> bool {
    parse(input).is_some()
}

fn parse(input: &str) -> Option<JsonValue> {
    let mut parser = SliceJsonParser::new(input.as_bytes());
    let first = parser.parse_next().ok()?;
    let value = parse_value(&mut parser, first)?;
    (parser.parse_next().ok()? == JsonEvent::Eof).then_some(value)
}

fn parse_value(parser: &mut SliceJsonParser<'_>, event: JsonEvent<'_>) -> Option<JsonValue> {
    match event {
        JsonEvent::Null => Some(JsonValue::Null),
        JsonEvent::Boolean(value) => Some(JsonValue::Boolean(value)),
        JsonEvent::Number(value) => Some(JsonValue::Number(
            value.parse::<f64>().ok().map(f64::to_bits)?,
        )),
        JsonEvent::String(value) => Some(JsonValue::String(value.into_owned())),
        JsonEvent::StartArray => {
            let mut values = Vec::new();
            loop {
                let event = parser.parse_next().ok()?;
                if event == JsonEvent::EndArray {
                    return Some(JsonValue::Array(values));
                }
                values.push(parse_value(parser, event)?);
            }
        }
        JsonEvent::StartObject => {
            let mut values = BTreeMap::new();
            loop {
                match parser.parse_next().ok()? {
                    JsonEvent::EndObject => return Some(JsonValue::Object(values)),
                    JsonEvent::ObjectKey(key) => {
                        let key = key.into_owned();
                        let event = parser.parse_next().ok()?;
                        let value = parse_value(parser, event)?;
                        if values.insert(key, value).is_some() {
                            return None;
                        }
                    }
                    _ => return None,
                }
            }
        }
        JsonEvent::EndArray | JsonEvent::EndObject | JsonEvent::ObjectKey(_) | JsonEvent::Eof => {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rdf_json_value_equality() {
        assert!(json_equal(r#"{"a": 0, "b": 1}"#, r#"{"b":1,"a":0}"#));
        assert!(json_equal("9007199254740992.5", "9007199254740991.5"));
        assert!(json_equal("1E400", "1E401"));
        assert!(!json_equal("0", "-0"));
        assert!(!json_equal("[0,-0]", "[-0,0]"));
        assert!(!json_is_valid(r#"{"a": 0, "a": 1}"#));
    }
}
