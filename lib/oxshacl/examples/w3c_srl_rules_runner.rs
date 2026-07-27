#![cfg(feature = "w3c-tests")]
#![allow(clippy::print_stdout)] // Machine-readable test evidence is this runner's output.

use oxrdf::dataset::CanonicalizationAlgorithm;
use oxrdf::{Dataset, GraphName, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    GraphSnapshot, ProfileId, ProfileSet, SrlError, SrlRuleSet, ValidationOptions,
    execute_srl_rules,
};
use oxttl::TurtleParser;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const MF_INCLUDE: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#include";
const MF_ENTRIES: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#entries";
const MF_NAME: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#name";
const MF_ACTION: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#action";
const MF_RESULT: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#result";
const SRT: &str = "http://www.w3.org/ns/shacl-rules-test#";
const SRT_RULESET: &str = "http://www.w3.org/ns/shacl-rules-test#ruleset";
const SRT_DATA: &str = "http://www.w3.org/ns/shacl-rules-test#data";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        env::args()
            .nth(1)
            .ok_or("usage: w3c_srl_rules_runner <rules-tests>")?,
    )
    .canonicalize()?;
    let profiles = ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::Rules12Subset20260727,
    ])?;
    let root_manifest_path = root.join("manifest-rules.ttl");
    let root_manifest = parse_turtle(&root_manifest_path)?;
    let included = included_manifests(&root_manifest, &root_manifest_path, &root)?;
    let mut totals = Totals::default();
    for manifest_path in included {
        let manifest = parse_turtle(&manifest_path)?;
        let entries = manifest_entries(&manifest)?;
        for test in entries {
            totals.discovered += 1;
            totals.eligible += 1;
            let name = case_name(&manifest, &test)?;
            let result = run_case(&manifest_path, &manifest, &test, profiles.clone(), &root);
            match result {
                CaseResult::Passed(detail) => {
                    totals.passed += 1;
                    emit("PASS", &root, &manifest_path, &name, &detail);
                }
                CaseResult::Unsupported(detail) => {
                    totals.unsupported += 1;
                    emit("UNSUPPORTED", &root, &manifest_path, &name, &detail);
                }
                CaseResult::Failed(detail) => {
                    totals.failed += 1;
                    emit("FAIL", &root, &manifest_path, &name, &detail);
                }
            }
        }
    }
    println!(
        "SUMMARY discovered={} eligible={} passed={} unsupported={} failed={} excluded=0",
        totals.discovered, totals.eligible, totals.passed, totals.unsupported, totals.failed
    );
    if totals.discovered == 0 || totals.failed > 0 || totals.unsupported > 0 {
        std::process::exit(1);
    }
    Ok(())
}

fn run_case(
    manifest_path: &Path,
    manifest: &Dataset,
    test: &NamedOrBlankNode,
    profiles: ProfileSet,
    root: &Path,
) -> CaseResult {
    let Some(kind) = case_kind(manifest, test) else {
        return CaseResult::Unsupported("unrecognized SRL manifest test type".to_owned());
    };
    match kind {
        CaseKind::Syntax { positive } => {
            let Some(action) = one_object(manifest, test, MF_ACTION) else {
                return CaseResult::Failed("syntax test has no single mf:action".to_owned());
            };
            let path = match reference_path(manifest_path, &action, root) {
                Ok(path) => path,
                Err(error) => return CaseResult::Failed(error),
            };
            expected_acceptance(parse_rules(&path, profiles).map(|_| ()), positive, "syntax")
        }
        CaseKind::WellFormed { positive } => {
            let Some(action) = one_object(manifest, test, MF_ACTION) else {
                return CaseResult::Failed("well-formedness test has no action".to_owned());
            };
            let path = match reference_path(manifest_path, &action, root) {
                Ok(path) => path,
                Err(error) => return CaseResult::Failed(error),
            };
            let result = parse_rules(&path, profiles).and_then(|rules| rules.check_well_formed());
            expected_acceptance(result, positive, "well-formedness")
        }
        CaseKind::Stratification { positive } => {
            let Some(action) = one_object(manifest, test, MF_ACTION) else {
                return CaseResult::Failed("stratification test has no action".to_owned());
            };
            let path = match reference_path(manifest_path, &action, root) {
                Ok(path) => path,
                Err(error) => return CaseResult::Failed(error),
            };
            let result =
                parse_rules(&path, profiles).and_then(|rules| rules.stratification().map(|_| ()));
            expected_acceptance(result, positive, "stratification")
        }
        CaseKind::Evaluation => run_evaluation(manifest_path, manifest, test, profiles, root),
    }
}

