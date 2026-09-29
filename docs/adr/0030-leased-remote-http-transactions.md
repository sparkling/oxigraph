# ADR-0030: Leased remote HTTP transactions

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-29
- Deciders: Oxigraph parity programme
- Implementation status: native owned storage and additive public owned Store
  handle implemented within the bounded evidence below. The server has no
  remote transaction route, lease registry, or owned server transaction handle
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
G4.5 owns implementation. The bounded native ownership and public handle slices
below are accepted; the frozen independent evaluator and leased HTTP profile
remain open.

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

## Owned backend-neutral storage dispatch (2026-09-29)

The four readable, controlled, keyed and governed starts in `storage/mod.rs`
now return existing `'static` wrappers over the accepted owned backends.
Bodies, readers borrowing transactions, public borrowed `Store` API, write-only
and bulk paths, admission and terminal observation semantics are unchanged.
New `storage/owned_transaction_tests.rs` covers both backends: lifetime bounds,
original-storage drop, staged RDF/topology/namespaces, commit/rollback/drop,
keyed and governed outcomes, receipt lookup, admission, metrics ownership and
cross-thread use. No public owned API or HTTP capability is claimed yet.

Exact file SHA256 values:

- `storage/mod.rs`:
  `7f945693d71681dab77b26e54bf405401d84f9d71dd59f17f0a02faba5790dea`.
- `storage/owned_transaction_tests.rs`:
  `2d31f75f2a6867e9e41ee78cdf262a650cec4307d3fb389791ca5c7b14e2ac16`.

Ordinary batch `workflow-Icm5j7`, run
`d92839d2-614d-471d-b97f-88609c14af84`, used Sonnet 5.5/high ordinary roles
and Opus/high whitespace-only repair. Fresh reviewer
`9c264765-563f-425d-89cf-03826e613adb` accepted the repaired source. Candidate
no-default/default module checks pass 7/7 each (`run-NTp2HS`, `run-rMNnuH`);
transaction contracts pass 12/12 (`run-by50VZ`). Focused formatter passes.
Pre-format candidate Clippy exits 0 with 603 library-test warnings, including
38 duplicates, not a clean-lint claim. Direct observation is recorded in
`target/engineering-delivery/g45-dispatch-clippy-observation.json`, not a
runner-owned receipt. Original formatting rejection and checks remain intact.

Lane receipt SHA256:
`a3e7ba1832f7d230bb8d18521aad46c36d4d5771d6baec960751d4e764955a61`.
All 28 event/check/handoff references, nine submodule pins, fresh reviewer
identity and 15,213 unchanged included source/read inputs verified before
integration. Structured MCP readback and native learning retained. Batch and
external actions drained; canonical default/RDF 1.2 checks used separate
targets and shared host capacity:

- Storage default: 127 passed, 1 ignored (`run-LeR0Fu`).
- Storage RDF 1.2: 126 passed, 2 ignored (`run-rCgv6D`).
- Transaction contracts default/RDF 1.2: 12 passed each
  (`run-QQ2Cl7`, `run-PXV7Cl`).

Counts are top-level, not nested helper aggregates. Exact canonical
source/sourceAfter bindings and candidate file equality verified before this
evidence append. Reader borrowing remains enforced by unchanged signatures;
this slice adds no compile-fail reader test. Original G4.5 registry alias
`task-1790657013522-cscfy2` stays open for public owned handle/evaluator and
lease/protocol gates. ADR remains Proposed; no qualification or publication.

## Additive public owned Store handle (2026-09-29)

`OwnedTransaction` wraps the existing `Transaction<'static>` and reuses its
query/update bindings, namespace operations and consuming terminals. The
separate `OwnedTransactionalDataset` extension preserves the minimal traits
and borrowed APIs. Owned and borrowed negotiation share unchanged requirement
and admission behavior. No unsafe lifetime extension, clone, savepoint,
per-update atomicity or HTTP capability is introduced. Failed caller-managed
updates can retain staged state until explicit rollback or drop.

Exact source SHA256 values:

- `store.rs`: `7c4411d585b8361b0ae5063989db5525b88f5e0a03ae67c652a2dddc21f505e6`.
- `store/transactional.rs`: `71b8c5db75dc50303d181aeb1e47bf53bb31129b03321762763fb23520452334`.
- `tests/owned_transaction.rs`: `31a8adbc87ecb78711b328350dafd42a571837e489b1278763f5431aac67c350`.

Original ordinary batch `workflow-pJ0IgW`, run
`da6c018f-7bd5-403a-b93c-b314670671f7`, failed with an inconclusive partial
Sonnet proposal after full-file output overflow. Negative lane SHA256
`83a7c54d059f7ab761a6479595b8b26a00ec3051f3a29c47aa99618806e35915`
remains unchanged; it is not successful workflow or acceptance evidence.
Root applied exact Opus repair instructions in isolated `source-xnYgHD`,
then bounded test fixes and formatting. Initial E0521 fixture failure and
fresh review rejection for test gaps remain preserved. Same-task Opus repair
added negotiated metrics, an external owned-extension backend and paired
positive/compile-fail borrow examples, without changing production behavior.

