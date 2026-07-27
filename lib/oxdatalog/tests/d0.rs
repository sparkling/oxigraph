#![expect(
    clippy::missing_assert_message,
    clippy::tests_outside_test_module,
    reason = "integration tests keep assertions close to their named scenarios"
)]
#![cfg_attr(
    feature = "spareval",
    expect(clippy::panic, reason = "the SELECT result kind is part of the test")
)]

use oxdatalog::rdf::{self, RdfEvaluationError};
use oxdatalog::{
    Atom, CancellationToken, Engine, EvaluationError, EvaluationLimits, EvaluationOptions, Fact,
    LimitKind, PatternTerm, Program, RelationId, Rule, RuleId, ValidationError, ValidationLimits,
    Value, validate,
};
#[cfg(any(feature = "rdf-12", feature = "spareval"))]
use oxrdf::Term;
#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxrdf::{Dataset, GraphName, NamedNode, Quad};

fn relation(name: &str) -> RelationId {
    RelationId::new(format!("urn:test:relation:{name}")).unwrap()
}

fn rule_id(name: &str) -> RuleId {
    RuleId::new(name).unwrap()
}

fn node(name: &str) -> NamedNode {
    NamedNode::new(format!("urn:test:{name}")).unwrap()
}

fn value(name: &str) -> Value {
    Value::Term(node(name).into())
}

fn variable(name: &str) -> PatternTerm {
    PatternTerm::variable(name).unwrap()
}

fn constant(node: &NamedNode) -> PatternTerm {
    PatternTerm::constant(Value::Term(node.clone().into()))
}

fn atom(relation: &RelationId, variables: &[&str]) -> Atom {
    Atom::new(
        relation.clone(),
        variables
            .iter()
            .map(|name| variable(name))
            .collect::<Vec<_>>(),
    )
}

fn fact(relation: &RelationId, values: &[&str]) -> Fact {
    Fact::new(
        relation.clone(),
        values.iter().map(|name| value(name)).collect::<Vec<_>>(),
    )
}

fn fact_keys(facts: &[Fact]) -> Vec<String> {
    facts.iter().map(Fact::canonical_key).collect()
}

fn ancestor_program() -> Program {
    let edge = relation("edge");
    let ancestor = relation("ancestor");
    Program::new(vec![
        Rule::new(
            rule_id("ancestor-direct"),
            atom(&ancestor, &["x", "y"]),
            vec![atom(&edge, &["x", "y"])],
        )
        .with_source("ancestor(X, Y) :- edge(X, Y)."),
        Rule::new(
            rule_id("ancestor-transitive"),
            atom(&ancestor, &["x", "z"]),
            vec![atom(&ancestor, &["x", "y"]), atom(&edge, &["y", "z"])],
        )
        .with_source("ancestor(X, Z) :- ancestor(X, Y), edge(Y, Z)."),
    ])
}

fn rdf_fixture() -> (Program, Dataset, Quad, Quad) {
    let subject = node("subject");
    let source_predicate = node("source-predicate");
    let entailed_predicate = node("entailed-predicate");
    let object = node("object");
    let base_quad = Quad::new(
        subject.clone(),
        source_predicate.clone(),
        object.clone(),
        GraphName::DefaultGraph,
    );
    let entailed_quad = Quad::new(
        subject,
        entailed_predicate.clone(),
        object,
        GraphName::DefaultGraph,
    );
    let program = Program::new(vec![Rule::new(
        rule_id("rdf-predicate-entailment"),
        rdf::quad_atom(
            variable("subject"),
            constant(&entailed_predicate),
            variable("object"),
            variable("graph"),
        ),
        vec![rdf::quad_atom(
            variable("subject"),
            constant(&source_predicate),
            variable("object"),
            variable("graph"),
        )],
    )]);
    (
        program,
        Dataset::from_iter([base_quad.clone()]),
        base_quad,
        entailed_quad,
    )
}

fn assert_rdf_base_unchanged(
    base: &Dataset,
    snapshot: &Dataset,
    base_quad: &Quad,
    entailed_quad: &Quad,
) {
    assert_eq!(base, snapshot);
    assert_eq!(base.len(), 1);
    assert!(base.contains(base_quad));
    assert!(!base.contains(entailed_quad));
}

#[test]
fn rejects_unsafe_head_variables() {
    let edge = relation("edge");
    let unsafe_relation = relation("unsafe");
    let program = Program::new(vec![Rule::new(
        rule_id("unsafe-rule"),
        atom(&unsafe_relation, &["unbound"]),
        vec![atom(&edge, &["bound"])],
    )]);

    let error = validate(&program, &ValidationLimits::default()).unwrap_err();
    assert!(matches!(
        error,
        ValidationError::UnsafeHeadVariable { rule, variable }
            if rule.as_str() == "unsafe-rule" && variable.as_str() == "unbound"
    ));
}

