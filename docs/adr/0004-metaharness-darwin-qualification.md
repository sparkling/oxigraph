# ADR-0004: MetaHarness and Darwin qualification

- Status: Accepted
- Date: 2026-07-26
- Deciders: Oxigraph parity programme
- Implementation status: policy-only adapter, synthetic mechanics, full
  semantic mode, and independent receipt verification implemented;
  qualification remains receipt-dependent
- Related:
  [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md),
  [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md)

## Context

A harness can make a multi-suite programme reproducible, but it can also
optimize against a mutable oracle or consume the work it was meant to support.
RuvNet guidance distinguishes proposed design from shipped proof: Darwin
ADR-070 is Proposed, while accepted ADR-102 qualifies only its synthetic Tier-1
mock sandbox.

The published Darwin package available to this programme is
`@metaharness/darwin` 0.8.0. Its policy genome has seven surfaces:
`planner`, `contextBuilder`, `reviewer`, `retryPolicy`, `toolPolicy`,
`memoryPolicy`, and `scorePolicy`.

## Decision

Pin Darwin 0.8.0 under `tools/metaharness` and permit it to modify only the
seven policy surfaces. The following are immutable protected inputs:

- Rust source and public semantic APIs;
- specification and test-suite pins;
- manifests, expected results, approval status, and exclusions;
- rule packs, profile identifiers, and resource ceilings;
- standards registry, conformance ledger, and receipt definitions.

Promotion requires all five gates:

1. solve;
2. regression;
3. safety;
4. cost; and
5. reproducibility.

The final semantic gate runs a frozen Agentic-QE profile through Darwin's
shell-free real sandbox. Native Cargo, W3C, Jena, and Soufflé commands remain
the correctness oracles. GEPA or Darwin may tune harness policy; neither may
rewrite semantic answers.

Protected snapshots include the JavaScript source tree but exclude exactly the
repository-relative generated-output directory `js/pkg`. Other directories
named `pkg` remain protected, and a symlink at `js/pkg` still passes through
the normal fail-closed symlink checks. This keeps local WebAssembly build
products from changing qualification identity without weakening source
coverage or requiring a move-and-restore cycle that would stale the receipt.

Darwin's real sandbox deliberately removes `JAVA_HOME`. Java-backed Datalog
and RDFS differentials must therefore enter the shared checked-in Jena mise
toolchain themselves and verify that Maven and the runtime both use Java
21.0.11, alongside Maven 3.9.11 and Rust 1.96.0. A bare Maven compile followed
by a separately resolved bare `java` is rejected because compiler/runtime
drift can create false harness failures.

## Proportional phase gates

Apply the cross-project
`metaharness-phase-gating-proportionality` rule:

- produce a primary implementation artifact before harness expansion;
- cap harness work at 20% of programme effort and two hours before review;
- zero primary artifacts is red;
- do not add release gates solely to repair a harness defect; and
- run one adversarial review before freeze and another after qualification.

## Implemented qualification

The [qualification adapter](../../tools/metaharness/qualify.mjs):

- uses two seeded, two-generation synthetic evolutions;
- exercises quality diversity, safety rejection, cost bounds, and stable
  replay;
- hashes protected inputs;
- validates that all output paths and their existing ancestors stay inside the
  repository and are not symlinks;
- writes receipts atomically; and
- has a full mode that invokes the immutable
  `metaharness-semantic-gate` profile.

Full mode reopens the immutable schema-v3 mutation receipt, native outcomes,
and policy copy from their UUID-addressed publication; recomputes the
Agentic-QE content and execution hashes; hashes every generated artifact and
runtime; and checks the current protected source snapshot. The independent
[receipt verifier](../../tools/metaharness/verify.mjs) then reopens that
qualification and binds its exact bytes. Both validators require the semantic
receipt's exact ordered 41-command inventory, so a fail-fast prefix cannot be
relabelled as a completed gate.

Synthetic qualification proves policy-surface mechanics only. It cannot
establish Oxigraph semantic correctness. A release may describe Darwin as
semantically qualified only when
`target/metaharness/qualification.json` records full mode, the real semantic
gate, all five gates passing, and a clean replay, and
`target/metaharness/verification.json` independently closes. A synthetic-only
or unverified receipt withholds that claim.

## Consequences

- Harness optimization cannot edit the test truth or product semantics.
- Qualification is replayable and cost-bounded.
- Agentic-QE and Darwin consume the same native evidence.
- Policy improvements with no held-out measured benefit are discarded.

## Alternatives rejected

- Allow Darwin to edit Rust or expectations: invalidates the oracle boundary.
- Optimize only on public tests: invites overfitting.
- Build the full harness before the native slice: violates proportionality.
- Treat synthetic evolution as semantic proof: measures harness mechanics, not
  Oxigraph behavior.

## Evidence

- [MetaHarness/Darwin qualification guide](../../tools/metaharness/README.md)
- [Agentic-QE integration decision](0005-agentic-qe-integration.md)
- RuvNet shipped source:
  `packages/darwin-mode/src/safety.ts`,
  `packages/darwin-mode/src/bench/gates.ts`, and
  `packages/darwin-mode/src/sandbox.ts`

## Acceptance boundary

Darwin is enabling infrastructure, not a conformance authority. A full
qualification receipt can prove that the policy variant passed immutable
oracles; it cannot upgrade the scope of those oracles or close a normative
requirement gap.
