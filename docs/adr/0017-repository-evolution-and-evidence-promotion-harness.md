# ADR-0017: Repository evolution and evidence promotion harness

- **Status**: Implemented
- **Date**: 2026-08-24
- Updated: 2026-09-03
- Deciders: Oxigraph parity programme
- Implementation status: the separate `tools/engineering-harness` runtime,
  native Codex/Claude workers, quality-first Router, sealed reconstruction,
  one-session sandbox, repair/review lifecycle, application receipts, canonical
  task registry, generated command registry, and bounded candidate-rejection
  receipts are implemented and directly tested. A dual-provider G1.2
  application run is accepted, and G1.3-G1.6, including G1.4a-G1.4b, have
  direct source-bound candidate acceptances. G1.7 qualification contract v7,
  proposed two-phase authorization/final-decision validation, exact G1.4b
  prerequisite replay, Darwin-free legacy replay, authorization-bound sample
  framing, paired control statistics, pre-execution gates, pure benchmark-owner
  replay, bounded canonical control-receipt candidate replay, and the physical
  write-once receipt-last control envelope with sealed current-state replay are
  implemented and fail closed. The authority-free execution plan, physical
  product-source workspace primitive, and pure build-process/product-evidence
  replay are also implemented. The source primitive materializes an exact
  evaluator-composed tree behind held descriptors, pre-admits every root
  and required-submodule object before the first private pack, binds a read-only
  source and initially empty target, and retains all handles rather than unlink
  after an unreaped Git outcome. Production build begin/finish deliberately
  return `MISSING` until a physical owner can prove exact child close and reap.
  Canonical execution-request v1 and replay-only process-evidence v3 are frozen
  and adversarially tested, but v1 permanently binds an incompatible isolation
  policy and v3 remains non-binding and authority-free. Policy v2 and execution
  request v2 now freeze the successor structural contract, and an exact-attested
  dormant native `execveat` helper freezes the bounded status mechanics; none is
  physically launch eligible or authoritative. Private
  build-process/control/sample owner emission, containment-v2 native mechanics,
  sealed expected-envelope provenance, a current control or qualification
  receipt, qualification, and promotion are not implemented. The
  dormant source and containment owners cannot pass the current proposed
  decision or invoke live mechanics.
  The existing `tools/metaharness` semantic qualifier remains separate;
  unattended Dream Machine execution remains deferred behind the activation
  gates in this ADR
- Update note: implementation preserves human-only promotion and the
  committed G0-G4 task graph without treating Ruflo rows, installed packages,
  generic scores, or application receipts as semantic qualification. Native
  patch admission now also requires the exact canonical bytes to pass a
  bounded Git parser before an implementation or repair output can be labelled
  accepted; sealed evaluator reconstruction remains the applicability
  authority. Commit `4a15caa07df37d884e7c74d4b69c0505ce3de6e1`
  makes registered task IDs the only task-selection authority and retains the
  historical per-task exports only as compatibility shims. Commit
  `afe30c7de7e3df6e72a0a855d83efc612339f261` adds current receipt v6,
  exact attempt-or-rejection accounting for every successful patch-producing
  invocation, non-trainable reconstruction/applicability rejection records,
  and byte-exact replay-only handling for v1-v5. The outer G1.7 qualification
  receipt remains v1. Commits `4e3eef61`, `a1d426bb`, `87a5efc5`, `a6e229df`,
  and `f1cb6680` integrate v4's exact historical contract, proposed-decision
  gating, strict
  then-current v4 receipt semantics, and v1/v3 structural replay-only
  compatibility as historical provenance.
  Commits `f357a1b4`, `509a6611`, `7b1eab5d`, `8ca3804b`, and `0257587e`
  then make v1/v3/v4 replay Darwin-free, bind the exact G1.4b prerequisite, and
  implement and harden contract v5's two-phase protocol. Commits `20477225`
  and `799307fb` archive exact v5 bytes, freeze the missing sample/statistical/
  verdict semantics, and version the statistical protocol as v6. Commit
  `d1e18c6e` archives the exact v6 contract/authorization/final bytes, binds
  merged product `e9d2db1b...` separately from the later control commit through
  qualified identity v2, and versions the current protocol as v7. The current
  exact contract SHA-256 is
  `42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80`.
  Commits `d3af2e17` and `45121da9` add pure replay of four isolated builds,
  two serialized control sessions, 392 exact launch records, recomputed Darwin
  statistics, and a bounded canonical control-receipt candidate. Control
  authorization and the final decision set remain proposed/unapproved; `run`
  exits 4 before work and creates no G1.7 run. Candidate replay deliberately
  returns `binding: null` and `finalDecisionEligible: false`; no current binding
  can authorize qualification until real control bytes have been emitted and
  replayed through the physical sealed-envelope owner. Commit `fbbb692b`
  implements that owner for exact three-file archives with exclusive no-follow
  creation, 0400 files, a 0500 directory, receipt-last sequencing, held-FD
  filesystem/device checks, and exact post-seal replay. Seal emits no binding;
  only replayed PASS may yield a prospective binding, and all authority remains
  false. Pure and physical fixtures do not establish production control owner
  emission, crash/power-loss/filesystem-flush durability, historical
  receipt-last order from replay, or same-UID tamper resistance
