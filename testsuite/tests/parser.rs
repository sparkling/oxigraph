#![cfg(test)]

use anyhow::{Context, Result, ensure};
use oxigraph_testsuite::check_testsuite;
use oxigraph_testsuite::check_testsuite_with_unsupported;
use std::fs;
use std::path::Path;

#[test]
fn rdf11_n_triples_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf11/rdf-n-triples/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_n_triples_syntax_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-triples/syntax/manifest.ttl",
        &[],
    )
}
#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_n_triples_c14n_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-triples/c14n/manifest.ttl",
        &[],
    )
}

#[test]
fn rdf11_n_quads_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf11/rdf-n-quads/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_n_quads_syntax_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-quads/syntax/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_n_quads_c14n_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-n-quads/c14n/manifest.ttl",
        &[],
    )
}

#[test]
fn rdf11_turtle_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf11/rdf-turtle/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_turtle_syntax_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-turtle/syntax/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_turtle_eval_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-turtle/eval/manifest.ttl",
        &[],
    )
}

#[test]
fn rdf11_trig_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf11/rdf-trig/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_trig_syntax_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-trig/syntax/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_trig_eval_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-trig/eval/manifest.ttl",
        &[],
    )
}

#[test]
fn rdf11_xml_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf11/rdf-xml/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_xml_w3c_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-xml/manifest.ttl",
        &[],
    )
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_semantics_w3c_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/rdf-tests/rdf/rdf12/rdf-semantics/manifest.ttl",
        &[],
    )?;
    ensure!(
        summary.total == 77,
        "expected 77 tests, got {}",
        summary.total
    );
    ensure!(
        summary.passed == 77,
        "expected 77 passes, got {}",
        summary.passed
    );
    ensure!(
        summary.unsupported == 0,
        "expected no unsupported tests, got {}",
        summary.unsupported
    );
    Ok(())
}

#[test]
fn supporting_n3_parser_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/N3/tests/N3Tests/manifest-parser.ttl",
        &[],
    )?;
    ensure!(
        summary.total == 208,
        "expected 208 tests, got {}",
        summary.total
    );
    ensure!(
        summary.passed == 208,
        "expected 208 passes, got {}",
        summary.passed
    );
    ensure!(
        summary.unsupported == 0,
        "expected no unsupported tests, got {}",
        summary.unsupported
    );
    Ok(())
}

#[test]
fn supporting_n3_extended_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/N3/tests/N3Tests/manifest-extended.ttl",
        &[],
    )?;
    ensure!(
        summary.total == 871,
        "expected 871 tests, got {}",
        summary.total
    );
    ensure!(
        summary.passed == 871,
        "expected 871 passes, got {}",
        summary.passed
    );
    ensure!(
        summary.unsupported == 0,
        "expected no unsupported tests, got {}",
        summary.unsupported
    );
    Ok(())
}

#[cfg(not(windows))] // Tests don't like git auto "\r\n" on Windows
#[test]
fn supporting_n3_turtle_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/N3/tests/TurtleTests/manifest.ttl",
        &[],
    )?;
    ensure!(
        summary.total == 296,
        "expected 296 tests, got {}",
        summary.total
    );
    ensure!(
        summary.passed == 296,
        "expected 296 passes, got {}",
        summary.passed
    );
    ensure!(
        summary.unsupported == 0,
        "expected no unsupported tests, got {}",
        summary.unsupported
    );
    Ok(())
}

