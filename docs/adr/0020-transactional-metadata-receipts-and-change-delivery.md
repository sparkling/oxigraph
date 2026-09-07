# ADR-0020: Transactional metadata, receipts, and change delivery

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-09-07
- Deciders: Oxigraph parity programme
- Implementation status: G2.1 is implemented in `be08cf3b`. G2.2 now includes
  opt-in staged semantic-change capture; request/keyed integration and G2.3a-c
  durable governance remain outstanding, so this ADR remains Proposed
- Update note: `ChangeTrackingTransaction` captures real backend-neutral
  mutations, with graph-scoped normalization and failure poisoning, without
  changing the minimal write traits, backends, or qualification evidence
- **Depends on**:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md)
- **Related**:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0015 — Parallel bulk-load failure semantics](0015-parallel-bulk-load-failure-semantics.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md),
  [ADR-0040 — Commit-capable containment decision and application-output release](0040-commit-capable-containment-decision-and-output-release.md)

## Context

G2.1 provides a transactional namespace registry. G2.2's first product slice
now provides opt-in normalized staged changes, but no commit-governance
identity and receipt or ordered change feed. A commit error can be ambiguous,
and downstream validators, indexers, or subscribers have no native atomic hand-off from
primary state. Quad-only events also lose the distinction between graph
creation, clear, drop, and namespace changes.

These concerns belong to commit governance, not to the minimal mutation trait
or dataset equality. Namespace metadata must remain transactional without
changing RDF dataset comparison semantics.

## Decision

Introduce a separate commit-governance capability with three staged slices:

1. A transactional namespace registry commits and rolls back with RDF changes
   but is excluded from RDF dataset equality. G2.1 is a separate additive
   capability: it must not add required methods to the minimal `WritableDataset`
   or `TransactionalDataset` traits from ADR-0016. It exposes validated
   `NamespacePrefix` and `Namespace` values plus a
   `WritableNamespaceRegistry: WritableDataset` extension, with matching
   inherent APIs on `Store`, `Transaction`, and `KeyedTransaction`. Generic
   persistence planes opt in by implementing the extension on their transaction
   type; G2.1 does not add a second transaction opener.
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

### G2.1 namespace semantics and durable encoding

The registry is store-global. The empty prefix denotes the default namespace;
every other prefix must satisfy the exact Turtle/SPARQL `PN_PREFIX` grammar,
including Unicode and excluding a trailing `.`. Prefix bytes are preserved as
UTF-8 without Unicode normalization. IRIs use the existing validated
`NamedNode` type.

Each prefix maps to at most one IRI. Setting a prefix overwrites its prior
mapping, setting an identical mapping is idempotent, and multiple prefixes may
map to the same IRI. Removal and clear are no-ops when nothing matches.
Iteration is deterministic ascending order over the exact prefix bytes, with
the empty prefix first. RDF clear never clears namespaces; namespace clear
never changes quads or named-graph topology.

Parser and loader prefix declarations remain transient unless the caller
explicitly writes them. The registry is not implicitly injected into SPARQL
parsing or dumps. Existing serializer prefix configuration is the explicit
opt-in boundary, and a serializer may reject a namespace that its format cannot
represent. This avoids turning metadata persistence into hidden parse or output
behavior.

Memory stores namespace mutations in the same MVCC version/log boundary as RDF
and topology, so namespace-only commits advance that boundary and snapshots,
rollback, and read-your-writes remain coherent. A side map outside MVCC is
forbidden.

RocksDB stores locally versioned records in the existing default column family:

- `\0oxigraph.namespace.schema\0` has value byte `[1]`; and
- `\0oxigraph.namespace.mapping.v1\0` plus the raw prefix UTF-8 has value
  `[1]` plus the IRI UTF-8.

G2.1 adds neither a column family nor a global storage-version bump. Absence of
the schema marker means a legacy store with an empty registry, preserving the
existing exact-column-family read-only open. Unknown schema or record versions,
invalid UTF-8, invalid prefixes or IRIs, duplicate visible prefixes, and mapping
records without the marker are corruption and must fail closed rather than be
skipped. A future choice to add a column family or bump the global version
reopens ADR-0028's migration evaluator; it is not part of G2.1.

## Acceptance boundary

### G2.2 staged-effect capture slice (2026-09-07)

[`ChangeTrackingTransaction`](../../lib/oxigraph/src/store/semantic_change.rs)
wraps an existing `WritableDataset` transaction and also implements
`WritableNamespaceRegistry` when the underlying transaction does. It has no
second opener or mutable escape hatch. Wrap a fresh transaction to capture its
full mutation history; unwrapped transactions and autocommit retain their
existing behavior and overhead.

