#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise the public OWL 2 RL/RDF engine"
)]

use oxdatalog::{EvaluationError, EvaluationOptions, LimitKind, rdf::RdfEvaluationError};
use oxowl::{
    DATALOG_RULE_IDS, OWL2_RL_RDF_PROFILE, OWL2_RL_RDF_RULES, Owl2RlConsistency,
    Owl2RlExecutionPath, Owl2RlPositiveSeed, Owl2RlRdf, Owl2RlRdfError, Owl2RlRdfOptions,
    SPECIALIZED_RULE_IDS,
};
use oxrdf::{
    BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term,
    vocab::{rdf, xsd},
};

const OWL: &str = "http://www.w3.org/2002/07/owl#";

fn node(local: &str) -> NamedNode {
    NamedNode::new(format!("http://example.com/{local}")).unwrap()
}

fn owl(local: &str) -> NamedNode {
    NamedNode::new(format!("{OWL}{local}")).unwrap()
}

fn quad(
    subject: impl Into<NamedOrBlankNode>,
    predicate: impl Into<NamedNode>,
    object: impl Into<Term>,
) -> Quad {
    Quad::new(subject, predicate, object, GraphName::DefaultGraph)
}

fn list(dataset: &mut Dataset, id: &str, values: impl IntoIterator<Item = Term>) -> BlankNode {
    let values = values.into_iter().collect::<Vec<_>>();
    let head = BlankNode::new(format!("{id}0")).unwrap();
    for (index, value) in values.iter().enumerate() {
        let current = BlankNode::new(format!("{id}{index}")).unwrap();
        let rest = if index + 1 == values.len() {
            Term::from(rdf::NIL)
        } else {
            Term::from(BlankNode::new(format!("{id}{}", index + 1)).unwrap())
        };
        dataset.insert(quad(current.clone(), rdf::FIRST, value.clone()));
        dataset.insert(quad(current, rdf::REST, rest));
    }
    head
}

#[test]
fn exact_w3c_rule_inventory_is_exposed() {
    assert_eq!(Owl2RlRdf::profile_id(), OWL2_RL_RDF_PROFILE);
    assert_eq!(OWL2_RL_RDF_RULES.len(), 78);
    assert_eq!(Owl2RlRdf::implemented_rules().len(), 78);
    assert_eq!(OWL2_RL_RDF_RULES.first().unwrap().id(), "eq-ref");
    assert_eq!(OWL2_RL_RDF_RULES.last().unwrap().id(), "scm-uni");
    assert!(
        OWL2_RL_RDF_RULES
            .iter()
            .all(|rule| rule.source().ends_with(rule.id()))
    );
    let inventory = OWL2_RL_RDF_RULES
        .iter()
        .map(|rule| rule.id())
        .collect::<std::collections::HashSet<_>>();
    let datalog = DATALOG_RULE_IDS
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    let specialized = SPECIALIZED_RULE_IDS
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(datalog.len(), 46);
    assert_eq!(specialized.len(), 32);
    assert!(datalog.is_disjoint(&specialized));
    assert_eq!(inventory, datalog.union(&specialized).copied().collect());
}

#[test]
fn explicitly_empty_named_graph_gets_graph_local_axioms() {
    let graph = node("empty-named");
    let mut base = Dataset::new();
    base.insert_named_graph(graph.clone());

    let closure = Owl2RlRdf
        .evaluate(&base, &Owl2RlRdfOptions::default())
        .unwrap();
    assert!(closure.base().contains_named_graph(&graph));
    assert!(closure.entailed().contains_named_graph(&graph));
    assert!(
        closure
            .entailed()
            .contains(&Quad::new(owl("Thing"), rdf::TYPE, owl("Class"), graph,))
    );
}

#[test]
fn representable_rules_execute_through_datalog_with_provenance() {
    let property = node("parent");
    let class = node("Person");
    let alice = node("alice");
    let bob = node("bob");
    let mut base = Dataset::new();
    base.insert(quad(
        property.clone(),
        oxrdf::vocab::rdfs::DOMAIN,
        class.clone(),
    ));
    base.insert(quad(alice.clone(), property, bob));
    let mut options = Owl2RlRdfOptions::default();
    options.evaluation.track_provenance = true;

    let closure = Owl2RlRdf.evaluate(&base, &options).unwrap();
    let inferred = quad(alice, rdf::TYPE, class);
    let derivation = closure.derivation(&inferred).unwrap();
    assert_eq!(derivation.rule_id(), "prp-dom");
    assert_eq!(derivation.execution_path(), Owl2RlExecutionPath::Datalog);
    let receipt = closure.receipt();
    assert_eq!(receipt.datalog_rule_count, 46);
    assert_eq!(receipt.specialized_rule_count, 32);
    assert!(receipt.datalog_executions > 0);
    assert!(receipt.datalog_iterations > 0);
}

