# ADR-0048: Repair ordinary engineering routing and evidence learning

- **Status**: Proposed
- **Date**: 2026-09-24
- **Updated / source audit**: 2026-09-25
- **Deciders**: Oxigraph owner; acceptance pending
- **Tags**: metaharness, native-subscriptions, routing, frozen-evaluators, learning
- **Amends if accepted**: ADR-0017 and ADR-0043 ordinary delivery only

## Outcome and authority

Refactor the existing ordinary engineering path into a thin CLI, one
Oxigraph-owned outer controller, and adapters to public upstream packages.
Preserve native Claude execution, root-only application, deterministic checks,
repair, independent review and exact evidence readback. Do not construct another
scheduler or import another repository's private application runtime.

This is a later implementation handoff, not implementation evidence or a resume
order. Current authorization covers this ADR only. Source changes, native
execution, live task/control writes and learning-state writes need the owner's
explicit scoped authorization. G1.7, semantic qualification, evolution,
promotion, publication, deployment and push remain separately unauthorized.
OpenRouter and DeepSeek remain disabled; no API adapter is part of this repair.

[ADR-0043](0043-delivery-recovery-and-proportional-release-boundary.md) makes
direct product behavior and proportional native tests the delivery authority.
[ADR-0017](0017-repository-evolution-and-evidence-promotion-harness.md) retains
the frozen engineering lane; [ADR-0004](0004-metaharness-darwin-qualification.md)
retains semantic qualification. Their historical mixed-provider and parallel
instructions do not override the September 23 owner amendments in `AGENTS.md`.

## Audited baseline

Physical checkout: `/home/claude/src/hm/oxigraph`, canonical `main`, clean before
this document edit, HEAD `c88b7378a2f462fa8327705c65313158b67e8135`.
Node: `v24.14.1`, executable
`/home/claude/.local/opt/node-v24.14.1-linux-x64/bin/node`.
Revalidate path, branch, HEAD, dirty paths, active owners and source dependencies
before implementation. Historical worktrees are not implementation workspaces.

Paths in the following tables are relative to `tools/engineering-harness/`.

| Executable surface | Source-audited behavior | Disposition |
| --- | --- | --- |
| `bin/oxigraph-delivery.mjs` | `workflow`, `run`, `route`; preflight before workflow-directory creation | Keep this entry; no replacement CLI |
| `src/workflow.mjs:runWorkflow` | Owns task/control refresh, proposal, root apply, checks, repair, independent review and handoff | Keep as sole ordinary transition owner |
| `src/workflow.mjs:nativeStage` | Real `HarnessKernel`, one-step `AlgorithmRouter`, new `AgentPool` per stage, structural verifier | Extract public-package composition; retain one pool per workflow |
| `src/delivery.mjs:routeDelivery` | Explicit Claude role defaults and reasoned overrides; no model-quality Router call | Add one ordinary policy adapter; do not describe current defaults as learned |
| `src/delivery.mjs:runDelivery` | Agentic-QE command supervision, exact argv/source/artifact observations | Preserve command admission and existing failure checks |
| `src/workflow-host.mjs` | `stdioHost` and callback-injected `relayWorkflowHost`; leaves native-worker/root-apply to host | Keep bridge; not a native client launcher or MCP server |
| `src/routing/quality-router.mjs` | `QualityFirstRouter` wraps public `Router`; cold start demands paired Codex/Claude evidence | Frozen-lane mechanism, not usable unchanged for Claude-only ordinary work |
| `src/runtime/native-pool.mjs` | `NativeWorkerPool` requires both Codex and Claude declarations | Preserve frozen contracts; do not activate this pool in ordinary delivery |
| `src/receipts/application.mjs` | Versioned frozen application receipts | Not the ordinary workflow receipt writer; leave untouched |
| `src/workflow.mjs` evidence | `ordinary-workflow-v2`, content-bound local events/checks, exact MCP readback | Extend additively; not durable crash-resume or independent host authentication |

Already implemented, not repair backlog: failed-check feedback stops later
checks/review; review rejection triggers fresh repair/check/review; unchanged
failure stops for integrator judgment; reviewer identities exclude every author;
source drift, protected paths, stale responses, bad readback and no-op delivery
fail closed. Existing `test/workflow.test.mjs` and `test/delivery.test.mjs`
exercise these contracts; this audit did not rerun them.

