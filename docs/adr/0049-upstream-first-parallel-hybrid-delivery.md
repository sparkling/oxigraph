# ADR-0049: Upstream-first parallel hybrid delivery

- **Status**: Proposed
- **Date**: 2026-09-26
- **Updated**: 2026-09-26
- **Deciders**:
- **Tags**: engineering, ruflo, metaharness, parallel-delivery, openrouter
- **Related**: ADR-0017, ADR-0043, ADR-0048

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
