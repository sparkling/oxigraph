#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise SRL BNODE semantics through public APIs"
)]
#![allow(
    clippy::panic,
    reason = "test-only extraction failures report the unexpected RDF term"
)]

use oxrdf::Dataset;
#[cfg(all(feature = "sparql", feature = "rdf-12"))]
use oxrdf::Triple;
#[cfg(feature = "sparql")]
use oxrdf::{BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    GraphSnapshot, ProfileId, ProfileSet, SrlError, SrlRuleSet, ValidationOptions,
    execute_srl_rules,
};
#[cfg(feature = "sparql")]
use oxshacl::{
    LimitKind, SrlConstant, SrlExecution, SrlNode, SrlPredicate, SrlTriple, ValidationError,
    query_srl_rules,
};
#[cfg(feature = "sparql")]
use std::time::Duration;

#[cfg(feature = "sparql")]
const EX: &str = "http://example/";

fn profiles() -> ProfileSet {
    ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap()
}

fn parse(source: &str) -> SrlRuleSet {
    SrlRuleSet::parse(source, None, profiles()).unwrap()
}

#[cfg(feature = "sparql")]
fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{EX}{local}"))
}

#[cfg(feature = "sparql")]
fn execute(source: &str, data: Dataset) -> SrlExecution {
    execute_srl_rules(
        &parse(source),
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap()
}

#[cfg(feature = "sparql")]
fn quad(subject: impl Into<NamedOrBlankNode>, predicate: &str, object: impl Into<Term>) -> Quad {
    Quad::new(subject, iri(predicate), object, GraphName::DefaultGraph)
}

#[cfg(feature = "sparql")]
fn objects(execution: &SrlExecution, subject: &str, predicate: &str) -> Vec<Term> {
    execution
        .inference()
        .dataset()
        .iter()
        .filter(|quad| quad.subject == iri(subject) && quad.predicate == iri(predicate))
        .map(|quad| quad.object)
        .collect()
}

#[cfg(feature = "sparql")]
fn only_object(execution: &SrlExecution, subject: &str, predicate: &str) -> Term {
    let values = objects(execution, subject, predicate);
    assert_eq!(values.len(), 1, "expected one {subject}/{predicate} object");
    values.into_iter().next().unwrap()
}

#[cfg(feature = "sparql")]
fn only_blank_object(execution: &SrlExecution, subject: &str, predicate: &str) -> BlankNode {
    match only_object(execution, subject, predicate) {
        Term::BlankNode(node) => node,
        value => panic!("expected blank object for {subject}/{predicate}, got {value}"),
    }
}

#[cfg(feature = "sparql")]
fn blank_subjects(execution: &SrlExecution, predicate: &str, object: &str) -> Vec<BlankNode> {
    execution
        .inference()
        .dataset()
        .iter()
        .filter(|quad| quad.predicate == iri(predicate) && quad.object == iri(object))
        .map(|quad| match quad.subject {
            NamedOrBlankNode::BlankNode(node) => node,
            NamedOrBlankNode::NamedNode(value) => {
                panic!("expected blank subject for {predicate}/{object}, got {value}")
            }
        })
        .collect()
}

#[cfg(feature = "sparql")]
fn assert_all_distinct(nodes: &[BlankNode]) {
    for (index, left) in nodes.iter().enumerate() {
        for right in &nodes[index + 1..] {
            assert_ne!(left, right, "blank identities unexpectedly alias");
        }
    }
}

#[cfg(feature = "sparql")]
fn assert_isomorphic(actual: &Dataset, expected: &Dataset) {
    assert!(
        actual.is_isomorphic_to(expected).unwrap(),
        "graphs are not isomorphic\nactual:\n{actual}\nexpected:\n{expected}"
    );
}

#[cfg(feature = "sparql")]
fn iri_node(local: &str) -> SrlNode {
    SrlNode::Constant(SrlConstant::Iri(format!("{EX}{local}")))
}

#[cfg(feature = "sparql")]
fn minimum_memory(source: &str, data: &Dataset) -> usize {
    let rules = parse(source);
    let mut low = 0;
    let mut high = ValidationOptions::default()
        .limits
        .max_estimated_memory_bytes;
    while low < high {
        let middle = low + (high - low) / 2;
        let mut options = ValidationOptions::default();
        options.limits.max_estimated_memory_bytes = middle;
        match execute_srl_rules(
            &rules,
            &GraphSnapshot::default_graph(data.clone()),
            &options,
        ) {
            Ok(_) => high = middle,
            Err(SrlError::Validation(ValidationError::LimitExceeded {
                kind: LimitKind::EstimatedMemory,
                ..
            })) => low = middle + 1,
            result => panic!("unexpected memory probe result: {result:?}"),
        }
    }
    low
}

#[cfg(feature = "sparql")]
#[test]
fn zero_argument_calls_are_fresh_within_one_row_and_across_rows() {
    let source = concat!(
        "PREFIX : <http://example/> ",
        "RULE { ?row :first ?first . ?row :second ?second } WHERE { ",
        "  ?row :seed :value ",
        "  SET(?first := BNODE()) ",
        "  SET(?second := BNODE()) ",
        "}"
    );
    let execution = execute(
        source,
        Dataset::from_iter([
            quad(iri("left"), "seed", iri("value")),
            quad(iri("right"), "seed", iri("value")),
        ]),
    );
    let blanks = [
        only_blank_object(&execution, "left", "first"),
        only_blank_object(&execution, "left", "second"),
        only_blank_object(&execution, "right", "first"),
        only_blank_object(&execution, "right", "second"),
    ];
    assert_all_distinct(&blanks);

    let expected = Dataset::from_iter([
        quad(iri("left"), "first", BlankNode::new_unchecked("left-first")),
        quad(
            iri("left"),
            "second",
            BlankNode::new_unchecked("left-second"),
        ),
        quad(
            iri("right"),
            "first",
            BlankNode::new_unchecked("right-first"),
        ),
        quad(
            iri("right"),
            "second",
            BlankNode::new_unchecked("right-second"),
        ),
    ]);
    assert_isomorphic(execution.inference().dataset(), &expected);
}

#[cfg(feature = "sparql")]
#[test]
fn zero_argument_calls_are_fresh_inside_one_expression() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :result :fresh :yes } WHERE { ",
            "  FILTER(!sameTerm(BNODE(), BNODE())) ",
            "}"
        ),
        Dataset::new(),
    );
    assert_isomorphic(
        execution.inference().dataset(),
        &Dataset::from_iter([quad(iri("result"), "fresh", iri("yes"))]),
    );
}

