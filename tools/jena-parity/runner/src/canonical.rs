use oxigraph::model::{BaseDirection, BlankNode, Dataset, GraphName, NamedOrBlankNode, Term};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};

const MAX_BLANK_NODES: usize = 8;
const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";

pub fn dataset(dataset: &Dataset) -> Result<Value, String> {
    let mut blanks = HashSet::new();
    let named_graphs = dataset.named_graphs().collect::<Vec<_>>();
    for quad in dataset {
        collect_subject(&quad.subject, &mut blanks);
        collect_term(&quad.object, &mut blanks);
        if let GraphName::BlankNode(node) = &quad.graph_name {
            blanks.insert(node.clone());
        }
    }
    for graph_name in &named_graphs {
        if let NamedOrBlankNode::BlankNode(node) = graph_name {
            blanks.insert(node.clone());
        }
    }
    choose(&blanks, |mapping| {
        let mut quads = dataset
            .iter()
            .map(|quad| {
                Value::Array(vec![
                    subject_value(&quad.subject, mapping),
                    iri_value(quad.predicate.as_str()),
                    term_value_with_mapping(&quad.object, mapping),
                    match &quad.graph_name {
                        GraphName::DefaultGraph => Value::Null,
                        GraphName::NamedNode(node) => iri_value(node.as_str()),
                        GraphName::BlankNode(node) => blank_value(node, mapping),
                    },
                ])
            })
            .collect::<Vec<_>>();
        quads.sort_by_key(Value::to_string);
        let mut graph_names = named_graphs
            .iter()
            .map(|graph_name| named_graph_value(graph_name, mapping))
            .collect::<Vec<_>>();
        graph_names.sort_by_key(Value::to_string);
        json!({
            "quad_count": quads.len(),
            "quads": quads,
            "named_graph_count": graph_names.len(),
            "named_graphs": graph_names
        })
    })
}

pub fn solutions(
    variables: &[String],
    rows: &[BTreeMap<String, Term>],
    ordered: bool,
) -> Result<Value, String> {
    let mut blanks = HashSet::new();
    for row in rows {
        for term in row.values() {
            collect_term(term, &mut blanks);
        }
    }
    let canonical = choose(&blanks, |mapping| {
        let mut values = rows
            .iter()
            .map(|row| {
                let mut object = Map::new();
                for variable in variables {
                    if let Some(term) = row.get(variable) {
                        object.insert(variable.clone(), term_value_with_mapping(term, mapping));
                    }
                }
                Value::Object(object)
            })
            .collect::<Vec<_>>();
        if !ordered {
            values.sort_by_key(Value::to_string);
        }
        Value::Array(values)
    })?;
    Ok(json!({
        "variables": variables,
        "row_count": canonical.as_array().map_or(0, Vec::len),
        "ordered": ordered,
        "rows": canonical
    }))
}

pub fn term(term: &Term) -> Value {
    term_value_with_mapping(term, &HashMap::new())
}

fn choose(
    blanks: &HashSet<BlankNode>,
    render: impl Fn(&HashMap<BlankNode, String>) -> Value,
) -> Result<Value, String> {
    if blanks.len() > MAX_BLANK_NODES {
        return Err(format!(
            "canonicalization supports at most {MAX_BLANK_NODES} blank nodes"
        ));
    }
    if blanks.is_empty() {
        return Ok(render(&HashMap::new()));
    }
    let values = blanks.iter().cloned().collect::<Vec<_>>();
    let mut used = vec![false; values.len()];
    let mut order = Vec::with_capacity(values.len());
    let mut best: Option<(String, Value)> = None;
    permute(&values, &mut used, &mut order, &render, &mut best);
    best.map(|(_, value)| value)
        .ok_or_else(|| "blank-node canonicalization produced no candidate".to_owned())
}

fn permute(
    values: &[BlankNode],
    used: &mut [bool],
    order: &mut Vec<BlankNode>,
    render: &impl Fn(&HashMap<BlankNode, String>) -> Value,
    best: &mut Option<(String, Value)>,
) {
    if order.len() == values.len() {
        let mapping = order
            .iter()
            .enumerate()
            .map(|(index, node)| (node.clone(), format!("b{index}")))
            .collect();
        let candidate = render(&mapping);
        let serialized = candidate.to_string();
        if best
            .as_ref()
            .is_none_or(|(current, _)| serialized < *current)
        {
            *best = Some((serialized, candidate));
        }
        return;
    }
    for index in 0..values.len() {
        if !used[index] {
            used[index] = true;
            order.push(values[index].clone());
            permute(values, used, order, render, best);
            order.pop();
            used[index] = false;
        }
    }
}

