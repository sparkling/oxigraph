# ADR-0017: Repository evolution and evidence promotion harness

- **Status**: Implemented
- **Date**: 2026-08-24
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: the separate `tools/engineering-harness` runtime,
  native Codex/Claude workers, quality-first Router, sealed reconstruction,
  one-session sandbox, repair/review lifecycle, and application receipts are
  implemented and directly tested. A dual-provider G1.2 application run is
  accepted, and G1.3-G1.5 have direct source-bound candidate acceptances. The
  existing `tools/metaharness` semantic qualifier remains separate; unattended
  Dream Machine execution remains deferred behind the activation gates in this
  ADR
- Update note: implementation preserves human-only promotion and the
  committed G0-G4 task graph without treating Ruflo rows, installed packages,
  generic scores, or application receipts as semantic qualification
- **Related**:
  [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md),
  [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md),
  [ADR-0012 — Immutable broad Jena differential harness](0012-immutable-broad-jena-harness.md),
  [ADR-0013 — Mutation competence and provenance](0013-mutation-competence-and-provenance.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md),
  [ADR-0029 — RDF4J REST interoperability](0029-rdf4j-rest-interoperability.md),
  [ADR-0030 — Leased remote HTTP transactions](0030-leased-remote-http-transactions.md),
  [ADR-0031 — Multi-repository lifecycle](0031-multi-repository-lifecycle.md),
  [ADR-0032 — Incremental entailment projections](0032-incremental-entailment-projections.md),
  [ADR-0033 — Analytical/WCOJ execution](0033-analytical-wcoj-execution.md)

## Context

The linked-data-store programme now spans transactional persistence, standards
conformance, compatibility differentials, mutation testing, security, and
performance. Parallel research and bounded harness evolution can reduce the
cost of that work, but a second semantic runner or an autonomous publication
path would weaken the evidence boundary already established by ADR-0004,
ADR-0005, ADR-0012, and ADR-0013.

The repository already owns stronger proof than a generic agent loop:

- exact native Cargo, W3C, Jena, and Souffle commands;
- schema-v4 Agentic-QE receipts and immutable run publications;
- source-bound mutation receipts;
- a policy-only Darwin adapter with protected-input hashing; and
- an independent MetaHarness qualification verifier.

Dream Machine 0.1.1 is installed under the user npm prefix and its local CLI is
deterministic. The audited upstream source at commit
`8ce385786faa5e63cc0e7105cc6e96f663a51f07` does not, however, provide config
fields for native-provider-only execution, local-only publication, protected
paths, or shell-free evaluator argument vectors. Its compiled routine names an
OpenRouter credential, instructs creation of a public gist plus an issue,
branch push, and draft PR whose visibility follows the target repository, and
accepts executable-looking strings from config. The published CLI itself makes
no provider call and needs no model key; `/schedule` only emits workflow JSON
and defaults to a Claude model. OpenRouter is instead hard-coded in the
optional, disabled research workflow and appears as an example in the compiled
prompt. The npm 0.1.1 artifact also differs from current source carrying the
same version. These are activation blockers, not reasons to duplicate the
engine locally.

The evidence repair programme has closed G0.1-G0.5 for their exact scopes:
registered source revisions were initialized and checked, `46ef17fc` restored
the locked Jena runner, `22a8033e` refreshed the protected Jena profile and
produced two byte-identical 76-scenario/198-assertion runs, and `253a2b34`
accepted the exact 144/129 Agentic-QE CLI inventories plus a 34-test
`persistence-write` profile. These are source-bound task closures, not an
umbrella current-HEAD qualification.

The OxDatalog mutation receipt remains valid only for its sealed source
snapshot, so G0.6 remains open. G0.7 must then reconcile and freeze the
receipt-sensitive ledger, README, ADR, plan, and research claims against the
complete protected subject. Full semantic MetaHarness qualification and the
separate G1.7 promotion gate remain unavailable until those open gates close.
A passing synthetic Darwin run proves only the policy mechanics.

