# Oxigraph engineering harness

Current ordinary-development guide, updated 2026-09-29.
[AGENTS.md](../../AGENTS.md) and
[ADR-0049](../../docs/adr/0049-upstream-first-parallel-hybrid-delivery.md)
govern current models, ownership and proof status. This guide supersedes old
mandatory-harness, Claude-only and one-process instructions.

Direct application/harness implementation, repair, tests and builds are allowed.
Harness dispatch is optional. Keep orchestration and learning available; preserve
scoped checks, independent review, source/data isolation and one canonical
integrator. Latest September 29 goal continuation authorizes root-owned GCP
programme restart after local validation; this proof performs no cloud or Rust
programme actions. VM stays terminated until root restarts it; `a33301f33` G4.3
WIP remains preserved, not accepted.

## Configured subscription transport

Ordinary planning, implementation and fresh independent review default to native
`cc/claude-sonnet-5-5[1m]` / high through configured 9router. Explicit API task pins
remain supported, but are not defaults. Capability/output repair uses
native `cc/claude-opus-5-5[1m]` / high. Only confirmed nonexecuted HTTP402 credit
rejection permits lighter native Sonnet/Sol fallback, medium first.
Auth errors, unknown completion and local request-cost refusal are not fallback.
Native unavailability stops with exact client/model/error.

Both native hosts are allowed. Preserve configured subscription gateway settings;
API credentials stay only in isolated API adapter, never native/tool/verifier
children. Read `OPENROUTER_API_KEY` from environment; never print or commit it.
Request ceiling is $1; no cumulative task/session/programme ceiling.
Defaults: 131072 output tokens, high reasoning, `reasoning.exclude=true`,
1800000ms timeout, 2000000 response bytes, provider input/output ceilings
$0.50/$2 per million tokens. Hiding returned reasoning does not disable reasoning.

<a id="ordinary-delivery-use-for-every-programme-build-and-test"></a>

## Ordinary delivery

### Integrated task workflow

Run from canonical main on Node 24:

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs workflow --spec target/engineering-delivery/task-spec.json --isolated true
```

Specification declares task ID, harness/product scope, goal, completion check,
exact mutation paths and supported deterministic commands. Existing kernel/host
workflow obtains proposal, requests exact root application, checks candidate,
then requests fresh independent review. Failed checks/reviews feed same outcome's
repair; unchanged repeated source/failure stops for diagnosis.

Active host answers native/root-application bridge requests. API stages execute
through isolated direct adapter. Root-apply must acknowledge exact candidate root.
Result remains `pending-owner-acceptance`; only canonical owner integrates
verified source and releases source-dependent work. No automatic commit/push.

Reachable project Ruflo MCP supplies task/control reads and evidence store/readback.
If unavailable, harness-only repair may explicitly supply
`--coordination-unavailable REASON --owner-review-hold true`.
This records `mcpReadback:false`, never fabricates memory success or resumes
product work. CLI help lists exact bridge options.

### Ordinary policy and native learning

Normal workflow/batch automatically runs read-only planning, then author/check/review,
with seven-component policy context and native memory through the upstream kernel.
Optional `ordinary-runtime.json` in this directory (or `--runtime-config FILE`)
uses `{"schema":1,"memoryDirectory":"target/engineering-delivery/native-outcomes"}`.
Native immutable outcomes bind runtime/lockfile, actual evaluator and policy bytes.
Any attempted API stage excludes the whole hybrid run from native Router training.
Ordinary observations remain unpaired; only explicit integrator-owned `compare`
callbacks produce controlled equal-packet evidence. Five common inputs across all
eligible routes and full predicted quality are required for upstream Router choice.
Only unpinned confirmed402 Sonnet/Sol fallback adapts; Sonnet 5.5 defaults, explicit
pins and Opus repair stay unchanged. No latency claim or live training is implied.

`ordinary-policy.mjs` composes upstream Flywheel with injected proposer/evaluator
and signer; `ordinary-policy-evaluator.mjs` executes actual isolated workflows.
Promotion requires five selection and five disjoint sealed tasks, exact policy,
source/evaluator/runtime receipts, per-task nonregression and distinct clean sealed
reruns. Signed upstream replay plus project evidence is verified before activation.
Optional `policyActivation` config declares absolute private `directory`, pinned
`trustedPublicKey`, `bindings.tasks` and optional `rootPolicy`; default data source
is `OBSERVED`. `SYNTHETIC` evidence is fixture-only and cannot run product tasks.
`policy-activate --runtime-config FILE --envelope FILE --expected-parent SHA256`
updates policy under CAS lock; `policy-rollback --runtime-config FILE
--expected-current SHA256` restores signed predecessor. Next normal workflow reads
active policy automatically and rejects live source/evaluator/runtime drift for
signed tasks. Unlisted tasks use root policy and record `nonapplicable-task`;
global envelope trust remains mandatory, so tampering never triggers fallback.
Only synthetic functional tests exercised this path; no live evolution, activation,
benchmark or programme resumption occurred. Frozen qualification history is untouched.

<a id="native-serial-execution"></a>

### Parallel execution

Outer coordinator launch preview (never starts a model):

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs coordinator --session EXISTING_UUID
```

