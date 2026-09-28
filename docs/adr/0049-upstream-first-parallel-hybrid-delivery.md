# ADR-0049: Upstream-first parallel hybrid delivery

- **Status**: Proposed
- **Date**: 2026-09-26
- **Updated**: 2026-09-28
- **Deciders**:
- **Tags**: engineering, ruflo, metaharness, parallel-delivery, openrouter
- **Related**: ADR-0017, ADR-0043, ADR-0048

## September 28 implementation handoff (current plan)

Implementation in progress: ordinary delivery now has an isolated direct API
callback at its existing kernel/host seam, explicit native/API routes, shared
packet rendering and worker-output validation, per-request bounds and replay
records, exact known model/snapshot admission, task-scoped completed-output holds,
auth/credit/unknown-completion attribution, actual metering in kernel evidence,
and capable native repair. The first focused slice passes 61 ordinary harness
tests on Node 24 plus JavaScript syntax and whitespace checks. This is injected
contract evidence, not a live model cascade or completion of this ADR. Pool,
resource isolation and initial live proof remain unverified; programme stays paused.

Ordinary harness repair may explicitly record unavailable project MCP and known
owner-review hold state. Local source/check/review references remain mandatory;
the result reports `mcpReadback: false`, never fabricated coordination success.
This exception cannot resume product work or bypass reachable MCP refusals.
The existing workflow CLI exposes this operational declaration; normal connected
work retains live control reads and exact store/readback. Focused contracts pass.
Per-request reservation records now bind process PID plus boot/start identity;
live calls may overlap, while dead/reused/unknown ownership or unreadable records
blocks new dispatch as unknown charge. Exclusive initial publication and atomic
terminal writes avoid partial-read races. Concurrent-adapter and live-child/crash
tests pass; this is no
global one-model limit. Native fallback review retains failed API accounting.

This section supersedes conflicting September 26 proposals below. Those sections
remain historical source findings, not another executable checklist. Status remains
Proposed: documentation refresh does not claim this repository implemented Builder.
Owner authorized matching Builder models/limits and removal of stale Claude-only,
no-API, fixed-session and mandatory harness-only rules on September 28. Policy
reconciliation is authorized now; runtime activation still requires implementation
and proof. No publication or application programme resumption follows.

### Finish criteria and scope discipline

Compose upstream tools with thin project adapters, not a second framework.
Preserve working acceptance, parallelism and learning. Do not copy Builder's entire
private runtime, add a scheduler/service, regenerate a working harness, or install
unused packages. Before changing a seam, show its actual local defect or missing
contract; reuse the existing implementation when it already satisfies the contract.
Keep one task/outcome through repair; no new task, calibration, inventory or repin
for each finding. Focused regression, independent review and impacted build once
per coherent slice; broader join at acceptance, not between every small repair.
Direct application and harness implementation, repair, tests and builds are
authorized; harness dispatch is not compulsory. Retain orchestration and learning
as useful execution paths, not gates on direct work. Preserve scoped checks,
independent review, source/data isolation and one integration writer. Direct edits
never inherit old worker acceptance receipts or manufacture runner evidence.

Completion means: configured routes work, deterministic checks and independent
review pass, failure/repair and source-handoff contracts are proved, and restart
admission passes without starting the programme. Successful cheap/frontier cascade
counts as success. Perfect DeepSeek-only execution, model bake-offs, highest harness
score, a PR system, or new evolution benchmarks are NOT completion gates.
Preserve/exclude pre-existing managed helper files. Concurrent updates are expected
only where owner-confirmed; never absorb them into scoped harness commits.
Unexpected owned source changes still require reconciliation.

### Reuse and remove map

