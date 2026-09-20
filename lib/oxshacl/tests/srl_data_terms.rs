#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise public SRL ground DATA materialization"
)]

#[cfg(feature = "rdf-12")]
use oxrdf::Triple;
use oxrdf::{BlankNode, Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
#[cfg(feature = "rdf-12")]
use oxshacl::{
    SrlConstant, SrlNode, SrlPredicate, SrlTriple, execute_srl_rules_with_imports, query_srl_rules,
};
use oxshacl::{
    GraphSnapshot, LimitKind, ProfileId, ProfileSet, SrlError, SrlRuleSet, ValidationError,
    ValidationOptions, execute_srl_rules,
};

const EX: &str = "http://example/";
const RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

fn profiles() -> ProfileSet {
    ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap()
}

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{EX}{local}"))
}

fn rdf(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{RDF}{local}"))
}

fn blank(label: &str) -> BlankNode {
    BlankNode::new_unchecked(label.to_owned())
}

fn quad(
    subject: impl Into<NamedOrBlankNode>,
    predicate: NamedNode,
    object: impl Into<Term>,
) -> Quad {
    Quad::new(subject, predicate, object, GraphName::DefaultGraph)
}

fn parse(source: &str) -> SrlRuleSet {
    SrlRuleSet::parse(source, None, profiles()).unwrap()
}

fn execute(source: &str, base: Dataset) -> oxshacl::SrlExecution {
    execute_with_options(source, base, &ValidationOptions::default()).unwrap()
}

fn execute_with_options(
    source: &str,
    base: Dataset,
    options: &ValidationOptions,
) -> Result<oxshacl::SrlExecution, SrlError> {
    execute_srl_rules(&parse(source), &GraphSnapshot::default_graph(base), options)
}

fn assert_isomorphic(actual: &Dataset, expected: &Dataset) {
    assert!(
        actual.is_isomorphic_to(expected).unwrap(),
        "actual graph: {actual:?}\nexpected graph: {expected:?}"
    );
}

#[cfg(feature = "rdf-12")]
fn marker(subject: &str) -> Quad {
    quad(iri(subject), iri("matched"), iri("yes"))
}

#[cfg(feature = "rdf-12")]
fn triple(
    subject: impl Into<NamedOrBlankNode>,
    predicate: NamedNode,
    object: impl Into<Term>,
) -> Term {
    Term::Triple(Box::new(Triple::new(subject, predicate, object)))
}

#[cfg(feature = "rdf-12")]
#[test]
fn object_triple_terms_are_recursive_share_blanks_and_do_not_assert_inner_triples() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "DATA { ",
            "  :holder :statement <<( :s :p _:shared )>> . ",
            "  _:shared :label :outside . ",
            "  :nested :statement <<( :outer :contains <<( :s :p _:shared )>> )>> ",
            "}"
        ),
        Dataset::new(),
    );
    let shared = blank("shared");
    let inner = triple(iri("s"), iri("p"), shared.clone());
    let expected = Dataset::from_iter([
        quad(iri("holder"), iri("statement"), inner.clone()),
        quad(shared, iri("label"), iri("outside")),
        quad(
            iri("nested"),
            iri("statement"),
            triple(iri("outer"), iri("contains"), inner),
        ),
    ]);

    assert_isomorphic(execution.base().dataset(), &Dataset::new());
    assert_isomorphic(execution.inference().dataset(), &expected);
    assert_isomorphic(execution.entailed().dataset(), &expected);
    assert!(
        !execution
            .inference()
            .dataset()
            .contains(&quad(iri("s"), iri("p"), blank("shared"),))
    );
}

