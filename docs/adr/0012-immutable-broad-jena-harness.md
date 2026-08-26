# ADR-0012: Immutable broad Jena differential harness

- **Status**: Accepted
- **Date**: 2026-07-27
- Updated: 2026-08-25
- Evidence state: the sealed July result remains historical evidence for its
  exact subject. G0.2 restored the reproducible runner lock in `46ef17fc`, and
  G0.3 refreshed the reviewed subject lock in `22a8033e` and completed two
  byte-identical 76-scenario/198-assertion executions. That closes the scoped
  G0.2-G0.3 work for its exact source; it does not make later protected-source
  changes or full MetaHarness qualification current.
- Deciders: Oxigraph parity programme
- **Related**:
  [ADR-0001 — Outcome-oriented Apache Jena parity](0001-outcome-oriented-jena-parity.md),
  [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md)

## Context

A broad differential is only useful when the compared scenarios, assertions,
subject source, Jena dependencies, normalization, and toolchains cannot drift
during execution. A receipt beside mutable harness inputs can be mistaken for
current evidence. A single pass/fail value also cannot represent intentional
W3C-over-Jena behavior, Jena extensions, or explicit unsupported boundaries.
It must also distinguish a standards-permitted implementation variant from
both disagreement and nonconformance.

## Decision

Maintain the reviewed profile
`jena-6.1.0-outcome-intersection-2026-07-27-v1` under
`tools/jena-parity`. Its inventory enumerates RDF, SPARQL, SHACL, finite RDFS,
and selected OWL 2 RL scenarios. Every scenario has:

- a stable identifier, domain, operation, and normative basis;
- a reviewed flag;
- one of `agreement`, `w3c-overrides-jena`,
  `w3c-permitted-divergence`, `jena-extension`, or `unsupported`;
- typed inputs; and
- assertions targeted at both engines, Jena, or Oxigraph.

The profile lock binds the profile identifier, inventory and source hashes,
scenario/domain/classification counts, subject implementation hash, resolved
Jena dependency hashes, and Java, Maven, Rust, and Jena versions. A normal run
recomputes and verifies that lock before invoking the oracle. Lock refresh is a
separate reviewed profile-revision operation, never an automatic response to
drift.

The smaller Datalog and finite-RDFS Jena differentials reuse this profile's
checked-in mise configuration. Their scripts re-enter and attest the exact
Java, Maven, and Rust versions before Maven compilation and Java execution, so
Darwin's scrubbed environment or a changed login shell cannot split the
compiler and runtime JDKs.

Jena must return exactly one observation for every inventory identifier, with
no duplicates or extras. Oxigraph runs the same resolved inventory.
Type-specific canonicalization compares booleans, result sets, RDF graphs,
datasets, reports, errors, and unsupported outcomes according to the reviewed
assertions.

## Evidence topology

Generated evidence has one authoritative location:

- `target/jena-parity/resolved-inventory.json`;
- `target/jena-parity/jena-observations.json`; and
- `target/jena-parity/parity-receipt.json`.

The harness invalidates all three outputs before execution and rejects
symlinked or non-regular output components. The receipt binds its subject,
inventory, harness sources, dependencies, toolchains, per-scenario
observations, and aggregate counts. Agentic-QE may coordinate this command and
hash these target artifacts, but the native harness remains the differential
authority.

## Bounded results

“Current” in the original result below meant current for the sealed
`2026-07-27-v1` subject. G0.3 subsequently refreshed the same reviewed profile
to source-bound subject SHA-256
`182972ecb68f5d6e3868fa30bb44b860d50da6c135f2cc50e4236a2eb5876a63`
in `22a8033e` and completed two byte-identical executions. Both results remain
bounded to their exact protected subjects. Later source changes are reconciled
at G0.7 and promoted only through G1.7; neither receipt is a timeless
current-HEAD claim.

The reviewed inventory contains 76 scenarios and 198 assertions:

| Domain | Scenarios | Assertions |
|---|---:|---:|
| RDF | 17 | 46 |
| SPARQL | 30 | 77 |
| SHACL | 13 | 43 |
| finite RDFS | 7 | 14 |
| selected OWL 2 RL | 9 | 18 |

Its classifications are 70 `agreement`, four `w3c-overrides-jena`, one
`w3c-permitted-divergence`, one `jena-extension`, and zero `unsupported`.
The permitted divergence is the `CLEAR GRAPH` topology outcome: SPARQL 1.2
allows the now-empty named graph to be retained or removed, so the distinct
successful Jena and Oxigraph outcomes are not an engine failure. A closed
receipt means only that this exact classified inventory met its assertions
against Jena 6.1.0.

## Evidence

- [Reviewed profile lock](../../tools/jena-parity/profile.lock.json)
- [Inventory index and scope](../../tools/jena-parity/inventory/index.json)
- [Native immutable harness](../../tools/jena-parity/runner/src/harness.rs)
- [Pinned execution entrypoint](../../tools/jena-parity/scripts/run.sh)

For the original July subject, two consecutive complete runs produced
byte-identical artifacts. Its sealed subject hash is
`1fe53cef38fb579188b61f1ccd60c383b1098c922012753733c4ef9c154b095d`;
the profile lock, receipt, resolved inventory, and Jena observations hashes are
respectively
`00b01191d9c15661f9d8743261d2e104980d6ea73d444794acd56a822749bf4e`,
`48673fdb0540dfe3a41a8c624f6ce98f31fe39a06e193007a5f84db3df005c76`,
`be03e50517be71a7574d89982644fc3c1e54030c5d8375a792180ad37c476cb5`,
and
`b9ad72609b05dbe3aaf29cbf8bdd2b8572f85e833a30bf123a580d7cf59e95b4`.

The G0.3 refresh in `22a8033e` also produced two complete byte-identical runs
for its reviewed subject. This ADR records that source-bound closure without
copying mutable target receipt identities into architectural law.

## Consequences

- An inventory, dependency, toolchain, harness, or subject change invalidates
  the old lock or receipt.
- W3C-over-Jena behavior is visible instead of being counted as a false
  compatibility failure.
- W3C-permitted implementation freedom is visible instead of being collapsed
  into agreement or reported as a false failure.
- Unsupported behavior remains an explicit profile result rather than a
  skipped test.
- Broader Jena modules require new reviewed scenarios and cannot inherit this
  profile's result.

## Alternatives rejected

- Run a floating Jena classpath: dependency drift destroys reproducibility.
- Update the lock during every run: makes the oracle self-approving.
- Keep generated receipts under the mutable tool source tree: obscures current
  versus historical evidence.
- Count only agreement: hides standards overrides, extensions, and unsupported
  boundaries.
- Infer full product parity from a broad sample: 76 scenarios are still an
  enumerated subset.

## Acceptance boundary

The harness establishes immutable, set-equal execution for the exact named
76-scenario, 198-assertion profile. It does not establish complete Apache Jena
parity, Java API compatibility, operational parity for TDB2 or Fuseki, or W3C
family conformance. OWL evidence is limited to the selected OWL 2 RL scenarios.
