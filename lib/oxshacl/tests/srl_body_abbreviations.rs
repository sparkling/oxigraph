#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests compare SRL body abbreviations with their explicit triple patterns"
)]

use oxrdf::{Dataset, GraphName, NamedNode, Quad};
use oxshacl::{
    GraphSnapshot, ProfileId, ProfileSet, SrlExecution, SrlRuleSet, ValidationOptions,
    execute_srl_rules,
};
#[cfg(not(feature = "rdf-12"))]
use oxshacl::SrlError;

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

fn execute(source: &str) -> SrlExecution {
    execute_srl_rules(
        &parse(source),
        &GraphSnapshot::default_graph(Dataset::new()),
        &ValidationOptions::default(),
    )
    .unwrap()
}

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{EX}{local}"))
}

fn marker(subject: &str) -> Quad {
    Quad::new(
        iri(subject),
        iri("matched"),
        iri("yes"),
        GraphName::DefaultGraph,
    )
}

fn assert_marked(execution: &SrlExecution, subject: &str) {
    assert!(execution.inference().dataset().contains(&marker(subject)));
}

fn assert_not_marked(execution: &SrlExecution, subject: &str) {
    assert!(!execution.inference().dataset().contains(&marker(subject)));
}

#[test]
fn collection_patterns_equal_explicit_chains_and_reject_malformed_lists() {
    let execution = execute(concat!(
        "PREFIX : <http://example/> ",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
        "DATA { ",
        "  :good :items _:g0 . ",
        "  _:g0 rdf:first :a ; rdf:rest _:g1 . ",
        "  _:g1 rdf:first :b ; rdf:rest rdf:nil . ",
        "  :bad :items _:b0 . ",
        "  _:b0 rdf:first :a ; rdf:rest _:b1 . ",
        "  _:b1 rdf:first :wrong ; rdf:rest rdf:nil ",
        "} ",
        "RULE { :collectionAbbreviationGood :matched :yes } WHERE { ",
        "  :good :items ( :a :b ) ",
        "} ",
        "RULE { :collectionExplicitGood :matched :yes } WHERE { ",
        "  :good :items ?l0 . ",
        "  ?l0 rdf:first :a ; rdf:rest ?l1 . ",
        "  ?l1 rdf:first :b ; rdf:rest rdf:nil ",
        "} ",
        "RULE { :collectionAbbreviationBad :matched :yes } WHERE { ",
        "  :bad :items ( :a :b ) ",
        "} ",
        "RULE { :collectionExplicitBad :matched :yes } WHERE { ",
        "  :bad :items ?l0 . ",
        "  ?l0 rdf:first :a ; rdf:rest ?l1 . ",
        "  ?l1 rdf:first :b ; rdf:rest rdf:nil ",
        "}",
    ));

    assert_marked(&execution, "collectionAbbreviationGood");
    assert_marked(&execution, "collectionExplicitGood");
    assert_not_marked(&execution, "collectionAbbreviationBad");
    assert_not_marked(&execution, "collectionExplicitBad");
}

#[test]
fn standalone_collection_patterns_expand_for_positive_and_negative_matching() {
    let execution = execute(concat!(
        "PREFIX : <http://example/> ",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
        "DATA { ",
        "  _:head rdf:first :a ; rdf:rest _:tail . ",
        "  _:tail rdf:first :b ; rdf:rest rdf:nil ",
        "} ",
        "RULE { :standaloneCollection :matched :yes } WHERE { ( :a :b ) } ",
        "RULE { :standaloneCollectionExplicit :matched :yes } WHERE { ",
        "  ?head rdf:first :a ; rdf:rest ?tail . ",
        "  ?tail rdf:first :b ; rdf:rest rdf:nil ",
        "} ",
        "RULE { :standaloneCollectionAbsent :matched :yes } WHERE { ",
        "  NOT { ( :missing ) } ",
        "} ",
        "RULE { :standaloneCollectionBlocked :matched :yes } WHERE { ",
        "  NOT { ( :a :b ) } ",
        "}",
    ));

    assert_marked(&execution, "standaloneCollection");
    assert_marked(&execution, "standaloneCollectionExplicit");
    assert_marked(&execution, "standaloneCollectionAbsent");
    assert_not_marked(&execution, "standaloneCollectionBlocked");
}

