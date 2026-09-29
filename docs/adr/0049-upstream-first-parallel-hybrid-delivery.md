# ADR-0049: Upstream-first parallel hybrid delivery
- **Status**: Proposed
- **Date**: 2026-09-26
- **Updated**: 2026-09-29
- **Deciders**:
- **Tags**: engineering, ruflo, metaharness, parallel-delivery, openrouter
- **Related**: ADR-0017, ADR-0043, ADR-0048

## September 29 ordinary routing and resumption amendment
September29 credit-route audit: future confirmed nonexecuted HTTP402 fallback uses Sonnet5.5/medium in both direct workflow default and learned candidate selection. Sol/medium, Opus capability repair, explicit pins and historical evidence stay unchanged. API/runtime join18/18 and syntax checks pass locally; cloud adoption remains separate.

GCP adoption (September 29, 16:12 UTC): sole owner fast-forwarded clean main from accepted application `154551eaf` to `5dbe4537d`, including `bfb4817ae`. Exact seven-path custody check preceded integration; active isolated Cargo commands and historical candidate pins stayed unchanged. Node 24.14.1 stream/host/API/runtime join passes 59/59, plus syntax checks. Log `target/engineering-delivery/redacted-progress-cloud-deploy-tests.log` SHA256 `3b557e0861559d055b3307195258f2494a2bf31058c4d861100d9afd3d4a2b38`.
Actual overlapping native calls use stream helper SHA256 `f3bbc5277cdfb39e23ac6ba9e240151009d372f9f34629ccc8afe71ba7fb20b1`: Opus repair `8bc64dff-c552-4306-96a3-80b9b94f976b` (PID 3531813) and Sonnet fresh review `78804faf-8d9d-4580-8a55-79c32835156f`, request 17 (PID 3531967). Both record advancing substantive activity and reset inactivity counters.
This is invocation/progress evidence, not completed application acceptance or live API-fallback proof. Earlier stalls and negative receipts remain unchanged; their uncaptured stream framing is not retrospectively inferred. Candidates still require current-source/read/evaluator revalidation before integration. No push, qualification, new scheduler or transport substitution. ADR remains Proposed.

### Ordinary native host stream repair (September 29)

Owner authorizes this bounded repair separately from the closed fixture-timeout rollout. The ignored GCP host driver
`target/engineering-delivery/native-request-20260929.mjs` previously accumulated buffered JSON/stdout/stderr without limits or inactivity
detection and forwarded signals only to its direct child. Frozen invocations and historical receipts stay unchanged. Snapshot/hash
attribution for the earlier 64.2s fixture remains unproven.

`src/native/ordinary-stream.mjs` supplies reusable ordinary-host streaming and process-group cancellation, without changing frozen native
workers, runtime watchdogs, routing, model pins, scheduler, learning or acceptance contracts. Tracked `src/native/ordinary-host.mjs`
reproduces the driver invocation, native environment, exact response validation, private receipts and redacted console progress. The ignored
driver delegates this seam rather than carrying its own spawn/capture/cancellation implementation. Claude uses `stream-json`, `--verbose`
and `--include-partial-messages` with the unchanged native child environment. Parsed nonempty text, thinking and structured input deltas,
genuine tool starts and matching tool results refresh activity; duplicate starts, unmatched results, tool-progress heartbeats, pings, stderr
and unrecognized bytes do not. September29 follow-up: redacted `thinking_delta` with positive safe-integer `estimated_tokens` refreshes
activity only inside an active indexed thinking block. Track at most1024 indices; message boundaries, block stop and replacement clear
eligibility. Estimates add no fabricated content bytes or reasoning to logs. Focused fake-process regressions cover sustained progress,
invalid/unframed estimates and boundary resets; independent source review found no blocker. Warn after 120s inactivity and cancel after
300s. TERM targets the dedicated process group; KILL follows after 1s, with a bounded 5s drain. Dead leader alone does not release custody;
unconfirmed descendants remain retained.

