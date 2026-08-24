#![expect(
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    reason = "integration test asserts the public dataset adapter contract"
)]

use oxrdf::{Dataset, NamedNode};
use spareval::{QueryEvaluator, QueryResults};
use spargebra::SparqlParser;

#[test]
fn empty_named_graphs_are_visible_through_the_dataset_adapter()
-> Result<(), Box<dyn std::error::Error>> {
    let graph_name = NamedNode::new("urn:empty")?;
    let mut dataset = Dataset::new();
    dataset.insert_named_graph(graph_name.clone());

    let query = SparqlParser::new().parse_query("ASK { GRAPH <urn:empty> {} }")?;
    let QueryResults::Boolean(result) = QueryEvaluator::new().prepare(&query).execute(&dataset)?
    else {
        return Err("expected ASK result".into());
    };
    assert!(result);

    let query = SparqlParser::new().parse_query("SELECT ?g WHERE { GRAPH ?g {} }")?;
    let QueryResults::Solutions(solutions) =
        QueryEvaluator::new().prepare(&query).execute(&dataset)?
    else {
        return Err("expected SELECT solutions".into());
    };
    let solutions = solutions.collect::<Result<Vec<_>, _>>()?;
    assert_eq!(solutions.len(), 1);
    assert_eq!(solutions[0].get("g"), Some(&graph_name.into()));
    Ok(())
}
