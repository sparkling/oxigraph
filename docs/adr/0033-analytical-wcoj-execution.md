# ADR-0033: Analytical/WCOJ execution

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-29
- Deciders: Oxigraph parity programme
- Implementation status: bounded eligibility reporting and explicit local
  analytical execution implemented below; ordinary `sparopt`/`spareval`
  execution remains the default, with no Auto mode or server exposure
- Programme task: `task-1787728711087-ibcg53` (G4.8)
- **Depends on**:
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md)
- **Related**:
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
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

- The isolated research profile uses frozen local ceilings. For server
  exposure or `Auto` promotion, ADR-0027 additionally enforces per-query,
  principal, repository, and global limits before analytical planning and
  throughout execution. Budget exhaustion is typed and cannot trigger an
  unbounded fallback.
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
   frozen after parent-first baselining, the selection rule is deterministic,
   and G4.2 has closed the server workload-admission and resource-budget
   contract. Research and explicit local evaluation may start after G3.2;
   server exposure or `Auto` promotion may not. Even then, ordinary planning
   stays the default outside that admitted cohort.

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
[`storage`](../../lib/oxigraph/src/storage). The bounded explicit operator
below is ordinary implementation evidence, not a frozen evaluator or benchmark
receipt. G4.8 retains ownership of remaining research and promotion gates.

## Bounded eligibility report (2026-09-29)

`sparopt::AnalyticalEligibility` examines one complete borrowed algebra component
without rewriting it or selecting execution. The conservative profile admits
only variable-connected inner joins of at least two quad patterns in one fixed
graph. Explicit positive pattern, variable, node and depth limits bound an
iterative walk. Typed unsupported and budget outcomes are advisory, never
permission for an empty answer or fallback. Reports exclude terms and graph IRIs.
Default optimization and evaluation remain unchanged. No cursor, WCOJ operator,
server surface, Auto policy or frozen evaluator is implemented by this slice.

Ordinary workflow `25e5d38a-ae63-4df0-9529-1fd922874c98` used native Sonnet
5.5/high planning, authoring and fresh review, with Opus/high formatting repair.
Fresh reviewer `de21ab9b-80b4-4f8a-863f-ca4e9afbe4c1` accepted exact source.
Candidate checks pass 11 default integration, 13 all-feature integration and
26 all-feature library tests. Canonical checks repeat 11 (`run-ZXsWXx`) and
39 (`run-h1UQZZ`), with stable source observations. Scoped formatter passes;
candidate all-feature/all-target Clippy exits 0 with warnings, not clean lint.

Exact source SHA256:

- `lib/sparopt/src/lib.rs`:
  `244c5b1463b802ca3fc7a63964200fe9e4177c4fc17a389593017783f29e7cd6`
- `lib/sparopt/src/analytical.rs`:
  `b608a82b20e6ff599cb8de83bad5873dd4d7745188b93c5e6bc594dd47502e6a`
- `lib/sparopt/tests/analytical_eligibility.rs`:
  `ccf61f13f1d4456b92b8b292b2eb6457065cf859b48e62db9fe168c586e722b6`

Lane receipt SHA256:
`5ff526c14ff1e05f2bf8f4b76b07dc91efa68edeebb4527c47f22d3c50a8c7b5`.
All 28 event/check/handoff references verified; structured MCP handoff readback
and native learning retained. Batch ended incomplete due to separate rejected
lanes. Its timed-out external lease worker subsequently terminated; no batch or
native action remained live before this canonical integration. Negative sibling
receipts remain unchanged. Accepted base was `c47df083f`; 15,217 unchanged
candidate files and 11 reviewer read dependencies matched canonical source.
This bounded G4.8 slice uses migration registry alias
`task-1790674619597-vimwfm`; original outcome `task-1787728711087-ibcg53` remains
open. No qualification, promotion, publication or performance claim follows.
ADR remains Proposed for the outstanding analytical execution programme.

## Explicit local analytical execution (2026-09-29)

`SparqlEvaluator` options and `PreparedSparqlQuery` analytical bindings now
consume the accepted eligibility oracle on one retained built-in snapshot.
Default Disabled/`on_store` behavior is unchanged. The first profile handles
whole-query SELECT projection over eligible local connected BGPs in one fixed
graph. RocksDB uses descriptors and actual ordered prefix seeks on existing
quad indexes; memory uses bounded sorted transient relations. Deterministic
index-aware variable-order search rejects incompatible index orders. Leapfrog
intersection emits bindings without collapsing projection multiplicity.
No persistent index, public replacement-backend trait or package version added;
the existing workspace `sparopt` dependency is now consumed by `oxigraph`.

Explicit positive pattern/variable, row, requested-allocation, work, output and
wall-time limits remain reducible by policy. Capability declines may use the
declared standard fallback on the same snapshot before any row; resource,
deadline, cancellation and storage failures never trigger unbounded fallback.
After streaming starts, failures surface once and fuse the stream without
replay. Native seeks encountering a stored triple term after a row return a
typed unsupported error; memory can decline before the first row. Empty streams
still check control at first poll. Existing evaluation metrics observe one
terminal disposition; reports retain no terms. No Auto, server or promotion.

Fresh Sonnet 5.5/high review `7f6caebc-5527-4851-a1ce-9c8181e8b1d3`, reviewer
`cd3bb733-a79c-4ff5-b951-2269ace7fa9d`, accepted the exact final formatted bytes.
Response SHA256:
`9cf1615d0e661d66f0b2c2f2f99793f78b18694e1912e5fc58963652b4710754`.
Owner reconciled 15,218 unchanged inputs, 26 intervening accepted paths, nine
submodule pins and 28 supplemental reads at accepted main `3dce19d8e`.
The changed query-update dependency was supplied exactly to the reviewer.
Snapshot-bound independent native lanes continued under explicit custody checks.

Canonical stable-source receipts before this evidence append:

- `run-lxz70W`: default 72 (32 analytical, 15 keyed-query, 25 keyed-update).
- `run-7P8ZCF`: no-default 53 (32 analytical, 8 keyed-query, 13 keyed-update).
- `run-AchZel`: RDF12/http public analytical 35.
- `run-6IP0vy`: RDF12/http private analytical 19 (8 control, 11 storage).
- `run-L4R3vR`: noncopying value-length regression 1.
- `run-SB1Mz5`: affected library build.

Candidate public matrices pass 32/32/35, private controls 19 and value-length 1.
Scoped nine-file formatter passes; candidate no-default all-targets Clippy exits
zero with warnings, not clean lint. wasm is unvalidated. Private phase deadline
tests switch to an expired closure; they do not prove physical clock crossing.
Requested allocation accounting is not process RSS or native snapshot memory.
Negative/rejected/expired workflows and earlier repairs remain preserved; no
failed workflow acceptance is inherited. Evidence lives under
`target/engineering-delivery/analytical-canonical-final-checks.json` and
`analytical-current-integration-7f6caebc-5527-4851-a1ce-9c8181e8b1d3.json`.
This accepts the bounded ordinary execution slice, not the full semantic,
resource, benchmark or promotion gates. Same original G4.8 outcome and migration
alias remain open; ADR stays Proposed. No qualification or publication follows.