fn subject_value(
    subject: &oxigraph::model::NamedOrBlankNode,
    mapping: &HashMap<BlankNode, String>,
) -> Value {
    match subject {
        oxigraph::model::NamedOrBlankNode::NamedNode(node) => iri_value(node.as_str()),
        oxigraph::model::NamedOrBlankNode::BlankNode(node) => blank_value(node, mapping),
    }
}

fn term_value_with_mapping(term: &Term, mapping: &HashMap<BlankNode, String>) -> Value {
    match term {
        Term::NamedNode(node) => iri_value(node.as_str()),
        Term::BlankNode(node) => blank_value(node, mapping),
        Term::Literal(literal) => {
            let mut value = Map::new();
            value.insert("type".to_owned(), Value::String("literal".to_owned()));
            value.insert(
                "value".to_owned(),
                Value::String(literal.value().to_owned()),
            );
            if let Some(language) = literal.language() {
                value.insert("language".to_owned(), Value::String(language.to_owned()));
            }
            if let Some(direction) = literal.direction() {
                value.insert(
                    "direction".to_owned(),
                    Value::String(
                        match direction {
                            BaseDirection::Ltr => "ltr",
                            BaseDirection::Rtl => "rtl",
                        }
                        .to_owned(),
                    ),
                );
            }
            value.insert(
                "datatype".to_owned(),
                Value::String(
                    if literal.datatype().as_str().is_empty() {
                        XSD_STRING
                    } else {
                        literal.datatype().as_str()
                    }
                    .to_owned(),
                ),
            );
            Value::Object(value)
        }
        Term::Triple(triple) => json!({
            "type": "triple",
            "value": [
                subject_value(&triple.subject, mapping),
                iri_value(triple.predicate.as_str()),
                term_value_with_mapping(&triple.object, mapping)
            ]
        }),
    }
}

fn iri_value(value: &str) -> Value {
    json!({"type": "iri", "value": value})
}

fn blank_value(node: &BlankNode, mapping: &HashMap<BlankNode, String>) -> Value {
    json!({
        "type": "blank",
        "value": mapping.get(node).map_or_else(|| node.as_str(), String::as_str)
    })
}

fn named_graph_value(graph_name: &NamedOrBlankNode, mapping: &HashMap<BlankNode, String>) -> Value {
    match graph_name {
        NamedOrBlankNode::NamedNode(node) => iri_value(node.as_str()),
        NamedOrBlankNode::BlankNode(node) => blank_value(node, mapping),
    }
}

fn collect_subject(subject: &oxigraph::model::NamedOrBlankNode, output: &mut HashSet<BlankNode>) {
    if let oxigraph::model::NamedOrBlankNode::BlankNode(node) = subject {
        output.insert(node.clone());
    }
}

fn collect_term(term: &Term, output: &mut HashSet<BlankNode>) {
    match term {
        Term::BlankNode(node) => {
            output.insert(node.clone());
        }
        Term::Triple(triple) => {
            collect_subject(&triple.subject, output);
            collect_term(&triple.object, output);
        }
        Term::NamedNode(_) | Term::Literal(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxigraph::io::{RdfFormat, RdfParser};

    fn parse(input: &str) -> Result<Dataset, String> {
        RdfParser::from_format(RdfFormat::Turtle)
            .for_slice(input)
            .collect::<Result<_, _>>()
            .map_err(|error| error.to_string())
    }

    #[test]
    fn canonicalizes_isomorphic_blank_nodes() -> Result<(), String> {
        let left =
            parse("_:a <https://example.test/p> _:b . _:b <https://example.test/q> \"v\" .")?;
        let right =
            parse("_:x <https://example.test/p> _:y . _:y <https://example.test/q> \"v\" .")?;
        assert_eq!(dataset(&left)?, dataset(&right)?);
        Ok(())
    }

    #[test]
    fn canonicalizes_empty_named_graph_topology() -> Result<(), String> {
        let mut left = Dataset::new();
        left.insert_named_graph(BlankNode::new_unchecked("left"));
        let mut right = Dataset::new();
        right.insert_named_graph(BlankNode::new_unchecked("right"));

        let left = dataset(&left)?;
        assert_eq!(left, dataset(&right)?);
        assert_eq!(left.pointer("/quad_count"), Some(&json!(0)));
        assert_eq!(left.pointer("/named_graph_count"), Some(&json!(1)));
        assert_ne!(left, dataset(&Dataset::new())?);
        Ok(())
    }
}
