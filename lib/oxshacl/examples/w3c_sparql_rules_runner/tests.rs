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

const PINNED_INFERENCE_FILES: &[(&str, &str)] = &[
    ("SPARQLRuleTemplate-example-Multiply.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix shnex: <http://www.w3.org/ns/shacl-node-expr#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix sparql: <http://www.w3.org/ns/sparql#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:InferValueViaMultiply\n\ta sh:SPARQLRuleTemplate ;\n\trdfs:label \"Infer value via multiply\" ;\n\trdfs:subClassOf sh:Rule ;\n\trdfs:comment \"\"\"\n\t\tA reusable rule type that computes the value of a target property from the value\n\t\tof a source property (at the same subject $this), using a multiplier.\n\t\"\"\" ;\n\tsh:parameter [\n\t\ta sh:Parameter ;\n\t\tsh:path ex:sourceProperty ;\n\t\tsh:name \"source property\" ;\n\t\tsh:description \"The property containing the base value.\" ;\n\t\tsh:nodeKind sh:IRI ;\n\t] ;\n\tsh:parameter [\n\t\ta sh:Parameter ;\n\t\tsh:path ex:targetProperty ;\n\t\tsh:name \"target property\" ;\n\t\tsh:description \"The property that shall be inferred from the base value.\" ;\n\t\tsh:nodeKind sh:IRI ;\n\t] ;\n\tsh:parameter [\n\t\ta sh:Parameter ;\n\t\tsh:path ex:multiplier ;\n\t\tsh:name \"multiplier\" ;\n\t\tsh:description \"The multiplier that is applied to the base value.\" ;\n\t\tsh:datatype ( xsd:decimal xsd:integer ) ;\n\t] ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\t$this $targetProperty ?result .\n\t\t}\n\t\tWHERE {\n\t\t\t$this $sourceProperty ?baseValue .\n\t\t\tBIND (?baseValue * $multiplier AS ?result) .\n\t\t}\n\t\"\"\" .\n\nex:Measurement\n\ta sh:ShapeClass ;\n\tsh:property ex:Measurement-meters ;\n\tsh:property ex:Measurement-feet ;\n\tsh:rule ex:Measurement-feet-rule .\n\nex:Measurement-meters\n\ta sh:PropertyShape ;\n\tsh:path ex:meters ;\n\tsh:datatype xsd:decimal ;\n\tsh:unit \"m\" .\n\nex:Measurement-feet\n\ta sh:PropertyShape ;\n\tsh:path ex:feet ;\n\tsh:datatype xsd:decimal ;\n\tsh:unit \"ft\" .\n\nex:Measurement-feet-rule\n\ta ex:InferValueViaMultiply ;\n\tex:sourceProperty ex:meters ;\n\tex:targetProperty ex:feet ;\n\tex:multiplier 3.28084 .\n\nex:M1\n\ta ex:Measurement ;\n\tex:meters 2.0 .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <SPARQLRuleTemplate-example-Multiply>\n    ) .\n\n<SPARQLRuleTemplate-example-Multiply>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of a sh:SPARQLRuleTemplate as used in the spec\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n  \t( ex:M1 ex:feet 6.56168 )\n  ) ;\n  mf:status sht:approved ;\n.\n"),
    ("SPARQLRuleTemplate-example-SymmetricProperty.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix shnex: <http://www.w3.org/ns/shacl-node-expr#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix sparql: <http://www.w3.org/ns/sparql#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:SymmetricPropertyRule\n\ta sh:SPARQLRuleTemplate ;\n\trdfs:label \"Symmetric property rule template\" ;\n\trdfs:subClassOf sh:Rule ;\n\tsh:parameter [\n\t\ta sh:Parameter ;\n\t\tsh:path ex:property ;\n\t\tsh:name \"property\" ;\n\t\tsh:description \"The property that shall be treated as symmetric.\" ;\n\t\tsh:nodeKind sh:IRI ;\n\t] ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\t?o $property ?s .\n\t\t}\n\t\tWHERE {\n\t\t\t?s $property ?o .\n\t\t}\n\t\"\"\" .\n\nex:MarriedToRule\n\ta ex:SymmetricPropertyRule ;\n\tex:property ex:marriedTo .\n\nex:OverlapsRule\n\ta ex:SymmetricPropertyRule ;\n\tex:property ex:overlaps .\n\nex:John ex:marriedTo ex:Mary .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <SPARQLRuleTemplate-example-SymmetricProperty>\n    ) .\n\n<SPARQLRuleTemplate-example-SymmetricProperty>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of a sh:SPARQLRuleTemplate as used in the spec\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n  \t( ex:Mary ex:marriedTo ex:John )\n  ) ;\n  mf:status sht:approved ;\n.\n"),
    ("TripleRule-example-childCount.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix shnex: <http://www.w3.org/ns/shacl-node-expr#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n# This example also appears in the SHACL 1.2 SPARQL spec\n\nex:PersonShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Person ;\n\tsh:rule ex:PersonShape-childCount-rule .\n\nex:PersonShape-childCount-rule\n\ta sh:TripleRule ;\n\tsh:runOnce true ;\n\tsh:predicate ex:childCount ;\n\tsh:object [\n\t\tshnex:count [\n\t\t\tshnex:pathValues ex:child\n\t\t]\n\t] .\n\nex:Dad\n\ta ex:Person ;\n\tex:child ex:SomeDaughter ;\n\tex:child ex:SomeSon .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <TripleRule-example-childCount>\n    ) .\n\n<TripleRule-example-childCount>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of a TripleRule to compute childCount from the spec\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n\t( ex:Dad ex:childCount 2 )\n\t) ;\n  mf:status sht:approved ;\n.\n"),
    ("TripleRule-example-squares.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix shnex: <http://www.w3.org/ns/shacl-node-expr#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n# This example also appears in the SHACL 1.2 SPARQL spec\n\nex:Rectangle\n\ta sh:ShapeClass ;\n\trdfs:label \"Rectangle\" ;\n\tsh:property [\n\t\tsh:path ex:height ;\n\t\tsh:datatype xsd:integer ;\n\t\tsh:maxCount 1 ;\n\t\tsh:minCount 1 ;\n\t\tsh:name \"height\" ;\n\t] ;\n\tsh:property [\n\t\tsh:path ex:width ;\n\t\tsh:datatype xsd:integer ;\n\t\tsh:maxCount 1 ;\n\t\tsh:minCount 1 ;\n\t\tsh:name \"width\" ;\n\t] ;\n\tsh:rule [\n\t\ta sh:TripleRule ;\n\t\t# sh:subject defaults to the current focus node\n\t\tsh:predicate rdf:type ;\n\t\tsh:object ex:Square ;\n\t\tsh:condition ex:Rectangle ;\n\t\tsh:condition [\n\t\t\tsh:property [\n\t\t\t\tsh:path ex:width ;\n\t\t\t\tsh:equals ex:height ;\n\t\t\t] ;\n\t\t] ;\n\t] .\n\nex:InvalidRectangle\n\ta ex:Rectangle .\n\nex:NonSquareRectangle\n\ta ex:Rectangle ;\n\tex:height 2 ;\n\tex:width 3 .\n\nex:SquareRectangle\n\ta ex:Rectangle ;\n\tex:height 4 ;\n\tex:width 4 .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <TripleRule-example-squares>\n    ) .\n\n<TripleRule-example-squares>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of a TripleRule to classify square rectangles from the spec\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n\t( ex:SquareRectangle rdf:type ex:Square )\n\t) ;\n  mf:status sht:approved ;\n.\n"),
    ("expectedPredicate-example.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix shnex: <http://www.w3.org/ns/shacl-node-expr#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix sparql: <http://www.w3.org/ns/sparql#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RectangleShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:property ex:RectangleShape-area ;\n\tsh:rule ex:Rectangle-computeSmall .\n\nex:RectangleShape-area\n\ta sh:PropertyShape ;\n\tsh:path ex:area ;\n\tsh:defaultValue 1 ;\n\tsh:values [\n\t\tsparql:multiply ( [ shnex:pathValues ex:width ] [ shnex:pathValues ex:height ] )\n\t] .\n\nex:Rectangle-computeSmall\n\ta sh:SPARQLRule ;\n\trdfs:comment \"This rule expects that the values of ex:area have been derived.\" ;\n\tsh:expectedPredicate ex:area ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\t$this ex:isSmall true .\n\t\t}\n\t\tWHERE {\n\t\t\t$this ex:area ?area .\n\t\t\tFILTER (?area < 100) .\n\t\t}\n\t\"\"\" .\n\nex:IncompleteRectangle\n\ta ex:Rectangle .\n\nex:SmallRectangle\n\ta ex:Rectangle ;\n\tex:width 4 ;\n\tex:height 5 .\n\nex:LargeRectangle\n\ta ex:Rectangle ;\n\tex:width 11 ;\n\tex:height 10 .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <expectedPredicate-example>\n    ) .\n\n<expectedPredicate-example>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of sh:expectedPredicate as used in the spec\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n    ( ex:IncompleteRectangle ex:isSmall true )\n\t( ex:SmallRectangle ex:isSmall true )\n  ) ;\n  mf:status sht:approved ;\n  # This test requires a full NodeExpr implementation,\n  # which is not required to pass the SPARQL rules compliance\n  # TODO: Simpler tests that only rely on constant node expressions (Core)\n  sht:compliance sht:SPARQL, sht:NodeExpr ;  \n.\n"),
    ("global-symmetric.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:SymmetricPropertyRule\n\ta sh:SPARQLRule ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\t?o ?p ?s .\n\t\t}\n\t\tWHERE {\n\t\t\t?p a ex:SymmetricProperty .\n\t\t\t?s ?p ?o .\n\t\t}\n\t\t\"\"\" .\n\nex:friend a ex:SymmetricProperty .\n\nex:Bob ex:friend ex:Caren .\nex:Caren ex:friend ex:Debbie .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <global-symmetric>\n    ) .\n\n<global-symmetric>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of a global rule computing symmetric triples\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n    ( ex:Caren ex:friend ex:Bob )\n    ( ex:Debbie ex:friend ex:Caren )\n  ) ;\n  mf:status sht:approved .\n"),
    ("layers-example-results.ttl", "<http://example.com/x1>\n        <http://example.com/connected>  <http://example.com/x5> , <http://example.com/x4> , <http://example.com/x3> , <http://example.com/x2>;\n        <http://example.com/link>       <http://example.com/x2>;\n        <http://example.com/status>     \":x1 is connected to :x4\" , \":x1 is connected to :x5\" .\n\n<http://example.com/x2>\n        <http://example.com/connected>  <http://example.com/x5> , <http://example.com/x4> , <http://example.com/x3>;\n        <http://example.com/link>       <http://example.com/x3> .\n\n<http://example.com/x3>\n        <http://example.com/connected>  <http://example.com/x5> , <http://example.com/x4>;\n        <http://example.com/link>       <http://example.com/x4> .\n\n<http://example.com/x4>\n        <http://example.com/connected>  <http://example.com/x5>;\n        <http://example.com/link>       <http://example.com/x5> .\n"),
    ("layers-example.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n# Origin: https://github.com/w3c/data-shapes/issues/1069#issuecomment-5078462191\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" ;\n      sh:prefix \"rdf\" ;\n  ] ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/ns/shacl#\" ;\n      sh:prefix \"sh\" ;\n  ] ;\n  sh:declare [\n      sh:namespace \"http://example.com/\" ;\n      sh:prefix \"\" ;\n    ] .\n\n\nex:InitRule\n    a sh:SPARQLRule ;\n    sh:runOnce true ;\n    sh:construct \"\"\"\n        CONSTRUCT {\n            :x1 :link :x2 .\n            :x2 :link :x3 .\n            :x3 :link :x4 .\n            :x4 :link :x5 .\n        }\n        WHERE {\n\n        }\n    \"\"\" .\n\nex:Rule1\n    a sh:SPARQLRule ;\n    sh:layer 0 ;\n    sh:construct \"\"\"\n        CONSTRUCT { ?a :connected ?b } WHERE { ?a :link ?b }\n    \"\"\" .\n\nex:Rule2\n    a sh:SPARQLRule ;\n    sh:layer 0 ;\n    sh:construct \"\"\"\n        CONSTRUCT { ?a :connected ?b .} WHERE { ?a :connected/:connected ?b }\n    \"\"\" .\n\nex:RuleQ3\n    a sh:SPARQLRule ;\n    sh:layer 1 ;\n    sh:construct \"\"\"\n        CONSTRUCT { :x1 :status \":x1 not connected to :x4\" } WHERE { FILTER NOT EXISTS { :x1 :connected :x4 } }\n    \"\"\" .\n\nex:RuleQ4\n    a sh:SPARQLRule ;\n    sh:layer 1 ;\n    sh:construct \"\"\"\n        CONSTRUCT { :x1 :status \":x1 is connected to :x4\" } WHERE { :x1 :connected :x4 }\n    \"\"\" .\n\nex:RuleQ5\n    a sh:SPARQLRule ;\n    sh:layer 1 ;\n    sh:construct \"\"\"\n        CONSTRUCT { :x1 :status \":x1 is not connected to :x5\" } WHERE { FILTER NOT EXISTS { :x1 :connected :x5 } }\n    \"\"\" .\n\nex:RuleQ6\n    a sh:SPARQLRule ;\n    sh:layer 1 ;\n    sh:construct \"\"\"\n        CONSTRUCT { :x1 :status \":x1 is connected to :x5\" } WHERE { :x1 :connected :x5 }\n    \"\"\" .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <layers-example>\n    ) .\n\n<layers-example>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of sh:layer\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result <layers-example-results.ttl> ;\n  mf:status sht:approved ;\n.\n"),
    ("manifest.ttl", "@prefix mf:      <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sht:     <http://www.w3.org/ns/shacl-test#> .\n\n<>\n\ta mf:Manifest ;\n\tmf:include <expectedPredicate-example.ttl> ;\n\tmf:include <global-symmetric.ttl> ;\n\tmf:include <layers-example.ttl> ;\n\tmf:include <rectangle-condition.ttl> ;\n\tmf:include <rectangle-deactivated.ttl> ;\n\tmf:include <rectangle-order.ttl> ;\n\tmf:include <rectangle-prefixes.ttl> ;\n\tmf:include <rectangle-simple.ttl> ;\n\tmf:include <run-once-example.ttl> ;\n\tmf:include <same-order.ttl> ;\n\tmf:include <SPARQLRuleTemplate-example-Multiply.ttl> ;\n\tmf:include <SPARQLRuleTemplate-example-SymmetricProperty.ttl> ;\n\tmf:include <temp-triples-example.ttl> ;\n\tmf:include <TripleRule-example-childCount.ttl> ;\n\tmf:include <TripleRule-example-squares.ttl> ;\n\tmf:include <rdfs/manifest.ttl> ;\n\t."),
    ("rdfs/data-rdfs-domain-1.ttl", "PREFIX :      <http://example/>\nPREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> \nPREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>\n\n:p rdfs:domain :T.\n\n:s :p \"123\" .\n"),
    ("rdfs/data-rdfs-domain-2.ttl", "PREFIX :      <http://example/>\nPREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> \nPREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>\n\n:p rdfs:domain :T1 .\n:T1 rdfs:subClassOf :T2 .\n\n:s :p \"123\" .\n"),
    ("rdfs/data-rdfs-range-1.ttl", "PREFIX :      <http://example/>\nPREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> \nPREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>\n\n:p rdfs:range :T.\n\n:s :p :o .\n\n"),
    ("rdfs/data-rdfs-range-2.ttl", "PREFIX :      <http://example/>\nPREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> \nPREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>\n\n:p rdfs:range :T1 .\n:T1 rdfs:subClassOf :T2 .\n\n:s :p :o .\n"),
    ("rdfs/data-rdfs-subclass-1.ttl", "PREFIX :      <http://example/>\nPREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nPREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>\n\n:A rdf:type :S .\n\n:S  rdfs:subClassOf :T1 .\n\n:T1 rdfs:subClassOf :T2 .\n"),
    ("rdfs/data-rdfs-subproperty-1.ttl", "PREFIX :      <http://example/>\nPREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nPREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>\n\n:s :p :o .\n\n:p  rdfs:subPropertyOf :p1 .\n:p1 rdfs:subPropertyOf :p2 .\n"),
    ("rdfs/manifest.ttl", "@prefix mf:      <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sht:     <http://www.w3.org/ns/shacl-test#> .\n\n<>\n\ta mf:Manifest ;\n\tmf:include <rdfs-domain-1.ttl> ;\n\tmf:include <rdfs-domain-2.ttl> ;\n\tmf:include <rdfs-range-1.ttl> ;\n\tmf:include <rdfs-range-2.ttl> ;\n\tmf:include <rdfs-subclass-1.ttl> ;\n\tmf:include <rdfs-subproperty-1.ttl> ;\n\t."),
    ("rdfs/rdfs-domain-1.ttl", "@prefix : <http://example/> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rdfs-domain-1>\n    ) .\n\n<rdfs-domain-1>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of RDFS rules\" ;\n  mf:action [\n      sht:dataGraph <data-rdfs-domain-1.ttl> ;\n      sht:shapesGraph <rdfs.rules.ttl> ;\n    ] ;\n  mf:result (\n    ( :s rdf:type :T ) \n  ) ;\n  mf:status sht:approved .\n"),
    ("rdfs/rdfs-domain-2.ttl", "@prefix : <http://example/> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rdfs-domain-2>\n    ) .\n\n<rdfs-domain-2>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of RDFS rules\" ;\n  mf:action [\n      sht:dataGraph <data-rdfs-domain-2.ttl> ;\n      sht:shapesGraph <rdfs.rules.ttl> ;\n    ] ;\n  mf:result (\n    ( :s rdf:type :T1 )\n    ( :s rdf:type :T2 )\n  ) ;\n  mf:status sht:approved .\n"),
    ("rdfs/rdfs-range-1.ttl", "@prefix : <http://example/> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rdfs-range-1>\n    ) .\n\n<rdfs-range-1>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of RDFS rules\" ;\n  mf:action [\n      sht:dataGraph <data-rdfs-range-1.ttl> ;\n      sht:shapesGraph <rdfs.rules.ttl> ;\n    ] ;\n  mf:result (\n    ( :o rdf:type :T )\n  ) ;\n  mf:status sht:approved .\n\n"),
    ("rdfs/rdfs-range-2.ttl", "@prefix : <http://example/> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rdfs-range-2>\n    ) .\n\n<rdfs-range-2>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of RDFS rules\" ;\n  mf:action [\n      sht:dataGraph <data-rdfs-range-2.ttl> ;\n      sht:shapesGraph <rdfs.rules.ttl> ;\n    ] ;\n  mf:result (\n    ( :o rdf:type :T1 )\n    ( :o rdf:type :T2 )\n  ) ;\n  mf:status sht:approved .\n"),
    ("rdfs/rdfs-subclass-1.ttl", "@prefix : <http://example/> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rdfs-subclass-1>\n    ) .\n\n<rdfs-subclass-1>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of RDFS rules\" ;\n  mf:action [\n      sht:dataGraph <data-rdfs-subclass-1.ttl> ;\n      sht:shapesGraph <rdfs.rules.ttl> ;\n    ] ;\n  mf:result (\n    ( :S rdfs:subClassOf :T2 )\n    ( :A rdf:type :T1 )\n    ( :A rdf:type :T2 )\n  ) ;\n  mf:status sht:approved .\n"),
    ("rdfs/rdfs-subproperty-1.ttl", "@prefix : <http://example/> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rdfs-subproperty-1>\n    ) .\n\n<rdfs-subproperty-1>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of RDFS rules\" ;\n  mf:action [\n      sht:dataGraph <data-rdfs-subproperty-1.ttl> ;\n      sht:shapesGraph <rdfs.rules.ttl> ;\n    ] ;\n  mf:result (\n    ( :p rdfs:subPropertyOf :p2 )\n    ( :s :p1 :o )\n    ( :s :p2 :o )\n  ) ;\n  mf:status sht:approved .\n\n"),
    ("rdfs/rdfs.rules.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" ;\n      sh:prefix \"rdf\" ;\n  ] ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/2000/01/rdf-schema#\" ;\n      sh:prefix \"rdfs\" ;\n  ] ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/ns/shacl#\" ;\n      sh:prefix \"sh\" ;\n  ] .\n\nex:subClassOf1\n    a sh:SPARQLRule ;\n    sh:construct \"CONSTRUCT { ?a rdfs:subClassOf ?c } WHERE { ?a rdfs:subClassOf ?b . ?b rdfs:subClassOf ?c }\" .\n\nex:subClassOf2\n    a sh:SPARQLRule ;\n    sh:construct \"CONSTRUCT { ?a rdf:type ?y } WHERE { ?a rdf:type ?x . ?x rdfs:subClassOf ?y }\" .\n\nex:subPropertyOf1\n    a sh:SPARQLRule ;\n    sh:construct \"CONSTRUCT { ?a rdfs:subPropertyOf ?c } WHERE { ?a rdfs:subPropertyOf ?b . ?b rdfs:subPropertyOf ?c }\" .\n\nex:subPropertyOf2\n    a sh:SPARQLRule ;\n    sh:construct \"CONSTRUCT { ?a ?prop ?o } WHERE { ?a ?subProp ?o . ?subProp rdfs:subPropertyOf ?prop }\" .\n\nex:domain\n    a sh:SPARQLRule ;\n    sh:construct \"CONSTRUCT { ?a rdf:type ?y } WHERE { ?a ?p ?o . ?p rdfs:domain ?y }\" .\n\nex:range\n    a sh:SPARQLRule ;\n    sh:construct \"CONSTRUCT { ?a rdf:type ?y } WHERE { ?s ?p ?a . ?p rdfs:range ?y }\" .\n"),
    ("rdfs/rdfs1.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RectangleShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:property [\n\t\tsh:path ex:requiredProperty ;\n\t\tsh:minCount 1 ;\n\t] ;\n\tsh:property [\n\t\tsh:path ex:width ;\n\t\tsh:datatype xsd:integer ;\n\t\tsh:minCount 1 ;\n\t\tsh:maxCount 1 ;\n\t] ;\n\tsh:property [\n\t\tsh:path ex:height ;\n\t\tsh:datatype xsd:integer ;\n\t\tsh:minCount 1 ;\n\t\tsh:maxCount 1 ;\n\t] .\n\nex:RectangleRulesShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:rule [\n\t\ta sh:SPARQLRule ;\n\t\tsh:prefixes ex: ;\n\t\tsh:construct \"\"\"\n\t\t\tCONSTRUCT {\n\t\t\t\t$this ex:area ?area .\n\t\t\t}\n\t\t\tWHERE {\n\t\t\t\t$this ex:width ?width .\n\t\t\t\t$this ex:height ?height .\n\t\t\t\tBIND (?width * ?height AS ?area) .\n\t\t\t}\n\t\t\t\"\"\" ;\n\t\tsh:condition ex:RectangleShape ;    # Rule only applies to Rectangles that conform to ex:RectangleShape\n\t] ;\n.\n\nex:ExampleRectangle\n\ta ex:Rectangle ;\n\tex:requiredProperty true ;\n\tex:width 7 ;\n\tex:height 8 .\n\nex:InvalidRectangle    # Lacks a value for ex:requiredProperty, so sh:condition is not met\n\ta ex:Rectangle ;\n\tex:width 7 ;\n\tex:height 7 .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rectangle-condition>\n    ) .\n\n<rectangle-condition>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test with two rectangles, one of which violates the sh:condition\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n    ( ex:ExampleRectangle ex:area 56 )\n  ) ;\n  mf:status sht:approved ;\n.\n"),
    ("rectangle-condition.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RectangleShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:property [\n\t\tsh:path ex:requiredProperty ;\n\t\tsh:minCount 1 ;\n\t] ;\n\tsh:property [\n\t\tsh:path ex:width ;\n\t\tsh:datatype xsd:integer ;\n\t\tsh:minCount 1 ;\n\t\tsh:maxCount 1 ;\n\t] ;\n\tsh:property [\n\t\tsh:path ex:height ;\n\t\tsh:datatype xsd:integer ;\n\t\tsh:minCount 1 ;\n\t\tsh:maxCount 1 ;\n\t] .\n\nex:RectangleRulesShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:rule [\n\t\ta sh:SPARQLRule ;\n\t\tsh:prefixes ex: ;\n\t\tsh:construct \"\"\"\n\t\t\tCONSTRUCT {\n\t\t\t\t$this ex:area ?area .\n\t\t\t}\n\t\t\tWHERE {\n\t\t\t\t$this ex:width ?width .\n\t\t\t\t$this ex:height ?height .\n\t\t\t\tBIND (?width * ?height AS ?area) .\n\t\t\t}\n\t\t\t\"\"\" ;\n\t\tsh:condition ex:RectangleShape ;    # Rule only applies to Rectangles that conform to ex:RectangleShape\n\t] ;\n.\n\nex:ExampleRectangle\n\ta ex:Rectangle ;\n\tex:requiredProperty true ;\n\tex:width 7 ;\n\tex:height 8 .\n\nex:InvalidRectangle    # Lacks a value for ex:requiredProperty, so sh:condition is not met\n\ta ex:Rectangle ;\n\tex:width 7 ;\n\tex:height 7 .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rectangle-condition>\n    ) .\n\n<rectangle-condition>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test with two rectangles, one of which violates the sh:condition\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n    ( ex:ExampleRectangle ex:area 56 )\n  ) ;\n  mf:status sht:approved ;\n.\n"),
    ("rectangle-deactivated.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RectangleRulesShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:rule [\n\t\ta sh:SPARQLRule ;\n\t\tsh:prefixes ex: ;\n\t\tsh:construct \"\"\"\n\t\t\tCONSTRUCT {\n\t\t\t\t$this ex:area ?area .\n\t\t\t}\n\t\t\tWHERE {\n\t\t\t\t$this ex:width ?width .\n\t\t\t\t$this ex:height ?height .\n\t\t\t\tBIND (?width * ?height AS ?area) .\n\t\t\t}\n\t\t\t\"\"\" ;\n\t\tsh:deactivated true ;\n\t] .\n\nex:ExampleRectangle\n\ta ex:Rectangle ;\n\tex:width 7 ;\n\tex:height 8 .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rectangle-deactivated>\n    ) .\n\n<rectangle-deactivated>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of a deactivated rule, inferring nothing\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n  ) ;\n  mf:status sht:approved .\n"),
    ("rectangle-order.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RectangleRulesShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:rule [\n\t\ta sh:SPARQLRule ;\n\t\tsh:order 1 ;\n\t\tsh:prefixes ex: ;\n\t\tsh:construct \"\"\"\n\t\t\tCONSTRUCT {\n\t\t\t\t$this ex:area ?area .\n\t\t\t}\n\t\t\tWHERE {\n\t\t\t\t$this ex:width ?width .\n\t\t\t\t$this ex:height ?height .\n\t\t\t\tBIND (?width * ?height AS ?area) .\n\t\t\t}\n\t\t\t\"\"\" ;\n\t] ;\n\tsh:rule [\n\t\ta sh:SPARQLRule ;\n\t\tsh:order 2 ;\n\t\tsh:prefixes ex: ;\n\t\tsh:construct \"\"\"\n\t\t\tCONSTRUCT {\n\t\t\t\t$this ex:areaPlusOne ?plusOne .\n\t\t\t}\n\t\t\tWHERE {\n\t\t\t\t$this ex:area ?area .\n\t\t\t\tBIND (?area + 1 AS ?plusOne) .\n\t\t\t}\n\t\t\t\"\"\" ;\n\t] .\n\nex:ExampleRectangle\n\ta ex:Rectangle ;\n\tex:width 7 ;\n\tex:height 8 .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rectangle-order>\n    ) .\n\n<rectangle-order>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of area calculation followed by a depending calculation, in order\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n    ( ex:ExampleRectangle ex:area 56 )\n    ( ex:ExampleRectangle ex:areaPlusOne 57 )\n  ) ;\n  mf:status sht:approved .\n"),
    ("rectangle-prefixes.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RectangleRulesShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:rule [\n\t\ta sh:SPARQLRule ;\n\t\tsh:construct \"\"\"\n\t\t\tCONSTRUCT {\n\t\t\t\t$this ex:area ?area .\n\t\t\t}\n\t\t\tWHERE {\n\t\t\t\t$this ex:width ?width .\n\t\t\t\t$this ex:height ?height .\n\t\t\t\tBIND (?width * ?height AS ?area) .\n\t\t\t}\n\t\t\t\"\"\" ;\n\t] .\n\nex:ExampleRectangle\n\ta ex:Rectangle ;\n\tex:width 7 ;\n\tex:height 8 .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rectangle-prefixes>\n    ) .\n\n<rectangle-prefixes>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of rule that uses the implicit prefix declarations from the sh:ShapesGraph\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n    ( ex:ExampleRectangle ex:area 56 )\n  ) ;\n  mf:status sht:approved ;\n.\n"),
    ("rectangle-simple.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RectangleRulesShape\n\ta sh:NodeShape ;\n\tsh:targetClass ex:Rectangle ;\n\tsh:rule [\n\t\ta sh:SPARQLRule ;\n\t\tsh:prefixes ex: ;\n\t\tsh:construct \"\"\"\n\t\t\tCONSTRUCT {\n\t\t\t\t$this ex:area ?area .\n\t\t\t}\n\t\t\tWHERE {\n\t\t\t\t$this ex:width ?width .\n\t\t\t\t$this ex:height ?height .\n\t\t\t\tBIND (?width * ?height AS ?area) .\n\t\t\t}\n\t\t\t\"\"\" ;\n\t] .\n\nex:ExampleRectangle\n\ta ex:Rectangle ;\n\tex:width 7 ;\n\tex:height 8 .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <rectangle-simple>\n    ) .\n\n<rectangle-simple>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of simple area calculation using rectangle rule\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n    ( ex:ExampleRectangle ex:area 56 )\n  ) ;\n  mf:status sht:approved .\n"),
    ("run-once-example.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n# This example also appears in the SHACL 1.2 SPARQL spec\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" ;\n      sh:prefix \"rdf\" ;\n  ] ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/ns/shacl#\" ;\n      sh:prefix \"sh\" ;\n  ] ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RunBeforeRule\n\ta sh:SPARQLRule ;\n\tsh:runOnce true ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\tex:Grandma a ex:Person .\n\t\t\tex:Son a ex:Person .\n\t\t\tex:Grandson a ex:Person .\n\t\t\tex:Granddaughter a ex:Person .\n\t\t\tex:Grandma ex:child ex:Son .\n\t\t\tex:Son ex:child ex:Grandson .\n\t\t\tex:Son ex:child ex:Granddaughter .\n\t\t}\n\t\tWHERE {\n\t\t}\n\t\t\"\"\" .\n\nex:Person\n\ta sh:ShapeClass ;\n\tsh:rule ex:IteratingRule ;\n\tsh:rule ex:RunAfterRule .\n\nex:IteratingRule\n\ta sh:SPARQLRule ;\n\trdfs:comment \"This is a recursive rule that needs to iterate multiple times.\" ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\t$this ex:offspring ?offspring .\n\t\t}\n\t\tWHERE {\n\t\t\t$this ex:child/ex:offspring? ?offspring .\n\t\t}\n\t\t\"\"\" .\n\nex:RunAfterRule\n\ta sh:SPARQLRule ;\n\tsh:runOnce true ;\n\tsh:layer 1 ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\t?reifier rdf:reifies ?triple .\n\t\t\t?reifier ex:source sh:RulesEntailment .\n\t\t}\n\t\tWHERE {\n\t\t\t$this ex:offspring ?offspring .\n\t\t\tBIND (BNODE() AS ?reifier) .\n\t\t\tBIND (TRIPLE($this, ex:offspring, ?offspring) AS ?triple) .\n\t\t}\n\t\t\"\"\" .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <run-once-example>\n    ) .\n\n<run-once-example>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of sh:runOnce from the spec\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n\t( ex:Grandma rdf:type ex:Person )\n\t( ex:Grandma ex:child ex:Son )\n\t( ex:Grandma ex:offspring ex:Son )\n\t\t( _:b1 rdf:reifies <<( ex:Grandma ex:offspring ex:Son )>> )\n\t\t( _:b1 ex:source sh:RulesEntailment )\n\t( ex:Grandma ex:offspring ex:Grandson )\n\t\t( _:b2 rdf:reifies <<( ex:Grandma ex:offspring ex:Grandson )>> )\n\t\t( _:b2 ex:source sh:RulesEntailment )\n\t( ex:Grandma ex:offspring ex:Granddaughter )\n\t\t( _:b3 rdf:reifies <<( ex:Grandma ex:offspring ex:Granddaughter )>> )\n\t\t( _:b3 ex:source sh:RulesEntailment )\n\n\t( ex:Son rdf:type ex:Person )\n\t( ex:Son ex:child ex:Grandson )\n\t( ex:Son ex:child ex:Granddaughter )\n\t( ex:Son ex:offspring ex:Grandson )\n\t\t( _:b4 rdf:reifies <<( ex:Son ex:offspring ex:Grandson )>> )\n\t\t( _:b4 ex:source sh:RulesEntailment )\n\t( ex:Son ex:offspring ex:Granddaughter )\n\t\t( _:b5 rdf:reifies <<( ex:Son ex:offspring ex:Granddaughter )>> )\n\t\t( _:b5 ex:source sh:RulesEntailment )\n\n\t( ex:Grandson rdf:type ex:Person )\n\n\t( ex:Granddaughter rdf:type ex:Person )\n\t) ;\n  mf:status sht:approved ;\n.\n"),
    ("same-order.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\nex:\n  a sh:RulesGraph ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:RuleP\n    a sh:SPARQLRule ;\n    sh:construct \"\"\"\n        CONSTRUCT { ?this ex:p true }\n        WHERE { ?this a ex:Node . FILTER NOT EXISTS { ?this ex:q true } }\n        \"\"\" .\n\nex:RuleQ\n    a sh:SPARQLRule ;\n    sh:construct \"\"\"\n        CONSTRUCT { ?this ex:q true }\n        WHERE { ?this a ex:Node . FILTER NOT EXISTS { ?this ex:p true } }\n        \"\"\" .\n\nex:SomeNode\n    a ex:Node .\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <same-order>\n    ) .\n\n<same-order>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of two rules that have the same order (and layer), making sure they don't see each other's triples\" ;\n  rdfs:seeAlso <https://github.com/w3c/data-shapes/issues/1226#issue-5313787732> ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n    ( ex:SomeNode ex:p true )\n    ( ex:SomeNode ex:q true )\n  ) ;\n  mf:status sht:approved .\n"),
    ("temp-triples-example.ttl", "@prefix ex: <http://example.com/ns#> .\n@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix sht: <http://www.w3.org/ns/shacl-test#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n# A variation of this example also appears in the SHACL 1.2 SPARQL spec\n\nex:\n  a sh:ShapesGraph ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" ;\n      sh:prefix \"rdf\" ;\n  ] ;\n  sh:declare [\n      sh:namespace \"http://www.w3.org/ns/shacl#\" ;\n      sh:prefix \"sh\" ;\n  ] ;\n  sh:declare [\n      sh:namespace \"http://example.com/ns#\" ;\n      sh:prefix \"ex\" ;\n    ] .\n\nex:Person\n\ta sh:ShapeClass ;\n\tsh:rule ex:CollectOffspringsRule ;\n\tsh:rule ex:SetYoungestOffspringsRule .\n\nex:CollectOffspringsRule\n\ta sh:SPARQLRule ;\n\tsh:layer 0 ;\n\tsh:runOnce true ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\t$this ex:offspring ?offspring .\n\t\t\t?reifier sh:tempTriple true .\n\t\t\t?reifier rdf:reifies ?tt .\n\t\t}\n\t\tWHERE {\n\t\t\t$this ex:child+ ?offspring .\n\t\t\tBIND (BNODE() AS ?reifier) .\n\t\t\tBIND (TRIPLE($this, ex:offspring, ?offspring) AS ?tt) .\n\t\t}\n\t\"\"\" .\n\nex:SetYoungestOffspringsRule\n\ta sh:SPARQLRule ;\n\tsh:layer 1 ;\n\tsh:construct \"\"\"\n\t\tCONSTRUCT {\n\t\t\t$this ex:youngestOffspring ?o .\n\t\t}\n\t\tWHERE {\n\t\t\t{\n\t\t\t\tSELECT $this ?o\n\t\t\t\tWHERE {\n\t\t\t\t\t$this ex:offspring ?o .\n\t\t\t\t\t?o ex:age ?age .\n\t\t\t\t}\n\t\t\t\tORDER BY ?age\n\t\t\t\tLIMIT 1\n\t\t\t}\n\t\t}\n\t\"\"\" .\n\nex:Grandma\n\ta ex:Person ; \n\tex:age 80 ;\n\tex:child ex:Son .\n\nex:Son\n\ta ex:Person ;\n\tex:age 40 ;\n\tex:child ex:Grandson, ex:Granddaughter .\n\nex:Grandson\n\ta ex:Person ;\n\tex:age 22 .\n\nex:Granddaughter\n\ta ex:Person ;\n\tex:age 19 .\n\n\n<>\n  rdf:type mf:Manifest ;\n  mf:entries (\n      <temp-triples-example>\n    ) .\n\n<temp-triples-example>\n  rdf:type sht:Infer ;\n  rdfs:label \"Test of sh:tempTriple similar to the one from the spec\" ;\n  mf:action [\n      sht:dataGraph <> ;\n      sht:shapesGraph <> ;\n    ] ;\n  mf:result (\n\t( ex:Grandma ex:youngestOffspring ex:Granddaughter )\n\t( ex:Son ex:youngestOffspring ex:Granddaughter )\n\t) ;\n  mf:status sht:approved ;\n.\n"),
];