Effort isolation is also already implemented: `src/routing/history.mjs`
normalizes optional effort maps and `quality-router.mjs:currentFingerprint`
separates them. Its public fingerprint deliberately remains legacy-compatible
with `application.mjs`. Do not reopen that completed defect or rewrite old
receipts to make them ordinary evidence.

Actual remaining policy mismatch: `runWorkflow` still sends an implementation
prompt inviting native children/contributors; contributor fixtures retain the
September 19 no-cap framing. Current owner policy requires serial execution.
Correct prospective prompts/admission without relabelling historical records.

### Public package identities and acquisition

The local manifest requests `latest`; installed versions match its exact npm
lock entries. This is installed-artifact evidence, not a registry-currency claim.

| Package | Installed / locked | Public seam used or inspected |
| --- | --- | --- |
| `metaharness` | 0.4.8 | Factory/diagnostics; not the ordinary runtime |
| `@metaharness/harness` | 0.2.0 | Root exports `HarnessKernel`, `AlgorithmRouter`, `AgentPool`, `VerifierRegistry`, `predicateVerifier`, `ReceiptLog`, `CircuitBreaker`, `hash` |
| `@metaharness/router` | 0.4.0 | Root exports `Router`, `calibrationReport`; `Router.predict` and `Router.route` |
| `@metaharness/darwin` | 0.9.3 | Root qualification functions; separate `@metaharness/darwin/gepa` exports `gepaOptimize` |
| `@metaharness/avo` | 0.1.4 | Direct dependency; no ordinary controller import |
| `@metaharness/flywheel` | 0.1.10 | Transitive only; exports `runFlywheelGenerations`; no ordinary integration |

Engineering `package-lock.json` SHA-256:
`5076addd19b823b7669d20321dac066ddb269587b688675ac4c02d5c2b38612d`.
Separate qualification lock SHA-256:
`d74764b0f30b5033495be94dd9fbef738c55d641ef6c06c70d9bc41977bcf288`.
Both packages declare Node >=20. Package export maps resolve the imports above
to local `node_modules/@metaharness/*/dist/`; no workspace alias, sibling path,
private registry or Builder installation is required.

No dependency upgrade is required for slices below. If installation is missing,
the authorized owner restores the existing lock with
`npm ci --prefix tools/engineering-harness --ignore-scripts`, retaining `.npmrc`.
Inspect lifecycle policy and lock integrity first. A newer package is a separate
reviewed dependency slice, never an incidental refresh of `tools/metaharness`.

Builder commit `df74b4911cf05fa7ecdcdfe13c5e0d8533e97b12`, run
`run-2026-09-24T18-24-37-723Z-4f9af644`, receipt
`sha256:2f2c08d4008bd7100f152056b0172157ad034783a9a7fa3561e6110b87a6c8a2`
is comparative historical evidence only. Its lean entry delegates to Builder's
private `@semantic-builder/application-development-harness`; that package is not
a public cross-repository runtime. Do not import, copy, vendor or depend on it.
Its green receipt proves neither Oxigraph execution nor portability.

## Target ownership and exact seams

### 1. One local controller, public primitives

Keep `runWorkflow(spec, host, io)` in `src/workflow.mjs` as the outer controller.
The existing CLI still calls it; `runDelivery` still conducts deterministic
commands. Proposed new `src/ordinary-runtime.mjs` is only public-package
composition for native stages, not another lifecycle or dispatcher.

Create its run-scoped runtime once at `runWorkflow` entry. It owns one
`AgentPool`, registers `AgentSpec` callbacks, and constructs kernel stages with
`new HarnessKernel({ router, pool, verifiers, budget, ... })`. Workers use public
`AgentSpec.run({ goal, step, upstream })`; pass the current route/source/feedback
through `goal.context`, not a stale first-attempt closure. Invoke
`kernel.run(goal, stageId)` with a workflow-bound unique stage ID.

`AlgorithmRouter` classifies intent and compiles stage DAGs. It does **not**
choose model/effort. The public `AgentPool` selects agents by handled step kind
using UCB; expose only the policy-selected route for that stage's exact kind so
its bandit cannot bypass model admission. Keep self-reported quality neutral;
pool statistics are diagnostics, not application-quality training evidence.

