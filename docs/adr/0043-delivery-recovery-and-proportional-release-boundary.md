# ADR-0043: Delivery recovery and proportional release boundary

- **Status**: Implemented
- **Date**: 2026-09-07
- Updated: 2026-09-22
- Latest amendment: restore Claude-only ordinary delivery via 9router; preserve historical execution identities.
- Deciders: Oxigraph parity programme
- Implementation status: R1 source handoff `aa7128bb` is delivered. Ordinary
  product work follows the implemented native-host workflow below; the wider
  programme remains open. Current requirements and evidence are maintained in
  [the delivery gates](../plans/oxigraph-delivery-gates.md), with the former
  implementation narrative preserved in
  [delivery history](../plans/oxigraph-delivery-history-2026-09-11.md#former-adr-0043-implementation-status-narrative)
- Programme task: `task-1788770182100-hyaa2v`
- Six-hour review control:
  `programme-controls/oxigraph-six-hour-delivery-course-correction-v1`
- **Amends**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)
- **Related**:
  [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md),
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md),
  [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md),
  [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md),
  [ADR-0038 — Native containment manager, guardian, and launch trampoline](0038-native-containment-manager-guardian-and-trampoline.md),
  [ADR-0039 — Delegated-host containment qualification and readiness](0039-delegated-host-containment-qualification-and-readiness.md),
  [ADR-0040 — Commit-capable containment decision and application-output release](0040-commit-capable-containment-decision-and-output-release.md),
  [ADR-0041 — G1.7 private co-located build issuer and physical owner chain](0041-g17-private-co-located-build-issuer.md),
  [ADR-0042 — Retain RocksDB and gate replacement-backend experiments](0042-retain-rocksdb-and-gate-replacement-backend-experiments.md)

## Context

The programme delivered the backend-neutral transactional write seam on
2026-08-24 in `1da47285`; it is already an ancestor of published `origin/main`
`2b9c8917`. The subsequent programme did not stop at that releasable boundary.
It expanded the engineering and qualification machinery while presenting that
work as a prerequisite for the already-implemented application behavior.

The 2026-09-07 delivery audit found:

- 508 commits since 2026-08-24;
- 358 commits classified as harness or qualification work and 56 as product or
  upstream work by the recorded exclusive-subject heuristic;
- 348,196 harness additions versus 30,208 product/other additions relative to
  `origin/main`, so harness code comprised about 92% of code-only additions;
- 420 Ruflo task rows, including 11 still marked in progress before recovery;
- a directly tested write seam that already passed its focused transaction and
  topology tests.

The follow-up adversarial audit at `ff17dc17` counted 495 first-parent commits
since August 24: 355 touched harness paths, 72 touched product paths, and 291
touched only harness paths. The first two categories overlap. These are churn
and code-growth measurements, not elapsed effort, billing, or model-quality
measurements; they cannot establish a numerical breach of the 20% effort cap.

The dependency chain nevertheless contradicted ADR-0004's product-first rule
and the Semantic Builder handover instruction not to spend another programme
phase rebuilding evidence infrastructure. It made task counts, evaluator
generations, and receipts look like delivery even when no new application
capability resulted.

The programme owner therefore stopped the evaluator-first path and directed a
timely application delivery recovery.

## Decision

### 1. Define the current release boundary as R1

R1 consists of exactly:

1. the already-implemented ADR-0016 backend-neutral transactional write API;
2. the current audited upstream product delta, upstream `7ce152a1`, integrated
   locally as `eb0f0cc2`;
3. preservation of the fork's SPARQL version policy, dataset topology, and
   RDF-merge blank-node semantics;
4. affected native, conformance, language-binding, and fuzz validation;
5. truthful README, ADR, programme-plan, Ruflo-ledger, and programme-Gist state;
6. a reproducible submodule graph;
7. an identified release binary and a passing persistent write/query/rollback/
   restart demonstration; and
8. authorized commits and publication to `main` with usable fork installation
   instructions.

A release hold is a failed gate, never an alternative way to complete R1.

No other feature is an R1 prerequisite unless a failing product test or a
named release requirement proves that it is.

### 2. Keep the containment programme, but remove it from the R1 critical path

ADRs 0034 through 0041 remain Proposed. Their implemented authority-null and
dormant slices, frozen evidence, and historical task state are preserved.
Their internal dependency chain remains relevant if that programme is
separately resumed.

They do not gate R1, ordinary product implementation, or a future G2 product
slice. In particular, G1.7 physical benchmark ownership, delegated-host
qualification, commit-capable containment, Dream Machine orchestration,
GEPA/AVO evolution, and provider-backed qualification require a separately
activated task and the authority already required by their own ADRs.

This ADR does not accept, implement, supersede, or delete those proposed
designs. It supersedes only claims that their completion is required before R1
or ordinary application work may proceed.

### 3. Treat linked-data breadth as a roadmap, not one release

The Jena and RDF4J gap catalogue remains useful research. ADR-0018 and
ADR-0020 through ADR-0033 remain the architecture backlog for transactions,
metadata/change delivery, SHACL, operations, indexing, federation, service
security, workload control, migrations, RDF4J interoperability, repository
lifecycle, incremental inference, and analytical execution.

