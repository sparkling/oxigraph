#![cfg(feature = "w3c-tests")]
#![allow(clippy::print_stdout)] // Machine-readable test evidence is this runner's output.

use oxrdf::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    ExpressionEnvironment, GraphSnapshot, ProfileId, ProfileSet, ShapesGraph, ValidationOptions,
    compile_node_expression, evaluate_expression,
};
use oxttl::TurtleParser;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const MF_ACTION: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#action";
const MF_RESULT: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#result";
const MF_STATUS: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#status";
const SHT_APPROVED: &str = "http://www.w3.org/ns/shacl-test#approved";
const SHT_EVAL: &str = "http://www.w3.org/ns/shacl-test#EvalNodeExpr";
const SHT_EXPR: &str = "http://www.w3.org/ns/shacl-test#nodeExpr";
const SHT_FOCUS: &str = "http://www.w3.org/ns/shacl-test#focusNode";
const SHT_IGNORE_ORDER: &str = "http://www.w3.org/ns/shacl-test#ignoreOrder";
const SHT_SCOPE: &str = "http://www.w3.org/ns/shacl-test#scope-";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        env::args()
            .nth(1)
            .ok_or("usage: w3c_node_expr_runner <node-expr-tests>")?,
    )
    .canonicalize()?;
    let mut files = Vec::new();
    visit(&root, &mut files)?;
    files.sort();
    let profiles = ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::NodeExpressions12Subset20260108,
        ProfileId::SparqlExtensions12Subset20260130,
    ])?;
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = 20_000_000;
    let mut totals = Totals::default();
    for file in files {
        let graph = match parse_turtle(&file) {
            Ok(graph) => graph,
            Err(error) => {
                totals.discovered += 1;
                emit(
                    "FAIL",
                    &root,
                    &file,
                    "unparsed-node-expression-fixture",
                    &error.to_string(),
                );
                totals.failed += 1;
                continue;
            }
        };
        for test in entries(&graph) {
            totals.discovered += 1;
            match run_case(&graph, &test, profiles.clone(), &options) {
                Ok(()) => {
                    totals.passed += 1;
                    emit("PASS", &root, &file, &case_id(&root, &test), "");
                }
                Err(error) => {
                    totals.failed += 1;
                    emit("FAIL", &root, &file, &case_id(&root, &test), &error);
                }
            }
        }
    }
    println!(
        "SUMMARY discovered={} eligible={} passed={} unsupported=0 failed={} excluded=0",
        totals.discovered, totals.discovered, totals.passed, totals.failed
    );
    if totals.discovered == 0 || totals.failed > 0 {
        std::process::exit(1);
    }
    Ok(())
}

fn run_case(
    graph: &Dataset,
    test: &NamedOrBlankNode,
    profiles: ProfileSet,
    options: &ValidationOptions,
) -> Result<(), String> {
    let action = one_object(graph, test, MF_ACTION)
        .and_then(as_subject)
        .ok_or("test action is not a single node")?;
    let expression_term =
        one_object(graph, &action, SHT_EXPR).ok_or("action has no single node expression")?;
    let expected_head = one_object(graph, test, MF_RESULT).ok_or("test has no result list")?;
    let expected = rdf_list(graph, &expected_head)?;
    let snapshot = GraphSnapshot::default_graph(graph.clone());
    let shapes =
        ShapesGraph::compile(&snapshot, profiles, options).map_err(|error| error.to_string())?;
    let expression = compile_node_expression(&snapshot, &expression_term, options)
        .map_err(|error| error.to_string())?;
    let focus_node = one_object(graph, &action, SHT_FOCUS);
    let focus = focus_node
        .clone()
        .unwrap_or_else(|| Term::NamedNode(NamedNode::new_unchecked("urn:oxshacl:no-focus")));
    let mut environment = ExpressionEnvironment::default();
    if focus_node.is_some() {
        environment.insert("focusNode", focus.clone());
    } else {
        environment.unbind("focusNode");
    }
    for quad in graph.quads_for_subject(&action) {
        if let Some(variable) = quad.predicate.as_str().strip_prefix(SHT_SCOPE) {
            environment.insert(variable, quad.object);
        }
    }
    let actual = evaluate_expression(
        &expression,
        &shapes,
        &snapshot,
        &focus,
        &environment,
        options,
    )
    .map_err(|error| error.to_string())?;
    let ignore_order = matches!(
        one_object(graph, &action, SHT_IGNORE_ORDER),
        Some(Term::Literal(literal)) if literal.value() == "true"
    );
    if equivalent(&actual, &expected, ignore_order) {
        Ok(())
    } else {
        Err(format!("expected {expected:?}, actual {actual:?}"))
    }
}

fn equivalent(actual: &[Term], expected: &[Term], ignore_order: bool) -> bool {
    if !ignore_order {
        return actual.len() == expected.len()
            && actual
                .iter()
                .zip(expected)
                .all(|(actual, expected)| equivalent_term(actual, expected));
    }
    if actual.len() != expected.len() {
        return false;
    }
    let mut matched = vec![false; expected.len()];
    for actual in actual {
        let Some(index) = expected.iter().enumerate().find_map(|(index, expected)| {
            (!matched[index] && equivalent_term(actual, expected)).then_some(index)
        }) else {
            return false;
        };
        matched[index] = true;
    }
    true
}