#[test]
fn nested_property_lists_equal_explicit_expansion_and_share_each_constructor() {
    let execution = execute(concat!(
        "PREFIX : <http://example/> ",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
        "DATA { ",
        "  :good :node _:outerGood . ",
        "  _:outerGood :p _:listGood ; :flag true . ",
        "  _:listGood rdf:first :a ; rdf:rest _:tailGood . ",
        "  _:tailGood rdf:first _:innerGood ; rdf:rest rdf:nil . ",
        "  _:innerGood :q :b . ",
        "  :bad :node _:outerBad . ",
        "  _:outerBad :p _:listBad ; :flag true . ",
        "  _:listBad rdf:first :a ; rdf:rest _:tailBad . ",
        "  _:tailBad rdf:first _:innerBad ; rdf:rest rdf:nil . ",
        "  _:innerBad :q :wrong ",
        "} ",
        "RULE { :nestedAbbreviationGood :matched :yes } WHERE { ",
        "  :good :node [ :p ( :a [ :q :b ] ) ; :flag true ] ",
        "} ",
        "RULE { :nestedExplicitGood :matched :yes } WHERE { ",
        "  :good :node ?outer . ",
        "  ?outer :p ?list ; :flag true . ",
        "  ?list rdf:first :a ; rdf:rest ?tail . ",
        "  ?tail rdf:first ?inner ; rdf:rest rdf:nil . ",
        "  ?inner :q :b ",
        "} ",
        "RULE { :nestedAbbreviationBad :matched :yes } WHERE { ",
        "  :bad :node [ :p ( :a [ :q :b ] ) ; :flag true ] ",
        "} ",
        "RULE { :nestedExplicitBad :matched :yes } WHERE { ",
        "  :bad :node ?outer . ",
        "  ?outer :p ?list ; :flag true . ",
        "  ?list rdf:first :a ; rdf:rest ?tail . ",
        "  ?tail rdf:first ?inner ; rdf:rest rdf:nil . ",
        "  ?inner :q :b ",
        "}",
    ));

    assert_marked(&execution, "nestedAbbreviationGood");
    assert_marked(&execution, "nestedExplicitGood");
    assert_not_marked(&execution, "nestedAbbreviationBad");
    assert_not_marked(&execution, "nestedExplicitBad");
}

#[test]
fn labeled_blank_nodes_are_existential_and_shared_across_the_rule_body() {
    let execution = execute(concat!(
        "PREFIX : <http://example/> ",
        "DATA { ",
        "  :good :node _:same . _:same :p :x ; :q :x . ",
        "  :bad :node _:left . _:left :p :x . _:right :q :x ",
        "} ",
        "RULE { :blankAbbreviationGood :matched :yes } WHERE { ",
        "  :good :node _:shared . _:shared :p ?value . _:shared :q ?value ",
        "} ",
        "RULE { :blankExplicitGood :matched :yes } WHERE { ",
        "  :good :node ?node . ?node :p ?value . ?node :q ?value ",
        "} ",
        "RULE { :blankAbbreviationBad :matched :yes } WHERE { ",
        "  :bad :node _:shared . _:shared :p ?value . _:shared :q ?value ",
        "} ",
        "RULE { :blankExplicitBad :matched :yes } WHERE { ",
        "  :bad :node ?node . ?node :p ?value . ?node :q ?value ",
        "}",
    ));

    assert_marked(&execution, "blankAbbreviationGood");
    assert_marked(&execution, "blankExplicitGood");
    assert_not_marked(&execution, "blankAbbreviationBad");
    assert_not_marked(&execution, "blankExplicitBad");
}

