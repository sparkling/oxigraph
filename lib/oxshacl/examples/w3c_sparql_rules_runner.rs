#![cfg(feature = "w3c-tests")]
#![allow(clippy::print_stdout)] // Machine-readable test evidence is this runner's output.

use oxrdf::dataset::CanonicalizationAlgorithm;
use oxrdf::{Dataset, GraphName, NamedOrBlankNode, Quad, Term};
use oxshacl::{
    GraphSnapshot, ProfileId, ProfileSet, SparqlRuleSet, ValidationOptions, execute_sparql_rules,
};
use oxttl::TurtleParser;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const MF_INCLUDE: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#include";
const MF_ENTRIES: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#entries";
const MF_ACTION: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#action";
const MF_RESULT: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#result";
const MF_STATUS: &str = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#status";
const SHT_DATA: &str = "http://www.w3.org/ns/shacl-test#dataGraph";
const SHT_SHAPES: &str = "http://www.w3.org/ns/shacl-test#shapesGraph";
const SHT_APPROVED: &str = "http://www.w3.org/ns/shacl-test#approved";
const SHT_INFER: &str = "http://www.w3.org/ns/shacl-test#Infer";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        env::args()
            .nth(1)
            .ok_or("usage: w3c_sparql_rules_runner <sparql-rules-tests>")?,
    )
    .canonicalize()?;
    let cases = discover_inference_cases(&root)?;
    let profiles = ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::NodeExpressions12Subset20260108,
        ProfileId::SparqlExtensions12Subset20260130,
        ProfileId::Rules12Subset20260727,
    ])?;
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = 20_000_000;
    let mut totals = Totals::default();
    for case in cases {
        totals.discovered += 1;
        totals.eligible += 1;
        match predeclared_unsupported(&case) {
            Ok(Some(disposition)) => {
                totals.unsupported += 1;
                emit(
                    "UNSUPPORTED",
                    &case.root,
                    &case.manifest_path,
                    &case_id(&case.root, &case.test),
                    disposition.requirement,
                );
            }
            Ok(None) => match run_case(&case, profiles.clone(), &options) {
                Ok(()) => {
                    totals.passed += 1;
                    emit(
                        "PASS",
                        &case.root,
                        &case.manifest_path,
                        &case_id(&case.root, &case.test),
                        "",
                    );
                }
                Err(error) => {
                    totals.failed += 1;
                    emit(
                        "FAIL",
                        &case.root,
                        &case.manifest_path,
                        &case_id(&case.root, &case.test),
                        &error,
                    );
                }
            },
            Err(error) => {
                totals.failed += 1;
                emit(
                    "FAIL",
                    &case.root,
                    &case.manifest_path,
                    &case_id(&case.root, &case.test),
                    &error,
                );
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
        totals.excluded,
    );
    let code = exit_code(&totals);
    if code != 0 {
        std::process::exit(code);
    }
    Ok(())
}

struct ExpectedSource {
    relative_path: &'static str,
    sha256: &'static str,
}

struct UnsupportedDisposition {
    relative_path: &'static str,
    test_id: &'static str,
    requirement: &'static str,
    sources: &'static [ExpectedSource],
}

const UNSUPPORTED_INFERENCE_CASES: &[UnsupportedDisposition] = &[
    UnsupportedDisposition {
        relative_path: "layers-example.ttl",
        test_id: "layers-example",
        requirement: "requires-sh:layer-and-sh:runOnce",
        sources: &[
            ExpectedSource {
                relative_path: "layers-example.ttl",
                sha256: "fefcdee5d947442a7d7825a207cbd622a5ca1275d9168ec8bb147a090ab561c8",
            },
            ExpectedSource {
                relative_path: "layers-example-results.ttl",
                sha256: "69e69b78d907ec43ce900369f13acf4b08a6794057fb7d05cbef7500dcf9ca48",
            },
        ],
    },
    UnsupportedDisposition {
        relative_path: "run-once-example.ttl",
        test_id: "run-once-example",
        requirement: "requires-sh:runOnce",
        sources: &[ExpectedSource {
            relative_path: "run-once-example.ttl",
            sha256: "740a64ee711a34a905dc57646ce756d8790de0ad5cc67fb91aec87c56113c45b",
        }],
    },
    UnsupportedDisposition {
        relative_path: "SPARQLRuleTemplate-example-Multiply.ttl",
        test_id: "SPARQLRuleTemplate-example-Multiply",
        requirement: "requires-sh:SPARQLRuleTemplate",
        sources: &[ExpectedSource {
            relative_path: "SPARQLRuleTemplate-example-Multiply.ttl",
            sha256: "643639cb9ccdc476114c86f33c1e85b1d150b808e54678ab5d348a4227bee974",
        }],
    },
    UnsupportedDisposition {
        relative_path: "SPARQLRuleTemplate-example-SymmetricProperty.ttl",
        test_id: "SPARQLRuleTemplate-example-SymmetricProperty",
        requirement: "requires-sh:SPARQLRuleTemplate",
        sources: &[ExpectedSource {
            relative_path: "SPARQLRuleTemplate-example-SymmetricProperty.ttl",
            sha256: "4b90244c027c66adf80021355cf3819c4fc12f716a4d9b070ae66473f6f4f22b",
        }],
    },
    UnsupportedDisposition {
        relative_path: "temp-triples-example.ttl",
        test_id: "temp-triples-example",
        requirement: "requires-temporary-triple-semantics",
        sources: &[ExpectedSource {
            relative_path: "temp-triples-example.ttl",
            sha256: "392e4dd847c678ba3560ddca4aaaba0f8f3fe0b817d36d45c419ee99bddf1f91",
        }],
    },
    UnsupportedDisposition {
        relative_path: "TripleRule-example-childCount.ttl",
        test_id: "TripleRule-example-childCount",
        requirement: "requires-rdf-sh:TripleRule-compilation",
        sources: &[ExpectedSource {
            relative_path: "TripleRule-example-childCount.ttl",
            sha256: "17a9f7bdbaaad63c4c2ee4c58eb4d143aff4c645cddaab22a6b1bce02d91c475",
        }],
    },
    UnsupportedDisposition {
        relative_path: "TripleRule-example-squares.ttl",
        test_id: "TripleRule-example-squares",
        requirement: "requires-rdf-sh:TripleRule-compilation",
        sources: &[ExpectedSource {
            relative_path: "TripleRule-example-squares.ttl",
            sha256: "560b9f62c5876ff84cf04f87770df5f537fa4465fdad522e305f9b0080b6e3b8",
        }],
    },
];

fn run_case(
    case: &Case,
    profiles: ProfileSet,
    options: &ValidationOptions,
) -> Result<(), String> {
    let action = as_subject(one_object(&case.graph, &case.test, MF_ACTION)?)
        .ok_or("test action is not an RDF node")?;
    let data_reference = one_object(&case.graph, &action, SHT_DATA)?;
    let shapes_reference = one_object(&case.graph, &action, SHT_SHAPES)?;
    let result_reference = one_object(&case.graph, &case.test, MF_RESULT)?;

    let data = graph_from_reference(case, &data_reference)?;
    let shapes = graph_from_reference(case, &shapes_reference)?;
    let expected = match &result_reference {
        Term::NamedNode(node) if node.as_str() == RDF_NIL => Dataset::new(),
        Term::NamedNode(_) => graph_from_reference(case, &result_reference)?,
        _ => graph_from_list(&case.graph, &result_reference)?,
    };

    let data = GraphSnapshot::default_graph(data);
    let shapes = GraphSnapshot::default_graph(shapes);
    let rules =
        SparqlRuleSet::compile(&shapes, profiles, options).map_err(|error| error.to_string())?;
    let execution =
        execute_sparql_rules(&rules, &data, options).map_err(|error| error.to_string())?;
    compare_graphs(execution.inference().dataset(), &expected)
}

fn discover_inference_cases(root: &Path) -> Result<Vec<Case>, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("failed to canonicalize pinned root: {error}"))?;
    if !root.is_dir() {
        return Err("pinned root is not a directory".to_owned());
    }
    let root_manifest = checked_file(&root.join("manifest.ttl"), &root, "root manifest")?;
    let mut active = BTreeSet::new();
    let mut visited = BTreeSet::new();
    let mut case_ids = BTreeSet::new();
    let mut cases = Vec::new();
    walk_manifest(
        &root_manifest,
        &root,
        &mut active,
        &mut visited,
        &mut case_ids,
        &mut cases,
    )?;
    Ok(cases)
}

