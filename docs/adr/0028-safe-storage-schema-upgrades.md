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
  backup-legacy/upgrade/explicit-cutover/source-preservation-and-older-
  binary-rollback/backup-with-receipt/restore, timed per stage with
  on-disk bytes summed, peak resident-set-size sampled, and read/write
  amplification ratios computed against each leg's own backup-receipt
  manifest, against the two checked-in legacy fixtures plus a synthetic
  5,000-quad size class for the restore leg (the legacy leg cannot be
  scaled the same way without a legacy-format writer, which this
  codebase does not provide). Rollback verifies both byte preservation
  and that the preserved source still backs up identically through
  `Store::backup_legacy`, the operation an older, legacy-only binary
  would run against it.
  Both upgrade paths' entry points now all have real OS-level process-kill
  coverage for at least one meaningful before/after durability boundary:
  the legacy path's start, resume and activation, and the v2-to-v3
  draft's construction/start (added this session, mirroring resume's and
  activation's existing fault-injection hook shape), resume and
  activation (five total, unchanged). Two more real-process-kill tests
  were added this session, closing a gap a fresh `current_exe` audit
  found: `prepare_upgrade` (the legacy path's offline shadow-copy
  preparation, upstream of and distinct from its three entry points) and
  `transform_inner` (the legacy path's explicit v0/v1 transformation,
  distinct from the combined `Store::upgrade` wrapper), both of which
  already had production fault-injection hooks but no real-process-kill
  test before this session. Every other fault phase on both paths
  remains proven only under synthetic in-process
  fault injection.
  The two real checked-in version-0/1 fixtures are now hash-pinned
  against a recorded constant, and `Store::inspect` is proven against
  them for the first time (byte-preservation and expected legacy
  version/status); `Store::open`/`open_read_only` refusal and
  non-mutation on these two fixtures were already covered.
  `inspect`/`open`/`open_read_only` are also now proven to refuse a
  physically corrupted MANIFEST (RocksDB's own checksum validation, not
  this crate's version logic) without further mutating the store, for
  both a legacy and current declared version, and proven NOT to
  misclassify genuine WAL loss the same way: a legacy store's own
  version-marker refusal still fires correctly and the store is not
  further mutated when its WAL is truncated. A corrupted SST footer
  (its fixed table magic number) is refused the same way as a
  corrupted MANIFEST, completing the physical-corruption trio.
  CI now exercises the RDF-feature-mismatch test (a no-default-features
  build correctly reports retained RDF 1.2 history as unsupported
  rather than misbehaving), closing gate 1's compatibility-rejection
  matrix in full.
  Envelope admission on ordinary open, full crash-matrix breadth beyond
  those five points, and the frozen qualification gates remain open
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

## Real OS-level process-kill coverage for the legacy upgrade start step (2026-09-16)

This completes real-process-kill coverage for all three of the legacy
version-0/1-to-2 path's public entry points: activation (pre-existing),
resume (previous section), and now `start_upgrade`.

`start_upgrade_inner`'s fault call sites, traced directly from source:
fault(0) right after the preflight file is written and synced, before the
nested `start_upgrade_recovery` call begins; fault(1) right after that
nested call completes, before the `INITIAL` progress record is computed;
fault(2) right after the `INITIAL` record is appended and the destination
directory is synced, immediately before the function returns.

The new test, `start_child_exits_immediately_before_and_after_initial_
progress_is_synced`, targets the fault(1)/fault(2) boundary -- the moment
the workspace either does or does not yet carry the durable `INITIAL`
progress marker `resume_upgrade_inner` needs to know where recovery left
off. Learning directly from the rdf-12 mistake earlier this session (an
unverified assumption caused a real runtime failure that had to be
diagnosed after the fact), root verified both phases' behavior empirically
by actually running the test rather than reasoning from source alone:

- **Phase 1** (killed after the nested `start_upgrade_recovery` call
  completes, before the `INITIAL` record is appended): a real kill leaves
  `PROGRESS_FILE` absent, and a subsequent `Store::resume_upgrade` on the
  same destination genuinely fails -- confirmed by running it. Independent
  review corrected root's own stated mechanism for this: root's goal text
  claimed `resume_upgrade_inner` fails via its later direct read of
  `PROGRESS_FILE`, but the reviewer traced it precisely to the earlier
  `scan_outer` call, which lists `PROGRESS_FILE` among its required files
  and returns `Err(InvalidManifest)` before the receipt/pending
  short-circuit is even reached. Same outcome the test correctly asserts;
  root's narrative description of *why* was imprecise, now corrected here.
- **Phase 2** (killed right after the `INITIAL` record is appended and
  synced): a real kill leaves a workspace indistinguishable from an
  ordinary completed `start_upgrade` call (the in-memory `workspace_lease`
  drop is skipped, but the underlying `flock` is released by the kernel on
  process exit either way); a subsequent `Store::resume_upgrade` completes
  the upgrade normally, confirmed by running it end to end to a sealed,
  independently verified receipt.

Root wrote this directly (same file as the previous section, ~2100 lines)
and ran every completion-check command for real: `cargo check` clean; the
receipt module's own test filter at 13 passed (11 prior plus the 2 new);
`cargo fmt --check` clean after one direct `cargo fmt` pass (one line
needed wrapping); the three sibling integration suites at 15 passed
combined. Independent review (`claude-fable-5-1`, high effort), again
dispatched as a standalone hand-assembled request, returned ACCEPT with
the mechanism correction above and confirmation the helper cannot pass
vacuously; `git status --short`/`git diff --stat` were checked directly
afterward and confirmed exactly one file changed, purely additive (83
insertions). Committed to `main` as `37e3f59d`; not pushed.

There are now **five** real-process-kill crash tests across both
schema-transition paths: the legacy path's activation, resume and start
(all three of its public entry points), and the v2-to-v3 draft's
activation and resume. Every fault phase on both paths not exercised by
one of these five tests remains proven only under synthetic in-process
injection -- most notably the v2-to-v3 draft's own `start`-equivalent step
(construction) has no real-process-kill test yet, unlike the legacy path
which now has full entry-point coverage.

Adding this would need a production-code change, unlike every crash test
so far this session: tracing `start_inner` in `schema_upgrade.rs` directly
found it accepts no injectable fault closure at all (unlike its siblings
`resume_inner`/`activate_inner`, and unlike the legacy path's own
`start_upgrade_inner`), so exercising it under a real kill would require
first adding fault-injection hooks to production code, not just a new
test. This is a legitimate future increment but a larger scope decision
than the test-only work completed so far, and is deferred rather than
folded into this run.

## Peak-memory sampling for the operational-gate drill, with a review-driven correction (2026-09-16)

The operational-gate design explicitly deferred peak-memory sampling out
of the first drill increment. This increment adds it: `peak_rss_kb()` in
`lib/oxigraph/tests/upgrade_operational_drill.rs` reads `/proc/self/
status`'s `VmHWM` (the kernel-tracked peak resident set size since process
start) after each drill run, printed alongside the existing duration and
disk-bytes measurements. It is deliberately best-effort (`Option<u64>`,
`"unknown"` on any read/parse failure) rather than using `?`, since this is
pure instrumentation with no threshold asserted anywhere -- a read failure
must never fail the drill's own correctness assertions.

That design choice was not precautionary boilerplate; it was earned during
development. Iterating with `--features rdf-12` (which runs both fixture
versions as concurrent test threads in one process) hit an intermittent
failure, roughly 1 run in 6: `Error: Os { code: 2, kind: NotFound }`.
Isolating the same test alone (`--test-threads=1`) never reproduced it.
Root's first hypothesis attributed this to the new `peak_rss_kb` read and
made it best-effort, which appeared to resolve it (nine further consecutive
runs all passed). Independent review accepted the change but raised a
well-reasoned, unresolved caveat: the isolation experiment showed only that
the failure was concurrency-dependent, not that `peak_rss_kb` specifically
was the cause, and a more plausible pre-existing mechanism was sitting in
the same file, unrelated to this increment -- `directory_bytes()` scans
`target`/`restore_target` via `read_dir` while their `Store` handles are
still open, and RocksDB may delete an obsolete WAL/OPTIONS file in a
background thread between a file being *listed* and *stat'd*: a classic
list-then-stat race, present since the first drill commit (`dab6050e`) and
unrelated to the memory-sampling code.

Root treated this as the real finding it was rather than a stylistic nit:
`directory_bytes()` now tolerates `NotFound` at exactly the two points
where that race would surface (`entry.file_type()` and `entry.metadata()`,
each contributing zero bytes for a raced-away file), while every other
`io::Error` at those points still propagates -- a permission or corruption
fault is not silently swallowed. The `peak_rss_kb` doc comment was
corrected to state only its best-effort design rationale, not an unverified
causal claim, and a nearby comment claiming the disk-bytes sum is always a
complete "measured peak" was softened to note it can now be marginally
understated when a file races away mid-scan. Root reverified with five more
consecutive concurrent runs (ten individual test passes) with no
recurrence, then dispatched a second review round specifically on the
adequacy of this response; it returned ACCEPT, correctly noting that five
(then a stated nine) additional clean runs are weak statistical evidence
against a roughly-1-in-6 flake on their own -- the fix is justified by the
race's own code-level plausibility, not proven by reruns, and the ADR
states it that way rather than as a confirmed root cause.

This is the second consecutive increment this session where independent
review caught something root's own framing got wrong -- not a logic bug in
the delivered code, but an unverified causal claim stated with more
confidence than the evidence supported. Both times, review returned ACCEPT
for the underlying change while still surfacing the issue, and root acted
on it as a real finding rather than a nitpick to argue past. All four
completion-check commands passed for real (`cargo check` clean; the
concurrent drill 5x with real `peak_rss_kb` values each run; `cargo fmt
--check` clean; the two directly relevant sibling suites at 14 passed
combined). Committed to `main` as `4e7aed1f`; not pushed.

This closes the peak-memory leg of the first operational-gate drill.
Read/write amplification and additional synthetic size classes beyond the
two checked-in fixtures remain the open operational-gate work; the
v2-to-v3 draft's construction step remains the one schema-transition entry
point without real-process-kill coverage (previous section). ADR-0028
remains Proposed.

## Read/write amplification for the operational-gate drill (2026-09-16)

The remaining open leg of the first drill increment was read/write
amplification. This adds two ratios to `drill()` in
`lib/oxigraph/tests/upgrade_operational_drill.rs`: physical bytes written
to disk for a leg of the journey, divided by the logical byte size the
relevant backup receipt's own file manifest declares
(`BackupFile::size()`, exposed via `LegacyBackupReceipt::files()` and
`BackupReceipt::files()` -- a manifest-recorded length, not a filesystem
stat). `legacy_write_amplification` covers backup-legacy + upgrade +
explicit-cutover against the legacy backup's manifest;
`restore_write_amplification` covers the with-receipt backup + restore
against that separate backup's own manifest. An earlier design note in
this ADR had assumed a `primary_bytes()` accessor existed "on the
relevant receipts" for this purpose; a direct check before writing any
code found that accessor only exists on the unrelated v2-to-v3
`SchemaUpgradeReceipt`/`SchemaUpgradeActivation` types, so `BackupFile`
manifests were used instead.