Each NDJSON record is bounded to 2 MiB. Only the terminal result is retained as stdout; stderr capture is limited to 64 KiB with full-stream
hash/count metadata. Tool correlation retains at most 4096 active IDs and 4096 recent completed IDs; overflow fails structurally, never
authorizes an accepted result. Private failed receipts/candidates stay available. Exclusive mode-0600 progress journals contain only
task/run/request/PID, timestamps, fixed event labels and counters, never prompts, reasoning, tool bodies or environment values. Body-free
progress is throttled to 5s and flushed durably; warnings/stalls also reach the existing driver console. SIGINT/SIGTERM/SIGHUP cancel and
drain. A host-exit guard best-effort kills an unsettled group without claiming reap or releasing custody. Stalls are local execution
failures, not subscription outages or completed proposals. No automatic retry. Only explicit native authentication/model/provider outage
diagnostics produce `unavailable`. Generic client errors, local signal exits, malformed/invalid results, structural output ceilings and
inactivity stalls retain separate local failure evidence. Native output-token errors retain the existing inconclusive capability result only
with a real native worker identity; no identity is invented.

The GCP driver switches only between invocations and records driver/helper hashes. Fake-process tests cover healthy
text/reasoning/structured deltas, heartbeat-only stall, warning reset, output bounds, UTF-8 chunks, duplicate terminal rejection,
TERM-resistant descendants, escaped-pipe retained custody, cancellation, host exit/SIGHUP, journal failure, private/console progress and
spawn failure. This slice does not implement remaining application outcomes or complete this ADR.

Validated on Node24.14.1: seven-file focused/impacted join84/84, syntax/import and diff checks pass. Actual fresh Sonnet5.5/high review
`fe9b6311-b8fb-4a1b-99d0-52913bd633cd` / worker `e7ae2708-ba2c-4521-b8cc-9fcc3b300dae` ACCEPT, response SHA256
`f7339a03279da0ddd8ef8dbcca6fcd0f32051c33b86eed5bc5908c91f5589673`. The tracked host adapter executed PID2686000 with outputLimit128000,
observed 360 substantive events and confirmed child/pipe/group completion. Driver SHA256
`0dd1e8ce8b83a95f68ae9711efcfc723aae5e7e99cb998f65cc90d8076b354df`; host helper
`3c2e9d70705d9b4d913931c02fdf3d56a096552388bc0f9f3c566fdeed7fbf01`; stream helper
`3c517fd41504ca5321f350134b3a9e92bcb3b36352398afdb86b59552d01bace`. Evidence:
`target/engineering-delivery/resume-native/fe9b6311-b8fb-4a1b-99d0-52913bd633cd-1/` and
`target/engineering-delivery/native-stream-attribution-join.log`. Prior rejected review and failed fixture-cleanup test remain negative
evidence. Live proof covers healthy stream/driver wiring; timeout, cancellation, tool events and outage distinctions have fake-process
proof, not forced live subscription failure. Container tests depend on orphan reaping; no cross-host parity claimed.

### Earlier September 29 implementation evidence

Redacted-progress follow-up: 41/41 stream/host tests and syntax checks pass locally; cloud rollout remains pending.