fn walk_manifest(
    manifest_path: &Path,
    root: &Path,
    active: &mut BTreeSet<PathBuf>,
    visited: &mut BTreeSet<PathBuf>,
    case_ids: &mut BTreeSet<String>,
    cases: &mut Vec<Case>,
) -> Result<(), String> {
    if active.contains(manifest_path) {
        return Err(format!(
            "manifest include cycle reaches {}",
            manifest_path.display()
        ));
    }
    if !visited.insert(manifest_path.to_path_buf()) {
        return Err(format!(
            "manifest include target is repeated: {}",
            manifest_path.display()
        ));
    }
    active.insert(manifest_path.to_path_buf());

    let document = parse_document(manifest_path).map_err(|error| {
        format!(
            "failed to parse manifest {}: {error}",
            manifest_path.display()
        )
    })?;
    for test in manifest_entries(&document)? {
        let types = objects(&document.graph, &test, RDF_TYPE);
        let infer_types = types
            .iter()
            .filter(|term| {
                matches!(term, Term::NamedNode(node) if node.as_str() == SHT_INFER)
            })
            .count();
        if infer_types == 0 {
            continue;
        }
        if infer_types != 1 || types.len() != 1 {
            return Err(format!(
                "inference entry {test} has mixed or ambiguous rdf:type declarations"
            ));
        }
        let identity = case_identity(manifest_path, &test);
        if !case_ids.insert(identity) {
            return Err(format!("inference entry is repeated: {test}"));
        }
        let statuses = objects(&document.graph, &test, MF_STATUS);
        let [status] = statuses.as_slice() else {
            return Err(format!(
                "inference entry {test} has {} mf:status values",
                statuses.len()
            ));
        };
        match status {
            Term::NamedNode(status) if status.as_str() == SHT_APPROVED => cases.push(Case {
                root: root.to_owned(),
                manifest_path: manifest_path.to_path_buf(),
                graph: document.graph.clone(),
                test,
            }),
            Term::NamedNode(_) => {}
            _ => {
                return Err(format!(
                    "inference entry {test} has a non-IRI mf:status value"
                ));
            }
        }
    }

    let mut includes = included_references(&document)?
        .iter()
        .map(|reference| reference_path(manifest_path, reference, root))
        .collect::<Result<Vec<_>, _>>()?;
    includes.sort();
    if includes
        .windows(2)
        .any(|pair| matches!(pair, [left, right] if left == right))
    {
        return Err(format!(
            "manifest {} contains duplicate canonical include targets",
            manifest_path.display()
        ));
    }
    for include in includes {
        walk_manifest(&include, root, active, visited, case_ids, cases)?;
    }

    active.remove(manifest_path);
    Ok(())
}

