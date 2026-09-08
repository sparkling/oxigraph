# ADR-0023: Statistics and bounded join planning

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-09-08
- Deciders: Oxigraph parity programme
- Implementation status: G3.1 native physical statistics provider implemented
  below; dataset-aware optimizer integration, estimated/actual-row feedback,
  G3.2 planning and frozen performance/promotion gates remain outstanding
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
RDF merge. No merged-dataset or subject/object-conjunction estimator is offered
in this increment; ordinary evaluator and optimizer behavior remain unchanged.

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

Next, bind dataset-aware estimates to optimizer input and collect estimated versus
actual rows without changing answers or error ordering. That feedback work,
G3.2 bounded planning, and the following promotion requirements remain open.

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