The repository now contains a separate application-delivery control plane,
quality-first model router, native Codex and Claude worker adapters, and a
baseline/evaluator-separated G1 task corpus. The existing `tools/metaharness`
package remains deliberately limited to semantic qualification and has not
absorbed those engineering responsibilities.

## Decision

Adopt a thin, local-first evolution control plane. It coordinates existing
authorities and may not replace them.

| Component | Permitted role | Not an authority for |
|---|---|---|
| Ruflo swarm, tasks, goals, and AgentDB | Parallel research, dependency state, transient project memory, and anti-drift coordination | RDF semantics, promotion, or release claims |
| RuvNet Brain | Source-grounded guidance for the rUv stack | Oxigraph behavior not established by local source/tests |
| MetaHarness genome, score, and OIA | Advisory readiness, risk, and infrastructure analysis | Product correctness or current semantic qualification |
| Existing `tools/metaharness` qualifier | ADR-0004 policy evolution against protected semantic evidence | Engineering implementation, repair, or product promotion |
| `tools/engineering-harness` runtime | Route, build, repair, review, and receipt isolated G1-G3 candidates | Semantic truth, publication, or promotion |
| Darwin | Bounded evolution of frozen harness-policy surfaces | Rust source, manifests, expected results, thresholds, or semantic answers |
| Agentic-QE | Exact profile coordination and schema-v4 evidence publication | A simulated or JavaScript substitute for native Rust execution |
| Dream Machine | Local version/config compilation, rotation vocabulary, three-verdict discipline, and a secondary ledger | Scheduling, provider routing, publication, promotion, or replacement receipts |
| Native and differential runners | Pass/fail evidence for their exact named scopes | Claims broader than their reviewed inventories |

The execution rules are:

1. Implement one product capability slice before expanding its harness.
   Harness work remains proportional and should not exceed 20% of a programme
   slice without an explicit review.
2. Parallelize independent research, test design, and adversarial review.
   Permit one candidate writer and one conceptual change per evaluation.
3. Use isolated worktrees and isolated Cargo target directories for concurrent
   writers. Agentic-QE publication, Jena publication, mutation publication,
   and full MetaHarness qualification remain sequential because they share
   locks, protected snapshots, or mutable latest pointers.
4. Freeze the hypothesis, evaluator inventory, fitness function, thresholds,
   and baseline before the candidate runs. Evaluate parent and candidate on
   the same corpus.
5. Protect Rust source, standards inputs, expected outcomes, test inventories,
   thresholds, dependency manifests, CI, ADRs, and receipt validators from
   Darwin mutation. Failed and rejected variants remain evidence.
6. Require `ACCEPT`, `REJECT`, or `INCONCLUSIVE`; missing credentials, stale
   locks, incomplete inventories, silent evaluators, and unverifiable receipts
   produce `INCONCLUSIVE` or `REJECT`, never fabricated success.
7. Promotion is a human decision. No push, gist, issue, PR, deployment,
   schedule, merge, or public upload is allowed without explicit authorization
   in the active task.
8. Model execution uses native provider clients and authentication only.
   OpenRouter is prohibited, including fallback or retry routing.
9. Every candidate verifier restores the pinned baseline, overlays the frozen
   evaluator commit, applies the admitted patch, and only then rebuilds every
   declared crate, feature set, native helper, generated binding, and web
   artifact. Focused public, independent, and impacted regression commands run
   against those fresh outputs and bind their commands, exits, tool versions,
   and relevant digests into the candidate receipt.
10. Ordinary candidate cycles run only affected fast product gates. The full
    sequential Agentic-QE, Jena, mutation, and semantic-qualification gates run
    only for a promotion candidate.

## Engineering runtime boundary

The engineering control plane is implemented as a separate private package
under `tools/engineering-harness`. Its manifests
request current upstream packages through `latest` dist-tags, while its
committed lockfile, installed-package checks, executable hashes, and receipts
bind the exact integrity-verified bytes used by a run. Package presence,
factory output, a synthetic Darwin pass, or a harness score is not an
implementation claim.