#[test]
fn rejects_inconsistent_relation_arities_in_rules() {
    let edge = relation("edge");
    let output = relation("output");
    let program = Program::new(vec![Rule::new(
        rule_id("arity-rule"),
        atom(&output, &["x"]),
        vec![atom(&edge, &["x"]), atom(&edge, &["x", "y"])],
    )]);

    let error = validate(&program, &ValidationLimits::default()).unwrap_err();
    assert!(matches!(
        error,
        ValidationError::ArityMismatch {
            relation,
            expected: 1,
            actual: 2,
            rule,
        } if relation == edge && rule.as_str() == "arity-rule"
    ));
}

#[test]
fn rejects_input_facts_with_inconsistent_arities() {
    let input = relation("input");
    let error = Engine::default()
        .evaluate(
            &Program::default(),
            [
                Fact::new(input.clone(), vec![value("a")]),
                Fact::new(input.clone(), vec![value("a"), value("b")]),
            ],
            &EvaluationOptions::default(),
        )
        .unwrap_err();

    assert!(matches!(
        error,
        EvaluationError::InputArity {
            relation,
            expected: 1,
            actual: 2,
        } if relation == input
    ));
}

#[test]
fn computes_three_edge_ancestor_closure() {
    let edge = relation("edge");
    let ancestor = relation("ancestor");
    let input = vec![
        fact(&edge, &["a", "b"]),
        fact(&edge, &["b", "c"]),
        fact(&edge, &["c", "d"]),
    ];
    let result = Engine::default()
        .evaluate(
            &ancestor_program(),
            input.clone(),
            &EvaluationOptions::default(),
        )
        .unwrap();
    let mut expected = vec![
        fact(&ancestor, &["a", "b"]),
        fact(&ancestor, &["a", "c"]),
        fact(&ancestor, &["a", "d"]),
        fact(&ancestor, &["b", "c"]),
        fact(&ancestor, &["b", "d"]),
        fact(&ancestor, &["c", "d"]),
    ];
    expected.sort_by_key(Fact::canonical_key);

    assert_eq!(result.derived_facts(), expected);
    assert_eq!(result.facts().len(), input.len() + expected.len());
}

#[test]
fn cyclic_input_reaches_a_finite_fixpoint() {
    let edge = relation("edge");
    let ancestor = relation("ancestor");
    let result = Engine::default()
        .evaluate(
            &ancestor_program(),
            [fact(&edge, &["a", "b"]), fact(&edge, &["b", "a"])],
            &EvaluationOptions::default(),
        )
        .unwrap();
    let mut expected = vec![
        fact(&ancestor, &["a", "a"]),
        fact(&ancestor, &["a", "b"]),
        fact(&ancestor, &["b", "a"]),
        fact(&ancestor, &["b", "b"]),
    ];
    expected.sort_by_key(Fact::canonical_key);

    assert_eq!(result.derived_facts(), expected);
    assert!(result.iterations() <= 4);
}

#[test]
fn result_order_is_deterministic_across_repeated_runs() {
    let edge = relation("edge");
    let original_input = vec![
        fact(&edge, &["c", "d"]),
        fact(&edge, &["a", "b"]),
        fact(&edge, &["b", "c"]),
    ];
    let baseline = Engine::default()
        .evaluate(
            &ancestor_program(),
            original_input.clone(),
            &EvaluationOptions::default(),
        )
        .unwrap();
    let baseline_facts = fact_keys(baseline.facts());
    let baseline_derived = fact_keys(baseline.derived_facts());

    for run in 0..16 {
        let mut input = original_input.clone();
        let input_len = input.len();
        input.rotate_left(run % input_len);
        if run % 2 == 1 {
            input.reverse();
        }
        let mut rules = ancestor_program().rules().to_vec();
        if run % 3 == 0 {
            rules.reverse();
        }
        let result = Engine::default()
            .evaluate(&Program::new(rules), input, &EvaluationOptions::default())
            .unwrap();

        assert_eq!(fact_keys(result.facts()), baseline_facts);
        assert_eq!(fact_keys(result.derived_facts()), baseline_derived);
    }
}

#[test]
fn provenance_records_rule_source_and_sorted_premises() {
    let edge = relation("edge");
    let ancestor = relation("ancestor");
    let options = EvaluationOptions {
        track_provenance: true,
        ..EvaluationOptions::default()
    };
    let result = Engine::default()
        .evaluate(
            &ancestor_program(),
            [
                fact(&edge, &["a", "b"]),
                fact(&edge, &["b", "c"]),
                fact(&edge, &["c", "d"]),
            ],
            &options,
        )
        .unwrap();
    let derived = fact(&ancestor, &["a", "c"]);
    let provenance = result.provenance().unwrap();
    let derivation = provenance.derivation(&derived).unwrap();
    let mut expected_premises = vec![fact(&ancestor, &["a", "b"]), fact(&edge, &["b", "c"])];
    expected_premises.sort_by_key(Fact::canonical_key);

    assert_eq!(provenance.len(), result.derived_facts().len());
    assert_eq!(derivation.rule_id().as_str(), "ancestor-transitive");
    assert_eq!(
        derivation.rule_source(),
        Some("ancestor(X, Z) :- ancestor(X, Y), edge(Y, Z).")
    );
    assert_eq!(derivation.premises(), expected_premises);
}

