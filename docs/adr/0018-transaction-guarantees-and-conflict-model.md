# ADR-0018: Transaction guarantees and conflict model

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-08-27
- Deciders: Oxigraph parity programme
- Implementation status: G1.1-G1.4 core capability, oracle, and writer-gate
  mechanics are implemented and source-bound. The additive typed-outcome
  vocabulary exists, but the built-in `Store` does not yet implement the
  decision's single-`CommitAttempted`/typed terminal-outcome lifecycle or
  durable lost-acknowledgement lookup. The dedicated G1.7 qualification-control
  scaffold is implemented, while native compatibility replay, reviewed
  reference and budgets, benchmark/noise evidence, and the current-evidence
  promotion decision remain outstanding
- **Depends on**:
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md)
- **Related**:
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
- the built-in `Store` implements exactly one `CommitAttempted` transition,
  typed terminal outcomes, and durable transaction-key lookup without replay;
- every public capability claim is backed by an executable receipt; and
- compatibility and performance promotion closes only through G1.7 after every
  required lower receipt is current.

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
The G1.1 evaluator in
[`transaction_state_model.rs`](../../lib/oxigraph/tests/transaction_state_model.rs)
runs 10,000 replayable shrinking traces against memory, RocksDB, and an
independent rewritten adapter. The evaluator-only G1.2 history oracle in
[`transaction_concurrency.rs`](../../lib/oxigraph/tests/transaction_concurrency.rs)
is intentionally red on its frozen baseline: overlapping RocksDB writers
reproduce both lost update and write skew. Per-instance RocksDB writer
serialization in `7eec1f07` then closes both histories without a process-wide
gate.

G1.3 is implemented by product commit `3bf9468c`. The additive API negotiates
atomic publication, read-your-writes, writer isolation, conflict behavior,
cancellation, rollback, and outcome lookup; rejects unmet requirements before
opening a backend transaction; and distinguishes rejected, conflicted,
cancelled, and indeterminate commit outcomes. It deliberately does not claim
durable outcome lookup or cancellation for `Store`, and it does not implement
`OutcomeAwareWritableDataset` over the legacy `StorageError` surface.

The frozen G1.3 contract digest is
`fd30c797263e3f0b001c816c56cdacbeee095fa4da1ad948a6211734b982a461`.
The engineering harness reconstructed the exact product patch
`2d5412df6210246266426e3b7ee8be599744fc1093c9ac272b8d8d64a34fef04`
as candidate tree `b369e766a3f8c02f6d580924dd943e08ebafcdf0`, retained the
protected-tree manifest `679e1ce34462d761090534c186e6bbbde5ba9297b7d00dda60d3748f8b16e189`,
and returned `ACCEPT` after format, build, 9 public capability tests, 3
independent state-model tests, and 3 transactional regressions in a
network-isolated read-only workspace.

G1.4 is implemented by product commits `b2ed9119` and `5a704914`. The public
`TransactionStartControl` supplies clone-shared cancellation and an optional
admission timeout. Both built-in backends observe those controls while queued,
acquire their per-instance writer permit before creating a transaction
snapshot, and hold it through commit, rollback, or drop. This is deliberately
an admission guarantee only: `Store` continues to advertise
`CancellationGuarantee::Unsupported` for cancellation after transaction start.

The frozen G1.4 contract digest is
`cc20ae29420ff2a3b328b35bdc8f26dcd6cd39e978ec6fcfc0de93290334df39`.
The engineering harness reconstructed exact product patch
`47bfdb31333a13ba5d90bca3f06767fe889f05c0e9aebf5b3628d3942eafa7db`
as candidate tree `7d47e7352d64171563da8dd8d00fcb9b4c1f790d`, retained protected
manifest `537184400702bd927208c3f314c014386a65390061f263d7924855d38777bb3b`,
and returned `ACCEPT` after format, build, six public writer-admission tests,
two independent concurrent-history tests, and two atomic-update regressions in
313.959 seconds. The public matrix covers 1/4/16 writers, concurrent-reader
liveness, rollback/drop release, queued cancellation, and zero-timeout
admission without partial publication.

G1.5b composes that admission control with SPARQL Update. Product commits
`280872dc` and `9b84bed6` carry the evaluator's exact cancellation token from
validation through built-in Store admission, mutation, and the final
pre-commit checkpoint. Frozen contract
`ab01ef3e29fbded8c8c042359851bd0c02c9fa1fd97afbc00eadc0b3a48e1525`
accepted its 6/6/12 profile as candidate tree
`d5413be86dae88f4b353ef4979ca8307f408357d`. This proves rollback for
transactions owned by the update binding, not update-scoped rollback inside a
caller-owned transaction.

G1.5c implements the additive negotiated backend binding in product commit
`3afe1e7850d60945342a8a6e7072e85a63683be1`, without changing the minimal
`TransactionalDataset` or `WritableDataset` traits. The binding carries the
caller's exact `TransactionRequest` and cancellation token through custom and
`Store` admission, rejects unmet requirements before opening a transaction,
and explicitly rolls back an owned transaction after post-admission failure.
Frozen contract
`05b6ba498344fc412a810bb79eb80344f90577a442ce03c41637cbabd4a26ce1`
accepted exact three-path patch
`229d326bb22f46b992bc6d6212be1346de88b0d5bf1b9cad56dc0150611066c8`
as candidate tree `40137fa6306e8c282da16fbeb0d46418e27d0f3a`. The isolated verifier
retained the 1,389-entry protected manifest
`f0d009cd1b48b6c850b45026a2956fea752c8e9cf932022d7e34aa37cf5fb2bb`
and returned `ACCEPT` for format/build, five public, fifteen independent, and
twenty-one regression tests. Its 118,202-byte session artifact has SHA-256
`94461758757f1d4402713f6bed115e1bbd318d1fc35b02c7ea2c3b27a2b3f23b`.

ADR-0018 remains Proposed until the built-in `Store` closes the
single-`CommitAttempted`, typed terminal-outcome, and durable-lookup boundary
and G1.7 closes the compatibility, performance, and current-evidence promotion
boundary. G1.5c completion alone does not grant promotion authority or add
savepoints to caller-owned transactions.
The current G1.7 scaffold can structurally verify current v2 projections and
sealed-replay copied MetaHarness and Agentic-QE contracts, but compatibility
replay currently reaches only `AGENTIC_OWNER_CONTRACT_REPLAYED`. It does not
independently replay native Cargo lane summaries and cannot make the evidence
qualification-eligible. The transaction identifiers are G1.1-G1.5c; G1.7 is
the joint compatibility/performance promotion gate in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