fn included_references(document: &ParsedDocument) -> Result<Vec<Term>, String> {
    if document.includes.is_empty() {
        return Ok(Vec::new());
    }
    if document
        .includes
        .iter()
        .all(|term| matches!(term, Term::NamedNode(_)))
    {
        return Ok(document.includes.clone());
    }
    if document.includes.len() != 1 {
        return Err("manifest mixes direct and RDF-list mf:include forms".to_owned());
    }
    rdf_list(&document.graph, &document.includes[0])
}

fn manifest_entries(document: &ParsedDocument) -> Result<Vec<NamedOrBlankNode>, String> {
    match document.entry_heads.as_slice() {
        [] => Ok(Vec::new()),
        [head] => {
            let entries = rdf_list(&document.graph, head)?
                .into_iter()
                .map(|term| {
                    as_subject(term).ok_or("manifest entry is not an RDF node".to_owned())
                })
                .collect::<Result<Vec<_>, _>>()?;
            let unique = entries
                .iter()
                .map(ToString::to_string)
                .collect::<BTreeSet<_>>();
            if unique.len() != entries.len() {
                return Err("manifest entries contain duplicates".to_owned());
            }
            Ok(entries)
        }
        heads => Err(format!(
            "manifest has {} mf:entries values",
            heads.len()
        )),
    }
}

fn predeclared_unsupported(
    case: &Case,
) -> Result<Option<&'static UnsupportedDisposition>, String> {
    let relative_path = relative_path(&case.root, &case.manifest_path)?;
    let test_id = case_id(&case.root, &case.test);
    let path_match = UNSUPPORTED_INFERENCE_CASES
        .iter()
        .find(|disposition| disposition.relative_path == relative_path);
    let identity_match = UNSUPPORTED_INFERENCE_CASES
        .iter()
        .find(|disposition| disposition.test_id == test_id);
    match path_match {
        Some(disposition) if disposition.test_id == test_id => {
            verify_case_sources(case, disposition.sources)?;
            Ok(Some(disposition))
        }
        None if identity_match.is_none() => Ok(None),
        _ => Err(format!(
            "predeclared unsupported inference identity mismatch: path={relative_path} test={test_id}"
        )),
    }
}