fn run_evaluation(
    manifest_path: &Path,
    manifest: &Dataset,
    test: &NamedOrBlankNode,
    profiles: ProfileSet,
    root: &Path,
) -> CaseResult {
    let Some(action) = one_object(manifest, test, MF_ACTION).and_then(as_subject) else {
        return CaseResult::Failed("evaluation action is not a single RDF node".to_owned());
    };
    let Some(rules_reference) = one_object(manifest, &action, SRT_RULESET) else {
        return CaseResult::Failed("evaluation action has no single srt:ruleset".to_owned());
    };
    let Some(data_reference) = one_object(manifest, &action, SRT_DATA) else {
        return CaseResult::Failed("evaluation action has no single srt:data".to_owned());
    };
    let Some(result_reference) = one_object(manifest, test, MF_RESULT) else {
        return CaseResult::Failed("evaluation test has no single mf:result".to_owned());
    };
    let rules_path = match reference_path(manifest_path, &rules_reference, root) {
        Ok(path) => path,
        Err(error) => return CaseResult::Failed(error),
    };
    let data_path = match reference_path(manifest_path, &data_reference, root) {
        Ok(path) => path,
        Err(error) => return CaseResult::Failed(error),
    };
    let result_path = match reference_path(manifest_path, &result_reference, root) {
        Ok(path) => path,
        Err(error) => return CaseResult::Failed(error),
    };
    let result = (|| {
        let rules = parse_rules(&rules_path, profiles)?;
        let data =
            parse_turtle(&data_path).map_err(|error| SrlError::Unsupported(error.to_string()))?;
        let expected =
            parse_turtle(&result_path).map_err(|error| SrlError::Unsupported(error.to_string()))?;
        let mut options = ValidationOptions::default();
        options.limits.timeout = Some(std::time::Duration::from_secs(30));
        let execution = execute_srl_rules(&rules, &GraphSnapshot::default_graph(data), &options)?;
        compare_graphs(execution.inference().dataset(), &expected)
    })();
    match result {
        Ok(()) => CaseResult::Passed("graph-isomorphic".to_owned()),
        Err(SrlError::Unsupported(error)) => CaseResult::Unsupported(error),
        Err(error) => CaseResult::Failed(error.to_string()),
    }
}

fn expected_acceptance(result: Result<(), SrlError>, positive: bool, stage: &str) -> CaseResult {
    match (positive, result) {
        (true, Ok(())) => CaseResult::Passed(format!("{stage}-accepted")),
        (false, Err(_)) => CaseResult::Passed(format!("{stage}-rejected-as-expected")),
        (true, Err(error)) => CaseResult::Failed(error.to_string()),
        (false, Ok(())) => CaseResult::Failed(format!("negative {stage} fixture was accepted")),
    }
}

fn parse_rules(path: &Path, profiles: ProfileSet) -> Result<SrlRuleSet, SrlError> {
    let source = fs::read_to_string(path)
        .map_err(|error| SrlError::Unsupported(format!("failed to read SRL source: {error}")))?;
    SrlRuleSet::parse(
        &source,
        Some(&format!("file://{}", path.to_string_lossy())),
        profiles,
    )
}

fn compare_graphs(actual: &Dataset, expected: &Dataset) -> Result<(), SrlError> {
    let mut actual = actual.clone();
    let mut expected = expected.clone();
    actual
        .canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)
        .map_err(|error| SrlError::ResultGraph(error.to_string()))?;
    expected
        .canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)
        .map_err(|error| SrlError::ResultGraph(error.to_string()))?;
    if actual == expected {
        Ok(())
    } else {
        Err(SrlError::ResultGraph(format!(
            "result graph mismatch: expected=[{}] actual=[{}]",
            graph_lines(&expected),
            graph_lines(&actual)
        )))
    }
}

fn included_manifests(
    graph: &Dataset,
    manifest_path: &Path,
    root: &Path,
) -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
    let roots = graph
        .iter()
        .filter(|quad| quad.predicate.as_str() == MF_INCLUDE)
        .collect::<Vec<_>>();
    if roots.len() != 1 {
        return Err(format!("root manifest has {} mf:include values", roots.len()).into());
    }
    let mut output = rdf_list(graph, &roots[0].object)?
        .iter()
        .map(|term| reference_path(manifest_path, term, root))
        .collect::<Result<Vec<_>, _>>()?;
    output.sort();
    if output.len() != 5 {
        return Err(format!(
            "root manifest includes {} manifests instead of 5",
            output.len()
        )
        .into());
    }
    Ok(output)
}

