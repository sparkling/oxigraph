# ADR-0049: Upstream-first parallel hybrid delivery

- **Status**: Proposed
- **Date**: 2026-09-26
- **Updated**: 2026-09-28
- **Deciders**:
- **Tags**: engineering, ruflo, metaharness, parallel-delivery, openrouter
- **Related**: ADR-0017, ADR-0043, ADR-0048

## September 28 implementation handoff (current plan)

Ordinary delivery has isolated direct API at existing kernel/host seam, explicit
routes, shared packets/output validation, request bounds/replay, task-scoped holds,
failure attribution, actual metering and capable repair. Programme stays paused.

**September 28 ordinary entrypoint repair:** `oxigraph-delivery.mjs batch --spec`
now calls the existing upstream pool with isolated workflow specs. Strict JSON
admission, unique entry/task IDs, source/resource exclusions, run/request bridge
multiplexing and cancellation drain preserve candidate custody and owner acceptance.
Cancellation/bridge failure retains unconfirmed external-action ownership.
Functional CLI fixtures rendezvous two authors, reply out of order and run real
Node checks in distinct candidate roots; final nine-file join passes 91/91 on
Node 24.14.1, plus syntax checks. No live models or performance benchmarks.
Connected control accepts owner-set `readyHarnessTaskIds`/`readyDeliveryTaskIds`;
present arrays replace legacy scope IDs, empty revokes all, absent preserves legacy.
IDs must be unique/valid; task remains `in_progress`, product owner hold still gates.
Checks refresh before stages; no live control was changed or programme resumed.
**Ordinary control-plane/learning slice:** normal CLI now runs planning, role policy
and native memory through the upstream kernel. Immutable native-only deltas exclude
every hybrid run; ordinary rows are not paired training. Explicit same-packet
comparisons feed upstream Router only with five common inputs and full quality,
bound to runtime/lockfile, evaluator and policy. Only unpinned confirmed402 native
Sonnet/Sol selection adapts; DeepSeek defaults, pins and Opus repair remain fixed.
Upstream Flywheel producer uses actual isolated workflow evaluator, five selection
and five disjoint sealed tasks, per-case nonregression and distinct clean reruns.
Signed replay, live bindings, lineage and CAS guard activation/rollback; CLI consumes active policy.
Final ten-file ordinary join: 94/94; syntax checks pass. Synthetic tests prove contracts,
not live training, evolution, performance or resumption. Frozen history remains untouched.
Config/commands: harness README. ADR remains Proposed for wider programme claims.

Private Cargo `--target-dir target/engineering-delivery/builds/<allocation-id>` binds
allocation/profile/binary/compiler event; caller owns exclusivity. Concurrency unproved.

Ordinary `workflow --isolated true` now composes the existing workflow callbacks
with a non-Git candidate snapshot under `target/engineering-delivery/candidates`.
Source observation, admitted file reads, outside-scope checks, command cwd, logs,
artifact binding and evidence references use that same candidate root. Root-apply
requests and responses name the exact destination; candidate success remains
`pending-owner-acceptance`, not canonical integration. Failure output names the
retained candidate/evidence directory. No new scheduler or frozen G1 mechanism.
Snapshots copy current tracked/untracked source bytes and initialized submodule
files, including locally present submodules omitted by Git's active-recursion
listing. Dirty/untracked initialized submodules are rejected before/after copying;
parent Git dirty markers alone cannot bind their changing internal bytes.
Installed Node dependencies are explicitly shared inputs via symlinks, not a
hermetic or filesystem-enforced read-only sandbox. API mutation paths cannot
include them. Two real supported Node command checks pass in independent snapshot
roots with private logs; canonical source remains unchanged. This deterministic
isolation proof alone does not prove live model overlap or dependent release;
the later read-only proof below separately establishes its narrower claims.
Focused ordinary join: 71/71 tests pass, including real concurrent Node checks,
wrong-root application refusal and unchanged canonical-source assertions.

`src/ordinary-pool.mjs` imports declared `@claude-flow/cli` 3.47.0
`dist/src/services/bounded-worker-pool.js` (manifest `latest`, lock exact).
Leaf SHA256: `757824847c1b3a394f78441f84e519a0edcdf6731d39fdfcd7fb2ed37a00fce0`.
Adapter enforces path/resource exclusions, pre-abort checks, callback drain and
retained failure custody. Root supplies ready entries and integrates alone.
Earlier Node 24.14.1 join passed 77/77 with two workers, including overlapping
isolated fixture workflows, real Node checks and unchanged canonical source.
Fixture proof is separate from live read-only evidence below.

