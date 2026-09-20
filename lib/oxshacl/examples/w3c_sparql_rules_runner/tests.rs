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
            "oxigraph-sparql-rule-runner-{name}-{}-{id}",
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
@prefix ex: <http://example/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix sht: <http://www.w3.org/ns/shacl-test#> .
"#;

fn profiles() -> ProfileSet {
    ProfileSet::new([
        ProfileId::Core12Subset20260723,
        ProfileId::SparqlExtensions12Subset20260130,
        ProfileId::Rules12Subset20260727,
    ])
    .unwrap()
}

fn options() -> ValidationOptions {
    let mut options = ValidationOptions::default();
    options.limits.max_path_visits = 20_000_000;
    options
}

fn write_root(fixture: &TempFixture, include: &str) {
    fixture.write(
        "manifest.ttl",
        &format!("{PREFIXES}\n<> a mf:Manifest; mf:include <{include}> .\n"),
    );
}

fn external_case(result_object: &str, extra_action: &str) -> String {
    format!(
        r#"{PREFIXES}
<> a mf:Manifest; mf:entries (<#case>) .
<#case>
    a sht:Infer;
    mf:status sht:approved;
    mf:action [
        sht:dataGraph <data.ttl>;
        sht:shapesGraph <shapes.ttl>
        {extra_action}
    ];
    mf:result {result_object} .
"#
    )
}

fn write_external_case(fixture: &TempFixture, expected: &str) {
    write_root(fixture, "inference/manifest.ttl");
    fixture.write(
        "inference/manifest.ttl",
        &format!("{PREFIXES}\n<> a mf:Manifest; mf:include <case.ttl> .\n"),
    );
    fixture.write(
        "inference/case.ttl",
        &external_case("<result.ttl>", ""),
    );
    fixture.write("inference/data.ttl", &format!("{PREFIXES}\nex:Alice a ex:Person .\n"));
    fixture.write(
        "inference/shapes.ttl",
        &format!(
            r#"{PREFIXES}
ex:RuleShape
    a sh:NodeShape;
    sh:targetClass ex:Person;
    sh:rule [
        a sh:SPARQLRule;
        sh:construct """
            PREFIX ex: <http://example/>
            CONSTRUCT {{ $this ex:knows ex:Bob . }}
            WHERE {{ }}
        """
    ] .
"#
        ),
    );
    fixture.write("inference/result.ttl", &format!("{PREFIXES}\n{expected}\n"));
}

fn discovered(fixture: &TempFixture) -> Result<Vec<Case>, String> {
    discover_inference_cases(&fixture.root())
}

#[test]
fn discovery_follows_manifest_reachability_and_excludes_orphans() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("reachability");
    write_external_case(&fixture, "ex:Alice ex:knows ex:Bob .");
    fixture.write(
        "inference/orphan.ttl",
        &format!(
            "{PREFIXES}\n<> mf:entries (<#orphan>) .\n<#orphan> a sht:Infer; mf:status sht:approved .\n"
        ),
    );

    let cases = discovered(&fixture)?;
    assert_eq!(cases.len(), 1);
    run_case(&cases[0], profiles(), &options())?;
    Ok(())
}

#[test]
fn external_data_shapes_and_result_graphs_remain_separate() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("external-graphs");
    write_external_case(&fixture, "ex:Alice ex:knows ex:Bob .");

    let cases = discovered(&fixture)?;
    assert_eq!(cases.len(), 1);
    run_case(&cases[0], profiles(), &options())?;
    Ok(())
}

#[test]
fn same_wrapper_graphs_and_embedded_result_lists_remain_supported() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("same-wrapper");
    write_root(&fixture, "case.ttl");
    fixture.write(
        "case.ttl",
        &format!(
            r#"{PREFIXES}
ex:Alice a ex:Person .
ex:RuleShape
    a sh:NodeShape;
    sh:targetClass ex:Person;
    sh:rule [
        a sh:SPARQLRule;
        sh:construct """
            PREFIX ex: <http://example/>
            CONSTRUCT {{ $this ex:knows ex:Bob . }}
            WHERE {{ }}
        """
    ] .
<> a mf:Manifest; mf:entries (<#case>) .
<#case>
    a sht:Infer;
    mf:status sht:approved;
    mf:action [ sht:dataGraph <>; sht:shapesGraph <> ];
    mf:result ((ex:Alice ex:knows ex:Bob)) .
"#
        ),
    );

    let cases = discovered(&fixture)?;
    assert_eq!(cases.len(), 1);
    run_case(&cases[0], profiles(), &options())?;
    Ok(())
}

