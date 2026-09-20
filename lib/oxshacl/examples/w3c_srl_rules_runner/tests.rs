use super::*;
use std::env;
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

struct TempFixture {
    path: PathBuf,
}

impl TempFixture {
    fn new(name: &str) -> Self {
        let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let path = env::temp_dir().join(format!(
            "oxigraph-srl-runner-{name}-{}-{id}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn write(&self, relative: &str, content: &str) -> PathBuf {
        let path = self.path.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, content).unwrap();
        path
    }

    fn root(&self) -> PathBuf {
        self.path.canonicalize().unwrap()
    }
}

impl Drop for TempFixture {
    fn drop(&mut self) {
        drop(fs::remove_dir_all(&self.path));
    }
}

const PREFIXES: &str = r#"
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .
"#;

fn write_root(fixture: &TempFixture, current: bool, count: usize) -> PathBuf {
    let namespace = if current {
        "http://www.w3.org/ns/sparql-rl-tests#"
    } else {
        "http://www.w3.org/ns/shacl-rules-test#"
    };
    let mut includes = String::new();
    for index in 0..count {
        let relative = format!("group-{index}/manifest.ttl");
        fixture.write(
            &relative,
            &format!(
                "{PREFIXES}\n@prefix srt: <{namespace}> .\n<> a mf:Manifest; mf:entries (<#case>) .\n<#case> a srt:RulesPositiveSyntaxTest; mf:name \"case {index}\"; mf:action <case.srl> .\n"
            ),
        );
        fixture.write(&format!("group-{index}/case.srl"), "PREFIX ex: <http://example/>\n");
        includes.push_str(&format!(" <{relative}>"));
    }
    let name = if current {
        "manifest-sparql-rl.ttl"
    } else {
        "manifest-rules.ttl"
    };
    fixture.write(
        name,
        &format!("{PREFIXES}\n<> a mf:Manifest; mf:include ({includes}) .\n"),
    )
}

fn only_entry(graph: &Dataset) -> NamedOrBlankNode {
    graph
        .iter()
        .find(|quad| {
            quad.predicate.as_str() == RDF_TYPE
                && matches!(&quad.object, Term::NamedNode(node) if node.as_str().ends_with("RulesPositiveSyntaxTest"))
        })
        .map(|quad| quad.subject)
        .expect("fixture has one typed test entry")
}

fn reference_from(source: &Path, object: &str) -> Term {
    fs::write(
        source,
        format!("{PREFIXES}\n<> mf:include {object} .\n"),
    )
    .unwrap();
    let graph = parse_turtle(source).unwrap();
    graph
        .iter()
        .find(|quad| quad.predicate.as_str() == MF_INCLUDE)
        .unwrap()
        .object
}

#[test]
fn recognizes_historical_root_namespace_and_five_manifests() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("historical-family");
    write_root(&fixture, false, 5);
    let root = fixture.root();
    let (manifest_path, dialect) = root_manifest_path(&root)?;
    assert_eq!(manifest_path, root.join("manifest-rules.ttl"));

    let manifest = parse_turtle(&manifest_path)?;
    let included = included_manifests(&manifest, &manifest_path, &root, dialect)?;
    assert_eq!(included.len(), 5);

    let child = parse_turtle(&included[0])?;
    assert!(case_kind(&child, &only_entry(&child), dialect).is_some());
    Ok(())
}

#[test]
fn recognizes_current_root_namespace_and_six_manifests() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("current-family");
    write_root(&fixture, true, 6);
    let root = fixture.root();
    let (manifest_path, dialect) = root_manifest_path(&root)?;
    assert_eq!(manifest_path, root.join("manifest-sparql-rl.ttl"));

    let manifest = parse_turtle(&manifest_path)?;
    let included = included_manifests(&manifest, &manifest_path, &root, dialect)?;
    assert_eq!(included.len(), 6);

    let child = parse_turtle(&included[0])?;
    assert!(case_kind(&child, &only_entry(&child), dialect).is_some());
    Ok(())
}

