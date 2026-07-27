#![expect(
    clippy::tests_outside_test_module,
    clippy::panic_in_result_fn,
    reason = "this integration-test crate directly exposes executable conformance cases"
)]

use oxigraph::model::{BlankNode, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::SparqlEvaluator;
use oxigraph::store::Store;
use std::collections::HashSet;
use std::error::Error;

const S: &str = "urn:update:s";
const P: &str = "urn:update:p";
const Q: &str = "urn:update:q";
const OLD: &str = "urn:update:old";
const NEW: &str = "urn:update:new";
const SOURCE: &str = "urn:update:source";
const DESTINATION: &str = "urn:update:destination";

fn node(value: &str) -> NamedNode {
    NamedNode::new_unchecked(value.to_owned())
}

fn named_graph(value: &str) -> GraphName {
    node(value).into()
}

fn quad(subject: &str, predicate: &str, object: &str, graph: GraphName) -> Quad {
    Quad::new(node(subject), node(predicate), node(object), graph)
}

fn execute(store: &Store, update: &str) -> Result<(), Box<dyn Error>> {
    SparqlEvaluator::new()
        .parse_update(update)?
        .on_store(store)
        .execute()?;
    Ok(())
}

fn graph_exists(store: &Store, graph: &str) -> Result<bool, Box<dyn Error>> {
    Ok(store.contains_named_graph(&NamedOrBlankNode::from(node(graph)))?)
}

#[test]
fn insert_data_uses_co_referent_fresh_blank_nodes_per_request() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let update = "INSERT DATA {
        _:b <urn:update:p> <urn:update:old> .
        _:b <urn:update:q> <urn:update:new>
    }";
    execute(&store, update)?;
    execute(&store, update)?;

    let subjects_for = |predicate: &str| -> Result<Vec<BlankNode>, Box<dyn Error>> {
        store
            .quads_for_pattern(None, Some(&node(predicate)), None, None)
            .map(|quad| {
                let subject = quad?.subject;
                match subject {
                    NamedOrBlankNode::BlankNode(subject) => Ok(subject),
                    NamedOrBlankNode::NamedNode(_) => Err("expected a blank-node subject".into()),
                }
            })
            .collect()
    };
    let p_subjects = subjects_for(P)?.into_iter().collect::<HashSet<_>>();
    let q_subjects = subjects_for(Q)?.into_iter().collect::<HashSet<_>>();
    assert_eq!(p_subjects, q_subjects);
    assert_eq!(p_subjects.len(), 2);
    Ok(())
}

#[test]
fn data_forms_enforce_variables_and_blank_node_rules() {
    for update in [
        "INSERT DATA { ?s <urn:update:p> <urn:update:o> }",
        "DELETE DATA { _:b <urn:update:p> <urn:update:o> }",
        "DELETE WHERE { _:b <urn:update:p> <urn:update:o> }",
        "DELETE { _:b <urn:update:p> <urn:update:o> } WHERE {}",
    ] {
        assert!(
            SparqlEvaluator::new().parse_update(update).is_err(),
            "invalid update was accepted: {update}"
        );
    }
}

#[test]
fn insert_and_delete_data_observe_graph_existence_rules() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    execute(&store, "INSERT DATA { GRAPH <urn:update:destination> {} }")?;
    assert!(!graph_exists(&store, DESTINATION)?);

    execute(
        &store,
        "INSERT DATA {
            GRAPH <urn:update:destination> {
                <urn:update:s> <urn:update:p> <urn:update:new>
            }
        }",
    )?;
    assert!(graph_exists(&store, DESTINATION)?);
    execute(
        &store,
        "INSERT DATA {
            GRAPH <urn:update:destination> {
                <urn:update:s> <urn:update:p> <urn:update:new>
            }
        }",
    )?;
    assert_eq!(store.len()?, 1);
    execute(
        &store,
        "DELETE DATA {
            GRAPH <urn:update:missing> {
                <urn:update:s> <urn:update:p> <urn:update:new>
            }
        }",
    )?;
    assert!(store.contains(&quad(S, P, NEW, named_graph(DESTINATION)))?);
    Ok(())
}

#[test]
fn delete_insert_uses_one_snapshot_and_deletes_before_inserting() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.insert(quad(S, P, OLD, GraphName::DefaultGraph))?;
    execute(
        &store,
        "DELETE { ?s <urn:update:p> <urn:update:old> }
         INSERT { ?s <urn:update:p> <urn:update:new> }
         WHERE  { ?s <urn:update:p> <urn:update:old> }",
    )?;
    assert!(!store.contains(&quad(S, P, OLD, GraphName::DefaultGraph))?);
    assert!(store.contains(&quad(S, P, NEW, GraphName::DefaultGraph))?);
    Ok(())
}

