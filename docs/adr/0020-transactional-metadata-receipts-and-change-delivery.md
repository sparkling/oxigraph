# ADR-0020: Transactional metadata, receipts, and change delivery

- **Status**: Implemented (native G2.1–G2.3c scope below)
- **Date**: 2026-08-24
- Updated: 2026-09-07
- Deciders: Oxigraph parity programme
- Implementation status: G2.1 is implemented in `be08cf3b`. G2.2 now includes
  opt-in staged semantic-change capture and request/keyed integration.
  G2.3a native atomic receipts and G2.3b ordered outbox are published in `58d3253c`.
  G2.3c adds opt-in bounded retention, fenced leases, expired receipt lookup,
  physical-record backpressure, and native governance-health observations
- Update note: `ChangeTrackingTransaction` captures real backend-neutral
  mutations, with graph-scoped normalization and failure poisoning, without
  changing the minimal write traits, backends, or qualification evidence.
  Whole-update capture returns effects only after acknowledged commit.
  The separate governed Store opener returns a receipt from the same primary batch
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

G2.1 provides a transactional namespace registry. G2.2 provides opt-in normalized
staged changes and acknowledged whole-update capture. G2.3a adds native governed
commit identity and receipt lookup, but not an ordered change feed. A commit error can be ambiguous,
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

### G2.3a native atomic receipts (2026-09-07)

`Store::start_governed_transaction(request, key)` and its controlled counterpart
open an opt-in `GovernedTransaction`. The wrapper starts capture before any
mutation and exposes no mutable underlying transaction or caller-supplied
effect payload. Inherent `commit()` returns `CommitReceipt`; generic write
traits still commit governance but discard the receipt. The minimal write
traits and existing SPARQL `execute_with_changes` paths are unchanged.

`Store::lookup_commit_receipt(key)` returns `Committed(receipt)`,
`CommittedWithoutReceipt` for an explicit legacy keyed commit,
`ProvenAbsent(RolledBack)`, or `Indeterminate`. A missing key is indeterminate.
Lookup reads stored outcomes, never replays mutations. Version, length,
checksum, key, store identity, and sequence mismatches are corruption.

RocksDB uses the existing default column family and held writer permit:

- Legacy `\0oxigraph.transaction-outcome.v1\0` records remain byte-identical.
- `\0oxigraph.transaction-outcome.v2\0` plus the caller's 16-byte key stores
  staging `[2,0]`, attempted `[2,1]`, rollback `[2,3]`, or committed `[2,2]`
  followed by exactly one encoded receipt. Admission checks both namespaces
  under the writer permit. A v2 committed value missing its receipt is corrupt,
  not a legacy commit; dual v1/v2 reservations are also corrupt.
- `\0oxigraph.governance.v1\0` stores version `[1]`, 16-byte store identity,
  8-byte big-endian governed sequence, and 32-byte SHA-256 checksum over
  `oxigraph.governance.v1\0` followed by the first 25 bytes.
- The final synchronous batch publishes primary RDF/topology/namespaces,
  committed outcome with embedded receipt, and governance high-water together.
  Existing staging and attempt writes preserve the conservative outcome model.
  Fallible state validation occurs before the attempt; errors from the commit
  protocol are indeterminate with the exact caller key, never retried as writes.

The 145-byte receipt format is: version `[1]`, store identity (16 bytes), commit
identity (32), transaction key (16), governed sequence (8, big-endian), retained
effect count (8, big-endian), effect SHA-256 (32), envelope SHA-256 (32). The
envelope hashes `oxigraph.receipt.v1\0` and the preceding 113 bytes. Commit ID
hashes `oxigraph.commit-id.v1\0`, store identity, sequence, transaction key,
effect count, and effect checksum, in that order. Decode verifies both bindings.
These checksums detect corruption; they are not authentication signatures.