#[test]
fn rejects_cross_family_namespace_and_manifest_counts() -> Result<(), Box<dyn Error>> {
    let historical = TempFixture::new("historical-mismatch");
    write_root(&historical, false, 6);
    let historical_root = historical.root();
    let (historical_manifest, historical_dialect) = root_manifest_path(&historical_root)?;
    let graph = parse_turtle(&historical_manifest)?;
    assert!(included_manifests(
        &graph,
        &historical_manifest,
        &historical_root,
        historical_dialect
    )
    .is_err());

    let current = TempFixture::new("current-mismatch");
    write_root(&current, true, 5);
    let current_root = current.root();
    let (current_manifest, current_dialect) = root_manifest_path(&current_root)?;
    let graph = parse_turtle(&current_manifest)?;
    assert!(included_manifests(&graph, &current_manifest, &current_root, current_dialect).is_err());

    let wrong_namespace = historical.write(
        "wrong.ttl",
        &format!(
            "{PREFIXES}\n@prefix srt: <http://www.w3.org/ns/sparql-rl-tests#> .\n<> mf:entries (<#case>) .\n<#case> a srt:RulesPositiveSyntaxTest .\n"
        ),
    );
    let graph = parse_turtle(&wrong_namespace)?;
    assert!(case_kind(&graph, &only_entry(&graph), historical_dialect).is_none());
    Ok(())
}

#[test]
fn rejects_missing_or_ambiguous_root_manifest() {
    let fixture = TempFixture::new("root-selection");
    let root = fixture.root();
    assert!(root_manifest_path(&root).is_err());

    fixture.write("manifest-rules.ttl", "");
    fixture.write("manifest-sparql-rl.ttl", "");
    assert!(root_manifest_path(&root).is_err());
}

#[test]
fn rejects_duplicate_canonical_includes_and_broken_lists() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("include-errors");
    fixture.write("group/manifest.ttl", &format!("{PREFIXES}\n<> mf:entries () .\n"));
    fs::create_dir_all(fixture.path.join("alias")).unwrap();
    let manifest_path = fixture.write(
        "manifest-rules.ttl",
        &format!(
            "{PREFIXES}\n<> mf:include (<group/manifest.ttl> <alias/../group/manifest.ttl> <group/manifest.ttl> <group/manifest.ttl> <group/manifest.ttl>) .\n"
        ),
    );
    let root = fixture.root();
    let (_, dialect) = root_manifest_path(&root)?;
    let graph = parse_turtle(&manifest_path)?;
    assert!(included_manifests(&graph, &manifest_path, &root, dialect).is_err());

    let cyclic = fixture.write(
        "cycle.ttl",
        &format!(
            "{PREFIXES}\n<> mf:include _:list .\n_:list rdf:first <group/manifest.ttl>; rdf:rest _:list .\n"
        ),
    );
    let graph = parse_turtle(&cyclic)?;
    let head = graph
        .iter()
        .find(|quad| quad.predicate.as_str() == MF_INCLUDE)
        .unwrap()
        .object;
    assert!(rdf_list(&graph, &head).is_err());

    let ambiguous = fixture.write(
        "ambiguous.ttl",
        &format!(
            "{PREFIXES}\n<> mf:include (<group/manifest.ttl>); mf:include (<group/manifest.ttl>) .\n"
        ),
    );
    let graph = parse_turtle(&ambiguous)?;
    let subject = graph.iter().next().unwrap().subject;
    assert!(one_object(&graph, &subject, MF_INCLUDE).is_err());
    Ok(())
}

