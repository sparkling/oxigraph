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
const SRT_HISTORICAL: &str = "http://www.w3.org/ns/shacl-rules-test#";
const SRT_CURRENT: &str = "http://www.w3.org/ns/sparql-rl-tests#";
const SRT_RULESET_HISTORICAL: &str = "http://www.w3.org/ns/shacl-rules-test#ruleset";
const SRT_DATA_HISTORICAL: &str = "http://www.w3.org/ns/shacl-rules-test#data";
const SRT_RULESET_CURRENT: &str = "http://www.w3.org/ns/sparql-rl-tests#ruleset";
const SRT_DATA_CURRENT: &str = "http://www.w3.org/ns/sparql-rl-tests#data";

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
    let (root_manifest_path, dialect) = root_manifest_path(&root)?;
    let root_manifest = parse_turtle(&root_manifest_path)?;
    let included = included_manifests(&root_manifest, &root_manifest_path, &root, dialect)?;
    let mut totals = Totals::default();
    for manifest_path in included {
        let manifest = parse_turtle(&manifest_path)?;
        for test in manifest_entries(&manifest)? {
            totals.discovered += 1;
            totals.eligible += 1;
            let name = case_name(&manifest, &test)?;
            let result = run_case(
                &manifest_path,
                &manifest,
                &test,
                profiles.clone(),
                &root,
                dialect,
            );
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
    dialect: SrlDialect,
) -> CaseResult {
    let Some(kind) = case_kind(manifest, test, dialect) else {
        return CaseResult::Unsupported(
            "test does not have exactly one recognized type in the selected SRL namespace"
                .to_owned(),
        );
    };
    match kind {
        CaseKind::Syntax { positive } => {
            let action = match one_object(manifest, test, MF_ACTION) {
                Ok(action) => action,
                Err(error) => return CaseResult::Failed(error),
            };
            let path = match reference_path(manifest_path, &action, root) {
                Ok(path) => path,
                Err(error) => return CaseResult::Failed(error),
            };
            expected_acceptance(parse_rules(&path, profiles).map(|_| ()), positive, "syntax")
        }
        CaseKind::WellFormed { positive } => {
            let action = match one_object(manifest, test, MF_ACTION) {
                Ok(action) => action,
                Err(error) => return CaseResult::Failed(error),
            };
            let path = match reference_path(manifest_path, &action, root) {
                Ok(path) => path,
                Err(error) => return CaseResult::Failed(error),
            };
            let result = parse_rules(&path, profiles).and_then(|rules| rules.check_well_formed());
            expected_acceptance(result, positive, "well-formedness")
        }
        CaseKind::Stratification { positive } => {
            let action = match one_object(manifest, test, MF_ACTION) {
                Ok(action) => action,
                Err(error) => return CaseResult::Failed(error),
            };
            let path = match reference_path(manifest_path, &action, root) {
                Ok(path) => path,
                Err(error) => return CaseResult::Failed(error),
            };
            let result =
                parse_rules(&path, profiles).and_then(|rules| rules.stratification().map(|_| ()));
            expected_acceptance(result, positive, "stratification")
        }
        CaseKind::Evaluation => {
            run_evaluation(manifest_path, manifest, test, profiles, root, dialect)
        }
    }
}

fn run_evaluation(
    manifest_path: &Path,
    manifest: &Dataset,
    test: &NamedOrBlankNode,
    profiles: ProfileSet,
    root: &Path,
    dialect: SrlDialect,
) -> CaseResult {
    let (ruleset_predicate, data_predicate, other_ruleset, other_data) = match dialect {
        SrlDialect::Historical => (
            SRT_RULESET_HISTORICAL,
            SRT_DATA_HISTORICAL,
            SRT_RULESET_CURRENT,
            SRT_DATA_CURRENT,
        ),
        SrlDialect::Current => (
            SRT_RULESET_CURRENT,
            SRT_DATA_CURRENT,
            SRT_RULESET_HISTORICAL,
            SRT_DATA_HISTORICAL,
        ),
    };
    let action = match one_object(manifest, test, MF_ACTION).and_then(|term| {
        as_subject(term).ok_or("evaluation action is not an RDF node".to_owned())
    }) {
        Ok(action) => action,
        Err(error) => return CaseResult::Failed(error),
    };
    if !objects(manifest, &action, other_ruleset).is_empty()
        || !objects(manifest, &action, other_data).is_empty()
    {
        return CaseResult::Failed(
            "evaluation action mixes historical and current predicate namespaces".to_owned(),
        );
    }
    let rules_reference = match one_object(manifest, &action, ruleset_predicate) {
        Ok(reference) => reference,
        Err(error) => return CaseResult::Failed(error),
    };
    let data_reference = match one_object(manifest, &action, data_predicate) {
        Ok(reference) => reference,
        Err(error) => return CaseResult::Failed(error),
    };
    let result_reference = match one_object(manifest, test, MF_RESULT) {
        Ok(reference) => reference,
        Err(error) => return CaseResult::Failed(error),
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

fn root_manifest_path(root: &Path) -> Result<(PathBuf, SrlDialect), Box<dyn std::error::Error>> {
    let canonical_root = root.canonicalize()?;
    if canonical_root != root || !canonical_root.is_dir() {
        return Err("rules root is not a canonical directory".into());
    }
    let historical = checked_manifest(&root.join("manifest-rules.ttl"), root)?;
    let current = checked_manifest(&root.join("manifest-sparql-rl.ttl"), root)?;
    match (historical, current) {
        (Some(path), None) => Ok((path, SrlDialect::Historical)),
        (None, Some(path)) => Ok((path, SrlDialect::Current)),
        (Some(_), Some(_)) => {
            Err("rules root contains both historical and current manifests".into())
        }
        (None, None) => Err("rules root contains neither supported manifest".into()),
    }
}

fn checked_manifest(
    path: &Path,
    root: &Path,
) -> Result<Option<PathBuf>, Box<dyn std::error::Error>> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            let canonical = path.canonicalize()?;
            if !canonical.starts_with(root) {
                return Err("rules manifest escapes the canonical rules root".into());
            }
            if !canonical.is_file() {
                return Err("rules manifest is not a regular file".into());
            }
            Ok(Some(canonical))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn included_manifests(
    graph: &Dataset,
    manifest_path: &Path,
    root: &Path,
    dialect: SrlDialect,
) -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
    let includes = graph
        .iter()
        .filter(|quad| quad.predicate.as_str() == MF_INCLUDE)
        .collect::<Vec<_>>();
    if includes.len() != 1 {
        return Err(format!(
            "root manifest has {} mf:include values instead of one RDF list",
            includes.len()
        )
        .into());
    }
    let mut output = rdf_list(graph, &includes[0].object)?
        .iter()
        .map(|term| reference_path(manifest_path, term, root))
        .collect::<Result<Vec<_>, _>>()?;
    output.sort();
    if output
        .windows(2)
        .any(|pair| matches!(pair, [left, right] if left == right))
    {
        return Err("root manifest includes a duplicate canonical manifest target".into());
    }
    let expected = match dialect {
        SrlDialect::Historical => 5,
        SrlDialect::Current => 6,
    };
    if output.len() != expected {
        return Err(format!(
            "{} root manifest includes {} manifests instead of {expected}",
            dialect.label(),
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
        output.push(one_object(graph, &node, RDF_FIRST)?);
        current = one_object(graph, &node, RDF_REST)?;
    }
    Err("RDF list exceeds 100000 cells".to_owned())
}

fn case_kind(
    graph: &Dataset,
    test: &NamedOrBlankNode,
    dialect: SrlDialect,
) -> Option<CaseKind> {
    let types = objects(graph, test, RDF_TYPE);
    let [Term::NamedNode(kind)] = types.as_slice() else {
        return None;
    };
    let local_name = kind.as_str().strip_prefix(dialect.namespace())?;
    Some(match local_name {
        "RulesPositiveSyntaxTest" => CaseKind::Syntax { positive: true },
        "RulesNegativeSyntaxTest" => CaseKind::Syntax { positive: false },
        "RulesPositiveWellFormednessTest" => CaseKind::WellFormed { positive: true },
        "RulesNegativeWellFormednessTest" => CaseKind::WellFormed { positive: false },
        "RulesPositiveStratificationTest" => CaseKind::Stratification { positive: true },
        "RulesNegativeStratificationTest" => CaseKind::Stratification { positive: false },
        "RulesEvalTest" => CaseKind::Evaluation,
        _ => return None,
    })
}

fn case_name(graph: &Dataset, test: &NamedOrBlankNode) -> Result<String, String> {
    match one_object(graph, test, MF_NAME)? {
        Term::Literal(name) => Ok(name.value().to_owned()),
        _ => Err("test mf:name is not a literal".to_owned()),
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

fn reference_path(source: &Path, reference: &Term, root: &Path) -> Result<PathBuf, String> {
    let Term::NamedNode(reference) = reference else {
        return Err("file reference is not an IRI".to_owned());
    };
    let raw = reference
        .as_str()
        .strip_prefix("file://")
        .ok_or("file reference does not use file://")?;
    if !raw.starts_with('/') || raw.contains('#') || raw.contains('?') {
        return Err("file reference has a remote authority, fragment, query, or ambiguous form"
            .to_owned());
    }
    let candidate = PathBuf::from(raw)
        .canonicalize()
        .map_err(|error| format!("failed to canonicalize file reference: {error}"))?;
    let canonical_source = source
        .canonicalize()
        .map_err(|error| format!("failed to canonicalize reference source: {error}"))?;
    if !canonical_source.starts_with(root) {
        return Err("reference source escapes the canonical rules root".to_owned());
    }
    if !candidate.starts_with(root) {
        return Err("file reference escapes the canonical rules root".to_owned());
    }
    if candidate == canonical_source {
        return Err("file reference is recursive".to_owned());
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

fn one_object(
    graph: &Dataset,
    subject: &NamedOrBlankNode,
    predicate: &str,
) -> Result<Term, String> {
    let values = objects(graph, subject, predicate);
    match values.as_slice() {
        [value] => Ok(value.clone()),
        [] => Err(format!("{subject} has no {predicate} value")),
        _ => Err(format!(
            "{subject} has {} {predicate} values",
            values.len()
        )),
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

#[derive(Clone, Copy)]
enum SrlDialect {
    Historical,
    Current,
}

impl SrlDialect {
    fn namespace(self) -> &'static str {
        match self {
            Self::Historical => SRT_HISTORICAL,
            Self::Current => SRT_CURRENT,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Historical => "historical",
            Self::Current => "current",
        }
    }
}

#[cfg(test)]
#[path = "w3c_srl_rules_runner/tests.rs"]
mod tests;

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
