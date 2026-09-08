# ADR-0024: Rebuildable derived indexes

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-09-08
- Deciders: Oxigraph parity programme
- Implementation status: G3.0 native snapshot/rebuild-input and complete-commit
  delta APIs implemented. Durable generations, reconciliation/activation and
  lifecycle integration remain G3.0; text/spatial engines remain G3.3/G3.4
- **Depends on**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- **Related**:
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

G3.0 first implements one provider-neutral lifecycle for rebuildable consumers
of ADR-0020's durable outbox. Its contract includes provider/schema identity,
source commit, applied commit, checksummed generation, lag, rebuild state,
bounded delta overlay, cancellation/resource ceilings, atomic activation, and
readiness policy. It contributes backup and restore state through ADR-0022's
canonical zero-or-more hook; index bytes remain reproducible from primary state
and the durable feed. Lifecycle states distinguish building, ready, lagging,
failed, corrupt, and unavailable. An interrupted, corrupt, or incompatible
generation never becomes active. A fake provider must prove crash, rebuild,
activation, cancellation, backup, and restore semantics before an engine is
adopted.

G3.3 and G3.4 then implement text and spatial providers on that lifecycle,
without duplicating it or participating in primary RDF commit.

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

### G3.0 native input slice (2026-09-08)

`Store::derived_snapshot` captures one RocksDB snapshot behind a bounded
three-attempt physical-checkpoint bracket. `DerivedSnapshot::scan` streams empty
graph declarations, quads and namespaces from that same view; it does not hold
a writer permit or collect the entire namespace registry. A successful
`DerivedScan` binds the full checkpoint, input counts and ordered logical hash.
Callback, cancellation and limit failures return no successful scan receipt;
the caller must discard its partial candidate. Release snapshots promptly since
they can delay native reclamation.

`DerivedSnapshot::delta` reads that same snapshot's outbox and returns only
complete `DerivedCommit` values whose effect hashes match their native receipts.
No-op commits remain explicit. It validates applied commit-end identities,
including exact retention-anchor receipts. Foreign identities, expired cursors,
legacy coverage gaps and oversized overlays reject without a partial applied
cursor. Later writes and retention do not alter a captured view. Record and
logical-byte ceilings apply before provider delivery/overlay insertion; native
buffers and one decoded RDF record are outside these logical limits. Provider
allocation limits remain the lifecycle adapter's responsibility.

The outbox covers governed writes only. A delta is **not** proof of whole-primary
equivalence. `check_current` compares the full physical checkpoint, conservatively
invalidating on any intervening write (including non-semantic maintenance), not
merely a changed governed receipt. This is a point-in-time check, not a writer
lease. Strict generation activation/use must still reconcile an exact primary
view and prevent ungoverned writes from being hidden by a later governed commit.
This slice adds no primary schema token, writer restriction or strict index claim.

The [native input tests](../../lib/oxigraph/tests/derived_inputs.rs) cover a fake
provider's rebuild/insert/delete/clear/drop/namespace replay, rollback exclusion,
257-effect commits, limits, cancellation, callback failure, retention, foreign
lineage, stable snapshots and ungoverned freshness gaps. Run the
[example](../../lib/oxigraph/examples/derived_inputs.rs) with
`cargo run --locked -p oxigraph --example derived_inputs`.
This is an input foundation, not complete G3.0: checksummed durable generations,
crash-safe activation, readiness and backup/restore integration remain required.

### Complete lifecycle and provider boundary

G3.0 must first pass a fake-provider matrix for insert, delete, clear, drop,
rollback, crash, cursor replay, corruption, bounded rebuild/delta, atomic
activation, cancellation/resource ceilings, and backup/restore reconciliation.
Each real provider then passes the same matrix plus its semantic checks.
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
[`spargeo`](../../lib/spargeo). G3.0 owns the shared lifecycle; G3.3 and G3.4
own only the text and spatial providers in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