Effect checksum v1 hashes `oxigraph.semantic-changes.v1\0`, big-endian u64
effect count, then the retained operation sequence. Operation tags are 0 quad
add, 1 quad remove, 2 named-graph create, 3 graph clear, 4 named-graph drop,
5 all-named clear, 6 all-graphs clear, 7 all-named drop, 8 dataset clear,
9 namespace change, and 10 namespace clear. Quad fields follow subject,
predicate, object, graph order. Terms use tags 1 IRI, 2 blank node, 3 literal,
4 triple term; default graph is tag 0. Strings are u64-length-prefixed raw UTF-8.
Literal fields are lexical value, datatype IRI, language presence byte and
optional language, then direction byte 0 none, 1 LTR, or 2 RTL. Triple terms
recursively encode subject/predicate/object. Namespace change encodes prefix,
then before and after as presence byte plus optional raw IRI. No Display
formatting, physical index identity, Unicode normalization, or dataset
canonicalization is involved. Identical RDF 1.1 terms hash identically with
and without the `rdf-12` feature.

The RocksDB lineage identity is randomly allocated on the first successful governed
commit and survives reopen and backup. Sequence starts at 1, orders governed
receipts only, and includes successful no-op governed commits. It is not a
global sequence for legacy writes, a wall clock, or an outbox cursor. Overflow
fails before commit attempt. Missing high-water state cannot silently create a
new lineage when committed governed history exists. No column family, global
storage version, migration, baseline, or qualification evidence is changed.

Memory allocates its lineage when the store is created and exposes the same API
as process-local receipts without advertising durable outcome lookup.
A governance write lock and retained outcome-entry
guard cover receipt installation, MVCC publication, and the terminal state
flip; lookup uses the same governance lock. Poisoned state fails as corruption.
Rollback/drop publishes no receipt and consumes no receipt sequence.

G2.3a does not provide an outbox, listeners, cursor retention/leases, governance
health, power-loss qualification, automatic SPARQL/HTTP receipt response, or
governed bulk loading. Receipts and caller-key tombstones currently have no
expiry or deletion policy; storage grows until G2.3c supplies explicit retention.
G2.3b owns the ordered outbox; G2.3c owns retention and governance health. This
staged implementation does not close the full ADR.

### G2.3b native ordered outbox (2026-09-07)

`Store::read_outbox(after, NonZeroUsize)` returns an `OutboxBatch` from one
snapshot: ordered `OutboxRecord::Commit` headers and `Event` payloads, a next
cursor, snapshot high-water cursor, and explicit coverage origin. Pages are
bounded by records, not bytes, and may split commits. Polling is stateless;
there is no acknowledgement, lease, deletion, or hidden cursor advance. Save
`OutboxCursor::to_bytes()` only after applying a record; deduplicate events by
`(commit_id, event_index)`, with zero-based indices. No-op governed commits have
one header and no events. Clear/drop remain operation summaries, not enumerated
deleted quads. Legacy autocommit, loaders, and existing SPARQL Update entry
points do not implicitly become governed feed producers.

RocksDB stages records and the outbox high-water alongside primary RDF,
namespaces, receipt, and terminal outcome in the same final synchronous batch.
Memory publishes the same logical unit under the existing governance lock and
MVCC publication boundary. Fallible encoding and checked cursor allocation precede
CommitAttempted. Rollback, abandoned staging, and failed final writes consume
no published cursor. An error after the final write remains indeterminate;
lookup and replay resolve the durable result without repeating mutations.

This slice adds explicit, additive local record formats; the preceding G2.3a
formats remain the receipt-only compatibility contract:

- `\0oxigraph.outbox.record.v1\0` plus big-endian u64 position is the ordered
  default-column-family key. Positions start at 1 and include headers.
- Header body: version 1, kind 0, then the complete 153-byte v2 receipt.
  Event body: version 1, kind 1, header position, event index, event count
  (each u64 big-endian), commit ID (32 bytes), then one logical v1 effect.
  Both append SHA-256 of `oxigraph.outbox.record.v1\0`, store identity,
  position, and body. Event encoding and receipt hashing share one emitter;
  the pre-existing v1 effect checksum is unchanged.
