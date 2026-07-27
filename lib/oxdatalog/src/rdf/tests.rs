use super::*;

#[test]
fn specialized_relations_are_bounded_for_long_predicate_iris() {
    let predicate = oxrdf::NamedNode::new_unchecked(format!("urn:test:{}", "x".repeat(0x4000)));
    let relation = predicate_relation(predicate.as_ref());

    assert!(relation.as_str().len() <= crate::ValidationLimits::default().max_identifier_bytes);
}

#[test]
fn predicate_relation_collisions_fail_closed() {
    let relation = RelationId::from_static("urn:test:forced-collision");
    let left = oxrdf::NamedNode::new_unchecked("urn:test:left");
    let right = oxrdf::NamedNode::new_unchecked("urn:test:right");
    let mut predicates = BTreeMap::new();
    assert_eq!(
        register_predicate(&mut predicates, relation.clone(), &left),
        Ok(())
    );

    assert_eq!(
        register_predicate(&mut predicates, relation.clone(), &right),
        Err(RdfAdapterError::PredicateRelationCollision {
            relation,
            left,
            right,
        })
    );
}

#[test]
fn specialized_relations_cannot_alias_program_relations() {
    let predicate = oxrdf::NamedNode::new_unchecked("urn:test:predicate");
    let generated_relation = predicate_relation(predicate.as_ref());
    let program = Program::new(vec![Rule::new(
        crate::RuleId::new("alias").unwrap(),
        Atom::new(
            generated_relation.clone(),
            vec![PatternTerm::variable("subject").unwrap()],
        ),
        vec![quad_atom(
            PatternTerm::variable("subject").unwrap(),
            PatternTerm::constant(Value::Term(predicate.into())),
            PatternTerm::variable("object").unwrap(),
            PatternTerm::variable("graph").unwrap(),
        )],
    )]);

    assert!(matches!(
        PreparedRdfProgram::new(&program, &Dataset::new()),
        Err(RdfAdapterError::ReservedPredicateRelation(relation))
            if relation == generated_relation
    ));
}

#[test]
fn generic_preparation_only_decodes_the_quad_relation() {
    let prepared = PreparedRdfProgram::new(&Program::default(), &Dataset::new()).unwrap();
    let quad_fact = Fact::new(
        quad_relation(),
        vec![
            Value::Term(oxrdf::NamedNode::new_unchecked("urn:test:subject").into()),
            Value::Term(oxrdf::NamedNode::new_unchecked("urn:test:predicate").into()),
            Value::Term(oxrdf::NamedNode::new_unchecked("urn:test:object").into()),
            Value::DefaultGraph,
        ],
    );
    let expected = quad_from_fact(&quad_fact).unwrap();
    let unrelated = Fact::new(
        RelationId::new("urn:test:unrelated").unwrap(),
        quad_fact.values().to_vec(),
    );

    assert!(!prepared.specialized);
    assert_eq!(prepared.quad_from_fact(&quad_fact).unwrap(), Some(expected));
    assert_eq!(prepared.quad_from_fact(&unrelated).unwrap(), None);
}

#[test]
fn fixed_rdf_predicates_are_classified_exactly() {
    let fixed = quad_atom(
        PatternTerm::variable("subject").unwrap(),
        PatternTerm::constant(Value::Term(
            oxrdf::NamedNode::new_unchecked("urn:test:predicate").into(),
        )),
        PatternTerm::variable("object").unwrap(),
        PatternTerm::variable("graph").unwrap(),
    );
    let variable = quad_atom(
        PatternTerm::variable("subject").unwrap(),
        PatternTerm::variable("predicate").unwrap(),
        PatternTerm::variable("object").unwrap(),
        PatternTerm::variable("graph").unwrap(),
    );
    let non_quad = Atom::new(RelationId::new("urn:test:relation").unwrap(), Vec::new());

    assert!(has_fixed_rdf_predicate(&fixed));
    assert!(!has_fixed_rdf_predicate(&variable));
    assert!(has_fixed_rdf_predicate(&non_quad));
}
