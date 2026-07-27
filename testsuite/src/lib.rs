//! Implementation of [W3C RDF tests](https://w3c.github.io/rdf-tests/) to tests Oxigraph conformance.

pub mod canonicalization_evaluator;
pub mod evaluator;
pub mod files;
pub mod manifest;
pub mod parser_evaluator;
pub mod report;
pub mod semantic_evaluator;
#[cfg(feature = "rdf-12")]
mod semantic_json;
pub mod sparql_evaluator;
mod vocab;

use crate::canonicalization_evaluator::register_canonicalization_tests;
use crate::evaluator::TestEvaluator;
use crate::manifest::TestManifest;
use crate::parser_evaluator::register_parser_tests;
use crate::semantic_evaluator::register_semantic_tests;
use crate::sparql_evaluator::register_sparql_tests;
use anyhow::{Result, ensure};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TestSuiteSummary {
    pub total: usize,
    pub passed: usize,
    pub unsupported: usize,
}

pub fn check_testsuite(manifest_url: &str, ignored_tests: &[&str]) -> Result<()> {
    check_testsuite_internal(manifest_url, ignored_tests, false).map(|_| ())
}

pub fn check_testsuite_with_unsupported(
    manifest_url: &str,
    unsupported_tests: &[&str],
) -> Result<TestSuiteSummary> {
    check_testsuite_internal(manifest_url, unsupported_tests, true)
}

#[expect(clippy::panic_in_result_fn)]
fn check_testsuite_internal(
    manifest_url: &str,
    exceptions: &[&str],
    require_failures: bool,
) -> Result<TestSuiteSummary> {
    let mut evaluator = TestEvaluator::default();
    register_parser_tests(&mut evaluator);
    register_canonicalization_tests(&mut evaluator);
    register_semantic_tests(&mut evaluator);
    register_sparql_tests(&mut evaluator);

    let manifest = TestManifest::new([manifest_url]);
    let results = evaluator.evaluate(manifest)?;

    let mut errors = Vec::default();
    let mut passed = 0;
    let mut unsupported = HashSet::new();
    let expected: HashSet<_> = exceptions.iter().copied().collect();
    ensure!(
        expected.len() == exceptions.len(),
        "Duplicate test identifiers in exception ledger"
    );
    let total = results.len();
    for result in results {
        match &result.outcome {
            Ok(()) => {
                passed += 1;
                if require_failures && expected.contains(result.test.as_str()) {
                    errors.push(format!(
                        "{}: declared unsupported but now passes",
                        result.test
                    ));
                }
            }
            Err(error) => {
                if expected.contains(result.test.as_str()) {
                    unsupported.insert(result.test.as_str().to_owned());
                } else {
                    errors.push(format!("{}: failed with error {error:?}", result.test));
                }
            }
        }
    }
    if require_failures {
        for missing in expected.iter().filter(|test| !unsupported.contains(**test)) {
            errors.push(format!(
                "{missing}: unsupported ledger entry was not evaluated"
            ));
        }
    }

    assert!(
        errors.is_empty(),
        "{} failing tests:\n{}\n",
        errors.len(),
        errors.join("\n")
    );
    Ok(TestSuiteSummary {
        total,
        passed,
        unsupported: unsupported.len(),
    })
}