- V2 receipt: the former 113-byte fields with version 2, followed by header
  position (8 bytes), then envelope SHA-256 using `oxigraph.receipt.v2\0`.
  Commit ID uses `oxigraph.commit-id.v2\0` and the v1 identity fields plus
  header position. End position is header plus effect count, checked for overflow.
- The existing governance key accepts a 73-byte v2 value: version 2, store
  identity, receipt sequence, outbox high-water, coverage-origin receipt sequence,
  then SHA-256 over `oxigraph.governance.v2\0` and the preceding 41 bytes.
- Cursor bytes: version 1, store identity (16), position (8), checksum (32)
  over `oxigraph.outbox.cursor.v1\0` and the preceding 25 bytes. These 57 bytes
  detect damage, not forgery. Foreign-store and ahead-of-snapshot cursors return
  distinct typed errors; backups preserve lineage and their own snapshot watermark.

Opening an older database does not migrate it. The first successful governed
v2 commit records the preceding v1 receipt sequence as its explicit origin;
earlier receipts remain queryable but cannot be backfilled into a feed. Old
v1 receipt/state bytes are unchanged. An older receipt-only binary rejects the
v2 governance record on governed writes rather than silently extending v1
history behind the feed. This is not a reversible global schema migration,
and it does not change `oxversion`, column families, legacy-write coverage,
or ADR-0028's future migration requirements.

Decoding validates versions, checksums, RDF identities, record keys, the
cursor's own record, header/event identity and count, contiguous page boundaries,
coverage, and the latest receipt/high-water. A page uses O(page size) bounded
seeks/reads, not a scan from origin. Appending checks origin/latest integrity
before allocating. This is bounded local integrity validation, not a full
historical audit: unvisited historical corruption is detected when that range
is read. RDF 1.2 effects permit at most 32 nested triple terms; unrepresentable
effects reject before commit. The general RDF API and infallible v1 checksum
do not acquire this depth limit.

G2.3b alone has no retention deletion. G2.3c supplies the explicit policy below;
stores that do not opt in retain the previous growing-history behavior.
In-process listeners, RDF Patch, HTTP feeds, governed bulk-load modes, and
arbitrary crash-window/power-loss qualification are not claimed.

### G2.3c retention and governance health (2026-09-07)

`Store::configure_outbox_retention(policy, now)` explicitly activates governance
v3. It changes neither the global RocksDB format nor column families and does
not migrate on open. V1/v2 state and receipt bytes remain readable and retain
their previous encoding until activation. Older governance decoders reject v3;
do not downgrade a retention-enabled store to an older governed writer. Legacy
ungoverned writes remain explicitly outside this feed. On RocksDB, activation
without a lineage but with existing governed keys returns `LineageUnavailable`
instead of scanning unbounded history or inventing identity. A known-good
pre-lineage store can establish identity through an explicit acknowledged
governed commit; missing or damaged committed history is not automatically repaired.

The policy caps physical outbox **records**, not bytes, and at most 128 consumer
leases. A commit that would exceed capacity rejects before `CommitAttempted`;
no primary mutations or feed records publish. Its reserved key retains the
existing non-commit outcome and is not reusable. Even zero-effect commits cost
one header. Lowering capacity below existing occupancy is allowed and applies
backpressure until explicit cleanup makes room.

`acquire_outbox_lease`, `checkpoint_outbox_lease`, and `release_outbox_lease`
use store-bound identifiers and fresh fencing nonces. Persist the returned
48-byte token to resume after restart. Checkpoints only advance and deadlines
must exceed the supplied `GovernanceTime`. Maintenance uses an explicit trusted
UTC millisecond observation, persists successful observations, and rejects clock
regression. Reads never expire leases or persist time. Expired/replaced owners
cannot renew or release a newer owner's lease. Tokens are fencing handles, not
authentication credentials; the host owns clock trust and authorization.