#[cfg(feature = "sparql")]
#[test]
fn string_calls_share_only_within_one_mapping_and_accept_arbitrary_strings() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { ",
            "  :result :empty ?empty . ",
            "  :result :spaces ?spaces . ",
            "  :result :unicode ?unicode . ",
            "  :result :nested ?nested ",
            "} WHERE { ",
            "  SET(?empty := BNODE(\"\")) ",
            "  SET(?spaces := BNODE(\"two words\")) ",
            "  SET(?unicode := BNODE(\"snow 雪\")) ",
            "  SET(?nested := BNODE(CONCAT(\"snow\", \" 雪\"))) ",
            "}"
        ),
        Dataset::new(),
    );
    let empty = only_blank_object(&execution, "result", "empty");
    let spaces = only_blank_object(&execution, "result", "spaces");
    let unicode = only_blank_object(&execution, "result", "unicode");
    let nested = only_blank_object(&execution, "result", "nested");
    assert_eq!(unicode, nested, "equal nested string calls must share");
    assert_all_distinct(&[empty.clone(), spaces.clone(), unicode.clone()]);

    let expected = Dataset::from_iter([
        quad(iri("result"), "empty", BlankNode::new_unchecked("empty")),
        quad(iri("result"), "spaces", BlankNode::new_unchecked("spaces")),
        quad(
            iri("result"),
            "unicode",
            BlankNode::new_unchecked("unicode"),
        ),
        quad(iri("result"), "nested", BlankNode::new_unchecked("unicode")),
    ]);
    assert_isomorphic(execution.inference().dataset(), &expected);
}

