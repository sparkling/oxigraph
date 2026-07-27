#![cfg(any(feature = "owl2-rl", feature = "rdfs", feature = "shacl"))]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise public optional semantic profiles"
)]

use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::Store;

fn node(name: &str) -> NamedNode {
    NamedNode::new(format!("urn:test:{name}")).unwrap()
}

#[cfg(feature = "rdfs")]
#[test]
fn rdfs_evaluates_a_read_only_store_snapshot() {
    use oxigraph::model::{Term, vocab};
    use oxigraph::rdfs::{RDFS_12_FINITE_PROFILE, RDFS_12_IMPLEMENTED_PATTERNS, Rdfs12Options};
    use oxigraph::reasoning::evaluate_store_rdfs12;
    use oxigraph::sparql::{QueryResults, SparqlEvaluator};

    assert_eq!(RDFS_12_FINITE_PROFILE, "rdfs-1.2-finite-active-vocabulary");
    assert_eq!(RDFS_12_IMPLEMENTED_PATTERNS, 15);

    let store = Store::new().unwrap();
    let dog = node("Dog");
    let animal = node("Animal");
    let fido = node("fido");
    store
        .insert(Quad::new(
            dog.clone(),
            vocab::rdfs::SUB_CLASS_OF,
            animal.clone(),
            GraphName::DefaultGraph,
        ))
        .unwrap();
    store
        .insert(Quad::new(
            fido.clone(),
            vocab::rdf::TYPE,
            dog,
            GraphName::DefaultGraph,
        ))
        .unwrap();

    let closure = evaluate_store_rdfs12(&store, &Rdfs12Options::default()).unwrap();
    let inferred = Quad::new(
        fido,
        vocab::rdf::TYPE,
        Term::from(animal),
        GraphName::DefaultGraph,
    );
    assert!(closure.entailed().contains(&inferred));
    assert!(!store.contains(&inferred).unwrap());
    let result = SparqlEvaluator::new()
        .parse_query("ASK { <urn:test:fido> a <urn:test:Animal> }")
        .unwrap()
        .on_queryable_dataset(closure.entailed())
        .execute()
        .unwrap();
    let answer = if let QueryResults::Boolean(answer) = result {
        answer
    } else {
        false
    };
    assert!(answer);
}

#[cfg(feature = "owl2-rl")]
#[test]
fn owl2_rl_evaluates_a_read_only_store_snapshot() {
    use oxigraph::model::vocab;
    use oxigraph::owl2_rl::Owl2RlRdfOptions;
    use oxigraph::reasoning::evaluate_store_owl2_rl;
    use oxigraph::sparql::{QueryResults, SparqlEvaluator};

    let store = Store::new().unwrap();
    let property = node("ancestor");
    let alice = node("alice");
    let bob = node("bob");
    let carol = node("carol");
    let transitive = NamedNode::new("http://www.w3.org/2002/07/owl#TransitiveProperty").unwrap();
    for quad in [
        Quad::new(
            property.clone(),
            vocab::rdf::TYPE,
            transitive,
            GraphName::DefaultGraph,
        ),
        Quad::new(
            alice.clone(),
            property.clone(),
            bob.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            bob,
            property.clone(),
            carol.clone(),
            GraphName::DefaultGraph,
        ),
    ] {
        store.insert(quad).unwrap();
    }

    let closure = evaluate_store_owl2_rl(&store, &Owl2RlRdfOptions::default()).unwrap();
    let inferred = Quad::new(alice, property, carol, GraphName::DefaultGraph);
    assert!(closure.entailed().contains(&inferred));
    assert!(!store.contains(&inferred).unwrap());
    let result = SparqlEvaluator::new()
        .parse_query("ASK { <urn:test:alice> <urn:test:ancestor> <urn:test:carol> }")
        .unwrap()
        .on_queryable_dataset(closure.entailed())
        .execute()
        .unwrap();
    let answer = if let QueryResults::Boolean(answer) = result {
        answer
    } else {
        false
    };
    assert!(answer);
}

#[cfg(feature = "shacl")]
#[test]
fn shacl_validates_a_stable_store_graph_snapshot() {
    use oxigraph::model::Term;
    use oxigraph::reasoning::validate_store_graph;
    use oxigraph::shacl::{
        Constraint, NodeKind, ProfileSet, Shape, ShapesGraph, Target, ValidationOptions,
    };

    let store = Store::new().unwrap();
    let focus = node("focus");
    let mut shape = Shape::node(node("shape"));
    shape.targets.push(Target::Node(Term::from(focus)));
    shape.constraints.push(Constraint::NodeKind(NodeKind::Iri));
    let options = ValidationOptions::default();
    let shapes = ShapesGraph::from_shapes(ProfileSet::default(), [shape], &options).unwrap();

    let report = validate_store_graph(&store, GraphName::DefaultGraph, &shapes, &options).unwrap();
    assert!(report.conforms());
}

#[cfg(all(feature = "rdfs", feature = "shacl"))]
#[test]
fn rdfs_closure_can_feed_shacl_validation_without_mutating_the_store() {
    use oxigraph::model::{Term, vocab};
    use oxigraph::rdfs::Rdfs12Options;
    use oxigraph::reasoning::evaluate_store_rdfs12;
    use oxigraph::shacl::{
        Constraint, GraphSnapshot, ProfileSet, Shape, ShapesGraph, Target, ValidationOptions,
        validate,
    };

    let store = Store::new().unwrap();
    let has_pet = node("has-pet");
    let person = node("Person");
    let alice = node("alice");
    let fido = node("fido");
    for quad in [
        Quad::new(
            has_pet.clone(),
            vocab::rdfs::DOMAIN,
            person.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(alice.clone(), has_pet, fido, GraphName::DefaultGraph),
    ] {
        store.insert(quad).unwrap();
    }

    let mut shape = Shape::node(node("person-shape"));
    shape.targets.push(Target::Node(Term::from(alice.clone())));
    shape.constraints.push(Constraint::Class(person.clone()));
    let options = ValidationOptions::default();
    let shapes = ShapesGraph::from_shapes(ProfileSet::default(), [shape], &options).unwrap();

    let base = store.into_iter().collect::<Result<_, _>>().unwrap();
    assert!(
        !validate(&shapes, &GraphSnapshot::default_graph(base), &options)
            .unwrap()
            .conforms()
    );

    let closure = evaluate_store_rdfs12(&store, &Rdfs12Options::default()).unwrap();
    assert!(
        validate(
            &shapes,
            &GraphSnapshot::default_graph(closure.entailed().clone()),
            &options
        )
        .unwrap()
        .conforms()
    );
    let inferred = Quad::new(
        alice,
        vocab::rdf::TYPE,
        Term::from(person),
        GraphName::DefaultGraph,
    );
    assert!(!store.contains(&inferred).unwrap());
}