#[test]
fn result_graph_comparison_rejects_extra_or_missing_triples() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("result-mismatch");
    write_external_case(&fixture, "ex:Alice ex:knows ex:Carol .");

    let cases = discovered(&fixture)?;
    assert_eq!(cases.len(), 1);
    assert!(run_case(&cases[0], profiles(), &options()).is_err());
    Ok(())
}

#[test]
fn rejects_duplicate_entries_and_ambiguous_entry_lists() {
    let duplicate = TempFixture::new("duplicate-entries");
    write_root(&duplicate, "case.ttl");
    duplicate.write(
        "case.ttl",
        &format!(
            "{PREFIXES}\n<> mf:entries (<#case> <#case>) .\n<#case> a sht:Infer; mf:status sht:approved .\n"
        ),
    );
    assert!(discovered(&duplicate).is_err());

    let ambiguous = TempFixture::new("ambiguous-entries");
    write_root(&ambiguous, "case.ttl");
    ambiguous.write(
        "case.ttl",
        &format!(
            "{PREFIXES}\n<> mf:entries (<#one>); mf:entries (<#two>) .\n<#one> a sht:Infer; mf:status sht:approved .\n<#two> a sht:Infer; mf:status sht:approved .\n"
        ),
    );
    assert!(discovered(&ambiguous).is_err());
}

#[test]
fn rejects_duplicate_includes_and_include_cycles() {
    let duplicate = TempFixture::new("duplicate-includes");
    duplicate.write(
        "manifest.ttl",
        &format!(
            "{PREFIXES}\n<> mf:include <nested/case.ttl>; mf:include <nested/../nested/case.ttl> .\n"
        ),
    );
    duplicate.write("nested/case.ttl", &format!("{PREFIXES}\n<> mf:entries () .\n"));
    assert!(discovered(&duplicate).is_err());

    let cycle = TempFixture::new("include-cycle");
    write_root(&cycle, "nested/manifest.ttl");
    cycle.write(
        "nested/manifest.ttl",
        &format!("{PREFIXES}\n<> mf:include <../manifest.ttl> .\n"),
    );
    assert!(discovered(&cycle).is_err());
}

