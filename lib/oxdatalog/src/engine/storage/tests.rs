use super::*;
use crate::{EvaluationLimits, EvaluationOptions};
use oxrdf::NamedNode;
#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
use std::time::Instant;
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use web_time::Instant;

fn term(iri: &str) -> Value {
    Value::Term(NamedNode::new_unchecked(iri.to_owned()).into())
}

fn interner(values: Vec<Value>, estimated_bytes: usize) -> Interner {
    let ids = values
        .iter()
        .cloned()
        .enumerate()
        .map(|(id, value)| (value, TermId::try_from(id).unwrap()))
        .collect();
    Interner {
        values,
        ids,
        generated: HashMap::new(),
        estimated_bytes,
    }
}

#[test]
fn interner_and_value_accounting_are_exact() {
    let default_graph = Value::DefaultGraph;
    let named_node = term("urn:test:value");
    let expected_default_slot = size_of::<Value>() + default_graph.estimated_bytes() + 16;
    let expected_named_slot = size_of::<Value>() + named_node.estimated_bytes() + 16;

    assert_eq!(estimate_value_slot(&default_graph), expected_default_slot);
    assert_eq!(estimate_value_slot(&named_node), expected_named_slot);
    assert_eq!(
        estimate_values(&[default_graph.clone(), named_node.clone()]),
        size_of::<Vec<Value>>() + expected_default_slot + expected_named_slot
    );
    assert_eq!(
        estimate_id_entry(&named_node),
        expected_named_slot + size_of::<TermId>() + 48
    );
    assert_eq!(interner(Vec::new(), 123).estimated_bytes(), 123);
}

#[test]
fn relation_accounting_and_store_projections_are_exact() {
    let relation = RelationId::new("pair").unwrap();
    let arity = 2;
    let expected_base =
        size_of::<RelationData>() + arity * size_of::<BTreeMap<TermId, BTreeSet<Tuple>>>();
    let expected_tuple = (arity + 1) * (arity * size_of::<TermId>() + 48);
    let expected_relation = relation.as_str().len() + expected_base + 48;

    assert_eq!(RelationData::base_estimated_bytes(arity), expected_base);
    assert_eq!(RelationData::tuple_estimated_bytes(arity), expected_tuple);
    assert_eq!(
        relation_estimated_bytes(&relation, arity),
        expected_relation
    );

    let mut arities = BTreeMap::new();
    arities.insert(relation.clone(), arity);
    let baseline = size_of::<BTreeMap<RelationId, RelationData>>() + expected_relation;
    let mut store = RelationStore::new(&arities);
    let key = (relation.clone(), vec![0, 1]);

    assert_eq!(store.len(), 0);
    assert_eq!(store.estimated_bytes(), baseline);
    assert_eq!(
        store.projected_insert_bytes(&key),
        baseline + expected_tuple
    );
    assert!(store.insert_key(key.clone()));
    assert_eq!(store.len(), 1);
    assert_eq!(store.estimated_bytes(), baseline + expected_tuple);
    assert_eq!(
        store.projected_insert_bytes(&key),
        baseline + expected_tuple
    );
    assert!(!store.insert_key(key.clone()));
    assert_eq!(
        fact_key_estimated_bytes(&key),
        relation.as_str().len() + 2 * size_of::<TermId>() + 64
    );

    let extra_relation = RelationId::new("single").unwrap();
    let extra_key = (extra_relation.clone(), vec![2]);
    let extra_bytes =
        relation_estimated_bytes(&extra_relation, 1) + RelationData::tuple_estimated_bytes(1);
    assert_eq!(
        store.projected_insert_bytes(&extra_key),
        baseline + expected_tuple + extra_bytes
    );
    assert!(store.insert_key(extra_key));
    assert_eq!(store.len(), 2);
    assert_eq!(
        store.estimated_bytes(),
        baseline + expected_tuple + extra_bytes
    );
}

#[test]
fn generated_blank_nodes_are_exact_bounded_and_limit_inclusive() {
    let rule = RuleId::new("r").unwrap();
    let generator = BlankNodeGenerator::new("g").unwrap();
    let binding = BTreeMap::new();
    let mut values = interner(Vec::new(), 17);
    let key = values.generation_key(&rule, &generator, &binding);
    assert_eq!(key, "1:r|1:g");
    let digest = "c67af5b856b1613190d3248da6e9e29b23302728cb8cf83a0cfc49137a4c7f7e";
    let expected = Value::Term(Term::BlankNode(BlankNode::new_unchecked(format!(
        "oxdatalog-{digest}"
    ))));
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            max_term_bytes: expected.estimated_bytes(),
            timeout: None,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let mut guard = ExecutionGuard::new(&options, Instant::now());
    let mut memory = RuntimeMemory {
        interner: values.estimated_bytes(),
        ..RuntimeMemory::default()
    };

    let id = values
        .generate_blank_node(&rule, &generator, &binding, &mut guard, &mut memory)
        .unwrap();
    let expected_bytes =
        17 + estimate_value_slot(&expected) + estimate_id_entry(&expected) + key.len() + 64;
    assert_eq!(id, 0);
    assert_eq!(values.values[id as usize], expected);
    assert_eq!(values.estimated_bytes(), expected_bytes);
    assert_eq!(memory.interner, expected_bytes);
    assert_eq!(
        values
            .generate_blank_node(&rule, &generator, &binding, &mut guard, &mut memory)
            .unwrap(),
        id
    );
}

#[test]
fn generated_blank_nodes_skip_an_existing_base_label() {
    let rule = RuleId::new("r").unwrap();
    let generator = BlankNodeGenerator::new("g").unwrap();
    let binding = BTreeMap::new();
    let empty = interner(Vec::new(), 0);
    let key = empty.generation_key(&rule, &generator, &binding);
    assert_eq!(key, "1:r|1:g");
    let digest = "c67af5b856b1613190d3248da6e9e29b23302728cb8cf83a0cfc49137a4c7f7e";
    let base = format!("oxdatalog-{digest}");
    let collision = Value::Term(Term::BlankNode(BlankNode::new_unchecked(base.clone())));
    let mut values = interner(vec![collision], 19);
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            timeout: None,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };
    let mut guard = ExecutionGuard::new(&options, Instant::now());
    let mut memory = RuntimeMemory {
        interner: values.estimated_bytes(),
        ..RuntimeMemory::default()
    };

    let id = values
        .generate_blank_node(&rule, &generator, &binding, &mut guard, &mut memory)
        .unwrap();
    assert_eq!(id, 1);
    assert_eq!(
        values.values[id as usize],
        Value::Term(Term::BlankNode(BlankNode::new_unchecked(format!(
            "{base}-1"
        ))))
    );
}