#[test]
fn permits_bounded_sibling_references_and_rejects_unsafe_references() {
    let fixture = TempFixture::new("reference-boundary");
    let source = fixture.write("manifests/manifest.ttl", "");
    let sibling = fixture.write("data/value.ttl", "<http://example/s> <http://example/p> <http://example/o> .\n");
    let root = fixture.root();

    let local = reference_from(&source, "<../data/value.ttl>");
    assert_eq!(reference_path(&source, &local, &root).unwrap(), sibling.canonicalize().unwrap());

    let remote = reference_from(&source, "<https://example.invalid/value.ttl>");
    assert!(reference_path(&source, &remote, &root).is_err());

    let recursive = reference_from(&source, "<manifest.ttl>");
    assert!(reference_path(&source, &recursive, &root).is_err());

    let outside = fixture.path.parent().unwrap().join(format!(
        "oxigraph-srl-outside-{}-{}",
        std::process::id(),
        NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&outside, "outside").unwrap();
    let traversal = reference_from(&source, &format!("<../../{}>", outside.file_name().unwrap().to_string_lossy()));
    assert!(reference_path(&source, &traversal, &root).is_err());
    fs::remove_file(outside).unwrap();
}

#[cfg(unix)]
#[test]
fn rejects_symlink_escape() {
    use std::os::unix::fs::symlink;

    let fixture = TempFixture::new("symlink-escape");
    let source = fixture.write("manifest.ttl", "");
    let outside = fixture.path.parent().unwrap().join(format!(
        "oxigraph-srl-symlink-target-{}-{}",
        std::process::id(),
        NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&outside, "outside").unwrap();
    symlink(&outside, fixture.path.join("escape.ttl")).unwrap();

    let reference = reference_from(&source, "<escape.ttl>");
    assert!(reference_path(&source, &reference, &fixture.root()).is_err());
    fs::remove_file(outside).unwrap();
}

#[test]
fn graph_comparison_is_blank_node_isomorphic_but_strict() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("graph-comparison");
    let actual = fixture.write(
        "actual.ttl",
        "_:actual <http://example/p> _:tail .\n_:tail <http://example/value> \"ok\" .\n",
    );
    let isomorphic = fixture.write(
        "isomorphic.ttl",
        "_:x <http://example/p> _:y .\n_:y <http://example/value> \"ok\" .\n",
    );
    let different = fixture.write(
        "different.ttl",
        "_:x <http://example/p> _:y .\n_:x <http://example/value> \"ok\" .\n",
    );

    assert!(compare_graphs(&parse_turtle(&actual)?, &parse_turtle(&isomorphic)?).is_ok());
    assert!(compare_graphs(&parse_turtle(&actual)?, &parse_turtle(&different)?).is_err());
    Ok(())
}

#[test]
fn current_evaluation_uses_matching_action_namespace() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("current-evaluation-namespace");
    write_root(&fixture, true, 6);
    let root = fixture.root();
    let (_, dialect) = root_manifest_path(&root)?;
    fixture.write(
        "group-0/case.srl",
        "PREFIX ex: <http://example/>\nRULE { ex:x ex:q ?o } WHERE { ex:s ex:p ?o }\n",
    );
    fixture.write(
        "group-0/data.ttl",
        "<http://example/s> <http://example/p> <http://example/o> .\n",
    );
    fixture.write(
        "group-0/result.ttl",
        "<http://example/x> <http://example/q> <http://example/o> .\n",
    );
    let profiles = ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::Rules12Subset20260727,
    ])?;

    for (action, should_pass) in [
        ("srlt:ruleset <case.srl>; srlt:data <data.ttl>", true),
        ("old:ruleset <case.srl>; old:data <data.ttl>", false),
        (
            "srlt:ruleset <case.srl>; srlt:data <data.ttl>; old:ruleset <case.srl>; old:data <data.ttl>",
            false,
        ),
    ] {
        let manifest_path = fixture.write(
            "group-0/manifest.ttl",
            &format!(
                r#"{PREFIXES}
@prefix srlt: <http://www.w3.org/ns/sparql-rl-tests#> .
@prefix old: <http://www.w3.org/ns/shacl-rules-test#> .
<> a mf:Manifest; mf:entries (<#evaluation>) .
<#evaluation>
    a srlt:RulesEvalTest;
    mf:name "current evaluation";
    mf:action [ {action} ];
    mf:result <result.ttl> .
"#
            ),
        );
        let graph = parse_turtle(&manifest_path)?;
        let entries = manifest_entries(&graph)?;
        assert_eq!(entries.len(), 1);
        let result = run_case(
            &manifest_path,
            &graph,
            &entries[0],
            profiles.clone(),
            &root,
            dialect,
        );
        if should_pass {
            match result {
                CaseResult::Passed(_) => {}
                CaseResult::Failed(detail) | CaseResult::Unsupported(detail) => {
                    panic!("current evaluation action did not derive its expected graph: {detail}")
                }
            }
        } else {
            assert!(
                !matches!(result, CaseResult::Passed(_)),
                "current evaluation accepted historical or mixed action predicates: {action}"
            );
        }
    }
    Ok(())
}