#[cfg(feature = "sparql")]
#[test]
fn equal_string_calls_are_distinct_for_different_rows_and_path_occurrences() {
    let ordinary = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { ?row :node ?node } WHERE { ",
            "  ?row :seed :value SET(?node := BNODE(\"same\")) ",
            "}"
        ),
        Dataset::from_iter([
            quad(iri("left"), "seed", iri("value")),
            quad(iri("right"), "seed", iri("value")),
        ]),
    );
    let left = only_blank_object(&ordinary, "left", "node");
    let right = only_blank_object(&ordinary, "right", "node");
    assert_ne!(left, right, "equal strings leaked across solution rows");
    let expected = Dataset::from_iter([
        quad(iri("left"), "node", BlankNode::new_unchecked("left")),
        quad(iri("right"), "node", BlankNode::new_unchecked("right")),
    ]);
    assert_isomorphic(ordinary.inference().dataset(), &expected);

    let duplicated = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { ?node :owner :end } WHERE { ",
            "  :start :left/:right :end SET(?node := BNODE(\"same\")) ",
            "}"
        ),
        Dataset::from_iter([
            quad(iri("start"), "left", iri("middle1")),
            quad(iri("start"), "left", iri("middle2")),
            quad(iri("middle1"), "right", iri("end")),
            quad(iri("middle2"), "right", iri("end")),
        ]),
    );
    let path_nodes = blank_subjects(&duplicated, "owner", "end");
    assert_eq!(
        path_nodes.len(),
        2,
        "distinct path occurrences were collapsed"
    );
    assert_ne!(
        path_nodes[0], path_nodes[1],
        "distinct path occurrences with distinct private bindings shared an identity"
    );
    let expected = Dataset::from_iter([
        quad(BlankNode::new_unchecked("path-one"), "owner", iri("end")),
        quad(BlankNode::new_unchecked("path-two"), "owner", iri("end")),
    ]);
    assert_isomorphic(duplicated.inference().dataset(), &expected);
}

#[cfg(feature = "sparql")]
#[test]
fn filter_and_set_keep_identity_but_successful_pattern_joins_fork_it() {
    let retained = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :result :first ?first . :result :second ?second } WHERE { ",
            "  SET(?first := BNODE(\"same\")) ",
            "  FILTER(sameTerm(?first, BNODE(\"same\"))) ",
            "  SET(?second := BNODE(\"same\")) ",
            "}"
        ),
        Dataset::new(),
    );
    let first = only_blank_object(&retained, "result", "first");
    let second = only_blank_object(&retained, "result", "second");
    assert_eq!(first, second, "FILTER or SET changed solution identity");
    let expected = BlankNode::new_unchecked("retained");
    assert_isomorphic(
        retained.inference().dataset(),
        &Dataset::from_iter([
            quad(iri("result"), "first", expected.clone()),
            quad(iri("result"), "second", expected),
        ]),
    );

    let forked = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :result :before ?before . :result :after ?after } WHERE { ",
            "  SET(?before := BNODE(\"same\")) ",
            "  :seed :edge :value ",
            "  SET(?after := BNODE(\"same\")) ",
            "}"
        ),
        Dataset::from_iter([quad(iri("seed"), "edge", iri("value"))]),
    );
    let before = only_blank_object(&forked, "result", "before");
    let after = only_blank_object(&forked, "result", "after");
    assert_ne!(
        before, after,
        "successful join did not fork solution identity"
    );
    assert_isomorphic(
        forked.inference().dataset(),
        &Dataset::from_iter([
            quad(iri("result"), "before", BlankNode::new_unchecked("before")),
            quad(iri("result"), "after", BlankNode::new_unchecked("after")),
        ]),
    );
}

#[cfg(feature = "sparql")]
#[test]
fn nested_negation_uses_branch_identity_without_mutating_the_outer_mapping() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :result :outer ?outer . :result :after ?after } WHERE { ",
            "  SET(?outer := BNODE(\"same\")) ",
            "  NOT { ",
            "    :branch :p :value ",
            "    FILTER(sameTerm(BNODE(\"same\"), ?outer)) ",
            "  } ",
            "  SET(?after := BNODE(\"same\")) ",
            "}"
        ),
        Dataset::from_iter([quad(iri("branch"), "p", iri("value"))]),
    );
    let outer = only_blank_object(&execution, "result", "outer");
    let after = only_blank_object(&execution, "result", "after");
    assert_eq!(
        outer, after,
        "nested branch identity escaped into the outer solution"
    );
    let expected = BlankNode::new_unchecked("outer");
    assert_isomorphic(
        execution.inference().dataset(),
        &Dataset::from_iter([
            quad(iri("result"), "outer", expected.clone()),
            quad(iri("result"), "after", expected),
        ]),
    );
}

