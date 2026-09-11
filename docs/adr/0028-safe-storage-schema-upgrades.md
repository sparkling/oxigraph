# ADR-0028: Safe storage schema upgrades

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-11
- Deciders: Oxigraph parity programme
- Implementation status: native offline physical-metadata inspection API/CLI,
  unknown/newer-layout preflight, version-0/1 physical-backup API/CLI and inactive
  shadow-copy preparation and explicit inactive transformation APIs/CLI implemented;
  additive verified checkpoint/restart APIs and offline recovery CLI implemented;
  native build-bound inactive upgrade receipt APIs and CLI implemented for the bounded
  Linux/static Oxigraph/vendored RocksDB profile below.
  Ordinary writable open still performs known version-0/1 migrations in place.
  Full compatibility rejection, schema envelopes and
  explicit activation remain open
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
inspection or preflight at programme entry. The bounded slices below now add
physical backup ancestry, inactive construction, verified checkpoint restart
and a bounded build-bound receipt API; operator-controlled cutover remains
outstanding.
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
metadata identities. The bounded receipt API does not close the remaining G4.3
compatibility, activation/rollback and frozen legacy-fixture/crash gates; this
ADR remains Proposed.