- G1.7 containment-owner update: commit `f04b9bc7` implements the dormant,
  authority-free containment contract. It freezes the one reviewed host
  locator at
  `/var/lib/oxigraph-engineering-harness/locks/g1.7-phase-a.lock`, binds held
  root-to-lock ancestry, distinct controller/holder/worker/contender process
  identities, complete cgroup identity, requested limits, quiescence, and
  bounded cleanup, and rejects coherent private-lock substitution. A narrow
  authorization gate replays the exact 11,426-byte current v3 authorization
  artifact (raw SHA-256 `31b8fce5...`) without importing the benchmark or
  Darwin graph and rejects `CONTROL_AUTH_PROPOSED` before mechanics. Focused
  replay and dormant-owner tests pass 27/27. The four expected artifact hashes
  remain explicitly caller-supplied, unsealed, and non-authoritative;
  `binding` is null, final-decision eligibility and every authority are false,
  and no native syscall adapter or live containment evidence exists
- G1.7 source-workspace update: commit `a457f46c` implements the exact four-
  build execution plan and a descriptor-anchored source materializer that bind
  the approved product commit,
  evaluator overlay, effective tree, required Gitlinks, `Cargo.lock`, source
  manifest, distinct source/target identities, and v1 authority-free projection.
  Caller records and cancellation signals are captured without observing
  accessors or unbounded own-key snapshots; signal listeners are installed only
  for active acquisition and released on every terminal path. All root and
  required-submodule objects pass one canonical 500,000-object/2.25-GiB global
  admission before the first pack, apply, tree write, or checkout; binary patch
  expansion is refused. Unreaped Git preserves base and temporary inherited
  handles and forbids cleanup. Production build begin/finish are intentionally
  unavailable until the later supervising owner supplies non-forgeable reap
  proof; only a one-shot, workspace-bound non-production test proof can finish.
  Focused source/native/candidate, execution-plan, and legacy-owner tests pass
  68/68, and an independent read-only revision audit is clean. This establishes
  no build, launch, control, qualification, promotion, publication, provider,
  or Router authority and makes no WORM, binary-patch, or hostile same-UID race
  claim
- G1.7 build-evidence replay update: commit `c5687dac` implements two pure,
  capability-free contracts that replay the exact Cargo request and frozen
  environment recipe, source and
  logical-owner bindings, platform identities, raw process streams, executable
  bytes, and ELF identity for all four product builds. Executable replay pins
  the exact held `target/release/deps` directory chain, rejects ancestor alias,
  owner, filesystem, and parent drift, requires a single-link output file, and
  bounds POSIX modes before type-bit evaluation. The product projection
  returns `BUILD_EVIDENCE_AND_CAPTURE_CLAIMS_REPLAYED`; each process projection
  returns `CARGO_INVOCATION_ENVIRONMENT_AND_CAPTURE_CLAIMS_REPLAYED`. Both keep
  `binding: null`, `finalDecisionEligible: false`, and every authority flag
  false. Focused process/product replay tests pass 23/23. The replay explicitly
  does not claim independently observed Cargo execution, held-file execution,
  verified Cargo configuration or vendor contents, verified private-directory
  provenance/mode/ownership/ancestry, Cargo-selected `rustc`, or direct `rustc`
  child evidence. It emits no build, launch, control, qualification, promotion,
  publication, provider, or Router authority and cannot replace the missing
  physical supervising build owner
- G1.7 isolation, cleanup, and raw-supervisor update: build-owner v2 commit
  `3688ccda` is a stricter deterministic projection but remains replay-only; it
  cannot convert caller-supplied capture labels or outcome records into
  physical provenance. Commits `008ab939` and `da41d7e0` freeze the non-tmpfs
  isolation contract and exact descriptor-relative mapping of read-only
  `/workspace/source` from held source FD 4 and writable `/state/target` from
  held target FD 5, with both beneath held workspace parent FD 3. The policy
  rejects aliases, alternate mappings, and missing mount restrictions; it does
  not execute them without the still-missing native adapter.
  Commits `5d054857`, `a9f9afc2`, `f482bec0`, and `3b289522` retain unsafe
  containment state and place all destructive cleanup helpers, lease release,
  and close under bounded terminal deadlines. Any helper timeout or rejection
  stops the remaining destructive sequence and retains the session plus every
  still-owned lease or helper handle; lease release must settle before close.
  Commit `c5050e9c` adds an
  authority-free POSIX raw-byte process supervisor with exact own-data inputs, one
  caller-supplied shared output ceiling, a 1-MiB aggregate argv ceiling, native abort
  capture, typed first-terminal reason, group TERM/KILL escalation, distinct
  exit/close/EOF/status/reap truth, and retained unreaped handles. One
  module-global active-or-retained slot rejects overlap with
  `ERR_BOUNDED_BYTE_PROCESS_BUSY`. Focused raw and legacy process tests pass
  24/24. Commits `13afa94d` and `3f8951e3` then freeze and harden canonical
  execution-request v1 bytes over the exact authorization, execution plan,
  isolation policy, source, platform/toolchain, owner/process generation, and
  complete Cargo argv including `argv0`. Accessor-, proxy-, prototype-, and
  ambiguous byte inputs fail closed. Request v1 permanently binds isolation
  policy v1, so it is explicitly launch-ineligible and cannot later be
  reinterpreted as eligible. Commit `8b2c6366` adds replay-only process-evidence
  v3 over an acyclic request-to-containment hash graph, raw Cargo JSONL and
  cgroup terminal observations, and a stable held executable target ELF. Its
  projection is `SUCCESSOR_PRIVATE_ISSUER_REQUIRED`, with `binding: false`,
  physical execution false, and every authority false. Focused request/process
  tests pass 28/28. Request v1 and process v3 remain legacy-incompatible with
  the successor path. Commits `ef869cf4`/`466d2d78` freeze and correct policy
  v2; `75a07693` freezes request v2 as
  `POLICY_V2_BOUND_PRIVATE_ISSUER_REQUIRED`/`STRUCTURAL_POLICY_ONLY`; and
  `c113a88f` attests a dormant helper and bounded status protocol whose tests
  compile but never execute it. These pieces remain physically ineligible,
  binding-null, and authority-free: no private co-located issuer,
  containment-v2 native adapter, build-owner v3, product-owner v4, live build,
  or authority exists