**Final repair and live parallel proof (`8264bd42`):** charged HTTP errors with
known generation/cost now retain accounting and hold only their task, without
credit fallback or global unknown-charge hold. Snapshots reject `.env/` directories
as well as files, and use locale-independent ordering. Regression proved red;
final root-invoked ordinary join passes 91/91, syntax/diff checks pass. A prior
package-directory invocation failed its root-relative child import; retained as
invocation error, not hidden or treated as a model defect.
Run `ad4e06a8-45b7-4d85-ace4-010a5a47cda3` used actual upstream pool with
two independent read-only DeepSeek reviews in distinct retained candidate roots.
Both ACCEPT; overlap 134476ms, cost $0.0380043. Result at
`target/engineering-delivery/parallel-review-ad4e06a8-45b7-4d85-ace4-010a5a47cda3/result.json`
has SHA256 `6fa7de94063021231bcf6e5cda8edc42fa944e09a6a65c9fec2fdee976392fc2`.
Source, packet and ledger hashes verify. Both children consume accepted `00de7854`
`ordinary-pool.mjs` bytes, SHA256 `f45d2a0a4c3cce11baed8bb41dd304a2b08d1f69912321c361baf8fc8ca13ee7`.
This proves live review overlap and accepted-source consumption, not concurrent
application authoring, automatic DAG release or heavy Rust/GCP performance.
Earlier rejected run `c04f0f92-959c-4bb2-ad32-e263dff2fedc` remains negative
($0.09844025); valid secret-path/sort findings fixed, unsupported requests to relax
strict nonexecution evidence rejected. No application outcome was promoted.
Read-only restart: both current routes/local preflights pass; ledger has six completed
requests, no unknown/task holds. Project MCP/application release remains unclaimed.

Dependency audit reports 35 findings (24 moderate, 10 high, one critical), not a
clean tree. Critical legacy `protobufjs` arrives through optional
`agentic-flow` / `@xenova/transformers` / ONNX dependencies; nonoptional `toml`
also has a high finding. Imported pool leaf has no imports; CLI/ML/parser surfaces
and install scripts are not executed by this integration. No blanket audit fix,
major override or optional-learning removal was applied. This scoped exposure
assessment does not certify unused surfaces or authorize public deployment.

Active README matches routing, optional direct execution and resource-based concurrency.
Four README-history files preserve earlier text and frozen obligations; no learning or
qualification feature removed. Exact pool paths are admitted for ordinary maintenance;
arbitrary siblings remain refused (35 focused tests pass).

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
tests pass; no global model cap. Native fallback review retains failed API accounting.

**Initial live repair accepted September 28:** production `workflow --spec`
run `4a032663-19f5-4ffc-9235-70cb3f744608`, task
`task-harness-parallel-hybrid-repair`, fixed async-iterator cleanup after a relay
observation failure. The new regression failed before repair. DeepSeek authored
the exact source patch, 66/66 ordinary tests passed, and a fresh DeepSeek reviewer
accepted it; no native fallback or separate planning stage was used. Actual cost
was $0.00851542 across generations `gen-1790555555-eRtXx7MKDFpCIBpf318K`
and `gen-1790555962-K64MTsuBrNNtofIf9x7Y`. Result
`target/engineering-delivery/workflow-D0tiaV/result.json` hashes to
`cc8701fd06174f33b2565e9c98dae1f7f3e47c7bcc38876ae2d0ddde561c028e`;
all local event/check references verified before integration. The result honestly
records unavailable project MCP, `mcpReadback: false`, and the preserved owner
hold. This proves one live ordinary workflow, not parallel programme readiness,
semantic qualification, cross-server deployment, or completion of this ADR.

This section supersedes conflicting September 26 proposals below. Those sections
remain historical source findings, not another executable checklist. Status remains
Proposed for remaining programme-wide claims; ordinary repair/proof above is implemented.
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

Findings below retain original dates and limits; Qwen/worktree/PR proposals are
historical. Use September 28 handoff above for execution.

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
5. **Historical concurrent-delivery proposal.** Current September 28 repair uses
   functional fixture tests only. Performance assessment is architecture-only;
   no benchmarks, timed comparisons, cloud or model calls are authorized by this
   repair. Engineering checks are not semantic qualification or release evidence.

Use direct work or the existing engineering workflow, preserving root acceptance
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