Repeated runs produced stable but sharply different ratios by fixture:
`legacy_write_amplification` is roughly 40.6x for the tiny plain fixture
(version 0) but only roughly 6.71x for the larger RDF-star fixture
(version 1), while `restore_write_amplification` holds at roughly 4.1x
for both. This is a real, plausible measurement, not a bug: the restore
leg's denominator is a checkpoint of a freshly built store, so it already
carries RocksDB's fixed per-instance overhead (OPTIONS/MANIFEST/LOG/WAL
files that exist regardless of content), whereas the legacy leg's
denominator is only the tiny fixture's own declared content -- so a fixed
overhead dominates a small fixture's ratio far more than a larger one's.
As with every other figure this drill reports, these are instrumentation
only: no threshold is asserted on either ratio, and the absolute values
are not claimed to be production-representative for real-sized stores.

Independent review of the first implementation (round 3 on this file)
returned ACCEPT but raised two findings worth fixing rather than noting
and moving on: `directory_bytes()` was being called twice per directory
(once building the existing `total_disk_bytes` figure, once building the
two new ratio numerators), which could let the two printed figures
disagree by a few bytes under the same RocksDB background-deletion race
`directory_bytes()` already tolerates (previous section); and the two new
`u64 as f64` casts could trip `clippy::cast_precision_loss` under a
stricter lint profile than this task's completion-check gate runs. Both
were treated as real findings: each of the six drill directories
(`source`, `legacy-backup`, `workspace`, `active`, `with-receipt-backup`,
`restored`) is now measured by `directory_bytes()` exactly once, bound to
a local, with both `total_disk_bytes` and the two ratios built purely
from those six bindings -- so the disk-bytes total and the amplification
ratios can never disagree with each other over the same race in a single
run. Each cast site now carries
`#[expect(clippy::cast_precision_loss, reason = "instrumentation ratio
only, not an exact count; byte totals here are far below f64's
exact-integer range")]`, matching this file's existing lint-suppression
convention. A fourth, focused review round on just this consolidation
confirmed it as a behavior-preserving refactor (same measurement point in
the sequence, same directory membership per total, no timer or assertion
moved) and returned ACCEPT with no blocking findings.

All four completion-check commands passed for real across this
increment's several re-verification passes (`cargo check` clean; three
more consecutive `--features rdf-12` concurrent drill runs after the
consolidation fix, all reporting the same stable ratios; `cargo fmt
--check` clean; the two directly relevant sibling suites at 14 passed
combined). Committed to `main` as `55fef554`; not pushed.

This closes the amplification leg of the first operational-gate drill.
Additional synthetic size classes beyond the two checked-in fixtures, and
the v2-to-v3 draft's construction step's missing real-process-kill
coverage (which needs a production-code change to `start_inner` to add a
fault-injection hook, deliberately deferred as a bigger scope decision
than ordinary test-only work), remain the open items. ADR-0028 remains
Proposed.

## A synthetic size class for restore-leg amplification, with a corrected ratio interpretation (2026-09-16)

The previous increment's open item was additional synthetic size classes.
This adds one, `SYNTHETIC_QUAD_COUNT = 5_000`, but only to the restore
leg: it operates on an arbitrary current-format `Store`, reachable
through the public `insert`/`extend` API, whereas the legacy leg
(backup-legacy/upgrade/cutover) needs a legacy-format writer that this
codebase deliberately does not provide -- nothing should intentionally
produce new data in an obsolete physical layout. `drill()` now builds a
`scaled` store holding a copy of `activated`'s quads plus 5,000 synthetic
ones, and backs that up (instead of `activated` directly) for the
restore leg. `legacy_write_amplification`'s four inputs are untouched by
this change.

Real observed values across three consecutive concurrent
(`--features rdf-12`) runs: `legacy_write_amplification` held at
40.86-40.88 (v0) / 6.72-6.73 (v1), a small but real shift from the prior
40.6/6.71 baseline. Independent review traced this precisely rather than
letting it stand as unexplained noise: the with-receipt backup's
checkpoint now runs against `scaled_store` instead of `activated`, so
`activated`'s own write-ahead log is no longer flushed by that checkpoint
before `target_bytes` is measured -- arguably a purer legacy-leg
measurement than before, not a regression. `restore_write_amplification`
dropped from the prior increment's ~4.1 (tiny fixture) to a stable 2.11
at the new ~5,000-quad scale.