- Upstream synchronization checkpoint: audited merge
  `e9d2db1b7c4eb974b406136e667e09ba06e34b48` has tree
  `fcc5bb75c469fbbf80f77bc330279d3a7c593bfe` and ordered parents
  `b295ea80...`/`ec68e3dd...`. Its exact-tree audit passes the 411-test harness
  at 409/0/2, CLI 152/152, XML 120/120 and 89/89, the 47-test fork lane, Python
  222/222, actionlint, doctor, and a PyPI-compatible cp39-abi3 wheel build. It
  grants no G1.7 or publication authority. The separate pure reseal is complete
  in `d1e18c6e`; committed v6 bytes remain exact historical fixtures, and the
  v7 binding is a merged-product identity control rather than approval
- G1.4a/G1.4b registry update: commits `13352ff9` and `c2497225` first extend
  the historical seven-task/27-command registry checkpoint to eight tasks/30
  commands. Commits `1362f250`, `3bb4f0fb`, and `695def8d` add and bind G1.4b,
  producing the current exact active nine-task/33-command surface. After G2.1,
  the package suite contains 667 tests: 663 pass, the deliberate sealed-subject
  freshness gate is the sole failure after detecting G2.1 product paths, and
  three intentional host-gated tests skip. This is not a helper/request
  regression or current-HEAD qualification; doctor evidence remains
  native-only, local-only, and non-promoting
- ADR-0034 exact-create update: commits `78b2cf99` through `65fb0e7a` freeze
  schema-v1 compatibility and add the v2 path, tree, contract,
  reconstruction, worker-context, schema, patch-assembly, and output controls.
  Commit `54a056e0` adds an unregistered exact-byte native worker with retained-
  descriptor provider/schema/Git identity checks, original-process-group
  quiescence, unsafe-root retention, and bounded no-retry failure behavior. Its
  112/112 focused matrix and two independent GO reviews establish only that
  partial infrastructure. Commit `11e72201` adds the opaque one-shot candidate
  and verifier lifecycle, exact submodule claims, structural host/worker wire,
  typed classification, shared ceilings, and strict cleanup quarantine; the
  related non-G1.7 regression matrix passed 128/128. Commit `f3a0c127` adds
  ordered retained-FD binding and lifecycle proof for the eight-file
  ESM/launcher payload, with honest runtime/execveat/same-UID nonclaims; the
  expanded matrix passed 177/177. Commit `c2cdde16` adds a candidate-specific,
  qualification-independent containment-owner lifecycle contract covering
  fresh exclusive generations, exact cgroup-v2 identity and raw limit
  readbacks, clone3/pidfd claims, intrinsic cancellation, bounded operations,
  late-authority retention, escaped-descendant kill/re-observation, direct-child
  reap, terminal emptiness, post-removal absence, and no-retry retained
  admission. The related matrix now passes 201/201 and its Node 20 floor passes
  34/34. Commit `23997c29` adds the separate canonical request/status replay
  protocol and an exact compile-only freestanding supervisor attestation. The
  static skeleton implements no request parser, status writer, or containment
  mechanics and is never executed; replay remains binding-null and all
  authority is false. Mutation-safe copy-on-read artifacts and honest supplied-
  output equality resolve both independent audit blockers. The expanded matrix
  passes 210/210 and its Node 20 floor passes 50/50. Commit `88b9d7e7` adds the
  separate successor FD-map v2, exact canonical argv/environment and fourteen-
  file launch capsule, collision-safe child-remap requirements, bounded output-
  drain requirements, and exact scratch/pipe/pidfd lifecycle requirements, plus a pure interactive
  START/READY/COMMIT/CANCEL reducer. It independently replays capsule bytes,
  keeps READY decision-null, digest-binds later decision acknowledgements,
  leaves physical outcomes null, and makes pre-commit cleanup guardian-owned.
  The expanded related matrix passes
  237/237 on both current Node and Node 20, and three independent reviews are
  GO for this dormant boundary. Commit `7191ddde` adds the next additive,
  unregistered launch/bootstrap successor. Exact FDs 18-25, a CLOEXEC child
  outcome channel, held-stop `PTRACE_EVENT_EXEC` image proof, and complete
  trace/remap/close/exec failure phases close the declarative launch race. The
  capsule is then transferred in-band before `READY` through a cancel-only
  bootstrap whose retained-file claim is limited to FDs 4-17. Live FDs 0-3,
  guardian writer closure and cleanup, freshness, physical facts, binding, and
  every authority remain future requirements, null, or false. The focused
  successor tests pass 11/11 and the expanded related matrix passes 248/248 on
  current Node and Node 20; three fresh independent reviews are GO for this
  dormant boundary. Commit `ab668ddd` adds the separate ADR-0035 pure guardian-
  journal contract without runtime, task-profile, or CLI registration. It
  freezes the exact 18-state cancel-only graph, canonical projection and raw
  record hashes, generation/birth-epoch/head replay anchors, state-specific
  bindings, replay-only chain validation, conservative complete/prefix status,
  null physical facts, and all-false authority. Its focused suite passes 14/14,
  the expanded related non-G1.7 matrix passes 262/262 on current Node and Node
  20, the clean committed-code identity control passes 2/2 on both, and three
  independent reviews are GO for only this pure scope. Commit `040f3343` then
  adds the separate local Linux x86-64 execution-copy fixture for the attested
  ADR-0035 preflight. It observes the held executable identity, exact child
  FD0-19 inventory before preflight and FD0-17 at `PREFLIGHT_READY`, the exact
  three-frame cancel-only status transcript, Node close/post-reap behavior, and
  thirty returned fail-closed scenarios. The focused suite passes 47/47 and
  the complete top-level non-G1.7 suite, excluding its separate committed-clean
  identity control, passes 495/495 on current Node and Node 20; that identity
  control passes 2/2 on both after commit. Two fresh independent reviews are GO
  for this bounded, authority-null scope. These traces and attestations cannot
  mint the production report brand: pidfd/waitid reap, filesystem-backed
  guardian/reaper durability and recovery, delegated-cgroup evidence,
  semantic retained-file validation, FD-6 execution binding, and every
  physical/final authority remain absent, null, or false. Commit `fd9e4d05`
  adds ADR-0034's exact early unavailable gate; `c9cb6423`, `997ad287`, and
  `dfd6d92d` freeze its baseline/evaluator/reference chain; and `f9ab7c72`
  adds a separate dormant-v2 profile registry, exact contract, production
  worker-context binding, and reference reconstruction. Commit `99f94fac`
  freezes a separate three-command dormant literal registry and pure resolver
  outside active dispatch. Commit `f6897d34` implements application receipt v7,
  exact verification, shared worker-process proof evaluation, and private test-
  only replay while preserving v1-v6 compatibility. Commit `b915c5f6` wires the
  three exact records only below the hidden dormant CLI namespace and exact
  package scripts. Each selector returns the fixed unavailable result with exit
  4 before deferred option parsing or any downstream effect. The completion
  checkpoint passes 99/99 focused and 724/724 top-level non-G1.7 tests on both
  the current runtime and Node 20.20.2. The active v1 registry and public
  33-command CLI remain unchanged. The physical native adapter, full path-
  executed runtime closure, host qualification, a commit-capable successor,
  and G2.2 remain open; ADR-0034 stays Proposed and its v2 registration stays
  dormant and non-product.
  ADR-0034 owns those dormant receipt-v7/schema-v2 bytes and their early
  qualification gate; ADR-0039 consumes them unchanged and owns only current-
  host qualification, activation binding, and path-executed runtime closure.
  ADR-0037 owns the bounded statefs-syscalls object that ADR-0038 must link
  unchanged
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
  [ADR-0033 — Analytical/WCOJ execution](0033-analytical-wcoj-execution.md),
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0040 — Commit-capable containment decision and application-output release](0040-commit-capable-containment-decision-and-output-release.md)

