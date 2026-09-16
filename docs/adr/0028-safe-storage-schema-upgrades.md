# ADR-0028: Safe storage schema upgrades

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-16
- Deciders: Oxigraph parity programme
- Implementation status: native offline physical-metadata inspection API/CLI,
  unknown/newer-layout preflight, version-0/1 physical-backup API/CLI and inactive
  shadow-copy preparation and explicit inactive transformation APIs/CLI implemented;
  additive verified checkpoint/restart APIs and offline recovery CLI implemented;
  native build-bound inactive upgrade receipt APIs/CLI and explicit fresh-target
  activation API/CLI implemented for the bounded Linux/static Oxigraph/vendored
  RocksDB profile below.
  Ordinary writable/read-only opens now return typed `UpgradeRequired` for
  recognized version-0/1 layouts instead of starting migration.
  Builds without `rdf-12` also return typed `FeatureIncompatible` for recognized
  RDF 1.2-only encodings in current-format live object indexes.
  Bounded outbox consumption distinguishes valid retained RDF 1.2-only effects
  from malformed payloads without adding open-time history admission.
  Explicit offline feature inspection and governed-lineage/upgrade-guard
  observation APIs/CLI are implemented, with the bounded scopes below.
  Existing build-bound outer upgrade workspaces also have a non-mutating
  inspection API/CLI for verified incomplete, pending and sealed states.
  Checksummed schema-envelope decoding and metadata reporting are implemented;
  an explicit inactive marker-only v2-to-v3 shadow construction API/CLI
  slice is implemented, with tested fail-closed rejection of a changed
  executable on resume/verify (no operator-visible build identity on the
  sealed receipt) and an explicit fresh-target activation API/CLI that
  publishes a source-preserving, byte-verified copy without promoting
  version 3 to this binary's current schema, with CLI exposure for all four
  operations (`start-schema-upgrade`, `resume-schema-upgrade`,
  `verify-schema-upgrade`, `activate-schema-upgrade`) and real OS-level
  process-kill crash-matrix coverage for the mid-copy-resume and
  pre/post-guard-unlink-activation points.
  A first operational-gate drill for the legacy version-0/1-to-2 path is
  implemented (`lib/oxigraph/tests/upgrade_operational_drill.rs`):
  backup-legacy/upgrade/explicit-cutover/source-preservation-rollback/
  backup-with-receipt/restore, timed per stage with on-disk bytes summed,
  against the two checked-in legacy fixtures.
  The legacy path's activation and resume steps, and the v2-to-v3 draft's
  activation and resume steps, each have a real OS-level process-kill test
  (four total); every other fault phase on both paths, and the legacy
  path's `start_upgrade` step, remain proven only under synthetic
  in-process fault injection.
  Envelope admission on ordinary open, full crash-matrix breadth beyond
  those four points, additional operational-gate size classes and
  peak-memory/amplification measurement, full compatibility rejection,
  older-binary rollback and the frozen qualification gates remain open
- Programme task: `task-1787670632284-k0cti5` (G4.3)
- Current acceptance projection: [G4.3 delivery gates](../plans/oxigraph-delivery-gates.md#g43--safe-storage-upgrades).
  This ADR owns the contract; both programme plans reference that one current
  checklist. Historical native slices below do not independently close a full gate.
- **Depends on**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- **Related**:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md)

## Context

RocksDB storage records an `oxversion` integer and recognizes storage version 2.
At programme entry, ordinary setup called migration: the legacy version-0 and
version-1 paths mutated column families and then advanced the version. Read-only
open rejected a required migration, but read-write open had no separate
inspection or preflight. The bounded slices below now add legacy-open refusal,
physical backup ancestry, inactive construction, verified checkpoint restart,
build-bound receipts and explicit fresh-target activation. Automated service
cutover is not supplied; older-binary rollback qualification remains outstanding.
Before the native preflight below, a missing
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

This closes inactive physical preparation only. The next section adds explicit
transformation and logical/topology comparison; verified resume, sealed upgrade
receipts, activation and old/new-binary/crash qualification remain open. Known
in-place migrations remain until their replacement is ready; this ADR remains Proposed.

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
`UpgradeReceipt`, activation/cutover and older-binary/crash qualification remain
open. The CLI slice below exposes these APIs without adding those capabilities.
Ordinary known in-place migration is retained; this ADR remains Proposed and
full G4.3 is not complete.

## Offline inactive upgrade CLI (2026-09-10)