September29 early owner handoff implemented locally: coordinator no longer requires whole-batch drain before canonical integration.
Owner-invoked `assertOwnerActionIndependent` checks complete retained cross-batch paths, canonical reads, resources and external-action
custody; it is not automatic discovery, acceptance or a scheduler. Frozen snapshot reads survive unrelated canonical changes, while
unknown/live overlapping reads, shared dependencies and unconfirmed actions retain holds. Normal receipt/source/check/review validation,
serial canonical checks/build/commit and sole writer remain mandatory. Deterministic `ordinary-owner-handoff.test.mjs` uses actual upstream
pool and production snapshots in a disposable main fixture: parent settles, owner commits, child snapshots accepted source while sibling
remains running and its source observation stays unchanged. This is fixture proof, not native/GCP acceptance or hermetic isolation. Status
replies do not pause authorized service/refill; explicit pause wins, host blockers are reported, and whole authorized frontier replaces any
prior batch-size ceiling. Historical batch-drain proof below remains unchanged. Latest September 29 goal continuation authorizes root-owned
GCP programme restart after local validation; this local proof performs no cloud or Rust programme actions. VM remains TERMINATED until root
restarts it. Cloud `a33301f33` G4.3 WIP is preserved, not accepted. Ordinary planner/author/fresh review remain native
`cc/claude-sonnet-5-5[1m]` / high via 9router; explicit pins, Opus repair, Codex coordinator, isolation and learning remain. September29
output-ceiling slice implemented: native Claude environment requests `CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000` unless a positive safe-integer
operator override is present. Actual Claude invocation validation and coordinator bridge contract use this helper; Codex/API/effort/thinking
unchanged. This is a requested output ceiling, not a generation target or usage cap; native client/model clamping still applies. Sources:
https://platform.claude.com/docs/en/about-claude/models/overview and https://code.claude.com/docs/en/env-vars . Three earlier routing
regressions failed on old defaults; final ten-file ordinary join passed98/98 with native-learning proof; API fixtures explicitly pin
transport. GCP native smoke session `99dbee2f-07ec-4795-98ba-49d04f895988` returned `OXIGRAPH_SONNET_55_READY`, canonical model
`claude-sonnet-5-5`; harmless alias warning and failing obsolete session-end hook remain diagnostics. New defaults supersede historical
routing, never qualification/publication boundaries. Historical receipts remain unchanged; wider ADR stays Proposed. Coordinator
preview/explicit resume wires Astra/medium to existing ready batch/isolated workflow: inspect detached durable lane-settled receipts early,
drain batch, serially revalidate/integrate, release accepted-source dependants and refill. Earlier Node24: 39/39 focused plus 54/54 impacted
tests and independent root review passed. Latest native proof uses existing batch JSON-line bridge, not a new scheduler: `node
tools/engineering-harness/test/support/prove-native-batch.mjs --run`. Six Sonnet5.5/high calls completed (two plans/authors/fresh reviews);
author PIDs1083629/1087813 overlapped17307ms. Exact proof `target/engineering-delivery/native-batch-proof-KU0o0y/proof.json` SHA256
`6745888c1cfeae142eeb1089f726b91e2e78eb8144753f2237d2fb4eca8e17c3`; batch `workflow-M9ajGr`, two candidate checks10/9 pass,10 receipt hashes
verified, canonical unchanged, native learning retained. Host idle71.7/71.2/77.4%, memory/I/O PSI0. Scoped MCP unavailable mode was
harness-only; no application acceptance or connected control proof. Canonical six-file join41/41 and syntax/diff checks accepted exact
native regressions at `54780209bc52194e1b6828fde1f54cd74babcc78`. Fresh ordinary snapshot `source-eswHGl` consumed both accepted file
hashes; read-only Sonnet5.5/high PID1465047/session `73a269f1-9b70-4ffd-926c-a219f3a85edf` ACCEPT. Handoff
`target/engineering-delivery/accepted-source-review-z9dL5H/proof.json` SHA256
`daa235fd4fdc3d9cc2a850f46c7afb57122328143a48f7a686da70e98e3c46e6`. This proves native author overlap and accepted-main source consumption,
not automatic DAG release, autonomous acceptance/refill, hermetic dependencies or Rust/GCP performance. Builder dispatch likewise holds
candidates awaiting integration; Query shares upstream bounded callbacks and additionally excludes overlapping in-process pools. Oxigraph
cross-batch ownership remains native coordinator responsibility. Following September28 evidence is historical. **September 28 ordinary
entrypoint repair:** `oxigraph-delivery.mjs batch --spec` now calls the existing upstream pool with isolated workflow specs. Strict JSON
admission, unique entry/task IDs, source/resource exclusions, run/request bridge multiplexing and cancellation drain preserve candidate
custody and owner acceptance. Cancellation/bridge failure retains unconfirmed external-action ownership. Functional CLI fixtures rendezvous
two authors, reply out of order and run real Node checks in distinct candidate roots; final nine-file join passes 91/91 on Node 24.14.1,
plus syntax checks. No live models or performance benchmarks. Connected control accepts owner-set
`readyHarnessTaskIds`/`readyDeliveryTaskIds`; present arrays replace legacy scope IDs, empty revokes all, absent preserves legacy. IDs must
be unique/valid; task remains `in_progress`, product owner hold still gates. Checks refresh before stages; no live control was changed or
programme resumed. **Ordinary control-plane/learning slice:** normal CLI now runs planning, role policy and native memory through the
upstream kernel. Immutable native-only deltas exclude every hybrid run; ordinary rows are not paired training. Explicit same-packet
comparisons feed upstream Router only with five common inputs and full quality, bound to runtime/lockfile, evaluator and policy. Only
unpinned confirmed402 native Sonnet/Sol selection adapts; DeepSeek defaults, pins and Opus repair remain fixed. Upstream Flywheel producer
uses actual isolated workflow evaluator, five selection and five disjoint sealed tasks, per-case nonregression and distinct clean reruns.
Signed replay, live bindings, lineage and CAS guard activation/rollback; CLI consumes active policy. Final ten-file ordinary join: 94/94;
syntax checks pass. Synthetic tests prove contracts, not live training, evolution, performance or resumption. Frozen history remains
untouched. Unlisted tasks use root policy, recording nonapplicability; signed-task drift/tampering rejects. Wider ADR remains Proposed.