#[test]
fn supporting_jsonld_to_rdf_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/json-ld-api/tests/toRdf-manifest.jsonld",
        &[
            // Weird @base IRI support
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tli12",
            // expandContext
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#te077",
            // produceGeneralizedRdf
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#t0118",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#te075",
            // Direction conversion modes are disabled when the RDF 1.2
            // feature surface is disabled.
            #[cfg(not(feature = "rdf-12"))]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi01",
            #[cfg(not(feature = "rdf-12"))]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi02",
            #[cfg(not(feature = "rdf-12"))]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi03",
            #[cfg(not(feature = "rdf-12"))]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi04",
            #[cfg(not(feature = "rdf-12"))]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi05",
            #[cfg(not(feature = "rdf-12"))]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi06",
            // we always emit base direction when targeting RDF 1.2
            #[cfg(feature = "rdf-12")]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi02",
            #[cfg(feature = "rdf-12")]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi04",
            #[cfg(feature = "rdf-12")]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi05",
            #[cfg(feature = "rdf-12")]
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi06",
            // non-normative - rdfDirection
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi09",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi10",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi11",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tdi12",
            // Scoped contexts somehow propagate to elements inside containers?
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#tc013",
            // specVersion json-ld-1.0
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#te026",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#te071",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#te115",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#te116",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#ter02",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#ter03",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#ter24",
            "https://w3c.github.io/json-ld-api/tests/toRdf-manifest#ter32",
        ],
    )?;
    ensure!(
        summary.total == 467,
        "expected 467 tests, got {}",
        summary.total
    );
    #[cfg(feature = "rdf-12")]
    let (expected_passed, expected_unsupported) = (446, 21);
    #[cfg(not(feature = "rdf-12"))]
    let (expected_passed, expected_unsupported) = (444, 23);
    ensure!(
        summary.passed == expected_passed,
        "expected {expected_passed} passes, got {}",
        summary.passed
    );
    ensure!(
        summary.unsupported == expected_unsupported,
        "expected {expected_unsupported} unsupported tests, got {}",
        summary.unsupported
    );
    Ok(())
}

#[test]
fn supporting_jsonld_to_rdf_streaming_testsuite() -> Result<()> {
    assert_current_streaming_manifest_duplicate_ids()?;
    let manifest_url = write_streaming_manifest_without_duplicate_ids()?;
    let unsupported_with_duplicate_id_quarantine = [
        // The current upstream manifest assigns these identifiers to two
        // entries each, merging their action/result properties. The
        // preflight above makes this quarantine fail closed when upstream
        // repairs or otherwise changes the anomaly.
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#t0124",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#t0125",
        // We do not allow root @graph followed with other keys
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tv017",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tv019",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tv021",
        // expandContext option
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#te077",
        // normative option
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi09",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi10",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi11",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi12",
        // produceGeneralizedRdf option
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#t0118",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#te075",
        // Direction conversion modes are disabled when the RDF 1.2
        // feature surface is disabled.
        #[cfg(not(feature = "rdf-12"))]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi01",
        #[cfg(not(feature = "rdf-12"))]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi02",
        #[cfg(not(feature = "rdf-12"))]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi03",
        #[cfg(not(feature = "rdf-12"))]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi04",
        #[cfg(not(feature = "rdf-12"))]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi05",
        #[cfg(not(feature = "rdf-12"))]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi06",
        // we always emit base direction when targeting RDF 1.2
        #[cfg(feature = "rdf-12")]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi02",
        #[cfg(feature = "rdf-12")]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi04",
        #[cfg(feature = "rdf-12")]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi05",
        #[cfg(feature = "rdf-12")]
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tdi06",
        // specVersion json-ld-1.0
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#te026",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#te071",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#te115",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#te116",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#ter02",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#ter03",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#ter24",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#ter32",
        // Scoped contexts somehow propagate to elements inside containers?
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tc013",
        // something is before @type
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#te038",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#te014",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tin06",
        "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest#tn008",
    ];
    let unsupported = &unsupported_with_duplicate_id_quarantine[2..];
    let summary = check_testsuite_with_unsupported(&manifest_url, unsupported)?;
    ensure!(
        summary.total == 479,
        "expected 479 tests, got {}",
        summary.total
    );
    #[cfg(feature = "rdf-12")]
    let (expected_passed, expected_unsupported) = (452, 27);
    #[cfg(not(feature = "rdf-12"))]
    let (expected_passed, expected_unsupported) = (450, 29);
    ensure!(
        summary.passed == expected_passed,
        "expected {expected_passed} passes, got {}",
        summary.passed
    );
    ensure!(
        summary.unsupported == expected_unsupported,
        "expected {expected_unsupported} unsupported tests, got {}",
        summary.unsupported
    );
    Ok(())
}