`maintain_outbox(through, max_records, now)` shares the primary writer permit.
It expires at most one **whole commit**, only if every live lease has consumed
through that commit. A mid-commit checkpoint pins the entire commit. The logical
retention floor and a fixed-size receipt anchor advance atomically with the
receipt's permanent committed-expired marker. Physical deletion has a separate
cursor and removes at most `max_records` records per call. It finishes the prior
commit's cleanup before expiring another. Pending physical records continue to
count against capacity; logical expiry alone does not release that capacity.

The invariant is `physical_gc <= retention_floor <= high_water`. Replay from
`None` starts immediately after the floor. A cursor below the floor returns
`OutboxReadError::CursorExpired`; the floor itself remains a valid checkpoint
even when all its records are gone. `OutboxBatch::retained_after` exposes the
boundary. Strict record/successor validation rejects malformed interstitial
RocksDB keys before advancing cleanup. No scan-and-skip from the original feed
origin is introduced.

`CommitReceiptOutcome::Expired` means **known committed with expired receipt**,
not absence or indeterminacy. Its 58-byte native outcome envelope binds key,
store, sequence, version, and checksum. The legacy outcome API still returns
Committed and both keyed openers reject reuse. Outbox-era full receipts expire
with their whole commit. Pre-outbox v1 receipts and rollback/indeterminate key
records retain their existing permanent policy. This bounds retained outbox
payload/record history, **not total transaction-key cardinality or disk bytes**.

RocksDB maintenance uses one synchronous batch for the anchor/floor, compact
outcome, bounded deletions, leases, and clock. Memory performs the same transition
under its governance/write locks and remains process-local. An acknowledgement
failure returns `MaintenanceIndeterminate`: inspect health and receipt lookup
before continuing; never replay primary effects. For a lost lease-acquisition
response, retry cannot steal the live identifier; wait for its declared deadline
if the returned token was not obtained.

`governance_health(now, max_records)` checks one snapshot's recognized schema,
floor/anchor, physical cleanup head, capped lease metadata, retained prefix, and
latest complete commit. It exposes policy, logical/physical counts, live/expired
lease counts, oldest live checkpoint, and the validated-through cursor. It is
O(max_records + capped leases), not a full historical audit or service-readiness
certificate. Unvisited middle-history corruption is detected on consumption.
G2.5 owns operational readiness. Backups preserve identity, leases, floor, anchor,
and pending cleanup at their snapshot; physical compaction does not advance
logical retention. G2.6/G2.7 still own backup receipts and restore qualification.

The [native retention example](../../lib/oxigraph/examples/outbox_retention.rs)
demonstrates lease pinning, release, bounded cleanup, and unchanged primary RDF:

```sh
cargo run --locked -p oxigraph --example outbox_retention
```

Native tests in [outbox_retention.rs](../../lib/oxigraph/tests/outbox_retention.rs),
[retention.rs](../../lib/oxigraph/src/store/retention.rs), and storage tests cover
expiry, partial checkpoints, nonce fencing, clock regression, capacity rejection,
one-record cleanup, duplicate-key denial, concurrent primary writers, read-only
open, restart, backup, compaction, abrupt process exit with pending cleanup,
and synchronous batch pre-write/lost-acknowledgement failures. A four-case
corruption regression proves malformed keys, missing/damaged pending records,
and damaged expired receipts reject before governance-state mutation. V3's
maximum 6,408-byte state fixture checks every byte flip and truncation; v1/v2
compatibility fixtures remain unchanged. These prove the named native seams,
not arbitrary crash windows or power-loss qualification.

Final affected native matrix (2026-09-07; configurations overlap):

| Configuration | Unit checks | Integration checks | Total |
| --- | ---: | ---: | ---: |
| Default (RocksDB) | 67 | 73 | 140 |
| RocksDB + `rdf-12,http-client` | 67 | 76 | 143 |
| No default features + `rdf-12` | 24 | 47 | 71 |