| Responsibility | Required composition / removal |
| --- | --- |
| Stage execution | Retain actual `@metaharness/harness` kernel/pool/verifier callback seam and project acceptance. Factory/templates scaffold; they do not prove active execution. |
| Concurrent ready callbacks | First assess `runBoundedPool` in Ruflo `v3/@claude-flow/cli/src/services/bounded-worker-pool.ts`, as documented in Builder ADR-0054 R8. Wrap existing outcome callbacks, not a new agent platform. |
| Export compatibility | Pool is exposed through `./dist/*`, not stable dedicated high-level API. Resolve installed export/declarations on Node 24, record package/version/lock and cancellation behavior. Declare any dependency actually used; no reliance on an accidental global install. |
| Scheduling authority | Pool bounds callbacks; project retains dependency acceptance and same-file/ancestor-path/named-resource exclusion. Do not remove them or claim pool handles them. Root releases children only after integrated predecessor source reaches their input. |
| Source isolation | Non-Git candidate snapshots/patches, one integrator on the authorized checkout specified below. No new branches/worktrees/PR machinery is required for this repair. Earlier worktree proposal needs separate future authorization. |
| Planning | Share architecture renderer across native/API wrappers; packet-only mode explicitly has no tools, retains admitted source and requests a plan instance, not schema definition. Native contract stays unchanged. |
| Review | One existing coordinator for ordinary/recovery paths; one production prompt renderer shared by native/API wrappers and qualification. Remove duplicate active prompts/coordinators only after preserving stronger checks. |
| Evidence | Reviewer sees current admitted source, patch, task and sanitized deterministic results/file-policy facts; never hidden evaluator, expected verdict or author rationale. Bind qualification to original source/evaluator, not today's checkout. |
| Progress | Use existing process/progress seams for PID/start, phase, throttled activity, safe tool names and completion. Bound capture; callback errors cannot orphan children. No raw prompts, tool bodies, credentials or reasoning in ordinary logs. |
| Repair | Invalid completed output retains actual usage/cost and safe diagnostic, not completion-unknown. Infrastructure/stale-source belongs to integrator; evaluator mutation to evaluator owner. Identical failed patch stops, changed repair remains eligible. |
| Learning | Preserve existing Router/outcome/memory/evolution connections and sole-writer reduction. Keep explicit local promotion/qualification boundaries; packages installed or settings present are not operational-learning proof. No new benchmark programme or removal of learning to simplify delivery. |

Builder inspected pool versions 3.38.20 locally and 3.45.0 on GCP, not this repo.
Its pre-aborted signal may still start callbacks; timeout can return before a
noncooperative callback stops. Check cancellation before dispatch and retain resource
ownership until child termination is observed. Verify on the intended server before
claiming deployment parity. Existing supported pool may be retained if equivalent.
Keep remote inference concurrency separate from Cargo/.NET/Node job workers.
Sample effective CPU, interval utilization, memory and I/O pressure before heavy
work, every 30 seconds and at refill; account for all jobs on that host. Use supported
worker controls, isolated targets/DBs/ports; do not invent CPU-based model-session caps.

Inventory factory/kernel, Router, Darwin/GEPA, AVO/Flywheel, AgenticOW and QE only
where present or required by accepted local decisions: label installed, configured,
operational and deferred separately. Reuse existing hooks/adapters rather than
local substitutes. Preserve ordinary outcome capture and learned policy reduction;
promotion still needs real evaluator and held-out proof. Missing optional promotion
evidence neither strips learning nor blocks delivery, and does not authorize a
new evolution campaign.

### Approved target routing; local activation remains an implementation step

- Eligible planner/implementer and separately qualified fresh-context reviewer:
  `deepseek/deepseek-v4.1-flash` via direct OpenRouter, not 9router API forwarding.
  Qwen/GLM are not this target. Same-model review uses a separate qualified reviewer identity and fresh API request,
  without author conversation/rationale; it is not cross-model/developer consensus.
  Preserve stronger declared review policies.
- Capability/output failure: configured capable native subscription repair,
  Builder reference Opus/high `cc/claude-opus-5-5[1m]`. Verify exact client alias
  locally; no model rename presented as runtime proof.
- Only proven nonexecuted HTTP402 credit rejection permits lighter Sonnet/Sol
  subscription fallback. Both native hosts are authorized; remove stale Claude-only
  restrictions consistently in instructions/configuration/runtime. Never Opus solely for
  exhausted credits. Authentication, unknown completion and local request-limit
  failures do not authorize fallback. Native unavailable pauses with exact
  client/model/error; never switch transport silently.
