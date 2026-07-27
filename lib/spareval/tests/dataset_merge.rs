#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration tests expose exact SPARQL dataset-construction outcomes"
)]

use oxrdf::{BlankNode, Dataset, NamedNode, Quad, Term};
use spareval::{QueryEvaluator, QueryResults};
use spargebra::SparqlParser;
use std::error::Error;
use std::io;

const SPARQL_QUERY_SOURCE_SHA256: &str =
    "85cf4270bdc0cc3191ed84803fa1a91fe258776448ea0c82fc91685c577fb4c1";
const DATASET_MERGE_CLAUSES: &[(&str, &str)] = &[
    (
        "sparql12-query:normative-prose-block:2760f3e54d5fc622f78fa571",
        "from_constructs_an_rdf_merge_with_fresh_blank_nodes",
    ),
    (
        "sparql12-query:normative-prose-block:838e3d92db515b629e3cfee8",
        "merged_default_blank_nodes_are_not_shared_with_named_sources",
    ),
    (
        "sparql12-query:normative-prose-block:948511d521cfdde409fabcf8",
        "from_and_union_default_graphs_have_set_semantics",
    ),
    (
        "sparql12-query:normative-prose-block:d2ad0e9ea0f92dcbc1ca1aaf",
        "from_and_union_default_graphs_have_set_semantics",
    ),
];

fn node(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn select_subjects(query: &str, dataset: &Dataset) -> Result<Vec<Term>, Box<dyn Error>> {
    let query = SparqlParser::new().parse_query(query)?;
    let QueryResults::Solutions(solutions) =
        QueryEvaluator::new().prepare(&query).execute(dataset)?
    else {
        return Err(io::Error::other("SELECT did not return solutions").into());
    };
    solutions
        .map(|solution| {
            solution?
                .get("s")
                .cloned()
                .ok_or_else(|| io::Error::other("?s is unbound").into())
        })
        .collect()
}

#[test]
fn pinned_dataset_merge_clauses_name_concrete_tests() {
    assert_eq!(SPARQL_QUERY_SOURCE_SHA256.len(), 64);
    assert_eq!(DATASET_MERGE_CLAUSES.len(), 4);
    assert!(DATASET_MERGE_CLAUSES.iter().all(|(clause, test)| {
        clause.starts_with("sparql12-query:normative-prose-block:") && !test.is_empty()
    }));
}

#[test]
fn from_constructs_an_rdf_merge_with_fresh_blank_nodes() -> Result<(), Box<dyn Error>> {
    let shared = BlankNode::new("shared-across-source-graphs")?;
    let graph_a = node("urn:graph:a");
    let graph_b = node("urn:graph:b");
    let dataset = Dataset::from_iter([
        Quad::new(
            shared.clone(),
            node("urn:p"),
            node("urn:o"),
            graph_a.clone(),
        ),
        Quad::new(shared.clone(), node("urn:q"), node("urn:v"), graph_a),
        Quad::new(
            shared.clone(),
            node("urn:p"),
            node("urn:o"),
            graph_b.clone(),
        ),
        Quad::new(shared, node("urn:q"), node("urn:v"), graph_b),
    ]);

    let subjects = select_subjects(
        "SELECT ?s
         FROM <urn:graph:a>
         FROM <urn:graph:b>
         WHERE {
           ?s <urn:p> <urn:o> ;
              <urn:q> <urn:v>
         }",
        &dataset,
    )?;
    assert_eq!(subjects.len(), 2);
    assert!(subjects.iter().all(Term::is_blank_node));
    assert_ne!(subjects[0], subjects[1]);
    Ok(())
}

#[test]
fn from_and_union_default_graphs_have_set_semantics() -> Result<(), Box<dyn Error>> {
    let graph_a = node("urn:graph:a");
    let graph_b = node("urn:graph:b");
    let dataset = Dataset::from_iter([
        Quad::new(node("urn:s"), node("urn:p"), node("urn:o"), graph_a),
        Quad::new(node("urn:s"), node("urn:p"), node("urn:o"), graph_b),
    ]);

    assert_eq!(
        select_subjects(
            "SELECT ?s
             FROM <urn:graph:a>
             FROM <urn:graph:b>
             WHERE { ?s <urn:p> <urn:o> }",
            &dataset,
        )?,
        [Term::from(node("urn:s"))]
    );

    let query = SparqlParser::new().parse_query("SELECT ?s WHERE { ?s <urn:p> <urn:o> }")?;
    let evaluator = QueryEvaluator::new();
    let mut prepared = evaluator.prepare(&query);
    prepared.dataset_mut().set_default_graph_as_union();
    let QueryResults::Solutions(solutions) = prepared.execute(&dataset)? else {
        return Err(io::Error::other("SELECT did not return solutions").into());
    };
    assert_eq!(solutions.collect::<Result<Vec<_>, _>>()?.len(), 1);
    Ok(())
}

#[test]
fn merged_default_blank_nodes_are_not_shared_with_named_sources() -> Result<(), Box<dyn Error>> {
    let dataset = Dataset::from_iter([Quad::new(
        BlankNode::new("source-label")?,
        node("urn:p"),
        node("urn:o"),
        node("urn:graph"),
    )]);
    let query = SparqlParser::new().parse_query(
        "ASK
         FROM <urn:graph>
         FROM NAMED <urn:graph>
         WHERE {
           ?default <urn:p> <urn:o> .
           GRAPH <urn:graph> { ?named <urn:p> <urn:o> }
           FILTER(sameTerm(?default, ?named))
         }",
    )?;
    assert!(matches!(
        QueryEvaluator::new().prepare(&query).execute(&dataset)?,
        QueryResults::Boolean(false)
    ));
    Ok(())
}

#[test]
fn duplicate_from_named_clauses_do_not_duplicate_graph_solutions() -> Result<(), Box<dyn Error>> {
    let dataset = Dataset::from_iter([Quad::new(
        node("urn:s"),
        node("urn:p"),
        node("urn:o"),
        node("urn:graph"),
    )]);
    let query = SparqlParser::new().parse_query(
        "SELECT ?g
         FROM NAMED <urn:graph>
         FROM NAMED <urn:graph>
         WHERE { GRAPH ?g { ?s ?p ?o } }",
    )?;
    let QueryResults::Solutions(solutions) =
        QueryEvaluator::new().prepare(&query).execute(&dataset)?
    else {
        return Err(io::Error::other("SELECT did not return solutions").into());
    };
    assert_eq!(solutions.collect::<Result<Vec<_>, _>>()?.len(), 1);
    Ok(())
}
