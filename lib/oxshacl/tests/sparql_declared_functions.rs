#![cfg(feature = "w3c-tests")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise SHACL-declared functions called from SPARQL"
)]

//! `sh:ListParameterExpressionFunction` declarations called by IRI from the
//! `sh:select` text of SHACL-SPARQL constraints. These fixtures are
//! independent of the pinned W3C `sparql/functions/*` cases.

use oxrdf::{Dataset, GraphName, Literal, Quad, Term};
use oxshacl::{
    GraphSnapshot, LimitKind, ProfileId, ProfileSet, ShapesGraph, ValidationError,
    ValidationOptions, validate,
};
use oxttl::TurtleParser;
use std::time::Duration;

const PREFIXES: &str = "
@prefix ex: <http://example.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix shnex: <http://www.w3.org/ns/shacl-node-expr#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
";

fn graph(body: &str) -> GraphSnapshot {
    let source = format!("{PREFIXES}{body}");
    let mut dataset = Dataset::new();
    for triple in TurtleParser::new().for_slice(source.as_bytes()) {
        let triple = triple.unwrap();
        dataset.insert(Quad::new(
            triple.subject,
            triple.predicate,
            triple.object,
            GraphName::DefaultGraph,
        ));
    }
    GraphSnapshot::default_graph(dataset)
}

fn shapes(graph: &GraphSnapshot) -> ShapesGraph {
    ShapesGraph::compile(
        graph,
        ProfileSet::new([
            ProfileId::Core12Subset20260723,
            ProfileId::NodeExpressions12Subset20260108,
            ProfileId::SparqlExtensions12Subset20260130,
        ])
        .unwrap(),
        &ValidationOptions::default(),
    )
    .unwrap()
}

/// A constraint that reports the value its `sh:select` binds for `ex:Focus`.
fn constraint(select_body: &str) -> String {
    format!(
        r#"
ex:Shape a sh:NodeShape ;
    sh:targetNode ex:Focus ;
    sh:sparql [ sh:select """
PREFIX ex: <http://example.org/>
SELECT $this ?value WHERE {{ {select_body} }}""" ] .
"#
    )
}

const COUNT_INSTANCES: &str = "
ex:countInstances a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ shnex:count [ shnex:instancesOf [ shnex:arg 0 ] ] ] ;
    sh:parameter [ sh:path shnex:arg0 ; sh:nodeKind sh:IRI ] .
";

const TAGGED_NAMES: &str = r#"
ex:taggedNames a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:select """
PREFIX ex: <http://example.org/>
SELECT (COUNT(?name) AS ?result) WHERE {
    $arg0 ex:name ?name .
    BIND (COALESCE($arg1, "fr") AS ?tag) .
    FILTER (lang(?name) = ?tag)
}""" ] ;
    sh:parameter [ sh:path shnex:arg0 ; sh:nodeKind sh:IRI ] ;
    sh:parameter [ sh:path shnex:arg1 ; sh:datatype xsd:string ; sh:optional true ] .
"#;

fn values(report: &oxshacl::ValidationReport) -> Vec<Term> {
    report
        .results()
        .iter()
        .filter_map(|result| result.value.clone())
        .collect()
}

#[test]
fn a_graph_reading_function_counts_instances_including_subclasses() {
    let data = graph(&format!(
        "{COUNT_INSTANCES}{}
ex:Kind rdfs:subClassOf ex:Base .
ex:a a ex:Base .
ex:b a ex:Kind .
ex:c a ex:Other .",
        constraint("BIND (ex:countInstances(ex:Base) AS ?value)")
    ));
    let report = validate(&shapes(&data), &data, &ValidationOptions::default()).unwrap();
    assert_eq!(values(&report), [Term::from(Literal::from(2_i64))]);
}

#[test]
fn a_sparql_body_uses_supplied_and_defaulted_optional_arguments() {
    let data = graph(&format!(
        r#"{TAGGED_NAMES}{}
ex:item ex:name "un"@fr, "deux"@fr, "one"@en ."#,
        constraint(
            r#"BIND (CONCAT(STR(ex:taggedNames(ex:item, "en")), " ", STR(ex:taggedNames(ex:item))) AS ?value)"#
        )
    ));
    let report = validate(&shapes(&data), &data, &ValidationOptions::default()).unwrap();
    assert_eq!(values(&report), [Term::from(Literal::from("1 2"))]);
}

#[test]
fn an_unbound_argument_yields_an_unbound_result() {
    let data = graph(&format!(
        r#"{TAGGED_NAMES}{}
ex:item ex:name "un"@fr ."#,
        constraint(
            r#"BIND (ex:taggedNames(?missing, "fr") AS ?result) .
               BIND (STR(BOUND(?result)) AS ?value)"#
        )
    ));
    let report = validate(&shapes(&data), &data, &ValidationOptions::default()).unwrap();
    assert_eq!(values(&report), [Term::from(Literal::from("false"))]);
}

#[test]
fn cancellation_inside_a_declared_function_fails_validation() {
    let data = graph(&format!(
        "{COUNT_INSTANCES}{}
ex:a a ex:Base .",
        constraint("BIND (ex:countInstances(ex:Base) AS ?value)")
    ));
    let compiled = shapes(&data);
    let options = ValidationOptions::default();
    options.cancellation_token.cancel();
    assert!(matches!(
        validate(&compiled, &data, &options),
        Err(ValidationError::Cancelled)
    ));
}

#[test]
fn a_path_visit_limit_reached_inside_a_declared_function_fails_validation() {
    let data = graph(&format!(
        "{COUNT_INSTANCES}{}
ex:Kind rdfs:subClassOf ex:Base .
ex:a a ex:Kind .
ex:b a ex:Kind .",
        constraint("BIND (ex:countInstances(ex:Base) AS ?value)")
    ));
    let compiled = shapes(&data);
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = 0;
    options.limits.timeout = Some(Duration::from_secs(60));
    let result = validate(&compiled, &data, &options);
    assert!(
        matches!(
            result,
            Err(ValidationError::LimitExceeded {
                kind: LimitKind::PathVisits,
                ..
            })
        ),
        "a limit inside the function must fail validation, not become unbound: {result:?}"
    );
}

#[test]
fn an_undeclared_function_is_still_unsupported() {
    let data = graph(&constraint("BIND (ex:notDeclared(ex:Base) AS ?value)"));
    assert!(matches!(
        validate(&shapes(&data), &data, &ValidationOptions::default()),
        Err(ValidationError::Sparql(message)) if message.contains("not supported")
    ));
}