- Enforce maximum $1/request before dispatch; no cumulative/task/session ceiling.
  Preserve actual versus unknown charges, reservation/replay protection and actual
  fallback author/reviewer identities. Keep API keys out of native/tool/verifier
  environments. Existing native subscription gateway settings stay intact.
- Builder defaults: high reasoning, `reasoning.exclude=true` (hide returned thoughts,
  not disable computation), 131072 max output tokens, 1800000ms API timeout,
  2000000 response bytes, provider ceilings $0.50 input/$2 output per million.
  These are configurable defaults, not test-sized budgets or performance promises.
- New confirmed-output holds bind task digest, policy and packet class, never
  disable unrelated tasks. Retain same-task exclusions and unknown-charge stops.
  Old unscoped failures remain effective until explicitly evidence-migrated;
  never erase receipts or rotate a policy merely to bypass a hold.

### Builder donor evidence and bounded acceptance

Read Builder ADR-0051/0053 updated September 28 and ADR-0054 R8, then inspect donor
diffs rather than cherry-picking across unrelated runtimes:
`cf00eb06b` progress/cancellation and maintenance-authoring amendment;
`3430c6365` shared review/file-policy evidence/unchanged-repair stop;
`803cff426` production-context reviewer qualification;
`e759396a6` confirmed-credit Sonnet/Sol fallback;
`fa82f77fa` shared planner and completed-proposal diagnostics;
`701ea878b` task-scoped holds and fixed finish criteria.
Donor path prefix: `src/tools/application-development-harness/src/`;
inspect `native-worker-contracts-v1.ts`, `control-plane-review-v1.ts`
(if renamed, follow `ordinaryReviewAgentV1`), `native-model-invocation-v1.ts`,
`hybrid-worker-implementation-v1.ts`, `hybrid-suspension-v1.ts`,
`hybrid-credit-fallback-v1.ts`, and qualification/runtime adapters.

Builder live `deepseek-full-cascade-live-20260927-r2` passed in 236410ms:
DeepSeek plan, rejected implementation, Opus repair, DeepSeek approval; all
verifiers passed, API cost $0.02369829258. Receipt
`sha256:9f7324f0d77de7b0622e788a96a2e783f56f4f997c9d8455f34df58a3be8729e`
verifies; final scoped regression was 181 tests/build/restart audit.
This proves Builder cascade, not sibling adoption or perfect DeepSeek authorship.
Upstream ADR-127 (Accepted June 18) uses exact search/replace sentinel blocks;
Builder uses JSON edits. Keep safe exact matching; neither transport is proof
of model correctness. Do not blame JSON without captured evidence.

Acceptance in this repository, within one repair outcome:
1. Reconcile policy/config once, then implement only local gaps mapped below.
2. Inject transport/process tests for source/review binding, failed and unchanged
   repair, safe progress, cancellation, task A held/task B eligible, HTTP402 versus
   auth/unknown failures, credit fallback independence, $1 bound and no total cap.
3. Exercise two genuinely independent existing outcomes through compatible upstream
   pool with actual overlap evidence; retain conflict exclusion. Reuse accepted local
   proof when source-current. Prove one dependent receives accepted parent source.
   If programme graph is truly serial, report that constraint; do not invent
   application independence, strip business dependencies or launch filler tasks.
4. Run one local end-to-end cascade with independent review and authoritative
   checks, accepting legitimate frontier repair. Preserve failed attempts.
5. Integrate verified source serially; run read-only restart admission and document
   active/ready/manual/blocked work separately from harness defects. Record
   installed versions, exact commands, source/receipt identities, costs and limits.
   Update this ADR to Implemented only for proven scope; leave programme stopped.

## Oxigraph-specific implementation map (September 28)

Rechecked clean main `4d57ddfe51136bd87b86c16ae90bee23a011c260`.
This is policy-bearing `sparkling/oxigraph` fork. Ordinary engineering is not
semantic qualification: preserve RDF/SPARQL/storage oracles, pinned specifications,
G1.7 state and `tools/metaharness` boundary. No rebaseline or qualification run.