`changes()` returns an immutable **pending** snapshot, not a receipt or feed.
Point reads distinguish actual quad and namespace changes from idempotent
writes. Implicit named-graph creation is a separate effect. Opposing point
effects cancel until a lifecycle boundary affects their graph or namespace
registry; unrelated graph operations do not prevent cancellation. Namespace
updates retain the first prior mapping and final mapping. Output is
deterministic for the same operation order and preserves blank-node identity.

Clear/drop calls retain bounded operation summaries without enumerating the
removed quads in the tracker. Successful clears, including empty-target and
aggregate operations, remain explicit ordering boundaries; missing single
graph clear/drop and idempotent point writes are omitted. This is not a
globally minimal initial-to-final diff: create/drop or insert/clear lifecycle
boundaries are not erased. The underlying backend's own clear work is unchanged.
Memory is proportional to outstanding point effects and retained lifecycle
boundaries, not the cardinality of removed graphs. No new resource-limit,
latency, or performance guarantee is advertised.

Failed mutation preflight or backend mutation poisons capture. Later mutations,
snapshots, and commit fail, while rollback/drop remain available. Backend
commit errors retain their original ambiguity, not a fabricated rollback
outcome. A copied pending snapshot never establishes that commit succeeded.

The public integration suite is
[`semantic_changes.rs`](../../lib/oxigraph/tests/semantic_changes.rs). It covers
memory, RocksDB/reopen, a separate Dataset-based persistence plane, explicit
and dropped rollback, partial-mutation/read failure, lost commit response,
point cancellation, scoped ordering, namespaces, and bounded summaries.
The original `transactional.rs` hash below remains unchanged. This slice does
not yet bind snapshots to negotiated/keyed ownership or expose request-level
SPARQL capture; those remain G2.2 integration work. Durable receipt/outbox,
commit identity/order, recovery lookup, cursors, and health remain G2.3a-c.

Validation for this slice: `semantic_changes` passes 11/11 with default
features and 10/10 without default features; the six existing transactional
dataset/namespace, topology, outcome, state-model, and update-atomicity suites
pass 37/37. The public wrapper doctest, strict library/new-test Clippy, and
format/diff checks pass. The default feature matrix includes RocksDB; this
does not claim that pending changes are durably stored with a commit.

### Existing G2.1 evidence and complete ADR acceptance

G2.1 is implemented by commit `be08cf3bbcb836ec46df2b864d31e80f5b837b52`.
The default-feature evaluator passes 13/13 across memory, RocksDB, and the
test-only rewritten persistence plane; the `--no-default-features` evaluator
passes 8/8 across memory and the rewritten plane. The focused regression suites
pass `store` 26/26,
`transaction_outcomes` 7/7, `transaction_state_model` 3/3, and
`transactional_dataset` 3/3; the no-default-feature library check also passes.
The evaluator includes Store-level RocksDB
set/remove/range-clear and reopen coverage. The pre-existing minimal transaction
trait file remains byte-identical at SHA-256
`ae84a63b060400845cd965828cb314a2ac9fc7da3d30655a1a7603af6c924e55`.

This ADR may move to Implemented only when G2.1-G2.3c prove:

- namespace and RDF mutations commit and roll back together while dataset
  equality ignores namespace metadata;
- the same namespace evaluator passes for memory, RocksDB, and a test-only
  rewritten persistence plane without changing the two minimal write traits;
- default and Unicode prefixes, invalid grammar, deterministic iteration,
  overwrite, duplicate-IRI mappings, idempotent remove/clear, read-your-writes,
  isolation, explicit rollback, and dropped-transaction rollback behave
  identically;
- namespace-only mutation preserves reconstructed RDF dataset equality and
  named-graph topology, RDF clear preserves namespaces, and namespace clear
  preserves RDF and topology;
- parser/load declarations, SPARQL parsing, and dumps do not persist or consume
  registry prefixes implicitly;
- RocksDB legacy open, reopen, and read-only behavior pass, while malformed or
  unknown namespace records fail as corruption;
- a keyed mixed RDF/namespace commit publishes atomically with its terminal
  outcome, and rollback publishes neither part;
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
Commit `be08cf3b` implemented G2.1 in the public-only
`lib/oxigraph/tests/transactional_namespaces.rs` evaluator and exactly six
product paths: the new `store/namespace.rs` API plus `store.rs`,
`storage/mod.rs`, `storage/memory.rs`, `storage/rocksdb.rs`, and
`storage/rocksdb_wrapper.rs`. Parser, serializer, SPARQL, CLI, bindings, and
Cargo integration remain intentionally outside G2.1. G2.2's opt-in capture
adds `store/semantic_change.rs` and its public integration tests, with exports
from `store.rs`. Its remaining integration and G2.3's durable receipts, outcome
resolution, authoritative outbox, retention/leases, and governance health keep
this ADR Proposed. Under ADR-0043, optional containment is not a prerequisite
for these direct product slices.
