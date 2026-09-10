# ADR-0028: Safe storage schema upgrades

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-10
- Deciders: Oxigraph parity programme
- Implementation status: native offline physical-metadata inspection API/CLI,
  unknown/newer-layout preflight, version-0/1 physical-backup API/CLI and inactive
  shadow-copy preparation and explicit inactive transformation APIs implemented;
  ordinary writable open still
  performs known version-0/1 migrations in place. Full compatibility rejection,
  schema envelopes and shadow upgrades remain open
- Programme task: `task-1787670632284-k0cti5` (G4.3)
- **Depends on**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- **Related**:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md)

## Context

RocksDB storage records an `oxversion` integer, recognizes storage
version 2, and calls migration from ordinary setup. The legacy version-0 and
version-1 paths mutate column families and then advance the version. Read-only
open rejects a required migration, but read-write open had no separate
inspection or preflight at programme entry, and still has no upgrade-bound
backup receipt, resumable journal, failure-injection contract, or
operator-controlled cutover. Before the native preflight below, a missing
version key was stamped as latest rather than classified independently.

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

Inspection itself changes no persisted bytes and does not call ordinary open.
Callers must stop writers and keep the directory unchanged, as for ordinary
read-only open. It is not a concurrent inspection lease, a legacy classifier,
full logical validation, feature-envelope check, interrupted-upgrade detector,
backup receipt, or safe-upgrade implementation. Full compatibility rejection,
including known legacy versions, remains outstanding; the bounded native
preflight below does not replace the decision's upgrade contract.

Native constructed fixtures cover absent, empty, malformed, version-0,
version-1, current and maximum-u64 markers; missing/extra column families;
nonexistent/empty paths; and a nonwritable offline directory. Repeated inspection
compares every source file's bytes before and after. A separate CLI process
checks metadata-only JSON and source preservation, followed by read-only reopen
of quads, an empty named graph and a namespace. These tests establish this
inspection slice, not the frozen legacy-classifier or upgrade-promotion matrix.
The system RocksDB lane remains unverified on this host (`rocksdb.pc` is absent).

## Native unknown/newer open preflight (2026-09-10)

Ordinary opens now return typed `StorageError::SchemaUnknown` for missing or
malformed markers and unrecognized column-family inventories, or
`StorageError::SchemaTooNew { found, supported }` for newer markers. Current
stores are not repaired by silently creating a missing family. Fresh stores
remain creatable; the known version-0 missing-`graphs` transition and version-1
migration are retained until an explicit shadow path can replace them without
discarding their existing logical compatibility assertions.

Writable open acquires RocksDB's native exclusive `LOCK` before inspection and
hands the same held lock to database open. It is retained through the last
database handle and released on failed preflight/open. The C++ `EnvWrapper`
uses RocksDB's public object registry and synchronous option parser; it does
not add a private `rocksdb_env_t`/options layout mirror or modify vendored code.
Read-only open retains its offline/no-concurrent-writer contract and creates no
lock. `inspect` remains unchanged and non-mutating.

For rejected stores with an existing regular `LOCK`, source inventories,
lengths and SHA-256 values remain unchanged. **A checkpoint without `LOCK`
gains an empty native lock before inspection, retained even after refusal.**
Deleting it on refusal could let concurrent openers lock different inodes.
Nonempty directories without a regular `CURRENT` or `LOCK`, and symlink lock
files, are refused without initialization. Directory replacement by an external actor is not covered;
upgrade source/destination containment leases remain a separate gate.

Native tests cover marker and inventory refusals, fresh write/rollback/restart,
checkpoint reopen, failure cleanup, explicit descriptor options under a low
process limit, and independent-process writer exclusion during preflight and
after handle cloning. Existing backup/restore and legacy
logical-result tests are retained. These are product regressions, not the
frozen legacy classifier, full source-preserving upgrade matrix, RDF-feature
envelope, system-RocksDB qualification or upgrade-promotion gate. This ADR
remains Proposed; no persisted version or frozen expectation changes.