Private Cargo allocation/profile/binary/compiler evidence uses `--target-dir target/engineering-delivery/builds/<allocation-id>`; caller
owns exclusivity, concurrency unproved.

Ordinary `workflow --isolated true` now composes the existing workflow callbacks with a non-Git candidate snapshot under
`target/engineering-delivery/candidates`. Source observation, admitted file reads, outside-scope checks, command cwd, logs, artifact binding
and evidence references use that same candidate root. Root-apply requests and responses name the exact destination; candidate success
remains `pending-owner-acceptance`, not canonical integration. Failure output names the retained candidate/evidence directory, including
snapshot copy/drift and workflow-directory setup failures. Regression proved lost custody pointers; original error/cause and root now
survive logging failure too. Sole owner integrates/completes; no automatic release or sibling-candidate invalidation. Snapshots copy current
tracked/untracked source bytes and initialized submodule files, including locally present submodules omitted by Git's active-recursion
listing. Dirty/untracked initialized submodules are rejected before/after copying; parent Git dirty markers alone cannot bind their changing
internal bytes. Installed Node dependencies are explicitly shared inputs via symlinks, not a hermetic or filesystem-enforced read-only
sandbox. API mutation paths cannot include them. Two real supported Node command checks pass in independent snapshot roots with private
logs; canonical source remains unchanged. This deterministic isolation proof alone does not prove live model overlap or dependent release;
the later read-only proof below separately establishes its narrower claims. Earlier ordinary join: 71/71, including concurrent Node checks,
wrong-root refusal and unchanged canonical source.

`src/ordinary-pool.mjs` imports declared `@claude-flow/cli` 3.47.0 `dist/src/services/bounded-worker-pool.js` (manifest `latest`, lock
exact). Leaf SHA256: `757824847c1b3a394f78441f84e519a0edcdf6731d39fdfcd7fb2ed37a00fce0`. Adapter enforces path/resource exclusions,
pre-abort checks, callback drain and retained failure custody. Root supplies ready entries and integrates alone. Earlier Node 24.14.1 join
passed 77/77 with two workers, including overlapping isolated fixture workflows, real Node checks and unchanged canonical source. Fixture
proof is separate from live read-only evidence below.

