#![cfg(feature = "w3c-tests")]
#![allow(clippy::print_stdout)]

use oxrdf::dataset::CanonicalizationAlgorithm;
use oxrdf::{Dataset, GraphName, Quad};
use oxshacl::ShaclcParser;
use oxttl::TurtleParser;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::env;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

const EXTERNAL_BASE: &str = "urn:x-base:default";
const PINNED_SPEC_SHA256: &str = "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd";
const PINNED_GRAMMAR_SHA256: &str =
    "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04";
const PINNED_CASES: &[&str] = &[
    "array-in",
    "basic-shape-iri",
    "basic-shape-with-target",
    "basic-shape-with-targets",
    "basic-shape",
    "class",
    "comment",
    "complex1",
    "complex2",
    "count-0-1",
    "count-0-unlimited",
    "count-1-2",
    "count-1-unlimited",
    "datatype",
    "directives",
    "empty",
    "nestedShape",
    "node-or-2",
    "node-or-3-not",
    "nodeKind",
    "path-alternative",
    "path-complex",
    "path-inverse",
    "path-oneOrMore",
    "path-sequence",
    "path-zeroOrMore",
    "path-zeroOrOne",
    "property-empty",
    "property-not",
    "property-or-2",
    "property-or-3",
    "shapeRef",
];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        env::args()
            .nth(1)
            .ok_or("usage: w3c_compact_runner <shacl12-cs/tests/valid>")?,
    )
    .canonicalize()?;
    if !root.is_dir() {
        return Err("compact test root is not a directory".into());
    }
    let suite_root = root
        .parent()
        .and_then(Path::parent)
        .ok_or("compact fixture root has no shacl12-cs ancestor")?;
    verify_sha256(
        &suite_root.join("index.html"),
        suite_root,
        PINNED_SPEC_SHA256,
    )?;
    verify_sha256(
        &suite_root.join("SHACLC.g4"),
        suite_root,
        PINNED_GRAMMAR_SHA256,
    )?;
    let mut cases = fs::read_dir(&root)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    cases.retain(|path| path.extension().is_some_and(|value| value == "shaclc"));
    cases.sort();
    require_exact_cases(&cases, &root)?;
    let parser = ShaclcParser::new().with_base_iri(EXTERNAL_BASE)?;
    let mut passed = 0;
    let mut failed = 0;
    for source_path in &cases {
        let source_path = secure_file(source_path, &root)?;
        let expected_path = secure_file(&source_path.with_extension("ttl"), &root)?;
        let name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or("non-UTF-8 compact fixture name")?;
        let result = (|| {
            let source = fs::read_to_string(&source_path)?;
            let actual = parser.parse(&source)?;
            let expected = parse_turtle(&expected_path)?;
            compare_graphs(actual.dataset(), &expected)
        })();
        match result {
            Ok(()) => {
                passed += 1;
                emit("PASS", name, "graph-isomorphic");
            }
            Err(error) => {
                failed += 1;
                emit("FAIL", name, &error.to_string());
            }
        }
    }
    println!(
        "SUMMARY discovered={} eligible={} passed={} unsupported=0 failed={} excluded=0",
        cases.len(),
        cases.len(),
        passed,
        failed
    );
    if cases.is_empty() || failed > 0 {
        std::process::exit(1);
    }
    Ok(())
}

fn require_exact_cases(
    source_cases: &[PathBuf],
    root: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let source_names = case_names(source_cases)?;
    let turtle_cases = fs::read_dir(root)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .filter(|path| path.extension().is_some_and(|value| value == "ttl"))
        .cloned()
        .collect::<Vec<_>>();
    let turtle_names = case_names(&turtle_cases)?;
    let expected = PINNED_CASES
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<BTreeSet<_>>();
    for (kind, actual) in [("source", source_names), ("Turtle", turtle_names)] {
        if actual == expected {
            continue;
        }
        let missing = expected.difference(&actual).cloned().collect::<Vec<_>>();
        let extra = actual.difference(&expected).cloned().collect::<Vec<_>>();
        return Err(format!(
            "compact {kind} fixture set mismatch: missing={missing:?} extra={extra:?}"
        )
        .into());
    }
    Ok(())
}

fn case_names(paths: &[PathBuf]) -> Result<BTreeSet<String>, Box<dyn std::error::Error>> {
    paths
        .iter()
        .map(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .map(str::to_owned)
                .ok_or_else(|| "non-UTF-8 compact fixture name".into())
        })
        .collect()
}

fn secure_file(path: &Path, root: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let path = path.canonicalize()?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("compact fixture escapes its pinned root".into());
    }
    Ok(path)
}

fn verify_sha256(
    path: &Path,
    root: &Path,
    expected: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let path = secure_file(path, root)?;
    let digest = Sha256::digest(fs::read(&path)?);
    let mut actual = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(actual, "{byte:02x}")?;
    }
    if actual != expected {
        return Err(format!(
            "pinned source digest mismatch for {}: expected={expected} actual={actual}",
            path.display()
        )
        .into());
    }
    Ok(())
}

fn parse_turtle(path: &Path) -> Result<Dataset, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    let parser = TurtleParser::new()
        .with_max_buffer_size(16 * 1024 * 1024)
        .with_base_iri(EXTERNAL_BASE)?;
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

fn compare_graphs(actual: &Dataset, expected: &Dataset) -> Result<(), Box<dyn std::error::Error>> {
    let mut actual = actual.clone();
    let mut expected = expected.clone();
    actual.canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)?;
    expected.canonicalize_with_work_factor(CanonicalizationAlgorithm::Unstable, 3)?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "graph mismatch expected={} actual={}",
            graph_lines(&expected),
            graph_lines(&actual)
        )
        .into())
    }
}

fn emit(kind: &str, file: &str, detail: &str) {
    println!(
        "{kind}\t{file}\t{file}\t{}",
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