- Keep `tools/engineering-harness/bin/oxigraph-delivery.mjs workflow --spec` and
  `src/workflow.mjs` kernel/request/root-apply/check/review flow.
  `src/workflow-host.mjs` existing injected host callback is integration seam;
  asynchronous callback observation does not prove live model streaming.
- `src/workflow.mjs` already stops repeated unchanged source plus failure;
  retain/test it rather than add Builder's second stop implementation.
- Extend ordinary `src/delivery.mjs` source/route/command contracts for explicit
  API packets and shared review context; do not relax frozen candidate/runtime/
  provider policy or two-host qualification merely to add ordinary API delivery.
- Keep exact source observation, stale host rejection and independent executor
  review. Bind isolated non-Git candidate roots before concurrent callbacks;
  sole root applies verified result on main, never candidate workers.
- Allocate ordinary private Cargo targets and RocksDB stores. Existing generic
  environment scrubbing removes `CARGO_*`/`RUST_TEST_THREADS`: narrowly admit
  validated job configuration, not arbitrary inherited environment. Bind artifacts
  to actual allocated target/compiler result; no shared binary overwritten during
  crash-test `current_exe()` re-execution.
- September 28 AGENTS amendment removes the prior one-process/one-command cap,
  Claude-only/OpenRouter bans and mandatory harness-only execution. Runtime route
  admission still needs implementation/proof; policy permission alone is not
  operational concurrency. Frozen safety boundaries remain.
- Standardize ordinary Node24 runtime separately from historical Node20 replay
  obligations. No reinterpretation of old dual-runtime evidence as a current pass.

Direct validation is permitted; the recorded harness-wrapped equivalent below
remains available. Use focused ordinary tests, not broad `npm test`
(which includes separately governed surfaces):
```bash
node tools/engineering-harness/bin/oxigraph-delivery.mjs run --task <existing-task-id> --check "ordinary harness contracts pass" -- node --test --test-reporter=tap tools/engineering-harness/test/delivery.test.mjs tools/engineering-harness/test/workflow-policy.test.mjs tools/engineering-harness/test/workflow.test.mjs
```
Verify these paths against checked-out package before invocation; extend the
ordinary `admitCommand` allowlist narrowly if new contract tests need it.
Run affected Rust/API/persistence matrix per fork ADRs. Do not run `qualify`,
`qualify:synthetic` or `g1.7:*` as a harness repair shortcut. Keep deferred
promotion/learning authority explicit; no new benchmark gates.

## Historical September 26 assessment (superseded instructions)

Source findings below retain their original date and evidence limits. Earlier Qwen,
worktree/PR prerequisites and heavier orchestration proposals are historical, not
current implementation direction. Use September 28 handoff above for execution.

## Purpose and authority

Adapt ordinary engineering delivery for independent concurrent outcomes, isolated
source/build/database state and exact reviewed integration. Preserve Oxigraph's
semantic qualification and protected evidence boundaries. This is a repair plan,
not implementation, qualification, publication or permission to resume held work.

The requested target is Node 24, direct OpenRouter
`deepseek/deepseek-v4.1-flash` authoring, independent
`qwen/qwen3-235b-a22b-2507` review and native subscription escalation through configured routes. Metered
requests must have a verified maximum of $1 each, with no cumulative spending cap.
Native subscriptions have no cost, token, invocation, request or quota budgets.
Select useful model concurrency from ready dependencies and measured resource
pressure, without a fixed model-session cap. The requested source workflow uses
task branches/worktrees and reviewed PRs with one integration owner.

Current `AGENTS.md:5` explicitly caps both model processes and harness commands at
one; `AGENTS.md:23` selects Claude-only execution, and `AGENTS.md:95` forbids
OpenRouter. Personal main-only instructions also conflict with the requested
worktree workflow. These are policy repair prerequisites, not reasons to discard
the target. Reconcile governing instructions explicitly before any worktree,
concurrent implementation or new transport is activated. This proposed ADR does
not silently lift those restrictions or alter existing frozen qualification.

## Exact local baseline and evidence limits

