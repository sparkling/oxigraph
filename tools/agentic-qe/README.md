# Agentic-QE support

This directory requests Agentic-QE's `latest` dist-tag and puts an
Oxigraph-owned, fail-closed adapter in front of it. The committed lockfile
currently resolves 3.13.12 with exact registry integrity. Cargo, immutable W3C
inputs, and the Jena/Soufflé differentials remain the semantic authorities. The
Oxigraph adapter coordinates and records those commands. Agentic-QE is
lock-resolved, version- and presence-gated and may propose advisory test
candidates.

## Install and run

```bash
cd tools/agentic-qe
npm ci --ignore-scripts
npm run test:adapter
npm run test:existing
npm run test:persistence-write
npm run test:g1-regression
npm run test:supporting-suites
npm run test:w3c
npm run test:datalog
npm run test:rdfs
npm run test:owl2-rl
npm run test:shacl-1.2
npm run test:parity
```

`npm ci --ignore-scripts` reproduces the committed exact resolution without
granting dependency lifecycle hooks host authority. This is required because
the current Agentic-QE package declares an install script; the package-local
`.npmrc` enforces the same rule. A reviewed dependency refresh uses
`npm update agentic-qe --package-lock-only --ignore-scripts` and must rerun the
adapter and qualification gates before the new lockfile is accepted.

Adapter child processes inherit only a reviewed safe-name allowlist. Provider,
API, proxy, credential, and runtime-injection variables are removed; advisory
candidate mode therefore has no ambient model-provider authority. Receipts
also bind the shared dependency and child-environment policy modules.

The focused `test:persistence-write`, `test:g1-regression`,
`test:datalog-jena`, `test:rdfs-jena`, `test:datalog-souffle`,
`test:owl2-rl-inventory`, and `test:owl2-rl-w3c` scripts are also available.
`test:metaharness-semantic-gate` is the immutable native-oracle set consumed
by the full MetaHarness/Darwin qualification.

Receipts are written below `target/agentic-qe/<profile>/`. Schema-v4 receipts
record the exact Agentic-QE version, Git and W3C provenance, commands, process
status, complete stdout/stderr hashes, required artifact hashes, the exact
Cargo `--list --format terse` inventory, and a before/after manifest of every
selected implementation input. Dirty and untracked scoped files are included.
Any input drift, timeout, missing artifact, nonzero exit, test-inventory
cardinality mismatch, or exact Cargo pass-count mismatch fails the profile.
Narrow, fully reviewed oracles additionally require an exact test-ID inventory.
Broader crate suites may instead name a nonempty set of required sentinel IDs;
these are checked as a subset of the complete recorded inventory and are never
treated as an exact inventory.

Profile commands execute sequentially in their reviewed order and stop at the
first failure. Schema-v4 receipts are positive evidence only: a failure aborts
positive-evidence publication, while a passing receipt must contain the exact
full ordered profile inventory. One repository-wide exclusive lease is acquired
before snapshots or output invalidation and held through publication. A
competing profile fails before touching evidence. On Unix, a later run reclaims
a crashed owner only after two stable inode/token reads prove that the recorded
PID and process-start identity are dead or reused; uncertainty and Windows
remain fail-closed.

Before execution the adapter invalidates the old oracle, receipt, and complete
selected-output set. Every successful run copies the exact declared output
bytes into a bounded content-addressed archive below its profile directory and
reopens that archive before publication. Exact receipt/oracle bytes are then
published exclusively below `runs/<run-uuid>/`; mutable top-level files are only
latest-run conveniences. The run-addressed oracle is published last and binds
the UUID plus SHA-256 of the exact serialized receipt. Later profiles may
replace shared live outputs or latest pointers without invalidating evidence.

`contentHash` binds the repository revision tuple, portable implementation
bytes, reviewed command inventory, and verdicts while excluding timestamps,
durations, checkout roots, and runtime output. `executionHash` adds complete
command-output and generated-artifact hashes plus executable provenance.
Receipts record the invoked and canonical paths, versions, and SHA-256 hashes
for Agentic-QE and every selected runtime; Rustup-backed Cargo and Rustc also
bind the selected toolchain executable. Output and candidate directories
reject symlink components and canonical escapes.

## Evidence profiles