`VerifierRegistry`/`predicateVerifier` validate the native result structure.
They do not replace `runDelivery`'s application checks or independent review.
Keep prerequisite/repair transitions outside the kernel: its installed loop
continues through ordered steps and supplies neither Oxigraph root application
nor exact task control. Do not force the whole workflow into an assumed turnkey
kernel lifecycle.

Installed `HarnessKernel.run` has no `AbortSignal` parameter and creates its
own receipt log, breaker and retry state per call. Reusing a pool does not make
those run-scoped. Preserve zero internal duplicate retries; the existing outer
repair loop owns progress-driven repair. A run-scoped public `CircuitBreaker`
may guard classified transient host faults in the adapter; account/model
unavailability always pauses with exact client, model, effort and error.
No request-count or subscription-spend ceiling becomes a repair policy.
Keep native `costUsd` compatibility values and cost-scoring weight at zero;
reported usage stays telemetry, never a selection, retry or stopping input.

### 2. Model selection belongs to one ordinary adapter

Proposed `src/ordinary-routing.mjs` owns ordinary candidate admission and wraps
public `Router`; `routeDelivery` remains the public policy entry and delegates
there. Do not alter or import the frozen `QualityFirstRouter`/`NativeWorkerPool`
as the ordinary path. This is local policy around upstream algorithms, not a
new k-NN implementation or a second active ordinary model selector.

Candidate identity binds native host, exact model, effort, role, policy digest,
task class, evaluator digest and harness revision. Reject absent/malformed
dimensions and mismatched evidence before selection. Reuse pure
`src/routing/features.mjs:canonicalSha256` where appropriate, but do not call its
hash-derived `routingEmbedding` a semantic embedding or a validated predictor.
Start with frozen categorical task features, fixed dimensions and injected
examples; no embedding service or model experiment is required.

Call `new Router({ candidates, k })` with equal neutral `costPerMTok` values and
no `qualityBar` for quality prediction. Check actual all-required-verifier
outcomes independently. Upstream's `metBar: true` without a bar is not product
acceptance. Cold start retains the configured role route, labelled uncalibrated;
empty history never forces paired Codex execution or blocks delivery. Do not
fabricate positive examples to make the Router choose an incumbent.

Preserve role/capability/owner selection first. Only comparable, quality-cleared
evidence may justify another eligible route. The package has no accepted-outcome
latency selector: the local adapter may compare tied qualified candidates using
observed assignment-to-accepted-integration time, including repair, review and
verification. Otherwise retain the incumbent. Report worker and whole-outcome
time separately; no speed claim follows from model latency alone.

Classify failures before escalation: preparation/process/artifact faults belong
to the integrator; evaluator defects belong to the verifier owner; exit 1 needs
diagnosis. Confirmed authoring defects may exclude that route and select an
admitted route with a non-decreasing task capability floor. Native outage is not
a negative quality label or permission for transport fallback.

### 3. Native host and integration policy stay local

| Role | Exact native model | Effort |
| --- | --- | --- |
| Coordinator / decisions | `cc/claude-opus-5` | `max` |
| Implementation / difficult repair | `cc/claude-opus-5` | `xhigh` |
| Documentation | `cc/claude-opus-5` | `low` |
| Independent review | `cc/claude-opus-5` | `high` |
| Commands, hashes, replay | None | Deterministic |

Preserve existing reasoned `cc/claude-sonnet-5`/Opus overrides and explicit-Max
selection rules. Fable, Codex, unqualified aliases and Ultra remain inadmissible
for new ordinary work. OpenRouter, DeepSeek and all API fallback remain refused.
Future API work needs a separate explicit policy exception and implementation
request; it is neither an acceptance gate nor an implied dormant implementation.

One model-bearing process and one build/test command at a time. Fresh-context
review starts after author completion. Root alone writes canonical `main`;
native workers propose exact UTF-8 file contents and never edit, build or test.
No branches, extra worktrees, background contributors or implicit fan-out.

Preserve `stdioHost` and `relayWorkflowHost` actions `mcp-read`, `native-worker`,
`root-apply`, `mcp-handoff`. The configured native host supplies actual worker
execution; ordinary code does not currently call `native/claude.mjs` directly.
The frozen `claudeInvocation` has different schemas and no ordinary effort
argument: it is not a drop-in replacement for the host callback.

