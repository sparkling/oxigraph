# ADR-0005: Agentic-QE integration

- **Status**: Accepted
- **Date**: 2026-07-26
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: latest-compatible adapter implemented; the manifest
  requests the `latest` dist-tag and the current integrity-bound lockfile
  resolution is Agentic-QE 3.13.12
- Evidence state: G0.4-G0.5 are source-bound in `253a2b34`: the reviewed CLI
  inventories are 144/144 default and 129/129 no-default, and the narrow
  `persistence-write` profile binds 34/34 exact write-interface tests. These
  scoped results do not replace G0.6 mutation evidence, G0.7 protected-evidence
  reconciliation, or a current aggregate qualification receipt.
- Update note: on 2026-08-25 the adapter moved to the latest-compatible lock
  policy, disabled dependency lifecycle scripts, and bound source-only ledger
  claims to the exact lock resolution and SRI.
- **Related**:
  [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md),
  [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md)

## Context

Agentic-QE provides useful test-generation and quality-workflow concepts. The
original qualification of release 3.13.2 found that it did not provide a
trustworthy native Rust oracle:

- its real executor selects JavaScript frameworks for unknown test types;
- the MCP test-execution handler simulates results; and
- generated Rust candidates may contain semantic and structural errors.

Later releases do not inherit semantic authority merely by being newer. Those
original findings establish the conservative boundary: an Oxigraph-owned
adapter may require the lock-resolved package to be present, coordinate
explicit native commands, record their evidence, or request advisory review
candidates, but only the native commands decide correctness.

## Decision

Request the `agentic-qe` `latest` dist-tag under `tools/agentic-qe` and place an
Oxigraph-owned, fail-closed adapter in front of it. A reviewed dependency
refresh resolves that tag into the committed npm lockfile. Every profile then
requires the installed CLI version to equal the exact version in that
integrity-bearing resolution and records the lock SRI, manifests, installed
package metadata, and executable hash. Presence is a qualification
precondition, not proof that Agentic-QE executed the native semantic checks.

Cargo, pinned W3C manifests, Jena, and Soufflé remain pass/fail authorities.
The Oxigraph-owned adapter may:

- run explicit, versioned profiles;
- preserve full command and artifact evidence;
- write portable content and execution hashes;
- coordinate the immutable MetaHarness semantic gate.

The lock-resolved Agentic-QE executable is invoked for its version/presence
probe and for optional advisory Rust candidate generation. Neither component
may:

- use simulated MCP execution as evidence;
- route Rust through the JavaScript fallback;
- relabel a narrower result as family conformance;
- merge Jena compatibility, reviewed W3C, and edge-draft results; or
- accept generated code without structural, semantic, compiler, native,
  conformance, and mutation review.

## Security and evidence boundary

The adapter:

- requires both manifests to request `latest`, the lockfile to contain an exact
  integrity-bound resolution, and the installed CLI version to equal that
  resolution;
- invokes commands with `shell: false` and `--locked`;
- installs with `npm ci --ignore-scripts`, so Agentic-QE lifecycle hooks receive
  no host execution authority, with a package-local `.npmrc` enforcing the same
  policy;
- gives every child command only a reviewed inherited-environment allowlist;
  provider, API, proxy, credential, and runtime-injection variables are
  removed, and advisory candidate mode receives no ambient model-provider
  authority;
- validates exact nonzero test counts;
- forces its Node adversarial suite through TAP 13 and requires one exact,
  terminal, conserved 18-test/18-pass summary;
- scans complete stdout and stderr streams for count guards, including tokens
  split across process chunks;
- kills the whole POSIX process group on timeout;
- resolves candidate and output roots through canonical in-repository paths;
- rejects symlinks, traversal, non-regular inputs, and overwrite collisions;
- executes each profile sequentially in reviewed order and requires a passing
  receipt to contain that exact complete command inventory;
- holds a repository-global exclusive lease from the initial snapshot through
  receipt and oracle publication, failing live contention before output
  deletion and reclaiming only a provably dead Unix owner;