**Final repair and live parallel proof (`8264bd42`):** charged HTTP errors with known generation/cost now retain accounting and hold only
their task, without credit fallback or global unknown-charge hold. Snapshots reject `.env/` directories as well as files, and use
locale-independent ordering. Regression proved red; final root-invoked ordinary join passes 91/91, syntax/diff checks pass. A prior
package-directory invocation failed its root-relative child import; retained as invocation error, not hidden or treated as a model defect.
Earlier upstream-pool run `ad4e06a8-45b7-4d85-ace4-010a5a47cda3`: two isolated read-only DeepSeek reviews ACCEPT; overlap 134476ms, cost
$0.0380043. `target/engineering-delivery/parallel-review-ad4e06a8-45b7-4d85-ace4-010a5a47cda3/result.json` SHA256
`6fa7de94063021231bcf6e5cda8edc42fa944e09a6a65c9fec2fdee976392fc2`; source/packet/ledger verified. Both consume accepted `00de7854` pool
bytes `f45d2a0a4c3cce11baed8bb41dd304a2b08d1f69912321c361baf8fc8ca13ee7`. This proves review overlap/source consumption, not parallel
authoring, automatic DAG release or Rust/GCP performance. Rejected `c04f0f92-959c-4bb2-ad32-e263dff2fedc` ($0.09844025) retained;
secret/sort defects fixed, nonexecution safeguards retained. Historical restart had six completed requests/no holds. No application outcome,
MCP completion or release claimed.

Dependency audit reports 35 findings (24 moderate, 10 high, one critical), not a clean tree. Critical legacy `protobufjs` arrives through
optional `agentic-flow` / `@xenova/transformers` / ONNX dependencies; nonoptional `toml` also has a high finding. Imported pool leaf has no
imports; CLI/ML/parser surfaces and install scripts are not executed by this integration. No blanket audit fix, major override or
optional-learning removal was applied. This scoped exposure assessment does not certify unused surfaces or authorize public deployment.

Active README matches routing, optional direct execution and resource-based concurrency. Four README-history files preserve earlier text and
frozen obligations; no learning or qualification feature removed. Exact pool paths are admitted for ordinary maintenance; arbitrary siblings
remain refused (35 focused tests pass).

Ordinary harness repair may explicitly record unavailable project MCP and known owner-review hold state. Local source/check/review
references remain mandatory; the result reports `mcpReadback: false`, never fabricated coordination success. This exception cannot resume
product work or bypass reachable MCP refusals. The existing workflow CLI exposes this operational declaration; normal connected work retains
live control reads and exact store/readback. Focused contracts pass. Per-request reservation records now bind process PID plus boot/start
identity; live calls may overlap, while dead/reused/unknown ownership or unreadable records blocks new dispatch as unknown charge. Exclusive
initial publication and atomic terminal writes avoid partial-read races. Concurrent-adapter and live-child/crash tests pass; no global model
cap. Native fallback review retains failed API accounting.

**Initial live repair accepted September 28:** production `workflow --spec` run `4a032663-19f5-4ffc-9235-70cb3f744608`, task
`task-harness-parallel-hybrid-repair`, fixed async-iterator cleanup after a relay observation failure. The new regression failed before
repair. DeepSeek authored the exact source patch, 66/66 ordinary tests passed, and a fresh DeepSeek reviewer accepted it; no native fallback
or separate planning stage was used. Actual cost was $0.00851542 across generations `gen-1790555555-eRtXx7MKDFpCIBpf318K` and
`gen-1790555962-K64MTsuBrNNtofIf9x7Y`. Result `target/engineering-delivery/workflow-D0tiaV/result.json` hashes to
`cc8701fd06174f33b2565e9c98dae1f7f3e47c7bcc38876ae2d0ddde561c028e`; all local event/check references verified before integration. The result
honestly records unavailable project MCP, `mcpReadback: false`, and the preserved owner hold. This proves one live ordinary workflow, not
parallel programme readiness, semantic qualification, cross-server deployment, or completion of this ADR.

