#![cfg(test)]

use anyhow::{Result, ensure};
use oxigraph_testsuite::{check_testsuite, check_testsuite_with_unsupported};

#[test]
fn sparql10_w3c_query_syntax_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/sparql/sparql10/manifest-syntax.ttl",
        &[],
    )
}

#[test]
fn sparql10_w3c_query_evaluation_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/sparql/sparql10/manifest-evaluation.ttl",
        &[
            // We use XSD 1.1 equality on dates
            "http://www.w3.org/2001/sw/DataAccess/tests/data-r2/open-world/manifest#date-2",
            // This test relies on naive iteration on the input file
            "http://www.w3.org/2001/sw/DataAccess/tests/data-r2/reduced/manifest#reduced-1",
            "http://www.w3.org/2001/sw/DataAccess/tests/data-r2/reduced/manifest#reduced-2",
        ],
    )
}

#[test]
fn sparql11_query_w3c_evaluation_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/sparql/sparql11/manifest-sparql11-query.ttl",
        &[],
    )
}

#[test]
fn sparql11_federation_w3c_evaluation_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/rdf-tests/sparql/sparql11/manifest-sparql11-fed.ttl",
        &[
            // The pinned expected result contains an empty <binding>, which is
            // invalid under the SPARQL XML Results grammar.
            "http://www.w3.org/2009/sparql/docs/tests/data-sparql11/service/manifest#service7",
        ],
    )?;
    ensure!(
        summary.total == 10 && summary.passed == 9 && summary.unsupported == 1,
        "expected the pinned federation suite to pass 9/10 with one invalid-result exception, got {summary:?}"
    );
    Ok(())
}

#[test]
fn sparql11_update_w3c_evaluation_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/sparql/sparql11/manifest-sparql11-update.ttl",
        &[],
    )
}

#[test]
fn sparql11_json_w3c_evaluation_testsuite() -> Result<()> {
    check_testsuite(
        "https://w3c.github.io/rdf-tests/sparql/sparql11/json-res/manifest.ttl",
        &[],
    )
}

#[test]
fn sparql11_csv_tsv_w3c_result_format_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/rdf-tests/sparql/sparql11/csv-tsv-res/manifest.ttl",
        &[],
    )?;
    ensure!(
        summary.total == 6,
        "expected 6 tests, got {}",
        summary.total
    );
    ensure!(
        summary.passed == 6,
        "expected 6 passes, got {}",
        summary.passed
    );
    ensure!(
        summary.unsupported == 0,
        "expected no unsupported tests, got {}",
        summary.unsupported
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn sparql12_w3c_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/rdf-tests/sparql/sparql12/manifest.ttl",
        &[],
    )?;
    ensure!(
        summary.total == 269,
        "expected 269 tests, got {}",
        summary.total
    );
    ensure!(
        summary.passed == 269,
        "expected 269 passes, got {}",
        summary.passed
    );
    ensure!(
        summary.unsupported == 0,
        "expected no unsupported tests, got {}",
        summary.unsupported
    );
    Ok(())
}
