# ADR-0043: Delivery recovery and proportional release boundary

- **Status**: Implemented
- **Date**: 2026-09-07
- Updated: 2026-09-10
- Deciders: Oxigraph parity programme
- Implementation status: the product and validation slice is implemented in
  `eb0f0cc2`; the six-hour scheduler is installed and its wake-up path is
  tested; N3 fetchability is resolved in `75f538e0` and the optimized binary
  passes the persistent application journey. Recovery source and installation
  instructions are published on `main` at `aa7128bb`; the programme Gist and
  Ruflo delivery evidence were updated and read back. R1 is complete; the
  wider programme has implemented G2.2 capture/request/keyed integration in
  task `task-1788781295095-lrzbqi` and G2.3a native atomic receipts in
  `task-1787670631130-9jlo3h` and G2.3b ordered outbox in
  `task-1787670631321-dewzgm`, published in `58d3253c`. G2.3c retention/leases
  and bounded governance health in `task-1787670631517-qjoyw1` are implemented
  with native expiry, slow-consumer, backpressure, restart, compaction, backup,
  and corruption tests. G2.4a staged-view SHACL commit validation in
  `task-1787670631682-97ibi4` implements the native gate under the governed writer
  permit. G2.4b adds bounded policy receipts in the atomic native outcome,
  feature-independent lookup, expiry, and injected-failure closure in
  `task-1787670631837-w5ac24`. G2.5 has native bounded readiness observations,
  fixed gauges, canonical contributor validation, and opt-in loopback
  observation endpoints, transaction terminal and Store-bound query/update
  counters/duration histograms. Lazy evaluation is counted at EOF, first error,
  or abandonment, without changing iteration or transaction semantics.
  Denied attempts and returned SHACL commit-gate observations now close the
  bounded G2.5/P1.4a contract in task `task-1787851231441-1gdfzd`.
  G2.6 task `task-1787851232211-6fiarr` adds checkpoint-bound manifests, frozen
  contributor file checksums, completion-last receipts, offline verification,
  and the read-only WAL checkpoint repair. G2.7 task `task-1787851233022-antw51`
  adds fresh-directory restore, full retained-outbox/storage validation,
  contributor reconciliation and artifact-bound local recovery baselines.
  G3.0 shared derived-index lifecycle is implemented natively: stable inputs,
  bounded deltas, checksummed immutable generations, exact primary reconciliation,
  atomic activation, crash recovery and G2 hooks. G3.3 now adds an optional
  native Tantivy provider/Rust query API with scoped candidates, strict/eventual
  semantics and exact document/posting reconciliation. G3.3 now also provides
  opt-in local SPARQL text SERVICE joins on that same retained snapshot, with
  row-independent eventual lag context, bounded caching and fatal cancellation.
  G3.4 adds a native CRS84 envelope/exact-predicate provider with bounded ordered
  catch-up, strict freshness and the same backup/restore lifecycle. Opt-in local
  spatial SPARQL joins now share the retained snapshot and preserve fatal
  cancellation, with explicit SERVICE SILENT success filtering. G3.3/G3.4
  retain their separate performance/promotion gates. G3.1 now supplies the native
  physical statistics provider, exact graph/predicate counts, bounded frequency
  summaries and the shared lifecycle. Opt-in same-snapshot query costs and
  term-free estimated/observed-row, completion and q-error feedback are now
  implemented with dataset-aware heuristic fallback. G3.2 now adds opt-in native
  bounded join planning with deterministic eight-leaf subset search and greedy
  fallback. Its native differential tests and runnable statistics example do
  not close the separate frozen-corpus performance/promotion gates; G3.2 stays
  active for those requirements. No default-planner promotion is claimed.
  A first BSBM pilot exposed per-query statistics reconstruction as a bottleneck;
  explicit verified-snapshot reuse now avoids it only for an exact matching
  physical checkpoint and private live-store identity, excluding copied-sibling
  divergence. This is callable product progress, separate from the
  diagnostic runner/docs. The pilot also found a bounded-without-statistics
  regression and confirmed missing frozen corpus/threshold assets, so it closes
  neither the full G3.2 performance gate nor the wider programme.
  Explicit conditional cost model v2 now corrects the measured broad-scan
  choice while retaining legacy v1 and the ordinary greedy default. Native
  result/work regressions and a retained-parent pilot verify this opt-in slice;
  representative corpus, resource/tail and promotion gates remain open.
  A subsequent native lock-lifetime repair makes derived-index owner drop
  explicitly unlock despite duplicated descriptors, while a copied foreign-PID
  guard cannot unlock the live parent. The unchanged parallel recovery test and
  deterministic ownership regressions validate this release-blocker correction.
  Broader BSBM SELECT coverage then exposed Q8/Q5 scan-work regressions.
  A separate opt-in correlated V3 profile now uses consistent probe/output
  costs and conservative unhinted probe selection; the native Q8-shaped
  red/green regression preserves results and avoids unrelated full scans.
  V1/V2/defaults remain unchanged and full G3.2 acceptance remains open.
  The first LDBC input then exposed per-named-graph full scans in query-time
  materialization. Graph-prefix copying now removes that superlinear work while
  retaining the existing materialization and topology contracts; a same-data
  CLI comparison preserves all 12 result rows. Full performance acceptance is
  still separate from this measured product repair.
  CLI/HTTP Simple queries now use the native snapshot path without whole-store
  materialization; the corresponding in-memory union-default exclusion defect
  is fixed. Focused dataset/streaming tests and a retained-parent LDBC comparison
  support this slice, not full G3.2 acceptance. Finite entailment is unchanged.
  Subsequent BSBM/LDBC parent measurements and explicit N-Quads/query-only
  diagnostic support are acceptance preparation, not new application behavior
  or another closed documentation gate. Shared-host tail variation prevents
  ratifying the proposed 5% gate from those observations; remaining scoped
  acceptance work is tracked in ADR-0023 and the native comparison instructions.
  The next native planner correction avoids constructing rejected candidate
  trees while retaining exact costs, tie-breaks and search reports. Its native
  regression and planner-only DP/fallback comparisons are distinct from broad
  performance acceptance; no profile or default is promoted.
  Native statistics-state and retained-snapshot determinism checks now close
  focused acceptance gaps. Machine-checked input manifests add reproducibility
  support. ADR-0023 corrects the extra manual pre-run approval invented in
  `1771b64e`; baseline-first gates remain, with no new promotion authority.
  The no-statistics WatDiv V3 run is result-equivalent but exposes a Q4 work
  regression. A separate verified statistics lookup optimization removes linear
  scope scans without changing estimates. The paired shared-statistics run
  then preserved results but exposed much worse V3 Q2/Q4 work. ADR-0023 now
  describes an explicit source-bound NDV/V4 candidate addressing join-domain
  estimates, with a native 5,000-to-3,000 quad-row regression. Old profiles,
  default planning and numerical gates are unchanged; corpus/resource/tail
  acceptance remains open. No harness-evolution prerequisite is added.
  Its first BSBM comparison passes all 960 oracle checks but regresses Q7
  quad work; diagnose that ordering before the large WatDiv candidate rerun.
  While that G3.2 performance gate remains open, G3.3 now removes the duplicate
  text candidate scan and enforces cancellation/overflow during enumeration.
  Native cursor-work and result checks support this bounded correction, not
  completion of either provider's frozen performance/promotion gates.
  The fixed native text baseline now supports an explicit retained RAM query
  session for different queries on the same admitted view. It avoids repeated
  payload hydration, not first strict admission; no implicit primary-scan cache
  or broader performance promotion is introduced.
  The 2026-09-09 literal-gate review closes native G3.3 at `e865c7aa` while
  preserving separate performance/production promotion requirements. Keeping
  that delivered task active for unspecified later promotion was process drift,
  not a missing text feature. G4.1 now owns the next product delivery step under
  ADR-0026; no text benchmark rerun or harness expansion gates its implementation.
  G4.1's first native slice rejects anonymous non-loopback startup without
  explicit development consent before store open and reuses the exact validated
  socket set. Loopback serving is unchanged; request authorization remains open.
  Its next native transport slice vendors the existing OxHTTP dependency and
  adds socket-derived context plus per-request admission before Expect/body
  decoding. Wire tests close this prerequisite, not full G4.1 authentication.
  The native authenticated profile now adds trusted-peer assertions, complete
  operation/direct Graph Store decisions, public embedding traits, protected
  operator routes, bounded pseudonymous audit and atomic per-request reload.
  Native denial/rollback/restart and compatibility tests verify this product
  slice; ADR-0026's separate evaluator/promotion gates remain open. No G1.7,
  provider-backed qualification or authorization advertisement is implied.
  Evaluator-only `2d54ddfa` closes native G4.1: authenticated route decisions,
  provider/time boundaries, allowed direct graph access and observable absence
  of work under denial pass. The next native task is G4.2 workload admission;
  separate promotion and future facade requirements remain on the roadmap.
  G4.2 now adds opt-in bounded pre-body admission, queue cancellation/expiry,
  a separate operator pool and response-flush lease ownership. Native admission
  and HTTP tests support this slice, not full request-resource governance.
  The native deadline slice adds absolute lease deadlines, typed timeout propagation,
  pre-commit rollback and failed-stream checks for native Simple/transactional
  paths; excluded materialization/bulk paths fail explicitly. ADR-0027 retains
  resource accounting, queued disconnect and full acceptance as open work.
  Finite RDF now shares request control across snapshot/FROM construction,
  materialization and owned reads, with typed expiry and preserved topology.
  The relative materialization budget still ends at successful preparation;
  enclosing request deadlines do not. Finite RDFS now also admits request
  deadlines after checked preflight/copies, sparse scans, consistency/output
  assembly and memory estimation. Native tests preserve graph topology, results
  and successful resource counters. Bounded OWL now also admits deadlines after
  checked preparation, raw rule/list/key/equality/semantic/contradiction work
  and output/accounting. Its native inverse-inference and persistent HTTP journey
  pass. A shared controlled Dataset clone preserves interned IDs and iteration
  order, correcting the preceding RDFS decoded-copy ordering defect. This is
  native product progress, not refreshed semantic qualification. Queued socket
  errors now release admission before timeout on both listeners, with valid
  half-closed requests preserved and abandoned writes absent after restart.
  FIN-only/silent loss still uses timeouts; active-work disconnect propagation
  remains open. Declared encoded/decoded request-body caps now reject oversized
  or expanded content before RDF work on both listeners, preserving trailers,
  HEAD metadata, deadlines and valid persistent journeys. This is not an RSS
  limit. Optional result caps now bound generated and transmitted entities;
  buffered overflow returns empty 503 and late errors fail the stream without
  successful EOF. HEAD/304 metadata and established request failures are preserved.
  Optional cumulative inner-join build-row budgets now cover native Cartesian/hash
  tables across each request, including multi-operation update rollback. Typed
  sticky failure survives empty probes, EXISTS, ASK/UNION and shared SERVICE
  handlers. Streaming joins, other buffers and RSS are explicitly outside this
  counter. Broader resource/fairness/metrics acceptance remains open;
  full G4.2 is not complete.
  The subsequent unbudgeted query-fuzzer OOM is repaired by choosing the smaller
  hash-build input in greedy joins, without changing nullable-path domains or
  SERVICE binding order. Exact-input replay and fresh query/update fuzz lanes
  pass; the expensive streamed fan-out and broader G4.2 work remain open.
  An independent cumulative ORDER BY row cap now limits decoded sort-key/buffer
  construction, preserving order, duplicates, shared failure and owned-update
  rollback. Earlier expression work, comparator CPU and other buffers remain
  outside it; full workload-governance and promotion gates stay open.
  Native admission telemetry now adds 60 fixed-label operator metric samples
  for pool occupancy, returned admission dispositions and queue waits, without
  changing readiness or counting lease release as execution success. Default
  and no-default unit/wire tests cover denial, overload and persistent journeys;
  full G4.2 resource/fairness acceptance remains open.
  An independent cumulative native DISTINCT retained-row cap now charges only
  new tuples before cloning into each hash set, including planner-lowered
  REDUCED. Nested sets and update operations share typed failure and owned
  rollback; duplicates within one set do not recharge. Native feature tests,
  bound/unbound mapping checks and query/update fuzz runs support this slice,
  not aggregate contents or full G4.2 acceptance.
  A native accumulator-group cap now charges new groups before construction,
  including the implicit global group on runtime-empty input. Repeated keys
  do not recharge; nested/prepared execution and all owned update operations
  share the cap and sticky rollback behavior. Independent accumulator/read
  probes and native HTTP journeys support this slice. Per-group DISTINCT sets,
  GROUP_CONCAT contents, temporary keys and RSS remain outside the counter.
  The owner explicitly selected Codex-only execution for this slice after the
  Claude/Fable account pause; this does not assert restored Claude availability.
  For the repair that followed, the owner explicitly selected native Opus
  execution: Claude Code 2.1.261 reporting model `claude-opus-5` with
  `apiKeySource` none, on the native subscription. That session reviewed the
  inherited production patch, repaired and expanded the independent tests, and
  completed the replay and fuzz verification; it did not author the production
  change. That is one observed session, not a restored-account or
  provider-availability claim. A model preference is not an automatic
  safety-block bypass and not authority for an unannounced subscription or
  model fallback.
  The query-fuzzer property-path/DISTINCT OOM preserved under ADR-0027 is no
  longer a release blocker. An
  [empty-probe short-circuit](0023-statistics-and-bounded-join-planning.md#empty-probe-short-circuit-for-cartesian-joins-2026-09-09)
  skips an unbudgeted native quad/path Cartesian build whose right-hand quad
  predicate is absent, and the exact preserved input replays under its unchanged
  memory limit with fresh query and update fuzz runs passing. Configured row
  budgets, older term modes, `SERVICE` and keyed joins keep their previous
  order. ADR-0023 and ADR-0027 remain Proposed; broader resource, fairness and
  reload gates stay open, and no milestone or programme completion follows.
  Native CLI subprocess tests now preserve their selected transport features,
  avoiding a shared-binary overwrite that broke the combined integration run.
  The next ADR-0027 product slice adds file-backed atomic workload-policy reload
  through a new explicit loopback operator grant. One immutable policy snapshot
  stays with each attempt, queued entry and lease; old work drains while new
  prospective caps account for all outstanding occupancy. Candidate class
  coverage is checked under a coherent access read guard, startup listener
  transport envelopes cannot grow live, and invalid replacements preserve the
  last good policy and telemetry. Default/no-default native controller and real
  HTTP tests cover authorization, input rejection, cross-policy unknown classes
  and live limit replacement. This is source delivery under the proportional
  product boundary, not full G4.2 qualification or promotion.
  The owner selected native `gpt-5.6-sol`; implementation used high reasoning,
  followed by parent review, focused corrections and release validation, with
  one source writer at a time and the parent as the only Git writer.
  Local implementation is not publication or production recovery qualification
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
user-level `systemd` timer now runs at `00:00`, `06:00`, `12:00`, and `18:00`
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
`systemd-analyze --user verify`, the timer is enabled and active, and a manual
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
| Difficult Rust, transaction, or SPARQL implementation | Sol High or Opus for the named difficult part |
| Consequential architectural judgment or an unresolved correctness review | Astra High; Xhigh only for a demonstrated need; Fable for a targeted authorized review |
| A particularly hard unresolved problem, or an explicit owner selection | Astra Max/Ultra for that bounded problem, with its reason and completion check recorded |
| Useful independent subtasks | Mixed faster workers chosen by subtask, not automatic Ultra; one Git writer |

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

These are starting policies, not a measured cross-model ranking. Record the
actual model/effort, accepted result, rework, and elapsed time when observed.
Do not fabricate monetary savings from API prices or Git history. Model-router
training, new receipt formats, and benchmarking remain optional future work.
The native Astra Ultra compatibility correction is `7d89e7bc`; historical Sol
contracts and qualification evidence are not rewritten.

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