## Native legacy physical-backup slice (2026-09-10)

`Store::backup_legacy` copies an offline version-0/1 store into a fresh package
without calling ordinary open, setup or migration. `LegacyBackupReceipt::verify`
checks the complete package; `verify_ancestry` additionally checks every source
file against the receipt, not just an equal database identity or sequence.
The receipt binds physical version, native database identity, sequence, column
families, file names, lengths and SHA-256 hashes. Its separate format does not
weaken ADR-0022's current-schema `BackupReceipt` or claim logical compatibility.

The source needs an existing regular native `LOCK`; no missing source lock is
created. The held native lease spans observation, copying and revalidation.
Callers must stop writers and keep source/destination paths exclusively controlled.
Only bounded, regular, flat native files are admitted; paths must be disjoint.
The complete marker is written last after file/directory synchronization. An
earlier failure leaves an unverifiable package; a failure after the marker is
`CompletionIndeterminate`, resolvable by independent verification. Unix directory
synchronization is required. Keep completed packages immutable.

The ordinary delivery workflow `9c05a6f6-e51a-43bf-b281-83a69aff137c` used a real
Terra Medium implementation worker, root-only application and independent Sol
Medium acceptance. Native checks passed: legacy integration (4), internal
failure/cancellation/lease tests (4), current backup/restore (18), RDF-1.2
legacy/current backup/restore (22), and no-default-features store tests (12).
Feature-lane overlaps are not additional product behavior. Test fixtures were
copied to temporary directories; their committed bytes were not changed.

The additive `backup-legacy` and `verify-legacy-backup [--source ORIGINAL]` CLI
commands expose these same APIs without ordinary open/migration. Output binds
the fingerprint and distinguishes package-only from exact ancestry verification;
every success states `upgrade_authorized=false`. Current `verify-backup` and
`restore` do not accept the separate legacy package format.

CLI workflow `31aa0787-064d-4522-a8ff-4ac18467a336` passed three new subprocess
journeys (both legacy layouts, source/package preservation, changed ancestry,
corruption, format separation and help), five existing backup/restore/inspection
tests, and the combined eight-test no-default-features lane. Terra Medium
proposed the implementation, root applied it, Sol Medium independently accepted
the exact files/results, and Ruflo MCP read back the workflow evidence.

This closes the bounded legacy physical-copy and exact-ancestry API/CLI gap, not
G4.3. It is not the frozen legacy classifier, feature envelope, resumable shadow
upgrade, cutover/crash matrix, logical comparison, system-RocksDB qualification
or upgrade authorization. Those gates and the known in-place migrations remain.

## Native inactive shadow preparation (2026-09-10)

`Store::prepare_upgrade(source, completed_legacy_backup, fresh_destination,
&LegacyBackupOptions)` now prepares a separate inactive workspace. Exact source
ancestry is verified first; source and backup native leases remain held through
copying, revalidation and completion. Neither input is migrated or changed.
`PreparedUpgrade::verify` independently checks the embedded legacy receipt,
bounded exact inventory, native metadata, journal and guard while leasing the
copy. Existing current/legacy backup validators are not relaxed.

The single checksummed `Preflight` journal names target version 2. Its entry and
the inside-store `.oxigraph-upgrade-incomplete` guard are synchronized, including
their directories and parent, before any native file is copied. The complete-last
preparation record binds the original receipt plus journal and guard hashes.
Earlier failures leave an unverifiable workspace; post-marker errors are
`CompletionIndeterminate`. This is a preparation record, not an `UpgradeReceipt`,
append/resume implementation or proof that transformation finished.

Ordinary writable and read-only opens by this binary return typed
`UpgradeIncomplete` for any present guard, including malformed guards and guarded
current-version stores. Moving the nested store retains that refusal. The brief
window before guard creation can leave an empty directory, but no copied native
files. Older binaries unaware of the guard are **not** covered.