- invalidates the previous oracle, receipt, and selected outputs before work,
  then preserves successful output bytes in a bounded content-addressed
  per-profile archive;
- publishes the receipt and final oracle exclusively below a UUID-addressed run
  directory, with the oracle binding the exact serialized schema-v4 receipt;
- writes evidence through exclusive temporary files and atomic rename; and
- hashes scoped dirty/untracked source, lockfiles, protected inputs, command
  output, required artifacts, and the shared dependency and child-environment
  policy modules.

The narrow oracle shape `{passed, baselinePassed}` is derived from detailed
native command results. Commands stop on the first failure, so a failed receipt
may contain a strict prefix; only a set- and order-equal complete receipt can
pass. An unavailable tool, missing credential, count mismatch, timeout,
changed protected input, active/stale lease, or incomplete command inventory
is failure or inconclusive, never success.

The adapter's own adversarial suite passes 18 of 18 tests. Receipts bind exact
Cargo `--list` inventories, the repository tuple, implementation and artifact
hashes, oracle roles, timeouts, and each executable's resolved path, version,
and SHA-256. Consumers re-derive each program, argument vector, timeout, exact
count, and reviewed test-ID inventory from the trusted profile definition.

## Implemented profiles

The canonical list is
[profile-definitions.mjs](../../tools/agentic-qe/profile-definitions.mjs).
It separates:

- existing Oxigraph regression tests;
- RDF 1.2 and SPARQL 1.2 official manifests;
- Datalog D0, D1, D2, whole-crate, store, Jena, and Soufflé evidence;
- bounded RDFS, OWL 2 RL/RDF, and SHACL evidence;
- the 34-test `persistence-write` profile covering transactional dataset,
  update atomicity, topology, service claims, and failure injection;
- the MetaHarness immutable semantic gate; and
- an aggregate coordination profile.

Each profile writes
`target/agentic-qe/<profile>/receipt.json` and
`target/agentic-qe/<profile>/oracle.json`. Required native artifacts remain in
their profile-defined `target/` locations, including the broad Jena outputs at
`target/jena-parity/`. Receipt hashes are not copied into this ADR because
source changes deliberately invalidate them.

## Candidate policy

Candidate generation uses ephemeral memory and writes outside source
directories. Acceptance requires:

1. path and structure audit;
2. standards-aware human review;
3. compilation and strict linting;
4. native positive and negative tests;
5. frozen conformance and differential suites;
6. mutation competence; and
7. adversarial regression review.

## Consequences

- The latest-compatible, presence-gated adapter can coordinate the programme
  without weakening native authority.
- The adapter owns Cargo execution and receipt semantics.
- Contributors do not need the package for ordinary Rust development.
- Generated tests remain suggestions, not evidence, until accepted through the
  full native pipeline.

## Alternatives rejected

- Install into repository-root Codex/Claude configuration: risks user-owned
  coordination state.
- Trust the simulated MCP executor: not real execution.
- Merge generated Rust directly: observed candidates are not reliable enough.
- Wait for upstream Cargo support: the narrow adapter is useful now.

## Run

```bash
cd tools/agentic-qe
npm ci --ignore-scripts
npm run test:parity
```

See the [Agentic-QE adapter guide](../../tools/agentic-qe/README.md) for
individual profiles.

## Acceptance boundary

Agentic-QE is a latest-compatible advisory generator whose exact lock-resolved
version, lock SRI, installed package metadata, and executable hash are gated.
The Oxigraph-owned adapter coordinates and receipts native commands. Native
Cargo commands, immutable W3C runners, and Jena/Soufflé differentials are
authoritative. Neither Agentic-QE nor its adapter can establish a semantic
claim broader than the exact native profiles and artifacts referenced by a
current receipt.

The former 133/116 CLI inventories are historical evidence after `1da47285`.
G0.4-G0.5 deliberately reviewed and replaced them with the source-bound
144/129 inventories and 34-test `persistence-write` profile in `253a2b34`.
Any later count or ID drift remains a deliberate fail-closed condition, not
permission to loosen the inventory automatically.