Latest live negative `e5f6313d-9dfd-41aa-91f0-de36d741bf55`: invalid DeepSeek plan ($0.00066232452), Opus/high ACCEPT with findings rejected
by unchanged validator; raw native output retained. Prompt rule omission fixed in `699bdef6` (44 tests). Host `/proc` reply delivery failed
separately; operator failure, not model defect. Evidence:
`target/engineering-delivery/live-control-proof-db79e990-fe50-4905-a425-551a87fbbf1b`. Same-task repaired run
`fd20f441-e47a-436b-8b37-432a9af72b67`: Opus/high plan, DeepSeek author/reviewer ACCEPT, 6 real tests. Receipt
`target/engineering-delivery/workflow-DAbanz/result.json`, SHA256 `e60794ec624cde4a02ea5246ded3107c6f0975a89216d175337b35d91127d836`; five
references verified. API success cost $0.004240577; prior negative/plan hold retained, no unknown charges. Hybrid native-learning exclusion
verified. Root accepted exact ten-line duplicate-ID test; final ordinary join 96/96, syntax/diff pass. Read-only restart admission passes.
Host samples 69-74% idle, memory/I/O PSI zero. No parallel author pair, application resumption, promotion, cloud or publication.

This section supersedes conflicting September 26 proposals below. Those sections remain historical source findings, not another executable
checklist. Status remains Proposed for remaining programme-wide claims; ordinary repair/proof above is implemented. Owner authorized
matching Builder models/limits and removal of stale Claude-only, no-API, fixed-session and mandatory harness-only rules on September 28.
Policy reconciliation is authorized now; runtime activation still requires implementation and proof. No publication or application programme
resumption follows.

### Finish criteria and scope discipline

Compose upstream tools with thin project adapters, not a second framework. Preserve working acceptance, parallelism and learning. Do not
copy Builder's entire private runtime, add a scheduler/service, regenerate a working harness, or install unused packages. Before changing a
seam, show its actual local defect or missing contract; reuse the existing implementation when it already satisfies the contract. Keep one
task/outcome through repair; no new task, calibration, inventory or repin for each finding. Focused regression, independent review and
impacted build once per coherent slice; broader join at acceptance, not between every small repair. Direct application and harness
implementation, repair, tests and builds are authorized; harness dispatch is not compulsory. Retain orchestration and learning as useful
execution paths, not gates on direct work. Preserve scoped checks, independent review, source/data isolation and one integration writer.
Direct edits never inherit old worker acceptance receipts or manufacture runner evidence.

Completion means: configured routes work, deterministic checks and independent review pass, failure/repair and source-handoff contracts are
proved, and restart admission passes without starting the programme. Successful cheap/frontier cascade counts as success. Perfect
DeepSeek-only execution, model bake-offs, highest harness score, a PR system, or new evolution benchmarks are NOT completion gates.
Preserve/exclude pre-existing managed helper files. Concurrent updates are expected only where owner-confirmed; never absorb them into
scoped harness commits. Unexpected owned source changes still require reconciliation.

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

Builder inspected pool versions 3.38.20 locally and 3.45.0 on GCP, not this repo. Its pre-aborted signal may still start callbacks; timeout
can return before a noncooperative callback stops. Check cancellation before dispatch and retain resource ownership until child termination
is observed. Verify on the intended server before claiming deployment parity. Existing supported pool may be retained if equivalent. Keep
remote inference concurrency separate from Cargo/.NET/Node job workers. Sample effective CPU, interval utilization, memory and I/O pressure
before heavy work, every 30 seconds and at refill; account for all jobs on that host. Use supported worker controls, isolated
targets/DBs/ports; do not invent CPU-based model-session caps.

Inventory factory/kernel, Router, Darwin/GEPA, AVO/Flywheel, AgenticOW and QE only where present or required by accepted local decisions:
label installed, configured, operational and deferred separately. Reuse existing hooks/adapters rather than local substitutes. Preserve
ordinary outcome capture and learned policy reduction; promotion still needs real evaluator and held-out proof. Missing optional promotion
evidence neither strips learning nor blocks delivery, and does not authorize a new evolution campaign.

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

