# ADR-0013: Mutation competence and provenance policy

- Status: Accepted
- Date: 2026-07-27
- Updated: 2026-08-24
- Evidence state: the policy remains Accepted. The named July receipt is
  historical for its sealed source; library changes in `1da47285` invalidate
  it as current-HEAD evidence. Its scope is OxDatalog and does not establish
  mutation competence for the new persistence-write surface.
- Deciders: Oxigraph parity programme
- Related:
  [ADR-0002 — RDF-native Datalog engine](0002-rdf-native-datalog-engine.md),
  [ADR-0004 — MetaHarness and Darwin
  qualification](0004-metaharness-darwin-qualification.md),
  [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md)

## Context

Green example tests do not show that assertions can detect meaningful changes
to fixpoint evaluation, validation, provenance, limits, RDF adaptation, or D2
generation. Mutation testing provides that pressure, but only if a failing
baseline cannot make every mutant appear caught and the receipt is bound to
the exact source it qualifies.

Informally dismissing surviving mutants as “equivalent” would make the score
non-reproducible. Compiler-rejected mutants are different: they never form a
viable alternative program and must be reported separately.

## Decision

Pin `cargo-mutants` 27.1.0 and the reviewed
`oxdatalog-d2-complete` configuration under `tools/mutation`. The configured
source surface covers the generic D0–D2 engine, validation and strata,
provenance, RDF adapter, rule execution, storage, and control logic.

A passing gate requires:

1. exactly one successful native baseline;
2. at least one generated mutant;
3. exactly one unique native outcome for every generated mutant;
4. aggregate and per-mutant count conservation;
5. the pinned native outcome schema and tool version;
6. stable protected inputs before and after execution;
7. zero missed viable mutants;
8. zero timed-out mutants; and
9. successful bounded process-tree execution.

The 70-test all-target/all-feature OxDatalog suite is the exercised native
test surface. The exact generated, caught, missed, timeout, and unviable counts
belong in the current native receipt rather than this ADR.

## Equivalent-mutant policy

There is no informal `equivalent` success category.

- A compiling mutant that survives the tests is `missed` and blocks the gate.
- If it represents observable behavior, add an exact positive, negative,
  boundary, accounting, or provenance assertion that distinguishes it.
- If it exposes genuinely redundant source, simplify the source so the
  mutation site no longer exists, then regenerate the complete inventory.
- A compiler-rejected mutant is `unviable`; it is reported but excluded from
  the viable mutation score.
- A timeout is never treated as caught or equivalent.

Any future exclusion mechanism requires a profile revision with a
machine-readable mutant identity and independently reviewable semantic proof.
It may not relabel a survivor as caught or reuse a prior receipt.

## Receipt and source binding

Each authoritative schema-v3 receipt is published exclusively below
`target/mutation/oxdatalog/runs/<run-uuid>/` with immutable copies of the
native `outcomes.json` and reviewed configuration. The receipt records count
conservation, binds a timestamp-independent content hash over the verdict, and
adds a run-specific execution hash over its UUID, timestamps, and publication
manifest. `target/mutation/oxdatalog/receipt.json` is only the mutable
latest-run convenience pointer.

Protected inputs include workspace manifests and locks, library source, the
mutation runner, and mutation policy. The receipt records canonical executable
paths, versions, and SHA-256 hashes for Cargo, Cargo Mutants, and Rustc,
including the selected Rustup toolchain executables. Qualification discovers a
candidate through the latest pointer, then reopens the run-addressed receipt,
native outcomes, and configuration with stable no-follow reads. It requires
their exact bytes, manifest, and hashes to agree and both protected snapshots
to equal the current source snapshot.

A source edit after the run makes the receipt stale even when the edited line
does not appear in a surviving mutant. Copying counts from an older receipt is
not evidence.

## Evidence

- [Reviewed mutation configuration](../../tools/mutation/oxdatalog.toml)
- [Source-bound mutation runner](../../tools/mutation/oxdatalog.mjs)
- [Independent receipt validator](../../tools/mutation/evidence.mjs)
- [Mutation-competence tests](../../lib/oxdatalog/tests/mutation_competence.rs)

## Consequences

- The gate measures test competence against a reviewed source surface.
- Baseline, timeout, inventory, and provenance failures are fail-closed.
- Redundant code is removed instead of creating unverifiable equivalent-mutant
  waivers.
- Exact provenance and resource-accounting behavior receive the same mutation
  pressure as derived facts.
- Consumer semantics still require their own RDFS, OWL 2 RL, SHACL, Store,
  differential, and standards evidence.

## Alternatives rejected

- Disable the baseline: a broken test command could make all mutants look
  caught.
- Use only a mutation percentage: hides missing, timed-out, and unviable
  outcomes.
- Accept manual “equivalent” comments: not reproducible or source-bound.
- Treat unviable mutants as caught: overstates executed test competence.
- Reuse a receipt after source changes: breaks evidence-to-source identity.

## Acceptance boundary

A current zero-survivor, zero-timeout receipt qualifies the reviewed generic
OxDatalog source surface on one bound toolchain. It does not prove absence of
defects, performance suitability, or RDFS, OWL 2 RL, SHACL, Jena, Soufflé, or
W3C conformance.