Inspected `/home/claude/src/hm/oxigraph` on canonical `main`, clean at
`d9512b01a6781a18b7c2765c953489f380b2c982`, on 2026-09-26. Origin is
`https://github.com/sparkling/oxigraph.git`: this review concerns that policy-bearing
fork, not `oxigraph/oxigraph` upstream. Local Node is `v24.14.1`.
Installed `tools/engineering-harness/node_modules` contains
`@metaharness/harness` 0.2.0 and `@metaharness/router` 0.4.0;
`@claude-flow/codex` is absent from that package location, not proven absent
host-wide. The package engine remains `>=20`.

ADR-0017 is Implemented, dated 2026-08-24, updated 2026-09-10. ADR-0043 is
Implemented, dated 2026-09-07, updated 2026-09-22. ADR-0048 is Implemented,
dated 2026-09-24, updated 2026-09-25; it deliberately removed contributor fan-out
under the then-current serial policy. That implementation is not a concurrency
defect against its original contract, but must change for this new target.

Evidence is local source/package inspection only. No GCP server was inspected,
and no build, model invocation, qualification, live database or concurrency trial
ran. No Oxigraph-scoped Ruflo MCP connection is available in this session;
Builder project memory must not store fork facts. ADR graph registration awaits
the correct project connection. Cross-project user memory was searched and the
exact phase-gating pattern retrieved; historical native-only policy in memory
does not override the requested hybrid target.

## Findings and existing boundaries

Source references are repository-relative at the baseline commit.

| Area | Evidence | Classification and consequence |
| --- | --- | --- |
| Ordinary entry | `tools/engineering-harness/bin/oxigraph-delivery.mjs:48` | Existing `workflow --spec` invokes preflight, JSON-line native-host bridge and `runWorkflow`. Keep it; route output alone is not execution. |
| Real upstream kernel | `tools/engineering-harness/src/workflow.mjs:193` | Each native stage uses `HarnessKernel`, `AlgorithmRouter`, `AgentPool`, `VerifierRegistry`. Its callback delegates to the active host; no independent application scheduler is supplied by the pool. |
| Serial execution | `tools/engineering-harness/src/workflow.mjs:278`; `tools/engineering-harness/src/workflow.mjs:305`; `tools/engineering-harness/src/workflow.mjs:331` | Implementation, checks and review await in order; prompts forbid child sessions and worker results reject contributors. This implements ADR-0048 rather than a disabled concurrency switch. |
| Main-only guard | `tools/engineering-harness/src/delivery.mjs:170` | Source observation requires canonical main and rejects another worktree. Root applies exact proposed contents at `workflow.mjs:293`. Task branches need a tested workspace context contract, not deletion of this guard. |
| Exact source evidence | `tools/engineering-harness/src/workflow.mjs:220`; `tools/engineering-harness/src/workflow.mjs:248`; `tools/engineering-harness/src/workflow.mjs:335` | Preflight drift, stale host responses and reused implementation identities in review are rejected. Preserve all three when adapting concurrency. |
| Native defaults | `tools/engineering-harness/src/delivery.mjs:20` | Ordinary roles statically select exact `cc/claude-opus-5` routes. These are policy defaults, not trained Router choices or native availability proof. |
| API adapter absent | `tools/engineering-harness/src/policy/providers.mjs:85`; `tools/engineering-harness/src/runtime/native-pool.mjs:14` | Frozen native invocation/pool rejects OpenRouter; the pool requires both native providers. It cannot be repurposed as an API worker by changing a model string. Ordinary delivery needs an explicit transport adapter. |
| Build resource gap | `tools/engineering-harness/src/delivery.mjs:69`; `tools/child-environment.mjs:9` | Ordinary commands admit `-j`/`--jobs`, but generic environment scrubbing removes `CARGO_*` and `RUST_TEST_THREADS`; no ordinary per-task target allocator is present. Ambient job/target settings do not establish enforcement. |
| Shared outputs | `tools/engineering-harness/src/delivery.mjs:251`; `tools/engineering-harness/src/delivery.mjs:265` | Evidence directories are unique, while executable artifacts must be under shared `target/debug` or `target/release`. Unique logs do not isolate binaries or RocksDB stores. |
| Proven local hazard | `AGENTS.md:178` | Concurrent Cargo commands can truncate a test binary while crash tests re-exec `current_exe()`. Separate source roots without separate targets do not fix this race. |
| Separate frozen isolation | `tools/engineering-harness/src/candidate/sandbox-session-worker-v2.mjs:468` | Frozen candidate lane sets build jobs and `/state/target`; qualification has other private-build contracts. These are not wired into ordinary delivery and cannot be claimed as its resource controls. |
| Node contract drift | `tools/engineering-harness/package.json:49`; `AGENTS.md:138` | Runtime is locally Node 24, but package engine admits 20 and policy requires dual-runtime testing. Standardize ordinary development deliberately; retain any genuinely pinned historical replay requirement separately. |