- `existing`: RDF 1.2 terms and public I/O profiles, SPARQL 1.2
  parsing/evaluation/results, atomic updates, bounded query entailment,
  empty named-graph topology across TriG, JSON-LD, Store, and CLI boundaries,
  hermetic federated `SERVICE`, and GeoSPARQL regression suites.
- `persistence-write`: 34 exact test executions across seven locked native
  commands: replacement transactional-dataset writes, request-atomic SPARQL
  Update, dataset-adapter and Store graph topology, default and no-default
  service claims, and deterministic open/load/commit failure handling for
  parallel bulk loads.
- `g1-regression`: 66 exact test executions across 11 ordered locked native
  commands, covering the implemented G1.1 through G1.6 transaction state,
  concurrency, capability, writer-serialization, egress, cancellation,
  negotiated-update, effective-capability, service-claim, compatibility-canary,
  and SPARQL-version surfaces. Its immutable run-addressed receipt is a
  current-green prerequisite for G1.7 only; it does not set performance budgets,
  classify or promote a candidate, write Router history, or authorize
  publication.
- `supporting-suites`: five exact-count N3 and JSON-LD parser/interchange
  wrappers; their bounded exclusions remain supporting evidence only.
- `w3c`: pinned official RDF 1.2, SPARQL 1.2, and SHACL 1.2 lanes plus the
  separately labelled hermetic SPARQL federation clause slice.
- `datalog`: D0 positive recursion, D1 stratified negation, D2 run-once
  generation, the full 70-test crate, seven Store integration tests, Jena 6.1.0,
  and Soufflé 2.5 differentials.
- `store`: the seven Datalog transaction/materialization checks plus four
  read-only RDFS, OWL 2 RL, and SHACL Store-snapshot adapters.
- `rdfs`: the bounded seed, the complete finite active-vocabulary RDFS 1.2
  implementation (37 native tests), and one 14-assertion Jena 6.1.0 RDFS
  differential.
- `owl2-rl`: the retained positive seed, the complete 78-rule OWL 2 RL/RDF
  engine (34 native tests), the 70-case approved inventory, and 98 official
  RDF-based assertions.
- `shacl-1.2`: 167 all-feature and 114 no-default native SHACL processor tests,
  the hash-pinned W3C Data Shapes execution (521 discovered, 519 eligible, 519
  passed, 2 excluded) and clause-audit receipts, plus the 32/32 Jena SHACL-C
  differential. Unsupported, invalid, supplemental, and informative cases stay
  explicit.
- `jena-parity`: the immutable 76-scenario, 198-assertion bounded differential,
  including one W3C-permitted divergence. Native artifacts are written to
  `target/jena-parity/`; the outer receipt binds all three below
  `target/agentic-qe/jena-parity/`.
- `parity`: every profile above in one receipted run.

Passing a test suite is evidence for its exact tested behavior. It is not, by
itself, a family-wide normative conformance claim.

Every Cargo oracle uses `--locked`, a nonzero exact test-count safeguard, and
a timeout. Before execution, the adapter independently asks libtest for the
selected test inventory and binds the IDs and full-stream hash into the
receipt. Summary parsing accepts only complete, line-anchored libtest records;
every consumer re-derives program, arguments, timeout, counts, and reviewed IDs
from the trusted profile definition. Extra spoof-like lines or a fabricated
receipt policy fail. On POSIX, timeouts
terminate the detached process group with TERM and then KILL.
The adapter's own Node suite is forced through the TAP 13 reporter and must end
with one exact, contiguous, conserved 19-test/19-pass terminal summary.

## Candidate test generation

Agentic-QE can produce advisory Rust candidates:

```bash
npm run aqe -- candidate lib/oxrdf/src/variable.rs
```

Candidates use ephemeral memory and land in collision-free directories below
`target/agentic-qe/candidates/`. Inputs must be regular in-repository `.rs`
files. Audit inputs must be regular candidate JSON files, and audit outputs
cannot overwrite inputs. Generated code must compile and pass native,
conformance, differential, and mutation gates before adoption.

The original Agentic-QE 3.13.2 review found that its shipped framework selector
did not natively execute Cargo and its MCP test-execution path was simulated.
Newer releases do not automatically acquire semantic authority: this adapter
never uses either path as a correctness oracle. Its JavaScript quality gate is
also not the Rust crate's authority; real `cargo-mutants` evidence is produced
by `tools/mutation/oxdatalog.mjs`.
