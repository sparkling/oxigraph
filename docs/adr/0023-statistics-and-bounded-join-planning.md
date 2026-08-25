# ADR-0023: Statistics and bounded join planning

- Status: Proposed
- Date: 2026-08-24
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G3.1-G3.2
- Depends on:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- Related:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0033 — Analytical/WCOJ execution](0033-analytical-wcoj-execution.md)

## Context

`sparopt` performs semantics-preserving rewrites and join ordering using fixed
cardinality and selectivity estimates. Oxigraph has no durable statistics
provider, freshness contract, or estimated-versus-actual feedback. Text,
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