#[cfg(feature = "sparql")]
#[test]
fn separate_rule_applications_and_independent_executions_have_fresh_scopes() {
    let source = concat!(
        "PREFIX : <http://example/> ",
        "RULE { :result :first ?node } WHERE { SET(?node := BNODE(\"same\")) } ",
        "RULE { :result :second ?node } WHERE { SET(?node := BNODE(\"same\")) }"
    );
    let execution = execute(source, Dataset::new());
    let first = only_blank_object(&execution, "result", "first");
    let second = only_blank_object(&execution, "result", "second");
    assert_ne!(
        first, second,
        "rule-body invocations shared a registry scope"
    );
    assert_isomorphic(
        execution.inference().dataset(),
        &Dataset::from_iter([
            quad(iri("result"), "first", BlankNode::new_unchecked("first")),
            quad(iri("result"), "second", BlankNode::new_unchecked("second")),
        ]),
    );

    let one = execute(
        "PREFIX : <http://example/> RULE { :result :node ?node } WHERE { SET(?node := BNODE(\"same\")) }",
        Dataset::new(),
    );
    let two = execute(
        "PREFIX : <http://example/> RULE { :result :node ?node } WHERE { SET(?node := BNODE(\"same\")) }",
        Dataset::new(),
    );
    let one_node = only_blank_object(&one, "result", "node");
    let two_node = only_blank_object(&two, "result", "node");
    assert_ne!(
        one_node, two_node,
        "independent executions reused one RDF blank identity"
    );
    let expected = Dataset::from_iter([quad(
        iri("result"),
        "node",
        BlankNode::new_unchecked("node"),
    )]);
    assert_isomorphic(one.inference().dataset(), &expected);
    assert_isomorphic(two.inference().dataset(), &expected);
}

#[cfg(feature = "sparql")]
#[test]
fn invalid_arguments_drop_only_their_rows_in_set_and_filter() {
    let value = iri("value");
    let data = Dataset::from_iter([
        Quad::new(
            iri("numeric"),
            value.clone(),
            Literal::from(7),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            iri("iri"),
            value.clone(),
            iri("resource"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            iri("language"),
            value.clone(),
            Literal::new_language_tagged_literal("text", "en").unwrap(),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            iri("string"),
            value,
            Literal::new_typed_literal(
                "text",
                NamedNode::new_unchecked("http://www.w3.org/2001/XMLSchema#string"),
            ),
            GraphName::DefaultGraph,
        ),
    ]);
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { ?row :set ?node } WHERE { ",
            "  ?row :value ?value SET(?node := BNODE(?value)) ",
            "} ",
            "RULE { ?row :filter :accepted } WHERE { ",
            "  ?row :value ?value FILTER(isBLANK(BNODE(?value))) ",
            "}"
        ),
        data,
    );
    let string_node = only_blank_object(&execution, "string", "set");
    assert_eq!(
        only_object(&execution, "string", "filter"),
        Term::NamedNode(iri("accepted"))
    );
    for subject in ["numeric", "iri", "language"] {
        assert!(objects(&execution, subject, "set").is_empty());
        assert!(objects(&execution, subject, "filter").is_empty());
    }
    assert_isomorphic(
        execution.inference().dataset(),
        &Dataset::from_iter([
            quad(iri("string"), "set", string_node),
            quad(iri("string"), "filter", iri("accepted")),
        ]),
    );
}

