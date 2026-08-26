export const mutablePolicy = Object.freeze([
  "planner",
  "contextBuilder",
  "reviewer",
  "retryPolicy",
  "toolPolicy",
  "memoryPolicy",
  "scorePolicy",
]);

export const protectedInputs = Object.freeze([
  ".github/workflows/tests.yml",
  "Cargo.toml",
  "Cargo.lock",
  "README.md",
  "cli",
  "docs/adr",
  "docs/plans",
  "docs/research",
  "js",
  "lib",
  "python",
  "testsuite",
  "tools/agentic-qe",
  "tools/child-environment.mjs",
  "tools/datalog-oracles",
  "tools/dependency-policy.mjs",
  "tools/evidence",
  "tools/jena-parity",
  "tools/metaharness",
  "tools/mutation",
  "tools/owl2-tests",
  "tools/shacl-tests",
  "tools/w3c-tests",
]);

// ECMAScript's relational string comparison is defined over UTF-16 code units.
// Keep evidence ordering independent of the host locale by using this comparator
// at both the snapshot owner and strict-verifier boundaries.
export function comparePortablePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