R1 does not promise that entire portfolio. A roadmap item becomes active only
with a named outcome, acceptance tests, and an assigned delivery slice.

### 4. Restore direct product evidence as progress authority

For an application slice, progress means at least one of:

- callable product behavior changes and a focused regression passes;
- an upstream product delta is integrated and its semantic differences are
  resolved;
- a release blocker is removed with reproducible evidence.

Documentation may close a specifically named release-documentation gate once.
It is reported separately from product behavior; repeated document, task,
receipt, or score updates cannot satisfy the recurring product-progress check.

Task rows, plans, evaluator scaffolding, generated receipts, model routing,
swarm size, and review volume are supporting evidence, not delivery by
themselves.

### 5. Bound process work

- Keep at most three active delivery tasks and one writer on `main`.
- Use read-only parallel reviewers only for independent, bounded questions.
- Work directly on `main`; do not create feature branches or worktrees.
- Freeze new harness dependencies, evaluator generations, and qualification
  surfaces during R1.
- Apply ADR-0004's maximum 20% harness effort and two-hour review trigger.
- After two evaluator defects for the same slice, stop repairing the evaluator
  chain and use the smallest native product/conformance test that can decide
  the behavior, or redesign the slice.
- Classify failures before choosing repairs: product behavior, compiler/build,
  dependency/publication, optional evaluator, or unavailable host. A stale
  historical qualification subject is not an application build failure.
- Report completion by explicit gates rather than unsupported clock estimates.

### 6. Use proportional release gates

The R1 product delta changes SPARQL evaluation, RocksDB iteration, tests, and
JavaScript/Python binding fixtures. Its required gates are therefore:

- Rust formatting and staged-diff integrity;
- affected `spareval` and `oxigraph` tests, including transactional writes,
  graph topology, merged-default semantics, and SPARQL version policy;
- the pinned Oxigraph SPARQL conformance lane;
- the affected JavaScript and Python binding tests;
- the required `spareval` query/update fuzz targets for 60 seconds each; and
- `cargo build --locked --release -p oxigraph-cli --bin oxigraph`, identification
  of the resulting binary, and a loopback persistent-store demonstration of
  successful multi-operation update, query, failed-request rollback, empty
  named-graph lifecycle, and persistence after process restart.

Full MetaHarness qualification, G1.7, live containment, provider-backed runs,
Jena differentials, mutation campaigns, and broad performance claims are not
R1 gates. They may support only the exact claim for which they are separately
authorized and run.

### 7. Preserve merged-default semantics across backends

The upstream `7ce152a1` optimization is adopted with fork constraints:

- a union-default dataset is the RDF set union of named graphs only; it does
  not include the physical default graph;
- explicit `FROM` and `USING` RDF merges retain source-graph provenance so
  blank nodes can be standardized apart by source graph; and
- optimized RocksDB reads pass the same SPARQL-version term validation as the
  generic and in-memory paths.

The two RocksDB-specific regressions in `eb0f0cc2` make backend divergence a
release failure rather than an implementation detail.

### 8. Review course every six hours across programme milestones

Each review examines commits, scoped diffs, newly closed test gates, failures,
and separately reported product and supporting work from the preceding six
hours. Do not infer effort percentages from Git counts. If no
delivery artifact or gate closed, the current auxiliary activity stops and the
next product-critical action becomes active.

The review policy and its verified installation receipt are stored in Ruflo
memory under the key named above. The programme owner explicitly authorized an
external scheduler after the native Codex CLI boundary was confirmed. A
user-level `systemd` timer was configured for `00:00`, `06:00`, `12:00`, and `18:00`
Europe/Berlin and invokes native `codex queue` for this exact persisted thread.
The queued turn must use live structured Ruflo MCP tools to retrieve task and
memory state, dispatch a read-only audit worker, and validate both the exact
worker record and daemon run counter before accepting the audit result.

The [scheduled prompt](../plans/oxigraph-six-hour-delivery-review-prompt.md)
was revised to v3 on 2026-09-07 after the adversarial delivery audit. It names
the active product milestone, bounds the review to ten minutes and audit observation
to sixty seconds, separates new product behavior and closed release gates from
supporting work, and requires implementation after every review. Audit or
memory failures are reported without starting another harness-repair cycle.
An unresolved release hold is not completion. Once every R1 delivery gate is
verified, the next authorized product slice becomes active and the timer
continues. Disable it only when the agreed programme is complete or the owner
asks to stop. A timer or audit-tool failure is not itself a product release gate.
The installed service message must match the versioned prompt after whitespace
normalization. These bounds govern review overhead, not product execution or
subscription usage.

The timer and service are
`~/.config/systemd/user/oxigraph-programme-review.timer` and
`~/.config/systemd/user/oxigraph-programme-review.service`. The unit files pass
`systemd-analyze --user verify`; at installation the timer was enabled and active, and a manual
service start returned exit status zero after native Codex queued message
`01a07b60-8e18-7ab1-acc3-b7c266c13229` into the intended thread. Separately,
the natural 2026-09-07 18:00 Europe/Berlin firing is verified by the timer's
LastTrigger and service journal: native Codex queued
`01a07c99-0e38-71d0-95d9-25b5216aae8a` into that thread and the service exited
successfully. This closes timer-firing verification once; it is not product
behavior or proof of completion of the queued delivery work.