#[test]
fn collections_property_lists_and_standalone_constructors_have_complete_graphs() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
            "DATA { ",
            "  :owner :items ( :a [ :q :b ] ) . ",
            "  :empty :items () . ",
            "  ( :subject ) :role :listSubject . ",
            "  [ :standalone :property ] . ",
            "  ( :standaloneItem ) ",
            "}"
        ),
        Dataset::new(),
    );

    let list_head = blank("list-head");
    let list_tail = blank("list-tail");
    let property = blank("property");
    let subject_list = blank("subject-list");
    let standalone_list = blank("standalone-list");
    let expected = Dataset::from_iter([
        quad(iri("owner"), iri("items"), list_head.clone()),
        quad(list_head.clone(), rdf("first"), iri("a")),
        quad(list_head, rdf("rest"), list_tail.clone()),
        quad(list_tail.clone(), rdf("first"), property.clone()),
        quad(list_tail, rdf("rest"), rdf("nil")),
        quad(property, iri("q"), iri("b")),
        quad(iri("empty"), iri("items"), rdf("nil")),
        quad(subject_list.clone(), rdf("first"), iri("subject")),
        quad(subject_list.clone(), rdf("rest"), rdf("nil")),
        quad(subject_list, iri("role"), iri("listSubject")),
        quad(
            blank("standalone-property"),
            iri("standalone"),
            iri("property"),
        ),
        quad(standalone_list.clone(), rdf("first"), iri("standaloneItem")),
        quad(standalone_list, rdf("rest"), rdf("nil")),
    ]);
    assert_isomorphic(execution.inference().dataset(), &expected);
}

#[cfg(feature = "rdf-12")]
#[test]
fn reifiers_annotations_and_standalone_reification_preserve_assertion_distinction() {
    let execution = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
            "DATA { ",
            "  :asserted :p :o ~ _:shared {| :source :annotation |} . ",
            "  << :unasserted :p :o ~ _:shared >> :source :standalone . ",
            "  << :implicit :p :o >> . ",
            "  << :repeated :p :o ~ _:again >> :first :one . ",
            "  << :repeated :p :o ~ _:again >> :second :two ",
            "}"
        ),
        Dataset::new(),
    );
    let shared = blank("shared");
    let implicit = blank("implicit-reifier");
    let again = blank("again");
    let expected = Dataset::from_iter([
        quad(iri("asserted"), iri("p"), iri("o")),
        quad(
            shared.clone(),
            rdf("reifies"),
            triple(iri("asserted"), iri("p"), iri("o")),
        ),
        quad(shared.clone(), iri("source"), iri("annotation")),
        quad(
            shared.clone(),
            rdf("reifies"),
            triple(iri("unasserted"), iri("p"), iri("o")),
        ),
        quad(shared, iri("source"), iri("standalone")),
        quad(
            implicit,
            rdf("reifies"),
            triple(iri("implicit"), iri("p"), iri("o")),
        ),
        quad(
            again.clone(),
            rdf("reifies"),
            triple(iri("repeated"), iri("p"), iri("o")),
        ),
        quad(again.clone(), iri("first"), iri("one")),
        quad(again, iri("second"), iri("two")),
    ]);
    assert_isomorphic(execution.inference().dataset(), &expected);
    assert!(!execution.inference().dataset().contains(&quad(
        iri("unasserted"),
        iri("p"),
        iri("o"),
    )));
    assert!(
        !execution
            .inference()
            .dataset()
            .contains(&quad(iri("implicit"), iri("p"), iri("o"),))
    );
}