#[test]
fn fact_limit_fails_without_mutating_the_rdf_base() {
    let (program, base, base_quad, entailed_quad) = rdf_fixture();
    let snapshot = base.clone();
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            max_facts: 1,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };

    let error = rdf::evaluate(&program, &base, &options).unwrap_err();
    assert!(matches!(
        error,
        RdfEvaluationError::Evaluation(EvaluationError::LimitExceeded {
            kind: LimitKind::Facts,
            limit: 1,
        })
    ));
    assert_rdf_base_unchanged(&base, &snapshot, &base_quad, &entailed_quad);
}

#[test]
fn iteration_limit_fails_without_mutating_the_rdf_base() {
    let (program, base, base_quad, entailed_quad) = rdf_fixture();
    let snapshot = base.clone();
    let options = EvaluationOptions {
        limits: EvaluationLimits {
            max_iterations: 0,
            ..EvaluationLimits::default()
        },
        ..EvaluationOptions::default()
    };

    let error = rdf::evaluate(&program, &base, &options).unwrap_err();
    assert!(matches!(
        error,
        RdfEvaluationError::Evaluation(EvaluationError::LimitExceeded {
            kind: LimitKind::Iterations,
            limit: 0,
        })
    ));
    assert_rdf_base_unchanged(&base, &snapshot, &base_quad, &entailed_quad);
}

#[test]
fn cancellation_fails_without_mutating_the_rdf_base() {
    let (program, base, base_quad, entailed_quad) = rdf_fixture();
    let snapshot = base.clone();
    let cancellation_token = CancellationToken::new();
    cancellation_token.cancel();
    let options = EvaluationOptions {
        cancellation_token,
        ..EvaluationOptions::default()
    };

    let error = rdf::evaluate(&program, &base, &options).unwrap_err();
    assert!(matches!(
        error,
        RdfEvaluationError::Evaluation(EvaluationError::Cancelled)
    ));
    assert_rdf_base_unchanged(&base, &snapshot, &base_quad, &entailed_quad);
}

#[test]
fn rdf_default_and_named_graph_quads_roundtrip() {
    let subject = node("subject");
    let predicate = node("predicate");
    let object = node("object");
    let quads = [
        Quad::new(
            subject.clone(),
            predicate.clone(),
            object.clone(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            subject,
            predicate,
            object,
            GraphName::NamedNode(node("graph")),
        ),
    ];

    for quad in quads {
        assert_eq!(
            rdf::quad_from_fact(&rdf::fact_from_quad(quad.clone())).unwrap(),
            quad
        );
    }
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf_12_triple_term_object_survives_the_rdf_adapter_and_closure() {
    let triple_term = Triple::new(
        node("quoted-subject"),
        node("quoted-predicate"),
        node("quoted-object"),
    );
    let quad = Quad::new(
        node("annotation"),
        node("reifies"),
        Term::from(triple_term),
        GraphName::DefaultGraph,
    );
    let roundtripped = rdf::quad_from_fact(&rdf::fact_from_quad(quad.clone())).unwrap();
    assert_eq!(roundtripped, quad);

    let base = Dataset::from_iter([quad.clone()]);
    let closure = rdf::evaluate(&Program::default(), &base, &EvaluationOptions::default()).unwrap();
    assert_eq!(closure.base(), &base);
    assert!(closure.inference().is_empty());
    assert!(closure.entailed().dataset().contains(&quad));
}

#[cfg(feature = "spareval")]
#[test]
fn sparql_queries_the_entailed_dataset() {
    use spareval::{QueryEvaluator, QueryResults};
    use spargebra::SparqlParser;

    let (program, base, _base_quad, entailed_quad) = rdf_fixture();
    let closure = rdf::evaluate(&program, &base, &EvaluationOptions::default()).unwrap();
    assert!(closure.inference().contains(&entailed_quad));
    let receipt = closure.receipt();
    assert_eq!(receipt.profile, rdf::D0_PROFILE);
    assert_eq!(receipt.base_quads, 1);
    assert_eq!(receipt.derived_quads, 1);
    assert!(
        receipt
            .canonical_text()
            .contains(&entailed_quad.to_string())
    );

    let query = SparqlParser::new()
        .parse_query(
            "SELECT ?object WHERE {
                <urn:test:subject> <urn:test:entailed-predicate> ?object
            }",
        )
        .unwrap();
    let results = QueryEvaluator::new()
        .prepare(&query)
        .execute(closure.entailed())
        .unwrap();
    let QueryResults::Solutions(mut solutions) = results else {
        panic!("SELECT query did not return solutions");
    };
    let solution = solutions.next().unwrap().unwrap();

    assert_eq!(solution.get("object"), Some(&Term::from(node("object"))));
    assert!(solutions.next().is_none());
}
