# ADR-0048: Repair ordinary engineering policy drift without rebuilding the harness

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
| `src/workflow.mjs:nativeStage` | Real `HarnessKernel`, one-step `AlgorithmRouter`, one admitted host callback and structural verifier per stage | Keep this small public-package adapter in place; a persistent pool has no selection or lifecycle value while each stage has one eligible route |
| `src/delivery.mjs:routeDelivery` | Explicit Claude role defaults and reasoned overrides; no model-quality Router call | Keep static policy while each role has one eligible route; do not describe current defaults as learned |
| `src/delivery.mjs:runDelivery` | Agentic-QE command supervision, exact argv/source/artifact observations | Preserve command admission and existing failure checks |
| `src/workflow-host.mjs` | `stdioHost` and callback-injected `relayWorkflowHost`; leaves native-worker/root-apply to host | Keep bridge; not a native client launcher or MCP server |
| `src/routing/quality-router.mjs` | `QualityFirstRouter` wraps public `Router`; cold start demands paired Codex/Claude evidence | Frozen-lane mechanism, not usable unchanged for Claude-only ordinary work |
| `src/runtime/native-pool.mjs` | `NativeWorkerPool` requires both Codex and Claude declarations | Preserve frozen contracts; do not activate this pool in ordinary delivery |
| `src/receipts/application.mjs` | Versioned frozen application receipts | Not the ordinary workflow receipt writer; leave untouched |
| `src/workflow.mjs` evidence | `ordinary-workflow-v2`, content-bound local events/checks, exact MCP readback | Keep; bind final integration through existing live task/MCP completion after root commits, not a second local evidence subsystem |

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
prompt inviting native children/contributors; `workerOutput` accepts active
contributor arrays; contributor fixtures retain the superseded September 19
no-cap framing. Current owner policy forbids fan-out and allows one model-bearing
process at a time. Remove that prospective execution path without relabelling
historical records. Existing repair, review, route, command and evidence behavior
is otherwise the implementation to preserve, not a platform to replace.

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

### 1. Keep the existing controller and public package adapter

Keep `runWorkflow(spec, host, io)` in `src/workflow.mjs` as the sole outer
controller. Keep `nativeStage` in that file as the small adapter to public
`HarnessKernel`, `AlgorithmRouter`, `AgentPool`, `VerifierRegistry` and
`predicateVerifier`. `runDelivery` remains the deterministic command boundary.
No new runtime module, lifecycle, dispatcher or workspace manager is needed.

Each stage has exactly one policy-admitted host callback. Creating its one-agent
pool beside that stage is cheap and prevents an upstream bandit from selecting a
different role route. A persistent pool would require mutable route/request
context, retain diagnostics across unrelated attempts and still would not reuse
kernel receipt, breaker or retry state. Do not extract or persist it until an
observed multi-agent stage needs actual pool selection and has tests proving the
benefit. Object-count reduction is not a harness outcome.

`AlgorithmRouter` chooses the one stage algorithm; it does not choose the native
model. `VerifierRegistry` checks result structure; it does not replace Oxigraph
commands or independent review. Preserve zero kernel retries. Existing outer
repair owns one failure-directed retry loop and stops on unchanged source/failure.
Account or requested-model unavailability keeps its exact error and never becomes
a quality label, retry cascade or transport fallback.

### 2. Keep static model policy until selection exists

Keep `routeDelivery` as the only ordinary model-policy function. Current owner
policy permits one Claude route per role, with reasoned Sonnet/Opus overrides.
Under that policy a new `@metaharness/router` adapter has no choice to make and
cannot learn a comparative outcome. Adding feature vectors, candidate schemas,
reducers or a tie-breaker now would duplicate policy without changing execution.

The public Router remains available for a later separately authorized slice only
after at least two simultaneously eligible candidates exist for one role and the
repository has paired same-task, same-evaluator, all-verifier-cleared evidence.
That later design must bind host, exact model, effort, role, policy, evaluator and
harness revision; exclude infrastructure/evaluator failures; use neutral
subscription cost fields; and compare accepted-outcome time only after correctness.
Cold start, missing comparison data or one eligible candidate retains the current
configured route. Codex or API activation is never a calibration prerequisite.

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

The active host, not this controller, owns the native process. Existing stdio
closure and timeout fail the workflow but do not prove remote process termination.
Do not invent `AbortSignal`/`cancelNative` support in this repair without a
reproduced orphaned-process defect and a host API that can confirm matching
request identity and termination. Agentic-QE continues to supervise local
deterministic commands. State this limitation; do not claim containment or crash
recovery that does not exist.

### 4. Preserve evidence; finish integration through existing authority

Root/verifier owner freezes one exact ordinary task and evaluator before authoring.
The live Ruflo task/control and implementation handoff bind baseline commit/tree,
evaluator patch/content digest, allowed paths, commands, required outputs, review
policy and intended failure. Build prerequisites first; missing imports/tools are
not a discriminating red. Under the same authorized task, root applies the
content-bound evaluator patch before authoring, runs the admitted command to prove
the intended red, and keeps evaluator paths outside the worker mutation scope so
`outsideObservation` freezes them. Final integration commits evaluator and source
together after green verification. No separate red commit or self-referential task
registration is required. Reuse one live terminal outcome; correct stale scope once.

Do not add a speculative workflow schema solely to repeat task-control fields.
If implementation inspection proves a required binding is absent from both the
live task and `ordinary-workflow-v2`, add only that field to the existing spec and
evidence with strict compatibility tests. Absence must be demonstrated first.

Keep failed attempts immutable and add justified regression lineage under that
same outcome. Deterministic checks precede independent review; changed bytes
invalidate earlier checks/review. Root verifies exact application, commits the
accepted slice, then closes the live task. `ready-for-owner-review` is not an
integrated product outcome.