No `.agents/config.toml` or `.codex/config.toml` exists at the inspected repository
root, and active ordinary delivery does not call Ruflo's swarm configuration
loader. The missing integration is not solved by adding an inert config file.
There is also no demonstrated ordinary cross-process resource admission or
branch-to-PR-to-dependent-source handoff in these entrypoints.

The whole-checkout observation binds tracked diff, status and untracked files.
Independent writers sharing main would invalidate one another even with disjoint
mutation paths. Keep one integration writer and isolate candidate observations.

## Upstream reuse, with actual limits

Brain retrieval on 2026-09-26 returned Ruflo
`v3/@claude-flow/codex/src/dual-mode/cli.ts` and `tests/dual-mode.test.ts`.
The fuller source audit in Builder ADR-0054 pins Ruflo
`a91db6768ba5e8c9e31c840ad25c1c96478f3f0f` and MetaHarness
`7bffe2f58ee72c367cea07beb62ee00fc2bee755`. No installed/export parity or
GCP execution follows from those pins.

1. [`DualModeOrchestrator.runCollaboration`][orchestrator] and
   `loadSwarmAutomationConfig` provide native workers, dependency scheduling,
   worker/writer bounds and configuration loading. The first existing
   `.agents/config.toml` or `.codex/config.toml` wins; files are not merged.
   Repeated CLI workers are sequential without `--parallel-workers`.
   Dependency-level batches retain barriers; a linear role template stays serial.
2. [`CodexWorktreeCoordinator`][worktrees] supplies `prepare`, `status`,
   `integrate`, `cleanup`; reuse after explicit policy reconciliation. Pin
   `baseRef` to the accepted fork commit. Its local merges are not a GitHub PR
   workflow, and prepared dependent worktrees do not automatically receive later
   predecessor commits. Git remote, base, head and accepted source require checks.
3. Keep the existing [MetaHarness kernel][kernel] stage adapter and deterministic
   verification. Its awaited step loop is not the outer native executor. Ruflo
   ADR-324 is Accepted, dated 2026-07-28; ADR-327 is Proposed, dated 2026-07-28.
   MetaHarness ADR-047 is Proposed, dated 2026-06-16. Proposed distributed
   enforcement must not become an ordinary local-development prerequisite.

The pinned dual-mode worker interface supports native Claude/Codex, not direct
OpenRouter. Its CLI-backed memory bootstrap also conflicts with MCP-only memory.
Resolve those actual adapter gaps before selecting it as the effective executor;
do not invent an OpenRouter platform value, bypass MCP, or copy a sibling's
private runtime. Native Workflow APIs are another reuse candidate only after
their availability in the installed client is demonstrated.

## Bounded implementation and acceptance sequence

1. **Reconcile policy and freeze ordinary adapter tests.** Update the explicit
   serial/Claude-only/native-only and main-only constraints consistently before
   enabling the requested target. Keep historical receipts and frozen G1
   contracts unchanged. Distinguish candidate source authority from integration
   authority; a candidate may never directly mutate canonical main. Preserve
   task/control holds and explicit publication authority.
