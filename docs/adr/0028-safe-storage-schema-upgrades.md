# ADR-0028: Safe storage schema upgrades

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-10
- Deciders: Oxigraph parity programme
- Implementation status: native offline physical-metadata inspection API/CLI
  implemented; ordinary open still performs legacy migrations in place.
  Compatible-open rejection, schema envelopes and shadow upgrades remain open
- Programme task: `task-1787670632284-k0cti5` (G4.3)
- **Depends on**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- **Related**:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md)

## Context

RocksDB storage currently records an `oxversion` integer, recognizes storage
version 2, and calls migration from ordinary setup. The legacy version-0 and
version-1 paths mutate column families and then advance the version. Read-only
open rejects a required migration, but read-write open has no separate
inspection, preflight, backup receipt, resumable journal, failure-injection
contract, or operator-controlled cutover. A missing version key is stamped as
the latest version rather than being classified from independently validated
metadata.

That behavior was sufficient for bounded historical transitions, but it is
not a safe programme for future primary state, namespaces, receipts, outbox
records, and derived-state cursors.

## Decision

Separate storage inspection, upgrade construction, validation, and activation.
Ordinary `Store::open` and `Store::open_read_only` never start a data-changing
schema migration. They either open the exact compatible schema or return a
typed `UpgradeRequired`, `SchemaTooNew`, `SchemaUnknown`, or
`FeatureIncompatible` error.

Add the following additive disk-store surfaces (names may be refined without
weakening their behavior):

- `Store::inspect(path) -> StoreFormatInfo` performs read-only format,
  feature, column-family, store-identity, and interrupted-upgrade inspection;
- `Store::upgrade(source, destination, UpgradeOptions) -> UpgradeReceipt`
  builds a distinct destination and never treats it as active; and
- `Store::verify_upgrade(source, destination, receipt)` independently checks
  the sealed output before an operator performs cutover.

The schema marker becomes a checksummed, versioned envelope containing at
least store UUID, logical schema version, encoding/RDF feature profile,
required column-family inventory, and metadata/outbox/index schema versions.
A missing or malformed marker on a non-empty store is unknown legacy state and
fails closed. It may be recognized only by a hash-pinned, read-only legacy
classifier with its own evaluator; it is never stamped current merely because
RocksDB opened it.

### Upgrade transaction

The first supported profile is offline shadow-copy upgrade:

1. acquire exclusive source/destination leases and inspect both paths without
   following symlinks or accepting overlap;
2. verify an ADR-0022 completed backup receipt, source version/features,
   available space, migration chain, and exact tool build;
3. create a new destination, write an append-only checksummed upgrade journal,
   and transform one declared schema edge at a time;
4. rebuild rather than translate ADR-0024 derived indexes where possible;
5. validate storage invariants and compare logical quads, empty named graphs,
   namespaces, commit/outbox positions, and required receipts with the source;
6. fsync the data, manifest, journal, and parent directory and write a final
   sealed receipt; and
7. leave activation to an explicit operator cutover that preserves the source
   and receipt until rollback policy expires.

The journal states `Preflight`, `Transforming(step)`, `Validating`, `Sealed`,
or `Failed`. A restart may resume only after verifying every completed step's
input/output digests; otherwise it restarts into a fresh destination. Failure,
cancellation, process kill, or disk exhaustion never changes the source or
causes an unsealed destination to pass readiness. Migrations are forward-only,
deterministic, bounded per batch, and one logical version edge at a time.

Metadata-only in-place migration, online/rolling upgrade, automatic directory
swap, downgrade, and cross-node mixed-version operation are outside the first
profile. Any later in-place step needs a separate proof of atomicity and
recoverability. RocksDB's ability to open its files is not proof that
Oxigraph's logical schema is compatible.

### Security and compatibility

All paths are canonicalized under operator-selected roots; source,
destination, backup, and temporary paths must be disjoint. Manifests accept
only regular files with bounded counts/sizes and reject traversal, symlinks,
unexpected files, checksum drift, and store-UUID mismatch. Diagnostics do not
include RDF terms or file contents by default.

Current-schema `Store::open` remains source compatible. Opening an old schema
changes from implicit mutation to a typed instruction to run the upgrade API or
CLI, which is an intentional safety break with a migration note. Applications
that need only logical portability continue to use a dataset dump/load; that
path must preserve ADR-0014 topology through a capable format or explicit
manifest.

