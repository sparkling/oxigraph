use oxhttp::model::Request;
use oxhttp::model::header::{HeaderMap, IF_MATCH, IF_NONE_MATCH};

const MAX_CONDITION_BYTES: usize = 8 * 1024;
const MAX_ENTITY_TAGS: usize = 32;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntityTag {
    weak: bool,
    opaque: String,
}

impl EntityTag {
    pub fn opaque(&self) -> &str {
        &self.opaque
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum TagList {
    Any,
    Tags(Vec<EntityTag>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Decision {
    Proceed,
    NotModified,
    PreconditionFailed,
}

pub fn evaluate<B>(
    request: &Request<B>,
    resource_exists: bool,
    mut is_current: impl FnMut(&EntityTag) -> bool,
) -> Result<Decision, String> {
    if let Some(condition) = parse_header(request.headers(), IF_MATCH.as_str())? {
        let matches = match condition {
            TagList::Any => resource_exists,
            TagList::Tags(tags) => {
                resource_exists && tags.iter().any(|tag| !tag.weak && is_current(tag))
            }
        };
        if !matches {
            return Ok(Decision::PreconditionFailed);
        }
    }
    if let Some(condition) = parse_header(request.headers(), IF_NONE_MATCH.as_str())? {
        let matches = match condition {
            TagList::Any => resource_exists,
            TagList::Tags(tags) => resource_exists && tags.iter().any(&mut is_current),
        };
        if matches {
            return Ok(if request.method().is_safe() {
                Decision::NotModified
            } else {
                Decision::PreconditionFailed
            });
        }
    }
    Ok(Decision::Proceed)
}

fn parse_header(headers: &HeaderMap, name: &str) -> Result<Option<TagList>, String> {
    let mut combined = String::new();
    let mut found = false;
    for value in headers.get_all(name) {
        found = true;
        let value = value
            .to_str()
            .map_err(|_| format!("The {name} header must contain visible ASCII"))?;
        if combined.len() + value.len() + usize::from(!combined.is_empty()) > MAX_CONDITION_BYTES {
            return Err(format!("The {name} header is too large"));
        }
        if !combined.is_empty() {
            combined.push(',');
        }
        combined.push_str(value);
    }
    if !found {
        return Ok(None);
    }
    if combined.is_empty() {
        return Err(format!(
            "Invalid {name} header: the entity-tag list is empty"
        ));
    }
    parse_tag_list(&combined)
        .map(Some)
        .map_err(|message| format!("Invalid {name} header: {message}"))
}

fn parse_tag_list(value: &str) -> Result<TagList, String> {
    let bytes = value.as_bytes();
    let mut cursor = skip_ows(bytes, 0);
    if bytes.get(cursor) == Some(&b'*') {
        cursor = skip_ows(bytes, cursor + 1);
        return if cursor == bytes.len() {
            Ok(TagList::Any)
        } else {
            Err("'*' cannot be combined with entity-tags".into())
        };
    }

    let mut tags = Vec::new();
    loop {
        let weak = bytes
            .get(cursor..)
            .is_some_and(|tail| tail.starts_with(b"W/"));
        if weak {
            cursor += 2;
        }
        if bytes.get(cursor) != Some(&b'"') {
            return Err("an entity-tag must start with a double quote".into());
        }
        cursor += 1;
        let opaque_start = cursor;
        while let Some(byte) = bytes.get(cursor) {
            if *byte == b'"' {
                break;
            }
            if *byte < 0x21 || *byte == 0x7f {
                return Err("an entity-tag contains an invalid character".into());
            }
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'"') {
            return Err("an entity-tag is not terminated".into());
        }
        tags.push(EntityTag {
            weak,
            opaque: value[opaque_start..cursor].to_owned(),
        });
        if tags.len() > MAX_ENTITY_TAGS {
            return Err("too many entity-tags".into());
        }
        cursor = skip_ows(bytes, cursor + 1);
        if cursor == bytes.len() {
            break;
        }
        if bytes.get(cursor) != Some(&b',') {
            return Err("entity-tags must be separated by commas".into());
        }
        cursor = skip_ows(bytes, cursor + 1);
        if cursor == bytes.len() {
            return Err("the entity-tag list has a trailing comma".into());
        }
    }
    if tags.is_empty() {
        Err("the entity-tag list is empty".into())
    } else {
        Ok(TagList::Tags(tags))
    }
}

fn skip_ows(bytes: &[u8], mut cursor: usize) -> usize {
    while bytes
        .get(cursor)
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        cursor += 1;
    }
    cursor
}

#[cfg(test)]
#[expect(clippy::expect_used)]
mod tests {
    use super::*;
    use oxhttp::model::{Body, Method};

    fn request(
        method: Method,
        if_match: Option<&str>,
        if_none_match: Option<&str>,
    ) -> Request<Body> {
        let mut builder = Request::builder()
            .method(method)
            .uri("http://example.test/");
        if let Some(value) = if_match {
            builder = builder.header(IF_MATCH, value);
        }
        if let Some(value) = if_none_match {
            builder = builder.header(IF_NONE_MATCH, value);
        }
        builder.body(Body::empty()).expect("valid test request")
    }

    #[test]
    fn applies_strong_and_weak_comparison_rules() {
        let current = |tag: &EntityTag| tag.opaque() == "current";
        assert_eq!(
            evaluate(
                &request(Method::PUT, Some("W/\"current\""), None),
                true,
                current
            ),
            Ok(Decision::PreconditionFailed)
        );
        assert_eq!(
            evaluate(
                &request(Method::GET, None, Some("W/\"current\"")),
                true,
                current
            ),
            Ok(Decision::NotModified)
        );
        assert_eq!(
            evaluate(
                &request(Method::PUT, None, Some("\"current\"")),
                true,
                current
            ),
            Ok(Decision::PreconditionFailed)
        );
    }

    #[test]
    fn wildcard_respects_resource_existence() {
        let never = |_: &EntityTag| false;
        assert_eq!(
            evaluate(&request(Method::PUT, Some("*"), None), false, never),
            Ok(Decision::PreconditionFailed)
        );
        assert_eq!(
            evaluate(&request(Method::PUT, None, Some("*")), false, never),
            Ok(Decision::Proceed)
        );
    }

    #[test]
    fn rejects_malformed_entity_tag_lists() {
        for value in ["", "* , \"tag\"", "\"tag\",", "w/\"tag\"", "\"bad tag\""] {
            evaluate(&request(Method::GET, None, Some(value)), true, |_| false)
                .expect_err("malformed entity-tag list");
        }
    }
}
