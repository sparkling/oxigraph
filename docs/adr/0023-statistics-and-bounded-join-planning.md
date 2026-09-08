# ADR-0023: Statistics and bounded join planning

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-09-08
- Deciders: Oxigraph parity programme
- Implementation status: G3.1 native physical statistics, dataset-scoped cost
  integration and query-local feedback implemented below; G3.2 opt-in native
  bounded planning is implemented below, with frozen-corpus performance and
  promotion gates still outstanding
- **Depends on**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- **Related**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0033 — Analytical/WCOJ execution](0033-analytical-wcoj-execution.md)

## Context

`sparopt` performs semantics-preserving rewrites and join ordering using fixed
cardinality and selectivity estimates. At programme inception Oxigraph had no
durable statistics provider, freshness contract, or estimated-versus-actual feedback. Text,
spatial, and federation planning would multiply this uncertainty if they each
introduced a separate estimator.

Correctness is already protected by an optimization-disabled path. The first
performance step should improve estimates and bounded join search while
retaining a deterministic heuristic fallback, not introduce a full Cascades
framework or mid-query adaptive executor. RDF4J's sketch experiments and
research systems for worst-case graph-pattern planning and Sparqloscope-style
cardinality analysis are useful comparison inputs, not production authority.

## Decision

Add an optional, rebuildable statistics provider at the optimizer boundary.
Its first profile contains exact graph and predicate counts, bounded sketches
and top-K values, schema/version metadata, and the primary commit through
which it is fresh. Missing, stale, incompatible, or corrupt statistics select
the existing deterministic heuristic and may change performance only.
Estimates are scoped to the active SPARQL dataset specification, including
default and named graph selection, before they influence a plan.

Instrument estimated and actual rows, q-error, intermediate rows, planning
time, and chosen fallback without recording query text or RDF terms by
default. Use deterministic dynamic programming for reorder-safe connected
inner-join components of at most eight leaves and a deterministic greedy
strategy beyond that frozen bound. Do not reorder across `SERVICE`, left join,
`MINUS`, `LATERAL`, filter scope, grouping, ordering, slicing, or graph
boundaries without a separate semantic proof. The bound and cost
model are benchmark configuration, not hidden constants promoted without
evidence.

Statistics consume the durable commit stream from ADR-0020 and follow the
rebuild/readiness contract in ADR-0022. G3.1 delivers statistics and feedback;
G3.2 delivers bounded join enumeration.

A full Cascades memo, learned optimizer, worst-case-optimal join executor, or
mid-query re-planning loop remains research scope. ADR-0033 may promote a
separate analytical path only after G3.2 supplies a stable ordinary-SPARQL
baseline and a differential oracle.

## Acceptance boundary

### G3.1 native physical statistics provider (2026-09-08)