fn verify_case_sources(case: &Case, expected: &[ExpectedSource]) -> Result<(), String> {
    let mut expected_hashes = BTreeMap::new();
    for source in expected {
        if expected_hashes
            .insert(source.relative_path, source.sha256)
            .is_some()
        {
            return Err(format!(
                "predeclared unsupported inference case has duplicate source {}",
                source.relative_path
            ));
        }
    }

    let mut actual_hashes = BTreeMap::new();
    for path in resolved_source_paths(case)? {
        let relative_path = relative_path(&case.root, &path)?;
        let hash = sha256_file(&path)?;
        if actual_hashes.insert(relative_path.clone(), hash).is_some() {
            return Err(format!(
                "inference case resolves duplicate source {relative_path}"
            ));
        }
    }
    if actual_hashes.len() != expected_hashes.len() {
        return Err(format!(
            "predeclared unsupported inference source set changed: expected {:?}, got {:?}",
            expected_hashes.keys().collect::<Vec<_>>(),
            actual_hashes.keys().collect::<Vec<_>>(),
        ));
    }
    for (relative_path, expected_hash) in expected_hashes {
        match actual_hashes.get(relative_path) {
            Some(actual_hash) if actual_hash.as_str() == expected_hash => {}
            Some(actual_hash) => {
                return Err(format!(
                    "predeclared unsupported inference source hash changed for {relative_path}: expected {expected_hash}, got {actual_hash}"
                ));
            }
            None => {
                return Err(format!(
                    "predeclared unsupported inference source is missing: {relative_path}"
                ));
            }
        }
    }
    Ok(())
}

fn resolved_source_paths(case: &Case) -> Result<BTreeSet<PathBuf>, String> {
    let action = as_subject(one_object(&case.graph, &case.test, MF_ACTION)?)
        .ok_or("test action is not an RDF node")?;
    let data_reference = one_object(&case.graph, &action, SHT_DATA)?;
    let shapes_reference = one_object(&case.graph, &action, SHT_SHAPES)?;
    let result_reference = one_object(&case.graph, &case.test, MF_RESULT)?;
    let mut paths = BTreeSet::from([case.manifest_path.clone()]);
    paths.insert(reference_path(&case.manifest_path, &data_reference, &case.root)?);
    paths.insert(reference_path(&case.manifest_path, &shapes_reference, &case.root)?);
    if !matches!(&result_reference, Term::NamedNode(node) if node.as_str() == RDF_NIL)
        && matches!(&result_reference, Term::NamedNode(_))
    {
        paths.insert(reference_path(&case.manifest_path, &result_reference, &case.root)?);
    }
    Ok(paths)
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map_err(|_| format!("inference source escapes pinned root: {}", path.display()))
        .map(|path| path.to_string_lossy().into_owned())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = fs::read(path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(output)
}

fn totals_are_conserved(totals: &Totals) -> bool {
    totals.discovered == totals.eligible + totals.excluded
        && totals.eligible == totals.passed + totals.unsupported + totals.failed
}

fn exit_code(totals: &Totals) -> i32 {
    if totals.discovered == 0 || totals.failed > 0 || !totals_are_conserved(totals) {
        1
    } else if totals.unsupported > 0 {
        2
    } else {
        0
    }
}

fn graph_from_reference(case: &Case, reference: &Term) -> Result<Dataset, String> {
    let path = reference_path(&case.manifest_path, reference, &case.root)?;
    if path == case.manifest_path {
        Ok(case.graph.clone())
    } else {
        parse_turtle(&path).map_err(|error| format!("failed to parse {}: {error}", path.display()))
    }
}

fn graph_from_list(graph: &Dataset, head: &Term) -> Result<Dataset, String> {
    let mut output = Dataset::new();
    for triple_head in rdf_list(graph, head)? {
        let terms = rdf_list(graph, &triple_head)?;
        let [subject, predicate, object] = terms.as_slice() else {
            return Err("expected inference entry is not a three-term list".to_owned());
        };
        let subject = as_subject(subject.clone())
            .ok_or("expected triple subject is not an IRI or blank node")?;
        let Term::NamedNode(predicate) = predicate else {
            return Err("expected triple predicate is not an IRI".to_owned());
        };
        output.insert(Quad::new(
            subject,
            predicate.clone(),
            object.clone(),
            GraphName::DefaultGraph,
        ));
    }
    Ok(output)
}

fn compare_graphs(actual: &Dataset, expected: &Dataset) -> Result<(), String> {
    let mut actual = actual.clone();
    let mut expected = expected.clone();
    actual
        .canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)
        .map_err(|error| format!("failed to canonicalize actual graph: {error}"))?;
    expected
        .canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)
        .map_err(|error| format!("failed to canonicalize expected graph: {error}"))?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "result graph mismatch: expected=[{}] actual=[{}]",
            graph_lines(&expected),
            graph_lines(&actual)
        ))
    }
}

