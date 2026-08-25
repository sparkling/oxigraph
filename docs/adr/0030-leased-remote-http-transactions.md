# ADR-0030: Leased remote HTTP transactions

- Status: Proposed
- Date: 2026-08-25
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; the server has no remote transaction
  route, lease registry, or owned server transaction handle
- Programme task: `task-1787670632421-dkucm8` (G4.5)
- Depends on:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md)
- Related:
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
G4.5 owns implementation; no acceptance receipt exists yet.