fn pinned_inference_fixture(name: &str) -> TempFixture {
    let fixture = TempFixture::new(name);
    for (relative_path, content) in PINNED_INFERENCE_FILES {
        fixture.write(relative_path, content);
    }
    fixture
}

fn pinned_inference_file(relative_path: &str) -> &'static str {
    PINNED_INFERENCE_FILES
        .iter()
        .find_map(|(path, content)| (*path == relative_path).then_some(*content))
        .unwrap_or_else(|| panic!("missing pinned inference fixture {relative_path}"))
}
#[test]
fn unsupported_declaration_table_is_exact_and_bounded() {
    let mut actual = UNSUPPORTED_INFERENCE_CASES
        .iter()
        .map(|entry| {
            (
                entry.relative_path,
                entry.test_id,
                entry.requirement,
                entry.sources.len(),
            )
        })
        .collect::<Vec<_>>();
    actual.sort_unstable();
    let mut expected = vec![
        ("SPARQLRuleTemplate-example-Multiply.ttl", "SPARQLRuleTemplate-example-Multiply", "requires-sh:SPARQLRuleTemplate", 1),
        ("SPARQLRuleTemplate-example-SymmetricProperty.ttl", "SPARQLRuleTemplate-example-SymmetricProperty", "requires-sh:SPARQLRuleTemplate", 1),
        ("TripleRule-example-childCount.ttl", "TripleRule-example-childCount", "requires-rdf-sh:TripleRule-compilation", 1),
        ("TripleRule-example-squares.ttl", "TripleRule-example-squares", "requires-rdf-sh:TripleRule-compilation", 1),
        ("layers-example.ttl", "layers-example", "requires-sh:layer-and-sh:runOnce", 2),
        ("run-once-example.ttl", "run-once-example", "requires-sh:runOnce", 1),
        ("temp-triples-example.ttl", "temp-triples-example", "requires-temporary-triple-semantics", 1),
    ];
    expected.sort_unstable();
    assert_eq!(actual, expected);
}

