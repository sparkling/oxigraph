# ADR-0033: Analytical/WCOJ execution

- Status: Proposed
- Date: 2026-08-25
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; the existing `sparopt` and
  `spareval` paths remain the only production SPARQL planner and executor
- Programme task: `task-1787670633003-hoxn3e` (G4.8)
- Depends on:
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md)
- Related:
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md),
  [ADR-0032 — Incremental entailment projections](0032-incremental-entailment-projections.md)

## Context

The current optimizer builds ordinary SPARQL operator plans and applies fixed
or, under ADR-0023, bounded cost-based join ordering. That path is appropriate
for most transactional queries. Cyclic and highly connected basic graph
patterns can nevertheless produce large binary intermediate relations even
when the final result is small. Worst-case-optimal join algorithms such as
generic join or leapfrog triejoin are a plausible analytical optimization for
that narrow shape.

They are not automatically faster. They require compatible ordered seek
cursors, a good variable order, careful multiplicity handling, and additional
cancellation and memory accounting. Stars, selective index nested loops,
small joins, OPTIONAL-heavy queries, and streaming first-row workloads may be
worse. A theoretical bound for one pure conjunctive component is not an
end-to-end SPARQL latency guarantee. This repository therefore needs a
research and benchmark decision, not a new default executor based on the name
of an algorithm.

## Decision

Build a frozen experimental analytical path for eligible local conjunctive
join components, initially disabled and selected only by explicit evaluator
configuration. It remains an optional operator inside ordinary SPARQL
planning; it does not replace `sparopt`, `spareval`, or the
optimization-disabled correctness path.

The public experiment is configured through an additive
`AnalyticalExecutionOptions` on `SparqlEvaluator`, with modes equivalent to:

- `Disabled`, the stable default and current behavior;
- `Explicit`, which attempts the analytical operator for eligible components
  and otherwise reports or uses a declared standard fallback; and
- `Auto`, which may be promoted only after ADR-0023 statistics and the
  benchmark gates in this ADR establish a deterministic selection rule.

Options pin maximum component patterns and variables, memory, seeks,
intermediate/output rows, wall time, cancellation, variable-order strategy,
and fallback policy. Server policy may reduce those limits or disallow the
mode; a query parameter alone never grants analytical resource authority.
Service description does not advertise a new SPARQL language feature because
result semantics are unchanged. A privileged explain surface reports the
chosen operator and bounded reason codes.

Eligibility begins after algebra normalization and selects only a connected,
reorder-safe local inner-join component of triple or quad patterns whose graph
scope and active dataset are fixed. The first profile excludes `SERVICE`,
property paths, left join/`OPTIONAL`, `MINUS`, `UNION`, `LATERAL`, subqueries,
aggregation, order/slice boundaries, expressions with observable errors, and
any component whose blank-node or variable scope cannot be preserved. Filters
may run outside the component only where the existing optimizer already proves
that placement safe. Later profiles require separate semantic evidence.

The first storage experiment uses a crate-private analytical-access capability
over a stable built-in Store snapshot. It provides ordered prefix seek, value
advance, end-of-domain, and cancellation through existing quad index orders;
it does not extend `QueryableDataset` or require replacement backends to
implement trie cursors. A variable order is eligible only when every pattern
has a supported cursor order. Missing capability, unsupported ordering,
read-only feature combinations, stale statistics, or budget refusal selects
the ordinary executor before any result is emitted. A public replacement-
backend trait is considered only after the cursor contract survives the
experiment and gains an external compile fixture.

The analytical operator enumerates one binding at a time in deterministic
variable order and preserves SPARQL multiset semantics. Although an RDF graph
contains no duplicate triples, duplicate input solution mappings and
projection can create multiplicity; seed-binding multiplicity is carried
through rather than collapsed. Named-graph variables, RDF 1.2 triple terms,
blank-node terms, unbound variables, and term ordering use the same model
semantics as the standard executor. Result row order remains unspecified unless
SPARQL `ORDER BY` applies outside the component.

Cancellation and all resource checks occur during seek, intersection,
descent, backtrack, and row production. If the analytical operator fails after
streaming begins, evaluation returns the typed query error; it cannot restart
the standard plan and duplicate already emitted rows. Before streaming, a
declared unsupported/budget disposition may fall back deterministically.
`SERVICE` stays outside the component and retains ADR-0019/ADR-0025 egress,
timeout, and error behavior.

ADR-0023 statistics choose candidate components and variable orders but are
never correctness inputs. Missing or corrupt statistics disable `Auto` and
cannot change answers. No new persistent index is added in the first
experiment. A later index or columnar representation would be rebuildable
derived state with its own ADR-0028 migration and ADR-0022 recovery contract.
An ADR-0032 entailment overlay may act as the query dataset only after its
snapshot and commit identity are fixed; WCOJ does not weaken its freshness
rules.

## Security and operational behavior