#[test]
fn insert_template_blank_nodes_are_fresh_per_solution() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.insert(quad(S, P, OLD, GraphName::DefaultGraph))?;
    store.insert(quad("urn:update:second", P, NEW, GraphName::DefaultGraph))?;
    execute(
        &store,
        "INSERT {
            _:fresh <urn:update:q> ?value .
            _:fresh <urn:update:linked> ?s
         } WHERE { ?s <urn:update:p> ?value }",
    )?;

    let subjects = store
        .quads_for_pattern(None, Some(&node(Q)), None, None)
        .map(|quad| Ok::<_, Box<dyn Error>>(quad?.subject))
        .collect::<Result<HashSet<_>, _>>()?;
    assert_eq!(subjects.len(), 2);
    for subject in subjects {
        assert_eq!(
            store
                .quads_for_pattern(Some(&subject), Some(&node("urn:update:linked")), None, None)
                .count(),
            1
        );
    }
    Ok(())
}

#[test]
fn delete_template_preserves_blank_node_identity_from_where() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let blank = BlankNode::new_unchecked("stored");
    let blank_quad = Quad::new(blank, node(P), node(OLD), GraphName::DefaultGraph);
    let named_quad = quad(S, P, OLD, GraphName::DefaultGraph);
    store.insert(blank_quad.clone())?;
    store.insert(named_quad.clone())?;
    execute(
        &store,
        "DELETE { ?subject ?predicate ?object }
         WHERE {
            ?subject ?predicate ?object
            FILTER(isBlank(?subject))
         }",
    )?;
    assert!(!store.contains(&blank_quad)?);
    assert!(store.contains(&named_quad)?);
    Ok(())
}

#[test]
fn delete_where_applies_the_quad_pattern_to_named_graphs() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.insert(quad(S, P, OLD, named_graph(SOURCE)))?;
    store.insert(quad("urn:update:second", P, NEW, named_graph(SOURCE)))?;
    execute(
        &store,
        "DELETE WHERE {
            GRAPH <urn:update:source> { ?subject <urn:update:p> ?object }
        }",
    )?;
    assert!(store.is_empty()?);
    assert!(graph_exists(&store, SOURCE)?);
    Ok(())
}

#[test]
fn using_overrides_with_only_for_where_dataset() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.insert(quad(S, P, OLD, named_graph(SOURCE)))?;
    store.insert(quad(S, P, NEW, named_graph(DESTINATION)))?;
    execute(
        &store,
        "WITH <urn:update:source>
         DELETE { <urn:update:s> <urn:update:p> ?value }
         INSERT { <urn:update:s> <urn:update:q> ?value }
         USING <urn:update:destination>
         WHERE  { <urn:update:s> <urn:update:p> ?value }",
    )?;

    assert!(store.contains(&quad(S, P, OLD, named_graph(SOURCE)))?);
    assert!(store.contains(&quad(S, Q, NEW, named_graph(SOURCE)))?);
    assert!(!store.contains(&quad(S, Q, OLD, named_graph(SOURCE)))?);
    assert!(store.contains(&quad(S, P, NEW, named_graph(DESTINATION)))?);
    Ok(())
}

#[test]
fn using_named_limits_the_where_named_graphs() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.insert(quad(S, P, NEW, named_graph(SOURCE)))?;
    store.insert(quad("urn:update:other", P, OLD, named_graph(DESTINATION)))?;
    execute(
        &store,
        "INSERT { GRAPH <urn:update:output> { ?s <urn:update:q> ?value } }
         USING NAMED <urn:update:source>
         WHERE { GRAPH <urn:update:source> { ?s <urn:update:p> ?value } }",
    )?;
    assert!(store.contains(&quad(S, Q, NEW, named_graph("urn:update:output")))?);
    assert!(!store.contains(&quad(
        "urn:update:other",
        Q,
        OLD,
        named_graph("urn:update:output"),
    ))?);
    Ok(())
}

#[test]
fn clear_create_and_drop_observe_named_graph_existence() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    assert!(execute(&store, "CLEAR GRAPH <urn:update:missing>").is_err());
    execute(&store, "CLEAR SILENT GRAPH <urn:update:missing>")?;

    store.insert(quad(S, P, OLD, named_graph(SOURCE)))?;
    assert!(execute(&store, "CREATE GRAPH <urn:update:source>").is_err());
    execute(&store, "CREATE SILENT GRAPH <urn:update:source>")?;
    assert!(store.contains(&quad(S, P, OLD, named_graph(SOURCE)))?);

    execute(&store, "CLEAR GRAPH <urn:update:source>")?;
    assert!(graph_exists(&store, SOURCE)?);
    assert!(!store.contains(&quad(S, P, OLD, named_graph(SOURCE)))?);
    execute(&store, "DROP GRAPH <urn:update:source>")?;
    assert!(!graph_exists(&store, SOURCE)?);
    assert!(execute(&store, "DROP GRAPH <urn:update:source>").is_err());
    execute(&store, "DROP SILENT GRAPH <urn:update:source>")?;
    Ok(())
}