#[cfg(feature = "rdf-12")]
#[test]
fn pinned_corpus_intercepts_all_unsupported_and_executes_all_selected_cases(
) -> Result<(), Box<dyn Error>> {
    assert_eq!(PINNED_INFERENCE_FILES.len(), 32);
    assert_eq!(
        PINNED_INFERENCE_FILES
            .iter()
            .map(|(_, content)| content.len())
            .sum::<usize>(),
        38_323,
    );
    let fixture = pinned_inference_fixture("pinned-complete-corpus");
    let cases = discovered(&fixture)?;
    assert_eq!(cases.len(), 21);
    assert!(cases.iter().all(|case| {
        relative_path(&case.root, &case.manifest_path)
            .map(|path| path != "rdfs/rdfs1.ttl")
            .unwrap_or(false)
    }));

    let mut selected = 0;
    let mut unsupported = Vec::new();
    for case in &cases {
        if let Some(disposition) = predeclared_unsupported(case)? {
            unsupported.push((disposition.test_id, disposition.requirement));
        } else {
            run_case(case, profiles(), &options())?;
            selected += 1;
        }
    }
    unsupported.sort_unstable();
    assert_eq!(selected, 14);
    assert_eq!(unsupported.len(), 7);
    let mut declared = UNSUPPORTED_INFERENCE_CASES
        .iter()
        .map(|entry| (entry.test_id, entry.requirement))
        .collect::<Vec<_>>();
    declared.sort_unstable();
    assert_eq!(unsupported, declared);
    Ok(())
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn pinned_rdf_12_fixture_is_rejected_without_rdf_12() -> Result<(), Box<dyn Error>> {
    assert_eq!(PINNED_INFERENCE_FILES.len(), 32);
    assert_eq!(
        PINNED_INFERENCE_FILES
            .iter()
            .map(|(_, content)| content.len())
            .sum::<usize>(),
        38_323,
    );
    let fixture = pinned_inference_fixture("pinned-rdf12-disabled");
    let run_once = fixture.path.join("run-once-example.ttl");
    assert_eq!(
        sha256_file(&run_once)?,
        "740a64ee711a34a905dc57646ce756d8790de0ad5cc67fb91aec87c56113c45b",
    );
    assert!(pinned_inference_file("run-once-example.ttl").contains("<<("));

    let error = match discovered(&fixture) {
        Ok(_) => return Err("RDF 1.2 fixture parsed while rdf-12 was disabled".into()),
        Err(error) => error,
    };
    assert!(error.contains("failed to parse manifest"));
    assert!(error.contains("run-once-example.ttl"));
    assert!(error.contains("<<("));
    Ok(())
}

#[test]
fn exact_predeclared_case_is_intercepted_and_identity_or_hash_drift_fails(
) -> Result<(), Box<dyn Error>> {
    let original = pinned_inference_file("TripleRule-example-childCount.ttl");

    let fixture = TempFixture::new("predeclared-exact");
    write_root(&fixture, "TripleRule-example-childCount.ttl");
    fixture.write("TripleRule-example-childCount.ttl", original);
    let cases = discovered(&fixture)?;
    let disposition = predeclared_unsupported(&cases[0])?
        .expect("the exact pinned case must be intercepted before compile/execute");
    assert_eq!(disposition.requirement, "requires-rdf-sh:TripleRule-compilation");

    let hash_drift = TempFixture::new("predeclared-hash-drift");
    write_root(&hash_drift, "TripleRule-example-childCount.ttl");
    hash_drift.write(
        "TripleRule-example-childCount.ttl",
        &format!("{original}\n# source drift\n"),
    );
    let cases = discovered(&hash_drift)?;
    assert!(predeclared_unsupported(&cases[0]).is_err());

    let identity_drift = TempFixture::new("predeclared-identity-drift");
    write_root(&identity_drift, "TripleRule-example-childCount.ttl");
    identity_drift.write(
        "TripleRule-example-childCount.ttl",
        &original.replace(
            "<TripleRule-example-childCount>",
            "<TripleRule-example-childCount-drift>",
        ),
    );
    let cases = discovered(&identity_drift)?;
    assert!(predeclared_unsupported(&cases[0]).is_err());

    let path_drift = TempFixture::new("predeclared-path-drift");
    write_root(&path_drift, "renamed.ttl");
    path_drift.write("renamed.ttl", original);
    let cases = discovered(&path_drift)?;
    assert!(predeclared_unsupported(&cases[0]).is_err());
    Ok(())
}

#[test]
fn selected_cases_cannot_become_unsupported() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("selected-remains-selected");
    write_external_case(&fixture, "ex:Alice ex:knows ex:Bob .");
    let cases = discovered(&fixture)?;
    assert!(predeclared_unsupported(&cases[0])?.is_none());
    run_case(&cases[0], profiles(), &options())?;
    Ok(())
}