fn assert_current_streaming_manifest_duplicate_ids() -> Result<()> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("json-ld-streaming/tests/stream-toRdf-manifest.jsonld");
    let manifest = fs::read_to_string(&path)?;
    for (id, original_input, colliding_input) in [
        (
            "t0124",
            "stream-toRdf/0124-in.jsonld",
            "stream-toRdf/e124-in.jsonld",
        ),
        (
            "t0125",
            "stream-toRdf/0125-in.jsonld",
            "stream-toRdf/e125-in.jsonld",
        ),
    ] {
        let identifier = format!("\"@id\": \"#{id}\"");
        ensure!(
            manifest.matches(&identifier).count() == 2,
            "{} must contain exactly two occurrences of {identifier}",
            path.display()
        );
        ensure!(
            manifest.contains(original_input) && manifest.contains(colliding_input),
            "{} no longer contains both colliding inputs for {id}",
            path.display()
        );
    }
    Ok(())
}

fn write_streaming_manifest_without_duplicate_ids() -> Result<String> {
    const ORIGINAL_BASE: &str =
        r#"{"@base": "https://w3c.github.io/json-ld-streaming/tests/stream-toRdf-manifest"}"#;
    const RELATIVE_BASE: &str = r#"{"@base": "stream-toRdf-manifest"}"#;
    const GENERATED_URL: &str =
        "https://w3c.github.io/target/supporting-jsonld-streaming/stream-toRdf-manifest.jsonld";

    let mut manifest = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("json-ld-streaming/tests/stream-toRdf-manifest.jsonld"),
    )?;
    for (id, input) in [
        ("t0124", "stream-toRdf/0124-in.jsonld"),
        ("t0125", "stream-toRdf/0125-in.jsonld"),
        ("t0124", "stream-toRdf/e124-in.jsonld"),
        ("t0125", "stream-toRdf/e125-in.jsonld"),
    ] {
        remove_streaming_manifest_entry(&mut manifest, id, input)?;
    }
    ensure!(
        manifest.matches(r##""@id": "#t0124""##).count() == 0
            && manifest.matches(r##""@id": "#t0125""##).count() == 0,
        "duplicate streaming identifiers were not fully quarantined"
    );
    ensure!(
        manifest.matches(RELATIVE_BASE).count() == 1,
        "streaming manifest must contain exactly one relative @base declaration"
    );
    manifest = manifest.replacen(RELATIVE_BASE, ORIGINAL_BASE, 1);

    let output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target/supporting-jsonld-streaming/stream-toRdf-manifest.jsonld");
    fs::create_dir_all(
        output
            .parent()
            .context("generated streaming manifest path has no parent")?,
    )?;
    fs::write(output, manifest)?;
    Ok(GENERATED_URL.to_owned())
}

fn remove_streaming_manifest_entry(manifest: &mut String, id: &str, input: &str) -> Result<()> {
    let input_marker = format!(r#""input": "{input}""#);
    ensure!(
        manifest.matches(&input_marker).count() == 1,
        "expected exactly one streaming manifest entry for input {input}"
    );
    let input_offset = manifest
        .find(&input_marker)
        .with_context(|| format!("streaming input {input} not found"))?;
    let entry_marker = format!(", {{\n      \"@id\": \"#{id}\"");
    let start = manifest[..input_offset]
        .rfind(&entry_marker)
        .with_context(|| format!("start of streaming entry {id} on {input} not found"))?;
    let end_marker = "\n    }, {";
    let end = input_offset
        + manifest[input_offset..]
            .find(end_marker)
            .with_context(|| format!("end of streaming entry {id} on {input} not found"))?
        + "\n    }".len();
    manifest.replace_range(start..end, "");
    Ok(())
}
