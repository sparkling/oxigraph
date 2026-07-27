#![cfg(feature = "w3c-tests")]
#![allow(clippy::print_stdout)] // Machine-readable test evidence is this runner's output.

use oxrdf::{Dataset, GraphName, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    CompileError, GraphSnapshot, ProfileId, ProfileSet, ShapesGraph, ValidationError,
    ValidationOptions, validate,
};
use oxttl::TurtleParser;
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[path = "w3c_runner/report_compare.rs"]
mod report_compare;

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SHT_VALIDATE: &str = "http://www.w3.org/ns/shacl-test#Validate";
const SHT_FAILURE: &str = "http://www.w3.org/ns/shacl-test#Failure";
const SHT_DATA_GRAPH: &str = "http://www.w3.org/ns/shacl-test#dataGraph";
const SHT_SHAPES_GRAPH: &str = "http://www.w3.org/ns/shacl-test#shapesGraph";
const MF_ACTION: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#action";
const MF_RESULT: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#result";
const MF_STATUS: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#status";
const SHT_APPROVED: &str = "http://www.w3.org/ns/shacl-test#approved";
const SH_CONFORMS: &str = "http://www.w3.org/ns/shacl#conforms";
const SH_CONFORMANCE_DISALLOWS: &str = "http://www.w3.org/ns/shacl#conformanceDisallows";
const IN_002_HASH: &str = "9fbabda6e0d4eddbbf0cbb71b83ac1ba434368a5fca30869fc3e6f06d07e640d";
const IN_003_HASH: &str = "3b6f11aec2bdb76b042b4b788064036ef4e9d3ae736efed28b3644b4caad4db3";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        env::args()
            .nth(1)
            .ok_or("usage: w3c_runner <shacl12-test-suite/tests>")?,
    )
    .canonicalize()?;
    let mut files = Vec::new();
    for category in ["core", "node-expr", "sparql"] {
        visit(&root.join(category), &mut files)?;
    }
    files.sort();
    let profiles = ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::NodeExpressions12Subset20260108,
        ProfileId::SparqlExtensions12Subset20260130,
    ])?;
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = 20_000_000;
    options.limits.timeout = Some(std::time::Duration::from_secs(120));
    let mut totals = Totals::default();
    for file in files {
        let wrapper = match parse_turtle(&file) {
            Ok(graph) => graph,
            Err(error) => {
                totals.discovered += 1;
                if is_in_003_exclusion(&file)? {
                    totals.excluded += 1;
                    emit(
                        "EXCLUDED",
                        &root,
                        &file,
                        "core/node/in-003",
                        &format!(
                            "fixture-sha256={IN_003_HASH}; undeclared shsh prefix makes the pinned Turtle fixture invalid: {error}"
                        ),
                    );
                } else {
                    totals.eligible += 1;
                    totals.failed += 1;
                    emit(
                        "FAIL",
                        &root,
                        &file,
                        "unparsed-approved-case",
                        &error.to_string(),
                    );
                }
                continue;
            }
        };
        for test in validate_entries(&wrapper) {
            totals.discovered += 1;
            let test_id = case_id(&root, &test);
            let result = run_entry(&file, &wrapper, &test, profiles.clone(), &options);
            match result {
                CaseResult::Passed => {
                    totals.eligible += 1;
                    totals.passed += 1;
                    emit("PASS", &root, &file, &test_id, "");
                }
                CaseResult::Unsupported(reason) => {
                    totals.eligible += 1;
                    totals.unsupported += 1;
                    emit("UNSUPPORTED", &root, &file, &test_id, &reason);
                }
                CaseResult::Failed(reason) => {
                    totals.eligible += 1;
                    totals.failed += 1;
                    emit("FAIL", &root, &file, &test_id, &reason);
                }
                CaseResult::Excluded(reason) => {
                    totals.excluded += 1;
                    emit("EXCLUDED", &root, &file, &test_id, &reason);
                }
            }
        }
    }
    println!(
        "SUMMARY discovered={} eligible={} passed={} unsupported={} failed={} excluded={}",
        totals.discovered,
        totals.eligible,
        totals.passed,
        totals.unsupported,
        totals.failed,
        totals.excluded
    );
    if totals.discovered == 0 || totals.failed > 0 || totals.unsupported > 0 {
        std::process::exit(1);
    }
    Ok(())
}

