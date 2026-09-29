# ADR-0030: Leased remote HTTP transactions

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-29
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; the server has no remote transaction
  route, lease registry, or owned server transaction handle
- Programme task: `task-1787670632421-dkucm8` (G4.5)
- **Depends on**:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md)
- **Related**:
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md),
  [ADR-0029 — RDF4J REST interoperability](0029-rdf4j-rest-interoperability.md)

## Context

The HTTP server executes each SPARQL Update or Graph Store mutation in its own
request-owned transaction. It cannot let a remote client stage several reads
and writes, observe read-your-writes, and choose commit or rollback later.
RDF4J interoperability and some administrative workflows need that lifecycle,
but an unbounded server-held transaction would be unsafe in this repository.

`Store::Transaction<'a>` borrows its `Store`, and both built-in backends
currently serialize writers. Keeping that borrowed transaction in a global
HTTP registry would require unsafe or self-referential lifetime machinery;
keeping any write transaction open for an arbitrary client lease would also
block every later writer for that store. A lost commit response introduces the
same ambiguous-outcome problem addressed by ADR-0020. Remote transactions must
therefore be an explicit, tightly bounded optional capability rather than an
HTTP wrapper around the current borrowed type.

## Decision

Add a native, single-node leased-transaction profile only after the required
identity, admission, receipt, and outcome-lookup capabilities exist. The
profile has two layers:

1. The store exposes an additive owned-transaction capability. The built-in
   implementation owns the storage handle and writer permit safely and
   provides the same staged RDF, named-graph topology, namespace, query,
   update, commit, and rollback behavior as `Transaction<'_>`. It does not
   change `TransactionalDataset` or `WritableDataset`, so replacement
   persistence implementations remain source compatible and opt in through a
   separate extension trait.
2. The server owns an in-memory lease registry around those handles. Registry
   entries bind repository identity, authenticated principal and tenant,
   effective transaction capabilities, transaction key, creation time,
   absolute expiry, lease generation, current operation, and terminal state.
   The registry never serializes staged RDF or attempts to resume it after a
   process restart.

The proposed Rust seam is an `OwnedTransactionalDataset` extension returning
an `OwnedTransaction` that supports the existing query/update bindings plus
`WritableDataset`. `OwnedTransaction` is not clonable. Commit and rollback
consume it, and its drop behavior remains rollback-before-commit-attempt. The
server wraps it in a per-entry mutex so exactly one request may operate on a
transaction at a time; a concurrent operation receives typed `TransactionBusy`
rather than acquiring an unspecified order.

The first native HTTP profile is versioned under these routes:

- `POST /transactions` begins a lease and returns `201 Created`, an opaque
  non-secret transaction ID, a secret transaction token in a protected header,
  an expiry timestamp, a lease generation, and the effective guarantees;
- existing query, update, and Graph Store routes accept
  `Oxigraph-Transaction-Id`, `Oxigraph-Transaction-Token`, and
  `Oxigraph-Transaction-Generation` headers and then execute against the
  staged view;
- `POST /transactions/{id}/renew` performs an explicit compare-and-swap lease
  extension within the configured absolute lifetime;
- `POST /transactions/{id}/commit` requires an idempotency key and returns the
  ADR-0020 commit receipt or a typed indeterminate outcome with its lookup key;
- `DELETE /transactions/{id}` explicitly rolls back; and
- `GET /transactions/{id}/outcome` returns active metadata or the retained
  terminal outcome without exposing staged RDF.

The transaction token is never placed in a URI. The ID alone grants no
authority. Exact header names and JSON error codes are frozen with the native
protocol evaluator before implementation; RDF4J-compatible routes in
ADR-0029 translate onto this lifecycle rather than redefining its state
machine.

Lease activity does not renew implicitly. Configuration sets an idle limit,
an absolute lifetime, a maximum single extension, operations, request bytes,
result bytes, and staged-change budget. The effective lifetime is capped by
operator policy even if the client requests more. Expiry cancels an active
operation, waits only for the bounded cancellation path, and rolls back when
non-commit is still proven. Once the state reaches `CommitAttempted`, expiry
cannot report rollback; ADR-0020 outcome lookup resolves committed, proven
absent, expired/unknown, or indeterminate.

A clean server shutdown stops admission, cancels active work, rolls back all
transactions that have not attempted commit, and records counts and terminal
reasons. After a crash or restart, leases are gone. Retained transaction keys
and commit receipts resolve possible commit attempts, but staged transactions
are never reconstructed or replayed. Response loss likewise never triggers an
automatic update replay.

