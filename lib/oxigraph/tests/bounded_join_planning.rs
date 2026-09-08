#![cfg(test)]
#![expect(
    clippy::panic_in_result_fn,
    reason = "integration assertions use fallible public constructors"
)]

use oxigraph::io::RdfFormat;
use oxigraph::model::graph::CanonicalizationAlgorithm;
use oxigraph::model::{BlankNode, Graph, NamedNode, Triple, Variable};
use oxigraph::sparql::{
    BoundedJoinPlanning, CancellationToken, QueryEvaluationError, QueryResults, SparqlEvaluator,
};
use oxigraph::store::Store;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn bag(results: QueryResults<'_>) -> Result<(usize, Graph)> {
    let QueryResults::Solutions(rows) = results else {
        return Err("expected SELECT results".into());
    };
    // FROM standardizes blank nodes apart on each evaluation. Encode each row
    // as a distinct node so graph isomorphism preserves duplicate solutions,
    // unbound variables and a consistent bijection of result blank nodes.
    let mut graph = Graph::new();
    let mut count = 0;
    for row in rows {
        let row_node = BlankNode::default();
        // An empty solution must not disappear from the encoding.
        graph.insert(Triple::new(
            row_node.clone(),
            NamedNode::new("urn:result:row")?,
            NamedNode::new("urn:result:Solution")?,
        ));
        for (variable, value) in row?.iter() {
            graph.insert(Triple::new(
                row_node.clone(),
                NamedNode::new(format!("urn:result:binding:{}", variable.as_str()))?,
                value.clone(),
            ));
        }
        count += 1;
    }
    graph.canonicalize(CanonicalizationAlgorithm::Unstable)?;
    Ok((count, graph))
}

#[test]
fn multiset_oracle_preserves_duplicates_empty_rows_and_blank_node_identity() -> Result {
    let store = Store::new()?;
    let evaluate = |query| {
        bag(SparqlEvaluator::new()
            .parse_query(query)?
            .on_store(&store)
            .execute()?)
    };
    let same = "SELECT ?x ?y { BIND(BNODE() AS ?x) BIND(?x AS ?y) }";
    assert_eq!(evaluate(same)?, evaluate(same)?);
    assert_ne!(
        evaluate(same)?,
        evaluate("SELECT ?x ?y { BIND(BNODE() AS ?x) BIND(BNODE() AS ?y) }")?
    );
    assert_ne!(
        evaluate("SELECT * { VALUES ?x { 1 1 } }")?,
        evaluate("SELECT * { VALUES ?x { 1 } }")?
    );
    assert_ne!(
        evaluate("SELECT * {}")?,
        evaluate("SELECT * { FILTER(false) }")?
    );
    assert_eq!(evaluate("SELECT * { {} UNION {} }")?.0, 2);
    Ok(())
}
fn store() -> Result<Store> {
    let store = Store::new()?;
    store.load_from_slice(
        RdfFormat::TriG,
        "
        @prefix : <urn:> .
        :a :p :x, :y ; :q :x . :b :p :x ; :q :y .
        :x :r :z . :y :r :z .
        :g1 { :a :p :x ; :q :x . _:b :p :x ; :q :x . }
        :g2 { :a :p :x ; :q :x . _:b :p :x ; :q :x . }
        :empty {}
    ",
    )?;
    Ok(store)
}