#[test]
fn source_verification_rejects_undeclared_resolved_references() -> Result<(), Box<dyn Error>> {
    let fixture = TempFixture::new("undeclared-reference");
    write_external_case(&fixture, "ex:Alice ex:knows ex:Bob .");
    let cases = discovered(&fixture)?;
    let wrapper = cases[0].manifest_path.clone();
    let relative_path = Box::leak(
        wrapper
            .strip_prefix(&cases[0].root)?
            .to_string_lossy()
            .into_owned()
            .into_boxed_str(),
    );
    let digest = Box::leak(sha256_file(&wrapper)?.into_boxed_str());
    let expected = [ExpectedSource {
        relative_path,
        sha256: digest,
    }];
    assert!(verify_case_sources(&cases[0], &expected).is_err());
    Ok(())
}

#[test]
fn exit_disposition_obeys_conservation_and_unsupported_contract() {
    let passing = Totals {
        discovered: 14,
        eligible: 14,
        passed: 14,
        unsupported: 0,
        failed: 0,
        excluded: 0,
    };
    assert!(totals_are_conserved(&passing));
    assert_eq!(exit_code(&passing), 0);

    let unsupported = Totals {
        discovered: 21,
        eligible: 21,
        passed: 14,
        unsupported: 7,
        failed: 0,
        excluded: 0,
    };
    assert!(totals_are_conserved(&unsupported));
    assert_eq!(exit_code(&unsupported), 2);

    let failed = Totals {
        failed: 1,
        passed: 13,
        ..unsupported
    };
    assert!(totals_are_conserved(&failed));
    assert_eq!(exit_code(&failed), 1);

    let incomplete = Totals {
        discovered: 21,
        eligible: 20,
        passed: 13,
        unsupported: 7,
        failed: 0,
        excluded: 0,
    };
    assert!(!totals_are_conserved(&incomplete));
    assert_eq!(exit_code(&incomplete), 1);
    assert_eq!(exit_code(&Totals::default()), 1);
}