Ruflo worker validation exposed a narrower defect: the enabled audit worker's
daemon counter advanced from 1951 to 1952, but `hooks_worker_status` left the
exact dispatched record pending. The stale record was cancelled. Scheduled
reviews must surface that mismatch and must not treat `queued`, `pending`, or
`synthetic-completed` as proof that a worker result was produced.

**Owner cancellation (2026-09-11):** the owner subsequently requested
"cancel the cron job". The exact six-hour timer is now disabled and inactive,
with no next firing; its service is inactive. Configuration and historical
verification above are retained. Programme work may continue, but neither a
goal continuation nor the old prompt re-enables this timer.

### 9. Match model use to the work

Use native subscription clients and the currently available model catalogue.
Choose an explicit model and effort for each bounded task, keep its context
compact, and prefer the faster capable role below. Max and Ultra are exceptions,
not programme-wide defaults; parallelism alone does not justify either.
Escalate when a concrete unresolved check warrants it. User-selected models and efforts take
precedence; do not require failure at lower efforts before honoring an explicit
selection. Do not route or pause on subscription usage budgets, and never
silently change models when a native subscription is unavailable.

Current policy (owner, 2026-09-22): all programme coordination, implementation,
analysis, documentation, review and delegated contributions use native Claude
Code through the configured 9router Claude subscription connection. This
supersedes earlier Codex selections and mixed-provider recommendations for new
work. Application work remains paused until explicitly resumed; this amendment
changes orchestration setup only.

| Work | Exact 9router model | Effort |
| --- | --- | --- |
| Builds, tests, format checks and exact comparisons | Deterministic tools through the harness | No model |
| Bounded implementation and focused test authoring | `cc/claude-opus-5` | `xhigh` |
| Documentation and narrow extraction | `cc/claude-opus-5` | `low` |
| Independent review | `cc/claude-fable-5-1` | `high` |
| Difficult implementation | `cc/claude-fable-5-1` | `xhigh` |
| Consequential decisions and programme coordination | `cc/claude-fable-5-1` | `max` |

These are the original role/model/effort choices in `65cb324a` (2026-09-15),
which `7a460f6f` replaced with mixed routing on 2026-09-19. The `cc/` prefix
selects the owner-authorized 9router subscription provider, whose catalogue
exposes these exact IDs. Unlike the original temporary configuration, ordinary
routes now reject explicit Codex overrides and Codex contributors. Exact
`cc/claude-sonnet-5`, Opus and Fable overrides remain admissible with a reason,
effort and observable completion check. Default decision/Max is allowed;
explicit Max overrides require owner or unresolved selection. Ultra and
unqualified model IDs are not admitted. No provider API key, automatic model
fallback, quota gate or new scheduler is introduced.