#[test]
fn bounded_queries_preserve_multisets_and_scopes() -> Result {
    let store = store()?;
    for query in [
        "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v . ?o <urn:r> ?z }",
        "SELECT ?o { ?s <urn:p> ?o . ?s <urn:p> ?o }",
        "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v OPTIONAL { ?o <urn:r> ?z } }",
        "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v MINUS { ?s <urn:q> <urn:y> } }",
        "SELECT * { { ?s <urn:p> ?o . ?s <urn:q> ?v } UNION { ?o <urn:r> ?s } }",
        "SELECT (COUNT(*) AS ?n) { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "SELECT ?s { ?s <urn:p> ?o . ?s <urn:q> ?v FILTER(?o != ?v) } ORDER BY ?s LIMIT 2",
        "SELECT * { ?s <urn:p> ?o FILTER EXISTS { ?s <urn:q> ?v . ?v <urn:r> ?z } }",
        "SELECT * FROM <urn:g1> { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "SELECT * FROM <urn:g1> FROM <urn:g2> { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "SELECT * FROM NAMED <urn:g1> { GRAPH ?g { ?s <urn:p> ?o . ?s <urn:q> ?v } }",
        "SELECT * { GRAPH ?g { ?s <urn:p> ?o . ?s <urn:q> ?v FILTER(?g = <urn:g1>) } }",
        "SELECT * { GRAPH <urn:empty> { ?s <urn:p> ?o . ?s <urn:q> ?v } }",
        "SELECT * { ?s <urn:p> ?o . ?o <urn:r>* ?z }",
        "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v SERVICE SILENT <urn:unavailable> { ?a ?b ?c } }",
    ] {
        let expected = bag(SparqlEvaluator::new()
            .without_optimizations()
            .parse_query(query)?
            .on_store(&store)
            .execute()?)?;
        for options in [
            BoundedJoinPlanning::new(1).unwrap(),
            BoundedJoinPlanning::new(2).unwrap(),
            BoundedJoinPlanning::default(),
        ] {
            let (results, explanation) = SparqlEvaluator::new()
                .with_bounded_join_planning(options)
                .parse_query(query)?
                .on_store(&store)
                .explain();
            assert_eq!(explanation.join_planning().bounded, Some(options));
            assert_eq!(bag(results?)?, expected, "{query}");
        }
    }
    Ok(())
}

#[test]
fn disabled_optimization_and_substitutions_bypass_bounded_search() -> Result {
    let store = store()?;
    let query = "SELECT * { ?s <urn:p> ?o . ?s <urn:q> ?v }";
    let evaluator =
        SparqlEvaluator::new().with_bounded_join_planning(BoundedJoinPlanning::default());
    let (results, explanation) = evaluator
        .clone()
        .without_optimizations()
        .parse_query(query)?
        .on_store(&store)
        .explain();
    assert_eq!(explanation.join_planning().bounded, None);
    bag(results?)?;
    let (results, explanation) = evaluator
        .parse_query(query)?
        .substitute_variable(Variable::new("s")?, NamedNode::new("urn:a")?)
        .on_store(&store)
        .explain();
    assert_eq!(explanation.join_planning().bounded, None);
    assert_eq!(bag(results?)?.0, 2);
    Ok(())
}

#[test]
fn all_query_forms_keep_results_and_cancellation() -> Result {
    let store = store()?;
    for query in [
        "ASK { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "CONSTRUCT { ?s <urn:out> ?o } WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v }",
        "DESCRIBE ?s WHERE { ?s <urn:p> ?o . ?s <urn:q> ?v }",
    ] {
        let expected = SparqlEvaluator::new()
            .without_optimizations()
            .parse_query(query)?
            .on_store(&store)
            .execute()?;
        let evaluator =
            SparqlEvaluator::new().with_bounded_join_planning(BoundedJoinPlanning::default());
        let (actual, explanation) = evaluator
            .clone()
            .parse_query(query)?
            .on_store(&store)
            .explain();
        assert_eq!(explanation.join_planning().dp_components, 1, "{query}");
        match (expected, actual?) {
            (QueryResults::Boolean(a), QueryResults::Boolean(b)) => assert_eq!(a, b),
            (QueryResults::Graph(a), QueryResults::Graph(b)) => {
                let mut a = a.collect::<std::result::Result<Graph, _>>()?;
                let mut b = b.collect::<std::result::Result<Graph, _>>()?;
                a.canonicalize(CanonicalizationAlgorithm::Unstable)?;
                b.canonicalize(CanonicalizationAlgorithm::Unstable)?;
                assert_eq!(a, b, "{query}");
            }
            _ => return Err("wrong result type".into()),
        }
        let token = CancellationToken::new();
        token.cancel();
        let result = evaluator
            .with_cancellation_token(token)
            .parse_query(query)?
            .on_store(&store)
            .execute();
        match result {
            Err(QueryEvaluationError::Cancelled) => (),
            Ok(QueryResults::Graph(mut rows)) => assert!(matches!(
                rows.next(),
                Some(Err(QueryEvaluationError::Cancelled))
            )),
            _ => return Err("cancelled query must not succeed".into()),
        }
    }
    Ok(())
}

#[test]
#[cfg(feature = "rdf-12")]
fn bounded_planning_preserves_rdf12_patterns_and_version_errors() -> Result {
    use oxigraph::model::{GraphName, Quad};
    use oxigraph::sparql::SparqlVersion;
    let store = Store::new()?;
    let node = NamedNode::new("urn:node")?;
    store.insert(Quad::new(
        node.clone(),
        node.clone(),
        Triple::new(node.clone(), node.clone(), node.clone()),
        GraphName::DefaultGraph,
    ))?;
    let evaluator =
        SparqlEvaluator::new().with_bounded_join_planning(BoundedJoinPlanning::default());
    let query = "VERSION \"1.2\" SELECT * { ?s <urn:node> <<( ?a ?b ?c )>> . ?s <urn:node> ?o }";
    assert_eq!(
        bag(evaluator
            .clone()
            .parse_query(query)?
            .on_store(&store)
            .execute()?)?,
        bag(SparqlEvaluator::new()
            .without_optimizations()
            .parse_query(query)?
            .on_store(&store)
            .execute()?)?
    );
    assert!(matches!(
        evaluator
            .parse_query("VERSION \"1.1\" ASK { ?s ?p ?o . ?s ?p ?other }")?
            .on_store(&store)
            .execute(),
        Err(QueryEvaluationError::IncompatibleTerm {
            version: SparqlVersion::V1_1,
            ..
        })
    ));
    Ok(())
}
