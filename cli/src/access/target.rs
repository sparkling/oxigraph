use oxhttp::model::Uri;
use oxhttp::model::uri::PathAndQuery;
use oxigraph::model::NamedNode;
use oxiri::{Iri, IriRef};

/// The exact Graph Store target, selected without consulting storage.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GraphTarget {
    Dataset,
    DefaultGraph,
    NamedGraph(NamedNode),
}

impl GraphTarget {
    pub fn from_uri(uri: &Uri) -> Result<Self, String> {
        let direct = uri.path() != "/store";
        let mut graph = None;
        let mut has_default = false;
        for (key, value) in parameters(uri)? {
            match key.as_str() {
                "graph" => {
                    if graph.is_some() || has_default {
                        return Err(
                            "A Graph Store request must contain exactly one graph selector".into(),
                        );
                    }
                    if value.is_empty() {
                        return Err("The graph selector must contain a graph IRI".into());
                    }
                    graph = Some(value);
                }
                "default" => {
                    if has_default || graph.is_some() {
                        return Err(
                            "A Graph Store request must contain exactly one graph selector".into(),
                        );
                    }
                    if !value.is_empty() {
                        return Err("The default selector must not have a value".into());
                    }
                    has_default = true;
                }
                "lenient" | "no_transaction" if value.is_empty() => {}
                _ => return Err(format!("Unknown Graph Store parameter '{key}'")),
            }
        }
        if direct {
            if graph.is_some() || has_default {
                return Err(
                    "An indirect graph selector cannot be combined with a direct graph IRI".into(),
                );
            }
            let mut parts = uri.clone().into_parts();
            parts.path_and_query =
                Some(PathAndQuery::try_from(uri.path()).map_err(|_| "Invalid graph IRI")?);
            let base = Uri::from_parts(parts)
                .map_err(|_| "Invalid graph IRI")?
                .to_string();
            let base = Iri::parse(base).map_err(|error| error.to_string())?;
            let iri = base
                .resolve(&IriRef::parse("").map_err(|_| "Invalid graph IRI")?)
                .map_err(|error| error.to_string())?;
            Ok(Self::NamedGraph(NamedNode::new_unchecked(iri.into_inner())))
        } else if let Some(graph) = graph {
            Ok(Self::NamedGraph(NamedNode::new(graph).map_err(
                |_| "The graph selector must be an absolute IRI",
            )?))
        } else if has_default {
            Ok(Self::DefaultGraph)
        } else {
            Ok(Self::Dataset)
        }
    }
}

pub fn parameters(uri: &Uri) -> Result<Vec<(String, String)>, &'static str> {
    uri.query()
        .unwrap_or_default()
        .split('&')
        .filter(|s| !s.is_empty())
        .map(|field| {
            let (key, value) = field.split_once('=').unwrap_or((field, ""));
            Ok((decode(key)?, decode(value)?))
        })
        .collect()
}

fn decode(value: &str) -> Result<String, &'static str> {
    let input = value.as_bytes();
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            let high = input
                .get(index + 1)
                .copied()
                .and_then(hex)
                .ok_or("Invalid percent encoding in Graph Store query parameter")?;
            let low = input
                .get(index + 2)
                .copied()
                .and_then(hex)
                .ok_or("Invalid percent encoding in Graph Store query parameter")?;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(input[index]);
            index += 1;
        }
    }
    String::from_utf8(output).map_err(|_| "Graph Store query parameters must be UTF-8 encoded")
}

const fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