Delivery workflow `f7eadfc1-35d1-4362-a2a3-a3ca91db12e4` used native Terra Medium
integration of root-assisted implementation/tests, root-only application, and
independent Sol Medium review. After a formatting repair, four native lanes
passed: preparation integration (4), phase/cancellation/lease tests (4), RDF-1.2
preparation plus legacy/current backup/restore (26), and no-default store (12).
Rechecks and overlapping feature lanes are not additional product behavior.
Fixtures were copied to temporary directories. Exact workflow evidence was read
back through Ruflo MCP before handoff.

This closes inactive physical preparation only. Explicit transformation, logical
and topology comparison, verified resume, sealed upgrade receipts, activation,
old/new-binary and crash qualification remain open. Known in-place migrations
remain until their explicit replacement is ready; this ADR remains Proposed.

## Native inactive transformation (2026-09-10)

`Store::transform_prepared_upgrade(source, completed_legacy_backup, prepared,
&UpgradeTransformOptions)` now applies the declared version-0 -> 1 -> 2 edges
only to a verified prepared copy. Source, backup and copy retain their native
leases continuously. The C++ lease adapter now returns database adoption without
physically unlocking until the final lease owner drops, including after DB
close and throughout final output hashing. The migration also removes old
RDF-star keys using their original recursive encoding and removes its exact
owned SST staging file after successful ingestion.

An independent read-only projection derives expected quads, named-graph
inventory (including version-1 empty graphs) and namespace mappings from the
legacy input. Nested/repeated RDF-star terms become graph-local reification.
Output index validation and canonical logical fingerprints must agree with that
projection. Primary, secondary and graph keys receive iterative raw-key depth
and byte checks before recursive decoding. The limit is 128 nested triple nodes;
default retained projection limits are one million entries and 256 MiB per
projection. These are cooperative bounds, not RSS, native-memory or disk quotas.
Cancellation/deadline accounting spans the whole operation.

Checksummed append-only edge frames are synchronized before native mutation.
The separate complete-last `TransformedUpgrade` observation binds the original
legacy receipt, RDF-1.2 feature bit, logical counts/fingerprint, journal and exact
recognized native output files plus the guard. Native file counts exclude the
guard; byte limits and output hashes include it. Verification rechecks unchanged
source/backup ancestry and independently reads the current-format output.
Hashes establish content identity, not authorship or upgrade authorization.

The ordinary delivery workflow `5c9cc78e-d7ef-4857-a194-4c648e90e06f` used
native Terra Medium proposals with root-assisted implementation, root-only
application, deterministic checks, and independent Sol Medium review. Actual
test and review failures fed repair; earlier failed evidence was retained.
The final native lanes passed: default upgrade (16), RDF-1.2 upgrade (17),
preparation/legacy/current backup/restore (26), safe-open (18 reported outcomes,
including helper-process probes), no-default store (12), and RDF-1.2 store (29).
Overlapping lanes/rechecks are not additional product behavior. Tests cover
input preservation, lease re-adoption/release, nested/repeated triples across
graphs, empty graphs/namespaces, over-depth primary and secondary keys,
sidecars/file bounds, cancellation/deadline/fault boundaries, tampering and
guard refusal. Exact workflow evidence is in Ruflo
`programme-task-evidence/workflow-5c9cc78e-d7ef-4857-a194-4c648e90e06f`.

This closes the bounded inactive transformation API slice only. Missing
`rdf-12` support for legacy triple terms is refused before writable work, but
currently as a storage/corruption error, not a frozen feature classifier.
Unsupported legacy default-column metadata is refused rather than synthesized.
Interrupted work requires fresh preparation; post-completion errors remain
indeterminate and require verification. Resume, a sealed exact-build
`UpgradeReceipt`, activation/cutover, older-binary/crash qualification and a
transformation CLI remain open. Ordinary known in-place migration is retained;
this ADR remains Proposed and full G4.3 is not complete.

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