The initial required package set is `metaharness`, `@metaharness/harness`,
`@metaharness/router`, `@metaharness/darwin`, and `@metaharness/avo`.
`@ruvector/ruvllm` and `agenticow` remain optional until a tested local
embedding or bounded copy-on-write path consumes them. All dependency installs
disable lifecycle scripts.

Before adapting factory output, run disposable factory diagnostics for both
`claude-code` and `codex` targets and retain their generated manifests, CLI
help, and test results as advisory inputs. A generated MCP declaration is not
registered unless that exact command exists in the generated CLI, passes the
engineering doctor, and is covered by a direct invocation test. Factory output
may be copied only through a reviewed adaptation commit; it is not itself a
trusted runtime.

The engineering path is:

```text
latest MetaHarness factory
  -> separate Oxigraph engineering harness
  -> quality-first Router
  -> native Codex / native Claude workers
  -> isolated candidate
  -> rebuild after evaluator overlay and candidate patch
  -> focused native evaluators and cross-vendor review
  -> candidate receipt

promotion candidate
  -> existing Agentic-QE semantic profiles
  -> existing Darwin qualification and independent verifier
  -> human ACCEPT / REJECT / INCONCLUSIVE
```

Every model-backed architecture, implementation, repair, review, and Darwin
reflection role must expose native Codex and native Claude candidates. The
real Router runs before each role, freezes a routing snapshot for the
candidate, and records a quality outcome only after the direct application
evaluator completes. Missing tools and preparation failures are not model
quality observations. Provider keys and base-URL overrides are stripped;
workers use literal argument arrays, path and worktree allowlists, bounded
time/output, and recorded host/model/role/task provenance.

Cold start uses paired calibration rather than an unearned provider ranking.
For each role and task class, native Codex and native Claude independently run
the same frozen contract, baseline, evaluator, and ceilings until five valid
paired outcomes exist. The direct application evaluator chooses the result;
ties break deterministically by fewer repair cycles, then lower measured cost,
then a frozen provider order. Preparation failures, missing tools, and
cancelled runs do not train the Router. After cold start, repeat a paired
calibration at least every fifth admitted task and after any model, harness, or
evaluator version change; drift reopens cold start for that role/task class.

Engineering implementation starts only after a direct G1 evaluator has landed
as a later evaluator-only commit over a genuinely red baseline. Each task also
freezes mutable and blocked paths, Cargo features and targets, one public, one
independent, and one impacted-regression command, resource ceilings, and
application success criteria. G1.1 is green oracle infrastructure rather than
a product repair task. The first discriminating candidate is G1.2: baseline
`3edfb86a` plus evaluator-only commit `eaf7161c`. Continue through G1.3-G1.7 in
dependency order. Do not infer engineering-runtime readiness merely from those
evaluator commits.

Darwin/GEPA may evolve engineering policy around frozen native models only
after at least five discriminating training tasks and five sealed holdouts
exist. AVO is reserved for a bounded hard-tail task with several plausible
implementations and a discriminating oracle; it is not used for routine G0
evidence repair or straightforward compiler failures. Neither mechanism may
edit product truth, evaluator commits, standards inputs, thresholds, resource
ceilings, ADR law, or promotion rules.

### Engineering runtime definition of done

`tools/engineering-harness` is operational only when all of the following are
implemented and directly tested:

- a real `HarnessKernel` and `AlgorithmRouter` execute frozen task contracts;
- persistent native Codex and Claude worker pools obey path, tool, network,
  authority, protected-input, cancellation, wall-time, and output limits;
- bounded plan critique, independent cross-vendor review, and
  verifier-directed repair execute as distinct receipted stages;
- transient native-host retry is bounded by per-host circuit breakers and can
  never cross providers or route through OpenRouter;
- Router outcome memory is written only after the direct application verifier
  and binds the role, task class, model, evaluator, and exact candidate;
