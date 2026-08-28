# ADR-0018: Transaction guarantees and conflict model

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-08-28
- Deciders: Oxigraph parity programme
- Implementation status: G1.1-G1.4 core capability, oracle, and writer-gate
  mechanics are implemented and source-bound. G1.4a is implemented in
  `2f518e04`: all built-in `Store` backends now expose an additive
  caller-keyed terminal lifecycle. Read-write RocksDB configures a synchronous
  `CommitAttempted` write, atomic RDF-plus-`Committed` publication, successful
  explicit-rollback proof, best-effort pre-attempt drop marking, and lookup
  without replay. Accepted tests prove orderly read-only reopen and
  post-commit process-abort recovery separately; phase-injected and power-loss
  behavior remain unproved. Memory exposes a process-local oracle without
  advertising durability. G1.4b product commit `590a3229` is accepted by its
  evaluator-separated application receipt and exact replay: injected
  storage-call failures now prove that local `CommitAttempted` state advances
  before the marker call, conservative lookup remains indeterminate, and drop
  cannot falsely prove rollback after a commit attempt. That evidence does not
  simulate crash, power loss, or fsync. G1.7 contract v7 binds the exact merged
  product identity while preserving v6's proposed two-phase control/final-
  decision validation and paired statistics. Exact G1.4b prerequisite binding
  and pure Darwin-free v1/v3/v4/v5/v6 replay are implemented and fail closed.
  Pure benchmark-owner and bounded canonical control-receipt candidate replay
  are also implemented. Commit `fbbb692b` adds the separate physical write-once
  receipt-last control envelope and exact current-state sealed replay while
  granting no authority and exposing only a prospective binding from replayed
  PASS. Production control/build/sample owner emission and a current control or
  qualification receipt are not implemented. Human control approval, final
  reference/budgets, benchmark/noise evidence, current owner evidence,
  qualification, and promotion remain outstanding
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
oracle, G1.3 the typed requests/capabilities/outcomes, G1.4 the RocksDB writer
gate, G1.4a the built-in Store terminal lifecycle and minimal durable
transaction-key lookup, and G1.4b the evaluator-separated injected
storage-call/malformed-ledger fault gate needed before ADR-0020 adds receipts
and outbox state. No implementation may advertise a guarantee until that
backend passes the shared oracle for the exact capability value.

## Acceptance boundary

This ADR may move to Implemented only when:

- memory and RocksDB pass the same state model, while the test-only
  `RewrittenPersistencePlane` portability adapter proves that the shared kit is
  not coupled to built-in storage; any future production adapter must pass that
  unchanged kit before adoption, but its absence is not an unconditional
  completion blocker for this ADR;
- at least 10,000 shrinking traces per backend record replayable seeds;
- lost-update and write-skew histories have explicit expected outcomes;
- the 1/4/16-writer matrix passes while concurrent readers remain live;
- gate acquisition and cancellation are bounded and leak no partial writes;
- the built-in `Store` implements exactly one `CommitAttempted` transition,
  typed terminal outcomes, and durable transaction-key lookup without replay;
- evaluator-separated pre/post-write injection proves that commit-attempt
  errors cannot be followed by a false rollback proof, while malformed ledger
  records fail as corruption and the receipt preserves the crash/power-loss
  non-claim;
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
runs 10,000 replayable shrinking traces against memory, RocksDB, and the
test-only `RewrittenPersistencePlane` portability adapter. This third lane is
an API-portability proof, not a production persistence implementation. The
evaluator-only G1.2 history oracle in
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

G1.4a is implemented by product commit `2f518e04`. It adds the distinct
`OutcomeAwareTransactionalDataset`/`KeyedTransaction` path without changing
the legacy transaction signatures. Key reservation happens only after
requirements and writer admission succeed. Memory retains terminal state only
for the process lifetime and keeps `OutcomeLookup::Unsupported`; read-write
RocksDB advertises `DurableByTransactionKey`, while a read-only reopen may
resolve existing keys without advertising write capability. RocksDB stores a
versioned record under a reserved default-column-family prefix and configures
the `Staging`, exactly-one `CommitAttempted`, and final RDF-plus-`Committed`
writes as synchronous. Missing, `Staging`, and `CommitAttempted` resolve
indeterminate. A successful explicit rollback proves `RolledBack`; ordinary
drop only attempts that marker while still staging and leaves lookup
indeterminate if the best-effort write fails. Unknown record encodings fail as
corruption in the implementation, and effects are never replayed to discover
the outcome. G1.4b now executes malformed-record and phase-specific simulated
storage-call behavior; power loss and fsync durability remain outside that
evidence.