The host preserves `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL` and gateway
`ANTHROPIC_AUTH_TOKEN` through the existing `nativeChildEnvironment("claude")`
allowlist. Generic commands/verifiers keep `scrubbedChildEnvironment`; no API
key, prompt secret or alternate transport is introduced. Readiness uses the
authorized native route, not login metadata. No readiness call occurs in this
ADR-only task.

Cancellation belongs to the outer host/process boundary. Proposed `io.signal`
stops new transitions; injected host `cancelNative({ runId, requestId })` targets
only the pending native request and confirms matching identity, settlement and
termination. This is a new adapter contract, not an upstream API. Closing stdin
alone proves no child termination. Retain outstanding evidence and withhold
handoff until confirmation; label that proof host-supplied, not authenticated.
Reuse Agentic-QE command supervision; claim no new containment or crash recovery.

### 4. Evidence, feedback and learning have separate owners

Root/verifier owner freezes one exact ordinary task specification and evaluator
revision before authoring. Bind baseline commit/tree, evaluator content digest,
allowed paths, commands, required outputs, review policy and intended failure.
Add these bindings as workflow spec schema 2; keep schema 1 byte interpretation
unchanged and ineligible for new learned routing without the required evidence.
Build prerequisites first; missing imports/tools are not discriminating red.
Root commits evaluator-only changes, proves the intended baseline failure, then
references that prior revision from the task. Never self-reference a commit.
Reuse one live terminal-outcome task; correct stale scope once, not per defect.

Keep failed attempts immutable and add justified regression lineage under that
same outcome. Deterministic checks precede independent review; changed bytes
invalidate earlier checks/review. Root verifies exact application, commits the
accepted slice, then closes the live task. `ready-for-owner-review` is not an
integrated product outcome.

Proposed `src/ordinary-evidence.mjs` extends existing local evidence binding, not
the frozen application receipt schema. Preserve historical ordinary v1/v2
bytes and emit an explicitly versioned successor only when new fields land.
Bind task/spec/evaluator/route/source identities, requested and observed native
model/effort, stage/attempt IDs, checks, review, failure class and elapsed phases.
CLI writes under existing ignored `target/engineering-delivery/`; no protected
`.runtime`, database, qualification or `/var/lib` state is repurposed.

Validate stage chains with public `ReceiptLog.fromJSON(...).verify()`, plus
locally expected sequence/count, task bindings and final digest. A self-consistent
truncated chain can pass upstream verification; chain validity alone does not
prove completeness. Keep original stage chains; `ReceiptLog.merge` rehashes
entries and must not rewrite historical stage provenance. Bind actual request
payload digests locally: the kernel's input hash covers step/action, not the
complete task/source payload. Thrown worker errors need outer failure evidence.

One sole-writer reduction in `ordinary-evidence.mjs` may derive an idempotent
ordinary outcome view from immutable run files. Reject duplicate/conflicting
attempt IDs and incomplete/tampered records. No separate daemon or mutable
global Router history is needed. Mark observations trainable only after direct
verification, review and exact integration binding; ordinary observations alone
are not paired comparisons. Training requires explicitly eligible paired
same-task results; single outcomes remain diagnostic. No model self-score, stale
reviewer, infrastructure fault or legacy dual-host receipt becomes a quality label.

After commit, root uses proposed CLI `finalize --result FILE --commit SHA` backed
by `ordinary-evidence.mjs:finalizeOrdinaryOutcome`. It compares committed content
with the exact verified candidate and writes a separate integration record;
it never rewrites the workflow or stage records. Coordinator stores/readbacks
that record through the verified project MCP before closing the task. Failed or
interrupted finalization leaves the outcome awaiting integration, not accepted.

Search/store project facts only through an Oxigraph-bound structured Ruflo MCP
connection; verify stores by exact retrieval. User memory is reusable context,
not the repository ledger. Optional recall failure must not block delivery,
but missing mandatory live task authorization or handoff readback must fail
closed; never synthesize either from memory or local files.

### 5. Evolution is deferred, not supplied by an imaginary shared runtime

Ordinary source imports no GEPA, AVO or Flywheel controller. The separate
`tools/metaharness/qualify.mjs` imports Darwin root functions `evolve`,
`generateBaselineHarness`, `inspectVariant`, `runVariantTask` and
`validateGeneratedCode` for its protected qualification boundary. Leave it alone.

