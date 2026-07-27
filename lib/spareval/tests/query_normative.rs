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