#[test]
fn full_datalog_core_preserves_the_positive_seed_closure() {
    let dog = node("Dog");
    let mammal = node("Mammal");
    let animal = node("Animal");
    let fido = node("fido");
    let mut base = Dataset::new();
    base.insert(quad(
        dog.clone(),
        oxrdf::vocab::rdfs::SUB_CLASS_OF,
        mammal.clone(),
    ));
    base.insert(quad(mammal, oxrdf::vocab::rdfs::SUB_CLASS_OF, animal));
    base.insert(quad(fido, rdf::TYPE, dog));

    let seed = Owl2RlPositiveSeed::new()
        .evaluate(&base, &EvaluationOptions::default())
        .unwrap();
    let full = Owl2RlRdf
        .evaluate(&base, &Owl2RlRdfOptions::default())
        .unwrap();
    for expected in seed.inference() {
        assert!(full.entailed().contains(&expected), "missing {expected}");
    }
}

#[test]
fn functional_properties_and_equality_replace_objects() {
    let property = node("ssn");
    let alice = node("alice");
    let first = node("first");
    let second = node("second");
    let marker = node("marker");
    let mut base = Dataset::new();
    base.insert(quad(property.clone(), rdf::TYPE, owl("FunctionalProperty")));
    base.insert(quad(alice.clone(), property.clone(), first.clone()));
    base.insert(quad(alice.clone(), property, second.clone()));
    base.insert(quad(first.clone(), marker.clone(), node("value")));

    let closure = Owl2RlRdf
        .evaluate(&base, &Owl2RlRdfOptions::default())
        .unwrap();
    assert!(
        closure
            .entailed()
            .contains(&quad(first.clone(), owl("sameAs"), second.clone()))
    );
    assert!(
        closure
            .entailed()
            .iter()
            .any(|item| item.subject == second && item.predicate == marker)
    );
    assert!(matches!(
        closure.consistency(),
        Owl2RlConsistency::Consistent
    ));
}

#[test]
fn property_chains_and_keys_use_complete_rdf_lists() {
    let parent = node("parent");
    let sibling = node("sibling");
    let relation = node("relative");
    let alice = node("alice");
    let bob = node("bob");
    let carol = node("carol");
    let person = node("Person");
    let identifier = node("identifier");
    let alicia = node("alicia");
    let id = node("id");
    let mut base = Dataset::new();
    let chain = list(
        &mut base,
        "chain",
        [Term::from(parent.clone()), Term::from(sibling.clone())],
    );
    base.insert(quad(relation.clone(), owl("propertyChainAxiom"), chain));
    base.insert(quad(alice.clone(), parent, bob.clone()));
    base.insert(quad(bob, sibling, carol.clone()));
    let keys = list(&mut base, "key", [Term::from(identifier.clone())]);
    base.insert(quad(person.clone(), owl("hasKey"), keys));
    for individual in [&alice, &alicia] {
        base.insert(quad(individual.clone(), rdf::TYPE, person.clone()));
        base.insert(quad(individual.clone(), identifier.clone(), id.clone()));
    }

    let closure = Owl2RlRdf
        .evaluate(&base, &Owl2RlRdfOptions::default())
        .unwrap();
    assert!(
        closure
            .entailed()
            .contains(&quad(alice.clone(), relation, carol))
    );
    assert!(
        closure
            .entailed()
            .contains(&quad(alice, owl("sameAs"), alicia))
    );
}