#[cfg(feature = "rdf-12")]
#[test]
#[expect(
    clippy::panic,
    reason = "the graph-shape oracle rejects unexpected RDF term variants"
)]
fn data_labels_share_locally_imports_are_apart_and_nested_collisions_avoid_base() {
    let root = parse(concat!(
        "PREFIX : <http://example/> IMPORTS <urn:a> IMPORTS <urn:b> ",
        "DATA { _:same :root :one . :holder :statement <<( :s :p _:same )>> } ",
        "RULE { :derived :node [ :head :generated ] } WHERE { ?node :root :one }"
    ));
    let resolver = |iri: &str, _profiles: &ProfileSet| match iri {
        "urn:a" => Ok(parse(concat!(
            "PREFIX : <http://example/> ",
            "DATA { _:same :scope :a } DATA { _:same :again :a }"
        ))),
        "urn:b" => Ok(parse(
            "PREFIX : <http://example/> DATA { _:same :scope :b }",
        )),
        _ => Err(SrlError::Unsupported(format!("unexpected import `{iri}`"))),
    };
    let base_allocator_collision = blank("oxshacl-srl-node-0");
    let nested_base_blank = blank("oxshacl-srl-node-1");
    let base = Dataset::from_iter([
        quad(
            base_allocator_collision.clone(),
            iri("base"),
            iri("immutable"),
        ),
        quad(
            iri("baseHolder"),
            iri("statement"),
            triple(
                iri("baseSubject"),
                iri("basePredicate"),
                nested_base_blank.clone(),
            ),
        ),
    ]);
    let base_before = base.clone();
    let execution = execute_srl_rules_with_imports(
        &root,
        &GraphSnapshot::default_graph(base.clone()),
        &ValidationOptions::default(),
        &resolver,
    )
    .unwrap();

    let expected_root = blank("expected-root");
    let expected_a = blank("expected-a");
    let expected_b = blank("expected-b");
    let expected_head = blank("expected-head");
    let expected_inference = Dataset::from_iter([
        quad(expected_root.clone(), iri("root"), iri("one")),
        quad(
            iri("holder"),
            iri("statement"),
            triple(iri("s"), iri("p"), expected_root.clone()),
        ),
        quad(expected_a.clone(), iri("scope"), iri("a")),
        quad(expected_a, iri("again"), iri("a")),
        quad(expected_b, iri("scope"), iri("b")),
        quad(iri("derived"), iri("node"), expected_head.clone()),
        quad(expected_head, iri("head"), iri("generated")),
    ]);
    let mut expected_entailed = base.clone();
    expected_entailed.extend(expected_inference.iter());

    assert_eq!(base, base_before);
    assert_eq!(execution.base().dataset(), &base_before);
    assert_isomorphic(execution.inference().dataset(), &expected_inference);
    assert_isomorphic(execution.entailed().dataset(), &expected_entailed);
    let graph = execution.inference().dataset();
    let a = graph
        .iter()
        .find(|quad| quad.predicate == iri("scope") && quad.object == iri("a"))
        .unwrap()
        .subject;
    let a_again = graph
        .iter()
        .find(|quad| quad.predicate == iri("again"))
        .unwrap()
        .subject;
    let b = graph
        .iter()
        .find(|quad| quad.predicate == iri("scope") && quad.object == iri("b"))
        .unwrap()
        .subject;
    let root_blank = graph
        .iter()
        .find(|quad| quad.predicate == iri("root"))
        .unwrap()
        .subject;
    assert_eq!(a, a_again);
    assert_ne!(a, b);
    assert_ne!(a, root_blank);
    assert_ne!(b, root_blank);
    let generated = graph
        .iter()
        .find(|quad| quad.predicate == iri("head") && quad.object == iri("generated"))
        .unwrap()
        .subject;
    let generated_object = graph
        .iter()
        .find(|quad| quad.predicate == iri("node"))
        .unwrap()
        .object;
    assert_eq!(generated_object, Term::from(generated.clone()));
    assert_ne!(generated, a);
    assert_ne!(generated, b);
    assert_ne!(generated, root_blank);
    for generated_blank in [&a, &b, &root_blank, &generated] {
        assert_ne!(
            generated_blank,
            &NamedOrBlankNode::from(base_allocator_collision.clone())
        );
        assert_ne!(
            generated_blank,
            &NamedOrBlankNode::from(nested_base_blank.clone())
        );
    }
    let embedded = graph
        .iter()
        .find(|quad| quad.predicate == iri("statement"))
        .unwrap();
    let Term::Triple(statement) = embedded.object else {
        panic!("expected triple term")
    };
    assert_eq!(statement.object, Term::from(root_blank));

    let base_nested = execution
        .base()
        .dataset()
        .iter()
        .find(|quad| quad.predicate == iri("statement"))
        .unwrap();
    let Term::Triple(base_statement) = base_nested.object else {
        panic!("expected nested base triple term")
    };
    assert_eq!(base_statement.object, Term::from(nested_base_blank));
}

