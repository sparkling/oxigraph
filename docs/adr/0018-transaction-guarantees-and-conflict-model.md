# ADR-0018: Transaction guarantees and conflict model

- Status: Proposed
- Date: 2026-08-24
- Updated: 2026-08-24
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G1.1-G1.4
- Depends on:
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md)
- Related:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0015 — Parallel bulk-load failure semantics](0015-parallel-bulk-load-failure-semantics.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)

## Context

ADR-0016 exposes request-atomic, backend-neutral RDF writes, but deliberately
does not negotiate isolation, detect conflicts, classify an uncertain commit,
or advertise a backend's effective guarantees. The memory backend serializes
writers. The RocksDB backend takes a snapshot and stages a
`WriteBatchWithIndex`, then applies the batch without validating concurrent
write conflicts. Stable reads and atomic batch application do not, by
themselves, establish snapshot isolation or serializability.

A replacement persistence plane must be able to state what it guarantees, and
a caller with a stronger minimum must receive a rejection rather than silent
degradation. Cancellation, conflict, storage failure, and a lost commit
response also need distinguishable outcomes before automatic retry can be
considered safe.

## Decision

Add a dimensioned transaction-requirements and capabilities contract beside,
not inside, the minimal write traits from ADR-0016. It will cover at least
atomic publication, read-your-writes, writer isolation, conflict behavior,
cancellation, rollback, and durable outcome lookup. Transaction creation must
reject an unmet minimum and return the effective guarantee that was selected.
Capabilities are tested dimensions; they are not a single ordered enum.

The transaction state model distinguishes staging, a single atomic transition
into `CommitAttempted`, and terminal committed, rejected, conflicted, rolled
back, or indeterminate outcomes. Rejection is returned only when non-commit is
proven. An indeterminate outcome carries a transaction key for the durable
lookup defined by ADR-0020. Effects are never replayed merely to discover
whether the first attempt committed.

The first RocksDB correctness baseline serializes writers. A bounded,
cancellable gate is acquired before snapshot creation and held through
commit, rollback, or drop. Readers remain concurrent. A higher-concurrency
RocksDB transaction mode is a later hypothesis and requires a separate
conflict oracle and benchmark case; it is not inferred from snapshot reads.
Every mutating path over the same storage, including autocommit writes and
compatible bulk commit points, must participate in that gate or be explicitly
excluded from the advertised profile. Existing callers retain ADR-0016's
minimum source-compatible transaction path; stronger requirements use the
capability extension.
Parallel parsing and ADR-0015's declared per-file versus cross-file atomicity
remain unchanged; the gate does not silently promote non-atomic bulk loading
to one transaction.

G1.1 supplies a shrinking reference state machine, G1.2 a concurrent-history
oracle, G1.3 the typed requests/capabilities/outcomes, and G1.4 the RocksDB
writer gate. No implementation may advertise a guarantee until that backend
passes the shared oracle for the exact capability value.

## Acceptance boundary

This ADR may move to Implemented only when:

- memory, RocksDB, and a replacement adapter pass the same state model;
- at least 10,000 shrinking traces per backend record replayable seeds;
- lost-update and write-skew histories have explicit expected outcomes;
- the 1/4/16-writer matrix passes while concurrent readers remain live;
- gate acquisition and cancellation are bounded and leak no partial writes;
- every public capability claim is backed by an executable receipt; and
- compatibility and performance promotion remains blocked on G0 and G1.7.

## Consequences

- Persistence adapters can be honest about weaker or stronger transaction
  behavior without changing the minimal mutation surface.
- The serialized RocksDB baseline favors a provable guarantee over speculative
  write concurrency and may reduce write throughput.
- Callers must handle typed conflict and indeterminate outcomes instead of
  treating every commit error as rollback.
- Savepoints, distributed transactions, and automatic replay remain out of
  scope.

## Alternatives rejected

- **Call a stable snapshot snapshot isolation.** This ignores write/write
  validation and permits false guarantees.
- **Retry every commit error.** External `LOAD`, `SERVICE`, and custom
  functions can duplicate effects.
- **Replace RocksDB immediately with a transaction engine.** Correctness can
  be established with a smaller reversible writer gate before measuring the
  need for a larger storage migration.

## Evidence and task ownership

Current implementation evidence is in
[`rocksdb_wrapper.rs`](../../lib/oxigraph/src/storage/rocksdb_wrapper.rs),
[`memory.rs`](../../lib/oxigraph/src/storage/memory.rs), and the
[transactional write contract](../../lib/oxigraph/src/store/transactional.rs).
The executable plan identifiers are G1.1-G1.4 in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