Commands use `cargo test --quiet --locked -p oxigraph --jobs 4 --lib` with
`--test outbox_retention --test transaction_outbox --test commit_receipts
--test semantic_changes --test transactional_namespaces --test transaction_outcomes`.
The RocksDB configurations also select `--test rocksdb_writer_serialization`;
the latter two add their feature flags exactly as shown in the table. The
retention integration file has ten default-feature entries, including the
abrupt-exit child entry point, and three no-default entries. Strict focused
Clippy runs on default and no-default builds; no lint policy is relaxed.

## Acceptance boundary

### G2.3b native outbox validation (2026-09-07)

`transaction_outbox` covers single-record pagination, checkpoint corruption,
foreign lineage/ahead-of-backup errors, repeat replay and event deduplication,
zero-effect headers, rollback/drop, legacy exclusions, concurrent publication,
RocksDB reopen/read-only/backup, and abrupt process exit before and after commit.
The RDF 1.2 mode adds directional/triple payload round-trip and precommit depth
rejection. Unit tests cover every logical operation, malformed payloads,
record/checksum/key/gap errors, cursor-anchor damage, invalid commit topology,
high-water overflow, and a fixed literal v1 RocksDB activation fixture.
All eight existing storage-call fault probes now also assert outbox publication
or absence. These probes and the two process-exit windows are not power-loss
or arbitrary-window crash qualification.

The runnable local artifact is the
[transaction outbox example](../../lib/oxigraph/examples/transaction_outbox.rs),
built with the existing locked dependencies. The exact native commands/results
and source commit are recorded in repository programme memory alongside the
six-hour review; no optional harness receipt is a product gate.

The affected default-feature matrix passes 170 tests (63 units and 107
integration tests). The no-default `rdf-12` library/outbox/receipt/capture/
namespace lane passes 62; default `rdf-12,http-client` library/outbox/receipt/
capture passes 103. These configurations overlap and are not summed as unique
tests. Strict library/receipt/outbox/example Clippy passes both default and
no-default modes; an obsolete no-default `unnecessary_wraps` expectation was
removed because memory outcome lookup is now fallible. No lint policy was
weakened. The child-exit test locally permits exactly its deliberate process
exit. Formatting and 239 local documentation file targets pass.

### G2.3a native receipt validation (2026-09-07)

The focused default-feature matrix passes 136 tests: 56 library units and
80 integration tests across receipts, semantic capture, namespaces, the minimal
write interface, keyed outcomes, the three-backend transaction state model,
negotiated/cancelled updates, writer serialization, bulk publication, and
read-only open. Without default features, the library, receipt, semantic-change,
and namespace lanes pass 50 tests.

The receipt integration suite also passes 8 tests with default RocksDB plus
`rdf-12,http-client`, and 6 with `--no-default-features --features rdf-12`.
Directional literals and triple terms are distinguished, while the independent
RDF 1.1 checksum fixture stays byte-identical across these feature modes.
The public governed-opener doctest, strict default-feature library/receipt-test
Clippy, workspace formatting, local documentation targets, and diff checks pass.
The vendored C++ compiler emits an existing unused-parameter warning; no Rust
lint policy, test expectation, or frozen evaluator is relaxed for this slice.

New coverage proves receipt/key/effect binding, process-local memory semantics,
four-writer unique sequencing, no-op commits, rollback/drop, all three public
commit entry points after capture failure, RocksDB reopen/read-only/backup,
all eight existing outcome fault points, malformed metadata, missing or
exhausted high-water state, and derived commit-identity validation. The
independent logical SHA-256 fixture does not use the receipt implementation to
compute its expected bytes. These are direct product and simulated storage-call
tests, not process-kill, power-loss, fsync, outbox, or qualification evidence.

The new poisoning fixture initially failed during open because open correctly
rejects corrupt namespaces. Its injection now happens after a valid open, and
the unchanged expected outcome additionally checks that staged RDF is discarded.
No existing frozen fixture, expected result, or validation threshold changed.

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
The original `transactional.rs` hash below remains unchanged. Request-level
SPARQL capture and negotiated/keyed ownership are implemented below. The
separate G2.3a API above now provides receipt identity and recovery lookup;
G2.3b adds the ordered outbox/cursors; retention and health remain G2.3c.