#[cfg(feature = "rdf-12")]
#[test]
fn data_terms_feed_ordinary_where_data_not_data_and_query_consumers() {
    let rules = parse(concat!(
        "PREFIX : <http://example/> ",
        "DATA { :holder :statement <<( :s :p :o )>> } ",
        "RULE { :ordinary :matched :yes } WHERE { :holder :statement ?term } ",
        "RULE { :frozen :matched :yes } WHERE DATA { :holder :statement ?term } ",
        "RULE { :negative :matched :yes } WHERE { ",
        "  :holder :statement ?term . NOT DATA { :missing :statement ?term } ",
        "}"
    ));
    let base = GraphSnapshot::default_graph(Dataset::new());
    let execution = execute_srl_rules(&rules, &base, &ValidationOptions::default()).unwrap();
    let expected = Dataset::from_iter([
        quad(
            iri("holder"),
            iri("statement"),
            triple(iri("s"), iri("p"), iri("o")),
        ),
        marker("ordinary"),
        marker("frozen"),
        marker("negative"),
    ]);
    assert_isomorphic(execution.base().dataset(), &Dataset::new());
    assert_isomorphic(execution.inference().dataset(), &expected);
    assert_isomorphic(execution.entailed().dataset(), &expected);
    let goal = SrlTriple {
        subject: SrlNode::Constant(SrlConstant::Iri(format!("{EX}holder"))),
        predicate: SrlPredicate::Node(SrlNode::Constant(SrlConstant::Iri(format!(
            "{EX}statement"
        )))),
        object: SrlNode::TripleTerm(Box::new(SrlTriple {
            subject: SrlNode::Constant(SrlConstant::Iri(format!("{EX}s"))),
            predicate: SrlPredicate::Node(SrlNode::Constant(SrlConstant::Iri(format!("{EX}p")))),
            object: SrlNode::Constant(SrlConstant::Iri(format!("{EX}o"))),
        })),
    };
    assert!(query_srl_rules(&rules, &base, &goal, &ValidationOptions::default()).unwrap());
}

#[cfg(feature = "rdf-12")]
#[test]
fn inline_only_documents_execute_in_native_and_datalog_lanes() {
    let datalog = execute(
        "PREFIX : <http://example/> DATA { :s :p <<( :u :v :w )>> }",
        Dataset::new(),
    );
    let inline = quad(iri("s"), iri("p"), triple(iri("u"), iri("v"), iri("w")));
    let datalog_expected = Dataset::from_iter([inline.clone()]);
    assert_isomorphic(datalog.base().dataset(), &Dataset::new());
    assert_isomorphic(datalog.inference().dataset(), &datalog_expected);
    assert_isomorphic(datalog.entailed().dataset(), &datalog_expected);

    let native = execute(
        concat!(
            "PREFIX : <http://example/> ",
            "DATA { :s :p <<( :u :v :w )>> } ",
            "RULE { :native :matched :yes } WHERE DATA { :s :p ?statement }"
        ),
        Dataset::new(),
    );
    let native_expected = Dataset::from_iter([inline, marker("native")]);
    assert_isomorphic(native.base().dataset(), &Dataset::new());
    assert_isomorphic(native.inference().dataset(), &native_expected);
    assert_isomorphic(native.entailed().dataset(), &native_expected);
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn triple_terms_and_reification_fail_explicitly_without_rdf12() {
    for source in [
        "PREFIX : <http://example/> DATA { :s :p <<( :u :v :w )>> }",
        "PREFIX : <http://example/> DATA { << :u :v :w >> }",
        "PREFIX : <http://example/> DATA { :s :p :o {| :source :x |} }",
    ] {
        let result = execute_srl_rules(
            &parse(source),
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default(),
        );
        assert!(matches!(
            result,
            Err(SrlError::Unsupported(reason)) if reason.contains("`rdf-12` crate feature")
        ));
    }
}

#[test]
fn variables_are_forbidden_in_data_and_empty_standalone_collection_is_not_a_data_triple() {
    for source in [
        "PREFIX : <http://example/> DATA { ?s :p :o }",
        "PREFIX : <http://example/> DATA { :s :p ?o }",
        "PREFIX : <http://example/> DATA { () }",
    ] {
        assert!(matches!(
            SrlRuleSet::parse(source, None, profiles()),
            Err(SrlError::Syntax { .. })
        ));
    }
}

#[cfg(feature = "rdf-12")]
#[test]
fn generalized_and_triple_term_subjects_fail_during_lowering_without_coercion() {
    for (source, expected) in [
        (
            "PREFIX : <http://example/> DATA { \"literal\" :p :o }",
            "generalized RDF subjects in SRL DATA evaluation",
        ),
        (
            "PREFIX : <http://example/> DATA { <<( :s :p :o )>> :q :r }",
            "RDF triple-term subjects in SRL DATA evaluation",
        ),
    ] {
        let result = execute_srl_rules(
            &parse(source),
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default(),
        );
        assert!(matches!(result, Err(SrlError::Unsupported(reason)) if reason == expected));
    }
}

#[cfg(feature = "rdf-12")]
#[test]
fn recursive_data_admission_stops_before_a_later_invalid_nested_term() {
    let rules = parse(concat!(
        "PREFIX : <http://example/> ",
        "DATA { :owner :items ( :first ( ( <<( \"invalid-subject\" :p :o )>> ) ) ) }"
    ));
    let mut options = ValidationOptions::default();
    options.limits.max_data_quads = 0;

    assert!(matches!(
        execute_srl_rules(
            &rules,
            &GraphSnapshot::default_graph(Dataset::new()),
            &options,
        ),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::DataQuads,
            limit: 0,
        }))
    ));
}