#[test]
fn class_lists_and_restrictions_materialize_membership() {
    let person = node("Person");
    let employee = node("Employee");
    let employed_person = node("EmployedPerson");
    let worker = node("Worker");
    let works_for = node("worksFor");
    let company = node("Company");
    let alice = node("alice");
    let acme = node("acme");
    let mut base = Dataset::new();
    let intersection = list(
        &mut base,
        "intersection",
        [Term::from(person.clone()), Term::from(employee.clone())],
    );
    base.insert(quad(
        employed_person.clone(),
        owl("intersectionOf"),
        intersection,
    ));
    base.insert(quad(alice.clone(), rdf::TYPE, person));
    base.insert(quad(alice.clone(), rdf::TYPE, employee));
    let restriction = BlankNode::new("restriction").unwrap();
    base.insert(quad(
        restriction.clone(),
        owl("onProperty"),
        works_for.clone(),
    ));
    base.insert(quad(
        restriction.clone(),
        owl("someValuesFrom"),
        company.clone(),
    ));
    base.insert(quad(worker.clone(), owl("equivalentClass"), restriction));
    base.insert(quad(alice.clone(), works_for, acme.clone()));
    base.insert(quad(acme, rdf::TYPE, company));

    let closure = Owl2RlRdf
        .evaluate(&base, &Owl2RlRdfOptions::default())
        .unwrap();
    assert!(
        closure
            .entailed()
            .contains(&quad(alice.clone(), rdf::TYPE, employed_person))
    );
    assert!(closure.entailed().contains(&quad(alice, rdf::TYPE, worker)));
}

#[test]
fn contradictions_are_reported_with_named_rules() {
    let property = node("edge");
    let alice = node("alice");
    let class = node("Impossible");
    let mut base = Dataset::new();
    base.insert(quad(
        property.clone(),
        rdf::TYPE,
        owl("IrreflexiveProperty"),
    ));
    base.insert(quad(alice.clone(), property, alice.clone()));
    base.insert(quad(class.clone(), owl("disjointWith"), node("Other")));
    base.insert(quad(alice.clone(), rdf::TYPE, class));
    base.insert(quad(alice, rdf::TYPE, node("Other")));

    let closure = Owl2RlRdf
        .evaluate(&base, &Owl2RlRdfOptions::default())
        .unwrap();
    assert!(matches!(
        closure.consistency(),
        Owl2RlConsistency::Inconsistent(_)
    ));
    let Owl2RlConsistency::Inconsistent(reasons) = closure.consistency() else {
        return;
    };
    let ids = reasons
        .iter()
        .map(oxowl::Owl2RlContradiction::rule_id)
        .collect::<Vec<_>>();
    assert!(ids.contains(&"prp-irp"));
    assert!(ids.contains(&"cax-dw"));
    assert_eq!(closure.receipt().contradictions, reasons.len());
}

#[test]
fn datatype_rules_keep_generalized_literal_facts() {
    let subject = node("subject");
    let property = node("value");
    let integer = Literal::new_typed_literal("01", xsd::INTEGER);
    let canonical = Literal::new_typed_literal("1", xsd::INTEGER);
    let base = Dataset::from_iter([
        quad(subject.clone(), property.clone(), integer.clone()),
        quad(subject, property, canonical.clone()),
    ]);
    let closure = Owl2RlRdf
        .evaluate(&base, &Owl2RlRdfOptions::default())
        .unwrap();
    assert!(closure.equality_facts().iter().any(|(_, left, right)| {
        left == &Term::from(integer.clone()) && right == &Term::from(canonical.clone())
    }));
    assert!(closure.generalized_facts().iter().any(|fact| {
        fact.subject == integer.clone()
            && fact.predicate == rdf::TYPE
            && fact.object == xsd::INTEGER
    }));
}

#[test]
fn malformed_lists_and_resource_limits_fail_closed() {
    let class = node("Class");
    let broken = BlankNode::new("broken").unwrap();
    let base = Dataset::from_iter([quad(class, owl("oneOf"), broken)]);
    assert!(matches!(
        Owl2RlRdf
            .evaluate(&base, &Owl2RlRdfOptions::default())
            .unwrap_err(),
        Owl2RlRdfError::Input(_)
    ));

    let mut options = Owl2RlRdfOptions::default();
    options.evaluation.limits.max_facts = 1;
    let error = Owl2RlRdf.evaluate(&Dataset::new(), &options).unwrap_err();
    assert!(matches!(
        error,
        Owl2RlRdfError::Evaluation(RdfEvaluationError::Evaluation(
            EvaluationError::LimitExceeded {
                kind: LimitKind::Facts,
                limit: 1
            }
        ))
    ));
}