The server may reject begin with `429` or `503` and bounded retry advice when
the per-principal, per-repository, or global lease budget is exhausted. With
the current serialized-writer backends, the default maximum active write lease
is one per repository and the lease duration must be short. Benchmark evidence
may decide that the operational cost makes the feature unsuitable or keeps it
disabled; this ADR does not assume adoption is inevitable.

## Security and operational behavior

- ADR-0026 authorization is checked at begin and again for every operation;
  identity, tenant, repository, and granted operation set cannot be changed by
  renewal.
- Transaction IDs use at least 128 bits of cryptographic randomness. Tokens
  have higher entropy, are compared in constant time, retained only as a
  verifier, redacted from logs, and never returned after begin.
- Repository authorization precedes registry lookup so an ID cannot be used as
  an existence oracle across tenants. Terminal lookup has the same rule.
- Built-in `SERVICE`, `LOAD`, and document access retain ADR-0019 egress and
  cancellation policy. A transaction token conveys no egress authority.
- Cookies and permissive CORS are not transaction authentication. Browser use
  requires the same explicit credential and origin policy as other privileged
  writes.
- Metrics bound labels and record state, age bucket, disposition, admission
  reason, and cleanup latency, not IDs, tokens, principals, query text, RDF,
  or IRIs. Security audit records use the metadata policy from ADR-0026.
- Readiness fails when expired leases cannot be reaped, the writer gate remains
  held beyond policy, receipt lookup is unavailable, or registry limits cannot
  be enforced.

## Explicit non-goals

- Persisting or resuming uncommitted staged state across process restart.
- Distributed, two-phase, nested, or cross-repository transactions.
- Savepoints, automatic retry, or automatic replay after an unknown outcome.
- Long-running analytical snapshots or an unbounded interactive session.
- Treating the native routes as a W3C SPARQL Protocol feature.
- Weakening per-request update atomicity for clients that do not opt in.

## Staged evidence gates

1. **Owned-handle evaluator.** A frozen public Rust evaluator proves
   read-your-writes, query/update composition, topology and namespace behavior,
   explicit/drop rollback, negotiated capabilities, and replacement-backend
   source compatibility without unsafe code.
2. **Lease state-model evaluator.** A deterministic model covers begin,
   operation, renewal, expiry, cancellation, rollback, commit attempt,
   response loss, outcome lookup, tombstone expiry, and restart. Random traces
   record and shrink seeds.
3. **Loopback protocol evaluator.** Native HTTP fixtures prove status/error
   mapping, token redaction, same-principal binding, CAS renewal, concurrent
   operation rejection, query streaming cancellation, Graph Store conditions,
   idempotent terminal calls, and no partial publication.
4. **Failure and recovery evaluator.** Injected failure surrounds every commit
   and response boundary. Restart proves that staged state is absent while a
   possibly committed transaction remains resolvable without replay.
5. **Admission and benchmark gate.** The 1/4/16-client matrix records writer
   wait, lease age, expiry cleanup, commit latency, memory, open file handles,
   reader liveness, and ordinary autocommit tail regressions. Numeric promotion
   thresholds are frozen only after parent-first baselining.

No server route or service-description claim is enabled before all applicable
gates have source-bound receipts. The RDF4J compatibility evaluator is an
additional gate, not a substitute for the native state model.

## Consequences

- Clients can group remote operations atomically and observe staged writes.
- The owned transaction seam removes unsafe lifetime pressure from the server
  and is available only to backends that explicitly implement it.
- A lease consumes scarce writer and memory capacity, so admission and cleanup
  become correctness-relevant operations.
- Crash semantics are honest but deliberately weaker than durable suspended
  transactions: outcomes survive where ADR-0020 proves them; staged work does
  not.
- The extra protocol, terminal retention, and security surface materially
  increase testing and operational cost.

## Alternatives rejected

- **Store `Transaction<'_>` in a self-referential registry.** It makes a
  server protocol depend on fragile lifetime or unsafe machinery.
- **Let clients choose an unlimited lease.** One disconnected client could
  monopolize the serialized writer gate.
- **Renew on every request.** A busy or malicious client could keep scarce
  state alive indefinitely without an explicit, auditable decision.
- **Retry commit after a lost response.** Re-executing effects can duplicate
  writes or external work; durable outcome lookup is the safe boundary.
- **Persist arbitrary transaction objects.** Backend-private in-memory state
  is not a stable crash format or migration contract.

## Evidence and task ownership

Current request-owned transaction paths are in
[`main.rs`](../../cli/src/main.rs) and
[`graph_store.rs`](../../cli/src/graph_store.rs). The borrowed Rust transaction
is in
[`store.rs`](../../lib/oxigraph/src/store.rs), with negotiated persistence
traits in [`transactional.rs`](../../lib/oxigraph/src/store/transactional.rs).
G4.5 owns implementation. The bounded prerequisite below is accepted; the
owned public handle, evaluator and leased HTTP profile remain unimplemented.