Append `--start true` only when authorized to resume that existing session and no
other writer owns it. Launch uses native Codex `gpt-6-astra` / medium with `--yolo`,
inherits configured subscription transport and guards canonical main. Preview does
not verify UUID existence, exclusive ownership or native availability. It does not
resume paused goals or authorize programme work merely by existing.

The native coordinator plans dependency-ready independent lanes, services the
existing batch bridge, reviews completed evidence, drains each batch, revalidates
candidate source/read/evaluator inputs, then integrates serially with canonical
checks/build and commits. Only accepted main source releases dependants. Refill
the next ready set after acceptance/failure; keep conflicts and unconfirmed
external-action custody across batches. No new scheduler or automatic acceptance.

Batch stdout now emits `lane-settled` records before the final batch result. Each
names a durable `lane-ID.json` receipt and SHA-256, task, status and unchanged
`pending-owner-acceptance` classification. This permits early inspection, not
concurrent main integration. Started cancelled/rejected lanes retain custody;
queued cancellations remain in final output. Library `onSettled` gets a detached
copy and must do only bounded local reporting; it is awaited before slot refill.
CLI reporter only writes local receipt/stdout. Observer failure is reported as
`lane-notification-failed` without changing actual workflow result or leaking the
observer error text; final batch output still retains all results and custody.