That 2.11 figure needed a correction before being recorded here.
Root's working hypothesis, going in, was that the ratio should fall
toward 1x as content grows, reading 2.11 as still meaningfully above
that floor. Independent review caught that this framing does not match
the ratio's own definition: its numerator is `with_receipt_backup_bytes
+ restore_target_bytes` -- two full physical copies of the data (the
backup and the restored copy) -- divided by one logical copy in the
denominator, so the ratio's structural floor is approximately 2x, not
1x. Read against the correct floor, 2.11 is only about 5% above it,
meaning RocksDB's fixed per-instance overhead is nearly fully diluted at
5,000 quads -- a stronger confirmation of the fixed-overhead-dilution
hypothesis from the previous increment than the original framing
claimed, not a weaker one. This is corrected here rather than left as
originally framed.

Two more review-caught fixes were applied before committing, both small
but real: a strengthening assertion,
`scaled_quad_count == activation.quad_count() + SYNTHETIC_QUAD_COUNT`,
makes the copy-plus-grow claim test-enforced rather than
log-inferred (nothing had previously ruled out a silently-empty copy or
a namespace collision); and `directory_bytes`'s doc comment, which had
named only `target`/`restore_target` as directories scanned while their
store is open, now also names `scaled`.

This is the third consecutive increment on this one file where
independent review caught something in root's own framing -- not a
logic bug in the delivered code on any of the three occasions, but an
unverified causal claim (peak-RSS), a redundant-measurement risk
(amplification consolidation), or, this time, an incorrect ratio
interpretation stated with more confidence than the definition
supported. All three were treated as real findings and corrected, not
softened or argued past. All four completion-check commands passed for
real across this increment's re-verification passes (`cargo check`
clean; three consecutive `--features rdf-12` concurrent drill runs, all
reporting the same stable ratios and satisfying the new strengthening
assertion; `cargo fmt --check` clean; the two directly relevant sibling
suites at 14 passed combined). Committed to `main` as `955d5415`; not
pushed.

This closes the additional-size-class leg of the first operational-gate
drill. The v2-to-v3 draft's construction step's missing real-process-kill
coverage (needs a production-code change to `start_inner`, deliberately
deferred as a bigger scope decision than ordinary test-only work) is the
one remaining item from this stream of increments. ADR-0028 remains
Proposed.

## Real process-kill coverage for the v2-to-v3 construction step, closing the crash-matrix stream (2026-09-16)

The one item deferred from every earlier increment in this stream is
closed here: `start_inner` (the v2-to-v3 draft's construction/start step)
gains a fault-injection hook, mirroring the exact shape already used by
`resume_inner` and `activate_inner` in the same file
(`mut fault: impl FnMut(u8) -> Result<(), BackupError>` as the last
parameter) and by the legacy path's `start_upgrade_inner`
(`37e3f59d`, earlier this session). Two `fault()` calls bracket the
function's one durability-relevant write: `fault(0)` after the workspace
directory, its lease and its `attempts/` subdirectory are created but
before the `PLAN`/`JOURNAL` files are written; `fault(1)` after both
files are written and all three `sync_directory` calls complete,
immediately before the final recheck. `start_schema_upgrade`'s call site
gains one new trailing argument, `|_| Ok(())`, matching
`resume_schema_upgrade`'s own no-op default -- no other production
behavior changed.

A new real-process-kill test verifies both phases empirically, not from
reading source alone: killed before the plan is synced (phase 0), a
subsequent resume fails closed, traced precisely to `verify_workspace`'s
first step reading the not-yet-existent `PLAN` file; killed immediately
after (phase 1), an ordinary fresh resume completes the same upgrade to
a sealed, independently verifiable receipt. Both outcomes matched the
design on the first attempt, with no correction needed to make the
assertions fit reality -- consistent with the asymmetric crash-phase
pattern established earlier in this session (killing immediately before
vs. after a durability boundary produces genuinely different, both
individually correct outcomes).

Independent review (ACCEPT, 9 findings) caught one worth fixing before
committing: the phase-0 assertion checked only that resume returned an
error, not that the half-built workspace was left byte-unchanged,
unlike this file's other crash tests' identity-check convention. Fixed
by capturing the workspace's bytes right after the crash and asserting
them unchanged after the failed resume attempt; reverified (21/21 in
the full module).

The review also caught something in root's own framing, not the code: a
flake surfaced once, out of three full-module runs (21 tests,
`--features rdf-12`, run concurrently under `-j12`) --
`schema_upgrade_resume_child_exit_mid_copy_retains_a_resumable_attempt`
(a pre-existing test from an earlier commit, `518ccf16`, whose code path
this increment never touches) failed once with `Error: InvalidPath`,
then passed cleanly in isolation and on two full-module reruns with no
code changes in between. Root's goal text called this "definitively not
caused by this increment." Review correctly pointed out that this
overstates what was actually established: the exact call site producing
`InvalidPath` was never root-caused, and the same flake was never run
against the pre-change tree under identical concurrent load to rule out
a pre-existing timing sensitivity independent of this increment. What
*is* established is narrower and is the accurate claim: the failing
test's own code path was not modified by this change, and the flake did
not recur across two further full-module runs. This is the fourth
increment this session where independent review caught root's own
framing overclaiming what the evidence actually supported, rather than
a defect in the delivered code -- again treated as a real finding and
corrected in this record, not argued past.

Reported check results across this increment's verification: `cargo
check` clean; the new test passed in isolation (both phases genuinely
exercised); the full 21-test module passed three times total (one
unrelated flake, two clean runs); `cargo fmt --check` clean. Committed
to `main` as `c7e30451`; not pushed.

This closes the crash-matrix stream begun with the legacy path's three
public entry points and the v2-to-v3 draft's resume/activation: all five
of this session's schema-transition entry points across both upgrade
paths now have real OS-level process-kill coverage for at least one
meaningful before/after durability boundary. Full crash-matrix breadth
beyond these five points and the frozen compatibility/crash/system-RocksDB
qualification matrix remain separately tracked, out of ordinary-delivery
scope. ADR-0028 remains Proposed.

## Older-binary rollback verification in the operational drill (2026-09-16)

Gate 4's remaining named requirement, "older-binary rollback to
preserved source," is closed here. The drill's rollback stage previously
proved only that the preserved source's bytes were unchanged (a
file-path/SHA-256 inventory comparison) -- a real but narrow guarantee,
since bytes being untouched does not by itself prove the source is still
usable. This increment adds a second, functional check inside the same
timed rollback stage: after the existing inventory-equality assertion,
the drill re-runs `Store::backup_legacy` against the preserved source --
the same public operation an operator falling back to an older,
legacy-only binary would run -- into a fresh `rollback-legacy-backup`
directory, and asserts the resulting receipt's `fingerprint()` (a hash
over `storage_version`, `database_id`, `rocksdb_sequence`,
`column_families` and every file's name/length/SHA-256) equals the very
first legacy backup receipt's own fingerprint, taken before any upgrade
work began. This is not a self-comparison: the two receipts come from
two independent `Store::backup_legacy` calls, bracketing the entire
backup+upgrade+cutover+restore journey. `rollback_legacy_backup`'s
directory bytes are added to `total_disk_bytes` only, deliberately
excluded from `legacy_write_amplification`'s inputs, matching how
`scaled_bytes` was handled in an earlier increment.

Real observed values across two consecutive concurrent
(`--features rdf-12`) runs: the new fingerprint assertion held on every
run for both fixture versions. `legacy_write_amplification` (40.61/6.71)
and `restore_write_amplification` (2.11) held exactly at the
pre-increment baseline, confirming the new leg does not perturb either
ratio's inputs -- the rollback stage's own duration grew from
single-digit milliseconds to 10-55ms, expected since it now performs a
full second legacy backup rather than only an inventory scan.

Independent review returned ACCEPT with no blocking findings. All
completion-check commands passed for real: `cargo check` clean; two
consecutive concurrent drill runs (4/4 passes); `cargo fmt --check`
clean; the two directly relevant sibling suites at 14 passed combined.
Committed to `main` as `278947d0`; not pushed.

This closes the older-binary-rollback leg named in gate 4. The
operational-gate drill for the legacy path now measures duration, disk
bytes, peak RSS, read/write amplification at two size classes, and
older-binary rollback capability. Remaining open gate-4 work is limited
to frozen size classes and supported-version windows, tracked separately
under the frozen qualification matrix; gate 1's full compatibility
rejection (needing hash-pinned v0/v1/current/missing/corrupt/too-new/
RDF-feature-mismatch/interrupted fixtures) and envelope admission on
ordinary open remain open, larger, more foundational pieces of work.
ADR-0028 remains Proposed.

## Hash-pinning the real legacy fixtures, with a collision-resistance correction (2026-09-16)

Gate 1's compatibility-rejection matrix names "hash-pin version-0,
version-1... fixtures" as still required. Before writing anything, the
existing coverage of the two real checked-in legacy fixtures
(`rocksdb_bc_data`, version 0; `rocksdb_bc_rdf_star_data`, version 1)
was read rather than assumed: `Store::open`/`open_read_only` refusal
(`UpgradeRequired`) and non-mutation were already proven against both,
by the existing `copy_backward_compatibility_fixture` helper in
`lib/oxigraph/tests/store.rs`. Two things were genuinely missing, found
by grep: `Store::inspect` (the format-inspection metadata API) was
tested nowhere against these two real fixtures, only against synthetic
directories elsewhere; and neither fixture's exact bytes were pinned
against a recorded constant, so silent corruption or replacement of a
checked-in fixture would only be caught if it happened to also break
some other content assertion.

This adds `fixture_hash()`, a deterministic hash over each fixture's
sorted `(path, content)` file pairs, and two recorded hash-pin
constants computed by a standalone throwaway program implementing the
same scheme against the current checked-in fixture bytes. One new test
copies each fixture fresh, asserts its hash-pin first, calls
`Store::inspect` and asserts the expected legacy `storage_version` and
`version_status`, then re-hashes and asserts the fixture is still
byte-identical -- closing the `Store::inspect` gap in the same test
that adds the pin.

The first implementation separated each `(path, content)` pair with a
single NUL byte and no length information. Independent review caught
that this is not strictly injective: RocksDB's binary SST/MANIFEST/
OPTIONS file content routinely contains NUL bytes, so a NUL inside one
file's content could in principle be read back as a path/content
boundary under a different split, letting two different file sets hash
identically -- exactly the property a hash-pin exists to rule out. This
was treated as a real finding, not a theoretical nit to wave past:
fixed by writing each path's and content's byte length as an 8-byte
little-endian `u64` before its bytes, with no separators at all, which
a second review round confirmed is genuinely unambiguous for any byte
values. Both hash-pin constants were regenerated under the corrected
scheme via the same throwaway program, run again against the current
fixture bytes.

Verified via `cargo check`; the new test passing alongside
`test_verified_transformed_copy_is_ordinary_openable` (the hash-pin
assertion runs first per fixture, so a transcription error in either
regenerated constant would fail immediately, not pass silently); and
`cargo fmt --check` at full-crate scope. Committed to `main` as
`c186936f`.

This is the fifth increment this session where independent review
caught something worth fixing in root's own delivered work rather than
just noting it -- this time a genuine, if narrow, correctness gap in
the hash-pin's own design (an encoding collision), not an overclaim in
prose. Gate 1's compatibility-rejection matrix remains open beyond
this: the current/missing/corrupt/too-new/RDF-feature-mismatch/
interrupted fixture types named in the same requirement are not yet
built, and remain a larger, separately-scoped piece of work. ADR-0028
remains Proposed.

## Proving corrupted-MANIFEST refusal, with an xhigh-effort review of RocksDB's own on-disk format (2026-09-16)

Gate 1 names "corrupt" as a required fixture type. Auditing existing
coverage first (as scoped in the prior increment) found every existing
test exercises marker-level or column-family-level irregularities via a
synthetic store -- none damages actual physical file bytes, a distinct
failure surface from this crate's own version-classification logic.

Rather than assume what error that surfaces as, a disposable, untracked
exploration test (never committed) copied the real `rocksdb_bc_data`
fixture and corrupted it several ways, printing the actual
`StorageError` returned. Findings: flipping or truncating a fresh
store's MANIFEST makes `Store::inspect`/`open`/`open_read_only` all
return `Err(StorageError::Corruption(_))`, for both a legacy and
current declared version, since RocksDB's own MANIFEST validation runs
before any column family or key is reachable -- this crate's version
logic cannot run at all. By contrast, truncating the WAL alone left
`inspect` unaffected and `open` still correctly refusing a legacy
layout with `UpgradeRequired`, since WAL replay is not part of the
preflight path these APIs take.

The new test, following this file's own synthetic-fixture convention
rather than the real checked-in fixture (the property under test --
RocksDB's own checksum validation -- doesn't depend on real fixture
content), corrupts a fresh store's MANIFEST for both a legacy and
current version and proves all three APIs refuse it with
`StorageError::Corruption(_)` while leaving the store byte-unchanged.

Following the standing instruction from earlier this session to use
higher review effort for anything touching a new design or correctness
property, this was the first review dispatched at `xhigh` rather than
`high`. The difference was visible in the result: the review worked out
RocksDB's own MANIFEST log-record format (length-prefixed records, each
CRC32C-protected, a single sub-32-KiB block for a fresh store) to verify
from first principles that a mid-file byte flip would necessarily land
on checksummed bytes -- reasoning a shallower pass would not have
attempted. It returned ACCEPT with no blocking findings, but surfaced a
real, if dormant, test-fragility risk: a short flip could in principle
land entirely inside a record's length-prefix field, which RocksDB's
tail-tolerant log reader can absorb as a truncated tail instead of
reporting corruption -- the review confirmed this would make the test
fail loudly rather than pass falsely, and that the flip's current
position already avoided it, but recommended removing the dependency on
exact record boundaries. Treated as worth fixing rather than noting:
widened the flip from 20 bytes to the entire second half of the file,
guaranteeing the corruption overlaps multiple records regardless of
where their boundaries fall. Reverified after the change.

All completion-check commands passed for real: `cargo check` clean; the
new test passing both before and after the widening; the full
`format_inspection_tests` module (8 passed, 1 pre-existing ignored test
unrelated to this change) twice; `cargo fmt --check` at full-crate
scope. Committed to `main` as `1d6aa2d1`.

This is the sixth increment this session where independent review
surfaced something worth acting on. Gate 1's compatibility-rejection
matrix remains open beyond this: current, missing, too-new and
RDF-feature-mismatch already have solid synthetic coverage found during
this stream's own auditing (not new gaps); the interrupted-workspace
case is covered elsewhere (crash-matrix work, `upgrade_inspection_tests.rs`);
what remains genuinely unbuilt is deeper corruption coverage beyond the
MANIFEST (WAL, SST-level corruption) and the RDF-feature-mismatch test's
dependency on a separately-built no-default-features CLI, both larger,
separately-scoped pieces of work. Envelope admission on ordinary open
remains a deliberate product decision, not ordinary-delivery scope.
ADR-0028 remains Proposed.

## A truncated-WAL test that initially proved nothing, caught and fixed across two review rounds (2026-09-16)

The natural complement to the corrupted-MANIFEST test is a corrupted-WAL
test: WAL damage should not be misclassified as `Corruption`, nor should
it block the ordinary legacy-marker refusal. The first version built a
synthetic legacy store (the same `GRAPHS_CF`-omitted shape used
elsewhere in this file), flushed it, truncated every `.log` file found,
and asserted the usual three-way refusal plus non-mutation. It passed.

Independent review rejected it. The truncated WAL segment was the one
written *before* the flush; once that flush durably persists the data
to an SST, RocksDB does not need that WAL segment for recovery, so
truncating it plausibly discarded nothing load-bearing -- the test's
central premise, that WAL damage was genuinely present, was very likely
false, even though the file itself was non-empty (a printed byte count
confirmed this directly: one flushed-and-superseded 95-byte segment, one
empty new one). Review separately caught a real factual error in the
doc comment: "never replaying the log" is wrong. RocksDB replays the WAL
on every open, including read-only opens; a truncated tail is tolerated
under the default point-in-time recovery mode, not skipped.

Both were treated as real findings. The fix inserts one more key
*after* the flush and drops the database without flushing again, so
that key exists only in the post-flush WAL segment -- verified before
relying on it that `Db` has no `Drop` implementation that forces a
flush. Truncating that segment now genuinely discards recoverable data.
A non-empty guard on every `.log` file before truncation was added,
which would have caught the original defect had it been present. The
doc comment was corrected to state the real mechanism. A second review
round confirmed the fix against RocksDB's actual close and recovery
semantics, with no blocking findings -- it did note, fairly, that the
delivery description's "everything else unchanged" claim missed one
small removed comment (four lines that had encoded the first version's
now-invalid reasoning); worth recording here as a precision lapse in
reporting the diff, not a code defect.

Verified via `cargo check`; the targeted test passing with the new
guard genuinely exercised (not vacuously true); the full
`format_inspection_tests` module (9 passed, 1 pre-existing ignored test
unrelated to this change); `cargo fmt --check` at full-crate scope.
Committed to `main` as `0180d145`.

This is the seventh increment this session where independent review
surfaced something worth acting on, and the first where round 1 caught
the delivered test proving nothing at all -- not an overclaim in prose,
not a design gap around the edges, but a passing test whose central
premise was false. It was caught the same way as everything else this
session: verified empirically (the printed byte counts), fixed for the
real reason, and re-reviewed before committing. Gate 1's compatibility
matrix now covers both the "corruption is real damage" and "WAL loss
isn't corruption" cases for the legacy layout. What remains genuinely
unbuilt: SST-level corruption coverage and the RDF-feature-mismatch
test's dependency on a separately-built no-default-features CLI, both
larger, separately-scoped pieces of work. ADR-0028 remains Proposed.

## Completing the physical-corruption trio: a corrupted SST footer (2026-09-16)

The third and final leg of gate 1's physical-corruption coverage,
alongside the MANIFEST and WAL tests above: a corrupted SST file.

Grounded empirically first, in two rounds, via a disposable exploration
file (deleted, never committed): flipping roughly 50 arbitrary mid-file
bytes in an SST produced no error at all, from `inspect`, `open`,
`open_read_only`, or even a full scan of every inserted quad. The
corrupted bytes had landed in the properties block, whose read and
checksum failures RocksDB deliberately ignores as warning-only rather
than fatal. Flipping the last 60 bytes instead -- the table footer,
48 or 53 bytes depending on format version, always ending in a fixed
magic number that every table open validates before any block checksum
is consulted -- reliably produced `StorageError::Corruption` with a
"Bad table magic number" message from all three APIs, including
`inspect`, even though `inspect` opens with an empty explicit
column-family list: the one SST in this fixture belongs to the default
column family, which every open must include regardless of which other
families the caller explicitly requests.

The new test mirrors the MANIFEST test's structure exactly, reusing the
same two-key `Db::open_read_write` + flush fixture the MANIFEST and WAL
tests already depend on, for both a legacy (`GRAPHS_CF` omitted) and
current declared version. Independent review at `xhigh` effort worked
out RocksDB's exact footer byte layout across format versions and the
table-preload path in `VersionSet::Recover` from first principles to
confirm the corruption model was sound, not coincidental -- and
returned ACCEPT with no blocking findings. It did flag, correctly, that
this session's own review-request prompt text had briefly overstated
the scope of the finding ("every SST the MANIFEST references") beyond
what the actual committed doc comment claims; the doc comment itself
was independently confirmed as accurately scoped, so no code change was
needed.

Verified via `cargo check`; the targeted test passing for both version
iterations; the full `format_inspection_tests` module (10 passed, 1
pre-existing ignored test unrelated to this change); `cargo fmt --check`
at full-crate scope. Committed to `main` as `44aab5d5`.

This closes the physical-corruption trio: MANIFEST, WAL and SST damage
are each now proven to either correctly refuse (MANIFEST, SST) or
correctly not be misclassified as refusal-blocking corruption (WAL),
for both a legacy and current declared version, without further
mutating the store. What remains in gate 1's compatibility matrix: the
RDF-feature-mismatch test's dependency on a separately-built
no-default-features CLI (build/CI infrastructure, not test-writing).
ADR-0028 remains Proposed.

## Wiring the RDF-feature-mismatch test into CI (2026-09-16)

The last remaining item in gate 1's compatibility matrix was not
another fixture or corruption case, but build/CI orchestration: a test,
`rdf_12_writer_retained_history_is_reported_unsupported_by_no_default_cli`,
already existed and already proved the right thing -- an operator
running a build without `rdf-12` support, against a store containing
data only a build with `rdf-12` could have written, gets an honest
`FeatureIncompatible`-style report rather than silent misbehavior --
but it was `#[ignore]`d, requiring a separately-built no-default-features
CLI that nothing in ordinary CI produced.