Claude's `--safe-mode` skips settings-file loading. A print-mode host must
explicitly forward the allowlisted gateway configuration before calling the
existing `nativeChildEnvironment("claude")` helper; inheriting an unset shell
environment loses the settings-file connection. The current
[launch instructions](../plans/native-agent-strategy-reassessment.md#configured-9router-launch)
show that exact operation without logging credentials or modifying user settings.
If the native client or requested model is unavailable, stop and report its
exact identity and error. Await native validation jobs before client exit.

### Historical model selections

The following records remain evidence of past execution, not current dispatch
instructions. Frozen qualification contracts and receipts keep their original
model identities; this amendment does not activate or rewrite them.

The owner's September 12 selection replaces Sol High with Astra Low for this
programme's implementation work. The schema-envelope workflow records this as
`model=gpt-6-astra`, `effort=low`, `selection=owner`; Sol Medium independent
review is unchanged. The prior Sol-bound attempt was stopped before application,
not relabelled as an Astra execution. This does not switch the conversation
model or change deterministic build/test execution.

From 2026-09-15 until 2026-09-19 the owner reported that the Codex subscription
was unavailable and directed temporary Claude-only execution. During that
interval the ordinary-delivery defaults routed each row above to an exact
native Claude model with effort by role: `claude-opus-5` at xhigh for bounded
implementation and at low for documentation, `claude-fable-5-1` at high for
independent review, at xhigh for difficult implementation, and at max for
consequential decisions. Aliases and effort-less Haiku were not admitted.
Claude efforts ran `low` to `max`; Ultra remained Codex-only. The two failed
Astra-bound schema-upgrade workflows keep their original identities and are not
relabelled.

On 2026-09-19 the owner reported that the ChatGPT/Codex subscription was
available again and directed restoration of the preceding mixed native-provider
policy. `tools/engineering-harness/src/delivery.mjs` then restored the
exact earlier defaults: Terra Medium for bounded implementation, Luna Low for
documentation, Sol Medium for routine review, Sol High for difficult
implementation, and Astra High for consequential decisions. Exact native Claude
models remained admissible as explicit overrides, and the route retained the
provider field introduced during the temporary interval so the host can dispatch
either native subscription client without substitution. Max/Ultra again require
an explicit owner or unresolved selection. Historical Claude and Codex runs,
including the September 12 Astra/Low selection, retain their original identities.

On 2026-09-20 the owner selected `gpt-6-astra` / `xhigh` for programme
coordination. The native coordinator owns sequencing, model allocation and
acceptance decisions; root retains source application and the workflow bridge.
That selection was recorded in programme control and repository instructions.
It is superseded for new work by the 2026-09-22 Claude-only amendment; historical
agent IDs and receipts must not be relabelled.

Do not inherit a coordinator's settings into routine workers. Select
their model/effort explicitly and pass only the relevant contract, files and
acceptance checks. Return subsequent routine tasks to the faster defaults after
an escalation resolves its question. This does not silently change a running
owner-selected conversation or reinterpret a native availability error as
permission to switch accounts, models or providers.

[Official reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort)
describes lower effort as favoring speed and medium as a general balance. These
are workload-selection policies, not a repo-specific latency benchmark or a
reason to apply API billing rules to subscription execution. Native Ultra
support remains available; an API effort list is not the native capability list.

The 2026-09-10 usage review sampled parent `turn_context` metadata for
2026-09-09 17:30–23:30 UTC: 18 records represented 13 distinct parent turns,
all recording `gpt-6-astra` / `max`, not Ultra. The two latest delivered worker
slices, workload reload (`db44d695`) and active transport cancellation
(`5d3ad844`), used native `gpt-5.6-sol` / `high`. This exposes heavyweight
coordination alongside faster implementation, not an all-Ultra execution mix.
It is not a complete subagent census or a measurement of time, cost or quality.
Ruflo's model statistics reported 247 routing decisions (191 Sonnet, 56 Opus),
not actual Codex executions; they cannot establish the native model mix.
The per-principal admission slice used native Terra Medium for implementation
and focused tests, followed by parent review and deterministic release checks.
Review removed a queue allocation and strengthened expiry, unwind, schema and
reload tests. Both CLI feature configurations and the exact release-binary
HTTP suite pass. This is one accepted mixed-model slice, not a model ranking.
The subsequent aggregate-DISTINCT slice (`5a732fb6`) likewise used Terra Medium
for implementation and Luna Low for documentation, with parent review and
native test/release checks. A separate Sol Medium slow-query diagnostic worker
returned partial measurements then a content-review error; only recovered,
attributable results were retained, with no retry through another model.

The priority-scheduling slice (`7f6fb59e`) and subsequent conditional-join
budget slice reused native Terra Medium for bounded implementation. Parent
review supplied CLI integration and strengthened the new budget tests with
actual keyed-plan assertions, independent source-consumption observations and
prepared-clone sharing checks. Deterministic tools ran the native matrices and
release build; no Max/Ultra worker was dispatched for these routine slices.
This records accepted work and review corrections, not comparative model
latency, billing savings or a complete census of the parent conversation.

The following native restart-fixture repair used Terra Medium for independent
read-only review and deterministic Rust tests, with the parent as sole writer.
It adds no model-routing infrastructure and returns to product work after the
normal-concurrency gate; historical bind failures are not erased by a passing run.

These are starting policies, not a measured cross-model ranking. Record the
actual model/effort, accepted result, rework, and elapsed time when observed.
Do not fabricate monetary savings from API prices or Git history. Model-router
training, new receipt formats, and benchmarking remain optional future work.
The native Astra Ultra compatibility correction is `7d89e7bc`; historical Sol
contracts and qualification evidence are not rewritten.

### 10. Make the ordinary delivery harness the actual execution path

The 2026-09-10 usage review found that ordinary product changes were using
native agents and direct Cargo commands while the engineering registry still
covered historical G1 candidates only. Ruflo task rows and an installed harness
were not evidence that current builds used it. The owner requested repair
before further product work, mandatory harness use for all building, and a
stop for owner review when that repair is ready.

Use the additive `tools/engineering-harness/bin/oxigraph-delivery.mjs` entry
point for every ordinary programme build/test, including focused checks,
repair iterations and release builds. It admits literal native Cargo commands
and an explicit ordinary Node test inventory, reusing the existing Agentic-QE
process runner, output limits and native summary checks. It adds no dependency.
An unsupported command needs a reviewed adapter before execution; do not
silently bypass the harness or route through the frozen qualification runner.

The native coordinator retrieves live Ruflo task/control state, defines the
completion check, selects explicit model/effort arguments with `route`, and
dispatches real native workers when useful. It binds their actual native IDs
and results through MCP. `route` itself is only a plan; neither a queued worker
nor a Ruflo task/agent status establishes execution. The owner's selected
conversation is unchanged. The routine defaults and explicit override rule
implement §9; no provider invocation or model-usage budget is added to builds.

Each `run` records literal commands, task ID, source HEAD and dirty-input
hashes, tool versions, output hashes/logs, process result and observed tests in
ignored `target/engineering-delivery/`. It rejects nonzero exits, timeouts,
output overflow, missing/zero test summaries and before/after source drift.
Build artifact selection requires a matching Cargo compiler-artifact event
and binds the observed path/bytes/hash to the selected binary/profile; cached
builds are not described as fresh rebuilds. The successful local status is
`command-passed`, never completed delivery. These are
ordinary local observations, not protected receipts, semantic qualification,
host containment or publication authority. Boundary source checks do not
prove absence of transient concurrent edits. The coordinator verifies live
MCP task identity and writes/readbacks the actual outcome; the CLI does not
pretend to synchronize MCP itself or authenticate a supplied task ID.

That command wrapper fixed command supervision, but did not itself connect
implementation, repair and independent review. Calling it a complete build
workflow overstated the integration. The owner's subsequent repair request
adds the bounded ordinary `workflow --spec FILE.json` controller:

1. A schema-checked task declares exact editable source paths, observable
   completion checks and explicit native implementation/review routes.
2. The controller requests live task/control reads through the coding host,
   including before edits, checks, review and handoff. A product review hold
   stops execution; a separately active harness-only task may still proceed.
3. A real HarnessKernel stage invokes the native host's read-only worker and
   verifies its structured result. Only root applies the exact proposed file
   contents. Source changes outside the declared paths, mismatched responses
   or stale check evidence stop the workflow.
4. Existing `run` supervision executes each declared check without model calls.
   A failed prerequisite stops later checks/review and supplies bounded failure
   evidence and inspectable logs to repair. Rejected independent reviews feed
   their findings to repair, followed by fresh checks and review. An unchanged
   repeated failure stops for integrator judgment, not a model-usage ceiling.
5. A distinct native reviewer inspects the actual candidate and check results.
   The host stores the accepted evidence using Ruflo MCP and returns the exact
   retrieved value. Success is `ready-for-owner-review`; root still owns scoped
   commits, completion of the live task and any separately authorized handoff.

This is native-host integration, not another autonomous agent platform.
The stdio host bridge issues typed requests; it does not fabricate MCP results,
launch a model provider or grant a worker write authority. Native identities
and MCP values remain host-supplied and inspected, not independently
authenticated by this controller. Kernel receipts validate individual stage
records, not semantic acceptance, durable crash recovery or publication.
The outer controller deliberately handles prerequisite failure and repair
feedback rather than assuming the upstream kernel supplies them. No automatic
host restart, unattended agent dispatcher or Git publisher is claimed.

The bounded acceptance demonstration repairs a real host-stream error through
a native Terra Medium proposal, root application, 27 passing Node tests,
independent Terra Medium acceptance and exact live MCP readback. The workflow
is `225a84f0-3269-4246-8782-938b2fd5cfaa`; local evidence is
`target/engineering-delivery/workflow-6K0Pix/`, and repository memory is
`programme-task-evidence/workflow-225a84f0-3269-4246-8782-938b2fd5cfaa`.
Its earlier failed attempt is retained, not rewritten. Deterministic controller
fixtures separately exercise repair feedback, stale evidence, review holds,
independence, stream failures and unavailable-model reporting; test doubles
are not counted as native worker execution. A follow-up corrects the Node
count projection (the real run's full result already recorded 27 passes).

This additive integration changes no frozen G1 registry, expected result,
receipt validator, protected runtime or semantic qualifier.
It does not activate Dream Machine, G1.7, containment successors, Router
training, or another calibration programme. A shell outside the entry point
remains technically possible but violates the programme's build workflow.

An explicit owner-review hold must stop both normal and scheduled product
continuation. The September 10 hold was subsequently lifted by explicit owner
approval; consult the latest owner instruction and live control rather than
treating that historical hold as permanent. Keep the timer available and make
it respect any active hold, rather than silently disabling the programme.

### 11. Remove mechanical overhead without weakening acceptance

The September 11 adversarial review measured about 63% of one repaired
ten-check window outside native commands. That is orchestration elapsed time
for that window, not measured developer effort, model cost or kernel CPU time.
It also found duplicated control/history payloads and ordinary format/fuzz and
source-path gaps. The owner approved this bounded correction:

- The native host services mechanical MCP requests through the existing
  callback-injected `relayWorkflowHost` helper in one bounded tool turn. Fresh
  task/control reads, current owner holds, root-only edits and independent
  native review remain mandatory. No extra agent platform or MCP transport is
  introduced; native-worker and root-apply requests remain real host actions.
- Ordinary workflow v2 records compact summaries and content-bound local
  references. Full event/check records stay inspectable and are verified before
  handoff; historical v1 evidence is not rewritten or resealed.
- Reviewed non-writing format checks, the literal one-minute fuzz lane, root
  and crate manifests, and nested new-source paths remove routine admission
  failures. Preflight rejects invalid source before runtime allocation or
  worker dispatch. This does not broaden the frozen qualifier or vendor paths.
- The live control is current state with an exact archived-history reference.
  The [current delivery-gates checklist](../plans/oxigraph-delivery-gates.md)
  projects the remaining work once; both scope catalogues link to it. The
  [historical narrative](../plans/oxigraph-delivery-history-2026-09-11.md)
  preserves the moved status text. Owning ADR contracts and literal acceptance
  requirements remain authoritative.

Validation requires the focused and ordinary Node contracts on current Node
and Node 20, actual native format/fuzz observations, live MCP relay/readback,
failure handling and independent review. Fixtures are not native worker
execution; a passing harness does not close a product gate. Report a measured
workflow improvement only after a comparable product run, not from code size,
document reduction or this decision alone. Harness evolution stays inactive.

## Implemented R1 evidence

The `eb0f0cc2` source state passed:

| Boundary | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo test --locked -p spareval --features sparql-12` | all unit, integration, and doctests pass |
| affected `oxigraph` store/query/write tests | 36 passed |
| `cargo test --locked -p oxigraph --features rdf-12 --test sparql_version` | 3 passed |
| pinned Oxigraph SPARQL conformance lane | pass |
| JavaScript `test/store.test.ts` | 43 passed |
| affected Python store tests | 2 passed |
| `sparql_query_eval` fuzz target | 60 seconds, no crash |
| `sparql_update_eval` fuzz target | 60 seconds, no crash |

The unchanged reviewed N3 gitlink is now fetchable from `sparkling/N3`,
verified by an independent fresh bare fetch in `75f538e0`
([publication record](../research/n3-submodule-publication-2026-09-07.md)).
The optimized CLI release build succeeds; its identified RocksDB-backed binary
passes 15 HTTP checks covering multi-operation writes, reads, atomic rollback,
restart persistence, and empty-graph lifecycle. An additional 14 focused Rust
transaction/topology tests pass
([commands, artifact hash, and observations](../research/r1-application-validation-2026-09-07.md)).

The checks prove only the changed product/binding behavior at this source
state. They do not confer production readiness, performance, containment,
provider, or broad semantic-parity claims.

### 12. Correcting the "Astra activation gate" tasks' stale dormancy premise (2026-09-17)

Two long-pending Ruflo tasks, `task-1788732955580-l69gx4` ("Astra
activation gate A") and `task-1788732963005-oiyx9g` ("Astra activation
gate B"), were both filed on 2026-09-06 and both state their own
acceptance criteria as "keep Astra dormant, no provider execution,
qualification, promotion, or publication." Investigated directly
before any implementation was attempted: that premise is contradicted
by this ADR's own §9, in this ADR's own words -- "the owner's September
12 selection replaces Sol High with Astra Low for this programme's
implementation work," "18 records represented 13 distinct parent
turns, all recording `gpt-6-astra` / `max`," and "the two failed
Astra-bound schema-upgrade workflows keep their original identities."
`gpt-6-astra` was demonstrably executed for real programme work,
repeatedly, at multiple efforts, in the days immediately following
both tasks' own creation date. "Dormant" described a state that no
longer held true by the time either task could have been started.

This is not a case where the underlying engineering concern is wrong.
Gate A's own goal -- a version-additive effort-migration contract that
maps legacy `none`/`minimal` callers to `low`, fails closed on an
unknown effort, and never silently substitutes a transport or
provider -- and gate B's goal -- keeping per-effort request identity
distinct so a dormant-or-not Astra outcome cannot contaminate the
existing generic router's own quality history -- remain genuinely
useful hardening, independent of whether Astra has already executed.
What is wrong is the *framing*: both tasks describe themselves as a
gate to satisfy *before* a hypothetical future activation, when that
activation already happened, repeatedly, and is already documented in
this same ADR. A "pre-seal" gate for an event that has already
occurred cannot be implemented as originally scoped; it needs
rewriting as a retroactive hardening pass over the now-active routing
path, not a pre-activation checklist.

A second, independent gap was found while investigating gate A
specifically: `tools/engineering-harness/src/policy/astra-routing.mjs`'s
own `ASTRA_REASONING_EFFORTS` currently lists six values --
`[low, medium, high, xhigh, max, ultra]` -- while gate A's own task
text says to "preserve low/medium/high/xhigh/max," silently omitting
`ultra`. This omission predates, and is independent of, the dormancy
question above; it would need correcting regardless of how the gate
is rescoped.

Neither task's premise has been corrected in the task tracker itself
(the available tooling can update a task's status and progress, not
rewrite its recorded description), so this ADR section is the
authoritative record of the correction until a session with dedicated
time to rescope and implement the underlying hardening work picks it
up. Full investigation, evidence, and reasoning are recorded in Ruflo
memory: `programme-reviews/oxigraph-astra-gates-stale-premise-2026-09-17-v1`.
This correction does not activate, qualify, promote, or publish
anything; it corrects a documentation premise so a future
implementation attempt does not start from a false starting state.

### 13. Reading the actual Astra routing code before scoping either gate's fix (2026-09-17)

With the dormancy premise corrected, the next question was whether
gate A's and gate B's own *proposed fixes* were themselves still
right, now that the "gate before activation" framing was gone. Both
`tools/engineering-harness/src/policy/astra-routing.mjs` (70 lines) and
the relevant slice of `tools/engineering-harness/src/routing/
history.mjs` (707 lines) were read directly rather than assumed from
the task text.

**Gate A's own proposed fix does not hold up.** Its text asks to "map
legacy `none`/`minimal` to `low`." Grepping the whole harness source
found no live caller anywhere passing `"none"` or `"minimal"` as a
reasoning effort; the only `"none"`/`"minimal"` string literals in the
tree are for unrelated concerns (`fork_turns: "none"`, a sanitizer
flag, a fallback attempt ID). More importantly,
`tools/engineering-harness/test/astra-routing.test.mjs`'s own existing,
passing test (`"Astra selections require an explicit supported effort
while legacy models remain unchanged"`) already asserts, deliberately,
that `validateAstraReasoningEffort(ASTRA_MODEL, "none")` and the
`"minimal"` case both **throw**. Implementing gate A's literal request
would mean *weakening* an already-tested, deliberate fail-closed check
for a caller convention that does not appear to exist in this
codebase, for no live benefit identified. The gap this session's
earlier investigation flagged in gate A's own task *text* (omitting
`ultra` from "preserve low/medium/high/xhigh/max") was already correct
in the code itself (`ASTRA_REASONING_EFFORTS` has always listed all
six values); no code change is needed there either. Net effect: gate
A, as originally proposed, has no remaining part that should actually
be implemented. Its dormancy premise was already corrected in SS12;
this closes the remaining question of whether its technical proposal
was independently sound, and finds that it was not.

**Gate B's underlying concern is real and was confirmed directly, not
assumed.** `normalizeQualityOutcome`'s `OUTCOME_KEYS` set (`history.mjs`
lines 43-60) lists exactly `taskId`, `taskClass`, `role`, `provider`,
`model`, `models`, four SHA-256 digest fields, `disposition`,
`quality`, `mode`, `pairId`, `predictedQuality`, and `repairCycles` --
no `effort` field anywhere. Every recorded outcome is keyed only by a
bare `model` string. For a single-effort model this is harmless, but
`gpt-6-astra` has six reasoning-effort levels (`low` through `ultra`)
that this session's own work has already seen used for materially
different work (`low` for the owner's September 12 selection, `max`
for 13 sampled parent turns per SS9). A `low`-effort failure and a
`max`-effort success are, today, indistinguishable `"gpt-6-astra"`
entries to any code that aggregates or compares quality by model
identity. This is exactly gate B's own stated worry, now confirmed by
reading the schema rather than inferred from its "generic v6 Router"
language (which still has no literal referent in code; the router's
real identity is `RouterHistory`/`QualityFirstRouter`, schema
version 1).