Read Builder ADR-0051/0053 updated September 28 and ADR-0054 R8, then inspect donor diffs rather than cherry-picking across unrelated
runtimes: `cf00eb06b` progress/cancellation and maintenance-authoring amendment; `3430c6365` shared review/file-policy
evidence/unchanged-repair stop; `803cff426` production-context reviewer qualification; `e759396a6` confirmed-credit Sonnet/Sol fallback;
`fa82f77fa` shared planner and completed-proposal diagnostics; `701ea878b` task-scoped holds and fixed finish criteria. Donor path prefix:
`src/tools/application-development-harness/src/`; inspect `native-worker-contracts-v1.ts`, `control-plane-review-v1.ts` (if renamed, follow
`ordinaryReviewAgentV1`), `native-model-invocation-v1.ts`, `hybrid-worker-implementation-v1.ts`, `hybrid-suspension-v1.ts`,
`hybrid-credit-fallback-v1.ts`, and qualification/runtime adapters.

Builder live `deepseek-full-cascade-live-20260927-r2` passed in 236410ms: DeepSeek plan, rejected implementation, Opus repair, DeepSeek
approval; all verifiers passed, API cost $0.02369829258. Receipt `sha256:9f7324f0d77de7b0622e788a96a2e783f56f4f997c9d8455f34df58a3be8729e`
verifies; final scoped regression was 181 tests/build/restart audit. This proves Builder cascade, not sibling adoption or perfect DeepSeek
authorship. Upstream ADR-127 (Accepted June 18) uses exact search/replace sentinel blocks; Builder uses JSON edits. Keep safe exact
matching; neither transport is proof of model correctness. Do not blame JSON without captured evidence.

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

Rechecked clean main `4d57ddfe51136bd87b86c16ae90bee23a011c260`. This is policy-bearing `sparkling/oxigraph` fork. Ordinary engineering is
not semantic qualification: preserve RDF/SPARQL/storage oracles, pinned specifications, G1.7 state and `tools/metaharness` boundary. No
rebaseline or qualification run.

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

Findings below retain original dates and limits; Qwen/worktree/PR proposals are historical. Use September 28 handoff above for execution.

## Purpose and authority

Adapt ordinary engineering delivery for independent concurrent outcomes, isolated source/build/database state and exact reviewed
integration. Preserve Oxigraph's semantic qualification and protected evidence boundaries. This is a repair plan, not implementation,
qualification, publication or permission to resume held work.

The requested target is Node 24, direct OpenRouter `deepseek/deepseek-v4.1-flash` authoring, independent `qwen/qwen3-235b-a22b-2507` review
and native subscription escalation through configured routes. Metered requests must have a verified maximum of $1 each, with no cumulative
spending cap. Native subscriptions have no cost, token, invocation, request or quota budgets. Select useful model concurrency from ready
dependencies and measured resource pressure, without a fixed model-session cap. The requested source workflow uses task branches/worktrees
and reviewed PRs with one integration owner.

Current `AGENTS.md:5` explicitly caps both model processes and harness commands at one; `AGENTS.md:23` selects Claude-only execution, and
`AGENTS.md:95` forbids OpenRouter. Personal main-only instructions also conflict with the requested worktree workflow. These are policy
repair prerequisites, not reasons to discard the target. Reconcile governing instructions explicitly before any worktree, concurrent
implementation or new transport is activated. This proposed ADR does not silently lift those restrictions or alter existing frozen
qualification.

## Exact local baseline and evidence limits

Inspected `/home/claude/src/hm/oxigraph` on canonical `main`, clean at `d9512b01a6781a18b7c2765c953489f380b2c982`, on 2026-09-26. Origin is
`https://github.com/sparkling/oxigraph.git`: this review concerns that policy-bearing fork, not `oxigraph/oxigraph` upstream. Local Node is
`v24.14.1`. Installed `tools/engineering-harness/node_modules` contains `@metaharness/harness` 0.2.0 and `@metaharness/router` 0.4.0;
`@claude-flow/codex` is absent from that package location, not proven absent host-wide. The package engine remains `>=20`.