#[test]
fn labeled_blank_scope_is_preserved_inside_negative_patterns() {
    let execution = execute(concat!(
        "PREFIX : <http://example/> ",
        "DATA { ",
        "  :allowed :node _:open . _:open :p :x . ",
        "  :blocked :node _:closed . _:closed :p :x ; :q :x ",
        "} ",
        "RULE { :negativeAbbreviationAllowed :matched :yes } WHERE { ",
        "  :allowed :node _:shared . _:shared :p ?value . ",
        "  NOT { _:shared :q ?value } ",
        "} ",
        "RULE { :negativeExplicitAllowed :matched :yes } WHERE { ",
        "  :allowed :node ?node . ?node :p ?value . ",
        "  NOT { ?node :q ?value } ",
        "} ",
        "RULE { :negativeAbbreviationBlocked :matched :yes } WHERE { ",
        "  :blocked :node _:shared . _:shared :p ?value . ",
        "  NOT { _:shared :q ?value } ",
        "} ",
        "RULE { :negativeExplicitBlocked :matched :yes } WHERE { ",
        "  :blocked :node ?node . ?node :p ?value . ",
        "  NOT { ?node :q ?value } ",
        "}",
    ));

    assert_marked(&execution, "negativeAbbreviationAllowed");
    assert_marked(&execution, "negativeExplicitAllowed");
    assert_not_marked(&execution, "negativeAbbreviationBlocked");
    assert_not_marked(&execution, "negativeExplicitBlocked");
}

#[test]
fn abbreviations_obey_working_and_frozen_data_graph_selection() {
    let execution = execute(concat!(
        "PREFIX : <http://example/> ",
        "DATA { :seed :input :value } ",
        "RULE { :derived :node [ :p :value ] } WHERE { :seed :input :value } ",
        "RULE { :ordinaryAbbreviation :matched :yes } WHERE { ",
        "  :derived :node [ :p :value ] ",
        "} ",
        "RULE { :ordinaryExplicit :matched :yes } WHERE { ",
        "  :derived :node ?node . ?node :p :value ",
        "} ",
        "RULE { :whereDataAbbreviation :matched :yes } WHERE DATA { ",
        "  :derived :node [ :p :value ] ",
        "} ",
        "RULE { :notDataAbbreviation :matched :yes } WHERE { ",
        "  :seed :input :value . NOT DATA { :derived :node [ :p :value ] } ",
        "} ",
        "RULE { :ordinaryNegative :matched :yes } WHERE { ",
        "  :seed :input :value . NOT { :derived :node [ :p :value ] } ",
        "}",
    ));

    assert_marked(&execution, "ordinaryAbbreviation");
    assert_marked(&execution, "ordinaryExplicit");
    assert_not_marked(&execution, "whereDataAbbreviation");
    assert_marked(&execution, "notDataAbbreviation");
    assert_not_marked(&execution, "ordinaryNegative");
}

#[test]
fn auxiliary_predicates_from_body_abbreviations_create_closed_dependencies() {
    let rules = parse(concat!(
        "PREFIX : <http://example/> ",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
        "RULE { :list rdf:first :a } WHERE { :seed :go true } ",
        "RULE { :annotation :source :x } WHERE { :seed :go true } ",
        "RULE { :reifier rdf:reifies <<( :u :v :w )>> } WHERE { :seed :go true } ",
        "RULE { :collectionConsumer :safe true } WHERE { ",
        "  :seed :go true . NOT { ( :a ) } ",
        "} ",
        "RULE { :annotationConsumer :safe true } WHERE { ",
        "  :seed :go true . NOT { :s :p :o {| :source :x |} } ",
        "} ",
        "RULE { :reifiedConsumer :safe true } WHERE { ",
        "  :seed :go true . NOT { << :u :v :w ~ :reifier >> } ",
        "}",
    ));
    let stratification = rules.stratification().unwrap();

    assert_eq!(stratification.strata.len(), 2);
    assert_eq!(stratification.strata[0].general, [0, 1, 2]);
    assert_eq!(stratification.strata[1].general, [3, 4, 5]);
}

