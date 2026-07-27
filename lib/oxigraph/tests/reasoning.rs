#![cfg(feature = "datalog")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public store reasoning boundary"
)]

use oxdatalog::{EvaluationLimits, EvaluationOptions, PatternTerm, Program, Rule, RuleId};
use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::reasoning::{StoreReasoningError, evaluate_store, materialize_to_graph};
use oxigraph::store::Store;

fn node(name: &str) -> NamedNode {
    NamedNode::new(format!("urn:test:{name}")).unwrap()
}

fn variable(name: &str) -> PatternTerm {
    PatternTerm::variable(name).unwrap()
}

fn predicate_rule(source: NamedNode, target: NamedNode) -> Program {
    Program::new(vec![Rule::new(
        RuleId::new("predicate-map").unwrap(),
        oxdatalog::rdf::quad_atom(
            variable("subject"),
            PatternTerm::from(Term::NamedNode(target)),
            variable("object"),
            variable("graph"),
        ),
        vec![oxdatalog::rdf::quad_atom(
            variable("subject"),
            PatternTerm::from(Term::NamedNode(source)),
            variable("object"),
            variable("graph"),
        )],
    )])
}

#[test]
fn evaluation_owns_a_read_only_snapshot_and_separate_inference_graph() {
    let store = Store::new().unwrap();
    let source = node("source");
    let target = node("target");
    let base = Quad::new(
        node("subject"),
        source.clone(),
        node("object"),
        GraphName::DefaultGraph,
    );
    store.insert(base.clone()).unwrap();

    let closure = evaluate_store(
        &store,
        &predicate_rule(source, target.clone()),
        &EvaluationOptions::default(),
    )
    .unwrap();
    let inferred = Quad::new(
        node("subject"),
        target,
        node("object"),
        GraphName::DefaultGraph,
    );

    assert!(closure.base().contains(&base));
    assert!(closure.inference().contains(&inferred));
    assert!(!store.contains(&inferred).unwrap());
}

#[test]
fn evaluation_snapshot_preserves_empty_named_graph_topology() {
    let store = Store::new().unwrap();
    let graph = node("empty");
    store.insert_named_graph(graph.clone()).unwrap();

    let closure = evaluate_store(
        &store,
        &Program::new(Vec::new()),
        &EvaluationOptions::default(),
    )
    .unwrap();
    assert!(closure.base().contains_named_graph(&graph));
    assert!(closure.entailed().dataset().contains_named_graph(&graph));
}

#[test]
fn materialization_is_atomic_and_requires_an_explicit_target_graph() {
    let store = Store::new().unwrap();
    let source = node("source");
    let target = node("target");
    let materialized = node("materialized");
    let base = Quad::new(
        node("subject"),
        source.clone(),
        node("object"),
        GraphName::DefaultGraph,
    );
    store.insert(base.clone()).unwrap();
    let expected = Quad::new(
        node("subject"),
        target.clone(),
        node("object"),
        materialized.clone(),
    );

    let receipt = materialize_to_graph(
        &store,
        &predicate_rule(source.clone(), target.clone()),
        materialized.clone().into(),
        &EvaluationOptions::default(),
    )
    .unwrap();

    let target_graph = NamedOrBlankNode::from(materialized.clone());
    assert_eq!(receipt.target_graph(), &target_graph);
    assert_eq!(receipt.inferred_quads(), 1);
    assert_eq!(receipt.inserted_quads(), 1);
    assert!(store.contains(&base).unwrap());
    assert!(store.contains(&expected).unwrap());
    assert!(
        !store
            .contains(&Quad::new(
                node("subject"),
                target,
                node("object"),
                GraphName::DefaultGraph,
            ))
            .unwrap()
    );

    let second = materialize_to_graph(
        &store,
        &predicate_rule(source, node("target")),
        materialized.into(),
        &EvaluationOptions::default(),
    )
    .unwrap();
    assert_eq!(second.inserted_quads(), 0);
}

#[test]
fn failed_evaluation_writes_nothing() {
    let store = Store::new().unwrap();
    let source = node("source");
    let target = node("target");
    let materialized = node("materialized");
    store
        .insert(Quad::new(
            node("subject"),
            source.clone(),
            node("object"),
            GraphName::DefaultGraph,
        ))
        .unwrap();

    let error = materialize_to_graph(
        &store,
        &predicate_rule(source, target),
        materialized.clone().into(),
        &EvaluationOptions {
            limits: EvaluationLimits {
                max_facts: 1,
                ..EvaluationLimits::default()
            },
            ..EvaluationOptions::default()
        },
    )
    .unwrap_err();

    assert!(matches!(error, StoreReasoningError::Evaluation(_)));
    assert!(!store.contains_named_graph(&materialized.into()).unwrap());
    assert_eq!(store.len().unwrap(), 1);
}

#[test]
fn d2_materialization_fails_closed_instead_of_minting_on_replay() {
    let store = Store::new().unwrap();
    let source = node("source");
    let target = node("target");
    store
        .insert(Quad::new(
            node("subject"),
            source.clone(),
            node("object"),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    let d2 = Program::new(vec![
        Rule::new(
            RuleId::new("generated-object").unwrap(),
            oxdatalog::rdf::quad_atom(
                variable("subject"),
                PatternTerm::from(Term::NamedNode(target)),
                PatternTerm::generated_blank_node("object").unwrap(),
                variable("graph"),
            ),
            vec![oxdatalog::rdf::quad_atom(
                variable("subject"),
                PatternTerm::from(Term::NamedNode(source)),
                variable("source-object"),
                variable("graph"),
            )],
        )
        .run_once(),
    ]);
    let materialized = node("materialized");

    for _ in 0..2 {
        assert!(matches!(
            materialize_to_graph(
                &store,
                &d2,
                materialized.clone().into(),
                &EvaluationOptions::default(),
            ),
            Err(StoreReasoningError::D2MaterializationRequiresOwnedGraph)
        ));
    }
    assert!(!store.contains_named_graph(&materialized.into()).unwrap());
    assert_eq!(store.len().unwrap(), 1);
}

#[test]
fn materialization_deduplicates_quads_when_source_graphs_collapse() {
    let store = Store::new().unwrap();
    let source = node("source");
    let target = node("target");
    let subject = node("subject");
    let object = node("object");
    for graph in [node("source-graph-a"), node("source-graph-b")] {
        store
            .insert(Quad::new(
                subject.clone(),
                source.clone(),
                object.clone(),
                graph,
            ))
            .unwrap();
    }
    let materialized = node("materialized");
    let receipt = materialize_to_graph(
        &store,
        &predicate_rule(source, target.clone()),
        materialized.clone().into(),
        &EvaluationOptions::default(),
    )
    .unwrap();

    assert_eq!(receipt.inferred_quads(), 1);
    assert_eq!(receipt.inserted_quads(), 1);
    assert!(
        store
            .contains(&Quad::new(subject, target, object, materialized))
            .unwrap()
    );
}

#[test]
fn store_iterators_are_repeatable_read_snapshots() {
    let store = Store::new().unwrap();
    let first = Quad::new(
        node("first"),
        node("predicate"),
        node("object"),
        GraphName::DefaultGraph,
    );
    let second = Quad::new(
        node("second"),
        node("predicate"),
        node("object"),
        GraphName::DefaultGraph,
    );
    store.insert(first.clone()).unwrap();
    let snapshot = store.iter();
    store.insert(second).unwrap();
    let observed = snapshot.collect::<Result<Vec<_>, _>>().unwrap();

    assert_eq!(observed, vec![first]);
}