- ADR-0027 enforces per-query, principal, repository, and global limits before
  analytical planning and throughout execution. Budget exhaustion is typed
  and cannot trigger an unbounded fallback.
- The path performs no new network or file access. Remote `SERVICE`, `LOAD`,
  and document access retain their existing policies and are not analytical
  cursor sources.
- Default telemetry records operator, eligibility/fallback reason, pattern and
  variable count buckets, seeks, rows, planning/execution time, memory bucket,
  and cancellation disposition. It excludes query text, RDF terms, graph IRIs,
  principals, and raw cardinalities that violate the metrics policy.
- Explain output containing algebra or term details is privileged and bounded.
  Ordinary error responses do not reveal storage index layout.
- Resource reservation includes cursor count and pinned-snapshot lifetime so a
  slow client cannot keep arbitrary analytical state alive.

## Explicit non-goals

- Replacing ordinary SPARQL planning or enabling `Auto` by default.
- Claiming every SPARQL query, every join, or end-to-end execution is
  worst-case optimal.
- Distributed joins, implicit federation, GPU execution, a columnar warehouse,
  graph algorithms, or a general vectorized engine.
- Adding persistent indexes before the existing index orders have a measured
  insufficiency.
- Changing SPARQL result, error, blank-node, graph, ordering, or multiset
  semantics for performance.
- Promoting from a theoretical complexity argument without workload evidence.

## Staged evaluator and benchmark gates

1. **Eligibility oracle.** Frozen algebra fixtures prove exact inclusion and
   exclusion around graph scope, OPTIONAL, MINUS, UNION, SERVICE, LATERAL,
   filters, subqueries, grouping, ordering, slicing, and RDF 1.2 syntax.
2. **Semantic differential evaluator.** Generated and hand-written cyclic,
   acyclic, star, skewed, empty, duplicate-seed, named-graph, blank-node, and
   triple-term queries compare multisets and error disposition with the
   standard and optimization-disabled paths. Every random failure records a
   shrinkable seed.
3. **Cursor/storage evaluator.** Memory and RocksDB snapshots prove seek order,
   prefix boundaries, cancellation, read-only open, mutation isolation,
   unsupported custom-dataset fallback, and absence of new persistent schema.
4. **Adversarial resource evaluator.** Heavy hitters, disconnected patterns,
   Cartesian-product risk, output explosion, slow result consumers, deadline,
   cancellation, and every configured budget terminate within their declared
   bounds without partial fallback replay.
5. **Research benchmark.** Pinned triangle, clique, cycle, star, BSBM, WatDiv,
   and LDBC subsets compare explicit analytical and standard plans on identical
   snapshots. Receipts record planning time, time to first row, p50/p95 total
   time, seeks, intermediate/output rows, peak RSS, CPU, and per-query tails.
   Acyclic and selective negative controls are mandatory.
6. **Promotion gate.** `Auto` remains unavailable unless a predeclared target
   cohort shows a reproducible benefit across repeated clean runs, semantic
   differentials are exact, memory and tail regressions stay within thresholds
   frozen after parent-first baselining, and the selection rule is deterministic.
   Even then, ordinary planning stays the default outside that admitted cohort.

Darwin may tune bounded policy or selection thresholds only against these
frozen evaluators. It may not mutate semantic oracles, product code, query
corpora, or promote the experiment autonomously.

## Consequences

- Selected cyclic analytical joins may avoid large binary intermediates.
- The repository gains evidence about cursor APIs and workload fit before
  committing to a public backend extension or new storage layout.
- A second join operator increases planner, explain, cancellation, and test
  complexity even while disabled.
- Standard execution remains a correctness and performance fallback, so an
  analytical regression does not require a semantic fork.
- Some benchmark families may show no useful win; rejecting or retaining the
  experiment as opt-in is an acceptable outcome.

## Alternatives rejected

- **Replace binary joins globally with WCOJ.** Many transactional and acyclic
  queries favor the existing indexed operators and streaming behavior.
- **Publish a generic trie-cursor trait first.** The correct Rust capability
  and storage ordering have not yet survived an implementation experiment.
- **Add every possible permutation index.** Write amplification and migration
  cost require evidence that existing orders are insufficient.
- **Choose by query shape alone.** Skew, selectivity, output size, and cursor
  support materially affect performance.
- **Benchmark only triangles.** Positive-only microbenchmarks cannot justify a
  production planner choice.

## Evidence and task ownership

The current optimizer is in
[`optimizer.rs`](../../lib/sparopt/src/optimizer.rs); standard evaluation and
dataset access live in [`lib/spareval`](../../lib/spareval) and
[`sparql/dataset.rs`](../../lib/oxigraph/src/sparql/dataset.rs). The built-in
storage index orders are implemented under
[`storage`](../../lib/oxigraph/src/storage). No analytical cursor, WCOJ
operator, frozen evaluator, or benchmark receipt exists yet; G4.8 owns the
research task. This ADR is an authorization boundary, not an implementation or
performance claim.