## Context

The linked-data-store programme now spans transactional persistence, standards
conformance, compatibility differentials, mutation testing, security, and
performance. Parallel research and bounded harness evolution can reduce the
cost of that work, but a second semantic runner or an autonomous publication
path would weaken the evidence boundary already established by ADR-0004,
ADR-0005, ADR-0012, and ADR-0013.

The repository already owns stronger proof than a generic agent loop:

- exact native Cargo, W3C, Jena, and Souffle commands;
- a schema-v5 Agentic-QE receipt contract and immutable publication machinery;
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
accepted the exact 144/129 Agentic-QE CLI inventories plus the then-34-test
`persistence-write` profile, since expanded to 45 tests in source. These are
source-bound task closures, not an
umbrella current-HEAD qualification.

G0.6 now binds the current generic OxDatalog D0-D2 source/runtime scope to
immutable run `731e6467-2cab-4260-8d15-b34e4ebc8ed6`, with zero missed or
timed-out mutants. G0.7 reconciles and freezes the receipt-sensitive ledger,
README, ADR, plan, and research claims; root `README.md` is now an explicit
MetaHarness protected input. These closures do not make the aggregate semantic
qualification or G1.7 promotion current. A passing synthetic Darwin run proves
only the policy mechanics.

The repository now contains a separate application-delivery control plane,
quality-first model router, native Codex and Claude worker adapters, and a
baseline/evaluator-separated G1 task corpus. The existing `tools/metaharness`
package remains deliberately limited to semantic qualification and has not
absorbed those engineering responsibilities.

## Decision

Adopt a thin, local-first evolution control plane. It coordinates existing
authorities and may not replace them.

| Component                              | Permitted role                                                                                          | Not an authority for                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Ruflo swarm, tasks, goals, and AgentDB | Parallel research, dependency state, transient project memory, and anti-drift coordination              | RDF semantics, promotion, or release claims                                   |
| RuvNet Brain                           | Source-grounded guidance for the rUv stack                                                              | Oxigraph behavior not established by local source/tests                       |
| MetaHarness genome, score, and OIA     | Advisory readiness, risk, and infrastructure analysis                                                   | Product correctness or current semantic qualification                         |
| Existing `tools/metaharness` qualifier | ADR-0004 policy evolution against protected semantic evidence                                           | Engineering implementation, repair, or product promotion                      |
| `tools/engineering-harness` runtime    | Route, build, repair, review, and receipt isolated G1-G3 candidates                                     | Semantic truth, publication, or promotion                                     |
| Darwin                                 | Bounded evolution of frozen harness-policy surfaces                                                     | Rust source, manifests, expected results, thresholds, or semantic answers     |
| Agentic-QE                             | Exact profile coordination and schema-v5 evidence-publication machinery                                 | A simulated or JavaScript substitute for native Rust execution                |
| Dream Machine                          | Local version/config compilation, rotation vocabulary, three-verdict discipline, and a secondary ledger | Scheduling, provider routing, publication, promotion, or replacement receipts |
| Native and differential runners        | Pass/fail evidence for their exact named scopes                                                         | Claims broader than their reviewed inventories                                |

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