#[cfg(feature = "sparql")]
#[test]
fn conditional_and_boolean_forms_are_lazy() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { ",
            "  :result :first ?first . ",
            "  :result :second ?second . ",
            "  :result :boolean :accepted ",
            "} WHERE { ",
            "  SET(?first := IF(true, BNODE(\"selected\"), BNODE(1))) ",
            "  SET(?second := IF(false, BNODE(), BNODE(\"selected\"))) ",
            "  FILTER(true || isBLANK(BNODE(1))) ",
            "  FILTER(!(false && isBLANK(BNODE(1)))) ",
            "}"
        ),
        Dataset::new(),
    );
    let first = only_blank_object(&execution, "result", "first");
    let second = only_blank_object(&execution, "result", "second");
    assert_eq!(first, second);
    assert_eq!(
        only_object(&execution, "result", "boolean"),
        Term::NamedNode(iri("accepted"))
    );
    let expected = BlankNode::new_unchecked("selected");
    assert_isomorphic(
        execution.inference().dataset(),
        &Dataset::from_iter([
            quad(iri("result"), "first", expected.clone()),
            quad(iri("result"), "second", expected),
            quad(iri("result"), "boolean", iri("accepted")),
        ]),
    );
}

#[cfg(feature = "sparql")]
#[test]
fn blank_terms_survive_filter_set_body_head_and_fixpoint_transport() {
    let source = concat!(
        "PREFIX : <http://example/> ",
        "RULE { ",
        "  ?node :kind :generated . ",
        "  :row :first ?node . ",
        "  :row :copy ?copy ",
        "} WHERE { ",
        "  :row :seed :value ",
        "  SET(?node := BNODE(\"transport\")) ",
        "  FILTER(isBLANK(?node) && sameTerm(?node, BNODE(\"transport\"))) ",
        "  SET(?copy := ?node) ",
        "  FILTER(sameTerm(?copy, ?node)) ",
        "} ",
        "RULE { ?copy :usedBy :consumer } WHERE { ",
        "  ?node :kind :generated ",
        "  FILTER(isBLANK(?node)) ",
        "  SET(?copy := ?node) ",
        "}"
    );
    let rules = parse(source);
    let stratification = rules.stratification().unwrap();
    assert!(
        stratification
            .strata
            .iter()
            .flat_map(|stratum| &stratum.once)
            .any(|&index| index == 0),
        "assignment rule stopped being run once"
    );
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(Dataset::from_iter([quad(iri("row"), "seed", iri("value"))])),
        &ValidationOptions::default(),
    )
    .unwrap();
    let node = only_blank_object(&execution, "row", "first");
    let copy = only_blank_object(&execution, "row", "copy");
    assert_eq!(node, copy);
    let subjects = blank_subjects(&execution, "kind", "generated");
    let consumers = blank_subjects(&execution, "usedBy", "consumer");
    assert_eq!(subjects.as_slice(), std::slice::from_ref(&node));
    assert_eq!(consumers.as_slice(), std::slice::from_ref(&node));

    let expected_node = BlankNode::new_unchecked("transported");
    let expected = Dataset::from_iter([
        quad(expected_node.clone(), "kind", iri("generated")),
        quad(iri("row"), "first", expected_node.clone()),
        quad(iri("row"), "copy", expected_node.clone()),
        quad(expected_node, "usedBy", iri("consumer")),
    ]);
    assert_isomorphic(execution.inference().dataset(), &expected);
    assert!(execution.iterations() > 0);
}

