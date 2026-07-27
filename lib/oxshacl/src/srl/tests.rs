use super::{SrlError, SrlRuleSet, execute_srl_rules, execute_srl_rules_with_imports};
use crate::{GraphSnapshot, ProfileId, ProfileSet, ValidationOptions};
use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad};
use std::cell::RefCell;

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

#[test]
fn uncorrelated_negation_derives_when_no_match_exists() {
    let rules =
        parse("PREFIX : <http://example/> RULE { :x :p \"absent\" } WHERE { NOT { ?s :q ?o } }");
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(Dataset::new()),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert!(execution.inference().dataset().contains(&Quad::new(
        NamedNode::new_unchecked("http://example/x"),
        NamedNode::new_unchecked("http://example/p"),
        Literal::new_simple_literal("absent"),
        GraphName::DefaultGraph,
    )));
}

#[test]
fn uncorrelated_negation_observes_existing_matches() {
    let rules =
        parse("PREFIX : <http://example/> RULE { :x :p \"absent\" } WHERE { NOT { ?s :q ?o } }");
    let data = Dataset::from_iter([Quad::new(
        NamedNode::new_unchecked("http://example/s"),
        NamedNode::new_unchecked("http://example/q"),
        NamedNode::new_unchecked("http://example/o"),
        GraphName::DefaultGraph,
    )]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert!(execution.inference().dataset().is_empty());
}

#[test]
fn negation_with_a_conflicting_constant_is_not_a_false_dependency_cycle() {
    let rules = parse(
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> \
         PREFIX : <http://example/> \
         RULE { ?x :status :safeToDeploy } WHERE { \
           ?x rdf:type :Component . NOT { ?x :status :criticallyExposed } \
         }",
    );
    let data = Dataset::from_iter([
        Quad::new(
            NamedNode::new_unchecked("http://example/app"),
            NamedNode::new_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
            NamedNode::new_unchecked("http://example/Component"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            NamedNode::new_unchecked("http://example/app"),
            NamedNode::new_unchecked("http://example/status"),
            NamedNode::new_unchecked("http://example/criticallyExposed"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            NamedNode::new_unchecked("http://example/logger"),
            NamedNode::new_unchecked("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
            NamedNode::new_unchecked("http://example/Component"),
            GraphName::DefaultGraph,
        ),
    ]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert!(execution.inference().dataset().contains(&Quad::new(
        NamedNode::new_unchecked("http://example/logger"),
        NamedNode::new_unchecked("http://example/status"),
        NamedNode::new_unchecked("http://example/safeToDeploy"),
        GraphName::DefaultGraph,
    )));
    assert_eq!(execution.inference().triple_count(), 1);
}

#[test]
fn inline_data_is_inference_not_external_base() {
    let rules = parse("PREFIX : <http://example/> DATA { :s :p :o }");
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(Dataset::new()),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_eq!(execution.base().triple_count(), 0);
    assert_eq!(execution.inference().triple_count(), 1);
    assert_eq!(execution.entailed().triple_count(), 1);
    let mut limited = ValidationOptions::default();
    limited.limits.max_derived_triples = 0;
    assert!(matches!(
        execute_srl_rules(
            &rules,
            &GraphSnapshot::default_graph(Dataset::new()),
            &limited
        )
        .unwrap_err(),
        SrlError::Validation(_)
    ));
}

#[test]
fn inline_data_rejects_reserved_typed_literals_without_language_components() {
    let rejects = |datatype| {
        let rules = parse(&format!(
            concat!(
                "PREFIX : <http://example/> ",
                "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
                "DATA {{ :s :p \"value\"^^rdf:{datatype} }}"
            ),
            datatype = datatype,
        ));
        assert!(matches!(
            execute_srl_rules(
                &rules,
                &GraphSnapshot::default_graph(Dataset::new()),
                &ValidationOptions::default(),
            ),
            Err(SrlError::Unsupported(_))
        ));
    };
    rejects("langString");
    #[cfg(feature = "rdf-12")]
    rejects("dirLangString");
}

#[test]
fn inline_blank_nodes_cannot_alias_external_blank_nodes() {
    let rules = parse("PREFIX : <http://example/> DATA { _:source :p :o }");
    let external_blank = BlankNode::new_unchecked("oxshacl-srl-inline-0");
    let data = Dataset::from_iter([Quad::new(
        external_blank.clone(),
        NamedNode::new_unchecked("http://example/external"),
        NamedNode::new_unchecked("http://example/o"),
        GraphName::DefaultGraph,
    )]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    let inferred_subject = execution
        .inference()
        .dataset()
        .iter()
        .next()
        .unwrap()
        .subject;
    assert!(
        matches!(inferred_subject, NamedOrBlankNode::BlankNode(node) if node != external_blank)
    );
}

#[test]
fn issue_only_execution_constructs_fail_closed() {
    for source in [
        "PREFIX : <http://example/> IMPORTS :other RULE {} WHERE {}",
        "PREFIX : <http://example/> RULE {} WHERE DATA {}",
        "PREFIX : <http://example/> RULE {} WHERE { NOT DATA {} }",
        "PREFIX : <http://example/> RULE {} FOR ?this IN :Shape WHERE {}",
    ] {
        let error = execute_srl_rules(
            &parse(source),
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default(),
        )
        .unwrap_err();
        assert!(matches!(error, SrlError::Unsupported(_)));
    }
}

#[test]
fn consecutive_triple_blocks_require_a_dot() {
    SrlRuleSet::parse(
        "PREFIX : <http://example/> RULE {} WHERE { :a :p :b :c :q :d }",
        None,
        profiles(),
    )
    .unwrap_err();
    SrlRuleSet::parse(
        "PREFIX : <http://example/> RULE {} WHERE { ?-bad :p :o }",
        None,
        profiles(),
    )
    .unwrap_err();
    SrlRuleSet::parse("PREFIX 1bad: <http://example/>", None, profiles()).unwrap_err();
    SrlRuleSet::parse(
        r"PREFIX : <http://example/\u0061> RULE {} WHERE {}",
        None,
        profiles(),
    )
    .unwrap();
    parse("prefix ex: <http://example/> rule {} where { filter(str(?x) = \"x\") }")
        .check_well_formed()
        .unwrap_err();
    parse("PREFIX \u{e9}x: <http://example/> RULE {} WHERE { ?\u{53d8}\u{91cf} \u{e9}x:p ?0 }")
        .check_well_formed()
        .unwrap();
    parse(r"PREFIX ex: <http://example/> RULE {} WHERE { ex:a\~b ex:p TRUE FILTER(1+2*3 = 7) }")
        .check_well_formed()
        .unwrap();
    for source in [
        "PREFIX : <http://example/> RULE {} WHERE { :s A :o }",
        "PREFIX : <http://example/> RULE {} WHERE { :s :p \"x\"@1en }",
        "PREFIX : <http://example/> RULE {} WHERE { ?\u{100000} :p :o }",
        "PREFIX : <http://example/> RULE {} WHERE { FILTER true }",
        "PREFIX : <http://example/> RULE {} WHERE { FILTER STR() }",
        "PREFIX : <http://example/> RULE {} WHERE { FILTER(1 = 1 = 1) }",
        "VERSION \"\"\"draft\"\"\"",
    ] {
        SrlRuleSet::parse(source, None, profiles()).unwrap_err();
    }
}

#[test]
fn standalone_reification_never_disappears_during_execution() {
    let rules = parse("PREFIX : <http://example/> DATA { << :s :p :o >> }");
    let error = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(Dataset::new()),
        &ValidationOptions::default(),
    )
    .unwrap_err();
    assert!(matches!(error, SrlError::Unsupported(_)));
}

#[test]
#[cfg(feature = "sparql")]
fn filter_and_set_follow_sparql_expression_semantics() {
    let rules = parse(
        "PREFIX : <http://example/> \
         RULE { ?s :double ?d } WHERE { \
           ?s :value ?v . FILTER(?v >= 2 && ?v < 4) SET(?d := ?v * 2) \
         }",
    );
    let value = NamedNode::new_unchecked("http://example/value");
    let data = Dataset::from_iter([
        Quad::new(
            NamedNode::new_unchecked("http://example/one"),
            value.clone(),
            Literal::from(1),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            NamedNode::new_unchecked("http://example/two"),
            value.clone(),
            Literal::from(2),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            NamedNode::new_unchecked("http://example/four"),
            value,
            Literal::from(4),
            GraphName::DefaultGraph,
        ),
    ]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_eq!(execution.inference().triple_count(), 1);
    assert!(execution.inference().dataset().contains(&Quad::new(
        NamedNode::new_unchecked("http://example/two"),
        NamedNode::new_unchecked("http://example/double"),
        Literal::from(4),
        GraphName::DefaultGraph,
    )));
}

#[test]
#[cfg(feature = "sparql")]
fn expression_errors_drop_only_the_current_solution() {
    let rules = parse(
        "PREFIX : <http://example/> \
         RULE { ?s :inverse ?i } WHERE { ?s :value ?v SET(?i := 1 / ?v) }",
    );
    let value = NamedNode::new_unchecked("http://example/value");
    let data = Dataset::from_iter([
        Quad::new(
            NamedNode::new_unchecked("http://example/zero"),
            value.clone(),
            Literal::from(0),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            NamedNode::new_unchecked("http://example/two"),
            value,
            Literal::from(2),
            GraphName::DefaultGraph,
        ),
    ]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_eq!(execution.inference().triple_count(), 1);
}

#[test]
#[cfg(feature = "sparql")]
fn filter_inside_negation_uses_the_correlated_solution() {
    let rules = parse(
        "PREFIX : <http://example/> \
         RULE { :x :status :ok } WHERE { \
           :x :limit ?limit . NOT { :x :value ?value FILTER(?value > ?limit) } \
         }",
    );
    let data = Dataset::from_iter([
        Quad::new(
            NamedNode::new_unchecked("http://example/x"),
            NamedNode::new_unchecked("http://example/limit"),
            Literal::from(5),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            NamedNode::new_unchecked("http://example/x"),
            NamedNode::new_unchecked("http://example/value"),
            Literal::from(3),
            GraphName::DefaultGraph,
        ),
    ]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_eq!(execution.inference().triple_count(), 1);
}

#[test]
fn complex_head_expands_collections_and_property_lists() {
    let rules = parse(
        "PREFIX : <http://example/> \
         RULE { :s :list ( ?o [ :nested ?o ] ) } WHERE { :s :p ?o }",
    );
    let object = NamedNode::new_unchecked("http://example/o");
    let data = Dataset::from_iter([Quad::new(
        NamedNode::new_unchecked("http://example/s"),
        NamedNode::new_unchecked("http://example/p"),
        object.clone(),
        GraphName::DefaultGraph,
    )]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_eq!(execution.inference().triple_count(), 6);
    assert!(execution.inference().dataset().iter().any(|quad| {
        quad.predicate.as_str() == "http://example/nested" && quad.object == object
    }));
}

#[test]
fn recursive_imports_are_resolved_once_and_blank_nodes_are_merged_apart() {
    let root = parse(
        "PREFIX : <http://example/> IMPORTS <urn:a> \
         RULE { :result :seen ?o } WHERE { ?s :p ?o }",
    );
    let calls = RefCell::new(Vec::new());
    let resolver = |iri: &str, _profiles: &ProfileSet| {
        calls.borrow_mut().push(iri.to_owned());
        match iri {
            "urn:a" => Ok(parse(
                "PREFIX : <http://example/> IMPORTS <urn:b> DATA { _:same :p :a }",
            )),
            "urn:b" => Ok(parse(
                "PREFIX : <http://example/> IMPORTS <urn:a> DATA { _:same :p :b }",
            )),
            _ => Err(SrlError::Unsupported(format!("unexpected import `{iri}`"))),
        }
    };
    assert!(matches!(
        execute_srl_rules(
            &root,
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default()
        ),
        Err(SrlError::Unsupported(_))
    ));
    let execution = execute_srl_rules_with_imports(
        &root,
        &GraphSnapshot::default_graph(Dataset::new()),
        &ValidationOptions::default(),
        &resolver,
    )
    .unwrap();
    assert_eq!(calls.into_inner(), ["urn:a", "urn:b"]);
    assert_eq!(execution.inference().triple_count(), 4);
    let subjects = execution
        .inference()
        .dataset()
        .iter()
        .filter(|quad| quad.predicate.as_str() == "http://example/p")
        .map(|quad| quad.subject)
        .collect::<Vec<_>>();
    assert_ne!(subjects[0], subjects[1]);
}

#[test]
fn imported_data_already_in_the_base_is_not_inference() {
    let root = parse("IMPORTS <urn:a>");
    let resolver = |_iri: &str, _profiles: &ProfileSet| {
        Ok(parse("PREFIX : <http://example/> DATA { :s :p :o }"))
    };
    let data = Dataset::from_iter([Quad::new(
        NamedNode::new_unchecked("http://example/s"),
        NamedNode::new_unchecked("http://example/p"),
        NamedNode::new_unchecked("http://example/o"),
        GraphName::DefaultGraph,
    )]);
    let execution = execute_srl_rules_with_imports(
        &root,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
        &resolver,
    )
    .unwrap();
    assert!(execution.inference().dataset().is_empty());
}

#[test]
#[cfg(not(feature = "sparql"))]
fn expression_execution_fails_closed_without_sparql_feature() {
    let rules = parse("PREFIX : <http://example/> RULE {} WHERE { FILTER(1 = 1) }");
    assert!(matches!(
        execute_srl_rules(
            &rules,
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default()
        ),
        Err(SrlError::Unsupported(_))
    ));
}

#[test]
#[cfg(feature = "rdf-12")]
fn rdf12_annotations_and_triple_terms_are_instantiated() {
    let rules = parse(
        "PREFIX : <http://example/> \
         RULE { \
           :s :p ?o {| :source :rule |} . \
           :x :statement <<( :s :p ?o )>> \
         } WHERE { :s :input ?o }",
    );
    let data = Dataset::from_iter([Quad::new(
        NamedNode::new_unchecked("http://example/s"),
        NamedNode::new_unchecked("http://example/input"),
        NamedNode::new_unchecked("http://example/o"),
        GraphName::DefaultGraph,
    )]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();
    assert_eq!(execution.inference().triple_count(), 4);
    assert!(execution.inference().dataset().iter().any(|quad| {
        quad.predicate.as_str() == "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies"
    }));
}