- candidate receipts bind the baseline, evaluator commit, admitted patch,
  rebuilt outputs, literal commands, runtime identities, exits, and relevant
  digests, with adversarial receipt and replay tests; and
- one real G1 task completes end to end with both native vendors represented,
  while the existing Agentic-QE, Jena, mutation, and MetaHarness semantic
  receipts remain authoritative and unmodified.

Package installation, factory scaffolding, mocked workers, a readiness score,
or a synthetic Darwin run does not satisfy this definition.

## Programme decisions and task ownership

The programme keeps three different records deliberately separate:

| Record | Authority | Lifecycle |
|---|---|---|
| ADR | Architectural intent and accepted constraints | Proposed, Accepted, Implemented, Superseded |
| Committed GOAP plan ID | Stable work identity, dependency, and exit gate | Updated with the repository |
| Ruflo task row | Local execution status, priority, assignment, and analytics | Transient project runtime state |

G0 evidence repair remains governed by ADR-0004, ADR-0005, ADR-0012,
ADR-0013, and this ADR. G1 is owned by ADR-0018 and ADR-0019; G2 by ADR-0020,
ADR-0021, and ADR-0022; G3 by ADR-0023, ADR-0024, and ADR-0025; and G4 by
ADR-0026 through ADR-0033. Those sixteen decisions are Proposed living plans,
not implementation claims.

The linked execution plan contains 39 stable executable G-identifiers. The
initial 26 G0.1-G3.5 identifiers were materialized as Ruflo rows on
2026-08-24; the 2026-08-25 expansion added G1.5b-G1.5c, explicit G2.3a-G2.3c
and G2.4a-G2.4b leaves, and G4.1-G4.8. `HARNESS-REGISTRY` is a named harness
control between G1.6 and the G2.1 evaluator freeze, not a product G-identifier.

The current managed task surface persists repository-local execution state but
does not expose a dependency or description-edit argument. Rows therefore
carry the dependency text available when they were created, and historical
descriptions may be stale. The committed G-identifiers and GOAP tables remain
the portable authority; any committed Ruflo task IDs are repository-local
audit pointers only and never prove product behavior. The corrected
repository-local adjacency map was stored and read back through the managed
Ruflo CLI against `.swarm/memory.db` at
`task-plans/linked-data-store-g0-g4-2026-08-25-v2`.

The installed source-backed infrastructure audit is **OIA** (Open
Infrastructure Architecture, layers L1-L9). Its point-in-time result is an
advisory read, not a durable qualification receipt. No OVA-named Dream Machine
or Ruflo component was found in the installed source, so OVA is not used as a
plan or evidence label.

## Dream Machine activation gates

Dream Machine remains unscheduled and uncommitted as a repository runner. Gates
1-7 are prerequisites that must be revalidated at the start and end of each
proposed run; later source, package, inventory, policy, or repository drift
reopens them. Gate 8 is per-run authority and never closes permanently:

1. **Supply chain:** select a source-corresponding, reviewed, immutable package
   or build; verify registry integrity/signature or provenance, `gitHead`,
   installed bytes, and an exact source commit; pin every optional evaluator
   backend; prohibit lifecycle scripts. The observed npm 0.1.1 artifact has
   integrity
   `sha512-ChagmBIuBHesdqW3nENh+heJgjHiIsSu4pLEX5Mp9X4orXDiUIb5xdsX4g3C8xSrMwzhyK+QO5jxENSMbgTcDg==`,
   shasum `93c9ff8f58e942899b99397f64416a6aedea7b79`, and `gitHead`
   `3de01079abe64e4a1f2d3fe3b758523705b3bf47`. The installed
   `package.json` and `dist/bin.js` SHA-256 values are respectively
   `0768ae19c78df7bb6dc5a0a584329fe7d8a9e69c98242d9ce1546261cc195428`
   and `359bb2c1d9f9e85f8fe627fd51c304c81a4ea965ddfac968c6c13231a665da37`.
   These observations do not close the gate: GitHub has no `v0.1.1` tag or
   release, the npm attestation endpoint returned 404, and correspondence
   between those bytes, that `gitHead`, and the audited source remains
   unverified.