#[cfg(all(feature = "sparql", feature = "rdf-12"))]
#[test]
fn prepared_bindings_preserve_nested_triple_and_blank_identity() {
    let nested = BlankNode::new_unchecked("nested-only");
    let inner = Term::Triple(Box::new(Triple::new(
        nested,
        iri("innerPredicate"),
        iri("innerObject"),
    )));
    let statement = Term::Triple(Box::new(Triple::new(
        iri("outerSubject"),
        iri("contains"),
        inner,
    )));
    let data = Dataset::from_iter([quad(iri("row"), "statement", statement.clone())]);
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :row :copied ?copy } WHERE { ",
            "  :row :statement ?statement ",
            "  FILTER(isTRIPLE(?statement)) ",
            "  SET(?copy := ?statement) ",
            "  FILTER(sameTerm(?copy, ?statement)) ",
            "} ",
            "RULE { :consumer :observed ?transported } WHERE { ",
            "  :row :copied ?transported ",
            "  FILTER(isTRIPLE(?transported)) ",
            "}"
        ),
        data.clone(),
    );
    assert_eq!(only_object(&execution, "row", "copied"), statement.clone());
    assert_eq!(
        only_object(&execution, "consumer", "observed"),
        statement.clone()
    );
    assert_isomorphic(
        execution.inference().dataset(),
        &Dataset::from_iter([
            quad(iri("row"), "copied", statement.clone()),
            quad(iri("consumer"), "observed", statement),
        ]),
    );
    assert!(execution.iterations() > 0);

    let goal = SrlTriple {
        subject: iri_node("consumer"),
        predicate: SrlPredicate::Node(iri_node("observed")),
        object: SrlNode::TripleTerm(Box::new(SrlTriple {
            subject: iri_node("outerSubject"),
            predicate: SrlPredicate::Node(iri_node("contains")),
            object: SrlNode::TripleTerm(Box::new(SrlTriple {
                subject: SrlNode::Constant(SrlConstant::BlankNode("nested-only".to_owned())),
                predicate: SrlPredicate::Node(iri_node("innerPredicate")),
                object: iri_node("innerObject"),
            })),
        })),
    };
    assert!(
        query_srl_rules(
            &parse(concat!(
                "PREFIX : <http://example/> ",
                "RULE { :row :copied ?copy } WHERE { ",
                "  :row :statement ?statement ",
                "  FILTER(isTRIPLE(?statement)) ",
                "  SET(?copy := ?statement) ",
                "  FILTER(sameTerm(?copy, ?statement)) ",
                "} ",
                "RULE { :consumer :observed ?transported } WHERE { ",
                "  :row :copied ?transported ",
                "  FILTER(isTRIPLE(?transported)) ",
                "}"
            )),
            &GraphSnapshot::default_graph(data),
            &goal,
            &ValidationOptions::default(),
        )
        .unwrap()
    );
}

#[cfg(feature = "sparql")]
#[test]
fn generated_blanks_remain_distinct_from_base_inline_head_and_raw_labels() {
    let raw = BlankNode::new_unchecked("same");
    let base = Dataset::from_iter([
        quad(raw.clone(), "base", iri("ordinary")),
        quad(iri("seed"), "go", iri("yes")),
    ]);
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "DATA { _:same :inline :object } ",
            "RULE { ",
            "  :result :bnode ?node . ",
            "  :result :head [ :kind :head ] ",
            "} WHERE { ",
            "  :seed :go :yes SET(?node := BNODE(\"same\")) ",
            "}"
        ),
        base.clone(),
    );
    assert_eq!(execution.base().dataset(), &base, "base graph was mutated");
    let generated = only_blank_object(&execution, "result", "bnode");
    let head = only_blank_object(&execution, "result", "head");
    let inline = blank_subjects(&execution, "inline", "object");
    assert_eq!(inline.len(), 1);
    assert_ne!(generated, raw, "BNODE(string) reused the raw source label");
    assert_all_distinct(&[generated.clone(), head.clone(), inline[0].clone()]);

    let expected_inline = BlankNode::new_unchecked("expected-inline");
    let expected_generated = BlankNode::new_unchecked("expected-bnode");
    let expected_head = BlankNode::new_unchecked("expected-head");
    let expected_inference = Dataset::from_iter([
        quad(expected_inline, "inline", iri("object")),
        quad(iri("result"), "bnode", expected_generated),
        quad(iri("result"), "head", expected_head.clone()),
        quad(expected_head, "kind", iri("head")),
    ]);
    assert_isomorphic(execution.inference().dataset(), &expected_inference);
    let mut expected_entailed = base.clone();
    expected_entailed.extend(expected_inference.iter());
    assert_isomorphic(execution.entailed().dataset(), &expected_entailed);
}