The subtlety, worth stating plainly: the test function is itself
`#[cfg(feature = "rdf-12")]`, because it needs to *construct* RDF-1.2
data in-process before checking that a *different* binary can't
understand it. That means two different feature sets for two different
build artifacts sharing one workspace `target/` directory -- the test
binary compiled *with* `rdf-12`, and the separate `target/debug/oxigraph`
CLI binary it subprocess-invokes compiled *without* it. This was
verified locally, command by command, before touching CI: build the CLI
with `--no-default-features`, then run the ignored test with
`--features rdf-12`, and confirm the second command does not rebuild or
otherwise disturb the artifact the first one left behind. It didn't.

Two steps were added to the end of CI's existing `test_rdf_no_default_features`
job, replaying that exact verified sequence. Independent review (round
1, REJECT) caught a real editing mistake: an `Edit` call meant to be a
pure append had silently relocated the pre-existing CLI step's
`working-directory: ./cli` key onto the new final step instead, both
changing that pre-existing step's behavior (it would have run from the
repository root instead of `./cli`) and running the new step from the
wrong directory -- a class of mistake a syntactic YAML-validity check
cannot catch, since the result still parsed cleanly. Confirmed directly
with `git diff` against the last committed version before accepting the
finding. Fixed by restoring the key to its original step and leaving
the two new steps with no override; a second `git diff` confirmed the
whole changeset was then a genuinely pure four-line append. Round 2 of
review (ACCEPT, no blocking findings) confirmed the fix. The test's own
`#[ignore]` attribute is unchanged -- ordinary, non-CI runs still
correctly skip it -- only its message was extended to note where it is
now exercised.

Verified via two full local runs of the exact CI sequence from the
repository root; `cargo check`; the full `format_inspection_tests`
module (10 passed, 1 still correctly ignored in the ordinary
invocation); `cargo fmt --check`; YAML syntax validation. Committed to
`main` as `223b3096`.

This closes gate 1's compatibility-rejection matrix in full: current,
missing, too-new, corrupt (MANIFEST/WAL/SST), and RDF-feature-mismatch
are all now proven, the two real checked-in legacy fixtures are
hash-pinned, and `Store::inspect` is covered against them for the first
time. Ninth consecutive increment this session where independent review
surfaced something worth acting on, and the second (after the WAL test)
where the finding was a real defect in root's own delivered work rather
than a framing overclaim -- this time in build orchestration rather than
test logic. Envelope admission on ordinary open remains a deliberate
product decision, out of ordinary-delivery scope; the frozen
compatibility/crash/system-RocksDB qualification and promotion matrix
remains a separate evaluator-authority track. ADR-0028 remains Proposed.

## Real OS-level process-kill coverage for legacy offline preparation (2026-09-16)

With gate 1 (inventory and inspection) closed, this increment moved into
gate 2's territory: not the "still required" frozen full-matrix language
in the delivery-gates checklist, which is not directly closeable in one
ordinary-delivery increment, but a concrete, well-precedented, low-risk
slice within it. A fresh code-level audit (not assumption) of
`prepare_inner` and `transform_inner`, both already carrying
production-code fault-injection hooks with public wrappers passing
`|_| Ok(())`, found zero existing real-process-kill test for either,
confirmed by grepping every use of `current_exe` in
`lib/oxigraph/src/store/*.rs` and `lib/oxigraph/tests/*.rs`. This is the
same category of gap this session already closed for the legacy path's
three public entry points and the v2-to-v3 draft's construction/start
and resume: a fault phase proven only by an injected Rust-level `Err`,
never by an actual OS process death.

`prepare_inner` (the offline shadow-copy preparation this crate's own
doc comment distinguishes from transformation, resume and activation)
has five numbered fault phases. Its own inline `#[cfg(all(test, unix))]
mod tests` submodule -- the only place with access to the private
function, unlike the external `lib/oxigraph/tests/upgrade_preparation.rs`
integration test -- already exhaustively covers all five phases with
synthetic in-process closures, but none with a real kill. The most
consequential single boundary is phase(3)/phase(4): phase(3) fires
after the PENDING marker is written and fsync'd but strictly before
`fs::rename(PENDING, COMPLETE)`; phase(4) fires strictly after that
rename has already returned.

The new test,
`preparation_child_exits_before_and_after_the_completion_rename`,
re-invokes the same test binary via `std::process::Command::new(
std::env::current_exe()?)` targeting one helper `#[test]` that calls
the real private `prepare_inner` with a fault closure that calls
`std::process::exit(73)` at a requested phase -- the exact pattern
already established and reviewed this session in
`schema_upgrade_tests.rs`, with a fresh file-local, non-colliding copy
of the `helper()`/`crash()`/`variable()` trio (distinct
`OXIGRAPH_UPGRADE_PREPARE_TEST_` env var prefix, since both files
compile into the same `--lib` test binary). A real kill at phase(3)
leaves the workspace exactly as refused, unopenable and verify-failing
as this same module's own existing synthetic test already proves at
the same phase (`failures_before_completion_preserve_both_inputs_and_
refuse_preparation`, `stop == 3`). A real kill at phase(4) leaves
`COMPLETE` already visible in the directory -- the rename already
returned before phase(4) is invoked in production code -- matching the
existing synthetic `post_marker_failure_or_cancellation_is_
indeterminate_and_verifiable` test's own phase-4 case, but now proven
against a genuine kernel-level process death rather than an early
Rust return.

The phase-4 comment is worded carefully to claim only what a process
kill actually proves: the marker is visible in the directory, not that
it is durable across a further power loss. That distinction matters --
it is exactly why `prepare_inner` maps any failure in that window to
`BackupError::CompletionIndeterminate` rather than treating the visible
rename as fully complete, and the production doc comment already says
so. An earlier draft of this test's comment overclaimed "durable"/"on
disk"; independent review caught this and it is corrected here before
it was ever committed.

Independent review (`claude-fable-5-1`, xhigh effort, two rounds) caught
one real, confirmed defect: the new `crash()` function signature was
101 columns, one over rustfmt's default `max_width = 100`, so `cargo fmt
-p oxigraph -- --check` should have reported a diff. It did -- and root's
own round-1 completion-check claim of "FMT EXIT: 0" was itself wrong: a
hardcoded echo string, not an actual `$?` capture from the piped `cargo
fmt` invocation, so the check had never really been run. This is the
tenth consecutive increment this session where independent review
surfaced something worth acting on, and the third (after the WAL test
and the CI-wiring working-directory mistake) where the finding was a
real defect in root's own delivered work or its own verification claim,
not a framing overclaim. Fixed by running `cargo fmt -p oxigraph`
directly and re-checking its exit code correctly (redirecting to a file
before reading `$?`, never piping first). Round 1 also flagged the test
name implying a directory fsync that phase 4 never waits for (renamed
to `..._completion_rename`) and an unverified "zero clippy warnings"
claim; the corrected account confirmed the two new tests trip the same
pre-existing lint pattern (`tests_outside_test_module`, likely because
that lint only recognizes a bare `cfg(test)`, not `cfg(all(test,
unix))`) as all four pre-existing tests in the same module already do,
not a new category or regression, and confirmed a genuinely unrelated,
pre-existing `oxhttp` dependency clippy failure via a `git stash`/pop
comparison against the unmodified baseline. Round 2: ACCEPT.

`cargo test --locked -p oxigraph --lib -- "store::upgrade::tests"
--test-threads=1` passes all six tests in the module (four pre-existing
plus the two new ones); `cargo fmt -p oxigraph -- --check` genuinely
exits 0; `git diff lib/oxigraph/src/store/upgrade.rs | grep -c '^-[^-]'`
confirms zero lines removed from the last commit, a pure append.
Committed to `main` as `f78de51a`; not pushed. `prepare_upgrade` is this
ADR's own offline shadow-copy step, distinct from `backup_legacy`
(covered under ADR-0022's separate backup/restore evidence, not this
crash-matrix stream) and from the combined `Store::upgrade` convenience
wrapper (which only composes the already-covered `start_upgrade` and
`resume_upgrade`, adding no new durability boundary of its own). The
legacy path's own explicit v0/v1 `transform_inner` (a distinct step
from `Store::upgrade`'s combined start/resume pair, addressed next) and
the frozen qualification/crash matrix beyond these six points remain
open, tracked separately below and in the delivery-gates checklist.

## Real OS-level process-kill coverage for legacy transformation, closing the pair (2026-09-16)

`transform_inner` (the legacy version-0/1 explicit transformation step,
distinct from the combined `Store::upgrade` wrapper, which only
composes the already-covered `start_upgrade` and `resume_upgrade`) was
the second function this session's `current_exe` audit identified with
production fault-injection hooks and zero real-process-kill coverage --
the same grep, re-run after the previous section's `prepare_inner`
change, confirmed it as the one remaining gap of this specific kind.

Its structure is an exact architectural mirror of `prepare_inner`, one
phase index higher: 7 numbered fault phases (0 through 6), already
exhaustively covered synthetically by this module's own existing
`upgrade_fault_boundaries_preserve_inputs_and_keep_all_leases_until_return`
test (`stop in 0..=6`). `fault(5)` fires after `TRANSFORM_PENDING` is
written and fsync'd but strictly before `fs::rename(TRANSFORM_PENDING,
TRANSFORM_COMPLETE)`; `fault(6)` fires strictly after that rename has
already returned, mapped through `indeterminate()` exactly like
`prepare_inner`'s `fault(4)`.

The new test, `transform_child_exits_before_and_after_the_completion_
rename`, applies the identical pattern just reviewed and accepted for
`prepare_inner`: re-invoke this same test binary via
`std::process::Command::new(std::env::current_exe()?)` targeting one
helper `#[test]` that calls the real private `transform_inner` with a
fault closure calling `std::process::exit(73)` at a requested phase.
Fresh file-local `helper()`/`crash()`/`variable()` trio, with a
distinct `OXIGRAPH_UPGRADE_TRANSFORM_TEST_` env var prefix (this
crate's `--lib` test binary now carries three such prefixes across
three files, none colliding). A real kill at stop=5 leaves the
workspace exactly as refused and verify-failing as the existing
synthetic test already proves at the same phase; a real kill at stop=6
leaves `TRANSFORM_COMPLETE` already visible in the directory, matching
that same test's own stop=6 case. Both stops also assert the
unconditional `Store::open(prepared.join("store"))` =>
`UpgradeIncomplete` check the existing test makes regardless of stop --
transformation completing does not activate the workspace -- and that
every native lease (source, package/store, prepared/store) is available
again after the real process death, since the kernel releases an
`flock` on exit whether or not any Rust destructor ran.