If separately authorized later, Oxigraph's existing engineering owner must
compose `gepaOptimize({ seed, evaluate, reflect, ... })` from the public
`@metaharness/darwin/gepa` subpath. Its evaluator and native reflector are
injected callbacks, not supplied Oxigraph workers. Flywheel requires an explicit
direct dependency and separate reviewed adapter before importing
`runFlywheelGenerations({ rootPolicy, proposer, evaluator, holdout, signer, ... })`.
No transitive package, built-in promotion rule or default budget grants authority.
Resolve subscription-neutral options, sealed holdouts, opaque reflection IDs,
frozen evaluators, replay and human promotion before activation. AVO/AgenticOW
remain optional and inactive; no learning benchmark blocks ordinary repair.

## Implementation slices and owners

Execute these slices serially after explicit repair authorization. The native
Claude coordinator owns sequencing/control, verifier owner owns evaluator truth,
read-only author proposes source, root alone applies/commits, and a fresh native
reviewer owns the green-candidate review. One task spans the repair outcome.
All new/touched modules must finish below 500 lines; split existing 606-line
`test/workflow.test.mjs` without changing its assertions.

| Slice | Exact mutation scope | Required evidence / owner |
| --- | --- | --- |
| S0: admit bounded seams | `src/workflow.mjs`, `src/delivery.mjs`, `test/delivery.test.mjs` | Verifier adds exact-path/command and spec-v2 admission tests first; root proves red then applies native-proposed allowlist repair through current workflow |
| S1: runtime and serial host | `src/ordinary-runtime.mjs` (new), `src/workflow.mjs`, `src/workflow-host.mjs`; `test/ordinary-runtime.test.mjs`, `test/workflow-host.test.mjs`, `test/support/ordinary-workflow-fixture.mjs` (new), `test/workflow.test.mjs` | Root extracts fixtures/tests without assertion loss; injected public pool proves reuse across repair/review, current context, no fan-out, exact native error and cancellation handling |
| S2: ordinary routing | `src/ordinary-routing.mjs` (new), `src/delivery.mjs`, `src/ordinary-runtime.mjs`; `test/ordinary-routing.test.mjs` (new), `test/delivery.test.mjs` | Verifier proves public Router callback, cold-start incumbent, effort isolation, owner override, capability floor, native-only refusal and no cost/usage gate |
| S3: additive evidence | `src/ordinary-evidence.mjs` (new), `src/workflow.mjs`, `bin/oxigraph-delivery.mjs`; `test/ordinary-evidence.test.mjs` (new), `test/workflow.test.mjs` | Verifier tests original chains, missing/tampered/truncated records, failed attempt retention, duplicate reduction, interrupted finalization and exact integration binding |
| S4: complete join | Only necessary repairs in the S1-S3 paths; `README.md` within this package if explicitly included | Root runs focused/impacted checks on both Nodes; native independent review; one authorized real ordinary outcome; scoped main commits and exact handback |

S0 admits exactly the new helper/test paths named above, including the support
fixture, and no wildcard directory, shell or arbitrary Node
escape hatch. Until S0 passes, keep regressions in the currently admitted tests;
after it passes move them mechanically into the frozen split inventory before
authoring S1-S3. New tests assert behavior through existing controller seams;
failure because an unimplemented module cannot import is not acceptance proof.
The author may not change frozen evaluator bytes to pass its own candidate.
Evaluator files/fixtures become read-only dependencies after their freeze, not
author mutation paths. No package, lock, frozen routing/history/receipt, native adapter, product source
or qualification path is in these slices' mutation inventory.

### Commands and acceptance

From canonical repository root, after verifying the live task/control and
replacing `task-REPLACE-WITH-LIVE-ID`, the currently admitted baseline command is:

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs run \
  --task task-REPLACE-WITH-LIVE-ID --check "Ordinary delivery contracts pass" -- \
  node --test --test-reporter=tap \
  tools/engineering-harness/test/workflow.test.mjs \
  tools/engineering-harness/test/delivery.test.mjs \
  tools/engineering-harness/test/astra-routing.test.mjs \
  tools/agentic-qe/process-runner.test.mjs