Four additive commands expose the existing Rust construction and verification
APIs: `prepare-upgrade`, `verify-upgrade-preparation`, `transform-upgrade`
and `verify-upgrade-transformation`. The operator keeps the original store,
completed legacy backup and separate workspace offline, stable, exclusively
controlled and disjoint; preparation requires a fresh destination. See the
[complete operator journey](../../cli/README.md#offline-inactive-upgrade-construction-fork).

Creation and verification have distinct success fields. Preparation creation
reports exact external ancestry; preparation verification checks only its
embedded receipt and workspace, explicitly reporting external ancestry as
not checked. After transformation, the old preparation observation no longer
matches the current bytes: use the transformation verifier with both original
and backup paths. That verifier checks exact ancestry, output files and logical
state. Output includes the appropriate content fingerprints and counts, with
`active=false` and `upgrade_authorized=false`; hashes do not authorize use.

All four commands accept positive `--max-files`, `--max-bytes` and
`--timeout-ms` overrides. Transformation and its verifier also accept
`--max-entries` and `--max-projection-bytes`. Omission retains API defaults;
these are cooperative limits, not process-memory or native-disk quotas.
Without `rdf-12`, legacy triple-term transformation is refused before changing
the preparation. Validation/refusal errors return no success record.

The ordinary workflow `4cf0ccbc-33f4-4473-b9f0-e30a5bf345a5` uses a native Sol
High implementation proposal, root-only application and independent Sol Medium
review. An earlier Terra attempt returned INCONCLUSIVE and was not applied;
the escalation addressed that concrete incomplete proposal, not quota or an
automatic model preference. Native lanes passed: new default CLI tests (5),
no-default upgrade/backup/restore/inspection (14), and default existing-command
regressions (8). The separate focused option-adapter test passed (1), asserting
typed timeout values without wall-clock timing. These counts overlap across
feature lanes and are not separate product deliveries. Exact workflow evidence
is recorded in Ruflo
`programme-task-evidence/workflow-4cf0ccbc-33f4-4473-b9f0-e30a5bf345a5`.

This closes the bounded offline CLI journey only. No library, dependency or
storage-format changes were made in this slice. The workspace remains guarded
and cannot be served through ordinary open. This CLI slice does not expose
the recovery APIs below. A sealed exact-build `UpgradeReceipt`,
activation/cutover/rollback and the frozen compatibility/crash matrix remain
open. This ADR remains Proposed; full G4.3 is not complete.

## Verified restartable inactive upgrades (2026-09-11)

`Store::start_upgrade_recovery(source, completed_legacy_backup, fresh_destination,
&UpgradeRecoveryOptions)` creates a separate recovery workspace with a verified
initial checkpoint. `Store::resume_upgrade_recovery` completes only the remaining
version-0 -> 1 -> 2 edges and final output. `UpgradeRecovery::verify` independently
checks the record chain, exact external ancestry, every completed checkpoint
and, when present, the standard `TransformedUpgrade` output. `completed()` means
that output was published, not activation or an authorized `UpgradeReceipt`.

Each attempt has its own guarded store under `attempts/`. Before an edge runs,
its verified input is copied to a fresh attempt. A completed record binds the
prior record hash, legacy-receipt fingerprint, schema edge, feature/limit profile,
logical fingerprint/counts and exact output file hashes. Native data files and
the containing directories are synchronized before the completion record;
potentially published failures return `CompletionIndeterminate` and require
verification. Source, backup and completed checkpoints retain their native
leases and unchanged bytes. Caller-controlled paths must remain offline,
stable, disjoint and exclusively controlled.

Interrupted, unpublished attempts are retained but never reused as input.
Only the bounded partial-attempt scanner admits the migration's exact
`bulk-<decimal u128>.sst` staging names; completed inventories remain strict.
Changed checkpoints, torn/reordered journals, mismatched profiles and unexpected
paths/files are refused, not repaired or rebaselined. If verification cannot
establish a completed checkpoint, use a fresh destination. Published edges are
not rerun; resuming an already completed workspace independently verifies it
without another native migration. All nested stores remain guarded and refused
by this binary's ordinary writable/read-only opens.

`UpgradeRecoveryOptions` wraps the existing transformation limits and adds
`max_attempts` (default 16, maximum 64). It includes the initial checkpoint,
failed attempts, successful edges and final output; an uninterrupted version-0
journey needs four attempts and version-1 needs three. The RDF feature bit and
content/attempt limits must match on resume. A new cancellation/deadline control
may be supplied; accounting covers the whole call, including completed-output
verification. Limits are cooperative and per copy/projection, not global disk,
RSS or native-memory quotas. Retained copies require additional operator-managed
disk space; this API does not delete failed attempts.

The ordinary workflow `f91835b2-1918-48f4-b769-eb545b45eda2` used native Sol
High implementation and Astra High independent review, root-only application,
actual failure/review feedback and exact Ruflo MCP readback. Final focused
lanes passed: default recovery integration (3), recovery unit cases (4),
RDF-1.2 recovery/transformation integration (7), existing preparation/backup/
restore (26), and no-default store (12). Additional upgrade units passed in
both default (16) and RDF-1.2 (17), including real process exits during native
SST creation and a committed RDF-star transaction, publication boundaries,
cancellation/lease release, completed-edge reuse and independent topology.
Counts overlap and include helper tests; they are not additional product
milestones or the frozen crash/promotion matrix. An extra parallel regression
exposed pre-existing in-place fixture mutation in `tests/store.rs`; its failed
result is retained at `target/engineering-delivery/run-EUXUkM`. Exact fixture
restoration and a serial unchanged-source recovery run (16 tests,
`run-s1kxL7`) passed.

The follow-up workflow `78415cd1-a36e-4acd-8bf1-93381dc69503` now isolates both
compatibility fixtures on private temporary copies. It preserves every logical
assertion, feature/platform guard and two-pass reopen check, and removes the
shared-directory delete/restore helper. Default/RDF-1.2/no-default store lanes
passed (28/29/12); concurrently launched upgrade-unit/store commands also passed
(16/17/28/29), with stable source and both fixture inventories byte-identical to
Git. Command intervals overlapped; simultaneous migration phases and a speedup
were not established. Sol High proposed the one-file correction, Astra High
independently accepted it, and Ruflo read back the exact workflow evidence.
This closes the observed test-isolation defect without changing fixtures,
product semantics or a recovery baseline; the earlier failed run is retained.

This is additive: old `PreparedUpgrade`/`TransformedUpgrade` formats and
validators are unchanged. Their old interrupted workspaces do not become
resumable; start the new recovery workflow before expecting restart support.
Legacy RDF-star terms still require `rdf-12`. No new dependency, persisted
logical schema version, automatic cutover or default-open migration change is
introduced. CLI recovery exposure is covered by the subsequent slice below;
the sealed exact-build receipt,
activation/cutover/rollback, the envelope/classifier and frozen compatibility,
crash and system-RocksDB lanes remain open. This ADR remains Proposed;
the bounded recovery API is not full G4.3 completion.

## Offline recovery CLI (2026-09-11)

`start-upgrade-recovery`, `resume-upgrade-recovery` and
`verify-upgrade-recovery` expose the existing checkpoint/restart APIs without
changing their formats or migration algorithms. Start requires a fresh workspace
and reports an incomplete initial checkpoint. Resume reuses only verified steps;
completed resume verifies without rerunning migration. The independent verifier
accepts either a valid incomplete chain or completed output, reporting the
actual state, attempts, counts and content fingerprints. All outcomes retain
`active=false` and `upgrade_authorized=false`. See the
[operator journey](../../cli/README.md#offline-restartable-upgrade-recovery-fork).

All six positive limit options preserve API defaults when omitted. Content and
attempt limits and the RDF feature profile must match across calls; a new timeout
is allowed. The existing maximum of 100,000 files is unchanged, and the CLI
parser rejects attempt limits outside 1..=64. Validation/refusal errors emit no
success record; uncertain post-completion I/O outcomes require verification.

Ordinary workflow `4c744606-360e-457d-893c-01a95cf6fffc` used a complete native
Sol High proposal, root-only application, deterministic checks and independent
Sol Medium review. Default recovery tests passed (3), no-default recovery and
existing upgrade/backup/restore/inspection tests passed (18), default existing
upgrade/legacy-backup regressions passed (8), and option-adapter units passed (2).
These lanes overlap and are not separate product milestones. They cover both
legacy layouts where supported, fresh-process continuation and verification,
exact source/backup inventories, initial/final guards, matching custom limits,
numeric parser failures and changed-profile/journal/checkpoint refusal.

The initial `run-4d5eFi` failure remains recorded: the newly authored successful
journey incorrectly selected 200,000 files above the existing hard maximum.
The corrected test uses 99,999 and separately verifies refusal of 100,001;
no production bound, pinned fixture or expected logical result was changed.
Exact accepted workflow evidence is in Ruflo
`programme-task-evidence/workflow-4c744606-360e-457d-893c-01a95cf6fffc`.

This closes recovery CLI exposure only. Old interrupted preparation workspaces
are not converted, ordinary known in-place migration is retained, and no new
dependency is introduced. The subsequent slice below supplies the bounded
native build-bound receipt API. Activation/cutover/rollback, envelope/classifier
and frozen compatibility/crash/system-RocksDB lanes remain open.
ADR-0028 remains Proposed; full G4.3 is not complete.

## Build-bound inactive upgrade receipts (2026-09-11)

The additive `Store::start_upgrade`, `Store::resume_upgrade`, `Store::upgrade`
and `Store::verify_upgrade` APIs now construct and independently verify a
sealed `UpgradeReceipt`. Each takes the unchanged source, completed legacy
backup, outer destination and `&UpgradeOptions`. The start call returns a
nested recovery observation; resume and verification still take the original
outer destination, not that observation's `recovery/` directory.

The outer workspace binds the executable before starting unchanged recovery-v1.
Its checksummed `INITIAL -> RUNNING -> COMPLETED` progress chain admits
`RUNNING` only after independently verifying the exact initial journal and
checkpoint under retained native leases. A completed standalone recovery cannot
be imported as this build's earlier work. Resume after `COMPLETED` reuses the
validated evidence without rewriting the recovery journal or checkpoint files.
Existing recovery/preparation/transformation formats and APIs are unchanged.

The first receipt profile is **Linux with statically embedded Oxigraph and
vendored static RocksDB**. A retained `/proc/self/exe` descriptor supplies the
executable SHA-256 and length (maximum 1 GiB); an implementation anchor must
resolve to that same executable. The preflight also binds the declared native
backend/version/revision, RDF feature bit, content/attempt limits, absolute
paths and exact legacy-backup receipt. A different executable cannot resume or
verify this profile. Other platforms, dynamic-library embedding and system
RocksDB are not supported by these new APIs; this does not remove support from
the earlier APIs. Their refusal branches are not cross-platform qualification.

The final receipt transitively binds source/backup ancestry, the recovery
journal, transformed physical inventory, logical fingerprint and counts.
Legacy metadata coverage includes version, required column families, namespaces,
RDF and named graphs; governance, outbox and commit-receipt records are absent
in this admitted profile. Source, backup, checkpoint, output and outer workspace
leases span final verification and complete-last receipt synchronization.
Paths remain an offline, unchanged, caller-exclusive precondition. Unsigned
checksums establish content continuity, not authorship or resistance to an
actor deliberately fabricating all matching records.

Verification is read-only. Tested changed-input and malformed or unexpected
evidence refusals preserve the source, backup and whole existing workspace.
A torn record or pending receipt is retained, not repaired or overwritten;
use a fresh destination when completed evidence cannot be established. A
failure after receipt rename is indeterminate and requires independent
verification. Timeouts/cancellation are cooperative call controls, not a hard
global I/O deadline or total workspace disk/RSS limit.

Ordinary workflow `513cd6e3-0239-4f66-8107-c5d00b4cd9f6` used native Sol
High implementation, root-only application, deterministic checks, actual repair
feedback and independent Astra High acceptance of the final six-file source.
Ruflo read back the exact workflow evidence. Final native checks passed:
default receipt integration (9), upgrade units (17), existing library/CLI
recovery/transformation/legacy-backup compatibility (18), no-default receipts
and recovery (12), and explicit `rdf-12` receipt integration (9).
These overlapping lanes include helpers and platform guards, not distinct
product behaviors or complete compatibility qualification.

The checks cover both admitted legacy layouts, unchanged inputs, initial
checkpoint tampering, copied completed-recovery refusal, exact-executable
fresh-process verification, changed-executable refusal, held publication leases,
COMPLETED reuse and retained pending/post-rename evidence. The RDF-1.2 lane
actually seals the version-1 RDF-star fixture; default features alone do not.
Review caught an initial-state refusal that appended RUNNING too early; it now
verifies the full initial workspace under leases before appending. The
whole-workspace no-write regression passes. Earlier failing attempts remain
recorded, not relabelled as successful runs.

Selected Clippy reports no diagnostic location in the changed upgrade targets;
26 existing library warnings remain and strict warnings-denied CI was not run.
The RDF-1.2 development library builds successfully. The observed local
`target/debug/liboxigraph.rlib` is 109,887,012 bytes, SHA-256
`c1acdfd8130ebbff869052c429c1921d408eabbe34a076276dc80264c6bc803c`.
It requires matching Cargo dependencies; it is not a standalone executable,
published release or runner compiler-artifact receipt.

The output remains guarded, `active=false` and `upgrade_authorized=false`.
This closes only the native build-bound receipt API slice; CLI exposure is
recorded below. Explicit activation/cutover/rollback, complete compatibility
rejection, the envelope/classifier and the frozen compatibility/crash/older-
binary/system-RocksDB lanes remain open. Ordinary known in-place migration is
retained. ADR-0028 remains Proposed; full G4.3 is not complete.

## Build-bound inactive upgrade receipt CLI (2026-09-11)

The additive `start-upgrade`, `resume-upgrade`, `upgrade` and
`verify-upgrade` commands expose the corresponding accepted API slice above.
All six positive recovery limits preserve API defaults and map explicit
overrides. Start reports an incomplete observation and canonical outer
workspace; resume, one-shot construction and independent verification report
a sealed receipt, exact executable/profile identity, receipt and ancestry
fingerprints, and counts. Verification requires sealed completion, not merely
a valid incomplete recovery chain. Every result remains `active=false` and
`upgrade_authorized=false`. The same executable bytes must be retained.

Ordinary workflow `a17cad03-e574-449e-a21c-a4422c451f1c` used Terra Medium
implementation, root-only application, failure feedback and independent Sol
Medium acceptance of the exact four CLI files. Ruflo stored and exactly read
back the workflow evidence. Final checks passed: default CLI receipts (5,
including actual version-0 and RDF-star version-1 journeys), no-default (6,
including version-1 refusal), existing CLI compatibility (16), option-adapter
units (3), selected Clippy and the CLI build. The CLI default enables
`rdf-12`; the library default does not. Test counts overlap and are not
additional programme milestones.

Fresh CLI processes verify the real executable length/hash and stable receipt
identity. Tests cover relative-input canonical paths, numeric and option
bounds, wrong outer paths, changed ancestry/profile/checkpoints, changed
executable bytes, and retained guards on every generated store. Refusals
preserve the source, backup and existing workspace and emit no success record.
Earlier compiler and invalid symlink-success test failures remain recorded;
the final relative-path test respects the existing no-symlink contract.

The build recorded the local development executable `target/debug/oxigraph`:
641,525,208 bytes, SHA-256
`7232e5e561c322b1b1517a934f560162b76655fd98af49eb6f78c6e9936b59e3`,
from this command's Cargo compiler-artifact event (`cargoFresh=false`).
Selected Clippy adds no changed-source diagnostic; existing warnings remain
and strict warnings-denied CI is not claimed.

This closes receipt CLI exposure, not activation/cutover/rollback,
the remaining compatibility/envelope/classifier/frozen crash or older-binary
gates, cross-platform/system-RocksDB qualification, full G4.3, or publication.
ADR-0028 remains Proposed. See the
[operator journey](../../cli/README.md#offline-build-bound-sealed-upgrades-fork).

## Fresh-target upgrade activation API and CLI (2026-09-11)

`Store::activate_upgrade(source, backup, workspace, fresh_target, options)` and
`activate-upgrade` now produce an independently writable current-format store.
They reverify the exact-build sealed receipt while retaining source, backup,
checkpoint, completed-output and outer-workspace leases. A fresh disjoint target
gets a durable guard before native bytes are copied. Physical inventories and
native logical/storage validation are checked under the target lease, which
remains held across syncing and removal of **only the new target's guard**.
That unlink is the activation boundary; every later fallible result is
`CompletionIndeterminate`. Earlier failures can retain an empty or guarded
target. No directory is overwritten, swapped, resumed or cleaned up.

The source, backup, complete sealed workspace and original inactive receipt
remain unchanged. `UpgradeActivation` is an in-memory historical handoff
observation, not a new persisted receipt or continuing readiness assertion.
The target itself is the ordinary store path. There is no server routing or
automatic rollback. Construction and activation require the same executable
bytes; an earlier build's sealed workspace must not be retrofitted.

Ordinary workflow `aa30fa31-0d6e-4afa-b27b-8f5620e8c688` used native Sol High
implementation, root-only application and independent Astra High acceptance of
the exact ten-file slice and actual evidence. All nine checks passed: library
and CLI Clippy; upgrade units (25); default API activation (5); RDF-1.2 activation,
receipt and recovery tests (5/9/3); default CLI compatibility (15); no-default
CLI activation (4); option units (3); and the CLI build. Counts include helpers
and overlapping coverage, not separate milestones. Tests exercise ordinary
write/query/transaction rollback/reopen, source-existing namespaces and empty
graphs, refusal without input mutation, held/released leases and process exits
immediately before/after guard removal. No-default version-1 evidence is
construction refusal, not activation of another executable's receipt.

Ruflo exactly read back
`programme-task-evidence/workflow-aa30fa31-0d6e-4afa-b27b-8f5620e8c688`.
Earlier test-compilation and proposal-capture failures remain recorded; no
expected results, fixture bytes, dependency locks or harness contracts changed.
Selected Clippy passes with existing warnings; warnings-denied CI is not claimed.
The build's Cargo compiler-artifact identifies local `target/debug/oxigraph`,
641,710,056 bytes, SHA-256
`986a3dcaa898dc80125e8e8914ce306677e2b349e9ae00843c8a871a1fe30ef3`
(`cargoFresh=false`). This is a development executable, not a published release.

This closes the bounded fresh-target activation API/CLI slice, not G4.3.
Known in-place legacy opens, the remaining compatibility/envelope/classifier,
older-binary rollback and frozen compatibility/crash/system-RocksDB gates
remain outstanding. Bounded process exits are not power-loss qualification.
ADR-0028 stays Proposed; no promotion or publication authority is conferred.
See the [operator journey](../../cli/README.md#offline-fresh-target-upgrade-activation-fork).

## Ordinary legacy-open refusal (2026-09-11)

`Store::open`, `open_with_options` and `open_read_only` now return
`StorageError::UpgradeRequired { found, supported: 2 }` for the existing admitted
legacy inventories: version 0 missing only `graphs`, and version 1 with the
complete required inventory. Malformed legacy/current inventories remain
`SchemaUnknown`; newer markers remain `SchemaTooNew`. The new error converts to
`io::ErrorKind::InvalidData`. Guard/lease checks and error priority are retained.
Fresh/current stores still open normally; ordinary legacy opens cannot reach
the retained explicit migration primitives. Writable refusal may still create
an absent empty native `LOCK`; read-only refusal does not create one.

The original Paris and RDF-star assertions and all 16 committed fixture files
remain unchanged. Vendored Linux compatibility setup now uses backup, sealed
upgrade, independent verification and fresh-target activation before its two
ordinary opens. System-profile tests retain explicit preparation/transformation
and a separate **test-only** verified native-file assertion copy: the guard is
omitted only from that fresh copy, never removed from the verified workspace.
This is not a production activation path. An additive vendored test executes
that helper and checks unchanged source/backup/workspace bytes after reopening.

Ordinary workflow `d51a52bd-cbe0-47f9-b00e-a523ec28fbef` passed all ten declared
checks with stable source: safe-open units (17 plus 5 child observations),
default store (29), RDF-1.2 store/activation (30/5), memory-only store (12),
default/no-default CLI inspection/refusal (4 each), upgrade units (25), two
Clippy checks and the CLI build. Counts overlap; they are not distinct milestones.
Native Terra Medium implementation received independent Sol Medium acceptance
and exact Ruflo readback under `programme-task-evidence/workflow-d51a52bd-cbe0-47f9-b00e-a523ec28fbef`.
Clippy reports existing warnings and introduced test-style diagnostics;
warnings-denied CI and zero-new-warning status are not claimed.

The local CLI is 641,713,800 bytes, SHA-256
`0baa56e8518e4c97785a14e7e33ed778e98376c15822bc96e894ab3d5bd851b3`
(`cargoFresh=false`). A separate system-profile compilation check failed because
`rocksdb.pc` was unavailable; no system runtime pass or qualification is claimed.
Feature envelopes, the frozen classifier, older-binary rollback, the frozen
compatibility/crash matrix and full G4.3 remain open. This ADR stays Proposed;
receipt/activation contracts and publication boundaries are unchanged.

## Bounded live-RDF feature refusal (2026-09-11)

After guard/lease and exact current-version/layout checks, builds without
`rdf-12` probe object-leading `dosp` and `ospg` indexes for the existing tags
48, 49 and 56..63. At most 20 one-byte prefix seeks detect live triple and
directional-literal encodings without a full-store scan or recursive decoding.
Iterator status is checked before absence is accepted, and caller database
options are retained. Ordinary writable, options and read-only opens return
`StorageError::FeatureIncompatible { feature: "rdf-12" }`, convertible to
`io::ErrorKind::InvalidData`, before data-changing setup. Existing source bytes
are preserved; writable refusal retains the documented absent-empty-`LOCK`
caveat, while read-only refusal creates no file.

This is bounded positive detection in valid live primary indexes, not complete
feature admission. A regression demonstrates that removed RDF 1.2 quads can
remain in outbox history after the live detector returns false. Unknown tags,
inconsistent indexes, history and derived-state compatibility are not certified.
`Store::inspect` and CLI inspection still report feature compatibility as
unknown. Encoding values, version markers, receipts, activation profiles,
dependency locks and all 16 historical fixture files remain unchanged.

Ordinary workflow `0814fd27-3856-4254-9038-b6aa32f023ec` passed all nine checks:
default/RDF-1.2 safe-open units (21/19 parent tests, plus 5 child observations
in each lane), RDF-1.2 encoder units (2), default store/backup/restore (47),
RDF-1.2 store/activation/mode tests (38), memory-only store (12), two Clippy
lanes and the CLI build. Counts overlap; Clippy exits successfully with existing
and new test-style warnings, not warnings-denied certification. Raw-tag tests
cover every declared tag in both indexes; real RDF-1.2 writer tests cover
nested triples and all directional forms in both graph kinds. Their private
same-build disabled-profile probe is not cross-binary qualification. An initial
checkpoint test incorrectly expected read-only success; its failing run remains
recorded and the corrected test requires the intended typed refusal.

Native Terra Medium implementation received independent Sol Medium acceptance;
Ruflo exactly read back
`programme-task-evidence/workflow-0814fd27-3856-4254-9038-b6aa32f023ec`.
The local development CLI is 641,730,720 bytes, SHA-256
`37d8d251723a2bc1ffcddfa615f8cc2e232710296e5c59810784b8effbfd6090`
(`cargoFresh=false`), not a published release. Full feature envelopes/history
admission, the frozen classifier, older-binary rollback and frozen
compatibility/crash/system-RocksDB gates remain open. G4.3 is incomplete and
this ADR stays Proposed; no qualification or publication authority is added.

## Bounded retained-outbox feature errors (2026-09-11)

On builds without `rdf-12`, bounded outbox consumption now returns
`StorageError::FeatureIncompatible { feature: "rdf-12" }` for valid triple-term
and directional-literal logical v1 effects. The shared cursor validates the
whole payload before reporting missing features: malformed or noncanonical
fields, invalid nested datatypes, depth above 32, invalid graph and trailing
bytes remain corruption. Existing top-level RDF-1.1 typed-literal behavior is
preserved. Record version, position and checksum checks still precede payload
decoding; this does not promise priority over unseen cross-record errors.

Independent literal fixtures match the enabled production encoder and exercise
both feature configurations, including every truncation and the depth boundary.
A raw retained-only RocksDB fixture proves read-only restart, bounded paging
before an incompatible middle event, error propagation and source preservation;
it is not a cross-binary receipt-bound writer qualification. The ordinary
workflow's independent review caught a nested-datatype classification gap even
after its first ten checks passed; repaired-source checks and review are recorded
in `programme-task-evidence/workflow-b4243508-36fa-4f93-ad1b-536d7394c875`.

No storage bytes, emitter/checksum, marker, receipt, retention, page-bound or
live-only preflight contract changes. This closes the misleading consumption
error, not full feature-envelope/history admission, older-binary rollback or
the frozen compatibility/crash/system-profile gates. G4.3 remains incomplete
and this ADR remains Proposed; no qualification or publication is implied.

## Explicit offline RDF feature inspection (2026-09-11)

`Store::inspect_features`, its cooperative-control variant, and CLI
`inspect-features --location PATH` add an explicit read-only report for exact
current layouts. Existing metadata-only inspection is unchanged. The report
identifies recognized RDF 1.2 requirements independently of the inspecting
binary's features, distinguishing live primary object indexes from physically
retained governed outbox history. No RDF terms are emitted and no source files
or native lock are created. Writers must be stopped and paths remain stable.

The retained-history scan validates the retention anchor, record envelopes,
positions, checksums, receipt linkage and complete logical payloads. It keeps
scanning after finding RDF 1.2 encodings, so later malformed records are not
hidden by an unsupported-feature finding. The shared logical parser avoids a
second feature-dependent decoder. This explicit scan can be linear in retained
records; ordinary-open work remains bounded. Unknown/older/newer/incomplete
layouts are not interpreted as current content.

The report does not establish a checksummed schema envelope, store UUID,
complete history or derived-state compatibility. Expired and pre-coverage
history remain explicitly unexamined; `complete_compatibility` is `not-checked`.
Success means the inspection completed, not compatibility or upgrade approval.

Native checks cover both library feature configurations, CLI default and
no-default modes, malformed tails, retained-only requirements and unchanged
source trees. The explicitly selected cross-feature regression uses a real
RDF-1.2 writer and a no-default CLI, proving retained-only RDF-1.2 requirements
are reported as unsupported without changing the source. Recorded checks also
include store/receipt/outbox regressions, Clippy and an identified local CLI
build. The original implementation workflow timed out during host coordination;
remaining checks used ordinary `run` recovery, not a claimed successful original
controller. Its formatting check failure remains recorded; a subsequent
formatting-only workflow `dfa93bfc-63df-4d6e-89aa-90482b8cbe27` passed the crate
format check and focused default/RDF-1.2 inspection and store regressions, with
independent native review and exact MCP readback. Clippy warnings remain open.

This is a bounded product inspection slice, not closure of any complete staged
gate below. ADR status remains Proposed; frozen qualification, full G4.3 and
publication remain separate.

## Explicit lineage and upgrade-guard inspection (2026-09-11)

`Store::inspect_state`, its cooperative-control variant and CLI `inspect-state`
observe physical metadata, the existing upgrade-guard entry and existing
governed lineage state. They preserve the metadata-only `inspect` contract and
the separate feature inspector. Database access is read-only and default-family
only; no setup, migration, namespace/RDF decoding or identity creation occurs.

Only an exact current marker and complete known column-family inventory admits
the existing `GovernanceState::decode` validator. The report distinguishes
decoded `present`, current-layout `absent`, and other-layout `not-inspected`.
The reported 16 bytes are the receipt lineage identity, not a schema UUID;
receipt sequence is observed, not independently qualified against all history.
Malformed current governance remains corruption even when a guard is present.

Guard observation uses `symlink_metadata`: any existing entry counts as present,
including directories and dangling symlinks, without reading or following it.
Other I/O errors propagate. An absent marker does not establish complete journal
state, crash recovery or readiness. Writers must remain stopped and paths stable.

Native tests cover governed identity/checkpoint preservation, absent governance,
invalid governance version/length/checksum, noncurrent layouts, guard kinds,
cancellation, missing paths and repeated source preservation. Default/RDF-1.2
library and default/no-default CLI lanes pass. The separately selected malformed
CLI test requires the actual decoder diagnostic, not merely a nonzero exit from
a stale executable. Store/receipt regressions, formatting and an identified
local CLI build also pass. Exact final review is
`programme-native-reviews/g43-state-inspection-sol-review-v2`; the ordinary
workflow completed after formatting and two bounded CLI review corrections.

This implements existing-state observations, not the checksummed schema UUID
envelope, full interrupted-journal interpretation, complete compatibility or
frozen qualification. All complete staged gates below and G4.3 remain open;
this ADR remains Proposed. No publication is implied.

## Verified outer upgrade workspace inspection (2026-09-11)

`Store::inspect_upgrade(source, backup, workspace, &UpgradeOptions)` and
`inspect-upgrade` observe the existing build-bound outer workspace. They reuse
unchanged preflight, progress-chain, ancestry, nested recovery and receipt
validators. No schema version, journal bytes, receipt encoding or ordinary-open
behavior changes.

`UpgradeWorkspaceState` distinguishes `Initial`, `Running`, `CompleteUnsealed`,
`ReceiptPending` and `Sealed`. Initial requires the exact initial nested journal
boundary; running permits incomplete or completed nested recovery. Complete
states require completed nested recovery. Pending receipt bytes must decode
canonically and equal the receipt derived from the verified evidence. Sealed
inspection delegates to the existing sealed verifier. Invalid or uncommitted
evidence remains an error, not a fabricated state or repair instruction.

The existing workspace/native leases and final rereads span verification.
Callers must retain the offline, stable, exclusively controlled paths and exact
Linux/static/vendored executable/profile. No files are created, renamed,
repaired or deleted. The workspace lock still needs its existing access mode;
non-mutation is not a read-only-filesystem guarantee. Observations never grant
resume, activation or publication authority. Only a verified sealed state
exposes `sealed_receipt()`; a pending receipt remains pending.

Ordinary workflow `4e7df9b6-bd69-4f89-a223-1d02ec4306c5` completed with native
Sol High implementation, root-only application and independent Sol Medium
acceptance (`programme-native-reviews/g43-upgrade-inspection-sol-v1`). Final
checks passed: crate formatting; default/RDF-1.2 inspection tests (3/4);
existing receipt/recovery API tests (9+3); default CLI inspection/receipt tests
(3+5); and no-default CLI inspection (2). Configurations overlap, not distinct
new behaviors. Successful journeys and cancellation compare all inputs;
malformed journal/pending-receipt tests retain workspace bytes, and the CLI
torn-progress test compares source, backup and workspace. Existing warnings
remain; no warnings-denied or full frozen qualification claim is made.

`run-v60JXW` built the local default CLI (642,385,400 bytes, SHA-256
`1a9d21e89b0d50b68370731b00427ce9eb5d37b293b68339af2ac5a7ebbea0c7`).
`run-9o2aor` then passed all three focused CLI journeys, but Cargo selected a
different CLI artifact at `target/debug/oxigraph`: 643,027,336 bytes, SHA-256
`219b52709da178ce695f0f58c251c38e61dfc926b2a46e8c085ea026c2fac57a`.
The test uses Cargo's `CARGO_BIN_EXE_oxigraph` path; that post-test identity is
recorded separately, not claimed to match the build receipt. These are local
development artifacts, not published releases. The earlier source-scope refusal,
formatting failure and CLI test
compilation failure remain recorded. The module/filter mismatch was corrected
before the first library test run; no zero-test pass is claimed.

This closes the admitted outer-workspace observation gap only. Schema/feature
envelopes, complete history/derived-state admission, frozen cross-profile
inspection/compatibility, older-binary rollback and system-RocksDB qualification
remain open. ADR-0028 remains Proposed and full G4.3 is not complete.

## Schema-envelope read side (2026-09-12)

`StoreSchemaEnvelope::decode`, `StoreFormatInfo::schema_envelope`, and the
existing `inspect` CLI now expose the read side of the primary envelope at
`oxversion`. Every eight-byte marker retains its legacy integer interpretation.
No constructor, ordinary-open writer, upgrade writer, journal, receipt or
receipt validator changes. `LATEST_STORAGE_VERSION` remains 2. A canonical
envelope with logical version >=3 is reported as newer and ordinary opens return
`SchemaTooNew`; malformed envelope bytes return no descriptor and are rejected
as `SchemaUnknown`. Inspection never allocates a new identity.

The bounded v1 grammar is implemented in
[`schema_envelope.rs`](../../lib/oxigraph/src/store/schema_envelope.rs):
`OXSCHEMA` magic, envelope version 1, big-endian logical version, RFC 4122 v4
UUID, RDF ceiling 11/12, encoding profile 1, seven u16 codec ceilings, and the
exact sorted twelve-family inventory. Names are length-prefixed; the entire
marker is bounded to 512 bytes and permits no padding or extensions. A SHA-256
checksum covers domain `oxigraph.schema-envelope.v1\0` and the preceding bytes.
The checksum establishes byte consistency, not authorship or logical validity.

The schema UUID is separate from governed lineage and RocksDB identity. RDF is
an immutable permitted-write ceiling, not observed term usage. Codec ceilings
are namespace 1, transaction outcome 2, commit receipt 2, governance 3, outbox
record 1, derived-generation container 1 and semantic changes 1. They describe
permitted codec revisions, not subsystem presence or completeness. External
provider identities remain separately validated. Different descriptor profiles
need a reviewed format revision; this reader grants no writer/default activation.

Workflow `8f252fa7-1855-46b2-ac47-c85ad19ec5fb` used owner-selected Astra Low
implementation and independent Sol Medium review, root-only application and
exact MCP handoff. Formatting (`run-Uj2PKz`), default/RDF-1.2 envelope tests
(`run-0Lkawd`/`run-t4ZpEH`, four each), legacy inspection (`run-DtErKu`, seven),
safe opens (`run-PkGrNG`, 17 top-level tests plus five child observations), and
CLI compilation (`run-QCsEyj`) passed. Literal-envelope CLI JSON tests passed
two (`run-2IMzSV`); existing CLI inspection passed nine (`run-9e88Kx`). Counts
across configurations overlap. The initial formatting failure `run-sHPhXY`
remains recorded. Independent review is
`programme-native-reviews/g43-schema-envelope-sol-v1`.

Local build `run-gwWSRy` identifies `target/debug/oxigraph`, 642,456,072 bytes,
SHA-256 `95a66d763ecd5120096270c187026ebaa827d95cff0a2e7d2a3b720232e4d4c6`,
from its Cargo compiler-artifact event (`cargoFresh=false`). This development
artifact was built after the tests; no exact-executable journey or publication
is claimed. The preceding upgrade-inspection artifact mismatch remains history.

Next is the explicit envelope writer and v2-to-v3 shadow path, with UUID retained
through retries, receipt/backup binding, RDF-ceiling admission and failure tests.
Default activation, frozen compatibility/rollback gates and full G4.3 remain
open. The ADR remains Proposed.

## Explicit inactive marker-only v2-to-v3 construction (2026-09-16)

`Store::start_schema_upgrade`/`resume_schema_upgrade` and
`SchemaUpgradeReceipt::verify` in
[`schema_upgrade.rs`](../../lib/oxigraph/src/store/schema_upgrade.rs) build and
independently verify a sealed, inactive version-3 copy from an unchanged source
and its completed ADR-0022 backup. The module doc states the bound plainly:
"Explicit marker-only v2-to-v3 construction. No ordinary admission or
activation." Ordinary `Store::open`/`open_read_only` are unchanged by this
slice; nothing reads or writes the new envelope on the normal path.

The scope is exact primary equality: every column-family key/value must match
the source except `default/oxversion`, while external contributor bytes
(receipt-referenced files outside the primary column families, for example a
`contributors/<provider>/...` subtree) are preserved byte-for-byte and never
reconciled against a projection. A single checksummed schema UUID is stamped
once and retained through every retry, resume and interruption. Interrupted or
failed attempts are retained under `attempts/`, never repaired, rewritten, or
reused as another attempt's input; a torn journal, a tampered sealed record, or
a changed source/backup is rejected rather than patched. Independent
reopen/recompare (`inputs.recheck`) revalidates unchanged source and backup
ancestry before trusting any prior attempt.

Correction to an initial reading of this slice: the sealed `SchemaUpgradeReceipt`
struct itself carries no executable hash/length field and no public accessor
for one, unlike the version-0/1-to-2 `UpgradeReceipt` profile added earlier in
this ADR. But the underlying preflight (`plan_bytes`) already embeds a
`BuildBinding` (the same private type the version-0/1-to-2 profile uses,
reused here as a descendant module) capturing the running executable's exact
length and SHA-256 from `/proc/self/exe`. Both `resume_schema_upgrade` and
`SchemaUpgradeReceipt::verify` call `verify_workspace`, which unconditionally
re-derives `plan_bytes` against whatever binary is currently running and
rejects with `InvalidManifest` before trusting any stored attempt if it does
not byte-for-byte match the persisted preflight. So resuming or independently
verifying a v2-to-v3 workspace with a different executable **does** fail
closed today, on the same mechanism as the sibling profile.

This mechanism is now proven by test, not just present by construction:
`schema_upgrade_rejects_preflight_built_by_a_different_binary` in
`schema_upgrade_tests.rs` (committed `a7305259`) runs a same-build positive
control (start, resume, verify all succeed), then tampers one bit inside the
located `BuildBinding` encoding of a fresh preflight and asserts
`resume_schema_upgrade` fails with the workspace bytes unchanged afterward.
Independent review (`claude-fable-5-1`/high, ACCEPT) confirmed the test
actually isolates the build-identity field rather than a generic plan
mismatch, and that all 6 deterministic checks passed on the tampered and
untampered paths alike. The one remaining narrower gap: the sealed receipt
still exposes no public `executable_len()`/`executable_sha256()` accessor for
an operator to inspect the bound build after the fact, unlike the sibling
profile -- a documentation/ergonomics gap, not a fail-open one.

This slice was applied to the working tree before this session without
independent verification. Ordinary delivery workflows on Claude-only routes
(no Codex subscription available this week) found and fixed four real defects
across five dispatches (`workflow-1C5CTQ`, `workflow-fhZej5`, `workflow-D8KQa5`,
`workflow-eBoRBl`, `workflow-lXJvCC`): an `E0283` ambiguous-type compile error in
the test suite; a naming bug in `resume_inner`'s contributor-copy loop that
passed a receipt-relative path where a flat validated artifact name was
required (`BackupError::InvalidPath`); a misapplied ADR-0022
backup-package-specific directory-sync helper that assumed a fixed
`store/`+`contributors/` layout and returned `BackupError::NotFound` against an
attempt directory that only had `store/`; and, caught by independent review
after all six deterministic checks had already passed, a durability regression
in the narrow fix for that `NotFound` bug: it dropped `fsync` coverage for any
`contributors/` subtree, which the contributor-preservation property above
requires. The final fix is a general recursive `sync_tree` helper that fsyncs
every directory `create_parents` may have created under an attempt, not a
name-specific pair. Native Terra/Sol/Astra-family Claude implement roles
proposed each fix; independent Claude review roles at matching or higher effort
accepted or correctly rejected each proposal; root applied only reviewed
changes and re-ran every check itself before commit.

Final checks passed on the committed source: focused compile
(`cargo check --tests`), `schema_upgrade` library tests (9/9, including the
contributor-byte-preservation test that exposed the durability regression),
the same tests with `rdf-12` enabled (10/10), `cargo fmt -p oxigraph --
--check`, the existing `backup_receipts`+`restore_receipts` regressions (18/18),
and the existing `upgrade_receipts` regression (9/9). Exact evidence for the
final accepted increment is in Ruflo
`programme-task-evidence/workflow-ee567fc4-9d09-4ee5-9e4f-33d177e13203`; earlier
rejected/inconclusive dispatches remain recorded rather than discarded. The
repair is committed to `main` as `424e895b`; it is not pushed.

This closes only the bounded repair-and-verify gap in the already-drafted
marker-only construction slice; the separate binary-compatibility test
addition above (`a7305259`) closes the "unproven" half of that gap. Neither
closes envelope admission on ordinary open, an activation/cutover API for
this v2-to-v3 path (unlike the earlier version-0/1-to-2 profile's
`activate_upgrade`), an operator-visible build-identity accessor on the
sealed receipt, the operational gate (backup+upgrade+explicit
cutover+rollback+restore drills on frozen size classes with recorded duration
and peak disk/memory), or the frozen compatibility/crash/system-RocksDB
qualification matrix. Old/new binary compatibility failing closed is now
implemented and tested for this path. ADR-0028 remains Proposed and full
G4.3 is not complete.

## Explicit fresh-target activation for the v2-to-v3 construction (2026-09-16)

`Store::activate_schema_upgrade` in
[`schema_upgrade.rs`](../../lib/oxigraph/src/store/schema_upgrade.rs) closes
G4.3's remaining source-preserving-cutover exit criterion for this path. It
mirrors the version-0/1-to-2 profile's `activate_upgrade`/`UpgradeActivation`
exactly: it re-verifies the sealed receipt with every check
`SchemaUpgradeReceipt::verify` performs (no relaxed subset), locates the
single VALIDATED journal record for the receipt's winning attempt, copies
only that attempt's `store/`-prefixed files into a fresh guarded target, and
removes the target's guard as the sole activation boundary. Contributor and
other external artifacts are never published to the target; they remain
preserved in the retained workspace as receipt-bound evidence, unchanged from
the marker-only construction slice above. Every failure after the guard
unlink is reported `CompletionIndeterminate`, and the target is never cleaned
up automatically. `SchemaUpgradeActivation` is an in-memory historical
observation only, exactly like its sibling `UpgradeActivation`.

**Activating a schema version does not promote it to current.**
`LATEST_STORAGE_VERSION` is still 2, so ordinary `Store::open`/
`open_read_only` on a freshly activated version-3 target correctly return
`StorageError::SchemaTooNew { found: 3, supported: 2 }` -- the same typed
refusal any newer-than-supported store gets. This was caught the hard way: an
initial implementation dispatch (`workflow-WYzakl`) produced a correct
`activate_schema_upgrade`, but its own tests wrongly asserted ordinary
`Store::open` would succeed after activation and returned INCONCLUSIVE only
because that read-only worker could not run `cargo test` to discover the
failure itself. Root applied the diff directly, ran the real checks, found
two tests failing with exactly that `SchemaTooNew` error, confirmed this was
a test defect rather than an implementation defect, and corrected the two
assertions to expect the (correct) typed refusal instead of success. Source-
preserving cutover therefore means exactly what its name says: the source is
preserved and a verified, byte-identical copy is published at a fresh target
path, for a future version-3-aware binary to adopt once that separate,
larger promotion decision is authorized -- not that this binary treats the
result as its own current, ordinarily-usable schema today.

The corrected diff was independently reviewed (`claude-fable-5-1`, high
effort, ACCEPT) via a confirmation-only workflow (`workflow-dFfY8r`) after
root's own direct verification of all six checks. The review's own `mcp-
handoff` step did not complete: root edited one stale doc-comment line
(the module header still read "No ordinary admission or activation",
which the review correctly flagged as confusing now that explicit
activation exists) between the review's ACCEPT and the handoff step, which
correctly tripped the harness's own source-tamper detection and ended that
workflow as incomplete. This was a process-timing mistake by root, not a
finding about the code; root re-ran the affected checks directly after the
comment edit (cargo check and the schema_upgrade library tests, 14/14) and
recorded the evidence manually since the automatic handoff could not.
Exact evidence, including this note, is in Ruflo
`programme-reviews/oxigraph-schema-upgrade-activation-2026-09-16-v1`. Final
checks: compile; schema_upgrade library tests 14/14; the same with `rdf-12`
15/15; `cargo fmt -p oxigraph -- --check` clean; existing
`backup_receipts`+`restore_receipts` 18/18; existing `upgrade_receipts` 9/9.
Committed to `main` as `af7ea897`; not pushed.

This closes only the activation API itself, library-only with no CLI
exposure (a separate slice, matching every other section of this ADR's
API-then-CLI delivery order). It does not add envelope admission on
ordinary open, an operator-visible build-identity accessor on the sealed
receipt, the operational gate (backup+upgrade+explicit
cutover+rollback+restore drills on frozen size classes with recorded
duration and peak disk/memory), or the frozen compatibility/crash/system-
RocksDB qualification matrix -- and it does not and cannot promote version 3
to `LATEST_STORAGE_VERSION`, which remains a separate, larger, not-yet-
authorized decision. ADR-0028 remains Proposed. With this slice, G4.3's
named exit criteria (read-only inspection, verified backup ancestry,
resumable shadow copy, source-preserving cutover, and old/new binary
compatibility fail closed) are each implemented and tested for the v2-to-v3
marker-only path; the crash matrix's breadth and the frozen
qualification/promotion gates remain the largest genuinely open items, and
full G4.3 completion still requires those.

## CLI exposure for the v2-to-v3 construction and activation (2026-09-16)

`start-schema-upgrade`, `resume-schema-upgrade`, `verify-schema-upgrade` and
`activate-schema-upgrade` expose the library API above, mirroring the
sibling version-0/1-to-2 CLI commands exactly. Every command requires an
explicit `--rdf-profile rdf-11|rdf-12` flag, since `SchemaUpgradeOptions` has
no `Default` by design. `activate-schema-upgrade`'s help text and printed
output both state plainly that activation does not promote version 3 to
this binary's current schema: `LATEST_STORAGE_VERSION` is still 2, so
ordinary `Store::open`/`open_read_only` on the published target continue to
return the typed `SchemaTooNew { found: 3, supported: 2 }` refusal until a
future version-3-aware binary is separately authorized to treat version 3
as current.

Two implement dispatches correctly declined to guess rather than fabricate:
an initial spec omitted needed reference files and the worker returned
INCONCLUSIVE with zero changes; a corrected, fully self-contained respec
produced correct `cli/src/cli.rs`, `cli/src/schema_upgrade.rs` and
`cli/tests/schema_upgrade.rs` content but deliberately withheld
`cli/src/main.rs` (roughly 4000 lines) to avoid risking corruption from full
re-transcription, handing root the exact two hunks to apply instead. Root
applied them, then found and fixed two further real, pre-existing gaps this
CLI work was the first to expose: `SchemaUpgradeActivation` (added in the
previous section's commit) was never added to the `pub use` re-export chain
at any of its four levels (`store.rs`, `store/upgrade.rs`,
`store/upgrade_transform.rs`, `store/upgrade_receipt.rs`), making it
unreachable from outside the `oxigraph` crate; and `cli/Cargo.toml` never
listed `tempfile` as a dev-dependency despite it already being a workspace
dependency. Both are one-line-per-file fixes with no behavior change beyond
making an existing type nameable externally.

Independent review (`claude-fable-5-1`, high effort, ACCEPT) ran inside a
confirmation-only workflow (`workflow-FhGmwP`) against the already-applied,
already-verified diff. All six deterministic checks passed for real inside
that workflow's own execution: CLI compile, the 5 new CLI integration tests,
the 3 existing `upgrade_activation` CLI tests unchanged, library compile,
the 14 library `schema_upgrade` tests unchanged, and library `cargo fmt
--check`. Root additionally ran the CLI crate's own `clap_debug` structural
test after review (a cheap gap the reviewer flagged): it passed.
`cargo fmt -p oxigraph-cli -- --check` fails only in six pre-existing files
this diff does not touch (confirmed pre-existing on `main` before this
change); the four files this diff actually changes or adds are individually
fmt-clean.

This workflow's own automatic evidence handoff did not complete -- a
structural property of this harness, not a code defect. Its `mcp-handoff`
step only fires when the workflow's own tracked run actually delivered a
source diff (`initialFiles !== files()` at that point); since root had
already applied every fix to disk before launching this confirmation-only
workflow, that condition was never true even though genuine independent
review had already run and accepted. Root recorded the evidence manually
from the workflow's own genuine check-run results and the genuine review
verdict, in Ruflo
`programme-reviews/oxigraph-schema-upgrade-cli-exposure-2026-09-16-v1`. The
lesson for future increments: a confirmation-only dispatch against
already-applied changes cannot reach a clean handoff in this harness; to get
one, let the workflow's own implement step deliver the change via its own
`root-apply`, rather than pre-applying and asking for a rubber-stamp
confirmation. Committed to `main` as `1300fb0d`; not pushed.

This closes CLI exposure for the v2-to-v3 path only. It adds no new library
behavior; the operator-journey documentation follow-up landed separately
(`cli/README.md`, next commit `1727e6e4`), and this slice does not itself
affect the crash-matrix breadth or operational-gate items that remain the
largest genuinely open pieces of G4.3. ADR-0028 remains Proposed.

## Real process-kill crash-matrix coverage for the v2-to-v3 construction (2026-09-16)

Every fault-injection test for this draft up to this point (`schema_upgrade_
every_interruption_retains_uuid_and_prior_attempt_bytes`,
`schema_upgrade_activation_faults_never_leave_a_usable_target`) only injects
a synthetic `Err` from an in-process closure at each numbered fault
call-site inside `resume_inner`/`activate_inner`. That proves the code
handles a `?`-propagated logical failure at every phase, but it does not
prove behavior survives an actual killed process: dropped destructors,
unflushed buffers and OS-level file-descriptor/lock release differ from an
ordinary Rust unwind. The sibling version-0/1-to-2 profile already carries
exactly this class of test for its own activation
(`activation_child_exits_immediately_before_and_after_guard_unlink` in
`upgrade_receipt.rs`), using `std::process::Command::new(std::env::
current_exe()?)` with `--exact <test path>` to re-invoke the same test
binary at one helper `#[test]` that calls the real API with a fault closure
invoking `std::process::exit(73)` at a requested phase, then inspecting the
child's exit code from the parent.

`lib/oxigraph/src/store/schema_upgrade_tests.rs` gained the mirrored pair,
entirely test-only (`resume_inner`/`activate_inner` already accept an
injectable fault closure; no change to `schema_upgrade.rs` was needed):

- `schema_upgrade_resume_child_exit_mid_copy_retains_a_resumable_attempt`
  kills a real child process mid per-file-copy (fault phase 2), asserts exit
  code 73, then calls `Store::resume_schema_upgrade` fresh and in-process on
  the same workspace and asserts it completes to a sealed receipt with the
  same schema UUID, with source/backup bytes unchanged throughout.
- `schema_upgrade_activation_child_exits_before_and_after_guard_unlink`
  kills a real child immediately before (phase 4) and immediately after
  (phase 5) the guard-file unlink. Phase 4 leaves the target guarded and
  still refused by `Store::open`. Phase 5 leaves the target published
  (`storage_version` `Some(3)`) and still correctly refused by ordinary
  `Store::open` with `SchemaTooNew { found: 3, supported: 2 }` -- the test
  deliberately does not assert ordinary `open` success, matching the
  `af7ea897` fix rather than reintroducing that defect.

The implement worker, lacking a read tool to confirm the exact module
nesting for the `--exact` filter, derived the libtest path at runtime from
`module_path!()` with the leading crate segment stripped, rather than
hardcoding the inferred literal. Root independently confirmed this resolves
to `oxigraph::store::upgrade::transform::receipt::schema_upgrade::tests` by
tracing the actual `mod` chain, matching the runtime-derived value; the
approach is strictly more robust than a hardcoded string; a wrong name
would run zero tests, exit `0`, and fail the parent's `Some(73)` assertion
rather than pass vacuously.

All six deterministic checks passed for real inside the workflow's own
execution, with real, non-fabricated counts: `cargo check --tests`;
`cargo test --lib schema_upgrade` (18 passed, up from the pre-existing 14
matching that filter); the same with `--features rdf-12` (19 passed, up
from 15); `cargo fmt --check`; the `backup_receipts`+`restore_receipts`
regression suite (18 passed); and the legacy `upgrade_receipts` regression
suite (9 passed). Independent review (`claude-fable-5-1`, high effort)
returned ACCEPT with two minor, non-blocking findings (the resume test
could additionally snapshot the crashed attempt's own bytes; the helper's
`variable()` fails loudly rather than no-ops on a missing secondary path,
which is harmless since the parent always supplies every variable).

Unlike the previous (CLI-exposure) increment, this workflow's implement
step delivered the change via its own tracked `root-apply` rather than a
pre-applied confirmation-only dispatch, so the harness's own diff-delivered
gate was satisfied and `mcp-handoff` completed cleanly on the first attempt
(`workflow-cicRkY`, run `11090a7e-61c0-4477-b9b6-fe53e22ea0f2`), recorded in
Ruflo `programme-task-evidence/workflow-11090a7e-61c0-4477-b9b6-fe53e22ea0f2`
and byte-for-byte confirmed by a genuine `memory_retrieve` before
acknowledgement. Test-only; no production code changed. Committed to `main`
as `518ccf16`; not pushed.

This closes crash-point coverage for the two highest-value real
interruption points on the v2-to-v3 path (mid-copy resume, pre/post-unlink
activation). It does not close full crash-matrix breadth (every numbered
fault phase re-proven under a real process kill, not just synthetic
injection) or the operational gate (backup+upgrade+explicit
cutover+rollback+restore drills on frozen size classes with recorded
duration/peak disk/memory), which remain the largest genuinely open pieces
of G4.3. ADR-0028 remains Proposed.

## Operational gate: scope and first drill increment (design, 2026-09-16)

The operational gate (item 4 below) is the largest remaining genuinely open
G4.3 piece and has no implementation yet anywhere in this codebase; this
section fixes its concrete shape before any code lands, so a harness
increment can be dispatched against an unambiguous specification rather than
an implement worker guessing at "frozen size classes" or "peak disk/memory."

**Which upgrade path.** The drill targets the version-0/1-to-2 legacy path
(`Store::start_upgrade`/`resume_upgrade`/`activate_upgrade` in
`upgrade_receipt.rs`), not the v2-to-3 draft. The legacy path is the one real
operators actually run today: it produces a store this binary's
`LATEST_STORAGE_VERSION` (2) treats as current and openable after
`activate_upgrade`. The v2-to-3 draft cannot yet be operationally drilled
end-to-end, since activating it deliberately does not promote version 3 to
current (no binary in this repository can open the result ordinarily yet);
an operational drill against it would have no real "cutover" to measure.

**Frozen size classes, first increment.** This codebase already carries two
checked-in, byte-frozen legacy fixtures used by the existing compatibility
tests: `lib/oxigraph/tests/rocksdb_bc_data` (version 0) and
`lib/oxigraph/tests/rocksdb_bc_rdf_star_data` (version 1). The first drill
increment reuses these two as its initial (smallest) size classes rather
than inventing new ones, since they are already frozen, already checked in,
and already exercise both supported legacy source versions. Additional,
larger synthetic size classes (generated fixtures at fixed, documented quad
counts, e.g. small/medium/large) are explicit follow-up work once the
smallest class proves the measurement plumbing end-to-end; committing large
binary fixtures to the repository is itself a decision this section
deliberately defers rather than making unreviewed.

**What each stage measures, first increment.** Tracing the existing
`lib/oxigraph/tests/upgrade_activation.rs` fixture/setup helpers shows the
legacy-upgrade and operational-backup/restore APIs use two genuinely
different backup formats, not one: `Store::backup_legacy` produces the
package `Store::start_upgrade`/`Store::upgrade` consume, while
`Store::backup_with_receipt` (ADR-0022, G2.6) produces the package
`Store::restore_backup` consumes. The drill therefore has two distinct
backup legs, not one:

- **Backup (legacy, drives the upgrade)** — wall-clock duration of
  `Store::backup_legacy` on the fixture, via `std::time::Instant`.
- **Upgrade** — wall-clock duration of `Store::start_upgrade` followed by
  `Store::resume_upgrade` (or the combined `Store::upgrade` convenience)
  from the fixture and its legacy backup into a fresh destination.
- **Explicit cutover** — wall-clock duration of `Store::activate_upgrade`
  into a fresh, disjoint target, plus confirmation the target opens
  ordinarily afterward (`Store::open` succeeds; unlike the v2-to-3 draft,
  this is the live, current-schema path).
- **Rollback to the preserved source** — not a data-movement operation to
  time in this design: because the whole chain is source-preserving (the
  original fixture directory is never opened for writing, and its bytes are
  asserted unchanged after every stage, exactly as the existing crash-matrix
  and activation tests already prove), rollback for an operator is pointing
  traffic back at that untouched directory. Its measured "duration" is
  therefore reported as the byte-identity check itself (near-instant,
  dominated by directory-tree comparison, not data recovery) with an
  explicit note that this is a property of source preservation, not a
  simulated failback procedure. This drill does not claim rollback to an
  older *binary* is qualified; that remains the frozen evaluator track named
  in "Alternatives rejected" and the top status block.
- **Backup (with-receipt, drives the restore) and restore** — after
  activation, `Store::backup_with_receipt` on the now-current, opened
  activated store produces a second, ADR-0022-shaped package; wall-clock
  duration of `Store::restore_backup` from that package into a third fresh
  directory is read directly from `RestoreReceipt::restore_duration()`
  rather than re-timed, proving the upgraded store is not just open but
  operationally recoverable end-to-end.
- **Peak disk (proxy)** — total on-disk byte size of every regular file under
  each of the fixture, legacy-backup, upgrade-destination, activation-target,
  with-receipt-backup and restore-destination directories at the end of its
  stage, summed via a directory-walk helper (`fs::metadata(..).len()` over
  `fs::read_dir` recursion), the same style already used by this file's own
  `bytes()`-style test helpers. This is a proxy for peak disk, not an
  instantaneous high-water-mark sample; a true continuously-sampled peak
  (e.g. polling `statvfs` on a timer during each stage) is deferred.
- **Peak memory and read/write amplification** — explicitly deferred out of
  this first increment. Peak RSS sampling needs either a background sampling
  thread or an external subprocess wrapper (this repository's existing
  process-crash tests already re-invoke the test binary via
  `std::process::Command`, which is the natural mechanism to extend for this
  later); amplification needs a physical-bytes-written counter compared
  against the already-available `primary_bytes()` on the relevant receipts.
  Neither blocks proving the duration/disk plumbing end-to-end first.

**No zero-downtime claim.** Every stage above is measured as an isolated,
offline, single-writer operation on a fixture nobody else is touching,
exactly as every existing test in this file operates. The recorded numbers
describe this drill's own environment and fixture size; they are not service
availability numbers and must never be read as a general upgrade-time SLA
without the frozen, multi-machine qualification this ADR explicitly places
outside ordinary delivery.

**Deferred to later increments:** additional synthetic size classes beyond
the two checked-in fixtures; peak memory sampling; read/write amplification;
promoting the drill from an ad hoc integration test to a `cli` subcommand or
persisted receipt schema, which is only worth designing once the numbers
above are proven to exist and be trustworthy at all.

## First operational-gate drill landed, with a real spec bug found and fixed (2026-09-16)

`lib/oxigraph/tests/upgrade_operational_drill.rs` implements the design
above. Landing it took three real, harness-verified iterations, each
instructive:

1. **First implement (ACCEPT), root-applied and checked for real: failed.**
   The spec unconditionally ran both checked-in fixtures through
   `Store::upgrade`. Root had traced `upgrade_activation.rs`'s
   `fixture()`/`inventory()` helpers closely but not far enough down the
   file to see that its own version-1 (`rocksdb_bc_rdf_star_data`) test is
   gated behind `#[cfg(feature = "rdf-12")]`, with a separate
   `#[cfg(not(feature = "rdf-12"))]` test asserting
   `Store::upgrade(...).unwrap_err()` for that exact fixture. The real
   check failed at runtime with `Storage(Corruption(CorruptionError(Msg(
   "the term buffer has an invalid type id")))))`, exit 101, zero tests
   passed -- `Store::upgrade`'s own correct rejection of RDF-star content
   without `rdf-12`, propagated by `?` out of the test. This is exactly the
   harness doing its job: catching a real, non-obvious spec mistake that
   review of the proposed diff alone would not have caught, since the diff
   itself was internally consistent with the (wrong) spec.
2. **Automatic check-failure retry: INCONCLUSIVE.** The harness's own
   feedback loop correctly re-dispatched implement with the failure
   evidence attached. That retry (a different native worker instance, no
   shell or log access) produced a plausible-but-wrong diagnosis --
   speculating about a directory-listing race in `directory_bytes` --
   because it could not read the actual stderr. INCONCLUSIVE on an
   IMPLEMENT-role dispatch throws immediately in this harness (no further
   automatic retry), ending that workflow run with `status: "incomplete"`.
   Root independently traced the true root cause directly (see above) and
   dispatched a fresh, tightly-scoped fix spec as a new workflow run --
   deliberately not pre-applying the fix to disk first, per the lesson
   already recorded in the CLI-exposure section: a confirmation-only
   dispatch against an already-applied diff cannot reach `mcp-handoff` in
   this harness.
3. **Second implement (ACCEPT), root-applied: passed check 1-3, failed
   check 4 (fmt).** The fix itself -- splitting the single test into an
   ungated `drill(0)` and an `rdf12_`-prefixed, `#[cfg(feature =
   "rdf-12")]`-gated `drill(1)`, matching the sibling naming convention --
   was correct on the first try and genuinely exercised: `cargo check`
   passed, the default-feature run passed 1/1 (only version 0), the
   `--features rdf-12` run passed 2/2 (both versions). `cargo fmt --check`
   then failed on three lines exceeding the 100-column limit (the
   source-preservation `assert_eq!`, the `Store::restore_backup` call, the
   `eprintln!` line) that had never actually been checked in the first
   iteration, since that run died at check 2 before reaching fmt. Rather
   than dispatch a third native worker for a purely mechanical formatting
   fix, root ran `cargo fmt -p oxigraph -- lib/oxigraph/tests/upgrade_
   operational_drill.rs` directly and confirmed `--check` now exits `0` --
   consistent with this session's established pattern of applying `cargo
   fmt` directly rather than delegating whitespace-only changes.

**A second, self-inflicted harness crash, and how it was recovered.** Root's
own synthetic native-worker response representing that mechanical fmt fix
set `workerId: null` (there being no real dispatched worker to name).
`workflow.mjs`'s own strict validation (`workerOutput`, requiring
`text(result.workerId)`) rejected this and threw `"Incomplete or unbounded
native result"`, crashing that workflow run -- an operator mistake in
constructing the synthetic JSON, not a defect in the code or the fix. By
that point checks 1-3 had already passed for real with genuine harness
evidence under `target/engineering-delivery/run-*/result.json`, and the fmt
fix was already independently verified. Root ran the remaining two checks
(fmt --check; the `upgrade_activation`/`restore_receipts`/`upgrade_receipts`
sibling suites, 23 passed) directly, then assembled a standalone review
dispatch by hand -- the same `native-worker`/`review`-role request shape the
harness itself constructs, built from the real evidence files rather than
through the crashed workflow's own state machine -- since the automated
pipeline had died before reaching its own review step. Independent review
(`claude-fable-5-1`, high effort) returned ACCEPT, correctly flagging what
it could not itself verify (file access) and asking root to confirm `git
status --porcelain` showed only the one new file and that the `--nocapture`
stderr logs actually contained the `drill version=` measurement lines; both
were confirmed directly before commit.

**Real measured numbers from these verification runs** (this environment,
one run each; not a claimed baseline -- see "no zero-downtime claim" above):
version 0's `upgrade` stage took roughly 20-24s and `cutover` roughly
20-23s, both dominated by RocksDB compaction/open cost on this fixture;
every other stage (`backup_legacy`, `rollback`, `backup_with_receipt`,
`restore`) completed in single-digit-to-tens of milliseconds; total on-disk
bytes across every directory the drill produced was roughly 2.1-2.2MB for
version 0 and roughly 3.3MB for version 1's `with-receipt-backup` and
`restored` directories.

Committed to `main` as `dab6050e` (test) and this section as a following
commit; not pushed. This closes the first operational-gate drill for the
legacy version-0/1-to-2 path. It does not close additional size classes,
peak-memory sampling, read/write amplification, or the broader crash-matrix
breadth beyond the real-process-kill points already proven at the time of
writing (three -- see the next section for the count and where each one
lives), which remain the largest genuinely open pieces of G4.3. ADR-0028
remains Proposed.

## Real OS-level process-kill coverage for the legacy upgrade resume step (2026-09-16)

`lib/oxigraph/src/store/upgrade_receipt.rs` (the legacy version-0/1-to-2
path) already carried a real-process-kill test for its *activation* step
(`activation_child_exits_immediately_before_and_after_guard_unlink`,
predating this ADR's work this session) but none for *resume* -- only
synthetic in-process fault injection (`pending_receipt_is_retained_and_
never_overwritten`, `completed_progress_resumes_without_rewriting_
recovery_evidence`, and others). An earlier note in this ADR's own
programme-control record incorrectly stated the legacy path had *no* real-
process-kill coverage at all; tracing the file directly (rather than
trusting that note) found the pre-existing activation test and corrected
the record before this slice was scoped.

`resume_upgrade_inner`'s fault call sites, traced directly from source:
fault(0) right after the nested `resume_upgrade_recovery` completes;
fault(1) inside the leased verification closure, right after the
transformed result is obtained; fault(2) right after the `COMPLETED`
progress record is appended/verified; fault(3) right after the `PENDING`
receipt file is written and synced, before the atomic rename to the final
receipt file; fault(4) right after that rename, mapped through
`indeterminate()`; fault(5) terminal, after directory syncs.

The new test, `resume_child_exits_immediately_before_and_after_receipt_
publication`, targets the fault(3)/fault(4) atomic-rename boundary,
mirroring the existing activation test's own before/after-atomic-operation
shape and its `current_exe()`/`--exact` re-invocation technique. The two
phases are **asymmetric by design, not by oversight**, and the test's
assertions reflect that:

- **Phase 3** (killed after the `PENDING` file is written+synced, before
  the rename): the pre-existing `pending_receipt_is_retained_and_never_
  overwritten` test already establishes, via synthetic fault injection at
  the same phase, that a subsequent ordinary `Store::resume_upgrade` call
  returns `Err` (not a successful completion) and `UpgradeReceipt::verify`
  also errs -- a deliberate fail-closed design: a dangling `PENDING` file
  with unknown fsync-durability status is never silently trusted or
  resumed. The new test proves this holds after a *real* process kill too:
  `PENDING` bytes retained exactly, the final receipt file absent,
  `resume`/`verify` both correctly refuse, source/backup bytes unchanged.
- **Phase 4** (killed immediately after the rename): the publication is
  complete. The new test asserts the final receipt file exists, `verify`
  succeeds, and a fresh `resume_upgrade` call succeeds too (taking the
  early `if state.receipt { return verify_upgrade(...) }` path).

Because resume mutates a persistent workspace (unlike activation, which
always targets a fresh directory per phase), the new test uses two fully
independent `setup()` + `start_upgrade()` workspaces, one per phase, rather
than reusing one workspace across both phases in a loop the way the
activation test does.

Root wrote this change directly rather than dispatching a native worker:
the file is roughly 2000 lines, well past the point where a prior increment
this session found a worker correctly declining to re-transcribe a large
file rather than risk corruption, and root already had complete, exact
knowledge of the fix from tracing the fault call sites and the sibling
test's conventions directly. Root ran every completion-check command for
real before dispatching review: `cargo check` clean; the receipt module's
own test filter (`transform::receipt::tests`) at 11 passed (9 pre-existing
plus the 2 new); `cargo fmt --check` clean on the first attempt; the three
sibling integration suites that exercise the same public API
(`upgrade_activation`, `upgrade_receipts`, `upgrade_operational_drill`) at
15 passed combined. Independent review (`claude-fable-5-1`, high effort),
dispatched as a standalone hand-assembled request rather than through the
full workflow state machine, returned ACCEPT, correctly flagging that it
had no diff/shell access to independently confirm no other file changed;
`git status --short`/`git diff --stat` were checked directly and confirmed
exactly one file changed, purely additive (85 insertions). Committed to
`main` as `4b9c0218`; not pushed.

There are now four real-process-kill crash tests across both
schema-transition paths: the legacy path's activation (pre-existing) and
resume (this slice), and the v2-to-v3 draft's activation and resume (the
earlier crash-matrix section above). The legacy path's `start_upgrade`
step, and every fault phase on both paths not exercised by one of these
four tests, remain proven only under synthetic in-process injection.
ADR-0028 remains Proposed.

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

The current version marker, ordinary-open refusal and explicit legacy upgrade primitives are in
[`rocksdb.rs`](../../lib/oxigraph/src/storage/rocksdb.rs); public open and
backup entry points are in [`store.rs`](../../lib/oxigraph/src/store.rs).
ADR-0022 supplies backup/restore evidence and ADR-0020 supplies future durable
metadata identities. The bounded activation API/CLI does not close the remaining
G4.3 compatibility, older-binary rollback and frozen legacy-fixture/crash gates;
this ADR remains Proposed.