Learning directly from the previous section's own round-1 mistake
(a hardcoded `echo "FMT EXIT: 0"` standing in for a real `$?` capture),
every completion-check command this time redirected output to a file
first and read `$?` separately, never piped into `head`/`tail`/`grep`
before reading the exit status, and a direct `awk 'length($0) > 100'`
line-length check was run before ever claiming `cargo fmt --check`
passed, learning from that same round's specific 101-column defect.
`cargo test --locked -p oxigraph --lib -- "store::upgrade::transform::
tests" --test-threads=1` passes all six tests in the module (four
pre-existing plus the two new ones); `cargo fmt -p oxigraph -- --check`
genuinely exits 0 with zero lines over 100 columns; `git diff
lib/oxigraph/src/store/upgrade_transform.rs | grep -c '^-[^-]'`
confirms zero lines removed, a pure append; the two new tests trip the
same pre-existing clippy lint pattern as this module's four pre-existing
tests, not a new category.

Independent review (`claude-fable-5-1`, xhigh effort): **ACCEPT on the
first round**, the first single-round accept for a real-process-kill
test this session (every prior one needed at least one REJECT/fix
cycle). The review traced production code directly to confirm phases 5
and 6 are only reachable at their exact `fault(5)`/`fault(6)` call
sites -- the `transform_upgrade` callback's own phase range (`edge + 1`
for `edge` in the receipt's starting version through 2) can only yield
phases 1 through 3, so a real exit-73 at stop=5 or stop=6 cannot be a
false positive from an earlier, unrelated crash point. Two minor,
non-blocking prose inaccuracies were noted in root's own goal text (a
miscounted "five pre-existing tests" where the module has four, and an
imprecise description of which baseline the package-hash comparison
uses) -- neither affecting correctness, both left as reported since the
review itself judged them non-blocking.

Committed to `main` as `7554a79c`; not pushed. This closes the pair of
fault-injection-hooks-but-zero-real-kill-coverage gaps this session's
`current_exe` audit identified (`prepare_inner`, previous section, and
now `transform_inner`); the frozen qualification/crash matrix beyond
what these real-process-kill tests cover remains open, tracked
separately below and in the delivery-gates checklist. This is not a
claim that every fault phase on either schema-transition path now has
real-process-kill coverage -- only that the specific gap this session's
audit found (a function with production fault-injection hooks and zero
real-kill test) is now closed for both functions identified.

## Auditing gate 3 for the next tractable slice, and why disk-exhaustion testing is deferred (2026-09-16)

With both functions from the previous two sections' `current_exe` audit
closed, this tick searched for a new well-scoped, low-risk slice by
reading gate 3's actual current test coverage rather than assuming its
"still required" wording was accurate -- the same audit-before-building
discipline that found gate 1's stale text earlier this session.

Checked each of gate 3's four named sub-items against the real test
suite, not from memory: **fresh-process open/validate** is covered
(`fresh_process_verifies_same_executable_and_rejects_appended_copy` in
`lib/oxigraph/tests/upgrade_receipts.rs`); **tampering** is covered
extensively across receipt/journal/manifest/extra-file cases; **crash/
power-loss** is covered extensively -- `lib/oxigraph/src/store/
upgrade_resume.rs`'s own `spawn_cut` helper already re-invokes the test
binary across many phases, edges and occurrences for both the recovery
workflow's start and resume paths, well beyond this session's two new
single-boundary tests for `prepare_inner`/`transform_inner`; **path
substitution** is covered where it matters most -- `activate_upgrade`'s
own production code (`lib/oxigraph/src/store/upgrade_receipt.rs`)
explicitly canonicalizes the destination's parent specifically because
`fresh_destination` would otherwise follow a symlink ancestor, and
`lib/oxigraph/tests/upgrade_activation.rs` tests exactly this. None of
these four is claimed as an exhaustive per-entry-point matrix; each has
concrete, real coverage this tick confirmed by reading the tests
directly, not by inference.