Frozen contract
`fa8d1028cb3e1c27c2f1771e77451a08ddc84ce6a2c7c673c2435deda574a6fd`
reconstructed exact patch
`3a19606349d057c8090c8a92d336761c554ae32d011d9759948b602a54ca7d54`
as candidate commit `de43f6e2e361095d61741f4aaafebb611e91a474`, tree
`390bb43a5a3157f873204c63c10355026aab5681`, and retained protected manifest
`54162db0dd0f4dfebb78cade7d136daa16d403f3e520a1b295860a99ea56999c`.
The network-isolated, read-only verifier returned `ACCEPT` after
format/build/public-7/service-9/compatibility-20/independent-3/regression-2 in
395.556 seconds. Its 122,732-byte session artifact has SHA-256
`9c3ee4481fcc777124cad7bc6d051cdb095de1fe93987c52ef80243735ecc240`.
The preceding paired native application run remains an authenticated
`INCONCLUSIVE` attempt because neither implementation lane produced an
admissible candidate; it is not rewritten as success. The exact resulting
product patch was separately reconstructed and accepted by the frozen direct
verifier above. That accepted evidence covers normal ledger transitions and a
separate post-commit process abort; it does not claim phase-injected or
power-loss proof, malformed-record execution, or read-only lookup after that
abort.

G1.4b is implemented by product commit
`590a3229ab1a826a102d52736dc6491530b69998`. Its corrected evaluator commit is
`fa832174f3023e035fbaad52721f1b616eb1752e`; frozen preflight contract
`926724ae8c8d206b4a4de576eb0120fc21c75aa96c99fb4f38664a2bdf3b44c8`
confirmed the intended runtime-red signature of six passing and two failing
tests while the 7/7 outcome and 20/20 compatibility controls stayed green.
The paired native application programme selected exact patch
`02f10b26613ce403120bb68867ea739295225a9c630970e25911694eb94a1314`
as candidate commit `a1ca1eb45dba23c246ce84f70d67740c9bd388ab`, tree
`ab5b281da2ee40c12122a9598d19d33b699d0b86`. Receipt
`d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad`
returned `ACCEPT`, admitted eight outcomes with no issues, and exact replay
returned the same bindings. After application, the direct suites pass 8/8,
7/7, and 20/20. The qualified fix moves only the local phase assignment to
immediately before the durable marker call. The evaluator injects storage-call
pre/post errors; it is not crash, power-loss, or fsync evidence.

Ledger I/O occurs only on the explicit keyed path. The current implementation
still adds unmeasured optional-state/branch and write-option allocation costs to
legacy transaction objects/store initialization; G1.7 must measure them before
any zero-overhead claim. Keyed callers should use the inherent or
`OutcomeAwareWritableDataset` commit path for a typed indeterminate error;
generic `WritableDataset::commit` retains its legacy raw error surface, so such
callers must retain the key and use lookup. G1.7 now copies, exact-replays, and
hash-binds the accepted G1.4b receipt at its current prerequisite boundary.
That binding may consume this lower-level fault evidence but is not an approved
final envelope and grants no qualification or promotion authority.

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

ADR-0018 remains Proposed even though G1.4a and G1.4b have closed the built-in
`Store` terminal-outcome/durable-lookup and simulated storage-call fault
boundaries. G1.7 must still close compatibility, performance, current-evidence
qualification, and the separate human decision. Neither slice grants promotion
authority, adds semantic commit receipts/outbox delivery, or adds savepoints to
caller-owned transactions.
The current G1.7 contract v7 is
`42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80`.
Its control authorization and final decision set remain
`CONTROL_AUTH_PROPOSED` and `PROPOSED`/`UNAPPROVED`. The CLI exits 4 before
identity, evidence, build, or sampling and writes no G1.7 run. Pure commits
`d3af2e17` and `45121da9` replay four isolated builds, two serialized sessions,
392 exact launches, recomputed Darwin statistics, and a bounded canonical
control-receipt candidate. That result is deliberately `CANDIDATE_REPLAYED`,
with `binding: null`, `finalDecisionEligible: false`, and all authority flags
false. A final binding keeps qualification execution false until the candidate
has been emitted by a live owner, physically sealed and replayed, and bound by
the approved final decision. Commit `fbbb692b` proves exact three-file archive
creation and current-state replay over synthetic fixtures; seal emits no
binding, and all authority remains false. It does not prove live owner emission,
historical receipt-last order from replay, crash/power-loss/filesystem-flush
durability, or same-UID tamper resistance.
Legacy v1/v3/v4/v5/v6 contract bytes replay through a Darwin-free structural
boundary and remain legacy-only.

Contract v7 preserves v6's non-circular two-phase protocol and frozen
canonical authorization-bound sample framing, paired 10% negative-control
non-inferiority, shared-seed two-direction 5% A/A equivalence, the inclusive
5% MAD noise boundary, and mechanical control/aggregate verdict precedence. A
permanently non-promoting human control authorization must precede sealed
negative/A/A control execution, and one final human decision set must bind that
receipt, its observed signature, and the exact G1.4b prerequisite before any
subject/reference samples. The G1.4b receipt is now copied, hash-bound, and
pure-replayed at that prerequisite boundary, but no human approval, physically
sealed control receipt, live benchmark, performance result, or current owner
evidence exists. The statistics, candidate-receipt, and physical archive
implementations use synthetic fixtures, not a live control run. ADR-0018 therefore
remains Proposed. The transaction identifiers are
G1.1-G1.5c plus G1.4a-G1.4b; G1.7 is the joint compatibility/performance
qualification gate in the
[linked-data-store evolution
plan](../plans/linked-data-store-evolution-harness-plan.md), with product
promotion retained as a later human decision.
