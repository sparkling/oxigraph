#![cfg(test)]

use anyhow::{Result, ensure};
use oxigraph_testsuite::check_testsuite_with_unsupported;

#[test]
fn rdf_canon_w3c_testsuite() -> Result<()> {
    let summary = check_testsuite_with_unsupported(
        "https://w3c.github.io/rdf-canon/tests/manifest.ttl",
        &[],
    )?;
    ensure!(
        summary.total == 86 && summary.passed == 86 && summary.unsupported == 0,
        "Expected the pinned RDFC-1.0 manifest to remain 86/86 with no unsupported tests, got {summary:?}"
    );
    Ok(())
}