fn rdf_list(graph: &Dataset, head: &Term) -> Result<Vec<Term>, String> {
    let mut current = head.clone();
    let mut output = Vec::new();
    let mut seen = BTreeSet::new();
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

fn parse_turtle(path: &Path) -> Result<Dataset, Box<dyn std::error::Error>> {
    Ok(parse_document(path)?.graph)
}

fn parse_document(path: &Path) -> Result<ParsedDocument, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    let parser = TurtleParser::new()
        .with_max_buffer_size(16 * 1024 * 1024)
        .with_base_iri(&format!("file://{}", path.to_string_lossy()))?;
    let mut graph = Dataset::new();
    let mut includes = Vec::new();
    let mut entry_heads = Vec::new();
    for triple in parser.for_slice(&bytes) {
        let triple = triple?;
        if triple.predicate.as_str() == MF_INCLUDE {
            includes.push(triple.object.clone());
        }
        if triple.predicate.as_str() == MF_ENTRIES {
            entry_heads.push(triple.object.clone());
        }
        graph.insert(Quad::new(
            triple.subject,
            triple.predicate,
            triple.object,
            GraphName::DefaultGraph,
        ));
    }
    Ok(ParsedDocument {
        graph,
        includes,
        entry_heads,
    })
}

fn reference_path(source: &Path, reference: &Term, root: &Path) -> Result<PathBuf, String> {
    let Term::NamedNode(reference) = reference else {
        return Err("transport reference is not an IRI".to_owned());
    };
    let raw = reference
        .as_str()
        .strip_prefix("file://")
        .ok_or("transport reference is not a local file IRI")?;
    if !raw.starts_with('/') || raw.contains('#') || raw.contains('?') {
        return Err(
            "transport reference has a remote authority, fragment, query, or ambiguous form"
                .to_owned(),
        );
    }
    let canonical_source = source
        .canonicalize()
        .map_err(|error| format!("failed to canonicalize reference source: {error}"))?;
    if !canonical_source.starts_with(root) {
        return Err("transport reference source escapes the canonical pinned root".to_owned());
    }
    checked_file(&PathBuf::from(raw), root, "transport reference")
}

fn checked_file(path: &Path, root: &Path, kind: &str) -> Result<PathBuf, String> {
    let candidate = path
        .canonicalize()
        .map_err(|error| format!("failed to canonicalize {kind}: {error}"))?;
    if !candidate.starts_with(root) {
        return Err(format!("{kind} escapes the canonical pinned root"));
    }
    if !candidate.is_file() {
        return Err(format!("{kind} is not a regular file"));
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

fn case_identity(manifest_path: &Path, test: &NamedOrBlankNode) -> String {
    match test {
        NamedOrBlankNode::NamedNode(node) => format!("iri:{}", node.as_str()),
        NamedOrBlankNode::BlankNode(node) => {
            format!("blank:{}:{}", manifest_path.display(), node.as_str())
        }
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

fn case_id(root: &Path, test: &NamedOrBlankNode) -> String {
    let value = test.to_string();
    let prefix = format!("<file://{}/", root.display());
    value
        .strip_prefix(&prefix)
        .and_then(|value| value.strip_suffix('>'))
        .map_or(value.clone(), ToOwned::to_owned)
}

fn graph_lines(dataset: &Dataset) -> String {
    let mut lines = dataset
        .iter()
        .map(|quad| quad.to_string())
        .collect::<Vec<_>>();
    lines.sort();
    lines.into_iter().take(24).collect::<Vec<_>>().join(" ")
}

struct ParsedDocument {
    graph: Dataset,
    includes: Vec<Term>,
    entry_heads: Vec<Term>,
}

struct Case {
    root: PathBuf,
    manifest_path: PathBuf,
    graph: Dataset,
    test: NamedOrBlankNode,
}

#[cfg(test)]
#[path = "w3c_sparql_rules_runner/tests.rs"]
mod tests;

#[derive(Default)]
struct Totals {
    discovered: usize,
    eligible: usize,
    passed: usize,
    unsupported: usize,
    failed: usize,
    excluded: usize,
}