## Owned memory writer permit (2026-09-29)

`storage/memory.rs` now stores an `Arc<Lock>` in the existing writer permit.
All existing memory transaction paths use it; admission, keyed outcomes and
rollback-before-permit-release behavior are unchanged. The transaction itself
still borrows `MemoryStorage`: this is not the public owned-handle gate.
Exact source SHA256:
`baa3ee489ada2949b35582fabeffcedd8db20abbe76de33661f9ce71a69d7e27`.

Ordinary batch `workflow-klmGGY`, run
`3fcc6de3-89d0-479b-9069-dc1851abf6bc`, used native Sonnet 5.5/high planning,
authoring and fresh review, with Opus/high formatting-only repair. Final fresh
reviewer `0d22939d-274e-4910-bb06-dbb5d7cfccfc` accepted. Candidate no-default
unit tests pass 14/14 (`run-WT0Fiq`); integration tests pass 7/7
(`run-KuYSnz`). The concurrency integration file is feature-excluded in that
configuration, not additional coverage. Canonical default and RDF 1.2 module
checks each pass 14/14 (`run-dqz21r`, `run-wzP0HK`) with exact source bindings
verified before this evidence edit. Formatter passes. Candidate no-default
library/test Clippy exits 0 with warnings, not a warning-free claim.

Lane receipt SHA256:
`f4d5f28a3cee9062122c7f8c84f35db07432f9ddbe552cdf34a06005ece84062`.
All 24 event/check/handoff references verified; structured MCP handoff readback
and native learning retained. Cohort and external actions drained before
integration. Prior rejected formatting review and original receipts remain.
Original outcome `task-1787670632421-dkucm8` uses migration registry alias
`task-1790657013522-cscfy2`; the umbrella remains open. No HTTP exposure,
qualification, promotion or publication follows. ADR remains Proposed.

## Owned native RocksDB transaction (2026-09-29)

`storage/rocksdb_wrapper.rs` now retains `Arc<RwDbHandler>` in all three
readable transaction start paths, returning a native `'static` transaction.
The covariant lifetime marker preserves existing caller compatibility;
readers still borrow the transaction. Native batch, options and snapshot are
destroyed before the database owner is released. Keyed outcome transitions
and writer-permit semantics remain unchanged. No new unsafe lifetime extension
or public owned `Store` transaction is introduced. Exact file SHA256:
`3151b51d5591c13cf373de66106288b977fe37d4c3c61008e7437cc63a985156`.

Independent lane in `workflow-klmGGY`, run
`cd8f7900-02a1-494a-a8e2-1d9892402b97`, used Sonnet 5.5/high ordinary roles,
Opus/high formatting-only repair and fresh reviewer
`e076c4cc-4721-465a-9d70-be9060149df9` (ACCEPT). Repaired candidate wrapper
tests pass 15/15 (`run-sYeHvO`); transaction integration tests pass 12/12
(`run-nqL2s4`). Formatter passes. Candidate default library/test Clippy exits
0 with warnings, not a clean-lint claim. Negative review and earlier checks
remain preserved.

Lane receipt SHA256:
`0f73a316a26f68ffa22272aa6509b757066df4592139b3fb6553187b54bd98c0`.
All 24 event/check/handoff hashes verified; structured MCP readback and native
learning retained. After cohort drain, source/read/evaluator inputs were
revalidated against accepted memory prerequisite `14fd64909`. Its private
memory change and this ADR's evidence append do not alter the RocksDB packet's
caller contract. The combined canonical source was rebuilt and tested:

- Default storage suite: 108 passed, 1 ignored (`run-ds3LEK`).
- RDF 1.2 storage suite: 107 passed, 2 ignored (`run-DV3gSO`).
- Default and RDF 1.2 transaction contracts: 12 passed each
  (`run-3foZAS`, `run-RZVlRN`).

Storage-suite counts are top-level; nested helper summaries make generic
runner aggregates larger. Exact canonical source/sourceAfter bindings were
verified before this evidence append. Registry task
`task-1790657013821-0hn394` closes only this native prerequisite. Remaining
backend-storage ownership, public owned handle, evaluator and lease/protocol
gates stay on original G4.5 outcome. ADR remains Proposed; no HTTP exposure,
qualification, promotion or publication.

## Owned memory storage transaction (2026-09-29)