The one item confirmed to have zero coverage, **insufficient-disk
checks**, was investigated as this tick's own candidate increment. A
real disk-exhaustion test needs a size-bounded filesystem the operation
can genuinely fill; the standard unprivileged approach (a small tmpfs
mounted inside a user+mount namespace, requiring no root) was tried
directly in this session's own container and failed closed: `unshare
--user --mount --map-root-user ...` returns `write failed
/proc/self/uid_map: Operation not permitted`, meaning unprivileged user
namespaces are disabled here. This rules out the standard approach
without inventing an untested, riskier alternative (an `RLIMIT_FSIZE`-
based child helper would need a new `libc`/`rlimit` dependency this
crate does not currently have, a larger and less surgical change than
anything else this session has done). Confirmed empirically, not
assumed, before deciding not to pursue it this tick.

Rather than force a speculative test into gate 3's territory or spend
further tick time chasing an infrastructure-blocked target, this tick's
concrete output is a corrected delivery-gates row: gate 3's "still
required" column previously implied all four named sub-items were
substantially open, which this audit found inaccurate for three of the
four (they have real, if not exhaustive, coverage); the accurate
remaining gaps are the evaluator-authority-scoped "complete feature/
subsystem/cursor identities and exact-receipt independent
qualification" (an independent re-implementation comparison, not an
ordinary-delivery test) and insufficient-disk checks specifically,
now with the infrastructure blocker recorded rather than left silently
absent. This mirrors gate 1's own earlier correction this session: a
"still required" column can drift stale exactly like a "proven"
column can, and both need re-verification against the real test suite
before being trusted.

## Read-ratio instrumentation for the operational drill, with two review rounds catching a measurement flaw and a code/comment mismatch (2026-09-16)

Gate 4's row lists "duration, peak disk, peak memory, read amplification
and write amplification" as still required, but a fresh check found the
operational-gate drill (`lib/oxigraph/tests/upgrade_operational_drill.rs`,
implemented earlier this session) already measures the first four --
the delivery-gates row simply never linked to it. Read amplification
was the one genuinely missing figure.

The first attempt added a single `read_bytes`-based measurement,
mirroring write amplification's own physical-bytes-over-logical-bytes
definition. Round 1 review rejected it on a real conceptual flaw, not a
wording issue: every input each leg reads was written or copied by this
same process moments earlier, so those reads are ordinary Linux
page-cache hits that never reach the block device -- `read_bytes`
reports near zero for such a leg regardless of how much it actually
read, and this session's own "write-dominated" explanation of that near
zero was simply wrong (`restore_backup` obviously has to read the whole
backup it copies). The fix adds a second, complementary counter, `rchar`
(logical bytes passed through `read`/`pread`/`copy_file_range`
regardless of cache hit or miss), reported alongside the physical
figure as two ratios rather than one conflated "amplification" number.
Extracting the shared ratio computation to a function surfaced a
genuinely new `clippy::items_after_statements` warning (it had been a
closure defined mid-function); resolved by hoisting it to a top-level
helper, matching this file's own existing convention.

Round 2 confirmed the two-counter design was a real fix, not a relabel,
but caught a follow-on defect: the doc comment claimed `ratio()` reports
`"unknown"` both when a sample is missing and when concurrent I/O
contaminates the window, but the code only ever checks for a missing
sample -- concurrent contamination is silent and inflates the delta
instead. The same class of inaccuracy round 1 rejected on, correctly
held to the same bar. Also flagged, and fixed in the same pass since
each was precise and low-cost: an untested tmpfs "exactly zero"
absolute (swapped-out tmpfs pages are read back through the block layer
and do count), a wrong claim that RocksDB spawns threads per `Store`
rather than sharing one per-`Env` pool, and an unsupported "plausible"
interpretation of a real, disclosed anomaly -- the two legacy fixtures'
own `legacy_logical_read_ratio` figures disagree by roughly 8.6x for
similar-sized inputs, which this change does not explain and states as
an open question rather than asserting a cause. Round 3: **ACCEPT**.

`OXIGRAPH_ROCKSDB_BUILD_KIND=vendored cargo test --locked -p oxigraph
--test upgrade_operational_drill --features rdf-12 -- --test-threads=1
--nocapture` passes both fixture versions; `cargo fmt -p oxigraph --
--check` genuinely exits 0 (checked with output redirected to a file
first, `$?` read separately, learned directly from an earlier
increment's own hardcoded-echo mistake); `git status --short` was
checked immediately after every write-mode `cargo fmt` run this
increment and confirmed no cross-package leak each time; `cargo clippy
--locked -p oxigraph --tests` reports zero `items_after_statements` in
this file (the crate's only remaining instances are in an unrelated,
pre-existing file). Committed to `main` as `70f52629`; not pushed. A
per-stage decomposition of the unexplained legacy read-ratio
disagreement, sampling around `backup_legacy`, `upgrade` and
`activate_upgrade` separately, is a real, disclosed open question for a
future increment, not folded into this one.

## Decomposing the legacy leg's read ratio by sub-stage, and a native review-worker outage worked around by model substitution (2026-09-16)

The previous section's own disclosed open question -- a roughly 8.6x
disagreement between the two legacy fixtures' own
`legacy_logical_read_ratio` figures, for similarly-sized inputs, with
no attempted explanation -- was picked up directly rather than treated
as closed. `backup_legacy`, `upgrade` and `activate_upgrade` are the
three calls inside the legacy leg's own existing start/end sampling
boundaries; three new samples decompose the single whole-leg figure
into one ratio per call, reusing those same boundaries (each new
sample doubles as one call's own end and the next call's own start, so
no new sampling infrastructure was needed) and the same
`legacy_logical_bytes` denominator the whole-leg figure already uses,
so the three sub-leg ratios sum to it by construction.

Result: `backup_legacy_logical_read_ratio` is small and similar
between fixture versions (4.47 vs 4.03) -- ruled out as the source of
the disagreement. `upgrade_logical_read_ratio` and
`cutover_logical_read_ratio` are both large and both track the same
~8.6x disagreement, narrowing the anomaly to those two calls. An
unplanned second observation from the same run: `upgrade_duration` and
`cutover_duration` both land anomalously close to ~20 seconds despite
very different architectural shapes (a shadow-copy transform versus a
metadata-level activation), correlating with the read-ratio
disagreement. Root's first draft stated this correlation as evidence
of a shared asynchronous background cause (most plausibly RocksDB's
own flush/compaction thread pool, already documented as contributing
to these same process-wide counters); independent review correctly
declined to accept that as proven and required presenting it as one of
at least two distinct, unruled-out explanations instead -- the other
being a synchronous copy/validate step inside `activate_upgrade`
itself, which would deterministically explain both the duration and
the read correlation without needing any background mechanism at all,
and which nothing in this change's own diff rules out. Deciding
between them would need reading `activate_upgrade`'s own
implementation and/or RocksDB's compaction statistics, neither of
which this change does.

Review round 1 caught a real comment defect, not just a wording
preference: the sub-leg sum's own approximation was attributed in
comment text to "the `ratio()` calls' own reads", but `ratio()` is
pure arithmetic and formatting over two already-captured samples and
performs no I/O at all -- the sample windows telescope exactly, so the
only genuine source of imprecision is each ratio's own independent
`{:.2}` display rounding. Fixed, and confirmed empirically rather than
just asserted: both fixture versions' sub-leg sums land within 0.01 of
their own whole-leg figure, exactly the scale three independent
two-decimal roundings can produce and far too small to be a real extra
read. Round 1 also required dropping the unsupported "metadata-level
activation" characterization from the narrative, corrected as above.
Round 2: **ACCEPT**.

Round 2 needed a native-worker adaptation worth recording on its own:
the review model this session has used throughout, `claude-fable-5-1`,
began returning a persistent `429 rate_limit_error` starting around
18:24 and continuing for roughly an hour across many retries spanning
several session ticks. Diagnosed directly rather than assumed --
confirmed via manual reproduction of the exact native-worker
invocation, ruling out a broken model, a broken account, or a stray
`ANTHROPIC_API_KEY` interfering with subscription auth (the harness's
own `worker.mjs` already strips that variable deliberately) -- and
confirmed the constraint was scoped to that one specific model rather
than account-wide: a `claude-opus-5` invocation under the identical
native subscription auth completed normally in seconds. Round 2 was
dispatched with `claude-opus-5` substituted for `claude-fable-5-1` for
this one review only, still native subscription auth, still
Claude-only, no API keys, no transport change beyond the model
selection itself -- consistent with the standing model-execution
policy, which requires reporting an unavailable native model rather
than falling back to a non-subscription transport, not requires
refusing any substitution among native subscription models.

Committed to `main` as `9a124cff`; not pushed. The choice between the
two explanations for the upgrade/cutover correlation remains a
genuinely open question, disclosed rather than resolved.

## Correcting a stale "next product step" claim, and closing the largest remaining crash-matrix gap (2026-09-16)

A fresh audit of the delivery-gates plan document's own "Next product
step" paragraph -- not assuming it was still accurate, following this
session's own repeated audit-before-building discipline -- found it
badly out of date. It described implementing the envelope writer and
explicit v2-to-v3 shadow upgrade as work still to be built. That work
is done: `lib/oxigraph/src/store/schema_upgrade.rs` already implements
`Store::start_schema_upgrade`/`resume_schema_upgrade`/
`activate_schema_upgrade` with a distinct schema UUID generated once at
start and retained (not regenerated) across resume -- directly verified
by confirming `create_upgrade` is called exactly once, in `start_inner`,
never in `resume_inner` -- an explicit, caller-chosen RDF write ceiling
(`SchemaUpgradeOptions::new` takes no default), a bound receipt format,
CLI exposure for all four operations, and real process-kill coverage
this session already added to all three entry points. This ADR's own
status block already described all of this accurately; the staleness
was isolated to the delivery-gates plan document, corrected there
(`main` commit `b712e042`) rather than here.

That same audit surfaced a genuine, well-scoped next increment instead:
`resume_inner` (the v2-to-v3 draft's own resume step) has ten fault
phases (0 through 9), already covered exhaustively but only
synthetically by `schema_upgrade_every_interruption_retains_uuid_and_
prior_attempt_bytes`, and covered by a real process kill only once, at
phase 2 (mid-copy). This was the largest remaining gap left by this
session's own `current_exe` audit -- `prepare_inner` and
`transform_inner` each already had real-kill coverage at their single
most consequential boundary, but `resume_inner`'s own equivalent
boundary had none. `fault(8)` fires after `PENDING` is written and
synced but strictly before `fs::rename(PENDING, COMPLETE)`; `fault(9)`
fires strictly after that rename has already returned, mapped through
`indeterminate()` -- the identical asymmetric completion-rename boundary
already proven with a real kill for `prepare_inner` and
`transform_inner` earlier this session.

The new test needed no new crash-test infrastructure:
`schema_upgrade_tests.rs` already has the `helper()`/`crash()`/
`variable()` trio and an already-generic
`schema_upgrade_resume_process_helper` (reads its target phase from an
env var, not hardcoded to phase 2), reused unchanged from the existing
phase-2 test. Unlike `prepare_inner`/`transform_inner` (explicitly not
resumable), `resume_schema_upgrade` is designed to be resumable, so
both new phases assert the same outcome the adjacent phase-2 test and
the existing synthetic every-interruption test already prove: a fresh,
in-process resume after the kill reaches the same schema UUID and a
valid receipt, independently verified, with source/package bytes
unchanged throughout.

Independent review (`claude-fable-5-1`, high effort): **ACCEPT on the
first round** -- `claude-fable-5-1` was available again after the
previous section's roughly hour-long rate-limit incident, confirming
that was transient and scoped as diagnosed. One optional, non-blocking
wording nit was applied before commit anyway: a doc-comment phrase
referencing "this session" was replaced with a reference to the actual
sibling tests, since a session-relative phrase means nothing to a
future reader of the persisted source.

`cargo test --locked -p oxigraph --lib -- "store::upgrade::transform::
receipt::schema_upgrade::tests" --test-threads=1` passes all 21 tests
in the module (20 pre-existing plus this one new test; this module's
tests are individually RocksDB-heavy, so the full run took roughly 21
minutes and was run in the background); `cargo fmt -p oxigraph --
--check` genuinely exits 0; `git diff ... | grep -c '^-[^-]'` == 0, a
pure append. Committed to `main` as `b8665a5e`; not pushed.

Both product-level open items this stream now has are precisely
scoped, not a single next feature: envelope admission on ordinary
`Store::open` (a deliberate, explicit non-goal, not a pending step),
and further crash-matrix breadth beyond the boundaries now covered on
all three v2-to-v3 entry points plus the legacy path's prepare/
transform/start/resume/activation -- individually tractable, low-risk
increments in the same proven pattern, not a single remaining task.
The frozen qualification/promotion matrix remains a separate
evaluator-authority track.

## Resolving the operational drill's upgrade/cutover correlation with direct evidence (2026-09-16)

