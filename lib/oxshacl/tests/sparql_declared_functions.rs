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

/// spareval yields no value for a call with an unbound argument before the
/// registered function runs, which is how the SPARQL error in shacl12-sparql's
/// `ex:langLabelCount(?unbound, 'en') = SPARQL error` example surfaces. This
/// pins that observable behaviour; it does not exercise oxshacl code.
#[test]
fn an_unbound_argument_makes_the_call_unbound() {
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

#[test]
fn a_body_with_no_output_node_makes_the_call_unbound() {
    // shacl12-sparql: any output count other than exactly one is an error.
    let data = graph(&format!(
        "
ex:firstMember a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ shnex:instancesOf [ shnex:arg 0 ] ] ;
    sh:parameter [ sh:path shnex:arg0 ] .
{}
ex:a a ex:Pair .
ex:b a ex:Pair .",
        constraint(
            "BIND (ex:firstMember(ex:Empty) AS ?none) .
             BIND (ex:firstMember(ex:Pair) AS ?many) .
             BIND (CONCAT(STR(BOUND(?none)), \" \", STR(BOUND(?many))) AS ?value)"
        )
    ));
    let report = validate(&shapes(&data), &data, &ValidationOptions::default()).unwrap();
    assert_eq!(values(&report), [Term::from(Literal::from("false false"))]);
}

#[test]
fn repeated_calls_are_charged_against_one_path_visit_ceiling() {
    // Each call visits the three typed nodes; one call fits under the limit,
    // several together must not. This checks the aggregate outcome; that the
    // bound applies inside each call is unit-tested in `sparql::functions`.
    let data = graph(&format!(
        "{COUNT_INSTANCES}{}
ex:a a ex:Base .
ex:b a ex:Base .
ex:c a ex:Base .
ex:r1 ex:row 1 . ex:r2 ex:row 2 . ex:r3 ex:row 3 . ex:r4 ex:row 4 .
ex:r5 ex:row 5 . ex:r6 ex:row 6 . ex:r7 ex:row 7 . ex:r8 ex:row 8 .",
        constraint("?row ex:row ?n . BIND (ex:countInstances(ex:Base) AS ?value)")
    ));
    let compiled = shapes(&data);
    let single = graph(&format!(
        "{COUNT_INSTANCES}{}
ex:a a ex:Base .
ex:b a ex:Base .
ex:c a ex:Base .",
        constraint("BIND (ex:countInstances(ex:Base) AS ?value)")
    ));
    let mut probe = ValidationOptions::default();
    let mut limit = 0;
    // Find the smallest path-visit limit one call succeeds under.
    loop {
        probe.limits.max_path_visits = limit;
        if validate(&shapes(&single), &single, &probe).is_ok() {
            break;
        }
        limit += 1;
        assert!(
            limit < 10_000,
            "no path-visit limit lets a single call succeed"
        );
    }
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = limit;
    let result = validate(&compiled, &data, &options);
    assert!(
        matches!(
            result,
            Err(ValidationError::LimitExceeded {
                kind: LimitKind::PathVisits,
                ..
            })
        ),
        "eight calls must exceed a ceiling one call fits under: {result:?}"
    );
}

#[test]
fn a_declaration_named_like_a_builtin_cast_does_not_replace_it() {
    let data = graph(&format!(
        "
xsd:integer a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:sparqlExpr \"42\" ] .
{}",
        constraint("BIND (STR(<http://www.w3.org/2001/XMLSchema#integer>(\"7\")) AS ?value)")
    ));
    let report = validate(&shapes(&data), &data, &ValidationOptions::default()).unwrap();
    assert_eq!(values(&report), [Term::from(Literal::from("7"))]);
}

#[test]
fn custom_component_validators_can_call_declared_functions() {
    let data = graph(&format!(
        "{COUNT_INSTANCES}
ex:MinInstancesComponent a sh:ConstraintComponent ;
    sh:parameter [ sh:path ex:minInstances ] ;
    sh:validator [ a sh:SPARQLAskValidator ; sh:ask \"\"\"
PREFIX ex: <http://example.org/>
ASK {{ FILTER (ex:countInstances($value) >= $minInstances) }}\"\"\" ] .
ex:Shape a sh:NodeShape ;
    sh:targetNode ex:Base ;
    ex:minInstances 2 .
ex:a a ex:Base ."
    ));
    let report = validate(&shapes(&data), &data, &ValidationOptions::default()).unwrap();
    assert_eq!(
        report.results().len(),
        1,
        "one instance is below the minimum"
    );
    assert_eq!(
        report.results()[0].value,
        Some(Term::from(oxrdf::NamedNode::new_unchecked(
            "http://example.org/Base"
        )))
    );
}