#[test]
fn aggregate_clear_and_drop_targets_preserve_the_default_slot() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.insert(quad(S, P, OLD, GraphName::DefaultGraph))?;
    store.insert(quad(S, P, NEW, named_graph(SOURCE)))?;
    execute(&store, "CLEAR NAMED")?;
    assert!(store.contains(&quad(S, P, OLD, GraphName::DefaultGraph))?);
    assert!(graph_exists(&store, SOURCE)?);

    store.insert(quad(S, P, NEW, named_graph(SOURCE)))?;
    execute(&store, "CLEAR ALL")?;
    assert!(store.is_empty()?);
    assert!(graph_exists(&store, SOURCE)?);

    store.insert(quad(S, P, OLD, GraphName::DefaultGraph))?;
    store.insert(quad(S, P, NEW, named_graph(SOURCE)))?;
    execute(&store, "DROP DEFAULT")?;
    assert!(!store.contains(&quad(S, P, OLD, GraphName::DefaultGraph))?);
    assert!(store.contains(&quad(S, P, NEW, named_graph(SOURCE)))?);
    execute(&store, "DROP NAMED")?;
    assert!(!graph_exists(&store, SOURCE)?);

    store.insert(quad(S, P, OLD, GraphName::DefaultGraph))?;
    store.insert(quad(S, P, NEW, named_graph(SOURCE)))?;
    execute(&store, "DROP ALL")?;
    assert!(store.is_empty()?);
    assert!(!graph_exists(&store, SOURCE)?);
    execute(
        &store,
        "INSERT DATA { <urn:update:s> <urn:update:p> <urn:update:new> }",
    )?;
    assert!(store.contains(&quad(S, P, NEW, GraphName::DefaultGraph))?);
    Ok(())
}

#[test]
fn empty_graph_shortcuts_create_the_destination() -> Result<(), Box<dyn Error>> {
    for operation in ["ADD", "COPY", "MOVE"] {
        let store = Store::new()?;
        store.insert_named_graph(node(SOURCE))?;
        execute(
            &store,
            &format!("{operation} GRAPH <urn:update:source> TO GRAPH <urn:update:destination>"),
        )?;
        assert!(
            graph_exists(&store, DESTINATION)?,
            "{operation} did not create its empty destination"
        );
        assert_eq!(
            graph_exists(&store, SOURCE)?,
            operation != "MOVE",
            "{operation} produced the wrong source graph state"
        );
    }
    Ok(())
}

#[test]
fn silent_shortcuts_succeed_for_a_missing_source() -> Result<(), Box<dyn Error>> {
    for operation in ["ADD", "COPY", "MOVE"] {
        let store = Store::new()?;
        execute(
            &store,
            &format!(
                "{operation} SILENT GRAPH <urn:update:missing> TO GRAPH <urn:update:destination>"
            ),
        )?;
        assert!(graph_exists(&store, DESTINATION)?);
    }
    Ok(())
}

#[test]
fn graph_shortcuts_apply_add_copy_move_and_self_noop_semantics() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    let source_quad = quad(S, P, NEW, named_graph(SOURCE));
    let destination_quad = quad(S, P, OLD, named_graph(DESTINATION));
    store.insert(source_quad.clone())?;
    store.insert(destination_quad.clone())?;
    execute(
        &store,
        "ADD GRAPH <urn:update:source> TO GRAPH <urn:update:destination>",
    )?;
    assert!(store.contains(&source_quad)?);
    assert!(store.contains(&destination_quad)?);
    assert!(store.contains(&quad(S, P, NEW, named_graph(DESTINATION)))?);

    execute(
        &store,
        "COPY GRAPH <urn:update:source> TO GRAPH <urn:update:destination>",
    )?;
    assert!(!store.contains(&destination_quad)?);
    assert!(store.contains(&quad(S, P, NEW, named_graph(DESTINATION)))?);
    execute(
        &store,
        "MOVE GRAPH <urn:update:destination> TO GRAPH <urn:update:source>",
    )?;
    assert!(!graph_exists(&store, DESTINATION)?);
    assert!(store.contains(&source_quad)?);

    for operation in ["ADD", "COPY", "MOVE"] {
        execute(
            &store,
            &format!("{operation} GRAPH <urn:update:source> TO GRAPH <urn:update:source>"),
        )?;
        assert!(store.contains(&source_quad)?);
    }
    Ok(())
}

#[test]
fn illegal_or_unbound_template_terms_are_omitted() -> Result<(), Box<dyn Error>> {
    let store = Store::new()?;
    store.insert(quad(S, P, OLD, GraphName::DefaultGraph))?;
    execute(
        &store,
        "INSERT {
            ?missing <urn:update:p> <urn:update:new> .
            <urn:update:s> ?missing <urn:update:new>
         } WHERE { <urn:update:s> <urn:update:p> <urn:update:old> }",
    )?;
    assert_eq!(store.len()?, 1);
    assert_eq!(
        store
            .quads_for_pattern(None, None, Some(&Term::from(node(NEW))), None)
            .count(),
        0
    );
    Ok(())
}