Those five packages are the engineering runtime dependency identity. An
evaluator ADR may additionally authorize a parser, test runner, or other
authority-null development dependency only under `devDependencies`. Such a
dependency requests `latest`, is pinned to exact integrity-verified bytes by
the committed lockfile, is excluded from runtime dependency and provider
identity, and grants no execution, qualification, promotion, or publication
authority. The owning evaluator ADR must explicitly authorize changes to the
shared manifest and lockfile, prohibit a weaker fallback, and treat lock drift
as evaluator-evidence drift. Installation continues to disable lifecycle
scripts.

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
`3edfb86a` plus evaluator-only commit `eaf7161c`. Continue through G1.3-G1.4,
the explicit G1.4a Store terminal-outcome slice, the G1.4b phase-fault slice,
and G1.5-G1.7 in dependency order. Do not infer engineering-runtime readiness
merely from those evaluator commits.

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
  digests, with adversarial receipt and replay tests;
- current application-receipt-v6 candidate-rejection records bind the exact candidate execution,
  successful patch-producing invocation and patch digest to a typed
  reconstruction/applicability failure and bounded canonical-detail digest.
  They are non-trainable, the detail digest is tamper-evident rather than a
  signature or recovery channel, pre-v6 receipts remain replay-only, and a
  candidate-disposal failure aborts receipt minting; and
- one real G1 task completes end to end with both native vendors represented,
  while the existing Agentic-QE, Jena, mutation, and MetaHarness semantic
  receipts remain authoritative and unmodified.

Package installation, factory scaffolding, mocked workers, a readiness score,
or a synthetic Darwin run does not satisfy this definition.

### G1.7 qualification-control boundary

The outer G1.7 qualification receipt remains
`oxigraph.g1.7-qualification-receipt/v1`. Exact qualification contract v7 is
`42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80`.
Its proposed control-authorization artifact has raw/content SHA-256 values
`31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767`
and `d61434741577787729dde9c23725523b855fca208e5b891de2a73e8abe0c0bb2`;
the proposed final decision set has raw/content SHA-256 values
`b0def4f0a3efa845aed557305045a79c6c9c22a455f09719dfca0bf903d595e5`
and `bb4d92160e4d71089ec9d29dc0861ffccf0dbcaa46e87c53d4a49f996fe9ac72`.
The archived v6 contract raw SHA-256 remains `22cec755...`; its proposed
authorization and final-decision raw SHA-256 values remain `285c86fd...` and
`e2884b73...`. The archived v5 contract raw SHA-256 remains `155c364b...`;
its proposed authorization and final-decision raw SHA-256 values remain
`b9ee0f76...` and `2fd16b9e...`. They are byte-exact historical identities,
not aliases for v7.
The current artifacts are `CONTROL_AUTH_PROPOSED` and
`PROPOSED`/`UNAPPROVED`.
`g1.7:run` exits 4 as `DIAGNOSTIC_ONLY`/`INCONCLUSIVE` before identity,
application evidence, build, runtime-directory creation, or sampling and
creates no G1.7 run. Pure commits `d3af2e17` and `45121da9` replay four isolated
builds, two serialized sessions, and 392 exact launch records into recomputed
Darwin statistics and a bounded canonical control-receipt candidate. PASS,
FAIL, and INCONCLUSIVE paths are covered, exact authorization bytes are hashed
inside the replay boundary, and the result is deliberately
`CANDIDATE_REPLAYED` with `binding: null`, `finalDecisionEligible: false`, and
all authority flags false. Final binding continues to report
`qualificationExecutionAuthorized: false` until a real physical control archive,
the approved final decision, and the execution owners exist. Commit `fbbb692b`
implements exact three-file physical sealing and replay; seal emits no binding,
while replayed PASS can expose only a prospective binding with all authority
false. After G2.1, the current 667-test suite passes 663, fails only the
deliberate sealed-subject freshness gate that detects the new product paths,
and skips three intentional host-gated cases. Those fixtures verify contracts
and current archive mechanics, not live owner emission, current-HEAD
qualification, durability, controls, or performance.

Contract v1/v3/v4/v5/v6 replay is Darwin-free, `LEGACY_REPLAY_ONLY`, and can
never qualify. V5 and v6 exact contracts, proposed authorizations, and proposed
final-decision bytes are archived with raw/content hashes and byte lengths;
they are not silently relabelled current. The accepted G1.4b receipt is copied,
hash-bound, and pure-replayed at the current prerequisite boundary. Its
compatibility projection and binding
SHA-256 values are
`d57eb7cb753d905e8951131c0bbcac188afb00e6ba893f572a994eeb5d20de87`
and `5a4f57211ab6bce138a4a5facc78092559e8f371f836687d1fc539e9129d08e5`.
Its claim remains limited to simulated storage-call pre/post-write faults, not
crash, power-loss, or fsync durability, and it cannot replace the control
receipt.