#[cfg(all(feature = "sparql", feature = "rdf-12"))]
#[test]
fn nested_triple_term_blanks_remain_distinct_from_generated_blanks() {
    let base_nested = BlankNode::new_unchecked("oxshacl-srl-node-0");
    let base_statement = Term::Triple(Box::new(Triple::new(
        base_nested.clone(),
        iri("predicate"),
        iri("object"),
    )));
    let base = Dataset::from_iter([
        quad(iri("holder"), "statement", base_statement),
        quad(iri("seed"), "go", iri("yes")),
    ]);
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "DATA { ",
            "  :inlineHolder :statement ",
            "    <<( _:oxshacl-srl-node-1 :predicate :object )>> ",
            "} ",
            "RULE { ",
            "  :result :bnode ?node . ",
            "  :result :head [ :kind :head ] ",
            "} WHERE { :seed :go :yes SET(?node := BNODE(\"nested\")) }"
        ),
        base.clone(),
    );
    let generated = only_blank_object(&execution, "result", "bnode");
    let head = only_blank_object(&execution, "result", "head");
    let inline_nested = execution
        .inference()
        .dataset()
        .iter()
        .find(|quad| quad.subject == iri("inlineHolder") && quad.predicate == iri("statement"))
        .map(|quad| match quad.object {
            Term::Triple(triple) => match triple.subject {
                NamedOrBlankNode::BlankNode(node) => node,
                NamedOrBlankNode::NamedNode(value) => {
                    panic!("expected inline nested blank subject, got {value}")
                }
            },
            value => panic!("expected inline triple term, got {value}"),
        })
        .unwrap();
    for node in [&generated, &head, &inline_nested] {
        assert_ne!(
            node, &base_nested,
            "generated blank aliased a blank nested in the base triple term"
        );
    }
    assert_all_distinct(&[generated.clone(), head.clone(), inline_nested.clone()]);
    assert_eq!(execution.base().dataset(), &base);
    let expected_inline_nested = BlankNode::new_unchecked("expected-inline-nested");
    let expected_generated = BlankNode::new_unchecked("expected-bnode");
    let expected_head = BlankNode::new_unchecked("expected-head");
    let expected_inference = Dataset::from_iter([
        quad(
            iri("inlineHolder"),
            "statement",
            Term::Triple(Box::new(Triple::new(
                expected_inline_nested,
                iri("predicate"),
                iri("object"),
            ))),
        ),
        quad(iri("result"), "bnode", expected_generated),
        quad(iri("result"), "head", expected_head.clone()),
        quad(expected_head, "kind", iri("head")),
    ]);
    assert_isomorphic(execution.inference().dataset(), &expected_inference);
    let mut expected_entailed = base.clone();
    expected_entailed.extend(expected_inference.iter());
    assert_isomorphic(execution.entailed().dataset(), &expected_entailed);
}

#[cfg(feature = "sparql")]
#[test]
fn query_observes_rules_that_materialize_bnode_terms() {
    let rules = parse(
        "PREFIX : <http://example/> RULE { :result :generated ?node } WHERE { SET(?node := BNODE()) }",
    );
    let goal = SrlTriple {
        subject: iri_node("result"),
        predicate: SrlPredicate::Node(iri_node("generated")),
        object: SrlNode::Variable("node".to_owned()),
    };
    assert!(
        query_srl_rules(
            &rules,
            &GraphSnapshot::default_graph(Dataset::new()),
            &goal,
            &ValidationOptions::default(),
        )
        .unwrap()
    );
}

#[cfg(feature = "sparql")]
#[test]
fn now_scope_and_fixpoint_consumers_remain_stable() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { ?row :at ?now } WHERE { ",
            "  ?row :seed :value SET(?now := NOW()) ",
            "} ",
            "RULE { :summary :saw ?row } WHERE { ?row :at ?now }"
        ),
        Dataset::from_iter([
            quad(iri("left"), "seed", iri("value")),
            quad(iri("right"), "seed", iri("value")),
        ]),
    );
    let left = only_object(&execution, "left", "at");
    let right = only_object(&execution, "right", "at");
    assert_eq!(left, right, "NOW changed inside one execution");
    assert!(matches!(&left, Term::Literal(_)));
    let seen = objects(&execution, "summary", "saw");
    assert_eq!(seen.len(), 2);
    assert!(seen.contains(&Term::NamedNode(iri("left"))));
    assert!(seen.contains(&Term::NamedNode(iri("right"))));
    assert_isomorphic(
        execution.inference().dataset(),
        &Dataset::from_iter([
            quad(iri("left"), "at", left.clone()),
            quad(iri("right"), "at", left),
            quad(iri("summary"), "saw", iri("left")),
            quad(iri("summary"), "saw", iri("right")),
        ]),
    );
}

