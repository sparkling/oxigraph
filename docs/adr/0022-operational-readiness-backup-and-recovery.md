# ADR-0022: Operational readiness, backup, and recovery

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-08-27
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G2.5-G2.7
- **Depends on**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)
- **Related**:
  [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md)

## Context

The store can create a backup, optimize RocksDB, and validate storage, but a
successful method return is not a recovery contract. There is no completed
backup receipt tying primary state to its authoritative outbox and declared
derived-state contributor positions, no
fresh-directory restore drill, and no stable readiness or bounded-label
metrics surface.

Operations must distinguish liveness from readiness and must not promote a
store that is open while its durable feed, required derived state, or recovery
evidence is outside policy. Development-mode validation remains proportional;
production attestation, publication, deployment, and recovery objectives are
required only when that operational boundary is explicitly requested.

## Decision

Deliver three separately testable operational slices:

1. G2.5 exposes bounded-cardinality metrics, liveness, readiness, cancellation
   health, authoritative-outbox lag, declared derived-state lag,
   commit-governance health, and circuit-breaker state. ADR-0027 later consumes
   these observations; once G4.2 exists,
   readiness observes its workload budgets rather than creating a second
   admission system. Default labels exclude query text, RDF payloads,
   credentials, IRIs, commit IDs, and user IDs.
2. G2.6 starts with checkpoint-plus-manifest backup creation. A completed
   receipt binds store UUID, schema version, source commit ID, RocksDB
   sequence, authoritative-outbox cursor, the canonical derived-state
   contributor inventory, file inventory and checksums, start/end observations,
   and a completion marker. Interrupted backups cannot acquire that marker.
3. G2.7 restores into a fresh directory, opens and validates it, and compares
   topology, namespaces, primary commit, authoritative-outbox position, every
   declared contributor, inventory, and checksums with the receipt. Drills
   record numeric RPO and RTO after a baseline is frozen.
   Before open, path containment, regular-file policy, manifest completeness,
   sizes, and hashes are verified; symlinks, traversal, missing files, and
   unexpected files fail closed.

G2.5-G2.7 share one engine-neutral, canonical zero-or-more derived-state
contributor contract. An empty inventory is valid. Each nonempty entry carries
a stable provider/schema identity, required/optional disposition, source and
applied cursors, bounded health, a checksummed backup-manifest contribution,
and restore reconciliation. A test-only fake contributor proves the nonempty
path. Unknown or duplicate entries, a missing required contributor, and a
cursor mismatch fail closed. G3.0 later implements the reusable derived-index
lifecycle and plugs into this hook; G2 does not depend on G3.0 and does not
pre-create text or spatial providers.

ADR-0027 is an operational and promotion relation, not a hard implementation
prerequisite for G2.5-G2.7. G2.5 first establishes the bounded metrics,
cancellation, and readiness observations that G4.2 later consumes. A
production readiness profile that promises workload budgets is promotable only
after G4.2 closes; this sequencing avoids a dependency cycle between the two
decisions.

ADR-0028 consumes these backup and restore receipts before a destructive or
irreversible schema migration is admitted. A backup receipt alone does not
authorize an upgrade, and an upgrade cannot mint recovery evidence for itself.

Readiness fails closed on storage corruption, incompatible schema, required
cursor loss, expired recovery evidence, or a lag policy violation. An optional
derived index may degrade according to its declared strict/eventual contract;
primary correctness may not be inferred from index health.

## Acceptance boundary

This ADR may move to Implemented only when:

- metric names, units, label bounds, and privacy tests are stable;
- liveness and readiness failure fixtures cover storage, feed, cancellation,
  the empty contributor inventory, and a test-only nonempty contributor;
- incomplete, missing, modified, or checksum-invalid backups fail closed;
- backup and compaction interaction has no unrecorded consistency gap;
- automated fresh-directory restores pass the storage validator and compare
  every receipt-bound cursor, contributor, and topology field; unknown,
  duplicate, missing-required, and cursor-mismatched contributors reject;
- a completed backup remains independently usable after removal of its source
  store; and
- RPO/RTO thresholds are baselined and frozen before a production promotion,
  rather than invented by this ADR.

## Consequences

- Operators gain evidence that a backup is restorable, not merely copyable.
- Readiness becomes a typed policy decision rather than process-up status.
- Receipts and drills add storage, time, and retention costs.
- Optional indexes can be rebuilt without making primary state unrecoverable.

## Alternatives rejected

- **Treat `Store::backup` success as recovery proof.** It does not exercise
  reopen, validation, or cursor correspondence.
- **Expose raw RocksDB statistics as the public contract.** Backend-specific
  and unbounded metrics would leak implementation and operational detail.
- **Set production RPO/RTO without a baseline.** Unmeasured thresholds are
  documentation, not an executable guarantee.

## Evidence and task ownership

Current backup, optimize, and validate entry points are in
[`store.rs`](../../lib/oxigraph/src/store.rs) and
[`storage/rocksdb.rs`](../../lib/oxigraph/src/storage/rocksdb.rs). G2.5-G2.7
own delivery in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
