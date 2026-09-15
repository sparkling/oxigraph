# ADR-0043: Delivery recovery and proportional release boundary

- **Status**: Implemented
- **Date**: 2026-09-07
- Updated: 2026-09-12
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

The owner explicitly authorizes native `claude -p --model fable` as the fallback
for permitted repository work affected by a Codex content-display or routing
block. Keep the original task, its constraints and the observed error; this is
not authority to evade a genuine safety refusal or relax safeguards. Use only
native subscription authentication and retain one Git writer. If Claude or Fable
is unavailable, report its exact client/model/error instead of substituting again.
Await native validation jobs before the print-mode client exits: background
jobs terminated at handoff are not passing tests.

| Work | Default recommendation |
| --- | --- |
| Builds, test execution, formatting, exact comparisons and status collection | Deterministic tools; no extra model invocation |
| Routine bounded implementation and focused test authoring | Terra Medium; Sonnet on an authorized native Claude route |
| Narrow extraction, documentation edits and repetitive language work | Luna Low or Haiku |
| Routine recovery coordination and focused review | Sol Low/Medium or Terra Medium |
| Difficult Rust, transaction, or SPARQL implementation | Astra Low (owner replacement for Sol High); Opus only on an explicitly selected native Claude route |
| Consequential architectural judgment or an unresolved correctness review | Astra High; Xhigh only for a demonstrated need; Fable for a targeted authorized review |
| A particularly hard unresolved problem, or an explicit owner selection | Astra Max/Ultra for that bounded problem, with its reason and completion check recorded |
| Useful independent subtasks | Mixed faster workers chosen by subtask, not automatic Ultra; one Git writer |

The owner's September 12 selection replaces Sol High with Astra Low for this
programme's implementation work. The schema-envelope workflow records this as
`model=gpt-6-astra`, `effort=low`, `selection=owner`; Sol Medium independent
review is unchanged. The prior Sol-bound attempt was stopped before application,
not relabelled as an Astra execution. This does not switch the conversation
model or change deterministic build/test execution.

On 2026-09-15 the owner reported that the Codex subscription is unavailable for
roughly four to five days and directed Claude-only execution. The ordinary
delivery defaults in `tools/engineering-harness/src/delivery.mjs` therefore
route each row above to an exact native Claude model with effort by role,
following Anthropic's published effort guidance rather than a cost ladder
(subscription use carries no cost budget): `claude-opus-5` at xhigh for bounded
implementation and at low for documentation, `claude-fable-5-1` at high for
independent review, at xhigh for difficult implementation, and at max for
consequential decisions. Aliases and effort-less Haiku are not admitted. Claude
efforts run `low` to `max`; Ultra remains Codex-only. Codex models stay
admissible as explicit overrides so the September 12 Astra/Low selection can be
restored when the subscription returns; until then an unavailable Codex route
is reported, not substituted. The two failed Astra-bound schema-upgrade
workflows keep their original identities and are not relabelled.

Do not inherit a Max/Ultra coordinator's settings into routine workers. Select
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