Normal ready-batch entrypoint (always isolated):

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs batch --spec target/engineering-delivery/ready-batch.json
```

JSON shape is `{"schema":1,"maxConcurrency":2,"entries":[{"id":"first","spec":WORKFLOW_SPEC,"resources":[]}]}`;
replace `WORKFLOW_SPEC` with a full workflow specification. Concurrency is chosen
for this ready set, not a standing session cap. Entry and task IDs must be unique.
Each spec retains existing live task/control authorization; batch creates no new
authorization. Harness-only unavailable-MCP options also work on `batch`.
For connected batches, owner-controlled
`programme-controls/oxigraph-six-hour-delivery-course-correction-v1` may declare
`readyHarnessTaskIds` or `readyDeliveryTaskIds`: distinct valid task-ID arrays,
separate by scope. An explicit array replaces that scope's legacy active ID;
`[]` revokes all admissions. Absent array preserves `activeHarnessTaskId` or
`activeDeliveryTaskId`. Every refresh still requires task status `in_progress`;
product work requires `ownerReviewHold.active:false`. Listing tasks does not
accept dependencies, clear a hold or resume a paused programme. Only owner may
authorize this ready set; CLI never writes programme controls.
Bridge replies echo both `runId` and `requestId`; replies may arrive out of order.
SIGINT/SIGTERM stops queued work, aborts API transport and rejects pending bridge
requests before draining callbacks. Result retains candidate pointers and lists
`externalActionsUnconfirmed`; ownership remains retained until owner confirms
external native/root actions stopped. Closing bridge does not kill external work.
Exit 0 means all candidates await owner review, never canonical acceptance.

Opt-in local native proof: `node tools/engineering-harness/test/support/prove-native-batch.mjs --run`.
It services this same bridge with real configured native Sonnet5.5 planning,
authoring and fresh review for two scoped harness regressions, records PIDs/timing,
and leaves canonical integration to owner. It is proof tooling, not a production
MCP bridge or scheduler. Requires current native-execution authority; no Rust/cloud
work. ADR-0049 pins successful overlap and separate accepted-source handoff evidence.

`src/ordinary-pool.mjs` exports `runOrdinaryBatch(entries, {maxConcurrency, signal})`.
Each entry supplies unique ID, validated workflow spec, host callback, optional
named resources and workflow options. It calls actual upstream Ruflo
`runBoundedPool`, not a second scheduler. Choose dependency-ready outcomes;
same/ancestor source paths and shared named resources reject before launch.

Candidate roots are non-Git copies under `target/engineering-delivery/candidates`.
Each has private checks/logs. Installed Node dependencies are shared symlinks,
not an OS-enforced read-only sandbox. Pool cancellation drains started work before
ownership release; failed/cancelled results retain candidate evidence paths.

No fixed model-session cap. Measure host capacity across sibling jobs; use supported
worker controls. Cargo allocations use distinct
`--target-dir target/engineering-delivery/builds/<allocation-id>`.
Keep DBs, ports and shared outputs exclusive. Integrate serially, then create
dependent candidate from accepted source; successful candidate alone releases none.

### Deterministic command runner

Direct commands are permitted. Optional recorded runner example:

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs run --task task-harness-check --check "Ordinary contracts pass" -- node --test --test-reporter=tap tools/engineering-harness/test/workflow.test.mjs tools/engineering-harness/test/delivery.test.mjs
```

Runner records actual command, source, output and nonzero test counts.
`command-passed` is not application acceptance. Frozen semantic qualification
under `tools/metaharness`, G1.7, protected state and publication retain their own
authority. Broad `npm test` includes separately governed surfaces; use focused
ordinary tests. Current ordinary runtime is Node 24; historical Node 20 receipts
remain historical, not an extra ordinary-development gate.

### Evidence write-up helpers

`tools/evidence/receipt-evidence.mjs` and `adr-prereview.mjs` can assist evidence
inspection. They are diagnostics, not compulsory ceremony or model execution.
Keep negative receipts and distinguish current source from historical live proof.
ADR-0049 records exact tests, live repair cost, missing proof and dependency risks.
The CLI dependency audit is not clean; importing its dependency-free pool leaf
does not certify unused CLI/ML/parser surfaces.

## Historical and frozen GPT-6 Astra routing

Original README preserved below, split at section boundaries. Historical ordinary
rules are superseded by this guide and AGENTS; frozen contract obligations remain
attached to their original artifacts. Archives are not programme-resumption
instructions or current readiness claims.

- [Historical ordinary guide](README-history-ordinary.md)
- [Frozen routing and early evaluator history](README-history-frozen.md)

### ADR-0036 C15 checkpoint — 2026-09-02

[Unchanged historical checkpoint and frozen command inventory](README-history-c15.md).

### ADR-0036 C16 checkpoint — 2026-09-02

[Unchanged historical checkpoint](README-history-c16-c21.md).

### ADR-0036 C17-C21 checkpoint — 2026-09-03

[Unchanged historical checkpoint](README-history-c16-c21.md#adr-0036-c17-c21-checkpoint--2026-09-03).
