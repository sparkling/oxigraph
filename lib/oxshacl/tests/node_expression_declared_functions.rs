#![cfg(feature = "w3c-tests")]
#![expect(
    clippy::tests_outside_test_module,
    reason = "integration tests exercise SHACL-declared functions called from node expressions"
)]

//! `sh:ListParameterExpressionFunction` declarations called by IRI from
//! `sh:select` and `sh:sparqlExpr` node expressions, including nested,
//! textually recursive and shape-mediated recursive calls, the memory held by
//! copies of a large data graph, and limits parked before a constraint query
//! fails. These fixtures are independent of the pinned W3C cases.

use oxrdf::{BlankNode, Dataset, GraphName, Literal, NamedNode, Quad, Term};
use oxshacl::{
    ExpressionEnvironment, GraphSnapshot, LimitKind, ProfileId, ProfileSet, ShapesGraph,
    ValidationError, ValidationOptions, compile_node_expression, evaluate_expression, validate,
};
use oxttl::TurtleParser;
use std::time::Duration;

const EX: &str = "http://example.org/";
const SELECT: &str = "http://www.w3.org/ns/shacl#select";
const SPARQL_EXPR: &str = "http://www.w3.org/ns/shacl#sparqlExpr";
const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const PREFIXES: &str = "
@prefix ex: <http://example.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix shnex: <http://www.w3.org/ns/shacl-node-expr#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
";

const FUNCTIONS: &str = r##"
ex:countInstances a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ shnex:count [ shnex:instancesOf [ shnex:arg 0 ] ] ] ;
    sh:parameter [ sh:path shnex:arg0 ; sh:nodeKind sh:IRI ] .

ex:members a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ shnex:instancesOf [ shnex:arg 0 ] ] ;
    sh:parameter [ sh:path shnex:arg0 ] .

ex:whoami a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ shnex:var "focusNode" ] .

ex:one a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:sparqlExpr "1" ] .

ex:outerSelect a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:select """PREFIX ex: <http://example.org/>
SELECT ?v WHERE { BIND (ex:countInstances(ex:Base) AS ?v) }""" ] .

ex:outerExpr a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:sparqlExpr "<http://example.org/countInstances>(<http://example.org/Base>)" ] .

ex:selfSelect a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:select """PREFIX ex: <http://example.org/>
SELECT ?v WHERE { BIND (ex:selfSelect() AS ?v) }""" ] .

ex:selfExpr a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:sparqlExpr "<http://example.org/selfExpr>()" ] .

ex:ping a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:select """PREFIX ex: <http://example.org/>
SELECT ?v WHERE { BIND (ex:pong() AS ?v) }""" ] .

ex:pong a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ sh:sparqlExpr "<http://example.org/ping>()" ] .
"##;

const CONSTRAINT_HEAD: &str = r##"
ex:Shape a sh:NodeShape ;
    sh:targetNode ex:Focus ;
    sh:sparql [ sh:select """PREFIX ex: <http://example.org/>
SELECT $this ?value WHERE { "##;

const CONSTRAINT_TAIL: &str = r##" }""" ] .
"##;

/// A declared function whose body checks conformance to a shape, and a shape
/// whose `sh:sparql` constraint calls that function again. No function text
/// calls itself: the cycle only exists through the shape.
const SHAPE_CYCLE: &str = r##"
ex:viaShape a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ shnex:conformsToShape ( [ shnex:arg 0 ] [ shnex:arg 1 ] ) ] .

ex:CycleShape a sh:NodeShape ;
    sh:targetNode ex:Focus ;
    sh:sparql [ sh:select """PREFIX ex: <http://example.org/>
SELECT $this ?value WHERE { BIND (ex:viaShape($this, ex:CycleShape) AS ?value) }""" ] .
"##;

/// A declared function whose body checks conformance to a shape, and a shape
/// whose `sh:sparql` constraint calls a declared function and then requests
/// validation failure on the same row. The call parks a limit before the row
/// fails, so the limit must survive the failing row.
const FAILING_CONSTRAINT: &str = r##"
ex:checks a sh:ListParameterExpressionFunction ;
    rdfs:subClassOf sh:ListParameterExpression ;
    sh:bodyExpression [ shnex:conformsToShape ( [ shnex:arg 0 ] [ shnex:arg 1 ] ) ] .

