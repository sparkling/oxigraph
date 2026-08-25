# ADR-0020: Transactional metadata, receipts, and change delivery

- Status: Proposed
- Date: 2026-08-24
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G2.1-G2.3c
- Depends on:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md)
- Related:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0015 — Parallel bulk-load failure semantics](0015-parallel-bulk-load-failure-semantics.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md)

## Context

The store has no transactional namespace registry, durable commit identity,
normalized semantic change set, or ordered change feed. A commit error can be
ambiguous, and downstream validators, indexers, or subscribers have no native
atomic hand-off from primary state. Quad-only events also lose the distinction
between graph creation, clear, drop, and namespace changes.

These concerns belong to commit governance, not to the minimal mutation trait
or dataset equality. Namespace metadata must remain transactional without
changing RDF dataset comparison semantics.

## Decision

Introduce a separate commit-governance capability with three staged slices:

1. A transactional namespace registry commits and rolls back with RDF changes
   but is excluded from RDF dataset equality.
2. A normalized net semantic change set records quad additions/removals, named
   graph create/clear/drop, and namespace effects as distinct operations.
   Large clear/drop operations may use bounded summary records rather than
   synchronously expanding every removed quad. Normalization preserves
   observable lifecycle and ordering boundaries such as clear-then-insert,
   drop-then-create, empty-graph operations, and blank-node identity.
3. The primary state, transaction key, commit ID, commit receipt, outbox
   records, and durable cursor position are one atomic storage transition.

`lookup_outcome(transaction_key)` must work after crash and reopen and return
a committed receipt, proven absence, or indeterminate; it never replays the
transaction to infer the answer. `ProvenAbsent` requires a durable key
reservation or tombstone written before an outcome can become ambiguous; an
unseen key is not proof of non-commit. After the declared transaction-key
retention window, lookup returns a typed expired/unknown result rather than
claiming absence. Receipts bind schema and store identity, commit ordering,
normalized-effect checksum, and relevant cursors without embedding RDF
payloads or credentials.
Commit IDs are opaque identity, not an implied clock or ordering API; the
outbox cursor supplies durable order.

The native outbox is authoritative and at-least-once. Consumers deduplicate by
`(commit_id, event_index)`. In-process listeners and RDF Patch are adapters
over that outbox, not independent commit-time notification paths. Records are
versioned and checksummed, and the contract defines retention, cursor leases
and expiry, slow-consumer backpressure, compaction, and backup interaction.
RDF Patch is not the primary storage format.
Bulk loaders retain ADR-0015's atomicity scope and emit governed commits only
when their selected mode explicitly implements this capability.

G2.3c exposes a minimal `GovernanceHealth` observation for receipt/outbox
integrity, cursor retention, and schema compatibility. That observation is an
input to ADR-0022 readiness; it is not itself a complete operational-readiness
or service-health claim.

## Acceptance boundary

This ADR may move to Implemented only when G2.1-G2.3c prove:

- namespace and RDF mutations commit and roll back together while dataset
  equality ignores namespace metadata;
- graph lifecycle and namespace effects survive normalization distinctly;
- injected lost responses resolve after reopen without replay;
- proven absence is backed by a durable key reservation or tombstone within
  its declared retention window;
- primary state, receipt, and outbox are never observably split;
- restart, lag, cursor expiry, retention advance, clear/drop, and compaction
  produce neither feed gaps nor unbounded synchronous work;
- duplicate delivery is harmless under the required consumer key; and
- corruption, schema mismatch, and checksum failure stop consumption and
  readiness rather than being skipped.

## Consequences

- Commit ambiguity becomes inspectable across process failure.
- SHACL, operations, and derived indexes gain one ordered semantic input.
- The atomic batch grows and retention becomes an operational responsibility.
- Consumers must be idempotent and explicitly handle expired cursors.

## Alternatives rejected

- **Emit in-memory listeners after commit.** A crash can lose notifications.
- **Expand every clear/drop into quad events.** Large graph operations become
  unbounded commit work.
- **Store only RDF Patch.** Native topology, metadata, receipt, and cursor
  semantics would be forced into an interchange format.

## Evidence and task ownership

The current write and topology boundaries are in
[`transactional.rs`](../../lib/oxigraph/src/store/transactional.rs) and
[`store.rs`](../../lib/oxigraph/src/store.rs). G2.1-G2.3c own delivery in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