Fixing this well means adding an effort-aware identity to a 707-line
file with its own envelope validation, file-locking, and cross-entry
invariant machinery (`validateCrossEntryInvariants`,
`validateEnvelope`) -- a materially riskier change than anything in
gate A, and one that deserves its own careful, unhurried design pass
(at minimum: whether to add a new required `effort` field, whether
that is a breaking schema change for already-written history files,
and how existing entries without it should be classified) rather than
a rushed addition at the end of an unrelated session. Deliberately not
attempted here. The next session picking this up should design the
schema change first, confirm it against `validateCrossEntryInvariants`
and the existing history-file format, and only then implement it with
its own focused test additions to `router-history.test.mjs`.

### 14. Implementing gate B's confirmed fix, and closing out a verification question it raised (2026-09-17)

SS13's deferred design now has an answer, implemented and committed
(`46b55202`). `history.mjs` gained `normalizeProviderEfforts()` and
`providerEffort()`: an outcome may now carry an optional `efforts` map,
validated against `astra-routing.mjs`'s existing
`validateAstraReasoningEffort` ladder, added to `OUTCOME_KEYS` and
included in the normalized outcome only when present -- omitted, not
defaulted, for legacy-shaped outcomes, so every pre-existing entry's
canonical JSON (and therefore `entrySha256`) is byte-identical to
before. Verified directly against the real 31-entry
`.runtime/router-history.jsonl`: it still opens, validates its full
hash chain, and shows no `efforts` field on any entry.