#[test]
fn rejects_remote_and_traversing_manifest_references() {
    let remote = TempFixture::new("remote-include");
    remote.write(
        "manifest.ttl",
        &format!(
            "{PREFIXES}\n<> mf:include <https://example.invalid/manifest.ttl> .\n"
        ),
    );
    assert!(discovered(&remote).is_err());

    let fixture = TempFixture::new("traversal-include");
    let outside = fixture.path.parent().unwrap().join(format!(
        "oxigraph-sparql-outside-{}-{}",
        std::process::id(),
        NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&outside, format!("{PREFIXES}\n<> mf:entries () .\n")).unwrap();
    fixture.write(
        "manifest.ttl",
        &format!(
            "{PREFIXES}\n<> mf:include <../{}> .\n",
            outside.file_name().unwrap().to_string_lossy()
        ),
    );
    assert!(discovered(&fixture).is_err());
    fs::remove_file(outside).unwrap();
}

#[cfg(unix)]
#[test]
fn rejects_manifest_symlink_escape() {
    use std::os::unix::fs::symlink;

    let fixture = TempFixture::new("symlink-include");
    let outside = fixture.path.parent().unwrap().join(format!(
        "oxigraph-sparql-symlink-target-{}-{}",
        std::process::id(),
        NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&outside, format!("{PREFIXES}\n<> mf:entries () .\n")).unwrap();
    symlink(&outside, fixture.path.join("escape.ttl")).unwrap();
    write_root(&fixture, "escape.ttl");

    assert!(discovered(&fixture).is_err());
    fs::remove_file(outside).unwrap();
}

#[test]
fn rejects_ambiguous_and_remote_case_graph_references() -> Result<(), Box<dyn Error>> {
    let ambiguous = TempFixture::new("ambiguous-action");
    write_external_case(&ambiguous, "ex:Alice ex:knows ex:Bob .");
    ambiguous.write(
        "inference/case.ttl",
        &external_case("<result.ttl>", "; sht:dataGraph <other-data.ttl>"),
    );
    ambiguous.write("inference/other-data.ttl", &format!("{PREFIXES}\nex:Other a ex:Person .\n"));
    let cases = discovered(&ambiguous)?;
    assert_eq!(cases.len(), 1);
    assert!(run_case(&cases[0], profiles(), &options()).is_err());

    let remote = TempFixture::new("remote-result");
    write_external_case(&remote, "ex:Alice ex:knows ex:Bob .");
    remote.write(
        "inference/case.ttl",
        &external_case("<https://example.invalid/result.ttl>", ""),
    );
    let cases = discovered(&remote)?;
    assert_eq!(cases.len(), 1);
    assert!(run_case(&cases[0], profiles(), &options()).is_err());
    Ok(())
}

#[test]
fn bounded_relative_sibling_graph_references_are_permitted() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("relative-siblings");
    write_root(&fixture, "manifests/case.ttl");
    fixture.write(
        "manifests/case.ttl",
        &format!(
            r#"{PREFIXES}
<> a mf:Manifest; mf:entries (<#case>) .
<#case>
    a sht:Infer;
    mf:status sht:approved;
    mf:action [
        sht:dataGraph <../graphs/data.ttl>;
        sht:shapesGraph <../graphs/shapes.ttl>
    ];
    mf:result <../graphs/result.ttl> .
"#
        ),
    );
    fixture.write("graphs/data.ttl", &format!("{PREFIXES}\nex:Alice a ex:Person .\n"));
    fixture.write(
        "graphs/shapes.ttl",
        &format!(
            r#"{PREFIXES}
ex:RuleShape
    a sh:NodeShape;
    sh:targetClass ex:Person;
    sh:rule [
        a sh:SPARQLRule;
        sh:construct """
            PREFIX ex: <http://example/>
            CONSTRUCT {{ $this ex:knows ex:Bob . }}
            WHERE {{ }}
        """
    ] .
"#
        ),
    );
    fixture.write("graphs/result.ttl", &format!("{PREFIXES}\nex:Alice ex:knows ex:Bob .\n"));

    let cases = discovered(&fixture)?;
    assert_eq!(cases.len(), 1);
    run_case(&cases[0], profiles(), &options())?;
    Ok(())
}

#[test]
fn discovery_ignores_unlisted_typed_entry_in_listed_file() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("unlisted-entry");
    write_external_case(&fixture, "ex:Alice ex:knows ex:Bob .");
    fixture.write(
        "inference/case.ttl",
        &format!(
            r#"{}
<#unlisted>
    a sht:Infer;
    mf:status sht:approved;
    mf:action [ sht:dataGraph <data.ttl>; sht:shapesGraph <shapes.ttl> ];
    mf:result ((ex:Alice ex:knows ex:Carol)) .
"#,
            external_case("<result.ttl>", "")
        ),
    );

    let cases = discovered(&fixture)?;
    assert_eq!(cases.len(), 1, "only the mf:entries member is a test case");
    run_case(&cases[0], profiles(), &options())?;
    Ok(())
}

#[test]
fn rdf_nil_expected_graph_accepts_only_empty_inference() -> Result<(), Box<dyn Error>> {
    for (name, data, should_pass) in [
        ("empty-inference", "ex:Alice a ex:Other .", true),
        ("unexpected-inference", "ex:Alice a ex:Person .", false),
    ] {
        let fixture = TempFixture::new(name);
        write_external_case(&fixture, "ex:Alice ex:knows ex:Bob .");
        fixture.write("inference/case.ttl", &external_case("rdf:nil", ""));
        fixture.write("inference/data.ttl", &format!("{PREFIXES}\n{data}\n"));

        let cases = discovered(&fixture)?;
        assert_eq!(cases.len(), 1);
        let result = run_case(&cases[0], profiles(), &options());
        if should_pass {
            result?;
        } else {
            assert!(result.is_err(), "rdf:nil accepted a nonempty inference graph");
        }
    }
    Ok(())
}