`MemoryStorageTransaction` now owns its cloned `MemoryStorage`, preserving a
covariant lifetime marker for existing callers. All native start paths return
`'static` transactions; readers still borrow the transaction. Receipt commit
retains a storage clone while consuming the transaction. Existing rollback,
MVCC, keyed/governed outcomes and permit-last drop order remain unchanged.
Exact `storage/memory.rs` SHA256:
`ba3b3f1b0bdf97451917483c3c87cc8f46a4d1d6d4ca14fe3b01be89a6d0c5b2`.

Batch `workflow-z3f6kV`, run `609acc3b-7d00-4e38-a753-79e8771ff913`, used
Sonnet 5.5/high ordinary roles and Opus/high formatting-only repair. Fresh
reviewer `cac607e0-7044-4d3e-8403-c0d0011620d4` accepted exact repaired source.
Candidate no-default module tests pass 24/24 (`run-wYxoQB`); integration tests
pass 7/7 (`run-N7oKfA`). The concurrency file is feature-excluded there.
Formatter passes. Pre-format-repair candidate Clippy exits 0 with warnings;
no warning-free claim. The rejected formatting review remains preserved.

Lane receipt SHA256:
`624471f4582ff820d360334a4b7ce6bbe2a82beade798bef245d8eec0079a6bc`.
All 24 event/check/handoff references verified, with structured MCP readback
and native learning retained. Both original and RocksDB repair batches drained
before integration; their failed RocksDB output receipts remain negative evidence.
The 15,213 unchanged included source/read inputs and submodule pins matched
clean canonical base `8b6b83503`. Canonical exact-source default/RDF 1.2 module
checks pass 24/24 each (`run-eMFmLj`, `run-cvuAUv`); transaction integration
checks pass 12/12 each (`run-05dnM9`, `run-YV1FF1`). Source/sourceAfter bindings
verified before this evidence append.

This accepts only memory backend ownership. Public owned handle/evaluator,
RocksDB storage wrapper ownership and lease/protocol gates remain open on
original G4.5 outcome. No HTTP exposure, qualification or publication. ADR
remains Proposed.

## Owned RocksDB storage transaction (2026-09-29)

`RocksDbStorageReadableTransaction` now owns a cloned `RocksDbStorage`;
readable, controlled, keyed and governed start paths return `'static` handles.
The native transaction retains its covariant lifetime marker. Readers still
borrow it, and field order releases the native transaction before the storage
clone. Existing outcomes, receipts, write-only and bulk paths remain unchanged.
Exact `storage/rocksdb.rs` SHA256:
`a48be99fbfe215762be3e336e03548b67744ac99ecef6e21d88fc5cd4e730394`.

Sonnet run `462373f3-d6c2-4ac7-9b91-71ffae561dfc` and same-task Opus repair
`8f302887-75b9-424f-b65a-b69fd5d43dce` returned `INCONCLUSIVE`, no structured
changes, reporting full-file output failures. Both negative receipts remain:
`1e2e22056fd53c7950aa79a39e8cd70228909a4660fab05317a7b1cfb6d02af3`
and `52fd3da80c565c3c04fd7903690c8a4609b3fedce3585deedfa387552d3aba61`.
These are not successful workflow or acceptance evidence.

Under the direct-work policy, root applied the exact Opus summary edits and
tests, then formatting, to fresh isolated `source-io8Wvq` from accepted
`453cff01b`. Only the declared source file changed. Direct candidate checks
pass 13/13 module tests and 12/12 transaction integration tests; formatter
passes. Clippy exits 0 with 603 library-test warnings, not a clean-lint claim.
Observations are recorded as coordinator-observed checks, not runner receipts,
in `target/engineering-delivery/g45-direct-check-observations.json` and
`g45-direct-clippy-observation.json` in that same directory.

Fresh independent Sonnet 5.5/high review
`7f0f1464-d824-4477-b5fe-feccb3664b45`, reviewer
`c7b0fb1b-33ea-4dca-8d4a-6a2371f18933`, accepts exact source. Review identity,
15,213 unchanged included source/read inputs and submodule pins were revalidated
after all native/check actions drained. No failed worker acceptance was inherited.
The composed canonical source passes default storage 120 tests/1 ignored
(`run-uC4KFQ`) and RDF 1.2 storage 119 tests/2 ignored (`run-QpmJgR`), using
top-level counts rather than nested helper summaries. Default/RDF 1.2
transaction integrations pass 12/12 each (`run-vE6nSz`, `run-yIcRoc`). Exact
source/sourceAfter bindings verified before this evidence append.

Task `task-1790659791175-01dgrw` closes only this backend prerequisite.
Public owned-handle/evaluator and lease/protocol work remain on G4.5.
ADR remains Proposed; no HTTP exposure, qualification, promotion or publication.