`quality-router.mjs`'s internal `currentFingerprint()` (which decides
which past entries pool into "the current regime" for quality
aggregation) now also compares effort per provider, closing the actual
contamination gate B named: a `low`-effort and a `max`-effort
`gpt-6-astra` regime no longer share pairing or calibration data. The
*publicly reported* `fingerprintSha256` from `fingerprint()` was
deliberately left unchanged after extending it broke 9 tests in
`g12-programme.test.mjs` -- `application.mjs` keeps its own
independent, duplicate re-derivation of that exact formula
(`routingFingerprint(control, contract)`) with no effort concept
anywhere in its own control/contract model, and re-verifies a reported
decision's fingerprint against it. Reverted; documented with a code
comment at the point of reversion. Extending `application.mjs` to
carry effort too is a separate, larger, currently unforced change --
nothing in its own domain needs to display or bind effort today, and
gate B's confirmed problem is already fully closed without it. Not
attempted; not recommended unless a concrete future need (e.g. an
effort-aware receipt/audit surface) actually forces it.

Verification: 3 new tests in `router-history.test.mjs` (schema
preservation, ladder validation, and a same-model-different-effort
non-contamination case), plus the full 1501-test engineering-harness
suite run twice via `git stash` (with and without this change) --
identical except the 3 new passing tests and two commit-identity tests
that mechanically fail on any uncommitted diff, not a real regression.

