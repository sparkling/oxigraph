#![cfg(test)]

use oxrdf::{Dataset, GraphName, NamedNode, Quad};
use spareval::{QueryEvaluator, QueryResults};
use spargebra::SparqlParser;

fn evaluate_ask(query: &str, dataset: &Dataset) -> Option<bool> {
    let query = SparqlParser::new().parse_query(query).unwrap();
    match QueryEvaluator::new()
        .prepare(&query)
        .execute(dataset)
        .unwrap()
    {
        QueryResults::Boolean(result) => Some(result),
        _ => None,
    }
}

#[test]
fn an_empty_negated_property_set_matches_every_predicate() {
    let dataset = Dataset::from_iter([Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:o"),
        GraphName::DefaultGraph,
    )]);

    assert_eq!(
        evaluate_ask("ASK { <urn:s> !() <urn:o> }", &dataset),
        Some(true)
    );
    assert_eq!(
        evaluate_ask("ASK { <urn:s> !(<urn:p>) <urn:o> }", &dataset),
        Some(false)
    );
}

#[cfg(feature = "sparql-12")]
#[test]
fn triple_term_equality_recursively_uses_same_value() {
    let dataset = Dataset::new();
    let xsd = "http://www.w3.org/2001/XMLSchema#";

    assert_eq!(
        evaluate_ask(
            &format!(
                "ASK {{ FILTER(
                <<( <urn:s> <urn:p> \"NaN\"^^<{xsd}double> )>>
                =
                <<( <urn:s> <urn:p> \"NaN\"^^<{xsd}float> )>>
            ) }}"
            ),
            &dataset,
        ),
        Some(true)
    );
    assert_eq!(
        evaluate_ask(
            &format!(
                "ASK {{ FILTER(
                \"NaN\"^^<{xsd}double> = \"NaN\"^^<{xsd}float>
            ) }}"
            ),
            &dataset,
        ),
        Some(false)
    );
    assert_eq!(
        evaluate_ask(
            "ASK {
                BIND(
                    <<( <urn:s> <urn:p> \"left\"^^<urn:unknown> )>>
                    =
                    <<( <urn:different> <urn:p> \"right\"^^<urn:unknown> )>>
                    AS ?equal
                )
                FILTER(!BOUND(?equal))
            }",
            &dataset,
        ),
        Some(true)
    );
}
#[cfg(feature = "sep-0006")]
#[test]
fn nullable_path_join_does_not_invent_an_absent_graph_node() {
    let node = |s| NamedNode::new_unchecked(s);
    let dataset = Dataset::from_iter([Quad::new(
        node("urn:s"),
        node("urn:p"),
        node("urn:o"),
        GraphName::DefaultGraph,
    )]);
    // Sequence translates to independent joined path patterns. The open
    // nullable right side ranges over nodes(G), not the absent left constant.
    // https://www.w3.org/TR/sparql11-query/#defn_evalPropertyPath
    for (query, expected) in [
        (
            "ASK { <urn:absent> <urn:q>? / ^(^(<urn:r>*)+ | <urn:t>) ?o }",
            false,
        ),
        ("ASK { <urn:absent> <urn:q>? / (<urn:r>*)+ ?o }", false),
        ("ASK { <urn:absent> <urn:q>? / <urn:r>* ?o }", false),
        ("ASK { <urn:absent> <urn:q>? / <urn:r>? ?o }", false),
        ("ASK { <urn:absent> (<urn:r>*)+ ?o }", true),
    ] {
        let query = SparqlParser::new().parse_query(query).unwrap();
        for evaluator in [
            QueryEvaluator::new(),
            QueryEvaluator::new().without_optimizations(),
        ] {
            let (result, explanation) = evaluator.prepare(&query).explain(&dataset);
            let QueryResults::Boolean(result) = result.unwrap() else {
                panic!("ASK")
            };
            assert_eq!(
                result, expected,
                "nullable path join scope: {query}\n{explanation:?}"
            );
        }
    }
}

#[cfg(all(feature = "sparql-12", feature = "sep-0006"))]
#[test]
fn nullable_triple_pattern_path_join_preserves_open_endpoint_domain() {
    let dataset = Dataset::from_iter([Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:o"),
        GraphName::DefaultGraph,
    )]);
    for path in ["<urn:r>*", "<urn:r>?", "(<urn:r>*)+"] {
        for pattern in [
            "<<( ?s <urn:p> ?o )>>",
            "<<( <urn:s> ?p <urn:o> )>>",
            "<<( <urn:s> <urn:p> <<( ?s ?p ?o )>> )>>",
        ] {
            for (subject, object) in [(pattern, "?x"), ("?x", pattern)] {
                let text = format!(
                    "SELECT * WHERE {{ VALUES (?s ?p ?o) {{ (<urn:s> <urn:p> <urn:o>) }} {subject} {path} {object} }}"
                );
                let query = SparqlParser::new().parse_query(&text).unwrap();
                for evaluator in [
                    QueryEvaluator::new(),
                    QueryEvaluator::new().without_optimizations(),
                ] {
                    let (results, explanation) = evaluator.prepare(&query).explain(&dataset);
                    let QueryResults::Solutions(results) = results.unwrap() else {
                        panic!("SELECT")
                    };
                    assert_eq!(results.count(), 0, "{text}\n{explanation:?}");
                }
            }
        }
    }
}