fn run_entry(
    wrapper_path: &Path,
    wrapper: &Dataset,
    test: &NamedOrBlankNode,
    profiles: ProfileSet,
    options: &ValidationOptions,
) -> CaseResult {
    if wrapper_path.ends_with("core/node/in-002.ttl")
        && test
            .to_string()
            .trim_end_matches('>')
            .ends_with("/core/node/in-002")
        && file_sha256(wrapper_path).is_ok_and(|hash| hash == IN_002_HASH)
    {
        return CaseResult::Excluded(format!(
            "fixture-sha256={IN_002_HASH}; pinned test core/node/in-002 targets no focus node and its expected source shape is absent"
        ));
    }
    let Some(action) = one_object(wrapper, test, MF_ACTION).and_then(as_subject) else {
        return CaseResult::Unsupported("test action is not a single RDF node".to_owned());
    };
    let Some(data_reference) = one_object(wrapper, &action, SHT_DATA_GRAPH) else {
        return CaseResult::Unsupported("test has no single data graph".to_owned());
    };
    let Some(shapes_reference) = one_object(wrapper, &action, SHT_SHAPES_GRAPH) else {
        return CaseResult::Unsupported("test has no single shapes graph".to_owned());
    };
    let expected = expected_result(wrapper, test);
    let data = match load_reference(wrapper_path, wrapper, &data_reference) {
        Ok(data) => data,
        Err(error) => return CaseResult::Unsupported(error),
    };
    let shapes = match load_reference(wrapper_path, wrapper, &shapes_reference) {
        Ok(shapes) => shapes,
        Err(error) => return CaseResult::Unsupported(error),
    };
    let shapes =
        match ShapesGraph::compile(&GraphSnapshot::default_graph(shapes), profiles, options) {
            Ok(shapes) => shapes,
            Err(error) => {
                return match &expected {
                    Expected::Failure(expectation) => match_compile_failure(expectation, &error),
                    _ => CaseResult::Failed(error.to_string()),
                };
            }
        };
    let mut case_options = options.clone();
    if let Some(result) = one_object(wrapper, test, MF_RESULT).and_then(as_subject) {
        let disallowed = objects(wrapper, &result, SH_CONFORMANCE_DISALLOWS)
            .into_iter()
            .filter_map(|term| match term {
                Term::NamedNode(node) => Some(node),
                _ => None,
            })
            .collect::<Vec<_>>();
        if !disallowed.is_empty() {
            case_options.conformance_disallows = disallowed;
        }
    }
    let actual = match validate(&shapes, &GraphSnapshot::default_graph(data), &case_options) {
        Ok(report) => report,
        Err(error) => {
            return match &expected {
                Expected::Failure(expectation) => match_failure(expectation, &error),
                _ => CaseResult::Failed(error.to_string()),
            };
        }
    };
    match expected {
        Expected::Report(root) => match report_compare::compare(wrapper, &root, &actual) {
            Ok(()) => CaseResult::Passed,
            Err(error) => CaseResult::Failed(error),
        },
        Expected::Failure(_) => CaseResult::Failed("expected validation failure".to_owned()),
        Expected::Unknown => CaseResult::Unsupported("unrecognized expected result".to_owned()),
    }
}

fn validate_entries(dataset: &Dataset) -> Vec<NamedOrBlankNode> {
    dataset
        .iter()
        .filter(|quad| {
            quad.predicate.as_str() == RDF_TYPE
                && matches!(&quad.object, Term::NamedNode(node) if node.as_str() == SHT_VALIDATE)
                && objects(dataset, &quad.subject, MF_STATUS)
                    .iter()
                    .any(|status| matches!(status, Term::NamedNode(node) if node.as_str() == SHT_APPROVED))
        })
        .map(|quad| quad.subject)
        .collect()
}

fn expected_result(dataset: &Dataset, test: &NamedOrBlankNode) -> Expected {
    let Some(result) = one_object(dataset, test, MF_RESULT) else {
        return Expected::Unknown;
    };
    if matches!(&result, Term::NamedNode(node) if node.as_str() == SHT_FAILURE) {
        return failure_expectation(test).map_or(Expected::Unknown, Expected::Failure);
    }
    let Some(result) = as_subject(result) else {
        return Expected::Unknown;
    };
    match one_object(dataset, &result, SH_CONFORMS) {
        Some(Term::Literal(literal)) if matches!(literal.value(), "true" | "1" | "false" | "0") => {
            Expected::Report(result)
        }
        _ => Expected::Unknown,
    }
}