Contract v7 preserves v6's replacement for the circular v4 approval flow as
two strictly ordered human phases. It retains the frozen canonical
authorization-bound sample-set framing and order, paired 10% log
non-inferiority for the negative control, two shared-seed one-sided 5% A/A
equivalence directions, the inclusive 5% MAD noise boundary, and mechanical
control/aggregate verdict precedence. Its pure attributed replay is
differential-tested against the exact installed Darwin 0.9.3 modules; it does
not create a live measurement or receipt. Phase A may authorize only permanently
non-promoting negative and independently built A/A noise controls and requires
their complete raw owner receipt to be sealed and replayed. Phase B must bind
that receipt, its observed signature, and the exact G1.4b prerequisite into one
atomic final decision set before any subject/reference sample is produced. No
human approval or control execution has occurred. A later `ACCEPT` means only
`QUALIFIED_AWAITING_HUMAN_PROMOTION`; no schema or command grants product
promotion or publication authority.

## Programme decisions and task ownership

The programme keeps three different records deliberately separate:

| Record                 | Authority                                                   | Lifecycle                                   |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| ADR                    | Architectural intent and accepted constraints               | Proposed, Accepted, Implemented, Superseded |
| Committed GOAP plan ID | Stable work identity, dependency, and exit gate             | Updated with the repository                 |
| Ruflo task row         | Local execution status, priority, assignment, and analytics | Transient project runtime state             |

G0 evidence repair remains governed by ADR-0004, ADR-0005, ADR-0012,
ADR-0013, and this ADR. G1 is owned by ADR-0018 and ADR-0019; G2 by ADR-0020,
ADR-0021, and ADR-0022; G3 by ADR-0023, ADR-0024, and ADR-0025; and G4 by
ADR-0026 through ADR-0033. ADR-0019 is now Implemented; ADR-0018 and
ADR-0020 through ADR-0040 are twenty-two Proposed living plans. G1.4a and G1.4b
are completed product slices under Proposed ADR-0018, and G2.1 is implemented
in `be08cf3b` under Proposed ADR-0020; the remaining ADR status gates are not
closed by those bounded slices.

ADR-0034 is the separate cross-cutting gate before G2.2 may add a candidate-
created module. Its Ruflo task `task-1787935934614-ibmjn1` is in progress at
99% after the historical launch/bootstrap and guardian/preflight checkpoints,
the exact early-gate commit `fd9e4d05`, fixture chain
`c9cb6423`/`997ad287`/`dfd6d92d`, and separate dormant-v2 registration commit
`f9ab7c72`. Commit `99f94fac` freezes the three dormant command literals;
`f6897d34` implements receipt v7 and private replay; and `b915c5f6` exposes only
the hidden unavailable-gated CLI/package surface. ADR-0035's bounded local-
preflight Ruflo task `task-1788002473147-nsat6x` is complete; its broader
Proposed physical design is not. The filesystem-backed stable
guardian/reaper, recovery mutation,
race-free exec plus pidfd/waitid evidence, interactive physical cgroup adapter
and full runtime-closure proof, current host qualification, a separately
ratified commit-capable successor, and G2.2 remain open. ADR-0034 and ADR-0035
add no product G-identifier.

The remaining containment gates have one-way ownership. ADR-0037 owns the sole
statefs policy/oracle and a tiny separately attested Linux x86-64
statefs-syscalls object; ADR-0038 links that object unchanged and owns only the
manager/guardian/trampoline process/cgroup/exec mechanics. ADR-0034 owns dormant
application receipt v7, schema-v2 reconstruction/dispatch/profile literals,
and the early exact `executionGate: "native-containment-qualification-v1"` for
`contractSchemaVersion: 2`. ADR-0039 consumes those bytes unchanged and owns
only current-host qualification, receipt binding/activation, and path-executed
runtime closure. Until then readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, and the early
gate stops before reconstruction workspace preparation or any candidate or
evaluator Git, submodule, process, provider, `ACCEPT`, `REJECT`,
receipt-emission, or Router-quality work. The later pre-execution check remains
defense in depth.
Even after qualification, the cancel-only protocol leaves G2.2 blocked until a
separately ratified commit-capable successor closes.