#[cfg(feature = "rdf-12")]
#[test]
fn recursive_native_head_admission_stops_before_a_later_invalid_nested_term() {
    let rules = parse(concat!(
        "PREFIX : <http://example/> ",
        "DATA { :seed :p :o } ",
        "RULE { :owner :items ( :first ( ( <<( \"invalid-subject\" :p :o )>> ) ) ) } ",
        "WHERE DATA { :seed :p :o }"
    ));
    let mut options = ValidationOptions::default();
    options.limits.max_derived_triples = 1;

    assert!(matches!(
        execute_srl_rules(
            &rules,
            &GraphSnapshot::default_graph(Dataset::new()),
            &options,
        ),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::DerivedTriples,
            limit: 1,
        }))
    ));
}

#[test]
fn expanded_data_quads_and_inline_inference_are_bounded_during_materialization() {
    let rules = parse(concat!(
        "PREFIX : <http://example/> ",
        "DATA { :owner :items ( :a :b ) }"
    ));
    let base = GraphSnapshot::default_graph(Dataset::new());

    let mut data_limited = ValidationOptions::default();
    data_limited.limits.max_data_quads = 4;
    assert!(matches!(
        execute_srl_rules(&rules, &base, &data_limited),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::DataQuads,
            limit: 4,
        }))
    ));

    let mut derived_limited = ValidationOptions::default();
    derived_limited.limits.max_derived_triples = 4;
    assert!(matches!(
        execute_srl_rules(&rules, &base, &derived_limited),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::DerivedTriples,
            limit: 4,
        }))
    ));
}

#[test]
fn derived_limit_is_cumulative_across_data_and_datalog_or_native_rules() {
    let base = Dataset::from_iter([quad(iri("seed"), iri("p"), iri("o"))]);
    let inline_only = "PREFIX : <http://example/> DATA { :inline :p :o }";
    let datalog_rule_only =
        "PREFIX : <http://example/> RULE { :datalog :derived :yes } WHERE { :seed :p :o }";
    let native_rule_only = concat!(
        "PREFIX : <http://example/> ",
        "RULE { :native :derived :yes } WHERE DATA { :seed :p :o }"
    );
    let datalog_combined = concat!(
        "PREFIX : <http://example/> ",
        "DATA { :inline :p :o } ",
        "RULE { :datalog :derived :yes } WHERE { :seed :p :o }"
    );
    let native_combined = concat!(
        "PREFIX : <http://example/> ",
        "DATA { :inline :p :o } ",
        "RULE { :native :derived :yes } WHERE DATA { :seed :p :o }"
    );
    let mut options = ValidationOptions::default();
    options.limits.max_derived_triples = 1;

    for (source, expected) in [
        (inline_only, quad(iri("inline"), iri("p"), iri("o"))),
        (
            datalog_rule_only,
            quad(iri("datalog"), iri("derived"), iri("yes")),
        ),
        (
            native_rule_only,
            quad(iri("native"), iri("derived"), iri("yes")),
        ),
    ] {
        let execution = execute_with_options(source, base.clone(), &options).unwrap();
        assert_isomorphic(
            execution.inference().dataset(),
            &Dataset::from_iter([expected]),
        );
    }
    assert!(matches!(
        execute_with_options(datalog_combined, base.clone(), &options),
        Err(SrlError::Evaluation(
            oxdatalog::rdf::RdfEvaluationError::Evaluation(
                oxdatalog::EvaluationError::LimitExceeded {
                    kind: oxdatalog::LimitKind::Facts,
                    limit: 2,
                }
            )
        ))
    ));
    assert!(matches!(
        execute_with_options(native_combined, base, &options),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::DerivedTriples,
            limit: 1,
        }))
    ));
}