## Native metadata inspection slice (2026-09-10)

`Store::inspect(path)` and `oxigraph inspect --location <path>` now inspect an
existing offline RocksDB store without calling ordinary setup, migration, or
namespace decoding. The native read-only handle opens only the default column
family, while a separate RocksDB manifest listing observes the actual inventory.
Both current and incomplete/extended inventories are inspectable. Neither a
missing path nor a missing marker is created or stamped.

`StoreFormatInfo` reports the marker's optional byte length and parsed big-endian
value, its `Missing`/`Malformed`/`Older`/`Current`/`Newer` relation to this binary's
current version, sorted column-family names, and missing/unexpected names.
`Current` describes **only the marker**. CLI JSON uses the explicit
`oxigraph.store-inspection.v1` format and reports logical validity and upgrade
state as `not-checked`, RDF-feature compatibility as `unknown`. A successful
inspection is not permission to open, upgrade, cut over, or publish a store.

This additive slice changes no persisted bytes or existing open behavior.
Callers must stop writers and keep the directory unchanged, as for ordinary
read-only open. It is not a concurrent inspection lease, a legacy classifier,
full logical validation, feature-envelope check, interrupted-upgrade detector,
backup receipt, or safe-upgrade implementation. The typed rejection behavior
in the decision above is still outstanding; do not use ordinary writable open
to probe an unknown store.

Native constructed fixtures cover absent, empty, malformed, version-0,
version-1, current and maximum-u64 markers; missing/extra column families;
nonexistent/empty paths; and a nonwritable offline directory. Repeated inspection
compares every source file's bytes before and after. A separate CLI process
checks metadata-only JSON and source preservation, followed by read-only reopen
of quads, an empty named graph and a namespace. These tests establish this
inspection slice, not the frozen legacy-classifier or upgrade-promotion matrix.
The system RocksDB lane remains unverified on this host (`rocksdb.pc` is absent).

## Staged implementation and evaluator gates

1. **Inventory and inspect:** hash-pin version-0, version-1, current, missing,
   corrupt, too-new, RDF-feature-mismatch, and interrupted fixtures. Prove
   inspect/open/read-only calls never change any source byte.
2. **Shadow transformation:** for every supported edge, compare complete
   logical state and topology, inject failure/cancellation at every journal and
   fsync boundary, and prove the source is unchanged and an unsealed output is
   rejected.
3. **Receipt and recovery:** independently verify hashes, store identity,
   schema/features, backup ancestry, outbox/index cursors, resume/restart, and
   fresh-process open/validate. Tampering, path substitution, and insufficient
   disk fail closed.
4. **Operational gate:** perform backup, upgrade, explicit cutover, rollback to
   the preserved source, and restore drills on frozen size classes. Record
   duration, peak disk/memory, read/write amplification, and supported-version
   windows without inventing a zero-downtime claim.

Promotion requires an evaluator-only commit whose fixtures predate the product
implementation, an independent logical export comparison, default/RDF-1.2 and
system/vendored RocksDB lanes, and exact receipt identities. A new schema
version cannot ship until its predecessor upgrade path and failure matrix pass.

## Consequences

- Ordinary open becomes non-destructive and upgrade outcomes become auditable.
- Shadow copies require temporary disk close to the live-store size and an
  explicit maintenance/cutover procedure.
- Preserving the source makes rollback credible but increases operational
  storage and retention cost.
- Every future durable subsystem must declare its schema and migration edge.

## Alternatives rejected

- **Continue migrating during `Store::open`.** Callers cannot preflight,
  schedule downtime, prove backup, or distinguish open from mutation.
- **Stamp a missing marker as latest.** An old or damaged non-empty layout can
  be silently misclassified.
- **Mutate in place with only a version key.** A crash between data movement
  and version advancement has no independently verifiable recovery state.
- **Require dump/load for every transition.** It remains a fallback, but can
  lose non-RDF metadata and empty-graph topology without a richer manifest.

## Evidence and task ownership

The current version marker and in-place legacy migrations are in
[`rocksdb.rs`](../../lib/oxigraph/src/storage/rocksdb.rs); public open and
backup entry points are in [`store.rs`](../../lib/oxigraph/src/store.rs).
ADR-0022 supplies backup/restore evidence and ADR-0020 supplies future durable
metadata identities. This ADR remains Proposed until G4.3 implements a frozen
legacy-fixture matrix and safe-upgrade receipt.