```

After S0, add the exact four new `test/*.test.mjs` paths in S1-S3 to the same
literal command; the support fixture is imported, not an executable test target.
Repeat serially with
`/home/claude/.local/share/mise/installs/node/20.20.2/bin/node` replacing the
first `node`. Verify that executable exists and reports Node 20 first.
`admitCommand` resolves child `node` to the wrapper's `process.execPath`, so
this tests both wrapper and children on the selected runtime.

Start implementation through
`node tools/engineering-harness/bin/oxigraph-delivery.mjs workflow --spec FILE.json`
with a reviewed exact ordinary spec and attached authorized native host.
The CLI alone cannot service native/MCP requests. `FILE.json` is an operator
input under `target/engineering-delivery/`, not a new frozen G1 registry entry.
After S3 and exact scoped commit, finalize through
`node tools/engineering-harness/bin/oxigraph-delivery.mjs finalize --result FILE --commit SHA`.
This proposed subcommand does not exist at the audited baseline.
No broad `npm test`, `qualify`, `qualify:synthetic`, `g1.7:*`, provider benchmark
or factory generation belongs in this validation recipe.

This JavaScript package has no build script: focused tests import/execute the
changed ESM modules. Do not invent a product build for an adapter-only slice.
If the final real outcome changes Rust, name its exact crate/target/features,
run required default/all-feature tests and relevant Clippy/fuzz/build checks
through the same entry, then bind produced artifacts. One Cargo command runs
at a time; no stale binary or concurrent crash-test rebuild can count as proof.

Acceptance requires all S0-S3 fixtures green on current Node and Node 20,
unchanged historical evidence, one run-scoped ordinary pool, exactly one model
selector, no duplicate controller, deterministic-green independent review,
exact root integration and verified MCP handoff. Injected tests prove adapter
contracts only. A live native run, held-out learning improvement or semantic
qualification must never be inferred from them. New receipts do not close a
product gate unless the corresponding product behavior was tested.

## Stop, rollback and handback

Before S0, owner must authorize source repair and identify a real active harness
task plus Oxigraph-bound MCP control. Before S4, owner must select and authorize
the real outcome and any runtime-state writes. No live task is invented here.
Reconcile active sessions to the one-process rule before native dispatch.
Stop on unexpected source changes, wrong checkout, native unavailability,
unconfirmed cancellation, evaluator drift or missing required evidence.
Missing public seams go to the owner as a precise package/API gap; no private
Builder import, source copy or transport fallback is an allowed workaround.

Rollback requires the integration owner's scoped authorization: revert only the
faulty new main commit after preserving evidence and unrelated user work.
Never reset, delete receipts, rebaseline semantic inputs or alter product data.
Retain readers for emitted successor records; stop new admission if integrity
fails. Rollback does not activate Codex, OpenRouter, evolution or paused work.

Hand back branch/HEAD, changed paths, task/control keys, evaluator/spec/lock/route
digests, actual native IDs/model/effort, commands/exits, failed and accepted
evidence paths, candidate and integrated commit, independent review and exact
MCP readback. List live and promotion gates not run. Do not report this ADR
commit as implementation, calibrated routing or product progress.

Audit used source/declarations and structured MCP recall only: no install,
build, test, native dispatch, qualification or protected-runtime write.
User-pattern recall succeeded; the phase-gating pattern is superseded by
`metaharness-full-operational-harness-v1`. Available project MCP serves Semantic
Builder, not Oxigraph; no Oxigraph-bound recall or ADR graph update was possible.
No exact causal-query tool was available. Preserve source-based supersession
checks; register ADR memory/edges only through a verified Oxigraph connection.

## References

- [Ordinary workflow and bridge](../../tools/engineering-harness/README.md)
- [Ordinary controller source](../../tools/engineering-harness/src/workflow.mjs)
- [Routing and command admission](../../tools/engineering-harness/src/delivery.mjs)
- [Current programme handover](../handover/2026-09-23-claude-programme-handover.md)
- [Public harness source](https://github.com/ruvnet/metaharness/tree/main/packages/harness)
- RuvNet Brain source retrieval, 2026-09-25: `packages/harness/README.md`,
  `packages/harness/__tests__/kernel.test.ts`, `packages/harness/package.json`;
  README content SHA-256
  `f5a2db0c5352ee99b10a94293cafe25a7e671f9b53bc9fbcf85e391abe44d603`.
  Retrieved snapshot is discovery evidence; installed `dist/*.d.ts` and
  `dist/*.js` at the lock identities above decide actual available APIs.