One of those two commit-identity tests
(`test/g17-qualification-identity.test.mjs:50:1`, "G1.7 identity binds
the sealed e9 subject separately from descendant harness control")
kept failing even after `46b55202` was committed and the tree was
clean, which needed its own separate check rather than being waved
through. Reading `src/qualification/identity.mjs`'s
`verifyControlOnlyDelta` and the G1.7 contract
(`qualification/g1.7/contract.json`) directly: this test compares the
contract's sealed subject commit
(`e9d2db1b7c4eb974b406136e667e09ba06e34b48`, 2026-08-28 --
the "e9" in its own name) against current `HEAD`, and fails on any
changed path outside `README.md`/`docs/`/`tools/engineering-harness/`.
539 commits have landed since that subject was sealed, the large
majority touching `lib/` or `cli/` through ordinary product delivery,
so this has been failing continuously for about three weeks and has
nothing to do with `46b55202` or this session's disk-exhaustion work.
The contract's own `authority` block records
`promotionAuthority: false`, `publicationAuthority: false`,
`routerQualityAuthority: false`, and its `objective` text says the
protocol "leaves both human decisions unapproved" and "keeps every
execution owner unavailable" -- this G1.7 track is an inert, archival
protocol-freeze exercise (a `transactional_write` benchmark
subject/reference/control comparison) that was never wired to gate
ordinary delivery. No action taken or needed; recorded in Ruflo memory
(`programme-controls/oxigraph-g17-e9-subject-drift-is-preexisting-and-inert`)
so a future tick does not re-open this same question.

## Native adapter admission for product repair (2026-09-10)

The ordinary workflow now admits the exact product file
`oxrocksdb-sys/api/c.cc` for the native lease-lifetime fix needed by ADR-0028.
This is not general admission of native headers, sibling sources or vendored
RocksDB. Exact positive/negative path checks passed with the ordinary workflow
contracts on Node 24 and Node 20 (29 each), with independent Sol Medium review.
The focused adapter commit is `9cf51cfe`; its first final host readback envelope
was malformed, so that controller run is recorded as failed despite separately
verified tests, review and commit. It is not claimed as successful execution.
The subsequent product workflow uses the documented host protocol, including
actual failed-check/review feedback into native repair. No new agent platform,
qualification surface, model transport or harness-evolution work is introduced.

## Acceptance boundary

All nine recovery gates below are verified on 2026-09-07. The source handoff
is `aa7128bb`, the [programme Gist](https://gist.github.com/sparkling/5f2bcd7d6e8c9cda78de3b8bd40a1e96)
contains the full 43-decision feature catalogue, and the exact Ruflo record is
`programme-reviews/oxigraph-r1-delivery-handoff-2026-09-07-v1`.
The HTTPS push was rejected for missing OAuth workflow scope; the existing
SSH login authenticated as `sparkling` and published the unchanged commit set.
Remote `main` was read back at the exact handoff SHA. No downloadable binary
release, deployment, or aggregate qualification is claimed.

This ADR's recovery decision requires:

1. upstream `7ce152a1` and the two cross-backend regressions are committed;
2. the proportional R1 gates above pass;
3. ADR-0014 and ADR-0017 are reconciled to this decision;
4. ADRs 0034 through 0041 and both programme plans clearly state their
   non-gating future status;
5. README and the programme Gist describe the implemented write seam and R1
   boundary without a harness-first ETA;
6. Ruflo records the exact delivery evidence and the next single authorized
   product slice, with deferred harness work no longer marked as execution;
7. the N3 gitlink is reachable from its declared remote;
8. the identified release binary passes the persistent application journey;
   and
9. the verified source revision and fork installation instructions are published
   through the authorized `main` workflow.

The recurring timer supports programme control; its health is tracked
separately and cannot substitute for, or prevent, these product release gates.

## Consequences

### Positive

- The already-delivered write interface reaches users without waiting for an
  unrelated containment research programme.
- Validation remains strong but follows the changed product surface.
- The detailed harness history stays available without controlling application
  sequencing.
- Progress and blockers become externally auditable against a short gate list.

### Negative

- R1 makes narrower claims than the original all-capabilities programme.
- Dormant harness investment does not produce immediate release value.
- Future containment or broad parity work must be reactivated and justified as
  a separate delivery slice.
- The external scheduler depends on the user-level `systemd` manager, the
  native Codex app server, and this persisted thread remaining available.
- Ruflo currently reports a processed audit in daemon counters without
  reconciling the corresponding MCP worker record to `completed`. The counter
  cannot identify which queued request ran; reviews retain both observations
  and require an attributable result before claiming that exact audit completed.

### Neutral

- RocksDB remains the sole production-intended persistent backend under
  ADR-0042.
- TurboKV remains historical decision evidence and is not active work.
- No qualification baseline, protected receipt, or expected semantic result is
  refreshed by this decision.