An earlier section disclosed, without resolving, why the operational
drill's `upgrade` and `cutover` legs show correlated ~20-second
durations and correlated large logical-read ratios: two distinct,
unruled-out explanations were offered (a synchronous copy/validate
step inside `activate_upgrade` itself, or a shared background
mechanism such as RocksDB's flush/compaction pool), and deciding
between them was explicitly left for a future increment that would
need to read `activate_upgrade`'s own implementation.

That reading is now done, directly, not assumed. `activate_upgrade`
(`lib/oxigraph/src/store/upgrade_receipt.rs`'s `activate_upgrade_inner`,
the exact function the drill's `cutover` leg calls) copies every
expected file with `copy_artifact`, then calls `physical_files` twice
-- once immediately after the copy loop, once again after
`LegacyStoreSnapshot::verify_transformed` -- and `physical_files`
itself (`upgrade_transform.rs`) calls `hash_file` on every file,
computing a real SHA-256 over the actual file bytes, not a metadata-
only check. So a single `activate_upgrade` call reads every file's
full contents at least three times: once to copy it, twice more to
hash it for verification. The `upgrade` leg (`Store::upgrade`, `start_
upgrade`+`resume_upgrade`) is architecturally the same shape:
`resume_upgrade_inner` drives `Store::resume_upgrade_recovery`, the
same copy-and-verify recovery machinery this session's own crash-test
work (`upgrade_resume.rs`) already established does substantial,
multi-attempt file copying and checksum verification.

This is sufficient on its own to explain the observation. Both legs
independently perform substantial, synchronous, single-threaded
`O(data size)` work -- copying and re-hashing comparable amounts of the
same underlying legacy-fixture data -- so both legs taking similar
wall-clock time and reading similar (large, multiple-times-the-
logical-size) amounts of data is the expected outcome of that
architecture, not evidence of some third, shared mechanism. The
"shared background pool" explanation is not disproven -- RocksDB's own
background threads still contribute some I/O to the same process-wide
counters, exactly as `proc_self_io_field`'s own doc comment already
says -- but it is no longer needed to explain the correlation: the
synchronous copy/verify work each leg already performs is enough by
itself. No code or test changed for this; this is a documentation
resolution of a previously-disclosed open question, based on reading
the two functions the drill actually calls rather than speculating
about them.

## Investigating an `LD_PRELOAD` alternative for disk-exhaustion testing, and why it needs more careful scoping before it can be trusted (2026-09-16)

With gate 3's insufficient-disk-checks gap already confirmed blocked
for the unprivileged-tmpfs approach (`unshare --user --mount` fails
with "Operation not permitted" in this session's own container), this
investigated a genuinely different alternative that needs neither root
nor mount privileges: an `LD_PRELOAD` shared-library shim intercepting
libc's `write`/`pwrite` and returning `ENOSPC` once a configured byte
budget is exhausted, a well-established technique in other database
projects' own test suites for exactly this purpose.

A minimal C shim compiles cleanly (`gcc -shared -fPIC`, `dlsym(RTLD_
NEXT, ...)` to reach the real libc functions) and, tested standalone
against a single deliberate `write()` call, correctly returns `-1`/
`ENOSPC` once the budget is exhausted. But loading it as a *global*
`LD_PRELOAD` override and running even a trivial, unrelated Python
invocation under it crashed immediately, before any output at all --
consistent with `write()` being called by fundamental process
machinery (the dynamic linker, stdio buffering, the interpreter's own
startup) that a process-wide, unscoped interception disrupts in ways
that have nothing to do with the intended test.

This is not a dead end, but it is not yet a safe design either: the
right next step is scoping the interception to the exact file
descriptors under test, for example resolving `/proc/self/fd/<N>` to
confirm a write's target path is inside the test's own temporary
RocksDB directory before injecting `ENOSPC`, and passing every other
write through unmodified -- but that additional check runs on every
single `write()` call process-wide once the library is loaded, and
itself needs careful, isolated testing (recursion, overhead, and
correctness under RocksDB's own multi-threaded I/O) before it could be
trusted inside the actual test suite. Attempting this in the same
sitting as writing it up, without that isolated testing, was
deliberately not done: the demonstrated crash is exactly the kind of
evidence that this needs a dedicated, careful engineering pass of its
own, not a quick reuse of an existing pattern the way the crash-matrix
work earlier this session was. The experimental shim and its test
artifacts were removed after this finding, not left in the tree.

Insufficient-disk checks remain open, now with a concretely explored
and rejected approach (unprivileged tmpfs), a concretely explored and
not-yet-safe approach (unscoped `LD_PRELOAD`), and a specific,
actionable next design step (`/proc/self/fd` path-scoped interception,
tested in isolation before any integration) for whichever future
increment picks this up.

## Following through on the `LD_PRELOAD` design step: a validated, working shim, and two real bugs found along the way (2026-09-16)

The previous section's own concrete next step -- `/proc/self/fd`
path-scoped interception, tested in isolation before any integration
-- was picked up directly, in the same session, rather than left for
an unspecified future increment. Two real, distinct bugs were found
and fixed in the process, neither of them assumed away.

Writing the fd-scoped shim (checking `readlink("/proc/self/fd/<N>")`
against a configured prefix, only injecting `ENOSPC` for writes inside
it, passing every other write straight through) and testing it against
a trivial, unrelated Python process no longer crashed anything -- a
genuine improvement over the previous section's unscoped attempt. But
a further test, a small Rust program writing into the scoped
directory, did not receive the injected `ENOSPC` at all: the write
silently succeeded despite the budget being smaller than the write.

Rather than assume this away, it was debugged directly. The root cause
was a real logic bug in the budget check: an `atomic_fetch_sub`-based
implementation subtracted the write's byte count from the remaining
budget and then inspected the *remainder* to decide whether to reject,
but mishandled the case where a single write's count exceeds the
*entire* remaining budget in one shot -- exactly the shape of every
test case tried, since a test wants the very first over-budget write
to fail, not a later one. The fix is a plain, readable comparison
(`if (count > budget) reject`) instead of a subtract-then-inspect
dance.

A second, more consequential bug surfaced while adding temporary debug
logging to chase the first one: the debug helper called `write()` by
its own name to emit a diagnostic line. Within the same shared object,
an unqualified call to a symbol this file itself defines binds to
*that* definition, not to the real libc function reached via `dlsym`
-- so the debug helper's own logging call recursed into the shim's own
interposed `write()`, which (depending on scope and budget state)
could call the debug helper again, and crashed with a real segfault.
This is very likely the same class of bug behind the previous
section's own unexplained crash of an unrelated Python process under
the first, unscoped shim, though that specific prototype was not kept
around to confirm it retroactively. The fix, applied throughout: never
call an interposed function by name from inside its own translation
unit; route anything that must not itself be subject to interception
through a raw `syscall(SYS_write, ...)`, never through the libc
wrapper.

With both fixes applied, a five-case verification suite passed
cleanly: an unrelated Python process and an unrelated `cargo
--version` invocation both ran unaffected with the shim loaded and the
budget already exhausted; a small Rust program (`std::fs::File::
write_all`, the same API family `oxigraph`'s own storage code uses)
writing outside the scoped prefix succeeded regardless of budget; the
same program writing inside the scoped prefix failed with a genuine
`os error 28` (`ENOSPC`, surfaced through Rust's ordinary
`std::io::Error`) when the write exceeded the budget, and succeeded
normally when it did not. `os error 28` is exactly the error a real
disk-full condition produces and exactly what `StorageError::
StorageFull`'s own existing mapping (`storage/rocksdb_wrapper.rs`)
already expects to classify -- this was not designed against an
invented error shape.

This resolves the feasibility question the previous section left open:
a correctly-scoped `LD_PRELOAD` shim genuinely works and is safe for
the processes tested. What remains is a separate, larger increment,
deliberately not attempted in this same sitting: designing the actual
Rust integration test (deciding how the shim gets built and made
available to `cargo test`, choosing which real `oxigraph` operation to
target, and going through this session's own established build-test-
review-commit cycle for new test infrastructure, not just a new test
case). The experimental shim, probe binary and their build artifacts
were removed after this verification, exactly as after the previous
section's own experiment; nothing from this investigation was left in
the tree.

## The first real disk-exhaustion test, closing gate 3's zero-coverage gap (2026-09-16)

The larger increment the previous section deliberately deferred --
writing the actual Rust integration test against a real `oxigraph`
operation, using the validated `LD_PRELOAD` shim design -- is now done
and committed (`f975c943`), landing in
[`legacy_backup.rs`](../../lib/oxigraph/src/store/legacy_backup.rs).

`Store::backup_legacy` (`backup_inner`) was chosen as the target: a
single flat, sequential file-copy loop (`copy_artifact`) with no
RocksDB-FFI status-string parsing in between, confirmed by direct
reading that the crate's only other `StorageFull` mapping (in
`storage/rocksdb_wrapper.rs`) parses RocksDB's own `"IO error: No
space left on device"` text and is unrelated to this plain-file-copy
path. The shim is compiled once (skipping gracefully, with an
`eprintln!`, if no `cc` is available) and `LD_PRELOAD`ed into a
freshly re-exec'd child process -- required because `LD_PRELOAD` only
takes effect at a process's own exec, never retroactively on an
already-running one, so the same `current_exe() --exact <helper>`
re-invocation technique this session's real-process-kill tests already
use is reused here for an unrelated reason: getting the dynamic loader
to pick the shim up at all. With the injection budget set to zero,
the very first byte `copy_artifact` writes into the destination fails
with a genuine `ENOSPC`, deterministically, regardless of fixture file
size or ordering. The child helper asserts the result is specifically
`Err(BackupError::Io(e))` with `e.kind() == io::ErrorKind::StorageFull`
-- proving the crate's real `BackupError::Io(#[from] io::Error)`
conversion preserves the OS error kind through a genuine fault, not
just that some `Err` variant surfaces -- and only then does the parent
assert on remaining disk state: source bytes unchanged, no `COMPLETE`
marker, `LegacyBackupReceipt::verify` failing on the incomplete
destination.

Two independent review rounds (`xhigh`, `claude-fable-5-1`), both
genuinely substantive rather than rubber-stamped:

Round 1 REJECTed on two real defects. First, a **MUST-FIX**: the test
module is `cfg(all(test, unix))`, so macOS and FreeBSD would compile
and run this test even though `LD_PRELOAD` is ignored by `dyld` and
`/proc/self/fd` does not exist there -- the backup would silently
succeed, the helper would return `Err` where it expected the injected
fault, and the test would fail loudly instead of skipping, directly
contradicting the "graceful runtime skip" the delivery text claimed
(which only ever covered the missing-`cc` case). Fixed with
`if !cfg!(target_os = "linux") { return Ok(()); }` as the parent
test's first statement, before any shim compilation is attempted.
Second, a **SHOULD-FIX**: every parent-side assertion also holds when
the child never actually executes the helper at all -- a helper-name
typo makes the `--exact` filter match zero tests and the child exits
0; an env-var name drift makes the helper itself return `Ok(())` as
its own "ordinary run" no-op -- so the test could pass vacuously with
no positive evidence the copy loop was ever reached. Fixed with
`assert!(destination.join("store").is_dir(), ...)` immediately after
the child exits: `backup_inner` creates that directory via
`private_directory` immediately before the copy loop and no failure
path removes it, so its presence is real evidence of loop entry, not
just of a zero-exit-code child.

That fix was not just reasoned about but empirically mutation-tested:
the helper-name literal was temporarily corrupted, the parent test was
re-run and observed to panic at exactly the new assertion with `test
result: FAILED`, the literal was restored, `git diff | grep -c
MUTATED` confirmed zero occurrences remained, and a fresh full run
passed 6/6 again. Round 1 also raised four MINOR/INFO items, all
applied: `ENOSPC_SHIM_PREFIX` is now built from a `canonicalize()`d
root so it agrees by construction with what `/proc/self/fd` readlink
reports, rather than by coincidence of the container's own `/tmp` not
currently containing a symlink; the shim is compiled beside the test
binary itself (`current_exe().parent()`, i.e. `target/*/deps`) instead
of into a tempdir, since a `noexec` mount there would silently defeat
`LD_PRELOAD`; the `cc`-missing skip now prints an `eprintln!` instead
of passing silently; and the doc comment no longer overclaims `pwrite`
coverage, since Linux positioned writes actually resolve to the
distinct `pwrite64` symbol, which this shim does not intercept (this
is harmless for `copy_artifact`, which uses `write_all`, not positioned
writes, confirmed by direct reading of `backup.rs`).

Round 2 ACCEPTed: both fixes independently re-verified against
`backup_inner`'s actual control flow (including a fifth reasoning
check the reviewer added unprompted -- `check_native_files` guarantees
at least `LOCK`/`IDENTITY`/`CURRENT`/the named `MANIFEST` are present,
so `files` always has at least four entries and the copy loop always
runs at least once, closing the last gap in the vacuous-pass argument),
every MINOR fix confirmed present and matching its C source exactly,
and one new non-blocking MINOR recorded: the shim is compiled with the
host's default `cc` ABI, so a 32-bit or statically-linked (musl) test
target would see the shim silently fail to load and the parent test
would fail loudly rather than skip. This is explicitly scoped as
relevant only if a CI job ever runs this crate's library tests against
such a target -- not the case today -- and is recorded here as a known
limitation rather than fixed pre-emptively.

What this does not claim: this is one entry point (`backup_legacy`),
not the crash/fault matrix gate 3 still describes as open more broadly
-- `prepare_inner`, `transform_inner`, the v2-to-v3 draft's
construction/resume/activation, and `activate_upgrade` remain covered
only by their existing synthetic phase-callback and real-process-kill
tests, not by this disk-exhaustion technique. The technique itself is
Linux-specific by construction (`/proc/self/fd`, `LD_PRELOAD`-honoring
dynamic linking), gated at runtime rather than by a compile-time `cfg`,
matching this file's own established preference for graceful runtime
degradation (see `proc_self_io_field` in the operational drill) over
narrowing what compiles.

## Extending disk-exhaustion coverage to a second entry point: `prepare_upgrade` (2026-09-16)

The just-accepted `backup_legacy` disk-exhaustion test's own text named
what remained open: `prepare_inner`, `transform_inner`, the v2-to-v3
draft's construction/resume/activation, and `activate_upgrade` still
had no disk-exhaustion coverage. Before picking a second target, both
`prepare_inner`'s and `transform_inner`'s own write call sites were
read directly, not assumed to carry `backup_legacy`'s shape over
unchanged. `prepare_inner`'s first real write is the journal metadata
write (`write(&destination.join(JOURNAL), &journal(&receipt))?`),
strictly between `phase(0)` (fires right after the two `mkdir`-only
`private_directory` calls) and `phase(1)` (fires only after both the
journal and guard writes, plus directory syncs, complete) -- a moment
neither the file's own existing synthetic phase-callback test (which
can only fail exactly at an integer phase boundary) nor its existing
real-process-kill test (which targets the later PENDING-to-COMPLETE
rename) can reach. This is architecturally distinct from
`backup_legacy`'s mid-copy fault, not a restatement of it.

The new test (`disk_exhaustion_before_the_journal_write_preserves_both_inputs`,
[`upgrade.rs`](../../lib/oxigraph/src/store/upgrade.rs)) reuses the
file's own pre-existing `helper`/`crash`/`variable`/`fixture`/`hashes`
test infrastructure unmodified, duplicates the already-reviewed
`compile_enospc_shim` file-local (matching this session's established
convention for crash-test infrastructure), and asserts: the child
reached `prepare_inner`'s setup (`output/store` exists); the injected
`ENOSPC` landed exactly on the journal write and nowhere else (the
journal file exists at zero bytes, and the guard write that would
follow it never ran); no `COMPLETE` marker; `PreparedUpgrade::verify`
fails; and -- since `prepare_upgrade` takes an already-completed
legacy backup as an input, unlike `backup_legacy` -- *both* upstream
inputs remain untouched: the legacy source's own bytes, and the
already-completed backup package's own bytes and receipt validity.

Two review rounds (`xhigh`, `claude-fable-5-1`). Round 1 was
**INCONCLUSIVE**, not REJECT: that worker had no shell or file tools
available, so it could not execute the completion check at all, but
said explicitly that nothing in the code itself blocked ACCEPT once
the listed commands passed. It did raise one real, substantive
**SHOULD-FIX**: the parent's assertions (no `COMPLETE`, `verify`
fails, both inputs untouched) would hold identically whether the fault
landed on the journal write, the guard write, or inside the copy loop
-- so the test's claimed injection point was established only by
*code reading*, not by its own post-conditions. Fixed by adding the
two pinning assertions described above
(`assert_eq!(fs::metadata(output.join(JOURNAL))?.len(), 0)` and
`assert!(!output.join("store").join(UPGRADE_GUARD).exists())`),
mirroring the same "prove the claim with a post-condition, not just an
assertion that some later invariant holds" discipline the vacuous-pass
fix used for `backup_legacy`. A doc-comment NIT (a stale cross-file
function-name reference) was also fixed.

Round 1 also surfaced a genuine, previously-unverified risk: whether
`clippy::print_stderr` fires on the `eprintln!` the earlier round added
for the cc-missing skip. This was resolved by actually running the
isolated lint check (`cargo clippy -p oxigraph --lib --tests --no-deps
-- --warn=clippy::print_stderr`, deliberately without `-D warnings`,
since a full `-D warnings` pass on this crate fails to even reach the
test module -- 41 pre-existing, unrelated lint findings in the lib
crate alone, e.g. `partial_pub_fields` on `storage/rocksdb.rs`, block
it first, and `--all-targets -D warnings` fails even earlier on an
unrelated `oxhttp` `wrong_self_convention` finding two calls deep in a
different crate -- confirming a full strict clippy pass has never been
part of this project's actual completion-check contract, and that
fixing 41 unrelated findings would be out of scope for this increment).
The narrower, real question had a real answer: `clippy::print_stderr`
did fire, on both this file's and `backup_legacy`'s own `eprintln!`
inside `compile_enospc_shim`. Both fixed with
`#[expect(clippy::print_stderr, reason = "...")]`, mirroring the same
file's own existing `#[expect(clippy::exit, ...)]` pattern for the
same kind of deliberate, test-only exception; re-running the isolated
check afterward confirmed zero remaining hits in either shim and no
"unfulfilled lint expectation" complaint. The `legacy_backup.rs` half
of this fix, being a small, mechanical, zero-behavior-change addition
to already-accepted code (verified directly by running clippy before
and after), was committed separately without a fresh review round
(`5d6f49d5`); round 2 confirmed this was reasonable but recommended
the orchestrator spot-check its scope, which was done directly
(`git show 5d6f49d5 --stat`: one file, four insertions, attribute-only).

Round 2 ACCEPTed, independently re-tracing the injection point against
`prepare_inner`'s real write order (`mkdir`/`open`/`fsync` are not
intercepted by the shim; only `write`/`pwrite` are, so the journal
write genuinely is the first in-scope call) and re-confirming the
mutation-test round-trip's shape. Committed `cfca0e25`.