2. **Provider policy:** express and enforce a native-provider allowlist with no
   OpenRouter example, secret, endpoint, workflow, fallback, or retry.
3. **Publication policy:** express `local-only` in config and enforce it below
   the prompt layer. `autoMerge: false` is necessary but insufficient.
4. **Execution policy:** replace shell command strings with reviewed executable
   and literal-argument vectors; constrain network, filesystem, and protected
   paths; reject exit-zero/silent evaluators without a required artifact.
5. **Repository adapter:** delegate to the existing Agentic-QE and
   MetaHarness entrypoints; do not copy CI logic or introduce another receipt
   format. The Dream ledger is secondary to the conformance ledger and native
   receipts. Upstream's Actions helper currently hashes a report and then
   appends the witness to the same report, invalidating the hash. Require a
   finalized-report-byte round trip and store the witness separately; a stamp
   over subsequently modified bytes is invalid.
6. **Isolation:** run only from a clean, disposable worktree with bounded
   resources and no ambient GitHub publication authority.
7. **Evidence repair:** revalidate the completed G0.1-G0.5 source, Jena, and
   Agentic-QE inputs against their exact bindings; verify the mutation harness
   and regenerate the exact G0.6 OxDatalog receipt with the latest registry
   `cargo-mutants` release resolved without a top-level version pin and sealed
   by observed-version and executable provenance; then complete G0.7 by
   reconciling and freezing all protected ADR, plan, ledger, and research
   documents before full MetaHarness qualification and independent evidence
   verification.
8. **Operator decision:** obtain explicit authorization for any schedule or
   external publication after reviewing the generated routine byte-for-byte.
   Re-obtain it for every active task and exact generated artifact.

Generated Dream prompts are never hand-edited into compliance. Either the
compiler/config model enforces these gates or the runner stays disabled.
Every activation attempt must also emit a machine-readable, independently
verifiable status record. For each gate it binds the package digest and source
commit, literal negative-test command and verifier-output hash, observation
time and freshness/expiry rule, exact generated-artifact digest, disposition,
and approving actor. Prompt text and a bare checksum are not closure evidence.

## Consequences

- The programme gains parallel research, durable task state, frozen
  hypotheses, and bounded policy evolution without creating a second oracle.
- Dream Machine's useful vocabulary and deterministic tools can be evaluated
  locally while its high-authority autonomous path remains disabled.
- Existing fail-closed drift is visible. Historical Jena and mutation receipts
  remain valid for their sealed July subjects but are not current-HEAD proof.
- G0.1-G0.5 have source-bound completion evidence; this does not close G0.6,
  G0.7, full semantic qualification, or G1.7 promotion.
- A synthetic Darwin qualification may demonstrate deterministic policy
  mechanics, but only a fresh full qualification plus independent verification
  supports a semantic-qualification claim.
- The engineering runtime is operational for evaluator-separated G1 tasks, but
  every new task still requires its own frozen red baseline, evaluator commit,
  exact candidate verification, and human promotion decision.
- Volatile `.claude-flow`, `.claude`, `.swarm`, RVF, RuVector, and `var` state
  remains local runtime state and is not a committed harness definition.

## Alternatives rejected

- **Schedule Dream Machine immediately.** Rejected because provider,
  publication, protected-path, shell, evidence, and supply-chain controls are
  not expressible in its current config.
- **Post-process the generated prompt.** Rejected because it creates a
  hand-maintained, unverifiable fork of the compiler output.
- **Replace Agentic-QE receipts with Dream witnesses.** Rejected because a
  checksum is not the repository's source-, inventory-, artifact-, and
  execution-bound evidence contract.
- **Let Darwin edit Rust or evaluators.** Rejected by ADR-0004; it permits
  reward hacking and invalidates the oracle boundary.
- **Run every evidence profile on every candidate.** Rejected because it
  duplicates expensive work. Use an affected fast gate, then the sequential
  full gate only for a promotion candidate.
