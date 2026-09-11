# Oxigraph delivery history captured 2026-09-11

This preserves the implementation narrative from `991c480a` while current
status moves to [the delivery gates](oxigraph-delivery-gates.md). It is history,
not active control or new acceptance evidence. Earlier statements about work
still being open describe their point in the sequence, not the final state.
Only the relative ADR link in the first section is adjusted for this location.

## Former ADR-0043 implementation-status narrative

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
  [empty-probe short-circuit](../adr/0023-statistics-and-bounded-join-planning.md#empty-probe-short-circuit-for-cartesian-joins-2026-09-09)
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

## Former duplicated G4.3 plan narrative

G4.3 now provides additive offline `Store::inspect` and the `inspect` CLI command
for version markers and actual/missing/extra column families, without migration
or source-file changes. Ordinary open now rejects unknown/newer markers and
incomplete current layouts before writable setup, with a native lock held across
preflight and open. A checkpoint missing `LOCK` gains an empty one even on
refusal. Recognized version-0/1 layouts now return typed `UpgradeRequired` from
writable/read-only opens; ordinary opens never migrate them. `Store::backup_legacy`
and the separate `LegacyBackupReceipt` now
provide source-preserving version-0/1 physical copies and exact package/source
ancestry verification. Native interruption, cancellation and lock-release tests
pass; the additive `backup-legacy` / `verify-legacy-backup` CLI journeys also
pass alongside existing backup/restore and feature lanes. `Store::prepare_upgrade`
now stages a verified inactive shadow copy while retaining source/backup leases;
`PreparedUpgrade::verify` checks its exact files, metadata, journal and complete
record. This binary refuses guarded copies through ordinary opens, including
after moving the store directory. `Store::transform_prepared_upgrade` now
transforms that copy through the version-0/1 migration edges, with continuous
native leases, independent expected/output checks for quads, graph inventory and
namespaces, and exact source/backup ancestry verification. The bounded Rust API
and `TransformedUpgrade::verify` pass default/RDF-1.2 upgrade, backup/restore,
safe-open and store regression lanes. The additive `prepare-upgrade`,
`verify-upgrade-preparation`, `transform-upgrade` and
`verify-upgrade-transformation` commands now expose this offline operator
journey with explicit limits and inactive-stage output. The output remains
guarded and inactive; this is not activation or upgrade qualification.
The additive `Store::start_upgrade_recovery`, `Store::resume_upgrade_recovery`
and `UpgradeRecovery::verify` APIs now provide verified restart from completed
checkpoints in a separate recovery workspace. Native interruption/cancellation
tests cover both migration edges, publication boundaries, unchanged source/
backup/checkpoints and explicit completed-edge reuse. Old interrupted
preparation/transformation workspaces do not become resumable.
Full compatibility rejection, the envelope/classifier and the
cutover/crash/older-binary matrix remain open.
Compatibility tests now explicitly upgrade private temporary copies, preserving
their
original assertions and committed fixture bytes. Default/RDF-1.2/no-default
store lanes and concurrent upgrade/store commands pass; the earlier shared-
fixture failure remains recorded. The additive `start-upgrade-recovery`,
`resume-upgrade-recovery` and `verify-upgrade-recovery` CLI commands now expose
the existing recovery API. Native default/no-default journeys verify exact
ancestry, incomplete/completed state, retained guards, matching custom limits,
completed resume and refusal without input mutation. This closes the bounded
recovery CLI exposure gap, not G4.3. Native `Store::start_upgrade`,
`Store::resume_upgrade`, `Store::upgrade` and `Store::verify_upgrade` now
provide a sealed build-bound `UpgradeReceipt` for Linux/static Oxigraph with
vendored static RocksDB. The exact executable is bound before construction;
old completed recovery work cannot acquire that earlier provenance. Native
default, explicit RDF-1.2, no-default, unit and existing compatibility checks
pass, including whole-workspace no-write refusal, fresh-process verification,
changed-executable refusal and completed-evidence reuse. Independent review
accepted the exact source through the ordinary harness and Ruflo readback.
This closes the bounded native receipt API, not activation or full G4.3.
The `start-upgrade`, `resume-upgrade`, `upgrade` and `verify-upgrade` CLI now
expose it, with canonical outer paths, exact executable/receipt fingerprints,
explicit incomplete/sealed observations and retained inactive guards. Ordinary
harness checks pass: default CLI receipts (5, including real version-0/1),
no-default (6, including version-1 refusal), existing CLI compatibility (16),
option units (3), selected Clippy and an identified local executable build.
Independent Sol Medium review accepted the exact Terra Medium implementation
and MCP evidence readback completed. This closes receipt CLI exposure only.
Explicit `Store::activate_upgrade` and `activate-upgrade` now make a fresh,
disjoint target usable while retaining source/backup/sealed-workspace bytes.
The original receipt stays inactive; activation is a historical handoff, not
server routing or older-binary rollback. The ordinary harness passed all nine
checks: two Clippy lanes, native units (25), default API (5), RDF-1.2 API/receipt/
recovery (5/9/3), default CLI compatibility (15), no-default CLI (4), option units
(3) and the identified local CLI build. Native Sol High implementation received
independent Astra High acceptance and exact MCP evidence readback. These counts
overlap; they do not close full G4.3. The ordinary-open migration gap is now
closed by typed refusal, with unchanged logical assertions exercised after
explicit activation. A separate test-only transformed-file copy retains the
system-profile test path without changing production activation; its helper is exercised
on vendored RocksDB, while actual system compilation is blocked by missing
`rocksdb.pc`. Builds without `rdf-12` now also reject recognized unsupported
encodings in current-format live object indexes. Nine ordinary-harness checks
and independent Sol Medium review passed for the Terra Medium slice; this
does not certify outbox history or change inspection's unknown feature status.
See [the bounded feature-refusal contract](../adr/0028-safe-storage-schema-upgrades.md#bounded-live-rdf-feature-refusal-2026-09-11).
Bounded outbox consumption now distinguishes valid retained RDF 1.2-only
payloads from corruption, without scanning all history at open; see
[the consumption-time contract](../adr/0028-safe-storage-schema-upgrades.md#bounded-retained-outbox-feature-errors-2026-09-11).
Next: full feature-envelope/history admission, the frozen classifier,
older-binary rollback and frozen acceptance gates. No qualification or
publication is implied. See
[the ordinary-open contract and checks](../adr/0028-safe-storage-schema-upgrades.md#ordinary-legacy-open-refusal-2026-09-11) and
[ADR-0028's activation scope and limits](../adr/0028-safe-storage-schema-upgrades.md#fresh-target-upgrade-activation-api-and-cli-2026-09-11).