What remains open, unchanged from the prior section: `transform_inner`,
the v2-to-v3 draft's construction/resume/activation, and
`activate_upgrade` still have no disk-exhaustion coverage from this
technique -- two entry points now, not the whole matrix.

## A third entry point, a genuinely different error path, and a transient dispatch failure diagnosed directly (2026-09-16)

`transform_inner`'s own write call sites were read directly before
picking it as the third disk-exhaustion target, not assumed to match
`prepare_inner`'s shape. Its first real write is architecturally
distinct from both prior injection points: it sits *inside* the RDF
mutation loop itself, not in pre-copy setup. The closure passed to
`copy_lease.transform_upgrade(&expected, options, started, |edge| {
... })` opens the transform journal with `create_new(true)` on the
first edge (`last == None`) and calls `file.write_all(&frame)?`,
strictly between `fault(0)` (fires before `transform_upgrade` starts
at all) and `fault(1)` (fires only after the first edge's frame is
written, synced, and the directory synced) -- a moment while real
quad-projection work is already in flight, not before it starts.

The new test
(`disk_exhaustion_on_the_first_transform_journal_frame_preserves_inputs`,
[`upgrade_transform.rs`](../../lib/oxigraph/src/store/upgrade_transform.rs))
builds a real backup and a real prepared workspace first (this entry
point's own public API, `Store::transform_prepared_upgrade`, requires
both), then injects the fault. Its assertions double up on purpose:
the transform journal file's mere existence is both the vacuous-pass
guard (nothing before the mutation loop creates that name) and half of
the injection-point pin, with the other half being its exact zero
length (a non-empty frame would prove the write got further before
failing). This mirrors the same "prove the claim with a post-condition,
not just a plausible-sounding assertion" discipline the `prepare_upgrade`
review round required explicitly.

A genuine bug surfaced by actually running the test, not by assuming
the prior two entry points' shape would carry over: the first draft's
child helper expected `Err(BackupError::Io(_))`, exactly matching
`backup_legacy`'s and `prepare_upgrade`'s own pattern, and the test
failed with a real, informative panic:
`Error: "expected a StorageFull BackupError::Io, got Err(Storage(Io(Os
{ code: 28, kind: StorageFull, message: \"No space left on device\"
})))"`. Reading `transform_inner`'s code explained why: the journal
write happens inside a closure whose error type is `StorageError`, not
`BackupError` -- `file.write_all(&frame)?` converts through
`From<io::Error> for StorageError`, and only the *outer*
`.map_err(|error| ... BackupError::Storage(error))` wraps that into a
`BackupError` afterward. Fixed by matching
`Err(BackupError::Storage(crate::storage::StorageError::Io(error)))`
instead, confirming `StorageError::Io(#[from] io::Error)` has the exact
same faithful-preservation shape as `BackupError::Io`. Re-ran the full
suite after the fix: 8/8 green. This is exactly the kind of thing this
session's own standing discipline exists to catch -- an assumption
that looked safe because it had worked twice before, disproven by
actually executing the test rather than reasoning it through.

Native review dispatch failed once with an error that looked, at
first glance, like it could be another rate limit or subscription
outage: `status: "unavailable"`, `error: "dispatch failed: Unexpected
token 'T', \"There's an\"... is not valid JSON"`. Diagnosed directly,
per this session's own established practice, rather than assumed: a
manual `claude -p "reply with exactly: PONG" --model
"cc/claude-fable-5-1[1m]"` reproduction returned `PONG` correctly --
native subscription auth and the model itself were never the problem
-- but printed two extra lines around it: a one-time warning that
`ANTHROPIC_API_KEY` being set takes precedence over claude.ai
connectors (unrelated to which auth serves the actual completion), and
a broken `SessionEnd` hook failing because `/home/claude/.local/bin/ruflo`
does not exist on this host. Either line landing in `worker.mjs`'s
strict JSON-only expectation was enough to break the parse. A plain
retry of the same dispatch succeeded cleanly, confirming this was a
one-off, not a persistent block; no environment or hook change was
made to work around it, since the underlying model dispatch itself was
never impaired.

Single review round (`xhigh`, `claude-fable-5-1`): **ACCEPT**,
independently re-tracing the error-conversion path, the injection-point
pin, and confirming the artifact-name collision-avoidance across all
three shim files by name comparison. Committed `0a345409`.

What remains open: the v2-to-v3 draft's construction/resume/activation
(`schema_upgrade.rs`) and `activate_upgrade` still have no
disk-exhaustion coverage from this technique -- three entry points now,
not the whole matrix.

## A fourth entry point, chosen by first ruling out two already-covered boundaries (2026-09-16)

`activate_inner` (`Store::activate_schema_upgrade`, the v2-to-v3
draft's activation step) was picked as the fourth disk-exhaustion
target only after reading its *two existing tests* first, specifically
to confirm the new injection point would not be a near-duplicate of
either: `schema_upgrade_activation_faults_never_leave_a_usable_target`
injects synthetic `Cancelled` errors at every integer phase 0..5, and
`schema_upgrade_activation_child_exits_before_and_after_guard_unlink`
real-kills the process at phases 4/5 -- the guard *unlink* boundary at
the very end of activation. Neither touches the guard *write* at the
very start (`write(&target.join(UPGRADE_GUARD), GUARD)?`, strictly
between `fault(0)` and `fault(1)`), which is where the new test
injects instead. A real `ENOSPC` there produces a zero-byte guard file
-- a state neither existing test can produce, since a synthetic
`Cancelled` never touches the write itself and a process kill either
happens before the guard exists at all or after it is fully written.

The new test
(`disk_exhaustion_on_the_activation_guard_write_preserves_every_input`,
[`schema_upgrade_tests.rs`](../../lib/oxigraph/src/store/schema_upgrade_tests.rs))
reuses this file's own existing `fixture`/`sealed` setup helpers
unmodified -- the same real commit, outbox retention, namespace and
sealed-workspace state `schema_upgrade_activation_faults_never_leave_a_
usable_target` already builds, not a new fixture. Its assertions mirror
that same test's own established invariant (`if
target.join(UPGRADE_GUARD).exists() { assert!(Store::open(&target).is_err()); }`)
rather than inventing a new one, adding only the two pinning checks
this technique's own established discipline requires: the guard file
exists (positive evidence of real activation work, doubling as the
vacuous-pass guard) and is exactly zero bytes (pinning the fault to
that first write, not a later one). Source, package *and* the sealed
workspace itself are all checked byte-identical afterward, matching the
existing test's exact three-way comparison.

The error-path assumption (`BackupError::Io` directly) was not carried
over from the first two entry points without checking -- precisely
because the third entry point (`transform_inner`) already proved that
assumption unsafe in general. It was independently re-verified instead:
`schema_upgrade.rs` has no local `fn write`, and its `use super::*`
chain (`schema_upgrade.rs` -> `upgrade_receipt.rs` -> `upgrade_transform.rs`
-> `upgrade.rs`) resolves to `upgrade.rs`'s own `write()` helper, the
exact same one already proven (for `backup_legacy` and `prepare_upgrade`)
to convert a real `ENOSPC` into `BackupError::Io` directly, not wrapped
in `BackupError::Storage(...)`.

Single review round (`xhigh`, `claude-fable-5-1`): **ACCEPT**,
confirming the injection point's novelty against both existing tests,
the vacuous-pass guards' soundness (a corrupted helper name, an inert
shim, or the wrong error variant each fail the parent deterministically),
and artifact-name isolation across all four shim files now in the
same `target/debug/deps` directory. One real, cheap, non-blocking
finding was applied afterward: the child helper was missing the
`OXIGRAPH_ROCKSDB_BUILD_KIND == "vendored"` gate its three sibling
helpers in this same file all carry -- harmless in practice (the
absent env var already makes an ordinary run a no-op), but worth
aligning for consistency. Committed `c6beeb5e`.

What remains open: the `copy_artifact` loop inside this same
`activate_inner` function (between `fault(1)` and `fault(2)`/`(3)`,
copying validated attempt-store files into the target) remains
untested by this technique -- only the guard-write boundary is
covered. `start_inner` (`schema_upgrade.rs`'s construction path) and
`resume_inner`'s remaining fault phases beyond the two already covered
by real-process-kill tests also remain open. Four entry points are
covered crate-wide now, not the complete crash/fault matrix.

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
