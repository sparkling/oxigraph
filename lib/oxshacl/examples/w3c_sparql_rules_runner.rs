#![cfg(feature = "w3c-tests")]
#![allow(clippy::print_stdout)] // Machine-readable test evidence is this runner's output.

use oxrdf::{Dataset, GraphName, NamedOrBlankNode, Quad, Term, Triple};
use oxshacl::{
    GraphSnapshot, ProfileId, ProfileSet, SparqlRuleSet, ValidationOptions, execute_sparql_rules,
};
use oxttl::TurtleParser;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const MF_RESULT: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#result";
const MF_STATUS: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#status";
const SHT_APPROVED: &str = "http://www.w3.org/ns/shacl-test#approved";
const SHT_INFER: &str = "http://www.w3.org/ns/shacl-test#Infer";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        env::args()
            .nth(1)
            .ok_or("usage: w3c_sparql_rules_runner <sparql-rules-tests>")?,
    )
    .canonicalize()?;
    let mut files = Vec::new();
    visit(&root, &mut files)?;
    files.sort();
    let profiles = ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::SparqlExtensions12Subset20260130,
        ProfileId::Rules12Subset20260727,
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
                    "unparsed-sparql-rule-fixture",
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
    let expected_head = one_object(graph, test, MF_RESULT).ok_or("test has no result list")?;
    let expected = rdf_list(graph, &expected_head)?
        .into_iter()
        .map(|head| {
            let terms = rdf_list(graph, &head)?;
            let [subject, predicate, object] = terms.as_slice() else {
                return Err("expected inference entry is not a three-term list".to_owned());
            };
            let subject = as_subject(subject.clone())
                .ok_or("expected triple subject is not an IRI or blank node")?;
            let Term::NamedNode(predicate) = predicate else {
                return Err("expected triple predicate is not an IRI".to_owned());
            };
            Ok(Triple::new(subject, predicate.clone(), object.clone()))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let snapshot = GraphSnapshot::default_graph(graph.clone());
    let rules =
        SparqlRuleSet::compile(&snapshot, profiles, options).map_err(|error| error.to_string())?;
    let execution =
        execute_sparql_rules(&rules, &snapshot, options).map_err(|error| error.to_string())?;
    let actual = execution.inference().triples().collect::<Vec<_>>();
    if same_graph(&actual, &expected) {
        Ok(())
    } else {
        Err(format!("expected {expected:?}, actual {actual:?}"))
    }
}

fn same_graph(actual: &[Triple], expected: &[Triple]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .all(|triple| expected.iter().any(|candidate| candidate == triple))
}

fn entries(graph: &Dataset) -> Vec<NamedOrBlankNode> {
    graph
        .iter()
        .filter(|quad| {
            quad.predicate.as_str() == RDF_TYPE
                && matches!(&quad.object, Term::NamedNode(node) if node.as_str() == SHT_INFER)
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