#[cfg(feature = "sparql")]
#[test]
fn cancellation_time_memory_solution_and_derived_limits_fail_the_operation() {
    let source = concat!(
        "PREFIX : <http://example/> ",
        "RULE { ?row :first ?node . ?row :second :value } WHERE { ",
        "  ?row :seed :value SET(?node := BNODE()) ",
        "}"
    );
    let rules = parse(source);
    let data = Dataset::from_iter([
        quad(iri("left"), "seed", iri("value")),
        quad(iri("right"), "seed", iri("value")),
    ]);
    let graph = GraphSnapshot::default_graph(data.clone());

    let cancelled = ValidationOptions::default();
    cancelled.cancellation_token.cancel();
    assert!(matches!(
        execute_srl_rules(&rules, &graph, &cancelled),
        Err(SrlError::Validation(ValidationError::Cancelled))
    ));

    let mut expired = ValidationOptions::default();
    expired.limits.timeout = Some(Duration::ZERO);
    assert!(matches!(
        execute_srl_rules(&rules, &graph, &expired),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::Time,
            limit: 0,
        }))
    ));

    let mut solutions = ValidationOptions::default();
    solutions.limits.max_query_solutions = 1;
    assert!(matches!(
        execute_srl_rules(&rules, &graph, &solutions),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::QuerySolutions,
            limit: 1,
        }))
    ));

    let mut derived = ValidationOptions::default();
    derived.limits.max_derived_triples = 1;
    assert!(matches!(
        execute_srl_rules(&rules, &graph, &derived),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::DerivedTriples,
            limit: 1,
        }))
    ));

    let memory_source =
        "PREFIX : <http://example/> RULE { :result :node ?node } WHERE { SET(?node := BNODE()) }";
    let required = minimum_memory(memory_source, &Dataset::new());
    assert!(required > 0);
    let mut memory = ValidationOptions::default();
    memory.limits.max_estimated_memory_bytes = required - 1;
    assert!(matches!(
        execute_srl_rules(
            &parse(memory_source),
            &GraphSnapshot::default_graph(Dataset::new()),
            &memory,
        ),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::EstimatedMemory,
            limit,
        })) if limit == required - 1
    ));
}

#[cfg(feature = "sparql")]
#[test]
fn unselected_bnode_branch_does_not_consume_an_extra_allocation_budget() {
    let lazy = concat!(
        "PREFIX : <http://example/> ",
        "RULE { :result :node ?node } WHERE { ",
        "  SET(?selected := BNODE(\"selected\")) ",
        "  SET(?node := IF(1 = 1, ?selected, BNODE())) ",
        "}"
    );
    let eager = concat!(
        "PREFIX : <http://example/> ",
        "RULE { :result :node ?node } WHERE { ",
        "  SET(?selected := BNODE(\"selected\")) ",
        "  SET(?node := IF(1 = 0, ?selected, BNODE())) ",
        "}"
    );
    assert_eq!(
        lazy.len(),
        eager.len(),
        "laziness probes must have equal query-source memory cost"
    );
    let lazy_required = minimum_memory(lazy, &Dataset::new());
    let eager_required = minimum_memory(eager, &Dataset::new());
    assert!(
        eager_required > lazy_required,
        "a second selected allocation did not increase bounded memory"
    );

    let mut options = ValidationOptions::default();
    options.limits.max_estimated_memory_bytes = lazy_required;
    execute_srl_rules(
        &parse(lazy),
        &GraphSnapshot::default_graph(Dataset::new()),
        &options,
    )
    .unwrap();
    assert!(matches!(
        execute_srl_rules(
            &parse(eager),
            &GraphSnapshot::default_graph(Dataset::new()),
            &options,
        ),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::EstimatedMemory,
            limit,
        })) if limit == lazy_required
    ));
}

#[cfg(not(feature = "sparql"))]
#[test]
fn bnode_execution_fails_explicitly_without_sparql() {
    let rules = parse(
        "PREFIX : <http://example/> RULE { :result :node ?node } WHERE { SET(?node := BNODE()) }",
    );
    assert!(matches!(
        execute_srl_rules(
            &rules,
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default(),
        ),
        Err(SrlError::Unsupported(reason)) if reason.contains("`sparql` crate feature")
    ));
}