#[test]
fn recursive_data_lowering_observes_depth_cancellation_and_deadline() {
    let rules = parse(concat!(
        "PREFIX : <http://example/> ",
        "DATA { :s :p ( ( ( :value ) ) ) }"
    ));
    let base = GraphSnapshot::default_graph(Dataset::new());

    let mut shallow = ValidationOptions::default();
    shallow.limits.max_recursion_depth = 1;
    assert!(matches!(
        execute_srl_rules(&rules, &base, &shallow),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::RecursionDepth,
            limit: 1,
        }))
    ));

    let cancelled = ValidationOptions::default();
    cancelled.cancellation_token.cancel();
    assert!(matches!(
        execute_srl_rules(&rules, &base, &cancelled),
        Err(SrlError::Validation(ValidationError::Cancelled))
    ));

    let mut expired = ValidationOptions::default();
    expired.limits.timeout = Some(std::time::Duration::ZERO);
    assert!(matches!(
        execute_srl_rules(&rules, &base, &expired),
        Err(SrlError::Validation(ValidationError::LimitExceeded {
            kind: LimitKind::Time,
            limit: 0,
        }))
    ));
}

#[expect(
    clippy::panic,
    reason = "the binary-search oracle rejects unrelated execution failures"
)]
fn minimum_memory(source: &str) -> usize {
    let rules = parse(source);
    let base = GraphSnapshot::default_graph(Dataset::new());
    let mut low = 0;
    let mut high = ValidationOptions::default()
        .limits
        .max_estimated_memory_bytes;
    while low < high {
        let middle = low + (high - low) / 2;
        let mut options = ValidationOptions::default();
        options.limits.max_estimated_memory_bytes = middle;
        match execute_srl_rules(&rules, &base, &options) {
            Ok(_) => high = middle,
            Err(
                SrlError::Validation(ValidationError::LimitExceeded {
                    kind: LimitKind::EstimatedMemory,
                    ..
                })
                | SrlError::Evaluation(oxdatalog::rdf::RdfEvaluationError::Evaluation(
                    oxdatalog::EvaluationError::LimitExceeded {
                        kind: oxdatalog::LimitKind::Memory,
                        ..
                    },
                )),
            ) => low = middle + 1,
            result => panic!("unexpected memory probe result: {result:?}"),
        }
    }
    low
}

#[test]
fn memory_accounting_is_cumulative_across_data_blocks_and_recursive_constructors() {
    let first = "PREFIX : <http://example/> DATA { :first :items ( :a [ :p :b ] ) }";
    let second = "PREFIX : <http://example/> DATA { :second :items ( :c [ :q :d ] ) }";
    let combined = concat!(
        "PREFIX : <http://example/> ",
        "DATA { :first :items ( :a [ :p :b ] ) } ",
        "DATA { :second :items ( :c [ :q :d ] ) }"
    );
    let one_block_ceiling = minimum_memory(first).max(minimum_memory(second));
    let mut options = ValidationOptions::default();
    options.limits.max_estimated_memory_bytes = one_block_ceiling;

    execute_srl_rules(
        &parse(first),
        &GraphSnapshot::default_graph(Dataset::new()),
        &options,
    )
    .unwrap();
    execute_srl_rules(
        &parse(second),
        &GraphSnapshot::default_graph(Dataset::new()),
        &options,
    )
    .unwrap();
    assert!(matches!(
        execute_srl_rules(
            &parse(combined),
            &GraphSnapshot::default_graph(Dataset::new()),
            &options,
        ),
        Err(SrlError::Evaluation(
            oxdatalog::rdf::RdfEvaluationError::Evaluation(
                oxdatalog::EvaluationError::LimitExceeded {
                    kind: oxdatalog::LimitKind::Memory,
                    limit,
                },
            ),
        )) if limit < one_block_ceiling
    ));
}
