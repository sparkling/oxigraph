#![cfg(test)]
#![cfg(feature = "rdf-12")]
#![expect(
    clippy::panic_in_result_fn,
    reason = "integration test setup uses fallible public constructors"
)]

use oxigraph::model::{GraphName, NamedNode, Quad, Triple};
use oxigraph::sparql::{QueryEvaluationError, QueryResults, SparqlEvaluator, SparqlVersion};
use oxigraph::store::Store;
use spargebra::SparqlParser;

#[test]
fn store_queries_enforce_the_selected_sparql_term_mode() -> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    let node = NamedNode::new("http://example.com/node")?;
    store.insert(Quad::new(
        node.clone(),
        node.clone(),
        Triple::new(node.clone(), node.clone(), node),
        GraphName::DefaultGraph,
    ))?;

    assert!(matches!(
        SparqlEvaluator::new()
            .with_version(SparqlVersion::V1_1)
            .parse_query("ASK { ?s ?p ?o }")?
            .on_store(&store)
            .execute(),
        Err(QueryEvaluationError::IncompatibleTerm {
            version: SparqlVersion::V1_1,
            ..
        })
    ));
    assert!(matches!(
        SparqlEvaluator::new()
            .with_version(SparqlVersion::V1_2)
            .parse_query("ASK { ?s ?p ?o }")?
            .on_store(&store)
            .execute(),
        Ok(QueryResults::Boolean(true))
    ));
    assert!(matches!(
        SparqlEvaluator::new()
            .parse_query("VERSION \"1.1\" ASK { ?s ?p ?o }")?
            .on_store(&store)
            .execute(),
        Err(QueryEvaluationError::IncompatibleTerm {
            version: SparqlVersion::V1_1,
            ..
        })
    ));
    assert!(matches!(
        SparqlEvaluator::new()
            .with_version(SparqlVersion::V1_1)
            .parse_query("VERSION \"1.2\" ASK { ?s ?p ?o }")?
            .on_store(&store)
            .execute(),
        Ok(QueryResults::Boolean(true))
    ));

    let update = SparqlParser::new().parse_update(concat!(
        "INSERT DATA { <http://example.com/s> <http://example.com/p> ",
        "<<( <http://example.com/s> <http://example.com/p> ",
        "<http://example.com/o> )>> }",
    ))?;
    SparqlEvaluator::new()
        .with_version(SparqlVersion::V1_1)
        .for_update(update)
        .on_store(&store)
        .execute()
        .unwrap_err();

    let declared_update_store = Store::new()?;
    SparqlEvaluator::new()
        .with_version(SparqlVersion::V1_1)
        .parse_update(concat!(
            "VERSION \"1.2\"\n",
            "INSERT DATA { <http://example.com/s> <http://example.com/p> ",
            "<<( <http://example.com/s> <http://example.com/p> ",
            "<http://example.com/o> )>> }",
        ))?
        .on_store(&declared_update_store)
        .execute()?;
    assert_eq!(declared_update_store.len()?, 1);
    Ok(())
}
