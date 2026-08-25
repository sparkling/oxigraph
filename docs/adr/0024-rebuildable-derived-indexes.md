# ADR-0024: Rebuildable derived indexes

- Status: Proposed
- Date: 2026-08-24
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G3.3-G3.4
- Depends on:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- Related:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md),
  [ADR-0032 — Incremental entailment projections](0032-incremental-entailment-projections.md)

## Context

Oxigraph provides exact GeoSPARQL functions but no persistent spatial index,
and it has no full-text index. Making either index part of the primary commit
would enlarge the correctness-critical storage transaction and couple the core
API to one engine. Making it asynchronously authoritative would instead allow
lag, crash, or corruption to change query answers silently.

Both capabilities need the same lifecycle contract: durable input, explicit
freshness, rebuild, generation swap, failure isolation, and a correctness path
that does not trust the index.

## Decision

Implement text and spatial indexes as rebuildable consumers of ADR-0020's
durable outbox, not participants in primary RDF commit. The shared derived
index contract includes index/schema version, source commit, applied commit,
generation, checksum, lag, rebuild state, atomic generation swap, bounded
delta overlay, and readiness policy. Backup receipts bind their cursors, while
the index bytes remain reproducible from primary state and the durable feed.
Lifecycle states distinguish building, ready, lagging, failed, corrupt, and
unavailable. An interrupted or incompatible generation never becomes active.

G3.3 uses a Tantivy-backed text provider behind an engine-neutral query
surface. Stale candidates are verified against primary state. Because that
cannot recover additions missing from a lagging index, a strict query must
wait for `applied_commit >= required_commit`, execute an authoritative
fallback, or return typed `IndexNotFresh`. Eventual results are explicitly
opt-in.

G3.4 starts with immutable per-CRS spatial-envelope generations plus a bounded
delta overlay. Its first profile is limited to the CRS84 geometry inputs the
current exact implementation accepts; later CRSs use separate declared
profiles and indexes. Every candidate is refined through the existing exact
`spargeo` predicates. Coordinate transformation or normalization is admitted
only for a profile with proven semantics and error bounds.
Standard SPARQL evaluation remains independent of both optional indexes.
Entailment projections are not text or spatial indexes and do not inherit this
ADR's eventual-result policy. They require the separate truth-maintenance and
deletion semantics in ADR-0032.

## Acceptance boundary

Both indexes must prove insert, delete, clear, drop, rollback, crash, cursor
replay, corruption, rebuild, generation swap, and backup/restore behavior.
Additionally:

- strict text queries never silently omit lagging additions;
- eventual mode reports its applied commit and is never the implicit default;
- text candidates are checked against graph and primary-state scope;
- indexed and exact spatial results agree for every supported CRS/profile;
- a missing or corrupt index preserves an exact or typed-unavailable path; and
- lag, rebuild time, resource use, and result equivalence have frozen
  benchmark and failure receipts before promotion.

## Consequences

- Primary commits remain independent of text and spatial engine latency.
- Index lag and rebuild become explicit operational state.
- Strict completeness may wait, scan, or fail typed rather than return a fast
  incomplete answer.
- Text syntax, scoring semantics, and supported spatial profiles require
  separately versioned public contracts.

## Alternatives rejected

- **Synchronously update every index in the primary transaction.** This couples
  availability and commit latency to optional engines.
- **Trust candidate verification alone.** It removes stale false positives but
  cannot discover missing additions.
- **Build a custom persistent spatial tree first.** Immutable generations and
  exact refinement are smaller and recoverable.

## Evidence and task ownership

Exact spatial functions are integrated through
[`spareval`](../../lib/spareval/src/lib.rs) and
[`spargeo`](../../lib/spargeo). G3.3-G3.4 own delivery in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