Fresh independent Sonnet 5.5/high review run
`001620e9-adc3-4748-bd7b-e59a01411bba`, reviewer
`06fad798-4ee9-498d-aff9-6da5fbd99028`, accepts exact repaired source.
Response SHA256:
`55932facc7ab264722044df485a1ac9d4cecacf03b20589e28dc7eaeb5f3926e`.
All native/check actions drained before integration. Revalidation covered
15,213 unchanged included source inputs, nine submodule pins, 16 review
dependencies and exact request/response identities and file hashes.

Candidate default/RDF 1.2 impacted transaction suites pass 61 each;
no-default checks pass 19; Store doctests pass 42, including two compile-fail
cases and a passing positive control. Stable rustdoc does not enforce the
error-code annotation. Formatter passes. Current-source Clippy exits 0 with
79 owned-test warnings plus existing warnings, not warning-free evidence.
Direct observations are in
`target/engineering-delivery/g45-public-direct-repaired-observations.json`,
not manufactured runner receipts.

Canonical default/RDF 1.2 impacted suites pass 61 each (`run-TecY2W`,
`run-kRBvxu`); Store unit tests pass 183 (`run-a97Zi8`, 1482.22 seconds).
These are top-level counts, not nested process-helper totals. Source and
sourceAfter bindings verified before this evidence append. Canonical RDF 1.2
Store doctests pass 42 via direct Cargo, session 37012: the recorded runner
rejects `--doc`, so no runner receipt is claimed for that command.

This accepts the bounded public API and ordinary regression tests, not the
frozen independent public evaluator gate. The extension's associated owned
type requires `'static`, not `Send`; a generic server must impose its own
thread-safety bound. Owned keyed/governed openers, frozen evaluator and
lease/protocol stages remain on G4.5. ADR remains Proposed. No qualification,
promotion, HTTP exposure or publication follows.

## Owned keyed and governed public openers (2026-09-29)

Additive inherent Store constructors now return the existing
`KeyedTransaction<'static>` and `GovernedTransaction<'static>` through
`NegotiatedTransaction`. Controlled counterparts preserve rejection before
admission/key reservation, cancellation, effective capabilities and typed
terminal outcomes. Borrowed signatures and persistence traits stay unchanged.
Governed admission shares a private helper; effect capture, receipt/outbox
publication and rollback semantics remain the existing implementation.

Exact source SHA256 values:

- `store/transactional.rs`:
  `db9052e06687844e699cdca16ae217436c53e3abf16412cd71cf9d4bf994b0d1`.
- `store/receipt.rs`:
  `97ab2993d450003d79e825d9cd6d3136b91787c737125897552ccfe02a6c77f7`.
- `tests/owned_keyed_transaction.rs`:
  `2d17d4ff9f901d7b08afc745ace7627d9893d4cbc0b2659ce1a7b7bfaba7cab2`.
- `tests/owned_governed_transaction.rs`:
  `d1fcf2afab8a8f52e6a1e557c7a4c083b3d5dc22ee994c01b631570d7ba95e70`.

Ordinary batch `workflow-AFbaz5` ran independent keyed/governed lanes
`9f075e67-783c-486d-859e-e01e033e856d` and
`3bd18d56-f53e-4ed7-b0a3-ccd0db685906`, with Sonnet 5.5/high ordinary roles
and Opus/high formatting-only repairs. Both fresh reviews accepted. Each
lane's 27 event/check references and structured MCP handoff were verified.
Negative formatting reviews and earlier output-limit receipts remain intact.
Both lanes and all external actions drained before canonical integration.

After harness deployment merge `1c065610c`, a fresh composed candidate
`source-sa7HPT` received independent Sonnet 5.5/high review
`30f605c1-7f66-4944-8927-9486c425483e`, reviewer
`6e37de31-483a-4157-a9d1-f12caba9a9cb` (ACCEPT). Response SHA256:
`dc132031a24a115b560c1dbdcf26c5f70c1a54e42334e4f36dab67da1ce3b839`.
Revalidation checked 15,214 unchanged included source inputs, 17 review
dependencies, request/response identity and all four candidate hashes.
Composed candidate checks pass 114 default, 20 no-default, 39 RDF 1.2
integration tests and five receipt unit tests. Focused formatter passes.
Clippy exits 0 with 67 governed-test and 59 keyed-test warnings plus existing
library warnings; this is not warning-free evidence.

Exact canonical source/sourceAfter bindings were verified before this append:
default nine-target integration suite passes 114 (`run-QnWaqI`), RDF 1.2
passes 116 (`run-UvjZsW`), and RDF 1.2 receipt unit tests pass five
(`run-MaD7E2`). Counts are top-level, not nested helper aggregates. New
governed fault coverage proves typed-key retention around both final batch
fault boundaries after original Store drop, with orderly reopen lookup.
It does not claim power-loss qualification.

This accepts bounded native API slices only. Governed support task
`task-1790669488928-73stxw` closes; original G4.5 alias remains open for
independent evaluator, lease model, protocol and later applicable gates.
ADR remains Proposed. No HTTP activation, qualification or publication.
