#![cfg(test)]
#![cfg(feature = "sparql-12")]

use oxrdf::{Dataset, GraphName, Literal, NamedNode, Quad, Triple};
use spareval::{QueryEvaluationError, QueryEvaluator, QueryResults};
use spargebra::{SparqlParser, SparqlVersion};

fn dataset_with_object(object: impl Into<oxrdf::Term>) -> Dataset {
    let node = NamedNode::new_unchecked("http://example.com/node");
    Dataset::from_iter([Quad::new(
        node.clone(),
        node,
        object,
        GraphName::DefaultGraph,
    )])
}

#[test]
fn parsed_query_version_controls_dataset_term_policy() {
    let node = NamedNode::new_unchecked("http://example.com/node");
    let dataset = dataset_with_object(Triple::new(node.clone(), node.clone(), node));
    let parsed = SparqlParser::new()
        .parse_query_with_metadata("VERSION \"1.1\" ASK { ?s ?p ?o }")
        .unwrap();
    assert!(matches!(
        QueryEvaluator::new()
            .prepare_parsed(&parsed)
            .execute(&dataset),
        Err(QueryEvaluationError::IncompatibleTerm {
            version: SparqlVersion::V1_1,
            ..
        })
    ));

    let query = SparqlParser::new().parse_query("ASK { ?s ?p ?o }").unwrap();
    assert!(matches!(
        QueryEvaluator::new()
            .with_version(SparqlVersion::V1_2Basic)
            .prepare(&query)
            .execute(&dataset),
        Err(QueryEvaluationError::IncompatibleTerm {
            version: SparqlVersion::V1_2Basic,
            ..
        })
    ));
    assert!(matches!(
        QueryEvaluator::new()
            .with_version(SparqlVersion::V1_2)
            .prepare(&query)
            .execute(&dataset),
        Ok(QueryResults::Boolean(true))
    ));
}

#[test]
fn directional_literals_are_basic_but_not_sparql_11_terms() {
    let dataset = dataset_with_object(
        Literal::new_directional_language_tagged_literal("hello", "en", oxrdf::BaseDirection::Ltr)
            .unwrap(),
    );
    let query = SparqlParser::new().parse_query("ASK { ?s ?p ?o }").unwrap();
    assert!(matches!(
        QueryEvaluator::new()
            .with_version(SparqlVersion::V1_1)
            .prepare(&query)
            .execute(&dataset),
        Err(QueryEvaluationError::IncompatibleTerm {
            version: SparqlVersion::V1_1,
            ..
        })
    ));
    assert!(matches!(
        QueryEvaluator::new()
            .with_version(SparqlVersion::V1_2Basic)
            .prepare(&query)
            .execute(&dataset),
        Ok(QueryResults::Boolean(true))
    ));
}