The linked execution plan contains 42 stable executable G-identifiers. The
initial 26 G0.1-G3.5 identifiers were materialized as Ruflo rows on
2026-08-24; the 2026-08-25 expansion added G1.5b-G1.5c, explicit G2.3a-G2.3c
and G2.4a-G2.4b leaves, and G4.1-G4.8. On 2026-08-27 G3.0 was added as the
shared rebuildable derived-index lifecycle owned jointly by ADR-0022 and
ADR-0024; G3.3 and G3.4 now own only their text and spatial providers.
The 2026-08-27 recovery audit then added G1.4a to make ADR-0018's previously
prose-only built-in Store terminal-outcome and durable-lookup blocker an
executable prerequisite of G1.7. Product commit `2f518e04` and direct frozen
candidate acceptance now close that prerequisite; the authenticated paired
application attempt remains `INCONCLUSIVE` and is retained as such.
On 2026-08-28 G1.4b made the evaluator-separated simulated storage-call fault
gate explicit. Product commit `590a3229` and application receipt
`d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad`
close that slice after exact replay and 8/8, 7/7, and 20/20 direct controls;
they do not claim crash, power-loss, or fsync durability.
`HARNESS-REGISTRY` and
`AGENTIC-SCHEMA-V5-REFRESH` are named harness/evidence
controls, not product G-identifiers. `HARNESS-REGISTRY` sits between G1.6 and
the G2.1 evaluator freeze.
It is implemented by commit
`4a15caa07df37d884e7c74d4b69c0505ce3de6e1`: an exact ordered seven-task
registry derives canonical contract paths and an exact ordered 27-command CLI
surface. Contract, preflight, programme, and replay entrypoints accept a
registered `taskId`; caller-selected contract paths and malformed, inherited,
accessor-backed, duplicate, or unregistered identities fail before I/O. The
G1.4a registration in `13352ff9` and evaluator separation in `c2497225`
preserve those controls while expanding the registry to eight tasks and 30
commands. G1.4b registration/binding in `1362f250`, `3bb4f0fb`, and
`695def8d` expands the current registry to nine tasks and 33 commands; the
seven/27 figures above remain the exact historical `4a15caa0` checkpoint. The
next distinct control, `HARNESS-REJECTION-EVIDENCE`, is implemented by commit
`afe30c7de7e3df6e72a0a855d83efc612339f261`. Receipt v6 binds bounded
candidate-specific reconstruction/applicability rejection evidence before the
G2.1 evaluator is frozen, while v1-v5 remain replay-only.

The current managed task surface persists repository-local execution state but
does not expose a dependency or description-edit argument. Superseded pending
rows are therefore cancelled and replaced while retained as history. The
committed G-identifiers and GOAP tables remain the portable authority; Ruflo
task IDs are repository-local audit pointers only and never prove product
behavior. The current 42-entry adjacency map and checkpoint were stored and
exactly read back through the managed Ruflo interface at
`task-plans/linked-data-store-g0-g4-2026-08-28-v15`; it supersedes, rather than
rewrites, the historical v14 map. The 42 stable product identifiers are
unchanged. V15 retains separate support rows for control authorization,
control owner/replay, final-decision binding, benchmark owner/replay, G1.4b
receipt binding, Darwin-free legacy dispatch, the v6 statistics contract,
completed upstream `ec68e3dd` reconciliation, post-merge G1.7 resealing, and
this governance synchronization.
Those rows grant no aggregate or promotion authority. G1.4a task
`task-1787855156849-ya7t6b` and G1.4b task
`task-1787869201628-bwe6b0` are complete. Corrected G1.7 task
`task-1787871483413-ki34q2` includes both dependencies and is in progress at
74%; its two superseded rows remain cancelled history. Workspace/build-owner
task `task-1787902127894-7n7vk3` is in progress at 93%, and containment task
`task-1787902138074-0w648x` is in progress at 92%. Support tasks for the
G1.4b binding, Darwin-free legacy dispatch, and v5 control-authorization
protocol are complete. V6 statistics-contract task
`task-1787882542649-y8dttl` is complete at the bounded pure-replay boundary;
governance task `task-1787885074292-neafw8` records the pre-merge v6
synchronization. Upstream task `task-1787883108007-gik9bz` is complete at
audited merge `e9d2db1b`; reseal task `task-1787888366495-gzxbhe` is complete
at the pure, non-executing v7 boundary in `d1e18c6e`. Pure receipt-candidate
task `task-1787892615000-rdwz7q` is complete in `45121da9`; physical-envelope
task `task-1787896401667-xookiy` is complete in `fbbb692b` and is the only layer
allowed to derive a prospective final-decision binding from replayed PASS bytes.
The live control owner, final human decision, qualification owner, and live
benchmark remain open.
Evidence checkpoints
are stored under `programme-evidence/g14a-store-terminal-outcomes-2f518e04`,
`programme-evidence/g14b-harness-qualified-2026-08-28`, and
`programme-evidence/g17-v4-fail-closed-core-f1cb6680-2026-08-28`, with the
historical v5 protocol proof at
`programme-evidence/g17-v5-control-protocol-main-0257587e-2026-08-28` and the
v6 proof at
`programme-evidence/g17-v6-statistics-protocol-main-799307fb-2026-08-28`, the
merge proof at
`programme-evidence/upstream-ec68e3dd-merged-e9d2db1b-2026-08-28`, and the
physical-envelope proof at
`programme-evidence/g17-physical-control-envelope-main-fbbb692b-2026-08-28`,
and the
current v7 source/documentation checkpoint at
`programme-evidence/g17-v7-subject-reseal-main-4451b8eb-2026-08-28`.

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
7. **Evidence repair:** G0.1-G0.5 revalidated the registered source, Jena, and
   Agentic-QE bindings. G0.6 regenerated the exact OxDatalog receipt with the
   latest observed registry `cargo-mutants` release acquired without a
   top-level version pin and sealed by executable provenance. G0.7 reconciles
   and freezes root README, ADR, plan, ledger, and research documents before
   full MetaHarness qualification and independent evidence verification.
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
- Existing fail-closed drift is visible. The original July Jena and mutation
  receipts remain historical, while G0.3 and G0.6 now carry refreshed scoped
  identities reconciled by G0.7.
- G0.1-G0.7 have completion evidence for their exact scopes; this does not
  close full semantic qualification or G1.7 promotion.
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

Source-bound engineering evidence on 2026-08-25 through 2026-08-27 established:

- committed control subject
  `d03f70d3d4efa9643b5df06f1be99ab5f0fd9ab8` preserves an outer
  receipt-v1/projection-v2 boundary, separates structural validation from
  sealed owner-contract replay, and leaves synthetic, legacy, Agentic-only,
  and incomplete native compatibility evidence ineligible. From that clean
  committed subject, `node --test --test-concurrency=1
tools/agentic-qe/*.test.mjs tools/metaharness/*.test.mjs
tools/mutation/*.test.mjs tools/engineering-harness/test/*.test.mjs` passed
  298/298 under Node 24.14.1 on Linux 6.8.0-137-generic x86_64. This is
  candidate-slice control evidence, not semantic qualification, benchmark
  evidence, or a promotion decision;

- 180/180 engineering-harness tests on the committed registry tree and a
  `runner-implemented` dependency/provider doctor. The doctor exposes the exact
  27-command surface, confirms all five dependencies use the `latest` request
  policy with integrity-bound installed artifacts, validates both native host
  interfaces, and retains `mcpRegistered: false`, `localOnly: true`, and
  `promotionAuthority: false`;
- 194/194 engineering-harness tests on committed rejection-evidence tree
  `afe30c7de7e3df6e72a0a855d83efc612339f261` and the same
  `runner-implemented` doctor boundary. The tests preserve frozen pre-v6
  SHA-256/byte-length fixtures for receipts v1-v5; reject malformed, duplicate,
  unaccounted, or reordered v6 evidence; retain two failed provider lanes
  independently; exclude rejections from Router quality; and abort receipt
  minting when candidate disposal fails;
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
  5/15/21 evaluator split; and
- direct frozen candidate acceptance for G1.6's runtime-derived service claims
  with the seven-stage 4/17/1/1/12 evaluator split. The accepted
  126,368-byte verifier-session artifact has SHA-256
  `4ff0fdafa3b8584f81033a89000814320a952bbc384523cd72dd57150963458b`;
  previous-product, union-only, and CLI-TLS-gated-server controls all returned
  `REJECT`. These are verifier-session and control artifacts, not application
  receipts; and
- G1.7 v4 fail-closed core commits `4e3eef61`, `a1d426bb`, `87a5efc5`,
  `a6e229df`, and `f1cb6680`, followed by Darwin-free legacy replay
  `f357a1b4`, exact G1.4b prerequisite binding `509a6611`/`7b1eab5d`, and
  audited v5 protocol commits `8ca3804b`/`0257587e`, followed by v6 statistics
  and versioning commits `20477225`/`799307fb`, merged-product identity reseal
  commit `d1e18c6e`, and pure benchmark-owner/control-receipt-candidate replay
  commits `d3af2e17`/`45121da9`, followed by physical envelope commit
  `fbbb692b`, dormant containment commit `f04b9bc7`, source-workspace commit
  `a457f46c`, pure build-product replay commit `c5687dac`, replay-only build
  owner v2 commit `3688ccda`, non-tmpfs policy/mapping commits
  `008ab939`/`da41d7e0`, containment-retention and bounded-cleanup commits
  `5d054857`/`a9f9afc2`/`f482bec0`/`3b289522`, raw-process supervisor commit
  `c5050e9c`, execution-request-v1 commits `13afa94d`/`3f8951e3`, replay-only
  process-evidence-v3 commit `8b2c6366`, structural policy-v2 commits
  `ef869cf4`/`466d2d78`, request-v2 commit `75a07693`, and dormant helper
  attestation commit `c113a88f`. Exact current v7
  contract, proposed
  control-authorization, and proposed final-decision raw SHA-256 values are
  `42ed3867...`, `31b8fce5...`, and `b0def4f0...`; the v6 bytes remain exact
  replay-only fixtures. After G2.1, the package suite reports 667 total, 663
  passing, one deliberate sealed-subject freshness failure, and three
  intentional host-gated skips. The CLI exits 4 before work
  at `CONTROL_AUTH_PROPOSED` and writes no
  G1.7 run. The pure candidate replay is not a physically owned or sealed
  control receipt and grants no binding or execution authority. The physical
  fixture proves exact archive mechanics and can expose only a prospective
  binding from replayed PASS; it is not a live control receipt and grants no
  authority. This evidence contains no human approval, live benchmark,
  performance result, qualification, or promotion.
- audited upstream merge `e9d2db1b` with exact-tree Rust, Python, workflow, and
  409/0/2 harness evidence. It retains ADR-0014's selected-missing `POST=404`
  divergence. Commit `d1e18c6e` reseals that exact product/tree/lock identity
  as current v7 without running Phase A or supplying live qualification
  evidence.

## Decision boundary

This ADR implements the engineering architecture and authority boundary; it
does not claim that Dream Machine is an approved unattended runner, full
MetaHarness qualification is current, or an application-harness acceptance is
safe to promote. The canonical registry and candidate-rejection evidence
controls are closed. The programme owner's explicit 2026-08-28 instruction to
continue the ADR programme with the harness records the narrow exception under
which G2.1 evaluator and product work proceeded to commit `be08cf3b` despite the
stale, unapproved G1.7 baseline. This exception authorizes only local,
non-promoting G2 implementation and evaluator work. It does not accept or
approve ADR-0018, authorize live G1.7 controls or results, make qualification
current, or grant qualification, publication, push, or promotion authority.
Later G2 slices may use the same local non-promoting boundary while that
programme instruction remains in force; each still requires its own frozen
evaluator and direct evidence. ADR-0018 and ADR-0020 through ADR-0033 remain
Proposed until their product behavior and evidence exist. Each task still requires a
red/evaluator-separated corpus, direct control-plane tests, continuously
current prerequisites,
per-run authorization, activation status, and exact receipts above.