Keep `ordinary-workflow-v2`, local event/check references and exact MCP handoff.
They already bind task/spec/source/route, requested native identity, check evidence,
review and failure-directed attempts. Preserve negative records and historical
bytes. Upstream stage receipts remain nested stage evidence; no merge, reducer,
new receipt database or Router-history projection is needed for this repair.

After root commits the exact verified candidate, the coordinator rechecks the
commit's files against the returned candidate identity, updates the existing live
task/evidence record with commit SHA, workflow key, evaluator identity, commands,
review and remaining gates, retrieves it through the Oxigraph-bound MCP and only
then completes the task. This is existing coordinator authority, not a new
`finalize` CLI subcommand. A failed write/readback leaves the task in progress.
The local workflow result remains `ready-for-owner-review`; never rewrite it as an
integrated record.

Search/store project facts only through an Oxigraph-bound structured Ruflo MCP
connection; verify stores by exact retrieval. User memory is reusable context,
not the repository ledger. Optional recall failure must not block delivery,
but missing mandatory live task authorization or handoff readback must fail
closed; never synthesize either from memory or local files.

### 5. Evolution and learning remain deferred

Ordinary source imports no GEPA, AVO or Flywheel controller. The separate
`tools/metaharness/qualify.mjs` imports Darwin root functions `evolve`,
`generateBaselineHarness`, `inspectVariant`, `runVariantTask` and
`validateGeneratedCode` for its protected qualification boundary. Leave it alone.

If separately authorized later, use public Darwin/GEPA with Oxigraph evaluator
and native-reflection callbacks. No transitive package, built-in promotion rule
or default budget grants authority. Resolve subscription-neutral options, sealed
holdouts, opaque reflection IDs, frozen evaluators, replay and human promotion
before activation. Router learning, Flywheel, AVO and AgenticOW remain inactive;
no learning benchmark blocks ordinary repair.

## Implementation slices and owners

Execute one bounded repair outcome serially after explicit authorization. Native
Claude coordinator owns sequencing/control; verifier owns evaluator truth;
read-only author proposes source; root alone applies/commits; fresh native review
owns green-candidate review. Do not create tasks per finding.

| Slice | Exact mutation scope | Required evidence / owner |
| --- | --- | --- |
| O0: freeze current defect and admit test split | `src/workflow.mjs`, `src/delivery.mjs`, `test/workflow.test.mjs`, `test/delivery.test.mjs` | Verifier proves current implementation prompt contains superseded fan-out/no-cap language and active contributor results are accepted. Admit only literal `README.md`, `test/workflow-policy.test.mjs` and `test/support/ordinary-workflow-fixture.mjs` mutation paths, plus the policy test as an executable Node test. No model call. |
| O1: remove superseded contributor execution | `src/workflow.mjs`, `README.md`, `test/workflow.test.mjs`, new `test/workflow-policy.test.mjs`, new `test/support/ordinary-workflow-fixture.mjs` | Prompt requires one native worker and no subagents/contributors; non-empty active contributor results fail before root apply/review/handoff; single implementation ID remains excluded from review; existing repair, route, source, check and MCP behavior stays green. Split the 606-line test, preserve unaffected assertions and replace superseded contributor-acceptance assertions with rejection-before-apply coverage; every touched file ends below 500 lines. |
| O2: complete exact join | Only necessary O0-O1 repairs; no package/lock, Router, frozen qualification, product or native-adapter changes | Focused tests on current Node and Node 20; authorized real ordinary harness-maintenance outcome; exact root commit; fresh review; live task/MCP commit binding and readback. |

O0 is a bootstrap inside current admitted files. It adds literal `README.md`,
`test/workflow-policy.test.mjs` and `test/support/ordinary-workflow-fixture.mjs`
to `ordinaryHarnessPath`; only `test/workflow-policy.test.mjs` joins `nodeTests`.
No wildcard directory, arbitrary Node command, shell or package change. O1 moves
shared fixtures and unaffected assertions after those paths are admitted, then
replaces obsolete contributor-pass cases with current serial-policy rejections.
Verifier bytes become read-only before candidate work.
No new runtime/routing/evidence module, CLI action, package, lock, frozen
history/receipt, product source or qualification path belongs to this repair.

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

After O0, add the exact `tools/engineering-harness/test/workflow-policy.test.mjs`
path to the same literal command; the support fixture is imported, not an
executable test target.
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
After exact scoped commit, use existing structured MCP task/evidence operations
to bind and read back the commit before task completion. Do not add a local
`finalize` action.
No broad `npm test`, `qualify`, `qualify:synthetic`, `g1.7:*`, provider benchmark
or factory generation belongs in this validation recipe.

This JavaScript package has no build script: focused tests import/execute the
changed ESM modules. Do not invent a product build for an adapter-only slice.
If the final real outcome changes Rust, name its exact crate/target/features,
run required default/all-feature tests and relevant Clippy/fuzz/build checks
through the same entry, then bind produced artifacts. One Cargo command runs
at a time; no stale binary or concurrent crash-test rebuild can count as proof.

Acceptance requires O0-O1 fixtures green on current Node and Node 20, unchanged
historical evidence, exactly one static ordinary route policy, no contributor
fan-out, no duplicate controller, deterministic-green independent review, exact
root integration and verified MCP handoff/readback. Injected tests prove adapter
contracts only. No Router learning, persistent-pool benefit, live product run,
held-out improvement or semantic qualification is inferred.

## Stop, rollback and handback

Before O0, owner must authorize source repair and identify a real active harness
task plus Oxigraph-bound MCP control. Before O2, owner must select and authorize
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