- **Commit generic Ruflo runtime output as the harness.** Rejected because the
  current generated policies classify this Rust workspace generically and do
  not encode its immutable semantic authorities.
- **Turn `tools/metaharness` into the engineering worker host.** Rejected
  because it would mix mutable development behavior with receipt-sensitive
  semantic qualification.
- **Build before applying a candidate patch.** Rejected because the verifier
  could run against stale binaries or generated artifacts.

## Evidence

- [Execution plan](../plans/linked-data-store-evolution-harness-plan.md)
- [Existing policy-only qualification adapter](../../tools/metaharness/qualify.mjs)
- [Existing independent verifier](../../tools/metaharness/verify.mjs)
- [Engineering application harness](../../tools/engineering-harness/README.md)
- [Agentic-QE profile registry](../../tools/agentic-qe/profile-definitions.mjs)
- [Reviewed Jena profile lock](../../tools/jena-parity/profile.lock.json)
- [Dream Machine audited source](https://github.com/ruvnet/dream-machine/tree/8ce385786faa5e63cc0e7105cc6e96f663a51f07)
- [Dream config schema](https://github.com/ruvnet/dream-machine/blob/8ce385786faa5e63cc0e7105cc6e96f663a51f07/packages/compile/src/config.ts)
- [Dream compiled pipeline](https://github.com/ruvnet/dream-machine/blob/8ce385786faa5e63cc0e7105cc6e96f663a51f07/packages/compile/src/index.ts)
- RuvNet implementation source:
  `metaharness/packages/darwin-mode/src/evolve.ts` and
  `metaharness/packages/darwin-mode/src/bench/gates.ts`

Non-authoritative local verification on 2026-08-24 established:

- Dream Machine 0.1.1 at `/home/claude/.local/bin/dream-machine`;
- byte-identical output from two config compilations;
- a missing-ledger path that reported an empty valid ledger because npm 0.1.1
  catches ledger read errors; this is not ledger-validation evidence, and
  activation requires an explicit existing ledger whose absence and read
  errors fail distinctly;
- MetaHarness genome `ready`, risk `0.21`, test confidence `0.8`;
- harness score 71/100, with tool safety 100 and memory usefulness 40;
- a point-in-time OIA dry-run reporting composite security severity `clean`
  but generic `unknown-harness@0.0.0` identity; no durable OIA receipt was
  produced, so this is advisory only;
- repository MetaHarness tests 13/13 and synthetic qualification `PASS`; and
- a deterministic two-generation/two-child Darwin dry-run plan with no write
  execution.

Source-bound engineering evidence on 2026-08-25 established:

- 111/111 engineering-harness tests and a passing dependency/provider doctor;
- accepted dual-provider G1.2 application receipt
  `d303b85b766bd0c6d459044da4ca891e2d6b1feb728124cbeb2668c1372c8e2c`,
  with native Claude and Codex represented and every required cross-vendor
  review accepting the selected candidate;
- direct frozen candidate acceptance for G1.3's 9/3/3 evaluator split; and
- direct frozen candidate acceptance for G1.4's 6/2/2 evaluator split; and
- direct frozen candidate acceptance for G1.5's unified-egress 12/8/13
  evaluator split in a read-only, network-isolated verifier session; and
- direct frozen candidate acceptance for G1.5b's update-owned cancellation
  6/6/12 evaluator split; and
- direct frozen candidate acceptance for G1.5c's negotiated generic admission
  5/15/21 evaluator split. G1.6 runtime claims remain a separate
  evaluator-first task.

## Decision boundary

This ADR implements the engineering architecture and authority boundary; it
does not claim that Dream Machine is an approved unattended runner, full
MetaHarness qualification is current, or an application-harness acceptance is
safe to promote. ADR-0018 through ADR-0033 remain Proposed until their product
behavior and evidence exist. Each task still requires a
red/evaluator-separated corpus, direct control-plane tests, continuously
current prerequisites,
per-run authorization, activation status, and exact receipts above.