fn equivalent_term(actual: &Term, expected: &Term) -> bool {
    if actual == expected {
        return true;
    }
    let (Term::Literal(actual), Term::Literal(expected)) = (actual, expected) else {
        return false;
    };
    if actual.datatype() != expected.datatype() {
        return false;
    }
    let datatype = actual.datatype().as_str();
    let Some(local) = datatype.strip_prefix("http://www.w3.org/2001/XMLSchema#") else {
        return false;
    };
    if !matches!(
        local,
        "decimal"
            | "double"
            | "float"
            | "integer"
            | "long"
            | "int"
            | "short"
            | "byte"
            | "nonNegativeInteger"
            | "positiveInteger"
            | "nonPositiveInteger"
            | "negativeInteger"
            | "unsignedLong"
            | "unsignedInt"
            | "unsignedShort"
            | "unsignedByte"
    ) {
        return false;
    }
    match (
        actual.value().parse::<f64>(),
        expected.value().parse::<f64>(),
    ) {
        (Ok(actual), Ok(expected)) => actual == expected || (actual.is_nan() && expected.is_nan()),
        _ => false,
    }
}

fn entries(graph: &Dataset) -> Vec<NamedOrBlankNode> {
    graph
        .iter()
        .filter(|quad| {
            quad.predicate.as_str() == RDF_TYPE
                && matches!(&quad.object, Term::NamedNode(node) if node.as_str() == SHT_EVAL)
                && objects(graph, &quad.subject, MF_STATUS).iter().any(
                    |term| matches!(term, Term::NamedNode(node) if node.as_str() == SHT_APPROVED),
                )
        })
        .map(|quad| quad.subject)
        .collect()
}

fn rdf_list(graph: &Dataset, head: &Term) -> Result<Vec<Term>, String> {
    let mut current = head.clone();
    let mut output = Vec::new();
    for _ in 0..100_000 {
        if matches!(&current, Term::NamedNode(node) if node.as_str() == RDF_NIL) {
            return Ok(output);
        }
        let node = as_subject(current).ok_or("RDF list cell is not a node")?;
        output.push(one_object(graph, &node, RDF_FIRST).ok_or("RDF list has no rdf:first")?);
        current = one_object(graph, &node, RDF_REST).ok_or("RDF list has no rdf:rest")?;
    }
    Err("RDF list exceeds 100000 cells".to_owned())
}

fn parse_turtle(path: &Path) -> Result<Dataset, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    let parser = TurtleParser::new()
        .with_max_buffer_size(16 * 1024 * 1024)
        .with_base_iri(&format!("file://{}", path.to_string_lossy()))?;
    let mut graph = Dataset::new();
    for triple in parser.for_slice(&bytes) {
        let triple = triple?;
        graph.insert(Quad::new(
            triple.subject,
            triple.predicate,
            triple.object,
            GraphName::DefaultGraph,
        ));
    }
    Ok(graph)
}

fn objects(graph: &Dataset, subject: &NamedOrBlankNode, predicate: &str) -> Vec<Term> {
    graph
        .quads_for_subject(subject)
        .filter(|quad| quad.predicate.as_str() == predicate)
        .map(|quad| quad.object)
        .collect()
}

fn one_object(graph: &Dataset, subject: &NamedOrBlankNode, predicate: &str) -> Option<Term> {
    let values = objects(graph, subject, predicate);
    (values.len() == 1).then(|| values[0].clone())
}

fn as_subject(term: Term) -> Option<NamedOrBlankNode> {
    match term {
        Term::NamedNode(node) => Some(node.into()),
        Term::BlankNode(node) => Some(node.into()),
        Term::Literal(_) => None,
        #[cfg(feature = "rdf-12")]
        Term::Triple(_) => None,
    }
}

fn visit(directory: &Path, output: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            visit(&entry.path(), output)?;
        } else if entry.path().extension().is_some_and(|value| value == "ttl") {
            output.push(entry.path());
        }
    }
    Ok(())
}

fn emit(kind: &str, root: &Path, file: &Path, test_id: &str, detail: &str) {
    println!(
        "{kind}\t{}\t{}\t{}",
        file.strip_prefix(root).unwrap_or(file).display(),
        test_id.replace(['\r', '\n', '\t'], " "),
        detail.replace(['\r', '\n', '\t'], " ")
    );
}

fn case_id(root: &Path, test: &NamedOrBlankNode) -> String {
    let value = test.to_string();
    let prefix = format!("<file://{}/", root.display());
    value
        .strip_prefix(&prefix)
        .and_then(|value| value.strip_suffix('>'))
        .map_or(value.clone(), ToOwned::to_owned)
}

#[derive(Default)]
struct Totals {
    discovered: usize,
    passed: usize,
    failed: usize,
}