Validation for this slice: `semantic_changes` passes 11/11 with default
features and 10/10 without default features; the six existing transactional
dataset/namespace, topology, outcome, state-model, and update-atomicity suites
pass 37/37. The public wrapper doctest, strict library/new-test Clippy, and
format/diff checks pass. The default feature matrix includes RocksDB; this
does not claim that pending changes are durably stored with a commit.

### G2.2 owned-request and keyed integration (2026-09-07)

`BoundTransactionalSparqlUpdate` and `BoundNegotiatedSparqlUpdate` expose
`execute_with_changes()`. `PreparedSparqlUpdate::on_dataset_with_key` creates
a `BoundKeyedSparqlUpdate` with the same method. All three open exactly one
transaction for the whole request and return `SemanticChangeSet` only after
acknowledged commit. They reuse the existing evaluator; negotiated/keyed bindings
also reuse controlled admission. Generic admission is checked before and after
the backend opener but cannot interrupt an arbitrary blocking implementation;
the legacy `execute()` and caller-borrowed `on_transaction` paths are unchanged.

Cancellation is checked before opening and after capture immediately before
commit. Evaluation/capture failures explicitly roll back. If rollback also
fails, the existing combined error retains both diagnostics; its source chain
exposes the evaluation cause, not two independent error branches. Commit
failure returns no change set and never triggers rollback or replay.

The tracker forwards `OutcomeAwareWritableDataset` without losing rejection,
conflict, cancellation, or an indeterminate key/backend cause. Keyed update
errors expose `TransactionCommitError<ChangeTrackingError<D::Error>>` in the
source chain. Poisoned capture rejects commit without invoking the backend;
explicit typed rollback remains available. Built-in storage errors from
evaluation and ordinary commit retain `UpdateEvaluationError::Storage` mapping.

The public semantic-change suite passes 24 tests with `http-client,rdf-12`
and default RocksDB, and 21 without default features. The affected existing
egress, negotiated admission, cancellation, version, transaction-outcome,
generic-write, and update-atomicity suites pass 38 tests. Coverage includes
read-your-writes, lifecycle ordering, whole-request rollback, all keyed commit
variants, lost responses, poisoned rollback, unmet admission requirements,
pre-open and post-staging cancellation, and RocksDB outcome lookup after reopen.
Existing `LOAD SILENT` policy semantics are preserved.

The storage-error mapping unit test and public capture doctest pass, as do
strict default-feature library/capture-test Clippy and workspace formatting.
HTTP-enabled strict Clippy separately reports five pre-existing warnings in
`http.rs`, `io/loader.rs`, and the update preflight helper; no lint policy or
frozen evaluator is relaxed to close this product slice.

This closes G2.2's native capture/integration task, not this ADR. Effects are
in-process results without durable identity or global commit order. The separate
G2.3a-b governed API now provides atomic receipts and the authoritative outbox;
G2.3c now adds the retention and governance-health contract above.

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
from `store.rs`, plus owned-update integration in `sparql/update.rs`.
G2.3a adds `store/receipt.rs`, storage dispatch and both native backends,
plus `tests/commit_receipts.rs` and direct storage-fault/corruption tests.
It reuses the already-locked workspace `sha2` package; no new package version,
Node dependency, or harness is introduced. G2.3b adds `store/outbox.rs`, the
shared logical `store/change_codec.rs`, bounded native reads, integration tests,
and a runnable example. G2.3c adds `store/retention.rs`, native maintenance,
health, integration/failure tests, and the retention example. This completes
the native G2.1–G2.3c scope; HTTP/listener/RDF Patch adapters and operational
qualification remain separate programme work, not implied by this status.
Under ADR-0043, optional containment is not a prerequisite
for these direct product slices.