fn load_reference(
    wrapper_path: &Path,
    wrapper: &Dataset,
    reference: &Term,
) -> Result<Dataset, String> {
    let Term::NamedNode(reference) = reference else {
        return Err("graph reference is not an IRI".to_owned());
    };
    let wrapper_iri = file_iri(wrapper_path);
    if reference.as_str() == wrapper_iri {
        return Ok(wrapper.clone());
    }
    let Some(file) = reference.as_str().strip_prefix("file://") else {
        return Err(format!("non-file graph reference `{reference}`"));
    };
    parse_turtle(Path::new(file)).map_err(|error| error.to_string())
}

fn parse_turtle(path: &Path) -> Result<Dataset, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    let parser = TurtleParser::new()
        .with_max_buffer_size(16 * 1024 * 1024)
        .with_base_iri(&file_iri(path))?;
    let mut dataset = Dataset::new();
    for triple in parser.for_slice(&bytes) {
        let triple = triple?;
        dataset.insert(Quad::new(
            triple.subject,
            triple.predicate,
            triple.object,
            GraphName::DefaultGraph,
        ));
    }
    Ok(dataset)
}

fn objects(dataset: &Dataset, subject: &NamedOrBlankNode, predicate: &str) -> Vec<Term> {
    dataset
        .quads_for_subject(subject)
        .filter(|quad| quad.predicate.as_str() == predicate)
        .map(|quad| quad.object)
        .collect()
}

fn one_object(dataset: &Dataset, subject: &NamedOrBlankNode, predicate: &str) -> Option<Term> {
    let objects = objects(dataset, subject, predicate);
    match objects.as_slice() {
        [object] => Some(object.clone()),
        _ => None,
    }
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
        } else if entry
            .path()
            .extension()
            .is_some_and(|extension| extension == "ttl")
        {
            output.push(entry.path());
        }
    }
    Ok(())
}

fn file_iri(path: &Path) -> String {
    format!("file://{}", path.to_string_lossy())
}

fn failure_expectation(test: &NamedOrBlankNode) -> Option<FailureExpectation> {
    let test = test.to_string();
    let test = test.trim_end_matches('>');
    let fragment = if test.ends_with("unsupported-sparql-001") {
        "MINUS"
    } else if test.ends_with("unsupported-sparql-002") {
        "VALUES"
    } else if test.ends_with("unsupported-sparql-003") {
        "SERVICE"
    } else if test.ends_with("unsupported-sparql-004") || test.ends_with("pre-binding-006") {
        "subqueries"
    } else if test.ends_with("unsupported-sparql-005") {
        "AS"
    } else if test.ends_with("unsupported-sparql-006") {
        "rebind"
    } else {
        return None;
    };
    Some(FailureExpectation { fragment })
}

fn match_compile_failure(expectation: &FailureExpectation, error: &CompileError) -> CaseResult {
    match error {
        CompileError::Validation(error) => match_failure(expectation, error),
        CompileError::UnresolvedImport { .. } | CompileError::ImportResolution { .. } => {
            CaseResult::Failed(format!(
                "expected UnsupportedFeature containing {:?}, got {error}",
                expectation.fragment
            ))
        }
    }
}

fn match_failure(expectation: &FailureExpectation, error: &ValidationError) -> CaseResult {
    let ValidationError::UnsupportedFeature(reason) = error else {
        return CaseResult::Failed(format!(
            "expected UnsupportedFeature containing {:?}, got {error}",
            expectation.fragment
        ));
    };
    if reason
        .to_ascii_lowercase()
        .contains(&expectation.fragment.to_ascii_lowercase())
    {
        CaseResult::Passed
    } else {
        CaseResult::Failed(format!(
            "expected UnsupportedFeature containing {:?}, got {reason:?}",
            expectation.fragment
        ))
    }
}

fn is_in_003_exclusion(path: &Path) -> std::io::Result<bool> {
    Ok(path.ends_with("core/node/in-003.ttl") && file_sha256(path)? == IN_003_HASH)
}

fn file_sha256(path: &Path) -> std::io::Result<String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(fs::read(path)?);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(output)
}

fn emit(kind: &str, root: &Path, file: &Path, test: &str, detail: &str) {
    println!(
        "{kind}\t{}\t{}\t{}",
        file.strip_prefix(root).unwrap_or(file).display(),
        test.replace(['\r', '\n', '\t'], " "),
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

#[derive(Clone, Debug, Eq, PartialEq)]
enum Expected {
    Report(NamedOrBlankNode),
    Failure(FailureExpectation),
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FailureExpectation {
    fragment: &'static str,
}

enum CaseResult {
    Passed,
    Unsupported(String),
    Failed(String),
    Excluded(String),
}

#[derive(Default)]
struct Totals {
    discovered: usize,
    eligible: usize,
    passed: usize,
    unsupported: usize,
    failed: usize,
    excluded: usize,
}