#[cfg(feature = "rdf-12")]
#[test]
fn annotations_and_reified_triples_equal_their_distinct_expansions() {
    use oxrdf::{Term, Triple};

    let rules = parse(concat!(
        "PREFIX : <http://example/> ",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
        "RULE { :annotationAbbreviation :matched :yes } WHERE { ",
        "  :s :p :o ~ :annotation {| :source :x |} ",
        "} ",
        "RULE { :annotationExplicit :matched :yes } WHERE { ",
        "  :s :p :o . ",
        "  :annotation rdf:reifies <<( :s :p :o )>> ; :source :x ",
        "} ",
        "RULE { :reifiedAbbreviation :matched :yes } WHERE { ",
        "  << :u :v :w ~ :reifier >> :source :y ",
        "} ",
        "RULE { :reifiedExplicit :matched :yes } WHERE { ",
        "  :reifier rdf:reifies <<( :u :v :w )>> ; :source :y ",
        "} ",
        "RULE { :standaloneReified :matched :yes } WHERE { ",
        "  << :u :v :w ~ :reifier >> ",
        "} ",
        "RULE { :standaloneReifiedAbsent :matched :yes } WHERE { ",
        "  NOT { << :absent :v :w ~ :missingReifier >> } ",
        "} ",
        "RULE { :standaloneReifiedBlocked :matched :yes } WHERE { ",
        "  NOT { << :u :v :w ~ :reifier >> } ",
        "} ",
        "RULE { :referencedTripleWasAsserted :matched :yes } WHERE { :u :v :w }",
    ));
    let rdf_reifies = NamedNode::new_unchecked(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
    );
    let data = Dataset::from_iter([
        Quad::new(iri("s"), iri("p"), iri("o"), GraphName::DefaultGraph),
        Quad::new(
            iri("annotation"),
            rdf_reifies.clone(),
            Term::Triple(Box::new(Triple::new(iri("s"), iri("p"), iri("o")))),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            iri("annotation"),
            iri("source"),
            iri("x"),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            iri("reifier"),
            rdf_reifies,
            Term::Triple(Box::new(Triple::new(iri("u"), iri("v"), iri("w")))),
            GraphName::DefaultGraph,
        ),
        Quad::new(
            iri("reifier"),
            iri("source"),
            iri("y"),
            GraphName::DefaultGraph,
        ),
    ]);
    let execution = execute_srl_rules(
        &rules,
        &GraphSnapshot::default_graph(data),
        &ValidationOptions::default(),
    )
    .unwrap();

    assert_marked(&execution, "annotationAbbreviation");
    assert_marked(&execution, "annotationExplicit");
    assert_marked(&execution, "reifiedAbbreviation");
    assert_marked(&execution, "reifiedExplicit");
    assert_marked(&execution, "standaloneReified");
    assert_marked(&execution, "standaloneReifiedAbsent");
    assert_not_marked(&execution, "standaloneReifiedBlocked");
    assert_not_marked(&execution, "referencedTripleWasAsserted");
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn reification_body_matching_fails_closed_without_rdf12_support() {
    let rules = parse(concat!(
        "PREFIX : <http://example/> ",
        "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ",
        "DATA { :s :p :o . :annotation rdf:reifies :notATriple } ",
        "RULE { :probe :matched :yes } WHERE { ",
        "  :s :p :o ~ :annotation {| :source :x |} ",
        "}",
    ));

    assert!(matches!(
        execute_srl_rules(
            &rules,
            &GraphSnapshot::default_graph(Dataset::new()),
            &ValidationOptions::default(),
        ),
        Err(SrlError::Unsupported(reason)) if reason.contains("`rdf-12` crate feature")
    ));
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn reification_capability_is_preflighted_before_body_evaluation() {
    for source in [
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :probe :matched :yes } WHERE { ",
            "  NOT { << :u :v :w ~ :reifier >> } ",
            "}",
        ),
        concat!(
            "PREFIX : <http://example/> ",
            "RULE { :probe :matched :yes } WHERE { ",
            "  :missing :p :o . << :u :v :w ~ :reifier >> ",
            "}",
        ),
    ] {
        let rules = parse(source);
        assert!(matches!(
            execute_srl_rules(
                &rules,
                &GraphSnapshot::default_graph(Dataset::new()),
                &ValidationOptions::default(),
            ),
            Err(SrlError::Unsupported(reason)) if reason.contains("`rdf-12` crate feature")
        ));
    }
}