The opt-in `statistics` feature adds
[`StatisticsProvider`](../../lib/oxigraph/src/store/statistics.rs) on the existing
[G3.0 generation lifecycle](0024-rebuildable-derived-indexes.md#g30-native-durable-generations-2026-09-08).
It requires native RocksDB but adds no package or Node dependency. The versioned
profile `oxigraph.statistics.physical.v1` binds the v1 RDF codec, RDF-1.2 feature
mode, checked 64-bit counters, 4×256 count-min tables and 32-counter Misra–Gries
summaries. Bounds are explicit logical ceilings, not learned configuration.

Rebuild streams the exact retained primary snapshot: RDF set quads are counted
once, empty named graphs (IRI or blank) remain visible, and the default graph is
always represented. Exact counts are available per physical graph/predicate and
as physical-dataset totals. Clear preserves graph topology; drop removes it.
**Physical graph sums are not SPARQL `FROM`/union cardinalities.** A triple present
in two graphs contributes two physical occurrences but can collapse to one under
RDF merge. No merged-dataset or subject/object-conjunction estimator was offered
in the provider increment. The query adapter below subsequently adds marginal
upper cost hints, not exact conjunction counts.

Each populated graph/predicate scope has separate subject/object frequency
tables. Canonical RDF term bytes are hashed with SHA-256, with separate row and
position domains. Checked additions never saturate or age away observations.
The minimum cell value supplies only a deterministic upper bound; no randomized
confidence or fixed error-rate claim is made for these fixed hashes. Subject
frequency returns `[0, upper]`. The object summary additionally maintains up to
32 full canonical term keys with Misra–Gries lower counters and decrement mass
`d`: a retained value lies between its counter and counter plus `d`; an omitted
value has lower zero, not necessarily frequency zero. Intersecting this bound
with the count-min upper and exact scope total remains conservative. Candidate
objects are ordered by descending lower count then canonical bytes; they are
heavy-hitter candidates, **not a certified exact top-K ranking**. These standard
frequency-summary algorithms are described in [Dartmouth's data-stream notes,
sections 1.2–1.3 and 5.4](https://www.cs.dartmouth.edu/~ac/Teach/data-streams-lecnotes.pdf).

The Brain's retrieved [RuVector access-temperature sketch](https://github.com/ruvnet/ruvector/blob/main/crates/rvf/rvf-quant/src/sketch.rs)
uses saturating 8-bit counters and aging, which are unsuitable for durable RDF
frequencies. Its source informed this distinction; no RuVector engine or code
copy is introduced. RDF keys use this fork's existing canonical change codec,
including its 32-level nested-triple representability boundary. Unsupported
or oversized terms fail typed rather than silently disappear from statistics.

Default ceilings are 1,024 graphs (including default), 1,024 populated scopes,
1 MiB per encoded record, and 64 MiB retained logical state/payload. Each scope
charges both tables (16 KiB) plus key/metadata allowance before allocation;
retained heavy keys are charged before insertion and released on eviction.
Input and generation limits also apply. One source record, decode/serialization
buffers, the loaded candidate and independent reconstructed state can coexist;
these limits are not an RSS quota. Controls are checked at scan, scope, file-copy
and candidate boundaries; a single codec/hash operation is not preemptible.

The single immutable `statistics.v1` payload checks canonical ordering, scope
membership, positive counts, each sketch row's exact total, and Misra–Gries
conservation (`sum(counters) + 33*d == scope_count`). Lifecycle checksums alone
are insufficient: reconciliation independently reconstructs statistics from
the same source, and native reads verify payload bytes against their retained
inventory again before repeating that comparison. Read accepts only strict
views and returns an owned `StatisticsSnapshot` with full source checkpoint and
generation fingerprint; missing/stale/corrupt inputs remain typed failures.
An eventual view cannot masquerade as fresh statistics. Releasing the snapshot
does not turn its observations into current-store counts.

Catch-up first receives the complete delta validated by G3.0, opens the previous
payload, then deliberately recomputes from the supplied source. It handles
deletes, compact graph barriers and ungoverned changes without treating an
insertion-only heavy-hitter summary as decrementable. There is no incremental
maintenance or speed claim. Existing activation, readiness, backup contribution,
restore reconciliation and imported-generation APIs are reused unchanged.

The [native tests](../../lib/oxigraph/tests/statistics.rs) cover empty topology,
duplicate inserts, physical-versus-merged counts, independently counted frequency
bounds, canonical RDF terms, strict lag, recomputation, rollback/reopen,
deterministic payloads, resource/control failures, corruption after admission,
validly checksummed but semantically wrong payloads, and backup/restore/import.
Run the [usable example](../../lib/oxigraph/examples/statistics.rs) with
`cargo run --locked -p oxigraph --features statistics --example statistics`.
No query text or RDF values are automatically exported as metrics; calling
`frequent_objects` explicitly returns RDF data and is not a telemetry endpoint.

### G3.1 native query costs and feedback (2026-09-08)

[`PreparedSparqlQuery::on_statistics`](../../lib/oxigraph/src/sparql/statistics.rs)
strictly admits and independently reads the statistics generation, then binds
ordinary RDF evaluation to a reader of the **same retained `DerivedSnapshot`**.
It never opens a newer Store snapshot. Context exposes the exact source,
optional generation fingerprint and fixed current/missing/stale/rejected
classification. Admission does not repair, activate or replace a generation.
Cancellation/deadlines remain fatal before evaluation and at consumer boundaries;
unavailable, stale, incompatible or corrupt statistics select heuristic planning.

The memory-only [`CardinalityEstimator`](../../lib/sparopt/src/cardinality.rs)
seam has no storage dependency or planning-time I/O. Its native adapter scopes
counts to the physical default graph, one selected `FROM` graph (deduplicating
repeated selection of that same graph), or an allowed constant `GRAPH` name.
An empty selected dataset or excluded graph supplies a zero **cost hint**, never
an algebra-elimination rule. Merged/union defaults, variable graphs, paths,
repeated-variable equality, triple patterns and unsupported marginals use the
existing deterministic heuristic. Constant subject/object marginals supply the
minimum of their conservative upper bounds and the exact scope total, not an
independence estimate or exact conjunction. Query substitutions and disabled
optimization bypass external hints; update and staged-transaction paths are
unchanged.

Costs feed the existing greedy ordering only within flattened same-graph basic
quad joins. The adapter does not move operations across `SERVICE`, retained
`GRAPH`, optional/filter/group/slice or other non-basic boundaries. Retained
dynamic graph scopes clear hints before descending. Existing heuristic formulas
and tie ordering remain the fallback; zero estimates never remove RDF reads.
G3.2 dynamic programming and its frozen eight-leaf bound are **not implemented
by this increment**.

[`QueryExplanation::cardinality_feedback`](../../lib/spareval/src/feedback.rs)
provides explicit query-local, term-free structured observations: fixed operator
class, quad-leaf estimated rows and statistics/heuristic basis, observed rows
including intermediate operators, invocation/EOF/failure/abandonment/input-bound
counts, planning duration and q-error. It exports no query text, variable names,
RDF values or file paths, and does not automatically publish metrics. The legacy
explicit JSON explanation retains its existing term-bearing format.
Leaf estimates are hypothetical unbound per-invocation costs, recomputed from
the deterministic retained estimator when evaluation is constructed; they are
not historical records of a correlated probe's planning-time cost.

Only one unbound invocation exhausted without error/abandonment is a complete
cardinality observation. ASK short-circuit, LIMIT, dropped iterators, correlated
or repeated probes and failed scans cannot claim complete leaf q-error.
Q-error uses `max(estimate,1)` and `max(actual,1)` and is a floating diagnostic;
the integer observations are separately available. Non-leaf estimates/q-error
are not claimed in this profile. Failure and abandonment counters may overlap
when a failed iterator is dropped before EOF. Timing failure no longer truncates
the statistics-wrapped result iterator.

Native regressions cover same-snapshot reads after a new write, selective join
ordering and result equivalence, absent/stale/corrupt fallback, selected and
merged graphs, substitutions, disabled optimization, early exit, cancellation,
and error observations. The existing statistics example now also exhausts a
SPARQL query and checks three estimated/actual rows with complete q-error one.
This G3.1 handoff did not implement bounded planning; the subsequent G3.2
increment below does. The performance/promotion requirements remain open;
neither native handoff makes a measured query-speed claim.

Required query fuzzing also exposed a pre-existing SEP lateral-rewrite defect:
the optimizer treated every `OneOrMorePath` as safe to correlate even when its
operand could match zero length, such as `(p*)+`. A recursive nullability check
now preserves independent variable-endpoint path evaluation in that case.
Endpoint checks recurse through RDF 1.2 triple patterns, including nested
subject, predicate and object variables. A separate regression reproduced an
incorrect lateral identity match before this recursive check and passes after
it. Both path regressions explicitly enable the SEP-0006 rewrite they exercise.
It does **not** reject standalone zero-length paths at fixed RDF terms outside
the graph. Native optimized/unoptimized tests cover both boundaries, following
the distinct fixed-term and variable-endpoint definitions in
[SPARQL 1.1 section 18.4](https://www.w3.org/TR/sparql11-query/#defn_evalPropertyPath).
The discovered fuzz input is retained locally; no frozen expected result or
historical evidence was replaced to make validation pass.

### G3.2 opt-in native bounded planning (2026-09-08)

[`BoundedJoinPlanning`](../../lib/sparopt/src/optimizer/bounded.rs) exposes an
explicit leaf bound from one through eight and cost-model identity
`oxigraph.join-work.v1`. The default option value is eight, but ordinary
`Optimizer`, `QueryEvaluator` and `SparqlEvaluator` entry points remain greedy.
Call `with_bounded_join_planning` to opt in, with or without statistics and
without a RocksDB or new package dependency. SELECT, ASK, CONSTRUCT and DESCRIBE
use the option. Disabled optimization and variable substitutions bypass it;
update planning is unchanged.

After existing normalization, only a flattened group consisting entirely of
same-graph basic quad leaves is eligible. Connected components are separate
searches; larger components and groups containing other algebra retain greedy
planning. Discovery stops once a component exceeds the configured bound.
DP never brings a path, SERVICE or scoped expression into its leaf set, and
does not cross optional, MINUS, filter, grouping, ordering or slicing boundaries.
Retained dynamic GRAPH scopes clear external statistics before recursion, and
SERVICE bodies remain opaque. Existing pre/post optimizer rewrites are retained.

The search keeps one best left-deep state per connected subset, considering
each legal last leaf. Hash joins use canonical variable-key order. When the
existing SEP-0006 admission proof allows it, a lateral candidate probes one
basic quad. Subset row estimates use a fixed ascending-source-ordinal fold of
leaf hints and the existing shared-key selectivity; they do not depend on the
chosen physical plan. The cost model charges leaf scans, hash/probe work and
intermediate rows, using saturating 128-bit work arithmetic. Equal costs select
original leaf ordinals and then operator rank. Zero hints never remove leaves.
This is bounded left-deep enumeration, not a bushy or globally optimal planner.

At eight leaves a search has at most 255 populated states and 2,048 candidate
considerations. These are logical per-component work bounds, not a global
query deadline or RSS quota; query term sizes and the number of components
still matter. The public term-free `QueryExplanation::join_planning` report
identifies the effective profile, DP/greedy components, states and candidates.
Counts include speculative searches; greedy counts include singleton fallback.
No query text or RDF terms are automatically exported, and the legacy explicit
JSON explanation format is unchanged.

Native optimizer tests cover eight/nine-leaf selection, early fallback,
deterministic plans/keys, disconnected and duplicate leaves, zero/max hints and
ineligible groups. [Query differential tests](../../lib/oxigraph/tests/bounded_join_planning.rs)
compare against optimization-disabled evaluation across graph/dataset scope,
multisets, all query forms, RDF 1.2 term modes and cancellation. Their test-local
graph-isomorphic result encoding preserves duplicate/empty rows and a consistent
blank-node bijection across FROM executions; it does not alter RDF merge rules.
[Statistics tests](../../lib/oxigraph/tests/statistics.rs) compare advisory and
heuristic planning and show lower observed scan work on one constructed join.
That fixture is not a representative speed benchmark. Query fuzzing now compares
both ordinary and opt-in bounded evaluation with the independent unoptimized
dataset path. The [statistics example](../../lib/oxigraph/examples/statistics.rs)
exercises the option after rollback, catch-up and restart and prints search counts.

**G3.2 remains in progress for frozen-corpus acceptance.** Before a speed claim
or default promotion, measure admission separately from planning/execution:
the strict statistics adapter currently reconstructs primary statistics during
admission. Native correctness and lower work on one fixture do not establish
end-to-end improvement on BSBM, WatDiv or LDBC.

### Explicit verified-snapshot reuse and diagnostic baseline (2026-09-08)

The first small native BSBM pilot demonstrated that strict per-query statistics
reconstruction dominates short queries. `PreparedSparqlQuery::on_statistics_snapshot`
now accepts `Arc<StatisticsSnapshot>` obtained from the existing independent
`StatisticsProvider::read` verification. Its fields remain private and immutable.
The supplied `DerivedSnapshot` must match the **entire physical checkpoint**
and a private process-local open-instance identity; otherwise the adapter reports `Stale`, supplies no
generation hint, and evaluates that supplied source with heuristic costs.
Dataset scoping, optimization/substitution bypass and cancellation/deadlines
remain in the shared query adapter. This adds no dependency or implicit cache.

Checkpoint equality alone is insufficient: copied sibling stores can have
identical persisted IDs, sequences and receipts but divergent contents, as
already established in ADR-0024. Storage creates an unexported `Arc` identity
per open and shares it only with Store clones and their derived snapshots;
independent statistics verification retains that token. Pointer identity plus
checkpoint equality admits reuse without a primary scan. A reopen, read-only
reopen or copied directory conservatively needs new verification, even if its
RDF is unchanged. The token retains neither a database handle nor an MVCC
reader, is never serialized, and changes no persisted profile or manifest.

An owned, verified observation remains usable for its exact retained source
after a later primary write or generation-file corruption. It is not a current
file-integrity claim, and never reads a newer store or refreshes a generation.
The original `on_statistics` and `StatisticsProvider::read` contracts still
reopen/verify/reconstruct on each call. Callers choose explicit reuse and must
account for initial verification and retained memory/snapshot costs. Native
tests cover source drift, a different store with identical RDF, copied siblings
with equal physical checkpoints but different contents, Store clone versus
reopen behavior, retained old
results after a write, corruption after verification, cancellation, deadline,
and greedy/bounded result equivalence through the shared path.

The [native SELECT comparison](../../bench/query-benchmark.md) reports byte
identities, uninstrumented latency samples, separately instrumented feedback,
exact result comparisons and a completion marker. Its 100-product BSBM Q1/Q2
pilot identifies the avoided admission scan but also a bounded-without-statistics
Q1 regression. Default greedy planning is therefore unchanged. It is a small,
noisy same-binary diagnostic, not a historical-parent qualification or frozen
BSBM/WatDiv/LDBC acceptance. At parent `8b5b6002`, the required G3.2 corpus
manifests and numeric thresholds did not exist; candidate percentages in the
plan were only hypotheses. G3.2 stays active for broader corpus preparation,
controlled parent-first baselining, resource/tail gates and threshold review.

### G3.2 opt-in conditional cost model v2 (2026-09-08)

The Q1 trace identified two cost errors **inside the same five-leaf DP group**:
the old `rdf:type` scan preference also inflated a fully bound membership probe
from one row to two, and independent subset estimates favored an eager numeric
hash-side scan. This was not a surrounding join-boundary failure; the report
had one DP component, 31 states and no greedy component. No cross-boundary
planner rewrite is introduced to fix an unobserved cause.

`BoundedJoinCostModel::ConditionalV2` explicitly selects
`oxigraph.join-work.conditional.v2` through
`BoundedJoinPlanning::default().with_cost_model(BoundedJoinCostModel::ConditionalV2)`.
Pass this option to `SparqlEvaluator::with_bounded_join_planning`. Existing constructors,
the option default and legacy `COST_MODEL` constant retain `IndependentV1`
and `oxigraph.join-work.v1`; ordinary planning remains greedy. Consumers should
identify an instance using `cost_model().id()`, also emitted by the diagnostic
runner for each sample. The public enum is non-exhaustive for future explicit
profiles. This changes no persistence format or semantic specification.

V2 retains the eight-leaf ceiling, eligible same-graph connected quad groups,
one physical state per subset, saturating work arithmetic, deterministic ties,
and existing hash/lateral admission rules. For each subset in ascending mask
order, start with the canonical recurrence using already computed prefix rows.
Then take the minimum with each **connected** prefix's rows multiplied by the
remaining connected leaf's conditional probe estimate, saturating at `u64::MAX`.
These subset hints are computed before selecting physical states and do not
depend on the winning execution order. A disconnected prefix cannot bind both
endpoints before probing a bridge in this connected left-deep search. The
membership estimate is capped at one only when subject, predicate, object and
the single active graph are all fixed/bound; an unbound graph variable is not
capped. Other heuristic estimates and unbound scan preferences are retained.
These are advisory costs, not semantic upper bounds, algebra-elimination rules,
global optimality, or a default-promotion claim. Conditional estimates add
bounded per-subset work; state/candidate counters do not include that work.

A native 100-type-row/selective-feature regression preserves the exact result
while reducing observed quad rows from 204 to 7 and bound invocations from 103
to 6. Separate tests cover disconnected-prefix cost ordering, single-graph
membership, determinism, eight/nine-leaf bounds, zero/max hints, both query
profiles across result forms, graph scopes, cancellation and RDF 1.2, and
current/missing/shared statistics. Query fuzzing also evaluates both profiles.
The [local parent-first BSBM comparison](../../bench/query-benchmark.md) retains
v1 and reports v2 separately. The two-query pilot does not close the full G3.2
corpus, resource/tail or promotion gate; G3.2 remains active.

The expanded local pilot now covers all ten upstream BSBM Explore SELECT
templates, with explicit fixed parameters and unchanged Q1/Q2 identities.
Parent/candidate comparisons return identical results but expose remaining
Q8 and shared-statistics Q5 scan-work regressions. Single-mode execution gives
each process the same declared workload envelope for RSS observations; it does
not measure isolated planner allocations. These are diagnostic acceptance
inputs, not new semantic behavior or a frozen performance pass. See the
[input identities and reproduction](../../bench/query-benchmark.md#ten-template-select-pilot-and-isolated-mode-selection).

### G3.2 opt-in correlated cost model v3 (2026-09-08)

`BoundedJoinCostModel::CorrelatedV3` identifies
`oxigraph.join-work.correlated.v3`. V1, V2 and ordinary/default options retain
their contracts. V3 retains V2's plan-independent conditional subset hints,
membership correction, component eligibility, deterministic ties and eight-leaf
bound. It changes only two physical-cost decisions:

- For an admissible lateral over one quad, charge parent work, one range lookup
  per parent row, and twice the subset row estimate: once for matching RHS rows
  and once for emitted join rows. These are distinct operations using the same
  estimated occurrences. The old profiles multiply an independent per-probe
  hint instead; all formulas remain available under their original identities.
- Prefer a legal indexed probe over an unbound hash RHS when that exact leaf
  has no applicable estimator hint. A registered estimator returning `None`
  does not count as a hint. As in base estimation, outer-bound pattern variables
  exclude unbound estimator authority. An actual hint allows the existing hash
  candidate and unchanged hash work formula; if lateral is ineligible or
  SEP-0006 is disabled, hash remains available regardless of hint presence.

This is a conservative strategy under unknown fanout, not a claim that RDF
properties are single-valued or that indexed probes always outperform scans.
No cardinality hint, including zero, removes data or algebra. No predicate
fanout constant, persistence format or semantic boundary changes.

The Q8-shaped native fixture first failed with 1,064 unbound quad rows, both
under V2-equivalent costs and under the formula-only correction. Its bound
probe heuristic still compounded tenfold fanout; the second rule is needed
without statistics. The final profile scans only the selected 14-row range,
with the same six result rows, both without and with shared statistics.
Tests also retain V1/V2 work expectations, cover declining and mixed estimators,
permit a hash join for a hinted expanding case, and extend differential,
eight/nine-leaf, extreme-hint, cancellation and RDF-1.2 checks to V3.
The native comparison exposes V3 explicitly. These native and workload checks
do not close full corpus, resource/tail acceptance or default promotion.

### Avoid rejected-candidate tree construction (2026-09-08)

Candidate admission, estimator calls, cost arithmetic and the complete
`(work, source order, operator)` tie-break remain unchanged. The search now
clones/builds an expression tree only when that candidate improves the current
winner. Rejected candidates still increment the speculative candidate count;
populated states and all three cost identities are unchanged. A native helper
regression fails when eager construction is restored, and checks that equal
work with better order/operator still replaces the winner.

The [planner-only diagnostic](../../bench/query-benchmark.md#planner-only-resource-diagnostic)
checks eight-leaf search and nine/64-leaf fallback without loading a store.
Exact retained-parent/candidate plans and reports match. These bounded
synthetic observations supplement, but do not close, representative corpus,
allocator/resource, tail or numerical acceptance. Default planning is unchanged.

### Full statistics/planning promotion

Exact graph/predicate lookups now use the verified canonical scope index instead
of scanning every scope. The snapshot retains its admitted record-size ceiling
and rejects oversized lookup keys before cloning/encoding. Wildcard counts,
frequency estimates, payload/profile identity and source admission are unchanged.
The native regression compares indexed references/counts against enumeration
over 600 default/named/blank-graph scopes, including missing and oversized keys.
This is a lookup-cost correction, not a new estimator or planner cost profile.

The [fixed WatDiv input contract](../../bench/query-benchmark.md#fixed-watdiv-input-and-baseline-preparation)
now identifies the intact official 10M archive and six unchanged stress-query
lines. Explicit diagnostic input ceilings support this dataset without changing
store/provider defaults or optimizer semantics. Input checks and a greedy pilot
do not ratify numerical gates or establish full corpus acceptance. The
[parent-path preparation](../../bench/query-benchmark.md#parent-path-baseline-preparation-2026-09-08)
now includes all ten fixed BSBM SELECT queries and an official-source LDBC Q7
subset preserving N-Quads graph identity. Explicit query-only diagnostic setup
does not replace historical statistics setup or bypass a statistics mode's
verification. Repeated parent measurements expose shared-host p95 variability
larger than the proposed 5% threshold; that hypothesis is not ratified.
The existing 10 BSBM, six WatDiv and one LDBC SELECT inputs, together with the
native semantic/state and eight/nine/64-leaf boundary tests, define the bounded
scope of `G3.2-opt-in-select-v1`; full official suites and mixed writer workloads
are not additional prerequisites for that scope. DP/fallback resource acceptance
and repeatable parent-first resource/tail measurements remain open. Opt-in acceptance and a
default-planner promotion are separate decisions. The stronger separate
programme-decider pre-run prerequisite introduced in `1771b64e` was a reviewer
interpretation, not the original acceptance contract, and is corrected here.
Ordinary opt-in acceptance requires deliberately freezing the versioned corpus,
thresholds and noise rules after parent-first baselining and before its gated
candidate run. It does not require another manual approval round. This grants
no default promotion, protected-evidence refresh or qualification authority.

Promotion requires:

- identical query results with statistics current, absent, stale, corrupt, and
  optimization disabled;
- deterministic plans for the same statistics snapshot and configuration;
- pinned BSBM, WatDiv, and LDBC subsets with p50/p95 q-error, intermediate
  rows, planning time, resource use, and per-query tail rules;
- bounded memory and planning time for both dynamic programming and fallback;
- no semantic, topology, cancellation, or error-order regression; and
- numeric promotion thresholds frozen only after parent-first baselining.

The native statistics-state matrix now adds 200 exact solution-bag comparisons
for ten SELECT shapes across greedy, optimization-disabled and V1/V2/V3 planning.
It distinguishes stale file admission, corrupt files at matching checkpoints,
stale shared observations and still-valid owned observations after file corruption.
The stale case includes a newly inserted join whose predicate had a zero count
in the old statistics. Together with the existing current/missing tests, this
closes that focused fallback-coverage gap, not representative performance or
default promotion. Fixtures are private temporary stores; no pinned evidence
is corrupted or replaced by these tests.
An additional 48 executions compare complete serialized plans (excluding only
wall-clock planning duration), exact search reports and solution bags using
one verified, retained statistics snapshot: V1/V2/V3 at eight-leaf DP and
nine-leaf greedy fallback. This closes the native retained-snapshot determinism
check; synthetic estimator determinism is no longer its only evidence.
The [machine-checked input manifests](../../bench/query-benchmark.md#machine-checked-input-identities)
pin the existing 10 BSBM, six WatDiv and one LDBC SELECT inputs and their graph
interpretations. They reject input drift but do not imply general workload
coverage or freeze numerical acceptance rules. The completed no-statistics
WatDiv V3 diagnostic preserves all 192 oracle comparisons but scans 55,720 quad
rows for Q4 versus greedy's 36,144. Its earlier genre expansion is a plan-quality
limitation under heuristic fanout, not evidence of a violated V3 formula.
The subsequent shared-statistics comparison below diagnoses the remaining
join-domain error; old profile formulas and acceptance gates stay unchanged. See the
[measured diagnostic and lookup correction](../../bench/query-benchmark.md#watdiv-v3-and-statistics-lookup-diagnostic).
The native comparator now accepts explicit unique mode subsets, retaining its
round rotation and oracle checks. A pair can share one verified statistics
setup; this changes diagnostic selection only, not admission or product APIs.

### Optional source-derived domains and cost model v4 (2026-09-08)

The completed paired shared-statistics WatDiv run at `ff580f2037` preserves
384/384 oracle comparisons but fails performance: Q4 reads 175,870 quad rows
under V3 versus greedy's 4,603; Q2 reads 17,902 versus three. Q4's complete
leaf estimates are already exact. Correcting frequency-sketch noise cannot
repair its join estimates, which assume a fixed 1,000-value key domain.
These results justify an explicit domain-aware candidate, not changing V3 or
relaxing thresholds. [Raw identities and measurements](../../bench/query-benchmark.md#paired-shared-statistics-failure-and-domain-aware-candidate)
remain distinct from acceptance.

`StatisticsProvider::read_with_distinct_estimates` optionally derives subject
and object distinct-value estimates during the **same independent primary
reconciliation scan** as ordinary `read`. The owned snapshot exposes their
separate profile and physical graph/predicate lookup. No new generation is
written or activated; `statistics.v1`, its fingerprint, ordinary `read`,
source checkpoint and private live-open identity retain their contracts.
The bound query's `distinct_estimation_profile()` accessor identifies admitted
observations, not whether a particular query actually used them. Stale reuse
clears that identity; the existing public context struct is unchanged.

The profile `oxigraph.statistics.distinct.sha256-hll10-fixed48.v1` binds codec 1
and the RDF-1.2 feature flag. Each populated physical scope has two 1,024-byte
HyperLogLog register arrays, using the first 64 bits of SHA-256 over the
`oxigraph.statistics.distinct.sha256-hll10.v1\0` domain, a position byte and
canonical term bytes: ten index bits and 54 rank bits. Registers start at zero;
the raw coefficient is exactly `0.7213/(1+1.079/1024)`. Harmonic sums and raw
rounding use `u128`. Below/equal `2.5m`, nonzero empty-register counts select
linear counting; the logarithm uses a 48-fractional-bit, 32-term normalized
atanh series with integer truncation and final half-up rounding. Estimates
are clamped to zero for empty scopes or `[1, occurrences]` otherwise.
This bounded variant follows [HyperLogLog's raw and small-range algorithms](https://algo.inria.fr/flajolet/Publications/FlFuGaMe07.pdf),
not its 32-bit large-range correction. Fixed hashes and these advisory
estimates carry no advertised confidence or exact-distinctness guarantee.
The additional default 4 MiB logical ceiling charges scratch/result keys,
both arrays and metadata before scope allocation; it is not an RSS quota.
Existing scan limits, cancellation and deadlines apply through finalization.

`BoundedJoinCostModel::DomainAwareV4` selects
`oxigraph.join-work.domain-aware.v4`. V1/V2/V3 never call the new default-`None`
variable-specific estimator seam. V4 only requests direct non-repeated
subject/object variables with a fixed predicate, supported single physical
graph, no nested triple pattern and no outer-bound pattern variable. The
adapter declines merged defaults; fixed opposite endpoints clamp scope NDV
to the leaf row hint, an advisory domain estimate, not a conjunction statistic.

For the canonical highest-ordinal one-key subset extension with both domains known, replace
the old denominator with `max(prefix_ndv, leaf_ndv, 1)` in the checked `u128`
row product. Missing or multi-key domains retain the V3 recurrence; unknown
domains are never synthesized from row counts. For each subset/variable,
take the minimum known original leaf domain capped by that subset's rows,
independently of its winning execution order. V3's conditional row caps,
physical hash/probe costs and admission rules remain. Alternative last-leaf
decompositions contribute only those existing conditional caps, not additional
NDV estimates. Existing eight-leaf
and candidate/state bounds are unchanged; optional domain maps add bounded
per-subset work/state, not a new global memory or timing guarantee.

Native tests cover integer extremes/rounding, physical scopes, limits,
unchanged payloads, stale/copied/reopened identity, dataset/term fallback,
legacy callback isolation, deterministic eight/nine-leaf plans and exact
result bags. A constructed three-leaf join reads 3,000 rather than V3's 5,000
quad rows for the same 1,000 solutions. This is a product regression test,
not representative speedup. Ordinary greedy/default options remain unchanged;
G3.2 corpus/resource/tail acceptance and default promotion remain open.

## Consequences

- One estimator can serve local, indexed, and federated planning.
- Statistics lag affects plan quality but cannot affect result correctness.
- Collection and feedback add write/read amplification and privacy-sensitive
  telemetry constraints.
- A full memoizing optimizer and adaptive query execution remain later
  hypotheses.

## Alternatives rejected

- **Start with Cascades or adaptive execution.** The repository lacks the
  measurements needed to justify the larger control surface.
- **Make statistics mandatory.** Embeddable and custom datasets need a correct
  fallback.
- **Optimize only benchmark totals.** Per-query tails and intermediate rows
  expose regressions hidden by a geomean.

## Evidence and task ownership

The current estimates are in
[`optimizer.rs`](../../lib/sparopt/src/optimizer.rs), and the correctness
fallback is exercised by the existing optimizer and no-optimization tests.
G3.1-G3.2 own delivery in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