ex:FailShape a sh:NodeShape ;
    sh:targetNode ex:Focus ;
    sh:sparql [ sh:select """PREFIX ex: <http://example.org/>
SELECT $this ?value ?failure WHERE {
    BIND (ex:countInstances(ex:Base) AS ?value) .
    BIND (true AS ?failure)
}""" ] .
"##;

type Outcome = Result<Vec<Term>, ValidationError>;

fn iri(local: &str) -> NamedNode {
    NamedNode::new_unchecked(format!("{EX}{local}"))
}

fn integer(value: i64) -> Term {
    Term::from(Literal::from(value))
}

fn parse(body: &str) -> Dataset {
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
    dataset
}

fn load_data(body: &str) -> GraphSnapshot {
    GraphSnapshot::default_graph(parse(body))
}

fn load_shapes(body: &str) -> ShapesGraph {
    ShapesGraph::compile(
        &load_data(body),
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

fn evaluate(
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    predicate: &str,
    text: &str,
    options: &ValidationOptions,
) -> Outcome {
    let expression = BlankNode::new_unchecked("expression");
    let mut source = Dataset::new();
    source.insert(Quad::new(
        expression.clone(),
        NamedNode::new_unchecked(predicate.to_owned()),
        Literal::from(text),
        GraphName::DefaultGraph,
    ));
    let compiled = compile_node_expression(
        &GraphSnapshot::default_graph(source),
        &Term::BlankNode(expression),
        &ValidationOptions::default(),
    )
    .unwrap();
    evaluate_expression(
        &compiled,
        shapes,
        data,
        &Term::NamedNode(iri("Focus")),
        &ExpressionEnvironment::default(),
        options,
    )
}

fn select(
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    body: &str,
    options: &ValidationOptions,
) -> Outcome {
    let query = format!("PREFIX ex: <{EX}> SELECT ?v WHERE {{ {body} }}");
    evaluate(shapes, data, SELECT, &query, options)
}

fn expr(
    shapes: &ShapesGraph,
    data: &GraphSnapshot,
    text: &str,
    options: &ValidationOptions,
) -> Outcome {
    evaluate(shapes, data, SPARQL_EXPR, text, options)
}

fn assert_limit(result: &Outcome, expected_kind: LimitKind, expected_limit: usize) {
    assert!(
        matches!(
            result,
            Err(ValidationError::LimitExceeded { kind, limit })
                if *kind == expected_kind && *limit == expected_limit
        ),
        "expected {expected_kind:?} limit {expected_limit}, got {result:?}"
    );
}

fn minimal_ceiling(highest: usize, mut passes: impl FnMut(usize) -> bool) -> usize {
    assert!(passes(highest), "a ceiling of {highest} is not enough");
    let (mut low, mut high) = (0, highest);
    while low < high {
        let middle = low + (high - low) / 2;
        if passes(middle) {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    low
}

/// A data graph of `count` typed instances of `ex:Base`.
fn instances(count: usize) -> GraphSnapshot {
    let mut dataset = Dataset::new();
    for index in 0..count {
        dataset.insert(Quad::new(
            iri(&format!("n{index}")),
            NamedNode::new_unchecked(RDF_TYPE),
            iri("Base"),
            GraphName::DefaultGraph,
        ));
    }
    GraphSnapshot::default_graph(dataset)
}

fn heavy_data() -> GraphSnapshot {
    instances(1500)
}

fn heavy_body() -> String {
    let rows = (1..=40)
        .map(|row| row.to_string())
        .collect::<Vec<_>>()
        .join(" ");
    format!("VALUES ?n {{ {rows} }} BIND (ex:countInstances(ex:Base) AS ?v)")
}

fn one_calls(count: usize) -> String {
    let calls = vec![format!("STR(<{EX}one>())"); count].join(", ");
    format!("CONCAT({calls})")
}

#[test]
fn select_and_sparql_expr_call_the_same_declared_function() {
    let shapes = load_shapes(FUNCTIONS);
    let data = load_data("ex:a a ex:Base . ex:b a ex:Base . ex:c a ex:Other .");
    let options = ValidationOptions::default();
    for (class, count) in [("Base", 2), ("Other", 1), ("Absent", 0)] {
        assert_eq!(
            select(
                &shapes,
                &data,
                &format!("BIND (ex:countInstances(ex:{class}) AS ?v)"),
                &options,
            )
            .unwrap(),
            vec![integer(count)],
            "sh:select with class {class}"
        );
        assert_eq!(
            expr(
                &shapes,
                &data,
                &format!("<{EX}countInstances>(<{EX}{class}>)"),
                &options,
            )
            .unwrap(),
            vec![integer(count)],
            "sh:sparqlExpr with class {class}"
        );
    }
    // shacl12-sparql: the focus node inside a function body is the function IRI.
    let function = vec![Term::from(iri("whoami"))];
    assert_eq!(
        select(&shapes, &data, "BIND (ex:whoami() AS ?v)", &options).unwrap(),
        function
    );
    assert_eq!(
        expr(&shapes, &data, &format!("<{EX}whoami>()"), &options).unwrap(),
        function
    );
}

#[test]
fn unbound_zero_many_and_failing_calls_are_errors_of_the_call() {
    let shapes = load_shapes(FUNCTIONS);
    let data = load_data("ex:a a ex:Pair . ex:b a ex:Pair .");
    let options = ValidationOptions::default();
    let body = r#"BIND (ex:members(ex:Empty) AS ?none) .
        BIND (ex:members(ex:Pair) AS ?many) .
        BIND (ex:members("not a class") AS ?bad) .
        BIND (ex:countInstances(?missing) AS ?unbound) .
        BIND (CONCAT(STR(BOUND(?none)), " ", STR(BOUND(?many)), " ", STR(BOUND(?bad)), " ", STR(BOUND(?unbound))) AS ?v)"#;
    assert_eq!(
        select(&shapes, &data, body, &options).unwrap(),
        vec![Term::from(Literal::from("false false false false"))]
    );
    for text in [
        format!("<{EX}members>(<{EX}Empty>)"),
        format!("<{EX}members>(<{EX}Pair>)"),
        format!("<{EX}members>(\"not a class\")"),
        format!("<{EX}countInstances>(?missing)"),
    ] {
        let result = expr(&shapes, &data, &text, &options);
        // sh:sparqlExpr compiles to SparqlSelect; an unbound call leaves
        // zero bound columns, preserving the existing SELECT row-shape error.
        assert!(
            matches!(&result, Err(ValidationError::IllFormed(message))
                if message == "node-expression SELECT must bind exactly one variable per row"),
            "{text}: {result:?}"
        );
    }
}

#[test]
fn declared_functions_read_only_the_supplied_data_graph() {
    let shapes = load_shapes(FUNCTIONS);
    let graph = iri("data");
    let mut dataset = Dataset::new();
    for index in 0..5 {
        dataset.insert(Quad::new(
            iri(&format!("decoy{index}")),
            NamedNode::new_unchecked(RDF_TYPE),
            iri("Base"),
            GraphName::DefaultGraph,
        ));
    }
    for index in 0..2 {
        dataset.insert(Quad::new(
            iri(&format!("member{index}")),
            NamedNode::new_unchecked(RDF_TYPE),
            iri("Base"),
            GraphName::NamedNode(graph.clone()),
        ));
    }
    let data = GraphSnapshot::new(dataset, GraphName::NamedNode(graph));
    let options = ValidationOptions::default();
    for callee in ["countInstances(ex:Base)", "outerSelect()", "outerExpr()"] {
        assert_eq!(
            select(
                &shapes,
                &data,
                &format!("BIND (ex:{callee} AS ?v)"),
                &options
            )
            .unwrap(),
            vec![integer(2)],
            "sh:select calling {callee}"
        );
    }
    for callee in [
        "countInstances>(<http://example.org/Base>)",
        "outerSelect>()",
    ] {
        assert_eq!(
            expr(&shapes, &data, &format!("<{EX}{callee}"), &options).unwrap(),
            vec![integer(2)],
            "sh:sparqlExpr calling {callee}"
        );
    }
}

#[test]
fn declared_functions_can_call_declared_functions() {
    let shapes = load_shapes(FUNCTIONS);
    let data = load_data("ex:a a ex:Base . ex:b a ex:Base .");
    let options = ValidationOptions::default();
    for callee in ["outerSelect", "outerExpr"] {
        assert_eq!(
            select(
                &shapes,
                &data,
                &format!("BIND (ex:{callee}() AS ?v)"),
                &options
            )
            .unwrap(),
            vec![integer(2)],
            "sh:select calling {callee}"
        );
        assert_eq!(
            expr(&shapes, &data, &format!("<{EX}{callee}>()"), &options).unwrap(),
            vec![integer(2)],
            "sh:sparqlExpr calling {callee}"
        );
    }
}

#[test]
fn direct_and_mutual_text_recursion_stop_at_the_configured_depth() {
    let shapes = load_shapes(FUNCTIONS);
    let data = load_data("");
    let mut options = ValidationOptions::default();
    options.limits.max_recursion_depth = 8;
    for callee in ["selfSelect", "selfExpr", "ping", "pong"] {
        assert_limit(
            &select(
                &shapes,
                &data,
                &format!("BIND (ex:{callee}() AS ?v)"),
                &options,
            ),
            LimitKind::RecursionDepth,
            8,
        );
        assert_limit(
            &expr(&shapes, &data, &format!("<{EX}{callee}>()"), &options),
            LimitKind::RecursionDepth,
            8,
        );
    }
}

#[test]
fn recursion_stops_at_the_default_depth() {
    // Every level of this recursion runs a complete nested SPARQL evaluation,
    // so this also checks that the stack does not grow with the depth.
    let shapes = load_shapes(FUNCTIONS);
    let data = load_data("");
    let options = ValidationOptions::default();
    let limit = options.limits.max_recursion_depth;
    for callee in ["selfSelect", "selfExpr", "ping", "pong"] {
        assert_limit(
            &select(
                &shapes,
                &data,
                &format!("BIND (ex:{callee}() AS ?v)"),
                &options,
            ),
            LimitKind::RecursionDepth,
            limit,
        );
        assert_limit(
            &expr(&shapes, &data, &format!("<{EX}{callee}>()"), &options),
            LimitKind::RecursionDepth,
            limit,
        );
    }
}

#[test]
fn repeated_calls_share_one_solution_ceiling() {
    let shapes = load_shapes(FUNCTIONS);
    let data = load_data("");
    let ceiling = |limit: usize| {
        let mut options = ValidationOptions::default();
        options.limits.max_query_solutions = limit;
        options
    };

    // Six rows plus six calls of one solution each cannot fit under six.
    let rows = "VALUES ?n { 1 2 3 4 5 6 } BIND (ex:one() AS ?v)";
    let needed = minimal_ceiling(64, |limit| {
        select(&shapes, &data, rows, &ceiling(limit)).is_ok()
    });
    assert!(needed >= 12, "calls did not add to the ceiling: {needed}");
    assert_limit(
        &select(&shapes, &data, rows, &ceiling(needed - 1)),
        LimitKind::QuerySolutions,
        needed - 1,
    );
    assert_eq!(
        select(&shapes, &data, rows, &ceiling(needed))
            .unwrap()
            .len(),
        6
    );

    // One scalar solution plus three calls.
    let text = one_calls(3);
    let needed = minimal_ceiling(64, |limit| {
        expr(&shapes, &data, &text, &ceiling(limit)).is_ok()
    });
    assert!(needed >= 4, "calls did not add to the ceiling: {needed}");
    assert_limit(
        &expr(&shapes, &data, &text, &ceiling(needed - 1)),
        LimitKind::QuerySolutions,
        needed - 1,
    );
    assert_eq!(
        expr(&shapes, &data, &text, &ceiling(needed)).unwrap(),
        vec![Term::from(Literal::from("111"))]
    );
}

#[test]
fn repeated_calls_share_one_memory_ceiling() {
    let shapes = load_shapes(FUNCTIONS);
    let data = load_data("");
    let ceiling = |limit: usize| {
        let mut options = ValidationOptions::default();
        options.limits.max_estimated_memory_bytes = limit;
        options
    };
    let needed = |count: usize| {
        let text = one_calls(count);
        minimal_ceiling(1 << 20, |limit| {
            expr(&shapes, &data, &text, &ceiling(limit)).is_ok()
        })
    };
    let single = needed(1);
    let many = needed(6);
    assert!(many > single, "calls did not add to the ceiling");
    assert_limit(
        &expr(&shapes, &data, &one_calls(6), &ceiling(many - 1)),
        LimitKind::EstimatedMemory,
        many - 1,
    );
}

#[test]
fn cancellation_inside_repeated_calls_is_typed() {
    let shapes = load_shapes(FUNCTIONS);
    let data = heavy_data();
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = usize::MAX / 2;
    let token = options.cancellation_token.clone();
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        token.cancel();
    });
    let result = select(&shapes, &data, &heavy_body(), &options);
    canceller.join().unwrap();
    assert!(
        matches!(result, Err(ValidationError::Cancelled)),
        "cancellation was hidden: {result:?}"
    );
}

#[test]
fn deadline_inside_repeated_calls_is_typed() {
    let shapes = load_shapes(FUNCTIONS);
    let data = heavy_data();
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = usize::MAX / 2;
    options.limits.timeout = Some(Duration::from_millis(150));
    let result = select(&shapes, &data, &heavy_body(), &options);
    assert_limit(&result, LimitKind::Time, 150);
}

fn constraint_shapes(body: &str) -> ShapesGraph {
    load_shapes(&format!(
        "{FUNCTIONS}{CONSTRAINT_HEAD}{body}{CONSTRAINT_TAIL}"
    ))
}

#[test]
fn constraint_registrations_still_work_and_stay_bounded() {
    let data = load_data("ex:a a ex:Base . ex:b a ex:Base .");
    let shapes = constraint_shapes("BIND (ex:countInstances(ex:Base) AS ?value)");
    let report = validate(&shapes, &data, &ValidationOptions::default()).unwrap();
    let values = report
        .results()
        .iter()
        .filter_map(|result| result.value.clone())
        .collect::<Vec<_>>();
    assert_eq!(values, vec![integer(2)]);

    let shapes = constraint_shapes("BIND (ex:selfSelect() AS ?value)");
    let mut options = ValidationOptions::default();
    options.limits.max_recursion_depth = 8;
    let result = validate(&shapes, &data, &options);
    assert!(
        matches!(
            result,
            Err(ValidationError::LimitExceeded {
                kind: LimitKind::RecursionDepth,
                limit: 8,
            })
        ),
        "constraint recursion was not bounded: {result:?}"
    );
}

/// Enters the `ex:viaShape` / `ex:CycleShape` cycle from a `sh:sparql`
/// constraint and from both node-expression forms. Each pass through the
/// constraint must consume recursion bound, so every entry stops with the
/// configured depth rather than the deadline.
fn assert_shape_mediated_recursion_stops_at(options: &ValidationOptions) {
    let limit = options.limits.max_recursion_depth;
    let shapes = load_shapes(&format!("{FUNCTIONS}{SHAPE_CYCLE}"));
    let data = load_data("");
    let constraint = validate(&shapes, &data, options).map(|report| {
        report
            .results()
            .iter()
            .filter_map(|result| result.value.clone())
            .collect::<Vec<_>>()
    });
    assert_limit(&constraint, LimitKind::RecursionDepth, limit);
    assert_limit(
        &select(
            &shapes,
            &data,
            "BIND (ex:viaShape(ex:Focus, ex:CycleShape) AS ?v)",
            options,
        ),
        LimitKind::RecursionDepth,
        limit,
    );
    assert_limit(
        &expr(
            &shapes,
            &data,
            &format!("<{EX}viaShape>(<{EX}Focus>, <{EX}CycleShape>)"),
            options,
        ),
        LimitKind::RecursionDepth,
        limit,
    );
}

#[test]
fn shape_mediated_recursion_stops_at_the_configured_depth() {
    let mut options = ValidationOptions::default();
    options.limits.max_recursion_depth = 8;
    assert_shape_mediated_recursion_stops_at(&options);
}

#[test]
fn shape_mediated_recursion_stops_at_the_default_depth() {
    let options = ValidationOptions::default();
    assert_eq!(
        options.limits.max_recursion_depth, 64,
        "this test pins the default recursion depth"
    );
    assert_shape_mediated_recursion_stops_at(&options);
}

/// Every recursion level copies the data graph for its function registration
/// and builds an isolated dataset for its query. Those copies are live
/// together, so the memory ceiling must stop a deep recursion over a large
/// graph even where the recursion bound alone would still allow it.
#[test]
fn nested_copies_of_a_large_data_graph_stay_under_the_memory_ceiling() {
    let shapes = constraint_shapes("BIND (ex:selfSelect() AS ?value)");
    let data = instances(4_000);
    let ceiling = 24 << 20;
    let options = |depth: usize| {
        let mut options = ValidationOptions::default();
        options.limits.max_recursion_depth = depth;
        options.limits.max_estimated_memory_bytes = ceiling;
        options
    };

    // One level of copies fits without spending the unrelated path-scan budget.
    assert_eq!(
        select(&shapes, &data, "BIND (ex:whoami() AS ?v)", &options(64),).unwrap(),
        vec![Term::NamedNode(iri("whoami"))]
    );
    assert_limit(
        &select(&shapes, &data, "BIND (ex:selfSelect() AS ?v)", &options(8)),
        LimitKind::RecursionDepth,
        8,
    );

    // The default depth needs more live copies than the ceiling holds.
    assert_limit(
        &select(&shapes, &data, "BIND (ex:selfSelect() AS ?v)", &options(64)),
        LimitKind::EstimatedMemory,
        ceiling,
    );
    assert_limit(
        &expr(&shapes, &data, &format!("<{EX}selfExpr>()"), &options(64)),
        LimitKind::EstimatedMemory,
        ceiling,
    );
    let constraint = validate(&shapes, &data, &options(64)).map(|report| {
        report
            .results()
            .iter()
            .filter_map(|result| result.value.clone())
            .collect::<Vec<_>>()
    });
    assert_limit(&constraint, LimitKind::EstimatedMemory, ceiling);
}

/// Constraint queries for different focus nodes run one after another, so
/// their copies of the data graph are never live together. Only the copies of
/// one query count against the ceiling; evaluating many must not add them up.
#[test]
fn sequential_constraint_queries_do_not_accumulate_their_copies() {
    let targets = (0..20)
        .map(|index| format!("ex:t{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let shapes = load_shapes(&format!(
        r##"{FUNCTIONS}
ex:Shape a sh:NodeShape ;
    sh:targetNode {targets} ;
    sh:sparql [ sh:select """PREFIX ex: <http://example.org/>
SELECT $this ?value WHERE {{ BIND (ex:whoami() AS ?value) }}""" ] .
"##
    ));
    let data = instances(4_000);
    let mut options = ValidationOptions::default();
    // One query's copies fit; twenty queries' copies together would not.
    options.limits.max_estimated_memory_bytes = 4 << 20;
    let report = validate(&shapes, &data, &options).unwrap();
    assert_eq!(report.results().len(), 20);
}

/// A declared function called inside a constraint query parks a limit, and
/// then the same row requests validation failure. The parked limit must win,
/// whether the constraint is reached directly or from inside another declared
/// function's body through `shnex:conformsToShape`.
#[test]
fn a_limit_parked_before_a_constraint_row_fails_still_stops_evaluation() {
    let shapes = load_shapes(&format!("{FUNCTIONS}{FAILING_CONSTRAINT}"));
    let data = load_data("ex:a a ex:Base .");
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = 0;
    assert_limit(
        &select(
            &shapes,
            &data,
            "BIND (ex:checks(ex:Focus, ex:FailShape) AS ?v)",
            &options,
        ),
        LimitKind::PathVisits,
        0,
    );
    assert_limit(
        &expr(
            &shapes,
            &data,
            &format!("<{EX}checks>(<{EX}Focus>, <{EX}FailShape>)"),
            &options,
        ),
        LimitKind::PathVisits,
        0,
    );

    // Validation spends the only visit scanning the one data triple for
    // `sh:shape`, which leaves nothing for the call inside the constraint.
    options.limits.max_path_visits = 1;
    let direct = validate(&shapes, &data, &options).map(|report| report.results().len());
    assert!(
        matches!(
            direct,
            Err(ValidationError::LimitExceeded {
                kind: LimitKind::PathVisits,
                limit: 1,
            })
        ),
        "the parked limit was lost to the failing row: {direct:?}"
    );
}