2. **Standardize Node 24 and hybrid routing.** Update ordinary harness runtime,
   CI and scripts; inspect all relevant package engines and native dependencies.
   Introduce a discriminated API/native contract at the ordinary host boundary,
   retaining exact requested and observed model/effort/transport. Resolve the
   exact requested model IDs above against live provider availability and pricing;
   do not silently reselect them. A model name in a plan is not availability proof. Inject a mock API transport
   for contract tests; retain credentials only in the isolated API adapter.
   Reject dispatch if maximum input/output cost is unknown or exceeds $1;
   use `maxRequestUsd: 1`, `maxTotalUsd: null` where accepted. Preserve usage,
   unknown-charge accounting and same-request replay protection. No subscription
   budget gates. Output rejection may invoke declared native escalation; native
   unavailability must report exact client/model/error and pause for recovery.
3. **Adapt upstream executor and workspace APIs.** Supply candidate workspace
   context to existing source observation, file reads and evidence checks.
   Validate fork remote `sparkling/oxigraph`, accepted base and mutation ownership.
   Preserve dirty/failed candidate work. Prove independent executions overlap,
   while each downstream task starts only from accepted predecessor source.
   Keep one reviewed integration owner; PR push/create/merge requires explicit
   authority, base `main` at `sparkling/oxigraph` and reviewed commit identity. No automatic
   upstream merge or publication is inferred from worker completion.
4. **Separate model and heavy-work admission.** Use observed effective CPU/cgroup
   capacity, interval CPU, memory peaks and I/O pressure across repositories on
   the same host. Admit each server separately; do not pool CPU capacity across hosts.
   Budget Cargo jobs, Rust test threads, RocksDB C++ builds and Node test children
   inside each admitted job; model waiting time is not CPU demand. Give each
   candidate private Cargo target, temporary RocksDB databases, evidence outputs
   and ports. Extend the ordinary artifact contract to bind the allocated target
   and actual Cargo compiler-artifact result. Do not weaken the generic child
   environment scrubber or borrow protected G1.7 state. Test ownership conflicts,
   job cancellation, cleanup of owned paths and crash-test binary stability.
5. **Prove useful concurrent delivery.** First use fake host/worker tests for
   overlap, dependency failure, stale source, independent review and policy
   refusal. Then, under execution authority, capture real run IDs/PIDs/request
   IDs, pinned source and handoff hashes, resource samples and whole accepted
   outcome time against a serial baseline. Run focused ordinary harness tests
   and affected Rust/API/persistence regressions; freeze semantic evaluators.
   An engineering pass is not SPARQL conformance, G1.7 qualification or release.
   Collect separate server evidence before claiming GCP capacity or performance.

Implement through the existing engineering workflow, preserving root acceptance
and incremental verified commits. Required source fixes belong to the same
bounded outcome; no new task per defect, replacement scheduler, benchmark
programme or evolution loop is needed. Replay old records without rewriting them
as evidence for the new policy.

## Consequences

The target gains useful parallelism without discarding existing exact-source
checks or confusing engineering with semantic truth. Real migration costs are
workspace context, API/MCP integration and resource ownership. Upstream batches
and fork-specific evidence restrictions remain visible limitations. Current
application holds and protected runtime state remain intact.

## Links

- [Ordinary harness repair](0048-ordinary-engineering-harness-repair-and-learning.md)
- [Proportional delivery](0043-delivery-recovery-and-proportional-release-boundary.md)
- [Engineering and qualification boundaries](0017-repository-evolution-and-evidence-promotion-harness.md)
- Cross-project source audit: `semantic-builder/docs/adr/ADR-0054-upstream-first-parallel-harness-execution.md`.

[orchestrator]: https://github.com/ruvnet/ruflo/blob/a91db6768ba5e8c9e31c840ad25c1c96478f3f0f/v3/@claude-flow/codex/src/dual-mode/orchestrator.ts
[worktrees]: https://github.com/ruvnet/ruflo/blob/a91db6768ba5e8c9e31c840ad25c1c96478f3f0f/v3/@claude-flow/codex/src/worktrees/coordinator.ts
[kernel]: https://github.com/ruvnet/agent-harness-generator/blob/7bffe2f58ee72c367cea07beb62ee00fc2bee755/packages/harness/src/kernel.ts