ADR-0017 is Implemented, dated 2026-08-24, updated 2026-09-10. ADR-0043 is Implemented, dated 2026-09-07, updated 2026-09-22. ADR-0048 is
Implemented, dated 2026-09-24, updated 2026-09-25; it deliberately removed contributor fan-out under the then-current serial policy. That
implementation is not a concurrency defect against its original contract, but must change for this new target.

Evidence is local source/package inspection only. No GCP server was inspected, and no build, model invocation, qualification, live database
or concurrency trial ran. No Oxigraph-scoped Ruflo MCP connection is available in this session; Builder project memory must not store fork
facts. ADR graph registration awaits the correct project connection. Cross-project user memory was searched and the exact phase-gating
pattern retrieved; historical native-only policy in memory does not override the requested hybrid target.

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

No `.agents/config.toml` or `.codex/config.toml` exists at the inspected repository root, and active ordinary delivery does not call Ruflo's
swarm configuration loader. The missing integration is not solved by adding an inert config file. There is also no demonstrated ordinary
cross-process resource admission or branch-to-PR-to-dependent-source handoff in these entrypoints.

The whole-checkout observation binds tracked diff, status and untracked files. Independent writers sharing main would invalidate one another
even with disjoint mutation paths. Keep one integration writer and isolate candidate observations.

## Upstream reuse, with actual limits

Brain retrieval on 2026-09-26 returned Ruflo `v3/@claude-flow/codex/src/dual-mode/cli.ts` and `tests/dual-mode.test.ts`. The fuller source
audit in Builder ADR-0054 pins Ruflo `a91db6768ba5e8c9e31c840ad25c1c96478f3f0f` and MetaHarness `7bffe2f58ee72c367cea07beb62ee00fc2bee755`.
No installed/export parity or GCP execution follows from those pins.

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

The pinned dual-mode worker interface supports native Claude/Codex, not direct OpenRouter. Its CLI-backed memory bootstrap also conflicts
with MCP-only memory. Resolve those actual adapter gaps before selecting it as the effective executor; do not invent an OpenRouter platform
value, bypass MCP, or copy a sibling's private runtime. Native Workflow APIs are another reuse candidate only after their availability in
the installed client is demonstrated.

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

Use direct work or the existing engineering workflow, preserving root acceptance and incremental verified commits. Required source fixes
belong to the same bounded outcome; no new task per defect, replacement scheduler, benchmark programme or evolution loop is needed. Replay
old records without rewriting them as evidence for the new policy.

## Consequences

The target gains useful parallelism without discarding existing exact-source checks or confusing engineering with semantic truth. Real
migration costs are workspace context, API/MCP integration and resource ownership. Upstream batches and fork-specific evidence restrictions
remain visible limitations. Current application holds and protected runtime state remain intact.

## Links

- [Ordinary harness repair](0048-ordinary-engineering-harness-repair-and-learning.md)
- [Proportional delivery](0043-delivery-recovery-and-proportional-release-boundary.md)
- [Engineering and qualification boundaries](0017-repository-evolution-and-evidence-promotion-harness.md)
- Cross-project source audit: `semantic-builder/docs/adr/ADR-0054-upstream-first-parallel-harness-execution.md`.

[orchestrator]: https://github.com/ruvnet/ruflo/blob/a91db6768ba5e8c9e31c840ad25c1c96478f3f0f/v3/@claude-flow/codex/src/dual-mode/orchestrator.ts
[worktrees]: https://github.com/ruvnet/ruflo/blob/a91db6768ba5e8c9e31c840ad25c1c96478f3f0f/v3/@claude-flow/codex/src/worktrees/coordinator.ts
[kernel]: https://github.com/ruvnet/agent-harness-generator/blob/7bffe2f58ee72c367cea07beb62ee00fc2bee755/packages/harness/src/kernel.ts
