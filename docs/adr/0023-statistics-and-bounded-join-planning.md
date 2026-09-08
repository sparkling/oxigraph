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

### Full statistics/planning promotion

Promotion requires:

- identical query results with statistics current, absent, stale, corrupt, and
  optimization disabled;
- deterministic plans for the same statistics snapshot and configuration;
- pinned BSBM, WatDiv, and LDBC subsets with p50/p95 q-error, intermediate
  rows, planning time, resource use, and per-query tail rules;
- bounded memory and planning time for both dynamic programming and fallback;
- no semantic, topology, cancellation, or error-order regression; and
- numeric promotion thresholds frozen only after parent-first baselining.

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