fn manifest_entries(graph: &Dataset) -> Result<Vec<NamedOrBlankNode>, String> {
    let roots = graph
        .iter()
        .filter(|quad| quad.predicate.as_str() == MF_ENTRIES)
        .collect::<Vec<_>>();
    if roots.len() != 1 {
        return Err(format!("manifest has {} mf:entries values", roots.len()));
    }
    let entries = rdf_list(graph, &roots[0].object)?
        .into_iter()
        .map(|term| as_subject(term).ok_or("manifest entry is not an RDF node".to_owned()))
        .collect::<Result<Vec<_>, _>>()?;
    let unique = entries
        .iter()
        .map(ToString::to_string)
        .collect::<std::collections::BTreeSet<_>>();
    if unique.len() != entries.len() {
        return Err("manifest entries contain duplicates".to_owned());
    }
    Ok(entries)
}

fn rdf_list(graph: &Dataset, head: &Term) -> Result<Vec<Term>, String> {
    let mut current = head.clone();
    let mut output = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..100_000 {
        if matches!(&current, Term::NamedNode(node) if node.as_str() == RDF_NIL) {
            return Ok(output);
        }
        let node = as_subject(current).ok_or("RDF list cell is not a node")?;
        if !seen.insert(node.to_string()) {
            return Err("cyclic RDF list".to_owned());
        }
        output.push(one_object(graph, &node, RDF_FIRST).ok_or("RDF list has no rdf:first")?);
        current = one_object(graph, &node, RDF_REST).ok_or("RDF list has no rdf:rest")?;
    }
    Err("RDF list exceeds 100000 cells".to_owned())
}

fn case_kind(graph: &Dataset, test: &NamedOrBlankNode) -> Option<CaseKind> {
    let types = objects(graph, test, RDF_TYPE);
    for kind in types {
        let Term::NamedNode(kind) = kind else {
            continue;
        };
        let Some(kind) = kind.as_str().strip_prefix(SRT) else {
            continue;
        };
        return Some(match kind {
            "RulesPositiveSyntaxTest" => CaseKind::Syntax { positive: true },
            "RulesNegativeSyntaxTest" => CaseKind::Syntax { positive: false },
            "RulesPositiveWellFormednessTest" => CaseKind::WellFormed { positive: true },
            "RulesNegativeWellFormednessTest" => CaseKind::WellFormed { positive: false },
            "RulesPositiveStratificationTest" => CaseKind::Stratification { positive: true },
            "RulesNegativeStratificationTest" => CaseKind::Stratification { positive: false },
            "RulesEvalTest" => CaseKind::Evaluation,
            _ => continue,
        });
    }
    None
}

fn case_name(graph: &Dataset, test: &NamedOrBlankNode) -> Result<String, String> {
    match one_object(graph, test, MF_NAME) {
        Some(Term::Literal(name)) => Ok(name.value().to_owned()),
        _ => Err("test has no single literal mf:name".to_owned()),
    }
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

fn reference_path(manifest: &Path, reference: &Term, root: &Path) -> Result<PathBuf, String> {
    let Term::NamedNode(reference) = reference else {
        return Err("file reference is not an IRI".to_owned());
    };
    let raw = reference
        .as_str()
        .strip_prefix("file://")
        .ok_or("file reference does not use file://")?;
    let candidate = PathBuf::from(raw)
        .canonicalize()
        .map_err(|error| format!("failed to canonicalize reference: {error}"))?;
    if !candidate.starts_with(root) || candidate == manifest {
        return Err("file reference escapes pinned rules root or is recursive".to_owned());
    }
    if !candidate.is_file() {
        return Err("file reference is not a regular file".to_owned());
    }
    Ok(candidate)
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

fn emit(kind: &str, root: &Path, file: &Path, test_id: &str, detail: &str) {
    println!(
        "{kind}\t{}\t{}\t{}",
        file.strip_prefix(root).unwrap_or(file).display(),
        test_id.replace(['\r', '\n', '\t'], " "),
        detail.replace(['\r', '\n', '\t'], " ")
    );
}

fn graph_lines(dataset: &Dataset) -> String {
    let mut lines = dataset
        .iter()
        .map(|quad| quad.to_string())
        .collect::<Vec<_>>();
    lines.sort();
    lines.into_iter().take(24).collect::<Vec<_>>().join(" ")
}

enum CaseKind {
    Syntax { positive: bool },
    WellFormed { positive: bool },
    Stratification { positive: bool },
    Evaluation,
}

enum CaseResult {
    Passed(String),
    Unsupported(String),
    Failed(String),
}

#[derive(Default)]
struct Totals {
    discovered: usize,
    eligible: usize,
    passed: usize,
    unsupported: usize,
    failed: usize,
}
